import { getMigrations } from "better-auth/db/migration"
import pg from "pg"
import { envSchema } from "../config/env.js"
import { createAuth } from "./auth.js"

/* 對 DATABASE_URL 套用 Better Auth 自管 schema(user/account/session/organization/member/…)。
   dev / ops 一次性工具;prod 由部署流程執行(與 Weyver Drizzle migration 分開)。 */
async function main(): Promise<void> {
  const env = envSchema.parse(process.env)
  const pool = new pg.Pool({ connectionString: env.DATABASE_URL })
  const auth = createAuth(pool, env.BETTER_AUTH_SECRET)
  const { runMigrations } = await getMigrations(auth.options)
  await runMigrations()
  await pool.end()
  console.log("better-auth migrations applied")
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
