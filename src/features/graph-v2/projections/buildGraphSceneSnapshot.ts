import type { CanonicalEdge, CanonicalGraphSceneState } from '@/features/graph-v2/domain/types'
import {
  getAccountTraceConfig,
  isAccountTraceRoot,
  traceAccountFlow,
} from '@/features/graph-runtime/debug/accountTrace'
import { sortAndDedupeDirectedEdges } from '@/features/graph-v2/projections/dedupeEdges'
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

const edgeColorByRelation: Record<CanonicalEdge['relation'], string> = {
  follow: '#64b5ff',
  inbound: '#ffb86b',
  zap: '#ff5da2',
}
const MUTUAL_EDGE_COLOR = '#5fd39d'
const COMMON_NODE_PALETTE = [
  '#91abc8',
  '#8fb8b1',
  '#b29ecf',
  '#c79a8f',
  '#8ebfc7',
  '#c59ab7',
  '#9fb58d',
  '#9da8c9',
  '#7fbad4',
  '#7eb69f',
  '#d08f78',
  '#89a1d8',
  '#d08e9d',
  '#73c3bb',
  '#b2bf73',
  '#a78fd1',
] as const
const commonNodeColorCache = new Map<string, string>()

const DIM_NODE_COLOR = '#121a22'
const DIM_EDGE_COLOR = '#10171f'
const SELECTED_COLOR = '#f4fbff'
const PINNED_COLOR = '#f4fbff'
const ROOT_COLOR = '#7dd3a7'
const NEIGHBOR_EDGE_BRIGHT = '#f4fbff'

const SIZE_ROOT = 18
const SIZE_EXPANDED = 18
const SIZE_PINNED = 12
const SIZE_DEFAULT = 9
const SIZE_SELECTED_BOOST = 8
const SIZE_DIMMED = 5
const MIN_NODE_EXPANSION_PROGRESS = 0.12
const MAX_NODE_EXPANSION_PROGRESS = 0.94

const baseEdgeSize = (relation: CanonicalEdge['relation']) =>
  relation === 'follow' ? 1.1 : 0.9

const hashPubkey = (pubkey: string) => {
  let hash = 2166136261

  for (let index = 0; index < pubkey.length; index += 1) {
    hash ^= pubkey.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }

  return hash >>> 0
}

const getCommonNodeColor = (pubkey: string) => {
  const cached = commonNodeColorCache.get(pubkey)
  if (cached) {
    return cached
  }

  const color = COMMON_NODE_PALETTE[hashPubkey(pubkey) % COMMON_NODE_PALETTE.length]!
  commonNodeColorCache.set(pubkey, color)
  return color
}

const resolveBaseNodeColor = (
  node: CanonicalGraphSceneState['nodesByPubkey'][string],
) => (node.source === 'root' ? ROOT_COLOR : getCommonNodeColor(node.pubkey))

const isFollowEvidenceRelation = (relation: CanonicalEdge['relation']) =>
  relation === 'follow' || relation === 'inbound'

const getReciprocalFollowEdgeIds = (edges: readonly CanonicalEdge[]) => {
  const edgeIdsByDirection = new Map<string, string[]>()
  const reciprocalEdgeIds = new Set<string>()

  for (const edge of edges) {
    if (!isFollowEvidenceRelation(edge.relation)) {
      continue
    }

    const directionKey = `${edge.source}->${edge.target}`
    const reverseDirectionKey = `${edge.target}->${edge.source}`
    const reverseEdgeIds = edgeIdsByDirection.get(reverseDirectionKey)

    if (reverseEdgeIds) {
      reciprocalEdgeIds.add(edge.id)
      for (const reverseEdgeId of reverseEdgeIds) {
        reciprocalEdgeIds.add(reverseEdgeId)
      }
    }

    const directionEdgeIds = edgeIdsByDirection.get(directionKey)
    if (directionEdgeIds) {
      directionEdgeIds.push(edge.id)
    } else {
      edgeIdsByDirection.set(directionKey, [edge.id])
    }
  }

  return reciprocalEdgeIds
}

const shouldIncludeFocusedContextEdge = ({
  activeLayer,
  edge,
  visibleEdgeIds,
}: {
  activeLayer: CanonicalGraphSceneState['activeLayer']
  edge: CanonicalEdge
  visibleEdgeIds: ReadonlySet<string>
}) => {
  if (visibleEdgeIds.has(edge.id)) {
    return true
  }

  // `following` keeps the selected node's follow neighborhood in physics even
  // when those edges arrive through the connections origin, but filtered layers
  // like `mutuals` must stay faithful to their own edge set.
  return activeLayer === 'following' && edge.relation === 'follow'
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
      return baseColor
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
      return baseSize
    case 'dim':
      return SIZE_DIMMED
    case 'root':
    case 'pinned':
    case 'idle':
    default:
      return baseSize
  }
}

const resolveNodeExpansionProgress = (
  node: CanonicalGraphSceneState['nodesByPubkey'][string],
) => {
  if (node.nodeExpansionState?.status !== 'loading') {
    return null
  }

  const step = node.nodeExpansionState.step
  const totalSteps = node.nodeExpansionState.totalSteps

  if (
    typeof step !== 'number' ||
    !Number.isFinite(step) ||
    typeof totalSteps !== 'number' ||
    !Number.isFinite(totalSteps) ||
    totalSteps <= 0
  ) {
    return MIN_NODE_EXPANSION_PROGRESS
  }

  const rawProgress = step / totalSteps
  return Math.min(
    MAX_NODE_EXPANSION_PROGRESS,
    Math.max(MIN_NODE_EXPANSION_PROGRESS, rawProgress),
  )
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

const snapshotCache = new WeakMap<CanonicalGraphSceneState, GraphSceneSnapshot>()
const snapshotSignatureCache = new Map<string, GraphSceneSnapshot>()
const MAX_SNAPSHOT_SIGNATURE_CACHE_ENTRIES = 24

let _snapCalls = 0
let _snapHits = 0
let lastAccountTraceSceneKey = ''

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
  state: CanonicalGraphSceneState,
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
  state: CanonicalGraphSceneState,
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
      : sortAndDedupeDirectedEdges([
          ...layerProjection.visibleEdges,
          ...(hasVisualFocus
            ? Object.values(state.edgesById).filter(
                (edge) =>
                  shouldIncludeFocusedContextEdge({
                    activeLayer: state.activeLayer,
                    edge,
                    visibleEdgeIds,
                  }) &&
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
    const baseColor = resolveBaseNodeColor(node)
    const baseSize = isRoot
      ? SIZE_ROOT
      : node.isExpanded
        ? SIZE_EXPANDED
        : isPinned
          ? SIZE_PINNED
          : SIZE_DEFAULT
    const expansionProgress = resolveNodeExpansionProgress(node)

    return {
      pubkey: node.pubkey,
      label: node.label?.trim() || truncatePubkey(node.pubkey),
      pictureUrl: node.picture,
      color: resolveNodeColor(focusState, baseColor),
      size: resolveNodeSize(focusState, baseSize),
      isExpanding: expansionProgress !== null,
      expansionProgress,
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
  if (isAccountTraceRoot(state.rootPubkey)) {
    const traceConfig = getAccountTraceConfig()
    if (traceConfig) {
      const allEdges = Object.values(state.edgesById)
      const rootToTargetFollow = allEdges.find(
        (edge) =>
          edge.source === traceConfig.rootPubkey &&
          edge.target === traceConfig.targetPubkey &&
          edge.relation === 'follow',
      )
      const targetToRootInbound = allEdges.find(
        (edge) =>
          edge.source === traceConfig.targetPubkey &&
          edge.target === traceConfig.rootPubkey &&
          edge.relation === 'inbound',
      )
      const targetToRootFollow = allEdges.find(
        (edge) =>
          edge.source === traceConfig.targetPubkey &&
          edge.target === traceConfig.rootPubkey &&
          edge.relation === 'follow',
      )
      const visibleTraceEdgeIds = new Set(
        visibleEdges
          .filter(
            (edge) =>
              (edge.source === traceConfig.rootPubkey &&
                edge.target === traceConfig.targetPubkey) ||
              (edge.source === traceConfig.targetPubkey &&
                edge.target === traceConfig.rootPubkey),
          )
          .map((edge) => edge.id),
      )
      const forceTraceEdges = renderForceEdges.filter(
        (edge) =>
          (edge.source === traceConfig.rootPubkey &&
            edge.target === traceConfig.targetPubkey) ||
          (edge.source === traceConfig.targetPubkey &&
            edge.target === traceConfig.rootPubkey),
      )
      const sceneKey = JSON.stringify([
        state.sceneSignature,
        Boolean(state.nodesByPubkey[traceConfig.targetPubkey]),
        Boolean(rootToTargetFollow),
        Boolean(targetToRootInbound),
        Boolean(targetToRootFollow),
        Array.from(visibleTraceEdgeIds).sort(),
        forceTraceEdges.map((edge) => [edge.id, edge.hidden, edge.color]).sort(),
      ])

      if (sceneKey !== lastAccountTraceSceneKey) {
        lastAccountTraceSceneKey = sceneKey
        traceAccountFlow('buildGraphSceneSnapshot.traceTarget', {
          activeLayer: state.activeLayer,
          hasTraceTargetNode: Boolean(state.nodesByPubkey[traceConfig.targetPubkey]),
          hasRootToTraceTargetFollowEdge: Boolean(rootToTargetFollow),
          hasTraceTargetToRootInboundEdge: Boolean(targetToRootInbound),
          hasTraceTargetToRootFollowEdge: Boolean(targetToRootFollow),
          rootToTraceTargetFollowIsMutual: rootToTargetFollow
            ? reciprocalForceEdgeIds.has(rootToTargetFollow.id)
            : false,
          traceTargetToRootInboundIsMutual: targetToRootInbound
            ? reciprocalForceEdgeIds.has(targetToRootInbound.id)
            : false,
          visibleTraceEdgeIds: Array.from(visibleTraceEdgeIds).sort(),
          forceTraceEdges: forceTraceEdges.map((edge) => ({
            id: edge.id,
            relation: edge.relation,
            hidden: edge.hidden,
            color: edge.color,
            size: edge.size,
          })),
          nodeCount: renderNodes.length,
          visibleEdgeCount: visibleEdges.length,
          forceEdgeCount: renderForceEdges.length,
        })
      }
    }
  }
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
