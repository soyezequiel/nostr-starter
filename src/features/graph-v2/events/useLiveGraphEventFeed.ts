'use client'

import { useEffect, useMemo, useRef } from 'react'
import type { NDKEvent, NDKSubscription } from '@nostr-dev-kit/ndk'
import type NDK from '@nostr-dev-kit/ndk'

import { connectNDK } from '@/lib/nostr'
import { MAX_ZAP_FILTER_PUBKEYS } from '@/features/graph-v2/zaps/useLiveZapFeed'
import {
  KIND_PARSER_SPECS,
  type KindParserSpec,
} from '@/features/graph-v2/events/parsers'
import type {
  GraphEventKind,
  ParsedGraphEvent,
} from '@/features/graph-v2/events/types'

const MAX_EVENT_AGE_MS = 60_000
const SEEN_CACHE_LIMIT = 200
const INITIAL_SAVE_LIST_ANIMATION_LIMIT = 1

interface UseLiveGraphEventFeedOptions {
  kind: Exclude<GraphEventKind, 'zap'>
  visiblePubkeys: readonly string[]
  enabled: boolean
  enforceVisiblePubkeyLimit: boolean
  onEvent: (event: ParsedGraphEvent) => void
}

const buildBatches = (
  pubkeys: readonly string[],
  batchSize = MAX_ZAP_FILTER_PUBKEYS,
): string[][] => {
  const batches: string[][] = []
  for (let index = 0; index < pubkeys.length; index += batchSize) {
    batches.push(pubkeys.slice(index, index + batchSize) as string[])
  }
  return batches
}

const buildFilters = (
  spec: KindParserSpec,
  batch: string[],
  sinceSeconds: number,
) => {
  if (spec.filterMode === 'authors') {
    return [{ kinds: spec.kinds, authors: [...batch], since: sinceSeconds }]
  }
  return [
    { kinds: spec.kinds, '#p': [...batch], since: sinceSeconds },
  ]
}

const getSaveEntryKey = (event: ParsedGraphEvent): string | null => {
  if (event.payload.kind !== 'save') return null
  return (
    event.payload.data.entryEventId ??
    event.payload.data.entryAddress ??
    event.payload.data.entryAuthorPubkey ??
    null
  )
}

export function useLiveGraphEventFeed({
  kind,
  visiblePubkeys,
  enabled,
  enforceVisiblePubkeyLimit,
  onEvent,
}: UseLiveGraphEventFeedOptions): void {
  const onEventRef = useRef(onEvent)
  useEffect(() => {
    onEventRef.current = onEvent
  }, [onEvent])

  const visiblePubkeyCount = visiblePubkeys.length
  const signature = useMemo(() => {
    if (
      !enabled ||
      (enforceVisiblePubkeyLimit &&
        visiblePubkeys.length > MAX_ZAP_FILTER_PUBKEYS)
    ) {
      return ''
    }
    return [...visiblePubkeys]
      .map((pubkey) => pubkey.toLowerCase())
      .sort()
      .join(',')
  }, [enabled, enforceVisiblePubkeyLimit, visiblePubkeys])

  useEffect(() => {
    if (!enabled || !signature) return

    const spec = KIND_PARSER_SPECS[kind]
    const pubkeys = signature.split(',').filter(Boolean)
    const batches = buildBatches(pubkeys)
    if (batches.length === 0) return

    let disposed = false
    let subscriptions: NDKSubscription[] = []
    const seen = new Set<string>()
    const seenOrder: string[] = []
    const saveListKeysByAuthor = new Map<string, Set<string>>()
    const startedAtMs = Date.now()
    const sinceSeconds = Math.floor(Date.now() / 1_000) - 60

    const remember = (eventId: string): boolean => {
      if (seen.has(eventId)) return false
      seen.add(eventId)
      seenOrder.push(eventId)
      while (seenOrder.length > SEEN_CACHE_LIMIT) {
        const evicted = seenOrder.shift()
        if (evicted) seen.delete(evicted)
      }
      return true
    }

    void (async () => {
      let ndk: NDK
      try {
        ndk = await connectNDK()
      } catch {
        return
      }
      if (disposed) return

      const handleEvent = (raw: NDKEvent) => {
        if (disposed) return
        if (!remember(raw.id)) return
        const rawEvent = {
          id: raw.id,
          pubkey: raw.pubkey,
          kind: raw.kind ?? 0,
          created_at: raw.created_at ?? 0,
          content: raw.content ?? '',
          tags: raw.tags ?? [],
        }
        const parsed = spec.parse(rawEvent)
        const selected =
          kind === 'save'
            ? selectLiveSaveEvents({
                authorPubkey: rawEvent.pubkey,
                parsed,
                saveListKeysByAuthor,
              })
            : parsed
        const nowMs = Date.now()
        for (const event of selected) {
          // Drop stale backfill: events older than the freshness window are
          // only allowed when their createdAt is after we started.
          const ageMs = nowMs - event.createdAt * 1_000
          if (ageMs > MAX_EVENT_AGE_MS && event.createdAt * 1_000 < startedAtMs) {
            continue
          }
          onEventRef.current(event)
        }
      }

      subscriptions = batches.map((batch) => {
        const subscription = ndk.subscribe(
          buildFilters(spec, batch, sinceSeconds),
          { closeOnEose: false },
        )
        subscription.on('event', handleEvent)
        return subscription
      })
    })()

    return () => {
      disposed = true
      for (const subscription of subscriptions) {
        subscription.stop()
      }
      subscriptions = []
    }
  }, [enabled, kind, signature, visiblePubkeyCount, enforceVisiblePubkeyLimit])
}

function selectLiveSaveEvents({
  authorPubkey,
  parsed,
  saveListKeysByAuthor,
}: {
  authorPubkey: string
  parsed: readonly ParsedGraphEvent[]
  saveListKeysByAuthor: Map<string, Set<string>>
}): ParsedGraphEvent[] {
  const normalizedAuthor = authorPubkey.toLowerCase()
  const nextKeys = new Set<string>()
  for (const event of parsed) {
    const key = getSaveEntryKey(event)
    if (key) nextKeys.add(key)
  }

  const previousKeys = saveListKeysByAuthor.get(normalizedAuthor)
  saveListKeysByAuthor.set(normalizedAuthor, nextKeys)

  if (!previousKeys) {
    return parsed.slice(0, INITIAL_SAVE_LIST_ANIMATION_LIMIT)
  }

  return parsed.filter((event) => {
    const key = getSaveEntryKey(event)
    return key !== null && !previousKeys.has(key)
  })
}
