import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildRuntimeInspectorSnapshot,
  type RuntimeInspectorBuildInput,
} from '@/features/graph-runtime/devtools/runtimeInspector'
import type { AvatarRuntimeStateDebugSnapshot } from '@/features/graph-v2/renderer/avatar/avatarDebug'
import { DEFAULT_BUDGETS } from '@/features/graph-v2/renderer/avatar/types'

const createBaseInput = (
  avatarRuntimeSnapshot: AvatarRuntimeStateDebugSnapshot,
): RuntimeInspectorBuildInput => ({
  generatedAtMs: 0,
  sceneState: {
    nodesByPubkey: {},
    edgesById: {},
    sceneSignature: 'test',
    topologySignature: 'test',
    nodeVisualRevision: 0,
    nodeDetailRevision: 0,
    rootPubkey: 'root',
    activeLayer: 'graph',
    connectionsSourceLayer: 'graph',
    selectedNodePubkey: null,
    pinnedNodePubkeys: new Set(),
    discoveryState: {
      expandedNodePubkeys: new Set(),
      graphRevision: 0,
      inboundGraphRevision: 0,
      connectionsLinksRevision: 0,
    },
  },
  uiState: {
    rootLoad: {
      status: 'ready',
      message: null,
      loadedFrom: 'live',
      visibleLinkProgress: null,
    },
    relayState: {
      urls: [],
      endpoints: {},
      overrideStatus: 'idle',
      isGraphStale: false,
    },
  },
  scene: {
    render: {
      nodes: [],
      visibleEdges: [],
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
        rootPubkey: 'root',
      },
      diagnostics: {
        activeLayer: 'graph',
        nodeCount: 0,
        visibleEdgeCount: 0,
        topologySignature: 'test',
      },
    },
    physics: {
      nodes: [],
      edges: [],
      diagnostics: {
        nodeCount: 0,
        edgeCount: 0,
        topologySignature: 'test',
      },
    },
  },
  graphSummary: {
    nodeCount: 0,
    linkCount: 0,
    maxNodes: 3000,
    capReached: false,
  },
  deviceSummary: {
    devicePerformanceProfile: 'desktop',
    effectiveGraphCaps: {
      maxNodes: 3000,
      coldStartLayoutTicks: 0,
      warmStartLayoutTicks: 0,
    },
    effectiveImageBudget: {
      vramBytes: 0,
      decodedBytes: 0,
      compressedBytes: 0,
      baseFetchConcurrency: 1,
      boostedFetchConcurrency: 1,
      allowHdTiers: true,
      allowParallelDirectFallback: true,
    },
  },
  zapSummary: {
    status: 'enabled',
    edgeCount: 1,
    skippedReceipts: 0,
    loadedFrom: 'live',
    message: null,
    targetCount: 1,
    lastUpdatedAt: null,
  },
  avatarPerfSnapshot: null,
  avatarRuntimeSnapshot,
  physicsDiagnostics: null,
  rendererDiagnostics: null,
  visibleProfileWarmup: null,
  visibleNodePubkeys: [],
  liveZapFeedback: null,
  showZaps: true,
  physicsEnabled: false,
  imageQualityMode: 'adaptive',
  sceneUpdatesPerMinute: 0,
  uiUpdatesPerMinute: 0,
})

const createAvatarRuntimeSnapshot = (): AvatarRuntimeStateDebugSnapshot => ({
  rootPubkey: 'root',
  selectedNodePubkey: null,
  viewport: {
    width: 1440,
    height: 900,
  },
  camera: {
    x: 0,
    y: 0,
    ratio: 1,
    angle: 0,
  },
  physicsRunning: false,
  motionActive: false,
  hideAvatarsOnMove: false,
  runtimeOptions: {
    sizeThreshold: 15,
    zoomThreshold: 2.1,
    hoverRevealRadiusPx: 72,
    hoverRevealMaxNodes: 24,
    showZoomedOutMonograms: true,
    showMonogramBackgrounds: false,
    showMonogramText: false,
    hideImagesOnFastNodes: false,
    fastNodeVelocityThreshold: 240,
    allowZoomedOutImages: true,
    showAllVisibleImages: true,
    maxInteractiveBucket: 256,
  },
  perfBudget: null,
  cache: {
    capacity: 256,
    size: 1,
    totalBytes: 0,
    monogramCount: 0,
    byState: {
      loading: 0,
      ready: 0,
      failed: 1,
    },
    entries: [
      {
        urlKey: 'broken::https://example.com/broken.png',
        state: 'failed',
        bucket: null,
        startedAt: null,
        readyAt: null,
        failedAt: 10,
        expiresAt: null,
        bytes: null,
        reason: null,
      },
    ],
  },
  loader: {
    blockedCount: 0,
    blocked: [],
  },
  scheduler: {
    inflightCount: 0,
    inflight: [],
    urgentRetries: [],
    recentEvents: [],
  },
  overlay: {
    generatedAtMs: 10,
    cameraRatio: 1,
    moving: false,
    globalMotionActive: false,
    resolvedBudget: {
      sizeThreshold: 15,
      zoomThreshold: 2.1,
      maxAvatarDrawsPerFrame: 280,
      maxImageDrawsPerFrame: 120,
      lruCap: 256,
      visualConcurrency: 1,
      effectiveLoadConcurrency: 6,
      concurrency: 1,
      maxBucket: 256,
      maxInteractiveBucket: 256,
      showAllVisibleImages: true,
      allowZoomedOutImages: true,
      showZoomedOutMonograms: true,
      hideImagesOnFastNodes: false,
      fastNodeVelocityThreshold: 240,
    },
    counts: {
      visibleNodes: 2,
      nodesWithPictureUrl: 2,
      nodesWithSafePictureUrl: 2,
      selectedForImage: 2,
      loadCandidates: 1,
      pendingCacheMiss: 1,
      pendingCandidates: 1,
      blockedCandidates: 0,
      inflightCandidates: 0,
      drawnImages: 0,
      monogramDraws: 0,
      withPictureMonogramDraws: 0,
    },
    byDisableReason: {},
    byLoadSkipReason: {},
    byDrawFallbackReason: {
      cache_miss: 12,
      cache_loading: 2,
      cache_failed: 1,
    },
    byCacheState: {
      missing: 1,
      failed: 1,
    },
    nodes: [
      {
        pubkey: 'pending',
        label: 'Pending Avatar',
        url: 'https://example.com/pending.png',
        host: 'example.com',
        urlKey: 'pending::https://example.com/pending.png',
        radiusPx: 16,
        priority: 1,
        selectedForImage: true,
        isPersistentAvatar: false,
        zoomedOutMonogram: false,
        monogramOnly: false,
        fastMoving: false,
        globalMotionActive: false,
        disableImageReason: null,
        drawResult: 'skipped',
        drawFallbackReason: 'cache_miss',
        loadDecision: 'candidate',
        loadSkipReason: null,
        cacheState: 'missing',
        cacheFailureReason: null,
        blocked: false,
        blockReason: null,
        inflight: false,
        requestedBucket: 64,
        hasPictureUrl: true,
        hasSafePictureUrl: true,
      },
      {
        pubkey: 'broken',
        label: 'Broken Avatar',
        url: 'https://example.com/broken.png',
        host: 'example.com',
        urlKey: 'broken::https://example.com/broken.png',
        radiusPx: 16,
        priority: 2,
        selectedForImage: true,
        isPersistentAvatar: false,
        zoomedOutMonogram: false,
        monogramOnly: false,
        fastMoving: false,
        globalMotionActive: false,
        disableImageReason: null,
        drawResult: 'skipped',
        drawFallbackReason: 'cache_failed',
        loadDecision: 'candidate',
        loadSkipReason: null,
        cacheState: 'failed',
        cacheFailureReason: null,
        blocked: false,
        blockReason: null,
        inflight: false,
        requestedBucket: 64,
        hasPictureUrl: true,
        hasSafePictureUrl: true,
      },
    ],
  },
})

const createRendererDiagnostics =
  (): NonNullable<RuntimeInspectorBuildInput['rendererDiagnostics']> => ({
    capturedAtMs: 1_000,
    rootPubkey: 'root',
    selectedNodePubkey: null,
    hoveredNodePubkey: null,
    drag: {
      draggedNodePubkey: null,
      pendingDragGesturePubkey: null,
      lastReleasedNodePubkey: null,
      lastReleasedGraphPosition: null,
      lastReleasedAtMs: null,
      manualDragFixedNodeCount: 0,
      forceAtlasRunning: false,
      forceAtlasSuspended: false,
      moveBodyCount: 0,
      flushCount: 0,
      lastMoveBodyPointer: null,
      lastScheduledGraphPosition: null,
      lastFlushedGraphPosition: null,
      influencedNodeCount: 0,
      maxHopDistance: null,
      influenceHopSample: [],
    },
    projection: {
      graphBoundsLocked: false,
      cameraLocked: false,
      dimensions: {
        width: 1_200,
        height: 800,
      },
      camera: {
        x: 0,
        y: 0,
        ratio: 1,
        angle: 0,
      },
      bbox: {
        x: [-100, 100],
        y: [-100, 100],
      },
      customBBox: null,
      customBBoxKnown: true,
    },
    previousProjection: null,
    projectionDeltaFromPrevious: null,
    invalidation: {
      pendingContainerRefresh: false,
      pendingContainerRefreshFrame: false,
      pendingDragFrame: false,
      pendingPhysicsBridgeFrame: false,
      pendingFitCameraAfterPhysicsFrame: false,
      pendingGraphBoundsUnlockFrame: false,
      graphBoundsUnlockStartedAtMs: null,
      graphBoundsUnlockDeferredCount: 0,
      graphBoundsLocked: false,
      cameraLocked: false,
      forceAtlasRunning: false,
      forceAtlasSuspended: false,
      lastInvalidation: {
        action: 'refresh',
        atMs: 900,
      },
    },
    timeline: [],
    samples: [
      {
        pubkey: 'root',
        role: 'root',
        viewport: {
          x: 100,
          y: 100,
          clientX: 100,
          clientY: 100,
        },
        render: {
          x: 0,
          y: 0,
        },
        physics: {
          x: 0,
          y: 0,
        },
        renderFixed: true,
        physicsFixed: true,
        renderPhysicsDelta: 0,
        renderDeltaFromPreviousGraph: 0,
        physicsDeltaFromPreviousGraph: 0,
        viewportDeltaFromPreviousPx: 0,
      },
    ],
  })

test('runtime inspector does not label cache misses as reusable avatar failures', () => {
  const snapshot = buildRuntimeInspectorSnapshot(
    createBaseInput(createAvatarRuntimeSnapshot()),
  )
  const reasonsByLabel = new Map(
    snapshot.avatars.razones.map((reason) => [reason.label, reason]),
  )

  assert.deepEqual(reasonsByLabel.get('Todavia no hay bitmap en cache'), {
    label: 'Todavia no hay bitmap en cache',
    value: '12',
    tone: 'neutral',
  })
  assert.deepEqual(reasonsByLabel.get('La foto esta cargando'), {
    label: 'La foto esta cargando',
    value: '2',
    tone: 'neutral',
  })
  assert.deepEqual(reasonsByLabel.get('La cache marco una falla reutilizable'), {
    label: 'La cache marco una falla reutilizable',
    value: '2',
    tone: 'warn',
  })
  assert.deepEqual(snapshot.avatars.casos, [
    {
      nodo: 'Broken Avatar',
      causa: 'La cache marco una falla reutilizable',
    },
  ])
})

test('runtime inspector counts failed and blocked visible avatars once', () => {
  const runtimeSnapshot = createAvatarRuntimeSnapshot()
  const brokenNode = runtimeSnapshot.overlay?.nodes.find(
    (node) => node.pubkey === 'broken',
  )
  assert.ok(brokenNode)
  brokenNode.blocked = true
  brokenNode.blockReason = 'timeout'
  runtimeSnapshot.loader = {
    blockedCount: 1,
    blocked: [
      {
        urlKey: 'broken::https://example.com/broken.png',
        expiresAt: 20,
        ttlMsRemaining: 10,
        reason: 'timeout',
      },
    ],
  }

  const snapshot = buildRuntimeInspectorSnapshot(createBaseInput(runtimeSnapshot))

  assert.equal(snapshot.avatars.estado, '1 visibles afectadas / 1 fallas cache')
})

test('runtime inspector treats external avatar URL failures as warning', () => {
  const runtimeSnapshot = createAvatarRuntimeSnapshot()
  const template = runtimeSnapshot.overlay?.nodes.find(
    (node) => node.pubkey === 'broken',
  )
  assert.ok(template)
  assert.ok(runtimeSnapshot.overlay)
  assert.ok(runtimeSnapshot.cache)

  const failedNodes = Array.from({ length: 6 }, (_, index) => ({
    ...template,
    pubkey: `external-${index}`,
    label: `External ${index}`,
    url: `https://example.com/missing-${index}.png`,
    urlKey: `external-${index}::https://example.com/missing-${index}.png`,
    cacheFailureReason: index % 2 === 0 ? 'http_404' : 'unresolved_host',
  }))

  runtimeSnapshot.overlay.nodes = failedNodes
  runtimeSnapshot.overlay.counts.visibleNodes = failedNodes.length
  runtimeSnapshot.overlay.counts.nodesWithPictureUrl = failedNodes.length
  runtimeSnapshot.overlay.counts.nodesWithSafePictureUrl = failedNodes.length
  runtimeSnapshot.overlay.counts.selectedForImage = failedNodes.length
  runtimeSnapshot.overlay.byDrawFallbackReason = {
    http_404: 3,
    unresolved_host: 3,
  }
  runtimeSnapshot.cache.byState.failed = failedNodes.length
  runtimeSnapshot.cache.entries = failedNodes.map((node, index) => ({
    urlKey: node.urlKey,
    state: 'failed',
    bucket: null,
    startedAt: null,
    readyAt: null,
    failedAt: index,
    expiresAt: null,
    bytes: null,
    reason: node.cacheFailureReason,
  }))

  const snapshot = buildRuntimeInspectorSnapshot(createBaseInput(runtimeSnapshot))
  const avatarSummary = snapshot.summary.find((item) => item.id === 'avatars')
  const cacheFailedMetric = snapshot.avatars.metricas.find(
    (metric) => metric.label === 'Cache failed',
  )
  const visibleAffectedMetric = snapshot.avatars.metricas.find(
    (metric) => metric.label === 'Visibles afectadas',
  )

  assert.equal(snapshot.avatars.tone, 'warn')
  assert.equal(snapshot.avatars.resumen, 'Fotos externas fallidas')
  assert.equal(avatarSummary?.estado, 'Amarillo')
  assert.equal(cacheFailedMetric?.tone, 'warn')
  assert.equal(visibleAffectedMetric?.tone, 'warn')
})

test('runtime inspector keeps internal avatar failures red', () => {
  const runtimeSnapshot = createAvatarRuntimeSnapshot()
  const template = runtimeSnapshot.overlay?.nodes.find(
    (node) => node.pubkey === 'broken',
  )
  assert.ok(template)
  assert.ok(runtimeSnapshot.overlay)
  assert.ok(runtimeSnapshot.cache)

  const failedNodes = Array.from({ length: 6 }, (_, index) => ({
    ...template,
    pubkey: `internal-${index}`,
    label: `Internal ${index}`,
    urlKey: `internal-${index}::https://example.com/broken-${index}.png`,
    cacheFailureReason: null,
  }))

  runtimeSnapshot.overlay.nodes = failedNodes
  runtimeSnapshot.overlay.counts.visibleNodes = failedNodes.length
  runtimeSnapshot.overlay.counts.nodesWithPictureUrl = failedNodes.length
  runtimeSnapshot.overlay.counts.nodesWithSafePictureUrl = failedNodes.length
  runtimeSnapshot.overlay.counts.selectedForImage = failedNodes.length
  runtimeSnapshot.overlay.byDrawFallbackReason = {
    cache_failed: failedNodes.length,
  }
  runtimeSnapshot.cache.byState.failed = failedNodes.length
  runtimeSnapshot.cache.entries = failedNodes.map((node, index) => ({
    urlKey: node.urlKey,
    state: 'failed',
    bucket: null,
    startedAt: null,
    readyAt: null,
    failedAt: index,
    expiresAt: null,
    bytes: null,
    reason: null,
  }))

  const snapshot = buildRuntimeInspectorSnapshot(createBaseInput(runtimeSnapshot))

  assert.equal(snapshot.avatars.tone, 'bad')
  assert.equal(snapshot.avatars.resumen, 'Hay fallas visibles de avatares')
})

test('runtime inspector translates unsupported COUNT relay notices', () => {
  const input = createBaseInput(createAvatarRuntimeSnapshot())
  input.uiState.relayState = {
    urls: ['wss://relay.damus.io'],
    endpoints: {
      'wss://relay.damus.io': {
        status: 'connected',
        lastCheckedAt: 1,
        lastNotice: 'ERROR: bad msg: unknown cmd',
      },
    },
    overrideStatus: 'idle',
    isGraphStale: false,
  }

  const snapshot = buildRuntimeInspectorSnapshot(input)

  assert.equal(
    snapshot.coverage.relays[0]?.detalle,
    'COUNT no soportado por este relay',
  )
  assert.equal(
    snapshot.relays.filas[0]?.detalle,
    'COUNT no soportado por este relay',
  )
})

test('runtime inspector ranks the full graph layer as the top resource mode for dense scenes', () => {
  const input = createBaseInput(createAvatarRuntimeSnapshot())
  input.sceneState.activeLayer = 'graph'
  input.scene.render.diagnostics.activeLayer = 'graph'
  input.scene.render.diagnostics.nodeCount = 1800
  input.scene.render.diagnostics.visibleEdgeCount = 4200
  input.scene.physics.diagnostics.nodeCount = 1800
  input.scene.physics.diagnostics.edgeCount = 4200
  input.graphSummary.nodeCount = 1800
  input.graphSummary.linkCount = 4200
  input.showZaps = false

  const snapshot = buildRuntimeInspectorSnapshot(input)

  assert.equal(snapshot.resourceTop[0]?.id, 'graph-layer')
  assert.equal(snapshot.resourceTop[0]?.intensidad, 'alta')
  assert.equal(snapshot.resourceTop[0]?.rank, 1)
})

test('runtime inspector ranks high quality avatar mode above small graph work', () => {
  const runtimeSnapshot = createAvatarRuntimeSnapshot()
  if (!runtimeSnapshot.overlay) {
    throw new Error('Expected avatar overlay fixture.')
  }
  runtimeSnapshot.overlay.counts.drawnImages = 160
  runtimeSnapshot.overlay.counts.loadCandidates = 240
  runtimeSnapshot.overlay.counts.pendingCandidates = 90
  runtimeSnapshot.overlay.resolvedBudget.maxBucket = 1024
  runtimeSnapshot.cache!.totalBytes = 48 * 1024 * 1024

  const input = createBaseInput(runtimeSnapshot)
  input.imageQualityMode = 'full-hd'
  input.scene.render.diagnostics.nodeCount = 50
  input.scene.render.diagnostics.visibleEdgeCount = 50
  input.scene.physics.diagnostics.nodeCount = 50
  input.scene.physics.diagnostics.edgeCount = 50
  input.showZaps = false
  input.physicsEnabled = false

  const snapshot = buildRuntimeInspectorSnapshot(input)

  assert.equal(snapshot.resourceTop[0]?.id, 'avatars')
  assert.equal(snapshot.resourceTop[0]?.intensidad, 'alta')
  assert.match(snapshot.resourceTop[0]?.detalle ?? '', /full HD/)
})

test('runtime inspector does not call bad FPS stable or blame modest avatar work', () => {
  const runtimeSnapshot = createAvatarRuntimeSnapshot()
  if (!runtimeSnapshot.overlay) {
    throw new Error('Expected avatar overlay fixture.')
  }
  runtimeSnapshot.overlay.counts.drawnImages = 27
  runtimeSnapshot.overlay.counts.loadCandidates = 27
  runtimeSnapshot.overlay.counts.pendingCandidates = 0
  runtimeSnapshot.overlay.resolvedBudget.maxBucket = 32
  runtimeSnapshot.cache!.totalBytes = 620 * 1024

  const input = createBaseInput(runtimeSnapshot)
  input.avatarPerfSnapshot = {
    baseTier: 'mid',
    tier: 'low',
    isDegraded: true,
    emaFrameMs: 112.4,
    budget: DEFAULT_BUDGETS.low,
  }
  input.physicsEnabled = true
  input.scene.render.diagnostics.nodeCount = 76
  input.scene.render.diagnostics.visibleEdgeCount = 152
  input.scene.physics.diagnostics.nodeCount = 76
  input.scene.physics.diagnostics.edgeCount = 152
  input.sceneUpdatesPerMinute = 2
  input.uiUpdatesPerMinute = 1

  const snapshot = buildRuntimeInspectorSnapshot(input)
  const avatarResource = snapshot.resourceTop.find((row) => row.id === 'avatars')

  assert.equal(snapshot.performance.tone, 'bad')
  assert.equal(snapshot.performance.resumen, 'FPS bajo')
  assert.notEqual(snapshot.primary.titulo, 'Rendimiento estable')
  assert.equal(avatarResource?.tone, 'ok')
  assert.equal(avatarResource?.intensidad, 'baja')
})

test('runtime inspector does not surface layer-filter coverage as the primary issue', () => {
  const runtimeSnapshot = createAvatarRuntimeSnapshot()
  runtimeSnapshot.cache.byState.failed = 0
  runtimeSnapshot.cache.entries = []
  runtimeSnapshot.overlay.counts.visibleNodes = 302
  runtimeSnapshot.overlay.counts.nodesWithPictureUrl = 0
  runtimeSnapshot.overlay.counts.nodesWithSafePictureUrl = 0
  runtimeSnapshot.overlay.counts.selectedForImage = 0
  runtimeSnapshot.overlay.counts.loadCandidates = 0
  runtimeSnapshot.overlay.counts.pendingCacheMiss = 0
  runtimeSnapshot.overlay.counts.pendingCandidates = 0
  runtimeSnapshot.overlay.byDrawFallbackReason = {}
  runtimeSnapshot.overlay.byCacheState = {}
  runtimeSnapshot.overlay.nodes = []

  const input = createBaseInput(runtimeSnapshot)
  input.sceneState.activeLayer = 'mutuals'
  input.scene.render.diagnostics.activeLayer = 'mutuals'
  input.scene.render.diagnostics.nodeCount = 302
  input.uiState.rootLoad.status = 'partial'
  input.uiState.rootLoad.visibleLinkProgress = {
    visibleLinkCount: 2358,
    contactListEventCount: 5,
    inboundCandidateEventCount: 1997,
    lastRelayUrl: 'wss://nostr.mom',
    updatedAt: 1,
    following: {
      status: 'complete',
      loadedCount: 904,
      totalCount: 904,
      isTotalKnown: true,
    },
    followers: {
      status: 'partial',
      loadedCount: 1755,
      totalCount: 1755,
      isTotalKnown: false,
    },
  }
  input.graphSummary.nodeCount = 2358
  input.graphSummary.linkCount = 0
  input.graphSummary.maxNodes = 3000
  input.zapSummary = {
    status: 'disabled',
    edgeCount: 0,
    skippedReceipts: 0,
    loadedFrom: 'none',
    message: null,
    targetCount: 0,
    lastUpdatedAt: null,
  }

  const snapshot = buildRuntimeInspectorSnapshot(input)

  assert.equal(snapshot.coverage.tone, 'warn')
  assert.equal(snapshot.coverage.resumen, 'La capa actual filtra nodos cargados')
  assert.equal(snapshot.primary.abrirAhora, 'zaps')
  assert.equal(snapshot.primary.titulo, 'Zaps sin evidencia util')
})

test('runtime inspector treats layer-filter-only coverage as non-dominant', () => {
  const runtimeSnapshot = createAvatarRuntimeSnapshot()
  runtimeSnapshot.cache.byState.failed = 0
  runtimeSnapshot.cache.entries = []
  runtimeSnapshot.overlay.counts.visibleNodes = 302
  runtimeSnapshot.overlay.counts.nodesWithPictureUrl = 0
  runtimeSnapshot.overlay.counts.nodesWithSafePictureUrl = 0
  runtimeSnapshot.overlay.counts.selectedForImage = 0
  runtimeSnapshot.overlay.counts.loadCandidates = 0
  runtimeSnapshot.overlay.counts.pendingCacheMiss = 0
  runtimeSnapshot.overlay.counts.pendingCandidates = 0
  runtimeSnapshot.overlay.byDrawFallbackReason = {}
  runtimeSnapshot.overlay.byCacheState = {}
  runtimeSnapshot.overlay.nodes = []

  const input = createBaseInput(runtimeSnapshot)
  input.sceneState.activeLayer = 'mutuals'
  input.scene.render.diagnostics.activeLayer = 'mutuals'
  input.scene.render.diagnostics.nodeCount = 302
  input.uiState.rootLoad.status = 'partial'
  input.uiState.rootLoad.visibleLinkProgress = {
    visibleLinkCount: 2358,
    contactListEventCount: 5,
    inboundCandidateEventCount: 1997,
    lastRelayUrl: 'wss://nostr.mom',
    updatedAt: 1,
    following: {
      status: 'complete',
      loadedCount: 904,
      totalCount: 904,
      isTotalKnown: true,
    },
    followers: {
      status: 'partial',
      loadedCount: 1755,
      totalCount: 1755,
      isTotalKnown: false,
    },
  }
  input.graphSummary.nodeCount = 2358
  input.graphSummary.linkCount = 0
  input.graphSummary.maxNodes = 3000
  input.zapSummary = {
    status: 'enabled',
    edgeCount: 1,
    skippedReceipts: 0,
    loadedFrom: 'live',
    message: null,
    targetCount: 1,
    lastUpdatedAt: null,
  }

  const snapshot = buildRuntimeInspectorSnapshot(input)

  assert.equal(snapshot.coverage.tone, 'warn')
  assert.equal(snapshot.coverage.resumen, 'La capa actual filtra nodos cargados')
  assert.equal(snapshot.primary.tone, 'neutral')
  assert.equal(snapshot.primary.titulo, 'Sin alerta dominante')
  assert.equal(snapshot.primary.abrirAhora, 'performance')
})

test('runtime inspector exposes renderer diagnostics in the summary', () => {
  const input = createBaseInput(createAvatarRuntimeSnapshot())
  input.avatarRuntimeSnapshot = null

  const snapshot = buildRuntimeInspectorSnapshot(input)

  assert.equal(snapshot.renderer.tone, 'neutral')
  assert.equal(snapshot.renderer.resumen, 'Sin muestra de renderer')
  assert.ok(snapshot.summary.some((item) => item.id === 'renderer'))
})

test('runtime inspector flags drag without bounds lock as renderer risk', () => {
  const input = createBaseInput(createAvatarRuntimeSnapshot())
  input.avatarRuntimeSnapshot = null
  const renderer = createRendererDiagnostics()
  renderer.drag.draggedNodePubkey = 'node-dragged'
  renderer.drag.lastMoveBodyPointer = {
    x: 320,
    y: 240,
  }
  input.rendererDiagnostics = renderer

  const snapshot = buildRuntimeInspectorSnapshot(input)

  assert.equal(snapshot.renderer.tone, 'warn')
  assert.equal(snapshot.renderer.resumen, 'Drag sin bounds lock')
  assert.equal(snapshot.primary.abrirAhora, 'renderer')
})

test('runtime inspector classifies stable graph coordinates as projection jumps', () => {
  const input = createBaseInput(createAvatarRuntimeSnapshot())
  input.avatarRuntimeSnapshot = null
  const renderer = createRendererDiagnostics()
  renderer.samples[0] = {
    ...renderer.samples[0],
    viewportDeltaFromPreviousPx: 220,
  }
  renderer.projectionDeltaFromPrevious = {
    cameraCenterDelta: 0.02,
    cameraRatioDelta: 0.4,
    bboxDelta: 120,
    customBBoxChanged: true,
  }
  input.rendererDiagnostics = renderer

  const snapshot = buildRuntimeInspectorSnapshot(input)

  assert.equal(snapshot.renderer.tone, 'bad')
  assert.equal(snapshot.renderer.resumen, 'Salto de proyeccion detectado')
  assert.equal(snapshot.primary.abrirAhora, 'renderer')
  assert.equal(snapshot.renderer.raw?.samples[0]?.viewportDeltaFromPreviousPx, 220)
  assert.equal(
    snapshot.renderer.raw?.projectionDeltaFromPrevious?.bboxDelta,
    120,
  )
})

test('runtime inspector classifies paired render and physics movement as coordinate writes', () => {
  const input = createBaseInput(createAvatarRuntimeSnapshot())
  input.avatarRuntimeSnapshot = null
  const renderer = createRendererDiagnostics()
  renderer.drag.lastReleasedNodePubkey = 'node-released'
  renderer.drag.manualDragFixedNodeCount = 1
  renderer.samples[0] = {
    ...renderer.samples[0],
    role: 'released',
    pubkey: 'node-released',
    viewportDeltaFromPreviousPx: 140,
    renderDeltaFromPreviousGraph: 80,
    physicsDeltaFromPreviousGraph: 79,
    renderPhysicsDelta: 0.05,
  }
  renderer.projectionDeltaFromPrevious = {
    cameraCenterDelta: 0,
    cameraRatioDelta: 0,
    bboxDelta: 0,
    customBBoxChanged: false,
  }
  input.rendererDiagnostics = renderer

  const snapshot = buildRuntimeInspectorSnapshot(input)

  assert.equal(snapshot.renderer.tone, 'bad')
  assert.equal(snapshot.renderer.resumen, 'Write de posicion detectado')
  assert.equal(snapshot.primary.abrirAhora, 'renderer')
  assert.equal(snapshot.renderer.raw?.drag.lastReleasedNodePubkey, 'node-released')
})

test('runtime inspector flags a stale manual release lock', () => {
  const input = createBaseInput(createAvatarRuntimeSnapshot())
  input.avatarRuntimeSnapshot = null
  const renderer = createRendererDiagnostics()
  renderer.drag.lastReleasedNodePubkey = 'node-released'
  renderer.drag.manualDragFixedNodeCount = 1
  input.rendererDiagnostics = renderer

  const snapshot = buildRuntimeInspectorSnapshot(input)

  assert.equal(snapshot.renderer.tone, 'bad')
  assert.equal(snapshot.renderer.resumen, 'Lock manual de release quedo activo')
  assert.equal(snapshot.primary.abrirAhora, 'renderer')
})

test('runtime inspector flags a release bounds unlock that keeps deferring', () => {
  const input = createBaseInput(createAvatarRuntimeSnapshot())
  input.avatarRuntimeSnapshot = null
  const renderer = createRendererDiagnostics()
  renderer.projection.graphBoundsLocked = true
  renderer.projection.customBBox = {
    x: [-500, 500],
    y: [-250, 250],
  }
  renderer.invalidation.pendingGraphBoundsUnlockFrame = true
  renderer.invalidation.graphBoundsUnlockDeferredCount = 24
  input.rendererDiagnostics = renderer

  const snapshot = buildRuntimeInspectorSnapshot(input)

  assert.equal(snapshot.renderer.tone, 'bad')
  assert.equal(snapshot.renderer.resumen, 'Unlock de bounds demorado')
  assert.equal(snapshot.primary.abrirAhora, 'renderer')
})
