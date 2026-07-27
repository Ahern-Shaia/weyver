# reliability.md — [F-6] 平台可靠性工程(冪等性 / 資源配額 / metadata 車道 RLS 兜底 / 清理 job)設計文件

> ✅ **狀態:APPROVED — OQ-REL-1..7 已裁定(2026-07-27;全採建議);進入 M1**
> **裁定摘要**|1=A 冪等 key 選填 · 2=**B** per-tenant 可調配額(tenants 加 nullable 欄)· 3=A 只切租戶範疇 metadata · 4=A `@nestjs/schedule` + advisory lock · 5=A 24h · 6=A 佔位 + 409 · 7=A 不補 outbox。
>
> **本模組不是新功能,是把散落各模組的 P1 殘留一次收斂。** 各模組 SHIPPED 時皆誠實記錄「治本歸屬 = I 平台可靠性工程」,本檔即該歸屬的落地設計。
>
> **收斂的殘留(逐條有 doc 出處)**
> | 出處 | 殘留 | doc 原文歸屬 |
> |---|---|---|
> | form-engine-core §12 **R7** | **HTTP retry 重複建記錄** —— 無 idempotency key | 「AGENTS ⚙️ 鐵則要求 mutation 帶 idempotency key;**pilot 上線前必補**」 |
> | form-engine-core §12 **C5** | **惡意大量建表(DDL DoS)** —— 無 per-tenant quota | 「治本 = quota 常數 + throttler,**上 prod 前必裝**」 |
> | form-engine-core §12 **T4** | **metadata 車道單防線** —— 特權連線,RLS 不生效 | 「治本 = F-2 時 metadata 切 app 車道 + nestjs-cls」(F-2 已 SHIPPED,治本條件已成立)|
> | form-engine-core §12 **C2** | 孤兒 `pending` form 清理 job 未實作 | 「治本 = I 可靠性工程排程 job」 |
> | form-engine-core §12 **R8** | app 車道無 `statement_timeout` | P2,順帶 |
> | file-storage §12 **S6** | 孤兒檔**實體**回收(目前只標記不刪) | 「需排程回收 job,歸平台可靠性工程」 |
> | actions-approval §12 | 簽核完成狀態與 `onComplete` 副作用**非同一 tx** | 正確性缺口 |
>
> **人月來源**|docs/04 v2.4 已編列 **I 平台可靠性工程 8 人月**(冪等 / 斷路 / outbox / 對帳 job / flag / 加密 / 隔離測試)。本模組取其中**前四項之 P0 子集**,其餘(outbox / 欄位級加密 / feature flag)留後續批次。
>
> 作者:Claude Code(草擬)
> 版本:v0.1(2026-07-27)
> 證據:各模組 §12 FMEA 表(上表逐條)、AGENTS「⚙️ 可靠 / 穩定 / 高效能鐵則」、docs/22 §6、docs/21(RLS + nestjs-cls)、docs/04 v2.4 I 項

---

## 1. 目標與範圍

### 1.1 目標(P0)

1. **冪等性**|所有 mutation 端點接受 `Idempotency-Key` 標頭;同 key 重放回傳**首次結果**而非重複建單。承 AGENTS「[P0] 所有 mutation / webhook / AI 動作帶 idempotency key —— 重試不重複過帳 / 不重複建單」。
2. **per-tenant 資源配額**|建表數 / 欄數 / 記錄數上限 + 建表類端點更嚴的 rate limit;超限明示拒絕。承 AGENTS「per-tenant 資源配額防 noisy neighbor」+ docs/21。
3. **metadata 車道 RLS 兜底**|`form_def` / `field_def` 等已有 RLS FORCE,但 Drizzle 車道走特權連線(superuser 繞過 RLS)→ 目前**僅 app 層 `WHERE tenant_id` 單防線**。改為讀寫走設了 `app.tenant_id` 的最小權限連線,使 RLS 成為真正的第二防線。
4. **排程清理 job**|孤兒 `pending` form(C2)+ 孤兒檔實體回收(S6)+ `orphaned` 檔案實體刪除;可重入、可觀測、失敗不影響主流程。
5. **順帶**|app 車道 `statement_timeout`(R8)、簽核完成與副作用同 tx(actions-approval)。

### 1.2 不做的事

- ❌ **outbox pattern / 不變量對帳 job**|屬 R2 計算層(GL/庫存)之前置,無 GL 時無對帳對象 → 留該階段。
- ❌ **欄位級加密 / feature flag / kill switch**|docs/04 I 項其餘子件,非當前殘留 → 後續批次。
- ❌ **circuit breaker / 優雅降級**|目前無外部呼叫(無 LLM / 無政府 API / 無 SCADA)→ 待首個外部整合時做,否則是為不存在的相依做設計。
- ❌ **分散式排程 / 多實例選主**|solo pilot 單實例;多實例才需要(見 OQ-REL-4)。

---

## 2. 上游 / 既有現況走查

| 子題 | 現況 | Gap |
|---|---|---|
| 冪等性 | ❌ 全無。24 個 mutation 端點皆非冪等 | 全新 |
| rate limit | ✅ 全域 `ThrottlerModule` 300/min | 無 per-tenant、無按端點分級、無資源上限 |
| metadata 車道 | ⚠️ `form_def`/`field_def`/`formula_def`/`relation_def` **已有 RLS FORCE**(0001/0004);但 `DRIZZLE` 由 `PG_POOL`(`DATABASE_URL` 特權)建立且不設 `app.tenant_id` → superuser 繞過 | 切 app 車道 + 設 GUC |
| app 車道 | ✅ `APP_KNEX`(`APP_DATABASE_URL` = weyver_app,無 BYPASSRLS)+ 每 tx `set_config` | 缺 `statement_timeout` |
| DDL 車道 | ✅ 已有 `SET LOCAL statement_timeout`(ddl.service) | — |
| 排程器 | ❌ 無(`@nestjs/schedule` 未裝);file-storage 以「上傳時順帶 sweep」替代 | 需決定排程機制(OQ-REL-4) |
| soft delete | ✅ 全表 `deleted_at` 慣例齊備 | 實體回收無 |

---

## 3. scope 切分

| 里程碑 | 內容 | 估算 |
|---|---|---|
| **M1 冪等性** | `idempotency_key` 表(migration 0015)+ 攔截器 + 端點標註 + 併發競態測 | 0.10 mo |
| **M2 配額 + 分級限流** | `tenant_quota` 常數/設定 + 建表·加欄·記錄數檢核 + 建表類端點嚴限 + 測 | 0.06 mo |
| **M3 metadata 車道切換** | Drizzle 走 app 車道 + tenant GUC(nestjs-cls 或顯式傳遞)+ **跨租戶隔離斷言**(superuser 不再繞過)+ 回歸 | 0.10 mo |
| **M4 清理 job** | 排程機制 + 孤兒 form / 孤兒檔實體回收 + 可觀測(結果寫 audit)+ 測 | 0.06 mo |
| **M5 收尾** | `statement_timeout`、簽核同 tx、FMEA、doc v1.0、回填各模組殘留註記 | 0.04 mo |

**合計 ≈ 0.36 mo**(docs/04 I 8 人月中之 P0 子集;其餘 outbox / 加密 / flag 未動)。

---

## 4. 設計要點(草案,細節依 OQ 裁定)

### 4.1 冪等性(M1)
- 表 `idempotency_key(tenant_id, key, endpoint, request_hash, status〔in_flight|done〕, response_code, response_body, created_at, expires_at)`,PK `(tenant_id, key)`。
- 攔截器:有 `Idempotency-Key` 標頭 → 交易內 `INSERT ... ON CONFLICT DO NOTHING` 佔位;衝突且 `done` → 回放原回應;衝突且 `in_flight` → 409(請重試);無標頭 → 依 OQ-REL-1 決定放行或拒絕。
- **request_hash 不符即 422**(同 key 不同 body = 用戶端錯誤,Stripe 語意),避免回放錯誤結果。

### 4.2 配額(M2)
- 每租戶:表數 / 每表欄數 / 記錄總數 / 儲存量(已有)。上限來源見 OQ-REL-2。
- 建表 / 加欄 / DDL 類端點另掛更嚴 `@Throttle`(如 10/min),與全域 300/min 分離。

### 4.3 metadata 車道(M3)
- 現況兩層:RLS 已存在但因特權連線而不生效 → 換連線即可讓既有 policy 生效,**無需改 policy**。
- 風險:`MetadataService` 亦服務**無租戶語境**之路徑(migration / 種子 / 跨租戶系統表如 `users`)→ 需明確切分哪些走 app 車道、哪些保留特權車道(OQ-REL-3)。
- authz Tier-1 表(`view_def` / `button_def` / `approval_def` / `label_def` / roles 等)刻意非 RLS(各模組 OQ 已裁定)→ **本模組不動**,僅處理已有 RLS policy 卻未生效者。

### 4.4 清理 job(M4)
- 對象:`form_def.provision_state='pending'` 逾時、`file_object.status='orphaned'` 實體刪除、已刪租戶資料。
- 一律**可重入 + 有上限批次 + 結果寫 audit**;失敗只告警不影響主流程。

---

## 10. 開放問題(OQ-REL-N)— ✅ 已裁定 2026-07-27(全採建議)

| # | 議題 | 選項 | 建議 = 裁定 |
|---|---|---|---|
| **OQ-REL-1** | 冪等 key 為必填或選填 | A. **選填**(有帶才生效;前端逐步接)<br>B. 所有 mutation 必填,無 key 即 400 | **A** — B 會一次打斷所有既有前端呼叫與 24 個端點的既有測試,且對「使用者手動點兩次」無幫助(那是 UI 防連點問題)。真正需要的是**重試安全**:前端 mutation 統一由 client 產生 key 即可全覆蓋。**證據**:Stripe / Adyen 皆為選填標頭 |
| **OQ-REL-2** | 配額上限來源 | A. **程式常數 + env 覆寫**(單一預設值,pilot 夠用)<br>B. `tenant` 表加欄位,per-tenant 可調<br>C. 完整方案表 | **B** — 白牌/方案分級已在 docs/04 A 模組列為需求,且 `tenants` 表加 4 個 nullable 欄成本極低(NULL = 用預設)。A 會在第一個大客戶就得改 schema;C 是 Phase 2 計費的事 |
| **OQ-REL-3** | metadata 車道切換範圍 | A. **只切租戶範疇之 metadata 讀寫**(form_def/field_def/formula_def/relation_def),系統表(users/tenants)與 DDL/種子保留特權車道<br>B. 全部切 app 車道 | **A** — B 會讓 `IdentityService`(跨租戶 upsert users)、org→tenant hook、migration 種子全數失效;這些本就無租戶語境。**風險點**:須逐一盤點呼叫端,漏切者仍為單防線 → M3 以「跨租戶讀取斷言」測試逼出漏網 |
| **OQ-REL-4** | 排程機制 | A. **`@nestjs/schedule`(MIT)單實例 cron**<br>B. BullMQ + Redis repeatable job<br>C. 外部 cron 打管理端點 | **A** — pilot 單實例;B 需 Redis 常駐(新 infra + ops,違 solo 低 ops);C 需外部設定且端點需另做鑑權。多實例時再升 B(docs/11 已列 BullMQ 為既定選項)。**代價**:多實例會重複執行 → 以「job 內 advisory lock」擋(引擎已有 advisory lock 慣例) |
| **OQ-REL-5** | 冪等回應保存期限 | A. **24h**<br>B. 7d | **A** — 重試窗口實務上以分鐘計;24h 已遠超;保存越久表越大。Stripe 為 24h |
| **OQ-REL-6** | 併發同 key | A. **佔位列 + 409 請重試**<br>B. 等待首次完成再回相同結果 | **A** — B 需長連線等待與逾時處理,複雜度不成比例;409 + 前端退避重試即可(第二次會命中 `done` 回放) |
| **OQ-REL-7** | 是否一併補 outbox | A. **不補**(留 R2 計算層)<br>B. 本模組一起做 | **A** — 目前跨模組副作用只有「簽核完成 → onComplete」一處,且該處以**同 tx** 即可解(M5);outbox 的價值在有 GL 過帳/外部通知時才顯現,提早做是為不存在的需求建設施 |

---

## 12. 失效場景反思(FMEA)— 收尾必填(R17);pre-mortem 預列

| # | 場景 | 預定緩解 | Sev |
|---|---|---|---|
| L1 | metadata 切車道後,某未盤點路徑因無 tenant GUC 而查不到資料(功能壞) | M3 全量回歸 + 逐一盤點呼叫端;RLS 查無 = 空結果非報錯 → **須以測試逼出**,不可只靠人工檢視 | P0 |
| L2 | 冪等回放把**他人**的回應回給你(key 碰撞) | PK 含 `tenant_id`;key 由 client 產生但 scope 於租戶;`request_hash` 不符即拒 | P0 |
| L3 | 佔位列寫入後程序 crash → key 永久卡 `in_flight` | `expires_at` + 掃描重置;409 訊息明示可重試 | P1 |
| L4 | 清理 job 誤刪仍被引用的檔案/表 | 只刪 `orphaned` / 逾時 `pending` 且**加保守時間窗**;刪前寫 audit;先 dry-run 模式 | P0 |
| L5 | 配額上限過低 → 正常客戶被擋 | 預設值以 pilot 實測為基準 + per-tenant 可調(OQ-REL-2=B);超限訊息含「聯絡管理員」 | P1 |
| L6 | 建表端點嚴限誤傷 Excel 匯入(一次建多表) | 匯入走 bulk 端點單次呼叫,不逐表打;限流值以實際流程實測 | P1 |
| L7 | 多實例部署後 job 重複執行 | advisory lock(OQ-REL-4 之代價已標);單實例期不觸發 | P1 |

---

## 13. 變更紀錄

| 日期 | 版本 | 變更 | 作者 |
|---|---|---|---|
| 2026-07-27 | v0.1 | 初版 DRAFT — 收斂 7 項跨模組 P1 殘留(core R7/C5/T4/C2/R8 · file-storage S6 · actions-approval 同 tx)。P0 = 冪等性 + per-tenant 配額 + metadata 車道 RLS 兜底 + 清理 job;outbox / 加密 / flag / circuit breaker 明確排除並附理由。OQ-REL-1..7 待裁定 | Claude Code |
