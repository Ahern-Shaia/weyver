# [E-1] 動態權限(記錄範圍 + 指派)

> ✅ **狀態:SHIPPED v1.0(2026-07-29,M1→M4 完成)**|OQ-DP-1..10 已裁定(全採建議)· **v0.2 三路補研究(含 30 萬列實測)推翻 v0.1 的核心架構決定**,見 §0.6
> **上游**|docs/04 §E「動態權限(依欄位值判斷)| ✅ | ✅(業務只能看自己客戶)| 4 人月」· docs/25 §E(⬜)· 承 P0-4a 三層權限 + authz-resource-inheritance
> **緣由**|docs/25 v1.5 覆蓋率彙總後定為下一批第一順位 —— 「業務只看自己負責的客戶」是 Ragic 客戶普遍在用的能力,而 Weyver **目前完全沒有**:表單可見即該表**所有記錄**可見。

---

## 0. 證據(clean-room:只讀公開文件)

### 0.1 ⚠️ **Ragic 不是用「條件規則引擎」做這件事** —— 這推翻了本模組原本的假設

docs/04 E 段把它記為「動態權限(**依欄位值判斷**)」,聽起來像 Salesforce 的 criteria-based sharing rules。
翻本機 Ragic 文件後確認:**Ragic 根本沒有條件規則引擎**。它用兩個更簡單的機制組合出同樣的效果。

**機制一|存取權限層級**(`doc/32`)—— 每**群組 × 每表單**一個層級,又是一個**有序 enum**:

| 層級 | 閱覽 | 新增 | 修改 |
|---|---|---|---|
| 無權限 | 看不到任何資料 | ✗ | ✗ |
| **問卷式使用者** | **自己新增及被指派的** | ✓ | **自己新增及被指派的** |
| 僅閱覽 | 所有資料 | ✗ | ✗ |
| **佈告欄式使用者** | 所有資料 | ✓ | **自己新增及被指派的** |
| 管理者 | 所有資料 | ✓ | 所有資料 |

> **「自己新增的 + 被指派的」是內建在層級語意裡的記錄級述詞**,不是使用者自己寫的條件。

**機制二|指派**(`doc/54`)—— **由欄位的值驅動**,不是由規則驅動:
- 表單放一個「**選擇使用者**」欄位,勾選「給予選取的使用者這筆**資料管理**權限」
- 也可用「**選擇群組**」欄位指派給群組(可另勾「通知被指派群組成員」)
- **但仍受表單級層級所限**|明載:「使用者在表單的存取權限為**無權限**或**僅閱覽**,即使成為被指派資料的資料管理者,因為實際權限仍受表單存取權限所限制,所以**無法有閱覽或編輯的權限**」
- **子表格的指派不給資料管理權**(只有獨立欄位可以)

**所以「業務只看自己客戶」在 Ragic 的實際作法是**:該業務群組設為**問卷式使用者** + 客戶表上放「選擇使用者」欄位指派負責業務。**全程沒有任何條件式規則。**

### 0.2 企業級對照(網路研究)

| 系統 | 模型 | 關鍵限制(官方) |
|---|---|---|
| **Salesforce** | **Criteria-Based Sharing Rules**(依欄位值)+ Owner-Based + Role Hierarchy 自動繼承 | 每物件 300 條規則,**criteria-based 上限 50 條**;**不支援 lookup / 公式 / 加密 / 任何衍生欄位**當條件;**預先計算存進 `__Share` 表**,重算**非同步**,>200 萬列需開 Defer Sharing Calculations;資料傾斜 1:10,000 起退化 |
| **Odoo** | `ir.rule` domain,**查詢時注入 WHERE** | **global rules 交集(AND)、group rules 聯集(OR)**,兩者再交集 → **加第一條 group rule 反而收緊**;無適用 rule 即**放行**;官方警告多條 global rule 易造出「不重疊 ruleset → 完全無存取」 |
| **Airtable** | **沒有**依欄位值的記錄級權限 | Interface 的 current-user 過濾只是**視覺呈現**,base 層仍全可見 → **不是安全邊界** |
| **Notion** | 有 page-level 規則,但**只能綁 Person 型屬性**(Assignee / Owner / Created by),不支援一般欄位條件 | 限 Business/Enterprise |
| **Monday** | column-level + board-level,**無**原生依欄位值的列限制 | |

> **兩個重要判讀**:
> 1. **「任意欄位值 → 決定記錄可見性」實質上只有企業級 CRM/ERP 才有。** 這是 Weyver 對 Airtable 類產品的真差異化,但也代表**沒有現成的「非工程師友善 UI」可抄**。
> 2. **Notion 的作法(只綁 Person 型屬性)與 Ragic 的「選擇使用者欄位」是同一個思路** —— 兩個消費級/準企業級產品獨立收斂到同一個受限模型,這是強訊號。

### 0.3 架構取捨:預先計算 vs 查詢時注入

| | 預計算 share table(Salesforce) | 查詢時注入 WHERE(Odoo) |
|---|---|---|
| 讀取效能 | 穩定,與規則數解耦 | 隨述詞複雜度退化;**子查詢是懸崖** |
| 寫入成本 | 高(記錄寫入 / 規則變更 / 成員變更**三個來源**都要重算) | 零 |
| **即時正確性** | **弱** —— 非同步重算有延遲窗口 | **強** —— 下一個 query 即正確 |
| 體積 | 記錄 × 使用者,會爆 | 無 |
| **動態欄位友善度** | **差**(schema 變動觸發全面重算) | 好 |

**對 Weyver 的判斷**|表單與欄位皆為使用者動態建立、租戶數十家、單表數萬至數十萬列 →
**採查詢時注入,不做預計算**。預計算需要 Salesforce 等級的非同步重算基礎設施(defer 開關 / 完成通知 / 傾斜監控)才撐得住,對 solo 維運是負債。

### 0.4 ~~PostgreSQL RLS 能不能表達動態規則?~~ ⚠️ **v0.2 已被 §0.6 實測推翻**

- **可以但不該**|RLS policy 適合**簡單等值**(`tenant_id = current_setting(...)`,可 pushdown 到索引,實測成本近乎零)。
- **已知地雷**|policy 內的**子查詢會每列執行一次**;policy 呼叫**非 `LEAKPROOF`** 的函數會讓 planner 不敢 pushdown → **退化成 seq scan**;缺 `tenant_id` 為首欄的複合索引 → 慢兩個數量級。
- ~~**結論**|RLS 維持只做租戶兜底,動態述詞放應用層。~~ **⚠️ 此結論錯誤**:上述地雷對**複雜** policy 成立,對本模組的**簡單述詞**不成立。§0.6 實測顯示 `AS RESTRICTIVE` policy 與應用層注入**執行計畫完全相同、零效能代價**,且結構上更安全。**以 §0.6 為準。**

### 0.5 真實外洩案例:規則對了,但管理員理解錯

2023 年 Krebs / Varonis 揭露大量 Salesforce Community 因 guest user 的記錄分享設定錯誤而外洩 SSN 與銀行帳號(含佛蒙特州 PUA)。Salesforce 定調為**客戶端設定錯誤而非產品漏洞**。

> **這對本模組的直接意涵**:語意正確不等於安全。**必須提供「以某使用者身分預覽:這張表他看得到幾筆」的模擬器** —— 那正是上述案例缺的東西。列為 P0,不是 nice-to-have。

### 0.6 ⚠️ v0.2 補研究:**強制點應該放在 RLS,不是應用層** —— 這推翻 v0.1 的 OQ-DP-7

v0.1 依「RLS policy 內子查詢每列執行、非 LEAKPROOF 破壞 pushdown」推論 RLS 不適合,**該推論對複雜 policy 成立,對本模組要用的簡單述詞不成立**。
研究於**本機 PostgreSQL 16.13 建 30 萬列(20 租戶 × 15k)實測**:

| 作法 | 執行計畫 | 熱查詢 |
|---|---|---|
| 應用層注入 WHERE | BitmapOr(btree + GIN) | 0.16 ms |
| **`AS RESTRICTIVE` RLS policy** | **完全相同** | **0.169 ms** |

**零效能代價**,因為 `current_setting()` 是 `STABLE`,planner 能把它推進 index cond。

**而 RESTRICTIVE 在安全性上結構性更強**:
- 語意上**恆為 AND**,使用者自訂篩選的 OR **在語法上不可能逃出**權限邊界
- **應用層漏注入也不外洩** —— 防線不依賴「記得要注入」

> **實測的洩漏規模**|同一查詢少一層括號,`AND f_num>9000 OR f_num<10` 回 **309 列** vs 正確 **3 列** —— **103 倍外洩且含他人記錄**。這正是 RESTRICTIVE 能從結構上消除的那類錯誤。

**代價與化解**|`CREATE POLICY` 是 DDL、表名不可參數化 → 若 policy 需引用「這張表的指派欄」,每次規則變更都變成 DDL。
**化解:把指派反正規化成固定的系統欄** `assignees bigint[]` —— 則**所有動態表共用同一份靜態 policy**,建表時一次寫入(沿用既有 `ddl.service` 三段式 provision,消除「新表忘了套」),日後規則變更是**資料變更不是 DDL**。

### 0.7 多值指派的儲存與索引(實測三方對照)

同一查詢、actor 命中 70/15000 列:

| 方案 | 索引大小 | 查詢時間 |
|---|---|---|
| **`bigint[]` + GIN** | **2552 kB** | **0.16 ms** |
| `jsonb` + GIN(jsonb_path_ops) | 2552 kB | 計畫**完全相同**,無優勢且多一層型別轉換 |
| junction 表 + `OR EXISTS` | 59 MB 表 + 36 MB 索引 | **265 ms** |

> **junction 的 265 ms 是關鍵地雷**:`created_by = X OR EXISTS(...)` 讓 planner 產生 `hashed SubPlan`,退化成掃全租戶 15000 列。改寫成 UNION 才回到 0.31 ms,但那時 junction 相對 GIN 只是多花 37 倍儲存。
> **對照**:Baserow 用 M2M 關聯表、Teable 用 JSONB —— 兩者都有生產前例,但**都不是本場景的最佳解**。

**寫入放大實測**(INSERT 30 萬列)|無 GIN 1.56 s / GIN 預設 2.05 s(**+31%**)/ `fastupdate=off` 5.03 s(**+222%**)→ **保留 fastupdate 預設**。
**OR 的 planner 行為**|`tenant_id = ? AND (created_by = ? OR assignees @> ARRAY[?])` → 實測產生 **`BitmapOr`,兩個索引同時用**,不退化。**驗收判準:EXPLAIN 必須出現 `BitmapOr`。**
**唯一真實風險**|planner 誤估而不選 bitmap 時 0.16 ms → **51.7 ms(320 倍)**。靠 ANALYZE 頻率 + 慢查詢告警守。
**明確不要做**|「每個 actor 一個 partial index」(actor 數 × 動態表數爆炸)。

### 0.8 OSS 同儕:**開源版幾乎都沒有記錄級權限**(且授權多已變更)

| 系統 | 授權(2026 現況) | 記錄級權限 |
|---|---|---|
| **Baserow** | 根 MIT;`enterprise/` **專有** | 只有 **Restricted Views**(view filter + 限定該 view),實作在 enterprise/ → **不可 fork** |
| **Teable** | `apps/*` **AGPL-3.0**;`packages/*` MIT | 官方文件有 Authority Matrix(Business 以上);**OSS repo 的 `record-permission.service.ts` 是 35 行 stub** |
| **NocoDB** | ⚠️ **2026-01-29 起 Sustainable Use License,已非 OSS** | 有 Record-Level Security(Scale 方案)|
| **Directus** | ⚠️ 2026 起 **MSCL-1.0-GPL**,非 OSS | 有,且 `$CURRENT_USER` 動態變數架構最值得學 |
| **Hasura** | Apache-2.0(非 MIT)| row filter 為 boolean expression + session variable |

> **clean-room 影響**|NocoDB 與 Directus **已非 OSS**、Baserow enterprise 為專有、Teable apps 為 AGPL → **一律只讀公開文件與介面形狀,不看實作原始碼**。可安全參考的只有 Teable `packages/*`(MIT)與 Hasura 的公開設計文件。
> **另一個判讀**|開源版普遍不給記錄級權限,是**商業取捨而非技術不可行**;但也證實這是企業級分野。

**兩個值得借鑑的設計手法**(只取公開介面 / 文件所述之形狀):
1. **變數 late-binding 三段式**(Directus 公開文件):規則存成含 `$CURRENT_USER` 的結構 → 請求時才解析所需欄位 → 代換 → 編譯。**不要在存規則時就展開**,否則調整組織結構要重算全部規則。
2. **不發明新 DSL**|Teable / Baserow / NocoDB 的共通 UX 慣例是**直接復用使用者已經會用的「檢視篩選器」**,只多一個「目前使用者」的值來源。Weyver 已有 `view_def` 的 filter 模型 → 日後若真要做條件規則(OQ-DP-1 的 B),應復用它而非另造。

### 0.9 管理員 UX:業界把「預覽」拆成三個不同功能

| 功能類別 | 回答的問題 | 前例 |
|---|---|---|
| **Effective access / 檢查存取權** | 「**現在**這個人看得到什麼?為什麼?」 | SharePoint **Check Permissions**(回「有無權限 + 經由哪條途徑」)· Windows **Effective Access** 分頁 · Salesforce **Sharing Hierarchy**(逐筆反查誰看得到) |
| **Simulator / what-if** | 「我**如果**這樣改,誰會受影響?」 | **GCP Policy Simulator**(列出 access **changes 差異**)· **AWS IAM Policy Simulator**(逐 action 回 allow/deny **並指出是哪條 statement 決定的**)|
| **Report-only / 演練** | 「先上線但不強制,看看**會擋下什麼**」 | **Azure Conditional Access report-only 模式** |

> **Salesforce 的結構性缺陷**|設定 sharing rule 時**沒有任何「會影響幾筆」的事前回饋**,唯一驗證管道是**事後**在單筆記錄上看 Sharing Hierarchy。**這正是 2023 外洩的成因:語意可設、效果不可見。**

**Impersonation 的安全風險**|「Login as user」被指出**觀測性不足、易被濫用**(Varonis)。
→ **不做真 impersonation**,改做**唯讀試算**:以目標使用者的權限條件跑同一查詢,只回「**筆數 + 標題欄**」、敏感欄遮蔽、**全程 audit 且被查者可見**。

**預設值該偏嚴還偏寬 —— 最強證據是 Salesforce 自己的修正動作**|Summer '20 推出 Secure guest user record access,**Winter '21 起強制且不可關閉**,訪客 OWD 固定 Private。
→ **偏嚴,並把危險開關直接移除,而不是加警告。** 代價(「東西不見了」)用好用的例外機制與可見性補償。
**但對本模組要注意方向**:Weyver 既有租戶目前是「表單可見 = 全部記錄可見」,**收緊會讓既有資料突然消失** → 預設維持 `all`(加法擴充),嚴格預設只套用於**新建的範圍設定**。

**文案前例**|monday.com Enterprise:「Only items they created and items assigned to them in any people column」;Ragic:「可查看及編輯自己新增及被指派的資料」。
→ 建議中文:**「只看得到自己建立或被指派給自己的記錄」**,並固定附一行「不受此限:系統管理員」。

---

## 1. 目標與範圍

### 1.1 目標(P0)

1. **記錄範圍述詞** —— 表單級權限之上加一個範圍維度:`全部` / `僅自己建立與被指派的`。
2. **欄位驅動指派** —— `member` 欄位的值即授予該筆記錄存取(承 Ragic 機制二)。
3. **範圍在查詢層強制** —— 不是前端過濾。列表 / 讀單筆 / 更新 / 刪除 / 匯出全部套用。
4. **權限預覽模擬器** —— 管理員可查「以 X 身分,這張表看得到幾筆」(承 §0.5 事故教訓)。

### 1.2 不做的事(附理由)

- ❌ **Salesforce 式任意條件規則引擎** —— 見 OQ-DP-1。Ragic parity 不需要,且會引入 DSL / 索引 / 效能 / 設定 UI 一整套題目。
- ❌ **跨表條件**(「客戶的負責業務在關聯表」)—— 立刻變子查詢,即 Odoo 已知的效能懸崖。v1 只做同表。
- ❌ **預先計算 share table** —— §0.3。
- ❌ **角色階層自動繼承記錄**(主管自動看到部屬的)—— Salesforce 有,Ragic 無;見 OQ-DP-6。

---

## 2. 上游 / 既有現況走查

| 既有 | 狀態 | 對本模組的意義 |
|---|---|---|
| 表單級動作 `view/create/edit/delete/approve/export/design` | ✅ P0-4a | **範圍是動作的正交維度**,不是新動作 |
| owner 短路 | ✅ | ⚠️ **是表單層 owner**(`form_def.created_by` = 誰建這張表),**不是記錄層** |
| 記錄 `created_by` | ✅ 已寫入 | 「自己新增的」有現成來源 |
| 分類繼承 / 敏感旗標 | ✅ uplift | 範圍設定應沿用同一資源軸 |
| 角色階層 + 閉包 | ✅ | 群組指派可用 |
| `member` 欄型 | ⚠️ **registry 有、前端無** | **「被指派的」無來源** —— 與通知模組撞到同一個殘留 |
| RLS FORCE | ✅ | 維持只做租戶兜底(§0.4) |
| 記錄查詢 | ❌ **無任何記錄級範圍** | 表單可見 = 該表**所有記錄**可見 |

---

## 3. scope 切分(初擬)

| 里程碑 | 內容 | 估算 |
|---|---|---|
| **M1 範圍述詞** | `form_permissions` 加 `record_scope` · 有效權限解析納入 · 記錄查詢注入 WHERE(列表 / 單筆 / 更新 / 刪除 / 匯出全路徑)· 測試 | 0.10 mo |
| **M2 member 欄補完 + 指派** | `member` 欄前端渲染(使用者選擇器)+ 欄位選項 `grantsAccess` + 指派納入範圍述詞 | 0.08 mo |
| **M3 設定 UI + 預覽模擬器** | 權限矩陣加範圍欄 + **「以 X 身分預覽」**(§0.5 P0) | 0.07 mo |
| **M4 收尾** | spec + FMEA + doc v1.0 + MODULES + **docs/25 §E 回填** | 0.03 mo |

**合計 ≈ 0.28 mo**(docs/04 E 段編列 4 人月,本批只取 Ragic-parity 之 P0)。前後端分開 commit。

### 3.1 落地結果(2026-07-29)

| 里程碑 | 實際落點 | 狀態 |
|---|---|---|
| M1 | `form_permissions.scoped_actions`(migration 0028)· `EffectivePermissions.isScopedToOwn` 逐動作解析(**跨角色取交集,任一角色給 `all` 即不受限**)· 動態表加 `assignees bigint[]` + GIN · **`AS RESTRICTIVE` policy `record_scope`** 隨建表 provision 一併建立、既有表由 0028 DO block 補建 · 範圍與 actor 以 `app.record_scope` / `app.actor_id` GUC 於交易內傳入 | ✅ |
| M2 | `member` 欄 `optionsSchema.grantsAccess` · 寫入時同步 `assignees`(單一同步點)· **前端選人器 + 設計器「指派即授權」勾選 + 列表顯示姓名** · `/forms/access-preview/actors` 回**帶姓名**的租戶人員清單 | ✅ |
| M3 | 權限矩陣範圍三態格(`SCOPEABLE = view/create/edit/delete`)· 存取預覽面板(筆數 + 前 N 筆 + **每筆為何看得到**)| ✅ |
| M4 | FMEA §12.2 實測結果回填 · 本節 · MODULES.md · docs/25 §E | ✅ |

**實走驗證(Playwright MCP,真瀏覽器 + 真 PG)**|設計器加「人員」欄並勾選指派即授權 → 填單選「陳專員」→ 列表顯示姓名(非 `58`)→ 以 actor 58 走真實 authz 讀取,**3 筆中只回被指派的那 1 筆**,預覽面板同步顯示「看得到 1 / 全部 3 筆 · 被指派」。

---

## 10. 開放問題(OQ-DP-N)— ✅ **已裁定 2026-07-29(全採建議)**

裁定結果:1=C(先 A) · 2=A · 3=A · 4=A · 5=A · 6=A · **7=B(RLS RESTRICTIVE,推翻 v0.1 的 A)** · 8=A · 9=A · 10=A

| # | 議題 | 選項 | 建議 |
|---|---|---|---|
| **OQ-DP-1** ⭐⭐ | 模型:條件規則引擎 vs Ragic 式範圍 + 指派 | A. **Ragic 式**:有序範圍述詞 + member 欄驅動指派<br>B. Salesforce 式 criteria rules(`{欄位, 運算子, 值來源}` DSL)<br>C. 先 A,日後視需求加 B | **C(先 A)** — §0.1 證實 **Ragic 沒有規則引擎**,「業務只看自己客戶」用 A 即可達成;且 Notion 獨立收斂到同一受限模型(只綁 Person 型屬性)。B 會引入 DSL / 白名單 / 索引 / 效能 / **非工程師友善的設定 UI**(§0.2:沒有現成可抄)一整套題目。**誠實代價**:A 無法表達「金額 > 100 萬才給看」這類條件 → 明列於 doc,待真實客戶需求出現再評估 B |
| **OQ-DP-2** ⭐ | 範圍述詞放哪一層 | A. **`form_permissions` 加一欄**(角色 × 表單 × 範圍)<br>B. 新一張 `record_scope_rules` 表<br>C. 併入現有 actions 陣列(如 `view:own`)| **A** — 範圍是**動作的正交維度**而非新動作;C 會讓動作集合爆炸(7 動作 × 2 範圍)且破壞既有 `actions` 語意。B 對只有兩種取值的維度過重。**加法擴充、零遷移**(NULL/預設 = `all`,既有行為不變)|
| **OQ-DP-3** ⭐ | 範圍取值 | A. **`all` / `own`** 兩值(own = 自己建立 + 被指派)<br>B. 三值:`all` / `own_and_assigned` / `own_only`<br>C. 沿用 Ragic 五級(含新增/修改的不對稱)| **A** — Ragic 的五級其實是「**閱覽範圍 × 修改範圍**」兩個維度的組合(佈告欄式 = 閱覽全部 + 修改自己的)。Weyver 已有獨立的動作集,**範圍只需正交地掛上去**即可自然表達同樣的組合,不必複製五級。B 的 `own_only` 少了指派會讓指派機制失效 —— 而指派正是 Ragic 賴以達成此需求的機制 |
| **OQ-DP-4** ⭐ | 範圍是否逐動作獨立 | A. **逐動作**(可設「view=all、edit=own」= Ragic 佈告欄式)<br>B. 整組一個範圍 | **A** — 這正是 Ragic 佈告欄式使用者的語意(**看全部但只能改自己的**),是很常見的真實需求。實作上是 `actions` 之外再一個 `scoped_actions` 集合(列在其中者受 own 限制),語意仍簡單 |
| **OQ-DP-5** ⭐ | 指派如何表達 | A. **`member` 欄位選項 `grantsAccess: true`**(承 Ragic:欄位上一個勾選)<br>B. 獨立的 `record_assignment` 表<br>C. 固定用某個系統欄 | **A** — 承 Ragic 且**資料即權限**:負責業務就寫在那個欄位,不必另外維護一份指派表(兩者會不同步)。**代價**:欄位被刪 / 改型別要處理(見 FMEA)。**前提**:`member` 欄前端必須補完(M2)|
| **OQ-DP-6** | 主管是否自動看到部屬的記錄 | A. **不做**(Ragic 無此語意)<br>B. 沿角色階層閉包自動繼承(Salesforce 有)| **A** — Ragic 沒有這個語意,做了就超出 parity;且它會讓「own」的定義變成遞迴查詢(角色閉包 × 成員),是效能與理解成本的雙重負擔。**需要主管看全部時,就把主管角色設 `all`** —— 更明確也更好稽核 |
| **OQ-DP-7** ⭐⭐ | 述詞在哪裡強制 | A. ~~應用層編譯 WHERE 注入~~<br>**B(v0.2 依實測改採)**|**`AS RESTRICTIVE` RLS policy** 為強制點,應用層只做 UX(提示 / 預覽)<br>C. 兩者都做 | **B(v0.1 建議 A 已被推翻)** — §0.6 於 **PG 16.13 / 30 萬列實測**:RESTRICTIVE policy 與應用層注入**執行計畫完全相同**(BitmapOr + GIN,0.169 ms vs 0.16 ms),**零效能代價**;而 RESTRICTIVE **語意恆為 AND**,使用者自訂篩選的 OR **在語法上不可能逃出**,且**應用層漏注入也不外洩** —— 防線不依賴「記得要注入」。實測的反例規模:少一層括號即 **103 倍外洩**。**前提**:policy 只准簡單述詞 + `current_setting`,**不得呼叫非 LEAKPROOF 的自訂函數**(會讓 planner 放棄 pushdown → 全表掃)|
| **OQ-DP-8** ⭐ | 預覽模擬器是否 P0 | A. **是**(§0.5 事故教訓)<br>B. P1 | **A** — Salesforce 外洩案例的根因正是「規則語意正確但管理員理解錯」,而該產品**無法預覽實際效果**。此功能成本低(以目標使用者身分跑一次計數查詢),但它是**唯一能讓管理員在設定當下就看見後果**的東西。權限功能的預設失效模式是「以為設對了」 |
| **OQ-DP-9** ⭐⭐ | 指派怎麼存 | A. **固定系統欄 `assignees bigint[]` + GIN**,由引擎自 member 欄同步<br>B. 直接讀該表的 member 欄(欄名因表而異)<br>C. junction 關聯表 | **A** — 兩個理由:(1) **效能**:§0.7 實測 `bigint[]`+GIN 為 0.16 ms、junction + `OR EXISTS` 為 **265 ms**(planner 產生 hashed SubPlan 退化成掃全租戶);jsonb 計畫相同但多一層轉換。(2) **更關鍵的是它讓 policy 靜態化** —— B 會使 policy 需引用「這張表的指派欄」,而 `CREATE POLICY` 是 DDL 且表名不可參數化 → 每次規則變更都變 DDL;A 讓**所有動態表共用同一份靜態 policy**,建表時一次寫入(沿用既有三段式 provision,消除「新表忘了套」),規則變更是**資料變更**。**代價**:需在記錄寫入時同步 member 欄 → `assignees`(單一同步點,見 FMEA)|
| **OQ-DP-10** ⭐ | 預覽做到什麼程度 | A. **唯讀試算**:選人 → 回筆數 + 前 N 筆標題 + 每筆「為何看得到」<br>B. 真 impersonation(以該使用者身分瀏覽)<br>C. 只顯示筆數 | **A** — B 的「Login as user」被指出**觀測性不足、易被濫用**(Varonis);A 給了管理員判斷所需的一切,又不讓他藉此翻閱他人資料。**設計要點**(承 §0.9 三分類):P0 先做 **effective access**(「現在這個人看得到什麼、為什麼」,對標 SharePoint Check Permissions);**存檔前的影響差異**(GCP Policy Simulator 式「3,394 筆將被遮蔽」)價值最高但需算兩次,列 P1;report-only 演練模式列 P2。**A 本身仍需 audit 且敏感欄遮蔽** |

---

## 12. 失效場景反思(FMEA)— pre-mortem 預列

| # | 場景 | 預定緩解 | Sev |
|---|---|---|---|
| D1 | **漏注入即外洩**:某條記錄查詢路徑未套範圍述詞 | **v0.2 改為結構性消除**:強制點下沉到 `AS RESTRICTIVE` RLS policy(OQ-DP-7=B)→ 漏注入也不外洩。policy 於建表 provision 時一併建立,消除「新表忘了套」。e2e 仍斷言「業務 A 看不到業務 B 的客戶」涵蓋列表 / 單筆 / 更新 / 刪除 / 匯出 / 搜尋全路徑 | **P0** |
| D2 | **匯出繞過**:列表有限制但匯出全撈 | 匯出走同一建構點;測試單獨斷言匯出路徑 | **P0** |
| D3 | **關聯 / lookup 繞過**:A 表看不到的記錄,經 B 表的 lookup 被帶出值 | 明確定義:lookup 顯示值是否受來源表範圍管?**P0 必須裁定並測試**(Salesforce 明文禁止 lookup 欄當條件,即因衍生值難以追蹤)| **P0** |
| D4 | member 欄被刪 / 改型別 → 指派失效,原本看得到的人突然看不到(或反之) | 欄位刪除時檢查 `grantsAccess`,警告並要求確認;改型別走既有白名單(不允許 member → 其他) | P1 |
| D5 | **管理員誤設導致全員看不到自己的資料** | 預覽模擬器(OQ-DP-8);範圍預設為 `all`(**加法擴充**,不主動收緊既有租戶) | P1 |
| D6 | 大表下 `created_by` / member 欄無索引 → 全表掃描 | 範圍述詞所涉欄位建 `(tenant_id, <欄>)` 複合索引,`tenant_id` 為首欄(§0.4)| P1 |
| D7 | ~~指派欄索引~~ **v0.2 已定案**|`assignees bigint[]` + GIN(§0.7 實測);寫入放大 +31%(保留 `fastupdate` 預設) | P1 | ✅ 已定案 |
| D9 | **planner 誤估不選 BitmapOr** → 0.16 ms 變 **51.7 ms(320 倍)** | 驗收判準:EXPLAIN 必須出現 `BitmapOr`;ANALYZE 頻率 + 慢查詢告警 | P1 |
| D10 | member 欄 → `assignees` 系統欄不同步 → 權限與畫面不一致 | 單一同步點(記錄寫入路徑);整合測斷言「改 member 欄後可見性立即改變」 | **P0** |
| D8 | 範圍與既有 owner 短路 / 敏感旗標 / 分類繼承交互作用產生意外放寬 | 解析順序明文化並測試矩陣;**敏感表不得因指派而放寬**(承 OQ-ARI-5 精神)| P1 |

### 12.2 實作後回填(2026-07-29)

| # | 結果 |
|---|---|
| D1 | ✅ 如設計:policy 於 provision 建立,漏注入不外洩。**實走另證**:應用層那行 `own` 旗標與 policy 兩者一致 |
| D3 | ✅ **已修(併 #113)**|帶入三層閘:來源表 view → 目標欄非 hidden → 來源表記錄範圍。無權回 `__source_restricted__`,與 `__source_deleted__` 分開(受範圍限制時「查不到」無法與「已刪除」區分,一律回前者以免揭露存在性)。**表單級閘實為粗網** —— 完全無權時 `defaultFieldVisibility` 已回 hidden,真正發動的是欄位級閘;留著是為「目標欄名解不出來」時仍 fail-closed |
| D10 | ✅ 同步點在 `RecordService` 寫入路徑;**只有 `grantsAccess` 為 true 的 member 欄**參與,且該欄未被本次寫入觸及時不動 `assignees`(避免部分更新清空指派)|

**實作期新發現(非 pre-mortem 預列,由實走揪出)**

| # | 場景 | 處置 | Sev |
|---|---|---|---|
| D11 | **指派在送出邊界被靜默丟掉**|`toSubmitValue` 的 default 分支只收字串,`member` 的數值 actor id 落入後回 `undefined` → 畫面明明選了人、存進去是空的,且**沒有任何錯誤** | 加 `member` 分支 + 迴歸測(已反向驗證:移除修正即紅)| **P0** |
| D12 | 🔴 **`APP_DATABASE_URL` 未設時靜默回落到 migration 特權角色 → RLS 完全不執法**(租戶隔離與記錄範圍一起失效,查詢照常回資料)。dev 因此**永遠驗不出範圍限制**,本模組差點以「瀏覽器看起來沒限制」誤判為 bug | (a) prod `validateEnv` fail-fast(未設 / 與 `DATABASE_URL` 相同即拒開機)(b) 開機自檢查 `pg_roles`:app 車道若為 superuser 或 BYPASSRLS,prod throw / dev 大聲警告 (c) dev 加 `x-dev-real-authz: 1` header 走真實角色解析,讓範圍限制在瀏覽器裡驗得出來 | **P0** |

**#113 sweep 另發現(同批已修)**|記錄範圍原本**只接在列表路徑**上 —— `getRecord` /
`updateRecord` / `softDeleteRecord` / 簽核送簽 / 按鈕動作都沒帶範圍,只要知道 id 就繞得過去。
這是「橫向防護只掛在一種路由形狀上」的第四次重演(前三次:選項改型別、匯入、按鈕執行)。
**配額 count 刻意不套範圍**已加註理由(租戶量非個人可見量)。7 條迴歸測全數反向驗證。

> D12 與 #98(NODE_ENV 未設即 dev 旁路)、本 session 稍早的「測試用 superuser 連線導致 RLS 全程未執法」是**同一類**:安全機制在設定缺漏時**無聲失效**,且驗證環境本身把失效遮住。**判準**:凡「靠設定才生效」的安全機制,都要有開機自檢或 fail-fast,不能只靠文件。

### 12.3 不在本模組 scope 修的 pre-existing 問題

- ~~🔴 **keyset 分頁在非 id 排序時會跳列 / 重複**~~ ✅ **已修(#95,2026-08-04 複驗)** —— `keyset.ts` 檔頭逐字記著同一個 bug,已改為遞迴展開述詞,並有 `keyset-pagination.integration.test.ts`。⚠️ **本節在它修好之後仍寫著「應另立小項」** —— 待辦不會自己過期,而「不在本模組 scope」的項目最容易變成這樣:沒有人負責回來看。

---

## 13. 變更紀錄

| 日期 | 版本 | 變更 | 作者 |
|---|---|---|---|
| 2026-07-29 | **v1.0 SHIPPED** | M1→M4 落地(§3.1)。**實作期揪出兩個 P0**(§12.2):(a) `member` 數值在填單送出邊界被字串分支靜默丟掉;(b) **`APP_DATABASE_URL` 未設時 app 車道回落到特權角色 → RLS 全面不執法**,已補 prod fail-fast + 開機自檢 + dev `x-dev-real-authz` 逃生口。**D3(lookup 繞過)仍為缺口**,併入 #113 lookup 語意一起裁定 | Claude Code |
| 2026-07-28 | **v0.2** | **決策方追問「有站在巨人的肩膀上嗎」** —— 誠實檢視後確認 v0.1 標準低於通知模組(只 1 路研究 + 2 頁 Ragic),遂補三路研究,**其中一路於本機 PG 16.13 建 30 萬列實測**。**推翻 v0.1 的核心架構決定**:(a) **OQ-DP-7 由「應用層注入」翻為「`AS RESTRICTIVE` RLS policy」** —— 實測兩者**執行計畫完全相同、零效能代價**,但 RESTRICTIVE **語意恆為 AND**,使用者篩選的 OR 語法上不可能逃出,且**漏注入也不外洩**;實測反例:少一層括號即 **103 倍外洩**。v0.1 §0.4 的推論對複雜 policy 成立、對簡單述詞不成立,已標 SUPERSEDED。(b) **新增 OQ-DP-9**:指派存成**固定系統欄 `assignees bigint[]` + GIN** —— 實測 0.16 ms vs junction 的 **265 ms**(planner hashed SubPlan 退化);更關鍵是它讓**所有動態表共用同一份靜態 policy**,規則變更是資料變更而非 DDL。(c) **新增 OQ-DP-10**:預覽採**唯讀試算不做 impersonation**(「Login as user」觀測性不足易濫用);承 §0.9 三分類(effective access / simulator / report-only)分階段。**§0.8 授權警訊**:NocoDB 與 Directus **2026 起已非 OSS**、Baserow enterprise 專有、Teable apps 為 AGPL → 一律只讀公開文件不看實作。**§12.3 記錄一個 pre-existing bug**:keyset 分頁在非 id 排序時會跳列/重複(已對碼確認)| Claude Code |
| 2026-07-28 | v0.1 | 初版 DRAFT。**§0.1 推翻本模組原本的假設**:docs/04 記為「動態權限(依欄位值判斷)」暗示 Salesforce 式規則引擎,但翻 Ragic 文件確認**它根本沒有條件規則引擎** —— 而是「**有序存取層級**(內建『自己新增及被指派的』述詞)+ **member 欄位值驅動的指派**」兩機制組合;「業務只看自己客戶」= 問卷式使用者 + 選擇使用者欄位。**§0.2 企業級對照**:Salesforce criteria-based 上限 50 條且**禁 lookup/公式/衍生欄位**、預計算 `__Share` 表非同步重算;Odoo `ir.rule` 查詢時注入且 **global AND / group OR**;**Airtable 完全沒有此能力**(Interface 過濾非安全邊界);**Notion 只綁 Person 型屬性** —— 與 Ragic 獨立收斂到同一受限模型,為強訊號。**§0.3/§0.4**:採查詢時注入不預計算;RLS 維持只做租戶兜底(policy 內子查詢每列執行、非 LEAKPROOF 破壞 pushdown)。**§0.5**:Krebs/Varonis 揭露之 Salesforce Community 外洩案例根因為「規則正確但管理員理解錯」且產品**無法預覽效果** → **預覽模擬器列 P0**。OQ-DP-1..8 待裁定;FMEA D1–D8,其中 D3(lookup 繞過)須於 M1 前裁定 | Claude Code |
