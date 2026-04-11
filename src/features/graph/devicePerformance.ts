import type {
  DevicePerformanceProfile,
  EffectiveGraphCaps,
  EffectiveImageBudget,
  ImageQualityMode,
} from '@/features/graph/app/store/types'

export interface DevicePerformanceDetectionInput {
  isPointerCoarse: boolean
  viewportWidth: number
  deviceMemory?: number | null
  hardwareConcurrency?: number | null
}

export interface DevicePerformanceDetectionResult {
  profile: DevicePerformanceProfile
  isPointerCoarse: boolean
}

const MOBILE_VIEWPORT_MAX_WIDTH = 900

const DESKTOP_GRAPH_CAPS: EffectiveGraphCaps = {
  maxNodes: 2200,
  coldStartLayoutTicks: 90,
  warmStartLayoutTicks: 50,
}

const MOBILE_GRAPH_CAPS: EffectiveGraphCaps = {
  maxNodes: 600,
  coldStartLayoutTicks: 45,
  warmStartLayoutTicks: 22,
}

const LOW_END_MOBILE_GRAPH_CAPS: EffectiveGraphCaps = {
  maxNodes: 250,
  coldStartLayoutTicks: 32,
  warmStartLayoutTicks: 14,
}

const DESKTOP_IMAGE_BUDGET: EffectiveImageBudget = {
  vramBytes: 128 * 1024 * 1024,
  decodedBytes: 192 * 1024 * 1024,
  compressedBytes: 64 * 1024 * 1024,
  baseFetchConcurrency: 12,
  boostedFetchConcurrency: 16,
  allowHdTiers: true,
  allowParallelDirectFallback: true,
}

const MOBILE_IMAGE_BUDGET: EffectiveImageBudget = {
  vramBytes: 32 * 1024 * 1024,
  decodedBytes: 56 * 1024 * 1024,
  compressedBytes: 18 * 1024 * 1024,
  baseFetchConcurrency: 4,
  boostedFetchConcurrency: 5,
  allowHdTiers: false,
  allowParallelDirectFallback: false,
}

const LOW_END_MOBILE_IMAGE_BUDGET: EffectiveImageBudget = {
  vramBytes: 16 * 1024 * 1024,
  decodedBytes: 32 * 1024 * 1024,
  compressedBytes: 10 * 1024 * 1024,
  baseFetchConcurrency: 2,
  boostedFetchConcurrency: 3,
  allowHdTiers: false,
  allowParallelDirectFallback: false,
}

const DEVICE_PROFILE_DEFAULT_IMAGE_QUALITY_MODE: Record<
  DevicePerformanceProfile,
  ImageQualityMode
> = {
  desktop: 'adaptive',
  mobile: 'performance',
  'low-end-mobile': 'performance',
}

const normalizeOptionalPositiveNumber = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : null

export const DEFAULT_DEVICE_PERFORMANCE_PROFILE: DevicePerformanceProfile =
  'desktop'
export const DEFAULT_EFFECTIVE_GRAPH_CAPS = DESKTOP_GRAPH_CAPS
export const DEFAULT_EFFECTIVE_IMAGE_BUDGET = DESKTOP_IMAGE_BUDGET

export const detectDevicePerformance = ({
  isPointerCoarse,
  viewportWidth,
  deviceMemory,
  hardwareConcurrency,
}: DevicePerformanceDetectionInput): DevicePerformanceDetectionResult => {
  const normalizedDeviceMemory = normalizeOptionalPositiveNumber(deviceMemory)
  const normalizedHardwareConcurrency =
    normalizeOptionalPositiveNumber(hardwareConcurrency)
  const mobileByViewport = viewportWidth > 0 && viewportWidth <= MOBILE_VIEWPORT_MAX_WIDTH
  const lowEndByMemory =
    normalizedDeviceMemory !== null && normalizedDeviceMemory <= 4
  const lowEndByCpu =
    normalizedHardwareConcurrency !== null && normalizedHardwareConcurrency <= 4

  if (isPointerCoarse && (lowEndByMemory || lowEndByCpu)) {
    return {
      profile: 'low-end-mobile',
      isPointerCoarse,
    }
  }

  if (isPointerCoarse || mobileByViewport) {
    return {
      profile: 'mobile',
      isPointerCoarse,
    }
  }

  return {
    profile: 'desktop',
    isPointerCoarse,
  }
}

export const getEffectiveGraphCapsForProfile = (
  profile: DevicePerformanceProfile,
): EffectiveGraphCaps =>
  profile === 'mobile'
    ? MOBILE_GRAPH_CAPS
    : profile === 'low-end-mobile'
      ? LOW_END_MOBILE_GRAPH_CAPS
      : DESKTOP_GRAPH_CAPS

export const getEffectiveImageBudgetForProfile = (
  profile: DevicePerformanceProfile,
): EffectiveImageBudget =>
  profile === 'mobile'
    ? MOBILE_IMAGE_BUDGET
    : profile === 'low-end-mobile'
      ? LOW_END_MOBILE_IMAGE_BUDGET
      : DESKTOP_IMAGE_BUDGET

export const getDefaultImageQualityModeForProfile = (
  profile: DevicePerformanceProfile,
): ImageQualityMode => DEVICE_PROFILE_DEFAULT_IMAGE_QUALITY_MODE[profile]

export const clampImageQualityModeForProfile = (
  profile: DevicePerformanceProfile,
  mode: ImageQualityMode,
  fallbackMode?: ImageQualityMode,
): ImageQualityMode =>
  profile === 'desktop' ? mode : fallbackMode ?? 'performance'

export const isMobileDevicePerformanceProfile = (
  profile: DevicePerformanceProfile,
) => profile === 'mobile' || profile === 'low-end-mobile'
