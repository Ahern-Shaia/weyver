import { ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common"
import { and, asc, eq, isNull } from "drizzle-orm"
import type { EffectivePermissions } from "../../authz/authz-effective.js"
import { AuthzRepository } from "../../authz/authz.repository.js"
import { DRIZZLE, type DrizzleDb } from "../../db/db.module.js"
import { widgetDefs } from "../../db/schema.js"
import { MetadataService } from "../metadata/metadata.service.js"
import type { CreateWidgetBody, WidgetDto } from "./widget-specs.js"

/* 🔴 F-2 M4|小圖表(widget)。

   三條已裁定的 OQ 各自對應本檔的一段:

   **OQ-PC-10 = A|列表頁的 widget 吃當下檢視的篩選**,優先序
   固定篩選 > 使用者篩選 > widget 自身。本服務只負責回 widget 定義,
   **合併由前端在送查詢時做** —— 因為「當下的使用者篩選」只有前端知道。
   ⚠️ 表單頁 / 首頁**沒有中間那層**(Ragic doc/122 明列),故 `placement` 是語意欄不是裝飾。

   **OQ-PC-11 = A|設計期擋 + 執行期 fail-closed 雙保險**。
   設計期那半由 `toFormDto` 過欄位權限達成(欄位候選清單本來就選不到);
   執行期那半在此:回 widget 前**再驗一次維度與聚合欄的可見性** ——
   因為「建完圖之後才收回權限」正是權限收回的常態。
   ⚠️ **錯誤要具名**(照 Salesforce),不能只回空白圖:空白圖會被當成「沒資料」。

   **OQ-PC-12 = A|可見群組候選先被來源表單權限過濾**。
   這讓 widget 的可見群組**結構上不可能成為提權路徑** ——
   你選不到一個對來源表單沒權限的角色。 */
@Injectable()
export class WidgetService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    @Inject(MetadataService) private readonly metadata: MetadataService,
    @Inject(AuthzRepository) private readonly authz: AuthzRepository,
  ) {}

  async list(
    tenantId: number,
    formId: number,
    placement: "list" | "form",
    permissions: EffectivePermissions,
    roleIds: readonly number[],
  ): Promise<WidgetDto[]> {
    const rows = await this.db
      .select()
      .from(widgetDefs)
      .where(
        and(
          eq(widgetDefs.tenantId, tenantId),
          eq(widgetDefs.formId, formId),
          eq(widgetDefs.placement, placement),
          isNull(widgetDefs.deletedAt),
        ),
      )
      .orderBy(asc(widgetDefs.position), asc(widgetDefs.id))

    const loaded = await this.metadata.getForm(tenantId, formId)
    const visibleFieldNames = new Set(
      loaded.fields
        .filter((f) => permissions.fieldVisibility(f.id, formId) !== "hidden")
        .map((f) => f.name),
    )

    return rows
      .filter((w) => this.canSee(w.visibleRoleIds, roleIds))
      .map((w) => ({
        id: w.id,
        name: w.name,
        chartType: w.chartType as WidgetDto["chartType"],
        dimension: w.dimension,
        measure:
          w.measureFn === null || w.measureField === null
            ? null
            : { fn: w.measureFn, field: w.measureField },
        ownFilter: w.ownFilter as WidgetDto["ownFilter"],
        placement: w.placement as WidgetDto["placement"],
        visibleRoleIds: w.visibleRoleIds,
        /* 🔴 執行期 fail-closed 之**具名**結果(OQ-PC-11)。
           不在此直接丟掉 widget —— 使用者建了一張圖卻整個消失,他會以為系統壞了。
           回一個講得出原因的殼,由前端顯示「因為你對『成本』沒有存取權,此圖無法顯示」。 */
        unavailableReason: this.reasonFor(w, visibleFieldNames),
      }))
  }

  /* 空 = 依來源表單權限(Ragic 語意),**不是**「所有人可見」——
     來源表單的權限已由 `@RequiresFormAction("view")` 在進到這裡之前擋過。 */
  private canSee(widgetRoles: readonly number[], myRoles: readonly number[]): boolean {
    if (widgetRoles.length === 0) return true
    return widgetRoles.some((r) => myRoles.includes(r))
  }

  private reasonFor(
    w: { dimension: string; measureField: string | null },
    visible: ReadonlySet<string>,
  ): string | null {
    if (!visible.has(w.dimension)) return `無法顯示:你對分組欄位「${w.dimension}」沒有存取權`
    if (w.measureField !== null && !visible.has(w.measureField)) {
      return `無法顯示:你對統計欄位「${w.measureField}」沒有存取權`
    }
    return null
  }

  /* OQ-PC-12 = A|可見群組的候選清單。**先被來源表單權限過濾** ——
     Ragic 官方逐字:「可檢視群組會列出對來源表單具有表單權限的群組」。
     這讓 widget 的可見群組結構上不可能放寬權限:選不到就設不了。 */
  async visibleRoleCandidates(
    tenantId: number,
    formId: number,
  ): Promise<{ id: number; name: string }[]> {
    const roles = await this.authz.listRoles(tenantId)
    const out: { id: number; name: string }[] = []
    for (const role of roles) {
      const perms = await this.authz.loadFormPermissions([role.id])
      const catPerms = await this.authz.loadCategoryPermissions([role.id])
      const meta = (await this.authz.loadFormMeta(tenantId)).find((m) => m.formId === formId)
      const direct = perms.find((p) => p.formId === formId)?.actions ?? []
      const inherited =
        meta?.categoryId === null || meta === undefined
          ? []
          : (catPerms.find((c) => c.categoryId === meta.categoryId)?.actions ?? [])
      if (direct.includes("view") || inherited.includes("view")) {
        out.push({ id: role.id, name: role.name })
      }
    }
    return out
  }

  async create(
    tenantId: number,
    formId: number,
    body: CreateWidgetBody,
    actorId: number,
  ): Promise<{ id: number }> {
    /* 建立時把可見群組再過一次候選 —— 前端過濾只是可用性,**後端才是執法** */
    const allowed = new Set((await this.visibleRoleCandidates(tenantId, formId)).map((r) => r.id))
    const bad = body.visibleRoleIds.filter((r) => !allowed.has(r))
    if (bad.length > 0) {
      throw new ForbiddenException({
        code: "WIDGET_ROLE_NOT_ELIGIBLE",
        message: `角色 ${bad.join("、")} 對來源表單沒有檢視權,不能設為此圖的可檢視群組`,
      })
    }
    const [row] = await this.db
      .insert(widgetDefs)
      .values({
        tenantId,
        formId,
        name: body.name,
        chartType: body.chartType,
        dimension: body.dimension,
        measureFn: body.measure?.fn ?? null,
        measureField: body.measure?.field ?? null,
        ownFilter: body.ownFilter,
        placement: body.placement,
        position: body.position,
        visibleRoleIds: [...body.visibleRoleIds],
        createdBy: actorId,
      })
      .returning({ id: widgetDefs.id })
    if (row === undefined) throw new NotFoundException({ code: "WIDGET_CREATE_FAILED" })
    return { id: row.id }
  }

  async remove(tenantId: number, widgetId: number): Promise<void> {
    await this.db
      .update(widgetDefs)
      .set({ deletedAt: new Date() })
      .where(and(eq(widgetDefs.tenantId, tenantId), eq(widgetDefs.id, widgetId)))
  }
}
