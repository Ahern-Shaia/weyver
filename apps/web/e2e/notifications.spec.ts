import { expect, test } from "@playwright/test"

/* H-1 M5 UI 固化:鈴鐺未讀 → 面板 → 標為已讀 → 設定三軸。
   通知語意(層級 / 繼承 / 風暴防護 / 去抖動 / 抑制清單)由 api 15 單元 + 15 整合測固化。 */

const DEV = { "x-dev-tenant": "1", "x-dev-actor": "1" }
const uniq = () => Date.now().toString().slice(-6)

/* 觸發一則真實的「待簽核」通知給 dev actor 1。
   送簽者用另一個 actor —— 系統刻意不通知觸發者自己。 */
/* 回傳本輪的表單名 —— 斷言要錨在**這一輪**的通知上,不能只錨在「有某個通知」 */
async function seedPendingApproval(
  request: import("@playwright/test").APIRequestContext,
): Promise<string> {
  const formName = `E2E通知_${uniq()}`
  const form = await request.post("/api/engine/forms", {
    headers: DEV,
    data: {
      name: formName,
      fields: [{ name: "金額", type: "money", required: true }],
    },
  })
  expect(form.status()).toBe(201)
  const formId = (await form.json()).id as number

  const rec = await request.post(`/api/engine/forms/${formId}/records`, {
    headers: DEV,
    data: { values: { 金額: "77000" } },
  })
  expect(rec.status()).toBe(201)
  const recordId = (await rec.json()).id as number

  const roles = await request.get("/api/engine/authz/roles", { headers: DEV })
  const adminRole = (await roles.json()).find((r: { key: string }) => r.key === "admin")
  expect(adminRole).toBeTruthy()

  const def = await request.post(`/api/engine/forms/${formId}/approvals/defs`, {
    headers: DEV,
    data: { name: "e2e", active: true, steps: [{ stepNo: 1, approverRoleId: adminRole.id }] },
  })
  expect(def.status()).toBe(201)

  // 以別的 actor 送簽,通知才會落到 actor 1
  const submit = await request.post(
    `/api/engine/forms/${formId}/approvals/records/${recordId}/submit`,
    { headers: { "x-dev-tenant": "1", "x-dev-actor": "59" } },
  )
  expect(submit.status()).toBe(200)
  return formName
}

test("通知:鈴鐺未讀 → 面板顯示 → 全部標為已讀", async ({ page, request }) => {
  await request.post("/api/engine/notifications/read-all", { headers: DEV })
  await seedPendingApproval(request)

  await page.goto("/app")
  /* 未讀數必須在**無障礙名稱**上而非 title —— aria-label 於名稱計算優先於 title,
     放 title 等同螢幕閱讀器聽不到筆數(R1·UX-1 M2 修正之既有缺陷)。 */
  const bell = page.getByRole("button", { name: /^通知/ })
  await expect(bell).toHaveAccessibleName(/則未讀/, { timeout: 30_000 })

  await bell.click()
  const panel = page.locator(".shadow-overlay")
  await expect(panel).toBeVisible()
  await expect(panel.getByText("待簽核").first()).toBeVisible()

  await panel.getByRole("button", { name: "全部標為已讀" }).click()
  await expect(bell).toHaveAccessibleName("通知", { timeout: 30_000 })
})

test("通知內容不含欄位值(欄位級權限使「過濾收件人」失效)", async ({ page, request }) => {
  await request.post("/api/engine/notifications/read-all", { headers: DEV })
  const formName = await seedPendingApproval(request)

  await page.goto("/app")
  /* ⚠️ 用前綴不用 exact:鈴鐺有未讀時可及名稱是「通知(N 則未讀)」(這是刻意的,
     見 notification-bell)。寫成 exact 只有在剛好零未讀時才會過 —— 單獨跑綠、整套跑紅。 */
  await page.getByRole("button", { name: /^通知/ }).click()
  const panel = page.locator(".shadow-overlay")
  await expect(panel).toBeVisible()
  /* 🔴 audit-D §3-5|**先斷言通知項真的在,再斷言它不含值**。
     少了前半,seed 失敗時面板是空的,而「不含 77000」對空面板恆真 ——
     那條規則會靜靜地不再測任何東西。同一支檔案上一條測試有做這件事,形成對照。 */
  /* 🔴 錨在**本輪**的表單名上。`read-all` 只標已讀不刪除,共用 dev DB 裡前幾輪的
     通知仍在清單上 —— 錨在「有某個待簽核」的話,本輪派送壞掉時舊項目照樣滿足它,
     於是「不含 77000」又回到近乎恆真。 */
  await expect(panel.getByRole("button", { name: new RegExp(formName) })).toBeVisible({
    timeout: 15_000,
  })
  // 首欄是「金額」值 77000 —— 標題不得帶出
  await expect(panel).not.toContainText("77000")
})

test("通知設定:三軸皆在,層級可改且持久化", async ({ page, request }) => {
  await page.goto("/app/settings/notifications")

  await expect(page.getByText("軸 0", { exact: false })).toBeVisible()
  await expect(page.getByText("軸 1", { exact: false })).toBeVisible()
  await expect(page.getByText("軸 2", { exact: false })).toBeVisible()
  // 裁定 ④:逾期例外必須明白告知
  await expect(page.getByText("簽核逾期提醒為例外", { exact: false })).toBeVisible()

  /* 軸 1 的上半是全租戶預設(表單那一層改為逐表單清單,見 form-tools.spec)。
     ⚠️ 這裡是 `radio` 不是 `button` —— 單選清單的正確語意,選擇器要跟著語意走。
     🔴 2026-08-04:整頁範圍的 radio 查詢在**分類層 picker 出現之後**變成 6 個。
     要點的是「全租戶預設」那一組,故收斂到它所屬的 radiogroup。 */
  const tenantPicker = page.getByRole("radiogroup", { name: "全租戶預設通知層級" })
  await tenantPicker.getByRole("radio", { name: /^靜音/ }).click()
  await expect
    .poll(
      async () => {
        const res = await request.get("/api/engine/notifications/settings", { headers: DEV })
        const body = await res.json()
        return body.prefs.find((p: { scope: string }) => p.scope === "tenant")?.level
      },
      { timeout: 20_000 },
    )
    .toBe(0)

  // 還原為預設層級,不影響其他 spec
  await tenantPicker.getByRole("radio", { name: /^與我相關/ }).click()
})
