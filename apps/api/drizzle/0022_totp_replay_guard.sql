-- 🔴 TOTP 重放防護(追溯稽核 #111)
--
-- RFC 6238 §5.2 原文:「The verifier MUST NOT accept the second attempt of the OTP
-- after the successful validation has been issued for the first OTP.」
-- better-auth 1.6.23 全 plugin 無 lastUsed / used 記錄 → 同一組六位碼在 90 秒窗內
-- (window=1,即 ±30 秒)可被重複使用。
--
-- **獨立表而非在 "twoFactor" 加欄**|該表由 better-auth 的 getMigrations 建立與管理,
-- 在它身上加欄會與其 schema 所有權衝突(測試環境的建表順序即已踩到)。
-- 這裡存的是「上次成功驗證的 time step」——單調遞增整數,不含機密,
-- 且天然涵蓋整個時間窗(同一 step 內的碼相同)。
CREATE TABLE IF NOT EXISTS public.totp_replay_guard (
  auth_user_id   text PRIMARY KEY,
  last_used_step bigint NOT NULL,
  updated_at     timestamptz NOT NULL DEFAULT now()
);
