import type { ImageLodBucket } from '@/features/graph-v2/renderer/avatar/avatarImageUtils'
import type { PerfBudgetSnapshot } from '@/features/graph-v2/renderer/avatar/perfBudget'
import type {
  AvatarRuntimeOptions,
  AvatarUrlKey,
} from '@/features/graph-v2/renderer/avatar/types'

export interface AvatarCacheEntryDebugSnapshot {
  urlKey: AvatarUrlKey
  state: 'loading' | 'ready' | 'failed'
  bucket: ImageLodBucket | null
  startedAt: number | null
  readyAt: number | null
  failedAt: number | null
  expiresAt: number | null
  bytes: number | null
  reason: string | null
}

export interface AvatarCacheDebugSnapshot {
  capacity: number
  size: number
  totalBytes: number
  monogramCount: number
  byState: Record<'loading' | 'ready' | 'failed', number>
  entries: AvatarCacheEntryDebugSnapshot[]
}

export interface AvatarLoaderBlockDebugEntry {
  urlKey: AvatarUrlKey
  expiresAt: number
  ttlMsRemaining: number
  reason: string | null
}

export interface AvatarLoaderDebugSnapshot {
  blockedCount: number
  blocked: AvatarLoaderBlockDebugEntry[]
}

export interface AvatarSchedulerInflightDebugSnapshot {
  urlKey: AvatarUrlKey
  pubkey: string
  url: string
  host: string | null
  bucket: ImageLodBucket
  priority: number
  urgent: boolean
  startedAt: number
  lastWantedAt: number
}

export interface AvatarSchedulerRetryDebugSnapshot {
  urlKey: AvatarUrlKey
  retryAt: number
  retryInMs: number
}

export interface AvatarSchedulerEventDebugSnapshot {
  at: number
  type: 'started' | 'ready' | 'failed' | 'aborted'
  urlKey: AvatarUrlKey
  pubkey: string
  url: string
  host: string | null
  bucket: ImageLodBucket
  priority: number
  urgent: boolean
  reason: string | null
}

export interface AvatarSchedulerDebugSnapshot {
  inflightCount: number
  inflight: AvatarSchedulerInflightDebugSnapshot[]
  urgentRetries: AvatarSchedulerRetryDebugSnapshot[]
  recentEvents: AvatarSchedulerEventDebugSnapshot[]
}

export interface AvatarVisibleNodeDebugSnapshot {
  pubkey: string
  label: string
  url: string | null
  host: string | null
  urlKey: AvatarUrlKey | null
  radiusPx: number
  priority: number
  selectedForImage: boolean
  isPersistentAvatar: boolean
  zoomedOutMonogram: boolean
  monogramOnly: boolean
  fastMoving: boolean
  globalMotionActive: boolean
  disableImageReason: string | null
  drawResult: 'image' | 'monogram' | 'skipped'
  drawFallbackReason: string | null
  loadDecision: 'candidate' | 'skipped' | 'not_applicable'
  loadSkipReason: string | null
  cacheState: 'loading' | 'ready' | 'failed' | 'missing' | null
  cacheFailureReason: string | null
  blocked: boolean
  blockReason: string | null
  inflight: boolean
  requestedBucket: ImageLodBucket | null
  hasPictureUrl: boolean
  hasSafePictureUrl: boolean
}

export interface AvatarOverlayDebugSnapshot {
  generatedAtMs: number
  cameraRatio: number
  moving: boolean
  globalMotionActive: boolean
  resolvedBudget: {
    sizeThreshold: number
    zoomThreshold: number
    maxAvatarDrawsPerFrame: number
    maxImageDrawsPerFrame: number
    lruCap: number
    visualConcurrency: number
    effectiveLoadConcurrency: number
    concurrency: number
    maxBucket: ImageLodBucket
    maxInteractiveBucket: ImageLodBucket
    showAllVisibleImages: boolean
    allowZoomedOutImages: boolean
    showZoomedOutMonograms: boolean
    hideImagesOnFastNodes: boolean
    fastNodeVelocityThreshold: number
  }
  counts: {
    visibleNodes: number
    nodesWithPictureUrl: number
    nodesWithSafePictureUrl: number
    selectedForImage: number
    loadCandidates: number
    pendingCacheMiss: number
    pendingCandidates: number
    blockedCandidates: number
    inflightCandidates: number
    drawnImages: number
    monogramDraws: number
    withPictureMonogramDraws: number
  }
  byDisableReason: Record<string, number>
  byLoadSkipReason: Record<string, number>
  byDrawFallbackReason: Record<string, number>
  byCacheState: Record<string, number>
  nodes: AvatarVisibleNodeDebugSnapshot[]
}

export interface AvatarRuntimeStateDebugSnapshot {
  rootPubkey: string | null
  selectedNodePubkey: string | null
  viewport: {
    width: number
    height: number
  } | null
  camera:
    | {
        x: number
        y: number
        ratio: number
        angle: number
      }
    | null
  physicsRunning: boolean
  motionActive: boolean
  hideAvatarsOnMove: boolean
  runtimeOptions: AvatarRuntimeOptions
  perfBudget: PerfBudgetSnapshot | null
  cache: AvatarCacheDebugSnapshot | null
  loader: AvatarLoaderDebugSnapshot | null
  scheduler: AvatarSchedulerDebugSnapshot | null
  overlay: AvatarOverlayDebugSnapshot | null
}

export const readAvatarDebugHost = (url: string | null | undefined) => {
  if (!url) {
    return null
  }

  try {
    return new URL(url).host || null
  } catch {
    return null
  }
}
