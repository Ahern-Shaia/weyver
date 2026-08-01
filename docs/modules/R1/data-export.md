# R1·I-1|資料匯出(帶得走的完整副本)

> **狀態**|🚧 **APPROVED(2026-08-01,OQ-EX-1..8 全採建議)** — 進 M1
>
> **一句話**|讓客戶把**整個工作區的資料**下載成一份可離線保存、可被別的系統讀懂的封存檔 —— 不是畫面上那個「匯出 Excel」的放大版。
>
> **上游**|F-8 訂閱計費地基 SHIPPED(其 §殘留 B6 逐字:「停權唯讀已保證,但 docs/04 I『匯出所有資料』⬜ 未起 → **停權功能啟用前必須先具備匯出**,否則承諾是空的」)· F-5 檔案儲存 SHIPPED(driver + presign)· docs/04 v2.5 I「PDPA 資料權利」。
>
> 作者:Claude Code(草擬)· 版本:v0.1(2026-08-01)

---

## 0. 為什麼現在做

**三個已經出貨的東西各自對客戶做了一個目前兌現不了的承諾。**

1. **停權唯讀**(F-8)|`TENANT_READ_ONLY` 的訊息逐字是「可檢視與**匯出**資料但無法變更」。而全庫沒有任何租戶級匯出 —— 這句話現在是假的。F-8 自己把這條列為殘留 B6。
2. **PDPA 資料權利**(docs/04 v2.5 I)|列為 R2,但它的地基與本模組同一份。
3. **遷移承諾**(docs/23 各 release 逐字「資料不重來」)|客戶把三套 ERP 的資料搬進來之前,會先問「我拿得走嗎」。答不出來,land 就卡在這一題。

### 🔴 既有的「匯出 Excel」不是這件事

`collection-view.tsx` 的匯出鈕**只含畫面上已載入的列**(UI 自己標了「匯出僅含已載入 N 筆」),
且在瀏覽器端用 `xlsx` 產生。那是**看的便利**,不是**帶得走**。
兩者的失效方式完全不同:前者少一列沒人會死,後者少一列就是資料遺失。

**不要把後者做成前者的放大版** —— 那條路會走到「瀏覽器記憶體裝不下整個租戶」然後才發現。

---

## 1. 目標與範圍

### 1.1 目標

1. **完整**|一次取得該租戶**全部表單的全部記錄**,含欄位定義、選項、關聯、子表。
2. **讀得懂**|GDPR Art. 20 逐字要求「in a **structured, commonly used and machine-readable** format」——
   對一個**動態 schema** 平台,只給 CSV 是不夠的:數字/日期/多選/附件/公式的型別在 CSV 裡全部塌成字串,
   拿到的人無法還原「這一欄本來是什麼」。故資料與 **metadata 一起出**。
3. **停權也拿得到**|這是本模組存在的第一個理由,不是附帶條件。
4. **不製造新的外洩面**|封存檔本身是一包「整個公司的資料」,它的保存期限、下載次數、授權都要當作機敏資產設計。

### 1.2 非目標(scope out,且說明為什麼)

- **匯入(還原)**|「帶得走」與「搬回來」是兩件事;後者要處理 id 重映射與衝突,自成模組。R1 先做走。
- **排程 / 自動備份**|Salesforce 有每週自動匯出,但那是**備份**語意。備份的正解是 DB 層(docs/11 §16),不是應用層產 zip。
- **直接傳給另一個 controller**|Art. 20 的「transmitted directly from one controller to another」附帶「**where technically feasible**」,對本產品現階段不成立。
- **稽核紀錄 / 通知紀錄的匯出**|先做業務資料;系統紀錄另議(它的收件人不同)。

---

## 2. 巨人怎麼做(一手查證)

| 議題 | Salesforce Data Export | Google Takeout | 逐字出處 |
|---|---|---|---|
| 交付形態 | 非同步產檔 + email 通知 + 下載連結 | 非同步產檔 + 通知 | — |
| 格式 | **zip of CSV** | 依服務別(JSON / MBOX / …) | — |
| 保存期限 | 「Export files are available to download for **48 hours** after completion.」 | 「Your archive expires in about **7 days**.」 | 兩家官方說明 |
| 下載次數 | 未限 | 「We only allow each archive to be downloaded **5 times**」 | Google |
| 大檔切分 | 「If the size of data in the organization is large, **multiple .zip archives are created**.」 | 可選單檔上限,超過即切分 | 兩家 |
| 附件 | **opt-in 勾選**;FAQ 反過來建議「Consider **deselecting** 'Include images, documents, and attachments'」 | 依服務選 | Salesforce FAQ |
| 下載時再認證 | — | **要求重新輸入密碼**,有 2SV 則再驗 | Google |
| 請求頻率 | 手動每 7 天一次 | — | Salesforce |

**三個可直接抄的形狀**:
1. **非同步 + 到期連結**,不是同步串流。兩家都這樣,理由一樣:全量資料的產生時間不可預測,綁在 HTTP 請求上必然逾時。
2. **封存檔是機敏資產**|會過期、可限次、下載要再認證。Google 三條都有。
3. **附件預設不含**|Salesforce 連自家 FAQ 都在勸退,因為它是體積的數量級來源。

**一個刻意不抄的**:Google 的 7 天 vs Salesforce 的 48 小時。兩者差距來自情境不同(消費者換裝置 vs 企業管理員當班),見 OQ-EX-2。

---

## 3. 上游 / 既有現況走查

| 子題 | 現況 | Gap |
|---|---|---|
| 全量匯出 | **無** | 本模組 |
| 單表匯出 | `collection-view` 前端 xlsx,只含已載入列 | 語意不同,不復用 |
| 檔案儲存 | `StorageDriver`(put/get/delete/stat/**presign?**)SHIPPED | 可直接放封存檔 |
| 大檔下載 | presign 回 null 時回退伺服器代理(F-11 M5)| 可直接復用 |
| 背景工作 | **只有 `@nestjs/schedule`**;無 BullMQ / DBOS | 見 OQ-EX-1 |
| CSV 注入 | `hasSpreadsheetFormula()` —— **偵測上傳**,刻意不改寫(那是使用者的原檔)| 🔴 **匯出是反過來的**:檔案由我方產生,OWASP 對輸出端的解法是**產生時跳脫**。缺 |
| 唯讀閘門 | `TenantGuard` 對停權租戶擋所有寫入方法 | 🔴 **請求匯出是 POST → 會被自己擋掉**,見 §7 |
| 配額 | `QuotaService` 單一檢查點 | 可掛匯出頻率 |

---

## 4. 設計要點

### 4.1 封存檔的形狀

```
weyver-export-<租戶>-<時間戳>.zip
├── manifest.json          表單清單 / 欄位定義(型別・選項・關聯)/ 匯出範圍 / 產生時間 / 版本
├── forms/
│   ├── 採購單.csv          一表一檔,含 id 與所有欄位
│   └── 採購單_明細.csv     子表獨立成檔,以 parent_id 相連
└── README.txt             這份檔案是什麼、怎麼讀、欄位型別去哪看
```

`manifest.json` 是「structured」那一半,CSV 是「commonly used」那一半 —— **兩者都要**才滿足 Art. 20 的三個形容詞。

### 4.2 🔴 匯出端的 CSV 注入

我方**產生**要給人用 Excel 開的檔案,故必須在寫入時處理:值以 `= + - @ Tab CR` 開頭者前置單引號(OWASP 對輸出端的建議)。
既有的 `hasSpreadsheetFormula()` 是**偵測**,用途是拒收上傳,不能拿來當這一層 —— 兩者的正確行為相反。

### 4.3 產生過程不得把整個租戶讀進記憶體

以 keyset 分頁逐表串流寫入 zip。已有的分頁 helper 可復用(#95 修過的那一支)。

### 4.4 授權

匯出等於「一次取得全部」,故授權只能比逐表更嚴,不能更鬆:**逐表過 `export` 動作權**(authz 已有此動作,見 `authz.ts` 的 `export: "匯出"`),而非「是 admin 就全給」。
—— 否則本功能會成為欄位級權限(#100 修了 16 條路徑)的第 17 條旁路。

---

## 5. 資料模型變動(草案)

```
export_job(
  id, tenant_id, requested_by_actor_id,
  status,               -- queued / running / ready / failed / expired
  scope,                -- all / forms:[id...]
  include_attachments,
  object_key,           -- 產出物在 storage 的 key
  size_bytes, row_count,
  download_count,
  error,
  created_at, ready_at, expires_at
)  RLS FORCE
```

到期清理走 `@nestjs/schedule`:過期即刪 storage 物件並標 `expired`。
**過期不刪列**(留稽核:誰在什麼時候把整包資料帶走了,是內控要問的問題)。

---

## 6. 開放問題(OQ-EX-N)— ✅ 已裁定 2026-08-01(全採建議)

| # | 議題 | 選項 | 建議 |
|---|---|---|---|
| **OQ-EX-1** ✅ | 非同步怎麼跑 | A. **DB 佇列表 + `@nestjs/schedule` 輪詢**(零新相依)<br>B. 引入 BullMQ(+ Redis)<br>C. 同步串流 | **A** — 兩家巨人都走非同步,C 出局。B 是對的長期解,但目前**沒有任何背景工作**需要它,為單一功能引入 Redis 與一套新的失效模式不划算;`export_job` 本身就是佇列,單一 worker + advisory lock 足夠。日後有第二個長工作再升 B,屆時 job 表可直接轉成 payload |
| **OQ-EX-2** ✅ | 保存期限 / 下載次數 | A. **7 天 + 5 次**(Google)<br>B. 48 小時、不限次(Salesforce)<br>C. 7 天、不限次 | **A** — 我方情境更接近 Google:**停權**與 **PDPA 請求**都不保證有人當班盯著;48 小時對「客戶收到通知才想起來要下載」太短。次數上限照抄 5:封存檔是整包公司資料,能限就限 |
| **OQ-EX-3** ✅ | 附件是否納入 | A. **預設不含,可勾選加入**(Salesforce 形狀)<br>B. 一律含<br>C. 一律不含 | **A** — 附件是體積的數量級來源(Salesforce 連自家 FAQ 都在勸退);但「不含附件的完整匯出」對食品業客戶(檢驗報告 / 照片)不算完整,故必須可選 |
| **OQ-EX-4** ✅ | 誰能匯出 | A. **admin 全租戶;一般成員不可**<br>B. 依 `export` 權逐表,誰有權匯誰的<br>C. A + B 並存 | **B** — authz 已有 `export` 動作,直接用它;A 會讓「我只想帶走我負責那張表」變成要找管理員。**但範圍一律逐表過權**,不因發起人是 admin 就跳過(見 §4.4) |
| **OQ-EX-5** ✅ | 下載是否要求再認證 | A. **要求重新輸入密碼**(Google)<br>B. 不要求,靠短效連結<br>C. 只有含附件時要求 | **A** — 這是唯一一個「一次拿走全部」的端點,session 被盜時它是損失最大的那一個。成本是一個對話框 |
| **OQ-EX-6** ✅ | 停權租戶怎麼請求 | A. **唯讀閘門豁免匯出端點**<br>B. 停權時改由客服代為產生 | **A** — B 等於把承諾轉包給人力,且客服要能代取全租戶資料本身是更大的風險面。豁免範圍限「建立匯出 + 下載」,其餘寫入照擋 |
| **OQ-EX-7** ✅ | 格式 | A. **zip(CSV + manifest.json)**<br>B. zip(xlsx 多工作表)<br>C. 兩者都給 | **A** — CSV 對機器最通用且可串流寫入;xlsx 要整份組完才寫得出,大租戶會撞記憶體。**型別由 manifest 補**。若客戶要「打開就能看」,單表 xlsx 已有(§0) |
| **OQ-EX-8** ✅ | 頻率限制 | A. **每租戶同時一個進行中 + 每日上限**<br>B. 照 Salesforce 每 7 天一次<br>C. 不限 | **A** — B 太嚴(遷移期會反覆試),C 會讓匯出變成打 DB 的放大器。同時只一個 job 也讓 worker 邏輯簡單 |

---

## 7. 🔴 已知的自我打臉(設計時就要處理)

1. **唯讀閘門會擋掉自己的救命出口**|`TenantGuard` 對停權租戶擋所有 `POST`,而請求匯出正是 POST。
   不處理的話,本模組上線後**停權客戶依然拿不到資料** —— 而那是它存在的第一個理由。
2. **匯出是欄位級權限的第 17 條旁路**|#100 才修完 16 條。這一條天生就是「一次全拿」,設計時就要逐表過權。
3. **CSV 注入的方向相反**|既有防護是拒收,匯出要的是跳脫。照抄既有函式會做出錯的行為。

---

## 8. 里程碑(草案)

| M | 內容 | 產出 |
|---|---|---|
| M1 ✅ | `export_job` + 佇列 worker + zip 產生(CSV + manifest,無附件)**+ 授權(提前自 M2)** | api |
| M2 | ~~授權~~(已於 M1 完成)+ 唯讀豁免 + 頻率限制 + **端點**(controller)| api |
| M3 | 下載(presign / 代理回退)+ 再認證 + 下載次數 + 到期清理排程 | api |
| M4 | 設定中心「資料匯出」頁:請求 / 進度 / 下載 / 到期倒數 | web |
| M5 | e2e + FMEA 收尾 | 兩側 |

≈ 0.3–0.4 人月。

---

## 13. 變更紀錄

| 日期 | 版本 | 變更 | 作者 |
|---|---|---|---|
| 2026-08-01 | v0.3 | **M1 SHIPPED**(#145)。`export_job`(狀態機 + **部分唯一索引**保證同租戶同時只有一個進行中;app 車道只授 SELECT/INSERT → 使用者改不動狀態、刪不掉紀錄,由 DB 執法)+ worker(`@nestjs/schedule` 輪詢 + `FOR UPDATE SKIP LOCKED` 原子認領)+ 封存檔(逐表 CSV 串流寫入暫存檔 + `manifest.json`)。**授權自 M2 提前到 M1** —— 匯出天生是「一次全拿」,先做一版讀得到全部的 runner 會留在歷史裡;`EffectivePermissions` 結構相容 `FieldAccessPolicy`,成本只有兩行。**實作期查證推翻三個假設**:(a) `@types/archiver@8` 宣告 `export class ZipArchive`,但 `archiver@7` 執行期只有掛著 `create` 的函式 —— tsc 全綠、一跑就 `not a constructor`;(b) 大小上限原掛 archiver 的 `progress` 事件,其 `fs.processedBytes` **只涵蓋檔案系統來源的 entry**,我方全是 stream → 恆為 0,上限形同虛設,改自己累加;(c) 檔名淨化的 `[ -/…]` ASCII range **沒擋住 `.`**(路徑穿越的關鍵字元),改明確列舉。另:`unzip -l` 顯示中文檔名亂碼是 macOS Info-ZIP 6.0 不理會 UTF-8 旗標,實測 EFS bit 11 確有設定(Windows 檔案總管正確),測試改為斷言該位元;storage key 白名單擴充第二種形狀 `t{tenant}/exports/{uuid}.zip`(用 uuid 不用 job id —— 物件名會進存取日誌與簽名 URL,流水號等於把「猜下一包」變成加一)。api 12 integration + 17 unit 綠 | Claude Code |
| 2026-08-01 | v0.2 | **OQ-EX-1..8 全數裁定(全採建議),DRAFT → APPROVED,進 M1**。定調:DB 佇列表 + schedule 輪詢(零新相依)、7 天 + 限 5 次、附件 opt-in、依 `export` 權逐表、下載再認證、唯讀豁免匯出端點、zip(CSV + manifest.json)、同時一個 job | Claude Code |
| 2026-08-01 | v0.1 | 初版 DRAFT。一手查證 GDPR Art. 20 逐字 + Salesforce Data Export(48 小時 / zip CSV / 附件 opt-in / 每 7 天)+ Google Takeout(7 天 / 限 5 次 / 下載再認證)。核心主張:**既有「匯出 Excel」是看的便利,不是帶得走**,不可做成它的放大版;動態 schema 平台必須「資料 + metadata 一起出」才滿足 Art. 20 的三個形容詞。點出三個自我打臉(唯讀閘門擋住自己的救命出口 / 匯出是欄位級權限的第 17 條旁路 / CSV 注入方向相反)。OQ-EX-1..8 待裁定 | Claude Code |
