import assert from 'node:assert/strict'
import test from 'node:test'

import type { CanonicalGraphSceneState } from '@/features/graph-v2/domain/types'
import {
  createExpansionAutoFitRequest,
  shouldClearExpansionAutoFitRequest,
  shouldRunExpansionAutoFit,
  shouldScheduleExpansionAutoFit,
} from '@/features/graph-v2/ui/expansionAutoFit'

const createSceneState = (
  overrides: Partial<CanonicalGraphSceneState> = {},
): CanonicalGraphSceneState => ({
  nodesByPubkey: {
    alice: {
      pubkey: 'alice',
      label: 'Alice',
      picture: null,
      about: null,
      nip05: null,
      lud16: null,
      source: 'root',
      discoveredAt: null,
      keywordHits: 0,
      profileEventId: null,
      profileFetchedAt: null,
      profileSource: null,
      profileState: 'ready',
      isExpanded: false,
      nodeExpansionState: null,
    },
  },
  edgesById: {},
  sceneSignature: 'root|graph|0',
  topologySignature: 'root|graph|0',
  nodeVisualRevision: 0,
  nodeDetailRevision: 0,
  rootPubkey: 'alice',
  activeLayer: 'graph',
  connectionsSourceLayer: 'graph',
  selectedNodePubkey: 'alice',
  pinnedNodePubkeys: new Set<string>(),
  discoveryState: {
    expandedNodePubkeys: new Set<string>(),
    graphRevision: 0,
    inboundGraphRevision: 0,
    connectionsLinksRevision: 0,
  },
  ...overrides,
})

test('expansion auto-fit waits until the requested node is expanded and the scene is settled', () => {
  const before = createSceneState()
  const request = createExpansionAutoFitRequest('alice', before)

  assert.equal(shouldRunExpansionAutoFit(request, before, false), false)

  const expandedButPending = createSceneState({
    sceneSignature: 'root|graph|1',
    discoveryState: {
      ...before.discoveryState,
      expandedNodePubkeys: new Set<string>(['alice']),
      graphRevision: 1,
    },
  })

  assert.equal(
    shouldRunExpansionAutoFit(request, expandedButPending, true),
    false,
  )
  assert.equal(
    shouldRunExpansionAutoFit(request, expandedButPending, false),
    true,
  )
})

test('expansion auto-fit ignores scene-only churn when topology did not change', () => {
  const before = createSceneState()
  const request = createExpansionAutoFitRequest('alice', before)

  const sceneOnlyChange = createSceneState({
    sceneSignature: 'root|graph|selection-cleared',
    selectedNodePubkey: null,
    nodeVisualRevision: 1,
  })

  assert.equal(
    shouldRunExpansionAutoFit(request, sceneOnlyChange, false),
    false,
  )
})

test('expansion auto-fit ignores unrelated expansions and clears failed requests', () => {
  const before = createSceneState()
  const request = createExpansionAutoFitRequest('alice', before)

  const unrelatedExpansion = createSceneState({
    sceneSignature: 'root|graph|bob-expanded',
    discoveryState: {
      ...before.discoveryState,
      expandedNodePubkeys: new Set<string>(['bob']),
      graphRevision: 1,
    },
  })
  assert.equal(
    shouldRunExpansionAutoFit(request, unrelatedExpansion, false),
    false,
  )

  const failed = createSceneState({
    nodesByPubkey: {
      ...before.nodesByPubkey,
      alice: {
        ...before.nodesByPubkey.alice,
        nodeExpansionState: {
          status: 'error',
          phase: 'idle',
          step: null,
          totalSteps: null,
          message: 'No se pudo expandir.',
          startedAt: null,
          updatedAt: 1,
        },
      },
    },
  })
  assert.equal(shouldClearExpansionAutoFitRequest(request, failed), true)
})

test('expansion auto-fit scheduling stays disabled on mobile viewports', () => {
  assert.equal(
    shouldScheduleExpansionAutoFit({
      isExpanded: false,
      isFixtureMode: false,
      isMobileViewport: false,
    }),
    true,
  )

  assert.equal(
    shouldScheduleExpansionAutoFit({
      isExpanded: false,
      isFixtureMode: false,
      isMobileViewport: true,
    }),
    false,
  )

  assert.equal(
    shouldScheduleExpansionAutoFit({
      isExpanded: true,
      isFixtureMode: false,
      isMobileViewport: false,
    }),
    false,
  )
})
