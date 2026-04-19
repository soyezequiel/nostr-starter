import assert from 'node:assert/strict'
import test from 'node:test'

import type { GraphSceneSnapshot } from '@/features/graph-v2/renderer/contracts'
import {
  NodePositionLedger,
  PhysicsGraphStore,
  RenderGraphStore,
} from '@/features/graph-v2/renderer/graphologyProjectionStore'

const createScene = (
  edgeId: string,
  activeLayer: GraphSceneSnapshot['render']['diagnostics']['activeLayer'] = 'graph',
): GraphSceneSnapshot => ({
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
        pubkey: 'B',
        label: 'B',
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
    visibleEdges: [
      {
        id: edgeId,
        source: 'A',
        target: 'B',
        color: '#8fb6ff',
        size: 1,
        hidden: false,
        relation: 'follow',
        weight: 1,
        isDimmed: false,
        touchesFocus: false,
      },
    ],
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
      activeLayer,
      nodeCount: 2,
      visibleEdgeCount: 1,
      relayCount: 0,
      isGraphStale: false,
      topologySignature: edgeId,
    },
  },
  physics: {
    nodes: [
      { pubkey: 'A', size: 10, fixed: false },
      { pubkey: 'B', size: 10, fixed: false },
    ],
    edges: [
      {
        id: edgeId,
        source: 'A',
        target: 'B',
        weight: 1,
      },
    ],
    diagnostics: {
      nodeCount: 2,
      edgeCount: 1,
      topologySignature: edgeId,
    },
  },
})

const createDenseScene = (extraEdgeCount: number): GraphSceneSnapshot => {
  const scene = createScene('follow:A:B')
  const extraRenderNodes = Array.from(
    { length: extraEdgeCount + 1 },
    (_, index) => ({
      ...scene.render.nodes[1]!,
      pubkey: `N${index}`,
      label: `N${index}`,
      isRoot: false,
    }),
  )
  const extraPhysicsNodes = extraRenderNodes.map((node) => ({
    pubkey: node.pubkey,
    size: node.size,
    fixed: false,
  }))
  const renderEdgeTemplate = scene.render.visibleEdges[0]!
  const extraRenderEdges = Array.from({ length: extraEdgeCount }, (_, index) => ({
    ...renderEdgeTemplate,
    id: `extra:${index}`,
    source: `N${index}`,
    target: `N${index + 1}`,
  }))
  const extraPhysicsEdges = extraRenderEdges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    weight: edge.weight,
  }))

  return {
    render: {
      ...scene.render,
      nodes: [...scene.render.nodes, ...extraRenderNodes],
      visibleEdges: [...scene.render.visibleEdges, ...extraRenderEdges],
      diagnostics: {
        ...scene.render.diagnostics,
        nodeCount: scene.render.nodes.length + extraRenderNodes.length,
        visibleEdgeCount:
          scene.render.visibleEdges.length + extraRenderEdges.length,
      },
    },
    physics: {
      ...scene.physics,
      nodes: [...scene.physics.nodes, ...extraPhysicsNodes],
      edges: [...scene.physics.edges, ...extraPhysicsEdges],
      diagnostics: {
        ...scene.physics.diagnostics,
        nodeCount: scene.physics.nodes.length + extraPhysicsNodes.length,
        edgeCount: scene.physics.edges.length + extraPhysicsEdges.length,
      },
    },
  }
}

const createStores = () => {
  const ledger = new NodePositionLedger()
  return {
    ledger,
    renderStore: new RenderGraphStore(ledger),
    physicsStore: new PhysicsGraphStore(ledger),
  }
}

test('render store replaces an existing directed pair when the incoming edge key changes', () => {
  const { renderStore } = createStores()

  renderStore.applyScene(createScene('inbound:A:B').render)
  renderStore.applyScene(createScene('follow:A:B').render)

  const graph = renderStore.getGraph()

  assert.equal(graph.order, 2)
  assert.equal(graph.size, 1)
  assert.equal(graph.directedEdge('A', 'B'), 'follow:A:B')
  assert.equal(graph.hasEdge('inbound:A:B'), false)
  assert.equal(graph.hasEdge('follow:A:B'), true)
})

test('render store preserves node attribute object identity when scene attributes do not change', () => {
  const { renderStore } = createStores()
  const scene = createScene('follow:A:B')

  renderStore.applyScene(scene.render)
  const graph = renderStore.getGraph()
  const firstNodeAttributes = graph.getNodeAttributes('A')
  const firstEdgeAttributes = graph.getEdgeAttributes('follow:A:B')

  renderStore.applyScene(scene.render)

  assert.equal(graph.getNodeAttributes('A'), firstNodeAttributes)
  assert.equal(graph.getEdgeAttributes('follow:A:B'), firstEdgeAttributes)
})

test('physics store translates node positions without changing their fixed state', () => {
  const { physicsStore } = createStores()
  physicsStore.applyScene(createScene('follow:A:B').physics)

  physicsStore.setNodeFixed('A', true)
  physicsStore.translateNodePosition('A', 3, -2)

  assert.deepEqual(physicsStore.getNodePosition('A'), { x: 7, y: -2 })
  assert.equal(physicsStore.isNodeFixed('A'), true)
})

test('shared ledger reuses render positions across layer changes', () => {
  const { renderStore } = createStores()

  renderStore.applyScene(createScene('follow:A:B', 'graph').render)
  renderStore.setNodePosition('B', 10, 10)

  renderStore.applyScene(createScene('follow:A:B', 'connections').render)
  renderStore.setNodePosition('B', 100, 100)

  renderStore.applyScene(createScene('follow:A:B', 'graph').render)

  assert.deepEqual(renderStore.getNodePosition('B'), { x: 100, y: 100 })
})

test('preserves retained render node positions when rebuilding after a large topology drop', () => {
  const { renderStore } = createStores()

  renderStore.applyScene(createDenseScene(1_600).render)
  renderStore.setNodePosition('B', 40, 50)
  renderStore.applyScene(createScene('follow:A:B').render)

  const graph = renderStore.getGraph()
  assert.equal(graph.order, 2)
  assert.equal(graph.size, 1)
  assert.deepEqual(renderStore.getNodePosition('B'), { x: 40, y: 50 })
})

test('keeps positions for nodes that temporarily disappear from one layer', () => {
  const { renderStore, physicsStore } = createStores()
  const scene = createScene('follow:A:B')

  renderStore.applyScene(scene.render)
  physicsStore.applyScene(scene.physics)
  physicsStore.setNodePosition('B', 42, 24)

  physicsStore.applyScene({
    nodes: [],
    edges: [],
    diagnostics: {
      nodeCount: 0,
      edgeCount: 0,
      topologySignature: 'empty',
    },
  })
  physicsStore.applyScene(scene.physics)

  assert.deepEqual(physicsStore.getNodePosition('B'), { x: 42, y: 24 })
})

test('projects selected neighborhoods into prominent render attributes', () => {
  const { renderStore } = createStores()
  const scene = createScene('follow:A:B')
  scene.render.nodes = scene.render.nodes.map((node) =>
    node.pubkey === 'A'
      ? {
          ...node,
          color: '#ffb25b',
          size: 18,
          isSelected: true,
          focusState: 'selected',
        }
      : {
          ...node,
          color: '#f8f2a2',
          size: 13,
          isNeighbor: true,
          focusState: 'neighbor',
        },
  )
  scene.render.visibleEdges = scene.render.visibleEdges.map((edge) => ({
    ...edge,
    color: '#f4fbff',
    size: 2.7,
    touchesFocus: true,
  }))

  renderStore.applyScene(scene.render)

  const graph = renderStore.getGraph()
  const selected = graph.getNodeAttributes('A')
  const neighbor = graph.getNodeAttributes('B')
  const edge = graph.getEdgeAttributes('follow:A:B')

  assert.equal(selected.highlighted, true)
  assert.equal(selected.forceLabel, true)
  assert.equal(selected.zIndex, 8)
  assert.equal(neighbor.highlighted, true)
  assert.equal(neighbor.forceLabel, false)
  assert.equal(neighbor.zIndex, 5)
  assert.equal(edge.touchesFocus, true)
  assert.equal(edge.zIndex, 6)
})

test('does not promote semantic selection without visual focus state', () => {
  const { renderStore } = createStores()
  const scene = createScene('follow:A:B')
  scene.render.nodes = scene.render.nodes.map((node) =>
    node.pubkey === 'B'
      ? {
          ...node,
          isSelected: true,
          focusState: 'idle',
        }
      : node,
  )
  scene.render.selection = {
    selectedNodePubkey: 'B',
    hoveredNodePubkey: null,
  }

  renderStore.applyScene(scene.render)

  const semanticSelection = renderStore.getGraph().getNodeAttributes('B')

  assert.equal(semanticSelection.isSelected, true)
  assert.equal(semanticSelection.highlighted, false)
  assert.equal(semanticSelection.forceLabel, true)
  assert.equal(semanticSelection.zIndex, 0)
})
