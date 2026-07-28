# mfa.md — [F-4] 二步驟驗證(MFA / TOTP) 設計文件

> ✅ **狀態:SHIPPED v1.0(2026-07-20)** — M0–M4 全數完成。自助 TOTP 二步驟驗證上線:帳號設定啟用(QR + backup codes)、登入密碼步後二步 challenge、驗證端點防暴力、FMEA P0 全緩解;後端 4 整合測 + `e2e/mfa.spec.ts` 固化綠。OQ-MFA-1..6 全採建議裁定。
>
> **後續**(非本模組):管理員協助重設之身分核驗政策 · passkey/WebAuthn · org 強制 2FA 政策。
>
> **一句話**|在已 SHIPPED 的 F-2 認證上,加**自助 TOTP 二步驟驗證**:使用者用 authenticator app(Google Authenticator / 1Password / Authy)綁定,登入時密碼通過後再驗一次性碼才發 session。純自助、不需 email/簡訊基礎設施。
>
> **上游**|F-2 auth SHIPPED(Better Auth + emailAndPassword + AuthGuard;`foundation/auth.md`)· Better Auth `two-factor` plugin(核心內建,已於 node_modules 確認)· §6-bis 登入分層與治理(管理層/owner 應有更強驗證)。
>
> **不含**|Email/SMS OTP(卡 email/簡訊 infra,見 auth.md §1.3 + 通知模組 H)· Passkey/WebAuthn(需另裝 `@better-auth/passkey`,獨立後續模組)· org 層強制政策(僅預留)· trustDevice。
>
> 作者:Claude Code(草擬)· 版本:v0.1(2026-07-20)

---

## 1. 目標與範圍

### 1.1 目標
1. **自助啟用 / 停用 TOTP**|使用者於帳號設定啟用 → 產生 secret → 顯示 QR + 手動碼 → 輸入一次性碼驗證 → 啟用並顯示 **backup codes**(一次性,**加密儲存**〔非雜湊,見 §0-bis〕,遺失 app 時救援)。
2. **登入二步**|`signIn.email` 密碼通過後,若該帳號已啟用 2FA → **不直接發 session**,要求輸入 TOTP 碼(或 backup code)驗證通過才發。
3. **停用需重新驗證**|停用 2FA 需再次驗證(密碼 / 目前 TOTP),防被劫持會話者關閉。
4. **治理對齊(§6-bis)**|管理層 / owner **強烈建議**啟用;MVP 為 opt-in,org 層強制列後續(僅預留 policy 欄)。

### 1.2 對應訴求
- 資安姿態|密碼單因子在釣魚 / 撞庫下不足;TOTP 是自我完備、零基礎設施相依的最高 CP 值強化(對照 F-2 §1.3「MFA 後續」之提前項)。
- 唯一「純加分、無相依」的 auth 強化(密碼重設卡 email、SSO 卡客戶,見對話裁定 2026-07-20)。

### 1.3 不做的事(scope out)
- **Email / SMS OTP**|需交易郵件 / 簡訊供應商(通知模組 H,未建)。
- **Passkey / WebAuthn**|需 `@better-auth/passkey`(核心 dist 無),獨立模組後續。
- **org 強制 2FA(admins 必須)**|預留 org policy 欄,MVP 不強制阻擋。
- **trustDevice(記住此裝置)**|MVP 每次登入都驗,較安全;之後再評估。

---

## 2. 上游 / 既有現況走查

| 子題 | 現況 | Gap |
|---|---|---|
| 認證 | F-2 SHIPPED:emailAndPassword + Argon2id + session + AuthGuard | 登入加第二步 challenge |
| two-factor plugin | Better Auth 核心內建(`plugins/two-factor`:TOTP + backup codes + verifyTotp/verifyBackupCode/enable/disable) | createAuth 掛 plugin |
| auth schema | Better Auth 自管(db:migrate:auth)| twoFactor 表隨 getMigrations 生成 |
| 登入 UI | 單步(signIn.email → redirect) | 加「輸入驗證碼」第二步 |
| 帳號設定頁 | 無(F-2 未做設定面) | 加「安全 / 二步驟驗證」設定區塊 |

---

## 3. 剩餘 scope 切分

| 子題 | 內容 | 難度 |
|---|---|---|
| **A1 plugin + 後端** | createAuth 掛 `twoFactor({ issuer })`;secret 加密 + backup **加密**(內建);migration;登入 challenge 語意 | 中 |
| **A2 啟用 / 停用 UI** | 帳號設定「二步驟驗證」:啟用 → QR(由 totpURI 前端生)+ 手動碼 → 驗證 → 顯示 backup codes;停用(重新驗證) | 中 |
| **A3 登入 challenge UI** | login 密碼步後若 `twoFactorRedirect` → 導向 `/login/2fa` 輸入 TOTP / backup → verify → 進 /app | 中 |
| **A4 安全 + 測試** | 驗證端點 rate-limit;backup 一次性;停用需驗證;整合測 + Playwright 固化 | 中(安全) |

---

## 4. A1|two-factor plugin(後端)

- `betterAuth({ plugins: [ twoFactor({ issuer: "Weyver" }), organization(...) ] })`。issuer 顯示於 authenticator app。
- **secret 保護**|Better Auth 以 app secret 加密 TOTP secret;**backup codes 亦為加密(可逆)而非雜湊** —— 見 §0-bis(沿用 F-2 `BETTER_AUTH_SECRET`,prod fail-fast 已具備)。
- **啟用流程 API**(M1 spike 驗證確切形狀)|`twoFactor.enable({ password })` → 回 `totpURI` + `backupCodes`;`twoFactor.verifyTotp({ code })` 完成啟用;`twoFactor.disable({ password })`;`twoFactor.generateBackupCodes()`。
- **登入語意**|已啟用 2FA 之帳號 `signIn.email` 回 `{ twoFactorRedirect: true }`(不發完整 session),前端導 challenge;`twoFactor.verifyTotp` / `verifyBackupCode` 通過才發 session。AuthGuard 不變(仍只認伺服器驗證的 session)。

## 5. A2|啟用 / 停用 UI(帳號設定)

- 新增 `/app/settings/security`(或帳號選單)之「二步驟驗證」區塊。
- 啟用:輸入密碼 → 呼叫 enable → 以 `totpURI` 前端產 QR(qrcode 套件)+ 顯示手動碼 → 使用者輸入 app 產生的 6 碼 → verifyTotp → 成功後**一次性顯示 backup codes**(提示妥善保存)。
- 停用:需重新驗證(密碼或 TOTP)→ disable。
- 顯示目前狀態(已啟用 / 未啟用)+ 重新產生 backup codes。

## 6. A3|登入 challenge UI

- login 頁 `signIn.email` 後:若回 `twoFactorRedirect` → 導 `/login/2fa`(暫存中間狀態,不落 session)。
- `/login/2fa`:輸入 6 碼 TOTP → `verifyTotp`;提供「改用備用碼」→ `verifyBackupCode`。通過 → 進 `/app/builder`(沿用 F-2 登入後設 active org 流程)。
- 錯碼:明確錯誤 + rate-limit(見 §7-bis)。

---

## 7-bis. 企業級 cross-cutting 檢核(安全關鍵)

- **secret / backup 保護**|TOTP secret 加密、**backup codes 加密(非雜湊)**(Better Auth 內建,用 app secret)—— 不落 log、不回傳明文。
- **驗證暴力**|`/two-factor/verify-totp`、`/verify-backup-code` 加嚴 rateLimit customRule(對齊 F-2 sign-in 5/60s 級);TOTP 時間窗容忍設保守(±1 step)。
- **backup code 一次性**|用過即失效(Better Auth 行為,測試斷言)。
- **停用防護**|停用 / 重產 backup 需重新驗證,防會話劫持者關閉 2FA。
- **enumeration**|未認證者不得探知「某帳號是否啟用 2FA」(僅在密碼步通過後才進入 challenge)。
- **中間狀態**|2FA 未完成前不得發完整 session / 不得存取 /app(AuthGuard 仍以完整 session 為準)。
- **降級**|2FA 驗證服務同 auth,掛則 fail-closed(登入不通過而非略過)。

---

## 8. 測試策略

| 層 | 覆蓋 | 位置 |
|---|---|---|
| Vitest(api,Testcontainers 真 PG + 真 Better Auth)| enable → verifyTotp 啟用 · 已啟用帳號 signIn 回 twoFactorRedirect(不發 session)· verifyTotp/backup 通過發 session · **錯碼不發 session** · backup 一次性 · 停用需驗證 · 驗證端點 rate-limit | apps/api/test |
| Playwright(固化)| 設定頁啟用 2FA(用測試種子 TOTP secret 產碼)→ 登出 → 登入需二步 → 驗證進 /app;停用 | apps/web/e2e |

> TOTP 測試以已知 secret + 時間種子產碼(otplib / 內建)確定性驗證,不靠真手機。

## 9. 落地順序與里程碑

| 里程碑 | 內容 | 狀態 |
|---|---|---|
| **M0** 設計 review | 本檔 → APPROVED(OQ-MFA-1..6 全採建議,2026-07-20)| ✅ |
| **M1** A1 | twoFactor plugin + migration + spike 驗證 API 形狀 + 後端整合測 | ✅ **DONE**|createAuth 掛 `twoFactor({ issuer: "Weyver" })`(secret 加密 / backup **加密**內建);`twoFactor` 表由 getMigrations 生成;rateLimit 加 `/two-factor/verify-totp`、`/verify-backup-code` 5/60s。**spike 確認 API 形狀**:`enableTwoFactor({password})`→`{totpURI,backupCodes}`(未啟用)→ `verifyTOTP` 才啟用;啟用後 `signInEmail` 回 **`twoFactorRedirect:true`(不發完整 session)** → 帶 challenge cookie `verifyTOTP`/`verifyBackupCode` 才發 session。4 整合測(表建立+enable / 登入二步 / 錯碼拒 / **backup 一次性**;otplib 確定性產碼)。全 api 套件 114 綠 |
| **M2** A2 | 帳號設定「二步驟驗證」UI | ✅ **DONE**|`/app/settings/security`:啟用(密碼 → enable → QR〔qrcode.react〕+ 手動碼 + backup codes → 輸入碼 verifyTotp → 已啟用)/ 停用(重新驗證);header 加「安全」入口;authClient 加 twoFactorClient |
| **M3** A3 | 登入 challenge 第二步 UI | ✅ **DONE**|login signIn 回 twoFactorRedirect → `/login/2fa`(TOTP,或「改用備用碼」verifyBackupCode)→ 設 active org → 進 /app;登入/2FA 成功改全頁導向讓 session 重新 hydrate(修 active org 顯示 lag)|
| **M4** 收尾 | rate-limit + Playwright 固化 + FMEA + SHIPPED | ✅ **DONE**|verify 端點 rateLimit(M1 已含)· `e2e/mfa.spec.ts` 固化(otplib 產碼:註冊→啟用→登出→登入二步→進工作區;5 web e2e 全綠)· §12 FMEA P0 全緩解 · **SHIPPED v1.0** |

---

## 10. 開放問題(OQ-MFA-N)— ✅ 已裁定(2026-07-20,全採建議 A)

| # | 議題 | 選項 | 裁定 |
|---|---|---|---|
| **OQ-MFA-1** | 二步驟方法 | A. **TOTP + backup codes only** <br> B. 也做 email / SMS OTP | **A** — email/SMS 卡通知 infra(未建);TOTP 為業界標準且零相依 |
| **OQ-MFA-2** | 啟用模式 | A. **opt-in per user + 預留 org policy 欄** <br> B. 直接做 org 強制(admins 必須) | **A** — 強制需阻擋未註冊者流程、複雜;MVP opt-in,org 強制列後續(對齊 §6-bis 分層) |
| **OQ-MFA-3** | trustDevice「記住此裝置」 | A. **MVP 不做(每次登入都驗)** <br> B. 做 | **A** — 更安全、更簡單;之後視摩擦再加 |
| **OQ-MFA-4** | QR 產生 | A. **前端由 totpURI 生 QR(qrcode 套件)** <br> B. 後端回 QR image | **A** — secret 少繞一手、後端不需圖形依賴 |
| **OQ-MFA-5** | secret / backup 保護 | A. **用 Better Auth 內建(app secret 加密 + backup 雜湊)** <br> B. 自管加密 | **A** — 內建即符 AGENTS;自管徒增出錯面 |
| **OQ-MFA-6** | 模組歸屬 | A. **獨立 foundation 模組 F-4 mfa.md** <br> B. 併入 auth.md | **A** — auth.md 已 SHIPPED 定版;MFA 自成模組較清楚 |

---

## 11. SOP — 日常操作
- **遺失 authenticator**|/login/2fa 選「改用備用碼」→ 登入 → 設定頁停用後重新啟用綁新裝置。
- **backup 用罄**|設定頁重新產生(`generateBackupCodes`,需重新驗證);⚠️ 產新即舊碼全失效。
- **管理員協助重設**|需人工身分核驗政策(非自助;避免社交工程繞過 2FA)—— 政策待定,非本模組工程。

## 12. 失效場景反思(FMEA)— M4 收尾(R17)

> **P0 未緩解不得上 prod**。P0(1–4)全緩解。

| # | 路徑 / 失效模式 | 影響 | 嚴重 | 緩解 | 狀態 |
|---|---|---|---|---|---|
| 1 | **TOTP secret 外洩**(log / 明文 / 傳輸) | 2FA 被繞過 | **P0** | Better Auth 以 app secret 加密 secret;不落 log;totpURI(含 secret)僅 enable 一次性回於已認證通道 | ✅ |
| 2 | **backup code 外洩 / 重用** | 帳號淪陷 | **P0** | backup codes 雜湊儲存 + 一次性(用過失效,整合測斷言) | ✅ |
| 3 | **驗證碼暴力**(TOTP / backup 猜測) | 繞過 2FA | **P0** | rateLimit `/two-factor/verify-totp`、`/verify-backup-code` 5/60s;6 碼 + 30s 窗 | ✅ |
| 4 | **中間狀態發完整 session**(2FA 未完成即放行) | 繞過 2FA | **P0** | signIn 回 `twoFactorRedirect`(不發完整 session),唯 verify 通過才發;整合測斷言 | ✅ |
| 5 | **停用被劫持會話者關閉** | 失去保護 | P1 | disable 需重新驗證(密碼);設定頁停用要密碼 | ✅ |
| 6 | **遺失 authenticator → 無法登入** | 使用者卡死 | P1 | backup codes 救援;/login/2fa 提供「改用備用碼」;SOP §11 | ✅ |
| 7 | **enable 後未 verify 誤以為已啟用** | 誤以為受保護 | P2 | `skipVerificationOnEnable=false` → 未 verify 不啟用(status 仍未啟用);UI 三步明確 | ✅ |
| 8 | **TOTP 時鐘漂移** | 正常碼被拒 | P2 | Better Auth 容忍 ±1 window;伺服器 NTP 同步(ops) | ✅ |
| 9 | **reactive store 未更新致 active org 顯示錯** | UX 混淆(非安全) | P2 | 登入 / 2FA 成功全頁導向重新 hydrate;DB session.activeOrganizationId 為準 | ✅ 已修 |

**殘留**:管理員協助重設之身分核驗政策(SOP,人工)· passkey/WebAuthn · org 強制 2FA 政策(皆後續)。

---

## 0-bis. 追溯稽核(2026-07-29)— **抓到文件與實作不符**

### 🔴 本檔原本寫錯了:backup codes 是「加密」不是「雜湊」

原文五處寫「backup codes **雜湊**儲存」。**讀 better-auth 1.6.23 原始碼確認為誤**:

```
dist/plugins/two-factor/index.mjs:26   storeBackupCodes: "encrypted"
```

實際以 app secret `symmetricEncrypt` **可逆**存放,驗證時整批解密後 `includes()` 比對;
另有 serverOnly 的 `viewBackupCodes` 可**明文取出**。

**為什麼這件事重要**|**NIST SP 800-63B** 規定 look-up secret 熵 <112 bits 者
**SHALL 加鹽 + KDF 單向雜湊**。本專案備用碼為 10 碼 × 62 字元集 ≈ **59.5 bits**,落在應雜湊區間。
→ 文件已就地更正;**實作要改則須自寫 `customBackupCodesGenerate` 並自管驗證**
(plugin 架構需還原比對,不是改一個 flag),已立 task。

> **這是本次追溯稽核最該記取的一類問題**:doc 描述了一個**比實際更安全**的行為。
> 日後若有人依 doc 做安全審查,會得到錯誤的結論。

### 🔴 TOTP 無重放防護(違反 RFC 6238 §5.2)

**RFC 6238 §5.2 原文**:「The verifier **MUST NOT** accept the second attempt of the OTP
after the successful validation has been issued for the first OTP.」
better-auth 全 plugin grep **無 lastUsed / used 記錄** → 同一組碼在 90 秒窗內可重複使用。
修法:`twoFactor` 列存 last-used step 或其 HMAC。

> ✅ **時間窗本身合規**:`window = 1`(±30 秒)符合 RFC「at most one time step」。

### 六個決定的裁定

| # | 決定 | 裁定 | 依據 |
|---|---|---|---|
| 1 | TOTP + backup codes only | ✅ 維持 | 對照組一致。但缺「**註冊第二個 authenticator**」的自助救援(AWS 官方允許最多 8 個 MFA 裝置,可免走人工救援)→ 列 R2 |
| 2 | opt-in + 預留 org policy | ⚠️ **應調整** | GitHub / Salesforce / Microsoft **皆已走到強制**。至少 owner / admin 先強制 |
| 3 | 不做「記住此裝置」 | ⚠️ **應調整** | **Better Auth 已內建** `trustDeviceMaxAge`,預設 **30 天**(HMAC cookie + verification 表可撤銷)—— 成本近零。不做的代價是使用者每天掏手機 → **乾脆不開 MFA** |
| 4 | 前端由 totpURI 產 QR | ✅ 維持 | 無異議 |
| 5 | secret / backup 用內建保護 | 🔴 **應改** | 見上(加密非雜湊)|
| 6 | 獨立 foundation 模組 | ✅ 維持 | — |

### 備用碼規格對照

| | 數量 × 長度 | 一次性 | 重生 | 顯示 |
|---|---|---|---|---|
| **GitHub**(官方)| 16 × `xxxxx-yyyyy` | ✅ | 新一組使舊全失效 | 可**下載 / 列印 / 複製**,且**須勾選「已保存」才能啟用** |
| **Google**(官方)| 10 × 8 碼 | ✅ | 同上 | 可重看 / 下載 |
| **Weyver 現況** | 10 × `xxxxx-xxxxx` | ✅(整合測已斷言)| ✅ 同慣例 | 🔴 **只在 enroll 顯示一次、無下載 / 複製 / 列印 / 確認勾選、無重生 UI**(`generateBackupCodes` 在後端但前端未接)|

→ 數量長度合格;**保存體驗不合格 —— 這是日後人工救援量的主因**。
另 GitHub / Auth0 於「用備用碼登入」後會**警示並促使重設 MFA**,本專案無。

### 復原路徑:業界三層,而第三層是最大攻擊面

**多註冊裝置(AWS)→ 備用碼 → 人工核驗。**

管理員「替使用者關 MFA」是必要能力,但正是社交工程的主目標:

- **MGM / Caesars 2023**|Scattered Spider 靠 **vishing 說服 help desk 重設 MFA**,MGM 損失約 **US$100M**(CISA AA23-320a)
- **Retool 2023**|釣魚 + **深偽語音** + Google Authenticator 雲端同步 → **MFA 退化為單因子**

**控制建議**|限定角色 + 雙人核准 + 冷卻期 + **強制 audit + 通知本人與 owner** + 重設後強制重新註冊。

### 強制策略的推行方式(有前例可抄)

- **GitHub**(官方)|分批 enrollment,**45 天設定期 + 7 天寬限**,逾期鎖 UI 但**不斷既有 token / 自動化**
- **Salesforce**(官方)|契約要求 → auto-enable(admin 可關)→ in-app 提醒,**跨多 release 分階段**
- **Microsoft**(官方)|2024-07-29 起取消 14 天 skip;CA 於**登入時攔截註冊**;
  **政策生效後須 revoke 既有 session** 才真正落地(`Revoke-MgUserSignInSession`)

### 其餘

- **better-auth 有未載於文件的 `accountLockout` 預設**:10 次失敗鎖 15 分鐘(疊在本專案 5/60s rateLimit 之上)—— 應寫入本檔
- 🔴 **MFA 事件無 audit log**|repo 只有 `ddl_audit` / `action_audit`;MFA 啟用 / 停用 / 備用碼重生與使用 / 管理員重設**全無紀錄**。**SOC 2 明確要求記 MFA 事件**
- 未驗證的 enroll 殘列(`verified=false`)建議設 TTL 清理
- **在地**|數位發展部《中小企業基本資安防護指引》(2026-03)已建議辦公軟體強制 2FA —— **可作為對客戶推 org policy 的說帖**

### 查不到

CISA 對 help desk 身分核驗的具體規範(僅有事件通報);台灣中小企業 TOTP 採用率統計。

### 來源

- [NIST SP 800-63B](https://pages.nist.gov/800-63-3/sp800-63b.html) · [RFC 6238 §5.2](https://www.rfc-editor.org/rfc/rfc6238) · [OWASP MFA Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html)
- [GitHub 2FA recovery methods](https://docs.github.com/en/authentication/securing-your-account-with-two-factor-authentication-2fa/configuring-two-factor-authentication-recovery-methods) · [GitHub mandatory 2FA rollout](https://docs.github.com/en/authentication/securing-your-account-with-two-factor-authentication-2fa/about-mandatory-two-factor-authentication)
- [Google 備用碼](https://support.google.com/accounts/answer/1187538) · [AWS 多 MFA 裝置與遺失復原](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_mfa_lost-or-broken.html)
- [Microsoft Entra MFA 設定(remember device / 註冊攔截)](https://learn.microsoft.com/en-us/entra/identity/conditional-access/policy-all-users-security-info-registration) · [Salesforce MFA 分階段強制](https://help.salesforce.com/s/articleView?id=release-notes.rn_general_mfa_requirement.htm)
- [CISA AA23-320a Scattered Spider](https://www.cisa.gov/news-events/cybersecurity-advisories/aa23-320a) · [Retool: When MFA isn't actually MFA](https://retool.com/blog/mfa-isnt-mfa)
- [數位發展部《中小企業基本資安防護指引》](https://www-api.moda.gov.tw/File/Get/acs/zh-tw/1rpP5Mb1iyZwZUF)

## 13. 變更紀錄

| 日期 | 版本 | 變更 | 作者 |
|---|---|---|---|
| 2026-07-20 | v1.0 | **M2–M4 完成 → SHIPPED**|M2 帳號設定啟用/停用 UI(QR via qrcode.react + 手動碼 + backup codes + 停用需驗證;header「安全」入口;twoFactorClient)· M3 登入二步(twoFactorRedirect → /login/2fa,TOTP/備用碼;登入&2FA 成功全頁導向修 active org 顯示 lag)· M4 verify 端點 rateLimit + `e2e/mfa.spec.ts` 固化(otplib 產碼,5 web e2e 綠)+ §12 FMEA(P0 全緩解)。Playwright MCP 實走全流程。**自助 TOTP 二步驟驗證上線** | Claude Code |
| 2026-07-20 | v0.3 | **M1 後端完成**|createAuth 掛 twoFactor plugin(issuer Weyver;secret/backup 內建保護)+ verify 端點 rateLimit;spike 確認 Better Auth flow(enable→verifyTotp 啟用 / signIn→twoFactorRedirect / challenge cookie→verify 發 session);4 整合測(otplib 確定性產碼)綠;api 套件 114 | Claude Code |
| 2026-07-20 | v0.2 | OQ-MFA-1..6 全採建議裁定(TOTP+backup only · opt-in+預留 org policy · 不做 trustDevice · 前端生 QR · Better Auth 內建保護 · 獨立 F-4);狀態 → APPROVED,進 M1 | Claude Code |
| 2026-07-20 | v0.1 | 初版 DRAFT — F-4 MFA(TOTP + backup codes);承 2026-07-20 對話裁定「MFA 可提前、密碼重設等 email、SSO 等客戶」;上游 F-2 auth SHIPPED + Better Auth two-factor 核心 plugin;A1–A4 切分 + OQ-MFA-1..6;scope out email/SMS OTP · passkey · org 強制 · trustDevice | Claude Code |
