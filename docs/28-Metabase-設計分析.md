# 28|Metabase 設計分析(視覺 × 互動)與對 Weyver 的裁定

> **狀態**|✅ v1.0(2026-08-01)· **用途**|拿來改 Weyver,故每一項都給裁定與理由
>
> **證據等級**|本文的數值與規則**全部取自 Metabase 原始碼**(`metabase/metabase`,GitHub API 直讀),非二手介紹或截圖推測。引號內為逐字原文。互動模式取自其官方文件。
>
> **上游**|docs/14 前端設計規則(權威)· docs/24 用戶心智模型 · docs/26 品牌識別 · `memory/feedback_frontend_premium_bar`(第一鐵則:每個決策有 rationale 不用 vibe)

---

## 0. 先講結論:哪些能學、哪些**不能搬**

Metabase 是 **BI / 儀表板**工具;Weyver 的主畫面是「自己建自己填的表單資料庫」(docs/24 明文,**非** KPI 儀表板)。
兩者的**視覺工程**高度可借鑑,**資訊架構**則不可照搬 —— 這條界線是本文的組織原則。

| # | 主題 | 裁定 | 一句話 |
|---|---|---|---|
| A1 | 色彩兩層制(base → semantic) | ✅ **採用**(Weyver 已有,補強命名) | 差在 Weyver 少了「base 不得外用」這條明文 |
| A2 | 色階以 `color-mix` 由品牌色**推導** | ✅ **採用**(高價值) | 直接解掉白牌與三主題的維護量 |
| A3 | 文字/圖示用 **alpha** 而非實色 | ✅ **採用** | 同一組 token 疊在任何底色上都對 |
| A4 | 圖示色**明文對齊**文字色 | ✅ **採用**(零成本) | 註解寫 `// Matches text-primary` |
| A5 | **色碼字面值以 lint 擋** | 🔴 **採用(Weyver 現況是破口)** | 我方只有文件規定,**沒有任何檢查** |
| A6 | 動作型別各有專屬色(filter/summarize) | ⚠️ **部分採用** | 概念好,但 Weyver 的動作語彙不同,不照抄顏色 |
| A7 | 8 色 accent 供圖表輪替 | ✅ **已對齊** | Weyver 已有 c1–c8 |
| B1 | 字階 5 階 + 標題 4 階 | ❌ **不改** | 我方 6 階已固化並有 CI;差異不構成理由 |
| B2 | 表格儲存格 **12.5px** | ✅ **外部佐證** | 與 Weyver app 基準字級**完全相同**,獨立收斂 |
| B3 | 圓角 md = 8px | ❌ **不採用** | 我方上限 6px 是刻意的嚴謹取向 |
| B4 | 定義三階陰影 | ❌ **不採用** | 我方只給 overlay;維持 |
| B5 | 間距 4/8/16/24/32(**跳過 12**) | ⚠️ **值得一議** | 我方有 12,是否為多餘的一階 |
| C1 | **步驟式查詢建構器**(notebook) | 🔴 **採用其模型**(R2 計算層的關鍵) | 「算」的自助化命門就在這個形狀 |
| C2 | 每步可 **Preview 前 10 列** | ✅ **採用** | 建構期的信任訊號,成本低 |
| C3 | 儀表板為主的 IA | ❌ **明確不搬** | 與 docs/24 定位直接衝突 |

---

## 1. 色彩

### 1.1 兩層制與治理(A1)

Metabase 的色彩檔開頭是一段**治理宣告**,逐字:

> `NOTE: DO NOT ADD COLORS WITHOUT EXTREMELY GOOD REASON AND DESIGN REVIEW`

> This file contains two types of colors — 1. Semantic colors 2. Base colors。
> 「Base colors are the colors that **should never change and never be used outside this file**, or in any components or CSS properties. They should only be used to define the semantic colors in this file.」

**Weyver 現況**|`packages/ui/src/styles/tokens.css` 已是語意 token(61 個),三主題以 `[data-theme]` 切換。
**差距**|沒有「base 不得外用」這一層的明文分離 —— 我方是直接把 hex 寫在語意 token 上。

**裁定 ✅ 採用(輕量版)**|在 `tokens.css` 補上與 Metabase 同義的檔頭宣告,並把三個主題的**品牌原色**抽成一組 `--base-*`,語意 token 一律引用它。
理由:目前新增一個主題要動 61 個值;抽出 base 後只需動品牌原色。

### 1.2 🔴 色階由品牌色推導(A2 — 本文最高價值一項)

Metabase 的每個色相有 **11 階**(5/10/20/…/100),而**品牌色階是即時算出來的**:

```
brand: {
  60: "color-mix(in srgb, var(--mb-color-core-brand), black 28%)",
  40: "var(--mb-color-core-brand)",   // 基準
  20: "color-mix(in srgb, var(--mb-color-core-brand), white 70%)",
}
```

**這件事解掉的問題**|白牌客戶只要換一個 `--mb-color-core-brand`,深淺、hover、focus、淡底全部跟著對 ——
不必請設計師配 11 個值,也不會出現「客戶換色之後 hover 態看不見」。

**Weyver 現況**|三個主題各自硬寫 `--color-primary` / `-d` / `-t`(共 3 檔 × 3 值)。
docs/04 v2.6 已列 **A 白牌網域 / 配額**,白牌是既定需求 —— 屆時每一個白牌客戶都要人工配三個值。

**裁定 ✅ 採用(高優先)**|`primary-d` / `primary-t` 改以 `color-mix` 由 `--color-primary` 推導。
**取捨誠實說**|`color-mix` 在 srgb 空間對某些色相的感知亮度不完全均勻,現行手調值在對比度測試上是已驗證的。
故**改法必須是**:先改推導、再跑既有的 `contrast.test.ts`,不過就退回手調並記錄該色相為例外。

### 1.3 文字與圖示用 alpha(A3 / A4)

Metabase 的文字/圖示語意色取自 `orionAlpha`(帶透明度的中性色),而非實色;且逐字註解:

```
"icon-primary":   baseColors.orionAlpha[80],  // Matches text-primary
"icon-secondary": baseColors.orionAlpha[60],  // Matches text-secondary
"icon-disabled":  baseColors.orionAlpha[40],  // Matches text-disabled
```

**兩個效果**|(a) 同一組 token 疊在白底、淺灰底、選取底上都成立,不必為每種底色各配一組;
(b) 圖示與文字**明文綁定**,不會出現「圖示比旁邊的字深一階」這種沒人說得出理由的不一致。

**Weyver 現況**|`ink` 四層為實色;圖示色散在各元件,無明文對應關係。
**裁定 ✅ 採用**|(a) 中性文字色改 alpha;(b) 補 `--icon-*` 三個 token 並在註解寫明對應哪一階文字。
成本低、且能消滅一整類「看起來怪但說不出哪裡怪」的問題。

### 1.4 🔴 色碼字面值以 lint 擋(A5 — Weyver 的實際破口)

Metabase 有自寫的 ESLint 規則 `metabase/no-color-literals`,逐字訊息:

> `"Color literals forbidden. Import colors from 'metabase/ui/colors'."`

規則本體是一條 regex,同時擋 `Literal` 與 `TemplateLiteral`:

```js
/(?:#[a-fA-F0-9]{3}(?:[a-fA-F0-9]{3})?\b|(?:rgb|hsl)a?\(\s*\d+\s*(?:,\s*\d+(?:\.\d+)?%?\s*){2,3}\))/
```

**嚴謹到什麼程度**|連他們自己 theme 裡的三個陰影值都得逐行寫 `// eslint-disable-next-line metabase/no-color-literals` 才過。

**Weyver 現況(盤點確認)**|
- ✅ 字階白名單有 CI(`type-scale.test.ts`)
- ✅ 對比度有 CI(`contrast.test.ts`,直接讀 `tokens.css` 的 hex 算亮度)
- 🔴 **禁 raw hex 只有文件規定,沒有任何檢查**(biome 無此規則、無對應測試)

**裁定 🔴 採用(本文第一優先)**|以既有的 `type-scale.test.ts` 為模板寫一支測試,掃 `apps/web/src` 與 `packages/ui/src`,
擋 `#rrggbb` / `rgb()` / `hsl()` 字面值,`tokens.css` 自身為唯一豁免。
理由:我方已經證明「文件上的規定會漏」——字階當初就是漏到 16 種才被抓回 6 階。同一種破口不該留第二個。

### 1.5 動作型別專屬色(A6)

Metabase 把 **filter** 與 **summarize** 各給一個可白牌的核心色(`core-filter` / `core-summarize`),
語意 token 如 `background-filter` 由其推導。效果是使用者在任何畫面看到那個顏色就知道「這是篩選」。

**裁定 ⚠️ 部分採用**|概念採用、**顏色不照抄**。
Weyver 的高頻動作語彙不是 filter/summarize,而是 **設計(改結構) / 填單(改資料) / 簽核**——
這三者的誤觸代價差距極大,值得各有一個穩定的視覺記號。
但這屬於 docs/14 §色彩語意的擴充,**應另立 OQ 裁定**,不在本文直接改。

---

## 2. 字體與密度

### 2.1 字階(B1)

| | Metabase | Weyver |
|---|---|---|
| 內文階 | 11 / 12 / 14 / 17 / 21 | 12 / 13 / 14 / 16 / 20 / 24 |
| 標題 | h1 32 / h2 24 / h3 20 / h4 17 | 併入上列 |
| 行高 | 以 **百分比** 定義(100/115/122/138/150) | 1.5 為主 |

**裁定 ❌ 不改**|兩者都是「刻意收斂的少數階」,差異不構成改的理由;我方 6 階已固化且有 CI 擋。
**唯一值得抄的是行高用百分比**:百分比隨字級縮放,在 12.5px 底、又要支援 WCAG 1.4.12 文字間距調整時比固定值穩。列為可選改善。

### 2.2 🔴 表格密度:12.5px 的外部佐證(B2)

Metabase 的視覺化字級常數,逐字:

```ts
const FONT_SIZES = {
  tableCell: units(12.5),
  pivotTableCell: units(12),
  label: units(13),
}
```

**Weyver 的 app 基準字級是 12.5px**(`globals.css`),表格列高 34px。

**意義**|這不是「跟著抄」,而是**兩個獨立的資料密集產品收斂到同一個數字**。
docs/14 的 12.5px 當初是以密度推理定下的;現在它有了外部佐證。
另可注意:Metabase 把 **pivot 表**再降一階到 12px —— 樞紐表欄多、需要更緊。Weyver 的 F-2 pivot 可比照。

**裁定 ✅ 記錄為佐證**|docs/14 §密度 補一句出處;pivot 降階列為 F-2 的可選微調。

### 2.3 圓角與陰影(B3 / B4)

| | Metabase | Weyver |
|---|---|---|
| radius | xs 4 / sm 6 / md 8 / xl 40 | xs 3 / sm 4 / md 6 / lg 8(**md 6px 為上限**) |
| shadow | 三階,最重者 `0 4px 20px rgba(0,0,0,0.05)` | **只有 overlay**,靜態一律無陰影 |

**裁定 ❌ 兩項都不採用**|
- 圓角:我方上限 6px 是 docs/14 「方角、嚴謹」取向的具體化,且 `feedback_frontend_premium_bar` 已把「柔角」列為只鬆到 4–6px 的有據項。Metabase 的 8px 屬於較柔的 SaaS 語彙,採用會回到被否決過的方向。
- 陰影:我方「靜態無陰影、只有 overlay」是**一票否決**級的既有裁定。Metabase 的三階陰影都極淡(alpha 0.05–0.08),不構成推翻理由。

**但值得記錄**|Metabase 的卡片預設**沒有邊框也沒有陰影**,靠 `background_page-primary` 與 `-secondary` 的**底色差**分層。
這是第三條路:不是框線、也不是陰影,而是**底色階差**。Weyver 目前是框線派(`--line`)。
兩者都成立,不必改;但日後若遇到「框線太多顯得吵」的場合,底色階差是有先例的替代方案。

### 2.4 間距少一階(B5)

Metabase:`4 / 8 / 16 / 24 / 32` —— **沒有 12**。Weyver 文件規定 `4 / 8 / 12 / 16 / 24 / 32`。

**裁定 ⚠️ 記錄不改**|少一階能減少「到底該用 12 還是 16」的猶豫,但我方無 CI 擋間距、且 Tailwind 預設 scale 仍可用,
現在收斂等於製造一批不會被執法的規定。**若日後補間距 CI,再一併考慮拿掉 12。**

---

## 3. 互動模式

### 3.1 🔴 步驟式查詢建構器(C1 — 對 R2 最關鍵的一項)

Metabase 的 notebook editor 讓使用者「build your query step by step from building blocks like filters and summaries」,
步驟型別固定且有序:

1. Pick data(必要,第一步)
2. Join tables
3. Custom columns
4. Filter data
5. Summarize and group data
6. Sort results
7. Row limit(**只能放最後**)

**為什麼這對 Weyver 是命門級的參考**|
`memory/feedback_calc_binding_self_service` 是 R2 的第一約束:**「算」的綁定必須自助化**,
不得做成需顧問配置的剛性 posting engine,否則 Weyver 退化成剛性 ERP、定位崩掉。

而「自助地把算式組出來」正是這個 notebook 形狀在解的問題:
**有限的步驟型別 + 明確的順序約束 + 每步都看得到中間結果**。
它既不是寫 SQL(門檻太高),也不是一堆勾選框(表達力不足)。

**裁定 🔴 採用其模型**|R2 計算層的「綁定 UI」以步驟式建構器為預設方向,並繼承兩條具體約束:
- **步驟型別封閉**(對應 docs/22 的「模型輸出結構化 intent,不是 raw SQL」)
- **順序有硬規則**(如 Metabase 的 row limit 只能最後)→ 我方對應「過帳前必須先有借貸平衡檢查」這類不可換序的步驟

⚠️ **不可照搬的部分**|Metabase 的步驟是**查詢**語意(讀);Weyver 的計算層是**過帳**語意(寫且不可逆)。
寫入型步驟必須額外有「人核准 + audit」,那是 docs/22 的載重不變量,不在 Metabase 的模型裡。

### 3.2 每步可預覽前 10 列(C2)

Metabase 每個步驟旁有 Preview(播放三角)按鈕,顯示該步驟當下的**前 10 列**。

**裁定 ✅ 採用**|這是低成本的信任訊號:使用者不必「組完整條才知道錯在哪」。
可先用在 R1 已有的**篩選 / 檢視建構**與 **Excel 匯入的欄位對映**(後者目前是設定完才知道對不對)。

### 3.3 ❌ 儀表板為主的 IA(C3)

Metabase 的首頁與導覽以 collections / dashboards 組織。
**明確不搬** —— docs/24 逐字:Weyver 的主要畫面是「自己建自己填」的表單資料庫,反面教材正是「為 SaaS 而 SaaS」與 KPI 儀表板皮。
`memory/feedback_no_dev_phase_in_product_ui` 也已把「巨大指標數字 = KPI vibe」列為禁項。

**唯一可借的一點**|Metabase 的 `Browse data` 是「資料庫 → 資料表 → 列」的三層瀏覽,
與 Weyver 的「分類 → 表單 → 記錄」同構。我方 S1 首頁已是分類目錄,方向一致,無需改動。

---

## 4. 落地清單(依價值排序)

| # | 動作 | 規模 | 為什麼是這個順序 |
|---|---|---|---|
| 1 | **禁 raw hex 的 CI 檢查** | 小 | 唯一「已知破口且我方已證明會漏」的項目 |
| 2 | `primary-d` / `-t` 改 `color-mix` 推導 | 小 | 白牌是既定需求,現在改的成本最低;需跑對比測試把關 |
| 3 | `--icon-*` token + 文字色 alpha 化 | 中 | 消滅一整類說不出理由的不一致 |
| 4 | tokens.css 補 base/semantic 分層宣告 | 小 | 為 2、3 鋪路 |
| 5 | docs/14 §密度 補 12.5px 的外部佐證 | 極小 | 文件可信度 |
| 6 | 步驟式建構器列入 R2 計算層設計前提 | 文件 | 影響最大但時機在 R2 |
| 7 | 動作型別專屬色(另立 OQ) | 待議 | 概念好但需先定我方的動作語彙 |

**明確不做**|圓角放寬到 8px · 加靜態陰影 · 字階重排 · 儀表板式 IA。

---

## 5. 來源

全部為 `metabase/metabase` 原始碼直讀(GitHub API):

- `frontend/src/metabase/css/core/colors.module.css` — 兩層制宣告
- `frontend/src/metabase/ui/colors/constants/base-colors.ts` — 11 階與 `color-mix` 推導
- `frontend/src/metabase/ui/colors/constants/themes/light.ts` — 語意 token 命名與 alpha 用法
- `frontend/src/metabase/ui/colors/palette.ts` — aliases / ACCENT_COUNT = 8
- `frontend/src/metabase/ui/theme.ts` — 字階 / 間距 / 圓角 / 陰影 / 斷點
- `frontend/src/metabase/embedding-sdk/theme/default-component-theme.ts` — `tableCell: 12.5px`
- `frontend/lint/eslint-plugin-metabase/rules/no-color-literals.js` — 色碼字面值 lint
- 官方文件 `questions/query-builder/editor` — notebook 步驟型別與 Preview

Weyver 側現況取自 repo 直讀:`packages/ui/src/styles/tokens.css`(61 token / 三主題)、
`apps/web/src/components/type-scale.test.ts`、`contrast.test.ts`、`globals.css`(12.5px)。

---

## 6. 變更紀錄

| 日期 | 版本 | 變更 | 作者 |
|---|---|---|---|
| 2026-08-01 | v1.0 | 初版。Metabase 原始碼直讀之視覺 × 互動分析,逐項給 Weyver 裁定。**最高價值三項**:色階由品牌色 `color-mix` 推導(解白牌維護量)、色碼字面值 lint(我方現況是破口)、步驟式建構器(R2「算的自助化」命門)。**明確不搬**:圓角 8px / 靜態陰影 / 儀表板式 IA(與 docs/14、docs/24 既有裁定衝突)。附帶佐證:Metabase 表格儲存格 12.5px 與 Weyver 基準字級獨立收斂到同一數字 | Claude Code |
