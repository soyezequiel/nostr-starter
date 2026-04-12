import { createKernelEventEmitter } from '@/features/graph/kernel/events'
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

    if (graphNodePubkeys.size === 0) {
      return
    }

    // Phase 1: check which graph nodes already have cached contact lists.
    const missingPubkeys: string[] = []

    for (const pubkey of graphNodePubkeys) {
      if (pubkey === rootPubkey) continue
      try {
        const cached = await ctx.repositories.contactLists.get(pubkey)
        if (!cached) missingPubkeys.push(pubkey)
      } catch {
        missingPubkeys.push(pubkey)
      }
    }

    // Phase 2: fetch missing contact lists from relays in batches.
    if (missingPubkeys.length > 0) {
      const relayUrls = ctx.store.getState().relayUrls
      if (relayUrls.length > 0) {
        const BATCH_SIZE = 100
        const adapter = ctx.createRelayAdapter({ relayUrls })
        try {
          await runWithConcurrencyLimit(
            chunkIntoBatches(missingPubkeys, BATCH_SIZE),
            2,
            async (batch) => {
              const result = await collectRelayEvents(adapter, [
                { authors: batch, kinds: [3], limit: batch.length },
              ])
              const latestByPubkey = selectLatestReplaceableEventsByPubkey(
                result.events,
              )
              await runWithConcurrencyLimit(latestByPubkey, 8, async (envelope) => {
                try {
                  const parsed = await ctx.eventsWorker.invoke(
                    'PARSE_CONTACT_LIST',
                    { event: serializeContactListEvent(envelope.event) },
                  )
                  await persistence.persistContactListEvent(envelope, parsed)
                } catch {
                  // Non-critical — skip unparseable events.
                }
              })
            },
          )
        } catch (error) {
          console.warn('Connections contact list fetch failed:', error)
        } finally {
          adapter.close()
        }
      }
    }

    // Phase 3: derive cross-edges from all cached contact lists.
    const derivedLinks: import('@/features/graph/app/store/types').GraphLink[] = []
    const seenKeys = new Set<string>()

    // Re-read graph node set — it may have been updated during phase 2.
    const currentGraphNodePubkeys = new Set(
      Object.keys(ctx.store.getState().nodes),
    )

    for (const pubkey of currentGraphNodePubkeys) {
      if (pubkey === rootPubkey) continue

      let contactList: Awaited<ReturnType<typeof ctx.repositories.contactLists.get>>
      try {
        contactList = await ctx.repositories.contactLists.get(pubkey)
      } catch {
        continue
      }

      if (!contactList) continue

      for (const followPubkey of contactList.follows) {
        if (
          followPubkey === pubkey ||
          followPubkey === rootPubkey ||
          !currentGraphNodePubkeys.has(followPubkey)
        ) {
          continue
        }

        const key = `${pubkey}->${followPubkey}`
        if (!seenKeys.has(key)) {
          seenKeys.add(key)
          derivedLinks.push({ source: pubkey, target: followPubkey, relation: 'follow' })
        }
      }
    }

    ctx.store.getState().setConnectionsLinks(derivedLinks)
  }

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
      // Async: derive cross-edges. Reads cached contact lists first,
      // then fetches missing ones from relays before computing edges.
      void deriveConnectionsLinks()
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
