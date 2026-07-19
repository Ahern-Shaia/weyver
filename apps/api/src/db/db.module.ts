import { Global, Module } from "@nestjs/common"
import { ConfigService } from "@nestjs/config"
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres"
import pg from "pg"
import * as schema from "./schema.js"

export const PG_POOL = Symbol("PG_POOL")
export const DRIZZLE = Symbol("DRIZZLE")

export type DrizzleDb = NodePgDatabase<typeof schema>

export function createDrizzle(pool: pg.Pool): DrizzleDb {
  return drizzle(pool, { schema })
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
  ],
  exports: [PG_POOL, DRIZZLE],
})
export class DbModule {}
