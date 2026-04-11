import type { ZapLayerEdge } from '@/features/graph/app/store'
import type { ZapRecord } from '@/features/graph/db/entities'
import type { KernelContext, RelayAdapterInstance } from '@/features/graph/kernel/modules/context'
import type { AnalysisModule } from '@/features/graph/kernel/modules/analysis'
import type { PersistenceModule } from '@/features/graph/kernel/modules/persistence'
import type { ProfileHydrationModule } from '@/features/graph/kernel/modules/profile-hydration'
import type { RelaySessionModule } from '@/features/graph/kernel/modules/relay-session'
import type { KeywordLayerModule } from '@/features/graph/kernel/modules/keyword-layer'
import {
  buildZapReceiptsFilter,
  collectRelayEvents,
  mergeRelayEventsById,
  serializeZapReceiptEvent,
} from '@/features/graph/kernel/modules/helpers'
import { buildZapLayerMessage } from '@/features/graph/kernel/modules/text-helpers'

interface ActiveZapSession {
  requestId: number
  adapter: RelayAdapterInstance
}

export function createZapLayerModule(
  ctx: KernelContext,
  collaborators: {
    analysis: AnalysisModule
    persistence: PersistenceModule
    profileHydration: ProfileHydrationModule
    relaySession: RelaySessionModule
    rootLoader: {
      getLoadSequence: () => number
      isStaleLoad: (loadId: number) => boolean
    }
    keywordLayer: KeywordLayerModule
  },
) {
  let activeZapSession: ActiveZapSession | null = null
  let zapRequestSequence = 0

  function getZapTargetPubkeys(): string[] {
    const state = ctx.store.getState()
    const targetPubkeys = new Set(state.expandedNodePubkeys)

    if (state.rootNodePubkey) {
      targetPubkeys.add(state.rootNodePubkey)
    }

    return [...targetPubkeys].sort()
  }

  function cancelActiveZapLoad(): void {
    if (!activeZapSession) {
      return
    }

    activeZapSession.adapter.close()
    activeZapSession = null
  }

  function isStaleZapRequest(requestId: number): boolean {
    return requestId !== zapRequestSequence
  }

  async function prefetchZapLayer(
    targetPubkeys: string[],
    relayUrls: string[],
  ): Promise<void> {
    const normalizedTargetPubkeys = Array.from(
      new Set(targetPubkeys.filter(Boolean)),
    ).sort()
    const state = ctx.store.getState()

    if (normalizedTargetPubkeys.length === 0) {
      state.resetZapLayer()
      return
    }

    const requestId = zapRequestSequence + 1
    zapRequestSequence = requestId
    cancelActiveZapLoad()

    state.setZapLayerState({
      status: 'loading',
      loadedFrom: 'none',
      targetPubkeys: normalizedTargetPubkeys,
      skippedReceipts: 0,
      message: buildZapLayerMessage({
        status: 'loading',
        edgeCount: 0,
        skippedReceipts: 0,
        loadedFrom: 'live',
      }),
      lastUpdatedAt: ctx.now(),
    })

    const cachedZaps = await ctx.repositories.zaps.findByTargetPubkeys(
      normalizedTargetPubkeys,
    )
    if (isStaleZapRequest(requestId)) {
      return
    }

    if (cachedZaps.length > 0) {
      promoteZapNodes(
        cachedZaps,
        relayUrls,
        requestId,
        normalizedTargetPubkeys,
      )

      if (isStaleZapRequest(requestId)) {
        return
      }

      const cachedEdges = buildZapLayerEdges(
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
        lastUpdatedAt: ctx.now(),
      })
    }

    const adapter = ctx.createRelayAdapter({ relayUrls })
    activeZapSession = { requestId, adapter }

    let skippedReceipts = 0

    try {
      const liveResult = await collectRelayEvents(adapter, [
        buildZapReceiptsFilter(normalizedTargetPubkeys),
      ])

      if (isStaleZapRequest(requestId)) {
        return
      }

      if (liveResult.summary?.relayHealth) {
        collaborators.relaySession.publishRelayHealth(liveResult.summary.relayHealth)
      }

      const liveErrorMessage = liveResult.error?.message ?? null
      const mergedReceipts = mergeRelayEventsById(liveResult.events)
      state.setZapLayerState({
        status: mergedReceipts.length > 0 ? 'loading' : state.zapLayer.status,
        loadedFrom: mergedReceipts.length > 0 ? 'live' : state.zapLayer.loadedFrom,
        message:
          mergedReceipts.length > 0
            ? `Recibidos ${mergedReceipts.length} eventos de zap. Decodificando recibos en worker...`
            : 'Consulta live terminada sin recibos nuevos. Revisando cache local...',
        lastUpdatedAt: ctx.now(),
      })
      if (mergedReceipts.length > 0) {
        await Promise.all(
          mergedReceipts.map((envelope) =>
            collaborators.persistence.persistRawEventEnvelope(envelope),
          ),
        )

        const decodeResult = await ctx.eventsWorker.invoke('DECODE_ZAPS', {
          events: mergedReceipts.map((receipt) =>
            serializeZapReceiptEvent(receipt.event),
          ),
        })

        if (isStaleZapRequest(requestId)) {
          return
        }

        skippedReceipts = decodeResult.skippedReceipts.length
        state.setZapLayerState({
          status: 'loading',
          loadedFrom: 'live',
          skippedReceipts,
          message: `Decodificados ${decodeResult.zapEdges.length} edges de zap. Persistiendo evidencia util...`,
          lastUpdatedAt: ctx.now(),
        })
        await collaborators.persistence.persistDecodedZapEdges(
          mergedReceipts,
          decodeResult.zapEdges,
        )
      }

      if (isStaleZapRequest(requestId)) {
        return
      }

      const allVisibleZaps = await ctx.repositories.zaps.findByTargetPubkeys(
        normalizedTargetPubkeys,
      )
      if (isStaleZapRequest(requestId)) {
        return
      }

      promoteZapNodes(allVisibleZaps, relayUrls, requestId, normalizedTargetPubkeys)

      if (isStaleZapRequest(requestId)) {
        return
      }

      const visibleEdges = buildZapLayerEdges(
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
        lastUpdatedAt: ctx.now(),
      })
    } catch (error) {
      if (isStaleZapRequest(requestId)) {
        return
      }

      const visibleEdges = buildZapLayerEdges(
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
        lastUpdatedAt: ctx.now(),
      })
    } finally {
      if (activeZapSession?.requestId === requestId) {
        activeZapSession.adapter.close()
        activeZapSession = null
      }
    }
  }

  function promoteZapNodes(
    zaps: readonly ZapRecord[],
    relayUrls: string[],
    requestId: number,
    targetPubkeys: readonly string[],
  ): void {
    const state = ctx.store.getState()
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

    const discoveredAt = ctx.now()
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
      !isStaleZapRequest(requestId)
    ) {
      collaborators.analysis.schedule()
      const loadId = collaborators.rootLoader.getLoadSequence()
      void collaborators.profileHydration.hydrateNodeProfiles(
        nodeResult.acceptedPubkeys,
        relayUrls,
        () => collaborators.rootLoader.isStaleLoad(loadId),
        {
          persistProfileEvent: collaborators.persistence.persistProfileEvent,
        },
      )
      void collaborators.keywordLayer.prefetchKeywordCorpus(
        collaborators.keywordLayer.getKeywordCorpusTargetPubkeys(),
        relayUrls,
      )
    }
  }

  function buildZapLayerEdges(
    zaps: readonly ZapRecord[],
    targetPubkeys: readonly string[],
  ): ZapLayerEdge[] {
    const visibleNodes = new Set(Object.keys(ctx.store.getState().nodes))
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

  return {
    prefetchZapLayer,
    promoteZapNodes,
    buildZapLayerEdges,
    getZapTargetPubkeys,
    cancelActiveZapLoad,
  }
}

export type ZapLayerModule = ReturnType<typeof createZapLayerModule>
