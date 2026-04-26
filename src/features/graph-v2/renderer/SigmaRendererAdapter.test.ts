import assert from 'node:assert/strict'
import test from 'node:test'

import { createDragNeighborhoodInfluenceState } from '@/features/graph-v2/renderer/dragInfluence'
import {
  NodePositionLedger,
  PhysicsGraphStore,
  RenderGraphStore,
  type RenderEdgeAttributes,
  type RenderNodeAttributes,
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

test('sigma settings disable camera rotation while keeping regular camera controls available', async () => {
  const originalWebGL2RenderingContext = globalThis.WebGL2RenderingContext
  const originalWebGLRenderingContext = globalThis.WebGLRenderingContext
  globalThis.WebGL2RenderingContext ??= class {} as typeof WebGL2RenderingContext
  globalThis.WebGLRenderingContext ??= class {} as typeof WebGLRenderingContext

  const { SigmaRendererAdapter } = await import(
    '@/features/graph-v2/renderer/SigmaRendererAdapter'
  )
  try {
    const adapter = new SigmaRendererAdapter() as unknown as {
      createSigmaSettings: () => {
        autoCenter?: boolean
        autoRescale?: boolean
        enableCameraRotation?: boolean
        enableCameraPanning?: boolean
        enableCameraZooming?: boolean
      }
    }

    const settings = adapter.createSigmaSettings()

    assert.equal(settings.autoCenter, false)
    assert.equal(settings.autoRescale, false)
    assert.equal(settings.enableCameraRotation, false)
    assert.equal(settings.enableCameraPanning, undefined)
    assert.equal(settings.enableCameraZooming, undefined)
  } finally {
    globalThis.WebGL2RenderingContext = originalWebGL2RenderingContext
    globalThis.WebGLRenderingContext = originalWebGLRenderingContext
  }
})

test('forced node labels survive renderer hover and idle label pruning', async () => {
  const { SigmaRendererAdapter } = await import(
    '@/features/graph-v2/renderer/SigmaRendererAdapter'
  )
  const adapter = new SigmaRendererAdapter() as unknown as {
    sigma: {
      getCamera: () => { ratio: number }
    }
    resolveNodeHoverAttributes: (
      node: string,
      data: RenderNodeAttributes,
      focus: { pubkey: string | null; neighbors: Set<string> },
    ) => RenderNodeAttributes
  }
  const forcedLabelNode: RenderNodeAttributes = {
    x: 0,
    y: 0,
    size: 10,
    color: '#fff',
    focusState: 'idle',
    label: '2',
    hidden: false,
    highlighted: false,
    forceLabel: true,
    fixed: false,
    pictureUrl: null,
    isExpanding: false,
    expansionProgress: null,
    isDimmed: false,
    isSelected: false,
    isNeighbor: false,
    isRoot: false,
    isPinned: false,
    zIndex: 0,
  }

  adapter.sigma = {
    getCamera: () => ({ ratio: 1 }),
  }

  const idleNode = adapter.resolveNodeHoverAttributes('alice', forcedLabelNode, {
    pubkey: null,
    neighbors: new Set(),
  })
  const dimmedNode = adapter.resolveNodeHoverAttributes('alice', forcedLabelNode, {
    pubkey: 'root',
    neighbors: new Set(),
  })

  assert.equal(idleNode.label, '2')
  assert.equal(idleNode.forceLabel, true)
  assert.equal(dimmedNode.label, '2')
  assert.equal(dimmedNode.forceLabel, true)
})

test('touch taps tolerate small finger drift when selecting nodes', async () => {
  const originalWebGL2RenderingContext = globalThis.WebGL2RenderingContext
  const originalWebGLRenderingContext = globalThis.WebGLRenderingContext
  globalThis.WebGL2RenderingContext ??= class {} as typeof WebGL2RenderingContext
  globalThis.WebGLRenderingContext ??= class {} as typeof WebGLRenderingContext

  const { SigmaRendererAdapter } = await import(
    '@/features/graph-v2/renderer/SigmaRendererAdapter'
  )
  try {
    let appliedSettings: { tapMoveTolerance?: number; inertiaDuration?: number } | null = null
    const adapter = new SigmaRendererAdapter() as unknown as {
      configureTouchInteraction: (sigma: {
        getTouchCaptor: () => {
          setSettings: (settings: { tapMoveTolerance?: number; inertiaDuration?: number }) => void
          on: () => void
        }
        getSetting: (key: string) => number
      }) => void
    }

    adapter.configureTouchInteraction({
      getTouchCaptor: () => ({
        setSettings: (settings) => {
          appliedSettings = settings
        },
        on: () => undefined,
      }),
      getSetting: (key) => {
        if (key === 'tapMoveTolerance') return 4
        if (key === 'dragTimeout') return 200
        if (key === 'doubleClickTimeout') return 300
        return 1
      },
    })

    assert.equal(appliedSettings?.tapMoveTolerance, 16)
    assert.equal(appliedSettings?.inertiaDuration, 0)
  } finally {
    globalThis.WebGL2RenderingContext = originalWebGL2RenderingContext
    globalThis.WebGLRenderingContext = originalWebGLRenderingContext
  }
})

test('touch camera movement drives Sigma hide-edges-on-move signal', async () => {
  const originalWebGL2RenderingContext = globalThis.WebGL2RenderingContext
  const originalWebGLRenderingContext = globalThis.WebGLRenderingContext
  globalThis.WebGL2RenderingContext ??= class {} as typeof WebGL2RenderingContext
  globalThis.WebGLRenderingContext ??= class {} as typeof WebGLRenderingContext

  const { SigmaRendererAdapter } = await import(
    '@/features/graph-v2/renderer/SigmaRendererAdapter'
  )
  try {
    const mouseCaptor = { isMoving: false }
    let renderCalls = 0
    const adapter = new SigmaRendererAdapter() as unknown as {
      sigma: {
        getMouseCaptor: () => { isMoving: boolean }
      }
      safeRender: () => void
      handleTouchMove: (event: {
        touches: Array<{ x: number; y: number }>
        previousTouches: Array<{ x: number; y: number }>
        preventSigmaDefault: () => void
      }) => void
      touchCameraMotionClearTimer: ReturnType<typeof setTimeout> | null
    }

    adapter.sigma = {
      getMouseCaptor: () => mouseCaptor,
    }
    adapter.safeRender = () => {
      renderCalls += 1
    }

    adapter.handleTouchMove({
      previousTouches: [{ x: 10, y: 10 }],
      touches: [{ x: 20, y: 10 }],
      preventSigmaDefault: () => {},
    })

    assert.equal(mouseCaptor.isMoving, true)
    assert.equal(renderCalls, 0)

    await wait(160)

    assert.equal(mouseCaptor.isMoving, false)
    assert.equal(renderCalls, 1)
    assert.equal(adapter.touchCameraMotionClearTimer, null)
  } finally {
    globalThis.WebGL2RenderingContext = originalWebGL2RenderingContext
    globalThis.WebGLRenderingContext = originalWebGLRenderingContext
  }
})

test('graph updates do not fit the camera automatically', async () => {
  const { SigmaRendererAdapter } = await import(
    '@/features/graph-v2/renderer/SigmaRendererAdapter'
  )

  let fitCalls = 0
  let refreshCalls = 0
  const scene = createScene()
  const previousScene: GraphSceneSnapshot = {
    ...scene,
    render: {
      ...scene.render,
      nodes: [],
      cameraHint: {
        focusPubkey: null,
        rootPubkey: null,
      },
    },
    physics: {
      ...scene.physics,
      nodes: [],
    },
  }
  const adapter = new SigmaRendererAdapter() as unknown as {
    sigma: Record<string, never>
    scene: GraphSceneSnapshot
    renderStore: { applyScene: (scene: GraphSceneSnapshot['render']) => void }
    physicsStore: {
      applyScene: (scene: GraphSceneSnapshot['physics']) => { topologyChanged: boolean }
    }
    forceRuntime: { sync: (scene: GraphSceneSnapshot['physics'], options?: { topologyChanged: boolean }) => void }
    nodeHitTester: { markDirty: () => void }
    ensurePhysicsPositionBridge: () => void
    startSceneFocusTransition: (transition: null) => void
    fitCameraToGraph: () => boolean
    safeRefresh: () => void
    update: (scene: GraphSceneSnapshot) => void
  }

  adapter.sigma = {}
  adapter.scene = previousScene
  adapter.renderStore = { applyScene: () => {} }
  adapter.physicsStore = {
    applyScene: () => ({ topologyChanged: true }),
  }
  adapter.forceRuntime = { sync: () => {} }
  adapter.nodeHitTester = { markDirty: () => {} }
  adapter.ensurePhysicsPositionBridge = () => {}
  adapter.startSceneFocusTransition = () => {}
  adapter.fitCameraToGraph = () => {
    fitCalls += 1
    return true
  }
  adapter.safeRefresh = () => {
    refreshCalls += 1
  }

  adapter.update(scene)

  assert.equal(fitCalls, 0)
  assert.equal(refreshCalls, 1)
})

test('natural touch zoom ignores two-finger rotation and keeps the pinch centered', async () => {
  const originalWebGL2RenderingContext = globalThis.WebGL2RenderingContext
  const originalWebGLRenderingContext = globalThis.WebGLRenderingContext
  globalThis.WebGL2RenderingContext ??= class {} as typeof WebGL2RenderingContext
  globalThis.WebGLRenderingContext ??= class {} as typeof WebGLRenderingContext

  const { SigmaRendererAdapter } = await import(
    '@/features/graph-v2/renderer/SigmaRendererAdapter'
  )
  try {
    const cameraState = { x: 0, y: 0, ratio: 1, angle: 0 }
    const states: Array<{ x: number; y: number; ratio: number; angle: number }> = []
    const adapter = new SigmaRendererAdapter() as unknown as {
      sigma: {
        getCamera: () => {
          getState: () => { x: number; y: number; ratio: number; angle: number }
          getBoundedRatio: (ratio: number) => number
          setState: (state: { x: number; y: number; ratio: number; angle: number }) => void
        }
        viewportToFramedGraph: (
          point: { x: number; y: number },
          options?: { cameraState?: { x: number; y: number; ratio: number; angle: number } },
        ) => { x: number; y: number }
        getViewportZoomedState: (
          point: { x: number; y: number },
          ratio: number,
        ) => { x: number; y: number; ratio: number; angle: number }
      }
      handleNaturalTouchZoom: (event: {
        touches: Array<{ x: number; y: number }>
        previousTouches: Array<{ x: number; y: number }>
        preventSigmaDefault: () => void
      }) => void
    }
    const toGraph = (
      point: { x: number; y: number },
      state = cameraState,
    ) => ({
      x: state.x + ((point.x - 500) * state.ratio) / 100,
      y: state.y + ((point.y - 400) * state.ratio) / 100,
    })
    const zoomAround = (point: { x: number; y: number }, ratio: number) => {
      const focus = toGraph(point)
      const center = toGraph({ x: 500, y: 400 })
      const ratioDiff = ratio / cameraState.ratio
      return {
        angle: cameraState.angle,
        x: (focus.x - center.x) * (1 - ratioDiff) + cameraState.x,
        y: (focus.y - center.y) * (1 - ratioDiff) + cameraState.y,
        ratio,
      }
    }

    adapter.sigma = {
      getCamera: () => ({
        getState: () => cameraState,
        getBoundedRatio: (ratio: number) => ratio,
        setState: (state) => {
          states.push(state)
        },
      }),
      viewportToFramedGraph: (point, options) =>
        toGraph(point, options?.cameraState ?? cameraState),
      getViewportZoomedState: zoomAround,
    }

    let prevented = 0
    adapter.handleNaturalTouchZoom({
      previousTouches: [
        { x: 450, y: 400 },
        { x: 550, y: 400 },
      ],
      touches: [
        { x: 500, y: 300 },
        { x: 500, y: 500 },
      ],
      preventSigmaDefault: () => {
        prevented += 1
      },
    })

    assert.equal(prevented, 1)
    assert.equal(states.length, 1)
    assert.equal(states[0]?.ratio, 0.5)
    assert.equal(states[0]?.angle, 0)
    assert.equal(states[0]?.x, 0)
    assert.equal(states[0]?.y, 0)
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

test('fitCameraToGraph frames the visible rendered nodes', async () => {
  const { SigmaRendererAdapter } = await import(
    '@/features/graph-v2/renderer/SigmaRendererAdapter'
  )

  const animatedStates: Array<{ x: number; y: number; ratio: number; angle: number }> = []
  const adapter = new SigmaRendererAdapter() as unknown as {
    sigma: {
      getDimensions: () => { width: number; height: number }
      getCamera: () => {
        getState: () => { x: number; y: number; ratio: number; angle: number }
        getBoundedRatio: (ratio: number) => number
        animate: (
          state: { x: number; y: number; ratio: number; angle: number },
          options: { duration: number },
        ) => Promise<void>
      }
      graphToViewport: (
        point: { x: number; y: number },
        options?: { cameraState?: { x: number; y: number; ratio: number; angle: number } },
      ) => { x: number; y: number }
      viewportToFramedGraph: (
        point: { x: number; y: number },
        options?: { cameraState?: { x: number; y: number; ratio: number; angle: number } },
      ) => { x: number; y: number }
    }
    renderStore: {
      getGraph: () => {
        order: number
        forEachNode: (
          callback: (
            pubkey: string,
            attrs: { x: number; y: number; hidden?: boolean },
          ) => void,
        ) => void
      }
    }
    fitCameraToGraph: () => boolean
  }
  const currentCameraState = { x: 0, y: 0, ratio: 1, angle: 0 }
  const toViewport = (
    point: { x: number; y: number },
    cameraState = currentCameraState,
  ) => ({
    x: 500 + ((point.x - cameraState.x) * 100) / cameraState.ratio,
    y: 400 + ((point.y - cameraState.y) * 100) / cameraState.ratio,
  })
  const toGraph = (
    point: { x: number; y: number },
    cameraState = currentCameraState,
  ) => ({
    x: cameraState.x + ((point.x - 500) * cameraState.ratio) / 100,
    y: cameraState.y + ((point.y - 400) * cameraState.ratio) / 100,
  })

  adapter.sigma = {
    getDimensions: () => ({ width: 1000, height: 800 }),
    getCamera: () => ({
      getState: () => currentCameraState,
      getBoundedRatio: (ratio) => ratio,
      animate: (state) => {
        animatedStates.push(state)
        return Promise.resolve()
      },
    }),
    graphToViewport: (point, options) =>
      toViewport(point, options?.cameraState ?? currentCameraState),
    viewportToFramedGraph: (point, options) =>
      toGraph(point, options?.cameraState ?? currentCameraState),
  }
  adapter.renderStore = {
    getGraph: () => ({
      order: 3,
      forEachNode: (callback) => {
        callback('A', { x: -5, y: -2 })
        callback('B', { x: 5, y: 2 })
        callback('hidden-far-away', { x: 100, y: 100, hidden: true })
      },
    }),
  }

  assert.equal(adapter.fitCameraToGraph(), true)

  assert.equal(animatedStates.length, 1)
  assert.equal(animatedStates[0].x, 0)
  assert.equal(animatedStates[0].y, 0)
  assert.equal(animatedStates[0].angle, 0)
  assert.equal(animatedStates[0].ratio, 1000 / 760)
})

test('fitCameraToGraph does nothing when there are no measurable visible nodes', async () => {
  const { SigmaRendererAdapter } = await import(
    '@/features/graph-v2/renderer/SigmaRendererAdapter'
  )

  let animated = false
  let reset = false
  const adapter = new SigmaRendererAdapter() as unknown as {
    sigma: {
      getDimensions: () => { width: number; height: number }
      getCamera: () => {
        animatedReset: (options: { duration: number }) => Promise<void>
        animate: (
          state: { x: number; y: number; ratio: number; angle: number },
          options: { duration: number },
        ) => Promise<void>
      }
    }
    renderStore: {
      getGraph: () => {
        order: number
        forEachNode: (
          callback: (
            pubkey: string,
            attrs: { x: number; y: number; hidden?: boolean },
          ) => void,
        ) => void
      }
    }
    fitCameraToGraph: () => boolean
  }

  adapter.sigma = {
    getDimensions: () => ({ width: 1000, height: 800 }),
    getCamera: () => ({
      animatedReset: () => {
        reset = true
        return Promise.resolve()
      },
      animate: () => {
        animated = true
        return Promise.resolve()
      },
    }),
  }
  adapter.renderStore = {
    getGraph: () => ({
      order: 2,
      forEachNode: (callback) => {
        callback('hidden', { x: 0, y: 0, hidden: true })
        callback('not-ready', { x: Number.NaN, y: Number.NaN })
      },
    }),
  }

  assert.equal(adapter.fitCameraToGraph(), false)
  assert.equal(animated, false)
  assert.equal(reset, false)
})

test('fitCameraToGraphAfterPhysicsSettles waits for layout settle before fitting', async () => {
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame
  const frames = new Map<number, FrameRequestCallback>()
  let nextFrameHandle = 1
  const runNextFrame = (timestampMs: number) => {
    const next = frames.entries().next().value as
      | [number, FrameRequestCallback]
      | undefined
    if (!next) {
      return false
    }
    const [handle, callback] = next
    frames.delete(handle)
    callback(timestampMs)
    return true
  }

  globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    const handle = nextFrameHandle
    nextFrameHandle += 1
    frames.set(handle, callback)
    return handle
  }) as typeof requestAnimationFrame
  globalThis.cancelAnimationFrame = ((handle: number) => {
    frames.delete(handle)
  }) as typeof cancelAnimationFrame

  try {
    const { SigmaRendererAdapter } = await import(
      '@/features/graph-v2/renderer/SigmaRendererAdapter'
    )

    let running = true
    let settleSyncs = 0
    let fitCalls = 0
    const adapter = new SigmaRendererAdapter() as unknown as {
      forceRuntime: { isRunning: () => boolean; isSuspended: () => boolean }
      flushPhysicsPositionBridge: () => void
      fitCameraToGraph: () => boolean
      fitCameraToGraphAfterPhysicsSettles: () => void
    }

    adapter.forceRuntime = {
      isRunning: () => running,
      isSuspended: () => false,
    }
    adapter.flushPhysicsPositionBridge = () => {
      settleSyncs += 1
    }
    adapter.fitCameraToGraph = () => {
      fitCalls += 1
      return true
    }

    adapter.fitCameraToGraphAfterPhysicsSettles()

    assert.equal(runNextFrame(0), true)
    assert.equal(settleSyncs, 0)
    assert.equal(fitCalls, 0)

    assert.equal(runNextFrame(60), true)
    assert.equal(settleSyncs, 0)
    assert.equal(fitCalls, 0)

    assert.equal(runNextFrame(120), true)
    assert.equal(settleSyncs, 0)
    assert.equal(fitCalls, 0)

    running = false
    assert.equal(runNextFrame(180), true)
    assert.equal(settleSyncs, 1)
    assert.equal(fitCalls, 0)

    assert.equal(runNextFrame(196), true)
    assert.equal(fitCalls, 0)

    assert.equal(runNextFrame(212), true)

    assert.equal(settleSyncs, 1)
    assert.equal(fitCalls, 1)
  } finally {
    frames.clear()
    globalThis.requestAnimationFrame = originalRequestAnimationFrame
    globalThis.cancelAnimationFrame = originalCancelAnimationFrame
  }
})

test('fitCameraToGraphWhilePhysicsSettles fits repeatedly until layout settle', async () => {
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame
  const frames = new Map<number, FrameRequestCallback>()
  let nextFrameHandle = 1
  const runNextFrame = (timestampMs: number) => {
    const next = frames.entries().next().value as
      | [number, FrameRequestCallback]
      | undefined
    if (!next) {
      return false
    }
    const [handle, callback] = next
    frames.delete(handle)
    callback(timestampMs)
    return true
  }

  globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    const handle = nextFrameHandle
    nextFrameHandle += 1
    frames.set(handle, callback)
    return handle
  }) as typeof requestAnimationFrame
  globalThis.cancelAnimationFrame = ((handle: number) => {
    frames.delete(handle)
  }) as typeof cancelAnimationFrame

  try {
    const { SigmaRendererAdapter } = await import(
      '@/features/graph-v2/renderer/SigmaRendererAdapter'
    )

    let running = true
    let settleSyncs = 0
    let fitCalls = 0
    const adapter = new SigmaRendererAdapter() as unknown as {
      forceRuntime: { isRunning: () => boolean; isSuspended: () => boolean }
      flushPhysicsPositionBridge: () => void
      fitCameraToGraph: () => boolean
      fitCameraToGraphWhilePhysicsSettles: () => void
    }

    adapter.forceRuntime = {
      isRunning: () => running,
      isSuspended: () => false,
    }
    adapter.flushPhysicsPositionBridge = () => {
      settleSyncs += 1
    }
    adapter.fitCameraToGraph = () => {
      fitCalls += 1
      return true
    }

    adapter.fitCameraToGraphWhilePhysicsSettles()

    assert.equal(runNextFrame(0), true)
    assert.equal(settleSyncs, 0)
    assert.equal(fitCalls, 1)

    assert.equal(runNextFrame(60), true)
    assert.equal(settleSyncs, 0)
    assert.equal(fitCalls, 1)

    assert.equal(runNextFrame(120), true)
    assert.equal(settleSyncs, 0)
    assert.equal(fitCalls, 2)

    running = false
    assert.equal(runNextFrame(180), true)
    assert.equal(settleSyncs, 1)
    assert.equal(fitCalls, 2)

    assert.equal(runNextFrame(196), true)
    assert.equal(fitCalls, 2)

    assert.equal(runNextFrame(212), true)

    assert.equal(settleSyncs, 1)
    assert.equal(fitCalls, 3)
  } finally {
    frames.clear()
    globalThis.requestAnimationFrame = originalRequestAnimationFrame
    globalThis.cancelAnimationFrame = originalCancelAnimationFrame
  }
})

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
  lastScheduledGraphPosition: { x: number; y: number } | null
  dragAnchorOffset: { dx: number; dy: number }
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
  draggedNodeFocus: { pubkey: string | null; neighbors: Set<string> }
  currentHoverFocus: { pubkey: string | null; neighbors: Set<string> }
  selectedSceneFocus: { pubkey: string | null; neighbors: Set<string> }
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
    adapter.lastScheduledGraphPosition = { x: 40, y: 0 }
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

test('node drag preserves the original pointer anchor instead of snapping to cursor center', async () => {
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
    renderStore.applyScene(scene.render)
    physicsStore.applyScene(scene.physics)
    renderStore.setNodePosition('A', 40, 10)
    physicsStore.setNodePosition('A', 40, 10, true)

    const dragMoves: Array<{ x: number; y: number }> = []
    let renderCalls = 0
    const adapter = new SigmaRendererAdapter() as unknown as DragHarness

    adapter.sigma = {
      refresh: () => {},
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
    adapter.lastDragGraphPosition = { x: 40, y: 10 }
    adapter.pendingGraphPosition = { x: 47, y: 16 }
    adapter.lastScheduledGraphPosition = { x: 47, y: 16 }
    adapter.dragAnchorOffset = { dx: -5, dy: -2 }
    adapter.dragInfluenceState = null
    adapter.syncPhysicsPositionsToRender = () => false

    adapter.flushPendingDragFrame()

    assert.deepEqual(renderStore.getNodePosition('A'), { x: 42, y: 14 })
    assert.deepEqual(physicsStore.getNodePosition('A'), { x: 42, y: 14 })
    assert.deepEqual(adapter.lastDragGraphPosition, { x: 42, y: 14 })
    assert.deepEqual(dragMoves, [{ x: 42, y: 14 }])
    assert.equal(renderCalls, 1)
  } finally {
    globalThis.WebGL2RenderingContext = originalWebGL2RenderingContext
    globalThis.WebGLRenderingContext = originalWebGLRenderingContext
  }
})

test('scene updates preserve a pending node drag position instead of restoring the previous frame', async () => {
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
    renderStore.applyScene(scene.render)
    physicsStore.applyScene(scene.physics)
    renderStore.setNodePosition('A', 40, 10)
    physicsStore.setNodePosition('A', 40, 10, true)

    let refreshCalls = 0
    let syncCalls = 0
    let bridgeEnsures = 0
    let dirtyMarks = 0
    const adapter = new SigmaRendererAdapter() as unknown as DragHarness & {
      scene: GraphSceneSnapshot | null
      forceRuntime: {
        sync: (
          _scene: GraphSceneSnapshot['physics'],
          _options: { topologyChanged: boolean },
        ) => void
      }
      nodeHitTester: { markDirty: () => void }
      ensurePhysicsPositionBridge: () => void
      safeRefresh: () => void
      update: (_scene: GraphSceneSnapshot) => void
    }

    adapter.sigma = {
      refresh: () => {},
      scheduleRender: () => {},
    }
    adapter.container = {
      offsetWidth: 800,
      offsetHeight: 600,
    }
    adapter.scene = scene
    adapter.positionLedger = ledger
    adapter.renderStore = renderStore
    adapter.physicsStore = physicsStore
    adapter.callbacks = createCallbacks(() => {})
    adapter.draggedNodePubkey = 'A'
    adapter.lastDragGraphPosition = { x: 40, y: 10 }
    adapter.pendingGraphPosition = { x: 47, y: 16 }
    adapter.lastScheduledGraphPosition = { x: 47, y: 16 }
    adapter.dragAnchorOffset = { dx: -5, dy: -2 }
    adapter.dragInfluenceState = null
    adapter.forceRuntime = {
      sync: () => {
        syncCalls += 1
      },
    }
    adapter.nodeHitTester = {
      markDirty: () => {
        dirtyMarks += 1
      },
    }
    adapter.ensurePhysicsPositionBridge = () => {
      bridgeEnsures += 1
    }
    adapter.safeRefresh = () => {
      refreshCalls += 1
    }

    adapter.update(scene)

    assert.deepEqual(renderStore.getNodePosition('A'), { x: 42, y: 14 })
    assert.deepEqual(physicsStore.getNodePosition('A'), { x: 42, y: 14 })
    assert.equal(syncCalls, 1)
    assert.equal(bridgeEnsures, 1)
    assert.equal(refreshCalls, 1)
    assert.equal(dirtyMarks, 2)
  } finally {
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
  const fixedUpdates: Array<{ pubkey: string; pinned: boolean }> = []
  const dragEnds: Array<{
    position: { x: number; y: number }
    options?: { pinNode?: boolean }
  }> = []

  const adapter = new SigmaRendererAdapter() as unknown as {
    draggedNodePubkey: string | null
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
    setNodeFixed: (pubkey, pinned) => {
      fixedUpdates.push({ pubkey, pinned })
    },
  }
  adapter.callbacks = {
    onNodeClick: () => {},
    onNodeDoubleClick: () => {},
    onClearSelection: () => {},
    onNodeHover: () => {},
    onNodeDragStart: () => {},
    onNodeDragMove: () => {},
    onNodeDragEnd: (_pubkey, position, options) => {
      dragEnds.push({ position, options })
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
  assert.deepEqual(fixedUpdates, [{ pubkey: 'alice', pinned: false }])
  assert.deepEqual(dragEnds, [
    { position: { x: 10, y: 20 }, options: { pinNode: false } },
  ])
})

test('node drag temporarily keeps Sigma edge rendering enabled for first-order connections', async () => {
  const { SigmaRendererAdapter } = await import(
    '@/features/graph-v2/renderer/SigmaRendererAdapter'
  )

  const scene = createScene()
  const ledger = new NodePositionLedger()
  const renderStore = new RenderGraphStore(ledger)
  const physicsStore = new PhysicsGraphStore(ledger)
  renderStore.applyScene(scene.render)
  physicsStore.applyScene(scene.physics)

  let hideEdgesOnMove = true
  const hideEdgesOnMoveUpdates: boolean[] = []
  let customBBoxUpdates = 0
  let dragStarts = 0
  const dragEnds: Array<{
    position: { x: number; y: number }
    options?: { pinNode?: boolean }
  }> = []
  const adapter = new SigmaRendererAdapter() as unknown as {
    sigma: {
      getSetting: (key: 'hideEdgesOnMove') => boolean
      setSetting: (key: 'hideEdgesOnMove', value: boolean) => void
      getBBox: () => { x: [number, number]; y: [number, number] }
      setCustomBBox: (_bbox: { x: [number, number]; y: [number, number] } | null) => void
      getCamera: () => { disable: () => void; enable: () => void }
    }
    container: Pick<HTMLElement, 'offsetWidth' | 'offsetHeight'>
    scene: GraphSceneSnapshot
    renderStore: RenderGraphStore
    physicsStore: PhysicsGraphStore
    callbacks: GraphInteractionCallbacks
    forceRuntime: {
      isRunning: () => boolean
      isSuspended: () => boolean
      suspend: () => void
      resume: (_options?: { invalidateConvergence?: boolean }) => void
    }
    ensurePhysicsPositionBridge: () => void
    safeRender: () => void
    flushPendingDragFrame: () => void
    startHighlightTransition: () => void
    startDrag: (pubkey: string) => void
    releaseDrag: () => void
  }

  adapter.sigma = {
    getSetting: () => hideEdgesOnMove,
    setSetting: (_key, value) => {
      hideEdgesOnMove = value
      hideEdgesOnMoveUpdates.push(value)
    },
    getBBox: () => ({ x: [0, 1], y: [0, 1] }),
    setCustomBBox: () => {
      customBBoxUpdates += 1
    },
    getCamera: () => ({
      disable: () => {},
      enable: () => {},
    }),
  }
  adapter.container = {
    offsetWidth: 800,
    offsetHeight: 600,
  }
  adapter.scene = scene
  adapter.renderStore = renderStore
  adapter.physicsStore = physicsStore
  adapter.callbacks = {
    onNodeClick: () => {},
    onNodeDoubleClick: () => {},
    onClearSelection: () => {},
    onNodeHover: () => {},
    onNodeDragStart: () => {
      dragStarts += 1
    },
    onNodeDragMove: () => {},
    onNodeDragEnd: (_pubkey, position, options) => {
      dragEnds.push({ position, options })
    },
    onViewportChange: () => {},
  }
  adapter.forceRuntime = {
    isRunning: () => false,
    isSuspended: () => false,
    suspend: () => {},
    resume: () => {},
  }
  adapter.ensurePhysicsPositionBridge = () => {}
  adapter.safeRender = () => {}
  adapter.flushPendingDragFrame = () => {}
  adapter.startHighlightTransition = () => {}

  adapter.startDrag('A')
  assert.equal(hideEdgesOnMove, false)
  assert.deepEqual(hideEdgesOnMoveUpdates, [false])
  assert.equal(customBBoxUpdates, 0)
  assert.equal(dragStarts, 1)

  adapter.releaseDrag()
  assert.equal(hideEdgesOnMove, true)
  assert.deepEqual(hideEdgesOnMoveUpdates, [false, true])
  assert.equal(customBBoxUpdates, 0)
  assert.equal(dragEnds.length, 1)
})

test('releaseDrag clears node focus instead of restoring hover on mobile', async () => {
  const { SigmaRendererAdapter } = await import(
    '@/features/graph-v2/renderer/SigmaRendererAdapter'
  )

  const originalWindow = globalThis.window
  let clearSelectionCalls = 0
  const hoverEvents: Array<string | null> = []
  const dragEnds: Array<{ x: number; y: number }> = []
  let renderCalls = 0

  const adapter = new SigmaRendererAdapter() as unknown as {
    draggedNodePubkey: string | null
    lastDragFlushTimestamp: number | null
    dragInfluenceState: null
    lastDragGraphPosition: null
    resumePhysicsAfterDrag: boolean
    suppressedClick: unknown
    suppressedStageClickUntil: number
    hoveredNodePubkey: string | null
    hoveredNeighbors: Set<string>
    currentHoverFocus: { pubkey: string | null; neighbors: Set<string> }
    selectedSceneFocus: { pubkey: string | null; neighbors: Set<string> }
    renderStore: { getNodePosition: (_pubkey: string) => { x: number; y: number } | null }
    physicsStore: { setNodeFixed: (_pubkey: string, _pinned: boolean) => void }
    callbacks: GraphInteractionCallbacks
    forceRuntime: {
      resume: (_options?: { invalidateConvergence?: boolean }) => void
    } | null
    scene: { render: { pins: { pubkeys: string[] } } } | null
    flushPendingDragFrame: () => void
    cancelPendingDragFrame: () => void
    ensurePhysicsPositionBridge: () => void
    setCameraLocked: (_locked: boolean) => void
    setGraphBoundsLocked: (_locked: boolean) => void
    startHighlightTransition: () => void
    safeRender: () => void
    recalculateHoverAfterDrag: () => void
    releaseDrag: (options?: { pinOnRelease?: boolean }) => void
  }

  globalThis.window = {
    matchMedia: (query: string) => ({
      matches: query === '(max-width: 720px)',
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  } as Window & typeof globalThis

  try {
    adapter.draggedNodePubkey = 'alice'
    adapter.lastDragFlushTimestamp = null
    adapter.dragInfluenceState = null
    adapter.lastDragGraphPosition = null
    adapter.resumePhysicsAfterDrag = true
    adapter.suppressedClick = null
    adapter.suppressedStageClickUntil = 0
    adapter.hoveredNodePubkey = 'alice'
    adapter.hoveredNeighbors = new Set(['bob'])
    adapter.currentHoverFocus = {
      pubkey: 'alice',
      neighbors: new Set(['bob']),
    }
    adapter.selectedSceneFocus = {
      pubkey: 'alice',
      neighbors: new Set(['bob']),
    }
    adapter.renderStore = {
      getNodePosition: () => ({ x: 10, y: 20 }),
    }
    adapter.physicsStore = {
      setNodeFixed: () => {},
    }
    adapter.callbacks = {
      onNodeClick: () => {},
      onNodeDoubleClick: () => {},
      onClearSelection: () => {
        clearSelectionCalls += 1
      },
      onNodeHover: (pubkey) => {
        hoverEvents.push(pubkey)
      },
      onNodeDragStart: () => {},
      onNodeDragMove: () => {},
      onNodeDragEnd: (_pubkey, position) => {
        dragEnds.push(position)
      },
      onViewportChange: () => {},
    }
    adapter.forceRuntime = {
      resume: () => {},
    }
    adapter.scene = {
      render: {
        pins: { pubkeys: [] },
      },
    }
    adapter.flushPendingDragFrame = () => {}
    adapter.cancelPendingDragFrame = () => {}
    adapter.ensurePhysicsPositionBridge = () => {}
    adapter.setCameraLocked = () => {}
    adapter.setGraphBoundsLocked = () => {}
    adapter.startHighlightTransition = () => {}
    adapter.safeRender = () => {
      renderCalls += 1
    }
    adapter.recalculateHoverAfterDrag = () => {
      throw new Error('mobile drag release should not restore hover focus')
    }

    adapter.releaseDrag()

    assert.equal(clearSelectionCalls, 1)
    assert.equal(adapter.hoveredNodePubkey, null)
    assert.equal(adapter.currentHoverFocus.pubkey, null)
    assert.equal(adapter.selectedSceneFocus.pubkey, null)
    assert.deepEqual(hoverEvents, [null])
    assert.deepEqual(dragEnds, [{ x: 10, y: 20 }])
    assert.equal(renderCalls, 2)
  } finally {
    globalThis.window = originalWindow
  }
})

test('forced hover refresh rebuilds neighbors when drag starts on the current hover node', async () => {
  const { SigmaRendererAdapter } = await import(
    '@/features/graph-v2/renderer/SigmaRendererAdapter'
  )

  const scene = createScene()
  const ledger = new NodePositionLedger()
  const renderStore = new RenderGraphStore(ledger)
  renderStore.applyScene({
    ...scene.render,
    visibleEdges: [
      {
        id: 'A->D',
        source: 'A',
        target: 'D',
        weight: 1,
        color: '#fff',
        size: 1,
        hidden: false,
        isDimmed: false,
        touchesFocus: true,
      },
    ],
  })

  const adapter = new SigmaRendererAdapter() as unknown as {
    hoveredNodePubkey: string | null
    hoveredNeighbors: Set<string>
    currentHoverFocus: { pubkey: string | null; neighbors: Set<string> }
    renderStore: RenderGraphStore
    startHighlightTransition: () => void
    safeRender: () => void
    setHoveredNode: (pubkey: string | null, force?: boolean) => void
  }

  adapter.hoveredNodePubkey = 'A'
  adapter.hoveredNeighbors = new Set()
  adapter.currentHoverFocus = {
    pubkey: 'A',
    neighbors: new Set(),
  }
  adapter.renderStore = renderStore
  adapter.startHighlightTransition = () => {}
  adapter.safeRender = () => {}

  adapter.setHoveredNode('A', true)

  assert.equal(adapter.currentHoverFocus.pubkey, 'A')
  assert.deepEqual(Array.from(adapter.currentHoverFocus.neighbors), ['D'])
})

test('selected node uses the same renderer focus style when no hover is active', async () => {
  const { SigmaRendererAdapter } = await import(
    '@/features/graph-v2/renderer/SigmaRendererAdapter'
  )

  const baseNode: RenderNodeAttributes = {
    x: 0,
    y: 0,
    size: 10,
    color: '#7dd3a7',
    focusState: 'idle',
    label: 'A',
    hidden: false,
    highlighted: false,
    forceLabel: false,
    fixed: false,
    pictureUrl: null,
    isExpanding: false,
    expansionProgress: null,
    isDimmed: false,
    isSelected: false,
    isNeighbor: false,
    isRoot: false,
    isPinned: false,
    zIndex: 0,
  }
  const baseEdge: RenderEdgeAttributes = {
    size: 1,
    color: '#7dd3a7',
    hidden: false,
    label: null,
    weight: 1,
    isDimmed: false,
    touchesFocus: false,
    zIndex: 1,
  }
  const edgeEndpoints = new Map<string, [string, string]>([
    ['A->B', ['A', 'B']],
    ['B->C', ['B', 'C']],
  ])
  const adapter = new SigmaRendererAdapter() as unknown as {
    sigma: {
      getCamera: () => { ratio: number }
      getGraph: () => {
        hasEdge: (_edgeId: string) => boolean
        source: (_edgeId: string) => string
        target: (_edgeId: string) => string
      }
    }
    currentHoverFocus: { pubkey: string | null; neighbors: Set<string> }
    selectedSceneFocus: { pubkey: string | null; neighbors: Set<string> }
    nodeReducer: (node: string, data: RenderNodeAttributes) => RenderNodeAttributes
    edgeReducer: (edge: string, data: RenderEdgeAttributes) => RenderEdgeAttributes
  }

  adapter.sigma = {
    getCamera: () => ({ ratio: 1 }),
    getGraph: () => ({
      hasEdge: (edgeId) => edgeEndpoints.has(edgeId),
      source: (edgeId) => edgeEndpoints.get(edgeId)![0],
      target: (edgeId) => edgeEndpoints.get(edgeId)![1],
    }),
  }
  adapter.currentHoverFocus = {
    pubkey: null,
    neighbors: new Set(),
  }
  adapter.selectedSceneFocus = {
    pubkey: 'A',
    neighbors: new Set(['B']),
  }

  const selected = adapter.nodeReducer('A', baseNode)
  const neighbor = adapter.nodeReducer('B', baseNode)
  const dimmed = adapter.nodeReducer('C', baseNode)
  const focusedEdge = adapter.edgeReducer('A->B', baseEdge)
  const dimmedEdge = adapter.edgeReducer('B->C', baseEdge)

  assert.equal(selected.color, '#f4fbff')
  assert.equal(selected.highlighted, true)
  assert.ok(selected.zIndex >= 10)
  assert.equal(neighbor.highlighted, true)
  assert.ok(neighbor.zIndex >= 8)
  assert.equal(dimmed.color, '#121a22')
  assert.equal(focusedEdge.color, '#f4fbff')
  assert.equal(focusedEdge.hidden, false)
  assert.ok(focusedEdge.size > baseEdge.size)
  assert.equal(dimmedEdge.color, '#10171f')
})

test('selection scene update applies renderer focus immediately', async () => {
  const { SigmaRendererAdapter } = await import(
    '@/features/graph-v2/renderer/SigmaRendererAdapter'
  )

  const scene = createScene()
  const selectedScene: GraphSceneSnapshot = {
    ...scene,
    render: {
      ...scene.render,
      selection: {
        ...scene.render.selection,
        selectedNodePubkey: 'A',
      },
    },
  }
  const ledger = new NodePositionLedger()
  const renderStore = new RenderGraphStore(ledger)
  renderStore.applyScene(scene.render)

  const adapter = new SigmaRendererAdapter() as unknown as {
    sigma: {
      getCamera: () => { ratio: number }
    }
    scene: GraphSceneSnapshot
    renderStore: RenderGraphStore
    physicsStore: {
      applyScene: (scene: GraphSceneSnapshot['physics']) => { topologyChanged: boolean }
    }
    forceRuntime: { sync: (scene: GraphSceneSnapshot['physics'], options?: { topologyChanged: boolean }) => void }
    nodeHitTester: { markDirty: () => void }
    ensurePhysicsPositionBridge: () => void
    safeRefresh: () => void
    highlightTransition: unknown
    nodeReducer: (node: string, data: RenderNodeAttributes) => RenderNodeAttributes
    update: (scene: GraphSceneSnapshot) => void
  }

  adapter.sigma = {
    getCamera: () => ({ ratio: 1 }),
  }
  adapter.scene = scene
  adapter.renderStore = renderStore
  adapter.physicsStore = {
    applyScene: () => ({ topologyChanged: false }),
  }
  adapter.forceRuntime = { sync: () => {} }
  adapter.nodeHitTester = { markDirty: () => {} }
  adapter.ensurePhysicsPositionBridge = () => {}
  adapter.safeRefresh = () => {}

  adapter.update(selectedScene)

  const selected = adapter.nodeReducer(
    'A',
    renderStore.getGraph().getNodeAttributes('A'),
  )

  assert.equal(adapter.highlightTransition, null)
  assert.equal(selected.color, '#f4fbff')
  assert.equal(selected.highlighted, true)
  assert.ok(selected.zIndex >= 10)
})

test('clearing hover keeps selected focus instead of flashing the graph bright', async () => {
  const { SigmaRendererAdapter } = await import(
    '@/features/graph-v2/renderer/SigmaRendererAdapter'
  )

  const baseNode: RenderNodeAttributes = {
    x: 0,
    y: 0,
    size: 10,
    color: '#7dd3a7',
    focusState: 'idle',
    label: 'C',
    hidden: false,
    highlighted: false,
    forceLabel: false,
    fixed: false,
    pictureUrl: null,
    isExpanding: false,
    expansionProgress: null,
    isDimmed: false,
    isSelected: false,
    isNeighbor: false,
    isRoot: false,
    isPinned: false,
    zIndex: 0,
  }
  const adapter = new SigmaRendererAdapter() as unknown as {
    sigma: {
      getCamera: () => { ratio: number }
    }
    currentHoverFocus: { pubkey: string | null; neighbors: Set<string> }
    selectedSceneFocus: { pubkey: string | null; neighbors: Set<string> }
    highlightTransition: {
      from: { pubkey: string | null; neighbors: Set<string> }
      to: { pubkey: string | null; neighbors: Set<string> }
      startedAt: number
      durationMs: number
    } | null
    safeRender: () => void
    setHoveredNode: (pubkey: string | null, force?: boolean) => void
    nodeReducer: (node: string, data: RenderNodeAttributes) => RenderNodeAttributes
  }

  adapter.sigma = {
    getCamera: () => ({ ratio: 1 }),
  }
  adapter.currentHoverFocus = {
    pubkey: 'A',
    neighbors: new Set(['B']),
  }
  adapter.selectedSceneFocus = {
    pubkey: 'A',
    neighbors: new Set(['B']),
  }
  adapter.highlightTransition = null
  adapter.safeRender = () => {}

  adapter.setHoveredNode(null)

  const dimmed = adapter.nodeReducer('C', baseNode)

  assert.equal(adapter.highlightTransition, null)
  assert.equal(dimmed.color, '#121a22')
  assert.equal(dimmed.highlighted, false)
  assert.ok(dimmed.zIndex < 0)
})

test('renderer focus resolves through one priority path for drag hover and selection', async () => {
  const { SigmaRendererAdapter } = await import(
    '@/features/graph-v2/renderer/SigmaRendererAdapter'
  )

  const adapter = new SigmaRendererAdapter() as unknown as {
    draggedNodePubkey: string | null
    draggedNodeFocus: { pubkey: string | null; neighbors: Set<string> }
    currentHoverFocus: { pubkey: string | null; neighbors: Set<string> }
    selectedSceneFocus: { pubkey: string | null; neighbors: Set<string> }
    resolveRendererFocus: () => {
      pubkey: string | null
      neighbors: Set<string>
    }
  }

  adapter.selectedSceneFocus = {
    pubkey: 'selected',
    neighbors: new Set(['selected-neighbor']),
  }
  adapter.currentHoverFocus = {
    pubkey: 'hovered',
    neighbors: new Set(['hovered-neighbor']),
  }
  adapter.draggedNodeFocus = {
    pubkey: 'dragged',
    neighbors: new Set(['dragged-neighbor']),
  }
  adapter.draggedNodePubkey = 'dragged'

  const dragFocus = adapter.resolveRendererFocus()
  assert.equal(dragFocus.pubkey, 'dragged')
  assert.deepEqual(Array.from(dragFocus.neighbors), ['dragged-neighbor'])

  adapter.draggedNodePubkey = null
  assert.equal(adapter.resolveRendererFocus().pubkey, 'hovered')

  adapter.currentHoverFocus = {
    pubkey: null,
    neighbors: new Set(),
  }
  const selectedFocus = adapter.resolveRendererFocus()
  assert.equal(selectedFocus.pubkey, 'selected')
  assert.deepEqual(Array.from(selectedFocus.neighbors), ['selected-neighbor'])

  adapter.selectedSceneFocus = {
    pubkey: null,
    neighbors: new Set(),
  }
  assert.equal(adapter.resolveRendererFocus().pubkey, null)
})

test('drag node focus bypasses transitions so unrelated nodes dim immediately', async () => {
  const { SigmaRendererAdapter } = await import(
    '@/features/graph-v2/renderer/SigmaRendererAdapter'
  )

  const adapter = new SigmaRendererAdapter() as unknown as {
    sigma: {
      getCamera: () => { ratio: number }
    }
    draggedNodePubkey: string | null
    draggedNodeFocus: { pubkey: string | null; neighbors: Set<string> }
    currentHoverFocus: { pubkey: string | null; neighbors: Set<string> }
    highlightTransition: {
      from: { pubkey: string | null; neighbors: Set<string> }
      to: { pubkey: string | null; neighbors: Set<string> }
      startedAt: number
      durationMs: number
    } | null
    nodeReducer: (node: string, data: RenderNodeAttributes) => RenderNodeAttributes
  }
  const baseNode: RenderNodeAttributes = {
    x: 0,
    y: 0,
    size: 10,
    color: '#7dd3a7',
    focusState: 'idle',
    label: 'C',
    hidden: false,
    highlighted: false,
    forceLabel: false,
    fixed: false,
    pictureUrl: null,
    isExpanding: false,
    expansionProgress: null,
    isDimmed: false,
    isSelected: false,
    isNeighbor: false,
    isRoot: false,
    isPinned: false,
    zIndex: 0,
  }

  adapter.sigma = {
    getCamera: () => ({ ratio: 1 }),
  }
  adapter.draggedNodePubkey = 'A'
  adapter.draggedNodeFocus = {
    pubkey: 'A',
    neighbors: new Set(['B']),
  }
  adapter.currentHoverFocus = {
    pubkey: 'A',
    neighbors: new Set(['B']),
  }
  adapter.highlightTransition = {
    from: { pubkey: null, neighbors: new Set() },
    to: { pubkey: 'A', neighbors: new Set(['B']) },
    startedAt: performance.now(),
    durationMs: 180,
  }

  const dimmed = adapter.nodeReducer('C', baseNode)

  assert.equal(dimmed.color, '#121a22')
  assert.equal(dimmed.highlighted, false)
  assert.ok(dimmed.zIndex < 0)
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

test('highlight transition frame yields to active node drag without rendering', async () => {
  const { SigmaRendererAdapter } = await import(
    '@/features/graph-v2/renderer/SigmaRendererAdapter'
  )

  let renderCalls = 0
  let rescheduleCalls = 0
  const adapter = new SigmaRendererAdapter() as unknown as {
    pendingHighlightTransitionFrame: number | null
    draggedNodePubkey: string | null
    highlightTransition: {
      from: { pubkey: string | null; neighbors: Set<string> }
      to: { pubkey: string | null; neighbors: Set<string> }
      startedAt: number
      durationMs: number
    } | null
    safeRender: () => void
    scheduleHighlightTransitionFrame: () => void
    flushHighlightTransitionFrame: () => void
  }

  adapter.pendingHighlightTransitionFrame = 1
  adapter.draggedNodePubkey = 'alice'
  adapter.highlightTransition = {
    from: { pubkey: 'alice', neighbors: new Set(['bob']) },
    to: { pubkey: 'bob', neighbors: new Set(['alice']) },
    startedAt: performance.now(),
    durationMs: 1000,
  }
  adapter.safeRender = () => {
    renderCalls += 1
  }
  adapter.scheduleHighlightTransitionFrame = () => {
    rescheduleCalls += 1
  }

  adapter.flushHighlightTransitionFrame()

  assert.equal(adapter.pendingHighlightTransitionFrame, null)
  assert.equal(adapter.highlightTransition, null)
  assert.equal(renderCalls, 0)
  assert.equal(rescheduleCalls, 0)
})

test('highlight transitions cannot start while node drag is active', async () => {
  const { SigmaRendererAdapter } = await import(
    '@/features/graph-v2/renderer/SigmaRendererAdapter'
  )

  let scheduleCalls = 0
  const adapter = new SigmaRendererAdapter() as unknown as {
    draggedNodePubkey: string | null
    highlightTransition: unknown
    scheduleHighlightTransitionFrame: () => void
    startHighlightTransition: (
      from: { pubkey: string | null; neighbors: Set<string> },
      to: { pubkey: string | null; neighbors: Set<string> },
    ) => void
  }

  adapter.draggedNodePubkey = 'alice'
  adapter.highlightTransition = null
  adapter.scheduleHighlightTransitionFrame = () => {
    scheduleCalls += 1
  }

  adapter.startHighlightTransition(
    { pubkey: null, neighbors: new Set() },
    { pubkey: 'bob', neighbors: new Set(['alice']) },
  )

  assert.equal(adapter.highlightTransition, null)
  assert.equal(scheduleCalls, 0)
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

test('edge reducer dims non first-order edges while dragging a node', async () => {
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
  adapter.draggedNodeFocus = {
    pubkey: 'A',
    neighbors: new Set(['B']),
  }
  adapter.currentHoverFocus = {
    pubkey: 'A',
    neighbors: new Set(['B']),
  }

  const firstOrder = adapter.edgeReducer('A->B', baseEdge)
  const unrelated = adapter.edgeReducer('C->D', baseEdge)

  assert.equal(firstOrder.hidden, false)
  assert.ok(firstOrder.size > baseEdge.size)
  assert.equal(unrelated.hidden, false)
  assert.equal(unrelated.color, '#10171f')
  assert.ok(unrelated.zIndex < 0)
})

test('edge reducer dims dragged-node edges whose endpoint is not in drag focus neighbors', async () => {
  const { SigmaRendererAdapter } = await import(
    '@/features/graph-v2/renderer/SigmaRendererAdapter'
  )

  const edgeEndpoints = new Map<string, [string, string]>([
    ['A->B', ['A', 'B']],
    ['A->Z', ['A', 'Z']],
  ])
  const nodePositions = new Map<string, { x: number; y: number }>([
    ['A', { x: 0, y: 0 }],
    ['B', { x: 4, y: 0 }],
    ['Z', { x: 5, y: 0 }],
  ])
  const adapter = new SigmaRendererAdapter() as unknown as EdgeReducerHarness & {
    renderStore: {
      getNodePosition: (pubkey: string) => { x: number; y: number } | null
    }
    getMinimapViewport: () => {
      minX: number
      minY: number
      maxX: number
      maxY: number
    }
  }
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
    getDimensions: () => ({ width: 100, height: 100 }),
    viewportToGraph: (point: { x: number; y: number }) => point,
  }
  adapter.renderStore = {
    getNodePosition: (pubkey) => nodePositions.get(pubkey) ?? null,
  }
  adapter.getMinimapViewport = () => ({
    minX: -10,
    minY: -10,
    maxX: 10,
    maxY: 10,
  })
  adapter.draggedNodePubkey = 'A'
  adapter.draggedNodeFocus = {
    pubkey: 'A',
    neighbors: new Set(['B']),
  }
  adapter.currentHoverFocus = {
    pubkey: 'A',
    neighbors: new Set(['B']),
  }
  adapter.selectedSceneFocus = {
    pubkey: null,
    neighbors: new Set(),
  }

  const focusedNeighbor = adapter.edgeReducer('A->B', baseEdge)
  const staleIncidentEdge = adapter.edgeReducer('A->Z', baseEdge)

  assert.equal(focusedNeighbor.hidden, false)
  assert.ok(focusedNeighbor.size > baseEdge.size)
  assert.equal(staleIncidentEdge.hidden, false)
  assert.equal(staleIncidentEdge.color, '#f4fbff')
  assert.ok(staleIncidentEdge.size > baseEdge.size)
  assert.ok(staleIncidentEdge.zIndex > baseEdge.zIndex)
})

test('edge reducer keeps dragged-node focus styling for neighbors outside the viewport', async () => {
  const { SigmaRendererAdapter } = await import(
    '@/features/graph-v2/renderer/SigmaRendererAdapter'
  )

  const edgeEndpoints = new Map<string, [string, string]>([
    ['A->B', ['A', 'B']],
    ['A->Z', ['A', 'Z']],
  ])
  const nodePositions = new Map<string, { x: number; y: number }>([
    ['A', { x: 0, y: 0 }],
    ['B', { x: 4, y: 0 }],
    ['Z', { x: 1000, y: 0 }],
  ])
  const adapter = new SigmaRendererAdapter() as unknown as EdgeReducerHarness & {
    renderStore: {
      getNodePosition: (pubkey: string) => { x: number; y: number } | null
    }
    getMinimapViewport: () => {
      minX: number
      minY: number
      maxX: number
      maxY: number
    }
  }
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
    getDimensions: () => ({ width: 100, height: 100 }),
    viewportToGraph: (point: { x: number; y: number }) => point,
  }
  adapter.renderStore = {
    getNodePosition: (pubkey) => nodePositions.get(pubkey) ?? null,
  }
  adapter.getMinimapViewport = () => ({
    minX: -10,
    minY: -10,
    maxX: 10,
    maxY: 10,
  })
  adapter.draggedNodePubkey = 'A'
  adapter.draggedNodeFocus = {
    pubkey: 'A',
    neighbors: new Set(['B', 'Z']),
  }
  adapter.currentHoverFocus = {
    pubkey: 'A',
    neighbors: new Set(['B', 'Z']),
  }
  adapter.selectedSceneFocus = {
    pubkey: null,
    neighbors: new Set(),
  }

  const visibleNeighbor = adapter.edgeReducer('A->B', baseEdge)
  const offscreenNeighbor = adapter.edgeReducer('A->Z', baseEdge)

  assert.equal(visibleNeighbor.hidden, false)
  assert.ok(visibleNeighbor.size > baseEdge.size)
  assert.equal(offscreenNeighbor.hidden, false)
  assert.ok(offscreenNeighbor.size > baseEdge.size)
})

test('edge reducer keeps dragged-node focus styling for neighbors just outside the viewport', async () => {
  const { SigmaRendererAdapter } = await import(
    '@/features/graph-v2/renderer/SigmaRendererAdapter'
  )

  const edgeEndpoints = new Map<string, [string, string]>([
    ['A->B', ['A', 'B']],
    ['A->Z', ['A', 'Z']],
  ])
  const nodePositions = new Map<string, { x: number; y: number }>([
    ['A', { x: 0, y: 0 }],
    ['B', { x: 4, y: 0 }],
    ['Z', { x: 10.3, y: 0 }],
  ])
  const adapter = new SigmaRendererAdapter() as unknown as EdgeReducerHarness & {
    renderStore: {
      getNodePosition: (pubkey: string) => { x: number; y: number } | null
    }
    getMinimapViewport: () => {
      minX: number
      minY: number
      maxX: number
      maxY: number
    }
  }
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
    getDimensions: () => ({ width: 100, height: 100 }),
    viewportToGraph: (point: { x: number; y: number }) => point,
  }
  adapter.renderStore = {
    getNodePosition: (pubkey) => nodePositions.get(pubkey) ?? null,
  }
  adapter.getMinimapViewport = () => ({
    minX: -10,
    minY: -10,
    maxX: 10,
    maxY: 10,
  })
  adapter.draggedNodePubkey = 'A'
  adapter.draggedNodeFocus = {
    pubkey: 'A',
    neighbors: new Set(['B', 'Z']),
  }
  adapter.currentHoverFocus = {
    pubkey: 'A',
    neighbors: new Set(['B', 'Z']),
  }
  adapter.selectedSceneFocus = {
    pubkey: null,
    neighbors: new Set(),
  }

  const visibleNeighbor = adapter.edgeReducer('A->B', baseEdge)
  const barelyOffscreenNeighbor = adapter.edgeReducer('A->Z', baseEdge)

  assert.equal(visibleNeighbor.hidden, false)
  assert.ok(visibleNeighbor.size > baseEdge.size)
  assert.equal(barelyOffscreenNeighbor.hidden, false)
  assert.ok(barelyOffscreenNeighbor.size > baseEdge.size)
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
  adapter.draggedNodeFocus = {
    pubkey: 'A',
    neighbors: new Set(['B']),
  }
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
  adapter.currentHoverFocus = {
    pubkey: null,
    neighbors: new Set(),
  }
  const focused = adapter.edgeReducer('E->F', focusedEdge)
  const hidden = adapter.edgeReducer('C->D', baseEdge)
  adapter.setHideConnectionsForLowPerformance(false)
  const visible = adapter.edgeReducer('A->B', baseEdge)

  assert.equal(draggedEdge.hidden, false)
  assert.ok(draggedEdge.size > baseEdge.size)
  assert.equal(focused.hidden, true)
  assert.equal(focused.touchesFocus, true)
  assert.equal(hidden.hidden, true)
  assert.equal(visible.hidden, false)
  assert.equal(renderCalls, 2)
})

test('selected node focus keeps its incident edges visible during low-performance connection LOD', async () => {
  const { SigmaRendererAdapter } = await import(
    '@/features/graph-v2/renderer/SigmaRendererAdapter'
  )

  const edgeEndpoints = new Map<string, [string, string]>([
    ['A->B', ['A', 'B']],
    ['C->D', ['C', 'D']],
    ['E->F', ['E', 'F']],
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
  adapter.draggedNodePubkey = null
  adapter.currentHoverFocus = {
    pubkey: null,
    neighbors: new Set(),
  }
  adapter.selectedSceneFocus = {
    pubkey: 'A',
    neighbors: new Set(['B']),
  }
  adapter.safeRender = () => {}
  adapter.setHideConnectionsForLowPerformance(true)

  const focusedEdge = adapter.edgeReducer('A->B', baseEdge)
  const backgroundEdge = adapter.edgeReducer('C->D', baseEdge)
  const staleProjectedFocusEdge = adapter.edgeReducer('E->F', {
    ...baseEdge,
    touchesFocus: true,
    zIndex: 6,
  })

  assert.equal(focusedEdge.hidden, false)
  assert.ok(focusedEdge.size > baseEdge.size)
  assert.equal(focusedEdge.zIndex, 9)
  assert.equal(backgroundEdge.hidden, true)
  assert.equal(staleProjectedFocusEdge.hidden, true)
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

test('clicking an edge clears node selection because the pointer is outside nodes', async () => {
  const { SigmaRendererAdapter } = await import(
    '@/features/graph-v2/renderer/SigmaRendererAdapter'
  )

  const originalWindow = globalThis.window
  const listeners = new Map<string, (event: unknown) => void>()
  let clearSelectionCalls = 0

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
      onClearSelection: () => {
        clearSelectionCalls += 1
      },
    }

    adapter.bindEvents()

    listeners.get('clickEdge')?.({})

    assert.equal(clearSelectionCalls, 1)
  } finally {
    globalThis.window = originalWindow
  }
})

test('pressing outside nodes clears selection and local hover focus immediately', async () => {
  const { SigmaRendererAdapter } = await import(
    '@/features/graph-v2/renderer/SigmaRendererAdapter'
  )

  const originalWindow = globalThis.window
  const listeners = new Map<string, (event: unknown) => void>()
  let clearSelectionCalls = 0
  const hoverEvents: Array<string | null> = []

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
    hoveredNodePubkey: string | null
    hoveredNeighbors: Set<string>
    currentHoverFocus: { pubkey: string | null; neighbors: Set<string> }
    selectedSceneFocus: { pubkey: string | null; neighbors: Set<string> }
    startHighlightTransition: () => void
    safeRender: () => void
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
      onClearSelection: () => {
        clearSelectionCalls += 1
      },
      onNodeHover: (pubkey) => {
        hoverEvents.push(pubkey)
      },
    }
    adapter.hoveredNodePubkey = 'alice'
    adapter.hoveredNeighbors = new Set(['bob'])
    adapter.currentHoverFocus = {
      pubkey: 'alice',
      neighbors: new Set(['bob']),
    }
    adapter.selectedSceneFocus = {
      pubkey: 'alice',
      neighbors: new Set(['bob']),
    }
    adapter.startHighlightTransition = () => {}
    adapter.safeRender = () => {}

    adapter.bindEvents()

    listeners.get('downStage')?.({})

    assert.equal(clearSelectionCalls, 1)
    assert.equal(adapter.hoveredNodePubkey, null)
    assert.equal(adapter.currentHoverFocus.pubkey, null)
    assert.equal(adapter.selectedSceneFocus.pubkey, null)
    assert.deepEqual(hoverEvents, [null])
  } finally {
    globalThis.window = originalWindow
  }
})

test('small pointer movement before click does not consume node clicks', async () => {
  const { SigmaRendererAdapter } = await import(
    '@/features/graph-v2/renderer/SigmaRendererAdapter'
  )

  const originalWindow = globalThis.window
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame
  const listeners = new Map<string, (event: unknown) => void>()
  const clicks: string[] = []
  let prevented = 0
  let cameraDisabled = 0
  let cameraEnabled = 0

  const adapter = new SigmaRendererAdapter() as unknown as {
    sigma: {
      on: (eventName: string, listener: (event: unknown) => void) => void
      scheduleRender: () => void
      viewportToGraph: (_point: { x: number; y: number }) => { x: number; y: number }
      getCamera: () => {
        on: (eventName: string, listener: (event: unknown) => void) => void
        disable: () => void
        enable: () => void
      }
    } | null
    renderStore: { getNodePosition: (_pubkey: string) => { x: number; y: number } | null } | null
    physicsStore: { getNodePosition: (_pubkey: string) => { x: number; y: number } | null } | null
    callbacks: GraphInteractionCallbacks | null
    bindEvents: () => void
  }

  globalThis.window = {
    addEventListener: () => {},
    removeEventListener: () => {},
  } as Window & typeof globalThis
  globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    callback(0)
    return 1
  }) as typeof requestAnimationFrame
  globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame

  try {
    adapter.sigma = {
      on: (eventName, listener) => {
        listeners.set(eventName, listener)
      },
      scheduleRender: () => {},
      viewportToGraph: (point) => point,
      getCamera: () => ({
        on: () => {},
        disable: () => {
          cameraDisabled += 1
        },
        enable: () => {
          cameraEnabled += 1
        },
      }),
    }
    adapter.renderStore = {
      getNodePosition: () => ({ x: 20, y: 20 }),
    }
    adapter.physicsStore = {
      getNodePosition: () => null,
    }
    adapter.callbacks = {
      ...createCallbacks(() => {}),
      onNodeClick: (pubkey) => {
        clicks.push(pubkey)
      },
    }

    adapter.bindEvents()

    listeners.get('downNode')?.({
      node: 'alice',
      event: { x: 20, y: 20, original: { ctrlKey: false } },
    })
    listeners.get('moveBody')?.({
      event: { x: 22, y: 20, original: { ctrlKey: false } },
      preventSigmaDefault: () => {
        prevented += 1
      },
    })
    listeners.get('upNode')?.({
      event: { x: 22, y: 20, original: { ctrlKey: false } },
    })
    listeners.get('clickNode')?.({ node: 'alice' })

    assert.equal(prevented, 0)
    assert.equal(cameraDisabled, 1)
    assert.equal(cameraEnabled, 1)
    assert.deepEqual(clicks, ['alice'])
  } finally {
    globalThis.window = originalWindow
    globalThis.requestAnimationFrame = originalRequestAnimationFrame
    globalThis.cancelAnimationFrame = originalCancelAnimationFrame
  }
})

test('node drag start keeps the down-node anchor and schedules with the pre-start viewport transform', async () => {
  const { SigmaRendererAdapter } = await import(
    '@/features/graph-v2/renderer/SigmaRendererAdapter'
  )

  const originalWindow = globalThis.window
  const listeners = new Map<string, (event: unknown) => void>()
  const startDragCalls: Array<{ pubkey: string; anchorOffset?: { dx: number; dy: number } }> = []
  const scheduledPositions: Array<{ x: number; y: number }> = []
  let prevented = 0
  let viewportScale = 1

  const adapter = new SigmaRendererAdapter() as unknown as {
    sigma: {
      on: (eventName: string, listener: (event: unknown) => void) => void
      viewportToGraph: (_point: { x: number; y: number }) => { x: number; y: number }
      getCamera: () => {
        on: (eventName: string, listener: (event: unknown) => void) => void
        disable: () => void
      }
    } | null
    renderStore: { getNodePosition: (_pubkey: string) => { x: number; y: number } | null } | null
    physicsStore: { getNodePosition: (_pubkey: string) => { x: number; y: number } | null } | null
    callbacks: GraphInteractionCallbacks | null
    startDrag: (_pubkey: string, _anchorOffset?: { dx: number; dy: number }) => void
    scheduleDragFrame: (_position: { x: number; y: number }) => void
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
      viewportToGraph: (point) => ({
        x: point.x * viewportScale,
        y: point.y * viewportScale,
      }),
      getCamera: () => ({
        on: () => {},
        disable: () => {},
      }),
    }
    adapter.renderStore = {
      getNodePosition: () => ({ x: 100, y: 50 }),
    }
    adapter.physicsStore = {
      getNodePosition: () => null,
    }
    adapter.callbacks = createCallbacks(() => {})
    adapter.startDrag = (pubkey, anchorOffset) => {
      startDragCalls.push({ pubkey, anchorOffset })
      viewportScale = 100
    }
    adapter.scheduleDragFrame = (position) => {
      scheduledPositions.push(position)
    }

    adapter.bindEvents()

    listeners.get('downNode')?.({
      node: 'alice',
      event: { x: 20, y: 10, original: { ctrlKey: false } },
    })
    listeners.get('moveBody')?.({
      event: { x: 25, y: 14, original: { ctrlKey: false } },
      preventSigmaDefault: () => {
        prevented += 1
      },
    })

    assert.equal(prevented, 1)
    assert.deepEqual(startDragCalls, [
      { pubkey: 'alice', anchorOffset: { dx: 80, dy: 40 } },
    ])
    assert.deepEqual(scheduledPositions, [{ x: 25, y: 14 }])
  } finally {
    globalThis.window = originalWindow
  }
})

test('node drag release does not request pinning unless control is pressed', async () => {
  const { SigmaRendererAdapter } = await import(
    '@/features/graph-v2/renderer/SigmaRendererAdapter'
  )

  const originalWindow = globalThis.window
  const listeners = new Map<string, (event: unknown) => void>()
  const releaseCalls: Array<{ pinOnRelease?: boolean }> = []

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
    releaseDrag: (_options?: { pinOnRelease?: boolean }) => void
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
    adapter.callbacks = createCallbacks(() => {})
    adapter.releaseDrag = (options) => {
      releaseCalls.push(options ?? {})
    }

    adapter.bindEvents()

    listeners.get('upNode')?.({
      event: { x: 20, y: 10, original: { ctrlKey: false } },
    })
    listeners.get('upStage')?.({
      event: { x: 20, y: 10, original: { ctrlKey: true } },
    })

    assert.deepEqual(releaseCalls, [
      { pinOnRelease: false },
      { pinOnRelease: true },
    ])
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

