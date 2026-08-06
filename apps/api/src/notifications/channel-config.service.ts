import { BadRequestException, Inject, Injectable } from "@nestjs/common"
import { ConfigService } from "@nestjs/config"
import { and, eq } from "drizzle-orm"
import { openSecret, sealSecret } from "../crypto/secret-box.js"
import { TenantDb } from "../db/db.module.js"
import { notificationChannels } from "../db/schema.js"
import { CHANNELS, CHANNEL_IDS, type ChannelId, isAllowedUrl } from "./channel-registry.js"

/* 🔴 R1·A-1 M4|通知通道連接設定(OQ-SC-6=A 加密 / 7=A 不回顯 / 8=A allow-list)。

   ## 回顯語意照 Grafana

   Grafana 文件逐字:「By defining `password` and `basicAuthPassword` under
   `secureJsonData` Grafana encrypts them… Then, the encrypted fields are listed
   under **`secureJsonFields`**」—— API **只回布林旗標,永不回值**。

   ⚠️ **誠實標注**|找不到任何權威來源明文反對「顯示明文」按鈕。反對理由是可推導的
   (回顯明文把洩漏面從 DB 擴大到瀏覽器 / HTTP 快取 / 截圖 / 客服代登入),
   但那是推論不是引用 —— 見 settings-center.md §0.3(c)。

   ## 「未填 = 不動」而不是「未填 = 清空」

   使用者改 SMTP 的 port 時不該被迫重打密碼。故 `secret` 省略即保留原值;
   要清除必須顯式送 `clearSecret: true`。這一條看似小,但寫反的話
   使用者每次調設定都會把憑證洗掉,而且要等到下次發送失敗才知道。 */

export interface ChannelStatus {
  readonly channel: ChannelId
  readonly label: string
  /* 🔴 **設定表單的規格由後端給**,前端不再自己抄一份。

     2026-08-05 加 WhatsApp 時發現前端有**第三份**鏡射(`channel-card.tsx` 的 `SPEC`),
     而它自己的註解就寫著「兩邊都改才算改完」—— 那是一條沒有檢查的規則,
     所以它漏了。與其再加一道守衛,不如**讓那份複本不存在**:
     後端本來就有 `secretLabel` / `secretHint` / `configFields`,回傳即可。 */
  readonly secretLabel: string
  readonly secretHint: string
  readonly configFields: readonly { readonly key: string; readonly label: string }[]
  readonly config: Record<string, unknown>
  /* Grafana `secureJsonFields` 語意:只說「有沒有設」,永不回值 */
  readonly secretSet: boolean
  readonly secretFingerprint: string | null
  readonly verifiedAt: Date | null
  readonly enabled: boolean
  /* 管理者勾選要廣播哪些事件。空 = 連上了但不廣播 */
  readonly broadcastEvents: readonly string[]
  readonly updatedAt: Date | null
}

@Injectable()
export class ChannelConfigService {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  private kek(): string {
    const kek = this.config.get<string>("WEYVER_SECRET_KEK")
    /* 走到這裡還沒有 KEK 表示 env 驗證被繞過了 —— 寧可拋,不要用空字串加密 */
    if (kek === undefined || kek === "") throw new Error("WEYVER_SECRET_KEK 未設定")
    return kek
  }

  /* 全通道狀態(含未設定的)—— UI 要能列出「還沒連接的通道」,
     否則使用者不知道系統支援什麼。 */
  async list(tenantId: number): Promise<ChannelStatus[]> {
    const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
      tx.select().from(notificationChannels),
    )
    const byChannel = new Map(rows.map((r) => [r.channel, r]))
    return CHANNEL_IDS.map((id) => {
      const row = byChannel.get(id)
      return {
        channel: id,
        label: CHANNELS[id].label,
        secretLabel: CHANNELS[id].secretLabel,
        secretHint: CHANNELS[id].secretHint,
        configFields: CHANNELS[id].configFields,
        config: (row?.config as Record<string, unknown>) ?? {},
        secretSet: row?.secretSealed != null,
        secretFingerprint: row?.secretFingerprint ?? null,
        verifiedAt: row?.verifiedAt ?? null,
        enabled: row?.enabled ?? false,
        broadcastEvents: row?.broadcastEvents ?? [],
        updatedAt: row?.updatedAt ?? null,
      }
    })
  }

  async save(
    tenantId: number,
    actorId: number,
    input: {
      readonly channel: ChannelId
      readonly config: Record<string, unknown>
      readonly secret?: string | undefined
      readonly clearSecret?: boolean
      readonly enabled?: boolean
      readonly broadcastEvents?: readonly string[]
    },
  ): Promise<ChannelStatus> {
    const spec = CHANNELS[input.channel]

    /* 🔴 機密本身就是 URL 的通道(Slack / Teams / Discord),在**存進去之前**
       就要過 allow-list。等到發送時才檢查的話,一個指向內網的 URL 已經先躺在 DB 裡,
       任何未來新增的發送路徑都可能漏掉那道檢查。 */
    if (
      spec.secretIsUrl &&
      input.secret !== undefined &&
      !isAllowedUrl(input.channel, input.secret)
    )
      throw new BadRequestException({
        code: "CHANNEL_URL_NOT_ALLOWED",
        message: `${spec.label} 的網址必須是官方網域(${spec.allowedHosts.join(" / ")})`,
      })

    const sealed = input.secret === undefined ? null : sealSecret(input.secret, this.kek())

    const existing = await this.tenantDb.withTenant(tenantId, (tx) =>
      tx
        .select()
        .from(notificationChannels)
        .where(eq(notificationChannels.channel, input.channel))
        .limit(1),
    )
    const prev = existing[0]

    /* 憑證換了就得重新驗證 —— 舊的 verifiedAt 不能替新值背書。 */
    const secretChanged = sealed !== null || input.clearSecret === true
    const values = {
      tenantId,
      channel: input.channel,
      config: input.config,
      secretSealed:
        input.clearSecret === true ? null : (sealed?.sealed ?? prev?.secretSealed ?? null),
      secretFingerprint:
        input.clearSecret === true
          ? null
          : (sealed?.fingerprint ?? prev?.secretFingerprint ?? null),
      verifiedAt: secretChanged ? null : (prev?.verifiedAt ?? null),
      enabled: input.enabled ?? prev?.enabled ?? false,
      broadcastEvents: [...(input.broadcastEvents ?? prev?.broadcastEvents ?? [])],
      updatedAt: new Date(),
      updatedByActorId: actorId,
    }

    await this.tenantDb.withTenant(tenantId, async (tx) => {
      if (prev === undefined) {
        await tx.insert(notificationChannels).values(values)
        return
      }
      await tx
        .update(notificationChannels)
        .set(values)
        .where(
          and(
            eq(notificationChannels.tenantId, tenantId),
            eq(notificationChannels.channel, input.channel),
          ),
        )
    })

    const after = await this.list(tenantId)
    const status = after.find((s) => s.channel === input.channel)
    if (status === undefined) throw new Error("儲存後查不到通道設定")
    return status
  }

  /* 🔴 取出明文 —— **只有發送路徑可以呼叫**,絕不經由任何 controller 回傳。
     刻意取名 reveal 而不是 get:讀到這個字的人會停一下。 */
  async revealSecret(tenantId: number, channel: ChannelId): Promise<string | null> {
    const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
      tx
        .select({ sealed: notificationChannels.secretSealed })
        .from(notificationChannels)
        .where(eq(notificationChannels.channel, channel))
        .limit(1),
    )
    const sealed = rows[0]?.sealed
    if (sealed == null) return null
    return openSecret(sealed, this.kek())
  }

  async markVerified(tenantId: number, channel: ChannelId): Promise<void> {
    await this.tenantDb.withTenant(tenantId, (tx) =>
      tx
        .update(notificationChannels)
        .set({ verifiedAt: new Date() })
        .where(
          and(
            eq(notificationChannels.tenantId, tenantId),
            eq(notificationChannels.channel, channel),
          ),
        ),
    )
  }
}
