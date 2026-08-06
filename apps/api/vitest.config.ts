import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    testTimeout: 180_000,
    hookTimeout: 180_000,
    /* 🟡 限制並行檔數 —— **緩解,不是已證實的根因。**

       症狀:整套跑三次各有不同的紅,每一條單獨跑都會過,其中一條耗時
       14,956ms 對比單跑的 ~150ms。合理的懷疑是資源競爭:
       **64 個整合測試檔各起一個 PostgreSQL Testcontainer**,而 vitest 預設
       以 CPU 數(本機 10)並行。

       🔴 **但我一度把它當成已證實的根因,而證據鏈有個混淆:**
       第一版設定寫成 `poolOptions.threads.maxThreads`(vitest **3** 的寫法),
       在 vitest 4 的 `InlineConfig` 上**根本不存在** —— 也就是那個設定被忽略了。
       而那之後連續兩次全綠 **是在預設並行度下跑出來的**。
       真正的變因更可能是:早先幾次跑的時候,同一台機器上還開著 dev server、
       背景 agent、瀏覽器與 docker build。

       所以現在的狀態誠實地說是:**維持 4 是合理的保險**(64 個容器搶 10 條執行緒
       本來就過頭),但**「並行度是根因」未經證實**。要證實得在乾淨機器上
       對照跑(預設 vs 4)各數次 —— 見 task #43。

       ⚠️ 教訓與今日其他四次同型:**做了一個實驗,拿到想要的結果,就宣稱因果**。
       這次是自己寫註解時發現鍵名不對才回頭看的。 */
    maxWorkers: 4,
  },
})
