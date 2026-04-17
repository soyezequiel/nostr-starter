import assert from 'node:assert/strict'
import test from 'node:test'

// `tsx --test` executes this suite in CJS mode for this repo, so require keeps
// the export shape stable even though the implementation file uses ESM syntax.
/* eslint-disable @typescript-eslint/no-require-imports */
const {
  buildGraphRenderModel,
  deriveCandidateEdgeThinRank,
} = require('./buildGraphRenderModel.ts')
const baselineTestUtils = require('./graphRenderBaselineTestUtils.ts')
/* eslint-enable @typescript-eslint/no-require-imports */

const {
  DEFAULT_TEST_EFFECTIVE_GRAPH_CAPS: DEFAULT_EFFECTIVE_GRAPH_CAPS,
  DEFAULT_TEST_GRAPH_ANALYSIS: DEFAULT_GRAPH_ANALYSIS,
  DEFAULT_TEST_RENDER_CONFIG: DEFAULT_RENDER_CONFIG,
  createExpandedSharedTopologyFromFixture,
  createFiveExpandersSharedHubsFixture,
  createExpectedSharedEdgeIds,
  createFixtureEdgeIds,
  createPositionMapFromRenderNodes,
  createRenderModelInputFromFixture,
  createSyntheticExpandedIntersectionFixture,
  createThreeExpandersPartialOverlapFixture,
  createTwoExpandersStrongOverlapFixture,
  formatFixtureLayoutMetrics,
  measureFixtureLayoutMetrics,
  roundFixtureLayoutMetrics,
} = baselineTestUtils

const createCandidateEdge = ({
  id,
  source,
  target,
  relation = 'follow',
  weight = 0,
  targetSharedByExpandedCount = 0,
}) => ({
  id,
  source,
  target,
  relation,
  weight,
  sourcePosition: [0, 0],
  targetPosition: [1, 1],
  sourceRadius: 12,
  targetRadius: 12,
  isPriority: false,
  targetSharedByExpandedCount,
})

test('graph layer includes inbound-only nodes discovered during node expansion', async () => {
  const model = await buildGraphRenderModel({
    nodes: {
      root: { pubkey: 'root', keywordHits: 0, discoveredAt: 0, source: 'root' },
      expanded: {
        pubkey: 'expanded',
        keywordHits: 0,
        discoveredAt: 1,
        source: 'follow',
      },
      inboundFollower: {
        pubkey: 'inboundFollower',
        keywordHits: 0,
        discoveredAt: 2,
        source: 'inbound',
      },
    },
    links: [{ source: 'root', target: 'expanded', relation: 'follow' }],
    inboundLinks: [
      {
        source: 'inboundFollower',
        target: 'expanded',
        relation: 'inbound',
      },
    ],
    connectionsLinks: [],
    zapEdges: [],
    activeLayer: 'graph',
    connectionsSourceLayer: 'graph',
    rootNodePubkey: 'root',
    selectedNodePubkey: 'expanded',
    expandedNodePubkeys: new Set(['expanded']),
    comparedNodePubkeys: new Set(),
    pathfinding: {
      status: 'idle',
      path: null,
    },
    graphAnalysis: DEFAULT_GRAPH_ANALYSIS,
    effectiveGraphCaps: DEFAULT_EFFECTIVE_GRAPH_CAPS,
    renderConfig: DEFAULT_RENDER_CONFIG,
  })

  assert.deepEqual(
    model.nodes.map((node) => node.pubkey).sort(),
    ['expanded', 'inboundFollower', 'root'],
  )
  assert.deepEqual(
    model.edges.map((edge) => edge.id).sort(),
    ['inboundFollower->expanded:inbound', 'root->expanded:follow'],
  )
})

test('graph layer prefers authored follow evidence over inbound evidence for the same direction', async () => {
  const model = await buildGraphRenderModel({
    nodes: {
      root: { pubkey: 'root', keywordHits: 0, discoveredAt: 0, source: 'root' },
      expanded: {
        pubkey: 'expanded',
        keywordHits: 0,
        discoveredAt: 1,
        source: 'follow',
      },
      candidate: {
        pubkey: 'candidate',
        keywordHits: 0,
        discoveredAt: 2,
        source: 'follow',
      },
    },
    links: [
      { source: 'root', target: 'expanded', relation: 'follow' },
      { source: 'candidate', target: 'expanded', relation: 'follow' },
    ],
    inboundLinks: [
      { source: 'candidate', target: 'expanded', relation: 'inbound' },
    ],
    connectionsLinks: [],
    zapEdges: [],
    activeLayer: 'graph',
    connectionsSourceLayer: 'graph',
    rootNodePubkey: 'root',
    selectedNodePubkey: 'expanded',
    expandedNodePubkeys: new Set(['expanded']),
    comparedNodePubkeys: new Set(),
    pathfinding: {
      status: 'idle',
      path: null,
    },
    graphAnalysis: DEFAULT_GRAPH_ANALYSIS,
    effectiveGraphCaps: DEFAULT_EFFECTIVE_GRAPH_CAPS,
    renderConfig: DEFAULT_RENDER_CONFIG,
  })

  const candidateEdgeIds = model.edges
    .map((edge) => edge.id)
    .filter((edgeId) => edgeId.includes('candidate->expanded'))

  assert.deepEqual(candidateEdgeIds, ['candidate->expanded:follow'])
})

test('graph layer treats previous positions as warm-start seeds instead of fixed anchors', async () => {
  const model = await buildGraphRenderModel({
    nodes: {
      root: { pubkey: 'root', keywordHits: 0, discoveredAt: 0, source: 'root' },
      expanded: {
        pubkey: 'expanded',
        keywordHits: 0,
        discoveredAt: 1,
        source: 'follow',
      },
      sibling: {
        pubkey: 'sibling',
        keywordHits: 0,
        discoveredAt: 2,
        source: 'follow',
      },
      inboundFollower: {
        pubkey: 'inboundFollower',
        keywordHits: 0,
        discoveredAt: 3,
        source: 'inbound',
      },
    },
    links: [
      { source: 'root', target: 'expanded', relation: 'follow' },
      { source: 'root', target: 'sibling', relation: 'follow' },
    ],
    inboundLinks: [
      {
        source: 'inboundFollower',
        target: 'expanded',
        relation: 'inbound',
      },
    ],
    connectionsLinks: [],
    zapEdges: [],
    activeLayer: 'graph',
    connectionsSourceLayer: 'graph',
    rootNodePubkey: 'root',
    selectedNodePubkey: 'expanded',
    expandedNodePubkeys: new Set(['expanded']),
    comparedNodePubkeys: new Set(),
    pathfinding: {
      status: 'idle',
      path: null,
    },
    graphAnalysis: DEFAULT_GRAPH_ANALYSIS,
    effectiveGraphCaps: {
      ...DEFAULT_EFFECTIVE_GRAPH_CAPS,
      coldStartLayoutTicks: 40,
      warmStartLayoutTicks: 20,
    },
    renderConfig: DEFAULT_RENDER_CONFIG,
    previousPositions: new Map([
      ['root', [0, 0]],
      ['expanded', [-170, 20]],
      ['sibling', [170, -10]],
    ]),
    previousLayoutKey: 'graph:stale-topology',
  })

  const positionByPubkey = new Map(
    model.nodes.map((node) => [node.pubkey, node.position]),
  )
  const expandedPosition = positionByPubkey.get('expanded')
  const siblingPosition = positionByPubkey.get('sibling')
  const inboundFollowerPosition = positionByPubkey.get('inboundFollower')

  assert.ok(inboundFollowerPosition)
  assert.ok(expandedPosition)
  assert.ok(siblingPosition)
  assert.notDeepEqual(expandedPosition, [-170, 20])
  assert.notDeepEqual(siblingPosition, [170, -10])
})

test('graph layer exposes global shared-target counts independent of the selected expander', async () => {
  const fixture = createFiveExpandersSharedHubsFixture()
  const expectedTopology = createExpandedSharedTopologyFromFixture(fixture)
  const modelWithSelection = await buildGraphRenderModel(
    createRenderModelInputFromFixture(fixture, {
      effectiveGraphCaps: {
        ...DEFAULT_EFFECTIVE_GRAPH_CAPS,
        coldStartLayoutTicks: 0,
        warmStartLayoutTicks: 0,
      },
    }),
  )
  const modelWithoutSelection = await buildGraphRenderModel(
    createRenderModelInputFromFixture(fixture, {
      selectedNodePubkey: null,
      effectiveGraphCaps: {
        ...DEFAULT_EFFECTIVE_GRAPH_CAPS,
        coldStartLayoutTicks: 0,
        warmStartLayoutTicks: 0,
      },
    }),
  )

  const countByPubkeyWithSelection = new Map(
    modelWithSelection.nodes.map((node) => [node.pubkey, node.sharedByExpandedCount]),
  )
  const countByPubkeyWithoutSelection = new Map(
    modelWithoutSelection.nodes.map((node) => [node.pubkey, node.sharedByExpandedCount]),
  )

  for (const [targetPubkey, expectedCount] of expectedTopology.sharedByExpandedCount.entries()) {
    assert.equal(
      countByPubkeyWithSelection.get(targetPubkey),
      expectedCount,
      `expected ${targetPubkey} to keep sharedByExpandedCount=${expectedCount} with selection`,
    )
    assert.equal(
      countByPubkeyWithoutSelection.get(targetPubkey),
      expectedCount,
      `expected ${targetPubkey} to keep sharedByExpandedCount=${expectedCount} without selection`,
    )
  }

  assert.deepEqual(countByPubkeyWithSelection, countByPubkeyWithoutSelection)
  assert.equal(countByPubkeyWithSelection.get(fixture.rootPubkey), 0)
  assert.equal(countByPubkeyWithSelection.get(fixture.expanderPubkeys[0]), 0)
})

test('following layer does not apply expanded shared topology to visible nodes', async () => {
  const model = await buildGraphRenderModel({
    nodes: {
      root: { pubkey: 'root', keywordHits: 0, discoveredAt: 0, source: 'root' },
      expanderA: {
        pubkey: 'expanderA',
        keywordHits: 0,
        discoveredAt: 1,
        source: 'follow',
      },
      expanderB: {
        pubkey: 'expanderB',
        keywordHits: 0,
        discoveredAt: 2,
        source: 'follow',
      },
      sharedTarget: {
        pubkey: 'sharedTarget',
        keywordHits: 0,
        discoveredAt: 3,
        source: 'follow',
      },
    },
    links: [
      { source: 'root', target: 'sharedTarget', relation: 'follow' },
      { source: 'expanderA', target: 'sharedTarget', relation: 'follow' },
      { source: 'expanderB', target: 'sharedTarget', relation: 'follow' },
    ],
    inboundLinks: [],
    connectionsLinks: [],
    zapEdges: [],
    activeLayer: 'following',
    connectionsSourceLayer: 'graph',
    rootNodePubkey: 'root',
    selectedNodePubkey: null,
    expandedNodePubkeys: new Set(['expanderA', 'expanderB']),
    comparedNodePubkeys: new Set(),
    pathfinding: {
      status: 'idle',
      path: null,
    },
    graphAnalysis: DEFAULT_GRAPH_ANALYSIS,
    effectiveGraphCaps: {
      ...DEFAULT_EFFECTIVE_GRAPH_CAPS,
      coldStartLayoutTicks: 0,
      warmStartLayoutTicks: 0,
    },
    renderConfig: DEFAULT_RENDER_CONFIG,
  })

  const visibleNodeByPubkey = new Map(
    model.nodes.map((node) => [node.pubkey, node]),
  )

  assert.deepEqual(
    model.edges.map((edge) => edge.id),
    ['root->sharedTarget:follow'],
  )
  assert.equal(visibleNodeByPubkey.get('sharedTarget')?.sharedByExpandedCount, 0)
})

test('graph layer thinning stays topology-first regardless of selected node', async () => {
  const fixture = createSyntheticExpandedIntersectionFixture({
    expandedCount: 70,
    sharedHubCount: 12,
    pairwiseSharedTargetsPerAdjacentPair: 3,
    uniqueTargetsPerExpander: 10,
    inboundNoisePerExpander: 6,
  })

  const modelWithSelection = await buildGraphRenderModel(
    createRenderModelInputFromFixture(fixture, {
      effectiveGraphCaps: {
        ...DEFAULT_EFFECTIVE_GRAPH_CAPS,
        coldStartLayoutTicks: 0,
        warmStartLayoutTicks: 0,
      },
    }),
  )
  const modelWithoutSelection = await buildGraphRenderModel(
    createRenderModelInputFromFixture(fixture, {
      selectedNodePubkey: null,
      effectiveGraphCaps: {
        ...DEFAULT_EFFECTIVE_GRAPH_CAPS,
        coldStartLayoutTicks: 0,
        warmStartLayoutTicks: 0,
      },
    }),
  )

  assert.deepEqual(
    modelWithSelection.edges.map((edge) => edge.id),
    modelWithoutSelection.edges.map((edge) => edge.id),
  )
  assert.deepEqual(
    modelWithSelection.nodes.map((node) => [node.pubkey, node.position]),
    modelWithoutSelection.nodes.map((node) => [node.pubkey, node.position]),
  )
})

test('graph layer characterization keeps shared follow edges intact for small expanded-overlap fixtures', async (suite) => {
  const fixtures = [
    createTwoExpandersStrongOverlapFixture(),
    createThreeExpandersPartialOverlapFixture(),
    createFiveExpandersSharedHubsFixture(),
  ]
  const expectedMetricsByFixture = new Map([
    [
      'two-expanders-strong-overlap',
      {
        fixtureName: 'two-expanders-strong-overlap',
        avgSharedTargetDistanceToExpanders: 212.52,
        avgUniqueTargetDistanceToExpander: 221.92,
        sharedEdgeSurvivalRatio: 1,
        survivedSharedEdgeCount: 4,
        expectedSharedEdgeCount: 4,
        radialLegibilityScore: -0.45,
      },
    ],
    [
      'three-expanders-partial-overlap',
      {
        fixtureName: 'three-expanders-partial-overlap',
        avgSharedTargetDistanceToExpanders: 198.92,
        avgUniqueTargetDistanceToExpander: 261.01,
        sharedEdgeSurvivalRatio: 1,
        survivedSharedEdgeCount: 7,
        expectedSharedEdgeCount: 7,
        radialLegibilityScore: -0.54,
      },
    ],
    [
      'five-expanders-shared-hubs',
      {
        fixtureName: 'five-expanders-shared-hubs',
        avgSharedTargetDistanceToExpanders: 202.04,
        avgUniqueTargetDistanceToExpander: 307.59,
        sharedEdgeSurvivalRatio: 1,
        survivedSharedEdgeCount: 11,
        expectedSharedEdgeCount: 11,
        radialLegibilityScore: -0.54,
      },
    ],
  ])

  for (const fixture of fixtures) {
    await suite.test(fixture.name, async () => {
      const model = await buildGraphRenderModel(
        createRenderModelInputFromFixture(fixture, {
          effectiveGraphCaps: {
            ...DEFAULT_EFFECTIVE_GRAPH_CAPS,
            coldStartLayoutTicks: 90,
            warmStartLayoutTicks: 45,
          },
        }),
      )
      const metrics = measureFixtureLayoutMetrics({
        fixture,
        positionsByPubkey: createPositionMapFromRenderNodes(model.nodes),
        visibleEdgeIds: createFixtureEdgeIds(model.edges),
      })
      const metricsMessage = formatFixtureLayoutMetrics(metrics)

      assert.equal(model.lod.edgesThinned, false, metricsMessage)
      assert.deepEqual(
        roundFixtureLayoutMetrics(metrics),
        expectedMetricsByFixture.get(fixture.name),
        metricsMessage,
      )
    })
  }
})

test('deriveCandidateEdgeThinRank prioritizes overlap-explaining edges across 2, 3, and 5 expander fixtures', async (suite) => {
  const rankingFixtures = [
    {
      fixture: createTwoExpandersStrongOverlapFixture(),
      assertions: ({
        expandedNodePubkeys,
        topology,
        fixture,
      }: {
        expandedNodePubkeys: ReadonlySet<string>
        topology: ReturnType<typeof createExpandedSharedTopologyFromFixture>
        fixture: ReturnType<typeof createTwoExpandersStrongOverlapFixture>
      }) => {
        const [alpha] = fixture.expanderPubkeys
        const sharedRank = deriveCandidateEdgeThinRank({
          edge: createCandidateEdge({
            id: `${alpha}->shared-center-bridge:follow`,
            source: alpha,
            target: 'shared-center-bridge',
            targetSharedByExpandedCount:
              topology.sharedByExpandedCount.get('shared-center-bridge') ?? 0,
          }),
          expandedNodePubkeys,
          expandedSharedTopology: topology,
        })
        const uniqueRank = deriveCandidateEdgeThinRank({
          edge: createCandidateEdge({
            id: `${alpha}->unique-alpha-private-north:follow`,
            source: alpha,
            target: 'unique-alpha-private-north',
            targetSharedByExpandedCount:
              topology.sharedByExpandedCount.get('unique-alpha-private-north') ?? 0,
          }),
          expandedNodePubkeys,
          expandedSharedTopology: topology,
        })

        assert.equal(sharedRank.structuralClass, 4)
        assert.equal(uniqueRank.structuralClass, 3)
        assert.ok(
          sharedRank.targetSharedByExpandedCount >
            uniqueRank.targetSharedByExpandedCount,
        )
      },
    },
    {
      fixture: createThreeExpandersPartialOverlapFixture(),
      assertions: ({
        expandedNodePubkeys,
        topology,
        fixture,
      }: {
        expandedNodePubkeys: ReadonlySet<string>
        topology: ReturnType<typeof createExpandedSharedTopologyFromFixture>
        fixture: ReturnType<typeof createThreeExpandersPartialOverlapFixture>
      }) => {
        const [alpha] = fixture.expanderPubkeys
        const triSharedRank = deriveCandidateEdgeThinRank({
          edge: createCandidateEdge({
            id: `${alpha}->shared-alpha-beta-gamma-pocket:follow`,
            source: alpha,
            target: 'shared-alpha-beta-gamma-pocket',
            targetSharedByExpandedCount:
              topology.sharedByExpandedCount.get(
                'shared-alpha-beta-gamma-pocket',
              ) ?? 0,
          }),
          expandedNodePubkeys,
          expandedSharedTopology: topology,
        })
        const pairSharedRank = deriveCandidateEdgeThinRank({
          edge: createCandidateEdge({
            id: `${alpha}->shared-alpha-beta-bridge:follow`,
            source: alpha,
            target: 'shared-alpha-beta-bridge',
            targetSharedByExpandedCount:
              topology.sharedByExpandedCount.get('shared-alpha-beta-bridge') ?? 0,
          }),
          expandedNodePubkeys,
          expandedSharedTopology: topology,
        })
        const uniqueRank = deriveCandidateEdgeThinRank({
          edge: createCandidateEdge({
            id: `${alpha}->unique-alpha-east:follow`,
            source: alpha,
            target: 'unique-alpha-east',
            targetSharedByExpandedCount:
              topology.sharedByExpandedCount.get('unique-alpha-east') ?? 0,
          }),
          expandedNodePubkeys,
          expandedSharedTopology: topology,
        })

        assert.ok(
          triSharedRank.targetSharedByExpandedCount >
            pairSharedRank.targetSharedByExpandedCount,
        )
        assert.ok(
          triSharedRank.targetOverlapPairCount >
            pairSharedRank.targetOverlapPairCount,
        )
        assert.equal(pairSharedRank.structuralClass, 4)
        assert.equal(uniqueRank.structuralClass, 3)
      },
    },
    {
      fixture: createFiveExpandersSharedHubsFixture(),
      assertions: ({
        expandedNodePubkeys,
        topology,
        fixture,
      }: {
        expandedNodePubkeys: ReadonlySet<string>
        topology: ReturnType<typeof createExpandedSharedTopologyFromFixture>
        fixture: ReturnType<typeof createFiveExpandersSharedHubsFixture>
      }) => {
        const [uno] = fixture.expanderPubkeys
        const globalHubRank = deriveCandidateEdgeThinRank({
          edge: createCandidateEdge({
            id: `${uno}->shared-central-hub:follow`,
            source: uno,
            target: 'shared-central-hub',
            targetSharedByExpandedCount:
              topology.sharedByExpandedCount.get('shared-central-hub') ?? 0,
          }),
          expandedNodePubkeys,
          expandedSharedTopology: topology,
        })
        const regionalHubRank = deriveCandidateEdgeThinRank({
          edge: createCandidateEdge({
            id: `${uno}->shared-south-hub:follow`,
            source: uno,
            target: 'shared-south-hub',
            targetSharedByExpandedCount:
              topology.sharedByExpandedCount.get('shared-south-hub') ?? 0,
          }),
          expandedNodePubkeys,
          expandedSharedTopology: topology,
        })
        const uniqueRank = deriveCandidateEdgeThinRank({
          edge: createCandidateEdge({
            id: `${uno}->unique-uno-solo-a:follow`,
            source: uno,
            target: 'unique-uno-solo-a',
            targetSharedByExpandedCount:
              topology.sharedByExpandedCount.get('unique-uno-solo-a') ?? 0,
          }),
          expandedNodePubkeys,
          expandedSharedTopology: topology,
        })

        assert.ok(
          globalHubRank.targetSharedByExpandedCount >
            regionalHubRank.targetSharedByExpandedCount,
        )
        assert.ok(
          globalHubRank.targetOverlapPairSupport >
            regionalHubRank.targetOverlapPairSupport,
        )
        assert.equal(uniqueRank.structuralClass, 3)
      },
    },
  ] as const

  for (const { fixture, assertions } of rankingFixtures) {
    await suite.test(fixture.name, () => {
      assertions({
        expandedNodePubkeys: fixture.expandedNodePubkeys,
        topology: createExpandedSharedTopologyFromFixture(fixture),
        fixture,
      })
    })
  }
})

test('graph layer characterization thins a deterministic subset of shared edges once the synthetic mixed-overlap graph exceeds the edge budget', async () => {
  const fixture = createSyntheticExpandedIntersectionFixture({
    expandedCount: 70,
    sharedHubCount: 12,
    pairwiseSharedTargetsPerAdjacentPair: 3,
    uniqueTargetsPerExpander: 10,
    inboundNoisePerExpander: 6,
  })
  const model = await buildGraphRenderModel(
    createRenderModelInputFromFixture(fixture, {
      selectedNodePubkey: null,
      effectiveGraphCaps: {
        ...DEFAULT_EFFECTIVE_GRAPH_CAPS,
        coldStartLayoutTicks: 0,
        warmStartLayoutTicks: 0,
      },
    }),
  )
  const metrics = measureFixtureLayoutMetrics({
    fixture,
    positionsByPubkey: createPositionMapFromRenderNodes(model.nodes),
    visibleEdgeIds: createFixtureEdgeIds(model.edges),
  })
  const visibleEdgeIds = createFixtureEdgeIds(model.edges)
  const expectedSharedEdgeIds = createExpectedSharedEdgeIds(fixture)
  const metricsMessage = formatFixtureLayoutMetrics(metrics)

  assert.equal(model.lod.edgesThinned, true, metricsMessage)
  assert.ok(model.lod.candidateEdgeCount > model.lod.visibleEdgeCount, metricsMessage)
  assert.ok(model.lod.thinnedEdgeCount > 0, metricsMessage)
  assert.equal(
    model.physicsEdges.length,
    model.lod.candidateEdgeCount,
    'physics should retain all candidate edges even when the visible layer is thinned',
  )
  assert.ok(
    model.physicsEdges.length > model.edges.length,
    'expected physics edges to preserve more force links than the visible edge set',
  )
  assert.equal(
    expectedSharedEdgeIds.filter((edgeId) => visibleEdgeIds.has(edgeId)).length,
    expectedSharedEdgeIds.length,
    metricsMessage,
  )
  assert.deepEqual(
    roundFixtureLayoutMetrics(metrics),
    {
      fixtureName: 'synthetic-70-expanders-mixed-overlap',
      avgSharedTargetDistanceToExpanders: 434.72,
      avgUniqueTargetDistanceToExpander: 698.4,
      sharedEdgeSurvivalRatio: 1,
      survivedSharedEdgeCount: 1260,
      expectedSharedEdgeCount: 1260,
      radialLegibilityScore: -0.25,
    },
    metricsMessage,
  )
})
