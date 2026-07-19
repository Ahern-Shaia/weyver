import knex, { type Knex } from "knex"

export const CONN = {
  host: "127.0.0.1",
  port: 5433,
  database: "weyver",
  user: "weyver",
  password: "weyver_dev",
}

export function createDb(overrides: Partial<typeof CONN> = {}, poolMax = 10): Knex {
  return knex({
    client: "pg",
    connection: { ...CONN, ...overrides },
    pool: { min: 0, max: poolMax },
  })
}

export function hrtimeMs(start: bigint): number {
  return Number(process.hrtime.bigint() - start) / 1e6
}

export async function timed<T>(fn: () => Promise<T>): Promise<{ ms: number; result: T }> {
  const start = process.hrtime.bigint()
  const result = await fn()
  return { ms: hrtimeMs(start), result }
}

export function fmt(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms.toFixed(1)}ms`
}
