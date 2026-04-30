'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type NDK from '@nostr-dev-kit/ndk'
import type { NDKEvent, NDKSubscription } from '@nostr-dev-kit/ndk'

import { connectNDK } from '@/lib/nostr'
import {
  KIND_PARSER_SPECS,
  type KindParserSpec,
} from '@/features/graph-v2/events/parsers'
import type {
  GraphEventKind,
  ParsedGraphEvent,
} from '@/features/graph-v2/events/types'

const SECONDS_PER_HOUR = 60 * 60
const RECENT_GRAPH_EVENT_REPLAY_TARGET_LIMIT = 768
const RECENT_GRAPH_EVENT_REPLAY_BATCH_SIZE = 128
const RECENT_GRAPH_EVENT_REPLAY_MAX_EVENTS = 220
const RECENT_GRAPH_EVENT_REPLAY_FETCH_TIMEOUT_MS = 8_000
const RECENT_GRAPH_EVENT_REPLAY_MAX_CONCURRENCY = 2

type ReplayableGraphEventKind = Exclude<GraphEventKind, 'zap'>
type RecentGraphEventReplayPhase = 'idle' | 'loading' | 'playing' | 'done' | 'error'
type RecentGraphEventReplayStage =
  | 'idle'
  | 'collecting'
  | 'decoding'
  | 'playing'
  | 'done'
  | 'error'

export interface RecentGraphEventReplaySnapshot {
  phase: RecentGraphEventReplayPhase
  stage: RecentGraphEventReplayStage
  playbackPaused: boolean
  message: string | null
  kindCount: number
  targetCount: number
  truncatedTargetCount: number
  batchCount: number
  completedBatchCount: number
  timedOutBatchCount: number
  fetchedCount: number
  decodedCount: number
  playableCount: number
  playedCount: number
  droppedCount: number
}

const INITIAL_SNAPSHOT: RecentGraphEventReplaySnapshot = {
  phase: 'idle',
  stage: 'idle',
  playbackPaused: false,
  message: null,
  kindCount: 0,
  targetCount: 0,
  truncatedTargetCount: 0,
  batchCount: 0,
  completedBatchCount: 0,
  timedOutBatchCount: 0,
  fetchedCount: 0,
  decodedCount: 0,
  playableCount: 0,
  playedCount: 0,
  droppedCount: 0,
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
    targets: normalized.slice(0, RECENT_GRAPH_EVENT_REPLAY_TARGET_LIMIT),
    truncatedTargetCount: Math.max(
      0,
      normalized.length - RECENT_GRAPH_EVENT_REPLAY_TARGET_LIMIT,
    ),
  }
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const batches: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size))
  }
  return batches
}

function buildFilters(
  spec: KindParserSpec,
  batch: readonly string[],
  since: number,
  until: number,
) {
  const limit = Math.min(
    RECENT_GRAPH_EVENT_REPLAY_MAX_EVENTS,
    Math.max(25, batch.length * 2),
  )
  if (spec.filterMode === 'authors') {
    return [{ kinds: spec.kinds, authors: [...batch], since, until, limit }]
  }
  return [{ kinds: spec.kinds, '#p': [...batch], since, until, limit }]
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

async function collectGraphEventReplayBatch({
  ndk,
  spec,
  batch,
  since,
  until,
}: {
  ndk: NDK
  spec: KindParserSpec
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
    }, RECENT_GRAPH_EVENT_REPLAY_FETCH_TIMEOUT_MS)

    subscription = ndk.subscribe(
      buildFilters(spec, batch, since, until),
      { closeOnEose: true },
    )
    subscription.on('event', (event: NDKEvent) => {
      eventsById.set(event.id, event)
    })
    subscription.on('eose', () => finish(false))
    subscription.on('close', () => finish(false))
  })
}

function toRawEvent(event: NDKEvent) {
  return {
    id: event.id,
    pubkey: event.pubkey,
    kind: event.kind ?? 0,
    created_at: event.created_at ?? 0,
    content: event.content ?? '',
    tags: event.tags ?? [],
  }
}

export function useRecentGraphEventReplay({
  enabled,
  kinds,
  visiblePubkeys,
  lookbackHours,
  replayKey,
  refreshKey,
  playbackPaused = false,
  onEvent,
}: {
  enabled: boolean
  kinds: readonly ReplayableGraphEventKind[]
  visiblePubkeys: readonly string[]
  lookbackHours: number
  replayKey: number
  refreshKey: number
  playbackPaused?: boolean
  onEvent: (event: ParsedGraphEvent) => boolean
}): RecentGraphEventReplaySnapshot {
  const onEventRef = useRef(onEvent)
  const replayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const replayRunIdRef = useRef(0)
  const replayEventsRef = useRef<ParsedGraphEvent[]>([])
  const playbackPausedRef = useRef(playbackPaused)
  const replayPlaybackRef = useRef<{
    events: ParsedGraphEvent[]
    nextIndex: number
    intervalMs: number
    message: string
  } | null>(null)
  const replayCountsRef = useRef({ playedCount: 0, droppedCount: 0 })
  const [snapshot, setSnapshot] =
    useState<RecentGraphEventReplaySnapshot>(INITIAL_SNAPSHOT)

  useEffect(() => {
    onEventRef.current = onEvent
  }, [onEvent])

  useEffect(() => {
    playbackPausedRef.current = playbackPaused
  }, [playbackPaused])

  const targetInfo = useMemo(
    () => normalizeTargets(visiblePubkeys),
    [visiblePubkeys],
  )
  const targetSignature = useMemo(
    () => targetInfo.targets.join(','),
    [targetInfo.targets],
  )
  const kindSignature = useMemo(
    () => Array.from(new Set(kinds)).sort().join(','),
    [kinds],
  )
  const appliedLookbackHours = Math.max(1, Math.min(24, Math.floor(lookbackHours)))

  const clearReplayTimer = useCallback(() => {
    replayRunIdRef.current += 1
    if (replayTimerRef.current !== null) {
      clearTimeout(replayTimerRef.current)
      replayTimerRef.current = null
    }
  }, [])

  const playReplayFromIndex = useCallback(({
    events,
    startIndex,
    resetCounts,
    message,
  }: {
    events: readonly ParsedGraphEvent[]
    startIndex: number
    resetCounts: boolean
    message: string
  }) => {
    clearReplayTimer()
    const replayEvents = [...events]
    replayEventsRef.current = replayEvents
    const runId = replayRunIdRef.current

    if (replayEvents.length === 0) {
      replayPlaybackRef.current = null
      setSnapshot((current) => ({
        ...current,
        phase: 'done',
        stage: 'done',
        playbackPaused: false,
        message: 'No hubo actividades reproducibles para los tipos habilitados.',
      }))
      return
    }

    const safeStartIndex = Math.max(
      0,
      Math.min(replayEvents.length - 1, startIndex),
    )
    const intervalMs = Math.max(
      130,
      Math.min(520, Math.floor(12_000 / replayEvents.length)),
    )
    if (resetCounts) {
      replayCountsRef.current = { playedCount: 0, droppedCount: 0 }
    }
    replayPlaybackRef.current = {
      events: replayEvents,
      nextIndex: safeStartIndex,
      intervalMs,
      message,
    }

    setSnapshot((current) => ({
      ...current,
      phase: 'playing',
      stage: 'playing',
      playbackPaused: playbackPausedRef.current,
      message,
      playableCount: replayEvents.length,
      playedCount: replayCountsRef.current.playedCount,
      droppedCount: replayCountsRef.current.droppedCount,
    }))

    const playNext = (index: number) => {
      if (replayRunIdRef.current !== runId) return
      const event = replayEvents[index]
      if (!event) return

      replayPlaybackRef.current = {
        events: replayEvents,
        nextIndex: index,
        intervalMs,
        message,
      }

      if (playbackPausedRef.current) {
        setSnapshot((current) => ({
          ...current,
          playbackPaused: true,
          message: 'Replay pausado.',
        }))
        return
      }

      if (onEventRef.current(event)) {
        replayCountsRef.current = {
          ...replayCountsRef.current,
          playedCount: replayCountsRef.current.playedCount + 1,
        }
      } else {
        replayCountsRef.current = {
          ...replayCountsRef.current,
          droppedCount: replayCountsRef.current.droppedCount + 1,
        }
      }

      const { playedCount, droppedCount } = replayCountsRef.current
      const nextIndex = index + 1
      replayPlaybackRef.current = {
        events: replayEvents,
        nextIndex,
        intervalMs,
        message,
      }
      setSnapshot((current) => ({
        ...current,
        playbackPaused: false,
        playedCount,
        droppedCount,
      }))

      if (nextIndex >= replayEvents.length) {
        replayPlaybackRef.current = null
        setSnapshot((current) => ({
          ...current,
          phase: 'done',
          stage: 'done',
          playbackPaused: false,
          message: `Replay de actividad terminado: ${playedCount} visibles, ${droppedCount} descartadas.`,
        }))
        return
      }

      replayTimerRef.current = setTimeout(() => playNext(nextIndex), intervalMs)
    }

    playNext(safeStartIndex)
  }, [clearReplayTimer])

  useEffect(() => {
    if (!enabled) return
    const playback = replayPlaybackRef.current
    if (!playback || snapshot.stage !== 'playing') return

    if (playbackPaused) {
      clearReplayTimer()
      setSnapshot((current) => ({
        ...current,
        playbackPaused: true,
        message: 'Replay pausado.',
      }))
      return
    }

    playReplayFromIndex({
      events: playback.events,
      startIndex: playback.nextIndex,
      resetCounts: false,
      message: playback.message,
    })
  }, [
    clearReplayTimer,
    enabled,
    playbackPaused,
    playReplayFromIndex,
    snapshot.stage,
  ])

  useEffect(() => {
    if (!enabled) {
      clearReplayTimer()
      replayPlaybackRef.current = null
      return
    }

    const targets = targetSignature ? targetSignature.split(',') : []
    const replayKinds = kindSignature
      ? (kindSignature.split(',') as ReplayableGraphEventKind[])
      : []
    if (targets.length === 0 || replayKinds.length === 0) {
      setSnapshot({
        ...INITIAL_SNAPSHOT,
        kindCount: replayKinds.length,
        targetCount: targets.length,
        truncatedTargetCount: targetInfo.truncatedTargetCount,
        message:
          replayKinds.length === 0
            ? 'No hay tipos de actividad habilitados para replay.'
            : 'Esperando nodos visibles para reproducir actividad.',
      })
      return
    }

    let disposed = false

    void (async () => {
      const requestedUntil = Math.floor(Date.now() / 1_000)
      const requestedSince =
        requestedUntil - appliedLookbackHours * SECONDS_PER_HOUR
      const jobs = replayKinds.flatMap((kind) => {
        const spec = KIND_PARSER_SPECS[kind]
        return chunk(targets, RECENT_GRAPH_EVENT_REPLAY_BATCH_SIZE).map(
          (batch) => ({ kind, spec, batch }),
        )
      })
      const parsedById = new Map<string, ParsedGraphEvent>()
      let fetchedCount = 0
      let timedOutBatchCount = 0

      setSnapshot({
        ...INITIAL_SNAPSHOT,
        phase: 'loading',
        stage: 'collecting',
        playbackPaused: playbackPausedRef.current,
        message: `Buscando actividad reciente para ${replayKinds.length} tipos habilitados...`,
        kindCount: replayKinds.length,
        targetCount: targets.length,
        truncatedTargetCount: targetInfo.truncatedTargetCount,
        batchCount: jobs.length,
      })

      try {
        const ndk = await connectNDK()
        await runWithConcurrencyLimit(
          jobs,
          RECENT_GRAPH_EVENT_REPLAY_MAX_CONCURRENCY,
          async ({ spec, batch }) => {
            if (disposed) return
            const batchResult = await collectGraphEventReplayBatch({
              ndk,
              spec,
              batch,
              since: requestedSince,
              until: requestedUntil + 60,
            })
            if (disposed) return
            if (batchResult.timedOut) {
              timedOutBatchCount += 1
            }
            fetchedCount += batchResult.events.length
            for (const rawEvent of batchResult.events) {
              const parsed = spec.parse(toRawEvent(rawEvent))
              for (const event of parsed) {
                if (
                  event.createdAt >= requestedSince &&
                  event.createdAt <= requestedUntil + 60
                ) {
                  parsedById.set(event.eventId, event)
                }
              }
            }
            setSnapshot((current) => ({
              ...current,
              completedBatchCount: Math.min(
                jobs.length,
                current.completedBatchCount + 1,
              ),
              timedOutBatchCount,
              fetchedCount,
              decodedCount: parsedById.size,
              message:
                timedOutBatchCount > 0
                  ? `Actividad parcial: ${timedOutBatchCount} batches cerraron por timeout.`
                  : current.message,
            }))
          },
        )

        if (disposed) return

        setSnapshot((current) => ({
          ...current,
          stage: 'decoding',
          completedBatchCount: jobs.length,
          timedOutBatchCount,
          fetchedCount,
          decodedCount: parsedById.size,
          message: `Preparando ${parsedById.size} actividades para replay...`,
        }))

        const replayEvents = Array.from(parsedById.values())
          .sort((left, right) => {
            if (left.createdAt !== right.createdAt) {
              return left.createdAt - right.createdAt
            }
            return left.eventId.localeCompare(right.eventId)
          })
          .slice(-RECENT_GRAPH_EVENT_REPLAY_MAX_EVENTS)

        setSnapshot((current) => ({
          ...current,
          playableCount: replayEvents.length,
          message:
            parsedById.size > replayEvents.length
              ? `Replay limitado a las ${replayEvents.length} actividades mas recientes.`
              : `Replay listo: ${replayEvents.length} actividades.`,
        }))

        playReplayFromIndex({
          events: replayEvents,
          startIndex: 0,
          resetCounts: true,
          message: `Reproduciendo ${replayEvents.length} actividades recientes...`,
        })
      } catch (error) {
        if (disposed) return
        setSnapshot((current) => ({
          ...current,
          phase: 'error',
          stage: 'error',
          playbackPaused: false,
          message:
            error instanceof Error
              ? `No se pudo consultar actividad reciente: ${error.message}`
              : 'No se pudo consultar actividad reciente.',
        }))
      }
    })()

    return () => {
      disposed = true
      clearReplayTimer()
    }
  }, [
    appliedLookbackHours,
    clearReplayTimer,
    enabled,
    kindSignature,
    playReplayFromIndex,
    refreshKey,
    replayKey,
    targetInfo.truncatedTargetCount,
    targetSignature,
  ])

  if (!enabled) {
    return INITIAL_SNAPSHOT
  }

  return snapshot
}
