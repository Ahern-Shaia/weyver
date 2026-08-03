# R1·I-1|資料匯出(帶得走的完整副本)

> **狀態**|✅ **SHIPPED v1.0(2026-08-03;M1–M5 + FMEA E1–E11)**
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
| M2 ✅ | ~~授權~~(已於 M1 完成)+ 唯讀豁免 + 頻率限制 + **端點**(controller)| api |
| M3 ✅ | 下載(presign / 代理回退)+ 再認證 + 下載次數 + 到期清理排程 | api |
| M4 ✅ | 設定中心「資料匯出」頁:請求 / 進度 / 下載 / 到期倒數 | web |
| M5 ✅ | e2e + FMEA 收尾 | 兩側 |

> 🔴 **M5 的 e2e 必須涵蓋「請求匯出 → 等到 ready」**,而不只是畫面渲染。
> 理由是 M2 實測踩到的:`archiver` 是 CJS,**vitest 與 tsx 的 interop 形狀不同** ——
> 單元測試全綠、真伺服器一跑就 `createArchive is not a function`。
> 只有跑在 dev server(tsx)上的 e2e 攔得住這一類。

≈ 0.3–0.4 人月。

---

## 11-bis. 🔴🔴 P0 已出貨漏洞:同租戶跨人可下載別人的封存檔(2026-08-03 修正)

**症狀**|任何已登入的租戶成員 `GET /api/exports` 取得別人的 job id,
再 `POST /api/exports/:id/download` 即可取走整包。
而封存檔是以**建立者的權限**產生的 —— 管理員的匯出含全租戶資料 ——
所以這條路徑等於**任何成員都能取走整個租戶的資料**。

**成因**|三支讀取端(`listForTenant` / `getForTenant` / `claimDownload`)
**只綁 `tenant_id`**,沒有綁 `requested_by_actor_id`。

**為什麼一路過關,值得逐條記**:

| 看起來像在把關的東西 | 實際上把的是什麼關 |
|---|---|
| RLS(`weyver_app` 角色 + `FORCE`) | 粒度是**租戶**。同租戶跨人它本來就不管 |
| 下載端的**再認證**(要求重打密碼) | 證明「**你是你**」,不證明「**這包是你的**」 |
| `@SelfService()` decorator | 名字讀起來像「只能動自己的」,實際是**讓守衛跳過 admin 要求** —— 語意與名稱相反 |
| 既有整合測試 | 只覆蓋**跨租戶**(A 讀不到 B)。同租戶跨 actor **從未有測試**,因為測試檔裡**只有一位 actor** |

**最後一列是根因**:測試資料只建了一個使用者,於是這條路徑在測試中**不可能被表達**。
「跨租戶隔離已測」給了覆蓋充分的錯覺,而 BOLA 的典型形態恰好在租戶**之內**。

**修正**|三支全部改為同時綁 tenant 與 actor(`listForActor` / `getForActor` /
`claimDownload(tenantId, actorId, …)`)。`explainFailure` 亦走 actor-scoped 查詢,
別人的 id 一律回 `EXPORT_NOT_FOUND`,不洩漏存在性。
新增回歸測試:同租戶另一位 actor 讀不到、認領不到,而**本人仍然可以**
(修正不得把功能一起關掉)。

**範圍決定**|admin **不**開放下載他人封存檔。要做管理面的稽核檢視,
應是獨立功能並自帶 audit,不是把這裡的條件放寬 —— 對齊 OQ-EX-4=B「誰有權匯誰的」。

**來源**|`pivot-and-charts` §14 的權限出口盤查(稽核 audit-B 第 5 項)順帶掃出,
不在原稽核清單內。

---

## 12. 失效場景反思(FMEA)

| # | 場景 | 處置 | Sev | 狀態 |
|---|---|---|---|---|
| **E1** | 🔴 **簽名分支只在 prod 執行,而它回 302 —— 瀏覽器拿不到檔案**。端點是 POST(要帶密碼)故前端只能用 `fetch`,而 fetch 跟隨重導後最終回應仍須通過 CORS 檢查,物件儲存桶預設不給 | M4 改回 **200 JSON `{url}`**,前端以導航去取(導航不受 CORS 管)。整合測臨時給 local driver 補一個 `presign` 來走那一半 —— 原本這條路徑**零覆蓋** | **P0** | ✅ |
| E2 | 代理串流分支把整包資料讀進瀏覽器記憶體 | prod 走簽名 URL,位元組不經應用層也不經記憶體;只有 local / on-prem(無 presign)才代理。**on-prem 大租戶仍會撞到**,屆時的正解是讓該環境也具備簽名能力 | P1 | ⏳ |
| E3 | 「有觸發下載」但拿到的是錯誤頁或空檔 | e2e 驗 zip 魔術數 `504b0304` 與位元組數,不只驗下載事件 | P1 | ✅ |
| E4 | 一次點擊扣兩次額度 | 按鈕於 `isPending` 停用;e2e 斷言下載後是「剩 4 次」而非 3 —— 同時擋掉「送兩次」與「前端自己減」 | P1 | ✅ |
| **E5** | 🔴 **再認證只在 prod 觸發,dev 無身分可驗 → 密碼欄可能根本沒接上而沒人發現** | 前端**不預判環境**:直接送,由後端回 `EXPORT_REAUTH_REQUIRED` 才顯示密碼欄。再認證發生在扣次數之前,故該次往返不消耗額度。**但這條路徑未於真實 session 實走** | P1 | ⏳ |
| E6 | 使用者以為列表頁的「匯出」等於備份 | 頁面明說「列表頁的匯出只含畫面上已載入的資料」;e2e 固化該句 —— 這句話一旦被人「精簡」掉,承諾就破了 | P1 | ✅ |
| E7 | 到期與剩餘次數不在檯面上 → 第 6 次按下去才發現,而那時唯一一份可能已刪 | 每列顯示到期倒數(<24 小時改以小時計)與剩餘次數 | P1 | ✅ |
| E8 | **每日 10 次上限被自動化測試消耗** —— 同一天多跑幾次 e2e 就會紅;客戶遷移期反覆試也可能撞到 | e2e 刻意只用一個測試涵蓋整條路徑並在檔頭標注。**額度未區分自動化與人為**,亦無「剩幾次」的提示 | P1 | ⏳ |
| E9 | 這一頁常駐輪詢打 API | `refetchInterval` 只在有 `queued`/`running` 時開,跑完即停 | P1 | ✅ |
| E10 | 失敗原因把 SQL / 路徑 / 堆疊噴給使用者 | worker 已於 M1 轉譯成 `userFacingError`;前端直接顯示該欄,不自行加工 | P1 | ✅ |
| **E11** | ⚠️ **開發期觀察到一筆無法解釋的 job 與一次下載計數增加**(2026-08-03 12:24 前後):`download_count` 在無人按下下載時 1→2,且 12:24:38 憑空多出一筆 job | **未解釋**。已排除:控制重現為「一次點擊 = 一個 POST = 一個 job,零下載增量」(以 `browser_network_requests` 逐筆核對)· 閒置 60 秒無任何變化 · React Query `refetchOnWindowFocus: false` 且 mutation 預設不重試 · worker 不建立 job。**若再現,先取瀏覽器網路紀錄再查後端** | P1 | ⏳ |

---

## 13. 變更紀錄

| 日期 | 版本 | 變更 | 作者 |
|---|---|---|---|
| 2026-08-03 | v1.0 | **M4 + M5 SHIPPED,模組收尾**。設定中心新增「資料匯出」頁(請求 / 附件 opt-in / 進度輪詢 / 下載 / 到期倒數 / 剩餘次數)+ `use-exports` 資料層 + `data-export.spec` 固化。**🔴 M4 推翻 M3 的下載回應形狀**:原本簽名分支回 `302 + Location`,那對 curl 成立、對瀏覽器不成立 —— 端點是 POST(要帶密碼)故前端只能用 `fetch`,而 fetch 跟隨重導後**最終回應仍須通過 CORS 檢查**,物件儲存桶預設不會對我方網域回 `Access-Control-Allow-Origin`。更糟的是這條路徑在 dev 與所有測試裡**完全不會執行**(local driver 無 `presign`),屬於「測試永遠綠、只有 prod 會壞」—— 本模組已經踩過同型兩次(`ZipArchive` 執行期不存在 / archiver 的 CJS interop)。改回 **200 JSON `{url}`** 讓前端以**導航**去取:導航不受 CORS 管,不必為此在儲存桶上開對外 CORS,且簽名本身已帶 `Content-Disposition: attachment`。整合測臨時替 local driver 補一個 `presign` 來覆蓋那一半(api 25 綠,+1)。**再認證不預判環境**:前端直接送,由後端回 `EXPORT_REAUTH_REQUIRED` 才顯示密碼欄 —— dev 無身分可驗、prod 一定要驗,前端不必各自知道自己在哪;再認證在扣次數之前,故該次往返不消耗額度。**e2e 自己先紅一次且是我方測試的錯**:按下建立到清單重抓之間有空窗,`.first()` 當時指的還是上一筆,對它斷言「可下載」會**立刻通過**、下一句才對著換過來的新列失敗 → 改為先等列數增加。e2e 驗 zip 魔術數與位元組數(只驗「有觸發下載」的話,錯誤頁與空檔一樣會通過)。**⚠️ 未解釋的觀察(FMEA E11)**:開發期出現一筆無人請求的 job 與一次無人按下的下載計數增加;控制重現(逐筆核對瀏覽器網路紀錄)為「一次點擊 = 一個 POST = 一個 job、零下載增量」,閒置 60 秒亦無變化,未能再現。**殘留**:E2 on-prem 代理下載走記憶體 / E5 再認證未於真實 session 實走 / E8 每日 10 次額度被 e2e 消耗 | Claude Code |
| 2026-08-01 | v0.6 | **M3 SHIPPED**(#147)。`POST :id/download`(**POST 不是 GET** —— 要帶密碼,而密碼不能進 URL/歷史/Referer/存取日誌);形狀對齊既有檔案下載:能簽名就 302、不能就代理串流,一律 `no-store, private`。**下載次數以條件式 UPDATE 原子遞增**(`WHERE ... AND download_count < 5 RETURNING`)—— 先查再寫的話兩個分頁會各自看到「還剩 1 次」;0 列時回查給出精確原因(410 過期 / 410 次數用盡 / 404 未完成)。到期清理 `@Cron` 每小時:**刪 storage 物件、列留著標 expired**。**🔴 OQ-EX-5 的依據更換**:原記「Google Takeout 下載要求重新輸入密碼」,逐字複查該頁**復現不出那句話**(只有安全性理由敘述與「We only allow each archive to be downloaded 5 times」)→ 改以 **ASVS 5.0 §7.5.3** 逐字為據:「requires further authentication with at least one factor or secondary verification before performing **highly sensitive transactions or operations**」。再認證用 Better Auth 內建 `/verify-password`(不自己比對雜湊);dev 車道無 session 故略過,已註明。實作期被既有防線抓到:新 `@Cron` 未具名 → `schedule-registration` 測試轉紅(未具名者以 UUID 進 registry,重複註冊偵測不到),已具名 `export.expire` 並列入清單。dev server 實測下載:28573 bytes、`unzip -t` 無誤、114 張表、次數遞增為 1。api 969 全綠 | Claude Code |
| 2026-08-01 | v0.5 | **🔴 M2 實測抓到 M1 的隱形缺陷**:`archiver` 為 CJS 而本專案是 ESM,`import * as m` 之後 `m.create` 在 **vitest 下存在、在 tsx(dev/prod 的實際執行方式)下是 undefined** —— 整個 `module.exports` 被塞進 `m.default`。表現是**單元測試 9 條全綠、瀏覽器一按匯出就失敗**,錯誤只出現在 dev server 的 stderr。改用 `createRequire`(Node 原生 CJS 載入,不經任何轉換器的 interop 詮釋)後兩個執行環境一致。同一個檔案在此已踩兩次(前一次是 `@types/archiver` 宣告的 `ZipArchive` 執行期不存在),註解記錄兩次的形狀。**M5 的 e2e 因此必須驗到 `ready` 而非只驗畫面** —— 這一類只有跑在 tsx 上才攔得住。dev server 實測:114 張表 / 343 筆 / 28KB / 7 天到期,manifest 帶回欄位型別 | Claude Code |
| 2026-08-01 | v0.4 | **M2 SHIPPED**(#146)。端點 `api/exports`(POST/GET/GET :id)。**POST 回 202 而非 201** —— RFC 9110 §15.3.3 逐字:「the request has been accepted for processing, but the **processing has not been completed**」且「SHOULD include ... a **pointer to a status monitor**」,回應裡的 job 資源即該 monitor;回 201「已建立」會誤導,使用者真正在意的封存檔那時還不存在。🔴 **唯讀閘門豁免匯出**(設計文件 §7 第一條自我打臉):`TenantGuard` 對停權租戶擋掉所有 POST,而請求匯出正是 POST —— 不豁免的話停權客戶依然拿不到資料。採**白名單**而非「唯讀時放行所有 POST」,否則日後任何新 POST 都會意外取得豁免;整合測同時斷言「其他寫入照擋 403 TENANT_READ_ONLY」。三層限制各擋不同的東西:throttler 擋瞬間洪水 / 每日 10 次擋接力 / DB 部分唯一索引擋並行(409 而非約束錯誤)。**誠實標注證據缺口**:每日次數兩家巨人皆無可抄數字(Google 對組織匯出未載頻率限制;Salesforce 每 7 天已判定太嚴),此為我方自訂界線,理由記於 `export-specs.ts`。另:`formIds: []` 明確拒絕而非靜默當成「全部」。api 38 export 測綠 | Claude Code |
| 2026-08-01 | v0.3 | **M1 SHIPPED**(#145)。`export_job`(狀態機 + **部分唯一索引**保證同租戶同時只有一個進行中;app 車道只授 SELECT/INSERT → 使用者改不動狀態、刪不掉紀錄,由 DB 執法)+ worker(`@nestjs/schedule` 輪詢 + `FOR UPDATE SKIP LOCKED` 原子認領)+ 封存檔(逐表 CSV 串流寫入暫存檔 + `manifest.json`)。**授權自 M2 提前到 M1** —— 匯出天生是「一次全拿」,先做一版讀得到全部的 runner 會留在歷史裡;`EffectivePermissions` 結構相容 `FieldAccessPolicy`,成本只有兩行。**實作期查證推翻三個假設**:(a) `@types/archiver@8` 宣告 `export class ZipArchive`,但 `archiver@7` 執行期只有掛著 `create` 的函式 —— tsc 全綠、一跑就 `not a constructor`;(b) 大小上限原掛 archiver 的 `progress` 事件,其 `fs.processedBytes` **只涵蓋檔案系統來源的 entry**,我方全是 stream → 恆為 0,上限形同虛設,改自己累加;(c) 檔名淨化的 `[ -/…]` ASCII range **沒擋住 `.`**(路徑穿越的關鍵字元),改明確列舉。另:`unzip -l` 顯示中文檔名亂碼是 macOS Info-ZIP 6.0 不理會 UTF-8 旗標,實測 EFS bit 11 確有設定(Windows 檔案總管正確),測試改為斷言該位元;storage key 白名單擴充第二種形狀 `t{tenant}/exports/{uuid}.zip`(用 uuid 不用 job id —— 物件名會進存取日誌與簽名 URL,流水號等於把「猜下一包」變成加一)。api 12 integration + 17 unit 綠 | Claude Code |
| 2026-08-01 | v0.2 | **OQ-EX-1..8 全數裁定(全採建議),DRAFT → APPROVED,進 M1**。定調:DB 佇列表 + schedule 輪詢(零新相依)、7 天 + 限 5 次、附件 opt-in、依 `export` 權逐表、下載再認證、唯讀豁免匯出端點、zip(CSV + manifest.json)、同時一個 job | Claude Code |
| 2026-08-01 | v0.1 | 初版 DRAFT。一手查證 GDPR Art. 20 逐字 + Salesforce Data Export(48 小時 / zip CSV / 附件 opt-in / 每 7 天)+ Google Takeout(7 天 / 限 5 次 / 下載再認證)。核心主張:**既有「匯出 Excel」是看的便利,不是帶得走**,不可做成它的放大版;動態 schema 平台必須「資料 + metadata 一起出」才滿足 Art. 20 的三個形容詞。點出三個自我打臉(唯讀閘門擋住自己的救命出口 / 匯出是欄位級權限的第 17 條旁路 / CSV 注入方向相反)。OQ-EX-1..8 待裁定 | Claude Code |
