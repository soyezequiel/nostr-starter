import forceAtlas2 from 'graphology-layout-forceatlas2'
import FA2LayoutSupervisor from 'graphology-layout-forceatlas2/worker'
import type Graph from 'graphology-types'

import type { GraphSceneSnapshot } from '@/features/graph-v2/renderer/contracts'
import type {
  SigmaEdgeAttributes,
  SigmaNodeAttributes,
} from '@/features/graph-v2/renderer/graphologyProjectionStore'

const MINIMUM_RUNNING_NODES = 2

export interface ForceAtlasLayoutController {
  isRunning(): boolean
  start(): void
  stop(): void
  kill(): void
}

const createSettingsKey = (graphOrder: number) =>
  `${Math.floor(Math.log2(Math.max(graphOrder, 1)))}::${graphOrder > 2000}`

export class ForceAtlasRuntime {
  private layout: ForceAtlasLayoutController | null = null

  private lastSettingsKey: string | null = null

  private suspended = false

  private layoutEligible = false

  public constructor(
    private readonly graph: Graph<SigmaNodeAttributes, SigmaEdgeAttributes>,
    private readonly layoutFactory: (
      graph: Graph<SigmaNodeAttributes, SigmaEdgeAttributes>,
    ) => ForceAtlasLayoutController = (graph) => {
      const inferredSettings = forceAtlas2.inferSettings(graph.order)

      return new FA2LayoutSupervisor(graph, {
        settings: {
          ...inferredSettings,
          adjustSizes: true,
          // Higher slowDown keeps motion gentle and Obsidian-like.
          slowDown: 8,
          // A small gravity holds the graph together without overpowering
          // local structure or pinned nodes.
          gravity: 0.12,
          scalingRatio: 6,
          barnesHutOptimize: graph.order > 250,
          strongGravityMode: false,
        },
        getEdgeWeight: 'weight',
      })
    },
  ) {}

  public sync(scene: GraphSceneSnapshot) {
    const shouldRun =
      scene.nodes.length >= MINIMUM_RUNNING_NODES && scene.forceEdges.length > 0
    this.layoutEligible = shouldRun

    if (!shouldRun) {
      this.stop()
      return
    }

    if (this.suspended) {
      return
    }

    const settingsKey = createSettingsKey(this.graph.order)

    if (this.layout === null) {
      this.layout = this.createLayout()
      this.lastSettingsKey = settingsKey
      this.layout.start()
      return
    }

    if (this.lastSettingsKey !== settingsKey) {
      this.stop()
      this.kill()
      this.layout = this.createLayout()
      this.lastSettingsKey = settingsKey
      this.layout.start()
      return
    }

    if (!this.layout.isRunning()) {
      this.layout.start()
    }
  }

  public reheat() {
    if (this.suspended) {
      return
    }

    if (!this.layoutEligible) {
      return
    }

    this.stop()
    this.kill()
    this.layout = this.createLayout()
    this.lastSettingsKey = createSettingsKey(this.graph.order)
    this.layout.start()
  }

  public stop() {
    if (this.layout?.isRunning()) {
      this.layout.stop()
    }
  }

  public suspend() {
    this.suspended = true
    this.stop()
  }

  public resume() {
    if (!this.suspended) {
      return
    }

    this.suspended = false

    if (!this.layoutEligible) {
      return
    }

    if (this.layout === null) {
      this.layout = this.createLayout()
      this.lastSettingsKey = createSettingsKey(this.graph.order)
      this.layout.start()
      return
    }

    if (!this.layout.isRunning()) {
      this.layout.start()
    }
  }

  public isSuspended() {
    return this.suspended
  }

  public isRunning() {
    return this.layout?.isRunning() ?? false
  }

  public kill() {
    this.layout?.kill()
    this.layout = null
    this.lastSettingsKey = null
  }

  public dispose() {
    this.stop()
    this.kill()
  }

  private createLayout() {
    return this.layoutFactory(this.graph)
  }
}
