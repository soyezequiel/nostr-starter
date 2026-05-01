'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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

const SECONDS_PER_HOUR = 60 * 60

export const RECENT_ZAP_REPLAY_MIN_LOOKBACK_HOURS = 1
export const RECENT_ZAP_REPLAY_MAX_LOOKBACK_HOURS = 24
export const RECENT_ZAP_REPLAY_DEFAULT_LOOKBACK_HOURS = 24

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

export interface RecentZapReplayFetchRange {
  since: number
  until: number
}

export interface RecentZapReplaySnapshot {
  phase: RecentZapReplayPhase
  stage: RecentZapReplayStage
  playbackPaused: boolean
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
  playbackPaused: false,
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

export type RecentZapReplayCollectionStatus =
  | 'idle'
  | 'collecting'
  | 'done'
  | 'partial'
  | 'error'

export interface RecentZapReplayCollectionViewModel {
  progress: number
  status: RecentZapReplayCollectionStatus
  isIndeterminate: boolean
}

export function clampRecentZapReplayLookbackHours(value: number): number {
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    return RECENT_ZAP_REPLAY_DEFAULT_LOOKBACK_HOURS
  }

  return Math.max(
    RECENT_ZAP_REPLAY_MIN_LOOKBACK_HOURS,
    Math.min(RECENT_ZAP_REPLAY_MAX_LOOKBACK_HOURS, value),
  )
}

export function formatRecentZapReplayWindowLabel(hours: number): string {
  const clampedHours = clampRecentZapReplayLookbackHours(hours)
  return clampedHours === 1 ? 'ultima hora' : `ultimas ${clampedHours} horas`
}

export function buildRecentZapReplayCollectionViewModel(
  replay: Pick<
    RecentZapReplaySnapshot,
    | 'phase'
    | 'stage'
    | 'batchCount'
    | 'completedBatchCount'
    | 'timedOutBatchCount'
  >,
): RecentZapReplayCollectionViewModel {
  if (replay.phase === 'error' || replay.stage === 'error') {
    return { progress: 1, status: 'error', isIndeterminate: false }
  }

  const hasFinishedCollecting =
    replay.stage === 'playing' || replay.stage === 'done' || replay.stage === 'decoding'
  const progress =
    replay.batchCount > 0
      ? clampProgress(replay.completedBatchCount / replay.batchCount)
      : hasFinishedCollecting
        ? 1
        : 0
  const status: RecentZapReplayCollectionStatus =
    replay.timedOutBatchCount > 0 && hasFinishedCollecting
      ? 'partial'
      : replay.stage === 'collecting'
        ? 'collecting'
        : hasFinishedCollecting
          ? 'done'
          : 'idle'

  return {
    progress,
    status,
    isIndeterminate: status === 'collecting' && progress < 1,
  }
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

export function findZapReplaySeekIndex(
  zaps: readonly Pick<ParsedZap, 'createdAt' | 'eventId'>[],
  targetCreatedAt: number,
): number {
  if (zaps.length === 0) return -1
  let selectedIndex = zaps.length - 1

  for (let index = 0; index < zaps.length; index += 1) {
    if (zaps[index].createdAt >= targetCreatedAt) {
      selectedIndex = index
      break
    }
  }

  return selectedIndex
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

export interface RecentZapReplayCacheClearSummary {
  coverageKeys: number
  zapRecordsCleared: boolean
}

interface ReplayCoverageStorage {
  readonly length: number
  key(index: number): string | null
  removeItem(key: string): void
}

export function clearRecentZapReplayCoverageStorage(
  storage: ReplayCoverageStorage,
): number {
  const keysToRemove: string[] = []

  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index)
    if (key?.startsWith(RECENT_ZAP_REPLAY_COVERAGE_PREFIX)) {
      keysToRemove.push(key)
    }
  }

  for (const key of keysToRemove) {
    storage.removeItem(key)
  }

  return keysToRemove.length
}

export async function clearRecentZapReplayCache(): Promise<RecentZapReplayCacheClearSummary> {
  let coverageKeys = 0

  if (typeof window !== 'undefined') {
    try {
      coverageKeys = clearRecentZapReplayCoverageStorage(window.localStorage)
    } catch {
      coverageKeys = 0
    }
  }

  try {
    const repositories = await getZapReplayRepositories()
    await repositories.zaps.clear()
    return { coverageKeys, zapRecordsCleared: true }
  } catch {
    return { coverageKeys, zapRecordsCleared: false }
  }
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

function appendReplayFetchRange(
  ranges: RecentZapReplayFetchRange[],
  since: number,
  until: number,
): void {
  if (since <= until) {
    ranges.push({ since, until })
  }
}

export function buildRecentZapReplayFetchRanges({
  requestedSince,
  requestedUntil,
  coverage,
  includeFreshTail,
}: {
  requestedSince: number
  requestedUntil: number
  coverage: Pick<RecentZapReplayCoverage, 'coveredFrom' | 'coveredUntil'> | null
  includeFreshTail: boolean
}): RecentZapReplayFetchRange[] {
  if (requestedSince > requestedUntil) {
    return []
  }

  if (!coverage) {
    return [{ since: requestedSince, until: requestedUntil }]
  }

  const overlapsRequestedWindow =
    coverage.coveredUntil >= requestedSince &&
    coverage.coveredFrom <= requestedUntil

  if (!overlapsRequestedWindow) {
    return [{ since: requestedSince, until: requestedUntil }]
  }

  const ranges: RecentZapReplayFetchRange[] = []

  appendReplayFetchRange(
    ranges,
    requestedSince,
    Math.min(requestedUntil, coverage.coveredFrom - 1),
  )

  if (includeFreshTail) {
    appendReplayFetchRange(
      ranges,
      Math.max(requestedSince, coverage.coveredUntil + 1),
      requestedUntil,
    )
  }

  return ranges
}

function mergeReplayCoverageAfterFetch({
  coverage,
  fetchRanges,
}: {
  coverage: Pick<RecentZapReplayCoverage, 'coveredFrom' | 'coveredUntil'> | null
  fetchRanges: readonly RecentZapReplayFetchRange[]
}): Pick<RecentZapReplayCoverage, 'coveredFrom' | 'coveredUntil'> | null {
  if (fetchRanges.length === 0) {
    return coverage
      ? {
          coveredFrom: coverage.coveredFrom,
          coveredUntil: coverage.coveredUntil,
        }
      : null
  }

  let coveredFrom = coverage?.coveredFrom ?? fetchRanges[0].since
  let coveredUntil = coverage?.coveredUntil ?? fetchRanges[0].until

  for (const range of fetchRanges) {
    coveredFrom = Math.min(coveredFrom, range.since)
    coveredUntil = Math.max(coveredUntil, range.until)
  }

  return { coveredFrom, coveredUntil }
}

function isTimestampInFetchRanges(
  timestamp: number,
  ranges: readonly RecentZapReplayFetchRange[],
  clockDriftSeconds: number,
): boolean {
  return ranges.some(
    (range) =>
      timestamp >= range.since && timestamp <= range.until + clockDriftSeconds,
  )
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
    zappedEventId: record.eventRef && /^[0-9a-f]{64}$/i.test(record.eventRef)
      ? record.eventRef.toLowerCase()
      : null,
    // El cache persistido no guarda el comentario aun; los zaps recientes
    // muestran el detalle vacio mientras no se rehidrate desde live.
    comment: null,
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
  lookbackHours,
  replayKey,
  refreshKey,
  playbackPaused = false,
  seekKey = 0,
  seekProgress = 0,
  onZap,
}: {
  enabled: boolean
  visiblePubkeys: readonly string[]
  lookbackHours: number
  replayKey: number
  refreshKey: number
  playbackPaused?: boolean
  seekKey?: number
  seekProgress?: number
  onZap: (zap: ParsedZap) => boolean
}): RecentZapReplaySnapshot {
  const onZapRef = useRef(onZap)
  const handledReplayKeyRef = useRef<number>(replayKey)
  const handledRefreshKeyRef = useRef<number>(refreshKey)
  const handledSeekKeyRef = useRef<number>(seekKey)
  const handledPlaybackPausedRef = useRef(playbackPaused)
  const replayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const replayRunIdRef = useRef(0)
  const replayZapsRef = useRef<ParsedZap[]>([])
  const replayCountsRef = useRef({ playedCount: 0, droppedCount: 0 })
  const playbackPausedRef = useRef(playbackPaused)
  const replayPausedSnapshotTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const replayPlaybackRef = useRef<{
    zaps: ParsedZap[]
    nextIndex: number
    intervalMs: number
    message: string
  } | null>(null)

  useEffect(() => {
    onZapRef.current = onZap
  }, [onZap])

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
  const appliedLookbackHours = clampRecentZapReplayLookbackHours(lookbackHours)
  const replayWindowLabel = formatRecentZapReplayWindowLabel(appliedLookbackHours)
  const replayWindowText =
    appliedLookbackHours === 1 ? `la ${replayWindowLabel}` : `las ${replayWindowLabel}`
  const [snapshot, setSnapshot] =
    useState<RecentZapReplaySnapshot>(INITIAL_SNAPSHOT)

  const clearReplayTimer = useCallback(() => {
    replayRunIdRef.current += 1
    if (replayTimerRef.current !== null) {
      clearTimeout(replayTimerRef.current)
      replayTimerRef.current = null
    }
    if (replayPausedSnapshotTimerRef.current !== null) {
      clearTimeout(replayPausedSnapshotTimerRef.current)
      replayPausedSnapshotTimerRef.current = null
    }
  }, [])

  const stopReplayTimer = useCallback(() => {
    if (replayTimerRef.current !== null) {
      clearTimeout(replayTimerRef.current)
      replayTimerRef.current = null
    }
  }, [])

  const setReplayPausedSnapshot = useCallback((paused: boolean) => {
    setSnapshot((current) =>
      current.playbackPaused === paused
        ? current
        : {
            ...current,
            playbackPaused: paused,
            message:
              paused && current.stage === 'playing'
                ? 'Replay pausado.'
                : current.message,
          },
    )
  }, [])

  const scheduleReplayPausedSnapshot = useCallback((paused: boolean) => {
    if (replayPausedSnapshotTimerRef.current !== null) {
      clearTimeout(replayPausedSnapshotTimerRef.current)
      replayPausedSnapshotTimerRef.current = null
    }
    replayPausedSnapshotTimerRef.current = setTimeout(() => {
      replayPausedSnapshotTimerRef.current = null
      setReplayPausedSnapshot(paused)
    }, 0)
  }, [setReplayPausedSnapshot])

  const playReplayFromIndex = useCallback(({
    zaps,
    startIndex,
    resetCounts,
    message,
  }: {
    zaps: readonly ParsedZap[]
    startIndex: number
    resetCounts: boolean
    message: string
  }) => {
    clearReplayTimer()
    const replayZaps = [...zaps]
    replayZapsRef.current = replayZaps
    const runId = replayRunIdRef.current

    if (replayZaps.length === 0) {
      replayPlaybackRef.current = null
      setSnapshot((current) => ({
        ...current,
        phase: 'done',
        stage: 'done',
        playbackPaused: false,
        message: `No hubo zaps reproducibles en ${replayWindowText} para estos nodos.`,
        currentZapCreatedAt: current.windowEndAt,
        timelineProgress: 1,
      }))
      return
    }

    const safeStartIndex = Math.max(0, Math.min(replayZaps.length - 1, startIndex))
    const intervalMs = Math.max(140, Math.min(550, Math.floor(12_000 / replayZaps.length)))
    if (resetCounts) {
      replayCountsRef.current = { playedCount: 0, droppedCount: 0 }
    }
    replayPlaybackRef.current = {
      zaps: replayZaps,
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
      playableCount: replayZaps.length,
      playedCount: replayCountsRef.current.playedCount,
      droppedCount: replayCountsRef.current.droppedCount,
      currentZapCreatedAt: replayZaps[safeStartIndex]?.createdAt ?? current.windowStartAt,
      timelineProgress:
        current.windowStartAt !== null &&
        current.windowEndAt !== null &&
        replayZaps[safeStartIndex]
          ? calculateTimelineProgress({
              currentAt: replayZaps[safeStartIndex].createdAt,
              since: current.windowStartAt,
              until: current.windowEndAt,
            })
          : current.timelineProgress,
    }))

    const playNext = (index: number) => {
      if (replayRunIdRef.current !== runId) return
      const zap = replayZaps[index]
      if (!zap) return

      replayPlaybackRef.current = {
        zaps: replayZaps,
        nextIndex: index,
        intervalMs,
        message,
      }

      if (playbackPausedRef.current) {
        setReplayPausedSnapshot(true)
        return
      }

      if (onZapRef.current(zap)) {
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
        zaps: replayZaps,
        nextIndex,
        intervalMs,
        message,
      }
      setSnapshot((current) => ({
        ...current,
        playbackPaused: false,
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

      if (nextIndex >= replayZaps.length) {
        replayPlaybackRef.current = null
        setSnapshot((current) => ({
          ...current,
          phase: 'done',
          stage: 'done',
          playbackPaused: false,
          message: `Replay terminado: ${playedCount} zaps visibles, ${droppedCount} descartados porque no se pudieron dibujar en la escena.`,
          currentZapCreatedAt: current.windowEndAt,
          timelineProgress: 1,
        }))
        return
      }

      replayTimerRef.current = setTimeout(() => playNext(nextIndex), intervalMs)
    }

    playNext(safeStartIndex)
  }, [clearReplayTimer, replayWindowText, setReplayPausedSnapshot])

  useEffect(() => {
    if (!enabled) return
    if (handledPlaybackPausedRef.current === playbackPaused) return
    handledPlaybackPausedRef.current = playbackPaused

    if (playbackPaused) {
      stopReplayTimer()
      replayRunIdRef.current += 1
      scheduleReplayPausedSnapshot(true)
      return
    }

    scheduleReplayPausedSnapshot(false)
    const playback = replayPlaybackRef.current
    if (!playback || snapshot.stage !== 'playing') {
      return
    }

    playReplayFromIndex({
      zaps: playback.zaps,
      startIndex: playback.nextIndex,
      resetCounts: false,
      message: playback.message,
    })
  }, [
    enabled,
    playReplayFromIndex,
    playbackPaused,
    scheduleReplayPausedSnapshot,
    snapshot.stage,
    stopReplayTimer,
  ])

  useEffect(() => {
    if (!enabled) {
      return
    }

    const targets = targetSignature ? targetSignature.split(',') : []
    if (targets.length === 0) {
      return
    }

    let disposed = false

    const replay = (zaps: readonly ParsedZap[]) => {
      if (disposed) return
      playReplayFromIndex({
        zaps,
        startIndex: 0,
        resetCounts: true,
        message: `Reproduciendo ${zaps.length} zaps de ${replayWindowText}...`,
      })
    }

    void (async () => {
      const requestedUntil = Math.floor(Date.now() / 1_000)
      const lookbackSeconds = appliedLookbackHours * SECONDS_PER_HOUR
      const requestedSince = requestedUntil - lookbackSeconds
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
          storedCoverage &&
          storedCoverage.coveredUntil >= requestedSince &&
          storedCoverage.coveredFrom <= requestedUntil
            ? storedCoverage
            : null
        const replayUntil =
          reusableCoverage && !forceRefresh
            ? Math.min(reusableCoverage.coveredUntil, requestedUntil)
            : requestedUntil
        const replaySince =
          reusableCoverage && !forceRefresh
            ? Math.max(reusableCoverage.coveredFrom, requestedSince)
            : requestedSince
        const fetchRanges =
          cacheOnlyReplay && !forceRefresh
            ? []
            : buildRecentZapReplayFetchRanges({
                requestedSince,
                requestedUntil,
                coverage: reusableCoverage,
                includeFreshTail: forceRefresh,
              })

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
            playbackPaused: playbackPausedRef.current,
            message:
              replayZaps.length > 0
                ? `Replay desde cache: ${replayZaps.length} zaps guardados.`
                : `No hay zaps guardados en cache para reproducir en ${replayWindowText}. Usa Actualizar para consultar relays.`,
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

        const batches =
          fetchRanges.length > 0
            ? chunk(targets, RECENT_ZAP_REPLAY_BATCH_SIZE)
            : []
        const fetchJobs = fetchRanges.flatMap((range) =>
          batches.map((batch) => ({ range, batch })),
        )
        const shouldFetch = fetchJobs.length > 0
        const cacheHasFreshTail =
          !reusableCoverage || reusableCoverage.coveredUntil >= requestedUntil
        const eventsById = new Map<string, NDKEvent>()
        let timedOutBatchCount = 0

        setSnapshot({
          phase: shouldFetch ? 'loading' : 'done',
          stage: shouldFetch ? 'collecting' : 'done',
          playbackPaused: playbackPausedRef.current,
          message: shouldFetch
            ? reusableCoverage
              ? `Reutilizando cache: descargando solo el rango faltante para ${replayWindowText}.`
              : `Buscando zaps de ${replayWindowText} para ${targets.length} nodos visibles...`
            : cacheHasFreshTail
              ? `Cache al dia: reproduciendo ${cachedBeforeFetch.length} zaps guardados.`
              : `Cache reutilizado: reproduciendo ${cachedBeforeFetch.length} zaps guardados. Usa Actualizar para buscar zaps nuevos.`,
          targetCount: targets.length,
          truncatedTargetCount: targetInfo.truncatedTargetCount,
          batchCount: fetchJobs.length,
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
          batchCount: fetchJobs.length,
          fetchRanges,
          requestedSince,
          requestedUntil,
        })

        const ndk = await connectNDK()
        await runWithConcurrencyLimit(
          fetchJobs,
          RECENT_ZAP_REPLAY_MAX_CONCURRENCY,
          async ({ range, batch }) => {
            if (disposed) return
            const batchResult = await collectZapReplayBatch({
              ndk,
              batch,
              since: range.since,
              until: range.until + 60,
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
                fetchJobs.length,
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
          completedBatchCount: fetchJobs.length,
          timedOutBatchCount,
          message: `Guardando ${eventsById.size} recibos nuevos de zap en cache...`,
        }))

        const fetchedEvents = Array.from(eventsById.values())
        const parsed = fetchedEvents
          .map((event) => parseZapReceiptEvent(toRawZapReceiptEvent(event)))
          .filter((zap): zap is ParsedZap => zap !== null)
          // Use the clock drift buffer here too
          .filter((zap) => isTimestampInFetchRanges(zap.createdAt, fetchRanges, 60))
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

        const mergedCoverage = mergeReplayCoverageAfterFetch({
          coverage: reusableCoverage,
          fetchRanges,
        })

        if (timedOutBatchCount === 0) {
          if (mergedCoverage) {
            writeReplayCoverage({
              targetSignature,
              targets,
              coveredFrom: mergedCoverage.coveredFrom,
              coveredUntil: mergedCoverage.coveredUntil,
            })
          }
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
            ? `No se pudo consultar zaps de ${replayWindowText}: ${error.message}`
            : `No se pudo consultar zaps de ${replayWindowText}.`
        traceZapFlow('recentZapReplay.fetchFailed', { message })
        setSnapshot((current) => ({
          ...current,
          phase: 'error',
          stage: 'error',
          playbackPaused: false,
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
    appliedLookbackHours,
    clearReplayTimer,
    playReplayFromIndex,
    refreshKey,
    replayKey,
    replayWindowText,
    replayWindowLabel,
    targetInfo.truncatedTargetCount,
    targetSignature,
  ])

  useEffect(() => {
    if (!enabled || seekKey === handledSeekKeyRef.current) {
      return
    }

    handledSeekKeyRef.current = seekKey
    const zaps = replayZapsRef.current
    if (zaps.length === 0) {
      return
    }

    if (snapshot.windowStartAt === null || snapshot.windowEndAt === null) {
      return
    }

    const progress = clampProgress(seekProgress)
    const targetCreatedAt =
      snapshot.windowStartAt +
      Math.round((snapshot.windowEndAt - snapshot.windowStartAt) * progress)
    const seekIndex = findZapReplaySeekIndex(zaps, targetCreatedAt)
    if (seekIndex < 0) {
      return
    }

    const message = `Replay reposicionado al ${Math.round(progress * 100)}% de ${replayWindowText}.`
    playReplayFromIndex({
      zaps,
      startIndex: seekIndex,
      resetCounts: true,
      message,
    })
  }, [
    enabled,
    playReplayFromIndex,
    replayWindowText,
    seekKey,
    seekProgress,
    snapshot.windowEndAt,
    snapshot.windowStartAt,
  ])

  if (!enabled) {
    return INITIAL_SNAPSHOT
  }

  if (targetInfo.targets.length === 0) {
    return {
      ...INITIAL_SNAPSHOT,
      message: `Esperando nodos visibles para reproducir zaps de ${replayWindowText}.`,
    }
  }

  return snapshot
}
