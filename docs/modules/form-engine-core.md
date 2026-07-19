# form-engine-core.md — [P0-1] 表單引擎動態 schema 核心 設計文件

> 🚧 **狀態:DRAFT — 待裁定 OQ-FEC-1..7(2026-07-19)**
>
> Weyver 的 substrate 命門:Tier-2 動態真實表引擎(metadata catalog + runtime DDL 安全鏈 + 欄位型別系統 + 記錄 DML + 租戶隔離)。docs/13 標明的**最大 risk gate(Gate P0-1)**,blocks 90% 下游模組;設計依據 docs/15 v2(兩層資料模型)+ docs/16(三家 OSS 實證)+ docs/21(多租戶)+ docs/22(威脅模型 #1 = 動態 identifier 注入)。
>
> 作者:Claude Code(草擬)
> 版本:v0.1(2026-07-19)

---

## 1. 目標與範圍

### 1.1 目標

1. **使用者(或 AI 助手)能以結構化 spec 建立表單** → 系統在 Postgres 生成真實表(runtime DDL),欄位為真實 column,可索引可約束可原生 SQL。
2. **表單可增 / 改 / 刪欄位**,metadata 與物理 schema 恆一致(provision state 機制,失敗自動清理)。
3. **記錄 CRUD 全參數綁定**,identifier 一律出自 metadata catalog(系統生成),**使用者輸入永不進入 SQL identifier 位置**。
4. **子表(header + line items)存 / 改 / 刪為單一 DB transaction**(ERP 單據骨架)。
5. **租戶隔離可證明**:自動化測試斷言「A 租戶建的表 / 記錄,B 租戶讀不到」(Testcontainers 真實 PG + RLS)。

### 1.2 對應 Stakeholder 訴求

| 子題 | 主要訴求 | 次要訴求 | 對應點 |
|---|---|---|---|
| A1 metadata catalog | ① Ragic-parity land(docs/23 R1)| ④ AI-native(docs/17)| 表單 = metadata,AI 建表助手日後吐同一結構化 spec |
| A2 型別系統 | ① | ② ERP 計算(docs/18)| 金額 = `numeric` 等物理映射正確,計算層才有地基 |
| A3 DDL 安全鏈 | ③ 資安(docs/22 威脅 #1)| ① | 動態 identifier 注入是全平台最大破口,在此一次擋死 |
| A4 記錄 DML | ① | ② | Ragic 式「自己建自己填」的「填」 |
| A5 子表 tx | ② | ① | 採購單 / 傳票 / BOM / 工單全靠 header+lines 原子性 |
| A6 租戶隔離 | ③ | — | 鐵則 3:每查詢綁租戶 + RLS FORCE;跨租戶 bleed = 事故 |
| A7 最小記錄 API | ① | — | 後續 P0-2 grid / P0-5 自動 API 的內部介面 |

### 1.3 不做的事

- ❌ **不做公式引擎**(P0-3;`field_def` 只預留 formula 欄位標記,fork Teable MIT `packages/formula` 屆時評估)
- ❌ **不做 Link & Load 載入邏輯**(P0-3;`relation_def` 表結構先建,行為不實作)
- ❌ **不做三層權限**(P0-4;本模組只做租戶隔離 + 基本 authn guard)
- ❌ **不做表單設計器 UI(S3)**(前端另立模組;本模組提供結構化 spec API,mockup 已有 `/app` 設計器視覺稿)
- ❌ **不做視圖引擎 / grid 整合 / Excel 匯入**(P0-2)
- ❌ **不做 Tier-1 ERP 實體**(Phase 2;但 Drizzle/Knex 雙軌邊界在本模組定案,Tier-1 屆時直接沿用)
- ❌ **不做 workflow / 通知 / audit UI**(P0-4;mutation 寫 audit log 的最小 hook 保留)
- ❌ **不做 schema-per-tenant(方案 D)**(docs/16 定案共享 schema;D 為日後大客戶選配,metadata 層已抽象不擋路)

---

## 2. 上游 / 既有現況走查

| 子題 | 上游現況 | Gap |
|---|---|---|
| 設計依據 | ✅ docs/15 v2 + docs/16 已定案(真實表 / 雙軌 ORM / 共享 schema + tenant_id)| 無 — 本 M0 是綜合成 buildable spec |
| Monorepo | ✅ Turborepo + pnpm(apps/web + packages/ui 已存在,前端視覺已 v2.1)| **`apps/api` 不存在** — F-1 最小骨架納入 M1 前置 |
| Auth / 租戶 context | ❌ 未做(F-2)| Better Auth + nestjs-cls + `SET LOCAL app.tenant_id` 納入 M5(最小版:單租戶 header 假造 → 測試期先行,Better Auth 完整版留 F-2)|
| Postgres / dev infra | ❌ 未做 | Docker Compose PG 16 + Testcontainers 納入 M1 |
| 型別 / 公式 OSS 參考 | ✅ docs/16 拆解完(Teable 雙軸 + visitor;MIT 可 fork 地圖)| 借鏡 pattern 自研(見 OQ-FEC-7)|

---

## 3. 剩餘 scope 切分

| 子題 | 內容 | 估算(solo + Claude Code)|
|---|---|---|
| **A1 metadata catalog** | Drizzle schema:`form_def` / `field_def` / `relation_def`(stub)+ Zod spec 型別 + migration | ~1.5 週 |
| **A2 型別系統 registry** | 雙軸 `cellValueType` / `dbFieldType` + visitor(DDL 片段 / Zod 驗證器 / 篩選運算子)× MVP 型別子集 | ~2 週 |
| **A3 動態 DDL 服務** | createForm / addField / alterField / dropField / dropForm;安全鏈 + advisory lock + provision state + 失敗清理 | ~2.5 週 |
| **A4 記錄 DML 服務** | CRUD + cursor 分頁 + 排序 / 篩選(欄位 whitelist)+ 樂觀鎖 version | ~2 週 |
| **A5 子表引擎** | `parent_id` FK + `line_no` + header+lines 單一 tx + 級聯策略 | ~1.5 週 |
| **A6 租戶隔離整合** | RLS policy template(動態表建表即掛)+ `SET LOCAL` + nestjs-cls + 隔離測試 | ~1.5 週 |
| **A7 最小記錄 API** | NestJS dynamic controller(list/get/create/update/delete)+ Swagger + e2e | ~1 週 |

**合計**:M1 spike + A1–A7 ≈ **12–14 週純 focus**;依 docs/07 月段稀釋(2026 下半 5-30% Weyver time),calendar 預期 M1 spike 落月段 A、A1–A7 落月段 B–C。

---

## 4. A1 metadata catalog(引擎的大腦)

### 4.1 資料模型(Drizzle,固定 schema,`public`)

```typescript
// form_def
{
  id: bigint (PK, identity),
  tenantId: bigint (NOT NULL, FK tenants),
  name: text,                    // 顯示名(使用者輸入,只存 metadata)
  physicalTable: text,           // 系統生成,如 "t42"(見 OQ-FEC-1)
  provisionState: 'pending' | 'ready' | 'failed',   // Teable pattern
  parentFormId: bigint | null,   // 子表:指向父表單
  version: int,                  // schema 版本(每次 DDL +1)
  createdAt / updatedAt / deletedAt: timestamptz,
}

// field_def
{
  id: bigint (PK, identity),
  formId: bigint (FK form_def),
  name: text,                    // 顯示名(使用者輸入)
  physicalColumn: text,          // 系統生成,如 "f317"
  cellValueType: text,           // 語意軸:'text' | 'number' | 'money' | 'date' | ...
  dbFieldType: text,             // 物理軸:'text' | 'numeric' | 'timestamptz' | 'jsonb' | ...
  options: jsonb,                // 型別參數(選項清單 / 小數位 / 自動編號 pattern / formula 標記)
  required: bool, unique: bool, position: int,
  createdAt / deletedAt: timestamptz,
}
```

- **relation_def / view_def / formula_def** 等其餘 metadata 表:本模組**只建 `relation_def` 空殼**(P0-3 會用到 FK 型別),其餘各自模組再建 —— 避免預先設計未驗證的結構。
- 邊界驗證:所有對外 spec(CreateFormSpec / AddFieldSpec…)= **Zod schema + `z.infer`**;顯示名長度 ≤ 100、去除控制字元。
- **AI-native 不變量(docs/17 / docs/22)**:結構化 spec 是**唯一入口** —— 設計器 UI 與日後 AI 建表助手都吐同一 `CreateFormSpec`,經同一驗證 + DDL 安全鏈;模型永不輸出 raw SQL。

### 4.2 邏輯

- catalog 讀取熱路徑(每次 DML 都要解析 physical identifier)→ 記憶體 cache(per-process Map,schema 變更時以 `form_def.version` 失效;Redis 快取為 P1 優化,見 AGENTS ⚙️)。

---

## 5. A2 型別系統 registry

### 5.1 MVP 型別子集(OQ-FEC-3 裁定範圍)

| cellValueType | dbFieldType | 備註 |
|---|---|---|
| text / longText / email / url / phone | `text` | 驗證差異在 Zod,物理同 |
| number | `numeric` | options.precision |
| **money** | **`numeric(19,4)`** | **鐵則 2:禁 float**;options.currency |
| percent | `numeric` | |
| date / datetime | `date` / `timestamptz` | |
| singleSelect | `text` | options.choices |
| multiSelect | `text[]` | |
| checkbox | `boolean` | |
| rating | `int2` | |
| autoNumber | `text` | PG sequence + pattern(交易內取號)|
| member | `bigint` | FK users(deferred 至 F-2 完成)|
| link(stub)| `bigint` | FK 行為 P0-3 |
| attachment(stub)| `jsonb` | S3 key 陣列,上傳流程 P0-2+ |
| formula(stub)| 依結果型別 | 引擎 P0-3 |
| subTable | —(反向 FK)| A5 |

### 5.2 邏輯(visitor pattern,Teable/NocoDB 借鏡)

每型別一個 registry entry:`{ cellValueType, dbFieldType, ddlFragment(knex builder), zodValidator(options), filterOperators, formatHint }`。DDL 生成與型別邏輯解耦 —— 新型別 = 加一個 entry,不改 DDL 服務。

---

## 6. A3 動態 DDL 服務(安全鏈核心)

### 6.1 安全鏈(docs/22 威脅 #1,逐環節)

```
結構化 spec(Zod 驗證)
  → physical identifier 一律系統生成(t{formId} / f{fieldId},regex ^[a-z_][a-z0-9_]{0,62}$ 斷言)
  → 使用者顯示名只存 metadata,永不成為 identifier
  → DDL 經 knex.schema builder(identifier 由 knex quote)
  → 執行於獨立 ddl_role 連線池(有 CREATE/ALTER 權;app_role 無 DDL 權、無 BYPASSRLS、不擁有表)
  → statement_timeout + advisory lock(per formId,防並發 DDL 互鎖)
  → 全程 audit log(who / spec / 生成 SQL / 結果)
```

### 6.2 建表流程(Teable pattern)

1. tx-A(metadata):寫 `form_def`(`provisionState = 'pending'`)+ `field_def` → 取得 id → 生成 physical 名。
2. DDL(不可與 metadata 同 tx,PG DDL 半交易性 + 鎖考量):`CREATE TABLE data.t{id}(...)` 含系統欄(§ 6.3)+ RLS policy(§ 9)。
3. tx-B:`provisionState → 'ready'`。
4. 任一步失敗:`DROP TABLE IF EXISTS` + `provisionState → 'failed'`(或刪 metadata);**對外只有 ready 的表可用**。孤兒清理 job 掃 `pending` 超時者。

### 6.3 動態表標準結構(每張 Tier-2 表)

```sql
CREATE TABLE data.t{formId} (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id   bigint NOT NULL,          -- 冗餘防線,見 OQ-FEC-2
  f{fieldId}  ...,                      -- 使用者欄位
  parent_id   bigint,                   -- 子表才有(FK 父表)
  line_no     int,                      -- 子表才有
  version     int NOT NULL DEFAULT 1,   -- 樂觀鎖
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  bigint NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  bigint NOT NULL,
  deleted_at  timestamptz               -- soft delete,見 OQ-FEC-5
);
```

- 動態表集中於獨立 PG schema **`data`**(catalog 整潔、備份 / 監控可按 schema 圈定);metadata 在 `public`。
- 改欄位型別:白名單安全轉換表(見 OQ-FEC-4)。

---

## 7. A4 記錄 DML 服務 + A5 子表

- **DML 全走 Knex query builder**:表名 / 欄名經 catalog 解析(查無即拒)→ knex identifier;**值一律參數綁定**(鐵則 1)。
- 篩選 / 排序:欄位名先對 catalog whitelist,運算子對型別 registry 的 `filterOperators` whitelist;拒絕任意表達式。
- cursor 分頁(id-based);回應欄位 projection(只回請求欄,P0-4 權限接手後複用)。
- 樂觀鎖:update 帶 `WHERE version = :v`,不符回 409。
- **子表 tx**:`saveWithLines(header, lines[])` 單一 transaction;lines diff(insert / update / soft-delete)+ `line_no` 重排;失敗全 rollback(鐵則 6 同源)。

---

## 8. A7 最小記錄 API

- NestJS dynamic controller:`/api/forms/:formId/records` 之 list / get / create / update / delete + `/api/forms`(建表 / 改欄)。
- 全域 ValidationPipe(whitelist + forbidNonWhitelisted)+ response DTO(禁回 DB row 原樣;AGENTS DTO 鐵則)。
- Swagger 自動文件。tRPC 留 P0-5。

---

## 9. A6 租戶隔離整合(鐵則 3)

- 動態表建表 DDL **同時生成 RLS**:`ALTER TABLE ... ENABLE ROW LEVEL SECURITY; FORCE ROW LEVEL SECURITY;` + policy `tenant_id = current_setting('app.tenant_id')::bigint`。
- 請求入口:驗證 JWT(F-2 前為測試 stub)→ nestjs-cls 存 tenant context → 每 tx 首句 `SET LOCAL app.tenant_id`(PgBouncer tx-mode 相容)。
- metadata 表(form_def 等)同樣 RLS。
- **隔離測試為硬 gate**:Testcontainers 真 PG,A 租戶建表寫記錄 → B 租戶 list / get / 直接猜 id 全部拿不到;CI fail 則 merge 擋(AGENTS CI gate 9)。

---

## 7-bis. 企業級 cross-cutting 檢核(重點節錄)

### 安全模型(本模組即威脅 #1 主戰場)

| 攻擊面 | 緩解 |
|---|---|
| 使用者輸入 → SQL identifier 注入 | identifier 全系統生成 + catalog whitelist + regex 斷言 + knex quote(§ 6.1)|
| 跨租戶 bleed(BOLA)| RLS FORCE + `SET LOCAL` + 每查詢綁租戶 + 隔離測試 gate(§ 9)|
| DDL 權限濫用 | `ddl_role` / `app_role` 分離;app_role 無 DDL / 無 BYPASSRLS / 不擁有表 |
| DDL DoS(惡意大量建表 / 加欄)| per-tenant 表數 / 欄數 quota(form ≤ N、field ≤ M,MVP 先硬編常數)+ rate limit |
| 失敗中間態 | provision state + 清理 job(§ 6.2)|

### 容量 / 失效 / 觀測(節錄)

- **表數估算**:pilot 17 家 × ~50 表單 < 1,000 張真實表 —— PG catalog 無虞;spike(M1)壓測至 10,000 張確認上限與 relcache 行為(docs/16 已知風險)。
- **失效模式**:DDL 中途失敗 → 清理 + failed 態;advisory lock timeout → 回 409 請重試;catalog cache 不一致 → version 檢查失效重讀。
- **觀測**:`ddl_operations_total{op,result}` / `ddl_duration_seconds` / `record_crud_duration_seconds` / `tenant_table_count` gauge;DDL 全量 audit log。
- **Rollout**:金額型別自始 `numeric`;migration up/down 齊;動態表不進 Drizzle migration(雙軌邊界)。

---

## 8-bis. 測試策略

| 層級 | 覆蓋 | 位置 |
|---|---|---|
| Unit | 型別 registry visitor(每型別 DDL 片段 / Zod / 運算子)、identifier 生成 regex、spec 驗證 | `*.test.ts`(Vitest)|
| Integration(**Testcontainers 真 PG**)| 建表 / 加欄 / 改型別白名單 / 失敗清理 / provision state;CRUD + 分頁 + 樂觀鎖;子表 tx 原子性;**租戶隔離(硬 gate)** | `apps/api/test/` |
| Property-based | metadata-driven:隨機生成表單 spec(fast-check)→ 建表 → CRUD 往返一致 | 同上(基礎版)|

至少:每 MVP 型別 1 組 unit + 整合主路徑 15+ 案例 + 隔離測試 4+ 案例。

---

## 9-bis. 落地順序與里程碑

| 里程碑 | 內容 | 預估 | 狀態 |
|---|---|---|---|
| **M0** 設計 review | 本檔 → APPROVED(裁定 OQ-FEC-1..7)| — | ⏳ |
| **M1** Spike + 前置 | `apps/api` NestJS 最小骨架 + Docker Compose PG16 + Testcontainers;**spike:10K 表 catalog 壓測 / 並發 DDL 鎖 / 動態表 RLS 可行性**(docs/15 §12 Gate)| 1-2 週 | ⏳ |
| **M2** A1+A2 | metadata catalog + 型別 registry + unit tests | 3 週 | ⏳ |
| **M3** A3 | DDL 服務 + 安全鏈 + provision state + 整合測試 | 2.5 週 | ⏳ |
| **M4** A4+A5 | 記錄 DML + 子表 tx + 整合測試 | 3 週 | ⏳ |
| **M5** A6 | 租戶隔離整合 + 隔離測試 gate | 1.5 週 | ⏳ |
| **M6** A7 | 最小 REST API + e2e + Swagger | 1 週 | ⏳ |
| **M7** FMEA + 收尾 | §12 FMEA(P0 全清才 SHIPPED)+ SOP + MODULES.md ✅ | 2-3 天 | ⏳ |

**M1 spike 為 Gate**:catalog 壓測或 RLS 動態表任一不過 → 回 M0 修設計(fallback = schema-per-tenant 選配提前,或表數 quota 收緊),不硬闖。

---

## 10. 開放問題(OQ-FEC-N)— 待裁定

| # | 訴求 | 議題 | 選項 | 建議 |
|---|:-:|---|---|---|
| **OQ-FEC-1** | ③① | Tier-2 物理命名策略? | A. **系統生成 opaque**(`t{formId}` / `f{fieldId}`,顯示名只存 metadata;rename = 改 metadata 零 DDL) <br> B. 語意 slug(`po_orders.supplier_name`,可讀但 rename 觸發 DDL + 注入面擴大) | **A** — Baserow/Teable 共同做法;identifier 注入面直接消失(無使用者字元)、rename 免鎖表。DBA 可讀性用 view 或 comment 補 |
| **OQ-FEC-2** | ③ | 動態表本已 per(租戶×表單),還要 `tenant_id` 欄 + RLS 嗎? | A. **要**:每表帶 `tenant_id` + RLS FORCE(統一防線與查詢路徑) <br> B. 不要:表級歸屬即隔離,省欄位(app 層擋) | **A** — 鐵則 3 字面要求;防「拿到別租戶 formId 就能查」的 BOLA;成本僅一欄一 policy,且未來如併表(共享大表)不需改防線 |
| **OQ-FEC-3** | ① | 型別 MVP 子集? | A. **§5.1 之 ~15 型別**(含 4 個 stub),其餘 P1-I 補 <br> B. 30+ 一次做齊 | **A** — 覆蓋鮮勇常用表單 90%+;registry 架構讓補型別 = 加 entry,後補無重構成本 |
| **OQ-FEC-4** | ①② | 改欄位型別策略? | A. **保守白名單**:安全轉換(text→longText、int→numeric 等)允許,有損轉換拒絕(提示建新欄搬資料) <br> B. 寬鬆 `ALTER ... USING` 盡量轉 <br> C. shadow column + backfill | **A** — MVP 資料安全優先;B 的靜默截斷 / 轉換失敗難解釋;C 工程大,留 scale 階段 |
| **OQ-FEC-5** | ①② | 記錄刪除策略? | A. **soft delete**(`deleted_at`,查詢預設過濾;回收桶 UI 後補) <br> B. hard delete + audit log 留痕 | **A** — Ragic 有回收桶(parity);ERP 溯源要求;儲存成本可後續清理 job 處理 |
| **OQ-FEC-6** | ③ | DDL 執行模型? | A. **請求內同步** + per-form advisory lock + statement_timeout <br> B. 佇列化(BullMQ)全 serialize | **A** — MVP 表單建立是低頻互動操作,同步 UX 直接;lock + timeout 已擋並發風暴;B 留 scale(spike 若見鎖問題則升 B) |
| **OQ-FEC-7** | ①③ | Teable MIT packages 現在 fork 嗎? | A. **P0-1 純借鏡自研**(雙軸 + visitor pattern 照概念,不搬 code);P0-3 公式時再評估 fork `packages/formula` <br> B. 現在就 fork `packages/core` 型別模型 | **A** — P0-1 型別 registry 自研量可控(~2 週);fork 需逐檔驗 MIT header + 與 Teable backend 解耦成本不明;把 fork 決策推遲到收益最大處(公式引擎,省數月) |

---

## 11. SOP — 日常操作

> M7 收尾時補齊(操作指引 / 失敗模式排查 / 審計 SQL)。預留:孤兒表清理 job 操作、provision failed 排查、隔離測試手動重跑。

---

## 12. 失效場景反思(FMEA)— M7 收尾必填(R17)

> M7 前不填。屆時逐路徑(建表 / 改欄 / CRUD / 子表 tx / 並發 DDL / 部署順序)列失效 → 嚴重度 → 緩解;**任一 P0 未 ✅ 不得標 SHIPPED**。

---

## 13. 變更紀錄

| 日期 | 版本 | 變更 | 作者 |
|---|---|---|---|
| 2026-07-19 | v0.1 | 初版 DRAFT — A1–A7 切分 + OQ-FEC-1..7;綜合 docs/15 v2 / docs/16 / docs/21 / docs/22 成 buildable spec | Claude Code |
