// Runtime evidence for intentional resistance at one section boundary.
// Input is synthetic CDP, never a claim of real trackpad or human acceptance.
// Run against a completed current build; DEPTH_ORIGIN can reuse an owned preview.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import puppeteer from 'puppeteer-core'
import { createHash } from 'node:crypto'
import { serve } from './serve.mjs'

const OUT = path.resolve(process.env.DEPTH_OUTPUT || 'output/depth-resistance')
const ORIGIN = process.env.DEPTH_ORIGIN || 'http://localhost:4358'
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const SITE_DIR = path.resolve(process.env.DEPTH_SITE_DIR || 'dist')
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const checks = [], browserErrors = []
const check = (name, pass, detail = {}) => checks.push({ name, pass: !!pass, detail })
const save = (name, value) => fs.writeFileSync(path.join(OUT, name), typeof value === 'string' ? value : JSON.stringify(value, null, 2))
fs.mkdirSync(OUT, { recursive: true })
let browser, server

const state = (page) => page.evaluate(() => {
  const geometry = (selector) => {
    const e = document.querySelector(selector)
    if (!e) return null
    const r = e.getBoundingClientRect(), c = getComputedStyle(e)
    const m = c.transform === 'none' ? null : new DOMMatrixReadOnly(c.transform)
    return {
      top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height,
      layoutWidth: e.offsetWidth, layoutHeight: e.offsetHeight, minHeight: c.minHeight,
      position: c.position, perspective: c.perspective, transform: c.transform,
      scaleX: m ? Math.hypot(m.m11, m.m12, m.m13) : 1,
      scaleY: m ? Math.hypot(m.m21, m.m22, m.m23) : 1,
    }
  }
  return {
    ...window.__depthStudy, scrollY, width: innerWidth, height: innerHeight,
    root: geometry('[data-depth-study]'), hero: geometry('[data-home-hero]'), handoff: geometry('[data-home-handoff]'),
    heroFrame: geometry('[data-depth-hero]'), handoffFrame: geometry('[data-depth-handoff]'),
    headerRect: geometry('header'), gatherHeading: geometry('#home-gather-heading'),
    documentHeight: document.documentElement.scrollHeight,
    overflow: document.documentElement.scrollWidth > innerWidth,
  }
})
async function open({ flag = 'on', width = 1440, height = 1000, reduced = false, js = true } = {}) {
  const page = await browser.newPage()
  page.on('pageerror', (error) => browserErrors.push(error.message))
  await page.setViewport({ width, height, deviceScaleFactor: 1, isMobile: width <= 620, hasTouch: width <= 620 })
  if (!js) await page.setJavaScriptEnabled(false)
  if (reduced) await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }])
  await page.goto(`${ORIGIN}/?depth=${flag}`, { waitUntil: 'networkidle0' })
  await page.evaluate(() => document.fonts.ready)
  if (js && flag === 'on') await page.waitForFunction(() => !!window.__depthStudy, { timeout: 5000 })
  await pause(200)
  return page
}
async function startSampling(page) {
  await page.evaluate(() => {
    const result = { rows: [], inputs: [], marks: [], stop: false }
    window.__resistanceEvidence = result
    const record = (event) => {
      const item = { t: performance.now(), type: event.type, deltaY: event.deltaY ?? null, deltaMode: event.deltaMode ?? null, ctrlKey: event.ctrlKey, key: event.key ?? null, trusted: event.isTrusted, prevented: false }
      result.inputs.push(item)
      setTimeout(() => { item.prevented = event.defaultPrevented }, 0)
    }
    window.addEventListener('wheel', record, { passive: true, capture: true })
    window.addEventListener('keydown', record, { passive: true, capture: true })
    let previous = 0
    const sample = (t) => {
      if (result.stop) {
        window.removeEventListener('wheel', record, { capture: true })
        window.removeEventListener('keydown', record, { capture: true })
        return
      }
      result.rows.push({ t, dt: previous ? t - previous : null, scrollY, ...window.__depthStudy })
      previous = t
      requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
  })
}
const mark = (page, label) => page.evaluate((text) => window.__resistanceEvidence.marks.push({ label: text, t: performance.now() }), label)
async function finishSampling(page, name) {
  const data = await page.evaluate(() => { window.__resistanceEvidence.stop = true; return window.__resistanceEvidence })
  save(`${name}.json`, data)
  const keys = [...new Set(data.rows.flatMap((r) => Object.keys(r)))].filter((key) => data.rows.every((r) => typeof r[key] !== 'object'))
  save(`${name}.csv`, [keys.join(','), ...data.rows.map((r) => keys.map((key) => r[key] ?? '').join(','))].join('\n'))
  return data
}
async function pulse(page, deltaY, count = 1, gap = 40) {
  await page.mouse.move(1050, 520)
  for (let i = 0; i < count; i++) {
    await page.mouse.wheel({ deltaY })
    await pause(gap)
  }
}
const screenshot = (page, name) => page.screenshot({ path: path.join(OUT, name) })
const visible = (r, height, header = 0) => !!r && r.top >= header - 2 && r.bottom <= height + 2 && r.left >= -1
function frameMetrics(data) {
  const frames = data.rows.map((r) => r.dt).filter((x) => x !== null)
  const ordered = frames.slice().sort((a, b) => a - b)
  return { samples: frames.length, medianFrameMs: ordered[Math.floor(ordered.length / 2)], p95FrameMs: ordered[Math.floor(ordered.length * .95)], maxFrameMs: Math.max(...frames), framesOver50ms: frames.filter((x) => x > 50).length }
}

const buildSignature = () => Object.fromEntries(['index.html', '.vite/manifest.json'].map((file) => { const target = path.join(SITE_DIR, file); return [target, fs.existsSync(target) ? createHash('sha256').update(fs.readFileSync(target)).digest('hex') : null] }))
const layoutMatches = (a, b) => ['root', 'hero', 'handoff', 'heroFrame', 'handoffFrame'].every((key) => a[key].layoutHeight === b[key].layoutHeight && a[key].layoutWidth === b[key].layoutWidth) && a.documentHeight === b.documentHeight
const fullSize = (s) => ['heroFrame', 'handoffFrame'].every((key) => s[key].layoutWidth === s.width && Math.abs(s[key].scaleX - 1) < .0001 && Math.abs(s[key].scaleY - 1) < .0001 && s[key].perspective === 'none' && s[key].minHeight === '0px' && s[key].position !== 'sticky')
async function align(page, edge) {
  const s = await state(page)
  await page.evaluate((y) => scrollTo(0, y), s[edge])
  await pause(120)
  return state(page)
}
async function settled(page) {
  await page.waitForFunction(() => !window.__depthStudy.isAnimating && window.__depthStudy.phase !== 'resisting', { timeout: 5000 })
  return state(page)
}
function graph(data, start, end) {
  const rows = data.rows, t0 = rows[0].t, duration = rows.at(-1).t - t0
  const x = (t) => 70 + (t - t0) / duration * 1080
  const y = (p) => 60 + (1 - p) * 290
  const line = (key, color, convert = (v) => v) => `<polyline fill="none" stroke="${color}" stroke-width="2.5" points="${rows.map((r) => `${x(r.t).toFixed(2)},${y(convert(r[key] ?? 0)).toFixed(2)}`).join(' ')}"/>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="455"><rect width="1200" height="455" fill="#fffdf8"/><g font-family="sans-serif" fill="#292723"><text x="70" y="25" font-size="17">Synthetic wheel resistance: pressure, committed progress and actual native scroll</text>${[0,.5,1].map((p) => `<path d="M70 ${y(p)}H1150" stroke="#d8d3c9"/><text x="25" y="${y(p)+5}">${p}</text>`).join('')}${line('pressure','#a33e38',(v)=>Math.abs(v)/160)}${line('progress','#275d6b')}${line('scrollY','#827041',(v)=>Math.max(0,Math.min(1,(v-start)/(end-start))))}${data.marks.map((m,i)=>`<path d="M${x(m.t)} 60V350" stroke="#888" stroke-dasharray="3 4"/><text x="${x(m.t)+3}" y="${380+(i%3)*18}" font-size="10">${m.label}</text>`).join('')}<text x="70" y="440" font-size="12">Red: pressure /160px; blue: animated progress; ochre: actual scroll / boundary travel. ${(duration/1000).toFixed(2)} seconds. CDP input, not physical hardware.</text></g></svg>`
}
function chromeMetrics(file, url) {
  const events = JSON.parse(fs.readFileSync(file, 'utf8')).traceEvents
  const pid = events.find((e) => e.name === 'TracingStartedInBrowser')?.args?.data?.frames?.find((f) => f.url === url)?.processId
  const tid = events.find((e) => e.name === 'thread_name' && e.pid === pid && e.args?.name === 'CrRendererMain')?.tid
  const tasks = events.filter((e) => e.ph === 'X' && e.pid === pid && e.tid === tid && e.name === 'RunTask').map((e) => e.dur / 1000)
  return { rendererProcess: pid, mainThread: tid, mainThreadTaskCount: tasks.length, longestMainThreadTaskMs: tasks.length ? Math.max(...tasks) : null, mainThreadTasksOver50ms: tasks.filter((t) => t > 50).length }
}

try {
  if (!process.env.DEPTH_ORIGIN) server = await serve(4358)
  const buildBefore = buildSignature()
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true })
  const baselinePage = await open({ flag: 'off' })
  const baseline = await state(baselinePage)
  save('baseline-geometry.json', baseline)
  await screenshot(baselinePage, 'baseline.png')
  await baselinePage.close()

  // Real browser event path: below threshold -> release -> one commitment.
  {
    const page = await open()
    const initial = await state(page)
    check('Resistance is active on the current homepage', initial.enabled && initial.reason === 'resistance', initial)
    check('On/off natural section, wrapper and document heights match', layoutMatches(initial, baseline), { on: initial, off: baseline })
    check('Initial planes have full width, unit scale, no perspective, section minimum heights or sticky positioning', fullSize(initial), initial)
    await align(page, 'start')
    await screenshot(page, 'boundary-start.png')
    const recorder = await page.screencast({ path: path.join(OUT, 'resistance.webm'), ffmpegPath: '/opt/homebrew/bin/ffmpeg' })
    await startSampling(page)
    await mark(page, 'small input')
    await pulse(page, 50)
    const held = await state(page)
    check('50px subthreshold wheel input holds native scroll at the boundary', held.phase === 'resisting' && held.pressure === 50 && held.commits === 0 && Math.abs(held.scrollY - held.start) <= 1, held)
    check('Held-pressure transforms preserve unit scale and natural layout', fullSize(held) && layoutMatches(held, baseline), held)
    await screenshot(page, 'pressure-held.png')
    await mark(page, 'release below threshold')
    await pause(320)
    const released = await state(page)
    check('Quiet release cancels subthreshold pressure without committing', released.phase === 'idle' && released.pressure === 0 && released.commits === 0 && Math.abs(released.scrollY - released.start) <= 1, released)
    await mark(page, 'accumulate 100 + 100')
    await pulse(page, 100, 2, 35)
    await pause(80)
    const moving = await state(page)
    await screenshot(page, 'transition-moving.png')
    check('Crossing 160px accumulation commits exactly once and moves the planes', moving.commits === 1 && moving.phase === 'transitioning' && moving.progress > 0 && moving.progress < 1 && moving.scrollY > moving.start, moving)
    check('Moving planes retain natural layout, unit scale and no perspective', fullSize(moving) && layoutMatches(moving, baseline), moving)
    await mark(page, 'same-direction tail')
    await pulse(page, 35, 5, 20)
    const done = await settled(page)
    await mark(page, 'arrived')
    await screenshot(page, 'gathering-arrived.png')
    check('Residual burst reaches one committed destination without a second commit', done.commits === 1 && done.progress === 1 && Math.abs(done.scrollY - done.end) <= 1, done)
    check('Gathering heading is readable after commitment', visible(done.gatherHeading, done.height, done.headerRect.bottom), done)
    await pause(550)
    const beforeEscape = await state(page)
    await pulse(page, 220)
    const afterEscape = await state(page)
    check('Native forward scrolling resumes after the finite residual window', afterEscape.scrollY > beforeEscape.scrollY + 150 && afterEscape.commits === 1, { before: beforeEscape, after: afterEscape })
    const data = await finishSampling(page, 'resistance-trace')
    save('resistance-trace.svg', graph(data, initial.start, initial.end))
    await recorder.stop()
    execFileSync('/opt/homebrew/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(OUT, 'resistance.webm'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(OUT, 'resistance.mp4')])
    check('Resisted wheel events are canceled through the actual browser event path', data.inputs.filter((e) => e.type === 'wheel').slice(0, 3).every((e) => e.prevented), data.inputs)
    await page.close()
  }

  // Opposing input first cancels pressure; once moving it can retarget.
  {
    const page = await open()
    await align(page, 'start')
    await pulse(page, 80)
    const armed = await state(page)
    await pulse(page, -120)
    const canceled = await state(page)
    check('Opposing input cancels uncommitted pressure and permits native retreat', armed.pressure === 80 && canceled.phase === 'idle' && canceled.pressure === 0 && canceled.commits === 0 && canceled.scrollY < canceled.start, { armed, canceled })
    await align(page, 'start')
    await startSampling(page)
    await mark(page, 'forward commit')
    await pulse(page, 200)
    await pause(110)
    const beforeReverse = await state(page)
    await mark(page, 'opposite 40px')
    await pulse(page, -40)
    const reversing = await state(page)
    const returned = await settled(page)
    check('Opposite input during transition retargets toward the hero', beforeReverse.isAnimating && reversing.reversals === 1 && reversing.target === 0 && returned.progress === 0 && Math.abs(returned.scrollY - returned.start) <= 1, { beforeReverse, reversing, returned })
    await screenshot(page, 'reversed-to-hero.png')
    await finishSampling(page, 'reversal-trace')
    await page.close()
  }

  // Bypass checks use trusted wheel events. The nested fixture is diagnostic,
  // because this page does not contain a vertical nested scroller at the gate.
  {
    const page = await open()
    await align(page, 'start')
    await startSampling(page)
    await page.evaluate(() => {
      const box = document.createElement('div')
      box.id = 'depth-nested-scroll-fixture'
      box.style.cssText = 'position:fixed;left:900px;top:350px;width:300px;height:250px;overflow:auto;z-index:9999;background:white'
      const child = document.createElement('div'); child.style.height = '1200px'; child.textContent = 'Diagnostic nested scroll fixture'
      box.append(child); document.body.append(box)
    })
    await pulse(page, 220)
    const nested = await state(page)
    const nestedTop = await page.$eval('#depth-nested-scroll-fixture', (e) => e.scrollTop)
    const nestedData = await finishSampling(page, 'nested-bypass-trace')
    check('Nested vertical scroller consumes wheel input without arming the page gate', nestedTop > 150 && nested.commits === 0 && nested.pressure === 0 && Math.abs(nested.scrollY - nested.start) <= 1 && nestedData.inputs.every((e) => !e.prevented), { nestedTop, nested, inputs: nestedData.inputs })
    await page.evaluate(() => document.querySelector('#depth-nested-scroll-fixture').remove())
    await startSampling(page)
    await page.keyboard.down('Control')
    await pulse(page, 200)
    await page.keyboard.up('Control')
    const ctrl = await state(page)
    const ctrlData = await finishSampling(page, 'ctrl-bypass-trace')
    check('Ctrl-wheel bypasses the resistance handler', ctrl.commits === 0 && ctrl.pressure === 0 && ctrlData.inputs.filter((e) => e.type === 'wheel').every((e) => e.ctrlKey && !e.prevented), { ctrl, inputs: ctrlData.inputs })
    await page.close()
  }

  // Navigation stays native, including interruption of a transition by keys.
  {
    const page = await open()
    await align(page, 'start')
    await pulse(page, 200)
    await pause(90)
    await page.keyboard.press('PageDown')
    await pause(550)
    const interrupted = await state(page)
    check('PageDown can interrupt the controller and continue native navigation', !interrupted.isAnimating && interrupted.phase === 'idle', interrupted)
    await page.goto(`${ORIGIN}/?depth=on`, { waitUntil: 'networkidle0' })
    await page.click('.home-experience-link')
    await pause(350)
    const anchor = await state(page)
    check('Gathering anchor bypasses resistance and lands on readable content', new URL(page.url()).hash === '#ways' && visible(anchor.gatherHeading, anchor.height, anchor.headerRect.bottom) && !anchor.isAnimating, anchor)
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.click('[data-service-inquiry][data-format="dinner"]')])
    check('Gathering link reaches dinner booking', new URL(page.url()).pathname.endsWith('/book/') && new URL(page.url()).searchParams.get('type') === 'dinner', { url: page.url() })
    await page.close()
    const heroPage = await open()
    const seen = []
    for (let i = 0; i < 45 && seen.length < 4; i++) {
      await heroPage.keyboard.press('Tab')
      await pause(60)
      const focused = await heroPage.evaluate(() => {
        const e = document.activeElement
        if (!e.matches('[data-hero-cta],[data-service-inquiry]')) return null
        const r = e.getBoundingClientRect(), header = document.querySelector('header').getBoundingClientRect()
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
        return { text: e.textContent.trim(), visible: r.top >= header.bottom - 2 && r.bottom <= innerHeight + 2 && !!hit && e.contains(hit) }
      })
      if (focused) seen.push(focused)
    }
    check('Tab reaches all four booking entry links in visible space', seen.length === 4 && seen.every((e) => e.visible), seen)
    await heroPage.goto(`${ORIGIN}/?depth=on`, { waitUntil: 'networkidle0' })
    await Promise.all([heroPage.waitForNavigation({ waitUntil: 'networkidle0' }), heroPage.click('[data-hero-cta]')])
    check('Hero link reaches unselected booking', new URL(heroPage.url()).pathname.endsWith('/book/') && !new URL(heroPage.url()).search, { url: heroPage.url() })
    await heroPage.close()
  }

  // Reduced motion, explicit escape, and no JavaScript retain ordinary flow.
  for (const [name, options] of [['reduced', { reduced: true }], ['off', { flag: 'off' }], ['no-js', { js: false }]]) {
    const page = await open(options)
    const s = await state(page)
    check(`${name}: ordinary natural flow and working hrefs survive`, !s.enabled && s.hero.height > 0 && s.handoff.top >= s.hero.bottom - 2 && !s.overflow, s)
    const links = await page.$$eval('[data-hero-cta],[data-service-inquiry]', (items) => items.map((e) => e.getAttribute('href')))
    check(`${name}: all four booking hrefs remain`, links.length === 4 && links.every((href) => /\/book\//.test(href)), links)
    await screenshot(page, `${name}-fallback.png`)
    await page.close()
  }

  // Mobile device emulation exercises actual touch listeners through CDP.
  {
    const off = await open({ width: 390, height: 844, flag: 'off' })
    const mobileBaseline = await state(off)
    await off.close()
    const page = await open({ width: 390, height: 844 })
    const initial = await align(page, 'start')
    check('Mobile touch mode preserves baseline layout dimensions', initial.enabled && layoutMatches(initial, mobileBaseline) && fullSize(initial), { on: initial, off: mobileBaseline })
    const cdp = await page.createCDPSession()
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 300, y: 550 }] })
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 300, y: 520 }] })
    await pause(60)
    const held = await state(page)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    check('30px mobile touch drag meets the 90px gate without committing', held.phase === 'resisting' && held.threshold === 90 && held.commits === 0 && Math.abs(held.scrollY - held.start) <= 1, held)
    await pause(320)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 300, y: 600 }] })
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 300, y: 480 }] })
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    const arrived = await settled(page)
    check('120px mobile touch drag commits to gathering', arrived.commits === 1 && arrived.progress === 1 && Math.abs(arrived.scrollY - arrived.end) <= 1, arrived)
    await screenshot(page, 'mobile-gathering.png')
    await cdp.detach()
    await page.close()

    const crossingPage = await open({ width: 390, height: 844 })
    const crossingInitial = await state(crossingPage)
    await crossingPage.evaluate((y) => scrollTo(0, y), Math.max(0, crossingInitial.start - 100))
    await pause(120)
    await crossingPage.evaluate(() => {
      window.__crossingTouchEvents = []
      addEventListener('touchmove', (event) => {
        const row = { y: scrollY, cancelable: event.cancelable, prevented: false }
        window.__crossingTouchEvents.push(row)
        setTimeout(() => { row.prevented = event.defaultPrevented }, 0)
      }, { passive: true, capture: true })
    })
    const crossingCdp = await crossingPage.createCDPSession()
    const crossingStates = []
    await crossingCdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 300, y: 650 }] })
    for (const y of [600, 550, 500, 470]) {
      await crossingCdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 300, y }] })
      await pause(50)
      crossingStates.push(await state(crossingPage))
    }
    const crossingHeld = await state(crossingPage)
    await screenshot(crossingPage, 'mobile-crossing-held.png')
    await crossingCdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    const crossingEvents = await crossingPage.evaluate(() => window.__crossingTouchEvents)
    save('cross-touch-probe.json', { start: crossingInitial.start, end: crossingInitial.end, from: Math.max(0, crossingInitial.start - 100), states: crossingStates, events: crossingEvents, held: crossingHeld })
    check('A continuous touch swipe beginning before the boundary still meets resistance', crossingHeld.phase === 'resisting' && crossingHeld.pressure > 0 && crossingHeld.pressure < 90 && crossingHeld.commits === 0 && Math.abs(crossingHeld.scrollY - crossingHeld.start) <= 1, { states: crossingStates, events: crossingEvents })
    await pause(320)
    const crossingRelease = await state(crossingPage)
    check('Releasing a continuous crossing swipe below threshold leaves the boundary uncommitted', crossingRelease.phase === 'idle' && crossingRelease.pressure === 0 && crossingRelease.commits === 0 && Math.abs(crossingRelease.scrollY - crossingRelease.start) <= 1, crossingRelease)
    await crossingPage.evaluate((y) => scrollTo(0, y), crossingInitial.end + 100)
    await pause(120)
    const reverseTargetInsidePair = await crossingPage.evaluate(() => document.querySelector('[data-depth-study]').contains(document.elementFromPoint(300, 550)))
    const reverseStates = []
    await crossingCdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 300, y: 550 }] })
    for (const y of [600, 650, 700, 730]) {
      await crossingCdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 300, y }] })
      await pause(50)
      reverseStates.push(await state(crossingPage))
    }
    const reverseHeld = await state(crossingPage)
    await crossingCdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    save('reverse-cross-touch-probe.json', { targetInsidePair: reverseTargetInsidePair, start: crossingInitial.start, end: crossingInitial.end, from: crossingInitial.end + 100, states: reverseStates, held: reverseHeld })
    check('A reverse touch swipe beginning after the pair still meets the same boundary', !reverseTargetInsidePair && reverseHeld.phase === 'resisting' && reverseHeld.pressure < 0 && reverseHeld.pressure > -90 && reverseHeld.commits === 0 && Math.abs(reverseHeld.scrollY - reverseHeld.end) <= 1, { targetInsidePair: reverseTargetInsidePair, states: reverseStates })
    await pause(320)
    const reverseRelease = await state(crossingPage)
    check('Quiet release cancels reverse crossing pressure without committing', reverseRelease.phase === 'idle' && reverseRelease.pressure === 0 && reverseRelease.commits === 0 && Math.abs(reverseRelease.scrollY - reverseRelease.end) <= 1, reverseRelease)
    await crossingCdp.detach()
    await crossingPage.close()
  }

  // One focused performance recording, separate from video capture.
  {
    const page = await open()
    await align(page, 'start')
    await startSampling(page)
    await page.tracing.start({ path: path.join(OUT, 'performance.json'), screenshots: false, categories: ['devtools.timeline', 'v8.execute', 'blink.user_timing', 'toplevel', 'disabled-by-default-devtools.timeline'] })
    await pulse(page, 200)
    await settled(page)
    await pause(500)
    await pulse(page, -200)
    await settled(page)
    const data = await finishSampling(page, 'performance-samples')
    await page.tracing.stop()
    save('performance-summary.json', { method: 'One headless Chrome synthetic forward/reverse commitment at1440x1000, no video, no CPU throttling. rAF delivery does not prove display presentation or physical-input latency.', ...frameMetrics(data), ...chromeMetrics(path.join(OUT, 'performance.json'), `${ORIGIN}/?depth=on`) })
    await page.close()
  }

  const buildAfter = buildSignature()
  check('Current build stayed unchanged throughout evidence capture', JSON.stringify(buildBefore) === JSON.stringify(buildAfter), { before: buildBefore, after: buildAfter })
  check('No uncaught browser errors in these scenarios', browserErrors.length === 0, browserErrors)
  save('results.json', {
    createdAt: new Date().toISOString(), browser: await browser.version(), origin: ORIGIN, passed: checks.filter((c) => c.pass).length, total: checks.length,
    method: 'All wheel, touch, keyboard and click inputs are synthetic CDP in isolated headless Chrome. Nested scrolling uses a labeled diagnostic fixture. No real-device or unfamiliar-user study performed.',
    checks, browserErrors, buildBefore, buildAfter,
  })
  save('results.txt', checks.map((c) => `${c.pass ? 'PASS' : 'FAIL'} ${c.name}`).join('\n') + '\n\nPhysical wheel/trackpad/touch and unfamiliar-user acceptance remain unverified.\n')
  console.log(checks.map((c) => `${c.pass ? 'PASS' : 'FAIL'} ${c.name}`).join('\n'))
  console.log(`Evidence: ${OUT}`)
  if (checks.some((c) => !c.pass)) process.exitCode = 1
} catch (error) {
  save('harness-error.txt', error.stack || String(error))
  console.error(error)
  process.exitCode = 1
} finally {
  await browser?.close()
  await new Promise((resolve) => server ? server.close(resolve) : resolve())
}

