import assert from 'node:assert/strict'
import test from 'node:test'


import {
  NodePositionLedger,
  PhysicsGraphStore,
  RenderGraphStore,
  type RenderNodeAttributes,
  type RenderEdgeAttributes,
} from '@/features/graph-v2/renderer/graphologyProjectionStore'
import type {
  GraphSceneSnapshot,
  GraphSceneFocusState,
} from '@/features/graph-v2/renderer/contracts'
import { SigmaRendererAdapter } from '@/features/graph-v2/renderer/SigmaRendererAdapter'

/**
 * Focus parity tests: verify that drag and selection produce identical
 * visual focus for the same node through the single resolveRendererFocus()
 * path. The only intentional difference is edge LOD: drag hides non-focus
 * edges for performance while selection dims them.
 */

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
        focusState: 'root' as GraphSceneFocusState,
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
        focusState: 'idle' as GraphSceneFocusState,
      },
    ],
    visibleEdges: [],
    labels: [
      { pubkey: 'A', text: 'A' },
      { pubkey: 'D', text: 'D' },
    ],
    selection: {
      selectedNodePubkey: null,
      hoveredNodePubkey: null,
    },
    pins: { pubkeys: [] },
    cameraHint: {
      focusPubkey: null,
      rootPubkey: 'A',
    },
    diagnostics: {
      activeLayer: 'graph',
      nodeCount: 2,
      visibleEdgeCount: 0,
      topologySignature: 'A::graph::0::0::0::2::0',
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
      topologySignature: 'A::graph::0::0::0::2::0',
    },
  },
})

type FocusSnapshot = { pubkey: string | null; neighbors: Set<string> }

type FocusHarness = {
  renderStore: InstanceType<typeof RenderGraphStore>
  draggedNodePubkey: string | null
  draggedNodeFocus: FocusSnapshot
  currentHoverFocus: FocusSnapshot
  selectedSceneFocus: FocusSnapshot
  createFocusSnapshot: (
    pubkey: string | null,
    options?: { requireNode?: boolean },
  ) => FocusSnapshot
  resolveRendererFocus: () => FocusSnapshot
}

type NodeReducerHarness = FocusHarness & {
  sigma: { getCamera: () => { ratio: number } }
  highlightTransition: null
  nodeReducer: (node: string, data: RenderNodeAttributes) => RenderNodeAttributes
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
  draggedNodeFocus: FocusSnapshot
  currentHoverFocus: FocusSnapshot
  selectedSceneFocus: FocusSnapshot
  safeRender: () => void
  setHideConnectionsForLowPerformance: (enabled: boolean) => void
  edgeReducer: (
    edge: string,
    data: RenderEdgeAttributes,
  ) => {
    size: number
    color: string
    hidden: boolean
    zIndex: number
  }
}

test('drag and selection resolve identical focus neighbors for the same node', () => {
  const ledger = new NodePositionLedger()
  const renderStore = new RenderGraphStore(ledger)
  const scene = createScene()
  const sceneWithEdges: GraphSceneSnapshot = {
    ...scene,
    render: {
      ...scene.render,
      nodes: [
        ...scene.render.nodes,
        {
          pubkey: 'B',
          label: 'B',
          pictureUrl: null,
          color: '#8ebfc7',
          size: 9,
          isRoot: false,
          isSelected: false,
          isPinned: false,
          isNeighbor: false,
          isDimmed: false,
          focusState: 'idle' as GraphSceneFocusState,
        },
        {
          pubkey: 'C',
          label: 'C',
          pictureUrl: null,
          color: '#91abc8',
          size: 9,
          isRoot: false,
          isSelected: false,
          isPinned: false,
          isNeighbor: false,
          isDimmed: false,
          focusState: 'idle' as GraphSceneFocusState,
        },
      ],
      visibleEdges: [
        {
          id: 'D->B',
          source: 'D',
          target: 'B',
          color: '#64b5ff',
          size: 1.1,
          hidden: false,
          relation: 'follow',
          weight: 1,
          isDimmed: false,
          touchesFocus: false,
        },
        {
          id: 'D->C',
          source: 'D',
          target: 'C',
          color: '#64b5ff',
          size: 1.1,
          hidden: false,
          relation: 'follow',
          weight: 1,
          isDimmed: false,
          touchesFocus: false,
        },
      ],
      selection: {
        selectedNodePubkey: 'D',
        hoveredNodePubkey: null,
      },
    },
  }

  renderStore.applyScene(sceneWithEdges.render)

  const adapter = new SigmaRendererAdapter() as unknown as FocusHarness
  adapter.renderStore = renderStore

  // Selection focus for node D.
  const selectionFocus = adapter.createFocusSnapshot('D', { requireNode: true })
  adapter.selectedSceneFocus = selectionFocus
  adapter.currentHoverFocus = { pubkey: null, neighbors: new Set() }
  adapter.draggedNodePubkey = null
  const selectionResult = adapter.resolveRendererFocus()

  // Drag focus for the same node D.
  const dragFocus = adapter.createFocusSnapshot('D', { requireNode: true })
  adapter.draggedNodeFocus = dragFocus
  adapter.draggedNodePubkey = 'D'
  const dragResult = adapter.resolveRendererFocus()

  // Both must resolve the same pubkey and neighbor set.
  assert.equal(selectionResult.pubkey, 'D')
  assert.equal(dragResult.pubkey, 'D')
  assert.deepEqual(
    Array.from(selectionResult.neighbors).sort(),
    Array.from(dragResult.neighbors).sort(),
  )
  assert.deepEqual(
    Array.from(selectionResult.neighbors).sort(),
    ['B', 'C'],
  )
})

test('drag node reducer keeps the full graph visible without dimming non-neighbors', () => {
  const adapter = new SigmaRendererAdapter() as unknown as NodeReducerHarness
  adapter.sigma = { getCamera: () => ({ ratio: 1 }) }
  adapter.highlightTransition = null

  const neighbors = new Set(['B', 'C'])
  const baseNode: RenderNodeAttributes = {
    x: 0,
    y: 0,
    size: 10,
    color: '#8ebfc7',
    focusState: 'idle',
    label: 'target',
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
  const neighborNode: RenderNodeAttributes = {
    ...baseNode,
    label: 'neighbor',
    color: '#91abc8',
  }
  const outsiderNode: RenderNodeAttributes = {
    ...baseNode,
    label: 'outsider',
    color: '#b29ecf',
  }

  // Drag path: ya no entramos en modo focus, así que ningún nodo se oscurece.
  adapter.draggedNodePubkey = 'A'
  adapter.draggedNodeFocus = { pubkey: 'A', neighbors }
  adapter.currentHoverFocus = { pubkey: null, neighbors: new Set() }
  adapter.selectedSceneFocus = { pubkey: null, neighbors: new Set() }
  const dragFocused = adapter.nodeReducer('A', baseNode)
  const dragNeighbor = adapter.nodeReducer('B', neighborNode)
  const dragOutsider = adapter.nodeReducer('X', outsiderNode)

  // Todos conservan su color base — nada queda atenuado.
  assert.equal(dragFocused.color, baseNode.color)
  assert.equal(dragNeighbor.color, neighborNode.color)
  assert.equal(dragOutsider.color, outsiderNode.color)
  assert.equal(dragFocused.highlighted, false)
  assert.equal(dragNeighbor.highlighted, false)
  assert.equal(dragOutsider.highlighted, false)
})

test('update refreshes draggedNodeFocus so drag neighbors stay in sync with render graph', () => {
  const ledger = new NodePositionLedger()
  const renderStore = new RenderGraphStore(ledger)
  const physicsStore = new PhysicsGraphStore(ledger)

  const initialScene = createScene()
  renderStore.applyScene(initialScene.render)
  physicsStore.applyScene(initialScene.physics)

  const adapter = new SigmaRendererAdapter() as unknown as {
    sigma: Record<string, never>
    scene: GraphSceneSnapshot
    renderStore: typeof renderStore
    physicsStore: typeof physicsStore
    forceRuntime: {
      sync: (
        physics: GraphSceneSnapshot['physics'],
        options?: { topologyChanged: boolean },
      ) => void
      isRunning: () => boolean
      isSuspended: () => boolean
    }
    nodeHitTester: { markDirty: () => void }
    ensurePhysicsPositionBridge: () => void
    safeRefresh: () => void
    draggedNodePubkey: string | null
    draggedNodeFocus: FocusSnapshot
    dragHopDistances: Map<string, number>
    dragInfluenceConfig: unknown
    dragInfluenceState: unknown
    lastDragGraphPosition: { x: number; y: number } | null
    currentHoverFocus: FocusSnapshot
    selectedSceneFocus: FocusSnapshot
    resolveRendererFocus: () => FocusSnapshot
    update: (scene: GraphSceneSnapshot) => void
  }

  adapter.sigma = {}
  adapter.scene = initialScene
  adapter.renderStore = renderStore
  adapter.physicsStore = physicsStore
  adapter.forceRuntime = {
    sync: () => {},
    isRunning: () => false,
    isSuspended: () => false,
  }
  adapter.nodeHitTester = { markDirty: () => {} }
  adapter.ensurePhysicsPositionBridge = () => {}
  adapter.safeRefresh = () => {}
  adapter.currentHoverFocus = { pubkey: null, neighbors: new Set() }
  adapter.selectedSceneFocus = { pubkey: null, neighbors: new Set() }

  // Start a drag on node D — no edges yet, so no neighbors.
  adapter.draggedNodePubkey = 'D'
  adapter.draggedNodeFocus = { pubkey: 'D', neighbors: new Set() }
  adapter.lastDragGraphPosition = { x: 5, y: 5 }

  assert.equal(adapter.resolveRendererFocus().neighbors.size, 0)

  // Push an update that adds an edge D->E.
  const updatedScene: GraphSceneSnapshot = {
    ...initialScene,
    render: {
      ...initialScene.render,
      nodes: [
        ...initialScene.render.nodes,
        {
          pubkey: 'E',
          label: 'E',
          pictureUrl: null,
          color: '#91abc8',
          size: 9,
          isRoot: false,
          isSelected: false,
          isPinned: false,
          isNeighbor: false,
          isDimmed: false,
          focusState: 'idle' as GraphSceneFocusState,
        },
      ],
      visibleEdges: [
        {
          id: 'D->E',
          source: 'D',
          target: 'E',
          color: '#64b5ff',
          size: 1.1,
          hidden: false,
          relation: 'follow',
          weight: 1,
          isDimmed: false,
          touchesFocus: false,
        },
      ],
    },
    physics: {
      ...initialScene.physics,
      nodes: [
        ...initialScene.physics.nodes,
        { pubkey: 'E', size: 9, fixed: false },
      ],
      edges: [{ id: 'D->E', source: 'D', target: 'E', weight: 1 }],
    },
  }

  adapter.update(updatedScene)

  // The drag focus must now include E as a neighbor.
  const focus = adapter.resolveRendererFocus()
  assert.equal(focus.pubkey, 'D')
  assert.ok(
    focus.neighbors.has('E'),
    'drag focus neighbors should include E after graph update',
  )
})

test('avatar overlay receives identical focus for drag and selection', () => {
  const neighbors = new Set(['B', 'C'])
  const adapter = new SigmaRendererAdapter() as unknown as FocusHarness

  // Selection path.
  adapter.draggedNodePubkey = null
  adapter.selectedSceneFocus = { pubkey: 'A', neighbors }
  adapter.currentHoverFocus = { pubkey: null, neighbors: new Set() }
  const selFocus = adapter.resolveRendererFocus()

  // Drag path — same data.
  adapter.draggedNodePubkey = 'A'
  adapter.draggedNodeFocus = { pubkey: 'A', neighbors }
  const dragFocus = adapter.resolveRendererFocus()

  // The avatar overlay calls resolveRendererFocus().pubkey and .neighbors.
  assert.equal(selFocus.pubkey, dragFocus.pubkey)
  assert.equal(selFocus.pubkey, 'A')
  assert.deepEqual(
    Array.from(selFocus.neighbors).sort(),
    Array.from(dragFocus.neighbors).sort(),
  )
})

test('edge reducer: drag preserves the full graph without dimming or hiding edges', () => {
  const edgeEndpoints = new Map<string, [string, string]>([
    ['A->B', ['A', 'B']],
    ['A->C', ['A', 'C']],
    ['X->Y', ['X', 'Y']],
  ])
  const adapter = new SigmaRendererAdapter() as unknown as EdgeReducerHarness
  const baseEdge: RenderEdgeAttributes = {
    size: 1,
    color: '#64b5ff',
    hidden: false,
    label: null,
    weight: 1,
    isDimmed: false,
    touchesFocus: false,
    zIndex: 1,
  }
  const neighbors = new Set(['B', 'C'])

  adapter.sigma = {
    getGraph: () => ({
      hasEdge: (edgeId: string) => edgeEndpoints.has(edgeId),
      source: (edgeId: string) => edgeEndpoints.get(edgeId)?.[0] ?? '',
      target: (edgeId: string) => edgeEndpoints.get(edgeId)?.[1] ?? '',
    }),
  }

  // Selection path: focus edges brighten, unrelated edges stay visible (dimmed).
  adapter.draggedNodePubkey = null
  adapter.selectedSceneFocus = { pubkey: 'A', neighbors }
  adapter.currentHoverFocus = { pubkey: null, neighbors: new Set() }
  const selFocusEdge = adapter.edgeReducer('A->B', baseEdge)
  const selUnrelatedEdge = adapter.edgeReducer('X->Y', baseEdge)

  assert.equal(selFocusEdge.hidden, false)
  assert.ok(selFocusEdge.size > baseEdge.size)
  assert.equal(selUnrelatedEdge.hidden, false)

  // Drag path: el grafo entero permanece visible sin oscurecer ni resaltar.
  adapter.draggedNodePubkey = 'A'
  adapter.draggedNodeFocus = { pubkey: 'A', neighbors }
  adapter.currentHoverFocus = { pubkey: 'A', neighbors }
  const dragFocusEdge = adapter.edgeReducer('A->B', baseEdge)
  const dragUnrelatedEdge = adapter.edgeReducer('X->Y', baseEdge)

  // Drag deja todas las aristas sin modificar.
  assert.equal(dragFocusEdge.hidden, false)
  assert.equal(dragFocusEdge.color, baseEdge.color)
  assert.equal(dragFocusEdge.size, baseEdge.size)
  assert.equal(dragUnrelatedEdge.hidden, false)
  assert.equal(dragUnrelatedEdge.color, baseEdge.color)
  assert.equal(dragUnrelatedEdge.size, baseEdge.size)
})
