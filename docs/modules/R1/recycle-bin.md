# recycle-bin.md — [H-2] 資源回收桶 + 保留期硬刪設計文件

| | |
|---|---|
| 狀態 | ✅ **SHIPPED v1.0(2026-07-30)** — OQ-RB-1..8 全採建議 |
| 建立 | 2026-07-30 |
| 上游 | docs/25 §H「資源回收桶(引擎 soft delete 地基已有,**使用者還原 UI 未起**)| 1 人月」· §246 下一批優先序第一項 |
| 依賴 | form-engine-core(soft delete)· reliability(cleanup cron)· authz · actions-approval(簽核鎖) |

---

## 1. 目標與範圍

### 1.1 🔴 現況比「缺一個還原 UI」嚴重

盤查後確認,現況是**「刪了拿不回來,但也沒真的刪」**:

| 層級 | 刪除行為 | 現況 |
|---|---|---|
| 記錄 | 動態表 `deleted_at` | 永遠留著 |
| **欄位** | `field_def` soft-delete,**物理欄不 DROP** | 程式註解寫「清理 job 之後收」 |
| **表單** | `form_def` soft-delete,**物理表不 DROP** | 註解同上 |
| 其他 7 個 Tier-1 實體 | `view_def` / `file_object` / `label_def` / `button_def` / `approval_def` / `users` 皆有 `deleted_at` | 永遠留著 |

🔴 **但那個「清理 job」不存在** —— 現有 cron(`cleanup.service`)只清「孤兒 pending 表單、孤兒檔案實體、
過期 idempotency key」,**從不硬刪任何 soft-deleted 資料**。
🔴 **且完全沒有還原入口** —— 資料在 DB 裡,使用者拿不到。

→ 這同時是**三個問題**:(a) 誤刪不可救 (b) 合規上等於沒刪 (c) 儲存與欄位額度持續被佔。

### 1.2 目標(P0)

1. **還原 UI** —— 記錄 / 表單(欄位見 OQ-RB-3)
2. **保留期 + 到期硬刪 job** —— 合規前提,亦解額度問題
3. **還原前的衝突檢查** —— 父已刪 / 同名衝突 / 違反後加約束,三類明示阻擋
4. **立即硬刪路徑** —— 供刪除權請求使用(繞過回收桶)

### 1.3 不做的事

- ❌ **備份層的刪除** —— ICO 允許備份「put beyond use」(承諾不再使用 + 屆期永久刪除),非本批
- ❌ **匿名化替代刪除** —— EDPB 2025 報告明確點名「以不當匿名化替代刪除」為不足
- ⏳ **每租戶自訂保留期** —— 先用全域預設,租戶級設定列 P1

---

## 0. 深度研究(2026-07-30)— 業界實證

> 專案 P0 規則:研究即寫入 doc,附來源連結並標注證據強度。
> §0.5 為**本機 PG 16 實測**,推翻本專案既有文件的一項記載。

### 0.1 系統 × 能力對照

| 系統 | 可還原層級 | 保留期 | 到期真硬刪 | 佔配額 |
|---|---|---|---|---|
| **Airtable** | 記錄 / **欄位** / 檢視 / 表 / base | 7 天(base)/ 30 天(workspace;Enterprise 可 30·60·90·180) | ✅ 官方明載 permanently removed | 記錄仍計 base 上限(社群一致,官方未載) |
| **Baserow** | workspace / database / table / view / **欄位** / row | **72 小時**(原始碼 `HOURS_UNTIL_TRASH_PERMANENTLY_DELETED = 24*3`) | ✅ 原始碼真 `DROP COLUMN` / `DROP TABLE` | ✅ 官方明載計入 workspace 儲存 |
| **NocoDB** | 記錄 / 表 / 檢視 / **欄位** / dashboard;**外接 PG base 不支援** | 未載 | 未載 | 未載 |
| **Ragic** | 「資料、表單、頁籤」;**欄位未提及**;>10 筆的大量刪除不逐筆列明細 | **查不到** | 查不到 | 查不到 |
| **Salesforce** | 記錄 15 天;**custom field 刪除後 15 天可 undelete,資料一起回來** | 15 天;回收桶容量 = 25× 儲存量,超量自動 purge 最舊 | ✅ | **刪除未 erase 的欄位仍佔 org custom field 上限** |
| **Notion** | page / database(無欄位概念) | 30 天;Enterprise 最長 10 年 | ✅「purged, not restorable by anyone」 | 未載 |
| **Google Drive** | 檔案 | **30 天**(2020-10 起自動) | ✅ | ✅ trash 仍耗配額 |
| **Teable** | table 可 Restore / Empty trash;欄位與記錄層級未載 | 未載 | 未載 | 未載 |

**關鍵答案**|**支援「還原欄位且資料一起回來」的有 Airtable / Baserow / NocoDB / Salesforce —— 這是主流不是例外。**
刪表時記錄**不**個別列入回收桶(整表一個 entry,還原表時連帶還原其欄位 —— Baserow 的 `trash_entry.related_items`)。

### 0.2 🔴 還原的衝突處理(最有價值的一段)

Baserow 把各種衝突**顯式建模成例外**,直接可對照:

| 例外 | 語意 |
|---|---|
| `CannotRestoreChildBeforeParent` | **父被刪就拒絕還原子項**,要求先還原父 |
| `RelatedTableTrashedException` | 還原欄位時關聯表已刪則**跳過該欄** —— 表還原採**部分成功**而非整批失敗 |
| `PermanentDeletionMaxLocksExceededException` | 硬刪批次過大會撞 `max_locks_per_transaction` → **硬刪必須分批** |

[Baserow issue #5101](https://github.com/baserow/baserow/issues/5101)「Restore tables with many fields can be slow and fail」:
>50 欄含公式的表還原會超過 gunicorn 30s timeout → **還原要走背景 job**。

**Salesforce**|`undelete()` 會級聯還原當初被級聯刪的子記錄;但 merge 造成的 reparent 不可還原。
欄位 undelete 後 **unique / external ID / required 與 page layout 不自動還原**,需手動 ——
即「**還原不保證還原全部約束**」是業界可接受的行為。

**🔴 本專案特有的必然衝突**|schema 用的是 **partial unique**
(`form_def_tenant_name_uq`、`field_def_form_name_uq` 皆 `WHERE deleted_at IS NULL`)——
所以**同名重建後再還原必然撞 23505**。同名衝突各家官方**一律未載**(誠實標注),需自己設計。

### 0.3 保留期與合規

- **EDPB 2025 Coordinated Enforcement**(2026-02 報告,32 個 DPA)點名兩件事,正好命中本專案現況:
  控管者**無備份刪除程序、僅靠覆寫週期而無成文政策**屬不足;**以不當匿名化替代刪除**亦被指出
- **ICO**:備份可「put beyond use」(承諾不再使用 + 屆期永久刪除)
- **台灣個資法 §11 III**:「特定目的消失或期限屆滿時,應主動或依當事人之請求,**刪除**、停止處理或利用」

→ **soft delete 永不硬刪 = 法律上沒刪。** 保留期就是對外宣告的 retention,到期**必須真硬刪**;
另需一條**繞過回收桶的立即硬刪**路徑供刪除權請求使用。

### 0.4 soft delete 的實作代價

[Brandur《Soft deletion probably isn't worth it》](https://brandur.org/soft-deletion)整理三大坑:
漏 predicate、FK 失效、GDPR 難清。替代方案是 archive 表。

**本專案的處置**|讀路徑全部是 `deleted_at IS NULL` → 索引一律建 **partial index**
(`WHERE deleted_at IS NULL`),索引小且 planner 命中。
partial unique 的副作用即 §0.2 的還原衝突;若業務要求「編號永不重用」則須改 full unique
(Salesforce 即因記錄實體仍在而持續佔用唯一值)。

### 0.5 🔴 本機實測:**attnum 永不回收,`VACUUM FULL` 也不行**

本專案 [field-types-parity](field-types-parity.md) §B-1 原記:
「1600 欄上限,DROP 掉的欄位仍佔額度,**只有 `VACUUM FULL` / `pg_repack` 重建整表才回收**」。

**後半句是錯的。** 本機 PG 16 實測(300 次 add/drop 循環):

```
循環後:            dropped=300  live=1  max_attnum=301
VACUUM FULL 之後:  dropped=300              max_attnum=301   ← 完全沒回收
```

佐證:PG 核心開發者 David Rowley 於 pgsql-hackers 明言「**We just never recycle attnums**」;
`pg_repack` 走 relfilenode swap,**不動 `pg_attribute`**(推論,強)。

→ **唯一解是建新表 + `INSERT INTO new SELECT` + 換名。** 已更正 field-types-parity §B-1。
這使「欄位刪除的還原」不只是體驗問題,而是**額度管理問題**(見 OQ-RB-3)。

### 0.6 誠實聲明:查不到的

- **Ragic 回收桶的保留期、是否硬刪、能否還原欄位**(官方 [doc/115](https://www.ragic.com/intl/zh-TW/doc/115/recycle-bin) 未載)
- Teable 的欄位/記錄層級 trash
- NocoDB 預設保留天數
- **各家對「同名衝突」與「還原違反後加約束」的官方處理**(全部無公開文件)

### 0.7 來源

Ragic|[資源回收桶](https://www.ragic.com/intl/zh-TW/doc/115/recycle-bin) · [Recycle Bin (EN)](https://www.ragic.com/intl/en/doc/124/recycle-bin)
Airtable|[Managing Trash](https://support.airtable.com/docs/base-trash)
Baserow|[Delete and recover data](https://baserow.io/user-docs/data-recovery-and-deletion) · [trash/exceptions.py](https://github.com/baserow/baserow/blob/develop/backend/src/baserow/core/trash/exceptions.py) · [database/trash/trash_types.py](https://github.com/baserow/baserow/blob/develop/backend/src/baserow/contrib/database/trash/trash_types.py) · [issue #5101](https://github.com/baserow/baserow/issues/5101)
NocoDB|[Actions on record](https://nocodb.com/docs/product-docs/records/actions-on-record) · [2026.04.2 Record Trash](https://nocodb.com/docs/changelog/2026.04.2)
Salesforce|[undelete() SOAP API](https://developer.salesforce.com/docs/atlas.en-us.api.meta/api/sforce_api_calls_undelete.htm) · [Manage Deleted Custom Fields](https://help.salesforce.com/s/articleView?language=en_US&id=platform.fields_managing_deleted_fields.htm&type=5)
Notion|[Delete & restore content](https://www.notion.com/help/duplicate-delete-and-restore-content) · [Custom data retention](https://www.notion.com/help/custom-data-retention-settings)
Google|[Drive trash auto-delete after 30 days](https://workspaceupdates.googleblog.com/2020/09/drive-trash-auto-delete-30-days.html) · [Manage storage](https://support.google.com/drive/answer/6374270)
PostgreSQL|[pgsql-hackers: attnums never recycled](https://www.postgresql.org/message-id/CAApHDvqHru4mq22hWYafF-BYYTxYuFKpBJBwC_T5MdG9Sdy2gw%40mail.gmail.com) · [Partial indexes](https://www.postgresql.org/docs/16/indexes-partial.html) · [What Really Happens When You Drop a Column](https://www.thenile.dev/blog/drop-column)
合規|[EDPB CEF 2025 右刪除權報告](https://www.edpb.europa.eu/system/files/2026-02/edpb_cef-report_2025_right-to-erasure_en.pdf) · [ICO 右刪除權](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/individual-rights/right-to-erasure/) · [個資法 §11](https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=I0050021)
反面|[Brandur — Soft deletion probably isn't worth it](https://brandur.org/soft-deletion)

---

## 4. 設計要點

### 4.1 回收桶 entry:記錄「當初連帶刪了什麼」

抄 Baserow 的 `related_items` 概念:刪除時記下連帶被刪的子項(子表 lines / 表單的欄位),
還原時**同一事務原批還原**。本專案 `record.service` 已對子表 lines 做 cascade soft delete,
需把該關係持久化到 entry 才還原得回來。

**呈現粒度**|表刪除 = 單一 entry(裡面的記錄不逐筆列);
大量刪記錄 group 成一筆(Ragic 的「>10 筆不逐筆列明細」是好參照)。

### 4.2 🔴 還原前 dry-run:三類阻擋原因

partial unique 讓「同名重建後還原」**必然 23505**,不能讓它變成一個 500。
還原前先檢查並回傳明確原因:

| 原因 | 處置 |
|---|---|
| **父已刪**(子表 line 的 header、表單的分類) | 拒絕,要求先還原父(Baserow `CannotRestoreChildBeforeParent`) |
| **同名衝突** | 拒絕並提供「改名還原」 |
| **違反後加的約束**(NOT NULL / unique / 新的必填欄) | 拒絕並列出違反的欄位 |

**禁止靜默成功或靜默丟資料。**

### 4.3 硬刪 job:分批 + 排除不可刪者

- **分批 + 每批 commit + `lock_timeout`** —— 一次刪太多會撞 `max_locks_per_transaction`
  (Baserow 的 `PermanentDeletionMaxLocksExceededException` 即此)
- DDL(DROP COLUMN / DROP TABLE)走**既有 advisory lock**,與其他 DDL 互斥
- 🔴 **簽核中 / 已過帳的記錄排除在硬刪之外**(AGENTS 鐵則 4:傳票不可變)
- 檔案沿用 `cleanup.service` 既有順序:**先刪物件實體再標記**
- 7 個 Tier-1 `deleted_at` 實體**一併納入 TTL** —— 否則合規破口留在角落

### 4.4 還原走背景 job(欄多的表)

Baserow #5101 實證:>50 欄的表還原會超時。本專案的表可能更寬(欄位型別多),
故還原採**背景 job + 進度**,不在請求週期內同步完成。

---

## 3. scope 切分

| 里程碑 | 內容 | 估算 |
|---|---|---|
| **M1 回收桶資料模型 + 查詢** | `trash_entry`(含 related_items)+ 刪除路徑寫 entry + 清單 API(走 RLS) | 0.08 mo |
| **M2 還原 + dry-run 衝突檢查** | 三類阻擋原因 · 原批還原 · audit | 0.08 mo |
| **M3 硬刪 job** | TTL 到期分批硬刪(記錄 / 欄位 DROP COLUMN / 表 DROP TABLE)· 排除簽核中 · 立即硬刪路徑 | 0.08 mo |
| **M4 前端** | 回收桶頁 · 還原 / 永久刪除 · 衝突提示 | 0.06 mo |
| **M5 收尾** | FMEA · e2e · doc v1.0 · MODULES · docs/25 回填 | 0.03 mo |

**合計 ≈ 0.33 mo**。前後端分開 commit。

### 實作結果

| | |
|---|---|
| commit | `72862ac` 後端 M1-M3 · `17d8715` 實走缺陷修正 · `5ea3d2f` 前端 M4 |
| migration | 0031 `trash_entry` · 0032 唯一索引補 `form_id` · 0033 `approval_instance` RLS + app 車道 SELECT |
| 測試 | api 606 綠(trash 17 條)· web 87 綠 · e2e 3 條 |
| 反向驗證 | 簽核保護 / 只還原連帶刪的欄位 / 跨表撞號 / 硬刪不需 resolveForm —— 拔掉即轉紅 |

---

## 10. 開放問題(OQ-RB-N)— ✅ 2026-07-30 全採建議

| # | 問題 | 選項 | 建議 |
|---|---|---|---|
| **OQ-RB-1** ⭐ | 保留期多久? | A. **30 天**(對齊 Notion / Google Drive)<br>B. 7 天(Airtable base)<br>C. 72 小時(Baserow) | **A** — 30 天是使用者最熟悉的心智模型(Drive / Notion 皆是);且本專案客戶是中小企業,誤刪常在「月結時才發現」。C 對 B2B 太短。**租戶可調列 P1** |
| **OQ-RB-2** ⭐⭐ | 到期真的硬刪嗎? | A. **是,真 DELETE / DROP**<br>B. 只隱藏不刪 | **A** — 個資法 §11 III 與 GDPR 皆要求期限屆滿即刪;EDPB 2025 報告明確點名「無成文刪除程序」為不足。B 等於現況,也就是**法律上沒刪** |
| **OQ-RB-3** ⭐⭐ | 欄位刪除要不要能還原? | A. **要,且資料一起回來**(Airtable / Baserow / NocoDB / Salesforce 皆如此)<br>B. 不做,欄位刪除即不可逆 | **A** — 物理欄本就不 DROP,還原成本近乎零(`deleted_at = NULL`),不做等於已付儲存成本卻不給價值。**但必須綁定額度管理**:§0.5 實測證明 attnum **永不回收**(`VACUUM FULL` 也不行),故 (a) 回收桶內的欄位**計入該表單欄位配額**並在 UI 顯示(Salesforce 即如此算)(b) 到期 purge 執行真 `DROP COLUMN` (c) 為每張動態表設 **lifetime attnum 軟上限**(建議 800),逼近時告警並提供「重建表」維護作業 |
| **OQ-RB-4** ⭐ | 回收桶算配額嗎? | A. **算**(Google Drive / Baserow 明載)<br>B. 不算 | **A** — 不算的話使用者會把回收桶當免費儲存;且 §0.5 的 attnum 額度本來就已被佔,不算等於帳面與實況不符 |
| **OQ-RB-5** ⭐ | 還原衝突怎麼處理? | A. **dry-run 三類阻擋 + 明確原因**<br>B. 直接嘗試,失敗回 500<br>C. 自動改名還原 | **A** — B 會讓 partial unique 的 23505 直接噴給使用者;C 的靜默改名會讓使用者以為還原成功但東西變了名字。**明確拒絕 + 提供選項**才是可行動的 |
| **OQ-RB-6** | 還原同步還是背景? | A. **背景 job + 進度**<br>B. 同步 | **A** — Baserow #5101 實證 >50 欄的表還原會超時。同步做法在寬表上必然踩到 |
| **OQ-RB-7** ⭐ | 誰能還原 / 永久刪除? | A. **分層**:表/欄 = design 權;記錄 = edit 權;清空回收桶 = admin<br>B. 一律 admin | **A** — 對齊 Airtable 的分層;B 會讓誤刪一筆記錄都要找管理員,實務上不可行。**回收桶清單一律走 RLS**,不得為了「看見已刪」而繞過 |
| **OQ-RB-8** | 刪除權的立即硬刪 | A. **提供繞過回收桶的立即硬刪**(admin + 打字確認 + audit)<br>B. 只能等 TTL | **A** — 個資法的刪除請求有時效要求,等 30 天不可行。B 會讓合規流程卡在產品限制上 |

---

## 12. 失效場景反思(FMEA)

| # | 場景 | 處置 | Sev | 狀態 |
|---|---|---|---|---|
| R1 | 🔴 **硬刪把簽核中 / 已過帳的記錄刪掉** | 排程 purge **與**立即硬刪都排除 `pending`/`approved`;兩條測試,排程那條已反向驗證 | **P0** | ✅ |
| R2 | 🔴 **回收桶清單繞過 RLS** | 清單走 app 車道 + 表單級權限二次過濾 + `own` 範圍只看自己刪的;測試以真 `weyver_app` 角色斷言「B 看不到 A 刪的」 | **P0** | ✅ |
| R3 | 硬刪一次太多 → 撞 `max_locks_per_transaction` | 分批 200 + 每類獨立 tx + `lock_timeout 3s` + DDL 走既有 per-form advisory lock;拿不到鎖即跳過,下輪再試 | **P0** | ✅ |
| R4 | 還原撞 partial unique 23505 → 500 噴給使用者 | dry-run 三類阻擋 + 就地顯示原因與違反欄位名 | P1 | ✅ |
| R5 | 還原寬表超時 | ⏳ 目前同步還原。Baserow #5101 的 >50 欄超時尚未在本專案重現;**待實測到再轉背景 job**,不預先加複雜度 | P1 | ⏳ |
| R6 | 7 個 Tier-1 `deleted_at` 實體漏納 TTL → 合規破口留在角落 | purge **直接掃各表 `deleted_at`** 而非掃 entry —— 沒有 entry 的軟刪資料照樣清,結構上不會有死角 | P1 | ✅ |
| R7 | attnum 耗盡撞 1600 欄硬牆 | ⏳ purge 已真 `DROP COLUMN` 回收儲存,但 §0.5 實測證明 attnum 不回收 → **lifetime 軟上限與告警未做**,列後續 | P1 | ⏳ |
| R8 | 硬刪後檔案實體殘留(孤兒) | ⏳ 目前 purge 不連帶刪附件物件。`cleanup.service` 的孤兒回收會撈到但需 `status='orphaned'` —— **未串接**,列後續 | P1 | ⏳ |
| R9 | 誤按「永久刪除」 | 兩段確認(第一下只進確認態);admin 限定 | P1 | ✅ |
| **R10** | 🔴 **entry 被靜默吞掉** —— 唯一索引漏 `form_id`,跨表撞號時 `ON CONFLICT DO NOTHING` 吃掉插入 → 記錄刪了但回收桶裡沒有 | 瀏覽器實走發現;0032 補 `COALESCE(form_id,0)`;回歸測試已反向驗證 | **P0** | ✅ |
| **R11** | 父表單已入桶時硬刪記錄丟誤導的 404 | 硬刪不走 `resolveForm`(只需物理表名);`plan` 端點父已刪則不 probe | P1 | ✅ |

---

## 13. 變更紀錄

| 日期 | 版本 | 變更 | 作者 |
|---|---|---|---|
| 2026-07-30 | **v1.0** | **SHIPPED**。OQ-RB-1..8 全採建議。M1-M3 後端(`trash_entry` 索引表 / 三類阻擋 dry-run 還原 / 到期分批硬刪含真 `DROP COLUMN`·`DROP TABLE`)+ M4 前端回收桶頁 + M5 收尾。**🔴 瀏覽器實走抓到四個測試沒抓到的缺陷**:(1) **唯一索引漏 `form_id`** —— 記錄 id 是每張動態表各自的 identity,跨表撞號時 `ON CONFLICT DO NOTHING` 把 entry 靜默吞掉,結果正是本模組要防的「記錄刪了但回收桶裡沒有」;整合測抓不到是因為每個案例都用剛建的表 + 遞增 id,從不跨表撞號(0032 修)。(2) **顯示欄位不是快照** —— title 寫死 `#id`、表單名靠即時查表,表單刪掉後只剩「表單 #729」;兩者改為刪除當下固化。(3) **硬刪要求 `resolveForm`** → 父表單已入桶時丟誤導的 404,而「父也被刪了」正是硬刪最常見的情境。(4) **`approval_instance` 無 app 車道 grant** —— 簽核鎖檢查須與 DELETE 同 tx 故須走 app 車道;dev 的 app 車道是特權角色把問題整個遮住,整合測用真 `weyver_app` 角色才炸出來(**本 session 第五次踩到「安全機制被特權連線遮蔽」**);順帶補上該表一直缺的 RLS(0033)。殘留 R5 還原背景化 / R7 attnum 軟上限 / R8 附件連帶硬刪,均列後續。api 606 綠 · web 87 綠 · e2e 3 條 | Claude Code |
| 2026-07-30 | v0.1 | M0 DRAFT。承 docs/25 §246 下一批優先序第一項。**盤查發現現況比「缺一個還原 UI」嚴重**:刪除全為 soft、物理層完整保留,而程式註解所稱的「清理 job」**並不存在** → 同時是「誤刪不可救 + 合規上等於沒刪 + 額度持續被佔」三個問題。**§0.5 本機 PG 16 實測推翻本專案既有文件**:field-types-parity §B-1 原記「`VACUUM FULL` / `pg_repack` 重建整表才回收 attnum」—— 實測 300 次 add/drop 後 `VACUUM FULL`,dropped 仍 300、max_attnum 仍 301,**完全沒回收**;PG 核心開發者明言「We just never recycle attnums」。已更正該文件。**§0.2 Baserow 把還原衝突顯式建模成例外**(父先於子、關聯表已刪則部分成功、硬刪批次撞鎖)可直接對照;本專案因採 partial unique,**同名重建後還原必然 23505**,而此情境各家官方全無公開處理方式。OQ-RB-1..8 待裁定 | Claude Code |
