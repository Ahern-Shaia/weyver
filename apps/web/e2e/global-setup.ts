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
    await purgePreviousRunArtifacts(pool)
  } finally {
    await pool.end()
  }
}

/* e2e 產物回收(2026-07-28)。

   **問題**|每次跑 e2e 都建約 20 張表卻從不清理;累積到 250+ 張後,工作區/設計器的表單清單
   載入變慢,全套執行開始隨機逾時(個別跑都過)。這已三度干擾判讀。

   **做法**|以**命名慣例**回收:所有 spec(UI 建表與 API 建表)一律以 `E2E` 前綴命名,
   故一條 soft delete 即可涵蓋兩者,且**不會碰到手建的 dev 資料**(名稱不以 E2E 起始)。

   **為何在 setup 而非 teardown**|(a) 上一輪若中途崩潰,teardown 不會執行 → 髒資料仍累積;
   setup 清理則恆等冪且可自我修復;(b) 失敗後產物**留在原地可供查因**,下一輪才清掉。

   **為何只 soft delete**|應用各處一律以 `deleted_at IS NULL` 過濾,清單長度即回到常數,
   逾時症狀因此消失。物理表(`data.t*`)保留:P0-1 spike 已實證 10K 表仍近線性,
   而刪表會讓 metadata 與物理狀態分歧、反而不利事後查因。要徹底重置就重建 dev DB。 */
async function purgePreviousRunArtifacts(pool: pg.Pool): Promise<void> {
  const forms = await pool.query<{ count: string }>(
    `UPDATE form_def SET deleted_at = now()
     WHERE name LIKE 'E2E%' AND deleted_at IS NULL`,
  )
  await pool.query(
    `UPDATE field_def SET deleted_at = now()
     WHERE deleted_at IS NULL
       AND form_id IN (SELECT id FROM form_def WHERE name LIKE 'E2E%')`,
  )
  const purged = forms.rowCount ?? 0
  if (purged > 0) console.info(`[e2e] 回收上一輪產物:${String(purged)} 張表單`)
}
