/* S2|並發 DDL:異表並行 / 同表無鎖並發 / 同表 advisory lock 序列化 / DDL 期間讀者延遲 */
import type { Knex } from "knex"
import { createDb, fmt, timed } from "./db.js"

const SCHEMA = "data_s2"
const WORKERS = 10

async function setup(db: Knex): Promise<void> {
  await db.raw(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`)
  await db.raw(`CREATE SCHEMA ${SCHEMA}`)
  const stmts = Array.from(
    { length: WORKERS },
    (_, i) => `
      CREATE TABLE ${SCHEMA}.t${i + 1} (
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        tenant_id bigint NOT NULL, f1 text
      );`,
  ).join("\n")
  await db.raw(stmts)
  await db.raw(
    `INSERT INTO ${SCHEMA}.t1 (tenant_id, f1) SELECT 1, 'x' FROM generate_series(1, 10000)`,
  )
}

async function main(): Promise<void> {
  const db = createDb({}, WORKERS + 5)
  console.log(`S2|concurrent DDL, workers=${WORKERS}`)
  await setup(db)

  // A|異表並行 ADD COLUMN — 預期互不阻塞
  const a = await timed(() =>
    Promise.all(
      Array.from({ length: WORKERS }, (_, i) =>
        db.raw(`ALTER TABLE ${SCHEMA}.t${i + 1} ADD COLUMN a_col text`),
      ),
    ),
  )
  console.log(`A 異表並行 ${WORKERS} × ADD COLUMN: ${fmt(a.ms)}`)

  // B|同表並發 ADD COLUMN(無 advisory lock)— 排 ACCESS EXCLUSIVE 隊
  const b = await timed(() =>
    Promise.all(
      Array.from({ length: WORKERS }, (_, i) =>
        db.raw(`ALTER TABLE ${SCHEMA}.t1 ADD COLUMN b_col${i} text`),
      ),
    ),
  )
  console.log(`B 同表並發 ${WORKERS} × ADD COLUMN(無 lock): ${fmt(b.ms)}`)

  // C|同表並發 + per-form advisory lock(formId=1)— 設計採用之序列化
  const c = await timed(() =>
    Promise.all(
      Array.from({ length: WORKERS }, (_, i) =>
        db.transaction(async (trx) => {
          await trx.raw(`SELECT pg_advisory_xact_lock(1)`)
          await trx.raw(`ALTER TABLE ${SCHEMA}.t1 ADD COLUMN c_col${i} text`)
        }),
      ),
    ),
  )
  console.log(`C 同表並發 ${WORKERS} × ADD COLUMN(advisory lock): ${fmt(c.ms)}`)

  // D|DDL 風暴期間讀者延遲(worst case:volatile DEFAULT 強制全表 rewrite,鎖持有時間拉長)
  await db.raw(
    `INSERT INTO ${SCHEMA}.t1 (tenant_id, f1) SELECT 1, 'y' FROM generate_series(1, 190000)`,
  )
  const readLatencies: number[] = []
  let stop = false
  const reader = (async () => {
    while (!stop) {
      const { ms } = await timed(() => db.raw(`SELECT count(*) FROM ${SCHEMA}.t1`))
      readLatencies.push(ms)
      await new Promise((r) => setTimeout(r, 5))
    }
  })()
  await Promise.all(
    Array.from({ length: 5 }, (_, i) =>
      db.transaction(async (trx) => {
        await trx.raw(`SELECT pg_advisory_xact_lock(1)`)
        await trx.raw(`SET LOCAL statement_timeout = '10s'`)
        // volatile default → 全表 rewrite(ACCESS EXCLUSIVE 持鎖到 rewrite 完)= 最壞情境
        await trx.raw(
          `ALTER TABLE ${SCHEMA}.t1 ADD COLUMN d_col${i} double precision DEFAULT random()`,
        )
      }),
    ),
  )
  stop = true
  await reader
  const sorted = [...readLatencies].sort((x, y) => x - y)
  const p50 = sorted[Math.floor(sorted.length / 2)] ?? 0
  const worst = sorted[sorted.length - 1] ?? 0
  console.log(
    `D 讀者延遲 during rewrite-DDL(200K 列表): p50 ${fmt(p50)} | worst ${fmt(worst)} | samples ${readLatencies.length}`,
  )
  console.log(`  (對照:nullable ADD COLUMN 無 rewrite,B/C 已證毫秒級)`)

  await db.destroy()
}

main().catch((e: unknown) => {
  console.error(e)
  process.exit(1)
})
