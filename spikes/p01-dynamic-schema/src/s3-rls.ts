/* S3|動態表 RLS FORCE 隔離驗證:app 角色 / owner(FORCE)/ 無 context / 跨租戶 DML / superuser 對照 */
import type { Knex } from "knex"
import { createDb } from "./db.js"

const SCHEMA = "data_s3"

async function inTenantTx<T>(
  db: Knex,
  tenantId: number | null,
  fn: (trx: Knex.Transaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (trx) => {
    // SET LOCAL 不可參數綁定;production 正解 = set_config(..., true)(交易範圍,等價 SET LOCAL)
    if (tenantId !== null)
      await trx.raw(`SELECT set_config('app.tenant_id', ?, true)`, [String(tenantId)])
    return fn(trx)
  })
}

function check(name: string, pass: boolean, detail: string): void {
  console.log(`${pass ? "✅" : "❌"} ${name} — ${detail}`)
  if (!pass) process.exitCode = 1
}

async function main(): Promise<void> {
  const admin = createDb()
  console.log("S3|RLS FORCE isolation on dynamic table")

  await admin.raw(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`)
  await admin.raw(`DROP ROLE IF EXISTS spike_owner`)
  await admin.raw(`DROP ROLE IF EXISTS spike_app`)
  await admin.raw(`CREATE ROLE spike_owner LOGIN PASSWORD 'spike_owner' NOSUPERUSER NOBYPASSRLS`)
  await admin.raw(`CREATE ROLE spike_app LOGIN PASSWORD 'spike_app' NOSUPERUSER NOBYPASSRLS`)
  await admin.raw(`CREATE SCHEMA ${SCHEMA} AUTHORIZATION spike_owner`)

  const owner = createDb({ user: "spike_owner", password: "spike_owner" }, 3)
  await owner.raw(`
    CREATE TABLE ${SCHEMA}.t1 (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      tenant_id bigint NOT NULL, f1 text
    );
    ALTER TABLE ${SCHEMA}.t1 ENABLE ROW LEVEL SECURITY;
    ALTER TABLE ${SCHEMA}.t1 FORCE ROW LEVEL SECURITY;
    -- NULLIF 必要:custom GUC 於 session 內 set 過後,reset 值為 '' 而非 NULL,''::bigint 會炸(22P02)
    CREATE POLICY tenant_isolation ON ${SCHEMA}.t1
      USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);
  `)
  await admin.raw(`GRANT USAGE ON SCHEMA ${SCHEMA} TO spike_app`)
  await admin.raw(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${SCHEMA}.t1 TO spike_app`)

  const app = createDb({ user: "spike_app", password: "spike_app" }, 3)

  // 種資料:各租戶 3 列(以 app 角色 + 各自 context 寫入)
  for (const t of [1, 2]) {
    await inTenantTx(app, t, async (trx) => {
      await trx.raw(
        `INSERT INTO ${SCHEMA}.t1 (tenant_id, f1) SELECT ?, 'row' || g FROM generate_series(1,3) g`,
        [t],
      )
    })
  }

  // 1|app 角色只見自己租戶
  for (const t of [1, 2]) {
    const r = await inTenantTx(app, t, (trx) =>
      trx.raw(`SELECT tenant_id, count(*) c FROM ${SCHEMA}.t1 GROUP BY tenant_id`),
    )
    const rows = r.rows as { tenant_id: string; c: string }[]
    check(
      `app SELECT tenant=${t}`,
      rows.length === 1 && rows[0]?.tenant_id === String(t) && rows[0]?.c === "3",
      JSON.stringify(rows),
    )
  }

  // 2|WITH CHECK 擋跨租戶寫入
  const crossInsert = await inTenantTx(app, 1, (trx) =>
    trx.raw(`INSERT INTO ${SCHEMA}.t1 (tenant_id, f1) VALUES (2, 'evil')`).then(
      () => "inserted",
      (e: unknown) => (e as Error).message,
    ),
  )
  check(
    "app INSERT tenant_id=2 under context=1 被拒",
    crossInsert !== "inserted",
    String(crossInsert).slice(0, 80),
  )

  // 3|無 context → 0 列(current_setting null → policy false)
  const noCtx = await inTenantTx(app, null, (trx) => trx.raw(`SELECT count(*) c FROM ${SCHEMA}.t1`))
  check(
    "app 無 tenant context → 0 列",
    (noCtx.rows as { c: string }[])[0]?.c === "0",
    JSON.stringify(noCtx.rows),
  )

  // 4|跨租戶 UPDATE / DELETE → 0 rows affected
  const upd = await inTenantTx(app, 1, (trx) =>
    trx.raw(`UPDATE ${SCHEMA}.t1 SET f1 = 'hack' WHERE tenant_id = 2`),
  )
  check(
    "app UPDATE 他租戶 → 0 affected",
    (upd as { rowCount: number }).rowCount === 0,
    `rowCount=${(upd as { rowCount: number }).rowCount}`,
  )
  const del = await inTenantTx(app, 1, (trx) =>
    trx.raw(`DELETE FROM ${SCHEMA}.t1 WHERE tenant_id = 2`),
  )
  check(
    "app DELETE 他租戶 → 0 affected",
    (del as { rowCount: number }).rowCount === 0,
    `rowCount=${(del as { rowCount: number }).rowCount}`,
  )

  // 5|owner 在 FORCE 下同受 RLS(這就是 FORCE 的意義)
  const ownerSel = await inTenantTx(owner, 1, (trx) =>
    trx.raw(`SELECT count(*) c FROM ${SCHEMA}.t1`),
  )
  check(
    "owner(FORCE)context=1 只見 3 列",
    (ownerSel.rows as { c: string }[])[0]?.c === "3",
    JSON.stringify(ownerSel.rows),
  )

  // 6|superuser 對照:無視 RLS(⇒ app / migration 角色絕不可 superuser / BYPASSRLS)
  const su = await admin.raw(`SELECT count(*) c FROM ${SCHEMA}.t1`)
  check(
    "superuser 對照可見全部(6)— 故 app 角色禁 superuser",
    (su.rows as { c: string }[])[0]?.c === "6",
    JSON.stringify(su.rows),
  )

  await Promise.all([admin.destroy(), owner.destroy(), app.destroy()])
  console.log(process.exitCode === 1 ? "S3 FAILED" : "S3 ALL PASS")
}

main().catch((e: unknown) => {
  console.error(e)
  process.exit(1)
})
