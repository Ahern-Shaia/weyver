import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common"
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { AuthzAdminService } from "../src/authz/authz-admin.service.js"
import { AuthzRepository } from "../src/authz/authz.repository.js"
import { type DrizzleDb, TenantDb, createDrizzle } from "../src/db/db.module.js"
import { runMigrations } from "../src/db/migrate.js"
import { fieldDefs, formDefs, tenants, users } from "../src/db/schema.js"
import { PG_TEST_IMAGE } from "./pg-image.js"

let container: StartedPostgreSqlContainer
let pool: pg.Pool
let db: DrizzleDb
let admin: AuthzAdminService
let repo: AuthzRepository
let tenantA = 0
let tenantB = 0
let actorX = 0
let formA = 0
let fieldA = 0

function need<T>(v: T | undefined | null, m: string): T {
  if (v === undefined || v === null) throw new Error(m)
  return v
}

beforeAll(async () => {
  container = await new PostgreSqlContainer(PG_TEST_IMAGE).start()
  pool = new pg.Pool({ connectionString: container.getConnectionUri(), max: 5 })
  await runMigrations(pool)
  db = createDrizzle(pool)
  repo = new AuthzRepository(db, new TenantDb(db))
  admin = new AuthzAdminService(repo)

  const t = await db
    .insert(tenants)
    .values([
      { name: "A", authOrgId: "o_A" },
      { name: "B", authOrgId: "o_B" },
    ])
    .returning({ id: tenants.id })
  tenantA = need(t[0], "A").id
  tenantB = need(t[1], "B").id
  const u = await db
    .insert(users)
    .values({ authUserId: "x", email: "x@t", name: "x" })
    .returning({ id: users.id })
  actorX = need(u[0], "x").id
  const f = await db
    .insert(formDefs)
    .values({ tenantId: tenantA, name: "採購單" })
    .returning({ id: formDefs.id })
  formA = need(f[0], "f").id
  const fd = await db
    .insert(fieldDefs)
    .values({
      formId: formA,
      tenantId: tenantA,
      name: "金額",
      cellValueType: "money",
      dbFieldType: "numeric",
      position: 0,
    })
    .returning({ id: fieldDefs.id })
  fieldA = need(fd[0], "fd").id

  await repo.seedSystemRoles(tenantA)
  await repo.seedSystemRoles(tenantB)
})

afterAll(async () => {
  await pool?.end()
  await container?.stop()
})

describe("AuthzAdminService — 權限管理後台(P0-4a M5)", () => {
  it("建角色 + 列表含之", async () => {
    const role = await admin.createRole(tenantA, { key: "buyer", name: "採購", parentId: null })
    expect(role.isSystem).toBe(false)
    const list = await admin.listRoles(tenantA)
    expect(list.some((r) => r.key === "buyer")).toBe(true)
  })

  it("重複 key → 409 ConflictException", async () => {
    await expect(
      admin.createRole(tenantA, { key: "buyer", name: "又一個", parentId: null }),
    ).rejects.toBeInstanceOf(ConflictException)
  })

  it("parent 不存在 → 400 BadRequestException", async () => {
    await expect(
      admin.createRole(tenantA, { key: "orphan", name: "孤", parentId: 999999 }),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it("刪系統角色 → 400;刪有子角色 → 409;刪葉節點 → ok", async () => {
    const roles = await admin.listRoles(tenantA)
    const adminRole = need(
      roles.find((r) => r.key === "admin"),
      "admin",
    )
    await expect(admin.deleteRole(tenantA, adminRole.id)).rejects.toBeInstanceOf(
      BadRequestException,
    )

    const parent = await admin.createRole(tenantA, { key: "dept", name: "部", parentId: null })
    const child = await admin.createRole(tenantA, {
      key: "dept_child",
      name: "組",
      parentId: parent.id,
    })
    await expect(admin.deleteRole(tenantA, parent.id)).rejects.toBeInstanceOf(ConflictException)
    await admin.deleteRole(tenantA, child.id)
    expect((await admin.listRoles(tenantA)).some((r) => r.key === "dept_child")).toBe(false)
  })

  it("reparent 成環 → 400 BadRequestException", async () => {
    const p = await admin.createRole(tenantA, { key: "p", name: "p", parentId: null })
    const c = await admin.createRole(tenantA, { key: "c", name: "c", parentId: p.id })
    await expect(admin.setRoleParent(tenantA, p.id, c.id)).rejects.toBeInstanceOf(
      BadRequestException,
    )
  })

  it("跨租戶角色操作 → 404 NotFoundException", async () => {
    const bRoles = await admin.listRoles(tenantB)
    const bAdmin = need(
      bRoles.find((r) => r.key === "admin"),
      "bAdmin",
    )
    // 用 tenantA 操作 B 的角色 → 當作不存在
    await expect(admin.setFormActions(tenantA, bAdmin.id, formA, ["view"])).rejects.toBeInstanceOf(
      NotFoundException,
    )
  })

  it("設表單/欄位權限 + 指派成員 → getRolePermissions 反映", async () => {
    const role = await admin.createRole(tenantA, { key: "viewer2", name: "檢視2", parentId: null })
    await admin.setFormActions(tenantA, role.id, formA, ["view", "export"])
    await admin.setFieldPermission(tenantA, role.id, fieldA, "hidden")
    await admin.assignMember(tenantA, role.id, actorX)

    const view = await admin.getRolePermissions(tenantA, role.id)
    expect(view.forms).toEqual([{ formId: formA, actions: ["view", "export"], scopedActions: [] }])
    expect(view.fields).toEqual([{ fieldId: fieldA, visibility: "hidden" }])
    expect(view.memberActorIds).toEqual([actorX])
  })
})

describe("AuthzAdminService — 資源軸繼承管理(P0-4a·uplift M3)", () => {
  it("建分類 + 列表;重複名 → 409", async () => {
    const cat = await admin.createCategory(tenantA, "採購 · 進銷存")
    expect(cat.position).toBe(0)
    expect((await admin.listCategories(tenantA)).some((c) => c.id === cat.id)).toBe(true)
    await expect(admin.createCategory(tenantA, "採購 · 進銷存")).rejects.toBeInstanceOf(
      ConflictException,
    )
  })

  it("跨租戶分類操作 → 404(改名 / 刪除 / 授權)", async () => {
    const cat = need((await admin.listCategories(tenantA))[0], "cat")
    await expect(admin.updateCategory(tenantB, cat.id, { name: "x" })).rejects.toBeInstanceOf(
      NotFoundException,
    )
    await expect(admin.deleteCategory(tenantB, cat.id)).rejects.toBeInstanceOf(NotFoundException)
    const roleB = need(
      (await admin.listRoles(tenantB)).find((r) => r.key === "editor"),
      "editorB",
    )
    // 用 B 的 role + A 的 category → category 不在 B → 404
    await expect(
      admin.setCategoryActions(tenantB, roleB.id, cat.id, ["view"]),
    ).rejects.toBeInstanceOf(NotFoundException)
  })

  it("分類授權 → getRolePermissions.categories 反映", async () => {
    const cat = need((await admin.listCategories(tenantA))[0], "cat")
    const role = await admin.createRole(tenantA, {
      key: "cat_ed",
      name: "分類編輯",
      parentId: null,
    })
    await admin.setCategoryActions(tenantA, role.id, cat.id, ["view", "create"])
    const view = await admin.getRolePermissions(tenantA, role.id)
    expect(view.categories).toEqual([{ categoryId: cat.id, actions: ["view", "create"] }])
  })

  it("表單歸類 + 敏感旗標;壞 formId → 404;跨租戶 category → 404", async () => {
    const cat = need((await admin.listCategories(tenantA))[0], "cat")
    await admin.setFormCategory(tenantA, formA, cat.id)
    await admin.setFormSensitive(tenantA, formA, true)
    const res = await admin.getResources(tenantA)
    const row = need(
      res.forms.find((f) => f.id === formA),
      "formA",
    )
    expect(row.categoryId).toBe(cat.id)
    expect(row.isSensitive).toBe(true)
    expect(res.categories.some((c) => c.id === cat.id)).toBe(true)

    await expect(admin.setFormSensitive(tenantA, 999999, true)).rejects.toBeInstanceOf(
      NotFoundException,
    )
    // 他租戶 category 掛到本租戶表 → category 不在本租戶 → 404
    await expect(admin.setFormCategory(tenantB, formA, cat.id)).rejects.toBeInstanceOf(
      NotFoundException,
    )
  })

  it("刪分類 → 表 category 回 null(不孤兒)", async () => {
    const cat = need((await admin.listCategories(tenantA))[0], "cat")
    await admin.setFormCategory(tenantA, formA, cat.id)
    await admin.deleteCategory(tenantA, cat.id)
    const row = need(
      (await admin.getResources(tenantA)).forms.find((f) => f.id === formA),
      "formA",
    )
    expect(row.categoryId).toBeNull()
  })

  it("租戶預設 profile get/set", async () => {
    expect(await admin.getDefaultActions(tenantA)).toEqual([])
    await admin.setDefaultActions(tenantA, ["view"])
    expect(await admin.getDefaultActions(tenantA)).toEqual(["view"])
  })
})
