# import-to-existing-form.md — [R1·#106] 匯入既有表單(upsert + 撤銷)設計文件

| | |
|---|---|
| 狀態 | **M0 DRAFT — 待 OQ-IMP-1..8 裁定** |
| 建立 | 2026-07-29 |
| 上游 | #106 追溯稽核(Tier 2)· grid-and-excel-import.md · docs/25 G 匯入匯出 |
| 依賴 | form-engine-core(記錄 DML / 動態表)· reliability(idempotency)· authz |

---

## 1. 目標與範圍

### 1.1 目標(P0)

**Ragic 官方的匯入主入口是「既有 sheet 的列表頁 → Tools → Import Data From File」** ——
遷移之後,客戶每天在做的是**把 Excel 匯進既有表**,不是建新表。
目前本平台只做了「Excel → 建立**新**表單」,匯入既有表**完全沒做**,這是 R1「既有客戶遷移」定位的硬破口。

1. 匯入既有表單 + 欄位對映
2. **upsert by key**(四政策)—— 無此功能則重覆匯入必產生重複資料
3. **dry-run 預覽**(業界只有 Odoo 的 Test 按鈕有做)
4. **可撤銷**(補償批次,非破壞性回寫)

### 1.3 不做的事(R1)

- 定時 / API 自動匯入(R2 的 G 連接器庫)
- 跨表關聯的自動解析(link 欄先以既有記錄 id 或唯一欄比對)
- 匯入樣板管理(存映射設定重複使用)→ P1

---

## 0. 深度研究(2026-07-29)— 業界實證

> 專案 P0 規則:研究即寫入 doc(來源 URL 最易失傳)。以下每條標注證據強度。

### 0.1 五個改變設計方向的發現

**F1|業界沒有一家做到「匯入是原子交易」。**
Salesforce / NetSuite / Odoo / Shopify 全部是部分提交,失敗列進錯誤檔。
→ **真正的護欄不是 rollback,是 (a) 匯入前全量 dry-run + (b) 匯入後可撤銷。** 不要把工程力氣花在追求單一 transaction。

**F2|🔴 最會靜默毀資料的點,與原本的猜測不同。**
原本假設危險的是「檔案中沒有的欄位會被清空」——**錯了,絕大多數系統都保留**:
- NetSuite 官方:「This option only affects mapped fields. It doesn't affect any unmapped fields.」
- Shopify 官方:「If a non-required column isn't included... the value in the product list remains the same.」

真正的戰場是**「有映射但儲存格空白」**,而業界在此**分裂**:

| 系統 | 預設 | 開關 |
|---|---|---|
| **Salesforce Data Loader** | **保留原值**(安全) | 需手動勾 `Insert Null Values` |
| **NetSuite** | **保留原值**(安全) | `Overwrite Missing Fields`(預設關) |
| **Airtable CSV 擴充** | **覆蓋成空白**(危險) | 需手動開 `Skip blank or invalid CSV values` |
| **Shopify** | **覆蓋成空白**(危險) | **無開關** |

Shopify 官方逐字:「If a non-required column in the import CSV file is blank, then the matching value
in the product list is **overwritten as blank**.」並自行舉例 Vendor 會被清空。

**F3|key 必須有 unique 約束,且要用 DB 強制而非應用層自律。**
Dataverse 用 DB unique index 強制;Airtable API 多重命中**整批失敗**;
**PostgreSQL 的 `ON CONFLICT` 本身就要求 unique index** —— 本專案是真實 PG 表,這點直接由 DB 把關。

**F4|檔案內 key 重複會讓 PG 直接爆錯。**
`ON CONFLICT DO UPDATE command cannot affect row a second time`(cardinality violation)。
**應用層必須先 dedupe 或先拒絕**,不能丟給 DB。

**F5|撤銷要當成補償批次,不是破壞性回寫。**
Airtable 社群的原話點破了關鍵區別:
「**There's a big difference between an _undo_ and a _roll-back_.**」
而 HubSpot 社群在原生功能出現前的標準做法是「**匯出歷史值 → 清理 → 反向匯入覆蓋**」
—— 社群自然收斂出的就是補償交易。這與 AGENTS 鐵則 4「傳票不可變,錯了開反向沖轉」同構。

### 0.2 歧義情況:各系統實際行為(這節是決策表的依據)

**檔案內 key 重複**

| 系統 | 行為 |
|---|---|
| **Airtable CSV 擴充** | **只用第一列,其餘靜默忽略、不報錯**(官方逐字) |
| **Salesforce upsert** | 該些列標為錯誤,不寫入(官方) |
| **PostgreSQL 原生** | 整句爆錯(cardinality violation) |
| Ragic / Baserow / NocoDB / Notion | 官方未載 |

**既有資料命中多筆**

| 系統 | 行為 |
|---|---|
| **Airtable CSV 擴充** | 🔴 **全部更新**(靜默,無警告)—— 官方逐字「*all* of those records will be updated」 |
| **Airtable REST API** | 整個請求失敗(同一產品線兩種相反行為) |
| **Salesforce** | 報錯不建不更;REST 回 **300** |
| **Dataverse** | 不可能發生(unique index 強制) |

**key 欄位為空**|Airtable / Odoo / HubSpot 一致:**建立新記錄**。
→ 但這正是 Notion 產生重複的機制;對「只更新」政策應**報錯**而非默默新增。

**值沒變化仍寫入**|**沒有任何一家做 no-op 偵測**(各家文件裡不存在這個概念)。
Salesforce 官方明列「running a data import」為觸發 `LastModifiedDate` 的動作;
其 picklist `Replace` 更是「**更新所有記錄的 Modified By,含資源回收桶中的**」。
→ **這是低成本的差異化**:1000 列有 900 列沒變就不寫 DB、不動 `updated_at`、不寫稽核、不發通知,
對「取代 ERP」的稽核可信度是實質加分。

### 0.3 交易性與失敗報告

沒有一家做全批 rollback。錯誤報告的形狀高度一致,可直接對齊:

- **Salesforce Data Loader**|產出 `success*.csv`(含新 record ID)+ `error*.csv`(含失敗原因)
- **NetSuite**|Job Status 頁 + 完成百分比 + `results.csv`(**僅含未處理/錯誤列,修正後可重跑**);
  錯誤訊息含**列號 + 欄名 + 造成錯誤的值**
- **Odoo**|**`Test` 按鈕是唯一的真 dry-run 實作**;無錯時顯示 "Everything seems valid."
- **Shopify**|開始後**不可取消**

→ 業界標準 = **可下載、逐列、含原始列號與錯誤原因、可修正後重跑**。Weyver 對齊此形狀 + 加上 Odoo 式 dry-run。

### 0.4 撤銷:各系統能力

| 系統 | 能撤銷? | 範圍 / 限制 |
|---|---|---|
| **Ragic** | ✅ 資料修改紀錄 → 還原鍵 | 僅 SYSAdmin;**官方未載保存期限**;🔴 見下方 N9 |
| **HubSpot** ⭐ | ✅ **最完整的公開實作** | Restore CRM changes:選**來源(Import/Workflow/手動/整合)**→ 回溯屬性值到 **14 天**內某時點;需 Super Admin;還原歷史保留 90 天;**刪除的記錄不在範圍** |
| **Zoho Analytics** | ✅ Import Rollback | **限 4 小時**、只回退一層、Enterprise 限定 |
| **Baserow** | ⚠️ 約 **5 秒** undo 視窗 | 錯過則靠 trash(3 天)+ row history 唯讀,要還原得**手動複製貼上** |
| **Airtable** | ❌ | Cmd+Z 無效;只能還原 snapshot,而**還原會建新 base 不覆蓋原 base**、還原出的 base **無修訂記錄**、免費版只留 2 週且**非定時拍攝** |
| **Salesforce / Odoo / Notion / NocoDB** | ❌ | Odoo 官方逐字:「Imports are permanent and cannot be undone」 |

### 0.5 負面發現(要避開的真實事故)

- **N1 Shopify**|空白欄靜默清空,**官方明載且無開關**;匯入開始不可取消;改 Option value 會刪既有 variant ID 破壞第三方相依。
- **N2 NetSuite**|`Overwrite Missing Fields` / `Overwrite Sublists` 兩個破壞性開關;
  官方明載**子表資料無法用空白列刪除,只能覆蓋**。
- **N3 Airtable**|匯入無法 undo 是多年公開痛點;擴充另有兩個靜默行為(重複 key 全部更新、空白格預設覆蓋)。
- **N4 Notion**|官方承認 merge **只新增不更新**,自行提醒 "so watch for duplicates"。
- **N6 NocoDB #3438**|「import csv on existing table allows duplicate data in primary key」——
  PG 環境下匯入未強制主鍵約束(0.98.2 已修)。**真實表架構的同款陷阱,直接相關。**
- **N7 Salesforce**|大量操作靜默污染稽核欄位(Modified By/Date),官方唯一指引是「操作前務必先備份」。
- **🔴 N9 Ragic —— 有 revert,但 revert 完資料是不一致的。**
  官方逐字:還原**無法復原由連結與載入、公式重算、workflow 觸發的修改**;
  且**還原本身也不會重新觸發**這三者。加上官方警語「此動作一旦執行便無法復原」、「不建議還原久遠的修改」。
  → **客戶正在用一個 revert 完會留下不一致資料的系統。這是明確的競爭切入點。**

**N8|Excel 本身就是資料破壞源(而這是客戶每天用的工具)**
- **基因名事件**|2016 Genome Biology:**19.6%** 含基因清單的論文有 Excel 自動轉換錯誤;
  後續掃描升至 **30.9%**(3,436 / 11,117 篇);送進 NCBI GEO 的檔案 **39.7%** 含錯誤。
  `SEPT2` → `2-Sep`。**問題持續超過五年未解。**
- **精度**|`00123` → `123`;超過 11 位轉科學記號;**Excel 只有 15 位有效數字,第 16 位起全變 0**。
  UPC / SKU / 訂單號 / 統編 / 電話全在射程內。
- **英國 PHE 事件**|2020/9/25–10/2,**15,841 筆確診結果因舊版 XLS 的列上限被靜默丟棄**,
  確診者被通知但**接觸者未被匡列**。這是「匯入管線靜默截斷」造成的真實公共衛生損害。
→ **本平台的 preflight 主動偵測前導零流失 / 科學記號 / 日期誤轉,是業界共同破口上的差異化。**

### 0.6 大檔

- **SheetJS 官方**|`dense: true`「對於數十萬列的工作表應使用」;
  失敗門檻是 V8 的 `Cannot create a string longer than 0x1fffffe8 characters`(536,870,888);
  dense 對**約 1000 萬格**有幫助;官方明確建議「**當必須處理非常大的檔案時,考慮在伺服器端執行**」。
- **各家上限**|Airtable CSV 擴充 **25,000 列 / 5MB**(此上限正是前端解析的代價)·
  Baserow **5,000 列** · Salesforce Data Import Wizard 50,000 / Data Loader 500 萬 ·
  NetSuite 25,000 或 50MB · Ragic 檔案 10MB(列數未載) · Shopify 15MB。

### 0.7 查不到(誠實聲明)

Ragic 的 key 比對是否 trim / 區分大小寫 / 全形半形 · Ragic 匯入列數上限 ·
Ragic 還原是否刪除該次新增的記錄 · Ragic 檔內 key 重複的行為 · Ragic 修改紀錄保存期限 ·
**任何系統對「值沒變化仍寫入」的說明(此概念在各家文件中不存在)** ·
**任何系統對全形/半形正規化的說明** · Salesforce upsert 時 External ID 為空的行為。

### 0.8 來源

Ragic|[Importing and Exporting](https://www.ragic.com/intl/en/doc/41/importing-and-exporting) · [Recent Changes(還原限制逐字)](https://www.ragic.com/intl/en/doc/91/recent-changes) · [資料庫修改紀錄](https://www.ragic.com/intl/zh-TW/doc/81/%E8%B3%87%E6%96%99%E5%BA%AB%E4%BF%AE%E6%94%B9%E7%B4%80%E9%8C%84) · [KB 232 匯入有誤如何復原](https://www.ragic.com/intl/zh-TW/doc-kb/232/) · [KB 65 Mass Update by Importing](https://www.ragic.com/intl/en/doc-kb/65/Mass-Update-by-Importing)
Airtable|[CSV Import Extension](https://support.airtable.com/docs/csv-import-extension) · [API upsert(fieldsToMergeOn 1–3 欄)](https://airtable.com/developers/web/api/update-multiple-records) · [snapshot 還原會建新 base](https://support.airtable.com/docs/taking-and-restoring-base-snapshots) · [社群「Undo an import?」](https://community.airtable.com/other-questions-13/undo-an-import-16986)
Salesforce|[upsert() SOAP](https://developer.salesforce.com/docs/atlas.en-us.api.meta/api/sforce_api_calls_upsert.htm) · [REST upsert 多重命中回 300](https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/resources_sobject_upsert_patch.htm) · [空白格預設保留原值](https://help.salesforce.com/s/articleView?id=000385542) · [success/error CSV](https://developer.salesforce.com/docs/atlas.en-us.dataLoader.meta/dataLoader/reviewing_output_files.htm)
NetSuite|[Choose Data Handling](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N345294.html) · [Overwrite Missing Fields](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_3751050565.html) · [Overwrite Sublists](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_3751046270.html) · [CSV Import Error Reporting](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N353446.html) · [Tips for Using Numbers in CSV](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N453795.html)
其他|[HubSpot Restore CRM changes](https://knowledge.hubspot.com/object-settings/restore-crm-changes) · [Zoho Import Rollback](https://www.zoho.com/analytics/help/datasources/import-rollback.html) · [Odoo 匯入不可復原](https://www.odoo.com/documentation/18.0/applications/essentials/export_import_data.html) · [Shopify 空白欄清空](https://help.shopify.com/en/manual/products/import-export/import-products) · [Notion merge 只新增](https://www.notion.com/help/import-data-into-notion) · [Dataverse alternate keys](https://learn.microsoft.com/en-us/power-apps/maker/data-platform/define-alternate-keys-reference-records) · [NocoDB #3438](https://github.com/nocodb/nocodb/issues/3438) · [Baserow 匯入既有表](https://baserow.io/user-docs/import-data-into-an-existing-table)
PG / SheetJS|[ON CONFLICT cardinality violation](https://pganalyze.com/docs/log-insights/app-errors/U126) · [SheetJS Large Datasets](https://docs.sheetjs.com/docs/demos/bigdata/stream/) · [SheetJS 字串長度上限](https://docs.sheetjs.com/docs/miscellany/errors/)
Excel 破壞性|[Nature — 基因名自動轉換仍在發生](https://www.nature.com/articles/d41586-021-02211-4) · [Gene name errors: Lessons not learned](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8357140/) · [BBC — PHE 15,841 筆確診遺失](https://feeds.bbci.co.uk/news/technology-54423988)

---

## 4. 設計要點

### 4.1 四種匯入政策(對齊 Ragic 客戶既有心智 + 補一個)

| 代號 | 名稱 | 語意 | 對應 |
|---|---|---|---|
| `insert_only` | 只新增 | 一律新增,不比對 key | Ragic「產生新資料」 |
| `upsert` | 更新既有並新增 | 命中則更新,未命中則新增 | Ragic「更新舊資料」/ Airtable merge |
| `update_only` | 只更新不新增 | 命中則更新,**未命中列為錯誤**(不靜默略過) | Ragic「只更新不新增」 |
| `insert_new_only` | 只匯入新的 | 未命中才新增,命中則跳過 | NocoDB「只新增」 |

### 4.2 決策表(**擋**=preflight 拒絕 · **警**=需確認 · **過**=正常)

| 邊界情況 | insert_only | upsert | update_only | insert_new_only |
|---|---|---|---|---|
| key 無 unique 約束 | — | **擋** | **擋** | **擋** |
| **檔案內 key 重複** | 過 | **擋**(可選 first/last wins) | **擋** | **擋** |
| **既有命中多筆** | — | **擋** | **擋** | **擋** |
| key 為空 | 過 | **警**→新增 | **擋** | **警**→新增 |
| **已映射但空白** | 過 | **預設保留原值** | **預設保留原值** | 過 |
| 未映射欄位 | — | **一律保留,無開關** | **一律保留** | — |
| 值完全沒變 | — | **不寫入**,計 `unchanged` | 同左 | — |
| 前導零流失 / 科學記號 | **警** | **警** | **警** | **警** |
| 正規化後才命中 | — | **警** | **警** | **警** |
| 未知選項值 | **警** | **警** | **警** | **警** |
| 更新影響 >20% 或 >1000 筆 | — | **警+二次確認** | 同左 | — |

**絕不採 Airtable 擴充的「命中多筆全部更新」與「空白格預設覆蓋」。**

### 4.3 撤銷資料模型 —— 原設計的 5 個缺口與修法

> 原構想:`import_batch_id` 標記本批新增的記錄 + 既有 soft delete → 一鍵撤銷。
> **方向對(對齊 HubSpot 與社群「反向匯入」直覺),但有 5 個實質缺口。**

| # | 缺口 | 修法 |
|---|---|---|
| **G1** | **更新型變更完全撤不回來**(只標記新增)。而遷移場景「每天匯入既有表」**絕大多數是更新** | `import_batch_rows` 存 **before/after diff**(只存真的改到的欄位) |
| **G2** | **`import_batch_id` 掛在記錄上會被覆蓋** —— 記錄先被 A 新增再被 B 更新,只能留一個 batch_id | **記錄表上不掛 batch_id**,關係全放側表,一筆記錄可屬多個 batch |
| **G3** | **無「匯入後又被人改過」的衝突偵測** → 還原會吃掉他人編輯(lost update)。Ragic 沒解決,只警告「不建議還原久遠的修改」 | **per-field compare-and-set**:當前值 == `after_image` 才還原;否則跳過並列入衝突報告 |
| **G4** | **撤銷後衍生值不一致**(公式 / rollup / lookup 不重算)。**Ragic 官方明載這是它的行為** | 撤銷後**排入重算**(明確與 Ragic 相反),並在報告顯示重算筆數 |
| **G5** | **副作用不可回收**(已寄通知 / 已過帳);autoNumber 不回收使單號有洞 | 匯入時 workflow/通知預設 `defer`(commit 成功後才發)或 `suppress`;文案明說編號不回收 |

```sql
-- 兩表皆 tenant_id + RLS FORCE
import_batches(
  id, tenant_id, form_id, actor_id,
  kind,                    -- 'import' | 'revert'
  revert_of_batch_id,      -- 撤銷即補償批次,原批次標 reverted;撤銷本身可再被撤銷
  status, policy jsonb, source_file_sha256, plan_hash,
  stats jsonb, idempotency_key, committed_at, revert_expires_at
)
import_batch_rows(
  id, tenant_id, batch_id,
  source_row_no,           -- 原始檔列號(錯誤檔要用)
  op,                      -- insert|update|noop|skip|error
  record_id, match_key_text,
  before_image jsonb,      -- 只存有變更的欄位(diff,非整列)
  after_image  jsonb,      -- 撤銷時做 compare-and-set
  error_code, error_message
)
```

**撤銷 = 產生一筆 `kind='revert'` 的新批次**,不刪歷史 —— 對齊 AGENTS 鐵則 4。

### 4.4 API 形狀(對齊 Salesforce / NetSuite 的既有心智)

```
POST /forms/:id/imports/:iid/plan     → dry-run:全量驗證,不寫任何資料
POST /forms/:id/imports/:iid/commit   → 提交(需帶 planHash + Idempotency-Key)
GET  /forms/:id/imports/:iid/errors.csv → 逐列錯誤(含原始列號 + 欄名 + 造成錯誤的值)
POST /forms/:id/imports/:iid/revert   → 產生補償批次
```

`planHash` 防「看的是 A 檔、送的是 B 檔」;`blockers` 非空則 commit 一律 409。

---

## 10. 開放問題(OQ-IMP-N)— **待裁定**

這八題都會影響**不可逆的資料安全行為**,值得先拍板再動工。

| # | 問題 | 建議 | 理由 |
|---|---|---|---|
| **OQ-IMP-1** | 撤銷保留期多久? | **30 天** | HubSpot 14 天 / Zoho 4 小時 / Baserow 5 秒。30 天已在同業之上,且 before/after 只存 diff,體積可控 |
| **OQ-IMP-2** | 是否開放 `blankPolicy=clear`(空白格清空既有值)? | **開放但預設 keep,且需打字確認表單名稱** | Shopify 無開關直接清空是 N1 事故;Salesforce/NetSuite 預設保留。完全不給則批次清欄無路可走 |
| **OQ-IMP-3** | 子表(lines)預設語意? | **`untouched`(只更新 header,明細不動)** | NetSuite 的 `Overwrite Sublists` 是破壞性開關且**無法用空白列刪除子表**。預設取最保守 |
| **OQ-IMP-4** | 單批列數上限? | **50,000** | Airtable 25,000 / NetSuite 25,000 / Baserow 5,000。取兩倍以宣稱遷移優勢 |
| **OQ-IMP-5** | 匯入時 workflow / 通知? | **預設 `defer`**(commit 成功後才發) | 讓撤銷視窗內沒有已外送的副作用(修 G5) |
| **OQ-IMP-6** | 🔴 **解析改到後端?** | **改後端,前端只留預覽 + 映射** | 現行 OQ-GEI-3=A 選前端解析(隱私 + 零 infra)。但**Airtable 的 25,000 列上限正是前端解析的代價**;SheetJS 官方也建議大檔在伺服器處理;且錯誤檔下載與重跑需要原檔。**這是推翻既有裁定,需明確拍板** |
| **OQ-IMP-7** | key 正規化預設? | **trim=true、caseSensitive=false、NFKC 全形→半形** | Airtable 官方就是 trim + 大小寫敏感;**全形半形業界全無**,但台灣場景必要 |
| **OQ-IMP-8** | 值沒變化時是否寫入? | **不寫入(no-op 偵測)** | **業界無一家做**。1000 列有 900 列沒變就不動 `updated_at`/稽核/通知,對「取代 ERP」的稽核可信度是實質加分 |

---

## 13. 變更紀錄

| 日期 | 版本 | 變更 | 作者 |
|---|---|---|---|
| 2026-07-29 | v0.1 | M0 DRAFT。承 #106 追溯稽核 + 深度研究(§0,~40 條來源)。研究推翻兩個原本判斷:(a) 危險的不是「檔案沒有的欄位」而是「有映射但空白」;(b) 撤銷設計有 5 個缺口,最大是更新型變更無 before-image 且 batch_id 掛記錄上會被覆蓋。OQ-IMP-1..8 待裁定,其中 OQ-IMP-6 為推翻既有 OQ-GEI-3 之提案 | Claude Code |
