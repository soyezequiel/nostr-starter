import assert from 'node:assert/strict'
import test from 'node:test'

import type { GraphSceneSnapshot } from '@/features/graph-v2/renderer/contracts'
import {
  createDragNeighborhoodInfluenceState,
  dampInfluenceVelocities,
  DEFAULT_DRAG_NEIGHBORHOOD_INFLUENCE_CONFIG,
  releaseDraggedNode,
  stepDragNeighborhoodInfluence,
} from '@/features/graph-v2/renderer/dragInfluence'
import {
  NodePositionLedger,
  PhysicsGraphStore,
} from '@/features/graph-v2/renderer/graphologyProjectionStore'

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
      {
        pubkey: 'C',
        label: 'C',
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
      {
        pubkey: 'E',
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
      },
      {
        pubkey: 'F',
        label: 'F',
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
        id: 'follow:A:B',
        source: 'A',
        target: 'B',
        color: '#8fb6ff',
        size: 1,
        hidden: false,
        relation: 'follow',
        weight: 1,
        opacityScale: 1,
        isDimmed: false,
        touchesFocus: false,
      },
      {
        id: 'follow:B:C',
        source: 'B',
        target: 'C',
        color: '#8fb6ff',
        size: 1,
        hidden: false,
        relation: 'follow',
        weight: 1,
        opacityScale: 1,
        isDimmed: false,
        touchesFocus: false,
      },
      {
        id: 'follow:D:E',
        source: 'D',
        target: 'E',
        color: '#8fb6ff',
        size: 1,
        hidden: false,
        relation: 'follow',
        weight: 1,
        isDimmed: false,
        touchesFocus: false,
      },
      {
        id: 'follow:C:F',
        source: 'C',
        target: 'F',
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
      activeLayer: 'graph',
      nodeCount: 6,
      visibleEdgeCount: 4,
      relayCount: 0,
      isGraphStale: false,
      topologySignature: 'drag-influence-render',
    },
  },
  physics: {
    nodes: [
      { pubkey: 'A', size: 10, fixed: false },
      { pubkey: 'B', size: 10, fixed: false },
      { pubkey: 'C', size: 10, fixed: false },
      { pubkey: 'D', size: 10, fixed: false },
      { pubkey: 'E', size: 10, fixed: false },
      { pubkey: 'F', size: 10, fixed: false },
    ],
    edges: [
      {
        id: 'follow:A:B',
        source: 'A',
        target: 'B',
        weight: 1,
      },
      {
        id: 'follow:B:C',
        source: 'B',
        target: 'C',
        weight: 1,
      },
      {
        id: 'follow:D:E',
        source: 'D',
        target: 'E',
        weight: 1,
      },
      {
        id: 'follow:C:F',
        source: 'C',
        target: 'F',
        weight: 1,
      },
    ],
    diagnostics: {
      nodeCount: 6,
      edgeCount: 4,
      topologySignature: 'drag-influence-scene',
    },
  },
})

const createStore = () => {
  const ledger = new NodePositionLedger()
  const store = new PhysicsGraphStore(ledger)
  store.applyScene(createScene().physics)
  // Place nodes on a predictable line so rest lengths are deterministic.
  store.setNodePosition('A', 0, 0)
  store.setNodePosition('B', 10, 0)
  store.setNodePosition('C', 20, 0)
  store.setNodePosition('F', 30, 0)
  store.setNodePosition('D', 200, 200) // disconnected component, unreachable from A
  store.setNodePosition('E', 210, 200)
  return store
}

test('uses an Obsidian-like drag tuning preset by default', () => {
  assert.equal(DEFAULT_DRAG_NEIGHBORHOOD_INFLUENCE_CONFIG.edgeStiffness, 0.09)
  assert.equal(
    DEFAULT_DRAG_NEIGHBORHOOD_INFLUENCE_CONFIG.anchorStiffnessPerHop,
    0.0055,
  )
  assert.equal(DEFAULT_DRAG_NEIGHBORHOOD_INFLUENCE_CONFIG.baseDamping, 0.90)
  assert.equal(DEFAULT_DRAG_NEIGHBORHOOD_INFLUENCE_CONFIG.maxVelocityPerFrame, 6)
  assert.equal(DEFAULT_DRAG_NEIGHBORHOOD_INFLUENCE_CONFIG.maxTranslationPerFrame, 7)
  assert.equal(
    DEFAULT_DRAG_NEIGHBORHOOD_INFLUENCE_CONFIG.dragRepulsionStrength,
    3.2,
  )
  assert.equal(DEFAULT_DRAG_NEIGHBORHOOD_INFLUENCE_CONFIG.dragRepulsionRadius, 54)
  assert.equal(
    DEFAULT_DRAG_NEIGHBORHOOD_INFLUENCE_CONFIG.dragRepulsionDecayDistance,
    14,
  )
  assert.equal(DEFAULT_DRAG_NEIGHBORHOOD_INFLUENCE_CONFIG.dragRepulsionPadding, 8)
  assert.equal(
    DEFAULT_DRAG_NEIGHBORHOOD_INFLUENCE_CONFIG.dragRepulsionAnchorStiffness,
    0.006,
  )
  assert.equal(
    DEFAULT_DRAG_NEIGHBORHOOD_INFLUENCE_CONFIG.maxRepulsionTranslationPerFrame,
    7,
  )
  assert.equal(DEFAULT_DRAG_NEIGHBORHOOD_INFLUENCE_CONFIG.dragRepulsionCandidateCap, 160)
})

test('collects hop-connected nodes and builds spring edges between them', () => {
  const store = createStore()
  const state = createDragNeighborhoodInfluenceState(
    store,
    'A',
    new Map([
      ['A', 0],
      ['B', 1],
      ['C', 2],
      ['F', 3],
    ]),
  )

  assert.equal(state.nodes.size, 3)
  assert.ok(state.nodes.has('B'))
  assert.ok(state.nodes.has('C'))
  assert.ok(state.nodes.has('F'))
  // Spring edges between every consecutive pair included in the set.
  const edgePairs = state.edges.map(
    (edge) =>
      [edge.sourcePubkey, edge.targetPubkey].sort().join('::'),
  )
  assert.ok(edgePairs.includes('A::B'))
  assert.ok(edgePairs.includes('B::C'))
  assert.ok(edgePairs.includes('C::F'))
  assert.ok(!state.repelledNodes.has('B'))
  assert.ok(!state.repelledNodes.has('C'))
  assert.ok(!state.repelledNodes.has('F'))
  // Rest lengths equal the initial geometric distance.
  const edgeAB = state.edges.find(
    (edge) =>
      (edge.sourcePubkey === 'A' && edge.targetPubkey === 'B') ||
      (edge.sourcePubkey === 'B' && edge.targetPubkey === 'A'),
  )
  assert.ok(edgeAB)
  assert.equal(Math.round(edgeAB!.restLength), 10)
})

test('caps repelled candidates while preserving hop-connected neighbors', () => {
  const store = createStore()
  const graph = store.getGraph()
  for (let index = 0; index < 8; index += 1) {
    const pubkey = `R${index}`
    graph.addNode(pubkey, {
      x: 2 + index,
      y: 0,
      size: 10,
      fixed: false,
    })
    store.setNodePosition(pubkey, 2 + index, 0)
  }

  const state = createDragNeighborhoodInfluenceState(
    store,
    'A',
    new Map([
      ['A', 0],
      ['B', 1],
    ]),
    {
      ...DEFAULT_DRAG_NEIGHBORHOOD_INFLUENCE_CONFIG,
      dragRepulsionCandidateCap: 3,
    },
  )

  assert.equal(state.repelledNodes.size, 3)
  assert.ok(state.nodes.has('B'))
  assert.ok(!state.repelledNodes.has('B'))
  assert.deepEqual([...state.repelledNodes.keys()], ['R0', 'R1', 'R2'])
})

test('chain propagation moves the reachable neighborhood without unbounded jumps', () => {
  const store = createStore()
  const state = createDragNeighborhoodInfluenceState(
    store,
    'A',
    new Map([
      ['A', 0],
      ['B', 1],
      ['C', 2],
      ['F', 3],
    ]),
  )

  const beforeB = store.getNodePosition('B')!
  const beforeC = store.getNodePosition('C')!
  const beforeF = store.getNodePosition('F')!

  // Pin A somewhere far.
  store.setNodePosition('A', 40, 0, true)

  let lastStep = stepDragNeighborhoodInfluence(
    store,
    'A',
    state,
    16,
    DEFAULT_DRAG_NEIGHBORHOOD_INFLUENCE_CONFIG,
  )
  for (let index = 1; index < 8; index += 1) {
    lastStep = stepDragNeighborhoodInfluence(
      store,
      'A',
      state,
      16,
      DEFAULT_DRAG_NEIGHBORHOOD_INFLUENCE_CONFIG,
    )
  }

  const afterB = store.getNodePosition('B')!
  const afterC = store.getNodePosition('C')!
  const afterF = store.getNodePosition('F')!

  const bDisplacement = Math.hypot(afterB.x - beforeB.x, afterB.y - beforeB.y)
  const cDisplacement = Math.hypot(afterC.x - beforeC.x, afterC.y - beforeC.y)
  const fDisplacement = Math.hypot(afterF.x - beforeF.x, afterF.y - beforeF.y)

  assert.ok(bDisplacement > 0)
  assert.ok(cDisplacement > 0)
  assert.ok(fDisplacement > 0)
  assert.ok(lastStep.dirtyPubkeys.includes('B'))
  assert.ok(lastStep.dirtyPubkeys.includes('C'))
  assert.ok(lastStep.dirtyPubkeys.includes('F'))
  assert.ok(bDisplacement <= DEFAULT_DRAG_NEIGHBORHOOD_INFLUENCE_CONFIG.maxTranslationPerFrame * 8)
  assert.ok(cDisplacement <= DEFAULT_DRAG_NEIGHBORHOOD_INFLUENCE_CONFIG.maxTranslationPerFrame * 8)
  assert.ok(fDisplacement <= DEFAULT_DRAG_NEIGHBORHOOD_INFLUENCE_CONFIG.maxTranslationPerFrame * 8)
})

test('leaves disconnected nodes untouched even when they are in the hop map', () => {
  const store = createStore()
  // D is in a separate component; the spring network has no edges to it.
  const state = createDragNeighborhoodInfluenceState(
    store,
    'A',
    new Map([
      ['A', 0],
      ['B', 1],
      ['D', 1],
    ]),
  )

  const beforeD = store.getNodePosition('D')!
  store.setNodePosition('A', 80, 0, true)

  for (let index = 0; index < 6; index += 1) {
    stepDragNeighborhoodInfluence(store, 'A', state, 16)
  }

  const afterD = store.getNodePosition('D')!
  // D has anchor force only (no edge force) — it should stay near its initial
  // position because it starts at rest.
  assert.equal(afterD.x, beforeD.x)
  assert.equal(afterD.y, beforeD.y)
})

test('repels nearby disconnected nodes while the dragged node is moving', () => {
  const store = createStore()
  store.setNodePosition('A', 40, 0, true)
  store.setNodePosition('D', 42, 0)
  const state = createDragNeighborhoodInfluenceState(
    store,
    'A',
    new Map([['A', 0]]),
  )
  const beforeD = store.getNodePosition('D')!

  const result = stepDragNeighborhoodInfluence(store, 'A', state, 16)
  const afterD = store.getNodePosition('D')!

  assert.equal(result.translated, true)
  assert.ok(afterD.x > beforeD.x)
  assert.equal(afterD.y, beforeD.y)
})

test('drops drag repulsion exponentially with distance', () => {
  const store = createStore()
  store.setNodePosition('A', 40, 0, true)
  store.setNodePosition('D', 42, 0)
  store.setNodePosition('E', 84, 0)
  const state = createDragNeighborhoodInfluenceState(
    store,
    'A',
    new Map([['A', 0]]),
  )
  const beforeD = store.getNodePosition('D')!
  const beforeE = store.getNodePosition('E')!

  stepDragNeighborhoodInfluence(store, 'A', state, 16)

  const afterD = store.getNodePosition('D')!
  const afterE = store.getNodePosition('E')!
  const nearDisplacement = Math.hypot(afterD.x - beforeD.x, afterD.y - beforeD.y)
  const farDisplacement = Math.hypot(afterE.x - beforeE.x, afterE.y - beforeE.y)

  assert.ok(nearDisplacement > farDisplacement * 10)
})

test('cuts drag repulsion to zero outside the configured radius', () => {
  const store = createStore()
  store.setNodePosition('A', 40, 0, true)
  store.setNodePosition('D', 95, 0)
  const state = createDragNeighborhoodInfluenceState(
    store,
    'A',
    new Map([['A', 0]]),
  )
  const beforeD = store.getNodePosition('D')!

  stepDragNeighborhoodInfluence(store, 'A', state, 16)

  assert.deepEqual(store.getNodePosition('D'), beforeD)
})

test('keeps repelled nodes bounded under repeated drag pressure', () => {
  const store = createStore()
  store.setNodePosition('A', 40, 0, true)
  store.setNodePosition('D', 42, 0)
  const state = createDragNeighborhoodInfluenceState(
    store,
    'A',
    new Map([['A', 0]]),
  )
  const beforeD = store.getNodePosition('D')!

  for (let index = 0; index < 180; index += 1) {
    stepDragNeighborhoodInfluence(store, 'A', state, 16)
  }

  const afterD = store.getNodePosition('D')!
  const displacement = Math.hypot(afterD.x - beforeD.x, afterD.y - beforeD.y)

  assert.ok(displacement > 0)
  assert.ok(displacement < DEFAULT_DRAG_NEIGHBORHOOD_INFLUENCE_CONFIG.dragRepulsionRadius * 2)
})

test('pulls repelled nodes back toward equilibrium when drag pressure leaves', () => {
  const store = createStore()
  store.setNodePosition('A', 40, 0, true)
  store.setNodePosition('D', 42, 0)
  const state = createDragNeighborhoodInfluenceState(
    store,
    'A',
    new Map([['A', 0]]),
  )
  const initialD = store.getNodePosition('D')!

  for (let index = 0; index < 24; index += 1) {
    stepDragNeighborhoodInfluence(store, 'A', state, 16)
  }

  const pushedD = store.getNodePosition('D')!
  store.setNodePosition('A', -300, 0, true)

  for (let index = 0; index < 120; index += 1) {
    stepDragNeighborhoodInfluence(store, 'A', state, 16)
  }

  const settledD = store.getNodePosition('D')!
  const pushedDistance = Math.hypot(pushedD.x - initialD.x, pushedD.y - initialD.y)
  const settledDistance = Math.hypot(
    settledD.x - initialD.x,
    settledD.y - initialD.y,
  )

  assert.ok(pushedDistance > 0)
  assert.ok(settledDistance < pushedDistance)
})

test('does not move fixed nodes with drag repulsion', () => {
  const store = createStore()
  const state = createDragNeighborhoodInfluenceState(
    store,
    'A',
    new Map([['A', 0]]),
  )

  store.setNodePosition('A', 40, 0, true)
  store.setNodePosition('D', 42, 0)
  store.setNodeFixed('D', true)
  const beforeD = store.getNodePosition('D')!

  stepDragNeighborhoodInfluence(store, 'A', state, 16)

  assert.deepEqual(store.getNodePosition('D'), beforeD)
})

test('keeps fixed neighbors untouched while drag repulsion still affects nearby nodes', () => {
  const store = createStore()
  const state = createDragNeighborhoodInfluenceState(
    store,
    'A',
    new Map([
      ['A', 0],
      ['B', 1],
      ['C', 2],
    ]),
  )
  const beforeB = store.getNodePosition('B')!
  const beforeC = store.getNodePosition('C')!

  store.setNodeFixed('B', true)
  store.setNodePosition('A', 60, 0, true)

  for (let index = 0; index < 10; index += 1) {
    stepDragNeighborhoodInfluence(store, 'A', state, 16)
  }

  assert.deepEqual(store.getNodePosition('B'), beforeB)
  assert.ok(store.getNodePosition('C')!.x < beforeC.x)
  assert.equal(store.isNodeFixed('B'), true)
})

test('releases the dragged node back to unfixed when it was not pinned', () => {
  const store = createStore()

  store.setNodeFixed('A', true)
  releaseDraggedNode(store, 'A', [])

  assert.equal(store.isNodeFixed('A'), false)
})

test('keeps the dragged node fixed after release when it remains pinned', () => {
  const store = createStore()

  store.setNodeFixed('A', true)
  releaseDraggedNode(store, 'A', ['A'])

  assert.equal(store.isNodeFixed('A'), true)
})

test('dampInfluenceVelocities multiplies all node velocities by the given factor', () => {
  const store = createStore()
  const state = createDragNeighborhoodInfluenceState(
    store,
    'A',
    new Map([
      ['A', 0],
      ['B', 1],
      ['C', 2],
    ]),
  )

  store.setNodePosition('A', 40, 0, true)
  stepDragNeighborhoodInfluence(store, 'A', state, 16)

  // After one step B and C should have non-zero velocities.
  const bState = state.nodes.get('B')!
  const cState = state.nodes.get('C')!
  const bSpeedBefore = Math.hypot(bState.velocityX, bState.velocityY)
  const cSpeedBefore = Math.hypot(cState.velocityX, cState.velocityY)

  dampInfluenceVelocities(state, 0.2)

  const bSpeedAfter = Math.hypot(bState.velocityX, bState.velocityY)
  const cSpeedAfter = Math.hypot(cState.velocityX, cState.velocityY)

  assert.ok(bSpeedAfter < bSpeedBefore * 0.5)
  assert.ok(cSpeedAfter < cSpeedBefore * 0.5)
})
