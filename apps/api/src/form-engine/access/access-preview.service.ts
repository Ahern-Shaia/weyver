import { Inject, Injectable } from "@nestjs/common"
import type { Knex } from "knex"
import { APP_KNEX } from "../../db/db.module.js"
import { DATA_SCHEMA, physicalTableName } from "../identifiers.js"
import { AuthzRepository } from "../../authz/authz.repository.js"
import { PermissionService } from "../../authz/permission.service.js"
import type { FormAction } from "../../authz/authz-model.js"

/* 🔴 E-1 預覽模擬器(#96,OQ-DP-8=A / OQ-DP-10=A)。

   **為什麼這是 P0 而不是 nice-to-have**|doc §0.5 記載的 Salesforce Community 外洩
   (Krebs / Varonis 揭露)根因不是規則寫錯,而是「**規則語意正確但管理員理解錯**」——
   而該產品**無法在設定當下看見實際效果**。權限功能的預設失效模式就是「以為設對了」。

   **唯讀試算而非 impersonation**(OQ-DP-10=A)|「Login as user」被指出觀測性不足、
   易被濫用(Varonis)。此處給管理員判斷所需的一切(看得到幾筆、為什麼),
   但**不讓他藉此翻閱他人資料** —— 只回標題欄與理由,不回整列。

   對標 SharePoint 的 Check Permissions(§0.9 三分類之 effective access)。

   ⚠️ **放在 form-engine 而非 authz**:它讀的是動態表資料(APP_KNEX 車道),
   那是 form-engine 的領域;放 authz 會讓授權模組反向依賴記錄資料車道。 */

export interface AccessPreviewRow {
  readonly recordId: number
  readonly title: string
  /** 為什麼看得到 —— 沒有這個,管理員只能看到一個數字而無從判斷對錯 */
  readonly reason: "owner" | "assigned" | "unrestricted"
}

export interface AccessPreview {
  readonly actorId: number
  readonly formId: number
  readonly scoped: boolean
  readonly visibleCount: number
  readonly totalCount: number
  readonly samples: readonly AccessPreviewRow[]
}

@Injectable()
export class AccessPreviewService {
  constructor(
    @Inject(APP_KNEX) private readonly knex: Knex,
    @Inject(PermissionService) private readonly permissions: PermissionService,
    @Inject(AuthzRepository) private readonly authz: AuthzRepository,
  ) {}

  /* 可預覽的人員 —— 見 AuthzRepository.listTenantActors 的理由 */
  listActors(tenantId: number): Promise<number[]> {
    return this.authz.listTenantActors(tenantId)
  }

  async preview(
    tenantId: number,
    formId: number,
    actorId: number,
    action: FormAction = "view",
  ): Promise<AccessPreview> {
    /* 🔴 復用**同一條**權限解析(PermissionService)—— 若預覽另寫一套判斷,
       它就會與實際不一致,那比沒有預覽更糟:管理員會相信一個錯的東西。 */
    const perms = await this.permissions.resolveForActor(tenantId, actorId)

    const scoped = perms.isScopedToOwn(formId, action)
    /* 標題欄直接查 field_def,不注入 MetadataService ——
       FormEngineModule 已單向 import AuthzModule,反向注入會成環(AGENTS:避免 forwardRef)。 */
    const table = physicalTableName(formId)

    return this.knex.transaction(async (trx) => {
      await trx.raw(`SELECT set_config('app.tenant_id', ?, true)`, [String(tenantId)])
      // 總數一律以 all 算 —— 「看得到 3 / 全部 120」才是管理員要的對比
      await trx.raw(`SELECT set_config('app.record_scope', 'all', true)`)
      await trx.raw(`SELECT set_config('app.actor_id', ?, true)`, [String(actorId)])
      const total = (await trx.raw(
        `SELECT count(*)::int AS n FROM ${DATA_SCHEMA}.?? WHERE deleted_at IS NULL`,
        [table],
      )) as { rows: { n: number }[] }

      if (!perms.canRead(formId)) {
        return {
          actorId,
          formId,
          scoped,
          visibleCount: 0,
          totalCount: total.rows[0]?.n ?? 0,
          samples: [],
        }
      }

      const titleRow = (await trx.raw(
        `SELECT id FROM public.field_def
          WHERE tenant_id = ? AND form_id = ? AND deleted_at IS NULL AND cell_value_type = 'text'
          ORDER BY position LIMIT 1`,
        [tenantId, formId],
      )) as { rows: { id: number }[] }
      const titleField = titleRow.rows[0]
      const titleCol = titleField === undefined ? "id::text" : `"f${String(titleField.id)}"`
      const rows = (await trx.raw(
        `SELECT id, ${titleCol} AS title,
                CASE WHEN created_by = ? THEN 'owner'
                     WHEN assignees @> ARRAY[?::bigint] THEN 'assigned'
                     ELSE 'unrestricted' END AS reason
           FROM ${DATA_SCHEMA}.??
          WHERE deleted_at IS NULL
            AND (NOT ? OR created_by = ? OR assignees @> ARRAY[?::bigint])
          ORDER BY id LIMIT 10`,
        [actorId, actorId, table, scoped, actorId, actorId],
      )) as { rows: { id: string; title: string | null; reason: AccessPreviewRow["reason"] }[] }

      const visible = (await trx.raw(
        `SELECT count(*)::int AS n FROM ${DATA_SCHEMA}.??
          WHERE deleted_at IS NULL
            AND (NOT ? OR created_by = ? OR assignees @> ARRAY[?::bigint])`,
        [table, scoped, actorId, actorId],
      )) as { rows: { n: number }[] }

      return {
        actorId,
        formId,
        scoped,
        visibleCount: visible.rows[0]?.n ?? 0,
        totalCount: total.rows[0]?.n ?? 0,
        samples: rows.rows.map((r) => ({
          /* pg driver 把 bigint 當字串回 —— 不轉的話前端 schema 解析失敗(實走時發現) */
          recordId: Number(r.id),
          title: r.title ?? `#${String(r.id)}`,
          reason: r.reason,
        })),
      }
    })
  }
}
