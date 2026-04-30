import { createKernelEventEmitter } from '@/features/graph-runtime/kernel/events'
import type { AppKernelDependencies } from '@/features/graph-runtime/kernel/modules/context'
import { createAnalysisModule } from '@/features/graph-runtime/kernel/modules/analysis'
import { createExportModule } from '@/features/graph-runtime/kernel/modules/export-orch'
import {
  collectRelayEvents,
  runWithConcurrencyLimit,
  chunkIntoBatches,
  selectLatestReplaceableEventsByPubkey,
  serializeContactListEvent,
} from '@/features/graph-runtime/kernel/modules/helpers'
import { createNodeDetailModule } from '@/features/graph-runtime/kernel/modules/node-detail'
import { createNodeExpansionModule } from '@/features/graph-runtime/kernel/modules/node-expansion'
import { createPersistenceModule } from '@/features/graph-runtime/kernel/modules/persistence'
import { createProfileHydrationModule } from '@/features/graph-runtime/kernel/modules/profile-hydration'
import { createRelaySessionModule } from '@/features/graph-runtime/kernel/modules/relay-session'
import { createRootLoaderModule } from '@/features/graph-runtime/kernel/modules/root-loader'
import { createZapLayerModule } from '@/features/graph-runtime/kernel/modules/zap-layer'
import {
  logTerminalWarning,
  summarizeHumanTerminalError,
} from '@/features/graph-runtime/debug/humanTerminalLog'
import {
  compareConnectionPubkeys,
  createConnectionsDerivedState,
  type ConnectionContactListRecord,
} from '@/features/graph-runtime/kernel/connections'
import type { RootLoader, ToggleLayerResult } from '@/features/graph-runtime/kernel/runtime'
import type { UiLayer } from '@/features/graph-runtime/app/store'
import type { RelayEventEnvelope } from '@/features/graph-runtime/nostr'

const CONNECTIONS_CACHE_LOOKUP_CONCURRENCY = 24
const CONNECTIONS_FETCH_BATCH_SIZE = 25
const CONNECTIONS_FETCH_CONCURRENCY = 3
const CONNECTIONS_PARSE_CONCURRENCY = 8
const CONNECTIONS_PUBLISH_THROTTLE_MS = 1_000
const CONNECTIONS_PUBLISH_MIN_CONTACT_LIST_UPDATES = 500

const isRelayEventNewerThanContactList = (
  current: ConnectionContactListRecord | undefined,
  envelope: RelayEventEnvelope,
) => {
  if (!current) {
    return true
  }

  if (envelope.event.created_at !== current.createdAt) {
    return envelope.event.created_at > current.createdAt
  }

  return envelope.event.id.localeCompare(current.eventId) < 0
}

export function createKernelFacade(dependencies: AppKernelDependencies) {
  const emitter = createKernelEventEmitter()
  const ctx = {
    ...dependencies,
    defaultRelayUrls: dependencies.defaultRelayUrls?.slice() ?? [],
    now: dependencies.now ?? (() => Date.now()),
    emitter,
  }

  const analysis = createAnalysisModule(ctx)
  const profileHydration = createProfileHydrationModule(ctx)
  const persistence = createPersistenceModule(ctx, { profileHydration })
  const exportOrch = createExportModule(ctx)
  const relaySession = createRelaySessionModule(ctx)
  const nodeDetail = createNodeDetailModule(ctx, {
    persistence,
    profileHydration,
  })

  const rootLoaderRef = {
    isStaleLoad(loadId: number) {
      return rootLoader.isStaleLoad(loadId)
    },
    getLoadSequence() {
      return rootLoader.getLoadSequence()
    },
  }

  const zapLayerRef = {
    cancelActiveZapLoad() {
      zapLayer.cancelActiveZapLoad()
    },
    getZapTargetPubkeys() {
      return zapLayer.getZapTargetPubkeys()
    },
    prefetchZapLayer(targetPubkeys: string[], relayUrls: string[]) {
      return zapLayer.prefetchZapLayer(targetPubkeys, relayUrls)
    },
  }

  const rootLoader = createRootLoaderModule(ctx, {
    analysis,
    persistence,
    profileHydration,
    relaySession,
    zapLayer: zapLayerRef,
  })

  const zapLayer = createZapLayerModule(ctx, {
    analysis,
    persistence,
    profileHydration,
    relaySession,
    rootLoader: rootLoaderRef,
  })

  relaySession.bindLoadRoot(rootLoader.loadRoot)

  const nodeExpansion = createNodeExpansionModule(ctx, {
    analysis,
    persistence,
    profileHydration,
    rootLoader,
    zapLayer,
    nodeDetail,
  })
  let connectionsDerivationInFlight = false
  let connectionsDerivationQueued = false
  let connectionsDerivationTimer: ReturnType<typeof setTimeout> | null = null
  let activeConnectionsDerivationController: AbortController | null = null

  /**
   * Derives directed follow edges between current graph nodes.
   * First reads locally-cached contact lists; for nodes without cached data,
   * fetches kind-3 events from relays and persists them.
   * Only follows where both source and target are already graph nodes are
   * included; root-centric edges are excluded (they already live in `links`).
   * Results are stored in `connectionsLinks` which is used exclusively by
   * the connections layer renderer.
   */
  async function deriveConnectionsLinks(signal: AbortSignal): Promise<void> {
    const state = ctx.store.getState()
    const rootPubkey = state.rootNodePubkey
    const graphNodePubkeys = new Set(Object.keys(state.nodes))
    const expectedGraphRevision = state.graphRevision
    const expectedInboundGraphRevision = state.inboundGraphRevision

    if (graphNodePubkeys.size === 0 || rootPubkey === null) {
      ctx.store.getState().setConnectionsLinks([])
      return
    }

    const expectedRootPubkey = rootPubkey
    const trackedGraphPubkeys = Array.from(graphNodePubkeys)
      .filter((pubkey) => pubkey !== rootPubkey)
      .sort(compareConnectionPubkeys)
    const contactListsByPubkey = new Map<string, ConnectionContactListRecord>()
    const missingPubkeys: string[] = []
    let lastPublishedSignature: string | null = null
    let lastPublishedAt = 0
    let unpublishedContactListUpdates = 0

    const isCancelledDerivation = () =>
      signal.aborted ||
      ctx.store.getState().activeLayer !== 'connections' ||
      ctx.store.getState().rootNodePubkey !== expectedRootPubkey ||
      ctx.store.getState().graphRevision !== expectedGraphRevision ||
      ctx.store.getState().inboundGraphRevision !== expectedInboundGraphRevision

    const publishDerivedLinks = (force = false) => {
      if (isCancelledDerivation()) {
        return
      }

      const currentState = ctx.store.getState()
      const currentRootPubkey = currentState.rootNodePubkey
      if (currentRootPubkey === null) {
        if (lastPublishedSignature !== '') {
          lastPublishedSignature = ''
          currentState.setConnectionsLinks([])
        }
        return
      }

      const now = ctx.now()
      if (!force) {
        if (unpublishedContactListUpdates === 0) {
          return
        }

        if (
          unpublishedContactListUpdates <
            CONNECTIONS_PUBLISH_MIN_CONTACT_LIST_UPDATES ||
          now - lastPublishedAt < CONNECTIONS_PUBLISH_THROTTLE_MS
        ) {
          return
        }
      }

      const { links, signature } = createConnectionsDerivedState(
        currentRootPubkey,
        new Set(Object.keys(currentState.nodes)),
        contactListsByPubkey,
      )

      if (signature === lastPublishedSignature) {
        return
      }

      lastPublishedSignature = signature
      lastPublishedAt = now
      unpublishedContactListUpdates = 0
      currentState.setConnectionsLinks(links)
    }

    const cachedContactListsByPubkey = new Map<string, ConnectionContactListRecord | null>()
    await runWithConcurrencyLimit(
      trackedGraphPubkeys,
      CONNECTIONS_CACHE_LOOKUP_CONCURRENCY,
      async (pubkey) => {
        if (isCancelledDerivation()) {
          return
        }
        try {
          cachedContactListsByPubkey.set(
            pubkey,
            (await ctx.repositories.contactLists.get(pubkey)) ?? null,
          )
        } catch {
          cachedContactListsByPubkey.set(pubkey, null)
        }
      },
    )

    if (isCancelledDerivation()) {
      return
    }

    for (const pubkey of trackedGraphPubkeys) {
      const cachedContactList = cachedContactListsByPubkey.get(pubkey) ?? null
      if (cachedContactList) {
        contactListsByPubkey.set(pubkey, cachedContactList)
      } else {
        missingPubkeys.push(pubkey)
      }
    }

    // Publish cache-backed connections immediately before waiting on relays.
    publishDerivedLinks(true)

    // Fetch missing contact lists from relays and publish the layer incrementally.
    if (missingPubkeys.length > 0) {
      const relayUrls = ctx.store.getState().relayUrls
      if (relayUrls.length > 0) {
        const adapter = ctx.createRelayAdapter({ relayUrls })
        let progressivePersistChain = Promise.resolve()
        try {
          await runWithConcurrencyLimit(
            chunkIntoBatches(missingPubkeys, CONNECTIONS_FETCH_BATCH_SIZE),
            CONNECTIONS_FETCH_CONCURRENCY,
            async (batch) => {
              if (isCancelledDerivation()) {
                return
              }

              const scheduleBatchIngest = (
                envelopes: readonly RelayEventEnvelope[],
              ) => {
                progressivePersistChain = progressivePersistChain
                  .then(async () => {
                    if (isCancelledDerivation()) {
                      return
                    }

                    const latestByPubkey = selectLatestReplaceableEventsByPubkey(
                      Array.from(envelopes),
                    ).filter((envelope) =>
                      isRelayEventNewerThanContactList(
                        contactListsByPubkey.get(envelope.event.pubkey),
                        envelope,
                      ),
                    )

                    if (latestByPubkey.length === 0) {
                      return
                    }

                    await runWithConcurrencyLimit(
                      latestByPubkey,
                      CONNECTIONS_PARSE_CONCURRENCY,
                      async (envelope) => {
                        if (isCancelledDerivation()) {
                          return
                        }

                        const parsed = await ctx.eventsWorker.invoke(
                          'PARSE_CONTACT_LIST',
                          { event: serializeContactListEvent(envelope.event) },
                        )

                        if (isCancelledDerivation()) {
                          return
                        }

                        await persistence.persistContactListEvent(envelope, parsed)
                        contactListsByPubkey.set(envelope.event.pubkey, {
                          pubkey: envelope.event.pubkey,
                          eventId: envelope.event.id,
                          createdAt: envelope.event.created_at,
                          fetchedAt: envelope.receivedAtMs,
                          follows: parsed.followPubkeys,
                          relayHints: parsed.relayHints,
                        })
                        unpublishedContactListUpdates += 1
                      },
                    )

                    publishDerivedLinks()
                  })
                  .catch((error) => {
                    logTerminalWarning('Conexiones', 'No se pudo integrar follows progresivos', {
                      motivo: summarizeHumanTerminalError(error),
                    })
                  })

                return progressivePersistChain
              }

              const result = await collectRelayEvents(
                adapter,
                [{ authors: batch, kinds: [3], limit: batch.length }],
                {
                  signal,
                  onProgress: (progress) => {
                    void scheduleBatchIngest(progress.latestBatchEnvelopes)
                  },
                },
              )

              await scheduleBatchIngest(result.events)
            },
          )
          await progressivePersistChain
        } catch (error) {
          logTerminalWarning('Conexiones', 'No se pudieron consultar listas de follows', {
            motivo: summarizeHumanTerminalError(error),
          })
        } finally {
          adapter.close()
        }
      }
    }

    publishDerivedLinks(true)
  }

  const runConnectionsDerivation = async () => {
    if (connectionsDerivationInFlight) {
      connectionsDerivationQueued = true
      return
    }

    connectionsDerivationInFlight = true
    const controller = new AbortController()
    activeConnectionsDerivationController = controller

    try {
      await deriveConnectionsLinks(controller.signal)
    } finally {
      if (activeConnectionsDerivationController === controller) {
        activeConnectionsDerivationController = null
      }
      connectionsDerivationInFlight = false

      if (
        connectionsDerivationQueued &&
        ctx.store.getState().activeLayer === 'connections'
      ) {
        connectionsDerivationQueued = false
        scheduleConnectionsDerivation()
      } else {
        connectionsDerivationQueued = false
      }
    }
  }

  const abortActiveConnectionsDerivation = () => {
    if (connectionsDerivationTimer !== null) {
      clearTimeout(connectionsDerivationTimer)
      connectionsDerivationTimer = null
    }

    activeConnectionsDerivationController?.abort()
    activeConnectionsDerivationController = null
  }

  const scheduleConnectionsDerivation = () => {
    if (ctx.store.getState().activeLayer !== 'connections') {
      return
    }

    if (connectionsDerivationTimer !== null) {
      clearTimeout(connectionsDerivationTimer)
    }

    connectionsDerivationTimer = setTimeout(() => {
      connectionsDerivationTimer = null
      void runConnectionsDerivation()
    }, 0)
  }

  const unsubscribeConnectionsRefresh = ctx.store.subscribe(
    (nextState, previousState) => {
      const enteredConnections =
        nextState.activeLayer === 'connections' &&
        previousState.activeLayer !== 'connections'
      const graphChangedWhileViewingConnections =
        nextState.activeLayer === 'connections' &&
        (nextState.graphRevision !== previousState.graphRevision ||
          nextState.inboundGraphRevision !== previousState.inboundGraphRevision ||
          nextState.rootNodePubkey !== previousState.rootNodePubkey)

      if (enteredConnections || graphChangedWhileViewingConnections) {
        if (graphChangedWhileViewingConnections) {
          abortActiveConnectionsDerivation()
        }
        scheduleConnectionsDerivation()
        return
      }

      if (
        nextState.activeLayer !== 'connections' &&
        previousState.activeLayer === 'connections'
      ) {
        connectionsDerivationQueued = false
        abortActiveConnectionsDerivation()
      }
    },
  )

  function toggleLayer(layer: UiLayer): ToggleLayerResult {
    const state = ctx.store.getState()
    const previousLayer = state.activeLayer

    if (layer === 'zaps' && state.zapLayer.status !== 'enabled') {
      return {
        previousLayer,
        activeLayer: previousLayer,
        message: state.zapLayer.message ?? 'La capa de zaps no esta disponible todavia.',
      }
    }

    if (layer === 'connections' && previousLayer !== 'connections') {
      state.setConnectionsSourceLayer('mutuals')
    }

    state.setActiveLayer(layer)

    return {
      previousLayer,
      activeLayer: layer,
      message:
        layer === 'zaps'
          ? state.zapLayer.message
          : null,
    }
  }

  async function settleBackgroundTasks(): Promise<void> {
    let attempts = 0

    while (
      attempts < 20 &&
      (analysis.isInFlight() || analysis.isFlushScheduled())
    ) {
      await new Promise((resolve) => setTimeout(resolve, 50))
      attempts += 1
    }
  }

  function getState() {
    return ctx.store.getState()
  }

  function dispose(): void {
    unsubscribeConnectionsRefresh()
    connectionsDerivationQueued = false
    abortActiveConnectionsDerivation()
    relaySession.flushPendingRelayHealth()
    rootLoader.cancelActiveLoad()
    zapLayer.cancelActiveZapLoad()
    ctx.eventsWorker.dispose()
    ctx.graphWorker.dispose()
  }

  const facade = {
    loadRoot: rootLoader.loadRoot,
    reconfigureRelays: relaySession.reconfigureRelays,
    revertRelayOverride: relaySession.revertRelayOverride,
    expandNode: nodeExpansion.expandNode,
    toggleLayer,
    findPath: nodeDetail.findPath,
    addDetachedNode: nodeDetail.addDetachedNode,
    addActivityExternalNode: nodeDetail.addActivityExternalNode,
    selectNode: nodeDetail.selectNode,
    getNodeDetail: nodeDetail.getNodeDetail,
    prefetchNodeProfiles: nodeDetail.prefetchNodeProfiles,
    exportSnapshot: exportOrch.exportSnapshot,
    downloadDiscoveredProfilePhotos: exportOrch.downloadDiscoveredProfilePhotos,
    settleBackgroundTasks,
    getState,
    dispose,
    on: emitter.on,
  } satisfies RootLoader & {
    exportSnapshot: typeof exportOrch.exportSnapshot
    downloadDiscoveredProfilePhotos: typeof exportOrch.downloadDiscoveredProfilePhotos
    settleBackgroundTasks: typeof settleBackgroundTasks
    getState: typeof getState
    dispose: typeof dispose
    on: typeof emitter.on
  }

  return facade
}

export type KernelFacade = ReturnType<typeof createKernelFacade>
