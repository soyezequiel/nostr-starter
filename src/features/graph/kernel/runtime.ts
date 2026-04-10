import type { Event, Filter } from 'nostr-tools'
import { unstable_batchedUpdates } from 'react-dom'

import { createDiscoveredGraphAnalysisKey } from '@/features/graph/analysis/analysisKey'
import type {
  AppStore,
  AppStoreApi,
  GraphNode,
  GraphLink,
  KeywordMatch,
  RelayHealth,
  ZapLayerEdge,
  UiLayer,
  RelayHealthStatus as StoreRelayHealthStatus,
} from '@/features/graph/app/store'
import { deriveDirectedEvidence } from '@/features/graph/evidence/directedEvidence'
import { createNostrGraphDatabase, createRepositories, type NostrGraphRepositories } from '@/features/graph/db'
import type { NoteExtractRecord, ProfileRecord, ZapRecord } from '@/features/graph/db/entities'
import { appStore } from '@/features/graph/app/store/createAppStore'
import {
  createEventsWorkerGateway,
  createGraphWorkerGateway,
} from '@/features/graph/workers/browser'
import type {
  EventsWorkerActionMap,
  ParseContactListResult,
  ZapReceiptInput,
} from '@/features/graph/workers/events/contracts'
import type {
  AnalyzeDiscoveredGraphRequest,
  GraphWorkerActionMap,
} from '@/features/graph/workers/graph/contracts'
import type { WorkerClient } from '@/features/graph/workers/shared/runtime'
import {
  createRelayPoolAdapter,
  normalizeRelayUrl,
  type RelayAdapterOptions,
  type RelayEventEnvelope,
  type RelayHealthSnapshot,
  type RelayQueryFilter,
  type RelaySubscriptionSummary,
} from '@/features/graph/nostr'
import type {
  MultipartArchiveResult,
  ProfilePhotoArchiveResult,
} from '@/features/graph/export/types'

const DEFAULT_SESSION_RELAY_URLS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://offchain.pub',
  'wss://purplepag.es',
] as const
const MAX_SESSION_RELAYS = 8

const ROOT_LOADING_MESSAGE = 'Cargando vecindario descubierto del root...'
const COVERAGE_RECOVERY_MESSAGE =
  'Cambia relays o prueba una pubkey curada para recuperar cobertura.'
const ZAP_LAYER_LOADING_MESSAGE =
  'Buscando recibos de zap para los nodos explorados...'
const KEYWORD_LAYER_LOADING_MESSAGE =
  'Buscando notas recientes para la capa de intereses...'
const KEYWORD_LAYER_EMPTY_MESSAGE = 'Corpus vacío, no hay notas descubiertas'
const MAX_ZAP_RECEIPTS = 500
const KEYWORD_LOOKBACK_WINDOW_SEC = 30 * 24 * 60 * 60
const KEYWORD_BATCH_SIZE = 25
const KEYWORD_BATCH_CONCURRENCY = 2
const KEYWORD_MAX_NOTES_PER_PUBKEY = 5
const KEYWORD_FILTER_LIMIT_FACTOR = 4
const KEYWORD_EXTRACT_MAX_LENGTH = 500
const NODE_DETAIL_PREVIEW_CONNECT_TIMEOUT_MS = 3_000
const NODE_DETAIL_PREVIEW_PAGE_TIMEOUT_MS = 4_500
const NODE_DETAIL_PREVIEW_RETRY_COUNT = 1
const NODE_DETAIL_PREVIEW_STRAGGLER_GRACE_MS = 250
const NODE_EXPAND_CONNECT_TIMEOUT_MS = 1_200
const NODE_EXPAND_PAGE_TIMEOUT_MS = 1_500
const NODE_EXPAND_RETRY_COUNT = 0
const NODE_EXPAND_STRAGGLER_GRACE_MS = 150
const NODE_EXPAND_INBOUND_QUERY_LIMIT = 250
const NODE_EXPAND_INBOUND_PARSE_CONCURRENCY = 8
const DISCOVERED_GRAPH_ANALYSIS_LOADING_MESSAGE =
  'Analizando grupos detectados en el vecindario descubierto...'
const NODE_PROFILE_HYDRATION_BATCH_SIZE = 50
const NODE_PROFILE_HYDRATION_BATCH_CONCURRENCY = 2
const NODE_PROFILE_PERSIST_CONCURRENCY = 8
const RELAY_HEALTH_FLUSH_DELAY_MS = 32

export interface LoadRootResult {
  status: 'ready' | 'partial' | 'empty' | 'error'
  loadedFrom: 'cache' | 'live' | 'none'
  discoveredFollowCount: number
  message: string
  relayHealth: Record<string, RelayHealthSnapshot>
}

export interface ReconfigureRelaysInput {
  relayUrls?: string[]
  restoreDefault?: boolean
}

export interface ReconfigureRelaysResult {
  status: 'applied' | 'revertible' | 'invalid'
  relayUrls: string[]
  message: string
  diagnostics: string[]
  isGraphStale: boolean
  relayHealth: Record<string, RelayHealthSnapshot>
}

export interface ExpandNodeResult {
  status: 'ready' | 'partial' | 'empty' | 'error'
  discoveredFollowCount: number
  rejectedPubkeys: string[]
  message: string
}

export interface SearchKeywordResult {
  keyword: string
  tokens: string[]
  totalHits: number
  nodeHits: Record<string, number>
  matchesByPubkey: Record<string, KeywordMatch[]>
}

export interface FindPathResult {
  path: string[] | null
  visitedCount: number
  algorithm: 'bfs' | 'dijkstra'
}

export interface ToggleLayerResult {
  previousLayer: UiLayer
  activeLayer: UiLayer
  message: string | null
}

export interface SelectNodeResult {
  previousPubkey: string | null
  selectedPubkey: string | null
}

export interface NodeDetailProfile {
  eventId: string
  fetchedAt: number
  name: string | null
  about: string | null
  picture: string | null
  nip05: string | null
  lud16: string | null
}

interface CachedRootSnapshot {
  rootLabel: string | null
  rootProfile: NodeDetailProfile | null
  followPubkeys: string[]
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

interface InboundFollowerEvidence {
  followerPubkeys: string[]
  partial: boolean
}

export interface LoadRootOptions {
  preserveExistingGraph?: boolean
  useDefaultRelays?: boolean
  relayUrls?: string[]
}

interface RelayCollectionResult {
  events: RelayEventEnvelope[]
  summary: RelaySubscriptionSummary | null
  error: Error | null
}

type RelayAdapterInstance = Pick<
  ReturnType<typeof createRelayPoolAdapter>,
  'subscribe' | 'getRelayHealth' | 'subscribeToRelayHealth' | 'close'
>

export interface AppKernelDependencies {
  store: AppStoreApi
  repositories: NostrGraphRepositories
  eventsWorker: WorkerClient<EventsWorkerActionMap>
  graphWorker: WorkerClient<GraphWorkerActionMap>
  createRelayAdapter: (options: RelayAdapterOptions) => RelayAdapterInstance
  defaultRelayUrls?: string[]
  now?: () => number
}

interface ActiveLoadSession {
  loadId: number
  adapter: RelayAdapterInstance
  detachRelayHealth: () => void
}

interface ActiveZapSession {
  requestId: number
  adapter: RelayAdapterInstance
}

interface ActiveKeywordSession {
  requestId: number
  adapter: RelayAdapterInstance
}

interface MergedRelayEventEnvelope {
  event: Event
  relayUrls: string[]
  relayUrl: string
  receivedAtMs: number
}

interface RelayOverrideSnapshot {
  relayUrls: string[]
  rootPubkey: string | null
}

export class AppKernel {
  private readonly store
  private readonly repositories
  private readonly eventsWorker
  private readonly graphWorker
  private readonly createRelayAdapter
  private readonly defaultRelayUrls
  private readonly now
  private activeLoadSession: ActiveLoadSession | null = null
  private activeZapSession: ActiveZapSession | null = null
  private activeKeywordSession: ActiveKeywordSession | null = null
  private pendingRelayOverride: RelayOverrideSnapshot | null = null
  private readonly activeNodeStructurePreviewRequests = new Map<
    string,
    Promise<void>
  >()
  private readonly activeNodeExpansionRequests = new Map<
    string,
    Promise<ExpandNodeResult>
  >()
  private analysisFlushScheduled = false
  private analysisInFlight = false
  private keywordCorpusInFlight = false
  private analysisScheduleVersion = 0
  private loadSequence = 0
  private zapRequestSequence = 0
  private keywordRequestSequence = 0
  private keywordSearchSequence = 0
  private pendingRelayHealthFlush: ReturnType<typeof setTimeout> | null = null
  private pendingRelayHealthSnapshot: Record<string, RelayHealthSnapshot> | null =
    null

  public constructor(dependencies: AppKernelDependencies) {
    this.store = dependencies.store
    this.repositories = dependencies.repositories
    this.eventsWorker = dependencies.eventsWorker
    this.graphWorker = dependencies.graphWorker
    this.createRelayAdapter = dependencies.createRelayAdapter
    this.defaultRelayUrls =
      dependencies.defaultRelayUrls?.slice() ?? [...DEFAULT_SESSION_RELAY_URLS]
    this.now = dependencies.now ?? (() => Date.now())
  }

  public async loadRoot(
    rootPubkey: string,
    options: LoadRootOptions = {},
  ): Promise<LoadRootResult> {
    this.cancelActiveLoad()
    this.cancelActiveZapLoad()
    this.cancelActiveKeywordLoad()

    const loadId = this.loadSequence + 1
    this.loadSequence = loadId

    const storeState = this.store.getState()
    const preserveExistingGraph = options.preserveExistingGraph ?? false
    const relayUrls = options.useDefaultRelays
      ? this.defaultRelayUrls.slice()
      : options.relayUrls?.slice() ??
        (storeState.relayUrls.length > 0
          ? storeState.relayUrls.slice()
          : this.defaultRelayUrls.slice())

    storeState.setRelayUrls(relayUrls)
    if (options.useDefaultRelays) {
      this.pendingRelayOverride = null
      storeState.resetRelayHealth(relayUrls)
      storeState.setRelayOverrideStatus('applied')
    }
    if (!preserveExistingGraph) {
      storeState.markGraphStale(false)
      storeState.setSelectedNodePubkey(null)
      storeState.setOpenPanel('overview')
      storeState.resetPathfinding()
    }
    storeState.setRootLoadState({
      status: 'loading',
      message: preserveExistingGraph
        ? 'Reintentando la carga con el nuevo set de relays sin borrar el grafo visible...'
        : ROOT_LOADING_MESSAGE,
      loadedFrom: 'none',
    })

    const cachedSnapshot = preserveExistingGraph
      ? { rootLabel: null, rootProfile: null, followPubkeys: [] }
      : await this.loadCachedSnapshot(rootPubkey)
    if (this.isStaleLoad(loadId)) {
      return this.createCancelledResult(relayUrls)
    }

    if (!preserveExistingGraph) {
      this.replaceRootGraph(
        rootPubkey,
        cachedSnapshot.followPubkeys,
        cachedSnapshot.rootProfile?.name ?? cachedSnapshot.rootLabel,
        cachedSnapshot.rootProfile,
      )

      if (cachedSnapshot.followPubkeys.length > 0) {
        this.store.getState().setRootLoadState({
          status: 'partial',
          message: `Mostrando ${cachedSnapshot.followPubkeys.length} follows descubiertos desde cache mientras llegan datos live.`,
          loadedFrom: 'cache',
        })
      }
    }

    const adapter = this.createRelayAdapter({
      relayUrls,
    })
    const detachRelayHealth = adapter.subscribeToRelayHealth((relayHealth) => {
      if (this.isStaleLoad(loadId)) {
        return
      }

      this.publishRelayHealth(relayHealth)
    })

    this.activeLoadSession = {
      loadId,
      adapter,
      detachRelayHealth,
    }

    try {
      const contactListResult = await collectRelayEvents(adapter, [
        {
          authors: [rootPubkey],
          kinds: [3],
        } satisfies Filter,
      ])

      if (this.isStaleLoad(loadId)) {
        return this.createCancelledResult(relayUrls)
      }

      const relayHealth = this.resolveRelayHealthSnapshot(relayUrls, contactListResult)

      const latestContactListEvent = selectLatestReplaceableEvent(contactListResult.events)
      if (!latestContactListEvent) {
        const fallbackResult = this.buildMissingContactListResult(
          rootPubkey,
          cachedSnapshot,
          relayHealth,
          contactListResult.error,
          preserveExistingGraph,
        )
        if (!this.isStaleLoad(loadId)) {
          this.store.getState().setRootLoadState({
            status: fallbackResult.status,
            message: fallbackResult.message,
            loadedFrom: fallbackResult.loadedFrom,
          })
        }

        if (!preserveExistingGraph) {
          void this.hydrateNodeProfiles(
            [rootPubkey, ...cachedSnapshot.followPubkeys],
            relayUrls,
            loadId,
          )
          void this.prefetchZapLayer(this.getZapTargetPubkeys(), relayUrls)
          void this.prefetchKeywordCorpus(
            this.getKeywordCorpusTargetPubkeys(),
            relayUrls,
          )
        }

        return fallbackResult
      }

      const parsedContactList = await this.eventsWorker.invoke(
        'PARSE_CONTACT_LIST',
        {
          event: serializeContactListEvent(latestContactListEvent.event),
        },
      )

      if (this.isStaleLoad(loadId)) {
        return this.createCancelledResult(relayUrls)
      }

      await this.persistContactListEvent(latestContactListEvent, parsedContactList)

      const preservedExpandedNeighborhood =
        this.captureExpandedNeighborhood(rootPubkey)
      const replacementResult = this.replaceRootGraph(
        rootPubkey,
        parsedContactList.followPubkeys,
        cachedSnapshot.rootProfile?.name ?? cachedSnapshot.rootLabel,
        cachedSnapshot.rootProfile,
      )
      const restoredExpandedPubkeys = this.restoreExpandedNeighborhood(
        preservedExpandedNeighborhood,
      )
      void this.hydrateNodeProfiles(
        Array.from(
          new Set([
            ...replacementResult.visiblePubkeys,
            ...restoredExpandedPubkeys,
          ]),
        ),
        relayUrls,
        loadId,
      )
      void this.prefetchZapLayer(this.getZapTargetPubkeys(), relayUrls)
      void this.prefetchKeywordCorpus(this.getKeywordCorpusTargetPubkeys(), relayUrls)

      const hasPartialSignals =
        parsedContactList.diagnostics.length > 0 ||
        replacementResult.rejectedPubkeys.length > 0
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
            maxGraphNodes: this.store.getState().graphCaps.maxNodes,
          }) ??
          buildDiscoveredMessage(
            replacementResult.discoveredFollowCount,
            hasPartialSignals,
          )
          : buildDiscoveredMessage(
            replacementResult.discoveredFollowCount,
            hasPartialSignals,
          )
      this.store.getState().markGraphStale(false)

      this.store.getState().setRootLoadState({
        status,
        message,
        loadedFrom: 'live',
      })

      return {
        status,
        loadedFrom: 'live',
        discoveredFollowCount: replacementResult.discoveredFollowCount,
        message,
        relayHealth,
      }
    } finally {
      if (this.activeLoadSession?.loadId === loadId) {
        this.activeLoadSession.detachRelayHealth()
        this.activeLoadSession.adapter.close()
        this.activeLoadSession = null
      }
    }
  }

  public async expandNode(pubkey: string): Promise<ExpandNodeResult> {
    const activeRequest = this.activeNodeExpansionRequests.get(pubkey)
    if (activeRequest) {
      return activeRequest
    }

    const request = this.expandNodeOnce(pubkey).finally(() => {
      this.activeNodeExpansionRequests.delete(pubkey)
    })
    this.activeNodeExpansionRequests.set(pubkey, request)

    return request
  }

  private async expandNodeOnce(pubkey: string): Promise<ExpandNodeResult> {
    const state = this.store.getState()

    if (!state.nodes[pubkey]) {
      state.setNodeExpansionState(pubkey, {
        status: 'error',
        message: `Nodo ${pubkey.slice(0, 8)}... no existe en el grafo descubierto.`,
      })
      return {
        status: 'error',
        discoveredFollowCount: 0,
        rejectedPubkeys: [],
        message: `Nodo ${pubkey.slice(0, 8)}... no existe en el grafo descubierto.`,
      }
    }

    if (state.expandedNodePubkeys.has(pubkey)) {
      state.setNodeExpansionState(pubkey, {
        status: 'ready',
        message: `Nodo ${pubkey.slice(0, 8)}... ya fue expandido.`,
      })
      return {
        status: 'ready',
        discoveredFollowCount: 0,
        rejectedPubkeys: [],
        message: `Nodo ${pubkey.slice(0, 8)}... ya fue expandido.`,
      }
    }

    if (state.graphCaps.capReached) {
      state.setNodeExpansionState(pubkey, {
        status: 'error',
        message: `Cap de ${state.graphCaps.maxNodes} nodos alcanzado. No se puede expandir.`,
      })
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
        : this.defaultRelayUrls.slice()

    state.setNodeExpansionState(pubkey, {
      status: 'loading',
      message: 'Descubriendo follows estructurales del nodo seleccionado...',
    })

    const previewState = state.nodeStructurePreviewStates?.[pubkey]
    const isRecentFallbackOrEmpty =
      previewState &&
      (previewState.status === 'partial' || previewState.status === 'empty') &&
      !this.activeNodeStructurePreviewRequests.get(pubkey)

    if (isRecentFallbackOrEmpty) {
      const cachedContactList = await this.repositories.contactLists.get(pubkey)
      if (cachedContactList) {
        const cachePreviewMessage =
          buildContactListPartialMessage({
            discoveredFollowCount: cachedContactList.follows.length,
            diagnostics: [],
            rejectedPubkeyCount: 0,
            loadedFromCache: true,
          }) ??
          buildDiscoveredMessage(cachedContactList.follows.length, true, true)

        return this.applyExpandedStructureEvidence(
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

    const adapter = this.createRelayAdapter({
      relayUrls,
      connectTimeoutMs: NODE_EXPAND_CONNECT_TIMEOUT_MS,
      pageTimeoutMs: NODE_EXPAND_PAGE_TIMEOUT_MS,
      retryCount: NODE_EXPAND_RETRY_COUNT,
      stragglerGraceMs: NODE_EXPAND_STRAGGLER_GRACE_MS,
    })

    try {
      const [contactListResult, inboundFollowerResult] = await Promise.all([
        collectRelayEvents(adapter, [
          { authors: [pubkey], kinds: [3] } satisfies Filter,
        ]),
        collectRelayEvents(adapter, [
          {
            kinds: [3],
            '#p': [pubkey],
            limit: NODE_EXPAND_INBOUND_QUERY_LIMIT,
          } satisfies Filter & { '#p': string[] },
        ]),
      ])

      const inboundFollowerEvidence = await this.collectInboundFollowerEvidence(
        selectLatestReplaceableEventsByPubkey(inboundFollowerResult.events),
        pubkey,
      )
      const latestContactListEvent = selectLatestReplaceableEvent(
        contactListResult.events,
      )
      if (!latestContactListEvent) {
        let cachedContactList = await this.repositories.contactLists.get(pubkey)
        if (!cachedContactList) {
          const activePreviewRequest =
            this.activeNodeStructurePreviewRequests.get(pubkey)
          if (activePreviewRequest) {
            await activePreviewRequest
            cachedContactList = await this.repositories.contactLists.get(pubkey)
          }
        }

        if (cachedContactList) {
          const cachePreviewMessage =
            buildContactListPartialMessage({
              discoveredFollowCount: cachedContactList.follows.length,
              diagnostics: [],
              rejectedPubkeyCount: 0,
              loadedFromCache: true,
            }) ??
            buildDiscoveredMessage(cachedContactList.follows.length, true, true)
          return this.applyExpandedStructureEvidence(
            pubkey,
            cachedContactList.follows,
            inboundFollowerEvidence.followerPubkeys,
            {
              relayUrls,
              authoredHasPartialSignals: true,
              inboundHasPartialSignals:
                inboundFollowerEvidence.partial ||
                inboundFollowerResult.error !== null,
              authoredDiagnostics: [],
              authoredLoadedFromCache: true,
              previewMessage:
                cachedContactList.follows.length > 0
                  ? cachePreviewMessage
                  : `Sin lista de follows descubierta para ${pubkey.slice(0, 8)}...`,
            },
          )
        }

        return this.applyExpandedStructureEvidence(
          pubkey,
          [],
          inboundFollowerEvidence.followerPubkeys,
          {
            relayUrls,
            authoredHasPartialSignals: false,
            inboundHasPartialSignals:
              inboundFollowerEvidence.partial ||
              inboundFollowerResult.error !== null,
            previewMessage: `Sin lista de follows descubierta para ${pubkey.slice(0, 8)}...`,
          },
        )
      }

      const parsedContactList = await this.eventsWorker.invoke('PARSE_CONTACT_LIST', {
        event: serializeContactListEvent(latestContactListEvent.event),
      })

      // Leer cache ANTES de persistir: persistContactListEvent puede
      // sobreescribir el cache con la lista vacía del relay.
      const cachedContactListBeforePersist =
        parsedContactList.followPubkeys.length === 0
          ? await this.repositories.contactLists.get(pubkey)
          : null

      await this.persistContactListEvent(latestContactListEvent, parsedContactList)

      // Si el relay devolvio un evento con 0 follows parseables, preferir
      // datos del cache local si los hay.
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
          buildDiscoveredMessage(cachedContactListBeforePersist.follows.length, true, true)
        return this.applyExpandedStructureEvidence(
          pubkey,
          cachedContactListBeforePersist.follows,
          inboundFollowerEvidence.followerPubkeys,
          {
            relayUrls,
            authoredHasPartialSignals: true,
            inboundHasPartialSignals:
              inboundFollowerEvidence.partial ||
              inboundFollowerResult.error !== null,
            authoredDiagnostics: [],
            authoredLoadedFromCache: true,
            previewMessage: cachePreviewMessage,
          },
        )
      }

      return this.applyExpandedStructureEvidence(
        pubkey,
        parsedContactList.followPubkeys,
        inboundFollowerEvidence.followerPubkeys,
        {
          relayUrls,
          authoredHasPartialSignals: parsedContactList.diagnostics.length > 0,
          inboundHasPartialSignals:
            inboundFollowerEvidence.partial ||
            inboundFollowerResult.error !== null,
          authoredDiagnostics: parsedContactList.diagnostics,
        },
      )
    } catch (error) {
      state.setNodeExpansionState(pubkey, {
        status: 'error',
        message:
          error instanceof Error && error.message.trim().length > 0
            ? error.message
            : 'No se pudo expandir este nodo.',
      })
      throw error
    } finally {
      adapter.close()
    }
  }

  private applyExpandedStructureEvidence(
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
    const state = this.store.getState()
    const discoveredAt = this.now()
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

    const stateAfterOutboundNodes = this.store.getState()
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

    // Refrescar state despues de upsertNodes para que el filtro de links
    // use el estado actualizado del store (evitar stale nodes reference).
    const freshState = this.store.getState()

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
    this.scheduleDiscoveredGraphAnalysis()

    void this.hydrateNodeProfiles(
      [
        pubkey,
        ...outboundNodeResult.acceptedPubkeys,
        ...inboundNodeResult.acceptedPubkeys,
      ],
      options.relayUrls,
      this.loadSequence,
    )
    void this.prefetchZapLayer(this.getZapTargetPubkeys(), options.relayUrls)
    void this.prefetchKeywordCorpus(
      this.getKeywordCorpusTargetPubkeys(),
      options.relayUrls,
    )

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
    state.setNodeExpansionState(pubkey, {
      status,
      message: expansionMessage,
    })

    return {
      status,
      discoveredFollowCount: followPubkeys.length,
      rejectedPubkeys,
      message: expansionMessage,
    }
  }

  private async collectInboundFollowerEvidence(
    envelopes: RelayEventEnvelope[],
    targetPubkey: string,
  ): Promise<InboundFollowerEvidence> {
    if (envelopes.length === 0) {
      return {
        followerPubkeys: [],
        partial: false,
      }
    }

    const followerPubkeys = new Set<string>()
    let partial = false

    await runWithConcurrencyLimit(
      envelopes,
      NODE_EXPAND_INBOUND_PARSE_CONCURRENCY,
      async (envelope) => {
        try {
          const parsedContactList = await this.eventsWorker.invoke(
            'PARSE_CONTACT_LIST',
            {
              event: serializeContactListEvent(envelope.event),
            },
          )

          if (
            parsedContactList.followPubkeys.includes(targetPubkey) &&
            envelope.event.pubkey !== targetPubkey
          ) {
            followerPubkeys.add(envelope.event.pubkey)
          }
        } catch {
          partial = true
        }
      },
    )

    return {
      followerPubkeys: Array.from(followerPubkeys).sort(),
      partial,
    }
  }

  private async hydrateNodeProfiles(
    pubkeys: string[],
    relayUrls: string[],
    loadId: number,
  ): Promise<void> {
    const uniquePubkeys = Array.from(new Set(pubkeys.filter(Boolean)))
    if (uniquePubkeys.length === 0) {
      return
    }

    const batches: string[][] = []
    for (
      let index = 0;
      index < uniquePubkeys.length;
      index += NODE_PROFILE_HYDRATION_BATCH_SIZE
    ) {
      batches.push(
        uniquePubkeys.slice(index, index + NODE_PROFILE_HYDRATION_BATCH_SIZE),
      )
    }

    const adapter = this.createRelayAdapter({ relayUrls })

    try {
      const processBatch = async (batch: string[]) => {
        if (this.isStaleLoad(loadId)) {
          return
        }

        const cachedProfiles = await Promise.all(
          batch.map((pubkey) => this.repositories.profiles.get(pubkey)),
        )

        if (this.isStaleLoad(loadId)) {
          return
        }

        for (const cachedProfile of cachedProfiles) {
          if (!cachedProfile) {
            continue
          }

          this.syncNodeProfile(
            cachedProfile.pubkey,
            mapProfileRecordToNodeProfile(cachedProfile),
          )
        }

        if (this.isStaleLoad(loadId)) {
          return
        }

        const profileResult = await collectRelayEvents(adapter, [
          { authors: batch, kinds: [0] } satisfies Filter,
        ])

        if (this.isStaleLoad(loadId)) {
          return
        }

        await runWithConcurrencyLimit(
          selectLatestReplaceableEventsByPubkey(profileResult.events),
          NODE_PROFILE_PERSIST_CONCURRENCY,
          async (envelope) => {
            await this.persistProfileEvent(envelope)
          },
        )

        if (this.isStaleLoad(loadId)) {
          return
        }

        for (const pubkey of batch) {
          const existingNode = this.store.getState().nodes[pubkey]
          if (!existingNode || existingNode.profileState === 'ready') {
            continue
          }

          this.markNodeProfileMissing(pubkey)
        }
      }

      await runWithConcurrencyLimit(
        batches,
        NODE_PROFILE_HYDRATION_BATCH_CONCURRENCY,
        processBatch,
      )
    } catch {
      // Background hydration failures are non-fatal
    } finally {
      adapter.close()
    }
  }

  public async searchKeyword(keyword: string): Promise<SearchKeywordResult> {
    const requestId = this.keywordSearchSequence + 1
    this.keywordSearchSequence = requestId
    const trimmed = keyword.trim()
    const visiblePubkeys = this.getKeywordCorpusTargetPubkeys()

    if (trimmed.length === 0) {
      const state = this.store.getState()
      const resetMessage =
        state.keywordLayer.status === 'enabled'
          ? state.keywordLayer.extractCount > 0
            ? `${state.keywordLayer.extractCount} extractos listos para explorar.`
            : KEYWORD_LAYER_EMPTY_MESSAGE
          : null

      unstable_batchedUpdates(() => {
        state.setCurrentKeyword('')
        this.removeKeywordSourceNodes()
        this.applyKeywordHits({})
        state.setKeywordMatches({})

        if (resetMessage !== null) {
          state.setKeywordLayerState({
            message: resetMessage,
          })
        }
      })

      return {
        keyword: '',
        tokens: [],
        totalHits: 0,
        nodeHits: {},
        matchesByPubkey: {},
      }
    }

    this.removeKeywordSourceNodes()
    const extracts = await this.repositories.noteExtracts.findByPubkeys(visiblePubkeys)

    if (this.keywordSearchSequence !== requestId) {
      return {
        keyword: trimmed,
        tokens: tokenizeKeyword(trimmed),
        totalHits: 0,
        nodeHits: {},
        matchesByPubkey: {},
      }
    }

    if (extracts.length === 0) {
      const state = this.store.getState()
      unstable_batchedUpdates(() => {
        state.setCurrentKeyword(trimmed)
        this.applyKeywordHits({})
        state.setKeywordMatches({})
      })

      return {
        keyword: trimmed,
        tokens: tokenizeKeyword(trimmed),
        totalHits: 0,
        nodeHits: {},
        matchesByPubkey: {},
      }
    }

    const result = await this.eventsWorker.invoke('SEARCH_KEYWORDS', {
      keyword: trimmed,
      extracts: extracts.map((extract) => ({
        noteId: extract.noteId,
        pubkey: extract.pubkey,
        text: extract.text,
      })),
    })

    if (this.keywordSearchSequence !== requestId) {
      return {
        keyword: trimmed,
        tokens: result.tokens,
        totalHits: result.excerptMatches.length,
        nodeHits: {},
        matchesByPubkey: {},
      }
    }

    const nodeHits: Record<string, number> = {}
    const matchesByPubkey: Record<string, KeywordMatch[]> = {}

    for (const [pubkey, count] of Object.entries(result.hitCounts)) {
      nodeHits[pubkey] = count
    }

    for (const match of result.excerptMatches) {
      const matches = matchesByPubkey[match.pubkey] ?? []
      matches.push({
        noteId: match.noteId,
        excerpt: match.excerpt,
        matchedTokens: match.matchedTokens,
        score: match.score,
      })
      matchesByPubkey[match.pubkey] = matches
    }

    const state = this.store.getState()
    const matchNodeCount = Object.keys(matchesByPubkey).length
    const resultMessage =
      result.excerptMatches.length > 0
        ? `${result.excerptMatches.length} coincidencias en ${matchNodeCount} nodos para "${trimmed}".`
        : `Sin coincidencias para "${trimmed}".`

    unstable_batchedUpdates(() => {
      state.setCurrentKeyword(trimmed)
      this.applyKeywordHits(nodeHits)
      state.setKeywordMatches(matchesByPubkey)
      state.setKeywordLayerState({
        message: resultMessage,
      })
    })
    logKeywordMatchesToConsole(
      trimmed,
      nodeHits,
      matchesByPubkey,
      this.store.getState().nodes,
    )

    return {
      keyword: trimmed,
      tokens: result.tokens,
      totalHits: result.excerptMatches.length,
      nodeHits,
      matchesByPubkey,
    }
  }

  public toggleLayer(layer: UiLayer): ToggleLayerResult {
    const state = this.store.getState()
    const previousLayer = state.activeLayer

    if (layer === 'zaps' && state.zapLayer.status !== 'enabled') {
      return {
        previousLayer,
        activeLayer: previousLayer,
        message: state.zapLayer.message ?? 'La capa de zaps no esta disponible todavia.',
      }
    }

    state.setActiveLayer(layer)

    return {
      previousLayer,
      activeLayer: layer,
      message:
        layer === 'zaps'
          ? state.zapLayer.message
          : layer === 'keywords'
            ? state.keywordLayer.message
            : null,
    }
  }

  public async findPath(
    sourcePubkey: string,
    targetPubkey: string,
    algorithm: 'bfs' | 'dijkstra' = 'bfs',
  ): Promise<FindPathResult> {
    const state = this.store.getState()

    if (!state.nodes[sourcePubkey]) {
      throw new KernelCommandError(
        'NODE_NOT_FOUND',
        `Nodo origen ${sourcePubkey.slice(0, 8)}… no existe en el grafo.`,
      )
    }
    if (!state.nodes[targetPubkey]) {
      throw new KernelCommandError(
        'NODE_NOT_FOUND',
        `Nodo destino ${targetPubkey.slice(0, 8)}… no existe en el grafo.`,
      )
    }

    const adjacency = buildMutualAdjacency(state)

    const result = await this.graphWorker.invoke('FIND_PATH', {
      sourcePubkey,
      targetPubkey,
      adjacency,
      algorithm,
    })

    return {
      path: result.path,
      visitedCount: result.visitedCount,
      algorithm: result.algorithm,
    }
  }

  public selectNode(pubkey: string | null): SelectNodeResult {
    const state = this.store.getState()
    const previousPubkey = state.selectedNodePubkey

    if (pubkey !== null && !state.nodes[pubkey]) {
      throw new KernelCommandError(
        'NODE_NOT_FOUND',
        `Nodo ${pubkey.slice(0, 8)}… no existe en el grafo.`,
      )
    }

    state.setSelectedNodePubkey(pubkey)
    state.setOpenPanel(pubkey === null ? 'overview' : 'node-detail')

    if (pubkey !== null) {
      this.prefetchNodeStructurePreview(pubkey)
    }

    return { previousPubkey, selectedPubkey: pubkey }
  }

  public async getNodeDetail(pubkey: string): Promise<NodeDetailProfile | null> {
    const state = this.store.getState()
    const existingNode = state.nodes[pubkey]

    if (!existingNode) {
      return null
    }

    const storedProfile = existingNode.profileState === 'ready'
      ? buildNodeProfileFromNode(existingNode)
      : existingNode.profileState === 'missing'
        ? null
        : undefined

    if (storedProfile !== undefined) {
      return storedProfile
    }

    const profileRecord = await this.repositories.profiles.get(pubkey)
    if (profileRecord) {
      const profile = mapProfileRecordToNodeProfile(profileRecord)
      this.syncNodeProfile(pubkey, profile)
      return profile
    }

    this.markNodeProfileMissing(pubkey)
    return null
  }

  private prefetchNodeStructurePreview(pubkey: string): void {
    const state = this.store.getState()

    if (!state.nodes[pubkey]) {
      return
    }

    if (pubkey === state.rootNodePubkey || state.expandedNodePubkeys.has(pubkey)) {
      state.setNodeStructurePreviewState(pubkey, {
        status: 'ready',
        message: null,
        discoveredFollowCount: state.adjacency[pubkey]?.length ?? 0,
      })
      return
    }

    const currentState = state.nodeStructurePreviewStates[pubkey]
    if (
      currentState &&
      (currentState.status === 'ready' ||
        currentState.status === 'partial' ||
        currentState.status === 'empty')
    ) {
      return
    }

    const activeRequest = this.activeNodeStructurePreviewRequests.get(pubkey)
    if (activeRequest) {
      return
    }

    const request = this.loadNodeStructurePreview(pubkey).finally(() => {
      this.activeNodeStructurePreviewRequests.delete(pubkey)
    })
    this.activeNodeStructurePreviewRequests.set(pubkey, request)
  }

  private async loadNodeStructurePreview(pubkey: string): Promise<void> {
    const state = this.store.getState()

    if (!state.nodes[pubkey]) {
      return
    }

    if (pubkey === state.rootNodePubkey || state.expandedNodePubkeys.has(pubkey)) {
      state.setNodeStructurePreviewState(pubkey, {
        status: 'ready',
        message: null,
        discoveredFollowCount: state.adjacency[pubkey]?.length ?? 0,
      })
      return
    }

    const relayUrls =
      state.relayUrls.length > 0
        ? state.relayUrls.slice()
        : this.defaultRelayUrls.slice()

    state.setNodeStructurePreviewState(pubkey, {
      status: 'loading',
      message: 'Consultando follows publicados para poblar el panel...',
      discoveredFollowCount: null,
    })

    const adapter = this.createRelayAdapter({
      relayUrls,
      connectTimeoutMs: NODE_DETAIL_PREVIEW_CONNECT_TIMEOUT_MS,
      pageTimeoutMs: NODE_DETAIL_PREVIEW_PAGE_TIMEOUT_MS,
      retryCount: NODE_DETAIL_PREVIEW_RETRY_COUNT,
      stragglerGraceMs: NODE_DETAIL_PREVIEW_STRAGGLER_GRACE_MS,
    })

    try {
      const contactListResult = await collectRelayEvents(adapter, [
        { authors: [pubkey], kinds: [3] } satisfies Filter,
      ])

      const latestContactListEvent = selectLatestReplaceableEvent(contactListResult.events)
      if (!latestContactListEvent) {
        state.setNodeStructurePreviewState(pubkey, {
          status: 'empty',
          message: `Sin lista de follows descubierta para ${pubkey.slice(0, 8)}...`,
          discoveredFollowCount: 0,
        })
        return
      }

      const parsedContactList = await this.eventsWorker.invoke('PARSE_CONTACT_LIST', {
        event: serializeContactListEvent(latestContactListEvent.event),
      })
      const hasPartialSignals = parsedContactList.diagnostics.length > 0
      await this.persistContactListEvent(latestContactListEvent, parsedContactList)

      state.setNodeStructurePreviewState(pubkey, {
        status: hasPartialSignals ? 'partial' : 'ready',
        message: hasPartialSignals
          ? buildContactListPartialMessage({
            discoveredFollowCount: parsedContactList.followPubkeys.length,
            diagnostics: parsedContactList.diagnostics,
            rejectedPubkeyCount: 0,
          }) ??
          buildDiscoveredMessage(parsedContactList.followPubkeys.length, true)
          : null,
        discoveredFollowCount: parsedContactList.followPubkeys.length,
      })
    } catch (error) {
      state.setNodeStructurePreviewState(pubkey, {
        status: 'error',
        message:
          error instanceof Error && error.message.trim().length > 0
            ? error.message
            : 'No se pudieron cargar los follows descubiertos para este panel.',
        discoveredFollowCount: null,
      })
    } finally {
      adapter.close()
    }
  }

  private scheduleDiscoveredGraphAnalysis(): void {
    this.analysisScheduleVersion += 1

    if (this.analysisFlushScheduled) {
      return
    }

    this.analysisFlushScheduled = true
    queueMicrotask(() => {
      this.analysisFlushScheduled = false
      void this.flushDiscoveredGraphAnalysis()
    })
  }

  private async flushDiscoveredGraphAnalysis(): Promise<void> {
    if (this.analysisInFlight) {
      return
    }

    const request = this.buildDiscoveredGraphAnalysisRequest()
    if (!request) {
      this.store.getState().resetGraphAnalysis()
      return
    }

    const state = this.store.getState()
    if (
      state.graphAnalysis.analysisKey === request.analysisKey &&
      !state.graphAnalysis.isStale &&
      (state.graphAnalysis.status === 'ready' ||
        state.graphAnalysis.status === 'partial')
    ) {
      return
    }

    const scheduledVersion = this.analysisScheduleVersion
    state.setGraphAnalysisLoading(
      request.analysisKey,
      DISCOVERED_GRAPH_ANALYSIS_LOADING_MESSAGE,
    )

    this.analysisInFlight = true

    try {
      const result = await this.graphWorker.invoke(
        'ANALYZE_DISCOVERED_GRAPH',
        request,
      )

      if (scheduledVersion !== this.analysisScheduleVersion) {
        return
      }

      const nextStatus =
        result.mode === 'heuristic' ||
        result.confidence !== 'high' ||
        result.flags.length > 0
          ? 'partial'
          : 'ready'

      this.store.getState().setGraphAnalysisResult(
        result,
        nextStatus,
        buildDiscoveredGraphAnalysisMessage(result),
      )
    } catch (error) {
      if (scheduledVersion !== this.analysisScheduleVersion) {
        return
      }

      this.store.getState().setGraphAnalysisError(
        request.analysisKey,
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : 'No se pudo actualizar la agrupacion del vecindario descubierto.',
      )
    } finally {
      this.analysisInFlight = false

      if (scheduledVersion !== this.analysisScheduleVersion) {
        this.scheduleDiscoveredGraphAnalysis()
      }
    }
  }

  private buildDiscoveredGraphAnalysisRequest(): AnalyzeDiscoveredGraphRequest | null {
    const state = this.store.getState()
    const nodeEntries = Object.values(state.nodes)
      .map((node) => ({
        pubkey: node.pubkey,
        source: node.source,
      }))
      .sort((left, right) => left.pubkey.localeCompare(right.pubkey))
    const sortedLinks = state.links
      .map((link) => ({
        source: link.source,
        target: link.target,
        relation: link.relation,
      }))
      .sort((left, right) => {
        if (left.source !== right.source) {
          return left.source.localeCompare(right.source)
        }

        if (left.target !== right.target) {
          return left.target.localeCompare(right.target)
        }

        return left.relation.localeCompare(right.relation)
      })
    const relayHealth = Object.fromEntries(
      Object.entries(state.relayHealth)
        .sort(([leftRelayUrl], [rightRelayUrl]) =>
          leftRelayUrl.localeCompare(rightRelayUrl),
        )
        .map(([relayUrl, health]) => [
          relayUrl,
          {
            status: health.status,
          },
        ]),
    )

    if (!state.rootNodePubkey || nodeEntries.length === 0) {
      return null
    }

    return {
      analysisKey: createDiscoveredGraphAnalysisKey({
        nodes: state.nodes,
        links: state.links,
        rootNodePubkey: state.rootNodePubkey,
        capReached: state.graphCaps.capReached,
        isGraphStale: state.isGraphStale,
        relayHealth: state.relayHealth,
      }),
      nodes: nodeEntries,
      links: sortedLinks,
      rootNodePubkey: state.rootNodePubkey,
      capReached: state.graphCaps.capReached,
      isGraphStale: state.isGraphStale,
      relayHealth,
    }
  }

  public getState(): ReturnType<AppStoreApi['getState']> {
    return this.store.getState()
  }

  public async settleBackgroundTasks(): Promise<void> {
    for (let iteration = 0; iteration < 20; iteration += 1) {
      await Promise.resolve()

      if (
        !this.analysisFlushScheduled &&
        !this.analysisInFlight &&
        !this.keywordCorpusInFlight
      ) {
        return
      }
    }
  }

  public async exportSnapshot(): Promise<MultipartArchiveResult> {
    const state = this.store.getState()

    if (Object.keys(state.nodes).length === 0) {
      state.setExportJobProgress({ phase: 'failed', errorMessage: 'No hay nodos descubiertos para exportar.' })
      throw new Error('No hay nodos descubiertos para exportar.')
    }

    state.setExportJobProgress({ phase: 'freezing-snapshot', percent: 0 })

    try {
      const [
        { freezeSnapshot },
        { buildMultipartArchive },
        { downloadBlob },
      ] = await Promise.all([
        import('@/features/graph/export/snapshot-freezer'),
        import('@/features/graph/export/archive-builder'),
        import('@/features/graph/export/download'),
      ])
      const snapshot = await freezeSnapshot({
        store: this.store,
        repositories: this.repositories,
        now: this.now,
      })

      state.setExportJobProgress({ phase: 'packaging', percent: 10 })

      const result = await buildMultipartArchive(snapshot, {
        onPartBuilt: (partNumber, totalParts) => {
          const percent = 10 + Math.round((partNumber / totalParts) * 85)
          state.setExportJobProgress({ phase: 'packaging', percent })
        },
      })

      for (const part of result.parts) {
        downloadBlob(part.blob, part.filename)
      }

      state.setExportJobProgress({ phase: 'completed', percent: 100 })
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error desconocido durante el export.'
      state.setExportJobProgress({ phase: 'failed', errorMessage: message })
      throw error
    }
  }

  public async downloadDiscoveredProfilePhotos(): Promise<ProfilePhotoArchiveResult> {
    const state = this.store.getState()

    if (Object.keys(state.nodes).length === 0) {
      throw new Error('No hay nodos descubiertos para descargar fotos de perfil.')
    }

    const [
      { freezeSnapshot },
      { buildProfilePhotoArchive },
      { downloadBlob },
    ] = await Promise.all([
      import('@/features/graph/export/snapshot-freezer'),
      import('@/features/graph/export/profile-photo-archive'),
      import('@/features/graph/export/download'),
    ])

    const snapshot = await freezeSnapshot({
      store: this.store,
      repositories: this.repositories,
      now: this.now,
    })

    const result = await buildProfilePhotoArchive(snapshot)
    downloadBlob(result.blob, result.filename)

    return result
  }

  public async reconfigureRelays(
    input: ReconfigureRelaysInput,
  ): Promise<ReconfigureRelaysResult> {
    const state = this.store.getState()
    state.setRelayOverrideStatus('validating')

    const validation = validateRelayOverrideInput(
      input.restoreDefault ? this.defaultRelayUrls : input.relayUrls ?? [],
    )

    if (validation.status === 'invalid') {
      state.setRelayOverrideStatus('invalid')
      state.setRootLoadState({ message: validation.message })

      return {
        status: 'invalid',
        relayUrls: state.relayUrls.slice(),
        message: validation.message,
        diagnostics: validation.diagnostics,
        isGraphStale: state.isGraphStale,
        relayHealth: this.snapshotStoreRelayHealth(state.relayUrls),
      }
    }

    const previousRelayUrls =
      state.relayUrls.length > 0
        ? state.relayUrls.slice()
        : this.defaultRelayUrls.slice()
    const rootPubkey = state.rootNodePubkey

    state.setRelayUrls(validation.relayUrls)
    state.resetRelayHealth(validation.relayUrls)
    state.setRelayOverrideStatus('applying')
    state.markGraphStale(rootPubkey !== null)
    this.scheduleDiscoveredGraphAnalysis()

    if (!rootPubkey) {
      state.setRelayOverrideStatus('applied')
      state.markGraphStale(false)
      state.setRootLoadState({
        message: 'Set de relays aplicado. Carga un root para probar cobertura.',
      })

      return {
        status: 'applied',
        relayUrls: validation.relayUrls,
        message: 'Set de relays aplicado. Carga un root para probar cobertura.',
        diagnostics: validation.diagnostics,
        isGraphStale: false,
        relayHealth: createIdleRelayHealthSnapshotMap(
          validation.relayUrls,
          this.now(),
        ),
      }
    }

    this.pendingRelayOverride = {
      relayUrls: previousRelayUrls,
      rootPubkey,
    }

    const loadResult = await this.loadRoot(rootPubkey, {
      preserveExistingGraph: true,
      relayUrls: validation.relayUrls,
    })

    const appliedSuccessfully =
      loadResult.loadedFrom === 'live' && loadResult.discoveredFollowCount > 0

    if (appliedSuccessfully) {
      state.setRelayOverrideStatus('applied')
      state.markGraphStale(false)
      this.scheduleDiscoveredGraphAnalysis()
      this.pendingRelayOverride = null

      return {
        status: 'applied',
        relayUrls: validation.relayUrls,
        message: loadResult.message,
        diagnostics: validation.diagnostics,
        isGraphStale: false,
        relayHealth: loadResult.relayHealth,
      }
    }

    const revertibleMessage = `${loadResult.message} Puedes revertir al set anterior si este override no mejora la cobertura.`
    state.setRelayOverrideStatus('revertible')
    state.markGraphStale(true)
    this.scheduleDiscoveredGraphAnalysis()
    state.setRootLoadState({
      status: 'partial',
      message: revertibleMessage,
      loadedFrom: loadResult.loadedFrom,
    })

    return {
      status: 'revertible',
      relayUrls: validation.relayUrls,
      message: revertibleMessage,
      diagnostics: validation.diagnostics,
      isGraphStale: true,
      relayHealth: loadResult.relayHealth,
    }
  }

  public async revertRelayOverride(): Promise<ReconfigureRelaysResult | null> {
    if (!this.pendingRelayOverride) {
      return null
    }

    const overrideToRevert = this.pendingRelayOverride
    const state = this.store.getState()

    state.setRelayUrls(overrideToRevert.relayUrls)
    state.resetRelayHealth(overrideToRevert.relayUrls)
    state.setRelayOverrideStatus('applying')
    state.markGraphStale(false)
    this.scheduleDiscoveredGraphAnalysis()

    if (!overrideToRevert.rootPubkey) {
      state.setRelayOverrideStatus('applied')
      this.pendingRelayOverride = null

      return {
        status: 'applied',
        relayUrls: overrideToRevert.relayUrls,
        message: 'Se revirtio el override de relays.',
        diagnostics: [],
        isGraphStale: false,
        relayHealth: createIdleRelayHealthSnapshotMap(
          overrideToRevert.relayUrls,
          this.now(),
        ),
      }
    }

    const loadResult = await this.loadRoot(overrideToRevert.rootPubkey, {
      preserveExistingGraph: true,
      relayUrls: overrideToRevert.relayUrls,
    })

    state.setRelayOverrideStatus('applied')
    state.markGraphStale(false)
    this.scheduleDiscoveredGraphAnalysis()
    state.setRootLoadState({
      status: loadResult.status,
      message: `Se revirtio el override de relays. ${loadResult.message}`,
      loadedFrom: loadResult.loadedFrom,
    })
    this.pendingRelayOverride = null

    return {
      status: 'applied',
      relayUrls: overrideToRevert.relayUrls,
      message: `Se revirtio el override de relays. ${loadResult.message}`,
      diagnostics: [],
      isGraphStale: false,
      relayHealth: loadResult.relayHealth,
    }
  }

  public dispose(): void {
    this.cancelActiveLoad()
    this.cancelActiveZapLoad()
    this.cancelActiveKeywordLoad()
    this.eventsWorker.dispose()
    this.graphWorker.dispose()
  }

  private async loadCachedSnapshot(rootPubkey: string): Promise<CachedRootSnapshot> {
    const [contactList, profile] = await Promise.all([
      this.repositories.contactLists.get(rootPubkey),
      this.repositories.profiles.get(rootPubkey),
    ])

    return {
      rootLabel: profile?.name ?? null,
      rootProfile: profile ? mapProfileRecordToNodeProfile(profile) : null,
      followPubkeys: contactList?.follows ?? [],
    }
  }

  private async persistContactListEvent(
    envelope: RelayEventEnvelope,
    parsedContactList: ParseContactListResult,
  ): Promise<void> {
    const fetchedAt = envelope.receivedAtMs
    const event = envelope.event

    await this.repositories.rawEvents.upsert({
      id: event.id,
      pubkey: event.pubkey,
      kind: event.kind,
      createdAt: event.created_at,
      fetchedAt,
      relayUrls: [envelope.relayUrl],
      tags: event.tags,
      content: event.content,
      sig: event.sig,
      rawJson: JSON.stringify(event),
      dTag: findDTag(event),
      captureScope: 'snapshot',
    })
    await this.repositories.replaceableHeads.upsert({
      pubkey: event.pubkey,
      kind: event.kind,
      eventId: event.id,
      createdAt: event.created_at,
      updatedAt: fetchedAt,
    })
    await this.repositories.contactLists.upsert({
      pubkey: event.pubkey,
      eventId: event.id,
      createdAt: event.created_at,
      fetchedAt,
      follows: parsedContactList.followPubkeys,
      relayHints: parsedContactList.relayHints,
    })
  }

  private async persistProfileEvent(envelope: RelayEventEnvelope): Promise<void> {
    const fetchedAt = envelope.receivedAtMs
    const event = envelope.event
    const parsedProfile = safeParseProfile(event.content)

    await this.repositories.rawEvents.upsert({
      id: event.id,
      pubkey: event.pubkey,
      kind: event.kind,
      createdAt: event.created_at,
      fetchedAt,
      relayUrls: [envelope.relayUrl],
      tags: event.tags,
      content: event.content,
      sig: event.sig,
      rawJson: JSON.stringify(event),
      dTag: findDTag(event),
      captureScope: 'snapshot',
    })
    await this.repositories.replaceableHeads.upsert({
      pubkey: event.pubkey,
      kind: event.kind,
      eventId: event.id,
      createdAt: event.created_at,
      updatedAt: fetchedAt,
    })

    if (!parsedProfile) {
      this.markNodeProfileMissing(event.pubkey)
      return
    }

    const profileRecord = await this.repositories.profiles.upsert({
      pubkey: event.pubkey,
      eventId: event.id,
      createdAt: event.created_at,
      fetchedAt,
      name: parsedProfile.name,
      about: parsedProfile.about,
      picture: parsedProfile.picture,
      nip05: parsedProfile.nip05,
      lud16: parsedProfile.lud16,
    })

    this.syncNodeProfile(event.pubkey, mapProfileRecordToNodeProfile(profileRecord))
  }

  private replaceRootGraph(
    rootPubkey: string,
    followPubkeys: string[],
    rootLabel: string | null,
    rootProfile: NodeDetailProfile | null = null,
  ): RootGraphReplacementResult {
    const state = this.store.getState()
    state.resetGraphAnalysis()
    state.resetGraph()
    state.resetZapLayer()
    state.resetKeywordLayer()
    state.setCurrentKeyword('')
    if (state.activeLayer === 'keywords') {
      state.setActiveLayer('graph')
    }
    state.setRootNodePubkey(rootPubkey)

    const discoveredAt = this.now()
    const nodes: GraphNode[] = [
      {
        pubkey: rootPubkey,
        label: rootLabel ?? undefined,
        picture: rootProfile?.picture ?? null,
        about: rootProfile?.about ?? null,
        nip05: rootProfile?.nip05 ?? null,
        lud16: rootProfile?.lud16 ?? null,
        keywordHits: 0,
        discoveredAt,
        profileFetchedAt: rootProfile?.fetchedAt ?? null,
        profileEventId: rootProfile?.eventId ?? null,
        profileState: rootProfile ? 'ready' : 'loading',
        source: 'root',
      },
      ...followPubkeys.map((pubkey) => ({
        pubkey,
        keywordHits: 0,
        discoveredAt,
        profileState: 'loading' as const,
        source: 'follow' as const,
      })),
    ]

    const nodeResult = state.upsertNodes(nodes)
    const acceptedFollowPubkeys = followPubkeys.filter((pubkey) =>
      nodeResult.acceptedPubkeys.includes(pubkey),
    )

    state.upsertLinks(
      acceptedFollowPubkeys.map((pubkey) => ({
        source: rootPubkey,
        target: pubkey,
        relation: 'follow' as const,
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
    })
    this.scheduleDiscoveredGraphAnalysis()

    return {
      discoveredFollowCount: acceptedFollowPubkeys.length,
      rejectedPubkeys: nodeResult.rejectedPubkeys,
      visiblePubkeys: [rootPubkey, ...acceptedFollowPubkeys],
    }
  }

  private captureExpandedNeighborhood(
    rootPubkey: string,
  ): PreservedExpandedNeighborhood | null {
    const state = this.store.getState()
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

  private restoreExpandedNeighborhood(
    preservedExpandedNeighborhood: PreservedExpandedNeighborhood | null,
  ): string[] {
    if (!preservedExpandedNeighborhood) {
      return []
    }

    const state = this.store.getState()
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
      this.scheduleDiscoveredGraphAnalysis()
    }

    return preservedExpandedNeighborhood.nodePubkeys.filter(
      (pubkey) => state.nodes[pubkey] !== undefined,
    )
  }

  private getZapTargetPubkeys(): string[] {
    const state = this.store.getState()
    const targetPubkeys = new Set(state.expandedNodePubkeys)

    if (state.rootNodePubkey) {
      targetPubkeys.add(state.rootNodePubkey)
    }

    return [...targetPubkeys].sort()
  }

  private getKeywordCorpusTargetPubkeys(): string[] {
    return Object.values(this.store.getState().nodes)
      .filter((node) => node.source !== 'keyword')
      .map((node) => node.pubkey)
      .sort()
  }

  private removeKeywordSourceNodes(keepPubkeys: readonly string[] = []): void {
    const state = this.store.getState()
    const keepSet = new Set(keepPubkeys)
    const removablePubkeys = Object.values(state.nodes)
      .filter((node) => node.source === 'keyword' && !keepSet.has(node.pubkey))
      .map((node) => node.pubkey)

    if (removablePubkeys.length === 0) {
      return
    }

    const removableSet = new Set(removablePubkeys)
    if (
      state.selectedNodePubkey !== null &&
      removableSet.has(state.selectedNodePubkey)
    ) {
      state.setSelectedNodePubkey(null)
      if (state.openPanel === 'node-detail') {
        state.setOpenPanel('overview')
      }
    }

    if (state.comparedNodePubkeys.size > 0) {
      const nextComparedNodePubkeys = new Set(
        Array.from(state.comparedNodePubkeys).filter(
          (pubkey) => !removableSet.has(pubkey),
        ),
      )

      if (nextComparedNodePubkeys.size !== state.comparedNodePubkeys.size) {
        state.setComparedNodePubkeys(nextComparedNodePubkeys)
      }
    }

    state.removeNodes(removablePubkeys)
  }

  private resetKeywordHits(): void {
    const state = this.store.getState()
    const nodesWithHits = Object.values(state.nodes).filter(
      (node) => node.keywordHits > 0,
    )

    if (nodesWithHits.length === 0) {
      return
    }

    state.upsertNodes(
      nodesWithHits.map((node) => ({
        ...node,
        keywordHits: 0,
      })),
    )
  }

  private applyKeywordHits(
    nodeHits: Record<string, number>,
    createMissingNode?: (pubkey: string, hitCount: number) => GraphNode | null,
  ): void {
    const state = this.store.getState()
    const candidatePubkeys = new Set([
      ...Object.keys(nodeHits),
      ...Object.values(state.nodes)
        .filter((node) => node.keywordHits > 0)
        .map((node) => node.pubkey),
    ])
    const changedNodes: GraphNode[] = []

    for (const pubkey of candidatePubkeys) {
      const nextHits = nodeHits[pubkey] ?? 0
      const existingNode =
        state.nodes[pubkey] ?? createMissingNode?.(pubkey, nextHits)

      if (!existingNode) {
        continue
      }

      if (existingNode.keywordHits === nextHits) {
        continue
      }

      changedNodes.push({
        ...existingNode,
        keywordHits: nextHits,
      })
    }

    if (changedNodes.length > 0) {
      state.upsertNodes(changedNodes)
    }
  }

  private async prefetchKeywordCorpus(
    targetPubkeys: string[],
    relayUrls: string[],
  ): Promise<void> {
    const normalizedTargetPubkeys = Array.from(
      new Set(targetPubkeys.filter(Boolean)),
    ).sort()
    const state = this.store.getState()

    if (normalizedTargetPubkeys.length === 0) {
      this.resetKeywordHits()
      state.resetKeywordLayer()
      state.setCurrentKeyword('')
      return
    }

    const requestId = this.keywordRequestSequence + 1
    this.keywordRequestSequence = requestId
    this.cancelActiveKeywordLoad()
    this.keywordCorpusInFlight = true

    const cachedExtracts = await this.repositories.noteExtracts.findByPubkeys(
      normalizedTargetPubkeys,
    )

    if (this.isStaleKeywordRequest(requestId)) {
      this.keywordCorpusInFlight = false
      return
    }

    const cachedSummary = summarizeKeywordCorpus(cachedExtracts)
    if (cachedSummary.extractCount > 0) {
      state.setKeywordLayerState({
        status: 'enabled',
        loadedFrom: 'cache',
        isPartial: false,
        message: `${cachedSummary.extractCount} extractos disponibles desde cache local. Revalidando corpus...`,
        corpusNodeCount: cachedSummary.corpusNodeCount,
        extractCount: cachedSummary.extractCount,
        lastUpdatedAt: this.now(),
      })
    } else {
      this.resetKeywordHits()
      state.setKeywordMatches({})
      state.setKeywordLayerState({
        status: 'loading',
        loadedFrom: 'none',
        isPartial: false,
        message: KEYWORD_LAYER_LOADING_MESSAGE,
        corpusNodeCount: 0,
        extractCount: 0,
        matchesByPubkey: {},
        lastUpdatedAt: null,
      })
    }

    const adapter = this.createRelayAdapter({ relayUrls })
    this.activeKeywordSession = {
      requestId,
      adapter,
    }

    const liveExtractsByPubkey = new Map<string, NoteExtractRecord[]>()
    let failedBatchCount = 0

    try {
      const batches = chunkIntoBatches(normalizedTargetPubkeys, KEYWORD_BATCH_SIZE)
      const since = Math.max(
        0,
        Math.floor(this.now() / 1000) - KEYWORD_LOOKBACK_WINDOW_SEC,
      )

      await runWithConcurrencyLimit(
        batches,
        KEYWORD_BATCH_CONCURRENCY,
        async (batch) => {
          const batchResult = await collectRelayEvents(adapter, [
            {
              authors: batch,
              kinds: [1],
              since,
              limit:
                Math.max(
                  KEYWORD_MAX_NOTES_PER_PUBKEY,
                  batch.length * KEYWORD_MAX_NOTES_PER_PUBKEY * KEYWORD_FILTER_LIMIT_FACTOR,
                ),
            } satisfies Filter,
          ])

          if (this.isStaleKeywordRequest(requestId)) {
            return
          }

          if (batchResult.error) {
            failedBatchCount += 1
            return
          }

          const mergedEvents = mergeRelayEventsById(batchResult.events)
          await Promise.all(
            mergedEvents.map((eventEnvelope) =>
              this.persistRawEventEnvelope(eventEnvelope),
            ),
          )
          const recordsByPubkey = buildNoteExtractRecordsByPubkey(
            mergedEvents,
            batch,
            KEYWORD_MAX_NOTES_PER_PUBKEY,
          )

          await Promise.all(
            batch.map(async (pubkey) => {
              const records = recordsByPubkey.get(pubkey) ?? []
              await this.repositories.noteExtracts.replaceForPubkey(pubkey, records)
              liveExtractsByPubkey.set(pubkey, records)
            }),
          )
        },
      )

      if (this.isStaleKeywordRequest(requestId)) {
        return
      }

      const visibleExtracts =
        liveExtractsByPubkey.size > 0
          ? flattenNoteExtractRecords(liveExtractsByPubkey)
          : await this.repositories.noteExtracts.findByPubkeys(normalizedTargetPubkeys)
      const summary = summarizeKeywordCorpus(visibleExtracts)
      const hasLiveCorpus = summary.extractCount > 0
      const hasCacheCorpus = cachedSummary.extractCount > 0
      const currentKeyword = this.store.getState().currentKeyword.trim()

      if (hasLiveCorpus) {
        state.setKeywordLayerState({
          status: 'enabled',
          loadedFrom: 'live',
          isPartial: failedBatchCount > 0,
          message:
            failedBatchCount > 0
              ? `${summary.extractCount} extractos listos con cobertura parcial de relays.`
              : `${summary.extractCount} extractos listos para explorar.`,
          corpusNodeCount: summary.corpusNodeCount,
          extractCount: summary.extractCount,
          lastUpdatedAt: this.now(),
        })

        if (currentKeyword.length > 0) {
          await this.searchKeyword(currentKeyword)
        } else {
          this.resetKeywordHits()
          state.setKeywordMatches({})
        }

        return
      }

      if (hasCacheCorpus) {
        state.setKeywordLayerState({
          status: 'enabled',
          loadedFrom: 'cache',
          isPartial: true,
          message: `${cachedSummary.extractCount} extractos desde cache. No se pudo refrescar toda la cobertura live.`,
          corpusNodeCount: cachedSummary.corpusNodeCount,
          extractCount: cachedSummary.extractCount,
          lastUpdatedAt: this.now(),
        })

        if (currentKeyword.length > 0) {
          await this.searchKeyword(currentKeyword)
        } else {
          this.resetKeywordHits()
          state.setKeywordMatches({})
        }

        return
      }

      this.resetKeywordHits()
      state.setKeywordMatches({})
      state.setCurrentKeyword('')
      state.setKeywordLayerState({
        status: 'unavailable',
        loadedFrom: 'live',
        isPartial: failedBatchCount > 0,
        message:
          failedBatchCount > 0
            ? 'No se pudo construir el corpus de notas con los relays actuales.'
            : KEYWORD_LAYER_EMPTY_MESSAGE,
        corpusNodeCount: 0,
        extractCount: 0,
        lastUpdatedAt: this.now(),
      })
    } catch (error) {
      if (!this.isStaleKeywordRequest(requestId)) {
        if (cachedSummary.extractCount > 0) {
          state.setKeywordLayerState({
            status: 'enabled',
            loadedFrom: 'cache',
            isPartial: true,
            message: `${cachedSummary.extractCount} extractos desde cache. No se pudo refrescar el corpus live.`,
            corpusNodeCount: cachedSummary.corpusNodeCount,
            extractCount: cachedSummary.extractCount,
            lastUpdatedAt: this.now(),
          })
        } else {
          this.resetKeywordHits()
          state.setKeywordMatches({})
          state.setCurrentKeyword('')
          state.setKeywordLayerState({
            status: 'unavailable',
            loadedFrom: 'none',
            isPartial: true,
            message:
              error instanceof Error && error.message.trim().length > 0
                ? error.message
                : 'No se pudo construir el corpus de notas con los relays actuales.',
            corpusNodeCount: 0,
            extractCount: 0,
            lastUpdatedAt: this.now(),
          })
        }
      }
    } finally {
      if (this.activeKeywordSession?.requestId === requestId) {
        this.activeKeywordSession.adapter.close()
        this.activeKeywordSession = null
      }

      if (this.keywordRequestSequence === requestId) {
        this.keywordCorpusInFlight = false
      }
    }
  }

  private syncNodeProfile(pubkey: string, profile: NodeDetailProfile): void {
    const existingNode = this.store.getState().nodes[pubkey]

    if (!existingNode) {
      return
    }

    this.store.getState().upsertNodes([
      {
        ...existingNode,
        label: profile.name ?? undefined,
        picture: profile.picture,
        about: profile.about,
        nip05: profile.nip05,
        lud16: profile.lud16,
        profileEventId: profile.eventId,
        profileFetchedAt: profile.fetchedAt,
        profileState: 'ready',
      },
    ])
  }

  private markNodeProfileMissing(pubkey: string): void {
    const existingNode = this.store.getState().nodes[pubkey]

    if (!existingNode || existingNode.profileState === 'ready') {
      return
    }

    this.store.getState().upsertNodes([
      {
        ...existingNode,
        picture: null,
        about: null,
        nip05: null,
        lud16: null,
        profileEventId: null,
        profileFetchedAt: null,
        profileState: 'missing',
      },
    ])
  }

  private async prefetchZapLayer(
    targetPubkeys: string[],
    relayUrls: string[],
  ): Promise<void> {
    const normalizedTargetPubkeys = Array.from(
      new Set(targetPubkeys.filter(Boolean)),
    ).sort()
    const state = this.store.getState()

    if (normalizedTargetPubkeys.length === 0) {
      state.resetZapLayer()
      return
    }

    const requestId = this.zapRequestSequence + 1
    this.zapRequestSequence = requestId
    this.cancelActiveZapLoad()

    state.setZapLayerState({
      status: 'loading',
      loadedFrom: 'none',
      targetPubkeys: normalizedTargetPubkeys,
      skippedReceipts: 0,
      message: ZAP_LAYER_LOADING_MESSAGE,
      lastUpdatedAt: this.now(),
    })

    const cachedZaps = await this.repositories.zaps.findByTargetPubkeys(
      normalizedTargetPubkeys,
    )
    if (this.isStaleZapRequest(requestId)) {
      return
    }

    if (cachedZaps.length > 0) {
      this.promoteZapNodes(
        cachedZaps,
        relayUrls,
        requestId,
        normalizedTargetPubkeys,
      )

      if (this.isStaleZapRequest(requestId)) {
        return
      }

      const cachedEdges = this.buildZapLayerEdges(
        cachedZaps,
        normalizedTargetPubkeys,
      )
      state.replaceZapLayerEdges(cachedEdges)
      state.setZapLayerState({
        status: cachedEdges.length > 0 ? 'enabled' : 'loading',
        loadedFrom: 'cache',
        message: buildZapLayerMessage({
          status: cachedEdges.length > 0 ? 'enabled' : 'loading',
          edgeCount: cachedEdges.length,
          skippedReceipts: 0,
          loadedFrom: 'cache',
        }),
        lastUpdatedAt: this.now(),
      })
    }

    const adapter = this.createRelayAdapter({ relayUrls })
    this.activeZapSession = { requestId, adapter }

    let skippedReceipts = 0

    try {
      const liveResult = await collectRelayEvents(adapter, [
        buildZapReceiptsFilter(normalizedTargetPubkeys),
      ])

      if (this.isStaleZapRequest(requestId)) {
        return
      }

      if (liveResult.summary?.relayHealth) {
        this.publishRelayHealth(liveResult.summary.relayHealth)
      }

      const liveErrorMessage = liveResult.error?.message ?? null
      const mergedReceipts = mergeRelayEventsById(liveResult.events)
      if (mergedReceipts.length > 0) {
        await Promise.all(
          mergedReceipts.map((envelope) => this.persistRawEventEnvelope(envelope)),
        )

        const decodeResult = await this.eventsWorker.invoke('DECODE_ZAPS', {
          events: mergedReceipts.map((receipt) =>
            serializeZapReceiptEvent(receipt.event),
          ),
        })

        if (this.isStaleZapRequest(requestId)) {
          return
        }

        skippedReceipts = decodeResult.skippedReceipts.length
        await this.persistDecodedZapEdges(mergedReceipts, decodeResult.zapEdges)
      }

      if (this.isStaleZapRequest(requestId)) {
        return
      }

      const allVisibleZaps = await this.repositories.zaps.findByTargetPubkeys(
        normalizedTargetPubkeys,
      )
      if (this.isStaleZapRequest(requestId)) {
        return
      }

      this.promoteZapNodes(
        allVisibleZaps,
        relayUrls,
        requestId,
        normalizedTargetPubkeys,
      )

      if (this.isStaleZapRequest(requestId)) {
        return
      }

      const visibleEdges = this.buildZapLayerEdges(
        allVisibleZaps,
        normalizedTargetPubkeys,
      )
      state.replaceZapLayerEdges(visibleEdges)

      const status = visibleEdges.length > 0 ? 'enabled' : 'unavailable'
      const loadedFrom =
        mergedReceipts.length > 0 ? 'live' : cachedZaps.length > 0 ? 'cache' : 'live'

      state.setZapLayerState({
        status,
        loadedFrom,
        skippedReceipts,
        message:
          status === 'unavailable' && liveErrorMessage && cachedZaps.length === 0
            ? `No se pudieron cargar recibos de zap. ${liveErrorMessage}`
            : buildZapLayerMessage({
              status,
              edgeCount: visibleEdges.length,
              skippedReceipts,
              loadedFrom,
            }),
        lastUpdatedAt: this.now(),
      })
    } catch (error) {
      if (this.isStaleZapRequest(requestId)) {
        return
      }

      const visibleEdges = this.buildZapLayerEdges(
        cachedZaps,
        normalizedTargetPubkeys,
      )
      state.replaceZapLayerEdges(visibleEdges)
      state.setZapLayerState({
        status: visibleEdges.length > 0 ? 'enabled' : 'unavailable',
        loadedFrom: visibleEdges.length > 0 ? 'cache' : 'none',
        skippedReceipts: 0,
        message:
          visibleEdges.length > 0
            ? buildZapLayerMessage({
              status: 'enabled',
              edgeCount: visibleEdges.length,
              skippedReceipts: 0,
              loadedFrom: 'cache',
            })
            : error instanceof Error
              ? `No se pudieron cargar recibos de zap. ${error.message}`
              : 'No se pudieron cargar recibos de zap.',
        lastUpdatedAt: this.now(),
      })
    } finally {
      if (this.activeZapSession?.requestId === requestId) {
        this.activeZapSession.adapter.close()
        this.activeZapSession = null
      }
    }
  }

  private promoteZapNodes(
    zaps: readonly ZapRecord[],
    relayUrls: string[],
    requestId: number,
    targetPubkeys: readonly string[],
  ): void {
    const state = this.store.getState()
    const knownPubkeys = new Set(Object.keys(state.nodes))
    const allowedTargets = new Set(targetPubkeys)
    const candidatePubkeys = Array.from(
      new Set(
        zaps
          .filter((record) => allowedTargets.has(record.toPubkey))
          .flatMap((record) => [record.fromPubkey, record.toPubkey])
          .filter((pubkey) => !knownPubkeys.has(pubkey)),
      ),
    ).sort()

    if (candidatePubkeys.length === 0) {
      return
    }

    const discoveredAt = this.now()
    const nodeResult = state.upsertNodes(
      candidatePubkeys.map((pubkey) => ({
        pubkey,
        keywordHits: 0,
        discoveredAt,
        profileState: 'loading' as const,
        source: 'zap' as const,
      })),
    )

    if (
      nodeResult.acceptedPubkeys.length > 0 &&
      !this.isStaleZapRequest(requestId)
    ) {
      this.scheduleDiscoveredGraphAnalysis()
      void this.hydrateNodeProfiles(
        nodeResult.acceptedPubkeys,
        relayUrls,
        this.loadSequence,
      )
      void this.prefetchKeywordCorpus(this.getKeywordCorpusTargetPubkeys(), relayUrls)
    }
  }

  private buildZapLayerEdges(
    zaps: readonly ZapRecord[],
    targetPubkeys: readonly string[],
  ): ZapLayerEdge[] {
    const visibleNodes = new Set(Object.keys(this.store.getState().nodes))
    const allowedTargets = new Set(targetPubkeys)
    const aggregatedEdges = new Map<string, ZapLayerEdge>()

    for (const record of zaps) {
      if (!allowedTargets.has(record.toPubkey)) {
        continue
      }

      if (!visibleNodes.has(record.fromPubkey) || !visibleNodes.has(record.toPubkey)) {
        continue
      }

      const key = `${record.fromPubkey}->${record.toPubkey}`
      const existingEdge = aggregatedEdges.get(key)

      if (existingEdge) {
        existingEdge.weight += record.sats
        existingEdge.receiptCount += 1
        continue
      }

      aggregatedEdges.set(key, {
        source: record.fromPubkey,
        target: record.toPubkey,
        relation: 'zap',
        weight: record.sats,
        receiptCount: 1,
      })
    }

    return Array.from(aggregatedEdges.values())
  }

  private async persistDecodedZapEdges(
    mergedReceipts: readonly MergedRelayEventEnvelope[],
    decodedEdges: readonly { eventId: string; fromPubkey: string; toPubkey: string; sats: number; createdAt: number }[],
  ): Promise<void> {
    const receiptsById = new Map(
      mergedReceipts.map((receipt) => [receipt.event.id, receipt]),
    )

    await Promise.all(
      decodedEdges.map(async (edge) => {
        const envelope = receiptsById.get(edge.eventId)
        if (!envelope) {
          return
        }

        await this.repositories.zaps.upsert({
          id: edge.eventId,
          fromPubkey: edge.fromPubkey,
          toPubkey: edge.toPubkey,
          sats: edge.sats,
          createdAt: edge.createdAt,
          fetchedAt: envelope.receivedAtMs,
          bolt11: findEventTagValue(envelope.event.tags, 'bolt11') ?? null,
          eventRef: findEventTagValue(envelope.event.tags, 'e') ?? null,
        })
      }),
    )
  }

  private async persistRawEventEnvelope(
    envelope: MergedRelayEventEnvelope,
  ): Promise<void> {
    const event = envelope.event

    await this.repositories.rawEvents.upsert({
      id: event.id,
      pubkey: event.pubkey,
      kind: event.kind,
      createdAt: event.created_at,
      fetchedAt: envelope.receivedAtMs,
      relayUrls: envelope.relayUrls,
      tags: event.tags,
      content: event.content,
      sig: event.sig,
      rawJson: JSON.stringify(event),
      dTag: findDTag(event),
      captureScope: 'snapshot',
    })
  }

  private publishRelayHealth(relayHealth: Record<string, RelayHealthSnapshot>): void {
    if (Object.keys(relayHealth).length === 0) {
      return
    }

    this.pendingRelayHealthSnapshot = {
      ...(this.pendingRelayHealthSnapshot ?? {}),
      ...relayHealth,
    }

    if (this.pendingRelayHealthFlush !== null) {
      return
    }

    this.pendingRelayHealthFlush = setTimeout(() => {
      this.flushPendingRelayHealth()
    }, RELAY_HEALTH_FLUSH_DELAY_MS)
  }

  private flushPendingRelayHealth(): void {
    if (this.pendingRelayHealthFlush !== null) {
      clearTimeout(this.pendingRelayHealthFlush)
      this.pendingRelayHealthFlush = null
    }

    const pendingRelayHealth = this.pendingRelayHealthSnapshot
    if (!pendingRelayHealth) {
      return
    }

    this.pendingRelayHealthSnapshot = null
    this.store.getState().updateRelayHealthBatch(
      Object.fromEntries(
        Object.entries(pendingRelayHealth).map(([relayUrl, snapshot]) => [
          relayUrl,
          {
            status: mapRelayHealthStatus(snapshot.status),
            lastCheckedAt: snapshot.lastChangeMs,
            lastNotice: snapshot.lastNotice ?? null,
          },
        ]),
      ),
    )
  }

  private snapshotStoreRelayHealth(relayUrls: string[]): Record<string, RelayHealthSnapshot> {
    this.flushPendingRelayHealth()
    const state = this.store.getState()

    return Object.fromEntries(
      relayUrls.map((relayUrl) => [
        relayUrl,
        createRelayHealthSnapshotFromStore(
          relayUrl,
          state.relayHealth[relayUrl],
          this.now(),
        ),
      ]),
    )
  }

  private resolveRelayHealthSnapshot(
    relayUrls: string[],
    contactListResult: RelayCollectionResult,
  ): Record<string, RelayHealthSnapshot> {
    return (
      contactListResult.summary?.relayHealth ??
      this.activeLoadSession?.adapter.getRelayHealth() ??
      Object.fromEntries(
        relayUrls.map((relayUrl) => [
          relayUrl,
          {
            url: relayUrl,
            status: 'offline',
            attempt: 0,
            activeSubscriptions: 0,
            consecutiveFailures: 0,
            lastChangeMs: this.now(),
          } satisfies RelayHealthSnapshot,
        ]),
      )
    )
  }

  private buildMissingContactListResult(
    rootPubkey: string,
    cachedSnapshot: CachedRootSnapshot,
    relayHealth: Record<string, RelayHealthSnapshot>,
    error: Error | null,
    preserveExistingGraph: boolean,
  ): LoadRootResult {
    if (preserveExistingGraph) {
      const staleFollowCount = this.countVisibleFollowsFromRoot(rootPubkey)
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

  private countVisibleFollowsFromRoot(rootPubkey: string): number {
    return this.store
      .getState()
      .links.filter(
        (link) => link.source === rootPubkey && link.relation === 'follow',
      ).length
  }

  private createCancelledResult(relayUrls: string[]): LoadRootResult {
    const relayHealth =
      this.activeLoadSession?.adapter.getRelayHealth() ??
      Object.fromEntries(
        relayUrls.map((relayUrl) => [
          relayUrl,
          {
            url: relayUrl,
            status: 'offline',
            attempt: 0,
            activeSubscriptions: 0,
            consecutiveFailures: 0,
            lastChangeMs: this.now(),
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

  private cancelActiveLoad(): void {
    if (!this.activeLoadSession) {
      return
    }

    this.activeLoadSession.detachRelayHealth()
    this.activeLoadSession.adapter.close()
    this.activeLoadSession = null
  }

  private cancelActiveZapLoad(): void {
    if (!this.activeZapSession) {
      return
    }

    this.activeZapSession.adapter.close()
    this.activeZapSession = null
  }

  private cancelActiveKeywordLoad(): void {
    if (!this.activeKeywordSession) {
      return
    }

    this.activeKeywordSession.adapter.close()
    this.activeKeywordSession = null
  }

  private isStaleLoad(loadId: number): boolean {
    return loadId !== this.loadSequence
  }

  private isStaleZapRequest(requestId: number): boolean {
    return requestId !== this.zapRequestSequence
  }

  private isStaleKeywordRequest(requestId: number): boolean {
    return requestId !== this.keywordRequestSequence
  }
}

export type KernelCommandErrorCode =
  | 'NODE_NOT_FOUND'
  | 'CAP_REACHED'
  | 'COMMAND_FAILED'

export class KernelCommandError extends Error {
  public readonly code: KernelCommandErrorCode
  public readonly details: Record<string, unknown>

  constructor(code: KernelCommandErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message)
    this.name = 'KernelCommandError'
    this.code = code
    this.details = details
  }
}

export interface RootLoader {
  loadRoot: (
    rootPubkey: string,
    options?: LoadRootOptions,
  ) => Promise<LoadRootResult>
  reconfigureRelays: (
    input: ReconfigureRelaysInput,
  ) => Promise<ReconfigureRelaysResult>
  revertRelayOverride: () => Promise<ReconfigureRelaysResult | null>
  expandNode: (pubkey: string) => Promise<ExpandNodeResult>
  searchKeyword: (keyword: string) => Promise<SearchKeywordResult>
  toggleLayer: (layer: UiLayer) => ToggleLayerResult
  findPath: (
    sourcePubkey: string,
    targetPubkey: string,
    algorithm?: 'bfs' | 'dijkstra',
  ) => Promise<FindPathResult>
  selectNode: (pubkey: string | null) => SelectNodeResult
  getNodeDetail: (pubkey: string) => Promise<NodeDetailProfile | null>
}

export function createAppKernel(dependencies: AppKernelDependencies): AppKernel {
  return new AppKernel(dependencies)
}

function buildMutualAdjacency(
  state: Pick<AppStore, 'links' | 'inboundLinks' | 'nodes'>,
): Record<string, string[]> {
  const evidence = deriveDirectedEvidence({
    links: state.links,
    inboundLinks: state.inboundLinks,
  })

  const mutualAdjacency = Object.fromEntries(
    Object.keys(state.nodes)
      .sort()
      .map((pubkey) => [pubkey, evidence.mutualAdjacency[pubkey] ?? []]),
  )

  return mutualAdjacency
}

const browserDatabase = createNostrGraphDatabase()

export const browserAppKernel = createAppKernel({
  store: appStore,
  repositories: createRepositories(browserDatabase),
  eventsWorker: createEventsWorkerGateway(),
  graphWorker: createGraphWorkerGateway(),
  createRelayAdapter: createRelayPoolAdapter,
})

function mapRelayHealthStatus(status: RelayHealthSnapshot['status']): StoreRelayHealthStatus {
  switch (status) {
    case 'healthy':
      return 'connected'
    case 'degraded':
      return 'degraded'
    case 'offline':
      return 'offline'
    default:
      return 'unknown'
  }
}

type RelayOverrideValidationResult =
  | {
    status: 'valid'
    relayUrls: string[]
    diagnostics: string[]
  }
  | {
    status: 'invalid'
    relayUrls: []
    message: string
    diagnostics: string[]
  }

function validateRelayOverrideInput(rawRelayUrls: readonly string[]): RelayOverrideValidationResult {
  const dedupedRelayUrls = Array.from(
    new Set(rawRelayUrls.map((relayUrl) => relayUrl.trim()).filter(Boolean)),
  )

  if (dedupedRelayUrls.length === 0) {
    return {
      status: 'invalid',
      relayUrls: [],
      message: 'Debes ingresar al menos un relay valido.',
      diagnostics: [],
    }
  }

  if (dedupedRelayUrls.length > MAX_SESSION_RELAYS) {
    return {
      status: 'invalid',
      relayUrls: [],
      message: `El limite de relays por sesion es ${MAX_SESSION_RELAYS}.`,
      diagnostics: [],
    }
  }

  const normalizedRelayUrls: string[] = []
  const diagnostics: string[] = []

  for (const relayUrl of dedupedRelayUrls) {
    try {
      normalizedRelayUrls.push(normalizeRelayUrl(relayUrl))
    } catch (error) {
      diagnostics.push(
        `${relayUrl}: ${error instanceof Error ? error.message : 'URL invalida.'}`,
      )
    }
  }

  if (diagnostics.length > 0) {
    return {
      status: 'invalid',
      relayUrls: [],
      message: 'Hay URLs de relay invalidas. Revisa los diagnosticos.',
      diagnostics,
    }
  }

  return {
    status: 'valid',
    relayUrls: normalizedRelayUrls,
    diagnostics,
  }
}

function createIdleRelayHealthSnapshotMap(
  relayUrls: readonly string[],
  now: number,
): Record<string, RelayHealthSnapshot> {
  return Object.fromEntries(
    relayUrls.map((relayUrl) => [
      relayUrl,
      {
        url: relayUrl,
        status: 'idle',
        attempt: 0,
        activeSubscriptions: 0,
        consecutiveFailures: 0,
        lastChangeMs: now,
      } satisfies RelayHealthSnapshot,
    ]),
  )
}

function createRelayHealthSnapshotFromStore(
  relayUrl: string,
  relayHealth: RelayHealth | undefined,
  now: number,
): RelayHealthSnapshot {
  if (!relayHealth) {
    return {
      url: relayUrl,
      status: 'idle',
      attempt: 0,
      activeSubscriptions: 0,
      consecutiveFailures: 0,
      lastChangeMs: now,
    }
  }

  return {
    url: relayUrl,
    status: mapStoreRelayHealthStatus(relayHealth.status),
    attempt: 0,
    activeSubscriptions: 0,
    consecutiveFailures: 0,
    lastChangeMs: relayHealth.lastCheckedAt ?? now,
    lastNotice: relayHealth.lastNotice ?? undefined,
  }
}

function mapStoreRelayHealthStatus(
  status: StoreRelayHealthStatus,
): RelayHealthSnapshot['status'] {
  switch (status) {
    case 'connected':
      return 'healthy'
    case 'degraded':
    case 'partial':
      return 'degraded'
    case 'offline':
      return 'offline'
    default:
      return 'idle'
  }
}

async function collectRelayEvents(
  adapter: RelayAdapterInstance,
  filters: RelayQueryFilter[],
): Promise<RelayCollectionResult> {
  return new Promise<RelayCollectionResult>((resolve) => {
    const events: RelayEventEnvelope[] = []
    let settled = false
    let cancel = () => { }

    const finalize = (result: RelayCollectionResult) => {
      if (settled) {
        return
      }

      settled = true
      cancel()
      resolve(result)
    }

    cancel = adapter.subscribe(filters).subscribe({
      next: (value) => {
        events.push(value)
      },
      error: (error) => {
        finalize({
          events,
          summary: null,
          error,
        })
      },
      complete: (summary) => {
        finalize({
          events,
          summary,
          error: null,
        })
      },
    })
  })
}

async function runWithConcurrencyLimit<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) {
    return
  }

  const concurrency = Math.max(1, Math.min(limit, items.length))
  let nextIndex = 0

  const runWorker = async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex]
      nextIndex += 1
      await worker(item)
    }
  }

  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      await runWorker()
    }),
  )
}

function selectLatestReplaceableEvent(
  events: RelayEventEnvelope[],
): RelayEventEnvelope | null {
  if (events.length === 0) {
    return null
  }

  return events
    .slice()
    .sort((left, right) => {
      if (left.event.created_at !== right.event.created_at) {
        return right.event.created_at - left.event.created_at
      }

      return left.event.id.localeCompare(right.event.id)
    })[0]
}

function selectLatestReplaceableEventsByPubkey(
  events: RelayEventEnvelope[],
): RelayEventEnvelope[] {
  const latestByPubkey = new Map<string, RelayEventEnvelope>()

  for (const envelope of events) {
    const current = latestByPubkey.get(envelope.event.pubkey)
    if (!current) {
      latestByPubkey.set(envelope.event.pubkey, envelope)
      continue
    }

    if (envelope.event.created_at > current.event.created_at) {
      latestByPubkey.set(envelope.event.pubkey, envelope)
      continue
    }

    if (
      envelope.event.created_at === current.event.created_at &&
      envelope.event.id.localeCompare(current.event.id) < 0
    ) {
      latestByPubkey.set(envelope.event.pubkey, envelope)
    }
  }

  return Array.from(latestByPubkey.values()).sort((left, right) =>
    left.event.pubkey.localeCompare(right.event.pubkey),
  )
}

function serializeContactListEvent(event: Event) {
  return {
    id: event.id,
    pubkey: event.pubkey,
    kind: event.kind,
    createdAt: event.created_at,
    tags: event.tags,
  }
}

function safeParseProfile(content: string): {
  name: string | null
  about: string | null
  picture: string | null
  nip05: string | null
  lud16: string | null
} | null {
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>
    return {
      name: firstString(parsed.display_name, parsed.name),
      about: firstString(parsed.about),
      picture: firstString(parsed.picture),
      nip05: firstString(parsed.nip05),
      lud16: firstString(parsed.lud16),
    }
  } catch {
    return null
  }
}

function mapProfileRecordToNodeProfile(profile: ProfileRecord): NodeDetailProfile {
  return {
    eventId: profile.eventId,
    fetchedAt: profile.fetchedAt,
    name: profile.name,
    about: profile.about,
    picture: profile.picture,
    nip05: profile.nip05,
    lud16: profile.lud16,
  }
}

function buildNodeProfileFromNode(node: GraphNode): NodeDetailProfile {
  return {
    eventId: node.profileEventId ?? '',
    fetchedAt: node.profileFetchedAt ?? 0,
    name: node.label ?? null,
    about: node.about ?? null,
    picture: node.picture ?? null,
    nip05: node.nip05 ?? null,
    lud16: node.lud16 ?? null,
  }
}

function tokenizeKeyword(keyword: string): string[] {
  return [
    ...new Set(
      keyword
        .toLowerCase()
        .split(/\s+/)
        .filter((token) => token.length > 1),
    ),
  ].sort()
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim()
    }
  }

  return null
}

function chunkIntoBatches<T>(items: readonly T[], size: number): T[][] {
  if (size <= 0) {
    return [items.slice()]
  }

  const batches: T[][] = []

  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size))
  }

  return batches
}

function normalizeNoteExtractText(content: string): string | null {
  const normalized = content.replace(/\s+/g, ' ').trim()

  if (normalized.length === 0) {
    return null
  }

  return normalized.slice(0, KEYWORD_EXTRACT_MAX_LENGTH)
}

function buildNoteExtractRecordsByPubkey(
  events: readonly MergedRelayEventEnvelope[],
  requestedPubkeys: readonly string[],
  maxNotesPerPubkey: number,
): Map<string, NoteExtractRecord[]> {
  const recordsByPubkey = new Map<string, NoteExtractRecord[]>(
    requestedPubkeys.map((pubkey) => [pubkey, []]),
  )
  const requestedSet = new Set(requestedPubkeys)

  const sortedEvents = events
    .filter(
      (envelope) => envelope.event.kind === 1 && requestedSet.has(envelope.event.pubkey),
    )
    .slice()
    .sort((left, right) => {
      if (left.event.pubkey !== right.event.pubkey) {
        return left.event.pubkey.localeCompare(right.event.pubkey)
      }

      if (left.event.created_at !== right.event.created_at) {
        return right.event.created_at - left.event.created_at
      }

      return left.event.id.localeCompare(right.event.id)
    })

  for (const envelope of sortedEvents) {
    const currentRecords = recordsByPubkey.get(envelope.event.pubkey) ?? []

    if (currentRecords.length >= maxNotesPerPubkey) {
      continue
    }

    const text = normalizeNoteExtractText(envelope.event.content)
    if (!text) {
      continue
    }

    recordsByPubkey.set(envelope.event.pubkey, [
      ...currentRecords,
      {
        noteId: envelope.event.id,
        pubkey: envelope.event.pubkey,
        createdAt: envelope.event.created_at,
        fetchedAt: envelope.receivedAtMs,
        text,
      },
    ])
  }

  return recordsByPubkey
}

function flattenNoteExtractRecords(
  recordsByPubkey: Map<string, NoteExtractRecord[]>,
): NoteExtractRecord[] {
  return Array.from(recordsByPubkey.values())
    .flat()
    .sort((left, right) => {
      if (left.pubkey !== right.pubkey) {
        return left.pubkey.localeCompare(right.pubkey)
      }

      if (left.createdAt !== right.createdAt) {
        return right.createdAt - left.createdAt
      }

      return left.noteId.localeCompare(right.noteId)
    })
}

function summarizeKeywordCorpus(extracts: readonly NoteExtractRecord[]): {
  corpusNodeCount: number
  extractCount: number
} {
  return {
    corpusNodeCount: new Set(extracts.map((extract) => extract.pubkey)).size,
    extractCount: extracts.length,
  }
}

function logKeywordMatchesToConsole(
  keyword: string,
  nodeHits: Record<string, number>,
  matchesByPubkey: Record<string, KeywordMatch[]>,
  nodes: Record<string, GraphNode>,
): void {
  if (typeof console === 'undefined') {
    return
  }

  const matchedUsers = Object.entries(matchesByPubkey)
    .map(([pubkey, matches]) => ({
      pubkey,
      label:
        nodes[pubkey]?.label?.trim() ||
        nodes[pubkey]?.nip05?.trim() ||
        pubkey.slice(0, 12),
      hitScore: nodeHits[pubkey] ?? 0,
      excerptCount: matches.length,
      topTokens: Array.from(
        new Set(matches.flatMap((match) => match.matchedTokens)),
      ).join(', '),
    }))
    .sort((left, right) => {
      if (left.hitScore !== right.hitScore) {
        return right.hitScore - left.hitScore
      }

      return left.pubkey.localeCompare(right.pubkey)
    })

  console.info(
    `[graph] Keyword "${keyword}" matched ${matchedUsers.length} users.`,
    matchedUsers,
  )
}

function findDTag(event: Event): string | null {
  return event.tags.find((tag) => tag[0] === 'd')?.[1] ?? null
}

function findEventTagValue(tags: string[][], tagName: string): string | null {
  return tags.find((tag) => tag[0] === tagName)?.[1] ?? null
}

function buildZapReceiptsFilter(
  visiblePubkeys: readonly string[],
): Filter & { '#p': string[] } {
  return {
    kinds: [9735],
    '#p': [...visiblePubkeys],
    limit: Math.min(
      MAX_ZAP_RECEIPTS,
      Math.max(50, visiblePubkeys.length * 20),
    ),
  }
}

function mergeRelayEventsById(
  events: readonly RelayEventEnvelope[],
): MergedRelayEventEnvelope[] {
  const mergedById = new Map<string, MergedRelayEventEnvelope>()

  for (const envelope of events) {
    const existing = mergedById.get(envelope.event.id)

    if (!existing) {
      mergedById.set(envelope.event.id, {
        event: envelope.event,
        relayUrls: [envelope.relayUrl],
        relayUrl: envelope.relayUrl,
        receivedAtMs: envelope.receivedAtMs,
      })
      continue
    }

    existing.relayUrls = Array.from(
      new Set([...existing.relayUrls, envelope.relayUrl]),
    ).sort()
    existing.receivedAtMs = Math.max(existing.receivedAtMs, envelope.receivedAtMs)
  }

  return Array.from(mergedById.values()).sort((left, right) => {
    if (left.event.created_at !== right.event.created_at) {
      return left.event.created_at - right.event.created_at
    }

    return left.event.id.localeCompare(right.event.id)
  })
}

function serializeZapReceiptEvent(event: Event): ZapReceiptInput {
  return {
    id: event.id,
    kind: event.kind,
    createdAt: event.created_at,
    tags: event.tags,
  }
}

function buildZapLayerMessage({
  status,
  edgeCount,
  skippedReceipts,
  loadedFrom,
}: {
  status: 'loading' | 'enabled' | 'unavailable'
  edgeCount: number
  skippedReceipts: number
  loadedFrom: 'cache' | 'live'
}): string {
  if (status === 'loading') {
    return ZAP_LAYER_LOADING_MESSAGE
  }

  const skippedLabel =
    skippedReceipts > 0
      ? ` ${skippedReceipts} recibos omitidos por decode.`
      : ''

  if (status === 'unavailable' || edgeCount === 0) {
    return `No hay recibos de zap utilizables para los nodos visibles.${skippedLabel}`
  }

  return `${edgeCount} edges de zap listos desde ${loadedFrom}.${skippedLabel}`
}

function buildDiscoveredGraphAnalysisMessage(result: {
  mode: 'full' | 'heuristic'
  confidence: 'low' | 'medium' | 'high'
  communityCount: number
  analyzedNodeCount: number
  relayHealth: {
    healthyRelayCount: number
    degradedRelayCount: number
    offlineRelayCount: number
  }
  flags: readonly string[]
}) {
  const relaySummary = `${result.relayHealth.healthyRelayCount} sanos / ${result.relayHealth.degradedRelayCount + result.relayHealth.offlineRelayCount} degradados`

  if (result.mode === 'heuristic') {
    return `Agrupacion tentativa para ${result.analyzedNodeCount} nodos del vecindario descubierto. ${relaySummary}.`
  }

  if (result.confidence !== 'high' || result.flags.length > 0) {
    return `Grupos detectados para ${result.analyzedNodeCount} nodos con confianza ${result.confidence}. ${relaySummary}.`
  }

  return `${result.communityCount} grupos detectados en ${result.analyzedNodeCount} nodos del vecindario descubierto. ${relaySummary}.`
}

function buildDiscoveredMessage(
  discoveredFollowCount: number,
  hasPartialSignals: boolean,
  loadedFromCache: boolean = false,
  acceptedNodesCount?: number,
): string {
  if (discoveredFollowCount === 0) {
    return `Sin follows descubiertos. ${COVERAGE_RECOVERY_MESSAGE}`
  }

  const nodesInfo = acceptedNodesCount !== undefined
    ? ` (${acceptedNodesCount} nodos nuevos en el grafo)`
    : ''

  const prefix = loadedFromCache
    ? `${discoveredFollowCount} follows descubiertos desde cache local${nodesInfo}`
    : `${discoveredFollowCount} follows descubiertos${nodesInfo}`

  if (hasPartialSignals) {
    return `${prefix} con degradacion parcial.`
  }

  return `${prefix}.`
}

function buildContactListPartialMessage(options: {
  discoveredFollowCount: number
  diagnostics: readonly { code: string }[]
  rejectedPubkeyCount: number
  maxGraphNodes?: number
  loadedFromCache?: boolean
  acceptedNodesCount?: number
}): string | null {
  const {
    discoveredFollowCount,
    diagnostics,
    rejectedPubkeyCount,
    maxGraphNodes,
    loadedFromCache = false,
    acceptedNodesCount,
  } = options

  if (discoveredFollowCount === 0) {
    return null
  }

  const nodesInfo = acceptedNodesCount !== undefined
    ? ` (${acceptedNodesCount} nodos nuevos en el grafo)`
    : ''

  const prefix = loadedFromCache
    ? `${discoveredFollowCount} follows descubiertos desde cache local${nodesInfo}`
    : `${discoveredFollowCount} follows descubiertos${nodesInfo}`

  const hitFollowTagCap = diagnostics.some(
    (diagnostic) => diagnostic.code === 'FOLLOW_TAG_CAP_REACHED',
  )

  if (hitFollowTagCap && rejectedPubkeyCount > 0) {
    return `${prefix} con recorte local: la contact list supero el budget de parseo y ${rejectedPubkeyCount} pubkeys no entraron por el cap de ${maxGraphNodes ?? 'grafo'} nodos.`
  }

  if (hitFollowTagCap) {
    return `${prefix} con recorte local: la contact list supero el budget de parseo de follows del cliente.`
  }

  if (rejectedPubkeyCount > 0) {
    return `${prefix}, pero ${rejectedPubkeyCount} no entraron por el cap de ${maxGraphNodes ?? 'grafo'} nodos.`
  }

  return `${prefix} con degradacion parcial.`
}

function buildExpandedStructureMessage(options: {
  pubkey: string
  discoveredFollowCount: number
  discoveredFollowerCount: number
  hasPartialSignals: boolean
  authoredDiagnostics: readonly { code: string }[]
  rejectedPubkeyCount: number
  maxGraphNodes: number
  authoredLoadedFromCache?: boolean
  acceptedNodesCount: number
}): string {
  const authoredMessage =
    options.discoveredFollowCount > 0
      ? options.hasPartialSignals || options.authoredLoadedFromCache
        ? buildContactListPartialMessage({
            discoveredFollowCount: options.discoveredFollowCount,
            diagnostics: options.authoredDiagnostics,
            rejectedPubkeyCount: options.rejectedPubkeyCount,
            maxGraphNodes: options.maxGraphNodes,
            loadedFromCache: options.authoredLoadedFromCache,
            acceptedNodesCount: options.acceptedNodesCount,
          }) ??
          buildDiscoveredMessage(
            options.discoveredFollowCount,
            true,
            options.authoredLoadedFromCache,
            options.acceptedNodesCount,
          )
        : buildDiscoveredMessage(
            options.discoveredFollowCount,
            false,
            false,
            options.acceptedNodesCount,
          )
      : `Sin lista de follows descubierta para ${options.pubkey.slice(0, 8)}...`

  if (options.discoveredFollowerCount === 0) {
    return authoredMessage
  }

  return `${authoredMessage} ${options.discoveredFollowerCount} followers inbound reales descubiertos.`
}
