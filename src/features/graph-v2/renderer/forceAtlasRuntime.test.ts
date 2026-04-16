import assert from 'node:assert/strict'
import test from 'node:test'

import { DirectedGraph } from 'graphology'

import type { GraphSceneSnapshot } from '@/features/graph-v2/renderer/contracts'
import {
  ForceAtlasRuntime,
  type ForceAtlasLayoutController,
} from '@/features/graph-v2/renderer/forceAtlasRuntime'
import type {
  SigmaEdgeAttributes,
  SigmaNodeAttributes,
} from '@/features/graph-v2/renderer/graphologyProjectionStore'

const createScene = (
  nodeCount: number,
  forceEdgeCount: number,
): GraphSceneSnapshot => ({
  nodes: Array.from({ length: nodeCount }, (_, index) => ({
    pubkey: `node-${index}`,
    label: `node-${index}`,
    pictureUrl: null,
    color: '#fff',
    size: 10,
    isRoot: index === 0,
    isSelected: false,
    isPinned: false,
    isNeighbor: false,
    isDimmed: false,
    focusState: index === 0 ? ('root' as const) : ('idle' as const),
  })),
  visibleEdges: [],
  forceEdges: Array.from({ length: forceEdgeCount }, (_, index) => ({
    id: `edge-${index}`,
    source: `node-${index}`,
    target: `node-${index + 1}`,
    color: '#fff',
    size: 1,
    hidden: false,
    relation: 'follow',
    weight: 1,
    isDimmed: false,
    touchesFocus: false,
  })),
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
    rootPubkey: 'node-0',
  },
  diagnostics: {
    activeLayer: 'graph',
    nodeCount,
    visibleEdgeCount: 0,
    forceEdgeCount,
    relayCount: 0,
    isGraphStale: false,
    topologySignature: `${nodeCount}:${forceEdgeCount}`,
  },
})

const createGraph = (nodeCount: number, edgeCount: number) => {
  const graph = new DirectedGraph<SigmaNodeAttributes, SigmaEdgeAttributes>()

  for (let index = 0; index < nodeCount; index += 1) {
    graph.addNode(`node-${index}`, {
      x: index,
      y: index,
      size: 1,
      color: '#fff',
      label: `node-${index}`,
      hidden: false,
      highlighted: false,
      forceLabel: false,
      fixed: false,
      pictureUrl: null,
    })
  }

  for (let index = 0; index < edgeCount; index += 1) {
    graph.addDirectedEdgeWithKey(`edge-${index}`, `node-${index}`, `node-${index + 1}`, {
      size: 1,
      color: '#fff',
      hidden: false,
      label: null,
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
      color: '#fff',
      label: `node-${index}`,
      hidden: false,
      highlighted: false,
      forceLabel: false,
      fixed: false,
      pictureUrl: null,
    })
  }

  runtime.sync(createScene(graph.order, 2))

  assert.equal(layouts.length, 2)
  assert.equal(layouts[0]?.killCalls, 1)
  assert.equal(layouts[1]?.startCalls, 1)
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
