import { OrthographicViewport } from '@deck.gl/core'

import {
  createNostrGraphDatabase,
  createRepositories,
  type ImageVariantRecord,
  type ImageVariantStorageSummary,
} from '@/features/graph/db'
import {
  applyImageBucketHysteresis,
  clampImageBucketForMotion,
  IMAGE_LOD_BUCKETS,
  type ImageLodBucket,
  isSafeAvatarUrl,
  resolveImageTargetBucket,
} from '@/features/graph/render/avatar'
import {
  BASE_ATLAS_MAX_BUCKET,
  BASE_ATLAS_MIN_BUCKET,
  cloneAvatarQualityGuideSnapshot,
  createEmptyAvatarQualityGuideSnapshot,
  finalizeAvatarQualityGuideSnapshot,
  modeSupportsHd,
  resolveAvatarPromotedQualityTier,
  resolveAvatarQualityGuideBlockReason,
  type AvatarImageQualityMode,
  type AvatarQualityGuideBlockReason,
  type AvatarQualityGuideTier,
  type AvatarQualityGuideSnapshot,
} from '@/features/graph/render/avatarQualityGuide'
import { resolveAvatarFetchUrl } from '@/features/graph/render/avatarProxyUrl'
import type { GraphRenderNode } from '@/features/graph/render/types'

export interface ImageSourceHandle {
  key: string
  sourceUrl: string
  bucket: ImageLodBucket
  url: string
  byteSize: number
}

export interface ImageTierLodSnapshot {
  bucket: ImageLodBucket
  variants: number
  bytes: number
}

export interface ImageTierSnapshot {
  totalVariants: number
  totalBytes: number
  lodBuckets: ImageTierLodSnapshot[]
}

export interface ImagePendingWorkSnapshot {
  queuedRequests: number
  inFlightRequests: number
  totalRequests: number
  queuedVisibleBaseRequests: number
  queuedVisibleHdRequests: number
  queuedPrefetchRequests: number
  inFlightVisibleBaseRequests: number
  inFlightVisibleHdRequests: number
  inFlightPrefetchRequests: number
  timedOutRequests: number
}

export interface ImageFailureStatusSnapshot {
  status: number | 'unknown'
  count: number
}

export interface ImageFailuresSnapshot {
  blockedSourceUrls: number
  byStatus: ImageFailureStatusSnapshot[]
}

export interface ImageRuntimeContextSnapshot {
  imageQualityMode: PrepareFrameInput['mode'] | null
  viewport: {
    width: number
    height: number
    zoom: number
  } | null
  velocityScore: number | null
  viewportQuietForMs: number | null
  visibleRequests: number
  prefetchRequests: number
}

export type ImageVisibleMissingReason =
  | 'missing-source'
  | 'unsafe-source'
  | 'cooldown'
  | 'queued'
  | 'in-flight'
  | 'decoded-waiting-vram'
  | 'compressed-waiting-decode'
  | 'scheduled-no-variant'
  | 'icon-layer-pending'
  | 'icon-layer-failed'
  | 'icon-layer-dropped'

export interface ImageVisibleMissingReasonSnapshot {
  reason: ImageVisibleMissingReason
  count: number
}

export type ImageDiagnosticHealth = 'healthy' | 'degraded' | 'blocked'

export type ImageDiagnosticStage =
  | 'source'
  | 'persistent'
  | 'compressed'
  | 'decoded'
  | 'resident'
  | 'screen'

export interface ImageDiagnosticsSnapshot {
  health: ImageDiagnosticHealth
  bottleneckStage: ImageDiagnosticStage | null
  primarySummary: string
  secondarySummary: string | null
}

export interface ImageVisibilitySnapshot {
  totalNodes: number
  visibleScreenNodes: number
  usableSourceNodes: number
  missingSourceNodes: number
  unsafeSourceNodes: number
  visibleMissingSourceNodes: number
  visibleUnsafeSourceNodes: number
  invalidRadiusNodes: number
  offscreenNodes: number
  prefetchNodes: number
  visibleNodes: number
  readyVisibleNodes: number
  paintedVisibleNodes: number
  missingVisibleNodes: number
  visibleMissingReasons: ImageVisibleMissingReasonSnapshot[]
}

export interface ImagePresentationSnapshot {
  runtimeReadyVisibleNodes: number
  paintedVisibleNodes: number
  iconLayerPendingVisibleNodes: number
  iconLayerExplicitFailedVisibleNodes: number
  iconLayerDroppedVisibleNodes: number
  iconLayerFailedVisibleNodes: number
}

export interface ImageRendererDeliverySnapshot {
  paintedPubkeys: string[]
  basePaintedPubkeys?: string[]
  hdPaintedPubkeys?: string[]
  failedPubkeys: string[]
}

export interface ImageResidencySnapshot {
  persistentBytes: number
  compressedBytes: number
  decodedBytes: number
  vramBytes: number
  pendingRequests: number
  residentKeys: string[]
  persistent: ImageTierSnapshot
  compressed: ImageTierSnapshot
  decoded: ImageTierSnapshot
  resident: ImageTierSnapshot
  pendingWork: ImagePendingWorkSnapshot
  failures: ImageFailuresSnapshot
  context: ImageRuntimeContextSnapshot
  visibility: ImageVisibilitySnapshot
  presentation: ImagePresentationSnapshot
  qualityGuide: AvatarQualityGuideSnapshot
  diagnostics: ImageDiagnosticsSnapshot
}

export interface ImageRenderPayload {
  readyImagesByPubkey: Record<string, ImageSourceHandle>
  baseReadyImagesByPubkey: Record<string, ImageSourceHandle>
  hdReadyImagesByPubkey: Record<string, ImageSourceHandle>
  paintedPubkeys: string[]
}

export type ImageFrameState = ImageRenderPayload

export interface PrepareFrameInput {
  width: number
  height: number
  viewState: { target: [number, number, number]; zoom: number }
  velocityScore: number
  viewportQuietForMs: number
  nodes: readonly GraphRenderNode[]
  nodeScreenRadii: ReadonlyMap<string, number>
  selectedNodePubkey: string | null
  hoveredNodePubkey: string | null
  mode: AvatarImageQualityMode
  avatarHdZoomThreshold?: number
  avatarFullHdZoomThreshold?: number
}

export interface RequestDetailInput {
  sourceUrl: string
  targetPx: number
}

type TierEntry = {
  key: string
  sourceUrl: string
  bucket: ImageLodBucket
  byteSize: number
  lastUsedAt: number
}

type CompressedEntry = TierEntry & {
  blob: Blob
}

type DecodedEntry = TierEntry & {
  url: string
}

type ResidentEntry = TierEntry & {
  score: number
  lane: 'base' | 'hd'
  visible: boolean
}

type CandidateRequest = {
  pubkey: string
  sourceUrl: string
  targetBucket: ImageLodBucket
  provisionalBucket: ImageLodBucket
  score: number
  visible: boolean
  lane: 'base' | 'hd'
}

type FrameCandidate = {
  pubkey: string
  sourceUrl: string
  baseTargetBucket: ImageLodBucket
  baseProvisionalBucket: ImageLodBucket
  hdTargetBucket: ImageLodBucket
  score: number
  hdScore: number
  visible: boolean
  hdEligible: boolean
  requestedPromotedTier: AvatarQualityGuideTier
  promotedTier: AvatarQualityGuideTier
  qualityGuideBlockReason: AvatarQualityGuideBlockReason | null
  hdAdmissionWeight: number
}

type SourceFailure = {
  retryAt: number
  failCount: number
  lastMessage: string
  status: number | null
  timedOut: boolean
}

type RequestPriorityClass =
  | 'visible-base'
  | 'visible-hd'
  | 'prefetch-base'
  | 'prefetch-hd'

type ScheduledVariantRequest = {
  key: string
  sourceUrl: string
  bucket: ImageLodBucket
  priorityClass: RequestPriorityClass
  enqueuedAt: number
  lastRequestedAt: number
  visible: boolean
  lane: 'base' | 'hd'
}

type InFlightVariantRequest = ScheduledVariantRequest & {
  abortController: AbortController
}

const IMAGE_VARIANT_TTL_MS = 7 * 24 * 60 * 60 * 1000
const DEFAULT_STORAGE_BUDGET_BYTES = 256 * 1024 * 1024
const MAX_STORAGE_BUDGET_BYTES = 512 * 1024 * 1024
const PREFETCH_RING_FACTOR = 0.5
const MAX_UPLOADS_PER_FRAME = 8
const MAX_UPLOAD_BYTES_PER_FRAME = 4 * 1024 * 1024
const FETCH_CONCURRENCY = 8
const IMAGE_FETCH_TIMEOUT_MS = 5_000
const FETCH_FAILURE_BASE_COOLDOWN_MS = 30_000
const FETCH_FAILURE_TIMEOUT_COOLDOWN_MS = 5_000
const FETCH_FAILURE_NOT_FOUND_COOLDOWN_MS = 10 * 60 * 1000
const FETCH_FAILURE_MAX_COOLDOWN_MS = 30 * 60 * 1000
const HD_VIEWPORT_QUIET_MS = 120
const FULL_HD_VIEWPORT_QUIET_MS = 250
const IDLE_VISIBLE_HD_WEIGHT_BUDGET = 96
const MOTION_VISIBLE_HD_WEIGHT_BUDGET = 24

const QUALITY_BUDGETS = {
  performance: {
    vramBytes: 64 * 1024 * 1024,
    decodedBytes: 128 * 1024 * 1024,
    compressedBytes: 32 * 1024 * 1024,
  },
  adaptive: {
    vramBytes: 128 * 1024 * 1024,
    decodedBytes: 192 * 1024 * 1024,
    compressedBytes: 64 * 1024 * 1024,
  },
  quality: {
    vramBytes: 192 * 1024 * 1024,
    decodedBytes: 256 * 1024 * 1024,
    compressedBytes: 96 * 1024 * 1024,
  },
  'full-hd': {
    vramBytes: 256 * 1024 * 1024,
    decodedBytes: 384 * 1024 * 1024,
    compressedBytes: 128 * 1024 * 1024,
  },
} as const

const DETAIL_TARGET_CAP = 256
const FULL_HD_TARGET_CAP = 1024
const EMPTY_TIER_BUCKETS = IMAGE_LOD_BUCKETS.map((bucket) => ({
  bucket,
  variants: 0,
  bytes: 0,
}))

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

const buildVariantKey = (sourceUrl: string, bucket: ImageLodBucket) =>
  `${sourceUrl}::${bucket}`

const buildImageFetchError = (
  message: string,
  status: number | null,
  url: string,
) =>
  Object.assign(new Error(message), {
    status,
    url,
  })

const buildImageFetchTimeoutError = (url: string) =>
  Object.assign(
    new Error(`Image request timed out after ${IMAGE_FETCH_TIMEOUT_MS} ms.`),
    {
      status: null,
      url,
      isTimeout: true,
    },
  )

const buildImageFetchCancelledError = (url: string) =>
  Object.assign(new Error('Image request cancelled.'), {
    status: null,
    url,
    isCancelled: true,
  })

const readErrorStatus = (error: unknown) =>
  typeof error === 'object' &&
  error !== null &&
  'status' in error &&
  typeof error.status === 'number'
    ? error.status
    : null

const readErrorMessage = (error: unknown) =>
  error instanceof Error && error.message.trim().length > 0
    ? error.message
    : typeof error === 'object' &&
        error !== null &&
        'message' in error &&
        typeof error.message === 'string' &&
        error.message.trim().length > 0
      ? error.message
      : 'Image fetch failed.'

const isTimeoutError = (error: unknown) =>
  typeof error === 'object' &&
  error !== null &&
  'isTimeout' in error &&
  error.isTimeout === true

const isCancelledError = (error: unknown) =>
  typeof error === 'object' &&
  error !== null &&
  'isCancelled' in error &&
  error.isCancelled === true

const now = () => Date.now()

const canCreateObjectUrl = () =>
  typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function'

const canRevokeObjectUrl = () =>
  typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function'

const pickModeBudgets = (mode: PrepareFrameInput['mode']) => QUALITY_BUDGETS[mode]

const mergeSortedPubkeys = (...lists: ReadonlyArray<readonly string[]>) =>
  [...new Set(lists.flatMap((list) => [...list]))].sort()

const REQUEST_PRIORITY_ORDER: Record<RequestPriorityClass, number> = {
  'visible-base': 0,
  'visible-hd': 1,
  'prefetch-base': 2,
  'prefetch-hd': 3,
}

const resolveRequestPriorityClass = ({
  visible,
  lane,
}: Pick<ScheduledVariantRequest, 'visible' | 'lane'>): RequestPriorityClass => {
  if (visible && lane === 'base') {
    return 'visible-base'
  }

  if (visible && lane === 'hd') {
    return 'visible-hd'
  }

  if (!visible && lane === 'base') {
    return 'prefetch-base'
  }

  return 'prefetch-hd'
}

const compareScheduledVariantRequests = (
  left: ScheduledVariantRequest,
  right: ScheduledVariantRequest,
) => {
  const priorityDiff =
    REQUEST_PRIORITY_ORDER[left.priorityClass] -
    REQUEST_PRIORITY_ORDER[right.priorityClass]
  if (priorityDiff !== 0) {
    return priorityDiff
  }

  if (left.lastRequestedAt !== right.lastRequestedAt) {
    return right.lastRequestedAt - left.lastRequestedAt
  }

  if (left.enqueuedAt !== right.enqueuedAt) {
    return right.enqueuedAt - left.enqueuedAt
  }

  return left.key.localeCompare(right.key)
}

const mergeScheduledVariantRequest = <
  TRequest extends ScheduledVariantRequest | InFlightVariantRequest,
>(
  existing: TRequest,
  next: ScheduledVariantRequest,
): TRequest => {
  const preferredRequest =
    compareScheduledVariantRequests(existing, next) <= 0 ? existing : next

  return {
    ...existing,
    priorityClass: preferredRequest.priorityClass,
    visible: preferredRequest.visible,
    lane: preferredRequest.lane,
    lastRequestedAt: Math.max(existing.lastRequestedAt, next.lastRequestedAt),
  }
}

const createEmptyTierSnapshot = (): ImageTierSnapshot => ({
  totalVariants: 0,
  totalBytes: 0,
  lodBuckets: EMPTY_TIER_BUCKETS.map((bucket) => ({ ...bucket })),
})

const cloneTierSnapshot = (snapshot: ImageTierSnapshot): ImageTierSnapshot => ({
  totalVariants: snapshot.totalVariants,
  totalBytes: snapshot.totalBytes,
  lodBuckets: snapshot.lodBuckets.map((bucket) => ({ ...bucket })),
})

const createEmptyFailuresSnapshot = (): ImageFailuresSnapshot => ({
  blockedSourceUrls: 0,
  byStatus: [],
})

const createEmptyDiagnosticsSnapshot = (): ImageDiagnosticsSnapshot => ({
  health: 'healthy',
  bottleneckStage: null,
  primarySummary: 'No hay nodos visibles en este frame.',
  secondarySummary: null,
})

const createEmptyPresentationSnapshot = (): ImagePresentationSnapshot => ({
  runtimeReadyVisibleNodes: 0,
  paintedVisibleNodes: 0,
  iconLayerPendingVisibleNodes: 0,
  iconLayerExplicitFailedVisibleNodes: 0,
  iconLayerDroppedVisibleNodes: 0,
  iconLayerFailedVisibleNodes: 0,
})

const cloneFailuresSnapshot = (
  snapshot: ImageFailuresSnapshot,
): ImageFailuresSnapshot => ({
  blockedSourceUrls: snapshot.blockedSourceUrls,
  byStatus: snapshot.byStatus.map((entry) => ({ ...entry })),
})

const cloneDiagnosticsSnapshot = (
  snapshot: ImageDiagnosticsSnapshot,
): ImageDiagnosticsSnapshot => ({
  health: snapshot.health,
  bottleneckStage: snapshot.bottleneckStage,
  primarySummary: snapshot.primarySummary,
  secondarySummary: snapshot.secondarySummary,
})

const clonePresentationSnapshot = (
  snapshot: ImagePresentationSnapshot,
): ImagePresentationSnapshot => ({
  runtimeReadyVisibleNodes: snapshot.runtimeReadyVisibleNodes,
  paintedVisibleNodes: snapshot.paintedVisibleNodes,
  iconLayerPendingVisibleNodes: snapshot.iconLayerPendingVisibleNodes,
  iconLayerExplicitFailedVisibleNodes:
    snapshot.iconLayerExplicitFailedVisibleNodes,
  iconLayerDroppedVisibleNodes: snapshot.iconLayerDroppedVisibleNodes,
  iconLayerFailedVisibleNodes: snapshot.iconLayerFailedVisibleNodes,
})

const createEmptyContextSnapshot = (): ImageRuntimeContextSnapshot => ({
  imageQualityMode: null,
  viewport: null,
  velocityScore: null,
  viewportQuietForMs: null,
  visibleRequests: 0,
  prefetchRequests: 0,
})

const cloneContextSnapshot = (
  snapshot: ImageRuntimeContextSnapshot,
): ImageRuntimeContextSnapshot => ({
  imageQualityMode: snapshot.imageQualityMode,
  viewport: snapshot.viewport ? { ...snapshot.viewport } : null,
  velocityScore: snapshot.velocityScore,
  viewportQuietForMs: snapshot.viewportQuietForMs,
  visibleRequests: snapshot.visibleRequests,
  prefetchRequests: snapshot.prefetchRequests,
})

const createEmptyVisibilitySnapshot = (): ImageVisibilitySnapshot => ({
  totalNodes: 0,
  visibleScreenNodes: 0,
  usableSourceNodes: 0,
  missingSourceNodes: 0,
  unsafeSourceNodes: 0,
  visibleMissingSourceNodes: 0,
  visibleUnsafeSourceNodes: 0,
  invalidRadiusNodes: 0,
  offscreenNodes: 0,
  prefetchNodes: 0,
  visibleNodes: 0,
  readyVisibleNodes: 0,
  paintedVisibleNodes: 0,
  missingVisibleNodes: 0,
  visibleMissingReasons: [],
})

const cloneVisibilitySnapshot = (
  snapshot: ImageVisibilitySnapshot,
): ImageVisibilitySnapshot => ({
  totalNodes: snapshot.totalNodes,
  visibleScreenNodes: snapshot.visibleScreenNodes,
  usableSourceNodes: snapshot.usableSourceNodes,
  missingSourceNodes: snapshot.missingSourceNodes,
  unsafeSourceNodes: snapshot.unsafeSourceNodes,
  visibleMissingSourceNodes: snapshot.visibleMissingSourceNodes,
  visibleUnsafeSourceNodes: snapshot.visibleUnsafeSourceNodes,
  invalidRadiusNodes: snapshot.invalidRadiusNodes,
  offscreenNodes: snapshot.offscreenNodes,
  prefetchNodes: snapshot.prefetchNodes,
  visibleNodes: snapshot.visibleNodes,
  readyVisibleNodes: snapshot.readyVisibleNodes,
  paintedVisibleNodes: snapshot.paintedVisibleNodes,
  missingVisibleNodes: snapshot.missingVisibleNodes,
  visibleMissingReasons: snapshot.visibleMissingReasons.map((entry) => ({
    ...entry,
  })),
})

const VISIBLE_MISSING_REASON_STAGE: Record<
  ImageVisibleMissingReason,
  ImageDiagnosticStage
> = {
  'missing-source': 'source',
  'unsafe-source': 'source',
  cooldown: 'source',
  queued: 'source',
  'in-flight': 'source',
  'decoded-waiting-vram': 'resident',
  'compressed-waiting-decode': 'decoded',
  'scheduled-no-variant': 'source',
  'icon-layer-pending': 'screen',
  'icon-layer-failed': 'screen',
  'icon-layer-dropped': 'screen',
}

const formatDiagnosticCount = (
  count: number,
  singular: string,
  plural = `${singular}s`,
) => `${count} ${count === 1 ? singular : plural}`

const formatFailureStatusLabel = (
  status: ImageFailureStatusSnapshot['status'],
) => (status === 'unknown' ? 'estado desconocido' : `HTTP ${status}`)

const summarizeVisibleMissingReason = (
  entry: ImageVisibleMissingReasonSnapshot,
) => {
  const countLabel = formatDiagnosticCount(entry.count, 'visible')

  switch (entry.reason) {
    case 'missing-source':
      return `${countLabel} sin URL de avatar.`
    case 'unsafe-source':
      return `${countLabel} con URL de avatar bloqueada por seguridad.`
    case 'cooldown':
      return `${countLabel} frenado${entry.count === 1 ? '' : 's'} por cooldown de origen.`
    case 'queued':
      return `${countLabel} esperando turno de descarga.`
    case 'in-flight':
      return `${countLabel} descargando desde origen.`
    case 'decoded-waiting-vram':
      return `${countLabel} ya decodificado${entry.count === 1 ? '' : 's'}, pendiente${entry.count === 1 ? '' : 's'} de subir a VRAM.`
    case 'compressed-waiting-decode':
      return `${countLabel} ya descargado${entry.count === 1 ? '' : 's'}, pendiente${entry.count === 1 ? '' : 's'} de decode.`
    case 'scheduled-no-variant':
      return `${countLabel} sin variante lista todavia.`
    case 'icon-layer-pending':
      return `${countLabel} listo${entry.count === 1 ? '' : 's'} en runtime, pendiente${entry.count === 1 ? '' : 's'} de capa de iconos en pantalla.`
    case 'icon-layer-failed':
      return `${countLabel} con fallo explicito al entrar a la capa de iconos.`
    case 'icon-layer-dropped':
      return `${countLabel} que ${entry.count === 1 ? 'se pintaba antes y despues desaparecio' : 'se pintaban antes y despues desaparecieron'} de la capa de iconos.`
  }
}

const summarizeFailureStatus = (snapshot: ImageFailuresSnapshot) => {
  if (snapshot.blockedSourceUrls === 0) {
    return null
  }

  const dominantStatus = snapshot.byStatus[0]
  if (!dominantStatus) {
    return `${formatDiagnosticCount(snapshot.blockedSourceUrls, 'URL')} bloqueada${snapshot.blockedSourceUrls === 1 ? '' : 's'}.`
  }

  const extraStatuses = Math.max(0, snapshot.byStatus.length - 1)
  return `${formatDiagnosticCount(snapshot.blockedSourceUrls, 'URL')} bloqueada${snapshot.blockedSourceUrls === 1 ? '' : 's'} por ${formatFailureStatusLabel(dominantStatus.status)}${extraStatuses > 0 ? ` +${extraStatuses}` : ''}.`
}

const summarizePendingWork = (snapshot: ImagePendingWorkSnapshot) => {
  if (snapshot.totalRequests === 0) {
    return null
  }

  return `Pendiente: cola ${snapshot.queuedRequests}, en vuelo ${snapshot.inFlightRequests}.`
}

const equalStringLists = (left: readonly string[], right: readonly string[]) =>
  left.length === right.length &&
  left.every((value, index) => value === right[index])

const mergeVisibleMissingReasons = ({
  visibility,
  presentation,
}: {
  visibility: ImageVisibilitySnapshot
  presentation: ImagePresentationSnapshot
}) => {
  const visibleMissingReasons = new Map<ImageVisibleMissingReason, number>()

  for (const entry of visibility.visibleMissingReasons) {
    visibleMissingReasons.set(entry.reason, entry.count)
  }

  if (presentation.iconLayerPendingVisibleNodes > 0) {
    visibleMissingReasons.set(
      'icon-layer-pending',
      presentation.iconLayerPendingVisibleNodes,
    )
  }

  if (presentation.iconLayerExplicitFailedVisibleNodes > 0) {
    visibleMissingReasons.set(
      'icon-layer-failed',
      presentation.iconLayerExplicitFailedVisibleNodes,
    )
  }

  if (presentation.iconLayerDroppedVisibleNodes > 0) {
    visibleMissingReasons.set(
      'icon-layer-dropped',
      presentation.iconLayerDroppedVisibleNodes,
    )
  }

  return Array.from(visibleMissingReasons.entries())
    .sort(([, leftCount], [, rightCount]) => rightCount - leftCount)
    .map(([reason, count]) => ({
      reason,
      count,
    }))
}

const resolveDiagnosticsSnapshot = ({
  visibility,
  presentation,
  failures,
  pendingWork,
}: Pick<
  ImageResidencySnapshot,
  'visibility' | 'presentation' | 'failures' | 'pendingWork'
>): ImageDiagnosticsSnapshot => {
  if (visibility.visibleScreenNodes === 0) {
    return {
      health: 'healthy',
      bottleneckStage: null,
      primarySummary: 'No hay nodos visibles en este frame.',
      secondarySummary:
        summarizePendingWork(pendingWork) ?? summarizeFailureStatus(failures),
    }
  }

  const visibleAvatarlessNodes = Math.max(
    0,
    visibility.visibleScreenNodes - presentation.paintedVisibleNodes,
  )

  if (visibleAvatarlessNodes === 0) {
    return {
      health: 'healthy',
      bottleneckStage: null,
      primarySummary: 'Todos los nodos visibles muestran avatar.',
      secondarySummary:
        summarizePendingWork(pendingWork) ?? summarizeFailureStatus(failures),
    }
  }

  const primaryReason = visibility.visibleMissingReasons[0] ?? null
  const secondaryReason = visibility.visibleMissingReasons[1] ?? null
  const primaryStage = primaryReason
    ? VISIBLE_MISSING_REASON_STAGE[primaryReason.reason]
    : 'source'
  const health: ImageDiagnosticHealth =
    primaryReason?.reason === 'cooldown' ||
    ((primaryReason?.reason === 'icon-layer-failed' ||
      primaryReason?.reason === 'icon-layer-dropped') &&
      presentation.iconLayerPendingVisibleNodes === 0) ||
    (visibility.readyVisibleNodes === 0 &&
      failures.blockedSourceUrls > 0 &&
      pendingWork.totalRequests === 0)
      ? 'blocked'
      : 'degraded'

  let secondarySummary: string | null = null
  if (secondaryReason) {
    secondarySummary = `Tambien: ${summarizeVisibleMissingReason(secondaryReason)}`
  } else if (primaryReason?.reason !== 'cooldown') {
    secondarySummary =
      summarizeFailureStatus(failures) ?? summarizePendingWork(pendingWork)
  } else {
    secondarySummary = summarizePendingWork(pendingWork)
  }

  return {
    health,
    bottleneckStage: primaryStage,
    primarySummary: primaryReason
      ? summarizeVisibleMissingReason(primaryReason)
      : `Hay ${visibleAvatarlessNodes} nodos visibles sin avatar.`,
    secondarySummary,
  }
}

const summarizeTierEntries = (
  entries: Iterable<Pick<TierEntry, 'bucket' | 'byteSize'>>,
): ImageTierSnapshot => {
  const snapshot = createEmptyTierSnapshot()

  for (const entry of entries) {
    snapshot.totalVariants += 1
    snapshot.totalBytes += entry.byteSize

    const bucketSummary = snapshot.lodBuckets.find(
      (bucket) => bucket.bucket === entry.bucket,
    )
    if (!bucketSummary) {
      continue
    }

    bucketSummary.variants += 1
    bucketSummary.bytes += entry.byteSize
  }

  return snapshot
}

const summarizeStoredTier = (
  summary: ImageVariantStorageSummary,
): ImageTierSnapshot => {
  const snapshot = createEmptyTierSnapshot()
  snapshot.totalVariants = summary.totalVariants
  snapshot.totalBytes = summary.totalBytes

  for (const bucket of summary.lodBuckets) {
    const bucketSummary = snapshot.lodBuckets.find(
      (entry) => entry.bucket === bucket.bucket,
    )
    if (!bucketSummary) {
      continue
    }

    bucketSummary.variants = bucket.variants
    bucketSummary.bytes = bucket.bytes
  }

  return snapshot
}

export const createEmptyImageResidencySnapshot =
  (): ImageResidencySnapshot => ({
    persistentBytes: 0,
    compressedBytes: 0,
    decodedBytes: 0,
    vramBytes: 0,
    pendingRequests: 0,
    residentKeys: [],
    persistent: createEmptyTierSnapshot(),
    compressed: createEmptyTierSnapshot(),
    decoded: createEmptyTierSnapshot(),
    resident: createEmptyTierSnapshot(),
    pendingWork: {
      queuedRequests: 0,
      inFlightRequests: 0,
      totalRequests: 0,
      queuedVisibleBaseRequests: 0,
      queuedVisibleHdRequests: 0,
      queuedPrefetchRequests: 0,
      inFlightVisibleBaseRequests: 0,
      inFlightVisibleHdRequests: 0,
      inFlightPrefetchRequests: 0,
      timedOutRequests: 0,
    },
    failures: createEmptyFailuresSnapshot(),
    context: createEmptyContextSnapshot(),
    visibility: createEmptyVisibilitySnapshot(),
    presentation: createEmptyPresentationSnapshot(),
    qualityGuide: createEmptyAvatarQualityGuideSnapshot(),
    diagnostics: createEmptyDiagnosticsSnapshot(),
  })

export const createEmptyImageRenderPayload = (): ImageRenderPayload => ({
  readyImagesByPubkey: {},
  baseReadyImagesByPubkey: {},
  hdReadyImagesByPubkey: {},
  paintedPubkeys: [],
})

const pickProvisionalBucket = (
  targetBucket: ImageLodBucket,
  priorityLane: boolean,
) => {
  const preferredCap = priorityLane ? 128 : 64
  return IMAGE_LOD_BUCKETS.find(
    (bucket) => bucket >= Math.min(targetBucket, preferredCap),
  ) ?? targetBucket
}

const normalizeBaseAtlasBucket = (
  bucket: ImageLodBucket,
): ImageLodBucket => {
  const clampedBucket = clamp(bucket, BASE_ATLAS_MIN_BUCKET, BASE_ATLAS_MAX_BUCKET)
  return clampedBucket <= BASE_ATLAS_MIN_BUCKET
    ? BASE_ATLAS_MIN_BUCKET
    : BASE_ATLAS_MAX_BUCKET
}

const normalizeHdTargetBucket = (
  bucket: ImageLodBucket,
  mode: PrepareFrameInput['mode'],
): ImageLodBucket => {
  if (mode === 'full-hd') {
    return resolveImageTargetBucket({
      cssPixels: clamp(
        Math.max(bucket * 2, DETAIL_TARGET_CAP),
        DETAIL_TARGET_CAP,
        FULL_HD_TARGET_CAP,
      ),
      devicePixelRatio: 1,
      devicePixelRatioCap: 1,
    })
  }

  return resolveImageTargetBucket({
    cssPixels: clamp(
      Math.max(bucket, BASE_ATLAS_MAX_BUCKET),
      BASE_ATLAS_MAX_BUCKET,
      DETAIL_TARGET_CAP,
    ),
    devicePixelRatio: 1,
    devicePixelRatioCap: 1,
  })
}

const compareRequestPriority = (left: CandidateRequest, right: CandidateRequest) => {
  const laneWeight = (request: CandidateRequest) => {
    if (request.visible && request.lane === 'base') {
      return 0
    }

    if (request.visible && request.lane === 'hd') {
      return 1
    }

    if (!request.visible && request.lane === 'base') {
      return 2
    }

    return 3
  }

  const leftWeight = laneWeight(left)
  const rightWeight = laneWeight(right)
  if (leftWeight !== rightWeight) {
    return leftWeight - rightWeight
  }

  return right.score - left.score
}

const compareResidentEvictionPriority = (
  left: ResidentEntry,
  right: ResidentEntry,
  hotSources: ReadonlySet<string>,
) => {
  const retentionWeight = (entry: ResidentEntry) => {
    if (entry.visible && entry.lane === 'base') {
      return 3
    }

    if (entry.visible && entry.lane === 'hd') {
      return 2
    }

    if (!entry.visible && entry.lane === 'base') {
      return 1
    }

    return 0
  }

  const leftRetention = retentionWeight(left)
  const rightRetention = retentionWeight(right)
  if (leftRetention !== rightRetention) {
    return leftRetention - rightRetention
  }

  const leftHot = hotSources.has(left.sourceUrl) ? 1 : 0
  const rightHot = hotSources.has(right.sourceUrl) ? 1 : 0
  if (leftHot !== rightHot) {
    return leftHot - rightHot
  }

  if (left.score !== right.score) {
    return left.score - right.score
  }

  return left.lastUsedAt - right.lastUsedAt
}

const resolveHdCandidateScore = ({
  node,
  screenRadius,
  selectedNodePubkey,
}: {
  node: GraphRenderNode
  screenRadius: number
  selectedNodePubkey: string | null
}) =>
  Math.round(clamp(screenRadius, 0, FULL_HD_TARGET_CAP)) +
  (node.isSelected || node.pubkey === selectedNodePubkey ? 80 : 0) +
  (node.isRoot ? 40 : 0) +
  (node.isExpanded ? 20 : 0)

const resolveHdAdmissionWeight = (bucket: ImageLodBucket) => {
  if (bucket >= 1024) {
    return 16
  }

  if (bucket >= 512) {
    return 4
  }

  if (bucket >= 256) {
    return 1
  }

  return 0
}

const resolveVisibleHdWeightBudget = (viewportQuietForMs: number) =>
  viewportQuietForMs >= HD_VIEWPORT_QUIET_MS
    ? IDLE_VISIBLE_HD_WEIGHT_BUDGET
    : MOTION_VISIBLE_HD_WEIGHT_BUDGET

const estimateStorageBudget = async () => {
  if (
    typeof navigator === 'undefined' ||
    !navigator.storage ||
    typeof navigator.storage.estimate !== 'function'
  ) {
    return DEFAULT_STORAGE_BUDGET_BYTES
  }

  try {
    const estimate = await navigator.storage.estimate()
    if (typeof estimate.quota === 'number' && Number.isFinite(estimate.quota)) {
      return Math.min(
        MAX_STORAGE_BUDGET_BYTES,
        Math.max(DEFAULT_STORAGE_BUDGET_BYTES, Math.floor(estimate.quota * 0.2)),
      )
    }
  } catch {
    // ignore
  }

  return DEFAULT_STORAGE_BUDGET_BYTES
}

export class ImageRuntime {
  private readonly repositories = createRepositories(createNostrGraphDatabase())
  private readonly compressedCache = new Map<string, CompressedEntry>()
  private readonly decodedCache = new Map<string, DecodedEntry>()
  private readonly residentCache = new Map<string, ResidentEntry>()
  private readonly previousBuckets = new Map<string, ImageLodBucket>()
  private readonly queuedRequests = new Map<string, ScheduledVariantRequest>()
  private readonly inFlightRequests = new Map<string, InFlightVariantRequest>()
  private readonly sourceFailures = new Map<string, SourceFailure>()
  private readonly listeners = new Set<() => void>()
  private timedOutRequests = 0
  private persistentBudgetBytes = DEFAULT_STORAGE_BUDGET_BYTES
  private persistentBudgetPromise: Promise<void> | null = null
  private persistentSummarySyncActive = false
  private persistentSummarySyncPending = false
  private notifyScheduled = false
  private persistentSnapshot = createEmptyTierSnapshot()
  private compressedSnapshot = createEmptyTierSnapshot()
  private decodedSnapshot = createEmptyTierSnapshot()
  private residentSnapshot = createEmptyTierSnapshot()
  private residentKeysSnapshot: string[] = []
  private failuresSnapshot = createEmptyFailuresSnapshot()
  private contextSnapshot = createEmptyContextSnapshot()
  private visibilitySnapshot = createEmptyVisibilitySnapshot()
  private presentationSnapshot = createEmptyPresentationSnapshot()
  private qualityGuideSnapshot = createEmptyAvatarQualityGuideSnapshot()
  private readyPubkeysForRenderer: string[] = []
  private basePaintedPubkeysFromRenderer: string[] = []
  private hdPaintedPubkeysFromRenderer: string[] = []
  private paintedPubkeysFromRenderer: string[] = []
  private failedPubkeysFromRenderer: string[] = []
  private droppedPubkeysFromRenderer: string[] = []
  private readonly baseDisplayHandlesByPubkey = new Map<
    string,
    ImageSourceHandle
  >()
  private readonly hdDisplayHandlesByPubkey = new Map<string, ImageSourceHandle>()
  private readonly fullHdEligibilityStreakByPubkey = new Map<string, number>()

  public constructor() {
    this.persistentBudgetPromise = estimateStorageBudget().then((budget) => {
      this.persistentBudgetBytes = budget
    })
    this.schedulePersistentSummaryRefresh()
    this.preloadCachedVariants()
  }

  private async preloadCachedVariants() {
    try {
      const records = await this.repositories.imageVariants.getAll()
      const frameNow = now()
      let processed = 0
      const BATCH_SIZE = 20 // Procesar en chunks para no bloquear el hilo

      const processRecords = () => {
        for (let i = 0; i < BATCH_SIZE && processed < records.length; i++) {
          const record = records[processed++]
          const bucket = record.bucket as ImageLodBucket
          const key = buildVariantKey(record.sourceUrl, bucket)

          if (this.decodedCache.has(key)) {
            continue
          }

          if (record.expiresAt <= frameNow) {
            void this.repositories.imageVariants
              .delete([record.sourceUrl, bucket])
              .catch(console.warn)
            continue
          }

          const compressed = this.toCompressedEntry(record)
          this.compressedCache.set(key, compressed)

          const url = this.createBlobUrl(
            record.sourceUrl,
            bucket,
            compressed.blob,
          )
          this.decodedCache.set(key, {
            key,
            sourceUrl: record.sourceUrl,
            bucket,
            byteSize: compressed.byteSize,
            lastUsedAt: frameNow,
            url,
          })
        }

        if (processed < records.length) {
          queueMicrotask(processRecords)
          return
        }

        this.refreshMemoryTierSnapshots()
        this.scheduleNotify()
      }

      processRecords()
    } catch (error) {
      console.warn('Failed to preload cached image variants:', error)
    }
  }

  public subscribe(listener: () => void) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  public dispose() {
    for (const request of this.inFlightRequests.values()) {
      if (!request.abortController.signal.aborted) {
        request.abortController.abort('runtime-disposed')
      }
    }
    for (const entry of this.decodedCache.values()) {
      if (canRevokeObjectUrl()) {
        URL.revokeObjectURL(entry.url)
      }
    }
    this.decodedCache.clear()
    this.compressedCache.clear()
    this.residentCache.clear()
    this.previousBuckets.clear()
    this.sourceFailures.clear()
    this.listeners.clear()
    this.queuedRequests.clear()
    this.inFlightRequests.clear()
    this.timedOutRequests = 0
    this.refreshMemoryTierSnapshots()
    this.refreshFailureSnapshot()
    this.visibilitySnapshot = createEmptyVisibilitySnapshot()
    this.presentationSnapshot = createEmptyPresentationSnapshot()
    this.qualityGuideSnapshot = createEmptyAvatarQualityGuideSnapshot()
    this.readyPubkeysForRenderer = []
    this.basePaintedPubkeysFromRenderer = []
    this.hdPaintedPubkeysFromRenderer = []
    this.paintedPubkeysFromRenderer = []
    this.failedPubkeysFromRenderer = []
    this.droppedPubkeysFromRenderer = []
    this.baseDisplayHandlesByPubkey.clear()
    this.hdDisplayHandlesByPubkey.clear()
    this.fullHdEligibilityStreakByPubkey.clear()
  }

  // Arma el estado de imagenes para este frame: que pubkeys estan listas en runtime,
  // cuales siguen efectivamente pintadas y donde se corta el pipeline.
  public prepareFrame(input: PrepareFrameInput): ImageRenderPayload {
    const budgets = pickModeBudgets(input.mode)
    const viewportQuietForMs = Math.max(0, input.viewportQuietForMs)
    const visibleHdWeightBudget = resolveVisibleHdWeightBudget(viewportQuietForMs)
    const viewport = new OrthographicViewport({
      width: input.width,
      height: input.height,
      target: input.viewState.target,
      zoom: input.viewState.zoom,
    })
    const frameNow = now()
    const visibleWidth = input.width
    const visibleHeight = input.height
    const prefetchX = visibleWidth * PREFETCH_RING_FACTOR
    const prefetchY = visibleHeight * PREFETCH_RING_FACTOR
    const frameCandidates: FrameCandidate[] = []
    const activeVisiblePubkeys = new Set<string>()
    const visibilitySnapshot = createEmptyVisibilitySnapshot()
    const qualityGuideSnapshot: AvatarQualityGuideSnapshot = {
      ...createEmptyAvatarQualityGuideSnapshot(),
      mode: input.mode,
      zoom: input.viewState.zoom,
      maxHdVisibleNodes: null,
    }

    for (const node of input.nodes) {
      visibilitySnapshot.totalNodes += 1
      const screenRadius = input.nodeScreenRadii.get(node.pubkey) ?? node.radius
      if (!Number.isFinite(screenRadius) || screenRadius <= 0) {
        visibilitySnapshot.invalidRadiusNodes += 1
        continue
      }

      const [screenX, screenY] = viewport.project([
        node.position[0],
        node.position[1],
        0,
      ])
      const bleed = screenRadius + 12
      const visible =
        screenX >= -bleed &&
        screenX <= visibleWidth + bleed &&
        screenY >= -bleed &&
        screenY <= visibleHeight + bleed
      const prefetch =
        screenX >= -prefetchX &&
        screenX <= visibleWidth + prefetchX &&
        screenY >= -prefetchY &&
        screenY <= visibleHeight + prefetchY

      if (visible) {
        visibilitySnapshot.visibleScreenNodes += 1
      }

      if (typeof node.pictureUrl !== 'string' || node.pictureUrl.trim().length === 0) {
        visibilitySnapshot.missingSourceNodes += 1
        if (visible) {
          visibilitySnapshot.visibleMissingSourceNodes += 1
        }
        continue
      }

      if (!isSafeAvatarUrl(node.pictureUrl)) {
        visibilitySnapshot.unsafeSourceNodes += 1
        if (visible) {
          visibilitySnapshot.visibleUnsafeSourceNodes += 1
        }
        continue
      }
      visibilitySnapshot.usableSourceNodes += 1

      if (!visible && !prefetch) {
        visibilitySnapshot.offscreenNodes += 1
        continue
      }

      if (!visible) {
        visibilitySnapshot.prefetchNodes += 1
      } else {
        visibilitySnapshot.visibleNodes += 1
        activeVisiblePubkeys.add(node.pubkey)
      }

      const priorityLane =
        node.pubkey === input.selectedNodePubkey ||
        node.isRoot
      const requestedPixels = screenRadius * 2
      const hysteresisBucket = applyImageBucketHysteresis({
        previousBucket: this.previousBuckets.get(node.pictureUrl) ?? null,
        requestedPixels,
      })
      const requestedBucket = clampImageBucketForMotion({
        bucket: hysteresisBucket,
        velocityScore: input.velocityScore,
        priorityLane,
      })
      this.previousBuckets.set(node.pictureUrl, requestedBucket)

      const baseTargetBucket = normalizeBaseAtlasBucket(requestedBucket)
      const qualityGuideBlockReason = visible
        ? resolveAvatarQualityGuideBlockReason({
            mode: input.mode,
            zoomLevel: input.viewState.zoom,
            unclampedBucket: hysteresisBucket,
            requestedBucket,
            zoomThresholds: input,
          })
        : null
      // Los thresholds de zoom para HD/Full HD solo aplican a nodos realmente
      // visibles; el anillo de prefetch puede calentar base, pero no altera
      // el lane HD ni los contadores de guia para avatares fuera de pantalla.
      const requestedPromotedTier =
        visible && modeSupportsHd(input.mode)
          ? resolveAvatarPromotedQualityTier({
              mode: input.mode,
              zoomLevel: input.viewState.zoom,
              requestedBucket,
              zoomThresholds: input,
            })
          : 'base'
      let promotedTier = requestedPromotedTier
      let nextQualityGuideBlockReason = qualityGuideBlockReason

      if (!visible || requestedPromotedTier === 'base') {
        this.fullHdEligibilityStreakByPubkey.delete(node.pubkey)
      } else if (viewportQuietForMs < HD_VIEWPORT_QUIET_MS) {
        promotedTier = 'base'
        nextQualityGuideBlockReason = 'motion'
        this.fullHdEligibilityStreakByPubkey.delete(node.pubkey)
      } else if (requestedPromotedTier === 'full-hd') {
        if (viewportQuietForMs < FULL_HD_VIEWPORT_QUIET_MS) {
          promotedTier = 'hd'
          this.fullHdEligibilityStreakByPubkey.delete(node.pubkey)
        } else {
          const nextFullHdStreak =
            (this.fullHdEligibilityStreakByPubkey.get(node.pubkey) ?? 0) + 1

          this.fullHdEligibilityStreakByPubkey.set(node.pubkey, nextFullHdStreak)
          if (nextFullHdStreak < 2) {
            promotedTier = 'hd'
          }
        }
      } else {
        this.fullHdEligibilityStreakByPubkey.delete(node.pubkey)
      }

      const hdEligible =
        modeSupportsHd(input.mode) &&
        visible &&
        promotedTier !== 'base'
      const hdTargetBucket = normalizeHdTargetBucket(
        requestedBucket,
        promotedTier === 'full-hd' ? 'full-hd' : 'quality',
      )

      frameCandidates.push({
        pubkey: node.pubkey,
        sourceUrl: node.pictureUrl,
        baseTargetBucket,
        baseProvisionalBucket: pickProvisionalBucket(
          baseTargetBucket,
          priorityLane,
        ),
        hdTargetBucket,
        score:
          (priorityLane ? 100 : visible ? 80 : 40) +
          Math.round(clamp(screenRadius, 0, 256)),
        hdScore: resolveHdCandidateScore({
          node,
          screenRadius,
          selectedNodePubkey: input.selectedNodePubkey,
        }),
        visible,
        hdEligible,
        requestedPromotedTier,
        promotedTier,
        qualityGuideBlockReason: nextQualityGuideBlockReason,
        hdAdmissionWeight: hdEligible
          ? resolveHdAdmissionWeight(hdTargetBucket)
          : 0,
      })
    }

    for (const pubkey of this.fullHdEligibilityStreakByPubkey.keys()) {
      if (!activeVisiblePubkeys.has(pubkey)) {
        this.fullHdEligibilityStreakByPubkey.delete(pubkey)
      }
    }

    let remainingHdWeightBudget = visibleHdWeightBudget
    const hdBudgetCandidates = frameCandidates
      .filter((candidate) => candidate.visible && candidate.promotedTier !== 'base')
      .sort((left, right) => {
        if (left.hdScore !== right.hdScore) {
          return right.hdScore - left.hdScore
        }

        return left.pubkey.localeCompare(right.pubkey)
      })

    for (const candidate of hdBudgetCandidates) {
      if (candidate.promotedTier === 'full-hd') {
        if (candidate.hdAdmissionWeight > remainingHdWeightBudget) {
          const fallbackHdBucket = normalizeHdTargetBucket(
            candidate.baseTargetBucket,
            'quality',
          )
          const fallbackHdWeight = resolveHdAdmissionWeight(fallbackHdBucket)

          if (fallbackHdWeight > 0 && fallbackHdWeight <= remainingHdWeightBudget) {
            candidate.promotedTier = 'hd'
            candidate.hdTargetBucket = fallbackHdBucket
            candidate.hdAdmissionWeight = fallbackHdWeight
            candidate.hdEligible = true
            candidate.qualityGuideBlockReason = 'admission-budget'
          } else {
            candidate.promotedTier = 'base'
            candidate.hdEligible = false
            candidate.hdAdmissionWeight = 0
            candidate.qualityGuideBlockReason = 'admission-budget'
            continue
          }
        }
      }

      if (candidate.promotedTier === 'base') {
        continue
      }

      if (candidate.hdAdmissionWeight > remainingHdWeightBudget) {
        candidate.promotedTier = 'base'
        candidate.hdEligible = false
        candidate.hdAdmissionWeight = 0
        candidate.qualityGuideBlockReason = 'admission-budget'
        continue
      }

      remainingHdWeightBudget -= candidate.hdAdmissionWeight
    }

    const baseRequests: CandidateRequest[] = []
    const hdRequests: CandidateRequest[] = []

    for (const candidate of frameCandidates) {
      if (candidate.visible) {
        qualityGuideSnapshot.visibleAvatarNodes += 1

        if (candidate.promotedTier === 'full-hd') {
          qualityGuideSnapshot.fullHdVisibleNodes += 1
        } else if (candidate.promotedTier === 'hd') {
          qualityGuideSnapshot.hdVisibleNodes += 1
        } else {
          qualityGuideSnapshot.baseVisibleNodes += 1
        }

        if (candidate.qualityGuideBlockReason === 'admission-budget') {
          qualityGuideSnapshot.blockedByAdmissionBudget += 1
        }

        if (candidate.promotedTier === 'base') {
          if (candidate.qualityGuideBlockReason === 'mode') {
            qualityGuideSnapshot.blockedByMode += 1
          } else if (candidate.qualityGuideBlockReason === 'zoom') {
            qualityGuideSnapshot.blockedByZoom += 1
          } else if (candidate.qualityGuideBlockReason === 'size') {
            qualityGuideSnapshot.blockedBySize += 1
          } else if (candidate.qualityGuideBlockReason === 'motion') {
            qualityGuideSnapshot.blockedByMotion += 1
          }
        }
      }

      baseRequests.push({
        pubkey: candidate.pubkey,
        sourceUrl: candidate.sourceUrl,
        targetBucket: candidate.baseTargetBucket,
        provisionalBucket: candidate.baseProvisionalBucket,
        score: candidate.score,
        visible: candidate.visible,
        lane: 'base',
      })

      if (candidate.visible && candidate.promotedTier !== 'base') {
        hdRequests.push({
          pubkey: candidate.pubkey,
          sourceUrl: candidate.sourceUrl,
          targetBucket: candidate.hdTargetBucket,
          provisionalBucket: pickProvisionalBucket(candidate.hdTargetBucket, true),
          score: candidate.hdScore,
          visible: true,
          lane: 'hd',
        })
      }
    }

    const requests = [...baseRequests, ...hdRequests].sort(compareRequestPriority)

    this.contextSnapshot = {
      imageQualityMode: input.mode,
      viewport: {
        width: input.width,
        height: input.height,
        zoom: input.viewState.zoom,
      },
      velocityScore: input.velocityScore,
      viewportQuietForMs,
      visibleRequests: visibilitySnapshot.visibleNodes,
      prefetchRequests: visibilitySnapshot.prefetchNodes,
    }

    // Batch-cargar desde IndexedDB todos los que no están en memoria de una sola transacción
    this.batchPreloadFromPersistent(requests, frameNow)

    for (const request of requests) {
      this.scheduleEnsureVariant({
        sourceUrl: request.sourceUrl,
        bucket: request.provisionalBucket,
        visible: request.visible,
        lane: request.lane,
      })
      if (request.targetBucket !== request.provisionalBucket) {
        this.scheduleEnsureVariant({
          sourceUrl: request.sourceUrl,
          bucket: request.targetBucket,
          visible: request.visible,
          lane: request.lane,
        })
      }
    }

    this.promoteResidents(requests, budgets.vramBytes, frameNow)
    this.evictDecodedCache(budgets.decodedBytes)
    this.evictCompressedCache(budgets.compressedBytes)
    if (
      this.evictResidentCache(
        budgets.vramBytes,
        new Set(requests.map((r) => r.sourceUrl)),
      )
    ) {
      this.refreshMemoryTierSnapshots()
    }

    const baseReadyImagesByPubkey: Record<string, ImageSourceHandle> = {}
    const hdReadyImagesByPubkey: Record<string, ImageSourceHandle> = {}
    const readyImagesByPubkey: Record<string, ImageSourceHandle> = {}
    const readyPubkeysForRenderer: string[] = []
    const visibleBaseHandlePubkeys = new Set<string>()
    const visibleHdHandlePubkeys = new Set<string>()
    const failedPubkeySet = new Set(this.failedPubkeysFromRenderer)
    const hdPaintedPubkeySet = new Set(this.hdPaintedPubkeysFromRenderer)
    const baseHandlesByPubkey = new Map<string, ImageSourceHandle>()
    const hdHandlesByPubkey = new Map<string, ImageSourceHandle>()
    const visibleMissingReasons = new Map<ImageVisibleMissingReason, number>()
    if (visibilitySnapshot.visibleMissingSourceNodes > 0) {
      visibleMissingReasons.set(
        'missing-source',
        visibilitySnapshot.visibleMissingSourceNodes,
      )
    }
    if (visibilitySnapshot.visibleUnsafeSourceNodes > 0) {
      visibleMissingReasons.set(
        'unsafe-source',
        visibilitySnapshot.visibleUnsafeSourceNodes,
      )
    }
    for (const request of requests.filter((candidate) => candidate.visible)) {
      const handle = this.pickResidentHandle(
        request.sourceUrl,
        request.targetBucket,
        frameNow,
      )
      if (!handle) {
        continue
      }

      const displayHandle = this.pickDisplayHandle(
        request.lane === 'hd'
          ? this.hdDisplayHandlesByPubkey
          : this.baseDisplayHandlesByPubkey,
        request.pubkey,
        handle,
        failedPubkeySet,
        request.lane,
      )

      if (request.lane === 'hd') {
        hdHandlesByPubkey.set(request.pubkey, displayHandle)
        visibleHdHandlePubkeys.add(request.pubkey)
      } else {
        baseHandlesByPubkey.set(request.pubkey, displayHandle)
        visibleBaseHandlePubkeys.add(request.pubkey)
      }
    }

    for (const candidate of frameCandidates.filter((request) => request.visible)) {
      const baseHandle = baseHandlesByPubkey.get(candidate.pubkey)
      const hdHandle = hdHandlesByPubkey.get(candidate.pubkey)
      const hdHasBeenPainted = hdPaintedPubkeySet.has(candidate.pubkey)
      const hdIsDistinct = Boolean(
        hdHandle && (!baseHandle || hdHandle.key !== baseHandle.key),
      )
      const shouldExportBase = baseHandle !== undefined
      const shouldExportHd = hdIsDistinct && hdHandle !== undefined

      if (shouldExportBase && baseHandle) {
        baseReadyImagesByPubkey[candidate.pubkey] = baseHandle
        readyImagesByPubkey[candidate.pubkey] = baseHandle
      }

      if (shouldExportHd && hdHandle) {
        hdReadyImagesByPubkey[candidate.pubkey] = hdHandle
        if (!shouldExportBase || hdHasBeenPainted) {
          readyImagesByPubkey[candidate.pubkey] = hdHandle
        }
      }

      if (shouldExportBase || shouldExportHd) {
        visibilitySnapshot.readyVisibleNodes += 1
        readyPubkeysForRenderer.push(candidate.pubkey)
        continue
      }

      visibilitySnapshot.missingVisibleNodes += 1
      const reason = this.resolveVisibleMissingReason({
        pubkey: candidate.pubkey,
        sourceUrl: candidate.sourceUrl,
        targetBucket: candidate.baseTargetBucket,
        provisionalBucket: candidate.baseProvisionalBucket,
        score: candidate.score,
        visible: candidate.visible,
        lane: 'base',
      })
      visibleMissingReasons.set(reason, (visibleMissingReasons.get(reason) ?? 0) + 1)
    }

    for (const pubkey of this.baseDisplayHandlesByPubkey.keys()) {
      if (!visibleBaseHandlePubkeys.has(pubkey)) {
        this.baseDisplayHandlesByPubkey.delete(pubkey)
      }
    }

    for (const pubkey of this.hdDisplayHandlesByPubkey.keys()) {
      if (!visibleHdHandlePubkeys.has(pubkey)) {
        this.hdDisplayHandlesByPubkey.delete(pubkey)
      }
    }

    visibilitySnapshot.visibleMissingReasons = Array.from(
      visibleMissingReasons.entries(),
    )
      .sort(([, leftCount], [, rightCount]) => rightCount - leftCount)
      .map(([reason, count]) => ({
        reason,
        count,
      }))

    this.visibilitySnapshot = visibilitySnapshot
    this.qualityGuideSnapshot =
      finalizeAvatarQualityGuideSnapshot(qualityGuideSnapshot)
    this.contextSnapshot.visibleRequests = visibilitySnapshot.visibleNodes
    this.contextSnapshot.prefetchRequests = visibilitySnapshot.prefetchNodes
    this.readyPubkeysForRenderer = [...new Set(readyPubkeysForRenderer)].sort()
    this.refreshPresentationSnapshot()
    this.visibilitySnapshot.paintedVisibleNodes =
      this.presentationSnapshot.paintedVisibleNodes

    if (visibilitySnapshot.visibleScreenNodes === 0) {
      this.visibilitySnapshot.readyVisibleNodes = 0
      this.visibilitySnapshot.paintedVisibleNodes = 0
      this.visibilitySnapshot.missingVisibleNodes = 0
      this.visibilitySnapshot.visibleMissingReasons = []
    }

    this.refreshFailureSnapshot(frameNow)

    return {
      readyImagesByPubkey,
      baseReadyImagesByPubkey,
      hdReadyImagesByPubkey,
      paintedPubkeys: this.getVisiblePaintedPubkeys(),
    }
  }

  public async requestDetail({
    sourceUrl,
    targetPx,
  }: RequestDetailInput): Promise<ImageSourceHandle | null> {
    if (!isSafeAvatarUrl(sourceUrl)) {
      return null
    }

    if (this.isSourceCoolingDown(sourceUrl)) {
      return null
    }

    const requestedBucket = resolveImageTargetBucket({
      cssPixels: Math.min(targetPx, DETAIL_TARGET_CAP),
    })
    const bucket = clampImageBucketForMotion({
      bucket: requestedBucket,
      velocityScore: 0,
      priorityLane: true,
    })

    const cached = this.decodedCache.get(buildVariantKey(sourceUrl, bucket))
    if (cached) {
      cached.lastUsedAt = now()
      return {
        key: cached.key,
        sourceUrl: cached.sourceUrl,
        bucket: cached.bucket,
        url: cached.url,
        byteSize: cached.byteSize,
      }
    }

    try {
      await this.ensureVariant(sourceUrl, bucket)
      this.scheduleNotify()
    } catch (error) {
      this.recordSourceFailure(sourceUrl, error)
      return null
    }

    const decoded = this.decodedCache.get(buildVariantKey(sourceUrl, bucket))
    if (!decoded) {
      return null
    }

    decoded.lastUsedAt = now()

    return {
      key: decoded.key,
      sourceUrl: decoded.sourceUrl,
      bucket: decoded.bucket,
      url: decoded.url,
      byteSize: decoded.byteSize,
    }
  }

  // Recibe la verdad del renderer: que pubkeys quedaron realmente pintadas en atlas
  // y cuales deck.gl marco como fallidas en esta pasada.
  public reportRendererDelivery({
    paintedPubkeys,
    basePaintedPubkeys,
    hdPaintedPubkeys,
    failedPubkeys,
  }: ImageRendererDeliverySnapshot) {
    const nextBasePaintedPubkeys = mergeSortedPubkeys(basePaintedPubkeys ?? [])
    const nextHdPaintedPubkeys = mergeSortedPubkeys(hdPaintedPubkeys ?? [])
    const nextPaintedPubkeys = mergeSortedPubkeys(
      paintedPubkeys,
      nextBasePaintedPubkeys,
      nextHdPaintedPubkeys,
    )
    const nextFailedPubkeys = [...new Set(failedPubkeys)].sort()
    const nextDroppedPubkeys = this.resolveDroppedPubkeys({
      nextPaintedPubkeys,
      nextExplicitFailedPubkeys: nextFailedPubkeys,
    })

    if (
      equalStringLists(
        this.basePaintedPubkeysFromRenderer,
        nextBasePaintedPubkeys,
      ) &&
      equalStringLists(
        this.hdPaintedPubkeysFromRenderer,
        nextHdPaintedPubkeys,
      ) &&
      equalStringLists(
        this.paintedPubkeysFromRenderer,
        nextPaintedPubkeys,
      ) &&
      equalStringLists(this.failedPubkeysFromRenderer, nextFailedPubkeys) &&
      equalStringLists(this.droppedPubkeysFromRenderer, nextDroppedPubkeys)
    ) {
      return
    }

    this.logVisibleAvatarDeliveryDrops({
      nextPaintedPubkeys,
      nextFailedPubkeys,
      nextDroppedPubkeys,
    })
    this.basePaintedPubkeysFromRenderer = nextBasePaintedPubkeys
    this.hdPaintedPubkeysFromRenderer = nextHdPaintedPubkeys
    this.paintedPubkeysFromRenderer = nextPaintedPubkeys
    this.failedPubkeysFromRenderer = nextFailedPubkeys
    this.droppedPubkeysFromRenderer = nextDroppedPubkeys
    this.refreshPresentationSnapshot()
    this.scheduleNotify()
  }

  public debugSnapshot(): ImageResidencySnapshot {
    this.refreshFailureSnapshot()
    const pendingWork = this.getPendingWorkSnapshot()
    const visibility = cloneVisibilitySnapshot(this.visibilitySnapshot)
    const presentation = clonePresentationSnapshot(this.presentationSnapshot)
    visibility.paintedVisibleNodes = presentation.paintedVisibleNodes
    visibility.visibleMissingReasons = mergeVisibleMissingReasons({
      visibility,
      presentation,
    })
    const failures = cloneFailuresSnapshot(this.failuresSnapshot)
    const diagnostics = resolveDiagnosticsSnapshot({
      visibility,
      presentation,
      failures,
      pendingWork,
    })

    return {
      persistentBytes: this.persistentSnapshot.totalBytes,
      compressedBytes: this.compressedSnapshot.totalBytes,
      decodedBytes: this.decodedSnapshot.totalBytes,
      vramBytes: this.residentSnapshot.totalBytes,
      pendingRequests: pendingWork.totalRequests,
      residentKeys: [...this.residentKeysSnapshot],
      persistent: cloneTierSnapshot(this.persistentSnapshot),
      compressed: cloneTierSnapshot(this.compressedSnapshot),
      decoded: cloneTierSnapshot(this.decodedSnapshot),
      resident: cloneTierSnapshot(this.residentSnapshot),
      pendingWork,
      failures,
      context: cloneContextSnapshot(this.contextSnapshot),
      visibility,
      presentation,
      qualityGuide: cloneAvatarQualityGuideSnapshot(this.qualityGuideSnapshot),
      diagnostics: cloneDiagnosticsSnapshot(diagnostics),
    }
  }

  // Recalcula la foto "runtime vs pantalla" que usa el inspector:
  // listos en runtime, pintados, pendientes y fallidos de IconLayer.
  private refreshPresentationSnapshot() {
    const readyPubkeySet = new Set(this.readyPubkeysForRenderer)
    const paintedPubkeySet = new Set(this.paintedPubkeysFromRenderer)
    let paintedVisibleNodes = 0
    let iconLayerExplicitFailedVisibleNodes = 0
    let iconLayerDroppedVisibleNodes = 0

    for (const pubkey of paintedPubkeySet) {
      if (readyPubkeySet.has(pubkey)) {
        paintedVisibleNodes += 1
      }
    }

    for (const pubkey of this.failedPubkeysFromRenderer) {
      if (readyPubkeySet.has(pubkey) && !paintedPubkeySet.has(pubkey)) {
        iconLayerExplicitFailedVisibleNodes += 1
      }
    }

    for (const pubkey of this.droppedPubkeysFromRenderer) {
      if (
        readyPubkeySet.has(pubkey) &&
        !paintedPubkeySet.has(pubkey) &&
        !this.failedPubkeysFromRenderer.includes(pubkey)
      ) {
        iconLayerDroppedVisibleNodes += 1
      }
    }

    const iconLayerFailedVisibleNodes =
      iconLayerExplicitFailedVisibleNodes + iconLayerDroppedVisibleNodes
    const iconLayerPendingVisibleNodes = Math.max(
      0,
      this.readyPubkeysForRenderer.length -
        paintedVisibleNodes -
        iconLayerFailedVisibleNodes,
    )

    this.presentationSnapshot = {
      runtimeReadyVisibleNodes: this.readyPubkeysForRenderer.length,
      paintedVisibleNodes,
      iconLayerPendingVisibleNodes,
      iconLayerExplicitFailedVisibleNodes,
      iconLayerDroppedVisibleNodes,
      iconLayerFailedVisibleNodes,
    }
  }

  private scheduleNotify() {
    if (this.notifyScheduled) {
      return
    }

    this.notifyScheduled = true
    queueMicrotask(() => {
      this.notifyScheduled = false
      for (const listener of this.listeners) {
        listener()
      }
    })
  }

  // Lee todas las imágenes faltantes de IndexedDB en una sola transacción (bulkGet),
  // las pone en compressedCache para que scheduleEnsureVariant las decodifique sin red.
  private batchPreloadFromPersistent(requests: CandidateRequest[], frameNow: number) {
    const seen = new Set<string>()
    const keysToFetch: Array<{ sourceUrl: string; bucket: ImageLodBucket }> = []

    for (const request of requests) {
      for (const bucket of [request.provisionalBucket, request.targetBucket]) {
        const key = buildVariantKey(request.sourceUrl, bucket)
        if (seen.has(key)) continue
        seen.add(key)
        if (
          this.decodedCache.has(key) ||
          this.compressedCache.has(key) ||
          this.isSourceCoolingDown(request.sourceUrl)
        ) {
          continue
        }
        keysToFetch.push({ sourceUrl: request.sourceUrl, bucket })
      }
    }

    if (keysToFetch.length === 0) return

    void this.repositories.imageVariants
      .getManyFresh(keysToFetch, frameNow)
      .then((records) => {
        let loaded = 0
        for (let i = 0; i < keysToFetch.length; i++) {
          const record = records[i]
          if (!record) continue
          const bucket = record.bucket as ImageLodBucket
          const key = buildVariantKey(record.sourceUrl, bucket)
          if (this.compressedCache.has(key)) continue
          this.compressedCache.set(key, this.toCompressedEntry(record))
          loaded++
        }
        if (loaded > 0) {
          this.scheduleNotify()
        }
      })
      .catch(console.warn)
  }

  private scheduleEnsureVariant({
    sourceUrl,
    bucket,
    visible,
    lane,
  }: {
    sourceUrl: string
    bucket: ImageLodBucket
    visible: boolean
    lane: 'base' | 'hd'
  }) {
    const key = buildVariantKey(sourceUrl, bucket)
    if (this.decodedCache.has(key) || this.isSourceCoolingDown(sourceUrl)) {
      return
    }

    // Si está en compressed cache, decodificamos inmediatamente sin pasar por la cola
    const compressed = this.compressedCache.get(key)
    if (compressed) {
      const frameNow = now()
      const url = this.createBlobUrl(sourceUrl, bucket, compressed.blob)
      this.decodedCache.set(key, {
        key,
        sourceUrl,
        bucket,
        byteSize: compressed.byteSize,
        lastUsedAt: frameNow,
        url,
      })
      this.refreshMemoryTierSnapshots()
      this.scheduleNotify()
      return
    }

    const requestNow = now()
    const nextRequest: ScheduledVariantRequest = {
      key,
      sourceUrl,
      bucket,
      priorityClass: resolveRequestPriorityClass({
        visible,
        lane,
      }),
      enqueuedAt: requestNow,
      lastRequestedAt: requestNow,
      visible,
      lane,
    }

    const queuedRequest = this.queuedRequests.get(key)
    if (queuedRequest) {
      this.queuedRequests.set(
        key,
        mergeScheduledVariantRequest(queuedRequest, nextRequest),
      )
      this.drainQueue()
      return
    }

    const inFlightRequest = this.inFlightRequests.get(key)
    if (inFlightRequest) {
      this.inFlightRequests.set(
        key,
        mergeScheduledVariantRequest(inFlightRequest, nextRequest),
      )
      this.drainQueue()
      return
    }

    this.queuedRequests.set(key, nextRequest)
    this.drainQueue()
  }

  private drainQueue() {
    this.preemptPrefetchRequestsForVisibleBacklog()

    while (this.inFlightRequests.size < FETCH_CONCURRENCY) {
      const nextRequest = this.pickNextQueuedRequest()
      if (!nextRequest) {
        break
      }

      this.startQueuedRequest(nextRequest)
      this.preemptPrefetchRequestsForVisibleBacklog()
    }
  }

  private preemptPrefetchRequestsForVisibleBacklog() {
    const queuedVisibleBaseRequests = this.countQueuedRequests(
      (request) => request.priorityClass === 'visible-base',
    )
    const queuedVisibleRequests = this.countQueuedRequests((request) => request.visible)
    if (queuedVisibleRequests === 0) {
      return
    }

    const maxPrefetchInFlight = queuedVisibleBaseRequests > 0 ? 0 : 1
    const inFlightPrefetchRequests = Array.from(this.inFlightRequests.values())
      .filter((request) => request.priorityClass.startsWith('prefetch'))
      .sort((left, right) => compareScheduledVariantRequests(right, left))
    const requestsToCancel = Math.max(
      0,
      inFlightPrefetchRequests.length - maxPrefetchInFlight,
    )

    for (let index = 0; index < requestsToCancel; index += 1) {
      const request = inFlightPrefetchRequests[index]
      if (!request || request.abortController.signal.aborted) {
        continue
      }
      request.abortController.abort('priority-preempted')
    }
  }

  private pickNextQueuedRequest(): ScheduledVariantRequest | null {
    const queuedRequests = Array.from(this.queuedRequests.values())
    if (queuedRequests.length === 0) {
      return null
    }

    const visibleBaseRequests = queuedRequests.filter(
      (request) => request.priorityClass === 'visible-base',
    )
    if (visibleBaseRequests.length > 0) {
      return visibleBaseRequests.sort(compareScheduledVariantRequests)[0] ?? null
    }

    const visibleRequests = queuedRequests.filter((request) => request.visible)
    if (visibleRequests.length > 0) {
      return visibleRequests.sort(compareScheduledVariantRequests)[0] ?? null
    }

    return queuedRequests.sort(compareScheduledVariantRequests)[0] ?? null
  }

  private startQueuedRequest(request: ScheduledVariantRequest) {
    this.queuedRequests.delete(request.key)

    const abortController = new AbortController()
    const inFlightRequest: InFlightVariantRequest = {
      ...request,
      abortController,
    }
    this.inFlightRequests.set(request.key, inFlightRequest)

    void this.runVariantRequest(inFlightRequest)
  }

  private async runVariantRequest(request: InFlightVariantRequest) {
    try {
      await this.ensureVariant(
        request.sourceUrl,
        request.bucket,
        request.abortController,
        request.visible && request.lane === 'base',
      )
    } catch (error) {
      this.recordSourceFailure(request.sourceUrl, error)
    } finally {
      this.inFlightRequests.delete(request.key)
      this.drainQueue()
      this.scheduleNotify()
    }
  }

  private countQueuedRequests(
    predicate: (request: ScheduledVariantRequest) => boolean,
  ) {
    let count = 0

    for (const request of this.queuedRequests.values()) {
      if (predicate(request)) {
        count += 1
      }
    }

    return count
  }

  private countInFlightRequests(
    predicate: (request: InFlightVariantRequest) => boolean,
  ) {
    let count = 0

    for (const request of this.inFlightRequests.values()) {
      if (predicate(request)) {
        count += 1
      }
    }

    return count
  }

  private async ensureVariant(
    sourceUrl: string,
    bucket: ImageLodBucket,
    abortController: AbortController | null = null,
    highPriority = false,
  ) {
    const key = buildVariantKey(sourceUrl, bucket)
    if (this.decodedCache.has(key)) {
      this.decodedCache.get(key)!.lastUsedAt = now()
      return
    }

    const frameNow = now()
    let compressed = this.compressedCache.get(key)
    if (!compressed) {
      const persisted = await this.repositories.imageVariants.getFresh(
        sourceUrl,
        bucket,
        frameNow,
      )
      if (persisted) {
        compressed = this.toCompressedEntry(persisted)
      } else {
        this.schedulePersistentSummaryRefresh()
        compressed = await this.fetchVariant(sourceUrl, bucket, abortController, highPriority)
      }
      this.compressedCache.set(key, compressed)
    }

    this.sourceFailures.delete(sourceUrl)
    this.refreshFailureSnapshot(frameNow)

    const url = this.createBlobUrl(sourceUrl, bucket, compressed.blob)
    this.decodedCache.set(key, {
      key,
      sourceUrl,
      bucket,
      byteSize: compressed.byteSize,
      lastUsedAt: frameNow,
      url,
    })
    this.refreshMemoryTierSnapshots()
  }

  private async fetchVariant(
    sourceUrl: string,
    bucket: ImageLodBucket,
    abortController: AbortController | null,
    highPriority = false,
  ) {
    const fetchUrl = resolveAvatarFetchUrl(sourceUrl, undefined, bucket)
    let blob: Blob
    let proxyError: unknown = null

    try {
      blob = await this.fetchBlob(fetchUrl, abortController, highPriority)
    } catch (error) {
      proxyError = error
      if (isTimeoutError(error) || isCancelledError(error)) {
        throw error
      }
      const proxyStatus = readErrorStatus(error)
      if (proxyStatus === 404 || proxyStatus === 410) {
        throw buildImageFetchError(
          readErrorMessage(error),
          proxyStatus,
          sourceUrl,
        )
      }

      try {
        blob = await this.fetchBlob(sourceUrl, abortController, highPriority)
      } catch (sourceError) {
        if (isTimeoutError(sourceError) || isCancelledError(sourceError)) {
          throw sourceError
        }
        const sourceMessage = readErrorMessage(sourceError)
        const sourceStatus = readErrorStatus(sourceError)
        const proxyMessage =
          proxyError === null ? null : readErrorMessage(proxyError)
        throw buildImageFetchError(
          proxyMessage && proxyMessage !== sourceMessage
            ? `${sourceMessage} Fallback after proxy failure: ${proxyMessage}`
            : sourceMessage,
          sourceStatus ?? readErrorStatus(proxyError),
          sourceUrl,
        )
      }
    }

    const persistedRecord: ImageVariantRecord = {
      cacheKey: buildVariantKey(sourceUrl, bucket),
      sourceUrl,
      bucket,
      fetchedAt: now(),
      lastAccessedAt: now(),
      expiresAt: now() + IMAGE_VARIANT_TTL_MS,
      byteSize: blob.size,
      mimeType: blob.type || 'application/octet-stream',
      width: bucket,
      height: bucket,
      blob,
    }

    await this.repositories.imageVariants.put(persistedRecord)
    await this.persistentBudgetPromise
    await this.repositories.imageVariants.enforceByteBudget(this.persistentBudgetBytes)
    this.schedulePersistentSummaryRefresh()

    return this.toCompressedEntry(persistedRecord)
  }

  private async fetchBlob(
    url: string,
    abortController: AbortController | null,
    highPriority = false,
  ) {
    const controller = abortController ?? new AbortController()
    let timedOut = false
    const timeoutId = setTimeout(() => {
      timedOut = true
      controller.abort('timeout')
    }, IMAGE_FETCH_TIMEOUT_MS)

    try {
      const response = await fetch(url, {
        cache: 'force-cache',
        credentials: 'omit',
        mode: 'cors',
        referrerPolicy: 'no-referrer',
        signal: controller.signal,
        // @ts-ignore - fetchpriority is a hint supported by modern browsers
        priority: highPriority ? 'high' : 'auto',
      } as RequestInit)

      if (!response.ok) {
        throw buildImageFetchError(
          `Image request failed with status ${response.status}.`,
          response.status,
          url,
        )
      }

      return await response.blob()
    } catch (error) {
      if (timedOut || controller.signal.reason === 'timeout') {
        throw buildImageFetchTimeoutError(url)
      }

      if (controller.signal.aborted) {
        throw buildImageFetchCancelledError(url)
      }

      throw error
    } finally {
      clearTimeout(timeoutId)
    }
  }

  private isSourceCoolingDown(sourceUrl: string) {
    const failure = this.sourceFailures.get(sourceUrl)
    if (!failure) {
      return false
    }

    if (failure.retryAt <= now()) {
      this.sourceFailures.delete(sourceUrl)
      this.refreshFailureSnapshot()
      this.scheduleNotify()
      return false
    }

    return true
  }

  private recordSourceFailure(sourceUrl: string, error: unknown) {
    if (isCancelledError(error)) {
      return
    }

    const previousFailure = this.sourceFailures.get(sourceUrl)
    const timedOut = isTimeoutError(error)
    const failCount = timedOut ? 1 : (previousFailure?.failCount ?? 0) + 1
    const status = readErrorStatus(error)
    const baseCooldownMs =
      timedOut
        ? FETCH_FAILURE_TIMEOUT_COOLDOWN_MS
        : status === 404
        ? FETCH_FAILURE_NOT_FOUND_COOLDOWN_MS
        : Math.min(
            FETCH_FAILURE_MAX_COOLDOWN_MS,
            FETCH_FAILURE_BASE_COOLDOWN_MS * 2 ** Math.min(failCount - 1, 4),
          )

    if (timedOut) {
      this.timedOutRequests += 1
    }

    this.sourceFailures.set(sourceUrl, {
      retryAt: now() + baseCooldownMs,
      failCount,
      lastMessage: readErrorMessage(error),
      status,
      timedOut,
    })
    this.refreshFailureSnapshot()
    this.scheduleNotify()
  }

  private toCompressedEntry(record: ImageVariantRecord): CompressedEntry {
    return {
      key: record.cacheKey,
      sourceUrl: record.sourceUrl,
      bucket: record.bucket as ImageLodBucket,
      byteSize: record.byteSize,
      lastUsedAt: record.lastAccessedAt,
      blob: record.blob,
    }
  }

  private createBlobUrl(
    sourceUrl: string,
    bucket: ImageLodBucket,
    blob: Blob,
  ) {
    if (canCreateObjectUrl()) {
      try {
        return URL.createObjectURL(blob)
      } catch {
        // Vitest/jsdom and some constrained runtimes expose createObjectURL but reject
        // blobs coming from alternate globals. Fall back to the fetch URL in that case.
      }
    }

    return resolveAvatarFetchUrl(sourceUrl, undefined, bucket)
  }

  private promoteResidents(
    requests: CandidateRequest[],
    vramBudgetBytes: number,
    frameNow: number,
  ) {
    let promotedCount = 0
    let promotedBytes = 0
    let changed = false

    for (const request of requests) {
      if (!request.visible) {
        continue
      }

      const decoded =
        request.lane === 'hd'
          ? this.decodedCache.get(
              buildVariantKey(request.sourceUrl, request.targetBucket),
            ) ??
            this.decodedCache.get(
              buildVariantKey(request.sourceUrl, request.provisionalBucket),
            )
          : this.decodedCache.get(
              buildVariantKey(request.sourceUrl, request.provisionalBucket),
            ) ??
            this.decodedCache.get(
              buildVariantKey(request.sourceUrl, request.targetBucket),
            )
      if (!decoded) {
        continue
      }

      const resident = this.residentCache.get(decoded.key)
      if (resident) {
        resident.lastUsedAt = frameNow
        resident.score = Math.max(resident.score, request.score)
        resident.visible = resident.visible || request.visible
        if (resident.lane !== 'base' && request.lane === 'base') {
          resident.lane = 'base'
        }
        continue
      }

      if (promotedCount >= MAX_UPLOADS_PER_FRAME) {
        break
      }

      if (promotedBytes + decoded.byteSize > MAX_UPLOAD_BYTES_PER_FRAME) {
        break
      }

      this.residentCache.set(decoded.key, {
        key: decoded.key,
        sourceUrl: decoded.sourceUrl,
        bucket: decoded.bucket,
        byteSize: decoded.byteSize,
        lastUsedAt: frameNow,
        score: request.score,
        lane: request.lane,
        visible: request.visible,
      })
      changed = true
      promotedCount += 1
      promotedBytes += decoded.byteSize
    }

    changed =
      this.evictResidentCache(
        vramBudgetBytes,
        new Set(requests.map((request) => request.sourceUrl)),
      ) || changed

    if (changed) {
      this.refreshMemoryTierSnapshots()
    }
  }

  private pickResidentHandle(
    sourceUrl: string,
    targetBucket: ImageLodBucket,
    frameNow: number,
  ): ImageSourceHandle | null {
    const candidates = IMAGE_LOD_BUCKETS
      .filter((bucket) => bucket <= targetBucket)
      .reverse()

    for (const bucket of candidates) {
      const key = buildVariantKey(sourceUrl, bucket)
      const resident = this.residentCache.get(key)
      const decoded = this.decodedCache.get(key)
      if (!resident || !decoded) {
        continue
      }

      resident.lastUsedAt = frameNow
      decoded.lastUsedAt = frameNow

      return {
        key,
        sourceUrl,
        bucket,
        url: decoded.url,
        byteSize: decoded.byteSize,
      }
    }

    return null
  }

  private pickDisplayHandle(
    displayHandlesByPubkey: Map<string, ImageSourceHandle>,
    pubkey: string,
    runtimeHandle: ImageSourceHandle,
    failedPubkeySet: ReadonlySet<string>,
    lane: 'base' | 'hd',
  ): ImageSourceHandle {
    const currentDisplayHandle = displayHandlesByPubkey.get(pubkey)
    const nextDisplayHandle = this.resolveDisplayHandle(
      pubkey,
      runtimeHandle,
      currentDisplayHandle,
      failedPubkeySet,
      lane,
    )

    displayHandlesByPubkey.set(pubkey, nextDisplayHandle)
    return nextDisplayHandle
  }

  private resolveDisplayHandle(
    pubkey: string,
    runtimeHandle: ImageSourceHandle,
    currentDisplayHandle: ImageSourceHandle | undefined,
    failedPubkeySet: ReadonlySet<string>,
    lane: 'base' | 'hd',
  ): ImageSourceHandle {
    if (!currentDisplayHandle) {
      return runtimeHandle
    }

    if (
      currentDisplayHandle.sourceUrl !== runtimeHandle.sourceUrl ||
      !this.hasRenderableHandle(currentDisplayHandle)
    ) {
      return runtimeHandle
    }

    if (currentDisplayHandle.key === runtimeHandle.key) {
      return runtimeHandle
    }

    if (failedPubkeySet.has(pubkey)) {
      return runtimeHandle
    }

    if (lane === 'hd' && runtimeHandle.bucket > currentDisplayHandle.bucket) {
      return runtimeHandle
    }

    // Una vez que entregamos un handle al renderer, lo dejamos estable mientras siga
    // siendo renderizable. Si lo cambiamos antes del primer paint, el atlas nunca llega
    // a converger bajo churn de LOD y el avatar queda "pendiente" para siempre.
    return currentDisplayHandle
  }

  private hasRenderableHandle(handle: ImageSourceHandle) {
    return (
      this.residentCache.has(handle.key) &&
      this.decodedCache.has(handle.key)
    )
  }

  private getVisiblePaintedPubkeys() {
    const readyPubkeySet = new Set(this.readyPubkeysForRenderer)

    return this.paintedPubkeysFromRenderer.filter((pubkey) =>
      readyPubkeySet.has(pubkey),
    )
  }

  private resolveDroppedPubkeys({
    nextPaintedPubkeys,
    nextExplicitFailedPubkeys,
  }: {
    nextPaintedPubkeys: readonly string[]
    nextExplicitFailedPubkeys: readonly string[]
  }) {
    const readyPubkeySet = new Set(this.readyPubkeysForRenderer)
    const nextPaintedPubkeySet = new Set(nextPaintedPubkeys)
    const nextExplicitFailedPubkeySet = new Set(nextExplicitFailedPubkeys)
    const droppedPubkeys = new Set<string>()

    for (const pubkey of this.droppedPubkeysFromRenderer) {
      if (
        readyPubkeySet.has(pubkey) &&
        !nextPaintedPubkeySet.has(pubkey) &&
        !nextExplicitFailedPubkeySet.has(pubkey)
      ) {
        droppedPubkeys.add(pubkey)
      }
    }

    for (const pubkey of this.paintedPubkeysFromRenderer) {
      if (
        readyPubkeySet.has(pubkey) &&
        !nextPaintedPubkeySet.has(pubkey) &&
        !nextExplicitFailedPubkeySet.has(pubkey)
      ) {
        droppedPubkeys.add(pubkey)
      }
    }

    return [...droppedPubkeys].sort()
  }

  private logVisibleAvatarDeliveryDrops({
    nextPaintedPubkeys,
    nextFailedPubkeys,
    nextDroppedPubkeys,
  }: {
    nextPaintedPubkeys: readonly string[]
    nextFailedPubkeys: readonly string[]
    nextDroppedPubkeys: readonly string[]
  }) {
    if (process.env.NODE_ENV === 'production' || typeof console === 'undefined') {
      return
    }

    const readyPubkeySet = new Set(this.readyPubkeysForRenderer)
    const nextPaintedPubkeySet = new Set(nextPaintedPubkeys)
    const nextFailedPubkeySet = new Set(nextFailedPubkeys)
    const nextDroppedPubkeySet = new Set(nextDroppedPubkeys)

    for (const pubkey of [
      ...this.paintedPubkeysFromRenderer,
      ...this.droppedPubkeysFromRenderer,
    ]) {
      if (
        !readyPubkeySet.has(pubkey) ||
        nextPaintedPubkeySet.has(pubkey) ||
        (!nextFailedPubkeySet.has(pubkey) && !nextDroppedPubkeySet.has(pubkey))
      ) {
        continue
      }

      const classification = nextFailedPubkeySet.has(pubkey)
        ? 'failed'
        : 'dropped'
      const displayHandle =
        this.hdDisplayHandlesByPubkey.get(pubkey) ??
        this.baseDisplayHandlesByPubkey.get(pubkey) ??
        null

      console.debug('[ImageRuntime] visible avatar dropped from painted', {
        pubkey,
        classification,
        readyVisible: true,
        displayHandle,
        nextPaintedPubkeys,
        nextFailedPubkeys,
      })
    }
  }

  private evictResidentCache(
    vramBudgetBytes: number,
    hotSources: Set<string>,
  ): boolean {
    const currentBytes = () =>
      Array.from(this.residentCache.values()).reduce(
        (sum, entry) => sum + entry.byteSize,
        0,
      )

    if (currentBytes() <= vramBudgetBytes) {
      return false
    }

    const victims = Array.from(this.residentCache.values()).sort((left, right) =>
      compareResidentEvictionPriority(left, right, hotSources),
    )
    let changed = false

    for (const victim of victims) {
      if (currentBytes() <= vramBudgetBytes) {
        break
      }
      this.residentCache.delete(victim.key)
      changed = true
    }

    return changed
  }

  private evictDecodedCache(decodedBudgetBytes: number) {
    let totalBytes = Array.from(this.decodedCache.values()).reduce(
      (sum, entry) => sum + entry.byteSize,
      0,
    )
    if (totalBytes <= decodedBudgetBytes) {
      return
    }

    const victims = Array.from(this.decodedCache.values()).sort(
      (left, right) => left.lastUsedAt - right.lastUsedAt,
    )
    let changed = false

    for (const victim of victims) {
      if (totalBytes <= decodedBudgetBytes) {
        break
      }
      if (this.residentCache.has(victim.key)) {
        continue
      }

      if (canRevokeObjectUrl()) {
        URL.revokeObjectURL(victim.url)
      }
      this.decodedCache.delete(victim.key)
      totalBytes -= victim.byteSize
      changed = true
    }

    if (changed) {
      this.refreshMemoryTierSnapshots()
    }
  }

  private evictCompressedCache(compressedBudgetBytes: number) {
    let totalBytes = Array.from(this.compressedCache.values()).reduce(
      (sum, entry) => sum + entry.byteSize,
      0,
    )
    if (totalBytes <= compressedBudgetBytes) {
      return
    }

    const victims = Array.from(this.compressedCache.values()).sort(
      (left, right) => left.lastUsedAt - right.lastUsedAt,
    )
    let changed = false

    for (const victim of victims) {
      if (totalBytes <= compressedBudgetBytes) {
        break
      }

      if (this.decodedCache.has(victim.key) || this.residentCache.has(victim.key)) {
        continue
      }

      this.compressedCache.delete(victim.key)
      totalBytes -= victim.byteSize
      changed = true
    }

    if (changed) {
      this.refreshMemoryTierSnapshots()
    }
  }

  private refreshMemoryTierSnapshots() {
    this.compressedSnapshot = summarizeTierEntries(this.compressedCache.values())
    this.decodedSnapshot = summarizeTierEntries(this.decodedCache.values())
    this.residentSnapshot = summarizeTierEntries(this.residentCache.values())
    this.residentKeysSnapshot = Array.from(this.residentCache.keys()).sort()
  }

  private refreshFailureSnapshot(currentTime = now()) {
    const byStatus = new Map<number | 'unknown', number>()
    let blockedSourceUrls = 0

    for (const [sourceUrl, failure] of this.sourceFailures.entries()) {
      if (failure.retryAt <= currentTime) {
        this.sourceFailures.delete(sourceUrl)
        continue
      }

      blockedSourceUrls += 1
      const statusKey = failure.status ?? 'unknown'
      byStatus.set(statusKey, (byStatus.get(statusKey) ?? 0) + 1)
    }

    this.failuresSnapshot = {
      blockedSourceUrls,
      byStatus: Array.from(byStatus.entries())
        .sort(([leftStatus], [rightStatus]) => {
          if (leftStatus === 'unknown') {
            return 1
          }
          if (rightStatus === 'unknown') {
            return -1
          }
          return leftStatus - rightStatus
        })
        .map(([status, count]) => ({
          status,
          count,
        })),
    }
  }

  private getPendingWorkSnapshot(): ImagePendingWorkSnapshot {
    const queuedRequests = this.queuedRequests.size
    const inFlightRequests = this.inFlightRequests.size
    const queuedVisibleBaseRequests = this.countQueuedRequests(
      (request) => request.priorityClass === 'visible-base',
    )
    const queuedVisibleHdRequests = this.countQueuedRequests(
      (request) => request.priorityClass === 'visible-hd',
    )
    const queuedPrefetchRequests = this.countQueuedRequests((request) =>
      request.priorityClass.startsWith('prefetch'),
    )
    const inFlightVisibleBaseRequests = this.countInFlightRequests(
      (request) => request.priorityClass === 'visible-base',
    )
    const inFlightVisibleHdRequests = this.countInFlightRequests(
      (request) => request.priorityClass === 'visible-hd',
    )
    const inFlightPrefetchRequests = this.countInFlightRequests((request) =>
      request.priorityClass.startsWith('prefetch'),
    )

    return {
      queuedRequests,
      inFlightRequests,
      totalRequests: queuedRequests + inFlightRequests,
      queuedVisibleBaseRequests,
      queuedVisibleHdRequests,
      queuedPrefetchRequests,
      inFlightVisibleBaseRequests,
      inFlightVisibleHdRequests,
      inFlightPrefetchRequests,
      timedOutRequests: this.timedOutRequests,
    }
  }

  private schedulePersistentSummaryRefresh() {
    if (this.persistentSummarySyncActive) {
      this.persistentSummarySyncPending = true
      return
    }

    this.persistentSummarySyncActive = true

    void this.repositories.imageVariants
      .summarizeFresh(now())
      .then((summary) => {
        this.persistentSnapshot = summarizeStoredTier(summary)
      })
      .catch(() => {
        // Ignore debug-only persistence summary failures.
      })
      .finally(() => {
        this.persistentSummarySyncActive = false
        this.scheduleNotify()

        if (this.persistentSummarySyncPending) {
          this.persistentSummarySyncPending = false
          this.schedulePersistentSummaryRefresh()
        }
      })
  }

  private resolveVisibleMissingReason(
    request: CandidateRequest,
  ): ImageVisibleMissingReason {
    if (this.isSourceCoolingDown(request.sourceUrl)) {
      return 'cooldown'
    }

    const candidateBuckets = Array.from(
      new Set([request.provisionalBucket, request.targetBucket]),
    )
    const candidateKeys = candidateBuckets.map((bucket) =>
      buildVariantKey(request.sourceUrl, bucket),
    )

    if (candidateKeys.some((key) => this.inFlightRequests.has(key))) {
      return 'in-flight'
    }

    if (candidateKeys.some((key) => this.queuedRequests.has(key))) {
      return 'queued'
    }

    const residentCandidates = IMAGE_LOD_BUCKETS.filter(
      (bucket) => bucket <= request.targetBucket,
    ).map((bucket) => buildVariantKey(request.sourceUrl, bucket))

    if (
      residentCandidates.some((key) => this.decodedCache.has(key)) ||
      candidateKeys.some((key) => this.decodedCache.has(key))
    ) {
      return 'decoded-waiting-vram'
    }

    if (
      residentCandidates.some((key) => this.compressedCache.has(key)) ||
      candidateKeys.some((key) => this.compressedCache.has(key))
    ) {
      return 'compressed-waiting-decode'
    }

    return 'scheduled-no-variant'
  }
}
