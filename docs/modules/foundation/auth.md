# auth.md — [F-2] 認證 + 租戶 context + 使用者身分 設計文件

> ✅ **狀態:SHIPPED v1.0(2026-07-19)** — M0–M5 全數完成。dev 期 `x-dev-tenant` 已由**真實 Better Auth 認證**取代(prod);登入 → session → 可信 tenant + actor,跨租戶隔離 e2e 綠、FMEA P0 全緩解。
>
> OQ-AUTH-1..9 全採建議裁定;AUTH-8 = **場景 A(多 org 隔離切換,一次一家)**,場景 B(代管母子)僅預留 `tenants.parent_tenant_id`;AUTH-9 = 社群登入按角色分層 + 不得為唯一 owner(§6-bis)。
> **後續**(非 F-2 阻擋):三層 form/field/record RBAC = P0-4;企業 SSO/SAML/SCIM;MFA / 密碼重設完整版;JWT plugin(Edge/MES stateless 需要時)。
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
   - **登入方式按角色分層**(§6-bis 治理決策):現場人員可 email+密碼 / 可選 LINE 便利登入;**管理員 / owner 走公司可控身分**(公司 email / 企業階段 SSO)—— 個人社群登入用在企業級治理會出事(見 §6-bis)。
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

## 6-bis. 登入方式分層 + 帳號治理(企業級核心決策)

> **問題(反思)**|個人社群登入(如 LINE)綁的是「**那個人**」的帳號,公司管不到 —— **管理員離職,無法收回其個人 LINE**。純便利登入用在企業級治理會出事:①擁有權孤兒(唯一 owner 離職 → 租戶卡死)②公司無法控管(不能強制改密 / 稽核;HR 停用不連動)③無自動 deprovision。

**原則|登入方式 = 便利層;租戶治理錨點必須公司可控 + 可回收。**

### 登入方式(按角色分層)
| 角色 | 登入方式 | 理由 |
|---|---|---|
| 現場人員(低權限)| email+密碼 / **可選 LINE 登入**(便利)| 免記密碼、掃碼即進;離職移除成員即失效,零治理風險 |
| 管理員 / org owner | **公司可控身分**:公司 email+密碼(org 管)/(企業階段)公司 SSO | 公司能強制改密 / 稽核 / 停用;不綁個人社群帳號 |

### 帳號治理鐵則(F-2 決策)
1. **租戶屬公司非登入者**|org owner **可被平台回收**(客服 break-glass 重指派)→ 杜絕「唯一 owner 離職 → 租戶卡死」。
2. **社群登入不得為唯一 owner**|建 org 時至少一個公司-email 管理員;政策擋個人社群帳號當 sole owner。
3. **帳號連結模型**|Weyver user 主身分 = 公司 email;LINE/Google = 額外**連結**的便利登入。**移除成員 → 所有連結登入一起失去此租戶存取**(offboarding 一刀切,見 §11)。
4. **SSO 為企業正解(後續)**|真企業客戶走公司 SSO(Entra/Okta/Google Workspace)→ IdP deprovision 連動所有存取自動失效。F-2 MVP 不啟(§1.3),但架構(帳號連結 + owner 可回收)已為其鋪路。

### LINE 三產品別混(釐清)
- **LINE Login**(OIDC)= 認證**個人身分**;**Messaging API 個人**(1:1 推好友)/ **群組**(bot 在群)= **通知投遞**。Login ↔ 個人通知共 userId(需同 provider linked)可順帶綁定;**群組通知與登入解耦**(org 層設定 bot + 群 id)。
- ⚠️ **LINE Notify 已 2025-03 EOL** → 個人 / 群組通知皆走 Messaging API(docs/04 H 之「Notify」待修)。

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
| **M1** A1 | Better Auth 掛 api + auth 表 + org plugin + Argon2id | ✅ **DONE**|(a)認證引擎 `src/auth/auth.ts` createAuth(Better Auth + pg pool + emailAndPassword + **Argon2id**(@node-rs/argon2)+ organization plugin;auth 表由 Better Auth migration 建)·(b)**NestJS DI 接入** `src/auth/auth.module.ts`(@Global,`AUTH` Symbol token via useFactory:注入特權 `PG_POOL`〔auth 表為 Tier-1 系統表非租戶 RLS〕+ `ConfigService` secret;註冊進 AppModule)·(c)`BETTER_AUTH_SECRET` 入 env schema(**prod fail-fast**,dev 回退明確佔位)· 測:4 整合(表 / 註冊→Argon2id / 登入正誤 / 列舉防護)+ 1 DI 解析(AUTH 接真實 pool 可登入)+ 4 env 單元;全 api e2e(9)boot AppModule 綠 · **Fastify `/api/auth/*` handler 掛載併 M3(getSession 需之)** |
| **M2** A3 | users / tenants.auth_org_id + org/user 對映 + upsert hook | ✅ **DONE**|(a)migration 0005:`users`(Tier-1 系統表:auth_user_id unique / email / name / soft-delete)+ `tenants.auth_org_id`(unique nullable)+ `tenants.parent_tenant_id`(自參照,預留場景 B)· 皆**非 RLS**(跨租戶系統表,走特權 DRIZZLE 車道)·(b)`IdentityService`:`ensureTenantForOrg`(冪等,unique 兜底並發)/ `upsertUser`(冪等 + email·name 漂移更新 + 復活清 deleted_at)/ `getTenantIdByOrg` / `getActorIdByUser`(軟刪回 null);註冊 AuthModule export(M3 guard 注入)· 測:5 整合(冪等 / unique / 未知回 null / 漂移 / 軟刪復活)· **provisioning 觸發時機(Better Auth `organizationHooks.afterCreateOrganization` 事件 hook vs 首次登入 JIT upsert)在 M3 併 guard 定案** —— 機制已 idempotent,兩者皆安全 |
| **M3** A2 | AuthGuard(getSession → tenantContext)+ 剝 header + 隔離測試 | ✅ **DONE**|(a)`AuthGuard`(prod):`auth.api.getSession`(cookie)→ `session.activeOrganizationId` → `IdentityService.getTenantIdByOrg` → tenantId;**剝除 client `x-tenant-id`/`x-dev-tenant`/`x-dev-actor`**;actorId 由首次登入 JIT `upsertUser`;無 session 401 / 無 active org 403 / org 未 provision 403 ·(b)`TenantGuard` 環境分派(prod→AuthGuard,dev/test→DevTenantGuard;職責/攻擊面隔離)· 控制器 `@UseGuards(TenantGuard)` ·(c)`TenantContext` 抽出 `http/tenant-context.ts`(services 零改)· `AUTH` token 抽出 `auth.tokens.ts` 解 module↔guard 循環 ·(d)**provisioning 觸發定案**:org→tenant 走 Better Auth `afterCreateOrganization` hook(建 tenant),user→actor 走 guard JIT upsert ·(e)測:5 隔離 e2e(prod session:無 session 401 / A 建表 / **B 讀不到 A** / **偽 header 無效** / 無 active org 403);全 api 套件 107 綠 |
| **M4** A4 | 前端登入 / 登出 / 註冊 + 受保護路由 + active org 切換 + 同源代理 | ✅ **DONE**|後端 `mountAuthHandler` 掛 `/api/auth/*`(configureApp,main + 測同構)· 前端 authClient(better-auth/react + organizationClient,baseURL 取瀏覽器 origin)· `/login`、`/register`(建帳號 + org → hook 建 tenant → 設 active)· `/app` 受保護 layout(**強制登入僅 prod**,對齊後端 TenantGuard dev/prod;登入設 active org;頂帶顯示公司 + 帳號 + 登出)· next.config `/api/auth` 同源代理 · 3 HTTP 整合測(handler 掛載 / cookie 經 guard / 429)· **Playwright MCP 實走**(註冊→builder→登出→登入,org 名解析) |
| **M5** A5 + 收尾 | 安全硬化 + Playwright 固化 + FMEA + SHIPPED | ✅ **DONE**|Better Auth rateLimit(寫端點 5/60s、get-session 放寬)· 安全標頭 onSend(X-Frame-Options/nosniff/Referrer-Policy/prod HSTS)· @nestjs/throttler 全域 · `BETTER_AUTH_URL` + `trustedOrigins` config · cookie httpOnly+SameSite · `e2e/auth.spec.ts` 固化(註冊→登出→登入,4 e2e 全綠)· **§12 FMEA P0 全緩解** · **SHIPPED v1.0** |

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
| **OQ-AUTH-9**(治理反思後裁定)| 社群 / LINE 登入政策 | A. 按角色分層 + 不得為唯一 owner + 帳號連結模型 <br> B. 全租戶統一 email+密碼 | **A**(2026-07-19 裁定)— 現場人員可 LINE 便利登入、管理層走公司可控身分;**社群登入不得為 sole owner**;offboarding 移除成員即連結登入全失效;SSO 為企業正解(見 §6-bis)|

---

## 11. SOP — 日常操作

- **建租戶 / 邀成員**|org 建立 → 建 tenant + 連結(§6);邀成員走 Better Auth invitation。
- **offboarding(離職,§6-bis)**|① org 移除成員 ② 撤銷其所有 session ③ 若為 owner → 先轉移擁有權(或平台 break-glass 重指派)④ 其連結登入(LINE/Google)自動失去此租戶存取。
- **排查**|登入失敗(密碼 / 帳號未驗)· session 過期 → 重登 · 對映缺失(org 無對應 tenant)→ 修 upsert · 疑跨租戶 → 查 AuthGuard 是否剝 client header + activeOrg 來源。
> 其餘 M5 收尾補(rate-limit 觀測 / secret 輪替)。

---

## 12. 失效場景反思(FMEA)— M5 收尾(R17)

> **P0 未緩解不得上 prod** —— 本模組即「上 prod 前提」,FMEA 尤重跨租戶與偽造。P0(1–4)全緩解。

| # | 路徑 / 失效模式 | 影響 | 嚴重 | 緩解 | 狀態 |
|---|---|---|---|---|---|
| 1 | **租戶偽造**:client 送 `x-tenant-id`/`x-dev-tenant` 綁架租戶 | 跨租戶讀寫 / 外洩 | **P0** | AuthGuard 剝除所有 client 租戶 header;tenantId 只出自 session activeOrg;隔離 e2e 斷言偽 header 無效 | ✅ |
| 2 | **跨租戶讀取**:A session 讀 B 資料(BOLA) | 資料外洩 | **P0** | tenantId 由 session 解析 + 每查詢綁 tenant + RLS FORCE;隔離 e2e「B 讀不到 A」 | ✅ |
| 3 | **session 偽造 / 竄改** | 未授權存取 | **P0** | Better Auth 伺服器驗證 session(DB lookup)+ 簽章 secret(prod fail-fast);cookie httpOnly+SameSite+(prod)Secure;token 不進 localStorage | ✅ |
| 4 | **密碼弱雜湊 / 明文** | 帳號淪陷 | **P0** | Argon2id(@node-rs/argon2)+ 整合測斷言 `$argon2id$`;response DTO 不回 hash | ✅ |
| 5 | **登入暴力** | 帳號淪陷 | P1 | Better Auth rateLimit `/sign-in/email`、`/sign-up/email` 5/60s;e2e 斷言 429 | ✅ |
| 6 | **org 未 provision**(登入後無 active org / tenant) | 使用者卡死 | P1 | afterCreateOrganization hook 建 tenant;login/register 設 active org;guard 回 403 NO_ACTIVE_ORG 明確 | ✅ |
| 7 | **provisioning 競態**(同 org 並發建立) | 重複 tenant | P2 | ensureTenantForOrg 以 `unique(auth_org_id)` 兜底 + 冪等;整合測 | ✅ |
| 8 | **auth 服務 / DB 掛** | 全站不可登入 | P1 | getSession 失敗 → 401 fail-closed(核心不因 auth 降級而洩漏);@nestjs/terminus health(後續) | ✅ 降級明確 |
| 9 | **對映缺失**(org 無 tenant / user 無 actor) | 請求失敗 | P2 | guard 回 403;user JIT upsert 冪等;可經 ensure 修復 | ✅ |
| 10 | **rate-limit 誤傷**:get-session 高頻輪詢被 429 | 正常使用中斷 | P1 | 寫端點才嚴限;`/get-session` 放寬 2000/60s;瀏覽器實測驗證(M4 已踩到並修) | ✅ |
| 11 | **enumeration**:登入洩漏帳號是否存在 | 資訊洩漏 | P2 | 登入錯誤統一「帳號或密碼錯誤」;整合測斷言 | ✅ |
| 12 | **CSRF / 跨源狀態變更** | 未授權變更 | P1 | SameSite=Lax cookie + `trustedOrigins` 白名單 + Better Auth 內建 origin 檢查 | ✅ |
| 13 | **baseURL 未設**(origin 推導 → callback/redirect 失效) | 登入異常 | P2 | `BETTER_AUTH_URL` 設定(prod 必設);dev 警告無害 | ✅ |

**殘留 P1/P2 追蹤**:@nestjs/terminus health(#8 觀測)· 密碼重設 / MFA(scope out,見 §1.3)· session 裝置管理 · 未來啟 JWT plugin 時走 AGENTS 🔒-4 演算法白名單。

---

---

## 0-bis. 追溯稽核(2026-07-28)— **本模組原無證據段,事後補**

> 對照 OWASP Multi-Tenant Security / Session Management / Password Storage cheat sheets
> 與 GitHub Advisory DB。**研究者另讀了 better-auth 1.6.23 的 dist 原始碼確認行為**;
> 三項高風險發現皆由本人對照本專案程式碼再次驗證。

### 🔴 P0-1|成員被移除後仍保有完整存取(**已修**,commit `6bc366d`)

`auth-guard.ts` 原本只做 `activeOrganizationId → tenantId` 查表,**從不驗此人此刻是否仍為該 org 成員**。
而 better-auth 的 `removeMember` **只在「使用者移除自己且正是當前 session」時**清 `activeOrganizationId`
—— 管理員移除他人時,被移除者的 session 完全不受影響。session 預設 7 天且未設 `expiresIn`。

> **結論:移除成員原本是 no-op。** 被解僱員工到 session 過期前仍可讀寫該租戶全部資料。
> 這正是 OWASP Multi-Tenant Security Cheat Sheet 點名的「tenant context 未逐請求重驗」。

**修法**|`IdentityService.isOrgMember()` 逐請求查 `member` 表,查無即 403 `NOT_ORG_MEMBER`。
**驗證**|回歸測斷言移除前 200 / 移除後 403;並**反向驗證** —— 拿掉修正後該測試回到 200,證明測試有鑑別力。
**殘留**|未補 `afterRemoveMember` hook 同步清 `role_members`;未設 `session.expiresIn`;無 `revokeOtherSessions`。

### 🔴 P0-2|`NODE_ENV` 未設時靜默降級為 dev 旁路(**已修**,同 commit)

`env.ts` 的 `NODE_ENV` 有 `.default("development")`,而**兩道防線都掛在 `NODE_ENV === "production"`**:
(a) `TenantGuard` 的認證強制 → 降級為 `DevTenantGuard`,任何人送 `x-dev-tenant: N` 即取得該租戶且 `isSuperAdmin`;
(b) `BETTER_AUTH_SECRET` 的 fail-fast → 回退成硬編碼 dev secret。
**單一環境變數遺漏即全開,且無任何錯誤訊息。** 同類事故有前例(OAuth2-proxy CVE-2025-64484 header smuggling、Traefik CVE-2026-35051)。

**修法**|新增**無預設、prod 須顯式設定**的 `WEYVER_ENFORCE_PROD_SECURITY`,與 `NODE_ENV` 取「或」——只能加嚴不能放寬。
**業界更佳做法(未做)**|編譯期排除 —— 把 `DevTenantGuard` 移到只在非 prod build 引入的模組;CI 對 prod 映像跑 `curl -H 'x-dev-tenant: 1'` 斷言 401/403。

### 🔴 P0-3|邀請可被未驗證 email 冒領(**已修**,commit `41155c4`)

**CVE-2026-53514 / GHSA-fmh4-wcc4-5jm3** 於 better-auth 1.6.11 修好,但其 fallback 邏輯是:
未顯式設 `requireEmailVerificationOnInvitation`、且使用內建 opaque invitation id 時**判定為 false(不要求驗證)**。
本專案未設該選項、亦無 email 驗證流程(`emailVerified` 恆為 false)→ 攻擊路徑重開:
知道受邀 email → 搶註冊該 email → 接受邀請 → 進入他人租戶。

**修法**|顯式開啟該選項。
⚠️ **開啟後 email 驗證流程即為必要前置** —— `sendVerificationEmail` 尚未實作,
**邀請功能在該流程完成前不可對外開放**(目前亦未接入任何 UI,不影響既有流程)。

### 其餘發現(未修)

| 項 | 內容 |
|---|---|
| P2 | `setActive` 不重發 session token(ASVS 3.2.1「權限變更須換 session id」之精神未滿足);切換 org 是全域的,同一使用者開兩分頁操作不同 org 會互相污染。**建議改由 client 每請求送 `X-Org-Id` 並對 `member` 表驗證** —— 比 session 全域狀態安全且無競態 |
| P2 | `allowUserToCreateOrganization` 預設 true → 任何註冊者可無限建 org,經 hook 無限建 tenant |
| P2 | `getFullOrganization` 預設對全體成員曝露完整成員名單含 email(社群 issue #6038,未修) |
| — | **`pnpm audit` 目前有 critical + high**(@fastify/middie 中介層繞過、fastify Content-Type、@nestjs/platform-fastify URL 編碼繞過)—— **比 better-auth 本身更急**,見 task #102 |

### ✅ 確認無問題

- **Argon2id 參數**|`@node-rs/argon2` 預設實測輸出 `$argon2id$v=19$m=19456,t=2,p=1`,**正好等於 OWASP Password Storage Cheat Sheet 最低建議**。已正確覆寫 better-auth 預設的 scrypt
- **better-auth 1.6.23 對已知 advisory 全數已修**(共 25 筆);未使用 sso / api-key / oidc-provider / mcp plugin,故 CVE-2026-53513(SSRF, CVSS 9.6)、CVE-2025-61928 等不適用
- **公開第三方安全審計報告:查無**。該專案靠社群回報 + GitHub Advisory 流程(2025-02 起 25 筆,節奏密集)→ `^1.6.23` 的 caret 範圍應搭配 Renovate + `pnpm audit` CI gate

### 來源

- [Multi Tenant Security — OWASP Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Multi_Tenant_Security_Cheat_Sheet.html)
- [Password Storage — OWASP Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [Session Management — OWASP Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
- [GHSA-fmh4-wcc4-5jm3 — unauthorized invitation acceptance via unverified email](https://github.com/advisories/GHSA-fmh4-wcc4-5jm3)
- [Better Auth SSRF CVE-2026-53513](https://securityonline.info/better-auth-ssrf-cve-2026-53513/) · [CVE-2025-61928](https://www.esecurityplanet.com/threats/better-auth-flaw-allows-unauthenticated-api-key-creation/)
- [better-auth issue #6038 — get-full-organization 曝露成員名單](https://github.com/better-auth/better-auth/issues/6038)
- [OAuth2-proxy header smuggling bypass](https://appsecuritystandards.org/blog/oauth2-proxy-authentication-bypass-a-header-smuggling-breakdown) · [Traefik ForwardAuth bypass CVE-2026-35051](https://www.systemshardening.com/articles/network/traefik-forwardauth-bypass/)
- [Preventing cross tenant access — AWS SaaS Lens](https://docs.aws.amazon.com/wellarchitected/latest/saas-lens/preventing-cross-tenant-access.html)

## 13. 變更紀錄

| 日期 | 版本 | 變更 | 作者 |
|---|---|---|---|
| 2026-07-19 | v1.0 | **M4 + M5 完成 → SHIPPED**|後端掛 `/api/auth/*` handler(configureApp,main/測同構)+ createAuth 接 baseURL/trustedOrigins;前端 authClient + 登入/註冊/登出 + `/app` 受保護 layout(強制登入僅 prod,對齊後端 dev/prod;登入設 active org)+ `/api/auth` 同源代理;硬化 = Better Auth rateLimit(寫端點嚴限 / get-session 放寬,修 M4 誤傷)+ 安全標頭 onSend + throttler + cookie httpOnly/SameSite;`e2e/auth.spec.ts` 固化(4 e2e 全綠)+ Playwright MCP 實走;§12 FMEA P0 全緩解。api 套件 110 綠。**dev header 已由真實認證取代(prod),F-2 上 prod 硬前提達成** | Claude Code |
| 2026-07-19 | v0.7 | **M3 完成:AuthGuard(prod 真實 session)+ 跨租戶隔離**|`AuthGuard`(getSession→activeOrg→IdentityService→tenantId;剝 client 租戶 header;actor JIT upsert)· `TenantGuard` 環境分派(prod→Auth / dev·test→Dev)· 控制器換 TenantGuard · TenantContext 抽 `http/tenant-context.ts`、AUTH token 抽 `auth.tokens.ts`(解 module↔guard 循環)· org→tenant 走 `afterCreateOrganization` hook、user→actor 走 guard JIT · 5 隔離 e2e(無 session 401 / B 讀不到 A / 偽 header 無效 / 無 org 403);全套件 107 綠。M3 → ✅;`BETTER_AUTH_URL` / handler 掛載 續 M4/M5 | Claude Code |
| 2026-07-19 | v0.6 | **M2 完成:org↔tenant · user↔actor 對映**|migration 0005(`users` Tier-1 系統表 + `tenants.auth_org_id` unique + `tenants.parent_tenant_id` 自參照預留;皆非 RLS)· `IdentityService`(ensureTenantForOrg / upsertUser 皆冪等 + getTenantIdByOrg / getActorIdByUser 軟刪回 null;註冊 AuthModule export)· 5 整合測(冪等 / unique / 未知 null / 漂移 / 軟刪復活);全 api 套件 102 綠。provisioning 觸發(org hook vs JIT)併 M3 定案 | Claude Code |
| 2026-07-19 | v0.5 | **M1 完成:Better Auth DI 接入 NestJS**|`src/auth/auth.module.ts`(@Global,`AUTH` Symbol token via useFactory 注入 PG_POOL + ConfigService secret,export;註冊 AppModule)· `BETTER_AUTH_SECRET` 入 env schema(superRefine prod fail-fast + dev-only 佔位回退)· 加 1 DI 解析整合測 + 4 env 單元測;type-check/lint/auth 整合(5)/api e2e(9)全綠。M1 → ✅;Fastify handler 掛載 + AuthGuard 續 M3 | Claude Code |
| 2026-07-19 | v0.4 | **§6-bis 登入分層 + 帳號治理(企業級核心決策)**|反思「管理員用個人 LINE 登入,離職後租戶失控」→ 決策:登入=便利層、治理錨點須公司可控+可回收;現場人員可 LINE、管理員/owner 走公司身分;社群登入不得為 sole owner(OQ-AUTH-9);帳號連結模型;offboarding SOP(§11);釐清 LINE Login vs 個人/群組通知(Notify 已 EOL)| Claude Code |
| 2026-07-19 | v0.3 | **M1 認證引擎落地**|`src/auth/auth.ts`(Better Auth 1.6 + pg pool + emailAndPassword + Argon2id + organization plugin;secret 由呼叫端注入不散落 env);getMigrations 建 auth 表;4 Testcontainers 整合測(表 / 註冊 Argon2id / 登入正誤 / 列舉防護)綠。NestJS provider + Fastify handler 掛載併 M3 | Claude Code |
| 2026-07-19 | v0.2 | OQ-AUTH-1..8 全採建議裁定;AUTH-8 限**場景 A**(多 org 隔離切換);**場景 B 代管母子非本模組**,僅預留 `tenants.parent_tenant_id`;狀態 → APPROVED,進 M1 | Claude Code |
| 2026-07-19 | v0.1 | 初版 DRAFT — F-2 認證 + 租戶 context + 使用者身分;A1–A6 切分 + OQ-AUTH-1..8;上游 = DevTenantGuard + TenantContext 介面 + docs/21 架構(Better Auth + JWT tenant_id + nestjs-cls);對映 org↔tenant / user↔actor 為整合關鍵;保留 TenantContext 介面 → services 零改 | Claude Code |
