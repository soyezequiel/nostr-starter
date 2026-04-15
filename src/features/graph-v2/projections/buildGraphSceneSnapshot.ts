import type { CanonicalEdge, CanonicalGraphState } from '@/features/graph-v2/domain/types'
import { buildLayerProjection } from '@/features/graph-v2/projections/buildLayerProjection'
import type { GraphSceneEdge, GraphSceneNode, GraphSceneSnapshot } from '@/features/graph-v2/renderer/contracts'

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

const mapSceneEdge = (
  edge: CanonicalEdge,
  hidden: boolean,
): GraphSceneEdge => ({
  id: edge.id,
  source: edge.source,
  target: edge.target,
  color: edgeColorByRelation[edge.relation],
  size: edge.relation === 'follow' ? 1.5 : 1.2,
  hidden,
  relation: edge.relation,
  weight: edge.weight,
})

export const buildGraphSceneSnapshot = (
  state: CanonicalGraphState,
): GraphSceneSnapshot => {
  const layerProjection = buildLayerProjection(state)
  const visibleEdgeIds = new Set(layerProjection.visibleEdges.map((edge) => edge.id))
  const visibleNodePubkeys = new Set(layerProjection.visibleNodePubkeys)
  const forceEdges = Object.values(state.edgesById)
    .filter(
      (edge) =>
        visibleNodePubkeys.has(edge.source) && visibleNodePubkeys.has(edge.target),
    )
    .sort((left, right) => left.id.localeCompare(right.id))

  const nodes: GraphSceneNode[] = Array.from(visibleNodePubkeys)
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
    .map((node) => ({
      pubkey: node.pubkey,
      label: node.label?.trim() || truncatePubkey(node.pubkey),
      pictureUrl: node.picture,
      color:
        node.pubkey === state.selectedNodePubkey
          ? '#ffb25b'
          : nodeColorBySource[node.source],
      size:
        node.pubkey === state.rootPubkey ? 18 : state.pinnedNodePubkeys.has(node.pubkey) ? 12 : 9,
      isRoot: node.pubkey === state.rootPubkey,
      isSelected: node.pubkey === state.selectedNodePubkey,
      isPinned: state.pinnedNodePubkeys.has(node.pubkey),
    }))

  const visibleEdges = layerProjection.visibleEdges.map((edge) => mapSceneEdge(edge, false))
  const sceneForceEdges = forceEdges.map((edge) =>
    mapSceneEdge(edge, !visibleEdgeIds.has(edge.id)),
  )

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
        sceneForceEdges.map((edge) => edge.id).join('|'),
      ].join('::'),
    },
  }
}

