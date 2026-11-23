// Browser proof for below-fold photo scheduling. Uses the existing build; never builds or mutates dist/.
// DIST_DIR selects a build snapshot; SHOTS_DIR selects the browser-capture directory.
import fs from 'node:fs'
import path from 'node:path'
import puppeteer from 'puppeteer-core'
import { serve } from './serve.mjs'

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = Number(process.env.DEFERRED_IMAGES_PORT) || 4352
const ORIGIN = `http://localhost:${PORT}`
const SHOTS = process.env.SHOTS_DIR || '.audit'
const DEFERRED = 'img[data-deferred-photo]'
const VIEWPORT = { width: 412, height: 823, isMobile: true, hasTouch: true, deviceScaleFactor: 1.75 }
const rows = []
const pass = (label, ok, detail = '') => rows.push(`${ok ? '✓' : '✗'} ${label}${detail ? ` (${detail})` : ''}`)

function watch(page) {
  const errors = []
  const requests = []
  page.on('pageerror', (error) => errors.push(`page: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    const source = message.location().url || ''
    // Chrome's automatic favicon request is unrelated to photo loading or hydration.
    if (new URL(source || ORIGIN).pathname === '/favicon.ico') return
    errors.push(`console: ${message.text()}${source ? ` [${source}]` : ''}`)
  })
  page.on('request', (request) => {
    if (request.resourceType() === 'image' && /^https?:/.test(request.url())) requests.push(request.url())
  })
  return { errors, requests }
}

async function open(page) {
  await page.setViewport(VIEWPORT)
  await page.goto(`${ORIGIN}/`, { waitUntil: 'networkidle0' })
  await page.evaluate(() => document.fonts.ready)
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) })
}

// Approach a photo vertically while bringing horizontal gallery items into the visible column.
// Stop 200px before the viewport: a successful load here proves that scrolling reveals a ready photo.
async function approach(page, selector, index) {
  return page.evaluate(({ selector, index }) => {
    const image = document.querySelectorAll(selector)[index]
    for (let parent = image.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent)
      if (/(auto|scroll)/.test(style.overflowX) && parent.scrollWidth > parent.clientWidth + 1) {
        const imageRect = image.getBoundingClientRect(), parentRect = parent.getBoundingClientRect()
        parent.scrollLeft += imageRect.left - parentRect.left - (parent.clientWidth - imageRect.width) / 2
        break
      }
    }
    const y = image.getBoundingClientRect().top + scrollY
    scrollTo({ top: Math.max(0, y - innerHeight - 200), behavior: 'instant' })
    const rect = image.getBoundingClientRect()
    return { top: rect.top + scrollY, width: rect.width, height: rect.height }
  }, { selector, index })
}

async function waitForImage(page, selector, index) {
  await page.waitForFunction((selector, index) => {
    const image = document.querySelectorAll(selector)[index]
    return image && image.complete && image.naturalWidth > 1 && /^https?:/.test(image.currentSrc || image.src)
  }, { timeout: 10_000 }, selector, index)
}

async function revealAll(page, selector, label, capture = false) {
  const count = await page.$$eval(selector, (images) => images.length)
  for (let index = 0; index < count; index++) {
    const before = await approach(page, selector, index)
    await waitForImage(page, selector, index)
    const after = await page.evaluate(({ selector, index }) => {
      const image = document.querySelectorAll(selector)[index], rect = image.getBoundingClientRect()
      return { top: rect.top + scrollY, viewportTop: rect.top, width: rect.width, height: rect.height, loaded: image.complete && image.naturalWidth > 1, alt: image.alt }
    }, { selector, index })
    const stable = ['top', 'width', 'height'].every((key) => Math.abs(before[key] - after[key]) <= 1)
    pass(`${label}: photo ${index + 1} loads before entering the viewport`, after.loaded && after.viewportTop >= VIEWPORT.height, after.alt)
    pass(`${label}: photo ${index + 1} keeps its reserved dimensions`, stable && before.width > 0 && before.height > 0, `${Math.round(after.width)}×${Math.round(after.height)}`)
    if (capture) {
      await page.evaluate(({ selector, index }) => {
        const image = document.querySelectorAll(selector)[index]
        scrollBy({ top: image.getBoundingClientRect().top - 120, behavior: 'instant' })
      }, { selector, index })
      await shot(page, `deferred-photo-${index + 1}`)
    }
  }
}

fs.mkdirSync(SHOTS, { recursive: true })
let browser, server
try {
  server = await serve(PORT)
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true })

  {
    const context = await browser.createBrowserContext()
    const page = await context.newPage()
    const observed = watch(page)
    await open(page)
    const initial = await page.evaluate((selector) => {
      const images = [...document.querySelectorAll(selector)]
      const fallbackImages = [...document.querySelectorAll('noscript')].flatMap((node) => [...new DOMParser().parseFromString(node.textContent, 'text/html').querySelectorAll('img')])
      const urls = fallbackImages.flatMap((image) => [image.getAttribute('src'), ...(image.getAttribute('srcset') || '').split(',').map((candidate) => candidate.trim().split(/\s+/)[0])])
        .filter(Boolean).map((url) => new URL(url, location.href).href)
      const hero = document.querySelector('[data-home-hero] img')
      return {
        count: images.length, fallbackCount: fallbackImages.length, urls,
        notYetLoaded: images.filter((image) => !/^https?:/.test(image.currentSrc || image.src)).length,
        reserved: images.every((image) => image.getBoundingClientRect().width > 0 && image.getBoundingClientRect().height > 0),
        hero: hero && { loaded: hero.complete && hero.naturalWidth > 1, eager: hero.loading === 'eager', priority: hero.fetchPriority, url: hero.currentSrc || hero.src },
      }
    }, DEFERRED)
    pass('initial mobile load reserves deferred photo space', initial.count > 0 && initial.reserved && initial.fallbackCount === initial.count, `${initial.count} photos`)
    const competing = observed.requests.filter((url) => initial.urls.includes(url))
    pass('initial mobile load requests no deferred photo assets', initial.count > 0 && initial.notYetLoaded === initial.count && competing.length === 0, competing.join(', ') || `${initial.notYetLoaded} deferred`)
    pass('hero photo remains eager, high priority and loaded', initial.hero?.loaded && initial.hero.eager && initial.hero.priority === 'high' && observed.requests.includes(initial.hero.url), initial.hero?.url)
    await shot(page, 'deferred-images-mobile-initial')
    await revealAll(page, DEFERRED, 'normal scrolling', true)
    pass('normal scrolling has no console, hydration or page errors', observed.errors.length === 0, observed.errors.join('; '))
    await context.close()
  }

  {
    const context = await browser.createBrowserContext()
    const page = await context.newPage()
    const observed = watch(page)
    await page.setJavaScriptEnabled(false)
    await open(page)
    const noScript = await page.evaluate((selector) => {
      const placeholders = [...document.querySelectorAll(selector)]
      const photos = [...document.querySelectorAll('noscript img')]
      return {
        count: placeholders.length, nativeCount: photos.length,
        hidden: placeholders.every((image) => getComputedStyle(image).display === 'none' && image.getBoundingClientRect().height === 0),
        native: photos.every((image) => getComputedStyle(image).display !== 'none' && image.getBoundingClientRect().width > 0 && image.getBoundingClientRect().height > 0 && /^https?:/.test(image.src)),
      }
    }, DEFERRED)
    pass('without JavaScript, native photos replace hidden placeholders', noScript.count > 0 && noScript.nativeCount === noScript.count && noScript.hidden && noScript.native, `${noScript.nativeCount} native photos`)
    await revealAll(page, 'noscript img', 'without JavaScript')
    await shot(page, 'deferred-images-no-javascript')
    pass('no-script browsing has no page errors', observed.errors.length === 0, observed.errors.join('; '))
    await context.close()
  }

  {
    const context = await browser.createBrowserContext()
    const page = await context.newPage()
    const observed = watch(page)
    await page.evaluateOnNewDocument(() => { delete window.IntersectionObserver })
    await open(page)
    const fallback = await page.evaluate((selector) => ({
      absent: !('IntersectionObserver' in window),
      count: document.querySelectorAll(selector).length,
      realSources: [...document.querySelectorAll(selector)].every((image) => /^https?:/.test(image.src)),
    }), DEFERRED)
    pass('without IntersectionObserver, every deferred photo gets its real source', fallback.absent && fallback.count > 0 && fallback.realSources, `${fallback.count} photos`)
    await revealAll(page, DEFERRED, 'without IntersectionObserver')
    await shot(page, 'deferred-images-no-observer')
    pass('missing IntersectionObserver causes no console, hydration or page errors', observed.errors.length === 0, observed.errors.join('; '))
    await context.close()
  }
} catch (error) {
  pass('deferred-image browser check completes', false, error.stack || String(error))
} finally {
  if (browser) await browser.close()
  if (server) await new Promise((resolve) => server.close(resolve))
}

console.log(rows.join('\n'))
const failures = rows.filter((row) => row.startsWith('✗')).length
if (failures) {
  console.error(`\n✗ deferred-image check: ${failures} failure(s)`)
  process.exitCode = 1
} else console.log('\n✓ deferred-image check passed')
