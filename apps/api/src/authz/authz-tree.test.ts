import { describe, expect, it } from "vitest"
import {
  MAX_ROLE_TREE_DEPTH,
  RoleTreeDepthError,
  depthForParent,
  resolveRoleClosure,
  wouldCreateCycle,
} from "./authz-tree.js"

/* 樹:1(根) → 2 → 3;1 → 4 */
const parents = new Map<number, number | null>([
  [1, null],
  [2, 1],
  [3, 2],
  [4, 1],
])
const parentOf = (id: number): number | null | undefined => parents.get(id)

describe("resolveRoleClosure(祖先閉包)", () => {
  it("includes self and all ancestors up to root", () => {
    expect([...resolveRoleClosure([3], parentOf)].sort()).toEqual([1, 2, 3])
    expect([...resolveRoleClosure([4], parentOf)].sort()).toEqual([1, 4])
    expect([...resolveRoleClosure([1], parentOf)]).toEqual([1])
  })

  it("unions closures of multiple seed roles, deduped", () => {
    expect([...resolveRoleClosure([3, 4], parentOf)].sort()).toEqual([1, 2, 3, 4])
  })

  it("terminates even if data has a cycle (visited guard)", () => {
    const cyclic = new Map<number, number | null>([
      [1, 2],
      [2, 3],
      [3, 1],
    ])
    const closure = resolveRoleClosure([1], (id) => cyclic.get(id))
    expect([...closure].sort()).toEqual([1, 2, 3])
  })
})

describe("wouldCreateCycle(reparent 防環)", () => {
  it("true when new parent is a descendant (or self)", () => {
    // 把 1 掛到 3 之下 → 3 的祖先鏈含 1 → 成環
    expect(wouldCreateCycle(1, 3, parentOf)).toBe(true)
    expect(wouldCreateCycle(2, 2, parentOf)).toBe(true)
  })

  it("false for valid reparent or detach", () => {
    // 把 4 掛到 3 之下 → 合法(3 祖先鏈不含 4)
    expect(wouldCreateCycle(4, 3, parentOf)).toBe(false)
    expect(wouldCreateCycle(3, null, parentOf)).toBe(false)
  })
})

describe("depthForParent(深度上限)", () => {
  it("root is 0, child is parent+1", () => {
    expect(depthForParent(null)).toBe(0)
    expect(depthForParent(0)).toBe(1)
    expect(depthForParent(MAX_ROLE_TREE_DEPTH - 1)).toBe(MAX_ROLE_TREE_DEPTH)
  })

  it("throws when exceeding max depth", () => {
    expect(() => depthForParent(MAX_ROLE_TREE_DEPTH)).toThrow(RoleTreeDepthError)
  })
})
