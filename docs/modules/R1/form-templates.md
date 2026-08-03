# form-templates.md — [R1·B-2] 表單範本庫

| | |
|---|---|
| 狀態 | 🚧 **APPROVED(2026-08-03,OQ-TPL-1..8 全採建議)— 進 M1** |
| 建立 | 2026-08-03 |
| 上游 | `docs/04` B「快速範本 / 表單範本庫」(2 人月,列了但**全庫無實作**)· task #152 |
| 一句話 | 對不會寫程式的使用者,**空白畫布與「訂便當系統」範本是完全不同的兩件事** —— 這是留存分水嶺,不是加分項 |

---

## 0. 站在巨人的肩膀

### 0.1 巨人一:自家 repo(對碼,2026-08-03)

| 事實 | 意義 |
|---|---|
| 建表 API = `createFormSpecSchema { name, parentFormId?, fields[] }` | **範本本質上就是一份存起來的 CreateFormSpec** |
| Excel 匯入建表已是「推斷結構 → 建表」管線(`P0-2` SHIPPED) | 範本套用可以站在它上面,不必從零長一套 |
| 🔴 **`link` 欄位把 `targetFormId`(真實 id)存在 `field_def.options`** | 多表範本套用時**必須重指** |
| 🔴 按鈕的 `pushTo{targetFormId, fieldMap}`、簽核的 `approverRoleId`、`view_def` 的欄位 id **同樣是真實 id** | 重映射的面比想像大 |
| 一張「完整可用的表單」還含:`layout`(2D 版面)· `view_def` · 條件式格式 · 按鈕 · 簽核定義 · `categoryId` | 「範本涵蓋多少」是核心 OQ |

**一切都是 metadata(條件 ② 成立),但 id 重映射本身就是本模組的主要工程量** ——
不是「存一份 spec 再灌回去」那麼簡單。

### 0.2 🔴 巨人二:四家競品 —— **範本的單位是「容器」,不是「表」**

一手依據取自官方文件本地鏡像(`reference-materials/`),查證日 2026-08-03。
Notion / NocoDB / Salesforce 不在本地庫,**未查證**。

| | 逐字 |
|---|---|
| **Ragic** | 「從應用商店安裝我們設計好的模組…**大多模組包含多張表單,且彼此的連結關係已經建立好,有相對完整的架構**」(`doc/37`);「因為應用商店的一個範本經常由**一組表單組成**的(不只一張表單),我們也叫它『免費範本模組』」(`doc-kb/204`)|
| **Teable** | `POST /base/create-from-template`,參數 `spaceId, templateId, withRecords, baseId?` → 範本單位是 **base(整個庫,含多表)** |
| **Baserow** | 「A template consists of **one or more applications** that will be copied into the desired workspace」 |
| **Airtable** | template = 一整個 base;managed app = 「reusable configurations of Airtable base structure and functionality(**data schema, automations, and interfaces**)」 |

**四家一致(強證據)。** 而這直接**推翻本模組原本的直覺設計**:
不該做「單表範本 + 套用後重指」,而該做**範本包**(一組 form,包內以相對代號互指),
套用時單一交易建全部表 → 建 `templateRef → newFormId` 映射 → 回填 `targetFormId`。
**link 重指的難題被「容器邊界」解掉了** —— 關聯只存在包內。

⚠️ **Ragic 走的是另一條路,值得知道但不建議照抄**:保留 ID 命名空間 ——
「使用者自己建立的欄位編號會是 **1000 開頭**…從應用商店安裝的範本模組表單,
欄位編號則會是 **2000 開頭(英文版模組)或 3000 開頭(中文版模組)**」(`doc-kb/176`)。
即範本自帶穩定 ID 而非套用時重編號。對多租戶動態表而言這是很強的主鍵約束,不採。

### 0.3 範例資料:Teable 的一個布林解掉整個問題

- **Teable**:`withRecords: boolean` —— **由呼叫端決定帶不帶**,不需要事後清。
- **Airtable** 帶 sample data,清除法官方明列兩種,並自己警告:
  「if you close out of the sidebar shown on the right, then you will **not be able to find this option at a later time**」
  → 🔴 **清範例資料是常態需求,不該藏在一次性的 onboarding 側欄裡。**
- **Airtable managed app 則明說不帶資料**:「Managed apps and components **typically do not include record data**」,但**含 automations 與 interfaces**。
- Ragic 範本是否附範例資料:**本地文件未明說,未查證。**

### 0.4 🔴 治理:Ragic 是四家中最完整的策展模型

`doc-kb/268` 逐字流程:① 申請成為合作夥伴 → ② 申請開立**專屬「範本資料庫」帳號**
(3 個月期限;**無法使用備份還原**)→ ③ 沙箱內設計 → ④ 提交名稱 / 簡介 / **表單截圖** / 說明文件 →
⑤「若**審核通過**,Ragic 將提供一個專屬的『**範本模組 ID**』」→ ⑥ 收費模組由平台**處理後續金流**。

= **沙箱隔離 + 人工審核 + 官方發 ID + 平台代收金流**。

- **Airtable 明確兩層**:官方 templates「developed and managed by the **Airtable team**」
  vs Universe「created and published by **Airtable users**」(自助發布,有
  「Show extensions in published base」開關 —— 擴充套件是安全面,交發布者控制)。**是否有審核:未查證。**
- **Baserow = 開源治理**:範本是 repo 內 `backend/templates/*.json`,靠 merge request 貢獻;
  刻意說明「We keep all the templates as JSON files so that **everyone who self hosts also has access them**」
  → 對我方 on-prem 客戶有額外價值。
- **Teable = 組織內部範本中心**,且「You must **publish a snapshot** before you can list the template」。

### 0.5 🔴 範本更新:懷疑只對了一半 ——「要能更新,就必須先鎖」

原本假設「各家都不處理」。實際是**做的人把它當成另一個產品**:

> **Airtable(企業版 App Library,不是 template gallery)**逐字:
> 「When a managed app or component is added to a child base, its configuration is **locked**.
> Managed apps and components can be **updated by publishing changes from their development base**.
> After changes have been published, any user with creator permissions in one of the child bases can
> **choose to update that app or component asynchronously**.」
> 且「any schema that was included in the original managed app or component **cannot be modified
> except at the global level**(unless the component is converted to be unmanaged)」。

**承重結論:「可更新」與「可自由改」不可兼得。** Airtable 用**所有權分層**解
(global schema 鎖住 / child base 可加自己的東西,但只存在該 base)。

- **Ragic 有更新入口**:「點選**取得**即可安裝。(**如果已經安裝過的模組,則會顯示 更新**)」(`doc/37`)。
  **更新語意與衝突處理未查證** —— 但它的保留 ID 段(2000/3000)正是讓更新可對位的前提。
- **Ragic 另有一條可用的分類線**:改過的範本表單會計入「客製化表單」額度 →
  系統**明確區分「未修改的範本表單」與「已客製表單」**。
- Airtable template gallery / Universe **複本即脫鉤**,未見更新機制。
- Teable / Baserow:未查證。

### 0.6 範本 vs AI 生成:訊號衝突,不宜當硬結論

- **Airtable 官方在範本文件頂端反向推 AI**:「Note **We recommend using Omni to experience a
  more customized app building experience.**」(Omni 能建 table / view / field / interface / automation,
  且「will **mirror the same permission settings of the user**」;邊界明確:
  「It **cannot create Gantt or blank page layouts**」「form editing is **not supported**」)
- **Ragic 把 AI 定位為拋棄式雛形**(`doc-kb/111`):「Ragic AI 會根據你的需求描述快速產生資料庫雛形…
  完成後,仍可依需求手動新增表單、**重新整理表單之間的關聯**…或是優化流程後,
  **再請 Ragic AI 重新建立一次資料庫**」,並總結「目的在於**快速建立資料庫雛形並進行嘗試與調整**」。
- Ragic 的建表入口共 **5 個**,且範本分兩層:空白 / **應用商店模組(多表 + 關聯)** /
  **快速範本(單張,較基礎)** / 匯入試算表 / Ragic AI。

**兩家方向相反 → 依〈向上設計三條〉條件 ①,不得當成硬結論。**

### 0.7 ⚠️ 範本庫的**分類軸**:未查證(而這一題比想像重要)

四家的範本**單位**查得很清楚(§0.2),但**範本庫怎麼分類**在本地鏡像裡查不到 ——
Ragic 應用商店的分類體系在商店站上,不在 `doc/` 與 `doc-kb/` 內;
Airtable gallery 的分類同理。**依〈向上設計三條〉條件 ①,標未查證,不當依據。**

**唯一查得到的線索**是 Ragic 的兩層範本本身帶著一種分軸:
應用商店模組(多表 + 關聯,偏**情境**)vs 快速範本(單張,偏**單一職能**)。
不足以推論它的一級分類是產業還是職能。

🔴 **但缺這一節不是「少一段研究」,而是讓 v0.1 直接把定位講反了** ——
沒有分類軸這一題,「放什麼範本」就退化成憑手邊最熟的情境挑,
而手邊最熟的是首波 pilot 的食品加工。見 OQ-TPL-8 與更正欄。

---

## 1. 目標與範圍

### 1.1 目標

1. 新使用者建表時,除了「空白」與「Excel 匯入」,多一條**「從範本開始」**。
2. 範本是**應用級**(一組表單 + 關聯),不是單表。
3. 套用**要嘛全成、要嘛全不成**(單一交易),不留半套的表。
4. **範本庫本身不得把定位講反** —— 主軸是職能不是產業(OQ-TPL-8)。
5. **範例資料可選**,且清除不是隱藏功能。

### 1.2 明確不做

- ❌ **社群 / 市集 / 金流** —— Ragic 那一套(沙箱 + 審核 + 發 ID + 代收金流)是**另一個產品**。R1 只做官方內建。
- ❌ **AI 生成範本** —— 見 §0.6,訊號衝突;且 docs/17 v2 已把 AI 定位為 table stakes。
- ❌ **範本更新已套用的實例** —— 見 §0.5,要做就得先鎖,而**鎖住客戶自己建的表與我們的定位相衝**(OQ-TPL-6)。
- ❌ 跨租戶分享自製範本 —— 治理面未定,R1 不開。

---

## 2. 開放問題(OQ-TPL-N)— ✅ **已裁定 2026-08-03(全採建議)**

> 🔴 **OQ-TPL-8 於 v0.2 重裁,OQ-TPL-9 / 10 為新增**(原 OQ-TPL-8 的裁定作廢,理由見更正欄)。
> M4 依修訂後的建議實作。OQ-TPL-1..7 的裁定不受影響。

| # | 議題 | 選項 | 建議 |
|---|---|---|---|
| **OQ-TPL-1** ⭐⭐ | 範本的單位 | A. 單表範本<br>B. **範本包(一組 form + 包內關聯)**<br>C. 兩者並存(Ragic 形態:應用商店模組 + 快速範本)| **B** —— 四家一致(§0.2,強證據),且**容器邊界正好解掉 link 重指的難題**。C 是 Ragic 的做法,但兩層範本要兩套 UI 與兩套治理;**單表範本可由「只含一張 form 的包」自然表達**,不需要獨立機制 |
| **OQ-TPL-2** ⭐⭐ | 包內如何互指 | A. **相對代號**(`{ ref: "orders" }`),套用時建 `ref → newFormId` 映射<br>B. 存真實 id,套用後掃描重寫<br>C. Ragic 式保留 ID 命名空間 | **A** —— B 需要在寫入後回頭掃描全部 metadata(`field_def.options` / 按鈕 config / view_def / 簽核),**漏一處就是壞掉的關聯而且不會報錯**;A 讓「沒對應到的 ref」在**套用前**就驗得出來。C 對多租戶動態表是很強的主鍵約束,不採 |
| **OQ-TPL-3** | 範本涵蓋多少 | A. 只有欄位<br>B. **欄位 + 版面 + 視圖 + 條件式格式 + 分類**<br>C. B + 按鈕 + 簽核定義 | **B 起步,C 列 P1** —— A 交付不出「打開就能用」的觀感,而那正是範本的價值。C 的按鈕與簽核會牽扯**角色 id**(`approverRoleId`),而角色是租戶自己的,映射語意未定(OQ-TPL-7);先不做,並在範本說明中明講「不含簽核流程」 |
| **OQ-TPL-4** | 範例資料 | A. **一個布林 `withRecords`**(Teable 形態)<br>B. 一律帶,提供清除<br>C. 一律不帶 | **A** —— 一個參數同時解掉「要不要帶」與「事後怎麼清」。**B 是 Airtable 的做法而它自己踩了坑**:清除入口藏在一次性側欄,官方文件得補一段 workaround(§0.3)|
| **OQ-TPL-5** | 套用的原子性 | A. **單一交易,全成或全不成**<br>B. 逐表建,失敗就停 | **A** —— B 會留下「建了 2 張、第 3 張失敗」的半套應用,而使用者**看不出來少了什麼**(他沒看過完整版)。且動態建表是 DDL,半套的清理很痛 |
| **OQ-TPL-6** | 套用後與範本的關係 | A. **複本即脫鉤**(Airtable gallery / Universe 形態)<br>B. 鎖住範本部分、允許局部擴充(Airtable managed app 形態)<br>C. 先脫鉤,但**記錄來源與版本** | **C** —— A 是最省的,但「以後想更新就永遠補不回來」;B 的鎖與我方定位相衝(**客戶自己建自己改是 Ragic 範式的核心**,見 AGENTS 第一約束)。C 只是多存 `template_key + version + appliedAt`,**成本近零而選項留著**;Ragic 也有類似的「原樣 vs 已客製」分類線(§0.5)。⚠️ **這是「現在不記以後補不回來」的那種決定** |
| **OQ-TPL-7** | 範本要不要帶角色 / 權限 | A. **不帶,套用後沿用租戶現有預設**<br>B. 帶角色定義並自動建立 | **A** —— 角色是租戶的組織結構,範本無從得知;B 會在客戶既有的權限樹裡塞進陌生角色。與 OQ-TPL-3 之 C 同源:**簽核與按鈕留 P1,正是因為它們綁角色** |
| **OQ-TPL-8** ⭐⭐ | **範本的分類軸** | A. **產業別**(食品加工 / 團膳 / 製造…)<br>B. **職能別**(請購 / 報修 / 盤點 / 客戶名單…)<br>C. **兩軸並存:職能為主軸,產業為 pack** | **C** —— ⚠️ **v0.1 沒有這一題,而那是本檔最大的錯**(見下方更正欄)。**A 不能當主軸**:`docs/04 v1.5` 明文「產品定位重申為**多產業通用** SaaS(**非食品業垂直**)…全域中性化食品業特化語言」,範本庫是使用者第一眼看到的東西,**主軸放產業等於用範本庫把定位講反**。**B 才貼近使用者的提問** —— 他問的是「我想做某件事」不是「我屬於哪個產業」。但純 B 會讓 pilot 客戶找不到 HACCP 那類東西,而 pipeline 17 家集中食品 / 團膳 → **產業做成 pack**(可選安裝),兩者不互斥 |
| **OQ-TPL-9** 🆕 | R1 首發集怎麼組 | A. 全部通用職能<br>B. 全部食品加工<br>C. **通用職能 4–6 個 + 食品加工 pack 2–3 個** | **C** —— **範本的價值在背書不在數量**(10 個看不懂的比 3 個他認得的更糟),故總數維持個位數。通用職能建議:請購申請 · 設備報修 · 庫存盤點 · 客戶 / 供應商名單 · 會議紀錄;食品 pack:進貨驗收 · 每日清潔紀錄 · CCP 監控。⚠️ **B 是 v0.1 的錯誤答案** |
| **OQ-TPL-10** 🆕 | 範本帶進來的分類怎麼處理 | A. **建議值:同名則沿用,否則建立**<br>B. 強制建立範本指定的分類<br>C. 不帶分類,一律落未分類 | **A** —— 對碼發現 **`form_categories` 沒有預設 seed**,也就是說**範本帶進來的分類會實質決定租戶的分類體系**(v0.1 在 OQ-TPL-3 說「範本涵蓋分類」時沒想到這個後果)。B 會在客戶既有的分類樹裡塞進陌生節點(同 OQ-TPL-7 之於角色);C 讓範本一裝進來就散在未分類,失去「打開就能用」的觀感 |

---

## 3. 資料模型(草案,待 OQ 定案)

```
範本本身不進 DB —— 以**版控中的 JSON** 為來源(Baserow 形態:
「everyone who self hosts also has access them」),隨程式碼一起發布。
理由:R1 不做社群範本,DB 化只會多一套沒有寫入者的 CRUD。

form_def 加(OQ-TPL-6 = C):
+ template_key   text | null   -- 來源範本
+ template_version text | null -- 套用當時的版本
```

---

## 4. 里程碑(草案)

| M | 內容 |
|---|---|
| M1 | 範本包格式(JSON schema)+ 相對代號解析 + `ref → formId` 映射;**一個範本 fixture 走完單一交易套用** |
| M2 | 版面 / 視圖 / 條件式格式 / 分類的帶入 + `withRecords` |
| M3 | 建表入口第三條路(與空白、Excel 匯入並列)+ 範本預覽 |
| M4 | 首發範本集:**通用職能 4–6 個 + 食品加工 pack 2–3 個**(OQ-TPL-9)|
| M5 | FMEA + e2e + docs/25 回填 |

≈ 0.4–0.6 人月(docs/04 原列 2 人月為含社群 / 市集的完整版)。

---

## 13. 變更紀錄

| 日期 | 版本 | 變更 | 作者 |
|---|---|---|---|
| 2026-08-03 | v0.2 | 🔴 **review 指出 v0.1 最大的錯:首發範本集是垂直的,而那牴觸我方定位。** v0.1 的 OQ-TPL-8 把「數量」與「分類軸」混成一題,並挑了進貨驗收 / 清潔紀錄 / CCP 監控 / 訂便當 —— **四個裡三個是食品 / HACCP**,而 `docs/04 v1.5` 明文「產品定位重申為**多產業通用** SaaS(**非食品業垂直**)…全域中性化食品業特化語言」。**範本庫是使用者第一眼看到的東西,主軸放產業等於用範本庫把定位講反。** 拆成三題:OQ-TPL-8 分類軸(**職能為主軸、產業為 pack**)· OQ-TPL-9 首發集組成(通用職能 4–6 + 食品 pack 2–3)· **OQ-TPL-10 範本帶進來的分類怎麼處理** —— 對碼發現 `form_categories` **沒有預設 seed**,即**範本會實質決定租戶的分類體系**,而 v0.1 在說「範本涵蓋分類」時完全沒想到這個後果。⚠️ 競品的範本分類體系(Ragic 應用商店的分類軸)**未查證** —— 不在文件鏡像內。 | Claude Code |
| 2026-08-03 | v0.1 | M0 DRAFT。**§0.1 自家 repo 對碼**:範本本質是存起來的 `CreateFormSpec`,但 `link` 的 `targetFormId`、按鈕 `pushTo`、簽核 `approverRoleId`、`view_def` 欄位 id **全是真實 id** → **id 重映射才是主要工程量**。**§0.2 四家競品一致(強證據):範本的單位是「容器」不是「表」** —— 這直接推翻本模組原本「單表範本 + 套用後重指」的直覺,改為**範本包 + 包內相對代號**,而容器邊界正好解掉 link 重指的難題。**§0.5 原本假設「各家都不處理更新」只對了一半**:Airtable 企業版 App Library 明說會做,但代價是**套用後配置被鎖**(「its configuration is **locked**」)—— 承重結論「**要能更新,就必須先鎖**」,而鎖與我方「客戶自己建自己改」的定位相衝,故採「先脫鉤但記錄來源與版本」。**§0.3 Airtable 自己踩的坑**:清範例資料的入口藏在一次性側欄,關掉就找不到 → 採 Teable 的 `withRecords` 布林。**§0.6 範本 vs AI 訊號衝突**(Airtable 在範本頁反推 Omni、Ragic 把 AI 定位為拋棄式雛形)→ 依條件 ① 不當硬結論。OQ-TPL-1..8 待裁定 | Claude Code |
