import type { ReactElement } from "react"

/* R1·UP-3b C-2|條件式格式的「顯示訊息」效果(OQ-CF-11)。

   🔴 **一律純文字**。訊息文字由使用者自訂、帶入的值是資料 —— 兩者都是不可信輸入。
   React 的預設跳脫已經足夠,**條件是永遠不要走 `dangerouslySetInnerHTML`**;
   這個元件存在的理由之一就是讓那條規則只有一個落點,而不是散在兩個畫面裡各寫一次。

   插值(含遮罩時回具名的「(無權檢視)」)在 `conditional-format.ts` 的 `renderMessage`。 */
export function RuleMessages({
  messages,
}: { readonly messages: readonly string[] }): ReactElement | null {
  if (messages.length === 0) return null
  return (
    <div data-testid="rule-messages" className="mb-2 flex flex-col gap-1">
      {messages.map((m) => (
        <p
          key={m}
          role="status"
          className="rounded-xs border border-warn-line bg-warn-t px-2 py-1 text-[12px] text-warn"
        >
          {m}
        </p>
      ))}
    </div>
  )
}
