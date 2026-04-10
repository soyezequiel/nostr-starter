import type { Filter } from 'nostr-tools'
import type { GraphLink, GraphNode } from '@/features/graph/app/store'
import type { RelayHealthSnapshot } from '@/features/graph/nostr'
import type {
  LoadRootOptions,
  LoadRootResult,
  NodeDetailProfile,
} from '@/features/graph/kernel/runtime'
import type { KernelContext, RelayAdapterInstance } from '@/features/graph/kernel/modules/context'
import {
  COVERAGE_RECOVERY_MESSAGE,
  MAX_SESSION_RELAYS,
  NODE_EXPAND_INBOUND_QUERY_LIMIT,
  ROOT_LOADING_MESSAGE,
} from '@/features/graph/kernel/modules/constants'
import {
  collectInboundFollowerEvidence,
  collectRelayEvents,
  collectTargetedReciprocalFollowerEvidence,
  mergeBoundedRelayUrlSets,
  mapProfileRecordToNodeProfile,
  mergeInboundFollowerEvidence,
  mergeRelayUrlSets,
  selectLatestReplaceableEvent,
  selectLatestReplaceableEventsByPubkey,
  serializeContactListEvent,
} from '@/features/graph/kernel/modules/helpers'
import type { AnalysisModule } from '@/features/graph/kernel/modules/analysis'
import type { PersistenceModule } from '@/features/graph/kernel/modules/persistence'
import type { ProfileHydrationModule } from '@/features/graph/kernel/modules/profile-hydration'
import type { RelaySessionModule } from '@/features/graph/kernel/modules/relay-session'
import type { KeywordLayerModule } from '@/features/graph/kernel/modules/keyword-layer'
import {
  buildContactListPartialMessage,
  buildDiscoveredMessage,
} from '@/features/graph/kernel/modules/text-helpers'
import { transitionRootLoad } from '@/features/graph/kernel/transitions/root-load'
interface CachedRootSnapshot {
  rootLabel: string | null
  rootProfile: NodeDetailProfile | null
  followPubkeys: string[]
  relayHints: string[]
}
interface RootGraphReplacementResult {
  discoveredFollowCount: number
  rejectedPubkeys: string[]
  visiblePubkeys: string[]
}
interface PreservedExpandedNeighborhood {
  nodePubkeys: string[]
  nodes: GraphNode[]
  links: GraphLink[]
  inboundLinks: GraphLink[]
  expandedNodePubkeys: string[]
}
interface ActiveLoadSession {
  loadId: number
  adapter: RelayAdapterInstance
  detachRelayHealth: () => void
}

const MAX_PROFILE_HYDRATION_RELAY_URLS = MAX_SESSION_RELAYS

export function createRootLoaderModule(
  ctx: KernelContext,
  collaborators: {
    analysis: AnalysisModule
    persistence: PersistenceModule
    profileHydration: ProfileHydrationModule
    relaySession: RelaySessionModule
    keywordLayer: KeywordLayerModule
    zapLayer: {
      cancelActiveZapLoad: () => void
      getZapTargetPubkeys: () => string[]
      prefetchZapLayer: (targetPubkeys: string[], relayUrls: string[]) => Promise<void>
    }
  },
) {
  let activeLoadSession: ActiveLoadSession | null = null
  let loadSequence = 0
  function setRootLoadState(
    action:
      | 'start'
      | 'cache-hit'
      | 'live-ready'
      | 'live-partial'
      | 'live-empty'
      | 'error'
      | 'cancel',
    patch: {
      message?: string | null
      loadedFrom?: 'none' | 'cache' | 'live'
    } = {},
  ): void {
    const state = ctx.store.getState()
    const nextStatus = transitionRootLoad(state.rootLoad.status, action)
    if (nextStatus === null) {
      console.warn(
        `Invalid transition: rootLoad ${state.rootLoad.status} -> ${action}`,
      )
      return
    }
    state.setRootLoadState({
      status: nextStatus,
      ...patch,
    })
  }
  function cancelActiveLoad(): void {
    if (!activeLoadSession) {
      return
    }
    activeLoadSession.detachRelayHealth()
    activeLoadSession.adapter.close()
    activeLoadSession = null
  }
  function isStaleLoad(loadId: number): boolean {
    return loadId !== loadSequence
  }
  function getLoadSequence(): number {
    return loadSequence
  }
  async function loadRoot(
    rootPubkey: string,
    options: LoadRootOptions = {},
  ): Promise<LoadRootResult> {
    if (activeLoadSession !== null) {
      setRootLoadState('cancel')
    }
    cancelActiveLoad()
    collaborators.zapLayer.cancelActiveZapLoad()
    collaborators.keywordLayer.cancelActiveKeywordLoad()
    const loadId = loadSequence + 1
    loadSequence = loadId
    const storeState = ctx.store.getState()
    const preserveExistingGraph = options.preserveExistingGraph ?? false
    const bootstrapRelayUrls = mergeRelayUrlSets(options.bootstrapRelayUrls)
    const baseRelayUrls = options.useDefaultRelays
      ? ctx.defaultRelayUrls.slice()
      : options.relayUrls?.slice() ??
        (storeState.relayUrls.length > 0
          ? storeState.relayUrls.slice()
          : ctx.defaultRelayUrls.slice())
    const relayUrls = mergeRelayUrlSets(bootstrapRelayUrls, baseRelayUrls)
    ctx.emitter.emit({ type: 'root-load-started', pubkey: rootPubkey })
    storeState.setRelayUrls(relayUrls)
    if (options.useDefaultRelays) {
      collaborators.relaySession.clearPendingOverride()
      storeState.resetRelayHealth(relayUrls)
      storeState.setRelayOverrideStatus('applied')
    }
    if (!preserveExistingGraph) {
      storeState.markGraphStale(false)
      storeState.setSelectedNodePubkey(null)
      storeState.setOpenPanel('overview')
      storeState.resetPathfinding()
    }
    setRootLoadState('start', {
      message: preserveExistingGraph
        ? 'Reintentando la carga con el nuevo set de relays sin borrar el grafo visible...'
        : ROOT_LOADING_MESSAGE,
      loadedFrom: 'none',
    })
    const cachedSnapshot = preserveExistingGraph
      ? { rootLabel: null, rootProfile: null, followPubkeys: [], relayHints: [] }
      : await loadCachedSnapshot(rootPubkey)
    if (isStaleLoad(loadId)) {
      return finalize(rootPubkey, createCancelledResult(relayUrls))
    }
    if (!preserveExistingGraph) {
      replaceRootGraph(
        rootPubkey,
        cachedSnapshot.followPubkeys,
        [],
        cachedSnapshot.rootProfile?.name ?? cachedSnapshot.rootLabel,
        cachedSnapshot.rootProfile,
      )
      if (cachedSnapshot.followPubkeys.length > 0) {
        setRootLoadState('cache-hit', {
          message: `Mostrando ${cachedSnapshot.followPubkeys.length} follows descubiertos desde cache mientras llegan datos live.`,
          loadedFrom: 'cache',
        })
      }
      // Iniciar hidratación de perfiles en paralelo con los relay fetches.
      // Esto permite que los perfiles cacheados en IDB se sincronicen al store
      // inmediatamente, sin esperar a que la carga de contact-list/inbound termine.
      const earlyProfileRelayUrls = mergeBoundedRelayUrlSets(
        MAX_PROFILE_HYDRATION_RELAY_URLS,
        relayUrls,
        cachedSnapshot.relayHints,
      )
      void collaborators.profileHydration.hydrateNodeProfiles(
        [rootPubkey, ...cachedSnapshot.followPubkeys],
        earlyProfileRelayUrls,
        () => isStaleLoad(loadId),
        {
          persistProfileEvent: collaborators.persistence.persistProfileEvent,
        },
      )
    }
    const adapter = ctx.createRelayAdapter({ relayUrls })
    const detachRelayHealth = adapter.subscribeToRelayHealth((relayHealth) => {
      if (isStaleLoad(loadId)) {
        return
      }
      collaborators.relaySession.publishRelayHealth(relayHealth)
    })
    activeLoadSession = {
      loadId,
      adapter,
      detachRelayHealth,
    }
    try {
      const [contactListResult, inboundFollowerResult] = await Promise.all([
        collectRelayEvents(adapter, [
          {
            authors: [rootPubkey],
            kinds: [3],
          } satisfies Filter,
        ]),
        collectRelayEvents(adapter, [
          {
            kinds: [3],
            '#p': [rootPubkey],
            limit: NODE_EXPAND_INBOUND_QUERY_LIMIT,
          } satisfies Filter & { '#p': string[] },
        ]),
      ])
      if (isStaleLoad(loadId)) {
        return finalize(rootPubkey, createCancelledResult(relayUrls))
      }
      let inboundFollowerEvidence = await collectInboundFollowerEvidence(
        ctx.eventsWorker,
        selectLatestReplaceableEventsByPubkey(inboundFollowerResult.events),
        rootPubkey,
      )
      if (isStaleLoad(loadId)) {
        return finalize(rootPubkey, createCancelledResult(relayUrls))
      }
      const relayHealth = collaborators.relaySession.resolveRelayHealthSnapshot(
        relayUrls,
        contactListResult,
        activeLoadSession?.adapter.getRelayHealth(),
      )
      const latestContactListEvent = selectLatestReplaceableEvent(
        contactListResult.events,
      )
      if (!latestContactListEvent) {
        const fallbackResult = buildMissingContactListResult(
          rootPubkey,
          cachedSnapshot,
          relayHealth,
          contactListResult.error,
          preserveExistingGraph,
        )
        if (!isStaleLoad(loadId)) {
          const action =
            fallbackResult.status === 'partial' ? 'live-partial' : 'error'
          setRootLoadState(action, {
            message: fallbackResult.message,
            loadedFrom: fallbackResult.loadedFrom,
          })
        }
          if (!preserveExistingGraph) {
            const profileHydrationRelayUrls = mergeBoundedRelayUrlSets(
              MAX_PROFILE_HYDRATION_RELAY_URLS,
              relayUrls,
              cachedSnapshot.relayHints,
            )
            void collaborators.profileHydration.hydrateNodeProfiles(
              [rootPubkey, ...cachedSnapshot.followPubkeys],
              profileHydrationRelayUrls,
              () => isStaleLoad(loadId),
              {
              persistProfileEvent: collaborators.persistence.persistProfileEvent,
            },
          )
          void collaborators.zapLayer.prefetchZapLayer(
            collaborators.zapLayer.getZapTargetPubkeys(),
            relayUrls,
          )
          void collaborators.keywordLayer.prefetchKeywordCorpus(
            collaborators.keywordLayer.getKeywordCorpusTargetPubkeys(),
            relayUrls,
          )
        }
        return finalize(rootPubkey, fallbackResult)
      }
      const parsedContactList = await ctx.eventsWorker.invoke(
        'PARSE_CONTACT_LIST',
        {
          event: serializeContactListEvent(latestContactListEvent.event),
        },
      )
      if (isStaleLoad(loadId)) {
        return finalize(rootPubkey, createCancelledResult(relayUrls))
      }
      let targetedReciprocalFollowerPartial = false
      try {
        const targetedReciprocalFollowerEvidence =
          await collectTargetedReciprocalFollowerEvidence({
            adapter,
            eventsWorker: ctx.eventsWorker,
            followPubkeys: parsedContactList.followPubkeys,
            targetPubkey: rootPubkey,
          })
        inboundFollowerEvidence = mergeInboundFollowerEvidence(
          inboundFollowerEvidence,
          targetedReciprocalFollowerEvidence,
        )
      } catch (error) {
        targetedReciprocalFollowerPartial = true
        console.warn(
          'Targeted reciprocal follower evidence failed during root load:',
          error,
        )
      }
      if (isStaleLoad(loadId)) {
        return finalize(rootPubkey, createCancelledResult(relayUrls))
      }
      await collaborators.persistence.persistContactListEvent(
        latestContactListEvent,
        parsedContactList,
      )
      const preservedExpandedNeighborhood =
        captureExpandedNeighborhood(rootPubkey)
      const replacementResult = replaceRootGraph(
        rootPubkey,
        parsedContactList.followPubkeys,
        inboundFollowerEvidence.followerPubkeys,
        cachedSnapshot.rootProfile?.name ?? cachedSnapshot.rootLabel,
        cachedSnapshot.rootProfile,
      )
      const restoredExpandedPubkeys = restoreExpandedNeighborhood(
        preservedExpandedNeighborhood,
      )
      const profileHydrationRelayUrls = mergeBoundedRelayUrlSets(
        MAX_PROFILE_HYDRATION_RELAY_URLS,
        relayUrls,
        parsedContactList.relayHints,
        cachedSnapshot.relayHints,
      )
      void collaborators.profileHydration.hydrateNodeProfiles(
        Array.from(
          new Set([
            ...replacementResult.visiblePubkeys,
            ...restoredExpandedPubkeys,
          ]),
        ),
        profileHydrationRelayUrls,
        () => isStaleLoad(loadId),
        {
          persistProfileEvent: collaborators.persistence.persistProfileEvent,
        },
      )
      void collaborators.zapLayer.prefetchZapLayer(
        collaborators.zapLayer.getZapTargetPubkeys(),
        relayUrls,
      )
      void collaborators.keywordLayer.prefetchKeywordCorpus(
        collaborators.keywordLayer.getKeywordCorpusTargetPubkeys(),
        relayUrls,
      )
      const hasPartialSignals =
        parsedContactList.diagnostics.length > 0 ||
        replacementResult.rejectedPubkeys.length > 0 ||
        inboundFollowerEvidence.partial ||
        inboundFollowerResult.error !== null ||
        targetedReciprocalFollowerPartial
      const status =
        replacementResult.discoveredFollowCount === 0
          ? 'empty'
          : hasPartialSignals
            ? 'partial'
            : 'ready'
      const message =
        status === 'partial'
          ? buildContactListPartialMessage({
              discoveredFollowCount: replacementResult.discoveredFollowCount,
              diagnostics: parsedContactList.diagnostics,
              rejectedPubkeyCount: replacementResult.rejectedPubkeys.length,
              maxGraphNodes: ctx.store.getState().graphCaps.maxNodes,
            }) ??
            buildDiscoveredMessage(
              replacementResult.discoveredFollowCount,
              hasPartialSignals,
            )
          : buildDiscoveredMessage(
              replacementResult.discoveredFollowCount,
              hasPartialSignals,
            )
      ctx.store.getState().markGraphStale(false)
      setRootLoadState(
        status === 'ready'
          ? 'live-ready'
          : status === 'partial'
            ? 'live-partial'
            : 'live-empty',
        {
          message,
          loadedFrom: 'live',
        },
      )
      return finalize(rootPubkey, {
        status,
        loadedFrom: 'live',
        discoveredFollowCount: replacementResult.discoveredFollowCount,
        message,
        relayHealth,
      })
    } finally {
      if (activeLoadSession?.loadId === loadId) {
        activeLoadSession.detachRelayHealth()
        activeLoadSession.adapter.close()
        activeLoadSession = null
      }
    }
  }
  function finalize(rootPubkey: string, result: LoadRootResult): LoadRootResult {
    ctx.emitter.emit({
      type: 'root-load-completed',
      pubkey: rootPubkey,
      status: result.status,
    })
    return result
  }
  async function loadCachedSnapshot(rootPubkey: string): Promise<CachedRootSnapshot> {
    const [contactList, profile] = await Promise.all([
      ctx.repositories.contactLists.get(rootPubkey),
      ctx.repositories.profiles.get(rootPubkey),
    ])
    return {
      rootLabel: profile?.name ?? null,
      rootProfile: profile ? mapProfileRecordToNodeProfile(profile) : null,
      followPubkeys: contactList?.follows ?? [],
      relayHints: contactList?.relayHints ?? [],
    }
  }
  function replaceRootGraph(
    rootPubkey: string,
    followPubkeys: string[],
    inboundFollowerPubkeys: string[],
    rootLabel: string | null,
    rootProfile: NodeDetailProfile | null = null,
  ): RootGraphReplacementResult {
    const state = ctx.store.getState()
    const previousNodes = state.nodes
    state.resetGraphAnalysis()
    state.resetGraph()
    state.resetZapLayer()
    state.resetKeywordLayer()
    state.setCurrentKeyword('')
    state.setSelectedNodePubkey(null)
    state.clearComparedNodes()
    if (state.activeLayer === 'keywords') {
      state.setActiveLayer('graph')
    }
    state.setRootNodePubkey(rootPubkey)
    const discoveredAt = ctx.now()
    const outboundFollowSet = new Set(followPubkeys)
    const resolveProfilePatch = (
      pubkey: string,
      fallbackProfile: NodeDetailProfile | null = null,
      fallbackLabel: string | null = null,
    ) => {
      const previousNode = previousNodes[pubkey]
      if (
        previousNode?.profileState === 'ready' &&
        (fallbackProfile === null ||
          (previousNode.profileFetchedAt ?? 0) >= fallbackProfile.fetchedAt)
      ) {
        return {
          label: previousNode.label,
          picture: previousNode.picture ?? null,
          about: previousNode.about ?? null,
          nip05: previousNode.nip05 ?? null,
          lud16: previousNode.lud16 ?? null,
          profileFetchedAt: previousNode.profileFetchedAt ?? null,
          profileEventId: previousNode.profileEventId ?? null,
          profileState: 'ready' as const,
        }
      }

      if (fallbackProfile) {
        return {
          label: fallbackProfile.name ?? fallbackLabel ?? undefined,
          picture: fallbackProfile.picture,
          about: fallbackProfile.about,
          nip05: fallbackProfile.nip05,
          lud16: fallbackProfile.lud16,
          profileFetchedAt: fallbackProfile.fetchedAt,
          profileEventId: fallbackProfile.eventId,
          profileState: 'ready' as const,
        }
      }

      if (previousNode?.profileState === 'missing') {
        return {
          picture: null,
          about: null,
          nip05: null,
          lud16: null,
          profileFetchedAt: null,
          profileEventId: null,
          profileState: 'missing' as const,
        }
      }

      return {
        label: fallbackLabel ?? undefined,
        profileState: 'loading' as const,
      }
    }
    const nodes: GraphNode[] = [
      {
        pubkey: rootPubkey,
        ...resolveProfilePatch(rootPubkey, rootProfile, rootLabel),
        keywordHits: 0,
        discoveredAt,
        source: 'root',
      },
      ...followPubkeys.map((pubkey) => ({
        pubkey,
        ...resolveProfilePatch(pubkey),
        keywordHits: 0,
        discoveredAt,
        source: 'follow' as const,
      })),
      ...inboundFollowerPubkeys
        .filter((pubkey) => !outboundFollowSet.has(pubkey))
        .map((pubkey) => ({
          pubkey,
          ...resolveProfilePatch(pubkey),
          keywordHits: 0,
          discoveredAt,
          source: 'inbound' as const,
        })),
    ]
    const nodeResult = state.upsertNodes(nodes)
    const acceptedFollowPubkeys = followPubkeys.filter((pubkey) =>
      nodeResult.acceptedPubkeys.includes(pubkey),
    )
    const acceptedInboundFollowerPubkeys = inboundFollowerPubkeys.filter(
      (pubkey) =>
        pubkey !== rootPubkey &&
        (nodeResult.acceptedPubkeys.includes(pubkey) || state.nodes[pubkey]),
    )
    state.upsertLinks(
      acceptedFollowPubkeys.map((pubkey) => ({
        source: rootPubkey,
        target: pubkey,
        relation: 'follow' as const,
      })),
    )
    state.upsertInboundLinks(
      acceptedInboundFollowerPubkeys.map((pubkey) => ({
        source: pubkey,
        target: rootPubkey,
        relation: 'inbound' as const,
      })),
    )
    state.setNodeStructurePreviewState(rootPubkey, {
      status: 'ready',
      message: null,
      discoveredFollowCount: acceptedFollowPubkeys.length,
    })
    state.setNodeExpansionState(rootPubkey, {
      status: 'ready',
      message: null,
      phase: 'idle',
      step: null,
      totalSteps: null,
      startedAt: null,
      updatedAt: ctx.now(),
    })
    collaborators.analysis.schedule()
    return {
      discoveredFollowCount: acceptedFollowPubkeys.length,
      rejectedPubkeys: nodeResult.rejectedPubkeys,
      visiblePubkeys: Array.from(
        new Set([
          rootPubkey,
          ...acceptedFollowPubkeys,
          ...acceptedInboundFollowerPubkeys,
        ]),
      ),
    }
  }
  function captureExpandedNeighborhood(
    rootPubkey: string,
  ): PreservedExpandedNeighborhood | null {
    const state = ctx.store.getState()
    if (state.rootNodePubkey !== rootPubkey) {
      return null
    }
    const expandedNodePubkeys = Array.from(state.expandedNodePubkeys)
    const links = state.links.filter((link) => link.source !== rootPubkey)
    const inboundLinks = state.inboundLinks.slice()
    const nodePubkeys = new Set<string>(expandedNodePubkeys)
    for (const link of links) {
      if (link.source !== rootPubkey) {
        nodePubkeys.add(link.source)
      }
      if (link.target !== rootPubkey) {
        nodePubkeys.add(link.target)
      }
    }
    for (const link of inboundLinks) {
      if (link.source !== rootPubkey) {
        nodePubkeys.add(link.source)
      }
      if (link.target !== rootPubkey) {
        nodePubkeys.add(link.target)
      }
    }
    if (nodePubkeys.size === 0) {
      return null
    }
    return {
      nodePubkeys: Array.from(nodePubkeys),
      nodes: Array.from(nodePubkeys)
        .map((pubkey) => state.nodes[pubkey])
        .filter((node): node is GraphNode => node !== undefined),
      links,
      inboundLinks,
      expandedNodePubkeys,
    }
  }
  function restoreExpandedNeighborhood(
    preservedExpandedNeighborhood: PreservedExpandedNeighborhood | null,
  ): string[] {
    if (!preservedExpandedNeighborhood) {
      return []
    }
    const state = ctx.store.getState()
    const missingNodes = preservedExpandedNeighborhood.nodes.filter(
      (node) => !state.nodes[node.pubkey],
    )
    if (missingNodes.length > 0) {
      state.upsertNodes(missingNodes)
    }
    if (preservedExpandedNeighborhood.links.length > 0) {
      state.upsertLinks(preservedExpandedNeighborhood.links)
    }
    if (preservedExpandedNeighborhood.inboundLinks.length > 0) {
      state.upsertInboundLinks(preservedExpandedNeighborhood.inboundLinks)
    }
    for (const pubkey of preservedExpandedNeighborhood.expandedNodePubkeys) {
      if (state.nodes[pubkey]) {
        state.markNodeExpanded(pubkey)
      }
    }
    if (
      missingNodes.length > 0 ||
      preservedExpandedNeighborhood.links.length > 0 ||
      preservedExpandedNeighborhood.inboundLinks.length > 0 ||
      preservedExpandedNeighborhood.expandedNodePubkeys.length > 0
    ) {
      collaborators.analysis.schedule()
    }
    return preservedExpandedNeighborhood.nodePubkeys.filter(
      (pubkey) => state.nodes[pubkey] !== undefined,
    )
  }
  function buildMissingContactListResult(
    rootPubkey: string,
    cachedSnapshot: CachedRootSnapshot,
    relayHealth: Record<string, RelayHealthSnapshot>,
    error: Error | null,
    preserveExistingGraph: boolean,
  ): LoadRootResult {
    if (preserveExistingGraph) {
      const staleFollowCount = countVisibleFollowsFromRoot(rootPubkey)
      if (staleFollowCount > 0) {
        return {
          status: 'partial',
          loadedFrom: 'none',
          discoveredFollowCount: staleFollowCount,
          message: `El nuevo set de relays no produjo evidencia suficiente. El grafo previo sigue visible como stale. ${COVERAGE_RECOVERY_MESSAGE}`,
          relayHealth,
        }
      }
    }
    if (cachedSnapshot.followPubkeys.length > 0) {
      return {
        status: 'partial',
        loadedFrom: 'cache',
        discoveredFollowCount: cachedSnapshot.followPubkeys.length,
        message: `Se mantuvo el cache porque no llegaron datos live. ${COVERAGE_RECOVERY_MESSAGE}`,
        relayHealth,
      }
    }
    return {
      status: 'error',
      loadedFrom: 'none',
      discoveredFollowCount: 0,
      message:
        error?.message
          ? `${error.message} ${COVERAGE_RECOVERY_MESSAGE}`
          : `No llegaron datos del root desde los relays configurados. ${COVERAGE_RECOVERY_MESSAGE}`,
      relayHealth,
    }
  }
  function countVisibleFollowsFromRoot(rootPubkey: string): number {
    return ctx.store
      .getState()
      .links.filter(
        (link) => link.source === rootPubkey && link.relation === 'follow',
      ).length
  }
  function createCancelledResult(relayUrls: string[]): LoadRootResult {
    const relayHealth =
      activeLoadSession?.adapter.getRelayHealth() ??
      Object.fromEntries(
        relayUrls.map((relayUrl) => [
          relayUrl,
          {
            url: relayUrl,
            status: 'offline',
            attempt: 0,
            activeSubscriptions: 0,
            consecutiveFailures: 0,
            lastChangeMs: ctx.now(),
          } satisfies RelayHealthSnapshot,
        ]),
      )
    return {
      status: 'partial',
      loadedFrom: 'none',
      discoveredFollowCount: 0,
      message: 'La carga anterior fue cancelada por una solicitud nueva.',
      relayHealth,
    }
  }

  return {
    loadRoot,
    cancelActiveLoad,
    isStaleLoad,
    getLoadSequence,
    replaceRootGraph,
  }
}
export type RootLoaderModule = ReturnType<typeof createRootLoaderModule>
