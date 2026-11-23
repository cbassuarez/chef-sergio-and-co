import { useEffect, useRef, useState, type ImgHTMLAttributes } from 'react'

const transparent = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs='

/** Below-fold photos get a head start as the visitor approaches, without competing with the opening. */
export function DeferredImage({ loadWhen, ...props }: ImgHTMLAttributes<HTMLImageElement> & { loadWhen?: boolean }) {
  const image = useRef<HTMLImageElement>(null)
  const [near, setNear] = useState(false)
  const ready = loadWhen ?? near
  useEffect(() => {
    // Galleries can supply one vertical gate before warming their horizontally clipped images.
    if (loadWhen !== undefined) return
    if (!image.current) return
    if (!('IntersectionObserver' in window)) {
      setNear(true)
      return
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return
      setNear(true)
      observer.disconnect()
    }, { rootMargin: '800px 0px' })
    observer.observe(image.current)
    return () => observer.disconnect()
  }, [loadWhen])

  return (
    <>
      <img {...props} ref={image} src={ready ? props.src : transparent} srcSet={ready ? props.srcSet : undefined}
        loading={loadWhen === true ? 'eager' : props.loading} data-deferred-photo data-photo-ready={ready || undefined} />
      <noscript><img {...props} /></noscript>
    </>
  )
}
