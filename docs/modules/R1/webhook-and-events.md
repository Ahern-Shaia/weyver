# webhook-and-events.md — [G-1] 事件匯流排 + 出站 Webhook + API 金鑰設計文件

| | |
|---|---|
| 狀態 | ✅ **SHIPPED v1.0(2026-07-30)** — OQ-WH-1..10 全採建議 |
| 建立 | 2026-07-30 |
| 上游 | docs/25 §162「Webhook + Event bus 2」· §166「API 金鑰管理 UI 1」· §247 下一批優先序 |
| 依賴 | form-engine-core(事件源)· notifications(共用事件匯流排)· authz(載荷欄位遮罩)· reliability(配額 / 冪等) |
| 併行 | [G-2 public-form](public-form.md)(同屬「對外接縫」,但威脅模型相反 —— 出站 vs 匿名入站,故分兩份) |

---

## 1. 目標與現況盤查

### 1.1 現況:三項全新,但**兩個前提與既有文件不符**

`grep` 全 `src/`:`webhook` / `publicForm` / `apiKey` **零命中**。三項皆從零。
但盤查同時推翻兩件本專案文件記載的事:

**🔴 (a) BullMQ 與 DBOS 都沒有安裝。**
AGENTS.md ⚙️ 與 docs/20 §25 都把 BullMQ / DBOS 當既定選型在寫(「背景工作 → DBOS + BullMQ」),
`apps/api/package.json` 裡**兩者都不存在**。實際在跑的是:

```
notification_delivery 表(status / attempts / next_attempt_at)
  ← 每分鐘 cron `notifications.dispatch` 抽取
  ← 退避 2^attempts 分鐘,超過 MAX_ATTEMPTS 標 failed
```

**這就是 outbox pattern,而且已在 prod 路徑上驗證過。** Webhook 投遞應復用它 —— 見 OQ-WH-1。
順帶:研究指出 **BullMQ 的 group / per-group 併發是 BullMQ Pro 商業功能**,
OSS-only 下本來就不能靠它做順序保證,引進 BullMQ 換不到我們真正想要的東西。

**🔴 (b) `record.created` / `record.updated` 是死路徑。**
兩個事件碼在 `notification-specs.ts` 宣告、單元測試覆蓋了 `levelAllows` 過濾邏輯,
但全專案只有 **2 個 `this.notify.*` 呼叫點,都在 `approval.service.ts`**;
無 DB trigger;`RecordService` 從未注入 `NotificationService`。

後果:通知設定頁四個檔位中,**預設檔**(level 10「與我相關 —— 我建立的資料有變更時通知我」)
與 level 20 / 30 **全部永遠不會觸發**。單元測試是綠的,因為它測的是純函式,不是「有沒有人呼叫」。

`NotificationsModule` 是 `@Global()`,其註解明文寫「需被多個業務模組(actions / **form-engine**)
注入」—— **線早就拉好了,只是沒人接上**。

→ **Webhook 需要的正是同一個事件發射點。做這個發射點會順手把這條死路徑補起來**(OQ-WH-10)。

### 1.2 目標

1. **事件匯流排**|記錄 / 表單變更在**業務同一 tx** 內落 outbox,單一事件源同時餵通知與 webhook
2. **出站 Webhook**|Standard Webhooks 簽章 · 重試退避 · 自動停用 · 投遞紀錄與重送
3. **SSRF 防護**|使用者填的 URL 是 P0 威脅面(docs/22 威脅前三)
4. **API 金鑰**|外部系統呼叫既有 REST API 的認證途徑(簽發 / 輪替 / 撤銷 / scope)

### 1.3 不做

- ❌ **exactly-once**|無任何廠商宣稱做得到,不假裝
- ❌ **嚴格順序保證**|見 OQ-WH-8
- ❌ 入站 webhook(第三方推給我們)|非本批
- ❌ 事件重播成完整資料流(CDC)|非 R1

---

## 0. 深度研究(2026-07-30)

> §0.6 為**本機 Node 24 實測**,驗證的是「修法在我們的 runtime 上是否真的有效」,不是抄結論。

### 0.1 簽章與防重放

| 系統 | Header | 簽的字串 | 時戳 | 輪替 |
|---|---|---|---|---|
| **Standard Webhooks / Svix** | `webhook-id` / `webhook-timestamp` / `webhook-signature` | `{id}.{ts}.{body}` | ✅ | **同 header 空白分隔多簽章**,零停機 |
| Stripe | `Stripe-Signature: t=..,v1=` | `{t}.{raw_body}` | ✅ 300s | 多把秘鑰各出一個 `v1=`,舊鑰留 24h |
| Slack | `X-Slack-Signature` + `X-Slack-Request-Timestamp` | `v0:{ts}:{body}` | ✅ 5 分鐘 | 可 regenerate |
| GitHub / Shopify / Airtable | `X-Hub-Signature-256` 等 | **僅 raw body** | ❌ | 未載 |
| Notion | `X-Notion-Signature` | body | 未載 | 秘鑰=建立時一次性 `verification_token` |

全數 HMAC-SHA256。Standard Webhooks 定義了 ed25519 非對稱版(`v1a`),
但 Svix **明載 HMAC「較普遍、為推薦、為預設」**。
→ **GitHub / Shopify 無時戳的做法不要學**:它們靠 delivery id 把防重放責任推給消費端,
對 ERP 過帳場景太弱。

### 0.2 投遞保證與重試

| 系統 | 曲線 | 總時長 | 自動停用 |
|---|---|---|---|
| Svix | 立即 / 5s / 5m / 30m / 2h / 5h / 10h / 10h(8 次) | ~27.5h | 全失敗達 5 天,**且**須「24h 內多次失敗、首末間隔 ≥12h」 |
| Stripe | 指數退避(區間未公開) | 3 天 | 持續失敗 3 天 → 停用 + email |
| Shopify | 指數退避 8 次 | 4 小時 | **連續 8 次失敗自動刪除訂閱** |
| GitHub | **完全不自動重送** | — | 未載 |

**at-least-once 是共識,無任何一家宣稱 exactly-once。**
**順序**:Stripe 明載不保證;Shopify 明載「同 topic 內、同資源跨 topic 都不保證」,
官方建議用時間戳比對 + **定期對帳 job** 補漏。

Svix 的**雙條件停用**值得抄:單看「連續失敗次數」會讓消費端一次短暫維護就被停用。

### 0.3 🔴 SSRF —— 本節最高價值

**Node 特有的致命坑**|Budibase **CVE-2026-54353 / GHSA-v42f-v8xc-j435**:
已解析並驗證 IP,但實際請求走 **undici,undici 在連線時重新解析 DNS** → TOCTOU rebinding 繞過。
MCP-Atlassian **CVE-2026-27826** 同一類。
**NestJS + Fastify 用的就是 Node 原生 fetch = undici,這個坑我們必踩。**

| 來源 | 做法 |
|---|---|
| **GitLab** | 預設封鎖本機 / `127.0.0.1` / `::1` / `10-8` / `172.16-12` / `192.168-16` / IPv6 site-local;**獨立的 DNS-rebinding 防護開關(預設開)**;允許清單上限 1000、不支援萬用字元 |
| **GitLab CVE-2025-6454** | 透過 webhook **自訂 header 注入**繞過 → **header 值也是注入面**,需獨立驗證 |
| **n8n** | 有完整 SSRF 服務,但 **預設 `enabled: false`**(issue #28035)→ **反面教材:預設關等於沒有** |
| **OWASP Node.js** | WHATWG URL 解析(禁 regex)· scheme 白名單只留 http/https · 解析後對**全部** IP 分類封鎖 · **每次 redirect 重新驗證** |
| **Stripe** | live mode 要求 HTTPS;**3xx 視為投遞失敗** |

### 0.4 事件載荷:thin vs fat

- **Stripe v2 轉向 thin events**,明載理由:「快照資料在處理時可能已過期」「載荷小」「thin 不需版本管理」
- **Airtable 是最貼近本平台的範例**:通知只是 ping 不帶資料,消費端拿 cursor 呼叫 `listPayloads` 取增量
- Notion 同為 sparse payload;Shopify / GitHub 則是 fat
- thin 的代價(明載):回查造成 API rate limit 壓力
- 命名(Standard Webhooks):階層式句點分隔、資源單數、動作過去式(`record.created`)、載荷建議 <20KB

🔴 **欄位級權限 × webhook 載荷:所有廠商都沒有明文討論**(研究誠實標為缺口)。
但 Airtable / Notion 的架構**隱含解決了它** —— 不帶資料的 ping 讓權限在
「消費端持 token 回查」那一刻才重新評估,訂閱時的權限快照不會凍結成洩漏管道。

### 0.5 可觀測性

Stripe:Dashboard 重送 15 天、CLI 30 天、事件 API 保留 30 天。
Svix:手動重試 / **Recover Failed**(指定日期起全補)/ **Replay Missing**(送從未嘗試過的)。
GitHub:重送時 **`X-GitHub-Delivery` 保持不變**(給消費端去重,但也代表無法區分是否為重送)。

### 0.6 🔴 本機實測:SSRF 修法在 Node 24 上是否真的有效

研究說「用 `new Agent({ connect: { lookup } })` pin 住已驗證的 IP」。
**這是我們自己的 runtime,不能只是採信。** 實測(Node v24.14.0,原生 fetch):

```js
const pinnedLookup = (hostname, opts, cb) => {
  resolveCount += 1
  cb(null, [{ address: "127.0.0.1", family: 4 }])   // 假裝這是先前已驗證的 IP
}
setGlobalDispatcher(new Agent({ connect: { lookup: pinnedLookup } }))
await fetch(`http://localtest.me:${port}/`)
```

| 驗證項 | 結果 |
|---|---|
| `connect.lookup` 是否被呼叫 | ✅ **是**,一次請求呼叫一次,收到的是 hostname |
| 是否為**唯一**解析路徑 | ✅ **是** —— 不帶 lookup 時走系統 DNS(本機解析不到即 `fetch failed`);帶了就完全不碰系統 DNS |
| `redirect: "error"` 是否擋 3xx | ✅ **是**,擲出 `unexpected redirect` |

→ **pin 修法在本專案版本上成立**,且因為解析權完全在我們手上,
「驗證後又被重解」的空窗**結構上不存在**,不是靠時間差賭贏。

**🔴 但最終沒有採用 undici。** 驗證有效之後才發現 undici 8 的 dispatcher 型別
與 Node 內建的 `undici-types` 版本不一致(`onBodySent` 簽名不同),
`fetch` 的 `dispatcher` 參數過不了 type-check。於是回頭實測 `node:https`:

| 驗證項(Node v24.14.0) | 結果 |
|---|---|
| `new http.Agent({ lookup })` 的 lookup 是否被呼叫 | ✅ 是(Node 24 走 `lookupAndConnectMultiple`,callback 需**回陣列**)|
| `https.request` 是否自動跟隨 3xx | ✅ **不跟隨**,302 原樣回傳 |

→ **改用 `node:https`**:同樣有效、**零新依賴**、無型別衝突,
且「不跟隨轉址」是預設行為而非一個要記得設的開關。
研究給的是對的方向,但最終選型由**在自己 runtime 上的實測**決定。

### 0.7 誠實聲明:查不到的

- GitHub 是否 / 何時自動停用失效 webhook、delivery log 保留期
- Stripe 指數退避的實際區間值(未公開)
- **欄位級權限 × webhook 載荷**:無任何廠商明載,§4.4 的設計為本專案自行推導
- Ragic 的 webhook 公開文件:未找到
- Airtable 官方開發者文件抓取被網域政策擋下,7 天到期與 payload 保留期僅二手來源

### 0.8 來源

規格|[Standard Webhooks spec](https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md) · [Svix Retry Schedule](https://docs.svix.com/retries) · [Svix Security](https://docs.svix.com/security) · [Svix 零停機秘鑰輪替](https://www.svix.com/blog/zero-downtime-secret-rotation-webhooks/) · [Svix 事件命名慣例](https://www.svix.com/resources/webhook-university/implementation/webhook-event-naming-conventions/)
廠商|[Stripe Webhooks](https://docs.stripe.com/webhooks) · [Stripe Event Destinations(thin vs snapshot)](https://docs.stripe.com/event-destinations) · [GitHub 驗證投遞](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries) · [GitHub 處理失敗投遞](https://docs.github.com/en/webhooks/using-webhooks/handling-failed-webhook-deliveries) · [Slack 驗證請求](https://docs.slack.dev/authentication/verifying-requests-from-slack) · [Shopify 訂閱 webhook](https://shopify.dev/docs/apps/build/webhooks/subscribe/https) · [Shopify 最佳實務](https://shopify.dev/docs/apps/build/webhooks/best-practices) · [Notion Webhooks](https://developers.notion.com/reference/webhooks) · [Airtable list webhook payloads](https://airtable.com/developers/web/api/list-webhook-payloads)
SSRF|[GitLab webhook 安全](https://docs.gitlab.com/security/webhooks/) · [GitLab CVE-2025-6454(header 注入)](https://zeropath.com/blog/gitlab-cve-2025-6454-ssrf-webhook-summary) · [n8n SSRF 預設關閉 #28035](https://github.com/n8n-io/n8n/issues/28035) · [Budibase CVE-2026-54353](https://advisories.gitlab.com/npm/@budibase/backend-core/CVE-2026-54353/) · [Budibase GHSA-v42f-v8xc-j435](https://advisories.gitlab.com/npm/@budibase/server/GHSA-v42f-v8xc-j435/) · [MCP-Atlassian GHSA-489g-7rxv-6c8q](https://github.com/advisories/GHSA-489g-7rxv-6c8q) · [OWASP Node.js SSRF 防護](https://owasp.org/www-community/pages/controls/SSRF_Prevention_in_Nodejs) · [undici SSRF issue #2019](https://github.com/nodejs/undici/issues/2019)
其他|[Hookdeck: what are thin events](https://hookdeck.com/webhooks/guides/what-are-thin-events)

---

## 4. 設計要點

### 4.1 單一事件源:`event_outbox`

記錄變更在 **`RecordService.inTenantTx` 同一 tx** 內落 outbox 列。
一支 cron 抽取後**扇出**到兩個消費者:通知(補死路徑)+ webhook 投遞。

理由三條:(a) webhook 送出是 I/O,絕不能在業務 tx 裡做;(b) AGENTS ⚙️ 明文要求跨模組副作用走
outbox;(c) 一份事件源餵兩個消費者,不會出現「通知看得到但 webhook 看不到」的漂移。

`approval.*` 現行直呼可用,**本批不動它**(能跑的東西不為了整齊而改),但新事件一律走 outbox。

### 4.2 投遞:復用既有 cron-drained outbox

`webhook_delivery` 完全比照 `notification_delivery` 的欄位形狀
(`status` / `attempts` / `next_attempt_at`),退避改用 Svix 曲線並為過帳類事件延長。
**不引進 BullMQ** —— 理由見 §1.1(a)。

### 4.3 🔴 SSRF 安全鏈(依序,缺一不可)

1. **HTTPS-only + TLS ≥1.2**,WHATWG URL 解析,scheme 白名單
2. **不跟隨 3xx** —— `https.request` 預設即如此(Stripe 亦把 3xx 視為投遞失敗),
   零功能損失砍掉「先回公網 302 再跳內網」整類繞過
3. **DNS pin**|自己解析 → 驗證**全部**回傳 IP → `new https.Agent({ lookup: () => 那個已驗證 IP })`。
   §0.6 實測證明 lookup 是唯一解析路徑,空窗結構上不存在。
   多筆 A 記錄中夾一筆內網 IP 是常見手法,**只驗第一筆等於沒驗**
4. **封鎖表**|`127/8` `::1` `0.0.0.0/8` `10/8` `172.16/12` `192.168/16` `169.254/16`(含各雲 metadata)
   `fc00::/7` `fe80::/10` `100.64/10` CGNAT / 多播廣播,**IPv4-mapped IPv6 正規化後再判**,
   並封鎖自身 PG / API 的內網位址
5. **自訂 header 白名單 + 值驗證**(GitLab CVE-2025-6454:header 值也是注入面)
6. **啟用前挑戰**|新端點須先回應 challenge 才能啟用 —— 除了證明端點可控,
   也避免平台淪為打第三方的放大器
7. **egress 網路層**|應用層終究會被繞過(GitLab / Budibase 都是實例)→ 列**部署前提**,不是本批程式碼

### 4.4 🔴 載荷以誰的權限產生

業界無先例(§0.4),自行推導兩條硬規則:

- **(a) 以 webhook 訂閱綁定的服務主體之欄位 ACL 產生,不是以觸發變更那位使用者的權限。**
  否則低權使用者一存檔,就把他自己都看不到的高權欄位噴到外部端點。
- **(b) ACL 在送出當下重算,不用訂閱時的快照。** 欄位權限被收回必須立刻停止外流。

預設 **thin**(`event_id` / `type` / `tenant_id` / `resource_ref` / `sequence` / `occurred_at`);
fat 為 opt-in 且**逐欄白名單**;**過帳類事件強制 thin**(金額 / 成本敏感)。

---

## 3. scope 切分

| 里程碑 | 內容 | 估算 |
|---|---|---|
| **M1 事件匯流排** | `event_outbox` + `RecordService` 同 tx 落列 + cron 扇出 + **補通知死路徑** | 0.4 mo |
| **M2 SSRF 安全鏈** | URL 驗證 / IP 封鎖表 / DNS pin agent / redirect error / header 白名單 + 對抗性測試 | 0.4 mo |
| **M3 Webhook 投遞** | 訂閱 CRUD · Standard Webhooks 簽章 + 輪替 · 退避重試 · 雙條件自動停用 · 啟用挑戰 | 0.6 mo |
| **M4 API 金鑰** | 簽發 / 輪替 / 撤銷 / scope · 認證 guard · 速率限制 | 0.4 mo |
| **M5 前端** | 端點管理 · 投遞紀錄與重送 · 測試發送 · 金鑰管理 | 0.5 mo |
| **M6 收尾** | FMEA · e2e · doc v1.0 · MODULES · docs/25 回填 | 0.2 mo |

**合計 ≈ 2.5 mo**(docs/25 記 Webhook 2 + API 金鑰 1 = 3;M1 含補通知死路徑)。前後端分開 commit。

### 實作結果

| | |
|---|---|
| commit | `f0aecee` 地基(事件/SSRF/簽章/投遞)· `b3b8856` 發射點接線+扇出+端點 API · `55a989d` API 金鑰 · `89c4c98` SSRF 錯誤映射 · `21436dc` 前端 |
| migration | 0034(`event_outbox` / `webhook_endpoint` / `webhook_delivery` / `api_key`)|
| 測試 | api **676 綠**(SSRF 對抗性 40 + 簽章 8 + 整合 22)· web 87 · e2e 4 條 |
| 反向驗證 | IPv4-mapped 正規化 / 跨租戶扇出 / 未驗證端點閘門 / 金鑰租戶過濾 / 金鑰過期 —— 拔掉即轉紅 |
| 新依賴 | **零**(實測後改用 `node:https` 取代 undici)|

---

## 10. 開放問題(OQ-WH-N)— ✅ 2026-07-30 全採建議

| # | 問題 | 選項 | 建議 |
|---|---|---|---|
| **OQ-WH-1** ⭐⭐ | 投遞基礎設施 | A. **復用既有 cron-drained outbox**<br>B. 引進 BullMQ | **A** — BullMQ 根本沒裝(§1.1a),而既有 `notification_delivery` 模式已在 prod 驗證。且研究指出 **group 併發是 BullMQ Pro 商業功能**,OSS-only 下引進它換不到我們想要的順序保證。少一個依賴、少一個 Redis 故障面 |
| **OQ-WH-2** ⭐ | 簽章規格 | A. **Standard Webhooks**<br>B. 仿 Stripe 自訂<br>C. 僅 body HMAC(GitHub 式) | **A** — OSS 規格,一次拿到 id + 時戳 + 同 header 多簽章(零停機輪替),且各語言有現成 verify 套件,客戶接得快。**C 一票否決**:無時戳把防重放推給消費端,對 ERP 過帳太弱 |
| **OQ-WH-3** ⭐ | 載荷 thin / fat | A. **預設 thin,fat opt-in 且逐欄白名單**<br>B. 一律 fat | **A** — Stripe v2 正在往 thin 走,Airtable 就是 ping + 回查。thin 順帶迴避了「訂閱時的權限快照凍結成洩漏管道」。**過帳類強制 thin** |
| **OQ-WH-4** ⭐⭐ | 載荷以誰的權限產生 | A. **訂閱綁定的服務主體 + 送出當下重算**<br>B. 觸發變更的使用者<br>C. 不遮罩 | **A** — B 會讓低權使用者一存檔就把高權欄位噴出去;C 直接違反欄位級權限。**業界無先例**(§0.4 研究明確標為缺口),這是本平台自己的問題 |
| **OQ-WH-5** ⭐⭐ | SSRF 深度 | A. **§4.3 全鏈(1-6)現在做,egress 網路層列部署前提**<br>B. 只做 IP 封鎖表 | **A** — B 正是 Budibase CVE 的樣子(驗了 IP 但 undici 重解)。§0.6 已在本專案 runtime 實測 pin 與 redirect 阻擋皆有效,**成本已知且低,沒有理由只做一半**。n8n 的教訓:預設關等於沒有 → 本專案**無開關,一律啟用** |
| **OQ-WH-6** | 端點啟用挑戰 | A. **必做**<br>B. 不做 | **A** — Slack `url_verification`、Notion 一次性 token 皆此模式。除了證明端點可控,也避免平台成為打第三方的放大器 |
| **OQ-WH-7** | 自動停用閾值 | A. **Svix 雙條件**(5 天全失敗 **且** 24h 內多次、首末間隔 ≥12h)<br>B. 連續 N 次即停 | **A** — B 會讓消費端一次短暫維護就被停用。停用時寫 audit + 站內通知 + email |
| **OQ-WH-8** | 順序保證 | A. **不保證,載荷帶 per-resource 遞增 `sequence`**<br>B. 自建 per-resource advisory lock 序列化 | **A** — Stripe / Shopify 皆明載不保證,官方建議消費端用時間戳比對 + 對帳 job。B 吞吐代價高換來的東西業界都不做 |
| **OQ-WH-9** ⭐ | 本批 scope | A. **Webhook + 事件匯流排 + API 金鑰(G-1),公開表單另開 G-2**<br>B. 三項一起 | **A** — 出站與匿名入站的**威脅模型相反**(前者防我們打別人,後者防別人灌我們),混在一份 doc 會讓 FMEA 失焦。G-2 的研究已同步寫入 [public-form.md](public-form.md),不會流失 |
| **OQ-WH-10** ⭐⭐ | 順帶修通知死路徑? | A. **修**(事件匯流排一併餵通知)<br>B. 不修,只做 webhook | **A** — §1.1(b):通知**預設檔位**承諾的行為從未發生過。webhook 需要的正是同一個發射點,`NotificationsModule` 已是 `@Global()` 且註解明文列 form-engine 為預期消費者 —— **線早就拉好,接上去幾乎零成本**。不修等於明知有洞而繞過 |

---

## 12. 失效場景反思(FMEA)

| # | 場景 | 處置 | Sev | 狀態 |
|---|---|---|---|---|
| W1 | 🔴 **SSRF 打進內網 / 雲端 metadata** | §4.3 全鏈:https-only · 不跟隨 3xx · **DNS pin** · 12 段封鎖表 · IPv4-mapped 正規化 · header 控制字元。**40 條對抗性測試**,建端點時即驗(不等投遞) | **P0** | ✅ |
| W2 | 🔴 **載荷洩漏訂閱者無權的欄位** | 目前**僅送 thin**(只有參照,無欄位值)→ 洩漏面為零。fat 模式與 §4.4 兩條硬規則列後續,未實作前不開放 | **P0** | ✅(以 thin-only 達成)|
| W3 | 🔴 **跨租戶投遞** | 事件與訂閱皆綁 `tenant_id` 且走 RLS;測試斷言 A 的事件不排進 B 的端點,**已反向驗證** | **P0** | ✅ |
| W4 | 秘鑰外洩 / 出現在 log | 秘鑰只在簽發當下回傳一次;API 金鑰只存 hash;回應內容截斷 2KB | **P0** | ✅ |
| W5 | 資料寫了但事件沒寫(或反之) | **同一 tx**;測試斷言 rollback 時兩者皆不留 | **P0** | ✅ |
| W6 | 惡意端點慢回應拖垮投遞器 | per-request 10s timeout + 每輪批次上限 50 + advisory lock 單實例 | P1 | ✅ |
| W7 | 投遞紀錄無限成長 | ⏳ 分批抽取已有,**熱存 30 天後歸檔未做**,列後續 | P1 | ⏳ |
| W8 | 重送造成消費端重複處理 | 沿用原 `webhook-id`;at-least-once 誠實寫進 doc 與對外說明 | P1 | ✅ |
| W9 | API 金鑰洩漏後無法止血 | 立即撤銷 + `last_used_at` 顯示 + scope 最小化 | P1 | ✅ |
| W10 | 通知死路徑修好後突然大量補送歷史事件 | outbox 只收修好之後產生的事件,不回溯 | P1 | ✅ |
| **W11** | 🔴 **SSRF 擋下了卻說不出理由** | 瀏覽器實走發現:`SsrfBlockedError` 繼承 `Error` 而非 `DomainError` → 落到 500「internal error」。改繼承並映射 422 `TARGET_NOT_ALLOWED` | P1 | ✅ |
| **W12** | 無法解析的主機名 | fail-closed 拒絕 —— 解析不到就無法驗證 IP,也就無法 pin。e2e 有覆蓋此行為 | P1 | ✅ |

---

## 13. 變更紀錄

| 日期 | 版本 | 變更 | 作者 |
|---|---|---|---|
| 2026-07-30 | **v1.0** | **SHIPPED**。OQ-WH-1..10 全採建議。M1 事件匯流排(`event_outbox` 同 tx + 扇出 cron)· M2 SSRF 安全鏈 · M3 Webhook 簽章與投遞 · M4 API 金鑰 · M5 前端 · M6 收尾。**🔴 實測改變了選型**:研究建議用 undici pin DNS,實測有效但 undici 8 型別與 Node 內建 undici-types 衝突;回頭實測 `node:https` 的 Agent `lookup` **一樣有效,且零新依賴、預設不跟隨 3xx** → 最終未加任何依賴。**🔴 反向驗證「沒轉紅」挖出真 bug**:拔掉 IPv4-mapped 正規化後測試仍全綠 —— 那些測試是靠 `split(":")[0]` 得空字串→NaN 的**意外分支**通過的,與正規化無關;連帶暴露「任何以 `::` 開頭的 IPv6 都被誤擋」。改寫成完整 hextet 展開並補「公網 mapped 位址必須**放行**」的正面測試,現在拔掉會有 5 條轉紅。**🔴 瀏覽器實走抓到 W11**:SSRF 擋住了但錯誤落到 500「internal error」,使用者不知踩到什麼 —— 擋下來不等於做完了。另修掉自己寫壞的一處:扇出查 `created_by` 時用字串替換組表名,雖然值必為數字所以安全,但繞過參數綁定、違反動態 identifier 鐵則。W2 以 **thin-only** 達成(不送欄位值 → 洩漏面為零),fat 模式與載荷 ACL 兩條硬規則列後續。殘留 W7 投遞紀錄歸檔。api 676 綠 · web 87 · e2e 4 | Claude Code |
| 2026-07-30 | v0.1 | M0 DRAFT。**盤查推翻兩個既有文件記載**:(a) AGENTS.md / docs/20 把 BullMQ + DBOS 當既定選型,**實際兩者皆未安裝**,真正在跑的是 `notification_delivery` + cron 抽取的 outbox(已在 prod 驗證)→ webhook 應復用而非引進新依賴,且研究指出 BullMQ 的 group 併發是 **Pro 商業功能**,OSS-only 下引進也換不到順序保證。(b) **`record.created` / `record.updated` 是死路徑** —— 事件碼有宣告、單元測試有覆蓋過濾邏輯,但全專案只有 2 個 `this.notify.*` 呼叫點且都在 approval,`RecordService` 從未注入;通知設定頁**預設檔位**承諾的行為從未發生過。`NotificationsModule` 已 `@Global()` 且註解明文列 form-engine 為預期消費者 —— 線早就拉好只是沒接。**§0.3 研究最高價值**:Node 原生 fetch = undici,**undici 連線時重新解析 DNS** → 「先驗 IP 再 fetch」有 TOCTOU 空窗,Budibase CVE-2026-54353 / MCP-Atlassian CVE-2026-27826 皆栽在此;GitLab CVE-2025-6454 另證 **header 值也是注入面**;n8n 有完整防護但**預設關閉**(反面教材)。**§0.6 本機 Node v24.14.0 實測**:`connect.lookup` 確被呼叫且為**唯一**解析路徑(不帶則走系統 DNS),`redirect:"error"` 確實擲出 `unexpected redirect` → pin 修法在本專案版本上成立,空窗結構上不存在。**§0.4 誠實缺口**:欄位級權限 × webhook 載荷**無任何廠商明載**,§4.4 兩條硬規則為自行推導。OQ-WH-1..10 待裁定 | Claude Code |
