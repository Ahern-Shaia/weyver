import {
  Global,
  Inject,
  Injectable,
  Logger,
  Module,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common"
import { ConfigService } from "@nestjs/config"
import { sql } from "drizzle-orm"
import { type NodePgDatabase, drizzle } from "drizzle-orm/node-postgres"
import knex, { type Knex } from "knex"
import pg from "pg"
import "./pg-types.js" // 全域 pg 型別解析覆寫(DATE → 字串);import 副作用,須在建任何 pool 前
import * as schema from "./schema.js"

export const PG_POOL = Symbol("PG_POOL")
export const DRIZZLE = Symbol("DRIZZLE")
/* 特權車道:Tier-2 動態表 DDL(prod = ddl 角色;有 CREATE 權) */
export const DDL_KNEX = Symbol("DDL_KNEX")
/* app 車道:記錄 DML(prod = weyver_app;無 DDL / 無 BYPASSRLS → RLS 真正執法) */
export const APP_KNEX = Symbol("APP_KNEX")
/* F-6 M3|metadata 之 app 車道(prod = weyver_app)。與 DRIZZLE 同 schema、不同連線角色:
   租戶範疇之 metadata(form_def / field_def / formula_def / relation_def)改走此車道 +
   每交易 set_config('app.tenant_id') → 既有 RLS FORCE policy 真正生效(T4 單防線 → 雙防線)。
   跨租戶系統表(users / tenants 寫入 / 種子 / DDL)仍走 DRIZZLE 特權車道(OQ-REL-3=A)。 */
export const APP_DRIZZLE = Symbol("APP_DRIZZLE")
export const APP_PG_POOL = Symbol("APP_PG_POOL")

export type DrizzleDb = NodePgDatabase<typeof schema>

export function createDrizzle(pool: pg.Pool): DrizzleDb {
  return drizzle(pool, { schema })
}

export function createDdlKnex(connectionString: string): Knex {
  return knex({ client: "pg", connection: connectionString, pool: { min: 0, max: 3 } })
}

/* F-6 M5(core FMEA R8):app 車道設 statement_timeout —— 單一慢查詢不得拖垮連線池。
   DDL 車道另有自己的 SET LOCAL(較長);報表類長查詢未來走 read replica 而非放寬此值。 */
const APP_STATEMENT_TIMEOUT = "30s"

export function createAppKnex(connectionString: string): Knex {
  return knex({
    client: "pg",
    connection: connectionString,
    pool: {
      min: 0,
      max: 10,
      afterCreate: (
        conn: { query: (sql: string, cb: (err: unknown) => void) => void },
        done: (err: unknown, conn: unknown) => void,
      ) => {
        conn.query(`SET statement_timeout = '${APP_STATEMENT_TIMEOUT}'`, (err: unknown) => {
          done(err, conn)
        })
      },
    },
  })
}

/* F-6 M3|租戶範疇 metadata 存取入口。強制「每次存取都在設好 app.tenant_id 的交易內」——
   呼叫端拿不到裸 db,便無法寫出漏設租戶語境的查詢(RLS 會讓那種查詢回空,難以察覺)。 */
@Injectable()
export class TenantDb {
  constructor(@Inject(APP_DRIZZLE) private readonly db: DrizzleDb) {}

  async withTenant<T>(tenantId: number, fn: (tx: DrizzleDb) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      // SET LOCAL 不可參數綁定 → set_config(..., true) 為交易範圍等價(承 RecordService)
      await tx.execute(sql`SELECT set_config('app.tenant_id', ${String(tenantId)}, true)`)
      return fn(tx as unknown as DrizzleDb)
    })
  }
}

/* graceful shutdown:app.close() / SIGTERM 時收乾連線(零停機滾動部署前提) */
@Injectable()
class DbLifecycle implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DbLifecycle.name)

  constructor(
    @Inject(PG_POOL) private readonly pool: pg.Pool,
    @Inject(APP_PG_POOL) private readonly appPool: pg.Pool,
    @Inject(DDL_KNEX) private readonly ddlKnex: Knex,
    @Inject(APP_KNEX) private readonly appKnex: Knex,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  /* 🔴 開機自檢:app 車道必須是**沒有 BYPASSRLS 的非 superuser**,否則 RLS 完全不執法 ——
     租戶隔離與記錄範圍會靜默失效(查詢照常回資料,沒有任何錯誤)。#96 實走時發現 dev
     因 APP_DATABASE_URL 未設而回落到特權連線,「只看自己的」在瀏覽器裡驗不出來。
     prod 直接 fail-fast(寧可起不來也不要無聲洩漏);dev 大聲警告,不靜默。 */
  async onModuleInit(): Promise<void> {
    const { rows } = await this.appPool.query<{ superuser: boolean; bypassrls: boolean }>(
      `SELECT rolsuper AS superuser, rolbypassrls AS bypassrls
         FROM pg_roles WHERE rolname = current_user`,
    )
    const role = rows[0]
    if (role === undefined || (!role.superuser && !role.bypassrls)) return

    const message =
      "app DB 車道使用特權角色(superuser 或 BYPASSRLS)→ RLS 不執法,租戶隔離與記錄範圍失效。" +
      "請將 APP_DATABASE_URL 指向 GRANT weyver_app 的 LOGIN 角色。"
    if (this.config.get<string>("NODE_ENV") === "production") throw new Error(message)
    this.logger.warn(`${message}(dev 容許,但權限相關驗證請以整合測為準)`)
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([
      this.pool.end(),
      this.appPool.end(),
      this.ddlKnex.destroy(),
      this.appKnex.destroy(),
    ])
  }
}

@Global()
@Module({
  providers: [
    DbLifecycle,
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
      provide: APP_PG_POOL,
      useFactory: (config: ConfigService): pg.Pool =>
        new pg.Pool({ connectionString: config.getOrThrow<string>("APP_DATABASE_URL"), max: 10 }),
      inject: [ConfigService],
    },
    {
      provide: APP_DRIZZLE,
      useFactory: (pool: pg.Pool): DrizzleDb => createDrizzle(pool),
      inject: [APP_PG_POOL],
    },
    TenantDb,
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
  exports: [PG_POOL, DRIZZLE, APP_PG_POOL, APP_DRIZZLE, TenantDb, DDL_KNEX, APP_KNEX],
})
export class DbModule {}
