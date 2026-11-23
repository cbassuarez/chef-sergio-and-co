type ScrollOptions = { instant?: boolean; focus?: HTMLElement }
type ActiveScroll = { frame: number; lastY: number; finish: (completed: boolean) => void }
let active: ActiveScroll | undefined
let installed = false

export const ANCHOR_CLEARANCE = 24
const signal = (name: 'start' | 'end' | 'cancel') => window.dispatchEvent(new Event(`site:scroll-${name}`))
const maximum = () => Math.max(0, document.documentElement.scrollHeight - innerHeight)
const bounded = (y: number) => Math.max(0, Math.min(maximum(), y))

/** Layout coordinates remain correct while the homepage's planes are transformed. */
export function naturalTop(element: HTMLElement) {
  let top = 0
  for (let node: HTMLElement | null = element; node; node = node.offsetParent as HTMLElement | null) top += node.offsetTop
  return top
}

export function anchorDestination(element: HTMLElement) {
  if (element.id === 'main' || element === document.documentElement) return 0
  const header = document.querySelector<HTMLElement>('[data-site-header] .sergio-header-main')
  return bounded(naturalTop(element) - (header?.getBoundingClientRect().height ?? 0) - ANCHOR_CLEARANCE)
}

function focusDestination(element: HTMLElement) {
  if (!element.hasAttribute('tabindex') && !element.matches('a[href],button,input,select,textarea,summary,[contenteditable]')) {
    element.setAttribute('tabindex', '-1')
    element.addEventListener('blur', () => element.removeAttribute('tabindex'), { once: true })
  }
  element.focus({ preventScroll: true })
}

export function cancelLinkScroll() { active?.finish(false) }

/** One owner for link-driven motion; user input always takes control back. */
export function scrollToAnchor(element: HTMLElement, options: ScrollOptions = {}): Promise<boolean> {
  cancelLinkScroll()
  signal('start')
  const from = scrollY
  const distance = Math.abs(anchorDestination(element) - from)
  const duration = Math.max(360, Math.min(820, 320 + Math.sqrt(distance) * 11))
  return new Promise(resolve => {
    const run: ActiveScroll = {
      frame: 0, lastY: from,
      finish(completed) {
        if (active !== run) return
        cancelAnimationFrame(run.frame)
        active = undefined
        signal('end')
        if (completed && options.focus) focusDestination(options.focus)
        resolve(completed)
      },
    }
    active = run
    if (options.instant || matchMedia('(prefers-reduced-motion: reduce)').matches || distance < 1) {
      scrollTo({ top: anchorDestination(element), behavior: 'instant' })
      run.lastY = scrollY
      run.finish(true)
      return
    }
    let began: number | undefined
    const tick = (now: number) => {
      if (active !== run) return
      began ??= now
      const progress = Math.min(1, (now - began) / duration)
      // A symmetric curve has no initial velocity kick or abrupt final stop.
      const eased = (1 - Math.cos(Math.PI * progress)) / 2
      scrollTo({ top: from + (anchorDestination(element) - from) * eased, behavior: 'instant' })
      run.lastY = scrollY
      if (progress < 1) run.frame = requestAnimationFrame(tick)
      else run.finish(true)
    }
    run.frame = requestAnimationFrame(tick)
  })
}

function fragmentTarget(hash: string): HTMLElement | null {
  if (!hash || hash === '#') return null
  try {
    const id = decodeURIComponent(hash.slice(1))
    return document.getElementById(id) || [...document.getElementsByName(id)].find((node): node is HTMLElement => node instanceof HTMLElement) || null
  } catch { return null }
}

/** Install before React effects, including the timeline's capturing input listeners. */
export function installScrollNavigation() {
  if (installed) return
  installed = true
  const entryField = '__sergioScrollEntry'
  const positions = new Map<string, { x: number; y: number }>()
  const documentKey = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  let entryNumber = 0, currentEntry: string | undefined, restoreFrame = 0
  const newEntry = () => `${documentKey}-${++entryNumber}`
  const stateFor = (key: string) => ({ ...history.state, [entryField]: key })
  const remember = () => {
    if (currentEntry && !restoreFrame) positions.set(currentEntry, { x: scrollX, y: scrollY })
  }
  const cancelRestore = () => { cancelAnimationFrame(restoreFrame); restoreFrame = 0 }
  const interrupt = () => { cancelRestore(); cancelLinkScroll() }
  window.addEventListener('wheel', event => { if (event.deltaX || event.deltaY) interrupt() }, { passive: true, capture: true })
  window.addEventListener('touchstart', interrupt, { passive: true, capture: true })
  window.addEventListener('touchmove', interrupt, { passive: true, capture: true })
  window.addEventListener('pointerdown', interrupt, { passive: true, capture: true })
  window.addEventListener('keydown', interrupt, true)
  window.addEventListener('resize', interrupt)
  window.addEventListener('plating:scroll-capture', interrupt)
  window.addEventListener('scroll', () => {
    if (active && Math.abs(scrollY - active.lastY) > .5) cancelLinkScroll()
    remember()
  }, { passive: true })
  window.addEventListener('site:scroll-end', remember)
  window.addEventListener('pagehide', () => { remember(); interrupt(); signal('cancel') })
  window.addEventListener('popstate', event => {
    const key = event.state?.[entryField]
    const saved = typeof key === 'string' ? positions.get(key) : undefined
    // A fragment traversal can make Chrome realign to its heading instead of
    // the saved reading position. Correct only entries this document owns.
    currentEntry = undefined
    interrupt(); signal('cancel')
    currentEntry = typeof key === 'string' ? key : undefined
    if (!saved) return
    restoreFrame = requestAnimationFrame(() => {
      restoreFrame = 0
      scrollTo({ left: saved.x, top: saved.y, behavior: 'instant' })
      remember(); signal('end')
    })
  })
  matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', () => {
    interrupt()
  })

  document.addEventListener('click', event => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    const source = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null
    if (!source || source.hasAttribute('download') || source.target && source.target !== '_self') return
    const next = new URL(source.href, location.href)
    if (next.origin !== location.origin || next.pathname !== location.pathname || next.search !== location.search) return
    const target = fragmentTarget(next.hash)
    if (!target || !target.getClientRects().length) return
    // Primitive state belongs to another navigation owner; keep its link native.
    if (history.state !== null && typeof history.state !== 'object') return
    // Assistive activation can click without an earlier pointer or key event.
    cancelRestore()
    try {
      if (!currentEntry) {
        const key = newEntry()
        history.replaceState(stateFor(key), '', location.href)
        currentEntry = key
      }
      remember()
      if (next.href !== location.href) {
        const key = newEntry()
        history.pushState(stateFor(key), '', next.href)
        currentEntry = key
        remember()
      }
    }
    catch { return }
    event.preventDefault()
    const focus = target.id === 'main' || target.matches('h1,h2,h3,h4,h5,h6')
      ? target : target.querySelector<HTMLElement>('h1,h2,h3,h4,h5,h6') || target
    void scrollToAnchor(target, { instant: source.hasAttribute('data-skip-link'), focus })
  })

  // Initial fragments and full-document restoration stay native. A delayed alignment
  // here would overwrite input made while the prerendered document was loading.
}
