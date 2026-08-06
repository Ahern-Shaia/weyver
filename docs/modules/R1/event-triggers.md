# event-triggers.md — [R1·C-4] 事件觸發器(建立 / 更新時自動執行)設計文件

> 狀態|**M0 草擬(2026-08-06)**
> 上游|`docs/32` C 段「觸發器與 Action:自訂按鈕已交付,**事件觸發器〔建立 / 更新時自動執行〕未起**」
> 相關|[actions-approval.md](actions-approval.md)(動作執行器)· [conditional-format](conditional-format.md)(條件求值)· `docs/31`(向上設計 backlog)

---

## §0 站在巨人的肩膀上

⚠️ 三站逐站列標題,**沒查的寫「未查證」不留空**。本 repo 已為「漏掉第二站」付過代價。

### 站一|自家 repo —— **這一站決定了整個設計**

先查自家 repo,結果是**要蓋的東西有一大半已經在了**:

| 已存在 | 位置 | 對本模組的意義 |
|---|---|---|
| **事件匯流排 + outbox** | `integrations/event.service.ts` | `record.created` / `record.updated` / `record.deleted` **已在業務交易內發射**,per (tenant, form, record) 遞增序號。**不必新建事件源** |
| **扇出消費者** | `integrations/event-fanout.service.ts` | `fanned_out_at` 標記 + 每分鐘 cron + advisory lock,已餵通知與 webhook。**觸發器是第三個消費者** |
| **動作執行器** | `actions/button.service.ts` `runAction()` | 已與按鈕語意解耦(簽核完成是第二個呼叫端)。封閉 allowlist + 確定性編譯 + 冪等 + audit。**觸發器是第三個呼叫端** |
| **動作 allowlist** | `actions/action-specs.ts` | `updateSelf` / `pushTo` / `openUrl` 三種,值來源 `literal` / `field` / `variable`。前兩種可直接復用 |
| **條件求值器** | `@weyver/rules` | 前後端共用,已有 `between` / `dailyBetween` / 群組成員判斷 / 虛擬欄位 `$now` `$actor`。**條件側幾乎不必寫** |

🔴 **結論:本模組不是新建一套自動化引擎,是把已經存在的事件源接到已經存在的動作執行器上,中間插一個條件。**
若沒先查這一站,最可能的結果是再造一份事件表與一份動作執行器,
然後與既有那份**慢慢漂移** —— 那正是 `docs/25` 記過四次的「兩份鏡射」。

### 站二|自己的相依套件

| 查了什麼 | 結果 |
|---|---|
| BullMQ / DBOS | 🔴 **都沒安裝**。`AGENTS.md` 與 `docs/20` 把它們寫成既定選型,但 `apps/api/package.json` 裡沒有 |
| 實際在用的背景執行機制 | `@nestjs/schedule` 的 `@Cron` / `@Interval` + **DB 表當佇列**。`pdf-worker` / `webhook-delivery` / `scan` / `event-fanout` 四處同一形狀 |
| `@weyver/rules` | 條件求值已具備(見站一) |

**裁定:沿用「DB 表當佇列 + cron 撿件」,不為此引入 Redis 或 DBOS。**
理由與 `event-fanout` 檔頭已記的一致 —— 少一個依賴、少一個故障面;
而且觸發器與扇出**共用同一張 outbox**,再多一套佇列只會讓兩者的投遞語意分岔。

### 站三|競品(Ragic 官方繁中文件,2026-08-06 查證)

> 本地鏡像 `reference-materials/ragic-doc-zh-TW/`。以下三條**承重引用皆由本專案直接開檔覆查**,
> 不採信轉述(`AGENTS.md`〈承重論據必回一手查證〉)。

🔴 **Ragic 有事件觸發。不得宣稱它沒有。** 而且有兩套:

| 路徑 | 要不要寫程式 | 確定性 |
|---|---|---|
| **AI Agent**(`doc/173`)| 不用 | ❌ LLM 驅動,按 token 計費 |
| **JavaScript 工作流程**(`doc/29` / `doc/125`,post-workflow)| **要** | ✅ |
| 動作按鈕 | 不用 | ✅ —— 但**只能手動觸發** |

AI Agent 的六種觸發逐字(`doc/173`):`RECORD_CREATE` 建立新資料時觸發 · `RECORD_UPDATE` 更新既有資料時觸發 ·
`RECORD_COMMENT` · `EMAIL_RECEIVED` · `MENTION` · `SCHEDULED` 依照指定時間自動觸發。
十種動作含 `CREATE_RECORD` / `MODIFY_RECORD` / `SEND_EMAIL` / `URL_CALL` / `EXECUTE_ACTION_BUTTON`。
⚠️ **是 10 種不是 11 種** —— `CLAUDE.md` 現記「6 觸發 × 11 動作」,那一列把表頭算進去了,應更正。

**動作按鈕只能手動**,官方逐字(`doc-kb/183`):

> 另外,動作按鈕也是需要手動觸發的功能(手動在表單上按按鈕或在列表頁利用批次執行來執行動作按鈕),
> 但情況相對單純(比較不會因為其他行為例如「修改某個欄位值」而觸發動作按鈕)。

**確定性的自動執行,官方答案是寫 JS**(`doc/98` 逐字):

> 有以下幾種**不用另外寫程式**的方法以及 **2 種需要客製化程式**的做法。〔…〕
> 1. 在 Javascript Workflow Engine 寫一段**每當資料建立或儲存都會觸發的 post-workflow**〔…〕

同型還有四篇 KB 各自教人貼程式碼補同一件事(`doc-kb/163` 存檔後重算公式 · `doc-kb/214` 存檔後執行連結與載入 ·
`doc-kb/260` 每日同步 · `doc-kb/185` 「要**自行寫 post workflow**」)。

### 🔴 所以縫在哪裡:**是「確定性」不是「有無」**

Ragic 的**無程式**自動觸發是 LLM 的(逐次消耗 AI 額度、模型可選、輸出不保證一致);
它的**確定性**自動觸發要寫 JavaScript。**兩者不重疊的那一塊就是本模組的位置。**

對照〈向上設計三條〉:

| 條件 | 是否成立 |
|---|---|
| ① 巨人明確停在那裡 | ✅ 三條一手逐字(動作按鈕只能手動 / 確定性路徑指向寫 JS / 無程式路徑是 LLM)|
| ② 架構讓我們過得去 | ✅ **封閉 allowlist + 確定性編譯**(`action-specs.ts` 早已如此,不是為此新寫)+ 既有 `event_outbox`。差別在地基,不是多寫幾行 |
| ③ 對「取代 ERP」有意義 | ✅ 過帳 / 狀態轉換 / 庫存異動**必須確定性且可稽核** —— 不能由語言模型決定要不要過這張帳 |

⚠️ **對外措辭**|講「我方讓你不寫程式就得到**確定性**的自動化」,
**不要講「Ragic 不能自動觸發」** —— 那句話會被官方文件當場反駁。

### 順帶查到的兩個硬上限(可餵 `docs/31`,本模組不直接引用)

官方逐字(`doc-kb/281`):

> 而為了避免影響效能,資料儲存時觸發的相關表單公式重算會有**資料筆數限制為 2000 筆**,
> 若需重算的資料超過系統限制,**所有相關表單資料都不會進行公式重算**〔…〕

以及(`doc/26`):超過 **3500 筆就不寫入修改紀錄**(「實際上資料有正常執行重算,只是不會顯示於修改紀錄」)。
兩者都是**靜默降級**:前者是正確性、後者是稽核完整性。

### 查無(**不得當成「沒有」**)

本地庫 grep 無實質命中:AI Agent / workflow 的**執行時間上限**、**遞迴或自我觸發防護**、
**執行失敗的重試或告警**。`doc/29` 全文只有兩句,JS 工作流程指南本體是外連、不在本地庫。

---

## §0-ter 站三補查(2026-08-06)—— **原版只查了 Ragic 一家,不合格**

> ⚠️ **這一節是稽核的結果,不是當初就有的。**
>
> 出貨當下的站三只問了「Ragic 怎麼做」四道題,**一家、900 字上限、四分鐘**。
> 對照 `docs/34`(六軸平行、逐一複驗 LICENSE 本文)與 `approval-advanced`
> (一手查證五題、六家競品),那不叫深度研究,叫**一次定向查詢**。
>
> 🔴 **根因不是忘了查,是查的方向錯了。** 進場時站一已經給出答案(接既有 outbox
> + 既有執行器),於是站三退化成「找一句話來**背書**已經決定的設計」,
> 而不是「用查證去**決定**設計」。證據:四道題全在問 Ragic,
> 沒有一道在問「還有誰做過、他們的取捨是什麼」。
>
> **判準**:深度研究會推翻東西。原版沒推翻任何東西(只把措辭從
> 「Ragic 沒有事件觸發」改成「縫在確定性」),這一版推翻了兩個設計決定。

### 🔴 補查推翻的兩件事

#### ① 我沒有「草稿 / 生效」分離,而 Teable 有

Teable 官方逐字(`teable-docs/.../basic/automation.md`):

> Changes are saved as a draft. **The live workflow keeps running on the previous version
> until you click Apply Update.**

我方是**改了立刻生效**:設計者改到一半的觸發器,當下就在對真實資料動作。
這一面原本完全沒想到。**列為殘留**(見 §4)。

#### ② 「不重試」我下得太早

M3 裁定「個別觸發器失敗不重試,因為 `pushTo` 不冪等」—— 理由沒錯,結論太早。
Teable 的答案是**給選擇並明講風險**,而不是替使用者決定:

> **Full rerun** runs every step again and **may create duplicate records, emails, or notifications**.
> **Resume from failed step** is available when Teable can safely continue from the failed step.

它還做到「不能接續時說明為什麼」。Airtable 同樣是手動 Rerun(`managing-airtable-automations`):

> You can click **Rerun** on any past failed run in the run history. If the original automation
> configuration has since changed, **the rerun will still attempt to execute using the configuration
> at the time of the original run**, not the current configuration.

我方的執行紀錄只有一列 outcome,**連重跑都沒有**。列為殘留。

### 🔴 補查**確認**的一件事:遞迴防護我方在它們之上

| | 遞迴 / 自我觸發防護 | 逐字 |
|---|---|---|
| **Airtable** | ❌ 無,燒完配額為止 | 「this automation will **loop endlessly until you've exhausted your workspace plan limits**」(`troubleshooting-airtable-automations`)|
| **Teable** | ❌ 無,推給使用者 | 「be careful to avoid infinite loops. **Use a filter to exclude records that were created by automation** (for example, by checking a flag field)」(`automation/trigger/records/record-created`)|
| **Salesforce** | ✅ 有,且有數字 | 「Total stack depth for any Apex invocation that recursively fires triggers due to insert, update, or delete statements: **16**」([Apex Governor Limits](https://developer.salesforce.com/docs/atlas.en-us.salesforce_app_limits_cheatsheet.meta/salesforce_app_limits_cheatsheet/salesforce_app_limits_platform_apexgov.htm))|
| **Weyver** | ✅ 系統層 `depth` 上限 5 | 見 `trigger-async.service.ts` |

⚠️ 三條 Airtable 引用與一條 Teable 引用**皆由本專案開檔覆查**,非採信轉述。
Salesforce 那條由本專案直接 fetch 官方頁取得。

### Airtable Automations 其餘要點(本地鏡像 168 篇)

| 面向 | Airtable | 我方 |
|---|---|---|
| **同步路徑** | **完全沒有**。逐字「an automation run will occur **instantaneously after** the conditions... are met」·「Airtable **reads the record the moment the trigger fires**, and computed fields can take a moment longer」→ 讀到還沒算完的值是**已知失敗模式** | 有(存檔前改待寫入值),**本地庫查無對應物** |
| 觸發時機 | 進入視圖 / 建立 / 更新(**可選欄位白名單**)/ 符合條件 / 表單送出 / 排程 / webhook / 按鈕 | 建立 / 更新(可選監看欄)|
| 「舊值 vs 新值」 | **本地庫查無**任何 previous-value token | 有(`watchFields` 逐欄比對前值)|
| 條件 | and / or,**明文「Can I nest conditions? No」**;且視圖的進階篩選「**is not available in the Airtable Automations feature**」 | 目前只有 and |
| 執行順序 | **官方自相矛盾**:一處「**No.** ...no guarantee they occur in the order they were triggered... **leading to race conditions**」,另一處「Airtable runs automation operations **one at a time, in order**」 | 單一 worker + advisory lock,序列 |
| 動作 | 建立 / 更新(**一次一筆**)/ 寄信 / 找記錄 / **Run a script** / 各家整合 | 更新本筆 / 建別表記錄 |
| 執行紀錄保留 | 3 年 / 1 年 / 6 個月 / 2 週(依方案)| 無保留期政策 —— **殘留** |
| 官方明說做不到 | 「**Can I use this automation to create records in other bases? In general, no.**」·「**They do not evaluate spreadsheet-style math**」(要算就得先建 formula 欄或寫 script)| 我方 `pushTo` 跨表是原生能力 |

⚠️ **不得宣稱「Airtable 沒有自動化」** —— 它的觸發時機比我方多,動作也多。
真正的差別在**同步路徑**(它沒有)與**遞迴防護**(它沒有)。

### 這一輪同樣查了、但沒東西的

- **Baserow**:本地鏡像只有 65 份**開發者**文件,`automation` 命中全是 k8s / formula / locks 之類的巧合。**本地庫無 automation 功能文件。**
- **Odoo**:本輪未查(automated action 與本模組可比,**列為未查證**,不得當成「沒有」)。

---

## §1 要解的問題

Ragic 範式的使用者會問的是這種問題:

- 「訂單金額超過 10 萬,存檔時自動把狀態改成『待審』。」
- 「品檢單判定為不合格時,自動在『矯正措施』表開一張單。」
- 「客戶資料被改動時,通知業務。」

第三件**現在就做得到**(通知路由 + event outbox)。
前兩件現在的答案是「請使用者自己記得按那顆按鈕」—— 而使用者不會記得,
**於是資料的正確性取決於有沒有人記得按按鈕**。

## §2 範圍

**做**|建立時 / 更新時,依條件自動執行 `updateSelf` 或 `pushTo`;設計器入口;執行紀錄。

**不做(明列,不留模糊)**|

| 不做 | 理由 |
|---|---|
| 定時觸發(排程) | `docs/32` C 段另列一條「排程任務(per-tenant cron)」,是獨立的一件事 |
| 刪除時觸發 | 記錄已軟刪,動作要改的東西不在了;語意需另裁 |
| 呼叫外部 API | 已有 webhook 訂閱走 outbox,同一件事不做第二條路徑 |
| `openUrl` 動作 | 沒有人在場,沒有瀏覽器可以開 |
| 觸發器裡寫程式 | 🚫 第一約束。這正是我方要向上的位置 |

---

## §3 待裁定(OQ)

> 標 ✅ 者為**研究錨定**(依 `AGENTS.md`〈研究錨定的建議 = 已核准〉),直接實作。

### OQ-ET-1|同步還是非同步?

**✅ 裁定:兩者都要,依動作分。**

| 動作 | 時機 | 理由 |
|---|---|---|
| `updateSelf` | **同步,在存檔的同一交易內,且改的是「即將寫入的值」** | 既有 outbox 是**每分鐘** cron。使用者存檔後看不到狀態變成「待審」,一分鐘後才變 —— 那不叫自動化,那叫畫面壞了 |
| `pushTo` | **非同步,走既有 outbox** | 在別表建記錄是可以晚一分鐘的;而且它可能失敗(目標表權限 / 驗證),**不該把使用者的存檔一起拖垮** |

🔴 **同步側改的是「即將寫入的值」而不是「寫完再改一次」** —— 這一點是整個設計的關鍵:

- 不產生第二次 DML → **不產生第二個事件** → **遞迴在構造上不存在**(見 OQ-ET-2)
- 只有一筆修改紀錄,而不是「使用者改了一次、系統又改了一次」兩筆
- 一個交易,不會出現「主檔存了、觸發器沒跑」

### OQ-ET-2|遞迴與連鎖怎麼防?

**✅ 裁定:同步側靠構造,非同步側靠祖先鏈深度上限。**

- **同步側**:見上,改的是待寫入值,不發新事件 → **無遞迴可言**。
  同一次存檔內多條規則依 `position` 依序套用到同一份值上,後者看得到前者的結果(與條件式格式「由上而下、後者覆蓋」同一個心智模型)。
- **非同步側**:`pushTo` 建的記錄會發 `record.created`,可能再觸發。
  outbox 加 `caused_by_event_id`,扇出時累計深度,**超過 5 就停並寫 audit**。
  ⚠️ **停的時候一定要留下紀錄** —— 靜默停止的自動化比不會動的自動化更難查。

### OQ-ET-3|以誰的身分執行?

**✅ 裁定:以觸發者(存檔的人)的身分與權限執行,權限不足就記 `denied`,不升權。**

依據是自家既有行為:`button.service.ts` 的 `runAction` 逐字以 `tenant.actorId` +
`permissions` 執行,`pushTo` 前還明確檢查 `hasAction(targetFormId, "create")`。
觸發器沿用同一條路 —— **不另開一個「系統身分」**。

理由:一旦有系統身分,「我看不到那張表,但我可以設一條觸發器往裡面寫」就成立了,
那是繞過權限的合法路徑。代價誠實記:**設計者設的觸發器,可能對某些使用者跑不動**,
所以執行紀錄必須看得到「為什麼沒跑」。

### OQ-ET-4|條件用哪一套?

**✅ 裁定:復用 `@weyver/rules` 的 `FormatCondition`,但**不**復用 `conditionalFormats` 這個容器。**

- **復用條件**:同一個「金額 > 10000」在條件式格式與觸發器裡不該有兩種寫法,
  求值器也不該有兩份(前後端共用的先例是 `@weyver/formula`)。
- **不復用容器**:條件式格式是**顯示時、每次算、無副作用**;觸發器是**存檔時、算一次、有副作用**。
  塞進同一張規則清單的後果是使用者改一條顏色規則時會**發動作** —— 那是類別錯誤。

### OQ-ET-5|「更新時」是指哪一種更新?

**✅ 裁定:給「指定欄位變更時」而不是只給「任何更新」。**

只給「任何更新」的話,使用者為了「金額改變時重算」會被迫在每次存檔都跑一遍,
而條件又寫不出「跟上次比」。`record_revision` 已經存了前後值(H-4 已交付),
**變更偵測的資料已經在了**,不必新建。

### OQ-ET-6|失敗了怎麼辦?

**✅ 裁定:同步側失敗擋存檔;非同步側失敗重試後進死信,兩者都寫執行紀錄。**

同步側擋存檔的理由:`updateSelf` 算不出來就存下去,等於**存了一筆使用者以為已經處理過的資料**。
寧可當場報錯讓人知道。⚠️ 代價:一條設壞的觸發器會讓整張表存不了 ——
所以設計器要有**試跑**(拿一筆現有記錄空跑,只顯示結果不寫入)。

---

## §3-bis 實作期修正(比 M0 更準的裁定)

### OQ-ET-3 修正|欄位級寫入權限:**同步側刻意繞過**

M0 原寫「以觸發者身分執行,權限不足記 `denied`」。**實作時發現那樣做會讓功能等於不存在** ——
最常見的用途正是「使用者**不能改**『狀態』,但存檔時系統把它設成待審」,
照使用者的欄位權限擋的話就沒有任何一條有用的觸發器設得起來。

改判的依據是**跨不跨邊界**:

| 動作 | 權限 | 理由 |
|---|---|---|
| `updateSelf` | **繞過欄位級寫入權限** | 動的是這張表這一筆,而觸發器是**這張表的設計者**設的 |
| `pushTo`(M3)| 仍以觸發者身分 | 跨到別張表,設計者未必有那張表的權限 |

🔴 **豁免只給觸發器自己設的欄位**(`bypassFields`),不是整包放行。
整包放行在功能上看起來一模一樣,差別只在使用者送上來的欄位也被放行了 ——
那就從「設計者授權的自動化」變成「任何人都能寫任何欄位」。
整合測試逐條釘住這個邊界,**並實測過整包放行會讓它變 201**。

⚠️ 連帶裁定:建立 / 修改觸發器一律 `design` 權不是 `edit` ——
「誰能建觸發器」= 「誰能繞過這張表的欄位權限」。

### 豁免**不含**遮罩值檢查

`assertWritable` 的遮罩檢查在 policy 短路**之前**,不受 `bypassFields` 影響:
觸發器一樣不准把 `••••1234` 寫回去。

## §4 里程碑

| M | 內容 | 狀態 |
|---|---|---|
| M1 | schema(`trigger_def` / `trigger_run`)+ zod 邊界 | ✅ 2026-08-06 |
| M2 | 同步側 + CRUD + 試跑 + 整合測 | ✅ 2026-08-06 |
| M3 | 非同步側:outbox 消費者 + `pushTo` + 深度上限 + 死信 | ✅ 2026-08-06 |
| M4 | 設計器 UI(觸發時機 / 條件 / 動作 / 試跑 / 執行紀錄)| ✅ 2026-08-06 |
| M5 | e2e 固化 + FMEA | 🟡 e2e ✅;FMEA 待補 |

### 🔴 站三補查後新增的殘留(2026-08-06)

| 殘留 | 依據 |
|---|---|
| **改了立刻生效,沒有草稿 / Apply Update** | Teable 逐字「live workflow keeps running on the previous version until you click Apply Update」。目前設計者改到一半就在對真實資料動作 |
| **執行紀錄不能重跑** | Teable 給 full rerun + resume-from-failed 並明講重複風險;Airtable 給 Rerun 且**用當時的設定重跑**。我方連重跑都沒有 |
| **執行紀錄無保留期** | Airtable 依方案 2 週 – 3 年。我方無政策,`trigger_run` 會無限長 |
| **條件只有 and** | Airtable 有 and / or(但明文不支援巢狀)|
| **Odoo automated action 未查** | 本輪沒查,不得當成「沒有」|

### M1–M2 實作紀錄

| 決定 | 內容 |
|---|---|
| **走 app 車道** | `TriggersRepository` 用 `TenantDb`(`APP_DRIZZLE`)而非 `DRIZZLE`。後者是**特權車道,RLS 不執法** —— 用它的話 `0055` 的 RLS 與 GRANT 全是裝飾。鄰居 `actions.repository.ts` 用的是 `DRIZZLE`,那是既有狀態不是範本 |
| **`compileValues` 抽成純模組** | 原本是 `button.service.ts` 的私有函式。觸發器要用同一套確定性編譯,留在 service 裡的話只有「相依整個 ButtonService(迴圈風險)」或「自己再寫一份」兩條路 |
| **`conditionsMatch` 匯出** | `@weyver/rules` 原本只有 `ruleMatches` 私有。抽出的是**既有邏輯**不是新寫一份 —— 「引用不存在欄位 → 整條略過」這種沉默但關鍵的語意有兩份實作的話,漂移沒人查得出來 |
| **`trigger_run` 不授 UPDATE / DELETE** | 與 `action_audit` / `record_revision` 同理由 |
| **同步側不記 `skipped`** | 每次存檔每條觸發器記一列的成本不成比例。「為什麼沒跑」由**試跑**回答 —— 稽核記已發生的事,試跑回答 what-if |

### M4 實作紀錄

| 決定 | 內容 |
|---|---|
| **掛在既有的「動作/簽核」抽屜下** | 與自訂按鈕 / 簽核流程 同一個心智類別(「這張表會發生什麼事」),不另開一個入口 |
| **`ConditionRows` 抽成共用元件** | 條件式格式的條件編輯器原本內嵌在 `conditional-format.tsx`。伺服器端本來就已共用同一支求值器,設定畫面再寫一份的漂移形態是「同一個條件在格式面設得起來、在觸發器面設不起來」。抽出後 `conditional-format.tsx` 從 376 → 273 行 |
| **明寫「會略過欄位權限」** | 設計者多半不知道自己剛剛繞過了什麼。不寫的話這件事只有讀原始碼的人知道 |
| **監看欄位只在勾了「更新時」才出現** | 建立時沒有前值可比,給了只會讓人以為它有作用 |
| **`pushTo` 隨 M3 一併補進設計器** | M3 出貨當下設計器只給 `updateSelf` —— 那就是「只能打 API 設」的半套,與 #51 剛修掉的問題同型。同一輪補完 |
| **`pushTo` 分支明寫兩件事** | 「**存檔後才跑**(最多約一分鐘)」與「**以觸發的人的權限**執行」。兩者都與 `updateSelf` 完全不同,而設計者不會自己猜到 —— 猜錯的後果是「我設了它卻沒反應」 |

真瀏覽器實走(Playwright MCP):設計器建觸發器 → 打 API 存一筆記錄 →
**送進去的「我打的名字」被換成觸發器設的值**。整條迴圈通。

### M3 實作紀錄

| 決定 | 內容 |
|---|---|
| **獨立標記欄 `trigger_run_at`** | 不共用 `fanned_out_at`。扇出(通知 / webhook)是 at-least-once 的,共用的話觸發器失敗重試會讓**使用者收到重複通知**,而原因是一條跟他無關的觸發器失敗了 |
| **`event_outbox.depth`** | worker 建完記錄後把子事件的 depth 補成父深度 + 1。安全性來自時序:記錄是這一瞬間建的,而 worker 全程持有 advisory lock |
| **上限 5,超過寫 `depth` 紀錄** | 對**每一條**觸發器都寫。只記一次的話,設計者看到「有一條停了」卻不知道另外兩條也停了 |
| **個別觸發器失敗不重試** | 重試整個事件會把已成功的那幾條再跑一次,而 `pushTo` 不冪等 —— 重跑等於再建一張單。使用者寧可看到「這條失敗了」也不要收到三張重複的單 |
| **整批失敗才重試(3 次)** | 讀不到記錄 / 解不出權限這類。超過寫 `failed`,那筆紀錄就是死信 —— 不另建死信表,因為要看的人要看的是「哪條觸發器一直失敗」 |
| **`actor_id` 為 null → `denied`** | 不退回系統身分。那正是要避免的側門 |

### 🔴 M3 抓到的三個坑,全部是「往拒絕的方向無聲失敗」

**① `bigint` 從 raw SQL 回來是字串** —— `node-postgres` 預設不轉 int8(超過 2^53 會失真)。
而 `EffectivePermissions` 用 `Map<number, …>` 查表,`Map.get("1")` 查不到數字鍵 `1`,
於是**靜默變成「沒有任何權限」**:所有欄位隱藏、所有動作拒絕,不拋錯。
看起來就像「觸發器根本沒接上」。鄰居 `event-fanout` 沒踩到,只因為它把這些值幾乎只用在 SQL 裡。

**② 權限測試用的身分剛好擁有那張表** —— 授權模型有 owner 短路(`createdBy === actorId` → 全套資料動作)。
測試裡的 `limitedActor` 其 id 剛好等於 dev 車道的 actor,而表都是用 dev 車道建的
→ 它是 owner → 「無權」測不出來。**權限測試最容易空過的形態之一。**

**③ 「沒授予」不等於「拒絕」** —— 未分類的非敏感表會落到**租戶預設 profile**(層 4),
所以「只是不給目標表的權」照樣有 create。deny-by-default 在這個模型裡的正確表達是**敏感旗標**。

三者的共同形狀:**失敗的方向是靜默的**。①③ 讓權限比預期寬或窄而不報錯,② 讓測試空過。

### ⚠️ 實作期踩到的坑

**否定斷言空過(本 repo 第三次)**|「沒動那一欄就不觸發」第一版把記錄更新寫成
`PUT` + `version`(實際是 `PATCH` + `expectedVersion`),於是**更新根本沒發生**,
而那條斷言照樣綠 —— 因為什麼都沒變。
補法是**每一次前置動作都斷言狀態碼**,並加一條「前置的更新本身要成功」。

同型的第二處:「只留一筆修改紀錄」在端點形狀不符時 `list` 恆為空 → `<= 1` 恆真。
補了守衛的守衛:改一次之後至少要數得出一筆。

## §12 FMEA

⏳ M5 前填。**已知必列**:設壞的觸發器鎖死整張表(OQ-ET-6 的代價)· 非同步連鎖打爆 ·
觸發器成為跨表寫入的側門(OQ-ET-3 已緩解,需測試斷言)· 同步側拖慢存檔延遲。

## §13 版本

| 日期 | 版 | 內容 |
|---|---|---|
| 2026-08-06 | v0.1 | M0 草擬。站一站二查完並直接改變了設計(接既有 outbox + 既有動作執行器,不新建);站三查證中 |
| 2026-08-06 | v1.0 | **站三查完**(三條承重逐字由本專案開檔覆查):Ragic **有**事件觸發,但無程式的那條是 **AI Agent(LLM 驅動、按 token 計費)**、確定性的那條**要寫 JavaScript**,而動作按鈕官方逐字「**也是需要手動觸發的功能**」→ **縫在「確定性」不在「有無」**。**M1–M2 SHIPPED**:schema / 同步側 / CRUD / 試跑 / 9 條整合測。OQ-ET-3 實作期改判(見 §3-bis)。api 1133 綠 |
