import { describe, expect, it } from "vitest"
import type { FormAction } from "./authz"
import { PERMISSION_PRESETS, presetOf } from "./permission-presets"

const set = (...a: FormAction[]): Set<FormAction> => new Set(a)

describe("permission presets", () => {
  it("每個預設都能被自己反查出來(名稱與內容不得脫節)", () => {
    for (const p of PERMISSION_PRESETS) {
      expect(presetOf(new Set(p.actions))?.key).toBe(p.key)
    }
  })

  /* 🔴 不做「最接近」的模糊比對:把「檢視者 + 匯出」講成「檢視者」是謊報權限,
     而權限畫面謊報一次,客戶就不會再信任它顯示的任何一格。 */
  it("多一個動作就不是那個預設,回 null 由 UI 顯示「自訂」", () => {
    expect(presetOf(set("view", "export"))).toBeNull()
    expect(presetOf(set())).toBeNull()
  })

  it("預設由窄到寬,後者涵蓋前者(有序預設,SharePoint 形態)", () => {
    for (let i = 1; i < PERMISSION_PRESETS.length; i++) {
      const narrow = PERMISSION_PRESETS[i - 1]?.actions ?? []
      const wide = new Set(PERMISSION_PRESETS[i]?.actions ?? [])
      for (const a of narrow) expect(wide.has(a)).toBe(true)
    }
  })

  /* 用資料 ≠ 改結構(OQ-ARI-4=B 同一條原則) */
  it("design 只出現在設計者", () => {
    const withDesign = PERMISSION_PRESETS.filter((p) => p.actions.includes("design"))
    expect(withDesign.map((p) => p.key)).toEqual(["designer"])
  })

  it("填單者不含 edit —— 能新增不等於能改別人已建的", () => {
    const submitter = PERMISSION_PRESETS.find((p) => p.key === "submitter")
    expect(submitter?.actions).not.toContain("edit")
  })
})
