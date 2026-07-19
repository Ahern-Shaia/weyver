# auth.md — [F-2] 認證 + 租戶 context + 使用者身分 設計文件

> ✅ **狀態:APPROVED — OQ-AUTH-1..8 全採建議(2026-07-19 裁定)**;AUTH-8 = **場景 A(多 org 隔離切換,一次一家)**;**場景 B(代管母子 + 跨廠合併)非本模組**,僅便宜預留 `tenants.parent_tenant_id`。進 M1。
>
> **一句話**|把 dev 期的 `x-dev-tenant` header 換成**真實認證**:使用者登入 → 伺服器驗證的 session/JWT → 從中取**可信的 tenant_id + 使用者身分**,取代 `DevTenantGuard`。**這是 R1 對外上線的硬前提**(form-engine-core / form-designer-ui / grid / formula 皆標「對外 prod 前提 = F-2」)。
>
> **上游**|`DevTenantGuard`(prod 已 fail-closed)+ `TenantContext { tenantId, actorId }` 介面(services 已依賴)· docs/21(多租戶 auth 架構,已選 Better Auth + nestjs-cls + JWT tenant_id)· docs/22(威脅模型)· AGENTS 🔒(JWT / 租戶鐵則)。
>
> **不含**|三層權限(form/field/record RBAC)= **P0-4**;企業 SSO/SAML/SCIM = 後續;本模組只做 **authn + 租戶解析 + 使用者/組織身分**。
>
> 作者:Claude Code(草擬)
> 版本:v0.1(2026-07-19)

---

## 1. 目標與範圍

### 1.1 目標

1. **使用者可註冊 / 登入 / 登出**(email+password MVP);密碼 **Argon2id**;session httpOnly cookie(token 不進 localStorage,AGENTS 🔒-4)。
2. **組織(= 租戶)**:使用者屬於 organization(Better Auth org);org 對映 Weyver `tenants`(bigint);多 org 使用者可切換 active org。
3. **API 每請求取可信租戶**:`AuthGuard` 由**伺服器驗證的 session**取 activeOrganizationId → 解析 `tenantId` + `actorId` → `request.tenantContext`(**同現有介面,services 不改**),取代 `DevTenantGuard`。
4. **租戶不可偽造**:tenantId **只出自伺服器驗證的 session**,剝除 client 送的租戶 header;驗證「路由候選 == session 租戶」(docs/21 §4:經典跨租戶洩漏破口)。
5. **使用者身分落地**:`users` 表(bigint id ↔ Better Auth user);`actorId`(記錄 created_by/updated_by)= users.id。
6. **隔離可證**:整合測斷言「A 使用者登入只能存取 A 的租戶資料;偽造 header 無效」。

### 1.2 對應 Stakeholder 訴求

- 對外上線硬前提|dev header 是明擺的洩漏面;prod 不可用(現已 fail-closed,等於 prod 不可服務)。
- docs/21 已定|Better Auth org(TS-native、in-process、多租戶 org + 成員 + 角色 + 邀請 + per-org SSO)。

### 1.3 不做的事(scope out)

- **不做三層權限**(form/field/record RBAC)= **P0-4**;本模組 authz 僅「登入 + 屬於此租戶」門檻。
- **不做企業 SSO / SAML / SCIM**|Better Auth plugin 具備,但簽約級驗證 + 上線留後續(docs/21 §5 ⚠️ SAML SP 較年輕)。
- **不做 nestjs-cls 全面改造**|現行 services 顯式傳 `tenantId` + `inTenantTx` SET LOCAL 已安全(見 OQ-AUTH-5)。
- **不做密碼重設 / MFA / 裝置管理之完整版**|MVP 基本;帳號安全操作面(session/裝置/密碼政策)= docs/04 A「帳號安全」併本模組但分階段。
- **不改 RLS / 動態表引擎**|沿用 form-engine-core 的 `SET LOCAL app.tenant_id` + FORCE RLS。

---

## 2. 上游 / 既有現況走查

| 子題 | 現況 | Gap |
|---|---|---|
| 租戶識別 | `DevTenantGuard` 讀 `x-dev-tenant`(prod fail-closed AUTH_NOT_CONFIGURED)| 換 `AuthGuard`(驗 session → tenantId)|
| context 介面 | `TenantContext { tenantId, actorId }` + `@Tenant()` decorator;services 依賴之 | **保留介面**,只換來源 → services 零改 |
| tenant context 傳 DB | `RecordService.inTenantTx` 每 tx `set_config('app.tenant_id')` + FORCE RLS | 沿用;tenantId 來源改 session |
| auth 套件 | ❌ 未裝(無 better-auth / nestjs-cls / argon2 / jose)| 裝 Better Auth + argon2 |
| users / org 表 | ❌ 無 users 表;`created_by`/`actorId` 為自由 bigint(無 FK)| 加 `users` + `tenants.auth_org_id` 對映 |
| 前端登入 | ❌ 無(dev tenant 存 localStorage)| Better Auth client + 登入頁 + 同源代理 |

---

## 3. 剩餘 scope 切分

| 子題 | 內容 | 難度 |
|---|---|---|
| **A1 Better Auth 接入** | 掛於 apps/api(Fastify handler)+ auth 表(user/session/account/organization/member/invitation)於同一 PG;org plugin;Argon2id | 高 |
| **A2 AuthGuard** | 驗證 session(getSession)→ activeOrg → tenantId + actorId → `request.tenantContext`;剝除 client 租戶 header | 高(安全)|
| **A3 org↔tenant + user↔actor 對映** | `tenants.auth_org_id`(org 建立 → tenant 建立 + 連結)· `users`(bigint ↔ auth_user_id,首次登入建/連)| 中 |
| **A4 前端登入流** | Better Auth client(登入/登出/註冊)+ 受保護路由 + 同源代理(如 engine API)+ active org 切換 | 中 |
| **A5 安全硬化** | Argon2id / session cookie httpOnly+SameSite / CSRF / rate-limit 登入 / secrets(Infisical)| 高(安全)|
| **A6 隔離測試** | 真 Better Auth 登入 → 只存取自己租戶;偽 header 無效;跨租戶拒 | 高 |

---

## 4. A1|Better Auth 接入(認證權威)

- **放哪**|掛於 **apps/api**(OQ-AUTH-1):Better Auth 是 framework-agnostic core + Node/Fastify handler;auth 表建於**同一 Weyver PG**(與 metadata 同庫,交易一致);前端經**同源代理**(如 `/api/engine/*` 之於引擎)打 `/api/auth/*`。
- **plugins**|`organization`(多租戶 org + 成員 + 角色 + 邀請);`admin`(基本);SSO/SCIM plugin **裝但 MVP 不啟**。
- **密碼**|覆寫預設 hash 為 **Argon2id**(OQ-AUTH-6;AGENTS 🔒-4)。
- **auth 表**|Better Auth 自管其 schema(獨立 migration / 或納入 Drizzle 車道,見 OQ-AUTH-3);與 Weyver `tenants`/`users` 以對映欄連結,不混。

## 5. A2|AuthGuard(取代 DevTenantGuard)

```
每請求:
  session = betterAuth.getSession(request.headers)   // 伺服器驗證 cookie(DB session lookup)
  if !session → 401 UNAUTHENTICATED
  orgId = session.activeOrganizationId               // 伺服器來源,非 client header
  if !orgId → 403 NO_ACTIVE_ORG
  tenantId = tenantByAuthOrg(orgId)                  // 對映(快取)
  actorId  = userByAuthUser(session.user.id)         // 對映(快取)
  剝除 request.headers 之任何 client 送的租戶欄
  (若路由帶租戶候選)驗證 == tenantId,不符 → 403
  request.tenantContext = { tenantId, actorId }      // 同現有介面
```

- **可信來源**|tenantId **只出自伺服器驗證的 session 之 activeOrg**;client 永遠不能指定租戶(docs/21 §4)。
- **零改 services**|`TenantContext` 介面不變 → RecordService/DdlService/... 完全不動。
- **session vs JWT**|MVP 用 Better Auth **session 驗證(getSession,可撤銷)**;跨服務 / stateless(Edge/MES)需要時再啟 **JWT plugin**(OQ-AUTH-2)。session 驗證仍滿足「伺服器驗證租戶非 client」原則。

## 6. A3|對映(org↔tenant · user↔actor)

- **org ↔ tenant**|Weyver `tenants`(bigint,RLS 之 tenant_id)加 `auth_org_id text unique` + **`parent_tenant_id bigint nullable`(便宜預留巢狀租戶 / 代管母子,MVP 不實作跨租戶讀取,只留欄位)**;**org 建立 hook → 建 tenant + 連結**。RLS / 動態表 tenant_id 續用 bigint,不動。
- **user ↔ actor**|新 `users`(bigint id, `auth_user_id text unique`, email, name);**首次登入 / 加入 org → upsert users**;`actorId` = users.id(記錄 created_by/updated_by 之來源)。
- **對映快取**|orgId→tenantId / userId→actorId 熱路徑 → 記憶體 / Redis 快取(變更失效)。

---

## 7-bis. 企業級 cross-cutting 檢核(安全關鍵)

### 7-bis.1 安全模型(本模組即認證主戰場)
- **租戶偽造**|tenantId 只出自伺服器 session;剝除 client 租戶 header;路由候選 == session 租戶(docs/21 §4)。✅ 設計核心
- **密碼**|Argon2id;不落 log;不回傳 hash(DTO 排除)。
- **session/cookie**|httpOnly + Secure + SameSite=Lax/Strict;token 不進 localStorage(AGENTS 🔒-4)。
- **JWT(若啟)**|`verify` algorithms 白名單、拒 `alg:none`、RS256/ES256、驗 exp/iss/aud(AGENTS 🔒-4)。
- **登入暴力**|`@nestjs/throttler` 嚴限登入 route;帳號鎖定 / 漸進延遲。
- **CSRF**|cookie-based → CSRF token / SameSite;Better Auth 內建。
- **secrets**|Better Auth secret / DB 憑證走 Infisical,零進碼(AGENTS 🔒-6)。
- **enumeration**|登入 / 註冊錯誤訊息不洩漏帳號是否存在。

### 7-bis.2 容量 / 失效
- getSession 每請求一次 DB lookup(session 表索引;可加短快取)。
- auth 服務掛 → API fail-closed 401(核心 ERP 不因 auth 降級而洩漏)。

### 7-bis.3 資料生命週期
- 使用者刪除 / org 移除成員 → session 失效;`created_by` 保留(審計,users 軟刪不影響歷史)。

### 7-bis.4 向後兼容 + Rollout
- **DevTenantGuard 保留於 dev/test**(prod 已 fail-closed);AuthGuard 為 prod 守衛。逐路由由 Dev→Auth 切換,或全域換 + 測試用真 auth seed(OQ-AUTH-7)。
- 既有 88 api 測試以 DevTenantGuard / 直接建構 service(不經 guard)→ **不受影響**。

---

## 8. 測試策略

| 層 | 覆蓋 | 位置 |
|---|---|---|
| Vitest(api,Testcontainers 真 PG + 真 Better Auth)| 註冊/登入/登出 · session → tenantId 解析 · **偽 header 無效** · **A 登入讀不到 B 租戶** · Argon2id · 登入 rate-limit | apps/api/test |
| Vitest(api)| org↔tenant / user↔actor 對映 upsert · 多 org 切換 | apps/api/test |
| Playwright(固化)| 登入 → builder 可用(帶真 session)→ 登出 → 受保護頁跳登入 | apps/web/e2e |

---

## 9. 落地順序與里程碑

| 里程碑 | 內容 | 狀態 |
|---|---|---|
| **M0** 設計 review | 本檔 → APPROVED(裁定 OQ-AUTH-1..8)| ⏳ |
| **M1** A1 | Better Auth 掛 api + auth 表 + org plugin + Argon2id | 🚧 **認證引擎 ✅**(`src/auth/auth.ts` createAuth:Better Auth + pg pool + emailAndPassword + **Argon2id**(@node-rs/argon2)+ organization plugin;auth 表由 Better Auth migration 建;4 整合測:表建立 / 註冊→Argon2id / 登入正誤 / 列舉防護)· **NestJS provider + Fastify `/api/auth/*` handler 掛載併 M3(getSession 需之)** |
| **M2** A3 | users / tenants.auth_org_id + org/user 對映 + upsert hook | ⬜ |
| **M3** A2 | AuthGuard(getSession → tenantContext)+ 剝 header + 隔離測試 | ⬜ |
| **M4** A4 | 前端登入 / 登出 / 註冊 + 受保護路由 + active org 切換 + 同源代理 | ⬜ |
| **M5** A5 + 收尾 | 安全硬化(rate-limit / CSRF / secrets)+ Playwright 固化 + FMEA + SHIPPED | ⬜ |

---

## 10. 開放問題(OQ-AUTH-N)— ✅ 已裁定(2026-07-19,全採建議)

| # | 議題 | 選項 | 裁定 |
|---|---|---|---|
| **OQ-AUTH-1** | Better Auth 放哪 | A. 掛 apps/api(Fastify handler,同 PG)<br> B. 掛 apps/web(Next)<br> C. 獨立 auth 服務 | **A** — 與 metadata 同庫交易一致、NestJS Guard 直接驗、前端同源代理;獨立服務為未來(Edge/MES 需 stateless 時)|
| **OQ-AUTH-2** | API 請求驗證 | A. session 驗證(getSession,可撤銷)<br> B. JWT plugin(stateless)<br> C. 兩者 | **A**(MVP)— Better Auth native + 可撤銷;跨服務 / Edge 需要時再加 **B**。兩者皆「伺服器驗證租戶非 client」,滿足 docs/21 原則 |
| **OQ-AUTH-3** | auth schema 與 Weyver 表 | A. Better Auth 自管其表 + 對映欄連結 <br> B. 全納入 Drizzle 手管 | **A** — Better Auth 管 user/session/org 等,Weyver 加 `tenants.auth_org_id` + `users.auth_user_id` 連結;減少手維護 auth schema 之風險 |
| **OQ-AUTH-4** | user↔actor | A. 新 `users`(bigint ↔ auth_user_id),actorId=users.id <br> B. created_by 改存 auth user string id | **A** — bigint actorId 相容既有 created_by/updated_by(避免動全引擎之 bigint→text)|
| **OQ-AUTH-5** | nestjs-cls | A. F-2 不改,續顯式傳 tenantId(inTenantTx 已 SET LOCAL)<br> B. F-2 就導入 CLS | **A** — 現行顯式傳 + SET LOCAL 已安全且測試完備;CLS 為 ergonomics,背景工作 / 深巢狀出現時再導(docs/21 之 CLS 仍為方向)。降低 F-2 對已 SHIPPED 引擎的改動面 |
| **OQ-AUTH-6** | 密碼 hash | A. Argon2id(覆寫 Better Auth 預設)<br> B. 用預設(scrypt)| **A** — AGENTS 🔒-4 明訂 Argon2id |
| **OQ-AUTH-7** | 測試 / dev guard | A. DevTenantGuard 留 dev/test(prod fail-closed)+ 新增真 auth 整合測 <br> B. 全面換 AuthGuard,所有測試用 auth seed | **A** — 既有 88 測試不受衝擊;auth 專屬測試走真 Better Auth;prod 只認 AuthGuard |
| **OQ-AUTH-8** | 多 org 使用者 | A. 支援(Better Auth active org 切換,MVP UI 最小)<br> B. MVP 單 org | **A(限場景 A)** — 一人屬多 org、**一次一家、各家 RLS 完全隔離**(顧問跨廠 / 集團多廠區)。⚠️ **場景 B(代管公司要跨廠合併視角 / 代子廠操作)非本模組** —— 那是巢狀租戶 + 跨租戶讀取(docs/21 outgrow → Cerbos),另立設計;本模組僅**便宜預留 `tenants.parent_tenant_id nullable`**(不實作跨租戶讀取)|

---

## 11. SOP — 日常操作

> M5 收尾填(建租戶/邀成員 / 排查登入失敗 / session 撤銷 / 對映修復)。

---

## 12. 失效場景反思(FMEA)— 收尾必填(R17)

> M5 收尾逐路徑填(登入 / session 驗證 / 租戶偽造 / 跨租戶 / 對映缺失 / auth 服務掛 / 暴力登入)。**P0 未緩解不得上 prod** —— 本模組即「上 prod 前提」,FMEA 尤重跨租戶與偽造。

---

## 13. 變更紀錄

| 日期 | 版本 | 變更 | 作者 |
|---|---|---|---|
| 2026-07-19 | v0.3 | **M1 認證引擎落地**|`src/auth/auth.ts`(Better Auth 1.6 + pg pool + emailAndPassword + Argon2id + organization plugin;secret 由呼叫端注入不散落 env);getMigrations 建 auth 表;4 Testcontainers 整合測(表 / 註冊 Argon2id / 登入正誤 / 列舉防護)綠。NestJS provider + Fastify handler 掛載併 M3 | Claude Code |
| 2026-07-19 | v0.2 | OQ-AUTH-1..8 全採建議裁定;AUTH-8 限**場景 A**(多 org 隔離切換);**場景 B 代管母子非本模組**,僅預留 `tenants.parent_tenant_id`;狀態 → APPROVED,進 M1 | Claude Code |
| 2026-07-19 | v0.1 | 初版 DRAFT — F-2 認證 + 租戶 context + 使用者身分;A1–A6 切分 + OQ-AUTH-1..8;上游 = DevTenantGuard + TenantContext 介面 + docs/21 架構(Better Auth + JWT tenant_id + nestjs-cls);對映 org↔tenant / user↔actor 為整合關鍵;保留 TenantContext 介面 → services 零改 | Claude Code |
