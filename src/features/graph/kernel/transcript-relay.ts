import type { Event, Filter } from 'nostr-tools'

import type {
  RelayAdapterOptions,
  RelayEventObservable,
  RelayHealthSnapshot,
  RelayObserver,
} from '@/features/graph/nostr'

export interface TranscriptEntry {
  filter: { authors?: string[]; kinds?: number[]; '#p'?: string[] }
  events: Event[]
  error?: string
}

export interface RelayTranscript {
  relayUrl: string
  entries: TranscriptEntry[]
}

export interface TranscriptRelayAdapterOptions {
  transcripts: RelayTranscript[]
  clock: number
}

function filterMatches(
  filter: TranscriptEntry['filter'],
  requestFilter: Filter,
): boolean {
  if (filter.kinds && requestFilter.kinds) {
    if (!filter.kinds.some((k) => requestFilter.kinds!.includes(k))) {
      return false
    }
  }
  if (filter.authors && requestFilter.authors) {
    if (!filter.authors.some((a) => requestFilter.authors!.includes(a))) {
      return false
    }
  }
  const requestPTags = (requestFilter as Filter & { '#p'?: string[] })['#p']
  if (Boolean(filter['#p']) !== Boolean(requestPTags)) {
    return false
  }
  if (filter['#p'] && requestPTags) {
    if (!filter['#p'].some((pubkey) => requestPTags.includes(pubkey))) {
      return false
    }
  }
  return true
}

export function createTranscriptRelayAdapter(options: TranscriptRelayAdapterOptions) {
  const { transcripts, clock } = options
  const allRelayUrls = transcripts.map((t) => t.relayUrl)

  const relayHealth: Record<string, RelayHealthSnapshot> = Object.fromEntries(
    allRelayUrls.map((url) => [
      url,
      {
        url,
        status: 'healthy' as const,
        attempt: 1,
        activeSubscriptions: 0,
        consecutiveFailures: 0,
        lastChangeMs: clock,
      } satisfies RelayHealthSnapshot,
    ]),
  )

  return {
    subscribe(filters: Filter[]): RelayEventObservable {
      return {
        subscribe(observer: RelayObserver): () => void {
          queueMicrotask(() => {
            for (const transcript of transcripts) {
              for (const entry of transcript.entries) {
                const matches = filters.some((f) => filterMatches(entry.filter, f))
                if (!matches) continue

                if (entry.error) {
                  observer.error?.(new Error(entry.error))
                  return
                }

                for (const event of entry.events) {
                  observer.next?.({
                    event,
                    relayUrl: transcript.relayUrl,
                    receivedAtMs: clock + 100,
                    attempt: 1,
                  })
                }
              }
            }

            observer.complete?.({
              filters,
              startedAtMs: clock,
              finishedAtMs: clock + 200,
              relayHealth,
              stats: {
                acceptedEvents: filters.length,
                duplicateRelayEvents: 0,
                rejectedEvents: 0,
              },
            })
          })

          return () => {}
        },
      }
    },

    getRelayHealth(): Record<string, RelayHealthSnapshot> {
      return { ...relayHealth }
    },

    subscribeToRelayHealth(
      listener: (snapshot: Record<string, RelayHealthSnapshot>) => void,
    ): () => void {
      listener(relayHealth)
      return () => {}
    },

    close(): void {},
  }
}

export function createTranscriptRelayAdapterFactory(options: TranscriptRelayAdapterOptions) {
  return (adapterOptions: RelayAdapterOptions) => {
    void adapterOptions
    return createTranscriptRelayAdapter(options)
  }
}
