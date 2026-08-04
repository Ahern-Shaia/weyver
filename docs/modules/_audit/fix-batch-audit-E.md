# fix-batch-audit-E.md — 稽核「**修補本身**」(audit-D 之後的 63 檔)

| | |
|---|---|
| 稽核日期 | 2026-08-05 |
| 範圍 | `git 6307c3d..2766dbb`(audit-D 之後的全部修補,63 檔 +2230 行)|
| 問題 | **這批修補有沒有留下新的缺口?** |
| 方法 | 三組平行稽核(修補完整性 / 測試品質 / 安全與文件);**六條 🔴 全部由本人回程式碼複驗** |
| 產出性質 | 稽核;**未動任何程式與文件** |

---

## 1. 一句話結論

**修補本身重演了它要修的那些形狀。**

audit-D 的主題是「後端做完了、使用者碰不到」。這一批補完之後,
**同一個共用函式的 8 個呼叫點只接了 5 個**、**同一個檔案裡的批次路徑又漏了一次事件**、
**同一份 parity 清單又沒更新**。

> 🔴 最該記住的一句:`saveWithLines` 補事件的那個 commit,訊息裡逐字寫著
> 「橫切關注點掛在單筆路徑上,而繞過那一層的路徑就靜靜地沒有」——
> **而同一個檔案裡的批次匯入,當時就在那裡漏著,沒有被一起看。**
> 寫下教訓與套用教訓是兩件事。

---

## 2. 🔴 六條(逐條本人複驗)

### 2.1 `formatFieldValue` 8 個呼叫點只接了 5 個

| 檔案 | 缺什麼 | 使用者看到 |
|---|---|---|
| `builder/_components/records/grid-panel.tsx:59` | `linkLabels` | 連結欄顯示數字 id |
| `builder/_components/records/form-panel.tsx:202` | `linkLabels` **與 `members`** | 連結欄與**成員欄**都顯示 id |
| `forms/[formId]/labels/[labelId]/print/_client.tsx:174` | 全部(只傳 `field, value`)| 標籤列印:id + **不吃租戶時區與欄位日期格式** |

⚠️ 更難看的是:`link-picker.spec.ts` 的新測試自述
「兩者走同一支 `formatFieldValue`,故此處覆蓋等同覆蓋」——**那句話不成立**。
同一支但**參數不同**,漏傳的三面正是沒被覆蓋的那三面。
**「共用同一個函式」不等於「行為一致」,只要它有可選參數。**

### 2.2 記錄頁的明細表格走的是另一支

`forms/[formId]/_components/line-items.tsx:79` 用 `displayValue` 而非 `formatFieldValue`
→ 連結欄印裸數字、成員欄印 actor id、附件欄印 `[object Object]`。

這正是修補時問過但沒問完的那個問題:「哪些畫面走了不含新邏輯的那一支」。

### 2.3 靜態敘述只補在設計器那一半

`layout.statics[]` 補在 `builder/_components/records/header-fields.tsx`,
而**終端使用者的主要畫面** `forms/[formId]/_components/object-page.tsx` 自己排版、
不經 `HeaderFields` —— `grep -c statics` 回 **0**。

audit-D §2.5 抓的是「填單端零 reader」,修補只補了 builder 的填單面板,
**工作區的記錄頁仍然看不到說明文字**。

### 2.4 批次匯入沒發事件 —— 同一個檔案、同一個形狀、又漏一次

`record.service.ts:1053-1068`:逐列 `insertOne` 後只 `searchIndex.upsertManyInTx`,
**沒有 `emitInTx`**。使用者匯入 5000 筆:webhook 零投遞、事件驅動的整合全瞎。

🔴 **這與 `saveWithLines` 是同一個檔案、同一個形狀**,而修 `saveWithLines` 的
commit 訊息裡就寫著這個教訓。第四次。
(前三次:批次匯入沒寫搜尋索引 · 子表沒寫搜尋索引 · 子表沒發事件。)

🟡 同類:`record.service.ts:1500-1516` 記錄**還原**只重建索引、不發事件 ——
訂閱者收過 `record.deleted`,還原後永遠不知道它回來了。

### 2.5 🔒 `ids=` 指名解析漏掉「記錄範圍」的閘

`link-options.service.ts:101` 只設 `app.tenant_id`,**沒設 `app.record_scope`**。
而 `ddl.service.ts:682` 的 RESTRICTIVE policy 在該 GUC 未設時整條為真
(`NULLIF(current_setting('app.record_scope', true), '')`)。

後果:受「只能看自己的記錄」限制的使用者,可用 `?ids=1,2,3,…` **逐一枚舉目標表任意記錄的標題**。
原本的候選清單只回最近 20 筆,本次的 `ids=` 把它放大成任意 id 查詢。

⚠️ `record.service.ts:942` 對同一件事**有**設這個 GUC —— 也就是說,
**機制存在、範本就在隔壁,新路徑沒有套用**。屬租戶內 BOLA(洩漏面限標題字串)。
這正是 memory 裡 `pitfall_tenant_scoped_is_not_authorized` 的形狀。

### 2.6 `docs/25` 又漏計一次

最後一次更新是 `50c3343`(**早於**這批修補)。
本批補進的真實 parity 面 —— 連動選項 · 格式遮罩 · 條碼開關 · 連結欄可讀顯示 · 靜態敘述 ——
**一項都沒計入**;該文件 §B 仍寫著「cascade 規則未起」「缺條碼」。

⚠️ 該文件自己記錄過同型的漏計(v2.5「表單範本庫已出貨但此表原記 ⬜」),
**而漏計的是同一個人、同一週**。

---

## 3. 🟡 七條

| # | 內容 |
|---|---|
| 1 | **`aggregates` 仍只能打 API**:本批把它加進 `view-specs.ts` 且 `collection-view` 已消費,但 `list-controls.tsx` 只有 `groupBy` 的設定 UI → **群組小計沒有 no-code 路徑**,與本批所修者同型 |
| 2 | **`useLinkLabels` 送整頁 id,controller 靜默 `.slice(0,50)`** → 無限捲動超過 50 筆之後,第 51 筆起又退回顯示數字 id。**靜默截斷正是本次要修的症狀** |
| 3 | **`assertCascadingAllowed` 只驗本次 payload 含子欄的情形**:單獨改父欄不重驗既存子值 → 可留下不一致組合。另遷移舊資料時父欄留空、子欄有值且帶 `parents` → 整批 `BulkValidationError`,建議補一條匯入面的迴歸測試 |
| 4 | **`security.purgeAudit` 沒有 advisory lock**,而同型的 `trash-purge.service.ts:81` 有 → 多實例併發重跑;`auth_audit` 亦無 `created_at` 單獨索引,每日 DELETE 全表掃描 |
| 5 | **`approval-advanced.spec.ts:100`**:把 actor 91/92 加進角色卻沒斷言回 204。`role_members.actor_id` 對 `users.id` 有 FK,dev DB 若無該 user 則插入失敗被吞 → 分母變 1 → 紅在 `1 !== 2`,而訊息指不到成因。**環境相依的誤導紅**;另每跑一次留下一個 `e2e_quorum_*` 角色 |
| 6 | **`notifications.spec.ts:81` 的新守衛錨得不夠緊**:只證明「面板裡有某個待簽核項目」,而 `read-all` 只標已讀不刪除 → 舊項目就能滿足它,「不含 77000」又近乎恆真。應錨在本輪的 `E2E通知_<stamp>` 上 |
| 7 | **`link-picker.spec.ts:181` 用整頁 `getByText`**:同檔上一行已收斂到 `row`,這一行沒有 |

---

## 4. ⚪ 查過沒問題的(逐項記錄,不只報壞消息)

- **`groupBy` / `aggregates` 不進 SQL 文本**:一律經 `resolved.byName` metadata 白名單 + `assertReadable`;`unit` 為 enum 且二次檢查。**無注入面**(這是本專案第一大威脅,特別複驗)
- **`ids=` 的其餘防線**:租戶綁定 + RLS + 目標表單 `view` 權再驗 + `targetFormId` 取自欄位設定非使用者輸入 + 參數綁定 + 上限 50 —— 只缺 §2.5 那一道
- **`engineFetch` 空 body**:對 `z.object` 呼叫端仍會擲 ZodError(不會靜默成功),新呼叫端皆為 `z.unknown()`
- **`FieldInput` 三個呼叫點全帶 `siblings`/`fields`**
- **`bulkUpdate`(貼上)每列都有 `emitInTx` + 索引**
- **稽核清理與「不可刪改」鐵則可調和**:只刪逾期、無人為刪除入口
- **`assertCascadingAllowed` 無繞過**:全部寫入收斂於 `validateValues` 的三個呼叫點
- **靜態敘述的 `href`/`imageUrl`** 由 `safeUrl` 限 https/相對 → 無 `javascript:` 面
- **新 cron 已具名並列入 `schedule-registration` 清單**,少註冊即轉紅
- **測試品質**:`views` / `layout` / `events-webhooks` / `field-types-m2` / `schedule-registration` / `cascading` /
  `display-value` / `notification-levels` / `wysiwyg-parity` / `print-merge` / `field-types` / `integrations`
  逐條檢查「還原修補會不會紅」,**皆會紅**;負向斷言前皆有正向前置
- **五條文件更正抽驗與程式碼相符**(timeout / 匯出配額 / 申請存取 / option-colors / template_key)

---

## 5. 形狀分析:為什麼修補會重演它要修的東西

三條 🔴(§2.1 / §2.2 / §2.3)是**同一件事**:
**改動的落點是「我剛才在看的那個畫面」,而不是「這個能力的所有出口」。**

而 §2.4 更尖銳:教訓**寫進了 commit 訊息**,卻沒有套用到同一個檔案裡隔了 60 行的另一個迴圈。

**可操作的推論**|改共用函式或補橫切關注點時,**第一個動作是列出全部出口並逐一打勾**,
而不是先改一個再看測試綠不綠 —— 測試只覆蓋你想到的那些出口。

§2.6 則是第三次同型:**parity 清單的更新不在任何人的路徑上**。
它沒有 CI、沒有 hook、沒有「改了功能就會提醒你」的機制 —— 而
`pitfall_rule_without_check_always_drifts` 已經記到第七次。

---

## 6. 稽核本身的限制(誠實聲明)

- **六條 🔴 全部由本人回程式碼複驗**(grep + 讀呼叫鏈 + 讀 RLS policy 定義);
  §3 的七條 🟡 **採信分組稽核的驗證敘述,未逐條重驗**。
- **未跑任何測試**;§2.5 的 BOLA **未以實際請求證明**(未構造受限使用者實打 `ids=`),
  判定依據是 GUC 未設 + policy 的 `COALESCE` 語意。
- **未評估效能**;§3-4 的全表掃描為讀 schema 推斷,未 `EXPLAIN`。
- 未查:R2/R3 模組、mockup、`docs/25` 以外的對外文件。
