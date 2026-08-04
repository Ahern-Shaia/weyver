import { expect, test } from "@playwright/test"

/* R1·UP-3b M4 UI 固化:條件式格式。
   求值語意(運算子 / AND·OR / 後者覆蓋 / 欄位缺失)由 16 個前端單元測固化;
   後端契約(tone 白名單 / 運算子收斂)由 api integration 5 測固化。此處驗端到端。 */

const DEV = { "x-dev-tenant": "1", "x-dev-actor": "7" }
const uniq = () => Date.now().toString().slice(-6)

/* 兩條規則刻意重疊於「狀態」欄,用來驗證**後者覆蓋** */
const RULES = {
  record: [
    {
      combinator: "and",
      conditions: [{ field: "狀態", op: "eq", value: "待審" }],
      targets: ["狀態"],
      tone: "warn",
    },
    {
      combinator: "and",
      conditions: [{ field: "交期", op: "lt", value: "2026-08-01" }],
      targets: ["交期", "狀態"],
      tone: "error",
    },
  ],
  list: [
    {
      combinator: "and",
      conditions: [{ field: "狀態", op: "eq", value: "待審" }],
      targets: ["狀態"],
      tone: "warn",
    },
    {
      combinator: "and",
      conditions: [{ field: "交期", op: "lt", value: "2026-08-01" }],
      targets: ["交期", "狀態"],
      tone: "error",
    },
  ],
}

async function seedForm(request: import("@playwright/test").APIRequestContext): Promise<number> {
  const form = await request.post("/api/engine/forms", {
    headers: DEV,
    data: {
      name: `E2E條件格式_${uniq()}`,
      fields: [
        { name: "單號", type: "text", required: true },
        { name: "交期", type: "date" },
        { name: "狀態", type: "singleSelect", options: { choices: ["草稿", "待審", "已核准"] } },
      ],
    },
  })
  expect(form.status()).toBe(201)
  const formId = (await form.json()).id as number

  for (const values of [
    { 單號: "PO-001", 交期: "2026-07-20", 狀態: "待審" }, // 逾期 + 待審 → 兩規則皆命中
    { 單號: "PO-002", 交期: "2026-09-05", 狀態: "待審" }, // 只命中規則 1
    { 單號: "PO-003", 交期: "2026-09-12", 狀態: "已核准" }, // 皆不命中
  ]) {
    await request.post(`/api/engine/forms/${formId}/records`, { headers: DEV, data: { values } })
  }
  await request.patch(`/api/engine/forms/${formId}/layout`, {
    headers: DEV,
    data: { fields: {}, conditionalFormats: RULES },
  })
  return formId
}

test("記錄頁:命中規則之欄位標題與值皆著色,且後者覆蓋前者", async ({ page, request }) => {
  const formId = await seedForm(request)
  await page.goto(`/app/forms/${formId}?mode=record`)
  await expect(page.getByText("基本資料").first()).toBeVisible({ timeout: 30_000 })

  // toHaveCSS 會自動重試 —— 條件式格式依賴 useLayout 查詢,一次性讀取會在它解析前就跑掉
  const label = (text: string) => page.getByText(text, { exact: true }).first()

  // 交期(僅規則 2)→ error;狀態(規則 1 warn 被規則 2 error 覆蓋)→ error
  await expect(label("交期")).toHaveCSS("color", "rgb(179, 38, 30)")
  await expect(label("狀態")).toHaveCSS("color", "rgb(179, 38, 30)")
  // 未命中之欄位維持預設灰
  await expect(label("單號")).not.toHaveCSS("color", "rgb(179, 38, 30)")
})

test("記錄頁:值以帶框章呈現且文字恆在(FMEA G7 色非唯一訊號)", async ({ page, request }) => {
  const formId = await seedForm(request)
  await page.goto(`/app/forms/${formId}?mode=record`)
  /* 🔴 日期以**當地格式**呈現(zh-TW → `2026/07/20`),不是資料庫的 ISO 原值。
     原本這裡斷言 `2026-07-20`,等於把「原樣印出內部表示」寫成規格。 */
  await expect(page.getByText("2026/07/20", { exact: true })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText("待審", { exact: true }).first()).toBeVisible()
})

test("設計器:面板可開、規則清單與覆蓋序提示、即時預覽", async ({ page, request }) => {
  const formId = await seedForm(request)
  await page.goto(`/app/builder?form=${formId}`)
  await page.getByRole("button", { name: "條件式格式" }).click()

  await expect(page.getByText("排越後面越優先")).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole("button", { name: /記錄頁/ })).toBeVisible()
  await expect(page.getByText("即時預覽(本表第一筆)")).toBeVisible()

  // 切到列表頁分頁 → 規則獨立呈現(兩面各一組)
  await page.getByRole("button", { name: "列表頁", exact: true }).click()
  await expect(page.getByText("排越後面越優先")).toBeVisible()
})

test("設計器:改規則顏色 → 即時預覽同步", async ({ page, request }) => {
  const formId = await seedForm(request)
  await page.goto(`/app/builder?form=${formId}`)
  await page.getByRole("button", { name: "條件式格式" }).click()
  await expect(page.getByText("排越後面越優先")).toBeVisible({ timeout: 30_000 })

  // 選第 2 條規則(error)→ 改成 c1;預覽中「交期」應改為 c1 藍
  await page.getByRole("button", { name: /交期.*小於/ }).click()
  await page.getByRole("button", { name: "顏色 c1" }).click()

  const previewDate = page.getByText("2026-07-20", { exact: true }).last()
  await expect(previewDate).toHaveCSS("color", "rgb(31, 95, 158)")
})

/* 🔴 C-2 純呈現效果(hide / readonly)+ S1 雙向邏輯。

   S1 是 Ragic 官方用一整節〈問題排除〉在解釋的東西 ——
   「條件成立時執行某動作,也同時代表條件不成立時**不執行**」。
   對顏色這條恰好等價(未命中即無色),對隱藏**不等價**:
   若求值改成增量更新,欄位藏了就再也回不來,而畫面看起來完全正常。
   本測試的第二段(改值 → 欄位回來)盯的就是這個。 */
test("填單:條件式隱藏即時生效,且條件不再成立時欄位會回來(S1 雙向邏輯)", async ({
  page,
  request,
}) => {
  const stamp = String(Date.now()).slice(-6)
  const res = await request.post("/api/engine/forms", {
    headers: DEV,
    data: {
      name: `E2E條件隱藏_${stamp}`,
      fields: [
        { name: "單號", type: "text" },
        { name: "備註", type: "text" },
      ],
    },
  })
  const form = (await res.json()) as { id: number; fields: { id: number; name: string }[] }
  const idOf = (n: string): string => String(form.fields.find((f) => f.name === n)?.id ?? 0)

  await request.patch(`/api/engine/forms/${String(form.id)}/layout`, {
    headers: DEV,
    data: {
      grid: { cols: 12 },
      fields: {
        [idOf("單號")]: { row: 0, col: 0, colSpan: 6 },
        [idOf("備註")]: { row: 1, col: 0, colSpan: 6 },
      },
      statics: [],
      sections: [],
      conditionalFormats: {
        record: [
          {
            combinator: "and",
            conditions: [{ field: "單號", op: "eq", value: "HIDE" }],
            targets: ["備註"],
            effects: [{ kind: "hide" }],
          },
        ],
        list: [],
      },
    },
  })

  await page.goto(`/app/builder?form=${String(form.id)}&mode=fill`)
  await page.getByRole("tab", { name: "填單" }).click()
  /* 🔴 收斂到「填寫」區塊。整頁範圍的 textbox 計數對**任何**版面改動都是脆的 ——
     2026-08-03 左欄加了「搜尋表單」框之後,這類斷言全部多算一個,
     而失敗訊息(「應該 1 個卻有 2 個」)完全指不到原因。同型第三次。 */
  const fill = page.locator("section").filter({ hasText: "填寫" }).last()
  const 單號 = page.getByRole("textbox", { name: "單號" })
  await expect(單號).toBeVisible({ timeout: 30_000 })
  /* 條件未成立 → 兩欄都在 */
  await expect(fill.getByRole("textbox")).toHaveCount(2)

  await 單號.fill("HIDE")
  await expect(fill.getByRole("textbox")).toHaveCount(1) // 備註 隱藏

  /* 🔴 S1:條件不再成立 → **主動還原**,不是維持隱藏 */
  await 單號.fill("PO-001")
  await expect(fill.getByRole("textbox")).toHaveCount(2)
})

/* ── C-2 後半|分段目標(OQ-CF-9)+ 顯示訊息(OQ-CF-11)───────────── */

async function seedSectionForm(
  request: import("@playwright/test").APIRequestContext,
  conditionalFormats: unknown,
): Promise<number> {
  const res = await request.post("/api/engine/forms", {
    headers: DEV,
    data: {
      name: `E2E分段訊息_${uniq()}`,
      fields: [
        { name: "單號", type: "text" },
        { name: "聯絡人", type: "text" },
        { name: "電話", type: "text" },
      ],
    },
  })
  const form = (await res.json()) as { id: number; fields: { id: number; name: string }[] }
  const idOf = (n: string): string => String(form.fields.find((f) => f.name === n)?.id ?? 0)
  await request.patch(`/api/engine/forms/${String(form.id)}/layout`, {
    headers: DEV,
    data: {
      grid: { cols: 12 },
      fields: {
        [idOf("單號")]: { row: 0, col: 0, colSpan: 6 },
        [idOf("聯絡人")]: { row: 1, col: 0, colSpan: 6 },
        [idOf("電話")]: { row: 2, col: 0, colSpan: 6 },
      },
      statics: [],
      /* 分段涵蓋第 1–2 列 = 聯絡人 + 電話,**不含**單號 */
      sections: [{ id: "sec-contact", name: "聯絡資訊", fromRow: 1, toRow: 2 }],
      conditionalFormats,
    },
  })
  return form.id
}

/* 🔴 官方逐字:把相關欄位設成同一分段後「再透過條件式格式一次設定,
   就無需逐一針對各欄位進行設定」—— 一條規則、零個 targets,卻要動到兩個欄位。 */
test("🔴 分段目標:一條規則隱藏整段,段外的欄位不受影響", async ({ page, request }) => {
  const formId = await seedSectionForm(request, {
    record: [
      {
        combinator: "and",
        conditions: [{ field: "單號", op: "eq", value: "HIDE" }],
        targets: [],
        targetSections: ["sec-contact"],
        effects: [{ kind: "hide" }],
      },
    ],
    list: [],
  })

  await page.goto(`/app/builder?form=${String(formId)}&mode=fill`)
  await page.getByRole("tab", { name: "填單" }).click()
  const fill = page.locator("section").filter({ hasText: "填寫" }).last()
  const 單號 = page.getByRole("textbox", { name: "單號" })
  await expect(單號).toBeVisible({ timeout: 30_000 })
  await expect(fill.getByRole("textbox")).toHaveCount(3)

  await 單號.fill("HIDE")
  /* 段內兩欄一起不見,段外的單號還在 —— 若只剩 0 個就是連條件欄也被掃到 */
  await expect(fill.getByRole("textbox")).toHaveCount(1)
  await expect(單號).toBeVisible()

  await 單號.fill("PO-001")
  await expect(fill.getByRole("textbox")).toHaveCount(3)
})

/* 🔴 訊息的插值 + **純文字**渲染。
   文字由使用者自訂、值由資料帶入,兩者都是不可信輸入 ——
   若哪天有人為了「支援粗體」接上 `dangerouslySetInnerHTML`,這條會紅。 */
test("🔴 顯示訊息:條件成立才出現,帶入欄位值,且標記不被解析", async ({ page, request }) => {
  const formId = await seedSectionForm(request, {
    record: [
      {
        combinator: "and",
        conditions: [{ field: "單號", op: "isNotEmpty" }],
        targets: [],
        targetSections: [],
        effects: [{ kind: "message", text: "{{fieldName:單號}} {{fieldValue:單號}} 需主管核可" }],
      },
    ],
    list: [],
  })

  await page.goto(`/app/builder?form=${String(formId)}&mode=fill`)
  await page.getByRole("tab", { name: "填單" }).click()
  const 單號 = page.getByRole("textbox", { name: "單號" })
  await expect(單號).toBeVisible({ timeout: 30_000 })

  const box = page.getByTestId("rule-messages")
  await expect(box).toBeHidden() // 條件未成立 → 沒有訊息

  await 單號.fill("<b>PO-9</b>")
  await expect(box).toContainText("單號 <b>PO-9</b> 需主管核可")
  /* 🔴 標記若被解析,這裡會是一個 <b> 元素而不是字面文字 */
  await expect(box.locator("b")).toHaveCount(0)

  await 單號.fill("")
  await expect(box).toBeHidden()
})
