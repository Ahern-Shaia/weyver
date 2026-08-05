import { expect, test } from "@playwright/test"

/* 🔴 R1·FTP v1.5|群組欄位(Ragic「欄位種類 → 選項欄位 → **選擇群組**」)。

   與 `member` 同構(都是 bigint 指向一個系統主體),差別只在指向角色不是人。

   ⚠️ **刻意不做「給予選取的群組這筆資料管理權限」**:我方的記錄級存取讀的是
   `assignees`(actor 陣列),要支援群組得改 RLS policy。那是安全邊界的變更,
   不夾在欄位型別裡順手做 —— **半接的授權比沒有更危險**。 */

const DEV = { "x-dev-tenant": "1", "content-type": "application/json" }
const uniq = (): string => String(Date.now()).slice(-6)

test("🔴 群組欄:選得到、存得下、記錄頁顯示名稱而不是 id", async ({ page, request }) => {
  const groupsRes = await request.get("/api/engine/forms/access-preview/groups", { headers: DEV })
  expect(groupsRes.status()).toBe(200)
  const groups = (await groupsRes.json()) as { id: number; name: string }[]
  expect(groups.length).toBeGreaterThan(0)
  const target = groups[0] as { id: number; name: string }

  const res = await request.post("/api/engine/forms", {
    headers: DEV,
    data: {
      name: `E2E群組欄_${uniq()}`,
      fields: [
        { name: "主旨", type: "text" },
        { name: "承辦群組", type: "group" },
      ],
    },
  })
  const form = (await res.json()) as { id: number }

  const created = await request.post(`/api/engine/forms/${String(form.id)}/records`, {
    headers: DEV,
    data: { values: { 主旨: "倉庫盤點", 承辦群組: target.id } },
  })
  expect(created.status()).toBeLessThan(300)
  const row = (await created.json()) as { id: number }

  await page.goto(`/app/forms/${String(form.id)}?record=${String(row.id)}&mode=record`)
  const basic = page.locator("#sec-基本資料")
  await expect(basic).toBeVisible({ timeout: 30_000 })

  /* 🔴 顯示的是**名稱**。印出 id 是這個 repo 踩過兩次的形狀
     (member 一次、link 一次),而型別檢查完全不會抱怨。 */
  await expect(basic).toContainText(target.name)
  await expect(basic).not.toContainText(`承辦群組${String(target.id)}`)

  /* 選得到 —— 「不用打 API 就做得到」。
     ⚠️ 走「記錄頁 → 編輯」這條真實路徑:`?mode=new` 不存在,
     而 builder 的 `mode=fill` 是**設計畫布**(欄位顯示的是示例值)。
     兩次猜路由兩次紅 —— 路由要去讀,不要猜。 */
  await page.getByRole("button", { name: "編輯" }).click()
  await expect(page.getByLabel("承辦群組 選擇群組")).toBeVisible({ timeout: 15_000 })
})
