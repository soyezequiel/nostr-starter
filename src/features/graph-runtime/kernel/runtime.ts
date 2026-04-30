import type {
  GraphNodeSource,
  ProfileDataSource,
  UiLayer,
} from '@/features/graph-runtime/app/store'
import { appStore } from '@/features/graph-runtime/app/store/createAppStore'
import { createNostrGraphDatabase, createRepositories } from '@/features/graph-runtime/db'
import type { RelayHealthSnapshot } from '@/features/graph-runtime/nostr'
import { createRelayPoolAdapter } from '@/features/graph-runtime/nostr'
import type { KernelFacade } from '@/features/graph-runtime/kernel/facade'
import { createKernelFacade } from '@/features/graph-runtime/kernel/facade'
import type { AppKernelDependencies } from '@/features/graph-runtime/kernel/modules/context'
import { DEFAULT_SESSION_RELAY_URLS } from '@/features/graph-runtime/kernel/modules/constants'
import {
  createEventsWorkerGateway,
  createGraphWorkerGateway,
} from '@/features/graph-runtime/workers/browser'
import type { EventsWorkerActionMap } from '@/features/graph-runtime/workers/events/contracts'
import type { GraphWorkerActionMap } from '@/features/graph-runtime/workers/graph/contracts'
import type { WorkerActionName } from '@/features/graph-runtime/workers/shared/protocol'
import type { WorkerClient } from '@/features/graph-runtime/workers/shared/runtime'

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

export interface AddDetachedNodeInput {
  pubkey: string
  label?: string | null
  picture?: string | null
  about?: string | null
  nip05?: string | null
  lud16?: string | null
  profileEventId?: string | null
  profileFetchedAt?: number | null
  profileSource?: ProfileDataSource | null
  profileState?: 'idle' | 'loading' | 'ready' | 'missing'
  discoveredAt?: number | null
  source?: GraphNodeSource
  pin?: boolean
  select?: boolean
  markExpanded?: boolean
}

export interface AddDetachedNodeResult {
  status: 'inserted' | 'existing'
  selectedPubkey: string | null
  message: string
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
  expandNode: (pubkey: string, options?: { force?: boolean }) => Promise<ExpandNodeResult>
  toggleLayer: (layer: UiLayer) => ToggleLayerResult
  findPath: (
    sourcePubkey: string,
    targetPubkey: string,
    algorithm?: 'bfs' | 'dijkstra',
  ) => Promise<FindPathResult>
  addDetachedNode: (input: AddDetachedNodeInput) => AddDetachedNodeResult
  selectNode: (pubkey: string | null) => SelectNodeResult
  getNodeDetail: (pubkey: string) => Promise<NodeDetailProfile | null>
  prefetchNodeProfiles: (pubkeys: string[]) => Promise<string[]>
}

export type { AppKernelDependencies }
export {
  KernelCommandError,
  type KernelCommandErrorCode,
} from '@/features/graph-runtime/kernel/modules/helpers'

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

class LazyEventsWorkerGateway implements WorkerClient<EventsWorkerActionMap> {
  private activeWorker: WorkerClient<EventsWorkerActionMap> | null = null

  private getWorker() {
    if (!this.activeWorker) {
      this.activeWorker = createEventsWorkerGateway()
    }

    return this.activeWorker
  }

  public invoke<TAction extends WorkerActionName<EventsWorkerActionMap>>(
    action: TAction,
    payload: EventsWorkerActionMap[TAction]['request'],
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
  eventsWorker: new LazyEventsWorkerGateway(),
  graphWorker: new LazyGraphWorkerGateway(),
  createRelayAdapter: createRelayPoolAdapter,
  defaultRelayUrls: [...DEFAULT_SESSION_RELAY_URLS],
  now: () => Date.now(),
})
