import { type ClassValue, clsx } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

/* 🔴 2026-08-08|`text-tag`(11px 標籤軌)必須註冊為**字級**,否則會被靜默刪掉。

   tailwind-merge 對 `text-*` 的預設分群是「顏色」,而它不認得的自訂名稱一律歸到顏色群。
   於是 `cn("text-tag ...", "text-ok")` 會判定兩者衝突、**只留後者** ——
   `text-tag` 連 DOM 都沒到達。

   ⚠️ 這與 CSS 無關:`.text-tag { font-size: var(--text-tag) }` 有產生、
   `--text-tag: 11px` 有解析,單獨用也是 11px。
   壞在**字串合併階段**,所以查 styleSheets 查不出來 —— 要看元素最終的 className 才發現。

   ⚠️ 同一個命名空間今天已經咬過一次:`--text-label` 撞 `--color-label`,
   當時的結論是「改名 `text-tag` 就好」—— **那只解掉 CSS 變數的衝突,沒解掉這一層**。
   改名不夠,要註冊。 */
const twMerge = extendTailwindMerge({
  extend: { classGroups: { "font-size": [{ text: ["tag"] }] } },
})

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
