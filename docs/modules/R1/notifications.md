# [H-1] 通知系統(訂閱 / 提醒 / 通道)

> ✅ **狀態:APPROVED v0.4 — OQ-NT-1..14 已裁定;**§0.4 四路研究推翻其中四項,已就地改寫**(2026-07-28)**
> **裁定摘要**|1=A Ragic 訂閱制 · 2=A 「跟我相關」P0 只認 createdBy · 3=A service 層顯式 emit · 4=A 通知表兼作佇列(不引 Redis)· 5=A P0 只做站內 + Email · 6=A 提醒不進 P0(待 cron 地基)· 7=A 平台級 SMTP · 8=A 不做摘要合併 · 9=A 通知不含欄位值 · 10=A 租戶自帶通道憑證 · 11=A 綁定鍵含 tenant_id · 12=A inbound 納入抽象但不實作。
> **UI 四項裁定(2026-07-28 mockup review)**|① LINE 欄 P0 **不顯示**(P0 既無 driver 也無連接設定頁 → 該列無法由任何操作變成「已連接」,是死控件;與同稿「不做假開關」一致)· ② 「查看全部通知」P0 **只做面板 + 最近 50 則**,獨立頁後續 · ③ 通知設定放**個人設定**底下 · ④ 簽核逾期**豁免總開關仍送**(流程阻塞風險高於使用者意願;設定頁須明白告知此例外)。
> **權威 UI 稿**|[`docs/mockups/notification-flow.html`](../../mockups/notification-flow.html)
> **上游**|docs/04 §H(通知系統 2 + 通道 LINE 2 / Slack 1 / Teams 1 / Telegram 1 / WhatsApp 2 / Discord 0.5 + 路由引擎 3 + 通道連接設定 UI 1)· docs/25 §H(全列 ⬜)· docs/24 §6(S10 通知)
> **緣由**|docs/25 v1.5 覆蓋率彙總指出 H 段僅 12%,且**簽核流程已 SHIPPED 卻無任何機制告知下一關簽核人** —— 一個做完的功能因缺另一個功能而實際不可用,為當前最大功能斷裂。

---

## 0. 證據(clean-room:只讀公開文件,不碰源碼)

### 0.1 Ragic 的通知模型(本機參照庫 `ragic-doc-zh-TW`)

**`doc-user/12` 通知設定** —— 三層結構,**全部由終端使用者自己設定**:

| 層 | 內容 |
|---|---|
| ① 使用者通知狀態 | 全域開關。「取消通知」→ 狀態變**停止**,不收任何通知,且**下面兩層鎖住不可調** |
| ② 頁籤個別設定 | 逐表單四個開關:**跟我相關的資料修改時通知我(預設開)** · 有任何新資料通知我 · 任何資料修改時通知我 · **有人回應跟我相關的資料時通知我(預設開)** |
| ③ 總體通知設定 | **事件類型 × 通道**的勾選矩陣(E-mail / 手機 app 推播 / 網頁通知(鈴鐺)/ LINE) |

**「跟我相關」的官方定義**|我**新增**的資料 + 被**指派**給我的資料 + 我**回應**過的資料。

**共通篩選資料通知**(saved filter 訂閱)—— 對存檔篩選按右鍵→「通知我」,兩種觸發:
1. 有符合篩選的資料新增(新一筆 / 從不符合→符合的編輯儲存)
2. 本來符合後來不符合(從符合→不符合)

> **關鍵設計證據**|Ragic 明載「透過**大量修改**或**匯入**的資料**即使符合條件也不會寄送通知**」。這是刻意的**通知風暴防護**,不是遺漏。

**`doc/5` 提醒(Reminder)** —— 設計者端、**宣告式**、日期驅動:
- 前提:表單有**日期欄位**
- 設定:對指定日期欄位,**幾天前或後**提醒
- **收件人來自欄位值** —— 選擇使用者欄位 / 選擇群組欄位 / **E-mail 欄位**(非靜態名單)
- 每天依**排程設定**的時間掃全表每一筆
- **預設合併**:同表單同天同收件人的提醒合併成一封信件串,主旨「您有 N 個來自 X 的提醒訊息」;可勾「不要合併」改為分開寄送並顯示自訂主旨
- 可疊加「只通知符合**共通篩選**的資料」
- 可自訂信件範本(參數;**參數無法套用於單一子表格欄位**,只能帶整個子表格)
- 提醒會自動加進首頁**行事曆項目**

**`doc/96` 排程管理**|集中設定各功能執行時間(提醒 / **重寄逾期簽核通知信** / 資料封存 / 表單填寫提醒 / 定期匯入 / SQL 同步 / Daily Workflow / 定期寄出報表);同一功能可多組排程;提供「馬上執行」。

**`doc/94` 寄出自訂 E-mail**|動作按鈕型,可**儲存資料後自動寄出**;寄件者名稱可選「執行按鈕的使用者」或「公司設定的寄件者」;有歷史紀錄。另有 `doc-user/5.4` **信件紀錄**。

### 0.2 競品對照(分歧點很大,值得注意)

| | 通知的本質 | 誰能設 | 提醒怎麼做 |
|---|---|---|---|
| **Ragic** | **訂閱**(每個使用者自己訂)+ **表單設定**(設計者宣告) | **每個終端使用者** | 表單設定 → 提醒(宣告式:日期欄 + N 天 + 收件人欄) |
| **Airtable** | **自動化的輸出**(automation 的一個 action) | **僅 Owners/Creators**;Editors 只能看設定 | 建一條 automation:trigger「When a record matches conditions」+ action「Send an email / Send a notification」 |
| **Teable** | 多為**系統事件**(匯入完成 / 被加進協作者欄)+ 通知中心;button 欄可送自訂通知 | 管理者 | changelog 未見宣告式提醒 |

> **這是本模組最重要的一條證據。** Airtable 把通知做成 power-user 的自動化產物 —— 一般 Editor 連設定都改不了。Ragic 把它做成**人人可訂閱**。Weyver 客戶是 **Ragic 範式思考者**(docs/24),且本專案已有明文命門「**綁定必須自助化**」([[feedback-calc-binding-self-service]])。**採 Ragic 模型,不採 Airtable 模型。**

### 0.3 一個會改變 scope 的相依(對 Weyver 現況實查)

Ragic 的「跟我相關」三要素,Weyver 只有一項成立:

| 要素 | Weyver 現況 | 查核 |
|---|---|---|
| 我**新增**的資料 | ✅ 有 | `createdBy` 系統欄已 SHIPPED(R1·UP-4) |
| 被**指派**給我的資料 | ❌ **不可用** | `member` 欄型在 registry 有登記(bigint),但 **`field-input.tsx` 無渲染** → 使用者無法在填單時指派任何人。field-types-parity 已標此為 P1 殘留 |
| 我**回應**過的資料 | ❌ **不存在** | 全庫無註解 / 回應功能。唯一的 `comment` 是簽核意見(`approval_step_logs`),語意不同 |

**意涵**|直接照抄 Ragic 的「跟我相關」語意,會發現三分之二的定義**沒有資料來源**。這不是實作細節,是 scope 決策 → 見 **OQ-NT-2**。

### 0.4 站在巨人的肩膀上(v0.4 補;**本節推翻了 v0.3 的四個決定**)

> v0.1–v0.3 幾乎只站在 Ragic 一個肩膀上(本機文件 7 頁),Airtable 只讀 1 頁、Teable 只 grep changelog。
> 本節補四路研究:訂閱層級模型 / OSS 通知基礎設施 / 內容洩漏事故 / 送達率硬要求。

#### 0.4.1 ⚠️ 訂閱模型:**幾乎所有大型協作系統都用「單一有序 enum」,不是獨立布林開關**

| 系統 | 模型 | 證據 |
|---|---|---|
| **GitHub** | `Participating and @mentions`(預設)/ `All Activity` / `Ignore` / `Custom` | 官方文件 |
| **GitLab** | Global / Watch / Participate / On mention / Disabled / Custom;**Custom = Participate 之上「加選」**(非自由組合) | 官方文件 |
| **Discourse** | Watching / Tracking / Watching First Post / Normal / Muted 五級 | 官方 |
| **Zulip** | topic 層序數 enum(None/Muted/Unmuted/Followed);**8.0 由二元 mute 演進成四檔** | 官方 API 文件 |
| **Notion**(型態最接近 Weyver) | database page:All updates / Important updates / Replies and @mentions | 官方 help |
| Slack / Teams / Linear | 同為單選層級 + 自動訂閱 | 官方 |
| **Ragic** | **4 個獨立布林開關** | 官方文件 |

**三個關鍵發現**:

1. **「與我相關」在成熟系統裡是自動訂閱的**地板**,不是可關的並列開關。** GitHub 明載取消 watch 後「仍會收到你參與的對話」,只有 `Ignore` 全靜音;Zulip 8.0 以 auto-follow 規則(你開的 topic、被提及)自動升級。→ **v0.3 把它做成第一個 checkbox 是錯的維度。**
2. **有序才可繼承。** enum 可比較、可用 sentinel 表達「繼承上層」(GitLab `Global`);GitLab 官方例明載**最具體者勝**(全域 Watch + 子群組 Participate → 取 Participate)。一組獨立布林沒有自然的繼承定義。
3. **方向性是單向的。** Zulip 二元 → 四檔 enum;GitHub enum → enum + 受控 Custom。**查不到任何大型系統從 enum 退回純獨立開關。**

**Ragic 4 開關 = 16 種組合**,其中「勾新增、不勾與我相關」= 別人建的會通知、自己建的不通知 —— 沒人想要卻可表達。
**Discourse 的反證也要記下**:enum 好懂,但 category × tag × topic 三維 precedence 官方未文件化,meta 上長年爭論 —— **維度一多照樣失控**,所以繼承規則必須寫進文件。

#### 0.4.2 ⚠️ **通知與寄送必須分兩張表** —— v0.3 的「通知表兼佇列」是已知反模式

Discourse / GitLab / Novu **三家都把 notification 與 delivery 分開**,理由是結構性的:

| | `notifications`(使用者可見) | `deliveries`(寄送) |
|---|---|---|
| 生命週期 | 留數月 | 數天 |
| 寫入模式 | 寫一次 | **反覆 UPDATE → 產生 dead tuple** |
| 扇出 | 1 則 | **N 個通道各一列** |
| 保留策略 | 上限式(Discourse:`rank() OVER (PARTITION BY user_id)` 只留每人最新 N 筆)| 短期清理 |

- **Discourse 未讀計數**用部分索引:`(user_id, notification_type) WHERE NOT read` —— 直接可抄。
- **GitLab** 明確**拒絕 STI 與 polymorphic association**,改「每資源型別一張 link table」以保外鍵完整性。
- **Mattermost 反例**:高頻訊息流改用 read-state 指標(`LastViewedAt` + 計數器)不存每則一列。判準:**高頻訊息流用指標,低頻可操作事件用每則一列** —— ERP 場景屬後者,故仍每則一列。

**「PostgreSQL 當佇列」本身是對的**(`SELECT … FOR UPDATE SKIP LOCKED`,pg-boss / graphile-worker / pgmq 皆建於此);**錯的是把兩者塞同一張表**。
**量級判準(PlanetScale 於 PG18 實測,非理論)**:800 jobs/s + 併發長查詢 → 15 分鐘內 155,000 積壓、383,000 dead tuples 死亡螺旋;**pilot 規模 < 50 msg/s 遠低於危險區**。升級訊號:`n_dead_tup` 持續 > `n_live_tup`、表實體大小 / live 資料 > 5x、sustained > 100–200 msg/s。升級順序:拆表 → 分區 `DROP`(不要 `DELETE`)→ pg-boss → 最後才 Redis。

#### 0.4.3 內容洩漏:**決定成立,但理由要換,且揪出一個 P0 漏洞**

**真實事故(官方來源)**|CVE-2019-11544(GitLab:非成員訂閱 internal project 後收到受限事件通知信)· CVE-2021-39119(Jira:watcher 帳號被撤銷後仍持續收到更新)· CONFSERVER-52560(Confluence workbox 通知內含留言內容,送給無權檢視者)· CVE-2021-41312(Jira webhook 送出不在 JQL 範圍內的變更)。
→ 「訂閱者集合」與「有權檢視集合」會漂移,這是**重複發生的一整類 bug**,不是單一疏失。

**⚠️ 業界主流解法對 Weyver 無效** —— Jira 的做法是**過濾收件人**(需具 Browse Projects + 該 security level),**不是過濾內容**;GitLab 選擇帶內容,而「精簡通知」是 **2016 年提出、至今仍 open 的 feature request**。
**原因**:Jira/GitLab **沒有欄位級權限**,過濾收件人就夠了。**Weyver 有** —— 同一收件人可能「可看記錄但不可看金額欄」,收件人過濾在此模型下**根本不足**。
→ **OQ-NT-9 的理由應從「Email 會被轉寄」改為「欄位級權限使業界主流的收件人過濾失效」**,這才是真正的論據。

**🔴 新揪出的 P0 漏洞(已對程式碼驗證)**|我原本說「只帶記錄標題」是安全的 —— **不成立**。`record-list.tsx:11` 的 `titleOf()` 取 **`fields[0]`,即使用者自建表單的第一個欄位**。客戶若把「金額」「身分證字號」放第一欄,通知標題就是洩漏。→ 見 FMEA N14。

#### 0.4.4 ⚠️ digest 與**去抖動是兩件事** —— v0.3 把它們混為一談

| | v0.3 決定 | 研究結論 |
|---|---|---|
| **跨記錄摘要(digest)** | 不做 | ✅ **成立**,P0 可不做 |
| **同記錄去抖動(coalescing)** | 未區分,等於不做 | ❌ **必須做** —— 一筆記錄連續編輯 10 次 = 10 封信 |

**Jira Cloud 官方**:預設批次為 **per(收件人 + issue),3 分鐘 idle window / 10 分鐘 max window**,每次新變更重置 idle;**但「被 @mention、被指派」等關鍵更新一律 bypass 立即送**。
→ **我的「事件型通知該即時獨立」訴求,靠「例外清單」保住即可,不必靠「全部不合併」。** 簽核走 bypass,一般欄位變更走去抖動視窗。

**GitHub 的低成本招數**:不做伺服器端合併,改用 `Message-Id` / `References` / `In-Reply-To` 讓同一 issue 的通知在**郵件客戶端**收攏成一條 thread —— 幾乎零成本就能拿到 Ragic「同收件人同日串成一封」的視覺效果。
**Slack**:使用者不活躍時 email 每 15 分鐘或每小時 bundle。**Discourse**:寄信延遲視窗的目的之一是**讓作者有機會先編輯**,避免寄出已被修正的內容。

#### 0.4.5 ⚠️ Email 送達率:**「我們量小」是錯的推理**

- **bulk sender 門檻**|同一 primary domain 24 小時內接近 **5,000 封至個人 Gmail**;**子網域併入母網域計算**,且**bulk 身分一旦取得永不失效**。單一平台網域 × 17 家租戶 × 每人多封簽核通知 —— 跨過只是時間問題,跨過就回不去。**→ 直接照 bulk 規格建,不要照現況量級建。**
- **交易信只豁免退訂,不豁免認證**|SPF / DKIM / DMARC / PTR / TLS / 垃圾率**一體適用**。Google 2025-11 起加重執法(550-5.7.26 未認證 / 421-4.7.26 限流);**Microsoft 消費者信箱 2025-05-05 起直接拒收**(`550 5.7.515`)。
- **垃圾投訴率**|Google **每日**計算,目標 <0.1%,**≥0.3% 即喪失 mitigation 資格,須連續 7 天 <0.3% 才恢復**。
- **🔴 自架 SMTP 在雲主機上基本不可行**|AWS/GCP/Azure/DO 的 IP 段預設落在 Spamhaus PBL 或被主要收件方封鎖,多數雲商**預設封鎖對外 port 25**;新 IP 需 2–4 週 warm-up,而**幾百封/日的低量根本養不熱一個專用 IP**。
  → **應用層自建(outbox + Nodemailer),對外走 relay 的共用 IP pool**;或自架 **Postal(MIT)** 當內部 MTA + smarthost 轉 relay ——「程式資產仍 OSS,只買 IP 信譽」。成本量級:SES 約 US$0.10/千封 → 月成本個位數美元,對 ACV NT$400K 可忽略(採購時須複核)。
- **suppression list 是 P0 不是 P1**|5xx 硬退**立即永久 suppress**;4xx 退避重試,連續失敗(3–5 次 / 72hr)升硬退;**投訴 = 零重試立即永久 suppress**。收 bounce 需 **VERP**(envelope from 內嵌 token)+ RFC 3464 DSN 解析,且 Return-Path 用**與 From 不同的專屬 bounce 子網域**。
- **FBL 現實**|Gmail **沒有**逐封 ARF 回報,只有 Postmaster Tools 聚合式,需自加 `Feedback-ID` 標頭且該標頭須被自有網域 DKIM 簽章;Yahoo 才有真正 CFL 且須逐 DKIM 網域註冊。→ **不能倚賴 FBL 當唯一投訴訊號**,須自建 in-app 回饋。
- **台灣**|HiNet / hiBox 實務上封鎖動態 IP 來源(典型退信 `550 Your access IP … has been rejected`),申訴白名單走 0800-080365;中華電信「郵件守門員」分級過濾使同一封信在不同租戶端結果不同。**「濫發商業電子郵件管理條例」查無完成三讀之證據,至今仍為草案**;交易型通知本非商業電子郵件。客戶多為中小製造/食品廠、自架 mail server 比例高且無 FBL → **簽核流程的可用性不得押在 email 上,必須有 in-app 備援**。

#### 0.4.6 🔴 兩個 Weyver 專屬地雷(最容易實作到一半才炸)

1. **`LISTEN/NOTIFY` 在 PgBouncer transaction mode 下不可用** —— 而 AGENTS.md P0 鐵則正是要求 PgBouncer tx mode。→ 只能**輪詢**,或給 worker 獨立直連。
2. **RLS FORCE 會擋住 worker 的跨租戶掃描**,而 app 角色**禁 `BYPASSRLS`**。→ 必須在 M1 就決定:按租戶迭代 + 每 tx `SET LOCAL app.tenant_id`,或把 delivery queue 設為 Tier-1 系統表配專用角色。**沿用 F-8 `UsageService` 的既有解**(特權車道 + advisory lock)即可。

---

## 1. 目標與範圍

### 1.1 目標(P0)

1. **接通簽核** —— 簽核送出 / 待簽 / 核准 / 駁回 / 逾期,通知到人。這是本模組的**存在理由**。
2. **站內通知中心**(鈴鐺)—— 未讀計數 + 列表 + 點擊跳到該筆記錄。
3. **Email 通道** —— 可實際送達,含寄件紀錄。
4. **每使用者訂閱設定** —— 承 Ragic 三層結構(全域開關 / 逐表單 / 事件×通道矩陣)。
5. **通知風暴防護** —— 承 Ragic:**批次匯入 / 大量修改不觸發通知**。

### 1.2 不做的事(附理由)

- ❌ **手機 app 推播** —— Weyver 無行動 App(docs/04 標暫緩),無載體。
- ❌ **Slack / Teams / Telegram / WhatsApp / Discord / WeCom** —— 見 OQ-NT-5;先做 Email + 站內,通道擴充為加法。
- ❌ **簡訊 / 發送大量 E-mail / 行銷群發** —— Ragic 有(`doc-user/5.1`/`5.5`),但那是**外寄行銷**不是**系統通知**,語意不同且涉及退訂合規。
- ❌ **提醒進行事曆項目** —— Weyver 無行事曆視圖(docs/25 F 段 ⬜)。
- ❌ **@提及** —— 依賴註解功能,見 OQ-NT-2。

---

## 2. 上游 / 既有現況走查

| 既有 | 狀態 | 對本模組的意義 |
|---|---|---|
| 簽核流程(`approval_*` 三表) | ✅ R1·後續-1 SHIPPED | **通知的第一個消費者**;`approval_instances` 已知「當前關卡是誰」 |
| 自訂按鈕 + `action_audits` | ✅ SHIPPED | 動作完成事件可作為通知來源 |
| 檢視系統 `view_defs`(filter + sorts) | ✅ R1·UP-2 SHIPPED | **共通篩選訂閱可直接復用**,不必新建篩選模型 |
| 系統欄 `createdBy` / `updatedBy` | ✅ SHIPPED | 「我新增的」有來源 |
| `users` / `role_members` | ✅ F-2 / P0-4a | 收件人解析基礎;**`users.email` 已有** |
| BullMQ / DBOS | ❌ **未裝** | 背景送信需要佇列 → 見 OQ-NT-4 |
| 排程(cron per tenant) | ❌ 未起(docs/25 C 段 ⬜) | **提醒需要每日排程** → 見 OQ-NT-6 |
| SMTP 設定 | ❌ 無 | 需租戶級或平台級寄件設定 → OQ-NT-7 |
| `member` 欄型前端 | ❌ P1 殘留 | 「指派給我」無來源 → OQ-NT-2 |
| 註解 / 回應 | ❌ 不存在 | 「我回應過」無來源 → OQ-NT-2 |

---

## 3. scope 切分(初擬,待 OQ 裁定後定案)

| 里程碑 | 內容 | 估算 |
|---|---|---|
| **M1 通知核心** | `notification` + `notification_pref` 表(RLS)· 事件匯流排(app 內 emitter)· 收件人解析 · **風暴防護(批次來源不觸發)** · 簽核事件接入 | 0.10 mo |
| **M2 站內通知中心** | 鈴鐺 + 未讀計數 + 列表 + 已讀 / 全部已讀 + 點擊跳轉 | 0.06 mo |
| **M3 Email 通道** | 通道抽象 + SMTP 驅動 + 範本 + 寄件紀錄 + 重試 / 死信 | 0.08 mo |
| **M4 訂閱設定 UI** | 三層設定面(全域開關 / 逐表單四開關 / 事件×通道矩陣) | 0.06 mo |
| **M5 收尾** | spec + FMEA + doc v1.0 + MODULES + **docs/25 §H 回填** | 0.03 mo |

**合計 ≈ 0.33 mo**。對照 docs/04 H 段「通知系統(站內 + Email)2 人月」+ 路由引擎之一部分。**提醒(Reminder)與其餘通道不在此批**,見 OQ。前後端分開 commit。

---

## 4. 外部通知通道設計(v0.2 補;原 v0.1 只有「通道抽象」一行,不足以做決策)

### 4.1 真正的難點不是送信,是**身分綁定**

Email 之所以「免費」,是因為 `users.email` 在 F-2 就存在了 —— 收件人身分**現成**。所有其他通道都沒有這個便利:

| 通道 | 收件人身分從哪來 | 需要的前置 |
|---|---|---|
| 站內鈴鐺 | `users.id`(現成) | 無 |
| **Email** | `users.email`(**現成**) | SMTP 設定 |
| **LINE** | LINE `userId` —— **不存在,必須跑一次綁定流程取得** | 官方帳號 + Messaging API + **inbound webhook** + 綁定 UX |
| Slack / Teams / Discord | webhook URL(頻道級)或 member ID(個人級) | 租戶安裝 app / 建 webhook |
| Telegram | chat ID —— 使用者需先對 bot 說話 | bot token + 綁定 |
| WhatsApp | 電話號碼 + **範本預先審核** | WABA 帳號申請(Meta 審核) |

> **這是 v0.1 判斷失準之處。** 原 OQ-NT-5 寫「通道抽象一旦立好,加 LINE 是獨立小批(docs/04 標 2 人月)」。研究後判斷**不成立** —— LINE 的成本不在「送出訊息」那段 API 呼叫,而在綁定流程 + inbound webhook + 憑證管理,而這三者**都會反過來約束抽象的形狀**。

### 4.2 Ragic 的 LINE 綁定流程(`doc-user/78`,clean-room)

**雲端版**(Ragic 自己的官方帳號,**專業版以上**才開放):
1. 個人設定 → LINE 通知設定 → 點連結**加入 Ragic 官方帳號好友**
2. 在 LINE 對話中傳送 `/validate|{Ragic 登入信箱}`
3. 系統寄**驗證信**到該信箱
4. 點信中連結 → 綁定 LINE userId ↔ 資料庫帳號
5. **15 分鐘內未完成則連結失效**;**相同 LINE userId 短時間不可重複申請**
6. 回總體通知設定勾選要收哪些 LINE 通知

> 步驟 2–3 的設計值得注意:**驗證繞了 Email 一圈**。理由推測是防冒用 —— 光憑「在 LINE 裡打某人的信箱」不足以證明你是那個信箱的主人,必須回到已驗證的通道確認。**Weyver 若做 LINE,這個往返不能省。**

**私有主機版**(租戶自己的官方帳號):
1. 申請 LINE **商用**官方帳號(電子郵件註冊)→ 啟用 Messaging API
2. 建立 / 綁定 **Provider**
3. 取得 **Channel ID / Channel Secret / Channel Access Token**、設定 **Webhook**、**關閉自動回覆**(預設會一律自動回覆)

**收費**|Ragic 雲端版每則通知 NT$0.2(從簡訊點數扣);私有主機版走租戶自己的官方帳號額度(LINE OA 每月有免費額度,超過付費)。

### 4.3 部署模式:Weyver 只能走「租戶自帶憑證」

| | Ragic 雲端模式 | **Weyver 可行模式** |
|---|---|---|
| 官方帳號 | 平台的 | **租戶自己的** |
| 計費 | 平台代收(NT$0.2/則) | **租戶自付**(自己的 OA 額度) |
| 前提 | 需要計費系統 | 無需計費 |

**理由**|(a) 訂閱計費在 docs/04 明列為 **Phase 2**,平台代收模式沒有收費載體;(b) OSS-only + 私有主機(on-prem Edge)本來就是本專案的部署形態(docs/11 §16);(c) 租戶自付把成本與用量對齊,不必設計轉嫁機制。

**這正是 docs/04 v2.6 已編列的「通知通道連接設定 UI(1 人月)」** —— 租戶自接 LINE channel token / webhook / SMTP 網域驗證 + 測試發送。本模組確認該項為 **LINE 的硬前提**,不是可選的便利功能。

### 4.4 一個容易踩的多租戶陷阱:userId 是 **Provider 作用域**

LINE 文件(經 Ragic KB 300 轉述)明載:UID 經 Provider 加密,**只有該 Provider 底下的人才能正確解密辨識** —— 換言之**同一個 LINE 使用者,在不同 Provider 下的 userId 不同**。

**設計後果**|租戶各自帶官方帳號 ⇒ 各自是不同 Provider ⇒ **綁定必須以 `(tenant_id, user_id, channel)` 為鍵,不能是 `(user_id, channel)`**。若錯誤地做成全域綁定,同一人在 A、B 兩租戶會互相覆蓋,通知送錯租戶 —— 這是跨租戶洩漏。

### 4.6 ⚠️ 個人 1:1 與群組是**兩種不同的功能**,不是同一功能的兩種位址(v0.3 補)

**v0.2 的缺漏**|§4.1 的通道表把 LINE 收件人一律寫成「LINE `userId`」,只設計了個人綁定。
但 **docs/04 §H 早已明載「Messaging API;個人 1:1 + 群組」**,且其 ERP 必要性欄註明
「**台灣 SMB 日常 LINE 群組通知**」—— 群組才是台灣中小企業的主要使用形態,而 v0.2 完全沒有涵蓋。

| | **個人 1:1** | **群組** |
|---|---|---|
| 收件人是誰 | 一個**已驗證身分**的 Weyver 使用者 | 一個 LINE 群組 = **不特定多數人**,可能含非 Weyver 使用者、離職員工、外部廠商 |
| 誰決定要不要收 | **使用者自己**(§0.1 三層訂閱設定) | **沒有訂閱者** —— 由管理者在表單 / 租戶層設定廣播 |
| 適用誰的權限 | 收件人的 —— 點進去時做權限檢查 | **無人的權限適用**。群組成員可能對該表單毫無存取權 |
| 「跟我相關」語意 | 成立 | **無意義**(群組不是「我」) |
| 身分怎麼來 | 使用者本人驗證(加好友 → `/validate|信箱` → 寄驗證信 → 15 分鐘內點連結) | 管理者邀 bot 進群 → webhook `join` 事件取得 `groupId` → 於設定頁從清單選定 |
| 怎麼退訂 | 使用者自己關掉 | 只能管理者移除設定,或把 bot 踢出群組 |
| 審計語意 | 「通知已送達某使用者」 | 「事件已廣播至某群組」—— **無法宣稱任何個人已知悉** |

**三個設計後果**:

1. **群組不屬於「通知訂閱」,屬於「事件廣播」。** 它的設定入口不在個人設定,而在**表單設定 / 租戶通道設定**(管理者權限)。硬把它塞進三層訂閱矩陣會產生語意錯亂 —— 使用者無法「替群組訂閱」。docs/04 另列的**通知路由引擎(3 人月)** 才是它的歸屬。
2. **OQ-NT-9(通知不含欄位值)由「偏好」升級為「不可協商」。** 個人通知至少收件人身分明確、點進去還有權限把關;群組廣播**沒有任何權限模型可依靠** —— 一旦帶欄位值,等於把資料推送給一群系統從未驗證過的人。
3. **§4.5 第 1 條的抽象必須改**(見下)。`Notification` 若只記 `recipient_user_id`,群組通知**根本無法表示** —— 它沒有收件使用者。這正是「Email-shaped 抽象鎖死後續通道」的具體案例,**必須在 M1 就改對,M3 才改要動資料**。

> **證據強度**|個人綁定流程為 Ragic 官方文件明載(§4.2)。群組之 `groupId` 取得途徑、群組訊息計費方式、成員 UID 可否列舉(疑似限認證帳號)為 **LINE 平台一般行為之推斷,實作前須以官方文件覆核**。此處只用到「groupId 來自 webhook 事件」與「群組廣播對象不特定」兩項結構性事實,兩者不因細節而改變。
> Ragic KB 301 另佐證身分之困難:UID「**無法自動比對出對應的真實姓名**」—— 位址與身分是兩件事,這正是綁定必須繞回已驗證通道的理由。

### 4.5 對抽象的設計約束(**必須在 M3 就滿足,否則會被 Email 的形狀鎖死**)

即使 P0 只出 Email,通道抽象也必須預留以下五點,否則加 LINE 時要拆掉重做:

1. **收件人為多型,不是單一 user id**(v0.3 依 §4.6 修正)|`Notification` 的收件人須能表示兩種形態:
   `{kind:"user", userId}`(個人訂閱)與 `{kind:"channelTarget", channel, externalId}`(群組 / 頻道廣播)。
   **v0.2 原寫「記錄 `recipient_user_id`」是錯的** —— 群組通知沒有收件使用者,該模型無法表示。
   各 driver 負責把 user 解析成自身位址(email / LINE userId);無綁定 → 該通道 **skip 而非 fail**。
2. **綁定為獨立概念**|預留 `user_channel_binding(tenant_id, user_id, channel, external_id, verified_at)`;Email 可視為「出廠即綁定」(來源 `users.email`),不必特例。
3. **憑證屬於租戶不屬於平台**|driver 取設定時吃 `tenant_id`;平台級 SMTP 只是「租戶未設定時的 fallback」,不是唯一路徑。
4. **訊息內容分層**|存 `title` + `body` + `link` 的結構化欄位,**不要存已渲染的 HTML**;各通道渲染格式差異極大(Email HTML / LINE 純文字或 Flex / Slack Block Kit)。
5. **inbound 是一等公民**|LINE / Telegram 綁定都需要 **inbound webhook**(接使用者傳來的驗證訊息)+ **簽章驗證**(LINE 用 `X-Line-Signature` + Channel Secret)。Email 是純 outbound,若抽象只設想 outbound,inbound 會變成外掛。**on-prem 部署另需確認該端點對外可達** —— 防火牆後的安裝可能根本收不到 webhook,這會讓 LINE 在部分客戶無法使用。

---

## 10. 開放問題(OQ-NT-N)— ✅ 已裁定 2026-07-28(全採建議)

| # | 議題 | 選項 | 建議 |
|---|---|---|---|
| **OQ-NT-1** ⭐ | 通知的本質:訂閱制 vs 自動化產物 | A. **Ragic 訂閱制**(人人可訂,設定在使用者身上)<br>B. Airtable 式(通知是 automation 的 action,只有 Creator 能設) | **A** — 客戶是 Ragic 範式思考者(docs/24);且 Airtable 明載 Editors **只能檢視** automation 設定,等於一般使用者無法自訂收不收通知,與本專案「自助化」命門相衝 |
| **OQ-NT-2** ⭐⭐ | 「跟我相關」在缺 member 欄與註解下怎麼定義 | A. **P0 先只認 `createdBy`**(我新增的),member / 註解到位後**加法擴充**<br>B. P0 順帶補完 member 欄前端(+0.05)<br>C. P0 連註解功能一起做(+0.15) | **A** — 「跟我相關」是**一個布林述詞**,新增來源是純加法、無 migration。C 會把通知模組膨脹成兩個模組(註解本身要 @提及 / 權限 / 通知,是獨立 M0 題目)。**誠實代價**:P0 的「跟我相關」比 Ragic 窄,只涵蓋三分之一定義 → §12 明列,且**設定 UI 上要寫清楚**,不能讓使用者以為指派會通知 |
| **OQ-NT-3** | 事件從哪裡發出 | A. **service 層顯式 emit**<br>B. DB trigger / CDC<br>C. repository 層攔截所有寫入 | **A** — B/C 看似「不漏」,實則**分不出批次與單筆**,而 Ragic 明載批次不通知;顯式 emit 讓「這個路徑要不要通知」成為程式碼裡看得見的決定。代價:新寫入路徑可能漏 emit → 以測試斷言涵蓋 |
| **OQ-NT-4** ⭐ | 送信是否進佇列 / 通知與寄送同表否 | A. ~~通知表兼作佇列~~<br>**A′(v0.4 改寫)**|**PostgreSQL-only 但拆兩張表**:`notifications`(使用者可見、`read`、部分索引算未讀、上限式保留)+ `deliveries`(每通道一列、`status`/`attempts`/`next_attempt_at`)<br>B. 立刻引入 BullMQ + Redis | **A′** — 「PostgreSQL 當佇列」本身正確(`FOR UPDATE SKIP LOCKED`,pg-boss / graphile-worker 皆建於此),**但 v0.3 的「同一張表」是已知反模式**:Discourse / GitLab / Novu **三家都分開**,因生命週期(數月 vs 數天)、寫入模式(寫一次 vs 反覆 UPDATE 產 dead tuple)、扇出(1 則 → N 通道)、保留策略**四者皆衝突**。Redis 仍不引入(pilot < 50 msg/s 遠低於 PlanetScale 實測的 800 jobs/s 死亡螺旋區)。**升級訊號寫入 doc**:`n_dead_tup` > `n_live_tup`、表膨脹 > 5x、sustained > 100–200 msg/s → 依序 分區 `DROP` → pg-boss → Redis |
| **OQ-NT-5** ⭐ | 外部通道範圍 | A. **P0 只做站內 + Email**;LINE 為獨立後續模組<br>B. P0 併 LINE | **A(v0.2 理由已改寫)** — v0.1 曾寫「加 LINE 是獨立小批,約 +0.1 mo」,**研究後確認該估計錯誤**:LINE 的成本在綁定流程(§4.2 三步驟 + 15 分鐘時限 + Email 往返驗證)、inbound webhook + 簽章驗證、租戶憑證管理,合計遠超 0.1 mo,且 docs/04 另列「通道連接設定 UI 1 人月」為其硬前提。**但結論的理由變了**:不是「LINE 不重要」(對台灣中小企業它可能比 Email 重要),而是**它大到應該自成一個模組**。**代價明列**:P0 出貨時台灣客戶拿不到他們最習慣的通道。**條件**:§4.5 五項抽象約束必須在 M3 落實,否則後續加 LINE 要拆掉重做 |
| **OQ-NT-6** | 提醒(日期驅動)是否進 P0 | A. **不進**,待 cron 排程模組<br>B. 進 P0,自建每日 tick | **A** — 提醒需要「每天掃全表每一筆」的排程器,而 docs/25 C 段「排程任務 cron per tenant」整項未起。在沒有排程地基時自建一個一次性 tick,會變成日後排程模組要拆掉的技術債。**代價**:Ragic 客戶熟悉的「出貨日前三天提醒業務」P0 不可用 → 明列 |
| **OQ-NT-7** ⭐ | 寄件基礎設施 | A. ~~平台級自架 SMTP~~<br>**A′(v0.4 改寫)**|**應用層自建 outbox + 對外走 relay 共用 IP pool**(或自架 Postal MIT 當內部 MTA + smarthost);專屬寄件子網域 + 專屬 bounce 子網域<br>B. 租戶級 SMTP 設定 UI | **A′** — v0.3 未查證即假設可自架。**自架 SMTP 在雲主機上基本不可行**:雲 IP 段落在 Spamhaus PBL 或被封鎖、多數雲商預設封鎖 port 25、新 IP 需 2–4 週 warm-up,而**幾百封/日的低量根本養不熱專用 IP**。**與 OSS-only 不衝突**:程式資產仍全 OSS,relay 買的是 **IP 信譽**屬基礎設施(同 docs/11 §16 managed-OSS 之判準)。月成本個位數美元,對 ACV 可忽略。**P0 另含 suppression list**(見 OQ-NT-15)|
| **OQ-NT-8** ⭐ | 摘要 / 合併 | A. ~~一事件一通知,完全不合併~~<br>**A′(v0.4 改寫)**|**跨記錄 digest 不做**,但**同記錄去抖動必做**:per(收件人 + 記錄)3 分鐘 idle / 10 分鐘上限,**簽核等關鍵事件 bypass 立即送**<br>B. 全套 digest | **A′** — v0.3 把兩件事混為一談。Jira Cloud 官方即為此設計,且明列 @mention / 指派 **bypass 批次**。**不做去抖動的後果**:一筆記錄連續編輯 10 次 = 10 封信 → 使用者關掉全部通知(43% 使用者曾因通知過度而直接關閉,社群引用之調查)。我原本「事件型通知該即時獨立」的訴求**靠例外清單即可保住**,不必靠全部不合併。**另加零成本招數**:`Message-Id`/`References`/`In-Reply-To` 讓郵件客戶端自行收攏成 thread(GitHub 作法),即可得到 Ragic「同收件人同日串成一封」的視覺效果 |
| **OQ-NT-9** ⭐⭐ | 通知內容是否含記錄欄位值 | A. **只含表單名 + 事件 + 記錄識別**,點進去才看內容<br>B. 郵件內嵌欄位值 | **A(v0.4 理由改寫並強化)** — v0.3 的理由「Email 會被轉寄」不是真正的論據。**真論據**:業界主流(Jira)靠**過濾收件人**解決此問題而非過濾內容,但那是因為 **Jira/GitLab 沒有欄位級權限**;**Weyver 有** —— 同一收件人可能「可看記錄但不可看金額欄」,**收件人過濾在此模型下根本不足**。實證這是一整類重複發生的 bug:**CVE-2019-11544**(GitLab)· **CVE-2021-39119**(Jira watcher 撤銷後仍收通知)· **CONFSERVER-52560**(Confluence 通知含留言內容送給無權者)· CVE-2021-41312。GitLab 的「精簡通知」需求 **2016 年提出至今仍 open**。**⚠️ v0.4 揪出自身漏洞**:原以為「只帶記錄標題」安全,但 `titleOf()` 取 `fields[0]` = 使用者自建的任意首欄 → 見 FMEA N14 |
| **OQ-NT-10** ⭐ | 通道憑證歸屬 | A. **租戶自帶**(自己的 LINE 官方帳號 / SMTP)<br>B. 平台統一代發 + 計費轉嫁 | **A** — B 需要計費載體,而訂閱計費在 docs/04 明列 **Phase 2**;且 Ragic 雲端版正是 B 模式(每則 NT$0.2 扣點),其前提是它有付費系統。A 同時契合 OSS-only 與 on-prem 形態。**平台級 SMTP 保留為 fallback**(OQ-NT-7),但不作為唯一路徑 |
| **OQ-NT-11** | 通道綁定的鍵 | A. **`(tenant_id, user_id, channel)`**<br>B. `(user_id, channel)` 全域 | **A** — §4.4:LINE userId 是 **Provider 作用域**,租戶各自帶官方帳號則同一人在不同租戶的 userId 不同。做成 B 會讓同一人在 A、B 兩租戶互相覆蓋 → **跨租戶通知洩漏**。即使 P0 只有 Email 也採 A,避免日後改鍵要動資料 |
| **OQ-NT-12** | inbound webhook 是否納入 P0 抽象 | A. **納入抽象但不實作**(預留 driver 介面 + 綁定表)<br>B. 完全不預留,加通道時再說<br>C. P0 即實作 inbound 端點 | **A** — B 會讓 Email-only 的抽象只有 outbound 形狀,加 LINE 時整層要翻(§4.5 第 5 點);C 在沒有任何 inbound 通道時是空轉。A 的成本只是「介面留一個方法 + 建一張綁定表」。**另須明列風險**:on-prem 防火牆後的部署可能收不到 LINE webhook → 該情境下 LINE 通道不可用,非程式缺陷 |
| **OQ-NT-13** ⭐ | LINE 群組通知歸屬哪個概念 | A. **獨立於個人訂閱之「事件廣播」**,設定在表單 / 租戶層(管理者)<br>B. 併入三層訂閱矩陣,當成 LINE 的一種收件位址 | **A** — B 會產生語意錯亂:三層設定是「**我**要不要收」,而使用者無法替一個群組決定訂閱;且群組成員未必是 Weyver 使用者,「跟我相關」對群組無意義。A 亦對齊 docs/04 已編列之**通知路由引擎(3 人月)**。**代價**:兩套設定入口(個人設定 / 表單設定),需在 UI 上講清楚差別 |
| **OQ-NT-14** ⭐ | 收件人模型 | A. **多型 recipient**(`user` / `channelTarget`)自 M1 起即如此<br>B. 先只做 `recipient_user_id`,做群組時再改 | **A** — 這正是 §4.5 所警告「被 Email 形狀鎖死」的具體案例。M1 立即採多型的成本是一個欄位加一個判別欄;B 的成本是日後改資料模型 + 回填既有通知。**且 P0 不做群組不代表模型可以不支援** —— 模型錯了,做群組時整層要翻 |
| **OQ-NT-15** ⭐⭐ | 訂閱模型的形狀 | A. ~~沿用 Ragic 4 個獨立布林開關~~<br>**B(v0.4 依研究改採)**|**單一有序 enum + 受控 Custom**;「與我相關」改為**自動訂閱規則**非開關 | **B** — 查證 GitHub / GitLab / Discourse / Zulip / Notion / Slack / Teams / Linear **無一例外皆用單一 enum**,且**查不到任何大型系統從 enum 退回獨立開關**(Zulip 反而由二元 → 四檔)。三個理由:(1) **有序才可繼承** —— enum 可用 sentinel 表達「繼承上層」,GitLab 官方明載**最具體者勝**;(2) **互斥消除無意義組合** —— Ragic 4 開關 = 16 組,含「別人建的通知、自己建的不通知」這種沒人要的組合;(3) 可溝通(一個詞能進 UI / 摘要信 / 管理報表)。**「與我相關」是地板不是開關**:GitHub 明載取消 watch 後仍收到你參與的對話,只有 Ignore 全靜音。**建議六檔(嚴格包含)**:靜音 < 只有被提及 < **與我相關(預設)** < 新資料 + 與我相關 < 全部 < 自訂;Custom 採 GitLab 式「Participate 之上加選」保持有序。**資料模型**:`level smallint NULL`(NULL = 繼承上層)+ `custom_events jsonb`。**Discourse 的教訓**:多維度 precedence 未文件化 = 永久客服 → 繼承規則必須寫進文件。<br>**v0.4 落稿時的兩項在地調整**:(a) **P0 只做 5 檔非 6 檔** —— 研究建議的「只有被提及」需 @提及,而 Weyver 尚無註解功能;不做無法運作的檔位(同「不做假開關」原則);(b) **繼承沿用既有分類資源軸**:全域 → `form_categories` → 表單,最具體者勝 —— 與已 SHIPPED 的 `authz-resource-inheritance` **是同一條軸**,使用者不必學第二套心智模型,亦不必新建繼承基礎設施 |

---

## 12. 失效場景反思(FMEA)— pre-mortem 預列,M5 收尾確認

| # | 場景 | 預定緩解 | Sev |
|---|---|---|---|
| N1 | **通知風暴**:匯入 5000 筆 → 5000 封信 | 承 Ragic:批次路徑(Excel 匯入 / bulk)**不 emit**;顯式 emit 模型(OQ-NT-3)使其為預設行為而非例外 | **P0** |
| N2 | **跨租戶洩漏**:A 租戶事件通知到 B 租戶使用者 | `notification` 帶 `tenant_id` + RLS FORCE;收件人解析限 `role_members` 同租戶;**測試斷言 A 建→B 收不到** | **P0** |
| N3 | **繞過欄位級權限**:通知內容含收件人無權見的欄 | OQ-NT-9=A 只帶表單名 + 記錄標題;標題欄本身仍須過權限檢查 | **P0** |
| N4 | 寄件失敗靜默丟失 | `notification` 有狀態機(pending/sent/failed)+ 重試次數 + 死信;**寄件紀錄可查**(承 Ragic 信件紀錄) | P1 |
| N5 | 重複寄送(重試 / 多實例同時掃) | 送出前 `UPDATE … WHERE status='pending' RETURNING` 搶佔;冪等 key 承 F-6 | P1 |
| N6 | 使用者關閉全域通知後仍收到簽核通知 | 承 Ragic:全域「停止」時**下層設定鎖住且不發送**。**但簽核逾期是否該豁免?** → M4 決定並明載 | P1 |
| N7 | 離職 / 停用使用者仍收到通知 | 收件人解析時檢查 `users.deleted_at` 與 role 成員資格 | P1 |
| N8 | Email 落入垃圾信 / 網域信譽受損 | 平台級寄件網域需 SPF/DKIM(OQ-NT-7=A 之前提);**pilot 前必須實測送達率**,否則「通知做完了但沒人收到」 | P1 |
| N10 | **通道綁定錯人**:綁定驗證不嚴 → A 的通知送到 B 的 LINE | 承 Ragic:**驗證繞回已驗證的 Email 通道**(不接受「在 LINE 裡自稱某信箱」)+ **15 分鐘時效** + 同一外部 ID 短期不可重複申請。**P0 雖不出 LINE,但綁定表與驗證語意於 §4.5 先立好** | **P0**(通道上線時) |
| N11 | on-prem 防火牆後收不到 inbound webhook → LINE 綁定永遠卡住 | 部署文件明列可達性需求;連接設定 UI 提供**測試發送 / webhook 連通檢查**,讓失敗在設定當下就看得見,而非上線後才發現沒人收到 | P1 |
| N12 | **群組廣播洩漏**:通知送進 LINE 群組,群內含對該表單無權限者(外部廠商 / 離職員工) | OQ-NT-9 對群組升級為**不可協商**:只帶表單名 + 事件 + 記錄標題,連標題都須確認非敏感;群組設定限管理者;**設定頁明示「群組內所有人都會看到」** | **P0**(群組上線時) |
| N13 | 群組被解散 / bot 被踢出 → 通知靜默消失 | LINE 推送失敗須記錄並在設定頁顯示該群組為**失效**(不可只寫入 log);承 N4 之寄送狀態機 | P1 |
| N14 | 🔴 **記錄標題本身洩漏受保護欄位** —— `titleOf()` 取 `fields[0]`,而首欄是使用者自建的任意欄位(可能是金額 / 身分證號) | 通知標題**不得直接用首欄值**。三選一(M1 定):(a) 只用 `記錄 #id` + autoNumber 類系統欄;(b) 對首欄做欄位級權限檢查,無權則退回 `#id`;(c) 讓表單設計者明指「通知標題欄」並在設定時警示其內容會出現在通知中 | **P0** |
| N15 | 硬退信 / 投訴未處理 → 網域信譽崩壞 → **全體租戶的通知都進垃圾信** | **suppression list 為 P0**:5xx 立即永久 suppress、投訴零重試永久 suppress、4xx 退避重試連續失敗升硬退;寄送前必查。收 bounce 需 VERP + RFC 3464 DSN 解析 | **P0** |
| N16 | 同一筆記錄連續編輯 → 通知風暴 → 使用者關掉全部通知 | per(收件人 + 記錄)3 分鐘 idle / 10 分鐘上限去抖動;簽核類 bypass(OQ-NT-8) | P1 |
| N17 | `LISTEN/NOTIFY` 在 PgBouncer tx mode 不可用 / RLS FORCE 擋 worker 跨租戶掃描 | 改用**輪詢**(不用 LISTEN/NOTIFY);跨租戶掃描沿用 F-8 `UsageService` 既有解(特權車道 + advisory lock + 按租戶迭代)。**M1 第一件事就要確認**,否則實作到一半才炸 | P1 |
| N9 | 通知累積無上限 → 表膨脹 | 保留期政策 + 清理 job(復用 F-6 `cleanup.service`) | P2 |

---

## 13. 變更紀錄

| 日期 | 版本 | 變更 | 作者 |
|---|---|---|---|
| 2026-07-28 | **v0.4** | **決策方問「站在哪些巨人的肩膀上設計」** —— 誠實檢視後確認 v0.1–v0.3 幾乎只站在 Ragic 一個肩膀(本機 7 頁),遂補四路研究成 **§0.4**,**推翻自身四個決定**:(a) **OQ-NT-15 新增/改採 enum** —— GitHub/GitLab/Discourse/Zulip/Notion/Slack/Teams/Linear **無一例外用單一有序 enum**,查不到任何系統從 enum 退回獨立開關;Ragic 4 開關 = 16 組含無意義組合;「與我相關」在成熟系統是**自動訂閱地板非開關**;(b) **OQ-NT-4 改寫** —— 「通知表兼佇列」是已知反模式,Discourse/GitLab/Novu **三家皆分表**(生命週期 / 寫入模式 / 扇出 / 保留策略四者衝突);PostgreSQL-only 仍正確,pilot < 50 msg/s 遠低於實測死亡螺旋區;(c) **OQ-NT-8 改寫** —— 混淆了 digest 與**去抖動**,後者**必須做**(Jira 3min idle / 10min max,關鍵事件 bypass),否則連續編輯 10 次 = 10 封信;(d) **OQ-NT-7 改寫** —— **自架 SMTP 在雲主機上基本不可行**(IP 段被封、port 25 封鎖、低量養不熱 IP),改 relay 共用 pool,且**與 OSS-only 不衝突**(買的是 IP 信譽非軟體授權);suppression list 升 P0。**OQ-NT-9 決定不變但理由改寫**:真論據是「**欄位級權限使業界主流的收件人過濾失效**」(Jira/GitLab 無欄位級權限故過濾收件人即可),並以 CVE-2019-11544 / CVE-2021-39119 / CONFSERVER-52560 佐證此為重複發生的一整類 bug。**新增 FMEA N14(P0,已對程式碼驗證)**:`titleOf()` 取 `fields[0]`,首欄為使用者自建任意欄位 → 標題本身即可能洩漏金額 / 身分證號。另 N15 suppression / N16 去抖動 / N17 **PgBouncer tx mode 下 LISTEN/NOTIFY 不可用 + RLS FORCE 擋 worker 跨租戶掃描**(M1 第一件事確認)| Claude Code |
| 2026-07-28 | **v0.3** | **決策方指出 v0.2 漏了「LINE 個人 vs 群組」** —— 查證屬實:**docs/04 §H 早已明載「個人 1:1 + 群組」且註明「台灣 SMB 日常 LINE 群組通知」**,而 v0.2 §4.1 只把 LINE 收件人寫成 userId,群組完全未涵蓋。新增 **§4.6**:個人與群組是**兩種不同的功能**非同一功能的兩種位址(收件人 / 訂閱者 / 權限模型 / 退訂 / 審計語意五面皆異)。**三個後果**:(a) 群組屬「事件廣播」不屬「通知訂閱」,設定入口在表單 / 租戶層,歸 docs/04 通知路由引擎;(b) OQ-NT-9 對群組**升級為不可協商**(群組廣播無任何權限模型可依靠);(c) **§4.5 第 1 條修正為多型 recipient** —— v0.2 原寫「記錄 `recipient_user_id`」**是錯的**,群組通知沒有收件使用者,該模型根本無法表示。新增 OQ-NT-13(群組歸屬)· OQ-NT-14(多型 recipient 自 M1 起)+ FMEA N12(群組廣播洩漏,P0)· N13(群組失效靜默)。另記錄 mockup review 四項 UI 裁定 | Claude Code |
| 2026-07-28 | **v0.2** | **補 §4 外部通知通道設計**(v0.1 僅有「通道抽象」一行,不足以做決策)。**推翻 v0.1 自身之一條判斷**:原 OQ-NT-5 寫「加 LINE 是獨立小批 +0.1 mo」,研究後確認錯誤 —— LINE 的成本不在送訊息 API,而在 **綁定流程 + inbound webhook + 租戶憑證管理**;結論(P0 不做 LINE)不變但**理由改為「它大到應自成模組」**而非「它不重要」。**§4.2 Ragic 綁定流程**(加官方帳號好友 → LINE 內傳 `/validate|信箱` → **寄驗證信** → 15 分鐘內點連結完成綁定;同一 userId 短期不可重複申請);**驗證刻意繞回 Email** 以防冒用。**§4.3 部署模式**:Ragic 雲端版平台代發 + 每則 NT$0.2 扣點,**Weyver 無計費載體(Phase 2)→ 只能走租戶自帶憑證**,確認 docs/04「通道連接設定 UI 1 人月」為 LINE 之硬前提。**§4.4 多租戶陷阱**:LINE userId 為 **Provider 作用域**,租戶各自帶官方帳號 ⇒ 綁定鍵必須含 `tenant_id`,否則跨租戶洩漏。**§4.5 五項抽象約束**(收件人存 user_id 非位址 / 綁定為獨立概念 / 憑證屬租戶 / 內容結構化不存已渲染 HTML / inbound 為一等公民)。新增 OQ-NT-10..12 + FMEA N10(綁定錯人,P0)· N11(on-prem 收不到 webhook)| Claude Code |
| 2026-07-28 | v0.1 | 初版 DRAFT。**§0 證據**:Ragic 通知三層結構(全域 / 逐表單四開關 / 事件×通道矩陣)+ 「跟我相關」官方定義(新增 + 指派 + 回應)+ 共通篩選訂閱(進入 / 離開兩種觸發)+ **批次匯入與大量修改刻意不通知**(風暴防護)+ 提醒為宣告式(日期欄 + N 天 + **收件人來自欄位值** + 每日排程 + 預設合併)+ 排程管理集中設定。**競品分歧**:Airtable 把通知做成 automation 的 action 且 **Editors 只能檢視**,與自助化命門衝突 → 採 Ragic 訂閱模型。**§0.3 實查出會改 scope 的相依**:「跟我相關」三要素中,Weyver 只有 `createdBy` 成立 —— **member 欄型無前端渲染、註解功能完全不存在** → OQ-NT-2。P0 = 站內通知中心 + Email + 訂閱設定 + 簽核接通 + 風暴防護;提醒 / 其餘通道 / 註解 明確排除並附理由。OQ-NT-1..9 待裁定 | Claude Code |
