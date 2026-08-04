import { expect, test } from "@playwright/test"

/* 🔴 R1·後續-1b M7|簽核進階 UI 固化。對 dev api + 真 PG。

   本檔釘住的是**只有把 app 跑起來才會發現的三件事**:

   1. **駁回按鈕一直是壞的** —— 原本標「退回」的那顆送 `decision: reject` 而
      **不帶理由**,後端自 #103 起強制必填 → 按下去必定 400。
      型別對、lint 過、後端整合測也綠(它們自己帶理由),沒有任何一層攔得住。
   2. **會簽的分母把送簽者算進去** → 那一關永遠不可能通過(畫面停在 2/3 不動,
      且沒有任何錯誤訊息)。這條是瀏覽器實走當場撞到的。
   3. **退回後必須逐關重簽** —— 若舊核准仍算數,退回等於白做。 */

const DEV = { "x-dev-tenant": "1", "content-type": "application/json" }
const AS = (actor: string): Record<string, string> => ({ ...DEV, "x-dev-actor": actor })
type Req = import("@playwright/test").APIRequestContext

/* 送簽者與簽核者必須是**不同的人** —— 自簽禁令會擋掉同一人,
   而 dev 車道預設 actor 就是 1,所以送簽一律借另一個 actor。 */
const SUBMITTER = "58"

async function seed(
  request: Req,
  steps: Record<string, unknown>[],
): Promise<{ formId: number; recordId: number }> {
  const stamp = String(Date.now()).slice(-6)
  const form = await request.post("/api/engine/forms", {
    headers: AS(SUBMITTER),
    data: { name: `E2E簽核進階_${stamp}`, fields: [{ name: "品名", type: "text" }] },
  })
  const formId = ((await form.json()) as { id: number }).id
  const def = await request.post(`/api/engine/forms/${String(formId)}/approvals/defs`, {
    headers: AS(SUBMITTER),
    data: { name: "流程", steps },
  })
  expect(def.status()).toBe(201)
  const rec = await request.post(`/api/engine/forms/${String(formId)}/records`, {
    headers: AS(SUBMITTER),
    data: { values: { 品名: `待簽_${stamp}` } },
  })
  const recordId = ((await rec.json()) as { id: number }).id
  const sub = await request.post(
    `/api/engine/forms/${String(formId)}/approvals/records/${String(recordId)}/submit`,
    { headers: { "x-dev-tenant": "1", "x-dev-actor": SUBMITTER } },
  )
  expect(sub.status()).toBe(200)
  return { formId, recordId }
}

/* 狀態章專用:訊息列也會出現「第 N 關」(例如「已退回第 1 關 …」),
   只比對「第 N 關」會多重命中 —— 一律連同「簽核中 ·」一起鎖。 */
const atStep = (
  actions: import("@playwright/test").Locator,
  n: number,
): import("@playwright/test").Locator =>
  actions.getByText(new RegExp(`簽核中 · 第 ${String(n)} 關`))

const open = async (page: import("@playwright/test").Page, f: number, r: number): Promise<void> => {
  await page.goto(`/app/forms/${String(f)}?mode=record&rid=${String(r)}`)
  await expect(page.getByText("簽核中")).toBeVisible({ timeout: 30_000 })
}

test("🔴 駁回必須能用 —— 舊版那顆按鈕不帶理由,按下去必定 400", async ({ page, request }) => {
  const { formId, recordId } = await seed(request, [{ stepNo: 1, approverRoleId: 1, quorum: 1 }])
  await open(page, formId, recordId)

  const actions = page.getByTestId("record-actions")
  await actions.getByRole("button", { name: "駁回", exact: true }).click()
  /* 理由是必填的,所以 UI 必須先問 —— 沒有這個輸入框就代表又退回舊行為 */
  const reason = page.getByPlaceholder(/駁回理由/)
  await expect(reason).toBeVisible()
  await reason.fill("金額與附件對不上")
  await page.getByRole("button", { name: "確定" }).click()

  /* 🔴 指名**狀態章本身**,不用文字找。

     歷史:先是整頁範圍的 `getByText("已駁回")`,收斂到動作區之後仍會紅 ——
     因為動作區裡的「操作完成」提示訊息與狀態章**一字不差**,兩個都命中,
     而提示是短暫的,於是同一份程式碼有時 0 個、有時 2 個。
     **文字是給人看的,不是識別碼**;要斷言哪一個元素就指名哪一個。 */
  await expect(actions.getByTestId("approval-status")).toHaveText("已駁回")
})

test("🔴 會簽:分母不含送簽者,且未達門檻時留在原關", async ({ page, request }) => {
  const { formId, recordId } = await seed(request, [
    { stepNo: 1, approverRoleId: 1, quorum: "all" },
  ])
  await open(page, formId, recordId)

  /* 角色成員含送簽者,但他永遠不能簽自己的單 —— 把他算進分母那一關就永遠過不了。
     這條斷言的是「分母已扣掉他」,不是某個固定數字。 */
  const chip = page.getByTestId("record-actions").getByText(/人已核准/)
  await expect(chip).toBeVisible()
  const before = await chip.textContent()
  const [, approved, required] = /(\d+)\/(\d+) 人已核准/.exec(before ?? "") ?? []
  expect(Number(approved)).toBe(0)
  expect(Number(required)).toBeGreaterThanOrEqual(1)

  await page.getByTestId("record-actions").getByRole("button", { name: "核准" }).click()
  /* 未達門檻要明講,否則使用者以為自己按了沒反應然後再按一次 */
  await expect(page.getByText(/還需其他人核准|簽核完成/)).toBeVisible()
})

test("🔴 退回到指定關 → 該關之後全部重簽", async ({ page, request }) => {
  const { formId, recordId } = await seed(request, [
    { stepNo: 1, approverRoleId: 1, quorum: 1 },
    { stepNo: 2, approverRoleId: 1, quorum: 1 },
    { stepNo: 3, approverRoleId: 1, quorum: 1 },
  ])
  await open(page, formId, recordId)
  const actions = page.getByTestId("record-actions")

  await actions.getByRole("button", { name: "核准" }).click()
  await expect(atStep(actions, 2)).toBeVisible()
  await actions.getByRole("button", { name: "核准" }).click()
  await expect(atStep(actions, 3)).toBeVisible()

  await actions.getByRole("button", { name: "退回", exact: true }).click()
  await page.getByLabel("退回到哪一關").selectOption("1")
  await page.getByPlaceholder(/退回理由/).fill("品名寫錯,請修正後再送")
  await page.getByRole("button", { name: "確定" }).click()

  /* 明講「要重跑」—— 業界唯一的預設就是全部重簽,不講使用者會以為只補簽一關 */
  await expect(page.getByText(/需要重簽/)).toBeVisible()
  await expect(atStep(actions, 1)).toBeVisible()

  /* 🔴 核心:重簽第 1 關只能前進到第 2 關。
     若舊核准仍算數,這一下會直接衝到「簽核完成」。 */
  await actions.getByRole("button", { name: "核准" }).click()
  await expect(atStep(actions, 2)).toBeVisible()
})

test("強制解鎖:未解鎖時記錄改不動,解鎖後狀態要在檯面上", async ({ page, request }) => {
  const { formId, recordId } = await seed(request, [{ stepNo: 1, approverRoleId: 1, quorum: 1 }])
  await open(page, formId, recordId)
  const actions = page.getByTestId("record-actions")

  const patch = (): Promise<import("@playwright/test").APIResponse> =>
    request.patch(`/api/engine/forms/${String(formId)}/records/${String(recordId)}`, {
      headers: AS("1"),
      data: { expectedVersion: 1, values: { 品名: "偷改" } },
    })
  expect((await patch()).status()).toBe(409)

  await actions.getByRole("button", { name: "強制解鎖" }).click()
  await page.getByPlaceholder(/解鎖理由/).fill("簽核人已離職,先解鎖修正單據")
  await page.getByRole("button", { name: "確定" }).click()

  /* 解鎖是繞過內控的狀態,必須看得見 —— 不顯示的話沒人知道這筆現在可以改 */
  await expect(actions.getByTestId("approval-unlocked")).toBeVisible()
  expect((await patch()).status()).not.toBe(409)
})
