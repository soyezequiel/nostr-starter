import type {
  AppStateCreator,
  GraphCaps,
  GraphLink,
  GraphNode,
  NodeExpansionState,
  NodeStructurePreviewState,
  GraphSlice,
} from '@/features/graph/app/store/types'

export const DEFAULT_MAX_GRAPH_NODES = 3000

const createInitialGraphCaps = (): GraphCaps => ({
  maxNodes: DEFAULT_MAX_GRAPH_NODES,
  capReached: false,
})

const createInitialNodeExpansionState = (): NodeExpansionState => ({
  status: 'idle',
  message: null,
})

const createInitialNodeStructurePreviewState = (): NodeStructurePreviewState => ({
  status: 'idle',
  message: null,
  discoveredFollowCount: null,
})

export const createInitialGraphSliceState = (): Pick<
  GraphSlice,
  | 'nodes'
  | 'links'
  | 'adjacency'
  | 'rootNodePubkey'
  | 'graphCaps'
  | 'expandedNodePubkeys'
  | 'nodeExpansionStates'
  | 'nodeStructurePreviewStates'
> => ({
  nodes: {},
  links: [],
  adjacency: {},
  rootNodePubkey: null,
  graphCaps: createInitialGraphCaps(),
  expandedNodePubkeys: new Set(),
  nodeExpansionStates: {},
  nodeStructurePreviewStates: {},
})

const getLinkKey = (link: GraphLink) =>
  `${link.source}->${link.target}:${link.relation}`

const cloneAdjacency = (adjacency: Record<string, string[]>) =>
  Object.fromEntries(
    Object.entries(adjacency).map(([pubkey, neighbors]) => [
      pubkey,
      neighbors.slice(),
    ]),
  )

const addNeighbor = (
  adjacency: Record<string, string[]>,
  source: string,
  target: string,
) => {
  const neighbors = adjacency[source] ?? []

  if (neighbors.includes(target)) {
    adjacency[source] = neighbors
    return
  }

  adjacency[source] = [...neighbors, target]
}

const getNodeCount = (nodes: Record<string, GraphNode>) => Object.keys(nodes).length

export const createGraphSlice: AppStateCreator<GraphSlice> = (set, get) => ({
  ...createInitialGraphSliceState(),
  setRootNodePubkey: (pubkey) => {
    set({ rootNodePubkey: pubkey })
  },
  upsertNodes: (incomingNodes) => {
    const state = get()
    const nextNodes = { ...state.nodes }
    const acceptedPubkeys: string[] = []
    const rejectedPubkeys: string[] = []
    let capReached = state.graphCaps.capReached

    for (const node of incomingNodes) {
      const existingNode = nextNodes[node.pubkey]

      if (existingNode) {
        nextNodes[node.pubkey] = {
          ...existingNode,
          ...node,
        }
        acceptedPubkeys.push(node.pubkey)
        continue
      }

      if (getNodeCount(nextNodes) >= state.graphCaps.maxNodes) {
        capReached = true
        rejectedPubkeys.push(node.pubkey)
        continue
      }

      nextNodes[node.pubkey] = node
      acceptedPubkeys.push(node.pubkey)
    }

    set({
      nodes: nextNodes,
      graphCaps: {
        ...state.graphCaps,
        capReached,
      },
    })

    return {
      acceptedPubkeys,
      rejectedPubkeys,
    }
  },
  removeNodes: (pubkeys) => {
    const removeSet = new Set(pubkeys.filter(Boolean))
    if (removeSet.size === 0) {
      return
    }

    const state = get()
    const hasNodesToRemove = Array.from(removeSet).some(
      (pubkey) => state.nodes[pubkey] !== undefined,
    )

    if (!hasNodesToRemove) {
      return
    }

    const nextNodes = { ...state.nodes }
    for (const pubkey of removeSet) {
      delete nextNodes[pubkey]
    }

    const nextLinks = state.links.filter(
      (link) => !removeSet.has(link.source) && !removeSet.has(link.target),
    )
    const nextAdjacency = Object.fromEntries(
      Object.entries(state.adjacency)
        .filter(([pubkey]) => !removeSet.has(pubkey))
        .map(([pubkey, neighbors]) => [
          pubkey,
          neighbors.filter((neighbor) => !removeSet.has(neighbor)),
        ]),
    )
    const nextExpandedNodePubkeys = new Set(
      Array.from(state.expandedNodePubkeys).filter(
        (pubkey) => !removeSet.has(pubkey),
      ),
    )
    const nextNodeExpansionStates = Object.fromEntries(
      Object.entries(state.nodeExpansionStates).filter(
        ([pubkey]) => !removeSet.has(pubkey),
      ),
    )
    const nextNodeStructurePreviewStates = Object.fromEntries(
      Object.entries(state.nodeStructurePreviewStates).filter(
        ([pubkey]) => !removeSet.has(pubkey),
      ),
    )

    set({
      nodes: nextNodes,
      links: nextLinks,
      adjacency: nextAdjacency,
      expandedNodePubkeys: nextExpandedNodePubkeys,
      nodeExpansionStates: nextNodeExpansionStates,
      nodeStructurePreviewStates: nextNodeStructurePreviewStates,
    })
  },
  upsertLinks: (incomingLinks) => {
    const state = get()
    const nextLinks = state.links.slice()
    const nextAdjacency = cloneAdjacency(state.adjacency)
    const seenLinks = new Set(state.links.map(getLinkKey))

    for (const link of incomingLinks) {
      const key = getLinkKey(link)

      if (!seenLinks.has(key)) {
        nextLinks.push(link)
        seenLinks.add(key)
      }

      addNeighbor(nextAdjacency, link.source, link.target)
    }

    set({
      links: nextLinks,
      adjacency: nextAdjacency,
    })
  },
  markNodeExpanded: (pubkey) => {
    const state = get()
    if (state.expandedNodePubkeys.has(pubkey)) {
      return
    }
    const next = new Set(state.expandedNodePubkeys)
    next.add(pubkey)
    set({ expandedNodePubkeys: next })
  },
  setNodeExpansionState: (pubkey, nextState) => {
    const state = get()
    const currentState =
      state.nodeExpansionStates[pubkey] ?? createInitialNodeExpansionState()

    if (
      currentState.status === nextState.status &&
      currentState.message === nextState.message
    ) {
      return
    }

    set({
      nodeExpansionStates: {
        ...state.nodeExpansionStates,
        [pubkey]: nextState,
      },
    })
  },
  setNodeStructurePreviewState: (pubkey, nextState) => {
    const state = get()
    const currentState =
      state.nodeStructurePreviewStates[pubkey] ??
      createInitialNodeStructurePreviewState()

    if (
      currentState.status === nextState.status &&
      currentState.message === nextState.message &&
      currentState.discoveredFollowCount === nextState.discoveredFollowCount
    ) {
      return
    }

    set({
      nodeStructurePreviewStates: {
        ...state.nodeStructurePreviewStates,
        [pubkey]: nextState,
      },
    })
  },
  resetGraph: () => {
    set(createInitialGraphSliceState())
  },
})
