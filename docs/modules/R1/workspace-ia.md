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

## 13. 變更紀錄

| 日期 | 版本 | 變更 | 作者 |
|---|---|---|---|
| 2026-07-24 | v0.1 | 初版 DRAFT — docs/27 §6 順序 1 落地:分類目錄首頁(復用 form_categories)+ status bar/單域 rail + ⌘K 導航搜尋 + 記錄頁動作列;通知鈴鐺/工作項目/右欄誠實不上;OQ-WIA-1..6;A1 後端小增量(categories 讀端點 + forms DTO 2 欄) | Claude Code |
| 2026-07-24 | v0.2 | **OQ-WIA-1..6 全裁定(全採建議=全 A);DRAFT → APPROVED,進 M1**。M1=A1 後端小增量(`GET /api/categories` 非 admin + forms DTO +categoryId/updatedAt) | Claude Code |
| 2026-07-25 | v1.0 | **M1–M5 SHIPPED**。M1 categories 讀端點 + forms DTO(commit c15913a);M2–M5 前端 app-shell(左 icon rail + status bar 信任訊號)+ 首頁分類目錄(空分類隱藏、三態 locked)+ ⌘K command palette + Object Page 動作列(複製/刪除/列印)+ 列印 CSS + workspace.spec 固化(commit ec7504e)。FMEA W1–W6 全緩解(W6 = StatusBar setState-in-render 改輪詢)。api 200 + web 7 e2e 全綠。 | Claude Code |
