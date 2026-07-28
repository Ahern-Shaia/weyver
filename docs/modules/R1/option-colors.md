# option-colors.md — [R1·UP-4c] 選項顏色設定 UI(field-types-parity P1 解鎖)設計文件

> ⏳ **狀態:DRAFT — OQ-OC-1..7 待裁定**
>
> **這是 field-types-parity 的 P1 子件。** 該模組 SHIPPED 時已把 `options.colors`(選項 → 語意色 token)寫進後端 `choicesSchema`,但**前端從未有設定入口**,故此欄位至今為死參數。record-workbench-ui 的狀態章亦已預備讀取它(未設定則恆為中性框)。
>
> 作者:Claude Code(草擬)
> 版本:v0.1(2026-07-28)

---

## 0. 競品證據(clean-room:只讀公開文件與截圖,未接觸任何原始碼)—— **本節推翻了本模組的預設前提,請先讀**

| 主題 | Ragic | Airtable | Teable |
|---|---|---|---|
| per-option 顏色 | ❌ **未查到**(官方文件無單選/多選之選項配色設定) | ✅ 明載:single/multiple select 之每個選項可於欄位設定中選色,可整體 toggle「color-code options」 | ✅ 明載:點選項左側圓點選色;多選**預設自動配色**可再改 |
| 依值上色 | ✅ **條件式格式**(依條件改變欄位值 / 欄位標題 / 敘述欄位之背景與文字色,列表頁生效)| ✅ **Record coloring**(記錄層級,影響整列;Grid/Kanban/Calendar/Timeline)—— 與選項色**獨立** | 未查到獨立機制 |
| 色盤色數 | N/A | **未查到具體色數/色名** | **未查到具體色數/色名** |

> 證據檔:`ragic-doc-zh-TW/.../doc/6/conditional-formatting.html`、`airtable-support/single-select-field.html`、`.../multiple-select-field.html`、`.../record-coloring-in-airtable.html`、`teable-docs/.../single-select.md`、`.../multiple-select.md`。

### 0.1 三個必須攤開講的推論

1. **選項顏色不是 Ragic parity,是 Airtable 範式。**
   我們的定位是 **Ragic-parity-first**(客戶正從 Ragic 遷移)。而 Ragic 使用者手上**沒有**選項顏色這個功能 —— 他們用的是**條件式格式**。所以本模組不會解決任何遷移對不上的問題;它是一項**增強**。
2. **對應 Ragic 的那件事(條件式格式)已在別處掛帳。**
   `form-designer-2d` v1.0 之 P1 殘留即列有「條件式格式」。若目標是遷移 parity,**那個殘留的優先度高於本模組**(見 OQ-OC-4)。
3. **色數無證據可循。**
   Airtable/Teable 的實際色盤在文件中未列出。任何「開放 10–12 色」之類的數字都是**推測而非證據**,本 doc 不以此為依據。

### 0.2 與既有設計鐵則的正面衝突

`docs/14 §0.1 v3` 明列:**漸層 / pill / 裝飾配色 / 舒適大留白 維持一票否決**,且該裁定正是用戶當初「以第一鐵則(rationale 不用 vibe)否決 Airtable 式 uplift」的結果。

現行語意 token 只有四組(各含 文字 / 框線 / 淡底):

| token | 用途(docs/14 §3.7 之狀態層級) |
|---|---|
| `ok` | 已完成 / 通過 |
| `wn` | 要行動(待審)|
| `er` | 異常 / 退回 |
| `nt` | 中性、已了結(settled 狀態刻意退到背景,不與待辦爭注意力)|

**張力**:寬色盤(藍/紫/粉/青…)本質是**類別編碼**而非狀態語意。它在資料工具中有正當性(等同圖表的 categorical color),但它也正是一票否決條款所針對的視覺語彙。**此衝突不由本 doc 單方解除 → OQ-OC-1 交付裁定。**

---

## 1. 目標與範圍

### 1.1 目標(P0)
1. **選項編輯器**|單選 / 多選欄位之選項改為「逐項清單」編輯(目前為 CSV 單行文字框),每項可指定顏色。
2. **顏色落地呈現**|填單輸入、記錄頁值、集合視圖、左欄清單 —— 一致以**帶框方形章**呈現(沿用 `StatusChip`,禁 pill)。
3. **安全渲染**|儲存的色彩值**一律經白名單映射**成 class,絕不拼接進 `class`/`style`(見 §7-bis)。
4. **孤兒清理**|選項被刪除時,連同其顏色項一併移除(不留無主設定)。

### 1.2 不做的事
- ❌ **條件式格式 / 依值上整列色**|不同層級的功能(Airtable 亦分開);維持 `form-designer-2d` 之 P1 殘留(OQ-OC-4)。
- ❌ **自動配色**|Teable 有,但語意色需要人指定意圖,自動指派會產出無意義的顏色(OQ-OC-7)。
- ❌ **看板 / 圖表配色**|尚無看板視圖與圖表模組。

---

## 2. 上游 / 既有現況走查

| 子題 | 現況 | Gap |
|---|---|---|
| 後端 schema | ✅ `choicesSchema.colors: z.record(string, string().max(40)).optional()` | **過度寬鬆**:接受任意 ≤40 字串;且**未與 `choices` 交叉驗證** → 孤兒項可存 |
| 前端設定入口 | ❌ 無。選項以 `choicesText` CSV 單行輸入(`edit-form-panel` / `new-form-panel`)| 需逐項編輯器 |
| 讀取端 | ✅ Object Page 狀態章已讀 `options.colors`(未設 → neutral) | 其餘呈現點(填單 / 集合視圖 / 清單)尚未讀 |
| 元件 | ✅ `StatusChip`(4 tone,帶框方形,禁 pill) | 直接沿用 |
| 檔案行數 | ⚠️ `edit-form-panel.tsx` **422 行**(超過 400 紅線) | 選項編輯器抽成獨立元件,順帶解既有超標 |

---

## 3. scope 切分

| 里程碑 | 內容 | 估算 |
|---|---|---|
| **M1 後端** | `colors` 值收斂為 tone enum(依 OQ-OC-1)+ 與 `choices` 交叉驗證(孤兒即拒)+ 測 | 0.02 mo |
| **M2 前端設定** | `ChoicesEditor` 元件(逐項:名稱 + 顏色 + 增刪排序),接 `edit-form-panel` / `new-form-panel`;**順帶把 422 行檔案拆下來** | 0.05 mo |
| **M3 前端呈現** | 填單 select、記錄頁值、集合視圖、左欄清單 一致上色(白名單映射)| 0.04 mo |
| **M4 收尾** | `option-colors.spec` + FMEA + doc v1.0 + MODULES + 回填 field-types-parity 殘留 | 0.02 mo |

**合計 ≈ 0.13 mo**(field-types-parity 既列人月內之 P1 子件,不新增總量)。前後端分開 commit。

---

## 7-bis. 安全

**色彩值絕不進入 class / style 字串拼接。**
儲存值 → `TONE_CLASS[value]` 白名單查表 → 查無即退回 `neutral`。理由:`colors` 為使用者可控輸入,若拼接進 `className`(如 `` `text-${color}` ``)或 `style`,等同開放一條把任意字串注入樣式層的路徑;且 Tailwind 動態 class 本就不會被編出。後端另以 enum 收斂為第二道(縱深)。

---

## 10. 開放問題(OQ-OC-N)— 待裁定

| # | 議題 | 選項 | 建議 |
|---|---|---|---|
| **OQ-OC-1** ⭐ | 開放哪些顏色 | A. **只開放現有 4 語意 tone**(ok / warn / error / neutral)<br>B. 擴充為裝飾色盤(如 10–12 色)<br>C. 4 語意 tone + 2–3 個無語意可辨色(仍為帶框方形、淡底) | **A** — (a) **B 直接違反 docs/14 §0.1 之一票否決**(裝飾配色),而該條款正是你當初以第一鐵則否決 Airtable 式 uplift 的產物,不該由本模組單方鬆綁;(b) **無證據支持任何色數** —— Airtable/Teable 實際色盤在文件中未列出,「10–12 色」是推測;(c) 選項顏色**本就不是 Ragic parity**(Ragic 無此功能),沒有遷移壓力逼我們擴充。**若你認為類別編碼(如「北區/中區/南區」)確實需要無語意色**,C 是有據的折衷 —— 但那需要你判斷它值不值得動一票否決條款 |
| **OQ-OC-2** | 設定 UI 形態 | A. **逐項清單編輯器**(取代 CSV 單行)<br>B. 維持 CSV + 另開顏色區 | **A** — 顏色天然是 per-option 屬性,CSV 無處掛;Airtable/Teable 皆為逐項設定。**額外收益**:`edit-form-panel.tsx` 已 422 行超過紅線,抽 `ChoicesEditor` 順帶解掉 |
| **OQ-OC-3** | 顏色呈現範圍 | A. **只在該欄位值(章)**<br>B. 同時做整列著色 | **A** — Airtable 明確把 record coloring 設計成**獨立功能**(記錄層級、跨多視圖);混進本模組會讓兩件事互相綁死 |
| **OQ-OC-4** ⭐ | 是否改做 / 併做條件式格式 | A. **不做,維持 `form-designer-2d` P1 殘留**<br>B. 本模組改為做條件式格式(真 Ragic parity)<br>C. 兩者都做 | **A(但請注意取捨)** — 你指定的是選項顏色,本 doc 依此規劃。**惟須誠實指出**:若目標是遷移 parity,**條件式格式才是 Ragic 使用者手上真正有的功能**,優先度理應更高。C 會讓本模組膨脹逾倍。**這條值得你重新確認要哪一個** |
| **OQ-OC-5** | 儲存值安全 | A. **白名單查表映射 + 後端 enum 收斂**<br>B. 僅前端映射 | **A** — 縱深防禦;後端目前接受任意 ≤40 字串,單靠前端等於把唯一防線放在可被繞過的一側 |
| **OQ-OC-6** | 選項刪除後的顏色殘留 | A. **存檔時以 `choices` 過濾 `colors`**(前後端皆做)<br>B. 容忍孤兒項 | **A** — 孤兒項會在改名後「借屍還魂」到同名新選項上,產生難查的錯色 |
| **OQ-OC-7** | 自動配色 | A. **不做**<br>B. 比照 Teable 自動指派 | **A** — 在只有語意色的前提下(OQ-OC-1=A),自動指派等於亂猜語意;若 OQ-OC-1 改採 C,再議 |

---

## 12. 失效場景反思(FMEA)— M4 收尾必填;pre-mortem 預列

| # | 場景 | 預定緩解 | Sev |
|---|---|---|---|
| C1 | 顏色值被拼接進 class/style → 樣式注入 | 白名單查表,查無退 neutral;後端 enum 收斂(OQ-OC-5) | P0 |
| C2 | 只靠顏色傳達意義 → 色盲 / 列印黑白時資訊全失 | 章體**恆含文字**(沿用 StatusChip 契約);顏色只是輔助編碼 | P1 |
| C3 | 選項改名 → 舊顏色殘留並套到新同名選項 | 存檔時以 choices 過濾 colors(OQ-OC-6) | P1 |
| C4 | CSV → 逐項編輯器之遷移破壞既有欄位 | 既有 `choices` 陣列契約不變(只是編輯 UI 改變);無 migration | P1 |
| C5 | 大量選項(上限 200)之編輯器卡頓 | 純受控列表無虛擬化需求;必要時分頁。實測驗證 | P2 |

---

## 13. 變更紀錄

| 日期 | 版本 | 變更 | 作者 |
|---|---|---|---|
| 2026-07-28 | v0.1 | 初版 DRAFT — field-types-parity P1 子件(`options.colors` 後端已有、前端無入口)。**§0 競品證據推翻預設前提**:Ragic **無** per-option 顏色(其對應功能為條件式格式),per-option 色為 Airtable/Teable 範式 → 本模組是增強而非遷移 parity;色盤色數無證據。**§0.2 攤開與 docs/14「裝飾配色一票否決」之正面衝突**,交 OQ-OC-1 裁定。P0 = 逐項選項編輯器 + 白名單安全渲染 + 孤兒清理;條件式格式 / 整列著色 / 自動配色 明確排除。OQ-OC-1..7 待裁定 | Claude Code |
