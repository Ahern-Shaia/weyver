/* P0-4a role tree 純邏輯(OQ-1=C)。祖先閉包 + 防環 + 深度上限;無 I/O,單元可測。
   即使資料層異常有環,走訪 visited set 保證不無限迴圈(§5.1 防禦)。 */

export const MAX_ROLE_TREE_DEPTH = 8

export class RoleTreeDepthError extends Error {
  constructor(readonly attemptedDepth: number) {
    super(`role tree depth ${attemptedDepth} exceeds max ${MAX_ROLE_TREE_DEPTH}`)
    this.name = "RoleTreeDepthError"
  }
}

export class RoleCycleError extends Error {
  constructor(readonly roleId: number) {
    super(`setting parent would create a cycle for role ${roleId}`)
    this.name = "RoleCycleError"
  }
}

export type ParentLookup = (roleId: number) => number | null | undefined

/* 給定一組 seed 角色,沿 parent 上溯回傳「自身 + 所有祖先」的 id 集合。
   visited 防環;缺 parent(undefined)視為已到頂。 */
export function resolveRoleClosure(seeds: Iterable<number>, parentOf: ParentLookup): Set<number> {
  const closure = new Set<number>()
  const stack = [...seeds]
  while (stack.length > 0) {
    const id = stack.pop()
    if (id === undefined || closure.has(id)) continue
    closure.add(id)
    const parent = parentOf(id)
    if (parent !== null && parent !== undefined && !closure.has(parent)) {
      stack.push(parent)
    }
  }
  return closure
}

/* 將角色 roleId 的 parent 設為 newParentId 是否成環:
   若 roleId 出現在 newParentId 的祖先鏈(含自身)中,則成環。 */
export function wouldCreateCycle(
  roleId: number,
  newParentId: number | null,
  parentOf: ParentLookup,
): boolean {
  if (newParentId === null) return false
  if (newParentId === roleId) return true
  const ancestorsOfParent = resolveRoleClosure([newParentId], parentOf)
  return ancestorsOfParent.has(roleId)
}

/* 依 parent 深度算子節點深度;超上限拋錯。parent 為 null → 深度 0。 */
export function depthForParent(parentDepth: number | null): number {
  const depth = parentDepth === null ? 0 : parentDepth + 1
  if (depth > MAX_ROLE_TREE_DEPTH) throw new RoleTreeDepthError(depth)
  return depth
}
