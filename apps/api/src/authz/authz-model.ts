/* P0-4a authz 純邏輯(無 I/O,單元可測):級別序、聯集(多角色/祖先)、交集(欄位收斂於表單)。
   docs/modules/R1/authz.md §4.2 / §5.1。 */

export const FORM_LEVELS = ["none", "read", "write", "manage"] as const
export type FormLevel = (typeof FORM_LEVELS)[number]

export const FIELD_VISIBILITIES = ["hidden", "read", "write"] as const
export type FieldVisibility = (typeof FIELD_VISIBILITIES)[number]

const FORM_LEVEL_RANK: Record<FormLevel, number> = { none: 0, read: 1, write: 2, manage: 3 }
const FIELD_VIS_RANK: Record<FieldVisibility, number> = { hidden: 0, read: 1, write: 2 }

/* 多角色 / 祖先繼承 → 取最寬鬆(聯集,較高權勝)*/
export function maxFormLevel(a: FormLevel, b: FormLevel): FormLevel {
  return FORM_LEVEL_RANK[a] >= FORM_LEVEL_RANK[b] ? a : b
}

export function maxFieldVisibility(a: FieldVisibility, b: FieldVisibility): FieldVisibility {
  return FIELD_VIS_RANK[a] >= FIELD_VIS_RANK[b] ? a : b
}

/* 表單級 → 該表所有欄位的預設可見性(欄位缺列時繼承)。read/write/manage 映到欄位軸;none 無欄可見 */
export function formLevelToDefaultFieldVisibility(level: FormLevel): FieldVisibility {
  switch (level) {
    case "none":
      return "hidden"
    case "read":
      return "read"
    case "write":
    case "manage":
      return "write"
  }
}

/* 欄位級收斂於表單級(交集,較嚴者勝):
   表單 read 之下,即使某欄給 write,實際仍只能 read;表單 none 之下一律 hidden。 */
export function clampFieldToForm(vis: FieldVisibility, form: FormLevel): FieldVisibility {
  const ceiling = formLevelToDefaultFieldVisibility(form)
  return FIELD_VIS_RANK[vis] <= FIELD_VIS_RANK[ceiling] ? vis : ceiling
}

export function canReadForm(level: FormLevel): boolean {
  return FORM_LEVEL_RANK[level] >= FORM_LEVEL_RANK.read
}

export function canWriteForm(level: FormLevel): boolean {
  return FORM_LEVEL_RANK[level] >= FORM_LEVEL_RANK.write
}

export function canManageForm(level: FormLevel): boolean {
  return level === "manage"
}

/* HTTP 方法 → 該路由所需表單級別(GET=read;寫=write;設計器=manage 由呼叫端指定)*/
export function requiredLevelForMethod(method: string): FormLevel {
  return method === "GET" || method === "HEAD" ? "read" : "write"
}
