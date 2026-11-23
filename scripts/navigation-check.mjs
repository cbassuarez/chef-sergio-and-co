// Focused checks for selected B navigation. NAV_BASE_URL uses an already-owned preview;
// otherwise DIST_DIR and NAVIGATION_PORT select a separately owned static preview.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import puppeteer from 'puppeteer-core'
import { serve } from './serve.mjs'

const require = createRequire(import.meta.url)
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = Number(process.env.NAVIGATION_PORT) || 4356
const EXTERNAL = process.env.NAV_BASE_URL
const ORIGIN = (EXTERNAL || `http://127.0.0.1:${PORT}`).replace(/\/$/, '')
const OUTPUT = path.resolve(process.env.NAV_OUTPUT_DIR || process.env.SHOTS_DIR || 'output/header-b-implementation')
const HEADER = 'header[data-site-header]'
const TOGGLE = `${HEADER} [data-site-navigation-toggle]`
const PANEL = '#site-navigation-overview'
const CLOSE = `${HEADER} [data-site-navigation-close]`
const DATE = `${HEADER} .sergio-header-controls a[href$="/book/"]`
const BOOKING_LABEL = 'Start planning'
const BOOKING_HINT = `${DATE} .sergio-header-booking-hint`
const rows = []
const axeResults = []
const errors = []
const pass = (label, ok, detail = '') => rows.push({ label, pass: !!ok, detail })
const serviceRoutes = [
  { path: '/privatedining/', label: 'Private dinners' },
  { path: '/cookingclasses/', label: 'Cooking classes' },
  { path: '/catering/', label: 'Small events' },
]
const source = fs.readFileSync(new URL('../src/content/site.ts', import.meta.url), 'utf8')
const tableEnabled = /sergiosTable:\s*true/.test(source)
const navRoutes = [...serviceRoutes, ...(tableEnabled ? [{ path: '/sergios-table/', label: "Sergio's table" }] : []),
  { path: '/about/', label: 'About Sergio' }, { path: '/gift/', label: 'Gift cards' }]
const waitFrame = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))

function watch(page, label) {
  page.on('pageerror', error => errors.push({ label, error: error.message }))
  page.on('console', message => {
    if (message.type() === 'error' && !/favicon\.ico/.test(message.location().url || '')) errors.push({ label, error: message.text() })
  })
}

async function goto(page, route = '/') {
  const response = await page.goto(`${ORIGIN}${route}`, { waitUntil: 'networkidle0' })
  await page.evaluate(() => document.fonts.ready)
  pass(`${route}: served successfully`, response?.status() === 200, `HTTP ${response?.status()}`)
}

async function visibleToggle(page) {
  for (const handle of await page.$$(TOGGLE)) {
    if (await handle.evaluate(element => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden')) return handle
  }
  throw new Error('No visible B navigation trigger')
}

async function openPanel(page, key = 'Enter') {
  const toggle = await visibleToggle(page)
  await toggle.focus()
  await page.keyboard.press(key)
  await page.waitForSelector(PANEL, { visible: true })
  await waitFrame(page)
  // Sample the settled design; an entering fade temporarily changes computed contrast.
  await page.$eval(PANEL, element => Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {}))))
  return toggle
}

async function isClosed(page) {
  return page.$eval(PANEL, element => element.hidden)
}

async function expandedMatches(page, open) {
  return page.$$eval(TOGGLE, (elements, state) => elements.length === 2 && elements.every(element => element.getAttribute('aria-expanded') === String(state) && element.getAttribute('aria-controls') === 'site-navigation-overview'), open)
}

async function audit(page, label, selectors = [HEADER]) {
  if (!await page.evaluate(() => !!window.axe)) await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') })
  const result = await page.evaluate(async selectors => {
    const { violations, incomplete } = await window.axe.run({ include: selectors.map(selector => [selector]) }, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] },
    })
    return { violations, incomplete }
  }, selectors)
  axeResults.push({ label, ...result })
  pass(`${label}: targeted WCAG A/AA axe`, result.violations.length === 0,
    result.violations.map(item => `${item.id}: ${item.nodes.map(node => node.target.join(' ')).join(', ')}`).join('; '))
}

async function checkPanelLinks(page, label) {
  const links = await page.$$eval(`${PANEL} a[href]`, elements => elements.map(element => ({
    path: new URL(element.href).pathname, href: element.getAttribute('href'), text: element.textContent.replace(/\s+/g, ' ').trim(),
  })))
  pass(`${label}: every real service and supporting destination is directly available`, navRoutes.every(item => links.some(link => link.path.endsWith(item.path))), links.map(link => link.path).join(', '))
  pass(`${label}: service choices carry their real labels`, serviceRoutes.every(item => links.some(link => link.path.endsWith(item.path) && link.text.startsWith(item.label))))
  pass(`${label}: phone contact remains available`, links.some(link => /^tel:\+14077573009$/.test(link.href || '')))
  pass(`${label}: no nested service disclosure`, await page.$eval(PANEL, element => !element.querySelector('details, [role="menu"], [aria-haspopup="menu"]')))
}

async function checkClosedGeometry(page, label) {
  const geometry = await page.evaluate(({ header, toggle, date }) => {
    const bounds = element => {
      if (!element) return null
      const rect = element.getBoundingClientRect()
      return { text: element.textContent.replace(/\s+/g, ' ').trim(), x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom }
    }
    const visible = selector => [...document.querySelectorAll(selector)].filter(element => element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden')
    const targets = visible(`${header} .sergio-header-brand, ${toggle}, ${date}`).map(bounds)
    return {
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
      targets, dateCount: visible(date).length, triggerCount: visible(toggle).length,
      bottomBar: !!document.querySelector('[data-mobile-bar]'),
      heading: bounds(document.querySelector('[data-home-hero] h1')),
      descriptionSize: Number.parseFloat(getComputedStyle(document.querySelector('.home-description')).fontSize),
    }
  }, { header: HEADER, toggle: TOGGLE, date: DATE })
  pass(`${label}: header targets fit and provide at least 44px hit areas`, !geometry.overflow && geometry.targets.length === 3 && geometry.targets.every(rect => rect.width >= 44 && rect.height >= 44 && rect.x >= -1 && rect.right <= page.viewport().width + 1), JSON.stringify(geometry.targets))
  pass(`${label}: one visible trigger and persistent date link`, geometry.triggerCount === 1 && geometry.dateCount === 1)
  pass(`${label}: previous duplicate mobile booking bar is absent`, !geometry.bottomBar)
  pass(`${label}: hero copy remains readable and fits horizontally`, geometry.heading && geometry.heading.width > 0 && geometry.heading.x >= -1 && geometry.heading.right <= page.viewport().width + 1 && geometry.descriptionSize >= 16)
}

async function checkBookingIcon(page, label) {
  const icon = await page.$eval(DATE, element => {
    const svg = element.querySelector('svg.icon-calendar-days'), rect = element.getBoundingClientRect()
    const directText = [...element.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent).join('').trim()
    const visibleLabels = [...element.children].filter(child => child.tagName.toLowerCase() !== 'svg' && child.getAttribute('aria-hidden') !== 'true' && child.getClientRects().length && getComputedStyle(child).visibility !== 'hidden').map(child => child.textContent.trim()).filter(Boolean)
    return {
      tag: element.tagName, href: new URL(element.href).pathname, label: element.getAttribute('aria-label'),
      svgCount: element.querySelectorAll('svg').length, calendar: !!svg,
      decorative: svg?.getAttribute('aria-hidden') === 'true' && svg?.getAttribute('focusable') === 'false',
      directText, visibleLabels, width: rect.width, height: rect.height,
      primary: element.classList.contains('cta-link--primary'),
    }
  })
  const accessibility = await page.accessibility.snapshot({ root: await page.$(DATE), interestingOnly: false })
  pass(`${label}: calendar link has a meaningful browser accessibility name`, icon.tag === 'A' && icon.href.endsWith('/book/') && icon.label === BOOKING_LABEL && accessibility?.role === 'link' && accessibility?.name === BOOKING_LABEL, JSON.stringify(accessibility))
  pass(`${label}: booking action is icon only with a decorative calendar`, icon.calendar && icon.svgCount === 1 && icon.decorative && !icon.directText && icon.visibleLabels.length === 0)
  pass(`${label}: booking icon retains the primary CTA and a 48px square target`, icon.primary && icon.width >= 48 && icon.height >= 48 && Math.abs(icon.width - icon.height) <= 1, `${icon.width}x${icon.height}`)
}

async function checkExpandedIconActions(page, label) {
  for (const action of [
    { selector: CLOSE, name: 'Close navigation', icon: 'x', tag: 'BUTTON', role: 'button' },
    { selector: `${PANEL} a[href^="tel:"]`, name: 'Call Sergio at (407) 757-3009', icon: 'phone', tag: 'A', role: 'link' },
  ]) {
    const state = await page.$eval(action.selector, (element, expectedIcon) => {
      const svg = element.querySelector(`svg.icon-${expectedIcon}`), rect = element.getBoundingClientRect()
      const directText = [...element.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent).join('').trim()
      const visibleLabels = [...element.children].filter(child => child.tagName.toLowerCase() !== 'svg' && child.getAttribute('aria-hidden') !== 'true' && child.getClientRects().length && getComputedStyle(child).visibility !== 'hidden').map(child => child.textContent.trim()).filter(Boolean)
      return { tag: element.tagName, label: element.getAttribute('aria-label'), width: rect.width, height: rect.height, directText, visibleLabels,
        decorative: !!svg && element.querySelectorAll('svg').length === 1 && svg.getAttribute('aria-hidden') === 'true' && svg.getAttribute('focusable') === 'false' }
    }, action.icon)
    const ax = await page.accessibility.snapshot({ root: await page.$(action.selector), interestingOnly: false })
    pass(`${label}: ${action.name} remains a correctly named native ${action.role}`, state.tag === action.tag && state.label === action.name && ax?.role === action.role && ax?.name === action.name, JSON.stringify(ax))
    pass(`${label}: ${action.name} uses only its decorative icon and a 48px square target`, state.decorative && !state.directText && state.visibleLabels.length === 0 && state.width >= 48 && state.height >= 48 && Math.abs(state.width - state.height) <= 1, `${state.width}x${state.height}`)
  }
}

async function waitHint(page, visible, selector = BOOKING_HINT) {
  await page.waitForFunction(({ selector, visible }) => {
    const element = document.querySelector(selector)
    if (!element) return false
    const style = getComputedStyle(element)
    const shown = element.getClientRects().length > 0 && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) >= .99
    return shown === visible
  }, {}, { selector, visible })
}

async function checkActionHintBounds(page, label) {
  await page.mouse.move(1, 1)
  await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }))
  await openPanel(page)
  for (const action of [
    { selector: CLOSE, name: 'Close navigation' },
    { selector: `${PANEL} a[href^="tel:"]`, name: 'Call Sergio' },
    { selector: DATE, name: BOOKING_LABEL },
  ]) {
    await page.focus(action.selector)
    const hintSelector = `${action.selector} [data-header-action-hint]`
    await waitHint(page, true, hintSelector)
    await waitFrame(page)
    const state = await page.$eval(hintSelector, element => {
      const rect = element.getBoundingClientRect()
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: innerWidth, height: innerHeight,
        visible: !element.hidden && rect.width > 0 && rect.height > 0,
        fits: rect.left >= -1 && rect.right <= innerWidth + 1 && rect.top >= -1 && rect.bottom <= innerHeight + 1 }
    })
    pass(`${label}: ${action.name} hint stays within the viewport when focused`, state.visible && state.fits, JSON.stringify(state))
    if (action.name === 'Call Sergio') await page.screenshot({ path: path.join(OUTPUT, `call-hint-${page.viewport().width}.png`) })
    await page.keyboard.press('Escape')
    await waitHint(page, false, hintSelector)
    pass(`${label}: Escape dismisses ${action.name} hint while retaining focus and the overview`, !await isClosed(page) && await page.$eval(action.selector, element => document.activeElement === element))
  }
  await page.keyboard.press('Escape')
  await waitFrame(page)
}

async function checkKeyboardReach(page, label) {
  // Start at the panel's first control. Normal Tab order must reach every panel
  // control, then leave the header and dismiss it rather than cycle as a modal.
  const focusable = `${PANEL} a[href], ${PANEL} button:not([disabled])`
  const total = await page.$$eval(focusable, elements => elements.filter(element => element.getClientRects().length).length)
  const first = await page.$(focusable)
  await first.focus()
  const visited = new Set()
  const failures = []
  let exited = false
  for (let index = 0; index <= total + 2; index++) {
    await waitFrame(page)
    const state = await page.evaluate(({ selector, header }) => {
      const elements = [...document.querySelectorAll(selector)].filter(element => element.getClientRects().length)
      const active = document.activeElement
      const rect = active.getBoundingClientRect()
      const panel = document.getElementById('site-navigation-overview').getBoundingClientRect()
      return {
        index: elements.indexOf(active), label: active.textContent.replace(/\s+/g, ' ').trim(),
        inHeader: document.querySelector(header).contains(active), width: rect.width, height: rect.height,
        visible: rect.top >= Math.max(panel.top, 0) - 1 && rect.bottom <= Math.min(panel.bottom, innerHeight) + 1 && rect.left >= -1 && rect.right <= innerWidth + 1,
      }
    }, { selector: focusable, header: HEADER })
    if (!state.inHeader) { exited = true; break }
    if (state.index >= 0) {
      visited.add(state.index)
      if (!state.visible || state.width < 44 || state.height < 44) failures.push(`${state.label}: ${Math.round(state.width)}x${Math.round(state.height)}, visible=${state.visible}`)
    }
    await page.keyboard.press('Tab')
  }
  pass(`${label}: keyboard reaches every panel control within its scrollport`, total > 0 && visited.size === total && failures.length === 0, failures.join('; ') || `${visited.size}/${total} controls`)
  pass(`${label}: Tab continues into the page without trapping focus`, exited)
  await waitFrame(page)
  pass(`${label}: leaving the header dismisses the panel`, await isClosed(page))
}

fs.mkdirSync(OUTPUT, { recursive: true })
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'chef-header-calendar-nav-'))
let server, browser
try {
  if (!EXTERNAL) server = await serve(PORT)
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true, userDataDir: profile })
  const sizes = [
    { label: 'desktop', width: 1440, height: 900 },
    { label: 'phone', width: 390, height: 844 },
    { label: 'compact phone', width: 320, height: 568 },
    { label: 'landscape', width: 667, height: 375 },
  ]
  for (const size of sizes) {
    const context = await browser.createBrowserContext()
    const page = await context.newPage()
    watch(page, size.label)
    await page.setViewport({ width: size.width, height: size.height, deviceScaleFactor: 1 })
    await goto(page)
    await checkClosedGeometry(page, size.label)
    await checkBookingIcon(page, size.label)
    pass(`${size.label}: panel starts hidden with accurate expanded states`, await isClosed(page) && await expandedMatches(page, false))
    const trigger = await visibleToggle(page)
    const triggerText = await trigger.evaluate(element => element.textContent.trim())
    pass(`${size.label}: correct responsive trigger wording`, triggerText === (size.width <= 700 ? 'Explore' : 'Experiences'), triggerText)
    await audit(page, `${size.label} closed header`, [HEADER, 'footer'])
    await page.screenshot({ path: path.join(OUTPUT, `navigation-${size.width}-closed.png`) })
    const before = await page.$eval('[data-home-hero]', element => element.getBoundingClientRect().top)
    const overflowBefore = await page.evaluate(() => ({ html: document.documentElement.style.overflow, body: document.body.style.overflow }))
    const opener = await openPanel(page, size.width <= 700 ? 'Space' : 'Enter')
    pass(`${size.label}: keyboard opens one nonmodal overview`, await expandedMatches(page, true) && await page.$(`${HEADER} [role="dialog"], ${HEADER} dialog`) === null)
    const opened = await page.evaluate(() => {
      const panel = document.getElementById('site-navigation-overview'), bounds = panel.getBoundingClientRect()
      return { html: document.documentElement.style.overflow, body: document.body.style.overflow,
        heroTop: document.querySelector('[data-home-hero]').getBoundingClientRect().top,
        panelHeight: bounds.height, horizontal: panel.scrollWidth > panel.clientWidth + 1 || document.documentElement.scrollWidth > innerWidth + 1,
        bounded: bounds.top >= -1 && bounds.bottom <= innerHeight + 1,
      }
    })
    pass(`${size.label}: opening moves the hero down without locking page scroll`, opened.heroTop > before + 20 && opened.html === overflowBefore.html && opened.body === overflowBefore.body)
    pass(`${size.label}: overview fits the viewport horizontally and vertically`, !opened.horizontal && opened.bounded, JSON.stringify(opened))
    await checkPanelLinks(page, size.label)
    await checkExpandedIconActions(page, size.label)
    await audit(page, `${size.label} expanded header`)
    await page.screenshot({ path: path.join(OUTPUT, `navigation-${size.width}-open.png`) })
    await page.focus(`${PANEL} a[href$="/privatedining/"]`)
    await page.keyboard.press('Escape')
    await waitFrame(page)
    pass(`${size.label}: Escape closes and restores the visible opener`, await isClosed(page) && await opener.evaluate(element => document.activeElement === element) && await expandedMatches(page, false))
    await openPanel(page)
    await page.click(CLOSE)
    await waitFrame(page)
    pass(`${size.label}: Close restores the opener`, await isClosed(page) && await opener.evaluate(element => document.activeElement === element))
    await openPanel(page)
    await page.focus('main [data-hero-cta]')
    await waitFrame(page)
    pass(`${size.label}: focus outside closes without stealing focus`, await isClosed(page) && await page.$eval('main [data-hero-cta]', element => document.activeElement === element))
    await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }))
    await openPanel(page)
    await checkKeyboardReach(page, size.label)
    await page.evaluate(() => scrollTo({ top: 500, behavior: 'instant' }))
    await waitFrame(page)
    pass(`${size.label}: date action stays visible after scrolling`, await page.$eval(DATE, element => { const rect = element.getBoundingClientRect(); return rect.top >= -1 && rect.bottom <= innerHeight + 1 && rect.width > 0 }))
    await checkActionHintBounds(page, size.label)
    await context.close()
  }

  {
    const context = await browser.createBrowserContext()
    const page = await context.newPage()
    watch(page, 'dismissal and responsive change')
    await page.setViewport({ width: 1440, height: 900 })
    await goto(page)
    await openPanel(page)
    await page.focus(`${PANEL} a[href$="/privatedining/"]`)
    await page.click('main h1')
    await waitFrame(page)
    pass('outside pointer dismisses the overview', await isClosed(page) && await expandedMatches(page, false))
    pass('clicking nonfocusable page text does not leave focus in hidden navigation', await page.$eval(PANEL, element => !element.contains(document.activeElement)))
    await page.keyboard.press('Tab')
    await waitFrame(page)
    pass('Tab after outside text click reaches a displayed control', await page.$eval(PANEL, element => !element.contains(document.activeElement) && document.activeElement.getClientRects().length > 0))
    await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }))
    await openPanel(page)
    await page.setViewport({ width: 390, height: 844 })
    await waitFrame(page)
    pass('crossing the 700px breakpoint resets expanded state', await isClosed(page) && await expandedMatches(page, false))
    await openPanel(page)
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }])
    const reduced = await page.$eval(PANEL, element => { const style = getComputedStyle(element); return { animation: style.animationName, transform: style.transform, transition: style.transitionDuration } })
    pass('reduced motion disables overview movement', reduced.animation === 'none' && reduced.transform === 'none' && reduced.transition.split(',').every(value => Number.parseFloat(value) === 0), JSON.stringify(reduced))
    await page.keyboard.press('Escape')
    const dateHref = await page.$eval(DATE, element => element.href)
    await page.focus(DATE)
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.keyboard.press('Enter')])
    pass('persistent date action reaches the existing booking screen', new URL(page.url()).pathname.endsWith('/book/') && await page.$eval('main h1', element => element.textContent.trim() === 'Check your date'), dateHref)
    await context.close()
  }

  {
    const context = await browser.createBrowserContext()
    const page = await context.newPage()
    watch(page, 'booking hint interaction')
    await page.setViewport({ width: 1440, height: 900 })
    await goto(page)
    await page.hover(DATE)
    await waitHint(page, true)
    const hint = await page.$eval(BOOKING_HINT, element => {
      const rect = element.getBoundingClientRect()
      return { text: element.textContent.trim(), decorative: element.getAttribute('aria-hidden') === 'true', fits: rect.left >= -1 && rect.right <= innerWidth + 1 && rect.top >= -1 && rect.bottom <= innerHeight + 1 }
    })
    pass('hover explains the booking icon without duplicating its accessible name', hint.text === BOOKING_LABEL && hint.decorative && hint.fits, JSON.stringify(hint))
    await page.screenshot({ path: path.join(OUTPUT, 'booking-icon-hover.png') })
    await page.hover(`${BOOKING_HINT} > span`)
    await waitHint(page, true)
    pass('pointer can enter the booking explanation without dismissing it', await page.$eval(BOOKING_HINT, element => !element.hidden))
    await page.mouse.move(1, 1)
    await waitHint(page, false)
    await page.focus(DATE)
    await waitHint(page, true)
    pass('keyboard focus reveals the booking explanation', await page.$eval(DATE, element => document.activeElement === element))
    await page.screenshot({ path: path.join(OUTPUT, 'booking-icon-focus.png') })
    await page.keyboard.press('Escape')
    await waitHint(page, false)
    pass('Escape dismisses the booking hint without blurring the link', await page.$eval(DATE, element => document.activeElement === element))
    const opener = await openPanel(page)
    await page.focus(DATE)
    await waitHint(page, true)
    await page.keyboard.press('Escape')
    await waitHint(page, false)
    pass('first Escape on the icon dismisses its hint and retains the open overview', !await isClosed(page) && await page.$eval(DATE, element => document.activeElement === element))
    await page.keyboard.press('Escape')
    await waitFrame(page)
    pass('second Escape closes the overview and restores its visible trigger', await isClosed(page) && await opener.evaluate(element => document.activeElement === element))
    await context.close()
  }

  {
    const context = await browser.createBrowserContext()
    const page = await context.newPage()
    watch(page, 'touch booking icon')
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 1 })
    await goto(page)
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.tap(DATE)])
    pass('touch activates the calendar directly into the existing booking screen', new URL(page.url()).pathname.endsWith('/book/') && await page.$eval('main h1', element => element.textContent.trim() === 'Check your date'))
    await context.close()
  }

  {
    const context = await browser.createBrowserContext()
    const page = await context.newPage()
    watch(page, 'route current states')
    await page.setViewport({ width: 1440, height: 900 })
    for (const route of navRoutes) {
      await goto(page, route.path)
      await openPanel(page)
      const current = await page.$$eval(`${HEADER} [aria-current="page"]`, elements => elements.filter(element => element.getClientRects().length).map(element => ({ path: new URL(element.href).pathname, text: element.textContent.replace(/\s+/g, ' ').trim() })))
      pass(`${route.path}: visible current links identify only this route`, current.length > 0 && current.every(item => item.path.endsWith(route.path)), JSON.stringify(current))
      pass(`${route.path}: no horizontal overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    }
    await page.screenshot({ path: path.join(OUTPUT, 'navigation-current-gift-route.png') })
    await context.close()
  }

  for (const width of [1440, 320]) {
    const context = await browser.createBrowserContext()
    const page = await context.newPage()
    watch(page, `no-JS ${width}`)
    await page.setJavaScriptEnabled(false)
    await page.setViewport({ width, height: width === 320 ? 568 : 900 })
    await goto(page)
    const links = await page.$$eval('.sergio-header-fallback a[href]', elements => elements.map(element => ({ path: new URL(element.href).pathname, visible: !!element.getClientRects().length })))
    pass(`no-JS ${width}: fallback exposes every service and supporting route`, navRoutes.every(route => links.some(link => link.path.endsWith(route.path) && link.visible)), JSON.stringify(links))
    pass(`no-JS ${width}: phone icon retains its native link and accessible name`, await page.$eval('.sergio-header-fallback a[href^="tel:"]', element => element.getClientRects().length > 0 && element.getAttribute('aria-label') === 'Call Sergio at (407) 757-3009'))
    pass(`no-JS ${width}: date remains a visible real booking link`, await page.$eval(DATE, element => element.getClientRects().length > 0 && new URL(element.href).pathname.endsWith('/book/')))
    pass(`no-JS ${width}: header fits without horizontal overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    const firstService = await page.$('.sergio-header-fallback a[href$="/privatedining/"]')
    await firstService.focus()
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.keyboard.press('Enter')])
    pass(`no-JS ${width}: keyboard follows fallback into private dinners`, new URL(page.url()).pathname.endsWith('/privatedining/'))
    await page.screenshot({ path: path.join(OUTPUT, `navigation-${width}-no-javascript.png`) })
    await context.close()
  }
} catch (error) {
  pass('navigation browser check completes', false, error.stack || String(error))
} finally {
  if (browser) await browser.close()
  if (server) await new Promise(resolve => server.close(resolve))
  fs.rmSync(profile, { recursive: true, force: true })
  pass('navigation generated no console, hydration or page errors', errors.length === 0, JSON.stringify(errors))
  fs.writeFileSync(path.join(OUTPUT, 'navigation-axe.json'), JSON.stringify(axeResults, null, 2))
  fs.writeFileSync(path.join(OUTPUT, 'navigation-results.json'), JSON.stringify({ origin: ORIGIN, checkedAt: new Date().toISOString(), rows, errors, voiceOver: 'NOT RUN', guestTesting: 'NOT RUN' }, null, 2))
}
console.log(rows.map(row => `${row.pass ? '✓' : '✗'} ${row.label}${row.detail ? ` (${row.detail})` : ''}`).join('\n'))
const failures = rows.filter(row => !row.pass).length
if (failures) {
  console.error(`\n✗ navigation check: ${failures} failure(s)`)
  process.exitCode = 1
} else console.log(`\n✓ navigation check passed (${rows.length} assertions)`)
