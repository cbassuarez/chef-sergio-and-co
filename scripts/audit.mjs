// Lighthouse (mobile, simulated throttling) on key routes + axe-core on every route at phone and desktop widths,
// with screenshots. Pass bars: Performance >= 90, Accessibility >= 95, SEO = 100 (the prototype's intentional noindex
// is reported separately), axe: 0 serious/critical violations.
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import lighthouse from 'lighthouse'
import puppeteer from 'puppeteer-core'
import { loadRoutes } from './lib.mjs'
import { serve } from './serve.mjs'

const require = createRequire(import.meta.url)
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const SHOTS = process.env.SHOTS_DIR || '.audit'
fs.mkdirSync(SHOTS, { recursive: true })
const PORT = 4321
const server = await serve(PORT)
const { routes } = await loadRoutes()
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] })
const axeSrc = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8')

const failures = []
const rows = []

// axe + screenshots, every route, two widths
for (const r of routes) {
  for (const [label, width, height, mobile] of [['phone', 390, 844, true], ['desktop', 1440, 900, false]]) {
    const page = await browser.newPage()
    await page.setViewport({ width, height, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 })
    await page.goto(`http://localhost:${PORT}${r.path}`, { waitUntil: 'networkidle0' })
    // Scroll through so lazy images load before the full-page screenshot.
    await page.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += 400) {
        window.scrollTo(0, y)
        await new Promise((r) => setTimeout(r, 60))
      }
      window.scrollTo(0, 0)
    })
    await page.waitForNetworkIdle({ idleTime: 300 })
    await page.addScriptTag({ content: axeSrc })
    const res = await page.evaluate(async () => {
      // eslint-disable-next-line no-undef
      const out = await axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa', 'best-practice'] })
      return out.violations.map((v) => ({ id: v.id, impact: v.impact, n: v.nodes.length, target: v.nodes[0]?.target?.join(' ') }))
    })
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    const bad = res.filter((v) => v.impact === 'serious' || v.impact === 'critical')
    for (const v of bad) failures.push(`axe ${label} ${r.path}: ${v.id} (${v.impact}) ×${v.n} e.g. ${v.target}`)
    if (overflow > 0) failures.push(`${label} ${r.path}: horizontal overflow ${overflow}px`)
    const minor = res.filter((v) => !bad.includes(v))
    rows.push(`axe ${label.padEnd(7)} ${r.path.padEnd(17)} serious/critical: ${bad.length}  minor: ${minor.map((v) => v.id).join(',') || 0}  overflow: ${overflow}px`)
    await page.screenshot({ path: path.join(SHOTS, `${label}${r.path.replace(/\//g, '_') || '_home'}.png`), fullPage: true })
    await page.close()
  }
}

// Lighthouse mobile on the routes that carry the funnel
const port = Number(new URL(browser.wsEndpoint()).port)
for (const p of ['/', '/privatedining/', '/book/']) {
  const { lhr } = await lighthouse(`http://localhost:${PORT}${p}`, { port, output: 'json', logLevel: 'error', formFactor: 'mobile', screenEmulation: { mobile: true, width: 412, height: 823, deviceScaleFactor: 1.75, disabled: false } })
  const s = Object.fromEntries(Object.entries(lhr.categories).map(([k, v]) => [k, Math.round(v.score * 100)]))
  const seoFails = lhr.categories.seo.auditRefs.filter((a) => a.weight > 0 && lhr.audits[a.id].score !== 1).map((a) => a.id)
  const seoExplained = seoFails.every((id) => id === 'is-crawlable')
  const m = (id) => lhr.audits[id].displayValue
  rows.push(`lighthouse ${p.padEnd(16)} perf ${s.performance}  a11y ${s.accessibility}  best ${s['best-practices']}  seo ${s.seo}${seoFails.length ? ` (failing: ${seoFails.join(',')})` : ''}  LCP ${m('largest-contentful-paint')}  CLS ${m('cumulative-layout-shift')}  TBT ${m('total-blocking-time')}`)
  if (s.performance < 90) failures.push(`lighthouse ${p}: performance ${s.performance} < 90`)
  if (s.accessibility < 95) failures.push(`lighthouse ${p}: accessibility ${s.accessibility} < 95`)
  if (s.seo < 100 && !seoExplained) failures.push(`lighthouse ${p}: SEO ${s.seo}, failing ${seoFails.join(',')}`)
}

await browser.close()
server.close()
for (const r of rows) console.log(r)
if (failures.length) {
  console.error(`\n✗ audit: ${failures.length} failure(s)`)
  for (const f of failures) console.error('  - ' + f)
  process.exit(1)
}
console.log('\n✓ audit passed (screenshots in ' + SHOTS + ')')
