import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import credits from '../content/reference-credits.json'
import { dishes } from '../content/menu'
import { IS_PROTOTYPE } from '../content/site'
import { Photo, SectionHead } from './ui'

type Position = { first: number; last: number; atStart: boolean; atEnd: boolean }
type Credit = { creator: string; license: string; license_url: string; landing: string }
const descriptions: Record<string, string> = {
  'dish-vol-au-vent': 'A reference vegetable pastry plated with greens and radish, not Sergio’s food.',
  'dish-lobster-bisque': 'A reference bowl of bisque photographed at the table, not Sergio’s food.',
  'dish-seafood-paella': 'A reference pan of seafood paella, not Sergio’s food.',
  'dish-beef-stroganoff': 'A reference plate of beef stroganoff with noodles, not Sergio’s food.',
  'dish-thai-chicken-curry': 'A reference close view of chicken curry and rice, not Sergio’s food.',
}
const pad = (n: number) => String(n).padStart(2, '0')
const photoSlot = (slot: string) => slot.replace(/^dish-/, 'gallery-')
const licenseName = (credit: Credit) => credit.license === 'cc0' ? 'CC0' :
  `CC ${credit.license.toUpperCase()} ${credit.license_url.match(/licenses\/[^/]+\/([\d.]+)/)?.[1] ?? ''}`.trim()

/** An ordinary scrollable list first; controls and position announcements enhance it. */
export function DishCarousel() {
  const section = useRef<HTMLElement>(null)
  const track = useRef<HTMLUListElement>(null)
  const [enhanced, setEnhanced] = useState(false)
  const [warm, setWarm] = useState(false)
  const [position, setPosition] = useState<Position>({ first: 0, last: 0, atStart: true, atEnd: false })
  const [announcement, setAnnouncement] = useState('')
  const frame = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const requestedOffset = useRef<number | null>(null)
  const shouldAnnounce = useRef(false)

  const readPosition = useCallback((): Position => {
    const element = track.current
    if (!element) return { first: 0, last: 0, atStart: true, atEnd: false }
    const bounds = element.getBoundingClientRect()
    const visible = [...element.children].map((child, index) => {
      const r = child.getBoundingClientRect()
      return { index, fraction: Math.max(0, Math.min(r.right, bounds.right) - Math.max(r.left, bounds.left)) / r.width }
    })
    let shown = visible.filter(item => item.fraction >= .55)
    if (!shown.length) shown = [visible.reduce((best, item) => item.fraction > best.fraction ? item : best)]
    return { first: shown[0].index, last: shown[shown.length - 1].index,
      atStart: element.scrollLeft <= 2, atEnd: element.scrollWidth - element.clientWidth - element.scrollLeft <= 2 }
  }, [])

  const sync = useCallback(() => {
    const next = readPosition()
    setPosition(previous => Object.keys(next).every(key => next[key as keyof Position] === previous[key as keyof Position]) ? previous : next)
    return next
  }, [readPosition])

  const settle = useCallback(() => {
    requestedOffset.current = null
    const next = sync()
    if (shouldAnnounce.current) {
      const range = next.first === next.last ? `${next.first + 1}` : `${next.first + 1} to ${next.last + 1}`
      const names = next.first === next.last ? dishes[next.first].name : `${dishes[next.first].name} through ${dishes[next.last].name}`
      setAnnouncement(`${names}, ${range} of ${dishes.length}.`)
    }
    shouldAnnounce.current = false
  }, [sync])

  const onScroll = useCallback(() => {
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(sync)
    clearTimeout(timer.current)
    timer.current = setTimeout(settle, 160)
  }, [sync, settle])

  const move = useCallback((direction: -1 | 1 | 'first' | 'last') => {
    const element = track.current
    if (!element) return
    const maximum = element.scrollWidth - element.clientWidth
    const origin = element.getBoundingClientRect().left
    const stops = [...new Set([...element.children].map(child =>
      Math.max(0, Math.min(maximum, element.scrollLeft + child.getBoundingClientRect().left - origin))))]
    const current = requestedOffset.current ?? element.scrollLeft
    let destination: number
    if (direction === 'first') destination = 0
    else if (direction === 'last') destination = maximum
    else if (direction === 1) destination = stops.find(stop => stop > current + 2) ?? maximum
    else destination = stops.filter(stop => stop < current - 2).pop() ?? 0
    if (Math.abs(destination - current) <= 2) return
    requestedOffset.current = destination
    shouldAnnounce.current = true
    element.scrollTo({ left: destination, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
    clearTimeout(timer.current)
    timer.current = setTimeout(settle, 180)
  }, [settle])

  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    if (event.target !== event.currentTarget || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
    const key = { ArrowLeft: -1, ArrowRight: 1, Home: 'first', End: 'last' }[event.key] as -1 | 1 | 'first' | 'last' | undefined
    if (key !== undefined) { event.preventDefault(); move(key) }
  }

  useEffect(() => {
    setEnhanced(true)
    sync()
    const element = section.current!
    if (!('IntersectionObserver' in window)) setWarm(true)
    else {
      const observer = new IntersectionObserver(([entry]) => {
        if (entry.isIntersecting) { setWarm(true); observer.disconnect() }
      }, { rootMargin: '320px 0px' })
      observer.observe(element)
      return () => observer.disconnect()
    }
  }, [sync])

  useEffect(() => {
    const resize = new ResizeObserver(sync)
    if (track.current) resize.observe(track.current)
    return () => { resize.disconnect(); cancelAnimationFrame(frame.current); clearTimeout(timer.current) }
  }, [sync])

  return (
    <section ref={section} aria-labelledby="dishes" aria-roledescription={enhanced ? 'carousel' : undefined}
      className="home-dishes section-wash dish-carousel-section" data-dish-carousel>
      <div className="wrap">
        <div className="dish-carousel-heading">
          <SectionHead id="dishes" title="From Sergio's kitchen" intro="A few dishes from Sergio’s menu. Your own menu is written around your guests and occasion." />
          <div className="dish-carousel-controls" data-ready={enhanced} aria-hidden={!enhanced}>
            <button type="button" aria-label="Previous dish" aria-controls="dish-carousel-track" disabled={!enhanced}
              aria-disabled={position.atStart} onClick={() => { if (!position.atStart) move(-1) }}>Previous</button>
            <button type="button" aria-label="Next dish" aria-controls="dish-carousel-track" disabled={!enhanced}
              aria-disabled={position.atEnd} onClick={() => { if (!position.atEnd) move(1) }}>Next</button>
          </div>
        </div>
        <p id="dish-carousel-instructions" className="sr-only">Swipe or scroll to browse.{enhanced && ' When the gallery has keyboard focus, use the left and right arrows, Home or End.'}</p>
        <ul ref={track} id="dish-carousel-track" className="dish-carousel-track" role="list" tabIndex={0}
          aria-label="Dishes from Sergio’s menu" aria-describedby="dish-carousel-instructions" onScroll={onScroll} onKeyDown={onKeyDown}
          onPointerDown={() => { shouldAnnounce.current = true }} onWheel={() => { shouldAnnounce.current = true }}>
          {dishes.map(dish => {
            const slot = photoSlot(dish.slot!)
            const credit = (credits as Record<string, Credit>)[slot]
            return (
              <li key={dish.name} className="dish-carousel-card">
                <figure data-reference-figure={slot}>
                  <div className="dish-carousel-mat">
                    <Photo slot={slot} alt={descriptions[dish.slot!] ?? dish.name} defer loadWhen={warm}
                      sizes="(min-width: 1200px) 500px, (min-width: 701px) calc(46vw - 4rem), calc(88vw - 3.25rem)" className="dish-carousel-image" />
                  </div>
                  <figcaption data-reference-caption={slot}>
                    <h3 className="dish-carousel-title" data-menu-item>{dish.name}</h3>
                    {IS_PROTOTYPE && credit && <p className="dish-carousel-credit">Reference photo · not Sergio’s food.
                      <span>Photo by <a href={credit.landing}>{credit.creator}</a> · <a href={credit.license_url}>{licenseName(credit)}</a></span>
                    </p>}
                  </figcaption>
                </figure>
              </li>
            )
          })}
        </ul>
        <div className="dish-carousel-meta">
          <p>Scroll to explore the dishes</p>
          <p className="dish-carousel-count" data-ready={enhanced}>{pad(position.first + 1)}{position.last !== position.first ? `–${pad(position.last + 1)}` : ''}<span> / {pad(dishes.length)}</span></p>
        </div>
        <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</p>
      </div>
    </section>
  )
}
