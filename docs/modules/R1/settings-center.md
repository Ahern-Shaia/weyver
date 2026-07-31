# settings-center.md — [R1·A-1] 設定中心(S22)設計文件

> ✅ **狀態:M0 APPROVED v1.0(2026-07-31)— OQ-SC-1..12 全採建議**
> **裁定摘要**|1=A 納入使用者管理/邀請 · 2=A 預設+個人可覆寫(不做鎖定)· 3=A 動態繼承 · 4=A 編號規則不做 · 5=A 會計期間/營業日曆延 R2 · 6=A 應用層 AES-256-GCM+信封 · 7=A 憑證只回「已設定+更新時間」· 8=A 固定 host 改 allow-list · 9=C 單因子 15 / 已啟用 MFA 者 8 · 10=B 複雜度旋鈕預設關+警語+稽核 · 11=A 做外洩字典比對 · 12=A 認證日誌留 6 個月
> **緣起**|docs/25 §247 之下一批。docs/04 v2.5/v2.6 兩次審計補列的「設定 / 管理」surface —— 該節時間戳寫得很直接:**「『設定/管理』surface 從未列項」**,是事後補上的,不是原本就規劃好的。
> **範圍**|租戶設定中心(A 2)· 帳號安全操作面(A 1)· 個人設定(H 1)· 通知通道連接設定 UI(H 1)≈ **5 人月**,另 OQ-SC-1 提議納入使用者管理 / 邀請(E 1)。
> **為什麼是現在**|它擋著 6 個通知通道(~7.5 人月):`notifications.md` 的 UI 裁定①逐字寫著「LINE 欄 P0 **不顯示**(P0 既無 driver 也無**連接設定頁** → 該列無法由任何操作變成「已連接」,是**死控件**)」。
> 作者:Claude Code(草擬)

---

## 0. 研究與現況盤查

### 0.1 🔴 現況盤查 —— 這一節改變了模組範圍

> 逐項對照 `apps/api/src/db/schema.ts`(40 張表)與既有頁面。**規格上寫著要做的,有些已經做了;有些則是誤置。**

| docs/04 列項 | 實際現況 |
|---|---|
| 租戶時區 | ✅ **已有** `tenants.timezone`(預設 `Asia/Taipei`),且**有真實消費者** —— autoNumber 的日界判定 |
| 個人通知偏好 | ✅ **H-1 已做完**(`notification_prefs` 三軸 + `notification_settings`)。個人設定頁少一大塊工,它需要的是**歸位**不是重做 |
| 編號規則 | ⚠️ **誤置** —— 已經是**逐欄位**設定(autoNumber options:`prefix` / `width` / `dateFormat` / `resetScope`),不是租戶級 |
| 公司資料 / 統編 / logo / 幣別 / 語言 | ❌ `tenants` 無對應欄位 |
| 個人偏好(介面語言 / UI) | ❌ `users` 僅 `auth_user_id` / `email` / `name` / `created_at` / `deleted_at`,**無偏好欄** |
| 通道連接憑證 | ❌ 完全沒有(既有 `api_keys` 是**雜湊**儲存,與此需求相反 —— 見 §0.3) |
| 登入紀錄 / 認證稽核 | ❌ `action_audit` 的 `form_id` / `record_id` 皆 **NOT NULL**,**結構上放不了認證事件** |
| 密碼政策 | ⚠️ Better Auth 1.6.23 的 `minPasswordLength`(預設 8)/ `maxPasswordLength`(預設 128)是 **instance 級,不是 per-tenant**;我方目前兩者都沒設 |

#### 🔴 最大的發現:租戶目前只能有一個人

`/register` 一律 `signUp` + `organization.create`(**新** org);**沒有邀請 UI、沒有使用者清單、成員頁加不了人**。
`role-detail.tsx:96` 自己寫著:

> 「尚無成員。**使用者指派介面(含使用者清單)為後續交付。**」

Better Auth 的 org invitation API 已經在,且 #99 還修過它的安全洞(邀請可被未驗證 email 冒領)—— **缺的純粹是 UI**。
R1 的整個故事是「既有 Ragic 客戶把團隊搬過來」,而現在第二個員工進不來。→ 見 **OQ-SC-1**。

#### 一處 spec 落後需一併更正

`docs/24 §6 S22` 仍寫「低頻 surface,入口**收於 topbar 帳號選單,不佔側欄主位**」,
但 `frontend-uplift.md` OQ-1=A 已裁定收進 rail 三個主目的地之一並落地。docs/24 需同步。

---

### 0.2 租戶層 vs 個人層 —— 切分判準與覆寫模型

> **方法**|查各家官方文件原文。以下引號內為**逐字原文**,判準歸納另行標注。

**(a) 三條可用的切分判準**

| 判準 | 一手證據 |
|---|---|
| **呈現格式 → 個人層** | Salesforce:「The Salesforce locale settings determine the **display formats** for date and time, user names, addresses…」「**As the admin, you set the default locale, but your users can set a personal locale if they're based in a different location.**」 |
| **系統對外產生的產物 → 組織層**(即使個人可改 UI) | Slack:「**Email invitations and SCIM-synced profiles will display in the default language, but everything else in Slack will be determined by members' individual language preferences.**」 |
| **定義資料語意 / 計價基準 → 組織層** | GA4 `timeZone`:「Reporting Time Zone, used as the **day boundary** for reports, **regardless of where the data originates**.」· Salesforce corporate currency:「you set that 'corporate currency,' which reflects the currency of your corporate headquarters」 |

⚠️ **誠實標注**|「影響資料 vs 只影響呈現」這句**通則本身查不到任何廠商明文寫出來**,是由上述三組原話歸納的。

**(b) 覆寫模型:三種都存在,是真分歧不是共識**

- **預設 + 個人可覆寫(個人贏)**|Slack:「The default language will apply to any new members or workspaces added to the organization, but **it won't override members' changes to their individual language preferences**.」
- **可鎖定(管理員贏)**|Zoom:「**Locking a setting at the account level means that the setting cannot be changed at the group or user level.**」多群組衝突時「**precedence is given to settings that are locked**」
- **明文優先序鏈(三層)**|Microsoft:「in priority order, either the primary and secondary prompt language specified in the **online voicemail policy**…, the **preferred language specified for the user**, or the **default tenant language**.」

**(c) 🔴 「繼承」還是「建帳號時複製」—— 兩家講法相反,必須擇一並寫進文件**

| 語意 | 一手原文 |
|---|---|
| **動態繼承** | Confluence:「if the user **doesn't** have a customized time zone, a change in the default time zone **will** reflect on their profile」「if the user **has** a customized time zone, a change in the default timezone will **not** reflect」 |
| **建帳號時複製** | Google Workspace:「**Setting a default time zone applies only to new user accounts.**」「**Existing users keep their current time zone.**」 |

Google 那條還附帶一個**不可逆**陷阱:「**If you set a time zone, you can't switch back to using time zones based on the user's location.**」

**(d) 時區兩軸的現成範例**|Airtable 存 GMT、預設轉各人本地顯示,而欄位可開「**Use the same time zone for all collaborators**」把該欄釘死單一時區。
→ 與 GA4 的 day-boundary 合起來,正是本專案需要的兩軸,而且**我們已經有其中一軸**(`tenants.timezone` 給 autoNumber 用)。

**查不到**|`help.salesforce.com` 全站 JS 渲染抓不到內文,**無法一手證實「改公司預設時區是否影響既有使用者」**;Notion 未找到 workspace 層語言設定或管理員鎖定的文件;Odoo 只有論壇貼文,不採用。

---

### 0.3 第三方憑證儲存 —— 與自家 API 金鑰**方向相反**

自家 API 金鑰(G-1)是**雜湊 + 明文只顯示一次**。但 LINE token / Slack webhook / SMTP 密碼**必須能還原出明文才能拿去呼叫第三方** → 雜湊不是選項,只能加密。

**(a) 加密方式**|OWASP Cryptographic Storage Cheat Sheet:「For symmetric encryption **AES** with a key that's at least 128 bits (ideally **256 bits**)…」「authenticated modes should always be used… **GCM** and **CCM**, which should be used as a first preference」;信封加密「The Data Encryption Key (DEK) is used to encrypt the data. The Key Encryption Key (KEK) is used to encrypt the DEK.」

🔴 **應用層 vs DB 層,OWASP 明文不選邊,但給了判準**:

> 「**Which layer(s) are most appropriate will depend on the threat model.** For example, hardware level encryption is effective at protecting against the physical theft of the server, but will provide no protection if an attacker is able to compromise the server remotely.」

→ 我們的主威脅是**應用被打穿 / RLS 被繞過**(本專案已踩過五次特權連線遮蔽安全機制),那正是 TDE 擋不住的 → **應用層加密**。

**(b) 輪替**|NIST SP 800-57 Part 1 Rev 5 §5.3.6:「An encryption key used to encrypt smaller volumes of data might have an **originator-usage period of up to two years**」,但同節開宗明義「the cryptoperiods suggested are **only rough order-of-magnitude guidelines**」。
HashiCorp Vault transit 證明**輪替可在不見明文的情況下完成**:rewrap「**does not reveal the plaintext data**」。

**(c) UI 回顯 —— 最貼近的一手實作是 Grafana**|「By defining `password` and `basicAuthPassword` under `secureJsonData` Grafana encrypts them… Then, the encrypted fields are listed under **`secureJsonFields`**」—— API **只回布林旗標,永不回值**。

⚠️ **誠實標注**|**找不到任何權威來源明文反對「顯示明文」按鈕**。坊間廣傳的 GitHub Actions「建立後無法檢視」那句話,逐頁查證後**原文並不存在**。反對理由是可推導的(回顯明文把洩漏面從 DB 擴大到瀏覽器 / HTTP 快取 / 截圖 / 客服代登入),但那是推論不是引用。

**(d) webhook URL 是不是 secret**|Slack 官方逐字:「**Your webhook URL contains a secret. Don't share it online, including via public version control repositories.**」
**Teams 找不到**|Microsoft Learn 的 Incoming Webhook 全文**沒有任何保密敘述**。功能上等價應同等對待,但**不得在文件中宣稱「Microsoft 說要保密」**。

**(e) 測試發送的 SSRF**|OWASP SSRF Cheat Sheet:「**Deny-lists are bypass-prone. Prefer allow-lists.**」「**Disable the support for the following of the redirection** in your web client」「Do not accept complete URLs from the user…」
→ 我方現有 SSRF guard 是 **deny-list**(擋私網段 + 雲 metadata)。Slack/Teams 的 host 是固定的 → 可升級為 allow-list。

**(f) 稽核**|OWASP Logging Cheat Sheet 要求記錄「**Modifications to configuration**」與「Encryption activities such as use or rotation of cryptographic keys」;
**明文禁記清單**逐字含「**Access tokens**」「Authentication passwords」「**Database connection strings**」「**Encryption keys and other primary secrets**」。
→ 稽核只記 metadata(誰 / 何時 / 哪個通道 / 指紋),**不記值**。OWASP LLM02:2025 亦把 credentials 列為須 sanitize 的敏感類別。

---

### 0.4 密碼政策與 session 清單

#### (a) 🔴 版本本身就是發現:NIST SP 800-63B-**4** 已定稿並取代 rev.3

Status **Final**,PDF 頁首 July 2025,CSRC 標「Supersedes: SP 800-63B (03/02/2020)」。
**rev.4 相對 rev.3 有兩處實質變更**,兩處都會直接影響我們要出貨的東西:

| 項目 | rev.3(2017/2020) | **rev.4(現行)** |
|---|---|---|
| 組合規則(大小寫/數字/符號) | `SHOULD NOT impose` | **`SHALL NOT`** |
| 定期強制換密碼 | `SHOULD NOT require ... changed arbitrarily` | **`SHALL NOT`** |
| 單因子最小長度 | at least **8** | **at least 15** |

§3.1.1.2 逐字:

> 「5. Verifiers and CSPs **SHALL NOT impose other composition rules** (e.g., requiring mixtures of different character types) for passwords.」
> 「6. Verifiers and CSPs **SHALL NOT require subscribers to change passwords periodically**. However, verifiers **SHALL force a change if there is evidence that the authenticator has been compromised**.」
> 「1. Verifiers and CSPs SHALL require passwords that are used as a **single-factor** authentication mechanism to be a minimum of **15 characters** in length. Verifiers and CSPs MAY allow passwords that are only used as part of **multi-factor** authentication processes to be shorter but SHALL require them to be a minimum of **eight characters**.」
> 「2. Verifiers and CSPs **SHOULD permit a maximum password length of at least 64 characters**.」
> 「…verifiers **SHALL compare the prospective secret against a blocklist** that contains known commonly used, expected, or compromised passwords. **The entire password SHALL be subject to comparison, not substrings**…」
> 「8. Verifiers and CSPs **SHALL NOT prompt subscribers to use knowledge-based authentication (KBA)** … or security questions when choosing passwords.」

**對我們的直接後果**|Better Auth 1.6.23 預設 `minPasswordLength` = **8**,而我方**兩者都沒設**(§0.1)。
註冊頁的標籤現在寫「密碼(至少 8 碼)」。→ 見 **OQ-SC-9**。

#### (b) 稽核現實與安全建議衝突時怎麼辦

NIST Appendix A.3 自己給了拒絕組合規則的理由:「a user who might have chosen "password" … would be relatively likely to choose "Password1"」。
英國 **NCSC** 站同一邊,逐字:「**Regular password changing harms rather than improves security.**」「the NCSC **do not recommend the use of complexity requirements**」。

⚠️ **誠實標注 —— 這兩條未取得一手**:PCI DSS v4.x 8.3.9 是否仍保留 90 天更換為選項(僅二手來源)、ISO/IEC 27002:2022 §5.17 原文(付費牆)。
台灣客戶的 ISO / 內稽**可能**要求定期更換,但**本文件不宣稱標準原文如此**。

#### (c) session / 裝置清單

**欄位**|Microsoft 帳戶 Recent activity 明列「The IP address of the device on which the activity occurred」「The type of device or operating system」「The internet browser or type of app used」+ 地圖位置,**僅顯示 30 天**。
GitHub 文件只寫「view a list of devices that have logged into your account」「**Revoke session**」,**未列明欄位**;Google 文件層級只講裝置 / 最後通訊時間。→ 欄位沒有業界共識可抄,只有 Microsoft 一家寫得具體。

**🔴 登出不是終點 —— Google 自己承認不完全**,逐字:改密碼後「You'll be signed out everywhere **except**: Devices you use to verify that it's you when you sign in / Some devices with third-party apps that you've given account access…」。
GitHub 另揭一個副作用:「Revoking a mobile session signs you out of the application on that device **and removes it as a second-factor option**.」
→ 我方的「登出所有其他裝置」必須一併處理:API 金鑰 / webhook / **且該裝置若同時是 MFA 因子要講清楚**。

**🔴 OWASP 對 session 綁定 IP/UA 的立場 —— 修正我原本的印象**,逐字:

> 「it is **highly recommended to bind the session ID to other user or client properties**, such as the client IP address, User-Agent…」
> 「Although these properties **cannot be used by web applications to trustingly defend against session attacks**, they significantly increase the web application **detection** (and protection) capabilities. However, a skilled attacker can bypass these controls by reusing the same IP address … (very common in NAT environments) or by manually modifying the User-Agent…」

→ **不是反對綁定,而是「可作偵測訊號、不可當防護依據」。** 我原本以為 OWASP 對綁定有保留,方向大致對但語氣錯了。
同文件另建議提供「remotely terminate sessions manually, and track account activity history (logbook)」—— 正是本模組要做的東西。

**保留期(具名數字)**|GitHub security log **90 天**;Microsoft Entra 稽核/登入日誌 Free **7 天** / P1·P2 **30 天**;Microsoft 帳戶 recent activity **30 天**;
🔴 **台灣**「資通安全責任等級分級辦法」附表十:**「保留日誌至少 6 個月」**(數位發展部資安署 FAQ)。
→ 客戶多為台灣企業,**6 個月**是比國際慣例更長的下限,取它。

**IP 與隱私**|Microsoft 自己加免責:「Mobile phone services route activity through different locations, so it **may look like you signed in from somewhere that's not your actual location**.」→ 顯示大略地點必須標示為推估。
CJEU C-582/14 *Breyer* 認定動態 IP 在特定條件下構成個資 —— ⚠️ 此點為二手歸納,**未逐字取判決原文**。

---

### 0.5 M2 研究|把同事加進租戶

> **緣起**|實作前發現 M0 漏了一層硬前提:`requireEmailVerificationOnInvitation: true` 已設(#99 修 CVE-2026-53514),但 `sendVerificationEmail` **從未實作** → **邀請永遠無法被接受**。

#### (a) 🔴 先更正一個我自己的錯誤推論

原本推測「改用『管理員自行轉發邀請連結』就能避開 email 驗證前提」。**讀原始碼後不成立。**
Better Auth 1.6.23 `dist/plugins/organization/routes/crud-invites.mjs` 的 accept 路徑:

```js
if (invitation.email.toLowerCase() !== session.user.email.toLowerCase()) throw FORBIDDEN
if (shouldRequireVerifiedEmailForInvitationIdAction({...}) && !session.user.emailVerified) throw FORBIDDEN
```

→ 驗證檢核**依旗標判定,與連結怎麼送達無關**;且接受者的帳號 email 必須與被邀 email 完全一致
(連結本身不是通行證)。**投遞管道換掉解決不了前提。**

#### (b) Ragic parity(一手:本地官方文件庫 `doc/3.html 管理內部使用者`)

Ragic **兩條路都有**,不是二擇一:

> 「新增使用者後的**邀請信**或是**重送邀請信**都會寄出自訂認證信內容。」
> 「如果有**設定預設密碼**,使用者將需要用該密碼登入,如果沒有預設密碼,則會**隨機產生 10 碼密碼**。使用者以預設密碼登入後,就可以設置新密碼。」

另外兩條 M0 完全沒列到的:

> 🔴 **停權語意反直覺**|「當有員工離職時,**推薦作法是將離職員工的帳號停權**…不建議直接刪除使用者,避免失去使用者的資料。」
> 「注意:**被停權的使用者仍然可以登入 Ragic**,並且存取開放給 EVERYONE 權限的資料。」
> → **停權 ≠ 擋登入**。憑直覺實作一定會做成「停權就擋在登入頁」,那與 parity 不符。

> **資料管理者權限轉移**|離職 / 職務調動時,把「表單權限 + 被指派的資料 + 簽核對象」整批轉給另一人。

Ragic 的使用者本身**就是一張表單**(可自行加欄位、列表頁大量修改)—— 與「表單引擎是 substrate」同源。

#### (c) 🔴 標準面:Ragic 的做法在現行標準下**有兩處不合格**

**NIST SP 800-63B-4 沒有「臨時密碼」專章,而且刪掉了 rev 3 的豁免。**
rev 3 §5.1.1.1 原有「Memorized secrets chosen randomly by the CSP or verifier SHALL be at least **6 characters**」——
**63B-4 全文查無此句**。適用的是 §3.1.1.2 第 1 條:

> 「Verifiers and CSPs SHALL require passwords that are used as a **single-factor** authentication mechanism to be a minimum of **15 characters** in length. Verifiers and CSPs MAY allow passwords that are only used as part of **multi-factor** authentication processes to be shorter but SHALL require them to be a minimum of **eight characters**.」

→ **Ragic 的「隨機 10 碼」在單因子下不足**;要縮短到 8 的**唯一合法路徑是強制綁 MFA**。
另:§3.1.1.1「Passwords SHALL either be chosen by the subscriber **or assigned randomly by the CSP**」——
系統隨機指派**本身合規**。

**OWASP ASVS 5.0.0 §V6.4.1(L1)** 是初始密碼的權威條文:

> 「system generated initial passwords or activation codes are securely randomly generated, **follow the existing password policy**, and **expire after a short period of time or after they are initially used**. These initial secrets **must not be permitted to become the long term password**.」

**🔴 §V6.4.6(L3)明確反對管理員自選密碼**:

> 「Verify that administrative users can initiate the password reset process for the user, but that this **does not allow them to change or choose the user's password**. **This prevents a situation where they know the user's password.**」

→ **Ragic 的「設定預設密碼」違反這條。**(誠實標注:V6.4.6 為 L3 非 L1 強制)

**業界做法**|Entra / Google Workspace / Okta **暫時密碼與啟用信兩路都給**;
Okta 在管理員設密碼時**預設勾選** "User must change password on first login";
Salesforce 只走信件(「Generate password and notify user immediately」)。
⚠️ 四家官方文件**皆未載明暫時密碼的絕對時效上限**(查無)。

**反面**|CISA Secure by Design Alert 逐字「**Years of evidence have demonstrated that relying upon
thousands of customers to change their passwords is insufficient**」,建議「time-limited setup passwords
that disable themselves when a setup process is complete」。
⚠️ 該文針對**產品出廠預設密碼**,不是逐人建帳號;可類比的只有「可預測 / 重複使用」風險,
**不能直接當成反對本模型的證據**。

#### (d) 一個意外的收斂

15 字元的隨機密碼**唸不出來** —— 那本身就是「不要用口頭傳遞、改成畫面顯示一次 + 複製」的理由,
正好與「管理員自行用 LINE 轉發」的選擇一致。**限制推著設計往對的方向走。**

---

## 1. 目標與範圍

### 1.1 目標

1. 租戶管理員能在 UI 完成公司資料 / 地區設定,**且每一項都有真實消費者**。
2. 使用者能設定個人偏好,且與租戶預設的**繼承關係是明確且可預期的**。
3. 管理員能看到已登入裝置並強制登出;能查認證事件紀錄。
4. 租戶能自行連接通知通道(LINE / Slack / Teams / SMTP)並測試發送 —— **解鎖 6 個通道模組**。

### 1.2 不做的事

- ❌ **不做沒有消費者的設定** —— 會計期間 / 營業日曆的消費者(GL 期結)在 R2。承 `notifications.md` 裁定①「不做假開關」的同一把尺。
- ❌ **不做編號規則的租戶級設定** —— 它已經是逐欄位設定(§0.1)。若要做只能是「新欄位的預設樣板」,那是另一件事(OQ-SC-4)。
- ❌ **不做 SSO / SCIM 自助設定**(docs/04 列於 A 認證 3,獨立模組)。
- ❌ **不做 AI 設定頁**(docs/04 A +2;需 AI provider 抽象層先落地,見 docs/17)。
- ❌ **不改 `action_audit` 的既有語意** —— 認證事件走新表,不把 `form_id` 改成 nullable 而動搖既有不變量。

---

## 2. 設計要點(草案,待 OQ 裁定後定稿)

### 2.1 兩軸時區(承 §0.2(d))

| 軸 | 存放 | 語意 | 可否個人覆寫 |
|---|---|---|---|
| **業務日界線** | `tenants.timezone`(**已存在**) | autoNumber 日期段 / 期間歸零 / 報表的「今天」 | ❌ 不可 —— 它定義資料語意(GA4 模型) |
| **顯示時區** | 個人設定(新) | 畫面上時間戳的呈現 | ✅ 可;未設則跟隨租戶 |

### 2.2 繼承語意 = 動態繼承(Confluence 模式)

個人設定表**沒有該列 = 繼承租戶值**,改租戶值即時反映到所有未自訂者。
選這個而非 Google Workspace 的「建帳號時複製」,理由有二:
(a) 我們的個人設定表天然是「有列才覆寫」,動態繼承是零額外機制;
(b) 複製語意會走上 Google 那個**不可逆**陷阱(「you can't switch back to using time zones based on the user's location」)。

### 2.3 憑證儲存(承 §0.3)

應用層 **AES-256-GCM** + 信封加密(DEK 存庫、KEK 由 Infisical 注入);
UI 採 **Grafana `secureJsonFields` 模式** —— 只回「已設定 / 最後更新時間」,**永不回值,只能覆寫**;
稽核記 metadata 不記值;測試發送對固定 host 的通道改用 **allow-list**。

---

## 3. 開放問題(OQ-SC-N)— 待裁定

| # | 問題 | 選項 | 建議 |
|---|---|---|---|
| **1** | 🔴 **使用者管理 / 邀請是否納入本模組** | A **納入**(+E 1 人月) · B 另開模組 · C 不做 | **A** —— 現況是**租戶只能有一個人**(§0.1),設定中心做完仍無法讓第二位員工進來;Better Auth API 與安全加固(#99)都已就位,缺的只有 UI |
| **2** | 覆寫模型 | A **預設 + 個人可覆寫** · B 加「管理員可鎖定」 · C 管理員強制 | **A** —— B 的鎖定(Zoom 模式)是**已驗證的成熟做法但屬加法**,無客戶要求前不做;C 對「呈現格式」類設定違反 Salesforce 的既有範式 |
| **3** | 繼承語意 | A **動態繼承**(Confluence) · B 建帳號時複製(Google) | **A** —— 見 §2.2;B 有不可逆陷阱且需額外複製機制 |
| **4** | 編號規則 | A **不做**(已逐欄位) · B 做「新欄位預設樣板」 | **A** —— B 是新功能不是 parity,且會讓「規則存哪」出現兩個真相 |
| **5** | 會計期間 / 營業日曆 | A **延到 R2 隨消費者一起做** · B 現在做 UI | **A** —— 沒有消費者的設定就是死控件(`notifications.md` 裁定①同一把尺) |
| **6** | 憑證加密層 | A **應用層 AES-256-GCM + 信封** · B pgcrypto · C 只靠磁碟加密 | **A** —— OWASP 判準:C/B 擋不住「應用被打穿 / RLS 被繞過」,而那正是本專案的主威脅 |
| **7** | 憑證 UI 回顯 | A **只回「已設定 + 更新時間」**(Grafana) · B 顯示末四碼 · C 可按鈕看明文 | **A** —— 與既有 API 金鑰語意一致;⚠️ 反對 C 的**權威原文查不到**,此為推論(§0.3(c)) |
| **8** | 通道測試發送的 SSRF 防線 | A **固定 host 改 allow-list**,其餘維持 deny-list · B 維持現狀 | **A** —— OWASP 逐字「Deny-lists are bypass-prone. Prefer allow-lists.」;Slack/Teams host 固定,SMTP 仍需 deny-list |
| **9** | 🔴 **最小密碼長度** | A **提高到 15**(NIST 63B-4 單因子門檻)· B 維持 Better Auth 預設 8 · C 15,但已啟用 MFA 者放寬到 8 | **C** —— 63B-4 原文對兩者**分別訂門檻**(單因子 15 / 多因子 8),照抄即可;既有使用者不受影響(只在設定與變更時驗)。註冊頁「至少 8 碼」需同步改字 |
| **10** | 密碼「複雜度 / 定期更換」旋鈕 | A **不做** · B 做但預設關 + 開啟時警語 + 記稽核 · C 照客戶要求做 | **B** —— 63B-4 對兩者皆為 **`SHALL NOT`**(rev.3 只是 `SHOULD NOT`),NCSC 亦逐字反對;但台灣客戶內稽可能硬性要求。做成「預設關 + 明示違反 63B-4 §3.1.1.2 + 記錄誰為了哪張稽核開的」,把選擇權與責任一起交出去。⚠️ **「稽核標準真的要求定期更換」未取得一手證據**(PCI/ISO 皆二手或付費牆),不得寫進文案當理由 |
| **11** | 外洩密碼字典比對 | A **做**(63B-4 為 `SHALL`)· B 不做 | **A** —— 原文要求**整串比對非子字串**;OSS-only 下用本地 k-anonymity 清單或 HIBP range API(後者需評估對外請求,見 §1.2 不做的事) |
| **12** | 認證日誌保留期 | A **6 個月**(台灣資安分級辦法附表十)· B 90 天(GitHub)· C 30 天 | **A** —— 客戶多為台灣企業,取較長的法定下限;量極小(每人每日數列) |

### 3.1 M2 新增之開放問題(承 §0.5)

| # | 問題 | 選項 | 建議 |
|---|---|---|---|
| **13** | 🔴 把同事加進租戶的模型 | A **管理員建帳號 + 系統產生一次性初始密碼**(不需 SMTP)· B 邀請信(需先做 email 驗證)· C 兩者都做 | **A 先做,B 列殘留** —— Ragic **兩條都有**,故 A 不是偏離 parity;而 B 卡在 email 驗證且 dev 無 SMTP。A 做完「第二個員工進不來」就解了,B 是加法 |
| **14** | 🔴 初始密碼長度 | A **15 字**(63B-4 單因子門檻)· B 8 字 + **強制綁 MFA** · C 10 字(照 Ragic) | **A** —— 63B-4 **刪掉了 rev 3 的 6 字豁免**,單因子無例外;C 直接不合格。B 合法但把 MFA 變成入職必經,對產線人員摩擦過大。15 字唸不出來 → UI 顯示一次 + 複製鍵(§0.5(d)) |
| **15** | 🔴 管理員可否**自選**初始密碼 | A **不可,只能系統產生** · B 可(Ragic parity) | **A** —— ASVS 5.0.0 §V6.4.6 逐字反對「does not allow them to change or choose the user's password」,理由是「prevents a situation where they know the user's password」。⚠️ 該條為 **L3 非 L1**,且**此處刻意不照 Ragic** —— 明知而為,理由記錄在此 |
| **16** | 初始密碼的生命週期 | A **單次使用 + 短效期 + 首次登入強制改** · B 只做強制改 | **A** —— ASVS §V6.4.1 逐字要求「expire after a short period of time **or** after they are initially used」且「must not be permitted to become the long term password」。效期取 **72 小時**(⚠️ 業界四家皆未載明上限,此為本專案取值) |
| **17** | 🔴 停權語意 | A **照 Ragic:仍可登入,只失去授權資料** · B 直接擋登入 | **B** —— **此處刻意不照 Ragic**。Ragic 的語意來自它有 EVERYONE 公開資料的前提;Weyver 定位是取代 ERP,離職者仍能登入公司系統對稽核不可解釋。改為擋登入 + 保留資料(仍不刪除,承 Ragic 的「不建議刪除」)。**若你要 parity 優先請改判 A** |
| **18** | 資料管理者權限轉移 | A **納入 M2** · B 列殘留與 #104 簽核代理人一起做 | **B** —— 它同時牽動表單權限 / 記錄指派 / 簽核對象三處,與 #104(代理人 / 動態主管解析)是同一批問題;硬塞進 M2 會讓這個模組失焦 |
| **19** | 使用者是否做成「一張表單」 | A **固定頁面**(先) · B 照 Ragic 做成引擎上的表單(可自行加欄位) | **A** —— B 很符合定位且值得做,但它是**引擎能力的延伸**不是設定中心的一部分;先把人加得進來,B 列入 R1 後續 |

---

## 4. 落地順序(裁定後填)

| M | 內容 | 驗證 |
|---|---|---|
| M1 | 租戶設定(公司資料 / 地區)+ 個人設定骨架 + 繼承語意 | 改租戶值即時反映到未自訂者 |
| M2 | 使用者管理 + 邀請(若 OQ-1=A) | **跨租戶隔離 e2e**:B 租戶邀不到 A 的表 |
| M3 | 帳號安全(裝置清單 / 強制登出 / 認證稽核) | 強制登出後舊 session 立即失效 |
| M4 | 通道連接(加密儲存 + 測試發送) | 憑證不回顯 / 稽核不含值 / SSRF |
| M5 | FMEA + docs 回填 | — |

## 5. FMEA(草案,M5 補完)

| # | 失效 | 嚴重度 | 緩解 |
|---|---|---|---|
| C1 | 第三方憑證外洩(log / 錯誤訊息 / 稽核 / LLM prompt)| **P0** | 只記 metadata;OWASP 禁記清單進 redact 規則;回應 DTO 永不含值 |
| C2 | 測試發送被當成打內網 / 打第三方的跳板 | **P0** | allow-list + 禁 redirect + 租戶速率限制 + 稽核 |
| C3 | 邀請被跨租戶濫用 / 冒領 | **P0** | 承 #99 的加固;e2e 斷言 B 租戶邀不進 A |
| C4 | 強制登出後 session 未真正失效 | **P0** | 斷言舊 cookie 立即 401;**且一併撤 API 金鑰 / webhook** —— Google 自己承認「signed out everywhere **except**…」,GitHub 更揭示撤 session 會連帶移除該裝置的 MFA 因子,兩者都必須在 UI 講清楚(§0.4(c)) |
| C7 | 密碼政策旋鈕被開成違反 63B-4 而無人知情 | P1 | 開啟時顯示違反條文 + 記稽核(誰 / 何時 / 為了哪張稽核);預設關 |
| C8 | 裝置清單顯示的地點被當成事實 | P2 | 標示為推估 —— Microsoft 逐字免責「may look like you signed in from somewhere that's not your actual location」 |
| C5 | 改租戶時區導致既有單號日期段跳動 | P1 | 時區為**日界**語意,改動須警告並記稽核;既有記錄不回溯 |
| C6 | 設定頁把個人值寫成租戶值(或反之)| P1 | 兩者分表分端點;e2e 斷言 A 使用者改偏好不影響 B |
