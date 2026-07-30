import crypto from "node:crypto"
import { Inject, Injectable } from "@nestjs/common"
import { and, desc, eq, isNull } from "drizzle-orm"
import { DRIZZLE, type DrizzleDb, TenantDb } from "../db/db.module.js"
import { apiKeys } from "../db/schema.js"

/* G-1 M4|API 金鑰。

   ## 與 webhook secret 的差別:這裡只存 hash

   webhook 簽章需要原始秘鑰才算得出 HMAC,所以那邊必須存明文。
   API 金鑰不同 —— 驗證時 client 會把明文送上來,我們只需要比對雜湊。
   沒有存明文的理由,就不存。

   ## 為什麼用 SHA-256 而不是 Argon2

   密碼要用 Argon2 是因為它熵低、可被字典攻擊。API 金鑰是我們自己產的
   256-bit 隨機值,字典攻擊不成立,而每個 API 請求都要驗一次 ——
   用 Argon2 等於給自己加一個每請求數十毫秒的稅。
   (Stripe / GitHub 的 token 驗證同樣是快速雜湊比對。)

   ## 金鑰不得提權

   `subjectActorId` 綁定「以誰的身分執行」。金鑰的權限**恆等於**那個人的權限,
   不是另一套獨立權限 —— 否則金鑰就成了繞過 authz 的側門。 */

const KEY_PREFIX = "wvk_"

export interface ApiKeyView {
  readonly id: number
  readonly name: string
  readonly keyPrefix: string
  readonly scopes: string[]
  readonly lastUsedAt: Date | null
  readonly expiresAt: Date | null
  readonly createdAt: Date
}

export interface ResolvedApiKey {
  readonly tenantId: number
  readonly actorId: number
  readonly scopes: readonly string[]
}

function hashKey(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex")
}

@Injectable()
export class ApiKeyService {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    /* 🔴 驗證發生在 tenant context 建立**之前**(此時 app.tenant_id 尚未設定),
       走 app 車道的話 RLS 會讓查詢永遠空手而回 → 認證恆失敗。
       故金鑰查驗一律走特權車道,與 Better Auth 的 session 表同理。 */
    @Inject(DRIZZLE) private readonly privileged: DrizzleDb,
  ) {}

  async list(tenantId: number): Promise<readonly ApiKeyView[]> {
    const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
      tx
        .select()
        .from(apiKeys)
        .where(and(eq(apiKeys.tenantId, tenantId), isNull(apiKeys.revokedAt)))
        .orderBy(desc(apiKeys.createdAt)),
    )
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      keyPrefix: r.keyPrefix,
      scopes: r.scopes,
      lastUsedAt: r.lastUsedAt,
      expiresAt: r.expiresAt,
      createdAt: r.createdAt,
    }))
  }

  /* 明文**只在此刻回傳一次**。之後 UI 只看得到前綴。 */
  async issue(
    tenantId: number,
    input: {
      name: string
      subjectActorId: number
      scopes: readonly string[]
      expiresAt?: Date | undefined
      createdBy: number
    },
  ): Promise<{ id: number; key: string; keyPrefix: string }> {
    const raw = `${KEY_PREFIX}${crypto.randomBytes(32).toString("base64url")}`
    const keyPrefix = raw.slice(0, 12)
    const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
      tx
        .insert(apiKeys)
        .values({
          tenantId,
          name: input.name,
          keyHash: hashKey(raw),
          keyPrefix,
          subjectActorId: input.subjectActorId,
          scopes: [...input.scopes],
          expiresAt: input.expiresAt ?? null,
          createdBy: input.createdBy,
        })
        .returning({ id: apiKeys.id }),
    )
    const row = rows[0]
    if (row === undefined) throw new Error("insert api_key returned no row")
    return { id: row.id, key: raw, keyPrefix }
  }

  /* 認證路徑。查不到 / 已撤銷 / 已過期一律回 null,**不區分原因** ——
     區分等於告訴攻擊者「這把金鑰存在但過期了」。 */
  async resolve(rawKey: string): Promise<ResolvedApiKey | null> {
    if (!rawKey.startsWith(KEY_PREFIX)) return null
    const rows = await this.privileged
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.keyHash, hashKey(rawKey)))
      .limit(1)
    const row = rows[0]
    if (row === undefined) return null
    if (row.revokedAt !== null) return null
    if (row.expiresAt !== null && row.expiresAt.getTime() < Date.now()) return null

    /* 最後使用時間供「金鑰洩漏後找得出是哪一把在被用」。
       非關鍵路徑,失敗不擋認證。 */
    void this.privileged
      .update(apiKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(apiKeys.id, row.id))
      .catch(() => undefined)

    return { tenantId: row.tenantId, actorId: row.subjectActorId, scopes: row.scopes }
  }

  async revoke(tenantId: number, keyId: number): Promise<void> {
    await this.tenantDb.withTenant(tenantId, (tx) =>
      tx
        .update(apiKeys)
        .set({ revokedAt: new Date() })
        .where(and(eq(apiKeys.tenantId, tenantId), eq(apiKeys.id, keyId))),
    )
  }
}
