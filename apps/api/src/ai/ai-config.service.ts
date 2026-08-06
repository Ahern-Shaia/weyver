import { BadRequestException, Inject, Injectable } from "@nestjs/common"
import { ConfigService } from "@nestjs/config"
import { and, eq, gte, sql } from "drizzle-orm"
import { openSecret, sealSecret } from "../crypto/secret-box.js"
import { TenantDb } from "../db/db.module.js"
import { aiUsage, tenantAiConfig } from "../db/schema.js"
import {
  type AiConfigDto,
  type AiConfigPatch,
  type AiProvider,
  type AiUsageRow,
  SUGGESTED_MODELS,
} from "./ai-specs.js"

/* 解密後的可用設定。**只在伺服器行程內存在**,不進任何 DTO。 */
export interface ResolvedAiConfig {
  readonly provider: AiProvider
  readonly model: string
  readonly apiKey: string
}

/* 🔴 R1·AI-1 M1|AI 設定(BYO key)。

   ## 為什麼是 BYO key

   站③查證(2026-08-06):Ragic 與 Airtable **都是原廠代購額度**
   (Ragic `doc/176`「AI 額度以美金計算」+ 三家九模型;Airtable credits)。
   我方走 BYO key 是 **OSS-only 的直接後果**,不是因為它比較好 ——
   誠實的代價是 onboarding 多一步,好處是成本與資料流向由客戶掌握。

   ## 金鑰的處置

   信封加密**復用既有** `secret-box`(AES-256-GCM,DEK 由 KEK 包,支援輪替),
   形狀照 `notifications/channel-config.service.ts` —— 不為第二個功能再造一套。
   對外**永遠只給末四碼**;`resolveForCall` 是唯一會解密的出口,而它只回給
   伺服器端的呼叫者,不經 controller。 */
@Injectable()
export class AiConfigService {
  constructor(
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  private kek(): string {
    const kek = this.config.get<string>("WEYVER_SECRET_KEK")
    /* 走到這裡還沒有 KEK 表示 env 驗證被繞過了 —— 寧可拋,不要用空字串加密 */
    if (kek === undefined || kek === "") throw new Error("WEYVER_SECRET_KEK 未設定")
    return kek
  }

  async get(tenantId: number): Promise<AiConfigDto> {
    const row = await this.row(tenantId)
    return {
      enabled: row?.enabled ?? false,
      provider: (row?.provider as AiProvider | null) ?? null,
      model: row?.model ?? null,
      apiKeyHint: row?.apiKeyHint ?? null,
      hasApiKey: (row?.apiKeySealed ?? null) !== null,
      consentAt: row?.consentAt?.toISOString() ?? null,
      suggestedModels: SUGGESTED_MODELS,
    }
  }

  /* 🔴 `consent` 與 `enabled` 的互動是刻意的:撤回同意會讓 DB 的 CHECK
     擋下 `enabled = true`,等於關掉 AI。所以撤回時**這裡先把 enabled 拉掉**,
     否則使用者按「撤回同意」會拿到一個看不懂的資料庫約束錯誤。 */
  async update(tenantId: number, actorId: number, patch: AiConfigPatch): Promise<AiConfigDto> {
    const current = await this.row(tenantId)
    const next: Record<string, unknown> = { updatedAt: new Date() }

    if (patch.provider !== undefined) next.provider = patch.provider
    if (patch.model !== undefined) next.model = patch.model

    if (patch.apiKey !== undefined) {
      if (patch.apiKey === "") {
        next.apiKeySealed = null
        next.apiKeyHint = null
      } else {
        /* ⚠️ `sealSecret` 回的是 `{ sealed, fingerprint }` **物件**,要取 `.sealed`。
           存成整個物件時,pg 會把它 JSON 化 —— 於是「長度 > 20」與「不含明文」
           兩條斷言**都會過**,而解密時才炸「憑證格式無法辨識」。
           2026-08-06 由**往返測試**抓到,形狀斷言抓不到。 */
        next.apiKeySealed = sealSecret(patch.apiKey, this.kek()).sealed
        next.apiKeyHint = patch.apiKey.slice(-4)
      }
    }

    if (patch.consent !== undefined) {
      next.consentAt = patch.consent ? new Date() : null
      next.consentByActorId = patch.consent ? actorId : null
      if (!patch.consent) next.enabled = false
    }

    if (patch.enabled !== undefined) {
      /* 撤回同意與啟用同時送來時,撤回優先 —— 反過來會存進一個
         「已啟用但沒同意」的狀態,而那正是 CHECK 要擋的。 */
      next.enabled = patch.enabled && patch.consent !== false
    }

    /* 先在應用層檢一次「要嘛全有要嘛全無」,只為了給得出人看得懂的訊息;
       DB 的 CHECK 仍是最後一道,不靠這裡。 */
    const merged = { ...current, ...next } as Partial<typeof tenantAiConfig.$inferSelect>
    if (merged.enabled === true) {
      const missing = [
        merged.provider == null ? "provider" : null,
        merged.model == null ? "模型" : null,
        merged.apiKeySealed == null ? "API 金鑰" : null,
        merged.consentAt == null ? "資料外送同意" : null,
      ].filter((m): m is string => m !== null)
      if (missing.length > 0) {
        throw new BadRequestException({
          code: "AI_CONFIG_INCOMPLETE",
          message: `啟用 AI 前還缺:${missing.join("、")}`,
        })
      }
    }

    /* 🔴 寫入的是**合併後的完整列**,不是 delta。

       原本送 delta 會炸:PostgreSQL 的 `INSERT ... ON CONFLICT DO UPDATE`
       是**先對 INSERT 候選列求值 CHECK、再偵測衝突**,所以只送
       `{enabled: true}` 的那一刻,候選列的 provider / model / key 全是 NULL,
       `tenant_ai_config_enabled_shape` 直接違反 —— 根本走不到 DO UPDATE。
       實測 2026-08-06,錯誤是 23514 而不是任何看得出原因的訊息。 */
    const full = {
      tenantId,
      enabled: merged.enabled ?? false,
      provider: merged.provider ?? null,
      model: merged.model ?? null,
      apiKeySealed: merged.apiKeySealed ?? null,
      apiKeyHint: merged.apiKeyHint ?? null,
      consentAt: merged.consentAt ?? null,
      consentByActorId: merged.consentByActorId ?? null,
      updatedAt: new Date(),
    }
    await this.db.withTenant(tenantId, async (tx) => {
      await tx
        .insert(tenantAiConfig)
        .values(full)
        .onConflictDoUpdate({ target: tenantAiConfig.tenantId, set: full })
    })
    return this.get(tenantId)
  }

  /* 🔴 唯一會解密的出口。回 null = 這個租戶現在不能用 AI(沒開 / 沒設完)。

     呼叫端拿到 null 時要**明說原因並指到設定頁**(OQ-AI-5=B),
     不是靜默什麼都不做 —— 那會變成一個按了沒反應的按鈕。 */
  async resolveForCall(tenantId: number): Promise<ResolvedAiConfig | null> {
    const row = await this.row(tenantId)
    if (row === undefined || !row.enabled) return null
    if (row.provider === null || row.model === null || row.apiKeySealed === null) return null
    if (row.consentAt === null) return null
    return {
      provider: row.provider as AiProvider,
      model: row.model,
      apiKey: openSecret(row.apiKeySealed, this.kek()),
    }
  }

  /* 用量:**成功與失敗都記**。失敗的呼叫一樣花錢(provider 多半照收 input token),
     只記成功會讓帳對不起來。寫入不擋主流程 —— 記帳失敗不該讓功能失敗。 */
  async recordUsage(input: {
    tenantId: number
    actorId: number | null
    feature: string
    provider: string
    model: string
    inputTokens: number
    outputTokens: number
    ok: boolean
  }): Promise<void> {
    await this.db.withTenant(input.tenantId, async (tx) => {
      await tx.insert(aiUsage).values({
        tenantId: input.tenantId,
        actorId: input.actorId,
        feature: input.feature,
        provider: input.provider,
        model: input.model,
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
        ok: input.ok,
      })
    })
  }

  /* 近 N 天的用量摘要,per provider × model × feature。
     ⚠️ 這**不是「還剩多少額度」** —— 見 migration 0064 的說明。 */
  async usageSince(tenantId: number, days = 30): Promise<AiUsageRow[]> {
    const since = new Date(Date.now() - days * 86_400_000)
    return this.db.withTenant(tenantId, async (tx) => {
      const rows = await tx
        .select({
          provider: aiUsage.provider,
          model: aiUsage.model,
          feature: aiUsage.feature,
          calls: sql<number>`count(*)::int`,
          failedCalls: sql<number>`count(*) filter (where not ${aiUsage.ok})::int`,
          inputTokens: sql<number>`coalesce(sum(${aiUsage.inputTokens}), 0)::int`,
          outputTokens: sql<number>`coalesce(sum(${aiUsage.outputTokens}), 0)::int`,
        })
        .from(aiUsage)
        .where(and(eq(aiUsage.tenantId, tenantId), gte(aiUsage.createdAt, since)))
        .groupBy(aiUsage.provider, aiUsage.model, aiUsage.feature)
      return rows
    })
  }

  private async row(tenantId: number): Promise<typeof tenantAiConfig.$inferSelect | undefined> {
    return this.db.withTenant(tenantId, async (tx) => {
      const [row] = await tx
        .select()
        .from(tenantAiConfig)
        .where(eq(tenantAiConfig.tenantId, tenantId))
        .limit(1)
      return row
    })
  }
}
