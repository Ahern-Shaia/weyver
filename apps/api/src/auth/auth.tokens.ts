/* AUTH DI token 獨立於 auth.module.ts,避免 auth.module ↔ auth-guard 的循環 import
   (循環會使 @Inject(AUTH) 於裝飾器執行時取到 undefined,DI 解析失敗)。 */
export const AUTH = Symbol("AUTH")
