import assert from 'node:assert/strict'
import test from 'node:test'

import { DirectedGraph } from 'graphology'

import type { GraphPhysicsSnapshot } from '@/features/graph-v2/renderer/contracts'
import {
  DEFAULT_FORCE_ATLAS_PHYSICS_TUNING,
  ForceAtlasRuntime,
  createForceAtlasPhysicsTuning,
  resolveForceAtlasDenseFactor,
  resolveForceAtlasSettings,
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

test('ForceAtlas settings scale repulsion and damping for dense sigma graphs', () => {
  const smallSettings = resolveForceAtlasSettings(80)
  const denseSettings = resolveForceAtlasSettings(2200)

  assert.equal(resolveForceAtlasDenseFactor(80), 0)
  assert.equal(resolveForceAtlasDenseFactor(2200), 1)
  assert.equal(smallSettings.scalingRatio, 11.25)
  assert.equal(smallSettings.gravity, 0.35)
  assert.equal(Math.round((smallSettings.slowDown ?? 0) * 10) / 10, 4.9)
  assert.equal(smallSettings.edgeWeightInfluence, 1.25)
  assert.equal(denseSettings.scalingRatio, 22.5)
  assert.equal(denseSettings.gravity, 0.55)
  assert.equal(Math.round((denseSettings.slowDown ?? 0) * 10) / 10, 7.7)
  assert.equal(denseSettings.edgeWeightInfluence, 0.65)
  assert.ok(
    (denseSettings.scalingRatio ?? 0) > (smallSettings.scalingRatio ?? 0),
    'expected dense graphs to use stronger magnetic repulsion',
  )
  assert.ok(
    (denseSettings.gravity ?? 0) > (smallSettings.gravity ?? 0),
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
  assert.equal(smallSettings.adjustSizes, true)
  assert.equal(denseSettings.adjustSizes, true)
})

test('ForceAtlas tuning maps sliders to settings multipliers', () => {
  const baseSettings = resolveForceAtlasSettings(80)
  const tunedSettings = resolveForceAtlasSettings(80, {
    centripetalForce: 2,
    repulsionForce: 1.5,
    linkForce: 1.5,
    linkDistance: 2,
    damping: 1.5,
  })

  assert.equal(tunedSettings.gravity, 0.7)
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
      centripetalForce: 2.5,
      repulsionForce: 0.25,
      linkForce: 2.5,
      linkDistance: 0.5,
      damping: 2.5,
    },
  )
  assert.equal(createForceAtlasPhysicsTuning({ damping: -1 }).damping, 0.25)
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
  assert.equal(diagnostics.layoutEligible, true)
  assert.equal(diagnostics.running, true)
  assert.equal(diagnostics.suspended, false)
  assert.deepEqual(diagnostics.tuning, DEFAULT_FORCE_ATLAS_PHYSICS_TUNING)
  assert.equal(diagnostics.settings.scalingRatio, 11.25)
  assert.equal(diagnostics.settings.gravity, 0.35)
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
  assert.equal(settingsHistory[0]?.scalingRatio, 11.25)
  assert.equal(Math.round((settingsHistory[1]?.scalingRatio ?? 0) * 100) / 100, 9.55)
  assert.equal(settingsHistory[1]?.gravity, 0.7)
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
