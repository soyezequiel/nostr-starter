import { createAppStore } from '@/features/graph/app/store/createAppStore'
import { createNostrGraphDatabase, createRepositories } from '@/features/graph/db'
import { createInlineEventsWorkerGateway, createInlineGraphWorkerGateway } from '@/features/graph/workers/gateway'
import { createAppKernel, type AppKernel, type AppKernelDependencies } from '@/features/graph/kernel/runtime'
import {
  createTranscriptRelayAdapterFactory,
  type RelayTranscript,
} from '@/features/graph/kernel/transcript-relay'

export interface HeadlessKernelOptions {
  transcripts: RelayTranscript[]
  clock?: number
  maxNodes?: number
  dbName?: string
}

export function createHeadlessKernel(options: HeadlessKernelOptions): AppKernel {
  const clock = options.clock ?? 1_710_000_000_000
  const dbName = options.dbName ?? `nostr-headless-${crypto.randomUUID()}`

  const store = createAppStore()
  const database = createNostrGraphDatabase(dbName)
  const repositories = createRepositories(database)

  if (options.maxNodes !== undefined) {
    store.getState().graphCaps.maxNodes = options.maxNodes
  }

  const relayUrls = options.transcripts.map((t) => t.relayUrl)

  const dependencies: AppKernelDependencies = {
    store,
    repositories,
    eventsWorker: createInlineEventsWorkerGateway(),
    graphWorker: createInlineGraphWorkerGateway(),
    createRelayAdapter: createTranscriptRelayAdapterFactory({
      transcripts: options.transcripts,
      clock,
    }) as never,
    defaultRelayUrls: relayUrls,
    now: () => clock,
  }

  return createAppKernel(dependencies)
}
