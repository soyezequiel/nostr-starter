import assert from 'node:assert/strict'
import test from 'node:test'

import { createDragNeighborhoodInfluenceState } from '@/features/graph-v2/renderer/dragInfluence'
import {
  NodePositionLedger,
  PhysicsGraphStore,
  RenderGraphStore,
} from '@/features/graph-v2/renderer/graphologyProjectionStore'
import type {
  GraphInteractionCallbacks,
  GraphSceneSnapshot,
} from '@/features/graph-v2/renderer/contracts'

const createScene = (): GraphSceneSnapshot => ({
  render: {
    nodes: [
      {
        pubkey: 'A',
        label: 'A',
        pictureUrl: null,
        color: '#fff',
        size: 10,
        isRoot: true,
        isSelected: false,
        isPinned: false,
        isNeighbor: false,
        isDimmed: false,
        focusState: 'root',
      },
      {
        pubkey: 'D',
        label: 'D',
        pictureUrl: null,
        color: '#fff',
        size: 10,
        isRoot: false,
        isSelected: false,
        isPinned: false,
        isNeighbor: false,
        isDimmed: false,
        focusState: 'idle',
      },
    ],
    visibleEdges: [],
    labels: [],
    selection: {
      selectedNodePubkey: null,
      hoveredNodePubkey: null,
    },
    pins: {
      pubkeys: [],
    },
    cameraHint: {
      focusPubkey: null,
      rootPubkey: 'A',
    },
    diagnostics: {
      activeLayer: 'graph',
      nodeCount: 2,
      visibleEdgeCount: 0,
      relayCount: 0,
      isGraphStale: false,
      topologySignature: 'sigma-renderer-adapter-test',
    },
  },
  physics: {
    nodes: [
      { pubkey: 'A', size: 10, fixed: false },
      { pubkey: 'D', size: 10, fixed: false },
    ],
    edges: [],
    diagnostics: {
      nodeCount: 2,
      edgeCount: 0,
      topologySignature: 'sigma-renderer-adapter-test',
    },
  },
})

const createCallbacks = (
  onNodeDragMove: GraphInteractionCallbacks['onNodeDragMove'],
): GraphInteractionCallbacks => ({
  onNodeClick: () => {},
  onClearSelection: () => {},
  onNodeHover: () => {},
  onNodeDragStart: () => {},
  onNodeDragMove,
  onNodeDragEnd: () => {},
  onViewportChange: () => {},
})

test('continues local drag influence even when pointer movement pauses', async () => {
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame
  const originalWebGL2RenderingContext = globalThis.WebGL2RenderingContext
  const originalWebGLRenderingContext = globalThis.WebGLRenderingContext
  const queuedFrames: FrameRequestCallback[] = []

  globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    queuedFrames.push(callback)
    return queuedFrames.length
  }) as typeof requestAnimationFrame
  globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame
  globalThis.WebGL2RenderingContext ??= class {} as typeof WebGL2RenderingContext
  globalThis.WebGLRenderingContext ??= class {} as typeof WebGLRenderingContext

  try {
    const { SigmaRendererAdapter } = await import(
      '@/features/graph-v2/renderer/SigmaRendererAdapter'
    )

    const scene = createScene()
    const ledger = new NodePositionLedger()
    const renderStore = new RenderGraphStore(ledger)
    const physicsStore = new PhysicsGraphStore(ledger)
    renderStore.applyScene(scene.render)
    physicsStore.applyScene(scene.physics)
    renderStore.setNodePosition('A', 40, 0)
    renderStore.setNodePosition('D', 42, 0)
    physicsStore.setNodePosition('A', 40, 0, true)
    physicsStore.setNodePosition('D', 42, 0)

    const dragMoves: Array<{ x: number; y: number }> = []
    const adapter = new SigmaRendererAdapter() as SigmaRendererAdapter & {
      sigma: { refresh: () => void }
      renderStore: RenderGraphStore
      physicsStore: PhysicsGraphStore
      callbacks: GraphInteractionCallbacks
      draggedNodePubkey: string | null
      lastDragGraphPosition: { x: number; y: number } | null
      pendingGraphPosition: { x: number; y: number } | null
      dragInfluenceState: ReturnType<typeof createDragNeighborhoodInfluenceState> | null
      flushPendingDragFrame: () => void
    }

    adapter.sigma = { refresh: () => {} }
    adapter.renderStore = renderStore
    adapter.physicsStore = physicsStore
    adapter.callbacks = createCallbacks((_pubkey, position) => {
      dragMoves.push(position)
    })
    adapter.draggedNodePubkey = 'A'
    adapter.lastDragGraphPosition = { x: 40, y: 0 }
    adapter.pendingGraphPosition = { x: 40, y: 0 }
    adapter.dragInfluenceState = createDragNeighborhoodInfluenceState(
      physicsStore,
      'A',
      new Map([['A', 0]]),
    )

    const beforeFirstFrame = physicsStore.getNodePosition('D')!
    adapter.flushPendingDragFrame()
    const afterFirstFrame = physicsStore.getNodePosition('D')!

    assert.ok(afterFirstFrame.x > beforeFirstFrame.x)
    assert.equal(dragMoves.length, 1)
    assert.equal(queuedFrames.length, 1)

    const beforeSecondFrame = physicsStore.getNodePosition('D')!
    queuedFrames.shift()?.(performance.now())
    const afterSecondFrame = physicsStore.getNodePosition('D')!

    assert.ok(afterSecondFrame.x > beforeSecondFrame.x)
    assert.equal(
      dragMoves.length,
      1,
      'expected no synthetic drag-move callback without a new pointer position',
    )
  } finally {
    globalThis.requestAnimationFrame = originalRequestAnimationFrame
    globalThis.cancelAnimationFrame = originalCancelAnimationFrame
    globalThis.WebGL2RenderingContext = originalWebGL2RenderingContext
    globalThis.WebGLRenderingContext = originalWebGLRenderingContext
  }
})
