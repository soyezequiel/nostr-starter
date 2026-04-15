import Sigma from 'sigma'

import type {
  GraphInteractionCallbacks,
  GraphSceneSnapshot,
  RendererAdapter,
} from '@/features/graph-v2/renderer/contracts'
import { ForceAtlasRuntime } from '@/features/graph-v2/renderer/forceAtlasRuntime'
import type {
  SigmaEdgeAttributes,
  SigmaNodeAttributes,
} from '@/features/graph-v2/renderer/graphologyProjectionStore'
import { GraphologyProjectionStore } from '@/features/graph-v2/renderer/graphologyProjectionStore'

export class SigmaRendererAdapter implements RendererAdapter {
  private sigma: Sigma<SigmaNodeAttributes, SigmaEdgeAttributes> | null = null

  private projectionStore: GraphologyProjectionStore | null = null

  private forceRuntime: ForceAtlasRuntime | null = null

  private callbacks: GraphInteractionCallbacks | null = null

  private scene: GraphSceneSnapshot | null = null

  private draggedNodePubkey: string | null = null

  private readonly releaseDrag = () => {
    if (!this.draggedNodePubkey || !this.projectionStore || !this.callbacks) {
      return
    }

    const draggedNodePubkey = this.draggedNodePubkey
    const position = this.projectionStore.getNodePosition(draggedNodePubkey)
    const isPinned = this.scene?.pins.pubkeys.includes(draggedNodePubkey) ?? false

    this.projectionStore.setNodeFixed(draggedNodePubkey, isPinned)
    this.forceRuntime?.reheat()
    this.draggedNodePubkey = null

    if (position) {
      this.callbacks.onNodeDragEnd(draggedNodePubkey, position)
    }
  }

  public mount(
    container: HTMLElement,
    initialScene: GraphSceneSnapshot,
    callbacks: GraphInteractionCallbacks,
  ) {
    this.callbacks = callbacks
    this.scene = initialScene
    this.projectionStore = new GraphologyProjectionStore()
    this.projectionStore.applyScene(initialScene)
    this.forceRuntime = new ForceAtlasRuntime(this.projectionStore.getGraph())
    this.sigma = new Sigma(this.projectionStore.getGraph(), container, {
      renderEdgeLabels: false,
      hideEdgesOnMove: false,
      labelDensity: 0.08,
      labelRenderedSizeThreshold: 10,
      enableEdgeEvents: false,
      defaultEdgeColor: '#8fb6ff',
      defaultNodeColor: '#7dd3a7',
      minCameraRatio: 0.05,
      maxCameraRatio: 4,
    })

    const sigma = this.sigma
    this.bindEvents()
    this.forceRuntime.sync(initialScene)
    sigma.getCamera().animatedReset({ duration: 250 }).catch(() => {})
  }

  public update(scene: GraphSceneSnapshot) {
    if (!this.sigma || !this.projectionStore || !this.forceRuntime) {
      return
    }

    const sigma = this.sigma
    const previousScene = this.scene
    this.scene = scene
    this.projectionStore.applyScene(scene)
    this.forceRuntime.sync(scene)

    if (
      previousScene?.cameraHint.rootPubkey !== scene.cameraHint.rootPubkey &&
      scene.nodes.length > 0
    ) {
      sigma.getCamera().animatedReset({ duration: 250 }).catch(() => {})
    }

    sigma.refresh()
  }

  public dispose() {
    this.releaseDrag()
    this.forceRuntime?.dispose()
    this.forceRuntime = null
    this.sigma?.kill()
    this.sigma = null
    this.projectionStore = null
    this.callbacks = null
    this.scene = null
  }

  private bindEvents() {
    if (!this.sigma || !this.projectionStore || !this.callbacks) {
      return
    }

    const sigma = this.sigma
    const projectionStore = this.projectionStore
    const callbacks = this.callbacks

    sigma.on('clickNode', ({ node }) => {
      callbacks.onNodeClick(node)
    })

    sigma.on('enterNode', ({ node }) => {
      callbacks.onNodeHover(node)
    })

    sigma.on('leaveNode', () => {
      callbacks.onNodeHover(null)
    })

    sigma.on('downNode', ({ node, preventSigmaDefault }) => {
      preventSigmaDefault()
      this.draggedNodePubkey = node
      projectionStore.setNodeFixed(node, true)
      this.forceRuntime?.reheat()
      callbacks.onNodeDragStart(node)
    })

    sigma.on('moveBody', ({ event, preventSigmaDefault }) => {
      if (!this.draggedNodePubkey) {
        return
      }

      preventSigmaDefault()

      const graphPosition = sigma.viewportToGraph({
        x: event.x,
        y: event.y,
      })

      projectionStore.setNodePosition(
        this.draggedNodePubkey,
        graphPosition.x,
        graphPosition.y,
        true,
      )
      sigma.refresh()
      callbacks.onNodeDragMove(this.draggedNodePubkey, graphPosition)
    })

    sigma.on('upNode', () => {
      this.releaseDrag()
    })

    sigma.on('upStage', () => {
      this.releaseDrag()
    })

    sigma.getCamera().on('updated', (viewport) => {
      callbacks.onViewportChange(viewport)
    })
  }
}
