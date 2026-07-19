import pg from "pg"
import { envSchema } from "../config/env.js"
import { runMigrations } from "./migrate.js"

async function main(): Promise<void> {
  const env = envSchema.parse(process.env)
  const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 1 })
  await runMigrations(pool)
  await pool.end()
  console.log("migrations applied")
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
