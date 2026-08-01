import { chromium } from "@playwright/test"
const OUT = "/Users/ahern/Documents/work_work/weyver/docs/research/ui-screenshots/baserow"
const B = "http://localhost:8081"
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 })
await p.goto(`${B}/login`, { waitUntil: "networkidle" }); await p.waitForTimeout(3000)
const ins = await p.$$("input")
if (ins.length >= 2) { await ins[0].fill("study@example.com"); await ins[1].fill("WeyverStudy2026!") }
await p.getByRole("button", { name: /Sign in|Login/i }).first().click().catch(()=>p.keyboard.press("Enter"))
await p.waitForTimeout(7000)
// onboarding 一路推進
for (let i=0;i<8;i++){
  await p.getByText("Projects").first().click({ timeout: 1500 }).catch(()=>{})
  const btn = p.getByRole("button", { name: /Continue|Next|Skip|Finish|Create/i }).first()
  if (await btn.isEnabled().catch(()=>false)) { await btn.click().catch(()=>{}); await p.waitForTimeout(3500) }
  else { await p.waitForTimeout(1500) }
  if (!p.url().includes("onboarding")) break
}
console.log("url:", p.url())
let n = 2
const shot = async (name, w=2500) => { await p.waitForTimeout(w); n++
  await p.screenshot({ path: `${OUT}/baserow-${String(n).padStart(2,"0")}-${name}.png` }); console.log("✓", name) }
await shot("grid")
await b.close()
