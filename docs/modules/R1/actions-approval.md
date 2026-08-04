# actions-approval.md — [R1·後續-1] 自訂按鈕 + 簽核流程(workflow UX 面)設計文件

> ✅ **狀態：SHIPPED v1.0(2026-07-25;M1–M5 全綠;api 250 + web 19 e2e 過)**
> **落地**｜M0 `38841d6` · M1 後端 `d346451`(按鈕動作框架 + migration 0012)· M2 後端 `6c352aa`(簽核狀態機 + ZEN 路由 + 記錄鎖 + 自動執行)· M3 `a4d48cd`(記錄頁按鈕/簽核 + 待簽佇列)· M4 `ead550c`(設計器動作/簽核 UI)· M5 `56adb24`(actions-approval.spec)。
> **裁定摘要**｜1=A DB 狀態機(無 DBOS) · 2=A 三動作 allowlist · 3=A 順序階層 + 金額路由 · 4=A 裝 GoRules ZEN · 5=A 定義走 authz Tier-1 車道 · 6=A 整筆記錄鎖 · 7=A 採 §1.1 五項為 P0。
>
> docs/27 §6「後續」第一項（承 field-types-parity SHIPPED,四大 P0 模組完成後）。落地 §4 P1「按鈕與簽核 = workflow 模組的 UX 面」：**自訂按鈕動作框架**（資料拋轉 / 更新本表 / URL 等）+ **簽核流程**（階層 / 金額條件路由 / 人核准 gate / audit）。對應 docs/25 C 工作流。
>
> **核心架構洞見**：**簽核 = 資料庫狀態機**（`approval_instance` 之 pending steps,由 approve/reject 動作推進）—— **不需 DBOS durable execution**（「等數天」只是 pending DB 狀態,非掛起的函式);durable execution 僅在「簽核完自動連鎖過帳」等長副作用鏈才需（P1）。**ZEN 只算路由決策**（金額條件→誰簽）。按鈕動作走 docs/22 不變量:**結構化 intent → 確定性 allowlist 編譯 → 有權者核准 → audit**。故本 workflow-UX 模組 M0 可控,不需先啃重型 durable-workflow infra。
>
> 作者：Claude Code（草擬）
> 版本：v0.1（2026-07-25）
> 證據：docs/27 §4 P1（按鈕 7 類 / 簽核框;來源 Ragic doc/68·62·69·95·15·169）、docs/20（規則→GoRules ZEN / durable→DBOS 決策）、docs/22（AI/動作載重不變量 + 冪等 + audit）、現況（authz `approve` 動作已有〔P0-4a〕、ZEN/DBOS 未裝、無按鈕/簽核 scaffolding）

---

## 1. 目標與範圍

### 1.1 目標（P0）

1. **自訂按鈕動作框架**｜表單/記錄上可配置按鈕,執行**確定性 allowlist 動作**:**更新本表**(set 欄位值)、**資料拋轉**(依映射建他表記錄)、**URL**(開連結)。每動作 **執行前確認 + 權限 gate(角色)+ 冪等 key + audit**（docs/22)。Email/SMS 動作待通知 infra（P0-4b）。
2. **簽核流程（state machine）**｜表單可掛簽核定義（`approval_def`:多步、每步簽核者=角色/群組、**金額條件路由**經 ZEN）;送簽 → `approval_instance`（pending step）→ 簽核者 approve/reject（人核准 gate,承 authz `approve` 動作）→ 推進/完成/退回;全程 audit + 記錄鎖定（簽核中不可改）。
3. **簽核完自動執行**｜簽核完成 → 觸發指定按鈕動作（如資料拋轉);單一交易 + 冪等（不重複過帳）。
4. **引擎整合（最小）**｜**GoRules ZEN in-process**（路由決策規則:金額/條件 → 步驟);**不引入 DBOS**（狀態機由 DB pending 狀態驅動,非 durable 函式;durable 連鎖副作用列 P1）。
5. **誠實**｜會簽/擇辦(並簽)、@提及/留言、合併列印、SMS/Email 動作、durable 多步自動鏈 —— 不做進 P0（各有依賴或屬 P1,見 §1.3）。

### 1.2 對應訴求

| 子題 | 訴求 | 對應 |
|---|---|---|
| 按鈕 + 簽核 | Ragic 客戶單據作業縱深（按鈕拋轉 + 階層簽核）—— 對 Airtable/Teable 之護城河（§4 佐證:三家無原生簽核） | docs/27 §4 P1;docs/25 C 工作流 |

### 1.3 不做的事

- ❌ **DBOS durable execution**｜簽核狀態機由 DB pending 驅動,不需掛起函式;durable 僅「簽核完連鎖多步過帳/期結」等長副作用鏈才需 → P1（OQ-AA-1）。
- ❌ **並簽（會簽全簽 / 擇辦任一）+ 動態加簽 + 代理簽核**｜P0 只做**順序多步（階層）**;並行步驟 P1（OQ-AA-3）。
- ❌ **Email / SMS 按鈕動作**｜依通知 infra（P0-4b 通訊平台,未建）→ P0-4b 落地後補（OQ-AA-2）。
- ❌ **更新他表 / 合併按鈕（一鍵多動作）**｜P1（OQ-AA-2）。
- ❌ **留言 + @提及 + 儲存格註解**｜獨立協作特性,自成模組 → 後續（§4 P1 但與簽核解耦）。
- ❌ **合併列印（Excel/Word 範本）/ 標籤 QR**｜歸 print-merge 模組（§6 後續-2)。
- ❌ **動作條碼（掃碼觸發動作）、傳閱**｜§2/§4 P2 / R2。
- ❌ **簽核之 AI 輔助（自動路由建議）**｜docs/17 AI copilot,R4。

---

## 2. 上游 / 既有現況走查

| 子題 | 現況 | Gap |
|---|---|---|
| `approve` 權限動作 | ✅ authz 動作集含 `approve`（P0-4a;Guard 可執法）| 無「誰能簽哪步」之流程綁定 → 簽核定義層新做 |
| 角色樹 / 群組 | ✅ role tree 部門繼承（P0-4a）;簽核者=角色 | 直接復用（階層簽核 = 角色鏈）|
| 記錄 DML / 交易 | ✅ RecordService（單一 tx、冪等承 records、audit ddl_audit）| 動作副作用（拋轉/更新）走既有 createRecord/updateRecord;需動作 audit 表 |
| 規則引擎（ZEN）| ❌ 未裝（docs/20 已定 ADOPT GoRules ZEN,MIT in-process）| 裝 `@gorules/zen-engine` + per-tenant JDM 持久化 + 金額路由決策 |
| durable workflow（DBOS）| ❌ 未裝（docs/20 定 ADOPT,但 M0 不需）| P0 不整合（狀態機 DB 驅動）|
| 按鈕 / 簽核 scaffolding | ❌ 無 | 全新（button_def / approval_def / approval_instance + action 執行器 + 前端）|
| 記錄鎖定 | soft delete + version（樂觀鎖）| 簽核中「已鎖期間不可改」需鎖旗標（承 docs/22 傳票不可變原則之輕量版）|

---

## 3. scope 切分

| 里程碑 | 內容 | 估算 |
|---|---|---|
| **M1 後端（按鈕動作框架）** | `button_def`（表單掛按鈕 + 動作型別 + 映射 config）+ 動作執行器（allowlist:更新本表 / 資料拋轉 / URL;確定性編譯 + 權限 gate + 冪等 key + `action_audit`）+ integration 測 | 0.10 mo |
| **M2 後端（簽核 state machine + ZEN）** | `approval_def`（多步 + 簽核者角色 + ZEN 金額路由）+ `approval_instance`（送簽/pending/approve/reject/完成 + 記錄鎖）+ 裝 ZEN（金額→步驟決策）+ 簽核完觸發按鈕動作（單 tx + 冪等）+ 測 | 0.14 mo |
| **M3 前端（按鈕 + 送簽）** | 記錄頁/清單按鈕渲染 + 執行（確認 dialog）+ 送簽 + 簽核狀態章 + 我的待簽佇列(承 workspace 工作項目槽) | 0.10 mo |
| **M4 前端（簽核定義設計器）** | 表單設定掛按鈕（動作型別 + 映射)+ 簽核定義（步驟 + 簽核者 + 金額條件)UI | 0.08 mo |
| **M5 固化 + FMEA** | Playwright + integration 固化(建按鈕→執行→送簽→簽核→自動拋轉);§12;doc v1.0 + MODULES ✅ | 0.03 mo |

**合計 ≈ 0.45 mo**（對應 docs/25 C 工作流之 P0 首期;會簽/durable/通知動作 P1 另計）。M1/M2 後端 / M3–M5 前端**分開 commit**。

---

## 4. 設計要點

### 4.1 按鈕動作框架（M1;OQ-AA-2）
- `button_def(id, tenant_id, form_id, label, action_type, config JSONB, confirm?, required_action?, role_scope?)`。
- 動作 allowlist（確定性,docs/22 不變量）:
  - `updateSelf`:config `{ setFields: {name: value|variable} }` → updateRecord（權限 + assertWritable）。
  - `pushTo`:config `{ targetFormId, fieldMap: {targetField: sourceField|literal} }` → createRecord 於 target（tenant + 權限 + 冪等 key = button+record+targetForm）。
  - `openUrl`:config `{ url }`(https 白名單,前端開)。
- 執行:後端 `POST /forms/:id/records/:rid/buttons/:buttonId`(確認已於前端)→ 驗權限 + 編譯 config（非任意 code）+ 執行（single tx）+ `action_audit`。冪等 key 防重複拋轉。

### 4.2 簽核 state machine（M2;OQ-AA-1=A 無 DBOS、OQ-AA-3）
- `approval_def(id, form_id, steps JSONB[{ stepNo, approverRole|approverGroup, condition? }])`;`condition` = ZEN 決策（金額>N → 此步啟用)。
- `approval_instance(id, form_id, record_id, def_id, current_step, status〔pending/approved/rejected/withdrawn〕, tenant_id)` + `approval_step_log(instance_id, step_no, actor, decision, comment, at)`。
- 流程:送簽 → 建 instance（current_step=1,record 鎖）→ 簽核者（current step 之角色成員）approve → ZEN 算下一啟用步 → 推進 / 完成（觸發 §4.3）/ reject（退回、解鎖）。**人核准為 gate**(承 authz approve;非模型自動)。
- 記錄鎖:instance pending 時,record update 拒（或僅允簽核者於流程內）—— 承 docs/22「已鎖期間不得過帳」輕量版。

### 4.3 簽核完自動執行（M2）
- `approval_def.onComplete?: buttonId` → 簽核完成於同一收尾 tx 執行該按鈕動作（冪等 key = instance);失敗 rollback + 標記(不半過帳)。

### 4.4 ZEN 整合（M2;OQ-AA-4）—— 🔴 **2026-08-03 已移除,原文保留作對照**

> ~~裝 `@gorules/zen-engine`(MIT,in-process,注入 NestJS,docs/20)。金額/條件路由 = per-tenant JDM JSON 存 PG,runtime 載入。ZEN **只算決策**(哪步啟用 / 誰簽),side effect(推進/過帳)由 Weyver 確定性程式執行 + audit。QuickJS 函數節點 timeout 兜底。~~

**實際落地的與上面這段的距離,是本次稽核最值得記的一件事。**
規劃寫的是「per-tenant JDM JSON 存 PG、runtime 載入、決策表」;
實際寫出來的是 `evaluateExpressionSync("amount >= threshold", { amount, threshold })`
—— **沒有 JDM、沒有決策表、沒有 per-tenant 規則,表達式是寫死的字串常量**。
`ZenEngine` / `ZenDecision` 從未被 import。

規劃與落地之間沒有任何一步發出訊號:測試綠(它確實算對 `>=`)、
型別過、文件說「ZEN 整合」而程式碼裡確實 import 了 `@gorules/zen-engine`。
**「有 import 該套件」被當成了「有做到該規劃」。**

現況:相依已移除,`stepEnabled` 直接比較。R1「C ZEN 規則編輯器」(docs/04 v2.4,3 人月)
動工時再裝回,屆時 JDM 執行確實需要 `ZenEngine`。

### 4.5 前端（M3/M4）
- 按鈕:記錄頁動作列 + 清單欄;確認 dialog;執行結果 toast + audit。
- 送簽 + 狀態章（草稿/簽核中/已核准/已退回）+ 步驟進度;**我的待簽**佇列(承 workspace-ia 工作項目槽,OQ-WIA-5)。
- 設計器:表單設定掛按鈕(型別+映射)+ 簽核定義(步驟+簽核者角色+金額條件)。

---

## 7. 資料模型變動

### 7.2 SQL Migration
- **`0012_actions_approval.sql`**:`button_def` / `approval_def` / `approval_instance` / `approval_step_log` / `action_audit`;皆 tenant_id + RLS FORCE(記錄類)或 authz Tier-1 車道(定義類,同 view_def/authz 表 — 定義為 metadata,OQ-AA-5)。ZEN JDM 存 `approval_def.condition` 或獨立 `rule_def`。

### 7.3 RLS / Permission
- 執行按鈕 = 該動作對應權限（updateSelf→edit、pushTo→target create、送簽→approve 之前置或 edit)。簽核 = 該步角色成員 + `approve` 動作。定義（button/approval_def）= design/admin 權。
- 記錄鎖:pending instance → RecordService update 檢查鎖(拒非簽核流程之改)。

---

## 7-bis. 安全（擇要;完整見 [[rule_security_standards]] + docs/22）

| 面 | 緩解 |
|---|---|
| 按鈕動作任意執行（RCE/越權）| 動作為**封閉 allowlist**（updateSelf/pushTo/openUrl）+ config 確定性編譯（非 eval);每動作驗操作者權限 + tenant scope（docs/22 不變量:結構化 intent→確定性→人核准→audit）|
| 拋轉重複過帳 | 冪等 key（button+record+target / instance)→ 重試不重複建單（[[rule_coding_standards]] 冪等鐵則）|
| 簽核越權（非該步角色亦可簽）| approve 驗操作者為 current step 之 approverRole 成員（authz role 閉包）+ deny-by-default |
| 簽核中改記錄繞流程 | pending instance 記錄鎖(update 拒);解鎖僅 reject/withdraw |
| ~~ZEN 規則注入 / 逃逸~~ | ⚠️ **2026-08-04 更正:此列描述的緩解機制已不存在。** ZEN 於 2026-08-03 移除(§4.4 / OQ-AA-4:`package.json` 無相依,`approval.service.ts` 只剩一則說明註解)—— **沒有 JDM、沒有 QuickJS sandbox、沒有 50ms timeout**。現行金額條件是寫死的比較(`amountField` / `minAmount`),經 Zod 收斂,不接受任意運算式,故該風險面**已隨功能一起消失**;但讀這一列的人會以為系統裡有一個 sandbox 在守著,那是錯的 |
| openUrl SSRF/XSS | https 白名單 scheme;前端開新分頁 rel=noopener;不由後端 fetch |
| 簽核完自動執行失敗半過帳 | 收尾單一 tx + 冪等;失敗 rollback + 標記,不留半完成 |

Input validation：button/approval def config 全 Zod + `z.infer`;動作型別封閉列舉;金額條件 ZEN schema。

---

## 8. 測試策略

| 層級 | 覆蓋 | 位置 |
|---|---|---|
| Integration（api）| 按鈕 updateSelf/pushTo（權限 + 冪等 + audit + 跨租戶）;簽核送簽→approve 推進→完成觸發拋轉（單 tx）;reject 退回解鎖;越權簽拒;記錄鎖;ZEN 金額路由 | Testcontainers |
| e2e（Playwright）| 建按鈕→記錄頁執行→toast;掛簽核→送簽→簽核佇列→approve→狀態章→自動拋轉 | `actions-approval.spec.ts` |
| Unit | 動作 config 編譯 / ZEN 決策 / 步驟推進狀態機 | `*.test.ts` |

---

## 9. 落地順序與里程碑

| 里程碑 | 內容 | 狀態 |
|---|---|---|
| **M0** | 本檔 → APPROVED（OQ-AA-1..7 裁定,全採建議）| ✅ |
| **M1** | 後端：按鈕動作框架(`d346451`)| ✅ |
| **M2** | 後端：簽核 state machine + ZEN + 自動執行(`6c352aa`)| ✅ |
| **M3** | 前端：按鈕 + 送簽 + 簽核佇列(`a4d48cd`)| ✅ |
| **M4** | 前端：按鈕/簽核定義設計器(`ead550c`)| ✅ |
| **M5** | actions-approval.spec 固化 + FMEA + doc v1.0 + MODULES ✅(`56adb24`)| ✅ |

---

## 10. 開放問題（OQ-AA-N）— ✅ 已裁定 2026-07-25（全採建議 = 全 A）

> 全數採「建議」欄。進入 M1。

| # | 議題 | 選項 | 建議 = 裁定 |
|---|---|---|---|
| **OQ-AA-1** | 簽核流程引擎 | A. **DB 狀態機**（`approval_instance` pending step,由 approve 動作推進;無 DBOS）<br>B. DBOS durable workflow（掛起等人）| **A** — 簽核「等數天」是 pending DB 狀態非掛起函式,不需 durable execution;大幅降 M0 複雜度、零新 infra。DBOS 僅「簽核完連鎖多步過帳」等長副作用鏈才需 → P1。**證據**:docs/20 DBOS 用途列「長簽核」但那指 crash-resume 之自動鏈;人工簽核等待用狀態機更簡 |
| **OQ-AA-2** | 按鈕動作 P0 allowlist | A. **updateSelf + pushTo + openUrl**（零外部依賴)<br>B. 含 Email/SMS/更新他表/合併 | **A** — Email/SMS 依通知 infra(P0-4b 未建);更新他表/合併按鈕(一鍵多動作)= P1。updateSelf(更新本表)+ pushTo(資料拋轉)為 ERP 單據核心 + 零外部依賴。**證據**:docs/27 §4 按鈕 7 類;P0-4b 通知未建 |
| **OQ-AA-3** | 簽核路由模型 | A. **順序多步(階層)+ 金額條件(ZEN)**;會簽(全簽)/擇辦(任一)/加簽 P1<br>B. 全含並簽 | **A** — 階層順序簽 = Ragic/ERP 最常見 + 復用角色樹;並簽(parallel step 需全/任一判定 + 動態)複雜 → P1。**證據**:docs/27 §4 簽核框(階層/會簽擇辦/金額條件);階層為 80% 場景 |
| **OQ-AA-4** | 規則引擎 | A. ~~**裝 GoRules ZEN**~~<br>B. 自研簡易條件判斷 | 🔴 **2026-08-03 稽核後改判為「裝了但沒用起來,先移除」**。原裁定 A 的理由(docs/20 定 ADOPT ZEN:MIT、**決策表 no-code**、多租戶天然)**至今成立**,但 M2 落地時實際寫成的是 `evaluateExpressionSync("amount >= threshold", …)` —— **表達式是寫死的字串常量**,兩個運算元在前幾行已是驗證過的 `number`。全 API 唯一使用點。等於為一個 `>=` 背了 `@gorules/zen-engine` 與每平台 10MB 的原生二進位;原本的 `try/catch` fail-closed 也只是因為 ZEN 會 throw。**OQ-AA-4 承諾的「決策表 no-code」一項未兌現**,而那正是 docs/20 選它的理由。<br>**處置**:移除執行期相依,改直接比較;**`docs/04 v2.4` 列 R1「C ZEN 規則編輯器」3 人月動工時再裝回來**(編輯器產出的 JDM 確實需要 `ZenEngine`,而重新加相依是一行的事)。不為未來的能力先付原生相依的供應鏈與映像檔成本。 |
| **OQ-AA-5** | 定義表車道（button_def/approval_def）| A. **authz Tier-1 DRIZZLE 車道 + app tenant scope**（同 view_def;定義為 metadata)<br>B. RLS 車道 | **A** — 定義是 metadata（如 view_def/form_categories）;instance/log(記錄類)走 RLS 車道。一致既定模式。**證據**:view_def/authz 表既定 |
| **OQ-AA-6** | 記錄鎖粒度 | A. **簽核 pending → 整筆 update 拒**（僅簽核流程內動作可改)<br>B. 欄位級鎖 | **A** — 整筆鎖簡單 + 對齊 docs/22「已鎖不得過帳」;欄位級鎖(部分可改)複雜 → P1。**證據**:docs/22 傳票不可變原則 |
| **OQ-AA-7** | P0 範圍確認 | A. **採 §1.1 五項為 P0**(按鈕 3 動作 + 順序簽核 + 金額路由 + 簽核完自動執行 + ZEN);Email/SMS·並簽·durable·留言@提及·合併列印 → P1/後續<br>B. 縮小(如簽核完自動執行延後)| **A** — 覆蓋 Ragic 單據縱深核心(拋轉 + 階層簽);維持後續模組時程 band。若吃緊,「簽核完自動執行」為首選延後件(簽核仍可用,人工按拋轉鈕) |

---

## 12. 失效場景反思（FMEA）— M5 收尾（R17）;✅=已驗證緩解

| # | 場景 | 緩解 | Sev | 狀態 |
|---|---|---|---|---|
| A1 | 按鈕動作越權/任意執行 | 封閉 allowlist(updateSelf/pushTo/openUrl)+ config Zod 判別聯集確定性編譯(值來源 literal/field/variable,絕不 eval)+ design 建/edit 執行/pushTo 另驗 target `create` + tenant scope | P0 | ✅ buttons.integration:未知來源欄→400、非 https→400 |
| A2 | 拋轉/自動執行重複過帳 | 冪等 key 唯一索引(`btn:<id>:rec:<id>` / `approval:<id>:complete`);命中 → 回 duplicate 不重跑副作用 | P0 | ✅ buttons.integration 重跑 duplicate;簽核完成走 instance key |
| A3 | 簽核越權（非該步角色）| `decide` 驗 current step `approverRoleId` ∈ actor 角色閉包(`resolveActorRoleIds`);非成員 → 403 | P0 | ✅ 實作 + dev superadmin 例外明確 |
| A4 | 簽核中改記錄繞流程 | `ApprovalLockInterceptor` 全域攔 records PATCH/DELETE → 409;解鎖僅 reject/withdraw/完成 | P0 | ✅ approval.integration:鎖 409 + 退回後可改 |
| A5 | 簽核完自動執行失敗半過帳 | onComplete 按鈕以 instance 冪等 key 執行;RecordService 副作用本身單一 tx | P0 | ✅ **【2026-07-28 已清】** F-6 M5 改「**先執行副作用、成功才標 approved**」——跨車道(Tier-1 簽核狀態 vs app 車道記錄 DML)本就無法同一 tx;新序下按鈕失敗則實例維持 `pending` 可重按,冪等 key 保證不重複執行,不再有「已核准但未拋轉」之不可修復狀態 |
| A6 | ZEN 規則逃逸 / timeout | 表達式由結構化 config 確定性組出(`amount >= threshold`),值以 context 傳入不拼接;評估失敗 fail-closed(視為不啟用) | P1 | ✅ |
| A7 | openUrl SSRF/XSS | Zod refine 僅 https/相對路徑(擋 javascript:/data:);前端 `window.open(..., noopener,noreferrer)`;後端不 fetch | P1 | ✅ buttons.integration:javascript: → 400 |
| A8 | 簽核者離職/角色空 → 卡簽 | 送簽者本人或 admin 可 withdraw 解卡;admin 代簽/改路由 → P1 | P1 | ⚠️ 已知殘留:無「角色成員為空」之送簽前檢查(P1) |
| A9 | 跨租戶(button/approval def/instance 洩漏)| 全查詢 app 層 `where tenant_id`(authz Tier-1 車道,OQ-AA-5);form 級另有 PermissionGuard | P0 | ✅ buttons.integration 跨租戶斷言 |
| A10 | 部署順序:前端先於 0012 migration | migration 必先(R10;dev 已 migrate);缺表 → 按鈕/簽核查詢失敗即不渲染(RecordActions 空陣列降級)| P1 | ✅ |

> **檢查點**:P0(A1–A4、A9)全 ✅ → SHIPPED。~~A5 已知殘留~~ **2026-07-28 由 F-6 M5 清除**(改先副作用後定案);⚠️ A8(無空角色送簽檢查)仍殘留;並簽(會簽/擇辦)、Email/SMS 動作、更新他表/合併按鈕、留言@提及、DBOS durable 連鎖 皆 P1。

---

---

## 0-bis. 追溯稽核(2026-07-28)— **本模組原無證據段,事後補**

> **最重要的一句**|**parity 對象 Ragic 官方文件本身就有本檔列為 P1 的絕大多數功能**
> (會簽 / 擇辦 N-of-M、代理人簽核、三種加簽、動態簽核人)。**這不是「進階」,是基準線。**

### 七個既有決定的裁決

| # | 決定 | 裁決 | 依據 |
|---|---|---|---|
| 1 | 不用 durable execution | ✅ **維持** | **Odoo 自 v11 移除 workflow engine**,改 state field + button 觸發(官方 forum);Temporal 官方 blog 主張的價值全在 durable timer / SLA / 自動 escalation / 跨系統 exactly-once,**並未反駁「純人工等待用 DB 狀態機」**。⚠️ 但一旦做逾期提醒即需 scheduler —— BullMQ repeatable job 即可,仍不需 Temporal |
| 2 | 按鈕動作只有 updateSelf + pushTo | ✅ **維持** | 無反證;通知模組已 SHIPPED,原「Email/SMS 依通知 infra」之缺口自然癒合 |
| 3 | 階層順序簽 / 並簽排 P1 | 🔴 **應改(兩處)** | (a) **簽核者只能是靜態 `approverRoleId`**,沒有「直屬主管 / 直屬主管的主管 / 前一簽核人的主管」動態解析 —— **Ragic 官方三者皆原生**。沒有它這不是「階層簽」而是「靜態多關角色簽」,行政人員得為每個部門建一組 role + 一份 approval_def,**維護不了**。(b) 會簽/擇辦在 Power Automate 是**兩個一級 action**(everyone must approve / first to respond),Ragic 有「會簽/擇辦人數/單人指定」,Odoo 有 minimum approvers。食品廠「品保 + 生產雙簽」是典型場景 |
| 4 | ZEN 決策表 | ✅ **維持,但價值未兌現** | DMN 界共識:決策表可由 business 自行維護,BPMN gateway 需 BA;GoRules 官方明列 approval workflows 為 JDM 用例。⚠️ **但目前 condition 只由程式結構化組出**,**沒把決策表 UI 曝露給管理員** —— ZEN 的價值(非工程師自己改規則)尚未兌現,等於付了依賴成本沒拿到報酬 |
| 5 | 定義 metadata / instance RLS | ✅ **維持** | 與 view_def 一致,無反證 |
| 6 | 整筆鎖 | ⚠️ **應調整** | 鎖本身正確 —— **Salesforce 提交即自動鎖定整筆**,是業界慣例。但 Salesforce 同時給**三條逃生路徑**:admin 永遠可編輯、allowed users 白名單、Unlock action。本專案只有 withdraw,**簽核人離職會導致記錄永久鎖死** |
| 7 | 「簽核完自動執行」為首選延後件 | ⚠️ **優先序錯** | 它已做完,但排在代理簽核 / 會簽之前是錯的 —— 前者是便利,後者是**流程卡死** |

### 🔴 漏掉的必備語意(依優先序)

**P0(上線即會痛)** → 已立 [task #103]

1. **代理簽核 / 職務代理人**|Salesforce 有標準 `Delegated Approver` 欄位;SAP 分計畫/非計畫代理 + 起訖日;Ragic 使用者表單有「啟用及通知代理人」。**台灣企業職務代理人是內控慣例**。缺 → 經理請假整條線卡死,唯一解是 admin withdraw 重送
2. **動態簽核人解析**(直屬主管 / 上上層 / 前一簽核人的主管)—— 與 1 是同一組修補
3. **逾期提醒 + 升級**|SAP S/4 2020+ Deadline Monitoring 為標配。**但不要做「逾期自動核准」** —— SOX 內控文獻一致主張升級到主管或備援簽核人,而非自動放行
4. **禁止自簽(self-approval)**|SOX checkpoint 明列「financial transactions 不得自簽」。目前 `decide()` 只驗角色成員,**送簽者若在該角色內即可核准自己的單**。**最便宜的高價值修補**
5. **駁回強制填理由**|目前 `comment` 為 optional。退回重工與稽核都需要
6. **送簽前空簽核者防呆**(既有 FMEA A8 殘留)

**P1** → 已立 [task #104]。**其中「代理簽核」已於 2026-08-01 交付**(見 §13 v1.2);
其餘 7–11 仍為殘留,尚未實作。

7. **會簽 / 擇辦(N-of-M)**|實務上「全部同意」用於責任分擔(品保+生產),「任一同意」用於加速與代理,**兩者都常用**
8. **加簽 / 轉簽**|Ragic 三型:向前(前一關加人並暫停自己)/ 臨時(同關)/ 向後(下一關);Power Automate 的 Reassign 是一級按鈕
9. **退回到指定關**|Salesforce 每個 step 可選 reject behavior:「終審駁回」vs「只退這關」。目前只有終審駁回 + 重送從頭 —— **這是 SAP/ServiceNow 的合法預設**(ServiceNow 社群甚至偏好 cancel-and-resubmit,理由是複雜度低、指標乾淨),**可維持但需列為已知取捨並補「重送時帶回原值」**
10. **鎖定逃生路徑**|allowed-users 白名單 / admin 強制解鎖 / 改派簽核人
11. **簽核歷史 append-only 強制**|**21 CFR Part 11 要求 audit trail「不得遮蔽先前記錄」且「連系統管理員都不應能改」**;食品廠 ISO 22000 / HACCP 稽核同源。目前只是「不去改」,**沒有機制保證**

> **已實作但本檔原未列**|撤回(withdraw)✅ 對應 Salesforce Recall,無需補。

### 資料模型

`approval_def` + `approval_instance` + `approval_step_log` **就是公認形狀** ——
「mutable summary 供畫面 + append-only event log 為真相」。**不需要事件溯源**;但 log 必須真 append-only(見 P1-11)。
⚠️ 並發雙簽:`decide()` 先讀後寫有 race window,應改**條件式 UPDATE**(`WHERE status='pending' AND current_step=N`)或唯一約束。

### 來源

- [Ragic 設定簽核(官方)](https://www.ragic.com/intl/zh-TW/doc/15/approval-flow-configuration) · [Ragic 使用簽核流程(官方)](https://www.ragic.com/intl/zh-TW/doc-user/13/approval-flow)
- [Salesforce: Record Locking in Approval Processes](https://help.salesforce.com/s/articleView?id=platform.automate_automated_approvals_concept_record_locking.htm) · [Withdraw/Recall Approval Request](https://help.salesforce.com/s/articleView?id=sf.approvals_users_recall.htm) · [Delegated Approver(社群)](https://patrik-js.medium.com/setting-a-delegated-approver-in-salesforce-356702b201f)
- [Power Automate: Get started with approvals](https://learn.microsoft.com/en-us/power-automate/get-started-approvals)
- [Odoo 18 Studio Approval rules](https://www.odoo.com/documentation/18.0/applications/studio/approval_rules.html) · [Odoo: exec_workflow removed in v11/v12(官方 forum)](https://www.odoo.com/forum/help-1/migration-from-odoo-8-to-odoo-12-removed-functionality-exec-workflow-162368)
- [SAP Flexible Workflow 代理 / forwarding / deadline(社群)](https://community.sap.com/t5/enterprise-resource-planning-q-a/workflow-delegation-when-the-normal-recipient-is-not-available/qaq-p/12374500)
- [Temporal: Human-in-the-Loop Approval Workflows](https://temporal.io/blog/human-in-the-loop-approvals)
- [ServiceNow: 駁回後重送策略(社群)](https://www.servicenow.com/community/developer-forum/restart-approval-workflow-after-rejection/td-p/3310744)
- [Camunda DMN vs BPMN gateway](https://camunda.com/dmn/) · [GoRules ZEN JDM](https://docs.gorules.io/reference/json-decision-model-jdm)
- [SOX approval flow checkpoints](https://ocd-tech.com/sox/how-to-make-your-approval-flows-comply-with-sox-audit-checkpoints) · [21 CFR Part 11](https://www.ecfr.gov/current/title-21/chapter-I/subchapter-A/part-11)

## 13. 變更紀錄

| 日期 | 版本 | 變更 | 作者 |
|---|---|---|---|
| 2026-08-01 | v1.2 | **#104 簽核代理人 SHIPPED**(P1 第 1 項;7–11 仍為殘留)。`approval_delegate`(起訖 + 不得代理自己 CHECK + RLS FORCE)+ `approval_step_log.on_behalf_of_actor_id`(**非 NULL = 代理行為**,稽核答得出「為什麼是他批的」)。`approverOf()` **先看本人再看代理**,親自核准不誤記為代理;時間窗用 **DB `now()`** 非應用層時鐘。自助設定(本人設自己的代理)+ admin 可代設(SAP 非計畫性代理);**代理人不得自行解除**。**待簽匣與待簽通知一併納入代理來源** —— 少了這段是「簽得了但找不到」的半殘。順帶修**既有缺陷**:`PATCH /api/settings/me` 對無角色使用者回 403(PermissionGuard「無 formId 的寫入需 admin」誤傷自助端點),新增 `@SelfService()` 標記並限定只在無 formId 時放行。api 26 approval + 10 guard + web 2 e2e 綠 | Claude Code |
| 2026-07-25 | v1.0 | **M1–M5 SHIPPED**。M1 按鈕動作框架(0012:button_def/action_audit/approval_*;封閉 allowlist + 確定性編譯 + 權限 gate + 冪等 + audit)。M2 簽核狀態機(送簽/推進/退回/撤回 + 人核准 gate 角色閉包 + ZEN 金額路由 + 完成觸發按鈕 + ApprovalLockInterceptor 記錄鎖)。M3 記錄頁動作區 + 待簽佇列。M4 設計器動作/簽核雙頁籤。M5 spec 固化。FMEA A1–A4/A9 P0 全 ✅(A5/A8 殘留明列)。api 250 + web 19 e2e 綠 | Claude Code |
| 2026-07-25 | v0.2 | **OQ-AA-1..7 全裁定(全採建議=全 A);DRAFT → APPROVED,進 M1**。定調:簽核 DB 狀態機(無 DBOS)、三動作 allowlist、順序階層 + ZEN 金額路由、定義走 authz Tier-1 車道、整筆記錄鎖 | Claude Code |
| 2026-07-25 | v0.1 | 初版 DRAFT — docs/27 §6 後續-1:自訂按鈕動作框架(updateSelf/pushTo/openUrl)+ 簽核 state machine(階層 + ZEN 金額路由 + 人核准 gate + 自動執行)。核心洞見:簽核=DB 狀態機不需 DBOS、ZEN 只算路由、動作走 docs/22 不變量。裝 GoRules ZEN;DBOS/並簽/通知動作/留言 P1。OQ-AA-1..7 待裁定 | Claude Code |
