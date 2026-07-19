import { ConfigService } from "@nestjs/config"
import type { NestFastifyApplication } from "@nestjs/platform-fastify"
import { mountAuthHandler } from "./auth/auth-http.js"
import type { Auth } from "./auth/auth.js"
import { AUTH } from "./auth/auth.tokens.js"

/* main.ts(prod)與整合測共用的 HTTP 層設定,確保 prod 與測試同構:
   - 安全標頭 onSend hook(API 只回 JSON,不用 helmet 全套避免 Fastify 版本衝突)
   - 掛 Better Auth handler /api/auth/*(login/logout/register/org)
   於 app 建立後、listen/ready 前呼叫(Fastify 尚未 ready,可註冊 hook / route)。 */
export async function configureApp(app: NestFastifyApplication): Promise<void> {
  const isProd = app.get(ConfigService).get<string>("NODE_ENV") === "production"
  const fastify = app.getHttpAdapter().getInstance()

  fastify.addHook("onSend", (_request, reply, payload, done) => {
    reply.header("x-content-type-options", "nosniff")
    reply.header("x-frame-options", "DENY")
    reply.header("referrer-policy", "no-referrer")
    reply.header("x-dns-prefetch-control", "off")
    if (isProd) reply.header("strict-transport-security", "max-age=15552000; includeSubDomains")
    done(null, payload)
  })

  const auth = app.get<Auth>(AUTH)
  mountAuthHandler(fastify, auth)
  return Promise.resolve()
}
