import type {
  AppStoreApi,
  ConnectionsSourceLayer,
  UiLayer,
} from '@/features/graph/app/store/types'
import {
  browserAppKernel,
  browserAppStore,
  type LoadRootOptions,
  type ReconfigureRelaysResult,
  type RootLoader,
} from '@/features/graph/kernel/runtime'
import { GraphDomainStore } from '@/features/graph-v2/application/GraphDomainStore'
import { LegacyStoreSnapshotAdapter } from '@/features/graph-v2/bridge/LegacyStoreSnapshotAdapter'
import type { GraphV2Layer } from '@/features/graph-v2/domain/invariants'

interface LegacyKernelBridgeOptions {
  runtime?: RootLoader
  store?: AppStoreApi
  domainStore?: GraphDomainStore
}

export class LegacyKernelBridge {
  public readonly domainStore: GraphDomainStore

  private readonly runtime: RootLoader

  private readonly store: AppStoreApi

  private readonly snapshotAdapter = new LegacyStoreSnapshotAdapter()

  private unsubscribe: (() => void) | null = null

  public constructor({
    runtime,
    store,
    domainStore,
  }: LegacyKernelBridgeOptions = {}) {
    if ((runtime && !store) || (!runtime && store)) {
      throw new Error(
        'LegacyKernelBridge requires runtime and store to be provided together.',
      )
    }

    this.runtime = runtime ?? browserAppKernel
    this.store = store ?? browserAppStore
    this.domainStore =
      domainStore ??
      new GraphDomainStore(this.snapshotAdapter.adapt(this.store.getState()))
    this.connect()
  }

  public getState = () => this.domainStore.getState()

  public subscribe = (listener: () => void) => this.domainStore.subscribe(listener)

  public connect() {
    if (this.unsubscribe !== null) {
      return
    }

    this.domainStore.replaceState(this.snapshotAdapter.adapt(this.store.getState()))
    this.unsubscribe = this.store.subscribe((state) => {
      this.domainStore.replaceState(this.snapshotAdapter.adapt(state))
    })
  }

  public dispose() {
    this.unsubscribe?.()
    this.unsubscribe = null
  }

  public async loadRoot(pubkey: string, options?: LoadRootOptions) {
    return this.runtime.loadRoot(pubkey, options)
  }

  public async expandNode(pubkey: string) {
    return this.runtime.expandNode(pubkey)
  }

  public async setRelays(relayUrls: string[]): Promise<ReconfigureRelaysResult> {
    return this.runtime.reconfigureRelays({ relayUrls })
  }

  public async revertRelays() {
    return this.runtime.revertRelayOverride()
  }

  public toggleLayer(layer: GraphV2Layer) {
    return this.runtime.toggleLayer(layer as UiLayer)
  }

  public setConnectionsSourceLayer(layer: ConnectionsSourceLayer) {
    this.store.getState().setConnectionsSourceLayer(layer)
  }

  public selectNode(pubkey: string | null) {
    return this.runtime.selectNode(pubkey)
  }

  public async getNodeDetail(pubkey: string) {
    return this.runtime.getNodeDetail(pubkey)
  }

  public togglePinnedNode(pubkey: string) {
    this.store.getState().togglePinnedNode(pubkey)
  }

  public clearPinnedNodes() {
    this.store.getState().clearPinnedNodes()
  }
}
