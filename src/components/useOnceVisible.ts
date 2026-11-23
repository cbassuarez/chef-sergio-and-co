import { useEffect, useRef, useState } from 'react'

/** Optional decoration only: SSR, reduced motion and older browsers keep the complete static treatment. */
export function useOnceVisible<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [entered, setEntered] = useState(false)
  useEffect(() => {
    if (entered || !ref.current || !('IntersectionObserver' in window)) return
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    if (preference.matches) return
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting || entry.intersectionRatio < 0.6 || preference.matches) return
      setEntered(true)
      observer.disconnect()
    }, { threshold: 0.6, rootMargin: '0px 0px -6% 0px' })
    observer.observe(ref.current)
    const stop = () => { if (preference.matches) observer.disconnect() }
    preference.addEventListener('change', stop)
    return () => { observer.disconnect(); preference.removeEventListener('change', stop) }
  }, [entered])
  return { ref, entered }
}
