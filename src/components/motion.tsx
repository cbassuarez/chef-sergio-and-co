import * as RadioGroup from '@radix-ui/react-radio-group'
import { domAnimation, LazyMotion, m, MotionConfig, useReducedMotion, type HTMLMotionProps } from 'framer-motion'
import type { ReactNode } from 'react'
import { LOOK, type Look } from '../content/site'

/**
 * Motion rules for this site (the state matrix lives in BRIEF.md):
 * - Motion marks a change of state: hover, press, select, step, write, send. Nothing moves on its own except
 *   one entrance (A's menu card) and the mobile booking bar appearing once the hero CTA scrolls away.
 * - Never hide prerendered content: no `initial` on first render (AnimatePresence initial={false}); entrances are CSS + .js.
 * - Hover only exists on mouse/pen (framer ignores touch for whileHover); every hover has a tap equivalent (whileTap).
 * - prefers-reduced-motion: transforms are skipped (MotionConfig reducedMotion="user") and CSS durations collapse.
 */
export function MotionRoot({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </LazyMotion>
  )
}

export const snappy = { duration: 0.16, ease: [0.22, 1, 0.36, 1] } as const
export const ease = [0.22, 1, 0.36, 1] as const

/** Link styled as a button: hover is a color step (CSS), press is a tiny scale down. Under reduced motion: color only. */
export function PressLink(props: HTMLMotionProps<'a'>) {
  const reduce = useReducedMotion()
  return <m.a whileTap={reduce ? undefined : { scale: 0.97 }} transition={snappy} {...props} />
}

export function PressButton(props: HTMLMotionProps<'button'>) {
  const reduce = useReducedMotion()
  const on = !reduce && !props.disabled
  return <m.button whileTap={on ? { scale: 0.97 } : undefined} transition={snappy} {...props} />
}

/**
 * Segmented choice (Radix RadioGroup) with a selection pill that slides to the chosen option.
 * Pure CSS transform: no layout-animation engine needed, and reduced motion collapses it to an instant move.
 */
export function Segmented<T extends string>({ value, onChange, options, label, className = '' }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; label: string; className?: string }) {
  const i = Math.max(0, options.findIndex((o) => o.value === value))
  const n = options.length
  return (
    <RadioGroup.Root value={value} onValueChange={(v) => onChange(v as T)} aria-label={label} className={`relative grid rounded-btn bg-paper p-1 ${className}`} style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
      <span aria-hidden className="pointer-events-none absolute inset-y-1 left-1 rounded-[max(2px,calc(var(--r-btn)_-_4px))] bg-brand transition-transform duration-300 ease-[var(--ease)]" style={{ width: `calc((100% - 0.5rem) / ${n})`, transform: `translateX(${i * 100}%)` }} />
      {options.map((o) => (
        <RadioGroup.Item key={o.value} value={o.value} className="relative z-[1] min-h-[44px] rounded-[max(2px,calc(var(--r-btn)_-_4px))] px-2 text-sm font-medium transition-colors duration-150 hover:bg-ink/5 data-[state=checked]:text-onbrand data-[state=checked]:hover:bg-transparent">
          {o.label}
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  )
}

/** Renders children only for one look. In the prototype all three are in the HTML and CSS shows the active one. */
export function LookOnly({ look, children }: { look: Look; children: ReactNode }) {
  if (LOOK === 'all') return <div className={`look-only look-only-${look}`}>{children}</div>
  return LOOK === look ? <>{children}</> : null
}
