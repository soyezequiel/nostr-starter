import type { UiLayer, RenderConfig } from '@/features/graph/app/store/types'
import type { GraphRenderModel } from '@/features/graph/render/types'

export const createEmptyGraphRenderModel = (
  activeLayer: UiLayer,
  renderConfig: RenderConfig,
): GraphRenderModel => ({
  nodes: [],
  edges: [],
  labels: [],
  accessibleNodes: [],
  bounds: {
    minX: 0,
    maxX: 0,
    minY: 0,
    maxY: 0,
  },
  topologySignature: 'empty',
  layoutKey: 'empty',
  lod: {
    labelPolicy: 'hover-selected-or-zoom',
    labelsSuppressedByBudget: false,
    edgesThinned: false,
    thinnedEdgeCount: 0,
    candidateEdgeCount: 0,
    visibleEdgeCount: 0,
    visibleNodeCount: 0,
    degradedReasons: [],
  },
  analysisOverlay: {
    status: 'idle',
    isStale: false,
    mode: null,
    confidence: null,
    badgeLabel: null,
    summary: null,
    detail: null,
    legendItems: [],
  },
  activeLayer,
  renderConfig,
})
