import assert from 'node:assert/strict'
import test from 'node:test'

import { DirectedGraph } from 'graphology'

import type { GraphPhysicsSnapshot } from '@/features/graph-v2/renderer/contracts'
import {
  ConvergingFA2Supervisor,
  DEFAULT_FORCE_ATLAS_PHYSICS_TUNING,
  ForceAtlasRuntime,
  createForceAtlasPhysicsTuning,
  resolveForceAtlasDenseFactor,
  resolveForceAtlasSettings,
  type ConvergingLayoutOptions,
  type ForceAtlasLayoutController,
} from '@/features/graph-v2/renderer/forceAtlasRuntime'
import type {
  PhysicsEdgeAttributes,
  PhysicsNodeAttributes,
} from '@/features/graph-v2/renderer/graphologyProjectionStore'

const createScene = (
  nodeCount: number,
  forceEdgeCount: number,
): GraphPhysicsSnapshot => ({
  nodes: Array.from({ length: nodeCount }, (_, index) => ({
    pubkey: `node-${index}`,
    size: 10,
    fixed: false,
  })),
  edges: Array.from({ length: forceEdgeCount }, (_, index) => ({
    id: `edge-${index}`,
    source: `node-${index}`,
    target: `node-${index + 1}`,
    weight: 1,
  })),
  diagnostics: {
    nodeCount,
    edgeCount: forceEdgeCount,
    topologySignature: `${nodeCount}:${forceEdgeCount}`,
  },
})

const createGraph = (nodeCount: number, edgeCount: number) => {
  const graph = new DirectedGraph<PhysicsNodeAttributes, PhysicsEdgeAttributes>()

  for (let index = 0; index < nodeCount; index += 1) {
    graph.addNode(`node-${index}`, {
      x: index,
      y: index,
      size: 1,
      fixed: false,
    })
  }

  for (let index = 0; index < edgeCount; index += 1) {
    graph.addDirectedEdgeWithKey(`edge-${index}`, `node-${index}`, `node-${index + 1}`, {
      weight: 1,
    })
  }

  return graph
}

class LayoutStub implements ForceAtlasLayoutController {
  public running = false

  public startCalls = 0

  public stopCalls = 0

  public killCalls = 0

  public isRunning() {
    return this.running
  }

  public start() {
    this.running = true
    this.startCalls += 1
  }

  public stop() {
    this.running = false
    this.stopCalls += 1
  }

  public kill() {
    this.running = false
    this.killCalls += 1
  }
}

const installAnimationFrameRaceStub = () => {
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame
  const callbacks = new Map<number, FrameRequestCallback>()
  let nextHandle = 1

  globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    const handle = nextHandle
    nextHandle += 1
    callbacks.set(handle, callback)
    return handle
  }) as typeof requestAnimationFrame

  // Simulate the browser timing window where a queued RAF callback can still
  // run even though stop() already attempted to cancel it.
  globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame

  return {
    flushAll() {
      const queued = [...callbacks.values()]
      callbacks.clear()
      for (const callback of queued) {
        callback(performance.now())
      }
    },
    restore() {
      callbacks.clear()
      globalThis.requestAnimationFrame = originalRequestAnimationFrame
      globalThis.cancelAnimationFrame = originalCancelAnimationFrame
    },
  }
}

class WorkerStub {
  public terminated = false

  public postMessageCallCount = 0

  private readonly transferredBuffers = new Set<ArrayBuffer>()

  private readonly messageListeners: Array<(event: MessageEvent) => void> = []

  public addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    if (type !== 'message') {
      return
    }
    if (typeof listener === 'function') {
      this.messageListeners.push(listener as (event: MessageEvent) => void)
      return
    }
    this.messageListeners.push((event) => listener.handleEvent(event))
  }

  public postMessage(
    payload: { nodes: ArrayBuffer },
    transfer: Transferable[] = [],
  ) {
    this.postMessageCallCount += 1
    for (const candidate of transfer) {
      if (!(candidate instanceof ArrayBuffer)) {
        continue
      }
      if (this.transferredBuffers.has(candidate)) {
        throw new DOMException(
          'ArrayBuffer at index 0 is already detached.',
          'DataCloneError',
        )
      }
      this.transferredBuffers.add(candidate)
    }

    void payload
  }

  public terminate() {
    this.terminated = true
  }

  public emitMessage(nodeCount: number) {
    const nodes = new Float32Array(nodeCount * 10).buffer
    for (const listener of this.messageListeners) {
      listener({
        currentTarget: this,
        data: { nodes },
      } as MessageEvent)
    }
  }
}

test('ForceAtlas settings scale repulsion and damping for dense sigma graphs', () => {
  const smallSettings = resolveForceAtlasSettings(80)
  const hubSizedSettings = resolveForceAtlasSettings(500)
  const denseSettings = resolveForceAtlasSettings(2200)
  const smallCentripetalSettings = resolveForceAtlasSettings(80, {
    centripetalForce: 0.25,
  })
  const denseCentripetalSettings = resolveForceAtlasSettings(2200, {
    centripetalForce: 0.25,
  })
  const denseHubSettings = resolveForceAtlasSettings(2200, undefined, {
    maxDegree: 2100,
  })

  assert.equal(resolveForceAtlasDenseFactor(80), 0)
  assert.equal(resolveForceAtlasDenseFactor(2200), 1)
  assert.equal(Math.round((smallSettings.scalingRatio ?? 0) * 100) / 100, 15.91)
  assert.equal(smallSettings.gravity, 0)
  assert.equal(smallCentripetalSettings.gravity, 0.05)
  assert.equal(Math.round((smallSettings.slowDown ?? 0) * 10) / 10, 28)
  assert.equal(Math.round((smallSettings.edgeWeightInfluence ?? 0) * 100) / 100, 1.77)
  assert.equal(Math.round((denseSettings.scalingRatio ?? 0) * 100) / 100, 31.82)
  assert.equal(denseSettings.gravity, 0)
  assert.equal(denseCentripetalSettings.gravity, 0.08)
  assert.equal(Math.round((denseSettings.slowDown ?? 0) * 10) / 10, 44)
  assert.equal(Math.round((denseSettings.edgeWeightInfluence ?? 0) * 100) / 100, 0.92)
  assert.equal(smallSettings.strongGravityMode, true)
  assert.equal(denseSettings.strongGravityMode, true)
  assert.equal(smallSettings.barnesHutOptimize, false)
  assert.equal(hubSizedSettings.barnesHutOptimize, false)
  assert.equal(denseSettings.barnesHutOptimize, true)
  assert.equal(denseHubSettings.barnesHutOptimize, false)
  assert.ok(
    (denseSettings.scalingRatio ?? 0) > (smallSettings.scalingRatio ?? 0),
    'expected dense graphs to use stronger magnetic repulsion',
  )
  assert.ok(
    (denseCentripetalSettings.gravity ?? 0) >
      (smallCentripetalSettings.gravity ?? 0),
    'expected dense graphs to increase bounding gravity with repulsion',
  )
  assert.ok(
    (denseSettings.slowDown ?? 0) > (smallSettings.slowDown ?? 0),
    'expected dense graphs to use more controlled inertia',
  )
  assert.ok(
    (denseSettings.edgeWeightInfluence ?? 0) <
      (smallSettings.edgeWeightInfluence ?? 0),
    'expected dense graphs to soften weighted link attraction',
  )
  assert.equal(smallSettings.adjustSizes, false)
  assert.equal(denseSettings.adjustSizes, false)
})

test('ForceAtlas tuning maps sliders to settings multipliers', () => {
  const baseSettings = resolveForceAtlasSettings(80)
  const disabledCentripetalSettings = resolveForceAtlasSettings(80, {
    centripetalForce: 0,
  })
  const tunedSettings = resolveForceAtlasSettings(80, {
    centripetalForce: 0.45,
    repulsionForce: 1.5,
    linkForce: 1.5,
    linkDistance: 2,
    damping: 1.5,
  })

  assert.equal(disabledCentripetalSettings.gravity, 0)
  assert.equal(Math.round((tunedSettings.gravity ?? 0) * 100) / 100, 0.09)
  assert.equal(
    Math.round((tunedSettings.scalingRatio ?? 0) * 100) / 100,
    9.55,
  )
  assert.equal(
    Math.round((tunedSettings.edgeWeightInfluence ?? 0) * 100) / 100,
    1.33,
  )
  assert.equal(tunedSettings.slowDown, 21)
  assert.notEqual(tunedSettings.scalingRatio, baseSettings.scalingRatio)
})

test('ForceAtlas tuning clamps slider input into supported ranges', () => {
  assert.deepEqual(createForceAtlasPhysicsTuning(), DEFAULT_FORCE_ATLAS_PHYSICS_TUNING)
  assert.deepEqual(
    createForceAtlasPhysicsTuning({
      centripetalForce: 10,
      repulsionForce: -1,
      linkForce: 20,
      linkDistance: 0,
      damping: 99,
    }),
    {
      centripetalForce: 0.5,
      repulsionForce: 0.25,
      linkForce: 2.5,
      linkDistance: 0.5,
      damping: 2.5,
    },
  )
  assert.equal(
    createForceAtlasPhysicsTuning({ centripetalForce: 0 }).centripetalForce,
    0,
  )
  assert.equal(createForceAtlasPhysicsTuning({ damping: -1 }).damping, 0.1)
  assert.equal(
    createForceAtlasPhysicsTuning({ repulsionForce: 99 }).repulsionForce,
    5,
  )
})

test('reports ForceAtlas physics diagnostics for the sigma debug probe', () => {
  const graph = createGraph(3, 2)
  const runtime = new ForceAtlasRuntime(graph, () => new LayoutStub())

  runtime.sync(createScene(3, 2))

  const diagnostics = runtime.getDiagnostics()

  assert.equal(diagnostics.presetVersion, 'obsidian-v2')
  assert.equal(diagnostics.graphOrder, 3)
  assert.equal(diagnostics.graphSize, 2)
  assert.equal(diagnostics.maxDegree, 2)
  assert.equal(diagnostics.hubRatio, 1)
  assert.equal(diagnostics.layoutEligible, true)
  assert.equal(diagnostics.running, true)
  assert.equal(diagnostics.suspended, false)
  assert.equal(diagnostics.autoFreezeEnabled, true)
  assert.deepEqual(diagnostics.tuning, DEFAULT_FORCE_ATLAS_PHYSICS_TUNING)
  assert.equal(Math.round((diagnostics.settings.scalingRatio ?? 0) * 100) / 100, 15.91)
  assert.equal(diagnostics.settings.gravity, 0)
  assert.ok(diagnostics.settingsKey?.startsWith('obsidian-v2::'))
  assert.deepEqual(diagnostics.bounds, {
    minX: 0,
    maxX: 2,
    minY: 0,
    maxY: 2,
    width: 2,
    height: 2,
  })
  assert.equal(Math.round((diagnostics.averageEdgeLength ?? 0) * 100) / 100, 1.41)
  assert.equal(diagnostics.sampledNodeCount, 3)
  assert.equal(diagnostics.approximateOverlapCount, 0)
})

test('ConvergingFA2Supervisor ignores stale RAF callbacks after restart', () => {
  const animationFrame = installAnimationFrameRaceStub()
  const graph = createGraph(3, 2)
  const workers: WorkerStub[] = []
  const supervisor = new ConvergingFA2Supervisor(
    graph,
    resolveForceAtlasSettings(graph.order),
    {
      createWorker: () => {
        const worker = new WorkerStub()
        workers.push(worker)
        return worker as unknown as Worker
      },
    },
  )

  try {
    supervisor.start()
    assert.equal(workers.length, 1)
    assert.equal(workers[0]?.postMessageCallCount, 1)

    workers[0]?.emitMessage(graph.order)
    supervisor.stop()
    supervisor.start()

    assert.equal(workers.length, 2)
    assert.equal(workers[0]?.terminated, true)
    assert.equal(workers[1]?.postMessageCallCount, 1)

    assert.doesNotThrow(() => {
      animationFrame.flushAll()
    })
    assert.equal(workers[1]?.postMessageCallCount, 1)
  } finally {
    supervisor.kill()
    animationFrame.restore()
  }
})

test('sync does not reheat when only the topology signature changes', () => {
  const graph = createGraph(3, 2)
  const layouts: LayoutStub[] = []
  const runtime = new ForceAtlasRuntime(graph, () => {
    const layout = new LayoutStub()
    layouts.push(layout)
    return layout
  })

  runtime.sync(createScene(3, 2))
  runtime.sync({
    ...createScene(3, 2),
    diagnostics: {
      ...createScene(3, 2).diagnostics,
      topologySignature: 'changed-with-same-settings',
    },
  })

  assert.equal(layouts.length, 1)
  assert.equal(layouts[0]?.startCalls, 1)
  assert.equal(layouts[0]?.killCalls, 0)
})

test('sync recreates the layout once when topology changed is reported', () => {
  const graph = createGraph(3, 2)
  const layouts: LayoutStub[] = []
  const runtime = new ForceAtlasRuntime(graph, () => {
    const layout = new LayoutStub()
    layouts.push(layout)
    return layout
  })
  const scene = createScene(3, 2)

  runtime.sync(scene)
  runtime.sync(scene, { topologyChanged: true })

  assert.equal(layouts.length, 2)
  assert.equal(layouts[0]?.killCalls, 1)
  assert.equal(layouts[1]?.startCalls, 1)
})

test('sync preserves the running layout when topology changed is false', () => {
  const graph = createGraph(3, 2)
  const layouts: LayoutStub[] = []
  const runtime = new ForceAtlasRuntime(graph, () => {
    const layout = new LayoutStub()
    layouts.push(layout)
    return layout
  })
  const scene = createScene(3, 2)

  runtime.sync(scene)
  runtime.sync(scene, { topologyChanged: false })

  assert.equal(layouts.length, 1)
  assert.equal(layouts[0]?.startCalls, 1)
  assert.equal(layouts[0]?.killCalls, 0)
})

test('graph topology mutations do not recreate layouts until sync invalidates topology', () => {
  const graph = createGraph(3, 2)
  const layouts: LayoutStub[] = []
  const runtime = new ForceAtlasRuntime(graph, () => {
    const layout = new LayoutStub()
    layouts.push(layout)
    return layout
  })

  runtime.sync(createScene(3, 2))

  for (let index = 3; index < 5_050; index += 1) {
    graph.addNode(`node-${index}`, {
      x: index,
      y: index,
      size: 1,
      fixed: false,
    })
  }

  assert.equal(layouts.length, 1)
  assert.equal(layouts[0]?.killCalls, 0)

  runtime.sync(createScene(graph.order, 2), { topologyChanged: true })

  assert.equal(layouts.length, 2)
  assert.equal(layouts[0]?.killCalls, 1)
  assert.equal(layouts[1]?.startCalls, 1)
})

test('sync recreates the layout when the settings key changes', () => {
  const graph = createGraph(3, 2)
  const layouts: LayoutStub[] = []
  const runtime = new ForceAtlasRuntime(graph, () => {
    const layout = new LayoutStub()
    layouts.push(layout)
    return layout
  })

  runtime.sync(createScene(3, 2))

  for (let index = 3; index < 4_100; index += 1) {
    graph.addNode(`node-${index}`, {
      x: index,
      y: index,
      size: 1,
      fixed: false,
    })
  }

  runtime.sync(createScene(graph.order, 2))

  assert.equal(layouts.length, 2)
  assert.equal(layouts[0]?.killCalls, 1)
  assert.equal(layouts[1]?.startCalls, 1)
})

test('suspended topology invalidation recreates the layout only on resume', () => {
  const graph = createGraph(3, 2)
  const layouts: LayoutStub[] = []
  const runtime = new ForceAtlasRuntime(graph, () => {
    const layout = new LayoutStub()
    layouts.push(layout)
    return layout
  })

  runtime.sync(createScene(3, 2))
  runtime.suspend()
  graph.addNode('node-3', {
    x: 3,
    y: 3,
    size: 1,
    fixed: false,
  })
  graph.addDirectedEdgeWithKey('edge-2', 'node-2', 'node-3', { weight: 1 })
  runtime.sync(createScene(4, 3), { topologyChanged: true })

  assert.equal(layouts.length, 1)
  assert.equal(layouts[0]?.killCalls, 1)

  runtime.resume()

  assert.equal(layouts.length, 2)
  assert.equal(layouts[1]?.startCalls, 1)
})

test('setPhysicsTuning recreates a running layout with the tuned settings', () => {
  const graph = createGraph(3, 2)
  const layouts: LayoutStub[] = []
  const settingsHistory: Array<{
    scalingRatio?: number
    gravity?: number
    edgeWeightInfluence?: number
    slowDown?: number
  }> = []
  const runtime = new ForceAtlasRuntime(graph, (_graph, settings) => {
    const layout = new LayoutStub()
    layouts.push(layout)
    settingsHistory.push({
      scalingRatio: settings.scalingRatio,
      gravity: settings.gravity,
      edgeWeightInfluence: settings.edgeWeightInfluence,
      slowDown: settings.slowDown,
    })
    return layout
  })

  runtime.sync(createScene(3, 2))
  runtime.setPhysicsTuning({
    centripetalForce: 2,
    repulsionForce: 1.5,
    linkForce: 1.5,
    linkDistance: 2,
    damping: 1.5,
  })

  assert.equal(layouts.length, 2)
  assert.equal(layouts[0]?.killCalls, 1)
  assert.equal(layouts[1]?.startCalls, 1)
  assert.equal(Math.round((settingsHistory[0]?.scalingRatio ?? 0) * 100) / 100, 15.91)
  assert.equal(Math.round((settingsHistory[1]?.scalingRatio ?? 0) * 100) / 100, 9.55)
  assert.equal(settingsHistory[1]?.gravity, 0.1)
  assert.equal(settingsHistory[1]?.slowDown, 21)
})

test('suspend and resume gate sync without recreating the layout', () => {
  const graph = createGraph(3, 2)
  const layouts: LayoutStub[] = []
  const runtime = new ForceAtlasRuntime(graph, () => {
    const layout = new LayoutStub()
    layouts.push(layout)
    return layout
  })

  runtime.sync(createScene(3, 2))
  runtime.suspend()
  runtime.sync(createScene(3, 2))

  assert.equal(layouts.length, 1)
  assert.equal(layouts[0]?.stopCalls, 1)

  runtime.resume()

  assert.equal(layouts[0]?.startCalls, 2)
  assert.equal(layouts[0]?.killCalls, 0)
})

test('reheat recreates the layout only when the runtime is eligible to run', () => {
  const graph = createGraph(3, 2)
  const layouts: LayoutStub[] = []
  const runtime = new ForceAtlasRuntime(graph, () => {
    const layout = new LayoutStub()
    layouts.push(layout)
    return layout
  })

  runtime.reheat()
  assert.equal(layouts.length, 0)

  runtime.sync(createScene(3, 2))
  assert.equal(layouts.length, 1)
  assert.equal(layouts[0]?.startCalls, 1)

  runtime.reheat()
  assert.equal(layouts.length, 2)
  assert.equal(layouts[0]?.killCalls, 1)
  assert.equal(layouts[1]?.startCalls, 1)

  runtime.sync(createScene(3, 0))
  runtime.reheat()
  assert.equal(layouts.length, 2)
})

test('sync restarts an existing stopped layout when physics is enabled', () => {
  const graph = createGraph(3, 2)
  const layouts: LayoutStub[] = []
  const runtime = new ForceAtlasRuntime(graph, () => {
    const layout = new LayoutStub()
    layouts.push(layout)
    return layout
  })
  const scene = createScene(3, 2)

  runtime.sync(scene)
  layouts[0]!.running = false

  runtime.sync(scene)

  assert.equal(layouts.length, 1)
  assert.equal(layouts[0]?.startCalls, 2)
})

test('sync does not restart a settled layout on non-structural updates', () => {
  const graph = createGraph(3, 2)
  const layouts: LayoutStub[] = []
  let markSettled: (() => void) | undefined
  const runtime = new ForceAtlasRuntime(graph, (
    _graph,
    _settings,
    options: ConvergingLayoutOptions,
  ) => {
    const layout = new LayoutStub()
    layouts.push(layout)
    markSettled = options.onSettled
    return layout
  })
  const scene = createScene(3, 2)

  runtime.sync(scene)
  layouts[0]!.running = false
  markSettled?.()

  runtime.sync({
    ...scene,
    diagnostics: {
      ...scene.diagnostics,
      topologySignature: 'hover-or-selection-only',
    },
  })

  assert.equal(layouts.length, 1)
  assert.equal(layouts[0]?.startCalls, 1)
})

test('resume can invalidate convergence after drag coordinate edits', () => {
  const graph = createGraph(3, 2)
  const layouts: LayoutStub[] = []
  let markSettled: (() => void) | undefined
  const runtime = new ForceAtlasRuntime(graph, (
    _graph,
    _settings,
    options: ConvergingLayoutOptions,
  ) => {
    const layout = new LayoutStub()
    layouts.push(layout)
    markSettled = options.onSettled
    return layout
  })

  runtime.sync(createScene(3, 2))
  layouts[0]!.running = false
  markSettled?.()

  runtime.suspend()
  graph.mergeNodeAttributes('node-1', { x: 100, y: 100 })
  runtime.resume({ invalidateConvergence: true })

  assert.equal(layouts.length, 1)
  assert.equal(layouts[0]?.startCalls, 2)
  assert.equal(layouts[0]?.killCalls, 0)
})

test('disabling auto-freeze restarts a settled layout without recreating it', () => {
  const graph = createGraph(3, 2)
  const layouts: LayoutStub[] = []
  let markSettled: (() => void) | undefined
  const runtime = new ForceAtlasRuntime(graph, (
    _graph,
    _settings,
    options: ConvergingLayoutOptions,
  ) => {
    const layout = new LayoutStub()
    layouts.push(layout)
    markSettled = options.onSettled
    return layout
  })

  runtime.sync(createScene(3, 2))
  layouts[0]!.running = false
  markSettled?.()

  runtime.setAutoFreezeEnabled(false)

  assert.equal(layouts.length, 1)
  assert.equal(layouts[0]?.startCalls, 2)
  assert.equal(layouts[0]?.killCalls, 0)
  assert.equal(runtime.getDiagnostics().autoFreezeEnabled, false)
})

test('sync recreates the layout when node fixed flags change', () => {
  const graph = createGraph(3, 2)
  const layouts: LayoutStub[] = []
  const runtime = new ForceAtlasRuntime(graph, () => {
    const layout = new LayoutStub()
    layouts.push(layout)
    return layout
  })

  const scene = createScene(3, 2)
  runtime.sync(scene)

  runtime.sync({
    ...scene,
    nodes: scene.nodes.map((node) =>
      node.pubkey === 'node-0' ? { ...node, fixed: true } : node,
    ),
  })

  assert.equal(layouts.length, 2)
  assert.equal(layouts[0]?.killCalls, 1)
  assert.equal(layouts[1]?.startCalls, 1)
})
