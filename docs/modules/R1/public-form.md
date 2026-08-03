# public-form.md — [G-2] 公開表單設計文件

| | |
|---|---|
| 狀態 | ✅ **SHIPPED v1.0(2026-07-30)** — OQ-PF-1..8 全採建議 |
| 建立 | 2026-07-30 |
| 上游 | docs/25 §164「Public Form(對外收件)2」 |
| 依賴 | authz(欄位級權限 + 匿名 principal)· form-engine-core · file-storage(匿名上傳)· reliability(配額 / 限流) |

> **為什麼與 [G-1](webhook-and-events.md) 分開**|兩者同屬「對外接縫」但**威脅模型相反**:
> G-1 防的是「我們被誘導去打別人」(SSRF),G-2 防的是「別人灌爆我們 / 從我們這裡撈資料」。
> 合併會讓 FMEA 失焦。研究先落檔(OQ-WH-9=A),避免來源連結腐爛。

---

## 1. 目標與範圍

把一張內部表單開放給**未登入的外部人**填寫。ERP 定位下的典型用途是
「供應商填報價」「客戶下訂單」「應徵者投履歷」—— **不只是問卷**,
這一點決定了本模組與 Typeform / Tally 這類問卷平台的關鍵分歧(見 §4.5)。

### 現況
`grep` 全 `src/`:`publicForm` / `anonymous` **零命中**,全新。
可復用:欄位級權限系統(隱藏 / 唯讀 / 可寫)· 檔案上傳(MIME 白名單 + 大小限制,**尚無掃毒**)· throttler · audit。

---

## 0. 深度研究(2026-07-30)

### 0.1 公開表單暴露什麼

| 系統 | 決定暴露的機制 | 證據 |
|---|---|---|
| **Ragic** | **沿用同一套權限系統**:`EVERYONE` 群組(含未登入者)+ 表單級五等(無 / **問卷式** / 僅閱覽 / **佈告欄式** / 管理者)+ 欄位級三態;多群組取**最寬** | 官方明載 |
| **Airtable / Baserow** | **另建 form view 白名單挑欄**;Baserow 明載 form 分享者「無法檢視或編輯任何既有記錄」(結構性隔離) | 官方明載 |
| **Fillout** | 外掛層再收一次(動態過濾 linked record、限制可選筆數、hide+lock 不經 URL) | 廠商文件 |

🔴 **下拉 / 帶入欄是最大破口(已實證)**|Airtable 社群與支援一致確認:表單上放 linked record 欄,
填表者可看到**來源表全部記錄的 primary field**,且可被爬取;唯一緩解是把候選限縮到某個 view。

🔴 **prefill 不是安全機制**|Airtable 官方明文「hide 參數可被刪除,隱藏欄即現形」;
Ragic prefill 走 `pfv<欄位ID>=值`,同樣在 URL 明碼。

**自動編號枚舉**|無任何廠商文件討論(缺口)。但安全文獻明確(German tank problem / opaque ID):
連號單據洩漏總量與產生速率。**此為推斷,風險真實** —— 對 ERP 尤其(競爭對手可推算你一天幾張單)。

**編輯既有記錄**|三種成熟做法:Baserow「Edit row link」每列一組**加密隨機 token**(官方稱不可猜測);
Ragic 訪客 email 認證連結**單次使用、效期 1 個月、過期自動重發**;Jotform / Google Forms 用確認信內嵌 edit link。

### 0.2 濫用防護

| 系統 | 組合 |
|---|---|
| Jotform | basic CAPTCHA / reCAPTCHA · **Unique Submission**(cookie / cookie+IP / IP strict)· 到期或達提交數自動停用;honeypot 需自己用條件式做;**上傳檔案不加密** |
| Typeform | invisible reCAPTCHA(Plus 以上) |
| Tally | 依 **unique identifier**(IP / email / Respondent ID / 任意欄)防重複,免費 |

**OSS 自架 CAPTCHA(2026)**|**Cap** = Apache-2.0,PoW + instrumentation 雙層,最完整;
**Altcha** = MIT,純 PoW widget,需自接後端,最輕;
**mCaptcha** = AGPL-3.0,pre-1.0、發布緩慢;**Friendly Captcha 伺服器端專有 → 不符 OSS-only**。

🔴 **實效誠實話**|PoW **只提高成本不阻擋**(算得出就過);2026 研究顯示 AI solver 已可破多數 CAPTCHA。
**應視為摩擦層,不是閘門** —— 不要因為掛了 CAPTCHA 就省掉限流與配額。

**檔案**|OWASP 要求:驗 magic bytes · 隨機檔名 · 存 webroot 外 · **獨立網域** · Content-Disposition ·
**掃描完成前不可被存取**。自架解 = ClamAV worker 訂閱 bucket 事件 + quarantine prefix。
(Airtable 有掃毒僅為社群觀察,非官方政策文件。)

**配額耗盡**|**產業空白**。Jotform 僅承諾「若 spam 進來,支援團隊會視情況退帳」—— 沒有結構性防護。

### 0.3 生命週期

- **關閉條件**|Fillout 最完整(開放日 / 截止日 / 回應數上限 / 自訂關閉訊息 / 立即關閉);Tally 次之;Airtable 有開關 + 密碼保護
- 🔴 **重複提交**|**Google Forms 的「限制 1 次回應」強制登入**(官方)。這是誠實的結論:
  **不登入就無法可靠認定同一人**,cookie / IP 只是降噪
- **Save & resume**|Tally 有(付費;且 **partial 不觸發整合與通知**)· Fillout 有 · Airtable / Baserow **無**
- **提交後**|標配 = 感謝訊息 + 重導 URL(Baserow 支援 `{row_id}`)+「再填一次」+ 確認信含 edit link

### 0.4 與內部資料的接縫

- **created_by**|Airtable 公開提交一律記為 **Anonymous**(automation 建立的也是),可用此值過濾
- 🔴 **隔離**|**沒有人刻意隔離**。Airtable 反而提供專用 trigger「When a form is submitted」以便**區分**來源;
  Baserow 明載 edit-row-link 提交**會觸發** row-update 自動化
- **必填 / 唯一 / 公式**|未見廠商說明差異(推斷一致)。但**唯一值衝突的錯誤訊息對匿名者是 existence oracle**
  (可探測某 email / 統編是否已在庫)—— 此為推斷

### 0.5 Ragic 官方可查邊界

可查|權限五等 + `EVERYONE` + 欄位級三態 + 多群組取最寬;填表 URL / 原始 URL / QR / 網頁嵌入;
`pfv` prefill;訪客 email 認證(單次、1 個月);問卷式 = 只看自己新增、佈告欄式 = 可看全部。
**查不到**|公開表單是否有 CAPTCHA / 提交次數上限 / 截止日;公開表單上連結欄是否列舉來源表
(依其權限沿用模型,若 `EVERYONE` 對來源表無權限應看不到,但**未經證實**)。

### 0.6 誠實聲明:查不到的

Ragic 公開表單的 CAPTCHA / 提交上限 / 截止日 / 連結欄列舉行為 ·
各家對匿名上傳掃毒的官方政策(Airtable 僅社群觀察)· Fillout 的密碼與網域限制 ·
**任何廠商對「公開表單灌單導致配額 / 計費耗盡」的結構性防護**。

### 0.7 來源

Ragic|[存取權限](https://www.ragic.com/intl/zh-TW/doc/32/access-rights) · [建立問卷](https://www.ragic.com/intl/zh-TW/doc-kb/110/) · [訪客 email 認證](https://www.ragic.com/intl/zh-TW/doc/23/temporary-log-in-without-signing-up) · [分享這張表單](https://www.ragic.com/intl/zh-TW/doc-user/54/share-this-sheet) · [pfv 預填](https://www.ragic.com/intl/zh-TW/doc-kb/195/auto-fill-specific-fields-with-predefined-values-in-embedded-database-form)
Airtable|[建立與分享表單](https://support.airtable.com/docs/building-and-sharing-forms-in-airtable) · [prefill via encoded URL](https://support.airtable.com/docs/prefilling-a-form-via-encoded-url) · [社群:linked field 安全性](https://community.airtable.com/other-questions-13/forms-linked-field-security-20566) · [form submitted trigger](https://support.airtable.com/docs/when-a-form-is-submitted-trigger)
Baserow|[form view 指南](https://baserow.io/user-docs/guide-to-creating-forms-in-baserow) · [edit rows via form](https://baserow.io/user-docs/edit-rows-via-form) · [public sharing](https://baserow.io/user-docs/public-sharing)
其他|[Fillout 管理表單存取](https://www.fillout.com/docs/help/manage-form-access) · [Tally 防重複提交](https://tally.so/help/prevent-duplicate-submissions) · [Tally partial submissions](https://tally.so/help/partial-submissions) · [Jotform 防 spam](https://www.jotform.com/help/how-to-prevent-spam-form-submissions/) · [Jotform 讓使用者編輯](https://www.jotform.com/help/40-how-to-let-users-update-their-form-submissions-at-a-later-date/) · [Typeform spam prevention](https://help.typeform.com/hc/en-us/articles/35948010629396-Spam-prevention) · [Google Forms 限制 1 次回應需登入](https://support.google.com/docs/community-guide/395355672/google-forms-why-your-respondents-are-being-forced-to-login)
CAPTCHA / 安全|[Cap:OSS CAPTCHA 比較 2026](https://trycap.dev/guide/open-source-captcha) · [ALTCHA PoW](https://altcha.org/docs/v2/proof-of-work-captcha/) · [自架 captcha 深度比較](https://privatecaptcha.com/blog/self-hosted-captcha-comparison/) · [OWASP File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html) · [Opaque ID 防枚舉](https://apeleg.com/blog/posts/2023/03/30/enumeration-timing-uuids/)

---

## 4. 設計要點

### 4.1 🔴 沿用欄位級權限 **+ 二次閘門**,不要單純沿用

給匿名者一個 `anonymous` principal 套現有 `field_permissions`(對齊 Ragic 心智模型),
**另加一份公開發布白名單,取交集**。單純沿用有三個陷阱:

| 陷阱 | 說明 | 對策 |
|---|---|---|
| **A 預設繼承會漏** | 日後新增欄位若預設可見,「加一個成本欄」= 立即外洩 | 白名單 **opt-in,新欄預設 hidden** |
| **B 公式間接洩漏** | [authz.md §12.2 **F4**](authz.md) 已列為**已知殘留**:公式引用 hidden 欄,結果值間接透露。內部靠管理員紀律可接受 —— **公開表單不可** | **升為硬規則**:公開欄不得引用非公開欄,**設計期 block** |
| **C Link&Load 候選清單** | Airtable 實證的最大洩漏:下拉列舉來源表全部記錄 | 綁「來源檢視 + 伺服器端搜尋(minLength ≥2)+ 回傳上限 + 只回顯示欄」,**禁全量列舉**;Load 帶入值一律伺服器端計算 |

> 🔴 **B 的意義超出本模組**:同一段程式碼、同一個殘留,**觀眾從內部換成匿名者,P1 就變成 P0**。
> 既有風險評級是綁定威脅模型的,開放新入口時必須重評,不能沿用舊評級。

### 4.2 其餘設計要點

- **自動編號**|回執只給不透明 token(ULID / HMAC),**單號留內部**;必須外露時採隨機化或非連續
- **編輯既有記錄**|Baserow(每筆高熵 token)+ Ragic(email 一次性、限期)混合:
  token 綁 `tenant_id+form_id+record_id`、**存 hash**、有 TTL、可撤銷、單次兌換成短期 cookie
- **濫用分層**|honeypot + 最短填寫時間 + **Altcha(MIT)自架 PoW** + 現有 throttler(IP × 表單雙鍵)
  + 高價值表單(報價 / 訂單)用 email OTP。**PoW 是摩擦層不是閘門**(§0.2)
- **檔案**|匿名上傳先進隔離 bucket,**ClamAV 掃完才落記錄**;獨立網域 + Content-Disposition。
  **這是目前平台最大缺口**(#102 已列)
- **配額**|per-form 提交上限 + per-tenant 匿名寫入日配額 + kill switch。
  **ERP 場景下灌單 = 假採購單汙染主檔,比計費更嚴重** —— 這正是產業空白處(§0.2)
- **created_by 不用 NULL**|建系統 actor `anonymous:public_form`,記錄打 `source=public_form` 旗標,
  share_id / IP hash / UA 進 audit
- **唯一值衝突訊息**|對匿名者回制式訊息,不揭露「此值已存在」(existence oracle)

### 4.3 🔴 與問卷平台的關鍵分歧:預設隔離

**公開提交落「待審收件匣」(狀態=待驗),由內部人 promote 才進簽核流與正式編號。**

各家問卷平台**都不隔離**(Airtable 甚至提供 trigger 方便你串自動化),
因為問卷沒有這個需求。但 ERP 定位下,一筆匿名提交直接觸發簽核與正式單號是不可接受的。
**這是本平台刻意不照抄業界的地方**,理由寫在此以免日後被當成缺漏補回去。

---

## 3. 實作結果

| | |
|---|---|
| commit | `e00e574` 後端 · `3e91327` DI 修正 · `1e3a3f7` 前端 |
| migration | 0035(`public_form_share` / `public_submission`)|
| 測試 | api **692 綠**(公開表單 16)· web 87 · e2e 4 |
| 反向驗證 | 白名單過濾 / 危險型別閘門 / 不可探測 —— 拔掉即 6 條轉紅 |

**與原設計的差異**|OQ-PF-3(Link&Load 伺服器端搜尋)未實作,改採更強的處置:
**link 型別一律不得公開**。研究實證這是最大破口(Airtable 社群與支援一致確認
表單上的 linked record 欄會讓填表者看到來源表全部記錄的 primary field 且可被爬取),
而「伺服器端搜尋 + 上限」仍然會逐步洩漏來源表內容。P0 先關死,
真有需求時再以「限定來源檢視 + 最小查詢長度 + 回傳上限」開放,列後續。

OQ-PF-5 的 Altcha 未接:目前是 **honeypot + 最短填寫時間 + throttler(IP × token)**。
研究已言明 PoW **只提高成本不阻擋**(2026 研究顯示 AI solver 已可破多數 CAPTCHA),
是摩擦層而非閘門 —— 既有三層都在,補 Altcha 屬增量而非缺口,列後續。

OQ-PF-8(編輯既有記錄的 magic link)未實作 —— P0 沒有「讓外部人回頭改」的需求,
不預先造。

### 2026-08-03 殘留複審(#121)

**OQ-PF-6 匿名附件:技術阻塞已解除,但不等於可以開。**
原記「待 ClamAV 掃毒就緒後才可開」——**F-11 上傳掃毒已於 2026-07-30 SHIPPED**,
那個前提現在成立了。但把 `attachment` / `image` / `signature` 從公開禁用清單移除
**還缺三件**,少任何一件都是「開了一個未認證的上傳入口」:

1. **per-share 開關** —— 不能因為某張表能公開就讓它的附件欄一併公開;
   開放範圍要逐個分享連結決定。
2. **獨立配額** —— 匿名上傳不屬於任何使用者,吃的是租戶的儲存額度。
   沒有獨立上限的話,一個公開連結就能把租戶的空間灌爆(§0.6 已記:
   **業界對「公開表單灌單導致配額耗盡」無任何結構性防護**,我方得自己設)。
3. **未 clean 逾時自動刪** —— 掃毒是非同步的,`pending` 的檔案不能無限期留著。

→ 現況(一律禁)是**安全且自洽**的,不是半成品。開放與否已從技術問題變成
**產品決定**;真要開時三件前提一起做,並重評 §4.1-B(匿名觀眾使既有 P1 升為 P0)。

**OQ-PF-5 Altcha / OQ-PF-8 magic link:維持不做,理由不變。**
前者研究已言明 PoW 只提高成本不阻擋(AI solver 已可破多數 CAPTCHA),
既有三層都在,它是摩擦層而非閘門;後者沒有消費者。
**觸發條件**:Altcha 等到實際觀測到 honeypot + 時間閾值 + throttler 擋不住的灌單;
magic link 等到真有「外部人要回頭改自己送出的單」的需求。

---

## 10. 開放問題(OQ-PF-N)— ✅ 2026-07-30 全採建議

| # | 問題 | 建議 |
|---|---|---|
| **OQ-PF-1** ⭐⭐ | 欄位暴露模型 | **沿用權限 + 公開白名單取交集**,新欄預設 hidden(§4.1) |
| **OQ-PF-2** ⭐⭐ | 公式引用非公開欄 | **設計期 block**(F4 由 P1 升 P0) |
| **OQ-PF-3** ⭐⭐ | Link&Load 候選 | **伺服器端搜尋 + 上限,禁全量列舉** |
| **OQ-PF-4** ⭐ | 自動編號外露 | **不外露**,回執給不透明 token |
| **OQ-PF-5** ⭐ | 濫用防護組合 | honeypot + 時間閾值 + **Altcha** + throttler(+ 高價值表單 email OTP) |
| **OQ-PF-6** ⭐⭐ | 匿名上傳 | **掃毒完成前不可存取**;掃毒未就緒前 **公開表單預設禁附件** |
| **OQ-PF-7** ⭐⭐ | 是否進簽核 / 自動化 | **預設隔離,待審收件匣 + 人工 promote**(§4.3,刻意不照抄業界) |
| **OQ-PF-8** | 編輯既有記錄 | 高熵 token + hash 存 + TTL + 可撤銷 |

---

## 13. 變更紀錄

| 日期 | 版本 | 變更 | 作者 |
|---|---|---|---|
| 2026-07-30 | **v1.0** | **SHIPPED**。OQ-PF-1..8 全採建議。交付:opt-in 欄位白名單(排除制在「日後有人加一個成本欄」那一刻就外洩)· 危險型別設計期閘門 · **匿名提交落待審收件匣不進動態表** · 關閉條件(截止 / 上限 / 手動,且計數與提交同一 tx)· honeypot + 最短填寫時間 + throttler · IP 只存加鹽 hash · 回執給不透明代碼 · `/f/[token]` 訪客頁(不用 `/app` layout,無任何內部 chrome)· 設定頁與收件匣。**🔴 瀏覽器實走抓到一個所有靜態防線都攔不住的 bug**:控制器用裸建構子參數 `constructor(private readonly forms: PublicFormService)`,而本專案 tsconfig 未開 `emitDecoratorMetadata` → Nest 注入 undefined,打那條路由就 500。type-check 過(型別是對的)、16 條整合測全綠(直接 new 服務、繞過 DI)、lint 無話說 —— **只有把 app 跑起來打那條路由才會炸**。已 sweep 全 src 確認僅此一處。**與原設計的差異**:OQ-PF-3 改採更強處置(link 一律不得公開,而非伺服器端搜尋);Altcha 與 magic link 列後續,理由見 §3。api 692 · web 87 · e2e 4 | Claude Code |
| 2026-07-30 | v0.1 | M0 DRAFT(研究先落檔,實作排 G-1 之後,OQ-WH-9=A)。**§0.1 最大發現**:下拉 / 帶入欄是已實證的洩漏破口 —— Airtable 社群與支援一致確認表單上的 linked record 欄會讓填表者看到**來源表全部記錄的 primary field** 且可被爬取;**prefill 不是安全機制**(Airtable 官方明文 hide 參數可刪、Ragic `pfv` 明碼在 URL)。**§4.1-B 對本專案的關鍵推論**:[authz.md §12.2 F4](authz.md)(公式引用 hidden 欄間接洩漏)是**已存在的 P1 殘留**,內部靠管理員紀律可接受,但**觀眾換成匿名者後同一個洞就是 P0** —— 既有風險評級綁定威脅模型,開放新入口時必須重評。**§0.2 誠實話**:PoW CAPTCHA 只提高成本不阻擋,2026 研究顯示 AI solver 已可破多數 CAPTCHA,應視為摩擦層而非閘門;OSS 可用者 Cap(Apache-2.0)/ Altcha(MIT),**Friendly Captcha 伺服器端專有不符 OSS-only**。**§0.3**:Google Forms 的「限制 1 次回應」**強制登入** —— 誠實結論是不登入就無法可靠認定同一人。**§4.3 刻意不照抄業界**:各家問卷平台都不隔離公開提交(Airtable 反而提供 trigger 方便串接),但 ERP 定位下匿名提交直接觸發簽核與正式單號不可接受 → 預設落待審收件匣。**§0.6 產業空白**:無任何廠商對「公開表單灌單導致配額耗盡」有結構性防護。OQ-PF-1..8 待裁定 | Claude Code |
