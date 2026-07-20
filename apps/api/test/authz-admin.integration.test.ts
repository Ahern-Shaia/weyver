import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common"
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { AuthzAdminService } from "../src/authz/authz-admin.service.js"
import { AuthzRepository } from "../src/authz/authz.repository.js"
import { type DrizzleDb, createDrizzle } from "../src/db/db.module.js"
import { runMigrations } from "../src/db/migrate.js"
import { fieldDefs, formDefs, tenants, users } from "../src/db/schema.js"

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
  container = await new PostgreSqlContainer("postgres:16-alpine").start()
  pool = new pg.Pool({ connectionString: container.getConnectionUri(), max: 5 })
  await runMigrations(pool)
  db = createDrizzle(pool)
  repo = new AuthzRepository(db)
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
    await expect(admin.setFormPermission(tenantA, bAdmin.id, formA, "read")).rejects.toBeInstanceOf(
      NotFoundException,
    )
  })

  it("設表單/欄位權限 + 指派成員 → getRolePermissions 反映", async () => {
    const role = await admin.createRole(tenantA, { key: "viewer2", name: "檢視2", parentId: null })
    await admin.setFormPermission(tenantA, role.id, formA, "read")
    await admin.setFieldPermission(tenantA, role.id, fieldA, "hidden")
    await admin.assignMember(tenantA, role.id, actorX)

    const view = await admin.getRolePermissions(tenantA, role.id)
    expect(view.forms).toEqual([{ formId: formA, level: "read" }])
    expect(view.fields).toEqual([{ fieldId: fieldA, visibility: "hidden" }])
    expect(view.memberActorIds).toEqual([actorX])
  })
})
