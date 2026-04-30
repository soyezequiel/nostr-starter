import type {
  AppStore,
  AppStoreApi,
  ConnectionsSourceLayer,
  UiLayer,
} from '@/features/graph-runtime/app/store/types'
import {
  browserAppKernel,
  browserAppStore,
  type AddActivityExternalNodeInput,
  type AddDetachedNodeInput,
  type LoadRootOptions,
  type ReconfigureRelaysResult,
  type RootLoader,
} from '@/features/graph-runtime/kernel/runtime'
import { GraphDomainStore } from '@/features/graph-v2/application/GraphDomainStore'
import { LegacyStoreSnapshotAdapter } from '@/features/graph-v2/bridge/LegacyStoreSnapshotAdapter'
import type {
  CanonicalGraphSceneState,
  CanonicalGraphState,
  CanonicalGraphUiState,
} from '@/features/graph-v2/domain/types'
import type { GraphV2Layer } from '@/features/graph-v2/domain/invariants'

interface StoreWithSelector<TState> {
  subscribe(listener: (state: TState, previousState: TState) => void): () => void
  subscribe<TSlice>(
    selector: (state: TState) => TSlice,
    listener: (slice: TSlice, previousSlice: TSlice) => void,
    options?: {
      equalityFn?: (left: TSlice, right: TSlice) => boolean
      fireImmediately?: boolean
    },
  ): () => void
}

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

  private unsubscribeScene: (() => void) | null = null

  private unsubscribeUi: (() => void) | null = null

  private readonly sceneListeners = new Set<() => void>()

  private readonly uiListeners = new Set<() => void>()

  private readonly compatibilityListeners = new Set<() => void>()

  private pendingSceneEmitFrame: number | null = null

  private pendingUiEmitFrame: number | null = null

  private pendingCompatibilityEmitFrame: number | null = null

  private pendingSceneEmitTimer: ReturnType<typeof setTimeout> | null = null

  private pendingUiEmitTimer: ReturnType<typeof setTimeout> | null = null

  private pendingCompatibilityEmitTimer: ReturnType<typeof setTimeout> | null =
    null

  // Active touch/pointer gestures (canvas pan, pinch, node drag) coalesce
  // store-driven re-renders into a single flush at gesture end. Without this,
  // every Nostr event arriving mid-drag triggers a full GraphAppV2 re-render
  // (~28ms on mobile), starving Sigma's render/touch loop and causing the
  // canvas to jump between frames.
  private gestureDepth = 0

  private gestureSceneEmitDeferred = false

  private gestureUiEmitDeferred = false

  private gestureCompatibilityEmitDeferred = false

  private uiState: CanonicalGraphUiState

  private combinedState: CanonicalGraphState

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

    const initialStoreState = this.store.getState()
    const initialSceneState = this.snapshotAdapter.adaptScene(initialStoreState)
    this.uiState = this.snapshotAdapter.adaptUi(initialStoreState)
    this.combinedState = this.snapshotAdapter.adaptCombined(
      initialSceneState,
      this.uiState,
    )
    this.domainStore = domainStore ?? new GraphDomainStore(initialSceneState)
    this.connect()
  }

  public getState = () => this.combinedState

  public getSceneState = () => this.domainStore.getState()

  public getUiState = () => this.uiState

  public subscribe = (listener: () => void) => {
    this.compatibilityListeners.add(listener)
    return () => {
      this.compatibilityListeners.delete(listener)
    }
  }

  public subscribeScene = (listener: () => void) => {
    this.sceneListeners.add(listener)
    return () => {
      this.sceneListeners.delete(listener)
    }
  }

  public subscribeUi = (listener: () => void) => {
    this.uiListeners.add(listener)
    return () => {
      this.uiListeners.delete(listener)
    }
  }

  public beginGesture = () => {
    this.gestureDepth += 1
  }

  public endGesture = () => {
    if (this.gestureDepth === 0) return
    this.gestureDepth -= 1
    if (this.gestureDepth > 0) return

    const flushScene = this.gestureSceneEmitDeferred
    const flushUi = this.gestureUiEmitDeferred
    const flushCompatibility = this.gestureCompatibilityEmitDeferred
    this.gestureSceneEmitDeferred = false
    this.gestureUiEmitDeferred = false
    this.gestureCompatibilityEmitDeferred = false

    if (flushScene) this.scheduleSceneEmit()
    if (flushUi) this.scheduleUiEmit()
    if (flushCompatibility) this.scheduleCompatibilityEmit()
  }

  public connect() {
    if (this.unsubscribeScene !== null || this.unsubscribeUi !== null) {
      return
    }

    const initialStoreState = this.store.getState()
    this.replaceSceneState(this.snapshotAdapter.adaptScene(initialStoreState))
    this.replaceUiState(this.snapshotAdapter.adaptUi(initialStoreState))

    const selectorStore = this.store as AppStoreApi & StoreWithSelector<AppStore>
    this.unsubscribeScene = selectorStore.subscribe(
      (state) => this.snapshotAdapter.adaptScene(state),
      (sceneState) => {
        this.replaceSceneState(sceneState)
      },
    )
    this.unsubscribeUi = selectorStore.subscribe(
      (state) => this.snapshotAdapter.adaptUi(state),
      (uiState) => {
        this.replaceUiState(uiState)
      },
    )
  }

  public dispose() {
    this.unsubscribeScene?.()
    this.unsubscribeUi?.()
    this.unsubscribeScene = null
    this.unsubscribeUi = null
    this.gestureDepth = 0
    this.gestureSceneEmitDeferred = false
    this.gestureUiEmitDeferred = false
    this.gestureCompatibilityEmitDeferred = false
    this.cancelScheduledEmits()
  }

  public async loadRoot(pubkey: string, options?: LoadRootOptions) {
    return this.runtime.loadRoot(pubkey, options)
  }

  public async expandNode(pubkey: string, options?: { force?: boolean }) {
    return this.runtime.expandNode(pubkey, options)
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

  public addDetachedNode(input: AddDetachedNodeInput) {
    return this.runtime.addDetachedNode(input)
  }

  public async addActivityExternalNode(input: AddActivityExternalNodeInput) {
    return this.runtime.addActivityExternalNode(input)
  }

  public async getNodeDetail(pubkey: string) {
    return this.runtime.getNodeDetail(pubkey)
  }

  public async prefetchNodeProfiles(pubkeys: string[]) {
    return this.runtime.prefetchNodeProfiles(pubkeys)
  }

  public togglePinnedNode(pubkey: string) {
    const state = this.store.getState()

    if (pubkey === state.rootNodePubkey) {
      state.setFixedRootPubkey(
        state.fixedRootPubkey === pubkey ? null : pubkey,
      )
      return
    }

    state.togglePinnedNode(pubkey)
  }

  public pinNode(pubkey: string) {
    this.store.getState().pinNode(pubkey)
  }

  public clearPinnedNodes() {
    this.store.getState().clearPinnedNodes()
  }

  private replaceSceneState(nextSceneState: CanonicalGraphSceneState) {
    const previousSceneState = this.domainStore.getState()
    if (previousSceneState === nextSceneState) {
      return
    }

    this.domainStore.replaceState(nextSceneState)
    this.combinedState = this.snapshotAdapter.adaptCombined(
      nextSceneState,
      this.uiState,
    )
    this.scheduleSceneEmit()
    this.scheduleCompatibilityEmit()
  }

  private replaceUiState(nextUiState: CanonicalGraphUiState) {
    if (this.uiState === nextUiState) {
      return
    }

    this.uiState = nextUiState
    this.combinedState = this.snapshotAdapter.adaptCombined(
      this.domainStore.getState(),
      nextUiState,
    )
    this.scheduleUiEmit()
    this.scheduleCompatibilityEmit()
  }

  private scheduleSceneEmit() {
    if (this.sceneListeners.size === 0) {
      return
    }

    if (this.gestureDepth > 0) {
      this.gestureSceneEmitDeferred = true
      return
    }

    if (
      this.pendingSceneEmitFrame !== null ||
      this.pendingSceneEmitTimer !== null
    ) {
      return
    }

    this.scheduleEmit(
      () => {
        this.pendingSceneEmitFrame = null
        this.pendingSceneEmitTimer = null
      },
      () => this.emit(this.sceneListeners),
      (handle) => {
        this.pendingSceneEmitFrame = handle
      },
      (timer) => {
        this.pendingSceneEmitTimer = timer
      },
    )
  }

  private scheduleUiEmit() {
    if (this.uiListeners.size === 0) {
      return
    }

    if (this.gestureDepth > 0) {
      this.gestureUiEmitDeferred = true
      return
    }

    if (this.pendingUiEmitFrame !== null || this.pendingUiEmitTimer !== null) {
      return
    }

    this.scheduleEmit(
      () => {
        this.pendingUiEmitFrame = null
        this.pendingUiEmitTimer = null
      },
      () => this.emit(this.uiListeners),
      (handle) => {
        this.pendingUiEmitFrame = handle
      },
      (timer) => {
        this.pendingUiEmitTimer = timer
      },
    )
  }

  private scheduleCompatibilityEmit() {
    if (this.compatibilityListeners.size === 0) {
      return
    }

    if (this.gestureDepth > 0) {
      this.gestureCompatibilityEmitDeferred = true
      return
    }

    if (
      this.pendingCompatibilityEmitFrame !== null ||
      this.pendingCompatibilityEmitTimer !== null
    ) {
      return
    }

    this.scheduleEmit(
      () => {
        this.pendingCompatibilityEmitFrame = null
        this.pendingCompatibilityEmitTimer = null
      },
      () => this.emit(this.compatibilityListeners),
      (handle) => {
        this.pendingCompatibilityEmitFrame = handle
      },
      (timer) => {
        this.pendingCompatibilityEmitTimer = timer
      },
    )
  }

  private scheduleEmit(
    beforeEmit: () => void,
    emit: () => void,
    setFrame: (handle: number) => void,
    setTimer: (timer: ReturnType<typeof setTimeout>) => void,
  ) {
    const flush = () => {
      beforeEmit()
      emit()
    }

    if (typeof requestAnimationFrame === 'function') {
      setFrame(requestAnimationFrame(flush))
      return
    }

    setTimer(setTimeout(flush, 0))
  }

  private cancelScheduledEmits() {
    if (
      this.pendingSceneEmitFrame !== null &&
      typeof cancelAnimationFrame === 'function'
    ) {
      cancelAnimationFrame(this.pendingSceneEmitFrame)
    }
    if (
      this.pendingUiEmitFrame !== null &&
      typeof cancelAnimationFrame === 'function'
    ) {
      cancelAnimationFrame(this.pendingUiEmitFrame)
    }
    if (
      this.pendingCompatibilityEmitFrame !== null &&
      typeof cancelAnimationFrame === 'function'
    ) {
      cancelAnimationFrame(this.pendingCompatibilityEmitFrame)
    }
    if (this.pendingSceneEmitTimer !== null) {
      clearTimeout(this.pendingSceneEmitTimer)
    }
    if (this.pendingUiEmitTimer !== null) {
      clearTimeout(this.pendingUiEmitTimer)
    }
    if (this.pendingCompatibilityEmitTimer !== null) {
      clearTimeout(this.pendingCompatibilityEmitTimer)
    }

    this.pendingSceneEmitFrame = null
    this.pendingUiEmitFrame = null
    this.pendingCompatibilityEmitFrame = null
    this.pendingSceneEmitTimer = null
    this.pendingUiEmitTimer = null
    this.pendingCompatibilityEmitTimer = null
  }

  private emit(listeners: ReadonlySet<() => void>) {
    for (const listener of listeners) {
      listener()
    }
  }
}
