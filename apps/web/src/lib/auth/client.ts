import { organizationClient } from "better-auth/client/plugins"
import { createAuthClient } from "better-auth/react"

/* Better Auth 前端 client;baseURL 取瀏覽器實際 origin + /api/auth(經 Next rewrite 同源代理到 api)。
   SSR 期無 window → 佔位 URL(這些 hook/action 只在瀏覽器實際 fetch);client 端用真 origin
   → 任意 port/domain 皆同源、cookie 正常。organizationClient = 多租戶 org(建立 / 切換 active org)。 */
const baseURL =
  typeof window === "undefined" ? "http://localhost/api/auth" : `${window.location.origin}/api/auth`

export const authClient = createAuthClient({
  baseURL,
  plugins: [organizationClient()],
})

export const { signIn, signUp, signOut, useSession, organization, useActiveOrganization } =
  authClient
