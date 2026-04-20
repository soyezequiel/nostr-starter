import type { Filter } from 'nostr-tools'
import type {
  GraphLink,
  GraphNode,
  RootCollectionProgress,
  RootCollectionProgressStatus,
  RootLoadState,
  RootVisibleLinkProgress,
} from '@/features/graph-runtime/app/store'
import {
  getAccountTraceConfig,
  isAccountTraceRoot,
  traceAccountFlow,
} from '@/features/graph-runtime/debug/accountTrace'
import type { RelayDiscoveryStatsRecord } from '@/features/graph-runtime/db/entities'
import type {
  RelayCountResult,
  RelayEventEnvelope,
  RelayHealthSnapshot,
} from '@/features/graph-runtime/nostr'
import type {
  LoadRootOptions,
  LoadRootResult,
  NodeDetailProfile,
} from '@/features/graph-runtime/kernel/runtime'
import type { KernelContext, RelayAdapterInstance } from '@/features/graph-runtime/kernel/modules/context'
import {
  COVERAGE_RECOVERY_MESSAGE,
  MAX_SESSION_RELAYS,
  NODE_EXPAND_CONNECT_TIMEOUT_MS,
  NODE_EXPAND_PAGE_TIMEOUT_MS,
  NODE_EXPAND_RETRY_COUNT,
  NODE_EXPAND_STRAGGLER_GRACE_MS,
  NODE_EXPAND_INBOUND_QUERY_LIMIT,
  ROOT_INBOUND_DISCOVERY_MAX_PAGES_PER_RELAY,
  ROOT_INBOUND_DISCOVERY_RELAY_LIMIT,
  ROOT_LOADING_MESSAGE,
} from '@/features/graph-runtime/kernel/modules/constants'
import {
  collectAdditionalPaginatedInboundFollowerEvents,
  collectInboundFollowerEvidence,
  collectRelayEvents,
  collectTargetedReciprocalFollowerEvidence,
  mergeBoundedRelayUrlSets,
  mapProfileRecordToNodeProfile,
  mergeInboundFollowerEvidence,
  mergeRelayUrlSets,
  type RelayCollectionResult,
  selectLatestReplaceableEvent,
  selectLatestReplaceableEventsByPubkey,
  serializeContactListEvent,
} from '@/features/graph-runtime/kernel/modules/helpers'
import type { AnalysisModule } from '@/features/graph-runtime/kernel/modules/analysis'
import type { PersistenceModule } from '@/features/graph-runtime/kernel/modules/persistence'
import type { ProfileHydrationModule } from '@/features/graph-runtime/kernel/modules/profile-hydration'
import type { RelaySessionModule } from '@/features/graph-runtime/kernel/modules/relay-session'
import { createFollowerDiscoveryModule } from '@/features/graph-runtime/kernel/modules/follower-discovery'
import type { ParseContactListResult } from '@/features/graph-runtime/workers/events/contracts'
import {
  buildContactListPartialMessage,
  buildDiscoveredMessage,
} from '@/features/graph-runtime/kernel/modules/text-helpers'
import { transitionRootLoad } from '@/features/graph-runtime/kernel/transitions/root-load'
interface CachedRootSnapshot {
  rootLabel: string | null
  rootProfile: NodeDetailProfile | null
  followPubkeys: string[]
  inboundFollowerPubkeys: string[]
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
const INITIAL_ROOT_DISCOVERY_RELAY_COUNT = 6

function summarizeRelayCountResults(countResults: readonly RelayCountResult[]) {
  const supportedResults = countResults.filter(
    (result) => result.supported && result.count !== null,
  )
  const positiveResults = supportedResults.filter((result) => (result.count ?? 0) > 0)
  const maxRelayCount = supportedResults.reduce(
    (maxCount, result) => Math.max(maxCount, result.count ?? 0),
    0,
  )
  const sumRelayCounts = supportedResults.reduce(
    (sum, result) => sum + (result.count ?? 0),
    0,
  )

  return {
    relayCount: countResults.length,
    supportedRelayCount: supportedResults.length,
    positiveRelayCount: positiveResults.length,
    maxRelayCount,
    sumRelayCounts,
    results: [...countResults]
      .map((result) => ({
        relayUrl: result.relayUrl,
        count: result.count,
        supported: result.supported,
        elapsedMs: result.elapsedMs,
        errorMessage: result.errorMessage,
      }))
      .sort((left, right) => {
        const leftCount = left.count ?? -1
        const rightCount = right.count ?? -1
        if (leftCount !== rightCount) {
          return rightCount - leftCount
        }

        if (left.supported !== right.supported) {
          return left.supported ? -1 : 1
        }

        return left.elapsedMs - right.elapsedMs
      }),
  }
}

function summarizeRelayCollectionResult(result: RelayCollectionResult) {
  const relayEventCounts = new Map<string, number>()
  const authorPubkeys = new Set<string>()
  const eventIds = new Set<string>()

  for (const envelope of result.events) {
    relayEventCounts.set(
      envelope.relayUrl,
      (relayEventCounts.get(envelope.relayUrl) ?? 0) + 1,
    )
    authorPubkeys.add(envelope.event.pubkey)
    eventIds.add(envelope.event.id)
  }

  return {
    eventCount: result.events.length,
    uniqueAuthorCount: authorPubkeys.size,
    uniqueEventIdCount: eventIds.size,
    duplicateEventIdCount: result.events.length - eventIds.size,
    errorMessage: result.error?.message ?? null,
    stats: result.summary
      ? {
          acceptedEvents: result.summary.stats.acceptedEvents,
          duplicateRelayEvents: result.summary.stats.duplicateRelayEvents,
          rejectedEvents: result.summary.stats.rejectedEvents,
        }
      : null,
    relayEventCounts: Array.from(
      relayEventCounts,
      ([relayUrl, eventCount]) => ({
        relayUrl,
        eventCount,
      }),
    ).sort((left, right) => {
      if (left.eventCount !== right.eventCount) {
        return right.eventCount - left.eventCount
      }

      return left.relayUrl.localeCompare(right.relayUrl)
    }),
    relayHealth: result.summary
      ? Object.values(result.summary.relayHealth)
          .map((health) => ({
            url: health.url,
            status: health.status,
            attempt: health.attempt,
            consecutiveFailures: health.consecutiveFailures,
            lastErrorCode: health.lastErrorCode ?? null,
            lastNotice: health.lastNotice ?? null,
            lastCloseReason: health.lastCloseReason ?? null,
            lastEventMs: health.lastEventMs ?? null,
            lastEoseMs: health.lastEoseMs ?? null,
          }))
          .sort((left, right) => left.url.localeCompare(right.url))
      : [],
  }
}

function createRootCollectionProgress(input: {
  status: RootCollectionProgressStatus
  loadedCount: number
  totalCount: number | null
  isTotalKnown: boolean
}): RootCollectionProgress {
  const loadedCount = Math.max(0, input.loadedCount)
  const totalCount =
    input.totalCount === null
      ? null
      : Math.max(0, Math.max(input.totalCount, loadedCount))

  return {
    status: input.status,
    loadedCount,
    totalCount,
    isTotalKnown: input.isTotalKnown && totalCount !== null,
  }
}

export function createRootLoaderModule(
  ctx: KernelContext,
  collaborators: {
    analysis: AnalysisModule
    persistence: PersistenceModule
    profileHydration: ProfileHydrationModule
    relaySession: RelaySessionModule
    zapLayer: {
      cancelActiveZapLoad: () => void
      getZapTargetPubkeys: () => string[]
      prefetchZapLayer: (targetPubkeys: string[], relayUrls: string[]) => Promise<void>
    }
  },
) {
  let activeLoadSession: ActiveLoadSession | null = null
  let loadSequence = 0
  const followerDiscovery = createFollowerDiscoveryModule(ctx, {
    analysis: collaborators.analysis,
    persistence: collaborators.persistence,
    profileHydration: collaborators.profileHydration,
  })
  function setRootLoadState(
    action:
      | 'start'
      | 'cache-hit'
      | 'live-ready'
      | 'live-partial'
      | 'live-empty'
      | 'error'
      | 'cancel',
    patch: Partial<RootLoadState> = {},
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
      setRootLoadState('cancel', { visibleLinkProgress: null })
    }
    cancelActiveLoad()
    collaborators.zapLayer.cancelActiveZapLoad()
    const loadId = loadSequence + 1
    loadSequence = loadId
    const loadStartedAt = ctx.now()
    const traceConfig = getAccountTraceConfig()
    const traceThisRoot = isAccountTraceRoot(rootPubkey)
    const storeState = ctx.store.getState()
    const preserveExistingGraph = options.preserveExistingGraph ?? false
    const bootstrapRelayUrls = mergeRelayUrlSets(options.bootstrapRelayUrls)
    const baseRelayUrls = options.useDefaultRelays
      ? ctx.defaultRelayUrls.slice()
      : options.relayUrls?.slice() ??
        (storeState.relayUrls.length > 0
          ? storeState.relayUrls.slice()
          : ctx.defaultRelayUrls.slice())
    const cachedRelayList = preserveExistingGraph
      ? null
      : await ctx.repositories.relayLists.get(rootPubkey)
    const relayUrlCandidates = mergeBoundedRelayUrlSets(
      MAX_SESSION_RELAYS,
      bootstrapRelayUrls,
      cachedRelayList?.readRelays,
      baseRelayUrls,
      cachedRelayList?.writeRelays,
    )
    const relayDiscoveryStats =
      await ctx.repositories.relayDiscoveryStats.getMany(relayUrlCandidates)
    const relayUrls = orderRelayUrlsByDiscoveryStats(
      relayUrlCandidates,
      relayDiscoveryStats,
      bootstrapRelayUrls,
    )
    if (traceThisRoot && traceConfig) {
      traceAccountFlow('rootLoader.loadRoot.start', {
        loadId,
        preserveExistingGraph,
        relayUrls,
        bootstrapRelayUrls,
        baseRelayUrls,
        targetPubkey: traceConfig.targetPubkey,
        initialRootDiscoveryRelayCount: INITIAL_ROOT_DISCOVERY_RELAY_COUNT,
        inboundQueryLimit: NODE_EXPAND_INBOUND_QUERY_LIMIT,
        inboundPaginationMaxPagesPerRelay:
          ROOT_INBOUND_DISCOVERY_MAX_PAGES_PER_RELAY,
        inboundPaginationRelayLimit: ROOT_INBOUND_DISCOVERY_RELAY_LIMIT,
        maxSessionRelays: MAX_SESSION_RELAYS,
        nodeExpandConnectTimeoutMs: NODE_EXPAND_CONNECT_TIMEOUT_MS,
        nodeExpandPageTimeoutMs: NODE_EXPAND_PAGE_TIMEOUT_MS,
        nodeExpandRetryCount: NODE_EXPAND_RETRY_COUNT,
        nodeExpandStragglerGraceMs: NODE_EXPAND_STRAGGLER_GRACE_MS,
      })
    }
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
    let followingLoadedCount = preserveExistingGraph
      ? countVisibleFollowsFromRoot(rootPubkey)
      : 0
    let followingTotalCount: number | null = null
    let followingTotalKnown = false
    let followersLoadedCount = preserveExistingGraph
      ? getCurrentInboundFollowerPubkeys(rootPubkey).length
      : 0
    let followersTotalCount: number | null = null
    let followersTotalKnown = false
    const buildVisibleLinkProgressSnapshot = (
      updatedAt: number,
      status: RootCollectionProgressStatus = 'loading',
      overrides: Partial<
        Pick<RootVisibleLinkProgress, 'visibleLinkCount' | 'contactListEventCount' | 'inboundCandidateEventCount' | 'lastRelayUrl'>
      > = {},
    ): RootVisibleLinkProgress => ({
      visibleLinkCount:
        overrides.visibleLinkCount ??
        (followingTotalCount === null && followingLoadedCount === 0
          ? null
          : followingLoadedCount),
      contactListEventCount: overrides.contactListEventCount ?? 0,
      inboundCandidateEventCount: overrides.inboundCandidateEventCount ?? 0,
      lastRelayUrl: overrides.lastRelayUrl ?? null,
      updatedAt,
      following: createRootCollectionProgress({
        status,
        loadedCount: followingLoadedCount,
        totalCount: followingTotalCount,
        isTotalKnown: followingTotalKnown,
      }),
      followers: createRootCollectionProgress({
        status,
        loadedCount: followersLoadedCount,
        totalCount: followersTotalCount,
        isTotalKnown: followersTotalKnown,
      }),
    })
    setRootLoadState('start', {
      message: preserveExistingGraph
        ? 'Reintentando la carga con el nuevo set de relays sin borrar el grafo visible...'
        : ROOT_LOADING_MESSAGE,
      loadedFrom: 'none',
      visibleLinkProgress: buildVisibleLinkProgressSnapshot(ctx.now(), 'loading', {
        visibleLinkCount: preserveExistingGraph ? followingLoadedCount : null,
      }),
    })
    const cachedSnapshot = preserveExistingGraph
      ? {
          rootLabel: null,
          rootProfile: null,
          followPubkeys: [],
          inboundFollowerPubkeys: [],
          relayHints: [],
        }
      : await loadCachedSnapshot(rootPubkey)
    if (traceThisRoot && traceConfig) {
      traceAccountFlow('rootLoader.cacheSnapshot', {
        followCount: cachedSnapshot.followPubkeys.length,
        inboundFollowerCount: cachedSnapshot.inboundFollowerPubkeys.length,
        cacheFollowIncludesTraceTarget: cachedSnapshot.followPubkeys.includes(
          traceConfig.targetPubkey,
        ),
        cacheInboundIncludesTraceTarget:
          cachedSnapshot.inboundFollowerPubkeys.includes(traceConfig.targetPubkey),
        relayHints: cachedSnapshot.relayHints,
      })
    }
    if (isStaleLoad(loadId)) {
      return finalize(rootPubkey, createCancelledResult(relayUrls))
    }
    if (!preserveExistingGraph) {
      replaceRootGraph(
        rootPubkey,
        cachedSnapshot.followPubkeys,
        cachedSnapshot.inboundFollowerPubkeys,
        cachedSnapshot.rootProfile?.name ?? cachedSnapshot.rootLabel,
        cachedSnapshot.rootProfile,
      )
      followingLoadedCount = countVisibleFollowsFromRoot(rootPubkey)
      followingTotalCount =
        cachedSnapshot.followPubkeys.length > 0
          ? cachedSnapshot.followPubkeys.length
          : 0
      followingTotalKnown = true
      followersLoadedCount = getCurrentInboundFollowerPubkeys(rootPubkey).length
      if (
        cachedSnapshot.followPubkeys.length > 0 ||
        cachedSnapshot.inboundFollowerPubkeys.length > 0
      ) {
        setRootLoadState('cache-hit', {
          message: `Mostrando ${cachedSnapshot.followPubkeys.length} follows y ${cachedSnapshot.inboundFollowerPubkeys.length} followers desde cache mientras llegan datos live.`,
          loadedFrom: 'cache',
          visibleLinkProgress: buildVisibleLinkProgressSnapshot(
            ctx.now(),
            'partial',
            {
              visibleLinkCount: followingLoadedCount,
            },
          ),
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
        [
          rootPubkey,
          ...cachedSnapshot.followPubkeys,
          ...cachedSnapshot.inboundFollowerPubkeys,
        ],
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
    let handoffToBackground = false
    let inboundCountProbeResults: RelayCountResult[] = []
    void followerDiscovery.refreshRelayList(
      adapter,
      rootPubkey,
      () => isStaleLoad(loadId),
    )
    void followerDiscovery
      .probeInboundFollowerCounts(
        adapter,
        rootPubkey,
        () => isStaleLoad(loadId),
      )
      .then((countResults) => {
        inboundCountProbeResults = countResults
        if (isStaleLoad(loadId)) {
          return
        }
        if (traceThisRoot) {
          traceAccountFlow('rootLoader.inboundCountProbe.result', {
            ...summarizeRelayCountResults(countResults),
          })
        }

        void ctx.repositories.relayDiscoveryStats
          .recordCountResults(countResults, ctx.now())
          .catch((error) => {
            console.warn('Relay COUNT stats persistence failed:', error)
          })

        const usefulCountResults = countResults
          .filter(
            (result) =>
              result.supported && result.count !== null && result.count > 0,
          )
          .sort((left, right) => {
            if ((left.count ?? 0) !== (right.count ?? 0)) {
              return (right.count ?? 0) - (left.count ?? 0)
            }

            return left.elapsedMs - right.elapsedMs
          })

        if (usefulCountResults.length === 0) {
          return
        }

        const topRelay = usefulCountResults[0]
        followersTotalCount = topRelay.count
        followersTotalKnown = false
        ctx.store.getState().setRootLoadState({
          message: `COUNT detecto evidencia inbound probable en ${usefulCountResults.length} relays; mejor candidato ${formatRelayProgressUrl(topRelay.relayUrl)} (${topRelay.count} eventos).`,
          visibleLinkProgress: buildVisibleLinkProgressSnapshot(ctx.now(), 'loading'),
        })
      })
    try {
      let contactListEventCount = 0
      let inboundCandidateEventCount = 0
      let visibleLinkCount =
        cachedSnapshot.followPubkeys.length > 0
          ? cachedSnapshot.followPubkeys.length
          : preserveExistingGraph
            ? countVisibleFollowsFromRoot(rootPubkey)
            : null
      let lastRelayUrl: string | null = null
      let lastProgressMessageAt = 0
      let latestProgressContactListEventId: string | null = null
      let fastContactListGraphEventId: string | null = null
      let firstFastContactListAppliedAt: number | null = null
      let contactListProgressParseSequence = 0
      let inboundProgressParseSequence = 0
      let lastInboundProgressParseAt = 0
      let inboundProgressTimer: ReturnType<typeof setTimeout> | null = null
      let pendingInboundProgressEnvelopes: RelayEventEnvelope[] = []
      const progressivelyHydratedInboundPubkeys = new Set<string>()
      const fastPathHydratedPubkeys = new Set<string>()
      let targetedReciprocalProgressEventId: string | null = null
      let progressiveTargetedReciprocalEvidence:
        | Awaited<ReturnType<typeof collectTargetedReciprocalFollowerEvidence>>
        | null = null
      let discoveryProgressActive = true
      const publishVisibleLinkProgress = (force = false) => {
        if (isStaleLoad(loadId) || !discoveryProgressActive) {
          return
        }

        const now = ctx.now()
        if (!force && now - lastProgressMessageAt < 350) {
          return
        }

        lastProgressMessageAt = now
        const progressStatus: RootCollectionProgressStatus =
          followingLoadedCount > 0 ||
          followersLoadedCount > 0 ||
          followingTotalCount !== null ||
          followersTotalCount !== null
            ? 'partial'
            : 'loading'
        const visibleCopy =
          visibleLinkCount === null
            ? 'todavia sin contact list parseada'
            : `${visibleLinkCount} follows visibles detectados`
        const relayCopy = lastRelayUrl
          ? ` Ultimo lote desde ${formatRelayProgressUrl(lastRelayUrl)}.`
          : ''

        ctx.store.getState().setRootLoadState({
          message: `Descubriendo links visibles: ${visibleCopy}. Contact lists recibidas: ${contactListEventCount}; candidatos inbound: ${inboundCandidateEventCount}.${relayCopy}`,
          visibleLinkProgress: buildVisibleLinkProgressSnapshot(
            now,
            progressStatus,
            {
              visibleLinkCount,
              contactListEventCount,
              inboundCandidateEventCount,
              lastRelayUrl,
            },
          ),
        })
      }
      const scheduleContactListProgressParse = (
        envelopes: readonly RelayEventEnvelope[],
      ) => {
        const latestEnvelope = selectLatestReplaceableEvent(Array.from(envelopes))
        if (
          !latestEnvelope ||
          latestEnvelope.event.id === latestProgressContactListEventId
        ) {
          return
        }

        latestProgressContactListEventId = latestEnvelope.event.id
        const parseSequence = contactListProgressParseSequence + 1
        contactListProgressParseSequence = parseSequence

        void ctx.eventsWorker
          .invoke('PARSE_CONTACT_LIST', {
            event: serializeContactListEvent(latestEnvelope.event),
          })
          .then((parsedContactList) => {
            if (
              isStaleLoad(loadId) ||
              !discoveryProgressActive ||
              parseSequence !== contactListProgressParseSequence
            ) {
              return
            }

            visibleLinkCount = parsedContactList.followPubkeys.length
            followingTotalCount = parsedContactList.followPubkeys.length
            followingTotalKnown = true
            if (traceThisRoot && traceConfig) {
              traceAccountFlow('rootLoader.contactListProgress.parsed', {
                eventId: latestEnvelope.event.id,
                relayUrl: latestEnvelope.relayUrl,
                followCount: parsedContactList.followPubkeys.length,
                contactListIncludesTraceTarget:
                  parsedContactList.followPubkeys.includes(traceConfig.targetPubkey),
              })
            }
            if (
              applyFastContactListGraph(
                latestEnvelope,
                parsedContactList,
              )
            ) {
              scheduleInboundProgressMerge(pendingInboundProgressEnvelopes, true)
              return
            }

            publishVisibleLinkProgress(true)
          })
          .catch(() => {
            publishVisibleLinkProgress(true)
          })
      }
      const scheduleInboundProgressMerge = (
        envelopes: readonly RelayEventEnvelope[],
        force = false,
      ) => {
        if (
          envelopes.length === 0 ||
          isStaleLoad(loadId) ||
          !discoveryProgressActive
        ) {
          return
        }

        pendingInboundProgressEnvelopes = Array.from(envelopes)
        if (fastContactListGraphEventId === null && visibleLinkCount === null) {
          return
        }

        const now = ctx.now()
        if (!force && now - lastInboundProgressParseAt < 450) {
          if (inboundProgressTimer === null) {
            inboundProgressTimer = setTimeout(() => {
              inboundProgressTimer = null
              scheduleInboundProgressMerge(pendingInboundProgressEnvelopes, true)
            }, Math.max(0, 450 - (now - lastInboundProgressParseAt)))
          }
          return
        }

        lastInboundProgressParseAt = now
        const parseSequence = inboundProgressParseSequence + 1
        inboundProgressParseSequence = parseSequence
        const latestInboundEvents = selectLatestReplaceableEventsByPubkey(
          pendingInboundProgressEnvelopes,
        )
        pendingInboundProgressEnvelopes = []

        void collectInboundFollowerEvidence(
          ctx.eventsWorker,
          latestInboundEvents,
          rootPubkey,
        )
          .then((progressiveEvidence) => {
            if (traceThisRoot && traceConfig) {
              traceAccountFlow('rootLoader.inboundProgress.result', {
                parsedEventCount: latestInboundEvents.length,
                followerCount: progressiveEvidence.followerPubkeys.length,
                includesTraceTarget: progressiveEvidence.followerPubkeys.includes(
                  traceConfig.targetPubkey,
                ),
                stale: isStaleLoad(loadId),
                discoveryProgressActive,
                parseSequence,
                currentParseSequence: inboundProgressParseSequence,
              })
            }
            if (
              isStaleLoad(loadId) ||
              !discoveryProgressActive ||
              parseSequence !== inboundProgressParseSequence ||
              progressiveEvidence.followerPubkeys.length === 0
            ) {
              return
            }

            const acceptedFollowerPubkeys =
              followerDiscovery.mergeProgressiveInboundFollowers(
                rootPubkey,
                progressiveEvidence.followerPubkeys,
                () => isStaleLoad(loadId),
              )
            followersLoadedCount = getCurrentInboundFollowerPubkeys(rootPubkey).length
            const hydrationTargets = acceptedFollowerPubkeys.filter((pubkey) => {
              if (progressivelyHydratedInboundPubkeys.has(pubkey)) {
                return false
              }

              progressivelyHydratedInboundPubkeys.add(pubkey)
              return true
            })

            followerDiscovery.hydrateInboundFollowerProfiles(
              hydrationTargets,
              relayUrls,
              () => isStaleLoad(loadId),
            )
            publishVisibleLinkProgress(true)
          })
          .catch(() => {
            publishVisibleLinkProgress(true)
          })
      }
      const scheduleTargetedReciprocalProgressMerge = (
        contactListEventId: string,
        followPubkeys: readonly string[],
        relayHints: readonly string[],
      ) => {
        const candidatePubkeys = Array.from(
          new Set(
            followPubkeys.filter(
              (followPubkey) => followPubkey && followPubkey !== rootPubkey,
            ),
          ),
        )

        if (traceThisRoot && traceConfig) {
          traceAccountFlow('rootLoader.targetedProgress.considered', {
            contactListEventId,
            candidateCount: candidatePubkeys.length,
            hasTraceTargetCandidate: candidatePubkeys.includes(
              traceConfig.targetPubkey,
            ),
            alreadyScheduledForEvent:
              targetedReciprocalProgressEventId === contactListEventId,
            isStale: isStaleLoad(loadId),
          })
        }
        if (
          candidatePubkeys.length === 0 ||
          targetedReciprocalProgressEventId === contactListEventId ||
          isStaleLoad(loadId)
        ) {
          return
        }

        targetedReciprocalProgressEventId = contactListEventId
        const targetedRelayUrls = mergeBoundedRelayUrlSets(
          MAX_SESSION_RELAYS,
          relayUrls,
          relayHints,
        )
        if (traceThisRoot && traceConfig) {
          traceAccountFlow('rootLoader.targetedProgress.scheduled', {
            contactListEventId,
            candidateCount: candidatePubkeys.length,
            hasTraceTargetCandidate: candidatePubkeys.includes(
              traceConfig.targetPubkey,
            ),
            targetedRelayUrls,
          })
        }
        const targetedAdapter = ctx.createRelayAdapter({
          relayUrls: targetedRelayUrls,
          connectTimeoutMs: NODE_EXPAND_CONNECT_TIMEOUT_MS,
          pageTimeoutMs: NODE_EXPAND_PAGE_TIMEOUT_MS,
          retryCount: NODE_EXPAND_RETRY_COUNT,
          stragglerGraceMs: NODE_EXPAND_STRAGGLER_GRACE_MS,
        })

        void collectTargetedReciprocalFollowerEvidence({
          adapter: targetedAdapter,
          eventsWorker: ctx.eventsWorker,
          followPubkeys: candidatePubkeys,
          targetPubkey: rootPubkey,
        })
          .then((targetedEvidence) => {
            if (traceThisRoot && traceConfig) {
              traceAccountFlow('rootLoader.targetedProgress.result', {
                followerCount: targetedEvidence.followerPubkeys.length,
                includesTraceTarget: targetedEvidence.followerPubkeys.includes(
                  traceConfig.targetPubkey,
                ),
                partial: targetedEvidence.partial,
                stale: isStaleLoad(loadId),
              })
            }
            if (
              isStaleLoad(loadId) ||
              targetedEvidence.followerPubkeys.length === 0
            ) {
              return
            }

            progressiveTargetedReciprocalEvidence =
              progressiveTargetedReciprocalEvidence === null
                ? targetedEvidence
                : mergeInboundFollowerEvidence(
                    progressiveTargetedReciprocalEvidence,
                    targetedEvidence,
                  )

            const acceptedFollowerPubkeys =
              followerDiscovery.mergeProgressiveInboundFollowers(
                rootPubkey,
                targetedEvidence.followerPubkeys,
                () => isStaleLoad(loadId),
              )
            followersLoadedCount = getCurrentInboundFollowerPubkeys(rootPubkey).length
            const hydrationTargets = acceptedFollowerPubkeys.filter((pubkey) => {
              if (progressivelyHydratedInboundPubkeys.has(pubkey)) {
                return false
              }

              progressivelyHydratedInboundPubkeys.add(pubkey)
              return true
            })

            followerDiscovery.hydrateInboundFollowerProfiles(
              hydrationTargets,
              targetedRelayUrls,
              () => isStaleLoad(loadId),
            )
            publishVisibleLinkProgress(true)
          })
          .catch((error) => {
            if (traceThisRoot) {
              traceAccountFlow('rootLoader.targetedProgress.error', {
                error,
              })
            }
            console.warn(
              'Background targeted reciprocal follower evidence failed during root load progress:',
              error,
            )
            publishVisibleLinkProgress(true)
          })
          .finally(() => {
            targetedAdapter.close()
          })
      }
      const applyFastContactListGraph = (
        envelope: RelayEventEnvelope,
        parsedContactList: ParseContactListResult,
      ): boolean => {
        if (isStaleLoad(loadId) || !discoveryProgressActive) {
          return false
        }

        if (envelope.event.pubkey !== rootPubkey) {
          return false
        }

        if (fastContactListGraphEventId === envelope.event.id) {
          return false
        }

        fastContactListGraphEventId = envelope.event.id
        const currentInboundFollowerPubkeys =
          getCurrentInboundFollowerPubkeys(rootPubkey)
        const preservedExpandedNeighborhood =
          captureExpandedNeighborhood(rootPubkey)
        const replacementResult = replaceRootGraph(
          rootPubkey,
          parsedContactList.followPubkeys,
          currentInboundFollowerPubkeys,
          cachedSnapshot.rootProfile?.name ?? cachedSnapshot.rootLabel,
          cachedSnapshot.rootProfile,
        )
        if (traceThisRoot && traceConfig) {
          traceAccountFlow('rootLoader.fastContactListGraph.applied', {
            eventId: envelope.event.id,
            relayUrl: envelope.relayUrl,
            followCount: parsedContactList.followPubkeys.length,
            contactListIncludesTraceTarget: parsedContactList.followPubkeys.includes(
              traceConfig.targetPubkey,
            ),
            currentInboundIncludesTraceTarget:
              currentInboundFollowerPubkeys.includes(traceConfig.targetPubkey),
            visiblePubkeysIncludesTraceTarget:
              replacementResult.visiblePubkeys.includes(traceConfig.targetPubkey),
            discoveredFollowCount: replacementResult.discoveredFollowCount,
            rejectedPubkeys: replacementResult.rejectedPubkeys,
          })
        }
        const restoredExpandedPubkeys = restoreExpandedNeighborhood(
          preservedExpandedNeighborhood,
        )
        const profileHydrationRelayUrls = mergeBoundedRelayUrlSets(
          MAX_PROFILE_HYDRATION_RELAY_URLS,
          relayUrls,
          parsedContactList.relayHints,
          cachedSnapshot.relayHints,
        )
        const hydrationTargets = Array.from(
          new Set([
            ...replacementResult.visiblePubkeys,
            ...restoredExpandedPubkeys,
          ]),
        ).filter((pubkey) => {
          if (fastPathHydratedPubkeys.has(pubkey)) {
            return false
          }

          fastPathHydratedPubkeys.add(pubkey)
          return true
        })

        void collaborators.profileHydration.hydrateNodeProfiles(
          hydrationTargets,
          profileHydrationRelayUrls,
          () => isStaleLoad(loadId),
          {
            persistProfileEvent: collaborators.persistence.persistProfileEvent,
          },
        )

        const now = ctx.now()
        if (firstFastContactListAppliedAt === null) {
          firstFastContactListAppliedAt = now
          console.info('[graph/root-loader] fast contact list graph applied', {
            elapsedMs: now - loadStartedAt,
            followCount: replacementResult.discoveredFollowCount,
            relayUrl: envelope.relayUrl,
            rootPubkey: rootPubkey.slice(0, 12),
          })
        }

        followingLoadedCount = replacementResult.discoveredFollowCount
        followersLoadedCount = getCurrentInboundFollowerPubkeys(rootPubkey).length
        ctx.store.getState().markGraphStale(false)
        setRootLoadState('live-partial', {
          message: `Contact list live recibida desde ${formatRelayProgressUrl(envelope.relayUrl)}: mostrando ${replacementResult.discoveredFollowCount} follows mientras continua la reconciliacion de relays e inbound.`,
          loadedFrom: 'live',
          visibleLinkProgress: buildVisibleLinkProgressSnapshot(
            now,
            'partial',
            {
              visibleLinkCount,
              contactListEventCount,
              inboundCandidateEventCount,
              lastRelayUrl,
            },
          ),
        })
        scheduleTargetedReciprocalProgressMerge(
          envelope.event.id,
          parsedContactList.followPubkeys,
          parsedContactList.relayHints,
        )

        return true
      }

      ctx.store.getState().setRootLoadState({
        message: `Consultando contact list kind:3 y followers inbound en ${relayUrls.length} relays activos...`,
      })
      publishVisibleLinkProgress(true)
      const initialRelayUrls = selectInitialRootDiscoveryRelayUrls(relayUrls)
      const finalRelayUrls = relayUrls.filter(
        (relayUrl) => !initialRelayUrls.includes(relayUrl),
      )
      const collectRootDiscoveryWave = async (
        waveRelayUrls: string[],
        offsets: {
          contactListEventCount: number
          inboundCandidateEventCount: number
        } = {
          contactListEventCount: 0,
          inboundCandidateEventCount: 0,
        },
        options: {
          adapter?: RelayAdapterInstance
          enableProgress?: boolean
        } = {},
      ) => {
        const waveAdapter = options.adapter ?? adapter
        const enableProgress = options.enableProgress ?? true
        if (traceThisRoot) {
          traceAccountFlow('rootLoader.discoveryWave.start', {
            waveRelayUrls,
            offsets,
            inboundQueryLimit: NODE_EXPAND_INBOUND_QUERY_LIMIT,
          })
        }

        const [contactListResult, inboundFollowerResult] = await Promise.all([
          collectRelayEvents(waveAdapter, [
            {
              authors: [rootPubkey],
              kinds: [3],
            } satisfies Filter,
          ], {
            relayUrls: waveRelayUrls,
            onProgress: (progress) => {
              if (!enableProgress) {
                return
              }
              contactListEventCount =
                offsets.contactListEventCount + progress.eventCount
              lastRelayUrl = progress.latestEnvelope?.relayUrl ?? lastRelayUrl
              scheduleContactListProgressParse(progress.envelopes)
              publishVisibleLinkProgress()
            },
          }),
          collectRelayEvents(waveAdapter, [
            {
              kinds: [3],
              '#p': [rootPubkey],
              limit: NODE_EXPAND_INBOUND_QUERY_LIMIT,
            } satisfies Filter & { '#p': string[] },
          ], {
            relayUrls: waveRelayUrls,
            onProgress: (progress) => {
              if (!enableProgress) {
                return
              }
              inboundCandidateEventCount =
                offsets.inboundCandidateEventCount + progress.eventCount
              lastRelayUrl = progress.latestEnvelope?.relayUrl ?? lastRelayUrl
              scheduleInboundProgressMerge(progress.envelopes)
              publishVisibleLinkProgress()
            },
          }),
        ])

        if (traceThisRoot) {
          traceAccountFlow('rootLoader.discoveryWave.result', {
            waveRelayUrls,
            contactList: summarizeRelayCollectionResult(contactListResult),
            inboundFollowers: summarizeRelayCollectionResult(
              inboundFollowerResult,
            ),
          })
        }

        return [contactListResult, inboundFollowerResult] as const
      }
      const startRemainingRelayEnrichment = (offsets: {
        contactListEventCount: number
        inboundCandidateEventCount: number
      }) => {
        if (finalRelayUrls.length === 0) {
          return
        }

        const orderedFinalRelayUrls = orderRelayUrlsByCountProbe(
          finalRelayUrls,
          inboundCountProbeResults,
        )
        if (traceThisRoot) {
          traceAccountFlow('rootLoader.remainingRelays.ordered', {
            finalRelayUrls,
            orderedFinalRelayUrls,
            countProbe: summarizeRelayCountResults(inboundCountProbeResults),
          })
        }

        const remainingAdapter = ctx.createRelayAdapter({
          relayUrls: orderedFinalRelayUrls,
        })
        void collectRootDiscoveryWave(orderedFinalRelayUrls, offsets, {
          adapter: remainingAdapter,
          enableProgress: false,
        })
          .then(async ([finalContactListResult, initialFinalInboundFollowerResult]) => {
            let finalInboundFollowerResult = initialFinalInboundFollowerResult
            if (traceThisRoot) {
              traceAccountFlow('rootLoader.remainingRelays.backgroundResult', {
                contactList: summarizeRelayCollectionResult(finalContactListResult),
                inboundFollowers: summarizeRelayCollectionResult(
                  finalInboundFollowerResult,
                ),
              })
            }
            if (isStaleLoad(loadId)) {
              return
            }

            const paginatedInboundFollowerResult =
              await collectAdditionalPaginatedInboundFollowerEvents({
                adapter: remainingAdapter,
                countResults: inboundCountProbeResults,
                isStale: () => isStaleLoad(loadId),
                relayUrls: orderedFinalRelayUrls,
                seedEnvelopes: finalInboundFollowerResult.events,
                targetPubkey: rootPubkey,
              })

            if (
              paginatedInboundFollowerResult.events.length > 0 ||
              paginatedInboundFollowerResult.error !== null
            ) {
              finalInboundFollowerResult = mergeRelayCollectionResults(
                finalInboundFollowerResult,
                paginatedInboundFollowerResult,
              )
            }

            if (traceThisRoot) {
              traceAccountFlow(
                'rootLoader.remainingRelays.backgroundPaginatedInboundResult',
                {
                  pageCount: paginatedInboundFollowerResult.pageCount,
                  newEventCount: paginatedInboundFollowerResult.events.length,
                  relaySummaries: paginatedInboundFollowerResult.relaySummaries,
                  inboundFollowers: summarizeRelayCollectionResult(
                    finalInboundFollowerResult,
                  ),
                },
              )
            }

            if (isStaleLoad(loadId) || finalInboundFollowerResult.events.length === 0) {
              return
            }

            const finalInboundEvidence = await collectInboundFollowerEvidence(
              ctx.eventsWorker,
              selectLatestReplaceableEventsByPubkey(
                finalInboundFollowerResult.events,
              ),
              rootPubkey,
              {
                onContactListParsed: (envelope, parsed) =>
                  collaborators.persistence.persistContactListEvent(
                    envelope,
                    parsed,
                  ),
              },
            )
            if (traceThisRoot && traceConfig) {
              traceAccountFlow(
                'rootLoader.remainingRelays.backgroundInboundEvidence',
                {
                  inboundCandidateEventCount:
                    finalInboundFollowerResult.events.length,
                  followerCount: finalInboundEvidence.followerPubkeys.length,
                  includesTraceTarget:
                    finalInboundEvidence.followerPubkeys.includes(
                      traceConfig.targetPubkey,
                    ),
                  partial: finalInboundEvidence.partial,
                },
              )
            }
            if (
              isStaleLoad(loadId) ||
              finalInboundEvidence.followerPubkeys.length === 0
            ) {
              return
            }

            const acceptedFollowerPubkeys =
              followerDiscovery.mergeProgressiveInboundFollowers(
                rootPubkey,
                finalInboundEvidence.followerPubkeys,
                () => isStaleLoad(loadId),
              )
            followersLoadedCount = getCurrentInboundFollowerPubkeys(rootPubkey).length
            followerDiscovery.hydrateInboundFollowerProfiles(
              acceptedFollowerPubkeys,
              orderedFinalRelayUrls,
              () => isStaleLoad(loadId),
            )
          })
          .catch((error) => {
            if (traceThisRoot) {
              traceAccountFlow('rootLoader.remainingRelays.backgroundError', {
                error,
              })
            }
            console.warn('Background remaining relay enrichment failed:', error)
          })
          .finally(() => {
            remainingAdapter.close()
          })
      }
      const completeRootDiscovery = async (
        initialContactListResult: RelayCollectionResult,
        initialInboundFollowerResult: RelayCollectionResult,
        {
          collectRemainingRelays,
          emitCompletion,
        }: { collectRemainingRelays: boolean; emitCompletion: boolean },
      ): Promise<LoadRootResult> => {
        const finishLoad = (result: LoadRootResult) =>
          emitCompletion ? finalize(rootPubkey, result) : result
        const contactListResult = initialContactListResult
        let inboundFollowerResult = initialInboundFollowerResult

        const orderedPaginationRelayUrls = orderRelayUrlsByCountProbe(
          relayUrls,
          inboundCountProbeResults,
        )
        if (traceThisRoot) {
          traceAccountFlow('rootLoader.paginatedInboundEvidence.beforeStart', {
            orderedPaginationRelayUrls,
            seedEventCount: inboundFollowerResult.events.length,
            seedSummary: summarizeRelayCollectionResult(inboundFollowerResult),
            countProbe: summarizeRelayCountResults(inboundCountProbeResults),
          })
        }

        const paginatedInboundFollowerResult =
          await collectAdditionalPaginatedInboundFollowerEvents({
            adapter,
            countResults: inboundCountProbeResults,
            isStale: () => isStaleLoad(loadId),
            onPage: (progress) => {
              inboundCandidateEventCount =
                inboundFollowerResult.events.length + progress.totalNewEventCount
              lastRelayUrl = progress.relayUrl
              scheduleInboundProgressMerge(progress.newEnvelopes, true)
              const totalLabel =
                progress.knownCount === null
                  ? ''
                  : ` de ~${progress.knownCount}`
              ctx.store.getState().setRootLoadState({
                message: `Paginando followers inbound en ${formatRelayProgressUrl(progress.relayUrl)}: +${progress.newEventCount} eventos nuevos${totalLabel}.`,
                visibleLinkProgress: buildVisibleLinkProgressSnapshot(
                  ctx.now(),
                  'partial',
                  {
                    visibleLinkCount: followingLoadedCount,
                    contactListEventCount: contactListResult.events.length,
                    inboundCandidateEventCount,
                    lastRelayUrl,
                  },
                ),
              })
            },
            relayUrls: orderedPaginationRelayUrls,
            seedEnvelopes: inboundFollowerResult.events,
            targetPubkey: rootPubkey,
          })

        if (
          paginatedInboundFollowerResult.events.length > 0 ||
          paginatedInboundFollowerResult.error !== null
        ) {
          inboundFollowerResult = mergeRelayCollectionResults(
            inboundFollowerResult,
            paginatedInboundFollowerResult,
          )
        }
        if (traceThisRoot) {
          traceAccountFlow('rootLoader.paginatedInboundEvidence.result', {
            pageCount: paginatedInboundFollowerResult.pageCount,
            newEventCount: paginatedInboundFollowerResult.events.length,
            relaySummaries: paginatedInboundFollowerResult.relaySummaries,
            inboundCandidateFetch: summarizeRelayCollectionResult(
              inboundFollowerResult,
            ),
          })
        }

        if (collectRemainingRelays) {
          startRemainingRelayEnrichment({
            contactListEventCount: contactListResult.events.length,
            inboundCandidateEventCount: inboundFollowerResult.events.length,
          })
        }

        discoveryProgressActive = false
        if (inboundProgressTimer !== null) {
          clearTimeout(inboundProgressTimer)
          inboundProgressTimer = null
        }
        if (isStaleLoad(loadId)) {
          return finishLoad(createCancelledResult(relayUrls))
        }
        void ctx.repositories.relayDiscoveryStats
          .recordInboundFetch(
            rootPubkey,
            relayUrls,
            inboundFollowerResult.events.map((envelope) => ({
              relayUrl: envelope.relayUrl,
              eventId: envelope.event.id,
            })),
            ctx.now(),
          )
          .catch((error) => {
            console.warn('Relay inbound fetch stats persistence failed:', error)
          })
        ctx.store.getState().setRootLoadState({
          message: 'Correlacionando followers inbound con evidencia recibida de relays...',
        })
        let inboundFollowerEvidence = await collectInboundFollowerEvidence(
          ctx.eventsWorker,
          selectLatestReplaceableEventsByPubkey(inboundFollowerResult.events),
          rootPubkey,
          {
            onContactListParsed: (envelope, parsed) =>
              collaborators.persistence.persistContactListEvent(envelope, parsed),
          },
        )
        if (traceThisRoot && traceConfig) {
          traceAccountFlow('rootLoader.finalInboundEvidence.result', {
            inboundCandidateEventCount: inboundFollowerResult.events.length,
            inboundCandidateFetch: summarizeRelayCollectionResult(
              inboundFollowerResult,
            ),
            followerCount: inboundFollowerEvidence.followerPubkeys.length,
            includesTraceTarget: inboundFollowerEvidence.followerPubkeys.includes(
              traceConfig.targetPubkey,
            ),
            partial: inboundFollowerEvidence.partial,
          })
        }
        if (inboundFollowerEvidence.followerPubkeys.length > 0) {
          void followerDiscovery.persistInboundFollowerSnapshot(
            rootPubkey,
            inboundFollowerEvidence.followerPubkeys,
            inboundFollowerResult.events,
            relayUrls,
            'partial',
          )
        }
        if (isStaleLoad(loadId)) {
          return finishLoad(createCancelledResult(relayUrls))
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
              visibleLinkProgress: buildVisibleLinkProgressSnapshot(
                ctx.now(),
                'complete',
                {
                  visibleLinkCount:
                    visibleLinkCount ?? followingLoadedCount ?? null,
                  contactListEventCount,
                  inboundCandidateEventCount,
                  lastRelayUrl,
                },
              ),
            })
          }
          if (!preserveExistingGraph) {
            const profileHydrationRelayUrls = mergeBoundedRelayUrlSets(
              MAX_PROFILE_HYDRATION_RELAY_URLS,
              relayUrls,
              cachedSnapshot.relayHints,
            )
            void collaborators.profileHydration.hydrateNodeProfiles(
              [
                rootPubkey,
                ...cachedSnapshot.followPubkeys,
                ...cachedSnapshot.inboundFollowerPubkeys,
              ],
              profileHydrationRelayUrls,
              () => isStaleLoad(loadId),
              {
                persistProfileEvent:
                  collaborators.persistence.persistProfileEvent,
              },
            )
            void collaborators.zapLayer.prefetchZapLayer(
              collaborators.zapLayer.getZapTargetPubkeys(),
              relayUrls,
            )
          }
          return finishLoad(fallbackResult)
        }
        ctx.store.getState().setRootLoadState({
          message: 'Parseando contact list kind:3 en worker antes de actualizar el grafo...',
        })
        const parsedContactList = await ctx.eventsWorker.invoke(
          'PARSE_CONTACT_LIST',
          {
            event: serializeContactListEvent(latestContactListEvent.event),
          },
        )
        followingTotalCount = parsedContactList.followPubkeys.length
        followingTotalKnown = true
        if (traceThisRoot && traceConfig) {
          traceAccountFlow('rootLoader.finalContactList.parsed', {
            eventId: latestContactListEvent.event.id,
            relayUrl: latestContactListEvent.relayUrl,
            followCount: parsedContactList.followPubkeys.length,
            contactListIncludesTraceTarget: parsedContactList.followPubkeys.includes(
              traceConfig.targetPubkey,
            ),
          })
        }
        if (isStaleLoad(loadId)) {
          return finishLoad(createCancelledResult(relayUrls))
        }
        const hasTargetedReciprocalCandidates = parsedContactList.followPubkeys.some(
          (followPubkey) => followPubkey.length > 0 && followPubkey !== rootPubkey,
        )
        const targetedReciprocalFollowerPartial =
          hasTargetedReciprocalCandidates &&
          progressiveTargetedReciprocalEvidence === null
        scheduleTargetedReciprocalProgressMerge(
          latestContactListEvent.event.id,
          parsedContactList.followPubkeys,
          parsedContactList.relayHints,
        )
        if (traceThisRoot && traceConfig) {
          traceAccountFlow('rootLoader.finalTargetedEvidence.backgroundQueued', {
            hasTargetedReciprocalCandidates,
            alreadyHasProgressiveEvidence:
              progressiveTargetedReciprocalEvidence !== null,
            partial: targetedReciprocalFollowerPartial,
          })
        }
        if (progressiveTargetedReciprocalEvidence !== null) {
          if (traceThisRoot && traceConfig) {
            traceAccountFlow('rootLoader.progressiveTargetedEvidence.mergeFinal', {
              followerCount:
                progressiveTargetedReciprocalEvidence.followerPubkeys.length,
              includesTraceTarget:
                progressiveTargetedReciprocalEvidence.followerPubkeys.includes(
                  traceConfig.targetPubkey,
                ),
              partial: progressiveTargetedReciprocalEvidence.partial,
            })
          }
          inboundFollowerEvidence = mergeInboundFollowerEvidence(
            inboundFollowerEvidence,
            progressiveTargetedReciprocalEvidence,
          )
        }
        followersTotalCount =
          followersTotalCount === null
            ? inboundFollowerEvidence.followerPubkeys.length
            : Math.max(
                followersTotalCount,
                inboundFollowerEvidence.followerPubkeys.length,
              )
        followersTotalKnown = false
        if (traceThisRoot && traceConfig) {
          traceAccountFlow('rootLoader.finalMergedInboundEvidence', {
            followerCount: inboundFollowerEvidence.followerPubkeys.length,
            displayedTotalCount: followersTotalCount,
            displayedTotalKnown: followersTotalKnown,
            includesTraceTarget: inboundFollowerEvidence.followerPubkeys.includes(
              traceConfig.targetPubkey,
            ),
            partial: inboundFollowerEvidence.partial,
            countProbe: summarizeRelayCountResults(inboundCountProbeResults),
            inboundCandidateFetch: summarizeRelayCollectionResult(
              inboundFollowerResult,
            ),
          })
        }
        if (isStaleLoad(loadId)) {
          return finishLoad(createCancelledResult(relayUrls))
        }
        ctx.store.getState().setRootLoadState({
          message: 'Persistiendo contact list y preparando merge del vecindario...',
        })
        await collaborators.persistence.persistContactListEvent(
          latestContactListEvent,
          parsedContactList,
        )
        void followerDiscovery.persistInboundFollowerSnapshot(
          rootPubkey,
          inboundFollowerEvidence.followerPubkeys,
          inboundFollowerResult.events,
          relayUrls,
          'final',
        )
        const preservedExpandedNeighborhood =
          captureExpandedNeighborhood(rootPubkey)
        ctx.store.getState().setRootLoadState({
          message:
            'Integrando nodos, follows y followers inbound sin perder expansiones visibles...',
        })
        const replacementResult = replaceRootGraph(
          rootPubkey,
          parsedContactList.followPubkeys,
          inboundFollowerEvidence.followerPubkeys,
          cachedSnapshot.rootProfile?.name ?? cachedSnapshot.rootLabel,
          cachedSnapshot.rootProfile,
        )
        if (traceThisRoot && traceConfig) {
          traceAccountFlow('rootLoader.finalReplaceRootGraph.result', {
            followInputIncludesTraceTarget: parsedContactList.followPubkeys.includes(
              traceConfig.targetPubkey,
            ),
            inboundInputIncludesTraceTarget:
              inboundFollowerEvidence.followerPubkeys.includes(
                traceConfig.targetPubkey,
              ),
            visiblePubkeysIncludesTraceTarget:
              replacementResult.visiblePubkeys.includes(traceConfig.targetPubkey),
            inboundInputCount: inboundFollowerEvidence.followerPubkeys.length,
            visiblePubkeyCount: replacementResult.visiblePubkeys.length,
            discoveredFollowCount: replacementResult.discoveredFollowCount,
            rejectedPubkeys: replacementResult.rejectedPubkeys,
            graphCaps: ctx.store.getState().graphCaps,
          })
        }
        followingLoadedCount = replacementResult.discoveredFollowCount
        followersLoadedCount = getCurrentInboundFollowerPubkeys(rootPubkey).length
        const restoredExpandedPubkeys = restoreExpandedNeighborhood(
          preservedExpandedNeighborhood,
        )
        const profileHydrationRelayUrls = mergeBoundedRelayUrlSets(
          MAX_PROFILE_HYDRATION_RELAY_URLS,
          relayUrls,
          parsedContactList.relayHints,
          cachedSnapshot.relayHints,
        )
        ctx.store.getState().setRootLoadState({
          message:
            'Grafo inicial cargado. Enriqueciendo followers, perfiles y zaps...',
        })
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
            visibleLinkProgress: buildVisibleLinkProgressSnapshot(
              ctx.now(),
              'complete',
              {
                visibleLinkCount: followingLoadedCount,
                contactListEventCount: contactListResult.events.length,
                inboundCandidateEventCount: inboundFollowerResult.events.length,
                lastRelayUrl,
              },
            ),
          },
        )
        return finishLoad({
          status,
          loadedFrom: 'live',
          discoveredFollowCount: replacementResult.discoveredFollowCount,
          message,
          relayHealth,
        })
      }

      const [initialContactListResult, initialInboundFollowerResult] =
        await collectRootDiscoveryWave(initialRelayUrls)
      if (firstFastContactListAppliedAt !== null && !isStaleLoad(loadId)) {
        discoveryProgressActive = false
        if (inboundProgressTimer !== null) {
          clearTimeout(inboundProgressTimer)
          inboundProgressTimer = null
        }
        const relayHealth = collaborators.relaySession.resolveRelayHealthSnapshot(
          relayUrls,
          initialContactListResult,
          activeLoadSession?.adapter.getRelayHealth(),
        )
        const initialMessage =
          'Grafo inicial cargado. Enriqueciendo followers, perfiles y zaps...'
        setRootLoadState('live-partial', {
          message: initialMessage,
          loadedFrom: 'live',
          visibleLinkProgress: buildVisibleLinkProgressSnapshot(
            ctx.now(),
            'partial',
            {
              visibleLinkCount: followingLoadedCount,
              contactListEventCount: initialContactListResult.events.length,
              inboundCandidateEventCount: initialInboundFollowerResult.events.length,
              lastRelayUrl,
            },
          ),
        })
        handoffToBackground = true
        void completeRootDiscovery(
          initialContactListResult,
          initialInboundFollowerResult,
          {
            collectRemainingRelays: true,
            emitCompletion: false,
          },
        )
          .catch((error) => {
            if (!isStaleLoad(loadId)) {
              console.warn('Background root enrichment failed:', error)
              setRootLoadState('live-partial', {
                message:
                  'Grafo inicial cargado. La mejora de followers/perfiles/zaps quedo parcial.',
              })
            }
          })
          .finally(() => {
            if (activeLoadSession?.loadId === loadId) {
              activeLoadSession.detachRelayHealth()
              activeLoadSession.adapter.close()
              activeLoadSession = null
            }
          })
        return finalize(rootPubkey, {
          status: 'partial',
          loadedFrom: 'live',
          discoveredFollowCount: followingLoadedCount,
          message: initialMessage,
          relayHealth,
        })
      }

      return completeRootDiscovery(
        initialContactListResult,
        initialInboundFollowerResult,
        {
          collectRemainingRelays: true,
          emitCompletion: true,
        },
      )
    } finally {
      if (!handoffToBackground && activeLoadSession?.loadId === loadId) {
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
    const [contactList, profile, inboundFollowerSnapshot] = await Promise.all([
      ctx.repositories.contactLists.get(rootPubkey),
      ctx.repositories.profiles.get(rootPubkey),
      ctx.repositories.inboundFollowerSnapshots.get(rootPubkey),
    ])
    return {
      rootLabel: profile?.name ?? null,
      rootProfile: profile ? mapProfileRecordToNodeProfile(profile) : null,
      followPubkeys: contactList?.follows ?? [],
      inboundFollowerPubkeys: inboundFollowerSnapshot?.followerPubkeys ?? [],
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
    const previousRootPubkey = state.rootNodePubkey
    const previousNodes = state.nodes
    state.resetGraphAnalysis()
    state.resetZapLayer()
    state.setSelectedNodePubkey(null)
    state.clearComparedNodes()
    if (previousRootPubkey !== rootPubkey) {
      state.setFixedRootPubkey(rootPubkey)
    }
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
          profileSource: previousNode.profileSource ?? null,
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
          profileSource: fallbackProfile.profileSource ?? null,
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
          profileSource: null,
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
    const nodeResult = state.replaceGraphSnapshot({
      rootNodePubkey: rootPubkey,
      nodes,
      links: followPubkeys.map((pubkey) => ({
        source: rootPubkey,
        target: pubkey,
        relation: 'follow' as const,
      })),
      inboundLinks: inboundFollowerPubkeys
        .filter((pubkey) => pubkey !== rootPubkey)
        .map((pubkey) => ({
          source: pubkey,
          target: rootPubkey,
          relation: 'inbound' as const,
        })),
    })
    const acceptedFollowPubkeys = followPubkeys.filter((pubkey) =>
      nodeResult.acceptedPubkeys.includes(pubkey),
    )
    const acceptedInboundFollowerPubkeys = inboundFollowerPubkeys.filter(
      (pubkey) =>
        pubkey !== rootPubkey &&
        nodeResult.acceptedPubkeys.includes(pubkey),
    )
    if (isAccountTraceRoot(rootPubkey)) {
      const traceConfig = getAccountTraceConfig()
      if (traceConfig) {
        const afterState = ctx.store.getState()
        traceAccountFlow('rootLoader.replaceRootGraph.afterStoreWrite', {
          followInputIncludesTraceTarget: followPubkeys.includes(
            traceConfig.targetPubkey,
          ),
          inboundInputIncludesTraceTarget: inboundFollowerPubkeys.includes(
            traceConfig.targetPubkey,
          ),
          acceptedFollowIncludesTraceTarget: acceptedFollowPubkeys.includes(
            traceConfig.targetPubkey,
          ),
          acceptedInboundIncludesTraceTarget:
            acceptedInboundFollowerPubkeys.includes(traceConfig.targetPubkey),
          hasTraceTargetNode: Boolean(afterState.nodes[traceConfig.targetPubkey]),
          hasRootToTraceTargetFollowLink: afterState.links.some(
            (link) =>
              link.source === rootPubkey &&
              link.target === traceConfig.targetPubkey &&
              link.relation === 'follow',
          ),
          hasTraceTargetToRootInboundLink: afterState.inboundLinks.some(
            (link) =>
              link.source === traceConfig.targetPubkey &&
              link.target === rootPubkey &&
              link.relation === 'inbound',
          ),
          graphRevision: afterState.graphRevision,
          inboundGraphRevision: afterState.inboundGraphRevision,
        })
      }
    }
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
  function getCurrentInboundFollowerPubkeys(rootPubkey: string): string[] {
    const state = ctx.store.getState()
    if (state.rootNodePubkey !== rootPubkey) {
      return []
    }

    return Array.from(
      new Set(
        (state.inboundAdjacency[rootPubkey] ?? []).filter(
          (pubkey) => pubkey && pubkey !== rootPubkey,
        ),
      ),
    ).sort()
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
  function selectInitialRootDiscoveryRelayUrls(relayUrls: readonly string[]): string[] {
    return relayUrls.slice(
      0,
      Math.min(INITIAL_ROOT_DISCOVERY_RELAY_COUNT, relayUrls.length),
    )
  }
  function orderRelayUrlsByDiscoveryStats(
    relayUrls: readonly string[],
    statsRecords: readonly (RelayDiscoveryStatsRecord | undefined)[],
    pinnedRelayUrls: readonly string[],
  ): string[] {
    if (relayUrls.length <= 1) {
      return [...relayUrls]
    }

    const statsByRelayUrl = new Map(
      statsRecords
        .filter((record): record is RelayDiscoveryStatsRecord => record !== undefined)
        .map((record) => [record.relayUrl, record]),
    )
    const pinnedRelayUrlSet = new Set(pinnedRelayUrls)

    return [...relayUrls].sort((leftRelayUrl, rightRelayUrl) => {
      const leftPinned = pinnedRelayUrlSet.has(leftRelayUrl) ? 1 : 0
      const rightPinned = pinnedRelayUrlSet.has(rightRelayUrl) ? 1 : 0

      if (leftPinned !== rightPinned) {
        return rightPinned - leftPinned
      }

      const leftScore = scoreRelayDiscoveryStats(statsByRelayUrl.get(leftRelayUrl))
      const rightScore = scoreRelayDiscoveryStats(statsByRelayUrl.get(rightRelayUrl))

      if (leftScore !== rightScore) {
        return rightScore - leftScore
      }

      return relayUrls.indexOf(leftRelayUrl) - relayUrls.indexOf(rightRelayUrl)
    })
  }
  function scoreRelayDiscoveryStats(
    stats: RelayDiscoveryStatsRecord | undefined,
  ): number {
    if (!stats) {
      return 0
    }

    const countSuccessRate =
      stats.countAttempts > 0 ? stats.countSuccesses / stats.countAttempts : 0
    const fetchSuccessRate =
      stats.fetchAttempts > 0 ? stats.fetchSuccesses / stats.fetchAttempts : 0
    const latencyPenalty =
      stats.lastCountLatencyMs === null
        ? 0
        : Math.min(4, stats.lastCountLatencyMs / 1_000)
    const countEvidence = Math.log1p(Math.max(0, stats.lastCount ?? 0))
    const inboundEvidence = Math.log1p(stats.totalInboundEventCount)

    return (
      countSuccessRate * 18 +
      fetchSuccessRate * 24 +
      countEvidence * 5 +
      inboundEvidence * 7 +
      stats.usefulRootCount * 2 -
      stats.countUnsupporteds * 0.5 -
      stats.countFailures -
      latencyPenalty
    )
  }
  function mergeRelayCollectionResults(
    left: RelayCollectionResult,
    right: RelayCollectionResult,
  ): RelayCollectionResult {
    return {
      events: [...left.events, ...right.events],
      summary: right.summary ?? left.summary,
      error: left.error ?? right.error,
    }
  }
  function orderRelayUrlsByCountProbe(
    relayUrls: readonly string[],
    countResults: readonly RelayCountResult[],
  ): string[] {
    if (countResults.length === 0) {
      return [...relayUrls]
    }

    const countByRelayUrl = new Map(
      countResults.map((result) => [result.relayUrl, result]),
    )

    return [...relayUrls].sort((leftRelayUrl, rightRelayUrl) => {
      const left = countByRelayUrl.get(leftRelayUrl)
      const right = countByRelayUrl.get(rightRelayUrl)
      const leftCount = left?.count ?? -1
      const rightCount = right?.count ?? -1

      if (leftCount !== rightCount) {
        return rightCount - leftCount
      }

      const leftSupported = left?.supported ? 1 : 0
      const rightSupported = right?.supported ? 1 : 0
      if (leftSupported !== rightSupported) {
        return rightSupported - leftSupported
      }

      return (left?.elapsedMs ?? Number.MAX_SAFE_INTEGER) -
        (right?.elapsedMs ?? Number.MAX_SAFE_INTEGER)
    })
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
  function formatRelayProgressUrl(relayUrl: string): string {
    try {
      return new URL(relayUrl).host || relayUrl
    } catch {
      return relayUrl
    }
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
