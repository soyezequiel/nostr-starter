import type { ImageLodBucket } from '@/features/graph-v2/renderer/avatar/avatarImageUtils'

export type AvatarUrlKey = string

export type AvatarBitmap = ImageBitmap | HTMLCanvasElement

export interface AvatarLoadingEntry {
  state: 'loading'
  bucket: ImageLodBucket
  monogram: HTMLCanvasElement
  startedAt: number
}

export interface AvatarReadyEntry {
  state: 'ready'
  bucket: ImageLodBucket
  bitmap: AvatarBitmap
  monogram: HTMLCanvasElement
  bytes: number
  readyAt: number
}

export interface AvatarFailedEntry {
  state: 'failed'
  monogram: HTMLCanvasElement
  expiresAt: number
}

export type AvatarEntry = AvatarLoadingEntry | AvatarReadyEntry | AvatarFailedEntry

export interface AvatarBudget {
  readonly sizeThreshold: number
  readonly zoomThreshold: number
  readonly concurrency: number
  readonly maxBucket: ImageLodBucket
  readonly lruCap: number
  readonly maxAvatarDrawsPerFrame: number
  readonly maxImageDrawsPerFrame: number
  readonly drawAvatars: boolean
}

export interface AvatarRuntimeOptions {
  readonly sizeThreshold: number
  readonly zoomThreshold: number
  readonly hoverRevealRadiusPx: number
  readonly showZoomedOutMonograms: boolean
  readonly showMonogramBackgrounds: boolean
  readonly showMonogramText: boolean
  readonly hideImagesOnFastNodes: boolean
  readonly fastNodeVelocityThreshold: number
}

export type DeviceTier = 'low' | 'mid' | 'high'

export const DEFAULT_AVATAR_RUNTIME_OPTIONS: AvatarRuntimeOptions = {
  sizeThreshold: 15,
  zoomThreshold: 2.1,
  hoverRevealRadiusPx: 72,
  showZoomedOutMonograms: false,
  showMonogramBackgrounds: true,
  showMonogramText: true,
  hideImagesOnFastNodes: false,
  fastNodeVelocityThreshold: 240,
}

export const DEFAULT_BUDGETS: Record<DeviceTier, AvatarBudget> = {
  low: {
    sizeThreshold: 16,
    zoomThreshold: 1.2,
    concurrency: 2,
    maxBucket: 64,
    lruCap: 192,
    maxAvatarDrawsPerFrame: 96,
    maxImageDrawsPerFrame: 36,
    drawAvatars: true,
  },
  mid: {
    sizeThreshold: 12,
    zoomThreshold: 1.5,
    concurrency: 4,
    maxBucket: 128,
    lruCap: 384,
    maxAvatarDrawsPerFrame: 180,
    maxImageDrawsPerFrame: 72,
    drawAvatars: true,
  },
  high: {
    sizeThreshold: 12,
    zoomThreshold: 2,
    concurrency: 6,
    maxBucket: 256,
    lruCap: 512,
    maxAvatarDrawsPerFrame: 280,
    maxImageDrawsPerFrame: 120,
    drawAvatars: true,
  },
}
