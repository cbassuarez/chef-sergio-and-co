import * as Checkbox from '@radix-ui/react-checkbox'
import * as Label from '@radix-ui/react-label'
import * as RadioGroup from '@radix-ui/react-radio-group'
import { AnimatePresence, m } from 'framer-motion'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { api } from '../booking/api'
import { Calendar } from '../booking/Calendar'
import { addMonths, clock, longDate, money, shortDate } from '../booking/format'
import { canRequestNight, NightPicker } from '../booking/TableNights'
import { BookingError, type Availability, type BookingRequest, type Kind, type Night } from '../booking/types'
import { booking } from '../content/booking'
import { dishes } from '../content/menu'
import { site } from '../content/site'
import { Icon } from './Icons'
import { CtaButton } from './CallToAction'
import { MenuCard, type Where } from './MenuCard'
import { ease, PressButton, snappy } from './motion'
import { href, track } from './ui'

/*
 * One booking flow, four paths (docs/BOOKING.md):
 *   dinner / class / event → open date + time → food → review → unpaid request
 *   table                  → scheduled night + seats → dietary → review → seat request
 * Dates and seats are confirmed only after Sergio reviews the request.
 * Every CTA on the site pre-fills what it knows and the flow opens at the first unanswered question.
 * Progress is kept in this browser, so leaving (or cancelling payment) never loses what was typed.
 */

const OCCASIONS = ['Birthday', 'Anniversary', 'Date night', 'Family gathering', 'Holiday', 'Client entertaining', 'Something else']
const DIETARY = ['Vegetarian', 'Vegan', 'Gluten-free', 'Dairy-free', 'Without nuts', 'Without shellfish']
const DRAFT_KEY = 'booking-draft'

type State = {
  kind?: Kind
  date?: string
  time?: string
  flexible?: boolean
  guests?: number
  where: Where
  place?: string
  nightId?: string
  seats: number
  occasion?: string
  dishes: string[]
  dietary: string[]
  notes: string
  name: string
  email: string
  phone: string
  contactBy: 'call' | 'text' | 'email'
  gift: string
}
const EMPTY: State = { where: 'home', seats: 2, dishes: [], dietary: [], notes: '', name: '', email: '', phone: '', contactBy: 'call', gift: '' }

const validDate = (value:string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value
function validDraft(value:any):value is {savedAt:string;step:number;s:State} {
  if(!value||typeof value!=='object'||!value.s||typeof value.s!=='object'||!Number.isInteger(value.step)||value.step<0||value.step>3)return false
  const savedAt=Date.parse(value.savedAt),age=Date.now()-savedAt
  if(!Number.isFinite(savedAt)||age< -300000||age>7*864e5)return false
  const saved=value.s
  if(saved.kind!==undefined&&!['dinner','class','event','table'].includes(saved.kind))return false
  if(!['home','rental','his'].includes(saved.where)||!['call','text','email'].includes(saved.contactBy))return false
  if(!Number.isInteger(saved.seats)||saved.seats<1||saved.seats>6)return false
  for(const key of ['dishes','dietary'])if(!Array.isArray(saved[key])||saved[key].length>20||saved[key].some((item:unknown)=>typeof item!=='string'||item.length>150))return false
  for(const [key,max] of [['notes',4000],['name',150],['email',254],['phone',60],['gift',100]] as const)if(typeof saved[key]!=='string'||saved[key].length>max)return false
  if(saved.place!==undefined&&(typeof saved.place!=='string'||saved.place.length>300))return false
  if(saved.occasion!==undefined&&(typeof saved.occasion!=='string'||saved.occasion.length>1000))return false
  if(saved.date!==undefined&&(typeof saved.date!=='string'||!validDate(saved.date)))return false
  if(saved.time!==undefined&&(typeof saved.time!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(saved.time)))return false
  if(saved.guests!==undefined&&(!Number.isInteger(saved.guests)||saved.guests<1||saved.guests>24))return false
  return saved.nightId===undefined||typeof saved.nightId==='string'&&saved.nightId.length<=100
}

const KINDS: { key: Kind; title: string; detail: string; on: boolean }[] = [
  { key: 'dinner', title: 'A private dinner', detail: `${site.formats.dinner.min} to ${site.formats.dinner.max} guests, cooked and served for you`, on: true },
  { key: 'class', title: 'A cooking class', detail: 'Hands-on with Sergio, then you eat what you made', on: true },
  { key: 'event', title: 'A small event', detail: `${site.formats.event.min} to ${site.formats.event.max} guests, with staff, linens and tableware`, on: true },
  { key: 'table', title: "Seats at Sergio's table", detail: 'A shared table at his home, on nights he hosts', on: site.features.sergiosTable },
]
const STEPS: Record<'date' | 'table', string[]> = {
  date: ['What you’re planning', 'When and where', 'The food', 'Review and send'],
  table: ['What you’re planning', 'Night and seats', 'The food', 'Review and send'],
}

const thisMonth = () => new Intl.DateTimeFormat('en-CA', {timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()).slice(0,7)

function Field({ id, label, hint, error, children }: { id: string; label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <div id={`wrap-${id}`}>
      <Label.Root htmlFor={id} className="block font-medium">
        {label}
      </Label.Root>
      {hint && (
        <p id={`${id}-hint`} className="text-sm text-ink-muted">
          {hint}
        </p>
      )}
      <div className="mt-2">{children}</div>
      <ErrorText id={id} error={error} />
    </div>
  )
}

function ErrorText({ id, error }: { id: string; error?: string }) {
  return (
    <AnimatePresence initial={false}>
      {error && (
        <m.p key={error} id={`${id}-err`} className="mt-1 text-sm font-medium text-alert" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
          {error}
        </m.p>
      )}
    </AnimatePresence>
  )
}

const inputCls =
  'block w-full min-h-[48px] rounded-btn border border-ink/60 bg-paper px-3 text-base text-ink placeholder:text-ink-muted/70 transition-[border-color,box-shadow] duration-150 hover:border-ink/60 focus:border-ink aria-[invalid=true]:border-alert'
const tile =
  'rounded-card border border-ink/60 bg-paper transition-[border-color,box-shadow,transform] duration-150 hover:border-ink/60 active:scale-[0.99] data-[state=checked]:border-brand data-[state=checked]:ring-2 data-[state=checked]:ring-brand'

function Check({ id, label, checked, onChange }: { id: string; label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex min-h-[44px] items-center gap-3">
      <Checkbox.Root
        id={id}
        checked={checked}
        onCheckedChange={(v) => onChange(v === true)}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-ink/60 bg-paper transition-colors hover:border-ink data-[state=checked]:border-brand data-[state=checked]:bg-brand"
      >
        <Checkbox.Indicator asChild>
          <m.span aria-hidden className="flex h-3.5 w-3.5 items-center justify-center text-canvas" initial={{ scale: 0.4 }} animate={{ scale: 1 }} transition={snappy}>
            <Icon name="check" size={14} strokeWidth={2} />
          </m.span>
        </Checkbox.Indicator>
      </Checkbox.Root>
      <Label.Root htmlFor={id} className="cursor-pointer">
        {label}
      </Label.Root>
    </div>
  )
}

function Stepper({ id, value, min, max, onChange, labelledBy }: { id: string; value?: number; min: number; max: number; onChange: (n: number) => void; labelledBy?: string }) {
  return (
    <div className="flex items-center gap-2" role="group" aria-labelledby={labelledBy}>
      <PressButton type="button" className="btn-quiet w-12 px-0" aria-label="One fewer" disabled={(value ?? min) <= min} onClick={() => onChange(Math.max(min, (value ?? min + 1) - 1))}>
        −
      </PressButton>
      <input id={id} type="number" inputMode="numeric" min={min} max={max} value={value ?? ''} onChange={(e) => onChange(Number(e.target.value))} className={`${inputCls.replace('w-full', '')} w-20 text-center tabular-nums`} />
      <PressButton type="button" className="btn-quiet w-12 px-0" aria-label="One more" disabled={(value ?? 0) >= max} onClick={() => onChange(Math.min(max, (value ?? min - 1) + 1))}>
        +
      </PressButton>
    </div>
  )
}

/** First open day in a month, preferring Saturday, then Friday: a suggestion when the visitor only chose a month. */
function suggestDay(a: Availability) {
  const byDay = (wd: number) => a.days.find((d) => new Date(d.date + 'T12:00').getDay() === wd)
  return byDay(6) ?? byDay(5) ?? a.days[0]
}

export function BookingForm() {
  const [step, setStep] = useState(0)
  const [dir, setDir] = useState(1)
  const [s, setS] = useState<State>(EMPTY)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [banner, setBanner] = useState<string>()
  const [status, setStatus] = useState<'idle' | 'sending' | 'failed'>('idle')
  const [month, setMonth] = useState(thisMonth)
  const [avail, setAvail] = useState<Availability | null>(null)
  const [nights, setNights] = useState<Night[] | null>(null)
  const [suggested, setSuggested] = useState(false)
  const [availabilityError,setAvailabilityError] = useState('')
  const [availabilityRetry,setAvailabilityRetry] = useState(0)
  const [nightsError,setNightsError] = useState('')
  const [nightsRetry,setNightsRetry] = useState(0)
  const [submissionError,setSubmissionError] = useState('')
  const [honeypot,setHoneypot] = useState('')
  const submitLock = useRef(false)
  const [draft, setDraft] = useState<{ savedAt: string; step: number; s: State } | null>(null)
  const [giftOpen, setGiftOpen] = useState(false)
  const suggestNext = useRef(false)
  const navigated = useRef(false) // true once the visitor pages the calendar themselves
  const headRef = useRef<HTMLHeadingElement>(null)
  const set = (patch: Partial<State>) => setS((p) => ({ ...p, ...patch }))

  const isTable = s.kind === 'table'
  const steps = STEPS[isTable ? 'table' : 'date']
  const fmt = s.kind && s.kind !== 'table' ? s.kind : undefined
  const bounds = fmt ? site.formats[fmt] : { min: 1, max: 24 }
  const night = nights?.find((n) => n.id === s.nightId)
  const seatsMax = night ? Math.min(booking.table.maxSeatsPerBooking, night.seats - night.taken) : booking.table.maxSeatsPerBooking
  const times = avail?.days.find((d) => d.date === s.date)?.times ?? []

  // ---- Prefill from the CTA that brought the visitor here, or resume a saved draft ----
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    let saved: typeof draft = null
    try {
      const candidate = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null')
      saved = validDraft(candidate) ? candidate : null
    } catch {
      saved = null
    }
    if (q.get('resume') && saved) {
      setS({ ...EMPTY, ...saved.s })
      setStep(saved.step)
      if (saved.s.date) setMonth(saved.s.date.slice(0, 7))
      return
    }
    const t = q.get('type') as Kind | null
    const patch: Partial<State> = {}
    if (t && KINDS.some((k) => k.key === t && k.on)) patch.kind = t
    const w = q.get('where') as Where | null
    if (w === 'rental' || (w === 'his' && t === 'dinner')) patch.where = w
    if (q.get('night')) patch.nightId = q.get('night')!
    if (Number(q.get('guests'))) patch.guests = Number(q.get('guests'))
    if (q.get('gift')) {
      patch.gift = q.get('gift')!
      setGiftOpen(true)
    }
    const date = q.get('date')
    const when = q.get('when')
    if (date && validDate(date)) {
      patch.date = date
      setMonth(date.slice(0, 7))
    } else if (when === 'this' || when === 'next') {
      setMonth(when === 'next' ? addMonths(thisMonth(),1) : thisMonth())
      suggestNext.current = true
      patch.flexible = true
    } else if (when === 'later') patch.flexible = true
    setS((p) => ({ ...p, ...patch }))
    if (patch.kind) setStep(1)
    else if (saved && !q.toString()) setDraft(saved)
  }, [])

  // ---- Save progress (never after a booking completes) ----
  useEffect(() => {
    if (step === 0 && !s.kind) return
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ savedAt: new Date().toISOString(), step, s }))
    } catch {
      /* private mode: progress just isn't kept */
    }
  }, [s, step])

  // ---- Live availability for date-based paths ----
  useEffect(() => {
    if (!fmt) return
    let live = true
    setAvail(null);setAvailabilityError('')
    api.availability(fmt, month).then((a) => {
      if (!live) return
      // No dead ends: if the month we opened on has nothing, go straight to the next month that does.
      if (!a.days.length && a.nextOpen && !navigated.current) {
        setMonth(a.nextOpen.slice(0, 7))
        return
      }
      setAvail(a)
      if (suggestNext.current && a.days.length) {
        suggestNext.current = false
        const d = suggestDay(a)
        setS((p) => ({ ...p, date: d.date, time: d.times[Math.min(1, d.times.length - 1)] }))
        setSuggested(true)
      }
    }).catch(failure => { if(live)setAvailabilityError(failure instanceof Error ? failure.message : 'Open dates could not be loaded.') })
    return () => { live = false }
  }, [fmt, month, availabilityRetry])

  // ---- Published nights for the table path ----
  useEffect(() => {
    if (!isTable) return
    let live=true
    setNights(null);setNightsError('')
    api.nights().then(value=>{if(live)setNights(value)},failure=>{if(live)setNightsError(failure instanceof Error ? failure.message : 'Upcoming nights could not be loaded.')})
    return()=>{live=false}
  }, [isTable, nightsRetry])

  function validate(i: number) {
    const e: Record<string, string> = {}
    if (i === 0 && !KINDS.some(kind=>kind.key===s.kind&&kind.on)) e.kind = 'Choose what you’re planning.'
    if (i === 1 && isTable) {
      if (!night || !canRequestNight(night)) e.night = nightsError ? 'Upcoming nights are unavailable. Retry before sending.' : 'Choose a night open for seat requests.'
      else if (!Number.isInteger(s.seats) || s.seats < 1 || s.seats > seatsMax) e.seats = `Choose 1 to ${seatsMax} seats.`
    }
    if (i === 1 && !isTable) {
      const day=avail?.days.find(day=>day.date===s.date)
      if (!avail || availabilityError) e.date = 'Load the current open dates before sending your request.'
      else if (!day) e.date = 'This date is not open for requests. Choose an open date.'
      else if (!s.time || !day.times.includes(s.time)) e.time = 'Choose one of the available start times.'
      if (!Number.isInteger(s.guests) || !s.guests) e.guests = `Enter a guest count from ${bounds.min} to ${bounds.max}.`
      else if (s.guests < bounds.min || s.guests > bounds.max)
        e.guests = s.kind === 'dinner' && s.guests > bounds.max ? `Private dinners go up to ${bounds.max}. For ${s.guests}, choose “A small event” in step 1.` : `Enter a guest count from ${bounds.min} to ${bounds.max}.`
      if (s.where !== 'his' && !s.place?.trim()) e.place = s.where === 'rental' ? 'Enter the rental’s community or area.' : 'Enter the city or neighborhood so Sergio can confirm he travels there.'
    }
    if (i === 2) {
      if (s.notes.length > 4000) e.notes='Keep your note to 4,000 characters.'
      if (s.dietary.length>20 || s.dishes.length>20) e.notes='Choose no more than 20 food preferences or dietary requirements.'
    }
    if (i === 3) {
      if (s.name.trim().length<2 || s.name.length>150) e.name = 'Enter your name using at least 2 characters.'
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.email.trim()) || s.email.length>254) e.email = 'Enter an email address like name@example.com.'
      if (s.phone.replace(/\D/g, '').length < 10 || s.phone.length>40) e.phone = 'Enter a 10-digit phone number using no more than 40 characters.'
    }
    setErrors(e)
    const first = Object.keys(e)[0]
    if (first) {
      document.getElementById(`f-${first}`)?.focus()
      const el = document.getElementById(`wrap-f-${first}`) ?? document.getElementById(`f-${first}`)
      if (el) {
        el.classList.remove('shake')
        void el.offsetWidth
        el.classList.add('shake')
      }
      track('booking_error', { step: String(i + 1), field: first })
    }
    return !first
  }

  function go(to: number) {
    setDir(to > step ? 1 : -1)
    setStep(to)
    setBanner(undefined)
    requestAnimationFrame(() => headRef.current?.focus())
  }
  function next() {
    if (!validate(step)) return
    track('booking_step', { step: String(step + 2), kind: s.kind ?? '' })
    go(step + 1)
  }

  async function submit() {
    if(submitLock.current)return
    for(const index of [0,1,2,3])if(!validate(index)){go(index);return}
    submitLock.current=true;setSubmissionError('');setStatus('sending')
    track('booking_submit', { kind: s.kind ?? '' })
    const req: BookingRequest = {
      kind: s.kind!,
      ...(isTable ? { nightId: s.nightId, seats: s.seats } : { date: s.date, time: s.time, flexible: s.flexible, guests: s.guests, where: s.where, place: s.place, occasion: s.occasion, dishes: s.dishes }),
      dietary: s.dietary,
      notes: s.notes,
      name: s.name,
      email: s.email,
      phone: s.phone,
      contactBy: s.contactBy,
      gift: s.gift || undefined,
    }
    try {
      const r = await api.hold(req,honeypot)
      if (r.next === 'done') {try{localStorage.removeItem(DRAFT_KEY)}catch{/* A successful server receipt does not depend on browser storage. */}}
      window.location.href = r.url
    } catch (err) {
      submitLock.current=false;setStatus('idle');setSubmissionError(err instanceof Error ? err.message : 'Your request could not be confirmed.')
      if (err instanceof BookingError && (err.code === 'unavailable' || err.code === 'seats-gone')) {
        // Someone else got there first: back to the picker with fresh availability, nothing else lost.
        set(isTable ? { nightId: undefined } : { date: undefined, time: undefined })
        setNights(null);setNightsRetry(value=>value+1)
        setAvail(null);setAvailabilityRetry(value=>value+1)
        go(1)
        setBanner(isTable ? 'Those seats were just taken. Here are the nights with seats left.' : 'That date was just taken. Here are the dates still open.')
      } else setStatus('failed')
    }
  }

  const toggle = (key: 'dishes' | 'dietary', v: string, on: boolean) => set({ [key]: on ? [...s[key], v] : s[key].filter((x) => x !== v) } as Partial<State>)
  const card = {
    format: fmt,
    table: isTable,
    occasion: isTable ? undefined : s.occasion,
    guests: isTable ? (night ? s.seats : undefined) : s.guests,
    date: isTable ? night?.date : s.date,
    time: isTable ? night?.start : s.time,
    flexible: isTable ? false : s.flexible,
    where: s.where,
    place: s.place,
    dishes: s.dishes,
    nightTitle: isTable ? night?.title : undefined,
    dietary: s.dietary,
  }
  const kindLabel = isTable ? "Sergio's table" : (KINDS.find((k) => k.key === s.kind)?.title ?? '').replace(/^An? /, '').replace(/^./, (c) => c.toUpperCase())
  const summary = [kindLabel, card.guests && `for ${card.guests}`, card.date && shortDate(card.date)].filter(Boolean).join(', ')

  // ---- State exactly what submitting this unpaid request does. ----
  const seatTotal = night?.pricePerSeat ? money(night.pricePerSeat * s.seats) : null
  const moneyLine = isTable ? <>{seatTotal ? `Listed total: ${seatTotal}. ` : ''}This sends a seat request to Sergio. It does not reserve seats or save a card. Sergio confirms availability, the final arrangements and payment separately.</> : <>This sends your preferred date and details to Sergio. The date is not held or confirmed by this request. No payment is taken; Sergio discusses the quote and arrangements with you.</>
  const cta = isTable ? `Request ${s.seats} ${s.seats === 1 ? 'seat' : 'seats'}` : 'Send request'

  return (
    <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          step < 3 ? next() : submit()
        }}
        className="min-w-0 max-w-xl"
      >
        <div aria-hidden="true" style={{position:'absolute',left:'-10000px',width:1,height:1,overflow:'hidden'}}><label>Website<input name="website" autoComplete="off" tabIndex={-1} value={honeypot} onChange={event=>setHoneypot(event.target.value)}/></label></div>
        {draft && (
          <div role="status" className="mb-8 flex flex-wrap items-center gap-3 rounded-card border border-ink/20 bg-paper p-4">
            <p className="flex-1">You have an unfinished request from {new Date(draft.savedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}.</p>
            <CtaButton
              type="button"
              emphasis="primary"
              onClick={() => {
                setS({ ...EMPTY, ...draft.s })
                setStep(draft.step)
                if (draft.s.date) setMonth(draft.s.date.slice(0, 7))
                setDraft(null)
              }}
            >
              Continue it
            </CtaButton>
            <CtaButton
              type="button"
              emphasis="secondary"
              onClick={() => {
                try{localStorage.removeItem(DRAFT_KEY)}catch{/* Clearing the visible draft still works when storage is blocked. */}
                setDraft(null)
              }}
            >
              Start over
            </CtaButton>
          </div>
        )}

        <p className="text-sm text-ink-muted">
          Step {step + 1} of {steps.length}
        </p>
        <h2 ref={headRef} tabIndex={-1} className="mt-1 text-3xl focus:outline-none">
          {steps[step]}
        </h2>
        <ol className="mt-3 flex gap-1.5" aria-hidden>
          {steps.map((_, i) => (
            <li key={i} className="h-1 flex-1 overflow-hidden rounded-full bg-rule">
              <m.span className="block h-full origin-left bg-brand" initial={false} animate={{ scaleX: i <= step ? 1 : 0 }} transition={{ duration: 0.35, ease }} />
            </li>
          ))}
        </ol>
        {step > 0 && step < 3 && s.kind && (
          <p className="mt-4 font-display text-lg text-ink-muted lg:hidden" data-summary>
            {summary}
          </p>
        )}
        {banner && (
          <p role="alert" className="mt-4 font-medium text-alert">
            {banner}
          </p>
        )}

        <AnimatePresence initial={false} mode="wait" custom={dir}>
          <m.div
            key={`${step}-${isTable}`}
            custom={dir}
            variants={{ enter: (d: number) => ({ opacity: 0, x: d * 28 }), center: { opacity: 1, x: 0 }, exit: (d: number) => ({ opacity: 0, x: d * -28 }) }}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.22, ease }}
            className="mt-8 space-y-7"
            data-step={step}
          >
            {step === 0 && (
              <fieldset>
                <legend className="sr-only">What are you planning?</legend>
                <RadioGroup.Root id="f-kind" value={s.kind} onValueChange={(v) => set({ kind: v as Kind, where: v === 'dinner' ? s.where : s.where === 'his' ? 'home' : s.where })} className="space-y-3" aria-describedby={errors.kind ? 'f-kind-err' : undefined}>
                  {KINDS.filter((k) => k.on).map((k) => (
                    <RadioGroup.Item key={k.key} value={k.key} className={`flex w-full items-start gap-4 p-4 text-left ${tile}`}>
                      <span className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-ink/50">
                        <RadioGroup.Indicator asChild>
                          <m.span className="h-2.5 w-2.5 rounded-full bg-brand" initial={{ scale: 0 }} animate={{ scale: 1 }} transition={snappy} />
                        </RadioGroup.Indicator>
                      </span>
                      <span>
                        <span className="block font-display text-xl">{k.title}</span>
                        <span className="block text-ink-muted">{k.detail}</span>
                      </span>
                    </RadioGroup.Item>
                  ))}
                </RadioGroup.Root>
                <ErrorText id="f-kind" error={errors.kind} />
                <p className="mt-5 text-sm text-ink-muted">
                  Buying for someone else?{' '}
                  <a className="link" href={href('/gift/')}>
                    Get a gift card instead.
                  </a>
                </p>
              </fieldset>
            )}

            {step === 1 && isTable && (
              <>
                {nightsError ? <div><p role="alert" className="text-alert">{nightsError}</p><CtaButton type="button" emphasis="secondary" className="mt-3" onClick={()=>setNightsRetry(value=>value+1)}>Try again</CtaButton></div> : nights ? <NightPicker nights={nights} value={s.nightId} onChange={(id) => {const picked=nights.find(n=>n.id===id);set({ nightId: id, seats: Math.max(1,Math.min(s.seats,booking.table.maxSeatsPerBooking,picked?picked.seats-picked.taken:booking.table.maxSeatsPerBooking)) })}} error={errors.night} /> : <p role="status" className="text-ink-muted">Loading upcoming nights</p>}
                <div id="wrap-f-seats">
                  <p id="seats-label" className="font-medium">
                    Seats
                  </p>
                  <div className="mt-2">
                    <Stepper id="f-seats" value={s.seats} min={1} max={seatsMax} onChange={(n) => set({ seats: n })} labelledBy="seats-label" />
                  </div>
                  <ErrorText id="f-seats" error={errors.seats} />
                  <p className="mt-2 text-sm text-ink-muted">
                    Bringing {booking.table.maxSeatsPerBooking + 1} or more?{' '}
                    <a className="link" href={href('/book/?type=dinner&where=his')}>
                      Book the whole table
                    </a>
                  </p>
                </div>
              </>
            )}

            {step === 1 && !isTable && (
              <>
                <div id="wrap-f-date">
                  <p className="font-medium">Date</p>
                  <p className="mt-1 text-sm text-ink-muted">Please request at least one week ahead. Two weeks’ notice is preferred.</p>
                  {suggested && s.date && (
                    <p id="f-date-hint" className="text-sm text-ink-muted">
                      Suggested from the month you picked. Choose another day if you prefer.
                    </p>
                  )}
                  <div className="mt-3">
                    <Calendar
                      month={month}
                      days={avail?.days ?? []}
                      loading={!avail}
                      value={s.date}
                      minMonth={thisMonth()}
                      nextOpen={avail?.nextOpen ?? null}
                      onMonth={(mo) => {
                        navigated.current = true
                        setMonth(mo)
                      }}
                      onSelect={(d) => {
                        const t = avail?.days.find((x) => x.date === d)?.times ?? []
                        set({ date: d, time: t.includes(s.time ?? '') ? s.time : undefined })
                        setSuggested(false)
                      }}
                    />
                  </div>
                  <input type="hidden" id="f-date" value={s.date ?? ''} />
                  <ErrorText id="f-date" error={errors.date} />
                  {availabilityError && <div className="mt-3"><p role="alert" className="text-alert">{availabilityError}</p><CtaButton type="button" emphasis="secondary" className="mt-3" onClick={()=>setAvailabilityRetry(value=>value+1)}>Try again</CtaButton></div>}
                </div>
                {s.date && times.length > 0 && (
                  <fieldset id="wrap-f-time">
                    <legend className="font-medium">Start time on {longDate(s.date).replace(/,.*/, '')}</legend>
                    <RadioGroup.Root id="f-time" value={s.time} onValueChange={(v) => set({ time: v })} aria-label="Start time" className="mt-2 grid grid-cols-3 gap-2">
                      {times.map((t) => (
                        <RadioGroup.Item key={t} value={t} className={`min-h-[44px] px-2 text-sm font-medium ${tile}`}>
                          {clock(t)}
                        </RadioGroup.Item>
                      ))}
                    </RadioGroup.Root>
                    <ErrorText id="f-time" error={errors.time} />
                  </fieldset>
                )}
                <Check id="f-flex" label="My date is flexible" checked={!!s.flexible} onChange={(v) => set({ flexible: v })} />
                <Field id="f-guests" label="Number of guests" hint={`${bounds.min} to ${bounds.max} for this format`} error={errors.guests}>
                  <Stepper id="f-guests" value={s.guests} min={bounds.min} max={bounds.max} onChange={(n) => set({ guests: n })} />
                </Field>
                <fieldset>
                  <legend className="font-medium">Where?</legend>
                  <RadioGroup.Root value={s.where} onValueChange={(v) => set({ where: v as Where })} className="mt-2 flex flex-wrap gap-2" aria-label="Where">
                    {(
                      [
                        ['home', 'My home', true],
                        ['rental', 'A vacation rental', site.features.vacationRentals],
                        ['his', 'Sergio’s whole table', site.features.sergiosTable && s.kind === 'dinner'],
                      ] as const
                    )
                      .filter(([, , on]) => on)
                      .map(([v, l]) => (
                        <RadioGroup.Item key={v} value={v} className={`min-h-[44px] px-4 ${tile}`}>
                          {l}
                        </RadioGroup.Item>
                      ))}
                  </RadioGroup.Root>
                </fieldset>
                {s.where !== 'his' && (
                  <Field id="f-place" label={s.where === 'rental' ? 'Rental community or area' : 'City or neighborhood'} hint={`Sergio cooks across ${site.area}.`} error={errors.place}>
                    <input id="f-place" maxLength={300} autoComplete="address-level2" value={s.place ?? ''} onChange={(e) => set({ place: e.target.value })} aria-invalid={!!errors.place} className={inputCls} placeholder={s.where === 'rental' ? 'e.g. Reunion, Kissimmee' : 'e.g. Winter Park'} />
                  </Field>
                )}
              </>
            )}

            {step === 2 && (
              <>
                {isTable && night && (
                  <div className="rounded-card border border-ink/15 bg-paper p-4">
                    <p className="font-medium">The menu: {night.title}</p>
                    <p className="mt-1 text-ink-muted">{night.menu}</p>
                  </div>
                )}
                {!isTable && (
                  <>
                    <Field id="f-occasion" label="What's the occasion?">
                      <select id="f-occasion" value={s.occasion ?? ''} onChange={(e) => set({ occasion: e.target.value || undefined })} className={inputCls}>
                        <option value="">Choose one (optional)</option>
                        {OCCASIONS.map((o) => (
                          <option key={o}>{o}</option>
                        ))}
                      </select>
                    </Field>
                    <fieldset>
                      <legend className="font-medium">Any of Sergio's dishes you'd like?</legend>
                      <p className="text-sm text-ink-muted">Optional. Your menu is written with you either way.</p>
                      <div className="mt-2 grid gap-x-6 sm:grid-cols-2">
                        {dishes.map((d) => (
                          <Check key={d.name} id={`dish-${d.name}`} label={d.name} checked={s.dishes.includes(d.name)} onChange={(v) => toggle('dishes', d.name, v)} />
                        ))}
                      </div>
                    </fieldset>
                  </>
                )}
                <fieldset>
                  <legend className="font-medium">Dietary needs</legend>
                  <div className="mt-2 grid gap-x-6 sm:grid-cols-2">
                    {DIETARY.map((d) => (
                      <Check key={d} id={`diet-${d}`} label={d} checked={s.dietary.includes(d)} onChange={(v) => toggle('dietary', d, v)} />
                    ))}
                  </div>
                </fieldset>
                <Field id="f-notes" error={errors.notes} label="Anything else Sergio should know?" hint="Allergies, favorite foods, the mood you want.">
                  <textarea id="f-notes" rows={4} maxLength={4000} value={s.notes} onChange={(e) => set({ notes: e.target.value })} className={`${inputCls} py-3`} aria-describedby="f-notes-hint" />
                </Field>
              </>
            )}

            {step === 3 && (
              <>
                <MenuCard data={card} className="mb-4 lg:hidden" />
                <Field id="f-name" label="Your name" error={errors.name}>
                  <input id="f-name" minLength={2} maxLength={150} autoComplete="name" value={s.name} onChange={(e) => set({ name: e.target.value })} aria-invalid={!!errors.name} className={inputCls} />
                </Field>
                <Field id="f-email" label="Email" error={errors.email}>
                  <input id="f-email" type="email" maxLength={254} autoComplete="email" value={s.email} onChange={(e) => set({ email: e.target.value })} aria-invalid={!!errors.email} className={inputCls} />
                </Field>
                <Field id="f-phone" label="Phone" error={errors.phone}>
                  <input id="f-phone" type="tel" maxLength={40} autoComplete="tel" value={s.phone} onChange={(e) => set({ phone: e.target.value })} aria-invalid={!!errors.phone} className={inputCls} />
                </Field>
                <fieldset>
                  <legend className="font-medium">Best way to reach you</legend>
                  <RadioGroup.Root value={s.contactBy} onValueChange={(v) => set({ contactBy: v as State['contactBy'] })} className="mt-2 flex flex-wrap gap-2">
                    {(
                      [
                        ['call', 'Call me'],
                        ['text', 'Text me'],
                        ['email', 'Email me'],
                      ] as const
                    ).map(([v, l]) => (
                      <RadioGroup.Item key={v} value={v} className={`min-h-[44px] px-4 ${tile}`}>
                        {l}
                      </RadioGroup.Item>
                    ))}
                  </RadioGroup.Root>
                </fieldset>
                {giftOpen ? (
                  <Field id="f-gift" label="Gift card code" hint="Sergio reviews the code and confirms any credit separately.">
                    <input id="f-gift" maxLength={100} value={s.gift} onChange={(e) => set({ gift: e.target.value.toUpperCase() })} className={inputCls} />
                  </Field>
                ) : (
                  <button type="button" className="link text-left" onClick={() => setGiftOpen(true)}>
                    Have a gift card?
                  </button>
                )}
                <div className="rounded-card border border-ink/15 bg-paper p-4" data-money-line>
                  <p>{moneyLine}</p>
                  <p className="mt-2 text-sm text-ink-muted">
                    Cancellation and changes: <a className="link" href={href('/#faq')}>see the policy</a>.
                  </p>
                </div>
              </>
            )}
          </m.div>
        </AnimatePresence>

        {status === 'failed' && (
          <p role="alert" className="mt-6 font-medium text-alert">
            {submissionError || 'Your request could not be confirmed. Please retry.'} Your entries are still here. You can also call {site.phone}.
          </p>
        )}

        <div className="cta-pair mt-10">
          {step > 0 && (
            <CtaButton
              type="button"
              emphasis="secondary"
              disabled={status === 'sending'}
              onClick={() => {
                setErrors({})
                go(step - 1)
              }}
            >
              Back
            </CtaButton>
          )}
          <CtaButton emphasis="primary" type="submit" disabled={status === 'sending'} aria-busy={status === 'sending' || undefined} aria-live="polite">
            {step < 3 ? 'Continue' : status === 'sending' ? 'Sending' : cta}
          </CtaButton>
        </div>
      </form>

      <div className="hidden lg:sticky lg:top-24 lg:block">
        <MenuCard data={card} live />
        <p className="mt-4 text-center text-sm text-ink-muted">Your card fills in as you go. Sergio receives it with your request.</p>
      </div>
    </div>
  )
}
