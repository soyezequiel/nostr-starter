import { unstable_batchedUpdates } from 'react-dom'
import type { Filter } from 'nostr-tools'

import type { GraphNode, KeywordMatch } from '@/features/graph/app/store'
import type { NoteExtractRecord } from '@/features/graph/db/entities'
import type { SearchKeywordResult } from '@/features/graph/kernel/runtime'
import type { KernelContext, RelayAdapterInstance } from '@/features/graph/kernel/modules/context'
import {
  KEYWORD_BATCH_CONCURRENCY,
  KEYWORD_BATCH_SIZE,
  KEYWORD_FILTER_LIMIT_FACTOR,
  KEYWORD_LAYER_EMPTY_MESSAGE,
  KEYWORD_LAYER_LOADING_MESSAGE,
  KEYWORD_LOOKBACK_WINDOW_SEC,
  KEYWORD_MAX_NOTES_PER_PUBKEY,
} from '@/features/graph/kernel/modules/constants'
import {
  chunkIntoBatches,
  collectRelayEvents,
  mergeRelayEventsById,
  runWithConcurrencyLimit,
  tokenizeKeyword,
} from '@/features/graph/kernel/modules/helpers'
import {
  buildNoteExtractRecordsByPubkey,
  flattenNoteExtractRecords,
  logKeywordMatchesToConsole,
  summarizeKeywordCorpus,
} from '@/features/graph/kernel/modules/text-helpers'
import type { PersistenceModule } from '@/features/graph/kernel/modules/persistence'

interface ActiveKeywordSession {
  requestId: number
  adapter: RelayAdapterInstance
}

export function createKeywordLayerModule(
  ctx: KernelContext,
  collaborators: {
    persistence: PersistenceModule
  },
) {
  let activeKeywordSession: ActiveKeywordSession | null = null
  let keywordRequestSequence = 0
  let keywordSearchSequence = 0
  let keywordCorpusInFlight = false

  function getKeywordCorpusTargetPubkeys(): string[] {
    return Object.values(ctx.store.getState().nodes)
      .filter((node) => node.source !== 'keyword')
      .map((node) => node.pubkey)
      .sort()
  }

  function removeKeywordSourceNodes(keepPubkeys: readonly string[] = []): void {
    const state = ctx.store.getState()
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

  function resetKeywordHits(): void {
    const state = ctx.store.getState()
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

  function applyKeywordHits(
    nodeHits: Record<string, number>,
    createMissingNode?: (pubkey: string, hitCount: number) => GraphNode | null,
  ): void {
    const state = ctx.store.getState()
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

  function cancelActiveKeywordLoad(): void {
    if (!activeKeywordSession) {
      return
    }

    activeKeywordSession.adapter.close()
    activeKeywordSession = null
  }

  function isStaleKeywordRequest(requestId: number): boolean {
    return requestId !== keywordRequestSequence
  }

  async function searchKeyword(keyword: string): Promise<SearchKeywordResult> {
    const requestId = keywordSearchSequence + 1
    keywordSearchSequence = requestId
    const trimmed = keyword.trim()
    const visiblePubkeys = getKeywordCorpusTargetPubkeys()

    if (trimmed.length === 0) {
      const state = ctx.store.getState()
      const resetMessage =
        state.keywordLayer.status === 'enabled'
          ? state.keywordLayer.extractCount > 0
            ? `${state.keywordLayer.extractCount} extractos listos para explorar.`
            : KEYWORD_LAYER_EMPTY_MESSAGE
          : null

      unstable_batchedUpdates(() => {
        state.setCurrentKeyword('')
        removeKeywordSourceNodes()
        applyKeywordHits({})
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

    removeKeywordSourceNodes()
    const extracts = await ctx.repositories.noteExtracts.findByPubkeys(visiblePubkeys)

    if (keywordSearchSequence !== requestId) {
      return {
        keyword: trimmed,
        tokens: tokenizeKeyword(trimmed),
        totalHits: 0,
        nodeHits: {},
        matchesByPubkey: {},
      }
    }

    if (extracts.length === 0) {
      const state = ctx.store.getState()
      unstable_batchedUpdates(() => {
        state.setCurrentKeyword(trimmed)
        applyKeywordHits({})
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

    const result = await ctx.eventsWorker.invoke('SEARCH_KEYWORDS', {
      keyword: trimmed,
      extracts: extracts.map((extract) => ({
        noteId: extract.noteId,
        pubkey: extract.pubkey,
        text: extract.text,
      })),
    })

    if (keywordSearchSequence !== requestId) {
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

    const state = ctx.store.getState()
    const matchNodeCount = Object.keys(matchesByPubkey).length
    const resultMessage =
      result.excerptMatches.length > 0
        ? `${result.excerptMatches.length} coincidencias en ${matchNodeCount} nodos para "${trimmed}".`
        : `Sin coincidencias para "${trimmed}".`

    unstable_batchedUpdates(() => {
      state.setCurrentKeyword(trimmed)
      applyKeywordHits(nodeHits)
      state.setKeywordMatches(matchesByPubkey)
      state.setKeywordLayerState({
        message: resultMessage,
      })
    })
    logKeywordMatchesToConsole(
      trimmed,
      nodeHits,
      matchesByPubkey,
      ctx.store.getState().nodes,
    )

    return {
      keyword: trimmed,
      tokens: result.tokens,
      totalHits: result.excerptMatches.length,
      nodeHits,
      matchesByPubkey,
    }
  }

  async function prefetchKeywordCorpus(
    targetPubkeys: string[],
    relayUrls: string[],
  ): Promise<void> {
    const normalizedTargetPubkeys = Array.from(
      new Set(targetPubkeys.filter(Boolean)),
    ).sort()
    const state = ctx.store.getState()

    if (normalizedTargetPubkeys.length === 0) {
      resetKeywordHits()
      state.resetKeywordLayer()
      state.setCurrentKeyword('')
      return
    }

    const requestId = keywordRequestSequence + 1
    keywordRequestSequence = requestId
    cancelActiveKeywordLoad()
    keywordCorpusInFlight = true

    const cachedExtracts = await ctx.repositories.noteExtracts.findByPubkeys(
      normalizedTargetPubkeys,
    )

    if (isStaleKeywordRequest(requestId)) {
      keywordCorpusInFlight = false
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
        lastUpdatedAt: ctx.now(),
      })
    } else {
      resetKeywordHits()
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

    const adapter = ctx.createRelayAdapter({ relayUrls })
    activeKeywordSession = {
      requestId,
      adapter,
    }

    const liveExtractsByPubkey = new Map<string, NoteExtractRecord[]>()
    let failedBatchCount = 0

    try {
      const batches = chunkIntoBatches(normalizedTargetPubkeys, KEYWORD_BATCH_SIZE)
      const since = Math.max(
        0,
        Math.floor(ctx.now() / 1000) - KEYWORD_LOOKBACK_WINDOW_SEC,
      )

      await runWithConcurrencyLimit(
        batches,
        KEYWORD_BATCH_CONCURRENCY,
        async (batch) => {
          const batchNumber = batches.indexOf(batch) + 1
          state.setKeywordLayerState({
            status: 'loading',
            message: `Consultando notas recientes: batch ${batchNumber}/${batches.length} con ${batch.length} autores...`,
            lastUpdatedAt: ctx.now(),
          })
          const batchResult = await collectRelayEvents(adapter, [
            {
              authors: batch,
              kinds: [1],
              since,
              limit: Math.max(
                KEYWORD_MAX_NOTES_PER_PUBKEY,
                batch.length *
                  KEYWORD_MAX_NOTES_PER_PUBKEY *
                  KEYWORD_FILTER_LIMIT_FACTOR,
              ),
            } satisfies Filter,
          ])

          if (isStaleKeywordRequest(requestId)) {
            return
          }

          if (batchResult.error) {
            failedBatchCount += 1
            state.setKeywordLayerState({
              status: cachedSummary.extractCount > 0 ? 'enabled' : 'loading',
              isPartial: true,
              message: `Batch ${batchNumber}/${batches.length} sin cobertura util. Manteniendo corpus parcial mientras siguen otros batches...`,
              lastUpdatedAt: ctx.now(),
            })
            return
          }

          const mergedEvents = mergeRelayEventsById(batchResult.events)
          await Promise.all(
            mergedEvents.map((eventEnvelope) =>
              collaborators.persistence.persistRawEventEnvelope(eventEnvelope),
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
              await ctx.repositories.noteExtracts.replaceForPubkey(pubkey, records)
              liveExtractsByPubkey.set(pubkey, records)
            }),
          )
          const liveSummary = summarizeKeywordCorpus(
            flattenNoteExtractRecords(liveExtractsByPubkey),
          )
          state.setKeywordLayerState({
            status: liveSummary.extractCount > 0 ? 'enabled' : 'loading',
            loadedFrom: liveSummary.extractCount > 0 ? 'live' : state.keywordLayer.loadedFrom,
            isPartial: failedBatchCount > 0,
            message: `Batch ${batchNumber}/${batches.length} procesado. ${liveSummary.extractCount} extractos live listos hasta ahora.`,
            corpusNodeCount: liveSummary.corpusNodeCount,
            extractCount: liveSummary.extractCount,
            lastUpdatedAt: ctx.now(),
          })
        },
      )

      if (isStaleKeywordRequest(requestId)) {
        return
      }

      const visibleExtracts =
        liveExtractsByPubkey.size > 0
          ? flattenNoteExtractRecords(liveExtractsByPubkey)
          : await ctx.repositories.noteExtracts.findByPubkeys(
              normalizedTargetPubkeys,
            )
      const summary = summarizeKeywordCorpus(visibleExtracts)
      const hasLiveCorpus = summary.extractCount > 0
      const hasCacheCorpus = cachedSummary.extractCount > 0
      const currentKeyword = ctx.store.getState().currentKeyword.trim()

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
          lastUpdatedAt: ctx.now(),
        })

        if (currentKeyword.length > 0) {
          await searchKeyword(currentKeyword)
        } else {
          resetKeywordHits()
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
          lastUpdatedAt: ctx.now(),
        })

        if (currentKeyword.length > 0) {
          await searchKeyword(currentKeyword)
        } else {
          resetKeywordHits()
          state.setKeywordMatches({})
        }

        return
      }

      resetKeywordHits()
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
        lastUpdatedAt: ctx.now(),
      })
    } catch (error) {
      if (!isStaleKeywordRequest(requestId)) {
        if (cachedSummary.extractCount > 0) {
          state.setKeywordLayerState({
            status: 'enabled',
            loadedFrom: 'cache',
            isPartial: true,
            message: `${cachedSummary.extractCount} extractos desde cache. No se pudo refrescar el corpus live.`,
            corpusNodeCount: cachedSummary.corpusNodeCount,
            extractCount: cachedSummary.extractCount,
            lastUpdatedAt: ctx.now(),
          })
        } else {
          resetKeywordHits()
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
            lastUpdatedAt: ctx.now(),
          })
        }
      }
    } finally {
      if (activeKeywordSession?.requestId === requestId) {
        activeKeywordSession.adapter.close()
        activeKeywordSession = null
      }

      if (keywordRequestSequence === requestId) {
        keywordCorpusInFlight = false
      }
    }
  }

  return {
    searchKeyword,
    prefetchKeywordCorpus,
    removeKeywordSourceNodes,
    resetKeywordHits,
    applyKeywordHits,
    getKeywordCorpusTargetPubkeys,
    cancelActiveKeywordLoad,
    isCorpusInFlight: () => keywordCorpusInFlight,
  }
}

export type KeywordLayerModule = ReturnType<typeof createKeywordLayerModule>
