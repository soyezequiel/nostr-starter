import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildRuntimeInspectorSnapshot,
  type RuntimeInspectorBuildInput,
} from '@/features/graph-runtime/devtools/runtimeInspector'
import type { AvatarRuntimeStateDebugSnapshot } from '@/features/graph-v2/renderer/avatar/avatarDebug'

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
  visibleProfileWarmup: null,
  visibleNodePubkeys: [],
  liveZapFeedback: null,
  showZaps: true,
  physicsEnabled: false,
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
    maxSocialCaptureBucket: 1024,
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
