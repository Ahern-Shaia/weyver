"use client"

import { BarChart, LineChart, PieChart } from "echarts/charts"
import {
  AriaComponent,
  GridComponent,
  LegendComponent,
  TitleComponent,
  TooltipComponent,
} from "echarts/components"
import * as echarts from "echarts/core"
import { CanvasRenderer } from "echarts/renderers"
import { type ReactNode, useEffect, useRef } from "react"

/* 🔴 ECharts 薄封裝(F-2 M3)。

   **為什麼自寫而不用 `echarts-for-react`**|後者 peer 只寫 `>=16.0.0`、未明列 React 19,
   而它本身只是 3.5KB 的薄封裝 —— 自己寫四十行更可控,也少一個相依。

   **tree-shaken import**|`echarts/core` + 按需註冊,而非 `import * as echarts from "echarts"`
   (全包 gzip 359KB vs tree-shake 後約 80–100KB)。新增圖表型別時要回來註冊。

   **一律 client-only**|ECharts 的 SSR 需註冊字型檔來算字寬,而 CJK 字型 5–10MB;
   官方對此無指引。圖表不做 SSR 即完全規避。

   **a11y 預設開**|`aria.enabled` 讓 ECharts 自動產生描述供螢幕閱讀器讀取;
   `decal` 為色盲提供紋理區分(不只靠顏色)。這是企業/政府採購的實質要求,
   而 Chart.js 的 canvas 內容螢幕閱讀器讀不到正是它落選的原因。 */

/* 🔴 ECharts 只內建簡體 `ZH` 與 `EN`,而其 `aria.enabled` 產生的自動描述會**直接寫進
   容器的 `aria-label`**(覆蓋呼叫端設的值)。實走時因此看到簡體描述 ——
   對繁中產品是明顯瑕疵,且違反專案的繁中規則。故註冊繁體 locale 模板。 */
echarts.registerLocale("zh-TW", {
  time: {
    month: [
      "一月",
      "二月",
      "三月",
      "四月",
      "五月",
      "六月",
      "七月",
      "八月",
      "九月",
      "十月",
      "十一月",
      "十二月",
    ],
    monthAbbr: [
      "1月",
      "2月",
      "3月",
      "4月",
      "5月",
      "6月",
      "7月",
      "8月",
      "9月",
      "10月",
      "11月",
      "12月",
    ],
    dayOfWeek: ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"],
    dayOfWeekAbbr: ["日", "一", "二", "三", "四", "五", "六"],
  },
  legend: { selector: { all: "全選", inverse: "反選" } },
  toolbox: {
    brush: {
      title: {
        rect: "框選",
        polygon: "圈選",
        lineX: "橫向選擇",
        lineY: "縱向選擇",
        keep: "保持選擇",
        clear: "清除選擇",
      },
    },
    dataView: { title: "資料檢視", lang: ["資料檢視", "關閉", "重新整理"] },
    dataZoom: { title: { zoom: "區域縮放", back: "還原縮放" } },
    magicType: { title: { line: "折線圖", bar: "長條圖", stack: "堆疊", tiled: "並列" } },
    restore: { title: "還原" },
    saveAsImage: { title: "儲存為圖片", lang: ["右鍵另存圖片"] },
  },
  series: { typeNames: { pie: "圓餅圖", bar: "長條圖", line: "折線圖", scatter: "散佈圖" } },
  aria: {
    general: { withTitle: "這是一個關於「{title}」的圖表。", withoutTitle: "這是一個圖表," },
    series: {
      single: {
        prefix: "",
        withName: "圖表類型是{seriesType},表示{seriesName}。",
        withoutName: "圖表類型是{seriesType}。",
      },
      multiple: {
        prefix: "它由 {seriesCount} 個系列組成。",
        withName: "第 {seriesId} 個系列是表示{seriesName}的{seriesType},",
        withoutName: "第 {seriesId} 個系列是{seriesType},",
        separator: { middle: ";", end: "。" },
      },
    },
    data: {
      allData: "資料為 ——",
      partialData: "其中前 {displayCnt} 項為 ——",
      withName: "{name} 為 {value}",
      withoutName: "{value}",
      separator: { middle: ",", end: "" },
    },
  },
} as Parameters<typeof echarts.registerLocale>[1])

echarts.use([
  BarChart,
  LineChart,
  PieChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  AriaComponent,
  CanvasRenderer,
])

export type ChartOption = Parameters<echarts.ECharts["setOption"]>[0]

export function Chart({
  option,
  height = 320,
  ariaLabel,
}: {
  readonly option: ChartOption
  readonly height?: number
  readonly ariaLabel: string
}): ReactNode {
  const ref = useRef<HTMLDivElement | null>(null)
  const instance = useRef<echarts.ECharts | null>(null)

  useEffect(() => {
    if (ref.current === null) return
    const chart = echarts.init(ref.current, undefined, { renderer: "canvas", locale: "zh-TW" })
    instance.current = chart
    const onResize = (): void => chart.resize()
    window.addEventListener("resize", onResize)
    return () => {
      window.removeEventListener("resize", onResize)
      chart.dispose()
      instance.current = null
    }
  }, [])

  useEffect(() => {
    instance.current?.setOption(
      {
        /* 色盲可辨:不只靠顏色區分,加上紋理 */
        aria: { enabled: true, decal: { show: true } },
        ...(option as Record<string, unknown>),
      },
      true,
    )
  }, [option])

  return (
    /* 🔴 **外層帶名稱,內層讓 ECharts 自己管**。

       ECharts 啟用 `aria` 後會**覆寫容器的 `aria-label`**,換成自動產生的資料描述
       (「這是一個圖表,圖表類型是圓餅圖。資料為 —— 南區 為 1」)——
       也就是說呼叫端傳的 `ariaLabel` 會被**靜默吃掉**,每張圖的無障礙名稱都一樣。

       ⚠️ 試過改用 `aria.label.description` 把名稱塞進去,但那是**取代**整段描述
       不是附加 —— 名稱回來了、資料描述沒了,兩害相權。
       改為不跟它搶同一個節點:外層 `figure` 是人看得懂的名稱,
       內層由 ECharts 提供資料描述,兩者都在。 */
    <div role="figure" aria-label={ariaLabel} style={{ width: "100%" }}>
      <div ref={ref} style={{ height: `${String(height)}px`, width: "100%" }} />
    </div>
  )
}
