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

/* 🔴 每日上限。**兩家巨人在這件事上沒有可抄的數字**(誠實標注證據缺口):
   Google 對組織匯出未載任何頻率限制;Salesforce 是每 7 天一次,而那對遷移期太嚴。

   這是我方自訂的界線。「同時只有一個」由 DB 的部分唯一索引保證,但它擋不住
   **接力** —— 跑完立刻再送一次,就能讓匯出無限地把整個租戶掃一遍又一遍。
   取一個寬鬆到正常使用者碰不到、但足以讓迴圈停下來的數字。 */
export const EXPORT_MAX_PER_DAY = 10
