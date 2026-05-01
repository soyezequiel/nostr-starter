import assert from 'node:assert/strict'
import test from 'node:test'

import { applyVisibleEdgeCountLabels } from '@/features/graph-v2/projections/applyVisibleEdgeCountLabels'
import type { GraphSceneSnapshot } from '@/features/graph-v2/renderer/contracts'

const createScene = (): GraphSceneSnapshot => ({
  render: {
    nodes: [
      {
        pubkey: 'root',
        label: 'Root',
        pictureUrl: null,
        color: '#fff',
        size: 12,
        isExpanding: false,
        expansionProgress: null,
        isRoot: true,
        isSelected: false,
        isPinned: false,
        isNeighbor: false,
        isDimmed: false,
        focusState: 'root',
      },
      {
        pubkey: 'alice',
        label: 'Alice',
        pictureUrl: null,
        color: '#fff',
        size: 10,
        isExpanding: false,
        expansionProgress: null,
        isRoot: false,
        isSelected: false,
        isPinned: false,
        isNeighbor: true,
        isDimmed: false,
        focusState: 'neighbor',
      },
      {
        pubkey: 'bob',
        label: 'Bob',
        pictureUrl: null,
        color: '#fff',
        size: 10,
        isExpanding: false,
        expansionProgress: null,
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
        id: 'root->alice',
        source: 'root',
        target: 'alice',
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
        id: 'alice->root',
        source: 'alice',
        target: 'root',
        color: '#8fb6ff',
        size: 1,
        hidden: false,
        relation: 'inbound',
        weight: 1,
        opacityScale: 1,
        isDimmed: false,
        touchesFocus: false,
      },
      {
        id: 'root->bob:hidden',
        source: 'root',
        target: 'bob',
        color: '#8fb6ff',
        size: 1,
        hidden: true,
        relation: 'follow',
        weight: 1,
        isDimmed: false,
        touchesFocus: false,
      },
    ],
    labels: [
      { pubkey: 'root', text: 'Root' },
      { pubkey: 'alice', text: 'Alice' },
      { pubkey: 'bob', text: 'Bob' },
    ],
    selection: {
      selectedNodePubkey: null,
      hoveredNodePubkey: null,
    },
    pins: {
      pubkeys: [],
    },
    cameraHint: {
      focusPubkey: 'root',
      rootPubkey: 'root',
    },
    diagnostics: {
      activeLayer: 'graph',
      nodeCount: 3,
      visibleEdgeCount: 2,
      topologySignature: 'test-scene',
    },
  },
  physics: {
    nodes: [],
    edges: [],
    diagnostics: {
      nodeCount: 0,
      edgeCount: 0,
      topologySignature: 'test-physics',
    },
  },
})

test('keeps the scene unchanged when visible edge count labels are disabled', () => {
  const scene = createScene()

  assert.equal(applyVisibleEdgeCountLabels(scene, false), scene)
})

test('labels every node with its current visible incident edge count', () => {
  const scene = applyVisibleEdgeCountLabels(createScene(), true)

  assert.deepEqual(
    scene.render.nodes.map((node) => [node.pubkey, node.label, node.forceLabel]),
    [
      ['root', '2', true],
      ['alice', '2', true],
      ['bob', '0', true],
    ],
  )
  assert.deepEqual(scene.render.labels, [
    { pubkey: 'root', text: '2' },
    { pubkey: 'alice', text: '2' },
    { pubkey: 'bob', text: '0' },
  ])
})
