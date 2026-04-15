import type { KeywordMatch, UiLayer } from '@/features/graph/app/store'
import { appStore } from '@/features/graph/app/store/createAppStore'
import { createNostrGraphDatabase, createRepositories } from '@/features/graph/db'
import type { RelayHealthSnapshot } from '@/features/graph/nostr'
import { createRelayPoolAdapter } from '@/features/graph/nostr'
import type { KernelFacade } from '@/features/graph/kernel/facade'
import { createKernelFacade } from '@/features/graph/kernel/facade'
import type { AppKernelDependencies } from '@/features/graph/kernel/modules/context'
import { DEFAULT_SESSION_RELAY_URLS } from '@/features/graph/kernel/modules/constants'
import {
  createEventsWorkerGateway,
  createGraphWorkerGateway,
} from '@/features/graph/workers/browser'
import type { GraphWorkerActionMap } from '@/features/graph/workers/graph/contracts'
import type { WorkerActionName } from '@/features/graph/workers/shared/protocol'
import type { WorkerClient } from '@/features/graph/workers/shared/runtime'

export interface LoadRootResult {
  status: 'ready' | 'partial' | 'empty' | 'error'
  loadedFrom: 'cache' | 'live' | 'none'
  discoveredFollowCount: number
  message: string
  relayHealth: Record<string, RelayHealthSnapshot>
}

export interface ReconfigureRelaysInput {
  relayUrls?: string[]
  restoreDefault?: boolean
}

export interface ReconfigureRelaysResult {
  status: 'applied' | 'revertible' | 'invalid'
  relayUrls: string[]
  message: string
  diagnostics: string[]
  isGraphStale: boolean
  relayHealth: Record<string, RelayHealthSnapshot>
}

export interface ExpandNodeResult {
  status: 'ready' | 'partial' | 'empty' | 'error'
  discoveredFollowCount: number
  rejectedPubkeys: string[]
  message: string
}

export interface SearchKeywordResult {
  keyword: string
  tokens: string[]
  totalHits: number
  nodeHits: Record<string, number>
  matchesByPubkey: Record<string, KeywordMatch[]>
}

export interface FindPathResult {
  path: string[] | null
  visitedCount: number
  algorithm: 'bfs' | 'dijkstra'
}

export interface ToggleLayerResult {
  previousLayer: UiLayer
  activeLayer: UiLayer
  message: string | null
}

export interface SelectNodeResult {
  previousPubkey: string | null
  selectedPubkey: string | null
}

export interface NodeDetailProfile {
  eventId: string
  fetchedAt: number
  profileSource?: 'relay' | 'primal-cache' | null
  name: string | null
  about: string | null
  picture: string | null
  nip05: string | null
  lud16: string | null
}

export interface LoadRootOptions {
  preserveExistingGraph?: boolean
  useDefaultRelays?: boolean
  relayUrls?: string[]
  bootstrapRelayUrls?: string[]
}

export interface RootLoader {
  loadRoot: (
    rootPubkey: string,
    options?: LoadRootOptions,
  ) => Promise<LoadRootResult>
  reconfigureRelays: (
    input: ReconfigureRelaysInput,
  ) => Promise<ReconfigureRelaysResult>
  revertRelayOverride: () => Promise<ReconfigureRelaysResult | null>
  expandNode: (pubkey: string) => Promise<ExpandNodeResult>
  searchKeyword: (keyword: string) => Promise<SearchKeywordResult>
  toggleLayer: (layer: UiLayer) => ToggleLayerResult
  findPath: (
    sourcePubkey: string,
    targetPubkey: string,
    algorithm?: 'bfs' | 'dijkstra',
  ) => Promise<FindPathResult>
  selectNode: (pubkey: string | null) => SelectNodeResult
  getNodeDetail: (pubkey: string) => Promise<NodeDetailProfile | null>
}

export type { AppKernelDependencies }
export {
  KernelCommandError,
  type KernelCommandErrorCode,
} from '@/features/graph/kernel/modules/helpers'

const browserDatabase = createNostrGraphDatabase()
export const browserAppStore = appStore

class LazyGraphWorkerGateway implements WorkerClient<GraphWorkerActionMap> {
  private activeWorker: WorkerClient<GraphWorkerActionMap> | null = null

  private getWorker() {
    if (!this.activeWorker) {
      this.activeWorker = createGraphWorkerGateway()
    }

    return this.activeWorker
  }

  public invoke<TAction extends WorkerActionName<GraphWorkerActionMap>>(
    action: TAction,
    payload: GraphWorkerActionMap[TAction]['request'],
  ) {
    return this.getWorker().invoke(action, payload)
  }

  public dispose() {
    this.activeWorker?.dispose()
    this.activeWorker = null
  }
}

export const browserAppKernel: KernelFacade & RootLoader = createKernelFacade({
  store: browserAppStore,
  repositories: createRepositories(browserDatabase),
  eventsWorker: createEventsWorkerGateway(),
  graphWorker: new LazyGraphWorkerGateway(),
  createRelayAdapter: createRelayPoolAdapter,
  defaultRelayUrls: [...DEFAULT_SESSION_RELAY_URLS],
  now: () => Date.now(),
})
