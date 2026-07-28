# reliability.md — [F-6] 平台可靠性工程(冪等性 / 資源配額 / metadata 車道 RLS 兜底 / 清理 job)設計文件

> ✅ **狀態:SHIPPED v1.0(2026-07-28)— M1–M5 全數落地,FMEA L1–L7 全緩解**
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
| **M5 收尾** | `statement_timeout`、簽核副作用順序、FMEA、doc v1.0、回填各模組殘留註記 | 0.04 mo |

**合計 ≈ 0.36 mo**(docs/04 I 8 人月中之 P0 子集;其餘 outbox / 加密 / flag 未動)。

### 3-bis. 實作偏離 M0 之處(誠實記錄)

1. **簽核副作用改「先執行、後定案」而非同一 tx**|M0 §1.1-5 寫「簽核完成與副作用同 tx」,但簽核狀態走 Tier-1 Drizzle 車道、記錄 DML 走 app Knex 車道,**跨車道無法同一 DB tx**。改為:先執行 `onComplete` 按鈕(已有綁 instance 的冪等 key)→ 成功才標 `approved`。副作用失敗 → 實例維持 `pending` 可重按核准,冪等 key 保證不重複執行。反向順序(先標 approved)會產生「已核准但單據未動」且無法自動修復的狀態 —— 新作法嚴格優於原設計。
2. **記錄配額只在 bulk 路徑檢核**|單筆插入前做全表 `count(*)` 在大表為 seq scan(每筆一次),代價與收益不成比例。DDL DoS 的實際載體是建表與批次匯入,故配額落在表數 / 欄數 / bulk;單筆由 throttler 與表/欄上限間接約束。
3. **冪等性以攔截器而非守衛實作**|全域守衛早於 controller 級 `TenantGuard` 執行,拿不到 `request.tenantContext`(承 `ApprovalLockInterceptor` 同一教訓)。
4. **`TenantDb.withTenant` 取代裸 db 注入**|M0 §4.3 只說「切 app 車道」;實作進一步**不對外提供裸 db**,強制所有租戶範疇 metadata 存取都在設好 GUC 的交易內 —— 否則 RLS 會讓漏設語境的查詢靜默回空(FMEA L1 的根因),難以察覺。
5. **清理 job 用交易範圍 advisory lock**|M0 §4.4 未指定鎖形式。採 `pg_try_advisory_xact_lock`(而非 session 級)避免使用 knex 私有連線 API;物件刪除本身冪等(`rm force` / S3 `DeleteObject`),極端情況重跑無害。

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

> **收尾結論(2026-07-28)**|L1–L7 全數已緩解且有測試斷言。

| # | 場景 | 落地緩解 | Sev | 狀態 |
|---|---|---|---|---|
| L1 | metadata 切車道後,某未盤點路徑因無 tenant GUC 而查不到資料(功能壞) | `TenantDb.withTenant` 為唯一入口(不曝露裸 db)→ 漏設語境於編譯期即不可能;api 305 全量回歸為第二道網(RLS 回空會讓斷言資料的測試失敗) | P0 | ✅ |
| L2 | 冪等回放把**他人**的回應回給你(key 碰撞) | PK `(tenant_id, key)`;`endpoint` + `request_hash` 不符即 422。測:B 租戶用 A 的同名 key → 正常執行不回放 | P0 | ✅ |
| L3 | 佔位列寫入後程序 crash → key 永久卡 `in_flight` | `expires_at`(24h)逾期即可被同 key 重新佔用;handler 失敗主動釋放佔位列。測 2 則 | P1 | ✅ |
| L4 | 清理 job 誤刪仍被引用的檔案/表 | 只動 `orphaned`(逾 72h 觀察期)/ 逾 24h `pending`;pending form 只標 `failed` **不刪**(保留供查因)並寫 `ddl_audit`;`CLEANUP_DRY_RUN=1` 可先驗。測:未逾時者原封不動 | P0 | ✅ |
| L5 | 配額上限過低 → 正常客戶被擋 | `tenants` 三欄 per-tenant 可調(NULL=預設);403 訊息含「請聯絡管理員調整配額」 | P1 | ✅ |
| L6 | 建表端點嚴限誤傷真實情境 | ⚠️ **2026-07-28 實際發生,已修**|原設 建表 20/min、加欄 60/min,推理依據是「遠高於人工設計節奏」—— **但漏想了本產品的主要情境:從 Ragic 遷移**,一個工作區一次會建數十至上百張表;e2e 全套亦於一分鐘內撞限而失敗(症狀先被 dev DB 過慢所掩蓋,清理後才浮現)。**修正**:建表 120/min、加欄 300/min,並釐清分工 —— **總量防線是 per-tenant 配額**(`max_forms` 預設 500),限流只擋瞬間 DDL 風暴,不該兼任總量控制 | P1 | ✅ 已修 |
| L7 | 多實例部署後 job 重複執行 | `pg_try_advisory_xact_lock`:取不到即 `skipped`。測:並行兩次不拋錯、至多一個真跑 | P1 | ✅ |

---

---

## 0-bis. 追溯稽核(2026-07-29)— **本模組原無業界對照,事後補**

> 冪等 / 配額 / 排程是高度標準化的領域,當初卻只對照自家工程鐵則。
> 對照 **Stripe 官方**、**IETF draft-ietf-httpapi-idempotency-key-header-07**、
> 以及 brandur(Stripe 冪等實作藍本作者)。

### 🔴 已修:失敗請求的冪等語意(原本一律釋放佔位列)

- **Stripe 官方**|保存首次請求的 status code 與 body,**無論成功或失敗**;
  **唯一例外**是「參數驗證失敗或併發衝突 → 端點尚未開始執行 → 不保存」。
- **brandur** 明確二分:**5xx / 逾時 = 暫時性 → 釋放允許重跑**;
  **4xx = 永久性**(業務規則拒絕)→ **存為 done 並回放**,因為重試結果不會改變。

**原實作一律釋放的實際危害**|handler 已執行、寫了部分副作用後才拋 4xx
(例:自訂按鈕已更新 A 表、驗 B 失敗)→ 重試會**重複那些副作用**,正是冪等要防的事。

**修法**|依「handler 是否可能已開始執行」分流:
`BadRequestException`(ValidationPipe 於 handler 前拋)→ **釋放**(對齊 Stripe 例外條款);
`DomainError`(service 內拋的業務規則拒絕)與其餘 4xx → **存 done 並回放**;5xx 與未預期錯誤 → 釋放。

⚠️ **實作踩點**|`DomainError` **不是 `HttpException`**(由全域 filter 映射成 4xx),
初版只判 `instanceof HttpException` 導致它被當成 500 而釋放。
已把 `mapDomainError` 由 filter **匯出共用** —— 兩處各自映射會漂移,使「回放的錯誤碼」與「實際回應的錯誤碼」不一致。

⚠️ **測試踩點(值得記)**|初版測試比對「回放與首次的 status + code 是否相同」—— **無鑑別力**,
因為同樣的輸入重跑會產生同樣的錯誤碼,分不出回放與重跑。
改為**直接斷言 `idempotency_key` 表的狀態**(永久性失敗須留 `status='done'`;釋放則列消失)才測得到。

### 七個決定的裁定

| # | 決定 | 裁定 | 依據 |
|---|---|---|---|
| 1 | 冪等 key **選填** | ✅ 維持 | Stripe、AWS `ClientToken`、PayPal `PayPal-Request-Id` **全為選填**。惟 **AWS SDK 自動代產 key** → 建議前端 client 層統一自動附加,補回「忘了帶」的缺口 |
| 2 | 配額常數 + env | ✅ 維持(**前提已過時**)| `quota.service.ts` 實際已是 `tenants` 覆寫 → plan → env 三層(F-8 加的),早已是 per-tenant |
| 3 | 只切租戶範疇 metadata | ✅ 維持 | 無外部標準可比;`TenantDb.withTenant` 為唯一入口的收斂是正解 |
| 4 | `@nestjs/schedule` + advisory lock | ⚠️ **應調整** | 見下 |
| 5 | 冪等保存 **24h** | ⚠️ **應調整為 72h** | Stripe 官方為 "at least 24 hours";**brandur 建議 72h**,理由是「**週五部署的 bug,週末仍查得到**」—— retention 同時是**除錯窗口**,不只是回放窗口 |
| 6 | 併發同 key → **409** | ✅ 維持 | **IETF draft-07**:「原請求處理中 SHOULD 回 409」;Stripe 亦 409。⚠️ 建議加 `Retry-After: 1` |
| 7 | 不做 outbox | ✅ 維持 | 無 GL / 外部通知前無對帳對象 |

### 逐條對照 Stripe 語意

| 題 | Stripe / IETF | 本專案 | 判定 |
|---|---|---|---|
| key 有效期 | "at least 24h";brandur 建議 72h | 24h | ⚠️ 建議延長 |
| **同 key 不同 body** | **draft-07 SHOULD 回 422** | **422** | ✅ **比 Stripe 的 409 更貼近標準** |
| 併發同 key | 409 | 409 | ✅ |
| 支援方法 | Stripe 僅 POST,DELETE 忽略 | 納入 PUT / DELETE | ✅ 無害擴張 |
| 重播標頭 | **無任何 RFC 定義** | 自創 `idempotent-replay` | ⚠️ 建議對齊社群慣用 `Idempotent-Replayed` 並寫進 API 文件 |
| **key 作用域** | Stripe 為**帳號範疇不分 endpoint**,**跨 endpoint 重用即報錯** | `(tenant, key)` PK + 存 `endpoint` 比對 | ✅ **完全正確** |

> **IETF 現況**|`draft-ietf-httpapi-idempotency-key-header-07`(2025-10)**仍非 RFC**,Standards Track。
> 本專案的唯一偏離是 draft 要求「必填而缺 key 時回 400」—— 因採選填故不適用。

### 排程(⚠️ 應調整)

**`@nestjs/schedule` 已知缺口**|**無錯過補跑**(部署 / 當機期間的 tick **永久遺失**)· 無執行歷史 · 無重試 ·
cron 依各實例**本地時鐘**(容器時區 / DST 漂移)。

**`pg_try_advisory_xact_lock` 選得對** —— session 級鎖在連線池歸還後會**洩漏未釋放**,交易級自動釋放;
它同時兼任「執行超過間隔」的防重疊保護。
⚠️ **唯一新風險**:鎖持有整個交易 → 清理 job 全程單一長交易,會**拖住 vacuum / xid horizon**,批量大時應改「短交易分批」。

**Node / PG 生態標準解**|**graphile-worker crontab**(`known_crontabs` 表 + **backfill 補跑**)或 pg-boss。
→ **現階段留著**,但加「上次成功執行時間」欄以偵測遺失、明訂 `TZ`;升多實例或需補跑時換 graphile-worker。

### 其餘

- **`response_body` 進 DB**|Stripe / brandur 的 schema 同樣存。真實 gap 是 **PDPA** ——
  它是個資的**影子副本**,租戶刪除 / 資料權利流程必須涵蓋此表;另建議設 body 大小上限,超限則不存(退化為不回放)。
- **清理**|hourly cron 刪逾期 ✅ 對齊 brandur 的 reaper。
- **配額回應碼**|429 的語意是「稍後重試」,對「表單數達上限」是**假承諾** → **403 正確**,且不應給 `Retry-After`。
  但限流(throttler)那條 429 應補標頭:`RateLimit-Policy` / `RateLimit`(**draft-11,仍非 RFC**)。

### 來源

- [Stripe: Idempotent requests](https://docs.stripe.com/api/idempotent_requests) · [Stripe: Low-level error / status codes](https://docs.stripe.com/error-low-level)
- [IETF draft-ietf-httpapi-idempotency-key-header-07](https://www.ietf.org/archive/id/draft-ietf-httpapi-idempotency-key-header-07.html) · [IETF RateLimit header fields (draft-11)](https://datatracker.ietf.org/doc/html/draft-ietf-httpapi-ratelimit-headers)
- [brandur: Implementing Stripe-like Idempotency Keys in Postgres](https://brandur.org/idempotency-keys)
- [AWS: Making retries safe with idempotent APIs](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/) · [PayPal: Idempotency](https://developer.paypal.com/api/rest/reference/idempotency/)
- [Graphile Worker: Recurring tasks (crontab)](https://worker.graphile.org/docs/cron)

## 13. 變更紀錄

| 日期 | 版本 | 變更 | 作者 |
|---|---|---|---|
| 2026-07-28 | v1.1 | **修 FMEA L6 實際誤擊**:建表限流 20→120/min、加欄 60→300/min。原值以「遠高於人工節奏」推理,漏想 Ragic 遷移之批次建表(本產品主要情境);釐清「配額管總量、限流管瞬間」之分工 | Claude Code |
| 2026-07-28 | **v1.0** | **SHIPPED** — M1 冪等性(0015 + 全域攔截器)/ M2 per-tenant 配額(0016 + 分級限流)/ M3 metadata 車道切 app lane 使 RLS FORCE 生效 / M4 排程清理(孤兒 form + 孤兒檔實體回收 + 逾期冪等 key)/ M5 `statement_timeout` + 簽核副作用順序。**收斂之殘留全清**:core R7 · C5 · T4 · C2 · R8 · file-storage S6 · actions-approval 同 tx。api 305 + e2e 25 全綠(20 新測);FMEA L1–L7 全緩解;§3-bis 記錄 5 項實作偏離 | Claude Code |
| 2026-07-27 | v0.1 | 初版 DRAFT — 收斂 7 項跨模組 P1 殘留(core R7/C5/T4/C2/R8 · file-storage S6 · actions-approval 同 tx)。P0 = 冪等性 + per-tenant 配額 + metadata 車道 RLS 兜底 + 清理 job;outbox / 加密 / flag / circuit breaker 明確排除並附理由。OQ-REL-1..7 待裁定 | Claude Code |
