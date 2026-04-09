import type { GraphNode } from '@/features/graph/app/store/types'

import { GRAPH_LABEL_ZOOM_THRESHOLD } from '@/features/graph/render/constants'
import type { GraphLabelPolicy, GraphRenderLabel } from '@/features/graph/render/types'

export const truncatePubkey = (pubkey: string, head = 8, tail = 6) => {
  if (pubkey.length <= head + tail + 3) {
    return pubkey
  }

  return `${pubkey.slice(0, head)}...${pubkey.slice(-tail)}`
}

export const getNodeDisplayLabel = (node: GraphNode) =>
  node.label?.trim() || truncatePubkey(node.pubkey)

export const shouldShowGraphLabel = ({
  label,
  hoveredNodePubkey,
  zoomLevel,
  labelPolicy,
}: {
  label: GraphRenderLabel
  hoveredNodePubkey: string | null
  zoomLevel: number
  labelPolicy: GraphLabelPolicy
}) =>
  hoveredNodePubkey === label.pubkey ||
  label.isSelected ||
  (labelPolicy === 'hover-selected-or-zoom' &&
    zoomLevel >= GRAPH_LABEL_ZOOM_THRESHOLD)

export const selectVisibleGraphLabels = ({
  labels,
  hoveredNodePubkey,
  zoomLevel,
  labelPolicy,
}: {
  labels: readonly GraphRenderLabel[]
  hoveredNodePubkey: string | null
  zoomLevel: number
  labelPolicy: GraphLabelPolicy
}) =>
  labels.filter((label) =>
    shouldShowGraphLabel({
      label,
      hoveredNodePubkey,
      zoomLevel,
      labelPolicy,
    }),
  )
