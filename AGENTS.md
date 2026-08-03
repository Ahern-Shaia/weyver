This file provides guidance to AI coding assistants when working with Weyver code. It is auto-loaded every session — **these rules are non-negotiable defaults.** 綜整自 Google TS Style Guide、typescript-eslint strict-type-checked、NestJS 官方 + Trilon 企業指南,加 Weyver 專屬鐵則。

> **狀態**|規劃階段,尚未動工程。以下規範在**開工即生效**。優先級:**[P0]** 阻擋 build / 正確性 · **[P1]** 高價值 · **[P2]** 一致性。

---

## Project Architecture(Weyver)

- **定位**|以 Ragic 表單引擎為 substrate,取代 ERP,融合 MES + ISO 的一站式平台(docs/04 定位 + CLAUDE.md 一句話)。
- **架構**|**Modular Monolith**(非微服務,docs/11 §1.3)+ **兩層資料模型**(docs/15):Tier-1 系統實體固定真實表 / Tier-2 使用者表單動態真實表,統一於表單引擎。
- **技術棧**|TS 7 Native · NestJS 10 + Fastify adapter · PostgreSQL 16 · **Drizzle(固定 schema/metadata/Tier-1)+ Knex(動態 Tier-2 DDL/DML)雙軌**(docs/16 Teable pattern)· Next.js 15 + React 19 + Tailwind 4 + shadcn · 全 OSS(docs/11 §16)。
- **關鍵設計文件**|docs/15(表單引擎)· docs/16(OSS 實證)· docs/18(ERP 計算層演算法)· docs/19(兩層解耦出貨)· docs/13(開發順序)· docs/14(前端設計規則)。**動工前讀對應 docs。**

---

## 🚫 第一約束|不用寫 code(違反 = 定位崩掉,不是體驗差)

**Weyver 一句話**|「**不用寫 code 的仿 Ragic,站在 Ragic 之上向上設計的系統**」。
「不用寫程式」是**第一屬性**,不是行銷語 —— 客戶當初離開 Excel / 離開套裝 ERP,就是為了不寫程式、不等工程師。

**可稽核的規則**|任何一處**我們給使用者的答案是「寫程式 / 打 API / 找顧問配置」的核心功能,都是定位違規。**

| 判準 | 說明 |
|---|---|
| **核心需求必須有 no-code 路徑** | 「有 API 可以做」不算解決。API / webhook / 腳本是**開發者的逃生口**,不得是**唯一**路徑 |
| **視覺化 ≠ 簡化** | 把程式碼換成節點圖但仍要求使用者理解執行順序 / 型別 / 例外,只是換皮。判準是「**這張表的設計者(非工程師)自己能不能完成**」 |
| **設定不得外包給顧問** | 需要顧問才能配置 = 需要工程師的變體。自助是同一件事的兩面 |

**🔴 對 R2 計算層的硬約束**|「算」的綁定(GL 過帳規則 / 成本方法 / 估值 / MRP 展開)
**必須自助化**(語意標記 + 推斷 + 人核准 + 預建模板)。做成剛性 posting engine 需顧問配置,
**不是體驗差,是定位崩掉** —— 那就退化成傳統 ERP,而 Ragic 範式的自由與自助正是客戶留下的理由。
見 [[feedback-calc-binding-self-service]]。

**向上設計的判準由此推出**|**凡是 Ragic 要你寫 code 的地方,就是 Weyver 該向上的地方** ——
那正是 Ragic **承諾了「不用寫程式」卻沒兌現**的位置。
一手依據(Ragic 官方文件逐字):
> 「所有表單都可以觸發 Ragic 的 **伺服器端 JavaScript 工作流程引擎** 來執行複雜的業務邏輯,
> 如**計算成本和發布庫存餘額**。基本上,任何 **Ragic 現有功能無法覆蓋的複雜業務邏輯**
> 都可以透過伺服器端程式來實現。」(`doc/29`)
> 「有以下幾種**不用另外寫程式**的方法以及 **2 種需要客製化程式**的做法」(`doc/98`)

⚠️ **對外措辭**|講**我們讓你不用寫程式就做得到**,**不要講「對手做不到」** ——
「Ragic 算不出成本」會被懂 Ragic 的客戶當場反駁(官方文件白紙黑字說可以寫 JS 做到)。
正面表述同樣有力、不可反駁,且與品牌 sober 語氣一致。

---

## 🧭 向上設計三條(做設計 / 寫策略前先過)

**「站在巨人的肩膀上」的意思是看得更遠,不是站在同一個位置。** 照抄競品叫 parity,不叫 design。

任何一項**宣稱為向上 / 差異化**的設計,必須**同時**成立三件事,缺一即降級為 parity:

| # | 條件 | 檢驗方式 |
|---|---|---|
| ① | **巨人明確停在那裡** | 有**一手逐字依據**(官方文件原文 / 生產環境實證),不是「我覺得他們沒有」。⚠️「文件沒寫」≠「沒有」,只能標**待驗證**,不得當硬差異化 |
| ② | **我們的架構讓我們能過去** | 差異來自**地基不同**(如 layout 與 DDL 正交、metadata 驅動、真實表),不是「我們多寫幾行程式」。後者競品隨時能追上 |
| ③ | **對「取代 ERP」有意義** | 不是對「比競品炫」有意義。解決客戶真實的業務痛,不是補齊功能表 |

**踩過的坑(2026-08-02)**|`docs/17` 逐字寫「**Ragic / 鼎新 / 正航 / 傳統 ERP = 0 AI**」,
整條 AI-native「類別差異」論述建立其上。查證後 Ragic 有 AI 建庫 / NL 查詢 / 公式助手 /
單據抽取 / **AI Agent(6 觸發 × 11 動作,含 `CREATE_RECORD`/`MODIFY_RECORD`)** / MCP /
本地模型 + BYO key —— **我們列為「槓桿最高」的四項它全部已有**。
違反的是條件 ①:承重斷言沒回一手查證。

**推論**|「競品沒有 X」是**風險最高的句型**。寫下它之前先查;查不到就寫「未查證」,不要寫「沒有」。
競品的功能會變,一手依據要附**查證日期**。

**參考**|[[feedback-verify-load-bearing-claims]] · [[feedback-design-evidence-anchored]] ·
[[pitfall-unread-schema-field-drift]](巨人的第一站是**自家 repo** —— 上游 design doc 與 schema 常已裁定過)

---

## ✅ 研究錨定的建議 = 已核准(2026-08-03 決策方明示)

**凡是有「站在巨人的肩膀」/ 深入研究 / 競品分析 支撐的建議,視為已核准 —— 直接實作,不必逐條回頭問。**

| 判準 | 說明 |
|---|---|
| **什麼算「研究錨定」** | 有〈向上設計三條〉的**一手依據**(競品官方逐字 + 出處 + 查證日 / 已安裝套件的 `.d.ts` 逐字 / 對自家 repo 的實測與對碼)。**推理不算,印象不算。** |
| **核准的範圍** | 該建議本身 + 它的直接落地(schema / 程式碼 / 測試 / 文件回填)。裁定表照填「✅ 已裁定」並註明依據 |
| **要一氣呵成** | 不要停在「已寫成 OQ 待裁」。研究做完就落地,**中途不再徵詢** |

**🔴 這條不覆蓋以下三類(仍須逐次徵得同意)**|
1. **`git push`** —— 每次單獨問(既有規則,不變)。
2. **不可逆 / 影響共享環境**的動作:prod 部署、刪分支、force push、對外發送。
3. **與既有鐵則相衝**的建議 —— 資安鐵則、金額 `numeric`、租戶綁定、clean-room 授權表
   **不因為「研究支持」就放行**。研究能推翻的是**產品裁定**,不是安全底線;
   真要改鐵則,那本身是一次獨立的裁定。

**為什麼要寫成鐵則**|2026-08-03 一輪內,研究產出的建議**每一條都被全採**,
而中途反覆停下來問「要不要照做」只是把已經做完的功課再走一次流程。
**研究的成本在查證,不在裁定。**

---

## ⚠️ Weyver 專屬鐵則(最優先,違反 = 事故)

1. **[P0] 動態 DDL 防 SQL 注入**|Tier-2 動態建 / 改表(Knex)——**值一律參數綁定;identifier(表名 / 欄名)無法參數化 → 必須對 metadata catalog 白名單驗證**,絕不拼接使用者輸入的 identifier。這是最大注入破口(docs/16)。
2. **[P0] 金額 = `numeric`(DECIMAL),禁 `float`/`number` 存錢**|每幣別小數位 + 明確捨入(docs/18 §0)。
3. **[P0] 每一筆查詢綁租戶**(完整架構見 docs/21)|shared schema + `tenant_id` + **PostgreSQL RLS 且 `FORCE ROW LEVEL SECURITY`**;**app DB 角色不得有 `BYPASSRLS`、不得擁有表**(`BYPASSRLS` 只給 migration)。租戶 context 用 **`SET LOCAL app.tenant_id`(交易範圍,非 `SET`)**——相容 PgBouncer transaction mode,不洩漏 GUC。context 傳遞用 **nestjs-cls + @nestjs-cls/transactional**。**背景工作(BullMQ/DBOS)ALS 不跨 queue → `tenant_id` 塞 job payload,worker 重建 CLS + 重下 `SET LOCAL`**。租戶識別**以驗證過的 JWT `tenant_id` 為真實來源**,剝除 client `X-Tenant-ID`,驗證「路由候選 == token tenant」不符即拒。測試須斷言「A 租戶讀不到 B」。
4. **[P0] 傳票 / 帳務不可變**|過帳後不刪不改,錯了開反向沖轉(reversal);全留 audit(docs/18 §0)。
5. **[P0] Clean-room**|不 clone Ragic / Odoo / NocoDB / Teable-AGPL source;僅獨立重寫。可 fork 者限 **MIT**(Baserow core / Teable `packages/*`),逐檔驗授權標頭 + 保留 attribution(docs/16 §7、CLAUDE 法律紅線)。
6. **[P1] 過帳 / 沖帳 / 結轉 = 單一 DB transaction**,失敗全 rollback;已鎖期間不得過帳。

### 5-bis. 🔴 競品原始碼作業規則(2026-08-03 統一,此前 repo 內有兩套互斥規則)

**規則同時管「讀」,不只管「fork」。** 讀過再寫類似的東西,正是 clean-room 要隔開的污染路徑。

| 來源 | 授權(SPDX) | 可 fork | **可讀實作** | 查證日 |
|---|---|---|---|---|
| Baserow core | MIT | ✅ | ✅ | 2026-07-18 |
| Teable `packages/*` | MIT | ✅ | ✅ | 2026-07-18 |
| Teable `apps/*` | AGPL-3.0 | ❌ | ❌ 只讀公開文件 | 2026-07-28 |
| **NocoDB** | **Sustainable Use License(2026-01-29 起,已非 OSS)** | ❌ | ❌ 只讀公開文件 | 2026-07-28 |
| Directus | 同上,已非 OSS | ❌ | ❌ 只讀公開文件 | 2026-07-28 |
| Baserow enterprise | 專有 | ❌ | ❌ | 2026-07-18 |
| Ragic / Odoo / 鼎新 / 正航 | 專有 | ❌ | ❌ | — |
| Superset | Apache-2.0 | ✅ | ✅ | 未複核 |
| **Metabase** | **AGPL-3.0(core)** | ❌ | ❌ 只讀公開文件(`docs/28` 為 2026-08-03 前之明示例外,見下) | 未複核 |

**規則**|
- 引用競品原始碼時**必附授權識別碼 + 查證日期**;無法確認者標**未查證**並**不得作為承重依據**。
- 授權會變(NocoDB 就變過)→ **每次引用都重新確認**,不沿用舊結論。
- ✅ **Metabase 已裁定(2026-08-03)|既成引用保留,往後從嚴**。
  逐項驗過才裁,不是憑感覺放行:
  - **採用的四項全是架構想法**(色彩兩層制 / 由 base 以 `color-mix` 推導 / `--icon-*` 對齊文字階 /
    禁 raw hex 升 CI),**沒有任何 Metabase 的值或程式碼進入我方 code** ——
    `tokens.css` 的 `--base-brand`(`#22568a` / `#0c5f73` / `#333739`)是 `docs/14 §2.2`
    自訂的三配色主題,與 Metabase 無關;`docs/28` 明列**不搬**圓角 8px / 靜態陰影 / 字階重排 /
    儀表板 IA / 12.5px。
  - **持續性檢查已存在**:`color-literal.test.ts` 於 CI 擋 raw hex,
    `tokens.css` 為唯一豁免 —— 這同時也是「外部色值混不進來」的守衛。
  - **往後從嚴**:自 2026-08-03 起,AGPL 與非 OSS 來源**一律只讀公開文件**。
    `docs/28` 為此日之前的既成事實,列為**明示例外**(範圍限已記錄的四項架構觀察),
    不擴張、不作為往後直讀原始碼的先例。
  - `pivot-and-charts` §0 同此處置,已標註。

**已知違規紀錄**|`views-group-kanban-calendar.md` v0.1(2026-07-29)引用 NocoDB 實作路徑,
而 `dynamic-permissions.md` §0.8(2026-07-28)**前一天**就記下該來源已非 OSS。
**不是當時不知道,是自家 repo 前一天寫了而沒查** —— 巨人第一站的失敗。已標更正,結論降級待重新推導。

---

## TypeScript 規則

### tsconfig(repo root,強制)
- **[P0]** `strict: true` · `noUncheckedIndexedAccess: true`(DB 查詢會 miss,`arr[i]` → `T | undefined`)· `noFallthroughCasesInSwitch: true`
- **[P1]** `noImplicitOverride` · `noImplicitReturns` · `isolatedModules` + `verbatimModuleSyntax` · `forceConsistentCasingInFileNames` · `exactOptionalPropertyTypes`(最後開)
- **[P2]** `noUnusedLocals` / `noUnusedParameters`(未用參數前綴 `_`)· `moduleDetection: "force"`

### 型別紀律
- **[P0] 禁 `any`** → `unknown` + narrowing;開 `no-unsafe-*` 系列。
- **[P0] 禁 non-null `!`** → 明確檢查。
- **[P1] 避免 `as` cast** → 用 type guard / declaration;不得已時加 `// x is Foo because…`,雙轉只走 `as unknown as T`。
- **[P1]** exported / public function + NestJS service/controller method **標回傳型別**。
- **[P1]** 不重賦值的欄位 / 參數標 `readonly`;型別符號用 `import type`。

### 型別建模
- **[P0]** 狀態用 **discriminated union**(status/job/invoice/對帳)+ `never` 預設做 **exhaustiveness check**(新增 case 未處理即編譯錯)。
- **[P0]** 所有外部邊界(HTTP body / DB row / env / adapter payload)用 **Zod 驗證 + `z.infer` 推型別**。
- **[P1]** domain ID 用 **branded type**(`type TenantId = string & {__brand}`)防跨模組 ID 混用。
- **[P1]** union-of-literals / `as const` 優於 `enum`;**禁 `const enum`**(破 isolatedModules)。
- **[P1]** `interface` 給物件形狀,`type` 給 union/tuple/primitive。

### 其他
- **[P1] 具名 export,禁 default export**(typo 即報錯 + 好重構)。
- **[P1] app code 禁 barrel file**(`index.ts` re-export hub → 循環依賴 + 破 tree-shaking)。
- **[P0]** 只 throw `Error` 子類(定義 `DomainError` 階層);`catch` 為 `unknown` 先 narrow;**禁靜默吞錯**(空 catch 需理由註解)。
- **[P1]** 預期 / domain 失敗用 `Result<T,E>`,例外留給真異常。
- **[P0]** **禁 floating promise**(`no-floating-promises`)+ 禁 misused promise。

---

## NestJS 規則

### 模組架構(modular monolith)
- **[P0]** 依 **feature / bounded context** 分模組(controller/service/dto/repo/test 同資料夾)—— 這是日後可抽服務的縫。
- **[P0]** 只透過 `exports` 曝露窄 public API;**禁跨模組 import 他模組內部 provider / entity**(否則變 distributed monolith)。
- **[P0]** **CI 用 `dependency-cruiser`/`madge` 擋跨模組 import + 循環依賴**(不靠自律);`AppModule` 禁平鋪 40 個模組。
- **[P1]** 共用 infra(logger/config/DB client)註冊一次為 `@Global()`;可配置 infra 用 `forRoot`/`forFeature`。

### DI
- **[P0]** 只用 constructor injection。
- **[P1]** 依賴**抽象 + injection token**(abstract class / Symbol),不依賴具體類(可 mock/swap);外部 I/O 尤其。
- **[P1]** provider 預設 singleton;`REQUEST`/`TRANSIENT` scope 只給真正 per-request state(會拖垮效能)。
- **[P1] 避免 `forwardRef`**(緊耦合訊號)→ 重構 / 事件解耦;**禁 service-locator**(`ModuleRef.get()` 於業務碼)。

### 分層
- **[P0] 薄 controller(只 HTTP)→ service(全部業務邏輯 / 交易 / 編排)→ repository(只查詢)**;controller 不碰 DB、不寫業務;禁 controller 直呼 repository。
- **[P1]** Drizzle/Knex 藏在 **repository provider(介面 token)之後**,隔離雙軌 ORM。
- **[P1] 禁 god service**(跨多 aggregate 就拆)。

### DTO / 驗證
- **[P0]** 全域 `ValidationPipe { whitelist: true, forbidNonWhitelisted: true, transform: true }`(擋 mass-assignment + 拒未知欄 + 轉型)。
- **[P1]** `transformOptions.enableImplicitConversion: false`;`validationError { target: false, value: false }`(錯誤別回傳 DTO 內容)。
- **[P0]** **req / res DTO 分離;禁回傳 DB entity**(用 response DTO + `@Exclude()` 序列化,防洩密碼 hash / 內部欄 / 他租戶欄)。
- **[P1]** 驗證用 `class-validator` decorator 於 DTO,不寫 controller 內。

### 橫切
- **[P0]** Guard 管 authz(認證 + RBAC)· Interceptor 管 logging/timeout/序列化/cache · Pipe 管驗證 · Filter 管錯誤;**各司其職**。
- **[P0]** 一個全域 Exception Filter → 統一錯誤信封(code/message/correlationId/timestamp)。
- **[P1]** authz 決策在 Guard,**但 Guard 不放業務邏輯**。
- **[P1]** pipeline 順序:security header/CORS → body limit → validation → auth guard → rate limit → controller。

### Config / Secrets
- **[P0]** `@nestjs/config` + 開機 schema 驗證(Zod/Joi),缺 / 錯 env fail-fast;**禁散落 `process.env`**,只經 typed `ConfigService`。
- **[P0]** 禁 commit secret(`.env` gitignore,附 `.env.example` 只留形狀)。

### 錯誤 / 日誌
- **[P0]** throw typed `HttpException` 子類(或 domain exception 由 filter 映射);禁裸字串 / ad-hoc error 物件。
- **[P1]** 結構化 JSON 日誌用 **nestjs-pino**(註冊一次 `@Global()`)+ **correlation ID** 貫穿 guard→interceptor→service→repo;`LoggerErrorInterceptor` 讓例外進 pino。

### 安全
- **[P0]** Helmet + CORS **明確 allowlist**(prod 禁 `origin: *`);`@nestjs/throttler` 全域 `APP_GUARD`(敏感 route 更嚴)。
- **[P0]** **參數化查詢 everywhere**;動態表 identifier 白名單驗證(見 Weyver 鐵則 1)。

### 測試
- **[P0]** service 單元測試 + 依賴 mock(`Test.createTestingModule` + `overrideProvider`)—— 正確性在此。
- **[P0]** e2e / 整合測試對**真實 Postgres via Testcontainers**(跑真 RLS / migration / 動態建表);優先測 auth、**租戶隔離**、計費、動態表 CRUD。

---

## 🔒 資安鐵則(P0,完整見 docs/22 + [[coding-standards]])

**Weyver 威脅模型前 3 名 = 動態 identifier 注入 / 跨租戶 bleed / AI-LLM。** 以下 P0 開工即生效:

1. **動態 identifier 安全鏈**|使用者欄名 → metadata catalog **白名單解析**成物理 identifier(查無即拒)→ `quote_ident`/`%I` 加引號 → 跑在**只限該租戶 schema 的最小權限角色** → `statement_timeout` + row limit。建表時 identifier 鎖 regex `^[a-z_][a-z0-9_]{0,62}$`。**值一律參數綁定。**
2. **存取控制 deny-by-default + object-level authz**|每查詢綁 `tenant_id` **且**驗此人能存取「這個 ID」(BOLA/IDOR);RLS + Guard + ownership 三層;UUID 非授權控制。
3. **AI/LLM 載重不變量**|**模型輸出結構化 intent(非 raw SQL)→ 你的確定性程式碼 allowlist 編譯 + 參數化執行 → 有權限的人核准每個狀態變更 → audit**。NL→SQL 走唯讀 tenant-scoped 角色 + timeout。copilot 跑操作者權限、每動作 audit。防間接 prompt injection(客戶資料=不可信,不得升權/觸發 tool call)。secret/PII 不進 prompt。授權絕不由模型決定。LLM 輸出禁未編碼渲染。
4. **JWT**|`verify()` 傳 `algorithms` 白名單、拒 `alg:none`、非對稱 RS256/ES256、驗 exp/iss/aud;token 禁 localStorage;密碼 Argon2id。
5. **SSRF**|使用者 URL(adapter/webhook/欄位)擋私網段 + 雲 metadata `169.254.169.254` + 禁 redirect + egress firewall。
6. **secret**|零進碼/git;Infisical 注入;**從 log/錯誤/LLM prompt redact**;app DB 角色最小權限、無 SUPERUSER、migration 角色分離。
7. **供應鏈**|lockfile `--frozen-lockfile` + **`ignore-scripts=true`** + OSV/Snyk 掃描 fail CI + **fork MIT 逐檔 review**。
8. **禁**|回傳 stack trace/DB 錯誤給 client · `Math.random()` 產 token · 自製 crypto · Postgres 對公網開 · 容器 root · LLM 輸出當 code 執行 · 跨租戶查詢無 tenant scope。
9. **CI gates**|OSV/Trivy/gitleaks/dependency-cruiser/**跨租戶隔離測試**(A 建→B 讀不到)全過才 merge。

## ⚙️ 可靠 / 穩定 / 高效能鐵則(四軸反思整合,詳 docs/22 §6)

**可靠**|
- **[P0] 冪等性**|所有 mutation / webhook / **AI 動作** / **電子發票政府 API 提交** 帶 idempotency key —— 重試不重複過帳 / 不重複建單 / 不重複開票。
- **[P1] Outbox pattern**|跨模組副作用(採購→財會拋轉)走 outbox,crash 不丟事件、保證最終送達。
- **[P1] 不變量對帳 job**|定期斷言試算表恆平衡 / 庫存數量=異動帳 / AR-AP=GL 明細,不符告警。
- **[P1]** 背景工作 retry + backoff + dead-letter。

**穩定**|
- **[P0] 優雅降級**|AI/LLM / 搜尋 為**非關鍵路徑** —— 掛掉時核心 ERP 照常(搜尋 fallback SQL)。
- **[P0] circuit breaker + timeout + bulkhead**|所有外部呼叫(ERP adapter / LLM / 政府電子發票 / SCADA)。
- **[P1]** per-tenant 資源配額(連線 / query cost / LLM token / 儲存)防 noisy neighbor;**feature flag / kill switch**(風險功能不 deploy 即關);health check(@nestjs/terminus);零停機滾動部署。

**高效能**|
- **[P0] N+1 防護**|dataloader / 正確 join —— 尤其 **Link&Load + Lookup/Rollup**(docs/16 已知瓶頸)。
- **[P1] metadata 快取**|form_def/field_def / 權限 / 租戶 config → Redis,schema 變更失效。
- **[P1]** cursor 分頁 + **回應 DTO 只回需要欄**(兼防 over-fetch 洩漏);報表走 read replica;重計算走背景 worker(DBOS/BullMQ)不擋請求。

## 前端測試分層鐵則(form-engine ERP)

一個工具不夠 —— 表單引擎 + ERP 前端須分層測(完整策略 docs/11 §12,全 OSS)。各層職責:

| 層 | 工具 | 覆蓋 |
|---|---|---|
| **快層(佔多數)** | Vitest + Testing Library / Storybook play function | 單元件互動:欄位 / 驗證 / grid cell / 公式 |
| **關鍵流程** | Playwright E2E + Testcontainers 真 Postgres | 登入 / 租戶隔離 / 建單→過帳 GL / 對帳 |
| **AI 探索** | Playwright MCP 驅動真實瀏覽器 | 開發期驗證 + 組合爆炸邊角 |
| **視覺回歸** | Playwright screenshot | 版面 / 樣式 regression |
| **可重現底盤** | 確定性 seed / factory + MSW(mock API) | 讓上述全部可重跑 |

- **[P0] 前端改動驗證迴圈**|啟 dev server → 以 **Playwright MCP 驅動真實瀏覽器**走使用者流程(讀 a11y tree 非像素,較 vision 穩)→ 觀察 → 改 code → 再走;在瀏覽器實際用過才算完成。
- **[P0] 走通即固化**|MCP 手動走通的流程存成 **Playwright spec** 進 CI 當回歸;AI 驅動瀏覽器慢且非確定性 → 只做探索 + 產測試,**不放 CI**。
- **[P0] 關鍵流程 E2E 對真實 Postgres via Testcontainers**|跑真 RLS / migration / 動態建表;優先 auth / **租戶隔離** / 建單→過帳 / 對帳(與 NestJS〈測試〉鐵則同源)。
- **[P1] 金字塔底最大**|元件互動(欄位 / grid / 公式)以快層(Vitest + Testing Library / Storybook play)為主。
- **[P1] 動態表單 metadata-driven 生成式測試**|表單由 `form_def/field_def` 生成 → 測試亦由同份 metadata 生成(fast-check),客戶無限表單組合不可能手寫 E2E。
- **[P1] 全層可重現**|確定性 seed / factory + MSW + 凍結時鐘,確保上述皆可重跑。

## Development Workflow(開工後)

**改完 code 一律跑(對應 [[rule_full_green_check]] 全綠才算完成):**

```bash
pnpm format          # Biome / Prettier
pnpm lint            # typescript-eslint strictTypeChecked + stylisticTypeChecked;repeat 到 0
pnpm type-check      # tsc --noEmit,0 error
pnpm test            # Vitest 單元 + Playwright/Testcontainers e2e
pnpm build           # 確認 production build 過
pnpm dep-check       # dependency-cruiser:無跨模組 / 循環依賴
```

- **Lint 工具**|typescript-eslint(型別感知規則:`no-floating-promises` / `no-unsafe-*` / `switch-exhaustiveness-check` / `no-unnecessary-condition`)—— Biome 覆蓋不到型別感知規則,**格式可 Biome、型別 lint 留 typescript-eslint**(hybrid)。
- **前端**|任何前端產出動手前先過 `docs/frontend-design-principles.md` + **`docs/14 前端設計規則`**(深海青 / IBM Plex / 企業級 chrome / Do&Don't);走語意 design token 禁硬編 hex;spacing 用 `gap-*`。

---

## Code Style

- Google style guide 為底;American English;程式碼精簡(fewer lines better);**註解只寫「為什麼」**(非顯而易見的約束 / 陷阱),不寫「做什麼」。
- 命名|`PascalCase` 型別 / 類別 / decorator · `camelCase` 值 / 函數 · `UPPER_SNAKE` module const;**禁 `I`/`_` 前綴 · 禁 `#private`(用 TS `private`)· 禁複數如 `xxxList`**。
- Import 依路徑排序;path alias `@weyver/*` 優於深 `../../..`。

## Commit / PR

- Commit format `<type>(<scope>): <description>`;**Co-Authored-By Claude 行預設不加**([[rule_commit_format]])。
- solo dev 直接 commit,不假走 PR ceremony([[feedback_no_pr_workflow]]);**每次 `git push` 單獨徵得同意**([[feedback_only_push_needs_consent]])。

## CI-fail 禁令清單(TS + NestJS)

`any` · non-null `!` · 無說明 `as` · default export · `const enum` · `namespace`/`require()` · `var` · `==`(除 `== null`)· `#private` · app barrel file · floating promise · 循環依賴(`madge --circular`)· 散落 `process.env` · 巨型 `AppModule` · fat controller · god service · controller 直呼 repo · 回傳 DB entity · Guard 放業務邏輯 · 隨意 request-scoped provider · 空 catch · **未白名單的動態 identifier** · **float 存金額** · **無租戶綁定的查詢**。
