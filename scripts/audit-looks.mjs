// Audits the selected salon homepage: readable opening, working interaction states,
// mobile performance and reduced motion. The unselected hero studies are not shipped variants.
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import lighthouse from 'lighthouse'
import puppeteer from 'puppeteer-core'
import { serve } from './serve.mjs'

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const SHOTS = process.env.SHOTS_DIR || '.audit'
const BASELINE_KB = 81.26 // main bundle gzip before motion (measured 2026-11-22)
const ORIGIN = 'http://localhost:4330'
fs.mkdirSync(SHOTS, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const gz = (f) => zlib.gzipSync(fs.readFileSync(f)).length / 1024
const rows = []
const failures = []
const pass = (name, ok, detail) => {
  rows.push(`${ok ? '✓' : '✗'} ${name}${detail ? `  (${detail})` : ''}`)
  if (!ok) failures.push(name)
}

if (process.env.AUDIT_SKIP_BUILD !== '1') {
  execSync('npm run build:client && npm run build:ssr && npm run prerender', { env: { ...process.env, LOOK: 'c' }, stdio: 'ignore' })
}
const assets = fs.readdirSync('dist/assets')
const manifest = JSON.parse(fs.readFileSync('dist/.vite/manifest.json', 'utf8'))
const main = gz(path.join('dist', manifest['index.html'].file))
const featureName = assets.find((a) => /^motion-features-.*\.js$/.test(a))
const features = featureName ? gz(path.join('dist/assets', featureName)) : 0
const signed = (n) => (n >= 0 ? '+' : '−') + Math.abs(n).toFixed(1)
pass('JS critical path stays within the motion budget (+25 KB)', main - BASELINE_KB <= 25, `main ${main.toFixed(1)} KB; ${signed(main - BASELINE_KB)} KB vs baseline; async motion ${features.toFixed(1)} KB`)

const server = await serve(4330)
let browser
try {
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true })

  // Production has no prototype notice; the selected hero itself must fit the phone opening.
  {
    const page = await browser.newPage()
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
    await page.goto(`${ORIGIN}/`, { waitUntil: 'networkidle0' })
    await page.evaluate(() => {
      document.querySelector('section[aria-label="Prototype notice"]')?.remove()
      return document.fonts.ready
    })
    const box = await page.evaluate(() => {
      const hero = document.querySelector('[data-home-hero]')
      const h1 = hero?.querySelector('h1')
      const cta = hero?.querySelector('[data-hero-cta]')
      const rect = (e) => e ? { top: Math.round(e.getBoundingClientRect().top), bottom: Math.round(e.getBoundingClientRect().bottom) } : null
      return {
        h1: rect(h1), cta: rect(cta), h1Text: h1?.innerText.replace(/\s+/g, ' ').trim(),
        offer: hero?.textContent, overflow: document.documentElement.scrollWidth > innerWidth,
        look: document.documentElement.dataset.look,
      }
    })
    const inFold = (b) => b && b.top >= 0 && b.bottom <= 844
    pass('phone opening shows its complete headline and primary inquiry', inFold(box.h1) && inFold(box.cta), `H1 ${box.h1?.bottom}px, CTA ${box.cta?.bottom}px of 844`)
    pass('selected opening identifies private-chef service and Orlando', box.h1Text === 'Dinner at home. Be a guest.' && /private chef/i.test(box.offer) && /Orlando/.test(box.offer), box.h1Text)
    pass('selected salon look has no horizontal overflow', box.look === 'c' && !box.overflow, `look=${box.look}`)
    await page.screenshot({ path: path.join(SHOTS, 'selected-hero-phone-fold.png') })
    await page.close()
  }

  if (process.env.AUDIT_SKIP_PERF !== '1') {
    const port = Number(new URL(browser.wsEndpoint()).port)
    const { lhr } = await lighthouse(`${ORIGIN}/`, { port, output: 'json', logLevel: 'error', formFactor: 'mobile', screenEmulation: { mobile: true, width: 412, height: 823, deviceScaleFactor: 1.75, disabled: false } })
    const perf = Math.round(lhr.categories.performance.score * 100)
    const cls = lhr.audits['cumulative-layout-shift'].numericValue
    pass('Lighthouse mobile performance ≥90 and CLS ≤0.01', perf >= 90 && cls <= 0.01, `perf ${perf}, LCP ${lhr.audits['largest-contentful-paint'].displayValue}, CLS ${cls.toFixed(3)}`)
  }

  // Verify useful states on the actual inquiry control, rather than a retired service-row animation.
  {
    const page = await browser.newPage()
    await page.setViewport({ width: 1440, height: 900 })
    await page.goto(`${ORIGIN}/`, { waitUntil: 'networkidle0' })
    const selector = '[data-home-hero] [data-hero-cta]'
    const state = () => page.$eval(selector, (e) => {
      const s = getComputedStyle(e)
      return { bg: s.backgroundColor, color: s.color, border: s.borderColor, transform: s.transform }
    })
    const before = await state()
    await page.hover(selector)
    await sleep(300)
    const hover = await state()
    pass('primary inquiry has a visible hover state', JSON.stringify(before) !== JSON.stringify(hover), `${JSON.stringify(before)} → ${JSON.stringify(hover)}`)
    await page.mouse.move(0, 0)
    await page.keyboard.press('Tab') // Establish keyboard modality before checking :focus-visible.
    await page.focus(selector)
    const focus = await page.$eval(selector, (e) => ({ focused: document.activeElement === e, outline: getComputedStyle(e).outlineStyle, width: parseFloat(getComputedStyle(e).outlineWidth) }))
    pass('primary inquiry has a visible keyboard focus state', focus.focused && focus.outline !== 'none' && focus.width >= 2, `${focus.outline} ${focus.width}px`)
    await page.close()
  }

  {
    const page = await browser.newPage()
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }])
    await page.setViewport({ width: 1440, height: 900 })
    await page.goto(`${ORIGIN}/`, { waitUntil: 'networkidle0' })
    await page.hover('[data-home-hero] [data-hero-cta]')
    await sleep(200)
    const home = await page.evaluate(() => ({
      hidden: [...document.querySelectorAll('[data-home-hero] *,[data-home-handoff] *')].filter((e) => e.offsetParent !== null && !e.closest('[aria-hidden=true]') && getComputedStyle(e).opacity === '0').length,
      moving: document.getAnimations().filter((a) => a.effect?.getComputedTiming().duration > 50 && a.effect.getKeyframes().some((k) => ['transform', 'translate', 'scale', 'rotate', 'clipPath'].some((p) => p in k))).length,
    }))
    await page.goto(`${ORIGIN}/book/?type=dinner`, { waitUntil: 'networkidle0' })
    await page.waitForSelector('#f-date')
    await page.click('form button[type=submit]') // Invalid input exercises the error state, without sending a request.
    await sleep(30)
    const booking = await page.evaluate(() => ({
      moving: document.getAnimations().filter((a) => a.effect?.getComputedTiming().duration > 50 && a.effect.getKeyframes().some((k) => ['transform', 'translate', 'scale', 'rotate', 'clipPath'].some((p) => p in k))).length,
      transform: getComputedStyle(document.querySelector('[data-step]')).transform,
    }))
    pass('reduced motion keeps opening content visible and disables moving animations', home.hidden === 0 && home.moving === 0 && booking.moving === 0 && booking.transform === 'none', `hidden ${home.hidden}; home movement ${home.moving}; booking movement ${booking.moving}; step ${booking.transform}`)
    await page.close()
  }
} finally {
  if (browser) await browser.close()
  await new Promise((resolve) => server.close(resolve))
}

console.log(rows.join('\n'))
if (failures.length) {
  console.error(`\n✗ audit-looks: ${failures.length} failure(s)`)
  process.exit(1)
}
console.log('\n✓ selected-home audit passed')
