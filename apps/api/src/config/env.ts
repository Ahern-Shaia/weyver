import { z } from "zod"

/* 唯一允許讀 process.env 的地方(AGENTS Config 鐵則);開機 schema 驗證 fail-fast */
export const envSchema = z
  .object({
    // 特權車道:migration + DDL(prod = ddl 角色)
    DATABASE_URL: z.string().default("postgres://weyver:weyver_dev@127.0.0.1:5433/weyver"),
    // app 車道:記錄 DML(prod = weyver_app 登入角色,無 DDL / 無 BYPASSRLS;dev 未設則同 DATABASE_URL)
    APP_DATABASE_URL: z.string().optional(),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  })
  .transform((env) => ({ ...env, APP_DATABASE_URL: env.APP_DATABASE_URL ?? env.DATABASE_URL }))

export type Env = z.infer<typeof envSchema>

export function validateEnv(config: Record<string, unknown>): Env {
  return envSchema.parse(config)
}
