import type { ReactNode } from "react"
import { notFound } from "next/navigation"
import { PrintDocument, renderPayloadSchema } from "./_document"

/* 🔴 R1·後續-2b M1|渲染器要導覽的頁面。

   ## 為什麼是一條獨立路由而不是重用記錄頁

   記錄頁是**登入後**的畫面:它靠 session 打十幾支 API(按鈕 / 簽核 / 修改紀錄 /
   連結標題…),而渲染器是一個沒有身分的瀏覽器。要讓它走記錄頁,就得替它
   偽造一個 session —— 那是把「印一份 PDF」變成「模擬登入」,風險與功能不成比例。

   改成:**一次把渲染所需的全部資料取回來**(以票交換,後端以該工作 actor 的
   權限讀取並遮罩),這一頁只負責排版。

   ## 這會不會變成第二份版面實作?

   會,而且誠實記在這裡:欄位的**排列**在此重畫一次。
   但**值的格式化**共用 `formatFieldValue` 同一支 —— 那才是會漏東西的地方
   (member id / 連結標題 / 時區 / 金額),而既有的 `display-outlets.test.ts`
   會強制本檔也帶滿五個參數。**排版漂了是難看,值漂了是資料外洩或印錯**,
   兩者的代價不同,所以先共用後者。統一排版列 M2。 */
export default async function PrintPage({
  params,
}: {
  params: Promise<{ ticket: string }>
}): Promise<ReactNode> {
  const { ticket } = await params
  /* 伺服器端取資料:票只在伺服器之間流動,不進瀏覽器的 JS。 */
  const base = process.env.API_INTERNAL_URL ?? "http://localhost:3001"
  const res = await fetch(`${base}/api/pdf/render/${encodeURIComponent(ticket)}`, {
    cache: "no-store",
  })
  if (!res.ok) notFound()
  const parsed = renderPayloadSchema.safeParse(await res.json())
  if (!parsed.success) notFound()

  return <PrintDocument payload={parsed.data} />
}
