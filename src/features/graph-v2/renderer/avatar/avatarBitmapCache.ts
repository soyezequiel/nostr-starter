import { getAvatarMonogram, type ImageLodBucket } from '@/features/graph/render/avatar'

import type {
  AvatarBitmap,
  AvatarEntry,
  AvatarFailedEntry,
  AvatarLoadingEntry,
  AvatarReadyEntry,
  AvatarUrlKey,
} from '@/features/graph-v2/renderer/avatar/types'

const MONOGRAM_SIZE = 64
const FAILED_TTL_MS = 10 * 60 * 1000

const closeBitmap = (bitmap: AvatarBitmap) => {
  if (typeof ImageBitmap !== 'undefined' && bitmap instanceof ImageBitmap) {
    try {
      bitmap.close()
    } catch {
      // ignore
    }
  }
}

export interface MonogramInput {
  label: string
  color: string
}

const renderMonogramCanvas = ({ label, color }: MonogramInput): HTMLCanvasElement => {
  const canvas = document.createElement('canvas')
  canvas.width = MONOGRAM_SIZE
  canvas.height = MONOGRAM_SIZE
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return canvas
  }

  const r = MONOGRAM_SIZE / 2
  ctx.beginPath()
  ctx.arc(r, r, r, 0, Math.PI * 2)
  ctx.closePath()
  ctx.fillStyle = color || '#7dd3a7'
  ctx.fill()

  ctx.fillStyle = '#0a1412'
  ctx.font = `600 ${Math.round(MONOGRAM_SIZE * 0.45)}px ui-sans-serif, system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const initials = getAvatarMonogram(label)
  ctx.fillText(initials, r, r + 1)

  return canvas
}

export class AvatarBitmapCache {
  private readonly entries = new Map<AvatarUrlKey, AvatarEntry>()
  private readonly monograms = new Map<string, HTMLCanvasElement>()
  private totalBytes = 0
  private cap: number
  private monogramCap: number

  constructor(cap: number) {
    this.cap = Math.max(16, cap)
    this.monogramCap = this.cap * 2
  }

  public setCap(nextCap: number) {
    this.cap = Math.max(16, nextCap)
    this.monogramCap = this.cap * 2
    this.evictIfNeeded()
    this.evictMonogramsIfNeeded()
  }

  public getMonogram(pubkey: string, input: MonogramInput): HTMLCanvasElement {
    const existing = this.monograms.get(pubkey)
    if (existing) {
      this.monograms.delete(pubkey)
      this.monograms.set(pubkey, existing)
      return existing
    }
    const canvas = renderMonogramCanvas(input)
    this.monograms.set(pubkey, canvas)
    this.evictMonogramsIfNeeded()
    return canvas
  }

  public get(urlKey: AvatarUrlKey): AvatarEntry | undefined {
    const entry = this.entries.get(urlKey)
    if (!entry) {
      return undefined
    }
    if (entry.state === 'failed' && entry.expiresAt <= Date.now()) {
      this.entries.delete(urlKey)
      return undefined
    }
    this.touch(urlKey, entry)
    return entry
  }

  public markLoading(
    urlKey: AvatarUrlKey,
    bucket: ImageLodBucket,
    monogram: HTMLCanvasElement,
  ): AvatarLoadingEntry {
    const entry: AvatarLoadingEntry = {
      state: 'loading',
      bucket,
      monogram,
      startedAt: Date.now(),
    }
    this.entries.set(urlKey, entry)
    return entry
  }

  public markReady(
    urlKey: AvatarUrlKey,
    bucket: ImageLodBucket,
    bitmap: AvatarBitmap,
    monogram: HTMLCanvasElement,
    bytes: number,
  ): AvatarReadyEntry {
    const previous = this.entries.get(urlKey)
    if (previous && previous.state === 'ready') {
      this.totalBytes -= previous.bytes
      closeBitmap(previous.bitmap)
    }
    const entry: AvatarReadyEntry = {
      state: 'ready',
      bucket,
      bitmap,
      monogram,
      bytes,
      readyAt: Date.now(),
    }
    this.entries.set(urlKey, entry)
    this.totalBytes += bytes
    this.evictIfNeeded()
    return entry
  }

  public markFailed(urlKey: AvatarUrlKey, monogram: HTMLCanvasElement): AvatarFailedEntry {
    const previous = this.entries.get(urlKey)
    if (previous && previous.state === 'ready') {
      this.totalBytes -= previous.bytes
      closeBitmap(previous.bitmap)
    }
    const entry: AvatarFailedEntry = {
      state: 'failed',
      monogram,
      expiresAt: Date.now() + FAILED_TTL_MS,
    }
    this.entries.set(urlKey, entry)
    return entry
  }

  public delete(urlKey: AvatarUrlKey) {
    const entry = this.entries.get(urlKey)
    if (!entry) {
      return
    }
    if (entry.state === 'ready') {
      this.totalBytes -= entry.bytes
      closeBitmap(entry.bitmap)
    }
    this.entries.delete(urlKey)
  }

  public clear() {
    for (const entry of this.entries.values()) {
      if (entry.state === 'ready') {
        closeBitmap(entry.bitmap)
      }
    }
    this.entries.clear()
    this.monograms.clear()
    this.totalBytes = 0
  }

  public size(): number {
    return this.entries.size
  }

  public bytes(): number {
    return this.totalBytes
  }

  private touch(urlKey: AvatarUrlKey, entry: AvatarEntry) {
    this.entries.delete(urlKey)
    this.entries.set(urlKey, entry)
  }

  private evictIfNeeded() {
    if (this.entries.size <= this.cap) {
      return
    }
    const overflow = this.entries.size - this.cap
    const toEvict: AvatarUrlKey[] = []
    const iterator = this.entries.keys()
    for (let i = 0; i < overflow; i += 1) {
      const next = iterator.next()
      if (next.done) {
        break
      }
      toEvict.push(next.value)
    }
    for (const key of toEvict) {
      this.delete(key)
    }
  }

  private evictMonogramsIfNeeded() {
    if (this.monograms.size <= this.monogramCap) {
      return
    }
    const overflow = this.monograms.size - this.monogramCap
    const iterator = this.monograms.keys()
    for (let i = 0; i < overflow; i += 1) {
      const next = iterator.next()
      if (next.done) {
        break
      }
      this.monograms.delete(next.value)
    }
  }
}
