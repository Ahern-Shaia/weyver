"use client"

import { useEffect, useState } from "react"
import { fetchFileBlob } from "./client"

/* R1·UP-4b(OQ-IS-3=A)|影像預覽來源。

   下載端點固定 `Content-Disposition: attachment` + `application/octet-stream`
   (docs/22 防 HTML/SVG XSS 之不變量,**不放寬**),且 dev 需帶租戶標頭
   → 無法直接 `<img src=端點>`,改以 fetch → blob → objectURL。
   卸載 / key 變更時 revokeObjectURL,避免長時間瀏覽累積記憶體。 */
export function useFilePreview(key: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (key === null) {
      setUrl(null)
      return
    }
    let objectUrl: string | null = null
    let cancelled = false
    void fetchFileBlob(key)
      .then((blob) => {
        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        setUrl(objectUrl)
      })
      .catch(() => {
        if (!cancelled) setUrl(null)
      })
    return () => {
      cancelled = true
      if (objectUrl !== null) URL.revokeObjectURL(objectUrl)
    }
  }, [key])

  return url
}
