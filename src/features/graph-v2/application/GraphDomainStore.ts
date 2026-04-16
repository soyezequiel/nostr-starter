import type { CanonicalGraphState } from '@/features/graph-v2/domain/types'
import { DEFAULT_GRAPH_V2_LAYER } from '@/features/graph-v2/domain/invariants'

type Listener = () => void

const EMPTY_ROOT_LOAD_STATE: CanonicalGraphState['discoveryState']['rootLoad'] = {
  status: 'idle',
  message: null,
  loadedFrom: 'none',
  visibleLinkProgress: null,
}

const createEmptyState = (): CanonicalGraphState => ({
  nodesByPubkey: {},
  edgesById: {},
  rootPubkey: null,
  activeLayer: DEFAULT_GRAPH_V2_LAYER,
  connectionsSourceLayer: 'graph',
  selectedNodePubkey: null,
  pinnedNodePubkeys: new Set<string>(),
  relayState: {
    urls: [],
    endpoints: {},
    overrideStatus: 'idle',
    isGraphStale: false,
  },
  discoveryState: {
    rootLoad: EMPTY_ROOT_LOAD_STATE,
    expandedNodePubkeys: new Set<string>(),
    graphRevision: 0,
    inboundGraphRevision: 0,
    connectionsLinksRevision: 0,
  },
})

export class GraphDomainStore {
  private state: CanonicalGraphState

  private readonly listeners = new Set<Listener>()

  public constructor(initialState?: CanonicalGraphState) {
    this.state = initialState ?? createEmptyState()
  }

  public getState = () => this.state

  public replaceState = (nextState: CanonicalGraphState) => {
    if (this.state === nextState) {
      return
    }

    this.state = nextState
    this.emit()
  }

  public subscribe = (listener: Listener) => {
    this.listeners.add(listener)

    return () => {
      this.listeners.delete(listener)
    }
  }

  private emit() {
    for (const listener of this.listeners) {
      listener()
    }
  }
}
