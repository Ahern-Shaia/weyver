import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { AuthzRepository, type RoleRow } from "../src/authz/authz.repository.js"
import { RoleCycleError } from "../src/authz/authz-tree.js"
import { type DrizzleDb, createDrizzle } from "../src/db/db.module.js"
import { runMigrations } from "../src/db/migrate.js"
import { fieldDefs, formDefs, tenants, users } from "../src/db/schema.js"

let container: StartedPostgreSqlContainer
let pool: pg.Pool
let db: DrizzleDb
let repo: AuthzRepository

let tenantA: number
let tenantB: number
let actorA: number
let actorB: number
let formA: number
let fieldA: number

function need<T>(value: T | undefined | null, msg: string): T {
  if (value === undefined || value === null) throw new Error(msg)
  return value
}

async function roleByKey(tenantId: number, key: string): Promise<RoleRow> {
  const found = (await repo.listRoles(tenantId)).find((r) => r.key === key)
  return need(found, `role ${key} not found in tenant ${tenantId}`)
}

async function insertTenant(name: string, org: string): Promise<number> {
  const r = await db.insert(tenants).values({ name, authOrgId: org }).returning({ id: tenants.id })
  return need(r[0], "insert tenant").id
}
async function insertUser(authUserId: string): Promise<number> {
  const r = await db
    .insert(users)
    .values({ authUserId, email: `${authUserId}@t.test`, name: authUserId })
    .returning({ id: users.id })
  return need(r[0], "insert user").id
}

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start()
  pool = new pg.Pool({ connectionString: container.getConnectionUri(), max: 5 })
  await runMigrations(pool)
  db = createDrizzle(pool)
  repo = new AuthzRepository(db)

  tenantA = await insertTenant("廠 A", "org_A")
  tenantB = await insertTenant("廠 B", "org_B")
  actorA = await insertUser("userA")
  actorB = await insertUser("userB")

  const f = await db
    .insert(formDefs)
    .values({ tenantId: tenantA, name: "採購單" })
    .returning({ id: formDefs.id })
  formA = need(f[0], "insert form").id
  const fd = await db
    .insert(fieldDefs)
    .values({
      formId: formA,
      tenantId: tenantA,
      name: "amount",
      cellValueType: "money",
      dbFieldType: "numeric",
      position: 0,
    })
    .returning({ id: fieldDefs.id })
  fieldA = need(fd[0], "insert field").id
}, 120_000)

afterAll(async () => {
  await pool?.end()
  await container?.stop()
})

describe("AuthzRepository — 種子 / role tree / 權限(P0-4a M1)", () => {
  it("seedSystemRoles 冪等:跑兩次仍恰 3 系統角色", async () => {
    await repo.seedSystemRoles(tenantA)
    await repo.seedSystemRoles(tenantA)
    const system = (await repo.listRoles(tenantA)).filter((r) => r.isSystem)
    expect(system.map((r) => r.key).sort()).toEqual(["admin", "editor", "viewer"])
  })

  it("isAdminActor:指派 admin 前 false,指派後 true", async () => {
    const admin = await roleByKey(tenantA, "admin")
    expect(await repo.isAdminActor(tenantA, actorA)).toBe(false)
    await repo.assignMember(tenantA, admin.id, actorA)
    expect(await repo.isAdminActor(tenantA, actorA)).toBe(true)
  })

  it("role tree:祖先閉包解析(專員→主管→部)", async () => {
    const dept = await repo.createRole({
      tenantId: tenantA,
      key: "buy_dept",
      name: "採購部",
      parentId: null,
    })
    const lead = await repo.createRole({
      tenantId: tenantA,
      key: "buy_lead",
      name: "採購主管",
      parentId: dept.id,
    })
    const staff = await repo.createRole({
      tenantId: tenantA,
      key: "buy_staff",
      name: "採購專員",
      parentId: lead.id,
    })
    expect(staff.depth).toBe(2)

    await repo.assignMember(tenantA, staff.id, actorB)
    const closure = await repo.resolveActorRoleIds(tenantA, actorB)
    expect(closure.sort((a, b) => a - b)).toEqual(
      [dept.id, lead.id, staff.id].sort((a, b) => a - b),
    )
  })

  it("form/field 權限 upsert + load(改寫覆蓋)", async () => {
    const lead = await roleByKey(tenantA, "buy_lead")
    await repo.setFormPermission(lead.id, formA, "read")
    await repo.setFormPermission(lead.id, formA, "write") // upsert 覆蓋
    await repo.setFieldPermission(lead.id, fieldA, "hidden")

    expect(await repo.loadFormPermissions([lead.id])).toEqual([
      { roleId: lead.id, formId: formA, level: "write" },
    ])
    expect(await repo.loadFieldPermissions([lead.id])).toEqual([
      { roleId: lead.id, fieldId: fieldA, visibility: "hidden" },
    ])
  })

  it("跨租戶:B 種子獨立,A 的角色不入 B 的解析", async () => {
    await repo.seedSystemRoles(tenantB)
    const adminB = await roleByKey(tenantB, "admin")
    await repo.assignMember(tenantB, adminB.id, actorB)
    const closureB = await repo.resolveActorRoleIds(tenantB, actorB)
    // B 的解析只含 B 的 admin,不含 A 指派給 actorB 的採購專員鏈
    expect(closureB).toEqual([adminB.id])
    // 且 A 租戶 scope 查不到 B 的角色
    expect(await repo.getRole(tenantA, adminB.id)).toBeNull()
  })

  it("reparent 防環:把祖先掛到後代之下 → RoleCycleError", async () => {
    const dept = await roleByKey(tenantA, "buy_dept")
    const staff = await roleByKey(tenantA, "buy_staff")
    await expect(repo.setRoleParent(tenantA, dept.id, staff.id)).rejects.toBeInstanceOf(
      RoleCycleError,
    )
  })

  it("createRole:跨租戶 parent 被拒(parent 不在本租戶)", async () => {
    const deptA = await roleByKey(tenantA, "buy_dept")
    await expect(
      repo.createRole({ tenantId: tenantB, key: "x", name: "x", parentId: deptA.id }),
    ).rejects.toThrow()
  })
})
