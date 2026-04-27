'use client'

import { useEffect, useMemo, useRef } from 'react'
import type { NDKEvent, NDKSubscription } from '@nostr-dev-kit/ndk'
import type NDK from '@nostr-dev-kit/ndk'

import { connectNDK } from '@/lib/nostr'
import type { ParsedZap } from '@/features/graph-v2/zaps/zapParser'
import { parseZapReceiptEvent } from '@/features/graph-v2/zaps/zapParser'
import {
  shouldTraceZapPair,
  traceZapFlow,
} from '@/features/graph-runtime/debug/zapTrace'

const MAX_RECEIPT_AGE_MS = 60_000
export const MAX_ZAP_FILTER_PUBKEYS = 256
const SEEN_CACHE_LIMIT = 200

export function buildLiveZapTargetBatches(
  signature: string,
  batchSize = MAX_ZAP_FILTER_PUBKEYS,
): string[][] {
  const pubkeys = signature ? signature.split(',').filter(Boolean) : []
  const batches: string[][] = []
  for (let index = 0; index < pubkeys.length; index += batchSize) {
    batches.push(pubkeys.slice(index, index + batchSize))
  }
  return batches
}

export function useLiveZapFeed({
  visiblePubkeys,
  enabled,
  enforceVisiblePubkeyLimit,
  onZap,
  onDropped,
}: {
  visiblePubkeys: readonly string[]
  enabled: boolean
  enforceVisiblePubkeyLimit: boolean
  onZap: (zap: ParsedZap) => void
  onDropped?: (message: string) => void
}): void {
  const onZapRef = useRef(onZap)
  useEffect(() => {
    onZapRef.current = onZap
  }, [onZap])
  const onDroppedRef = useRef(onDropped)
  useEffect(() => {
    onDroppedRef.current = onDropped
  }, [onDropped])

  // Stable signature of visible pubkeys so effect only re-fires on real change.
  // Dense graph layers can expose thousands of pubkeys; when the guardrail is
  // enabled, skip live-zap animation once the scene is too broad.
  const visiblePubkeyCount = visiblePubkeys.length
  const signature = useMemo(() => {
    if (
      !enabled ||
      (enforceVisiblePubkeyLimit && visiblePubkeys.length > MAX_ZAP_FILTER_PUBKEYS)
    ) {
      return ''
    }

    return [...visiblePubkeys]
      .map((pubkey) => pubkey.toLowerCase())
      .sort()
      .join(',')
  }, [enabled, enforceVisiblePubkeyLimit, visiblePubkeys])

  useEffect(() => {
    if (!enabled) {
      traceZapFlow('liveFeed.disabled', {
        visiblePubkeyCount,
      })
      return
    }
    
    const targetBatches = buildLiveZapTargetBatches(signature)
    const targetCount = targetBatches.reduce((count, batch) => count + batch.length, 0)
    if (targetCount === 0) {
      const reason =
        enforceVisiblePubkeyLimit && visiblePubkeyCount > MAX_ZAP_FILTER_PUBKEYS
          ? 'visible-pubkey-limit'
          : 'empty-visible-pubkeys'
      traceZapFlow('liveFeed.skippedSubscription', {
        reason,
        visiblePubkeyCount,
        maxZapFilterPubkeys: MAX_ZAP_FILTER_PUBKEYS,
      })
      if (reason === 'visible-pubkey-limit') {
        onDroppedRef.current?.(
          `Zaps live pausados: ${visiblePubkeyCount} nodos visibles supera el limite ${MAX_ZAP_FILTER_PUBKEYS}.`,
        )
      }
      return
    }
    let disposed = false
    let subscriptions: NDKSubscription[] = []
    const seen = new Set<string>()
    const seenOrder: string[] = []
    const startedAtMs = Date.now()

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
        traceZapFlow('liveFeed.connectFailed')
        return
      }
      if (disposed) return
      
      const targetBatches = buildLiveZapTargetBatches(signature)
      const targetCount = targetBatches.reduce((count, batch) => count + batch.length, 0)
      if (targetCount === 0) {
        traceZapFlow('liveFeed.skippedAfterConnect', {
          enabled,
          visiblePubkeyCount,
        })
        return
      }
      
      traceZapFlow('liveFeed.subscribed', {
        filterKind: 9735,
        targetPubkeyCount: targetCount,
        subscriptionCount: targetBatches.length,
        targetPubkeySample: targetBatches.flat().slice(0, 12),
      })
      const handleEvent = (event: NDKEvent) => {
        if (disposed) return
        if (!remember(event.id)) return

        const targetPubkey = event.tags.find((tag) => tag[0] === 'p')?.[1]?.toLowerCase() ?? null
        if (shouldTraceZapPair({ toPubkey: targetPubkey })) {
          traceZapFlow('liveFeed.eventReceived', {
            eventId: event.id,
            eventPubkey: event.pubkey,
            targetPubkey,
            createdAt: event.created_at ?? null,
            hasDescription: event.tags.some((tag) => tag[0] === 'description'),
            hasAmount: event.tags.some((tag) => tag[0] === 'amount'),
            hasBolt11: event.tags.some((tag) => tag[0] === 'bolt11'),
          })
        }
        const parsed = parseZapReceiptEvent({
          id: event.id,
          kind: event.kind ?? 0,
          tags: event.tags,
          created_at: event.created_at ?? 0,
        })
        
        if (!parsed) {
          if (shouldTraceZapPair({ toPubkey: targetPubkey })) {
            traceZapFlow('liveFeed.droppedBeforeParse', {
              reason: 'parse-failed',
              eventId: event.id,
              targetPubkey,
              kind: event.kind ?? null,
              tagNames: event.tags.map((tag) => tag[0]),
            })
          }
          return
        }

        const ageMs = Date.now() - parsed.createdAt * 1_000
        // Drop stale backfill but always let through zaps issued since we
        // started subscribing — those are genuinely live.
        if (ageMs > MAX_RECEIPT_AGE_MS && parsed.createdAt * 1_000 < startedAtMs) {
          if (shouldTraceZapPair(parsed)) {
            traceZapFlow('liveFeed.droppedAfterParse', {
              reason: 'stale-backfill',
              eventId: parsed.eventId,
              fromPubkey: parsed.fromPubkey,
              toPubkey: parsed.toPubkey,
              ageMs,
              maxReceiptAgeMs: MAX_RECEIPT_AGE_MS,
              startedAtMs,
              createdAtMs: parsed.createdAt * 1_000,
            })
          }
          return
        }

        if (shouldTraceZapPair(parsed)) {
          traceZapFlow('liveFeed.forwardedToUi', {
            eventId: parsed.eventId,
            fromPubkey: parsed.fromPubkey,
            toPubkey: parsed.toPubkey,
            sats: parsed.sats,
            ageMs,
          })
        }
        onZapRef.current(parsed)
      }

      subscriptions = targetBatches.map((batch) => {
        const subscription = ndk.subscribe(
          [
            {
              kinds: [9735],
              '#p': [...batch],
              since: Math.floor(Date.now() / 1_000) - 60,
            },
            {
              kinds: [9735],
              '#P': [...batch],
              since: Math.floor(Date.now() / 1_000) - 60,
            }
          ],
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
  }, [enabled, enforceVisiblePubkeyLimit, signature, visiblePubkeyCount])
}
