import { useEffect, useState } from 'react'
import { Icon, type IconName } from '../components/Icons'
import { MenuCard } from '../components/MenuCard'
import { CtaButton, CtaLink } from '../components/CallToAction'
import { href } from '../components/ui'
import { site } from '../content/site'
import { api } from './api'
import { ics } from './format'
import { NightList } from './TableNights'
import type { BookingReceipt, Night } from './types'

const ref = () => new URLSearchParams(window.location.search).get('ref') ?? ''
export function cardFor(b: BookingReceipt) {
  return { format: b.kind === 'table' ? undefined : b.kind, table: b.kind === 'table', guests: b.guests, date: b.date, time: b.time, nightTitle: b.nightTitle }
}
const HEAD: Record<BookingReceipt['status'], { h1: string; stamp: string; icon: IconName }> = {
  requested: { h1: 'Request received', stamp: 'Requested', icon: 'mail' },
  held: { h1: 'Your date is held for review', stamp: 'Held for review', icon: 'calendar-days' },
  confirmed: { h1: 'Your booking is confirmed', stamp: 'Confirmed', icon: 'circle-check' },
  cancelled: { h1: 'This request was cancelled', stamp: 'Cancelled', icon: 'clock' },
}
function Next({ b }: { b: BookingReceipt }) {
  const steps = b.status === 'cancelled'
    ? ['This request is no longer active.', 'Contact Sergio if you would like to discuss another date.']
    : b.status === 'confirmed'
      ? ['Sergio has confirmed your booking.', 'Agree the menu, location and payment arrangements directly with Sergio. This service does not collect payments.']
      : [b.kind === 'table' ? 'Your seat request is with Sergio. Seats are not reserved until he approves it.' : 'Your request is with Sergio. The date is not confirmed by submitting this form.', 'Sergio reviews availability and contacts you using the details you supplied.', 'Agree the details, quote and any payment arrangements directly with Sergio.']
  return <ol className="mt-8 space-y-5">{steps.map((step, i) => <li key={step} className="grid grid-cols-[2rem_1fr] gap-3"><span className="font-display text-2xl leading-none text-ink-muted" aria-hidden>{i + 1}</span><p>{step}</p></li>)}</ol>
}

/** The public receipt is a safe projection protected by the private token in this page's fragment. */
export function BookDone() {
  const [receipt, setReceipt] = useState<BookingReceipt | null | undefined>(undefined)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  async function load() {
    setLoading(true); setError('')
    try { setReceipt(await api.booking(ref())) }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'The current request status could not be loaded.') }
    finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])
  const file = receipt?.status === 'confirmed' ? ics(receipt) : null
  return <section className="wrap py-10 md:py-16">
    {!receipt && <><h1 className="text-4xl sm:text-5xl">Your booking</h1>{loading ? <p className="mt-4 text-ink-muted" role="status">Loading your request</p> : error ? <div className="mt-4 max-w-prose"><p role="alert">{error}</p><CtaButton type="button" emphasis="secondary" className="mt-4" onClick={() => void load()}>Try again</CtaButton></div> : receipt === null ? <p className="mt-4 max-w-prose">This private request link could not be opened. Use the complete link you saved after submitting, or <a className="link" href={site.phoneHref}>call Sergio at {site.phone}</a>.</p> : <p className="mt-4 text-ink-muted" role="status">Loading your request</p>}</>}
    {receipt && <div className="grid gap-10 lg:grid-cols-[1fr_24rem] lg:items-start"><div className="max-w-prose"><div role="status"><h1 className="flex items-start gap-3 text-4xl sm:text-5xl"><Icon name={HEAD[receipt.status].icon} size={28} className="mt-1.5 shrink-0"/>{HEAD[receipt.status].h1}</h1><p className="mt-3 text-sm text-ink-muted">Reference {receipt.ref}</p></div><p className="mt-4 text-ink-muted">No payment is collected and no card is saved through this request service.</p><h2 className="mt-10 text-2xl">What happens next</h2><Next b={receipt}/>{error && <p role="alert" className="mt-6 font-medium text-alert">{error} The status shown above is the last one loaded.</p>}<div className="cta-pair mt-10">{file && <CtaLink emphasis="secondary" className="gap-2" download="chef-sergio.ics" href={`data:text/calendar;charset=utf-8,${encodeURIComponent(file)}`}><Icon name="calendar-days"/>Add to calendar</CtaLink>}<CtaButton type="button" emphasis="secondary" disabled={loading} onClick={() => void load()}>{loading ? 'Refreshing' : 'Refresh status'}</CtaButton><CtaLink emphasis="secondary" className="gap-2" href={site.phoneHref}><Icon name="phone"/>Call {site.phone}</CtaLink></div><p className="mt-6 text-sm text-ink-muted">Keep this private link to check your status. It is not emailed automatically. Your contact and dietary details are not displayed on this page.</p></div><MenuCard data={cardFor(receipt)} stamp={HEAD[receipt.status].stamp}/></div>}
  </section>
}

/** Old prototype checkout URLs remain harmless while routes are migrated. */
export function MockCheckout() {
  return <section className="wrap py-10 md:py-16"><h1 className="text-4xl sm:text-5xl">Online checkout is unavailable</h1><p className="mt-4 max-w-prose">This website accepts requests only. No card is saved and no payment is collected here.</p><CtaLink emphasis="primary" className="mt-6" href={href('/book/')}>Send a request</CtaLink></section>
}

export function TableNightsLive() {
  const [nights, setNights] = useState<Night[] | null>(null)
  const [error, setError] = useState('')
  async function load() {
    setError(''); setNights(null)
    try { setNights(await api.nights()) }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Upcoming nights could not be loaded.') }
  }
  useEffect(() => { void load() }, [])
  if (error) return <div><p role="alert" className="text-ink-muted">{error}</p><CtaButton type="button" emphasis="secondary" className="mt-3" onClick={() => void load()}>Try again</CtaButton></div>
  if (!nights) return <p className="text-ink-muted" role="status">Loading upcoming nights. <noscript><a className="link" href={site.phoneHref}>Call {site.phone} to ask about a night.</a></noscript></p>
  return <NightList nights={nights}/>
}
