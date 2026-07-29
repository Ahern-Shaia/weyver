"use client"

import { Select } from "@weyver/ui/select"
import { Eye, UserCheck } from "lucide-react"
import { type ReactNode, useState } from "react"
import { useAccessPreview, usePreviewActors, useResources } from "@/lib/engine/authz"

/* 🔴 E-1 預覽模擬器(#96 M3)。

   **為什麼這是 P0**|Salesforce Community 外洩(Krebs / Varonis 揭露)的根因不是
   規則寫錯,而是「**規則語意正確但管理員理解錯**」—— 而該產品無法在設定當下
   看見實際效果。權限功能的預設失效模式就是「以為設對了」。

   **顯示「為什麼」而不只是數字**|只給一個數字,管理員無從判斷設定對不對。
   每筆標出 owner / assigned / unrestricted,他才看得懂是哪條規則讓這筆可見。 */

const REASON_LABEL: Record<string, string> = {
  owner: "自己建立",
  assigned: "被指派",
  unrestricted: "未設範圍",
}

export function AccessPreview(): ReactNode {
  const { data: resources } = useResources()
  /* 🔴 不限本角色成員(瀏覽器實走時發現):有效存取是「這個人透過**所有**角色
     能看到什麼」,限定本角色在語意上是錯的,而且沒有成員的角色會讓面板完全不可用。 */
  const { data: actors } = usePreviewActors()
  const [formId, setFormId] = useState<number | null>(null)
  const [actorId, setActorId] = useState<number | null>(null)
  const { data, isPending, isError } = useAccessPreview(formId, actorId)

  return (
    <section className="mt-4 rounded-md border border-line bg-card p-3">
      <div className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold text-ink">
        <Eye size={13} className="text-ink-3" />
        存取預覽
      </div>
      <p className="mb-3 text-[11px] leading-relaxed text-ink-3">
        選一位使用者與一張表單,試算他實際看得到哪些記錄。
        <b className="text-ink-2">唯讀試算</b>,不會以他的身分登入。
      </p>

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-[11px] text-ink-2">
          表單
          <Select
            value={formId === null ? "" : String(formId)}
            onChange={(e) => setFormId(e.target.value === "" ? null : Number(e.target.value))}
            className="h-7 w-52"
            aria-label="預覽表單"
          >
            <option value="">請選擇</option>
            {(resources?.forms ?? []).map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-ink-2">
          使用者
          <Select
            value={actorId === null ? "" : String(actorId)}
            onChange={(e) => setActorId(e.target.value === "" ? null : Number(e.target.value))}
            className="h-7 w-40"
            aria-label="預覽使用者"
          >
            <option value="">請選擇</option>
            {(actors ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </label>
      </div>

      {(actors ?? []).length === 0 ? (
        <div className="mt-2 text-[11px] text-ink-4">
          租戶內尚無任何具角色的使用者 —— 先到「成員」指派角色後才能試算。
        </div>
      ) : null}

      {formId !== null && actorId !== null ? (
        isError ? (
          <div className="mt-3 text-[11.5px] text-er">試算失敗</div>
        ) : isPending ? (
          <div className="mt-3 text-[11.5px] text-ink-4">試算中…</div>
        ) : data === undefined ? null : (
          <div className="mt-3 space-y-2">
            <div className="flex flex-wrap items-center gap-3 text-[12px] text-ink">
              <span>
                看得到 <b>{data.visibleCount}</b> / 全部 {data.totalCount} 筆
              </span>
              {data.scoped ? (
                <span className="flex items-center gap-1 text-[11px] text-ink-3">
                  <UserCheck size={11} />
                  此表的檢視已設為「只限自己的」
                </span>
              ) : null}
            </div>

            {data.visibleCount === 0 ? (
              <div className="text-[11.5px] text-warn">
                這位使用者一筆都看不到 —— 若非預期,請確認角色是否有此表的檢視權。
              </div>
            ) : (
              <ul className="divide-y divide-line border border-line">
                {data.samples.map((s) => (
                  <li
                    key={s.recordId}
                    className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-[11.5px]"
                  >
                    <span className="truncate text-ink">{s.title}</span>
                    {/* 「為什麼看得到」—— 沒有這個,管理員只能看到一個數字 */}
                    <span className="shrink-0 text-[10.5px] text-ink-4">
                      {REASON_LABEL[s.reason] ?? s.reason}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {data.visibleCount > data.samples.length ? (
              <div className="text-[10.5px] text-ink-4">
                僅列出前 {data.samples.length} 筆
              </div>
            ) : null}
          </div>
        )
      ) : null}
    </section>
  )
}
