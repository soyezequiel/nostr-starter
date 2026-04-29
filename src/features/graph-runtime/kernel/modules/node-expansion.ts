import type { Filter } from 'nostr-tools'

import type {
  GraphLink,
  GraphNode,
  NodeExpansionPhase,
  NodeExpansionState,
} from '@/features/graph-runtime/app/store'
import type { RelayListRecord } from '@/features/graph-runtime/db/entities'
import type { ExpandNodeResult } from '@/features/graph-runtime/kernel/runtime'
import type { KernelContext, RelayAdapterInstance } from '@/features/graph-runtime/kernel/modules/context'
import {
  MAX_SESSION_RELAYS,
  NODE_EXPAND_INBOUND_QUERY_LIMIT,
  getKernelNetworkTuning,
} from '@/features/graph-runtime/kernel/modules/constants'
import {
  collectAdditionalPaginatedInboundFollowerEvents,
  collectInboundFollowerEvidence,
  collectRelayEvents,
  collectTargetedReciprocalFollowerEvidence,
  mergeBoundedRelayUrlSets,
  parseRelayListEvent,
  selectLatestReplaceableEvent,
  selectLatestReplaceableEventsByPubkey,
  serializeContactListEvent,
} from '@/features/graph-runtime/kernel/modules/helpers'
import type { AnalysisModule } from '@/features/graph-runtime/kernel/modules/analysis'
import type { PersistenceModule } from '@/features/graph-runtime/kernel/modules/persistence'
import type { ProfileHydrationModule } from '@/features/graph-runtime/kernel/modules/profile-hydration'
import type { RootLoaderModule } from '@/features/graph-runtime/kernel/modules/root-loader'
import type { ZapLayerModule } from '@/features/graph-runtime/kernel/modules/zap-layer'
import type { NodeDetailModule } from '@/features/graph-runtime/kernel/modules/node-detail'
import type { ParseContactListResult } from '@/features/graph-runtime/workers/events/contracts'
import {
  buildContactListPartialMessage,
  buildDiscoveredMessage,
  buildExpandedStructureMessage,
} from '@/features/graph-runtime/kernel/modules/text-helpers'
import {
  logTerminalWarning,
  summarizeHumanTerminalError,
} from '@/features/graph-runtime/debug/humanTerminalLog'
import type { RelayEventEnvelope } from '@/features/graph-runtime/nostr'

const NODE_EXPANSION_TOTAL_STEPS = 5
const MAX_PROFILE_HYDRATION_RELAY_URLS = MAX_SESSION_RELAYS
const NODE_RELAY_LIST_KIND = 10002

export function createNodeExpansionModule(
  ctx: KernelContext,
  collaborators: {
    analysis: AnalysisModule
    persistence: PersistenceModule
    profileHydration: ProfileHydrationModule
    rootLoader: RootLoaderModule
    zapLayer: ZapLayerModule
    nodeDetail: NodeDetailModule
    loadDirectInboundFollowerEvidence?: (input: {
      adapter: RelayAdapterInstance
      pubkey: string
    }) => Promise<{
      followerPubkeys: string[]
      partial: boolean
    }>
    loadTargetedReciprocalFollowerEvidence?: (
      input: Parameters<typeof collectTargetedReciprocalFollowerEvidence>[0],
    ) => ReturnType<typeof collectTargetedReciprocalFollowerEvidence>
  },
) {
  const activeNodeExpansionRequests = new Map<string, Promise<ExpandNodeResult>>()
  const activeInboundEnrichmentRequests = new Map<string, Promise<void>>()
  const activeReciprocalEnrichmentRequests = new Map<string, Promise<void>>()
  const loadDirectInboundFollowerEvidence =
    collaborators.loadDirectInboundFollowerEvidence ??
    (async ({ adapter, pubkey }) => {
      const tuning = getKernelNetworkTuning()
      const inboundCountResultsPromise = adapter
        .count([
          {
            kinds: [3],
            '#p': [pubkey],
          } satisfies Filter & { '#p': string[] },
        ], {
          timeoutMs: tuning.nodeExpandInboundCountTimeoutMs,
          idPrefix: `node-inbound:${pubkey.slice(0, 8)}`,
        })
        .catch(() => [])
      const inboundFollowerResult = await collectRelayEvents(adapter, [
        {
          kinds: [3],
          '#p': [pubkey],
          limit: NODE_EXPAND_INBOUND_QUERY_LIMIT,
        } satisfies Filter & { '#p': string[] },
      ], {
        hardTimeoutMs: tuning.nodeExpandHardTimeoutMs,
      })
      const inboundCountResults = await inboundCountResultsPromise

      const paginatedRelayUrlSet = new Set<string>()
      for (const relayUrl of Object.keys(
        inboundFollowerResult.summary?.relayHealth ?? {},
      )) {
        if (relayUrl) {
          paginatedRelayUrlSet.add(relayUrl)
        }
      }
      for (const result of inboundCountResults) {
        if (result.relayUrl) {
          paginatedRelayUrlSet.add(result.relayUrl)
        }
      }
      for (const envelope of inboundFollowerResult.events) {
        if (envelope.relayUrl) {
          paginatedRelayUrlSet.add(envelope.relayUrl)
        }
      }
      const paginatedInboundResult =
        await collectAdditionalPaginatedInboundFollowerEvents({
          adapter,
          countResults: inboundCountResults,
          relayUrls: Array.from(paginatedRelayUrlSet),
          seedEnvelopes: inboundFollowerResult.events,
          targetPubkey: pubkey,
        })

      const allEnvelopes = [
        ...inboundFollowerResult.events,
        ...paginatedInboundResult.events,
      ]
      const inboundFollowerEvidence = await collectInboundFollowerEvidence(
        ctx.eventsWorker,
        selectLatestReplaceableEventsByPubkey(allEnvelopes),
        pubkey,
      )

      return {
        followerPubkeys: inboundFollowerEvidence.followerPubkeys,
        partial:
          inboundFollowerEvidence.partial ||
          inboundFollowerResult.error !== null ||
          paginatedInboundResult.error !== null,
      }
    })
  const loadTargetedReciprocalFollowerEvidence =
    collaborators.loadTargetedReciprocalFollowerEvidence ??
    collectTargetedReciprocalFollowerEvidence

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

  const normalizeExpansionError = (error: unknown, fallbackMessage: string) =>
    error instanceof Error ? error : new Error(fallbackMessage)

  const getCachedContactList = async (targetPubkey: string) => {
    try {
      return await ctx.repositories.contactLists.get(targetPubkey)
    } catch (error) {
      logTerminalWarning('Expansion', 'No se pudo leer cache de follows', {
        nodo: targetPubkey.slice(0, 12),
        motivo: summarizeHumanTerminalError(error),
      })
      return null
    }
  }

  const getCachedRelayList = async (targetPubkey: string) => {
    try {
      return await ctx.repositories.relayLists.get(targetPubkey)
    } catch (error) {
      logTerminalWarning('Relays', 'No se pudo leer cache de relays del nodo', {
        nodo: targetPubkey.slice(0, 12),
        motivo: summarizeHumanTerminalError(error),
      })
      return null
    }
  }

  const relayUrlListsEqual = (
    currentRelayUrls: readonly string[],
    nextRelayUrls: readonly string[],
  ) =>
    currentRelayUrls.length === nextRelayUrls.length &&
    currentRelayUrls.every((relayUrl, index) => relayUrl === nextRelayUrls[index])

  const publishExpansionRelayUrls = (relayUrls: readonly string[]) => {
    const currentRelayUrls = ctx.store.getState().relayUrls
    if (!relayUrlListsEqual(currentRelayUrls, relayUrls)) {
      ctx.store.getState().setRelayUrls(relayUrls.slice())
    }
  }

  const mergeExpansionRelayHints = (
    ...relayHintGroups: Array<readonly string[] | undefined>
  ) => mergeBoundedRelayUrlSets(MAX_SESSION_RELAYS, ...relayHintGroups)

  const persistExpandedNodeRelayList = async (
    envelope: RelayEventEnvelope,
  ): Promise<RelayListRecord | null> => {
    if (envelope.event.kind !== NODE_RELAY_LIST_KIND) {
      return null
    }

    const parsedRelayList = parseRelayListEvent(envelope)
    if (parsedRelayList.relays.length === 0) {
      return null
    }

    try {
      return await ctx.repositories.relayLists.upsert({
        pubkey: envelope.event.pubkey,
        eventId: envelope.event.id,
        createdAt: envelope.event.created_at,
        fetchedAt: envelope.receivedAtMs,
        readRelays: parsedRelayList.readRelays,
        writeRelays: parsedRelayList.writeRelays,
        relays: parsedRelayList.relays,
      })
    } catch (error) {
      logTerminalWarning('Persistencia', 'No se pudo guardar relays del nodo', {
        nodo: envelope.event.pubkey.slice(0, 12),
        motivo: summarizeHumanTerminalError(error),
      })
      return {
        pubkey: envelope.event.pubkey,
        eventId: envelope.event.id,
        createdAt: envelope.event.created_at,
        fetchedAt: envelope.receivedAtMs,
        readRelays: parsedRelayList.readRelays,
        writeRelays: parsedRelayList.writeRelays,
        relays: parsedRelayList.relays,
      }
    }
  }

  const resolveExpandedNodeRelayListFromEvents = async (
    relayListEnvelopes: RelayEventEnvelope[],
    relayUrls: readonly string[],
  ): Promise<{
    relayUrls: string[]
    relayHints: string[]
  }> => {
    const latestRelayListEvent = selectLatestReplaceableEvent(relayListEnvelopes)

    if (!latestRelayListEvent) {
      return {
        relayUrls: relayUrls.slice(),
        relayHints: [],
      }
    }

    const relayList = await persistExpandedNodeRelayList(latestRelayListEvent)
    if (!relayList) {
      return {
        relayUrls: relayUrls.slice(),
        relayHints: [],
      }
    }

    return {
      relayUrls: mergeBoundedRelayUrlSets(
        MAX_SESSION_RELAYS,
        relayUrls,
        relayList.readRelays,
        relayList.writeRelays,
      ),
      relayHints: relayList.readRelays,
    }
  }

  const collectExpansionRelayEvents = async (
    adapter: RelayAdapterInstance,
    filters: Parameters<typeof collectRelayEvents>[1],
    options: Parameters<typeof collectRelayEvents>[2],
  ): ReturnType<typeof collectRelayEvents> => {
    try {
      return await collectRelayEvents(adapter, filters, options)
    } catch (error) {
      return {
        events: [],
        summary: null,
        error: normalizeExpansionError(
          error,
          'No se pudo consultar la estructura del nodo.',
        ),
      }
    }
  }

  const loadDirectInboundFollowerEvidenceSafely = async (input: {
    adapter: RelayAdapterInstance
    pubkey: string
  }) => {
    try {
      return await loadDirectInboundFollowerEvidence(input)
    } catch (error) {
      logTerminalWarning('Expansion', 'No se pudo obtener evidencia inbound', {
        nodo: input.pubkey.slice(0, 12),
        motivo: summarizeHumanTerminalError(error),
      })
      return {
        followerPubkeys: [],
        partial: true,
      }
    }
  }

  const buildRecoverableExpansionMessage = (pubkey: string, error: unknown) => {
    const detail =
      error instanceof Error && error.message.trim().length > 0
        ? ` ${error.message}`
        : ''
    return `Expansion parcial para ${pubkey.slice(0, 8)}...${detail}`
  }

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

  const applySupplementalInboundFollowerEvidence = (
    pubkey: string,
    inboundFollowerPubkeys: readonly string[],
    options: {
      relayUrls: readonly string[]
    },
  ) => {
    const uniqueInboundFollowerPubkeys = Array.from(
      new Set(
        inboundFollowerPubkeys.filter(
          (followerPubkey) => followerPubkey && followerPubkey !== pubkey,
        ),
      ),
    )

    if (uniqueInboundFollowerPubkeys.length === 0) {
      return
    }

    const state = ctx.store.getState()
    if (!state.nodes[pubkey] || !state.expandedNodePubkeys.has(pubkey)) {
      return
    }

    const discoveredAt = ctx.now()
    const inboundNewNodes: GraphNode[] = uniqueInboundFollowerPubkeys
      .filter((followerPubkey) => !state.nodes[followerPubkey])
      .map((followerPubkey) => ({
        pubkey: followerPubkey,
        keywordHits: 0,
        discoveredAt,
        profileState: 'loading',
        source: 'inbound' as const,
      }))

    const inboundNodeResult =
      inboundNewNodes.length > 0
        ? state.upsertNodes(inboundNewNodes)
        : { acceptedPubkeys: [], rejectedPubkeys: [] }

    const freshState = ctx.store.getState()
    if (!freshState.nodes[pubkey] || !freshState.expandedNodePubkeys.has(pubkey)) {
      return
    }

    const existingInboundFollowers = new Set(
      freshState.inboundAdjacency[pubkey] ?? [],
    )
    const supplementalInboundLinks: GraphLink[] = uniqueInboundFollowerPubkeys
      .filter((followerPubkey) => freshState.nodes[followerPubkey])
      .filter((followerPubkey) => !existingInboundFollowers.has(followerPubkey))
      .map((followerPubkey) => ({
        source: followerPubkey,
        target: pubkey,
        relation: 'inbound' as const,
      }))

    if (supplementalInboundLinks.length > 0) {
      freshState.upsertInboundLinks(supplementalInboundLinks)
    }

    if (
      inboundNodeResult.acceptedPubkeys.length === 0 &&
      supplementalInboundLinks.length === 0
    ) {
      return
    }

    collaborators.analysis.schedule()

    const loadSequence = collaborators.rootLoader.getLoadSequence()
    const profileHydrationRelayUrls = mergeBoundedRelayUrlSets(
      MAX_PROFILE_HYDRATION_RELAY_URLS,
      options.relayUrls,
    )

    if (inboundNodeResult.acceptedPubkeys.length > 0) {
      void collaborators.profileHydration.hydrateNodeProfiles(
        inboundNodeResult.acceptedPubkeys,
        profileHydrationRelayUrls,
        () => collaborators.rootLoader.isStaleLoad(loadSequence),
        {
          persistProfileEvent: collaborators.persistence.persistProfileEvent,
        },
      ).catch((error) => {
        logTerminalWarning('Perfiles', 'No se pudieron hidratar nodos reciprocos', {
          cantidad: inboundNodeResult.acceptedPubkeys.length,
          motivo: summarizeHumanTerminalError(error),
        })
      })
    }

    void collaborators.zapLayer.prefetchZapLayer(
      collaborators.zapLayer.getZapTargetPubkeys(),
      options.relayUrls.slice(),
    ).catch((error) => {
      logTerminalWarning('Zaps', 'No se pudo preparar capa de zaps', {
        etapa: 'enriquecimiento_reciproco',
        motivo: summarizeHumanTerminalError(error),
      })
    })
  }

  const scheduleReciprocalInboundEnrichment = (
    pubkey: string,
    followPubkeys: readonly string[],
    relayUrls: readonly string[],
    extraRelayHints: readonly string[] = [],
  ): Promise<void> => {
    const candidatePubkeys = Array.from(
      new Set(
        followPubkeys.filter(
          (followPubkey) => followPubkey && followPubkey !== pubkey,
        ),
      ),
    )

    if (
      candidatePubkeys.length === 0 ||
      activeReciprocalEnrichmentRequests.has(pubkey)
    ) {
      return activeReciprocalEnrichmentRequests.get(pubkey) || Promise.resolve()
    }

    const reciprocalRelayUrls = mergeBoundedRelayUrlSets(
      MAX_SESSION_RELAYS,
      relayUrls,
      extraRelayHints,
    )

    const tuning = getKernelNetworkTuning()
    let adapter: RelayAdapterInstance
    try {
      adapter = ctx.createRelayAdapter({
        relayUrls: reciprocalRelayUrls,
        connectTimeoutMs: tuning.nodeExpandConnectTimeoutMs,
        pageTimeoutMs: tuning.nodeExpandPageTimeoutMs,
        retryCount: tuning.nodeExpandRetryCount,
        stragglerGraceMs: tuning.nodeExpandStragglerGraceMs,
      })
    } catch (error) {
      logTerminalWarning('Expansion', 'No se pudo abrir consulta reciproca', {
        nodo: pubkey.slice(0, 12),
        motivo: summarizeHumanTerminalError(error),
      })
      return Promise.resolve()
    }

    const request = loadTargetedReciprocalFollowerEvidence({
      adapter,
      eventsWorker: ctx.eventsWorker,
      followPubkeys: candidatePubkeys,
      targetPubkey: pubkey,
    })
      .then((reciprocalEvidence) => {
        applySupplementalInboundFollowerEvidence(
          pubkey,
          reciprocalEvidence.followerPubkeys,
          {
            relayUrls: reciprocalRelayUrls,
          },
        )
      })
      .catch((error) => {
        logTerminalWarning('Expansion', 'No se pudo completar evidencia reciproca', {
          nodo: pubkey.slice(0, 12),
          motivo: summarizeHumanTerminalError(error),
        })
      })
      .finally(() => {
        adapter.close()
        activeReciprocalEnrichmentRequests.delete(pubkey)
      })

    activeReciprocalEnrichmentRequests.set(pubkey, request)
    return request
  }

  const scheduleDirectInboundEnrichment = (
    pubkey: string,
    relayUrls: readonly string[],
    extraRelayHints: readonly string[] = [],
  ): Promise<void> => {
    if (activeInboundEnrichmentRequests.has(pubkey)) {
      return activeInboundEnrichmentRequests.get(pubkey) || Promise.resolve()
    }

    const inboundRelayUrls = mergeBoundedRelayUrlSets(
      MAX_SESSION_RELAYS,
      relayUrls,
      extraRelayHints,
    )

    const tuning = getKernelNetworkTuning()
    let adapter: RelayAdapterInstance
    try {
      adapter = ctx.createRelayAdapter({
        relayUrls: inboundRelayUrls,
        connectTimeoutMs: tuning.nodeExpandConnectTimeoutMs,
        pageTimeoutMs: tuning.nodeExpandPageTimeoutMs,
        retryCount: tuning.nodeExpandRetryCount,
        stragglerGraceMs: tuning.nodeExpandStragglerGraceMs,
      })
    } catch (error) {
      logTerminalWarning('Expansion', 'No se pudo abrir consulta inbound', {
        nodo: pubkey.slice(0, 12),
        motivo: summarizeHumanTerminalError(error),
      })
      return Promise.resolve()
    }

    const request = loadDirectInboundFollowerEvidence({
      adapter,
      pubkey,
    })
      .then((inboundEvidence) => {
        applySupplementalInboundFollowerEvidence(
          pubkey,
          inboundEvidence.followerPubkeys,
          {
            relayUrls: inboundRelayUrls,
          },
        )
      })
      .catch((error) => {
        logTerminalWarning('Expansion', 'No se pudo completar evidencia inbound', {
          nodo: pubkey.slice(0, 12),
          motivo: summarizeHumanTerminalError(error),
        })
      })
      .finally(() => {
        adapter.close()
        activeInboundEnrichmentRequests.delete(pubkey)
      })

    activeInboundEnrichmentRequests.set(pubkey, request)
    return request
  }

  async function expandNode(pubkey: string, options?: { force?: boolean }): Promise<ExpandNodeResult> {
    const activeRequest = activeNodeExpansionRequests.get(pubkey)
    if (activeRequest) {
      return activeRequest
    }

    const request = expandNodeOnce(pubkey, options).finally(() => {
      activeNodeExpansionRequests.delete(pubkey)
    })
    activeNodeExpansionRequests.set(pubkey, request)

    return request
  }

  async function expandNodeOnce(pubkey: string, options?: { force?: boolean }): Promise<ExpandNodeResult> {
    const state = ctx.store.getState()

    const finalizeExpansion = async (
      result: ExpandNodeResult,
      startedAt: number,
      enrichmentPromises: Array<Promise<void> | undefined | false>,
    ) => {
      const promises = enrichmentPromises.filter((p): p is Promise<void> => Boolean(p))
      if (promises.length > 0) {
        // La expansion no termina de forma visible hasta integrar tambien la
        // evidencia inbound/reciproca tardia. Eso evita que el grafo se abra
        // en oleadas para una sola accion del usuario.
        setLoadingState(
          pubkey,
          'enriching',
          5,
          'Buscando conexiones entrantes y mutuas...',
          startedAt,
        )
        await Promise.allSettled(promises)
      }
      setTerminalState(pubkey, result.status, result.message, startedAt)
      return result
    }

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

    if (state.expandedNodePubkeys.has(pubkey) && !options?.force) {
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
      const capReachedMessage = `Cap de ${state.graphCaps.maxNodes} nodos alcanzado. No se puede expandir. Podés aumentar el límite en Ajustes > Render.`
      setTerminalState(
        pubkey,
        'error',
        capReachedMessage,
      )
      return {
        status: 'error',
        discoveredFollowCount: 0,
        rejectedPubkeys: [],
        message: capReachedMessage,
      }
    }

    let relayUrls =
      state.relayUrls.length > 0
        ? state.relayUrls.slice()
        : ctx.defaultRelayUrls.slice()
    let expandedNodeRelayHints: string[] = []
    const cachedRelayList = await getCachedRelayList(pubkey)
    if (cachedRelayList) {
      expandedNodeRelayHints = cachedRelayList.readRelays.slice()
      relayUrls = mergeBoundedRelayUrlSets(
        MAX_SESSION_RELAYS,
        relayUrls,
        cachedRelayList.readRelays,
        cachedRelayList.writeRelays,
      )
      publishExpansionRelayUrls(relayUrls)
    }

    const startedAt = ctx.now()
    setLoadingState(
      pubkey,
      'preparing',
      1,
      'Preparando expansion del vecindario seleccionado...',
      startedAt,
    )


    let adapter: RelayAdapterInstance | null = null

    const tuning = getKernelNetworkTuning()
    try {
      adapter = ctx.createRelayAdapter({
        relayUrls,
        connectTimeoutMs: tuning.nodeExpandConnectTimeoutMs,
        pageTimeoutMs: tuning.nodeExpandPageTimeoutMs,
        retryCount: tuning.nodeExpandRetryCount,
        stragglerGraceMs: tuning.nodeExpandStragglerGraceMs,
      })
      setLoadingState(
        pubkey,
        'fetching-structure',
        2,
        'Consultando relays activos y relays declarados del nodo...',
        startedAt,
      )
      // Optimización: pedimos kind:3 (contact list) y kind:10002 (relay list)
      // en una sola consulta REQ contra los relays iniciales. Esto elimina un
      // round-trip secuencial completo y evita reabrir el adapter (reconexión
      // a 7+ relays). Los timeouts no cambian: cada relay aún tiene el mismo
      // hardTimeoutMs para responder.
      const combinedStructureResult = await collectExpansionRelayEvents(adapter, [
        {
          authors: [pubkey],
          kinds: [3, NODE_RELAY_LIST_KIND],
        } satisfies Filter,
      ], {
        hardTimeoutMs: tuning.nodeExpandHardTimeoutMs,
      })
      const relayListEnvelopes = combinedStructureResult.events.filter(
        (envelope) => envelope.event.kind === NODE_RELAY_LIST_KIND,
      )
      const contactListEnvelopes = combinedStructureResult.events.filter(
        (envelope) => envelope.event.kind === 3,
      )
      const relayListResolution = await resolveExpandedNodeRelayListFromEvents(
        relayListEnvelopes,
        relayUrls,
      )
      expandedNodeRelayHints = mergeExpansionRelayHints(
        expandedNodeRelayHints,
        relayListResolution.relayHints,
      )
      const relayUrlsChanged = !relayUrlListsEqual(
        relayUrls,
        relayListResolution.relayUrls,
      )
      if (relayUrlsChanged) {
        relayUrls = relayListResolution.relayUrls
        publishExpansionRelayUrls(relayUrls)
      }
      // Fallback: si no obtuvimos contact list (kind:3) en el fetch combinado
      // pero el kind:10002 trajo relays personales nuevos, reintentamos kind:3
      // contra el set ampliado. Solo se paga el round-trip extra en el caso raro
      // de un nodo que sólo publica su contact list en relays propios.
      let supplementalContactEnvelopes: RelayEventEnvelope[] = []
      let supplementalError: Error | null = null
      if (contactListEnvelopes.length === 0 && relayUrlsChanged) {
        adapter.close()
        adapter = ctx.createRelayAdapter({
          relayUrls,
          connectTimeoutMs: tuning.nodeExpandConnectTimeoutMs,
          pageTimeoutMs: tuning.nodeExpandPageTimeoutMs,
          retryCount: tuning.nodeExpandRetryCount,
          stragglerGraceMs: tuning.nodeExpandStragglerGraceMs,
        })
        const supplementalResult = await collectExpansionRelayEvents(adapter, [
          { authors: [pubkey], kinds: [3] } satisfies Filter,
        ], {
          hardTimeoutMs: tuning.nodeExpandHardTimeoutMs,
        })
        supplementalContactEnvelopes = supplementalResult.events
        supplementalError = supplementalResult.error
      }
      const contactListResult = {
        events: [...contactListEnvelopes, ...supplementalContactEnvelopes],
        summary: combinedStructureResult.summary,
        error: combinedStructureResult.error ?? supplementalError,
      }
      const authoredRelayHadPartialSignals = contactListResult.error !== null

      setLoadingState(
        pubkey,
        'correlating-followers',
        3,
        'Correlacionando followers entrantes y validando evidencia...',
        startedAt,
      )
      const latestContactListEvent = selectLatestReplaceableEvent(contactListResult.events)

      if (!latestContactListEvent) {
        const cachedContactList = await getCachedContactList(pubkey)
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
            'Integrando evidencia estructural recuperada...',
            startedAt,
          )
          const result = applyExpandedStructureEvidence(
            pubkey,
            cachedContactList.follows,
            [],
            {
              relayUrls,
              relayHints: mergeExpansionRelayHints(
                expandedNodeRelayHints,
                cachedContactList.relayHints,
              ),
              authoredHasPartialSignals: true,
              inboundHasPartialSignals: false,
              authoredDiagnostics: [],
              authoredLoadedFromCache: true,
              previewMessage:
                cachedContactList.follows.length > 0
                  ? cachePreviewMessage
                  : `Sin lista de follows descubierta para ${pubkey.slice(0, 8)}...`,
              deferTerminalState: true,
            },
          )
          return finalizeExpansion(result, startedAt, [
            scheduleReciprocalInboundEnrichment(
              pubkey,
              cachedContactList.follows,
              relayUrls,
              cachedContactList.relayHints,
            ),
            scheduleDirectInboundEnrichment(
              pubkey,
              relayUrls,
              cachedContactList.relayHints,
            ),
          ])
        }

        const inboundFollowerEvidence = await loadDirectInboundFollowerEvidenceSafely({
          adapter,
          pubkey,
        })
        setLoadingState(
          pubkey,
          'merging',
          4,
          'Actualizando el grafo con la evidencia disponible...',
          startedAt,
        )
        const result = applyExpandedStructureEvidence(
          pubkey,
          [],
          inboundFollowerEvidence.followerPubkeys,
          {
            relayUrls,
            authoredHasPartialSignals: authoredRelayHadPartialSignals,
            inboundHasPartialSignals: inboundFollowerEvidence.partial,
            previewMessage: `Sin lista de follows descubierta para ${pubkey.slice(0, 8)}...`,
            deferTerminalState: true,
          },
        )
        return finalizeExpansion(result, startedAt, [])
      }

      let parsedContactList: ParseContactListResult
      try {
        parsedContactList = await ctx.eventsWorker.invoke('PARSE_CONTACT_LIST', {
          event: serializeContactListEvent(latestContactListEvent.event),
        })
      } catch (error) {
        logTerminalWarning('Expansion', 'No se pudo interpretar lista de follows', {
          nodo: pubkey.slice(0, 12),
          motivo: summarizeHumanTerminalError(error),
        })
        const cachedContactList = await getCachedContactList(pubkey)
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
            'Integrando evidencia estructural recuperada...',
            startedAt,
          )
          const result = applyExpandedStructureEvidence(
            pubkey,
            cachedContactList.follows,
            [],
            {
              relayUrls,
              relayHints: mergeExpansionRelayHints(
                expandedNodeRelayHints,
                cachedContactList.relayHints,
              ),
              authoredHasPartialSignals: true,
              inboundHasPartialSignals: false,
              authoredDiagnostics: [],
              authoredLoadedFromCache: true,
              previewMessage:
                cachedContactList.follows.length > 0
                  ? cachePreviewMessage
                  : `Sin lista de follows descubierta para ${pubkey.slice(0, 8)}...`,
              deferTerminalState: true,
            },
          )
          return finalizeExpansion(result, startedAt, [
            scheduleReciprocalInboundEnrichment(
              pubkey,
              cachedContactList.follows,
              relayUrls,
              cachedContactList.relayHints,
            ),
            scheduleDirectInboundEnrichment(
              pubkey,
              relayUrls,
              cachedContactList.relayHints,
            ),
          ])
        }

        const inboundFollowerEvidence =
          await loadDirectInboundFollowerEvidenceSafely({
            adapter,
            pubkey,
          })
        setLoadingState(
          pubkey,
          'merging',
          4,
          'Actualizando el grafo con la evidencia disponible...',
          startedAt,
        )
        const result = applyExpandedStructureEvidence(
          pubkey,
          [],
          inboundFollowerEvidence.followerPubkeys,
          {
            relayUrls,
            authoredHasPartialSignals: true,
            inboundHasPartialSignals: inboundFollowerEvidence.partial,
            previewMessage: `Sin lista de follows confiable para ${pubkey.slice(0, 8)}...`,
            deferTerminalState: true,
          },
        )
        return finalizeExpansion(result, startedAt, [])
      }

      const cachedContactListBeforePersist =
        parsedContactList.followPubkeys.length === 0
          ? await getCachedContactList(pubkey)
          : null

      let persistFailed = false
      try {
        await collaborators.persistence.persistContactListEvent(
          latestContactListEvent,
          parsedContactList,
        )
      } catch (error) {
        persistFailed = true
        logTerminalWarning('Persistencia', 'No se pudo guardar lista de follows', {
          nodo: pubkey.slice(0, 12),
          motivo: summarizeHumanTerminalError(error),
        })
      }

      if (
        parsedContactList.followPubkeys.length === 0 &&
        cachedContactListBeforePersist &&
        cachedContactListBeforePersist.follows.length > 0
      ) {
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
        const result = applyExpandedStructureEvidence(
          pubkey,
          cachedContactListBeforePersist.follows,
          [],
          {
            relayUrls,
            relayHints: mergeExpansionRelayHints(
              expandedNodeRelayHints,
              cachedContactListBeforePersist.relayHints,
            ),
            authoredHasPartialSignals: true,
            inboundHasPartialSignals: false,
            authoredDiagnostics: [],
            authoredLoadedFromCache: true,
            previewMessage: cachePreviewMessage,
            deferTerminalState: true,
          },
        )
        return finalizeExpansion(result, startedAt, [
          scheduleReciprocalInboundEnrichment(
            pubkey,
            cachedContactListBeforePersist.follows,
            relayUrls,
            cachedContactListBeforePersist.relayHints,
          ),
          scheduleDirectInboundEnrichment(
            pubkey,
            relayUrls,
            cachedContactListBeforePersist.relayHints,
          ),
        ])
      }

      setLoadingState(
        pubkey,
        'merging',
        4,
        'Integrando nodos y conexiones al grafo...',
        startedAt,
      )
      const result = applyExpandedStructureEvidence(
        pubkey,
        parsedContactList.followPubkeys,
        [],
        {
          relayUrls,
          relayHints: mergeExpansionRelayHints(
            expandedNodeRelayHints,
            parsedContactList.relayHints,
          ),
          authoredHasPartialSignals:
            authoredRelayHadPartialSignals ||
            persistFailed ||
            parsedContactList.diagnostics.length > 0,
          inboundHasPartialSignals: false,
          authoredDiagnostics: parsedContactList.diagnostics,
          deferTerminalState: true,
        },
      )
      return finalizeExpansion(result, startedAt, [
        scheduleDirectInboundEnrichment(
          pubkey,
          relayUrls,
          parsedContactList.relayHints,
        ),
        scheduleReciprocalInboundEnrichment(
          pubkey,
          parsedContactList.followPubkeys,
          relayUrls,
          parsedContactList.relayHints,
        ),
      ])
    } catch (error) {
      logTerminalWarning('Expansion', 'La expansion quedo parcial', {
        nodo: pubkey.slice(0, 12),
        motivo: summarizeHumanTerminalError(error),
      })
      const message = buildRecoverableExpansionMessage(pubkey, error)
      setTerminalState(pubkey, 'partial', message, startedAt)
      return {
        status: 'partial',
        discoveredFollowCount: 0,
        rejectedPubkeys: [],
        message,
      }
    } finally {
      adapter?.close()
    }
  }

  function applyExpandedStructureEvidence(
    pubkey: string,
    followPubkeys: string[],
    inboundFollowerPubkeys: string[],
    options: {
      relayUrls: string[]
      relayHints?: string[]
      authoredHasPartialSignals: boolean
      inboundHasPartialSignals: boolean
      authoredDiagnostics?: readonly { code: string }[]
      authoredLoadedFromCache?: boolean
      previewMessage?: string
      deferTerminalState?: boolean
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
    if (ctx.store.getState().selectedNodePubkey === pubkey) {
      ctx.store.getState().setSelectedNodePubkey(null)
      ctx.store.getState().setOpenPanel('overview')
    }
    collaborators.analysis.schedule()

    const loadSequence = collaborators.rootLoader.getLoadSequence()
    const profileHydrationRelayUrls = mergeBoundedRelayUrlSets(
      MAX_PROFILE_HYDRATION_RELAY_URLS,
      options.relayUrls,
      options.relayHints,
    )
    void collaborators.profileHydration.hydrateNodeProfiles(
      [pubkey, ...outboundNodeResult.acceptedPubkeys, ...inboundNodeResult.acceptedPubkeys],
      profileHydrationRelayUrls,
      () => collaborators.rootLoader.isStaleLoad(loadSequence),
      {
        persistProfileEvent: collaborators.persistence.persistProfileEvent,
      },
    ).catch((err) => {
      logTerminalWarning('Perfiles', 'No se pudieron hidratar nodos expandidos', {
        cantidad:
          1 +
          outboundNodeResult.acceptedPubkeys.length +
          inboundNodeResult.acceptedPubkeys.length,
        motivo: summarizeHumanTerminalError(err),
      })
    })
    void collaborators.zapLayer.prefetchZapLayer(
      collaborators.zapLayer.getZapTargetPubkeys(),
      options.relayUrls,
    ).catch((err) => {
      logTerminalWarning('Zaps', 'No se pudo preparar capa de zaps', {
        etapa: 'expansion',
        motivo: summarizeHumanTerminalError(err),
      })
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
      hasPartialSignals
        ? 'partial'
        : newLinks.length + discoveredFollowerCount === 0
          ? 'empty'
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
    if (!options.deferTerminalState) {
      setTerminalState(pubkey, status, expansionMessage)
    }

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
