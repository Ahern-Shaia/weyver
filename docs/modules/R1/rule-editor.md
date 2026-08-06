# rule-editor.md — [R1·C-6] 視覺化規則引擎(ZEN 決策表)設計文件

> 狀態|**M0 草擬(2026-08-06)** —— 🔴 **本 M0 的結論是「先不要做決策表」**,理由見 §0
> 上游|`docs/31` §5 第 3 項(列為**三件最該做之一**)· `docs/04` v2.4「C ZEN 規則編輯器 3 人月」· `docs/20`(選型 GoRules ZEN)

---

## §0 站在巨人的肩膀上

### 站一|自家 repo —— **ZEN 裝過,而且被移除了**

`approval.service.ts:884-892` 逐字(2026-08-03 稽核):

> 此處原本呼叫 `evaluateExpressionSync("amount >= threshold", …)`。那個表達式是**寫死的字串常量**,
> 兩個運算元在上面幾行已經是驗證過的 `number` —— **為了一個 `>=` 背了 `@gorules/zen-engine`
> 與每平台 10MB 的原生二進位**。
>
> **這不是放棄 docs/20 選 ZEN 的決策**:那個決策要的是它的 no-code 決策表編輯器…
> **要用的時候再裝回來是一行的事**,在那之前不需要為未來的能力先付原生相依的供應鏈與映像檔成本。

**已具備的規則能力**(`@weyver/rules`,前後端共用):
`conditionsMatch` · `matchesCondition` · 虛擬欄位 `$now` / `$actor` ·
運算子含 `between` / `dailyBetween` / 群組成員判斷。
**四個消費者**:條件式格式(C-2/C-3)· 動作按鈕閘 · 簽核閘 · 事件觸發器(C-4)。

### 站二|自己的相依套件

`@gorules/zen-engine` **目前未安裝**(2026-08-03 移除)。
授權 **MIT** —— 本專案 2026-08-06 直接讀 [LICENSE 本文](https://raw.githubusercontent.com/gorules/zen/master/LICENSE)
確認(「Permission is hereby granted, free of charge…」,`Copyright 2023 GoRules.io`),
非採信 `gh api .license.spdx_id`(AGENTS 鐵則 5-bis)。
**成本已量過**:每平台 10MB 原生二進位。

### 站三|競品 —— 🔴 **上游的四條依據,有兩條我們已經解掉了**

`docs/31` 逐字把這一項列為三件最該做之一,理由是:

> 上鎖 `doc-kb/215` / 重複警告 `doc-kb/253` / 權限阻擋 `doc-kb/193` / 欄位稽核 `doc-kb/155`
> **是同一件事的四個變形**。一個 GoRules ZEN 決策表全吃。

**本專案 2026-08-06 逐篇開本機鏡像讀原文覆核 —— 四篇確實全部是教人貼 JavaScript**,
但「同一件事的四個變形」這個判斷**不成立**,而且其中兩條**我方已經 no-code 做到了**:

| KB | 標題(官方) | Ragic 的答案 | **我方現況** |
|---|---|---|---|
| [`doc-kb/215`](https://www.ragic.com/intl/zh-TW/doc-kb/215) | 依據特定條件**上鎖整筆資料**? | 公式欄 + Post-workflow JS(`entry.getFieldValue(ENTRYLOCK_KEY)`)| ✅ **已解**:條件式格式 C-3 的「上鎖」= readonly,**且伺服器強制**,零程式 |
| [`doc-kb/155`](https://www.ragic.com/intl/zh-TW/doc-kb/155) | 記錄**特定欄位**的最後修改日期? | Global Workflow JS:`if (param.getOldValue(observeField) !== param.getNewValue(observeField))…` | ✅ **已解**:C-4 事件觸發器 `onUpdate` + `watchFields:[觀察欄]` + `setFields:{目標欄: $NOW}`,零程式 |
| [`doc-kb/253`](https://www.ragic.com/intl/zh-TW/doc-kb/253) | 建立重複資料時**顯示提醒但仍允許儲存**? | Global Workflow JS 查重 | ❌ **未解**:我方只有 `unique` 硬擋,**沒有「警告但允許」** |
| [`doc-kb/193`](https://www.ragic.com/intl/zh-TW/doc-kb/193) | **禁止管理員**在特定表單新增資料? | Pre-workflow JS:`response.setStatus('INVALID')` | ❌ **未解**:我方 admin 是**全動作特判**,擋不住 |

🔴 **剩下兩條都不是決策表能解的問題:**

- **`253` 是「驗證的嚴重度」** —— 需要的是「警告但允許儲存」這個**概念**,
  而我方目前只有二元的通過 / 拒絕。決策表給不了這個,那是驗證模型的一格。
- **`193` 是「權限模型的例外」** —— 需要的是**連 admin 都能被限制**,
  而我方 `EffectivePermissions` 對 admin 是 `return this.allActions` 特判。決策表也給不了。

### 🔴 裁定:**先不要做 ZEN 決策表**

| 判準 | 結論 |
|---|---|
| 上游列的四條依據 | **兩條已解、兩條不是決策表問題** → 這一項的**論據基礎已經被掏空一半以上** |
| 現有能力 | `@weyver/rules` 的條件 + C-4 的動作,已覆蓋「條件 → 動作」這一類 |
| 成本 | 每平台 10MB 原生二進位;而 2026-08-03 才因為「不值得」把它移掉 |
| 真正缺的 | **軟性驗證** 與 **admin 可被限制** —— 兩者都便宜,而且直接對應真實 KB 需求 |

⚠️ **這不是說 ZEN 永遠不做。** 決策表真正發揮價值的形狀是
**「多條件 × 多輸出、行數會長到幾十列」的表格式規則** —— 例如 R2 的
稅率矩陣 / 定價階梯 / 核准路由。**那時候再裝回來仍然是一行的事**(引原文)。
在 R1 的四條依據被掏空之後,**現在做它就是為了做而做**。

⚠️ **不得宣稱**|「Ragic 沒有視覺化規則引擎」—— 它有**條件式格式**(我方已 parity)。
真正成立的說法是:**它的條件式格式涵蓋不到的那些,官方答案是貼 JavaScript**,
而那四篇 KB 就是逐字證據。

---

## §1 改為建議的兩項(各自獨立,不需 ZEN)

### A|軟性驗證:「警告但仍可儲存」(對應 `doc-kb/253`)

現有的條件式格式已有 `required`(硬性)與 `message`(純提示)兩種效果,
**中間那一格是空的**:條件成立時**顯示警告 + 要求確認,但允許存**。

- 加一種效果 `kind: "warn"`,伺服器**不擋**、前端存檔前跳確認
- 🔴 **伺服器要記**:確認過的儲存寫 audit,否則「他有沒有看到警告」查不出來
- 查重情境用既有的 `unique` 索引查詢即可,不需新機制

### B|admin 也能被限制(對應 `doc-kb/193`)

`EffectivePermissions` 對 admin 是 `return this.allActions` 全動作特判。
Ragic 的需求是**在特定表單禁止 admin 新增** —— 那是合理的內控訴求(SoD 的雛形)。

- 表單級加一組 **deny 覆寫**,`deny` **優先於**任何授予(含 admin)
- ⚠️ **危險**:deny 可以把所有人鎖在門外。需要 break-glass ——
  建議 **deny 不得涵蓋 `design`**,租戶擁有者永遠能改回設定
- ⚠️ 與 `docs/04` v2.7 的 **E 段 SoD(R2)**同源,設計時要對齊避免兩套

---

## §2 待裁定(OQ)

| # | 問題 | 建議 |
|---|---|---|
| **OQ-RE-1** | 現在做 ZEN 決策表嗎? | **不做**。四條依據兩條已解、兩條非決策表問題;成本 10MB 原生二進位。改做 §1 A/B |
| **OQ-RE-2** | 「警告但允許」的效果放哪? | 併入**既有條件式格式**的 effects(第 11 種),不另開規則清單 —— 同 C-2 對「分段是目標選擇器不是新效果類」的裁定 |
| **OQ-RE-3** | admin deny 覆寫的 break-glass? | **deny 不得涵蓋 `design`**,否則會出現沒有人能救的租戶 |
| **OQ-RE-4** | 與 R2 的 SoD 關係? | §1 B 是 SoD 的最小前身。**先確認資料模型能長成 SoD**,不要做出第二套 |

## §12 FMEA

⏳ 實作前填。**已知必列**:deny 覆寫把所有人鎖死 · 警告疲勞(每次存檔都跳)·
軟性驗證的 audit 沒寫就等於沒有。

## §13 版本

| 日期 | 版 | 內容 |
|---|---|---|
| 2026-08-06 | v0.1 | M0。🔴 **結論是先不要做**:逐篇覆核 `docs/31` 引的四篇 KB,確認**兩條我方已 no-code 解決**(C-3 上鎖 / C-4 欄位時間戳)、**兩條不是決策表問題**(軟性驗證 / admin 例外)。站②複驗 ZEN 授權為 MIT(讀 LICENSE 本文),但它 2026-08-03 才因「為一個 `>=` 背 10MB 原生二進位」被移除 |
