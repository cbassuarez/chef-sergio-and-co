// End-to-end booking flow on a phone viewport, against the prototype's mock API (docs/BOOKING.md, phase 1):
// every path from entry point to its status page, plus conflicts, resume-after-cancel, drafts and the waitlist.
// Run after `npm run build`.
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import { serve } from './serve.mjs'

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const OUT = process.env.SHOTS_DIR || '.audit'
fs.mkdirSync(OUT, { recursive: true })
const BASE = 'http://localhost:4323'
const server = await serve(4323)
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true })
const page = await browser.newPage()
// This audit exercises the unconnected prototype; it must never send a real inquiry.
await page.setRequestInterception(true)
page.on('request', (request) => {
  const local = ['localhost', '127.0.0.1'].includes(new URL(request.url()).hostname)
  if (request.method() === 'POST' && !local) request.abort('blockedbyclient')
  else request.continue()
})
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => results.push(`${ok ? '✓' : '✗'} ${name}${detail ? ` (${detail})` : ''}`)
const card = async () => (await sleep(650), page.$eval('[aria-label="Your request so far"]', (e) => e.textContent.replace(/\s+/g, ' ')))
// Puppeteer's viewport-only scrolling can leave a target behind the sticky header.
// Click the visible action, and fail rather than accidentally activate header booking.
const clickVisible = async (selector) => {
  await page.$eval(selector, e => e.scrollIntoView({ block: 'center', behavior: 'instant' }))
  await page.waitForFunction((s) => {
    const el = document.querySelector(s), r = el?.getBoundingClientRect()
    if (!el || !r) return false
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    return hit === el || el.contains(hit)
  }, {}, selector)
  await page.click(selector)
}
const cont = async () => (await clickVisible('form button[type=submit].cta-link--primary'), sleep(450))
const stepIs = () => page.$eval('[data-step]', (e) => Number(e.dataset.step))
const text = (sel) => page.$eval(sel, (e) => e.textContent.replace(/\s+/g, ' ').trim()).catch(() => '')
const clickText = (sel, t) => page.evaluate((s, t) => [...document.querySelectorAll(s)].find((e) => e.textContent.trim() === t)?.click(), sel, t)
const go = (path) => page.goto(BASE + path, { waitUntil: 'networkidle0' })
const navClick = async (sel) => Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), clickVisible(sel)])
const contact = async () => {
  await page.type('#f-name', 'Test Visitor')
  await page.type('#f-email', 'test@example.com')
  await page.type('#f-phone', '4075550100')
}
const t0 = Date.now()
let fatalError

try {
// ---------- A. Dinner: month from the hero → suggested open date → deposit → test checkout → Held ----------
await go('/book/?type=dinner&guests=6&when=next')
await page.evaluate(() => localStorage.clear())
await go('/book/?type=dinner&guests=6&when=next')
await page.waitForSelector('[data-calendar] button[aria-pressed="true"]', { timeout: 5000 }).catch(() => {})
const sel = await page.$eval('[data-calendar] button[aria-pressed="true"]', (e) => e.dataset.date).catch(() => '')
const nextMonth = (() => {
  const d = new Date()
  d.setMonth(d.getMonth() + 1, 1)
  return d.toISOString().slice(0, 7)
})()
check('a month from the hero opens next month with an open weekend date suggested', sel.startsWith(nextMonth) && [5, 6].includes(new Date(sel + 'T12:00').getDay()) && !!(await page.$('#f-date-hint')), sel)
check('the suggested date comes with a start time and marked flexible', (await page.$$eval('#f-time [role=radio][aria-checked=true]', (e) => e.length)) === 1 && (await page.$eval('#f-flex', (e) => e.getAttribute('data-state'))) === 'checked')
const closed = await page.$$eval('[data-calendar] [role=group] span[aria-hidden]', (e) => e.filter((x) => /^\d+$/.test(x.textContent)).length)
check('only open days are buttons (closed days are not clickable)', closed > 0, `${closed} closed days shown as text`)
await cont()
check('missing place is the only error', (await page.$$eval('[id$=-err]', (e) => e.map((x) => x.id))).join() === 'f-place-err', await text('#f-place-err'))
await page.type('#f-place', 'Winter Park')
await cont()
await page.select('#f-occasion', 'Anniversary')
await page.click('[id="dish-Lobster Bisque"]')
await cont()
const money = await text('[data-money-line]')
check('review says exactly what is paid now', /deposit now to hold/.test(money) && /taken off your final bill/.test(money), money.slice(0, 120))
check('the button says what happens', (await text('form button[type=submit].cta-link--primary')) === 'Hold the date')
await contact()
await navClick('form button[type=submit].cta-link--primary')
check('holding the date opens checkout', page.url().includes('/book/pay/?ref='), page.url())
await navClick('a[href*="resume=1"]')
check('backing out of checkout returns to the review with everything kept', (await stepIs()) === 3 && (await page.$eval('#f-name', (e) => e.value)) === 'Test Visitor')
await navClick('form button[type=submit].cta-link--primary')
await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), clickText('button', 'Pay (test)')])
await page.waitForSelector('[data-stamp]')
check('payment lands on the held page in the site’s own look', (await text('h1')) === 'Your date is held' && (await text('[data-stamp]')) === 'Held', await text('h1'))
check('the held page offers add-to-calendar', !!(await page.$('a[download][href^="data:text/calendar"]')))
await page.screenshot({ path: `${OUT}/flow_held_phone.png`, fullPage: true })

// ---------- B. The held date is gone for everyone else ----------
await go(`/book/?type=dinner&date=${sel}`)
await page.waitForSelector('[data-calendar] button')
check('a held date is no longer offered', !(await page.$(`[data-calendar] button[data-date="${sel}"]`)), sel)

// ---------- C. Sergio's table: meters → reserve → card saved → confirmed when the minimum is reached ----------
await go('/sergios-table/')
await page.waitForSelector('[data-seat-meter]')
const meters = await page.$$eval('[data-seat-meter] p:first-of-type', (e) => e.map((x) => x.textContent))
check('nights show seats against the minimum, confirmed and full states', meters.length === 3 && /4 of 6 seats needed to confirm/.test(meters[0]) && /^Confirmed\./.test(meters[1]) && /^Full\./.test(meters[2]), meters.join(' | '))
await page.type('[data-night]:last-child input[type=email]', 'wait@example.com')
await clickText('[data-night]:last-child button', 'Join the waitlist')
await sleep(500)
check('a full night takes waitlist emails', /on the waitlist/.test(await text('[data-night]:last-child [role=status]')))
await navClick('[data-night]:first-child a.cta-link--primary')
check('Reserve seats opens the flow on the night, already chosen', (await stepIs()) === 1 && (await page.$$eval('[data-night][data-state=checked]', (e) => e.length)) === 1, page.url())
await cont()
check('the food step shows the night’s menu', /The menu:/.test(await text('[data-step]')))
await cont()
const seatMoney = await text('[data-money-line]')
check('review explains: card saved, charged when confirmed, cancelled at cutoff otherwise', /card is saved now/.test(seatMoney) && /when the night is confirmed/.test(seatMoney) && /cancelled and you're not charged/.test(seatMoney), seatMoney.slice(0, 140))
await contact()
check('the button reserves seats', (await text('form button[type=submit].cta-link--primary')) === 'Reserve 2 seats')
await navClick('form button[type=submit].cta-link--primary')
await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), clickText('button', 'Save card (test)')])
await page.waitForSelector('[data-stamp]')
check('2 seats bring the night (4 of 6) to its minimum, so it confirms', (await text('h1')) === 'The night is confirmed' && (await text('[data-stamp]')) === 'Confirmed', await text('h1'))
await go('/sergios-table/')
await page.waitForSelector('[data-seat-meter]')
check('the night’s meter updates after booking', /^Confirmed\. 4 seats left\./.test((await page.$$eval('[data-seat-meter] p:first-of-type', (e) => e.map((x) => x.textContent)))[0]))

// ---------- D. Small event: request, no payment ----------
await go('/book/?type=event')
await page.waitForSelector('[data-calendar] button[data-date]')
await page.click('[data-calendar] button[data-date]')
await sleep(200)
await page.click('#f-time [role=radio]')
await page.click('#f-guests', { clickCount: 3 })
await page.type('#f-guests', '15')
await page.type('#f-place', 'Lake Nona')
await cont()
await cont()
check('event review: nothing to pay now', /Nothing to pay now/.test(await text('[data-money-line]')) && (await text('form button[type=submit].cta-link--primary')) === 'Send request')
await contact()
await navClick('form button[type=submit].cta-link--primary')
await page.waitForSelector('[data-stamp]')
check('an event request skips checkout and lands on Requested', page.url().includes('/book/done/') && (await text('h1')) === 'Request sent' && (await text('[data-stamp]')) === 'Requested')

// ---------- E. Validation and drafts ----------
await go('/book/?type=dinner')
await page.waitForSelector('[data-calendar] button[data-date]')
await page.click('[data-calendar] button[data-date]')
await page.type('#f-guests', '15')
await cont()
check('15 guests on a private dinner points to a small event', /small event/.test(await text('#f-guests-err')))
await go('/book/')
check('an unfinished request offers to continue', /unfinished request/.test(await text('form [role=status]')))
await clickText('button', 'Continue it')
await sleep(400)
check('continuing restores the step and answers', (await stepIs()) === 1 && (await page.$eval('#f-guests', (e) => e.value)) === '15')
await page.evaluate(() => localStorage.removeItem('booking-draft'))

// ---------- F. Hero and handoffs (kept from the home-hero work) ----------
// The chosen homepage has one visible hero; its primary inquiry leaves format choice to the existing flow.
await page.goto('http://localhost:4323/', { waitUntil: 'networkidle0' })
const home = await page.evaluate(() => {
  const h1s = [...document.querySelectorAll('h1')].filter((e) => e.offsetParent !== null)
  const h1 = h1s[0]
  return { count: h1s.length, text: h1?.innerText.replace(/\s+/g, ' ').trim(), selected: !!h1?.closest('[data-home-hero]'), overflow: document.documentElement.scrollWidth > innerWidth }
})
check('selected homepage has one readable conventional hero', home.count === 1 && home.selected && home.text === 'Dinner at home. Be a guest.' && !home.overflow, home.text)
await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.click('[data-home-hero] [data-hero-cta]')])
check('primary inquiry opens the existing format question without defaults', (await stepIs()) === 0 && new URL(page.url()).search === '' && (await page.$$eval('form [role=radio][aria-checked=true]', (els) => els.length)) === 0, page.url())

// Service handoff choices answer format only; dates and guest counts remain the visitor's choice.
for (const format of ['dinner', 'class', 'event']) {
  await page.goto('http://localhost:4323/', { waitUntil: 'networkidle0' })
  const selector = `[data-home-handoff] [data-service-inquiry][data-format="${format}"]`
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.click(selector)])
  await page.waitForSelector('#f-date')
  const summary = await card()
  const values = await page.evaluate(() => ({ date: document.querySelector('#f-date').value, guests: document.querySelector('#f-guests').value, text: document.querySelector('[aria-label="Your request so far"]').textContent }))
  const labels = { dinner: /private dinner/i, class: /cooking class/i, event: /gathering/i }
  check(`${format} handoff preselects the format in the existing booking flow`, new URL(page.url()).searchParams.get('type') === format && (await stepIs()) === 1 && labels[format].test(summary), page.url())
  check(`${format} handoff leaves date and guest count blank`, values.date === '' && values.guests === '', `date=${values.date || '(blank)'}, guests=${values.guests || '(blank)'}`)
}

// Explicit booking links still support date and guest prefills.
await page.goto('http://localhost:4323/book/?type=class&guests=4&date=2026-12-20', { waitUntil: 'networkidle0' })
check('explicit booking params prefill date and guests', (await page.$eval('#f-date', (e) => e.value)) === '2026-12-20' && (await page.$eval('#f-guests', (e) => e.value)) === '4')
check('scripted completion time', true, `${((Date.now() - t0) / 1000).toFixed(1)}s for a robot; the human bar is under 3 minutes`)
} catch (error) {
  fatalError = error
  await page.screenshot({ path: `${OUT}/flow_failure_phone.png`, fullPage: true }).catch(() => {})
  console.error(JSON.stringify(await page.evaluate(() => ({ url: location.href, step: document.querySelector('[data-step]')?.getAttribute('data-step'), errors: [...document.querySelectorAll('[id$="-err"]')].map(e => e.textContent), submit: document.querySelector('form button[type=submit].cta-link--primary')?.textContent })).catch(() => ({})), null, 2))
} finally {
  await browser.close()
  await new Promise(resolve => server.close(resolve))
}
console.log(results.join('\n'))
if (fatalError) throw fatalError
if (results.some((r) => r.startsWith('✗'))) process.exit(1)
