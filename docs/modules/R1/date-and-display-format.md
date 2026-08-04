# date-and-display-format.md — [R1·FMT] 日期輸入與顯示格式 設計文件

> 🚧 **狀態:APPROVED（2026-08-04）** — OQ-FMT-1..7 依 `AGENTS.md`〈研究錨定的建議 = 已核准〉裁定,依據逐條列於 §10。
>
> **起點是 #155「原生日期輸入顯示 mm/dd/yyyy」,但研究把問題換掉了。**
> 量測顯示我們的 `<input type="date">` 在 zh-TW 瀏覽器上顯示的是 `2026/03/05`(正確),
> 在 en-US 瀏覽器上才是 `03/05/2026` —— **不是「我們沒本地化」,是「格式不在我們手上」**。
> 而同一份研究撞到一個更大的缺口:列表網格上金額印成 `128400.0000`、建立時間印成
> `2026-07-19T05:45:02.5…`,**正是 `display-value.ts` 檔頭逐字說它要修的兩個症狀** ——
> 那支函式寫好了,但列表頁沒接上。
>
> 作者:Claude Code(草擬)
> 版本:v0.1(2026-08-04)

---

## 0. 站在巨人的肩膀

### 0.1 巨人一:自家 repo

| 查了什麼 | 結果 |
|---|---|
| 有沒有既有的顯示格式化層 | ✅ **有,而且是對的**:`apps/web/src/lib/engine/display-value.ts` 用 `Intl` 做 money / date / dateTime,檔頭逐字寫明它是為了修「金額 `128400.0000`」與「時間 `2026-07-19T05:45:02.592Z`」 |
| 🔴 列表網格用的是哪一支 | **不是那一支**。`collection-view.tsx:100,180` 用 `components/form/value.ts` 的 `formatFieldValue`,而它對 `date` 落到 `String(value)`、對 `dateTime` 只做 `value.replace("T"," ").slice(0,19)`、**對 money 完全不處理**(`value.ts:106-109`) |
| 原生日期輸入有幾處 | 3 處:`components/form/field-input.tsx`(date + datetime-local,填單/公開表單共用)、`app/app/settings/delegates/page.tsx`(內部設定頁) |
| 民國年是否已裁定過 | ✅ **已裁定為 P1**。`field-types-parity.md` OQ-FTP-7 逐字把「民國年」列入 P1;`form-designer-2d.md` 殘留亦逐字「格式 mask·民國年」。**本模組不得把它拉回 P0** |
| 網格的 date cell 現況 | `grid-cells.ts:13` 逐字「date/dateTime/select 亦 text(overlay 編輯器 P1-I)」—— 網格內編輯日期是純文字,無選擇器 |
| 匯入 / 貼上的日期解析 | `paste-plan.ts` 已用本地 Y-M-D 組字串(避開 UTC 位移);`field-types-parity.md:409` 已裁定 `text → date` **格式必須釘死白名單**,不依賴 PG 寬鬆解析 |

### 0.2 巨人二:自己的相依套件

| 套件＠版本 | 相關 API | 逐字 / 實測 | 對本模組的意義 |
|---|---|---|---|
| **`next-intl` ^4.13.2** | `useFormatter().dateTime()` | **已安裝但全 repo 零 reader** —— 只出現在 `package.json`。`form-designer-ui.md:40` 逐字「不做 i18n(next-intl 接線)(zh-TW 硬編,P1-I;**套件已裝不動**)」 | ⚠️ **它救不了這件事**:格式化文字它做得到,但 `<input type=date>` 的**控件內部**由瀏覽器畫,任何 JS 函式庫都碰不到。列為 P1 不動,理由不變 |
| **`@glideapps/glide-data-grid` ^6.0.3** | `DatePickerCell` | 在**另一個套件** `@glideapps/glide-data-grid-cells`,**未安裝** | 網格內的日期選擇器若要做,要先加相依;本模組 P0 不含網格內編輯(維持 text) |
| 日期函式庫(date-fns / dayjs / luxon / Temporal polyfill) | — | **一個都沒裝** | 自製日期輸入需自己寫解析與格式化,或加相依。§6 裁定為**自己寫**(範圍只有 `yyyy-MM-dd` 家族,`Intl` 已供給格式化) |

### 0.3 巨人三:競品

| 競品 | 逐字 | 出處 | 查證日 |
|---|---|---|---|
| **Ragic** | 「你可以更改欄位格式或從系統提供的格式中挑選,這會取決於**欄位種類**,設定格式後會將格式套用在欄位值上,**可以讓使用者更快速及正確地輸入資料**。」「你可以在設計模式中的**欄位設定**中的**基本**,為欄位設定格式。」 | 設計手冊 `doc/51` 欄位格式 | 2026-08-04 |
| **Ragic**(輸入行為) | 「日期 · `yyyy/MM/dd` · 輸入值 `20151022` → 格式化後 `2015/10/22`」「`1022` → `22-10-2015`(**如果你沒有輸入年份,會用現在的年份補上**)」「`22` → `2015/10/22`(**如果你只有輸入日子,會用現在的年份、月份來自動補齊**)」 | 同上 | 2026-08-04 |
| **Ragic**(兩層預設) | 「若為常用的數字、金額或日期欄位格式,可點擊旁邊的**更新預設格式**……更新預設格式後,將會同步更新**公司設定**中的**設定預設格式**」 | 同上 | 2026-08-04 |
| **Ragic**(民國年) | 「在**設計模式**中的欄位種類選取「日期」,依照下方的表格來選取相應格式後,未來只要自行輸入日期時間,或**選取日期選擇器(西元年)**,系統就會將所輸入日期自動切換為民國或日本和曆的格式**顯示**」 | 同上 | 2026-08-04 |
| **Airtable** | 「As a default, newly created date fields attempt to use **your browser's local language** when selecting the local format for dates. **To update the default format, you will need to change your browser's language settings.**」 | Support「Date Field Type」 | 2026-08-04 |
| **Airtable** | 「Click the ⌄ icon under the "**Date format**" section and select your preferred format. Options include **Local, Friendly, US, European, and ISO**.」 | 同上 | 2026-08-04 |
| **MDN**(平台事實) | 「The displayed date format will differ from the actual `value` — the displayed date is formatted **based on the locale of the user's browser**, but the parsed `value` is always formatted `yyyy-mm-dd`.」 | MDN `<input type="date">` | 2026-08-04 |
| **WHATWG HTML** | 規範只寫「If the user agent provides a user interface for selecting a date, then the value must be set to a valid date string」—— **對呈現形式隻字未提** | HTML Standard, date state | 2026-08-04 |

**兩家競品的共同結論**|**格式是欄位的屬性,不是瀏覽器的屬性。** Ragic 放在「欄位設定 › 基本」,
Airtable 放在欄位的「Date format」,且 Airtable 明說預設跟瀏覽器走、要改**得去改瀏覽器設定** ——
它把「跟著瀏覽器」降級成**其中一個選項(`Local`)**,而不是唯一行為。

⚠️ **未查證**:Ragic 的日期選擇器是否為自製元件(合理推測是,因為它接受 `1022` 這種輸入,
原生控件做不到),但沒有官方逐字說明,**不作為承重依據**。

### 0.3-bis 🔴 自家量測(比引用更硬)

同一份 HTML(`<html lang="zh-Hant-TW">`、同一個 `value="2026-03-05"`),
只改 Chromium 啟動語系(`--lang`),截圖控件實際畫面:

| `--lang` | 控件顯示 | `value` |
|---|---|---|
| `zh-TW` | `2026/03/05` | `2026-03-05` |
| `en-US` | `03/05/2026` | `2026-03-05` |
| `de-DE` | `05.03.2026` | `2026-03-05` |

**兩個結論,第二個是意外收穫:**

1. 頁面的 `lang="zh-Hant-TW"` **完全不影響控件** —— 三次都一樣,證實 MDN 那句「依瀏覽器語系」。
2. 🔴 **先前一輪只設 Playwright context `locale`(未設 `--lang`)時,三種語系全部顯示 `03/05/2026`,
   而 `navigator.language` 各自回報 `zh-TW` / `en-US` / `de-DE`** ——
   也就是 **`navigator.language` 與控件實際格式可以不一致**。
   這排除了「用 `navigator.language` 判斷要不要自製」這種折衷方案:**連偵測都不可靠。**

> 這一段本身也是一次自我更正:第一輪量測(只設 context locale)三種語系結果相同,
> 我原本會據此寫成「格式與語系無關」,那是錯的。**是量測方法不對,不是結論**。
> 記在這裡,因為下一個人很可能用同樣的方法量。

---

## 1. 目標與範圍

### 1.1 目標

1. **同一筆資料在所有人畫面上長得一樣** —— 顯示格式由**欄位設定**決定,不由各人的瀏覽器決定。
2. **列表頁不再印出資料庫的內部表示** —— 金額 `128400.0000` / 時間戳原始 ISO 一律走格式化層。
3. **顯示格式只有一個來源** —— 不再有兩支各做各的格式化函式。
4. 日期輸入可以**打字**(`20260305` / `0305` 都成立),不是只能用選擇器點。

### 1.2 對應訴求

| 子題 | 訴求 | 對應點 |
|---|---|---|
| A1 顯示層單一來源 | `docs/14` 把**時間戳與金額**列為信任訊號 | 列表頁是進表單的預設畫面,也是最多人看到的一頁;那裡印出 `128400.0000` 的效果與 `display-value.ts` 檔頭逐字說的一樣 —— 「看起來像沒做完」 |
| A2 欄位級日期格式 | Ragic 遷移客戶既有依賴(每欄自訂格式) | Ragic `doc/51` 是**欄位設定**的一部分;客戶表單裡已經存在各式格式 |
| A3 自製日期輸入 | 格式一致性 + 打字輸入 | 原生控件同時輸掉「格式一致」與「可打字」兩件事 |

### 1.3 不做的事(每條都查過三站)

- ❌ **不做民國年 / 日本和曆** —— **已由 `field-types-parity.md` OQ-FTP-7 裁定為 P1**,不因本模組而前移。
  ⚠️ 但 **A2 的 `options.dateFormat` 必須留得下它**:Ragic 的做法是格式碼(`RGRy年MM月dd日`),
  我們 P0 用有限白名單。**白名單制擴充成格式碼是相容的**(多加幾個 key),反之不然 —— 這一點在 §6 展開。
- ❌ **不做任意格式字串**(Ragic 的 `yyyy, MMMM, dd EE`)—— P0 白名單五檔。理由見 OQ-FMT-3。
- ❌ **不接 `next-intl`** —— `form-designer-ui.md:40` 已裁定 P1-I 且**它救不了控件格式**(§0.2)。
- ❌ **不做網格內的日期選擇器** —— 需加 `@glideapps/glide-data-grid-cells` 相依;`grid-cells.ts:13` 已標 P1-I。網格內維持文字編輯,但**顯示**走 A1。
- ❌ **不動後端儲存** —— `date` 仍 PG `date`、`dateTime` 仍 `timestamptz`。
  `field-types-parity.md:251` 逐字「Airtable『stores dates in GMT』正是位移 bug 的來源;**本專案沒犯這個錯**」——
  格式是顯示層的事,碰儲存等於把已經做對的事弄壞。
- ❌ **不做日期區間欄型別** —— 那是新欄位型別,歸 `field-types-parity` P1。

---

## 2. 上游 / 既有現況走查

| 子題 | 現況 | Gap |
|---|---|---|
| 記錄檢視(Object Page)的顯示 | ✅ 走 `displayValue`,已正確(`2026/07/22`) | 無 |
| **列表網格 / 看板 / 行事曆的顯示** | 🔴 走 `formatFieldValue`,**date→ISO、dateTime→ISO 去 T、money→原值** | **A1 全部** |
| 填單的日期輸入 | 原生 `<input type=date>` | **A3** |
| 公開表單的日期輸入 | 共用 `field-input.tsx` → 同上 | 隨 A3 一起 |
| 欄位設定有沒有格式欄 | ❌ `field_def.options` 有 `currency` / `displayMask`(text 用),**沒有 `dateFormat`** | **A2** |
| 送出邊界 | `value.ts` `toSubmitValue` 對 `dateTime` 轉 ISO;`date` 直送字串 | A3 需維持這個契約不變 |

---

## 3. scope 切分

| 子題 | 內容 | 估算 |
|---|---|---|
| **A1 顯示層單一來源** | `formatFieldValue` 改為**委派** `displayValue`,保留它獨有的 member 名 / 附件檔名 / SOURCE_MARKERS 分支;補單元測釘住「網格與記錄頁對同一個值給同一個字串」 | 0.02 mo |
| **A2 欄位級日期格式** | `field_def.options.dateFormat`(白名單五檔)+ 設計器欄位設定 UI + `displayValue` 吃它 | 0.04 mo |
| **A3 自製日期輸入** | 文字輸入 + 寬鬆解析 + 日曆彈層 + 鍵盤操作 + a11y | 0.09 mo |

**合計 ≈ 0.15 mo。**

---

## 4. A1 顯示層單一來源

**根因不是「網格漏了格式化」,是「有兩支函式在做同一件事」。**
這正是 `pivot-and-charts` §14.5 剛記過的形狀:樞紐/圖表複製了列表的查詢推導後漂移 ——
**漂移是複製造成的**,補一次不會是最後一次。

故做法是**合併而非補丁**:

```ts
// components/form/value.ts
export function formatFieldValue(field, value, members?, ctx?) {
  // 保留 value.ts 獨有、displayValue 沒有的三個分支
  if (typeof value === "string" && value in SOURCE_MARKERS) return SOURCE_MARKERS[value] ?? value
  if (field.type === "member") { /* members map 查名 */ }
  if (附件 / 圖片 / 簽名) { /* 取檔名 */ }
  return displayValue(field, value, ctx)      // ← 其餘一律委派
}
```

⚠️ **會改變畫面的地方要先數出來**(避免「修一個壞三個」):
`formatFieldValue` 有 **7 個檔、9 個呼叫點** —— collection-view ×2 / kanban / calendar /
builder 的 list·grid·form panel / **標籤列印**。
🔴 本節初稿寫「4 個呼叫點」是憑印象,實際 grep 出 7 個,**而漏掉的那個是標籤列印**
(D4「匯出/列印各自為政」因此是真的,不是假設)。
A1 的驗收是**這七處都與記錄頁一致**。

---

## 5. A2 欄位級日期格式

### 5.1 資料模型

`field_def.options` 加 `dateFormat`(不新增欄、不動 DDL):

```ts
type DateFormatKey = "local" | "iso" | "slash" | "dash" | "dot"
```

| key | `date` 範例 | `dateTime` 範例 | 來源 |
|---|---|---|---|
| `local`(**預設**) | 依語系(zh-TW → `2026/03/05`) | `2026/03/05 14:30` | Airtable `Local` |
| `iso` | `2026-03-05` | `2026-03-05 14:30` | Airtable `ISO` |
| `slash` | `2026/03/05` | `2026/03/05 14:30` | Ragic `yyyy/MM/dd` |
| `dash` | `05-03-2026` | — | Ragic `dd-MM-yyyy` |
| `dot` | `2026.03.05` | — | Ragic `Ry.MM.dd` 的西元版 |

🔴 **預設為 `local` 而非 `slash`**,理由不是「跟著瀏覽器比較好」——
恰恰相反,`local` 只是**遷移期最不會驚嚇既有資料的預設**。
Airtable 也是這樣預設的(逐字見 §0.3)。真正解決一致性的是「設計者可以改」,不是「預設是什麼」。

### 5.2 為什麼是白名單而不是格式碼

Ragic 用格式碼(`yyyy/MM/dd`、`RGRy年MM月dd日`),表達力更強。P0 不做,理由有二:

1. **格式碼是可執行的小語言** —— 要 parser、要錯誤處理、要防「使用者輸入的格式碼把畫面弄爆」。
   而它的收益(任意排列)在 P0 沒有需求撐。
2. 🔴 **白名單擴充成格式碼是相容的,反之不然。** `dateFormat: "slash"` 日後可映射成
   `{ pattern: "yyyy/MM/dd" }`;但若 P0 就開放任意字串,之後想收斂回白名單會**動到客戶已存的資料**。
   **先窄後寬,不要先寬後窄。**

這一條同時也是民國年(P1)的接口:屆時加 `roc` / `rocDot` 等 key 即可,不必回頭改模型。

---

## 6. A3 自製日期輸入

### 6.1 為什麼非自製不可

§0.3-bis 的量測已經把其他路都排除了:

| 想法 | 為什麼不行 |
|---|---|
| 設 `<html lang>` | 量測:三種語系下控件顯示不變 |
| 用 `next-intl` / `Intl` | 那是格式化**文字**;控件內部由瀏覽器畫,JS 碰不到 |
| 用 `navigator.language` 偵測後只在必要時自製 | 量測:`navigator.language` 與控件格式**可以不一致** —— 偵測本身不可靠 |

### 6.2 形狀

**文字輸入為主、日曆為輔**(Ragic 形態:它接受 `20151022` / `1022` / `22`)。

- 顯示與輸入皆依 `options.dateFormat`
- 寬鬆解析(逐字對齊 Ragic `doc/51` 的三條補齊規則):
  | 輸入 | 結果 | 規則 |
  |---|---|---|
  | `20260305` | `2026/03/05` | 8 碼直解 |
  | `0305` | `<今年>/03/05` | 「沒有輸入年份,會用現在的年份補上」 |
  | `5` | `<今年>/<本月>/05` | 「只有輸入日子,會用現在的年份、月份來自動補齊」 |
  | `2026/3/5`、`2026-3-5` | 同上 | 分隔符寬鬆 |
- 🔴 **解析失敗不得靜默清空** —— 保留原字串 + 標紅 + 說明。
  這條有前例:`field-types-parity.md:409` 逐字「無法以指定格式解析者一律計入 `will_be_nulled`,
  **即使 PG 自己猜得出來**」—— 同一個立場,靜默的猜測比拒絕更糟。
- 日曆彈層:month grid + 鍵盤(↑↓←→ / PageUp/Down / Home/End / Esc / Enter),依 W3C ARIA APG
  Date Picker Dialog pattern(`frontend-uplift` M5 已用 APG 做過 grid / listbox,同一套做法)
- **值的契約不變**:對外仍是 `yyyy-MM-dd`(date)/ ISO(dateTime),`toSubmitValue` 不動

### 6.3 不改網格

網格內日期維持文字編輯(`grid-cells.ts:13` 既有裁定),但**顯示**吃 A1 → 與表單頁一致。

---

## 7. 資料模型變動

**無 DDL 變動。** 只在 `field_def.options`(既有 JSONB)加 `dateFormat`,
沿用 `currency` / `displayMask` 的既有慣例。

---

## 8. 測試策略

| 層 | 內容 |
|---|---|
| 單元(web) | `formatFieldValue` 與 `displayValue` **對同一輸入給同一輸出**(A1 的核心斷言,防再次分家)· 寬鬆解析表(§6.2 五列逐列)· `dateFormat` 五檔的格式化 |
| e2e | 填單輸入 `20260305` → 顯示依欄位格式 → 存檔 → **列表頁與記錄頁顯示相同字串** · 解析失敗不清空 |
| 🔴 視覺回歸 | 列表頁截圖 —— A1 修的就是「畫面上印出內部表示」,而**單元測試不會告訴你畫面難看** |

⚠️ **不寫「在 en-US 瀏覽器下也正確」的 e2e** —— CI 只跑一種語系,那條斷言在 CI 永遠是綠的而不代表任何事。
改為在 §0.3-bis 留下量測方法,需要時手動複測。

---

## 9. FMEA(✅ = 已驗證緩解)

| # | 失效 | 嚴重度 | 緩解 | 狀態 |
|---|---|---|---|---|
| D1 | A1 合併後,某個原本正確的畫面變錯(如 member 名被吃掉) | P0 | 保留三個**語意**分支(引擎標記 / member 姓名 / 附件檔名),單元測逐一涵蓋 | ✅ |
| D2 | 自製輸入吃掉行動裝置的原生體驗(iOS 滾輪選擇器) | P1 | 窄螢幕**保留原生控件**(CSS 分流,同 `record-list` 的 `hidden md:flex`);兩者契約相同 | ✅ 已實作 · ⚠️ **行動端未量測**,誠實標注 |
| D3 | 寬鬆解析把 `0305` 解成錯的年份(跨年當下) | P1 | 解析後**回填成完整格式顯示**,使用者看得到系統補了什麼;`todayYmd` 取**顯示時區**的今天,不用執行環境時鐘 | ✅ |
| D4 | `dateFormat` 只做在前端,匯出 / 列印 / webhook 各自為政 | P1 | A1 的單一來源即為此;**標籤列印**是原本漏掉的第 7 個呼叫點,已納入 | ✅ 列印已納入 · ⚠️ 匯出 Excel 為 client-side,見 §9.1 |

### 9.1 追加 FMEA(設計時未預見,落地才浮現)

| # | 失效 | 為什麼設計時沒想到 | 處置 |
|---|---|---|---|
| **D5** | 🔴 **一行寫死碼位的空白正規化早已失效** —— `\u202f` 是舊 ICU 的字元,現行送 `\u2009` | 它**不會報錯**。一個看不見的字元留在每個時間戳裡,而所有測試都用同一份輸出比對,所以永遠自洽 | 改為歸一化**所有** `\p{Zs}`。⚠️ 教訓:**寫死外部函式庫的具體輸出值 = 一顆定時炸彈**,而且爆炸時沒有聲音 |
| **D6** | 🔴 **兩條測試在釘住 bug 本身**(`2026-07-19 10:00:00` = UTC 的 ISO 去 T;`128400.0000` = `numeric(19,4)` 原始表示) | 測試是跟著當時的實作寫的,而當時的實作就是 bug。**綠燈因此變成了 bug 的護欄** | 已更正,並新增「兩支函式對同一輸入給同一輸出」的斷言 —— **釘關係而不是釘字面值** |
| **D7** | `local` 之下格式由**租戶 / 使用者 locale** 決定,而 `en` 是設定白名單裡的合法值 | 原以為問題只在瀏覽器;實走才發現同一個問題在設定層又有一份 | 這正是 A2(欄位級格式)存在的理由。⚠️ **殘留**:`local` 仍是預設,`en` 租戶會看到美式 —— 那是 OQ-FMT-4 接受的行為,不是 bug |
| **D8** | 匯出 Excel 是 **client-side**,走的是自己的一套值轉換 | A1 只掃了「顯示」的呼叫點,沒掃匯出 | ⚠️ **未做**,列殘留。匯出的日期/金額是否與畫面一致**尚未驗證** |

---

## 10. 開放問題(OQ-FMT-N)— ✅ **已裁定 2026-08-04**

> 依 `AGENTS.md`〈研究錨定的建議 = 已核准〉。**每條註明撐它的是 §0 的哪一項。**

| # | 議題 | 裁定 | 依據 |
|---|---|---|---|
| **OQ-FMT-1** | 問題定義:是「修 mm/dd/yyyy」還是「格式主權」 | **格式主權** | §0.3-bis 量測:zh-TW 瀏覽器下我們本來就顯示 `2026/03/05`。原任務單的前提只在 en-US 瀏覽器成立 |
| **OQ-FMT-2** | 格式放哪 | **欄位設定** | §0.3:Ragic「欄位設定 › 基本」· Airtable 欄位的「Date format」—— 兩家一致 |
| **OQ-FMT-3** | 白名單 vs 格式碼 | **白名單五檔** | §5.2:白名單→格式碼相容,反向會動到客戶已存資料。先窄後寬 |
| **OQ-FMT-4** | 預設值 | **`local`** | §0.3 Airtable 逐字「attempt to use your browser's local language」;遷移期最不驚嚇 |
| **OQ-FMT-5** | A1 用補丁還是合併 | **合併(委派)** | §0.1:兩支函式做同一件事已經漂移;`pivot-and-charts` §14.5 同形狀,補丁不會是最後一次 |
| **OQ-FMT-6** | 自製輸入 vs 沿用原生 | **自製,但窄螢幕保留原生** | §6.1 三條路都被量測排除;D2 承認行動端未量測 |
| **OQ-FMT-7** | 民國年是否納入 P0 | **否,維持 P1** | §0.1:`field-types-parity` OQ-FTP-7 已裁定。但 §5.2 保證模型留得下它 |

---

## 11. 里程碑

| M | 內容 | 出貨判準 |
|---|---|---|
| **M1** | ✅ **已出貨(2026-08-04)** A1 顯示層單一來源 + `useDisplayCtx` | 呼叫點**七處**(§4 原寫四處,實際 7 檔 9 呼叫,含標籤列印)全部與記錄頁一致;單元測釘住兩支函式同輸出 |
| **M2** | ✅ **已出貨(2026-08-04)** A2 欄位級格式(options + `PATCH .../display` + 設計器 UI) | 設計者改格式 → 所有人看到的都變(實走驗證) |
| **M3** | ✅ **已出貨(2026-08-04)** A3 自製日期輸入 | 寬鬆解析對齊 Ragic 官方五例 + APG 鍵盤日曆 + 失敗不清空;`date-format.spec` 4 條固化 |
| **M4** | ✅ **已出貨(2026-08-04)** FMEA + docs 回填 | §9 D1–D4 全緩解 + §9.1 四條追加;`docs/25` **不灌水** |

---

## 12. 變更紀錄

| 日期 | 版本 | 變更 | 作者 |
|---|---|---|---|
| 2026-08-04 | v0.1 | 初版。**研究把題目換掉了**:#155 原題「原生日期輸入顯示 mm/dd/yyyy」在 zh-TW 瀏覽器下不成立(自家量測),真正的缺口是「格式由各人的瀏覽器決定」+「列表頁根本沒接上既有的格式化層」。OQ-FMT-1..7 依研究錨定規則裁定 | Claude Code |


---

## 13. M1/M2 出貨紀錄(2026-08-04)

**已出貨**|A1 顯示層單一來源(commit `cb93dd8`)+ A2 欄位級日期格式(後端 `eecffd0`、前端同上)。

### 13.1 落地中翻掉的兩件事

1. **呼叫點是 7 個不是 4 個**(§4 已就地更正)。憑印象數,而漏掉的正是**標籤列印** ——
   也就是 §9 的 D4 不是假設,是當時就成立的事實。
2. 🔴 **`display-value.ts` 有一行早已失效的空白正規化**:它寫死 `\u202f`
   (narrow no-break space),而現行 ICU 送的是 `\u2009`(thin space)。
   **那行是 no-op,而且沒有任何東西會告訴你** —— 它不會報錯,只會讓一個看不見的
   字元留在每一個時間戳裡,讓文字比對、複製到 Excel、匯出比對全部失準。
   改為歸一化**所有** Unicode 空白分隔符:ICU 改過一次就會再改,不追定碼位。

### 13.2 兩條測試在釘住 bug 本身

| 測試 | 原斷言 | 那是什麼 |
|---|---|---|
| `value.test` | `dateTime` → `2026-07-19 10:00:00` | UTC 的 ISO 去掉 `T`,既不是使用者的時區也不是 zh-TW 的寫法 |
| `builder` golden path | 金額 → `128400.0000` | 引擎 `numeric(19,4)` 的原始表示 |

新增「兩支函式對同一輸入給同一輸出」的斷言,防止再次分家。

### 13.3 一個沒解掉的、必須誠實記下的

`group-kanban-calendar.spec.ts:187`(看板鍵盤拖曳)在本輪期間反覆變紅,
我一度判定是本模組造成的迴歸,並依此改了兩處程式碼(把 hook 移出卡片、給卡片加 `memo`)。

🔴 **後來量測基線:乾淨樹連跑 4 次只過 2 次 —— 約 50% 不穩,與本模組無關。**
那兩處改動因此**都撤掉了** —— 它們的理由是我當時的誤判,而**不留無法佐證理由的程式碼**。

**教訓**:「改動後測試紅了」不等於「改動造成的」。在動手修之前,
**先在乾淨樹上量基線失敗率**;只跑一次的「乾淨樹會過」在 50% 不穩之下毫無資訊量。
我在這上面連續走錯了三個假設,全都是因為把一次成功當成了基線。

殘留與線索記在 task #25。
