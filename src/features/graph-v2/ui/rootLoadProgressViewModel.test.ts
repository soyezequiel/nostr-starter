import assert from 'node:assert/strict'
import test from 'node:test'

import type { RootLoadState } from '@/features/graph-runtime/app/store/types'
import {
  buildRootLoadProgressViewModel,
  isRootLoadProgressActive,
} from '@/features/graph-v2/ui/rootLoadProgressViewModel'

const createRootLoad = (
  patch: Partial<RootLoadState> = {},
): RootLoadState => ({
  status: 'loading',
  message: 'Consultando contact list kind:3 y followers inbound en 3 relays activos...',
  loadedFrom: 'none',
  visibleLinkProgress: null,
  ...patch,
})

test('keeps unknown totals indeterminate instead of inventing a denominator', () => {
  const viewModel = buildRootLoadProgressViewModel({
    identityLabel: 'jack',
    nodeCount: 0,
    rootLoad: createRootLoad({
      visibleLinkProgress: {
        visibleLinkCount: null,
        contactListEventCount: 0,
        inboundCandidateEventCount: 0,
        lastRelayUrl: null,
        updatedAt: 1,
        following: {
          status: 'loading',
          loadedCount: 0,
          totalCount: null,
          isTotalKnown: false,
        },
        followers: {
          status: 'loading',
          loadedCount: 0,
          totalCount: null,
          isTotalKnown: false,
        },
      },
    }),
  })

  assert.equal(viewModel.title, 'Mapeando jack')
  assert.equal(viewModel.isIndeterminate, true)
  assert.equal(viewModel.progressLabel, '0 links')
  assert.equal(viewModel.phaseLabel, 'Consultar relays activos')
})

test('marks mixed known and estimated totals with an approximate label', () => {
  const viewModel = buildRootLoadProgressViewModel({
    identityLabel: 'jack',
    nodeCount: 320,
    rootLoad: createRootLoad({
      message: 'Paginando followers inbound en relay.primal.net: +40 eventos nuevos de ~432.',
      visibleLinkProgress: {
        visibleLinkCount: 188,
        contactListEventCount: 3,
        inboundCandidateEventCount: 412,
        lastRelayUrl: 'wss://relay.primal.net',
        updatedAt: 2,
        following: {
          status: 'complete',
          loadedCount: 188,
          totalCount: 188,
          isTotalKnown: true,
        },
        followers: {
          status: 'partial',
          loadedCount: 139,
          totalCount: 432,
          isTotalKnown: false,
        },
      },
    }),
  })

  assert.equal(viewModel.phaseLabel, 'Paginar followers inbound')
  assert.equal(viewModel.progressLabel, '327 / ~620 links')
  assert.equal(viewModel.isEstimatedTotal, true)
  assert.equal(viewModel.isIndeterminate, false)
  assert.ok(viewModel.percent >= 62)
  assert.deepEqual(
    viewModel.metrics.map((metric) => metric.value),
    ['188 / 188', '139 / ~432', '3 contact lists - 412 inbound', 'relay.primal.net'],
  )
})

test('reports completion only when the runtime status is complete', () => {
  const viewModel = buildRootLoadProgressViewModel({
    identityLabel: 'jack',
    nodeCount: 620,
    rootLoad: createRootLoad({
      status: 'ready',
      message: 'Grafo listo.',
      loadedFrom: 'live',
      visibleLinkProgress: {
        visibleLinkCount: 188,
        contactListEventCount: 3,
        inboundCandidateEventCount: 432,
        lastRelayUrl: 'wss://relay.primal.net',
        updatedAt: 3,
        following: {
          status: 'complete',
          loadedCount: 188,
          totalCount: 188,
          isTotalKnown: true,
        },
        followers: {
          status: 'complete',
          loadedCount: 432,
          totalCount: 432,
          isTotalKnown: true,
        },
      },
    }),
  })

  assert.equal(viewModel.percent, 100)
  assert.equal(viewModel.phaseLabel, 'Carga completa')
  assert.equal(viewModel.progressLabel, '620 / 620 links')
  assert.equal(
    viewModel.steps.every((step) => step.status === 'done'),
    true,
  )
})

test('uses plus notation when an estimated total only proves a lower bound', () => {
  const viewModel = buildRootLoadProgressViewModel({
    identityLabel: 'jack',
    nodeCount: 620,
    rootLoad: createRootLoad({
      message: 'Grafo inicial cargado. Enriqueciendo followers, perfiles y zaps...',
      status: 'partial',
      loadedFrom: 'live',
      visibleLinkProgress: {
        visibleLinkCount: 188,
        contactListEventCount: 3,
        inboundCandidateEventCount: 432,
        lastRelayUrl: 'wss://relay.primal.net',
        updatedAt: 4,
        following: {
          status: 'complete',
          loadedCount: 188,
          totalCount: 188,
          isTotalKnown: true,
        },
        followers: {
          status: 'partial',
          loadedCount: 432,
          totalCount: 432,
          isTotalKnown: false,
        },
      },
    }),
  })

  assert.equal(viewModel.progressLabel, '620+ links')
  assert.equal(viewModel.metrics[1].value, '432+')
  assert.equal(viewModel.isEstimatedTotal, true)
})

test('keeps the load HUD active while partial collections are still in flight', () => {
  assert.equal(
    isRootLoadProgressActive(
      createRootLoad({
        status: 'partial',
        loadedFrom: 'live',
        visibleLinkProgress: {
          visibleLinkCount: 188,
          contactListEventCount: 3,
          inboundCandidateEventCount: 432,
          lastRelayUrl: 'wss://relay.primal.net',
          updatedAt: 5,
          following: {
            status: 'complete',
            loadedCount: 188,
            totalCount: 188,
            isTotalKnown: true,
          },
          followers: {
            status: 'partial',
            loadedCount: 139,
            totalCount: 432,
            isTotalKnown: false,
          },
        },
      }),
    ),
    true,
  )
})

test('does not keep the load HUD alive for terminal partial coverage', () => {
  assert.equal(
    isRootLoadProgressActive(
      createRootLoad({
        status: 'partial',
        loadedFrom: 'live',
        visibleLinkProgress: {
          visibleLinkCount: 188,
          contactListEventCount: 3,
          inboundCandidateEventCount: 432,
          lastRelayUrl: 'wss://relay.primal.net',
          updatedAt: 6,
          following: {
            status: 'complete',
            loadedCount: 188,
            totalCount: 188,
            isTotalKnown: true,
          },
          followers: {
            status: 'complete',
            loadedCount: 432,
            totalCount: 432,
            isTotalKnown: false,
          },
        },
      }),
    ),
    false,
  )
})
