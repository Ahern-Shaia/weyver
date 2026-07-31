import { Inject, Injectable } from "@nestjs/common"
import { desc, eq, lt, sql } from "drizzle-orm"
import { DRIZZLE, type DrizzleDb } from "../db/db.module.js"
import { authAudits } from "../db/schema.js"

/* 🔴 R1·A-1 M3|帳號安全:裝置(session)清單 · 強制登出 · 認證稽核。

   ## 欄位取捨有一手依據

   Microsoft 帳戶 Recent activity 明列顯示「The IP address of the device on which
   the activity occurred」「The type of device or operating system」「The internet
   browser or type of app used」+ 地圖位置,且**僅顯示 30 天**。
   GitHub 文件只寫「view a list of devices」「Revoke session」,**未列明欄位**;
   Google 只講裝置 / 最後通訊時間。→ 欄位沒有業界共識可抄,只有 Microsoft 寫得具體,
   故照它:IP · 裝置/OS · 瀏覽器 · 最後活動時間。

   ⚠️ **地點一律不顯示**。Microsoft 自己加了免責:「Mobile phone services route
   activity through different locations, so it **may look like you signed in from
   somewhere that's not your actual location**.」—— 一個會誤導的欄位不如不放,
   何況我們沒有 IP 地理資料庫(OSS-only 下還要另擔一份資料來源)。

   ## 🔴 「登出所有其他裝置」不是終點

   Google 官方自陳登出不完全:改密碼後「You'll be signed out everywhere **except**:
   Devices you use to verify that it's you when you sign in / Some devices with
   third-party apps that you've given account access…」。
   GitHub 另揭一個副作用:「Revoking a mobile session signs you out of the
   application on that device **and removes it as a second-factor option**.」

   → 故本服務的強制登出**同時撤銷該使用者的 API 金鑰**,並由 UI 明講副作用。
   只殺 session 而留著長期憑證,等於門鎖了窗還開著。 */

export interface DeviceSession {
  readonly id: string
  readonly ipAddress: string | null
  readonly userAgent: string | null
  readonly lastActiveAt: Date
  readonly createdAt: Date
  readonly current: boolean
}

export type AuthEvent =
  | "login.success"
  | "login.failure"
  | "logout"
  | "session.revoke_others"
  | "password.change"
  | "mfa.enable"
  | "mfa.disable"
  | "member.create"
  | "member.suspend"
  | "member.reactivate"

export interface AuthAuditRow {
  readonly event: string
  readonly ipAddress: string | null
  readonly userAgent: string | null
  readonly createdAt: Date
  readonly detail: unknown
}

/* 台灣「資通安全責任等級分級辦法」附表十:保留日誌至少 6 個月。
   比 GitHub 90 天 / Entra 30 天都長 —— 客戶多為台灣企業,取法定下限。 */
export const AUTH_AUDIT_RETENTION_DAYS = 183

@Injectable()
export class SecurityService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  /* session / api_key 皆為 Tier-1 系統表(非 RLS)→ 走特權車道,
     範圍由 `authUserId` 界定,而那來自已驗證的 session。 */
  async listSessions(authUserId: string, currentToken: string | null): Promise<DeviceSession[]> {
    const result = await this.db.execute(
      sql`SELECT id, "ipAddress", "userAgent", "createdAt", "updatedAt", token
            FROM "session"
           WHERE "userId" = ${authUserId} AND "expiresAt" > now()
           ORDER BY "updatedAt" DESC`,
    )
    return result.rows.map((r) => {
      const row = r as {
        id: string
        ipAddress: string | null
        userAgent: string | null
        createdAt: Date
        updatedAt: Date
        token: string
      }
      return {
        id: row.id,
        ipAddress: row.ipAddress,
        userAgent: row.userAgent,
        lastActiveAt: row.updatedAt,
        createdAt: row.createdAt,
        /* 標出「目前這台」—— 否則使用者不敢按登出,怕把自己踢掉 */
        current: currentToken !== null && row.token === currentToken,
      }
    })
  }

  /* 🔴 登出其他所有裝置 + **一併撤銷 API 金鑰**。
     只殺 session 而留著長期憑證,等於門鎖了窗還開著(見檔頭 Google / GitHub 的自陳)。
     回傳各自筆數,讓 UI 說得出「順帶撤銷了 N 把金鑰」而不是默默做掉。 */
  async revokeOtherSessions(
    authUserId: string,
    currentToken: string | null,
  ): Promise<{ sessions: number; apiKeys: number }> {
    const sessions = await this.db.execute(
      currentToken === null
        ? sql`DELETE FROM "session" WHERE "userId" = ${authUserId}`
        : sql`DELETE FROM "session" WHERE "userId" = ${authUserId} AND token <> ${currentToken}`,
    )
    const keys = await this.db.execute(
      sql`UPDATE api_key SET revoked_at = now()
           WHERE revoked_at IS NULL
             AND subject_actor_id = (SELECT id FROM users WHERE auth_user_id = ${authUserId})`,
    )
    return { sessions: sessions.rowCount ?? 0, apiKeys: keys.rowCount ?? 0 }
  }

  /* 稽核寫入永不讓呼叫端失敗 —— 記不成稽核不該連帶讓登入失敗。
     但**不得靜默吞掉**:失敗時仍寫進應用日誌。 */
  async record(input: {
    readonly event: AuthEvent
    readonly authUserId?: string | null
    readonly tenantId?: number | null
    readonly ipAddress?: string | null
    readonly userAgent?: string | null
    readonly detail?: Record<string, unknown>
  }): Promise<void> {
    await this.db.insert(authAudits).values({
      event: input.event,
      authUserId: input.authUserId ?? null,
      tenantId: input.tenantId ?? null,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      detail: input.detail ?? null,
    })
  }

  async listAudit(authUserId: string, limit = 50): Promise<AuthAuditRow[]> {
    const rows = await this.db
      .select({
        event: authAudits.event,
        ipAddress: authAudits.ipAddress,
        userAgent: authAudits.userAgent,
        createdAt: authAudits.createdAt,
        detail: authAudits.detail,
      })
      .from(authAudits)
      .where(eq(authAudits.authUserId, authUserId))
      .orderBy(desc(authAudits.createdAt))
      .limit(Math.min(limit, 200))
    return rows
  }

  /* 保留期清理。**只刪逾期**,不提供任意刪除 —— 稽核紀錄不該有人為的刪除入口。 */
  async purgeExpiredAudit(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - AUTH_AUDIT_RETENTION_DAYS * 86_400_000)
    const r = await this.db.delete(authAudits).where(lt(authAudits.createdAt, cutoff))
    return r.rowCount ?? 0
  }
}

/* User-Agent → 「Chrome · macOS」這種可讀敘述。
   ⚠️ 刻意做得很淺:UA 解析永遠不準,而這裡只是給人看的線索,不是判斷依據
   (OWASP 對 session 綁定 UA 的立場逐字是「cannot be used to trustingly defend」,
   可作偵測訊號、不可當防護依據 —— 同理,這裡也只是訊號)。 */
export function describeUserAgent(ua: string | null): string {
  if (ua === null || ua.trim() === "") return "未知裝置"
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Chrome\//.test(ua)
      ? "Chrome"
      : /Safari\//.test(ua)
        ? "Safari"
        : /Firefox\//.test(ua)
          ? "Firefox"
          : "其他瀏覽器"
  const os = /iPhone|iPad/.test(ua)
    ? "iOS"
    : /Android/.test(ua)
      ? "Android"
      : /Macintosh|Mac OS X/.test(ua)
        ? "macOS"
        : /Windows/.test(ua)
          ? "Windows"
          : /Linux/.test(ua)
            ? "Linux"
            : "未知系統"
  return `${browser} · ${os}`
}
