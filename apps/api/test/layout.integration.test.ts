import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify"
import { Test } from "@nestjs/testing"
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createDrizzle } from "../src/db/db.module.js"
import { runMigrations } from "../src/db/migrate.js"
import { tenants } from "../src/db/schema.js"
import { PG_TEST_IMAGE } from "./pg-image.js"

let container: StartedPostgreSqlContainer
let pool: pg.Pool
let app: NestFastifyApplication
let tenantA = 0
let tenantB = 0
let formId = 0
let noteFieldId = 0
let dateFieldId = 0

const A = (): Record<string, string> => ({ "x-dev-tenant": String(tenantA), "x-dev-actor": "7" })
const B = (): Record<string, string> => ({ "x-dev-tenant": String(tenantB), "x-dev-actor": "9" })

beforeAll(async () => {
  container = await new PostgreSqlContainer(PG_TEST_IMAGE).start()
  pool = new pg.Pool({ connectionString: container.getConnectionUri(), max: 5 })
  await runMigrations(pool)
  const db = createDrizzle(pool)
  const rows = await db
    .insert(tenants)
    .values([{ name: "廠 A" }, { name: "廠 B" }])
    .returning()
  tenantA = rows[0]?.id ?? 0
  tenantB = rows[1]?.id ?? 0

  process.env.DATABASE_URL = container.getConnectionUri()
  process.env.APP_DATABASE_URL = container.getConnectionUri()
  const { AppModule } = await import("../src/app.module.js")
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  await app.init()
  await app.getHttpAdapter().getInstance().ready()

  const form = await app.inject({
    method: "POST",
    url: "/api/forms",
    headers: A(),
    payload: {
      name: "登記表",
      fields: [
        { name: "備註", type: "text" },
        { name: "登記日", type: "date" },
      ],
    },
  })
  const body = form.json() as { id: number; fields: { id: number; name: string }[] }
  formId = body.id
  noteFieldId = body.fields.find((f) => f.name === "備註")?.id ?? 0
  dateFieldId = body.fields.find((f) => f.name === "登記日")?.id ?? 0
})

afterAll(async () => {
  await app.close()
  await pool.end()
  await container.stop()
})

const putLayout = (headers: Record<string, string>, payload: Record<string, unknown>) =>
  app.inject({ method: "PATCH", url: `/api/forms/${formId}/layout`, headers, payload })

describe("R1·UP-3 form_def.layout API + 預設值", () => {
  it("PUT layout → GET 回相同(座標 + 設定)", async () => {
    const layout = {
      grid: { cols: 12 },
      fields: {
        [String(noteFieldId)]: { row: 0, col: 0, colSpan: 2, placeholder: "選填" },
        [String(dateFieldId)]: { row: 1, col: 0 },
      },
    }
    const put = await putLayout(A(), layout)
    expect(put.statusCode).toBe(200)

    const get = await app.inject({
      method: "GET",
      url: `/api/forms/${formId}/layout`,
      headers: A(),
    })
    expect(get.statusCode).toBe(200)
    const got = get.json() as { layout: { fields: Record<string, { placeholder?: string }> } }
    expect(got.layout.fields[String(noteFieldId)]?.placeholder).toBe("選填")
  })

  it("PUT layout 引用不存在的 fieldId → 422", async () => {
    const res = await putLayout(A(), {
      fields: { "99999999": { row: 0, col: 0 } },
    })
    expect(res.statusCode).toBe(422)
    expect((res.json() as { code: string }).code).toBe("INVALID_FIELD_INPUT")
  })

  it("PUT layout 之 href 非 https → 400(VALIDATION_FAILED)", async () => {
    const res = await putLayout(A(), {
      fields: {},
      statics: [{ id: "s1", kind: "text", row: 0, col: 0, text: "x", href: "javascript:alert(1)" }],
    })
    expect(res.statusCode).toBe(400)
  })

  it("預設值:literal + $DATE + $USERID 於 createRecord 自動填", async () => {
    await putLayout(A(), {
      fields: {
        [String(noteFieldId)]: {
          row: 0,
          col: 0,
          defaultValue: { kind: "literal", value: "預設備註" },
        },
        [String(dateFieldId)]: {
          row: 1,
          col: 0,
          defaultValue: { kind: "variable", value: "$DATE" },
        },
      },
    })
    const create = await app.inject({
      method: "POST",
      url: `/api/forms/${formId}/records`,
      headers: A(),
      payload: { values: {} },
    })
    expect(create.statusCode).toBe(201)
    const record = create.json() as { values: Record<string, unknown> }
    expect(record.values.備註).toBe("預設備註")
    expect(record.values.登記日).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it("預設值不覆蓋使用者提供的值", async () => {
    const create = await app.inject({
      method: "POST",
      url: `/api/forms/${formId}/records`,
      headers: A(),
      payload: { values: { 備註: "使用者輸入" } },
    })
    expect((create.json() as { values: Record<string, unknown> }).values.備註).toBe("使用者輸入")
  })

  it("跨租戶:B PUT A 的 layout → 404", async () => {
    const res = await putLayout(B(), { fields: {} })
    expect(res.statusCode).toBe(404)
  })
})

/* R1·UP-3b 條件式格式:規則存於 layout(零 migration),tone 為受控白名單 */
describe("條件式格式(conditionalFormats)", () => {
  const putFormats = (formats: unknown) =>
    putLayout(A(), { fields: {}, conditionalFormats: formats })

  it("記錄頁 / 列表頁 各自一組規則 → round-trip", async () => {
    const res = await putFormats({
      record: [
        {
          combinator: "and",
          conditions: [
            { field: "登記日", op: "lt", value: "2026-08-01" },
            { field: "備註", op: "isNotEmpty" },
          ],
          targets: ["登記日"],
          tone: "error",
        },
      ],
      list: [
        {
          combinator: "or",
          conditions: [{ field: "備註", op: "contains", value: "急" }],
          targets: [],
          tone: "c1",
        },
      ],
    })
    expect(res.statusCode).toBe(200)

    const got = await app.inject({
      method: "GET",
      url: `/api/forms/${formId}/layout`,
      headers: A(),
    })
    const layout = (
      got.json() as { layout: { conditionalFormats?: { record: unknown[]; list: unknown[] } } }
    ).layout
    expect(layout.conditionalFormats?.record).toHaveLength(1)
    expect(layout.conditionalFormats?.list).toHaveLength(1)
  })

  it("FMEA G1:tone 非受控白名單(自由 hex / 任意字串)→ 400", async () => {
    for (const tone of ["#ff0000", "rainbow"]) {
      const res = await putFormats({
        record: [{ conditions: [{ field: "登記日", op: "isEmpty" }], tone }],
        list: [],
      })
      expect(res.statusCode).toBe(400)
    }
  })

  it("運算子限於既有 FILTER_OPERATORS(與列表篩選同源)→ 400", async () => {
    const res = await putFormats({
      record: [{ conditions: [{ field: "登記日", op: "matchesRegex", value: ".*" }], tone: "ok" }],
      list: [],
    })
    expect(res.statusCode).toBe(400)
  })

  it("空條件之規則 → 400(規則必須至少一個條件)", async () => {
    const res = await putFormats({ record: [{ conditions: [], tone: "ok" }], list: [] })
    expect(res.statusCode).toBe(400)
  })

  it("未設 conditionalFormats 仍可存 layout(既有表單零遷移)", async () => {
    const res = await putLayout(A(), { fields: {} })
    expect(res.statusCode).toBe(200)
  })

  /* ── C-2 後半|分段目標 + 顯示訊息(OQ-CF-9 / 11)───────────────── */

  it("targetSections + message 效果 → round-trip", async () => {
    const res = await putFormats({
      record: [
        {
          conditions: [{ field: "備註", op: "isNotEmpty" }],
          targets: [],
          targetSections: ["sec1"],
          effects: [{ kind: "readonly" }, { kind: "message", text: "{{fieldValue:備註}} 待確認" }],
        },
      ],
      list: [],
    })
    expect(res.statusCode).toBe(200)

    const got = await app.inject({
      method: "GET",
      url: `/api/forms/${formId}/layout`,
      headers: A(),
    })
    const rule = (
      got.json() as {
        layout: {
          conditionalFormats?: {
            record: { targetSections: string[]; effects: { kind: string; text?: string }[] }[]
          }
        }
      }
    ).layout.conditionalFormats?.record[0]
    expect(rule?.targetSections).toEqual(["sec1"])
    expect(rule?.effects.find((e) => e.kind === "message")?.text).toBe("{{fieldValue:備註}} 待確認")
  })

  it("空訊息 / 超長訊息 → 400(效果不得是一則沒有內容的訊息)", async () => {
    for (const text of ["", "x".repeat(501)]) {
      const res = await putFormats({
        record: [
          { conditions: [{ field: "備註", op: "isEmpty" }], effects: [{ kind: "message", text }] },
        ],
        list: [],
      })
      expect(res.statusCode).toBe(400)
    }
  })

  it("未知效果種類 → 400(判別式聯集不得被任意 kind 撐開)", async () => {
    const res = await putFormats({
      /* ⚠️ 這裡曾經拿 `required` 當「未知」的例子,C-3 把它變成合法的了 ——
         於是這條測試靜靜地不再測任何東西(實際踩到:它回 200 而我以為是別的問題)。
         挑一個不會變合法的。 */
      record: [{ conditions: [{ field: "備註", op: "isEmpty" }], effects: [{ kind: "explode" }] }],
      list: [],
    })
    expect(res.statusCode).toBe(400)
  })

  /* 🔴 `sectionId` 曾存在於 `fieldLayoutSchema` 且**零 reader 零 writer**,本批移除。
     schema 為 `.strict()`,故舊 client 若還在送這個鍵會被擋下來 —— 那是刻意的:
     靜默接受一個沒有人讀的欄位,正是它當初能存在兩個月的原因。 */
  it("已移除的 sectionId → 400,不靜默吞掉", async () => {
    const res = await putLayout(A(), {
      fields: { "1": { row: 0, col: 0, sectionId: "sec1" } },
    })
    expect(res.statusCode).toBe(400)
  })
})

describe("🔴 版面樂觀鎖(#109)", () => {
  it("**兩人同改,後寫者被擋而非蓋掉整張版面**", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/forms",
      headers: A(),
      payload: {
        name: `並發版面_${String(Date.now()).slice(-6)}`,
        fields: [
          { name: "甲", type: "text" },
          { name: "乙", type: "text" },
        ],
      },
    })
    const body = created.json() as { id: number; version: number; fields: { id: number }[] }
    const fid = body.id
    const a = String(body.fields[0]?.id ?? 0)
    const b = String(body.fields[1]?.id ?? 0)

    // 兩人同時載入,拿到同一個 version
    const detail = await app.inject({ method: "GET", url: `/api/forms/${fid}`, headers: A() })
    const base = (detail.json() as { version: number }).version

    const first = await app.inject({
      method: "PATCH",
      url: `/api/forms/${fid}/layout`,
      headers: A(),
      payload: { fields: { [a]: { row: 0, col: 0 } }, expectedVersion: base },
    })
    expect(first.statusCode).toBe(200)

    // 後寫者拿著同一個舊 version → 必須被擋,而不是蓋掉整張
    const second = await app.inject({
      method: "PATCH",
      url: `/api/forms/${fid}/layout`,
      headers: A(),
      payload: { fields: { [b]: { row: 5, col: 5 } }, expectedVersion: base },
    })
    expect(second.statusCode).toBe(409)
    expect((second.json() as { code: string }).code).toBe("LAYOUT_VERSION_CONFLICT")

    const after = await app.inject({ method: "GET", url: `/api/forms/${fid}/layout`, headers: A() })
    const saved = (after.json() as { layout: { fields: Record<string, unknown> } }).layout
    expect(saved.fields[a]).toEqual({ row: 0, col: 0 })
    expect(saved.fields[b]).toBeUndefined()
  })

  it("不帶 expectedVersion 時維持舊行為(既有呼叫端不受影響)", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/forms/${formId}/layout`,
      headers: A(),
      payload: { fields: { [String(noteFieldId)]: { row: 2, col: 2 } } },
    })
    expect(res.statusCode).toBe(200)
  })
})

/* 🔴 R1·FMT M2|日期顯示格式。與選項端點分開:選項會改寫既有記錄的資料,這個不動任何資料。 */
describe("R1·FMT 欄位顯示格式", () => {
  const setDisplay = (fid: number, dateFormat: string, form = formId) =>
    app.inject({
      method: "PATCH",
      url: `/api/forms/${form}/fields/${fid}/display`,
      headers: A(),
      payload: { dateFormat },
    })

  it("設定後寫進 options,且不動其他 options 鍵", async () => {
    expect((await setDisplay(dateFieldId, "slash")).statusCode).toBe(200)
    const got = await app.inject({ method: "GET", url: `/api/forms/${formId}`, headers: A() })
    const f = (
      got.json() as { fields: { id: number; options: Record<string, unknown> }[] }
    ).fields.find((x) => x.id === dateFieldId)
    expect(f?.options.dateFormat).toBe("slash")
  })

  it("白名單外的值拒絕 —— 格式是顯示層,但仍是使用者輸入", async () => {
    expect((await setDisplay(dateFieldId, "yyyy年MM月dd日")).statusCode).toBe(400)
  })

  /* 🔴 綁了租戶不等於有權存取這一筆:帶著自己有 design 權的 formId,
     配上**別張表的 fieldId**,不得寫得進去。 */
  it("欄位不屬於這張表 → 404,不得跨表寫入", async () => {
    const other = await app.inject({
      method: "POST",
      url: "/api/forms",
      headers: A(),
      payload: { name: "另一張表", fields: [{ name: "到期日", type: "date" }] },
    })
    const otherField = (other.json() as { fields: { id: number }[] }).fields[0]?.id ?? 0
    expect((await setDisplay(otherField, "iso", formId)).statusCode).toBe(404)
  })

  /* 🔴 audit-D §2.6|**型別閘**。`options.dateFormat` 在 autoNumber 是另一個語意
     (取號的日期樣板,`.strict()` + 三值 enum)—— 對它打這支端點會寫入它自己的
     schema 不接受的值,而取號會據此切成 patterned counter。

     ⚠️ UI 只對 date / dateTime 渲染這個設定,但**畫面上的閘不是閘**;
     上一條「欄位必須屬於這張表」是同一個形狀的前一格。 */
  it("🔴 非日期欄 → 400,不得把 dateFormat 寫進別種型別的 options", async () => {
    const f = await app.inject({
      method: "POST",
      url: "/api/forms",
      headers: A(),
      payload: {
        name: "型別閘",
        fields: [
          { name: "單號", type: "autoNumber" },
          { name: "備註", type: "text" },
        ],
      },
    })
    const body = f.json() as { id: number; fields: { id: number; name: string }[] }
    for (const name of ["單號", "備註"]) {
      const fid = body.fields.find((x) => x.name === name)?.id ?? 0
      const res = await setDisplay(fid, "slash", body.id)
      expect(res.statusCode).toBe(400)
      expect((res.json() as { code: string }).code).toBe("DISPLAY_FORMAT_NOT_APPLICABLE")
    }
  })
})

/* 🔴 C-3|**伺服器強制**。這一段整組的意義只有一句話:
   繞過畫面直接打 API,規則照樣擋得住。只在前端做的必填是裝飾。 */
describe("條件式必填(伺服器強制)", () => {
  let cfFormId = 0
  let statusId = 0
  let amountId = 0

  const rec = (path = "") => `/api/forms/${cfFormId}/records${path}`

  beforeAll(async () => {
    const form = await app.inject({
      method: "POST",
      url: "/api/forms",
      headers: A(),
      payload: {
        name: "C3必填表",
        fields: [
          { name: "狀態", type: "text" },
          { name: "金額", type: "text" },
        ],
      },
    })
    const body = form.json() as { id: number; fields: { id: number; name: string }[] }
    cfFormId = body.id
    statusId = body.fields.find((f) => f.name === "狀態")?.id ?? 0
    amountId = body.fields.find((f) => f.name === "金額")?.id ?? 0

    await app.inject({
      method: "PATCH",
      url: `/api/forms/${cfFormId}/layout`,
      headers: A(),
      payload: {
        grid: { cols: 12 },
        fields: {
          [String(statusId)]: { row: 0, col: 0 },
          [String(amountId)]: { row: 1, col: 0 },
        },
        statics: [],
        sections: [],
        conditionalFormats: {
          record: [
            {
              combinator: "and",
              conditions: [{ field: "狀態", op: "eq", value: "送審" }],
              targets: ["金額"],
              effects: [{ kind: "required" }],
            },
          ],
          list: [],
        },
      },
    })
  })

  const create = (values: Record<string, unknown>) =>
    app.inject({ method: "POST", url: rec(), headers: A(), payload: { values } })

  it("🔴 條件成立 + 該欄沒送 → 拒絕,即使欄位本身沒設必填", async () => {
    const res = await create({ 狀態: "送審" })
    expect(res.statusCode).toBe(422)
    expect(res.json()).toMatchObject({ code: "INVALID_FIELD_INPUT" })
    expect(JSON.stringify(res.json())).toContain("金額")
  })

  it("🔴 條件成立 + 明確送 null / 空字串 → 一樣拒絕", async () => {
    for (const v of [null, ""]) {
      const res = await create({ 狀態: "送審", 金額: v })
      expect(res.statusCode).toBe(422)
    }
  })

  it("條件不成立 → 不必填,照樣建得起來", async () => {
    const res = await create({ 狀態: "草稿" })
    expect(res.statusCode).toBe(201)
  })

  /* ⚠️ `expectedVersion` 一定要送。少送會得到 400,而那個 400 看起來
     跟「必填擋下來」一模一樣 —— 第一版就是這樣假綠的:測試通過,
     但測到的是 payload 驗證失敗,不是條件式必填。 */
  const patchRecord = async (values: Record<string, unknown>) => {
    const created = await create({ 狀態: "送審", 金額: "100" })
    expect(created.statusCode).toBe(201)
    const row = created.json() as { id: number; version: number }
    return app.inject({
      method: "PATCH",
      url: rec(`/${String(row.id)}`),
      headers: A(),
      payload: { expectedVersion: row.version, values },
    })
  }

  /* 🔴 更新是**部分**的:規則的條件引用的是這次沒送的欄位。
     只拿 patch 求值,條件會憑空不成立 —— 於是必填靜靜地消失。 */
  it("🔴 部分更新:條件欄不在 payload 裡,必填仍然成立", async () => {
    const res = await patchRecord({ 金額: "" })
    expect(res.statusCode).toBe(422)
    expect(JSON.stringify(res.json())).toContain("金額")
  })

  it("部分更新:把條件改成不成立,同一次就可以清掉該欄", async () => {
    const res = await patchRecord({ 狀態: "草稿", 金額: "" })
    expect(res.statusCode).toBe(200)
  })
})

/* 🔴 R1·UP-3b v1.4|條件側的虛擬欄位(Ragic `doc/6`「指定當前時間」/「指定使用者或群組」)。

   這一段只測**伺服器強制**那一半 —— 前端會不會標星號是體驗,
   伺服器收不收才是規則。而 `$actor` 必須取自**後端解析出來的 actor**:
   若吃 client 送的東西,「只有某人才必填」的規則,打 API 的人自己說他是那個人就繞過去了。 */
describe("條件式格式:虛擬欄位($now / $actor)", () => {
  let vFormId = 0
  let noteId = 0

  const putRule = async (cond: { field: string; op: string; value?: unknown }): Promise<void> => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/forms/${String(vFormId)}/layout`,
      headers: A(),
      payload: {
        grid: { cols: 12 },
        fields: { [String(noteId)]: { row: 0, col: 0 } },
        statics: [],
        sections: [],
        conditionalFormats: {
          record: [
            {
              combinator: "and",
              conditions: [cond],
              targets: ["備註"],
              effects: [{ kind: "required" }],
            },
          ],
          list: [],
        },
      },
    })
    expect(res.statusCode).toBeLessThan(300)
  }

  const create = async (headers: Record<string, string>) =>
    app.inject({
      method: "POST",
      url: `/api/forms/${String(vFormId)}/records`,
      headers,
      payload: { values: {} },
    })

  beforeAll(async () => {
    const form = await app.inject({
      method: "POST",
      url: "/api/forms",
      headers: A(),
      payload: { name: "虛擬欄位表", fields: [{ name: "備註", type: "text" }] },
    })
    const body = form.json() as { id: number; fields: { id: number; name: string }[] }
    vFormId = body.id
    noteId = body.fields.find((f) => f.name === "備註")?.id ?? 0
  })

  it("$now 落在區間內 → 條件成立,備註變必填", async () => {
    await putRule({ field: "$now", op: "between", value: ["2000-01-01", "2999-12-31"] })
    const res = await create(A())
    expect(res.statusCode).toBeGreaterThanOrEqual(400)
    expect(res.body).toContain("備註")
  })

  it("$now 落在區間外 → 條件不成立,存得進去", async () => {
    await putRule({ field: "$now", op: "between", value: ["1990-01-01", "1990-12-31"] })
    const res = await create(A())
    expect(res.statusCode).toBeLessThan(300)
  })

  /* 🔴 這一條是本段的重點:同一條規則,**換一個人就換一個結果**。
     若 `$actor` 沒有真的接到後端的 actor,兩次會一模一樣 —— 而那正是空過。 */
  it("🔴 $actor:規則指名的人才必填,別人存得進去", async () => {
    await putRule({ field: "$actor", op: "anyOf", value: [7] })

    const asSeven = await create({ ...A(), "x-dev-actor": "7" })
    expect(asSeven.statusCode).toBeGreaterThanOrEqual(400)

    const asOther = await create({ ...A(), "x-dev-actor": "8" })
    expect(asOther.statusCode).toBeLessThan(300)
  })

  it("虛擬欄位不因「不在欄位清單裡」被整條略過", async () => {
    /* 既有行為:引用不存在的欄位 → 整條規則略過。虛擬欄位必須豁免,
       否則這三項永遠不生效,而且是**靜默**的。 */
    await putRule({ field: "$now", op: "between", value: ["2000-01-01", "2999-12-31"] })
    expect((await create(A())).statusCode).toBeGreaterThanOrEqual(400)

    await putRule({ field: "不存在的欄位", op: "isNotEmpty" })
    expect((await create(A())).statusCode).toBeLessThan(300)
  })
})
