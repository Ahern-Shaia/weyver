# framework-upgrade.md — [F-9] 框架升版(NestJS 11 + Fastify 5)設計文件

| | |
|---|---|
| 狀態 | ✅ **SHIPPED v1.0(2026-07-29,M1→M4)** — OQ-FU-1..7 全採建議 |
| 建立 | 2026-07-29 |
| 上游 | #102 部署前置 · [file-storage](file-storage.md) §0-bis 殘留表(Fastify EOL 一項) |
| 依賴 | 無(純升版);阻塞 file-storage 之 `@fastify/multipart` v10 |

---

## 1. 目標與範圍

### 1.1 起因與一個範圍上的意外

原始認知是「升一個套件」:`fastify@4.28.1` 已 EOL,升到 5.x 即可。

**實際盤查後,範圍完全不同**:

```
@nestjs/platform-fastify@10.4.22
  dependencies: { "fastify": "4.28.1", ... }   ← 直接相依且釘死,非 peerDependency
@nestjs/platform-fastify@11.1.28
  dependencies: { "fastify": "5.2.1", ... }
```

→ **Fastify 的版本由 NestJS 的 adapter 決定,不由本專案決定**。
「升 Fastify 5」實質等於「升整個 NestJS 到 11」。這也回頭解釋了 F-2 期間那個「fastify 4.28/4.29 型別重複」的踩點:
當時把 `fastify` 釘成 `4.28.1` 並非任意選擇,而是**被迫與 adapter 的內部相依對齊** —— 只要宣告任何其他版本,型別就會出現兩份。

### 1.2 目標(P0)

1. `@nestjs/*` 10.4.x → **11.1.28**(含 platform-fastify,連帶 fastify 5.x)
2. `@nestjs/config` 3 → **4**(v3 的 peer 不含 NestJS 11,為唯一被迫的跳號)
3. `@fastify/multipart` 8 → **10**(v8 綁 `fastify-plugin@^4`,只認 fastify 4)
4. **移除 `fastify` 直接相依** —— 版本交由 adapter 決定,消除型別重複的根因
5. 🔴 **先行修正 `ScheduleModule.forRoot()` 重複註冊**(見 §4.1,**這是本次最大風險且與升級無關,可獨立先做**)

### 1.3 不做的事

- ❌ **NestJS 微服務 / GraphQL / CacheModule / Terminus 的遷移** —— 本專案皆未使用
- ❌ **Express adapter 相關的 path-to-regexp v8 遷移** —— 本專案是 Fastify,無暴露(見 §0.3)
- ⏳ **ClamAV 掃毒 / presigned 混合下載**(#102 原列同批)—— 見 OQ-FU-7,建議拆出
- ❌ **清空 `pnpm audit` 全部 50 條** —— 見 §0.4,多數不在本模組射程

---

## 0. 深度研究(2026-07-29)— 業界實證

> 專案 P0 規則:研究即寫入 doc,附來源連結並標注證據強度。

### 0.1 🔴 推翻既有記載:CVE 歸屬錯誤

[file-storage.md](file-storage.md) §0-bis 殘留表原記:

> 「Fastify 4.28.1 已 EOL 不再收安全修補。**CVE-2026-33806**(Content-Type 前導空白繞過 body 驗證)只修在 5.8.5」

**該 CVE 不影響 4.28.1**。連線複核 advisory 逐字:vulnerable range 為 **`>= 5.3.2, <= 5.8.4`**,
它是 5.3.2 修 CVE-2025-32442 時引入的 regression,**4.x 分支從未受影響**
([GHSA-247c-9743-5963](https://github.com/advisories/GHSA-247c-9743-5963),證據:官方 advisory 明載)。

**結論不變但論據必須更換。** 真正打中 4.28.1 且 4.x 永無修補的是:

| Advisory | 嚴重度 | vulnerable | patched | 本地 `pnpm audit` 是否回報 |
|---|---|---|---|---|
| [GHSA-jx2c-rxcm-jvmq](https://github.com/advisories/GHSA-jx2c-rxcm-jvmq) CVE-2026-25223<br>Content-Type tab 字元繞過 body 驗證 | **high** | `< 5.7.2` | 僅 `5.7.2` | ✅ 是 |
| [GHSA-444r-cwp2-x5xf](https://github.com/advisories/GHSA-444r-cwp2-x5xf) CVE-2026-3635<br>`X-Forwarded-Proto/Host` 可偽造 | moderate | `<= 5.8.2` | 僅 `5.8.3` | ✅ 是 |

兩條的 patched 版本**都只出在 5.x** —— 因 [Fastify LTS 政策](https://fastify.dev/docs/latest/Reference/LTS/)明載 **v4 已於 2025-06-30 退役**。

> **方法教訓(與 print-merge 同一天的第二次)**|上一條錯在「只記文件編號不附 URL」,這一條錯在「記了 CVE 編號但未核對版本範圍」。
> **CVE 編號同樣無法自我驗證** —— 抄下編號時若不同時記錄 vulnerable range,就等於記了一個無法查核的斷言。
> 判準補充:引用 CVE 一律連同 **vulnerable / patched 版本範圍**一起記,並以 `pnpm audit` 對本地 lockfile 交叉驗證。

### 0.2 「不升級」這條路已被堵死

NestJS **無公開 LTS / EOL 政策文件**(查無;[Security Policy](https://github.com/nestjs/nest/security/policy) 只寫回報信箱)。
且 10.x 實際仍在發版、仍收安全 backport —— [GHSA-cj7v-w2c7-cp7c](https://github.com/advisories/GHSA-cj7v-w2c7-cp7c) 的 patched 版本
同時列出 `10.4.16` 與 `11.0.16`([issue #14890](https://github.com/nestjs/nest/issues/14890) 請求 backport 後獲得回應)。

→ **單看 NestJS,留在 10 是可行的。** 但被 adapter 堵死:`platform-fastify@10.4.22` 把 fastify 釘死在 `4.28.1`,
**連 4.29.1 都沒跟進**。以 pnpm `overrides` 強拉亦無用 —— 4.29.1 仍在 CVE-2026-25223 的 `< 5.7.2` 範圍內。
**升級是必然,差別只在時機。**

### 0.3 最痛的 breaking change 對本專案暴露為零

[NestJS 11 migration guide](https://docs.nestjs.com/migration-guide) 中社群災情最集中的是 **Express 5 + path-to-regexp v8**
(`*` → `*splat`、`?` → `{}`、不再支援 regexp 前綴)。本專案**完全不暴露**,已逐項對碼確認:

| 風險點 | 本專案 | 驗證方式 |
|---|---|---|
| Express adapter | ❌ 未使用(Fastify);官方明載 Fastify v5 路徑比對規則不變 | — |
| `MiddlewareConsumer` / `forRoutes` | ❌ **全庫零使用** | `grep -rn "MiddlewareConsumer"` 無結果 |
| `setGlobalPrefix` | ❌ 未呼叫(prefix 寫在 `@Controller("api/...")`) | 同上 |
| `enableCors()` | ❌ 未呼叫(web 走 Next rewrites 同源代理) | 同上 |
| 15 個 controller 路徑 | ✅ 純具名參數(`:formId/fields/:fieldId`),v8 完全支援 | 對碼 |
| `fastify.route({ url: "/api/auth/*" })` | ⚠️ 原生 Fastify route(find-my-way,非 path-to-regexp),`*` 仍支援 —— **但必須實測** | `auth-http.ts` |

> 這是本次評估最正面的發現:**一般 10→11 升級的主要成本在本專案不存在**。

### 0.4 `pnpm audit` 現況:50 條,但只有 16 條在本模組射程

實測 `pnpm audit`(2026-07-29,本地 lockfile):**50 vulnerabilities — 1 critical / 26 high / 20 moderate / 3 low**。

| 套件 | 條數 | 歸屬 |
|---|---|---|
| `@nestjs/platform-fastify` · `@fastify/middie` · `fastify` · `fast-uri` · `find-my-way` | **16** | 🎯 **本模組射程**(升級後應大幅收斂) |
| `next` | 8 | 前端,另案 |
| `undici` | 9 | 多數經 `@testcontainers/postgresql` 進來的 **devDependency** |
| `lodash` · `postcss` · `file-type` · `esbuild` · `uuid` · `sharp` · `drizzle-orm` · `@nestjs/core` | 12 | 各自另案 |

⚠️ **advisory 版本範圍的陷阱**:`@nestjs/platform-fastify <11.1.10` 這種寫法**涵蓋所有 10.x**,
故本專案雖未使用 middleware(那 4 條 middleware bypass 實質不適用),掃描工具仍會持續回報。
AGENTS.md 的 CI gate 要求 OSV/Trivy 掃描 fail CI → **這 16 條是 CI 長紅的結構性來源**。

### 0.5 升級後才會發現的隱藏問題(社群實證,最有價值的一節)

| 來源 | 內容 | 對本專案 |
|---|---|---|
| [nest#15022](https://github.com/nestjs/nest/issues/15022) | Fastify 5 的 `FST_ERR_CTP_INVALID_MEDIA_TYPE` **不再轉成 Nest `HttpException`** → 原始 FastifyError 直接外洩,**且不經 guard** | 🔴 直接命中:本專案有 `DomainExceptionFilter` 統一錯誤信封 + multipart 上傳。**必補測**「錯誤 content-type」路徑 |
| [nest#14484](https://github.com/nestjs/nest/issues/14484) | **monorepo 專屬坑**:升級後 root 與 workspace 同時存在 `@nestjs/core` 10 與 11 → `UnknownDependenciesException` | ⚠️ turborepo + pnpm workspace 是高發環境。緩解:刪 `node_modules` 重裝 + `pnpm why @nestjs/core` 驗證 |
| [nest#14455](https://github.com/nestjs/nest/issues/14455) | `moduleIdGeneratorAlgorithm` 預設改變被回報為 regression | escape hatch:`Test.createTestingModule({}, { moduleIdGeneratorAlgorithm: 'deep-hash' })` |
| [nest#14601](https://github.com/nestjs/nest/issues/14601) | 11.0.8 出現 `app.router is deprecated` 編譯錯 —— **11.0.x 早期不穩** | → 直上 11.1.28,不停在 11.0.x |
| [ghostfolio#4251](https://github.com/ghostfolio/ghostfolio/issues/4251) | 真實 OSS 專案升級,2025-01-27 開 → 2025-05-07 關(**約 3.5 個月**,非全職)。維護者原話:**「Automated tests don't cover much in this case」** | 🔴 **最重要的一句**:自動測試給不了信心。呼應 §4.1 |

**查不到的(誠實聲明)**|無人專門紀錄「純 Fastify adapter 專案」的 10→11 案例(社群文章幾乎全是 Express 情境);
亦查無明確的「升級後 rollback 回 v10」之生產事故報告。

### 0.6 來源

NestJS|[Migration guide](https://docs.nestjs.com/migration-guide) · [Trilon: Announcing NestJS 11](https://trilon.io/blog/announcing-nestjs-11-whats-new) · [Security Policy](https://github.com/nestjs/nest/security/policy)
Fastify|[LTS / EOL 政策](https://fastify.dev/docs/latest/Reference/LTS/) · [v5 Migration Guide](https://fastify.dev/docs/latest/Guides/Migration-Guide-V5/)
Advisory|[GHSA-247c-9743-5963](https://github.com/advisories/GHSA-247c-9743-5963) · [GHSA-jx2c-rxcm-jvmq](https://github.com/advisories/GHSA-jx2c-rxcm-jvmq) · [GHSA-444r-cwp2-x5xf](https://github.com/advisories/GHSA-444r-cwp2-x5xf) · [GHSA-cj7v-w2c7-cp7c](https://github.com/advisories/GHSA-cj7v-w2c7-cp7c) · [GHSA-6v32-fjc9-9qf6](https://github.com/advisories/GHSA-6v32-fjc9-9qf6)
Issue|[#14890 backport](https://github.com/nestjs/nest/issues/14890) · [#15022 content-type](https://github.com/nestjs/nest/issues/15022) · [#14484 monorepo](https://github.com/nestjs/nest/issues/14484) · [#14455 moduleId](https://github.com/nestjs/nest/issues/14455) · [#14601 app.router](https://github.com/nestjs/nest/issues/14601) · [ghostfolio#4251](https://github.com/ghostfolio/ghostfolio/issues/4251)
社群|[NestJS Schedule Module Multiple Registration Problem](https://jimfilippou.com/articles/2025/nestjs-schedule-module-multiple-registration-problem)

---

## 2. 現況走查

| 項目 | 現況 | 升級後 |
|---|---|---|
| `@nestjs/common` / `core` / `platform-fastify` | ^10.4.15 | **^11.1.28**(不可停在 11.0.x,見 §0.5)|
| `@nestjs/testing` | ^10.4.22 | ^11.1.28 |
| `@nestjs/config` | **^3.3.0** | 🔴 **^4.0.4**(v3 peer 僅 `^8‖^9‖^10`)|
| `@nestjs/schedule` | ^6.1.3 | ✅ 不動(peer 已含 `^11`)|
| `@nestjs/throttler` | ^6.5.0 | ✅ 不動(peer `^7…^11`)|
| `@fastify/multipart` | **^8.3.1** | 🔴 **^10**(v8 綁 `fastify-plugin@^4`)|
| `fastify` | **4.28.1**(直接釘) | 🔴 **移除此行**,由 adapter 帶 |
| `reflect-metadata` / `rxjs` / TypeScript | ^0.2.2 / ^7.8.1 / ^5.7.3 | ✅ 均在 v11 peer 範圍 |
| Node | root `engines: >=20.11.0`,實跑 v24 | ✅ v11 要求 >= 20 |

> `@nestjs/schedule@6` 與 `@nestjs/throttler@6` 的版號與 NestJS 主版本**無對應關係**,同為 6 是巧合。

---

## 4. 設計要點

### 4.1 🔴 `ScheduleModule.forRoot()` 重複註冊 —— 本次最大風險

**已對碼確認**,三處各自呼叫:

```
src/reliability/reliability.module.ts:11   → @Cron(EVERY_HOUR)        清理
src/notifications/notifications.module.ts:17 → @Cron(EVERY_MINUTE)    通知派送
src/billing/usage.module.ts:7              → @Cron(EVERY_DAY_AT_1AM)  用量統計
```

NestJS 10 以 **deep-hash** 去重 dynamic module —— 三個無參數且結構相同的 `forRoot()` 被合併成一個實例,故現況正常。
**NestJS 11 改以物件參考判定** → 三個各自獨立註冊,**每個 cron 會跑三次**
(官方 migration guide 明載此變更;[社群實案](https://jimfilippou.com/articles/2025/nestjs-schedule-module-multiple-registration-problem)為推播發三份)。

**對本專案的具體後果**:

| cron | 頻率 | ×3 的後果 |
|---|---|---|
| 通知派送 | 每分鐘 | **重複寄信 / 重複發 LINE** —— 使用者可見的事故 |
| 用量統計 | 每日 | **計費數字錯**(F-8 訂閱計費地基) |
| 清理 | 每小時 | 重複執行(冪等則僅浪費資源) |

**為什麼這一項特別危險**:`561` 個後端測試**結構上抓不到** —— 單元測試不跑 cron,整合測試不會等一分鐘。
綠燈與否和這個 bug 無關。它會在 prod 以「客戶收到三封一樣的信」的形式出現。

**修法**|`ScheduleModule.forRoot()` 只留在 `AppModule`,三個 feature module 移除。
**此修改對 NestJS 10 完全無害**(現況本來就被去重成一個),故**可先於升級獨立執行並驗證**(見 OQ-FU-2)。

**驗證方式(必須自己造)**|加一條測試,以 `SchedulerRegistry.getCronJobs()` 斷言**每個 cron 名稱只註冊一次**。
這條測試在 Nest 10 與 11 下都應為真,是跨版本的不變量 —— 也是唯一能把這個風險納入 CI 的辦法。

### 4.2 multipart 錯誤語義(承 §0.5 nest#15022)

Fastify 5 的 `FST_ERR_CTP_INVALID_MEDIA_TYPE` 不再自動轉為 Nest `HttpException`。
本專案的 `DomainExceptionFilter` 產出統一錯誤信封(`code`/`message`/`correlationId`/`timestamp`),
若該錯誤繞過 filter → **回傳形狀改變且可能洩漏內部錯誤字串**(違 AGENTS「禁回傳 stack trace / DB 錯誤給 client」)。

**因應**|升級後補測三條:(a) 非 multipart 的 content-type 打上傳端點、(b) 超過大小上限的截斷、(c) 完全無 body。
三者皆斷言**錯誤信封形狀**而非只看狀態碼。

### 4.3 升級順序

```
M1  ScheduleModule 收斂 + 註冊次數斷言測試   ← 對 Nest 10 無害,先驗證
M2  一次跳版:@nestjs/*@11.1.28 + config@4 + multipart@10 + 移除 fastify 直接相依
    → 刪 node_modules 重裝 → pnpm why 驗證無殘留 10.x
M3  錯誤語義補測(§4.2)+ 全套測試 + audit 前後對照
M4  瀏覽器實走(上傳 / 登入 / 匯入)+ FMEA + doc v1.0
```

---

## 4.4 落地結果(2026-07-29)

| 里程碑 | 內容 | 結果 |
|---|---|---|
| **M1** | `ScheduleModule.forRoot()` 收斂至 `AppModule` + 三個 cron 具名 + 註冊次數斷言測試 | ✅ commit `3f8230a`(先於升級,可獨立歸因)|
| **M2** | `@nestjs/*`→11.1.28 · `config`→4 · `multipart`→10 · `fastify` 移出 dependencies | ✅ **程式碼零改動**,type-check 0 error |
| **M3** | 錯誤信封回歸測試(3 條)+ `pnpm audit` 前後對照 + 傳遞相依 overrides | ✅ 566 測試全綠 |
| **M4** | 實走(登入 / 建表 / 填單 / 上傳 / 下載)+ 本節 + FMEA 回填 | ✅ |

**依賴變更**|4 升 1 移 1 加:`@nestjs/{common,core,platform-fastify,testing}` → 11.1.28 ·
`@nestjs/config` → ^4.0.4 · `@fastify/multipart` → ^10.1.0 · `fastify` 由 dependencies **移到 devDependencies 並釘死 `5.10.0`**。

### 🔴 為什麼 `fastify` 要釘死而非用 `^` 範圍

`@nestjs/platform-fastify@11.1.28` 的 `dependencies.fastify` 是 **`5.10.0`(釘死)**。
若本專案宣告 `^5.10.0`,在 fastify 發 5.11 時會解析出**第二份** —— 這正是 F-2 期「型別重複」的成因。
故置於 devDependencies(執行期由 adapter 提供)**且釘死同一版本**。已驗證 pnpm store 內僅一份 `fastify@5.10.0`。
> 升 adapter 時必須同步此版本號。判準:`ls node_modules/.pnpm | grep -c "^fastify@"` 應恆為 1。

### 供應鏈成效(OQ-FU-4 要求記錄前後數字)

| | 升級前 | 升級後 | 加 overrides |
|---|---|---|---|
| 總數 | **47** | 27 | **25** |
| critical | **1** | 0 | **0** |
| high | 24 | 13 | 11 |
| **fastify 鏈** | **16** | 2 | **0** |

剩餘的 `fast-uri` / `find-my-way` 兩條屬 fastify 5.10.0(已是最新)的傳遞相依、上游未修,
以 pnpm `overrides` 拉至已修版本(皆為 patch/minor 安全修補),566 個測試為驗證防線。
**待上游跟進後應移除該 overrides 區塊**,否則會壓住 fastify 自身的版本選擇。

### 🔴 實測推翻研究預測:cron ×3 在本版本組合下不成立

M0 §4.1 依官方 migration guide 與社群案例預判「Nest 11 改以物件參考去重 → 每個 cron 跑三次」,
並列為 FMEA U1(P0)。**升級後以探針實測,該風險不成立**:

```
恢復重複 forRoot()(app.module + reliability.module 共 2 次)後,
SchedulerRegistry 實際內容 = ["notifications.dispatch","billing.usageRollup","reliability.cleanup"]
→ 仍為 3 個,無重複。
```

原因已對原始碼查明:`ScheduleModule.forRoot()` 回傳 `{ global: true, ... }`,
而真正執行註冊的 `SchedulerOrchestrator` 宣告在**靜態 `@Module` 的 providers** 上(非 `forRoot` 的 providers),
故無論 `forRoot` 被呼叫幾次,orchestrator 只有一份;且其註冊為 `this.cronJobs[name] = {...}` 之**物件屬性賦值**,
同名只會覆蓋不會累積。

**M1 的改動仍然保留,但價值定位須誠實下修**:
- ❌ 不是「修掉一個 P0 事故」
- ✅ 是「**消除對框架去重行為的隱性依賴**」—— 原寫法能運作是因為框架剛好幫忙去重,那不是本專案該依賴的契約
- ✅ 具名讓 cron 在 registry 中可辨識(原本是 `crypto.randomUUID()`),日後要動態停用 / 觀測才有 handle
- ✅ 註冊次數斷言測試釘住「應有幾個 cron」,新增未具名 cron 時會紅

> **方法上的一致性**|本 session 第三次由實測推翻書面預測(前兩次:E-1 的表單級閘實為粗網、print-merge 的 CVE 歸屬)。
> 研究負責指出方向與風險假說,**實測負責裁決**;兩者不可互相取代。

### 未在 M0 預見、實走才確認的事

| 項目 | 結果 |
|---|---|
| `/api/auth/*` 萬用字元路由在 find-my-way v9 | ✅ `get-session` 200,比對正常(M0 標為「必須實測」的 ⚠️ 項)|
| multipart 上傳 / 下載串流 | ✅ 上傳 201(magic bytes 驗型別 + 生成檔名)、下載位元組完全一致,`Content-Disposition: attachment` 與 `nosniff` 皆保留 |
| 錯誤信封 | ✅ 錯誤 content-type / 空 body / text-plain 三種皆走統一信封,未外洩 `FST_ERR` 或堆疊 |
| ⚠️ **Better Auth rate limit 取不到 client IP** | 升級後 log 出現警告:falling back to 單一共用 per-path bucket。**非本次升級造成**(dev 無反向代理),但 **prod 上線前必須設定 `trustedProxies` / `ipAddressHeaders`**,否則速率限制形同全域共用。已列殘留 |

---

## 10. 開放問題(OQ-FU-N)— ✅ **已裁定 2026-07-29(全採建議)**

| # | 問題 | 選項 | 建議 |
|---|---|---|---|
| **OQ-FU-1** ⭐⭐ | 升或不升? | A. **升到 NestJS 11**<br>B. 留在 10,以 pnpm `overrides` 強拉 fastify<br>C. 留在 10 並接受風險 | **A** — B 已驗證無效:4.29.1 仍在 CVE-2026-25223 範圍內,且 4.x 永無修補([Fastify LTS](https://fastify.dev/docs/latest/Reference/LTS/) 明載 v4 已退役)。C 則讓 CI 的供應鏈 gate 永久紅燈。**唯一的變數是時機不是方向** |
| **OQ-FU-2** ⭐ | ScheduleModule 收斂何時做? | A. **先獨立一個 commit,在 Nest 10 下驗證**<br>B. 併入升級 commit | **A** — 此修改對 Nest 10 無害,先做可**把「最大風險」與「最大變更」分離**:若升級後 cron 出問題,能立刻判斷是不是這一項。混在一起則無從歸因。且註冊次數斷言測試先進 CI,升級時就有防線 |
| **OQ-FU-3** ⭐ | 一次跳版 vs 漸進? | A. **一次跳到 11.1.28**<br>B. 先 11.0.x 再 11.1.x | **A** — [#14601](https://github.com/nestjs/nest/issues/14601) 顯示 11.0.x 早期有 `app.router` 編譯錯;且 platform-fastify 11.x 累積四條 middleware bypass CVE,patched 到 **11.1.24** 才齊。停在中間版本只是多踩一輪 |
| **OQ-FU-4** | `pnpm audit` 清到什麼程度? | A. **只求本模組射程的 16 條收斂,其餘記錄不處理**<br>B. 全清 50 條<br>C. 不設目標 | **A** — B 會把 `next` / `undici`(devDep)/ `sharp` 等各自獨立的問題綁進同一批,違「一次只動一件事」。**但須明確記錄升級前後的數字**,否則無從得知升級是否真的有效 |
| **OQ-FU-5** | cron 重複註冊如何驗證? | A. **寫 `SchedulerRegistry` 註冊次數斷言測試**<br>B. 靠人工觀察 log<br>C. 不驗證 | **A** — 這是唯一能進 CI 的形式。B 在每分鐘的 cron 上或許可行,但每日的用量統計要等到隔天,而錯誤後果是**計費數字**。C 不可接受:ghostfolio 維護者的原話正是「自動測試在這個情境覆蓋不到多少」,那更該補上覆蓋得到的那一條 |
| **OQ-FU-6** | multipart 升 9 還是 10? | A. **^10**(最新)<br>B. ^9(最小跳躍) | **A** — v9 綁 `fastify-plugin@^5`、v10 綁 `^6`,兩者都能配 fastify 5;既然要動就到最新,避免半年後再來一次。**代價**:v8→v10 跨兩個大版本,需重讀其 breaking changes(M2 執行時逐項對照) |
| **OQ-FU-7** ⭐ | #102 原本包含的 ClamAV / presigned 是否納入本批? | A. **拆出,本模組只做框架升版**<br>B. 三件一起做 | **A** — 三者唯一的交集是「都被記在 #102」。框架升版是**全域風險**(動到每一條請求路徑),ClamAV 與 presigned 是 **file-storage 的功能增量**;混在一批會讓「升級後出問題」無從歸因。且 `@fastify/multipart@10` 升上去正好是 presigned 工作的前置。**建議**:本模組收框架升版,ClamAV / presigned 另立 file-storage M6 |

---

## 12. 失效場景反思(FMEA)— pre-mortem 預列

| # | 場景 | 預定緩解 | Sev |
|---|---|---|---|
| U1 | **cron ×3 → 重複寄信 / 計費數字錯** | §4.1 先行收斂 + `SchedulerRegistry` 註冊次數斷言(**測試套件結構上抓不到,必須自己造**) | **P0** |
| U2 | **multipart 錯誤繞過 `DomainExceptionFilter` → 洩漏內部錯誤字串** | §4.2 三條錯誤語義測試,斷言錯誤信封形狀 | **P0** |
| U3 | monorepo 同時存在 `@nestjs/core` 10 與 11 → DI 解析失敗 | 刪 `node_modules` 重裝 + `pnpm why @nestjs/core` 驗證單一版本 | P1 |
| U4 | `/api/auth/*` 在 find-my-way v9 下比對行為改變 → 登入全掛 | 升級後**第一個**實走的流程即為登入;`auth.spec` 已固化 | **P0** |
| U5 | `Test.createTestingModule` module 去重改變 → 整合測試大量失敗 | escape hatch `moduleIdGeneratorAlgorithm: 'deep-hash'`([#14455](https://github.com/nestjs/nest/issues/14455)) | P1 |
| U6 | `@nestjs/config@4` 讀取順序改變(內部 config 優先於 `process.env`)→ env 覆寫失效 | 本專案只用 `forRoot({ isGlobal, validate })`,暴露面小;`env.test.ts` 8 條斷言為防線 | P1 |
| U7 | 升級後 audit 條數未如預期下降 → 白做 | OQ-FU-4 要求記錄前後數字;若未降則需查明是否有其他路徑帶入舊版 | P2 |
| U8 | graceful shutdown 的 lifecycle hook 改為反序執行 → 連線池關閉時序改變 | `DbLifecycle.onModuleDestroy` 關連線池;反序(依賴者先關)實際上更安全,但需實測 SIGTERM | P1 |

---

### 12.2 實作後回填(2026-07-29)

| # | 結果 |
|---|---|
| U1 cron ×3 | ⬇️ **降級:實測不成立**(見 §4.4)。改動保留為「消除對框架去重的隱性依賴」,非事故修補 |
| U2 multipart 錯誤繞過 filter | ✅ 三條錯誤語義測試 + 實走皆確認信封完整、無 `FST_ERR` 外洩 |
| U3 monorepo 雙版本 | ✅ 刪 `node_modules` 重裝;實測 `@nestjs/core` 僅 11.1.28 一份、`fastify` 僅 5.10.0 一份 |
| U4 `/api/auth/*` 比對改變 | ✅ 實走 `get-session` 200 |
| U5 `Test.createTestingModule` 去重 | ✅ 未發生,566 測試全綠(escape hatch 未動用)|
| U6 `@nestjs/config@4` 讀取順序 | ✅ 未發生,`env.test.ts` 8 條斷言全綠 |
| U7 audit 未下降 | ✅ 47 → 25,fastify 鏈 16 → 0 |
| U8 lifecycle 反序 | ⏳ **未驗**:dev 以 SIGKILL 重啟,未實測 SIGTERM 下的連線池關閉時序。列殘留 |

**新增殘留(非本次 scope)**|(a) Better Auth 在 prod 需設 `trustedProxies`,否則速率限制退化為全域共用桶;
(b) U8 的 graceful shutdown 時序未實測;(c) `fast-uri` / `find-my-way` 的 overrides 待上游跟進後移除。

---

## 13. 變更紀錄

| 日期 | 版本 | 變更 | 作者 |
|---|---|---|---|
| 2026-07-29 | **v1.0 SHIPPED** | M1→M4 落地(§4.4)。**程式碼零改動**完成 NestJS 10→11 + Fastify 4→5;audit 47→25、fastify 鏈 16→0、critical 歸零。**實測推翻 M0 的頭號風險預測**:cron ×3 在 `@nestjs/schedule@6.1.3` + NestJS 11.1.28 下不成立(orchestrator 為靜態 provider 且以物件賦值註冊),M1 改動的價值定位誠實下修為「消除對框架去重行為的隱性依賴」。釐清 `fastify` 必須釘死與 adapter 同版否則型別重複重演。殘留:prod trustedProxies / SIGTERM 時序 / overrides 待上游 | Claude Code |
| 2026-07-29 | v0.1 | M0 DRAFT。**盤查推翻原始範圍認知**:`platform-fastify` 把 fastify 當直接相依且釘死 → 「升 Fastify 5」實為「升 NestJS 11」。**§0.1 更正 file-storage 的 CVE 歸屬錯誤**(CVE-2026-33806 不影響 4.28.1;真正命中的是 CVE-2026-25223 / CVE-2026-3635)。**§4.1 揪出最大風險**:`ScheduleModule.forRoot()` ×3,Nest 11 去重機制改變後每個 cron 會跑三次,而 561 個測試結構上抓不到。§0.3 確認 path-to-regexp v8 對本專案暴露為零。OQ-FU-1..7 待裁定 | Claude Code |
