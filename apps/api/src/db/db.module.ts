import { Global, Module } from "@nestjs/common"
import { ConfigService } from "@nestjs/config"
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres"
import knex, { type Knex } from "knex"
import pg from "pg"
import * as schema from "./schema.js"

export const PG_POOL = Symbol("PG_POOL")
export const DRIZZLE = Symbol("DRIZZLE")
/* 特權車道:Tier-2 動態表 DDL(prod = ddl 角色;有 CREATE 權) */
export const DDL_KNEX = Symbol("DDL_KNEX")
/* app 車道:記錄 DML(prod = weyver_app;無 DDL / 無 BYPASSRLS → RLS 真正執法) */
export const APP_KNEX = Symbol("APP_KNEX")

export type DrizzleDb = NodePgDatabase<typeof schema>

export function createDrizzle(pool: pg.Pool): DrizzleDb {
  return drizzle(pool, { schema })
}

export function createDdlKnex(connectionString: string): Knex {
  return knex({ client: "pg", connection: connectionString, pool: { min: 0, max: 3 } })
}

export function createAppKnex(connectionString: string): Knex {
  return knex({ client: "pg", connection: connectionString, pool: { min: 0, max: 10 } })
}

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      useFactory: (config: ConfigService): pg.Pool =>
        new pg.Pool({ connectionString: config.getOrThrow<string>("DATABASE_URL"), max: 10 }),
      inject: [ConfigService],
    },
    {
      provide: DRIZZLE,
      useFactory: (pool: pg.Pool): DrizzleDb => createDrizzle(pool),
      inject: [PG_POOL],
    },
    {
      provide: DDL_KNEX,
      useFactory: (config: ConfigService): Knex =>
        createDdlKnex(config.getOrThrow<string>("DATABASE_URL")),
      inject: [ConfigService],
    },
    {
      provide: APP_KNEX,
      useFactory: (config: ConfigService): Knex =>
        createAppKnex(config.getOrThrow<string>("APP_DATABASE_URL")),
      inject: [ConfigService],
    },
  ],
  exports: [PG_POOL, DRIZZLE, DDL_KNEX, APP_KNEX],
})
export class DbModule {}
