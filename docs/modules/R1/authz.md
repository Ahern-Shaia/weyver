# authz.md — [P0-4a] 三層權限(授權層)設計文件

> ✅ **狀態：APPROVED — OQ-AUTHZ-1..6 已裁定（2026-07-21）**；進入 M1。
> **裁定摘要**|OQ-1=**C 完整 role tree(部門繼承)**〔用戶選,較建議 B 大 → role tree 自 docs/13 P1-I 前移本模組〕· OQ-2=A app 層 · OQ-3=A 記錄級全延 P1-I · OQ-4=A deny-by-default · OQ-5=A org owner/admin→tenant admin · OQ-6=A per-request CLS 快取。
>
> 在租戶隔離(F-2 已 SHIPPED)之上,補「租戶**內**」授權層 —— 目前租戶內任何登入者都能對所有表單/欄位做任何事(`TenantContext` 只有 `{tenantId, actorId}`,無 role)。本模組加 **表單級 RBAC + 欄位級遮罩**(記錄級延 P1-I),deny-by-default,對齊 docs/13 Gate P0-4 之權限部分。
>
> 作者：Claude Code（草擬）
> 版本：v0.1（2026-07-21）

---

## 1. 目標與範圍

### 1.1 目標

1. **階層角色(role tree,OQ-1=C)**|管理員可建立**樹狀角色/部門**(role 帶 `parent_id`);一個使用者可多角色,**有效權限 = 自身角色 ∪ 其所有祖先角色的權限**(權限沿樹向下繼承:在部門節點設基準權限,子角色自動繼承)。一使用者多角色仍取聯集。
2. **表單級**|每角色對每表單有存取級別 `none / read / write / manage`;無權者表單清單看不到、API 呼叫被擋(BOLA/IDOR 防線)。
3. **欄位級**|每角色對特定欄位可設 `hidden / read / write`;讀取時遮罩(回應不含該欄)、寫入時拒絕。
4. **強制三點**|`PermissionGuard`(表單級,controller 前)+ `RecordService`(欄位遮罩讀 / 寫入白名單)+ 回應 DTO(不洩他角色欄)。
5. **分層**|租戶隔離(RLS,已 SHIPPED)之上疊租戶內 authz;兩者獨立,authz 破口不會導致跨租戶外洩(縱深防禦)。

### 1.2 對應訴求

| 子題 | 主要訴求 | 對應點 |
|---|---|---|
| E 權限系統 | 表單/欄位/記錄三層權限 | docs/04 E · docs/10 §3.1 · docs/13 P0-4「RBAC Guards + row-level filter + column mask」。ERP 客戶會逐條檢查權限,不能偷懶 |

### 1.3 不做的事(scope 邊界)

- ❌ **記錄級 row filter(owner / 部門 / 業務區域)完整版** → 依 docs/13:504 延 P1-I(OQ-3=A)。注意:role tree 的**部門節點**在本模組僅用於**功能權限繼承**(表單/欄位);「依部門過濾看得到哪些**記錄**」屬記錄級,仍延 P1-I。
- ⬆️ **role tree(部門繼承)本模組做**(OQ-1=C)—— 自 docs/13:385 P1-I **前移** P0-4a。**cascade**:docs/13 需註記此前移(下方 §13 記)。
- ❌ **通知(通訊平台 LINE/Slack/…)** → 拆獨立模組 `notifications`(原 P0-4b),與授權無耦合。
- ❌ **Ops(觀測 / 健康檢查 / 部署)** → 拆獨立模組 `ops`(原 P0-4c)。
- ❌ **不動租戶隔離 RLS**(F-2 已 SHIPPED),不改 `TenantGuard`,只在其後疊加。

---

## 2. 上游 / 既有現況走查

| 子題 | 上游現況 | Gap |
|---|---|---|
| 請求身分 | `TenantContext {tenantId, actorId}`(`http/tenant-context.ts`)| 無 role/permission 概念 → 全新加 |
| Controller 守衛 | 只有 `@UseGuards(TenantGuard)`(租戶隔離)| 加 `PermissionGuard`(表單級)|
| 記錄服務 | `record.service` 方法收 `(tenantId, formId, …, actorId)`,無權限檢查 | 注入 `PermissionService`:讀遮罩 / 寫白名單 |
| Better Auth 組織角色 | org `owner/admin/member`(組織外掛)| org 級非 app 三層;需對映(**OQ-AUTHZ-5**)|
| metadata catalog | `form_def / field_def` 已有(欄位有穩定 id)| 欄位級權限 FK 到 field id,可直接掛 |
| 系統表模式 | Tier-1 固定真實表(非 RLS,如 `users/tenants`,見 auth.md)| 權限表同屬 Tier-1 系統表,以 `tenant_id` 欄 scope + app 層強制 |

---

## 3. 剩餘 scope 切分

| 里程碑 | 內容 | 估算 |
|---|---|---|
| **A1 資料模型** | `roles / role_members / form_permissions / field_permissions` migration(Tier-1)+ Drizzle schema + repository | 0.05 mo |
| **A2 PermissionService** | 解析 actor→roles→effective perms(表單級 map + 欄位級 map)+ per-request CLS 快取 + deny-by-default | 0.06 mo |
| **A3 PermissionGuard** | 表單級守衛(讀 `formId` param + action→required level)接 forms/records controller;list 端點過濾無權表單 | 0.04 mo |
| **A4 欄位級強制** | RecordService 讀遮罩(移除 hidden/無 read 欄)+ 寫白名單(拒非 write 欄,擋 mass-assignment)+ 回應 DTO | 0.05 mo |
| **A5 管理 API + UI** | 角色 CRUD / 指派使用者 / 表單×角色權限矩陣 / 欄位權限;最小設定頁(S22 一角)| 0.06 mo |
| **M5 FMEA** | §12 逐路徑失效反思;P0 全清才 SHIPPED | 0.02 mo |

**合計** ≈ **0.28 mo**(對齊 docs/13「P0-4 權限 basic ~21 之 subset:表單級+欄位級」量級)

---

## 4. A1 資料模型

### 4.1 SQL(Tier-1 系統表,`tenant_id` 欄 scope + app 層強制;不新增動態 DDL)

```sql
-- 角色 / 部門(每租戶;樹狀,OQ-1=C)
CREATE TABLE roles (
  id           bigserial PRIMARY KEY,
  tenant_id    bigint NOT NULL REFERENCES tenants(id),
  parent_id    bigint REFERENCES roles(id) ON DELETE RESTRICT,  -- NULL=根;樹狀部門/角色
  key          text   NOT NULL,          -- 系統角色如 'admin'/'editor'/'viewer';自訂為 slug
  name         text   NOT NULL,
  is_system    boolean NOT NULL DEFAULT false,  -- 系統角色不可刪
  depth        smallint NOT NULL DEFAULT 0,      -- 根=0;限制最大深度(§5.1 防爆)
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, key),
  CHECK (parent_id IS NULL OR parent_id <> id)   -- 禁自我 parent;跨層 cycle 於 app 層擋(§5.1)
);
-- parent 必同租戶(app 層驗;跨租戶 parent 拒)。刪除採 RESTRICT:有子節點不得刪,避免孤兒。

-- 使用者↔角色(多對多;取聯集)
CREATE TABLE role_members (
  role_id   bigint NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  actor_id  bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id bigint NOT NULL REFERENCES tenants(id),  -- 冗餘便於 scope 查詢
  PRIMARY KEY (role_id, actor_id)
);

-- 表單級權限(角色 × 表單 → 動作集;M7 由單一 level → actions[])
CREATE TABLE form_permissions (
  role_id   bigint NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  form_id   bigint NOT NULL REFERENCES form_def(id) ON DELETE CASCADE,
  actions   text[] NOT NULL DEFAULT ARRAY[]::text[],  -- view/create/edit/delete/approve/export/design
  PRIMARY KEY (role_id, form_id)
);
-- migration 0007:level(none/read/write/manage)→ actions[](更細粒度,OQ-AUTHZ-7=B 動作級)

-- 欄位級權限(角色 × 欄位 → 可見性;缺列 = 繼承表單級)
CREATE TABLE field_permissions (
  role_id    bigint NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  field_id   bigint NOT NULL REFERENCES field_def(id) ON DELETE CASCADE,
  visibility text   NOT NULL CHECK (visibility IN ('hidden','read','write')),
  PRIMARY KEY (role_id, field_id)
);
```

### 4.2 動作語意(表單級,M7 動作集)

| 動作 | 意義 | HTTP 對映(Guard 預設) |
|---|---|---|
| view | 看記錄 + 表單出現在清單 | GET / query(POST) / list |
| create | 新增記錄 | POST records / bulk |
| edit | 修改記錄 | PATCH / save-with-lines |
| delete | 軟刪記錄 | DELETE record |
| approve | 簽核核准(前瞻;端點於 workflow 模組落地時 enforce) | — |
| export | 匯出(前瞻;報表模組) | — |
| design | 改表單結構(原 manage) | 建表 / 加欄 / 改型別 / 刪欄 |

- **有效動作 = 角色閉包(自身∪祖先)所有列的動作聯集**(較寬鬆勝)。缺列/空集 = 無動作(deny-by-default)。
- **admin 系統角色** = 全動作(特判,不查每表);**設權限本身**由 AdminGuard(系統 admin)控,不在 design 內。
- 欄位級**收斂於表單動作集**(交集,較嚴者勝):表單無 edit/create → 欄位頂多 read;無 view → hidden。欄位缺列則繼承(有 edit→write,僅 view→read)。

---

## 5. A2 PermissionService + A3 Guard

### 5.1 解析(deny-by-default)

```
resolveForActor(tenantId, actorId):
  directRoles = role_members ⋈ roles  (該 actor 該租戶)
  roleSet     = directRoles ∪ ancestors(directRoles)   -- 沿 parent_id 上溯,權限向下繼承(OQ-1=C)
  formLevels  = max(level) per formId over form_permissions(roleSet)   -- 聯集取最高
  fieldVis    = per fieldId: 任一 role 給 write→write, 否則 read>hidden 的最寬鬆
  → EffectivePermissions { formLevel: Map<formId,Level>, fieldVis: Map<fieldId,Vis> }
  未列 formId ⇒ 'none'(deny-by-default,OQ-AUTHZ-4)
```

- **祖先解析(role tree)**|以單一 recursive CTE(`WITH RECURSIVE`)一次取 actor 所有角色 + 祖先,避免 N+1。深度上限(如 8)+ 走訪 visited set 防環(即使資料異常有環也不無限迴圈)。建/改 parent 時於 app 層驗「新 parent 不得為自身後代」擋環。
- 每請求解析一次,存 **nestjs-cls**(per-request 快取,OQ-6=A);metadata/權限變更即失效(下一請求重解析)。Redis 跨請求快取延後(對齊「metadata 快取」P1 鐵則,非 P0)。

### 5.2 PermissionGuard(表單級)

- 讀路由 `:formId` + HTTP method → 需求級別(GET=read / POST·PATCH·DELETE=write / 設計器=manage)。
- `EffectivePermissions.formLevel[formId] >= required` 否則 `403`(統一錯誤信封,不洩結構)。
- **list 端點**(`GET /api/forms`):過濾掉 `none` 的表單 —— 無權者連存在都不知道。
- 掛在 `TenantGuard` **之後**(先確定租戶,再查租戶內權限)。

---

## 6. A4 欄位級強制 + A5 管理

- **讀**|`RecordService` 回列前,依 `fieldVis` 移除 `hidden` 及無 `read` 欄 → 回應 DTO 不含該欄(不是前端隱藏,是後端不回,防洩)。
- **寫**|`create/update` 的 `values` 只接受 `write` 欄;含無權欄 → `403`(擋 mass-assignment,呼應 AGENTS ValidationPipe whitelist 精神,但此為**每角色動態**白名單)。
- **子表 saveWithLines**|header 與 lines 各依其 form/field 權限分別檢查。
- **管理 UI**|角色清單 / 建角色 / 指派使用者 / **表單×角色矩陣**(格子選 none/read/write/manage)/ 展開表單設欄位級;放 S22 設定中心一角(權限管理)。

---

## 7. 資料模型變動

### 7.2 SQL Migration
- 新增 4 表(§4.1),皆 Tier-1 系統表。migration 角色(擁 DDL 權)建立;app `weyver_app` 角色只 DML。
- 種子:每租戶建立時(`afterCreateOrganization` hook,auth.md 已有)自動建 3 系統角色 `admin/editor/viewer` + 建立者 org owner→`admin`。

### 7.3 RLS / Permission
- 權限表為 Tier-1 系統表,**不靠 RLS**(如 users/tenants),以 app 層 `tenant_id` 綁定 + 查詢強制 scope。授權**決策在 app 層**(PermissionService),RLS 仍是跨租戶最後防線(縱深)。
- **不變量**:authz 只能**收窄**同租戶內可見範圍,永不能放寬跨租戶 —— 任一查詢仍帶 `tenant_id`。

---

## 8. 測試策略

| 層級 | 覆蓋 | 位置 |
|---|---|---|
| Unit | PermissionService 解析(多角色聯集 / 交集較嚴勝 / deny-by-default / 欄位繼承 / **role tree 祖先繼承 / 防環 / 深度上限**)| `*.spec.ts` |
| Integration(Testcontainers 真 PG)| Guard 擋越權(viewer POST→403)· list 過濾無權表單 · 欄位遮罩(hidden 欄不回)· 寫無權欄→403 · **跨租戶仍隔離**(authz 不破 RLS)| `tests/` |
| e2e | 建角色→指派→矩陣設權→切換使用者驗證可見/可寫差異 | Playwright,固化進 CI |

**deny-by-default 斷言**:新表未授權 → 非 manage 者 GET/POST 皆 403。**縱深斷言**:即使 authz 誤放行,跨租戶查詢仍被 RLS 擋。

---

## 9. 落地順序與里程碑

| 里程碑 | 內容 | 狀態 |
|---|---|---|
| **M0** 設計 review | 本檔 → APPROVED(用戶定 OQ-AUTHZ-1..6)| ⏳ |
| **M1** A1 資料模型 + 種子 + repository + unit | 4 Tier-1 表(role tree)+ migration 0006 + AuthzRepository(種子/建樹/reparent 防環/成員/權限 upsert/recursive-CTE 閉包/isAdmin)+ 種子接 org hook;14 unit + 7 integration(真 PG)綠 | ✅ |
| **M2** A2 PermissionService + 快取 + unit | PermissionService.resolveForActor(admin 特判 / 角色閉包聚合 / deny-all)+ buildEffectivePermissions 純聚合(聯集/欄位繼承+收斂交集)+ EffectivePermissions(form/field 判定 + list 過濾);8 unit 綠。**快取**改採 request-attached(對齊現有 TenantContext 掛 req 模式;nestjs-cls 未於 codebase 落地 → per-request 由 M3 Guard 解析一次掛 req,cross-request/CLS 待基建) | ✅ |
| **M3** A3 PermissionGuard + list 過濾 + 接 controllers + 整合測 | PermissionGuard(掛 TenantGuard 後,解析掛 req.permissions;:formId 路由依 decorator/方法驗級別;無 formId write/manage 需 admin)+ `@RequiresFormLevel` + `@Permissions`;forms/records controller 接上,設計器路由標 manage、query 標 read、list 過濾 readable;dev isSuperAdmin 全權、prod owner→admin(org hook 對映);7 guard 整合測 + records/formula/tenant/e2e 無回歸 | ✅ |
| **M4** A4 欄位級遮罩/寫白名單 + 回應 DTO + 整合測 | RecordService 加 optional `policy?: FieldAccessPolicy`:讀 maskRead(移除 hidden 欄,後端不回)+ 寫 assertWritable(非 write 欄→FieldForbiddenError→403);create/update/bulk/getRecord/listRecords/saveWithLines(header+lines 各依表)全接;controller 傳 @Permissions();policy 缺省=不遮罩(向後相容)。5 integration(真 PG:讀遮罩/list 遮罩/寫白名單 403/只寫可寫成功)+ records/e2e 無回歸 | ✅ |
| **M5** A5 管理 API + UI + 測試 | **後端 API ✅**:AuthzAdminController /api/authz/roles(TenantGuard+AdminGuard)角色 CRUD/reparent/成員/表單×角色/欄位權限/矩陣讀 + AuthzAdminService(跨租戶 404·系統角色不可刪·有子不可刪·cycle/dup 映射)+ AdminGuard;7 integration。**管理 UI ✅**:`/app/settings/permissions`(角色/部門樹 + 表單×動作矩陣 + 欄位可見性 Segmented + 成員)接 lib/engine/authz;瀏覽器實走驗證矩陣勾選→PUT→DB 往返(commit b7f75c4)| ✅ |
| **M6** FMEA 收尾(§12)+ doc | §12 六路徑 FMEA 完成,P0 全 ✅(後端可上 prod);F4 公式×可見性、T/R 殘留列明 | ✅(後端)|
| **M7** 動作級模型(OQ-7=B)| `form_permissions.level` → `actions text[]`(view/create/edit/delete/approve/export/design);migration 0007;FormAction 聯集 + 欄位 clamp 依動作集 + Guard 方法→動作 + admin API actions;全套件 163 tests 綠 | ✅(後端)|

---

## 10. 開放問題（OQ-AUTHZ-N）— ✅ 已裁定 2026-07-21

> **裁定**|OQ-1=**C**(role tree,非建議 B)· OQ-2=A · OQ-3=A · OQ-4=A · OQ-5=A · OQ-6=A。下表「裁定」欄記最終選擇。

| # | 訴求 | 議題 | 選項 | 裁定 |
|---|:-:|---|---|---|
| **OQ-AUTHZ-1** | E | 角色模型深度 | A. 僅固定系統角色 · B. 平面自訂角色 · C. 完整 role tree(部門繼承)| ✅ **C**(用戶裁定)— role tree 自 docs/13 P1-I 前移本模組;`roles.parent_id` + recursive CTE 祖先解析 + 防環 + 深度上限 |
| **OQ-AUTHZ-2** | E | 欄位級強制位置 | A. **app 層**(PermissionService 解析 + RecordService 遮罩 + DTO)<br>B. DB column privilege / per-column RLS | **A** — 欄位是每租戶動態且量大,DB column-level 對動態表過重且難隨 schema 變動維護;app 層彈性且與現有 metadata 驅動一致 |
| **OQ-AUTHZ-3** | E | 記錄級是否含最小版 | A. **全延 P1-I**(本模組不碰)<br>B. 含最小「僅本人建立可見/可編」開關(owner-based,`created_by` 已有) | **A** — 依 docs/13 記錄級屬 P1-I;避免 scope creep,先把表單+欄位級做穩。若 pilot 早需再開 B |
| **OQ-AUTHZ-4** | E | 新表**預設可見性** | A. **deny-by-default**(新表僅 admin/建立者可見,需明確授權他人)<br>B. allow-by-default(租戶內預設可見,再逐步收) | **A** — AGENTS 資安鐵則 deny-by-default;安全優先。⚠️ **權衡**:Ragic 習慣偏 allow,遷移期全 deny 可能造成「東西不見了」摩擦 → 緩解:pilot 遷移時由 admin 一鍵「全員 editor」過渡,之後再收。此題影響遷移體驗,想聽你定 |
| **OQ-AUTHZ-5** | E | Better Auth org 角色對映 | A. org `owner/admin` → 自動 tenant `admin`(全表單 manage);`member` → 依指派<br>B. 完全獨立,org 角色不影響 app 權限 | **A** — 避免「org owner 卻在 app 無權」的死鎖;owner 須有可控回收路徑(對齊 auth.md §6-bis 治理) |
| **OQ-AUTHZ-6** | E | 權限快取 | A. **per-request CLS**(每請求解析一次)<br>B. Redis 跨請求 + 變更失效 | **A** — 對齊「metadata 快取」為 P1 非 P0;先 per-request 正確簡單,規模到再加 Redis 層(介面預留)|
| **OQ-AUTHZ-7** | E | 表單存取粒度(2026-07-21 追加)| A. 4 級 none/read/write/manage<br>B. **動作集**(view/create/edit/delete/approve/export/design)| ✅ **B**(用戶採建議「更細度控制哪些權限給什麼角色」)— 4 級把新增/編輯/刪除綁在「寫」,表達不出「可核准不可新增」;M7 遷移 `level`→`actions[]`(migration 0007)。approve/export 前瞻旗標 |

---

## 12. 失效場景反思（FMEA）— M6

> 逐路徑:失效模式 → 影響 → 嚴重度 → 緩解狀態。P0 未 ✅ 不得 SHIPPED。

### 12.1 PermissionGuard(表單級執法)

| # | 場景 | 行為 | 狀態 | Sev |
|---|---|---|---|---|
| G1 | Guard 未掛某 controller | 該 route 無授權 → 越權 | ✅ forms/records 皆 `@UseGuards(TenantGuard, PermissionGuard)`;新 controller 靠 review + 本表 | P0 |
| G2 | Guard 早於 TenantGuard(無 context) | 讀不到 tenantContext | ✅ 明確 throw「order after TenantGuard」;array 順序 TenantGuard→PermissionGuard | P0 |
| G3 | 設計器路由用預設 write 而非 manage | editor(write)可改表結構 | ✅ 全設計器路由標 `@RequiresFormLevel("manage")`;query(POST 讀)標 read | P0 |
| G4 | 無角色 actor 讀到表 | 洩漏 | ✅ deny-by-default:formLevel 缺=none;list 過濾;整合測斷言 | P0 |
| G5 | 無 formId 的寫(建表)未擋 | 任意人建表 | ✅ 無 formId + write/manage → 需 isAdmin | P1 |

### 12.2 欄位級(M4 遮罩 / 寫白名單)

| # | 場景 | 行為 | 狀態 | Sev |
|---|---|---|---|---|
| F1 | hidden 欄仍回前端 | 洩漏敏感欄 | ✅ maskRead 後端刪值(非前端隱藏);getRecord/list/create 回應皆遮;整合測 | P0 |
| F2 | 寫入無 write 權欄(mass-assignment) | 竄改 | ✅ assertWritable 每提供欄查 write,否則 FieldForbiddenError→403 | P0 |
| F3 | 子表 saveWithLines 只檢 header | line 欄越權 | ✅ header 依 parentForm、每 line 依 childForm 各自 assertWritable | P0 |
| F4 | formula/rollup 欄含 hidden 來源欄 | 讀時算間接洩隱藏值 | ⚠️ 已知殘留:公式結果欄本身受遮罩,但若公式引用 hidden 欄,結果值間接透露 → **治本**:設計期禁公式引用低於自身可見性之欄(P1-I authz×formula 交叉);目前靠管理員配置紀律 | P1 |

### 12.3 決策解析(M2)

| # | 場景 | 行為 | 狀態 | Sev |
|---|---|---|---|---|
| R1 | 多角色聯集誤放行 | 過度授權 | ✅ 聯集取「較寬鬆」是設計語意(Ragic 同);欄位收斂於表單級(交集較嚴);單元測覆蓋 | P1 |
| R2 | 每請求解析污染跨 actor | A 讀到 B 權限 | ✅ 每請求 resolveForActor 重算 + 掛該 req.permissions,無跨請求共享狀態 | P0 |
| R3 | admin 特判被誤用 | 非 admin 得全權 | ✅ isAdminActor 查 is_system && key='admin' 的 role membership;dev isSuperAdmin 僅 dev(prod fail-closed) | P0 |

### 12.4 role tree(OQ-1=C)

| # | 場景 | 行為 | 狀態 | Sev |
|---|---|---|---|---|
| T1 | 環致無限迴圈 | 解析/建立 hang | ✅ 建/reparent 前 wouldCreateCycle 擋;resolveActorRoleIds 用 UNION(遇環自然終止);closure visited set;單元測環資料仍終止 | P0 |
| T2 | 深樹解析爆炸 | 效能 / stack | ✅ depthForParent 上限 8;recursive CTE 單查詢非遞迴函數 | P1 |
| T3 | 刪父節點成孤兒 | FK 破壞 | ✅ parent FK ON DELETE RESTRICT + service countChildren 先擋(409) | P1 |
| T4 | 跨租戶 parent | 越租戶樹 | ✅ createRole 驗 parent 同租戶(getRole tenant-scoped);setRoleParent 同租戶 parentMap | P0 |

### 12.5 org 對映 / 種子 / admin API

| # | 場景 | 行為 | 狀態 | Sev |
|---|---|---|---|---|
| O1 | owner 登入卻無權(死鎖) | 建 org 後自己進不去 | ✅ afterCreateOrganization 種角色 + upsert owner + assign admin(全 idempotent) | P0 |
| O2 | 種子競態(並發建 org) | 重複角色 | ✅ onConflictDoNothing(tenant,key);unique 兜底 | P1 |
| O3 | admin API 跨租戶操作他人角色 | 越權改權限 | ✅ 每操作 mustRole(tenant scope)→ 不存在即 404;整合測斷言 | P0 |
| O4 | 非 admin 觸 admin API | 越權管理 | ✅ AdminGuard 需系統 admin(dev isSuperAdmin);deny 其他 | P0 |

### 12.6 部署順序

| # | 場景 | 風險 | 緩解 |
|---|---|---|---|
| D1 | 後端 code 先於 migration 0006 | 缺 4 表 → authz 查詢 500 | migration 必先(R10);Tier-1 表由特權車道建 |

### 12.7 不在本模組 scope

- 記錄級 row filter(owner/部門)→ P1-I(OQ-3=A)。
- 通知 / Ops → P0-4b/c 獨立模組。
- **權限管理 UI**(角色/矩陣前端)→ 本模組 M1–M5 為後端;UI 為獨立前端交付(見 §9 / MODULES.md)。
- F4 公式×可見性交叉 → P1-I。

> **檢查點**:上表 P0 全 ✅。後端可上 prod;完整 SHIPPED 待管理 UI。

---

## 13. 變更紀錄

| 日期 | 版本 | 變更 | 作者 |
|---|---|---|---|
| 2026-07-21 | v0.1 | 初版 DRAFT — 拆自 P0-4(通知/Ops 另立);表單級+欄位級 authz;OQ-AUTHZ-1..6 | Claude Code |
| 2026-07-21 | v0.2 | OQ 全裁定;DRAFT→**APPROVED**;OQ-1=C **role tree 前移**(自 docs/13 P1-I;`parent_id`+recursive CTE 祖先繼承+防環+深度上限);進 M1。**cascade**:docs/13 §「P1-I 記錄級權限」註記 role tree 已前移 P0-4a(記錄級 row filter 仍留 P1-I)| Claude Code |
| 2026-07-21 | v0.3 | M1–M5 後端 + M6 FMEA SHIPPED(表單級 4 級 + 欄位級 + role tree + owner→admin + 管理 API);~65 tests | Claude Code |
| 2026-07-21 | v0.4 | **M7 動作級模型**(OQ-AUTHZ-7=B,用戶採建議「更細粒度」)|`form_permissions.level` → `actions text[]`(view/create/edit/delete/approve/export/design);migration 0007;FormAction 聯集 + 欄位 clamp 依動作集 + Guard 方法→動作(POST=create/PATCH=edit/DELETE=delete/query=view/save-with-lines=edit/設計=design)+ admin API actions DTO;全套件 **163 tests 綠**、build 綠。理由:4 級把新增/編輯/刪除綁在「寫」,表達不出「可核准不可新增」等 Ragic/ERP 常見需求。approve/export 為前瞻旗標(端點於後續模組 enforce)| Claude Code |
