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

const wait = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })

test('avatar image toggle disables and re-enables the avatar budget', async () => {
  const originalWebGL2RenderingContext = globalThis.WebGL2RenderingContext
  const originalWebGLRenderingContext = globalThis.WebGLRenderingContext
  globalThis.WebGL2RenderingContext ??= class {} as typeof WebGL2RenderingContext
  globalThis.WebGLRenderingContext ??= class {} as typeof WebGLRenderingContext

  const { SigmaRendererAdapter } = await import(
    '@/features/graph-v2/renderer/SigmaRendererAdapter'
  )
  try {
    let disableCalls = 0
    let enableCalls = 0
    let refreshCalls = 0
    const adapter = new SigmaRendererAdapter() as unknown as {
      avatarBudget: {
        disable: () => void
        enable: () => void
      }
      safeRefresh: () => void
      setAvatarImagesEnabled: (enabled: boolean) => void
    }

    adapter.avatarBudget = {
      disable: () => {
        disableCalls += 1
      },
      enable: () => {
        enableCalls += 1
      },
    }
    adapter.safeRefresh = () => {
      refreshCalls += 1
    }

    adapter.setAvatarImagesEnabled(false)
    adapter.setAvatarImagesEnabled(false)
    adapter.setAvatarImagesEnabled(true)

    assert.equal(disableCalls, 1)
    assert.equal(enableCalls, 1)
    assert.equal(refreshCalls, 2)
  } finally {
    globalThis.WebGL2RenderingContext = originalWebGL2RenderingContext
    globalThis.WebGLRenderingContext = originalWebGLRenderingContext
  }
})

const installAnimationFrameStub = () => {
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame
  const frameHandles = new Map<number, ReturnType<typeof setTimeout>>()
  let nextHandle = 1

  globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    const handle = nextHandle
    nextHandle += 1
    const timeout = setTimeout(() => {
      frameHandles.delete(handle)
      callback(performance.now())
    }, 0)
    frameHandles.set(handle, timeout)
    return handle
  }) as typeof requestAnimationFrame

  globalThis.cancelAnimationFrame = ((handle: number) => {
    const timeout = frameHandles.get(handle)
    if (timeout !== undefined) {
      clearTimeout(timeout)
      frameHandles.delete(handle)
    }
  }) as typeof cancelAnimationFrame

  return () => {
    for (const timeout of frameHandles.values()) {
      clearTimeout(timeout)
    }
    frameHandles.clear()
    globalThis.requestAnimationFrame = originalRequestAnimationFrame
    globalThis.cancelAnimationFrame = originalCancelAnimationFrame
  }
}

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
  onNodeDoubleClick: () => {},
  onClearSelection: () => {},
  onNodeHover: () => {},
  onNodeDragStart: () => {},
  onNodeDragMove,
  onNodeDragEnd: () => {},
  onViewportChange: () => {},
})

type DragHarness = {
  sigma: { refresh: () => void; scheduleRender: () => void }
  container: Pick<HTMLElement, 'offsetWidth' | 'offsetHeight'>
  positionLedger: NodePositionLedger
  renderStore: RenderGraphStore
  physicsStore: PhysicsGraphStore
  callbacks: GraphInteractionCallbacks
  draggedNodePubkey: string | null
  lastDragGraphPosition: { x: number; y: number } | null
  pendingGraphPosition: { x: number; y: number } | null
  dragInfluenceState: ReturnType<typeof createDragNeighborhoodInfluenceState> | null
  syncPhysicsPositionsToRender: () => boolean
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

type EdgeReducerHarness = {
  sigma: {
    getGraph: () => {
      hasEdge: (_edgeId: string) => boolean
      source: (_edgeId: string) => string
      target: (_edgeId: string) => string
    }
  }
  draggedNodePubkey: string | null
  currentHoverFocus: { pubkey: string | null; neighbors: Set<string> }
  safeRender: () => void
  setHideConnectionsForLowPerformance: (enabled: boolean) => void
  edgeReducer: (
    edge: string,
    data: {
      size: number
      color: string
      hidden: boolean
      label: string | null
      weight: number
      isDimmed: boolean
      touchesFocus: boolean
      zIndex: number
    },
  ) => {
    size: number
    color: string
    hidden: boolean
    touchesFocus?: boolean
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
    let refreshCalls = 0
    let renderCalls = 0
    const adapter = new SigmaRendererAdapter() as unknown as DragHarness

    adapter.sigma = {
      refresh: () => {
        refreshCalls += 1
      },
      scheduleRender: () => {
        renderCalls += 1
      },
    }
    adapter.container = {
      offsetWidth: 800,
      offsetHeight: 600,
    }
    adapter.positionLedger = ledger
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
    adapter.syncPhysicsPositionsToRender = () => {
      throw new Error('full physics sync should not run during drag frames')
    }

    const beforeFirstFrame = physicsStore.getNodePosition('D')!
    adapter.flushPendingDragFrame()
    const afterFirstFrame = physicsStore.getNodePosition('D')!
    const afterFirstRenderFrame = renderStore.getNodePosition('D')!

    assert.ok(afterFirstFrame.x > beforeFirstFrame.x)
    assert.equal(afterFirstRenderFrame.x, afterFirstFrame.x)
    assert.equal(afterFirstRenderFrame.y, afterFirstFrame.y)
    assert.equal(dragMoves.length, 1)
    assert.equal(queuedFrames.length, 1)
    assert.equal(renderCalls, 1)
    assert.equal(refreshCalls, 0)

    const beforeSecondFrame = physicsStore.getNodePosition('D')!
    queuedFrames.shift()?.(performance.now())
    const afterSecondFrame = physicsStore.getNodePosition('D')!
    const afterSecondRenderFrame = renderStore.getNodePosition('D')!

    assert.ok(afterSecondFrame.x > beforeSecondFrame.x)
    assert.equal(afterSecondRenderFrame.x, afterSecondFrame.x)
    assert.equal(afterSecondRenderFrame.y, afterSecondFrame.y)
    assert.equal(
      dragMoves.length,
      1,
      'expected no synthetic drag-move callback without a new pointer position',
    )
    assert.equal(renderCalls, 2)
    assert.equal(refreshCalls, 0)
  } finally {
    globalThis.requestAnimationFrame = originalRequestAnimationFrame
    globalThis.cancelAnimationFrame = originalCancelAnimationFrame
    globalThis.WebGL2RenderingContext = originalWebGL2RenderingContext
    globalThis.WebGLRenderingContext = originalWebGLRenderingContext
  }
})

test('releaseDrag keeps physics paused when drag started from a suspended runtime', async () => {
  const { SigmaRendererAdapter } = await import(
    '@/features/graph-v2/renderer/SigmaRendererAdapter'
  )

  let resumeCalls = 0
  let bridgeEnsures = 0
  let bridgeCancels = 0
  let renderCalls = 0
  const dragEnds: Array<{ x: number; y: number }> = []

  const adapter = new SigmaRendererAdapter() as unknown as {
    draggedNodePubkey: string | null
    shouldPinDraggedNodeOnRelease: boolean
    lastDragFlushTimestamp: number | null
    dragInfluenceState: null
    lastDragGraphPosition: null
    resumePhysicsAfterDrag: boolean
    suppressedClick: unknown
    suppressedStageClickUntil: number
    renderStore: { getNodePosition: (_pubkey: string) => { x: number; y: number } | null }
    physicsStore: { setNodeFixed: (_pubkey: string, _pinned: boolean) => void }
    callbacks: GraphInteractionCallbacks
    forceRuntime: {
      resume: (_options?: { invalidateConvergence?: boolean }) => void
    } | null
    scene: { render: { pins: { pubkeys: string[] } } } | null
    flushPendingDragFrame: () => void
    cancelPendingDragFrame: () => void
    cancelPhysicsPositionBridge: () => void
    ensurePhysicsPositionBridge: () => void
    setCameraLocked: (_locked: boolean) => void
    setGraphBoundsLocked: (_locked: boolean) => void
    safeRender: () => void
    recalculateHoverAfterDrag: () => void
    releaseDrag: (options?: { pinOnRelease?: boolean }) => void
  }

  adapter.draggedNodePubkey = 'alice'
  adapter.shouldPinDraggedNodeOnRelease = false
  adapter.lastDragFlushTimestamp = null
  adapter.dragInfluenceState = null
  adapter.lastDragGraphPosition = null
  adapter.resumePhysicsAfterDrag = false
  adapter.suppressedClick = null
  adapter.suppressedStageClickUntil = 0
  adapter.renderStore = {
    getNodePosition: () => ({ x: 10, y: 20 }),
  }
  adapter.physicsStore = {
    setNodeFixed: () => {},
  }
  adapter.callbacks = {
    onNodeClick: () => {},
    onNodeDoubleClick: () => {},
    onClearSelection: () => {},
    onNodeHover: () => {},
    onNodeDragStart: () => {},
    onNodeDragMove: () => {},
    onNodeDragEnd: (_pubkey, position) => {
      dragEnds.push(position)
    },
    onViewportChange: () => {},
  }
  adapter.forceRuntime = {
    resume: () => {
      resumeCalls += 1
    },
  }
  adapter.scene = {
    render: {
      pins: { pubkeys: [] },
    },
  }
  adapter.flushPendingDragFrame = () => {}
  adapter.cancelPendingDragFrame = () => {}
  adapter.cancelPhysicsPositionBridge = () => {
    bridgeCancels += 1
  }
  adapter.ensurePhysicsPositionBridge = () => {
    bridgeEnsures += 1
  }
  adapter.setCameraLocked = () => {}
  adapter.setGraphBoundsLocked = () => {}
  adapter.safeRender = () => {
    renderCalls += 1
  }
  adapter.recalculateHoverAfterDrag = () => {}

  adapter.releaseDrag()

  assert.equal(resumeCalls, 0)
  assert.equal(bridgeEnsures, 0)
  assert.equal(bridgeCancels, 1)
  assert.equal(renderCalls, 1)
  assert.equal(adapter.draggedNodePubkey, null)
  assert.equal(adapter.resumePhysicsAfterDrag, true)
  assert.deepEqual(dragEnds, [{ x: 10, y: 20 }])
})

test('highlight transition frame uses render-only scheduling', async () => {
  const { SigmaRendererAdapter } = await import(
    '@/features/graph-v2/renderer/SigmaRendererAdapter'
  )

  let renderCalls = 0
  let refreshCalls = 0
  let rescheduleCalls = 0
  const adapter = new SigmaRendererAdapter() as unknown as {
    pendingHighlightTransitionFrame: number | null
    highlightTransition: {
      from: { pubkey: string | null; neighbors: Set<string> }
      to: { pubkey: string | null; neighbors: Set<string> }
      startedAt: number
      durationMs: number
    } | null
    sceneFocusTransition: {
      from: null
      to: null
      startedAt: number
      durationMs: number
    } | null
    safeRender: () => void
    safeRefresh: () => void
    scheduleHighlightTransitionFrame: () => void
    flushHighlightTransitionFrame: () => void
  }

  adapter.pendingHighlightTransitionFrame = 1
  adapter.highlightTransition = {
    from: { pubkey: 'alice', neighbors: new Set(['bob']) },
    to: { pubkey: 'bob', neighbors: new Set(['alice']) },
    startedAt: performance.now(),
    durationMs: 1000,
  }
  adapter.sceneFocusTransition = null
  adapter.safeRender = () => {
    renderCalls += 1
  }
  adapter.safeRefresh = () => {
    refreshCalls += 1
  }
  adapter.scheduleHighlightTransitionFrame = () => {
    rescheduleCalls += 1
  }

  adapter.flushHighlightTransitionFrame()

  assert.equal(adapter.pendingHighlightTransitionFrame, null)
  assert.equal(renderCalls, 1)
  assert.equal(refreshCalls, 0)
  assert.equal(rescheduleCalls, 1)
})

test('motion settle timers use render-only scheduling', async () => {
  const { SigmaRendererAdapter } = await import(
    '@/features/graph-v2/renderer/SigmaRendererAdapter'
  )

  let renderCalls = 0
  let refreshCalls = 0
  const adapter = new SigmaRendererAdapter() as unknown as {
    avatarOverlay: object | null
    motionActive: boolean
    cameraMotionActive: boolean
    motionClearTimer: ReturnType<typeof setTimeout> | null
    cameraMotionClearTimer: ReturnType<typeof setTimeout> | null
    MOTION_RESUME_MS: number
    safeRender: () => void
    safeRefresh: () => void
    markMotion: () => void
    markCameraMotion: () => void
  }

  adapter.avatarOverlay = {}
  adapter.motionActive = false
  adapter.cameraMotionActive = false
  adapter.motionClearTimer = null
  adapter.cameraMotionClearTimer = null
  adapter.MOTION_RESUME_MS = 0
  adapter.safeRender = () => {
    renderCalls += 1
  }
  adapter.safeRefresh = () => {
    refreshCalls += 1
  }

  adapter.markMotion()
  adapter.markCameraMotion()
  await wait(5)

  assert.equal(adapter.motionActive, false)
  assert.equal(adapter.cameraMotionActive, false)
  assert.equal(renderCalls, 2)
  assert.equal(refreshCalls, 0)
})

test('physics bridge syncs visible priority nodes while spreading background nodes across frames', async () => {
  const restoreAnimationFrame = installAnimationFrameStub()
  const originalWebGL2RenderingContext = globalThis.WebGL2RenderingContext
  const originalWebGLRenderingContext = globalThis.WebGLRenderingContext

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
    const visiblePubkeys = Array.from(
      { length: 800 },
      (_value, index) => `visible-${index}`,
    )
    const physicsVisiblePubkey = 'physics-visible'
    const offscreenPubkeys = Array.from(
      { length: 900 },
      (_value, index) => `offscreen-${index}`,
    )
    const sceneWithOffscreenNode: GraphSceneSnapshot = {
      render: {
        ...scene.render,
        nodes: [
          ...scene.render.nodes,
          ...visiblePubkeys.map((pubkey) => ({
            pubkey,
            label: 'V',
            pictureUrl: null,
            color: '#fff',
            size: 10,
            isRoot: false,
            isSelected: false,
            isPinned: false,
            isNeighbor: false,
            isDimmed: false,
            focusState: 'idle',
          })),
          {
            pubkey: physicsVisiblePubkey,
            label: 'PV',
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
          ...offscreenPubkeys.map((pubkey) => ({
            pubkey,
            label: 'E',
            pictureUrl: null,
            color: '#fff',
            size: 10,
            isRoot: false,
            isSelected: false,
            isPinned: false,
            isNeighbor: false,
            isDimmed: false,
            focusState: 'idle',
          })),
        ],
      },
      physics: {
        ...scene.physics,
        nodes: [
          ...scene.physics.nodes,
          ...visiblePubkeys.map((pubkey) => ({
            pubkey,
            size: 10,
            fixed: false,
          })),
          {
            pubkey: physicsVisiblePubkey,
            size: 10,
            fixed: false,
          },
          ...offscreenPubkeys.map((pubkey) => ({
            pubkey,
            size: 10,
            fixed: false,
          })),
        ],
      },
    }
    renderStore.applyScene(sceneWithOffscreenNode.render)
    physicsStore.applyScene(sceneWithOffscreenNode.physics)
    renderStore.setNodePosition('A', 0, 0)
    renderStore.setNodePosition('D', 10, 0)
    physicsStore.setNodePosition('A', 100, 0)
    physicsStore.setNodePosition('D', 200, 0)
    visiblePubkeys.forEach((pubkey, index) => {
      renderStore.setNodePosition(pubkey, 10, 0)
      physicsStore.setNodePosition(pubkey, 300 + index, 0)
    })
    renderStore.setNodePosition(physicsVisiblePubkey, 500, 0)
    physicsStore.setNodePosition(physicsVisiblePubkey, 20, 0)
    offscreenPubkeys.forEach((pubkey, index) => {
      renderStore.setNodePosition(pubkey, 500 + index, 0)
      physicsStore.setNodePosition(pubkey, 700 + index, 0)
    })
    const countSyncedVisible = () =>
      visiblePubkeys.filter((pubkey, index) => {
        const position = renderStore.getNodePosition(pubkey)
        return position?.x === 300 + index
      }).length
    const countSyncedOffscreen = () =>
      offscreenPubkeys.filter((pubkey, index) => {
        const position = renderStore.getNodePosition(pubkey)
        return position?.x === 700 + index
      }).length

    let running = true
    let suspended = false
    let dirtyMarks = 0
    const adapter = new SigmaRendererAdapter() as unknown as {
      scene: GraphSceneSnapshot
      renderStore: RenderGraphStore
      physicsStore: PhysicsGraphStore
      positionLedger: NodePositionLedger
      forceRuntime: { isRunning: () => boolean; isSuspended: () => boolean }
      avatarOverlay: {
        forEachVisibleNodePubkey: (callback: (pubkey: string) => void) => number
        getVisibleNodePubkeyCount: () => number
        getVisibleNodePubkeys: () => string[]
      }
      nodeHitTester: { markDirty: () => void }
      sigma: {
        refresh: () => void
        getDimensions: () => { width: number; height: number }
        viewportToGraph: (point: { x: number; y: number }) => {
          x: number
          y: number
        }
      }
      physicsBridgeBackgroundCursor: number
      flushPhysicsPositionBridge: () => void
      cancelPhysicsPositionBridge: () => void
    }

    adapter.scene = sceneWithOffscreenNode
    adapter.renderStore = renderStore
    adapter.physicsStore = physicsStore
    adapter.positionLedger = ledger
    adapter.forceRuntime = {
      isRunning: () => running,
      isSuspended: () => suspended,
    }
    adapter.avatarOverlay = {
      forEachVisibleNodePubkey: (callback) => {
        callback('A')
        return 1
      },
      getVisibleNodePubkeyCount: () => 1,
      getVisibleNodePubkeys: () => ['A'],
    }
    adapter.nodeHitTester = {
      markDirty: () => {
        dirtyMarks += 1
      },
    }
    adapter.sigma = {
      refresh: () => {},
      getDimensions: () => ({ width: 100, height: 100 }),
      viewportToGraph: (point) => ({
        x: point.x - 50,
        y: point.y - 50,
      }),
    }

    adapter.flushPhysicsPositionBridge()

    assert.deepEqual(renderStore.getNodePosition('A'), { x: 100, y: 0 })
    assert.deepEqual(renderStore.getNodePosition('D'), { x: 200, y: 0 })
    assert.equal(
      countSyncedVisible(),
      visiblePubkeys.length,
      'all visible nodes should sync on the active frame instead of waiting for rotation',
    )
    assert.deepEqual(renderStore.getNodePosition(physicsVisiblePubkey), {
      x: 20,
      y: 0,
    })
    const offscreenSyncedAfterFirstFrame = countSyncedOffscreen()
    assert.ok(
      offscreenSyncedAfterFirstFrame > 0,
      'background sync should make progress on offscreen nodes',
    )
    assert.ok(
      offscreenSyncedAfterFirstFrame < offscreenPubkeys.length,
      'background sync should be spread across frames instead of doing a full active-layout sync',
    )

    adapter.flushPhysicsPositionBridge()
    assert.ok(countSyncedOffscreen() > offscreenSyncedAfterFirstFrame)

    running = false
    suspended = true
    physicsStore.setNodePosition('D', 300, 0)
    adapter.flushPhysicsPositionBridge()

    assert.deepEqual(
      renderStore.getNodePosition('D'),
      { x: 200, y: 0 },
      'suspended physics should not force a settle sync',
    )

    suspended = false
    adapter.flushPhysicsPositionBridge()

    assert.deepEqual(renderStore.getNodePosition('D'), { x: 300, y: 0 })
    assert.ok(dirtyMarks >= 2)
    adapter.cancelPhysicsPositionBridge()
  } finally {
    restoreAnimationFrame()
    globalThis.WebGL2RenderingContext = originalWebGL2RenderingContext
    globalThis.WebGLRenderingContext = originalWebGLRenderingContext
  }
})

test('safeRefresh coalesces visible refresh requests into one animation frame', async () => {
  const restoreAnimationFrame = installAnimationFrameStub()

  try {
    const { SigmaRendererAdapter } = await import(
      '@/features/graph-v2/renderer/SigmaRendererAdapter'
    )

    let refreshCalls = 0
    const adapter = new SigmaRendererAdapter() as unknown as {
      sigma: { refresh: () => void }
      container: Pick<HTMLElement, 'offsetWidth' | 'offsetHeight'>
      safeRefresh: () => void
    }

    adapter.sigma = {
      refresh: () => {
        refreshCalls += 1
      },
    }
    adapter.container = {
      offsetWidth: 800,
      offsetHeight: 600,
    }

    adapter.safeRefresh()
    adapter.safeRefresh()
    adapter.safeRefresh()

    assert.equal(refreshCalls, 0)
    await wait(5)
    assert.equal(refreshCalls, 1)
  } finally {
    restoreAnimationFrame()
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

test('edge reducer hides non first-order edges while dragging a node', async () => {
  const { SigmaRendererAdapter } = await import(
    '@/features/graph-v2/renderer/SigmaRendererAdapter'
  )

  const edgeEndpoints = new Map<string, [string, string]>([
    ['A->B', ['A', 'B']],
    ['C->D', ['C', 'D']],
  ])
  const adapter = new SigmaRendererAdapter() as unknown as EdgeReducerHarness
  const baseEdge = {
    size: 1,
    color: '#64b5ff',
    hidden: false,
    label: null,
    weight: 1,
    isDimmed: false,
    touchesFocus: false,
    zIndex: 1,
  }

  adapter.sigma = {
    getGraph: () => ({
      hasEdge: (edgeId) => edgeEndpoints.has(edgeId),
      source: (edgeId) => edgeEndpoints.get(edgeId)?.[0] ?? '',
      target: (edgeId) => edgeEndpoints.get(edgeId)?.[1] ?? '',
    }),
  }
  adapter.draggedNodePubkey = 'A'
  adapter.currentHoverFocus = {
    pubkey: 'A',
    neighbors: new Set(['B']),
  }

  const firstOrder = adapter.edgeReducer('A->B', baseEdge)
  const unrelated = adapter.edgeReducer('C->D', baseEdge)

  assert.equal(firstOrder.hidden, false)
  assert.ok(firstOrder.size > baseEdge.size)
  assert.equal(unrelated.hidden, true)
})

test('edge reducer hides background edges during low-performance connection LOD', async () => {
  const { SigmaRendererAdapter } = await import(
    '@/features/graph-v2/renderer/SigmaRendererAdapter'
  )

  const edgeEndpoints = new Map<string, [string, string]>([
    ['A->B', ['A', 'B']],
    ['C->D', ['C', 'D']],
    ['E->F', ['E', 'F']],
  ])
  const adapter = new SigmaRendererAdapter() as unknown as EdgeReducerHarness
  let renderCalls = 0
  const baseEdge = {
    size: 1,
    color: '#64b5ff',
    hidden: false,
    label: null,
    weight: 1,
    isDimmed: false,
    touchesFocus: false,
    zIndex: 1,
  }
  const focusedEdge = {
    ...baseEdge,
    touchesFocus: true,
    zIndex: 6,
  }

  adapter.sigma = {
    getGraph: () => ({
      hasEdge: (edgeId) => edgeEndpoints.has(edgeId),
      source: (edgeId) => edgeEndpoints.get(edgeId)?.[0] ?? '',
      target: (edgeId) => edgeEndpoints.get(edgeId)?.[1] ?? '',
    }),
  }
  adapter.draggedNodePubkey = 'A'
  adapter.currentHoverFocus = {
    pubkey: 'A',
    neighbors: new Set(['B']),
  }
  adapter.safeRender = () => {
    renderCalls += 1
  }

  adapter.setHideConnectionsForLowPerformance(true)
  adapter.setHideConnectionsForLowPerformance(true)
  const draggedEdge = adapter.edgeReducer('A->B', baseEdge)
  adapter.draggedNodePubkey = null
  const focused = adapter.edgeReducer('E->F', focusedEdge)
  const hidden = adapter.edgeReducer('C->D', baseEdge)
  adapter.setHideConnectionsForLowPerformance(false)
  const visible = adapter.edgeReducer('A->B', baseEdge)

  assert.equal(draggedEdge.hidden, false)
  assert.ok(draggedEdge.size > baseEdge.size)
  assert.equal(focused.hidden, false)
  assert.equal(focused.touchesFocus, true)
  assert.equal(hidden.hidden, true)
  assert.equal(visible.hidden, false)
  assert.equal(renderCalls, 2)
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

test('node hover focus waits for the dwell delay before applying highlight', async () => {
  const restoreAnimationFrame = installAnimationFrameStub()
  const { SigmaRendererAdapter } = await import(
    '@/features/graph-v2/renderer/SigmaRendererAdapter'
  )

  try {
    const hoverEvents: Array<string | null> = []
    const adapter = new SigmaRendererAdapter() as unknown as {
      callbacks: GraphInteractionCallbacks | null
      hoveredNodePubkey: string | null
      currentHoverFocus: { pubkey: string | null; neighbors: Set<string> }
      scheduleHoveredNodeFocus: (pubkey: string) => void
      clearHoveredNodeFocus: () => void
      safeRefresh: () => void
    }
    adapter.callbacks = {
      ...createCallbacks(() => {}),
      onNodeHover: (pubkey) => {
        hoverEvents.push(pubkey)
      },
    }
    adapter.safeRefresh = () => {}

    adapter.scheduleHoveredNodeFocus('alice')

    assert.equal(adapter.hoveredNodePubkey, null)
    assert.equal(adapter.currentHoverFocus.pubkey, null)
    assert.deepEqual(hoverEvents, [])

    await wait(520)

    assert.equal(adapter.hoveredNodePubkey, 'alice')
    assert.equal(adapter.currentHoverFocus.pubkey, 'alice')
    assert.deepEqual(hoverEvents, ['alice'])

    adapter.clearHoveredNodeFocus()
  } finally {
    restoreAnimationFrame()
  }
})

test('node hover focus cancels when the pointer leaves before dwell', async () => {
  const restoreAnimationFrame = installAnimationFrameStub()
  const { SigmaRendererAdapter } = await import(
    '@/features/graph-v2/renderer/SigmaRendererAdapter'
  )

  try {
    const hoverEvents: Array<string | null> = []
    const adapter = new SigmaRendererAdapter() as unknown as {
      callbacks: GraphInteractionCallbacks | null
      hoveredNodePubkey: string | null
      currentHoverFocus: { pubkey: string | null; neighbors: Set<string> }
      scheduleHoveredNodeFocus: (pubkey: string) => void
      clearHoveredNodeFocus: () => void
      safeRefresh: () => void
    }
    adapter.callbacks = {
      ...createCallbacks(() => {}),
      onNodeHover: (pubkey) => {
        hoverEvents.push(pubkey)
      },
    }
    adapter.safeRefresh = () => {}

    adapter.scheduleHoveredNodeFocus('alice')
    adapter.clearHoveredNodeFocus()
    await wait(520)

    assert.equal(adapter.hoveredNodePubkey, null)
    assert.equal(adapter.currentHoverFocus.pubkey, null)
    assert.deepEqual(hoverEvents, [])
  } finally {
    restoreAnimationFrame()
  }
})

test('double click on a node prevents Sigma zoom and forwards the interaction', async () => {
  const { SigmaRendererAdapter } = await import(
    '@/features/graph-v2/renderer/SigmaRendererAdapter'
  )

  const originalWindow = globalThis.window
  const listeners = new Map<string, (event: unknown) => void>()
  const doubleClicks: string[] = []
  let prevented = 0

  const adapter = new SigmaRendererAdapter() as unknown as {
    sigma: {
      on: (eventName: string, listener: (event: unknown) => void) => void
      getCamera: () => {
        on: (eventName: string, listener: (event: unknown) => void) => void
      }
    } | null
    renderStore: Record<string, never> | null
    physicsStore: Record<string, never> | null
    callbacks: GraphInteractionCallbacks | null
    bindEvents: () => void
  }

  globalThis.window = {
    addEventListener: () => {},
    removeEventListener: () => {},
  } as Window & typeof globalThis

  try {
    adapter.sigma = {
      on: (eventName, listener) => {
        listeners.set(eventName, listener)
      },
      getCamera: () => ({
        on: () => {},
      }),
    }
    adapter.renderStore = {}
    adapter.physicsStore = {}
    adapter.callbacks = {
      ...createCallbacks(() => {}),
      onNodeDoubleClick: (pubkey) => {
        doubleClicks.push(pubkey)
      },
    }

    adapter.bindEvents()

    listeners.get('doubleClickNode')?.({
      node: 'alice',
      preventSigmaDefault: () => {
        prevented += 1
      },
    })

    assert.equal(prevented, 1)
    assert.deepEqual(doubleClicks, ['alice'])
  } finally {
    globalThis.window = originalWindow
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
