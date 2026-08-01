import { Inject, Injectable } from "@nestjs/common"
import { and, eq } from "drizzle-orm"
import { TenantDb } from "../db/db.module.js"
import { tenants, userPrefs } from "../db/schema.js"

/* 🔴 R1·A-1 M1|設定中心之租戶 / 個人設定。

   ## 兩軸時區(OQ-SC-3;證據見 settings-center.md §0.2)

   · **業務日界線** = `tenants.timezone` —— autoNumber 的日期段與歸零週期靠它判定。
     **個人不可覆寫**:它定義資料語意,不是呈現。GA4 對 `timeZone` 的定義是同一模型
     (「day boundary for reports, **regardless of where the data originates**」)。
   · **顯示時區** = `user_pref.display_timezone` —— 只影響畫面上時間戳怎麼寫出來。

   兩者混用會讓報表的「今天」隨看的人而變,所以刻意分成兩個名字、兩張表。

   ## 動態繼承(OQ-SC-3=A)

   `user_pref` 的欄位為 NULL 即繼承租戶預設,**改租戶值即時反映到所有未自訂者**。
   不採 Google Workspace 的「只套用到新帳號」——那需要額外的複製機制,
   且官方自陳有不可逆陷阱(「you can't switch back to using time zones based on
   the user's location」)。 */

export interface TenantSettings {
  readonly name: string
  readonly taxId: string | null
  readonly logoFileKey: string | null
  readonly timezone: string
  readonly defaultLocale: string
  readonly defaultCurrency: string
  /* 🔴 全公司強制二步驟驗證(#112)。開啟者本人須先啟用 —— 檢查在 controller */
  readonly requireMfa: boolean
}

/* 個人設定的「有效值」+「是否自訂」。
   兩者都回,UI 才說得出「跟隨公司設定(Asia/Taipei)」與「已自訂」的差別 ——
   只回有效值的話,使用者無從得知自己是不是還在繼承。 */
export interface EffectiveUserSettings {
  readonly locale: string
  readonly displayTimezone: string
  readonly overrides: { readonly locale: boolean; readonly displayTimezone: boolean }
  readonly tenantDefaults: { readonly locale: string; readonly timezone: string }
}

@Injectable()
export class SettingsService {
  constructor(@Inject(TenantDb) private readonly db: TenantDb) {}

  async getTenant(tenantId: number): Promise<TenantSettings> {
    return this.db.withTenant(tenantId, async (tx) => {
      const [row] = await tx.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1)
      /* 租戶不存在在此為不可能:tenantId 來自已驗證的 session（AuthGuard），
         而 session 的 org 必然對映到一列。取不到就是上游壞了,讓它以 TypeError 炸出來
         比回一個假的空設定好 —— 後者會讓使用者以為公司資料被清空。 */
      if (row === undefined) throw new Error(`tenant ${String(tenantId)} not found`)
      return {
        name: row.name,
        taxId: row.taxId,
        logoFileKey: row.logoFileKey,
        timezone: row.timezone,
        defaultLocale: row.defaultLocale,
        requireMfa: row.requireMfa,
        defaultCurrency: row.defaultCurrency,
      }
    })
  }

  async updateTenant(
    tenantId: number,
    patch: {
      name?: string | undefined
      taxId?: string | null | undefined
      timezone?: string | undefined
      defaultLocale?: string | undefined
      defaultCurrency?: string | undefined
      requireMfa?: boolean | undefined
    },
  ): Promise<TenantSettings> {
    const set = defined(patch)
    /* 空 patch 直接回現值 —— drizzle 的 `.set({})` 會丟「No values to set」,
       而「送了空 body」不該是錯誤,它就是沒有要改任何東西。 */
    if (Object.keys(set).length > 0) {
      await this.db.withTenant(tenantId, async (tx) => {
        await tx.update(tenants).set(set).where(eq(tenants.id, tenantId))
      })
    }
    return this.getTenant(tenantId)
  }

  async getUser(tenantId: number, actorId: number): Promise<EffectiveUserSettings> {
    return this.db.withTenant(tenantId, async (tx) => {
      const [t] = await tx.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1)
      if (t === undefined) throw new Error(`tenant ${String(tenantId)} not found`)
      const [p] = await tx
        .select()
        .from(userPrefs)
        .where(and(eq(userPrefs.tenantId, tenantId), eq(userPrefs.actorId, actorId)))
        .limit(1)

      return {
        locale: p?.locale ?? t.defaultLocale,
        displayTimezone: p?.displayTimezone ?? t.timezone,
        overrides: {
          locale: p?.locale != null,
          displayTimezone: p?.displayTimezone != null,
        },
        tenantDefaults: { locale: t.defaultLocale, timezone: t.timezone },
      }
    })
  }

  /* patch 的欄位若顯式帶 `null` = **取消自訂、回到繼承**;未帶該鍵 = 不動。
     這兩者必須分得開,否則使用者無法退回繼承(只能一直卡在某個自訂值)。 */
  async updateUser(
    tenantId: number,
    actorId: number,
    patch: { locale?: string | null | undefined; displayTimezone?: string | null | undefined },
  ): Promise<EffectiveUserSettings> {
    const set = defined(patch)
    if (Object.keys(set).length > 0) {
      await this.db.withTenant(tenantId, async (tx) => {
        await tx
          .insert(userPrefs)
          .values({ tenantId, actorId, ...set })
          .onConflictDoUpdate({
            target: [userPrefs.tenantId, userPrefs.actorId],
            set: { ...set, updatedAt: new Date() },
          })
      })
    }
    return this.getUser(tenantId, actorId)
  }
}

/* 去掉值為 `undefined` 的鍵。**`null` 必須留下** —— 它是「取消自訂、回到繼承」的指令,
   和「這個鍵沒送」是兩回事。兩者混為一談會讓使用者無法退回繼承。 */
function defined<T extends object>(patch: T): { [K in keyof T]: Exclude<T[K], undefined> } {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) out[k] = v
  }
  return out as { [K in keyof T]: Exclude<T[K], undefined> }
}
