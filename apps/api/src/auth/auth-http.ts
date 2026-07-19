import type { FastifyInstance } from "fastify"
import type { Auth } from "./auth.js"

/* 把 Better Auth 的 web-standard handler 掛到 Fastify(login/logout/register/org 端點於 /api/auth/*)。
   於 main.ts(prod)與 handler 整合測掛載;guard 的 getSession 走同一 auth 實例,無需經此路由。
   set-cookie 可為多筆 → 用 getSetCookie() 陣列回,避免被單值覆蓋。 */
export function mountAuthHandler(fastify: FastifyInstance, auth: Auth): void {
  fastify.route({
    method: ["GET", "POST"],
    url: "/api/auth/*",
    handler: async (request, reply): Promise<void> => {
      const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`)
      const headers = new Headers()
      for (const [key, value] of Object.entries(request.headers)) {
        if (typeof value === "string") headers.set(key, value)
        else if (Array.isArray(value)) for (const item of value) headers.append(key, item)
      }

      const hasBody = request.body !== undefined && request.body !== null
      const webRequest = new Request(url.toString(), {
        method: request.method,
        headers,
        ...(hasBody ? { body: JSON.stringify(request.body) } : {}),
      })

      const response = await auth.handler(webRequest)

      reply.status(response.status)
      const setCookies = response.headers.getSetCookie()
      if (setCookies.length > 0) reply.header("set-cookie", setCookies)
      response.headers.forEach((value, key) => {
        if (key.toLowerCase() !== "set-cookie") reply.header(key, value)
      })

      const text = await response.text()
      await reply.send(text.length > 0 ? text : null)
    },
  })
}
