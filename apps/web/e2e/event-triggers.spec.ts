import { expect, test } from "@playwright/test"

/* 🔴 R1·C-4 M5|事件觸發器的設計器入口。

   引擎面由 `apps/api/test/event-triggers.integration.test.ts` 固化(9 條)。
   這一條釘的是**第一約束**:設計者在瀏覽器裡設得起來,而不是「打 API 可以做」。

   釘三面,與連動選項 / 文字遮罩同型:
   1. 設計器有入口且設得起來
   2. 🔴 **存檔時它真的跑了** —— 這一條最關鍵。設定存進去、清單讀得出來、
      畫面畫得漂亮,而存檔時根本沒接上,是完全無聲的失敗
   3. 試跑不寫入 */
test("🔴 事件觸發器:設計器設得起來,而且存檔時真的跑", async ({ page, request }) => {
  const DEV = { "x-dev-tenant": "1", "content-type": "application/json" }
  const res = await request.post("/api/engine/forms", {
    headers: DEV,
    data: {
      name: `E2E觸發_${String(Date.now()).slice(-6)}`,
      fields: [
        { name: "金額", type: "number" },
        { name: "狀態", type: "text" },
      ],
    },
  })
  const formId = ((await res.json()) as { id: number }).id

  // 1) 設計器:動作/簽核 → 自動觸發
  await page.goto(`/app/builder?form=${String(formId)}`)
  await page.getByRole("button", { name: "動作/簽核" }).click()
  await page.getByRole("button", { name: "自動觸發" }).click()
  await expect(page.getByRole("textbox", { name: "觸發器名稱" })).toBeVisible({ timeout: 30_000 })

  await page.getByRole("textbox", { name: "觸發器名稱" }).fill("大額轉待審")
  await page.getByRole("button", { name: "＋ 新增條件" }).click()
  await page.getByLabel("條件 1 欄位").selectOption("金額")
  await page.getByLabel("條件 1 運算子").selectOption("gt")
  await page.getByLabel("條件 1 值").fill("10000")
  await page.getByLabel("要設定的欄位").selectOption("狀態")
  await page.getByLabel("設定值").fill("待審")
  await page.getByRole("button", { name: "新增", exact: true }).click()

  await expect(async () => {
    const got = await request.get(`/api/engine/forms/${String(formId)}/triggers`, { headers: DEV })
    expect(((await got.json()) as unknown[]).length).toBe(1)
  }).toPass({ timeout: 15_000 })

  /* 2) 🔴 存檔時真的跑。條件成立 → 狀態被改;不成立 → 不動。
     兩個方向都要驗:只驗成立的話,「一律執行」的錯誤實作也會過。 */
  const big = await request.post(`/api/engine/forms/${String(formId)}/records`, {
    headers: DEV,
    data: { values: { 金額: 50000, 狀態: "新建" } },
  })
  expect(big.status()).toBe(201)
  expect(((await big.json()) as { values: { 狀態: string } }).values.狀態).toBe("待審")

  const small = await request.post(`/api/engine/forms/${String(formId)}/records`, {
    headers: DEV,
    data: { values: { 金額: 100, 狀態: "新建" } },
  })
  expect(((await small.json()) as { values: { 狀態: string } }).values.狀態).toBe("新建")

  // 3) 試跑不寫入
  const before = await request.get(`/api/engine/forms/${String(formId)}/records`, { headers: DEV })
  const count = ((await before.json()) as { records: unknown[] }).records.length
  await page.getByRole("button", { name: "試跑" }).click()
  await expect(page.getByText("試跑結果")).toBeVisible({ timeout: 15_000 })
  const after = await request.get(`/api/engine/forms/${String(formId)}/records`, { headers: DEV })
  expect(((await after.json()) as { records: unknown[] }).records).toHaveLength(count)
})

/* 🔴 R1·C-4 v1.1|草稿 / 已發布。

   引擎面由 api 整合測固化(3 條)。這一條釘的是**畫面有沒有講清楚** ——
   後端擋住了但畫面不說,設計者改完就走,以為已經生效了,那和沒擋一樣糟。 */
test("🔴 草稿 / 發布:改了沒發布時,畫面要講「跑的是上一版」", async ({ page, request }) => {
  const DEV = { "x-dev-tenant": "1", "content-type": "application/json" }
  const res = await request.post("/api/engine/forms", {
    headers: DEV,
    data: {
      name: `E2E發布_${String(Date.now()).slice(-6)}`,
      fields: [{ name: "狀態", type: "text" }],
    },
  })
  const formId = ((await res.json()) as { id: number }).id
  const made = await request.post(`/api/engine/forms/${String(formId)}/triggers`, {
    headers: DEV,
    data: {
      name: "版本測試",
      onCreate: true,
      config: { actionType: "updateSelf", setFields: { 狀態: { from: "literal", value: "一" } } },
    },
  })
  const triggerId = ((await made.json()) as { id: number }).id

  // 改草稿,不發布
  await request.patch(`/api/engine/forms/${String(formId)}/triggers/${String(triggerId)}`, {
    headers: DEV,
    data: {
      config: { actionType: "updateSelf", setFields: { 狀態: { from: "literal", value: "二" } } },
    },
  })

  await page.goto(`/app/builder?form=${String(formId)}`)
  await page.getByRole("button", { name: "動作/簽核" }).click()
  await page.getByRole("button", { name: "自動觸發" }).click()
  await expect(page.getByText("有未發布的變更")).toBeVisible({ timeout: 30_000 })

  /* 🔴 存一筆:跑的必須還是舊版 */
  const before = await request.post(`/api/engine/forms/${String(formId)}/records`, {
    headers: DEV,
    data: { values: {} },
  })
  expect(((await before.json()) as { values: { 狀態: string } }).values.狀態).toBe("一")

  await page.getByRole("button", { name: "發布", exact: true }).click()
  await expect(page.getByText("有未發布的變更")).toBeHidden({ timeout: 15_000 })

  const after = await request.post(`/api/engine/forms/${String(formId)}/records`, {
    headers: DEV,
    data: { values: {} },
  })
  expect(((await after.json()) as { values: { 狀態: string } }).values.狀態).toBe("二")
})
