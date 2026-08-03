# giants-shoulders-audit-B.md —— 已具 §0 研究節之 18 份模組文件稽核

| | |
|---|---|
| 稽核日期 | 2026-08-03 |
| 範圍 | `docs/modules/R1/` 之 **18 份已具 §0 研究節**的模組文件(清單見 §2 總表) |
| 判準 | `AGENTS.md`〈🧭 向上設計三條〉+〈🚫 第一約束〉;「巨人的肩膀」三站(自家 repo / 自己的相依套件 / 競品) |
| 與 audit-A 的分工 | **audit-A 稽核「連 §0 都沒有」的 14 份**(問題是缺研究);**audit-B 稽核「有 §0」的這 18 份**(問題是 §0 撐不撐得住它後面的裁定)。兩份範圍不重疊 |
| 稽核方法 | 18 份**逐份整份讀完**(§0 → OQ 裁定 → 里程碑 → FMEA → 變更紀錄,共 5,527 行);對其中判為 🔴 者**實際回一手驗證**(讀已安裝套件之 `.d.ts`、grep 本專案原始碼與 schema、讀 `reference-materials/` 競品官方鏡像原文)。驗證與否於各段明確標注 |

---

## 1. 摘要

**本批的整體水準遠高於 audit-A 的範圍。** 18 份中 8 份的 §0 具備一手逐字引用、出處連結、證據強度標注與誠實的「查不到」聲明;其中 5 份另含本機實測(PG 30 萬列、pg_bigm 編譯、PG attnum 循環、Node 24 DNS pin、GIN 寫入放大),4 份的研究**推翻了自身或上游文件的既有記載**。

因此本稽核的價值不在「指出沒做研究」,而在指出**三類仍會穿過這道防線的失效**:

1. **站②(自己的相依套件)是三站中唯一系統性缺席的一站** —— 而 `docs/modules/_template.md` 的 §0 規定裡**沒有任何一格對應它**(第 211–225 行只要求「競品 / 規範 / 實測」)。缺的正是沒有格子的那一站。
2. **研究查了「競品怎麼呈現」,沒查「競品把這個功能的邊界畫在哪」** —— 導致抄到功能的一部分,卻以為抄到了整個。`conditional-format` 為已證實的實例。
3. **承重的授權斷言(「皆 OSS」)沒有授權識別碼與查證日期** —— 而 clean-room 鐵則正是以授權為判準,且本專案自家文件在**一至兩天前**已記載相反事實。

---

## 2. 總表

站別標記:`一手逐字` / `有引用無逐字` / `僅推理` / `無` / `N/A`(該模組無對應面)。

| # | 模組 | ① 自家 repo | ② 相依套件 | ③ 競品(出處+日期) | 承重問題 | 實害 |
|---|---|---|---|---|---|---|
| 1 | approval-advanced | 一手逐字 | N/A | 一手逐字(有連結、有強度標注) | 1 | 🟡 |
| 2 | **conditional-format** | 一手逐字 | 有引用無逐字 | **有引用無逐字,且問錯問題** | 2 | 🔴 |
| 3 | data-export | 一手逐字 | **無** | 一手逐字(v0.6 自我更正一條引錯出處) | 1 | 🟡 |
| 4 | dynamic-permissions | 一手逐字 | 一手實測 | 一手逐字 + 授權盡職調查 | 0 | ⚪ |
| 5 | form-templates | 一手逐字 | N/A | 一手逐字(自承分類軸未查證) | 0 | ⚪ |
| 6 | frontend-uplift | 一手逐字(自承漏 `packages/` 一次) | **部分** | 一手逐字 + 逐條強度 + 四次自我更正 | 1(已更正) | 🟡 |
| 7 | full-text-search | 一手逐字 | 一手實測 | 一手逐字 | 0 | ⚪ |
| 8 | **grid-paste** | 一手逐字 | 一手逐字(§0.2)/ **§1.2 無** | 一手逐字 | 1 | 🔴 |
| 9 | image-signature-fields | 一手逐字 | 有引用無逐字 | 一手逐字 | 1 | 🟡 |
| 10 | import-to-existing-form | 一手逐字 | 有引用逐字(SheetJS) | 一手逐字(~40 條來源 + 誠實聲明) | 0 | ⚪ |
| 11 | notifications | 一手逐字 | 部分 | 一手逐字(v0.4 自我推翻四條) | 0 | ⚪(流程 🟡) |
| 12 | option-colors | 一手逐字 | N/A | 有引用無逐字(自承色數無證據) | 1 | 🟡 |
| 13 | **pivot-and-charts** | 一手逐字 | 一手逐字 | **一手逐字,但讀原始碼且授權斷言無依據** | 2 | 🔴 |
| 14 | public-form | 一手逐字 | 有引用(授權) | 一手逐字 + 誠實聲明 | 0 | ⚪ |
| 15 | recycle-bin | 一手逐字 | 一手實測(附複驗腳本) | 一手逐字 + 法規原文 | 1 | 🟡 |
| 16 | settings-center | 一手逐字 | **一手逐字讀相依套件原始碼** | 一手逐字(含 NIST 版本更新) | 0 | ⚪ |
| 17 | **views-group-kanban-calendar** | 一手逐字 | **漏** | **一手逐字,但授權斷言與自家文件相衝** | 2 | 🔴 |
| 18 | webhook-and-events | 一手逐字(推翻上游記載) | 一手實測 | 一手逐字 | 0 | ⚪ |

**分佈**|🔴 4 · 🟡 6 · ⚪ 8。

---

## 3. 逐模組

### 3.1 🔴 conditional-format —— §0 誤述了它所對標的功能是什麼(**已證實**)

**懷疑點**|§0 的對照表把 Ragic「條件式格式」描述成純粹的著色功能(逐字:「欄位**值**背景/文字色、**欄位標頭**色、敘述欄位色」),並據此在 OQ-CF-8 把「條件式**行為**(顯示/隱藏/唯讀/必填)」切出去,理由是「**性質不同**」。但上游 `docs/27` §1 P1 是把「顯示/隱藏/唯讀/必填/變色依條件」寫成**同一項**。兩者相衝時,誰對?

**驗證**|讀 `reference-materials/ragic-doc-zh-TW/.../doc/6/conditional-formatting.html` 原文(即該文件 §0 自己標注的證據檔)。官方章節結構逐字為:

> 設定條件式格式 · **顯示或隱藏欄位** · **顯示或隱藏欄位值** · **顯示或隱藏敘述欄位** · **設定顏色** · **顯示、隱藏或上鎖分段** · **顯示訊息** · **顯示、隱藏或上鎖動作按鈕** · **欄位唯讀** · **欄位必填** · **顯示或隱藏開始簽核按鈕** · 指定日期欄位時間或區間 · 指定當前時間

且官方示範的第一條規則就是**隱藏**、第二條才是**變色**,兩者在**同一份規則清單**內:

> 「點選**增加規則**…像是如果『產品類別』是『巧克力』時,則**顯示**『甜度』。」
> 「也可以設定多個條件式格式。例如當『產品類別』為『蛋糕』時,變更欄位值背景為『粉紅色』。」

**結論:證實。** 在 Ragic 裡「條件式格式」是**一個功能、一個設定入口、一份由上而下求值的規則清單**,「設定顏色」只是其中**一格**。本模組 §0 把整個功能誤述為只有那一格,OQ-CF-8 的「性質不同」因此**不是對 Ragic 的觀察,是本模組自己造出來的切分**。而該文件 §0.1 逐字寫著「我們是 Ragic-parity-first → **應整套採 Ragic**」—— 採了它的覆蓋序與表單級語意,卻切掉了同一功能的其餘十一項。

**第二個承重問題**|OQ-CF-8 的理由 (a) 是「**條件式隱藏不是安全邊界**,誤用會造成以為藏起來就安全」。Ragic 官方在同一頁**逐字給了處置方式而非因此不做**:

> 「注意:條件式格式的隱藏欄位**只會作用於排版介面上**,於修改資料紀錄或通知信中仍會顯示該欄位的資料,因此若希望針對不同使用者權限隱藏該欄位時,**建議使用欄位層級權限設定**。」

即該風險是**已知且有成文緩解**(標注 + 指向欄位級權限),不足以支撐「另立模組」。

**實害(已量化,已 SHIPPED)**|讀 `apps/api/src/form-engine/layout/layout-specs.ts:116-124`,已出貨的規則 schema 為:

```
formatRuleSchema = z.object({ combinator, conditions, targets, tone: z.enum(FORMAT_TONES) }).strict()
```

`tone` 為**必填**、物件為 `.strict()`、**無任何 effect / action 判別欄**。日後要補上其餘十一項行為,只有兩條路:(a) 改動已出貨的 JSONB schema(`tone` 轉選配 + 加判別欄);或 (b) 另開第二份條件規則清單 —— 而那正是「同一件事兩個設定入口、兩份真相」,是本專案在 OQ-TPL-10、OQ-SC-4 等處反覆否決的形狀。

**另註**|站② 的 `themeOverride` 主張**已驗證為真**:`@glideapps/glide-data-grid@6.0.3` 之 `internal/data-grid/data-grid-types.d.ts:130` 確有 `readonly themeOverride?: Partial<Theme>`。該處無誤。

---

### 3.2 🔴 grid-paste —— 同一份文件,下一節就重犯自己剛寫下的站②教訓(**已證實**)

**懷疑點**|§0.2 是本批站②的示範作(四段 Glide 型別註解逐字引用),但 §1.2「明確不做」逐字寫著:

> ❌ **不做填滿把手(fill handle)拖曳** —— **另立**(同屬 Ragic-parity,但互動與資料路徑不同)

「另立」意味著另一個模組的量體。§0.2 剛剛證明了「不查套件就會自己重寫一份它已經給你的東西」——那麼 fill handle 查了嗎?

**驗證**|讀同一份已安裝套件之 `.d.ts`:

- `internal/data-grid/data-grid.d.ts:72-77` 逐字:「**Enabled/disables the fill handle.** `@defaultValue false`」→ `readonly fillHandle: boolean | undefined`
- `data-editor/data-editor.d.ts:59-64` 逐字:「Emitted whenever the user **initiats a pattern fill using the fill handle**. This event provides both a patternSource region and a fillDestination region, and **can be prevented**.」→ `readonly onFillPattern?: (event: FillPatternEventArgs) => void`
- `fillHandle` **不在** `DataEditor` props 的 `Omit` 清單內(`data-editor.d.ts:17`),故對外可用。
- `grep -rn "fillHandle\|onFillPattern" apps/web/src packages/ui/src` → **零命中**;`packages/ui/src/components/grid-sheet.tsx` 的 `GridSheetProps` 亦未曝露。

**結論:證實。** 拖曳互動、選取範圍計算、以及**與貼上同一條 `onCellsEdited` 單一批次出口**,套件全部已提供。§1.2 所稱「互動與資料路徑不同」對後半段不成立 —— 資料路徑正是 M1 已建好的那支 bulk update。真正剩下的工作與貼上高度重疊(型別先驗、計算欄跳過、一步 undo)。把它列為「另立模組」很可能是把一個布林開關 + 一段既有路徑的接線,誤估成一個模組。

**這一條的意義超出本模組**|它顯示站②不是「知不知道要查」的問題 —— 該文件**知道**,而且剛剛才因此改寫了整個模組的形狀。**問題是查的範圍只框在當下那一題**(「貼上」),沒有問「同一個套件在這個題目附近還給了什麼」。

---

### 3.3 🔴 views-group-kanban-calendar —— 承重的授權斷言與自家文件直接相衝,且漏查已安裝的表格套件

**懷疑點一(授權)**|§0 導言逐字:

> 「本節多條結論來自**閱讀競品原始碼**(Baserow / NocoDB / Teable **皆 OSS**)—— 證據強度高於官方文件的行銷式描述。」

而本專案 `docs/modules/R1/dynamic-permissions.md:120` (v0.2,**2026-07-28**,早本檔一至二日)逐字記載:

> 「**NocoDB** | ⚠️ **2026-01-29 起 Sustainable Use License,已非 OSS**」

同檔 `:124` 更逐字定下規則:

> 「**clean-room 影響**|NocoDB 與 Directus **已非 OSS**、Baserow enterprise 為專有、Teable apps 為 AGPL → **一律只讀公開文件與介面形狀,不看實作原始碼**。」

該段亦已 cascade 進 `docs/modules/MODULES.md:33`。

本檔 §0.1 與 §0.8 則明確引用了 `packages/nocodb/src/db/BaseModelSqlv2/group-by.ts` 之實作結論(`bulkGroupBy` 的 `limitGroup 25`)。**「皆 OSS」是承重斷言** —— 它正是授權「讀原始碼」這個行為的依據,而它對 NocoDB 為偽,且偽在自家 repo 一天前就寫過的地方。`AGENTS.md` 鐵則 5 亦逐字點名 **NocoDB** 為「不 clone」對象。

⚠️ **誠實界定**|「閱讀以理解」與「clone / 複製實作」不是同一件事,本稽核**不主張已發生法律風險**。可稽核的缺陷有二:(a) 承重的授權斷言未附授權識別碼與查證日期,且與自家既有記載相反;(b) 同一 repo 內對同一問題存在**兩套互斥的 clean-room 作業規則**,而較嚴的那一套是後續模組唯一能查到的成文版本。

**懷疑點二(站②)**|§2 現況走查的前端列只有一行:「前端網格 | ✅ Glide Data Grid(集合視圖) | 分組需 header 列」。§4.7 記載實作最終**放棄在 Glide 上插 header 列**,改為「分組時切換到可讀清單」,並自行手刻群組標頭與折疊。

**驗證**|
- Glide 6.0.3 **確實沒有列分組**:型別中的 `groupHeaderHeight` / `drawGroups` / `GroupHeaderClickedEventArgs` 全部是**欄群組**(水平),非列群組。→ **放棄 Glide 的判斷正確**,此處無誤。
- 但 `apps/web/package.json` 已列 **`@tanstack/react-table@8.21.3`**(且已用於 `packages/ui/src/components/list-view.tsx`),其安裝版本含 `build/lib/features/ColumnGrouping.d.ts` 與 `build/lib/utils/getGroupedRowModel.d.ts`,即**列分組與展開/折疊模型為套件內建**。§2 走查**完全沒有提到這個已安裝的相依**。

⚠️ **誠實界定**|本模組的分組**小計必須在 DB 端算**(OQ-VG-1 / FMEA G3,判斷正確),而 TanStack 的 `getGroupedRowModel` 是對已載入列做客戶端分組,**不是 drop-in 替代**。故此處判 🟡 級的站②缺漏而非設計錯誤:手刻的是**呈現層**(群組標頭列、折疊狀態、roving),那一段與套件重疊;至於是否真的划算,文件沒有留下任何「評估過並否決」的紀錄,**因此無從判斷**。

---

### 3.4 🔴 pivot-and-charts —— 同型授權斷言,加上自承的「原研究問錯問題」

**懷疑點一**|§0 導言逐字:「多條結論取自**閱讀競品原始碼**(Metabase / Superset **皆 OSS**)」,並逐條引用 Metabase 的 `pivot.clj` 與 `nest_for_pivot.clj`。與 §3.3 同型:**「皆 OSS」未附授權識別碼與查證日期**,而本專案的 clean-room 鐵則(`AGENTS.md` 5)是以**具體授權**為判準(「可 fork 者限 **MIT**」),「是 OSS」不是該鐵則承認的粒度。

⚠️ **本稽核未查證 Metabase 與 Superset 的實際授權**(本機鏡像不含其 LICENSE)。可稽核的缺陷是**斷言的粒度不足以支撐它所授權的行為**,而非該授權必為 AGPL。

**懷疑點二(問錯問題,文件自承)**|§11(2026-08-03)在 M4 動工前補查,逐字:

> 「為 M4 補查競品時,查出**三件既有設計沒有涵蓋、且會改動實作**的事,故補三條 OQ。」

三件分別是:列表頁 widget 是否吃當下 view 的篩選(Ragic 官方有明文優先序表)· 觀看者對分組/聚合欄位無權限時的行為(Ragic 設計期擋 / Salesforce 執行期具名報錯)· 快照與排程產物的權限落差。§0 花了大量篇幅在**引擎形狀**(長表 vs 寬表、GROUPING SETS vs CUBE)與**圖表庫選型**,但 M4 的三個真正決策點一個都沒查。**原研究問的是「怎麼算」,沒問「誰在看」。**

**加分項(仍應記錄)**|§0.5 以 CVE-2024-55951 逐字證明「洩漏的主角是維度值清單而非聚合值」,是本批最有價值的單條研究之一;§4.7 亦誠實記錄「研究說 a11y 是一行開關 —— 那句話對 `decal` 成立,對自動描述不成立」,屬正確的實走修正。

---

### 3.5 🟡 approval-advanced —— 裁定與五家一致的一手證據相反,理由全部來自自家架構

§1.1 的一手證據極強且結論明確,逐字:「**沒有一家用獨立組織樹,全部掛在使用者物件上**」(Ragic 系統使用者表單的直屬主管欄位 · Salesforce `userHierarchyField` · SAP recipient role)。OQ-AP2-1 卻裁定 **A(由 role tree 推導主管)**,即與五家一致的形態相反。

驗證:`grep -rn "managerActorId|manager_actor_id|manager_id" apps/api/src packages` → 僅 `actions/actions.repository.ts:403` 一則**說明為何不做**的註解,無任何欄位。裁定已落地並 SHIPPED v1.0。

**這不是隱瞞** —— 文件把代價逐條列出(主管變成「一組人」故 N-of-M 由選配變必需;Ragic 客戶的直屬主管欄位要映射成角色關係),並明說「若決策方認為客戶心智就是『一個主管』,則選 B」。依〈向上設計三條〉,條件 ②(架構讓我們能過去)成立,條件 ③ 則有張力:**遷移時 Ragic 客戶的「直屬主管」是一個人,而 role tree 的父角色成員是一組人,兩者不是同構**,`§2.1` 所稱的「映射」實際上是一個尚未設計的資料轉換。建議在遷移工具的 M0 明確承接這一條,否則它會在 pilot 現場才浮現。

---

### 3.6 🟡 data-export —— §2「巨人怎麼做」查了交付形態,沒查產出物怎麼產

§2 對 Salesforce Data Export 與 Google Takeout 的交付形態(非同步 / 到期 / 限次 / 附件 opt-in)查得完整且逐字,§3 現況走查也抓到「唯讀閘門會擋掉自己的救命出口」這種高價值自我打臉。**但 §3 的八列走查沒有任何一列是相依套件**,而 OQ-EX-7 裁定「zip(CSV + manifest.json)」等於當場引入一個新的產出管線。

代價在變更紀錄裡逐字可查,**同一個檔案連踩三次**:
- v0.3:`@types/archiver@8` 宣告 `export class ZipArchive`,`archiver@7` 執行期只有函式 → 「tsc 全綠、一跑就 not a constructor」
- v0.3:`progress` 事件的 `fs.processedBytes`「**只涵蓋檔案系統來源的 entry**」,我方全是 stream → 恆為 0,**大小上限形同虛設**
- v0.5:`archiver` 為 CJS,「vitest 下存在、tsx 下是 undefined」→「單元測試 9 條全綠、瀏覽器一按匯出就失敗」

三者都是「讀一次已安裝版本的 `.d.ts` 與匯出形狀」就能在 M0 攔下的。實害為返工,非正確性,故判 🟡。

---

### 3.7 🟡 frontend-uplift —— 研究紀律最嚴,站②仍在 token 命名空間上失守

本檔的 §0.5「方法教訓」是本批最有價值的一節(四次自我更正逐條列出成因與攔下方式),§0.4 D-5 的方向更正(Sonderegger & Sauer 2010 實為「美感版**更快**」而 v0.3 寫成變長)是典型的「方向性結論最易反轉」實例,已回 PubMed abstract 逐字修正。

站② 的缺口記錄在 FMEA **U16**,逐字:

> Tailwind 4 由 `--transition-duration-*` 產生 `duration-*`;用 `--duration-*` **class 完全不產出**,過場變瞬間完成,而 type-check / lint / build **全數通過**

Tailwind 4 的 theme variable namespace 是官方成文的,屬「查一次文件即可」的站②。文件已把防線升級為「grep 產出的 CSS」,處置正確。

另記 §0.1 A-2 的誠實標注值得作為全庫範例:「『icon-only 在第 N 個失效』**沒有數字型可用性研究**。Material 的 3–7 是規範,非實驗結論。故下文以『越過明載規範』立論,**不宣稱『已被證明不可用』**。」

---

### 3.8 🟡 image-signature-fields —— 產品風險最高的那一題沒有外部依據

§0 對「圖片欄 / 簽名欄是否為獨立型別」查得準確且逐字(Ragic doc/27),並正確標注「Airtable/Teable/Baserow 無簽名欄」為**未查到**而非證實不存在。

但本模組**風險最高的裁定是 OQ-IS-8(簽名的效力宣稱)**,其建議「明文化為畫押圖片,不宣稱不可否認性」完全由內部推理支撐,§0 沒有查:(a) Ragic 官方如何描述其簽名欄的效力;(b) **台灣《電子簽章法》**對何謂電子簽章、何種情形具法律效力的規定。裁定本身保守且安全(判 🟡 而非 🔴),但依據不足以支撐它反過來要用的地方 —— 亦即 R2 合規簽章的邊界劃在哪,目前沒有一手依據可承接。

---

### 3.9 🟡 option-colors —— 研究問對了問題並答對了,裁定沒有採納

§0.1 逐字:「**選項顏色不是 Ragic parity,是 Airtable 範式。**…所以本模組**不會解決任何遷移對不上的問題**;它是一項**增強**。」OQ-OC-4 亦逐字自承:「若目標是遷移 parity,**條件式格式才是 Ragic 使用者手上真正有的功能**,優先度理應更高。**這條值得你重新確認要哪一個**。」

裁定為 A(照做本模組)。這是**研究的結論被完整記錄、且被明示地不採納**,程序上正當(文件把選擇權交了出去)。列為 🟡 的理由是它與 §3.1 合看構成一個模式:同一天出貨的 `conditional-format` 只做了 Ragic 該功能十二分之一,而優先度較低的 `option-colors` 做完整了。

---

### 3.10 🟡 recycle-bin —— 抄了競品的結論,沒驗那個結論的前提在我方成不成立

OQ-RB-6 裁定「還原走背景 job」,依據是 Baserow issue #5101(>50 欄含公式的表還原會超過 gunicorn 30s timeout)。2026-08-03 的 v1.1 自行結案,逐字:

> 「**對碼查證後判定不適用,結案不做**。還原總共只有 **3 句 UPDATE**…**語句數與欄位數無關,且完全沒有 DDL** —— 軟刪從來沒有拆掉物理結構。Baserow #5101 會超時是因為**它的還原重建 schema**,那個前提在本架構不成立。」

即一條 OQ 的裁定是錯的,只是尚未實作故未造成損失。這是「抄結論不抄前提」的乾淨實例。**加分**:§0.5 的 attnum 實測不但推翻了自家 `field-types-parity` §B-1 的既有記載,還附上可複驗的 SQL 腳本,理由逐字為「推翻既有記載的結論必須可複驗,否則下一個人只能選擇相信」—— 建議列為全庫實測的書寫範本。

---

### 3.11 ⚪ 四份站②示範作(建議作為範本引用)

| 模組 | 站② 做法 |
|---|---|
| **settings-center** | **本批最佳**。直接讀已安裝之 `better-auth@1.6.23` dist 原始碼兩處:`plugins/organization/routes/crud-invites.mjs` 的 accept 路徑(**推翻自身「改用轉發連結即可避開 email 驗證」的推論**)、`core/utils/ip.mjs`(證明未設 `trustedProxies` 時 `x-forwarded-for` 照收 → 登入限流可繞過,並實測輪換假 IP 打 12 次**零次被擋**) |
| **webhook-and-events** | 在**本專案 runtime**(Node v24.14.0)實測 undici `connect.lookup` 是否為唯一解析路徑,驗證有效後**因型別衝突改用 `node:https` 再實測一次**,最終**零新依賴**。逐字:「研究給的是對的方向,但最終選型由**在自己 runtime 上的實測**決定」 |
| **full-text-search** | 容器內自原始碼編譯 pg_bigm 實測,並**複驗 planner 是否自行選用索引**(逐字:「若不做這一步,等於『測試因為錯的理由通過』」);另更正 PGroonga 對照頁一則已過時的 pg_trgm 說法 |
| **dynamic-permissions** / **recycle-bin** | 本機 PG 實測(30 萬列 RESTRICTIVE policy 執行計畫比對 / attnum 300 次循環),兩者皆**推翻自身或自家既有文件**的結論 |

---

## 4. 專節:研究做了,但問錯問題

這一類最隱蔽 —— §0 篇幅充足、引用逐字、出處齊全,**看起來完全合規**,失效發生在「查的那幾件事,不是後面要裁的那幾件事」。以下依隱蔽程度排序。

### 4.1 conditional-format —— 查了「怎麼呈現」,沒查「這個功能包含哪些行為」(已證實,已 SHIPPED)

見 §3.1。問題形狀:研究對準了**功能的一個面向**(著色的層級、覆蓋序、色盤來源),並在那個面向上做得很好(覆蓋序「後者覆蓋」經本稽核複驗與官方逐字一致);但**沒有問「這個功能在競品那裡的邊界畫在哪」**。結果是把競品的**一個功能**當成兩個,切掉十一分之十,而 schema 已用 `.strict()` + 必填 `tone` 固化。

**這與 form-templates 漏掉分類軸是同一形狀,但更難發現** —— form-templates 漏的是一個**沒被問的新問題**;conditional-format 漏的是**一個被問了、但問得太窄的問題**,§0 表格看起來已經回答了它。

### 4.2 grid-paste —— 查了「這一題套件給了什麼」,沒查「這個套件在這一題附近還給了什麼」(已證實)

見 §3.2。§0.2 對 `onPaste` / `onCellsEdited` / `getCellsForSelection` 的四段引用經本稽核逐字複驗**全部正確**,是全庫站②的示範。**失效發生在提問的邊界**:同一個 `.d.ts` 裡相隔數十行就有 `fillHandle` 與 `onFillPattern`,而 §1.2 把 fill handle 判為「另立模組」。

### 4.3 pivot-and-charts —— 查了「怎麼算」,沒問「誰在看」(文件自承)

見 §3.4。§0 九節全部圍繞引擎與選型,而 §11(補查後)自承查出三件「**既有設計沒有涵蓋、且會改動實作**」的事,全部屬於「觀看者是誰、他有沒有權限、他當下的篩選是什麼」。

### 4.4 data-export —— 查了「巨人怎麼交付」,沒問「產出物怎麼產」

見 §3.6。§2 的七列對照全部是**對使用者可見的交付政策**(期限、次數、附件、頻率),沒有一列是**產生管線**。裁定 zip 之後才在 M1/M2/M3 逐一撞上三個 archiver 問題。

### 4.5 recycle-bin OQ-RB-6 —— 問了「競品怎麼做」,沒問「它為什麼要那樣做」

見 §3.10。抄了 Baserow「還原要走背景 job」的結論,沒問那個結論的前提(它的還原會重建 schema)在我方是否成立。

### 4.6 approval-advanced OQ-AP2-1 —— 問了「組織關係存在哪」,沒問「遷移時 Ragic 的那一欄要落到哪」

見 §3.5。§1.1 明載 Ragic 的直屬主管是**系統使用者表單上的一個欄位**(一個人),裁定改用 role tree(一組人),但沒有研究這個轉換在遷移時如何進行 —— 而 R1 的整個目的是遷移。

### 4.7 option-colors —— 問對了、答對了、裁定沒採納

見 §3.9。列於此節是為了對照:前六條是**研究的失效**,這一條是**研究成功但未被使用**。兩者的表徵相同(交付了與 parity 目標不對齊的東西),成因完全不同,補救方式也不同。

---

## 5. 共通模式

### 5.1 🔴 站②是三站中唯一在 `_template.md` 裡沒有格子的一站

`docs/modules/_template.md:211-225` 的 §0 硬規定逐字為:「任何為本模組做的**競品 / 規範 / 實測**研究,當下就寫進本檔 §0 證據段」。三個類別對應的是站③與實測,**沒有任何一格對應「自己的相依套件」**;而 §2「上游 / 既有現況走查」的既有用法一律指自家程式碼與 schema(站①)。

本批的分佈與此完全吻合:站①**18/18 到位**、站③ **16/18 為一手逐字**、站② **4 份示範作 / 6 份部分或無**。

**這與記憶中的 `pitfall_rule_without_check_always_drifts`(「規則寫了沒檢查就會漏」)同型** —— 三站寫在 `AGENTS.md`,但沒有落到產出物的結構裡。建議見 §6。

### 5.2 補研究的觸發是「被追問」,不是流程

逐字可查的觸發紀錄:
- `notifications` v0.4:「**決策方問『站在哪些巨人的肩膀上設計』** —— 誠實檢視後確認 v0.1–v0.3 幾乎只站在 Ragic 一個肩膀(本機 7 頁)」→ 隨即**推翻自身四個決定**
- `dynamic-permissions` v0.2:「**決策方追問『有站在巨人的肩膀上嗎』**」→ 推翻核心架構決定
- `frontend-uplift` v0.2 / v0.3 / v0.4:三次皆為「裁定者質疑 / 裁定者問」
- `grid-paste` §0:「v0.1 沒有研究節就直接進設計…**被 review 點出後補**」→ 模組形狀改變
- `form-templates` v0.2:「**review 指出 v0.1 最大的錯**」

**五份文件的關鍵研究都是在被問之後才做的,而每一次補查都改變了裁定。** 這是強訊號:目前的品質不是流程保證的,是靠一位審閱者逐份追問撐起來的 —— 該防線不可規模化,且在未被追問的模組上必然失守(audit-A 的 14 份即為對照)。

### 5.3 承重的授權斷言未附授權識別碼與查證日期

`views-group-kanban-calendar`「Baserow / NocoDB / Teable **皆 OSS**」與 `pivot-and-charts`「Metabase / Superset **皆 OSS**」為同一形狀。clean-room 鐵則的判準是**具體授權**(MIT 可 fork / AGPL 與專有不可),「是 OSS」不是該鐵則承認的粒度;且前者與自家 `dynamic-permissions` §0.8 直接相衝。

對照組:`dynamic-permissions` §0.8 與 `public-form` §0.2 都逐項標了授權(SPDX 級)與變更日期,`pivot-and-charts` §0.6 的圖表庫選型表也標了 SPDX —— **同一份文件對套件標了授權,對被讀原始碼的競品沒標**。

### 5.4 「查不到」的紀律已經很好,但只在有 §0.x 誠實聲明節的文件裡

11/18 份設有明確的「查不到 / 誠實聲明」節(`import-to-existing-form` §0.7、`public-form` §0.6、`webhook-and-events` §0.7、`views-group` §0.7、`pivot-and-charts` §0.9、`recycle-bin` §0.6 等),且多份把「文件沒提到」與「官方明說不做」分開標注(`approval-advanced` §1 導言逐字定義了這個區分)。這是本批最值得保留的紀律。缺這一節的幾份(`conditional-format`、`option-colors`、`image-signature-fields`)恰好也是承重斷言問題較多的幾份。

---

## 6. 補查清單(依實害排序)

| 序 | 項目 | 模組 | 性質 | 說明 |
|---|---|---|---|---|
| **1** | **重裁 OQ-CF-8,並在改動 schema 前決定規則模型是否容納「行為」** | conditional-format | 🔴 已 SHIPPED | 已證實 Ragic 的「條件式格式」含 12 項行為而非 1 項。決定點在**現在**:`formatRuleSchema` 為 `.strict()` + 必填 `tone`,愈晚加判別欄,代價愈高;另一條路(第二份規則清單)會製造兩個設定入口 |
| **2** | **統一 clean-room 的競品原始碼作業規則,並回填授權識別碼與查證日期** | views-group / pivot-and-charts | 🔴 治理 | 目前 repo 內有兩套互斥規則。建議以 `dynamic-permissions` §0.8 的較嚴版本為準並寫進 `AGENTS.md` 與 `_template.md`;兩份文件的「皆 OSS」改為逐項 SPDX + 查證日期,無法確認者標未查證 |
| **3** | **`_template.md` §0 加入「站② 自己的相依套件」欄位,並要求逐站標記** | 全庫 | 🔴 流程 | 見 §5.1。建議 §0 固定三小節(①自家 repo / ②相依套件 / ③競品),每站必填且允許填「N/A + 理由」;站②要求寫出**套件名 + 已安裝版本 + 讀過的 `.d.ts` 路徑**。此為本清單中槓桿最高的一項 —— 它同時處理 §5.1 與 audit-A 的成因 |
| **4** | **複核 fill handle 的工作量估計** | grid-paste | 🔴 排程 | 已證實 `fillHandle: boolean` + `onFillPattern` 為套件內建且未使用。若確認可接到 M1 已建的 bulk update,「另立模組」的估計應下修 |
| 5 | 補查 M4 widget 之外,`pivot-and-charts` §0 是否還有其他「誰在看」類的未問題 | pivot-and-charts | 🟡 | §11 已補三條;建議同法檢查匯出、下鑽、以及 R2 的排程寄送(§11.3 已標為業界共通破口) |
| 6 | 為「Ragic 直屬主管欄位 → role tree」的遷移轉換立項 | approval-advanced | 🟡 | 一個人 vs 一組人不是同構;不設計會在 pilot 現場浮現 |
| 7 | 補查台灣《電子簽章法》與 Ragic 對簽名欄效力的官方描述 | image-signature-fields | 🟡 | 目前 OQ-IS-8 與 R2 合規簽章的邊界皆無一手依據 |
| 8 | 記錄「已評估 `@tanstack/react-table` 分組並否決」或改用之 | views-group | 🟡 | 目前無紀錄,無從判斷是否評估過 |
| 9 | 為缺「誠實聲明」節的三份補上該節 | conditional-format / option-colors / image-signature-fields | ⚪ | 見 §5.4 |

---

## 7. 應保留並推廣的做法

本稽核認為以下五項已達可作為全庫範本的水準,列出以免在後續整併中流失:

1. **`recycle-bin` §0.5 的「可複驗腳本」** —— 逐字:「推翻既有記載的結論必須可複驗,否則下一個人只能選擇相信」。
2. **`webhook-and-events` §0.6 的「在自己的 runtime 上實測」** —— 研究給方向,選型由實測決定,結果是零新依賴。
3. **`settings-center` §0.5(a) 的「先更正一個我自己的錯誤推論」** —— 讀相依套件原始碼推翻自身推論,並把推論與事實分開標示。
4. **`frontend-uplift` §0.5 的「方法教訓」表** —— 四次自我更正逐條列成因與攔下方式,並轉成四條可執行防線。
5. **`approval-advanced` §1 導言對「查不到」的定義** —— 逐字:「凡標『查不到』者為真的查不到,不以推測填空 ——『文件沒提到』與『官方明說不做』對決策的意義完全不同,故分開標注。」

---

## 8. 稽核本身的限制(誠實聲明)

- 本稽核**未查證** Metabase 與 Superset 的實際授權(本機鏡像不含其 LICENSE 檔),§3.4 的指摘僅針對**斷言粒度**,不主張授權必為 AGPL。
- 本稽核**未查證** NocoDB 於 2026-01-29 變更授權一事的原始公告,該事實採信自家 `dynamic-permissions` §0.8;§3.3 的指摘成立於「repo 內兩套規則互斥」這一點,不依賴該日期的正確性。
- 站③ 的複驗只針對判為 🔴 者(`conditional-format` 已回 Ragic 官方鏡像原文複驗),其餘模組的競品逐字引用**採信文件所附出處,未逐條回原文**。
- 站② 的複驗涵蓋 `@glideapps/glide-data-grid@6.0.3`、`@tanstack/react-table@8.21.3` 之已安裝型別;其餘相依套件之引用**未複驗**。
- 本稽核未執行任何測試、未修改任何模組文件或 prod code。
