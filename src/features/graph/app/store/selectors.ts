import type { AppStore } from '@/features/graph/app/store/types'

const DEFAULT_IDLE_NODE_EXPANSION_STATE = {
  status: 'idle' as const,
  message: null,
}

const DEFAULT_IDLE_NODE_STRUCTURE_PREVIEW_STATE = {
  status: 'idle' as const,
  message: null,
  discoveredFollowCount: null,
}

export const selectGraphSummary = (state: AppStore) => ({
  nodeCount: Object.keys(state.nodes).length,
  linkCount: state.links.length,
  rootNodePubkey: state.rootNodePubkey,
  maxNodes: state.graphCaps.maxNodes,
  capReached: state.graphCaps.capReached,
})

export const selectRelaySummary = (state: AppStore) => ({
  relayCount: state.relayUrls.length,
  relayOverrideStatus: state.relayOverrideStatus,
  isGraphStale: state.isGraphStale,
})

export const selectUiSummary = (state: AppStore) => ({
  selectedNodePubkey: state.selectedNodePubkey,
  activeLayer: state.activeLayer,
  openPanel: state.openPanel,
  currentKeyword: state.currentKeyword,
  rootLoadStatus: state.rootLoad.status,
  rootLoadMessage: state.rootLoad.message,
  rootLoadSource: state.rootLoad.loadedFrom,
})

export const selectZapLayerSummary = (state: AppStore) => ({
  status: state.zapLayer.status,
  edgeCount: state.zapLayer.edges.length,
  skippedReceipts: state.zapLayer.skippedReceipts,
  loadedFrom: state.zapLayer.loadedFrom,
  message: state.zapLayer.message,
})

const countFollowersDiscovered = (state: AppStore, pubkey: string) => {
  let count = 0

  for (const neighbors of Object.values(state.adjacency)) {
    if (neighbors.includes(pubkey)) {
      count += 1
    }
  }

  return count
}

const countMutualsDiscovered = (state: AppStore, pubkey: string) => {
  const targets = state.adjacency[pubkey] ?? []
  let count = 0

  for (const target of targets) {
    if (state.adjacency[target]?.includes(pubkey)) {
      count += 1
    }
  }

  return count
}

export const selectNodeDetailContext = (state: AppStore) => {
  const selectedNodePubkey =
    state.selectedNodePubkey && state.nodes[state.selectedNodePubkey]
      ? state.selectedNodePubkey
      : null
  const selectedNode = selectedNodePubkey ? state.nodes[selectedNodePubkey] : null
  const isExpanded = selectedNode
    ? state.expandedNodePubkeys.has(selectedNode.pubkey)
    : false
  const nodeStructurePreviewState =
    selectedNodePubkey === null
      ? null
      : state.nodeStructurePreviewStates[selectedNodePubkey] ??
        DEFAULT_IDLE_NODE_STRUCTURE_PREVIEW_STATE
  const hasLoadedFollowsDiscovered = Boolean(
    selectedNode &&
      (
        selectedNodePubkey === state.rootNodePubkey ||
        isExpanded ||
        nodeStructurePreviewState?.status === 'ready' ||
        nodeStructurePreviewState?.status === 'partial' ||
        nodeStructurePreviewState?.status === 'empty'
      ),
  )

  return {
    selectedNodePubkey,
    selectedNode,
    openPanel: state.openPanel,
    rootNodePubkey: state.rootNodePubkey,
    graphCapReached: state.graphCaps.capReached,
    graphMaxNodes: state.graphCaps.maxNodes,
    isGraphStale: state.isGraphStale,
    rootLoadStatus: state.rootLoad.status,
    rootLoadMessage: state.rootLoad.message,
    followsDiscovered:
      selectedNode === null
        ? 0
        : selectedNodePubkey === state.rootNodePubkey || isExpanded
          ? state.adjacency[selectedNode.pubkey]?.length ?? 0
          : nodeStructurePreviewState?.discoveredFollowCount ?? 0,
    followersDiscovered: selectedNode
      ? countFollowersDiscovered(state, selectedNode.pubkey)
      : 0,
    mutualsDiscovered: selectedNode
      ? countMutualsDiscovered(state, selectedNode.pubkey)
      : 0,
    hasLoadedFollowsDiscovered,
    isExpanded,
    nodeExpansionState:
      selectedNodePubkey === null
        ? null
        : state.nodeExpansionStates[selectedNodePubkey] ??
          DEFAULT_IDLE_NODE_EXPANSION_STATE,
    nodeStructurePreviewState,
  }
}

export const selectExportSummary = (state: AppStore) => ({
  selectedDeepUserCount: state.selectedDeepUserPubkeys.length,
  maxSelectedDeepUsers: state.maxSelectedDeepUsers,
  exportJobPhase: state.exportJob.phase,
  exportJobPercent: state.exportJob.percent,
})

export const selectRelayHealthData = (state: AppStore) => ({
  relayUrls: state.relayUrls,
  relayHealth: state.relayHealth,
})

export type CoverageRecoveryReason =
  | 'zero-follows'
  | 'relays-unavailable'
  | 'browser-offline'

export interface CoverageRecoveryState {
  shouldOfferRecovery: boolean
  reason: CoverageRecoveryReason | null
  rootFollowCount: number
  relaySummary: {
    totalCount: number
    connectedCount: number
    degradedCount: number
    offlineCount: number
    unavailableCount: number
  }
}

export const deriveCoverageRecovery = (input: {
  browserOnline: boolean
  relayUrls: readonly string[]
  relayHealth: AppStore['relayHealth']
  rootNodePubkey: string | null
  rootLoadStatus: AppStore['rootLoad']['status']
  links: AppStore['links']
}): CoverageRecoveryState => {
  const relaySummary = input.relayUrls.reduce(
    (summary, relayUrl) => {
      const status = input.relayHealth[relayUrl]?.status ?? 'unknown'

      if (status === 'connected') {
        summary.connectedCount += 1
      }

      if (status === 'degraded') {
        summary.degradedCount += 1
        summary.unavailableCount += 1
      }

      if (status === 'offline') {
        summary.offlineCount += 1
        summary.unavailableCount += 1
      }

      return summary
    },
    {
      totalCount: input.relayUrls.length,
      connectedCount: 0,
      degradedCount: 0,
      offlineCount: 0,
      unavailableCount: 0,
    },
  )

  if (
    input.rootNodePubkey === null ||
    input.rootLoadStatus === 'idle' ||
    input.rootLoadStatus === 'loading'
  ) {
    return {
      shouldOfferRecovery: false,
      reason: null,
      rootFollowCount: 0,
      relaySummary,
    }
  }

  const rootFollowCount = input.links.filter(
    (link) =>
      link.source === input.rootNodePubkey && link.relation === 'follow',
  ).length
  const allRelaysUnavailable =
    relaySummary.totalCount > 0 &&
    relaySummary.unavailableCount === relaySummary.totalCount

  const reason: CoverageRecoveryReason | null = !input.browserOnline
    ? 'browser-offline'
    : allRelaysUnavailable
      ? 'relays-unavailable'
      : rootFollowCount === 0
        ? 'zero-follows'
        : null

  return {
    shouldOfferRecovery: reason !== null,
    reason,
    rootFollowCount,
    relaySummary,
  }
}

export const selectCoverageRecovery = (
  state: AppStore,
  options: { browserOnline: boolean },
): CoverageRecoveryState =>
  deriveCoverageRecovery({
    browserOnline: options.browserOnline,
    relayUrls: state.relayUrls,
    relayHealth: state.relayHealth,
    rootNodePubkey: state.rootNodePubkey,
    rootLoadStatus: state.rootLoad.status,
    links: state.links,
  })

export const selectDegreeCounts = (state: AppStore) => {
  const degreeCounts: Record<string, number> = {}

  for (const [source, targets] of Object.entries(state.adjacency)) {
    degreeCounts[source] = targets.length

    for (const target of targets) {
      degreeCounts[target] = degreeCounts[target] ?? 0
    }
  }

  for (const pubkey of Object.keys(state.nodes)) {
    degreeCounts[pubkey] = degreeCounts[pubkey] ?? 0
  }

  return degreeCounts
}

export const selectMutualConnections = (state: AppStore) => {
  const mutualPairs = new Set<string>()

  for (const [source, targets] of Object.entries(state.adjacency)) {
    for (const target of targets) {
      if (state.adjacency[target]?.includes(source)) {
        mutualPairs.add([source, target].sort().join('<->'))
      }
    }
  }

  return Array.from(mutualPairs).sort()
}
