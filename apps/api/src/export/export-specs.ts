/* R1·I-1|匯出的常數。集中一處,因為前端的倒數與後端的到期必須用同一個數字。 */

/* OQ-EX-2=A,照 Google Takeout:「Your archive expires in about 7 days.」
   不採 Salesforce 的 48 小時 —— 停權與 PDPA 請求都不保證有人當班盯著。 */
export const EXPORT_TTL_DAYS = 7

/* 同上:「We only allow each archive to be downloaded 5 times」。
   封存檔是整包公司資料,能限就限。 */
export const EXPORT_MAX_DOWNLOADS = 5

/* 逐頁讀取的頁大小。`listQuerySchema` 的上限是 200。 */
export const EXPORT_PAGE_SIZE = 200

/* 🔴 未壓縮位元組上限。管的是**產生成本**(記憶體 / 磁碟 / DB 負載),
   不是壓縮後的檔案大小。超過即中止,而不是產完才發現。
   2 GiB 之下、以純文字 CSV 估算約數百萬列 —— 遠超過任何 R1 客戶的量;
   真的撞到代表該走分批匯出,那是另一個設計。 */
export const EXPORT_MAX_UNCOMPRESSED_BYTES = 2 * 1024 * 1024 * 1024
