import { booking } from '../content/booking'
import { BookingError, type BookingReceipt, type PublicBookingApi, type PublicHoldResult } from './types'

// A failed or missing live service never creates a browser-only booking.
export const IS_MOCK = false
const attempts = new Map<string, string>()
function requestId(operation: string, payload: unknown) {
  const key = operation + JSON.stringify(payload)
  let value = attempts.get(key)
  if (!value) { value = crypto.randomUUID(); attempts.set(key, value) }
  return { key, value }
}
function rememberAccess(ref: string, accessToken: string) {
  try { sessionStorage.setItem('booking-access:' + ref, accessToken) } catch { /* The URL fragment still grants access for this page. */ }
}
function receiptAccess(ref: string) {
  if (typeof window === 'undefined') return ''
  const token = new URLSearchParams(window.location.hash.slice(1)).get('access')
  if (token) { rememberAccess(ref, token); return token }
  try { return sessionStorage.getItem('booking-access:' + ref) || '' } catch { return '' }
}
async function call<T>(path: string, body?: unknown, allowNull = false): Promise<T> {
  const base = booking.apiBase?.replace(/\/$/, '')
  if (!base) throw new BookingError('network', 'Online requests are unavailable. Please call Sergio to discuss your date.')
  let response: Response
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 20000)
  try {
    response = await fetch(base + path, { signal: controller.signal, method: body === undefined ? 'GET' : 'POST', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', headers: body === undefined ? undefined : { 'Content-Type': 'application/json', 'X-Booking-Request': '1' }, body: body === undefined ? undefined : JSON.stringify(body) })
  } catch { clearTimeout(timeout); throw new BookingError('network', 'The request service could not be reached. Your request has not been confirmed; please retry or call Sergio.') }
  const data = await response.json().catch(() => null).finally(() => clearTimeout(timeout))
  if (!response.ok) {
    const error = data?.error ?? data
    const code = ['unavailable', 'seats-gone', 'invalid', 'network'].includes(error?.code) ? error.code : 'network'
    throw new BookingError(code, error?.message || 'Your request could not be confirmed. Please retry or call Sergio.')
  }
  if (data === null && !allowNull) throw new BookingError('network', 'The service returned an incomplete response. Please retry before assuming your request was received.')
  return data as T
}
export const api: PublicBookingApi = {
  availability: (kind, month) => call(`/api/availability?type=${encodeURIComponent(kind)}&month=${encodeURIComponent(month)}`),
  nights: () => call('/api/nights'),
  async hold(request, honeypot = '') {
    const attempt = requestId('request:', request)
    const result = await call<PublicHoldResult>(request.kind === 'event' ? '/api/request' : '/api/hold', { request, requestId: attempt.value, honeypot })
    if (!result.ref || !result.accessToken || result.next !== 'done' || typeof result.url !== 'string') throw new BookingError('network', 'The request receipt was incomplete. Retry to recover the same request, or call Sergio.')
    rememberAccess(result.ref, result.accessToken)
    return result
  },
  async booking(ref) {
    const accessToken = receiptAccess(ref)
    if (!ref || !accessToken) return null
    return call<BookingReceipt | null>('/api/booking/status', { ref, accessToken }, true)
  },
  async waitlist(nightId, email, honeypot = '') {
    const request = { nightId, email: email.trim() }, attempt = requestId('waitlist:', request)
    await call('/api/waitlist', { ...request, requestId: attempt.value, honeypot })
  },
}
