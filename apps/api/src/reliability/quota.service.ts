import { ForbiddenException, Inject, Injectable } from "@nestjs/common"
import { ConfigService } from "@nestjs/config"
import { and, count, eq, isNull } from "drizzle-orm"
import { DRIZZLE, type DrizzleDb, TenantDb } from "../db/db.module.js"
import { fieldDefs, formDefs, tenants } from "../db/schema.js"

/* F-6 M2|per-tenant 資源配額(form-engine-core FMEA C5:惡意大量建表 DDL DoS)。
   上限來源三層(OQ-REL-2=B):tenants 該列 → env 覆寫 → 程式預設。NULL 欄 = 用預設,既有租戶零遷移。
   刻意**不**在單筆建記錄路徑做 count(每次插入一次全表 count 於大表為 seq scan);
   記錄配額只在 bulk 路徑檢核(濫用的實際載體),單筆由 throttler + 表數/欄數上限間接約束。 */

const DEFAULTS = {
  maxForms: 500,
  maxFieldsPerForm: 200,
  maxRecordsPerForm: 1_000_000,
} as const

export interface TenantQuota {
  readonly maxForms: number
  readonly maxFieldsPerForm: number
  readonly maxRecordsPerForm: number
}

@Injectable()
export class QuotaService {
  constructor(
    /* tenants 為系統設定表(非 RLS)→ 特權車道 */
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    /* form_def / field_def 為 RLS 表 → app 車道 + tenant GUC(F-6 M3) */
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  async quotaFor(tenantId: number): Promise<TenantQuota> {
    const rows = await this.db
      .select({
        maxForms: tenants.maxForms,
        maxFieldsPerForm: tenants.maxFieldsPerForm,
        maxRecordsPerForm: tenants.maxRecordsPerForm,
      })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1)
    const row = rows[0]
    return {
      maxForms: row?.maxForms ?? this.fromEnv("QUOTA_MAX_FORMS", DEFAULTS.maxForms),
      maxFieldsPerForm:
        row?.maxFieldsPerForm ??
        this.fromEnv("QUOTA_MAX_FIELDS_PER_FORM", DEFAULTS.maxFieldsPerForm),
      maxRecordsPerForm:
        row?.maxRecordsPerForm ??
        this.fromEnv("QUOTA_MAX_RECORDS_PER_FORM", DEFAULTS.maxRecordsPerForm),
    }
  }

  async assertCanCreateForm(tenantId: number): Promise<void> {
    const quota = await this.quotaFor(tenantId)
    const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
      tx
        .select({ value: count() })
        .from(formDefs)
        .where(and(eq(formDefs.tenantId, tenantId), isNull(formDefs.deletedAt))),
    )
    const current = rows[0]?.value ?? 0
    if (current >= quota.maxForms) {
      throw this.exceeded(`表單數已達上限 ${quota.maxForms}`)
    }
  }

  /* incoming:一次要加的欄數(建表時為整批,加欄時為 1)。 */
  async assertCanAddFields(tenantId: number, formId: number, incoming: number): Promise<void> {
    const quota = await this.quotaFor(tenantId)
    const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
      tx
        .select({ value: count() })
        .from(fieldDefs)
        .where(and(eq(fieldDefs.formId, formId), isNull(fieldDefs.deletedAt))),
    )
    const current = rows[0]?.value ?? 0
    if (current + incoming > quota.maxFieldsPerForm) {
      throw this.exceeded(`單一表單欄位數已達上限 ${quota.maxFieldsPerForm}`)
    }
  }

  async assertFieldCountWithinQuota(tenantId: number, incoming: number): Promise<void> {
    const quota = await this.quotaFor(tenantId)
    if (incoming > quota.maxFieldsPerForm) {
      throw this.exceeded(`單一表單欄位數已達上限 ${quota.maxFieldsPerForm}`)
    }
  }

  async maxRecordsFor(tenantId: number): Promise<number> {
    return (await this.quotaFor(tenantId)).maxRecordsPerForm
  }

  assertRecordCount(current: number, incoming: number, limit: number): void {
    if (current + incoming > limit) {
      throw this.exceeded(`單一表單記錄數已達上限 ${limit}`)
    }
  }

  private fromEnv(key: string, fallback: number): number {
    const raw = this.config.get<number | string>(key)
    const parsed = typeof raw === "string" ? Number(raw) : raw
    return typeof parsed === "number" && Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
  }

  /* 403 而非 429:配額是**授權上限**非速率問題,訊息明示可聯絡管理員調整(FMEA L5)。 */
  private exceeded(message: string): ForbiddenException {
    return new ForbiddenException({
      code: "QUOTA_EXCEEDED",
      message: `${message},請聯絡管理員調整配額`,
    })
  }
}
