export interface PdfRenderRequest {
  /** 渲染器要導覽的網址。**必須是我方自己的 origin**,由呼叫端組出,不含使用者輸入 */
  readonly url: string
  /** 頁尾右下角的頁碼等,由樣式決定;此處只給紙張 */
  readonly landscape?: boolean
}

export interface PdfRenderer {
  render(req: PdfRenderRequest): Promise<Buffer>
}

export const PDF_RENDERER = Symbol("PDF_RENDERER")

/* 🔴 R1·後續-2b|渲染器的介面就是 OQ-PDF-2 的縫。

   ## 為什麼「先在同一個行程裡」是可以接受的

   OQ-PDF-2 裁定為「獨立 worker / 服務,介面隔離」,理由是 Chromium
   吃記憶體、會掛、升級節奏不同,不該讓一次 OOM 打掉整個 API。

   **而 Playwright 本來就把 Chromium 跑在另一個作業系統行程裡** ——
   真正要的那個隔離(當機不連坐)是免費的。獨立服務額外買到的是
   **映像檔體積**(Chromium ≈ 300-400 MB)與**獨立擴縮**,那是部署層的事。

   故此處落地為:介面 + 單一實作,而**行程隔離的性質在實作內確保**
   (單一瀏覽器、硬逾時、並發 1、失敗即重啟)。要抽成服務時換一個
   `PdfRenderer` 實作即可,呼叫端不動。**這是刻意的偏離,記在這裡而不是假裝沒有。** */
