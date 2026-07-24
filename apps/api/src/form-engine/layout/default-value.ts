import type { DefaultValue } from "./layout-specs.js"

/* R1·UP-3 預設值變數解析(create-time 集;OQ-FD2-6)。全 UTC 一致;
   formula-default → P1(回 undefined,不套)。 */

export interface DefaultCtx {
  readonly actorId: number
  readonly userName: string | null
  readonly now: Date
}

export function resolveDefaultValue(def: DefaultValue, ctx: DefaultCtx): string | undefined {
  if (def.kind === "literal") return def.value
  if (def.kind === "formula") return undefined // P1
  const d = ctx.now
  switch (def.value) {
    case "$DATE":
      return d.toISOString().slice(0, 10)
    case "$TIME":
      return d.toISOString().slice(11, 19)
    case "$DATETIME":
      return d.toISOString()
    case "$YEAR":
      return String(d.getUTCFullYear())
    case "$MONTH":
      return String(d.getUTCMonth() + 1)
    case "$WEEKDAY":
      return String(d.getUTCDay())
    case "$USERID":
      return String(ctx.actorId)
    case "$USERNAME":
      return ctx.userName ?? String(ctx.actorId)
  }
}

export function defaultNeedsUserName(def: DefaultValue): boolean {
  return def.kind === "variable" && def.value === "$USERNAME"
}
