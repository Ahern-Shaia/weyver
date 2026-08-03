# form-engine-core.md — [P0-1] 表單引擎動態 schema 核心 設計文件

> 🚢 **狀態:SHIPPED v1.0(2026-07-19)— M0–M7 全完成;§12 FMEA P0 全清(12 項 ✅),殘留 6 項 P1/P2 歸屬明確**
> ⚠️ SHIPPED = 模組核心正確性達標(59 tests + live smoke);**對外上 prod 前提 = F-2 auth + §12.7 可靠性 checklist**
>
> Weyver 的 substrate 命門:Tier-2 動態真實表引擎(metadata catalog + runtime DDL 安全鏈 + 欄位型別系統 + 記錄 DML + 租戶隔離)。docs/13 標明的**最大 risk gate(Gate P0-1)**,blocks 90% 下游模組;設計依據 docs/15 v2(兩層資料模型)+ docs/16(三家 OSS 實證)+ docs/21(多租戶)+ docs/22(威脅模型 #1 = 動態 identifier 注入)。
>
> 作者:Claude Code(草擬)
> 版本:v1.1(2026-07-19)

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

## 2-bis. 巨人的肩膀:企業級 metadata 平台做法對照(2026-07-19 web 研究,retrospective 補)

> ⚠️ **2026-08-03 稽核附註|本節是 retrospective 自評,結論的可靠度結構性偏高。**
> 同日(2026-07-19)以相同形態補寫的 §2-bis 共四份
> (`form-engine-core` / `form-designer-ui` / `grid-and-excel-import` / `formula-and-linkload`),
> 其中兩份的結論已被後續的 0-bis 推翻。**成因不是不用功,是問題設錯了** ——
> 第一輪 retrospective 問的是「我當初選對了嗎」,而那個問題的答案幾乎必然是「對」。
> 該問的是「**這個套件 / 這個競品在這一題附近還給了什麼我沒用到的**」。
> 依 `_template.md` §0.4:**禁寫「無向上缺口」這類終局結論。**
> 稽核見 `docs/modules/_audit/giants-shoulders-audit-A.md`。


> docs/16 是 **OSS 同類**(Baserow/NocoDB/Teable)的實證;此節補上**企業級 metadata 平台**的對照,並把 Weyver 選「每表單真實表」這個**刻意架構分叉**與其 scaling 天花板明文化。

> 🔴 **2026-08-03 稽核補:出處與查證日期(原本一條都沒有)。**
> 下表三列的來源性質差異很大,混在同一張表裡看不出來,故先分清:
>
> | 列 | 來源性質 | 出處狀態 |
> |---|---|---|
> | Salesforce flex-column / `MT_Data` | 公開白皮書與開發者文件之**二手綜述** | ⚠️ **無 URL,未查證** —— 屬「業界常識級」描述,但本專案規則是**常識也要有出處**,故不得作為承重依據。要承重須補 Salesforce multitenant architecture 官方白皮書逐字 |
> | Microsoft Dataverse「混合」 | 同上,且措辭更概括(「部分虛擬化」未指明何種) | ⚠️ **未查證** |
> | PG table-count 天花板 ~1,000–2,000 | 二手引用 PlanetScale / Citus | ⚠️ **無 URL**,但**本專案已自行實測**(M1 spike:10,000 張表 catalog 近線性 ×1.22)—— **實測是比引用更強的依據**,故此列的結論改以自家實測承重,外部數字降為旁證 |
>
> **不影響既有裁定**:選「每表單真實表」的理由是**計算層需要真型別 / 索引 / 約束**(自家論據),
> 不是靠上表任何一列成立。上表的作用是說明「另一條路長什麼樣」,而那一層用途容得下未查證。
> 但依〈向上設計三條〉條件 ①,**未查證就不得升格為承重**,故明文標註。


| 系統 | 動態 schema 手法 | 對 Weyver 的意義 |
|---|---|---|
| **Salesforce Force.com**(企業 metadata 平台典範)| **flex-column / EAV**:`MT_Objects` / `MT_Fields` metadata 表 + **單一共享 `MT_Data` 寬表**,自訂欄位映射到預留的泛型 flex 欄(非真實欄 / 真實表);型別、picklist、formula、master-detail 全存 metadata | **Weyver 選了相反路**:每表單一張**真實 PG 表**(Teable/Baserow pattern)。取捨↓ |
| **Microsoft Dataverse**（低碼資料平台）| 混合:標準實體真實表 + 自訂欄部分虛擬化 | 佐證「真實表可行」但大規模自訂走抽象層 |
| **PostgreSQL 多租戶文獻**(PlanetScale / Citus)| schema-per-tenant / table-per-tenant **過 ~1,000–2,000 個** → `pg_class` catalog bloat、planner 變慢、migration 拖慢;shared-schema + RLS 才可到十萬租戶 | **Weyver 的 table-count 天花板來源**;已在 M1 spike 實測 |

**核心架構決策(明文化)**|Weyver Tier-2 = **每表單一張真實表(共享 schema + `tenant_id` + RLS)**,而非 Salesforce 式 flex-column。

- **為何選真實表(勝 flex-column)**|真 SQL 型別 / 真索引 / 真約束 / 每表查詢效能佳;**「算」計算層(docs/18)需要真實欄位**才能過帳 / 估值;且 Weyver 租戶規模是**數百**(食品 / 團膳 SMB),非 Salesforce 的數百萬 → 不需 flex-column 的極端抽象。
- **代價(Salesforce 用 flex-column 正是為了避開它)**|**`pg_class` table-count 天花板**——表數 = 全租戶 × 各自表單數。**M1 spike 實測:10,000 張表 catalog 近線性 ×1.22**(可接受);pilot 17 家 × ~50 表 < 1,000 張,無虞。
- **⚠️ 明確 revisit trigger**|當**全域真實表數逼近 ~10–20K**(大量租戶 × 大量表單)時,需啟動緩解:低用量表走**共享寬表 + flex-column overflow**(退化為 Salesforce 式)、表合併 / 分區,或 **Citus 分片**。**pilot / early 階段不需**,但列為已知 scaling 路線,不是「撞到才想」。

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

- **表數估算**:pilot 17 家 × ~50 表單 < 1,000 張真實表 —— PG catalog 無虞;spike(M1)壓測至 10,000 張確認上限與 relcache 行為(docs/16 已知風險)。**scaling 天花板與 revisit trigger(~10–20K 表)+ 與 Salesforce flex-column 之取捨見 § 2-bis**。
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
| **M1** Spike + 前置 | Docker Compose PG16 + **spike S1/S2/S3(10K 表 catalog / 並發 DDL 鎖 / 動態表 RLS)** → § 9-ter | 1-2 週 | ✅ **Gate 通過 2026-07-19**(`apps/api` 骨架 + Testcontainers 移 M2 開頭)|
| **M2** A1+A2 | `apps/api` NestJS 骨架 + Testcontainers + metadata catalog + 型別 registry + unit tests | 3 週 | ✅ 2026-07-19(ca1d107;22 tests 全過)|
| **M3** A3 | DDL 服務 + 安全鏈 + provision state + 整合測試 | 2.5 週 | ✅ 2026-07-19(b14c211;34 tests)|
| **M4** A4+A5 | 記錄 DML + 子表 tx + 整合測試 | 3 週 | ✅ 2026-07-19(f1c41e8;44 tests)|
| **M5** A6 | 租戶隔離整合 + 隔離測試 gate | 1.5 週 | ✅ 2026-07-19(b01ba2b;50 tests,BOLA killer 過)|
| **M6** A7 | 最小 REST API + e2e(Swagger → P0-5 zod-openapi,deviation)| 1 週 | ✅ 2026-07-19(e48cdac;59 tests + live smoke)|
| **M7** FMEA + 收尾 | §12 FMEA(P0 全清才 SHIPPED)+ SOP + MODULES.md ✅ | 2-3 天 | ✅ 2026-07-19(P0 12 項全清;殘留 6 項 P1/P2 歸屬 §12.7)|

**M1 spike 為 Gate**:catalog 壓測或 RLS 動態表任一不過 → 回 M0 修設計(fallback = schema-per-tenant 選配提前,或表數 quota 收緊),不硬闖。

---

## 9-ter. M1 Spike 結果(2026-07-19,本機 OrbStack PG16)

> Spike code:`spikes/p01-dynamic-schema/`(throwaway 驗證碼,非 production)。

### S3|動態表 RLS FORCE 隔離 — ✅ 全過(8 斷言)

app 角色只見自己租戶 / WITH CHECK 擋跨租戶寫入 / 無 context → 0 列 / 跨租戶 UPDATE·DELETE → 0 affected / **owner 在 FORCE 下同受 RLS** / superuser 對照可見全部(⇒ app·migration 角色禁 superuser·BYPASSRLS,鐵則 3 佐證)。

**兩個 production 級發現(直接進 A3/A6 實作規格)**:
1. **`SET LOCAL` 不可參數綁定** → 一律 `SELECT set_config('app.tenant_id', $1, true)`(交易範圍等價,可參數化)。
2. **custom GUC 於 session 內 set 過後,reset 值為 `''` 而非 NULL** → `''::bigint` 炸 22P02(連線池下必踩)。**policy 標準寫法:`tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint`**(空值 → policy false → 乾淨 deny,fail-closed)。

### S2|並發 DDL — ✅ 過(advisory lock 開銷可忽略)

| 情境 | 結果 |
|---|---|
| 異表並行 10 × ADD COLUMN | ~20ms,互不阻塞 |
| 同表並發 10 × ADD COLUMN(無 lock)| ~18ms,PG 自行排 ACCESS EXCLUSIVE 隊 |
| 同表並發 + `pg_advisory_xact_lock(formId)` | ~33ms,序列化開銷 ~10ms 可忽略 → **OQ-FEC-6 = A 成立** |
| **rewrite 型 DDL(volatile DEFAULT)期間讀者延遲** | 200K 列表 p50 ~248ms / worst ~289ms — 讀者被 rewrite 持鎖擋住 |

**規格影響**:A3 DDL 服務**禁止 rewrite 型 DDL 於線上表** —— 加欄一律 nullable、無 volatile default(預設值由 app 層 / 非 volatile 常數處理,PG11+ 免 rewrite);改型別走 OQ-FEC-4 白名單(免 rewrite 的轉換)。

### S1|10K 表 catalog 壓測 — ✅ 過(近線性,無 catalog 瓶頸)

| 指標 | 結果 |
|---|---|
| 10,000 表(各 ~12 欄 + RLS policy + tenant index)建置 | 135.6s 總計;**per-table 12.3ms(前段)→ 15.0ms(末段),衰退僅 ×1.22** — 近線性 |
| catalog 膨脹 | pg_class 60K 列(18 MB)/ pg_attribute 413K 列(80 MB)/ pg_policy 10K 列;**DB 總 505 MB ≈ ~50 KB/空表固定成本**(PK index + tenant index + toast)|
| 查詢 plan(第 9999 張表)| cold 0.4ms / warm 0.3ms — **relcache 無退化** |
| `pg_tables` 全 schema 列表 | 13.7ms @ 10K 表 |

**規格影響**:pilot 規模(17 家 × ~50 表 ≈ 2K 表含子表)距 10K 驗證上限有 5 倍餘裕;**per-tenant 表數 quota(7-bis DDL DoS 緩解)以 ~50 KB/表固定成本計價**;fallback(schema-per-tenant)無需啟動。

### Gate P0-1 Spike 判定 — ✅ **通過**(2026-07-19)

S1 catalog / S2 並發 DDL / S3 RLS 隔離全過,依 § 9-bis Gate 判準**進入 M2 正式開發**。docs/16 § 2 之「三家未公布表數上限」已知風險就此關閉(至 10K 實測)。

---

## 10. 開放問題(OQ-FEC-N)— ✅ 已裁定(2026-07-19,全採建議)

| # | 議題 | 裁定 | 落地影響 |
|---|---|---|---|
| **OQ-FEC-1** | Tier-2 物理命名 | **A 系統生成 opaque** | physical = `t{formId}` / `f{fieldId}`;顯示名只存 metadata,rename 零 DDL;regex 斷言為雙保險而非主防線 |
| **OQ-FEC-2** | 動態表 tenant_id + RLS | **A 要** | § 6.3 標準結構含 `tenant_id`;建表 DDL 同步掛 RLS FORCE policy;隔離測試為 CI 硬 gate |
| **OQ-FEC-3** | 型別 MVP 子集 | **A ~15 型別** | § 5.1 清單為 M2 實作範圍(含 link / attachment / formula / member 4 stub);其餘 P1-I 加 registry entry |
| **OQ-FEC-4** | 改欄位型別 | **A 保守白名單** | A3 實作安全轉換對照表;有損轉換回 422 + 指引「建新欄搬資料」 |
| **OQ-FEC-5** | 刪除策略 | **A soft delete** | 標準結構含 `deleted_at`;DML 預設過濾;回收桶 UI 後補(P1-I);清理 job 留 Ops |
| **OQ-FEC-6** | DDL 執行模型 | **A 同步 + advisory lock** | per-form `pg_advisory_xact_lock` + statement_timeout;spike S2 驗證;若見鎖風暴升 BullMQ(介面不變) |
| **OQ-FEC-7** | fork Teable 時點 | **A P0-1 純借鏡自研** | 雙軸 + visitor 照概念自寫;P0-3 公式引擎時逐檔驗 MIT 再議 fork;clean-room log 自 M2 起記錄 |

---

## 11. SOP — 日常操作

### 11.1 本機啟動

1. `docker compose up -d postgres`(OrbStack;PG16 @ :5433)
2. `cd apps/api && pnpm db:migrate`(**migration 必先於 app 啟動** — 0003 建 `weyver_app` 角色,DdlService 建表 GRANT 依賴它)
3. 首次需種租戶:`docker exec weyver-pg psql -U weyver -d weyver -c "INSERT INTO tenants (name) VALUES ('dev 廠')"`
4. `PORT=3001 pnpm dev`(3000 常被 web dev 佔用)→ `curl :3001/health`
5. API 呼叫帶 `x-dev-tenant: <id>`(F-2 前 dev stub;production 直接 403)

### 11.2 失敗模式排查

| 症狀 | 含意 | 處置 |
|---|---|---|
| form 卡 `pending` 很久 | provision 中途 crash(metadata 已寫、DDL 未完成)| 查 `ddl_audit` 該 formId;確認 `data.t{id}` 不存在後手動 `UPDATE form_def SET provision_state='failed'`;清理 job 落地前為手動 |
| form `failed` | DDL 失敗(常見:同名物理表殘留)| 看 `ddl_audit.error_message`;`DROP TABLE IF EXISTS data.t{id}` 後重建表單 |
| API 409 `VERSION_CONFLICT` | 樂觀鎖:資料已被他人改 | 前端重新載入記錄再送;非系統故障 |
| API 401 `TENANT_REQUIRED` | 缺 `x-dev-tenant` header | 補 header;F-2 後改 JWT |
| API 403 `AUTH_NOT_CONFIGURED` | production 環境跑 dev guard | 預期行為(fail-closed);接 F-2 才可對外 |
| app 車道 `permission denied` | `weyver_app` grants 缺(migration 0003 未跑 / 新表未 GRANT)| 跑 migration;確認 `ddl_audit` 該表 GRANT 語句有出現 |

### 11.3 審計查詢

```sql
-- 最近 7 天 DDL 操作(含失敗)
SELECT created_at, tenant_id, form_id, action, result, error_message
FROM ddl_audit WHERE created_at > now() - interval '7 days' ORDER BY created_at DESC;

-- 孤兒 pending(> 10 分鐘未完成 → 需人工 / 清理 job 處理)
SELECT id, tenant_id, name, created_at FROM form_def
WHERE provision_state = 'pending' AND created_at < now() - interval '10 minutes';

-- 租戶表數(quota 監控)
SELECT tenant_id, count(*) FROM form_def WHERE deleted_at IS NULL GROUP BY tenant_id;

-- RLS 覆蓋檢查:data schema 內未 FORCE RLS 的表(應為 0)
SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'data' AND c.relkind = 'r' AND NOT c.relforcerowsecurity;
```

### 11.4 隔離測試手動重跑(CI gate 同源)

`cd apps/api && pnpm exec vitest run test/tenant-isolation.integration.test.ts`

---

## 12. 失效場景反思(FMEA)— ✅ 已填(2026-07-19,M7)

> 嚴重度:`P0` = 核心流程不能走 / 資料毀損 / 跨租戶外洩;`P1` = 資料髒 / 可繞過 / 體驗差;`P2` = 邊角。
> 狀態:✅ 已處理|⚠️ 已知殘留(為何可忍 + 治本方向)|🔒 被外部 gate 擋。
> **判定:P0 全 ✅ → 可標 SHIPPED。**「SHIPPED = 模組核心正確性達標」≠「可上 prod 對外」——上 prod 另需 § 12.3 之 F-2 / 可靠性清單。

### 12.1 建表 provision(POST /api/forms)

| # | 場景 | 行為 | 狀態 | Sev |
|---|---|---|---|---|
| C1 | 使用者輸入進入 SQL identifier(注入)| 不可能:identifier 全系統生成(DB generated column)+ regex 斷言 + knex quote;測試覆蓋注入形狀 | ✅ | P0 |
| C2 | metadata 寫入後、DDL 前 crash | form 卡 `pending`,對外不可用(僅 ready 可用)→ 無資料損毀 | ✅ **【2026-07-28 已清】** F-6 M4 排程清理:逾 24h 之 `pending` 標 `failed` 並寫 `ddl_audit`(不刪,保留供查因)| P1 |
| C3 | DDL 成功、markProvisioned 前 crash | 物理表存在 + metadata pending;重 provision 撞名 → 失敗路徑 DROP IF EXISTS 冪等清掉 + failed;無使用者資料在內 | ✅ | P1 |
| C4 | 並發同名建表 | `(tenant_id, name)` partial unique index 擋,一成一敗 | ✅ | P1 |
| C5 | 惡意大量建表(DDL DoS)| per-tenant 配額 + 分級限流 | ✅ **【2026-07-28 已清】** F-6 M2:`tenants` 三欄可調配額(表數/欄數/記錄數,NULL=系統預設)+ 建表 20/min·加欄 60/min `@Throttle`;超限 403 `QUOTA_EXCEEDED` | P1 |
| C6 | 子表指向他租戶 / 未 ready 父表 | readyParentTable 租戶內查 + 狀態檢查,拒 | ✅ | P0 |

### 12.2 schema 變更(addField / alterFieldType / dropField)

| # | 場景 | 行為 | 狀態 | Sev |
|---|---|---|---|---|
| S1 | ALTER 失敗(鎖超時 / 型別衝突)| metadata 回收(hardDelete)+ audit failed;表回原狀 | ✅ | P1 |
| S2 | 並發 addField 同表 | advisory lock 序列化(整合測試 5 並發全成)| ✅ | P1 |
| S3 | rewrite 型 DDL 鎖死線上讀者 | 禁止:加欄一律 nullable 無 default(測試斷言全型別)| ✅ | P0 |
| S4 | 有損型別轉換毀資料 | OQ-FEC-4 白名單(物理 no-op 才准),其餘 422 | ✅ | P0 |
| S5 | dropField 後歷史資料遺失 | metadata soft-delete、物理欄保留(資料完整;清理 job 之後收)| ✅ | P1 |

### 12.3 記錄 CRUD / 子表(records API)

| # | 場景 | 行為 | 狀態 | Sev |
|---|---|---|---|---|
| R1 | 跨租戶讀 / 寫(BOLA)| app WHERE + RLS FORCE 雙防線;**app 車道無 WHERE 的 raw 查詢實測不洩漏**(BOLA killer 測試)| ✅ | P0 |
| R2 | 無租戶 context | RLS `NULLIF` → 0 列 fail-closed(非報錯洩訊)| ✅ | P0 |
| R3 | 並發更新互蓋 | 樂觀鎖 version → 409;**殘留:saveWithLines header 未帶 expectedVersion 時為 last-write-wins**(API 端 expectedVersion optional)| ✅(⚠️ P2 殘留:前端 M 系列強制帶版本)| P1 |
| R4 | 金額以 float 進入 | money = 十進位字串 regex,float 直接 422(測試)| ✅ | P0 |
| R5 | 子表部分寫入(header 成 lines 敗)| 單一 tx 全 rollback(測試斷言)| ✅ | P0 |
| R6 | LIKE / filter 注入 | 欄名 catalog whitelist + 運算子型別 whitelist + LIKE escape(`%` 注入測試)| ✅ | P0 |
| R7 | **HTTP retry 重複建記錄(冪等性)** | `Idempotency-Key` 標頭(選填)+ `idempotency_key` 表 | ✅ **【2026-07-28 已清】** F-6 M1 全域攔截器:同 key 重放回首次結果、不同 body 422、併發 409、失敗釋放、24h 逾期可再用 | P1 |
| R8 | 大表慢查詢拖垮 app 車道 | cursor 分頁 + limit 200 上限 + **連線建立時 `SET statement_timeout = '30s'`** | ✅ **【2026-07-28 已清】** F-6 M5:`createAppKnex` 之 pool `afterCreate` 設定;報表類長查詢日後走 read replica 而非放寬此值 | P2 |

### 12.4 租戶 context / 認證

| # | 場景 | 行為 | 狀態 | Sev |
|---|---|---|---|---|
| T1 | production 無真 auth 裸奔 | DevTenantGuard 於 production **fail-closed 403**(e2e 未測 prod env,程式碼路徑單純)| ✅(🔒 對外服務被 F-2 gate 擋 — 本模組刻意不解)| P0 |
| T2 | dev header 偽造租戶 | dev-only 已知限制(等價於拿到 DB 憑證);F-2 換 JWT 真實來源 + 剝 client header(鐵則 3)| ✅(dev scope)| P1 |
| T3 | GUC reset `''` 炸查詢(連線池)| policy `NULLIF` 標準寫法(spike S3 發現→全 policy 落地)| ✅ | P0 |
| T4 | metadata 車道(Drizzle)仍為特權憑證 | app 層 WHERE tenant_id + **RLS 兜底** | ✅ **【2026-07-28 已清】** F-6 M3:`form_def`/`field_def`/`formula_def`/`relation_def` 讀寫改走 `TenantDb.withTenant`(app 車道 + `app.tenant_id`)→ 既有 RLS FORCE 真正生效;以非 superuser 角色斷言「漏寫 WHERE 也不外洩」 | P1 |

### 12.5 audit / 觀測

| # | 場景 | 行為 | 狀態 | Sev |
|---|---|---|---|---|
| A1 | audit 寫入失敗掩蓋原錯 | try/catch 只記 stderr,原錯照拋 | ✅ | P1 |
| A2 | 錯誤回應洩 stack / DB 原文 | 統一信封,未預期錯誤只回 correlationId(e2e 斷言)| ✅ | P0 |
| A3 | 無 metrics(§7-bis 之 ddl_operations_total 等)| ⚠️ 殘留:ddl_audit 表可查但無 Prometheus;治本 = P0-10 監控 sprint(GlitchTip + metrics)| ⚠️ | P2 |
| A4 | ddl_audit 無 retention | ⚠️ 殘留:量小(DDL 低頻);清理 job 一併處理 | ⚠️ | P2 |

### 12.6 部署順序

| # | 場景 | 風險 | 緩解 |
|---|---|---|---|
| D1 | app 先於 migration 0003 啟動 | DdlService 建表 `GRANT TO weyver_app` 失敗 → 建表全掛 | **migration 必先**(SOP 11.1 順序;CI/CD 落地時 pipeline 強制)|
| D2 | 多實例同時跑 migration | drizzle migrator 有 lock 表 | ✅ drizzle 內建 |

### 12.7 不在本模組 scope 修的 pre-existing / 後續 backlog

- **F-2 Better Auth + JWT + nestjs-cls**(T1/T2/T4 治本)— 下一個 M0 模組;**對外上線的硬前提**
- ~~**idempotency key**(R7)+ **清理 job**(C2/A4)+ **per-tenant quota + throttler**(C5)~~ → **2026-07-28 已由 [F-6 平台可靠性工程](../foundation/reliability.md) SHIPPED**;**helmet/CORS** 仍列 pilot 上線前 checklist
- **metadata 快取**(§4.2 form_def version 失效)— DML 熱路徑優化,量測後再做
- **zod-openapi**(M6 deviation)— P0-5 API sprint

> **檢查點:P0 全數 ✅(C1/C6/S3/S4/R1/R2/R4/R5/R6/T1/T3/A2)→ 可標 SHIPPED。**
> ⚠️ 原殘留 6 項(C5/R7/R8/T4/A3/A4)—— **2026-07-28 C5/R7/R8/T4 已由 F-6 平台可靠性工程清除**;A3/A4 仍為 P1/P2。**「SHIPPED」≠「可對外上 prod」— 對外前提 = F-2 + § 12.7 可靠性 checklist**。

---

## 13. 變更紀錄

| 日期 | 版本 | 變更 | 作者 |
|---|---|---|---|
| 2026-07-19 | v0.1 | 初版 DRAFT — A1–A7 切分 + OQ-FEC-1..7;綜合 docs/15 v2 / docs/16 / docs/21 / docs/22 成 buildable spec | Claude Code |
| 2026-07-19 | v0.2 | OQ-FEC-1..7 全採建議裁定;狀態 DRAFT → APPROVED;進 M1 spike(OrbStack 本機容器環境就緒)| Claude Code |
| 2026-07-19 | v0.3 | **M1 spike 完成,Gate P0-1 通過**(§ 9-ter:S1 10K 表近線性 ×1.22 / S2 advisory lock 開銷可忽略·禁 rewrite 型 DDL / S3 RLS 8 斷言全過 + set_config 參數化 + NULLIF policy 兩發現);api 骨架移 M2 | Claude Code |
| 2026-07-19 | v1.1 | **retrospective 補企業級 giants 對照(§ 2-bis)**:Salesforce flex-column/MT_Data · Dataverse · PG 多租戶 catalog bloat 文獻;明文化「每表單真實表 vs flex-column」架構分叉之取捨(選真實表:真型別/索引/約束 + 計算層需真欄;代價 pg_class table-count 天花板,M1 已實測 10K×1.22)+ **revisit trigger ~10–20K 表→ flex overflow / 分片**;§ 7-bis 容量交叉引用。**不改實作**(SHIPPED 不變),純設計文件強化 | Claude Code |
| 2026-07-19 | v1.0 | **M2–M7 全 SHIPPED**(M2 catalog+型別 ca1d107 / M3 DDL 鏈 b14c211 / M4 DML+子表 f1c41e8 / M5 隔離 b01ba2b / M6 API e48cdac);59 tests + dev live smoke;§11 SOP + **§12 FMEA(P0 12 項全 ✅;殘留 C5/R7/R8/T4/A3/A4 歸屬 §12.7)**;M6 deviation:Swagger→zod-openapi(P0-5);狀態 APPROVED → **SHIPPED v1.0**(≠ 可對外上 prod,前提 F-2 + 可靠性 checklist)| Claude Code |
