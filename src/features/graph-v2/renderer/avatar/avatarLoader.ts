import {
  isSafeAvatarUrl,
  type ImageLodBucket,
} from '@/features/graph-v2/renderer/avatar/avatarImageUtils'
import type {
  AvatarLoaderBlockDebugEntry,
  AvatarLoaderDebugSnapshot,
} from '@/features/graph-v2/renderer/avatar/avatarDebug'
import type { AvatarBitmap, AvatarUrlKey } from '@/features/graph-v2/renderer/avatar/types'
import {
  getDefaultAvatarDiskCache,
  type AvatarDiskCache,
} from '@/features/graph-v2/renderer/avatar/avatarDiskCache'
import {
  summarizeAvatarUrl,
  traceAvatarFlow,
} from '@/features/graph-runtime/debug/avatarTrace'
import { buildSocialAvatarProxyUrl } from '@/features/graph-v2/renderer/socialAvatarProxy'

const FETCH_TIMEOUT_MS = 8000
const BULK_DECODE_CONCURRENCY = 16
const AVATAR_PROXY_FIRST_HOSTS = new Set([
  'cdn.nostr.build',
  'nostr.build',
  'profilepics.nostur.com',
])

type AvatarFetchPolicy = 'direct-first' | 'proxy-first'
type AvatarNetworkPath = 'direct' | 'proxy'
type AvatarAttemptStage = 'primary' | 'fallback' | 'recovery'

export interface LoadedAvatar {
  bitmap: AvatarBitmap
  bytes: number
  blob?: Blob
  mimeType?: string | null
  diskCacheBlob?: Blob
  diskCacheMimeType?: string | null
}

export interface AvatarLoaderDeps {
  fetchImpl?: typeof fetch
  createImageBitmapImpl?: typeof createImageBitmap
  now?: () => number
  proxyOrigin?: string | null
  diskCache?: AvatarDiskCache | null
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

const DISK_CACHE_VARIANT_MIME_TYPE = 'image/png'

const serializeAvatarBitmapForDiskCache = async (
  bitmap: AvatarBitmap,
  bucket: ImageLodBucket,
): Promise<Blob | null> => {
  if (typeof OffscreenCanvas !== 'undefined') {
    try {
      const canvas = new OffscreenCanvas(bucket, bucket)
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        return null
      }
      ctx.drawImage(bitmap, 0, 0, bucket, bucket)
      return await canvas.convertToBlob({
        type: DISK_CACHE_VARIANT_MIME_TYPE,
      })
    } catch {
      // fall back to HTML canvas when conversion is unavailable or blocked
    }
  }

  if (
    typeof document === 'undefined' ||
    typeof document.createElement !== 'function'
  ) {
    return null
  }

  const canvas = createCanvasElement(bucket)
  const ctx = canvas.getContext('2d')
  if (!ctx || typeof canvas.toBlob !== 'function') {
    return null
  }
  ctx.drawImage(bitmap, 0, 0, bucket, bucket)

  return await new Promise((resolve) => {
    try {
      canvas.toBlob(
        (blob) => resolve(blob ?? null),
        DISK_CACHE_VARIANT_MIME_TYPE,
      )
    } catch {
      resolve(null)
    }
  })
}

export class AvatarLoader {
  private readonly blocklist = new Map<
    AvatarUrlKey,
    { expiresAt: number; reason: string | null }
  >()
  private readonly fetchImpl: typeof fetch
  private readonly createImageBitmapImpl: typeof createImageBitmap
  private readonly now: () => number
  private readonly proxyOrigin: string | null
  private readonly diskCache: AvatarDiskCache | null

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
    this.proxyOrigin = deps.proxyOrigin ?? readBrowserOrigin()
    this.diskCache =
      Object.prototype.hasOwnProperty.call(deps, 'diskCache')
        ? deps.diskCache ?? null
        : getDefaultAvatarDiskCache()
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

  public async hasDiskCached(url: string, bucket: ImageLodBucket): Promise<boolean> {
    if (!this.diskCache || !isSafeAvatarUrl(url)) {
      return false
    }

    try {
      return await this.diskCache.has(url, bucket, this.now())
    } catch (err) {
      traceAvatarFlow('renderer.avatarLoader.diskCache.hasFailed', () => ({
        url: summarizeAvatarUrl(url),
        bucket,
        reason: extractAvatarLoadFailureReason(err),
      }))
      return false
    }
  }

  public async loadDiskCached(
    url: string,
    bucket: ImageLodBucket,
    signal: AbortSignal,
  ): Promise<LoadedAvatar | null> {
    if (!isSafeAvatarUrl(url)) {
      return null
    }

    return this.loadFromDiskCache(url, bucket, signal)
  }

  public async loadManyDiskCached(
    requests: Array<{ url: string; bucket: ImageLodBucket }>,
    signal: AbortSignal,
  ): Promise<Array<LoadedAvatar | null>> {
    if (!this.diskCache || requests.length === 0 || signal.aborted) {
      return requests.map(() => null)
    }

    const safeRequests = requests.map((r) => ({
      ...r,
      safe: isSafeAvatarUrl(r.url),
    }))

    const diskRequests = safeRequests
      .filter((r) => r.safe)
      .map((r) => ({ sourceUrl: r.url, bucket: r.bucket }))

    let records: Array<import('@/features/graph-v2/renderer/avatar/avatarDiskCache').AvatarDiskCacheHit | null>
    try {
      records = await this.diskCache.bulkGetFresh(diskRequests, this.now())
    } catch (err) {
      traceAvatarFlow('renderer.avatarLoader.bulkDiskCache.fetchFailed', () => ({
        count: diskRequests.length,
        reason: extractAvatarLoadFailureReason(err),
      }))
      return requests.map(() => null)
    }

    if (signal.aborted) {
      return requests.map(() => null)
    }

    // Map records back to original request indices
    const hitsByIndex = new Map<number, { blob: Blob; safeIdx: number }>()
    let safeIdx = 0
    for (let i = 0; i < safeRequests.length; i++) {
      if (!safeRequests[i]!.safe) {
        continue
      }
      const record = records[safeIdx]
      if (record) {
        hitsByIndex.set(i, { blob: record.blob, safeIdx })
      }
      safeIdx++
    }

    // Decode hits in parallel with a concurrency cap
    const results: Array<LoadedAvatar | null> = requests.map(() => null)
    const decodeQueue: Array<{ origIndex: number; blob: Blob; bucket: ImageLodBucket }> = []
    for (const [origIndex, hit] of hitsByIndex) {
      decodeQueue.push({
        origIndex,
        blob: hit.blob,
        bucket: requests[origIndex]!.bucket,
      })
    }

    await runWithConcurrency(
      decodeQueue.map(({ origIndex, blob, bucket }) => async () => {
        if (signal.aborted) {
          return
        }
        try {
          const loaded = await this.loadViaBlob(blob, bucket, signal, {
            skipCircularCompose: true,
          })
          traceAvatarFlow('renderer.avatarLoader.bulkDiskCache.ready', () => ({
            url: summarizeAvatarUrl(requests[origIndex]!.url),
            bucket,
            bytes: loaded.bytes,
          }))
          results[origIndex] = loaded
        } catch (err) {
          if (signal.aborted || isAbortError(err)) {
            return
          }
          traceAvatarFlow('renderer.avatarLoader.bulkDiskCache.decodeFailed', () => ({
            url: summarizeAvatarUrl(requests[origIndex]!.url),
            bucket,
            reason: extractAvatarLoadFailureReason(err),
          }))
          // Leave null for this entry; caller handles miss
        }
      }),
      BULK_DECODE_CONCURRENCY,
    )

    return results
  }

  public async load(
    url: string,
    bucket: ImageLodBucket,
    signal: AbortSignal,
    options: {
      useImageElementFallback?: boolean
      useProxyFallback?: boolean
    } = {},
  ): Promise<LoadedAvatar> {
    if (!isSafeAvatarUrl(url)) {
      throw new Error('unsafe_url')
    }

    const cached = await this.loadFromDiskCache(url, bucket, signal)
    if (cached) {
      return cached
    }

    const allowFallback = options.useImageElementFallback !== false
    const allowProxyFallback = options.useProxyFallback !== false
    const proxyUrl = allowProxyFallback
      ? buildRuntimeAvatarProxyUrl(url, this.proxyOrigin)
      : null
    const fetchPolicy = resolveAvatarFetchPolicy(url, proxyUrl)
    let fetchError: unknown

    traceAvatarFlow('renderer.avatarLoader.fetchPolicy.selected', () => ({
      sourceUrl: summarizeAvatarUrl(url),
      proxyUrl: summarizeAvatarUrl(proxyUrl),
      bucket,
      policy: fetchPolicy,
    }))

    if (fetchPolicy === 'proxy-first' && proxyUrl) {
      try {
        return await this.loadViaNetworkPath(url, proxyUrl, bucket, signal, {
          path: 'proxy',
          stage: 'primary',
          policy: fetchPolicy,
        })
      } catch (err) {
        if (signal.aborted || isAbortError(err)) {
          throw err
        }
        fetchError = err
      }

      try {
        return await this.loadViaNetworkPath(url, url, bucket, signal, {
          path: 'direct',
          stage: 'recovery',
          policy: fetchPolicy,
        })
      } catch (err) {
        if (signal.aborted || isAbortError(err)) {
          throw err
        }
        fetchError = err
      }
    } else {
      try {
        return await this.loadViaNetworkPath(url, url, bucket, signal, {
          path: 'direct',
          stage: 'primary',
          policy: fetchPolicy,
        })
      } catch (err) {
        if (signal.aborted || isAbortError(err)) {
          throw err
        }
        fetchError = err
        traceAvatarFlow('renderer.avatarLoader.fetchFailed', () => ({
          url: summarizeAvatarUrl(url),
          bucket,
          reason: extractAvatarLoadFailureReason(err),
        }))
      }

      const directFailureReason = extractAvatarLoadFailureReason(fetchError)

      if (proxyUrl && !shouldSkipProxyFallback(directFailureReason)) {
        traceAvatarFlow('renderer.avatarLoader.proxyFallback.start', () => ({
          sourceUrl: summarizeAvatarUrl(url),
          proxyUrl: summarizeAvatarUrl(proxyUrl),
          bucket,
        }))
        try {
          return await this.loadViaNetworkPath(url, proxyUrl, bucket, signal, {
            path: 'proxy',
            stage: 'fallback',
            policy: fetchPolicy,
          })
        } catch (err) {
          if (signal.aborted || isAbortError(err)) {
            throw err
          }
          fetchError = err
          traceAvatarFlow('renderer.avatarLoader.proxyFallback.failed', () => ({
            sourceUrl: summarizeAvatarUrl(url),
            proxyUrl: summarizeAvatarUrl(proxyUrl),
            bucket,
            reason: extractAvatarLoadFailureReason(err),
          }))
        }
      } else if (proxyUrl && shouldSkipProxyFallback(directFailureReason)) {
        traceAvatarFlow('renderer.avatarLoader.proxyFallback.skipped', () => ({
          sourceUrl: summarizeAvatarUrl(url),
          proxyUrl: summarizeAvatarUrl(proxyUrl),
          bucket,
          reason: directFailureReason,
        }))
      }
    }

    if (!allowFallback || !hasDocumentImageElement()) {
      traceAvatarFlow('renderer.avatarLoader.terminalFailure', () => ({
        url: summarizeAvatarUrl(url),
        bucket,
        policy: fetchPolicy,
        reason: extractAvatarLoadFailureReason(fetchError),
        allowFallback,
        hasDocumentImageElement: hasDocumentImageElement(),
      }))
      throw fetchError
    }

    const finalFailureReason = extractAvatarLoadFailureReason(fetchError)
    if (shouldSkipImageElementFallback(finalFailureReason)) {
      traceAvatarFlow('renderer.avatarLoader.imageElementFallback.skipped', () => ({
        url: summarizeAvatarUrl(url),
        bucket,
        preservedReason: finalFailureReason,
      }))
      traceAvatarFlow('renderer.avatarLoader.terminalFailure', () => ({
        url: summarizeAvatarUrl(url),
        bucket,
        policy: fetchPolicy,
        reason: finalFailureReason,
        preservedReason: finalFailureReason,
      }))
      throw fetchError
    }

    traceAvatarFlow('renderer.avatarLoader.imageElementFallback.start', () => ({
      url: summarizeAvatarUrl(url),
      bucket,
      preservedReason: extractAvatarLoadFailureReason(fetchError),
    }))
    try {
      const loaded = await this.loadViaImageElement(url, bucket, signal)
      void this.writeDiskCache(url, bucket, loaded, 'image-element')
      traceAvatarFlow('renderer.avatarLoader.imageElementFallback.ready', () => ({
        url: summarizeAvatarUrl(url),
        bucket,
        bytes: loaded.bytes,
      }))
      return loaded
    } catch (fallbackErr) {
      if (signal.aborted || isAbortError(fallbackErr)) {
        throw fallbackErr
      }
      // Preserve the fetch/proxy error reason where possible; the img element
      // only reports a generic load failure.
      traceAvatarFlow('renderer.avatarLoader.imageElementFallback.failed', () => ({
        url: summarizeAvatarUrl(url),
        bucket,
        fallbackReason: extractAvatarLoadFailureReason(fallbackErr),
        preservedReason: extractAvatarLoadFailureReason(fetchError),
      }))
      traceAvatarFlow('renderer.avatarLoader.terminalFailure', () => ({
        url: summarizeAvatarUrl(url),
        bucket,
        policy: fetchPolicy,
        reason: extractAvatarLoadFailureReason(fetchError),
        fallbackReason: extractAvatarLoadFailureReason(fallbackErr),
      }))
      throw fetchError
    }
  }

  private async loadViaNetworkPath(
    sourceUrl: string,
    requestUrl: string,
    bucket: ImageLodBucket,
    signal: AbortSignal,
    {
      path,
      stage,
      policy,
    }: {
      path: AvatarNetworkPath
      stage: AvatarAttemptStage
      policy: AvatarFetchPolicy
    },
  ): Promise<LoadedAvatar> {
    traceAvatarFlow('renderer.avatarLoader.fetchAttempt.start', () => ({
      sourceUrl: summarizeAvatarUrl(sourceUrl),
      requestUrl: summarizeAvatarUrl(requestUrl),
      bucket,
      policy,
      path,
      stage,
    }))

    try {
      const loaded = await this.loadViaFetch(requestUrl, bucket, signal)
      void this.writeDiskCache(sourceUrl, bucket, loaded, path)
      traceAvatarFlow('renderer.avatarLoader.fetchAttempt.ready', () => ({
        sourceUrl: summarizeAvatarUrl(sourceUrl),
        requestUrl: summarizeAvatarUrl(requestUrl),
        bucket,
        policy,
        path,
        stage,
        bytes: loaded.bytes,
      }))
      if (path === 'proxy' && stage === 'fallback') {
        traceAvatarFlow('renderer.avatarLoader.proxyFallback.ready', () => ({
          sourceUrl: summarizeAvatarUrl(sourceUrl),
          proxyUrl: summarizeAvatarUrl(requestUrl),
          bucket,
          bytes: loaded.bytes,
        }))
      }
      return loaded
    } catch (err) {
      if (signal.aborted || isAbortError(err)) {
        throw err
      }
      traceAvatarFlow('renderer.avatarLoader.fetchAttempt.failed', () => ({
        sourceUrl: summarizeAvatarUrl(sourceUrl),
        requestUrl: summarizeAvatarUrl(requestUrl),
        bucket,
        policy,
        path,
        stage,
        reason: extractAvatarLoadFailureReason(err),
      }))
      throw err
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
      const loaded = await this.loadViaBlob(blob, bucket, signal)
      return {
        ...loaded,
        blob,
        mimeType: blob.type || response.headers.get('content-type'),
      }
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

  private async loadFromDiskCache(
    url: string,
    bucket: ImageLodBucket,
    signal: AbortSignal,
  ): Promise<LoadedAvatar | null> {
    if (!this.diskCache || signal.aborted) {
      return null
    }

    try {
      const cached = await this.diskCache.get(url, bucket, this.now())
      if (!cached || signal.aborted) {
        return null
      }

      const loaded = await this.loadViaBlob(cached.blob, bucket, signal, { skipCircularCompose: true })
      traceAvatarFlow('renderer.avatarLoader.diskCache.ready', () => ({
        url: summarizeAvatarUrl(url),
        bucket,
        bytes: loaded.bytes,
        storedBytes: cached.byteSize,
        mimeType: cached.mimeType,
      }))
      return loaded
    } catch (err) {
      await this.deleteDiskCacheEntry(url, bucket)
      traceAvatarFlow('renderer.avatarLoader.diskCache.failed', () => ({
        url: summarizeAvatarUrl(url),
        bucket,
        reason: extractAvatarLoadFailureReason(err),
      }))
      return null
    }
  }

  private async writeDiskCache(
    url: string,
    bucket: ImageLodBucket,
    loaded: LoadedAvatar,
    source: 'direct' | 'proxy' | 'image-element',
  ) {
    if (!this.diskCache) {
      return
    }

    try {
      const diskCacheBlob =
        loaded.diskCacheBlob ??
        (await serializeAvatarBitmapForDiskCache(loaded.bitmap, bucket)) ??
        loaded.blob
      if (!diskCacheBlob) {
        return
      }
      const diskCacheMimeType =
        loaded.diskCacheMimeType ??
        diskCacheBlob.type ??
        loaded.mimeType ??
        loaded.blob?.type ??
        DISK_CACHE_VARIANT_MIME_TYPE
      await this.diskCache.put({
        sourceUrl: url,
        bucket,
        blob: diskCacheBlob,
        mimeType: diskCacheMimeType,
        now: this.now(),
      })
      traceAvatarFlow('renderer.avatarLoader.diskCache.stored', () => ({
        url: summarizeAvatarUrl(url),
        bucket,
        source,
        byteSize: diskCacheBlob.size,
        mimeType: diskCacheMimeType,
      }))
    } catch (err) {
      traceAvatarFlow('renderer.avatarLoader.diskCache.storeFailed', () => ({
        url: summarizeAvatarUrl(url),
        bucket,
        source,
        reason: extractAvatarLoadFailureReason(err),
      }))
    }
  }

  private async deleteDiskCacheEntry(url: string, bucket: ImageLodBucket) {
    try {
      await this.diskCache?.delete(url, bucket)
    } catch {
      // ignore
    }
  }

  private async loadViaBlob(
    blob: Blob,
    bucket: ImageLodBucket,
    signal: AbortSignal,
    options: { skipCircularCompose?: boolean } = {},
  ): Promise<LoadedAvatar> {
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
    if (options.skipCircularCompose) {
      return { bitmap: raw, bytes: bucket * bucket * 4 }
    }
    const bitmap = await composeCircularBitmap(raw, bucket)
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

const extractAvatarLoadFailureReason = (err: unknown) => {
  const candidate = err as
    | { reason?: string; message?: string; name?: string }
    | null
    | undefined
  return (
    candidate?.reason ??
    candidate?.message ??
    candidate?.name ??
    'avatar_load_failed'
  )
}

const TERMINAL_AVATAR_LOAD_FAILURE_REASONS = new Set([
  'unsafe_url',
  'decode_failed',
  'unsupported_content_type',
  'avatar_too_large',
  'unresolved_host',
])

const parseAvatarHttpStatus = (reason: string | null) => {
  if (!reason) {
    return null
  }
  const match = /^http_(\d{3})(?:_|$)/.exec(reason)
  if (!match) {
    return null
  }
  return Number.parseInt(match[1] ?? '', 10)
}

const shouldSkipProxyFallback = (reason: string | null) => {
  if (!reason) {
    return false
  }
  if (TERMINAL_AVATAR_LOAD_FAILURE_REASONS.has(reason)) {
    return true
  }
  const status = parseAvatarHttpStatus(reason)
  return status !== null && [400, 404, 410, 422].includes(status)
}

const shouldSkipImageElementFallback = (reason: string | null) => {
  if (!reason) {
    return false
  }
  if (TERMINAL_AVATAR_LOAD_FAILURE_REASONS.has(reason)) {
    return true
  }
  const status = parseAvatarHttpStatus(reason)
  return status !== null && [400, 403, 404, 410, 422].includes(status)
}

const readBrowserOrigin = () => {
  if (typeof globalThis === 'undefined') {
    return null
  }

  const location = (globalThis as { location?: Location }).location
  return location?.origin ?? null
}

const buildRuntimeAvatarProxyUrl = (
  sourceUrl: string,
  origin: string | null,
) => {
  if (!origin) {
    return null
  }

  try {
    const parsedSource = new URL(sourceUrl)
    const parsedOrigin = new URL(origin)
    if (
      parsedSource.origin === parsedOrigin.origin &&
      parsedSource.pathname === '/api/social-avatar'
    ) {
      return null
    }
    return buildSocialAvatarProxyUrl(sourceUrl, parsedOrigin.origin)
  } catch {
    return null
  }
}

const resolveAvatarFetchPolicy = (
  sourceUrl: string,
  proxyUrl: string | null,
): AvatarFetchPolicy => {
  if (!proxyUrl) {
    return 'direct-first'
  }

  const host = readAvatarHostname(sourceUrl)
  if (host && AVATAR_PROXY_FIRST_HOSTS.has(host)) {
    return 'proxy-first'
  }

  return 'direct-first'
}

const readAvatarHostname = (sourceUrl: string) => {
  try {
    return new URL(sourceUrl).hostname.toLowerCase()
  } catch {
    return null
  }
}

const runWithConcurrency = (
  tasks: Array<() => Promise<void>>,
  concurrency: number,
): Promise<void> => {
  if (tasks.length === 0) {
    return Promise.resolve()
  }

  return new Promise<void>((resolve) => {
    let next = 0
    let done = 0

    const run = () => {
      if (next >= tasks.length) {
        return
      }
      const index = next++
      void tasks[index]!().then(() => {
        done++
        if (done === tasks.length) {
          resolve()
        } else {
          run()
        }
      })
    }

    const initial = Math.min(concurrency, tasks.length)
    for (let i = 0; i < initial; i++) {
      run()
    }
  })
}

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
