import { useEffect, useRef, type ReactNode } from 'react'
import { createDepthSequence, type DepthBoundary, type DepthSequenceSnapshot } from './depth-sequence'
import { DEPTH_GATE } from './depth-gate'
import './HomeDepth.css'

declare global {
  interface Window { __depthStudy?: Record<string, unknown> & Partial<DepthSequenceSnapshot> }
}

const clamp = (n: number) => Math.max(0, Math.min(1, n))
const layoutTop = (element: HTMLElement) => {
  let top = 0
  for (let node: HTMLElement | null = element; node; node = node.offsetParent as HTMLElement | null) top += node.offsetTop
  return top
}
const poseKeys = ['--depth-y', '--depth-z', '--depth-tilt', '--depth-shade', '--depth-edge', '--depth-crop']

/** One gesture owner for the original homepage sections and footer. */
export function HomeDepth({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const element = root.current!, header = document.querySelector('header')!
    const planes = Array.from(element.querySelectorAll<HTMLElement>(':scope > main > section, :scope > footer'))
    const reduced = matchMedia('(prefers-reduced-motion: reduce)')
    let enabled = false, measureFrame = 0, headerHeight = 0, disposed = false
    let touchY: number | null = null, touchX = 0, touchTime = 0, touchVelocity = 0, touchCaptured = false, coastFrame = 0
    let painted: HTMLElement[] = [], heights: number[] = []
    const study: Record<string, unknown> = { enabled: false, reason: 'initializing', planes: [] }
    window.__depthStudy = study
    const ids = planes.map((plane, index) => plane.id || plane.getAttribute('aria-labelledby') || `section-${index + 1}`)
    planes.forEach((plane, index) => {
      plane.dataset.depthPlane = ids[index]
      if (getComputedStyle(plane).position === 'static') plane.dataset.depthPosition = 'static'
      const background = getComputedStyle(plane).backgroundColor
      if (background !== 'transparent' && background !== 'rgba(0, 0, 0, 0)') plane.dataset.depthSurface = 'opaque'
    })

    const resetPaint = () => {
      for (const plane of painted) {
        plane.removeAttribute('data-depth-pose')
        poseKeys.forEach((key) => plane.style.removeProperty(key))
      }
      painted = []
    }
    const paint = (state: DepthSequenceSnapshot) => {
      Object.assign(study, state, { enabled, header: headerHeight })
      element.dataset.depthPhase = state.phase
      resetPaint()
      if (!enabled || state.activeIndex < 0) return
      const back = planes[state.activeIndex], front = planes[state.activeIndex + 1]
      if (!back || !front) return
      // Pose follows position even at rest: letting go halfway through a
      // section must not pop the plane back to its untransformed layout.
      const p = clamp(state.progress)
      if (p <= 0 || p >= 1) return
      const arc = Math.sin(Math.PI * p)
      // Preserve vertical document geometry and native hit testing. Depth
      // and shading add weight without parking links under the next plane.
      const backTilt = 5 * arc
      // Keep the lowest rotated corner above the parent's hit-test plane.
      // Negative world Z makes visible outgoing links fall behind <main>.
      const backDepth = 1 + .22 * (heights[state.activeIndex] || 0) * Math.sin(backTilt * Math.PI / 180)
      back.dataset.depthPose = 'back'
      back.style.setProperty('--depth-y', '0px')
      back.style.setProperty('--depth-z', `${backDepth}px`)
      back.style.setProperty('--depth-tilt', `${-backTilt}deg`)
      back.style.setProperty('--depth-shade', String(.14 * arc))
      back.style.setProperty('--depth-crop', '0px')
      front.dataset.depthPose = 'front'
      front.style.setProperty('--depth-z', `${90 * arc}px`)
      front.style.setProperty('--depth-tilt', `${2.5 * arc}deg`)
      front.style.setProperty('--depth-edge', String(.3 * arc))
      painted = [back, front]
    }
    const controller = createDepthSequence({ boundaries: [], onUpdate: paint })
    const stopCoast = () => { cancelAnimationFrame(coastFrame); coastFrame = 0 }
    const measure = () => {
      if (disposed) return
      headerHeight = header.getBoundingClientRect().height
      heights = planes.map((plane) => plane.offsetHeight)
      const tops = planes.map(layoutTop)
      const maxScroll = Math.max(0, document.documentElement.scrollHeight - innerHeight)
      const boundaries: DepthBoundary[] = []
      let previousEnd = 0
      for (let index = 0; index < planes.length - 1; index++) {
        const end = Math.max(0, Math.min(maxScroll, tops[index + 1] - headerHeight))
        let start = Math.max(0, tops[index + 1] - innerHeight, tops[index] - headerHeight, previousEnd)
        if (planes[index].matches('[data-plating-timeline]') && window.__platingTimeline?.pinned) {
          start = Math.max(start, window.__platingTimeline.start + window.__platingTimeline.travel)
        }
        start = Math.min(start, end)
        boundaries.push({ id: `${ids[index]}:${ids[index + 1]}`, from: ids[index], to: ids[index + 1], start, end })
        previousEnd = end
      }
      enabled = new URLSearchParams(location.search).get('depth') !== 'off' && !reduced.matches
      study.reason = reduced.matches ? 'reduced-motion' : !enabled ? 'disabled' : 'resistance'
      study.planes = planes.map((plane, index) => ({
        id: ids[index], label: plane.querySelector('h1,h2')?.textContent?.trim() || ids[index],
        top: tops[index], height: heights[index], width: plane.offsetWidth,
      }))
      element.dataset.depthEnabled = String(enabled)
      element.style.setProperty('--depth-header', `${headerHeight}px`)
      element.style.setProperty('--depth-page-width', `${element.clientWidth}px`)
      if (!enabled) { stopCoast(); controller.cancel() }
      controller.configure(boundaries, maxScroll)
      paint(controller.snapshot())
    }
    const scheduleMeasure = () => {
      cancelAnimationFrame(measureFrame)
      measureFrame = requestAnimationFrame(measure)
    }
    const bypass = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return true
      if (target.closest('input,textarea,select,[contenteditable=true],[role=dialog],[data-radix-popper-content-wrapper]')) return true
      for (let node: Element | null = target; node && node !== document.body; node = node.parentElement) {
        const css = getComputedStyle(node)
        if (/(auto|scroll)/.test(css.overflowY) && node.scrollHeight > node.clientHeight + 1) return true
      }
      return false
    }
    const wheel = (event: WheelEvent) => {
      if (!enabled || event.defaultPrevented || !event.cancelable || event.ctrlKey || event.metaKey || Math.abs(event.deltaX) > Math.abs(event.deltaY) || bypass(event.target)) return
      stopCoast()
      const unit = event.deltaMode === 1 ? 20 : event.deltaMode === 2 ? innerHeight : 1
      // Own the vertical sequence from its first event. Some browsers make
      // later wheel events noncancelable once native scrolling has latched.
      event.preventDefault()
      const delta = event.deltaY * unit
      controller.handle(delta, 'wheel')
    }
    const cancel = () => { stopCoast(); controller.cancel() }
    const timelineCapture = () => { touchCaptured = false; touchY = null; touchVelocity = 0; cancel() }
    const touchCancel = () => { touchY = null; touchCaptured = false; cancel() }
    const touchStart = (event: TouchEvent) => {
      stopCoast()
      if (event.touches.length !== 1) cancel()
      touchCaptured = enabled && event.touches.length === 1 && !bypass(event.target)
      touchVelocity = 0
      if (!touchCaptured) { touchY = null; return }
      controller.beginGesture()
      touchY = event.touches[0].clientY
      touchX = event.touches[0].clientX
      touchTime = event.timeStamp
    }
    const touchMove = (event: TouchEvent) => {
      if (!enabled || !touchCaptured || touchY === null) return
      if (event.touches.length !== 1 || !event.cancelable) { touchCancel(); return }
      const next = event.touches[0], delta = touchY - next.clientY
      if (Math.abs(next.clientX - touchX) > Math.abs(delta) * 2 + 12) { touchY = null; touchCaptured = false; cancel(); return }
      event.preventDefault()
      const dt = Math.max(8, event.timeStamp - touchTime)
      touchY = next.clientY; touchX = next.clientX; touchTime = event.timeStamp
      if (delta * touchVelocity < 0) touchVelocity = 0
      touchVelocity = .65 * touchVelocity + .35 * Math.max(-2.5, Math.min(2.5, delta / dt))
      controller.handle(delta, 'touch')
    }
    const touchEnd = (event: TouchEvent) => {
      touchY = null
      touchVelocity *= Math.exp(-Math.max(0, event.timeStamp - touchTime) / 100)
      const captured = touchCaptured
      touchCaptured = false
      if (!captured || Math.abs(touchVelocity) < .12) return
      let previous = performance.now()
      const coast = (now: number) => {
        const dt = Math.min(32, now - previous); previous = now
        touchVelocity *= Math.exp(-dt / DEPTH_GATE.coastDecayMs)
        if (!enabled || Math.abs(touchVelocity) < .03) { coastFrame = 0; return }
        controller.handle(touchVelocity * dt, 'coast')
        coastFrame = requestAnimationFrame(coast)
      }
      coastFrame = requestAnimationFrame(coast)
    }
    const key = (event: KeyboardEvent) => {
      if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' ', 'Tab', 'Escape'].includes(event.key)) cancel()
    }
    const onScroll = () => {
      const current = controller.snapshot()
      if (Math.abs(scrollY - current.nativeY) > .5) controller.reconcile(scrollY)
    }
    const pointer = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') { stopCoast(); if (controller.snapshot().phase === 'transitioning') cancel() }
    }
    const observer = new ResizeObserver(scheduleMeasure)
    observer.observe(header)
    planes.forEach((plane) => observer.observe(plane))
    measure()
    document.fonts.ready.then(() => { if (!disposed) scheduleMeasure() })
    window.addEventListener('wheel', wheel, { passive: false })
    window.addEventListener('plating:scroll-capture', timelineCapture)
    window.addEventListener('site:scroll-start', timelineCapture)
    window.addEventListener('site:scroll-cancel', timelineCapture)
    window.addEventListener('site:scroll-end', cancel)
    window.addEventListener('touchstart', touchStart, { passive: true })
    window.addEventListener('touchmove', touchMove, { passive: false })
    window.addEventListener('touchend', touchEnd, { passive: true })
    window.addEventListener('touchcancel', touchCancel, { passive: true })
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', scheduleMeasure)
    window.addEventListener('pageshow', scheduleMeasure)
    window.addEventListener('keydown', key)
    window.addEventListener('pointerdown', pointer)
    element.addEventListener('focusin', cancel)
    reduced.addEventListener('change', scheduleMeasure)
    return () => {
      disposed = true
      observer.disconnect(); cancelAnimationFrame(measureFrame); stopCoast()
      window.removeEventListener('wheel', wheel); window.removeEventListener('touchstart', touchStart)
      window.removeEventListener('plating:scroll-capture', timelineCapture)
      window.removeEventListener('site:scroll-start', timelineCapture)
      window.removeEventListener('site:scroll-cancel', timelineCapture)
      window.removeEventListener('site:scroll-end', cancel)
      window.removeEventListener('touchmove', touchMove); window.removeEventListener('touchend', touchEnd)
      window.removeEventListener('touchcancel', touchCancel); window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', scheduleMeasure); window.removeEventListener('pageshow', scheduleMeasure)
      window.removeEventListener('keydown', key)
      window.removeEventListener('pointerdown', pointer); element.removeEventListener('focusin', cancel)
      reduced.removeEventListener('change', scheduleMeasure)
      controller.destroy(); resetPaint()
      planes.forEach((plane) => { delete plane.dataset.depthPlane; delete plane.dataset.depthPosition; delete plane.dataset.depthSurface })
      delete window.__depthStudy
    }
  }, [])

  return <div ref={root} className="home-depth" data-depth-study data-depth-enabled="false" data-depth-phase="idle">{children}</div>
}
