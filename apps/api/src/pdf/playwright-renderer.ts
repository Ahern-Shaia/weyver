import { Injectable, Logger, type OnModuleDestroy } from "@nestjs/common"
import type { Browser } from "playwright-core"
import type { PdfRenderRequest, PdfRenderer } from "./pdf-renderer.js"

/* 一次渲染的硬上限。超過就殺掉 —— 一個排版壞掉的範本可以讓瀏覽器轉到天亮。 */
const RENDER_TIMEOUT_MS = 30_000

/* 連續失敗這麼多次就把瀏覽器整個重開。Chromium 掛掉之後
   `browser` 物件仍然「存在」但每次操作都失敗,不重開會一直失敗下去。 */
const RELAUNCH_AFTER_FAILURES = 3

/* 🔴 R1·後續-2b M1|Playwright 渲染器。

   ## 為什麼是「導覽到我方的頁面」而不是「把 HTML 餵進去」

   我方的單據版面**本來就是 HTML + 既有 CSS token**,而記錄頁早就有
   `@media print` 樣式與 `data-noprint`。導覽到那一頁再 `page.pdf()`,
   印出來的東西**就是使用者按 Ctrl+P 會看到的東西**(所見即後果)。
   把 HTML 字串餵進來則要在後端再組一次版面 —— 那是第二份實作,必然漂。

   ## 🔴 網路一律封鎖,只放行我方 origin(FMEA P2 / P3)

   渲染器會忠實地載入頁面裡的任何 URL。若不擋:
   · `<img src="http://169.254.169.254/...">` → 雲端 metadata,SSRF 教科書案例
   · `file:///etc/passwd` / `file://` 讀本機檔案 → secret 外洩
   · 任意外連 → 資料被帶出去,而且無聲

   故 `route()` 掛在**每一個請求**上,只放行:
   (a) 與目標同 origin 的 http/https
   (b) `data:` URI(內嵌圖示)
   其餘一律 `abort()`。**白名單而非黑名單** —— 黑名單永遠列不完。 */
@Injectable()
export class PlaywrightPdfRenderer implements PdfRenderer, OnModuleDestroy {
  private readonly logger = new Logger(PlaywrightPdfRenderer.name)
  private browser: Browser | null = null
  private consecutiveFailures = 0
  /* 並發 1:一次一份。渲染是吃記憶體的事,平行跑等於自己對自己壓測。 */
  private chain: Promise<unknown> = Promise.resolve()

  async onModuleDestroy(): Promise<void> {
    await this.closeBrowser()
  }

  async render(req: PdfRenderRequest): Promise<Buffer> {
    const run = this.chain.then(
      () => this.renderOne(req),
      () => this.renderOne(req),
    )
    /* 鏈上不留下 rejected promise —— 否則下一個工作會被上一個的失敗連坐 */
    this.chain = run.catch(() => undefined)
    return run
  }

  private async renderOne(req: PdfRenderRequest): Promise<Buffer> {
    const browser = await this.ensureBrowser()
    const context = await browser.newContext()
    try {
      const page = await context.newPage()
      page.setDefaultTimeout(RENDER_TIMEOUT_MS)

      const origin = new URL(req.url).origin
      await page.route("**/*", (route) => {
        const url = route.request().url()
        if (url.startsWith("data:")) {
          void route.continue()
          return
        }
        let sameOrigin = false
        try {
          sameOrigin = new URL(url).origin === origin
        } catch {
          sameOrigin = false
        }
        if (sameOrigin) void route.continue()
        /* 靜默 abort 而不是報錯:一張擋掉的圖不該讓整份單據產不出來,
           但它也絕不會被載入。擋掉的次數進日誌供排查。 */ else void route.abort()
      })

      const response = await page.goto(req.url, {
        waitUntil: "networkidle",
        timeout: RENDER_TIMEOUT_MS,
      })
      /* 🔴 M2|**頁面壞掉不能算成功**。

         渲染頁若在伺服器端丟例外,Next 會回 500 並顯示一頁
         「Application error: a server-side exception has occurred」——
         而 `page.pdf()` 會忠實地把那一頁印成一份**完全合法的 PDF**。
         於是工作標 ready、檔案下載得到、`%PDF-` 開頭也對,使用者拿到的卻是
         一頁錯誤訊息。2026-08-06 手測時真的踩到(`fieldSymbology` 從伺服器
         元件呼叫客戶端函式),而 e2e 只斷言魔術位元組,綠過。

         HTTP 狀態是這裡唯一拿得到、又確實反映「頁面有沒有成功產生」的訊號。 */
      if (response === null || !response.ok()) {
        throw new Error(
          `print page returned ${response === null ? "no response" : String(response.status())}`,
        )
      }
      /* 列印樣式要生效,媒體型別必須是 print —— 否則印出來的是螢幕版
         (含側欄、按鈕、`data-noprint` 的東西全都會進 PDF)。 */
      await page.emulateMedia({ media: "print" })
      const pdf = await page.pdf({
        format: "A4",
        landscape: req.landscape === true,
        printBackground: true,
        margin: { top: "12mm", bottom: "14mm", left: "12mm", right: "12mm" },
      })
      this.consecutiveFailures = 0
      return pdf
    } catch (error) {
      this.consecutiveFailures += 1
      if (this.consecutiveFailures >= RELAUNCH_AFTER_FAILURES) {
        this.logger.warn(`渲染連續失敗 ${String(this.consecutiveFailures)} 次,重開瀏覽器`)
        await this.closeBrowser()
      }
      throw error
    } finally {
      await context.close().catch(() => undefined)
    }
  }

  private async ensureBrowser(): Promise<Browser> {
    if (this.browser?.isConnected() === true) return this.browser
    const { chromium } = await import("playwright-core")
    this.browser = await chromium.launch({
      /* `--no-sandbox` 只在容器內成立(容器本身就是沙箱且以非 root 跑)。
         這裡不寫死 —— 由部署環境決定,預設走 Playwright 的安全預設。 */
      args: ["--disable-dev-shm-usage"],
    })
    this.consecutiveFailures = 0
    return this.browser
  }

  private async closeBrowser(): Promise<void> {
    const b = this.browser
    this.browser = null
    this.consecutiveFailures = 0
    if (b !== null) await b.close().catch(() => undefined)
  }
}
