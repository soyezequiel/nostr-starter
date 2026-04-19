import type { CanonicalEdge, CanonicalGraphState } from '@/features/graph-v2/domain/types'
import { buildLayerProjection } from '@/features/graph-v2/projections/buildLayerProjection'
import type {
  GraphPhysicsEdge,
  GraphPhysicsNode,
  GraphRenderEdge,
  GraphRenderNode,
  GraphSceneFocusState,
  GraphSceneSnapshot,
} from '@/features/graph-v2/renderer/contracts'

const truncatePubkey = (pubkey: string) =>
  pubkey.length <= 16 ? pubkey : `${pubkey.slice(0, 8)}...${pubkey.slice(-6)}`

const nodeColorBySource: Record<
  CanonicalGraphState['nodesByPubkey'][string]['source'],
  string
> = {
  root: '#7dd3a7',
  follow: '#c7d2de',
  inbound: '#c7d2de',
  zap: '#c7d2de',
  keyword: '#c7d2de',
}

const edgeColorByRelation: Record<CanonicalEdge['relation'], string> = {
  follow: '#64b5ff',
  inbound: '#ffb86b',
  zap: '#ff5da2',
}
const MUTUAL_EDGE_COLOR = '#5fd39d'

const DIM_NODE_COLOR = '#121a22'
const DIM_EDGE_COLOR = '#10171f'
const SELECTED_COLOR = '#f4fbff'
const NEIGHBOR_COLOR = '#f8f2a2'
const PINNED_COLOR = '#f4fbff'
const ROOT_COLOR = '#7dd3a7'
const NEIGHBOR_EDGE_BRIGHT = '#f4fbff'

const SIZE_ROOT = 18
const SIZE_EXPANDED = 18
const SIZE_PINNED = 12
const SIZE_DEFAULT = 9
const SIZE_SELECTED_BOOST = 8
const SIZE_NEIGHBOR_BOOST = 4
const SIZE_DIMMED = 5

const baseEdgeSize = (relation: CanonicalEdge['relation']) =>
  relation === 'follow' ? 1.1 : 0.9

const getReciprocalFollowEdgeIds = (edges: readonly CanonicalEdge[]) => {
  const followEdgeIds = new Set<string>()
  const reciprocalEdgeIds = new Set<string>()

  for (const edge of edges) {
    if (edge.relation !== 'follow') {
      continue
    }

    const reverseId = `${edge.target}->${edge.source}:follow`
    if (followEdgeIds.has(reverseId)) {
      reciprocalEdgeIds.add(edge.id)
      reciprocalEdgeIds.add(reverseId)
    }

    followEdgeIds.add(edge.id)
  }

  return reciprocalEdgeIds
}

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

const mapRenderEdge = (
  edge: CanonicalEdge,
  hidden: boolean,
  focusState: {
    hasSelection: boolean
    touchesFocus: boolean
  },
  options: {
    isMutual: boolean
  },
): GraphRenderEdge => {
  const baseColor = options.isMutual
    ? MUTUAL_EDGE_COLOR
    : edgeColorByRelation[edge.relation]
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

interface PhysicsEligibilityPolicy {
  select(scene: {
    forceEdges: readonly GraphRenderEdge[]
    renderNodes: readonly GraphRenderNode[]
  }): {
    nodes: GraphPhysicsNode[]
    edges: GraphPhysicsEdge[]
  }
}

class ForceEdgeEligibilityPolicy implements PhysicsEligibilityPolicy {
  public select({
    forceEdges,
    renderNodes,
  }: {
    forceEdges: readonly GraphRenderEdge[]
    renderNodes: readonly GraphRenderNode[]
  }) {
    const edges: GraphPhysicsEdge[] = forceEdges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      weight: edge.weight,
    }))
    const eligiblePubkeys = new Set<string>()

    for (const edge of edges) {
      eligiblePubkeys.add(edge.source)
      eligiblePubkeys.add(edge.target)
    }

    const nodes = renderNodes
      .filter((node) => eligiblePubkeys.has(node.pubkey))
      .map((node) => ({
        pubkey: node.pubkey,
        size: node.size,
        fixed: node.isPinned,
      }))

    return { nodes, edges }
  }
}

const DEFAULT_PHYSICS_ELIGIBILITY_POLICY = new ForceEdgeEligibilityPolicy()

const snapshotCache = new WeakMap<CanonicalGraphState, GraphSceneSnapshot>()
const snapshotSignatureCache = new Map<string, GraphSceneSnapshot>()
const MAX_SNAPSHOT_SIGNATURE_CACHE_ENTRIES = 24

let _snapCalls = 0
let _snapHits = 0

const rememberSnapshotBySignature = (
  signature: string,
  snapshot: GraphSceneSnapshot,
) => {
  snapshotSignatureCache.set(signature, snapshot)

  if (snapshotSignatureCache.size <= MAX_SNAPSHOT_SIGNATURE_CACHE_ENTRIES) {
    return
  }

  const oldestSignature = snapshotSignatureCache.keys().next().value
  if (oldestSignature !== undefined) {
    snapshotSignatureCache.delete(oldestSignature)
  }
}

export const buildGraphSceneSnapshot = (
  state: CanonicalGraphState,
): GraphSceneSnapshot => {
  const isPerfEnabled =
    typeof process !== 'undefined' &&
    process.env.NEXT_PUBLIC_GRAPH_V2_PERF === '1'

  if (isPerfEnabled) {
    _snapCalls += 1
  }

  const cached = snapshotCache.get(state)
  if (cached) {
    if (isPerfEnabled) {
      _snapHits += 1
    }
    return cached
  }

  const signatureCached = snapshotSignatureCache.get(state.sceneSignature)
  if (signatureCached) {
    if (isPerfEnabled) {
      _snapHits += 1
    }
    snapshotCache.set(state, signatureCached)
    return signatureCached
  }

  const snapshot = computeGraphSceneSnapshot(state)
  snapshotCache.set(state, snapshot)
  rememberSnapshotBySignature(state.sceneSignature, snapshot)
  return snapshot
}

export const getSnapshotCacheStats = () => ({
  calls: _snapCalls,
  hits: _snapHits,
  misses: _snapCalls - _snapHits,
})

const computeGraphSceneSnapshot = (
  state: CanonicalGraphState,
): GraphSceneSnapshot => {
  const layerProjection = buildLayerProjection(state)
  const visibleEdgeIds = new Set(
    layerProjection.visibleEdges.map((edge) => edge.id),
  )
  const visibleNodePubkeys = new Set(layerProjection.visibleNodePubkeys)
  const visualFocusPubkey =
    state.selectedNodePubkey && state.nodesByPubkey[state.selectedNodePubkey]
      ? state.selectedNodePubkey
      : null
  const hasVisualFocus = visualFocusPubkey !== null
  const forceEdges =
    state.activeLayer === 'graph'
      ? layerProjection.visibleEdges
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

      return (
        (left.discoveredAt ?? Number.MAX_SAFE_INTEGER) -
          (right.discoveredAt ?? Number.MAX_SAFE_INTEGER) ||
        left.pubkey.localeCompare(right.pubkey)
      )
    })

  const renderNodes: GraphRenderNode[] = sortedNodes.map((node) => {
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
    const baseSize = isRoot
      ? SIZE_ROOT
      : node.isExpanded
        ? SIZE_EXPANDED
        : isPinned
          ? SIZE_PINNED
          : SIZE_DEFAULT

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

  const reciprocalVisibleEdgeIds = getReciprocalFollowEdgeIds(layerProjection.visibleEdges)
  const reciprocalForceEdgeIds = getReciprocalFollowEdgeIds(forceEdges)

  const visibleEdges = layerProjection.visibleEdges.map((edge) =>
    mapRenderEdge(edge, false, {
      hasSelection: hasVisualFocus,
      touchesFocus: touchesFocus(edge),
    }, {
      isMutual: reciprocalVisibleEdgeIds.has(edge.id),
    }),
  )
  const renderForceEdges = forceEdges.map((edge) => {
    const edgeTouchesFocus = touchesFocus(edge)

    return mapRenderEdge(
      edge,
      !visibleEdgeIds.has(edge.id) && !(hasVisualFocus && edgeTouchesFocus),
      {
        hasSelection: hasVisualFocus,
        touchesFocus: edgeTouchesFocus,
      },
      {
        isMutual: reciprocalForceEdgeIds.has(edge.id),
      },
    )
  })
  const physics = DEFAULT_PHYSICS_ELIGIBILITY_POLICY.select({
    forceEdges: renderForceEdges,
    renderNodes,
  })

  return {
    render: {
      nodes: renderNodes,
      visibleEdges,
      labels: renderNodes.map((node) => ({
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
        nodeCount: renderNodes.length,
        visibleEdgeCount: visibleEdges.length,
        relayCount: state.relayState.urls.length,
        isGraphStale: state.relayState.isGraphStale,
        topologySignature: [
          state.rootPubkey ?? 'no-root',
          state.activeLayer,
          state.discoveryState.graphRevision,
          state.discoveryState.inboundGraphRevision,
          state.discoveryState.connectionsLinksRevision,
          renderNodes.length,
          renderForceEdges.length,
        ].join('::'),
      },
    },
    physics: {
      nodes: physics.nodes,
      edges: physics.edges,
      diagnostics: {
        nodeCount: physics.nodes.length,
        edgeCount: physics.edges.length,
        topologySignature: [
          state.rootPubkey ?? 'no-root',
          state.activeLayer,
          state.discoveryState.graphRevision,
          state.discoveryState.inboundGraphRevision,
          state.discoveryState.connectionsLinksRevision,
          physics.nodes.length,
          physics.edges.length,
        ].join('::'),
      },
    },
  }
}
