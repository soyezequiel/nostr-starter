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
