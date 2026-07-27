import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import { eq } from "drizzle-orm"
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { AuthzRepository } from "../src/authz/authz.repository.js"
import { PermissionService } from "../src/authz/permission.service.js"
import { createDrizzle, type DrizzleDb, TenantDb } from "../src/db/db.module.js"
import { runMigrations } from "../src/db/migrate.js"
import { formDefs, tenants, users } from "../src/db/schema.js"

/* P0-4a·uplift M1|資源軸繼承資料層(分類 / 分類授權 / 表單 metadata / 租戶預設 profile)。 */

let container: StartedPostgreSqlContainer
let pool: pg.Pool
let db: DrizzleDb
let repo: AuthzRepository

let tenantA: number
let tenantB: number
let actorA: number

function need<T>(value: T | undefined | null, msg: string): T {
  if (value === undefined || value === null) throw new Error(msg)
  return value
}

async function insertForm(tenantId: number, name: string, createdBy?: number): Promise<number> {
  const r = await db
    .insert(formDefs)
    .values({ tenantId, name, createdBy: createdBy ?? null })
    .returning({ id: formDefs.id })
  return need(r[0], "insert form").id
}

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start()
  pool = new pg.Pool({ connectionString: container.getConnectionUri(), max: 5 })
  await runMigrations(pool)
  db = createDrizzle(pool)
  repo = new AuthzRepository(db, new TenantDb(db))

  const tA = await db.insert(tenants).values({ name: "廠 A", authOrgId: "org_A" }).returning()
  tenantA = need(tA[0], "tenant A").id
  const tB = await db.insert(tenants).values({ name: "廠 B", authOrgId: "org_B" }).returning()
  tenantB = need(tB[0], "tenant B").id
  const uA = await db
    .insert(users)
    .values({ authUserId: "uA", email: "a@t.test", name: "A" })
    .returning({ id: users.id })
  actorA = need(uA[0], "user A").id
}, 120_000)

afterAll(async () => {
  await pool?.end()
  await container?.stop()
})

describe("分類 CRUD", () => {
  it("createCategory append position 遞增;listCategories 依 position 排序", async () => {
    const buy = await repo.createCategory(tenantA, "採購 · 進銷存")
    const acc = await repo.createCategory(tenantA, "財會 · 計算層")
    expect(buy.position).toBe(0)
    expect(acc.position).toBe(1)
    const list = await repo.listCategories(tenantA)
    expect(list.map((c) => c.name)).toEqual(["採購 · 進銷存", "財會 · 計算層"])
  })

  it("unique(tenant,name):同租戶同名 → 拒", async () => {
    await expect(repo.createCategory(tenantA, "採購 · 進銷存")).rejects.toThrow()
  })

  it("getCategory 租戶 scope:他租戶分類回 null", async () => {
    const buy = need((await repo.listCategories(tenantA))[0], "buy")
    expect(await repo.getCategory(tenantA, buy.id)).not.toBeNull()
    expect(await repo.getCategory(tenantB, buy.id)).toBeNull()
  })

  it("updateCategory 改名 + 排序", async () => {
    const acc = need(
      (await repo.listCategories(tenantA)).find((c) => c.name.startsWith("財會")),
      "acc",
    )
    await repo.updateCategory(tenantA, acc.id, { name: "財會", position: 5 })
    const reloaded = await repo.getCategory(tenantA, acc.id)
    expect(reloaded?.name).toBe("財會")
    expect(reloaded?.position).toBe(5)
  })
})

describe("分類授權(繼承層)", () => {
  it("setCategoryActions upsert 覆蓋;loadCategoryPermissions 依 roleIds", async () => {
    await repo.seedSystemRoles(tenantA)
    const editor = need(
      (await repo.listRoles(tenantA)).find((r) => r.key === "editor"),
      "editor role",
    )
    const buy = need((await repo.listCategories(tenantA))[0], "buy")
    await repo.setCategoryActions(editor.id, buy.id, ["view"])
    await repo.setCategoryActions(editor.id, buy.id, ["view", "create", "edit"]) // upsert
    expect(await repo.loadCategoryPermissions([editor.id])).toEqual([
      { roleId: editor.id, categoryId: buy.id, actions: ["view", "create", "edit"] },
    ])
    // 其他 role 無列
    expect(await repo.loadCategoryPermissions([999999])).toEqual([])
  })

  it("空集 = 撤銷 → 刪列", async () => {
    const editor = need(
      (await repo.listRoles(tenantA)).find((r) => r.key === "editor"),
      "editor",
    )
    const buy = need((await repo.listCategories(tenantA))[0], "buy")
    await repo.setCategoryActions(editor.id, buy.id, [])
    expect(await repo.loadCategoryPermissions([editor.id])).toEqual([])
  })
})

describe("表單 metadata + owner + 敏感 + 預設 profile", () => {
  it("loadFormMeta 回 category/sensitive/createdBy;created_by 保存 owner", async () => {
    const buy = need((await repo.listCategories(tenantA))[0], "buy")
    const owned = await insertForm(tenantA, "採購單", actorA)
    await db.update(formDefs).set({ categoryId: buy.id }).where(eq(formDefs.id, owned))
    const meta = await repo.loadFormMeta(tenantA)
    const row = need(
      meta.find((m) => m.formId === owned),
      "meta row",
    )
    expect(row.createdBy).toBe(actorA)
    expect(row.categoryId).toBe(buy.id)
    expect(row.isSensitive).toBe(false)
  })

  it("setFormSensitive 切換;跨租戶 no-op 回 false", async () => {
    const form = need((await repo.loadFormMeta(tenantA))[0], "form")
    expect(await repo.setFormSensitive(tenantA, form.formId, true)).toBe(true)
    const after = need(
      (await repo.loadFormMeta(tenantA)).find((m) => m.formId === form.formId),
      "after",
    )
    expect(after.isSensitive).toBe(true)
    // 他租戶操作本租戶表 → 不更新,回 false
    expect(await repo.setFormSensitive(tenantB, form.formId, false)).toBe(false)
  })

  it("deleteCategory → form_def.category_id SET NULL(表回退未分類,不孤兒)", async () => {
    const buy = need(
      (await repo.listCategories(tenantA)).find((c) => c.name.startsWith("採購")),
      "buy",
    )
    const before = need(
      (await repo.loadFormMeta(tenantA)).find((m) => m.categoryId === buy.id),
      "categorized form",
    )
    await repo.deleteCategory(tenantA, buy.id)
    const after = need(
      (await repo.loadFormMeta(tenantA)).find((m) => m.formId === before.formId),
      "after",
    )
    expect(after.categoryId).toBeNull()
  })

  it("租戶預設 profile:預設空;set 後 get 回動作集", async () => {
    expect(await repo.getTenantDefaultActions(tenantA)).toEqual([])
    await repo.setTenantDefaultActions(tenantA, ["view"])
    expect(await repo.getTenantDefaultActions(tenantA)).toEqual(["view"])
    // 未知動作被 isFormAction 過濾(set 端已去重,get 端過濾非法值)
    await repo.setTenantDefaultActions(tenantA, ["view", "create"])
    expect(await repo.getTenantDefaultActions(tenantA)).toEqual(["view", "create"])
  })
})

describe("PermissionService 分層解析(端到端,真 PG)", () => {
  it("owner / 分類繼承 / 預設 profile / 敏感 全鏈", async () => {
    const svc = new PermissionService(repo)
    // 乾淨 scenario 用 tenantB
    await repo.seedSystemRoles(tenantB)
    const editor = need(
      (await repo.listRoles(tenantB)).find((r) => r.key === "editor"),
      "editor B",
    )
    const staff = need(
      (await db.insert(users).values({ authUserId: "uB2", email: "b2@t.test" }).returning())[0],
      "staff",
    ).id
    await repo.assignMember(tenantB, editor.id, staff)

    const catB = await repo.createCategory(tenantB, "採購B")
    await repo.setCategoryActions(editor.id, catB.id, ["view", "create"])

    const fCat = await insertForm(tenantB, "分類表")
    await db.update(formDefs).set({ categoryId: catB.id }).where(eq(formDefs.id, fCat))
    const fOwner = await insertForm(tenantB, "自建表", actorA)
    const fSens = await insertForm(tenantB, "敏感表")
    await db
      .update(formDefs)
      .set({ categoryId: catB.id, isSensitive: true })
      .where(eq(formDefs.id, fSens))
    const fFree = await insertForm(tenantB, "未分類表")

    // staff(editor):分類繼承 fCat;fOwner/fFree/fSens 皆無權
    const pStaff = await svc.resolveForActor(tenantB, staff)
    expect(pStaff.canRead(fCat)).toBe(true)
    expect(pStaff.hasAction(fCat, "create")).toBe(true)
    expect(pStaff.hasAction(fCat, "edit")).toBe(false)
    expect(pStaff.canRead(fFree)).toBe(false)
    expect(pStaff.canRead(fSens)).toBe(false) // 敏感表在授權分類下仍 deny

    // 設租戶預設 view → 未分類非敏感表可讀,敏感表仍 deny;fCat 三態不變
    await repo.setTenantDefaultActions(tenantB, ["view"])
    const pStaff2 = await svc.resolveForActor(tenantB, staff)
    expect(pStaff2.canRead(fFree)).toBe(true)
    expect(pStaff2.canRead(fSens)).toBe(false)
    const { readable, locked } = pStaff2.listableForms([fCat, fFree, fSens, fOwner])
    expect(readable.sort((a, b) => a - b)).toEqual([fCat, fFree, fOwner].sort((a, b) => a - b))
    expect(locked).toEqual([]) // fSens 隱藏;其餘皆可讀(fOwner 走預設)
    expect(pStaff2.listableForms([fSens]).locked).toEqual([]) // 敏感無權 → 不入 locked(隱藏)

    // actorA 為 fOwner 建立者 → 資料動作,design 除外
    const pOwner = await svc.resolveForActor(tenantB, actorA)
    expect(pOwner.hasAction(fOwner, "edit")).toBe(true)
    expect(pOwner.hasAction(fOwner, "design")).toBe(false)
  })
})
