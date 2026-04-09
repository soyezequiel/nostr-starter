import type { ImageLodBucket } from '@/features/graph/render/avatar'

export type AvatarImageQualityMode =
  | 'performance'
  | 'adaptive'
  | 'quality'
  | 'full-hd'

export type AvatarQualityGuideTier = 'base' | 'hd' | 'full-hd'
export type AvatarPromotedQualityTier = AvatarQualityGuideTier
export type AvatarQualityGuideBlockReason =
  | 'mode'
  | 'zoom'
  | 'size'
  | 'motion'
  | 'admission-budget'

export interface AvatarQualityGuideSnapshot {
  mode: AvatarImageQualityMode | null
  zoom: number | null
  tier: AvatarQualityGuideTier
  headline: string
  detail: string | null
  visibleAvatarNodes: number
  baseVisibleNodes: number
  hdVisibleNodes: number
  fullHdVisibleNodes: number
  blockedByMode: number
  blockedByZoom: number
  blockedBySize: number
  blockedByMotion: number
  blockedByAdmissionBudget: number
  blockedByCap: number
  maxHdVisibleNodes: number | null
}

export interface AvatarZoomThresholdConfig {
  avatarHdZoomThreshold?: number
  avatarFullHdZoomThreshold?: number
}

export const BASE_ATLAS_MIN_BUCKET = 64
export const BASE_ATLAS_MAX_BUCKET = 128
export const QUALITY_HD_MIN_BUCKET = 256
export const FULL_HD_MIN_BUCKET = 512
export const DEFAULT_AVATAR_HD_ZOOM_THRESHOLD = 1.5
export const DEFAULT_AVATAR_FULL_HD_ZOOM_THRESHOLD = 2
export const MIN_AVATAR_ZOOM_THRESHOLD = 0.5
export const MAX_AVATAR_ZOOM_THRESHOLD = 4

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

export const normalizeAvatarZoomThresholds = (
  config: AvatarZoomThresholdConfig = {},
) => {
  const rawHdZoomThreshold =
    typeof config.avatarHdZoomThreshold === 'number' &&
    Number.isFinite(config.avatarHdZoomThreshold)
      ? config.avatarHdZoomThreshold
      : DEFAULT_AVATAR_HD_ZOOM_THRESHOLD
  const hdZoomThreshold = clamp(
    rawHdZoomThreshold,
    MIN_AVATAR_ZOOM_THRESHOLD,
    MAX_AVATAR_ZOOM_THRESHOLD,
  )
  const rawFullHdZoomThreshold =
    typeof config.avatarFullHdZoomThreshold === 'number' &&
    Number.isFinite(config.avatarFullHdZoomThreshold)
      ? config.avatarFullHdZoomThreshold
      : DEFAULT_AVATAR_FULL_HD_ZOOM_THRESHOLD
  const fullHdZoomThreshold = clamp(
    Math.max(rawFullHdZoomThreshold, hdZoomThreshold),
    hdZoomThreshold,
    MAX_AVATAR_ZOOM_THRESHOLD,
  )

  return {
    avatarHdZoomThreshold: hdZoomThreshold,
    avatarFullHdZoomThreshold: fullHdZoomThreshold,
  }
}

export const modeSupportsHd = (mode: AvatarImageQualityMode) =>
  mode === 'quality' || mode === 'full-hd'

export const resolveHdMinimumBucket = (mode: AvatarImageQualityMode) =>
  mode === 'full-hd' ? FULL_HD_MIN_BUCKET : QUALITY_HD_MIN_BUCKET

export const resolveHdMinimumZoom = (
  mode: AvatarImageQualityMode,
  zoomThresholds?: AvatarZoomThresholdConfig,
) => {
  const normalizedZoomThresholds = normalizeAvatarZoomThresholds(zoomThresholds)

  return mode === 'full-hd'
    ? normalizedZoomThresholds.avatarFullHdZoomThreshold
    : normalizedZoomThresholds.avatarHdZoomThreshold
}

export const resolveAvatarPromotedQualityTier = ({
  mode,
  zoomLevel,
  requestedBucket,
  zoomThresholds,
}: {
  mode: AvatarImageQualityMode
  zoomLevel: number
  requestedBucket: ImageLodBucket
  zoomThresholds?: AvatarZoomThresholdConfig
}): AvatarPromotedQualityTier => {
  if (!modeSupportsHd(mode)) {
    return 'base'
  }

  const normalizedZoomThresholds = normalizeAvatarZoomThresholds(zoomThresholds)

  if (
    mode === 'full-hd' &&
    requestedBucket >= FULL_HD_MIN_BUCKET &&
    zoomLevel >= normalizedZoomThresholds.avatarFullHdZoomThreshold
  ) {
    return 'full-hd'
  }

  if (
    requestedBucket >= QUALITY_HD_MIN_BUCKET &&
    zoomLevel >= normalizedZoomThresholds.avatarHdZoomThreshold
  ) {
    return 'hd'
  }

  return 'base'
}

export const isZoomCloseEnoughForHd = ({
  requestedBucket,
  zoomLevel,
  mode,
  zoomThresholds,
}: {
  requestedBucket: ImageLodBucket
  zoomLevel: number
  mode: AvatarImageQualityMode
  zoomThresholds?: AvatarZoomThresholdConfig
}) =>
  resolveAvatarPromotedQualityTier({
    mode,
    zoomLevel,
    requestedBucket,
    zoomThresholds,
  }) !== 'base'

export const resolveAvatarQualityGuideBlockReason = ({
  mode,
  zoomLevel,
  unclampedBucket,
  requestedBucket,
  zoomThresholds,
}: {
  mode: AvatarImageQualityMode
  zoomLevel: number
  unclampedBucket: ImageLodBucket
  requestedBucket: ImageLodBucket
  zoomThresholds?: AvatarZoomThresholdConfig
}): AvatarQualityGuideBlockReason | null => {
  if (!modeSupportsHd(mode)) {
    return 'mode'
  }

  const normalizedZoomThresholds = normalizeAvatarZoomThresholds(zoomThresholds)

  if (zoomLevel < normalizedZoomThresholds.avatarHdZoomThreshold) {
    return 'zoom'
  }

  const minimumBucket = QUALITY_HD_MIN_BUCKET
  if (unclampedBucket >= minimumBucket && requestedBucket < minimumBucket) {
    return 'motion'
  }

  if (requestedBucket < minimumBucket) {
    return 'size'
  }

  return null
}

export const createEmptyAvatarQualityGuideSnapshot =
  (): AvatarQualityGuideSnapshot => ({
    mode: null,
    zoom: null,
    tier: 'base',
    headline: 'Sin avatares visibles en este frame.',
    detail: null,
    visibleAvatarNodes: 0,
    baseVisibleNodes: 0,
    hdVisibleNodes: 0,
    fullHdVisibleNodes: 0,
    blockedByMode: 0,
    blockedByZoom: 0,
    blockedBySize: 0,
    blockedByMotion: 0,
    blockedByAdmissionBudget: 0,
    blockedByCap: 0,
    maxHdVisibleNodes: null,
  })

export const cloneAvatarQualityGuideSnapshot = (
  snapshot: AvatarQualityGuideSnapshot,
): AvatarQualityGuideSnapshot => ({
  ...snapshot,
})

const pluralize = (count: number, singular: string, plural: string) =>
  `${count} ${count === 1 ? singular : plural}`

const formatBlockedSegment = (
  count: number,
  label: string,
  pluralLabel = label,
) =>
  count > 0 ? `${pluralize(count, label, pluralLabel)}` : null

export const finalizeAvatarQualityGuideSnapshot = (
  snapshot: AvatarQualityGuideSnapshot,
): AvatarQualityGuideSnapshot => {
  if (snapshot.visibleAvatarNodes === 0) {
    return {
      ...snapshot,
      tier: 'base',
      headline: 'Sin avatares visibles en este frame.',
      detail: null,
      baseVisibleNodes: 0,
      hdVisibleNodes: 0,
      fullHdVisibleNodes: 0,
    }
  }

  const tier =
    snapshot.fullHdVisibleNodes > 0
      ? 'full-hd'
      : snapshot.hdVisibleNodes > 0
        ? 'hd'
        : 'base'
  const headline =
    `${pluralize(snapshot.visibleAvatarNodes, 'avatar visible', 'avatares visibles')} | ` +
    `${pluralize(snapshot.hdVisibleNodes, 'en HD', 'en HD')} | ` +
    `${pluralize(snapshot.fullHdVisibleNodes, 'en Full HD', 'en Full HD')} | ` +
    `${pluralize(snapshot.baseVisibleNodes, 'en base', 'en base')}`

  if (snapshot.mode === 'performance') {
    return {
      ...snapshot,
      tier,
      headline,
      detail:
        'Modo rendimiento: el lane HD queda deshabilitado y todos los visibles se sostienen en base.',
    }
  }

  if (snapshot.mode === 'adaptive') {
    return {
      ...snapshot,
      tier,
      headline,
      detail:
        'Modo adaptivo: no hay promocion fija a HD solo por zoom; el runtime prioriza budgets y movimiento.',
    }
  }

  const detailParts = [
    formatBlockedSegment(snapshot.blockedByZoom, 'bloqueado por zoom'),
    formatBlockedSegment(snapshot.blockedBySize, 'bloqueado por tamano'),
    formatBlockedSegment(snapshot.blockedByMotion, 'bloqueado por movimiento'),
    formatBlockedSegment(
      snapshot.blockedByAdmissionBudget,
      'diferido por budget',
    ),
    formatBlockedSegment(snapshot.blockedByCap, 'bloqueado por cap'),
  ].filter((entry): entry is string => entry !== null)

  return {
    ...snapshot,
    tier,
    headline,
    detail:
      detailParts.length > 0
        ? detailParts.join(' | ')
        : `Todos los visibles ya cumplen las condiciones de ${snapshot.mode}.`,
  }
}
