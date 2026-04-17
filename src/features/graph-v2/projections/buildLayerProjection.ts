import type { CanonicalEdge, CanonicalGraphState } from '@/features/graph-v2/domain/types'
import type { GraphV2Layer } from '@/features/graph-v2/domain/invariants'
import {
  createCanonicalEdgeId,
  isGraphV2Layer,
} from '@/features/graph-v2/domain/invariants'

interface LayerProjection {
  visibleNodePubkeys: ReadonlySet<string>
  visibleEdges: CanonicalEdge[]
}

const compareEdges = (left: CanonicalEdge, right: CanonicalEdge) =>
  left.id.localeCompare(right.id)

const sortAndDedupeEdges = (edges: readonly CanonicalEdge[]) => {
  const edgesById = new Map<string, CanonicalEdge>()

  for (const edge of edges) {
    edgesById.set(edge.id, edge)
  }

  return Array.from(edgesById.values()).sort(compareEdges)
}

const addMapSetValue = (
  map: Map<string, Set<string>>,
  key: string,
  value: string,
) => {
  const values = map.get(key)

  if (values) {
    values.add(value)
    return
  }

  map.set(key, new Set<string>([value]))
}

const buildAdjacency = (edges: readonly CanonicalEdge[]) => {
  const adjacency = new Map<string, Set<string>>()

  for (const edge of edges) {
    addMapSetValue(adjacency, edge.source, edge.target)
  }

  return adjacency
}

const createVisibleNodeSet = (
  rootPubkey: string | null,
  expandedNodePubkeys: ReadonlySet<string>,
  edges: readonly CanonicalEdge[],
  includeExpanded: boolean,
) => {
  const visiblePubkeys = new Set<string>()

  if (rootPubkey) {
    visiblePubkeys.add(rootPubkey)
  }

  if (includeExpanded) {
    for (const pubkey of expandedNodePubkeys) {
      visiblePubkeys.add(pubkey)
    }
  }

  for (const edge of edges) {
    visiblePubkeys.add(edge.source)
    visiblePubkeys.add(edge.target)
  }

  return visiblePubkeys
}

const normalizeConnectionEdge = (edge: CanonicalEdge): CanonicalEdge => ({
  ...edge,
  id: createCanonicalEdgeId(
    edge.source,
    edge.target,
    edge.relation === 'follow' ? 'follow' : 'inbound',
  ),
  relation: edge.relation === 'follow' ? 'follow' : 'inbound',
})

const buildFollowingEdges = (
  primaryEdges: readonly CanonicalEdge[],
  relationshipAnchorPubkeys: ReadonlySet<string>,
) =>
  sortAndDedupeEdges(
    primaryEdges.filter(
      (edge) =>
        edge.relation === 'follow' &&
        relationshipAnchorPubkeys.has(edge.source),
    ),
  )

const buildFollowerEdges = (
  primaryEdges: readonly CanonicalEdge[],
  relationshipAnchorPubkeys: ReadonlySet<string>,
) =>
  sortAndDedupeEdges(
    primaryEdges
      .filter(
        (edge) =>
          (edge.relation === 'inbound' &&
            relationshipAnchorPubkeys.has(edge.target)) ||
          (edge.relation === 'follow' &&
            relationshipAnchorPubkeys.has(edge.target) &&
            !relationshipAnchorPubkeys.has(edge.source)),
      )
      .map((edge) => ({
        ...edge,
        relation: 'inbound' as const,
        id: createCanonicalEdgeId(edge.source, edge.target, 'inbound'),
      })),
  )

const buildMutualEdges = (
  followingEdges: readonly CanonicalEdge[],
  adjacency: ReadonlyMap<string, ReadonlySet<string>>,
) =>
  sortAndDedupeEdges(
    followingEdges.flatMap((edge) =>
      adjacency.get(edge.target)?.has(edge.source)
        ? [
            {
              ...edge,
              relation: 'follow' as const,
              id: createCanonicalEdgeId(edge.source, edge.target, 'follow'),
            },
            {
              ...edge,
              source: edge.target,
              target: edge.source,
              relation: 'follow' as const,
              id: createCanonicalEdgeId(edge.target, edge.source, 'follow'),
            },
          ]
        : [],
    ),
  )

const buildNonReciprocalEdges = (
  edges: readonly CanonicalEdge[],
  adjacency: ReadonlyMap<string, ReadonlySet<string>>,
) =>
  sortAndDedupeEdges(
    edges.filter((edge) => !adjacency.get(edge.target)?.has(edge.source)),
  )

const projectionCache = new WeakMap<
  CanonicalGraphState,
  Map<GraphV2Layer, LayerProjection>
>()

export const buildLayerProjection = (
  state: CanonicalGraphState,
  layer: GraphV2Layer = state.activeLayer,
): LayerProjection => {
  const cached = projectionCache.get(state)?.get(layer)
  if (cached) {
    return cached
  }

  const projection = computeLayerProjection(state, layer)
  let byLayer = projectionCache.get(state)
  if (!byLayer) {
    byLayer = new Map()
    projectionCache.set(state, byLayer)
  }
  byLayer.set(layer, projection)
  return projection
}

const computeLayerProjection = (
  state: CanonicalGraphState,
  layer: GraphV2Layer,
): LayerProjection => {
  const allEdges = Object.values(state.edgesById)
  const primaryEdges = allEdges.filter((edge) => edge.origin !== 'connections')
  const rootPubkey = state.rootPubkey
  const relationshipAnchorPubkeys = new Set<string>(
    state.discoveryState.expandedNodePubkeys,
  )

  if (rootPubkey) {
    relationshipAnchorPubkeys.add(rootPubkey)
  }

  const resolveConnectionsVisiblePubkeys = () => {
    const sourceLayer: GraphV2Layer = isGraphV2Layer(state.connectionsSourceLayer)
      ? state.connectionsSourceLayer
      : 'graph'

    const sourceProjection = buildLayerProjection(state, sourceLayer)
    const visiblePubkeys = new Set(sourceProjection.visibleNodePubkeys)

    if (rootPubkey) {
      visiblePubkeys.delete(rootPubkey)
    }

    return visiblePubkeys
  }

  const createProjectionFromEdges = (
    visibleEdges: readonly CanonicalEdge[],
    includeExpanded: boolean,
  ): LayerProjection => ({
    visibleEdges: [...visibleEdges],
    visibleNodePubkeys: createVisibleNodeSet(
      rootPubkey,
      state.discoveryState.expandedNodePubkeys,
      visibleEdges,
      includeExpanded,
    ),
  })

  if (layer === 'connections') {
    const connectionsVisiblePubkeys = resolveConnectionsVisiblePubkeys()
    const connectionEdgesByPair = new Map<string, CanonicalEdge>()

    for (const edge of allEdges) {
      if (
        edge.source === rootPubkey ||
        edge.target === rootPubkey ||
        !connectionsVisiblePubkeys.has(edge.source) ||
        !connectionsVisiblePubkeys.has(edge.target)
      ) {
        continue
      }

      const normalizedEdge = normalizeConnectionEdge(edge)
      const pairKey = `${normalizedEdge.source}->${normalizedEdge.target}`
      const current = connectionEdgesByPair.get(pairKey)

      if (!current || normalizedEdge.relation === 'follow') {
        connectionEdgesByPair.set(pairKey, normalizedEdge)
      }
    }

    const visibleEdges = Array.from(connectionEdgesByPair.values()).sort(compareEdges)
    return {
      visibleEdges,
      visibleNodePubkeys: createVisibleNodeSet(
        null,
        new Set<string>(),
        visibleEdges,
        false,
      ),
    }
  }

  if (layer === 'graph') {
    return createProjectionFromEdges(sortAndDedupeEdges(primaryEdges), true)
  }

  if (layer === 'following') {
    const followingEdges = buildFollowingEdges(
      primaryEdges,
      relationshipAnchorPubkeys,
    )
    return createProjectionFromEdges(followingEdges, true)
  }

  if (layer === 'mutuals' || layer === 'following-non-followers') {
    const followingEdges = buildFollowingEdges(
      primaryEdges,
      relationshipAnchorPubkeys,
    )
    const adjacency = buildAdjacency(primaryEdges)

    if (layer === 'mutuals') {
      return createProjectionFromEdges(
        buildMutualEdges(followingEdges, adjacency),
        true,
      )
    }

    return createProjectionFromEdges(
      buildNonReciprocalEdges(followingEdges, adjacency),
      true,
    )
  }

  const followerEdges = buildFollowerEdges(primaryEdges, relationshipAnchorPubkeys)

  if (layer === 'followers') {
    return createProjectionFromEdges(followerEdges, true)
  }

  const adjacency = buildAdjacency(primaryEdges)
  return createProjectionFromEdges(
    buildNonReciprocalEdges(followerEdges, adjacency),
    true,
  )
}
