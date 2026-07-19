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
    // Better Auth 簽章 secret(F-2);prod 必填(見 superRefine),dev/test 回退佔位 secret
    BETTER_AUTH_SECRET: z.string().min(32).optional(),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === "production" && !env.BETTER_AUTH_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["BETTER_AUTH_SECRET"],
        message: "BETTER_AUTH_SECRET is required in production (min 32 chars; inject via Infisical)",
      })
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
