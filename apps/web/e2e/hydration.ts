import { type Page, expect } from "@playwright/test"

/* 🔴 e2e 共用:**等到頁面真的可互動**再操作。

   ## 為什麼需要這個

   `next dev` 是按路由即時編譯的。整套 e2e 跑下來會碰到二十幾條路由,
   其中任何一條的首次載入都可能讓「HTML 已經出來、React 還沒接手」的窗口拉長。
   在那個窗口裡操作,會有**三種都不像「還沒好」的壞法**:

   1. `fill()` 進得去,但 React 接手時把受控輸入框重設 → 送出**空值**
      → 後端回「密碼至少 15 個字」之類的訊息,看起來像功能壞掉
   2. 按鈕的 `onSubmit` 尚未掛上 → 走**原生 GET**,網址多一個 `?`,欄位被清空
   3. 鍵盤快捷鍵的 handler 尚未掛上 → ⌘K 按了沒反應,面板永遠等不到

   這三種已經分別在 onboarding / mfa / search 三支 spec 上發生過,
   每次整套跑紅的都是不同的 spec —— 那個表象很容易被當成「測試不穩」而放著,
   但它其實是同一個成因。

   ## 為什麼是重試而不是 `waitForLoadState`

   `networkidle` 不保證 hydration 完成,`domcontentloaded` 更早。
   React 是否已接手**沒有可靠的外部訊號**(除非在產品碼裡埋一個標記,
   而測試不該要求產品為它加東西)。所以改成:做一次動作,檢查它是否生效,
   沒生效就再做一次 —— hydration 只會發生一次,第二次必定成功。 */

/* 反覆執行 `act` 直到 `check` 通過。用於「這個互動可能因為還沒 hydrate 而無聲失效」的場合。 */
export async function actUntil(
  act: () => Promise<void>,
  check: () => Promise<void>,
  timeout = 30_000,
): Promise<void> {
  await expect(async () => {
    await act()
    await check()
  }).toPass({ timeout })
}

/* ⌘K 命令面板。快捷鍵的 handler 要 hydrate 之後才存在,所以按到開為止。 */
export async function openPalette(page: Page, query: string): Promise<void> {
  const input = page.getByPlaceholder("搜尋表單、記錄、設定…")
  await actUntil(
    async () => {
      await page.keyboard.press("ControlOrMeta+k")
    },
    async () => {
      await expect(input).toBeVisible({ timeout: 2_000 })
    },
  )
  await input.fill(query)
}

/* ## 風險形狀:`goto` 之後**沒有等任何東西**就直接互動

   掃過全部 spec,符合這個形狀的有 16 處(auth / file-storage / grid-import /
   grid-keyboard / group-kanban-calendar / image-processing / image-signature /
   mfa / onboarding / security)。其中四處已經真的紅過並改用本檔的 helper;
   其餘目前是綠的,**沒有預先全部改** —— 但下次若有 spec 出現
   「單獨跑綠、整套跑紅」且症狀是「等不到某元素」或「送出了空值」,
   先往這裡看,不要當成測試不穩。

   判斷方法:`goto` 之後的第一個 `click` / `fill` / `press`,
   中間如果沒有任何 `expect(...).toBeVisible()` 之類的等待,就是它。 */
