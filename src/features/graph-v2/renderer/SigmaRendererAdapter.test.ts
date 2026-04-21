import assert from 'node:assert/strict'
import test from 'node:test'

import { AvatarBitmapCache } from '@/features/graph-v2/renderer/avatar/avatarBitmapCache'
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

type DragHarness = {
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

type HoverHarness = {
  sigma: { getCamera: () => { getState: () => { ratio: number } } }
  resolveNodeHoverAttributes: (
    node: string,
    data: {
      x: number
      y: number
      size: number
      color: string
      focusState: 'idle'
      label: string
      hidden: boolean
      highlighted: boolean
      forceLabel: boolean
      fixed: boolean
      pictureUrl: string | null
      isDimmed: boolean
      isSelected: boolean
      isNeighbor: boolean
      isRoot: boolean
      isPinned: boolean
      zIndex: number
    },
    focus: { pubkey: string | null; neighbors: Set<string> },
  ) => {
    color: string
    highlighted: boolean
    zIndex: number
  }
}

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
    const adapter = new SigmaRendererAdapter() as unknown as DragHarness

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

test('keeps hovered neighbors on their base color while marking them highlighted', async () => {
  const { SigmaRendererAdapter } = await import(
    '@/features/graph-v2/renderer/SigmaRendererAdapter'
  )

  const adapter = new SigmaRendererAdapter() as unknown as HoverHarness

  adapter.sigma = {
    getCamera: () => ({
      getState: () => ({ ratio: 1 }),
    }),
  }

  const hoveredNeighbor = adapter.resolveNodeHoverAttributes(
    'B',
    {
      x: 0,
      y: 0,
      size: 12,
      color: '#8ebfc7',
      focusState: 'idle',
      label: 'B',
      hidden: false,
      highlighted: false,
      forceLabel: false,
      fixed: false,
      pictureUrl: null,
      isDimmed: false,
      isSelected: false,
      isNeighbor: false,
      isRoot: false,
      isPinned: false,
      zIndex: 0,
    },
    {
      pubkey: 'A',
      neighbors: new Set(['B']),
    },
  )

  assert.equal(hoveredNeighbor.color, '#8ebfc7')
  assert.equal(hoveredNeighbor.highlighted, true)
  assert.equal(hoveredNeighbor.zIndex, 8)
})

test('social capture uses an isolated avatar cache', async () => {
  const restoreDocument = installCaptureDocumentStub()

  try {
    const { SigmaRendererAdapter } = await import(
      '@/features/graph-v2/renderer/SigmaRendererAdapter'
    )

    const adapter = new SigmaRendererAdapter() as unknown as {
      sigma: {
        getCamera: () => {
          getState: () => { ratio: number }
          setState: (_state: { ratio: number }) => void
        }
      }
      renderStore: {
        getGraph: () => {
          nodes: () => string[]
          edges: () => string[]
          getNodeAttributes: (_pubkey: string) => Record<string, unknown>
          degree: (_pubkey: string) => number
          source: (_edgeId: string) => string
          target: (_edgeId: string) => string
          getEdgeAttributes: (_edgeId: string) => Record<string, unknown>
        }
      }
      avatarCache: AvatarBitmapCache
      avatarLoader: {
        load: () => Promise<{ bitmap: HTMLCanvasElement; bytes: number }>
      }
      forceRuntime: {
        isRunning: () => boolean
        suspend: () => void
        resume: () => void
      } | null
      cancelPhysicsPositionBridge: () => void
      safeRefresh: () => void
      scene: {
        render: {
          cameraHint: {
            rootPubkey: string | null
          }
        }
      }
      captureSocialGraph: () => Promise<Blob>
    }

    adapter.sigma = {
      getCamera: () => ({
        getState: () => ({ ratio: 1 }),
        setState: () => {},
      }),
    }
    adapter.renderStore = {
      getGraph: () => ({
        nodes: () => ['root'],
        edges: () => [],
        getNodeAttributes: () => ({
          x: 0,
          y: 0,
          size: 10,
          color: '#7dd3a7',
          focusState: 'root',
          label: 'root',
          hidden: false,
          highlighted: false,
          forceLabel: false,
          fixed: false,
          pictureUrl: 'https://example.com/root.png',
          isDimmed: false,
          isSelected: false,
          isNeighbor: false,
          isRoot: true,
          isPinned: false,
          zIndex: 0,
        }),
        degree: () => 0,
        source: () => '',
        target: () => '',
        getEdgeAttributes: () => ({}),
      }),
    }
    adapter.avatarCache = new AvatarBitmapCache(16)
    adapter.avatarLoader = {
      load: async () => ({
        bitmap: document.createElement('canvas') as HTMLCanvasElement,
        bytes: 64,
      }),
    }
    adapter.forceRuntime = {
      isRunning: () => false,
      suspend: () => {},
      resume: () => {},
    }
    adapter.cancelPhysicsPositionBridge = () => {}
    adapter.safeRefresh = () => {}
    adapter.scene = {
      render: {
        cameraHint: {
          rootPubkey: 'root',
        },
      },
    }

    const blob = await adapter.captureSocialGraph()

    assert.equal(blob.type, 'image/png')
    assert.equal(
      adapter.avatarCache.size(),
      0,
      'expected live avatar cache to remain untouched by social capture preload',
    )
  } finally {
    restoreDocument()
  }
})

test('avatar runtime debug snapshot combines cache, loader, scheduler, and overlay state', async () => {
  const { SigmaRendererAdapter } = await import(
    '@/features/graph-v2/renderer/SigmaRendererAdapter'
  )

  const adapter = new SigmaRendererAdapter() as unknown as {
    sigma: {
      getCamera: () => {
        getState: () => { x: number; y: number; ratio: number; angle: number }
      }
    }
    container: { offsetWidth: number; offsetHeight: number } | null
    forceRuntime: { isRunning: () => boolean } | null
    motionActive: boolean
    hideAvatarsOnMove: boolean
    avatarRuntimeOptions: Record<string, unknown>
    avatarBudget: { snapshot: () => { tier: string } }
    avatarCache: { getDebugSnapshot: () => { byState: { ready: number; loading: number; failed: number } } }
    avatarLoader: { getDebugSnapshot: () => { blockedCount: number } }
    avatarScheduler: { getDebugSnapshot: () => { inflightCount: number } }
    avatarOverlay: { getDebugSnapshot: () => { counts: { drawnImages: number } } }
    scene: {
      render: {
        cameraHint: { rootPubkey: string | null }
        selection: { selectedNodePubkey: string | null }
      }
    }
    getAvatarRuntimeDebugSnapshot: () => {
      rootPubkey: string | null
      selectedNodePubkey: string | null
      cache: { byState: { ready: number; loading: number; failed: number } } | null
      loader: { blockedCount: number } | null
      scheduler: { inflightCount: number } | null
      overlay: { counts: { drawnImages: number } } | null
      motionActive: boolean
      hideAvatarsOnMove: boolean
      physicsRunning: boolean
    } | null
  }

  adapter.sigma = {
    getCamera: () => ({
      getState: () => ({ x: 1, y: 2, ratio: 1.5, angle: 0 }),
    }),
  }
  adapter.container = {
    offsetWidth: 1440,
    offsetHeight: 900,
  }
  adapter.forceRuntime = {
    isRunning: () => true,
  }
  adapter.motionActive = true
  adapter.hideAvatarsOnMove = false
  adapter.avatarRuntimeOptions = {
    showAllVisibleImages: true,
  }
  adapter.avatarBudget = {
    snapshot: () => ({ tier: 'high' }),
  }
  adapter.avatarCache = {
    getDebugSnapshot: () => ({
      byState: { ready: 5, loading: 2, failed: 1 },
    }),
  }
  adapter.avatarLoader = {
    getDebugSnapshot: () => ({ blockedCount: 1 }),
  }
  adapter.avatarScheduler = {
    getDebugSnapshot: () => ({ inflightCount: 2 }),
  }
  adapter.avatarOverlay = {
    getDebugSnapshot: () => ({ counts: { drawnImages: 5 } }),
  }
  adapter.scene = {
    render: {
      cameraHint: { rootPubkey: 'root' },
      selection: { selectedNodePubkey: 'selected' },
    },
  }

  const snapshot = adapter.getAvatarRuntimeDebugSnapshot()
  assert.equal(snapshot?.rootPubkey, 'root')
  assert.equal(snapshot?.selectedNodePubkey, 'selected')
  assert.equal(snapshot?.cache?.byState.ready, 5)
  assert.equal(snapshot?.loader?.blockedCount, 1)
  assert.equal(snapshot?.scheduler?.inflightCount, 2)
  assert.equal(snapshot?.overlay?.counts.drawnImages, 5)
  assert.equal(snapshot?.motionActive, true)
  assert.equal(snapshot?.physicsRunning, true)
})

test('avatar global motion is separate from graph or drag motion', async () => {
  const { SigmaRendererAdapter } = await import(
    '@/features/graph-v2/renderer/SigmaRendererAdapter'
  )

  const adapter = new SigmaRendererAdapter() as unknown as {
    avatarOverlay: Record<string, never> | null
    motionActive: boolean
    cameraMotionActive: boolean
    motionClearTimer: ReturnType<typeof setTimeout> | null
    cameraMotionClearTimer: ReturnType<typeof setTimeout> | null
    markMotion: () => void
    markCameraMotion: () => void
    safeRefresh: () => void
  }
  adapter.avatarOverlay = {}
  adapter.safeRefresh = () => {}

  adapter.markMotion()
  assert.equal(adapter.motionActive, true)
  assert.equal(adapter.cameraMotionActive, false)

  adapter.markCameraMotion()
  assert.equal(adapter.motionActive, true)
  assert.equal(adapter.cameraMotionActive, true)

  if (adapter.motionClearTimer !== null) {
    clearTimeout(adapter.motionClearTimer)
    adapter.motionClearTimer = null
  }
  if (adapter.cameraMotionClearTimer !== null) {
    clearTimeout(adapter.cameraMotionClearTimer)
    adapter.cameraMotionClearTimer = null
  }
})

test('avatar-settled refresh is coalesced by Sigma without forcing a synchronous refresh', async () => {
  const { SigmaRendererAdapter } = await import(
    '@/features/graph-v2/renderer/SigmaRendererAdapter'
  )

  const adapter = new SigmaRendererAdapter() as unknown as {
    sigma: {
      scheduleRefresh: () => void
      refresh: () => void
    } | null
    container: { offsetWidth: number; offsetHeight: number } | null
    pendingContainerRefresh: boolean
    scheduleAvatarSettledRefresh: () => void
  }

  let scheduled = 0
  let refreshed = 0
  adapter.sigma = {
    scheduleRefresh: () => {
      scheduled += 1
    },
    refresh: () => {
      refreshed += 1
    },
  }
  adapter.container = {
    offsetWidth: 1440,
    offsetHeight: 900,
  }
  adapter.pendingContainerRefresh = false

  adapter.scheduleAvatarSettledRefresh()

  assert.equal(scheduled, 1)
  assert.equal(refreshed, 0)
  assert.equal(adapter.pendingContainerRefresh, false)
})

test('avatar-settled refresh defers while the container is not renderable', async () => {
  const { SigmaRendererAdapter } = await import(
    '@/features/graph-v2/renderer/SigmaRendererAdapter'
  )

  const adapter = new SigmaRendererAdapter() as unknown as {
    sigma: {
      scheduleRefresh: () => void
    } | null
    container: { offsetWidth: number; offsetHeight: number } | null
    pendingContainerRefresh: boolean
    scheduleAvatarSettledRefresh: () => void
  }

  let scheduled = 0
  adapter.sigma = {
    scheduleRefresh: () => {
      scheduled += 1
    },
  }
  adapter.container = {
    offsetWidth: 0,
    offsetHeight: 0,
  }
  adapter.pendingContainerRefresh = false

  adapter.scheduleAvatarSettledRefresh()

  assert.equal(scheduled, 0)
  assert.equal(adapter.pendingContainerRefresh, true)
})

const installCaptureDocumentStub = () => {
  const originalDocument = globalThis.document
  const ctx = {
    save: () => undefined,
    restore: () => undefined,
    beginPath: () => undefined,
    closePath: () => undefined,
    moveTo: () => undefined,
    lineTo: () => undefined,
    quadraticCurveTo: () => undefined,
    arc: () => undefined,
    clip: () => undefined,
    fill: () => undefined,
    stroke: () => undefined,
    fillRect: () => undefined,
    fillText: () => undefined,
    strokeText: () => undefined,
    drawImage: () => undefined,
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    measureText: (text: string) => ({ width: text.length * 8 }),
    createLinearGradient: () => ({
      addColorStop: () => undefined,
    }),
    createRadialGradient: () => ({
      addColorStop: () => undefined,
    }),
  }
  const canvasFactory = () => ({
    width: 0,
    height: 0,
    getContext: () => ctx,
    toBlob: (callback: (blob: Blob | null) => void) => {
      callback(new Blob(['png'], { type: 'image/png' }))
    },
  })
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      createElement: (tagName: string) => {
        if (tagName === 'canvas') {
          return canvasFactory()
        }
        return {
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
        }
      },
    },
  })

  return () => {
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: originalDocument,
    })
  }
}
