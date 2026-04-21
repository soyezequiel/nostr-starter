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
const MAX_ZAP_FILTER_PUBKEYS = 256
const SEEN_CACHE_LIMIT = 200

export function useLiveZapFeed({
  visiblePubkeys,
  enabled,
  onZap,
  onDropped,
}: {
  visiblePubkeys: readonly string[]
  enabled: boolean
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
  // Dense graph layers can expose thousands of pubkeys; subscribing all of them
  // creates huge relay filters and makes layer switching pay network cleanup
  // costs. Skip live-zap animation once the scene is too broad.
  const signature = useMemo(() => {
    if (!enabled || visiblePubkeys.length > MAX_ZAP_FILTER_PUBKEYS) {
      return ''
    }

    return [...visiblePubkeys]
      .map((pubkey) => pubkey.toLowerCase())
      .sort()
      .join(',')
  }, [enabled, visiblePubkeys])

  useEffect(() => {
    if (!enabled) {
      traceZapFlow('liveFeed.disabled', {
        visiblePubkeyCount: visiblePubkeys.length,
      })
      console.log(`[ZAP FEED] Suscripción evitada (enabled=false). Puede que estés en la tab Zaps o superaste el límite max de red.`)
      return
    }
    
    const pubkeys = signature ? signature.split(',') : []
    if (pubkeys.length === 0) {
      const reason =
        visiblePubkeys.length > MAX_ZAP_FILTER_PUBKEYS
          ? 'visible-pubkey-limit'
          : 'empty-visible-pubkeys'
      traceZapFlow('liveFeed.skippedSubscription', {
        reason,
        visiblePubkeyCount: visiblePubkeys.length,
        maxZapFilterPubkeys: MAX_ZAP_FILTER_PUBKEYS,
      })
      onDroppedRef.current?.(
        reason === 'visible-pubkey-limit'
          ? `Zaps live pausados: ${visiblePubkeys.length} nodos visibles supera el limite ${MAX_ZAP_FILTER_PUBKEYS}.`
          : 'Zaps live pausados: no hay nodos visibles para filtrar.',
      )
      console.log(`[ZAP FEED] Suscripción apagada temporalmente. Nodos en la signature: 0. (Límite: ${MAX_ZAP_FILTER_PUBKEYS})`)
      return
    }
    let disposed = false
    let subscription: NDKSubscription | null = null
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
        console.warn('[ZAP FEED] Failed to connect NDK')
        return
      }
      if (disposed) return
      
      const pubkeys = signature ? signature.split(',') : []
      if (pubkeys.length === 0) {
        traceZapFlow('liveFeed.skippedAfterConnect', {
          enabled,
          visiblePubkeyCount: visiblePubkeys.length,
        })
        console.log(`[ZAP FEED] Suscripción apagada temporalmente. Enabled: ${enabled}. Nodos en Signature: 0`)
        return
      }
      
      traceZapFlow('liveFeed.subscribed', {
        filterKind: 9735,
        targetPubkeyCount: pubkeys.length,
        targetPubkeySample: pubkeys.slice(0, 12),
      })
      console.log(`[ZAP FEED] Suscribiendo a Zaps para ${pubkeys.length} nodos.`)

      subscription = ndk.subscribe(
        { kinds: [9735], '#p': pubkeys },
        { closeOnEose: false },
      )
      subscription.on('event', (event: NDKEvent) => {
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
        console.log('[LIVE ZAP - EVENTO RECIBIDO INDIVIDUO]', event)

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
          console.log('[LIVE ZAP - DESCARTADO] No se pudo parsear (puede ser anónimo o formato erróneo):', event)
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
          console.log('[LIVE ZAP - DESCARTADO] Zapeo viejo/stale:', { ageMs, parsed })
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
        console.log('[LIVE ZAP - ENVIANDO A LA UI]', parsed)
        onZapRef.current(parsed)
      })
    })()

    return () => {
      disposed = true
      subscription?.stop()
      subscription = null
    }
  }, [enabled, signature, visiblePubkeys])
}
