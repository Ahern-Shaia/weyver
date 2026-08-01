"use client"

import { Button } from "@weyver/ui/button"
import { useState } from "react"

/* 🔴 R1·F-4 殘留|備用碼的保存體驗。

   ## 為什麼這是缺口而不是「錦上添花」

   本專案的備用碼是**單向雜湊**儲存(#111),而且只在啟用當下顯示一次 ——
   合起來的意思是:**弄丟就永久拿不回來**。而弄丟手機正是備用碼存在的理由,
   所以「手機掉了 + 備用碼沒存好」= 帳號永久鎖死,只能請人改資料庫。

   GitHub / Google 官方都提供**下載 / 列印 / 複製**三種取得方式,並要求
   使用者**確認已保存**才讓流程往下走。本元件照抄那個形狀。

   ## 為什麼一定要能「重新產生」

   兩種情境沒有重生就無解:(a) 用掉大半、剩沒幾組;(b) 懷疑外洩。
   目前唯一的辦法是停用 MFA 再重新啟用 —— 那中間有一段**完全沒有第二因子**
   的空窗,為了換一組碼而暫時降低安全等級,顯然本末倒置。 */

export function BackupCodes({
  codes,
  onRegenerate,
  regenerating,
}: {
  readonly codes: readonly string[]
  /* 給已啟用者用;enroll 當下不提供(那時本來就是新的一組) */
  readonly onRegenerate?: () => void
  readonly regenerating?: boolean
}): React.ReactNode {
  const [copied, setCopied] = useState(false)

  const text = codes.join("\n")

  const download = (): void => {
    /* 純前端產檔:備用碼**不該再繞一趟伺服器**,那只是多一個會被記錄的地方 */
    const url = URL.createObjectURL(new Blob([`${text}\n`], { type: "text/plain" }))
    try {
      const a = document.createElement("a")
      a.href = url
      a.download = "weyver-備用碼.txt"
      a.click()
    } finally {
      URL.revokeObjectURL(url)
    }
  }

  const copy = (): void => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2_000)
    })
  }

  return (
    <div className="flex flex-col gap-2">
      <div
        data-testid="backup-codes"
        className="grid grid-cols-2 gap-1 rounded-sm border border-line bg-head p-2 font-mono text-[12px] text-ink-2"
      >
        {codes.map((c) => (
          <span key={c}>{c}</span>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={download}>下載為 .txt</Button>
        <Button onClick={copy}>{copied ? "已複製" : "複製全部"}</Button>
        <Button
          onClick={() => {
            window.print()
          }}
        >
          列印
        </Button>
        {onRegenerate ? (
          <Button variant="danger" onClick={onRegenerate} disabled={regenerating === true}>
            {regenerating === true ? "產生中…" : "重新產生"}
          </Button>
        ) : null}
      </div>
      {onRegenerate ? (
        /* 重生會讓舊碼全部失效 —— 沒講的話,使用者手上那張紙會在不知情的狀況下變廢紙 */
        <p className="text-[12px] text-ink-3">
          重新產生會使<b>目前所有備用碼立即失效</b>。
        </p>
      ) : null}
    </div>
  )
}
