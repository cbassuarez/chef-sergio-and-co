import * as RadioGroup from '@radix-ui/react-radio-group'
import { AnimatePresence, m, useReducedMotion } from 'framer-motion'
import { Fragment, useState } from 'react'
import { site, type FormatKey } from '../content/site'
import { CtaButton, CtaLink } from './CallToAction'
import { PressButton, Segmented } from './motion'
import { FromPrice, href, inWords, Photo, track } from './ui'

/*
 * The look-C hero. Each element answers one of the five-second questions, and nothing else is on the first screen:
 *   What is it / is it for me   → H1 (Sergio's own line from his original site) + sub
 *   Where                       → "across Orlando" in the sub
 *   Why him                     → "forty years in restaurant kitchens" (+ credentials on desktop)
 *   What does it cost           → the price line, which follows the chosen format
 *   What do I do                → the card: one tap to start, then "Check your date"
 *   Will I like the food        → the dish, set on the corner of the card
 * The card is the menu card from the rest of the site, now doing the work of the form: it writes itself as you tap.
 */
export const HERO_H1 = 'Your home. Your guests. Your private chef.'
// His line is three short sentences: one per line, so the rhythm survives every width (no orphaned "Your").
const H1_LINES = ['Your home.', 'Your guests.', 'Your private chef.']

type When = 'this' | 'next' | 'later'
const WHEN: { value: When; label: string }[] = [
  { value: 'this', label: 'This month' },
  { value: 'next', label: 'Next month' },
  { value: 'later', label: 'Later' },
]
const NOUN: Record<FormatKey, string> = { dinner: 'private dinner', class: 'cooking class', event: 'small event' }
const WHEN_PHRASE: Record<When, string> = { this: 'this month', next: 'next month', later: 'in a few months' }
const PRICE_KEY = { dinner: 'dinnerFromPerGuest', class: 'classFromPerGuest', event: 'eventFromPerGuest' } as const

export function HeroQuickStart() {
  const [format, setFormat] = useState<FormatKey>('dinner')
  const [guests, setGuests] = useState(6)
  const [when, setWhen] = useState<When>('next')
  const [turn, setTurn] = useState(0) // the dish turns a little with every choice: the hero's one state-driven motion
  const reduce = useReducedMotion()
  const b = site.formats[format]
  const g = Math.min(b.max, Math.max(b.min, guests))
  const stir = (by: number) => setTurn((t) => t + by)
  const sentence = `${/^[aeiou]/.test(NOUN[format]) ? 'An' : 'A'} ${NOUN[format]} for ${inWords(g)}, ${WHEN_PHRASE[when]}`

  const go = () => {
    track('cta_check_date', { where: 'hero', format, when })
    window.location.href = href(`/book/?${new URLSearchParams({ type: format, guests: String(g), when })}`)
  }

  return (
    <section className="on-brand relative overflow-hidden bg-brand text-onbrand">
      <div className="wrap grid gap-0 pb-10 pt-5 md:pt-12 lg:grid-cols-[1fr_26rem] lg:items-center lg:gap-12 lg:py-16 xl:gap-16">
        <div>
          <h1 className="text-[2.05rem] leading-[0.98] sm:text-6xl lg:text-[clamp(3.2rem,4.4vw,4.1rem)]">
            {/* <br>, not block spans: block children would each be a separate LCP candidate, letting the dish image win. */}
            {H1_LINES.map((l, i) => (
              <Fragment key={l}>
                {l}
                {i < H1_LINES.length - 1 && (
                  <>
                    {' '}
                    <br />
                  </>
                )}
              </Fragment>
            ))}
          </h1>
          <p className="mt-3 pr-24 text-[0.95rem] leading-snug text-onbrand/85 sm:pr-0 sm:text-lg lg:mt-6 lg:max-w-[30rem] lg:text-xl">
            Chef Sergio cooks dinners, classes and events in Orlando homes, after forty years in restaurant kitchens
          </p>
          <ul className="mt-8 hidden max-w-[30rem] gap-2 text-onbrand/85 lg:grid">
            {[`${site.credentials[0].body} culinary diploma, ${site.credentials[0].year}`, 'Organic ingredients. No seed oils. Nothing frozen.'].map((t) => (
              <li key={t} className="flex items-start gap-3">
                <svg aria-hidden width="18" height="18" viewBox="0 0 20 20" className="mt-1 shrink-0">
                  <circle cx="10" cy="10" r="9" fill="none" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M6 10.5 8.6 13 14 7.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
                </svg>
                {t}
              </li>
            ))}
          </ul>
        </div>

        <div className="relative mt-14 sm:mt-20 lg:mt-0">
          {/* The dish, set on the corner of the card. Outer element carries the state rotation; inner carries the one entrance. */}
          <div
            aria-hidden
            className="absolute -right-6 -top-20 h-[7.25rem] w-[7.25rem] transition-transform duration-500 ease-[var(--ease)] sm:h-44 sm:w-44 sm:-top-28 lg:-right-44 lg:-top-20 lg:h-[27rem] lg:w-[27rem]"
            style={{ transform: `rotate(${reduce ? 0 : turn * 12}deg)` }}
          >
            <div className="pan-in h-full w-full rounded-full shadow-[0_8px_24px_rgba(0,0,0,0.12)] ring-2 ring-[rgb(var(--c-ink))]">
              <Photo slot="hero-dish" alt="" sizes="(min-width: 1024px) 27rem, (min-width: 640px) 11rem, 7.25rem" className="h-full w-full rounded-full" />
            </div>
          </div>

          <form
            action={href('/book/')}
            onSubmit={(e) => {
              e.preventDefault()
              go()
            }}
            className="relative rounded-[24px] bg-canvas p-4 text-ink shadow-[0_0_0_2px_rgb(var(--c-ink)),0_8px_24px_rgba(0,0,0,0.08)]"
          >
            <p className="hidden text-sm font-medium sm:block">Plan your evening</p>
            <div data-hero-first className="sm:mt-2">
              <Segmented
                label="What are you planning?"
                value={format}
                onChange={(v) => {
                  setFormat(v)
                  stir(1)
                }}
                options={[
                  { value: 'dinner', label: 'Dinner' },
                  { value: 'class', label: 'Class' },
                  { value: 'event', label: 'Event' },
                ]}
              />
            </div>

            <div className="mt-3 flex items-center justify-between gap-3">
              <span id="hero-guests" className="font-medium">
                Guests
              </span>
              <div className="flex items-center gap-2" role="group" aria-labelledby="hero-guests">
                <PressButton type="button" className="btn-quiet h-11 min-h-[44px] w-11 px-0 text-xl" aria-label="One fewer guest" disabled={g <= b.min} onClick={() => { setGuests(g - 1); stir(-0.25) }}>
                  −
                </PressButton>
                <output aria-live="polite" className="w-9 text-center text-xl font-medium tabular-nums">
                  {g}
                </output>
                <PressButton type="button" className="btn-quiet h-11 min-h-[44px] w-11 px-0 text-xl" aria-label="One more guest" disabled={g >= b.max} onClick={() => { setGuests(g + 1); stir(0.25) }}>
                  +
                </PressButton>
              </div>
            </div>

            <RadioGroup.Root value={when} onValueChange={(v) => { setWhen(v as When); stir(0.5) }} aria-label="When" className="mt-3 grid grid-cols-3 gap-2">
              {WHEN.map((w) => (
                <RadioGroup.Item
                  key={w.value}
                  value={w.value}
                  className="min-h-[44px] rounded-btn border border-ink/25 px-1 text-sm font-medium transition-[background-color,border-color,transform] duration-150 hover:border-ink/60 active:scale-[0.97] data-[state=checked]:border-brand data-[state=checked]:bg-brand"
                >
                  {w.label}
                </RadioGroup.Item>
              ))}
            </RadioGroup.Root>

            {/* The card writes itself: the sentence re-inks on every choice (skipped under reduced motion). */}
            <div className="mt-4 min-h-7 overflow-hidden" aria-live="polite">
              <AnimatePresence initial={false} mode="wait">
                <m.p
                  key={sentence}
                  className="text-base font-medium leading-snug"
                  initial={reduce ? false : { clipPath: 'inset(0 100% 0 0)' }}
                  animate={{ clipPath: 'inset(0 0% 0 0)' }}
                  exit={{ opacity: 0, transition: { duration: 0.06 } }}
                  transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                >
                  {sentence}
                </m.p>
              </AnimatePresence>
            </div>
            <p data-price-line className="text-sm text-ink-muted">
              {b.min} to {b.max} guests, <FromPrice k={PRICE_KEY[format]} lower />
            </p>

            <CtaButton emphasis="primary" data-hero-cta type="submit" className="mt-3 w-full">
              Check your date
            </CtaButton>
            <p className="mt-2 text-center text-sm text-ink-muted">Free to ask. Nothing is charged until you approve your menu.</p>
            <CtaLink emphasis="secondary" className="mx-auto mt-0.5 w-fit" href={site.phoneHref} onClick={() => track('cta_call', { where: 'hero' })}>
              Or call {site.phone}
            </CtaLink>
          </form>
        </div>
      </div>
    </section>
  )
}
