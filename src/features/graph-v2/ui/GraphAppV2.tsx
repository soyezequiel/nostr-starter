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
import {
  GRAPH_EVENT_KIND_DESCRIPTIONS,
  GRAPH_EVENT_KIND_LABELS,
  GRAPH_EVENT_KINDS,
  GRAPH_EVENT_KIND_SINGULAR_LABELS,
  type GraphEventActivityLogEntry,
  type GraphEventActivitySource,
  type GraphEventKind,
  type ParsedGraphEvent,
} from '@/features/graph-v2/events/types'
import {
  activityEntryToParsedGraphEvent,
  graphEventToActivityEntry,
} from '@/features/graph-v2/events/eventAdapters'
import { useLiveGraphEventFeed } from '@/features/graph-v2/events/useLiveGraphEventFeed'
import { useRecentGraphEventReplay } from '@/features/graph-v2/events/useRecentGraphEventReplay'
import type {
  RootIdentityResolution,
} from '@/features/graph-runtime/kernel/rootIdentity'
import { getKernelNetworkTuning } from '@/features/graph-runtime/kernel/modules/constants'
import { GraphInteractionController } from '@/features/graph-v2/application/InteractionController'
import { LegacyKernelBridge } from '@/features/graph-v2/bridge/LegacyKernelBridge'
import {
  clampConnectionOpacity,
  CONNECTION_OPACITY_STEP,
  CONNECTION_THICKNESS_SCALE_STEP,
  DEFAULT_CONNECTION_VISUAL_CONFIG,
  MAX_CONNECTION_OPACITY,
  MAX_CONNECTION_THICKNESS_SCALE,
  MIN_CONNECTION_OPACITY,
  MIN_CONNECTION_THICKNESS_SCALE,
  normalizeConnectionVisualConfig,
  type ConnectionColorMode,
  type ConnectionFocusStyle,
  type ConnectionVisualConfig,
} from '@/features/graph-v2/connectionVisualConfig'
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
import {
  buildNodeDetailProjection,
  hasNodeExploredConnections,
} from '@/features/graph-v2/projections/buildNodeDetailProjection'
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
import {
  resolveStoredHudStatsEnabled,
  serializeHudStatsEnabled,
} from '@/features/graph-v2/ui/hudStatsPreference'
import {
  resolveStoredRootLoadChromeEnabled,
  serializeRootLoadChromeEnabled,
} from '@/features/graph-v2/ui/rootLoadChromePreference'
import { getRootLoadChromeVisibility } from '@/features/graph-v2/ui/rootLoadChromeVisibility'
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
import { SigmaOffGraphIdentityPanel } from '@/features/graph-v2/ui/SigmaOffGraphIdentityPanel'
import { SigmaSavedRootsPanel } from '@/features/graph-v2/ui/SigmaSavedRootsPanel'
import { SigmaToasts, type SigmaToast } from '@/features/graph-v2/ui/SigmaToasts'
import { SigmaGraphEventDetailPanel } from '@/features/graph-v2/ui/SigmaGraphEventDetailPanel'
import { SigmaZapDetailPanel } from '@/features/graph-v2/ui/SigmaZapDetailPanel'
import { resolveZapIdentityPanelMode } from '@/features/graph-v2/ui/zapIdentityPanelMode'
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
import SigmaActivityPanelV3, {
  type SigmaActivityPanelV3Entry,
  type SigmaActivityPanelReplayMetric,
} from '@/features/graph-v2/ui/SigmaActivityPanelV3'

const RECENT_ZAP_REPLAY_WINDOW_PRESETS = [
  { hours: 6, label: '6 h' },
  { hours: 24, label: '24 h' },
  { hours: 72, label: '3 d' },
  { hours: 168, label: '7 d' },
]

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
  // Cuando se registro la entrada en la UI (ms epoch).
  createdAt: number
  // Timestamp original del zap (s epoch, segun el recibo NIP-57).
  zapCreatedAt: number
  eventId?: string
  zappedEventId?: string | null
  comment?: string | null
}

interface ZapOffGraphIdentitySelection {
  fallbackLabel: string
  pubkey: string
}

type ActivityPanelEntry =
  | {
      type: 'zap'
      id: string
      source: ZapActivitySource
      fromPubkey: string
      toPubkey: string
      played: boolean
      receivedAt: number
      zap: ZapActivityLogEntry
      graphEvent: null
    }
  | {
      type: 'graph-event'
      id: string
      source: GraphEventActivitySource
      fromPubkey: string
      toPubkey: string
      played: boolean
      receivedAt: number
      zap: null
      graphEvent: GraphEventActivityLogEntry
    }

const INTEGER_FORMATTER = new Intl.NumberFormat('es-AR')
const NOTIFICATION_AUTO_DISMISS_MS = 6500
const NOTIFICATION_HISTORY_LIMIT = 100
const ZAP_ACTIVITY_LIMIT = 80
const GRAPH_EVENT_ACTIVITY_LIMIT = 200
const AUTO_ACTIVITY_NODE_BATCH_SIZE = 4
const AUTO_ACTIVITY_NODE_FLUSH_DELAY_MS = 250
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

const readStoredHudStatsEnabled = () => {
  if (typeof window === 'undefined') {
    return resolveStoredHudStatsEnabled(null)
  }

  try {
    return resolveStoredHudStatsEnabled(window.localStorage.getItem(HUD_STATS_STORAGE_KEY))
  } catch {
    return resolveStoredHudStatsEnabled(null)
  }
}

const readStoredRootLoadChromeEnabled = (storageKey: string) => {
  if (typeof window === 'undefined') {
    return resolveStoredRootLoadChromeEnabled(
      null,
      storageKey === ROOT_LOAD_OVERLAY_ENABLED_STORAGE_KEY,
    )
  }

  try {
    return resolveStoredRootLoadChromeEnabled(
      window.localStorage.getItem(storageKey),
      storageKey === ROOT_LOAD_OVERLAY_ENABLED_STORAGE_KEY,
    )
  } catch {
    return resolveStoredRootLoadChromeEnabled(
      null,
      storageKey === ROOT_LOAD_OVERLAY_ENABLED_STORAGE_KEY,
    )
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
const HUD_STATS_STORAGE_KEY = 'sigma.hudStatsEnabled'
const ROOT_LOAD_OVERLAY_ENABLED_STORAGE_KEY = 'sigma.rootLoadOverlayEnabled'
const ROOT_LOAD_HUD_ENABLED_STORAGE_KEY = 'sigma.rootLoadHudEnabled'
const VISIBLE_EDGE_COUNT_LABELS_STORAGE_KEY = 'sigma.visibleEdgeCountLabels'
const INITIAL_CAMERA_ZOOM_STORAGE_KEY = 'sigma.initialCameraZoom'
const CONNECTION_VISUAL_CONFIG_STORAGE_KEY = 'sigma.connectionVisualConfig'
const LEGACY_CONNECTION_OPACITY_STORAGE_KEY = 'sigma.connectionOpacity'
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

const readStoredConnectionVisualConfig = (): ConnectionVisualConfig => {
  if (typeof window === 'undefined') {
    return DEFAULT_CONNECTION_VISUAL_CONFIG
  }

  try {
    const stored = window.localStorage.getItem(CONNECTION_VISUAL_CONFIG_STORAGE_KEY)
    if (stored !== null) {
      return normalizeConnectionVisualConfig(
        JSON.parse(stored) as Partial<ConnectionVisualConfig>,
      )
    }

    const legacyOpacity = window.localStorage.getItem(
      LEGACY_CONNECTION_OPACITY_STORAGE_KEY,
    )
    if (legacyOpacity !== null) {
      return normalizeConnectionVisualConfig({
        opacity: clampConnectionOpacity(Number.parseFloat(legacyOpacity)),
      })
    }

    return DEFAULT_CONNECTION_VISUAL_CONFIG
  } catch {
    return DEFAULT_CONNECTION_VISUAL_CONFIG
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

const hasUsableZapActorProfile = (profile: NostrProfile | null) =>
  Boolean(
    profile &&
      (
        resolveZapActorProfileLabel(profile) ||
        profile.picture?.trim() ||
        profile.about?.trim() ||
        profile.lud16?.trim()
      ),
  )

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
  connectionVisualConfig,
  initialCameraZoom,
  nodeSizeConfig,
  showVisibleEdgeCountLabels,
  onAvatarRuntimeOptionsChange,
  onConnectionVisualConfigChange,
  onInitialCameraZoomChange,
  onNodeSizeConfigChange,
  onToggleVisibleEdgeCountLabels,
}: {
  avatarRuntimeOptions: AvatarRuntimeOptions
  connectionVisualConfig: ConnectionVisualConfig
  initialCameraZoom: number
  nodeSizeConfig: GraphSceneNodeSizeConfig
  showVisibleEdgeCountLabels: boolean
  onAvatarRuntimeOptionsChange: (options: AvatarRuntimeOptions) => void
  onConnectionVisualConfigChange: (config: ConnectionVisualConfig) => void
  onInitialCameraZoomChange: (zoom: number) => void
  onNodeSizeConfigChange: (config: GraphSceneNodeSizeConfig) => void
  onToggleVisibleEdgeCountLabels: () => void
}) {
  const t = useTranslations('sigma.settings.visuals')
  const connectionColorModes: ConnectionColorMode[] = ['semantic', 'calm', 'mono']
  const connectionFocusStyles: ConnectionFocusStyle[] = ['soft', 'balanced', 'dramatic']

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
        <h4>{t('connections')}</h4>
        <div className="sg-slider-row">
          <div className="sg-slider-row__head">
            <span className="sg-slider-row__lbl">{t('connectionOpacity')}</span>
            <span className="sg-slider-row__val">
              {Math.round(connectionVisualConfig.opacity * 100)}%
            </span>
          </div>
          <p style={{ fontSize: 10.5, color: 'var(--sg-fg-faint)', margin: '2px 0 4px' }}>
            {t('connectionOpacityDesc')}
          </p>
          <input
            className="sg-slider"
            max={MAX_CONNECTION_OPACITY}
            min={MIN_CONNECTION_OPACITY}
            onChange={(event) => {
              onConnectionVisualConfigChange({
                ...connectionVisualConfig,
                opacity: Number.parseFloat(event.target.value),
              })
            }}
            step={CONNECTION_OPACITY_STEP}
            type="range"
            value={connectionVisualConfig.opacity}
          />
        </div>
        <div className="sg-slider-row">
          <div className="sg-slider-row__head">
            <span className="sg-slider-row__lbl">{t('connectionThickness')}</span>
            <span className="sg-slider-row__val">
              {connectionVisualConfig.thicknessScale.toFixed(2)}x
            </span>
          </div>
          <p style={{ fontSize: 10.5, color: 'var(--sg-fg-faint)', margin: '2px 0 4px' }}>
            {t('connectionThicknessDesc')}
          </p>
          <input
            className="sg-slider"
            max={MAX_CONNECTION_THICKNESS_SCALE}
            min={MIN_CONNECTION_THICKNESS_SCALE}
            onChange={(event) => {
              onConnectionVisualConfigChange({
                ...connectionVisualConfig,
                thicknessScale: Number.parseFloat(event.target.value),
              })
            }}
            step={CONNECTION_THICKNESS_SCALE_STEP}
            type="range"
            value={connectionVisualConfig.thicknessScale}
          />
        </div>
        <div className="sg-setting-stack">
          <div className="sg-setting-row__lbl">{t('connectionPalette')}</div>
          <div className="sg-setting-row__desc">{t('connectionPaletteDesc')}</div>
          <div
            aria-label={t('connectionPalette')}
            className="sg-segmented-control sg-segmented-control--triple"
            role="group"
          >
            {connectionColorModes.map((mode) => (
              <button
                className={`sg-segmented-control__btn${connectionVisualConfig.colorMode === mode ? ' sg-segmented-control__btn--active' : ''}`}
                key={mode}
                onClick={() => onConnectionVisualConfigChange({
                  ...connectionVisualConfig,
                  colorMode: mode,
                })}
                type="button"
              >
                {t(`connectionPaletteModes.${mode}`)}
              </button>
            ))}
          </div>
        </div>
        <div className="sg-setting-stack">
          <div className="sg-setting-row__lbl">{t('connectionFocusStyle')}</div>
          <div className="sg-setting-row__desc">{t('connectionFocusStyleDesc')}</div>
          <div
            aria-label={t('connectionFocusStyle')}
            className="sg-segmented-control sg-segmented-control--triple"
            role="group"
          >
            {connectionFocusStyles.map((style) => (
              <button
                className={`sg-segmented-control__btn${connectionVisualConfig.focusStyle === style ? ' sg-segmented-control__btn--active' : ''}`}
                key={style}
                onClick={() => onConnectionVisualConfigChange({
                  ...connectionVisualConfig,
                  focusStyle: style,
                })}
                type="button"
              >
                {t(`connectionFocusStyles.${style}`)}
              </button>
            ))}
          </div>
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
  lowPerformanceConnectionStatusLabel,
  mobileDegradedMode,
  isMobileViewport,
  maxNodes,
  nodeCount,
  hudStatsEnabled,
  runtimeInspectorButtonVisible,
  recommendedMaxNodes,
  rootPubkey,
  rootLoadStatus,
  onClearSiteCache,
  onToggleHudStats,
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
  lowPerformanceConnectionStatusLabel: string
  mobileDegradedMode: boolean
  isMobileViewport: boolean
  maxNodes: number
  nodeCount: number
  hudStatsEnabled: boolean
  runtimeInspectorButtonVisible: boolean
  recommendedMaxNodes: number
  rootPubkey: string | null
  rootLoadStatus: string
  onClearSiteCache: () => void
  onToggleHudStats: () => void
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
            <div className="sg-setting-row__lbl">{t('hudStats')}</div>
            <div className="sg-setting-row__desc">{t('hudStatsDesc')}</div>
          </div>
          <button
            aria-pressed={hudStatsEnabled}
            className={`sg-toggle${hudStatsEnabled ? ' sg-toggle--on' : ''}`}
            onClick={onToggleHudStats}
            title={hudStatsEnabled ? t('hideHudStats') : t('showHudStats')}
            type="button"
          />
        </div>
        <div className="sg-setting-row">
          <div>
            <div className="sg-setting-row__lbl">{t('runtimeInspector')}</div>
            <div className="sg-setting-row__desc">
              {t('runtimeInspectorDesc')}
            </div>
          </div>
          <button
            aria-pressed={runtimeInspectorButtonVisible}
            className={`sg-toggle${runtimeInspectorButtonVisible ? ' sg-toggle--on' : ''}`}
            onClick={onToggleRuntimeInspectorButton}
            title={
              runtimeInspectorButtonVisible
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
  rootLoadHudEnabled: boolean
  rootLoadOverlayEnabled: boolean
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
  rootLoadHudEnabled,
  rootLoadOverlayEnabled,
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
  const visibility = getRootLoadChromeVisibility({
    hasRoot,
    isRootLoadScreenOpen,
    isRootSheetOpen,
    rootLoad,
    rootPubkey,
    sceneNodeCount,
    rootLoadHudEnabled,
  })

  if (!visibility.showOverlay && !visibility.showHud) {
    return null
  }

  return (
    <>
      {visibility.showOverlay ? (
        <SigmaLoadingOverlay
          identityLabel={identityLabel}
          message={visibleLoadFeedback}
          nodeCount={displayNodeCount}
          relayState={relayState}
          rootLoad={rootLoad}
          showProgressBar={rootLoadOverlayEnabled}
        />
      ) : null}
      {visibility.showHud ? (
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
  displayNodeCount: number
  fallbackMessage: string | null
  identityLabel?: string | null
  nodeDrawProgress?: SearchNodeDrawProgress | null
  nodeExpansionLoadProgress?: SearchLoadProgress | null
  rootLoadOverride?: RootLoadState | null
}

const SigmaTopBarRootLoadBridge = memo(function SigmaTopBarRootLoadBridge({
  nodeDrawProgress = null,
  nodeExpansionLoadProgress = null,
  ...topBarProps
}: SigmaTopBarRootLoadBridgeProps) {
  const baseSearchLoadProgress = nodeExpansionLoadProgress
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
  const loadingT = useTranslations('sigma.loading')
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
  const liveRootLoad = useSyncExternalStore(
    bridge.subscribeUi,
    () => bridge.getUiState().rootLoad,
    () => bridge.getUiState().rootLoad,
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
  const [connectionVisualConfig, setConnectionVisualConfig] = useState(
    readStoredConnectionVisualConfig,
  )
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
  const [isActivitiesPanelOpen, setIsActivitiesPanelOpen] = useState(false)
  const [selectedZapDetailId, setSelectedZapDetailId] = useState<string | null>(null)
  const [selectedGraphEventDetailId, setSelectedGraphEventDetailId] =
    useState<string | null>(null)
  const [selectedZapOffGraphIdentity, setSelectedZapOffGraphIdentity] =
    useState<ZapOffGraphIdentitySelection | null>(null)
  // Refs para que el handler de Escape (declarado mas arriba en el archivo)
  // pueda acceder al estado del nodo seleccionado y al clearer sin romper TDZ.
  const detailNodeRef = useRef<unknown>(null)
  const clearSelectedNodeRef = useRef<(() => void) | null>(null)
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
  const [rootLoadOverlayEnabled, setRootLoadOverlayEnabled] = useState(() =>
    readStoredRootLoadChromeEnabled(ROOT_LOAD_OVERLAY_ENABLED_STORAGE_KEY),
  )
  const [rootLoadHudEnabled, setRootLoadHudEnabled] = useState(() =>
    readStoredRootLoadChromeEnabled(ROOT_LOAD_HUD_ENABLED_STORAGE_KEY),
  )
  const [hudStatsEnabled, setHudStatsEnabled] = useState(() =>
    readStoredHudStatsEnabled(),
  )
  const [runtimeInspectorButtonEnabled, setRuntimeInspectorButtonEnabled] =
    useState(() => isDev || readStoredRuntimeInspectorButtonEnabled())
  const [showVisibleEdgeCountLabels, setShowVisibleEdgeCountLabels] = useState(
    readStoredVisibleEdgeCountLabelsEnabled,
  )
  const eventToggles = useAppStore((state) => state.eventToggles)
  const setEventToggle = useAppStore((state) => state.setEventToggle)
  const persistedEventFeedMode = useAppStore((state) => state.eventFeedMode)
  const setPersistedEventFeedMode = useAppStore(
    (state) => state.setEventFeedMode,
  )
  const showZaps = eventToggles.zap
  const zapFeedMode: ZapFeedMode = persistedEventFeedMode
  const setZapFeedMode = useCallback(
    (mode: ZapFeedMode) => {
      setPersistedEventFeedMode(mode)
    },
    [setPersistedEventFeedMode],
  )
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
  const pauseLiveZapsWhenSceneIsLarge = useAppStore(
    (state) => state.pauseLiveEventsWhenSceneIsLarge,
  )
  const setPauseLiveEventsWhenSceneIsLarge = useAppStore(
    (state) => state.setPauseLiveEventsWhenSceneIsLarge,
  )
  const autoAddExternalActivityNodes = useAppStore(
    (state) => state.autoAddExternalActivityNodes,
  )
  const setAutoAddExternalActivityNodes = useAppStore(
    (state) => state.setAutoAddExternalActivityNodes,
  )
  const canAutoAddExternalActivityNodes = isDev && autoAddExternalActivityNodes
  const setPauseLiveZapsWhenSceneIsLarge = useCallback(
    (updater: boolean | ((current: boolean) => boolean)) => {
      const next =
        typeof updater === 'function'
          ? updater(pauseLiveZapsWhenSceneIsLarge)
          : updater
      setPauseLiveEventsWhenSceneIsLarge(next)
    },
    [pauseLiveZapsWhenSceneIsLarge, setPauseLiveEventsWhenSceneIsLarge],
  )
  const enabledGraphEventKinds = useMemo(
    () => GRAPH_EVENT_KINDS.filter((kind) => eventToggles[kind]),
    [eventToggles],
  )
  const enabledNonZapGraphEventKinds = useMemo(
    () =>
      enabledGraphEventKinds.filter(
        (kind): kind is Exclude<GraphEventKind, 'zap'> => kind !== 'zap',
      ),
    [enabledGraphEventKinds],
  )
  const [zapActivityLog, setZapActivityLog] = useState<ZapActivityLogEntry[]>([])
  const [graphEventActivityLog, setGraphEventActivityLog] = useState<
    GraphEventActivityLogEntry[]
  >([])
  const [zapActorLabelsByPubkey, setZapActorLabelsByPubkey] =
    useState<Record<string, string>>({})
  const zapActivitySequenceRef = useRef(0)
  const activityRootPubkeyRef = useRef<string | null>(null)
  const zapActorProfileAttemptedRef = useRef(new Set<string>())
  const zapActorProfileInflightRef = useRef(new Set<string>())
  const autoActivityNodePendingRef = useRef(new Map<string, Set<string>>())
  const autoActivityNodeInflightRef = useRef(new Set<string>())
  const autoActivityPairAttemptedRef = useRef(new Set<string>())
  const autoActivityNodeFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
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
    try {
      window.localStorage.setItem(
        ROOT_LOAD_OVERLAY_ENABLED_STORAGE_KEY,
        serializeRootLoadChromeEnabled(rootLoadOverlayEnabled),
      )
    } catch {
      // Persistence is best-effort; the root load overlay toggle still works.
    }
  }, [rootLoadOverlayEnabled])

  useEffect(() => {
    try {
      window.localStorage.setItem(
        ROOT_LOAD_HUD_ENABLED_STORAGE_KEY,
        serializeRootLoadChromeEnabled(rootLoadHudEnabled),
      )
    } catch {
      // Persistence is best-effort; the root load HUD toggle still works.
    }
  }, [rootLoadHudEnabled])

  useEffect(() => {
    try {
      window.localStorage.setItem(
        HUD_STATS_STORAGE_KEY,
        serializeHudStatsEnabled(hudStatsEnabled),
      )
    } catch {
      // Persistence is best-effort; the HUD toggle still works.
    }
  }, [hudStatsEnabled])

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
        CONNECTION_VISUAL_CONFIG_STORAGE_KEY,
        JSON.stringify(connectionVisualConfig),
      )
    } catch {
      // Non-critical preference persistence.
    }
  }, [connectionVisualConfig])

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
  const rootLoad = fixtureUiState?.rootLoad ?? liveRootLoad
  const rootLoadStatus = rootLoad.status
  const controller = useMemo(() => new GraphInteractionController(bridge), [bridge])
  const rootLoadProgressCopy = useMemo(
    () => buildRootLoadProgressCopy({ locale, t: loadingT }),
    [loadingT, locale],
  )

  useEffect(() => {
    if (sceneState.rootPubkey && !isFixtureMode) {
      setIsRootSheetOpen(false)
    }
  }, [sceneState.rootPubkey, isFixtureMode])

  const runtimeInspectorButtonVisible = runtimeInspectorButtonEnabled
  const canUseRuntimeInspector = isDev || runtimeInspectorButtonVisible

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
        if (isActivitiesPanelOpen) {
          if (detailNodeRef.current) {
            clearSelectedNodeRef.current?.()
            return
          }
          if (selectedZapOffGraphIdentity) {
            setSelectedZapOffGraphIdentity(null)
            return
          }
          if (selectedZapDetailId) {
            setSelectedZapDetailId(null)
            return
          }
          if (selectedGraphEventDetailId) {
            setSelectedGraphEventDetailId(null)
            return
          }
          setIsActivitiesPanelOpen(false)
          return
        }
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
        setIsActivitiesPanelOpen(false)
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
          setIsActivitiesPanelOpen(false)
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
  }, [canUseRuntimeInspector, mobileUtilityPanel, sceneState.rootPubkey, isNotificationsOpen, isPersonSearchOpen, isRootSheetOpen, isRuntimeInspectorOpen, isSettingsOpen, isActivitiesPanelOpen, selectedGraphEventDetailId, selectedZapDetailId, selectedZapOffGraphIdentity])

  const closeCompetingSidePanels = useCallback(() => {
    setIsRootSheetOpen(false)
    setIsPersonSearchOpen(false)
    setIsSettingsOpen(false)
    setIsActivitiesPanelOpen(false)
    setIsNotificationsOpen(false)
    setIsRuntimeInspectorOpen(false)
    setMobileUtilityPanel(null)
  }, [])

  const latestNodesByPubkeyRef = useRef(sceneState.nodesByPubkey)
  latestNodesByPubkeyRef.current = sceneState.nodesByPubkey

  const dismissIdentityHelp = useCallback(() => {
    setIsIdentityHelpDismissed(true)
    if (typeof window === 'undefined') return
    window.sessionStorage.setItem(IDENTITY_FIRST_RUN_HELP_KEY, '1')
  }, [])

  const handleExploreConnections = useCallback((pubkey: string, hasExploredConnections: boolean) => {
    dismissIdentityHelp()
    if (hasExploredConnections) return

    if (!isFixtureMode) {
      const isMobileViewport = isMobileGraphViewport()
      if (isMobileViewport) {
        setMobilePanelSnap('peek')
        pendingExpansionAutoFitRef.current = null
      }
      if (
        shouldScheduleExpansionAutoFit({
          isExpanded: hasExploredConnections,
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
                hasNodeExploredConnections(latestNodesByPubkeyRef.current[pubkey] ?? null),
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
                hasNodeExploredConnections(latestNodesByPubkeyRef.current[pubkey] ?? null),
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
  const deferredRootLoadingRing = useMemo(() => {
    const rootPubkey = deferredSceneState.rootPubkey
    if (!rootPubkey || !isRootLoadProgressActive(rootLoad)) {
      return null
    }

    const rootNode = deferredSceneState.nodesByPubkey[rootPubkey]
    if (!rootNode || rootNode.nodeExpansionState?.status === 'loading') {
      return null
    }

    const progress = buildRootLoadProgressViewModel({
      copy: rootLoadProgressCopy,
      rootLoad,
      identityLabel: rootNode.label?.trim() || rootPubkey.slice(0, 10),
      nodeCount: Object.keys(deferredSceneState.nodesByPubkey).length,
      fallbackMessage: loadFeedback,
    })

    return {
      pubkey: rootPubkey,
      progress: progress.percent / 100,
    }
  }, [deferredSceneState, loadFeedback, rootLoad, rootLoadProgressCopy])
  const deferredRootLoadingRingSignature = deferredRootLoadingRing
    ? `${deferredRootLoadingRing.pubkey}|${deferredRootLoadingRing.progress.toFixed(4)}`
    : 'none'
  const nodeSizeConfigSignature = useMemo(
    () => getGraphSceneNodeSizeConfigSignature(nodeSizeConfig),
    [nodeSizeConfig],
  )
  const deferredScene = useMemo(
    () =>
      buildGraphSceneSnapshot(deferredSceneState, {
        nodeSizeConfig,
        rootLoadingRing: deferredRootLoadingRing,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      deferredSceneState.sceneSignature,
      deferredRootLoadingRingSignature,
      nodeSizeConfigSignature,
    ],
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
    detailNodeRef.current = detail.node
  }, [detail.node])

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
        rootLoadingRing: deferredRootLoadingRing,
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
  }, [
    deferredRootLoadingRing,
    deferredSceneState,
    isFixtureMode,
    isSceneTransitionPending,
    nodeSizeConfig,
  ])

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
    clearSelectedNodeRef.current = clearSelectedNode
  }, [clearSelectedNode])

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

  useEffect(() => {
    activityRootPubkeyRef.current = sceneState.rootPubkey
    autoActivityNodePendingRef.current.clear()
    autoActivityPairAttemptedRef.current.clear()
    if (autoActivityNodeFlushTimerRef.current !== null) {
      clearTimeout(autoActivityNodeFlushTimerRef.current)
      autoActivityNodeFlushTimerRef.current = null
    }
  }, [sceneState.rootPubkey])

  useEffect(() => () => {
    if (autoActivityNodeFlushTimerRef.current !== null) {
      clearTimeout(autoActivityNodeFlushTimerRef.current)
      autoActivityNodeFlushTimerRef.current = null
    }
  }, [])

  const visibleNodeSet = useMemo(() => new Set(visiblePubkeys), [visiblePubkeys])
  const sceneConnectionLookup = useMemo(
    () => buildSceneConnectionIndex(sceneState.edgesById),
    [sceneState.edgesById],
  )
  const scheduleDetachedNodePlacement = useCallback(
    (pubkey: string, attempt = 0) => {
      if (typeof window === 'undefined') {
        return
      }

      window.requestAnimationFrame(() => {
        const host = sigmaHostRef.current
        const placed = host?.placeDetachedNode(pubkey) ?? false
        if (placed) {
          host?.setNodePinned(pubkey, true)
          return
        }
        if (!placed && attempt < 4) {
          scheduleDetachedNodePlacement(pubkey, attempt + 1)
        }
      })
    },
    [],
  )
  const flushAutoActivityNodeQueue = useCallback(() => {
    autoActivityNodeFlushTimerRef.current = null
    if (
      !canAutoAddExternalActivityNodes ||
      isFixtureMode ||
      !sceneState.rootPubkey
    ) {
      autoActivityNodePendingRef.current.clear()
      return
    }

    const entries = Array.from(autoActivityNodePendingRef.current.entries())
      .slice(0, AUTO_ACTIVITY_NODE_BATCH_SIZE)
    if (entries.length === 0) {
      return
    }

    for (const [pubkey, anchorPubkeys] of entries) {
      if (autoActivityNodeInflightRef.current.has(pubkey)) {
        continue
      }

      autoActivityNodePendingRef.current.delete(pubkey)
      autoActivityNodeInflightRef.current.add(pubkey)
      void bridge.addActivityExternalNode({
        pubkey,
        anchorPubkeys: Array.from(anchorPubkeys),
        rootPubkey: sceneState.rootPubkey,
      }).then((result) => {
        if (result.status !== 'skipped') {
          scheduleDetachedNodePlacement(pubkey)
        }
      }).catch(() => {
        // Activity-driven discovery is opportunistic. A failed relation/profile
        // probe must not interrupt the live feed.
      }).finally(() => {
        autoActivityNodeInflightRef.current.delete(pubkey)
        if (
          autoActivityNodePendingRef.current.size > 0 &&
          autoActivityNodeFlushTimerRef.current === null
        ) {
          autoActivityNodeFlushTimerRef.current = setTimeout(
            flushAutoActivityNodeQueue,
            AUTO_ACTIVITY_NODE_FLUSH_DELAY_MS,
          )
        }
      })
    }
  }, [
    canAutoAddExternalActivityNodes,
    bridge,
    isFixtureMode,
    sceneState.rootPubkey,
    scheduleDetachedNodePlacement,
  ])
  const enqueueAutoActivityExternalNode = useCallback(({
    fromPubkey,
    hasVisibleFrom,
    hasVisibleTo,
    toPubkey,
  }: {
    fromPubkey: string
    hasVisibleFrom: boolean
    hasVisibleTo: boolean
    toPubkey: string
  }) => {
    if (
      !canAutoAddExternalActivityNodes ||
      isFixtureMode ||
      !sceneState.rootPubkey ||
      hasVisibleFrom === hasVisibleTo
    ) {
      return
    }

    const anchorPubkey = (hasVisibleFrom ? fromPubkey : toPubkey).toLowerCase()
    const externalPubkey = (hasVisibleFrom ? toPubkey : fromPubkey).toLowerCase()
    if (
      !HEX_PUBKEY_RE.test(anchorPubkey) ||
      !HEX_PUBKEY_RE.test(externalPubkey)
    ) {
      return
    }

    const pairKey =
      anchorPubkey < externalPubkey
        ? `${anchorPubkey}<->${externalPubkey}`
        : `${externalPubkey}<->${anchorPubkey}`
    if (autoActivityPairAttemptedRef.current.has(pairKey)) {
      return
    }
    autoActivityPairAttemptedRef.current.add(pairKey)

    const pendingAnchors =
      autoActivityNodePendingRef.current.get(externalPubkey) ?? new Set<string>()
    pendingAnchors.add(anchorPubkey)
    autoActivityNodePendingRef.current.set(externalPubkey, pendingAnchors)

    if (autoActivityNodeFlushTimerRef.current === null) {
      autoActivityNodeFlushTimerRef.current = setTimeout(
        flushAutoActivityNodeQueue,
        AUTO_ACTIVITY_NODE_FLUSH_DELAY_MS,
      )
    }
  }, [
    canAutoAddExternalActivityNodes,
    flushAutoActivityNodeQueue,
    isFixtureMode,
    sceneState.rootPubkey,
  ])
  const appendZapActivity = useCallback((
    zap: Pick<ParsedZap, 'fromPubkey' | 'toPubkey' | 'sats'> & {
      eventId?: string
      createdAt?: number
      zappedEventId?: string | null
      comment?: string | null
    },
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
      zapCreatedAt: zap.createdAt ?? Math.floor(Date.now() / 1_000),
      eventId: zap.eventId,
      zappedEventId: zap.zappedEventId ?? null,
      comment: zap.comment ?? null,
    }
    setZapActivityLog((current) => {
      if (entry.eventId && current.some((e) => e.eventId === entry.eventId)) {
        return current
      }
      return [entry, ...current].slice(0, ZAP_ACTIVITY_LIMIT)
    })
  }, [])

  const handleZap = useCallback((zap: Pick<ParsedZap, 'fromPubkey' | 'toPubkey' | 'sats'>) => {
    if (activityRootPubkeyRef.current !== sceneState.rootPubkey) {
      return false
    }

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
    enqueueAutoActivityExternalNode({
      fromPubkey: zap.fromPubkey,
      hasVisibleFrom,
      hasVisibleTo,
      toPubkey: zap.toPubkey,
    })
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
  }, [
    sceneConnectionLookup,
    sceneState.activeLayer,
    sceneState.rootPubkey,
    showZaps,
    enqueueAutoActivityExternalNode,
    visibleNodeSet,
  ])

  const handleGraphEvent = useCallback(
    (
      event: ParsedGraphEvent,
      source: GraphEventActivitySource = 'live',
    ): boolean => {
      if (activityRootPubkeyRef.current !== sceneState.rootPubkey) {
        return false
      }

      const hasVisibleFrom = visibleNodeSet.has(event.fromPubkey)
      const hasVisibleTo = visibleNodeSet.has(event.toPubkey)
      enqueueAutoActivityExternalNode({
        fromPubkey: event.fromPubkey,
        hasVisibleFrom,
        hasVisibleTo,
        toPubkey: event.toPubkey,
      })
      if (!hasVisibleFrom && !hasVisibleTo) {
        return false
      }
      const played = sigmaHostRef.current?.playGraphEvent(event) ?? false
      const entry = graphEventToActivityEntry({
        event,
        id: `${event.kind}:${event.eventId}`,
        source,
        played,
        receivedAt: Date.now(),
      })
      setGraphEventActivityLog((current) => {
        if (current.some((item) => item.id === entry.id)) return current
        return [entry, ...current].slice(0, GRAPH_EVENT_ACTIVITY_LIMIT)
      })
      return played
    },
    [enqueueAutoActivityExternalNode, sceneState.rootPubkey, visibleNodeSet],
  )

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

  const handleReplayGraphEventActivity = useCallback(
    (entry: GraphEventActivityLogEntry) => {
      const played = handleGraphEvent(activityEntryToParsedGraphEvent(entry), entry.source)
      setGraphEventActivityLog((current) =>
        current.map((item) =>
          item.id === entry.id ? { ...item, played } : item,
        ),
      )
      setZapFeedback(
        played
          ? `${GRAPH_EVENT_KIND_SINGULAR_LABELS[entry.kind]} reproducido.`
          : 'No se pudo reproducir esa actividad en la vista actual.',
      )
    },
    [handleGraphEvent],
  )

  // Propagate physics pause/resume to the Sigma runtime when toggled.
  useEffect(() => {
    sigmaHostRef.current?.setPhysicsSuspended(!physicsEnabled)
  }, [physicsEnabled])

  useEffect(() => {
    if (zapActivityLog.length === 0 && graphEventActivityLog.length === 0) return

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
    if (pubkeys.length < ZAP_ACTOR_PROFILE_BATCH_SIZE) {
      for (const entry of graphEventActivityLog) {
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
  }, [
    graphEventActivityLog,
    sceneState.nodesByPubkey,
    zapActivityLog,
    zapActorLabelsByPubkey,
  ])

  const canRunZapFeed = canRunZapFeedForScene({
    showZaps,
    isFixtureMode,
    activeLayer: sceneState.activeLayer,
  })
  const canRunEventFeed = canRunZapFeedForScene({
    showZaps: enabledGraphEventKinds.length > 0,
    isFixtureMode,
    activeLayer: sceneState.activeLayer,
  })
  const shouldEnableLiveZapFeed = canRunZapFeed && zapFeedMode === 'live'
  const shouldEnableRecentZapReplay =
    canRunZapFeed && zapFeedMode === 'recent'
  const shouldEnableLiveGraphEventFeed =
    canRunEventFeed &&
    zapFeedMode === 'live' &&
    enabledNonZapGraphEventKinds.length > 0
  const shouldEnableRecentGraphEventReplay =
    canRunEventFeed &&
    zapFeedMode === 'recent' &&
    enabledNonZapGraphEventKinds.length > 0
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
  const handleQuickReplay = useCallback(() => {
    if (!canRunEventFeed) return
    setIsActivitiesPanelOpen(true)
    setZapFeedMode('recent')
    setRecentZapReplayPlaybackPaused(false)
    setRecentZapReplayScrubProgress(null)
    setRecentZapReplayRequest((current) => current + 1)
    setRecentZapReplayRefreshRequest((current) => current + 1)
    setRecentZapReplaySeekRequest((current) => ({
      key: current.key + 1,
      progress: 0,
    }))
  }, [canRunEventFeed, setZapFeedMode])
  const handleQuickReplayPauseToggle = useCallback(() => {
    setRecentZapReplayPlaybackPaused((current) => !current)
  }, [])
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

  // One live-feed hook per non-zap kind. Each subscription is independently
  // gated on its persisted toggle; the inner hook short-circuits when
  // disabled, so this just spawns/teardowns subscriptions on toggle change.
  useLiveGraphEventFeed({
    kind: 'like',
    visiblePubkeys,
    enabled: shouldEnableLiveGraphEventFeed && eventToggles.like,
    enforceVisiblePubkeyLimit: pauseLiveZapsWhenSceneIsLarge,
    onEvent: handleGraphEvent,
  })
  useLiveGraphEventFeed({
    kind: 'repost',
    visiblePubkeys,
    enabled: shouldEnableLiveGraphEventFeed && eventToggles.repost,
    enforceVisiblePubkeyLimit: pauseLiveZapsWhenSceneIsLarge,
    onEvent: handleGraphEvent,
  })
  useLiveGraphEventFeed({
    kind: 'save',
    visiblePubkeys,
    enabled: shouldEnableLiveGraphEventFeed && eventToggles.save,
    enforceVisiblePubkeyLimit: pauseLiveZapsWhenSceneIsLarge,
    onEvent: handleGraphEvent,
  })
  useLiveGraphEventFeed({
    kind: 'quote',
    visiblePubkeys,
    enabled: shouldEnableLiveGraphEventFeed && eventToggles.quote,
    enforceVisiblePubkeyLimit: pauseLiveZapsWhenSceneIsLarge,
    onEvent: handleGraphEvent,
  })
  useLiveGraphEventFeed({
    kind: 'comment',
    visiblePubkeys,
    enabled: shouldEnableLiveGraphEventFeed && eventToggles.comment,
    enforceVisiblePubkeyLimit: pauseLiveZapsWhenSceneIsLarge,
    onEvent: handleGraphEvent,
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
  const recentGraphEventReplay = useRecentGraphEventReplay({
    visiblePubkeys,
    enabled: shouldEnableRecentGraphEventReplay,
    kinds: enabledNonZapGraphEventKinds,
    lookbackHours: appliedRecentZapReplayLookbackHours,
    replayKey: recentZapReplayRequest,
    refreshKey: recentZapReplayRefreshRequest,
    playbackPaused: isRecentZapReplayPlaybackHeld,
    onEvent: (event) => handleGraphEvent(event, 'recent'),
  })
  const recentZapReplayCollection = useMemo(
    () => buildRecentZapReplayCollectionViewModel(recentZapReplay),
    [recentZapReplay],
  )
  const recentZapReplayWorking =
    shouldEnableRecentZapReplay &&
    (recentZapReplay.phase === 'loading' || recentZapReplay.phase === 'playing')
  const recentGraphEventReplayWorking =
    shouldEnableRecentGraphEventReplay &&
    (recentGraphEventReplay.phase === 'loading' ||
      recentGraphEventReplay.phase === 'playing')
  const recentActivityReplayWorking =
    recentZapReplayWorking || recentGraphEventReplayWorking
  const recentZapReplayPlaybackIsPaused =
    recentZapReplayPlaybackPaused ||
    recentZapReplay.playbackPaused ||
    recentGraphEventReplay.playbackPaused
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
  const activityReplayStatusLabel =
    recentGraphEventReplayWorking && !recentZapReplayWorking
      ? 'Replay de actividad'
      : recentZapReplayStatusLabel
  const recentZapReplayCollectionProgressValue = formatProgressValue(
    recentZapReplayCollection.progress,
  )
  const recentZapReplayPlaybackProgress =
    recentZapReplay.phase === 'done' ? 1 : recentZapReplay.timelineProgress
  const recentZapReplayPlaybackProgressValue = formatProgressValue(
    recentZapReplayPlaybackProgress,
  )
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
    sigmaHostRef.current?.setActivityOverlayPaused(
      (shouldEnableRecentZapReplay || shouldEnableRecentGraphEventReplay) &&
        isRecentZapReplayPlaybackHeld,
    )
  }, [
    isRecentZapReplayPlaybackHeld,
    shouldEnableRecentGraphEventReplay,
    shouldEnableRecentZapReplay,
  ])

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
        current === 'Actividad live pausada: no hay nodos visibles para filtrar.'
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
  const handleConnectionVisualConfigChange = useCallback((config: ConnectionVisualConfig) => {
    setConnectionVisualConfig(normalizeConnectionVisualConfig(config))
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
    setIsActivitiesPanelOpen(false)
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
      setIsActivitiesPanelOpen(false)
      setIsRuntimeInspectorOpen(false)
      if (isChangingRoot && !isFixtureMode) {
        activityRootPubkeyRef.current = pubkey
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
        setGraphEventActivityLog([])
        setSelectedZapDetailId(null)
        setSelectedGraphEventDetailId(null)
        setSelectedZapOffGraphIdentity(null)
        setZapActorLabelsByPubkey({})
        zapActivitySequenceRef.current = 0
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
            if (isChangingRoot) {
              activityRootPubkeyRef.current = sceneState.rootPubkey
            }
            setLoadFeedback(error instanceof Error ? error.message : 'No se pudo cargar el root.')
            setIsRootLoadScreenOpen(false)
            setIsRootSheetOpen(true)
          })
      })
    },
    [bridge, isFixtureMode, sceneState.rootPubkey, setZapFeedMode, upsertSavedRoot],
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
    setIsActivitiesPanelOpen(false)
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
    setIsActivitiesPanelOpen(false)
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
    setIsActivitiesPanelOpen(false)
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
    setIsActivitiesPanelOpen(false)
    setIsRuntimeInspectorOpen(false)
    setIsRootSheetOpen(false)
    setMobileUtilityPanel(null)
    setMobilePanelSnap('mid')
    setIsNotificationsOpen(true)
  }, [clearSelectedNode, isNotificationsOpen])

  const handleOpenActivitiesPanel = useCallback(() => {
    if (isActivitiesPanelOpen) {
      setIsActivitiesPanelOpen(false)
      setSelectedZapDetailId(null)
      setSelectedGraphEventDetailId(null)
      setSelectedZapOffGraphIdentity(null)
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
    setSelectedZapDetailId(null)
    setSelectedGraphEventDetailId(null)
    setSelectedZapOffGraphIdentity(null)
    setIsActivitiesPanelOpen(true)
  }, [clearSelectedNode, isActivitiesPanelOpen])

  useEffect(() => {
    if (isActivitiesPanelOpen) return
    if (selectedZapDetailId !== null) {
      setSelectedZapDetailId(null)
    }
    if (selectedGraphEventDetailId !== null) {
      setSelectedGraphEventDetailId(null)
    }
    if (selectedZapOffGraphIdentity !== null) {
      setSelectedZapOffGraphIdentity(null)
    }
  }, [
    isActivitiesPanelOpen,
    selectedGraphEventDetailId,
    selectedZapDetailId,
    selectedZapOffGraphIdentity,
  ])

  const selectedZapDetail = useMemo(() => {
    if (!selectedZapDetailId) return null
    return zapActivityLog.find((entry) => entry.id === selectedZapDetailId) ?? null
  }, [selectedZapDetailId, zapActivityLog])

  const selectedGraphEventDetail = useMemo(() => {
    if (!selectedGraphEventDetailId) return null
    return (
      graphEventActivityLog.find((entry) => entry.id === selectedGraphEventDetailId) ??
      null
    )
  }, [graphEventActivityLog, selectedGraphEventDetailId])

  const activityPanelEntries = useMemo<ActivityPanelEntry[]>(() => {
    const zapEntries: ActivityPanelEntry[] = zapActivityLog.map((entry) => ({
      type: 'zap',
      id: `zap:${entry.id}`,
      source: entry.source,
      fromPubkey: entry.fromPubkey,
      toPubkey: entry.toPubkey,
      played: entry.played,
      receivedAt: entry.createdAt,
      zap: entry,
      graphEvent: null,
    }))
    const graphEntries: ActivityPanelEntry[] = graphEventActivityLog.map((entry) => ({
      type: 'graph-event',
      id: `graph-event:${entry.id}`,
      source: entry.source,
      fromPubkey: entry.fromPubkey,
      toPubkey: entry.toPubkey,
      played: entry.played,
      receivedAt: entry.receivedAt,
      zap: null,
      graphEvent: entry,
    }))
    return [...zapEntries, ...graphEntries].sort(
      (left, right) => right.receivedAt - left.receivedAt,
    )
  }, [graphEventActivityLog, zapActivityLog])

  const handleOpenZapDetail = useCallback((entryId: string) => {
    setSelectedZapOffGraphIdentity(null)
    setSelectedGraphEventDetailId(null)
    setSelectedZapDetailId(entryId)
  }, [])

  const handleOpenGraphEventDetail = useCallback((entryId: string) => {
    setSelectedZapOffGraphIdentity(null)
    setSelectedZapDetailId(null)
    setSelectedGraphEventDetailId(entryId)
  }, [])

  const handleCloseZapDetail = useCallback(() => {
    setSelectedZapOffGraphIdentity(null)
    setSelectedZapDetailId(null)
    setSelectedGraphEventDetailId(null)
  }, [])

  const handleCloseZapOffGraphIdentity = useCallback(() => {
    setSelectedZapOffGraphIdentity(null)
  }, [])

  const handleOpenIdentityFromZap = useCallback((pubkey: string, fallbackLabel: string) => {
    if (isFixtureMode) {
      updateFixtureState((current) => ({ ...current, selectedNodePubkey: pubkey }))
      return
    }
    setSelectedZapOffGraphIdentity(null)
    // Para abrir la identidad desde zaps importa si el nodo esta en la escena
    // renderizada actual, no si existe en el store canonico pero quedo fuera
    // de la capa/proyeccion visible.
    if (resolveZapIdentityPanelMode({
      pubkey,
      renderedNodePubkeys: visibleNodeSet,
    }) === 'scene') {
      bridge.selectNode(pubkey)
      return
    }
    setSelectedZapOffGraphIdentity({ fallbackLabel, pubkey })
  }, [bridge, isFixtureMode, updateFixtureState, visibleNodeSet])

  const handleAddZapOffGraphIdentityToGraph = useCallback((input: {
    fallbackLabel: string
    hasResolvedProfile: boolean
    profile: NostrProfile | null
    pubkey: string
  }) => {
    if (isFixtureMode) {
      setActionFeedback('Agregar identidades off-graph no esta disponible en el fixture.')
      return
    }

    const resolvedLabel = (
      (input.profile ? resolveZapActorProfileLabel(input.profile) : null) ??
      input.fallbackLabel.trim()
    ) || null
    const hasResolvedProfileData =
      input.hasResolvedProfile && hasUsableZapActorProfile(input.profile)

    try {
      const result = bridge.addDetachedNode({
        pubkey: input.pubkey,
        label: resolvedLabel,
        picture: input.profile?.picture ?? null,
        about: input.profile?.about ?? null,
        nip05: input.profile?.nip05 ?? null,
        lud16: input.profile?.lud16 ?? null,
        profileFetchedAt: hasResolvedProfileData ? Date.now() : null,
        profileState: hasResolvedProfileData ? 'ready' : 'idle',
        source: 'zap',
        pin: true,
        select: true,
        markExpanded: true,
      })
      scheduleDetachedNodePlacement(input.pubkey)
      setSelectedZapOffGraphIdentity(null)
      setActionFeedback(result.message)
    } catch (error) {
      setActionFeedback(
        error instanceof Error
          ? error.message
          : 'No se pudo agregar esa identidad al grafo.',
      )
    }
  }, [bridge, isFixtureMode, scheduleDetachedNodePlacement, setActionFeedback])

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
    setIsActivitiesPanelOpen(false)
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
    setIsActivitiesPanelOpen(false)
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
    ...(runtimeInspectorButtonVisible
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
      tip: recentActivityReplayWorking
        ? `${activityReplayStatusLabel}: sigue trabajando`
        : isActivitiesPanelOpen
          ? tSigma('rail.closeZaps')
          : tSigma('rail.zaps'),
      icon: <PulseIcon />,
      active: isActivitiesPanelOpen,
      attention: recentActivityReplayWorking,
      onClick: handleOpenActivitiesPanel,
    },
    {
      id: 'replay',
      tip: !canRunEventFeed
        ? tSigma('canvas.replayShortcut.disabled')
        : recentActivityReplayWorking
          ? recentZapReplayPlaybackIsPaused
            ? tSigma('rail.replayResume')
            : tSigma('rail.replayPause')
          : tSigma('rail.replay', { window: appliedZapReplayWindowLabel }),
      icon: recentActivityReplayWorking && !recentZapReplayPlaybackIsPaused
        ? <PauseIcon />
        : <PlayIcon />,
      active: recentActivityReplayWorking,
      attention: recentActivityReplayWorking,
      onClick: recentActivityReplayWorking
        ? handleQuickReplayPauseToggle
        : handleQuickReplay,
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
    appliedZapReplayWindowLabel,
    activityReplayStatusLabel,
    canRunEventFeed,
    runtimeInspectorButtonVisible,
    handleOpenActivitiesPanel,
    handleOpenNotifications,
    handleOpenRuntimeInspector,
    handleOpenSettings,
    handleFitView,
    handleQuickReplay,
    handleQuickReplayPauseToggle,
    handleStaleRelays,
    handleTogglePhysics,
    isNotificationsOpen,
    isRuntimeInspectorOpen,
    isSettingsOpen,
    isActivitiesPanelOpen,
    notificationHistory.length,
    physicsEnabled,
    recentActivityReplayWorking,
    recentZapReplayPlaybackIsPaused,
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
      tip: recentActivityReplayWorking
        ? `${activityReplayStatusLabel}: sigue trabajando`
        : isActivitiesPanelOpen
          ? tSigma('rail.closeZaps')
          : tSigma('rail.liveZaps'),
      icon: <PulseIcon />,
      active: isActivitiesPanelOpen,
      badge: activityPanelEntries.length,
      attention: recentActivityReplayWorking,
      onClick: handleOpenActivitiesPanel,
    },
    {
      id: 'replay',
      label: tSigma('rail.replayShort'),
      tip: !canRunEventFeed
        ? tSigma('canvas.replayShortcut.disabled')
        : recentActivityReplayWorking
          ? recentZapReplayPlaybackIsPaused
            ? tSigma('rail.replayResume')
            : tSigma('rail.replayPause')
          : tSigma('rail.replay', { window: appliedZapReplayWindowLabel }),
      icon: recentActivityReplayWorking && !recentZapReplayPlaybackIsPaused
        ? <PauseIcon />
        : <PlayIcon />,
      active: recentActivityReplayWorking,
      attention: recentActivityReplayWorking,
      onClick: recentActivityReplayWorking
        ? handleQuickReplayPauseToggle
        : handleQuickReplay,
    },
    ...(runtimeInspectorButtonVisible
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
    activityPanelEntries.length,
    appliedZapReplayWindowLabel,
    activityReplayStatusLabel,
    canRunEventFeed,
    runtimeInspectorButtonVisible,
    handleOpenMobileUtilityPanel,
    handleOpenRuntimeInspector,
    handleOpenActivitiesPanel,
    handleOpenSettings,
    handleQuickReplay,
    handleQuickReplayPauseToggle,
    isSettingsOpen,
    isRuntimeInspectorOpen,
    isActivitiesPanelOpen,
    mobileUtilityPanel,
    handleFitView,
    recentActivityReplayWorking,
    recentZapReplayPlaybackIsPaused,
    tSigma,
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
            hudStatsEnabled={hudStatsEnabled}
            hideConnectionsOnLowPerformance={hideConnectionsOnLowPerformance}
            isClearingSiteCache={cacheClearStatus === 'running'}
            mobileDegradedMode={renderConfig.mobileDegradedMode ?? false}
            isMobileViewport={isMobileViewport}
            lowPerformanceConnectionStatusLabel={lowPerformanceConnectionStatusLabel}
            maxNodes={runtimeInspectorStoreSnapshot.maxNodes}
            nodeCount={runtimeInspectorStoreSnapshot.nodeCount}
            onAvatarRuntimeOptionsChange={setAvatarRuntimeOptions}
            onClearSiteCache={handleClearSiteCache}
            onGraphMaxNodesChange={setGraphMaxNodes}
            onToggleHudStats={() => {
              setHudStatsEnabled((current) => !current)
            }}
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
            runtimeInspectorButtonVisible={runtimeInspectorButtonVisible}
            rootPubkey={sceneState.rootPubkey}
            rootLoadStatus={rootLoadStatus}
            onExpandRoot={handleExpandRoot}
          />
        )
      case 'visuals':
        return (
          <VisualOptionsPanel
            avatarRuntimeOptions={avatarRuntimeOptions}
            connectionVisualConfig={connectionVisualConfig}
            initialCameraZoom={initialCameraZoom}
            nodeSizeConfig={nodeSizeConfig}
            onAvatarRuntimeOptionsChange={setAvatarRuntimeOptions}
            onConnectionVisualConfigChange={handleConnectionVisualConfigChange}
            onInitialCameraZoomChange={handleInitialCameraZoomChange}
            onNodeSizeConfigChange={handleNodeSizeConfigChange}
            onToggleVisibleEdgeCountLabels={() => {
              setShowVisibleEdgeCountLabels((current) => !current)
            }}
            showVisibleEdgeCountLabels={showVisibleEdgeCountLabels}
          />
        )
      case 'zaps':
        return renderActivitySettingsContent()
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
            <div className="sg-settings-section">
              <h4>{tSigma('settings.performance.advanced')}</h4>
              <div className="sg-setting-row">
                <div>
                  <div className="sg-setting-row__lbl">
                    {tSigma('settings.performance.rootLoadOverlay')}
                  </div>
                  <div className="sg-setting-row__desc">
                    {tSigma('settings.performance.rootLoadOverlayDesc')}
                  </div>
                </div>
                <button
                  aria-pressed={rootLoadOverlayEnabled}
                  className={`sg-toggle${rootLoadOverlayEnabled ? ' sg-toggle--on' : ''}`}
                  onClick={() => {
                    setRootLoadOverlayEnabled((current) => !current)
                  }}
                  title={
                    rootLoadOverlayEnabled
                      ? tSigma('settings.performance.hideRootLoadOverlay')
                      : tSigma('settings.performance.showRootLoadOverlay')
                  }
                  type="button"
                />
              </div>
              <div className="sg-setting-row">
                <div>
                  <div className="sg-setting-row__lbl">
                    {tSigma('settings.performance.rootLoadHud')}
                  </div>
                  <div className="sg-setting-row__desc">
                    {tSigma('settings.performance.rootLoadHudDesc')}
                  </div>
                </div>
                <button
                  aria-pressed={rootLoadHudEnabled}
                  className={`sg-toggle${rootLoadHudEnabled ? ' sg-toggle--on' : ''}`}
                  onClick={() => {
                    setRootLoadHudEnabled((current) => !current)
                  }}
                  title={
                    rootLoadHudEnabled
                      ? tSigma('settings.performance.hideRootLoadHud')
                      : tSigma('settings.performance.showRootLoadHud')
                  }
                  type="button"
                />
              </div>
            </div>
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

  const renderActivitySettingsContent = () => (
    <div>
      <div className="sg-settings-section">
        <h4>{tSigma('zaps.settings.visualization')}</h4>
        <div className="sg-setting-row__desc" style={{ marginBottom: 8 }}>
          {locale === 'en'
            ? 'Enable each Nostr activity type independently. Settings persist across sessions.'
            : 'Activa cada tipo de actividad Nostr por separado. La configuracion queda persistida.'}
        </div>
        {GRAPH_EVENT_KINDS.map((kind) => {
          const enabled = eventToggles[kind]
          const actionLabel = locale === 'en'
            ? `${enabled ? 'Disable' : 'Enable'} ${GRAPH_EVENT_KIND_LABELS[kind]}`
            : `${enabled ? 'Desactivar' : 'Activar'} ${GRAPH_EVENT_KIND_LABELS[kind]}`

          return (
            <div className="sg-setting-row" key={`event-toggle-${kind}`}>
              <div>
                <div className="sg-setting-row__lbl">
                  {GRAPH_EVENT_KIND_LABELS[kind]}
                </div>
                <div className="sg-setting-row__desc">
                  {GRAPH_EVENT_KIND_DESCRIPTIONS[kind]}
                </div>
              </div>
              <button
                aria-label={actionLabel}
                aria-pressed={enabled}
                className={`sg-toggle${enabled ? ' sg-toggle--on' : ''}`}
                onClick={() => {
                  setEventToggle(kind, !enabled)
                }}
                title={actionLabel}
                type="button"
              />
            </div>
          )
        })}
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
        {isDev ? (
          <div className="sg-setting-row">
            <div>
              <div className="sg-setting-row__lbl">{tSigma('zaps.settings.autoAddExternalNodes')}</div>
              <div className="sg-setting-row__desc">
                {tSigma('zaps.settings.autoAddExternalNodesDesc')}
              </div>
            </div>
            <button
              aria-pressed={autoAddExternalActivityNodes}
              className={`sg-toggle${autoAddExternalActivityNodes ? ' sg-toggle--on' : ''}`}
              onClick={() => {
                setAutoAddExternalActivityNodes(!autoAddExternalActivityNodes)
              }}
              title={
                autoAddExternalActivityNodes
                  ? tSigma('zaps.settings.disableAutoAddExternalNodes')
                  : tSigma('zaps.settings.enableAutoAddExternalNodes')
              }
              type="button"
            />
          </div>
        ) : null}
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

  const zapFeedStatus = shouldEnableLiveZapFeed || shouldEnableLiveGraphEventFeed
    ? 'Live'
    : zapFeedMode === 'recent'
      ? selectedZapReplayWindowLabel
      : tSigma('zaps.panel.statusPaused')
  const canControlRecentZapReplay =
    zapFeedMode === 'recent' &&
    (shouldEnableRecentZapReplay || shouldEnableRecentGraphEventReplay)
  const canToggleRecentZapReplayPlayback =
    canControlRecentZapReplay &&
    (recentZapReplay.phase === 'loading' ||
      recentZapReplay.phase === 'playing' ||
      recentZapReplay.playableCount > 0 ||
      recentGraphEventReplay.phase === 'loading' ||
      recentGraphEventReplay.phase === 'playing' ||
      recentGraphEventReplay.playableCount > 0)
  const renderActivitiesContent = () => {
    const v3Entries: SigmaActivityPanelV3Entry[] = activityPanelEntries.map((entry) => {
      const isZap = entry.type === 'zap'
      const kind: GraphEventKind = isZap ? 'zap' : entry.graphEvent!.kind
      let sats = 0
      let text = ''
      if (isZap) {
        sats = entry.zap.sats
        text = entry.zap.comment?.trim() || ''
      } else {
        const ge = entry.graphEvent!
        switch (ge.payload.kind) {
          case 'zap':
            sats = ge.payload.data.amountSats ?? 0
            break
          case 'quote':
            text = ge.payload.data.quoterContent || ''
            break
          case 'comment':
            text = ge.payload.data.commentContent || ''
            break
          case 'repost':
            text = ge.payload.data.embeddedContent || ''
            break
          default:
            text = ''
        }
      }
      return {
        id: entry.id,
        kind,
        source: entry.source,
        fromPubkey: entry.fromPubkey,
        toPubkey: entry.toPubkey,
        fromLabel: getZapActorLabel(entry.fromPubkey),
        toLabel: getZapActorLabel(entry.toPubkey),
        played: entry.played,
        receivedAt: entry.receivedAt,
        occurredAt: isZap
          ? entry.zap.zapCreatedAt * 1_000
          : entry.graphEvent!.createdAt * 1_000,
        sats,
        text,
      }
    })

    const advancedMetrics: SigmaActivityPanelReplayMetric[] = [
      { label: tSigma('zaps.panel.targets'), value: formatInteger(recentZapReplay.targetCount) },
      {
        label: tSigma('zaps.panel.batches'),
        value: `${formatInteger(recentZapReplay.completedBatchCount)}/${formatInteger(recentZapReplay.batchCount)}`,
      },
      { label: tSigma('zaps.panel.cache'), value: formatInteger(recentZapReplay.cachedCount) },
      { label: tSigma('zaps.panel.new'), value: formatInteger(recentZapReplay.fetchedCount) },
      {
        label: tSigma('zaps.panel.timeouts'),
        value: formatInteger(recentZapReplay.timedOutBatchCount),
        tone: recentZapReplay.timedOutBatchCount > 0 ? 'warn' : undefined,
      },
      {
        label: tSigma('zaps.panel.limit'),
        value:
          recentZapReplay.truncatedTargetCount > 0
            ? tSigma('zaps.panel.omitted', {
                count: formatInteger(recentZapReplay.truncatedTargetCount),
              })
            : tSigma('zaps.panel.ok'),
        tone: recentZapReplay.truncatedTargetCount > 0 ? 'warn' : 'good',
      },
    ]

    const findOriginal = (id: string) => activityPanelEntries.find((e) => e.id === id) ?? null

    return (
      <SigmaActivityPanelV3
        entries={v3Entries}
        totalEntryCount={v3Entries.length}
        emptyLabel={tSigma('zaps.panel.empty')}
        toggles={eventToggles}
        onSetToggle={(kind, value) => setEventToggle(kind, value)}
        onIsolateKind={(kind) => {
          GRAPH_EVENT_KINDS.forEach((k) => setEventToggle(k, k === kind))
        }}
        onResetKinds={() => {
          GRAPH_EVENT_KINDS.forEach((k) => setEventToggle(k, true))
        }}
        mode={zapFeedMode}
        onChangeMode={(next) => {
          setZapFeedMode(next)
          setRecentZapReplayPlaybackPaused(false)
        }}
        isLiveActive={shouldEnableLiveZapFeed || shouldEnableLiveGraphEventFeed}
        isWorking={recentActivityReplayWorking}
        liveStatusLabel={zapFeedStatus}
        liveFeedback={liveZapFeedFeedback}
        replayCollectionPct={recentZapReplayCollectionProgressValue}
        replayPlaybackPct={recentZapReplayPlaybackProgressValue}
        replayPlaybackPaused={recentZapReplayPlaybackIsPaused}
        onTogglePlay={() => setRecentZapReplayPlaybackPaused((cur) => !cur)}
        onReplayCache={() => {
          setRecentZapReplayPlaybackPaused(false)
          setRecentZapReplayRequest((cur) => cur + 1)
        }}
        onRefresh={() => {
          setRecentZapReplayPlaybackPaused(false)
          setRecentZapReplayRefreshRequest((cur) => cur + 1)
        }}
        canControlReplay={canControlRecentZapReplay && recentZapReplay.phase !== 'loading'}
        canTogglePlayback={canToggleRecentZapReplayPlayback}
        lookbackHours={recentZapReplayLookbackHours}
        onChangeLookbackHours={(h) =>
          setRecentZapReplayLookbackHours(clampRecentZapReplayLookbackHours(h))
        }
        lookbackMinHours={RECENT_ZAP_REPLAY_MIN_LOOKBACK_HOURS}
        lookbackMaxHours={RECENT_ZAP_REPLAY_MAX_LOOKBACK_HOURS}
        appliedLookbackLabel={appliedZapReplayWindowLabel}
        windowPresets={RECENT_ZAP_REPLAY_WINDOW_PRESETS}
        timelineProgressPct={displayedZapReplayProgressValue}
        timelineCurrentLabel={recentZapReplayCurrentTimeLabel}
        timelineStartLabel={recentZapReplayWindowStartLabel}
        timelineEndLabel={recentZapReplayWindowEndLabel}
        canSeekTimeline={canSeekRecentZapReplay}
        timelineHandlers={{
          onPointerDown: handleZapReplayTimelinePointerDown,
          onPointerMove: handleZapReplayTimelinePointerMove,
          onPointerUp: handleZapReplayTimelinePointerUp,
          onPointerCancel: handleZapReplayTimelinePointerCancel,
          onLostPointerCapture: handleZapReplayTimelinePointerCancel,
          onKeyDown: handleZapReplayTimelineKeyDown,
        }}
        isScrubbing={recentZapReplayScrubProgress !== null}
        advancedMetrics={advancedMetrics}
        onReplayEntry={(entry) => {
          const original = findOriginal(entry.id)
          if (!original) return
          if (original.type === 'zap') {
            handleReplayZapActivity(original.zap)
          } else {
            handleReplayGraphEventActivity(original.graphEvent)
          }
        }}
        onOpenEntryDetail={(entry) => {
          const original = findOriginal(entry.id)
          if (!original) return
          if (original.type === 'zap') {
            handleOpenZapDetail(original.zap.id)
          } else {
            handleOpenGraphEventDetail(original.graphEvent.id)
          }
        }}
        labels={{
          eyebrow: tSigma('zaps.panel.activityEyebrow'),
          searchPlaceholder: tSigma('zaps.panel.activitySearchPlaceholder'),
          searchTitle: tSigma('zaps.panel.activitySearchTitle'),
          sortByTime: tSigma('zaps.panel.activitySortByTime'),
          sortByValue: tSigma('zaps.panel.activitySortByValue'),
          sortAriaLabel: tSigma('zaps.panel.activitySortAria'),
          historicalWindow: tSigma('zaps.panel.historicalWindow'),
          collection: tSigma('zaps.panel.collection'),
          collectionComplete: tSigma('zaps.panel.activityCollectionComplete'),
          playback: tSigma('zaps.panel.playback'),
          playLabel: tSigma('zaps.panel.play'),
          pauseLabel: tSigma('zaps.panel.pause'),
          cacheLabel: tSigma('zaps.panel.replayCache'),
          refreshLabel: tSigma('zaps.panel.refresh'),
          advancedToggle: tSigma('zaps.panel.advancedDetails'),
          emptyFiltered: tSigma('zaps.panel.activityEmptyFiltered'),
          clearFilters: tSigma('zaps.panel.activityClearFilters'),
          outsideView: tSigma('zaps.panel.outsideView'),
          detailsLabel: tSigma('zaps.panel.activityDetails'),
          moveReplay: tSigma('zaps.panel.moveReplay', { window: appliedZapReplayWindowText }),
          isolateHint: tSigma('zaps.panel.activityIsolateHint'),
          liveLabel: 'Live',
          replayLabel: 'Replay',
          timeLocale: locale === 'en' ? 'en-US' : 'es-AR',
          buckets: {
            now: tSigma('zaps.panel.activityBucketNow'),
            last5m: tSigma('zaps.panel.activityBucketLast5m'),
            last30m: tSigma('zaps.panel.activityBucketLast30m'),
            lastHour: tSigma('zaps.panel.activityBucketLastHour'),
            todayEarlier: tSigma('zaps.panel.activityBucketTodayEarlier'),
            today: tSigma('zaps.panel.activityBucketToday'),
            before: tSigma('zaps.panel.activityBucketBefore'),
          },
        }}
      />
    )
  }

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
    const exploreActionLabel = detail.hasExploredConnections
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
              {detail.hasExploredConnections && (
                <span className="sg-badge">{tSigma('detail.connectionsExplored')}</span>
              )}
            </div>
          </div>
        </div>

        <div className="sg-node-primary-actions" data-panel-no-drag>
          <button
            className={`sg-node-primary-action${detail.hasExploredConnections || isExpansionLoading ? '' : ' sg-node-primary-action--primary'}`}
            disabled={detail.hasExploredConnections || isExpansionLoading}
            onClick={() => {
              if (!detail.pubkey) return
              handleExploreConnections(detail.pubkey, detail.hasExploredConnections)
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
    !isActivitiesPanelOpen &&
    !isNotificationsOpen &&
    !isMobileUtilityPanelOpen
  const handleCloseSidePanel = useCallback(() => {
    if (isSettingsOpen) {
      setIsSettingsOpen(false)
    }
    if (isActivitiesPanelOpen) {
      // Stack de niveles dentro del panel de actividad:
      //   identidad del grafo / identidad off-graph -> detalle -> listado -> cerrar
      if (detail.node) {
        if (!isIdentityHelpDismissed) {
          dismissIdentityHelp()
        }
        clearSelectedNode()
        return
      }
      if (selectedZapOffGraphIdentity) {
        setSelectedZapOffGraphIdentity(null)
        return
      }
      if (selectedZapDetailId) {
        setSelectedZapDetailId(null)
        return
      }
      if (selectedGraphEventDetailId) {
        setSelectedGraphEventDetailId(null)
        return
      }
      setIsActivitiesPanelOpen(false)
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
    detail.node,
    dismissIdentityHelp,
    isIdentityHelpDismissed,
    isIdentityPanelOpen,
    isMobileUtilityPanelOpen,
    isNotificationsOpen,
    isSettingsOpen,
    isActivitiesPanelOpen,
    selectedGraphEventDetailId,
    selectedZapDetailId,
    selectedZapOffGraphIdentity,
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
        connectionVisualConfig={connectionVisualConfig}
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
        rootLoadHudEnabled={rootLoadHudEnabled}
        rootLoadOverlayEnabled={rootLoadOverlayEnabled}
        rootLoadOverride={fixtureUiState?.rootLoad ?? null}
        rootPubkey={sceneState.rootPubkey}
        sceneNodeCount={deferredScene.render.nodes.length}
      />

      {/* Top bar: search strip (left) + brand (right) */}
      <SigmaTopBarRootLoadBridge
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
          {hudStatsEnabled ? <SigmaHud stats={hudStats} /> : null}
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
        isActivitiesPanelOpen ||
        isNotificationsOpen ||
        isIdentityPanelOpen ||
        isMobileUtilityPanelOpen) &&
        !isRuntimeInspectorOpen && (
        <SigmaSidePanel
          eyebrow={
            isSettingsOpen
              ? tSigma('panelEyebrow.settings')
              : isActivitiesPanelOpen
                ? (detail.node || selectedZapOffGraphIdentity)
                  ? tSigma('panelEyebrow.identity')
                  : selectedZapDetail || selectedGraphEventDetail
                    ? tSigma('panelEyebrow.activityDetail')
                    : tSigma('panelEyebrow.zaps')
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
          ) : isActivitiesPanelOpen && detail.node ? (
            renderDetailContent()
          ) : isActivitiesPanelOpen && selectedZapOffGraphIdentity ? (
            <SigmaOffGraphIdentityPanel
              fallbackLabel={selectedZapOffGraphIdentity.fallbackLabel}
              onAddToGraph={handleAddZapOffGraphIdentityToGraph}
              onBack={handleCloseZapOffGraphIdentity}
              pubkey={selectedZapOffGraphIdentity.pubkey}
            />
          ) : isActivitiesPanelOpen && selectedZapDetail ? (
            <SigmaZapDetailPanel
              entry={selectedZapDetail}
              onBack={handleCloseZapDetail}
              onOpenIdentity={handleOpenIdentityFromZap}
              onReplay={() => handleReplayZapActivity(selectedZapDetail)}
              resolveActorLabel={getZapActorLabel}
              sourceLabel={
                selectedZapDetail.source === 'simulated'
                  ? tSigma('zaps.detail.simulated')
                  : ZAP_ACTIVITY_SOURCE_LABELS[selectedZapDetail.source]
              }
            />
          ) : isActivitiesPanelOpen && selectedGraphEventDetail ? (
            <SigmaGraphEventDetailPanel
              entry={selectedGraphEventDetail}
              onBack={handleCloseZapDetail}
              onOpenIdentity={handleOpenIdentityFromZap}
              onReplay={() => handleReplayGraphEventActivity(selectedGraphEventDetail)}
              resolveActorLabel={getZapActorLabel}
              sourceLabel={
                selectedGraphEventDetail.source === 'simulated'
                  ? tSigma('zaps.detail.simulated')
                  : ZAP_ACTIVITY_SOURCE_LABELS[selectedGraphEventDetail.source]
              }
            />
          ) : isActivitiesPanelOpen ? (
            renderActivitiesContent()
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
