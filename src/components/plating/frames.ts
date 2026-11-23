export type PlatingScene = {
  setProgress: (progress: number) => void
  resize: () => void
  dispose: () => void
}

type Variant = 'desktop' | 'mobile'
type FrameSize = { width: number; height: number; directory: string }
type Manifest = {
  version: 1
  frames: number[]
  stations: [number, number, number, number]
  desktop: FrameSize
  mobile: FrameSize
  poster: string
}
type DecodedFrame = {
  key: string
  index: number
  variant: Variant
  image: ImageBitmap | HTMLImageElement
  width: number
  height: number
  close: () => void
}
type Job = {
  key: string
  index: number
  variant: Variant
  kind: 'near' | 'warm'
  priority: number
  order: number
  attempts: number
  controller?: AbortController
}

const MAX_PARALLEL = 4
const clamp = (n: number) => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0))
const abortError = () => new DOMException('The plating frame request was cancelled.', 'AbortError')

function readManifest(value: unknown): Manifest {
  const manifest = value as Partial<Manifest> | null
  const validSize = (size: FrameSize | undefined) => Boolean(size
    && Number.isFinite(size.width) && size.width > 0
    && Number.isFinite(size.height) && size.height > 0
    && typeof size.directory === 'string' && /^[a-z0-9_-]+$/i.test(size.directory))
  if (!manifest || manifest.version !== 1
    || !Array.isArray(manifest.frames) || manifest.frames.length < 4
    || !manifest.frames.every(frame => Number.isInteger(frame) && frame >= 0)
    || !Array.isArray(manifest.stations) || manifest.stations.length !== 4
    || !manifest.stations.every((index, i, all) => Number.isInteger(index) && index >= 0
      && index < manifest.frames!.length && (i === 0 || index > all[i - 1]))
    || !validSize(manifest.desktop) || !validSize(manifest.mobile)
    || typeof manifest.poster !== 'string') {
    throw new Error('The plating sequence manifest is invalid.')
  }
  return manifest as Manifest
}

/** Decode independently of the DOM. Safari versions without createImageBitmap
 * use an Image backed by a short-lived object URL; both paths honour teardown.
 */
async function decodeImage(blob: Blob, signal: AbortSignal): Promise<{
  image: ImageBitmap | HTMLImageElement; width: number; height: number; close: () => void
}> {
  if (signal.aborted) throw abortError()
  if (typeof createImageBitmap === 'function') {
    const image = await createImageBitmap(blob)
    if (signal.aborted) { image.close(); throw abortError() }
    return { image, width: image.width, height: image.height, close: () => image.close() }
  }
  const image = new Image()
  image.decoding = 'async'
  const url = URL.createObjectURL(blob)
  try {
    await new Promise<void>((resolve, reject) => {
      const clean = () => {
        image.onload = null
        image.onerror = null
        signal.removeEventListener('abort', onAbort)
      }
      const onAbort = () => { clean(); image.src = ''; reject(abortError()) }
      image.onload = () => { clean(); resolve() }
      image.onerror = () => { clean(); reject(new Error('A plating frame could not be decoded.')) }
      signal.addEventListener('abort', onAbort, { once: true })
      if (signal.aborted) { onAbort(); return }
      image.src = url
    })
    if (signal.aborted) throw abortError()
    return { image, width: image.naturalWidth, height: image.naturalHeight, close: () => { image.src = '' } }
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Scroll scrubs real, offline-rendered simulation frames. Only a small working
 * set is fetched and decoded; an outstanding request never blanks the canvas.
 */
export function createPlatingScene(
  host: HTMLElement,
  options: { onReady?: () => void; onError?: (error: unknown) => void } = {},
): PlatingScene {
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d', { alpha: true })
  if (!context) {
    const error = new Error('A canvas is unavailable for the plating sequence.')
    options.onError?.(error)
    throw error
  }
  const ctx = context
  const base = `${import.meta.env.BASE_URL}art/plating/`
  const lifetime = new AbortController()
  const cache = new Map<string, DecodedFrame>()
  const queue = new Map<string, Job>()
  const active = new Map<string, Job>()
  const warmed = new Set<Variant>()
  const failures = new Map<string, number>()
  let manifest: Manifest | undefined
  let disposed = false
  let ready = false
  let reportedError = false
  let progress = 0
  let variant: Variant = 'desktop'
  let width = 0
  let height = 0
  let pixelRatio = 1
  let order = 0
  let desiredKey = ''
  let desiredIndex = 0
  let displayed: DecodedFrame | undefined
  let displayedProgress = 0

  canvas.setAttribute('aria-hidden', 'true')
  canvas.setAttribute('role', 'presentation')
  Object.assign(canvas.style, { display: 'block', position: 'absolute', inset: '0', width: '100%', height: '100%' })
  host.appendChild(canvas)

  function report(error: unknown) {
    if (disposed || reportedError) return
    reportedError = true
    host.dataset.frameLoading = 'error'
    options.onError?.(error)
  }

  function touch(frame: DecodedFrame) {
    cache.delete(frame.key)
    cache.set(frame.key, frame)
  }

  function trimCache() {
    const limit = variant === 'mobile' ? 16 : 12
    while (cache.size > limit) {
      const oldest = [...cache.values()].find(frame => frame.key !== displayed?.key)
      if (!oldest) return
      cache.delete(oldest.key)
      oldest.close()
    }
  }

  function paint(frame: DecodedFrame, paintedProgress: number) {
    if (disposed || width < 1 || height < 1) return false
    try {
      ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.clearRect(0, 0, width, height)
      // The full physical scene keeps its original aspect ratio. Desktop crops
      // only the empty lower region; phones bottom-align the shorter full image.
      const naturalHeight = frame.height * width / frame.width
      const top = Math.max(0, height - naturalHeight)
      ctx.drawImage(frame.image, 0, top, width, naturalHeight)
      displayed = frame
      displayedProgress = paintedProgress
      touch(frame)
      canvas.dataset.progress = paintedProgress.toFixed(4)
      canvas.dataset.frame = String(frame.index)
      canvas.dataset.simulationFrame = String(manifest?.frames[frame.index] ?? frame.index)
      canvas.dataset.variant = frame.variant
      if (!ready) {
        ready = true
        options.onReady?.()
      }
      return true
    } catch (error) {
      report(error)
      return false
    }
  }

  function indexAt(value: number) {
    if (!manifest) return 0
    const position = clamp(value) * 3
    const segment = Math.min(2, Math.floor(position))
    const fraction = position - segment
    const start = manifest.stations[segment], end = manifest.stations[segment + 1]
    return Math.round(start + (end - start) * fraction)
  }

  function keyAt(type: Variant, index: number) { return `${type}:${index}` }

  function enqueue(index: number, priority: number, kind: Job['kind'] = 'near') {
    if (!manifest || disposed || index < 0 || index >= manifest.frames.length) return
    const key = keyAt(variant, index)
    if (cache.has(key) || active.has(key)) return
    if (Date.now() - (failures.get(key) ?? 0) < 10_000) return
    const existing = queue.get(key)
    if (existing) {
      existing.priority = Math.min(existing.priority, priority)
      if (kind === 'near') existing.kind = kind
      return
    }
    queue.set(key, { key, index, variant, priority, kind, order: order++, attempts: 0 })
  }

  function warmStops() {
    if (!manifest || warmed.has(variant)) return
    warmed.add(variant)
    // At most twelve unique warm frames: four settled poses and immediate
    // neighbours. This never downloads the full simulation on initial load.
    for (const station of manifest.stations) {
      enqueue(station, 6, 'warm')
      enqueue(station - 1, 7, 'warm')
      enqueue(station + 1, 7, 'warm')
    }
  }

  function requestPaint() {
    if (!manifest || disposed || width < 1 || height < 1) return
    desiredIndex = indexAt(progress)
    desiredKey = keyAt(variant, desiredIndex)
    const frame = cache.get(desiredKey)
    if (frame) {
      if (paint(frame, progress) && !disposed) host.dataset.frameLoading = 'false'
    } else {
      host.dataset.frameLoading = 'true'
    }
    // Discard stale speculative positions when the user scrubs a long way.
    for (const [key, job] of queue) {
      if (job.variant !== variant || (job.kind === 'near' && Math.abs(job.index - desiredIndex) > 3)) queue.delete(key)
      else if (job.kind === 'near') job.priority = Math.abs(job.index - desiredIndex)
    }
    enqueue(desiredIndex, 0)
    enqueue(desiredIndex + 1, 1)
    enqueue(desiredIndex - 1, 1)
    enqueue(desiredIndex + 2, 2)
    enqueue(desiredIndex - 2, 2)
    warmStops()
    pump()
  }

  async function load(job: Job) {
    const controller = new AbortController()
    job.controller = controller
    const onAbort = () => controller.abort()
    lifetime.signal.addEventListener('abort', onAbort, { once: true })
    try {
      if (lifetime.signal.aborted || disposed) throw abortError()
      const directory = manifest![job.variant].directory
      const filename = `${String(job.index).padStart(4, '0')}.webp`
      const response = await fetch(`${base}${directory}/${filename}`, { signal: controller.signal })
      if (!response.ok) throw new Error(`Plating frame ${job.index} returned HTTP ${response.status}.`)
      const decoded = await decodeImage(await response.blob(), controller.signal)
      if (disposed || controller.signal.aborted || job.variant !== variant) { decoded.close(); return }
      if (decoded.width < 1 || decoded.height < 1) { decoded.close(); throw new Error('A plating frame has no dimensions.') }
      const frame: DecodedFrame = { ...decoded, key: job.key, index: job.index, variant: job.variant }
      cache.set(job.key, frame)
      if (job.key === desiredKey && paint(frame, progress) && !disposed) host.dataset.frameLoading = 'false'
      trimCache()
    } catch (error) {
      if (disposed || controller.signal.aborted || lifetime.signal.aborted) return
      // Retry a currently requested asset once. A later missing frame keeps the
      // last real image visible instead of discarding an already working scene.
      if (job.key === desiredKey && job.attempts < 1) {
        job.attempts++
        job.priority = 0
        queue.set(job.key, job)
      } else {
        failures.set(job.key, Date.now())
        if (job.key === desiredKey) {
          host.dataset.frameLoading = 'error'
          if (!ready) report(error)
        }
      }
    } finally {
      lifetime.signal.removeEventListener('abort', onAbort)
      active.delete(job.key)
      // A rapid desktop -> phone -> desktop resize may return to this key
      // before its cancelled fetch settles. Requeue the newly desired asset.
      if (!disposed && controller.signal.aborted && job.variant === variant && job.key === desiredKey) enqueue(job.index, 0)
      pump()
    }
  }

  function pump() {
    if (disposed || !manifest) return
    while (active.size < MAX_PARALLEL && queue.size) {
      const job = [...queue.values()].sort((a, b) => a.priority - b.priority || a.order - b.order)[0]
      queue.delete(job.key)
      if (job.variant !== variant || cache.has(job.key) || active.has(job.key)) continue
      active.set(job.key, job)
      void load(job)
    }
  }

  function resize() {
    if (disposed) return
    const bounds = host.getBoundingClientRect()
    if (bounds.width < 1 || bounds.height < 1) return
    width = bounds.width
    height = bounds.height
    const nextVariant: Variant = width < 640 ? 'mobile' : 'desktop'
    if (nextVariant !== variant) {
      warmed.delete(variant)
      variant = nextVariant
      for (const [key, job] of queue) if (job.variant !== variant) queue.delete(key)
      for (const job of active.values()) if (job.variant !== variant) job.controller?.abort()
      // Keep the displayed frame available for immediate redraw while the new
      // resolution loads. Other old-resolution bitmaps need no retained memory.
      for (const [key, frame] of cache) {
        if (frame.variant !== variant && key !== displayed?.key) { cache.delete(key); frame.close() }
      }
    }
    const sourceWidth = manifest?.[variant].width ?? (variant === 'mobile' ? 640 : 1280)
    pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5, sourceWidth / width)
    canvas.width = Math.max(1, Math.round(width * pixelRatio))
    canvas.height = Math.max(1, Math.round(height * pixelRatio))
    if (displayed) paint(displayed, displayedProgress)
    trimCache()
    requestPaint()
  }

  const observer = new ResizeObserver(resize)
  observer.observe(host)
  resize()
  void (async () => {
    try {
      const response = await fetch(`${base}sequence.json`, { signal: lifetime.signal, cache: 'no-cache' })
      if (!response.ok) throw new Error(`The plating sequence returned HTTP ${response.status}.`)
      const data = readManifest(await response.json())
      if (disposed) return
      manifest = data
      resize()
    } catch (error) {
      if (!disposed && !lifetime.signal.aborted) report(error)
    }
  })()

  return {
    setProgress(next) {
      if (disposed) return
      progress = clamp(next)
      requestPaint()
    },
    resize,
    dispose() {
      if (disposed) return
      disposed = true
      lifetime.abort()
      observer.disconnect()
      queue.clear()
      for (const job of active.values()) job.controller?.abort()
      for (const frame of cache.values()) frame.close()
      cache.clear()
      displayed = undefined
      canvas.width = canvas.height = 1
      canvas.remove()
      delete host.dataset.frameLoading
    },
  }
}
