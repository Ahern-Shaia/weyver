# mfa.md — [F-4] 二步驟驗證(MFA / TOTP) 設計文件

> 🚧 **APPROVED · M1 ✅**(後端 twoFactor plugin + spike 確認 flow + 4 整合測);續 M2(設定啟用/停用 UI)。OQ-MFA-1..6 全採建議(2026-07-20 裁定)。
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
1. **自助啟用 / 停用 TOTP**|使用者於帳號設定啟用 → 產生 secret → 顯示 QR + 手動碼 → 輸入一次性碼驗證 → 啟用並顯示 **backup codes**(一次性,雜湊儲存,遺失 app 時救援)。
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
| **A1 plugin + 後端** | createAuth 掛 `twoFactor({ issuer })`;secret 加密 + backup 雜湊(內建);migration;登入 challenge 語意 | 中 |
| **A2 啟用 / 停用 UI** | 帳號設定「二步驟驗證」:啟用 → QR(由 totpURI 前端生)+ 手動碼 → 驗證 → 顯示 backup codes;停用(重新驗證) | 中 |
| **A3 登入 challenge UI** | login 密碼步後若 `twoFactorRedirect` → 導向 `/login/2fa` 輸入 TOTP / backup → verify → 進 /app | 中 |
| **A4 安全 + 測試** | 驗證端點 rate-limit;backup 一次性;停用需驗證;整合測 + Playwright 固化 | 中(安全) |

---

## 4. A1|two-factor plugin(後端)

- `betterAuth({ plugins: [ twoFactor({ issuer: "Weyver" }), organization(...) ] })`。issuer 顯示於 authenticator app。
- **secret 保護**|Better Auth 以 app secret 加密 TOTP secret、雜湊 backup codes(沿用 F-2 `BETTER_AUTH_SECRET`,prod fail-fast 已具備)。
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

- **secret / backup 保護**|TOTP secret 加密、backup codes 雜湊(Better Auth 內建,用 app secret)—— 不落 log、不回傳明文。
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
| **M1** A1 | twoFactor plugin + migration + spike 驗證 API 形狀 + 後端整合測 | ✅ **DONE**|createAuth 掛 `twoFactor({ issuer: "Weyver" })`(secret 加密/backup 雜湊內建);`twoFactor` 表由 getMigrations 生成;rateLimit 加 `/two-factor/verify-totp`、`/verify-backup-code` 5/60s。**spike 確認 API 形狀**:`enableTwoFactor({password})`→`{totpURI,backupCodes}`(未啟用)→ `verifyTOTP` 才啟用;啟用後 `signInEmail` 回 **`twoFactorRedirect:true`(不發完整 session)** → 帶 challenge cookie `verifyTOTP`/`verifyBackupCode` 才發 session。4 整合測(表建立+enable / 登入二步 / 錯碼拒 / **backup 一次性**;otplib 確定性產碼)。全 api 套件 114 綠 |
| **M2** A2 | 帳號設定「二步驟驗證」UI(啟用 QR + backup codes + 停用)| ⬜ |
| **M3** A3 | 登入 challenge 第二步 UI(`/login/2fa`,TOTP + backup)| ⬜ |
| **M4** 收尾 | 安全硬化(驗證端點 rate-limit)+ Playwright 固化 + FMEA + SHIPPED | ⬜ |

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
> M4 收尾填(使用者遺失 authenticator → 用 backup code 登入 → 重新綁定;backup 用罄 → 重產;管理員協助 → 需身分核驗流程)。

## 12. 失效場景反思(FMEA)— 收尾必填(R17)
> M4 收尾逐路徑填(啟用 / 驗證 / backup 一次性 / 停用防護 / 中間狀態不發 session / 驗證暴力 / secret 外洩)。**P0 未緩解不得上 prod**。

## 13. 變更紀錄

| 日期 | 版本 | 變更 | 作者 |
|---|---|---|---|
| 2026-07-20 | v0.3 | **M1 後端完成**|createAuth 掛 twoFactor plugin(issuer Weyver;secret/backup 內建保護)+ verify 端點 rateLimit;spike 確認 Better Auth flow(enable→verifyTotp 啟用 / signIn→twoFactorRedirect / challenge cookie→verify 發 session);4 整合測(otplib 確定性產碼)綠;api 套件 114 | Claude Code |
| 2026-07-20 | v0.2 | OQ-MFA-1..6 全採建議裁定(TOTP+backup only · opt-in+預留 org policy · 不做 trustDevice · 前端生 QR · Better Auth 內建保護 · 獨立 F-4);狀態 → APPROVED,進 M1 | Claude Code |
| 2026-07-20 | v0.1 | 初版 DRAFT — F-4 MFA(TOTP + backup codes);承 2026-07-20 對話裁定「MFA 可提前、密碼重設等 email、SSO 等客戶」;上游 F-2 auth SHIPPED + Better Auth two-factor 核心 plugin;A1–A4 切分 + OQ-MFA-1..6;scope out email/SMS OTP · passkey · org 強制 · trustDevice | Claude Code |
