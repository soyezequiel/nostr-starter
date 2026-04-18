import {
  isSafeAvatarUrl,
  type ImageLodBucket,
} from '@/features/graph/render/avatar'

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

const hasCreateImageBitmap = () =>
  typeof globalThis !== 'undefined' && typeof globalThis.createImageBitmap === 'function'

const hasDocumentImageElement = () =>
  typeof document !== 'undefined' &&
  typeof document.createElement === 'function'

const isImageElement = (source: CanvasImageSource): source is HTMLImageElement =>
  typeof HTMLImageElement !== 'undefined' && source instanceof HTMLImageElement

const composeCircularBitmap = async (
  source: CanvasImageSource,
  bucket: ImageLodBucket,
): Promise<AvatarBitmap> => {
  const canvas =
    typeof OffscreenCanvas !== 'undefined' && !isImageElement(source)
      ? new OffscreenCanvas(bucket, bucket)
      : (() => {
          const c = document.createElement('canvas')
          c.width = bucket
          c.height = bucket
          return c
        })()

  const ctx = canvas.getContext('2d') as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null
  if (!ctx) {
    return source
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
    if (typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap) {
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
  private readonly blocklist = new Map<AvatarUrlKey, number>()
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
    const expiresAt = this.blocklist.get(urlKey)
    if (expiresAt === undefined) {
      return false
    }
    if (expiresAt <= this.now()) {
      this.blocklist.delete(urlKey)
      return false
    }
    return true
  }

  public block(urlKey: AvatarUrlKey, ttlMs: number) {
    this.blocklist.set(urlKey, this.now() + ttlMs)
  }

  public unblock(urlKey: AvatarUrlKey) {
    this.blocklist.delete(urlKey)
  }

  public async load(
    url: string,
    bucket: ImageLodBucket,
    signal: AbortSignal,
  ): Promise<LoadedAvatar> {
    if (!isSafeAvatarUrl(url)) {
      throw new Error('unsafe_url')
    }

    try {
      return await this.loadViaFetch(url, bucket, signal)
    } catch (err) {
      if (signal.aborted || isAbortError(err) || isTimeoutError(err)) {
        throw err
      }
      if (!hasDocumentImageElement()) {
        throw err
      }
      return this.loadViaImageElement(url, bucket, signal)
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
        throw new Error(`http_${response.status}`)
      }
      const blob = await response.blob()
      if (signal.aborted) {
        throw new DOMException('aborted', 'AbortError')
      }
      const raw = await this.createImageBitmapImpl(blob, {
        resizeWidth: bucket,
        resizeHeight: bucket,
        resizeQuality: 'medium',
      })
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

const isTimeoutError = (err: unknown) =>
  (err as { message?: string } | null)?.message === 'timeout'

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
