# OSS Ragic 等價品技術拆解(Baserow / NocoDB / Teable)

> **文件性質**|A-1 研究產出。拆解三個 OSS「現代 Ragic」平台的**動態 schema 實作、grid、公式引擎、多租戶、授權**,用來 de-risk `docs/15 表單引擎技術設計` 並決定可復用 / 借鏡 / 避開。
> **研究方法**|2026-07-18 三個 agent 平行深挖官方 docs + GitHub 原始碼 + DeepWiki + 技術部落格(source file 級驗證)。
> **配套**|docs/15(表單引擎設計)+ docs/11(技術棧 v7)+ docs/10(Ragic 分析)。
> **版本**|2026-07-18 v1

---

## 0. TL;DR(三個決定性結論)

1. **動態 schema = 真實 Postgres 表 + runtime DDL,三家完全一致** —— 沒有一家用 EAV / 純 JSONB。**docs/15「真實表」方向驗證通過,而且是產業共識。**
2. **Teable 解了我們的難題**|`Prisma(只管固定 metadata 表)+ Knex(管動態使用者表 DDL/DML)` **雙軌** —— 直接回答「Prisma 需要靜態 schema 怎麼辦」。**照抄這個 pattern。**
3. **可復用地圖清楚**|**Baserow 核心 MIT + Teable `packages/*` MIT(含公式 ANTLR 文法 + canvas grid SDK)可 fork**;Teable backend(AGPL)/ NocoDB(Sustainable Use)只能學不能用。→ **公式引擎 + canvas grid 可能省數月。**

---

## 1. 三家對照表

| 維度 | **Baserow** | **NocoDB** | **Teable** ⭐ |
|---|---|---|---|
| Backend | Python / Django | **TS / NestJS** + Knex | **TS / NestJS + Prisma + Knex** |
| Frontend | Nuxt/Vue | Nuxt/Vue | **Next.js/React + TanStack Query + Zustand** |
| DB | Postgres | Postgres/MySQL/… | Postgres |
| **動態 schema** | 真實表 + runtime DDL(欄 = `field_{id}`)| 真實表 + runtime DDL(雙庫)| 真實表 + runtime DDL(Prisma+Knex 雙軌)|
| **公式求值** | **物化**(編譯成 SQL 存真實欄)| **讀時算**(runtime SQL)| **預設讀時算 + 可選物化**(PG generated column)|
| 公式引擎 | ANTLR 文法 → Py+JS parser | jsep AST → dialect SQL | **ANTLR 文法(MIT,可 fork)** |
| **Grid** | DOM 虛擬化 | **Canvas**(從 DOM 遷移)| **Canvas**(雙緩衝,MIT 可 fork)|
| 多租戶 | shared schema + app 層 scoping | shared + workspace metadata | **shared schema + row-level(baseId/spaceId FK)** |
| 關聯 | M2M junction 表 | LTAR(hm/bt/mm/oo)+ FK/junction | link + junction(`__order`)+ Lookup/Rollup 存 JSONB |
| Realtime | Django Channels/WS | — | **ShareDB + OT over WS** |
| **授權** | **核心 MIT** / premium·enterprise 商用 | **Sustainable Use**(source-available)| **apps AGPL / `packages/*` MIT** / EE 商用 |
| 可復用? | ✅ **核心可 fork** | ❌ 只能學 | ⚠️ **MIT packages 可 fork,backend 只能學** |

---

## 2. 核心驗證|動態 schema 的儲存策略

**三家都是「每個使用者表 = 一張真實 Postgres 表,欄位 = 真實 column,建 / 改表跑 runtime DDL」。** 沒有 EAV、沒有純 JSONB。

- **Baserow**|欄命名 `field_{id}`(改名只動 metadata,不 DDL);Django `schema_editor` 執行 `CREATE/ALTER TABLE`;請求時用 `type()` 動態生成 Django model(記憶體 hack)。
- **NocoDB**|雙庫:metadata(`nc_models_v2` / `nc_columns_v2`)+ 真實資料表;`SqlMgr` 執行 DDL;「True Data Reflection」保證 schema 與 UI 1:1。
- **Teable**|`table.service.ts` `createDBTable()` → 產生 physical `dbTableName`(隨機後綴防撞)→ 寫 `table_meta` 映射 logical id → physical + `provisionState`(pending→ready)→ `knex.schema.createTable(...)` + `$executeRawUnsafe`;失敗 `dropTable()` 清理。型別轉換 `ALTER COLUMN ... USING`。

**共同 scaling 警告(三家都沒公布硬上限,列為已知風險)**|一租戶一表 → 表數隨使用者表增長,高租戶量時 Postgres catalog 膨脹 + relcache 壓力;`ALTER TABLE` 取鎖(加 nullable 欄在 PG11+ 便宜)。→ **這正是 docs/15 §12 P0-1 spike 要壓測的點。**

→ **對 docs/15 的驗證**|方案 A(EAV)/ B(純 JSONB)被三家一致否決;**真實表是對的**。

---

## 3. Teable 解了「Prisma vs 動態 schema」難題(照抄)

**這是本研究對 Weyver 最直接的貢獻。** Teable 的做法:

```
┌─ Prisma(靜態 schema)────────────┐   ┌─ Knex / raw SQL(動態)──────────┐
│ 只管固定 metadata 表:            │   │ 使用者建的表(不進 Prisma schema)│
│ table_meta / field / view /      │──►│ knex.schema.createTable(...)     │
│ space / record bookkeeping …     │   │ + dataPrisma.$executeRawUnsafe   │
│ → Prisma migrate 乾淨可控        │   │ logical id ↔ physical dbTableName│
└──────────────────────────────────┘   └──────────────────────────────────┘
```

- **Prisma(或 Drizzle)只擁有固定表**(metadata + Weyver Tier 1 系統 ERP 實體)→ schema 乾淨、可 migrate。
- **動態使用者表(Tier 2)走 Knex / Kysely / raw SQL 平行車道**,用 metadata catalog 驅動,永不進 ORM schema。
- **欄位雙軸模型**|`cellValueType`(語意:String/Number/Boolean/DateTime)vs `dbFieldType`(物理:Text/Integer/Real/JSONB)+ **visitor pattern** 產生 DDL/SQL(型別邏輯與 SQL 生成解耦)。

→ **對 docs/14 / docs/15 的影響**|ORM 策略明確化:**Drizzle(固定)+ Knex/Kysely(動態)雙軌**(或直接採 Prisma+Knex 照 Teable)。Weyver docs/14 原列 Drizzle,補一條動態車道即可。

---

## 4. Grid|Canvas 勝(強訊號)

- **NocoDB 從 DOM 遷移到 Canvas**(`smartsheet/grid/canvas/`)—— 用行動證明 DOM grid 撐不住 Airtable 式 UX。
- **Teable = Canvas**(`RenderLayer.tsx` 雙緩衝 + InteractionLayer + InfiniteScroller 虛擬化)—— Excel 級自研 canvas grid。
- **Baserow = DOM 虛擬化** —— 幾萬列 OK,10 萬列要靠篩選/分頁(自己承認)。

→ **驗證 Weyver 選 Glide Data Grid(canvas)是對的**。**且 Teable 的 canvas grid SDK 是 MIT** —— 可評估 fork 取代 / 補強 Glide,省 grid 這塊最硬的工。

---

## 5. 公式引擎|ANTLR 主流,Teable MIT 文法可 fork ⭐

- **Baserow + Teable 都用 ANTLR4 自訂文法**(非 eval 庫)→ AST → 依賴圖 + 循環偵測 → 編譯成 dialect SQL。NocoDB 用 jsep。
- **求值策略分歧**|Baserow 全物化 / NocoDB 全讀時算 / **Teable 預設讀時算 + 可選物化(PG generated column)** ← Weyver 採 Teable 混合式最佳(重 Rollup 物化、簡單讀時算)。
- **★ 授權關鍵**|**Teable 的 `packages/formula`(含 `Formula.g4` ANTLR 文法)是 MIT,可 fork。**

→ **對 docs/15 §6 的重大更新**|原本列 HyperFormula(GPL/商用雙授權,我標了授權疑慮)。**現在有更乾淨的路:fork Teable MIT 公式 package** —— 省數月且授權乾淨。HyperFormula 降為備選。

---

## 6. 多租戶|三家都 shared-schema + row-level(非 schema-per-tenant)

- Baserow / NocoDB / Teable **都用共享 schema + 真實表 per 使用者表 + row-level scoping**(baseId / spaceId / workspace FK + app 層 auth)。**沒有一家用 schema-per-tenant。**

→ **對 docs/15 §2 方案 D 的修正**|我原推薦「D:schema-per-tenant」。產業實證是「**C:真實表 + 共享 schema + tenant_id row-level**」。
- **改採**|**預設 C(共享 schema + 真實表 + tenant_id + RLS)**,與三家一致、生態成熟、跨租戶 migration 簡單(單一 schema)。
- **schema-per-tenant(D)降為「大型 / 高隔離需求客戶」的選配升級**,知道其代價(跨 N schema migration)。
- Weyver Tier 1(固定 ERP 實體)本就 shared schema + tenant_id + RLS,與此一致。

---

## 7. ★ 授權 / 可復用地圖(決定能省多少工)

| 元件 | 專案 | 授權 | Weyver 可否 fork? |
|---|---|---|---|
| 動態表引擎核心 | **Baserow core** | **MIT** | ✅ 可 fork(避開 `premium/` `enterprise/`)|
| 公式引擎(ANTLR 文法)| **Teable `packages/formula`** | **MIT** | ✅ **可 fork** —— 省數月 |
| Canvas grid SDK | **Teable `packages/sdk` grid** | **MIT** | ✅ **可 fork** —— 補強 / 取代 Glide |
| core / 型別模型 | **Teable `packages/core`** | **MIT** | ✅ 可 fork(欄位雙軸模型)|
| Teable backend / apps | Teable | **AGPL-3.0** | ❌ 只能學(SaaS network-use 觸發 copyleft)|
| NocoDB 全部 | NocoDB | **Sustainable Use** | ❌ 只能學(禁閉源 fork + 禁轉售 SaaS)|

**法律紀律(同 CLAUDE.md 紅線)**|
- **可 fork 的 MIT**|逐檔確認 header 為 MIT → fork 進 Weyver,保留 MIT attribution,寫進 clean-room log。
- **只能學的 AGPL / Sustainable Use**|讀架構、學 pattern、**獨立重寫**(idea 不受著作權保護),絕不複製 code;引用公開 docs。
- ⚠️ **fork 前務必逐檔驗授權標頭**(monorepo 混合授權,packages MIT / apps AGPL 界線要硬守)。

---

## 8. Weyver 決策更新彙整

| 項目 | 原(docs/15 v1)| **更新(本研究後)** |
|---|---|---|
| 動態 schema 儲存 | 真實表(方案 C/D)| ✅ 維持真實表;**預設 C(共享 schema + tenant_id),D 降選配** |
| ORM ↔ 動態 schema | 未明 | **Drizzle/Prisma(固定 metadata + Tier1)+ Knex/Kysely(動態 Tier2)雙軌**(Teable pattern)|
| 公式引擎 | HyperFormula(GPL 疑慮)| **fork Teable MIT `packages/formula`(ANTLR)**;HyperFormula 備選 |
| Grid | Glide Data Grid | ✅ 維持 canvas;**評估 fork Teable MIT grid SDK** 補強 |
| 求值策略 | 未定 | **混合**:重 Rollup 物化 / 簡單讀時算(Teable 式)|
| 欄位型別 | 型別 → PG 型別 | **雙軸 `cellValueType` / `dbFieldType` + visitor**(Teable/NocoDB 式)|
| Realtime 協作 | 未列 | ShareDB/OT 可行但複雜 → **Phase 2,非 MVP** |

---

## 9. 對 P0-1 Spike 的影響(docs/15 §12)

研究把 spike 從「驗證未知」縮小為「驗證幾個已知風險點」:

- **不用再驗「真實表可不可行」** —— 三家證明可行,直接做。
- **要驗的剩**|(a) 真實表 per 使用者表在**多租戶高表數**下的 catalog 膨脹 / DDL 鎖(三家都沒公布上限);(b) fork Teable MIT 公式 + grid 的整合成本;(c) 混合求值(物化 vs 讀時算)的正確性與效能。
- **fallback 已不需要 JSONB** —— 真實表是確定方向;fallback 改為「D schema-per-tenant」若共享 schema 的表數失控。

---

## 版本

- **2026-07-18 v1**|首版。拆解 Baserow / NocoDB / Teable。三結論:真實表方向驗證(產業共識)、Teable Prisma+Knex 雙軌解 Prisma 難題、MIT 可復用地圖(Baserow core + Teable formula/grid packages 可 fork,省數月)。更新 docs/15 決策(公式改 fork Teable MIT、租戶改共享 schema + tenant_id、ORM 雙軌、canvas grid 可 fork)。
