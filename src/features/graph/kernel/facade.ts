import { createKernelEventEmitter } from '@/features/graph/kernel/events'
import type { ContactListRecord } from '@/features/graph/db/entities'
import type { AppKernelDependencies } from '@/features/graph/kernel/modules/context'
import { createAnalysisModule } from '@/features/graph/kernel/modules/analysis'
import { createExportModule } from '@/features/graph/kernel/modules/export-orch'
import {
  collectRelayEvents,
  runWithConcurrencyLimit,
  chunkIntoBatches,
  selectLatestReplaceableEventsByPubkey,
  serializeContactListEvent,
} from '@/features/graph/kernel/modules/helpers'
import { createKeywordLayerModule } from '@/features/graph/kernel/modules/keyword-layer'
import { createNodeDetailModule } from '@/features/graph/kernel/modules/node-detail'
import { createNodeExpansionModule } from '@/features/graph/kernel/modules/node-expansion'
import { createPersistenceModule } from '@/features/graph/kernel/modules/persistence'
import { createProfileHydrationModule } from '@/features/graph/kernel/modules/profile-hydration'
import { createRelaySessionModule } from '@/features/graph/kernel/modules/relay-session'
import { createRootLoaderModule } from '@/features/graph/kernel/modules/root-loader'
import { createZapLayerModule } from '@/features/graph/kernel/modules/zap-layer'
import type { RootLoader, ToggleLayerResult } from '@/features/graph/kernel/runtime'
import type { UiLayer } from '@/features/graph/app/store'
import type { RelayEventEnvelope } from '@/features/graph/nostr'

type ConnectionContactListRecord = Pick<
  ContactListRecord,
  'pubkey' | 'eventId' | 'createdAt' | 'fetchedAt' | 'follows' | 'relayHints'
>

const CONNECTIONS_CACHE_LOOKUP_CONCURRENCY = 24
const CONNECTIONS_FETCH_BATCH_SIZE = 25
const CONNECTIONS_FETCH_CONCURRENCY = 3
const CONNECTIONS_PARSE_CONCURRENCY = 8
const CONNECTIONS_PUBLISH_THROTTLE_MS = 48

const compareConnectionPubkeys = (left: string, right: string) =>
  left.localeCompare(right, undefined, {
    numeric: false,
    sensitivity: 'base',
  })

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

const createConnectionsDerivedState = (
  rootPubkey: string,
  graphNodePubkeys: ReadonlySet<string>,
  contactListsByPubkey: ReadonlyMap<string, ConnectionContactListRecord>,
) => {
  const derivedLinks: import('@/features/graph/app/store/types').GraphLink[] = []
  const derivedKeys: string[] = []
  const seenKeys = new Set<string>()
  const orderedGraphPubkeys = Array.from(graphNodePubkeys).sort(compareConnectionPubkeys)

  for (const pubkey of orderedGraphPubkeys) {
    if (pubkey === rootPubkey) {
      continue
    }

    const contactList = contactListsByPubkey.get(pubkey)
    if (!contactList) {
      continue
    }

    const orderedFollows = [...contactList.follows].sort(compareConnectionPubkeys)
    for (const followPubkey of orderedFollows) {
      if (
        followPubkey === pubkey ||
        followPubkey === rootPubkey ||
        !graphNodePubkeys.has(followPubkey)
      ) {
        continue
      }

      const key = `${pubkey}->${followPubkey}`
      if (seenKeys.has(key)) {
        continue
      }

      seenKeys.add(key)
      derivedKeys.push(key)
      derivedLinks.push({
        source: pubkey,
        target: followPubkey,
        relation: 'follow',
      })
    }
  }

  return {
    links: derivedLinks,
    signature: derivedKeys.join('|'),
  }
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
  const keywordLayer = createKeywordLayerModule(ctx, { persistence })
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
    keywordLayer,
    zapLayer: zapLayerRef,
  })

  const zapLayer = createZapLayerModule(ctx, {
    analysis,
    persistence,
    profileHydration,
    relaySession,
    rootLoader: rootLoaderRef,
    keywordLayer,
  })

  relaySession.bindLoadRoot(rootLoader.loadRoot)

  const nodeExpansion = createNodeExpansionModule(ctx, {
    analysis,
    persistence,
    profileHydration,
    rootLoader,
    keywordLayer,
    zapLayer,
    nodeDetail,
  })
  let connectionsDerivationInFlight = false
  let connectionsDerivationQueued = false
  let connectionsDerivationTimer: ReturnType<typeof setTimeout> | null = null

  /**
   * Derives directed follow edges between current graph nodes.
   * First reads locally-cached contact lists; for nodes without cached data,
   * fetches kind-3 events from relays and persists them.
   * Only follows where both source and target are already graph nodes are
   * included; root-centric edges are excluded (they already live in `links`).
   * Results are stored in `connectionsLinks` which is used exclusively by
   * the connections layer renderer.
   */
  async function deriveConnectionsLinks(): Promise<void> {
    const state = ctx.store.getState()
    const rootPubkey = state.rootNodePubkey
    const graphNodePubkeys = new Set(Object.keys(state.nodes))

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

    const isStaleDerivation = () =>
      ctx.store.getState().rootNodePubkey !== expectedRootPubkey

    const publishDerivedLinks = (force = false) => {
      if (isStaleDerivation()) {
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
      if (!force && now - lastPublishedAt < CONNECTIONS_PUBLISH_THROTTLE_MS) {
        return
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
      currentState.setConnectionsLinks(links)
    }

    const cachedContactListsByPubkey = new Map<string, ConnectionContactListRecord | null>()
    await runWithConcurrencyLimit(
      trackedGraphPubkeys,
      CONNECTIONS_CACHE_LOOKUP_CONCURRENCY,
      async (pubkey) => {
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
              const scheduleBatchIngest = (
                envelopes: readonly RelayEventEnvelope[],
              ) => {
                progressivePersistChain = progressivePersistChain
                  .then(async () => {
                    if (isStaleDerivation()) {
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
                        const parsed = await ctx.eventsWorker.invoke(
                          'PARSE_CONTACT_LIST',
                          { event: serializeContactListEvent(envelope.event) },
                        )

                        await persistence.persistContactListEvent(envelope, parsed)
                        contactListsByPubkey.set(envelope.event.pubkey, {
                          pubkey: envelope.event.pubkey,
                          eventId: envelope.event.id,
                          createdAt: envelope.event.created_at,
                          fetchedAt: envelope.receivedAtMs,
                          follows: parsed.followPubkeys,
                          relayHints: parsed.relayHints,
                        })
                      },
                    )

                    publishDerivedLinks()
                  })
                  .catch((error) => {
                    console.warn(
                      'Connections contact list progressive ingest failed:',
                      error,
                    )
                  })

                return progressivePersistChain
              }

              const result = await collectRelayEvents(
                adapter,
                [{ authors: batch, kinds: [3], limit: batch.length }],
                {
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
          console.warn('Connections contact list fetch failed:', error)
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

    try {
      await deriveConnectionsLinks()
    } finally {
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
        scheduleConnectionsDerivation()
        return
      }

      if (
        nextState.activeLayer !== 'connections' &&
        previousState.activeLayer === 'connections' &&
        connectionsDerivationTimer !== null
      ) {
        clearTimeout(connectionsDerivationTimer)
        connectionsDerivationTimer = null
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
      state.setConnectionsSourceLayer(previousLayer)
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

  async function settleBackgroundTasks(): Promise<void> {
    let attempts = 0

    while (
      attempts < 20 &&
      (analysis.isInFlight() ||
        analysis.isFlushScheduled() ||
        keywordLayer.isCorpusInFlight())
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
    if (connectionsDerivationTimer !== null) {
      clearTimeout(connectionsDerivationTimer)
      connectionsDerivationTimer = null
    }
    relaySession.flushPendingRelayHealth()
    rootLoader.cancelActiveLoad()
    zapLayer.cancelActiveZapLoad()
    keywordLayer.cancelActiveKeywordLoad()
    ctx.eventsWorker.dispose()
    ctx.graphWorker.dispose()
  }

  const facade = {
    loadRoot: rootLoader.loadRoot,
    reconfigureRelays: relaySession.reconfigureRelays,
    revertRelayOverride: relaySession.revertRelayOverride,
    expandNode: nodeExpansion.expandNode,
    searchKeyword: keywordLayer.searchKeyword,
    toggleLayer,
    findPath: nodeDetail.findPath,
    selectNode: nodeDetail.selectNode,
    getNodeDetail: nodeDetail.getNodeDetail,
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
