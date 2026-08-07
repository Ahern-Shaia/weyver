import { describe, expect, it } from "vitest"
import {
  type TemplatePack,
  compareVersion,
  templatePackSchema,
  topoOrder,
  validatePackRefs,
} from "./template-specs.js"

const pack = (forms: unknown[]): TemplatePack =>
  templatePackSchema.parse({
    key: "test-pack",
    version: "1",
    name: "測試包",
    description: "",
    forms,
  })

const f = (ref: string, o: Record<string, unknown> = {}) => ({
  ref,
  name: ref,
  fields: [],
  ...o,
})

describe("validatePackRefs", () => {
  it("乾淨的包沒有錯誤", () => {
    expect(
      validatePackRefs(
        pack([
          f("orders"),
          f("lines", { parentRef: "orders" }),
          f("customers", { fields: [{ name: "客戶", type: "link", targetRef: "orders" }] }),
        ]),
      ),
    ).toEqual([])
  })

  /* 🔴 OQ-TPL-2=A 的整個理由:**沒對應到的 ref 要在套用前驗得出來**。
     存真實 id 的話,這種錯只會表現成一個壞掉的關聯,而且不會報錯。 */
  it("指向不存在的 ref → 在套用前就抓到", () => {
    const errs = validatePackRefs(
      pack([f("a", { fields: [{ name: "關聯", type: "link", targetRef: "nope" }] })]),
    )
    expect(errs.join()).toContain("nope")
  })

  it("parentRef 指向不存在 / 指向自己都要擋", () => {
    expect(validatePackRefs(pack([f("a", { parentRef: "ghost" })])).join()).toContain("ghost")
    expect(validatePackRefs(pack([f("a", { parentRef: "a" })])).join()).toContain(
      "不能是自己的子表",
    )
  })

  it("ref 重複要擋 —— 否則映射表會被後者覆蓋而前者靜默指錯", () => {
    expect(validatePackRefs(pack([f("a"), f("a")])).join()).toContain("重複")
  })
})

describe("topoOrder", () => {
  it("父表先於子表、被指向者先於指向者", () => {
    const p = pack([
      f("lines", { parentRef: "orders" }),
      f("orders", { fields: [{ name: "客戶", type: "link", targetRef: "customers" }] }),
      f("customers"),
    ])
    const order = topoOrder(p)?.map((x) => x.ref)
    expect(order).toEqual(["customers", "orders", "lines"])
  })

  /* 環不是可以容忍的邊角 —— 它會讓建表卡死,必須在套用前擋下 */
  it("互相指向 → 回 null(有環)", () => {
    const p = pack([f("a", { parentRef: "b" }), f("b", { parentRef: "a" })])
    expect(topoOrder(p)).toBeNull()
  })

  it("link 指回本表是合法的(樹狀主檔),不算環", () => {
    const p = pack([f("a", { fields: [{ name: "上層", type: "link", targetRef: "a" }] })])
    expect(topoOrder(p)?.map((x) => x.ref)).toEqual(["a"])
  })
})

describe("compareVersion", () => {
  it("比大小", () => {
    expect(compareVersion("1.0", "1.1")).toBeLessThan(0)
    expect(compareVersion("1.1", "1.0")).toBeGreaterThan(0)
    expect(compareVersion("1.0", "1.0")).toBe(0)
  })

  it("段數不同時補 0 —— 1.0 與 1.0.0 是同一版", () => {
    expect(compareVersion("1.0", "1.0.0")).toBe(0)
    expect(compareVersion("1.0.1", "1.0")).toBeGreaterThan(0)
  })

  it("2.0 大於 10 進位的假象(字串比較會判反)", () => {
    expect(compareVersion("10.0", "9.0")).toBeGreaterThan(0)
    expect(compareVersion("1.10", "1.9")).toBeGreaterThan(0)
  })

  it("壞版本字串不拋,退化成「沒有新版」這個安全方向", () => {
    expect(compareVersion("abc", "1.0")).toBeLessThan(0)
    expect(compareVersion("", "")).toBe(0)
  })
})
