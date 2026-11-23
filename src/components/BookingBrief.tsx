import type { Night, PlanningConfig } from '../booking/types'
import { budgetLabel, selectedBand, type PlanningState } from '../booking/planning'
import { clock, longDate, money } from '../booking/format'
import { Logo } from './Logo'

const names = { dinner: 'A private dinner', class: 'A cooking class', event: 'A small celebration', table: 'Sergio’s table' }
export function BookingBrief({ state: s, config, night, compact = false }: { state: PlanningState; config: PlanningConfig | null; night?: Night; compact?: boolean }) {
  const table = s.kind === 'table', band = selectedBand(s, config)
  const date = table && night ? `${longDate(night.date)}, ${clock(night.start)}` : s.dateMode === 'exact' && s.date ? `${longDate(s.date)}${s.time ? `, ${clock(s.time)}` : ''}` : s.dateMode === 'flexible' && (s.dateFrom || s.dateTo) ? `${s.dateFrom ? longDate(s.dateFrom) : 'Open start'}${s.dateTo ? ` – ${longDate(s.dateTo)}` : ' onward'}` : 'Date to agree with Sergio'
  const party = table ? `${s.seats} ${s.seats === 1 ? 'seat' : 'seats'}` : s.headcountMode === 'exact' && s.guests ? `${s.guests} guests` : band?.label ?? 'Party size to choose'
  const unresolved = !table ? [s.dateMode !== 'exact' && 'Event date', s.headcountMode !== 'exact' && 'Exact guest count', !s.place && s.where !== 'his' && 'Location', s.where !== 'his' && 'Kitchen suitability', s.budgetMode === 'guidance' && 'Spending range', 'Menu'].filter(Boolean) as string[] : []
  return <aside className={`booking-brief ${compact ? 'booking-brief--compact' : ''}`} aria-label="Your gathering summary" data-booking-brief>
    {!compact && <div className="booking-brief-brand"><Logo variant="compact" className="mx-auto w-32" /></div>}
    <p className="booking-eyebrow">Your gathering</p>
    <h3 className="booking-brief-title">{s.kind ? names[s.kind] : 'An evening to look forward to.'}</h3>
    {s.occasion && !table && <p className="booking-brief-occasion">{s.occasion}</p>}
    <dl className="booking-brief-facts">
      <div><dt>When</dt><dd>{date}</dd></div>
      <div><dt>{table ? 'Your places' : 'Your people'}</dt><dd>{party}</dd></div>
      <div><dt>Where</dt><dd>{table || s.where === 'his' ? 'At Sergio’s table' : s.place || 'Location to discuss'}</dd></div>
      {!table && <div><dt>Spending</dt><dd>{budgetLabel(s)}</dd></div>}
    </dl>
    {(table && night || !table && s.foodIdeas) && <div className="booking-brief-food"><p className="booking-eyebrow">{table ? 'The menu' : 'Your starting ideas'}</p><p>{table ? night?.menu : s.foodIdeas}</p></div>}
    {unresolved.length > 0 && <div className="booking-brief-clarify"><p className="booking-eyebrow">For your interview</p><p>{unresolved.join(' · ')}</p></div>}
    <div className="booking-brief-payment"><span>{table ? 'Listed seat total' : 'Deposit'}</span><strong>{table && night?.pricePerSeat != null ? money(night.pricePerSeat * s.seats) : band?.deposit != null ? money(band.deposit) : 'To be confirmed'}</strong><p>{table ? 'Payment secures your seats when checkout is available.' : 'The whole deposit counts toward your event bill.'}</p></div>
    <p className="booking-brief-signoff">A gathering shaped with Sergio.</p>
  </aside>
}
