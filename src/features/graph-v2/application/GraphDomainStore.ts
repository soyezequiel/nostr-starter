import type { CanonicalGraphSceneState } from '@/features/graph-v2/domain/types'
import { DEFAULT_GRAPH_V2_LAYER } from '@/features/graph-v2/domain/invariants'

type Listener = () => void

const createEmptyState = (): CanonicalGraphSceneState => ({
  nodesByPubkey: {},
  edgesById: {},
  sceneSignature: 'empty',
  topologySignature: 'empty',
  nodeVisualRevision: 0,
  nodeDetailRevision: 0,
  rootPubkey: null,
  activeLayer: DEFAULT_GRAPH_V2_LAYER,
  connectionsSourceLayer: 'mutuals',
  selectedNodePubkey: null,
  pinnedNodePubkeys: new Set<string>(),
  discoveryState: {
    expandedNodePubkeys: new Set<string>(),
    graphRevision: 0,
    inboundGraphRevision: 0,
    connectionsLinksRevision: 0,
  },
})

export class GraphDomainStore {
  private state: CanonicalGraphSceneState

  private readonly listeners = new Set<Listener>()

  public constructor(initialState?: CanonicalGraphSceneState) {
    this.state = initialState ?? createEmptyState()
  }

  public getState = () => this.state

  public replaceState = (nextState: CanonicalGraphSceneState) => {
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
