# workspace-ia.md — [R1·UP-1] 工作區 IA(分類目錄首頁 + app-shell)設計文件

> ✅ **狀態:SHIPPED v1.0(2026-07-25;M1–M5 全綠;api 200 + web 7 e2e 過)**
> **裁定摘要**|1=A 新 `GET /api/categories`(非 admin)· 2=A 導航搜尋先行 · 3=A 通知鈴鐺不上 · 4=A 顯示 updatedAt 不做 counts · 5=A 工作項目獨立模組 · 6=A 左 icon rail。
> **落地**|M1 後端(commit c15913a:categories 讀端點 + forms DTO +categoryId/updatedAt)· M2–M5 前端(commit ec7504e:icon rail + status bar + 分類目錄首頁 + ⌘K palette + Object Page 動作列 + 列印 CSS + workspace.spec 固化)。
>
> docs/27 向上設計規格(OQ-UP 全裁定)之**第一個落地模組**(§6 順序 1)。依 D3 裁定:遷移客戶心智=「單一資料庫 + 業務分類目錄」,非 workspace/base 容器切換,亦非表單卡牆。本模組把首頁 `/app` 重建為**分類目錄**(復用權限軸已 SHIPPED 的 `form_categories`)、落地 app-shell 外殼(status bar + 單域 rail,承 record-workbench OQ-RWB-6=C)、頂部導航搜尋、記錄頁標準動作列。**直接解「頁面單薄」**:目錄密度 + 系統重量,皆有 Ragic 生產實照為證。
>
> 作者:Claude Code(草擬)
> 版本:v0.1(2026-07-24)
> 證據:docs/27 §0 D3、§4(Ragic 實照 `screencapture-ap16...png`=分類目錄首頁、`ragic_select.png`=mega-menu;doc/119 頁籤組、doc/90 客製首頁、doc-user/17 全文檢索、doc/100 工具動作)

---

## 1. 目標與範圍

### 1.1 目標

1. **首頁 = 分類目錄**|`/app` 由卡牆改:分類頁籤 + 每類密集表單連結區塊 + 未分類段;可見性沿用 forms 三態(readable/locked stub/敏感隱藏)。
2. **app-shell 外殼重量**|全域 **status bar**(已連線/更新到秒/租戶/版本)+ **單域左 rail**(W + 工作區 + 我的表單 + 設定群 + 帳號;OQ-RWB-6=C 落地)。
3. **導航搜尋**|頂部搜尋(⌘K):表單名/分類即時過濾導航(client-side,資料源=三態 list,天然不洩無權表單)。
4. **記錄頁標準動作列**|Object Page 加 複製這筆 / 刪除 / 友善列印(print CSS;PDF=瀏覽器列印)。
5. **誠實**|無事件源不上通知鈴鐺;右欄 widget(工作項目/行事曆)不佔位不畫餅 —— 對齊 [[feedback_no_dev_phase_in_product_ui]]。

### 1.2 對應訴求

| 子題 | 訴求 | 對應 |
|---|---|---|
| 工作區 IA | Ragic 客戶遷移零學習之首頁心智模型 | docs/27 D3 + §4 P0;docs/25 §0.4 補列「工作區分類導覽目錄」(2 人月);「單薄」三次反饋之入口面解 |

### 1.3 不做的事

- ❌ **通知鈴鐺**|無真實事件源(P0-4b 未起),空殼=造假 → 隨 P0-4b/工作項目上(OQ-WIA-3)。
- ❌ **工作項目中心**|獨立小模組(OQ-WIA-5),本模組首頁不留空右欄。
- ❌ **跨表記錄全文檢索**|需後端 fan-out/索引 → 表內快速搜尋歸 views-list,全庫歸 P1-I(OQ-WIA-2)。
- ❌ **每表記錄數**|N 張動態表掃描,避免;先顯示 `updatedAt`(零成本)(OQ-WIA-4)。
- ❌ **分類 CRUD UI**|已有(權限頁 ResourceSettings);首頁只消費分類。
- ❌ Email 寄出 / Excel 單筆匯出(隨 P0-4b / 匯出模組)、hover mega-menu(P1 加分)、客製化首頁區塊 10 種(doc/90,P2)。

---

## 2. 上游 / 既有現況走查

| 項 | 現況 | Gap |
|---|---|---|
| `form_categories` | ✅ SHIPPED(authz-resource-inheritance M1;CRUD admin API + ResourceSettings UI)| 只有 **AdminGuard** 端點(`/api/authz/*`)→ 一般使用者讀不到分類 → **M1 新增非 admin 讀端點** |
| forms 三態 list | ✅ `GET /api/forms` 回 readable+locked stub、敏感隱藏 | DTO **無 `categoryId` / `updatedAt`** → M1 補兩欄(form_def 皆已有欄) |
| 首頁 `/app` | 卡牆(稀疏) | 重建為分類目錄 |
| 外殼 | topbar 4 項;無 status bar / rail | M2 重排(OQ-RWB-6=C 已裁定) |
| Object Page | 有;無動作列(僅「在設計器開啟」) | M4 加 複製/刪除/友善列印 |
| 刪除記錄 API | ✅ DELETE 存在(soft delete) | — |
| 複製記錄 | 無專用 API;**client 組值 + 既有 POST create 即可**(autoNumber/formula 欄由引擎重算) | 免後端 |

---

## 3. scope 切分

| 里程碑 | 內容 | 估算 |
|---|---|---|
| **A1 後端小增量** | forms list DTO + `categoryId`+`updatedAt`;`GET /api/categories`(TenantGuard,登入即可讀,tenant-scoped,只回 id/name/position);integration 測(跨租戶不洩) | 0.02 mo |
| **A2 app-shell** | layout:status bar(底)+ 單域左 rail(取代 topbar nav)+ 頂部搜尋(⌘K 導航器) | 0.03 mo |
| **A3 首頁分類目錄** | 分類頁籤/區塊 + 每類表單連結(名稱+updatedAt+locked stub 融合)+ 未分類段 + 空分類隱藏 | 0.04 mo |
| **A4 記錄頁動作列** | 複製這筆(組值→create→導向新記錄)/ 刪除(確認)/ 友善列印(`@media print` CSS,隱 chrome 留單據) | 0.02 mo |
| **A5 固化 + FMEA** | Playwright spec(目錄→搜尋→開表→複製→列印預覽)+ §12;doc v1.0 + MODULES ✅ | 0.01 mo |

**合計 ≈ 0.12 mo**(對應 docs/25 A「分類導覽目錄」2 人月之首期落地)。A1 後端 / A2–A4 前端**分開 commit**。

---

## 4. 設計要點

### 4.1 首頁分類目錄(A3)
- 版面:頂部分類頁籤列(全部 | 分類1..N | 未分類)+ 主區每分類一區塊(標題 + 密集表單連結行:名稱 · updatedAt;locked 顯示鎖圖示不可點)。點頁籤=捲動/過濾至該區。
- **空分類隱藏**:分類下無任何可見(readable/locked)表單 → 整區不渲染(不洩業務域存在;對齊三態語意)。
- 分類排序沿用 `position`;未分類恆末位。「新增表單」入口保留(目錄頂 action)。
- 資料源:`GET /api/categories`(A1)+ 既有 forms 三態 list;前端 join,無新聚合端點。

### 4.2 app-shell(A2)
- **status bar**(全 `/app/*` 頁底):`● 已連線 · 更新 hh:mm:ss · 租戶 <org> · Weyver`。更新時間=最近一次成功 query 時戳(TanStack Query);斷線=最近 query error → 灰點。**不放版本 phase 字樣**。
- **單域 rail**:W(→/app)· 工作區 · 我的表單(builder)· 底部:設定群(權限/帳號安全)· 主題 · 登出/帳號。topbar 移除 nav 只留(必要時)org 名。**不放空業務域 tab**(D3/OQ-RWB-6=C)。
- **⌘K 導航搜尋**:overlay 輸入 → 即時過濾 表單(含所屬分類徽章)/分類/固定動作(新增表單、權限設定);↑↓↵ 鍵盤;資料源=client 已載三態 list → **零後端、零洩漏**。`欄位:值` 記錄語法留給 views-list/P1-I(OQ-WIA-2)。

### 4.3 記錄頁動作列(A4)
- 位置:Object Page 黏頂頭右側。複製=values 淺拷(略 autoNumber/formula/系統欄)→ POST create → 導向新筆;刪除=確認 dialog → DELETE → 回集合;友善列印=`window.print()` + print CSS(隱 rail/status bar/動作列,主欄滿版,`titleOf` + 時戳頁尾)。

---

## 7. 資料模型變動

- **無 schema 變更**。A1 僅:(a) forms list DTO +2 欄(`categoryId`, `updatedAt`,form_def 既有欄);(b) 新唯讀端點 `GET /api/categories`(TenantGuard;`AuthzRepository.listCategories` 復用;**不掛 AdminGuard**——分類名對租戶內登入者非機密,且目錄 IA 需要;跨租戶由 tenant scope 擋)。

## 7-bis. 安全(擇要)

| 面 | 緩解 |
|---|---|
| 分類名跨租戶洩漏 | `GET /api/categories` tenant-scoped(listCategories 既有);整合測:B 租戶讀不到 A 分類 |
| 目錄/搜尋洩無權表單 | 資料源=三態 list(敏感已於後端隱藏);搜尋 client-side 同源 |
| 空分類洩業務域 | 前端隱藏空分類(§4.1);分類端點本身回全列表(登入者可知分類結構,接受——同 Ragic 頁籤語意,doc/119 可見性隨表單權限指的是表單非分類名) |
| 複製記錄繞過欄位權限 | 走既有 POST create(寫白名單 P0-4a M4 強制);不可寫欄由後端拒/略 |

## 8. 測試策略

| 層 | 覆蓋 |
|---|---|
| Integration(api)| categories 端點:登入可讀/跨租戶隔離/非 admin 可用;forms DTO 新欄 |
| e2e(Playwright)| 目錄渲染(分類分組+未分類+locked)→ ⌘K 搜尋開表 → 複製這筆 → 刪除 → 列印預覽(print media);固化進 CI |

## 9. 里程碑

| 里程碑 | 內容 | 狀態 |
|---|---|---|
| **M0** | 本檔 → APPROVED(OQ-WIA-1..6,全採建議) | ✅ |
| **M1** | A1 後端小增量(commit c15913a) | ✅ |
| **M2** | A2 app-shell(status bar + rail + ⌘K) | ✅ |
| **M3** | A3 首頁分類目錄 | ✅ |
| **M4** | A4 記錄頁動作列(M2–M5 commit ec7504e) | ✅ |
| **M5** | e2e 固化(workspace.spec)+ FMEA + doc v1.0 | ✅ |

## 10. 開放問題(OQ-WIA-N)— ✅ 已裁定 2026-07-24（全採建議）

> 全數採「建議」欄(全 A)。進入 M1。

| # | 議題 | 選項 | 建議 = 裁定 |
|---|---|---|---|
| **OQ-WIA-1** | 分類清單給一般使用者 | A. **新 `GET /api/categories`(TenantGuard)**<br>B. 併入 forms list 回應(破壞既有陣列形狀)<br>C. 沿用 admin resources(不可,AdminGuard) | **A** — 乾淨、可快取、不破壞既有 DTO;分類名對租戶內非機密 |
| **OQ-WIA-2** | 首頁搜尋範圍 | A. **導航搜尋**(表單/分類/動作,client-side)<br>B. +跨表記錄搜尋(後端 fan-out) | **A** — 零後端零洩漏;表內記錄搜尋歸 views-list、全庫歸 P1-I(Ragic doc-user/17 全文檢索為 P1-I 對標) |
| **OQ-WIA-3** | 通知鈴鐺 | A. **本模組不上**(等首個真實事件源)<br>B. 殼+永久空狀態 | **A** — 空殼=畫餅,違反不造假;P0-4b/工作項目落地時加 |
| **OQ-WIA-4** | 目錄顯示每表記錄數 | A. **不顯示,改 updatedAt**(零成本)<br>B. counts 端點(N 動態表掃描/快取) | **A** — 避免 N 表掃;counts 待 metadata 快取層(AGENTS P1)再議 |
| **OQ-WIA-5** | 工作項目中心歸屬 | A. **獨立小模組**(手動指派+提醒先行,簽核源隨 workflow)<br>B. 併本模組 | **A** — 本模組守「入口+外殼」邊界;首頁右欄等它落地再加,不佔位 |

> 🔴 **2026-08-03 稽核:OQ-WIA-3 / 5 的擋路理由已經消失,但沒有人回頭看。**
>
> 兩條裁定都建立在同一個前提上 ——「**無真實事件源**」(通知鈴鐺 A、工作項目中心 A)。
> 而 **H-1 通知與 R1·後續-1 簽核(含待簽佇列)皆已 SHIPPED**,
> 事件源不但存在,`approval-advanced` 還做了「我的待簽」。**前提不成立了。**
>
> **這正是「暫緩」型裁定的失敗模式**:它們不像「否決」那樣有終局性,
> 條件解除時也不會有任何東西提醒你 —— 除非當初就把**解除條件寫成可檢查的**。
> `_template.md` §0.4 已加交叉檢查,但那管的是新文件;
> **既有的「等 X 落地再說」型裁定沒有回頭機制**。
>
> **另有一致性問題**:`form-designer-wysiwyg` OQ-FDW-14 對 IA 另有裁定,
> 與本模組「首頁不留空右欄」的邊界主張**未經對齊**。兩份需一起收斂,不宜各自落地。
>
> ✅ **OQ-WIA-8 結案(2026-08-03)——「要不要上」這一題不成立,因為它已經上了。**
>
> 對碼確認:`app/page.tsx` 已渲染 **`PendingApprovals`(待簽佇列)+ `RecentForms`**,
> 且 `_components/notification-bell.tsx` 存在並掛在導覽列。
> **OQ-WIA-3(通知鈴鐺)與 OQ-WIA-5(工作項目中心)兩條「暫緩」都早就落地了**,
> 只是沒有人回頭把裁定改掉。
>
> 🔴 **本題最有價值的產物不是裁定,是它暴露的模式** ——
> 這是本輪**第四次**「建議/待辦其實早就做完了」:
> ① `authz` 0-bis 項 4(繼承分類是 `authz-effective` 的層 3,一直在跑)·
> ② `authz` 0-bis 項 1(UI 早就是平的,`createRole` 恆傳 `parentId: null`)·
> ③ `form-designer-2d` R6 之 `defaultValue`(後端 create 時本來就套用)·
> ④ 本題。
> **共通成因**:寫「待辦」的當下沒有對碼,而待辦一旦寫下就不會自己過期。
> 已寫入 `_template.md` §0.4 的交叉檢查與 memory。
>
> 原始問題保留如下作對照:
>
> ~~**新增 OQ-WIA-8(待裁)**|首頁工作項目槽現在要不要上?~~
> A. 上,且與 OQ-FDW-14 一起收斂 IA(建議) · B. 續押後 · C. 只上通知鈴鐺
> —— **建議 A**:理由不是「功能齊了」,而是**本模組自己在 §(下方)寫過
> 「等於把最高價值元素排到最後」**,那句話當時是取捨,現在是純粹的延誤。

| **OQ-WIA-6** | rail 佈局 | A. **左 icon rail**(W/工作區/我的表單 + 底部設定群/主題/帳號),topbar 縮為情境列<br>B. 保留 topbar + 只加 status bar | **A** — OQ-RWB-6=C 已裁定 rail;A 為其具體佈局(mockup 一致);B 只解一半重量 |

## 12. FMEA(M5 收尾;✅=已驗證緩解)

| # | 場景 | 緩解 | Sev | 狀態 |
|---|---|---|---|---|
| W1 | categories 端點跨租戶洩漏 | tenant scope(TenantGuard + listCategories)+ 整合測 | P0 | ✅ api e2e 斷言 B 讀不到 A 分類 |
| W2 | 目錄/搜尋顯示無權/敏感表單 | 資料源=三態 list(敏感後端已隱藏);⌘K 過濾 locked;e2e | P0 | ✅ 首頁 locked stub + palette 濾 locked |
| W3 | 複製記錄帶入不可寫欄 → 422 中斷 | 組值時略過 autoNumber/formula/系統欄;錯誤信封顯示於 msg | P1 | ✅ 實測:PO-0001 空必填欄「g」→ 422 正確顯示 required 訊息(非靜默失敗),非可寫欄問題;複製本身合法 |
| W4 | print CSS 洩 hidden 欄 | Object Page 已 maskRead(後端不回),print 僅樣式 `[data-noprint]` 隱 chrome | — | ✅ 樣式層無資料面風險 |
| W5 | rail 改版破壞既有路由 active 態 | RailLink isActive(pathname 前綴)沿用 + e2e 導航斷言 | P1 | ✅ builder/permissions/mfa/auth spec 全過 |
| W6 | status bar 訂閱 query cache → 他元件 render 期同步 setState(React 警告)| 改 1s 輪詢(非訂閱)+ `setLastOk(prev⇒相等則不變)` | P1 | ✅ 瀏覽器 console 淨(僅基準 auth 401) |

---

## 0-bis. 追溯稽核(2026-07-29)— **IA 前提「不是全錯,但排序錯了」**

### 🔴 最關鍵的發現:我選的首頁形態,正是 SAP 與微軟都已離開的形態

**兩個明確的公開「功能導覽 → 任務導覽」轉向紀錄:**

- **Dynamics 365(Microsoft Learn 官方)**|AX 2012 的 Role Center **已被 activity-oriented workspaces 取代**,
  官方定義為「回答目標使用者最迫切的活動問題、並讓其發起最頻繁的任務」
- **SAP S/4HANA(官方)**|新 **My Home** 取代舊 launchpad 首頁,內含 **To-Dos 區塊**聚合 My Inbox 任務與 situations

> 對食品廠現場人員,「**今天要出貨什麼、哪張單等我簽**」比「有哪些表」更貼近登入意圖。
> 而 OQ-WIA-5 把「工作項目中心」切成獨立模組、首頁刻意不留位置 —— **等於把最高價值元素排到最後**。

**另一條支持任務導向的研究**|NN/g intranet 研究指出:員工上內網是「**來找特定東西 / 完成任務**」,
且 **task-based 結構比部門式結構更耐組織變動、在可用性測試中更好學**。
→ 這對「依表單分類」vs「依任務」的取捨是直接證據:**分類目錄是部門式思維的近親**。

### 首頁對照

| 產品 | 登入後首頁 |
|---|---|
| **Ragic**(官方 doc/90)| **可客製多欄首頁,10 種區塊**:表單列表 / 行事曆 / **工作項目(待辦)** / 星號資料 / 圖表…;**左側列固定有「常用功能」+「最近使用」** |
| Airtable | 最近開啟置頂 + 星號 + 全域搜尋 |
| Notion | 預設開「上次造訪頁面」;Home = Recents / Favorites / Upcoming |
| monday | **My Work = 指派給我的任務** |
| Smartsheet | 建議項目 + workspaces;左欄 Recents(可釘 20)+ Favorites |

**「純分類目錄」當唯一首頁,查不到任何主流產品這樣做。** 最接近的 Ragic 也只是把目錄當其中一個區塊,並列待辦與行事曆。

### 逐項判斷

| # | 決定 | 判斷 | 依據 |
|---|---|---|---|
| 首頁 = 分類目錄 | ⚠️ **方向對但缺一半** | 分類**有實證支持**:個人檔案檢索研究顯示使用者以 navigation 取回 **56–68%** 檔案、search 僅 4–15%,且資料夾導覽動用與實體空間導航相同腦區。**但「最近使用 / 我的最愛」不是分類的替代品而是加速器** —— 五家全有、Ragic 也有,**目前完全缺席**。表單破百時它才是主要入口 |
| icon rail(無文字標籤) | 🔴 **應改** | **NN/g:圖示必須永遠伴隨可見文字標籤**,無標籤圖示語意極不穩定。**Material 3**:rail 適用 3–7 個目的地,4+ 至少顯示選中項標籤。目前 rail 塞了 Logo + 主導覽 + 設定群 + 主題 + 通知 + 登出,**已超載且異質**(導覽與帳號動作混在一起)。對現場人員 / 品保 / 行政,icon-only 是最高風險選擇 |
| ⌘K 為搜尋主入口 | ⚠️ **保留但不可當主入口** | Google 研究員 Dan Russell 田野調查:**90% 使用者不知道 Ctrl+F**。command palette 是「已熟悉此 app 者的快捷路徑」,對第一天的使用者無效 |
| ⌘K **不搜記錄內容** | 🔴 | 取代 ERP 後使用者要找的是「**那張採購單**」而非表單定義。Ragic 有全庫全文檢索。目前推到 P1-I,對現場情境偏晚 |
| 目錄不顯示記錄數 | ✅ **維持** | **NocoDB 有明確實證**:大表 `count` 需數分鐘甚至 timeout,**導致整個列表卡住不顯示**。若日後要,走 `pg_class.reltuples` 近似值或非阻塞延後載入,不進主查詢路徑 |
| 多租戶不放切換工作區 | ✅ **維持** | Airtable / Smartsheet 的切換是「一人多容器」場景,本產品不是 |
| 全域 status bar | ✅ | 無反例,屬信任訊號合理加分 |

### 建議的首頁形態

**雙軌**:主欄 = 我的待辦 / 待簽核 / 最近使用;次欄或下方 = 分類目錄。
在有真實事件源之前先放「**最近使用 + 星號**」(零造假),同時解掉 recents 缺口。

### 查不到

台灣中小企業 / 現場人員登入首動作的在地量化研究;Ragic 官方對「首頁預設區塊組合」的預設值定義(僅確認 10 種區塊可選)。

### 來源

- [Ragic 客製化資料庫首頁 doc/90(官方)](https://www.ragic.com/intl/zh-TW/doc/90)
- [Airtable Home Screen(官方)](https://support.airtable.com/docs/airtable-home-screen) · [Notion — Navigate with the sidebar](https://www.notion.com/help/navigate-with-the-sidebar) · [monday.com — My Work](https://support.monday.com/hc/en-us/articles/360019300579-My-Work) · [Smartsheet — Personalize your Home](https://help.smartsheet.com/articles/2482308-navigate-your-work-from-home)
- [NN/g — Icon Usability](https://www.nngroup.com/articles/icon-usability/) · [NN/g — Intranet IA Trends](https://www.nngroup.com/articles/intranet-information-architecture-ia/)
- [Material 3 — Navigation rail guidelines](https://m3.material.io/components/navigation-rail/guidelines)
- [Microsoft Learn — Workspace form pattern(D365 F&O)](https://learn.microsoft.com/en-us/dynamics365/fin-ops-core/dev-itpro/user-interface/workspace-form-pattern)
- [SAP — Enabling My Home for S/4HANA](https://community.sap.com/t5/technology-blog-posts-by-sap/sap-fiori-for-sap-s-4hana-empowering-your-homepage-enabling-my-home-for-sap/ba-p/13672904)
- [Navigating through digital folders uses the same brain structures(Scientific Reports)](https://www.nature.com/articles/srep14719) · [Improved search engines and navigation preference in PIM(ACM TOIS)](https://dl.acm.org/doi/10.1145/1402256.1402259)
- [NocoDB — 大表 count 效能 issue](https://github.com/nocodb/nocodb/issues/4287)
- [90% of people don't know Ctrl+F(Dan Russell / Google)](https://www.villagevoice.com/2011/08/20/90-percent-of-people-dont-know-what-ctrlf-does-on-their-keyboards/)

## 13. 變更紀錄

| 日期 | 版本 | 變更 | 作者 |
|---|---|---|---|
| 2026-07-24 | v0.1 | 初版 DRAFT — docs/27 §6 順序 1 落地:分類目錄首頁(復用 form_categories)+ status bar/單域 rail + ⌘K 導航搜尋 + 記錄頁動作列;通知鈴鐺/工作項目/右欄誠實不上;OQ-WIA-1..6;A1 後端小增量(categories 讀端點 + forms DTO 2 欄) | Claude Code |
| 2026-07-24 | v0.2 | **OQ-WIA-1..6 全裁定(全採建議=全 A);DRAFT → APPROVED,進 M1**。M1=A1 後端小增量(`GET /api/categories` 非 admin + forms DTO +categoryId/updatedAt) | Claude Code |
| 2026-07-25 | v1.0 | **M1–M5 SHIPPED**。M1 categories 讀端點 + forms DTO(commit c15913a);M2–M5 前端 app-shell(左 icon rail + status bar 信任訊號)+ 首頁分類目錄(空分類隱藏、三態 locked)+ ⌘K command palette + Object Page 動作列(複製/刪除/列印)+ 列印 CSS + workspace.spec 固化(commit ec7504e)。FMEA W1–W6 全緩解(W6 = StatusBar setState-in-render 改輪詢)。api 200 + web 7 e2e 全綠。 | Claude Code |
