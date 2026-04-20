import {
  isSafeAvatarUrl,
  type ImageLodBucket,
} from '@/features/graph-v2/renderer/avatar/avatarImageUtils'
import type {
  AvatarLoaderBlockDebugEntry,
  AvatarLoaderDebugSnapshot,
} from '@/features/graph-v2/renderer/avatar/avatarDebug'
import type { AvatarBitmap, AvatarUrlKey } from '@/features/graph-v2/renderer/avatar/types'

const FETCH_TIMEOUT_MS = 8000

export interface LoadedAvatar {
  bitmap: AvatarBitmap
  bytes: number
}

export interface AvatarLoaderDeps {
  fetchImpl?: typeof fetch
  createImageBitmapImpl?: typeof createImageBitmap
  now?: () => number
}

type CircularBitmapSource = ImageBitmap | HTMLImageElement

const hasCreateImageBitmap = () =>
  typeof globalThis !== 'undefined' && typeof globalThis.createImageBitmap === 'function'

const hasDocumentImageElement = () =>
  typeof document !== 'undefined' &&
  typeof document.createElement === 'function'

const isImageElement = (source: CircularBitmapSource): source is HTMLImageElement =>
  typeof HTMLImageElement !== 'undefined' && source instanceof HTMLImageElement

const isImageBitmap = (source: CircularBitmapSource): source is ImageBitmap =>
  typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap

const createCanvasElement = (bucket: ImageLodBucket): HTMLCanvasElement => {
  const canvas = document.createElement('canvas')
  canvas.width = bucket
  canvas.height = bucket
  return canvas
}

const composeCircularBitmap = async (
  source: CircularBitmapSource,
  bucket: ImageLodBucket,
): Promise<AvatarBitmap> => {
  const canvas =
    typeof OffscreenCanvas !== 'undefined' && !isImageElement(source)
      ? new OffscreenCanvas(bucket, bucket)
      : createCanvasElement(bucket)

  const ctx = canvas.getContext('2d') as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null
  if (!ctx) {
    return isImageBitmap(source) ? source : createCanvasElement(bucket)
  }

  const r = bucket / 2
  ctx.save()
  ctx.beginPath()
  ctx.arc(r, r, r, 0, Math.PI * 2)
  ctx.closePath()
  ctx.clip()
  ctx.drawImage(source, 0, 0, bucket, bucket)
  ctx.restore()

  try {
    if (isImageBitmap(source)) {
      source.close()
    }
  } catch {
    // ignore
  }

  if (typeof OffscreenCanvas !== 'undefined' && canvas instanceof OffscreenCanvas) {
    if (typeof canvas.transferToImageBitmap === 'function') {
      return canvas.transferToImageBitmap()
    }
  }

  return canvas as HTMLCanvasElement
}

export class AvatarLoader {
  private readonly blocklist = new Map<
    AvatarUrlKey,
    { expiresAt: number; reason: string | null }
  >()
  private readonly fetchImpl: typeof fetch
  private readonly createImageBitmapImpl: typeof createImageBitmap
  private readonly now: () => number

  constructor(deps: AvatarLoaderDeps = {}) {
    this.fetchImpl =
      deps.fetchImpl ??
      (typeof globalThis !== 'undefined' && typeof globalThis.fetch === 'function'
        ? globalThis.fetch.bind(globalThis)
        : (() => {
            throw new Error('fetch is not available')
          }))
    this.createImageBitmapImpl =
      deps.createImageBitmapImpl ??
      (hasCreateImageBitmap()
        ? globalThis.createImageBitmap.bind(globalThis)
        : (() => {
            throw new Error('createImageBitmap is not available')
          }))
    this.now = deps.now ?? (() => Date.now())
  }

  public isBlocked(urlKey: AvatarUrlKey): boolean {
    return this.getBlockedEntry(urlKey) !== null
  }

  public block(urlKey: AvatarUrlKey, ttlMs: number, reason: string | null = null) {
    this.blocklist.set(urlKey, {
      expiresAt: this.now() + ttlMs,
      reason,
    })
  }

  public unblock(urlKey: AvatarUrlKey) {
    this.blocklist.delete(urlKey)
  }

  public getBlockedEntry(urlKey: AvatarUrlKey): AvatarLoaderBlockDebugEntry | null {
    const entry = this.blocklist.get(urlKey)
    if (!entry) {
      return null
    }

    const ttlMsRemaining = entry.expiresAt - this.now()
    if (ttlMsRemaining <= 0) {
      this.blocklist.delete(urlKey)
      return null
    }

    return {
      urlKey,
      expiresAt: entry.expiresAt,
      ttlMsRemaining,
      reason: entry.reason,
    }
  }

  public getDebugSnapshot(): AvatarLoaderDebugSnapshot {
    const blocked: AvatarLoaderBlockDebugEntry[] = []

    for (const urlKey of this.blocklist.keys()) {
      const entry = this.getBlockedEntry(urlKey)
      if (entry) {
        blocked.push(entry)
      }
    }

    blocked.sort(
      (left, right) =>
        right.ttlMsRemaining - left.ttlMsRemaining ||
        left.urlKey.localeCompare(right.urlKey),
    )

    return {
      blockedCount: blocked.length,
      blocked,
    }
  }

  public async load(
    url: string,
    bucket: ImageLodBucket,
    signal: AbortSignal,
    options: { useImageElementFallback?: boolean } = {},
  ): Promise<LoadedAvatar> {
    if (!isSafeAvatarUrl(url)) {
      throw new Error('unsafe_url')
    }

    const allowFallback = options.useImageElementFallback !== false
    try {
      return await this.loadViaFetch(url, bucket, signal)
    } catch (err) {
      if (signal.aborted || isAbortError(err)) {
        throw err
      }
      if (!allowFallback || !hasDocumentImageElement()) {
        throw err
      }
      try {
        return await this.loadViaImageElement(url, bucket, signal)
      } catch (fallbackErr) {
        if (signal.aborted || isAbortError(fallbackErr)) {
          throw fallbackErr
        }
        // Preserve the original fetch error reason; the img fallback
        // would not have found a different outcome for same-origin proxy URLs.
        throw err
      }
    }
  }

  private async loadViaFetch(
    url: string,
    bucket: ImageLodBucket,
    signal: AbortSignal,
  ): Promise<LoadedAvatar> {
    const timeoutCtrl = new AbortController()
    const timeoutId = setTimeout(() => timeoutCtrl.abort('timeout'), FETCH_TIMEOUT_MS)
    const composite = mergeSignals(signal, timeoutCtrl.signal)

    try {
      const response = await this.fetchImpl(url, {
        signal: composite,
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        mode: 'cors',
      })
      if (!response.ok) {
        const proxyReason = response.headers.get('x-avatar-proxy-reason')
        const reasonTag = proxyReason ? `_${proxyReason}` : ''
        const err = new Error(`http_${response.status}${reasonTag}`)
        ;(err as { reason?: string }).reason =
          proxyReason ?? `http_${response.status}`
        throw err
      }
      const blob = await response.blob()
      if (signal.aborted) {
        throw new DOMException('aborted', 'AbortError')
      }
      let raw: ImageBitmap
      try {
        raw = await this.createImageBitmapImpl(blob, {
          resizeWidth: bucket,
          resizeHeight: bucket,
          resizeQuality: 'high',
        })
      } catch (decodeErr) {
        if (signal.aborted || isAbortError(decodeErr)) {
          throw decodeErr
        }
        const err = new Error('decode_failed')
        ;(err as { reason?: string; cause?: unknown }).reason = 'decode_failed'
        ;(err as { cause?: unknown }).cause = decodeErr
        throw err
      }
      if (signal.aborted) {
        try {
          raw.close()
        } catch {
          // ignore
        }
        throw new DOMException('aborted', 'AbortError')
      }
      const bitmap = await composeCircularBitmap(raw, bucket)
      const bytes = bucket * bucket * 4
      return { bitmap, bytes }
    } catch (err) {
      if (timeoutCtrl.signal.aborted && !signal.aborted) {
        throw new Error('timeout')
      }
      throw err
    } finally {
      clearTimeout(timeoutId)
    }
  }

  private async loadViaImageElement(
    url: string,
    bucket: ImageLodBucket,
    signal: AbortSignal,
  ): Promise<LoadedAvatar> {
    const image = await loadHtmlImage(url, signal)
    const bitmap = await composeCircularBitmap(image, bucket)
    return { bitmap, bytes: bucket * bucket * 4 }
  }
}

const mergeSignals = (a: AbortSignal, b: AbortSignal): AbortSignal => {
  if (a.aborted) return a
  if (b.aborted) return b
  const ctrl = new AbortController()
  const onAbortA = () => ctrl.abort(a.reason)
  const onAbortB = () => ctrl.abort(b.reason)
  a.addEventListener('abort', onAbortA, { once: true })
  b.addEventListener('abort', onAbortB, { once: true })
  return ctrl.signal
}

const isAbortError = (err: unknown) =>
  (err as { name?: string } | null)?.name === 'AbortError'

const loadHtmlImage = (
  url: string,
  signal: AbortSignal,
): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = document.createElement('img')
    let settled = false
    let timeoutId: ReturnType<typeof setTimeout> | null = null

    const cleanup = () => {
      if (timeoutId !== null) {
        clearTimeout(timeoutId)
      }
      image.removeEventListener('load', onLoad)
      image.removeEventListener('error', onError)
      signal.removeEventListener('abort', onAbort)
    }

    const finish = (err?: unknown) => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      if (err) {
        image.src = ''
        reject(err)
        return
      }
      resolve(image)
    }

    const onLoad = () => finish()
    const onError = () => finish(new Error('image_load_failed'))
    const onAbort = () => finish(new DOMException('aborted', 'AbortError'))

    timeoutId = setTimeout(() => {
      finish(new Error('timeout'))
    }, FETCH_TIMEOUT_MS)

    if (signal.aborted) {
      onAbort()
      return
    }

    image.decoding = 'async'
    image.referrerPolicy = 'no-referrer'
    image.addEventListener('load', onLoad, { once: true })
    image.addEventListener('error', onError, { once: true })
    signal.addEventListener('abort', onAbort, { once: true })
    image.src = url
  })
