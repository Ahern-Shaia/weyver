/* S1|catalog 壓測:10K 真實表(每表 ~12 欄 + RLS policy),量建表衰退 / catalog 膨脹 / 查詢 plan */
import { createDb, fmt, timed } from "./db.js"

const TOTAL = 10_000
const BATCH = 100
const SCHEMA = "data_s1"

function tableDdl(i: number): string {
  const t = `${SCHEMA}.t${i}`
  return `
    CREATE TABLE ${t} (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      tenant_id bigint NOT NULL,
      f1 text, f2 text, f3 numeric, f4 numeric(19,4), f5 timestamptz,
      f6 date, f7 boolean, f8 text[],
      version int NOT NULL DEFAULT 1,
      created_at timestamptz NOT NULL DEFAULT now(),
      deleted_at timestamptz
    );
    ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;
    ALTER TABLE ${t} FORCE ROW LEVEL SECURITY;
    CREATE POLICY tenant_isolation ON ${t}
      USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);
    CREATE INDEX ON ${t} (tenant_id);
  `
}

async function main(): Promise<void> {
  const db = createDb()
  console.log(`S1|${TOTAL} tables × ~12 cols + RLS policy + index, batch=${BATCH}`)
  await db.raw(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`)
  await db.raw(`CREATE SCHEMA ${SCHEMA}`)

  const batchTimes: number[] = []
  const overall = process.hrtime.bigint()
  for (let b = 0; b < TOTAL / BATCH; b++) {
    const stmts = Array.from({ length: BATCH }, (_, k) => tableDdl(b * BATCH + k + 1)).join("\n")
    const { ms } = await timed(() => db.raw(`BEGIN; ${stmts} COMMIT;`))
    batchTimes.push(ms)
    if ((b + 1) % 10 === 0)
      console.log(
        `  batch ${b + 1}/${TOTAL / BATCH}: ${fmt(ms)} (${(ms / BATCH).toFixed(1)}ms/table)`,
      )
  }
  const totalMs = Number(process.hrtime.bigint() - overall) / 1e6
  const first10 = batchTimes.slice(0, 10).reduce((a, x) => a + x, 0) / 10 / BATCH
  const last10 = batchTimes.slice(-10).reduce((a, x) => a + x, 0) / 10 / BATCH
  console.log(
    `total create: ${fmt(totalMs)} | per-table first10batch ${first10.toFixed(1)}ms vs last10batch ${last10.toFixed(1)}ms (degradation x${(last10 / first10).toFixed(2)})`,
  )

  const cat = await db.raw(`
    SELECT
      (SELECT count(*) FROM pg_class) AS pg_class_rows,
      (SELECT count(*) FROM pg_attribute) AS pg_attribute_rows,
      (SELECT count(*) FROM pg_policy) AS pg_policy_rows,
      pg_size_pretty(pg_total_relation_size('pg_catalog.pg_class')) AS pg_class_size,
      pg_size_pretty(pg_total_relation_size('pg_catalog.pg_attribute')) AS pg_attribute_size,
      pg_size_pretty(pg_database_size(current_database())) AS db_size
  `)
  console.log("catalog:", cat.rows[0])

  for (const i of [1, 5000, 9999]) {
    const t = `${SCHEMA}.t${i}`
    await db.raw(
      `INSERT INTO ${t} (tenant_id, f1, f3) SELECT 1, 'x' || g, g FROM generate_series(1,100) g`,
    )
    const cold = await timed(() => db.raw(`SELECT count(*), sum(f3) FROM ${t} WHERE tenant_id = 1`))
    const warm = await timed(() => db.raw(`SELECT count(*), sum(f3) FROM ${t} WHERE tenant_id = 1`))
    console.log(`query t${i}: cold(plan+relcache) ${fmt(cold.ms)} | warm ${fmt(warm.ms)}`)
  }

  const list = await timed(() =>
    db.raw(`SELECT count(*) FROM pg_tables WHERE schemaname = ?`, [SCHEMA]),
  )
  console.log(`pg_tables listing over ${TOTAL}: ${fmt(list.ms)}`)

  await db.destroy()
}

main().catch((e: unknown) => {
  console.error(e)
  process.exit(1)
})
