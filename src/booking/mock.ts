/**
 * Prototype stand-in for the booking backend (docs/BOOKING.md §6). Same interface as the real API, so going live is a
 * config change (booking.apiBase in src/content/booking.ts), not a rewrite.
 *
 * Everything here is SAMPLE behaviour: Sergio hasn't set his cooking windows, lead time or deposits yet
 * (src/content/booking.ts), so the mock uses placeholder rules and fake "busy" days, and keeps bookings in this browser only.
 */
import { booking } from '../content/booking'
import { site } from '../content/site'
import { dishes } from '../content/menu'
import { BookingError, type Availability, type BookingApi, type BookingRecord, type BookingRequest, type HoldResult, type Kind, type Night } from './types'

// Placeholder rules until Sergio decides (0 = Sunday).
const SAMPLE_RULES: Record<Exclude<Kind, 'table'>, { days: number[]; times: string[]; leadDays: number }> = {
  dinner: { days: [4, 5, 6, 0], times: ['17:00', '18:00', '19:00'], leadDays: 7 },
  class: { days: [6, 0], times: ['11:00', '14:00', '17:00'], leadDays: 7 },
  event: { days: [5, 6, 0], times: ['12:00', '17:00', '18:00'], leadDays: 14 },
}

const KEY = 'mock-bookings'
const wait = (ms = 250) => new Promise((r) => setTimeout(r, ms))
const pad = (n: number) => String(n).padStart(2, '0')
export const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const parse = (s: string) => {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d, 12)
}
const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7)

function load(): BookingRecord[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]')
  } catch {
    return []
  }
}
function save(all: BookingRecord[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(all))
  } catch {
    /* private mode: the prototype still works for this page view */
  }
}

/** A day is "busy" in the sample if Sergio's (pretend) calendar has something, or this browser already holds it. */
function isOpen(kind: Exclude<Kind, 'table'>, date: Date, held: Set<string>) {
  const rules = SAMPLE_RULES[kind]
  const lead = new Date()
  lead.setDate(lead.getDate() + rules.leadDays)
  if (date < lead) return false
  if (!rules.days.includes(date.getDay())) return false
  if (held.has(iso(date))) return false
  return hash(iso(date)) % 4 !== 0 // ~25% of eligible days are busy in the sample
}

function sampleNights(): Night[] {
  const out: Night[] = []
  const d = new Date()
  d.setDate(d.getDate() + 10)
  const named = dishes.map((x) => x.name)
  const plan = [
    { taken: 4, title: named[2] }, // pending: 4 of 6
    { taken: 7, title: named[1] }, // confirmed: 3 left
    { taken: 10, title: named[0] }, // full
  ]
  while (out.length < plan.length) {
    if (d.getDay() === 5 || d.getDay() === 6) {
      const p = plan[out.length]
      const cutoff = new Date(d)
      cutoff.setDate(cutoff.getDate() - 3)
      out.push({
        id: `n-${iso(d)}`,
        date: iso(d),
        start: '19:00',
        title: `${p.title} night`,
        menu: `Sample night for the prototype. Sergio writes each night's menu in his calendar; this one is built around his ${p.title}.`,
        seats: 10,
        minimum: 6,
        taken: p.taken,
        pricePerSeat: site.pricing.tableFromPerGuest,
        cutoff: iso(cutoff),
        state: 'pending',
        sample: true,
      })
    }
    d.setDate(d.getDate() + 1)
  }
  // Seats this browser reserved in the prototype count too.
  for (const b of load()) {
    const n = out.find((x) => x.id === b.nightId)
    if (n && (b.status === 'reserved' || b.status === 'confirmed')) n.taken += b.seats ?? 0
  }
  for (const n of out) n.state = n.taken >= n.seats ? 'full' : n.taken >= n.minimum ? 'confirmed' : 'pending'
  return out
}

const deposit = (kind: Kind) => (kind === 'dinner' || kind === 'class' ? booking.formats[kind].deposit : null)

export const mockApi: BookingApi & { complete(ref: string): Promise<BookingRecord | null> } = {
  async availability(kind, month) {
    await wait()
    const held = new Set(load().filter((b) => b.date && b.status !== 'pending-payment').map((b) => b.date!))
    const [y, m] = month.split('-').map(Number)
    const days = []
    for (let d = new Date(y, m - 1, 1, 12); d.getMonth() === m - 1; d.setDate(d.getDate() + 1)) {
      if (isOpen(kind, d, held)) days.push({ date: iso(d), times: SAMPLE_RULES[kind].times })
    }
    let nextOpen: string | null = null
    if (!days.length) {
      for (let d = new Date(y, m, 1, 12), i = 0; i < 120 && !nextOpen; d.setDate(d.getDate() + 1), i++) if (isOpen(kind, d, held)) nextOpen = iso(d)
    }
    return { month, days, nextOpen, sample: true } satisfies Availability
  },

  async nights() {
    await wait()
    return sampleNights()
  },

  async hold(req: BookingRequest): Promise<HoldResult> {
    await wait(400)
    const all = load()
    const ref = `CS-${Date.now().toString(36).toUpperCase()}`
    let night: Night | undefined
    if (req.kind === 'table') {
      night = sampleNights().find((n) => n.id === req.nightId)
      if (!night || night.state === 'full' || (req.seats ?? 0) > night.seats - night.taken) throw new BookingError('seats-gone', 'Those seats were just taken.')
    } else if (req.date) {
      const open = await this.availability(req.kind, req.date.slice(0, 7))
      if (!open.days.some((d) => d.date === req.date)) throw new BookingError('unavailable', 'That date was just taken.')
    }
    const record: BookingRecord = {
      ...req,
      ref,
      night,
      createdAt: new Date().toISOString(),
      status: req.kind === 'event' ? 'requested' : 'pending-payment',
      amount: req.kind === 'table' ? (night?.pricePerSeat ?? null) && night!.pricePerSeat! * (req.seats ?? 0) : deposit(req.kind),
      amountWhen: req.kind === 'event' ? 'after-quote' : req.kind === 'table' ? 'when-confirmed' : 'now',
    }
    save([...all, record])
    const base = import.meta.env.BASE_URL
    return record.status === 'requested'
      ? { ref, next: 'done', url: `${base}book/done/?ref=${ref}` }
      : { ref, next: 'checkout', url: `${base}book/pay/?ref=${ref}` }
  },

  async booking(ref) {
    await wait(150)
    return load().find((b) => b.ref === ref) ?? null
  },

  async waitlist(nightId, email) {
    await wait()
    save([...load(), { kind: 'table', nightId, email, name: '', phone: '', contactBy: 'email', ref: `WL-${Date.now().toString(36).toUpperCase()}`, status: 'waitlisted', amount: null, amountWhen: 'when-confirmed', createdAt: new Date().toISOString() }])
  },

  /** Prototype only: what Stripe's webhook does when payment (or card saving) succeeds. */
  async complete(ref) {
    await wait(300)
    const all = load()
    const b = all.find((x) => x.ref === ref)
    if (!b) return null
    if (b.kind === 'table') {
      const before = sampleNights().find((n) => n.id === b.nightId)
      const reaches = before ? before.taken + (b.seats ?? 0) >= before.minimum : false
      b.status = before?.state === 'confirmed' || reaches ? 'confirmed' : 'reserved'
    } else b.status = 'held'
    save(all)
    b.night = sampleNights().find((n) => n.id === b.nightId) ?? b.night
    return b
  },
}

export const _sample = { rules: SAMPLE_RULES, parse }
