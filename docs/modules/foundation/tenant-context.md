# tenant-context.md — [F-10] 分頁級租戶上下文(修跨分頁污染)設計文件

| | |
|---|---|
| 狀態 | 📝 **M0 DRAFT — OQ-TC-1..6 待裁定** |
| 建立 | 2026-07-30 |
| 上游 | task #107「auth 殘留:跨分頁 org 污染」 |
| 依賴 | [auth](auth.md)(`AuthGuard` / `IdentityService`)· authz · 全體 controller |

---

## 1. 問題:租戶綁在 session,而 UI 綁在分頁

### 1.1 失效路徑(已在程式碼中確認)

`AuthGuard` 由**伺服器端 session 列**的 `activeOrganizationId` 解析 tenantId
(`apps/api/src/auth/auth-guard.ts:39`)。該欄位由 `organization.setActive()` 修改,
**所有分頁共用同一列**。

```
分頁 1  開著 A 公司的表單,填到一半
分頁 2  切到 B 公司        → setActive() 改的是共用的 session 狀態
分頁 1  按儲存             → 同一個 session cookie
                           → guard 解析出 B
                           → 🔴 資料寫進 B 公司
```

### 1.2 為什麼現有防線全部攔不住

`AuthGuard` 該做的都做了,而且**每一道都會通過**:

| 現有防護 | 為何不生效 |
|---|---|
| 剝除 client 的 `x-tenant-id` / `x-dev-tenant` | 這條路徑根本沒用到 client header |
| **每請求重驗成員資格**(#97 補的)| 使用者**確實是** B 的成員,驗得過 |
| RLS `SET LOCAL app.tenant_id` | 它忠實地用 guard 解析出的 B,把資料寫進 B |

**這不是漏了哪一道,是租戶的作用域選錯了。**

### 1.3 嚴重度

**不是跨客戶洩漏** —— 使用者本來就屬於兩邊。是**寫進錯的租戶**(wrong-tenant write)。

但觸發條件正好命中本產品的實際使用模式:**一個人同時導入 / 維運 17 家客戶**
(CLAUDE.md 時間戳 2026-07-16),多分頁開不同租戶是日常而非邊角。
且錯寫之後**沒有任何訊號** —— 資料靜靜地出現在另一家公司的表單裡。

---

## 0. 深度研究(2026-07-30)

### 0.1 成熟系統把租戶識別放哪

| 系統 | 位置 | 多分頁 | 證據 |
|---|---|---|---|
| **AWS Console** multi-session(2025-01 GA)| **每 session 一個子網域** `{acct}-{hash}.{region}.console.aws.amazon.com` | 官方明載每個身分開自己的分頁 | 官方 |
| **Slack** | workspace 子網域 + web client path 帶 team ID | URL 決定 | 官方 |
| **Linear** | `linear.app/{workspace}/…` | URL 決定 | 官方 |
| **Atlassian** | `{site}.atlassian.net/…` | URL 決定 | 官方 |
| **GitHub** | **資源路徑本身帶 owner**,根本沒有「active org」session 狀態 | 天然無污染 | 由 URL 設計推斷 |
| **Google** | `/u/{n}/` + `?authuser=n`;n 是**本次瀏覽器登入順序索引,非帳號身分** | URL 決定,但已知脆弱(deep link 常錯) | 社群 KB,**非 Google 工程文件** |
| **Clerk** | session cookie + **per-tab active org**;背景請求改用 `getToken()` 帶 Authorization header | 官方明載 | 官方 |
| **Better Auth** | session row `activeOrganizationId` | 官方明載**可只在 client 端管理** | 官方 |

### 0.2 🔴 一模一樣的先例:Shopify 官方承認無解

**Shopify(非嵌入式 app)**|「if a user authenticates a second shop in another tab,
the cookie is overwritten and **all tabs start using the most recently authenticated shop** on refresh」。
官方回覆是**沒有 workaround**,叫你改做 embedded app 用 App Bridge 的 **per-tab session token**。

**這與本平台的失效路徑完全相同。** 它證明:(a) 這是真問題不是我想太多;
(b) 靠 session-scoped 租戶本身無解,必須改變租戶的作用域。

**Clerk 官方文件逐字**|「Clerk's session token cookie will always represent the current
Active Organization from the active browser tab because the session cookie is a
**singleton (global) value** for the browser… **do not rely on the session cookie alone**」。

### 0.3 🔴 Better Auth 官方已預期此問題,並把解法推給應用層

官方 callout 逐字:

> It's not always you want to persist the active organization in the session.
> You can manage the active organization in the client side only.
> **For example, multiple tabs can have different active organizations.**

→ **我們不是在對抗框架,是在做框架預期由我們做的事。**
`setActive` 的設計意圖只是「把上次選的工作區持久化,方便 server component 免傳參」。
**無全域 per-request org override**(僅少數 endpoint 接 `organizationId`,`getSession` 不接)。

Better Auth UI 的 slug 模式賣點之一直接寫:
「Letting members keep multiple organizations open in separate tabs
**without thrashing the active organization**」。

### 0.4 三種修法

| | 做法 | 業界 | 遷移成本 |
|---|---|---|---|
| **(a) URL-scoped** | 租戶進路徑 / 子網域 | **主流**:Slack / Linear / Atlassian / AWS / Clerk / Better Auth UI slug 模式 | **最高** —— 所有路由與相對連結要重寫 |
| **(b) client 送 intent,server 驗授權** | 每請求帶「我以為我在哪個租戶」 | **實際上也是主流,只是被加簽包裝** —— Clerk 的 `getToken()` → Authorization header 本質就是這個 | **最低** —— 只動 HTTP client + Guard |
| **(c) 偵測不一致就擋** | 前端帶渲染時的租戶,不符即拒 | 未見廠商當**主要**架構 | 低 |

⚠️ Clerk 明載:URL 匹配不到 org 或使用者非成員時,middleware **不會**改 active org
—— **URL 本身不是安全邊界**。走 (a) 也一樣要驗成員資格。

### 0.5 (b) 的安全性:關鍵在「intent」與「授權結論」的差別

**OWASP Multi-Tenant Security Cheat Sheet**|「Never trust client-supplied tenant IDs
without validation」「Get tenant from verified JWT claims - NOT from headers」。
**WorkOS** 更硬:「Do not read the active org from a request header, query string, or
client-supplied cookie on protected routes… If it is not signed, it can be spoofed」。

研究對此做的區分(⚠️ **原文未明白做此切分,屬推論**):

| | 語意 | 後果 |
|---|---|---|
| **危險** | client 送 tenant = **授權結論**(送什麼給什麼) | OWASP API1 BOLA |
| **安全** | client 送 tenant = **選擇器 / intent**,伺服器獨立查 `membership(user, tenant)` 才採用 | 攻擊者能偽造的上限 = **他本來就有權限的租戶** → 風險從「越權」降為「誤寫」,而誤寫正是 (c) 要擋的 |

**未找到**任何因「intent + 伺服器驗證」導致的公開資安事故;已知事故都是**漏掉驗證**那類。
Azure Architecture Center 亦把 header / path / query / token claim 並列為租戶映射手段,
並建議**組合**使用做 defense-in-depth。

### 0.6 跨分頁偵測

**BroadcastChannel** 為實務首選 —— Clerk 已在產品內用它跨分頁廣播 session token(PR #6891),
同源、記憶體內、fire-and-forget。常見組合:BroadcastChannel(即時)+ localStorage 快照(reload 後恢復)
+ `visibilitychange` 回前景重驗。

🔴 **「未儲存變更 + 租戶被切換」的 UX 先例:查不到。** 沒有任何廠商公開文件描述這個情境
(Shopify 那串是「無解,請改架構」)。**此處只能自行設計,並誠實標注無業界參照。**

### 0.7 誠實聲明:查不到的

Notion / GitHub 的**官方**多分頁說法(僅由 URL 結構推斷)· Google 選 `/u/{n}` 的官方設計 rationale
(僅社群 KB)· 「未儲存變更 + 租戶切換」的公開 UX 先例 · Better Auth 官方 per-request org override
(**確認不存在**)· 因 (b) 模式造成的公開資安事故(未找到)。

### 0.8 來源

[Better Auth Organization plugin](https://better-auth.com/docs/plugins/organization) ·
[Better Auth UI slug-based routes](https://better-auth-ui.com/docs/shadcn/plugins/organization) ·
[Clerk Organizations overview(含 multiple browser tabs 一節)](https://clerk.com/docs/guides/organizations/overview) ·
[Clerk org slugs in URLs](https://clerk.com/docs/guides/organizations/org-slugs-in-urls) ·
[Clerk PR #6891 cross-tab broadcast](https://github.com/clerk/javascript/pull/6891) ·
[AWS Console multi-session](https://docs.aws.amazon.com/awsconsolehelpdocs/latest/gsg/multisession.html) ·
[Shopify:多分頁多商店(官方回覆無解)](https://community.shopify.dev/t/we-need-a-mechanism-to-use-multiple-shops-in-multiple-browser-tabs-in-non-embedded-apps/27640) ·
[OWASP Multi-Tenant Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Multi_Tenant_Security_Cheat_Sheet.html) ·
[WorkOS multi-tenant session management](https://workos.com/blog/multi-tenant-session-management) ·
[Azure:Map requests to tenants](https://learn.microsoft.com/en-us/azure/architecture/guide/multitenant/considerations/map-requests) ·
[better-auth PR #9239](https://github.com/better-auth/better-auth/pull/9239)

---

## 4. 設計要點

### 4.1 分階段,不一次改路由

**第 1 步(本批)|intent header + 不一致偵測 —— (b) 與 (c) 合體**

- 前端每個請求帶 `X-Weyver-Org-Intent`,值取自**渲染當下**的 tenantId(React context,**不是 URL**)
- `AuthGuard`:header 存在 → **獨立查成員資格** → 以它作為此請求的 tenant(**不寫回 session**)
- 與 session 的 active org 不符時:
  - **GET 放行**(讀舊分頁的資料是合理的)
  - **mutation 回 409 `TENANT_CONTEXT_MISMATCH`**,前端跳明確對話:
    「此分頁是 A 公司,但目前作業公司已切換為 B」→ 選「以 A 繼續」(setActive 回 A 後重送)或「放棄」
- RLS `SET LOCAL app.tenant_id` 邏輯**完全不變** —— 它拿到的仍是伺服器 resolved 的 tenant

改動集中在 **HTTP client + Guard + 一個 dialog**,不動任何路由。
對「一人管 17 家」的顧問角色,這一步就足以消除寫錯租戶。

**第 2 步(中期,逐頁)**|新頁走 `/app/o/{slug}/…`,舊相對路徑用 Next.js middleware rewrite 過渡。
Better Auth UI 的 `organizationPlugin({ slug })` 是現成 pattern。

**第 3 步(UX)**|BroadcastChannel 廣播切換事件;其他分頁**不強制重載**,
只掛 sticky 橫幅 + 停用主要動作;**表單 dirty 時絕不自動切**。

### 4.2 🔴 header 是 intent 不是授權 —— 這一點要寫進程式碼註解

AGENTS 鐵則 3 寫「剝除 client `X-Tenant-ID`」。本設計**不違反**它,但差別細微到
下一個人很可能誤改,所以必須在 guard 裡寫明:

- 被剝除的是「宣稱**這就是我的租戶**」的 header —— 那是授權結論
- 新增的是「我**以為**我在這個租戶」的 header —— 伺服器仍獨立查成員資格才採用
- 攻擊者偽造它的上限 = **他本來就進得去的租戶**

### 4.3 dev 車道

`DevTenantGuard` 也要支援同一個 header,否則 dev 與 prod 行為分歧
(本 session 已多次踩到「dev 遮蔽了 prod 才會出現的問題」)。

---

## 3. scope 切分

| 里程碑 | 內容 | 估算 |
|---|---|---|
| **M1 後端** | `AuthGuard` / `DevTenantGuard` 接 intent header + 成員驗證 + mismatch 409;跨租戶測試 | 0.15 mo |
| **M2 前端** | HTTP client 統一帶 header(**單點**,不逐處改)+ mismatch dialog | 0.15 mo |
| **M3 跨分頁 UX** | BroadcastChannel + sticky 橫幅 + dirty 保護 | 0.1 mo |
| **M4 收尾** | FMEA · e2e(**雙分頁情境**)· doc v1.0 · MODULES | 0.1 mo |

**合計 ≈ 0.5 mo**。前後端分開 commit。

---

## 10. 開放問題(OQ-TC-N)— ⏳ 待裁定

| # | 問題 | 選項 | 建議 |
|---|---|---|---|
| **OQ-TC-1** ⭐⭐ | 架構方向 | A. **第 1 步 intent header + mismatch,URL-scoped 列中期**<br>B. 直接上 URL-scoped<br>C. 只做 mismatch 偵測 | **A** — B 是業界主流且最終該去,但要重寫所有路由與相對連結,對現有數十條路由代價過高;而 A 已足以**消除寫錯租戶**。C 只擋不解(使用者每次切分頁都被擋),體驗不可接受。A 是 (b)+(c) 合體,且 Clerk 的 `getToken()` 本質就是 (b) |
| **OQ-TC-2** ⭐⭐ | intent header 的安全語意 | A. **選擇器 + 伺服器獨立驗成員資格**<br>B. 不接受任何 client 租戶輸入 | **A** — B 就是現況,而現況會寫錯租戶。關鍵是**語意**:偽造上限 = 他本來就進得去的租戶。**但 guard 註解必須寫明它與 AGENTS 鐵則 3 剝除的那個 header 差在哪**,否則下一個人會誤改 |
| **OQ-TC-3** ⭐ | 不一致時的行為 | A. **GET 放行 / mutation 409**<br>B. 一律 409<br>C. 一律以 intent 為準不提示 | **A** — 讀舊分頁的資料是合理需求;寫則必須讓人明確決定。C 會讓「我以為我在 A」變成靜默事實,等於換一種方式寫錯 |
| **OQ-TC-4** | 是否寫回 session | A. **不寫回**(intent 只作用於該請求)<br>B. 寫回 | **A** — 寫回就是把污染反向傳播回去,分頁 2 會突然變 A |
| **OQ-TC-5** | 其他分頁偵測到切換後 | A. **sticky 橫幅 + 停用主要動作,不強制重載**<br>B. 強制重載 | **A** — B 會直接丟掉未儲存的內容。⚠️ **此情境查無業界先例**(§0.6),為自行設計 |
| **OQ-TC-6** | dev 車道 | A. **同樣支援 intent header**<br>B. dev 維持現況 | **A** — 本 session 已五度踩到「dev 行為與 prod 分歧導致問題被遮蔽」 |

---

## 12. 失效場景反思(FMEA)— pre-mortem 預列

| # | 場景 | 預定緩解 | Sev |
|---|---|---|---|
| T1 | 🔴 **intent header 被當成授權** —— 日後有人「簡化」掉成員驗證 | guard 內註解寫明語意差別;**測試斷言「偽造非成員租戶的 intent → 403」** | **P0** |
| T2 | 🔴 漏帶 header 的路徑退回 session 行為(等於沒修) | HTTP client **單點**注入,不逐處加;測試斷言 mutation 一律帶 | **P0** |
| T3 | 前端 context 的 tenantId 本身就錯(來源不可信) | context 由**伺服器 render 時**注入,不由 localStorage 推 | P1 |
| T4 | 使用者被移出租戶後 intent 仍指向它 | 成員驗證每請求跑(#97 已有),intent 走同一條 | P1 |
| T5 | 409 對話出現得太頻繁,使用者學會無腦點「繼續」 | 只在 mutation 且真的不一致時出現;文案指名兩個公司名 | P1 |
| T6 | e2e 覆蓋不到「兩個分頁」的情境 | Playwright 開兩個 context / page 明確重現 §1.1 那條路徑 | P1 |

---

## 13. 變更紀錄

| 日期 | 版本 | 變更 | 作者 |
|---|---|---|---|
| 2026-07-30 | v0.1 | M0 DRAFT。承 task #107。**已在程式碼確認失效路徑**:租戶來自伺服器端 session 列的 `activeOrganizationId`(`auth-guard.ts:39`),所有分頁共用;`setActive` 改它 → 舊分頁的下一次寫入落到新租戶。**現有三道防線全部會通過**(剝 header 用不到、成員驗證會過因為使用者確實屬於兩邊、RLS 忠實使用 guard 解析的租戶)—— 不是漏了哪一道,是**租戶的作用域選錯了**。**🔴 §0.2 找到一模一樣的先例**:Shopify 非嵌入式 app 官方承認「所有分頁會跟著最近認證的商店」且**無 workaround**;Clerk 官方文件逐字警告 session cookie 是 **singleton (global) value**、「do not rely on the session cookie alone」。**🔴 §0.3 Better Auth 官方已預期此問題**並明文把解法推給應用層(「multiple tabs can have different active organizations」)—— 我們不是在對抗框架。**§0.5 關鍵區分**(研究標為推論):client 送租戶作為**授權結論**是 OWASP API1 BOLA,作為**選擇器 + 伺服器獨立驗成員資格**則偽造上限僅為「他本來就進得去的租戶」,風險從越權降為誤寫;未找到此模式的公開事故。**§0.6 誠實缺口**:「未儲存變更 + 租戶被切換」的 UX **查無任何業界先例**,為自行設計。OQ-TC-1..6 待裁定 | Claude Code |
