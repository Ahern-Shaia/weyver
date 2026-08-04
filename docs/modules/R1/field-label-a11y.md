# field-label-a11y.md — [R1·A11Y] 欄位輸入的無障礙名稱 設計文件

> ✅ **狀態:APPROVED(2026-08-04)** — OQ-A11Y-1..5 依 `AGENTS.md`〈研究錨定的建議 = 已核准〉裁定。
>
> **缺陷**|填單與記錄頁的欄位輸入框在無障礙樹上**沒有名字**。
> 視覺上的欄名是**旁邊那一格的 div**,與 `<input>` 沒有任何程式關聯 ——
> 螢幕閱讀器只會唸「編輯文字」,使用者不知道自己在填什麼(WCAG 4.1.2 Name, Role, Value)。
>
> **起因**|做 `link-picker-and-load` M1 時,e2e 找不到穩定的錨點而浮現。
> 👉 **測試找不到穩定錨點,通常代表使用者也找不到。**
>
> 作者:Claude Code(草擬)
> 版本:v0.1(2026-08-04)

---

## 0. 站在巨人的肩膀

### 0.1 巨人一:自家 repo

| 查了什麼 | 結果 |
|---|---|
| 欄名與輸入框是誰畫的 | 🔴 **同一個共用原件**:`packages/ui/src/components/field-grid.tsx` 的 `Cells` —— label 格與值格是**相鄰的兩個 div**。**這是關鍵**:關聯有**單一落點**,不必改 27 個地方 |
| `Input` / `Select` 能不能穿 `id` / `aria-*` | ✅ 兩者都 `{...props}` 全展開(`input.tsx` / `select.tsx`),不需要改元件簽名 |
| 既有的 a11y 正典是什麼 | `frontend-uplift` M5 已把 **W3C ARIA APG** 定為照抄對象(grid / listbox);同一權威可續用 |
| 填單與設計畫布是否共用容器 | ❌ **只共用格子不共用容器**(`field-grid.tsx:45` 逐字:「共用的是『格子』不是『容器』…填單是流式,設計畫布是 12 欄座標定位,硬套會弄壞座標系統」)→ **改 `Cells` 只影響填單/檢視,不動設計畫布** |
| 現況是怎麼被找到的 | e2e 只能靠 **placeholder 推導出的名稱**(如 money 欄的 `0.0000`)或整頁 `.first()` |

### 0.2 巨人二:自己的相依套件

| 查了什麼 | 結果 |
|---|---|
| 有沒有現成的 label 關聯工具 / headless form lib | `react-hook-form` **已裝**但只管值與驗證,**不產生 label 關聯**;`packages/ui` 無 label 原件 |
| 需不需要為此加相依 | **不需要** —— `Input`/`Select` 已 spread props,而 `<label>` 是原生元素 |

### 0.3 巨人三:規範與競品

| 來源 | 逐字 | 查證日 |
|---|---|---|
| **W3C Accessible Name Computation** | 名稱計算的順序:① `aria-labelledby`「if the current node has an `aria-labelledby` attribute that contains at least one valid IDREF」→ ② `aria-label` → ③ **Host Language Label**「native markup provides an attribute (e.g. `alt`) or element (e.g. HTML `label`…)」→ ④ Name From Content → ⑤ **Tooltip**「used only if nothing else provided results」 | 2026-08-04 |
| **Airtable 無障礙文件** | 涵蓋 grid(`role="application"`、單一 tabstop、方向鍵)與 interface,**未提及填單欄位如何標註** | 2026-08-04 |

⚠️ **未查證**|Ragic / Airtable 的填單欄位實際用什麼機制關聯標籤 —— 兩家的公開文件都沒寫。
**不宣稱「各家都如何」**;本模組以 **W3C 規範**為依據,那對這一題本來就比競品更適格。

🔴 **規範那一條是承重的**:`placeholder` 落在第 ⑤ 級(Tooltip,「只有在其餘都沒有結果時才用」)。
也就是**任何一種正確的標註方式都會蓋掉 placeholder** → **e2e 的波及面不可避免**(見 §3)。

### 0.3-bis 🔴 自家量測(推翻了原本要採用的方案)

同一份 HTML、三種策略,用 `getByRole("textbox", { name })` 量(**那正是 27 條 spec 的錨定方式**):

| 策略 | 無障礙名稱 | placeholder 還算不算名稱 | **點標籤能否聚焦** |
|---|---|---|---|
| `<label style="display:contents">` 包住 label 格 + 值格 | ✅ `交期` | — | ✅ **會聚焦到 input** |
| `aria-labelledby` 指向可見的 label 格 | ✅ `金額` | ❌ `0.0000` 命中 0 | ❌ 不會 |
| 現況(只有 placeholder) | ❌ `單號` 命中 0 | ✅ `PO-0001` 命中 1 | — |

**兩個結論:**

1. 🔴 **`display: contents` 的 `<label>` 在現行 Chromium 完全可用** —— 名稱與點擊聚焦都成立。
   我原本因為「`display:contents` 會把元素移出無障礙樹」的舊印象準備排除這個選項,**量了才知道不成立**。
   ⚠️ 這是「憑印象排除選項」的又一次 —— 印象裡的瀏覽器 bug 有保鮮期。
2. 現況被證實:欄位**只查得到 placeholder**,`單號` 這種沒有 placeholder 的欄位**在無障礙樹上完全匿名**。

⚠️ **只量了 Chromium**(Playwright 預設)。Firefox / Safari **未量**;
`display:contents` 的 a11y 支援歷史上各家不同步,**上線前應在真機補量**。

---

## 1. 目標與範圍

### 1.1 目標

1. 每個欄位輸入在無障礙樹上**有名字**,而且名字**就是畫面上看到的那個欄名**(單一來源,不重複寫)。
2. **點欄名可以聚焦到輸入框** —— 那是 `<label>` 的原生好處,不只是 a11y 也是日常體驗。
3. e2e 從「靠 placeholder / `.first()`」改為**靠欄名**錨定 —— 順帶讓那 8 支 spec 變穩。

### 1.2 不做的事

- ❌ **不改設計畫布的座標排版** —— `field-grid.tsx:45` 已明載兩者只共用格子;動容器會弄壞 12 欄座標系統。
- ❌ **不做全站 a11y 稽核** —— 本模組只解「欄位輸入沒有名字」這一條。
  網格(Glide canvas)的 a11y 是既有殘留,`views-list` 已標。
- ❌ **不動 `?` 說明鈕的 `aria-label`** —— 那條已經是對的(`field-grid.tsx:116`)。
- ❌ **不加任何相依** —— 原生 `<label>` 就夠(§0.2)。

---

## 2. 波及面(已量測,不是估的)

| 類型 | 檔數 | 說明 |
|---|---|---|
| 靠 **placeholder 推導的名稱** 或 **整頁 `.first()`** 錨定 | **8 支** | `builder` · `conditional-format` · `designer` · `file-storage` · `image-signature` · `image-processing` · `link-picker` · `views` |
| 已用 `getByLabel` / 具名 role 查詢(不受影響或**會變更穩**) | 其餘 | 例:`record-workbench` 的「狀態」已於 2026-08-04 改為欄名錨定 |

🔴 **2026-08-04 的實測:直接加 `aria-label` 造成 27 條 e2e 失敗。**
那不是「改壞了」,是**這些 spec 本來就靠一個不該存在的名稱在找元素**。

---

## 3. 設計

### 3.1 機制:`<label display:contents>` 包住整組格子

改在 `field-grid.tsx` 的 `Cells` —— **單一落點**:

```tsx
<label style={{ display: "contents" }}>
  <div className="…label 格…">{item.label}</div>
  <div className="…值格…">{item.value}</div>
</label>
```

**為什麼是它而不是 `aria-labelledby`**(OQ-A11Y-1):

| | `<label display:contents>` | `aria-labelledby` |
|---|---|---|
| 名稱 | ✅ | ✅ |
| **點欄名聚焦** | ✅ | ❌ |
| 要不要產 id | ❌ 不用 | ✅ 每欄要唯一 id |
| 文字來源 | 就是可見文字 | 就是可見文字 |

`aria-labelledby` 要為每個欄位產生穩定 id,而 id 一旦進 DOM 就會有人拿去當測試錨點 ——
**能不引入的識別碼就不要引入**。

⚠️ **`<label>` 只會關聯到裡面的第一個表單控件。** 值格若含多個控件
(如 `LinkInput` 的「搜尋框 + 下拉」),名稱會落在搜尋框上而不是下拉。
→ 這類複合輸入**自己已經帶 `aria-label`**(`供應商 搜尋` / `供應商 選擇記錄`),
**維持它們自帶的名稱**,不依賴外層 label(見 §3.3)。

### 3.2 e2e 遷移

8 支 spec 的錨點改為欄名:

```diff
- await fill.getByRole("textbox", { name: "0.0000" }).fill("128400.0000")
+ await page.getByLabel("金額", { exact: true }).fill("128400.0000")
```

🔴 **這不只是「改成能過」** —— 欄名比 placeholder **穩定得多**:
placeholder 是版面設定(`layout.placeholder`),設計者隨時會改;欄名是資料模型的一部分。

### 3.3 複合輸入的處置

| 輸入 | 現況 | 處置 |
|---|---|---|
| `LinkInput`(搜尋 + 下拉) | 各自帶 `aria-label` | **不變**(外層 label 會落在搜尋框上,而使用者要找的是下拉) |
| `DateInput`(文字 + 日曆鈕 + 彈層) | 日曆鈕有 `aria-label` | 文字輸入吃外層 label |
| `MemberInput` / `singleSelect` | 已有 / 已補 `aria-label` | **移除自帶的**,改吃外層 —— 否則同一個名字寫兩次,日後改欄名會漂移 |

---

## 4. 測試策略

| 層 | 內容 |
|---|---|
| 單元 | `FieldCellPair` 渲染後,`getByLabelText(欄名)` 取得到輸入框 |
| e2e | 8 支 spec 遷移;**新增一條守衛**:填單頁**每一個** `textbox` 都必須有非空的無障礙名稱 |
| 🔴 CI 守衛 | 上一條就是守衛 —— `frontend-uplift` 已有三道 CI a11y 檢查(對比 / 字階 / 1.4.12),此為第四道 |

⚠️ **守衛要寫成「全部欄位都有名字」而不是「某幾個欄位有名字」** ——
`pitfall_rule_without_check_always_drifts`:規則只寫在文件裡就會漂移,
而下一個新增的欄位型別若忘了,只有全稱斷言抓得到。

---

## 5. FMEA(pre-mortem)

| # | 失效 | 嚴重度 | 緩解 |
|---|---|---|---|
| A1 | `display:contents` 弄壞 CSS grid 版面(label 格/值格跑位) | **P0** | `display:contents` 正是為此設計(子元素直接參與外層 grid);**實走看畫面**,並跑既有的 `wysiwyg-parity` 幾何一致 spec |
| A2 | 複合輸入的名稱落到錯的控件上 | P1 | §3.3 逐類處置;e2e 對 `LinkInput` 已有具名斷言 |
| A3 | 同一個名字寫兩次(外層 label + 自帶 aria-label)→ 改欄名時漂移 | P1 | §3.3 明列要移除哪些自帶的 |
| A4 | Firefox / Safari 的 `display:contents` 行為不同 | P1 | ⚠️ **本模組只量了 Chromium**,誠實標注;上線前真機補量 |
| A5 | 8 支 spec 遷移時把斷言改成「能過」而不是「更對」 | P1 | 遷移一律改為**欄名**錨定(比 placeholder 穩定),不用 `.first()` 繞過 |

### 5-bis 🔴 落地後回填(2026-08-04,全部是**實走量出來、M0 沒預見的**)

| # | 失效 | 嚴重度 | 實況 | 處置 |
|---|---|---|---|---|
| **A6** | **巢狀 `<label>`** —— 值格自己已經有 `<label>` | **P0(已發生)** | 附件 / 圖片的輸入元件各自用 `<label>` 包住 `input[type=file]`(「選擇檔案」)。外層再包一層是**無效 HTML**,瀏覽器對「點擊要開哪一個檔案選擇器」解讀不一致,實測**上傳整個失效**,4 支 spec 同時紅 | `FieldItem.noLabelWrap` 逃生口;`header-fields` 以 `SELF_LABELLED` 集合帶入;`object-page` 同法 |
| **A7** | 設計器畫布的預覽格也被包了 | P1 | 畫布格子裡**沒有輸入**,包 `<label>` 只是多一層 DOM,且點擊會被解讀成「啟用格內控件」而與拖拉選取打架 | `canvas.tsx` 明示 `noLabelWrap: true` |
| **A8** | **量測型 spec 用 `firstElementChild` 取標籤格** | P1(已發生) | `wysiwyg-parity` 兩處都靠直接子節點定位。`display: contents` 不佔版面**但是一個 DOM 節點** —— 設計側突然量到 0 個欄位格、填單側量到寬度 0,而錯誤訊息寫「選取器可能失效」,指不到原因 | 兩處改 `querySelector(".bg-label")`,與外層包不包無關 |
| **A9** | 說明鈕 `?` 被一併 `aria-hidden` → 說明文字不可及 | P1(已發生) | M0 §1.2 自己寫著「不動說明鈕」,實作時仍為了乾淨的名稱把它關掉,`designer.spec` 立刻抓到 | 還原。**代價記在檯面上**:有說明的欄位名稱會變成「品名 說明:…」;正解是 `aria-describedby`,需為每個欄位產 id 並穿到輸入元件,**列殘留** |

**A6 / A8 的共同形狀** —— M0 §0.1 只查了「標籤格與值格在哪裡渲染」,沒查「**誰在依賴這段 DOM 的形狀**」。
`display: contents` 對**版面**是透明的,對 **DOM 走訪**不是;凡是用 `firstElementChild` / 直接子選擇器 /
巢狀語意(`<label>` 不可巢套)的地方都會被動到。**站①下次要多問一句:誰在讀這段結構?**

---

## 6. 開放問題(OQ-A11Y-N)— ✅ **已裁定 2026-08-04**

| # | 議題 | 裁定 | 依據 |
|---|---|---|---|
| **OQ-A11Y-1** | 用 `<label>` 還是 `aria-labelledby` / `aria-label` | **`<label display:contents>`** | §0.3-bis 量測:三者都能命名,但只有 `<label>` 同時給**點擊聚焦**;且不必產 id |
| **OQ-A11Y-2** | 改在哪一層 | **`field-grid.tsx` 的 `Cells`** | §0.1:label 格與值格本來就在同一個共用原件裡 —— 單一落點 |
| **OQ-A11Y-3** | 27 條 e2e 怎麼辦 | **遷移為欄名錨定**,不迴避 | §0.3 規範:placeholder 是第 ⑤ 級,任何正確修法都會蓋掉它 → **波及不可避免**;而欄名比 placeholder 穩定 |
| **OQ-A11Y-4** | 複合輸入(link / date) | **維持自帶 `aria-label`**;單一控件的移除自帶、改吃外層 | §3.1 的 `<label>` 只關聯第一個控件;§3.3 |
| **OQ-A11Y-5** | 要不要順便做全站 a11y | **不要** | 本模組只解一條;混進來會讓波及面失控,而波及面正是這件事唯一的風險 |

---

## 7. 里程碑

| M | 內容 |
|---|---|
| **M1** | `Cells` 加 `<label>` + §3.3 的複合輸入處置 + 實走看版面沒跑位 |
| **M2** | 8 支 spec 遷移為欄名錨定 + 新增「每個 textbox 都有名字」的守衛 |
| **M3** | FMEA 回填 + `docs/25` H 段(⚠️ 預期**不加分**:這是既有項目的品質,同 `frontend-uplift` 的處理) |

**狀態|✅ SHIPPED v1.0(2026-08-04)** —— e2e 143 綠 / 1 skipped(3.2 分),web 單元 243 綠,lint 4/4 綠。

### 7-bis 順帶修掉的兩條**與本模組無關的既有缺陷**

跑全套時浮出來,都不是本次改動造成的,但「紅燈不可擺著」:

| 缺陷 | 形狀 |
|---|---|
| `data-export` 一天只能跑十次 | 等待訊號是「列數 +1」,而 `listForActor` 後端**硬上限 20 筆**、`EXPORT_MAX_PER_DAY = 10`。累積滿了之後這條**恆紅**,症狀卻只是「最上面那列沒換人」。改成認最前列換人,並在 `global-setup` 歸零當日配額 |
| `approval-advanced` 兩條無規律紅 | 斷言用文字找狀態章,而**操作完成的提示訊息與狀態章一字不差**(「已駁回」/「已強制解鎖…」),提示是短暫的 → 同一份程式碼有時 0 個、有時 2 個。改為 `data-testid` 指名。**文字是給人看的,不是識別碼** |

---

## 8. 變更紀錄

| 日期 | 版本 | 變更 | 作者 |
|---|---|---|---|
| 2026-08-04 | v1.0 | M1–M3 落地,**SHIPPED**。§5-bis 回填 4 條 M0 沒預見的失效(3 條已實際發生),其中 A6 巢狀 `<label>` 是 P0。§7-bis 記兩條順帶修掉的既有缺陷 | Claude Code |
| 2026-08-04 | v0.1 | 初版。承 `link-picker-and-load` §7-bis。**量測推翻了原本要採用的方案** —— 我因「`display:contents` 會移出無障礙樹」的舊印象準備排除 `<label>`,實測在現行 Chromium 完全可用**且多給了點擊聚焦**。⚠️ 印象裡的瀏覽器 bug 有保鮮期 | Claude Code |
