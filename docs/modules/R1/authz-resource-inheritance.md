# authz-resource-inheritance.md — [P0-4a·uplift] 資源軸繼承(分類授權 + owner + 敏感旗標)設計文件

> ✅ **狀態：APPROVED — OQ-ARI-1..8 已裁定（2026-07-24;建議由 deep-research 證據錨定,§10-bis);進入 M1**
> **裁定摘要**|1=A 平面 · 2=A 絕對集覆寫 · 3=A 租戶 profile 預設空=deny · **4=B owner 得資料動作但 design 除外** · 5=A 敏感跳繼承+admin-only · 6=A 新表未分類 · 7=A 不做分類級欄位 · **8=折衷 非敏感/未分類/遷移期顯示鎖定+申請存取、敏感恆隱藏**。
>
> 承 [R1/authz.md](authz.md)(P0-4a 三層權限,已 SHIPPED)。現行授權為**逐表列舉 + deny-by-default**:每張表單 × 動作對每角色獨立設定,新建表單在配置前對所有非管理員角色隱形。由於表單引擎的核心定位是「使用者自建自填」,表單數量會持續增長,逐表配置的維護量隨之 `O(表單 × 角色)` 線性膨脹 —— 與自助定位衝突,亦違反命門「算/綁定須自助化」([[feedback_calc_binding_self_service]])。角色軸已有繼承(role tree,recursive-CTE 祖先閉包);本模組在**資源軸**補上對稱的繼承層:授權設於**分類**、表單繼承,逐表僅作覆寫;並以 **owner 短路** 與 **敏感旗標** 收束例外。授權單位由 `O(表單)` 收斂為 `O(分類)`。
>
> **關鍵設計**|既有 `form_permissions`(每列為**絕對**動作集,M7 已落地)天然即「**覆寫層**」;本模組只在其**下方**補「**分類授權層**」`category_permissions` 與「**預設 profile 層**」。deploy 時所有既有表 `category_id=NULL`、`default_form_actions={}` → **行為與現行完全一致(惰性、零回歸)**,功能於 admin 建立分類後才生效。
>
> 作者：Claude Code（草擬）
> 版本：v0.2（2026-07-24;OQ 建議由 deep-research 錨定,OQ-4 翻案)
> UI 權威稿：`docs/mockups/permissions-resource-inheritance.html`(對照現況 permissions-admin-uplift.html)

---

## 1. 目標與範圍

### 1.1 目標

1. **分類繼承(最大槓桿)**|表單歸屬**分類**(`form_def.category_id`);授權設於分類(`category_permissions`,角色 × 分類 → 動作集)。表單預設**繼承所屬分類的授權**,無需逐表配置。維護量由 `O(表單 × 角色)` 收斂為 `O(分類 × 角色)`。
2. **覆寫層(override-only)**|逐表授權(既有 `form_permissions`)重新定位為**繼承之上的覆寫**:某表單刻意偏離分類時,在該表寫一列絕對動作集覆蓋繼承值。逐表配置由「唯一機制」降為「例外機制」。
3. **owner 短路**|表單建立者(`form_def.created_by`)自動對**自建表單**擁有全**資料動作**(免等管理員授權,對齊 Ragic 自助);但**改結構(design)不自動給** —— 依「用資料 ≠ 改結構」企業級鐵則(Notion / Salesforce,§10-bis D2;OQ-ARI-4=B 待裁定)。
4. **敏感旗標**|表單可標記 `is_sensitive`;敏感表**不吃分類繼承**,僅 owner 或明確逐表覆寫可存取 → 對真正該審的少數表(傳票/GL/HR)保留嚴格 deny-by-default。
5. **租戶預設 profile**|未分類且無任何授權之**非敏感**表,套用租戶級 `default_form_actions`(預設空 = 維持現行 deny;admin 可設為 `view` 作遷移期軟性 allow-by-default)。
6. **零回歸上線**|純加法擴充,既有 `form_permissions` 語意不變、既有解析路徑相容;功能惰性,admin 未建分類前系統行為與 P0-4a SHIPPED 版一致。

### 1.2 對應訴求

| 子題 | 主要訴求 | 對應點 |
|---|---|---|
| E 權限系統 | 表單/欄位權限可維護、隨自助建表規模不崩 | docs/04 E · docs/10 §3.1(平台/帳號管理)· 命門 [[feedback_calc_binding_self_service]](綁定須自助)· 現行 authz.md OQ-AUTHZ-4 已標記的遷移摩擦(Ragic 偏 allow)於此正式解 |

### 1.3 不做的事(scope 邊界)

- ❌ **不改角色軸(role tree)**|祖先閉包解析(recursive-CTE)、防環、深度上限已 SHIPPED,本模組不動。分類繼承是**資源軸**,與角色軸正交、各自獨立聚合。
- ❌ **不改欄位級模型**|欄位仍為 `hidden/read/write` 且**收斂於表單有效動作集**(`clampFieldToForm` 不變);表單有效動作可能來自分類,但欄位邏輯無感。不引入「分類級欄位授權」。
- ❌ **不引入記錄級 row filter**|「依部門看得到哪些**記錄**」仍屬 P1-I(authz.md OQ-3=A);本模組只處理**功能權限**(表單/欄位可見與可做)。
- ❌ **不做分類樹(category tree)**|MVP 為**平面分類**(`parent_id` 欄保留,恆 NULL);繼承僅 表單→分類單層,不含 分類→分類(見 OQ-ARI-1)。
- ❌ **不改租戶隔離 RLS**|F-2 已 SHIPPED;authz 只能**收窄**同租戶內範圍,永不放寬跨租戶。

---

## 2. 上游 / 既有現況走查

| 子題 | 上游現況(P0-4a SHIPPED)| Gap |
|---|---|---|
| 表單授權表 | `form_permissions(role_id, form_id, actions text[])` — 每列**絕對**動作集(M7)| ✅ 可**原封重用為覆寫層**;無需改 schema |
| 有效權限聚合 | `buildEffectivePermissions()` 純函數:formRows/fieldRows → 聯集(較寬鬆勝);`EffectivePermissions.formActions(formId)`(admin 特判 / deny-by-default)| 需擴充:注入分類授權 + 表單 metadata(category/sensitive/owner)+ 預設 profile |
| 角色閉包 | `AuthzRepository.resolveActorRoleIds()`(recursive-CTE 祖先)| ✅ 不變;分類授權亦以此 roleSet 聚合 |
| 表單 metadata | `form_def`:id/tenant/name/physical/state/parentFormId/version/… | **缺** `category_id` / `is_sensitive` / `created_by` → M1 加 3 欄 |
| 分類概念 | **無**(僅 `parentFormId`=子表關聯,非分類)| 全新 `form_categories` + `category_permissions` |
| list 過濾 | `EffectivePermissions.readableFormIds()`(過濾 `view`)| ✅ 介面不變;背後 formActions 改走繼承後自動涵蓋新表 |
| 管理 API/UI | `AuthzAdminController /api/authz/roles` + `/app/settings/permissions`(逐表矩陣)| 加分類 CRUD / 表單歸類 / 分類授權;UI 矩陣改**依分類分組** |
| owner 資訊 | records 有 actor 來源;**`form_def` 無 created_by** | M1 加 `form_def.created_by`;既有表遷移為 NULL(無 owner) |

---

## 3. 剩餘 scope 切分

| 里程碑 | 內容 | 估算 |
|---|---|---|
| **A1 資料模型** | `form_categories` + `category_permissions` 表 + `form_def` 加 `category_id/is_sensitive/created_by` + `tenants.default_form_actions`;migration 0008;Drizzle schema + repository（分類 CRUD / 歸類 / 分類授權 upsert / 讀取聚合輸入）| 0.05 mo |
| **A2 繼承解析** | `buildEffectivePermissions` 升級為**分層聚合**(覆寫 → 分類 → 預設;owner 短路;敏感 gate);純函數 + 單元測(層級優先序 / 跨角色聯集 / 敏感不繼承 / owner / 預設 profile）| 0.05 mo |
| **A3 管理 API** | AuthzAdminController 擴充:分類 CRUD、表單歸類、`is_sensitive` 切換、分類授權矩陣讀寫、租戶預設 profile 設定;跨租戶 404 / 系統不變量 | 0.04 mo |
| **A4 管理 UI** | `/app/settings/permissions` FormMatrix 改**分類分組**(分類授權列 = 真實來源、表單繼承列虛線、覆寫列琥珀、敏感鎖、未授權)+ builder 表單設定加「分類 / 敏感」;對照 mockup | 0.05 mo |
| **A5 遷移工具** | 租戶預設 profile 設定面 + admin「一鍵過渡」(遷移期軟 allow / 批次歸類)| 0.02 mo |
| **M6 FMEA** | §12 逐路徑失效反思;P0 全清才 SHIPPED | 0.02 mo |

**合計** ≈ **0.23 mo**(P0-4a 之後續增量;不改 R1 總量結論,折入既有權限 scope)

---

## 4. A1 資料模型

### 4.1 SQL(Tier-1 系統表;migration 0008;純加法)

```sql
-- 表單分類(每租戶;MVP 平面。parent_id 保留未來 category tree,OQ-ARI-1)
CREATE TABLE form_categories (
  id         bigserial PRIMARY KEY,
  tenant_id  bigint NOT NULL REFERENCES tenants(id),
  parent_id  bigint REFERENCES form_categories(id) ON DELETE RESTRICT,  -- MVP 恆 NULL
  name       text   NOT NULL,
  position   integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

-- form_def 擴充(3 欄,皆可空 → 既有列不受影響)
ALTER TABLE form_def ADD COLUMN category_id  bigint REFERENCES form_categories(id) ON DELETE SET NULL;  -- NULL=未分類
ALTER TABLE form_def ADD COLUMN is_sensitive boolean NOT NULL DEFAULT false;   -- 敏感表:不吃分類繼承
ALTER TABLE form_def ADD COLUMN created_by   bigint REFERENCES users(id);       -- owner 短路;NULL=無 owner(遷移既有)

-- 分類授權(角色 × 分類 → 動作集;繼承層,位於 form_permissions 覆寫層之下)
CREATE TABLE category_permissions (
  role_id     bigint NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  category_id bigint NOT NULL REFERENCES form_categories(id) ON DELETE CASCADE,
  actions     text[] NOT NULL DEFAULT ARRAY[]::text[],  -- 同 FORM_ACTIONS 值域
  PRIMARY KEY (role_id, category_id)
);

-- 租戶預設 profile(OQ-ARI-3;未分類且無授權之非敏感表 baseline;預設空=deny)
ALTER TABLE tenants ADD COLUMN default_form_actions text[] NOT NULL DEFAULT ARRAY[]::text[];
```

- 皆 Tier-1 系統表:migration 角色(擁 DDL)建立;app `weyver_app` 角色僅 DML。授權**決策在 app 層**;RLS 仍為跨租戶最後防線(縱深)。
- `actions` 值域沿用既有 `FORM_ACTIONS`(view/create/edit/delete/approve/export/design),不新增動作型別 → 前後端 registry 共用。

### 4.2 三層優先序(單一角色、單一表單)

授權來源由高到低,**命中即止**:

| 層 | 來源 | 語意 |
|---|---|---|
| 0 · admin | 系統 admin 角色 | 全動作(既有特判,不查每表) |
| 1 · owner | `form_def.created_by == actor` | 全**資料動作**(view/create/edit/delete/approve/export);**design(改結構)除外**,仍需明確授權 — 對齊「用資料 ≠ 改結構」鐵則(OQ-ARI-4=B,§10-bis D2) |
| 2 · 覆寫 | `form_permissions[role, form]` 存在 | 該列**絕對**動作集(既有表,重新定位) |
| 3 · 繼承 | 非敏感 且 `category_permissions[role, form.category]` 存在 | 分類動作集 |
| 4 · 預設 | 非敏感 且以上皆無 | `tenants.default_form_actions`(可空) |
| — · deny | 敏感表且無 owner/覆寫,或非敏感表全空 | ∅(deny-by-default) |

**敏感 gate**:`is_sensitive=true` 時**跳過第 3、4 層** —— 敏感表只認 owner(第 1)與明確覆寫(第 2)。真正的 deny-by-default 保留給該審的少數。

---

## 5. A2 繼承解析

### 5.1 分層聚合(擴充 `buildEffectivePermissions`)

現行純函數輸入為「角色閉包的 `form_permissions` 列」;升級為分層。**跨角色聯集語意不變**(較寬鬆勝):每個角色先各自解析其層級來源,再聯集各角色結果。

```
resolveFormActions(actor, form F(category=C, sensitive=S, owner=O), roleClosure R, defaultActions D):
  if isAdmin(actor):            return ALL_ACTIONS         // 層 0
  if O == actor.id:             return DATA_ACTIONS        // 層 1 owner 短路(actor 級);= ALL_ACTIONS − {design}(OQ-4=B)
  perRole = for r in R:                                    // 層 2/3 逐角色
      if form_permissions[r, F] exists:  form_permissions[r, F].actions          // 覆寫(絕對)
      elif not S and C != NULL and category_permissions[r, C] exists:
                                         category_permissions[r, C].actions        // 繼承
      else:                              ∅
  base = union(perRole)                                    // 跨角色聯集(既有語意)
  if base == ∅ and not S:       base = D                   // 層 4 預設 profile(可空)
  return base
```

- **覆寫優先於繼承是 per-role 的**:角色 A 覆寫某表(絕對集 X)、角色 B 繼承分類(集 Y)→ actor 得 `X ∪ Y`(與現行「較寬鬆勝」一致)。
- **owner / admin 為 actor 級短路**,先於角色聚合。
- **欄位級不變**:`EffectivePermissions.fieldVisibility()` 續以 `formActions(formId)` 為天花板 `clampFieldToForm`;動作集現可能源自分類,欄位邏輯無感。
- **list 行為(OQ-8=折衷,擴充 `readableFormIds()`)**:分類授了 view 的表 → **完整可見**(新建表無需逐表配置即自動可見 = 本模組核心收斂)。無 view 者依三態分派:
  - **敏感表** → **隱藏**(排除清單,守 authz.md G4 不洩漏存在)。
  - **非敏感表**(未分類 / 遷移期)→ 回傳**鎖定 stub**(僅名稱 + 分類,不含記錄/資料,附「申請存取」入口)—— Drive「看得到打不開 + request access」範式,緩解遷移期「東西不見了」。
  - 判定由 `EffectivePermissions` 依 `canRead(formId)` + `form.is_sensitive` 分派;新增 `listableForms()` 回 `{ readable[], locked[] }`,敏感無權者不入任一。

### 5.2 解析輸入的取得(repository)

`PermissionService` 解析時,除既有 `resolveActorRoleIds` + `form_permissions`(roleSet)外,追加:

- `category_permissions`(roleSet)—— 一次查詢取角色閉包對各分類的授權。
- 候選表單的 `{ category_id, is_sensitive, created_by }`(隨 `form_def` 既有查詢帶回,免額外往返)。
- `tenants.default_form_actions`(隨 tenant context 快取)。

聚合仍為**純函數**(無 I/O),單元可測;per-request 掛 `req.permissions`(既有 CLS/req-attached 模式,OQ-6=A 不變)。

---

## 6. A3 管理 API + A4 UI

### 6.1 後端 API(擴充 `AuthzAdminController`,TenantGuard + AdminGuard)

- 分類:`GET/POST/PATCH/DELETE /api/authz/categories`(建立/改名/排序/刪除;刪除採 `ON DELETE SET NULL` → 表單回退未分類,不孤兒)。
- 表單歸類:`PATCH /api/forms/:id`(加 `categoryId` / `isSensitive`);歸類與敏感切換為表單 metadata。
- 分類授權:`PUT /api/authz/roles/:roleId/categories/:categoryId`(actions[])。
- 租戶預設:`PUT /api/authz/settings/default-form-actions`。
- 有效矩陣讀:`GET /api/authz/roles/:roleId/matrix` 回**分類分組 + 每表解析來源標記**(grant/inherit/override/sensitive/none)供 UI 直繪。

### 6.2 UI(`/app/settings/permissions`;對照 `docs/mockups/permissions-resource-inheritance.html`)

FormMatrix 由平鋪改**分類分組**:

- **分類授權列**(真實來源):實心主色勾;帶 `分類授權` 標。
- **表單繼承列**:青色虛線勾(`繼承`);點一下即在該表寫 `form_permissions` 覆寫(轉琥珀)。
- **覆寫列**:琥珀實心 + `覆寫` 標;提供「還原繼承」(刪該表 `form_permissions` 列)。
- **敏感列**:`敏感 · 鎖`;分類未授權時顯示 `—`(不繼承),僅 owner/覆寫可開。
- **未授權分類**:整組空;其下表單不可見。
- builder 表單設定加「所屬分類」下拉 + 「敏感表」開關(走既有 `@weyver/ui/select` / `Segmented`,不自製元件 — [[feedback_grep_ui_components_before_writing]])。
- **鎖定 stub + 申請存取(OQ-8=折衷)**:表單清單對非敏感無權表顯示鎖定列(名稱可見、不可開,鎖圖示 + 「申請存取」)→ 送出建立一筆 access request(通知 admin;通知落地前 MVP = 記一筆待審 + admin 設定頁可見)。敏感無權表不顯示。`is_sensitive` 切換為 admin-only 動作 + 留 audit。

---

## 7. 資料模型變動

### 7.1 Proto
- 無(REST + Zod)。

### 7.2 SQL Migration
- **0008**:新增 `form_categories` / `category_permissions` 表;`form_def` +3 欄;`tenants` +1 欄(§4.1)。**純加法,可空** → 既有資料零影響。
- **無 down 資料損失**:rollback 僅 drop 新表/欄;既有 `form_permissions` 與行為回到 P0-4a。

### 7.3 RLS / Permission
- 新表為 Tier-1 系統表,以 `tenant_id`(分類)/ 角色閉包(授權)app 層 scope;授權決策在 app 層,RLS 為縱深最後防線。
- **不變量**:分類繼承只在**同租戶內**收窄/放寬功能可見範圍;所有查詢仍帶 `tenant_id`,authz 永不放寬跨租戶。

---

## 7-bis. 企業級 cross-cutting 檢核(授權模組安全敏感,擇要填)

### 7-bis.1 安全模型

| 攻擊面 | 緩解 | 對應實作 |
|---|---|---|
| 分類繼承誤放行(把敏感表放進寬鬆分類)| 敏感旗標**跳過繼承**;敏感表只認 owner/覆寫 | §4.2 敏感 gate;整合測斷言敏感表在授權分類下仍 deny |
| 預設 profile 誤設過寬(全租戶可見)| 預設**空 = deny**;放寬為明確 admin 動作 + audit;敏感表不受預設影響 | §4.2 層 4 僅非敏感;`default_form_actions` 預設 `{}` |
| owner 短路被冒用 | `created_by` 由後端於建表時寫入(actor context),非 client 可控;NULL 不授權 | M1 建表路徑填 created_by;不接受請求體覆寫 |
| 跨租戶操作分類/授權 | 每操作 tenant-scope(不存在即 404);分類 FK 同租戶 app 層驗 | AuthzAdminService mustCategory(tenant) |
| 覆寫層繞過繼承收緊 | 覆寫為**絕對集**且跨角色聯集「較寬鬆勝」= 既有語意;收緊靠移除授權非負向覆寫(MVP 不做 deny-delta,OQ-ARI-2)| §5.1 |

Input validation:分類 `name`(trim / max 長度 / 非空 / tenant 內唯一);`actions[]` 逐值 `isFormAction` 白名單(拒未知動作);`categoryId`/`roleId` 存在性 + 同租戶。

### 7-bis.6 向後兼容 + Rollout

- **零回歸**:migration 純加法可空;既有 `form_permissions` 語意不變;`category_id=NULL` + `default_form_actions={}` → 解析退化為現行逐表 deny-by-default。**功能惰性**,admin 建立分類並授權後才生效。
- **Feature 邊界即資料狀態**:無需 feature flag —— 未建分類 = 未啟用。可先對單一 pilot 租戶建分類試行。
- **遷移摩擦解**(正式回應 authz.md OQ-AUTHZ-4 標記的張力):Ragic 遷入客戶習慣 allow-by-default → admin 遷移期可 (a) 設 `default_form_actions=['view']` 軟性全員可讀,或 (b) 建分類批次歸類後一次授權;上線後再收緊。此為**租戶自助**,無需顧問。
- **Rollback**:drop 0008 新增物件即回 P0-4a;`form_def` 三欄 drop 無下游依賴。

---

## 8. 測試策略

| 層級 | 覆蓋 | 位置 |
|---|---|---|
| Unit | 分層解析:層級優先序(覆寫>繼承>預設)/ owner 短路 / admin / **敏感表跳過繼承與預設** / 跨角色聯集(A 覆寫 ∪ B 繼承)/ 未分類走預設 / 預設空=deny / 欄位仍 clamp 於繼承來的動作集 | `authz-effective.test.ts` 擴充 |
| Integration(Testcontainers 真 PG)| 建分類→授權→**新建表落分類自動可讀**(核心收斂斷言)· 逐表覆寫壓過繼承 · 敏感表在授權分類下仍 403 · 未分類 + 預設 view 可讀 / 預設空 403 · **跨租戶仍隔離**(分類繼承不破 RLS)· 刪分類→表回退未分類不孤兒 | `tests/` |
| e2e | 建分類→設分類授權→建新表歸類→切換使用者驗證免逐表配置即可見;覆寫某表→驗證偏離;標敏感→驗證鎖 | Playwright,固化進 CI |

**核心收斂斷言**:分類已授 view 後,**新建表單無需任何逐表操作**,該角色即可在 list 見到並讀取 —— 直接驗證「維護量不隨表單數膨脹」。

---

## 9. 落地順序與里程碑

| 里程碑 | 內容 | 預估 | 狀態 |
|---|---|---|---|
| **M0** 設計 review | 本檔 → APPROVED(裁定 OQ-ARI-1..8;deep-research 錨定)| 0.02 mo | ✅ |
| **M1** A1 資料模型 | migration 0008(form_categories / category_permissions / form_def +3 欄 / tenants.default_form_actions,純加法)+ Drizzle schema + AuthzRepository(分類 CRUD / 歸類 / 分類授權 upsert / loadFormMeta / 預設 profile)+ createFormDraft 填 created_by(**dev stub actor 查無使用者→存 null,避免 FK 打斷 dev 建表**);10 integration | 0.05 mo | ✅ |
| **M2** A2 繼承解析 | `buildEffectivePermissions` 分層升級(owner=資料動作 design 除外 OQ-4=B / 覆寫 / 分類繼承 / 預設;敏感 gate)+ PermissionService 注入分類/metadata/預設(無角色不早退)+ `listableForms()` 三態(readable/locked/hidden,OQ-8)+ `adminPermissions()`;21 unit + PermissionService 端到端 integration | 0.05 mo | ✅ |
| **M3** A3 管理 API | AuthzAdminService + Controller 分類 CRUD / 歸類 / 敏感(admin-only)/ 分類授權 / 預設 profile / resources 矩陣資料源;forms list OQ-8 三態(locked stub);13 integration + 196 全套件綠 | 0.04 mo | ✅ |
| **M4** A4 管理 UI | FormMatrix 分類分組 + builder 分類/敏感設定 + 清單鎖定 stub(OQ-8);對照 mockup;Playwright 實走(前端獨立 commit)| 0.05 mo | ⏳ |
| **M5** A5 遷移工具 + doc | 預設 profile 設定面 + 一鍵過渡;doc → v1.0 + MODULES.md → ✅ | 0.02 mo | ⏳ |
| **M6** FMEA 收尾(R17)| §12 逐路徑;P0 全清才 SHIPPED | 0.02 mo | ⏳ |

---

## 10. 開放問題（OQ-ARI-N）— ✅ 已裁定 2026-07-24

> 建議欄由 2026-07-24 deep-research 證據錨定(§10-bis)。⭐=研究結論與初版推理不同。**「裁定」欄記最終選擇 —— 全數採建議,OQ-4 採翻案 B、OQ-8 採折衷。**

| # | 議題 | 選項 | 建議(證據錨定)| 裁定 |
|---|---|---|---|
| **OQ-ARI-1** | 分類結構 | A. **平面分類**(表單→分類單層)<br>B. 分類樹(多層巢狀繼承) | **A 平面** — Drive/Notion 雖支援多層巢狀,但本平台 `O(表單)→O(分類)` 痛點**單層即解**;`parent_id` 保留,規模到再開。多層徒增解析複雜度,MVP 不值。§10-bis D1 | ✅ **A** |
| **OQ-ARI-2** | 覆寫語意 | A. **絕對集**(逐表列=該表最終動作集,UI 由繼承值預填)<br>B. 加減 delta(+授予 / −撤銷) | **A 絕對集** — Drive/Notion 覆寫皆**雙向**(可更嚴或更寬),絕對集天然涵蓋雙向 + **零 schema 變更**(重用既有 `form_permissions`)。§10-bis D1 | ✅ **A** |
| **OQ-ARI-3** | 未授權之**非敏感**表預設 | A. **租戶 profile,預設空=deny**(admin 可設 view 作軟 allow)<br>B. 恆 deny<br>C. 恆可讀 | **A** — 正是 **Salesforce OWD 範式**(組織級預設 baseline + 上層只能開放不能收緊,官方明建議「先鎖死→選擇性開放」);預設空=deny 保安全 + 零回歸。§10-bis D4 | ✅ **A** |
| **OQ-ARI-4** ⭐ | owner 短路範圍 | A. 全動作**含 design**<br>B. 全**資料動作**,**design 除外**<br>C. 不做 owner | **B(研究翻案,初版為 A)** — 跨消費級(**Notion** "No more database accidents":拆「用資料」vs「改 schema」)與企業級(**Salesforce** record owner vs Customize Application)**最一致的鐵則=用資料 ≠ 改結構**。故 owner 得全部資料動作(view/create/edit/delete/approve/export),**design 不自動給**,留明確授權/admin — 貼合 Weyver「取代 ERP」治理定位。§10-bis D2 | ✅ **B**(翻案)|
| **OQ-ARI-5** | 敏感表與繼承 | A. **跳過繼承+預設**(只認 owner/覆寫)+ admin-only + audit<br>B. 僅 UI 標記 | **A** — **微軟 Purview** 容器 label 刻意**不被 item 繼承**、走獨立更嚴路徑(admin-only 設定、可強制 step-up auth);敏感=獨立嚴格機制非裝飾。強化:切換 admin-only + audit,並可為敏感表加更嚴稽核要求。§10-bis D3 | ✅ **A** |
| **OQ-ARI-6** | 新表預設分類 | A. **未分類**(走預設 profile;builder 可選)<br>B. 部門預設分類<br>C. 強制選 | **A 未分類** — 最低摩擦;owner 保證建立者可用,他人可見由預設 profile 決定。B 需部門↔分類對映(尚無)、C 打斷快速建表。§10-bis D4 | ✅ **A** |
| **OQ-ARI-7** | 分類級欄位授權 | A. **不做**(欄位收斂於表單動作集)<br>B. 分類級欄位預設 | **A 不做** — 欄位跨表語意不通,無自然對映;維持現行 clamp。(無外部反證)| ✅ **A** |
| **OQ-ARI-8** ⭐新 | 無權表單:隱藏 vs 顯示鎖定 | A. **隱藏**(現行 authz.md G4:連存在都不知)<br>B. **顯示但鎖定 + 申請存取**(Drive 模式)<br>C. **折衷** | **Google Drive** 破繼承後「看得到但打不開 + request access」緩解遷移期「東西不見了」;但與「不洩漏存在」安全立場相衝。§10-bis D1/D4 | ✅ **折衷** — 非敏感/未分類/遷移期走 B(顯示鎖定+申請存取);**敏感表恆 A**(隱藏,守 authz.md G4 不洩漏存在)|

---

## 10-bis. 向上設計研究證據（2026-07-24 deep-research；§10 建議之錨）

> 22 來源 → 79 claims → 三票對抗式查證 25 條 → 19 confirmed / 6 killed。以下為存活(confirmed)發現;**建議屬本文綜合推斷,各系統機制本身為廠商文件明載**(引用如註)。

**D1 · 資源軸繼承 + 覆寫 + 破繼承**
- **Google Drive**:預設「擴張式繼承」——「Every user who has access to a folder also has access to all items inside」;破繼承用資料夾層 boolean `inheritedPermissionsDisabled`;破繼承後受限項「**看得到但打不開**」+ request-access flow(緩解「東西不見了」);破繼承設定權保留給高權限角色(Manager)。〔developers.google.com/workspace/drive/api/guides/limited-expansive-access〕
- **Notion**:子頁預設繼承父層,可個別**覆寫(雙向:更嚴或更寬)**;破繼承**不 cascade 既有子項**(只影響該頁 + 之後新建)。〔notion.com/help/sharing-and-permissions〕
- → 支撐 OQ-1(繼承)/OQ-2(絕對集覆寫涵蓋雙向)/OQ-8(顯示鎖定)。

**D2 · 用資料 ≠ 改結構(最一致鐵則;OQ-4 翻案依據)**
- **Notion**:刻意拆「Can edit content」(增刪 row、改值,**不能**加/刪 property、改型別、改 view/filter/sort)vs 改 schema;官方公告 **"No more database accidents"**,文件稱防「accidental changes to your carefully designed systems」。〔notion.com/help/guides/assign-custom-database-permissions;x.com/NotionHQ/status/1491098946428891138〕
- **Salesforce**:record ownership(用資料)與 **Customize Application**(改 metadata/結構)為**不同權限**;owner 碰不到物件/欄位 metadata。〔trailhead.salesforce.com/.../data_security_records〕
- → **消費級與企業級在此高度一致**:用資料與改結構分權。故 OQ-4 建議 **B**(owner 不含 design)。⚠️ 已知執行面漏:Notion content editor 仍能建 linked database 帶自訂 view(設計意圖 vs 執行強度落差,實作須防類似繞道)。

**D3 · 敏感旗標(OQ-5 依據)**
- **微軟 Purview**:容器 sensitivity label「**Items…do not inherit the labels**」(刻意不繼承);label 由 **admin** 設定、與日常 ACL 分離;可 set-and-lock 隱私值(防繞過);可經 Entra Conditional Access 對受標資源強制**更嚴存取**(MFA/擋非管理裝置)。加密為 content-bound(隨項目走,非位置繼承)。〔learn.microsoft.com/purview/sensitivity-labels-teams-groups-sites;/purview/encryption-sensitivity-labels〕
- → 敏感=**獨立、更嚴、admin-only、可加稽核**的機制;支撐 OQ-5=A。

**D4 · 新建預設 + deny-by-default 遷移(OQ-3 依據)**
- **Salesforce OWD**:most-restrictive baseline 四級(Private / Public Read Only / Public Read-Write / Controlled by Parent);上層(role hierarchy / sharing rules / manual sharing)**只能 grant 不能 restrict** 到 OWD 以下;官方建議「用 OWD 鎖死→再用其他工具開放」。〔trailhead.salesforce.com/.../data_security_records〕
- → **組織級預設 + 選擇性開放**正是本平台要遷入的模型;支撐 OQ-3=A(租戶 profile 預設空=deny)。

**證據缺口 / 保留(誠實標注)**
- **Ragic**:所有 Ragic claim(D1 無容器繼承 / D2 schema 權集中 SYSAdmin / D4 Everyone 群組)在對抗式查證中**被駁回或未達票數**(0-3 / 1-0 / abstain)→ 不可靠,**不以 Ragic 為 baseline**;需另行一手查證 `ragic.com/doc/11/access-rights`。
- **Airtable / Odoo**:本輪無存活 claim → D2「Airtable creator 能否改 field schema」、Odoo `ir.model.access` 對照**未查證**;若要完成低程式碼三家分歧點需補查。
- 敏感語義(阻斷繼承 vs content-bound 加密層)兩者成熟系統並存,本平台採哪種依 RLS/tenant 架構另定(傾向阻斷繼承,對齊表單級模型)。
- 破繼承/覆寫是否**溯及既有子項**:Notion 選擇不溯及;本平台從逐表列舉遷入時,既有 `form_permissions` 列如何與新繼承協調 = 遷移設計問題(M5 處理)。

---

## 11. SOP — 日常操作

### 11.1 建立分類並授權(admin)

1. 進 `/app/settings/permissions` → 選角色 → 表單權限。
2. 分類列設動作(如「採購 · 進銷存」給 view/create/edit/export)→ 該分類下表單即繼承。
3. 建新表 → builder 設定選「採購」分類 → 該角色**免再配置**即可見可做。

### 11.2 例外處理

| 需求 | 操作 |
|---|---|
| 某表比分類多/少一個動作 | 該表列點勾 → 寫覆寫(絕對集);「還原繼承」= 刪覆寫列 |
| 某表機密(傳票/薪資)| builder 標「敏感」→ 停止繼承,只 owner/明確覆寫可存取 |
| 遷移期先讓全員能讀 | 設定 → 租戶預設 profile = `view`;上線後改回空並逐分類收緊 |

### 11.3 審計查詢

```sql
-- 某角色對某表的有效來源(覆寫 / 繼承 / 敏感)
SELECT f.id, f.name, f.is_sensitive, f.category_id,
       fp.actions AS override_actions,
       cp.actions AS category_actions
FROM form_def f
LEFT JOIN form_permissions     fp ON fp.form_id = f.id AND fp.role_id = :roleId
LEFT JOIN category_permissions cp ON cp.category_id = f.category_id AND cp.role_id = :roleId
WHERE f.tenant_id = :tenantId AND f.deleted_at IS NULL;
```

---

## 12. 失效場景反思（FMEA）— M6 收尾填

> 逐路徑:失效模式 → 影響 → 嚴重度 → 緩解狀態。P0 未 ✅ 不得 SHIPPED。（M6 填寫;以下為 pre-mortem 預列）

### 12.1 繼承解析

| # | 場景 | 影響 | 預定緩解 | Sev |
|---|---|---|---|---|
| I1 | 敏感表誤吃分類繼承 | 敏感資料外洩 | 敏感 gate 跳層 3/4;整合測「敏感表在授權分類下仍 403」 | P0 |
| I2 | 預設 profile 誤設過寬 | 全租戶越權可讀 | 預設空=deny;放寬需 admin + audit;敏感不受影響 | P0 |
| I3 | owner 短路被請求體冒用 | 越權全動作 | created_by 後端 context 寫入,不接受 client 覆寫;NULL 不授權 | P0 |
| I4 | 覆寫/繼承聚合誤放行 | 過度授權 | 跨角色聯集為既有語意(較寬鬆勝);覆寫絕對集覆蓋;單元測覆蓋層級優先序 | P1 |

### 12.2 部署順序

| # | 場景 | 風險 | 緩解 |
|---|---|---|---|
| D1 | 後端 code 先於 migration 0008 | 缺欄/表 → authz 查詢 500 | migration 必先(R10);純加法可空 → 舊 code 對新欄無感 |

### 12.3 不在本模組 scope

- 記錄級 row filter → P1-I(authz.md OQ-3=A)。
- 分類樹多層繼承 → OQ-ARI-1 保留欄,未啟用。
- 負向覆寫(deny-delta)→ OQ-ARI-2 未採,待真實需求。

> **檢查點**:M6 填畢,所有 P0 ✅ 方可 SHIPPED。

---

## 13. 變更紀錄

| 日期 | 版本 | 變更 | 作者 |
|---|---|---|---|
| 2026-07-23 | v0.1 | 初版 DRAFT — 資源軸繼承(分類授權層 + owner 短路 + 敏感旗標 + 租戶預設 profile);既有 `form_permissions` 重新定位為覆寫層;OQ-ARI-1..7 待裁定。承 authz.md P0-4a。UI 對照 `permissions-resource-inheritance.html` | Claude Code |
| 2026-07-24 | v0.2 | **向上設計研究錨定**(deep-research 22 來源/19 confirmed;§10-bis)。**OQ-ARI-4 翻案 A→B**:Notion("No more database accidents")+ Salesforce(record owner vs Customize Application)一致證明「用資料 ≠ 改結構」→ owner 得全資料動作但 design 除外;§1.1/§4.2/§5.1 同步。OQ-3(Salesforce OWD 範式)/OQ-5(Purview 容器 label 不繼承 + admin-only)/OQ-1·2(Drive 破繼承旗標 + Notion 雙向覆寫)證據強化。新增 **OQ-ARI-8**(無權表單 隱藏 vs 顯示鎖定 + 申請存取,Drive 模式)。誠實標注 Ragic/Airtable/Odoo 證據缺口 | Claude Code |
| 2026-07-24 | v0.3 | **OQ-ARI-1..8 全裁定;DRAFT → APPROVED,進 M1**。1=A · 2=A · 3=A · **4=B**(owner design 除外)· 5=A · 6=A · 7=A · **8=折衷**(非敏感/未分類/遷移期顯示鎖定+申請存取、敏感恆隱藏)。OQ-8 折衷折入 §5.1(`listableForms()` 三態 readable/locked/hidden)+ §6.2(鎖定 stub + access-request + 敏感 admin-only/audit);§9 M0 ✅、M2-M4 納 owner-B/三態/access-request | Claude Code |
