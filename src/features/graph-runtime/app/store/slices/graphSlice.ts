import type {
  AppStateCreator,
  GraphCaps,
  GraphLink,
  GraphNode,
  GraphNodePatch,
  NodeExpansionState,
  NodeStructurePreviewState,
  GraphSlice,
  ReplaceGraphSnapshotInput,
} from '@/features/graph-runtime/app/store/types'
import {
  summarizeAvatarPictureTransition,
  summarizeAvatarPubkeys,
  traceAvatarFlow,
  truncateAvatarPubkey,
} from '@/features/graph-runtime/debug/avatarTrace'
import { areGraphLinksEqual } from '@/features/graph-runtime/kernel/connections'

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
  | 'connectionsLinks'
  | 'connectionsLinksRevision'
  | 'graphRevision'
  | 'inboundGraphRevision'
  | 'nodeVisualRevision'
  | 'nodeDetailRevision'
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
  connectionsLinks: [],
  connectionsLinksRevision: 0,
  graphRevision: 0,
  inboundGraphRevision: 0,
  nodeVisualRevision: 0,
  nodeDetailRevision: 0,
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

const buildAdjacencyFromLinks = (links: readonly GraphLink[]) => {
  const adjacency: Record<string, string[]> = {}
  for (const link of links) {
    addNeighbor(adjacency, link.source, link.target)
  }
  return adjacency
}

const buildInboundAdjacencyFromLinks = (links: readonly GraphLink[]) => {
  const adjacency: Record<string, string[]> = {}
  for (const link of links) {
    addNeighbor(adjacency, link.target, link.source)
  }
  return adjacency
}

const mergeGraphNodePatch = (
  existingNode: GraphNodePatch,
  incomingNode: GraphNodePatch,
): GraphNodePatch => {
  const nextNode = { ...existingNode }
  for (const [key, value] of Object.entries(incomingNode) as Array<
    [keyof GraphNodePatch, GraphNodePatch[keyof GraphNodePatch]]
  >) {
    if (value !== undefined) {
      Object.assign(nextNode, { [key]: value })
    }
  }
  return nextNode
}

const hasGraphNodeVisualChange = (left: GraphNode, right: GraphNode) =>
  left.pubkey !== right.pubkey ||
  left.label !== right.label ||
  left.picture !== right.picture ||
  left.keywordHits !== right.keywordHits ||
  left.discoveredAt !== right.discoveredAt ||
  left.source !== right.source

const hasGraphNodeDetailChange = (left: GraphNode, right: GraphNode) =>
  left.about !== right.about ||
  left.nip05 !== right.nip05 ||
  left.lud16 !== right.lud16 ||
  left.profileEventId !== right.profileEventId ||
  left.profileFetchedAt !== right.profileFetchedAt ||
  left.profileSource !== right.profileSource ||
  left.profileState !== right.profileState

const hasGraphNodeChanged = (left: GraphNode, right: GraphNode) =>
  hasGraphNodeVisualChange(left, right) || hasGraphNodeDetailChange(left, right)

const isCompleteGraphNode = (
  patch: GraphNodePatch,
): patch is GraphNode => (
  typeof patch.keywordHits === 'number' &&
  'discoveredAt' in patch &&
  typeof patch.source === 'string'
)

const applyNodePatches = ({
  state,
  patches,
}: {
  state: Pick<
    GraphSlice,
    | 'nodes'
    | 'graphCaps'
    | 'graphRevision'
    | 'nodeVisualRevision'
    | 'nodeDetailRevision'
  >
  patches: readonly GraphNodePatch[]
}) => {
  const nextNodes = { ...state.nodes }
  const acceptedPubkeys: string[] = []
  const rejectedPubkeys: string[] = []
  let capReached = state.graphCaps.capReached
  let nodesChanged = false
  let capsChanged = false
  let structureChanged = false
  let visualChanged = false
  let detailChanged = false

  for (const patch of patches) {
    const existingNode = nextNodes[patch.pubkey]

    if (existingNode) {
      const nextNode = mergeGraphNodePatch(existingNode, patch) as GraphNode
      if (hasGraphNodeChanged(existingNode, nextNode)) {
        if ((existingNode.picture ?? null) !== (nextNode.picture ?? null)) {
          traceAvatarFlow('graphStore.upsertNode.pictureChanged', {
            pubkey: patch.pubkey,
            pubkeyShort: truncateAvatarPubkey(patch.pubkey),
            patchHasPicture: Object.prototype.hasOwnProperty.call(
              patch,
              'picture',
            ),
            previousProfileState: existingNode.profileState,
            nextProfileState: nextNode.profileState,
            previousProfileSource: existingNode.profileSource,
            nextProfileSource: nextNode.profileSource,
            previousNodeSource: existingNode.source,
            nextNodeSource: nextNode.source,
            ...summarizeAvatarPictureTransition(
              existingNode.picture,
              nextNode.picture,
            ),
          })
        }

        visualChanged =
          hasGraphNodeVisualChange(existingNode, nextNode) || visualChanged
        detailChanged =
          hasGraphNodeDetailChange(existingNode, nextNode) || detailChanged
        nextNodes[patch.pubkey] = nextNode
        nodesChanged = true
      }

      acceptedPubkeys.push(patch.pubkey)
      continue
    }

    if (!isCompleteGraphNode(patch)) {
      rejectedPubkeys.push(patch.pubkey)
      continue
    }

    if (getNodeCount(nextNodes) >= state.graphCaps.maxNodes) {
      if (!capReached) {
        capReached = true
        capsChanged = true
      }
      if (patch.picture) {
        traceAvatarFlow('graphStore.upsertNode.rejectedWithPicture', {
          pubkey: patch.pubkey,
          pubkeyShort: truncateAvatarPubkey(patch.pubkey),
          maxNodes: state.graphCaps.maxNodes,
          currentNodeCount: getNodeCount(nextNodes),
          ...summarizeAvatarPictureTransition(null, patch.picture),
        })
      }
      rejectedPubkeys.push(patch.pubkey)
      continue
    }

    if (patch.picture) {
      traceAvatarFlow('graphStore.upsertNode.createdWithPicture', {
        pubkey: patch.pubkey,
        pubkeyShort: truncateAvatarPubkey(patch.pubkey),
        profileState: patch.profileState,
        profileSource: patch.profileSource,
        nodeSource: patch.source,
        ...summarizeAvatarPictureTransition(null, patch.picture),
      })
    }

    nextNodes[patch.pubkey] = patch
    acceptedPubkeys.push(patch.pubkey)
    nodesChanged = true
    structureChanged = true
    visualChanged = true
  }

  return {
    nextNodes,
    acceptedPubkeys,
    rejectedPubkeys,
    capReached,
    capsChanged,
    nodesChanged,
    structureChanged,
    visualChanged,
    detailChanged,
  }
}

export const createGraphSlice: AppStateCreator<GraphSlice> = (set, get) => ({
  ...createInitialGraphSliceState(),
  setRootNodePubkey: (pubkey) => {
    set({ rootNodePubkey: pubkey })
  },
  upsertNodes: (incomingNodes) => {
    const state = get()
    const result = applyNodePatches({
      state,
      patches: incomingNodes,
    })

    if (result.nodesChanged || result.capsChanged) {
      set({
        nodes: result.nextNodes,
        graphRevision:
          state.graphRevision + (result.structureChanged ? 1 : 0),
        nodeVisualRevision:
          state.nodeVisualRevision + (result.visualChanged ? 1 : 0),
        nodeDetailRevision:
          state.nodeDetailRevision + (result.detailChanged ? 1 : 0),
        graphCaps: {
          ...state.graphCaps,
          capReached: result.capReached,
        },
      })
    }

    return {
      acceptedPubkeys: result.acceptedPubkeys,
      rejectedPubkeys: result.rejectedPubkeys,
    }
  },
  upsertNodePatches: (patches) => {
    const state = get()
    const mergedPatchesByPubkey = new Map<string, GraphNodePatch>()

    for (const patch of patches) {
      const previousPatch = mergedPatchesByPubkey.get(patch.pubkey)
      mergedPatchesByPubkey.set(
        patch.pubkey,
        previousPatch ? mergeGraphNodePatch(previousPatch, patch) : patch,
      )
    }

    const result = applyNodePatches({
      state,
      patches: Array.from(mergedPatchesByPubkey.values()),
    })

    if (result.nodesChanged || result.capsChanged) {
      set({
        nodes: result.nextNodes,
        graphRevision:
          state.graphRevision + (result.structureChanged ? 1 : 0),
        nodeVisualRevision:
          state.nodeVisualRevision + (result.visualChanged ? 1 : 0),
        nodeDetailRevision:
          state.nodeDetailRevision + (result.detailChanged ? 1 : 0),
        graphCaps: {
          ...state.graphCaps,
          capReached: result.capReached,
        },
      })
    }

    return {
      acceptedPubkeys: result.acceptedPubkeys,
      rejectedPubkeys: result.rejectedPubkeys,
    }
  },
  replaceGraphSnapshot: (snapshot: ReplaceGraphSnapshotInput) => {
    const state = get()
    const nextNodes: Record<string, GraphNode> = {}
    const acceptedPubkeys: string[] = []
    const rejectedPubkeys: string[] = []
    let capReached = false

    for (const node of snapshot.nodes) {
      if (getNodeCount(nextNodes) >= state.graphCaps.maxNodes) {
        capReached = true
        if (node.picture) {
          traceAvatarFlow('graphStore.upsertNode.rejectedWithPicture', {
            pubkey: node.pubkey,
            pubkeyShort: truncateAvatarPubkey(node.pubkey),
            maxNodes: state.graphCaps.maxNodes,
            currentNodeCount: getNodeCount(nextNodes),
            ...summarizeAvatarPictureTransition(null, node.picture),
          })
        }
        rejectedPubkeys.push(node.pubkey)
        continue
      }

      if (node.picture && !state.nodes[node.pubkey]?.picture) {
        traceAvatarFlow('graphStore.upsertNode.createdWithPicture', {
          pubkey: node.pubkey,
          pubkeyShort: truncateAvatarPubkey(node.pubkey),
          profileState: node.profileState,
          profileSource: node.profileSource,
          nodeSource: node.source,
          ...summarizeAvatarPictureTransition(null, node.picture),
        })
      }

      nextNodes[node.pubkey] = node
      acceptedPubkeys.push(node.pubkey)
    }

    const acceptedSet = new Set(acceptedPubkeys)
    const nextLinks = snapshot.links.filter(
      (link) => acceptedSet.has(link.source) && acceptedSet.has(link.target),
    )
    const nextInboundLinks = snapshot.inboundLinks.filter(
      (link) => acceptedSet.has(link.source) && acceptedSet.has(link.target),
    )

    set({
      nodes: nextNodes,
      links: nextLinks,
      adjacency: buildAdjacencyFromLinks(nextLinks),
      inboundLinks: nextInboundLinks,
      inboundAdjacency: buildInboundAdjacencyFromLinks(nextInboundLinks),
      connectionsLinks: [],
      connectionsLinksRevision: 0,
      graphRevision: state.graphRevision + 1,
      inboundGraphRevision: state.inboundGraphRevision + 1,
      nodeVisualRevision: state.nodeVisualRevision + 1,
      nodeDetailRevision: state.nodeDetailRevision + 1,
      rootNodePubkey: snapshot.rootNodePubkey,
      graphCaps: {
        ...state.graphCaps,
        capReached,
      },
      expandedNodePubkeys: new Set(),
      nodeExpansionStates: {},
      nodeStructurePreviewStates: {},
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

    const removedPicturePubkeys = Array.from(removeSet).filter(
      (pubkey) => Boolean(state.nodes[pubkey]?.picture),
    )
    if (removedPicturePubkeys.length > 0) {
      traceAvatarFlow('graphStore.removeNodes.removedPictures', {
        removed: summarizeAvatarPubkeys(removedPicturePubkeys),
      })
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
      nodeVisualRevision: state.nodeVisualRevision + 1,
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
  setConnectionsLinks: (links) => {
    const state = get()
    if (areGraphLinksEqual(state.connectionsLinks, links)) {
      return
    }

    set({
      connectionsLinks: links,
      connectionsLinksRevision: state.connectionsLinksRevision + 1,
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
      nodeVisualRevision: state.nodeVisualRevision + 1,
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
    const picturePubkeys = Object.values(state.nodes)
      .filter((node) => Boolean(node.picture))
      .map((node) => node.pubkey)
    if (picturePubkeys.length > 0) {
      traceAvatarFlow('graphStore.resetGraph.clearedPictures', {
        cleared: summarizeAvatarPubkeys(picturePubkeys),
      })
    }
    set({
      ...createInitialGraphSliceState(),
      graphCaps: {
        maxNodes: state.graphCaps.maxNodes,
        capReached: false,
      },
      graphRevision: state.graphRevision + 1,
      inboundGraphRevision: state.inboundGraphRevision + 1,
      nodeVisualRevision: state.nodeVisualRevision + 1,
      nodeDetailRevision: state.nodeDetailRevision + 1,
    })
  },
})
