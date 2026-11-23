import type { FormatKey } from '../content/site'

/** What is being booked. `table` = seats at a published Sergio's table night. */
export type Kind = FormatKey | 'table'
export type Where = 'home' | 'rental' | 'his'

/** One bookable day and its start times (24h "HH:MM", Sergio's local time). Only open days are listed. */
export type OpenDay = { date: string; times: string[] }
export type Availability = { month: string; days: OpenDay[]; nextOpen: string | null; sample: boolean }

export type NightState = 'pending' | 'confirmed' | 'full' | 'cancelled'
export type Night = {
  id: string
  date: string // yyyy-mm-dd
  start: string // HH:MM
  title: string
  menu: string
  seats: number
  minimum: number
  taken: number
  pricePerSeat: number | null
  cutoff: string // yyyy-mm-dd: if the minimum isn't met by then, the night is cancelled and nobody is charged
  state: NightState
  sample: boolean
}

export type BookingRequest = {
  kind: Kind
  date?: string
  time?: string
  flexible?: boolean
  nightId?: string
  seats?: number
  guests?: number
  where?: Where
  place?: string
  occasion?: string
  dishes?: string[]
  dietary?: string[]
  notes?: string
  name: string
  email: string
  phone: string
  contactBy: 'call' | 'text' | 'email'
  gift?: string
}

export type BookingStatus = 'pending-payment' | 'held' | 'reserved' | 'confirmed' | 'requested' | 'waitlisted'
export type BookingRecord = BookingRequest & {
  ref: string
  status: BookingStatus
  /** what the guest pays (or is charged later for) */
  amount: number | null
  amountWhen: 'now' | 'when-confirmed' | 'after-quote'
  night?: Night
  createdAt: string
}

/** Where the browser goes next after submitting: Stripe Checkout (or the prototype stand-in), or straight to the status page. */
export type HoldResult = { ref: string; next: 'checkout' | 'done'; url: string }

export class BookingError extends Error {
  constructor(
    public code: 'unavailable' | 'seats-gone' | 'invalid' | 'network',
    message: string,
  ) {
    super(message)
  }
}

export interface BookingApi {
  availability(kind: Exclude<Kind, 'table'>, month: string): Promise<Availability>
  nights(): Promise<Night[]>
  hold(req: BookingRequest): Promise<HoldResult>
  booking(ref: string): Promise<BookingRecord | null>
  waitlist(nightId: string, email: string): Promise<void>
}

/** Safe public receipt. Contact details, addresses, dietary notes and private booking data are never returned. */
export type BookingReceipt = {
  ref: string
  status: 'requested' | 'confirmed' | 'cancelled' | 'held'
  kind: Kind
  date: string
  time: string
  guests: number
  nightId?: string
  nightTitle?: string
  amount: null
  amountWhen: 'after-quote'
  createdAt: string
}
export type PublicHoldResult = HoldResult & { next: 'done'; accessToken: string }
export interface PublicBookingApi extends Omit<BookingApi, 'booking' | 'hold' | 'waitlist'> {
  hold(req: BookingRequest, honeypot?: string): Promise<PublicHoldResult>
  booking(ref: string): Promise<BookingReceipt | null>
  waitlist(nightId: string, email: string, honeypot?: string): Promise<void>
}
