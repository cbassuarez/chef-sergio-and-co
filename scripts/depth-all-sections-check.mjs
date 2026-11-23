// Browser runtime evidence for every homepage depth boundary.
// All wheel/touch/key input is synthetic CDP; physical/user acceptance is separate.
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import puppeteer from 'puppeteer-core'

const OUT = path.resolve(process.env.SHOTS_DIR || process.env.DEPTH_OUTPUT || 'output/depth-all-sections')
const PORT = Number(process.env.DEPTH_PORT) || 4358
const ORIGIN = process.env.DEPTH_ORIGIN || `http://localhost:${PORT}`
const SITE_DIR = path.resolve(process.env.DIST_DIR || process.env.DEPTH_SITE_DIR || 'dist')
// Hash and serve the same copied build, including when the legacy depth-specific
// directory option is used. serve.mjs resolves its root when the module loads.
process.env.DIST_DIR = SITE_DIR
const { serve } = await import('./serve.mjs')
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const checks = [], browserErrors = []
const check = (name, pass, detail = {}) => {
  const row = { name, pass: !!pass, detail }; checks.push(row)
  console.log(`${row.pass ? 'PASS' : 'FAIL'} ${name}`)
}
const save = (name, value) => fs.writeFileSync(path.join(OUT, name), typeof value === 'string' ? value : JSON.stringify(value, null, 2))
const signature = () => Object.fromEntries(['index.html', '.vite/manifest.json'].map((name) => {
  const file = path.join(SITE_DIR, name)
  return [file, fs.existsSync(file) ? createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null]
}))
fs.mkdirSync(OUT, { recursive: true })
let browser, server

async function open({ flag = 'on', width = 1440, height = 1000, reduced = false, js = true } = {}) {
  const page = await browser.newPage()
  page.on('pageerror', (error) => browserErrors.push(error.message))
  await page.setViewport({ width, height, deviceScaleFactor: 1, isMobile: width <= 620, hasTouch: width <= 620 })
  if (!js) await page.setJavaScriptEnabled(false)
  if (reduced) await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }])
  await page.goto(`${ORIGIN}/?depth=${flag}`, { waitUntil: 'networkidle0' })
  await page.evaluate(() => document.fonts.ready)
  if (js && flag === 'on') await page.waitForFunction(() => !!window.__depthStudy, { timeout: 5000 })
  await pause(250)
  return page
}
async function wheel(page, deltaY, count = 1, gap = 35) {
  await page.mouse.move(1380, 550)
  for (let i = 0; i < count; i++) {
    await page.mouse.wheel({ deltaY })
    await pause(gap)
  }
}
const shot = (page, name) => page.screenshot({ path: path.join(OUT, name) })
const closeEnough = (a, b, tolerance = 2) => Math.abs(a - b) <= tolerance

async function startSampling(page) {
  await page.evaluate(() => {
    const data = { rows: [], inputs: [], marks: [], stop: false }
    window.__allDepthEvidence = data
    const record = (event) => {
      const row = { t: performance.now(), type: event.type, deltaY: event.deltaY ?? null, deltaX: event.deltaX ?? null, key: event.key ?? null, cancelable: event.cancelable, prevented: false, trusted: event.isTrusted }
      data.inputs.push(row)
      setTimeout(() => { row.prevented = event.defaultPrevented }, 0)
    }
    window.addEventListener('wheel', record, { passive: true, capture: true })
    window.addEventListener('touchmove', record, { passive: true, capture: true })
    let previous = 0
    const frame = (t) => {
      if (data.stop) {
        window.removeEventListener('wheel', record, { capture: true })
        window.removeEventListener('touchmove', record, { capture: true })
        return
      }
      const d = window.__depthStudy || {}
      const row = { t, dt: previous ? t - previous : null, scrollY }
      for (const [key, value] of Object.entries(d)) if (typeof value !== 'object') row[key] = value
      data.rows.push(row); previous = t
      requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  })
}
const mark = (page, label) => page.evaluate((name) => window.__allDepthEvidence.marks.push({ t: performance.now(), label: name }), label)
async function finishSampling(page, name) {
  const data = await page.evaluate(() => { window.__allDepthEvidence.stop = true; return window.__allDepthEvidence })
  save(`${name}.json`, data)
  const keys = [...new Set(data.rows.flatMap((row) => Object.keys(row)))]
  save(`${name}.csv`, [keys.join(','), ...data.rows.map((row) => keys.map((key) => row[key] ?? '').join(','))].join('\n'))
  return data
}
function performanceMetrics(data, traceFile, url) {
  const frames = data.rows.map((r) => r.dt).filter((v) => v !== null).sort((a, b) => a - b)
  const events = JSON.parse(fs.readFileSync(traceFile, 'utf8')).traceEvents
  const pid = events.find((e) => e.name === 'TracingStartedInBrowser')?.args?.data?.frames?.find((f) => f.url === url)?.processId
  const tid = events.find((e) => e.name === 'thread_name' && e.pid === pid && e.args?.name === 'CrRendererMain')?.tid
  const tasks = events.filter((e) => e.ph === 'X' && e.pid === pid && e.tid === tid && e.name === 'RunTask').map((e) => e.dur / 1000)
  return { samples: frames.length, medianFrameMs: frames[Math.floor(frames.length / 2)], p95FrameMs: frames[Math.floor(frames.length * .95)], maxFrameMs: Math.max(...frames), framesOver50ms: frames.filter((f) => f > 50).length, longestMainThreadTaskMs: tasks.length ? Math.max(...tasks) : null, mainThreadTasksOver50ms: tasks.filter((t) => t > 50).length }
}

const state = (page) => page.evaluate(() => {
  const elements = [...document.querySelectorAll('[data-depth-study] > main > section, [data-depth-study] > footer')]
  const planes = elements.map((e, i) => {
    const c = getComputedStyle(e), r = e.getBoundingClientRect()
    const m = c.transform === 'none' ? null : new DOMMatrixReadOnly(c.transform)
    let top = 0; for (let n = e; n; n = n.offsetParent) top += n.offsetTop
    return { id: e.dataset.depthPlane || e.id || e.getAttribute('aria-labelledby') || `section-${i + 1}`, tag: e.tagName, className: e.className, label: e.querySelector('h1,h2')?.textContent.trim(), top, width: e.offsetWidth, height: e.offsetHeight, left: r.left, right: r.right, visibleTop: r.top, visibleBottom: r.bottom, minHeight: c.minHeight, position: c.position, perspective: c.perspective, transform: c.transform, pose: e.dataset.depthPose || null, scaleX: m ? Math.hypot(m.m11, m.m12, m.m13) : 1, scaleY: m ? Math.hypot(m.m21, m.m22, m.m23) : 1 }
  })
  const h = document.querySelector('header').getBoundingClientRect()
  return { ...window.__depthStudy, scrollY, width: innerWidth, height: innerHeight, documentHeight: document.documentElement.scrollHeight, maxScroll: document.documentElement.scrollHeight - innerHeight, domPlanes: planes, headerBottom: h.bottom, overflow: document.documentElement.scrollWidth > innerWidth, plating: { ...window.__platingTimeline, graphics: document.querySelector('[data-plating-timeline]')?.getAttribute('data-graphics') } }
})
const count = (s) => s.totalCommits ?? 0
const reverseCount = (s) => s.totalReversals ?? 0
const edge = (s, id) => s.boundaries.find((b) => b.id === id)
const geometryMatches = (a, b) => a.documentHeight === b.documentHeight && a.domPlanes.length === b.domPlanes.length && a.domPlanes.every((p, i) => p.id === b.domPlanes[i].id && p.width === b.domPlanes[i].width && p.height === b.domPlanes[i].height && closeEnough(p.left, b.domPlanes[i].left, .1))
const unitScale = (s) => s.domPlanes.every((p) => Math.abs(p.scaleX - 1) < .0001 && Math.abs(p.scaleY - 1) < .0001 && p.perspective === 'none')
async function warm(page) {
  const top = await page.evaluate(() => {
    const e = document.querySelector('[data-plating-timeline]')
    return e ? e.getBoundingClientRect().top + scrollY : 0
  })
  await page.evaluate((y) => scrollTo(0, y), top)
  try { await page.waitForFunction(() => window.__platingTimeline?.ready || document.querySelector('[data-plating-timeline]')?.getAttribute('data-graphics') === 'fallback', { timeout: 6000 }) } catch { /* report fallback state rather than fabricate graphics success */ }
  await pause(300)
  await page.evaluate(() => scrollTo(0, 0))
  await pause(250)
  return state(page)
}
async function align(page, id, endpoint) {
  await page.evaluate(() => { document.activeElement?.blur(); document.body.tabIndex = -1; document.body.focus({ preventScroll: true }) })
  await page.keyboard.press('Escape')
  const s = await state(page), b = edge(s, id)
  await page.evaluate((y) => scrollTo(0, y), b[endpoint])
  await pause(90)
  return state(page)
}
async function awaitSettled(page) {
  await page.waitForFunction(() => !window.__depthStudy.isAnimating && window.__depthStudy.phase !== 'resisting', { timeout: 5000 })
  return state(page)
}
async function touchSwipe(cdp, delta, x = 300, fromY = delta > 0 ? 700 : 220) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: fromY }] })
  for (let i = 1; i <= 3; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: fromY - delta * i / 3 }] })
    await pause(35)
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
}
async function slowTouch(cdp, delta) {
  const fromY = delta > 0 ? 650 : 200
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 300, y: fromY }] })
  await pause(400)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 300, y: fromY - delta }] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
}
function graph(data) {
  const t0 = data.rows[0].t, duration = data.rows.at(-1).t - t0
  const maxY = Math.max(1, ...data.rows.map((r) => r.scrollY))
  const x = (t) => 60 + (t - t0) / duration * 1100
  const y = (v) => 45 + (1 - v / maxY) * 300
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="430"><rect width="1200" height="430" fill="#fffdf8"/><g font-family="sans-serif" fill="#292723"><text x="60" y="25" font-size="17">Every boundary, synthetic wheel traversal: actual native scroll</text><polyline fill="none" stroke="#275d6b" stroke-width="2.5" points="${data.rows.map((r) => `${x(r.t).toFixed(2)},${y(r.scrollY).toFixed(2)}`).join(' ')}"/>${data.marks.map((m,i) => `<path d="M${x(m.t)} 45V345" stroke="#aaa" stroke-dasharray="3 4"/><text x="${x(m.t)+3}" y="${365+(i%3)*17}" font-size="9">${m.label}</text>`).join('')}<text x="60" y="420" font-size="12">${(duration/1000).toFixed(2)}s; maximum recorded scroll ${maxY}px. CDP input, not physical-device latency evidence.</text></g></svg>`
}

try {
  if (!process.env.DEPTH_ORIGIN) server = await serve(PORT)
  const buildBefore = signature()
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true })
  const offPage = await open({ flag: 'off' })
  const baseline = await warm(offPage)
  save('baseline-geometry.json', baseline)
  await shot(offPage, 'baseline.png')
  await offPage.close()
  const page = await open()
  const initial = await warm(page)
  save('initial-geometry.json', initial)
  const ids = initial.boundaries.map((b) => b.id)
  check('All homepage sections and footer form a gate sequence', initial.enabled && initial.domPlanes.length === 10 && ids.length === 9, initial)
  check('Depth preserves every original section width, height and document height', geometryMatches(initial, baseline), { on: initial, off: baseline })
  check('Existing narrow .wrap sections retain their baseline widths and alignment', initial.domPlanes.filter((p) => p.className.split(/\s+/).includes('wrap')).every((p) => { const b = baseline.domPlanes.find((x) => x.id === p.id); return p.width === b.width && closeEnough(p.left, b.left, .1) }), initial.domPlanes)
  check('Planes retain unit scale and no perspective', unitScale(initial), initial.domPlanes)

  // At each edge, independently exercise partial pressure and mid-motion
  // reversals in both directions through the real wheel listener.
  for (const id of ids) {
    for (const direction of [1, -1]) {
      const endpoint = direction === 1 ? 'start' : 'end'
      const before = await align(page, id, endpoint)
      const b = edge(before, id), beforeCount = count(before), beforeReverse = reverseCount(before)
      await wheel(page, direction * 50)
      const held = await state(page)
      check(`${id}: ${direction > 0 ? 'forward' : 'reverse'} subthreshold input holds the boundary`, held.boundaryId === id && held.phase === 'resisting' && closeEnough(held.scrollY, b[endpoint]) && count(held) === beforeCount && Math.abs(held.pressure) === 50, held)
      await pause(270)
      const released = await state(page)
      check(`${id}: ${direction > 0 ? 'forward' : 'reverse'} quiet release cancels uncommitted pressure`, released.phase === 'idle' && released.pressure === 0 && count(released) === beforeCount && closeEnough(released.scrollY, b[endpoint]), released)
      await wheel(page, direction * 100)
      await pause(20)
      const moving = await state(page)
      check(`${id}: ${direction > 0 ? 'forward' : 'reverse'} commitment animates original-size planes`, moving.boundaryId === id && moving.isAnimating && count(moving) === beforeCount + 1 && unitScale(moving) && moving.domPlanes.every((p, i) => p.width === initial.domPlanes[i].width && p.height === initial.domPlanes[i].height), moving)
      await wheel(page, -direction * 8)
      const returned = await awaitSettled(page)
      check(`${id}: ${direction > 0 ? 'forward' : 'reverse'} moving reversal returns to the original endpoint`, returned.boundaryId === id && reverseCount(returned) === beforeReverse + 1 && closeEnough(returned.scrollY, b[endpoint]) && count(returned) === beforeCount + 1, returned)
    }
  }

  // Exact-cost isolated commitments prove every boundary can land and accept
  // another gesture immediately. Continuous kinetic streams are checked next.
  await align(page, ids[0], 'start')
  await startSampling(page)
  const recorder = await page.screencast({ path: path.join(OUT, 'all-sections.webm'), ffmpegPath: '/opt/homebrew/bin/ffmpeg' })
  const traversal = []
  for (const direction of [1, -1]) {
    const ordered = direction === 1 ? ids : ids.slice().reverse()
    for (let index = 0; index < ordered.length; index++) {
      const id = ordered[index]
      const before = await state(page), b = edge(before, id)
      const entry = direction === 1 ? b.start : b.end
      const gap = Math.max(0, direction * (entry - before.scrollY))
      if (gap > 120) {
        await wheel(page, direction * (gap * .5))
        const reading = await state(page)
        check(`${id}: native reading interval preserves wheel delta ${direction > 0 ? 'forward' : 'backward'}`, count(reading) === count(before) && closeEnough(reading.scrollY - before.scrollY, direction * gap * .5), { before, after: reading, expectedDelta: direction * gap * .5 })
      }
      const ready = await state(page)
      const remaining = Math.max(0, direction * (entry - ready.scrollY))
      await mark(page, `${direction > 0 ? 'down' : 'up'} ${id}`)
      await wheel(page, direction * (remaining + 100))
      await pause(100)
      const active = await state(page)
      if (index === 0 || id.includes('meet') || id.includes('faq')) await shot(page, `moving-${direction > 0 ? 'down' : 'up'}-${index}.png`)
      const landed = await awaitSettled(page)
      const destination = direction === 1 ? b.end : b.start
      check(`${id}: exact-cost ${direction > 0 ? 'forward' : 'reverse'} traversal lands with no post-transition lock`, active.boundaryId === id && count(landed) === count(ready) + 1 && closeEnough(landed.scrollY, destination) && landed.phase === 'idle', { before: ready, active, landed })
      traversal.push({ id, direction, scrollY: landed.scrollY, commits: count(landed) })
    }
  }
  // One uninterrupted wheel stream must carry through adjacent short planes.
  const kinetic = []
  for (const direction of [1, -1]) {
    const boundary = direction > 0 ? ids[3] : ids.at(-1)
    await align(page, boundary, direction > 0 ? 'start' : 'end')
    const before = await state(page), chargeCount = before.charges.length
    await mark(page, direction > 0 ? 'continuous kinetic down' : 'continuous kinetic up')
    await wheel(page, direction * 90, 30, 16)
    const after = await awaitSettled(page)
    const charges = after.charges.slice(chargeCount)
    const ordered = charges.every((charge, i) => charge.threshold === 100 && (i === 0 || ids.indexOf(charge.boundaryId) === ids.indexOf(charges[i - 1].boundaryId) + direction))
    check(`One continuous ${direction > 0 ? 'downward' : 'upward'} wheel stream carries across at least three ordered gates`, charges.length >= 3 && ordered && count(after) - count(before) === charges.length, { before, after, charges })
    kinetic.push({ direction, before, after, charges })
  }
  save('kinetic-wheel-carry.json', kinetic)
  const trace = await finishSampling(page, 'all-sections-trace')
  const wheelEvents = trace.inputs.filter((event) => event.type === 'wheel' && event.cancelable)
  check('Every ordinary vertical wheel event is owned from its first event without native latching', wheelEvents.length > 0 && wheelEvents.every((event) => event.prevented), { events: wheelEvents.length, prevented: wheelEvents.filter((event) => event.prevented).length })
  save('all-sections-trace.svg', graph(trace))
  save('traversal.json', traversal)
  await recorder.stop()
  execFileSync('/opt/homebrew/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(OUT, 'all-sections.webm'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(OUT, 'all-sections.mp4')])

  // FAQ expansion and viewport changes exercise live boundary measurement.
  {
    const before = await state(page)
    const faqButtons = await page.$$('section[aria-labelledby="faq"] button[aria-expanded]')
    await faqButtons[0].click()
    await pause(500)
    const expanded = await state(page)
    const oldFaq = before.domPlanes.find((p) => p.id === 'faq'), newFaq = expanded.domPlanes.find((p) => p.id === 'faq')
    const lastOld = before.boundaries.at(-1), lastNew = expanded.boundaries.at(-1)
    check('Expanding FAQ updates its natural height and the footer boundary', newFaq.height > oldFaq.height && lastNew.end > lastOld.end && expanded.documentHeight > before.documentHeight, { before, after: expanded })
    await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 })
    await pause(500)
    const resized = await state(page)
    check('Resize recomputes all valid ordered boundaries without overflow', resized.boundaries.length === ids.length && resized.boundaries.every((b, i, all) => b.end >= b.start && (i === 0 || b.start >= all[i - 1].end - 1)) && !resized.overflow, resized)
    await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 })
    await pause(400)
  }
  await page.evaluate(() => { document.activeElement?.blur(); document.body.tabIndex = -1; document.body.focus({ preventScroll: true }) })
  await page.keyboard.down('Control')
  await page.keyboard.press('End')
  await page.keyboard.up('Control')
  await pause(500)
  const keyboardFooter = await state(page)
  if (!closeEnough(keyboardFooter.scrollY, keyboardFooter.maxScroll)) {
    await page.keyboard.press('End'); await pause(300)
  }
  const plainEnd = await state(page)
  if (!closeEnough(plainEnd.scrollY, plainEnd.maxScroll)) {
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight - innerHeight)); await pause(150)
  }
  const footer = await state(page)
  check('Native document navigation reaches the real footer at maximum scroll', closeEnough(footer.scrollY, footer.maxScroll) && footer.domPlanes.at(-1).visibleBottom <= footer.height + 2 && !footer.isAnimating, { keyboardEnd: keyboardFooter, plainEnd, final: footer })
  await shot(page, 'footer-end.png')
  await page.close()

  // Native keyboard/anchor and booking entry links remain available.
  {
    const p = await open()
    await p.click('.home-experience-link')
    await pause(300)
    const anchor = await p.evaluate(() => { const e = document.getElementById('ways'), r = e.getBoundingClientRect(), h = document.querySelector('header').getBoundingClientRect(); return { hash: location.hash, top: r.top, header: h.bottom } })
    check('Gathering anchor bypasses all gesture gates', anchor.hash === '#ways' && anchor.top >= anchor.header - 2, anchor)
    const anchorBefore = await state(p), anchorCharges = anchorBefore.charges.length
    await wheel(p, 90, 20, 16)
    const anchorAfter = await awaitSettled(p)
    check('Downward kinetic scrolling from the gathering anchor continues into later content', count(anchorAfter) > count(anchorBefore) && anchorAfter.scrollY > anchorBefore.boundaries[1].end + 50 && anchorAfter.charges.slice(anchorCharges).every((c) => c.threshold === 100), { before: anchorBefore, after: anchorAfter })
    await p.evaluate(() => { location.hash = ''; location.hash = 'ways' })
    await pause(250)
    await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle0' }), p.click('[data-service-inquiry][data-format="dinner"]')])
    check('Gathering link still reaches dinner booking', new URL(p.url()).pathname.endsWith('/book/') && new URL(p.url()).searchParams.get('type') === 'dinner', { url: p.url() })
    await p.close()
    const h = await open()
    await Promise.all([h.waitForNavigation({ waitUntil: 'networkidle0' }), h.click('[data-hero-cta]')])
    check('Hero link still reaches unselected booking', new URL(h.url()).pathname.endsWith('/book/') && !new URL(h.url()).search, { url: h.url() })
    await h.close()
  }

  // Mobile: native reading gaps and actual continuous touch crossing every edge.
  {
    const off = await open({ flag: 'off', width: 390, height: 844 })
    const mobileOff = await warm(off); await off.close()
    const p = await open({ width: 390, height: 844 })
    const mobile = await warm(p)
    check('Mobile on/off preserves all plane dimensions including narrow sections', geometryMatches(mobile, mobileOff), { on: mobile, off: mobileOff })
    const cdp = await p.createCDPSession()
    const mobileRows = []
    for (const direction of [1, -1]) {
      for (const id of (direction === 1 ? ids : ids.slice().reverse())) {
        await p.keyboard.press('Escape')
        const before = await state(p), b = edge(before, id)
        const entry = direction === 1 ? b.start : b.end
        // Slow movement retains20px of pressure below the60px touch threshold;
        // a fast release is intentionally allowed to carry into commitment.
        const from = Math.max(0, Math.min(before.maxScroll, entry - direction * 60))
        await p.evaluate((y) => scrollTo(0, y), from)
        await pause(100)
        const c0 = count(await state(p))
        await slowTouch(cdp, direction * (Math.abs(entry - from) + 20))
        const held = await state(p)
        check(`${id}: slow mobile continuous ${direction > 0 ? 'forward' : 'reverse'} entry meets resistance`, held.boundaryId === id && held.phase === 'resisting' && count(held) === c0 && closeEnough(held.scrollY, entry) && Math.abs(held.pressure) > 0 && Math.abs(held.pressure) < 60, held)
        await pause(280)
        await slowTouch(cdp, direction * 60)
        const done = await awaitSettled(p)
        check(`${id}: mobile touch completes ${direction > 0 ? 'forward' : 'reverse'} transition`, done.boundaryId === id && count(done) === c0 + 1 && closeEnough(done.scrollY, direction === 1 ? b.end : b.start), done)
        mobileRows.push({ id, direction, from, held: { pressure: held.pressure, scrollY: held.scrollY }, destination: done.scrollY })
      }
    }
    save('mobile-traversal.json', mobileRows)
    // Inertia continues after a fast release, but old velocity must disappear
    // when the finger is held stationary before releasing.
    await align(p, ids[0], 'start')
    let beforeFlick = await state(p), releaseState, releaseTime
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 300, y: 740 }] })
    for (const y of [540, 340, 140]) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 300, y }] }); await pause(16)
    }
    releaseState = await state(p); releaseTime = await p.evaluate(() => performance.now())
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await pause(1800)
    const afterFlick = await awaitSettled(p), flickCharges = afterFlick.charges.slice(beforeFlick.charges.length)
    check('A released fast mobile flick crosses multiple paid gates and continues after release', flickCharges.length >= 2 && flickCharges.every((charge) => charge.threshold === 60) && afterFlick.scrollY > releaseState.scrollY + 50, { before: beforeFlick, release: releaseState, releaseTime, after: afterFlick, charges: flickCharges })
    await align(p, ids[3], 'start')
    const beforeHeld = await state(p)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 300, y: 650 }] })
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 300, y: 610 }] })
    await pause(500)
    const heldBeforeRelease = await state(p)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await pause(600)
    const heldAfterRelease = await state(p)
    check('Holding a finger stationary500ms removes old velocity before release', count(heldAfterRelease) === count(beforeHeld) && closeEnough(heldAfterRelease.scrollY, heldBeforeRelease.scrollY) && !heldAfterRelease.isAnimating, { before: beforeHeld, release: heldBeforeRelease, after: heldAfterRelease })
    await align(p, ids[3], 'start')
    const beforeShort = await state(p)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 300, y: 650 }] })
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 300, y: 610 }] })
    const shortRelease = await p.evaluate(() => performance.now())
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await pause(1400)
    const afterShort = await awaitSettled(p), shortCharges = afterShort.charges.slice(beforeShort.charges.length)
    check('Immediate fast release can fund a subthreshold touch commitment through inertia', count(afterShort) > count(beforeShort) && shortCharges.some((charge) => charge.time > shortRelease && charge.threshold === 60), { before: beforeShort, releaseTime: shortRelease, after: afterShort, charges: shortCharges })
    save('touch-kinetics.json', { largeFlick: { release: releaseState, after: afterFlick, charges: flickCharges }, heldFinger: { before: beforeHeld, release: heldBeforeRelease, after: heldAfterRelease }, shortFlick: { before: beforeShort, releaseTime: shortRelease, after: afterShort, charges: shortCharges } })
    // Genuine horizontal touch must retain the existing dishes carousel.
    await p.evaluate(() => document.querySelector('#dish-carousel-track').scrollIntoView({ block: 'center', behavior: 'instant' }))
    await pause(200)
    const carousel = await p.$eval('#dish-carousel-track', (e) => { const r = e.getBoundingClientRect(); return { y: Math.max(130, Math.min(innerHeight - 80, r.top + r.height / 2)), before: e.scrollLeft } })
    const c0 = count(await state(p)), y0 = await p.evaluate(() => scrollY)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 300, y: carousel.y }] })
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 120, y: carousel.y }] })
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await pause(250)
    const carouselAfter = await p.$eval('#dish-carousel-track', (e) => e.scrollLeft)
    const horizontal = await state(p)
    check('Dishes retain native horizontal touch scrolling without a vertical commit', carouselAfter > carousel.before + 30 && count(horizontal) === c0 && closeEnough(horizontal.scrollY, y0), { before: carousel, after: carouselAfter, state: horizontal })
    await shot(p, 'mobile-dishes.png')
    await cdp.detach(); await p.close()
  }

  for (const [name, options] of [['reduced', { reduced: true }], ['off', { flag: 'off' }], ['no-js', { js: false }]]) {
    const p = await open(options), s = await state(p)
    check(`${name}: all ten planes remain visible in ordinary document flow`, !s.enabled && s.domPlanes.length === 10 && s.domPlanes.every((plane) => plane.height > 0 && plane.transform === 'none') && !s.overflow, s)
    await p.keyboard.press('End'); await pause(300)
    const end = await state(p)
    check(`${name}: footer remains reachable`, closeEnough(end.scrollY, end.maxScroll), end)
    await p.close()
  }

  // Separate representative performance pass, without video capture.
  {
    console.log('STAGE performance begins in8seconds; visual/GPU coordination window')
    save('stage.txt', 'performance begins in8seconds\n')
    await pause(8000)
    const p = await open(); await warm(p)
    await startSampling(p)
    const file = path.join(OUT, 'performance.json')
    await p.tracing.start({ path: file, screenshots: false, categories: ['devtools.timeline', 'v8.execute', 'blink.user_timing', 'toplevel', 'disabled-by-default-devtools.timeline'] })
    for (const id of [ids[0], ids[Math.floor(ids.length / 2)], ids.at(-1)]) {
      await align(p, id, 'start'); await wheel(p, 100); await awaitSettled(p)
    }
    const data = await finishSampling(p, 'performance-samples')
    await p.tracing.stop()
    save('performance-summary.json', { method: 'One headless Chrome synthetic traversal of representative first/middle/last boundaries at1440x1000; no video or CPU throttling. rAF is not physical display or hardware-input evidence.', ...performanceMetrics(data, file, `${ORIGIN}/?depth=on`) })
    await p.close()
  }

  const buildAfter = signature()
  check('Stable preview files did not change during capture', JSON.stringify(buildBefore) === JSON.stringify(buildAfter), { before: buildBefore, after: buildAfter })
  check('No uncaught browser errors occurred in these scenarios', browserErrors.length === 0, browserErrors)
  save('results.json', { createdAt: new Date().toISOString(), browser: await browser.version(), origin: ORIGIN, passed: checks.filter((c) => c.pass).length, total: checks.length, checks, browserErrors, buildBefore, buildAfter, method: 'Isolated headless Chrome; all input synthetic CDP; no physical-device or unfamiliar-user acceptance performed.' })
  save('results.txt', checks.map((c) => `${c.pass ? 'PASS' : 'FAIL'} ${c.name}`).join('\n') + '\nPhysical-device and unfamiliar-user acceptance remain unverified.\n')
  console.log(`RESULT ${checks.filter((c) => c.pass).length}/${checks.length}; evidence ${OUT}`)
  if (checks.some((c) => !c.pass)) process.exitCode = 1
} catch (error) {
  save('harness-error.txt', error.stack || String(error))
  save('partial-results.json', checks)
  console.error(error)
  process.exitCode = 1
} finally {
  await browser?.close()
  if (server) {
    const closed = new Promise(resolve => server.close(resolve))
    // This server belongs to this test. Do not leave keep-alive clients holding
    // the completed runner open after its isolated browser has closed.
    server.closeAllConnections()
    await closed
  }
}
