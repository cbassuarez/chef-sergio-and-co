import type { ReactNode } from 'react'
import credits from '../content/reference-credits.json'
import { IS_PROTOTYPE, LOOK, site } from '../content/site'
import { shotBySlot } from '../content/shots'
import { DeferredImage } from './DeferredImage'

export const BASE = import.meta.env.BASE_URL
export const href = (p: string) => BASE + p.replace(/^\//, '')

/** A decision Sergio still has to make. Visible in the prototype; build:prod fails if any remain. */
export function TBD({ k, children }: { k: string; children: ReactNode }) {
  return (
    <mark data-tbd={k} className="tbd" title="To decide before launch">
      {children}
    </mark>
  )
}

/** Render a policy string, or a TBD marker describing what's needed. */
export function Policy({ k, need }: { k: keyof typeof site.policies; need: string }) {
  const v = site.policies[k]
  return v ? <>{v}</> : <TBD k={`policies.${k}`}>{need}</TBD>
}

/** "From $X per guest". Pass `lower` when it continues a sentence ("2 to 12 guests, from $X per guest"). */
export function FromPrice({ k, unit = 'per guest', lower = false }: { k: keyof typeof site.pricing; unit?: string; lower?: boolean }) {
  const v = site.pricing[k]
  const from = lower ? 'from' : 'From'
  return v ? (
    <>
      {from} ${v} {unit}
    </>
  ) : (
    <>
      {from} <TBD k={`pricing.${k}`}>$ price</TBD> {unit}
    </>
  )
}

type Credit = {
  files: { w: number; file: string }[]
  width: number
  height: number
  title: string
  creator: string
  license: string
  provider: string
  landing: string
}

/**
 * A photo slot. In the prototype it shows the watermarked reference for that slot.
 * When Sergio's own photo exists it goes in src/content/photos (not yet created), and the reference is retired.
 */
export function Photo({
  slot,
  alt,
  sizes = '100vw',
  className = '',
  priority = false,
  defer = false,
  loadWhen,
  position,
}: {
  slot: string
  alt: string
  sizes?: string
  className?: string
  priority?: boolean
  /** Use only for photos beyond the opening and its next-section handoff. */
  defer?: boolean
  /** Optional external loading gate for a deferred gallery; does not affect ordinary photos. */
  loadWhen?: boolean
  position?: string
}) {
  const c = (credits as Record<string, Credit>)[slot]
  if (!c || !IS_PROTOTYPE) {
    return (
      <div
        data-tbd={`photo.${slot}`}
        className={`flex items-center justify-center bg-sage/30 p-4 text-center text-sm text-ink-muted ${className}`}
      >
        Photo needed: {shotBySlot[slot]?.spec ?? slot}
      </div>
    )
  }
  const largest = c.files[c.files.length - 1]
  // In the all-looks prototype, inactive heroes are display:none; eager images there would still download.
  const eager = priority && LOOK !== 'all'
  const Image = defer && !priority ? DeferredImage : 'img'
  return (
    <Image
      {...(defer && !priority ? { loadWhen } : {})}
      src={href(largest.file)}
      srcSet={c.files.map((f) => `${href(f.file)} ${f.w}w`).join(', ')}
      sizes={sizes}
      width={c.width}
      height={c.height}
      alt={alt}
      loading={eager ? 'eager' : 'lazy'}
      {...{ fetchpriority: eager ? 'high' : 'auto' }}
      decoding="async"
      data-reference={slot}
      className={`object-cover ${className}`}
      style={{ objectPosition: position }}
    />
  )
}

export function SectionHead({ title, intro, id }: { title: string; intro?: ReactNode; id?: string }) {
  return (
    <div className="max-w-prose">
      <h2 id={id} className="text-3xl md:text-4xl">
        {title}
      </h2>
      {intro && <p className="mt-3 text-lg text-ink-muted">{intro}</p>}
    </div>
  )
}

export function track(event: string, props?: Record<string, string>) {
  // Hook for analytics (Plausible or GA4). No-op until a script is added.
  const w = window as unknown as { plausible?: (e: string, o?: object) => void }
  w.plausible?.(event, props ? { props } : undefined)
}

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty', 'twenty-one', 'twenty-two',
  'twenty-three', 'twenty-four']
export const inWords = (n: number) => WORDS[n] ?? String(n)
