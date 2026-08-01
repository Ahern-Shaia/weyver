import { describe, expect, it } from "vitest"
import { assertSafeHeaders, isBlockedAddress, resolveSafeTarget } from "./ssrf-guard.js"

/* 🔴 SSRF 是 docs/22 威脅前三。這份測試刻意寫成**對抗性**的:
   每一條都對應一個真實被打穿過的手法,不是把實作再敘述一遍。 */

describe("IP 封鎖", () => {
  it.each([
    ["127.0.0.1", "loopback"],
    ["0.0.0.0", "全零"],
    ["10.1.2.3", "私有 A"],
    ["172.16.0.1", "私有 B 下界"],
    ["172.31.255.254", "私有 B 上界"],
    ["192.168.1.1", "私有 C"],
    ["169.254.169.254", "🔴 雲端 metadata"],
    ["100.64.0.1", "CGNAT"],
    ["224.0.0.1", "多播"],
    ["255.255.255.255", "廣播"],
    ["::1", "IPv6 loopback"],
    ["fc00::1", "IPv6 唯一本地"],
    ["fe80::1", "IPv6 連結本地"],
    ["ff02::1", "IPv6 多播"],
  ])("%s(%s)要被擋", (ip) => {
    expect(isBlockedAddress(ip)).not.toBeNull()
  })

  it.each([
    ["8.8.8.8"],
    ["1.1.1.1"],
    ["93.184.216.34"],
    ["2606:4700:4700::1111"],
    /* 🔴 這兩條是**正規化到底有沒有生效**的證據。
       只放「mapped 內網要被擋」不夠 —— 首段解析壞掉時它們也會被擋(NaN 分支),
       測試就會因為錯的理由通過。公網 mapped 位址必須**放行**才證明真的解析了。 */
    ["::ffff:8.8.8.8"],
    ["::ffff:0808:0808"],
    ["::ffff:1.1.1.1"],
  ])("%s 公網位址要放行", (ip) => {
    expect(isBlockedAddress(ip)).toBeNull()
  })

  /* 🔴 IPv4-mapped IPv6:不正規化就會整條繞過 10/8、169.254/16 等規則。
     兩種寫法(點分十進位與十六進位)都要擋。 */
  it.each([
    ["::ffff:169.254.169.254", "metadata 的 mapped 寫法"],
    ["::ffff:127.0.0.1", "loopback 的 mapped 寫法"],
    ["::ffff:10.0.0.1", "私有 A 的 mapped 寫法"],
    ["::ffff:a9fe:a9fe", "metadata 的十六進位 mapped 寫法"],
    ["::ffff:7f00:1", "loopback 的十六進位 mapped 寫法"],
  ])("%s(%s)要被擋", (ip) => {
    expect(isBlockedAddress(ip)).not.toBeNull()
  })

  it("垃圾字串不當成放行", () => {
    expect(isBlockedAddress("not-an-ip")).not.toBeNull()
    expect(isBlockedAddress("")).not.toBeNull()
  })
})

describe("URL 驗證", () => {
  it("拒 http(只允許 https)", async () => {
    await expect(resolveSafeTarget("http://example.com/hook")).rejects.toThrow(/https/)
  })

  it.each([
    ["file:///etc/passwd"],
    ["gopher://evil/"],
    ["ftp://example.com/"],
    ["data:text/plain,hi"],
  ])("拒非 http(s) scheme:%s", async (url) => {
    await expect(resolveSafeTarget(url)).rejects.toThrow()
  })

  it("拒 URL 內嵌帳密(常被用來偽裝目標主機)", async () => {
    await expect(resolveSafeTarget("https://user:pw@example.com/")).rejects.toThrow(/帳密/)
  })

  it("拒直接指向內網 IP 的 https URL", async () => {
    await expect(resolveSafeTarget("https://169.254.169.254/latest/meta-data/")).rejects.toThrow(
      /私有或保留/,
    )
    await expect(resolveSafeTarget("https://127.0.0.1:9200/")).rejects.toThrow(/私有或保留/)
  })

  it("拒中括號寫法的 IPv6 內網位址", async () => {
    await expect(resolveSafeTarget("https://[::1]/hook")).rejects.toThrow(/本機/)
  })

  it("URL 格式無效即拒", async () => {
    await expect(resolveSafeTarget("https://")).rejects.toThrow()
    await expect(resolveSafeTarget("……")).rejects.toThrow()
  })
})

describe("自訂 header 驗證(GitLab CVE-2025-6454:header 值也是注入面)", () => {
  it("放行正常 header", () => {
    expect(() => {
      assertSafeHeaders({ "X-Tenant-Ref": "abc-123" })
    }).not.toThrow()
  })

  it("🔴 拒含 CR/LF 的值(請求拆分)", () => {
    expect(() => {
      assertSafeHeaders({ "X-A": "ok\r\nX-Injected: evil" })
    }).toThrow(/控制字元/)
    expect(() => {
      assertSafeHeaders({ "X-A": "ok\nevil" })
    }).toThrow(/控制字元/)
  })

  it("拒覆寫保留 header", () => {
    for (const name of ["Host", "authorization", "Webhook-Signature", "Content-Length"]) {
      expect(() => {
        assertSafeHeaders({ [name]: "x" })
      }).toThrow(/保留 header/)
    }
  })

  it("拒不合法的 header 名稱", () => {
    expect(() => {
      assertSafeHeaders({ "bad name": "x" })
    }).toThrow(/名稱不合法/)
  })
})
