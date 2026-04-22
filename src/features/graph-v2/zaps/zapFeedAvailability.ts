import type { GraphV2Layer } from '@/features/graph-v2/domain/invariants'

const ZAP_FEED_DISABLED_LAYERS = new Set<GraphV2Layer>()

export const canRunZapFeedForScene = ({
  showZaps,
  isFixtureMode,
  activeLayer,
}: {
  showZaps: boolean
  isFixtureMode: boolean
  activeLayer: GraphV2Layer
}) => {
  return showZaps && !isFixtureMode && !ZAP_FEED_DISABLED_LAYERS.has(activeLayer)
}
