import forceAtlas2 from 'graphology-layout-forceatlas2'
import FA2LayoutSupervisor from 'graphology-layout-forceatlas2/worker'
import type Graph from 'graphology-types'

import type { GraphSceneSnapshot } from '@/features/graph-v2/renderer/contracts'
import type {
  SigmaEdgeAttributes,
  SigmaNodeAttributes,
} from '@/features/graph-v2/renderer/graphologyProjectionStore'

const MINIMUM_RUNNING_NODES = 2

export class ForceAtlasRuntime {
  private layout: FA2LayoutSupervisor<SigmaNodeAttributes, SigmaEdgeAttributes> | null =
    null

  private lastTopologySignature: string | null = null

  public constructor(
    private readonly graph: Graph<SigmaNodeAttributes, SigmaEdgeAttributes>,
  ) {}

  public sync(scene: GraphSceneSnapshot) {
    const shouldRun =
      scene.nodes.length >= MINIMUM_RUNNING_NODES && scene.forceEdges.length > 0

    if (!shouldRun) {
      this.stop()
      this.lastTopologySignature = scene.diagnostics.topologySignature
      return
    }

    if (
      this.layout === null ||
      this.lastTopologySignature !== scene.diagnostics.topologySignature
    ) {
      this.reheat()
      this.lastTopologySignature = scene.diagnostics.topologySignature
      return
    }

    if (!this.layout.isRunning()) {
      this.layout.start()
    }
  }

  public reheat() {
    if (this.graph.order < MINIMUM_RUNNING_NODES || this.graph.size === 0) {
      return
    }

    this.stop()
    this.kill()
    this.layout = this.createLayout()
    this.layout.start()
  }

  public stop() {
    if (this.layout?.isRunning()) {
      this.layout.stop()
    }
  }

  public kill() {
    this.layout?.kill()
    this.layout = null
  }

  public dispose() {
    this.stop()
    this.kill()
  }

  private createLayout() {
    const inferredSettings = forceAtlas2.inferSettings(this.graph.order)

    return new FA2LayoutSupervisor(this.graph, {
      settings: {
        ...inferredSettings,
        adjustSizes: true,
        slowDown: 4,
        gravity: 0.15,
        scalingRatio: 4,
        barnesHutOptimize: this.graph.order > 250,
      },
      getEdgeWeight: 'weight',
    })
  }
}
