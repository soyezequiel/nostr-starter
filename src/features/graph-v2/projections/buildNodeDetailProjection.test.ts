import assert from 'node:assert/strict'
import test from 'node:test'

import type { CanonicalGraphState } from '@/features/graph-v2/domain/types'
import { buildNodeDetailProjection } from '@/features/graph-v2/projections/buildNodeDetailProjection'

const createState = (
  overrides: Partial<CanonicalGraphState> = {},
): CanonicalGraphState => ({
  nodesByPubkey: {
    root: {
      pubkey: 'root',
      label: 'Root',
      picture: null,
      about: null,
      nip05: null,
      lud16: null,
      source: 'root',
      discoveredAt: 0,
      keywordHits: 0,
      profileEventId: null,
      profileFetchedAt: null,
      profileSource: null,
      profileState: 'ready',
      isExpanded: true,
      nodeExpansionState: null,
    },
  },
  edgesById: {},
  sceneSignature: 'detail-test-scene',
  rootPubkey: 'root',
  activeLayer: 'graph',
  connectionsSourceLayer: 'following',
  selectedNodePubkey: 'root',
  pinnedNodePubkeys: new Set<string>(),
  relayState: {
    urls: [],
    endpoints: {},
    overrideStatus: 'idle',
    isGraphStale: false,
  },
  discoveryState: {
    rootLoad: {
      status: 'ready',
      message: null,
      loadedFrom: 'live',
      visibleLinkProgress: null,
    },
    expandedNodePubkeys: new Set<string>(['root']),
    graphRevision: 1,
    inboundGraphRevision: 0,
    connectionsLinksRevision: 0,
  },
  ...overrides,
})

test('allows toggling the root pin state through the same detail model', () => {
  const detail = buildNodeDetailProjection(
    createState({
      pinnedNodePubkeys: new Set<string>(['root']),
    }),
  )

  assert.equal(detail.pubkey, 'root')
  assert.equal(detail.isPinned, true)
  assert.equal(detail.isFixed, true)
  assert.equal(detail.canTogglePin, true)
})
