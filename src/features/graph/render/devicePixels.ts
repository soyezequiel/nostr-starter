import type { GraphRenderLodSummary } from '@/features/graph/render/types'

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

const readDevicePixelRatio = () => {
  if (
    typeof globalThis !== 'undefined' &&
    typeof globalThis.devicePixelRatio === 'number' &&
    Number.isFinite(globalThis.devicePixelRatio)
  ) {
    return globalThis.devicePixelRatio
  }

  return 1
}

export interface ResolveGraphUseDevicePixelsInput {
  lod: Pick<
    GraphRenderLodSummary,
    | 'visibleNodeCount'
    | 'visibleEdgeCount'
    | 'labelsSuppressedByBudget'
    | 'edgesThinned'
  >
  devicePixelRatio?: number
}

export const resolveGraphUseDevicePixels = ({
  lod,
  devicePixelRatio = readDevicePixelRatio(),
}: ResolveGraphUseDevicePixelsInput) => {
  const cappedDevicePixelRatio = clamp(devicePixelRatio, 1, 2)

  if (
    lod.edgesThinned ||
    lod.visibleNodeCount >= 900 ||
    lod.visibleEdgeCount >= 1600
  ) {
    return 1
  }

  if (
    lod.labelsSuppressedByBudget ||
    lod.visibleNodeCount >= 250 ||
    lod.visibleEdgeCount >= 900
  ) {
    return Math.min(cappedDevicePixelRatio, 1.25)
  }

  return cappedDevicePixelRatio
}
