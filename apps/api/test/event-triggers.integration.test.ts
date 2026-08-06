import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify"
import { Test } from "@nestjs/testing"
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { AuthzRepository } from "../src/authz/authz.repository.js"
import { createDrizzle } from "../src/db/db.module.js"
import { runMigrations } from "../src/db/migrate.js"
import { tenants, users } from "../src/db/schema.js"
import { TriggerAsyncService } from "../src/triggers/trigger-async.service.js"
import { TriggerScheduleService } from "../src/triggers/trigger-schedule.service.js"
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
let opActor = 0

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
  const [op] = await db
    .insert(users)
    .values({ authUserId: "trig-op", email: "trig-op@t.test", name: "作業員" })
    .returning({ id: users.id })
  opActor = op?.id ?? 0
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

/* 🔴 非同步 worker 解析的是**真實權限**,而 `x-dev-tenant` 那條車道是超級權限、
   背後的 actor 一個角色都沒有 —— 於是所有 pushTo 都會記 `denied`。

   這不是缺陷,是那條車道的性質(`pdf.service.ts` 已為同一件事留過同樣的註記)。
   非同步側的測試因此**必須用真身分**:建一個角色、授予兩張表的權、指派給 actor。 */
async function grantForms(formIds: readonly number[], key: string): Promise<void> {
  const authz = app.get(AuthzRepository)
  const role = await authz.createRole({ tenantId: tenantA, key, name: key, parentId: null })
  for (const id of formIds) await authz.setFormActions(role.id, id, ["view", "create", "edit"])
  await authz.assignMember(tenantA, role.id, opActor)
}

const OP = (): Record<string, string> => ({
  "x-dev-tenant": String(tenantA),
  "x-dev-actor": String(opActor),
  "x-dev-real-authz": "1",
})

async function saveAs(formId: number, values: Record<string, unknown>): Promise<number> {
  const res = await app.inject({
    method: "POST",
    url: `/api/forms/${String(formId)}/records`,
    headers: OP(),
    payload: { values },
  })
  expect(res.statusCode, res.body).toBe(201)
  return (res.json() as { id: number }).id
}

async function runDetails(formId: number): Promise<unknown[]> {
  const res = await app.inject({
    method: "GET",
    url: `/api/forms/${String(formId)}/triggers/runs`,
    headers: H(),
  })
  return (res.json() as { detail: unknown }[]).map((r) => r.detail)
}

async function runsOf(formId: number): Promise<string[]> {
  const res = await app.inject({
    method: "GET",
    url: `/api/forms/${String(formId)}/triggers/runs`,
    headers: H(),
  })
  return (res.json() as { outcome: string }[]).map((r) => r.outcome)
}

/* 非同步 worker 平常由 cron 每分鐘跑。測試裡直接叫它,不等時鐘。 */
async function runAsync(): Promise<void> {
  await app.get(TriggerAsyncService).run()
}

async function listRecords(formId: number): Promise<Record<string, unknown>[]> {
  const res = await app.inject({
    method: "GET",
    url: `/api/forms/${String(formId)}/records`,
    headers: H(),
  })
  return (res.json() as { records: { values: Record<string, unknown> }[] }).records.map(
    (r) => r.values,
  )
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

/* 🔴 M3 非同步側:`pushTo`(往別張表建記錄)。

   這一側與同步側的風險完全不同。同步側改的是待寫入值,不發新事件;
   這一側**會建出新記錄 → 新事件 → 可能再觸發**,所以連鎖是真的可能無限。

   逐條釘:
   1. pushTo 真的建出了目標記錄,而且欄位對映有生效
   2. 🔴 **連鎖會停** —— 兩張表互相 pushTo,跑很多輪之後記錄數要收斂,不是爆炸
   3. 🔴 **權限不足記 denied,不升權** —— 「我看不到那張表但我可以設觸發器往裡面寫」不成立
   4. 條件不符時不建 */
describe("事件觸發器 · 非同步 pushTo", () => {
  it("pushTo 建出目標記錄,欄位對映有生效", async () => {
    const srcId = await makeForm("來源A")
    const dstId = await makeForm("目標A")
    await makeTrigger(srcId, {
      name: "不合格開矯正單",
      onCreate: true,
      conditions: [{ field: "狀態", op: "eq", value: "不合格" }],
      config: {
        actionType: "pushTo",
        targetFormId: dstId,
        fieldMap: {
          備註: { from: "field", field: "狀態" },
          金額: { from: "literal", value: 42 },
        },
      },
    })

    await grantForms([srcId, dstId], `push_a_${String(srcId)}`)
    await saveAs(srcId, { 金額: 1, 狀態: "不合格" })
    await runAsync()

    const rows = await listRecords(dstId)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.備註).toBe("不合格")
    expect(Number(rows[0]?.金額)).toBe(42)
  })

  it("條件不符時不建", async () => {
    const srcId = await makeForm("來源B")
    const dstId = await makeForm("目標B")
    await makeTrigger(srcId, {
      name: "只有不合格才開",
      onCreate: true,
      conditions: [{ field: "狀態", op: "eq", value: "不合格" }],
      config: { actionType: "pushTo", targetFormId: dstId, fieldMap: {} },
    })

    await grantForms([srcId, dstId], `push_b_${String(srcId)}`)
    await saveAs(srcId, { 金額: 1, 狀態: "合格" })
    await runAsync()

    expect(await listRecords(dstId)).toHaveLength(0)
  })

  /* 🔴 本段最重要的一條。

     兩張表互相 pushTo = 無限迴圈的教科書形態。沒有深度上限的話,
     這個測試會一直建記錄直到把測試容器撐爆 —— 而在 prod 是撐爆客戶的資料庫。

     驗的是**收斂**:跑很多輪之後總數穩定下來,而且有 `depth` 執行紀錄
     說明它是「被擋下來」不是「碰巧沒跑」。 */
  it("🔴 兩表互推:連鎖會停,而且停的時候留得下紀錄", async () => {
    const aId = await makeForm("互推A")
    const bId = await makeForm("互推B")
    await makeTrigger(aId, {
      name: "A→B",
      onCreate: true,
      config: { actionType: "pushTo", targetFormId: bId, fieldMap: {} },
    })
    await makeTrigger(bId, {
      name: "B→A",
      onCreate: true,
      config: { actionType: "pushTo", targetFormId: aId, fieldMap: {} },
    })

    await grantForms([aId, bId], `push_loop_${String(aId)}`)
    await saveAs(aId, { 金額: 1, 狀態: "起點" })
    /* 跑得比深度上限多很多輪:若沒有上限,每一輪都會再生一筆 */
    for (let i = 0; i < 12; i += 1) await runAsync()

    const total = (await listRecords(aId)).length + (await listRecords(bId)).length
    /* 深度上限 5 → 起點 1 筆 + 至多 5 代,取寬鬆上界即可證明「有停」 */
    expect(total, `記錄數 ${String(total)} 應收斂`).toBeLessThanOrEqual(8)

    /* ⚠️ 執行紀錄按**事件所在的表**分,而鏈條在哪一邊到頂事先不知道 ——
       所以兩張表都要看。第一版只查 A,而 `depth` 剛好記在 B,紅得莫名其妙。 */
    const outcomes = [...(await runsOf(aId)), ...(await runsOf(bId))]
    /* 🔴 停下來的時候要說得出「為什麼」。沒有這一條的話,
       「連鎖停了」與「觸發器根本沒接上」在數字上看起來一模一樣。 */
    expect(outcomes, JSON.stringify(outcomes)).toContain("depth")
    /* 而且它得先真的跑過幾輪,否則「一次都沒跑」也會讓上面的收斂斷言過 */
    expect(outcomes).toContain("ran")
  })

  /* 🔴 這一條是 OQ-ET-3 的執法。 */
  it("🔴 觸發者無權寫目標表 → 記 denied,不升權建記錄", async () => {
    const srcId = await makeForm("來源C")
    const dstId = await makeForm("目標C")
    await makeTrigger(srcId, {
      name: "推到沒權限的表",
      onCreate: true,
      config: { actionType: "pushTo", targetFormId: dstId, fieldMap: {} },
    })

    const authz = app.get(AuthzRepository)
    const role = await authz.createRole({
      tenantId: tenantA,
      key: `src_only_${String(srcId)}`,
      name: "只能用來源表",
      parentId: null,
    })
    await authz.setFormActions(role.id, srcId, ["view", "create", "edit"])
    /* 🔴 **用非 owner 的 actor**。`limitedActor` 的 id 剛好等於 dev 車道的 actor,
       而這些表都是用 dev 車道建的 → `createdBy` 就是它 → **owner 短路**直接給全套資料動作,
       於是「無權」測不出來(第一版就是這樣紅在「不該有記錄卻有」)。
       權限測試最容易空過的地方之一:**測試用的身分剛好擁有那張表**。 */
    await authz.assignMember(tenantA, role.id, opActor)
    /* 🔴 目標表標為**敏感**才是真的無權。

       第一版只是「不授予目標表」,而那樣**測不出東西** ——
       未分類的非敏感表會落到租戶預設 profile(層 4),於是照樣有 create,
       觸發器照跑,測試紅在「不該有記錄卻有」。
       deny-by-default 在這個模型裡的正確表達是敏感旗標,不是「沒給」。 */
    await authz.setFormSensitive(tenantA, dstId, true)

    const res = await app.inject({
      method: "POST",
      url: `/api/forms/${String(srcId)}/records`,
      headers: OP(),
      payload: { values: { 金額: 1, 狀態: "x" } },
    })
    expect(res.statusCode, res.body).toBe(201)

    await runAsync()

    /* 🔴 目標表**沒有**多出記錄 —— 若走系統身分,這裡會是 1 而沒有人發現 */
    expect(await listRecords(dstId)).toHaveLength(0)

    expect(await runsOf(srcId), "應記下 denied").toContain("denied")
  })
})

/* 🔴 R1·C-4 v1.1|草稿 / 已發布分離。

   出貨當下是**改了立刻生效** —— 設計者改到一半的觸發器,當下就在對真實資料動作。
   一條「金額 > 10000 → 待審」改到剩「金額 >」的瞬間,條件是壞的而它照跑。

   站三補查時由 Teable 官方逐字發現(「the live workflow keeps running on the
   previous version until you click Apply Update」),不是我方自己想到的。 */
describe("事件觸發器 · 草稿與發布", () => {
  it("🔴 改了但沒發布 → 跑的仍是舊版", async () => {
    const formId = await makeForm("發布A")
    const id = await makeTrigger(formId, {
      name: "設為舊值",
      onCreate: true,
      config: {
        actionType: "updateSelf",
        setFields: { 狀態: { from: "literal", value: "舊版" } },
      },
    })
    /* 新建即發布 —— 建完就該會動,否則使用者看到一條什麼都不做的觸發器 */
    expect((await read(formId, await save(formId, { 金額: 1 }))).狀態).toBe("舊版")

    // 改成新值,**不發布**
    const patched = await app.inject({
      method: "PATCH",
      url: `/api/forms/${String(formId)}/triggers/${String(id)}`,
      headers: H(),
      payload: {
        config: {
          actionType: "updateSelf",
          setFields: { 狀態: { from: "literal", value: "新版" } },
        },
      },
    })
    expect(patched.statusCode, patched.body).toBe(200)
    const dto = patched.json() as { hasUnpublishedChanges: boolean; draft: { config: unknown } }
    expect(dto.hasUnpublishedChanges, "改完要標示有未發布的變更").toBe(true)

    /* 🔴 本檔存在的理由:跑的還是舊版 */
    expect((await read(formId, await save(formId, { 金額: 1 }))).狀態).toBe("舊版")

    // 發布後才換
    const pub = await app.inject({
      method: "POST",
      url: `/api/forms/${String(formId)}/triggers/${String(id)}/publish`,
      headers: H(),
    })
    expect(pub.statusCode, pub.body).toBe(200)
    expect((pub.json() as { hasUnpublishedChanges: boolean }).hasUnpublishedChanges).toBe(false)
    expect((await read(formId, await save(formId, { 金額: 1 }))).狀態).toBe("新版")
  })

  it("丟棄草稿 → 回到已發布的版本", async () => {
    const formId = await makeForm("發布B")
    const id = await makeTrigger(formId, {
      name: "設為甲",
      onCreate: true,
      config: {
        actionType: "updateSelf",
        setFields: { 狀態: { from: "literal", value: "甲" } },
      },
    })
    await app.inject({
      method: "PATCH",
      url: `/api/forms/${String(formId)}/triggers/${String(id)}`,
      headers: H(),
      payload: {
        config: { actionType: "updateSelf", setFields: { 狀態: { from: "literal", value: "乙" } } },
      },
    })
    const res = await app.inject({
      method: "POST",
      url: `/api/forms/${String(formId)}/triggers/${String(id)}/discard`,
      headers: H(),
    })
    expect(res.statusCode, res.body).toBe(200)
    const dto = res.json() as {
      hasUnpublishedChanges: boolean
      draft: { config: { setFields: Record<string, { value: string }> } }
    }
    expect(dto.hasUnpublishedChanges).toBe(false)
    expect(dto.draft.config.setFields.狀態?.value, "草稿要被還原成已發布的內容").toBe("甲")
  })

  /* 🔴 停用是 kill switch,**不能等發布才生效**。
     發現觸發器在亂跑的時候,「先按停用、再按發布才會停」是不可接受的。 */
  it("🔴 停用即時生效,不必發布", async () => {
    const formId = await makeForm("發布C")
    const id = await makeTrigger(formId, {
      name: "會動的",
      onCreate: true,
      config: {
        actionType: "updateSelf",
        setFields: { 狀態: { from: "literal", value: "動了" } },
      },
    })
    expect((await read(formId, await save(formId, { 金額: 1 }))).狀態).toBe("動了")

    await app.inject({
      method: "PATCH",
      url: `/api/forms/${String(formId)}/triggers/${String(id)}`,
      headers: H(),
      payload: { enabled: false },
    })
    /* 沒有按發布 —— 但它必須立刻停 */
    const after = await save(formId, { 金額: 1, 狀態: "沒被動" })
    expect((await read(formId, after)).狀態).toBe("沒被動")
  })
})

/* 🔴 FMEA T2|**引用的欄位被下架 → 不得讓整張表寫不了。**

   實測過的原始行為:掛一條寫「狀態」的觸發器,把「狀態」欄下架
   (設計器那顆按鈕逐字「即時,不可復原」)之後,該表**所有新增回 422
   `unknown field: 狀態`**,而訊息完全不提觸發器 —— 一鍵把表寫死。

   ⚠️ 這一條原本被我寫成「改欄位名」的 P0,而**系統根本沒有改名端點**。
   去實證才發現。FMEA 每一條都要問「這個操作真的存在嗎」。 */
describe("事件觸發器 · 欄位不見了", () => {
  it("🔴 觸發器引用的欄位被下架 → 跳過該條,表單照樣存得進去", async () => {
    const formId = await makeForm("欄位消失A")
    const id = await makeTrigger(formId, {
      name: "寫狀態",
      onCreate: true,
      config: {
        actionType: "updateSelf",
        setFields: { 狀態: { from: "literal", value: "待審" } },
      },
    })
    expect((await read(formId, await save(formId, { 金額: 1 }))).狀態).toBe("待審")

    const detail = await app.inject({
      method: "GET",
      url: `/api/forms/${String(formId)}`,
      headers: H(),
    })
    const 狀態Id = (detail.json() as { fields: { id: number; name: string }[] }).fields.find(
      (f) => f.name === "狀態",
    )?.id
    expect(狀態Id, "測試前提:要找得到那個欄位").toBeGreaterThan(0)

    const del = await app.inject({
      method: "DELETE",
      url: `/api/forms/${String(formId)}/fields/${String(狀態Id)}`,
      headers: H(),
    })
    expect(del.statusCode, del.body).toBe(204)

    /* 🔴 本條存在的理由:下架之後還存得進去 */
    const after = await app.inject({
      method: "POST",
      url: `/api/forms/${String(formId)}/records`,
      headers: H(),
      payload: { values: { 金額: 2 } },
    })
    expect(after.statusCode, after.body).toBe(201)

    /* 🔴 而且**跳過要留得下紀錄** —— 靜默跳過等於「不動而沒人知道為什麼」,
       那和擋住一樣糟。 */
    const runs = await app.inject({
      method: "GET",
      url: `/api/forms/${String(formId)}/triggers/runs`,
      headers: H(),
    })
    const body = runs.json() as { triggerId: number; outcome: string; detail: unknown }[]
    const mine = body.filter((r) => r.triggerId === id)
    expect(
      mine.map((r) => r.outcome),
      JSON.stringify(body),
    ).toContain("failed")
    expect(JSON.stringify(mine)).toContain("引用的欄位已不存在")
  })
})

/* 🔴 FMEA T7|**扇出**(分支)的上限,與 T6 的深度上限是兩件事。

   `depth` 限鏈長,不限分支,而兩者是**相乘**的:
   一張表掛 T 條 pushTo,深度 5 的最壞情況是 T⁵。
   所以這一條刻意做成**乘法**的形狀(每一代都分叉),而不是一條鏈 ——
   只驗鏈的話,深度上限就會把它擋掉,測不出扇出有沒有被管。 */
describe("事件觸發器 · 連鎖總量", () => {
  it("🔴 每一代都分叉 → 總量收斂,而且停下來時說得出是「總量」不是「深度」", async () => {
    const aId = await makeForm("扇出A")
    const bId = await makeForm("扇出B")
    await grantForms([aId, bId], `fanout_${String(aId)}`)

    /* A 與 B 各掛 3 條互推 → 每一代 ×3。若只有深度上限,
       5 代就是 3⁵ = 243 筆;總量上限 100 應該讓它明顯更早停。 */
    for (let i = 0; i < 3; i += 1) {
      await makeTrigger(aId, {
        name: `A→B_${String(i)}`,
        onCreate: true,
        config: { actionType: "pushTo", targetFormId: bId, fieldMap: {} },
      })
      await makeTrigger(bId, {
        name: `B→A_${String(i)}`,
        onCreate: true,
        config: { actionType: "pushTo", targetFormId: aId, fieldMap: {} },
      })
    }

    await saveAs(aId, { 金額: 1, 狀態: "起點" })
    for (let i = 0; i < 10; i += 1) await runAsync()

    const total = (await listRecords(aId)).length + (await listRecords(bId)).length
    /* 上限 100 是「事件數」不是「記錄數」,且每一批會把當代跑完 →
       取寬鬆上界證明**有收斂**即可(無上限時 3⁵ 就已 243,10 輪會遠超)。 */
    expect(total, `記錄數 ${String(total)} 應收斂`).toBeLessThan(200)

    const outcomes = [...(await runsOf(aId)), ...(await runsOf(bId))]
    expect(outcomes).toContain("ran")
    expect(outcomes, "要有被擋下的紀錄").toContain("depth")

    /* 🔴 停下來的**理由**要分得出來。只寫「停了」的話,
       設計者不知道該減少觸發器數量(總量)還是縮短鏈(深度)。 */
    const detail = JSON.stringify([...(await runDetails(aId)), ...(await runDetails(bId))])
    expect(detail, detail.slice(0, 300)).toContain("cascade")
  })
})

/* 🔴 R1·C-5|定時觸發。**補上 Ragic 要寫 JavaScript 的那個位置。**

   Ragic 的通用排程是 Daily Workflow(JS 工作流程引擎的一種階段);
   `doc-kb/260` 逐字「如果你希望每日自動針對特定表單的所有資料同步…
   **可以考慮利用程式**」。這一批用 C-4 的封閉 allowlist 做到同一件事。

   ## 為什麼直接呼叫 `run()` 而不是等 cron

   排程的 cron 每小時整點跑。測試等不了,也不該等 —— 要測的是**到期判斷**
   與**執行語意**,不是 `@Cron` 這個 decorator 會不會被 NestJS 呼叫
   (那由 `schedule-registration` 那支守衛負責)。 */
describe("事件觸發器 · 定時觸發", () => {
  const runSchedule = async (): Promise<{ fired: number; affected: number }> =>
    app.get(TriggerScheduleService).run()

  /* 讓一條定時觸發「現在就該跑」:把它的時刻設成租戶當地的現在幾點。
     🔴 由 **PG 算**當地時間 —— 測試自己用 JS 算時區的話,就是在用一套規則
     驗另一套規則,兩邊同時錯還會綠。 */
  const localHourNow = async (): Promise<number> => {
    const { rows } = await pool.query<{ h: number }>(
      "SELECT EXTRACT(hour FROM now() AT TIME ZONE t.timezone)::int AS h FROM tenants t WHERE t.id = $1",
      [tenantA],
    )
    return Number(rows[0]?.h ?? 0)
  }

  it("🔴 每日定時:到點時對所有符合條件的記錄執行", async () => {
    const formId = await makeForm("定時A")
    await save(formId, { 金額: 5, 狀態: "未處理" })
    await save(formId, { 金額: 50000, 狀態: "未處理" })
    await save(formId, { 金額: 90000, 狀態: "未處理" })

    await makeTrigger(formId, {
      name: "每日標記大額",
      schedule: { freq: "daily", hour: await localHourNow() },
      conditions: [{ field: "金額", op: "gt", value: 10000 }],
      config: {
        actionType: "updateSelf",
        setFields: { 狀態: { from: "literal", value: "已標記" } },
      },
    })

    const r = await runSchedule()
    expect(r.fired, "應該有一條到期").toBeGreaterThanOrEqual(1)

    const states = (await listRecords(formId)).map((v) => v.狀態)
    /* 🔴 掃全表、逐筆判條件 —— 不是「執行一次」。
       這正是 Ragic 提醒的語意(`doc/96`:「檢查資料庫中所有的提醒功能」)。 */
    expect(states.filter((s) => s === "已標記")).toHaveLength(2)
    expect(states.filter((s) => s === "未處理")).toHaveLength(1)
  })

  it("🔴 同一天不會跑第二次(否則每小時就重跑一輪全表)", async () => {
    const formId = await makeForm("定時B")
    await save(formId, { 金額: 1, 狀態: "初始" })
    await makeTrigger(formId, {
      name: "每日蓋章",
      schedule: { freq: "daily", hour: await localHourNow() },
      config: {
        actionType: "updateSelf",
        setFields: { 狀態: { from: "literal", value: "第一輪" } },
      },
    })

    await runSchedule()
    expect((await listRecords(formId))[0]?.狀態).toBe("第一輪")

    /* 把值改回去 —— 若第二次真的跑了,它會再被蓋成「第一輪」 */
    const id = (await listRecords(formId)).length
    expect(id).toBe(1)
    await patch(formId, 1, { 狀態: "人改的" })

    await runSchedule()
    expect((await listRecords(formId))[0]?.狀態, "同一天不該再跑").toBe("人改的")
  })

  it("時刻還沒到 → 不跑", async () => {
    const formId = await makeForm("定時C")
    await save(formId, { 金額: 1, 狀態: "初始" })
    const h = await localHourNow()
    /* 取「還沒到」的時刻。當地已是 23 點時取 23 會變成「已到」,故往前借一天用 0 點
       —— 但 0 點又永遠 <= 現在。改用 h+1,並在 h=23 時直接跳過這條斷言的前提。 */
    if (h >= 23) return
    await makeTrigger(formId, {
      name: "晚點才跑",
      schedule: { freq: "daily", hour: h + 1 },
      config: {
        actionType: "updateSelf",
        setFields: { 狀態: { from: "literal", value: "跑過了" } },
      },
    })
    await runSchedule()
    expect((await listRecords(formId))[0]?.狀態).toBe("初始")
  })

  /* 🔴 漏跑補一次(OQ-SCH-5):process 在 08:00 掛掉、11:00 才回來,那一次要補。
     實作方式是 `>= schedule_hour` 而不是 `= schedule_hour`。 */
  it("🔴 錯過時刻後回來 → 當天仍補跑一次", async () => {
    const h = await localHourNow()
    if (h < 1) return // 當地 0 點時沒有「更早的時刻」可測
    const formId = await makeForm("定時D")
    await save(formId, { 金額: 1, 狀態: "初始" })
    await makeTrigger(formId, {
      name: "本來該更早跑",
      schedule: { freq: "daily", hour: 0 },
      config: {
        actionType: "updateSelf",
        setFields: { 狀態: { from: "literal", value: "補跑了" } },
      },
    })
    await runSchedule()
    expect((await listRecords(formId))[0]?.狀態, "錯過的時刻要補跑").toBe("補跑了")
  })

  it("🔴 未發布的定時觸發不會跑(與 C-4 的草稿分離一致)", async () => {
    const formId = await makeForm("定時E")
    await save(formId, { 金額: 1, 狀態: "初始" })
    const id = await makeTrigger(formId, {
      name: "改了沒發布",
      schedule: { freq: "daily", hour: await localHourNow() },
      config: {
        actionType: "updateSelf",
        setFields: { 狀態: { from: "literal", value: "舊版" } },
      },
    })
    await app.inject({
      method: "PATCH",
      url: `/api/forms/${String(formId)}/triggers/${String(id)}`,
      headers: H(),
      payload: {
        config: {
          actionType: "updateSelf",
          setFields: { 狀態: { from: "literal", value: "新版" } },
        },
      },
    })
    await runSchedule()
    /* 新建即發布,故跑的是「舊版」而不是未發布的「新版」 */
    expect((await listRecords(formId))[0]?.狀態).toBe("舊版")
  })

  it("🔴 定時 + pushTo 在邊界就被擋(不讓人設一個永遠不會跑的東西)", async () => {
    const src = await makeForm("定時F")
    const dst = await makeForm("定時F目標")
    const res = await app.inject({
      method: "POST",
      url: `/api/forms/${String(src)}/triggers`,
      headers: H(),
      payload: {
        name: "定時推別表",
        schedule: { freq: "daily", hour: 3 },
        config: { actionType: "pushTo", targetFormId: dst, fieldMap: {} },
      },
    })
    expect(res.statusCode, res.body).toBe(400)
    expect(res.body).toContain("只支援")
  })

  it("🔴 每月 29–31 號設不出來(那種日期有些月份不會發生)", async () => {
    const formId = await makeForm("定時G")
    for (const day of [29, 31]) {
      const res = await app.inject({
        method: "POST",
        url: `/api/forms/${String(formId)}/triggers`,
        headers: H(),
        payload: {
          name: `每月 ${String(day)} 號`,
          schedule: { freq: "monthly", hour: 3, day },
          config: {
            actionType: "updateSelf",
            setFields: { 狀態: { from: "literal", value: "x" } },
          },
        },
      })
      expect(res.statusCode, `day=${String(day)} 應被擋`).toBe(400)
    }
    /* 月底走 day=0 —— 那是 ERP 月結的真實需求,而 2 月幾號結束不該讓使用者自己想 */
    const ok = await app.inject({
      method: "POST",
      url: `/api/forms/${String(formId)}/triggers`,
      headers: H(),
      payload: {
        name: "月底結轉",
        schedule: { freq: "monthly", hour: 3, day: 0 },
        config: {
          actionType: "updateSelf",
          setFields: { 狀態: { from: "literal", value: "x" } },
        },
      },
    })
    expect(ok.statusCode, ok.body).toBe(201)
  })
})
