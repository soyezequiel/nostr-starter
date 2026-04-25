'use client'
/* eslint-disable @next/next/no-img-element */

import {
  memo,
  type ComponentProps,
  type ReactNode,
  useCallback,
  startTransition,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { useSearchParams } from 'next/navigation'
import { nip19 } from 'nostr-tools'
import { useShallow } from 'zustand/react/shallow'

import AvatarFallback from '@/components/AvatarFallback'
import { useAuthStore } from '@/store/auth'
import { useAppStore } from '@/features/graph-runtime/app/store'
import { DEFAULT_MAX_GRAPH_NODES } from '@/features/graph-runtime/app/store/slices/graphSlice'
import type {
  AppStore,
  RootLoadState,
  SavedRootEntry,
  SavedRootProfileSnapshot,
} from '@/features/graph-runtime/app/store/types'
import type {
  RootIdentityResolution,
} from '@/features/graph-runtime/kernel/rootIdentity'
import { GraphInteractionController } from '@/features/graph-v2/application/InteractionController'
import { LegacyKernelBridge } from '@/features/graph-v2/bridge/LegacyKernelBridge'
import { GRAPH_V2_LAYERS } from '@/features/graph-v2/domain/invariants'
import type {
  CanonicalGraphSceneState,
  CanonicalGraphState,
  CanonicalGraphUiState,
  CanonicalRelayState,
  CanonicalNode,
} from '@/features/graph-v2/domain/types'
import {
  applyVisibleEdgeCountLabels,
} from '@/features/graph-v2/projections/applyVisibleEdgeCountLabels'
import {
  buildGraphSceneSnapshot,
  getSnapshotCacheStats,
} from '@/features/graph-v2/projections/buildGraphSceneSnapshot'
import { getProjectionCacheStats } from '@/features/graph-v2/projections/buildLayerProjection'
import { buildNodeDetailProjection } from '@/features/graph-v2/projections/buildNodeDetailProjection'
import {
  applyPersonSearchHighlight,
  buildPersonSearchMatches,
} from '@/features/graph-v2/projections/personSearchHighlight'
import type {
  GraphInteractionCallbacks,
  GraphViewportState,
} from '@/features/graph-v2/renderer/contracts'
import {
  DEFAULT_AVATAR_RUNTIME_OPTIONS,
  type AvatarRuntimeOptions,
} from '@/features/graph-v2/renderer/avatar/types'
import {
  PERF_BUDGET_DOWNGRADE_MS,
  resolveFpsFromFrameMs,
  type PerfBudgetSnapshot,
} from '@/features/graph-v2/renderer/avatar/perfBudget'
import {
  DEFAULT_DRAG_NEIGHBORHOOD_INFLUENCE_TUNING,
  type DragNeighborhoodInfluenceTuning,
} from '@/features/graph-v2/renderer/dragInfluence'
import {
  DEFAULT_FORCE_ATLAS_PHYSICS_TUNING,
  type ForceAtlasPhysicsTuning,
} from '@/features/graph-v2/renderer/forceAtlasRuntime'
import { createDragLocalFixture } from '@/features/graph-v2/testing/fixtures/dragLocalFixture'
import { SigmaCanvasHost, type SigmaCanvasHostHandle } from '@/features/graph-v2/ui/SigmaCanvasHost'
import {
  AtomIcon,
  BellIcon,
  ClockIcon,
  CloseIcon,
  CopyIcon,
  ExternalLinkIcon,
  FilterIcon,
  GearIcon,
  PinIcon,
  PulseIcon,
  TargetIcon,
  ZapIcon,
} from '@/features/graph-v2/ui/SigmaIcons'
import { SigmaTopBar } from '@/features/graph-v2/ui/SigmaTopBar'
import { SigmaFilterBar, type FilterPill } from '@/features/graph-v2/ui/SigmaFilterBar'
import { SigmaSideRail, type RailButton } from '@/features/graph-v2/ui/SigmaSideRail'
import { SigmaHud, type HudStat } from '@/features/graph-v2/ui/SigmaHud'
import { SigmaMinimap } from '@/features/graph-v2/ui/SigmaMinimap'
import { SigmaMobileBottomNav, type MobileNavButton } from '@/features/graph-v2/ui/SigmaMobileBottomNav'
import { SigmaSidePanel, type SigmaPanelSnap } from '@/features/graph-v2/ui/SigmaSidePanel'
import { SigmaRootLoader } from '@/features/graph-v2/ui/SigmaRootLoader'
import { SigmaEmptyState } from '@/features/graph-v2/ui/SigmaEmptyState'
import {
  SigmaLoadProgressHud,
  SigmaLoadingOverlay,
} from '@/features/graph-v2/ui/SigmaLoadingOverlay'
import {
  buildRootLoadProgressViewModel,
  isRootLoadProgressActive,
} from '@/features/graph-v2/ui/rootLoadProgressViewModel'
import { SigmaRootInput } from '@/features/graph-v2/ui/SigmaRootInput'
import { SigmaSavedRootsPanel } from '@/features/graph-v2/ui/SigmaSavedRootsPanel'
import { SigmaToasts, type SigmaToast } from '@/features/graph-v2/ui/SigmaToasts'
import { RuntimeInspectorDrawer } from '@/features/graph-v2/ui/runtime-inspector/RuntimeInspectorDrawer'
import {
  buildAvatarRuntimeDebugFilename,
  buildAvatarRuntimeDebugPayload,
  isAvatarRuntimeDebugDownloadEnabled,
  readAvatarRuntimeDebugBrowserSnapshot,
  readAvatarRuntimeDebugLocationSnapshot,
} from '@/features/graph-v2/ui/avatarRuntimeDebug'
import {
  buildVisibleProfileWarmupDebugSnapshot,
  selectVisibleProfileWarmupPubkeys,
  type VisibleProfileWarmupDebugSnapshot,
} from '@/features/graph-v2/ui/visibleProfileWarmup'
import { buildExpansionVisibilityHint } from '@/features/graph-v2/ui/expansionVisibilityHint'
import {
  createExpansionAutoFitRequest,
  shouldClearExpansionAutoFitRequest,
  shouldRunExpansionAutoFit,
  shouldScheduleExpansionAutoFit,
  type ExpansionAutoFitRequest,
} from '@/features/graph-v2/ui/expansionAutoFit'
import {
  MAX_ZAP_FILTER_PUBKEYS,
  useLiveZapFeed,
} from '@/features/graph-v2/zaps/useLiveZapFeed'
import {
  useRecentZapReplay,
  type RecentZapReplaySnapshot,
} from '@/features/graph-v2/zaps/useRecentZapReplay'
import { canRunZapFeedForScene } from '@/features/graph-v2/zaps/zapFeedAvailability'
import type { ParsedZap } from '@/features/graph-v2/zaps/zapParser'
import {
  shouldTraceZapPair,
  traceZapFlow,
} from '@/features/graph-runtime/debug/zapTrace'
import {
  isGraphPerfStatsEnabled,
  isGraphPerfTraceEnabled,
  nowGraphPerfMs,
  traceGraphPerf,
  traceGraphPerfDuration,
} from '@/features/graph-runtime/debug/perfTrace'
import { downloadBlob } from '@/features/graph-runtime/export/download'
import {
  clearSiteCache,
  requestBrowserSiteDataClear,
} from '@/lib/dev/clearSiteCache'
import type { NostrProfile } from '@/lib/nostr'

type SigmaSettingsTab = 'performance' | 'visuals' | 'relays' | 'dev'
type NotificationSource = 'action' | 'zap'
type ZapFeedMode = 'live' | 'recent-hour'
type MobileUtilityPanel = 'filters' | null
type ZapActivitySource = 'live' | 'recent-hour' | 'simulated'
type SceneConnection = Pick<
  CanonicalGraphSceneState['edgesById'][string],
  'source' | 'target' | 'relation' | 'origin'
>

interface SigmaNotificationLogEntry {
  id: string
  source: NotificationSource
  msg: string
  tone: NonNullable<SigmaToast['tone']>
  createdAt: number
}

interface ZapActivityLogEntry {
  id: string
  source: ZapActivitySource
  fromPubkey: string
  toPubkey: string
  sats: number
  played: boolean
  createdAt: number
}

const INTEGER_FORMATTER = new Intl.NumberFormat('es-AR')
const NOTIFICATION_AUTO_DISMISS_MS = 6500
const NOTIFICATION_HISTORY_LIMIT = 100
const ZAP_ACTIVITY_LIMIT = 80
const MOBILE_PHYSICS_QUERY = '(max-width: 720px)'
const MOBILE_FORCE_ATLAS_REPULSION_FORCE = 2.4
const ZAP_ACTIVITY_SOURCE_LABELS: Record<ZapActivitySource, string> = {
  live: 'Live',
  'recent-hour': 'Ultima hora',
  simulated: 'Simulado',
}
const NOTIFICATION_TIME_FORMATTER = new Intl.DateTimeFormat('es-AR', {
  hour: '2-digit',
  minute: '2-digit',
})
const ZAP_REPLAY_TIME_FORMATTER = new Intl.DateTimeFormat('es-AR', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})
const GRAPH_MAX_NODES_SLIDER_MIN = 250
const GRAPH_MAX_NODES_SLIDER_MAX = 12000
const GRAPH_MAX_NODES_SLIDER_STEP = 250

const NODE_EXPANSION_STATUS_LABELS: Record<
  NonNullable<CanonicalNode['nodeExpansionState']>['status'],
  string
> = {
  idle: 'sin expandir',
  loading: 'cargando',
  ready: 'lista',
  partial: 'parcial',
  empty: 'sin conexiones nuevas',
  error: 'error',
}

type SearchLoadProgress = NonNullable<
  ComponentProps<typeof SigmaTopBar>['searchLoadProgress']
>

interface SearchNodeDrawProgress {
  drawnNodeCount: number
  loadedNodeCount: number
  pendingDrawNodeCount: number
  percent: number
  label: string
  detailLabel: string
}

const DEVICE_PROFILE_LABELS: Record<
  AppStore['devicePerformanceProfile'],
  string
> = {
  desktop: 'desktop',
  mobile: 'movil',
  'low-end-mobile': 'movil liviano',
}

type ValidRootIdentity = Extract<RootIdentityResolution, { status: 'valid' }>

const readStoredAvatarPhotosEnabled = () => {
  if (typeof window === 'undefined') {
    return true
  }

  try {
    return window.localStorage.getItem(AVATAR_PHOTOS_ENABLED_STORAGE_KEY) !== '0'
  } catch {
    return true
  }
}

const readStoredRuntimeInspectorButtonEnabled = () => {
  if (typeof window === 'undefined') {
    return false
  }

  try {
    return window.localStorage.getItem(RUNTIME_INSPECTOR_BUTTON_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

const readStoredVisibleEdgeCountLabelsEnabled = () => {
  if (typeof window === 'undefined') {
    return false
  }

  try {
    return window.localStorage.getItem(VISIBLE_EDGE_COUNT_LABELS_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

interface LoadRootInput
  extends Omit<Pick<ValidRootIdentity, 'pubkey' | 'relays' | 'evidence'>, 'relays'> {
  relays?: string[]
  source?: ValidRootIdentity['source']
  npub?: string
  profile?: SavedRootProfileSnapshot | null
  profileFetchedAt?: number | null
}

const PUBLIC_SIGMA_SETTINGS_TABS: Array<{ id: SigmaSettingsTab; label: string }> = [
  { id: 'performance', label: 'Rendimiento' },
  { id: 'visuals', label: 'Visuales' },
  { id: 'relays', label: 'Red' },
]

const DEV_SIGMA_SETTINGS_TAB: { id: SigmaSettingsTab; label: string } = {
  id: 'dev',
  label: 'Avanzado',
}

const IDENTITY_FIRST_RUN_HELP_KEY = 'sigma.identityFirstRunHelpDismissed'
const AVATAR_PHOTOS_ENABLED_STORAGE_KEY = 'sigma.avatarPhotosEnabled'
const RUNTIME_INSPECTOR_BUTTON_STORAGE_KEY = 'sigma.runtimeInspectorButtonEnabled'
const VISIBLE_EDGE_COUNT_LABELS_STORAGE_KEY = 'sigma.visibleEdgeCountLabels'
const VISIBLE_PROFILE_WARMUP_BATCH_SIZE = 48
const VISIBLE_PROFILE_WARMUP_COOLDOWN_MS = 2 * 60 * 1000

const createDefaultPhysicsTuningForViewport = (): ForceAtlasPhysicsTuning => {
  if (typeof window === 'undefined' || !window.matchMedia(MOBILE_PHYSICS_QUERY).matches) {
    return DEFAULT_FORCE_ATLAS_PHYSICS_TUNING
  }

  return {
    ...DEFAULT_FORCE_ATLAS_PHYSICS_TUNING,
    repulsionForce: MOBILE_FORCE_ATLAS_REPULSION_FORCE,
  }
}
const isMobileGraphViewport = () =>
  typeof window !== 'undefined' && window.matchMedia(MOBILE_PHYSICS_QUERY).matches
const VISIBLE_PROFILE_WARMUP_LOOP_DELAY_MS = 1500
const VISIBLE_PROFILE_WARMUP_INITIAL_DELAY_MS = 250
const CONNECTION_LOD_RECOVERY_FRAME_MS = 24

const resolveLowPerformanceConnectionLodState = (
  snapshot: PerfBudgetSnapshot | null,
  wasActive: boolean,
) => {
  if (!snapshot) {
    return false
  }

  if (snapshot.emaFrameMs >= PERF_BUDGET_DOWNGRADE_MS) {
    return true
  }

  return wasActive && snapshot.emaFrameMs > CONNECTION_LOD_RECOVERY_FRAME_MS
}

const formatFpsFromFrameMs = (frameMs: number | null | undefined) => {
  const fps = resolveFpsFromFrameMs(frameMs)
  if (fps === null) {
    return 'n/a'
  }
  return `${fps >= 10 ? fps.toFixed(0) : fps.toFixed(1)} fps`
}

const formatFpsWithFrameMs = (frameMs: number | null | undefined) => {
  const fpsLabel = formatFpsFromFrameMs(frameMs)
  if (fpsLabel === 'n/a' || frameMs === null || frameMs === undefined) {
    return fpsLabel
  }
  return `${fpsLabel} (${frameMs.toFixed(1)}ms)`
}

const selectSavedRootState = (state: AppStore) => ({
  savedRoots: state.savedRoots,
  savedRootsHydrated: state.savedRootsHydrated,
  upsertSavedRoot: state.upsertSavedRoot,
  removeSavedRoot: state.removeSavedRoot,
  setSavedRootProfile: state.setSavedRootProfile,
})

// Zustand reruns every subscribed selector on every state mutation, so cache
// Object.keys(state.nodes).length by reference. state.nodes is a Record that
// gets reassigned on every node upsert, so identity changes exactly when the
// count can change — perfect WeakMap cache key. Avoids allocating a fresh
// keys-array (potentially thousands of strings) on every unrelated store
// mutation (zap ticks, relay status, UI flags, etc.).
const nodeCountCache = new WeakMap<object, number>()
const getCachedNodeCount = (nodes: Record<string, unknown>): number => {
  const cached = nodeCountCache.get(nodes)
  if (cached !== undefined) return cached
  const count = Object.keys(nodes).length
  nodeCountCache.set(nodes, count)
  return count
}

const selectRuntimeInspectorStoreState = (state: AppStore) => ({
  nodeCount: getCachedNodeCount(state.nodes),
  linkCount: state.links.length,
  maxNodes: state.graphCaps.maxNodes,
  capReached: state.graphCaps.capReached,
  devicePerformanceProfile: state.devicePerformanceProfile,
  effectiveGraphCaps: state.effectiveGraphCaps,
  effectiveImageBudget: state.effectiveImageBudget,
  imageQualityMode: state.renderConfig.imageQualityMode,
  zapStatus: state.zapLayer.status,
  zapEdgeCount: state.zapLayer.edges.length,
  zapSkippedReceipts: state.zapLayer.skippedReceipts,
  zapLoadedFrom: state.zapLayer.loadedFrom,
  zapMessage: state.zapLayer.message,
  zapTargetCount: state.zapLayer.targetPubkeys.length,
  zapLastUpdatedAt: state.zapLayer.lastUpdatedAt,
})

const HEX_PUBKEY_RE = /^[0-9a-f]{64}$/i

const formatInteger = (value: number) => INTEGER_FORMATTER.format(value)

const createSceneConnectionKey = (a: string, b: string) =>
  a < b ? `${a}|${b}` : `${b}|${a}`

const buildSceneConnectionIndex = (
  edgesById: CanonicalGraphSceneState['edgesById'],
) => {
  const connections = new Map<string, SceneConnection>()
  let edgeCount = 0

  for (const edge of Object.values(edgesById)) {
    edgeCount += 1
    const key = createSceneConnectionKey(edge.source, edge.target)
    if (!connections.has(key)) {
      connections.set(key, {
        source: edge.source,
        target: edge.target,
        relation: edge.relation,
        origin: edge.origin,
      })
    }
  }

  return { connections, edgeCount }
}

const clampProgress = (value: number) => {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

const formatProgressValue = (value: number) => Math.round(clampProgress(value) * 100)
const formatProgressPercent = (value: number) => `${formatProgressValue(value)}%`

const clampPercentValue = (value: number) => {
  if (!Number.isFinite(value)) return 0
  return Math.min(100, Math.max(0, Math.round(value)))
}

const getNodeExpansionUpdatedAt = (node: CanonicalNode) => {
  const expansionState = node.nodeExpansionState
  if (!expansionState) return 0
  return expansionState.updatedAt ?? expansionState.startedAt ?? 0
}

const getNodeExpansionLabel = (node: CanonicalNode) =>
  node.label?.trim() || `${node.pubkey.slice(0, 10)}...`

const buildNodeExpansionSearchProgress = (
  node: CanonicalNode,
): SearchLoadProgress | null => {
  const expansionState = node.nodeExpansionState
  if (!expansionState) return null

  if (expansionState.status === 'loading') {
    const step = expansionState.step
    const totalSteps = expansionState.totalSteps
    const rawPercent =
      typeof step === 'number' &&
      Number.isFinite(step) &&
      typeof totalSteps === 'number' &&
      Number.isFinite(totalSteps) &&
      totalSteps > 0
        ? clampPercentValue((step / totalSteps) * 100)
        : 12
    const percent = Math.min(96, Math.max(8, rawPercent))

    return {
      percent,
      label: `${expansionState.message ?? 'Expandiendo conexiones de nodo'}. ${percent} por ciento.`,
    }
  }

  if (
    node.isExpanded &&
    (expansionState.status === 'ready' ||
      expansionState.status === 'partial' ||
      expansionState.status === 'empty')
  ) {
    return {
      percent: 100,
      label: `Expansion de ${getNodeExpansionLabel(node)} completa. 100 por ciento.`,
    }
  }

  return null
}

const resolveNodeExpansionSearchProgress = (
  nodesByPubkey: CanonicalGraphSceneState['nodesByPubkey'],
): SearchLoadProgress | null => {
  let activeLoadingNode: CanonicalNode | null = null
  let latestTerminalNode: CanonicalNode | null = null

  for (const node of Object.values(nodesByPubkey)) {
    const expansionState = node.nodeExpansionState
    if (!expansionState) continue

    if (expansionState.status === 'loading') {
      if (
        activeLoadingNode === null ||
        getNodeExpansionUpdatedAt(node) > getNodeExpansionUpdatedAt(activeLoadingNode)
      ) {
        activeLoadingNode = node
      }
      continue
    }

    if (
      node.isExpanded &&
      (expansionState.status === 'ready' ||
        expansionState.status === 'partial' ||
        expansionState.status === 'empty') &&
      (latestTerminalNode === null ||
        getNodeExpansionUpdatedAt(node) > getNodeExpansionUpdatedAt(latestTerminalNode))
    ) {
      latestTerminalNode = node
    }
  }

  if (activeLoadingNode) {
    return buildNodeExpansionSearchProgress(activeLoadingNode)
  }

  if (latestTerminalNode) {
    return buildNodeExpansionSearchProgress(latestTerminalNode)
  }

  return null
}

const normalizeNodeCount = (value: number) => {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.floor(value))
}

const buildSearchNodeDrawProgress = ({
  drawnNodeCount,
  isSceneTransitionPending,
  loadedNodeCount,
}: {
  drawnNodeCount: number
  isSceneTransitionPending: boolean
  loadedNodeCount: number
}): SearchNodeDrawProgress | null => {
  const loaded = normalizeNodeCount(loadedNodeCount)
  if (loaded === 0) return null

  const drawn = Math.min(loaded, normalizeNodeCount(drawnNodeCount))
  const pending = isSceneTransitionPending ? Math.max(0, loaded - drawn) : 0
  const percent =
    pending > 0
      ? clampPercentValue((drawn / loaded) * 100)
      : 100
  const label =
    pending > 0
      ? `${drawn}/${loaded} - faltan ${pending}`
      : drawn === loaded
        ? `${drawn}/${loaded} - 0 faltan`
        : `${drawn} vis / ${loaded} - 0 faltan`
  const detailLabel =
    pending > 0
      ? `${drawn} nodos dibujados de ${loaded}; faltan ${pending} por dibujar.`
      : `${drawn} nodos visibles de ${loaded} cargados; sin pendientes de dibujo.`

  return {
    drawnNodeCount: drawn,
    loadedNodeCount: loaded,
    pendingDrawNodeCount: pending,
    percent,
    label,
    detailLabel,
  }
}

const includeNodeDrawProgress = (
  progress: SearchLoadProgress | null,
  drawProgress: SearchNodeDrawProgress | null,
): SearchLoadProgress | null => {
  if (!progress || !drawProgress) return progress

  const percent =
    drawProgress.pendingDrawNodeCount > 0
      ? Math.min(progress.percent, drawProgress.percent)
      : progress.percent

  return {
    ...progress,
    percent,
    label: `${progress.label} ${drawProgress.detailLabel}`,
    nodeDrawLabel: drawProgress.label,
    nodeDrawTitle: drawProgress.detailLabel,
  }
}

const formatZapReplayTime = (timestamp: number | null) => (
  timestamp === null
    ? '--:--:--'
    : ZAP_REPLAY_TIME_FORMATTER.format(new Date(timestamp * 1000))
)

type ZapReplayStageStatus = 'pending' | 'active' | 'done' | 'error'

interface ZapReplayStageRow {
  id: string
  label: string
  detail: string
  value: number
  status: ZapReplayStageStatus
}

function buildZapReplayStageRows(
  replay: RecentZapReplaySnapshot,
): ZapReplayStageRow[] {
  const hasCollected =
    replay.stage === 'decoding' ||
    replay.stage === 'playing' ||
    replay.stage === 'done'
  const hasDecoded = replay.stage === 'playing' || replay.stage === 'done'
  const hasPlayed = replay.stage === 'done'
  const completedPlayback = replay.playedCount + replay.droppedCount

  const collectionValue =
    replay.batchCount > 0
      ? replay.completedBatchCount / replay.batchCount
      : hasCollected
        ? 1
        : 0
  const decodeValue =
    hasDecoded
      ? 1
      : replay.stage === 'decoding'
        ? 0.5
        : 0
  const playValue =
    replay.playableCount > 0
      ? completedPlayback / replay.playableCount
      : hasPlayed
        ? 1
        : 0

  const collectionStatus: ZapReplayStageStatus =
    replay.stage === 'error'
      ? 'error'
      : hasCollected
        ? 'done'
        : replay.stage === 'collecting'
          ? 'active'
          : 'pending'
  const decodeStatus: ZapReplayStageStatus =
    replay.stage === 'error' && hasCollected
      ? 'error'
      : hasDecoded
        ? 'done'
        : replay.stage === 'decoding'
          ? 'active'
          : 'pending'
  const playStatus: ZapReplayStageStatus =
    replay.stage === 'error' && hasDecoded
      ? 'error'
      : hasPlayed
        ? 'done'
        : replay.stage === 'playing'
          ? 'active'
          : 'pending'

  return [
    {
      id: 'collect',
      label: 'Recoleccion',
      detail:
        replay.batchCount > 0
          ? `${formatInteger(replay.completedBatchCount)}/${formatInteger(replay.batchCount)} batches - ${formatInteger(replay.cachedCount)} cache - ${formatInteger(replay.fetchedCount)} nuevos`
          : `${formatInteger(replay.cachedCount)} zaps en cache`,
      value: collectionValue,
      status: collectionStatus,
    },
    {
      id: 'decode',
      label: 'Preparacion',
      detail: `${formatInteger(replay.decodedCount)} validos para replay`,
      value: decodeValue,
      status: decodeStatus,
    },
    {
      id: 'play',
      label: 'Reproduccion',
      detail: `${formatInteger(replay.playedCount)} visibles - ${formatInteger(replay.droppedCount)} descartados`,
      value: playValue,
      status: playStatus,
    },
  ]
}

const getInitials = (value: string | null) => {
  if (!value) return 'N'
  return (
    value
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((chunk) => chunk[0]?.toUpperCase() ?? '')
      .join('') || 'N'
  )
}

const encodePubkeyAsNpub = (pubkey: string | null | undefined) => {
  if (!pubkey || !HEX_PUBKEY_RE.test(pubkey)) return null
  try {
    return nip19.npubEncode(pubkey)
  } catch {
    return null
  }
}

const copyToClipboard = async (text: string) => {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }

  const textArea = document.createElement('textarea')
  textArea.value = text
  textArea.setAttribute('readonly', '')
  textArea.style.position = 'fixed'
  textArea.style.left = '-9999px'
  document.body.appendChild(textArea)
  textArea.select()

  try {
    const copied = document.execCommand('copy')
    if (!copied) throw new Error('Copy command was rejected.')
  } finally {
    document.body.removeChild(textArea)
  }
}

const createClientSceneSignature = (state: CanonicalGraphSceneState) =>
  [
    state.rootPubkey ?? 'no-root',
    state.activeLayer,
    state.connectionsSourceLayer,
    state.selectedNodePubkey ?? 'no-selection',
    state.discoveryState.graphRevision,
    state.discoveryState.inboundGraphRevision,
    state.discoveryState.connectionsLinksRevision,
    state.nodeVisualRevision,
    Array.from(state.discoveryState.expandedNodePubkeys).sort().join(','),
    Object.keys(state.nodesByPubkey).length,
    Object.keys(state.edgesById).length,
    Array.from(state.pinnedNodePubkeys).sort().join(','),
  ].join('|')

const createClientTopologySignature = (state: CanonicalGraphSceneState) =>
  [
    state.rootPubkey ?? 'no-root',
    state.activeLayer,
    state.connectionsSourceLayer,
    state.discoveryState.graphRevision,
    state.discoveryState.inboundGraphRevision,
    state.discoveryState.connectionsLinksRevision,
    Array.from(state.discoveryState.expandedNodePubkeys).sort().join(','),
    Object.keys(state.nodesByPubkey).length,
    Object.keys(state.edgesById).length,
  ].join('|')

const withClientSceneSignature = <T extends CanonicalGraphSceneState>(
  state: T,
): T => ({
  ...state,
  sceneSignature: createClientSceneSignature(state),
  topologySignature: createClientTopologySignature(state),
})

const pickFixtureUiState = (
  state: CanonicalGraphState,
): CanonicalGraphUiState => ({
  relayState: state.relayState,
  rootLoad: state.discoveryState.rootLoad,
})

// ── Sub-components (settings/relay content) ───────────────────────────────────

function RelayEditor({
  relayUrls,
  isGraphStale,
  onApply,
  onRevert,
}: {
  relayUrls: readonly string[]
  isGraphStale: boolean
  onApply: (relayUrls: string[]) => Promise<unknown>
  onRevert: () => Promise<void>
}) {
  const [draft, setDraft] = useState(relayUrls.join('\n'))
  const [message, setMessage] = useState<string | null>(null)
  const relaySignature = relayUrls.join('\n')

  useEffect(() => {
    setDraft(relaySignature)
  }, [relaySignature])

  return (
    <div className="sg-settings-section">
      <h4>Relays de sesion</h4>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: 12, color: 'var(--sg-fg-muted)' }}>Estado</span>
        <span
          style={{
            borderRadius: 999,
            border: '1px solid var(--sg-stroke)',
            padding: '2px 8px',
            fontSize: 11,
            color: 'var(--sg-fg-muted)',
            fontFamily: 'var(--sg-font-mono)',
          }}
        >
          {isGraphStale ? 'personalizados' : 'base'}
        </span>
      </div>
      <textarea
        onChange={(event) => setDraft(event.target.value)}
        placeholder="wss://relay.example"
        spellCheck={false}
        style={{
          width: '100%',
          height: 112,
          background: 'oklch(100% 0 0 / 0.02)',
          border: '1px solid var(--sg-stroke)',
          borderRadius: 8,
          padding: '8px 10px',
          color: 'var(--sg-fg)',
          fontFamily: 'var(--sg-font-mono)',
          fontSize: 11,
          outline: 'none',
          resize: 'vertical',
        }}
        value={draft}
      />
      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
        <button
          className="sg-btn sg-btn--primary"
          onClick={() => {
            const nextRelayUrls = draft
              .split(/\s+/)
              .map((entry) => entry.trim())
              .filter(Boolean)
            startTransition(() => {
              void onApply(nextRelayUrls)
                .then(() => { setMessage(`Aplicados ${nextRelayUrls.length} relays.`) })
                .catch((error) => {
                  setMessage(error instanceof Error ? error.message : 'No se pudieron aplicar los relays.')
                })
            })
          }}
          style={{ flex: 'none' }}
          type="button"
        >
          Aplicar
        </button>
        {isGraphStale ? (
          <button
            className="sg-btn"
            onClick={() => {
              startTransition(() => {
                void onRevert()
                  .then(() => { setMessage('Se revirtio la configuracion personalizada de relays.') })
                  .catch((error) => {
                    setMessage(error instanceof Error ? error.message : 'No se pudo revertir la configuracion de relays.')
                  })
              })
            }}
            style={{ flex: 'none' }}
            type="button"
          >
            Revertir
          </button>
        ) : null}
      </div>
      {message ? <p style={{ marginTop: 8, fontSize: 12, color: 'var(--sg-fg-muted)' }}>{message}</p> : null}
    </div>
  )
}

function GraphCapacityPanel({
  maxNodes,
  nodeCount,
  capReached,
  recommendedMaxNodes,
  devicePerformanceProfile,
  onChange,
}: {
  maxNodes: number
  nodeCount: number
  capReached: boolean
  recommendedMaxNodes: number
  devicePerformanceProfile: AppStore['devicePerformanceProfile']
  onChange: (maxNodes: number) => void
}) {
  const sliderValue = Math.min(
    GRAPH_MAX_NODES_SLIDER_MAX,
    Math.max(GRAPH_MAX_NODES_SLIDER_MIN, maxNodes),
  )
  const remainingCapacity = Math.max(0, maxNodes - nodeCount)
  const isAtProjectDefault = maxNodes === DEFAULT_MAX_GRAPH_NODES
  const isAtRecommended = maxNodes === recommendedMaxNodes

  return (
    <div className="sg-settings-section">
      <h4>Tamaño del grafo</h4>
      <div className="sg-slider-row">
        <div className="sg-slider-row__head">
          <span className="sg-slider-row__lbl">Máximo de nodos</span>
          <span className="sg-slider-row__val">
            {formatInteger(maxNodes)} nodos
          </span>
        </div>
        <p
          style={{
            fontSize: 10.5,
            color: 'var(--sg-fg-faint)',
            margin: '2px 0 8px',
          }}
        >
          Subilo para dejar entrar más conexiones. Bajalo si querés menos
          carga de layout, memoria y avatares.
        </p>
        <input
          className="sg-slider"
          max={GRAPH_MAX_NODES_SLIDER_MAX}
          min={GRAPH_MAX_NODES_SLIDER_MIN}
          onChange={(event) => {
            onChange(Number.parseInt(event.target.value, 10))
          }}
          step={GRAPH_MAX_NODES_SLIDER_STEP}
          type="range"
          value={sliderValue}
        />
      </div>

      <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
        <button
          className="sg-btn"
          disabled={isAtProjectDefault}
          onClick={() => onChange(DEFAULT_MAX_GRAPH_NODES)}
          style={{ flex: 'none', padding: '4px 10px', fontSize: 11 }}
          type="button"
        >
          Proyecto {formatInteger(DEFAULT_MAX_GRAPH_NODES)}
        </button>
        <button
          className="sg-btn"
          disabled={isAtRecommended}
          onClick={() => onChange(recommendedMaxNodes)}
          style={{ flex: 'none', padding: '4px 10px', fontSize: 11 }}
          type="button"
        >
          Sugerido {formatInteger(recommendedMaxNodes)}
        </button>
      </div>

      <div
        style={{
          marginTop: 12,
          border: '1px solid var(--sg-stroke)',
          borderRadius: 8,
          padding: '10px 12px',
        }}
      >
        {[
          ['Nodos cargados', formatInteger(nodeCount)],
          ['Margen restante', formatInteger(remainingCapacity)],
          [
            `Sugerido para ${DEVICE_PROFILE_LABELS[devicePerformanceProfile]}`,
            formatInteger(recommendedMaxNodes),
          ],
        ].map(([label, value]) => (
          <div className="sg-diag-row" key={label}>
            <span className="sg-diag-row__k">{label}</span>
            <span className="sg-diag-row__v">{value}</span>
          </div>
        ))}
      </div>

      {capReached ? (
        <p
          style={{
            marginTop: 10,
            fontSize: 11,
            color: 'var(--sg-warn)',
            lineHeight: 1.45,
          }}
        >
          El grafo tocó el tope actual. Si querés seguir expandiendo, subí este
          límite y volvé a probar.
        </p>
      ) : null}
    </div>
  )
}

const PHYSICS_TUNING_SLIDERS: Array<{
  key: keyof ForceAtlasPhysicsTuning
  label: string
  description: string
  min: number
  max: number
  step: number
}> = [
  { key: 'centripetalForce', label: 'Fuerza centrípeta', description: 'Multiplica gravity: compacta el grafo. 0 la desactiva.', min: 0, max: 0.5, step: 0.01 },
  { key: 'repulsionForce', label: 'Repulsión', description: 'Multiplica scalingRatio: separa nodos.', min: 0.25, max: 5, step: 0.05 },
  { key: 'linkForce', label: 'Fuerza de enlace', description: 'Multiplica edgeWeightInfluence.', min: 0.25, max: 2.5, step: 0.05 },
  { key: 'linkDistance', label: 'Distancia de enlace', description: 'Aproxima distancia sin cambiar FA2.', min: 0.5, max: 2, step: 0.05 },
  { key: 'damping', label: 'Amortiguación', description: 'Multiplica slowDown: velocidad e inercia.', min: 0.1, max: 2.5, step: 0.05 },
]

function PhysicsTuningPanel({
  tuning,
  onChange,
  onReset,
}: {
  tuning: ForceAtlasPhysicsTuning
  onChange: <K extends keyof ForceAtlasPhysicsTuning>(key: K, value: ForceAtlasPhysicsTuning[K]) => void
  onReset: () => void
}) {
  return (
    <div className="sg-settings-section">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <h4 style={{ margin: 0 }}>ForceAtlas2</h4>
        <button className="sg-btn" onClick={onReset} style={{ flex: 'none', padding: '4px 10px', fontSize: 11 }} type="button">Reset</button>
      </div>
      {PHYSICS_TUNING_SLIDERS.map((slider) => {
        const value = tuning[slider.key]
        return (
          <div className="sg-slider-row" key={slider.key}>
            <div className="sg-slider-row__head">
              <span className="sg-slider-row__lbl">{slider.label}</span>
              <span className="sg-slider-row__val">{(value as number).toFixed(2)}×</span>
            </div>
            <p style={{ fontSize: 10.5, color: 'var(--sg-fg-faint)', margin: '2px 0 4px' }}>{slider.description}</p>
            <input
              className="sg-slider"
              max={slider.max}
              min={slider.min}
              onChange={(event) => {
                onChange(slider.key, Number.parseFloat(event.target.value) as ForceAtlasPhysicsTuning[typeof slider.key])
              }}
              step={slider.step}
              type="range"
              value={value as number}
            />
          </div>
        )
      })}
    </div>
  )
}

const DRAG_TUNING_SLIDERS: Array<{
  key: keyof DragNeighborhoodInfluenceTuning
  label: string
  description: string
  min: number
  max: number
  step: number
}> = [
  { key: 'edgeStiffness', label: 'Edge stiffness', description: 'Cuanto se propaga el tirón por las aristas.', min: 0.01, max: 0.12, step: 0.002 },
  { key: 'anchorStiffnessPerHop', label: 'Anchor por hop', description: 'Cuanto vuelve cada hop a su posición inicial.', min: 0.001, max: 0.02, step: 0.0005 },
  { key: 'baseDamping', label: 'Base damping', description: 'Amortiguación de velocidad.', min: 0.75, max: 0.95, step: 0.005 },
]

function DragTuningPanel({
  tuning,
  onChange,
  onReset,
}: {
  tuning: DragNeighborhoodInfluenceTuning
  onChange: <K extends keyof DragNeighborhoodInfluenceTuning>(key: K, value: DragNeighborhoodInfluenceTuning[K]) => void
  onReset: () => void
}) {
  return (
    <div className="sg-settings-section">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <h4 style={{ margin: 0 }}>Drag springs lab</h4>
        <button className="sg-btn" onClick={onReset} style={{ flex: 'none', padding: '4px 10px', fontSize: 11 }} type="button">Reset</button>
      </div>
      {DRAG_TUNING_SLIDERS.map((slider) => {
        const value = tuning[slider.key]
        return (
          <div className="sg-slider-row" key={slider.key}>
            <div className="sg-slider-row__head">
              <span className="sg-slider-row__lbl">{slider.label}</span>
              <span className="sg-slider-row__val">{(value as number).toFixed(3)}</span>
            </div>
            <p style={{ fontSize: 10.5, color: 'var(--sg-fg-faint)', margin: '2px 0 4px' }}>{slider.description}</p>
            <input
              className="sg-slider"
              max={slider.max}
              min={slider.min}
              onChange={(event) => {
                onChange(slider.key, Number.parseFloat(event.target.value) as DragNeighborhoodInfluenceTuning[typeof slider.key])
              }}
              step={slider.step}
              type="range"
              value={value as number}
            />
          </div>
        )
      })}
    </div>
  )
}

function VisualOptionsPanel({
  avatarRuntimeOptions,
  showVisibleEdgeCountLabels,
  onAvatarRuntimeOptionsChange,
  onToggleVisibleEdgeCountLabels,
}: {
  avatarRuntimeOptions: AvatarRuntimeOptions
  showVisibleEdgeCountLabels: boolean
  onAvatarRuntimeOptionsChange: (options: AvatarRuntimeOptions) => void
  onToggleVisibleEdgeCountLabels: () => void
}) {
  return (
    <div>
      <div className="sg-settings-section">
        <h4>Etiquetas</h4>
        <div className="sg-setting-row">
          <div>
            <div className="sg-setting-row__lbl">Grado visible</div>
            <div className="sg-setting-row__desc">
              Cada nodo muestra cuantas aristas visibles lo tocan en la vista actual.
            </div>
          </div>
          <button
            aria-pressed={showVisibleEdgeCountLabels}
            className={`sg-toggle${showVisibleEdgeCountLabels ? ' sg-toggle--on' : ''}`}
            onClick={onToggleVisibleEdgeCountLabels}
            title={
              showVisibleEdgeCountLabels
                ? 'Volver a mostrar nombres de nodos'
                : 'Mostrar cantidad de aristas visibles por nodo'
            }
            type="button"
          />
        </div>
      </div>
      <div className="sg-settings-section">
        <h4>Monogramas</h4>
        <div className="sg-setting-row">
          <div>
            <div className="sg-setting-row__lbl">Letras de monograma</div>
            <div className="sg-setting-row__desc">
              Muestra iniciales cuando no hay foto disponible.
            </div>
          </div>
          <button
            className={`sg-toggle${avatarRuntimeOptions.showMonogramText ? ' sg-toggle--on' : ''}`}
            onClick={() => onAvatarRuntimeOptionsChange({
              ...avatarRuntimeOptions,
              showMonogramText: !avatarRuntimeOptions.showMonogramText,
            })}
            type="button"
          />
        </div>
      </div>
    </div>
  )
}

function PerformanceOptionsPanel({
  avatarPhotosEnabled,
  avatarRuntimeOptions,
  capReached,
  cacheClearMessage,
  devicePerformanceProfile,
  hideConnectionsOnLowPerformance,
  isClearingSiteCache,
  isRuntimeInspectorButtonLocked,
  lowPerformanceConnectionStatusLabel,
  maxNodes,
  nodeCount,
  runtimeInspectorButtonVisible,
  recommendedMaxNodes,
  onClearSiteCache,
  onToggleRuntimeInspectorButton,
  onGraphMaxNodesChange,
  onToggleAvatarPhotos,
  onToggleHideConnectionsOnLowPerformance,
  onAvatarRuntimeOptionsChange,
}: {
  avatarPhotosEnabled: boolean
  avatarRuntimeOptions: AvatarRuntimeOptions
  capReached: boolean
  cacheClearMessage: string | null
  devicePerformanceProfile: AppStore['devicePerformanceProfile']
  hideConnectionsOnLowPerformance: boolean
  isClearingSiteCache: boolean
  isRuntimeInspectorButtonLocked: boolean
  lowPerformanceConnectionStatusLabel: string
  maxNodes: number
  nodeCount: number
  runtimeInspectorButtonVisible: boolean
  recommendedMaxNodes: number
  onClearSiteCache: () => void
  onToggleRuntimeInspectorButton: () => void
  onGraphMaxNodesChange: (maxNodes: number) => void
  onToggleAvatarPhotos: () => void
  onToggleHideConnectionsOnLowPerformance: () => void
  onAvatarRuntimeOptionsChange: (options: AvatarRuntimeOptions) => void
}) {
  return (
    <div>
      <GraphCapacityPanel
        capReached={capReached}
        devicePerformanceProfile={devicePerformanceProfile}
        maxNodes={maxNodes}
        nodeCount={nodeCount}
        onChange={onGraphMaxNodesChange}
        recommendedMaxNodes={recommendedMaxNodes}
      />
      <div className="sg-settings-section">
        <h4>Fluidez</h4>
        <div className="sg-setting-row">
          <div>
            <div className="sg-setting-row__lbl">Priorizar fluidez</div>
            <div className="sg-setting-row__desc">
              Reduce conexiones visibles cuando el rendimiento cae. Estado: {lowPerformanceConnectionStatusLabel}.
            </div>
          </div>
          <button
            aria-pressed={hideConnectionsOnLowPerformance}
            className={`sg-toggle${hideConnectionsOnLowPerformance ? ' sg-toggle--on' : ''}`}
            onClick={onToggleHideConnectionsOnLowPerformance}
            title={
              hideConnectionsOnLowPerformance
                ? 'Desactivar LOD de conexiones por rendimiento'
                : 'Activar LOD de conexiones por rendimiento'
            }
            type="button"
          />
        </div>
      </div>
      <div className="sg-settings-section">
        <h4>Diagnostico</h4>
        <div className="sg-setting-row">
          <div>
            <div className="sg-setting-row__lbl">Inspector de runtime</div>
            <div className="sg-setting-row__desc">
              Muestra el boton para abrir snapshots del tiempo de ejecucion.
              {isRuntimeInspectorButtonLocked
                ? ' En desarrollo queda visible por defecto.'
                : ' En produccion queda oculto hasta activarlo.'}
            </div>
          </div>
          <button
            aria-pressed={runtimeInspectorButtonVisible}
            className={`sg-toggle${runtimeInspectorButtonVisible ? ' sg-toggle--on' : ''}`}
            disabled={isRuntimeInspectorButtonLocked}
            onClick={onToggleRuntimeInspectorButton}
            title={
              isRuntimeInspectorButtonLocked
                ? 'Visible por defecto en desarrollo'
                : runtimeInspectorButtonVisible
                  ? 'Ocultar boton del inspector de runtime'
                  : 'Mostrar boton del inspector de runtime'
            }
            type="button"
          />
        </div>
      </div>
      <div className="sg-settings-section">
        <h4>Datos locales</h4>
        <div className="sg-setting-row">
          <div>
            <div className="sg-setting-row__lbl">Cache del navegador</div>
            <div className="sg-setting-row__desc">
              Borra datos persistidos de esta pagina y recarga el explorador.
              {cacheClearMessage ? ` ${cacheClearMessage}` : ''}
            </div>
          </div>
          <button
            className="sg-mini-action sg-mini-action--danger"
            disabled={isClearingSiteCache}
            onClick={onClearSiteCache}
            type="button"
          >
            {isClearingSiteCache ? 'Borrando...' : 'Borrar cache'}
          </button>
        </div>
      </div>
      <div className="sg-settings-section">
        <h4>Avatares</h4>
        <div className="sg-setting-row">
          <div>
            <div className="sg-setting-row__lbl">Fotos de avatares</div>
            <div className="sg-setting-row__desc">
              Las fotos reales cuestan mas carga de red, decode y dibujo.
            </div>
          </div>
          <button
            aria-pressed={avatarPhotosEnabled}
            className={`sg-toggle${avatarPhotosEnabled ? ' sg-toggle--on' : ''}`}
            onClick={onToggleAvatarPhotos}
            title={
              avatarPhotosEnabled
                ? 'Desactivar fotos para ahorrar rendimiento'
                : 'Activar fotos de avatares'
            }
            type="button"
          />
        </div>
        <div className="sg-setting-row">
          <div>
            <div className="sg-setting-row__lbl">Ocultar durante movimiento</div>
            <div className="sg-setting-row__desc">
              Pasa a monograma durante pan, drag o movimiento rapido de nodos.
            </div>
          </div>
          <button
            className={`sg-toggle${avatarRuntimeOptions.hideImagesOnFastNodes ? ' sg-toggle--on' : ''}`}
            onClick={() => onAvatarRuntimeOptionsChange({
              ...avatarRuntimeOptions,
              hideImagesOnFastNodes: !avatarRuntimeOptions.hideImagesOnFastNodes,
            })}
            type="button"
          />
        </div>
      </div>
    </div>
  )
}

function AdvancedAvatarOptionsPanel({
  avatarRuntimeOptions,
  avatarPerfSnapshot,
  onAvatarRuntimeOptionsChange,
}: {
  avatarRuntimeOptions: AvatarRuntimeOptions
  avatarPerfSnapshot: PerfBudgetSnapshot | null
  onAvatarRuntimeOptionsChange: (options: AvatarRuntimeOptions) => void
}) {
  const perfStatusLabel = avatarPerfSnapshot
    ? avatarPerfSnapshot.isDegraded
      ? `degradado a ${avatarPerfSnapshot.tier}`
      : `base ${avatarPerfSnapshot.tier}`
    : 'sin datos'
  const adaptiveVisualsActive = avatarPerfSnapshot
    ? avatarPerfSnapshot.isDegraded || avatarPerfSnapshot.budget.maxBucket <= 64
    : false
  const effectiveSizeThreshold = avatarPerfSnapshot && adaptiveVisualsActive
    ? Math.max(avatarRuntimeOptions.sizeThreshold, avatarPerfSnapshot.budget.sizeThreshold)
    : avatarRuntimeOptions.sizeThreshold
  const effectiveZoomThreshold = avatarPerfSnapshot && adaptiveVisualsActive
    ? Math.min(avatarRuntimeOptions.zoomThreshold, avatarPerfSnapshot.budget.zoomThreshold)
    : avatarRuntimeOptions.zoomThreshold

  return (
    <div className="sg-settings-section">
      <h4>Avatares dev</h4>
      <div className="sg-setting-row">
        <div>
          <div className="sg-setting-row__lbl">Monogramas en zoom-out</div>
          <div className="sg-setting-row__desc">Dibuja fallbacks visibles aunque el nodo sea chico</div>
        </div>
        <button
          className={`sg-toggle${avatarRuntimeOptions.showZoomedOutMonograms ? ' sg-toggle--on' : ''}`}
          onClick={() => onAvatarRuntimeOptionsChange({
            ...avatarRuntimeOptions,
            showZoomedOutMonograms: !avatarRuntimeOptions.showZoomedOutMonograms,
          })}
          type="button"
        />
      </div>
      <div className="sg-setting-row">
        <div>
          <div className="sg-setting-row__lbl">Fondo de monograma</div>
          <div className="sg-setting-row__desc">Círculo de color cuando no hay foto lista</div>
        </div>
        <button
          className={`sg-toggle${avatarRuntimeOptions.showMonogramBackgrounds ? ' sg-toggle--on' : ''}`}
          onClick={() => onAvatarRuntimeOptionsChange({
            ...avatarRuntimeOptions,
            showMonogramBackgrounds: !avatarRuntimeOptions.showMonogramBackgrounds,
          })}
          type="button"
        />
      </div>
      <div className="sg-slider-row">
        <div className="sg-slider-row__head">
          <span className="sg-slider-row__lbl">Radio mínimo</span>
          <span className="sg-slider-row__val">{avatarRuntimeOptions.sizeThreshold.toFixed(0)}px</span>
        </div>
        <input
          className="sg-slider"
          max={32}
          min={4}
          onChange={(event) => {
            onAvatarRuntimeOptionsChange({ ...avatarRuntimeOptions, sizeThreshold: Number.parseInt(event.target.value, 10) })
          }}
          step={1}
          type="range"
          value={avatarRuntimeOptions.sizeThreshold}
        />
      </div>
      <div className="sg-slider-row">
        <div className="sg-slider-row__head">
          <span className="sg-slider-row__lbl">Zoom máx para fotos</span>
          <span className="sg-slider-row__val">{avatarRuntimeOptions.zoomThreshold.toFixed(2)}×</span>
        </div>
        <input
          className="sg-slider"
          max={4}
          min={0.6}
          onChange={(event) => {
            onAvatarRuntimeOptionsChange({ ...avatarRuntimeOptions, zoomThreshold: Number.parseFloat(event.target.value) })
          }}
          step={0.05}
          type="range"
          value={avatarRuntimeOptions.zoomThreshold}
        />
      </div>
      <div className="sg-setting-row">
        <div>
          <div className="sg-setting-row__lbl">Todas las fotos visibles</div>
          <div className="sg-setting-row__desc">Muestra fotos en todos los nodos visibles; reescala buckets según el zoom</div>
        </div>
        <button
          className={`sg-toggle${avatarRuntimeOptions.showAllVisibleImages ? ' sg-toggle--on' : ''}`}
          onClick={() => onAvatarRuntimeOptionsChange({
            ...avatarRuntimeOptions,
            showAllVisibleImages: !avatarRuntimeOptions.showAllVisibleImages,
          })}
          type="button"
        />
      </div>
      <div className="sg-setting-row">
        <div>
          <div className="sg-setting-row__lbl">Fotos en nodos chicos</div>
          <div className="sg-setting-row__desc">Permite fotos fuera del umbral de tamaño sin forzar todos los nodos</div>
        </div>
        <button
          className={`sg-toggle${avatarRuntimeOptions.allowZoomedOutImages ? ' sg-toggle--on' : ''}`}
          onClick={() => onAvatarRuntimeOptionsChange({
            ...avatarRuntimeOptions,
            allowZoomedOutImages: !avatarRuntimeOptions.allowZoomedOutImages,
          })}
          type="button"
        />
      </div>
      <div className="sg-setting-row">
        <div>
          <div className="sg-setting-row__lbl">Bucket interactivo max</div>
          <div className="sg-setting-row__desc">Limita calidad durante navegacion</div>
        </div>
        <select
          className="sg-select"
          onChange={(event) => onAvatarRuntimeOptionsChange({
            ...avatarRuntimeOptions,
            maxInteractiveBucket: Number.parseInt(event.target.value, 10) as AvatarRuntimeOptions['maxInteractiveBucket'],
          })}
          value={avatarRuntimeOptions.maxInteractiveBucket}
        >
          {[32, 64, 128, 256].map((bucket) => (
            <option key={bucket} value={bucket}>{bucket}px</option>
          ))}
        </select>
      </div>
      <button
        className="sg-btn"
        onClick={() => { onAvatarRuntimeOptionsChange(DEFAULT_AVATAR_RUNTIME_OPTIONS) }}
        style={{ width: '100%', marginTop: 8 }}
        type="button"
      >
        Reset avatares
      </button>
      <div style={{ marginTop: 12, border: '1px solid var(--sg-stroke)', borderRadius: 8, padding: '10px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 12, color: 'var(--sg-fg-muted)' }}>Adaptivo</span>
          <span style={{ fontFamily: 'var(--sg-font-mono)', fontSize: 11, color: 'var(--sg-fg-muted)' }}>{perfStatusLabel}</span>
        </div>
        <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          {[
            ['FPS EMA', formatFpsWithFrameMs(avatarPerfSnapshot?.emaFrameMs)],
            ['Base', avatarPerfSnapshot?.baseTier ?? 'n/a'],
            ['Loads', avatarPerfSnapshot?.budget.concurrency ?? 'n/a'],
            ['Bucket', avatarPerfSnapshot ? `${avatarPerfSnapshot.budget.maxBucket}px` : 'n/a'],
            ['Radio eff', `${effectiveSizeThreshold.toFixed(0)}px`],
            ['Zoom eff', `${effectiveZoomThreshold.toFixed(2)}×`],
          ].map(([k, v]) => (
            <div key={k as string} style={{ background: 'oklch(100% 0 0 / 0.03)', borderRadius: 6, padding: '4px 8px' }}>
              <div style={{ fontSize: 10, color: 'var(--sg-fg-faint)' }}>{k}</div>
              <div style={{ fontFamily: 'var(--sg-font-mono)', fontSize: 11, color: 'var(--sg-fg-muted)', marginTop: 2 }}>{v}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function mapNostrProfileToSavedRootProfile(profile: NostrProfile): SavedRootProfileSnapshot {
  return {
    displayName: profile.displayName ?? null,
    name: profile.name ?? null,
    picture: profile.picture ?? null,
    about: profile.about ?? null,
    nip05: profile.nip05 ?? null,
    lud16: profile.lud16 ?? null,
  }
}

function mapCanonicalNodeToSavedRootProfile(node: CanonicalNode): SavedRootProfileSnapshot {
  return {
    displayName: node.label ?? null,
    name: node.label ?? null,
    picture: node.picture ?? null,
    about: node.about ?? null,
    nip05: node.nip05 ?? null,
    lud16: node.lud16 ?? null,
  }
}

// ── Main component ────────────────────────────────────────────────────────────

interface SigmaRootLoadChromeProps {
  bridge: LegacyKernelBridge
  displayNodeCount: number
  fallbackMessage: string | null
  hasRoot: boolean
  identityLabel?: string | null
  isRootLoadScreenOpen: boolean
  isRootSheetOpen: boolean
  relayState: CanonicalRelayState
  rootLoadOverride?: RootLoadState | null
  rootPubkey: string | null
  sceneNodeCount: number
}

const EMPTY_SERVER_ROOT_LOAD: RootLoadState = {
  status: 'idle',
  message: null,
  loadedFrom: 'none',
  visibleLinkProgress: null,
}

const getServerRootLoadSnapshot = () => EMPTY_SERVER_ROOT_LOAD

const SigmaRootLoadChrome = memo(function SigmaRootLoadChrome({
  bridge,
  displayNodeCount,
  fallbackMessage,
  hasRoot,
  identityLabel,
  isRootLoadScreenOpen,
  isRootSheetOpen,
  relayState,
  rootLoadOverride,
  rootPubkey,
  sceneNodeCount,
}: SigmaRootLoadChromeProps) {
  const subscribedRootLoad = useSyncExternalStore(
    bridge.subscribeUi,
    () => bridge.getUiState().rootLoad,
    getServerRootLoadSnapshot,
  )
  const rootLoad = rootLoadOverride ?? subscribedRootLoad
  const visibleLoadFeedback =
    fallbackMessage === 'Cargando root...' && rootLoad.message
      ? rootLoad.message
      : fallbackMessage ?? rootLoad.message
  const isGraphLoading =
    !isRootSheetOpen &&
    (isRootLoadScreenOpen ||
      (rootPubkey !== null &&
        rootLoad.status === 'loading' &&
        sceneNodeCount < 3))
  const shouldShowLoadProgressHud =
    !isGraphLoading &&
    !isRootSheetOpen &&
    hasRoot &&
    rootLoad.visibleLinkProgress !== null &&
    isRootLoadProgressActive(rootLoad)

  if (!isGraphLoading && !shouldShowLoadProgressHud) {
    return null
  }

  return (
    <>
      {isGraphLoading ? (
        <SigmaLoadingOverlay
          identityLabel={identityLabel}
          message={visibleLoadFeedback}
          nodeCount={displayNodeCount}
          relayState={relayState}
          rootLoad={rootLoad}
        />
      ) : null}
      {shouldShowLoadProgressHud ? (
        <SigmaLoadProgressHud
          identityLabel={identityLabel}
          message={visibleLoadFeedback}
          nodeCount={displayNodeCount}
          rootLoad={rootLoad}
        />
      ) : null}
    </>
  )
})

interface SigmaTopBarRootLoadBridgeProps
  extends Omit<ComponentProps<typeof SigmaTopBar>, 'searchLoadProgress'> {
  bridge: LegacyKernelBridge
  displayNodeCount: number
  fallbackMessage: string | null
  identityLabel?: string | null
  nodeDrawProgress?: SearchNodeDrawProgress | null
  nodeExpansionLoadProgress?: SearchLoadProgress | null
  rootLoadOverride?: RootLoadState | null
}

const SigmaTopBarRootLoadBridge = memo(function SigmaTopBarRootLoadBridge({
  bridge,
  displayNodeCount,
  fallbackMessage,
  identityLabel,
  nodeDrawProgress = null,
  nodeExpansionLoadProgress = null,
  rootLoadOverride,
  ...topBarProps
}: SigmaTopBarRootLoadBridgeProps) {
  const subscribedRootLoad = useSyncExternalStore(
    bridge.subscribeUi,
    () => bridge.getUiState().rootLoad,
    getServerRootLoadSnapshot,
  )
  const rootLoad = rootLoadOverride ?? subscribedRootLoad
  const shouldPrioritizeRootLoad =
    rootLoad.status !== 'ready' && isRootLoadProgressActive(rootLoad)
  const shouldShowSearchLoadProgress =
    shouldPrioritizeRootLoad ||
    (rootLoad.status === 'ready' && !topBarProps.searchDisabled)
  const rootSearchLoadProgress = useMemo(() => {
    if (!shouldShowSearchLoadProgress) {
      return null
    }

    const progress = buildRootLoadProgressViewModel({
      rootLoad,
      identityLabel,
      nodeCount: displayNodeCount,
      fallbackMessage,
    })

    return {
      percent: progress.percent,
      label: progress.ariaLabel,
    }
  }, [
    displayNodeCount,
    fallbackMessage,
    identityLabel,
    rootLoad,
    shouldShowSearchLoadProgress,
  ])
  const baseSearchLoadProgress = shouldPrioritizeRootLoad
    ? rootSearchLoadProgress
    : nodeExpansionLoadProgress ?? rootSearchLoadProgress
  const searchLoadProgress = useMemo(
    () => includeNodeDrawProgress(baseSearchLoadProgress, nodeDrawProgress),
    [baseSearchLoadProgress, nodeDrawProgress],
  )

  return (
    <SigmaTopBar
      {...topBarProps}
      searchLoadProgress={searchLoadProgress}
    />
  )
})

interface RuntimeInspectorUiStateBridgeProps {
  bridge: LegacyKernelBridge
  children: (uiState: CanonicalGraphUiState) => ReactNode
  fixtureUiState: CanonicalGraphUiState | null
}

const RuntimeInspectorUiStateBridge = memo(function RuntimeInspectorUiStateBridge({
  bridge,
  children,
  fixtureUiState,
}: RuntimeInspectorUiStateBridgeProps) {
  const liveUiState = useSyncExternalStore(
    bridge.subscribeUi,
    bridge.getUiState,
    bridge.getUiState,
  )

  return <>{children(fixtureUiState ?? liveUiState)}</>
})

export default function GraphAppV2() {
  const searchParams = useSearchParams()
  const fixtureName = searchParams.get('fixture')
  const fixtureSource = searchParams.get('fixtureSource')
  const isTestMode = searchParams.get('testMode') === '1'
  // `fixture=drag-local` keeps the drag lab chrome enabled. The synthetic graph
  // is now explicit so the same URL can exercise a real Nostr identity.
  const isFixtureMode =
    isTestMode && fixtureName === 'drag-local' && fixtureSource === 'local'
  const isRealDragLabMode =
    isTestMode && fixtureName === 'drag-local' && fixtureSource !== 'local'
  const isDev = process.env.NODE_ENV === 'development'
  const [bridge] = useState(() => new LegacyKernelBridge())
  const [loadFeedback, setLoadFeedback] = useState<string | null>(
    isFixtureMode
      ? 'Fixture drag-local cargado para Playwright.'
      : isRealDragLabMode
        ? 'Cargando usuario real para drag-local...'
        : null,
  )
  const [actionFeedback, setActionFeedback] = useState<string | null>(null)
  const [notificationHistory, setNotificationHistory] = useState<SigmaNotificationLogEntry[]>([])
  const notificationSequenceRef = useRef(0)
  const lastRecordedNotificationRef = useRef<Record<NotificationSource, string | null>>({
    action: null,
    zap: null,
  })
  const [isIdentityHelpDismissed, setIsIdentityHelpDismissed] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.sessionStorage.getItem(IDENTITY_FIRST_RUN_HELP_KEY) === '1'
  })
  const liveSceneState = useSyncExternalStore(
    bridge.subscribeScene,
    bridge.getSceneState,
    bridge.getSceneState,
  )
  const liveRelayState = useSyncExternalStore(
    bridge.subscribeUi,
    () => bridge.getUiState().relayState,
    () => bridge.getUiState().relayState,
  )
  const [fixtureState, setFixtureState] = useState<CanonicalGraphState | null>(
    () => (isFixtureMode ? createDragLocalFixture().state : null),
  )
  const [lastViewportRatio, setLastViewportRatio] = useState<number | null>(null)
  const [dragInfluenceTuning, setDragInfluenceTuning] =
    useState<DragNeighborhoodInfluenceTuning>(DEFAULT_DRAG_NEIGHBORHOOD_INFLUENCE_TUNING)
  const [physicsTuning, setPhysicsTuning] =
    useState<ForceAtlasPhysicsTuning>(createDefaultPhysicsTuningForViewport)
  const [devPhysicsAutoFreezeEnabled, setDevPhysicsAutoFreezeEnabled] = useState(true)
  const [
    hideConnectionsOnLowPerformance,
    setHideConnectionsOnLowPerformance,
  ] = useState(false)
  const [
    isLowPerformanceForConnections,
    setIsLowPerformanceForConnections,
  ] = useState(false)
  const [avatarRuntimeOptions, setAvatarRuntimeOptions] =
    useState<AvatarRuntimeOptions>(DEFAULT_AVATAR_RUNTIME_OPTIONS)
  const [avatarPerfSnapshot, setAvatarPerfSnapshot] = useState<PerfBudgetSnapshot | null>(null)
  const [activeSettingsTab, setActiveSettingsTab] = useState<SigmaSettingsTab>('performance')
  const [cacheClearStatus, setCacheClearStatus] =
    useState<'idle' | 'running' | 'failed'>('idle')
  const [cacheClearMessage, setCacheClearMessage] = useState<string | null>(null)
  const [isRootSheetOpen, setIsRootSheetOpen] = useState(!isFixtureMode)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isZapsPanelOpen, setIsZapsPanelOpen] = useState(false)
  const [isRuntimeInspectorOpen, setIsRuntimeInspectorOpen] = useState(false)
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false)
  const [isPersonSearchOpen, setIsPersonSearchOpen] = useState(false)
  const [mobileUtilityPanel, setMobileUtilityPanel] = useState<MobileUtilityPanel>(null)
  const [mobilePanelSnap, setMobilePanelSnap] = useState<SigmaPanelSnap>('mid')
  const [personSearchQuery, setPersonSearchQuery] = useState('')
  const personSearchInputRef = useRef<HTMLInputElement | null>(null)
  const [isRootLoadScreenOpen, setIsRootLoadScreenOpen] = useState(false)
  // Rail toggles — direct controls, decoupled from the settings panel
  const [physicsEnabled, setPhysicsEnabled] = useState(true)
  const [avatarPhotosEnabled, setAvatarPhotosEnabled] = useState(
    readStoredAvatarPhotosEnabled,
  )
  const [runtimeInspectorButtonEnabled, setRuntimeInspectorButtonEnabled] =
    useState(() => isDev || readStoredRuntimeInspectorButtonEnabled())
  const [showVisibleEdgeCountLabels, setShowVisibleEdgeCountLabels] = useState(
    readStoredVisibleEdgeCountLabelsEnabled,
  )
  const [showZaps, setShowZaps] = useState(true)
  const [zapFeedMode, setZapFeedMode] = useState<ZapFeedMode>('live')
  const [recentZapReplayRequest, setRecentZapReplayRequest] = useState(0)
  const [recentZapReplayRefreshRequest, setRecentZapReplayRefreshRequest] = useState(0)
  const [pauseLiveZapsWhenSceneIsLarge, setPauseLiveZapsWhenSceneIsLarge] =
    useState(false)
  const [zapActivityLog, setZapActivityLog] = useState<ZapActivityLogEntry[]>([])
  const zapActivitySequenceRef = useRef(0)
  const sigmaHostRef = useRef<SigmaCanvasHostHandle | null>(null)
  const pendingExpansionAutoFitRef = useRef<ExpansionAutoFitRequest | null>(
    null,
  )
  const realDragLabAutoloadAttemptedRef = useRef(false)
  const visibleProfileWarmupAttemptedAtRef = useRef(new Map<string, number>())
  const visibleProfileWarmupInflightRef = useRef(new Set<string>())
  const visibleProfileWarmupDebugRef =
    useRef<VisibleProfileWarmupDebugSnapshot | null>(null)
  const [zapFeedback, setZapFeedback] = useState<string | null>(null)
  const [liveZapFeedFeedback, setLiveZapFeedFeedback] = useState<string | null>(null)
  const [visibleProfileWarmupSnapshot, setVisibleProfileWarmupSnapshot] =
    useState<VisibleProfileWarmupDebugSnapshot | null>(null)
  const {
    savedRoots,
    savedRootsHydrated,
    upsertSavedRoot,
    removeSavedRoot,
    setSavedRootProfile,
  } = useAppStore(useShallow(selectSavedRootState))
  const sessionIdentity = useAuthStore(
    useShallow((state) => ({
      isConnected: state.isConnected,
      profile: state.profile,
    })),
  )
  const runtimeInspectorStoreSnapshot = useAppStore(
    useShallow(selectRuntimeInspectorStoreState),
  )
  const setGraphMaxNodes = useAppStore((state) => state.setGraphMaxNodes)
  const runtimeInspectorStoreState = useMemo(
    () => ({
      graphSummary: {
        nodeCount: runtimeInspectorStoreSnapshot.nodeCount,
        linkCount: runtimeInspectorStoreSnapshot.linkCount,
        maxNodes: runtimeInspectorStoreSnapshot.maxNodes,
        capReached: runtimeInspectorStoreSnapshot.capReached,
      },
      deviceSummary: {
        devicePerformanceProfile:
          runtimeInspectorStoreSnapshot.devicePerformanceProfile,
        effectiveGraphCaps: runtimeInspectorStoreSnapshot.effectiveGraphCaps,
        effectiveImageBudget: runtimeInspectorStoreSnapshot.effectiveImageBudget,
      },
      imageQualityMode: runtimeInspectorStoreSnapshot.imageQualityMode,
      zapSummary: {
        status: runtimeInspectorStoreSnapshot.zapStatus,
        edgeCount: runtimeInspectorStoreSnapshot.zapEdgeCount,
        skippedReceipts: runtimeInspectorStoreSnapshot.zapSkippedReceipts,
        loadedFrom: runtimeInspectorStoreSnapshot.zapLoadedFrom,
        message: runtimeInspectorStoreSnapshot.zapMessage,
        targetCount: runtimeInspectorStoreSnapshot.zapTargetCount,
        lastUpdatedAt: runtimeInspectorStoreSnapshot.zapLastUpdatedAt,
      },
    }),
    [
      runtimeInspectorStoreSnapshot.capReached,
      runtimeInspectorStoreSnapshot.devicePerformanceProfile,
      runtimeInspectorStoreSnapshot.effectiveGraphCaps,
      runtimeInspectorStoreSnapshot.effectiveImageBudget,
      runtimeInspectorStoreSnapshot.imageQualityMode,
      runtimeInspectorStoreSnapshot.linkCount,
      runtimeInspectorStoreSnapshot.maxNodes,
      runtimeInspectorStoreSnapshot.nodeCount,
      runtimeInspectorStoreSnapshot.zapEdgeCount,
      runtimeInspectorStoreSnapshot.zapLastUpdatedAt,
      runtimeInspectorStoreSnapshot.zapLoadedFrom,
      runtimeInspectorStoreSnapshot.zapMessage,
      runtimeInspectorStoreSnapshot.zapSkippedReceipts,
      runtimeInspectorStoreSnapshot.zapStatus,
      runtimeInspectorStoreSnapshot.zapTargetCount,
    ],
  )

  useEffect(() => {
    bridge.connect()
    return () => bridge.dispose()
  }, [bridge])

  useEffect(() => {
    try {
      window.localStorage.setItem(
        AVATAR_PHOTOS_ENABLED_STORAGE_KEY,
        avatarPhotosEnabled ? '1' : '0',
      )
    } catch {
      // Persistence is best-effort; the runtime toggle still works.
    }
  }, [avatarPhotosEnabled])

  useEffect(() => {
    if (isDev) {
      return
    }

    try {
      window.localStorage.setItem(
        RUNTIME_INSPECTOR_BUTTON_STORAGE_KEY,
        runtimeInspectorButtonEnabled ? '1' : '0',
      )
    } catch {
      // Persistence is best-effort; the runtime toggle still works.
    }
  }, [isDev, runtimeInspectorButtonEnabled])

  useEffect(() => {
    try {
      window.localStorage.setItem(
        VISIBLE_EDGE_COUNT_LABELS_STORAGE_KEY,
        showVisibleEdgeCountLabels ? '1' : '0',
      )
    } catch {
      // Non-critical preference persistence.
    }
  }, [showVisibleEdgeCountLabels])

  useEffect(() => {
    setIsLowPerformanceForConnections((current) =>
      resolveLowPerformanceConnectionLodState(avatarPerfSnapshot, current),
    )
  }, [avatarPerfSnapshot])

  useEffect(() => {
    if (!isGraphPerfStatsEnabled()) return
    traceGraphPerf('ui.perfStats.enabled')
    const id = setInterval(() => {
      const proj = getProjectionCacheStats()
      const snap = getSnapshotCacheStats()
      traceGraphPerf('ui.perfStats.cacheStats', {
        projection: proj,
        snapshot: snap,
      })
    }, 2000)
    return () => clearInterval(id)
  }, [])

  const sceneState = fixtureState ?? liveSceneState
  const latestSceneStateRef = useRef(sceneState)
  latestSceneStateRef.current = sceneState
  const fixtureUiState = useMemo(
    () => (fixtureState ? pickFixtureUiState(fixtureState) : null),
    [fixtureState],
  )
  const relayState = fixtureUiState?.relayState ?? liveRelayState
  const controller = useMemo(() => new GraphInteractionController(bridge), [bridge])

  useEffect(() => {
    if (sceneState.rootPubkey && !isFixtureMode) {
      setIsRootSheetOpen(false)
    }
  }, [sceneState.rootPubkey, isFixtureMode])

  const canUseRuntimeInspector = isDev || runtimeInspectorButtonEnabled

  const appendNotification = useCallback(
    (source: NotificationSource, msg: string, tone: SigmaNotificationLogEntry['tone']) => {
      const text = msg.trim()
      if (!text) return
      notificationSequenceRef.current += 1
      const entry: SigmaNotificationLogEntry = {
        id: `${Date.now()}-${notificationSequenceRef.current}`,
        source,
        msg: text,
        tone,
        createdAt: Date.now(),
      }
      setNotificationHistory((current) => [entry, ...current].slice(0, NOTIFICATION_HISTORY_LIMIT))
    },
    [],
  )

  useEffect(() => {
    if (!actionFeedback) {
      lastRecordedNotificationRef.current.action = null
      return
    }
    const key = `action:${actionFeedback}`
    if (lastRecordedNotificationRef.current.action === key) return
    lastRecordedNotificationRef.current.action = key
    appendNotification('action', actionFeedback, 'default')
  }, [actionFeedback, appendNotification])

  useEffect(() => {
    if (!zapFeedback) {
      lastRecordedNotificationRef.current.zap = null
      return
    }
    const key = `zap:${zapFeedback}`
    if (lastRecordedNotificationRef.current.zap === key) return
    lastRecordedNotificationRef.current.zap = key
    appendNotification('zap', zapFeedback, 'zap')
  }, [zapFeedback, appendNotification])

  useEffect(() => {
    if (!actionFeedback) return
    const currentFeedback = actionFeedback
    const timer = window.setTimeout(() => {
      setActionFeedback((current) => (current === currentFeedback ? null : current))
    }, NOTIFICATION_AUTO_DISMISS_MS)
    return () => window.clearTimeout(timer)
  }, [actionFeedback])

  useEffect(() => {
    if (!zapFeedback) return
    const currentFeedback = zapFeedback
    const timer = window.setTimeout(() => {
      setZapFeedback((current) => (current === currentFeedback ? null : current))
    }, NOTIFICATION_AUTO_DISMISS_MS)
    return () => window.clearTimeout(timer)
  }, [zapFeedback])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (mobileUtilityPanel) { setMobileUtilityPanel(null); return }
        if (isPersonSearchOpen) { setIsPersonSearchOpen(false); return }
        if (isSettingsOpen) { setIsSettingsOpen(false); return }
        if (isZapsPanelOpen) { setIsZapsPanelOpen(false); return }
        if (isNotificationsOpen) { setIsNotificationsOpen(false); return }
        if (isRuntimeInspectorOpen) { setIsRuntimeInspectorOpen(false); return }
        if (isRootSheetOpen && sceneState.rootPubkey) { setIsRootSheetOpen(false); return }
        return
      }
      if (canUseRuntimeInspector && event.shiftKey && event.key.toLowerCase() === 'd') {
        const target = event.target as HTMLElement | null
        if (target) {
          const tag = target.tagName
          if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) return
        }
        event.preventDefault()
        setIsPersonSearchOpen(false)
        setIsSettingsOpen(false)
        setIsZapsPanelOpen(false)
        setIsNotificationsOpen(false)
        setMobileUtilityPanel(null)
        setIsRootSheetOpen(false)
        setIsRuntimeInspectorOpen((current) => !current)
        return
      }
      if (event.key === '/') {
        // Don't hijack '/' when typing into an input, textarea, or contenteditable.
        const target = event.target as HTMLElement | null
        if (target) {
          const tag = target.tagName
          if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) return
        }
        if (isRootSheetOpen) return
        event.preventDefault()
        if (sceneState.rootPubkey) {
          setIsSettingsOpen(false)
          setIsZapsPanelOpen(false)
          setIsNotificationsOpen(false)
          setMobileUtilityPanel(null)
          setIsPersonSearchOpen(true)
          window.requestAnimationFrame(() => {
            personSearchInputRef.current?.focus()
          })
          return
        }
        setIsRootSheetOpen(true)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [canUseRuntimeInspector, mobileUtilityPanel, sceneState.rootPubkey, isNotificationsOpen, isPersonSearchOpen, isRootSheetOpen, isRuntimeInspectorOpen, isSettingsOpen, isZapsPanelOpen])

  const closeCompetingSidePanels = useCallback(() => {
    setIsRootSheetOpen(false)
    setIsPersonSearchOpen(false)
    setIsSettingsOpen(false)
    setIsZapsPanelOpen(false)
    setIsNotificationsOpen(false)
    setIsRuntimeInspectorOpen(false)
    setMobileUtilityPanel(null)
  }, [])

  const dismissIdentityHelp = useCallback(() => {
    setIsIdentityHelpDismissed(true)
    if (typeof window === 'undefined') return
    window.sessionStorage.setItem(IDENTITY_FIRST_RUN_HELP_KEY, '1')
  }, [])

  const handleExploreConnections = useCallback((pubkey: string, isExpanded: boolean) => {
    dismissIdentityHelp()
    if (isExpanded) return

    if (!isFixtureMode) {
      const isMobileViewport = isMobileGraphViewport()
      if (isMobileViewport) {
        setMobilePanelSnap('peek')
        pendingExpansionAutoFitRef.current = null
      }
      if (
        shouldScheduleExpansionAutoFit({
          isExpanded,
          isFixtureMode,
          isMobileViewport,
        })
      ) {
        pendingExpansionAutoFitRef.current = createExpansionAutoFitRequest(
          pubkey,
          latestSceneStateRef.current,
        )
      }
    }

    startTransition(() => {
      if (isFixtureMode) {
        setActionFeedback('El fixture no trae conexiones por relay.')
        return
      }
      void bridge.expandNode(pubkey)
        .then((result) => {
          if (result.status === 'error') {
            pendingExpansionAutoFitRef.current = null
          }
          setActionFeedback(result.message)
        })
        .catch((error) => {
          pendingExpansionAutoFitRef.current = null
          setActionFeedback(
            error instanceof Error
              ? `No se pudo expandir: ${error.message}`
              : 'No se pudo expandir el nodo seleccionado.',
          )
        })
    })
  }, [bridge, dismissIdentityHelp, isFixtureMode])

  const latestNodesByPubkeyRef = useRef(sceneState.nodesByPubkey)
  latestNodesByPubkeyRef.current = sceneState.nodesByPubkey

  const callbacks = useMemo<GraphInteractionCallbacks>(
    () =>
      isFixtureMode
        ? {
            onNodeClick: (pubkey: string) => {
              closeCompetingSidePanels()
              setMobilePanelSnap('peek')
              setFixtureState((current) =>
                current ? { ...current, selectedNodePubkey: pubkey } : current,
              )
            },
            onNodeDoubleClick: (pubkey: string) => {
              closeCompetingSidePanels()
              setMobilePanelSnap('peek')
              setFixtureState((current) =>
                current ? { ...current, selectedNodePubkey: pubkey } : current,
              )
              handleExploreConnections(
                pubkey,
                latestNodesByPubkeyRef.current[pubkey]?.isExpanded ?? false,
              )
            },
            onClearSelection: () => {
              setFixtureState((current) =>
                current ? { ...current, selectedNodePubkey: null } : current,
              )
            },
            onNodeHover: () => {},
            onNodeDragStart: () => {},
            onNodeDragMove: () => {},
            onNodeDragEnd: (pubkey, _position, options) => {
              if (!options?.pinNode) return
              setFixtureState((current) => {
                if (!current || current.pinnedNodePubkeys.has(pubkey)) return current
                const pinnedNodePubkeys = new Set(current.pinnedNodePubkeys)
                pinnedNodePubkeys.add(pubkey)
                return withClientSceneSignature({ ...current, pinnedNodePubkeys })
              })
            },
            onViewportChange: (viewport: GraphViewportState) => {
              setLastViewportRatio(viewport.ratio)
            },
          }
        : {
            ...controller.callbacks,
            onNodeClick: (pubkey: string) => {
              closeCompetingSidePanels()
              setMobilePanelSnap('peek')
              controller.callbacks.onNodeClick(pubkey)
            },
            onNodeDoubleClick: (pubkey: string) => {
              closeCompetingSidePanels()
              setMobilePanelSnap('peek')
              controller.callbacks.onNodeDoubleClick(pubkey)
              handleExploreConnections(
                pubkey,
                latestNodesByPubkeyRef.current[pubkey]?.isExpanded ?? false,
              )
            },
          },
    [closeCompetingSidePanels, controller, handleExploreConnections, isFixtureMode],
  )

  const prevSignatureRef = useRef<string | null>(null)
  useEffect(() => {
    if (!isGraphPerfStatsEnabled()) return
    const sig = sceneState.sceneSignature
    const prev = prevSignatureRef.current
    if (prev !== null && prev !== sig) {
      const prevParts = prev.split('|')
      const nextParts = sig.split('|')
      const KEYS = ['rootPubkey','activeLayer','connectionsSourceLayer','selectedNodePubkey','graphRevision','inboundGraphRevision','connectionsLinksRevision','nodeVisualRevision','expandedNodePubkeys','nodeCount','edgeCount','pinnedNodePubkeys']
      const changed = KEYS.filter((k, i) => prevParts[i] !== nextParts[i])
      traceGraphPerf('ui.sceneSignature.changed', {
        changed,
        activeLayer: sceneState.activeLayer,
        nodeCount: Object.keys(sceneState.nodesByPubkey).length,
        edgeCount: Object.keys(sceneState.edgesById).length,
      })
    }
    prevSignatureRef.current = sig
  })

  const deferredSceneState = useDeferredValue(sceneState)
  const isSceneTransitionPending =
    sceneState.sceneSignature !== deferredSceneState.sceneSignature
  const deferredScene = useMemo(
    () => buildGraphSceneSnapshot(deferredSceneState),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deferredSceneState.sceneSignature],
  )
  const visiblePubkeys = useMemo(
    () => deferredScene.render.nodes.map((node) => node.pubkey),
    [deferredScene.render.nodes],
  )
  const latestVisibleWarmupRef = useRef({
    deferredScene,
    scenePubkeys: visiblePubkeys,
    sceneState: deferredSceneState,
  })
  latestVisibleWarmupRef.current = {
    deferredScene,
    scenePubkeys: visiblePubkeys,
    sceneState: deferredSceneState,
  }
  const deferredPersonSearchQuery = useDeferredValue(personSearchQuery)
  const personSearchMatches = useMemo(
    () =>
      buildPersonSearchMatches(
        deferredScene.render.nodes,
        deferredPersonSearchQuery,
      ),
    [deferredPersonSearchQuery, deferredScene],
  )
  const displayScene = useMemo(
    () =>
      applyVisibleEdgeCountLabels(
        applyPersonSearchHighlight(deferredScene, personSearchMatches),
        showVisibleEdgeCountLabels,
      ),
    [deferredScene, personSearchMatches, showVisibleEdgeCountLabels],
  )

  useEffect(() => {
    const pendingRequest = pendingExpansionAutoFitRef.current
    if (!pendingRequest) {
      return
    }

    if (
      shouldClearExpansionAutoFitRequest(
        pendingRequest,
        deferredSceneState,
      )
    ) {
      pendingExpansionAutoFitRef.current = null
      return
    }

    if (
      !shouldRunExpansionAutoFit(
        pendingRequest,
        deferredSceneState,
        isSceneTransitionPending,
      )
    ) {
      return
    }

    pendingExpansionAutoFitRef.current = null
    if (isMobileGraphViewport()) {
      return
    }
    sigmaHostRef.current?.fitCameraToGraphAfterPhysicsSettles()
  }, [deferredSceneState, isSceneTransitionPending])

  const detail = useMemo(
    () => buildNodeDetailProjection(sceneState),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sceneState.nodeDetailRevision, sceneState.sceneSignature],
  )

  useEffect(() => {
    const latest = latestVisibleWarmupRef.current
    if (
      isFixtureMode ||
      isSceneTransitionPending ||
      !latest.sceneState.rootPubkey ||
      latest.deferredScene.render.nodes.length === 0
    ) {
      visibleProfileWarmupDebugRef.current = null
      setVisibleProfileWarmupSnapshot(null)
      return
    }

    let cancelled = false
    let timeoutId: ReturnType<typeof setTimeout> | null = null

    const runWarmup = () => {
      if (cancelled) {
        return
      }

      const now = Date.now()
      const attemptedAtByPubkey = visibleProfileWarmupAttemptedAtRef.current
      const inflightPubkeys = visibleProfileWarmupInflightRef.current
      const viewportPubkeys =
        sigmaHostRef.current?.getVisibleNodePubkeys() ?? []
      const { scenePubkeys, sceneState: latestSceneState } =
        latestVisibleWarmupRef.current
      const selection = selectVisibleProfileWarmupPubkeys({
        viewportPubkeys,
        scenePubkeys,
        nodesByPubkey: latestSceneState.nodesByPubkey,
        attemptedAtByPubkey,
        inflightPubkeys,
        now,
        batchSize: VISIBLE_PROFILE_WARMUP_BATCH_SIZE,
        cooldownMs: VISIBLE_PROFILE_WARMUP_COOLDOWN_MS,
      })
      visibleProfileWarmupDebugRef.current =
        buildVisibleProfileWarmupDebugSnapshot({
          viewportPubkeys,
          scenePubkeys,
          nodesByPubkey: latestSceneState.nodesByPubkey,
          attemptedAtByPubkey,
          inflightPubkeys,
          now,
          batchSize: VISIBLE_PROFILE_WARMUP_BATCH_SIZE,
          cooldownMs: VISIBLE_PROFILE_WARMUP_COOLDOWN_MS,
        })
      setVisibleProfileWarmupSnapshot(visibleProfileWarmupDebugRef.current)
      const pubkeys = selection.pubkeys

      for (const pubkey of pubkeys) {
        attemptedAtByPubkey.set(pubkey, now)
        inflightPubkeys.add(pubkey)
      }

      if (pubkeys.length === 0) {
        return
      }

      traceGraphPerf('ui.visibleProfileWarmup.batch', {
        requested: pubkeys.length,
        viewportPubkeys: selection.viewportPubkeyCount,
        scenePubkeys: selection.scenePubkeyCount,
        eligible: selection.eligibleCount,
        skipped: selection.skipped,
        sample: pubkeys.slice(0, 6).map((pubkey) => pubkey.slice(0, 12)),
      })

      void bridge
        .prefetchNodeProfiles(pubkeys)
        .catch((error) => {
          console.warn('Visible profile warmup failed:', error)
        })
        .finally(() => {
          for (const pubkey of pubkeys) {
            inflightPubkeys.delete(pubkey)
          }

          if (!cancelled) {
            timeoutId = setTimeout(
              runWarmup,
              VISIBLE_PROFILE_WARMUP_LOOP_DELAY_MS,
            )
          }
        })
    }

    timeoutId = setTimeout(runWarmup, VISIBLE_PROFILE_WARMUP_INITIAL_DELAY_MS)

    return () => {
      cancelled = true
      if (timeoutId !== null) {
        clearTimeout(timeoutId)
      }
    }
  }, [
    bridge,
    isFixtureMode,
    isSceneTransitionPending,
    deferredSceneState.sceneSignature,
  ])

  // Pre-calcular la capa completa (graph) en segundo plano para que el
  // usuario no tenga penalidad de tiempo al alternar desde "mutuos"
  useEffect(() => {
    if (
      isFixtureMode ||
      isSceneTransitionPending ||
      deferredSceneState.activeLayer === 'graph' ||
      !deferredSceneState.rootPubkey
    ) {
      return
    }

    const timeoutId = setTimeout(() => {
      const warmupState = withClientSceneSignature({
        ...deferredSceneState,
        activeLayer: 'graph',
      })
      const startedAtMs = isGraphPerfTraceEnabled() ? nowGraphPerfMs() : 0
      // Ejecutar la proyeccion almacena la salida en snapshotCache.
      const snapshot = buildGraphSceneSnapshot(warmupState)
      if (startedAtMs > 0) {
        traceGraphPerfDuration(
          'ui.fullGraphWarmup.snapshot',
          startedAtMs,
          () => ({
            sourceLayer: deferredSceneState.activeLayer,
            activeLayer: warmupState.activeLayer,
            nodeCount: snapshot.render.nodes.length,
            visibleEdgeCount: snapshot.render.visibleEdges.length,
            physicsNodeCount: snapshot.physics.nodes.length,
            physicsEdgeCount: snapshot.physics.edges.length,
            graphRevision: warmupState.discoveryState.graphRevision,
            inboundGraphRevision:
              warmupState.discoveryState.inboundGraphRevision,
            connectionsLinksRevision:
              warmupState.discoveryState.connectionsLinksRevision,
          }),
          { thresholdMs: 16 },
        )
      }
    }, 200)

    return () => {
      clearTimeout(timeoutId)
    }
  }, [deferredSceneState, isFixtureMode, isSceneTransitionPending])

  const currentRootNode = sceneState.rootPubkey
    ? sceneState.nodesByPubkey[sceneState.rootPubkey] ?? null
    : null
  const isDragFixtureLab = fixtureName === 'drag-local'
  const hasSavedRoots = savedRoots.length > 0
  const shouldShowSavedRootsSection = !savedRootsHydrated || hasSavedRoots

  const updateFixtureState = useCallback((updater: (current: CanonicalGraphState) => CanonicalGraphState) => {
    setFixtureState((current) => current ? withClientSceneSignature(updater(current)) : current)
  }, [])

  const clearSelectedNode = useCallback(() => {
    if (isFixtureMode) {
      updateFixtureState((current) => ({ ...current, selectedNodePubkey: null }))
      return
    }
    bridge.selectNode(null)
  }, [bridge, isFixtureMode, updateFixtureState])

  useEffect(() => {
    if (!sceneState.rootPubkey || !currentRootNode) return
    if (!currentRootNode.label && !currentRootNode.picture && !currentRootNode.nip05 && !currentRootNode.about && !currentRootNode.lud16) return
    setSavedRootProfile(
      sceneState.rootPubkey,
      mapCanonicalNodeToSavedRootProfile(currentRootNode),
      currentRootNode.profileFetchedAt ?? Date.now(),
    )
  }, [currentRootNode, sceneState.rootPubkey, setSavedRootProfile])

  const togglePinnedNode = useCallback((pubkey: string) => {
    const shouldPin = !sceneState.pinnedNodePubkeys.has(pubkey)
    sigmaHostRef.current?.setNodePinned(pubkey, shouldPin)

    if (!isFixtureMode) { bridge.togglePinnedNode(pubkey); return }
    updateFixtureState((current) => {
      const pinnedNodePubkeys = new Set(current.pinnedNodePubkeys)
      if (pinnedNodePubkeys.has(pubkey)) pinnedNodePubkeys.delete(pubkey)
      else pinnedNodePubkeys.add(pubkey)
      return { ...current, pinnedNodePubkeys }
    })
  }, [bridge, sceneState.pinnedNodePubkeys, isFixtureMode, updateFixtureState])

  const handleToggleDetailPin = useCallback((pubkey: string) => {
    dismissIdentityHelp()
    togglePinnedNode(pubkey)
  }, [dismissIdentityHelp, togglePinnedNode])

  const toggleLayer = useCallback((layer: (typeof GRAPH_V2_LAYERS)[number]) => {
    if (!isFixtureMode) { bridge.toggleLayer(layer); return }
    updateFixtureState((current) => ({
      ...current,
      activeLayer: layer,
      connectionsSourceLayer:
        layer === 'connections' && current.activeLayer !== 'connections'
          ? 'mutuals'
          : current.connectionsSourceLayer,
    }))
  }, [bridge, isFixtureMode, updateFixtureState])

  const updateDragInfluenceTuning = useCallback(function updateDragInfluenceTuning<K extends keyof DragNeighborhoodInfluenceTuning>(
    key: K, value: DragNeighborhoodInfluenceTuning[K],
  ) { setDragInfluenceTuning((current) => ({ ...current, [key]: value })) }, [])

  const visibleNodeSet = useMemo(() => new Set(visiblePubkeys), [visiblePubkeys])
  const sceneConnectionLookup = useMemo(
    () => buildSceneConnectionIndex(sceneState.edgesById),
    [sceneState.edgesById],
  )
  const appendZapActivity = useCallback((
    zap: Pick<ParsedZap, 'fromPubkey' | 'toPubkey' | 'sats'>,
    source: ZapActivitySource,
    played: boolean,
  ) => {
    zapActivitySequenceRef.current += 1
    const entry: ZapActivityLogEntry = {
      id: `${Date.now()}-${zapActivitySequenceRef.current}`,
      source,
      fromPubkey: zap.fromPubkey,
      toPubkey: zap.toPubkey,
      sats: zap.sats,
      played,
      createdAt: Date.now(),
    }
    setZapActivityLog((current) => [entry, ...current].slice(0, ZAP_ACTIVITY_LIMIT))
  }, [])

  const handleZap = useCallback((zap: Pick<ParsedZap, 'fromPubkey' | 'toPubkey' | 'sats'>) => {
    const shouldTrace = shouldTraceZapPair(zap)

    if (!showZaps) {
      if (shouldTrace) {
        traceZapFlow('uiZapGate.dropped', {
          reason: 'zaps-hidden',
          fromPubkey: zap.fromPubkey,
          toPubkey: zap.toPubkey,
          sats: zap.sats,
        })
      }
      return false
    }
    
    // Animar el zap sólo si ambos nodos están presentes en el renderizado
    const hasVisibleFrom = visibleNodeSet.has(zap.fromPubkey)
    const hasVisibleTo = visibleNodeSet.has(zap.toPubkey)
    if (!hasVisibleFrom || !hasVisibleTo) {
      if (hasVisibleTo && !hasVisibleFrom) {
        const played = sigmaHostRef.current?.playZapArrival({
          toPubkey: zap.toPubkey,
          sats: zap.sats,
        }) ?? false
        if (shouldTrace) {
          traceZapFlow(played ? 'uiZapGate.played' : 'uiZapGate.dropped', {
            reason: played ? 'arrival-only' : 'arrival-overlay-rejected',
            fromPubkey: zap.fromPubkey,
            toPubkey: zap.toPubkey,
            sats: zap.sats,
            hasVisibleFrom,
            hasVisibleTo,
            activeLayer: sceneState.activeLayer,
            visibleNodeCount: visibleNodeSet.size,
          })
        }
        return played
      }

      if (shouldTrace) {
        traceZapFlow('uiZapGate.dropped', {
          reason: 'endpoint-not-visible',
          fromPubkey: zap.fromPubkey,
          toPubkey: zap.toPubkey,
          sats: zap.sats,
          hasVisibleFrom,
          hasVisibleTo,
          activeLayer: sceneState.activeLayer,
          visibleNodeCount: visibleNodeSet.size,
        })
      }
      return false
    }
    
    const matchedConnection =
      sceneConnectionLookup.connections.get(
        createSceneConnectionKey(zap.fromPubkey, zap.toPubkey),
      ) ?? null
    
    if (!matchedConnection) {
      if (shouldTrace) {
        traceZapFlow('uiZapGate.dropped', {
          reason: 'missing-scene-connection',
          fromPubkey: zap.fromPubkey,
          toPubkey: zap.toPubkey,
          sats: zap.sats,
          sceneEdgeCount: sceneConnectionLookup.edgeCount,
          visibleNodeCount: visibleNodeSet.size,
        })
      }
      return false
    }

    const played = sigmaHostRef.current?.playZap(zap) ?? false
    if (shouldTrace) {
      traceZapFlow(played ? 'uiZapGate.played' : 'uiZapGate.dropped', {
        reason: played ? 'accepted' : 'overlay-rejected',
        fromPubkey: zap.fromPubkey,
        toPubkey: zap.toPubkey,
        sats: zap.sats,
        matchedConnection,
      })
    }

    return played
  }, [sceneConnectionLookup, sceneState.activeLayer, showZaps, visibleNodeSet])

  // Propagate physics pause/resume to the Sigma runtime when toggled.
  useEffect(() => {
    sigmaHostRef.current?.setPhysicsSuspended(!physicsEnabled)
  }, [physicsEnabled])

  const canRunZapFeed = canRunZapFeedForScene({
    showZaps,
    isFixtureMode,
    activeLayer: sceneState.activeLayer,
  })
  const shouldEnableLiveZapFeed = canRunZapFeed && zapFeedMode === 'live'
  const shouldEnableRecentZapReplay =
    canRunZapFeed && zapFeedMode === 'recent-hour'
  const handleLiveZap = useCallback((zap: ParsedZap) => {
    const played = handleZap(zap)
    appendZapActivity(zap, 'live', played)
    setLiveZapFeedFeedback(null)
  }, [appendZapActivity, handleZap])
  const handleRecentZapReplay = useCallback((zap: ParsedZap) => {
    const played = handleZap(zap)
    appendZapActivity(zap, 'recent-hour', played)
    return played
  }, [appendZapActivity, handleZap])
  useLiveZapFeed({
    visiblePubkeys,
    enabled: shouldEnableLiveZapFeed,
    enforceVisiblePubkeyLimit: pauseLiveZapsWhenSceneIsLarge,
    onZap: handleLiveZap,
    onDropped: (msg: string) => {
      setLiveZapFeedFeedback(msg)
      setZapFeedback(msg)
    },
  })
  const recentZapReplay = useRecentZapReplay({
    visiblePubkeys,
    enabled: shouldEnableRecentZapReplay,
    replayKey: recentZapReplayRequest,
    refreshKey: recentZapReplayRefreshRequest,
    onZap: handleRecentZapReplay,
  })
  const recentZapReplayStages = useMemo(
    () => buildZapReplayStageRows(recentZapReplay),
    [recentZapReplay],
  )

  useEffect(() => {
    if (!shouldEnableLiveZapFeed || !pauseLiveZapsWhenSceneIsLarge) {
      setLiveZapFeedFeedback(null)
    }
    if (zapFeedMode !== 'live' || !pauseLiveZapsWhenSceneIsLarge) {
      setZapFeedback((current) =>
        current?.includes(`supera el limite ${MAX_ZAP_FILTER_PUBKEYS}`) ||
        current === 'Zaps live pausados: no hay nodos visibles para filtrar.'
          ? null
          : current,
      )
    }
  }, [pauseLiveZapsWhenSceneIsLarge, shouldEnableLiveZapFeed, zapFeedMode])

  const settingsTabs = useMemo(
    () =>
      isDev || isFixtureMode
        ? [...PUBLIC_SIGMA_SETTINGS_TABS, DEV_SIGMA_SETTINGS_TAB]
        : PUBLIC_SIGMA_SETTINGS_TABS,
    [isDev, isFixtureMode],
  )

  useEffect(() => {
    if (!canUseRuntimeInspector && isRuntimeInspectorOpen) {
      setIsRuntimeInspectorOpen(false)
    }
  }, [canUseRuntimeInspector, isRuntimeInspectorOpen])

  const findSimulationPair = useCallback((): { from: string; to: string } | null => {
    for (const edge of deferredScene.render.visibleEdges) {
      if (edge.hidden) continue
      if (!visibleNodeSet.has(edge.source)) continue
      if (!visibleNodeSet.has(edge.target)) continue
      return { from: edge.source, to: edge.target }
    }
    return null
  }, [deferredScene.render.visibleEdges, visibleNodeSet])
  const simulationPair = useMemo(
    () => (isDev ? findSimulationPair() : null),
    [findSimulationPair, isDev],
  )

  const stableAvatarRuntimeOptions = useMemo(() => avatarRuntimeOptions, [avatarRuntimeOptions])
  const lowPerformanceConnectionHidingActive =
    hideConnectionsOnLowPerformance &&
    isLowPerformanceForConnections
  const lowPerformanceConnectionStatusLabel = lowPerformanceConnectionHidingActive
    ? 'ocultando conexiones'
    : isLowPerformanceForConnections
      ? 'bajo rendimiento detectado'
      : 'rendimiento estable'
  const handleAvatarPerfSnapshot = useCallback(
    (snapshot: PerfBudgetSnapshot | null) => { setAvatarPerfSnapshot(snapshot) },
    [],
  )

  const handleSimulateZap = useCallback(() => {
    const pair = findSimulationPair()
    if (!pair) { setZapFeedback('Sin pares visibles conectados para simular.'); return }
    const flipped = Math.random() < 0.5
    const fromPubkey = flipped ? pair.to : pair.from
    const toPubkey = flipped ? pair.from : pair.to
    const buckets = [21, 210, 2_100, 21_000, 210_000]
    const sats = buckets[Math.floor(Math.random() * buckets.length)]
    const played = handleZap({ fromPubkey, toPubkey, sats })
    appendZapActivity({ fromPubkey, toPubkey, sats }, 'simulated', played)
    setZapFeedback(
      played
        ? `Zap simulado: ${sats} sats ${fromPubkey.slice(0, 8)}… → ${toPubkey.slice(0, 8)}…`
        : 'No se pudo reproducir el zap simulado.',
    )
  }, [appendZapActivity, findSimulationPair, handleZap])

  const updatePhysicsTuning = useCallback(function updatePhysicsTuning<K extends keyof ForceAtlasPhysicsTuning>(
    key: K, value: ForceAtlasPhysicsTuning[K],
  ) { setPhysicsTuning((current) => ({ ...current, [key]: value })) }, [])

  const handleApplyRelays = useCallback(async (relayUrls: string[]) => {
    if (isFixtureMode) {
      updateFixtureState((current) => ({ ...current, relayState: { ...current.relayState, urls: relayUrls } }))
      setActionFeedback(`Fixture actualizado con ${relayUrls.length} relays.`)
      return { relayUrls, overrideStatus: 'idle', isGraphStale: false, message: `Fixture actualizado con ${relayUrls.length} relays.` }
    }
    const result = await bridge.setRelays(relayUrls)
    setActionFeedback(result.message)
    return result
  }, [bridge, isFixtureMode, updateFixtureState])

  const handleRevertRelays = useCallback(async () => {
    if (isFixtureMode) {
      updateFixtureState((current) => ({ ...current, relayState: { ...current.relayState, urls: ['wss://fixture.local'] } }))
      setActionFeedback('Fixture de relays revertido.')
      return
    }
    const result = await bridge.revertRelays()
    setActionFeedback(result?.message ?? 'No había override activo para revertir.')
  }, [bridge, isFixtureMode, updateFixtureState])

  const openSettingsTab = useCallback((tab: SigmaSettingsTab) => {
    setActiveSettingsTab(tab)
    setIsRootSheetOpen(false)
    setIsPersonSearchOpen(false)
    setIsZapsPanelOpen(false)
    setIsNotificationsOpen(false)
    setIsRuntimeInspectorOpen(false)
    setMobileUtilityPanel(null)
    setMobilePanelSnap('mid')
    setIsSettingsOpen(true)
  }, [])

  const loadRootFromPointer = useCallback(
    ({
      pubkey,
      relays = [],
      npub,
      source = 'npub',
      evidence,
      profile,
      profileFetchedAt,
    }: LoadRootInput) => {
      setLoadFeedback('Cargando root...')
      setIsRootSheetOpen(false)
      setIsRootLoadScreenOpen(true)
      setIsZapsPanelOpen(false)
      setIsRuntimeInspectorOpen(false)
      startTransition(() => {
        if (isFixtureMode) {
          setLoadFeedback('El fixture no admite cargar roots manuales.')
          setIsRootLoadScreenOpen(false)
          return
        }
        const encodedNpub = npub ?? nip19.npubEncode(pubkey)
        upsertSavedRoot({
          pubkey,
          npub: encodedNpub,
          openedAt: Date.now(),
          relayHints: relays,
          source,
          evidence,
          profile,
          profileFetchedAt,
        })
        const minimumLoadingMs = new Promise((resolve) => window.setTimeout(resolve, 900))
        void Promise.all([
          bridge.loadRoot(pubkey, { bootstrapRelayUrls: relays }),
          minimumLoadingMs,
        ])
          .then(([result]) => result)
          .then((result) => {
            setLoadFeedback(result.message)
            setIsRootLoadScreenOpen(false)
          })
          .catch((error) => {
            setLoadFeedback(error instanceof Error ? error.message : 'No se pudo cargar el root.')
            setIsRootLoadScreenOpen(false)
            setIsRootSheetOpen(true)
          })
      })
    },
    [bridge, isFixtureMode, upsertSavedRoot],
  )

  const handleSelectSavedRoot = useCallback(
    (savedRoot: SavedRootEntry) => {
      loadRootFromPointer({
        pubkey: savedRoot.pubkey,
        source: savedRoot.source ?? 'npub',
        evidence: savedRoot.evidence,
        npub: savedRoot.npub,
        relays: savedRoot.relayHints ?? [],
        profile: savedRoot.profile,
        profileFetchedAt: savedRoot.profileFetchedAt,
      })
    },
    [loadRootFromPointer],
  )

  const handleSelectSessionRoot = useCallback(() => {
    const profile = sessionIdentity.profile
    if (!sessionIdentity.isConnected || !profile?.pubkey) return

    loadRootFromPointer({
      pubkey: profile.pubkey,
      source: 'session',
      evidence: {
        normalizedInput: profile.npub,
      },
      npub: profile.npub,
      relays: [],
      profile: mapNostrProfileToSavedRootProfile(profile),
      profileFetchedAt: Date.now(),
    })
  }, [loadRootFromPointer, sessionIdentity.isConnected, sessionIdentity.profile])

  useEffect(() => {
    if (!isRealDragLabMode) {
      realDragLabAutoloadAttemptedRef.current = false
      return
    }
    if (
      realDragLabAutoloadAttemptedRef.current ||
      sceneState.rootPubkey ||
      isRootLoadScreenOpen
    ) {
      return
    }

    const sessionProfile = sessionIdentity.isConnected
      ? sessionIdentity.profile
      : null
    if (sessionProfile?.pubkey) {
      realDragLabAutoloadAttemptedRef.current = true
      loadRootFromPointer({
        pubkey: sessionProfile.pubkey,
        source: 'session',
        evidence: {
          normalizedInput: sessionProfile.npub,
        },
        npub: sessionProfile.npub,
        relays: [],
        profile: mapNostrProfileToSavedRootProfile(sessionProfile),
        profileFetchedAt: Date.now(),
      })
      return
    }

    if (!savedRootsHydrated) {
      return
    }

    const savedRoot = savedRoots[0]
    if (!savedRoot) {
      realDragLabAutoloadAttemptedRef.current = true
      setLoadFeedback('Elegí una identidad real para usar el laboratorio drag-local.')
      setIsRootSheetOpen(true)
      return
    }

    realDragLabAutoloadAttemptedRef.current = true
    loadRootFromPointer({
      pubkey: savedRoot.pubkey,
      source: savedRoot.source ?? 'npub',
      evidence: savedRoot.evidence,
      npub: savedRoot.npub,
      relays: savedRoot.relayHints ?? [],
      profile: savedRoot.profile,
      profileFetchedAt: savedRoot.profileFetchedAt,
    })
  }, [
    isRealDragLabMode,
    isRootLoadScreenOpen,
    loadRootFromPointer,
    savedRoots,
    savedRootsHydrated,
    sceneState.rootPubkey,
    sessionIdentity.isConnected,
    sessionIdentity.profile,
  ])

  const handleDeleteSavedRoot = useCallback(
    (savedRoot: SavedRootEntry) => { removeSavedRoot(savedRoot.pubkey) },
    [removeSavedRoot],
  )

  // ── Derived values for UI components ───────────────────────────────────────

  const hasRoot = sceneState.rootPubkey !== null
  const nodeExpansionLoadProgress = useMemo(
    () => resolveNodeExpansionSearchProgress(sceneState.nodesByPubkey),
    [sceneState.nodesByPubkey],
  )
  const searchNodeDrawProgress = useMemo(
    () => buildSearchNodeDrawProgress({
      drawnNodeCount: displayScene.render.nodes.length,
      isSceneTransitionPending,
      loadedNodeCount: Object.keys(sceneState.nodesByPubkey).length,
    }),
    [
      displayScene.render.nodes.length,
      isSceneTransitionPending,
      sceneState.nodesByPubkey,
    ],
  )

  // Saved-roots profile snapshot as fallback while the kernel is still
  // hydrating `currentRootNode` — prevents empty avatar / display name on
  // first paint after selecting a saved root.
  const savedRootProfile = useMemo(() => {
    if (!sceneState.rootPubkey) return null
    return savedRoots.find((r) => r.pubkey === sceneState.rootPubkey)?.profile ?? null
  }, [savedRoots, sceneState.rootPubkey])
  const rootDisplayName =
    currentRootNode?.label ?? savedRootProfile?.displayName ?? savedRootProfile?.name ?? null
  const rootPictureUrl = currentRootNode?.picture ?? savedRootProfile?.picture ?? null
  const rootNpubEncoded = useMemo(() => {
    return encodePubkeyAsNpub(sceneState.rootPubkey)
  }, [sceneState.rootPubkey])

  // Filter bar: active pill maps from active layer
  const filterActiveId = useMemo((): FilterPill['id'] => {
    const layer = sceneState.activeLayer
    if (layer === 'following') return 'following'
    if (layer === 'followers') return 'followers'
    if (layer === 'mutuals') return 'mutuals'
    if (layer === 'connections') return 'connections'
    if (layer === 'following-non-followers' || layer === 'nonreciprocal-followers') return 'oneway'
    return 'all'
  }, [sceneState.activeLayer])

  const filterPills: FilterPill[] = useMemo(() => [
    {
      id: 'all',
      label: 'Toda la red',
      count: deferredScene.render.diagnostics.nodeCount,
      swatch: 'oklch(55% 0.02 230)',
      hint: 'Vista base: raiz, follows salientes, followers entrantes y nodos expandidos.',
    },
    {
      id: 'following',
      label: 'A quienes sigo',
      count: null,
      swatch: '#84c7ff',
      hint: 'A quienes sigo: follows salientes desde la raiz y desde nodos expandidos.',
    },
    {
      id: 'followers',
      label: 'Me siguen',
      count: null,
      swatch: '#ffb86b',
      hint: 'Me siguen: follows entrantes hacia la raiz y nodos expandidos.',
    },
    {
      id: 'mutuals',
      label: 'Mutuos',
      count: null,
      swatch: '#5fd39d',
      hint: 'Mutuos: relacion de ida y vuelta confirmada.',
    },
    {
      id: 'oneway',
      label: 'Sin reciprocidad',
      count: null,
      swatch: 'oklch(60% 0.06 80)',
      hint: 'Sin reciprocidad: vinculo confirmado de un solo lado.',
    },
    {
      id: 'connections',
      label: 'Conexiones',
      count: null,
      caption: 'mutuos',
      swatch: 'oklch(76% 0.1 180)',
      hint: 'Conexiones: solo mutuos de raiz y expandidos.',
    },
  ], [deferredScene.render.diagnostics.nodeCount])

  const handleFilterSelect = useCallback((id: FilterPill['id']) => {
    if (id === 'all')       { toggleLayer('graph'); return }
    if (id === 'following') { toggleLayer('following'); return }
    if (id === 'followers') { toggleLayer('followers'); return }
    if (id === 'mutuals')   { toggleLayer('mutuals'); return }
    if (id === 'connections') {
      if (sceneState.activeLayer === 'connections') return
      toggleLayer('connections')
      return
    }
    if (id === 'oneway') {
      const cur = sceneState.activeLayer
      if (cur === 'following-non-followers' || cur === 'nonreciprocal-followers') return
      toggleLayer('following-non-followers')
    }
  }, [sceneState.activeLayer, toggleLayer])

  // HUD stats
  const hudStats: HudStat[] = useMemo(() => [
    { k: 'Nodos',   v: String(deferredScene.render.diagnostics.nodeCount) },
    { k: 'Aristas', v: String(deferredScene.physics.diagnostics.edgeCount) },
    { k: 'Visibles', v: String(deferredScene.render.diagnostics.visibleEdgeCount) },
    {
      k: 'Física',
      v: physicsEnabled ? 'activa' : 'pausa',
      tone: physicsEnabled ? 'good' : 'warn',
    },
    {
      k: 'Relays',
      v: `${relayState.isGraphStale ? Math.max(0, relayState.urls.length - 1) : relayState.urls.length}/${relayState.urls.length}`,
      tone: relayState.isGraphStale ? 'warn' : 'good',
    },
    {
      k: 'FPS',
      v: avatarPerfSnapshot
        ? formatFpsFromFrameMs(avatarPerfSnapshot.emaFrameMs)
        : '—',
      tone: avatarPerfSnapshot && avatarPerfSnapshot.emaFrameMs > 20 ? 'warn' : 'default',
    },
  ], [
    avatarPerfSnapshot,
    deferredScene.physics.diagnostics.edgeCount,
    deferredScene.render.diagnostics.nodeCount,
    deferredScene.render.diagnostics.visibleEdgeCount,
    physicsEnabled,
    relayState.isGraphStale,
    relayState.urls.length,
  ])

  // Rail buttons — every entry is a DIRECT action or toggle.
  // Panel entries toggle themselves and replace each other; outside clicks stay inert.
  // Layer controls below remain direct toggles.
  const handleOpenRootSheet = useCallback(() => {
    setIsPersonSearchOpen(false)
    setIsSettingsOpen(false)
    setIsZapsPanelOpen(false)
    setIsNotificationsOpen(false)
    setIsRuntimeInspectorOpen(false)
    setMobileUtilityPanel(null)
    setIsRootSheetOpen(true)
  }, [])

  const handleFocusPersonSearch = useCallback(() => {
    if (!sceneState.rootPubkey) {
      setIsRootSheetOpen(true)
      return
    }
    setIsRootSheetOpen(false)
    setIsSettingsOpen(false)
    setIsZapsPanelOpen(false)
    setIsNotificationsOpen(false)
    setIsRuntimeInspectorOpen(false)
    setMobileUtilityPanel(null)
    setMobilePanelSnap('mid')
    setIsPersonSearchOpen(true)
  }, [sceneState.rootPubkey])

  const handleChangePersonSearch = useCallback((value: string) => {
    setPersonSearchQuery(value)
    if (!sceneState.rootPubkey) {
      return
    }
    setIsRootSheetOpen(false)
    setIsSettingsOpen(false)
    setIsZapsPanelOpen(false)
    setIsNotificationsOpen(false)
    setIsRuntimeInspectorOpen(false)
    setMobileUtilityPanel(null)
    setMobilePanelSnap('mid')
    setIsPersonSearchOpen(true)
  }, [sceneState.rootPubkey])

  const handleClearPersonSearch = useCallback(() => {
    setPersonSearchQuery('')
    personSearchInputRef.current?.focus()
  }, [])

  const handleSelectPersonSearchMatch = useCallback((pubkey: string) => {
    if (isFixtureMode) {
      updateFixtureState((current) => ({ ...current, selectedNodePubkey: pubkey }))
    } else {
      bridge.selectNode(pubkey)
    }
    setIsPersonSearchOpen(false)
    setMobilePanelSnap('peek')
  }, [bridge, isFixtureMode, updateFixtureState])

  const handleSubmitPersonSearch = useCallback(() => {
    if (!sceneState.rootPubkey) {
      setIsRootSheetOpen(true)
      return
    }
    const firstMatch = personSearchMatches[0]
    if (firstMatch) {
      handleSelectPersonSearchMatch(firstMatch.pubkey)
      return
    }
    setIsPersonSearchOpen(true)
  }, [handleSelectPersonSearchMatch, personSearchMatches, sceneState.rootPubkey])

  const handleOpenSettings = useCallback(() => {
    if (isSettingsOpen) {
      setIsSettingsOpen(false)
      clearSelectedNode()
      return
    }
    openSettingsTab(activeSettingsTab)
  }, [activeSettingsTab, clearSelectedNode, isSettingsOpen, openSettingsTab])

  const handleOpenNotifications = useCallback(() => {
    if (isNotificationsOpen) {
      setIsNotificationsOpen(false)
      clearSelectedNode()
      return
    }
    setIsPersonSearchOpen(false)
    setIsSettingsOpen(false)
    setIsZapsPanelOpen(false)
    setIsRuntimeInspectorOpen(false)
    setIsRootSheetOpen(false)
    setMobileUtilityPanel(null)
    setMobilePanelSnap('mid')
    setIsNotificationsOpen(true)
  }, [clearSelectedNode, isNotificationsOpen])

  const handleOpenZapsPanel = useCallback(() => {
    if (isZapsPanelOpen) {
      setIsZapsPanelOpen(false)
      clearSelectedNode()
      return
    }
    setIsPersonSearchOpen(false)
    setIsSettingsOpen(false)
    setIsNotificationsOpen(false)
    setIsRuntimeInspectorOpen(false)
    setIsRootSheetOpen(false)
    setMobileUtilityPanel(null)
    setMobilePanelSnap('mid')
    setIsZapsPanelOpen(true)
  }, [clearSelectedNode, isZapsPanelOpen])

  const handleOpenRuntimeInspector = useCallback(() => {
    if (!canUseRuntimeInspector) {
      return
    }
    if (isRuntimeInspectorOpen) {
      setIsRuntimeInspectorOpen(false)
      clearSelectedNode()
      return
    }
    setIsPersonSearchOpen(false)
    setIsSettingsOpen(false)
    setIsZapsPanelOpen(false)
    setIsNotificationsOpen(false)
    setIsRootSheetOpen(false)
    setMobileUtilityPanel(null)
    setIsRuntimeInspectorOpen(true)
  }, [canUseRuntimeInspector, clearSelectedNode, isRuntimeInspectorOpen])

  const handleOpenMobileUtilityPanel = useCallback((
    panel: Exclude<MobileUtilityPanel, null>,
    snap: SigmaPanelSnap = 'mid',
  ) => {
    if (mobileUtilityPanel === panel) {
      setMobileUtilityPanel(null)
      return
    }

    setIsRootSheetOpen(false)
    setIsPersonSearchOpen(false)
    setIsSettingsOpen(false)
    setIsZapsPanelOpen(false)
    setIsNotificationsOpen(false)
    setIsRuntimeInspectorOpen(false)
    setMobilePanelSnap(snap)
    setMobileUtilityPanel(panel)
  }, [mobileUtilityPanel])

  const handleTogglePhysics = useCallback(() => {
    setPhysicsEnabled((current) => {
      const next = !current
      setActionFeedback(next ? 'Fisica reanudada.' : 'Fisica en pausa.')
      return next
    })
  }, [])

  const handleToggleAvatarPhotos = useCallback(() => {
    setAvatarPhotosEnabled((current) => {
      const next = !current
      setActionFeedback(
        next
          ? 'Fotos de avatares activadas.'
          : 'Fotos de avatares desactivadas para ahorrar rendimiento.',
      )
      return next
    })
  }, [])

  const handleToggleZaps = useCallback(() => {
    setShowZaps((current) => {
      const next = !current
      setActionFeedback(next ? 'Zaps visibles.' : 'Zaps ocultos.')
      return next
    })
  }, [])

  const handleFitView = useCallback(() => {
    closeCompetingSidePanels()
    setMobilePanelSnap('mid')
    if (detail.node !== null && !isIdentityHelpDismissed) {
      dismissIdentityHelp()
    }
    clearSelectedNode()
    sigmaHostRef.current?.fitCameraToGraph()
  }, [
    clearSelectedNode,
    closeCompetingSidePanels,
    detail.node,
    dismissIdentityHelp,
    isIdentityHelpDismissed,
  ])

  const handleStaleRelays = useCallback(() => {
    if (!relayState.isGraphStale) {
      setActionFeedback('Relays al dia: no hay override para revertir.')
      return
    }
    void handleRevertRelays()
  }, [handleRevertRelays, relayState.isGraphStale])

  const handleCopyNpub = useCallback((npub: string) => {
    void copyToClipboard(npub)
      .then(() => setActionFeedback('npub copiado.'))
      .catch(() => setActionFeedback('No se pudo copiar el npub.'))
  }, [])

  const handleDownloadAvatarRuntimeDebug = useCallback(() => {
    if (!isAvatarRuntimeDebugDownloadEnabled()) {
      setActionFeedback('El debug runtime de avatares sólo se descarga en dev.')
      return
    }

    const host = sigmaHostRef.current
    if (!host) {
      setActionFeedback('El grafo todavía no está listo para debug de avatares.')
      return
    }

    const state = host.getAvatarRuntimeDebugSnapshot({ includeOverlayNodes: true })
    if (!state) {
      setActionFeedback('No hay snapshot runtime de avatares disponible todavía.')
      return
    }

    const generatedAt = new Date().toISOString()
    const stamp = generatedAt.replace(/[:.]/g, '-')
    const debugFileName = buildAvatarRuntimeDebugFilename(stamp)
    const viewportPubkeys = host.getVisibleNodePubkeys()
    const scenePubkeys = deferredScene.render.nodes.map((node) => node.pubkey)
    const profileWarmup = buildVisibleProfileWarmupDebugSnapshot({
      viewportPubkeys,
      scenePubkeys,
      nodesByPubkey: sceneState.nodesByPubkey,
      attemptedAtByPubkey: visibleProfileWarmupAttemptedAtRef.current,
      inflightPubkeys: visibleProfileWarmupInflightRef.current,
      now: Date.now(),
      batchSize: VISIBLE_PROFILE_WARMUP_BATCH_SIZE,
      cooldownMs: VISIBLE_PROFILE_WARMUP_COOLDOWN_MS,
    })
    visibleProfileWarmupDebugRef.current = profileWarmup
    const payload = buildAvatarRuntimeDebugPayload({
      generatedAt,
      debugFileName,
      state,
      profileWarmup,
      browser: readAvatarRuntimeDebugBrowserSnapshot(),
      location: readAvatarRuntimeDebugLocationSnapshot(),
    })

    downloadBlob(
      new Blob([JSON.stringify(payload, null, 2)], {
        type: 'application/json',
      }),
      debugFileName,
    )

    const visibleNodes = payload.counts.visibleNodes ?? 0
    const withPicture = payload.counts.nodesWithPictureUrl ?? 0
    const drawnImages = payload.counts.drawnImages ?? 0
    const loadCandidates = payload.counts.loadCandidates ?? 0
    setActionFeedback(
      `Debug de avatares descargado. ${drawnImages}/${withPicture} fotos dibujadas; ${loadCandidates}/${visibleNodes} nodos visibles en cola útil.`,
    )
  }, [deferredScene.render.nodes, sceneState.nodesByPubkey])

  const railButtons: RailButton[] = useMemo(() => [
    {
      id: 'settings',
      tip: isSettingsOpen ? 'Cerrar ajustes' : 'Ajustes',
      icon: <GearIcon />,
      active: isSettingsOpen,
      onClick: handleOpenSettings,
    },
    {
      id: 'notifications',
      tip: isNotificationsOpen
        ? 'Cerrar notificaciones'
        : `Notificaciones (${notificationHistory.length})`,
      icon: <BellIcon />,
      active: isNotificationsOpen,
      badge: notificationHistory.length,
      onClick: handleOpenNotifications,
    },
    ...(canUseRuntimeInspector
      ? [{
          id: 'runtime',
          tip: isRuntimeInspectorOpen
            ? 'Cerrar inspector de runtime'
            : 'Inspector de runtime (Shift + D)',
          icon: <PulseIcon />,
          active: isRuntimeInspectorOpen,
          onClick: handleOpenRuntimeInspector,
        } satisfies RailButton]
      : []),
    {
      id: 'physics',
      tip: physicsEnabled ? 'Pausar física' : 'Reanudar física',
      icon: <AtomIcon />,
      active: physicsEnabled,
      pressed: physicsEnabled,
      onClick: handleTogglePhysics,
    },
    {
      id: 'zaps',
      tip: isZapsPanelOpen ? 'Cerrar panel de zaps' : 'Zaps',
      icon: <ZapIcon />,
      active: isZapsPanelOpen,
      onClick: handleOpenZapsPanel,
      dividerAfter: true,
    },
    {
      id: 'recenter',
      tip: 'Ajustar vista',
      icon: <TargetIcon />,
      onClick: handleFitView,
    },
    {
      id: 'stale',
      tip: relayState.isGraphStale ? 'Revertir relays' : 'Relays al dia',
      icon: <ClockIcon />,
      active: relayState.isGraphStale,
      onClick: handleStaleRelays,
      dividerAfter: true,
    },
  ], [
    canUseRuntimeInspector,
    handleOpenZapsPanel,
    handleOpenNotifications,
    handleOpenRuntimeInspector,
    handleOpenSettings,
    handleFitView,
    handleStaleRelays,
    handleTogglePhysics,
    isNotificationsOpen,
    isRuntimeInspectorOpen,
    isSettingsOpen,
    isZapsPanelOpen,
    notificationHistory.length,
    physicsEnabled,
    relayState.isGraphStale,
  ])

  const mobileNavButtons: MobileNavButton[] = useMemo(() => [
    {
      id: 'filters',
      label: 'Filtros',
      tip: mobileUtilityPanel === 'filters'
        ? 'Cerrar filtros de conexiones'
        : 'Filtros de conexiones',
      icon: <FilterIcon />,
      active: mobileUtilityPanel === 'filters',
      onClick: () => handleOpenMobileUtilityPanel('filters', 'mid'),
    },
    {
      id: 'zaps',
      label: 'Zaps',
      tip: isZapsPanelOpen ? 'Cerrar zaps' : 'Zaps en vivo',
      icon: <ZapIcon />,
      active: isZapsPanelOpen,
      badge: zapActivityLog.length,
      onClick: handleOpenZapsPanel,
    },
    ...(canUseRuntimeInspector
      ? [{
          id: 'runtime',
          label: 'Runtime',
          tip: isRuntimeInspectorOpen
            ? 'Cerrar inspector de runtime'
            : 'Inspector de runtime',
          icon: <PulseIcon />,
          active: isRuntimeInspectorOpen,
          onClick: handleOpenRuntimeInspector,
        } satisfies MobileNavButton]
      : []),
    {
      id: 'view',
      label: 'Vista',
      tip: 'Ajustar vista',
      icon: <TargetIcon />,
      onClick: handleFitView,
    },
    {
      id: 'settings',
      label: 'Ajustes',
      tip: isSettingsOpen ? 'Cerrar ajustes' : 'Ajustes',
      icon: <GearIcon />,
      active: isSettingsOpen,
      onClick: handleOpenSettings,
    },
  ], [
    canUseRuntimeInspector,
    handleOpenMobileUtilityPanel,
    handleOpenRuntimeInspector,
    handleOpenZapsPanel,
    handleOpenSettings,
    isSettingsOpen,
    isRuntimeInspectorOpen,
    isZapsPanelOpen,
    mobileUtilityPanel,
    handleFitView,
    zapActivityLog.length,
  ])

  // Toasts — combine feedback sources
  const toastEntries: SigmaToast[] = useMemo(() => {
    const entries: SigmaToast[] = []
    if (actionFeedback) entries.push({ id: 'action', msg: actionFeedback, tone: 'default' })
    if (zapFeedback)    entries.push({ id: 'zap', msg: zapFeedback, tone: 'zap' })
    return entries
  }, [actionFeedback, zapFeedback])

  const handleToastDismiss = useCallback((id: SigmaToast['id']) => {
    if (id === 'action') setActionFeedback(null)
    if (id === 'zap') setZapFeedback(null)
  }, [])

  const handleDeleteNotification = useCallback((id: string) => {
    const entry = notificationHistory.find((item) => item.id === id)
    setNotificationHistory((current) => current.filter((item) => item.id !== id))
    if (!entry) return
    if (entry.source === 'action') {
      setActionFeedback((current) => (current === entry.msg ? null : current))
      return
    }
    setZapFeedback((current) => (current === entry.msg ? null : current))
  }, [notificationHistory])

  const handleClearNotifications = useCallback(() => {
    setNotificationHistory([])
    setActionFeedback(null)
    setZapFeedback(null)
  }, [])

  const handleClearSiteCache = useCallback(async () => {
    if (cacheClearStatus === 'running') {
      return
    }

    const confirmed = window.confirm(
      'Borrar todo el cache local de esta pagina? Se limpiaran IndexedDB, Cache Storage, localStorage y sessionStorage, y la pagina se recargara.',
    )

    if (!confirmed) {
      return
    }

    setCacheClearStatus('running')
    setCacheClearMessage('Borrando datos locales...')

    try {
      const summary = await clearSiteCache()
      const browserSiteDataCleared = await requestBrowserSiteDataClear()
      setCacheClearMessage(
        browserSiteDataCleared
          ? `Datos del sitio borrados: ${summary.indexedDbDatabases} IndexedDB, ${summary.indexedDbStores} stores, ${summary.cacheStorageCaches} caches. Recargando...`
          : `Cache local borrado: ${summary.indexedDbDatabases} IndexedDB, ${summary.indexedDbStores} stores, ${summary.cacheStorageCaches} caches. Recargando...`,
      )

      window.setTimeout(() => {
        window.location.reload()
      }, 650)
    } catch (error) {
      const nextMessage =
        error instanceof Error
          ? error.message
          : 'No se pudo borrar el cache local.'
      setCacheClearStatus('failed')
      setCacheClearMessage(nextMessage)
      window.alert(nextMessage)
    }
  }, [cacheClearStatus])

  // Minimap viewport info
  const viewportRatio = isFixtureMode
    ? lastViewportRatio
    : controller.getLastViewport()?.ratio ?? null

  const getMinimapSnapshot = useCallback(
    () => sigmaHostRef.current?.getMinimapSnapshot() ?? null,
    [],
  )
  const getMinimapViewport = useCallback(
    () => sigmaHostRef.current?.getMinimapViewport() ?? null,
    [],
  )
  const handleMinimapFit = useCallback(() => {
    sigmaHostRef.current?.fitCameraToGraph()
  }, [])
  const handleMinimapZoomIn = useCallback(() => {
    sigmaHostRef.current?.zoomIn()
  }, [])
  const handleMinimapZoomOut = useCallback(() => {
    sigmaHostRef.current?.zoomOut()
  }, [])
  const handleMinimapPan = useCallback(
    (x: number, y: number, opts?: { animate?: boolean }) => {
      sigmaHostRef.current?.panCameraToGraph(x, y, opts)
    },
    [],
  )
  const subscribeToMinimapTicks = useCallback(
    (listener: () => void) =>
      sigmaHostRef.current?.subscribeToRenderTicks(listener) ?? (() => {}),
    [],
  )
  const subscribeToMinimapCameraTicks = useCallback(
    (listener: () => void) =>
      sigmaHostRef.current?.subscribeToCameraTicks(listener) ?? (() => {}),
    [],
  )

  // ── Settings panel content ─────────────────────────────────────────────────

  const renderSettingsContent = () => {
    switch (activeSettingsTab) {
      case 'performance':
        return (
          <PerformanceOptionsPanel
            avatarPhotosEnabled={avatarPhotosEnabled}
            avatarRuntimeOptions={avatarRuntimeOptions}
            capReached={runtimeInspectorStoreSnapshot.capReached}
            cacheClearMessage={cacheClearMessage}
            devicePerformanceProfile={
              runtimeInspectorStoreSnapshot.devicePerformanceProfile
            }
            hideConnectionsOnLowPerformance={hideConnectionsOnLowPerformance}
            isClearingSiteCache={cacheClearStatus === 'running'}
            isRuntimeInspectorButtonLocked={isDev}
            lowPerformanceConnectionStatusLabel={lowPerformanceConnectionStatusLabel}
            maxNodes={runtimeInspectorStoreSnapshot.maxNodes}
            nodeCount={runtimeInspectorStoreSnapshot.nodeCount}
            onAvatarRuntimeOptionsChange={setAvatarRuntimeOptions}
            onClearSiteCache={handleClearSiteCache}
            onGraphMaxNodesChange={setGraphMaxNodes}
            onToggleRuntimeInspectorButton={() => {
              setRuntimeInspectorButtonEnabled((current) => !current)
            }}
            onToggleAvatarPhotos={handleToggleAvatarPhotos}
            onToggleHideConnectionsOnLowPerformance={() => {
              setHideConnectionsOnLowPerformance((current) => !current)
            }}
            recommendedMaxNodes={
              runtimeInspectorStoreSnapshot.effectiveGraphCaps.maxNodes
            }
            runtimeInspectorButtonVisible={canUseRuntimeInspector}
          />
        )
      case 'visuals':
        return (
          <div>
            <VisualOptionsPanel
              avatarRuntimeOptions={avatarRuntimeOptions}
              onAvatarRuntimeOptionsChange={setAvatarRuntimeOptions}
              onToggleVisibleEdgeCountLabels={() => {
                setShowVisibleEdgeCountLabels((current) => !current)
              }}
              showVisibleEdgeCountLabels={showVisibleEdgeCountLabels}
            />
            {renderZapSettingsContent()}
          </div>
        )
      case 'relays':
        return (
          <div>
            <RelayEditor
              isGraphStale={relayState.isGraphStale}
              onApply={handleApplyRelays}
              onRevert={handleRevertRelays}
              relayUrls={relayState.urls}
            />
            <div className="sg-settings-section">
              <h4>Estado de relays</h4>
              <div className="sg-setting-row">
                <div>
                  <div className="sg-setting-row__lbl">
                    {relayState.isGraphStale ? 'Relays personalizados' : 'Relays base'}
                  </div>
                  <div className="sg-setting-row__desc">
                    {relayState.isGraphStale
                      ? 'La sesion esta usando una lista personalizada.'
                      : 'La sesion usa la configuracion base del explorador.'}
                  </div>
                </div>
                {relayState.isGraphStale ? (
                  <button
                    className="sg-mini-action"
                    onClick={handleStaleRelays}
                    type="button"
                  >
                    Revertir
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        )
      case 'dev':
        return (
          <div>
            {isDev ? (
              <div className="sg-settings-section">
                <h4>ForceAtlas dev</h4>
                <div className="sg-setting-row">
                  <div>
                    <div className="sg-setting-row__lbl">Auto-freeze</div>
                    <p style={{ fontSize: 10.5, color: 'var(--sg-fg-faint)', margin: '2px 0 0' }}>
                      Cuando esta apagado, el supervisor ignora convergencia y max iterations.
                    </p>
                  </div>
                  <input
                    checked={devPhysicsAutoFreezeEnabled}
                    onChange={(event) => {
                      setDevPhysicsAutoFreezeEnabled(event.target.checked)
                    }}
                    type="checkbox"
                  />
                </div>
              </div>
            ) : null}
            <AdvancedAvatarOptionsPanel
              avatarPerfSnapshot={avatarPerfSnapshot}
              avatarRuntimeOptions={avatarRuntimeOptions}
              onAvatarRuntimeOptionsChange={setAvatarRuntimeOptions}
            />
            <PhysicsTuningPanel
              onChange={updatePhysicsTuning}
              onReset={() => setPhysicsTuning(createDefaultPhysicsTuningForViewport())}
              tuning={physicsTuning}
            />
            {isDragFixtureLab ? (
              <DragTuningPanel
                onChange={updateDragInfluenceTuning}
                onReset={() => setDragInfluenceTuning(DEFAULT_DRAG_NEIGHBORHOOD_INFLUENCE_TUNING)}
                tuning={dragInfluenceTuning}
              />
            ) : null}
            <div className="sg-settings-section">
              <h4>Diagnóstico runtime</h4>
              {[
                ['Topología render', String(deferredScene.render.diagnostics.topologySignature)],
                ['Topología física', String(deferredScene.physics.diagnostics.topologySignature)],
                ['Relays',       String(relayState.urls.length)],
                ['Pinned',       String(sceneState.pinnedNodePubkeys.size)],
                ['Viewport',     isFixtureMode
                  ? (lastViewportRatio ? `${lastViewportRatio.toFixed(2)}×` : 'idle')
                  : (controller.getLastViewport() ? `${controller.getLastViewport()?.ratio.toFixed(2)}×` : 'idle')],
                ['Capa activa',  sceneState.activeLayer],
                ['Root',         sceneState.rootPubkey ? 'cargado' : 'vacío'],
              ].map(([k, v]) => (
                <div className="sg-diag-row" key={k as string}>
                  <span className="sg-diag-row__k">{k}</span>
                  <span className="sg-diag-row__v">{v}</span>
                </div>
              ))}
            </div>
            {isDev ? (
              <div className="sg-settings-section">
                <h4>Debug de avatares</h4>
                <p style={{ fontSize: 10.5, color: 'var(--sg-fg-faint)', margin: '0 0 10px' }}>
                  Descarga el frame visible, la caché, los bloqueos y los eventos recientes del scheduler.
                </p>
                <button
                  className="sg-btn sg-btn--primary"
                  onClick={handleDownloadAvatarRuntimeDebug}
                  style={{ width: '100%' }}
                  type="button"
                >
                  Descargar debug de avatares
                </button>
              </div>
            ) : null}
            {isDev ? (
              <div className="sg-settings-section">
                <h4>Zaps dev</h4>
                <div className="sg-setting-row">
                  <div>
                    <div className="sg-setting-row__lbl">Pausar live en escenas grandes</div>
                    <div className="sg-setting-row__desc">
                      Limita filtros de relay cuando hay mas de {MAX_ZAP_FILTER_PUBKEYS} nodos visibles.
                    </div>
                  </div>
                  <button
                    aria-pressed={pauseLiveZapsWhenSceneIsLarge}
                    className={`sg-toggle${pauseLiveZapsWhenSceneIsLarge ? ' sg-toggle--on' : ''}`}
                    onClick={() => {
                      setPauseLiveZapsWhenSceneIsLarge((current) => !current)
                    }}
                    title={
                      pauseLiveZapsWhenSceneIsLarge
                        ? 'Desactivar limite de zaps live'
                        : 'Activar pausa de zaps live en escenas grandes'
                    }
                    type="button"
                  />
                </div>
                <button
                  className={`sg-btn${!simulationPair ? ' ' : ' sg-btn--primary'}`}
                  disabled={!simulationPair}
                  onClick={handleSimulateZap}
                  style={{ width: '100%' }}
                  type="button"
                >
                  {simulationPair ? 'Simular zap' : 'Sin pares conectados'}
                </button>
                {zapFeedback ? (
                  <p style={{ marginTop: 8, fontSize: 11, color: 'var(--sg-fg-muted)' }}>{zapFeedback}</p>
                ) : null}
              </div>
            ) : null}
          </div>
        )
    }
  }

  // ── Detail panel content ───────────────────────────────────────────────────

  const renderZapSettingsContent = () => (
    <div>
      <div className="sg-settings-section">
        <h4>Visualizacion</h4>
        <div className="sg-setting-row">
          <div>
            <div className="sg-setting-row__lbl">Mostrar zaps en el grafo</div>
            <div className="sg-setting-row__desc">
              Controla si las conexiones y animaciones de zaps se dibujan sobre la escena.
            </div>
          </div>
          <button
            aria-pressed={showZaps}
            className={`sg-toggle${showZaps ? ' sg-toggle--on' : ''}`}
            onClick={handleToggleZaps}
            title={showZaps ? 'Ocultar zaps' : 'Mostrar zaps'}
            type="button"
          />
        </div>
      </div>

      <div className="sg-settings-section">
        <h4>Fuente</h4>
        <div className="sg-setting-block">
          <div>
            <div className="sg-setting-row__lbl">Modo</div>
            <div className="sg-setting-row__desc">
              Live escucha eventos nuevos; ultima hora consulta y reproduce recibos recientes.
            </div>
          </div>
          <div className="sg-segmented-control" role="group" aria-label="Modo de zaps">
            <button
              aria-pressed={zapFeedMode === 'live'}
              className={`sg-segmented-control__btn${zapFeedMode === 'live' ? ' sg-segmented-control__btn--active' : ''}`}
              onClick={() => setZapFeedMode('live')}
              type="button"
            >
              Live
            </button>
            <button
              aria-pressed={zapFeedMode === 'recent-hour'}
              className={`sg-segmented-control__btn${zapFeedMode === 'recent-hour' ? ' sg-segmented-control__btn--active' : ''}`}
              onClick={() => setZapFeedMode('recent-hour')}
              type="button"
            >
              Ultima hora
            </button>
          </div>
        </div>
        {zapFeedMode === 'recent-hour' ? (
          <div className="sg-setting-block">
            <div className="sg-setting-row__desc">
              {recentZapReplay.message ??
                'Reproduce los zaps de la ultima hora para los nodos visibles.'}
              {recentZapReplay.truncatedTargetCount > 0
                ? ` Se omitieron ${formatInteger(recentZapReplay.truncatedTargetCount)} nodos por limite operativo.`
                : ''}
            </div>
            <div className="sg-zap-replay-progress" aria-label="Progreso de zaps de la ultima hora">
              {recentZapReplayStages.map((stage) => {
                const progressValue = formatProgressValue(stage.value)
                return (
                  <div
                    className={`sg-zap-replay-stage sg-zap-replay-stage--${stage.status}`}
                    key={stage.id}
                  >
                    <div className="sg-zap-replay-stage__head">
                      <span>{stage.label}</span>
                      <span>{progressValue}%</span>
                    </div>
                    <div
                      aria-label={stage.label}
                      aria-valuemax={100}
                      aria-valuemin={0}
                      aria-valuenow={progressValue}
                      className="sg-zap-replay-bar"
                      role="progressbar"
                    >
                      <span
                        className="sg-zap-replay-bar__fill"
                        style={{ width: `${progressValue}%` }}
                      />
                    </div>
                    <div className="sg-zap-replay-stage__detail">
                      {stage.detail}
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="sg-zap-replay-timeline">
              <div className="sg-zap-replay-timeline__head">
                <span>Momento mostrado</span>
                <span>{formatZapReplayTime(recentZapReplay.currentZapCreatedAt)}</span>
              </div>
              <div
                aria-label="Avance dentro de la ultima hora"
                aria-valuemax={100}
                aria-valuemin={0}
                aria-valuenow={formatProgressValue(recentZapReplay.timelineProgress)}
                className="sg-zap-replay-timeline__rail"
                role="progressbar"
              >
                <span
                  className="sg-zap-replay-timeline__fill"
                  style={{
                    width: formatProgressPercent(recentZapReplay.timelineProgress),
                  }}
                />
                <span
                  className="sg-zap-replay-timeline__marker"
                  style={{
                    left: formatProgressPercent(recentZapReplay.timelineProgress),
                  }}
                />
              </div>
              <div className="sg-zap-replay-timeline__labels">
                <span>{formatZapReplayTime(recentZapReplay.windowStartAt)}</span>
                <span>{formatZapReplayTime(recentZapReplay.windowEndAt)}</span>
              </div>
            </div>
            <div className="sg-zap-replay-actions">
              <button
                className="sg-mini-action"
                disabled={
                  recentZapReplay.phase === 'loading' ||
                  recentZapReplay.phase === 'playing'
                }
                onClick={() => setRecentZapReplayRequest((current) => current + 1)}
                type="button"
              >
                Reproducir cache
              </button>
              <button
                className="sg-mini-action"
                disabled={
                  recentZapReplay.phase === 'loading' ||
                  recentZapReplay.phase === 'playing'
                }
                onClick={() => {
                  setRecentZapReplayRefreshRequest((current) => current + 1)
                }}
                type="button"
              >
                Actualizar
              </button>
            </div>
          </div>
        ) : null}
      </div>

    </div>
  )

  const getZapActorLabel = (pubkey: string) => {
    const node = sceneState.nodesByPubkey[pubkey]
    const label = node?.label?.trim()
    return label || `${pubkey.slice(0, 8)}...`
  }

  const zapFeedStatus = shouldEnableLiveZapFeed
    ? 'Live'
    : zapFeedMode === 'recent-hour'
      ? 'Ultima hora'
      : 'Pausado'

  const renderZapsContent = () => (
    <div className="sg-zap-feed">
      <div className="sg-zap-feed__head">
        <div className="sg-zap-feed__summary">
          <span className="sg-section-label">Zaps visibles</span>
          <strong>{zapActivityLog.length} zap{zapActivityLog.length === 1 ? '' : 's'}</strong>
        </div>
        <span
          className={`sg-zap-feed__status${shouldEnableLiveZapFeed ? ' sg-zap-feed__status--live' : ''}`}
        >
          {zapFeedStatus}
        </span>
      </div>

      {liveZapFeedFeedback ? (
        <p className="sg-zap-feed__feedback">{liveZapFeedFeedback}</p>
      ) : null}

      {zapActivityLog.length > 0 ? (
        <div className="sg-zap-feed__list">
          {zapActivityLog.map((entry) => (
            <article
              className={`sg-zap-feed__item${entry.played ? '' : ' sg-zap-feed__item--dropped'}`}
              key={entry.id}
            >
              <div className="sg-zap-feed__meta">
                <span>{ZAP_ACTIVITY_SOURCE_LABELS[entry.source]}</span>
                <time dateTime={new Date(entry.createdAt).toISOString()}>
                  {NOTIFICATION_TIME_FORMATTER.format(entry.createdAt)}
                </time>
              </div>
              <div className="sg-zap-feed__amount">
                {formatInteger(entry.sats)} sats
              </div>
              <p>
                <span>{getZapActorLabel(entry.fromPubkey)}</span>
                <span aria-hidden="true">{'->'}</span>
                <span>{getZapActorLabel(entry.toPubkey)}</span>
              </p>
              <span className="sg-zap-feed__result">
                {entry.played ? 'Mostrado en el grafo' : 'Fuera de la vista actual'}
              </span>
            </article>
          ))}
        </div>
      ) : (
        <p className="sg-zap-feed__empty">
          Todavia no hay zaps visibles en esta sesion.
        </p>
      )}
    </div>
  )

  const renderNotificationsContent = () => (
    <div className="sg-notifications">
      <div className="sg-notifications__head">
        <div className="sg-notifications__summary">
          <span className="sg-section-label">Historial de sesion</span>
          <strong>{notificationHistory.length} notificacion{notificationHistory.length === 1 ? '' : 'es'}</strong>
        </div>
        {notificationHistory.length > 0 ? (
          <button
            className="sg-mini-action sg-mini-action--danger"
            onClick={handleClearNotifications}
            type="button"
          >
            Borrar todo
          </button>
        ) : null}
      </div>
      {notificationHistory.length > 0 ? (
        <div className="sg-notifications__list">
          {notificationHistory.map((entry) => (
            <article
              className={`sg-notification sg-notification--${entry.tone}`}
              key={entry.id}
            >
              <div className="sg-notification__content">
                <div className="sg-notification__meta">
                  <span>{entry.source === 'zap' ? 'Zap' : 'Sistema'}</span>
                  <time dateTime={new Date(entry.createdAt).toISOString()}>
                    {NOTIFICATION_TIME_FORMATTER.format(entry.createdAt)}
                  </time>
                </div>
                <p>{entry.msg}</p>
              </div>
              <button
                aria-label="Borrar notificacion"
                className="sg-notification__delete"
                onClick={() => handleDeleteNotification(entry.id)}
                title="Borrar"
                type="button"
              >
                <CloseIcon />
              </button>
            </article>
          ))}
        </div>
      ) : (
        <p className="sg-notifications__empty">
          Todavia no hay notificaciones en esta sesion.
        </p>
      )}
    </div>
  )

  const renderFilterContent = () => (
    <div className="sg-mobile-filter-panel">
      <div className="sg-mobile-panel-intro">
        <span className="sg-section-label">Filtro de conexiones</span>
        <p>
          Elegi que relaciones queres ver en el grafo. Esto cambia la proyeccion visible,
          no los datos cargados ni la evidencia exportable.
        </p>
      </div>
      <div className="sg-mobile-filter-list">
        {filterPills.map((pill) => (
          <button
            aria-pressed={pill.id === filterActiveId}
            className={`sg-mobile-filter-option${pill.id === filterActiveId ? ' sg-mobile-filter-option--active' : ''}`}
            key={pill.id}
            onClick={() => {
              handleFilterSelect(pill.id)
              setMobilePanelSnap('peek')
            }}
            type="button"
          >
            <span
              className="sg-mobile-filter-option__swatch"
              style={{ background: pill.swatch }}
            />
            <span className="sg-mobile-filter-option__body">
              <strong>{pill.label}</strong>
              <span>{pill.hint}</span>
            </span>
            <span className="sg-mobile-filter-option__count">
              {pill.caption ?? pill.count ?? '-'}
            </span>
          </button>
        ))}
      </div>
    </div>
  )

  const renderDetailContent = () => {
    if (!detail.node) return null

    const isRootNode = detail.pubkey === sceneState.rootPubkey
    const relBadge = isRootNode ? 'IDENTIDAD RAÍZ' :
      (detail.mutualCount > 0) ? 'MUTUO' :
      detail.followingCount > 0 ? 'LO SIGO' :
      detail.followerCount > 0 ? 'ME SIGUE' : 'SIN RECIPROCIDAD'

    const relBadgeClass = isRootNode ? 'sg-badge--accent' :
      (detail.mutualCount > 0) ? 'sg-badge--ok' :
      detail.followingCount > 0 ? 'sg-badge--accent' :
      detail.followerCount > 0 ? '' : 'sg-badge--warn'

    const detailNpub = encodePubkeyAsNpub(detail.pubkey)
    const primalProfileUrl = detailNpub ? `https://primal.net/p/${detailNpub}` : null
    const jumbleProfileUrl = detailNpub ? `https://jumble.social/users/${detailNpub}` : null
    const pinActionLabel = detail.isPinned ? 'Desanclar perfil' : 'Anclar perfil'
    const expansionState = detail.node.nodeExpansionState
    const isExpansionLoading = expansionState?.status === 'loading'
    const exploreActionLabel = detail.isExpanded
      ? 'Conexiones exploradas'
      : isExpansionLoading
        ? 'Expandiendo...'
        : 'Explorar conexiones'
    const expansionStatusLabel = expansionState
      ? NODE_EXPANSION_STATUS_LABELS[expansionState.status]
      : NODE_EXPANSION_STATUS_LABELS.idle
    const expansionMessage = expansionState?.message?.trim() || null
    const expansionVisibilityHint = buildExpansionVisibilityHint({
      activeLayer: sceneState.activeLayer,
      totalGraphNodeCount: runtimeInspectorStoreSnapshot.nodeCount,
      visibleNodeCount: deferredScene.render.diagnostics.nodeCount,
      maxGraphNodes: runtimeInspectorStoreSnapshot.maxNodes,
      capReached: runtimeInspectorStoreSnapshot.capReached,
      expansionMessage,
    })
    const shouldShowIdentityHelp = !isIdentityHelpDismissed
    const isProfileLoading = detail.node.profileState === 'loading'
    const hasProfileName = Boolean(detail.node.label?.trim())
    const detailTitle = hasProfileName
      ? detail.displayName
      : isProfileLoading
        ? 'Cargando perfil...'
        : detail.displayName
    const bioCopy = detail.about?.trim()
      ? detail.about.trim()
      : isProfileLoading
        ? 'Cargando perfil desde relays y cache...'
        : 'Sin bio conocida.'

    return (
      <div>
        <div className="sg-node-hero" data-panel-drag-handle>
          <div className="sg-node-hero__avatar-wrap">
            <div className="sg-node-hero__avatar">
              {detail.pictureUrl ? (
                <img alt="" src={detail.pictureUrl} />
              ) : (
                <AvatarFallback
                  initials={getInitials(detail.displayName)}
                  labelClassName=""
                  seed={detail.pubkey}
                />
              )}
            </div>
            {detail.isPinned && (
              <div className="sg-node-hero__pin">◆</div>
            )}
          </div>
          <div className="sg-node-hero__content">
            <div className="sg-node-hero__title-row">
              <h2>{detailTitle ?? '—'}</h2>
            </div>
            <div className="sg-node-hero__handle">{detail.pubkey?.slice(0, 12)}…</div>
            <div className="sg-node-hero__badges">
              <span className={`sg-badge ${relBadgeClass}`}>{relBadge}</span>
              {detail.nip05 && <span className="sg-badge sg-badge--ok">nip05</span>}
              {detail.isExpanded && <span className="sg-badge">conexiones exploradas</span>}
            </div>
          </div>
        </div>

        <div className="sg-node-primary-actions" data-panel-no-drag>
          <button
            className={`sg-node-primary-action${detail.isExpanded || isExpansionLoading ? '' : ' sg-node-primary-action--primary'}`}
            disabled={detail.isExpanded || isExpansionLoading}
            onClick={() => {
              if (!detail.pubkey) return
              handleExploreConnections(detail.pubkey, detail.isExpanded)
            }}
            type="button"
          >
            <span>{exploreActionLabel}</span>
          </button>
          {detail.pubkey ? (
            <button
              aria-label={pinActionLabel}
              aria-pressed={detail.isPinned}
              className={`sg-node-primary-action sg-node-primary-action--pin${detail.isPinned ? ' sg-node-primary-action--active' : ''}`}
              onClick={() => {
                if (!detail.pubkey) return
                handleToggleDetailPin(detail.pubkey)
              }}
              title={pinActionLabel}
              type="button"
            >
              <PinIcon />
              <span>{detail.isPinned ? 'Anclado' : 'Anclar'}</span>
            </button>
          ) : null}
        </div>

        {shouldShowIdentityHelp ? (
          <div className="sg-identity-help">
            <p>Abriste una identidad. Explorá sus conexiones o anclala para compararla.</p>
            <button
              className="sg-btn"
              onClick={dismissIdentityHelp}
              type="button"
            >
              Entendido
            </button>
          </div>
        ) : null}

        <p className={`sg-bio${detail.about?.trim() ? '' : ' sg-bio--empty'}`}>
          {bioCopy}
        </p>

        <div className="sg-metric-grid">
          <div className="sg-metric">
            <div className="sg-metric__k">Sigo</div>
            <div className="sg-metric__v">{detail.followingCount}</div>
          </div>
          <div className="sg-metric">
            <div className="sg-metric__k">Me siguen</div>
            <div className="sg-metric__v">{detail.followerCount}</div>
          </div>
          <div className="sg-metric">
            <div className="sg-metric__k">Mutuos</div>
            <div className="sg-metric__v">{detail.mutualCount}</div>
          </div>
        </div>

        {detail.pubkey && (
          <div className="sg-key-row">
            <span className="sg-key-row__lbl">pubkey</span>
            <span>{detail.pubkey.slice(0, 12)}…{detail.pubkey.slice(-8)}</span>
          </div>
        )}

        <div className="sg-section-label">Identidad</div>
        <div className="sg-npub-row">
          <div className="sg-npub-row__body">
            <span className="sg-npub-row__label">npub</span>
            <code className={`sg-npub-row__value${detailNpub ? '' : ' sg-npub-row__value--missing'}`}>
              {detailNpub ?? 'No disponible'}
            </code>
          </div>
          <div className="sg-npub-row__actions">
            <button
              className="sg-mini-action"
              disabled={!detailNpub}
              onClick={() => {
                if (!detailNpub) return
                handleCopyNpub(detailNpub)
              }}
              title="Copiar npub completo"
              type="button"
            >
              <CopyIcon />
              <span>Copiar</span>
            </button>
            {primalProfileUrl ? (
              <a
                className="sg-mini-action"
                href={primalProfileUrl}
                rel="noopener noreferrer"
                target="_blank"
                title="Abrir cuenta en Primal"
              >
                <ExternalLinkIcon />
                <span>Primal</span>
              </a>
            ) : null}
            {jumbleProfileUrl ? (
              <a
                className="sg-mini-action"
                href={jumbleProfileUrl}
                rel="noopener noreferrer"
                target="_blank"
                title="Abrir cuenta en Jumble"
              >
                <ExternalLinkIcon />
                <span>Jumble</span>
              </a>
            ) : null}
          </div>
        </div>
        <div className="sg-field">
          <span className="sg-field__k">nip05</span>
          <span className={`sg-field__v${detail.nip05 ? '' : ' sg-field__v--missing'}`}>
            {detail.nip05?.trim() || (isProfileLoading ? 'cargando...' : '—')}
          </span>
        </div>
        <div className="sg-field">
          <span className="sg-field__k">lud16</span>
          <span className={`sg-field__v${detail.lud16 ? '' : ' sg-field__v--missing'}`}>
            {detail.lud16?.trim() || (isProfileLoading ? 'cargando...' : '—')}
          </span>
        </div>
        <div className="sg-field">
          <span className="sg-field__k">Expansión</span>
          <span className="sg-field__v sg-field__v--stack">
            <span>{expansionStatusLabel}</span>
            {expansionMessage ? (
              <span className="sg-field__detail">
                {expansionMessage}
              </span>
            ) : null}
            {expansionVisibilityHint ? (
              <span className="sg-field__detail">
                {expansionVisibilityHint}
              </span>
            ) : null}
          </span>
        </div>
      </div>
    )
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const isPersonSearchDropdownOpen = isPersonSearchOpen && !isRootSheetOpen && hasRoot
  const isMobileUtilityPanelOpen = mobileUtilityPanel !== null && !isRootSheetOpen && hasRoot
  const isIdentityPanelOpen =
    detail.node !== null &&
    !isRootSheetOpen &&
    !isSettingsOpen &&
    !isZapsPanelOpen &&
    !isNotificationsOpen &&
    !isMobileUtilityPanelOpen
  const handleCloseSidePanel = useCallback(() => {
    if (isSettingsOpen) {
      setIsSettingsOpen(false)
    }
    if (isZapsPanelOpen) {
      setIsZapsPanelOpen(false)
    }
    if (isNotificationsOpen) {
      setIsNotificationsOpen(false)
    }
    if (isMobileUtilityPanelOpen) {
      setMobileUtilityPanel(null)
      return
    }
    if (isIdentityPanelOpen && !isIdentityHelpDismissed) {
      dismissIdentityHelp()
    }
    clearSelectedNode()
  }, [
    clearSelectedNode,
    dismissIdentityHelp,
    isIdentityHelpDismissed,
    isIdentityPanelOpen,
    isMobileUtilityPanelOpen,
    isNotificationsOpen,
    isSettingsOpen,
    isZapsPanelOpen,
  ])

  return (
    <main
      className="sg-app"
      data-graph-loading={isRootLoadScreenOpen ? 'true' : undefined}
      data-graph-v2=""
    >
      {/* Canvas — always present, full bleed under all chrome */}
      <SigmaCanvasHost
        avatarImagesEnabled={avatarPhotosEnabled}
        avatarRuntimeOptions={stableAvatarRuntimeOptions}
        callbacks={callbacks}
        dragInfluenceTuning={dragInfluenceTuning}
        enableDebugProbe={isTestMode}
        hideConnectionsForLowPerformance={lowPerformanceConnectionHidingActive}
        hideAvatarsOnMove={stableAvatarRuntimeOptions.hideImagesOnFastNodes}
        onAvatarPerfSnapshot={handleAvatarPerfSnapshot}
        physicsAutoFreezeEnabled={isDev ? devPhysicsAutoFreezeEnabled : true}
        physicsTuning={physicsTuning}
        ref={sigmaHostRef}
        scene={displayScene}
      />

      <SigmaRootLoadChrome
        bridge={bridge}
        displayNodeCount={displayScene.render.nodes.length}
        fallbackMessage={loadFeedback}
        hasRoot={hasRoot}
        identityLabel={rootDisplayName ?? sceneState.rootPubkey?.slice(0, 10) ?? null}
        isRootLoadScreenOpen={isRootLoadScreenOpen}
        isRootSheetOpen={isRootSheetOpen}
        relayState={relayState}
        rootLoadOverride={fixtureUiState?.rootLoad ?? null}
        rootPubkey={sceneState.rootPubkey}
        sceneNodeCount={deferredScene.render.nodes.length}
      />

      {/* Top bar: search strip (left) + brand (right) */}
      <SigmaTopBarRootLoadBridge
        bridge={bridge}
        displayNodeCount={displayScene.render.nodes.length}
        fallbackMessage={loadFeedback}
        identityLabel={rootDisplayName ?? sceneState.rootPubkey?.slice(0, 10) ?? null}
        nodeDrawProgress={searchNodeDrawProgress}
        nodeExpansionLoadProgress={nodeExpansionLoadProgress}
        onSwitchRoot={handleOpenRootSheet}
        rootDisplayName={hasRoot ? (rootDisplayName ?? sceneState.rootPubkey?.slice(0, 10) ?? null) : null}
        rootNpub={rootNpubEncoded}
        rootLoadOverride={fixtureUiState?.rootLoad ?? null}
        rootPictureUrl={rootPictureUrl}
        searchDisabled={!hasRoot}
        searchExpanded={isPersonSearchDropdownOpen}
        searchInputRef={personSearchInputRef}
        searchMatches={personSearchMatches}
        searchPlaceholder={hasRoot ? 'Buscar persona en el grafo' : 'Cargá una identidad para buscar'}
        searchQuery={personSearchQuery}
        searchTotalNodeCount={deferredScene.render.nodes.length}
        onSearchChange={handleChangePersonSearch}
        onSearchClear={handleClearPersonSearch}
        onSearchFocus={handleFocusPersonSearch}
        onSearchSelect={handleSelectPersonSearchMatch}
        onSearchSubmit={handleSubmitPersonSearch}
      />

      {/* Filter bar + rail + HUD + minimap — only when a root is loaded */}
      {hasRoot && (
        <>
          <SigmaFilterBar
            activeId={filterActiveId}
            onSelect={handleFilterSelect}
            pills={filterPills}
          />
          <SigmaSideRail buttons={railButtons} />
          <SigmaMobileBottomNav buttons={mobileNavButtons} />
          <SigmaHud stats={hudStats} />
          {!isIdentityPanelOpen &&
            !isNotificationsOpen &&
            !isMobileUtilityPanelOpen && (
            <SigmaMinimap
              getSnapshot={getMinimapSnapshot}
              getViewport={getMinimapViewport}
              onFit={handleMinimapFit}
              onZoomIn={handleMinimapZoomIn}
              onZoomOut={handleMinimapZoomOut}
              panCameraToGraph={handleMinimapPan}
              subscribeToCameraTicks={subscribeToMinimapCameraTicks}
              subscribeToRenderTicks={subscribeToMinimapTicks}
              zoomRatio={viewportRatio}
            />
          )}
        </>
      )}

      {/* Side panel — detail or tools (right), one at a time */}
      {canUseRuntimeInspector && isRuntimeInspectorOpen && hasRoot ? (
        <RuntimeInspectorUiStateBridge bridge={bridge} fixtureUiState={fixtureUiState}>
          {(uiState) => (
            <RuntimeInspectorDrawer
              avatarPerfSnapshot={avatarPerfSnapshot}
              deviceSummary={runtimeInspectorStoreState.deviceSummary}
              graphSummary={runtimeInspectorStoreState.graphSummary}
              liveZapFeedback={liveZapFeedFeedback}
              imageQualityMode={runtimeInspectorStoreState.imageQualityMode}
              onClose={() => setIsRuntimeInspectorOpen(false)}
              open={isRuntimeInspectorOpen}
              physicsEnabled={physicsEnabled}
              scene={deferredScene}
              sceneState={sceneState}
              showZaps={showZaps}
              sigmaHostRef={sigmaHostRef}
              uiState={uiState}
              visibleProfileWarmup={visibleProfileWarmupSnapshot}
              zapSummary={runtimeInspectorStoreState.zapSummary}
            />
          )}
        </RuntimeInspectorUiStateBridge>
      ) : null}

      {(isSettingsOpen ||
        isZapsPanelOpen ||
        isNotificationsOpen ||
        isIdentityPanelOpen ||
        isMobileUtilityPanelOpen) &&
        !isRuntimeInspectorOpen && (
        <SigmaSidePanel
          eyebrow={
            isSettingsOpen
              ? 'AJUSTES'
              : isZapsPanelOpen
                ? 'ZAPS'
                : isNotificationsOpen
                  ? 'NOTIFICACIONES'
                  : mobileUtilityPanel === 'filters'
                    ? 'FILTROS'
                    : 'IDENTIDAD'
          }
          mobileSnap={mobilePanelSnap}
          mobileSnapResetKey={isIdentityPanelOpen ? (detail.pubkey ?? undefined) : undefined}
          onClose={handleCloseSidePanel}
          tabs={
            isSettingsOpen && settingsTabs.length > 1 ? (
              <div className="sg-panel-tabs">
                {settingsTabs.map((tab) => (
                  <button
                    className={`sg-tab${activeSettingsTab === tab.id ? ' sg-tab--active' : ''}`}
                    key={tab.id}
                    onClick={() => setActiveSettingsTab(tab.id)}
                    type="button"
                  >
                    {tab.label}
                    {tab.id === 'dev' ? (
                      <span className="sg-tab__badge">DEV</span>
                    ) : null}
                  </button>
                ))}
              </div>
            ) : undefined
          }
        >
          {isSettingsOpen ? (
            renderSettingsContent()
          ) : isZapsPanelOpen ? (
            renderZapsContent()
          ) : isNotificationsOpen ? (
            renderNotificationsContent()
          ) : mobileUtilityPanel === 'filters' ? (
            renderFilterContent()
          ) : (
            renderDetailContent()
          )}
        </SigmaSidePanel>
      )}

      {/* Root loader modal */}
      {isRootSheetOpen && (
        <SigmaRootLoader
          canClose={hasRoot}
          manualInputSlot={
            <SigmaRootInput
              feedback={loadFeedback}
              onValidRoot={loadRootFromPointer}
            />
          }
          onClose={() => setIsRootSheetOpen(false)}
          sessionSlot={
            sessionIdentity.isConnected && sessionIdentity.profile ? (
              <button
                className="sigma-root-session"
                onClick={handleSelectSessionRoot}
                type="button"
              >
                <span className="sigma-root-session__eyebrow">Sesion conectada</span>
                <span className="sigma-root-session__main">
                  Explorar mi identidad
                </span>
                <span className="sigma-root-session__meta">
                  {sessionIdentity.profile.displayName ??
                    sessionIdentity.profile.name ??
                    sessionIdentity.profile.nip05 ??
                    sessionIdentity.profile.npub}
                </span>
              </button>
            ) : null
          }
          savedRootsSlot={
            shouldShowSavedRootsSection ? (
              <SigmaSavedRootsPanel
                entries={savedRoots}
                isHydrated={savedRootsHydrated}
                onDelete={handleDeleteSavedRoot}
                onSelect={handleSelectSavedRoot}
              />
            ) : null
          }
        />
      )}

      {/* Empty state — when no root and loader not open */}
      {!hasRoot && !isRootSheetOpen && (
        <SigmaEmptyState onLoadIdentity={() => setIsRootSheetOpen(true)} />
      )}

      {/* Toasts */}
      <SigmaToasts onDismiss={handleToastDismiss} toasts={toastEntries} />
    </main>
  )
}
