'use client'
/* eslint-disable @next/next/no-img-element */

import {
  memo,
  type ComponentProps,
  type KeyboardEvent,
  type PointerEvent,
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
import { useLocale, useTranslations } from 'next-intl'
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
import { getKernelNetworkTuning } from '@/features/graph-runtime/kernel/modules/constants'
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
  DEFAULT_GRAPH_SCENE_NODE_SIZE_CONFIG,
  getGraphSceneNodeSizeConfigSignature,
  GRAPH_SCENE_NODE_SIZE_STEP,
  MAX_GRAPH_SCENE_NODE_SIZE,
  MIN_GRAPH_SCENE_NODE_SIZE,
  normalizeGraphSceneNodeSizeConfig,
  type GraphSceneNodeSizeConfig,
} from '@/features/graph-v2/projections/graphSceneNodeSizeConfig'
import {
  applyPersonSearchHighlight,
  buildPersonSearchMatches,
} from '@/features/graph-v2/projections/personSearchHighlight'
import type {
  GraphInteractionCallbacks,
  GraphViewportState,
} from '@/features/graph-v2/renderer/contracts'
import {
  detectDevicePerformance,
  getDefaultImageQualityModeForProfile,
  getEffectiveGraphCapsForProfile,
  getEffectiveImageBudgetForProfile,
} from '@/features/graph-runtime/devicePerformance'
import {
  DEFAULT_AVATAR_RUNTIME_OPTIONS,
  type AvatarRuntimeOptions,
} from '@/features/graph-v2/renderer/avatar/types'
import {
  DEFAULT_INITIAL_CAMERA_ZOOM,
  MAX_INITIAL_CAMERA_ZOOM,
  MIN_INITIAL_CAMERA_ZOOM,
} from '@/features/graph-v2/renderer/SigmaRendererAdapter'
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
  PauseIcon,
  PinIcon,
  PlayIcon,
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
import { buildRootLoadProgressCopy } from '@/features/graph-v2/ui/rootLoadProgressI18n'
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
  RECENT_ZAP_REPLAY_DEFAULT_LOOKBACK_HOURS,
  RECENT_ZAP_REPLAY_MAX_LOOKBACK_HOURS,
  RECENT_ZAP_REPLAY_MIN_LOOKBACK_HOURS,
  buildRecentZapReplayCollectionViewModel,
  clearRecentZapReplayCache,
  clampRecentZapReplayLookbackHours,
  formatRecentZapReplayWindowLabel,
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
import { fetchProfileByPubkey, type NostrProfile } from '@/lib/nostr'

type SigmaSettingsTab = 'performance' | 'visuals' | 'zaps' | 'relays' | 'dev'
type NotificationSource = 'action' | 'zap'
type ZapFeedMode = 'live' | 'recent'
type MobileUtilityPanel = 'filters' | null
type ZapActivitySource = 'live' | 'recent' | 'simulated'
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
  eventId?: string
}

const INTEGER_FORMATTER = new Intl.NumberFormat('es-AR')
const NOTIFICATION_AUTO_DISMISS_MS = 6500
const NOTIFICATION_HISTORY_LIMIT = 100
const ZAP_ACTIVITY_LIMIT = 80
const MOBILE_PHYSICS_QUERY = '(max-width: 720px)'
const MOBILE_FORCE_ATLAS_REPULSION_FORCE = 2.4
const ZAP_ACTIVITY_SOURCE_LABELS: Record<ZapActivitySource, string> = {
  live: 'Live',
  recent: 'Replay',
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

const IDENTITY_FIRST_RUN_HELP_KEY = 'sigma.identityFirstRunHelpDismissed'
const AVATAR_PHOTOS_ENABLED_STORAGE_KEY = 'sigma.avatarPhotosEnabled'
const RUNTIME_INSPECTOR_BUTTON_STORAGE_KEY = 'sigma.runtimeInspectorButtonEnabled'
const VISIBLE_EDGE_COUNT_LABELS_STORAGE_KEY = 'sigma.visibleEdgeCountLabels'
const INITIAL_CAMERA_ZOOM_STORAGE_KEY = 'sigma.initialCameraZoom'
const NODE_SIZE_CONFIG_STORAGE_KEY = 'sigma.nodeSizeConfig'
const RECENT_ZAP_REPLAY_LOOKBACK_STORAGE_KEY = 'sigma.recentZapReplayLookbackHours'
const RECENT_ZAP_REPLAY_LOOKBACK_DEBOUNCE_MS = 350
const ZAP_REPLAY_KEYBOARD_SEEK_STEP = 0.05
const VISIBLE_PROFILE_WARMUP_BATCH_SIZE = 48
const VISIBLE_PROFILE_WARMUP_COOLDOWN_MS = 2 * 60 * 1000
const ZAP_ACTOR_PROFILE_BATCH_SIZE = 6
const HEX_PUBKEY_RE = /^[0-9a-f]{64}$/i

const clampInitialCameraZoom = (value: number) =>
  Number.isFinite(value)
    ? Math.min(
        Math.max(value, MIN_INITIAL_CAMERA_ZOOM),
        MAX_INITIAL_CAMERA_ZOOM,
      )
    : DEFAULT_INITIAL_CAMERA_ZOOM

const readStoredInitialCameraZoom = () => {
  if (typeof window === 'undefined') {
    return DEFAULT_INITIAL_CAMERA_ZOOM
  }

  try {
    const stored = window.localStorage.getItem(INITIAL_CAMERA_ZOOM_STORAGE_KEY)
    return stored === null
      ? DEFAULT_INITIAL_CAMERA_ZOOM
      : clampInitialCameraZoom(Number.parseFloat(stored))
  } catch {
    return DEFAULT_INITIAL_CAMERA_ZOOM
  }
}

const readStoredNodeSizeConfig = (): GraphSceneNodeSizeConfig => {
  if (typeof window === 'undefined') {
    return DEFAULT_GRAPH_SCENE_NODE_SIZE_CONFIG
  }

  try {
    const stored = window.localStorage.getItem(NODE_SIZE_CONFIG_STORAGE_KEY)
    if (stored === null) {
      return DEFAULT_GRAPH_SCENE_NODE_SIZE_CONFIG
    }

    return normalizeGraphSceneNodeSizeConfig(
      JSON.parse(stored) as Partial<GraphSceneNodeSizeConfig>,
    )
  } catch {
    return DEFAULT_GRAPH_SCENE_NODE_SIZE_CONFIG
  }
}

const readStoredRecentZapReplayLookbackHours = () => {
  if (typeof window === 'undefined') {
    return RECENT_ZAP_REPLAY_DEFAULT_LOOKBACK_HOURS
  }

  try {
    const stored = window.localStorage.getItem(RECENT_ZAP_REPLAY_LOOKBACK_STORAGE_KEY)
    return stored === null
      ? RECENT_ZAP_REPLAY_DEFAULT_LOOKBACK_HOURS
      : clampRecentZapReplayLookbackHours(Number.parseFloat(stored))
  } catch {
    return RECENT_ZAP_REPLAY_DEFAULT_LOOKBACK_HOURS
  }
}

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
// count can change â€” perfect WeakMap cache key. Avoids allocating a fresh
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

const formatInteger = (value: number) => INTEGER_FORMATTER.format(value)

const resolveZapActorProfileLabel = (profile: NostrProfile) =>
  profile.displayName?.trim() ||
  profile.name?.trim() ||
  profile.nip05?.trim() ||
  null

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

const getZapReplayStatusLabel = (replay: RecentZapReplaySnapshot) => {
  if (replay.playbackPaused) {
    return replay.stage === 'collecting' || replay.stage === 'decoding'
      ? 'Replay pausado al terminar'
      : 'Replay pausado'
  }

  switch (replay.stage) {
    case 'collecting':
      return 'Consultando relays'
    case 'decoding':
      return 'Cerrando recoleccion'
    case 'playing':
      return 'Reproduciendo timeline'
    case 'done':
      return 'Replay listo'
    case 'error':
      return 'Replay con error'
    case 'idle':
    default:
      return 'Replay en espera'
  }
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

// â”€â”€ Sub-components (settings/relay content) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
  const t = useTranslations('sigma.settings.relayEditor')
  const [draft, setDraft] = useState(relayUrls.join('\n'))
  const [message, setMessage] = useState<string | null>(null)
  const relaySignature = relayUrls.join('\n')

  useEffect(() => {
    setDraft(relaySignature)
  }, [relaySignature])

  return (
    <div className="sg-settings-section">
      <h4>{t('title')}</h4>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: 12, color: 'var(--sg-fg-muted)' }}>{t('status')}</span>
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
          {isGraphStale ? t('custom') : t('base')}
        </span>
      </div>
      <textarea
        onChange={(event) => setDraft(event.target.value)}
        placeholder={t('placeholder')}
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
                .then(() => { setMessage(t('applied', { count: nextRelayUrls.length })) })
                .catch((error) => {
                  setMessage(error instanceof Error ? error.message : t('applyError'))
                })
            })
          }}
          style={{ flex: 'none' }}
          type="button"
        >
          {t('apply')}
        </button>
        {isGraphStale ? (
          <button
            className="sg-btn"
            onClick={() => {
              startTransition(() => {
                void onRevert()
                  .then(() => { setMessage(t('reverted')) })
                  .catch((error) => {
                    setMessage(error instanceof Error ? error.message : t('revertError'))
                  })
              })
            }}
            style={{ flex: 'none' }}
            type="button"
          >
            {t('revert')}
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
  const t = useTranslations('sigma.settings.graphCapacity')
  const locale = useLocale()
  const sliderValue = Math.min(
    GRAPH_MAX_NODES_SLIDER_MAX,
    Math.max(GRAPH_MAX_NODES_SLIDER_MIN, maxNodes),
  )
  const remainingCapacity = Math.max(0, maxNodes - nodeCount)
  const isAtProjectDefault = maxNodes === DEFAULT_MAX_GRAPH_NODES
  const isAtRecommended = maxNodes === recommendedMaxNodes
  const deviceProfileLabels: Record<AppStore['devicePerformanceProfile'], string> = {
    desktop: 'desktop',
    mobile: locale === 'en' ? 'mobile' : 'movil',
    'low-end-mobile': locale === 'en' ? 'low-end mobile' : 'movil liviano',
  }

  return (
    <div className="sg-settings-section">
      <h4>{t('title')}</h4>
      <div className="sg-slider-row">
        <div className="sg-slider-row__head">
          <span className="sg-slider-row__lbl">{t('maxNodes')}</span>
          <span className="sg-slider-row__val">
            {t('nodesValue', { count: formatInteger(maxNodes) })}
          </span>
        </div>
        <p
          style={{
            fontSize: 10.5,
            color: 'var(--sg-fg-faint)',
            margin: '2px 0 8px',
          }}
        >
          {t('description')}
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
          {t('project', { count: formatInteger(DEFAULT_MAX_GRAPH_NODES) })}
        </button>
        <button
          className="sg-btn"
          disabled={isAtRecommended}
          onClick={() => onChange(recommendedMaxNodes)}
          style={{ flex: 'none', padding: '4px 10px', fontSize: 11 }}
          type="button"
        >
          {t('recommended', { count: formatInteger(recommendedMaxNodes) })}
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
          [t('loadedNodes'), formatInteger(nodeCount)],
          [t('remainingMargin'), formatInteger(remainingCapacity)],
          [
            t('recommendedFor', {
              profile: deviceProfileLabels[devicePerformanceProfile],
            }),
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
          {t('capReached')}
        </p>
      ) : null}
    </div>
  )
}
const PHYSICS_TUNING_SLIDERS: Array<{
  key: keyof ForceAtlasPhysicsTuning
  min: number
  max: number
  step: number
}> = [
  { key: 'centripetalForce', min: 0, max: 0.5, step: 0.01 },
  { key: 'repulsionForce', min: 0.25, max: 5, step: 0.05 },
  { key: 'linkForce', min: 0.25, max: 2.5, step: 0.05 },
  { key: 'linkDistance', min: 0.5, max: 2, step: 0.05 },
  { key: 'damping', min: 0.1, max: 2.5, step: 0.05 },
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
  const locale = useLocale()
  const physicsSliderCopy: Record<keyof ForceAtlasPhysicsTuning, { label: string; description: string }> = locale === 'en'
    ? {
        centripetalForce: {
          label: 'Centripetal force',
          description: 'Multiplies gravity and compacts the graph. Set 0 to disable it.',
        },
        repulsionForce: {
          label: 'Repulsion',
          description: 'Multiplies scalingRatio and separates nodes.',
        },
        linkForce: {
          label: 'Link force',
          description: 'Multiplies edgeWeightInfluence.',
        },
        linkDistance: {
          label: 'Link distance',
          description: 'Approximates spacing without changing ForceAtlas2.',
        },
        damping: {
          label: 'Damping',
          description: 'Multiplies slowDown to change speed and inertia.',
        },
      }
    : {
        centripetalForce: {
          label: 'Fuerza centripeta',
          description: 'Multiplica gravity: compacta el grafo. 0 la desactiva.',
        },
        repulsionForce: {
          label: 'Repulsion',
          description: 'Multiplica scalingRatio: separa nodos.',
        },
        linkForce: {
          label: 'Fuerza de enlace',
          description: 'Multiplica edgeWeightInfluence.',
        },
        linkDistance: {
          label: 'Distancia de enlace',
          description: 'Aproxima distancia sin cambiar ForceAtlas2.',
        },
        damping: {
          label: 'Amortiguacion',
          description: 'Multiplica slowDown: velocidad e inercia.',
        },
      }

  return (
    <div className="sg-settings-section">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <h4 style={{ margin: 0 }}>ForceAtlas2</h4>
        <button className="sg-btn" onClick={onReset} style={{ flex: 'none', padding: '4px 10px', fontSize: 11 }} type="button">
          Reset
        </button>
      </div>
      {PHYSICS_TUNING_SLIDERS.map((slider) => {
        const value = tuning[slider.key]
        const copy = physicsSliderCopy[slider.key]
        return (
          <div className="sg-slider-row" key={slider.key}>
            <div className="sg-slider-row__head">
              <span className="sg-slider-row__lbl">{copy.label}</span>
              <span className="sg-slider-row__val">{(value as number).toFixed(2)}x</span>
            </div>
            <p style={{ fontSize: 10.5, color: 'var(--sg-fg-faint)', margin: '2px 0 4px' }}>{copy.description}</p>
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
  min: number
  max: number
  step: number
}> = [
  { key: 'edgeStiffness', min: 0.01, max: 0.12, step: 0.002 },
  { key: 'anchorStiffnessPerHop', min: 0.001, max: 0.02, step: 0.0005 },
  { key: 'baseDamping', min: 0.75, max: 0.95, step: 0.005 },
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
  const locale = useLocale()
  const dragSliderCopy: Record<keyof DragNeighborhoodInfluenceTuning, { label: string; description: string }> = locale === 'en'
    ? {
        edgeStiffness: {
          label: 'Edge stiffness',
          description: 'How far the pull spreads through connected edges.',
        },
        anchorStiffnessPerHop: {
          label: 'Anchor per hop',
          description: 'How strongly each hop returns to its starting position.',
        },
        baseDamping: {
          label: 'Base damping',
          description: 'Velocity damping.',
        },
      }
    : {
        edgeStiffness: {
          label: 'Rigidez de aristas',
          description: 'Cuanto se propaga el tiron por las aristas.',
        },
        anchorStiffnessPerHop: {
          label: 'Ancla por hop',
          description: 'Cuanto vuelve cada hop a su posicion inicial.',
        },
        baseDamping: {
          label: 'Amortiguacion base',
          description: 'Amortiguacion de velocidad.',
        },
      }

  return (
    <div className="sg-settings-section">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <h4 style={{ margin: 0 }}>{locale === 'en' ? 'Drag springs lab' : 'Laboratorio de resortes de drag'}</h4>
        <button className="sg-btn" onClick={onReset} style={{ flex: 'none', padding: '4px 10px', fontSize: 11 }} type="button">
          Reset
        </button>
      </div>
      {DRAG_TUNING_SLIDERS.map((slider) => {
        const value = tuning[slider.key]
        const copy = dragSliderCopy[slider.key]
        return (
          <div className="sg-slider-row" key={slider.key}>
            <div className="sg-slider-row__head">
              <span className="sg-slider-row__lbl">{copy.label}</span>
              <span className="sg-slider-row__val">{(value as number).toFixed(3)}</span>
            </div>
            <p style={{ fontSize: 10.5, color: 'var(--sg-fg-faint)', margin: '2px 0 4px' }}>{copy.description}</p>
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
  initialCameraZoom,
  nodeSizeConfig,
  showVisibleEdgeCountLabels,
  onAvatarRuntimeOptionsChange,
  onInitialCameraZoomChange,
  onNodeSizeConfigChange,
  onToggleVisibleEdgeCountLabels,
}: {
  avatarRuntimeOptions: AvatarRuntimeOptions
  initialCameraZoom: number
  nodeSizeConfig: GraphSceneNodeSizeConfig
  showVisibleEdgeCountLabels: boolean
  onAvatarRuntimeOptionsChange: (options: AvatarRuntimeOptions) => void
  onInitialCameraZoomChange: (zoom: number) => void
  onNodeSizeConfigChange: (config: GraphSceneNodeSizeConfig) => void
  onToggleVisibleEdgeCountLabels: () => void
}) {
  const t = useTranslations('sigma.settings.visuals')

  return (
    <div>
      <div className="sg-settings-section">
        <h4>{t('camera')}</h4>
        <div className="sg-slider-row">
          <div className="sg-slider-row__head">
            <span className="sg-slider-row__lbl">{t('initialZoom')}</span>
            <span className="sg-slider-row__val">{initialCameraZoom.toFixed(2)}x</span>
          </div>
          <input
            className="sg-slider"
            max={MAX_INITIAL_CAMERA_ZOOM}
            min={MIN_INITIAL_CAMERA_ZOOM}
            onChange={(event) => {
              onInitialCameraZoomChange(
                Number.parseFloat(event.target.value),
              )
            }}
            step={0.05}
            type="range"
            value={initialCameraZoom}
          />
        </div>
      </div>
      <div className="sg-settings-section">
        <h4>{t('nodes')}</h4>
        <div className="sg-slider-row">
          <div className="sg-slider-row__head">
            <span className="sg-slider-row__lbl">{t('rootSize')}</span>
            <span className="sg-slider-row__val">{nodeSizeConfig.rootSize}px</span>
          </div>
          <p style={{ fontSize: 10.5, color: 'var(--sg-fg-faint)', margin: '2px 0 4px' }}>
            {t('rootSizeDesc')}
          </p>
          <input
            className="sg-slider"
            max={MAX_GRAPH_SCENE_NODE_SIZE}
            min={MIN_GRAPH_SCENE_NODE_SIZE}
            onChange={(event) => {
              onNodeSizeConfigChange({
                ...nodeSizeConfig,
                rootSize: Number.parseFloat(event.target.value),
              })
            }}
            step={GRAPH_SCENE_NODE_SIZE_STEP}
            type="range"
            value={nodeSizeConfig.rootSize}
          />
        </div>
        <div className="sg-slider-row">
          <div className="sg-slider-row__head">
            <span className="sg-slider-row__lbl">{t('expandedSize')}</span>
            <span className="sg-slider-row__val">{nodeSizeConfig.expandedSize}px</span>
          </div>
          <p style={{ fontSize: 10.5, color: 'var(--sg-fg-faint)', margin: '2px 0 4px' }}>
            {t('expandedSizeDesc')}
          </p>
          <input
            className="sg-slider"
            max={MAX_GRAPH_SCENE_NODE_SIZE}
            min={MIN_GRAPH_SCENE_NODE_SIZE}
            onChange={(event) => {
              onNodeSizeConfigChange({
                ...nodeSizeConfig,
                expandedSize: Number.parseFloat(event.target.value),
              })
            }}
            step={GRAPH_SCENE_NODE_SIZE_STEP}
            type="range"
            value={nodeSizeConfig.expandedSize}
          />
        </div>
      </div>
      <div className="sg-settings-section">
        <h4>{t('labels')}</h4>
        <div className="sg-setting-row">
          <div>
            <div className="sg-setting-row__lbl">{t('visibleDegree')}</div>
            <div className="sg-setting-row__desc">
              {t('visibleDegreeDesc')}
            </div>
          </div>
          <button
            aria-pressed={showVisibleEdgeCountLabels}
            className={`sg-toggle${showVisibleEdgeCountLabels ? ' sg-toggle--on' : ''}`}
            onClick={onToggleVisibleEdgeCountLabels}
            title={
              showVisibleEdgeCountLabels
                ? t('showNodeNames')
                : t('showVisibleEdges')
            }
            type="button"
          />
        </div>
      </div>
      <div className="sg-settings-section">
        <h4>{t('monograms')}</h4>
        <div className="sg-setting-row">
          <div>
            <div className="sg-setting-row__lbl">{t('monogramLetters')}</div>
            <div className="sg-setting-row__desc">
              {t('monogramLettersDesc')}
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
  mobileDegradedMode,
  isMobileViewport,
  maxNodes,
  nodeCount,
  runtimeInspectorButtonVisible,
  recommendedMaxNodes,
  rootPubkey,
  rootLoadStatus,
  onClearSiteCache,
  onToggleRuntimeInspectorButton,
  onToggleMobileDegradedMode,
  onGraphMaxNodesChange,
  onToggleAvatarPhotos,
  onToggleHideConnectionsOnLowPerformance,
  onAvatarRuntimeOptionsChange,
  onExpandRoot,
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
  mobileDegradedMode: boolean
  isMobileViewport: boolean
  maxNodes: number
  nodeCount: number
  runtimeInspectorButtonVisible: boolean
  recommendedMaxNodes: number
  rootPubkey: string | null
  rootLoadStatus: string
  onClearSiteCache: () => void
  onToggleRuntimeInspectorButton: () => void
  onToggleMobileDegradedMode: () => void
  onGraphMaxNodesChange: (maxNodes: number) => void
  onToggleAvatarPhotos: () => void
  onToggleHideConnectionsOnLowPerformance: () => void
  onAvatarRuntimeOptionsChange: (options: AvatarRuntimeOptions) => void
  onExpandRoot: () => void
}) {
  const t = useTranslations('sigma.settings.performance')
  const isExpandingRoot = rootLoadStatus === 'loading'
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
        <h4>{t('discovery')}</h4>
        <div className="sg-setting-row">
          <div>
            <div className="sg-setting-row__lbl">{t('findMoreNodes')}</div>
            <div className="sg-setting-row__desc">
              {t('findMoreNodesDesc')}
            </div>
          </div>
          <button
            className="sg-btn sg-btn--secondary"
            disabled={!rootPubkey || isExpandingRoot}
            id="btn-expand-root"
            onClick={onExpandRoot}
            title={!rootPubkey ? t('loadRootFirst') : isExpandingRoot ? t('searching') : t('findMoreNodesTitle')}
            type="button"
          >
            {isExpandingRoot ? '?' : '?+'}
          </button>
        </div>
      </div>
      <div className="sg-settings-section">
        <h4>{t('fluidity')}</h4>
        <div className="sg-setting-row">
          <div>
            <div className="sg-setting-row__lbl">{t('prioritizeFluidity')}</div>
            <div className="sg-setting-row__desc">
              {t('prioritizeFluidityDesc', { status: lowPerformanceConnectionStatusLabel })}
            </div>
          </div>
          <button
            aria-pressed={hideConnectionsOnLowPerformance}
            className={`sg-toggle${hideConnectionsOnLowPerformance ? ' sg-toggle--on' : ''}`}
            onClick={onToggleHideConnectionsOnLowPerformance}
            title={
              hideConnectionsOnLowPerformance
                ? t('disableConnectionLod')
                : t('enableConnectionLod')
            }
            type="button"
          />
        </div>
        {isMobileViewport && (
          <div className="sg-setting-row">
            <div>
              <div className="sg-setting-row__lbl">{t('mobileDegraded')}</div>
              <div className="sg-setting-row__desc">
                {t('mobileDegradedDesc')}
              </div>
            </div>
            <button
              aria-pressed={mobileDegradedMode}
              className={`sg-toggle${mobileDegradedMode ? ' sg-toggle--on' : ''}`}
              onClick={onToggleMobileDegradedMode}
              title={mobileDegradedMode ? t('disableDegraded') : t('enableDegraded')}
              type="button"
            />
          </div>
        )}
      </div>
      <div className="sg-settings-section">
        <h4>{t('diagnostics')}</h4>
        <div className="sg-setting-row">
          <div>
            <div className="sg-setting-row__lbl">{t('runtimeInspector')}</div>
            <div className="sg-setting-row__desc">
              {isRuntimeInspectorButtonLocked
                ? t('runtimeInspectorDescLocked')
                : t('runtimeInspectorDescUnlocked')}
            </div>
          </div>
          <button
            aria-pressed={runtimeInspectorButtonVisible}
            className={`sg-toggle${runtimeInspectorButtonVisible ? ' sg-toggle--on' : ''}`}
            disabled={isRuntimeInspectorButtonLocked}
            onClick={onToggleRuntimeInspectorButton}
            title={
              isRuntimeInspectorButtonLocked
                ? t('runtimeVisibleByDefault')
                : runtimeInspectorButtonVisible
                  ? t('hideRuntimeButton')
                  : t('showRuntimeButton')
            }
            type="button"
          />
        </div>
      </div>
      <div className="sg-settings-section">
        <h4>{t('localData')}</h4>
        <div className="sg-setting-row">
          <div>
            <div className="sg-setting-row__lbl">{t('browserCache')}</div>
            <div className="sg-setting-row__desc">
              {t('browserCacheDesc', {
                message: cacheClearMessage ? ` ${cacheClearMessage}` : '',
              })}
            </div>
          </div>
          <button
            className="sg-mini-action sg-mini-action--danger"
            disabled={isClearingSiteCache}
            onClick={onClearSiteCache}
            type="button"
          >
            {isClearingSiteCache ? t('clearing') : t('clearCache')}
          </button>
        </div>
      </div>
      <div className="sg-settings-section">
        <h4>{t('avatars')}</h4>
        <div className="sg-setting-row">
          <div>
            <div className="sg-setting-row__lbl">{t('avatarPhotos')}</div>
            <div className="sg-setting-row__desc">
              {t('avatarPhotosDesc')}
            </div>
          </div>
          <button
            aria-pressed={avatarPhotosEnabled}
            className={`sg-toggle${avatarPhotosEnabled ? ' sg-toggle--on' : ''}`}
            onClick={onToggleAvatarPhotos}
            title={
              avatarPhotosEnabled
                ? t('disableAvatarPhotos')
                : t('enableAvatarPhotos')
            }
            type="button"
          />
        </div>
        <div className="sg-setting-row">
          <div>
            <div className="sg-setting-row__lbl">{t('hideOnMove')}</div>
            <div className="sg-setting-row__desc">
              {t('hideOnMoveDesc')}
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
        <div className="sg-setting-row">
          <div>
            <div className="sg-setting-row__lbl">{t('hideWhenZoomedOut')}</div>
            <div className="sg-setting-row__desc">
              {t('hideWhenZoomedOutDesc')}
            </div>
          </div>
          <button
            className={`sg-toggle${!avatarRuntimeOptions.allowZoomedOutImages ? ' sg-toggle--on' : ''}`}
            onClick={() => {
              const nextVal = !avatarRuntimeOptions.allowZoomedOutImages
              onAvatarRuntimeOptionsChange({
                ...avatarRuntimeOptions,
                allowZoomedOutImages: nextVal,
                showAllVisibleImages: nextVal,
              })
            }}
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
  const locale = useLocale()
  const perfStatusLabel = avatarPerfSnapshot
    ? avatarPerfSnapshot.isDegraded
      ? locale === 'en'
        ? `degraded to ${avatarPerfSnapshot.tier}`
        : `degradado a ${avatarPerfSnapshot.tier}`
      : locale === 'en'
        ? `base ${avatarPerfSnapshot.tier}`
        : `base ${avatarPerfSnapshot.tier}`
    : locale === 'en'
      ? 'no data'
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
      <h4>{locale === 'en' ? 'Avatar dev' : 'Avatares dev'}</h4>
      <div className="sg-setting-row">
        <div>
          <div className="sg-setting-row__lbl">{locale === 'en' ? 'Monograms when zoomed out' : 'Monogramas en zoom-out'}</div>
          <div className="sg-setting-row__desc">{locale === 'en' ? 'Draws visible fallbacks even when the node is small.' : 'Dibuja fallbacks visibles aunque el nodo sea chico.'}</div>
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
          <div className="sg-setting-row__lbl">{locale === 'en' ? 'Monogram background' : 'Fondo de monograma'}</div>
          <div className="sg-setting-row__desc">{locale === 'en' ? 'Shows a color circle when the photo is not ready.' : 'Circulo de color cuando no hay foto lista.'}</div>
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
          <span className="sg-slider-row__lbl">{locale === 'en' ? 'Minimum radius' : 'Radio minimo'}</span>
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
          <span className="sg-slider-row__lbl">{locale === 'en' ? 'Max zoom for photos' : 'Zoom maximo para fotos'}</span>
          <span className="sg-slider-row__val">{avatarRuntimeOptions.zoomThreshold.toFixed(2)}x</span>
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
          <div className="sg-setting-row__lbl">{locale === 'en' ? 'All visible photos' : 'Todas las fotos visibles'}</div>
          <div className="sg-setting-row__desc">{locale === 'en' ? 'Shows photos on every visible node and rescales buckets based on zoom.' : 'Muestra fotos en todos los nodos visibles y reescala buckets segun el zoom.'}</div>
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
          <div className="sg-setting-row__lbl">{locale === 'en' ? 'Max interactive bucket' : 'Bucket interactivo maximo'}</div>
          <div className="sg-setting-row__desc">{locale === 'en' ? 'Limits quality while navigating.' : 'Limita calidad durante la navegacion.'}</div>
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
        {locale === 'en' ? 'Reset avatars' : 'Reset avatares'}
      </button>
      <div style={{ marginTop: 12, border: '1px solid var(--sg-stroke)', borderRadius: 8, padding: '10px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 12, color: 'var(--sg-fg-muted)' }}>{locale === 'en' ? 'Adaptive' : 'Adaptivo'}</span>
          <span style={{ fontFamily: 'var(--sg-font-mono)', fontSize: 11, color: 'var(--sg-fg-muted)' }}>{perfStatusLabel}</span>
        </div>
        <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          {[
            ['FPS EMA', formatFpsWithFrameMs(avatarPerfSnapshot?.emaFrameMs)],
            [locale === 'en' ? 'Base' : 'Base', avatarPerfSnapshot?.baseTier ?? 'n/a'],
            [locale === 'en' ? 'Loads' : 'Cargas', avatarPerfSnapshot?.budget.concurrency ?? 'n/a'],
            ['Bucket', avatarPerfSnapshot ? `${avatarPerfSnapshot.budget.maxBucket}px` : 'n/a'],
            [locale === 'en' ? 'Effective radius' : 'Radio efectivo', `${effectiveSizeThreshold.toFixed(0)}px`],
            [locale === 'en' ? 'Effective zoom' : 'Zoom efectivo', `${effectiveZoomThreshold.toFixed(2)}x`],
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

// â”€â”€ Main component â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
  const loadingT = useTranslations('sigma.loading')
  const locale = useLocale()
  const progressCopy = useMemo(
    () => buildRootLoadProgressCopy({ locale, t: loadingT }),
    [loadingT, locale],
  )
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
      copy: progressCopy,
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
    progressCopy,
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
  const tSigma = useTranslations('sigma')
  const locale = useLocale()
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
  const liveRootLoadStatus = useSyncExternalStore(
    bridge.subscribeUi,
    () => bridge.getUiState().rootLoad.status,
    () => bridge.getUiState().rootLoad.status,
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
  const [initialCameraZoom, setInitialCameraZoom] = useState(
    readStoredInitialCameraZoom,
  )
  const [nodeSizeConfig, setNodeSizeConfig] = useState<GraphSceneNodeSizeConfig>(
    readStoredNodeSizeConfig,
  )
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
  // Rail toggles â€” direct controls, decoupled from the settings panel
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
  const [recentZapReplayLookbackHours, setRecentZapReplayLookbackHours] =
    useState(readStoredRecentZapReplayLookbackHours)
  const [
    appliedRecentZapReplayLookbackHours,
    setAppliedRecentZapReplayLookbackHours,
  ] = useState(readStoredRecentZapReplayLookbackHours)
  const [recentZapReplayRequest, setRecentZapReplayRequest] = useState(0)
  const [recentZapReplayRefreshRequest, setRecentZapReplayRefreshRequest] = useState(0)
  const [recentZapReplaySeekRequest, setRecentZapReplaySeekRequest] =
    useState({ key: 0, progress: 0 })
  const [recentZapReplayScrubProgress, setRecentZapReplayScrubProgress] =
    useState<number | null>(null)
  const [recentZapReplayPlaybackPaused, setRecentZapReplayPlaybackPaused] =
    useState(false)
  const [pauseLiveZapsWhenSceneIsLarge, setPauseLiveZapsWhenSceneIsLarge] =
    useState(false)
  const [zapActivityLog, setZapActivityLog] = useState<ZapActivityLogEntry[]>([])
  const [zapActorLabelsByPubkey, setZapActorLabelsByPubkey] =
    useState<Record<string, string>>({})
  const zapActivitySequenceRef = useRef(0)
  const zapActorProfileAttemptedRef = useRef(new Set<string>())
  const zapActorProfileInflightRef = useRef(new Set<string>())
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
  const renderConfig = useAppStore((state) => state.renderConfig)
  const setRenderConfig = useAppStore((state) => state.setRenderConfig)
  const applyDevicePerformanceProfile = useAppStore((state) => state.applyDevicePerformanceProfile)
  const [isMobileViewport, setIsMobileViewport] = useState(isMobileGraphViewport)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const mq = window.matchMedia(MOBILE_PHYSICS_QUERY)
    const handler = (e: MediaQueryListEvent) => setIsMobileViewport(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const isCoarse = window.matchMedia('(pointer: coarse)').matches
    const vpWidth = window.innerWidth
    const memory = typeof navigator !== 'undefined' && 'deviceMemory' in navigator ? (navigator as Navigator & { deviceMemory?: number }).deviceMemory : null
    const cores = navigator?.hardwareConcurrency ?? null
    
    const detection = detectDevicePerformance({
      isPointerCoarse: isCoarse,
      viewportWidth: vpWidth,
      deviceMemory: memory,
      hardwareConcurrency: cores,
    })

    const targetProfile = (renderConfig.mobileDegradedMode && (detection.profile === 'mobile' || detection.profile === 'low-end-mobile')) 
      ? detection.profile 
      : 'desktop'

    applyDevicePerformanceProfile({
      profile: targetProfile,
      graphCaps: getEffectiveGraphCapsForProfile(targetProfile),
      imageBudget: getEffectiveImageBudgetForProfile(targetProfile),
      defaultImageQualityMode: getDefaultImageQualityModeForProfile(targetProfile),
    })
  }, [renderConfig.mobileDegradedMode, applyDevicePerformanceProfile])
  
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
    try {
      window.localStorage.setItem(
        INITIAL_CAMERA_ZOOM_STORAGE_KEY,
        initialCameraZoom.toString(),
      )
    } catch {
      // Non-critical preference persistence.
    }
  }, [initialCameraZoom])

  useEffect(() => {
    try {
      window.localStorage.setItem(
        NODE_SIZE_CONFIG_STORAGE_KEY,
        JSON.stringify(nodeSizeConfig),
      )
    } catch {
      // Non-critical preference persistence.
    }
  }, [nodeSizeConfig])

  useEffect(() => {
    try {
      window.localStorage.setItem(
        RECENT_ZAP_REPLAY_LOOKBACK_STORAGE_KEY,
        recentZapReplayLookbackHours.toString(),
      )
    } catch {
      // Non-critical preference persistence.
    }
  }, [recentZapReplayLookbackHours])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setAppliedRecentZapReplayLookbackHours(recentZapReplayLookbackHours)
    }, RECENT_ZAP_REPLAY_LOOKBACK_DEBOUNCE_MS)

    return () => {
      window.clearTimeout(timer)
    }
  }, [recentZapReplayLookbackHours])

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
  const rootLoadStatus = fixtureUiState?.rootLoad.status ?? liveRootLoadStatus
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
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
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
      const changed = KEYS.filter((_, i) => prevParts[i] !== nextParts[i])
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
  const nodeSizeConfigSignature = useMemo(
    () => getGraphSceneNodeSizeConfigSignature(nodeSizeConfig),
    [nodeSizeConfig],
  )
  const deferredScene = useMemo(
    () =>
      buildGraphSceneSnapshot(deferredSceneState, {
        nodeSizeConfig,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deferredSceneState.sceneSignature, nodeSizeConfigSignature],
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
      const snapshot = buildGraphSceneSnapshot(warmupState, {
        nodeSizeConfig,
      })
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
  }, [deferredSceneState, isFixtureMode, isSceneTransitionPending, nodeSizeConfig])

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
    zap: Pick<ParsedZap, 'fromPubkey' | 'toPubkey' | 'sats'> & { eventId?: string },
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
      eventId: zap.eventId,
    }
    setZapActivityLog((current) => {
      if (entry.eventId && current.some((e) => e.eventId === entry.eventId)) {
        return current
      }
      return [entry, ...current].slice(0, ZAP_ACTIVITY_LIMIT)
    })
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
    
    // Animar el zap si al menos un nodo estÃ¡ presente en el renderizado
    const hasVisibleFrom = visibleNodeSet.has(zap.fromPubkey)
    const hasVisibleTo = visibleNodeSet.has(zap.toPubkey)
    if (!hasVisibleFrom && !hasVisibleTo) {
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
    
    let matchedConnection = null
    if (hasVisibleFrom && hasVisibleTo) {
      matchedConnection =
        sceneConnectionLookup.connections.get(
          createSceneConnectionKey(zap.fromPubkey, zap.toPubkey),
        ) ?? null
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

  const handleReplayZapActivity = useCallback((entry: ZapActivityLogEntry) => {
    const played = handleZap(entry)
    setZapActivityLog((current) =>
      current.map((item) =>
        item.id === entry.id ? { ...item, played } : item,
      ),
    )
    setZapFeedback(
      played
        ? `Zap reproducido: ${formatInteger(entry.sats)} sats`
        : 'No se pudo reproducir ese zap en la vista actual.',
    )
  }, [handleZap])

  // Propagate physics pause/resume to the Sigma runtime when toggled.
  useEffect(() => {
    sigmaHostRef.current?.setPhysicsSuspended(!physicsEnabled)
  }, [physicsEnabled])

  useEffect(() => {
    if (zapActivityLog.length === 0) return

    const attemptedPubkeys = zapActorProfileAttemptedRef.current
    const inflightPubkeys = zapActorProfileInflightRef.current
    const seenPubkeys = new Set<string>()
    const pubkeys: string[] = []

    for (const entry of zapActivityLog) {
      for (const rawPubkey of [entry.fromPubkey, entry.toPubkey]) {
        const pubkey = rawPubkey.toLowerCase()
        if (seenPubkeys.has(pubkey)) continue
        seenPubkeys.add(pubkey)
        if (!HEX_PUBKEY_RE.test(pubkey)) continue
        if (sceneState.nodesByPubkey[pubkey]?.label?.trim()) continue
        if (zapActorLabelsByPubkey[pubkey]?.trim()) continue
        if (attemptedPubkeys.has(pubkey) || inflightPubkeys.has(pubkey)) continue

        pubkeys.push(pubkey)
        if (pubkeys.length >= ZAP_ACTOR_PROFILE_BATCH_SIZE) break
      }
      if (pubkeys.length >= ZAP_ACTOR_PROFILE_BATCH_SIZE) break
    }

    if (pubkeys.length === 0) return

    let cancelled = false
    for (const pubkey of pubkeys) {
      attemptedPubkeys.add(pubkey)
      inflightPubkeys.add(pubkey)
    }

    void Promise.all(
      pubkeys.map(async (pubkey) => {
        try {
          const profile = await fetchProfileByPubkey(pubkey)
          return [pubkey, resolveZapActorProfileLabel(profile)] as const
        } catch {
          return [pubkey, null] as const
        } finally {
          inflightPubkeys.delete(pubkey)
        }
      }),
    ).then((results) => {
      if (cancelled) return
      const nextLabels: Record<string, string> = {}
      for (const [pubkey, label] of results) {
        if (label) {
          nextLabels[pubkey] = label
        }
      }
      if (Object.keys(nextLabels).length === 0) return
      setZapActorLabelsByPubkey((current) => ({ ...current, ...nextLabels }))
    })

    return () => {
      cancelled = true
    }
  }, [sceneState.nodesByPubkey, zapActivityLog, zapActorLabelsByPubkey])

  const canRunZapFeed = canRunZapFeedForScene({
    showZaps,
    isFixtureMode,
    activeLayer: sceneState.activeLayer,
  })
  const shouldEnableLiveZapFeed = canRunZapFeed && zapFeedMode === 'live'
  const shouldEnableRecentZapReplay =
    canRunZapFeed && zapFeedMode === 'recent'
  const formatReplayWindowLabel = useCallback(
    (hours: number) =>
      locale === 'en'
        ? (hours === 1 ? 'last hour' : `last ${hours} hours`)
        : formatRecentZapReplayWindowLabel(hours),
    [locale],
  )
  const selectedZapReplayWindowLabel = formatReplayWindowLabel(
    recentZapReplayLookbackHours,
  )
  const appliedZapReplayWindowLabel = formatReplayWindowLabel(
    appliedRecentZapReplayLookbackHours,
  )
  const appliedZapReplayWindowText =
    locale === 'en'
      ? appliedZapReplayWindowLabel
      : appliedRecentZapReplayLookbackHours === 1
      ? `la ${appliedZapReplayWindowLabel}`
      : `las ${appliedZapReplayWindowLabel}`
  const handleLiveZap = useCallback((zap: ParsedZap) => {
    const played = handleZap(zap)
    appendZapActivity(zap, 'live', played)
    setLiveZapFeedFeedback(null)
  }, [appendZapActivity, handleZap])
  const handleRecentZapReplay = useCallback((zap: ParsedZap) => {
    const played = handleZap(zap)
    appendZapActivity(zap, 'recent', played)
    return played
  }, [appendZapActivity, handleZap])
  const isRecentZapReplayPlaybackHeld =
    recentZapReplayPlaybackPaused || recentZapReplayScrubProgress !== null
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
    lookbackHours: appliedRecentZapReplayLookbackHours,
    replayKey: recentZapReplayRequest,
    refreshKey: recentZapReplayRefreshRequest,
    playbackPaused: isRecentZapReplayPlaybackHeld,
    seekKey: recentZapReplaySeekRequest.key,
    seekProgress: recentZapReplaySeekRequest.progress,
    onZap: handleRecentZapReplay,
  })
  const recentZapReplayCollection = useMemo(
    () => buildRecentZapReplayCollectionViewModel(recentZapReplay),
    [recentZapReplay],
  )
  const recentZapReplayWorking =
    shouldEnableRecentZapReplay &&
    (recentZapReplay.phase === 'loading' || recentZapReplay.phase === 'playing')
  const recentZapReplayStatusLabel = useMemo(() => {
    if (locale !== 'en') {
      return getZapReplayStatusLabel(recentZapReplay)
    }

    if (recentZapReplay.playbackPaused) {
      return recentZapReplay.stage === 'collecting' || recentZapReplay.stage === 'decoding'
        ? 'Replay paused after collection'
        : 'Replay paused'
    }

    switch (recentZapReplay.stage) {
      case 'collecting':
        return 'Querying relays'
      case 'decoding':
        return 'Closing collection'
      case 'playing':
        return 'Playing timeline'
      case 'done':
        return 'Replay ready'
      case 'error':
        return 'Replay error'
      case 'idle':
      default:
        return 'Replay waiting'
    }
  }, [locale, recentZapReplay])
  const recentZapReplayCollectionProgressValue = formatProgressValue(
    recentZapReplayCollection.progress,
  )
  const recentZapReplayPlaybackProgress =
    recentZapReplay.phase === 'done' ? 1 : recentZapReplay.timelineProgress
  const recentZapReplayPlaybackProgressValue = formatProgressValue(
    recentZapReplayPlaybackProgress,
  )
  const recentZapReplayStatusDetail =
    locale === 'en'
      ? tSigma('zaps.panel.configuredWindow', { window: appliedZapReplayWindowLabel })
      : recentZapReplay.message ?? `Ventana activa: ${appliedZapReplayWindowLabel}.`
  const displayedZapReplayProgress =
    recentZapReplayScrubProgress ?? recentZapReplay.timelineProgress
  const displayedZapReplayCreatedAt =
    recentZapReplayScrubProgress !== null &&
    recentZapReplay.windowStartAt !== null &&
    recentZapReplay.windowEndAt !== null
      ? recentZapReplay.windowStartAt +
        Math.round(
          (recentZapReplay.windowEndAt - recentZapReplay.windowStartAt) *
            recentZapReplayScrubProgress,
        )
      : recentZapReplay.currentZapCreatedAt
  const displayedZapReplayProgressValue = formatProgressValue(displayedZapReplayProgress)
  const recentZapReplayCurrentTimeLabel = formatZapReplayTime(
    displayedZapReplayCreatedAt,
  )
  const recentZapReplayWindowStartLabel = formatZapReplayTime(
    recentZapReplay.windowStartAt,
  )
  const recentZapReplayWindowEndLabel = formatZapReplayTime(
    recentZapReplay.windowEndAt,
  )
  const canSeekRecentZapReplay =
    recentZapReplay.windowStartAt !== null &&
    recentZapReplay.windowEndAt !== null &&
    recentZapReplay.windowEndAt > recentZapReplay.windowStartAt &&
    recentZapReplay.playableCount > 0

  useEffect(() => {
    sigmaHostRef.current?.setZapOverlayPaused(
      shouldEnableRecentZapReplay && isRecentZapReplayPlaybackHeld,
    )
  }, [isRecentZapReplayPlaybackHeld, shouldEnableRecentZapReplay])

  const recentZapReplayTimelineClassName = `sg-zap-replay-timeline__rail${
    recentZapReplayScrubProgress !== null ? ' sg-zap-replay-timeline__rail--scrubbing' : ''
  }`

  const resolveZapReplayPointerProgress = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const bounds = event.currentTarget.getBoundingClientRect()
      if (bounds.width <= 0) {
        return 0
      }
      return clampProgress((event.clientX - bounds.left) / bounds.width)
    },
    [],
  )

  const commitZapReplaySeek = useCallback((progress: number) => {
    const nextProgress = clampProgress(progress)
    setRecentZapReplaySeekRequest((current) => ({
      key: current.key + 1,
      progress: nextProgress,
    }))
    setRecentZapReplayScrubProgress(null)
  }, [])

  const handleZapReplayTimelinePointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!canSeekRecentZapReplay) {
        return
      }

      event.preventDefault()
      const progress = resolveZapReplayPointerProgress(event)
      event.currentTarget.setPointerCapture(event.pointerId)
      setRecentZapReplayScrubProgress(progress)
    },
    [canSeekRecentZapReplay, resolveZapReplayPointerProgress],
  )

  const handleZapReplayTimelinePointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (
        !canSeekRecentZapReplay ||
        !event.currentTarget.hasPointerCapture(event.pointerId)
      ) {
        return
      }

      event.preventDefault()
      setRecentZapReplayScrubProgress(resolveZapReplayPointerProgress(event))
    },
    [canSeekRecentZapReplay, resolveZapReplayPointerProgress],
  )

  const handleZapReplayTimelinePointerUp = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!canSeekRecentZapReplay) {
        setRecentZapReplayScrubProgress(null)
        return
      }

      event.preventDefault()
      const progress = resolveZapReplayPointerProgress(event)
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
      commitZapReplaySeek(progress)
    },
    [canSeekRecentZapReplay, commitZapReplaySeek, resolveZapReplayPointerProgress],
  )

  const handleZapReplayTimelinePointerCancel = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
      setRecentZapReplayScrubProgress(null)
    },
    [],
  )

  const handleZapReplayTimelineKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (!canSeekRecentZapReplay) {
        return
      }

      let nextProgress: number | null = null
      if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
        nextProgress = displayedZapReplayProgress - ZAP_REPLAY_KEYBOARD_SEEK_STEP
      } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
        nextProgress = displayedZapReplayProgress + ZAP_REPLAY_KEYBOARD_SEEK_STEP
      } else if (event.key === 'Home') {
        nextProgress = 0
      } else if (event.key === 'End') {
        nextProgress = 1
      }

      if (nextProgress === null) {
        return
      }

      event.preventDefault()
      commitZapReplaySeek(nextProgress)
    },
    [canSeekRecentZapReplay, commitZapReplaySeek, displayedZapReplayProgress],
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
        ? [
            { id: 'performance' as const, label: tSigma('settingsTabs.performance') },
            { id: 'visuals' as const, label: tSigma('settingsTabs.visuals') },
            { id: 'zaps' as const, label: tSigma('settingsTabs.zaps') },
            { id: 'relays' as const, label: tSigma('settingsTabs.relays') },
            { id: 'dev' as const, label: tSigma('settingsTabs.dev') },
          ]
        : [
            { id: 'performance' as const, label: tSigma('settingsTabs.performance') },
            { id: 'visuals' as const, label: tSigma('settingsTabs.visuals') },
            { id: 'zaps' as const, label: tSigma('settingsTabs.zaps') },
            { id: 'relays' as const, label: tSigma('settingsTabs.relays') },
          ],
    [isDev, isFixtureMode, tSigma],
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
    ? (locale === 'en' ? 'hiding connections' : 'ocultando conexiones')
    : isLowPerformanceForConnections
      ? (locale === 'en' ? 'low performance detected' : 'bajo rendimiento detectado')
      : (locale === 'en' ? 'stable performance' : 'rendimiento estable')
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
        ? `Zap simulado: ${sats} sats ${fromPubkey.slice(0, 8)}â€¦ â†’ ${toPubkey.slice(0, 8)}â€¦`
        : 'No se pudo reproducir el zap simulado.',
    )
  }, [appendZapActivity, findSimulationPair, handleZap])

  const updatePhysicsTuning = useCallback(function updatePhysicsTuning<K extends keyof ForceAtlasPhysicsTuning>(
    key: K, value: ForceAtlasPhysicsTuning[K],
  ) { setPhysicsTuning((current) => ({ ...current, [key]: value })) }, [])
  const handleInitialCameraZoomChange = useCallback((zoom: number) => {
    setInitialCameraZoom(clampInitialCameraZoom(zoom))
  }, [])
  const handleNodeSizeConfigChange = useCallback(
    (config: GraphSceneNodeSizeConfig) => {
      setNodeSizeConfig(normalizeGraphSceneNodeSizeConfig(config))
    },
    [],
  )

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
    setActionFeedback(result?.message ?? 'No habÃ­a override activo para revertir.')
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
      const isChangingRoot = sceneState.rootPubkey !== pubkey
      setLoadFeedback('Cargando root...')
      setIsRootSheetOpen(false)
      setIsRootLoadScreenOpen(true)
      setIsZapsPanelOpen(false)
      setIsRuntimeInspectorOpen(false)
      if (isChangingRoot && !isFixtureMode) {
        setZapFeedMode('live')
        setRecentZapReplayPlaybackPaused(false)
        setRecentZapReplayScrubProgress(null)
        setRecentZapReplayRequest((current) => current + 1)
        setRecentZapReplayRefreshRequest((current) => current + 1)
        setRecentZapReplaySeekRequest((current) => ({
          key: current.key + 1,
          progress: 0,
        }))
        setZapActivityLog([])
        setZapActorLabelsByPubkey({})
        zapActorProfileAttemptedRef.current.clear()
        zapActorProfileInflightRef.current.clear()
        setLiveZapFeedFeedback(null)
        setZapFeedback(null)
        window.setTimeout(() => {
          void clearRecentZapReplayCache()
        }, 0)
      }
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
    [bridge, isFixtureMode, sceneState.rootPubkey, upsertSavedRoot],
  )

  const handleExpandRoot = useCallback(() => {
    const rootPubkey = sceneState.rootPubkey
    if (!rootPubkey || isFixtureMode) return
    startTransition(() => {
      void bridge.expandNode(rootPubkey, { force: true }).then((result) => {
        setActionFeedback(result.message)
      })
    })
  }, [bridge, isFixtureMode, sceneState.rootPubkey])

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
      setLoadFeedback('ElegÃ­ una identidad real para usar el laboratorio drag-local.')
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

  // â”€â”€ Derived values for UI components â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
  // hydrating `currentRootNode` â€” prevents empty avatar / display name on
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
      label: tSigma('filters.all.label'),
      count: deferredScene.render.diagnostics.nodeCount,
      swatch: 'oklch(55% 0.02 230)',
      hint: tSigma('filters.all.hint'),
    },
    {
      id: 'following',
      label: tSigma('filters.following.label'),
      count: null,
      swatch: '#84c7ff',
      hint: tSigma('filters.following.hint'),
    },
    {
      id: 'followers',
      label: tSigma('filters.followers.label'),
      count: null,
      swatch: '#ffb86b',
      hint: tSigma('filters.followers.hint'),
    },
    {
      id: 'mutuals',
      label: tSigma('filters.mutuals.label'),
      count: null,
      swatch: '#5fd39d',
      hint: tSigma('filters.mutuals.hint'),
    },
    {
      id: 'oneway',
      label: tSigma('filters.oneway.label'),
      count: null,
      swatch: 'oklch(60% 0.06 80)',
      hint: tSigma('filters.oneway.hint'),
    },
    {
      id: 'connections',
      label: tSigma('filters.connections.label'),
      count: null,
      caption: tSigma('filters.connections.caption'),
      swatch: 'oklch(76% 0.1 180)',
      hint: tSigma('filters.connections.hint'),
    },
  ], [deferredScene.render.diagnostics.nodeCount, tSigma])

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
    { k: tSigma('hud.nodes'),   v: String(deferredScene.render.diagnostics.nodeCount) },
    { k: tSigma('hud.edges'), v: String(deferredScene.physics.diagnostics.edgeCount) },
    { k: tSigma('hud.visible'), v: String(deferredScene.render.diagnostics.visibleEdgeCount) },
    {
      k: 'FÃ­sica',
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
        : 'â€”',
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
    tSigma,
  ])

  // Rail buttons â€” every entry is a DIRECT action or toggle.
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
      setActionFeedback('El debug runtime de avatares sÃ³lo se descarga en dev.')
      return
    }

    const host = sigmaHostRef.current
    if (!host) {
      setActionFeedback('El grafo todavÃ­a no estÃ¡ listo para debug de avatares.')
      return
    }

    const state = host.getAvatarRuntimeDebugSnapshot({ includeOverlayNodes: true })
    if (!state) {
      setActionFeedback('No hay snapshot runtime de avatares disponible todavÃ­a.')
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
      `Debug de avatares descargado. ${drawnImages}/${withPicture} fotos dibujadas; ${loadCandidates}/${visibleNodes} nodos visibles en cola Ãºtil.`,
    )
  }, [deferredScene.render.nodes, sceneState.nodesByPubkey])

  const railButtons: RailButton[] = useMemo(() => [
    {
      id: 'settings',
      tip: isSettingsOpen ? tSigma('rail.closeSettings') : tSigma('rail.settings'),
      icon: <GearIcon />,
      active: isSettingsOpen,
      onClick: handleOpenSettings,
    },
    {
      id: 'notifications',
      tip: isNotificationsOpen
        ? tSigma('rail.closeNotifications')
        : tSigma('rail.notifications', { count: notificationHistory.length }),
      icon: <BellIcon />,
      active: isNotificationsOpen,
      badge: notificationHistory.length,
      onClick: handleOpenNotifications,
    },
    ...(canUseRuntimeInspector
      ? [{
          id: 'runtime',
          tip: isRuntimeInspectorOpen
            ? tSigma('rail.closeRuntime')
            : tSigma('rail.runtime'),
          icon: <PulseIcon />,
          active: isRuntimeInspectorOpen,
          onClick: handleOpenRuntimeInspector,
        } satisfies RailButton]
      : []),
    {
      id: 'physics',
      tip: physicsEnabled ? 'Pausar fÃ­sica' : 'Reanudar fÃ­sica',
      icon: <AtomIcon />,
      active: physicsEnabled,
      pressed: physicsEnabled,
      onClick: handleTogglePhysics,
    },
    {
      id: 'zaps',
      tip: recentZapReplayWorking
        ? `${recentZapReplayStatusLabel}: sigue trabajando`
        : isZapsPanelOpen
          ? tSigma('rail.closeZaps')
          : tSigma('rail.zaps'),
      icon: <ZapIcon />,
      active: isZapsPanelOpen,
      attention: recentZapReplayWorking,
      onClick: handleOpenZapsPanel,
      dividerAfter: true,
    },
    {
      id: 'recenter',
      tip: tSigma('rail.view'),
      icon: <TargetIcon />,
      onClick: handleFitView,
    },
    {
      id: 'stale',
      tip: relayState.isGraphStale ? tSigma('rail.relaysRevert') : tSigma('rail.relaysCurrent'),
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
    recentZapReplayStatusLabel,
    recentZapReplayWorking,
    relayState.isGraphStale,
    tSigma,
  ])

  const mobileNavButtons: MobileNavButton[] = useMemo(() => [
    {
      id: 'filters',
      label: tSigma('rail.filters'),
      tip: mobileUtilityPanel === 'filters'
        ? tSigma('rail.closeFilters')
        : tSigma('rail.filters'),
      icon: <FilterIcon />,
      active: mobileUtilityPanel === 'filters',
      onClick: () => handleOpenMobileUtilityPanel('filters', 'mid'),
    },
    {
      id: 'zaps',
      label: tSigma('rail.zaps'),
      tip: recentZapReplayWorking
        ? `${recentZapReplayStatusLabel}: sigue trabajando`
        : isZapsPanelOpen
          ? tSigma('rail.closeZaps')
          : tSigma('rail.liveZaps'),
      icon: <ZapIcon />,
      active: isZapsPanelOpen,
      badge: zapActivityLog.length,
      attention: recentZapReplayWorking,
      onClick: handleOpenZapsPanel,
    },
    ...(canUseRuntimeInspector
      ? [{
          id: 'runtime',
          label: tSigma('rail.runtimeShort'),
          tip: isRuntimeInspectorOpen
            ? tSigma('rail.closeRuntime')
            : tSigma('rail.runtimeShort'),
          icon: <PulseIcon />,
          active: isRuntimeInspectorOpen,
          onClick: handleOpenRuntimeInspector,
        } satisfies MobileNavButton]
      : []),
    {
      id: 'view',
      label: tSigma('rail.viewShort'),
      tip: tSigma('rail.view'),
      icon: <TargetIcon />,
      onClick: handleFitView,
    },
    {
      id: 'settings',
      label: tSigma('rail.settings'),
      tip: isSettingsOpen ? tSigma('rail.closeSettings') : tSigma('rail.settings'),
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
    recentZapReplayStatusLabel,
    recentZapReplayWorking,
    tSigma,
    zapActivityLog.length,
  ])

  // Toasts â€” combine feedback sources
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

  // â”€â”€ Settings panel content â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
            mobileDegradedMode={renderConfig.mobileDegradedMode ?? false}
            isMobileViewport={isMobileViewport}
            lowPerformanceConnectionStatusLabel={lowPerformanceConnectionStatusLabel}
            maxNodes={runtimeInspectorStoreSnapshot.maxNodes}
            nodeCount={runtimeInspectorStoreSnapshot.nodeCount}
            onAvatarRuntimeOptionsChange={setAvatarRuntimeOptions}
            onClearSiteCache={handleClearSiteCache}
            onGraphMaxNodesChange={setGraphMaxNodes}
            onToggleMobileDegradedMode={() => setRenderConfig({ mobileDegradedMode: !renderConfig.mobileDegradedMode })}
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
            rootPubkey={sceneState.rootPubkey}
            rootLoadStatus={rootLoadStatus}
            onExpandRoot={handleExpandRoot}
          />
        )
      case 'visuals':
        return (
          <VisualOptionsPanel
            avatarRuntimeOptions={avatarRuntimeOptions}
            initialCameraZoom={initialCameraZoom}
            nodeSizeConfig={nodeSizeConfig}
            onAvatarRuntimeOptionsChange={setAvatarRuntimeOptions}
            onInitialCameraZoomChange={handleInitialCameraZoomChange}
            onNodeSizeConfigChange={handleNodeSizeConfigChange}
            onToggleVisibleEdgeCountLabels={() => {
              setShowVisibleEdgeCountLabels((current) => !current)
            }}
            showVisibleEdgeCountLabels={showVisibleEdgeCountLabels}
          />
        )
      case 'zaps':
        return renderZapSettingsContent()
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
              <h4>{tSigma('settings.relays.state')}</h4>
              <div className="sg-setting-row">
                <div>
                  <div className="sg-setting-row__lbl">
                    {relayState.isGraphStale ? tSigma('settings.relays.custom') : tSigma('settings.relays.base')}
                  </div>
                  <div className="sg-setting-row__desc">
                    {relayState.isGraphStale ? tSigma('settings.relays.customDesc') : tSigma('settings.relays.baseDesc')}
                  </div>
                </div>
                {relayState.isGraphStale ? (
                  <button
                    className="sg-mini-action"
                    onClick={handleStaleRelays}
                    type="button"
                  >
                    {tSigma('settings.relays.revert')}
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
                <h4>{locale === 'en' ? 'ForceAtlas dev' : 'ForceAtlas dev'}</h4>
                <div className="sg-setting-row">
                  <div>
                    <div className="sg-setting-row__lbl">Auto-freeze</div>
                    <p style={{ fontSize: 10.5, color: 'var(--sg-fg-faint)', margin: '2px 0 0' }}>
                      {locale === 'en'
                        ? 'When disabled, the supervisor ignores convergence and max iterations.'
                        : 'Cuando esta apagado, el supervisor ignora convergencia y max iterations.'}
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
              <h4>{locale === 'en' ? 'Runtime diagnostics' : 'Diagnostico runtime'}</h4>
              {[
                [locale === 'en' ? 'Render topology' : 'Topologia render', String(deferredScene.render.diagnostics.topologySignature)],
                [locale === 'en' ? 'Physics topology' : 'Topologia fisica', String(deferredScene.physics.diagnostics.topologySignature)],
                ['Relays', String(relayState.urls.length)],
                ['Pinned', String(sceneState.pinnedNodePubkeys.size)],
                [
                  'Viewport',
                  isFixtureMode
                    ? (lastViewportRatio ? `${lastViewportRatio.toFixed(2)}x` : 'idle')
                    : (controller.getLastViewport() ? `${controller.getLastViewport()?.ratio.toFixed(2)}x` : 'idle'),
                ],
                [locale === 'en' ? 'Active layer' : 'Capa activa', sceneState.activeLayer],
                [locale === 'en' ? 'Root' : 'Root', sceneState.rootPubkey ? (locale === 'en' ? 'loaded' : 'cargado') : (locale === 'en' ? 'empty' : 'vacio')],
                [
                  locale === 'en' ? 'Network tuning' : 'Tuning de red',
                  `${getKernelNetworkTuning().nodeExpandConnectTimeoutMs}ms conn / ${getKernelNetworkTuning().nodeExpandPageTimeoutMs}ms page / ${getKernelNetworkTuning().nodeExpandHardTimeoutMs}ms max`,
                ],
              ].map(([k, v]) => (
                <div className="sg-diag-row" key={k as string}>
                  <span className="sg-diag-row__k">{k}</span>
                  <span className="sg-diag-row__v">{v}</span>
                </div>
              ))}
            </div>
            {isDev ? (
              <div className="sg-settings-section">
                <h4>{locale === 'en' ? 'Avatar debug' : 'Debug de avatares'}</h4>
                <p style={{ fontSize: 10.5, color: 'var(--sg-fg-faint)', margin: '0 0 10px' }}>
                  {locale === 'en'
                    ? 'Downloads the visible frame, cache state, locks, and recent scheduler events.'
                    : 'Descarga el frame visible, la cache, los bloqueos y los eventos recientes del scheduler.'}
                </p>
                <button
                  className="sg-btn sg-btn--primary"
                  onClick={handleDownloadAvatarRuntimeDebug}
                  style={{ width: '100%' }}
                  type="button"
                >
                  {locale === 'en' ? 'Download avatar debug' : 'Descargar debug de avatares'}
                </button>
              </div>
            ) : null}
            {isDev ? (
              <div className="sg-settings-section">
                <h4>{locale === 'en' ? 'Zaps dev' : 'Zaps dev'}</h4>
                <button
                  className={`sg-btn${!simulationPair ? ' ' : ' sg-btn--primary'}`}
                  disabled={!simulationPair}
                  onClick={handleSimulateZap}
                  style={{ width: '100%' }}
                  type="button"
                >
                  {simulationPair
                    ? (locale === 'en' ? 'Simulate zap' : 'Simular zap')
                    : (locale === 'en' ? 'No connected pair available' : 'Sin pares conectados')}
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

  // Detail panel content

  const renderZapSettingsContent = () => (
    <div>
      <div className="sg-settings-section">
        <h4>{tSigma('zaps.settings.visualization')}</h4>
        <div className="sg-setting-row">
          <div>
            <div className="sg-setting-row__lbl">{tSigma('zaps.settings.showInGraph')}</div>
            <div className="sg-setting-row__desc">
              {tSigma('zaps.settings.showInGraphDesc')}
            </div>
          </div>
          <button
            aria-pressed={showZaps}
            className={`sg-toggle${showZaps ? ' sg-toggle--on' : ''}`}
            onClick={handleToggleZaps}
            title={showZaps ? tSigma('zaps.settings.hideZaps') : tSigma('zaps.settings.showZaps')}
            type="button"
          />
        </div>
      </div>

      <div className="sg-settings-section">
        <h4>{tSigma('zaps.settings.operationalProtection')}</h4>
        <div className="sg-setting-row">
          <div>
            <div className="sg-setting-row__lbl">{tSigma('zaps.settings.pauseLargeScenes')}</div>
            <div className="sg-setting-row__desc">
              {tSigma('zaps.settings.pauseLargeScenesDesc', { limit: MAX_ZAP_FILTER_PUBKEYS })}
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
                ? tSigma('zaps.settings.disableLargeSceneLimit')
                : tSigma('zaps.settings.enableLargeSceneLimit')
            }
            type="button"
          />
        </div>
      </div>

    </div>
  )

  const getZapActorLabel = (pubkey: string) => {
    const normalizedPubkey = pubkey.toLowerCase()
    const node = sceneState.nodesByPubkey[normalizedPubkey]
    const label = node?.label?.trim()
    const zapActorLabel = zapActorLabelsByPubkey[normalizedPubkey]?.trim()
    return label || zapActorLabel || `${pubkey.slice(0, 8)}...`
  }

  const zapFeedStatus = shouldEnableLiveZapFeed
    ? 'Live'
    : zapFeedMode === 'recent'
      ? selectedZapReplayWindowLabel
      : tSigma('zaps.panel.statusPaused')
  const recentZapReplayCollectionClassName = `sg-zap-replay-collection sg-zap-replay-collection--${recentZapReplayCollection.status}${
    recentZapReplayCollection.isIndeterminate ? ' sg-zap-replay-collection--waiting' : ''
  }`
  const canControlRecentZapReplay =
    zapFeedMode === 'recent' && shouldEnableRecentZapReplay
  const canToggleRecentZapReplayPlayback =
    canControlRecentZapReplay &&
    (recentZapReplay.phase === 'loading' ||
      recentZapReplay.phase === 'playing' ||
      recentZapReplay.playableCount > 0)
  const recentZapReplayPlaybackIsPaused =
    recentZapReplayPlaybackPaused || recentZapReplay.playbackPaused
  const recentZapReplayPlayButtonLabel = recentZapReplayPlaybackIsPaused
    ? tSigma('zaps.panel.resumeReplay')
    : tSigma('zaps.panel.pauseReplay')

  const renderZapsContent = () => (
    <div className="sg-zap-feed">
      <div className="sg-zap-feed__head">
        <div className="sg-zap-feed__summary">
          <span className="sg-section-label">{tSigma('zaps.panel.visible')}</span>
          <strong>{zapActivityLog.length} zap{zapActivityLog.length === 1 ? '' : 's'}</strong>
        </div>
        <div className="sg-zap-feed__actions">
          <span
            className={`sg-zap-feed__status${shouldEnableLiveZapFeed ? ' sg-zap-feed__status--live' : ''}${recentZapReplayWorking ? ' sg-zap-feed__status--working' : ''}`}
          >
            {zapFeedStatus}
          </span>
        </div>
      </div>

      <div className="sg-zap-console">
        <div className="sg-zap-console__mode" role="group" aria-label={tSigma('zaps.panel.modeAria')}>
          <button
            aria-pressed={zapFeedMode === 'live'}
            className={`sg-zap-console__mode-btn${zapFeedMode === 'live' ? ' sg-zap-console__mode-btn--active' : ''}`}
            onClick={() => {
              setZapFeedMode('live')
              setRecentZapReplayPlaybackPaused(false)
            }}
            type="button"
          >
            Live
          </button>
          <button
            aria-pressed={zapFeedMode === 'recent'}
            className={`sg-zap-console__mode-btn${zapFeedMode === 'recent' ? ' sg-zap-console__mode-btn--active' : ''}`}
            onClick={() => {
              setZapFeedMode('recent')
              setRecentZapReplayPlaybackPaused(false)
            }}
            type="button"
          >
            Replay
          </button>
        </div>
      </div>

      {zapFeedMode === 'recent' ? (
        <div
          aria-live={recentZapReplayWorking ? 'polite' : 'off'}
          className={`sg-zap-replay-console${recentZapReplayWorking ? ' sg-zap-replay-console--working' : ''}`}
        >
          <div className="sg-zap-replay-console__head">
            <span className="sg-zap-replay-console__dot" aria-hidden="true" />
            <div>
              <strong>{recentZapReplayStatusLabel}</strong>
              <span>
                {recentZapReplayWorking
                  ? tSigma('zaps.panel.keepWorking')
                  : tSigma('zaps.panel.configuredWindow', { window: appliedZapReplayWindowText })}
              </span>
            </div>
            <span className="sg-zap-replay-console__percent">
              {recentZapReplayPlaybackProgressValue}%
            </span>
          </div>

          <div className="sg-zap-replay-window">
            <div className="sg-slider-row__head">
              <span className="sg-slider-row__lbl">{tSigma('zaps.panel.historicalWindow')}</span>
              <span className="sg-slider-row__val">{selectedZapReplayWindowLabel}</span>
            </div>
            <input
              aria-label={tSigma('zaps.panel.recentHoursAria')}
              className="sg-slider"
              max={RECENT_ZAP_REPLAY_MAX_LOOKBACK_HOURS}
              min={RECENT_ZAP_REPLAY_MIN_LOOKBACK_HOURS}
              onChange={(event) => {
                setRecentZapReplayLookbackHours(
                  clampRecentZapReplayLookbackHours(
                    Number.parseInt(event.target.value, 10),
                  ),
                )
              }}
              step={1}
              type="range"
              value={recentZapReplayLookbackHours}
            />
          </div>

          <div className={recentZapReplayCollectionClassName}>
            <div className="sg-zap-replay-section-head">
              <span>{tSigma('zaps.panel.collection')}</span>
              <span>{recentZapReplayCollectionProgressValue}%</span>
            </div>
            <div
              aria-label={tSigma('zaps.panel.collectionProgressAria')}
              aria-valuemax={100}
              aria-valuemin={0}
              aria-valuenow={recentZapReplayCollectionProgressValue}
              className="sg-zap-replay-collection__bar"
              role="progressbar"
            >
              <span style={{ width: `${recentZapReplayCollectionProgressValue}%` }} />
            </div>
            <dl className="sg-zap-replay-metrics">
              <div>
                <dt>{tSigma('zaps.panel.targets')}</dt>
                <dd>{formatInteger(recentZapReplay.targetCount)}</dd>
              </div>
              <div>
                <dt>{tSigma('zaps.panel.batches')}</dt>
                <dd>
                  {formatInteger(recentZapReplay.completedBatchCount)}/{formatInteger(recentZapReplay.batchCount)}
                </dd>
              </div>
              <div>
                <dt>{tSigma('zaps.panel.cache')}</dt>
                <dd>{formatInteger(recentZapReplay.cachedCount)}</dd>
              </div>
              <div>
                <dt>{tSigma('zaps.panel.new')}</dt>
                <dd>{formatInteger(recentZapReplay.fetchedCount)}</dd>
              </div>
              <div>
                <dt>{tSigma('zaps.panel.timeouts')}</dt>
                <dd>{formatInteger(recentZapReplay.timedOutBatchCount)}</dd>
              </div>
              <div>
                <dt>{tSigma('zaps.panel.limit')}</dt>
                <dd>
                  {recentZapReplay.truncatedTargetCount > 0
                    ? tSigma('zaps.panel.omitted', { count: formatInteger(recentZapReplay.truncatedTargetCount) })
                    : tSigma('zaps.panel.ok')}
                </dd>
              </div>
            </dl>
          </div>

          <div className="sg-zap-replay-playback">
            <div className="sg-zap-replay-section-head">
              <span>{tSigma('zaps.panel.playback')}</span>
              <span>
                {tSigma('zaps.panel.playbackSummary', {
                  visible: formatInteger(recentZapReplay.playedCount),
                  dropped: formatInteger(recentZapReplay.droppedCount),
                })}
              </span>
            </div>
            <div className="sg-zap-replay-controls">
              <button
                aria-label={recentZapReplayPlayButtonLabel}
                className="sg-zap-replay-transport"
                disabled={!canToggleRecentZapReplayPlayback}
                onClick={() => {
                  setRecentZapReplayPlaybackPaused((current) => !current)
                }}
                title={recentZapReplayPlayButtonLabel}
                type="button"
              >
                {recentZapReplayPlaybackIsPaused ? <PlayIcon /> : <PauseIcon />}
                <span>{recentZapReplayPlaybackIsPaused ? tSigma('zaps.panel.play') : tSigma('zaps.panel.pause')}</span>
              </button>
              <button
                className="sg-mini-action"
                disabled={!canControlRecentZapReplay || recentZapReplay.phase === 'loading'}
                onClick={() => {
                  setRecentZapReplayPlaybackPaused(false)
                  setRecentZapReplayRequest((current) => current + 1)
                }}
                type="button"
              >
                {tSigma('zaps.panel.replayCache')}
              </button>
              <button
                className="sg-mini-action"
                disabled={!canControlRecentZapReplay || recentZapReplay.phase === 'loading'}
                onClick={() => {
                  setRecentZapReplayPlaybackPaused(false)
                  setRecentZapReplayRefreshRequest((current) => current + 1)
                }}
                type="button"
              >
                {tSigma('zaps.panel.refresh')}
              </button>
            </div>

            <div className="sg-zap-replay-timeline">
              <div className="sg-zap-replay-timeline__head">
                <span>{tSigma('zaps.panel.timeline')}</span>
                <span>{displayedZapReplayProgressValue}% - {recentZapReplayCurrentTimeLabel}</span>
              </div>
              <div
                aria-disabled={!canSeekRecentZapReplay}
                aria-label={tSigma('zaps.panel.moveReplay', { window: appliedZapReplayWindowText })}
                aria-valuemax={100}
                aria-valuemin={0}
                aria-valuenow={displayedZapReplayProgressValue}
                className={recentZapReplayTimelineClassName}
                onKeyDown={handleZapReplayTimelineKeyDown}
                onLostPointerCapture={handleZapReplayTimelinePointerCancel}
                onPointerCancel={handleZapReplayTimelinePointerCancel}
                onPointerDown={handleZapReplayTimelinePointerDown}
                onPointerMove={handleZapReplayTimelinePointerMove}
                onPointerUp={handleZapReplayTimelinePointerUp}
                role="slider"
                tabIndex={canSeekRecentZapReplay ? 0 : -1}
              >
                <span className="sg-zap-replay-timeline__tick sg-zap-replay-timeline__tick--start" />
                <span className="sg-zap-replay-timeline__tick sg-zap-replay-timeline__tick--end" />
                <span
                  className="sg-zap-replay-timeline__fill"
                  style={{
                    width: formatProgressPercent(displayedZapReplayProgress),
                  }}
                />
                <span
                  className="sg-zap-replay-timeline__marker"
                  style={{
                    left: formatProgressPercent(displayedZapReplayProgress),
                  }}
                />
              </div>
              <div className="sg-zap-replay-timeline__labels">
                <span>
                  <strong>{tSigma('zaps.panel.start')}</strong>
                  <time>{recentZapReplayWindowStartLabel}</time>
                </span>
                <span>
                  <strong>{tSigma('zaps.panel.current')}</strong>
                  <time>{recentZapReplayCurrentTimeLabel}</time>
                </span>
                <span>
                  <strong>{tSigma('zaps.panel.end')}</strong>
                  <time>{recentZapReplayWindowEndLabel}</time>
                </span>
              </div>
            </div>
          </div>

          <p className="sg-zap-replay-console__detail">{recentZapReplayStatusDetail}</p>
        </div>
      ) : (
        liveZapFeedFeedback ? (
          <p className="sg-zap-feed__feedback">{liveZapFeedFeedback}</p>
        ) : null
      )}

      {zapActivityLog.length > 0 ? (
        <div className="sg-zap-feed__list">
          {zapActivityLog.map((entry) => (
            <article
              aria-label={tSigma('zaps.panel.replayZap', {
                from: getZapActorLabel(entry.fromPubkey),
                to: getZapActorLabel(entry.toPubkey),
              })}
              className={`sg-zap-feed__item${entry.played ? '' : ' sg-zap-feed__item--dropped'}`}
              key={entry.id}
              onClick={() => handleReplayZapActivity(entry)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                handleReplayZapActivity(entry)
              }}
              role="button"
              tabIndex={0}
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
                {entry.played ? tSigma('zaps.panel.shownInGraph') : tSigma('zaps.panel.outsideView')}
              </span>
            </article>
          ))}
        </div>
      ) : (
        <p className="sg-zap-feed__empty">
          {tSigma('zaps.panel.empty')}
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
        <span className="sg-section-label">{tSigma('filtersPanel.title')}</span>
        <p>{tSigma('filtersPanel.description')}</p>
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
    const relBadge = isRootNode ? tSigma('detail.rootIdentity') :
      (detail.mutualCount > 0) ? tSigma('detail.mutual') :
      detail.followingCount > 0 ? tSigma('detail.following') :
      detail.followerCount > 0 ? tSigma('detail.follower') : tSigma('detail.oneWay')

    const relBadgeClass = isRootNode ? 'sg-badge--accent' :
      (detail.mutualCount > 0) ? 'sg-badge--ok' :
      detail.followingCount > 0 ? 'sg-badge--accent' :
      detail.followerCount > 0 ? '' : 'sg-badge--warn'

    const detailNpub = encodePubkeyAsNpub(detail.pubkey)
    const primalProfileUrl = detailNpub ? `https://primal.net/p/${detailNpub}` : null
    const jumbleProfileUrl = detailNpub ? `https://jumble.social/users/${detailNpub}` : null
    const pinActionLabel = detail.isPinned ? tSigma('detail.unpin') : tSigma('detail.pin')
    const expansionState = detail.node.nodeExpansionState
    const isExpansionLoading = expansionState?.status === 'loading'
    const exploreActionLabel = detail.isExpanded
      ? tSigma('detail.connectionsExplored')
      : isExpansionLoading
        ? tSigma('detail.expanding')
        : tSigma('detail.exploreConnections')
    const expansionStatusLabels = locale === 'en'
      ? {
          idle: 'not expanded',
          loading: 'loading',
          ready: 'ready',
          partial: 'partial',
          empty: 'no new connections',
          error: 'error',
        }
      : NODE_EXPANSION_STATUS_LABELS
    const expansionStatusLabel = expansionState
      ? expansionStatusLabels[expansionState.status]
      : expansionStatusLabels.idle
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
        ? tSigma('detail.loadingProfile')
        : detail.displayName
    const bioCopy = detail.about?.trim()
      ? detail.about.trim()
      : isProfileLoading
        ? tSigma('detail.loadingProfileBio')
        : tSigma('detail.noBio')

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
              <div className="sg-node-hero__pin">?</div>
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
              {detail.isExpanded && <span className="sg-badge">{tSigma('detail.connectionsExplored')}</span>}
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
              <span>{detail.isPinned ? tSigma('detail.pinned') : tSigma('detail.pinAction')}</span>
            </button>
          ) : null}
        </div>

        {shouldShowIdentityHelp ? (
          <div className="sg-identity-help">
            <p>{tSigma('detail.identityHelp')}</p>
            <button
              className="sg-btn"
              onClick={dismissIdentityHelp}
              type="button"
            >
              {tSigma('detail.understood')}
            </button>
          </div>
        ) : null}

        <p className={`sg-bio${detail.about?.trim() ? '' : ' sg-bio--empty'}`}>
          {bioCopy}
        </p>

        <div className="sg-metric-grid">
          <div className="sg-metric">
            <div className="sg-metric__k">{tSigma('detail.followingCount')}</div>
            <div className="sg-metric__v">{detail.followingCount}</div>
          </div>
          <div className="sg-metric">
            <div className="sg-metric__k">{tSigma('detail.followersCount')}</div>
            <div className="sg-metric__v">{detail.followerCount}</div>
          </div>
          <div className="sg-metric">
            <div className="sg-metric__k">{tSigma('detail.mutualsCount')}</div>
            <div className="sg-metric__v">{detail.mutualCount}</div>
          </div>
        </div>

        {detail.pubkey && (
          <div className="sg-key-row">
            <span className="sg-key-row__lbl">pubkey</span>
            <span>{detail.pubkey.slice(0, 12)}…{detail.pubkey.slice(-8)}</span>
          </div>
        )}

        <div className="sg-section-label">{tSigma('detail.identitySection')}</div>
        <div className="sg-npub-row">
          <div className="sg-npub-row__body">
            <span className="sg-npub-row__label">npub</span>
            <code className={`sg-npub-row__value${detailNpub ? '' : ' sg-npub-row__value--missing'}`}>
              {detailNpub ?? tSigma('detail.notAvailable')}
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
              title={tSigma('detail.copyNpub')}
              type="button"
            >
              <CopyIcon />
              <span>{tSigma('detail.copy')}</span>
            </button>
            {primalProfileUrl ? (
              <a
                className="sg-mini-action"
                href={primalProfileUrl}
                rel="noopener noreferrer"
                target="_blank"
                title={tSigma('detail.openPrimal')}
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
                title={tSigma('detail.openJumble')}
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
            {detail.nip05?.trim() || (isProfileLoading ? tSigma('detail.loadingInline') : '—')}
          </span>
        </div>
        <div className="sg-field">
          <span className="sg-field__k">lud16</span>
          <span className={`sg-field__v${detail.lud16 ? '' : ' sg-field__v--missing'}`}>
            {detail.lud16?.trim() || (isProfileLoading ? tSigma('detail.loadingInline') : '—')}
          </span>
        </div>
        <div className="sg-field">
          <span className="sg-field__k">{tSigma('detail.expansion')}</span>
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

  // -- Render â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
      {/* Canvas â€” always present, full bleed under all chrome */}
      <SigmaCanvasHost
        avatarImagesEnabled={avatarPhotosEnabled}
        avatarRuntimeOptions={stableAvatarRuntimeOptions}
        callbacks={callbacks}
        dragInfluenceTuning={dragInfluenceTuning}
        enableDebugProbe={isTestMode}
        hideConnectionsForLowPerformance={lowPerformanceConnectionHidingActive}
        hideAvatarsOnMove={stableAvatarRuntimeOptions.hideImagesOnFastNodes}
        initialCameraZoom={initialCameraZoom}
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
        searchPlaceholder={hasRoot ? 'Buscar persona en el grafo' : 'CargÃ¡ una identidad para buscar'}
        searchQuery={personSearchQuery}
        searchTotalNodeCount={deferredScene.render.nodes.length}
        onSearchChange={handleChangePersonSearch}
        onSearchClear={handleClearPersonSearch}
        onSearchFocus={handleFocusPersonSearch}
        onSearchSelect={handleSelectPersonSearchMatch}
        onSearchSubmit={handleSubmitPersonSearch}
      />

      {/* Filter bar + rail + HUD + minimap â€” only when a root is loaded */}
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

      {/* Side panel â€” detail or tools (right), one at a time */}
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
              ? tSigma('panelEyebrow.settings')
              : isZapsPanelOpen
                ? tSigma('panelEyebrow.zaps')
                : isNotificationsOpen
                  ? tSigma('panelEyebrow.notifications')
                  : mobileUtilityPanel === 'filters'
                    ? tSigma('panelEyebrow.filters')
                    : tSigma('panelEyebrow.identity')
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
          onClearCache={handleClearSiteCache}
          isClearingCache={cacheClearStatus === 'running'}
          sessionSlot={
            sessionIdentity.isConnected && sessionIdentity.profile ? (
              <button
                className="sigma-root-session"
                onClick={handleSelectSessionRoot}
                type="button"
              >
                <span className="sigma-root-session__eyebrow">{tSigma('sessionRoot.eyebrow')}</span>
                <span className="sigma-root-session__main">
                  {tSigma('sessionRoot.main')}
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

      {/* Empty state â€” when no root and loader not open */}
      {!hasRoot && !isRootSheetOpen && (
        <SigmaEmptyState onLoadIdentity={() => setIsRootSheetOpen(true)} />
      )}

      {/* Toasts */}
      <SigmaToasts onDismiss={handleToastDismiss} toasts={toastEntries} />
    </main>
  )
}

