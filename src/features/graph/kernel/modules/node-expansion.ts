import type { Filter } from 'nostr-tools'

import type {
  GraphLink,
  GraphNode,
  NodeExpansionPhase,
  NodeExpansionState,
} from '@/features/graph/app/store'
import type { ExpandNodeResult } from '@/features/graph/kernel/runtime'
import type { KernelContext } from '@/features/graph/kernel/modules/context'
import {
  NODE_EXPAND_CONNECT_TIMEOUT_MS,
  NODE_EXPAND_INBOUND_QUERY_LIMIT,
  NODE_EXPAND_PAGE_TIMEOUT_MS,
  NODE_EXPAND_RETRY_COUNT,
  NODE_EXPAND_STRAGGLER_GRACE_MS,
} from '@/features/graph/kernel/modules/constants'
import {
  collectInboundFollowerEvidence,
  collectRelayEvents,
  collectTargetedReciprocalFollowerEvidence,
  mergeInboundFollowerEvidence,
  selectLatestReplaceableEvent,
  selectLatestReplaceableEventsByPubkey,
  serializeContactListEvent,
} from '@/features/graph/kernel/modules/helpers'
import type { AnalysisModule } from '@/features/graph/kernel/modules/analysis'
import type { PersistenceModule } from '@/features/graph/kernel/modules/persistence'
import type { ProfileHydrationModule } from '@/features/graph/kernel/modules/profile-hydration'
import type { RootLoaderModule } from '@/features/graph/kernel/modules/root-loader'
import type { KeywordLayerModule } from '@/features/graph/kernel/modules/keyword-layer'
import type { ZapLayerModule } from '@/features/graph/kernel/modules/zap-layer'
import type { NodeDetailModule } from '@/features/graph/kernel/modules/node-detail'
import {
  buildContactListPartialMessage,
  buildDiscoveredMessage,
  buildExpandedStructureMessage,
} from '@/features/graph/kernel/modules/text-helpers'

const NODE_EXPANSION_TOTAL_STEPS = 4

export function createNodeExpansionModule(
  ctx: KernelContext,
  collaborators: {
    analysis: AnalysisModule
    persistence: PersistenceModule
    profileHydration: ProfileHydrationModule
    rootLoader: RootLoaderModule
    keywordLayer: KeywordLayerModule
    zapLayer: ZapLayerModule
    nodeDetail: NodeDetailModule
  },
) {
  const activeNodeExpansionRequests = new Map<string, Promise<ExpandNodeResult>>()

  const buildNodeExpansionState = (
    state: Partial<NodeExpansionState> & Pick<NodeExpansionState, 'status' | 'message'>,
  ): NodeExpansionState => ({
    phase: 'idle',
    step: null,
    totalSteps: null,
    startedAt: null,
    updatedAt: ctx.now(),
    ...state,
  })

  const setLoadingState = (
    pubkey: string,
    phase: Exclude<NodeExpansionPhase, 'idle'>,
    step: number,
    message: string,
    startedAt: number,
  ) => {
    ctx.store.getState().setNodeExpansionState(
      pubkey,
      buildNodeExpansionState({
        status: 'loading',
        message,
        phase,
        step,
        totalSteps: NODE_EXPANSION_TOTAL_STEPS,
        startedAt,
      }),
    )
  }

  const setTerminalState = (
    pubkey: string,
    status: Exclude<NodeExpansionState['status'], 'loading'>,
    message: string | null,
    startedAt: number | null = null,
  ) => {
    ctx.store.getState().setNodeExpansionState(
      pubkey,
      buildNodeExpansionState({
        status,
        message,
        startedAt,
      }),
    )
  }

  async function expandNode(pubkey: string): Promise<ExpandNodeResult> {
    const activeRequest = activeNodeExpansionRequests.get(pubkey)
    if (activeRequest) {
      return activeRequest
    }

    const request = expandNodeOnce(pubkey).finally(() => {
      activeNodeExpansionRequests.delete(pubkey)
    })
    activeNodeExpansionRequests.set(pubkey, request)

    return request
  }

  async function expandNodeOnce(pubkey: string): Promise<ExpandNodeResult> {
    const state = ctx.store.getState()

    if (!state.nodes[pubkey]) {
      setTerminalState(
        pubkey,
        'error',
        `Nodo ${pubkey.slice(0, 8)}... no existe en el grafo descubierto.`,
      )
      return {
        status: 'error',
        discoveredFollowCount: 0,
        rejectedPubkeys: [],
        message: `Nodo ${pubkey.slice(0, 8)}... no existe en el grafo descubierto.`,
      }
    }

    if (state.expandedNodePubkeys.has(pubkey)) {
      setTerminalState(
        pubkey,
        'ready',
        `Nodo ${pubkey.slice(0, 8)}... ya fue expandido.`,
      )
      return {
        status: 'ready',
        discoveredFollowCount: 0,
        rejectedPubkeys: [],
        message: `Nodo ${pubkey.slice(0, 8)}... ya fue expandido.`,
      }
    }

    if (state.graphCaps.capReached) {
      setTerminalState(
        pubkey,
        'error',
        `Cap de ${state.graphCaps.maxNodes} nodos alcanzado. No se puede expandir.`,
      )
      return {
        status: 'error',
        discoveredFollowCount: 0,
        rejectedPubkeys: [],
        message: `Cap de ${state.graphCaps.maxNodes} nodos alcanzado. No se puede expandir.`,
      }
    }

    const relayUrls =
      state.relayUrls.length > 0
        ? state.relayUrls.slice()
        : ctx.defaultRelayUrls.slice()

    const startedAt = ctx.now()
    setLoadingState(
      pubkey,
      'preparing',
      1,
      'Preparando expansion del vecindario seleccionado...',
      startedAt,
    )

    const previewState = state.nodeStructurePreviewStates?.[pubkey]
    const isRecentFallbackOrEmpty =
      previewState &&
      (previewState.status === 'partial' || previewState.status === 'empty') &&
      !collaborators.nodeDetail.getActivePreviewRequest(pubkey)

    if (isRecentFallbackOrEmpty) {
      setLoadingState(
        pubkey,
        'fetching-structure',
        2,
        'Revisando evidencia local para acelerar la expansion...',
        startedAt,
      )
      const cachedContactList = await ctx.repositories.contactLists.get(pubkey)
      if (cachedContactList) {
        const cachePreviewMessage =
          buildContactListPartialMessage({
            discoveredFollowCount: cachedContactList.follows.length,
            diagnostics: [],
            rejectedPubkeyCount: 0,
            loadedFromCache: true,
          }) ??
          buildDiscoveredMessage(cachedContactList.follows.length, true, true)

        setLoadingState(
          pubkey,
          'merging',
          4,
          'Integrando follows recuperados desde cache local...',
          startedAt,
        )
        return applyExpandedStructureEvidence(
          pubkey,
          cachedContactList.follows,
          [],
          {
            relayUrls: state.relayUrls,
            authoredHasPartialSignals: true,
            inboundHasPartialSignals: false,
            authoredDiagnostics: [],
            authoredLoadedFromCache: true,
            previewMessage:
              cachedContactList.follows.length > 0
                ? cachePreviewMessage
                : `Sin lista de follows descubierta para ${pubkey.slice(0, 8)}...`,
          },
        )
      }
    }

    const adapter = ctx.createRelayAdapter({
      relayUrls,
      connectTimeoutMs: NODE_EXPAND_CONNECT_TIMEOUT_MS,
      pageTimeoutMs: NODE_EXPAND_PAGE_TIMEOUT_MS,
      retryCount: NODE_EXPAND_RETRY_COUNT,
      stragglerGraceMs: NODE_EXPAND_STRAGGLER_GRACE_MS,
    })

    try {
      setLoadingState(
        pubkey,
        'fetching-structure',
        2,
        'Consultando relays activos para recuperar follows y followers...',
        startedAt,
      )
      const [contactListResult, inboundFollowerResult] = await Promise.all([
        collectRelayEvents(adapter, [{ authors: [pubkey], kinds: [3] } satisfies Filter]),
        collectRelayEvents(adapter, [
          {
            kinds: [3],
            '#p': [pubkey],
            limit: NODE_EXPAND_INBOUND_QUERY_LIMIT,
          } satisfies Filter & { '#p': string[] },
        ]),
      ])

      setLoadingState(
        pubkey,
        'correlating-followers',
        3,
        'Correlacionando followers entrantes y validando evidencia...',
        startedAt,
      )
      let inboundFollowerEvidence = await collectInboundFollowerEvidence(
        ctx.eventsWorker,
        selectLatestReplaceableEventsByPubkey(inboundFollowerResult.events),
        pubkey,
      )
      const latestContactListEvent = selectLatestReplaceableEvent(contactListResult.events)
      const augmentReciprocalEvidence = async (followPubkeys: readonly string[]) => {
        const targetedReciprocalFollowerEvidence =
          await collectTargetedReciprocalFollowerEvidence({
            adapter,
            eventsWorker: ctx.eventsWorker,
            followPubkeys,
            targetPubkey: pubkey,
          })

        inboundFollowerEvidence = mergeInboundFollowerEvidence(
          inboundFollowerEvidence,
          targetedReciprocalFollowerEvidence,
        )
      }

      if (!latestContactListEvent) {
        let cachedContactList = await ctx.repositories.contactLists.get(pubkey)
        if (!cachedContactList) {
          const activePreviewRequest = collaborators.nodeDetail.getActivePreviewRequest(pubkey)
          if (activePreviewRequest) {
            await activePreviewRequest
            cachedContactList = await ctx.repositories.contactLists.get(pubkey)
          }
        }

        if (cachedContactList) {
          await augmentReciprocalEvidence(cachedContactList.follows)
          const cachePreviewMessage =
            buildContactListPartialMessage({
              discoveredFollowCount: cachedContactList.follows.length,
              diagnostics: [],
              rejectedPubkeyCount: 0,
              loadedFromCache: true,
          }) ??
          buildDiscoveredMessage(cachedContactList.follows.length, true, true)
          setLoadingState(
            pubkey,
            'merging',
            4,
            'Integrando evidencia estructural recuperada...',
            startedAt,
          )
          return applyExpandedStructureEvidence(
            pubkey,
            cachedContactList.follows,
            inboundFollowerEvidence.followerPubkeys,
            {
              relayUrls,
              authoredHasPartialSignals: true,
              inboundHasPartialSignals:
                inboundFollowerEvidence.partial || inboundFollowerResult.error !== null,
              authoredDiagnostics: [],
              authoredLoadedFromCache: true,
              previewMessage:
                cachedContactList.follows.length > 0
                  ? cachePreviewMessage
                  : `Sin lista de follows descubierta para ${pubkey.slice(0, 8)}...`,
            },
          )
        }

        setLoadingState(
          pubkey,
          'merging',
          4,
          'Actualizando el grafo con la evidencia disponible...',
          startedAt,
        )
        return applyExpandedStructureEvidence(
          pubkey,
          [],
          inboundFollowerEvidence.followerPubkeys,
          {
            relayUrls,
            authoredHasPartialSignals: false,
            inboundHasPartialSignals:
              inboundFollowerEvidence.partial || inboundFollowerResult.error !== null,
            previewMessage: `Sin lista de follows descubierta para ${pubkey.slice(0, 8)}...`,
          },
        )
      }

      const parsedContactList = await ctx.eventsWorker.invoke('PARSE_CONTACT_LIST', {
        event: serializeContactListEvent(latestContactListEvent.event),
      })

      const cachedContactListBeforePersist =
        parsedContactList.followPubkeys.length === 0
          ? await ctx.repositories.contactLists.get(pubkey)
          : null

      await collaborators.persistence.persistContactListEvent(
        latestContactListEvent,
        parsedContactList,
      )

      if (
        parsedContactList.followPubkeys.length === 0 &&
        cachedContactListBeforePersist &&
        cachedContactListBeforePersist.follows.length > 0
      ) {
        await augmentReciprocalEvidence(cachedContactListBeforePersist.follows)
        const cachePreviewMessage =
          buildContactListPartialMessage({
            discoveredFollowCount: cachedContactListBeforePersist.follows.length,
            diagnostics: [],
            rejectedPubkeyCount: 0,
            loadedFromCache: true,
          }) ??
          buildDiscoveredMessage(
            cachedContactListBeforePersist.follows.length,
            true,
            true,
          )
        setLoadingState(
          pubkey,
          'merging',
          4,
          'Integrando evidencia estructural recuperada...',
          startedAt,
        )
        return applyExpandedStructureEvidence(
          pubkey,
          cachedContactListBeforePersist.follows,
          inboundFollowerEvidence.followerPubkeys,
          {
            relayUrls,
            authoredHasPartialSignals: true,
            inboundHasPartialSignals:
              inboundFollowerEvidence.partial || inboundFollowerResult.error !== null,
            authoredDiagnostics: [],
            authoredLoadedFromCache: true,
            previewMessage: cachePreviewMessage,
          },
        )
      }

      await augmentReciprocalEvidence(parsedContactList.followPubkeys)
      setLoadingState(
        pubkey,
        'merging',
        4,
        'Integrando nodos y conexiones al grafo...',
        startedAt,
      )
      return applyExpandedStructureEvidence(
        pubkey,
        parsedContactList.followPubkeys,
        inboundFollowerEvidence.followerPubkeys,
        {
          relayUrls,
          authoredHasPartialSignals: parsedContactList.diagnostics.length > 0,
          inboundHasPartialSignals:
            inboundFollowerEvidence.partial || inboundFollowerResult.error !== null,
          authoredDiagnostics: parsedContactList.diagnostics,
        },
      )
    } catch (error) {
      setTerminalState(
        pubkey,
        'error',
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : 'No se pudo expandir este nodo.',
        startedAt,
      )
      throw error
    } finally {
      adapter.close()
    }
  }

  function applyExpandedStructureEvidence(
    pubkey: string,
    followPubkeys: string[],
    inboundFollowerPubkeys: string[],
    options: {
      relayUrls: string[]
      authoredHasPartialSignals: boolean
      inboundHasPartialSignals: boolean
      authoredDiagnostics?: readonly { code: string }[]
      authoredLoadedFromCache?: boolean
      previewMessage?: string
    },
  ): ExpandNodeResult {
    const state = ctx.store.getState()
    const discoveredAt = ctx.now()
    const outboundNewNodes: GraphNode[] = followPubkeys
      .filter((followPubkey) => !state.nodes[followPubkey])
      .map((followPubkey) => ({
        pubkey: followPubkey,
        keywordHits: 0,
        discoveredAt,
        profileState: 'loading',
        source: 'follow' as const,
      }))

    const outboundNodeResult = state.upsertNodes(outboundNewNodes)
    const stateAfterOutboundNodes = ctx.store.getState()
    const inboundNewNodes: GraphNode[] = inboundFollowerPubkeys
      .filter((followerPubkey) => !stateAfterOutboundNodes.nodes[followerPubkey])
      .map((followerPubkey) => ({
        pubkey: followerPubkey,
        keywordHits: 0,
        discoveredAt,
        profileState: 'loading',
        source: 'inbound' as const,
      }))

    const inboundNodeResult = state.upsertNodes(inboundNewNodes)
    const freshState = ctx.store.getState()

    const newLinks: GraphLink[] = followPubkeys
      .filter(
        (followPubkey) =>
          outboundNodeResult.acceptedPubkeys.includes(followPubkey) ||
          freshState.nodes[followPubkey],
      )
      .map((followPubkey) => ({
        source: pubkey,
        target: followPubkey,
        relation: 'follow' as const,
      }))

    const newInboundLinks: GraphLink[] = inboundFollowerPubkeys
      .filter(
        (followerPubkey) =>
          inboundNodeResult.acceptedPubkeys.includes(followerPubkey) ||
          freshState.nodes[followerPubkey],
      )
      .filter((followerPubkey) => followerPubkey !== pubkey)
      .map((followerPubkey) => ({
        source: followerPubkey,
        target: pubkey,
        relation: 'inbound' as const,
      }))

    state.upsertLinks(newLinks)
    state.upsertInboundLinks(newInboundLinks)
    state.markNodeExpanded(pubkey)
    collaborators.analysis.schedule()

    const loadSequence = collaborators.rootLoader.getLoadSequence()
    void collaborators.profileHydration.hydrateNodeProfiles(
      [pubkey, ...outboundNodeResult.acceptedPubkeys, ...inboundNodeResult.acceptedPubkeys],
      options.relayUrls,
      () => collaborators.rootLoader.isStaleLoad(loadSequence),
      {
        persistProfileEvent: collaborators.persistence.persistProfileEvent,
      },
    ).catch((err) => {
      console.warn('Profile hydration failed after expansion:', err)
    })
    void collaborators.zapLayer.prefetchZapLayer(
      collaborators.zapLayer.getZapTargetPubkeys(),
      options.relayUrls,
    ).catch((err) => {
      console.warn('Zap layer prefetch failed after expansion:', err)
    })
    void collaborators.keywordLayer.prefetchKeywordCorpus(
      collaborators.keywordLayer.getKeywordCorpusTargetPubkeys(),
      options.relayUrls,
    ).catch((err) => {
      console.warn('Keyword corpus prefetch failed after expansion:', err)
    })

    const rejectedPubkeys = Array.from(
      new Set([
        ...outboundNodeResult.rejectedPubkeys,
        ...inboundNodeResult.rejectedPubkeys,
      ]),
    )
    const discoveredFollowerCount = newInboundLinks.length
    const hasPartialSignals =
      options.authoredHasPartialSignals ||
      options.inboundHasPartialSignals ||
      rejectedPubkeys.length > 0
    const status =
      newLinks.length + discoveredFollowerCount === 0
        ? 'empty'
        : hasPartialSignals
          ? 'partial'
          : 'ready'
    const acceptedNodesCount =
      outboundNodeResult.acceptedPubkeys.length +
      inboundNodeResult.acceptedPubkeys.length
    const expansionMessage = buildExpandedStructureMessage({
      pubkey,
      discoveredFollowCount: followPubkeys.length,
      discoveredFollowerCount,
      hasPartialSignals,
      authoredDiagnostics: options.authoredDiagnostics ?? [],
      rejectedPubkeyCount: rejectedPubkeys.length,
      maxGraphNodes: state.graphCaps.maxNodes,
      authoredLoadedFromCache: options.authoredLoadedFromCache,
      acceptedNodesCount,
    })

    state.setNodeStructurePreviewState(pubkey, {
      status:
        followPubkeys.length === 0
          ? 'empty'
          : options.authoredHasPartialSignals || options.authoredLoadedFromCache
            ? 'partial'
            : 'ready',
      message: options.previewMessage ?? null,
      discoveredFollowCount: followPubkeys.length,
    })
    setTerminalState(pubkey, status, expansionMessage)

    ctx.emitter.emit({
      type: 'node-expanded',
      pubkey,
      followCount: followPubkeys.length,
    })

    return {
      status,
      discoveredFollowCount: followPubkeys.length,
      rejectedPubkeys,
      message: expansionMessage,
    }
  }

  return {
    expandNode,
  }
}

export type NodeExpansionModule = ReturnType<typeof createNodeExpansionModule>
