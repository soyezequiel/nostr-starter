import type { CanonicalEdge, CanonicalGraphState } from '@/features/graph-v2/domain/types'
import type { GraphV2Layer } from '@/features/graph-v2/domain/invariants'
import {
  comparePubkeys,
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

export const buildLayerProjection = (
  state: CanonicalGraphState,
  layer: GraphV2Layer = state.activeLayer,
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

  const followingEdges = sortAndDedupeEdges(
    primaryEdges.filter(
      (edge) =>
        edge.relation === 'follow' &&
        relationshipAnchorPubkeys.has(edge.source),
    ),
  )

  const followerEdges = sortAndDedupeEdges(
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

  const adjacency = new Map<string, Set<string>>()
  for (const edge of primaryEdges) {
    const targets = adjacency.get(edge.source) ?? new Set<string>()
    targets.add(edge.target)
    adjacency.set(edge.source, targets)
  }

  const mutualEdges = sortAndDedupeEdges(
    Array.from(relationshipAnchorPubkeys)
      .sort(comparePubkeys)
      .flatMap((anchorPubkey) =>
        followingEdges
          .filter((edge) => edge.source === anchorPubkey)
          .filter((edge) => adjacency.get(edge.target)?.has(anchorPubkey))
          .flatMap((edge) => [
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
          ]),
      ),
  )

  const nonReciprocalFollowingEdges = sortAndDedupeEdges(
    followingEdges.filter((edge) => !adjacency.get(edge.target)?.has(edge.source)),
  )

  const nonReciprocalFollowerEdges = sortAndDedupeEdges(
    followerEdges.filter((edge) => !adjacency.get(edge.target)?.has(edge.source)),
  )

  const graphEdges = sortAndDedupeEdges(primaryEdges)

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

  const visibleEdges =
    layer === 'following'
      ? followingEdges
      : layer === 'followers'
        ? followerEdges
        : layer === 'mutuals'
          ? mutualEdges
          : layer === 'following-non-followers'
            ? nonReciprocalFollowingEdges
            : layer === 'nonreciprocal-followers'
              ? nonReciprocalFollowerEdges
              : graphEdges

  return {
    visibleEdges,
    visibleNodePubkeys: createVisibleNodeSet(
      rootPubkey,
      state.discoveryState.expandedNodePubkeys,
      visibleEdges,
      layer === 'graph',
    ),
  }
}
