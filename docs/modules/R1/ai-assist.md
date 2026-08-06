# ai-assist.md — [R1·AI-1] AI 設定(BYO key)+ 遷移建表助手 設計文件

> **狀態**|✅ **M0 APPROVED(2026-08-06)** — OQ-AI-1..9 **全採建議**,依〈研究錨定的建議 = 已核准〉自裁(每條依據見裁定欄)。M1 起跑。
> **上游**|`docs/32 A`「AI 設定頁 2 人月 —— R1 的 AI 功能沒這頁不能用」· `docs/32 B`「AI 遷移與建表助手 6 人月 —— GTM 楔子」· `docs/17` v2 · `docs/04` v2.4/v2.6。
> **一句話**|**AI 站在確定性推斷推不出來的地方,不是取代它。**

---

## 0. 站在巨人的肩膀

### 0.1 巨人一:自家 repo(對碼 2026-08-06)

| 事實 | 出處 | 對設計的意義 |
|---|---|---|
| 🔴 **Excel → 建表已交付**,而且核心是一支**確定性**的型別推斷 | `apps/web/src/app/app/builder/_components/excel/import.ts` | **AI 不得取代它**,見下方判讀 |
| ↳ 分層取樣 頭 50 / 中 100 / 尾 50,逐字理由「舊 Excel 的異常值往往不在檔頭…只看頭部會推出一個對尾部完全不成立的型別,而匯入是**單向**的」 | 同上 line 6-12 | 這種「踩過坑才會有的細節」LLM 產不出來 |
| ↳ **一票否決退 text**:前導零 / 15 位以上 / 電話標點 / 8–14 位純數字(除非欄名是量值)。逐字「這不是『推斷保守與否』的取捨,是**匯入即毀資料**」 | 同上 line 47-71 | 🔴 用 LLM 判「`0912345678` 是不是數字」會**不確定地**答錯;這支**確定性地**答對 |
| ↳ 低基數 → `singleSelect` + choices;fallback 一律 `text`(可改不可壞) | 同上 line 108-114 | |
| 建表**三條路已並列**:範本 · Excel · 空白 | `builder/_components/shell/form-list.tsx:66` 逐字註解 | AI 是**第四條路**,不是取代既有三條 |
| 🔴 **信封加密已存在**:AES-256-GCM,DEK 由 KEK 包,支援輪替 | `apps/api/src/crypto/secret-box.ts`(`sealSecret` / `openSecret` / `rewrapSecret`) | **BYO key 存放不必新造**;`notifications/channel-config.service.ts` 是可照抄的使用形狀(`WEYVER_SECRET_KEK`,取不到即拋不用空字串) |
| 欄位型別註冊表(31 型)集中一處 | `form-engine/field-types/field-type-registry.ts` | **這就是 allowlist** —— 模型只能輸出表內的型別,驗證器照它擋 |
| 檔案上傳鏈已存在:MIME 白名單 / 內容檢查 / 掃毒 / 影像處理 | `files/files.service.ts` | 截圖輸入走既有鏈。⚠️ 但它**綁欄位型別**(`isMimeAllowedForField`),**租戶級 / 暫存資產無路** —— 與 #56 同一個缺口 |
| `QuotaService` 有記錄數 / 儲存軸,**無 LLM token 軸** | `reliability/quota.service.ts` | 用量計量新增一軸,掛既有服務 |
| ⚠️ `form-engine/import/` 是**另一個功能**(#106 匯入列到既有表單),只進既有表單、**不建表不建欄** | doc 檔名逐字 `import-to-existing-form.md` | **本人查證時先看了這個目錄就差點下結論「Excel 建表沒做」** —— 記在這裡當警語 |

**🔴 站①的決定性判讀**|`inferColumnType` 的存在把 AI 的位置**縮小且釘死**了:

- Excel 這條路**已有確定性解,而且比 LLM 可靠** → AI **不碰型別推斷**
- AI 只在確定性推不出來的地方補:**舊 ERP 截圖**(無任何確定性路徑)· **自然語言描述** · 欄名語意 / 表單切分 / 關聯偵測

### 0.2 巨人二:自己的相依套件

| 檢查 | 結果 |
|---|---|
| 已裝的 LLM 相依 | **零**(`pnpm-lock` 掃 openai / anthropic / langchain / ai-sdk / tiktoken 全無) |
| `@anthropic-ai/sdk` 0.115.0 | **MIT**(2026-08-06 讀 LICENSE 本文);deps `standardwebhooks` `json-schema-to-ts` |
| `openai` 7.4.0 | **Apache-2.0**(讀 LICENSE 本文);**零 runtime deps** |
| `ai`(Vercel AI SDK)7.0.55 | **Apache-2.0**(讀 LICENSE 本文);deps `@ai-sdk/gateway` `@ai-sdk/provider` `@ai-sdk/provider-utils` |
| 既有加密 | ✅ `secret-box.ts`,不必新增相依 |
| 既有結構化輸出驗證 | ✅ Zod 全棧已用 —— 模型的 JSON 由 Zod 驗,不引入第二套 schema 工具 |

⚠️ **誠實記帳**|三者授權都可用,但**選 SDK 等於選一條升級節奏**。BYO key 模式下我方只需要「送一個 JSON、拿一個 JSON」,而 provider 的 REST API 是純 HTTP —— **「不裝 SDK」是一個真的選項**(見 OQ-AI-2)。

### 0.3 巨人三:競品(官方文件逐字,本機鏡像,查證 2026-08-06)

#### (a) 🔴 Ragic 的 AI **建表**吃的是**問卷 + 文字**,不是檔案

**來源**|`ragic-doc-zh-TW/.../doc/151/build-and-query-database.html`

> 「可以請 Ragic AI 協助建立資料庫。只要提出完整的需求,系統就會自動建立**一系列相關表單**」
> 「點擊 Ragic AI 的「建立資料庫」後,請先**填寫並選擇你的資料庫需求**……並依據這些需求選擇合適的項目:**情境、產業別、對象、涉及團隊與負責單位、員工數量**。」
> 「建立過程可能需要一些時間,**若設計較為複雜,執行時間可能超過半小時**。」
> 「Ragic AI 會提供**表單關係圖**、各表單的介紹以及使用說明。」
> 「完成後,就可依需求手動新增表單、重新整理表單之間的關聯、調整欄位,或優化流程後,**再請 Ragic AI 重新建立一次資料庫**。」
> 「注意:**目前無法使用 Ragic AI 協助產出報表**」

⚠️ **一條被推翻的轉述**|初次研究回報「Ragic 建表支援上傳 PDF/Excel/Word/圖檔」——
**錯**。那段逐字出自 `doc-user/82/auto-create-record-from-uploaded-file.html`,標題是
**「根據上傳檔案自動新增資料」= 建立記錄,不是建立表單**。兩個不同功能被名字接近而混為一談
(`pitfall` 之「看了名字就對映,沒看實作」)。**本行由本專案開檔覆查後更正。**

**判讀**|
1. 產物是**一整組表單 + 關係圖**,不是單張 —— 我方若只做單表,那是比它少。
2. **迭代方式是「重新建立一次」**,不是增量修改。這是一個可觀察的邊界。
3. 官方描述的流程裡,「確認送出」確認的是**需求**,完成後直接呈現建好的表單。
   ⚠️ **官方文件未描述「先看 schema 提案再核准」的步驟** —— 但依 AGENTS.md〈向上設計三條〉,
   「文件沒寫」≠「沒有」,此點列**待驗證**,**不得對外宣稱它沒有核准**。

#### (b) 🔴 Ragic 與 Airtable **都不是 BYO key,是原廠代購額度**

**Ragic**|`.../doc/176/ai-usage.html`
> 「**AI 額度以美金計算**,每個資料庫每月依版本與使用人數提供免費額度,當免費額度用盡後可再加購使用。**當月未使用完的免費 AI 額度不會累積至下月**;加購的 AI 額度則可累積使用。」
> 「當 AI 額度使用達 **80% 與 100%** 時,系統將自動寄送通知信件給**系統管理者**。」
> 模型可選(官方表格逐字):**GPT 5 Nano / GPT 5 Mini / GPT 5.2 · Claude Haiku 4.5 / Sonnet 4.6 / Opus 4.6 · Gemini 2.5 Flash Lite / Flash / Pro** —— 三家 provider 九個模型,並列出「額度使用量 × 思考深度」。

**Airtable**|`airtable-support/airtable-ai-billing.html`
> 「These free credits **expire at the end of the month**.」
> 「Note that building apps and agents with Omni is **free and does not consume AI credits**.」
> 逐項額度表:Question/Answer **10** · Create records **10** · Feedback categorization **1** · Web search **10** · **Document analysis 200**(a 10-page contract)· 「50+ pages or 25,000+ words 可能 **500–1,500**」·「100,000+ words 可達 **2,000–5,000+**」
> 「By default, Airtable AI is **automatically enabled for all plans** including legacy plans. **Only EU / GDPR customers can choose to turn on Airtable AI features optionally.**」
> workspace 層開關逐字:「Toggle on or off the "**Turn on Airtable AI for all bases within this workspace**" setting.」

**🔴 判讀(這一條直接改我方設計)**|
- **BYO key 不是業界主流,是我方 OSS-only 的直接後果**。兩家都當轉售商。
- 於是**「額度用量顯示」不可照抄** —— 我方看不到客戶在 provider 那邊的帳單,
  能量的只有**我方發出的呼叫數與 token 數**。`docs/04` v2.6 寫的「用量」語意須改寫成
  **「本平台代你送出了多少」**,而不是「你還剩多少額度」。80%/100% 告警在 BYO 模式下**無對象**。
- **工作區層級 AI 開關是兩家都有的 parity**,要做。
- **「資料外送同意」有法規驅動**(Airtable 逐字把 EU/GDPR 客戶單獨處理),不是裝飾。

#### (c) Ragic 的「表單 AI 設定」是**自訂擷取指令**,不是開關

**來源**|`.../doc/177/sheet-ai-setting.html`
> 「在**設計模式**中,前往**表單設定**中的 **AI 設定**頁籤進行設定。」
> 「**上傳檔案存入欄位**:上傳檔案自動新增資料時,檔案會儲存到此欄位。**若未設定欄位,檔案則不會儲存。**」
> 「**上傳檔案時的 AI 指令**:設定資料擷取規則……」官方範例逐字:
> 「1. 擷取發票上方的公司或店家名稱,填入「公司抬頭」欄位。 2. 擷取發票號碼,填入「發票編號」欄位。……6. 擷取「總計」金額,填入「金額」欄位。」
> 「注意:上傳檔案格式需符合該欄位設定的格式,否則將無法成功儲存。」

**判讀**|`docs/04` v2.6 把它記成「表單級 AI 開關」—— **形狀不對**,它其實是 per-form 的
**自訂 prompt**。而這一項屬於「拍照抽單」(我方已裁定 R2),**本模組不做**,只把記錄更正在這裡。

#### (d) Airtable 的截圖輸入

`airtable-support/ai-field-agent-build-prototype.html` 有「Image-to-code: Upload screenshots of existing designs」,
但那是 **build prototype(產介面原型)**,⚠️ **與「由截圖建資料表」是否為同一件事未查證**,不作為承重依據。

### 0.4 ✅ 交叉檢查

- [x] 自家 repo:找到**已交付且比 LLM 可靠**的確定性推斷 → 直接縮小 AI 的 scope
- [x] 相依套件:三個候選**逐檔讀 LICENSE 本文**(非 `spdx_id`);並記下「不裝 SDK」是真選項
- [x] 競品:一手逐字 + 檔案路徑 + 查證日期;**推翻了 subagent 的一條轉述並註明更正**
- [x] 標出未查證項(Ragic 是否有 schema 核准步驟 · Airtable 截圖建表)
- [x] **沒有寫「Ragic 沒有 X」**;它有的(建表 / 額度 / 模型選擇 / per-form 指令 / 關係圖)逐條記下
- [x] 承重的否定斷言(「不需核准」)**降級為待驗證**

---

## 1. 目標與範圍

### 1.1 目標

1. **AI 設定(BYO key)**:租戶自己接 provider,金鑰加密存放,用量看得到,可整租戶關掉。
2. **遷移建表助手**:舊 ERP 截圖 / 自然語言 → **schema 提案** → **人核准** → 建表。
3. 🔴 **AI 只提案,不落地**。所有 schema 變更經由既有的建表 API,走既有驗證。

### 1.2 不做的事

| 不做 | 為什麼 |
|---|---|
| **用 AI 取代 Excel 的型別推斷** | §0.1:既有那支是確定性的、而且內建了「匯入即毀資料」的防線。用 LLM 換掉是**用不確定換確定** |
| 原廠代購額度 / credits | OSS-only。我方不當 LLM 轉售商 —— 那要處理計費、退款、成本風險,且與 `docs/05` 的商業模型無關 |
| per-form 擷取指令(拍照抽單) | 已裁定 R2(`docs/23` v6.1)。§0.3(c) 只是把它的形狀記正確 |
| AI 公式助手 / NL 查詢 | 同屬 R1 但另立模組,本模組先把 **provider 層 + 核准鏈**做出來給它們用 |
| 讓模型直接產生 SQL / DDL | AGENTS.md 🔒 3 硬鐵則 |

---

## 2. scope 切分

| # | 切分 | 說明 |
|---|---|---|
| **A1 provider 層 + 設定** | BYO key 加密存放 · provider/模型選擇 · 用量計量 · 租戶開關 · 資料外送同意 |
| **A2 schema 提案器** | 截圖 / 文字 → 結構化 intent(表單 + 欄位 + 型別 + 關聯)→ Zod + allowlist 驗證 |
| **A3 核准與落地** | 提案的可視化 diff → 人核准 → 走既有建表 API → audit |

---

## 3. 開放問題(OQ-AI-N)— ✅ **已裁定 2026-08-06:全採建議**

| # | 議題 | 選項 | ✅ 裁定 |
|---|---|---|---|
| **OQ-AI-1** ⭐⭐ | AI 要不要碰 Excel 這條路 | A. AI 全面接手<br>B. **不碰型別推斷,只補語意**(表單命名 / 欄位語意 / 子表切分 / 關聯偵測)<br>C. 完全不碰 Excel | **B** —— §0.1 那支是確定性且比 LLM 可靠,換掉是拿正確性換新鮮感;但欄名語意與關聯偵測確定性做不到,那是 AI 的位置 |
| **OQ-AI-2** ⭐⭐ | 用哪個 SDK | A. `@anthropic-ai/sdk`(MIT)<br>B. `openai`(Apache-2.0,零 deps)<br>C. Vercel `ai`(Apache-2.0,provider 抽象現成)<br>D. **不裝 SDK,自己包 fetch** | **C** —— BYO key 必然要多 provider(Ragic 就給了三家九模型),自己寫 provider 抽象是重寫 C 已經有的東西(**站②的教訓:漏看自己的相依會重寫一份套件已經給你的**)。D 看似乾淨但 tool-use / structured output 的三家差異要自己吃 |
| **OQ-AI-3** ⭐⭐ | 🔴 模型輸出什麼 | A. 直接產 DDL<br>B. 產建表 API 的 JSON<br>C. **產受限 intent DSL,再由確定性程式碼編譯成建表呼叫** | **C** —— AGENTS.md 🔒 3 不留討論空間。B 看似安全但「API 的 JSON」會隨 API 演進而變成一個模型看得到的攻擊面;C 的 intent 只有我方定義的欄位,**多一個鍵就拒** |
| **OQ-AI-4** ⭐⭐ | 核准的粒度 | A. 整份提案一次核准<br>B. **逐表單 / 逐欄位可勾可改再核准**<br>C. 不核准直接建 | **B** —— C 違反 🔒 3。A 在「AI 產了 12 張表」時等於逼使用者全盤接受;而 §0.3(a) 顯示 Ragic 的迭代方式是**整份重來**,逐項可改是**做得比它細的位置**(條件②:我方 metadata 驅動,提案就是 metadata) |
| **OQ-AI-5** ⭐ | 沒設定 key 時 AI 入口怎麼呈現 | A. 隱藏<br>B. **顯示但停用 + 指到設定頁**<br>C. 顯示後才報錯 | **B** —— A 讓功能不可發現(第一約束的變體:使用者不知道有這條路);C 是死控件 |
| **OQ-AI-6** ⭐ | 用量怎麼記 | A. 不記<br>B. **記呼叫數 + token 數 + 估算成本,per 租戶 per 模型**<br>C. 照抄 Ragic 的「額度百分比」 | **B** —— C 在 BYO 模式下**無對象**(§0.3(b)),照抄會做出一個永遠算不準的數字。B 誠實:講「本平台代你送出了多少」 |
| **OQ-AI-7** ⭐ | 截圖走哪條上傳路 | A. 沿用附件欄上傳<br>B. **新增暫存資產通道**(掃毒同鏈,TTL 後刪)<br>C. 不落地,直接進 prompt | **B** —— A 綁欄位型別(§0.1),截圖不屬於任何欄位;C 讓「使用者傳了什麼給模型」無法稽核。⚠️ B 與 #56 租戶級資產上傳是同一條路,**一起做** |
| **OQ-AI-8** ⭐⭐ | 資料外送同意 | A. 不做<br>B. 首次使用時同意一次<br>C. **租戶層明示開啟 + 記錄同意人與時間 + 可撤回** | **C** —— §0.3(b) Airtable 把 EU/GDPR 客戶單獨處理,顯示這有法規驅動。而我方客戶是台灣食品加工廠,**PDPA 同一個問題** |
| **OQ-AI-9** | 模型清單怎麼維護 | A. 寫死<br>B. **設定檔 + 租戶可填自訂 model id** | **B** —— 模型半年就換一輪(Ragic 表上已是 GPT 5 / Claude 4.6 / Gemini 2.5),寫死等於每次換模型都要出版 |

---

## 4. FMEA(pre-mortem,草擬)

| # | 失效 | 嚴重度 | 緩解 |
|---|---|---|---|
| A1 | 🔴 模型被 prompt injection 誘導產出越權 schema | **P0** | OQ-AI-3=C 受限 intent + allowlist;**建表仍走既有 API 與既有權限檢查**,模型不繞過任何一層 |
| A2 | 🔴 客戶資料 / PII / secret 進 prompt | **P0** | 只送使用者**明示選擇**的輸入;截圖與文字之外不自動夾帶記錄;prompt 前跑 redact;OQ-AI-8=C 同意鏈 |
| A3 | 🔴 BYO key 外洩 | **P0** | `secret-box` 信封加密;**永不回傳明文**(設定頁只顯示末四碼);log / 錯誤訊息 redact |
| A4 | 🔴 key 被拿去打別的租戶的量 | **P0** | key 綁租戶;呼叫一律經伺服器端,**前端永不持有 key** |
| A5 | 模型幻覺出不存在的欄位型別 | P1 | Zod + `field-type-registry` allowlist,不在表內即拒;拒絕時**明示哪一項被拒**而不是靜默丟棄 |
| A6 | 一次提案 50 張表把租戶配額打爆 | P1 | 提案上限 + `QuotaService` 新增 LLM 軸;核准時再檢一次配額 |
| A7 | provider 掛掉拖垮核心 | P1 | AGENTS.md ⚙️:AI 為**非關鍵路徑**,timeout + circuit breaker,掛了核心照常 |
| A8 | 「超過半小時」那類長工作 | P1 | §0.3(a) 顯示這是真實量級 → 非同步工作 + 進度可見(形狀照 `pdf_job` / `export_job`) |

---

## 5. 里程碑(草擬)

| M | 內容 |
|---|---|
| M1 | provider 抽象 + BYO key 加密存放 + 租戶開關 + 同意鏈(schema + 服務) |
| M2 | 用量計量(`QuotaService` 新增 LLM 軸)+ 設定頁(**UI 從簡,前端將重構**) |
| M3 | schema 提案器:intent DSL + Zod/allowlist 驗證 + 非同步工作 |
| M4 | 核准 UI(逐表單 / 逐欄位可改)+ 走既有建表 API + audit |
| M5 | e2e 固化 + FMEA 覆核 |

⚠️ **前端從簡是刻意的**|2026-08-06 決策方確認前端要**連 IA 一起重想**(等於重寫)。
本模組把重量放在後端契約(provider 層 / intent DSL / 核准鏈),UI 做到能用即可 ——
它會跟著重構重畫,現在打磨是丟掉的工。

---

## 6. 版本

| 日期 | 版 | 內容 |
|---|---|---|
| 2026-08-06 | v1.0 | M0 APPROVED(OQ-AI-1..9 全採建議)。三站查完。站①**直接縮小了 scope**(Excel 型別推斷已有確定性解且比 LLM 可靠,AI 不碰);站②三個 SDK 逐檔讀 LICENSE 本文;站③**推翻一條轉述**(Ragic 建表吃問卷不吃檔案)並查出 **Ragic/Airtable 皆為原廠代購額度而非 BYO key** → 我方「用量顯示」語意須改寫。OQ-AI-1..9 待裁定 |
