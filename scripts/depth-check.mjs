// Runtime evidence for the opt-in depth study. All gestures are synthetic CDP input.
// Requires a completed dist/ build. Does not rebuild or modify application source.
// DEPTH_ORIGIN reuses an already running preview; otherwise this script owns port 4358.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import puppeteer from 'puppeteer-core'
import sharp from 'sharp'
import { serve } from './serve.mjs'

const OUT = path.resolve(process.env.DEPTH_OUTPUT || 'output/depth-study')
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const ORIGIN = process.env.DEPTH_ORIGIN || 'http://localhost:4358'
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const checks = []
const errors = []
const check = (name, ok, detail = {}) => checks.push({ name, pass: !!ok, detail })
const save = (file, data) => fs.writeFileSync(path.join(OUT, file), typeof data === 'string' ? data : JSON.stringify(data, null, 2))
fs.mkdirSync(OUT, { recursive: true })
let browser, server

const state = (page) => page.evaluate(() => {
  const s = window.__depthStudy
  const rect = (selector) => {
    const e = document.querySelector(selector)
    if (!e) return null
    const r = e.getBoundingClientRect()
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height, width: r.width }
  }
  const layout = (selector) => {
    const e = document.querySelector(selector)
    if (!e) return null
    const c = getComputedStyle(e)
    const m = c.transform === 'none' ? null : new DOMMatrixReadOnly(c.transform)
    return { height: e.offsetHeight, width: e.offsetWidth, minHeight: c.minHeight, perspective: c.perspective, transform: c.transform, scaleX: m ? Math.hypot(m.m11, m.m12, m.m13) : 1, scaleY: m ? Math.hypot(m.m21, m.m22, m.m23) : 1 }
  }
  return {
    ...s, scrollY, viewport: { width: innerWidth, height: innerHeight },
    hero: rect('[data-home-hero]'), handoff: rect('[data-home-handoff]'),
    heading: rect('#home-gather-heading'), headerRect: rect('header'),
    heroTransform: document.querySelector('[data-depth-plane]') ? getComputedStyle(document.querySelector('[data-depth-plane]')).transform : null,
    layout: { root: layout('[data-depth-study]'), hero: layout('[data-depth-hero]'), handoff: layout('[data-depth-handoff]'), heroSection: layout('[data-home-hero]'), handoffSection: layout('[data-home-handoff]'), document: document.documentElement.scrollHeight },
    overflow: document.documentElement.scrollWidth > innerWidth,
  }
})
const visible = (r, height, header = 0) => !!r && r.top >= header - 2 && r.bottom <= height + 2 && r.left >= -1 && r.right <= 1441

async function open({ width = 1440, height = 1000, flag = 'on', reduced = false, js = true, hash = '' } = {}) {
  const page = await browser.newPage()
  await page.setViewport({ width, height, deviceScaleFactor: 1, isMobile: width <= 620, hasTouch: width <= 620 })
  if (reduced) await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }])
  if (!js) await page.setJavaScriptEnabled(false)
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`${ORIGIN}/?depth=${flag}${hash}`, { waitUntil: 'networkidle0' })
  await page.evaluate(() => document.fonts.ready)
  if (js && flag === 'on') await page.waitForFunction(() => !!window.__depthStudy, { timeout: 5000 })
  await wait(180)
  return page
}

async function startSampling(page) {
  await page.evaluate(() => {
    const evidence = { rows: [], inputs: [], marks: [], stop: false }
    window.__depthEvidence = evidence
    const record = (e) => evidence.inputs.push({ t: performance.now(), type: e.type, deltaY: e.deltaY ?? null, deltaMode: e.deltaMode ?? null, key: e.key ?? null, trusted: e.isTrusted })
    window.addEventListener('wheel', record, { passive: true })
    window.addEventListener('keydown', record)
    let previous = 0
    const sample = (t) => {
      if (evidence.stop) {
        window.removeEventListener('wheel', record)
        window.removeEventListener('keydown', record)
        return
      }
      const d = window.__depthStudy || {}
      evidence.rows.push({ t, dt: previous ? t - previous : null, scrollY, raw: d.raw ?? null, progress: d.progress ?? null, inputY: d.inputY ?? null, followerY: d.followerY ?? null, offset: d.offset ?? null, enabled: d.enabled ?? false })
      previous = t
      requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
  })
}
const mark = (page, name) => page.evaluate((label) => window.__depthEvidence.marks.push({ label, t: performance.now() }), name)
async function finishSampling(page, name) {
  const evidence = await page.evaluate(() => { window.__depthEvidence.stop = true; return window.__depthEvidence })
  save(`${name}.json`, evidence)
  save(`${name}.csv`, ['t_ms,frame_ms,scroll_y,raw_progress,rendered_progress,input_y,follower_y,incoming_offset,enabled', ...evidence.rows.map((r) => [r.t, r.dt, r.scrollY, r.raw, r.progress, r.inputY, r.followerY, r.offset, r.enabled].join(','))].join('\n'))
  return evidence
}
async function wheel(page, deltaY, count, gap = 70) {
  await page.mouse.move(1060, 540)
  for (let i = 0; i < count; i++) {
    await page.mouse.wheel({ deltaY })
    await wait(gap)
  }
}
const quantile = (values, q) => values.slice().sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * q))] ?? null
function metrics(evidence) {
  const frames = evidence.rows.map((r) => r.dt).filter((v) => v !== null)
  return {
    samples: evidence.rows.length, durationMs: evidence.rows.at(-1).t - evidence.rows[0].t,
    medianFrameMs: quantile(frames, 0.5), p95FrameMs: quantile(frames, 0.95), maxFrameMs: Math.max(...frames),
    framesOver25ms: frames.filter((v) => v > 25).length, framesOver50ms: frames.filter((v) => v > 50).length,
    maxProgressLag: Math.max(0, ...evidence.rows.filter((r) => r.raw !== null).map((r) => Math.abs(r.raw - r.progress))),
    minIncomingOffset: Math.min(0, ...evidence.rows.map((r) => r.offset ?? 0)), maxIncomingOffset: Math.max(0, ...evidence.rows.map((r) => r.offset ?? 0)),
  }
}
function traceMetrics(file, url) {
  const events = JSON.parse(fs.readFileSync(file, 'utf8')).traceEvents
  const start = events.find((e) => e.name === 'TracingStartedInBrowser')
  const pid = start?.args?.data?.frames?.find((f) => f.url === url)?.processId
  const tid = events.find((e) => e.name === 'thread_name' && e.pid === pid && e.args?.name === 'CrRendererMain')?.tid
  const tasks = events.filter((e) => e.ph === 'X' && e.pid === pid && e.tid === tid && e.name === 'RunTask').map((e) => e.dur / 1000)
  const total = (names) => events.filter((e) => e.ph === 'X' && e.pid === pid && names.includes(e.name)).reduce((sum, e) => sum + e.dur / 1000, 0)
  return {
    rendererProcess: pid, mainThread: tid, mainThreadTaskCount: tasks.length,
    longestMainThreadTaskMs: tasks.length ? Math.max(...tasks) : null,
    mainThreadTasksOver50ms: tasks.filter((t) => t > 50).length,
    mainThreadTaskTotalMs: tasks.reduce((sum, t) => sum + t, 0),
    styleAndLayoutTotalMs: total(['UpdateLayoutTree', 'Layout']), paintTotalMs: total(['Paint']), rasterTotalMs: total(['RasterTask']),
  }
}
async function filmstrip() {
  const frames = [['prototype-start.png', 'Start'], ['prototype-moving.png', 'Just after slow input'], ['prototype-reversed.png', 'Reversed, released'], ['prototype-complete.png', 'Fast burst, settled']]
  const tiles = await Promise.all(frames.map(async ([file, label], i) => {
    const shot = await sharp(path.join(OUT, file)).resize({ width: 640 }).png().toBuffer()
    const text = Buffer.from(`<svg width="640" height="35"><rect width="640" height="35" fill="#fffdf8"/><text x="14" y="24" font-family="sans-serif" font-size="17" fill="#292723">${label}</text></svg>`)
    return [{ input: text, left: (i % 2) * 640, top: Math.floor(i / 2) * 480 }, { input: shot, left: (i % 2) * 640, top: Math.floor(i / 2) * 480 + 35 }]
  }))
  await sharp({ create: { width: 1280, height: 960, channels: 3, background: '#fffdf8' } }).composite(frames.length ? tiles.flat() : []).png().toFile(path.join(OUT, 'motion-filmstrip.png'))
}
function graph(evidence) {
  const W = 1200, H = 420, left = 65, right = 25, top = 45, bottom = 65
  const t0 = evidence.rows[0].t, duration = evidence.rows.at(-1).t - t0
  const x = (t) => left + (t - t0) / duration * (W - left - right)
  const y = (p) => top + (1 - p) * (H - top - bottom)
  const line = (key, color) => `<polyline fill="none" stroke="${color}" stroke-width="2.5" points="${evidence.rows.filter((r) => r[key] !== null).map((r) => `${x(r.t).toFixed(2)},${y(r[key]).toFixed(2)}`).join(' ')}"/>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="100%" height="100%" fill="#fffdf8"/><g font-family="system-ui,sans-serif" fill="#292723"><text x="${left}" y="25" font-size="17">Synthetic wheel input: native scroll target and rendered depth progress</text>${[0,.25,.5,.75,1].map((p) => `<path d="M${left} ${y(p)}H${W-right}" stroke="#ddd8cf"/><text x="20" y="${y(p)+5}" font-size="13">${p}</text>`).join('')}${line('raw','#a5453e')}${line('progress','#275d6b')}${evidence.marks.map((m, i) => `<path d="M${x(m.t)} ${top}V${H-bottom}" stroke="#777" stroke-dasharray="3 5"/><text x="${x(m.t)+4}" y="${H-38+(i%2)*18}" font-size="11">${m.label}</text>`).join('')}<text x="${W-365}" y="25" font-size="12" fill="#a5453e">red: raw</text><text x="${W-265}" y="25" font-size="12" fill="#275d6b">blue: spring</text><text x="${left}" y="${H-7}" font-size="12">${(duration/1000).toFixed(2)} seconds; 0 = hero, 1 = gathering; input is CDP, not physical hardware</text></g></svg>`
}

try {
  if (!process.env.DEPTH_ORIGIN) server = await serve(4358)
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true })

  // Current-build baseline. Historical stale-build files, if present, are not used.
  let baseline
  {
    const page = await open({ flag: 'off' })
    baseline = await state(page)
    save('baseline-geometry.json', baseline)
    await page.screenshot({ path: path.join(OUT, 'baseline-1440x1000.png') })
    const s = await state(page)
    check('Default/off page retains a readable hero and gathering section', s.hero.height > 0 && s.handoff.height > 0 && !s.overflow, s)
    await page.close()
  }

  // Main observed sequence: slow traversal, release, reversal, flick, release.
  let sequence, initial
  {
    const page = await open()
    initial = await state(page)
    save('prototype-geometry.json', initial)
    check('Opt-in depth activates at 1440x1000', initial.enabled, initial)
    check('On/off section, wrapper and document heights are identical', ['root', 'hero', 'handoff', 'heroSection', 'handoffSection'].every((k) => initial.layout[k].height === baseline.layout[k].height) && initial.layout.document === baseline.layout.document, { off: baseline.layout, on: initial.layout })
    check('Both planes stay full-width without scale, perspective or imposed minimum heights', ['hero', 'handoff'].every((k) => initial.layout[k].width === 1440 && initial.layout[k].scaleX === 1 && initial.layout[k].scaleY === 1 && initial.layout[k].perspective === 'none' && initial.layout[k].minHeight === '0px') && initial.hero.width === 1440 && initial.handoff.width === 1440, initial.layout)
    if (!initial.enabled) throw new Error(`Prototype did not activate: ${initial.reason}`)
    await page.evaluate((y) => scrollTo(0, y), Math.max(0, initial.start))
    await wait(600)
    await page.screenshot({ path: path.join(OUT, 'prototype-start.png') })
    const recorder = await page.screencast({ path: path.join(OUT, 'interaction.webm'), ffmpegPath: '/opt/homebrew/bin/ffmpeg' })
    await startSampling(page)
    await mark(page, 'slow start')
    await wheel(page, initial.travel * .04, 12, 70)
    await mark(page, 'release')
    await page.screenshot({ path: path.join(OUT, 'prototype-moving.png') })
    await wait(700)
    const mid = await state(page)
    await page.screenshot({ path: path.join(OUT, 'prototype-midpoint.png') })
    check('Slow traversal reaches an intermediate depth continuously', mid.raw > .3 && mid.raw < .65 && Math.abs(mid.raw - mid.progress) < .01, mid)
    await mark(page, 'reverse')
    await wheel(page, -initial.travel * .035, 6, 60)
    await mark(page, 'reverse release')
    await wait(650)
    const reversed = await state(page)
    await page.screenshot({ path: path.join(OUT, 'prototype-reversed.png') })
    check('Reversal returns toward the hero without a committed section jump', reversed.raw < mid.raw - .12 && reversed.progress < mid.progress - .12 && reversed.raw > .05, { before: mid, after: reversed })
    await mark(page, 'fast flick')
    await wheel(page, initial.travel * .25, 3, 15)
    await mark(page, 'flick release')
    await wait(850)
    const completed = await state(page)
    await page.screenshot({ path: path.join(OUT, 'prototype-complete.png') })
    await filmstrip()
    check('Fast burst reaches gathering with settled depth', completed.raw >= .99 && Math.abs(completed.raw - completed.progress) < .01, completed)
    check('Gathering heading remains visible at completed depth', visible(completed.heading, 1000, completed.headerRect.bottom), completed)
    sequence = await finishSampling(page, 'interaction-trace')
    save('interaction-trace.svg', graph(sequence))
    await recorder.stop()
    execFileSync('/opt/homebrew/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(OUT, 'interaction.webm'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(OUT, 'interaction.mp4')])
    const release = sequence.marks.find((m) => m.label === 'release').t
    const reverse = sequence.marks.find((m) => m.label === 'reverse').t
    const releasedRows = sequence.rows.filter((r) => r.t > release + 100 && r.t < reverse)
    const releaseScrollRange = Math.max(...releasedRows.map((r) => r.scrollY)) - Math.min(...releasedRows.map((r) => r.scrollY))
    check('Release does not autonomously snap the document to another section', releaseScrollRange <= 1, { releaseScrollRange, last: releasedRows.at(-1) })
    check('Depth progress remains bounded during the recorded sequence', sequence.rows.every((r) => r.progress >= -.001 && r.progress <= 1.001), metrics(sequence))
    check('Incoming translation is bounded and responds in both directions', sequence.rows.every((r) => Math.abs(r.offset) <= initial.maxLag + .01) && sequence.rows.some((r) => r.offset > 8) && sequence.rows.some((r) => r.offset < -8), metrics(sequence))
    await wheel(page, initial.travel * 1.5, 2, 20)
    const escaped = await state(page)
    check('A large continued scroll exits the study into normal document flow', escaped.scrollY > initial.end + 100, escaped)
    await page.close()
  }

  // Performance pass has no screencast and no screenshots; rAF sampling remains.
  const perf = {}
  for (const flag of ['off', 'on']) {
    const page = await open({ flag })
    await page.evaluate((y) => scrollTo(0, y), Math.max(0, initial.start))
    await wait(450)
    await page.tracing.start({ path: path.join(OUT, `performance-${flag}.json`), screenshots: false, categories: ['devtools.timeline', 'v8.execute', 'blink.user_timing', 'toplevel', 'disabled-by-default-devtools.timeline'] })
    await startSampling(page)
    await wheel(page, initial.travel * .025, 32, 20)
    await wait(450)
    await wheel(page, -initial.travel * .025, 28, 20)
    await wait(500)
    const trace = await finishSampling(page, `performance-samples-${flag}`)
    await page.tracing.stop()
    perf[flag] = { ...metrics(trace), ...traceMetrics(path.join(OUT, `performance-${flag}.json`), `${ORIGIN}/?depth=${flag}`) }
    await page.close()
  }
  save('performance-summary.json', { method: 'Headless Chrome, identical synthetic wheel schedule, 1440x1000, no screencast, no CPU throttling. Instrumented rAF measures frame delivery, not GPU presentation or physical-input latency.', ...perf })

  // Genuine keyboard events through CDP, with native focus scrolling.
  {
    const page = await open()
    const before = await state(page)
    await page.keyboard.press('PageDown')
    await wait(700)
    const after = await state(page)
    check('PageDown advances native document scroll', after.scrollY > before.scrollY + 100, { before: before.scrollY, after: after.scrollY })
    await page.keyboard.press('PageUp')
    await wait(700)
    const back = await state(page)
    check('PageUp reverses native document scroll', back.scrollY < after.scrollY - 100, { before: after.scrollY, after: back.scrollY })
    await page.goto(`${ORIGIN}/?depth=on`, { waitUntil: 'networkidle0' })
    await wait(300)
    const focusTargets = []
    for (let i = 0; i < 42 && focusTargets.length < 4; i++) {
      await page.keyboard.press('Tab')
      await wait(70)
      const focus = await page.evaluate(() => {
        const e = document.activeElement
        if (!e.matches('[data-hero-cta], [data-service-inquiry]')) return null
        const r = e.getBoundingClientRect()
        const h = document.querySelector('header').getBoundingClientRect()
        const x = Math.min(innerWidth - 1, Math.max(0, r.left + r.width / 2))
        const y = Math.min(innerHeight - 1, Math.max(0, r.top + r.height / 2))
        const hit = document.elementFromPoint(x, y)
        return { label: e.textContent.trim(), top: r.top, bottom: r.bottom, width: r.width, visible: r.top >= h.bottom - 2 && r.bottom <= innerHeight + 2, hit: !!hit && e.contains(hit) }
      })
      if (focus) focusTargets.push(focus)
    }
    save('keyboard-targets.json', focusTargets)
    check('Tab reaches hero and all three gathering booking links in visible space', focusTargets.length === 4 && focusTargets.every((f) => f.visible && f.hit), focusTargets)
    await page.close()
  }

  // Real anchor and booking href activation, without submitting anything.
  {
    const page = await open()
    await page.click('.home-experience-link')
    await wait(700)
    const s = await state(page)
    check('The gathering anchor lands on a readable heading', new URL(page.url()).hash === '#ways' && visible(s.heading, 1000, s.headerRect.bottom), s)
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.click('[data-service-inquiry][data-format="dinner"]')])
    check('Gathering booking link reaches the dinner booking flow', new URL(page.url()).pathname.endsWith('/book/') && new URL(page.url()).searchParams.get('type') === 'dinner', { url: page.url(), step: await page.$eval('[data-step]', (e) => e.dataset.step) })
    await page.close()
    const heroPage = await open()
    await Promise.all([heroPage.waitForNavigation({ waitUntil: 'networkidle0' }), heroPage.click('[data-hero-cta]')])
    check('Hero booking link reaches the unselected booking flow', new URL(heroPage.url()).pathname.endsWith('/book/') && !new URL(heroPage.url()).search, { url: heroPage.url(), step: await heroPage.$eval('[data-step]', (e) => e.dataset.step) })
    await heroPage.close()
  }

  for (const [name, options] of [
    ['mobile', { width: 390, height: 844 }],
    ['narrow', { width: 860, height: 900 }],
    ['short', { width: 1440, height: 580 }],
    ['reduced', { reduced: true }],
    ['no-js', { js: false }],
  ]) {
    const page = await open(options)
    const s = await state(page)
    check(`${name}: ordinary readable document flow`, !s.enabled && s.hero.height > 0 && s.handoff.height > 0 && s.handoff.top >= s.hero.bottom - 2 && !s.overflow && (!s.heroTransform || s.heroTransform === 'none'), s)
    const links = await page.$$eval('[data-hero-cta], [data-service-inquiry]', (items) => items.map((e) => ({ text: e.textContent.trim(), href: e.getAttribute('href'), height: e.getBoundingClientRect().height })))
    check(`${name}: all four booking hrefs survive`, links.length === 4 && links.every((l) => /\/book\//.test(l.href) && l.height >= 44), links)
    await page.screenshot({ path: path.join(OUT, `fallback-${name}.png`) })
    await page.close()
  }

  // A tall hero must scroll normally before becoming sticky; resizing and
  // preference changes must release the enhanced geometry immediately.
  {
    const page = await open({ width: 1280, height: 720 })
    const s = await state(page)
    check('1280x720: tall hero remains eligible with a natural reading interval', s.enabled && s.heroHeight > s.travel && s.start > 0, s)
    await page.evaluate((y) => scrollTo(0, y), s.start + s.travel * .5)
    await wait(650)
    await page.screenshot({ path: path.join(OUT, 'prototype-tall-hero.png') })
    const mid = await state(page)
    check('1280x720: tall hero produces intermediate depth without overflow', mid.raw > .45 && mid.raw < .55 && !mid.overflow, mid)
    await page.reload({ waitUntil: 'networkidle0' })
    await page.waitForFunction(() => !!window.__depthStudy)
    const restored = await state(page)
    check('Reload at intermediate scroll restores matching depth', Math.abs(restored.raw - restored.progress) < .01 && Math.abs(restored.scrollY - mid.scrollY) < 3, { before: mid, after: restored })
    await page.setViewport({ width: 800, height: 720, deviceScaleFactor: 1 })
    await wait(350)
    const resized = await state(page)
    check('Resizing to narrow releases the sticky geometry', !resized.enabled && resized.handoff.top >= resized.hero.bottom - 2 && !resized.overflow, resized)
    await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 })
    await wait(350)
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }])
    await wait(350)
    const reduced = await state(page)
    check('Changing reduced-motion preference releases depth immediately', !reduced.enabled && reduced.reason === 'reduced-motion' && (!reduced.heroTransform || reduced.heroTransform === 'none'), reduced)
    await page.close()
  }

  check('No uncaught browser errors during these runs', errors.length === 0, errors)
  save('results.json', {
    method: 'Local current dist/ build; Puppeteer isolated headless Chrome; all wheel, keyboard, and clicks are synthetic CDP. No physical touch/trackpad and no unfamiliar-user validation performed.',
    createdAt: new Date().toISOString(), browser: await browser.version(), origin: ORIGIN,
    passed: checks.filter((c) => c.pass).length, total: checks.length, checks, errors,
    requiredHumanEvidence: ['Physical mouse wheel, macOS trackpad momentum, and touchscreen traversal/reversal on the intended browsers.', 'Unfamiliar visitors identify front/back planes, read the gathering choices, deliberately reverse halfway, and enter booking without accidental skips.'],
  })
  save('results.txt', checks.map((c) => `${c.pass ? 'PASS' : 'FAIL'} ${c.name}`).join('\n') + '\n\nPhysical input and unfamiliar-user acceptance remain unverified.\n')
  console.log(checks.map((c) => `${c.pass ? 'PASS' : 'FAIL'} ${c.name}`).join('\n'))
  console.log(`Evidence: ${OUT}`)
  if (checks.some((c) => !c.pass)) process.exitCode = 1
} catch (e) {
  save('harness-error.txt', e.stack || String(e))
  console.error(e)
  process.exitCode = 1
} finally {
  await browser?.close()
  await new Promise((resolve) => server ? server.close(resolve) : resolve())
}
