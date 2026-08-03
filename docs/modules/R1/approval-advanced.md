# approval-advanced.md — [R1·後續-1b] 簽核進階語意(動態簽核人 / 會簽擇辦 / 加簽 / 退回 / 不可竄改)

| | |
|---|---|
| 狀態 | ✅ **SHIPPED v1.0(2026-08-03;M1–M7 + FMEA A1–A12)** |
| 建立 | 2026-08-03 |
| 上游 | [actions-approval.md](actions-approval.md) §0-bis 之 P1 第 7–11 項(task #104);代理簽核已於 2026-08-01 交付 |
| 為什麼獨立成檔 | 六個子項**各自改動簽核狀態機的語意**(誰是簽核人 / 一關算不算過 / 關卡集合可否在執行期變動 / 往回走 / 紀錄可否被改)。這不是加功能,是動地基 —— 混進既有模組的 changelog 會讓「當初為什麼這樣設計」查不回來 |

---

## 0. 現況(對碼查證,2026-08-03)

**不是從文件推的,是逐一打開檔案確認的。**

| 面向 | 現況 | 出處 |
|---|---|---|
| 簽核人 | **一關一個靜態角色**:`approvalStepSchema = { stepNo, approverRoleId, amountField?, minAmount? }` | `actions/action-specs.ts` |
| 一關算不算過 | 單人決定即推進,無 N-of-M 概念 | `approval.service.ts` |
| 進行中的狀態 | `approval_instance`:`currentStep` / `status` / `submittedBy` —— **單軌** | `db/schema.ts` |
| 紀錄 | `approval_step_log`。⚠️ **M0 初稿此處寫錯**:§0-bis 說「只是不去改、沒有機制保證」,而 **migration 0021 早就做完防護層** —— `no_mutate`/`no_truncate` trigger(`ENABLE ALWAYS`,故 replica 模式也不跳過)+ REVOKE UPDATE/DELETE/TRUNCATE + event trigger 擋 DROP。0021 自己誠實寫著擋不住 superuser,並把「hash chain 偵測層」列為後續 | `drizzle/0021` |
| 退回 | 只有終審駁回 + 重送從頭 | §0-bis 第 9 項 |
| 代理人 | ✅ 已交付(`approval_delegate` + `on_behalf_of` + 待簽匣納入 + 不遞移) | v1.2 |

### 🔴 0.1 最關鍵的架構事實:**本專案沒有「主管」這個關係**

全庫 grep `managerActorId` / `manager_id` / `parentRoleId` —— **零命中**。
現有的唯一組織結構是 **role tree**:`roles.parentId`(自我參照)+ `roles.depth` + `role_members`(actor ↔ role),
它目前的用途是**權限繼承**(authz-resource-inheritance)。

這件事直接決定 OQ-AP2-1:要嘛從 role tree 推導主管,要嘛新增第二份組織關係。
**兩份組織結構會分岔** —— 這不是理論風險,是「權限樹改了、簽核流沒跟著改」這種日常。

---

## 1. 競品證據(一手查證,2026-08-03)

> 逐字引用原文。凡標「查不到」者為真的查不到,不以推測填空 ——
> 「文件沒提到」與「官方明說不做」對決策的意義完全不同,故分開標注。

### 1.1 動態簽核人:組織關係存在哪裡

**沒有一家用獨立組織樹,全部掛在使用者物件上。**

- **Ragic**(最直接對標,官方繁中逐字):
  > 「選擇**直屬主管**的話,系統就會送簽給發起簽核的使用者的直屬主管;選擇**直屬主管的主管**,簽核對象就會是該名使用者主管的主管;選擇**前一簽核人的主管**,簽核對象就會是前一名簽核者的主管。」
  > 「(直屬主管及直屬主管的主管簽核功能,會需要搭配**系統使用者表單的直屬主管欄位**。若您的表單中沒有此欄位,請聯絡 Ragic support 協助更新系統表單)」
  > —— [Ragic 設定簽核](https://www.ragic.com/intl/zh-TW/doc/15/approval-flow-configuration)(官方)
- **Salesforce**:`ApprovalStepApprover` 型別為**封閉列舉** `adhoc` / `user` / `userHierarchyField` / `relatedUserField`;`userHierarchyField` 搭配 `nextAutomatedApprover`,可選「從記錄擁有者的階層而非送簽者的階層開始」—— [Metadata API](https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/meta_approvalprocess.htm)(官方)
- **SAP S/4HANA Flexible Workflow**:recipient role 提供 Manager of Workflow Initiator / of Initiator's Manager / of Last Approver —— [SAP Community(SAP 作者)](https://community.sap.com/t5/enterprise-resource-planning-blog-posts-by-sap/using-the-agent-determination-manager-of-approver/ba-p/12839688)。help.sap.com 原文**查不到**

**→ Ragic 的三種解析(直屬主管 / 主管的主管 / 前一簽核人的主管)是 parity 基準線,不是進階功能。**

### 1.2 🔴 解析失敗:業界一致是「硬失敗」,沒有人做 fallback

- **Salesforce 直接擋住並報錯**:「This approval request requires the next approver to be determined by the *Field Name* field. This value is empty.」
  且該錯誤「can occur when someone submits a record for approval **or when an approver responds to an approval request**」;觸發條件是「the field has no value **or specifies an inactive user**」
  —— [sfdc techie](https://sfdctechie.wordpress.com/2017/11/04/what-does-this-approvals-error-mean/)(第三方逐字轉錄;官方頁 JS 渲染抓不到原文,**證據強度中等**)
  **兩個要點**:(a) **離職與空值同等對待**;(b) **流程跑到一半才炸**,不是送簽當下。
- **SAP**:解析不到 → work item 進 "No agent found",需管理員以 SWI1_RULE 重跑 —— [SAP Community](https://community.sap.com/t5/technology-q-a/workflow-stuck-due-to-no-agent-found/qaq-p/10386464)(社群)
- **「主管就是申請人自己」**:ServiceNow **無內建防護**,社群做法是自寫 business rule —— [ServiceNow Community](https://www.servicenow.com/community/developer-forum/auto-approve-when-the-requestor-is-same-as-approver/m-p/1563556)(社群)。
  唯一有官方開關的是 **Odoo Studio Exclusive Approval**:「Enable Exclusive Approval on any step so that a user who approves a step **cannot approve another step for the same record**.」
  —— [Odoo 19 Studio](https://www.odoo.com/documentation/19.0/applications/studio/approval_rules.html)(官方)。但它解的是「同一人簽兩關」,**不是**「主管=申請人」。
- **自動往上跳一層 / 改送代理人 / 轉租戶預設簽核人這類 fallback:五家全部查不到。**

**→ 這是一個「沒有前例可抄、但也沒有前例反對」的位置。要做就得自己定義並承擔。**

### 1.3 N-of-M:過半數是少數派能力

| 系統 | 支援度 | 逐字 |
|---|---|---|
| **JSM** | 最精確,**三種** | `approval.condition.type`:「**number** - when a specific number of people should approve … **percent** - when a percentage of people should approve … **numberPerPrincipal** - when a specific number of people **from each group** should approve」—— [Atlassian KB](https://support.atlassian.com/jira/kb/jira-service-management-cloud-approval-workflow-properties/)(官方)|
| **Ragic** | 會簽 / 擇辦 | 「會簽:群組中所有人都同意才簽過。擇辦:群組中部分人同意就簽過。」設定為「點擊圖示旁的 All 來設定擇辦人數」,且「**若將擇辦人數清空,則等同於會簽(All)**」—— [Ragic](https://www.ragic.com/intl/zh-TW/doc/15/approval-flow-configuration)(官方)|
| **ServiceNow** | Anyone / All / % / # | 官方頁 JS 渲染**抓不到原文**,來源為社群整理,**證據強度中等** |
| **Camunda** | 任意 quorum | `numberOfCompletedInstances / numberOfInstances >= 0.5` —— [Multi-instance](https://docs.camunda.io/docs/components/modeler/bpmn/multi-instance/)(官方)|
| **Salesforce** | **官方明說只有兩種** | `Unanimous`(預設)「**If any of the approvers reject the request, the approval request for this step is rejected.**」/ `FirstResponse`「Approve or reject based on the first response.」**封閉列舉,無百分比無計數** —— [Metadata API](https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/meta_approvalprocess.htm)(官方)|

**🔴 Ragic 的資料模型設計值得直接抄**:「擇辦人數清空 = 會簽」——
**All 是 N 的退化值,不是獨立模式**。一個欄位表達兩件事,少一個永遠可能矛盾的 enum。

**有人拒絕時等不等**:Power Automate 講得最白 ——
「The actions that follow the **Start and wait for an approval** action run after *all* the approvers respond, **or when a single rejection occurs**.」
(即**立刻整單否決,不等**)—— [Microsoft Learn](https://learn.microsoft.com/en-us/power-automate/get-started-approvals)(官方)。
Salesforce 同。**Ragic 會簽遇拒絕的處理:官方明文查不到。**

### 1.4 加簽:Ragic 是唯一把「方向」做成一級概念的

> 「**簽核人**在簽核表單時也可以加簽其他成員。只要點擊在簽核欄最右側的 **+** 按鈕就可以選擇加簽的方式。」
> - 向前加簽:「在目前簽核的前一階增加新的簽核人,**並且暫停你目前的簽核動作**。」
> - 臨時加簽:「在目前簽核的同一階增加新的簽核人。」
> - 向後加簽:「在目前簽核的後一階增加新的簽核人。」
>
> —— [Ragic 使用簽核流程](https://www.ragic.com/intl/zh-TW/doc-user/13/approval-flow)(官方)

三種各自對應不同的狀態機操作,而且**「向前加簽會暫停目前簽核動作」直接回答了「簽完回到哪」—— 回到原關**。

- **Power Automate** 有官方 Reassign;實作語意由第三方拆解:「The 'Reassign' button **makes a new row, and marks the old one as delegated**.」
  —— [Matthew Devaney](https://www.matthewdevaney.com/reassign-an-approval-in-power-automate/)(第三方)。
  **與我方已交付的 `on_behalf_of` 同源**:新列 + 舊列標記,而非改寫舊列。
- **Salesforce**:只有 `allowDelegate` 與**設計期**的 `adhoc` approver;執行中插入關卡在 metadata 模型裡**不存在**(封閉列舉,強證據)。
- **⚠️ 刻意不做的訊號**:ServiceNow 無官方 ad-hoc 加簽,社群結論需 scripting,並直言
  「**approvals aren't really designed to be added manually in this way**」—— 手動加的 approval 不會正確反應 rejection
  —— [ServiceNow Community](https://www.servicenow.com/community/developer-forum/adhoc-approvals-for-change-requests/m-p/2751524)(社群)。
  **這是「動態插入關卡會破壞狀態機一致性」的實務警告,直接寫進本模組的風險欄。**
- 「加簽導致稽核軌跡難讀」:**查不到任何官方或第三方論述**。

### 1.5 退回:兩端很清楚

- **Salesforce 只給退一關**(封閉列舉):`RejectRequest`「Rejects the request even if previous steps were approved.」/
  `BackToPrevious`「Rejects the request, and **returns the approval request to the previous approver**.」—— 官方 Metadata API
- **Kissflow 是這題的完整答案**:
  「Send back allows the assignee to send an in progress item back to a previous step in the workflow.」
  可限制目標:「You can limit the number of preceding steps … **When you disable this option, items can be sent to all preceding steps.**」
  —— [Kissflow](https://community.kissflow.com/t/g9h9qt6/configuring-actions-for-process-steps)(官方社群文件)
- **退回後指派給誰,Kissflow 明確二選一**(這正是「歷史簽核人 vs 重新解析」的分岔):
  「it will be assigned **only to the user who previously approved it at that step**」vs
  「it will be assigned to **all users and groups originally set as assignees for the step**」
  —— [Send back actions](https://community.kissflow.com/t/h7ylt39/send-back-actions)(官方社群文件)
- **🔴 已簽過的關要不要重簽:預設是全部重簽,而且沒有人做得更好。**
  Kissflow 自己承認這是痛點:「when proposals are sent back for revisions, **they must go through all the approval steps again, causing unnecessary redundancy**」,
  官方給的解法只是「在特定關加條件跳過」—— [Kissflow](https://kissflow.com/workflow/how-to-automate-document-management-workflows/)(官方)。
  **沒有任何一家提供「保留已簽結果、只重簽受影響關卡」的內建語意。**
- **Camunda 刻意不把退回放進 BPMN 語彙**:唯一路徑是 process instance modification
  (`cancelActivityInstance(...).startTransition(...)`)—— [Camunda Forum](https://forum.camunda.io/t/go-back-to-previous-user-task/29485)(官方論壇)。
  意涵:**退回被視為流程實例的例外操作,不是流程模型的一部分。**
- **Ragic 是否支援退回指定關:官方文件查不到。**

### 1.6 🔴 append-only:查遍六家,沒有一家在簽核紀錄上做 hash chain

- **Salesforce** 靠「物件宣告為 read-only」在 API 層封死:`ProcessInstanceHistory` 是
  「a read-only object which shows all steps and pending approval requests associated with an approval process」,
  且「neither searchable nor queryable」—— 官方頁 JS 渲染抓不到,逐字取自 [riptutorial](https://riptutorial.com/salesforce/example/21989/processinstancehistory-)(第三方,**證據強度中等**)。
  **強制力來自平台沒開 DML 入口,不是資料庫層。**
- **ServiceNow**:`sysapproval_approver` 就是一張一般表,靠 ACL + sys_audit,**無不可竄改機制**
- **🔴 Odoo 有真正的 hash chain,但用在會計分錄不是簽核,而且是稅務機關逼出來的**:
  「Tax authorities in some countries require companies to prove their posted accounting entries are inalterable」;
  做法是「Odoo can use the SHA-256 algorithm to create a unique fingerprint for each posted entry, called a hash」,
  串鏈方式是「**The previous entry's hash is always added to the next entry to form a hash chain. This is used to ensure a new entry is not added afterward between two posted entries, as doing so would break the hash chain.**」
  —— [Odoo 18 資料不可竄改檢查報告](https://www.odoo.com/documentation/18.0/applications/finance/accounting/reporting/data_inalterability.html)(官方)。
  **這是唯一可借用的 OSS 先例,而且它同時提供「檢查報告」讓稽核者自行驗證鏈有沒有斷 —— 不只寫入端防護,還有讀取端證明。**
- SAP / Power Automate / Ragic / Kissflow 是否對簽核 log 做技術性防竄改:**全部查不到**(屬「文件沒提到」)。

**我方已有的先例**:F-8 的 `tenant_usage_daily` —— **app 車道只授 SELECT**,
append-only 由**權限**保證而非自律,整合測以 `SET ROLE weyver_app` 斷言 UPDATE/DELETE 皆 permission denied。
這比 Salesforce 的「平台沒開入口」更硬,因為它在 DB 層。

---

## 2. 範圍

### 2.1 做

七項,對應 §0-bis 第 7–11 項與實作期發現的兩個缺陷:

1. 動態簽核人解析(直屬主管 / 主管的主管 / 前一簽核人的主管)
2. 會簽 / 擇辦(N-of-M)
3. 加簽(方向三分法)/ 轉簽
4. 退回到指定關
5. 簽核紀錄 append-only 之**機制性**保證
6. 鎖定逃生路徑(§0-bis 第 10 項)
7. `decide()` 的先讀後寫 race → 條件式 UPDATE(§0-bis 資料模型節已點名)

### 2.2 不做,並說明為什麼

- **逾期提醒 / 升級**|已於 P0 批次(#103)處理,不重複。
- **BPMN / 流程圖編輯器**|本模組維持 DB 狀態機。Camunda 的證據反而支持這個選擇:
  連 BPMN 都把「退回」排除在流程模型之外,當成實例的例外操作。
- **「保留已簽結果、只重簽受影響關卡」**|§1.5 已查證**業界無人做**。
  它需要「哪些關卡受這次修改影響」的判定,而那需要欄位級的變更影響分析 —— 規模等同另一個模組。
- **簽核流程的視覺化編輯器**|ZEN 決策表 UI 未曝露(§0-bis 第 4 項)是另一條殘留,不混進來。

---

## 3. 開放問題(OQ-AP2-N)— ✅ **已裁定 2026-08-03(全採建議)**

| # | 議題 | 選項 | 建議 |
|---|---|---|---|
| **OQ-AP2-1** ⭐⭐ | **「主管」關係從哪來** | A. **由 role tree 推導**(申請人的角色 → `parentId` → 該父角色的成員即為主管)<br>B. **新增 `actors.manager_actor_id`**(Salesforce / Ragic 形態)<br>C. 兩者並存,B 優先 A 兜底 | **A** —— 我方已有 role tree 且它**已經是權限繼承的真實來源**;B 會製造**第二份組織結構**,而兩份組織結構必然分岔(「權限樹改了、簽核流沒跟著改」是日常不是意外)。代價誠實列出:A 的「主管」是**一組人**不是一個人,故 OQ-AP2-3 的 N-of-M 變成必需品而非選配;且 Ragic 客戶遷移時他們的「直屬主管欄位」要映射成角色關係。**若決策方認為客戶心智就是「一個主管」,則選 B** —— 這一題是產品心智問題,不純是技術問題 |
| **OQ-AP2-2** ⭐⭐ | **解析失敗怎麼辦**(沒設主管 / 主管離職 / 主管就是申請人) | A. **硬失敗,且在送簽當下就擋**<br>B. 硬失敗,但跑到那一關才炸(Salesforce 現況)<br>C. fallback 鏈(往上跳一層 → 租戶預設簽核人 → admin) | **A** —— 業界一致硬失敗(§1.2),**沒有人做 fallback**,故 C 是無前例可抄也無前例反對的自創,風險由我方獨吞。但 **B 是明確的反面教材**:Salesforce 會在「簽核人回應時」才炸,那時單子已經走到一半、申請人早就以為送出去了。**送簽當下就解析全部關卡並擋下**,代價是「送簽後才離職」仍會卡住 → 由 OQ-AP2-9 的逃生路徑接手。**「主管=申請人」比照 Odoo Exclusive Approval 明確擋下**,不靜默跳關 |
| **OQ-AP2-3** ⭐ | **N-of-M 的資料模型** | A. **`quorum: number \| null`,null = 全體同意**(Ragic 形態)<br>B. `mode: 'all' \| 'any' \| 'quorum'` + `quorum?`<br>C. 加上 JSM 的 `numberPerPrincipal`(每群組各 N 人) | **A** —— Ragic 官方逐字「若將擇辦人數清空,則等同於會簽(All)」:**All 是 N 的退化值**。B 的 enum 與數字永遠可能矛盾(`mode:'all'` 卻帶 `quorum:2` 要信哪個),A 結構上不可能矛盾。C 暫不做:JSM 有它是因為它的簽核人可以是多個 group picker,我方一關一個角色,沒有「每群組」可言 |
| **OQ-AP2-4** | **會簽關卡有人拒絕** | A. **立刻整單否決,不等其他人**<br>B. 等全部回應完再結算 | **A** —— Power Automate 與 Salesforce 官方皆明文如此(§1.3 逐字)。B 會讓已經確定不會過的單子繼續佔著其他人的待簽匣 |
| **OQ-AP2-5** ⭐ | **加簽做幾種** | A. **三種全做**(向前 / 臨時 / 向後,對齊 Ragic)<br>B. 只做「臨時加簽」(同關加人)<br>C. 只做轉簽,不做加簽 | **B 起步,A 為目標** —— 三種之中**只有「臨時加簽」不改變關卡集合**(它只是擴充該關的 N-of-M 成員,而 OQ-AP2-3 已經把那個結構做出來了),因此**幾乎零額外狀態機風險**。向前 / 向後加簽會在執行期插入關卡,正是 ServiceNow 社群警告「approvals aren't really designed to be added manually in this way」的那件事。**建議 B 先出、A 列本模組 P1**,並在 doc 明記「Ragic 有三種,我們先做一種」以免日後誤以為已 parity |
| **OQ-AP2-6** | **退回目標** | A. **只退一關**(Salesforce `BackToPrevious`)<br>B. **可退任意先前關卡,並可逐關設定白名單**(Kissflow)<br>C. 只退回申請人(現況) | **B** —— A 對多關流程不夠用(第 4 關發現第 1 關填錯,退一關給第 3 關的人毫無意義);Kissflow 的「可限制範圍」讓嚴謹流程仍能收斂。誠實代價:B 的狀態轉移比 A 多,測試面較大 |
| **OQ-AP2-7** | **退回後那一關指派給誰** | A. **原本簽過的那個人**<br>B. **該關原始指派集合(重新解析)**<br>C. 逐關可設 | **B** —— A 在「原簽核人已離職」時直接卡死,而那正是我們要避免的形態;B 與 OQ-AP2-1 的動態解析同源,語意一致。Kissflow 兩者都給(§1.5 逐字),故 **C 是有前例的**,但先不做 —— 多一個設定要多一份說明,而 B 涵蓋絕大多數情況 |
| **OQ-AP2-8** | **退回後已簽關卡要不要重簽** | A. **全部重簽**<br>B. 保留已簽結果,只重簽受影響關卡 | **A** —— §1.5 查證**業界無人做 B**,連 Kissflow 都只能承認這是痛點。B 需要「哪些關卡受這次修改影響」的判定,那是欄位級變更影響分析,規模等同另一個模組。**A 要在 UI 上講清楚**(退回時明示「重新送出後需重跑全部關卡」),不能讓人以為只補簽一關 |
| **OQ-AP2-9** ⭐⭐ | **append-only 怎麼強制**(⚠️ 選項 A 經查證**早已完成**於 0021,本題實質只在問要不要加 B 的偵測層)| A. ~~DB 層防護~~(**已完成**)<br>B. **A + Odoo 式 hash chain + 鏈完整性檢查報告**<br>C. 維持現況 | **B** —— A 是我方已驗證的先例(F-8 `tenant_usage_daily`,整合測以真 `weyver_app` 角色斷言 UPDATE/DELETE permission denied),**比 Salesforce 的「平台沒開入口」更硬**,且成本只有一段 grant。但 A 擋不住**握有特權連線的人**,而 21 CFR Part 11 要求「連系統管理員都不應能改」(§0-bis 第 11 項)。Odoo 的 hash chain 是唯一可借用的 OSS 先例,**且它附了檢查報告 —— 讀取端能自行證明鏈沒斷,這對食品廠 ISO 22000 稽核正是被問到的東西**。若決策方認為 R1 不需要到 Part 11 等級,則**退為 A**,並把 B 列為觸發條件明確的後續(第一個要求 Part 11 的客戶) |
| **OQ-AP2-10** | **鎖定逃生路徑** | A. **三條全做**(admin 強制解鎖 / allowed-users 白名單 / 改派簽核人)<br>B. 只做 admin 強制解鎖 | **A** —— Salesforce 三條都有(§0-bis 第 6 項),而我方目前**只有 withdraw**,簽核人離職會導致記錄永久鎖死。三條各解不同情境:解鎖給緊急修改、白名單給常態例外、改派給人事異動。**每一條都必須進 `approval_step_log`** —— 逃生路徑不留痕就是內控破口 |
| ~~OQ-AP2-11~~ | ~~`decide()` 的先讀後寫 race~~ | — | ⚠️ **已無此問題,M0 初稿依據的 §0-bis 記載是舊的**。對碼確認 `updateInstance(…, expect: { status, currentStep })` 已是條件式 UPDATE,0 列即 `raceLost()`,且 `approval.integration` 已有「併發雙簽只有一個贏」的測試。**本題撤銷,不列入里程碑** |

---

## 3-bis. 🔴 OQ-AP2-9|Ragic 直屬主管欄 → 我方簽核人的遷移轉換(2026-08-03 新增)

> **起因**|稽核(`_audit/giants-shoulders-audit-B.md`)指出 OQ-AP2-1 只問了「組織關係**存在哪**」,
> 沒問「**遷移時 Ragic 的那一欄要落到哪**」。而首波 pilot 是既有 Ragic 用戶,
> 這一題不設計會在現場才浮現。

### 3-bis.1 為什麼不是換個名字就好

| | Ragic | 我方現況 |
|---|---|---|
| 「主管」是什麼 | **指到一個人**(使用者欄位 / 帳號屬性) | `approverRule: "manager"` = **申請人所屬角色的父角色之全體成員**(`managersOf` 遞迴 CTE) |
| 基數 | 1 | **N**(父角色可能有多人) |
| 關係來源 | 每個人各自指定,可指到任何人 | 角色樹的 `parent_id`,受樹的形狀約束 |

**一個人 vs 一組人不是同構**,所以沒有一對一映射。
更麻煩的是第三列:Ragic 的直屬主管**可以指到組織樹以外的人**(專案負責人、代理窗口),
而角色樹的父子關係表達不了那種指向。

🔴 **另一個對碼才發現的前置問題**|`#22` 複核確認**前端沒有任何入口能建立或調整角色階層**
(`createRole` 恆傳 `parentId: null`)。也就是說**選項 A 的遷移只能靠 API 寫入**,
而客戶事後想調整主管關係時,**在畫面上找不到地方調** —— 那會直接撞第一約束。

### 3-bis.2 選項

| # | 做法 | 代價 |
|---|---|---|
| **A** | 遷移時**自動生成角色樹**:每位主管一個角色,其下屬為子角色成員 | 30 人的租戶可能生出 20+ 個機器命名的角色,汙染權限畫面;且指到組織外的主管表達不了;**客戶事後無法自助調整**(前端無入口) |
| **B** | 新增 `actors.manager_actor_id`(即 OQ-AP2-1 的選項 B)| 製造**第二份組織結構**,而 OQ-AP2-1 當初正是為了避免這個才選 A;兩份必然分岔 |
| **C** ⭐ | **新增 `approverRule: "fieldRef"`** —— 簽核人 = **這筆記錄上某個 member 欄位**所指的人(遷移時該欄就是 Ragic 原本的「主管」欄) | 需要在 step 上多存一個欄位名;需防自我簽核與欄位被刪 |

### 3-bis.3 建議:**C**,理由與代價

1. **它是唯一忠實的映射。** Ragic 的主管本來就住在**表單的欄位裡**,
   C 讓它**原地留在欄位裡**,不必翻譯成組織結構 —— 遷移轉換退化成「指定是哪一欄」。
2. **它與本平台的 substrate 定位同源。** 一切都是表單上的欄位;
   簽核人來自欄位,與「公式來自欄位」「條件式格式來自欄位」是同一個範式,
   不是為遷移開的特例。
3. **A 與 B 各自撞一條已有的約束** —— A 撞「客戶要能自助」(前端無入口調階層),
   B 撞 OQ-AP2-1 已裁定的「不製造第二份組織結構」。C 兩條都不撞。
4. **不取代 `manager` 規則**,兩者並存:組織關係穩定的租戶用 `manager`(單一真實來源),
   遷移進來、主管是逐單指定的租戶用 `fieldRef`。

🔴 **採納 C 的硬約束**|
- **禁自我簽核**:欄位指到申請人本人時視為該關無人可簽 → 沿用既有
  `effectiveApprovers` 排除申請人的邏輯,並在**送簽當下**就擋(OQ-AP2-2 已建立的形態:
  解析不出人就擋在送簽,不要等單子走到一半才炸)。
- **欄位被刪 / 改型別**:`fieldRef` 指向的欄位消失 → 送簽時即 `NO_ACTIVE_STEP` 類錯誤,
  不得靜默跳過該關(跳過一關簽核是**權限事故**不是體驗問題)。
- **欄位值可被申請人自己改**:這是 C 最大的風險 ——
  申請人把「主管」欄改成自己的下屬即可繞過核可。
  **緩解**:該欄應以 E-1 欄位級權限設為申請人唯讀,
  且此約束**必須寫進遷移 SOP**,不能只留在本文件。

**狀態**|✅ **已裁定 C 並落地(2026-08-03)**。

- `approverRule: "fieldRef"` + `approverField`(member 欄的顯示名),
  schema 以 `.refine` 強制兩者同時存在。
- 解析走**系統層讀取不帶呼叫者權限** —— 簽核人是誰不該因為「誰在問」而改變;
  帶呼叫者權限的話,一個看不到該欄的人會得到「這關沒人能簽」,那是錯的答案。
- 三條硬約束皆有測試:欄位指到本人 → 送簽當下擋(訊息含「本人」)·
  欄位為空 → 擋並指名是哪一關 · 絕不靜默跳關。

🔴 **落地時抓到一個只有真 PG 才驗得出來的 bug**:`member` 欄存 `bigint`,
而 pg 的 int8 **預設回字串**;初版只收 `typeof raw === "number"` →
**永遠解析不出人**,而型別檢查與單元測試都不會抱怨。
初版另有一個 `.catch(() => null)` 會把任何故障偽裝成「這關沒人能簽」,已收斂為只吞 `RecordNotFoundError`。

⚠️ **仍在文件層的殘留**:「該欄應以 E-1 設為申請人唯讀」目前**只是建議**,
程式沒有強制。程式這一層守的是「指到本人就擋」,擋不住「指到自己的下屬」。
**這一條必須寫進遷移 SOP** —— 已列為 SOP 的必填項。

---

## 4. 資料模型(草案,待 OQ 定案後調整)

```
approval_def.steps[]  擴充(全為選配,既有定義零遷移)
  approverRoleId      既有:靜態角色
+ approverRule         'role' | 'manager' | 'managerOfManager' | 'managerOfPrevApprover'
+ quorum               number | null   -- null = 全體同意(Ragic 退化式)
+ returnableTo         number[] | null -- 可退回的關卡白名單;null = 全部先前關卡

approval_instance     不變(currentStep / status 仍為單軌)

approval_step_log     既有,加:
+ addedByActorId       臨時加簽的來源(誰把這個人拉進來的)
+ prevHash / hash      OQ-AP2-9 選 B 時才加
  → app 車道 grant 收斂為 SELECT / INSERT(OQ-AP2-9 選 A/B 皆需)
```

**一關算不算過,由 `approval_step_log` 推導,不另存計數** ——
計數欄與 log 是兩份真相,遲早分岔;而 log 本來就是 append-only 的那一份。

---

## 5. 里程碑(草案)

| M | 內容 | 產出 |
|---|---|---|
| M1 ✅ | ~~`decide()` 條件式 UPDATE~~(已存在)+ ~~grant 收斂~~(0021 已完成)→ 實際交付 **hash chain 偵測層**(0048)| api |
| M2 ✅ | 動態簽核人解析 + 送簽當下的可解析性檢查(OQ-1 / OQ-2)| api |
| M3 ✅ | N-of-M(OQ-3 / OQ-4)+ 臨時加簽(OQ-5 之 B)| api |
| M4 ✅ | 退回到指定關(OQ-6 / OQ-7 / OQ-8)| api |
| M5 ✅ | 鎖定逃生路徑(OQ-10;**三條改兩條**,理由見 changelog)| api |
| M6 ✅ | 設定 UI(簽核人規則 / 會簽門檻)+ 簽核畫面(駁回理由 / 退回目標 / 加簽 / 解鎖 / 會簽進度)| web |
| M7 ✅ | FMEA + e2e(`approval-advanced.spec`)| 兩側 |

> **M1 刻意排最前**:它們是**既有的缺陷**不是新功能,而且 grant 收斂會讓後面每一個 milestone
> 都在「log 真的改不動」的前提下開發 —— 反過來做的話,前面幾個 milestone 寫出來的程式碼
> 可能已經預設自己能改 log。

≈ 0.5–0.7 人月(視 OQ-9 是否含 hash chain)。

---

## 12. 失效場景反思(FMEA)

| # | 場景 | 處置 | Sev | 狀態 |
|---|---|---|---|---|
| **A1** | 🔴 **會簽的分母把送簽者算進去 → 那一關永遠不可能通過**。角色 3 人其中一人是送簽者,畫面停在 2/3 不動,**而且沒有任何錯誤訊息** | ✅ 分母改為「解析出的簽核人**扣掉送簽者**」(`effectiveApprovers`)。**瀏覽器實走當場撞到**,整合測沒抓到是因為它的角色成員裡剛好沒有送簽者 | **P0** | ✅ |
| **A2** | 🔴 **駁回按鈕一直是壞的**:UI 送 `decision: reject` 但**不帶理由**,而後端自 #103 起強制必填 → 按下去必定 400 | ✅ 改為先問理由再送。型別對、lint 過、後端整合測也綠(它們自己帶理由)—— **沒有任何靜態層攔得住,只有跑起來按一下才知道** | **P0** | ✅ |
| **A3** | 「退回」與「駁回」同名 → 使用者按下去得到完全不同的結果 | ✅ M4 之後兩者是不同動作,UI 與狀態章一律分開用詞(`rejected` 顯示「已駁回」) | P1 | ✅ |
| **A4** | 退回後舊核准仍算數 → 該關內控被跳過 | ✅ 只算最後一次退回之後的核准;e2e 反向驗證「重簽第 1 關只能到第 2 關,不會直接完成」 | **P0** | ✅ |
| **A5** | 動態關卡讓前端 zod 整個 parse 失敗 → 簽核區塊**整塊消失** | ✅ 前端 `approverRoleId` 改選配,與後端同步 | P1 | ✅ |
| **A6** | 會簽第一個人簽完畫面毫無變化 → 以為沒反應再按一次 | ✅ 狀態章顯示「N/M 人已核准」+ 訊息明講「本關還需其他人核准」 | P1 | ✅ |
| **A7** | 退回後使用者以為只補簽那一關 | ✅ 訊息明講「該關之後全部需要重簽」。業界唯一預設就是全部重簽(Kissflow 自承是痛點) | P1 | ✅ |
| **A8** | 強制解鎖沒人看得見 → 不知道這筆現在可以改 | ✅ 狀態列顯示「已強制解鎖」;解鎖本身寫進 append-only log 並串進 hash chain | P1 | ✅ |
| **A9** | ⚠️ **門檻已達成卻沒推進**:核准當下未達門檻,之後**分母變小**(簽核人離開角色 / 設定調整)使門檻回頭成立,但推進只在「有人做決定」時判定 → 實例停在「已達標卻不前進」 | ⏳ **未自動處理**。自動推進要在 decide 之外再開一條會觸發 `onComplete` 副作用的路徑,風險高於效益。**由既有逃生路徑覆蓋**:admin 加簽(新人核准即觸發推進)或撤回重送。**開發期實測到,列為已知邊角** | P1 | ⏳ |
| **A10** | 加簽被拿來繞過自簽禁令 | ✅ 不得把送簽者本人加為簽核人;整合測反向驗證 | **P0** | ✅ |
| **A11** | 動態簽核人解析不到 → 單子走到一半才卡住 | ✅ 送簽當下就解析全部關卡並擋下,訊息指名關卡(不學 Salesforce 在簽核人回應時才炸) | **P0** | ✅ |
| **A12** | hash chain 因為新增欄位而整條失效 | ✅ `added_by_actor_id` 等新欄位**刻意不入算式**;算式只有一份(trigger 與驗證器共用) | P1 | ✅ |

---

## 13. 變更紀錄

| 日期 | 版本 | 變更 | 作者 |
|---|---|---|---|
| 2026-08-03 | v1.0 | **M6 + M7 SHIPPED,模組完成**。前端:設計器拆出 `approval-def-editor`(原 `actions.tsx` 已 453 行,再加三個欄位會失控)+ 簽核人規則 / 會簽門檻;記錄頁拆出 `approval-panel`(駁回理由 / 退回目標下拉 / 加簽 / 強制解鎖 / 會簽進度 / 重簽警語)。**🔴 瀏覽器實走抓到兩個靜態層攔不住的缺陷**:(a) **會簽的分母把送簽者算進去** → 角色 3 人其中一人是送簽者時,那一關**永遠不可能通過**,畫面停在 2/3 不動且無任何錯誤訊息 —— 整合測沒抓到是因為它的角色成員裡剛好沒有送簽者;(b) **駁回按鈕一直是壞的** —— UI 送 `reject` 但不帶理由,而後端自 #103 起強制必填,型別對、lint 過、後端整合測也綠(它們自己帶理由),**只有把 app 跑起來按一下才知道**。另修 `rejected` 狀態顯示「已退回」的詞衝突(M4 之後那是兩個不同動作)。**dev DB schema 漂移又踩一次**:0048–0050 未套用,症狀是送簽 500。e2e `approval-advanced.spec` 4 條固化上述三件事;測試自己也錯兩次(`[data-noprint]` 不只一個 → 加 testid;訊息列也含「第 N 關」造成多重命中 → 斷言鎖在狀態章)。**A9 列為已知邊角**:門檻已達成卻沒推進(分母中途變小),不自動處理,由 admin 加簽或撤回覆蓋。api 1003 · web 174 · e2e 119 全綠 | Claude Code |
| 2026-08-03 | v0.6 | **M4 + M5 SHIPPED,而 M5 刪掉了 OQ-AP2-10 建議的其中一條**。**M4 退回**:與 reject 分開的 `return` 決定型別(reject 是「這件事不成立」,return 是「改一改再來」—— 後續動作、通知對象、稽核意義都不同,擠成同一型別事後就分不出來);可退任意先前關卡並可逐關以 `returnableTo` 收窄(Kissflow 形態;Salesforce 只能退一關,對多關流程不夠用 —— 第 4 關發現第 1 關填錯,退給第 3 關毫無意義);退回後**由該關重新解析簽核人**(指名原簽核人在「那人已離職」時直接卡死);**從目標關全部重簽**,做法是 `approversWhoApproved` 只算最後一次退回之後的核准 —— 不另存「這一輪誰簽過」的狀態,同樣由 log 推導。少了這一條,退回第 1 關之後第 2 關會因為**上一輪的核准**直接通過,那一關的內控等於被跳過。**M5 逃生路徑**:原建議三條(admin 永遠可編輯 / allowed-users 白名單 / 改派)。實作時**刪掉「admin 靜默 bypass」** —— 它與同一題「解鎖必須留痕」自相矛盾:靜默通過不會留下任何一筆「有人在簽核中改了這張單」的紀錄,而那正是這把鎖存在的理由;既有兩條鎖測試當場轉紅也暴露了代價(dev 車道每個人都是 superadmin,那條路等於把鎖整個關掉)。改為**顯式解鎖**(要填理由、寫進 append-only log、串進 hash chain)+ **admin 可加簽改派**(原簽核人離職時把單子加給接手的人,不必作廢重送)。**allowed-users 白名單暫不做**:admin 顯式解鎖已覆蓋緊急情境,而 per-def 白名單是沒有實際需求的設定面;觸發條件為「出現常態性的例外編輯需求」。**測試自己錯兩次**:`threeSteps` 寫成 const 陣列 → describe 註冊當下求值、那時 role id 還是 0,症狀看起來像 schema 壞掉;以及誤用 GET 端點取 currentStep。api 1003 綠 | Claude Code |
| 2026-08-03 | v0.5 | **M3 SHIPPED,且實作推翻了 OQ-AP2-3 自己的建議**。原採 Ragic 退化式「未填 = 全體同意」,**一寫下去整合測當場轉紅** —— Ragic 那個設計成立是因為它的簽核對象是**刻意挑出來的群組**,而我方的是**角色**,角色可能有 50 個人:預設要求全簽既荒謬,也會讓所有既有流程一夜之間卡住。改為一個欄位三種**顯式**意義(未填 = 任一人〔既有行為〕/ 數字 N = 擇辦 / `"all"` = 會簽);仍不採 `mode` enum + 數字,那有「`mode:'all'` 卻帶 `quorum:2` 信哪個」的矛盾空間。**達標與否由 log 推導不另存計數欄**(計數欄與 log 是兩份真相);「全體」取**解析後的實際人數**,因為動態簽核人下那一關有幾個人要到執行期才知道。**臨時加簽記進 `approval_step_log`** 而非另開表 —— 「誰把誰拉進這一關」正是稽核要問的事實,而 log 已經 append-only 且串進 hash chain;另開一張可改的表存它等於把最該不可竄改的那筆放在保護之外。`actorId` = 被加的人、`addedByActorId` = 加人的人,分開存否則看不出誰擴大了簽核圈;**不得加送簽者本人**(否則加簽是自簽禁令的後門)。**只做三種加簽中的「臨時加簽」**:另外兩種會在執行期插入關卡,正是 ServiceNow 社群警告的那件事。新欄位**刻意不入 hash 算式** —— 改算式會讓所有既有列判定為 tampered。**測試自己也錯一次**:同一張表建第二個 active def 後送簽會挑到最早那個,症狀看起來像「quorum 壞掉」,改為每案例一張表。api 40 綠 | Claude Code |
| 2026-08-03 | v0.4 | **M2 SHIPPED**。`approverRule` 新增三種動態解析,主管由 **role tree 推導**(申請人直接所屬角色的父角色成員);不新增 `actors.manager_actor_id`,因為 role tree 已是權限繼承的真實來源,再加一份就是兩份而兩份必然分岔。誠實代價:主管是**一組人**不是一個人 → N-of-M 從選配變必需品。解析失敗硬失敗但**改在送簽當下擋**(Salesforce 是簽核人回應時才炸,那時單子已走到一半),訊息指名關卡;唯一人選是送簽者本人時比照 Odoo Exclusive Approval 明確擋下、不靜默跳關。**待簽匣對動態關卡真的解析一次** —— 只比對靜態角色的話,「送給直屬主管」的單永遠不會出現在主管的待簽匣裡,功能等於不存在。順帶修兩個既有問題:(a) 測試 fixture 建了角色卻**從來沒加成員**,能過是因為 dev 車道一律 superAdmin,角色成員這條路從未被走過(還製造滿版 notification FK 錯誤日誌);(b) 代理人 `active` 用**應用時鐘**比對 DB `now()` 寫入的 `startsAt`,兩個時鐘不同步時「剛建立卻顯示未生效」—— 通知模組已踩過同一形狀 | Claude Code |
| 2026-08-03 | v0.3 | **M1 SHIPPED,而它推翻了 M0 自己的兩條記載**。動工前對碼查證發現:(a) `decide()` 的 race **早就修好了** —— `updateInstance` 已是帶 `expect` 守衛的條件式 UPDATE,且已有「併發雙簽只有一個贏」的測試 → **OQ-AP2-11 撤銷**;(b) append-only 的 **DB 層防護早就做完了**(0021:trigger 且 `ENABLE ALWAYS`、REVOKE、event trigger 擋 DROP),0021 結尾自己就把「hash chain 偵測層」列為後續 → OQ-AP2-9 實質只剩 B。**兩條都源自 §0-bis 的舊記載,而我寫 M0 時採信了它、沒去對碼** —— 正是「巨人的第一站是自家 repo」那條教訓。實際交付 migration 0048:**算式只有一份**(`approval_log_hash`,trigger 與驗證器共用 —— 各寫一次遲早分岔,而分岔的表現是「稽核報告說鏈斷了」這種最難查的假警報);時間戳以**微秒 epoch** 入雜湊而非 `::text`(後者隨 session TimeZone 變,換時區驗同一列會得到不同雜湊);**每實例 advisory lock**(會簽一關多人同時核准會讓兩筆讀到同一個 prev → 鏈分岔,不是理論風險);報告回 **preChain / tampered / unlinked 三分**而非布林(稽核者要的是「哪一筆、斷在哪」)。測試刻意用**特權連線**竄改 —— 那正是威脅模型防不住的角色,用 app 車道測等於什麼都沒驗。**測試自己先紅一次**:兩列時抽到最後一列,沒有後繼者自然驗不出斷鏈。api 32 綠 | Claude Code |
| 2026-08-03 | v0.2 | **OQ-AP2-1..11 全數裁定(全採建議),DRAFT → APPROVED,進 M1**。定調:主管由 **role tree 推導**(不引入第二份組織結構)· 解析失敗**送簽當下就擋**(不學 Salesforce 跑到一半才炸)· N-of-M 採 **`quorum: number \| null`**(null = 全體,Ragic 退化式)· 會簽一人拒絕**立刻整單否決** · 加簽**先只做臨時加簽**(唯一不改變關卡集合者)· 退回**可任意先前關卡 + 白名單** · 退回後**重新解析簽核人**、**全部重簽** · append-only 採 **DB grant + hash chain + 鏈完整性檢查報告** · 鎖定逃生**三條全做** · `decide()` 改**條件式 UPDATE** | Claude Code |
| 2026-08-03 | v0.1 | M0 DRAFT。**§0.1 對碼查證推翻一個隱含前提**:本專案**沒有任何「主管」關係**,只有用於權限繼承的 role tree —— 動態簽核人不是「接一個欄位」而是「要不要引入第二份組織結構」的架構決定(OQ-AP2-1)。**§1 一手查證五題**:(a) Ragic 三種動態解析為 **parity 基準線非進階**,且官方明載相依於系統使用者表單的直屬主管欄位;(b) **解析失敗業界一致硬失敗、無人做 fallback**,Salesforce 更把「離職」與「空值」同等對待且**在簽核人回應時才炸**(反面教材);(c) Ragic 的 **「擇辦人數清空 = 會簽」** 是最好的 N-of-M 資料模型 —— All 是 N 的退化值,結構上不可能矛盾;(d) Ragic 的**加簽三分法**直接回答「向前加簽會暫停目前簽核動作」,而 **ServiceNow 社群明文警告** ad-hoc 加簽會破壞狀態機一致性;(e) **退回後全部重簽是業界唯一預設**,Kissflow 自承是痛點,無人做「只重簽受影響關卡」;(f) **簽核紀錄 hash chain 六家皆無**,Odoo 有但用在會計分錄且附**鏈完整性檢查報告**(讀取端可自證),是唯一可借用的 OSS 先例。OQ-AP2-1..11 待裁定 | Claude Code |
