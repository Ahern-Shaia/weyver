import { fileURLToPath } from "node:url"
import { migrate } from "drizzle-orm/node-postgres/migrator"
import type pg from "pg"
import { createDrizzle } from "./db.module.js"

const MIGRATIONS_FOLDER = fileURLToPath(new URL("../../drizzle", import.meta.url))

export async function runMigrations(pool: pg.Pool): Promise<void> {
  await migrate(createDrizzle(pool), { migrationsFolder: MIGRATIONS_FOLDER })
}
