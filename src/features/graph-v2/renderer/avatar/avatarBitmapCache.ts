import { getAvatarMonogram, getAvatarMonogramPalette } from '@/lib/avatarMonogram'
import type { ImageLodBucket } from '@/features/graph-v2/renderer/avatar/avatarImageUtils'

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
  paletteKey?: string
  showBackground?: boolean
  showText?: boolean
}

interface MonogramCacheEntry {
  canvas: HTMLCanvasElement
  signature: string
}

const createMonogramSignature = ({
  label,
  color,
  paletteKey,
  showBackground,
  showText,
}: MonogramInput) =>
  [
    label,
    paletteKey ?? color,
    showBackground === false ? 'no-bg' : 'bg',
    showText === false ? 'no-text' : 'text',
  ].join('\0')

const renderMonogramCanvas = ({
  label,
  color,
  paletteKey,
  showBackground = true,
  showText = true,
}: MonogramInput): HTMLCanvasElement => {
  const canvas = document.createElement('canvas')
  canvas.width = MONOGRAM_SIZE
  canvas.height = MONOGRAM_SIZE
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return canvas
  }

  const r = MONOGRAM_SIZE / 2
  const palette = getAvatarMonogramPalette(paletteKey || label || color)
  const hue = palette.hue
  const hue2 = palette.hue2
  if (showBackground) {
    const grad = ctx.createRadialGradient(
      r - r * 0.45,
      r - r * 0.45,
      r * 0.05,
      r,
      r,
      r * 1.05,
    )
    grad.addColorStop(0, `oklch(86% 0.18 ${hue2})`)
    grad.addColorStop(0.55, `oklch(68% 0.22 ${hue})`)
    grad.addColorStop(1, `oklch(48% 0.20 ${hue})`)
    ctx.beginPath()
    ctx.arc(r, r, r, 0, Math.PI * 2)
    ctx.closePath()
    ctx.fillStyle = grad
    ctx.fill()

    const highlight = ctx.createRadialGradient(
      r - r * 0.4,
      r - r * 0.55,
      0,
      r - r * 0.4,
      r - r * 0.55,
      r * 0.9,
    )
    highlight.addColorStop(0, `oklch(98% 0.05 ${hue2} / 0.55)`)
    highlight.addColorStop(1, `oklch(98% 0.05 ${hue2} / 0)`)
    ctx.fillStyle = highlight
    ctx.beginPath()
    ctx.arc(r, r, r, 0, Math.PI * 2)
    ctx.fill()

    ctx.strokeStyle = palette.rim
    ctx.lineWidth = 0.8
    ctx.beginPath()
    ctx.arc(r, r, r - 0.4, 0, Math.PI * 2)
    ctx.stroke()
  }

  if (showText) {
    ctx.font = `700 ${Math.round(MONOGRAM_SIZE * 0.48)}px Inter Tight, ui-sans-serif, system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const initials = getAvatarMonogram(label)
    if (!showBackground) {
      ctx.lineWidth = 3
      ctx.lineJoin = 'round'
      ctx.strokeStyle = 'rgba(3, 7, 12, 0.82)'
      ctx.strokeText(initials, r, r + 1)
      ctx.fillStyle = 'rgba(245, 250, 255, 0.94)'
    } else {
      ctx.fillStyle = palette.text
    }
    ctx.fillText(initials, r, r + 1)
  }

  return canvas
}

export class AvatarBitmapCache {
  private readonly entries = new Map<AvatarUrlKey, AvatarEntry>()
  private readonly monograms = new Map<string, MonogramCacheEntry>()
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
    const signature = createMonogramSignature(input)
    const existing = this.monograms.get(pubkey)
    if (existing && existing.signature === signature) {
      this.monograms.delete(pubkey)
      this.monograms.set(pubkey, existing)
      return existing.canvas
    }
    const canvas = renderMonogramCanvas(input)
    this.monograms.set(pubkey, { canvas, signature })
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
