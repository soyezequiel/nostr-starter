import type { CanonicalEdge, CanonicalGraphState } from '@/features/graph-v2/domain/types'
import { buildLayerProjection } from '@/features/graph-v2/projections/buildLayerProjection'
import type {
  GraphSceneEdge,
  GraphSceneFocusState,
  GraphSceneNode,
  GraphSceneSnapshot,
} from '@/features/graph-v2/renderer/contracts'

const truncatePubkey = (pubkey: string) =>
  pubkey.length <= 16 ? pubkey : `${pubkey.slice(0, 8)}...${pubkey.slice(-6)}`

const nodeColorBySource: Record<CanonicalGraphState['nodesByPubkey'][string]['source'], string> =
  {
    root: '#7dd3a7',
    follow: '#9ec5ff',
    inbound: '#f6c15c',
    zap: '#f2994a',
    keyword: '#f472b6',
  }

const edgeColorByRelation: Record<CanonicalEdge['relation'], string> = {
  follow: '#8fb6ff',
  inbound: '#f6c15c',
  zap: '#f2994a',
}

const DIM_NODE_COLOR = '#121a22'
const DIM_EDGE_COLOR = '#10171f'
const SELECTED_COLOR = '#ffb25b'
const NEIGHBOR_COLOR = '#f8f2a2'
const PINNED_COLOR = '#ffb25b'
const ROOT_COLOR = '#7dd3a7'
const NEIGHBOR_EDGE_BRIGHT = '#f4fbff'

const SIZE_ROOT = 18
const SIZE_PINNED = 12
const SIZE_DEFAULT = 9
const SIZE_SELECTED_BOOST = 8
const SIZE_NEIGHBOR_BOOST = 4
const SIZE_DIMMED = 5

const baseEdgeSize = (relation: CanonicalEdge['relation']) =>
  relation === 'follow' ? 1.1 : 0.9

const sortAndDedupeSceneEdges = (edges: readonly CanonicalEdge[]) => {
  const edgesById = new Map<string, CanonicalEdge>()

  for (const edge of edges) {
    edgesById.set(edge.id, edge)
  }

  return Array.from(edgesById.values()).sort((left, right) =>
    left.id.localeCompare(right.id),
  )
}

const resolveFocusState = ({
  isRoot,
  isSelected,
  isPinned,
  isNeighbor,
  hasSelection,
}: {
  isRoot: boolean
  isSelected: boolean
  isPinned: boolean
  isNeighbor: boolean
  hasSelection: boolean
}): GraphSceneFocusState => {
  if (!hasSelection) {
    if (isRoot) {
      return 'root'
    }
    if (isPinned) {
      return 'pinned'
    }
    return 'idle'
  }

  if (isSelected) {
    return 'selected'
  }
  if (isRoot) {
    return 'root'
  }
  if (isNeighbor) {
    return 'neighbor'
  }
  if (isPinned) {
    return 'pinned'
  }
  return 'dim'
}

const resolveNodeColor = (
  focusState: GraphSceneFocusState,
  baseColor: string,
): string => {
  switch (focusState) {
    case 'selected':
      return SELECTED_COLOR
    case 'pinned':
      return PINNED_COLOR
    case 'root':
      return ROOT_COLOR
    case 'dim':
      return DIM_NODE_COLOR
    case 'neighbor':
      return NEIGHBOR_COLOR
    case 'idle':
    default:
      return baseColor
  }
}

const resolveNodeSize = (
  focusState: GraphSceneFocusState,
  baseSize: number,
): number => {
  switch (focusState) {
    case 'selected':
      return baseSize + SIZE_SELECTED_BOOST
    case 'neighbor':
      return baseSize + SIZE_NEIGHBOR_BOOST
    case 'dim':
      return SIZE_DIMMED
    case 'root':
    case 'pinned':
    case 'idle':
    default:
      return baseSize
  }
}

const mapSceneEdge = (
  edge: CanonicalEdge,
  hidden: boolean,
  focusState: {
    hasSelection: boolean
    touchesFocus: boolean
  },
): GraphSceneEdge => {
  const baseColor = edgeColorByRelation[edge.relation]
  const base = baseEdgeSize(edge.relation)
  const isDimmed = focusState.hasSelection && !focusState.touchesFocus
  const color = !focusState.hasSelection
    ? baseColor
    : focusState.touchesFocus
      ? NEIGHBOR_EDGE_BRIGHT
      : DIM_EDGE_COLOR
  const size = focusState.touchesFocus ? base + 1.6 : isDimmed ? 0.25 : base

  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    color,
    size,
    hidden,
    relation: edge.relation,
    weight: edge.weight,
    isDimmed,
    touchesFocus: focusState.touchesFocus,
  }
}

export const buildGraphSceneSnapshot = (
  state: CanonicalGraphState,
): GraphSceneSnapshot => {
  const layerProjection = buildLayerProjection(state)
  const visibleEdgeIds = new Set(layerProjection.visibleEdges.map((edge) => edge.id))
  const visibleNodePubkeys = new Set(layerProjection.visibleNodePubkeys)
  const visualFocusPubkey =
    state.selectedNodePubkey && state.nodesByPubkey[state.selectedNodePubkey]
      ? state.selectedNodePubkey
      : null
  const hasVisualFocus = visualFocusPubkey !== null
  const forceEdges =
    state.activeLayer === 'graph'
      ? Object.values(state.edgesById)
          .filter(
            (edge) =>
              edge.origin !== 'connections' &&
              visibleNodePubkeys.has(edge.source) &&
              visibleNodePubkeys.has(edge.target),
          )
          .sort((left, right) => left.id.localeCompare(right.id))
      : sortAndDedupeSceneEdges([
          ...layerProjection.visibleEdges,
          ...(hasVisualFocus
            ? Object.values(state.edgesById).filter(
                (edge) =>
                  visibleNodePubkeys.has(edge.source) &&
                  visibleNodePubkeys.has(edge.target) &&
                  (edge.source === visualFocusPubkey ||
                    edge.target === visualFocusPubkey),
              )
            : []),
        ])

  const depth1Neighbors = new Set<string>()
  if (visualFocusPubkey && hasVisualFocus) {
    for (const edge of forceEdges) {
      if (edge.source === visualFocusPubkey) {
        depth1Neighbors.add(edge.target)
      }
      if (edge.target === visualFocusPubkey) {
        depth1Neighbors.add(edge.source)
      }
    }
    depth1Neighbors.delete(visualFocusPubkey)
  }

  const sortedNodes = Array.from(visibleNodePubkeys)
    .map((pubkey) => state.nodesByPubkey[pubkey])
    .filter((node): node is NonNullable<typeof node> => Boolean(node))
    .sort((left, right) => {
      if (left.pubkey === state.rootPubkey) {
        return -1
      }

      if (right.pubkey === state.rootPubkey) {
        return 1
      }

      return (left.discoveredAt ?? Number.MAX_SAFE_INTEGER) -
        (right.discoveredAt ?? Number.MAX_SAFE_INTEGER) ||
        left.pubkey.localeCompare(right.pubkey)
    })

  const nodes: GraphSceneNode[] = sortedNodes.map((node) => {
    const isRoot = node.pubkey === state.rootPubkey
    const isSelected = node.pubkey === state.selectedNodePubkey
    const isPinned = state.pinnedNodePubkeys.has(node.pubkey)
    const isNeighbor = depth1Neighbors.has(node.pubkey)
    const focusState = resolveFocusState({
      isRoot,
      isSelected: node.pubkey === visualFocusPubkey,
      isPinned,
      isNeighbor,
      hasSelection: hasVisualFocus,
    })
    const baseColor = nodeColorBySource[node.source]
    const baseSize = isRoot ? SIZE_ROOT : isPinned ? SIZE_PINNED : SIZE_DEFAULT

    return {
      pubkey: node.pubkey,
      label: node.label?.trim() || truncatePubkey(node.pubkey),
      pictureUrl: node.picture,
      color: resolveNodeColor(focusState, baseColor),
      size: resolveNodeSize(focusState, baseSize),
      isRoot,
      isSelected,
      isPinned,
      isNeighbor,
      isDimmed: focusState === 'dim',
      focusState,
    }
  })

  const touchesFocus = (edge: CanonicalEdge) => {
    if (!hasVisualFocus || !visualFocusPubkey) {
      return false
    }
    return edge.source === visualFocusPubkey || edge.target === visualFocusPubkey
  }

  const visibleEdges = layerProjection.visibleEdges.map((edge) =>
    mapSceneEdge(edge, false, {
      hasSelection: hasVisualFocus,
      touchesFocus: touchesFocus(edge),
    }),
  )
  const sceneForceEdges = forceEdges.map((edge) => {
    const edgeTouchesFocus = touchesFocus(edge)

    return mapSceneEdge(
      edge,
      !visibleEdgeIds.has(edge.id) && !(hasVisualFocus && edgeTouchesFocus),
      {
        hasSelection: hasVisualFocus,
        touchesFocus: edgeTouchesFocus,
      },
    )
  })

  return {
    nodes,
    visibleEdges,
    forceEdges: sceneForceEdges,
    labels: nodes.map((node) => ({
      pubkey: node.pubkey,
      text: node.label,
    })),
    selection: {
      selectedNodePubkey: state.selectedNodePubkey,
      hoveredNodePubkey: null,
    },
    pins: {
      pubkeys: Array.from(state.pinnedNodePubkeys),
    },
    cameraHint: {
      focusPubkey: state.selectedNodePubkey ?? state.rootPubkey,
      rootPubkey: state.rootPubkey,
    },
    diagnostics: {
      activeLayer: state.activeLayer,
      nodeCount: nodes.length,
      visibleEdgeCount: visibleEdges.length,
      forceEdgeCount: sceneForceEdges.length,
      relayCount: state.relayState.urls.length,
      isGraphStale: state.relayState.isGraphStale,
      topologySignature: [
        state.rootPubkey ?? 'no-root',
        state.activeLayer,
        state.discoveryState.graphRevision,
        state.discoveryState.inboundGraphRevision,
        state.discoveryState.connectionsLinksRevision,
        nodes.length,
        sceneForceEdges.length,
      ].join('::'),
    },
  }
}
