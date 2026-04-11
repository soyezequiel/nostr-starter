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
  phase: 'idle',
  step: null,
  totalSteps: null,
  startedAt: null,
  updatedAt: null,
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
  | 'inboundLinks'
  | 'inboundAdjacency'
  | 'graphRevision'
  | 'inboundGraphRevision'
  | 'rootNodePubkey'
  | 'graphCaps'
  | 'expandedNodePubkeys'
  | 'nodeExpansionStates'
  | 'nodeStructurePreviewStates'
> => ({
  nodes: {},
  links: [],
  adjacency: {},
  inboundLinks: [],
  inboundAdjacency: {},
  graphRevision: 0,
  inboundGraphRevision: 0,
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
    return false
  }

  adjacency[source] = [...neighbors, target]
  return true
}

const getNodeCount = (nodes: Record<string, GraphNode>) => Object.keys(nodes).length

const hasGraphNodeChanged = (left: GraphNode, right: GraphNode) =>
  left.pubkey !== right.pubkey ||
  left.label !== right.label ||
  left.picture !== right.picture ||
  left.about !== right.about ||
  left.nip05 !== right.nip05 ||
  left.lud16 !== right.lud16 ||
  left.profileEventId !== right.profileEventId ||
  left.profileFetchedAt !== right.profileFetchedAt ||
  left.profileSource !== right.profileSource ||
  left.profileState !== right.profileState ||
  left.keywordHits !== right.keywordHits ||
  left.discoveredAt !== right.discoveredAt ||
  left.source !== right.source

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
    let changed = false
    let capsChanged = false

    for (const node of incomingNodes) {
      const existingNode = nextNodes[node.pubkey]

      if (existingNode) {
        const nextNode = {
          ...existingNode,
          ...node,
        }
        if (hasGraphNodeChanged(existingNode, nextNode)) {
          nextNodes[node.pubkey] = nextNode
          changed = true
        }
        acceptedPubkeys.push(node.pubkey)
        continue
      }

      if (getNodeCount(nextNodes) >= state.graphCaps.maxNodes) {
        if (!capReached) {
          capReached = true
          capsChanged = true
        }
        rejectedPubkeys.push(node.pubkey)
        continue
      }

      nextNodes[node.pubkey] = node
      acceptedPubkeys.push(node.pubkey)
      changed = true
    }

    if (changed || capsChanged) {
      set({
        nodes: nextNodes,
        graphRevision: changed ? state.graphRevision + 1 : state.graphRevision,
        graphCaps: {
          ...state.graphCaps,
          capReached,
        },
      })
    }

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
    const nextInboundLinks = state.inboundLinks.filter(
      (link) => !removeSet.has(link.source) && !removeSet.has(link.target),
    )
    const nextInboundAdjacency = Object.fromEntries(
      Object.entries(state.inboundAdjacency)
        .filter(([pubkey]) => !removeSet.has(pubkey))
        .map(([pubkey, followers]) => [
          pubkey,
          followers.filter((follower) => !removeSet.has(follower)),
        ]),
    )

    set({
      nodes: nextNodes,
      links: nextLinks,
      adjacency: nextAdjacency,
      inboundLinks: nextInboundLinks,
      inboundAdjacency: nextInboundAdjacency,
      graphRevision: state.graphRevision + 1,
      expandedNodePubkeys: nextExpandedNodePubkeys,
      nodeExpansionStates: nextNodeExpansionStates,
      nodeStructurePreviewStates: nextNodeStructurePreviewStates,
      graphCaps: {
        ...state.graphCaps,
        capReached: getNodeCount(nextNodes) >= state.graphCaps.maxNodes,
      },
    })
  },
  upsertLinks: (incomingLinks) => {
    const state = get()
    const nextLinks = state.links.slice()
    const nextAdjacency = cloneAdjacency(state.adjacency)
    const seenLinks = new Set(state.links.map(getLinkKey))
    let changed = false

    for (const link of incomingLinks) {
      const key = getLinkKey(link)

      if (!seenLinks.has(key)) {
        nextLinks.push(link)
        seenLinks.add(key)
        changed = true
      }

      changed = addNeighbor(nextAdjacency, link.source, link.target) || changed
    }

    if (!changed) {
      return
    }

    set({
      links: nextLinks,
      adjacency: nextAdjacency,
      graphRevision: state.graphRevision + 1,
    })
  },
  upsertInboundLinks: (incomingLinks) => {
    const state = get()
    const nextLinks = state.inboundLinks.slice()
    const nextAdjacency = cloneAdjacency(state.inboundAdjacency)
    const seenLinks = new Set(state.inboundLinks.map(getLinkKey))
    let changed = false

    for (const link of incomingLinks) {
      const key = getLinkKey(link)

      if (!seenLinks.has(key)) {
        nextLinks.push(link)
        seenLinks.add(key)
        changed = true
      }

      changed = addNeighbor(nextAdjacency, link.target, link.source) || changed
    }

    if (!changed) {
      return
    }

    set({
      inboundLinks: nextLinks,
      inboundAdjacency: nextAdjacency,
      inboundGraphRevision: state.inboundGraphRevision + 1,
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
      currentState.message === nextState.message &&
      currentState.phase === nextState.phase &&
      currentState.step === nextState.step &&
      currentState.totalSteps === nextState.totalSteps &&
      currentState.startedAt === nextState.startedAt &&
      currentState.updatedAt === nextState.updatedAt
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
  setGraphMaxNodes: (maxNodes) => {
    const state = get()
    const sanitizedMaxNodes = Math.max(1, Math.round(maxNodes))

    if (state.graphCaps.maxNodes === sanitizedMaxNodes) {
      return
    }

    set({
      graphCaps: {
        maxNodes: sanitizedMaxNodes,
        capReached: getNodeCount(state.nodes) >= sanitizedMaxNodes,
      },
    })
  },
  resetGraph: () => {
    const state = get()
    set({
      ...createInitialGraphSliceState(),
      graphCaps: {
        maxNodes: state.graphCaps.maxNodes,
        capReached: false,
      },
      graphRevision: state.graphRevision + 1,
      inboundGraphRevision: state.inboundGraphRevision + 1,
    })
  },
})
