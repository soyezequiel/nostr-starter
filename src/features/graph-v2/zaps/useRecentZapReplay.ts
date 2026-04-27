'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type NDK from '@nostr-dev-kit/ndk'
import type { NDKEvent, NDKSubscription } from '@nostr-dev-kit/ndk'

import { connectNDK } from '@/lib/nostr'
import {
  createNostrGraphDatabase,
  createRepositories,
  type NostrGraphRepositories,
  type ZapRecord,
} from '@/features/graph-runtime/db'
import type { ParsedZap } from '@/features/graph-v2/zaps/zapParser'
import { parseZapReceiptEvent } from '@/features/graph-v2/zaps/zapParser'
import { traceZapFlow } from '@/features/graph-runtime/debug/zapTrace'

export const RECENT_ZAP_REPLAY_LOOKBACK_SEC = 60 * 60

const RECENT_ZAP_REPLAY_TARGET_LIMIT = 1024
const RECENT_ZAP_REPLAY_BATCH_SIZE = 128
const RECENT_ZAP_REPLAY_MAX_EVENTS = 180
const RECENT_ZAP_REPLAY_FETCH_TIMEOUT_MS = 8_000
const RECENT_ZAP_REPLAY_MAX_CONCURRENCY = 2
const RECENT_ZAP_REPLAY_COVERAGE_PREFIX = 'sigma.recentZapReplayCoverage.v1:'

type RecentZapReplayPhase = 'idle' | 'loading' | 'playing' | 'done' | 'error'
type RecentZapReplayStage = 'idle' | 'collecting' | 'decoding' | 'playing' | 'done' | 'error'

interface RecentZapReplayCoverage {
  key: string
  targetCount: number
  firstTarget: string | null
  lastTarget: string | null
  coveredFrom: number
  coveredUntil: number
  updatedAt: number
}

export interface RecentZapReplaySnapshot {
  phase: RecentZapReplayPhase
  stage: RecentZapReplayStage
  message: string | null
  targetCount: number
  truncatedTargetCount: number
  batchCount: number
  completedBatchCount: number
  timedOutBatchCount: number
  cachedCount: number
  fetchedCount: number
  decodedCount: number
  playableCount: number
  playedCount: number
  droppedCount: number
  windowStartAt: number | null
  windowEndAt: number | null
  currentZapCreatedAt: number | null
  timelineProgress: number
}

const INITIAL_SNAPSHOT: RecentZapReplaySnapshot = {
  phase: 'idle',
  stage: 'idle',
  message: null,
  targetCount: 0,
  truncatedTargetCount: 0,
  batchCount: 0,
  completedBatchCount: 0,
  timedOutBatchCount: 0,
  cachedCount: 0,
  fetchedCount: 0,
  decodedCount: 0,
  playableCount: 0,
  playedCount: 0,
  droppedCount: 0,
  windowStartAt: null,
  windowEndAt: null,
  currentZapCreatedAt: null,
  timelineProgress: 0,
}

let zapReplayRepositoriesPromise: Promise<NostrGraphRepositories> | null = null

function getZapReplayRepositories(): Promise<NostrGraphRepositories> {
  zapReplayRepositoriesPromise ??= Promise.resolve(
    createRepositories(createNostrGraphDatabase()),
  )
  return zapReplayRepositoriesPromise
}

function clampProgress(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

function calculateTimelineProgress({
  currentAt,
  since,
  until,
}: {
  currentAt: number
  since: number
  until: number
}): number {
  const windowSize = until - since
  if (windowSize <= 0) return 0
  return clampProgress((currentAt - since) / windowSize)
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const batches: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size))
  }
  return batches
}

function normalizeTargets(pubkeys: readonly string[]): {
  targets: string[]
  truncatedTargetCount: number
} {
  const normalized = Array.from(
    new Set(
      pubkeys
        .map((pubkey) => pubkey.trim().toLowerCase())
        .filter(Boolean),
    ),
  ).sort()

  return {
    targets: normalized.slice(0, RECENT_ZAP_REPLAY_TARGET_LIMIT),
    truncatedTargetCount: Math.max(0, normalized.length - RECENT_ZAP_REPLAY_TARGET_LIMIT),
  }
}

function hashTargetSignature(signature: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < signature.length; index += 1) {
    hash ^= signature.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

function buildCoverageKey(targetSignature: string): string {
  return `${RECENT_ZAP_REPLAY_COVERAGE_PREFIX}${hashTargetSignature(targetSignature)}`
}

function isCoverageForTargets(
  coverage: RecentZapReplayCoverage,
  targets: readonly string[],
): boolean {
  return (
    coverage.targetCount === targets.length &&
    coverage.firstTarget === (targets[0] ?? null) &&
    coverage.lastTarget === (targets.at(-1) ?? null)
  )
}

function readReplayCoverage(
  targetSignature: string,
  targets: readonly string[],
): RecentZapReplayCoverage | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(buildCoverageKey(targetSignature))
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null

    const coverage = parsed as Partial<RecentZapReplayCoverage>
    if (
      typeof coverage.key !== 'string' ||
      typeof coverage.targetCount !== 'number' ||
      typeof coverage.coveredFrom !== 'number' ||
      typeof coverage.coveredUntil !== 'number' ||
      typeof coverage.updatedAt !== 'number'
    ) {
      return null
    }

    const normalizedCoverage: RecentZapReplayCoverage = {
      key: coverage.key,
      targetCount: coverage.targetCount,
      firstTarget:
        typeof coverage.firstTarget === 'string' ? coverage.firstTarget : null,
      lastTarget:
        typeof coverage.lastTarget === 'string' ? coverage.lastTarget : null,
      coveredFrom: coverage.coveredFrom,
      coveredUntil: coverage.coveredUntil,
      updatedAt: coverage.updatedAt,
    }

    return isCoverageForTargets(normalizedCoverage, targets)
      ? normalizedCoverage
      : null
  } catch {
    return null
  }
}

function writeReplayCoverage({
  targetSignature,
  targets,
  coveredFrom,
  coveredUntil,
}: {
  targetSignature: string
  targets: readonly string[]
  coveredFrom: number
  coveredUntil: number
}): void {
  if (typeof window === 'undefined') return
  try {
    const key = buildCoverageKey(targetSignature)
    const coverage: RecentZapReplayCoverage = {
      key,
      targetCount: targets.length,
      firstTarget: targets[0] ?? null,
      lastTarget: targets.at(-1) ?? null,
      coveredFrom,
      coveredUntil,
      updatedAt: Date.now(),
    }
    window.localStorage.setItem(key, JSON.stringify(coverage))
  } catch {
    // Cache metadata is an optimization. Replay still works from fresh relay data.
  }
}

async function runWithConcurrencyLimit<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let nextIndex = 0
  const workerCount = Math.max(1, Math.min(concurrency, items.length))

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const item = items[nextIndex]
        nextIndex += 1
        await worker(item)
      }
    }),
  )
}

async function collectZapReplayBatch({
  ndk,
  batch,
  since,
  until,
}: {
  ndk: NDK
  batch: readonly string[]
  since: number
  until: number
}): Promise<{ events: NDKEvent[]; timedOut: boolean }> {
  return new Promise((resolve) => {
    const eventsById = new Map<string, NDKEvent>()
    let settled = false
    let subscription: NDKSubscription | null = null

    const finish = (timedOut: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timeoutId)
      subscription?.stop()
      resolve({ events: Array.from(eventsById.values()), timedOut })
    }

    const timeoutId = setTimeout(() => {
      finish(true)
    }, RECENT_ZAP_REPLAY_FETCH_TIMEOUT_MS)

    subscription = ndk.subscribe(
      [
        {
          kinds: [9735],
          '#p': [...batch],
          since,
          until,
          limit: Math.min(RECENT_ZAP_REPLAY_MAX_EVENTS, Math.max(25, batch.length * 3)),
        },
        {
          kinds: [9735],
          '#P': [...batch],
          since,
          until,
          limit: Math.min(RECENT_ZAP_REPLAY_MAX_EVENTS, Math.max(25, batch.length * 3)),
        }
      ],
      { closeOnEose: true },
    )
    subscription.on('event', (event: NDKEvent) => {
      eventsById.set(event.id, event)
    })
    subscription.on('eose', () => finish(false))
    subscription.on('close', () => finish(false))
  })
}

function toRawZapReceiptEvent(event: NDKEvent) {
  return {
    id: event.id,
    kind: event.kind ?? 0,
    tags: event.tags,
    created_at: event.created_at ?? 0,
  }
}

function findEventTagValue(
  tags: readonly (readonly string[])[],
  name: string,
): string | null {
  for (const tag of tags) {
    if (tag[0] === name && typeof tag[1] === 'string') {
      return tag[1]
    }
  }
  return null
}

function zapRecordToParsedZap(record: ZapRecord): ParsedZap {
  return {
    eventId: record.id,
    fromPubkey: record.fromPubkey,
    toPubkey: record.toPubkey,
    sats: record.sats,
    createdAt: record.createdAt,
  }
}

async function findCachedReplayZaps({
  repositories,
  targets,
  since,
  until,
}: {
  repositories: NostrGraphRepositories
  targets: readonly string[]
  since: number
  until: number
}): Promise<ParsedZap[]> {
  const records = await repositories.zaps.findByTargetPubkeys(targets)
  return records
    .filter((record) => record.createdAt >= since && record.createdAt <= until)
    .map(zapRecordToParsedZap)
    .sort((left, right) => {
      if (left.createdAt !== right.createdAt) {
        return left.createdAt - right.createdAt
      }
      return left.eventId.localeCompare(right.eventId)
    })
}

async function persistParsedZapReceipts({
  repositories,
  events,
  parsed,
  fetchedAt,
}: {
  repositories: NostrGraphRepositories
  events: readonly NDKEvent[]
  parsed: readonly ParsedZap[]
  fetchedAt: number
}): Promise<void> {
  const eventsById = new Map(events.map((event) => [event.id, event]))
  await Promise.all(
    parsed.map((zap) => {
      const event = eventsById.get(zap.eventId)
      return repositories.zaps.upsert({
        id: zap.eventId,
        fromPubkey: zap.fromPubkey,
        toPubkey: zap.toPubkey,
        sats: zap.sats,
        createdAt: zap.createdAt,
        fetchedAt,
        bolt11: event ? findEventTagValue(event.tags, 'bolt11') : null,
        eventRef: event ? findEventTagValue(event.tags, 'e') : null,
      })
    }),
  )
}

export function useRecentZapReplay({
  enabled,
  visiblePubkeys,
  replayKey,
  refreshKey,
  onZap,
}: {
  enabled: boolean
  visiblePubkeys: readonly string[]
  replayKey: number
  refreshKey: number
  onZap: (zap: ParsedZap) => boolean
}): RecentZapReplaySnapshot {
  const onZapRef = useRef(onZap)
  const handledReplayKeyRef = useRef<number>(replayKey)
  const handledRefreshKeyRef = useRef<number>(refreshKey)

  useEffect(() => {
    onZapRef.current = onZap
  }, [onZap])

  const targetInfo = useMemo(
    () => normalizeTargets(visiblePubkeys),
    [visiblePubkeys],
  )
  const targetSignature = useMemo(
    () => targetInfo.targets.join(','),
    [targetInfo.targets],
  )
  const [snapshot, setSnapshot] =
    useState<RecentZapReplaySnapshot>(INITIAL_SNAPSHOT)

  useEffect(() => {
    if (!enabled) {
      return
    }

    const targets = targetSignature ? targetSignature.split(',') : []
    if (targets.length === 0) {
      return
    }

    let disposed = false
    let replayTimer: ReturnType<typeof setTimeout> | null = null

    const clearReplayTimer = () => {
      if (replayTimer !== null) {
        clearTimeout(replayTimer)
        replayTimer = null
      }
    }

    const replay = (zaps: readonly ParsedZap[]) => {
      if (disposed) return
      if (zaps.length === 0) {
        setSnapshot((current) => ({
          ...current,
          phase: 'done',
          stage: 'done',
          message: 'No hubo zaps reproducibles en la ultima hora para estos nodos.',
          currentZapCreatedAt: current.windowEndAt,
          timelineProgress: 1,
        }))
        return
      }

      const intervalMs = Math.max(140, Math.min(550, Math.floor(12_000 / zaps.length)))
      let playedCount = 0
      let droppedCount = 0

      setSnapshot((current) => ({
        ...current,
        phase: 'playing',
        stage: 'playing',
        message: `Reproduciendo ${zaps.length} zaps de la ultima hora...`,
        playableCount: zaps.length,
        playedCount: 0,
        droppedCount: 0,
        currentZapCreatedAt: current.windowStartAt,
        timelineProgress: 0,
      }))

      const playNext = (index: number) => {
        if (disposed) return
        const zap = zaps[index]
        if (onZapRef.current(zap)) {
          playedCount += 1
        } else {
          droppedCount += 1
        }

        setSnapshot((current) => ({
          ...current,
          playedCount,
          droppedCount,
          currentZapCreatedAt: zap.createdAt,
          timelineProgress:
            current.windowStartAt !== null && current.windowEndAt !== null
              ? calculateTimelineProgress({
                  currentAt: zap.createdAt,
                  since: current.windowStartAt,
                  until: current.windowEndAt,
                })
              : current.timelineProgress,
        }))

        if (index + 1 >= zaps.length) {
          setSnapshot((current) => ({
            ...current,
            phase: 'done',
            stage: 'done',
            message: `Replay terminado: ${playedCount} zaps visibles, ${droppedCount} descartados porque no se pudieron dibujar en la escena.`,
            currentZapCreatedAt: current.windowEndAt,
            timelineProgress: 1,
          }))
          return
        }

        replayTimer = setTimeout(() => playNext(index + 1), intervalMs)
      }

      playNext(0)
    }

    void (async () => {
      const requestedUntil = Math.floor(Date.now() / 1_000)
      const requestedSince = requestedUntil - RECENT_ZAP_REPLAY_LOOKBACK_SEC
      const cacheOnlyReplay = handledReplayKeyRef.current !== replayKey
      const forceRefresh = handledRefreshKeyRef.current !== refreshKey

      setTimeout(() => {
        handledReplayKeyRef.current = replayKey
        handledRefreshKeyRef.current = refreshKey
      }, 0)

      try {
        const repositories = await getZapReplayRepositories()
        const storedCoverage = readReplayCoverage(targetSignature, targets)
        const reusableCoverage =
          storedCoverage && storedCoverage.coveredUntil >= requestedSince
            ? storedCoverage
            : null
        const replayUntil =
          reusableCoverage && !forceRefresh
            ? Math.min(reusableCoverage.coveredUntil, requestedUntil)
            : requestedUntil
        const replaySince =
          reusableCoverage && !forceRefresh
            ? Math.max(
                reusableCoverage.coveredFrom,
                replayUntil - RECENT_ZAP_REPLAY_LOOKBACK_SEC,
              )
            : requestedSince

        const cachedBeforeFetch = await findCachedReplayZaps({
          repositories,
          targets,
          since: replaySince,
          until: replayUntil,
        })

        if (disposed) return

        if (cacheOnlyReplay && !forceRefresh) {
          const replayZaps = cachedBeforeFetch.slice(-RECENT_ZAP_REPLAY_MAX_EVENTS)
          traceZapFlow('recentZapReplay.cacheReplayRequested', {
            targetCount: targets.length,
            cachedCount: cachedBeforeFetch.length,
            replayCount: replayZaps.length,
            since: replaySince,
            until: replayUntil,
          })
          setSnapshot({
            phase: 'done',
            stage: 'done',
            message:
              replayZaps.length > 0
                ? `Replay desde cache: ${replayZaps.length} zaps guardados.`
                : 'No hay zaps guardados en cache para reproducir en esta ultima hora. Usa Actualizar para consultar relays.',
            targetCount: targets.length,
            truncatedTargetCount: targetInfo.truncatedTargetCount,
            batchCount: 0,
            completedBatchCount: 0,
            timedOutBatchCount: 0,
            cachedCount: cachedBeforeFetch.length,
            fetchedCount: 0,
            decodedCount: cachedBeforeFetch.length,
            playableCount: replayZaps.length,
            playedCount: 0,
            droppedCount: 0,
            windowStartAt: replaySince,
            windowEndAt: replayUntil,
            currentZapCreatedAt: replaySince,
            timelineProgress: 0,
          })
          replay(replayZaps)
          return
        }



        const fetchSince =
          reusableCoverage &&
          reusableCoverage.coveredFrom <= requestedSince &&
          reusableCoverage.coveredUntil >= requestedSince
            ? reusableCoverage.coveredUntil + 1
            : requestedSince
        const shouldFetch = fetchSince <= requestedUntil
        const batches = shouldFetch ? chunk(targets, RECENT_ZAP_REPLAY_BATCH_SIZE) : []
        const eventsById = new Map<string, NDKEvent>()
        let timedOutBatchCount = 0

        setSnapshot({
          phase: shouldFetch ? 'loading' : 'done',
          stage: shouldFetch ? 'collecting' : 'done',
          message: shouldFetch
            ? forceRefresh && reusableCoverage
              ? `Actualizando zaps desde cache: descargando lo faltante desde el ultimo corte.`
              : `Buscando zaps de la ultima hora para ${targets.length} nodos visibles...`
            : `Cache al dia: reproduciendo ${cachedBeforeFetch.length} zaps guardados.`,
          targetCount: targets.length,
          truncatedTargetCount: targetInfo.truncatedTargetCount,
          batchCount: batches.length,
          completedBatchCount: 0,
          timedOutBatchCount: 0,
          cachedCount: cachedBeforeFetch.length,
          fetchedCount: 0,
          decodedCount: cachedBeforeFetch.length,
          playableCount: Math.min(cachedBeforeFetch.length, RECENT_ZAP_REPLAY_MAX_EVENTS),
          playedCount: 0,
          droppedCount: 0,
          windowStartAt: requestedSince,
          windowEndAt: requestedUntil,
          currentZapCreatedAt: requestedSince,
          timelineProgress: 0,
        })

        if (!shouldFetch) {
          replay(cachedBeforeFetch.slice(-RECENT_ZAP_REPLAY_MAX_EVENTS))
          return
        }

        traceZapFlow('recentZapReplay.fetchStarted', {
          targetCount: targets.length,
          truncatedTargetCount: targetInfo.truncatedTargetCount,
          cachedCount: cachedBeforeFetch.length,
          batchCount: batches.length,
          since: fetchSince,
          until: requestedUntil,
          requestedSince,
          requestedUntil,
        })

        const ndk = await connectNDK()
        await runWithConcurrencyLimit(
          batches,
          RECENT_ZAP_REPLAY_MAX_CONCURRENCY,
          async (batch) => {
            if (disposed) return
            const batchResult = await collectZapReplayBatch({
              ndk,
              batch,
              since: fetchSince,
              until: requestedUntil + 60,
            })
            if (disposed) return
            if (batchResult.timedOut) {
              timedOutBatchCount += 1
            }
            for (const event of batchResult.events) {
              eventsById.set(event.id, event)
            }
            setSnapshot((current) => ({
              ...current,
              completedBatchCount: Math.min(
                batches.length,
                current.completedBatchCount + 1,
              ),
              timedOutBatchCount,
              message:
                timedOutBatchCount > 0
                  ? `Actualizando zaps... ${timedOutBatchCount} batches cerraron por timeout parcial.`
                  : current.message,
              fetchedCount: eventsById.size,
            }))
          },
        )

        if (disposed) return

        setSnapshot((current) => ({
          ...current,
          stage: 'decoding',
          completedBatchCount: batches.length,
          timedOutBatchCount,
          message: `Guardando ${eventsById.size} recibos nuevos de zap en cache...`,
        }))

        const fetchedEvents = Array.from(eventsById.values())
        const parsed = fetchedEvents
          .map((event) => parseZapReceiptEvent(toRawZapReceiptEvent(event)))
          .filter((zap): zap is ParsedZap => zap !== null)
          // Use the clock drift buffer here too
          .filter((zap) => zap.createdAt >= fetchSince && zap.createdAt <= requestedUntil + 60)
          .sort((left, right) => {
            if (left.createdAt !== right.createdAt) {
              return left.createdAt - right.createdAt
            }
            return left.eventId.localeCompare(right.eventId)
          })

        await persistParsedZapReceipts({
          repositories,
          events: fetchedEvents,
          parsed,
          fetchedAt: Date.now(),
        })

        if (timedOutBatchCount === 0) {
          writeReplayCoverage({
            targetSignature,
            targets,
            coveredFrom: requestedSince,
            coveredUntil: requestedUntil,
          })
        }

        if (disposed) return

        const cachedAfterFetch = await findCachedReplayZaps({
          repositories,
          targets,
          since: requestedSince,
          until: requestedUntil + 60,
        })
        if (disposed) return

        const replayZaps = cachedAfterFetch.slice(-RECENT_ZAP_REPLAY_MAX_EVENTS)

        traceZapFlow('recentZapReplay.fetchFinished', {
          fetchedCount: eventsById.size,
          parsedCount: parsed.length,
          cachedCount: cachedAfterFetch.length,
          replayCount: replayZaps.length,
          timedOutBatchCount,
        })

        setSnapshot((current) => ({
          ...current,
          fetchedCount: eventsById.size,
          cachedCount: cachedAfterFetch.length,
          decodedCount: cachedAfterFetch.length,
          playableCount: replayZaps.length,
          message:
            cachedAfterFetch.length > replayZaps.length
              ? `Cache actualizado: ${cachedAfterFetch.length} zaps; mostrando los ${replayZaps.length} mas recientes.`
              : timedOutBatchCount > 0
                ? `Cache parcial: ${cachedAfterFetch.length} zaps reproducibles con ${timedOutBatchCount} timeout parcial.`
                : `Cache actualizado: ${cachedAfterFetch.length} zaps reproducibles.`,
        }))
        replay(replayZaps)
      } catch (error) {
        if (disposed) return
        const message =
          error instanceof Error
            ? `No se pudo consultar zaps de la ultima hora: ${error.message}`
            : 'No se pudo consultar zaps de la ultima hora.'
        traceZapFlow('recentZapReplay.fetchFailed', { message })
        setSnapshot((current) => ({
          ...current,
          phase: 'error',
          stage: 'error',
          message,
        }))
      }
    })()

    return () => {
      disposed = true
      clearReplayTimer()
    }
  }, [
    enabled,
    refreshKey,
    replayKey,
    targetInfo.truncatedTargetCount,
    targetSignature,
  ])

  if (!enabled) {
    return INITIAL_SNAPSHOT
  }

  if (targetInfo.targets.length === 0) {
    return {
      ...INITIAL_SNAPSHOT,
      message: 'Esperando nodos visibles para reproducir zaps de la ultima hora.',
    }
  }

  return snapshot
}
