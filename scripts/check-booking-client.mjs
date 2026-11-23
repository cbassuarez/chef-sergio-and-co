#!/usr/bin/env node
// Runs the real browser API and calendar formatter through their external contracts.
// Only configuration and browser/network surfaces are supplied by this harness.
import assert from 'node:assert/strict'
import { webcrypto } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = fileURLToPath(new URL('../', import.meta.url))
const savedGlobals = Object.fromEntries(['fetch', 'window', 'sessionStorage', 'setTimeout', 'clearTimeout'].map(key => [key, globalThis[key]]))
if (!globalThis.crypto) globalThis.crypto = webcrypto
let checks = 0
function check(name, assertion) { assertion(); checks++; process.stdout.write(`PASS ${name}\n`) }
let moduleId = 0
async function actualModule(path, apiBase) {
  const output = await build({
    absWorkingDir: root, entryPoints: [path], bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022',
    plugins: apiBase === undefined ? [] : [{ name: 'test-runtime-configuration', setup(builder) {
      builder.onLoad({ filter: /content\/booking\.ts$/ }, () => ({ contents: `export const booking = {apiBase:${JSON.stringify(apiBase)}}`, loader: 'ts' }))
    } }],
  })
  return import('data:text/javascript;base64,' + Buffer.from(output.outputFiles[0].text + `\n// harness-module-${++moduleId}`).toString('base64'))
}
const receipt = { ref: 'CS-contract-check', status: 'requested', kind: 'dinner', date: '2026-12-20', time: '18:00', guests: 2, amount: null, amountWhen: 'after-quote', createdAt: '2026-11-23T16:00:00Z' }
const request = { kind: 'dinner', date: receipt.date, time: receipt.time, guests: receipt.guests, name: 'Contract check', email: 'check@example.test', phone: '4075550100', contactBy: 'email' }
const result = { ref: receipt.ref, next: 'done', url: `https://pages.example.test/book/done/?ref=${receipt.ref}#access=contract-token`, accessToken: 'contract-token' }
const memory = new Map()
const calls = []
function browser(hash = '') {
  globalThis.window = { location: { hash } }
  globalThis.sessionStorage = { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, String(value)) }
}
function observed(url, options) {
  const entry = { url: String(url), options, body: options.body ? JSON.parse(options.body) : undefined }
  calls.push(entry)
  return entry
}
function writeBoundary(entry) {
  assert.equal(entry.options.method, 'POST')
  assert.equal(entry.options.headers['Content-Type'], 'application/json')
  // Matches the anonymous gateway's cross-origin write boundary.
  assert.equal(entry.options.headers['X-Booking-Request'], '1')
  assert.equal(entry.options.credentials, 'omit')
  assert.equal(entry.options.referrerPolicy, 'no-referrer')
  assert.equal(entry.options.cache, 'no-store')
}

try {
  browser()
  const { api } = await actualModule('src/booking/api.ts', 'https://api.example.test')
  const committed = new Map()
  let loseFirstResponse = true
  globalThis.fetch = async (url, options) => {
    const entry = observed(url, options)
    writeBoundary(entry)
    if (!committed.has(entry.body.requestId)) committed.set(entry.body.requestId, result)
    if (loseFirstResponse) { loseFirstResponse = false; throw new TypeError('Connection dropped after the server committed') }
    return Response.json(committed.get(entry.body.requestId))
  }
  await assert.rejects(api.hold(request), error => error.code === 'network')
  const retry = await api.hold(request)
  await api.hold(request)
  check('lost-reply retry and repeated submission reuse one server mutation', () => {
    assert.equal(committed.size, 1)
    assert.equal(calls[0].body.requestId, calls[1].body.requestId)
    assert.equal(calls[1].body.requestId, calls[2].body.requestId)
    assert.match(calls[0].body.requestId, /^[0-9a-f-]{36}$/i)
    assert.deepEqual(calls[0].body.request, request)
    assert.equal(calls[0].body.honeypot, '')
    assert.deepEqual(retry, result)
  })
  await api.hold({ ...request, date: '2026-12-21' }, 'filled-by-bot')
  check('a different request gets a new mutation ID and carries its honeypot', () => {
    assert.equal(committed.size, 2)
    assert.notEqual(calls[3].body.requestId, calls[0].body.requestId)
    assert.equal(calls[3].body.honeypot, 'filled-by-bot')
  })

  const priorCount = calls.length
  globalThis.fetch = async (url, options) => { observed(url, options); return Response.json(receipt) }
  const loaded = await api.booking(receipt.ref)
  check('submission token is recovered from session storage and sent only in POST body', () => {
    assert.deepEqual(loaded, receipt)
    const entry = calls[priorCount]
    writeBoundary(entry)
    assert.equal(entry.url, 'https://api.example.test/api/booking/status')
    assert.deepEqual(entry.body, { ref: receipt.ref, accessToken: 'contract-token' })
    assert(!entry.url.includes('contract-token'))
  })
  browser('#access=fragment-token')
  await api.booking('CS-fragment-check')
  browser()
  await api.booking('CS-fragment-check')
  check('fragment access survives refresh within the tab without exposing it in query strings', () => {
    assert.equal(memory.get('booking-access:CS-fragment-check'), 'fragment-token')
    assert.deepEqual(calls.at(-1).body, { ref: 'CS-fragment-check', accessToken: 'fragment-token' })
  })
  const beforeMissingToken = calls.length
  assert.equal(await api.booking('CS-no-token'), null)
  assert.equal(await api.booking(''), null)
  check('a missing private access token does not request a booking record', () => assert.equal(calls.length, beforeMissingToken))

  let loseWaitlistResponse = true
  globalThis.fetch = async (url, options) => {
    const entry = observed(url, options); writeBoundary(entry)
    if (loseWaitlistResponse) { loseWaitlistResponse = false; throw new TypeError('Reply lost') }
    return Response.json({ ok: true })
  }
  await assert.rejects(api.waitlist('night-contract', 'check@example.test'))
  await api.waitlist('night-contract', 'check@example.test')
  check('waitlist retry retains one mutation ID and the gateway write marker', () => {
    assert.equal(calls.at(-2).body.requestId, calls.at(-1).body.requestId)
    assert.equal(calls.at(-1).body.nightId, 'night-contract')
    assert.equal(calls.at(-1).body.email, 'check@example.test')
    assert.equal(calls.at(-1).body.honeypot, '')
  })

  globalThis.fetch = async (url, options) => { observed(url, options); return Response.json({ error: { code: 'seats-gone', message: 'These seats are no longer available.' } }, { status: 409 }) }
  await assert.rejects(api.hold({ ...request, kind: 'table', nightId: 'night-full', seats: 2 }), error => error.code === 'seats-gone' && error.message === 'These seats are no longer available.')
  checks++; process.stdout.write('PASS authoritative availability conflicts reach the form as booking errors\n')

  const timeoutApi = (await actualModule('src/booking/api.ts', 'https://timeout.example.test')).api
  let fireTimeout, timeoutCleared = false, timeoutDelay
  globalThis.setTimeout = (callback, delay) => { fireTimeout = callback; timeoutDelay = delay; return 1 }
  globalThis.clearTimeout = () => { timeoutCleared = true }
  globalThis.fetch = (url, options) => {
    observed(url, options)
    return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Timed out', 'AbortError')), { once: true }))
  }
  const timedOut = timeoutApi.hold(request)
  check('requests have a bounded abort timeout', () => { assert.equal(timeoutDelay, 20000); assert.equal(typeof fireTimeout, 'function') })
  fireTimeout()
  await assert.rejects(timedOut, error => error.code === 'network')
  check('timeout aborts cleanly and releases its timer', () => assert.equal(timeoutCleared, true))
  globalThis.setTimeout = savedGlobals.setTimeout
  globalThis.clearTimeout = savedGlobals.clearTimeout
  const abortedId = calls.at(-1).body.requestId
  globalThis.fetch = async (url, options) => { const entry = observed(url, options); writeBoundary(entry); return Response.json(result) }
  await timeoutApi.hold(request)
  check('retry after timeout keeps the original mutation ID', () => assert.equal(calls.at(-1).body.requestId, abortedId))

  const closed = (await actualModule('src/booking/api.ts', null)).api
  const beforeUnconfigured = calls.length
  await assert.rejects(closed.hold(request), error => error.code === 'network')
  await assert.rejects(closed.availability('dinner', '2026-12'), error => error.code === 'network')
  check('missing live configuration fails closed without a mock or network write', () => assert.equal(calls.length, beforeUnconfigured))

  const { ics } = await actualModule('src/booking/format.ts')
  check('unconfirmed, held and cancelled requests do not become calendar appointments', () => {
    for (const status of ['requested', 'held', 'cancelled']) assert.equal(ics({ ...receipt, status }), null)
  })
  check('confirmed winter and summer appointments use Eastern Time across DST', () => {
    assert(ics({ ...receipt, status: 'confirmed' }).includes('DTSTART:20261220T230000Z'))
    assert(ics({ ...receipt, status: 'confirmed', date: '2027-07-20' }).includes('DTSTART:20270720T220000Z'))
    assert(ics({ ...receipt, status: 'confirmed', time: '22:15' }).includes('DTSTART:20261221T031500Z'))
  })
  check('calendar export rejects a nonexistent spring-forward wall clock', () => assert.equal(ics({ ...receipt, status: 'confirmed', date: '2027-03-14', time: '02:30' }), null))
  check('calendar export does not invent a duration or disclose private guest fields', () => {
    const calendar = ics({ ...receipt, status: 'confirmed', email: 'private@example.test', place: 'Private home address', notes: 'Private dietary note' })
    assert(calendar.includes('STATUS:CONFIRMED'))
    assert(!calendar.includes('DURATION:'))
    assert(!calendar.includes('DTEND:'))
    assert(!calendar.includes('private@example.test'))
    assert(!calendar.includes('Private home address'))
    assert(!calendar.includes('Private dietary note'))
  })
  process.stdout.write(`\n${checks} public booking client checks passed.\n`)
} finally {
  for (const [key, value] of Object.entries(savedGlobals)) {
    if (value === undefined) delete globalThis[key]
    else globalThis[key] = value
  }
}
