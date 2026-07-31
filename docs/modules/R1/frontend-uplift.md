# frontend-uplift.md — [R1·UX-1] 前端重構(視覺 / 心智模型 / 操作體驗 / UI / UX)設計文件

> 🚧 **狀態:APPROVED v1.0(2026-07-31)— OQ-FUX-1..14 全採建議,M1 已完成**
> **裁定摘要**|1=A rail 設定六項收進 S22 設定中心 · 2=A 預設展開可收合 · 3=A docs/14 全採六項校正 · 4=B 邊做邊拆(先 folder 化) · 5=B 鍵盤只做子表+列表 · 6=A Carbon productive token · 7=A 首頁補最近使用+待我處理 · 8=B 維持 compact-only 但修誤套 · 9=A keepPreviousData+延遲細進度條 · 10=A reduced-motion 維持現況 · 11=A 對比三條全修 · 12=A 字階收斂整數六階 · 13=A 視覺規範進 CI · 14=A VisAWI-S 前後測+首次接觸鏈優先。
> **M8 已完成(2026-07-31)**|動效改引 **Carbon productive token**(`--transition-duration-fast-01` 70ms hover/focus · `fast-02` 110ms overlay 離場 · `moderate-01` 150ms 進場/展開 · easing `productive-entrance/exit`)。硬編 duration **零殘留**;原 `duration-75` 是 **Tailwind 預設值非 Carbon 值**,一併對齊為 70ms。
>
> 🔴 **build 抓到 M5 遺留的 Hooks 規則違反**|`useGridKeyboard` 被放在 early return **之後**,載入狀態切換時 hook 呼叫順序會變而崩潰。**type-check 抓不到,只有 lint 會** —— 而 M5 當時**我沒跑 `pnpm lint`**,這是我自己的流程漏。已移至所有 early return 之前(列數/欄數於資料未到時為 0,不影響正確性)。
>
> 🔴 **命名空間踩坑:token 靜默失效**|首版用 `--duration-*`,但 **Tailwind 4 由 `--transition-duration-*` 產生 `duration-*` utility** → class **完全沒產出**,過場變成瞬間完成。而 **type-check / lint / build 全數通過**,只有去查**產出的 CSS** 才發現。教訓已寫入 tokens.css 註解。
> **驗證方式因此升級**:不只看原始碼與 build 是否過,要 `grep` 產出的 CSS 確認 utility 與值(實測 `.duration-fast-01{...70ms}`、`.ease-productive-exit{...cubic-bezier(.2,0,1,.9)}` 皆正確)。
>
> **驗證**|web 98 單元 · lint 0 error · production build 過 · 全 e2e **70 綠 / 4 失敗**(失敗集合等同既有基線,零新增;為本模組至今最高通過數)。
>
> **M7 已完成(2026-07-31)**|載入模式由「整頁替換成一行載入中…」改為**保留內容 + 延遲細進度條**。
>
> 🔴 **開工即發現一個比 M7 本身嚴重的既有缺陷**|query key 是 `["forms"]` 這種**不含租戶**的形狀 → 切公司後 React Query 會把**前一家公司的快取當現有資料直接顯示**(`isLoading=false`),直到重取完成。這不是命名空間問題而是語意問題:**換公司後手上的資料全部來自別家,應當作廢**。修法為切 org 時 `queryClient.clear()`(一處,勝過為 20 個 hook 各加租戶前綴)。`keepPreviousData` 會放大此缺陷,故列為 M7 前提先修。
>
> **落地**|`components/busy-indicator.tsx`:`useDelayedBusy`(延遲 400ms 才顯示、顯示後最短 500ms 防閃爍)+ `BusyBar`(**absolute 定位不佔版面流**,FMEA U8)+ `FirstLoad`(僅首次載入、無資料可保留時)。設定四頁改為 `if (data === undefined) return <FirstLoad />` —— **同時滿足語意(真的沒東西可顯示)與型別收窄**,避免為了移除守衛而到處補 `?.`。records 查詢加 `placeholderData: keepPreviousData`。
>
> **1.4.12 檢查抓到自己人**|`BusyBar` 的軌道是 `h-0.5 overflow-hidden` 被檢查誤報。已補排除條件:**`aria-hidden` 且無文字的純裝飾元素**不承載內容,與 1.4.12 的「內容遺失」無關。
>
> **驗證**|web 98 單元 · 1.4.12 五 surface 綠 · 全 e2e **68 綠 / 6 失敗**(4 個既有基線;`image-signature` 兩支**單獨連跑兩次皆 3 綠**,屬完整套件下的不穩定,非 M7)。
>
> **M6 已完成(2026-07-31)**|**密度誤套修正**:錯誤 / 驗證訊息 **34 處**由 10.5–12px 提到 **13px(inline)/ 14px(區塊警示框)** —— Cloudscape 明載 compact **不得套用**於 alert / 說明 / 表單驗證訊息;固定高度改 `min-h`(`input` / `select` / 狀態章),`input` 字級 12→13px。
>
> **WCAG 1.4.12 做成可執行檢查**|`e2e/text-spacing.spec.ts` 注入官方要求的 `line-height 1.5 / 段距 2 / 字距 0.12 / 詞距 0.16`,再逐元素比對 `scrollHeight > clientHeight 且 overflow:hidden`(排除刻意的 `truncate` / `line-clamp`),涵蓋 5 個 surface。**反向驗證確認會轉紅。**
>
> 🔴 **檢查上線即抓到真缺陷**|app-shell 根層 `h-screen + overflow-hidden`,使用者加大行高後內容溢出即被**永久裁掉搆不到**。
> **修法試錯的紀錄(重要)**|首次修在 `main` 加 `overflow-y-auto` → **打壞 designer / image-processing / image-signature 三支 e2e**:設計器等頁面的內部版面假設 main 不自成捲動容器,加了會使右側面板蓋住工具列。**改在根層 `overflow-hidden → overflow-auto`** 才對 —— 正常時內容剛好填滿不出現捲軸,只有真的溢出(即 1.4.12 情境)才捲。此取捨已寫入 `layout.tsx` 註解,避免日後有人「順手」改回 main。
> 另:左側導覽補 `overflow-y-auto`(導覽項變高時不致搆不到)。
>
> **驗證**|web 98 單元 · 1.4.12 檢查 5 surface 綠 · 全 e2e **69 綠 / 5 失敗**(4 個為既有基線失敗;`image-signature:104` 單獨跑 3 測全綠,屬完整套件下的不穩定,非 M6 造成)。
>
> **M5 已完成(2026-07-31)**|🔴 **決策稿階段再次推翻目標**:`line-items.tsx` 是**唯讀顯示表**(儲存格純文字、無 input),grid pattern 的核心(`F2`/`Enter` 進編輯 / 英數直接輸入)**無處可用**;真正可編輯的子表在 `builder/_components/records/form-panel.tsx`。已產決策稿 `docs/mockups/keyboard-grid-decision.html`(兩邊可實際按)供裁定,裁定採 **A 完整 APG grid**。
>
> **落地**|`components/form/use-grid-keyboard.ts`(照抄 APG:方向鍵不環繞 · `Home`/`End` · `Ctrl+Home`/`End` · `F2`/`Enter` 進編輯 · 英數直接進編輯取代原值 · `Esc` 回導覽 · roving tabindex)掛上可編輯子表;`record-list.tsx` 套 **listbox**(不同規範:僅 ↑↓ 為必要,`Home`/`End` 原文標 Optional)。**`collection-view`(Glide canvas)明確不動**,並以 e2e 斷言其未被加上 grid 標記。
>
> 🔴 **實作中抓到兩個 roving tabindex 的對偶缺陷**|(a) **出不去** = 攔截 `Tab` → 鍵盤陷阱(FMEA U4,反向驗證確認測試會轉紅);(b) **進不來** = 選取項不在清單中時**無任何項目持有 tabIndex 0**,鍵盤根本無法進入 listbox(實作首版即犯,由 e2e 抓到)。兩者同源:**roving 必須恰有一個停點**,多了少了都是缺陷。
>
> **連帶**|記錄清單項的 role 由隱含 `button` 改為 `option`,`record-workbench.spec` 兩處斷言同步更新 —— 語意變更的正確連帶,非測試遷就實作。
> **驗證**|web 98 單元(+6)· `grid-keyboard.spec` 6 測綠 · 全 e2e **65 綠 / 4 失敗**(失敗集合與既有基線相同,零新增)。
>
> **M4 已完成(2026-07-31)**|🔴 **開工前查證推翻了本文件 §2.3 的判斷**:「待我簽核」**早已實作並掛在首頁**(`pending-approvals.tsx`,含「無待簽則不渲染」的誠實處理),v0.1 沿用 task #108 的描述未查證即記為「缺」。**M4 實際範圍因此縮為只做「最近使用」。**
>
> **作法偏離原計畫,理由如下**|原訂「新端點 + 測試」。改為**本地記錄 formId + 渲染時對照 `useForms()` 授權清單解析**:那份清單本就 tenant-scoped 且經三態可見性過濾,故跨租戶 / 越權 / 已刪除的 id **比對不到就不出現**,安全性由建構保證,且省下一張新表與每次開表單的熱路徑寫入。**代價誠實記錄:per-device**,換機器即無;日後若需跨裝置(或需真實使用頻率數據以複核 OQ-1 的設定頁假設)再改後端 `form_access` 表。
>
> 🔴 **反向驗證的重要發現**|拿掉 key 的租戶隔離後 **e2e 仍通過** —— 因 formId 全域唯一,另一租戶的授權清單本就沒有該 id,第二層即已濾掉。即 **FMEA U5 由「授權清單解析」單獨滿足**,key 隔離為縱深防禦 + 體驗(換公司看到該公司的最近使用而非空白)。單元測試直接測 key,拿掉即轉紅 —— 兩層各有測試守著。
> **驗證**|web 92 單元(+5)· e2e `recent-forms.spec` 2 測綠(含租戶隔離)· type-check 0 error。
>
> **M2 已完成(2026-07-31)**|rail 由 **13 個互動項 / 10 個目的地**收斂為 **7 個互動項 / 3 個主目的地**(工作區 · 我的表單 · 設定),設定六項收進新建之 `/app/settings` hub(S22)。**預設展開 172px 含文字標籤**,可收合為 56px 圖示態,偏好存 `localStorage`(純 UI 偏好,跨分頁共用為正確行為 —— 與 F-10 刻意不用 localStorage 存 org 的理由相反,那裡跨分頁共用正是缺陷本身)。
>
> **§3 驗收線量測**|
> | 路徑 | 前 | 後 | 判定 |
> |---|---|---|---|
> | 工作區 / 我的表單 | 1 次點擊 | 1 次點擊 | ✅ 未增加 |
> | 通知 / 配色 / 登出 | 1 次點擊 | 1 次點擊 | ✅ 未增加 |
> | **設定六項(滑鼠)** | 1 次點擊 | **2 次點擊** | ⚠️ +1 |
> | **設定六項(鍵盤 ⌘K)** | **6 項中 5 項搜不到** | **6 項全可一次搜到** | ✅ **改善** |
>
> 🔴 **同批補上的緩解**|收斂前 ⌘K **只涵蓋「權限」一項**。若當時只做收斂,其餘五項會**同時失去「一次點擊」與「鍵盤可達」兩條路徑** —— 那才是反面教材(Windows 11 / Jira / Sonos)真正的死因。故 `settings-nav.ts` 建為**單一定義**,由 rail / hub / ⌘K 三處共同消費,避免任一處漏項。
> ⚠️ **誠實**|OQ-1 原要求「先量測六項使用頻率」。**本產品尚未上線,無使用數據可量**。改以性質判斷:六項皆為**管理型、非日常高頻**(權限配置 / 通知規則 / 公開表單管理 / Webhook 金鑰 / 回收桶 / 帳號安全),且回收桶這類「需要時很急」者由 ⌘K 一次可達。**上線後應以實際數據複核**,高頻者需移回第一層。
>
> **M1 已完成(2026-07-31)**|`docs/14` 升 **v5.0**。除原訂六項外,施工時另發現三處**過期且會誤導施工**者一併處理:**§2.4 圓角/陰影與 §0.1 v3 正面矛盾**(照原文施工會蓋回已否決的 austere 規格)· **§2.1 色值仍為 v2.1 舊值**與 shipped `tokens.css` v3.0 不符 · **§2.5/§2.6 字級與尺寸節奏**過期(含已不存在的 topbar 42px)。另修 §4 Do&Don't 三列舊值 + 補三列新規範,以及 §1.2「動效近乎無」措辭。
> **v0.4 變更**|① 🔴 **更正 v0.3 之方向誤述**:Sonderegger & Sauer 2010 實為「美感版**任務時間縮短**」(PubMed abstract 逐字),v0.3 寫成變長並據以主張「不做視覺質感」。真實狀態為**效果量小(統合分析 g=0.12)且方向無共識**。② 新增 **§0.6 研究 E**(裁定者問「有無研究可站在巨人肩膀提高質感」)—— 工藝感**已被操作化**:VisAWI 之 **Craftsmanship** 面向、短版 4 題可前後測、官方門檻 4.5;且**效果窗口落在首次接觸**(7 週歸零),恰為 R1「land 既有 Ragic 客戶」之目的。③ 新增 **§4.11** 與 **OQ-14**。④ 新增 **§0.5 方法教訓**(本模組四次自我更正之成因與防線)。
> **v0.3 變更**|裁定者問「視覺需要重構嗎,參考哪些巨人?」→ 補研究 D(§0.4)+ 視覺實測(§2.7)+ §4.10 + OQ-11/12/13 + FMEA U11–U14。**v0.2 §1.2 排除視覺重新設計之理由成立,但本人並未先查證「視覺有無巨人」即下結論,屬方法上的漏。** 補查後結論兩面:(a) 🔴 **本人的框線警報被推翻** —— 表格框線 1.25:1 **合規**(1.4.11 不要求控制項有可見邊界;Carbon 官方更淡且明知照發),全框線主張不動;(b) 但**確有三條實測不合格**與**字階 16 種不成階**,故視覺仍需重構 —— 是修不合格與收斂,**非重新設計**。
> **v0.2 變更**|裁定者質疑「動效是站在什麼巨人的肩膀上?」→ 補研究 C(§0.3)。**v0.1 §4.7.3 的動效數字查無出處、係本人憑印象所寫,已刪除**,改引用 Carbon productive token。新增 §2.6(動效現況實測:幾乎不做動畫、但版面一直跳)+ §4.9(動效與版面穩定性)+ OQ-9/10 + FMEA U7–U10。**本人另有一處自我推翻**:先前主張「現在加 `prefers-reduced-motion` 是為不存在的問題加防護」,經 C-7(2.2.2 為 Level A)後不成立,已改口(見 §2.6 更正說明)。
> **性質**|**橫切品質模組**,非新 surface。既有 UP-1..4 逐一交付了 surface,本模組處理「交付累積後才浮現」的跨頁問題:導覽承載量、鍵盤正典、密度可及性、結構債。
> **上游**|docs/24(心智模型,不得凌駕)· docs/27(D1–D4 向上設計裁定)· docs/14(視覺 token)· docs/26(品牌)
> **方向確認稿**|`docs/mockups/frontend-uplift-directions.html`(色彩/圓角/字級直取 `packages/ui/src/styles/tokens.css` v3.0,非另立一套;第 3 節可互動,按鈕同時觸發兩種載入模式對照)
> **關聯已 SHIPPED 模組**|workspace-ia(UP-1)· views-list(UP-2)· form-designer-2d(UP-3)· record-workbench-ui
> 作者:Claude Code(草擬)

---

## 0. 研究(站在巨人的肩膀上)

兩份平行研究。**證據強度逐條標注** —— 這是本文件最重要的紀律,因為下面會出現「研究推翻我方既有主張」與「研究反而佐證我方主張」兩種結果,兩者都必須誠實記錄。

### 0.1 研究 A|表單資料庫平台的 IA 與導覽

**A-1 沒有任何一家靠「側欄全列」撐 100+ 物件。** 共通三層防線:(a) 分類容器 (b) 最近 + 我的最愛置頂 (c) 命令面板 / 全域搜尋。

| 系統 | 層級 | 側欄全列 | 主要輔助 |
|---|---|---|---|
| Ragic | 頁籤群組 → 頁籤 → 表單 | 否(hover 才出) | 頁籤多就開「頁籤群組」再分一層;首頁常用/最近使用〔官方〕 |
| Airtable | workspace → base → table(頂部水平 tab)→ view | 否 | 首頁 Recents/Starred;**表 tab 溢出是社群 7 年老問題**〔官方+社群〕 |
| Notion | 側欄無限巢狀樹 | 形式上是,但每區塊可只顯示 5 | Home 聚合 Recents/Favorites;⌘P/⌘K〔官方〕 |
| NocoDB | workspace → base → table | 是 | **⌘K 跨物件 quick actions、⌘L 最近檢視**〔官方〕 |
| Coda | 頁面樹 + bookmark | 是 | **官方自己警告 top-level 太多會變「躲貓貓」**〔官方〕 |

**A-2 純圖示導覽有明載上限,且 icon-only 是降級態不是預設態。**

| 來源 | 明載內容 | 強度 |
|---|---|---|
| **Material 3** | collapsed rail **3–7 個**目的地;**>7 必須改用 expanded rail** | 官方 |
| **WinUI NavigationView** | ≥1008px 展開 / 641–1007px compact icon-only / ≤640px minimal → **icon-only = 空間不足的降級** | 官方 |
| **NN/g** | 除 home/print/search 外多數圖示歧義;**文字標籤必須隨時可見,不靠 hover** | 官方文章 |
| **GOV.UK** | 多數情況避免用圖示;**例外正是「case working 系統、熟悉且反覆使用」**——但仍建議加可見文字 | 官方 |
| **Slack(2023)** | 可右鍵切換「僅圖示 / 圖示加文字」,未勾項目收進 More | 官方 help |

> ⚠️ **誠實**|「icon-only 在第 N 個失效」**沒有數字型可用性研究**。Material 的 3–7 是 rail 目的地**規範**,非實驗結論。故下文以「越過明載規範」立論,不宣稱「已被證明不可用」。

**A-3 儀表板當首頁有公開反例。** Jira 把預設 landing 從 Dashboards 改為「Your work」〔Atlassian JRACLOUD-73316〕。docs/24 的反儀表板立場**由我方主張升級為有外部佐證**。Ragic 官方首頁即「頁籤 + 表單清單」的目錄形態〔官方〕。

**A-4 記錄頁正典(Fiori Object Page)**|Header(標題/狀態/全域動作 + 關鍵事實)→ **Anchor bar**(水平錨點、恆常可見、單一 section 則不出現、超寬收進階層式 overflow)→ Sections → **Floating footer toolbar**(只放 closing/finalizing 動作、右對齊、**按鈕只用圖示或只用文字不混用**)。Size S 單欄、header 收合成 summary line。Salesforce Highlights Panel **最多前 7 欄**;Dynamics header **4 個唯讀欄位**且**主要資訊必須在第一個 tab**。

**A-5 欄位設定面板**|Airtable 先「名稱+型別」,**型別決定其餘**;Baserow 單層扁平無 advanced 區;NN/g progressive disclosure 要求「初階清單夠小 + 入口有 information scent」。建議三段:基本 / 型別專屬 / **單一「進階」摺疊區**,**不要用橫向 tab**(面板窄易被忽略);摺疊區含非預設值時在收合標題顯示摘要 badge。

**查不到**|各家「最近/我的最愛/搜尋」實際流量占比(無公開遙測)· Fiori section 數量硬上限 · VS Code activity bar 官方項目數規範。

### 0.2 研究 B|高密度企業級介面的視覺與互動工藝

**B-1 🔴 推翻我方既有依據**|**找不到任何權威文件把「專業工具 vs 玩具」拆成可操作清單**;Linear / Superhuman / Height / Sigma **都沒有公開設計系統**,流傳的「Linear design system」皆為第三方逆向。
→ **docs/14 §0.1 v3 那張鬆綁表的外部依據比原先標示的弱,它是我方假設。** 應在 docs/14 標注,不得再以「業界如此」引用。(第三方逆向另指出 Linear 內文為 16px/1.5 —— 其密度來自**緊列高與間距,非小字**,與我方「靠 12.5px 小字取得密度」路徑不同。)

**B-2 🔴 推翻我方既有措辭**|**查無任何主流系統明文宣告「刻意不做動效」**。「近乎無動效」不是明載主流,是我方立場。可辯護的講法是「**動效預算**」而非「禁動效」。NN/g:100–400ms,簡單回饋 ~100ms、modal 200–300ms。Cloudscape 明載必須遵循 `prefers-reduced-motion`、閃爍不得 >3 次/秒〔官方〕。

**B-3 ✅ 反而佐證我方**|斑馬紋 vs 全框線:A List Apart 實驗(n=2,276 有效 session)—— 8 題僅 3 題準確率顯著提升、速度幾無顯著;偏好調查(n>1,200)單色隔列 31% 最有幫助/4% 最不喜歡,**純框線版 20%/4%** →「框線版被討厭的比例與斑馬紋相同」。**我方全框線立場站得住,不必改。**

**B-4 ✅ 可直接照抄的硬規範 —— 本研究最高價值產出**

| 項目 | 明載內容 | 來源 |
|---|---|---|
| **鍵盤** | **W3C ARIA APG grid pattern**:方向鍵不環繞 · `Home`/`End` 列首末 · `Ctrl+Home`/`Ctrl+End` 表首末 · `Enter` 進編輯 · **`F2` 切換編輯/導覽** · 英數直接進編輯 · `Esc` 回導覽 · `Shift+Space` 選列 · `Ctrl+Space` 選欄 · **roving tabindex:整個 grid 只有一個 Tab 停點** | W3C 官方 |
| **列高階梯** | Carbon:xs 24 / sm 32 / md 40 / lg 48 / xl 64;**表頭列高必須等於資料列高** | 官方 |
| **密度規則** | Cloudscape:compact **不可取代** comfortable、**必須可切換**、**不得只套單頁**;**不套用**於 alert / 說明 / 表單驗證訊息,亦**不套用**於 select、日期選擇器等小點擊目標(Material 同:密度不套用於輸入框) | 官方 |
| **字級** | **WCAG 無最小字級規定**;Lighthouse 要求 ≥60% 文字 ≥12px → 12.5px 過關 | 官方 |
| **間距** | Cloudscape 密度建於 **4px 基本單位**,compact 以 4 為增量遞減 | 官方 |

**B-5 🔴 WCAG 1.4.12 是可執行的驗收測試**|使用者套用 `line-height 1.5 / 段距 2 / 字距 0.12 / 詞距 0.16` 時**版面不得破**〔官方〕→ 列高必須 `min-height` 可撐開,**禁 `height` + `overflow:hidden`**。注意:此條**不是**要求我方把行高設成 1.5。

**B-6 信任訊號**|**查不到「時間戳提升信任」的對照研究**(我方 docs/14 該條為假設)。但 Fiori 有明文機制可照抄:草稿/鎖定狀態 popover 顯示**最後修改者+時間**;**編輯模式 footer bar 永遠存在,即使沒有任何動作按鈕**——因為它是 message popover 的宿主,訊息按 section 分組〔官方〕。→ 我方「狀態列」應定位為**訊息與未存變更的固定錨點**,而非裝飾條。

**B-7 🔴 反面教材的共同結論(本文件的驗收線來源)**

| 案例 | 反彈點 |
|---|---|
| Windows 11 右鍵選單 | 常用項塞進「顯示其他選項」二次點擊;微軟 2026-06 公開承認並改為可設定 |
| Jira 2025 導覽改版 | 側邊欄過擠、功能被埋、效率下降〔社群,非官方承認〕 |
| Sonos 2024 App | 移除睡眠定時/佇列編輯等**能力**;>30,000 客訴、股價 −25%、CEO 下台 |
| Bloomberg | 密度與鍵盤慣例被肌肉記憶鎖死;使用者以駕馭複雜介面為專業認同 |

> **沒有一個死於不夠好看,全部死於「每次操作多一次點擊 / 命令被藏起來 / 原有捷徑失效」。**

**查不到 / 無共識(五項,不得對外引用為依據)**|專業感的可操作分解 · 表格列高與掃視效率實測 · 信任訊號對照研究 · 斑馬紋 vs 框線定論 · Linear/Superhuman/Retool/Sigma 官方密度規格。

### 0.3 研究 C|動效、載入與版面穩定性(2026-07-30 補)

> **緣起**|裁定者質疑「動效是站在什麼巨人的肩膀上?」—— 質疑成立。v0.1 §4.7 所寫的 `overlay 120–160ms / 行內展開 150–200ms` **查無出處,係本人憑印象所寫**,卻被冠上「動效預算」之名。**已刪除。** 本節為其替代。

**C-1 我方數字的裁決**|數量級正確(落在 Carbon `moderate-01/02` 150/240ms 與 Cloudscape 115/165ms 之間),但**不是任何設計系統的 token 值**。→ **不自創,直接引用有出處者。**

| 系統 | duration token(ms) |
|---|---|
| **Carbon(IBM)** | fast-01 **70** · fast-02 **110** · moderate-01 **150** · moderate-02 **240** · slow-01 400 · slow-02 700 |
| Material 3 | short1–4 50/100/150/200 · medium1–4 250–400 · long1–4 450–600 |
| Fluent 2 | 50/100/150/200/250/300/400/500 |
| Cloudscape | 115(快速回饋)· 165(較具表現力)· 250(需引起注意) |
| SAP Fiori | **無 duration token 表**,只規範 busy indicator 延遲 |

**採 Carbon productive**:IBM 明確標示為企業生產力軟體設計,且**與我方已採用的 IBM Plex 同源**。easing:`productive-entrance (0,0,0.38,0.9)` / `productive-exit (0.2,0,1,0.9)`。跨系統唯一共識:**進場減速、離場加速、離場短於進場、生產力情境用較短一檔**。「300ms 最自然」等說法**查無出處**。

**C-2 載入時間門檻**〔官方〕|NN/g 三門檻 0.1 / 1.0 / 10s(源 **Miller 1968 + Card et al. 1991**)· **<2s 不需任何載入指示** · 2–10s 用 spinner/skeleton · **>10s 必須 percent-done 進度條**。Fiori:**延遲 1000ms 才顯示 busy indicator、最短顯示 500ms 防閃爍、>10s 給 Cancel**。Salesforce:>300ms 才用 stencil。→ **無共識**:delay 取 300 還是 1000。

**C-3 🔴 骨架屏:證據站在反方**|Viget 2017(n=136,三組同長度等待)—— **skeleton 組全面最差**:任務完成時間最久、主觀評價最負面、猜測等待最長。廣傳的「skeleton 快 30–50%」「3 秒 skeleton ≈ 1.5 秒 spinner」**查無原始研究**。**NN/g 從未宣稱 skeleton 較快**,只給情境分工(spinner 用於單一模組、skeleton 用於整頁),並警告 <1s 用 skeleton 會閃爍。
→ **對高密度表格的額外風險**:skeleton 列高若與真實列高不符,**自己製造 CLS**。

**C-4 CLS / INP:官方硬閾值**〔官方〕

| 指標 | 良好 | 不良 | 細節 |
|---|---|---|---|
| **CLS** | **≤0.1** | >0.25 | 75 百分位;分數 = impact fraction × distance fraction;**session window**(相鄰位移間隔 <1s、單窗上限 5s,取最大窗) |
| **INP** | **≤200ms** | >500ms | 75 百分位;**2024-03-12 取代 FID**(FID 只量首次互動的輸入延遲,INP 量所有互動至繪出下一幀);**>50ms 即 long task** |

🔴 **互動豁免有邊界**:離散輸入(tap/click/keypress)後 **500ms 內**的位移排除計分;**但 scroll / drag / pinch-zoom 不算「近期輸入」,不豁免**。→ 輪詢刷新、背景 job 完成插入列、WebSocket 推播**皆不豁免**。

**C-5 compositor 的正確表述**〔官方〕|web.dev 原文:**只有 `transform` 與 `opacity` 兩個屬性,compositor 可獨力處理變更**,**跳過 layout 與 paint**。正確說法**不是**「GPU 比較快」。觸發 layout:`width`/`height`/`top`/`left`/`margin`/`padding`;觸發 paint(不觸發 layout):`background-image`/`color`/`box-shadow`。Lighthouse 有 non-composited animations 稽核,但**抓不到 JS 驅動的**。

**C-6 🔴 交錯進場:證據明確站在反方**|**Chevalier, Dragicevic & Franconeri, IEEE TVCG 2014** —— 交錯被宣稱能減少遮擋、降低複雜度,但**過去無任何實證支持**;該研究即使在**對交錯最有利的情境**下,效果仍「差到令人沮喪」。→ **明令禁止**列表/表格逐項淡入:除證據不支持外,它直接延長「最後一列可見時間」,對整天掃資料者是純成本。

**C-7 WCAG 等級明確**〔官方〕

| 條款 | 等級 | 要求 |
|---|---|---|
| **2.2.2** Pause/Stop/Hide | **A** | 自動開始 + **持續 >5 秒** + 與其他內容並列的移動/閃爍 → 須可暫停/停止/隱藏。**自動更新內容無 5 秒豁免**;例外含 **preload/進度指示器** |
| **2.3.1** 三次閃爍 | **A** | 任一秒內閃爍不超過 3 次 |
| **2.3.3** 互動觸發的動畫 | AAA | 非必要 motion animation 須可停用 |

🔴 **最易誤踩**:skeleton shimmer 若持續 >5 秒且與其他內容並列 → **觸犯 Level A**。

**C-8 `prefers-reduced-motion`:兩種立場都有出處**|WebKit 官方明言「以無障礙之名移除 100% 的網頁動畫,不會得到真正有幫助的結果」——問題出在**特定種類或程度的動作**,而非動畫存在;Apple 原始提案即「以細微 dissolve 取代全螢幕縮放」,並指出**單純交叉淡入不引入動作,已知不會造成動作敏感者不良反應**(W3C 技術 **C39**)。**但** Cloudscape 選擇「停用所有非必要動畫」也是成文做法。→ **不是單一答案。**
**前庭功能障礙**:WCAG Understanding 2.3.3 **只點名 parallax 捲動**;常見的「避免視差/縮放/旋轉」三件套**屬社群慣例非官方**。

**C-9 🔴 樂觀更新:查無任何官方禁令**|查無任何主流設計系統寫出「涉及金額/過帳不得樂觀更新」;React `useOptimistic`、TanStack Query 只描述機制與回滾,不談適用邊界。二手來源有此主張但屬業界慣例。
→ **必須明示為本專案自訂規則**,依據 AGENTS.md「傳票不可變」+ 冪等性鐵則,**不得假借業界權威**。

**C-10 模態**〔官方〕|NN/g:modal 是 heavyweight 選擇,**只有在使用者「必須」互動才能繼續當前任務時才適用**;確認框過度使用會導致無腦按 Yes,反而失效。

**🔴 應從規範中刪除的無據說法(五項)**|① 骨架屏快 30–50% ② 交錯淡入提升感知效能 ③ transform/opacity 快是因為走 GPU ④ 動效 300ms 最自然 ⑤ **本人 v0.1 所寫的 120–160 / 150–200ms**。

### 0.4 研究 D|視覺規格的巨人(2026-07-31 補)

> **緣起**|裁定者問「頁面的視覺設計需要重構嗎,你參考哪些巨人?」—— v0.2 §1.2 把視覺重新設計排除,理由(反面教材死於能力與延遲非外觀)本身成立,**但本人並未先查證「視覺有無巨人」就下結論**,屬方法上的漏。本節補齊。

**D-1 🔴 推翻本人的框線警報 —— 全框線主張合規,不必動**

本人實測我方框線僅 1.11–1.25:1,遠低於 WCAG 1.4.11 的 3:1,一度判定與「全框線 + 禁陰影」核心主張衝突。**研究推翻此判定。** W3C Understanding 原文:

> 「本準則**不要求控制項具有指示點擊區的視覺邊界**。若控制項具有可見內容(如文字或對比足夠的圖示)……**不需要邊框或其他整體邊界指示**。」
> 「具有視覺邊界……**僅在沒有其他視覺方式可辨識該控制項存在時才需要**。」

判準 = **邊界是否為識別該控制項所必需**。故:

| 元素 | 是否受 1.4.11 規範 |
|---|---|
| **表格框線 / 卡片邊框 / 分隔線** | **否** —— 表格非 UI component,資料本身傳達結構 |
| 輸入框邊框 | **視情況** —— 有可見 label / placeholder / 內容則免;**空白且無任何可見文字時,邊框成為唯一識別 → 需 3:1** |
| **必須 3:1** | focus indicator · checkbox/radio/toggle 邊界與勾選符號 · 狀態指示(選取/展開)· 圖表中理解內容所需的圖形 |

**最有力的實證背書**|**Carbon 官方 `border-subtle` = Gray-20 `#e0e0e0`,對白底僅 1.32:1**;2022 issue #12355 團隊自嫌過淡,也只調到 Gray-30 `#c6c6c6` = 1.71:1 —— **明知遠低於 3:1 且照發**。Carbon 灰階中第一個過 3:1 的是 Gray-50 `#8d8d8d`。我方 `#e3e6ea` ≈ 1.25:1,**比 IBM 淡一階,屬同一領域,合規**。

**D-2 字階:三大系統皆無 12.5px 對應,且我方地板遠低於所有系統**

| 系統 | 內文 / 最小字級 |
|---|---|
| **Carbon** | 字階 **12, 14, 16, 18, 20, 24, 28, 32, 36, 42, 48**(自訂加法公式,**無任何非整數 px**);`body-compact-01` 14/18;**label / caption / helper = 12/16 為最小** |
| **Fluent 2** | Caption2 10/14 · **Caption1 12/16** · Body1 14/20 · Subtitle2 16/22 |
| **SAP Fiori** | 🔴 官方明載「**compact 模式字級不變,只縮元件尺寸與間距**」→ **密度靠間距,不靠縮字** |

→ **12.5px 在三大系統皆無對應**(其 productive 內文一律 14px,12px 是 label 地板);且 **12.5px 會產生 sub-pixel rounding**;CJK 因漢字筆畫密度高,12px 級在非 Retina 上易糊。**12.5px + CJK 查無任何官方依據。**

**type scale 比例無實證**|Carbon 用加法公式而非等比,即最強反證;1.2 / 1.25 / 黃金比例皆屬慣例。→ **可自訂整數階,不必套比例。**

**measure**|Dyson & Haselgrove 實證:**~55 cpl 主觀最易讀、~95 cpl 讀最快**(速度與偏好背離)。ERP 表格是**掃描非閱讀** → 不套 66 cpl;僅長文欄位(備註/說明)限寬。

**D-3 類別色:我方 8 組在上限邊緣**|**Okabe–Ito**(Color Universal Design 2002;Wong 於 Nature Methods 2011 推廣)= **8 色 + 灰**,經三型色覺模擬驗證,是**唯一被廣泛採用且公開可驗證**的色盲安全類別色集;實務建議 ≤6 色。ColorBrewer qualitative 各 palette 上限不同(Set1=9、Set3=12),**未見「上限 = N」的成文結論**。Carbon 官方承認資料視覺化是配色的終極壓力測試,且 charts issue #1244 有色盲用戶回報 Purple 70 與 Cyan 50 無法分辨 —— **大廠亦未解決**。
→ 我方 8 組**已在邊緣**;文字恆在(已落實)是關鍵緩解。

**D-4 感知排序(Cleveland & McGill 1984;Heer & Bostock 2010 群眾外包重做結果一致)**
**共同基準軸位置 > 非對齊軸位置 > 長度/方向/角度 > 面積 > 體積/曲率 > 明暗/色彩飽和度(最末)**。2022 Northwestern 研究指個體差異大,排序不宜當硬規則。
→ **表格數字本身即最精確的編碼,優於任何 chart**;儲存格內若加視覺編碼用**條長**,**禁以背景色深淺表數量**(排名最末);sparkline 只表趨勢不表量值;數字右對齊 + **tabular figures**(我方 `.tabular` 已開 `tnum` ✅)。

**D-5 「視覺質感 → 效率」:效果量小且方向無共識(⚠️ 本節於 2026-07-31 更正,原文方向寫反)**

> 🔴 **更正紀錄**|v0.3 原寫「Sonderegger & Sauer 2010 顯示高美感版任務完成時間**變長**、客觀績效變差」,並以此作為「不做視覺質感」的主要依據。**方向寫反了。** PubMed abstract 逐字為:「the visual appearance of the phone had a positive effect on performance, **leading to reduced task completion times for the attractive model**」——**美感版更快**。
> 成因:採信子研究的摘要而**未查證方向**,且該結論屬載重論據。已於 §0.5 記為方法教訓。

**正確的證據狀態 —— 混合,且效果量小**

| 來源 | 對客觀績效的效果 |
|---|---|
| **Sonderegger & Sauer 2010**(n=60) | 美感版**任務時間縮短**(正向) |
| **Thielsch 等 2019b 統合分析** | **g = 0.12**(小的正向);情境差異大 —— 行動/軟體較強,**網站則無** |
| **Frontiers 2023**(n=281) | 完成時間 **d = −0.06, p = 0.60**(幾乎為零);績效分數 d = 0.22, p = 0.07 未達顯著 |
| Sauer & Sonderegger 2011 · Sonderegger 等 2014 | **反向**效果 |
| Douneva 2015 · Gu 2016 · Thielsch 2019a | **無顯著**效果 |

2023 該文原文:「results on the relationship between aesthetics and performance are often contradictory」「**there is still no consensus on whether aesthetics affect performance**」。

**→ 可安全主張的結論(方向修正後仍成立,但理由不同)**
1. **不得以效率為由推動視覺質感** —— 但理由**不是**「會變慢」,而是**效果量小(g = 0.12)且方向無共識**,不是可靠的槓桿。
2. **感知面的效果則穩健**:Kurosu & Kashimura 1995 / Tractinsky 2000(r>0.9)—— 美感強烈影響**感知**易用性。故質感的正當理由仍是**信任感與感知專業度**(影響採購決策與留存)。
3. **效率要靠功能性手段**:密度、對齊、定位輔助、tabular figures;NN/g 表格研究支持的正是這類(淡框線 + 凍結表頭/首欄 + hover 高亮),非美感。

→ 對本模組的**實際影響:無**。§1.2「不做視覺重新設計」與 §4.10「只修可量測項」的範圍不變 —— 因為那個範圍本來就建立在「對比度與字階是**正確性**問題」,而非「美感有害」。**但 docs/14 口徑更正的措辭必須改**(見 §4.10.6)。

**查不到 / 未證實**|Fiori 各字級確切 rem/px(官方站 403)· SLDS 完整字階表 · Carbon categorical 確切色數與官方類別上限 · IBM Plex Sans TC 官方設計說明與 CJK 光學校正 · W3C clreq 具體行高/最小字級數值。

### 0.6 研究 E|「工藝感」的可操作證據(2026-07-31 補)

> **緣起**|裁定者問「有沒有研究可以站在巨人肩膀上**提高質感**?」—— 先前三輪研究都在問「值不值得做 / 什麼是合規」,**從未問過「怎麼做才有效」**。D-5 方向更正後,感知面效果既屬穩健,此題即成立。
> ⚠️ 本節所有方向性結論均已回原文/官方 abstract 逐字查證(落實 §0.5 防線)。

**E-1 🔴 工藝感已被操作化,可量測**

**VisAWI**(Moshagen & Thielsch 2010, *IJHCS* 68:689-709)四面向之一即 **Craftsmanship**,逐字定義:
> 「**Craftsmanship can be characterized as the skillful and coherent integration of all relevant design dimensions.**」

| 面向 | α | 題目(官方英文版節錄) |
|---|---|---|
| **Craftsmanship** | .85 | `The layout appears professionally designed` · `The site is designed with care` · `The design of the site lacks a concept (r)` |
| **Simplicity** | .89 | 🔴 **不等於「元素少」**,逐字為 Gestalt figural goodness:「unity, homogeneity, clarity, **orderliness**, and balance」 |
| Diversity / Colorfulness | .87 / .89 | — |

**Craftsmanship 是對設計品質最敏感的面向**:專業設計師製作同內容之美/醜兩版(差異限於 color / density / picture quality / typography),**Craftsmanship d=1.60(最大)· Diversity d=0.49(最小)**。

**可直接做前後測**|**VisAWI-S**(Moshagen & Thielsch 2013)僅 **4 題**,與全版 **r=.91**、網站排序 rho=.95、α=.81。**官方驗收門檻**:手冊引 Hirschfeld & Thielsch 2015 —「participants usually experience websites as rather positive **starting from an overall evaluation value of 4.5**」;162 網站常模 M=4.51 (SD=1.22)。
→ **「像不像玩具」可由主觀爭論改為可量測的前後測。**

**E-2 真正驅動評分的屬性(含一條被普遍誤傳的)**

- **Tuch 等 2012**逐字:「**More complex web pages received lower beauty ratings than less complex pages**」;VC η²p=.581、**原型性 PT η²p=.812**。
- 🔴 **關鍵交互作用**:PT(照慣例做)的紅利在低/中複雜度為 **d=1.96 / 1.79**,在高複雜度**只剩 d=.24** —— **版面太雜會吃掉「照慣例做」的全部好處**。
- 🔴 **「複雜度倒 U、要適度複雜」不成立**(最常被誤傳者)。Tuch 逐字:「VC and beauty were related in a **linear** manner」;Reinecke 等 2013 亦逐字:「low levels of complexity are **similarly liked** to those with a medium complexity」。→ 可操作結論是**「避開高複雜度即可,再往下壓收益趨零」**。
- **可計算指標**|Reinecke 2013(R²=.65):最佳單一預測子為 **space-based 區塊數 r=.50**;顯著項含 text area / non-text area / **text group 數** / image area 數。**對稱、平衡、equilibrium 之計算指標「weak… ultimately pruned from the model」**。
- **Miniukovich & De Angeli 2015**(CHI):八個**可自動計算**的 GUI 指標(visual clutter · figure-ground contrast · contour congestion · **grid quality** · white space 等)解釋美感**最多 49%** 變異,150ms 與 4s 曝光皆成立 → **「格線品質」已被操作化,可進 CI**。
- **機制解釋**|Processing fluency(Reber 等 2004)逐字:「**The more fluently perceivers can process an object, the more positive their aesthetic response**」,並明確將 figural goodness / figure-ground contrast / symmetry / prototypicality 之美感效果歸因於流暢度。**惟屬理論框架,不得當成單一像素決策的證據。**

**E-3 🔴 時間尺度:首因為真,長期會衰減 —— 對本平台最關鍵**

- Lindgaard 等 2006 逐字:「**visual appeal can be assessed within 50 ms**」(Tuch 2012 推至 17ms)。
- **但**|Sonderegger 等 2012(*Ergonomics*,2 週現場)逐字:「The positive effect of an aesthetically appealing product on perceived usability… **began to wane with increasing exposure time**.」
- **Sauer & Sonderegger 2022**(*IJHCS*,**7 週、N=110**)逐字:「**We found no effect of visual aesthetics on user experience (including perceived usability as the chief outcome variable)**, which is in contrast to a considerable number of previous studies.」

→ **美感的槓桿集中在「首次接觸」**(demo / 評估期 / onboarding / 決策者第一眼),**對已駐留數月以上的日常使用者不應承諾持續收益**。
→ 🔴 **與本平台策略的交集**:R1 的目的正是**讓既有 Ragic 客戶遷移**(docs/23:R1 = land)—— 那正是評估與 demo 情境,**恰為美感效果最強的窗口**。故工藝投資有其正當位置,但應**瞄準首次接觸面**,而非全站無差別打磨。

**E-4 可信 / 專業的線索**
- **Fogg 等 2003**(Stanford,N=2,684 / 2,440 則評論)逐字:「the **'design look' of the site was mentioned most frequently, being present in 46.1 percent of the comments**」—— 高居所有因素之首;**金融類最高 54.6%**(對 ERP 為相近脈絡之旁證)。其「design look」編碼含 layout / typography / white space / images / color schemes。
- **Robins & Holmes 2008**:同內容、兩種美感處理 → 高美感版可信度較高,**21 例中 19 例(90%)**。⚠️ **誠實**:其操弄為「有專業設計 vs 剝掉設計」,證明的是「設計過 > 沒設計過」,**不可外推到「精緻 vs 尚可」的細粒度差距**。
- Lindgaard 等 2011 逐字:可信度判斷「rely on **somewhat different visual attributes**」—— 可信度不是美感的同義詞。

**E-5 🔴 應從我方信念中刪除的六條(無證據或方向相反)**

| # | 常見主張 | 實際 |
|---|---|---|
| 1 | 字型家族 ≤ 2 | **查無任何同儕審查實驗**測字體家族**數量**的效果。可做,但不得宣稱有實證 |
| 2 | 減少色彩數量 | 🔴 **方向相反**:Miniukovich 2016 —「more on-page main colors **increased** aesthetics for the **low-graphic** webpages」。**企業表單正屬 low-graphic** |
| 3 | 留白越多越好 | white space **僅在高圖形頁**降低美感,其餘類別不顯著 |
| 4 | 對稱性 | Tuch 2010 有效但**受性別調節**;Reinecke 之計算指標被剔除 |
| 5 | 複雜度倒 U | 兩篇獨立研究否證,實為**線性負向** |
| 6 | 好看 → 長期更好用 | 7 週實驗**零效果**(E-3) |

> 第 2 條與我方 docs/14 §0.2「類別色解禁」方向一致(該裁定已允許類別編碼用色),**但不構成在 chrome 上使用裝飾色的授權** —— 該研究測的是美感評分而非資訊編碼,且對象為一般網頁非資料工具。**不得外推。**

**查不到**|資料密集企業工具(表格/grid/ERP)專屬的美感與可信度實證(所有量表常模均來自消費型網站與 App)· VisAWI 於 B2B 內部工具的常模 · 「對齊一致性」單獨操弄的實驗 · Lindgaard 2006 之具體相關係數(付費牆)。

---

### 0.5 方法教訓(本模組四次自我更正)

本模組在草擬期間出現四次自我更正,**全部由裁定者的追問或動手前查證攔下,無一是事後才發現**。記錄成因以免重演:

| # | 誤述 | 成因 | 攔下的方式 |
|---|---|---|---|
| 1 | 「icon rail 與定位相反」 | 未查 workspace-ia 已三重裁定 | 動手前讀既有模組文件 |
| 2 | 動效「120–160 / 150–200ms 預算」 | **憑印象寫,卻冠上規範之名** | 裁定者追問「站在什麼巨人肩膀上」 |
| 3 | 「`prefers-reduced-motion` 0 處未處理」 | grep 只掃 `apps/web/src`,**漏 `packages/`** | 讀 tokens.css 時撞見 |
| 4 | 🔴 **「美感版任務時間變長」方向寫反** | **採信子研究摘要,未查證方向,而該結論為載重論據** | 裁定者追問「影響多少」 |

**共通型 = 「二手轉述未回源」。** #2 是把自己的印象當外部依據;#4 是把子研究的轉述當原始結論。兩者都在**論據承重**的位置上。

**可執行的防線**(非「下次更小心」):
1. **載重論據必回一手**|任何被用來支撐「做 / 不做」的研究結論,須引到**原始 abstract 或官方原文的逐字句**,不採二手轉述。本文件 §0 各節之逐條證據強度標注即為此設計。
2. **方向性結論加倍查**|「A 比 B 快 / 多 / 好」這類**有方向**的結論,轉述時最易反轉,且反轉後論述仍然通順、不會自曝。
3. **monorepo 查現況須含 `packages/`**|否則把共用層已做的事誤報為缺口,排出不必要的工(#3)。
4. **凡寫下數值必附出處**|寫不出出處就不要寫成規範(#2)。

> 此四項已具體反映在 §0.3 / §0.4 的「證據強度逐條標注」與 §4.10.2 的「屬取捨非查得」標記上。

---

## 1. 目標與範圍

### 1.1 目標
1. 把研究中**明載可照抄的正典**(ARIA APG 鍵盤 / Carbon 列高 / Cloudscape 密度 / WCAG 1.4.12)落成專案規範與實作,取代目前的個案判斷。
2. 修正 **rail 承載量越界**(見 §2.2)並補齊 IA 三層防線缺口。
3. 校正 **docs/14 兩處過度宣稱**(§0.2 B-1 / B-2)與**一處過期結構圖**(§2.1)。
4. 償還**結構債**至專案自訂紅線內。

### 1.2 不做的事(明確排除 + 理由)
- **不改導覽的組織原則。** icon rail vs topbar app 頁籤已於 docs/27 D3 + OQ-RWB-6=C + workspace-ia OQ-6 三重裁定,本模組**只調整承載量與標籤可見性**,不重開此案。
- **不做儀表板首頁。** docs/24 + Jira 反例(§0.1 A-3)。
- **不重新裁定 docs/14 §0.1/§0.2 的一票否決清單**(漸層 / pill / resting 陰影 / 大留白 / hero / 裝飾動效)。本文件只**補標其證據強度**,不鬆綁。
- **不做視覺「重新設計」**(改版型 / 換語言 / 全站無差別打磨)。反面教材(§0.2 B-7)顯示風險全在能力與延遲。
  ⚠️ **v0.4 收窄此條**:不等於「不做工藝」—— §4.11 依研究 E 採**可量測的工藝目標**(VisAWI-S Craftsmanship)並**限縮於首次接觸鏈**。
- 不動後端(除非 OQ 裁定需要新讀端點,如「最近使用」)。

---

## 2. 現況走查

### 2.1 🔴 docs/14 §3.1 結構圖已過期(文件債,非實作缺陷)

docs/14 §3.1 畫的是 `topbar 42px(品牌 + 客戶自建 app 頁籤 + 全域搜尋 + 租戶)`。**實作無 topbar**,是左 56px icon rail + main + status bar。

**這不是實作偏離規格。** workspace-ia.md 明文裁定「topbar 移除 nav 只留 org 名」「**不放空業務域 tab**(D3/OQ-RWB-6=C)」——因為 docs/27 D3 認定遷移客戶心智是「單一資料庫 + 業務分類目錄」,分類**放首頁當目錄**而非 topbar 頁籤。docs/14 v2.1(2026-07-19)早於 docs/27(2026-07-24),**是 docs/14 過期**。

> **風險**|docs/14 自稱「前端開發之單一真實來源」。過期結構圖留著,未來任何人(含 AI)照它施工就會「復原」已被否決的 topbar 頁籤。**必須更正**(OQ-FUX-3)。

### 2.2 🔴 rail 承載量越界 —— 且成因是本人

workspace-ia 裁定 icon rail 時為 **7 項**,在 Material 3–7 規範內。此後三批模組各自加了一項:

| 加入者 | 項目 |
|---|---|
| G-2 公開表單 | 公開表單 |
| G-1 事件/Webhook | 整合 |
| H-2 回收桶 | 資源回收桶 |

現為 **10 項純圖示**,越過 Material 明載的 7 上限〔官方〕,且無可見文字標籤(NN/g 明確反對靠 hover)。

**這是典型的「橫切結構被逐批稀釋」** —— 每一批單看都只加一個圖示、都合理,累積後越界。與本專案已記錄的失效模式同型(`rule_outer_shell_sweep`:cross-cutting concern 必 sweep outer shell)。

**現成解已存在,不需新發明**:研究獨立建議「設定類收進單一設定中心入口」,與本專案 docs/04 v2.6 已定的 **S22 設定中心**是同一答案。

### 2.3 IA 三層防線:已有兩層,缺第二層

| 防線 | 狀態 |
|---|---|
| (a) 分類容器 | ✅ 首頁分類目錄已 SHIPPED(UP-1,復用 `form_categories`) |
| (b) 最近使用 / 待我處理 | ⚠️ **半有**(**待我簽核已 SHIPPED** 於 `_components/pending-approvals.tsx` 並已掛首頁;**僅最近使用缺**)|
| (c) 命令面板 | ✅ ⌘K `command-palette.tsx` 已 SHIPPED |

研究間接證據(Airtable 首頁預設 Recently opened、Notion Home 首區 Recents、NocoDB 給 recent 專屬 ⌘L)推斷「最近使用吃日常、搜尋吃長尾」。**缺 (b) 等於把日常流量全逼去 (c)。**

### 2.4 鍵盤:ARIA APG grid pattern 完全未實作

`role="grid"` 全庫 **0 處**;`onKeyDown` 僅 5 檔。Glide Data Grid(canvas)自帶鍵盤,但 HTML 表格面(列表、子表、權限矩陣)無正典鍵盤。

**這一條的分量被反面教材放大**:Bloomberg 案例顯示鍵盤慣例是專業使用者的肌肉記憶;APG 與 Excel 慣例高度重合(`F2` / `Ctrl+Home` / `Shift+Space`),而目標客戶正是 Excel 與 Ragic 的重度使用者。

### 2.5 密度:單一 compact,無切換

Cloudscape 明載 compact **不可取代** comfortable 且**必須可切換**〔官方〕。我方為 compact-only。且需查核 compact 是否誤套到不該套的區域(alert / 驗證訊息 / select / 日期選擇器)。

**1.4.12 風險掃描結果:低。** 固定高度僅 3 處,其中 2 處已是 `min-h-`;僅 `notification-bell.tsx:94` 的 `h-[30px]` 需改。

### 2.6 🔴 動效與版面穩定性:問題不在動畫,在版面會跳

實測現況(全庫掃描):

| 查核項 | 結果 | 判讀 |
|---|---|---|
| 動效詞彙總量 | **僅 `transition-colors duration-150`**(13 + 15 處) | 極度克制 |
| `animate-*` | **0** | 無 spinner / 無骨架屏 / 無進場動畫 |
| `prefers-reduced-motion` | **已有**,`packages/ui/src/styles/tokens.css:110` | 採 Cloudscape「全部歸零」式 |
| **全頁替換式載入** | **9 處** `if (isLoading) return <div>載入中…</div>` | 🔴 |
| `keepPreviousData` / `placeholderData` | **0** | 🔴 每次切換整頁重置 |

**結論:我方幾乎不做動畫,但畫面一直在跳。**

那 9 處的實際行為 = 整頁內容消失 → 只剩一行 12px「載入中…」→ 內容整塊長回來。每次切表單、進設定頁都來一次。這產生的是**版面位移(CLS)與視覺阻斷**,與動畫時長無關。且因無 `keepPreviousData`,**即使資料已在快取仍照閃一次**。

**兩項意外的正面發現**
1. 既有 `duration-150` **恰等於 Carbon `moderate-01`** —— 值本身正確,只是從未被命名與溯源。改為引用 token 即可,無需改值。
2. 唯一的動效是顏色轉場,**不觸發 layout**(僅 paint),亦**不造成前庭不適**。

> **🔴 本人兩次判斷失誤的更正(同一題連錯兩次)**
> 1. 補研究前主張「現在加 `prefers-reduced-motion` 是為不存在的問題加防護」→ 經 C-7(**2.2.2 為 Level A**)後改口。
> 2. 改口後宣稱「原始碼 0 處、未處理」→ **也是錯的**。守衛**早已存在**於 `packages/ui/src/styles/tokens.css:110`,先前只 grep `apps/web/src`,**漏掉 `packages/`**。
>
> **真正的現況**:守衛已在,且採 **Cloudscape「全部歸零」**式(`transition-duration: 0.01ms !important`)。故 OQ-10 不是「要不要加」,而是「**是否改採 WebKit『換掉而非全關』**」。以目前僅有顏色轉場而言,兩者實際差異為零(WebKit 明言純交叉淡入不引入動作),**現況無缺陷**。
>
> **這次失誤本身的教訓**|monorepo 下「查現況」必須涵蓋 `packages/`,否則會把**共用層已做的事誤報為缺口**,進而排出不必要的工。已是本模組第三次自我更正 —— 三次都由「動手前先驗證」攔下,而非事後才發現。

### 2.7 🔴 視覺:實測結果(對比度 / 字階 / 間距)

全數以程式計算,非目視判斷。

**對比度**(WCAG 相對亮度公式)

| 配對 | 實測 | 判定 |
|---|---|---|
| 主文 / 次文 / 連結 / primary | 6.3–17.6:1 | ✅ |
| **狀態章 ok/wn/er/nt** | 4.78–6.66:1 | ✅ |
| **類別色 c1–c8**(UP-4c) | **5.18–6.17:1** | ✅ 全過且明度平均,做得好 |
| **`ink-3` / 表頭底** | **4.21:1** | ⚠️ 過 3:1,**未達 AA 4.5:1** |
| **`ink-4` / 卡片底** | **2.52:1** | 🔴 連 3:1 都不過,**209 處在用** |
| `ink-4` / label 格底 | 2.33:1 | 🔴 |
| 框線 line / cell / line-2 | 1.11–1.25:1 | ✅ **合規**(D-1:表格框線不受 1.4.11 規範) |
| focus ring(primary) | 7.59:1 | ✅ |
| checkbox / radio | 27/28 為原生 `accent-*` | ✅ 瀏覽器保證;自繪僅 1 處待查 |

🔴 **`packages/ui/src/components/input.tsx:13` 兩條 AA 不合格**|`border border-line bg-card` + `placeholder:text-ink-4` —— 白底輸入框置於白色欄位格內,(a) 空白時 1.25:1 框線是唯一識別線索(D-1 指名此情形需 3:1);(b) placeholder 屬**文字**,受 1.4.3 管需 4.5:1,實測 2.52:1。

**字階 —— 本輪最大宗問題**

實際使用 **16 種字級**:`8 / 8.5 / 9 / 9.5 / 10 / 10.5 / 11 / 11.5 / 12 / 12.5 / 13 / 14 / 15 / 16 / 17 / 21`。**這不是階,是逐次臨場決定。**

- 宣告的 12.5px base **僅 24 處**;實際最常用是 **11.5px(128)/ 12px(127)/ 11px(112)**。
- **65% 的字級宣告在 12px 以下**(353 / 542)—— Carbon 與 Fluent 的**地板都是 12px**,我方大量低於所有系統地板。
- 🔴 **疊加失效**:最小字級幾乎恆配 `text-ink-4` —— 「這資訊次要 → 又縮小又調淡」。`text-[9px] text-ink-4` 用於「(隱藏)」「設計限定」等**狀態資訊非裝飾**,無豁免空間。

**間距 —— ✅ 乾淨**|任意值僅 2 處,4px 節奏守得住。
→ 此對比本身即診斷:**間距被當規範管,色與字級沒有。** 修法是把後兩者也納入 token 與 CI,而非「更用心一點」。

### 2.8 結構債(違反專案自訂紅線,可量測)

| 項目 | 現況 | 紅線 |
|---|---|---|
| `builder/_components` | **33 檔**,前綴 hack `field-*`×5 / `excel-*`×5 / `record-*`×2 / `grid-*`×2 | 25 |
| `forms/[formId]/_components` | 18 檔 | 15 起想 / 25 |
| `design-canvas.tsx` | **651 行** | 400 |
| `object-page.tsx` | 490 行 | 400 |
| `list-controls.tsx` | 472 行 | 400 |
| `import-panel.tsx` | 456 行 | 400 |
| `actions-designer.tsx` | 453 行 | 400 |

記憶規則明載「**見前綴 hack 立刻 folder 化**,folder 邊界依 feature 語意,同時去 prefix rename」。

---

## 3. 驗收線(來自 §0.2 B-7,凌駕美觀判斷)

> **完成同一任務所需的按鍵數與點擊數不得增加。** 任一改動若使既有路徑變長,即為不合格,無論視覺上多合理。

具體:
1. rail 收斂**不得**讓任何現有目的地從 1 次點擊變成 2 次 —— 除非該項為低頻設定類且已進入設定中心(需逐項列出並確認頻率)。
2. 既有鍵盤捷徑(⌘K)不得失效。
3. 不得移除任何既有能力(Sonos 教訓)。
4. 新增鍵盤支援只能是純增量。

---

## 4. 設計要點

### 4.1 導覽(A-2 + 2.2)
- rail 主要目的地收斂至 **≤7**;設定類六項(通知設定 / 公開表單 / 整合 / 回收桶 / 帳號安全 / 配色)收進單一「設定」入口 = **S22 設定中心**。
- **預設 icon+label 展開,可收合成 56px rail 並記住偏好**(先例:Material expanded rail / WinUI compact↔expanded / Slack 右鍵切換)。純圖示態必須 tooltip + `aria-label`,且**只作為使用者主動收合的結果**(WinUI:icon-only 是降級態)。
- 取捨:展開吃 ~150px 寬。→ OQ-FUX-1 / OQ-FUX-2。

### 4.2 首頁補第二層防線(A-1 + 2.3)
首頁分類目錄之上加固定區:**最近使用(5–8)** + **待我簽核 / 指派我的**。不加 KPI 數字磚(docs/24 + `feedback_no_dev_phase_in_product_ui`)。→ OQ-FUX-7。

### 4.3 鍵盤照抄 APG(B-4 + 2.4)

**照抄不自創** —— 有官方成文規範,且與使用者既有 Excel 肌肉記憶重合。

> 🔴 **2026-07-31 範圍收斂**|原寫「子表 + 列表」,實作前查程式碼發現「列表」一詞涵蓋**三個性質不同的面**,照字面做會誤套。逐一定調:

| 檔案 | 實際是什麼 | 套用 | 理由 |
|---|---|---|---|
| 🔴 ~~`line-items.tsx`~~(115 行) | **唯讀顯示表** —— 儲存格是純文字,**無 input** | ❌ **不適用** | **2026-07-31 二次更正**:grid pattern 的核心(`F2` 切換編輯 / `Enter` 進編輯 / 英數直接輸入)在唯讀表**無處可用**。設計稿階段指錯目標 |
| ✅ `builder/_components/records/form-panel.tsx` | **可編輯子表** —— `<table>` 內每格為 `FieldInput` | ✅ **APG grid pattern** | **唯一真正適用的面**;填單逐格輸入為日常高頻 |
| `record-list.tsx`(87 行) | **按鈕清單**(master-detail 左欄,點選切換記錄) | ✅ **APG listbox pattern** | 語意是單選清單非表格。**兩者是不同規範,混用會做出錯的東西** |
| `collection-view.tsx`(329 行) | **Glide Data Grid(canvas)** | ❌ **明確不動** | 自帶鍵盤;正是 FMEA U3 警告的衝突面 |
| `form-matrix.tsx` 等權限矩陣 | HTML 表格 | ⏳ 延後 | 低頻管理面(OQ-5=B) |

**grid pattern 要點**(W3C 官方,見 §0.2 B-4):方向鍵**不環繞** · `Home`/`End` 列首末 · `Ctrl+Home`/`Ctrl+End` 表首末 · `Enter` 進編輯 · `F2` 切換編輯/導覽 · 英數直接進編輯 · `Esc` 回導覽 · `Shift+Space` 選列 · **roving tabindex:整個 grid 只有一個 Tab 停點**。

**listbox pattern 要點**(W3C 官方,2026-07-31 回一手查證):
- **必要**:`Down Arrow` 移至下一項 · `Up Arrow` 移至上一項 · role `listbox` + `option` · `aria-selected`
- **選用**:`Home` / `End`(原文標 Optional)· type-ahead(建議用於 7 項以上)
- **焦點管理**:`aria-activedescendant` 為 roving tabindex 的**替代方案**,兩者擇一
- ⚠️ **原文未規定邊界是否環繞** —— 與 grid 的「明訂不環繞」不同,不得把 grid 的規則套過來

### 4.4 密度與可及性(B-4 / B-5 + 2.5)
- 列高改走固定階梯(建議 24 / 28 / 32 預設 / 40,對齊 Carbon 概念);**表頭列高 = 資料列高**。
- 間距只允許 `4/8/12/16/24/32`,禁任意值。
- 稽核 compact 是否誤套於 alert / 驗證訊息 / select / 日期選擇器。
- 修 `notification-bell.tsx:94`;把 1.4.12 套用測試納入 CI(可用 Playwright 注入 CSS 後截圖比對是否裁切)。
- → OQ-FUX-8。

### 4.5 記錄頁對齊 Fiori(A-4)
既有 Object Page 已有 anchor bar 與動作列(UP-1)。補:footer toolbar **作為訊息宿主恆存於編輯模式**(B-6)· 窄視窗單欄 + header 收合摘要 + anchor 溢出選單(= 既有 task #110)· header 關鍵欄位上限 6(對齊 SF 7 / Dynamics 4)。

### 4.6 欄位設定面板(A-5)
三段:基本 / 型別專屬(由既有雙軸型別 registry 驅動)/ **單一「進階」摺疊區**。不用橫向 tab。摺疊區含非預設值時,收合標題顯示 badge。

### 4.7 docs/14 校正(B-1 / B-2 / B-6 / 2.1)
1. §3.1 結構圖更正為現行 app-shell,並註明 supersede 來源(docs/27 D3 / workspace-ia OQ-6)。
2. §0.1 v3 加註:「專業 vs 玩具」的拆解**無外部權威依據,係我方假設**。
3. 「近乎無動效」改為**引用 Carbon productive motion token**(見 §4.9.1)。原 v0.1 所寫的 120–160 / 150–200ms **無出處,刪除**。
4. 信任訊號條加註為假設(無對照研究),但補 Fiori footer-as-message-host 的官方機制。
5. 補「凍結欄邊緣陰影」為 overlay-only 規則的**正當例外**(層訊號非裝飾)。
6. 全框線立場補上 A List Apart 實證引用(B-3)。
→ OQ-FUX-3 / OQ-FUX-6。

### 4.8 結構債(2.7)
`builder/_components` 依 feature 語意 folder 化並去前綴;超行檔案拆分。→ OQ-FUX-4(時機)。

### 4.9 動效與版面穩定性(研究 C + 2.6)

> **本節取代 v0.1 §4.7.3 的無據數字。原則:凡有官方 token 或閾值者一律引用,不自創。**

#### 4.9.1 動效 token —— 採 Carbon productive

| 用途 | token | 值 | easing |
|---|---|---|---|
| hover / focus 顏色 | `fast-01` | **70ms** | productive-exit |
| overlay 離場 | `fast-02` | **110ms** | productive-exit |
| overlay 進場 / 行內展開 | `moderate-01` | **150ms** | productive-entrance |
| 其餘 | — | **0ms** | — |

既有 `duration-150` = `moderate-01`,**值不動,只補命名與出處**。hover 由 150 → 70ms 屬 token 對齊(生產力情境用較短一檔),**非 UX 缺陷修復**,列低優先。

#### 4.9.2 明令禁止(每條附依據)

| 禁 | 依據 |
|---|---|
| **列表 / 表格逐項交錯淡入** | IEEE TVCG 2014:無實證支持,最有利情境下效果仍極微;且延長最後一列可見時間(C-6) |
| **動畫幾何屬性**(`width`/`height`/`top`/`left`/`margin`)| 觸發 layout;位移類一律走 `transform`(C-5) |
| **骨架屏用於局部重查詢 / 篩選 / 換頁** | Viget n=136 全面最差;列高不符會自製 CLS(C-3) |
| **任何 shimmer 持續 >5s 且與其他內容並列** | **WCAG 2.2.2 Level A**(C-7) |
| **樂觀更新於過帳 / 核准 / 送簽 / 開票 / 庫存異動** | 🔴 **本專案自訂規則**,依 AGENTS.md 傳票不可變 + 冪等性。**查無業界禁令,不得假借外部權威**(C-9) |

可樂觀更新者:排序、篩選、欄寬、標記已讀、UI 偏好。

#### 4.9.3 載入指示規則(取代全頁替換)

| 耗時 | 做法 | 依據 |
|---|---|---|
| **<400ms** | **不顯示任何指示** | NN/g <2s 不需指示;Fiori 防閃爍 |
| 400ms–10s | 保留舊內容 + **表頭細進度條**(不阻斷、不位移) | Fiori 延遲顯示 + 最短顯示 500ms |
| >10s | percent-done + Cancel | NN/g;Fiori |

- **延遲 400ms 才顯示、顯示後最短維持 500ms**(取 Salesforce 300 與 Fiori 1000 之間;無共識故明示為我方取值)。
- **9 處全頁替換一律改為 `placeholderData: keepPreviousData`**(TanStack Query 已在用,零新相依)。
- 骨架屏**僅限**首次進入表單/清單的整頁載入,且**列高鎖定 = 真實列高**。

#### 4.9.4 版面穩定性硬指標

- **CLS ≤ 0.1**、**INP ≤ 200ms**(75 百分位)。
- 🔴 **輪詢刷新 / 背景 job 插入列 / 通知推播不吃互動豁免**(豁免只給離散輸入後 500ms,且 scroll/drag 不算)→ 這類更新**必須預留空間或走 `transform`**,不得直接插入撐開版面。
- 圖片標 `width`/`height` 或 `aspect-ratio`;字型 `font-display: optional` + `size-adjust`。

#### 4.9.5 `prefers-reduced-motion` —— 已存在,維持
> (見下方 §4.10 視覺一致性與可及性)

守衛已在 `packages/ui/src/styles/tokens.css:110`,採 **Cloudscape「全部歸零」**式。**本輪不動**(OQ-10=A):僅有顏色轉場時,與 WebKit「換掉」式的實際差異為零。
**觸發改採 WebKit 式的條件**:日後引入任何位移 / 縮放類動效時,改為「位移類降級為 opacity 淡入、純 opacity 維持、裝飾 shimmer 全關」。

---

### 4.10 視覺一致性與可及性(研究 D + 2.7)

> **不做視覺重新設計**(§1.2 不變,且 D-5 顯示美感提升與客觀績效無正相關、甚至有反證)。本節範圍嚴格限於**可量測**者。

#### 4.10.1 對比度(修 3 條,其餘維持)

| 修 | 作法 |
|---|---|
| `ink-4` 2.52:1(209 處) | **拆兩個 token**:`ink-disabled` 維持 2.52:1(1.4.3 對停用元件內文字有 incidental 豁免)/ `ink-placeholder` 拉至 **≥4.5:1**。逐處判定屬何者 |
| `ink-3` / 表頭 4.21:1 | 表頭文字加深至 ≥4.5:1(或表頭底改淺) |
| 空白輸入框邊框 1.25:1 | **僅輸入框** resting border 提至 3:1(Carbon Gray-50 `#8d8d8d` 等級);或確保恆有 placeholder。**不動表格/卡片框線** |

**明確不動**|表格 / 卡片 / 分隔框線(D-1:不受 1.4.11 規範;Carbon 官方更淡且明知照發)· 狀態章 · 類別色 · focus ring · 原生 checkbox。

#### 4.10.2 字階 —— 16 種收斂為整數階

採 **Carbon 式整數階,無非整數**(D-2:Carbon 全階無小數;12.5px 另有 sub-pixel rounding 問題):

| 階 | px / 行高 | 用途 |
|---|---|---|
| `xs` | **12 / 16** | **地板** —— 標籤、圖說、輔助文字(對齊 Carbon caption-01 / Fluent Caption1) |
| `sm` | **13 / 18** | 表格儲存格、密集列表(我方密度主力) |
| `base` | **14 / 20** | 內文、表單值(對齊三大系統 productive 內文) |
| `lg` | 16 / 22 · `xl` 20 / 26 · `2xl` 24 / 32 | 標題階 |

> ⚠️ **證據強度誠實標注**|**有依據**:地板 12px(Carbon caption-01 與 Fluent Caption1 皆為 12px)· 12.5px 須換掉(sub-pixel rounding + 三大系統皆無對應)· 內文 14px(三大系統 productive 內文一致)· 全整數階(Carbon 全階無小數)。
> **屬本人取捨、非查得**:表格用 **13/18** 這一階。Carbon 無 13px(其階為 12→14),此階為在「12 太接近地板、14 太鬆」之間自行插入。若裁定者傾向純照 Carbon,改用 `12/16` 或 `14/20` 亦可,**但須以 U11 之可見列數量測為準**。

- **地板 12px,禁 8–11.5px**(現況 65% 宣告低於 12px,低於所有系統地板)。
- 🔴 **禁「又縮小又調淡」**:任何 ≤13px 文字不得使用 `ink-disabled` 級色。
- **密度靠間距不靠縮字**(Fiori 官方明載 compact 不改字級)—— 列高維持 34px,壓縮走 padding。
- 長文欄位(備註/說明)限寬;**表格不套 measure**(D-2:掃描非閱讀)。

#### 4.10.3 資料呈現(D-4)
數字右對齊 + `tabular-nums`(`.tabular` 已具備)· 儲存格內視覺編碼**僅用條長** · **禁以背景色深淺表數量**(感知排序最末)· sparkline 只表趨勢。

#### 4.10.4 類別色
維持 8 組(實測 5.18–6.17:1 全過)。補 **deuteranopia / protanopia 模擬驗證**對照 Okabe–Ito;超過 6 類的場景走「前 5 具名 + 其他」。**文字恆在**為關鍵緩解,不得取消。

#### 4.10.5 CI 檢查(讓規範可執行,而非靠自律)
① 對比度:token 配對表自動計算,低於門檻 fail ② 字級白名單:偵測 `text-[Npx]` 不在階內即 fail ③ WCAG 1.4.12 注入測試(§4.4)。
→ 呼應 2.7 診斷:**間距守得住是因為有節奏可循;色與字級失守是因為從未進 CI。**

#### 4.10.6 論述口徑更正(D-5;2026-07-31 二次更正)
docs/14 與記憶 `feedback_frontend_premium_bar` 之**主張維持**,但**理由須改**:視覺工藝提升的是**信任感與感知專業度**(影響採購與留存),**不得宣稱提升效率**。
🔴 **不得宣稱的理由是「效果量小(統合分析 g = 0.12)且方向無共識」,不是「會變慢」** —— 後者為本文件 v0.3 之誤述(Sonderegger & Sauer 2010 實際發現美感版**更快**)。效率仍歸因於密度、對齊、定位輔助、tabular figures。

### 4.11 工藝感:有目標、有量測、有窗口(研究 E)

> **建議修正 §1.2**|原「不做視覺重新設計」維持,但**不再等同於「不做工藝」** —— E-1 顯示工藝感有操作型定義與量表,E-3 指出其效果窗口正好落在 R1 的目的上。

**4.11.1 量測取代爭論**
採 **VisAWI-S**(4 題,r=.91 與全版,α=.81)做改版前後測。**驗收門檻 > 4.5**(Hirschfeld & Thielsch 2015 官方常模 M=4.51)。
→ 「像不像玩具」自此為**可量測命題**,不再靠主觀辯論。⚠️ **誠實限制**:常模來自消費型網站,**B2B 內部工具無常模** → 我方應以**自身前後測差異**為主要判準,絕對值僅供參考。

**4.11.2 瞄準 Craftsmanship,不追 Diversity**
Craftsmanship 對設計品質最敏感(**d=1.60** vs Diversity **d=0.49**)。其題目即施力方向:`professionally designed` · `designed with care` · `lacks a concept (r)`。
→ **一致性與概念完整** > 增加變化。此正好與本模組既有工項重合:**字階收斂、對比一致、間距節奏** 就是「skillful and coherent integration」的具體落實。

**4.11.3 🔴 投資窗口 = 首次接觸**
E-3:2 週開始衰減、**7 週歸零**。而 **R1 的目的是 land 既有 Ragic 客戶**(docs/23)—— demo / 評估 / onboarding 正是效果最強的窗口。
→ **優先序**:登入 → 首頁 → 第一次建表 → 第一次填單(首次接觸鏈)**優先於**深層設定頁。
→ **不得承諾**:對已使用數月的日常使用者,工藝帶來持續的效率或滿意度收益。

**4.11.4 降複雜度的正確做法**
- 目標是**避開高複雜度**,非「適度複雜」(倒 U 不成立,E-2)。
- 可計算代理指標:**單畫面視覺群組數 / text group 數 / image area 數**(Reinecke 最佳單一預測子 r=.50)。
- **高複雜度會吃掉「照慣例做」的全部紅利**(PT 效果 d 由 1.96 崩至 .24)→ 先降複雜度,再談版型創新。
- 可選 CI 指標:**grid quality**、figure-ground contrast、visual clutter(Miniukovich 2015,解釋 49% 變異)。

**4.11.5 從規範中刪除六條無據主張(E-5)**
字型家族數上限 · 減少色彩數量 · 留白越多越好 · 對稱性 · 複雜度倒 U · 好看→長期更好用。
→ 其中「減少色彩數量」**方向相反**(低圖形介面上主色較多反而評分較高),但**不構成 chrome 使用裝飾色的授權**(該研究測美感評分非資訊編碼,對象為一般網頁)。**不得外推。**

---

## 5. 開放問題(OQ-FUX-N)— 待裁定

| # | 問題 | 選項 | 建議 |
|---|---|---|---|
| **1** | rail 10 項如何收斂 | A 設定六項收進 S22 設定中心(→5 主目的地)· B 只加文字標籤不收斂 · C 維持 | **A** —— 越界有官方規範為據;S22 已是既定決策,零新發明。須先列六項使用頻率確認不違反 §3 驗收線 |
| **2** | rail 預設型態 | A 預設 icon+label 展開、可收合並記憶 · B 預設收合 icon-only · C 固定展開 | **A** —— WinUI/Material/Slack 三方先例;icon-only 應是使用者選擇而非預設 |
| **3** | docs/14 校正範圍 | A 全採 §4.7 六項 · B 只改過期結構圖(1) · C 不動 | **A** —— (1) 是會誤導施工的實害;(2)(3) 是誠實標注證據強度,屬 `feedback_design_evidence_anchored` 要求 |
| **4** | 結構債處理時機 | A 先整地再做 UX · B 邊做邊拆 · C 只拆被動到的 | **B** —— A 產生無行為變更的大 diff 難驗證;C 會留下 33 檔目錄。折衷:先做 `builder/_components` folder 化(純 rename,風險低、可機械驗證),超行檔案在被本模組動到時才拆 |
| **5** | ARIA APG 鍵盤範圍 | A 全面 · B 只做子表 + 列表 · C 延後 | **B**,並於實作前**收斂**:`line-items` 套 grid · `record-list` 套 **listbox**(不同規範)· `collection-view`(Glide canvas)**明確排除** · 權限矩陣延後。詳 §4.3 |
| **6** | 動效規範來源 | A **引用 Carbon productive token**(70/110/150,easing 成對)· B 維持「近乎無動效」措辭 · C 自訂數值 | **A** —— B 查無外部依據(C-1/C-8);**C 已被證明是本文件 v0.1 犯過的錯**。Carbon 明標企業生產力用途且與 IBM Plex 同源;既有 `duration-150` 恰等於 `moderate-01`,**值不動只補溯源**,零回歸 |
| **9** | 🔴 全頁替換式載入(9 處)| A **改 `keepPreviousData` + 延遲 400ms 細進度條** · B 改骨架屏 · C 維持 | **A** —— B 有反向實證(Viget n=136 全面最差)且列高不符會自製 CLS;A 用既有 TanStack Query,零新相依。**這是本輪最高價值修正**:直接消除視覺阻斷與版面跳動 |
| **11** | 🔴 對比度 3 條不合格 | A **全修**(`ink-4` 拆兩 token / 表頭 / 輸入框邊框)· B 只修輸入框 · C 不修 | **A** —— R1 目標 AA,三條皆為實測不合格。**框線與類別色明確不動**(D-1 證實合規) |
| **12** | 🔴 字階 16 種 → 整數階 | A **收斂為 12/13/14/16/20/24,地板 12px** · B 只禁 <10px · C 維持 | **A** —— 65% 宣告低於所有系統地板;12.5px 三大系統皆無對應且有 sub-pixel rounding。**大範圍改動,列為本模組最大工項**,須逐頁 Playwright 比對 |
| **13** | 視覺規範進 CI | A **對比度 + 字級白名單 + 1.4.12 三項** · B 只做對比度 · C 不做 | **A** —— 2.7 已診斷:間距守得住因有節奏可循,色與字級失守因從未進 CI。不進 CI 必再次漂移 |
| **14** | 🔴 工藝感的處理(研究 E 後新增)| A **採 VisAWI-S 前後測 + 瞄準 Craftsmanship + 首次接觸鏈優先** · B 只做 §4.10 可量測項,不談工藝 · C 全站無差別打磨 | **A** —— E-1 使工藝感可量測(門檻 4.5),E-3 顯示效果窗口正好是 **R1 的 land 目的**(demo/評估);**C 已被 E-3 否定**(7 週歸零,深層頁打磨無回收)。B 是本文件 v0.3 立場,在 D-5 方向更正後已無正當性 |
| **10** | `prefers-reduced-motion`(🔴 **守衛已存在**於 `packages/ui/.../tokens.css:110`,採 Cloudscape 全部歸零式)| A **維持現況** · B 改採 WebKit「換掉而非全關」 | **A 維持** —— 現況無缺陷:僅有顏色轉場時兩者實際差異為零(WebKit 明言純交叉淡入不引入動作)。待日後真正引入位移類動效再轉 B。**本題原被本人誤列為缺口**,係 grep 漏掉 `packages/`(見 §2.6 更正) |
| **7** | 首頁第二層防線 | A 最近使用 + 待我簽核 · B 只做最近使用 · C 延後 | **A** —— 即既有 #108;待簽核在 ERP 情境是唯一值得的動態區塊(研究結論)。需新讀端點 |
| **8** | 密度切換 | A 提供 compact/comfortable 切換 · B 維持 compact-only,但修正誤套區域 | **B** —— 切換是 Cloudscape 規範但成本高且我方使用者為密度取向;**誤套於驗證訊息/日期選擇器屬可及性問題,必修**。若日後有客訴再上 A |

---

## 6. 落地順序(裁定後)

| M | 內容 | 驗證 |
|---|---|---|
| M1 | docs/14 校正(OQ-3)+ 本文件定稿 | 文件 |
| M2 | rail 收斂 + 展開/收合(OQ-1/2)| Playwright MCP 實走 + **點擊數對照表** |
| M3 | `builder/_components` folder 化(OQ-4)| 純 rename,`pnpm build` + 既有 e2e 全綠 |
| M4 | 首頁最近使用 + 待我簽核(OQ-7)| 新端點測試 + e2e |
| M5 | APG 鍵盤:**`records/form-panel` 可編輯子表** grid + `record-list` listbox(OQ-5,§4.3 二次收斂)| 鍵盤 e2e 逐鍵斷言;**U4 為 P0:必測可 Tab 出**;`FieldInput` 15 型別互動須逐一驗 |
| M6 | 密度誤套修正 + 1.4.12 CI 檢查(OQ-8)| 注入 CSS 截圖比對 |
| **M7** | **載入模式:9 處改 `keepPreviousData` + 延遲細進度條(OQ-9)** | **CLS 量測前後對照**(切表單路徑),須 ≤0.1 |
| M8 | motion token 化(OQ-6)| token 落 CSS |
| **M9** | **對比度 3 條 + 視覺 CI 三項(OQ-11/13)** | token 配對表自動計算;CI fail 為準 |
| **M10** | **字階收斂 16 → 6 階(OQ-12)** | 🔴 最大工項;逐頁 Playwright 視覺比對 |
| **M12** | **VisAWI-S 基線量測(改版前)→ 首次接觸鏈工藝(OQ-14)→ 後測** | 前後測差異須顯著;絕對值參考門檻 4.5 |
| M11 | docs/14 §0.1 口徑更正(OQ-3 併 D-5 / E-5 刪六條)+ FMEA + docs/25 回填 | — |

---

## 7. FMEA(草案,M7 補完)

| # | 失效 | 嚴重度 | 緩解 |
|---|---|---|---|
| U1 | rail 收斂後常用設定變兩次點擊 | **P0** | §3 驗收線:先量六項頻率;高頻者不進設定中心 |
| U2 | folder 化 rename 漏改 import 致 build 綠但執行期壞 | P1 | 純 rename 不改邏輯;`pnpm build` + 全 e2e;逐檔 grep 舊路徑 |
| U3 | APG 鍵盤與 Glide canvas 鍵盤衝突 | P1 | **`collection-view` 明確不動**(§4.3);e2e 須斷言 Glide 面鍵盤行為未變 |
| U4 | roving tabindex 實作錯誤致鍵盤陷阱(WCAG A 級違規) | **P0** | 逐鍵 e2e 斷言可 Tab 出;`Esc` 必回導覽 |
| U5 | 「最近使用」洩漏跨租戶或越權表單 | **P0** | 走既有 tenant-scoped + forms 三態可見性;e2e 斷 B 租戶不可見 |
| U6 | docs/14 改錯造成後續施工偏離 | P1 | 更正處註明 supersede 來源與日期 |
| U7 | `keepPreviousData` 使切租戶/切表單時**短暫顯示上一個情境的資料** | **P0** | 🔴 跨租戶尤其嚴重。query key 必含 tenant + formId;**切租戶時強制丟棄而非保留**;e2e 斷言切換瞬間不出現他租戶資料 |
| U8 | 細進度條本身造成位移(插入後撐開版面) | P1 | 進度條走 overlay 定位不佔流,或預留固定高度軌道 |
| U9 | 延遲 400ms 規則使快速操作「看起來沒反應」 | P1 | 400ms 內完成者本就瞬時(NN/g 1s 內無需回饋);按鈕自身 disabled 態即為回饋 |
| U10 | reduced-motion 守衛誤關功能性動效(進度指示) | P1 | 守衛只作用於裝飾類;進度指示為 2.2.2 明列例外,不得關 |
| U11 | 字階收斂使密集表格變鬆、單頁筆數減少(**違反 §3 驗收線**) | **P0** | 🔴 Fiori 明載 compact 不改字級 → 壓縮走 padding 非字級;**收斂前後量測單螢幕可見列數,不得減少** |
| U12 | `ink-4` 拆 token 時判定錯誤,把**資訊性**文字歸入 `ink-disabled` | P1 | 逐處判定;規則:僅「停用元件內」可用 disabled 級;「(隱藏)」「設計限定」等狀態字一律 ≥4.5:1 |
| U13 | 輸入框邊框加深致全站視覺變重(與全框線語言衝突) | P1 | **僅輸入框** resting border 改;表格/卡片框線不動(D-1 已證合規)。改後截圖比對 |
| U14 | 字階大範圍改動造成非預期版面破圖 | P1 | 逐頁 Playwright 視覺比對;先改 token 後改用處,分兩 commit 可回退 |

---

## 8. 相關

- 既有 task:#108(首頁 IA)· #110(記錄工作台響應式)
- 上游:docs/24 · docs/27 · docs/14 · docs/26
- 記憶:`feedback_frontend_premium_bar` · `feedback_design_from_mental_model` · `rule_outer_shell_sweep` · `feedback_design_evidence_anchored`
