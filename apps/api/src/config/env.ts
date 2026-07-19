import { z } from "zod"

/* 唯一允許讀 process.env 的地方(AGENTS Config 鐵則);開機 schema 驗證 fail-fast */
export const envSchema = z.object({
  DATABASE_URL: z.string().default("postgres://weyver:weyver_dev@127.0.0.1:5433/weyver"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
})

export type Env = z.infer<typeof envSchema>

export function validateEnv(config: Record<string, unknown>): Env {
  return envSchema.parse(config)
}
