import type { Event } from 'nostr-tools'

import { isVerifiedEventsAsync } from '@/features/graph-runtime/workers/verifyWorkerPool'

export const PRIMAL_CACHE_URL = 'wss://cache2.primal.net/v1'

const DEFAULT_PRIMAL_CACHE_TIMEOUT_MS = 5_000
const DEFAULT_PRIMAL_CACHE_BATCH_SIZE = 50

interface PrimalCacheClientOptions {
  url?: string
  timeoutMs?: number
  batchSize?: number
}

interface PrimalEventMessage {
  event: Event
  cacheUrl: string
  receivedAtMs: number
  mediaFallbacks: Record<string, string>
}

type PrimalWireMessage = ['EVENT', string, unknown] | ['EOSE', string] | unknown[]

function createSubscriptionId(): string {
  return `primal-cache-${Math.random().toString(36).slice(2)}`
}

function isEvent(value: unknown): value is Event {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const record = value as Record<string, unknown>
  return (
    typeof record.id === 'string' &&
    typeof record.pubkey === 'string' &&
    typeof record.created_at === 'number' &&
    typeof record.kind === 'number' &&
    Array.isArray(record.tags) &&
    typeof record.content === 'string' &&
    typeof record.sig === 'string'
  )
}

function parseWireMessage(data: string): PrimalWireMessage | null {
  try {
    const parsed = JSON.parse(data)
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

function chunkPubkeys(pubkeys: readonly string[], batchSize: number): string[][] {
  const uniquePubkeys = Array.from(new Set(pubkeys.filter(Boolean))).sort()
  const chunks: string[][] = []

  for (let index = 0; index < uniquePubkeys.length; index += batchSize) {
    chunks.push(uniquePubkeys.slice(index, index + batchSize))
  }

  return chunks
}

function readMediaFallbacks(value: unknown): Record<string, string> {
  const fallbacks: Record<string, string> = {}

  if (typeof value !== 'string' || value.trim().length === 0) {
    return fallbacks
  }

  try {
    const parsed = JSON.parse(value) as { resources?: unknown }

    if (!Array.isArray(parsed.resources)) {
      return fallbacks
    }

    for (const resource of parsed.resources) {
      if (typeof resource !== 'object' || resource === null) {
        continue
      }

      const { url, variants } = resource as {
        url?: unknown
        variants?: unknown
      }

      if (typeof url !== 'string' || !Array.isArray(variants)) {
        continue
      }

      const bestVariant = variants
        .filter(
          (
            variant,
          ): variant is {
            media_url: string
            w?: number
            h?: number
            s?: string
          } =>
            typeof variant === 'object' &&
            variant !== null &&
            typeof (variant as { media_url?: unknown }).media_url === 'string',
        )
        .sort((left, right) => {
          const leftArea = (left.w ?? 0) * (left.h ?? 0)
          const rightArea = (right.w ?? 0) * (right.h ?? 0)
          return rightArea - leftArea
        })[0]

      if (bestVariant) {
        fallbacks[url] = bestVariant.media_url
      }
    }
  } catch {
    return fallbacks
  }

  return fallbacks
}

export class PrimalCacheClient {
  private readonly url: string
  private readonly timeoutMs: number
  private readonly batchSize: number

  constructor(options: PrimalCacheClientOptions = {}) {
    this.url = options.url ?? PRIMAL_CACHE_URL
    this.timeoutMs = options.timeoutMs ?? DEFAULT_PRIMAL_CACHE_TIMEOUT_MS
    this.batchSize = options.batchSize ?? DEFAULT_PRIMAL_CACHE_BATCH_SIZE
  }

  async fetchUserInfoProfileEvents(
    pubkeys: readonly string[],
  ): Promise<PrimalEventMessage[]> {
    if (typeof WebSocket === 'undefined') {
      return []
    }

    const results = await Promise.all(
      chunkPubkeys(pubkeys, this.batchSize).map((batch) =>
        this.fetchUserInfoProfileEventBatch(batch),
      ),
    )

    return results.flat()
  }

  private async fetchUserInfoProfileEventBatch(
    pubkeys: readonly string[],
  ): Promise<PrimalEventMessage[]> {
    if (pubkeys.length === 0) {
      return []
    }

    const subId = createSubscriptionId()

    return new Promise<PrimalEventMessage[]>((resolve) => {
      const events: PrimalEventMessage[] = []
      const mediaFallbacks: Record<string, string> = {}
      const websocket = new WebSocket(this.url)
      let settled = false
      let closeWhenOpened = false
      const timeoutHandle = setTimeout(() => {
        finalize()
      }, this.timeoutMs)

      const finalize = () => {
        if (settled) {
          return
        }

        settled = true
        clearTimeout(timeoutHandle)
        closeWebSocketQuietly()
        resolve(events)
      }

      const closeWebSocketQuietly = () => {
        if (websocket.readyState === WebSocket.OPEN) {
          try {
            websocket.send(JSON.stringify(['CLOSE', subId]))
          } catch {}
          try {
            websocket.close()
          } catch {}
          return
        }

        if (websocket.readyState === WebSocket.CONNECTING) {
          closeWhenOpened = true
        }
      }

      websocket.onopen = () => {
        if (closeWhenOpened || settled) {
          try {
            websocket.close()
          } catch {}
          return
        }

        websocket.send(
          JSON.stringify([
            'REQ',
            subId,
            { cache: ['user_infos', { pubkeys: [...pubkeys] }] },
          ]),
        )
      }

      websocket.onerror = finalize
      websocket.onclose = finalize

      websocket.onmessage = (message) => {
        const wireMessage = parseWireMessage(String(message.data))

        if (!wireMessage || wireMessage[1] !== subId) {
          return
        }

        if (wireMessage[0] === 'EOSE') {
          finalize()
          return
        }

        if (wireMessage[0] !== 'EVENT') {
          return
        }

        if (
          typeof wireMessage[2] === 'object' &&
          wireMessage[2] !== null &&
          (wireMessage[2] as { kind?: unknown }).kind === 10000119
        ) {
          Object.assign(
            mediaFallbacks,
            readMediaFallbacks(
              (wireMessage[2] as { content?: unknown }).content,
            ),
          )
          return
        }

        if (!isEvent(wireMessage[2])) {
          return
        }

        const event = wireMessage[2]
        if (event.kind !== 0 || !pubkeys.includes(event.pubkey)) {
          return
        }

        events.push({
          event,
          cacheUrl: this.url,
          receivedAtMs: Date.now(),
          mediaFallbacks,
        })
      }
    }).then(async (events) => {
      const verificationResults = await isVerifiedEventsAsync(
        events.map((eventMessage) => eventMessage.event),
      )
      const verifiedEvents: PrimalEventMessage[] = []

      events.forEach((eventMessage, index) => {
        if (verificationResults[index] === true) {
          verifiedEvents.push(eventMessage)
        }
      })

      return verifiedEvents
    })
  }
}
