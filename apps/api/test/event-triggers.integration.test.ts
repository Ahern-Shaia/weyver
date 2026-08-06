import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify"
import { Test } from "@nestjs/testing"
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { AuthzRepository } from "../src/authz/authz.repository.js"
import { createDrizzle } from "../src/db/db.module.js"
import { runMigrations } from "../src/db/migrate.js"
import { tenants, users } from "../src/db/schema.js"
import { PG_TEST_IMAGE } from "./pg-image.js"

/* 🔴 R1·C-4|事件觸發器。

   ## 這個模組最容易「看起來對但其實沒接上」

   觸發器的設定存進去了、清單也讀得出來、設計器畫得漂亮 ——
   **而存檔時根本沒跑**。那是完全無聲的:沒有錯誤、沒有紅字,
   只有使用者三天後說「它好像沒有反應」。

   所以本檔的重點不在 CRUD,在**存了一筆記錄之後值有沒有變**。

   ## 逐條釘什麼

   1. 建立時觸發 —— 存進去的值是觸發器算過的
   2. 🔴 **只有一筆修改紀錄** —— 證明它改的是「即將寫入的值」而非「寫完再改一次」
   3. 條件不符時不動
   4. 「更新時 + 指定欄位」—— 沒動那一欄就不該觸發
   5. 🔴 **繞過欄位級寫入權限只限觸發器自己設的欄位**(不是整包放行)
   6. 順序:後面的觸發器看得到前面的結果 */

let container: StartedPostgreSqlContainer
let pool: pg.Pool
let app: NestFastifyApplication
let tenantA = 0
let limitedActor = 0

const H = (): Record<string, string> => ({ "x-dev-tenant": String(tenantA) })

beforeAll(async () => {
  container = await new PostgreSqlContainer(PG_TEST_IMAGE).start()
  pool = new pg.Pool({ connectionString: container.getConnectionUri(), max: 5 })
  await runMigrations(pool)
  const db = createDrizzle(pool)
  tenantA =
    (
      await db
        .insert(tenants)
        .values([{ name: "廠 A" }])
        .returning()
    )[0]?.id ?? 0

  process.env.DATABASE_URL = container.getConnectionUri()
  process.env.APP_DATABASE_URL = container.getConnectionUri()
  const { AppModule } = await import("../src/app.module.js")
  app = (
    await Test.createTestingModule({ imports: [AppModule] }).compile()
  ).createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  await app.init()
  await app.getHttpAdapter().getInstance().ready()
  await app.get(AuthzRepository).seedSystemRoles(tenantA)
  const [u] = await db
    .insert(users)
    .values({ authUserId: "trig-limited", email: "trig-limited@t.test", name: "受限員工" })
    .returning({ id: users.id })
  limitedActor = u?.id ?? 0
}, 180_000)

afterAll(async () => {
  await app.close()
  await pool.end()
  await container.stop()
})

async function makeForm(name: string): Promise<number> {
  const res = await app.inject({
    method: "POST",
    url: "/api/forms",
    headers: H(),
    payload: {
      name,
      fields: [
        { name: "金額", type: "number" },
        { name: "狀態", type: "text" },
        { name: "備註", type: "text" },
      ],
    },
  })
  return (res.json() as { id: number }).id
}

async function makeTrigger(formId: number, body: Record<string, unknown>): Promise<number> {
  const res = await app.inject({
    method: "POST",
    url: `/api/forms/${String(formId)}/triggers`,
    headers: H(),
    payload: body,
  })
  expect(res.statusCode, res.body).toBe(201)
  return (res.json() as { id: number }).id
}

async function save(formId: number, values: Record<string, unknown>): Promise<number> {
  const res = await app.inject({
    method: "POST",
    url: `/api/forms/${String(formId)}/records`,
    headers: H(),
    payload: { values },
  })
  expect(res.statusCode, res.body).toBe(201)
  return (res.json() as { id: number }).id
}

async function patch(
  formId: number,
  recordId: number,
  values: Record<string, unknown>,
): Promise<void> {
  const cur = await app.inject({
    method: "GET",
    url: `/api/forms/${String(formId)}/records/${String(recordId)}`,
    headers: H(),
  })
  const version = (cur.json() as { version: number }).version
  const res = await app.inject({
    method: "PATCH",
    url: `/api/forms/${String(formId)}/records/${String(recordId)}`,
    headers: H(),
    payload: { expectedVersion: version, values },
  })
  expect(res.statusCode, res.body).toBe(200)
}

function revisionsOf(body: unknown): unknown[] {
  if (Array.isArray(body)) return body
  const r = (body as { revisions?: unknown }).revisions
  return Array.isArray(r) ? r : []
}

async function read(formId: number, recordId: number): Promise<Record<string, unknown>> {
  const res = await app.inject({
    method: "GET",
    url: `/api/forms/${String(formId)}/records/${String(recordId)}`,
    headers: H(),
  })
  return (res.json() as { values: Record<string, unknown> }).values
}

describe("事件觸發器", () => {
  it("🔴 建立時觸發:存進去的值是觸發器算過的", async () => {
    const formId = await makeForm("訂單A")
    await makeTrigger(formId, {
      name: "大額轉待審",
      onCreate: true,
      conditions: [{ field: "金額", op: "gt", value: 10000 }],
      config: {
        actionType: "updateSelf",
        setFields: { 狀態: { from: "literal", value: "待審" } },
      },
    })

    const big = await save(formId, { 金額: 50000, 狀態: "新建" })
    expect((await read(formId, big)).狀態).toBe("待審")
  })

  it("條件不符時不動", async () => {
    const formId = await makeForm("訂單B")
    await makeTrigger(formId, {
      name: "大額轉待審",
      onCreate: true,
      conditions: [{ field: "金額", op: "gt", value: 10000 }],
      config: {
        actionType: "updateSelf",
        setFields: { 狀態: { from: "literal", value: "待審" } },
      },
    })

    const small = await save(formId, { 金額: 100, 狀態: "新建" })
    expect((await read(formId, small)).狀態).toBe("新建")
  })

  /* 🔴 本檔最重要的一條。

     「寫完再改一次」的實作在功能上看起來一模一樣 —— 值最後也會變成「待審」。
     差別只在修改紀錄裡:那種實作會留下兩筆(使用者建立 + 系統修改),
     而且會多發一個 `record.updated` 事件(進而可能再觸發一次)。

     所以驗的是**修改紀錄的筆數**,不是值。 */
  it("🔴 只留一筆修改紀錄 —— 證明改的是「即將寫入的值」而非「寫完再改一次」", async () => {
    const formId = await makeForm("訂單C")
    await makeTrigger(formId, {
      name: "一律標記",
      onCreate: true,
      config: {
        actionType: "updateSelf",
        setFields: { 狀態: { from: "literal", value: "已標記" } },
      },
    })

    const id = await save(formId, { 金額: 1, 狀態: "新建" })
    const res = await app.inject({
      method: "GET",
      url: `/api/forms/${String(formId)}/records/${String(id)}/revisions`,
      headers: H(),
    })
    const list = revisionsOf(res.json())
    /* 建立本身可能記或不記,但**絕不能出現「建立之後又有一次系統修改」** */
    expect(list.length, JSON.stringify(list)).toBeLessThanOrEqual(1)

    /* 🔴 守衛的守衛:上面那條在「端點回的形狀跟我想的不一樣」時會**空過**
       (`list` 恆為空 → `<= 1` 恆真)。這裡證明同一支端點**數得出東西來** ——
       改一次之後至少要有一筆。沒有這一段,上面那條等於沒測。 */
    await patch(formId, id, { 金額: 2, 狀態: "已標記" })
    const after = await app.inject({
      method: "GET",
      url: `/api/forms/${String(formId)}/records/${String(id)}/revisions`,
      headers: H(),
    })
    expect(revisionsOf(after.json()).length, "修改紀錄端點要真的數得出東西").toBeGreaterThan(0)
  })

  it("更新時 + 指定欄位:沒動那一欄就不觸發", async () => {
    const formId = await makeForm("訂單D")
    const id = await save(formId, { 金額: 100, 狀態: "新建", 備註: "x" })
    await makeTrigger(formId, {
      name: "金額變了才重標",
      onUpdate: true,
      watchFields: ["金額"],
      config: {
        actionType: "updateSelf",
        setFields: { 狀態: { from: "literal", value: "已重算" } },
      },
    })

    /* 🔴 **每一次更新都斷言狀態碼**。第一版把路由寫成 `PUT` + `version`
       (實際是 `PATCH` + `expectedVersion`),於是更新根本沒發生 ——
       而「沒動那一欄就不觸發」這條**照樣通過**,因為什麼都沒變。
       否定斷言最容易空過的形態就是這個:前置動作失敗了而沒有人檢查。 */
    await patch(formId, id, { 金額: 100, 狀態: "新建", 備註: "y" })
    expect((await read(formId, id)).備註, "前置的更新本身要成功").toBe("y")
    expect((await read(formId, id)).狀態).toBe("新建")

    // 改金額 → 該觸發
    await patch(formId, id, { 金額: 999, 狀態: "新建", 備註: "y" })
    expect((await read(formId, id)).狀態).toBe("已重算")
  })

  it("順序:後面的觸發器看得到前面的結果", async () => {
    const formId = await makeForm("訂單E")
    await makeTrigger(formId, {
      name: "第一步",
      onCreate: true,
      config: {
        actionType: "updateSelf",
        setFields: { 狀態: { from: "literal", value: "階段一" } },
      },
    })
    await makeTrigger(formId, {
      name: "第二步:看得到第一步",
      onCreate: true,
      conditions: [{ field: "狀態", op: "eq", value: "階段一" }],
      config: {
        actionType: "updateSelf",
        setFields: { 備註: { from: "field", field: "狀態" } },
      },
    })

    const id = await save(formId, { 金額: 1, 狀態: "新建" })
    const values = await read(formId, id)
    expect(values.狀態).toBe("階段一")
    /* 🔴 第二條的條件對的是**第一條跑完之後**的值。
       若求值用的是原始輸入,這裡會是 undefined —— 那才是「規則清單順序無意義」。 */
    expect(values.備註).toBe("階段一")
  })

  /* 🔴 觸發器**豁免欄位級寫入權限,但只限它自己設的欄位**。

     這一條測的是豁免的**邊界**,不是豁免本身。整包放行的實作在功能上
     看起來一模一樣 —— 差別只在使用者送上來的欄位也一起被放行了,
     那就從「設計者授權的自動化」變成「任何人都能寫任何欄位」。

     ⚠️ 用真實授權(`x-dev-real-authz`)+ 一位只有部分欄位可寫的 actor:
     只有一位 actor 的測試表達不出授權缺口。 */
  it("🔴 豁免只給觸發器設的欄位,使用者自己送的照擋", async () => {
    const formId = await makeForm("訂單I")
    await makeTrigger(formId, {
      name: "設狀態",
      onCreate: true,
      config: {
        actionType: "updateSelf",
        setFields: { 狀態: { from: "literal", value: "系統設定" } },
      },
    })

    const detail = await app.inject({
      method: "GET",
      url: `/api/forms/${String(formId)}`,
      headers: H(),
    })
    const defs = (detail.json() as { fields: { id: number; name: string }[] }).fields
    const 狀態Id = defs.find((f) => f.name === "狀態")?.id ?? 0
    const 備註Id = defs.find((f) => f.name === "備註")?.id ?? 0
    const 金額Id = defs.find((f) => f.name === "金額")?.id ?? 0
    expect(狀態Id * 備註Id * 金額Id, "測試前提:三個欄位都要找得到").toBeGreaterThan(0)

    const authz = app.get(AuthzRepository)
    const role = await authz.createRole({
      tenantId: tenantA,
      key: `limited_${String(狀態Id)}`,
      name: "受限角色",
      parentId: null,
    })
    await authz.setFormActions(role.id, formId, ["view", "create", "edit"])
    await authz.assignMember(tenantA, role.id, limitedActor)
    /* 狀態與備註都唯讀;金額可寫 */
    await authz.setFieldPermission(role.id, 狀態Id, "read")
    await authz.setFieldPermission(role.id, 備註Id, "read")
    await authz.setFieldPermission(role.id, 金額Id, "write")

    const LIMITED = {
      "x-dev-tenant": String(tenantA),
      "x-dev-actor": String(limitedActor),
      "x-dev-real-authz": "1",
    }

    /* ① 只送可寫的欄位 → 成功,而且**狀態被觸發器寫進去了**(豁免生效) */
    const ok = await app.inject({
      method: "POST",
      url: `/api/forms/${String(formId)}/records`,
      headers: LIMITED,
      payload: { values: { 金額: 5 } },
    })
    expect(ok.statusCode, ok.body).toBe(201)
    const created = await read(formId, (ok.json() as { id: number }).id)
    expect(created.狀態, "觸發器設的欄位要繞得過欄位權限").toBe("系統設定")

    /* ② 🔴 使用者自己送一個唯讀欄位 → 照擋。
       豁免若是整包放行,這一條會變成 201 而沒有人發現。 */
    const denied = await app.inject({
      method: "POST",
      url: `/api/forms/${String(formId)}/records`,
      headers: LIMITED,
      payload: { values: { 金額: 5, 備註: "我不該寫得進去" } },
    })
    expect(denied.statusCode, denied.body).toBe(403)
  })

  it("試跑不寫入", async () => {
    const formId = await makeForm("訂單F")
    await makeTrigger(formId, {
      name: "大額轉待審",
      onCreate: true,
      conditions: [{ field: "金額", op: "gt", value: 10000 }],
      config: {
        actionType: "updateSelf",
        setFields: { 狀態: { from: "literal", value: "待審" } },
      },
    })

    const res = await app.inject({
      method: "POST",
      url: `/api/forms/${String(formId)}/triggers/dry-run`,
      headers: H(),
      payload: { values: { 金額: 50000, 狀態: "新建" } },
    })
    expect(res.statusCode, res.body).toBe(200)
    expect((res.json() as { values: Record<string, unknown> }).values.狀態).toBe("待審")

    const list = await app.inject({
      method: "GET",
      url: `/api/forms/${String(formId)}/records`,
      headers: H(),
    })
    expect((list.json() as { records: unknown[] }).records).toHaveLength(0)
  })

  /* 🔴 `openUrl` 在按鈕是合法動作,在觸發器不是 —— 沒有人在場。
     schema 擋得住,不能只靠 DB CHECK(錯誤訊息會變成 500)。 */
  it("🔴 `openUrl` 不是合法的觸發器動作", async () => {
    const formId = await makeForm("訂單G")
    const res = await app.inject({
      method: "POST",
      url: `/api/forms/${String(formId)}/triggers`,
      headers: H(),
      payload: {
        name: "開網址",
        onCreate: true,
        config: { actionType: "openUrl", url: "https://example.com" },
      },
    })
    expect(res.statusCode).toBe(400)
  })

  it("兩個時機都沒選 → 擋掉(永遠不會跑的觸發器是設定錯誤)", async () => {
    const formId = await makeForm("訂單H")
    const res = await app.inject({
      method: "POST",
      url: `/api/forms/${String(formId)}/triggers`,
      headers: H(),
      payload: {
        name: "沒時機",
        config: {
          actionType: "updateSelf",
          setFields: { 狀態: { from: "literal", value: "x" } },
        },
      },
    })
    expect(res.statusCode).toBe(400)
  })
})
