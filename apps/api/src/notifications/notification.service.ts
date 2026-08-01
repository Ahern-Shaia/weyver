import { Inject, Injectable, Logger } from "@nestjs/common"
import { and, eq, inArray, isNull } from "drizzle-orm"
import { DRIZZLE, type DrizzleDb } from "../db/db.module.js"
import { formDefs, roleMembers, users } from "../db/schema.js"
import {
  DEFAULT_LEVEL,
  bypassesMasterSwitch,
  levelAllows,
  safeTitle,
} from "./notification-specs.js"
import {
  type NewNotification,
  NotificationRepository,
  type PrefRow,
} from "./notification.repository.js"

/* H-1 M1|通知核心。

   **事件一律由 service 層顯式 emit**(OQ-NT-3)—— 不用 DB trigger 也不攔截所有寫入,
   因為那兩者**分不出批次與單筆**,而 Ragic 明載「大量修改或匯入的資料即使符合條件
   也不會寄送通知」(FMEA N1 風暴防護)。顯式 emit 讓「這條路徑要不要通知」
   成為程式碼裡看得見的決定。

   **通知內容一律不含欄位值**(OQ-NT-9):Jira/GitLab 靠「過濾收件人」解決洩漏,
   但那是因為它們沒有欄位級權限;Weyver 有 → 過濾收件人不足。
   標題亦不得取 fields[0](FMEA N14),由 `safeTitle()` 產生。 */

const PANEL_LIMIT = 50

export interface EmitInput {
  readonly tenantId: number
  readonly event: string
  readonly formId: number
  readonly recordId: number | null
  /* 觸發者。**預設不通知自己** —— 自己做的事不需要被告知 */
  readonly actorId: number | null
  /* 指名收件人(簽核:該關卡角色成員)。未給則依訂閱層級解析全租戶 */
  readonly recipientActorIds?: readonly number[]
  /* 與此記錄「相關」的人(P0 = createdBy)。用於 involved 判定 */
  readonly involvedActorIds?: readonly number[]
}

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name)

  constructor(
    @Inject(NotificationRepository) private readonly repo: NotificationRepository,
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
  ) {}

  /* 通知為**非關鍵路徑**(AGENTS 優雅降級鐵則):失敗只告警,絕不讓簽核 / 存檔失敗。 */
  async emit(input: EmitInput): Promise<number> {
    try {
      return await this.emitOrThrow(input)
    } catch (error) {
      this.logger.error(
        `notification emit failed (${input.event}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
      return 0
    }
  }

  async emitOrThrow(input: EmitInput): Promise<number> {
    const form = await this.formOf(input.tenantId, input.formId)
    if (form === null) return 0

    const candidates = await this.candidates(input)
    if (candidates.length === 0) return 0

    const [prefs, settings] = await Promise.all([
      this.repo.listPrefs(input.tenantId, candidates),
      this.repo.listSettings(input.tenantId, candidates),
    ])
    const involved = new Set(input.involvedActorIds ?? [])
    const title = safeTitle(form.name, input.recordId)

    const rows: NewNotification[] = []
    for (const actorId of candidates) {
      /* 不通知觸發者自己 */
      if (actorId === input.actorId) continue

      const setting = settings.get(actorId)
      /* 軸 0 總開關。承 Ragic:關閉即不發送。唯一例外為簽核逾期(裁定 ④) */
      if (setting?.enabled === false && !bypassesMasterSwitch(input.event)) continue

      const resolved = resolveLevel(prefs.get(actorId) ?? [], form.categoryId, input.formId)
      if (!levelAllows(resolved.level, input.event, involved.has(actorId), resolved.customEvents)) {
        continue
      }
      /* 軸 2 通道:**逐人決定**。缺設定 = 站內 + Email 皆開(既有使用者零遷移)。 */
      const chosen = setting?.channels?.[input.event]
      rows.push({
        tenantId: input.tenantId,
        recipientActorId: actorId,
        event: input.event,
        formId: input.formId,
        recordId: input.recordId,
        title,
        actorId: input.actorId,
        channels:
          chosen === undefined
            ? ["inapp", "email"]
            : ["inapp", ...(chosen.includes("email") ? ["email"] : [])],
      })
    }
    return this.repo.createMany(rows)
  }

  /* 收件人解析。**未停用檢查**:離職者不該繼續收通知(FMEA N7)。

     **指名收件人不經 role_members 過濾**(實作期發現的缺陷):
     指名來源(簽核關卡成員 / 送簽者)其查詢本身已是租戶範圍,再加一層角色過濾
     是多餘的,且會**silently 丟掉沒有任何角色的人** —— 使用者可憑 owner 短路
     或租戶預設權限建單送簽,卻因無角色而永遠收不到核准/駁回結果。
     租戶安全由「來源查詢已 tenant-scoped」+「notification 列帶 tenant_id + RLS」保證。

     未指名時才用 role_members 列舉全租戶 —— 那是唯一能枚舉「這個租戶有誰」的來源。 */
  private async candidates(input: EmitInput): Promise<number[]> {
    const explicit = input.recipientActorIds
    if (explicit !== undefined) {
      if (explicit.length === 0) return []
      const rows = await this.db
        .select({ id: users.id })
        .from(users)
        .where(and(inArray(users.id, [...explicit]), isNull(users.deletedAt)))
      return rows.map((r) => r.id)
    }
    const rows = await this.db
      .selectDistinct({ actorId: roleMembers.actorId })
      .from(roleMembers)
      .innerJoin(users, eq(users.id, roleMembers.actorId))
      .where(and(eq(roleMembers.tenantId, input.tenantId), isNull(users.deletedAt)))
    return rows.map((r) => r.actorId)
  }

  private async formOf(
    tenantId: number,
    formId: number,
  ): Promise<{ name: string; categoryId: number | null } | null> {
    const rows = await this.db
      .select({ name: formDefs.name, categoryId: formDefs.categoryId })
      .from(formDefs)
      .where(and(eq(formDefs.tenantId, tenantId), eq(formDefs.id, formId)))
      .limit(1)
    return rows[0] ?? null
  }

  async list(tenantId: number, actorId: number) {
    const [items, unread] = await Promise.all([
      this.repo.listForActor(tenantId, actorId, PANEL_LIMIT),
      this.repo.unreadCount(tenantId, actorId),
    ])
    return { items, unread }
  }

  async markRead(tenantId: number, actorId: number, ids: readonly number[]): Promise<void> {
    await this.repo.markRead(tenantId, actorId, ids)
  }

  async markAllRead(tenantId: number, actorId: number): Promise<void> {
    await this.repo.markAllRead(tenantId, actorId)
  }
}

/* 繼承解析:form → category → tenant → 系統預設。**最具體者勝**(GitLab 語意)。
   缺列 = 繼承上層,**不是**「關閉」—— 這是 enum 相對於獨立布林開關的關鍵優勢。
   Discourse 的教訓:多維度 precedence 未文件化 = 永久客服,故此處註解即規格。 */
export function resolveLevel(
  prefs: readonly PrefRow[],
  categoryId: number | null,
  formId: number,
): { level: number; customEvents: readonly string[] | null } {
  const byForm = prefs.find((p) => p.scope === "form" && p.scopeId === formId)
  if (byForm !== undefined) return { level: byForm.level, customEvents: byForm.customEvents }
  if (categoryId !== null) {
    const byCat = prefs.find((p) => p.scope === "category" && p.scopeId === categoryId)
    if (byCat !== undefined) return { level: byCat.level, customEvents: byCat.customEvents }
  }
  const byTenant = prefs.find((p) => p.scope === "tenant")
  if (byTenant !== undefined) return { level: byTenant.level, customEvents: byTenant.customEvents }
  return { level: DEFAULT_LEVEL, customEvents: null }
}
