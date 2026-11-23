// Selected home hero: actual rendering and the existing booking flow, not a comprehension claim.
// The viewport checks remove prototype chrome to inspect the launch composition.
// HERO_SKIP_BUILD=1 checks the existing dist/ without rebuilding/restoring it.
// HERO_SKIP_PERF=1 omits the median-of-three Lighthouse audit for a focused run.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import lighthouse from 'lighthouse'
import puppeteer from 'puppeteer-core'
import { serve } from './serve.mjs'

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const SHOTS = process.env.SHOTS_DIR || '.audit'
const PORT = Number(process.env.HERO_PORT) || 4340
const ORIGIN = `http://localhost:${PORT}`
const HERO = '[data-home-hero]'
const HANDOFF = '[data-home-handoff]'
const skipBuild = process.env.HERO_SKIP_BUILD === '1'
const rows = []
const pass = (name, ok, detail = '') => rows.push(`${ok ? '✓' : '✗'} ${name}${detail ? `  (${detail})` : ''}`)
const build = (env) => {
  for (const task of ['build:client', 'build:ssr', 'prerender']) execFileSync('npm', ['run', task], { env, stdio: 'ignore' })
}
const ready = async (page, path = '/') => {
  await page.goto(`${ORIGIN}${path}`, { waitUntil: 'networkidle0' })
  await page.evaluate(() => document.fonts.ready)
}
const openHome = async (page) => {
  await ready(page)
  await page.evaluate(() => document.querySelector('section[aria-label="Prototype notice"]')?.remove())
  await page.waitForSelector(`${HERO} [data-hero-cta]`)
}
const visibleFonts = async (page) => {
  const cdp = await page.createCDPSession()
  await cdp.send('DOM.enable')
  await cdp.send('CSS.enable')
  const { root } = await cdp.send('DOM.getDocument', { depth: -1 })
  const got = []
  for (const selector of [`${HERO} h1`, `${HERO} [data-hero-cta]`]) {
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector })
    const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId })
    got.push({ selector, fonts })
  }
  await cdp.detach()
  return got
}

fs.mkdirSync(SHOTS, { recursive: true })
let browser, server, built = false
try {
  if (!skipBuild) {
    build({ ...process.env, LOOK: 'c' })
    built = true
  }
  server = await serve(PORT)
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true })

  for (const [width, height, mobile] of [[320, 740, true], [360, 740, true], [390, 664, true], [1280, 720, false], [1440, 900, false]]) {
    const page = await browser.newPage()
    await page.setViewport({ width, height, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 })
    await openHome(page)
    const state = await page.evaluate(({ heroSelector, handoffSelector }) => {
      const hero = document.querySelector(heroSelector)
      const handoff = document.querySelector(handoffSelector)
      const visible = (e) => e && e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().height > 0
      const rect = (e) => {
        if (!e) return null
        const { top, right, bottom, left, width, height } = e.getBoundingClientRect()
        return { top, right, bottom, left, width, height }
      }
      const heading = hero?.querySelector('h1')
      const cta = hero?.querySelector('[data-hero-cta]')
      const context = [...(hero?.querySelectorAll('p') ?? [])].find((e) => /private chef/i.test(e.textContent) && /Orlando/.test(e.textContent))
      const touchControls = [...(hero?.querySelectorAll('[data-hero-cta], a[href^="#"]') ?? []), ...(handoff?.querySelectorAll('[data-service-inquiry]') ?? [])]
        .filter(visible).map((e) => ({ label: e.textContent.trim(), ...rect(e) }))
      return {
        visibleHeadings: [...document.querySelectorAll('#main h1')].filter(visible).length,
        heading: rect(heading), headingText: heading?.innerText.replace(/\s+/g, ' ').trim(),
        context: rect(context), cta: rect(cta), ctaText: cta?.textContent.trim(),
        ctaFontSize: cta ? Number.parseFloat(getComputedStyle(cta).fontSize) : 0,
        overflow: document.documentElement.scrollWidth > innerWidth, touchControls,
        hasForm: !!hero?.querySelector('form'),
      }
    }, { heroSelector: HERO, handoffSelector: HANDOFF })
    const onScreen = (r) => r && r.top >= 0 && r.bottom <= height && r.left >= 0 && r.right <= width
    pass(`${width}x${height}: one readable home heading`, state.visibleHeadings === 1 && state.headingText === 'Dinner at home. Be a guest.' && onScreen(state.heading), state.headingText ?? 'missing')
    pass(`${width}x${height}: private chef, Orlando and main inquiry visible immediately`, onScreen(state.context) && onScreen(state.cta) && state.ctaText === 'Start planning', `CTA bottom ${Math.round(state.cta?.bottom ?? 0)} of ${height}`)
    pass(`${width}x${height}: no horizontal overflow`, !state.overflow)
    pass(`${width}x${height}: inquiry stays a direct link with shared 15px type`, !state.hasForm && state.ctaFontSize === 15)
    const small = state.touchControls.filter((c) => c.width < 44 || c.height < 44)
    pass(`${width}x${height}: inquiry and handoff targets ≥ 44x44`, state.touchControls.length >= 4 && small.length === 0, small.map((c) => `${c.label}: ${Math.round(c.width)}x${Math.round(c.height)}`).join(', '))
    if (width === 390 || width === 1440) {
      const rendered = await visibleFonts(page)
      for (const { selector, fonts } of rendered) {
        const heading = selector === `${HERO} h1`
        const family = heading ? 'EB Garamond' : 'Archivo'
        const expected = heading ? /EB\s*Garamond/i : /Archivo/i
        const correct = fonts.length > 0 && fonts.every((f) => f.isCustomFont && expected.test(f.familyName))
        pass(`${width}px: ${heading ? 'heading' : 'inquiry'} renders in the ${family} web font`, correct, fonts.map((f) => `${f.familyName}${f.isCustomFont ? '' : ' FALLBACK'}`).join(' + '))
      }
    }
    await page.screenshot({ path: `${SHOTS}/hero-${width}x${height}.png` })
    await page.close()
  }

  // The main action asks for no advance choices and enters the existing first step.
  {
    // A separate context keeps another route check's saved draft out of this entry-point check.
    const context = await browser.createBrowserContext()
    const page = await context.newPage()
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true })
    await openHome(page)
    const target = await page.$eval(`${HERO} [data-hero-cta]`, (e) => e.href)
    const url = new URL(target)
    pass('main inquiry links to booking without preselected answers', url.pathname.endsWith('/book/') && !url.search, target)
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.click(`${HERO} [data-hero-cta]`)])
    await page.waitForSelector('[data-step="0"]')
    const first = await page.evaluate(() => ({
      step: document.querySelector('[data-step]')?.dataset.step,
      choices: [...document.querySelectorAll('#f-kind [role=radio]')].map((e) => e.textContent.replace(/\s+/g, ' ').trim()),
      selected: document.querySelectorAll('#f-kind [role=radio][data-state=checked]').length,
    }))
    const serviceChoices = ['private dinner', 'cooking class', 'small event'].every((label) => first.choices.some((choice) => choice.toLowerCase().includes(label)))
    pass('main inquiry opens the available booking choices with no kind selected', first.step === '0' && first.choices.length >= 3 && serviceChoices && first.selected === 0, `step ${Number(first.step) + 1}, ${first.choices.length} choices, ${first.selected} selected`)
    await context.close()
  }

  // A service action carries only the answer already supplied by its label.
  for (const [format, summary] of [['dinner', 'Private dinner'], ['class', 'Cooking class'], ['event', 'Small event']]) {
    const context = await browser.createBrowserContext()
    const page = await context.newPage()
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true })
    await openHome(page)
    const selector = `${HANDOFF} [data-service-inquiry][data-format="${format}"]`
    const target = await page.$eval(selector, (e) => e.href)
    const url = new URL(target)
    pass(`${format} handoff links to its booking format`, url.pathname.endsWith('/book/') && url.searchParams.get('type') === format && [...url.searchParams.keys()].length === 1, target)
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.click(selector)])
    await page.waitForSelector('[data-step="1"]')
    await page.waitForFunction((expected) => document.querySelector('[data-summary]')?.textContent.trim().toLowerCase() === expected.toLowerCase(), {}, summary)
    await page.waitForSelector('[data-calendar]', { visible: true })
    await page.waitForFunction(() => {
      const calendar = document.querySelector('[data-calendar]')
      return calendar && calendar.getAttribute('aria-busy') !== 'true'
    })
    const state = await page.evaluate(() => {
      const calendar = document.querySelector('[data-calendar]')
      const guests = document.querySelector('#f-guests')
      return {
        step: document.querySelector('[data-step]')?.dataset.step,
        summary: document.querySelector('[data-summary]')?.textContent.trim(),
        calendarReady: !!calendar && calendar.getAttribute('aria-busy') !== 'true' && !!calendar.querySelector('[role=group][aria-label^="Open dates in "]'),
        selectedDates: calendar?.querySelectorAll('button[data-date][aria-pressed=true]').length,
        openDates: calendar?.querySelectorAll('button[data-date]').length,
        hasGuestInput: !!guests && guests.type === 'number',
        guests: guests?.value,
        hasStartTime: !!document.querySelector('#f-time'),
      }
    })
    pass(`${format} handoff uses booking step 2 without inventing a date or guest count`, state.step === '1' && state.summary?.toLowerCase() === summary.toLowerCase() && state.calendarReady && state.selectedDates === 0 && !state.hasStartTime && state.hasGuestInput && state.guests === '', `${state.summary}; ${state.openDates} open dates, ${state.selectedDates} selected`)
    await context.close()
  }

  // The hero and real hrefs survive script failure; first render must not hide them.
  {
    const page = await browser.newPage()
    await page.setJavaScriptEnabled(false)
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true })
    await ready(page)
    const state = await page.$eval(HERO, (hero) => {
      const h1 = hero.querySelector('h1'), cta = hero.querySelector('[data-hero-cta]')
      return { visible: !!h1 && h1.getBoundingClientRect().height > 0 && getComputedStyle(h1).opacity === '1', target: cta?.getAttribute('href') }
    })
    pass('hero is visible and links to booking without JavaScript', state.visible && /\/book\/$/.test(state.target ?? ''))
    await page.close()
  }
  {
    const page = await browser.newPage()
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }])
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true })
    await openHome(page)
    const moving = await page.$eval(HERO, (hero) => hero.getAnimations({ subtree: true }).filter((a) => a.playState === 'running' && Number(a.effect?.getComputedTiming().duration) > 50).length)
    pass('reduced motion: no sustained hero animation', moving === 0, `${moving} running animations`)
    await page.close()
  }

  if (process.env.HERO_SKIP_PERF !== '1') {
    const port = Number(new URL(browser.wsEndpoint()).port)
    const runs = []
    for (let i = 0; i < 3; i++) {
      const { lhr } = await lighthouse(`${ORIGIN}/`, { port, output: 'json', logLevel: 'error', formFactor: 'mobile', screenEmulation: { mobile: true, width: 412, height: 823, deviceScaleFactor: 1.75, disabled: false } })
      runs.push({ perf: Math.round(lhr.categories.performance.score * 100), lcp: lhr.audits['largest-contentful-paint'].numericValue, cls: lhr.audits['cumulative-layout-shift'].numericValue })
    }
    const med = (key) => runs.map((r) => r[key]).sort((a, b) => a - b)[1]
    const perf = med('perf'), lcp = med('lcp'), cls = med('cls')
    fs.writeFileSync(`${SHOTS}/hero-performance.json`, JSON.stringify({ runs, median: { perf, lcp, cls } }, null, 2))
    pass('Lighthouse mobile median: perf ≥ 90, LCP ≤ 2.5 s, CLS ≤ 0.01', perf >= 90 && lcp <= 2500 && cls <= 0.01, `perf ${perf}, LCP ${(lcp / 1000).toFixed(2)} s, CLS ${cls.toFixed(3)}`)
  } else rows.push('↷ Lighthouse skipped by HERO_SKIP_PERF=1; no performance result claimed')
} catch (error) {
  pass('hero check completes', false, error.stack ?? String(error))
} finally {
  if (browser) await browser.close()
  if (server) await new Promise((resolve) => server.close(resolve))
  if (built) {
    try { build(process.env) }
    catch (error) { pass('restore the configured prototype build', false, error.message) }
  }
}

console.log(rows.join('\n'))
const failures = rows.filter((r) => r.startsWith('✗')).length
if (failures) {
  console.error(`\n✗ hero-check: ${failures} failure(s)`)
  process.exitCode = 1
} else console.log('\n✓ hero-check passed')
