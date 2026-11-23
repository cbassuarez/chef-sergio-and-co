import { useEffect, useState } from 'react'
import { useOnceVisible } from './useOnceVisible'

/** The real claim is always present once for assistive technology; only the decorative copy rolls. */
export function ExperienceCounter() {
  const { ref, entered } = useOnceVisible<HTMLSpanElement>()
  const [state, setState] = useState<'static' | 'playing' | 'done'>('static')
  useEffect(() => {
    if (!entered) return
    let disposed = false, frame = 0, finish = 0
    const preference = matchMedia('(prefers-reduced-motion: reduce)')
    const settle = () => { if (!disposed) setState('done') }
    const reduce = () => { if (preference.matches) { cancelAnimationFrame(frame); clearTimeout(finish); settle() } }
    preference.addEventListener('change', reduce)
    // Use the final web font and leave the opening's initial paint alone.
    document.fonts.ready.then(() => {
      if (disposed || preference.matches) return
      frame = requestAnimationFrame(() => {
        setState('playing')
        finish = window.setTimeout(settle, 1700)
      })
    })
    return () => { disposed = true; cancelAnimationFrame(frame); clearTimeout(finish); preference.removeEventListener('change', reduce) }
  }, [entered])
  return (
    <span ref={ref} className="home-experience-number experience-counter" data-experience-counter data-counter-state={state}>
      <span className="experience-counter-value">40</span>
      <span className="experience-counter-window" aria-hidden="true">
        <span className="experience-counter-reel" data-counter-reel onAnimationEnd={() => setState('done')}>
          {Array.from({ length: 41 }, (_, number) => <span key={number}>{String(number).padStart(2, '0')}</span>)}
        </span>
      </span>
    </span>
  )
}
