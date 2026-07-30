import { z } from "zod"

/* dev/test 專用佔位 secret(非真實密鑰;production 一律 fail-fast 要求由 Infisical 注入 —— AGENTS 🔒-6) */
const DEV_ONLY_AUTH_SECRET = "dev-only-insecure-better-auth-secret-change-me"

/* 唯一允許讀 process.env 的地方(AGENTS Config 鐵則);開機 schema 驗證 fail-fast */
export const envSchema = z
  .object({
    // 特權車道:migration + DDL(prod = ddl 角色)
    DATABASE_URL: z.string().default("postgres://weyver:weyver_dev@127.0.0.1:5433/weyver"),
    // app 車道:記錄 DML(prod = weyver_app 登入角色,無 DDL / 無 BYPASSRLS;dev 未設則同 DATABASE_URL)
    APP_DATABASE_URL: z.string().optional(),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    /* 🔴 部署環境的**顯式**宣告,無預設值。

       **為什麼不能只靠 NODE_ENV**|它有 `.default("development")`,而兩道防線都掛在
       `NODE_ENV === "production"` 上:(a) TenantGuard 的認證強制、(b) BETTER_AUTH_SECRET
       的 fail-fast。prod 部署漏設 NODE_ENV 時**兩者同時靜默失效** ——
       任何人送 `x-dev-tenant: N` 即取得該租戶且 isSuperAdmin,同時 secret 回退成硬編碼值。
       單一環境變數遺漏即全開,且不會有任何錯誤訊息。

       故另立一個**無預設、prod 必須顯式設定**的旗標:設為 "1" 即進入強制模式,
       且與 NODE_ENV 取「或」—— 任一為 prod 語意即強制,只能加嚴不能放寬。 */
    WEYVER_ENFORCE_PROD_SECURITY: z.enum(["0", "1"]).optional(),
    // dev/test 開關:設 "1" 則即使非 prod 也走真實 session 認證(測 auth-gate 用)。
    // prod 一律強制認證,不受此旗標影響(見 TenantGuard)。預設關 → dev 免登入(x-dev-tenant)。
    ENFORCE_AUTH: z.enum(["0", "1"]).default("0"),
    // Better Auth 簽章 secret(F-2);prod 必填(見 superRefine),dev/test 回退佔位 secret
    BETTER_AUTH_SECRET: z.string().min(32).optional(),
    // Better Auth 對外 baseURL(消 origin 推導警告 + callback 正確);dev 預設本機
    BETTER_AUTH_URL: z.string().url().default("http://localhost:3000"),
    // CSRF / origin 白名單(逗號分隔);dev 含 web 開發站與 api 本機
    BETTER_AUTH_TRUSTED_ORIGINS: z
      .string()
      .default("http://localhost:3000,http://localhost:3002,http://localhost:3001"),
    /* F-5 檔案儲存(OQ-FS-1=A):local = dev / on-prem 自 host;s3 = S3 相容(R2 / S3 / GCS / MinIO)。
       prod 選 s3 時 bucket/keys 必填(見 superRefine),避免執行期才爆(FMEA S8)。 */
    STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
    // local 驅動根目錄:**必須位於 webroot 外**(docs/22);預設為 repo 外的暫存目錄
    /* 🔴 F-11|掃毒模式。`off` 時上傳一律標 `skipped`(不掃、可下載),
       `required` 時標 `pending`(掃完才可下載)。

       預設 `off` 是**過渡期的刻意選擇**:掃毒器(M3)尚未接上,
       若預設 `required` 會讓所有 PDF / Office 附件立刻下不了。
       但 prod 用 `off` 必須**顯式承認**(見 env.ts 的 refine)——
       不讓「忘了設定」與「決定不掃」長得一樣。 */
    MALWARE_SCAN_MODE: z.enum(["off", "required"]).default("off"),
    MALWARE_SCAN_ACK_DISABLED: z.string().optional(),
    STORAGE_LOCAL_DIR: z.string().default(".weyver-storage"),
    STORAGE_BUCKET: z.string().optional(),
    STORAGE_ENDPOINT: z.string().url().optional(),
    STORAGE_REGION: z.string().default("auto"),
    STORAGE_ACCESS_KEY: z.string().optional(),
    STORAGE_SECRET_KEY: z.string().optional(),
    // 單檔上限 MB(另有 Fastify multipart limits 兜底)
    STORAGE_MAX_FILE_MB: z.coerce.number().int().min(1).max(200).default(20),
    // 每租戶總量配額 MB(0 = 不限)
    STORAGE_TENANT_QUOTA_MB: z.coerce.number().int().min(0).default(2048),
  })
  .superRefine((env, ctx) => {
    const prodSecurity =
      env.NODE_ENV === "production" || env.WEYVER_ENFORCE_PROD_SECURITY === "1"
    if (prodSecurity && !env.BETTER_AUTH_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["BETTER_AUTH_SECRET"],
        message:
          "BETTER_AUTH_SECRET is required in production (min 32 chars; inject via Infisical)",
      })
    }
    /* 🔴 app 車道未設時會回落到 DATABASE_URL(migration 特權角色)→ RLS 不執法。
       這種失效是靜默的:查詢照常回資料,只是跨租戶。prod 寧可起不來。 */
    if (prodSecurity && (!env.APP_DATABASE_URL || env.APP_DATABASE_URL === env.DATABASE_URL)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["APP_DATABASE_URL"],
        message:
          "APP_DATABASE_URL is required in production and must differ from DATABASE_URL " +
          "(point it at a LOGIN role granted weyver_app; the migration role bypasses RLS)",
      })
    }
    /* 🔴 prod 關閉掃毒必須顯式承認 —— 否則「忘了設定」與「決定不掃」長得一樣,
       而前者會在稽核時變成「你說有掃但其實沒有」。同 APP_DATABASE_URL 的 fail-fast 精神。 */
    if (
      env.NODE_ENV === "production" &&
      env.MALWARE_SCAN_MODE === "off" &&
      env.MALWARE_SCAN_ACK_DISABLED !== "1"
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["MALWARE_SCAN_MODE"],
        message:
          "production 下停用掃毒需顯式承認:設 MALWARE_SCAN_ACK_DISABLED=1,或改用 MALWARE_SCAN_MODE=required",
      })
    }
    if (env.STORAGE_DRIVER === "s3") {
      for (const key of ["STORAGE_BUCKET", "STORAGE_ACCESS_KEY", "STORAGE_SECRET_KEY"] as const) {
        if (!env[key]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `${key} is required when STORAGE_DRIVER=s3 (inject via Infisical)`,
          })
        }
      }
    }
  })
  .transform((env) => ({
    ...env,
    APP_DATABASE_URL: env.APP_DATABASE_URL ?? env.DATABASE_URL,
    BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET ?? DEV_ONLY_AUTH_SECRET,
  }))

export type Env = z.infer<typeof envSchema>

export function validateEnv(config: Record<string, unknown>): Env {
  return envSchema.parse(config)
}
