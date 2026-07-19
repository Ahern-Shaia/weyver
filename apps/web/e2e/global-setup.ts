import { execSync } from "node:child_process"
import pg from "pg"

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://weyver:weyver_dev@127.0.0.1:5433/weyver"

/* e2e 前置:migration(冪等)+ 確保存在 tenant 1(dev guard 預設租戶;fresh DB 首插即 id 1)。
   前提:PG 已啟(docker compose up -d postgres)。 */
export default async function globalSetup(): Promise<void> {
  execSync("pnpm --filter @weyver/api db:migrate", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL },
  })
  // Better Auth 自管 schema(auth.spec 需 user/session/organization 表)
  execSync("pnpm --filter @weyver/api db:migrate:auth", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL },
  })

  const pool = new pg.Pool({ connectionString: DATABASE_URL })
  try {
    const existing = await pool.query("SELECT id FROM tenants WHERE id = 1")
    if (existing.rows.length === 0) {
      await pool.query(
        "INSERT INTO tenants (name) SELECT 'e2e 廠' WHERE NOT EXISTS (SELECT 1 FROM tenants)",
      )
    }
  } finally {
    await pool.end()
  }
}
