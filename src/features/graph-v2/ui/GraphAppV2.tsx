'use client'
/* eslint-disable @next/next/no-img-element */

import {
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
import type {
  AppStore,
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
  CanonicalNode,
} from '@/features/graph-v2/domain/types'
import {
  buildGraphSceneSnapshot,
  getSnapshotCacheStats,
} from '@/features/graph-v2/projections/buildGraphSceneSnapshot'
import { getProjectionCacheStats } from '@/features/graph-v2/projections/buildLayerProjection'
import { buildNodeDetailProjection } from '@/features/graph-v2/projections/buildNodeDetailProjection'
import {
  applyPersonSearchHighlight,
  buildPersonSearchMatches,
  type PersonSearchMatch,
} from '@/features/graph-v2/projections/personSearchHighlight'
import type {
  GraphInteractionCallbacks,
  GraphViewportState,
} from '@/features/graph-v2/renderer/contracts'
import {
  DEFAULT_AVATAR_RUNTIME_OPTIONS,
  type AvatarRuntimeOptions,
} from '@/features/graph-v2/renderer/avatar/types'
import type { PerfBudgetSnapshot } from '@/features/graph-v2/renderer/avatar/perfBudget'
import type {
  SocialGraphCaptureFormat,
  SocialGraphCapturePhase,
} from '@/features/graph-v2/renderer/socialGraphCapture'
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
  ClockIcon,
  CopyIcon,
  ExternalLinkIcon,
  GearIcon,
  PinIcon,
  PulseIcon,
  SearchIcon,
  TargetIcon,
  ZapIcon,
} from '@/features/graph-v2/ui/SigmaIcons'
import { SigmaTopBar } from '@/features/graph-v2/ui/SigmaTopBar'
import { SigmaFilterBar, type FilterPill } from '@/features/graph-v2/ui/SigmaFilterBar'
import { SigmaSideRail, type RailButton } from '@/features/graph-v2/ui/SigmaSideRail'
import { SigmaHud, type HudStat } from '@/features/graph-v2/ui/SigmaHud'
import { SigmaMinimap } from '@/features/graph-v2/ui/SigmaMinimap'
import { SigmaSidePanel } from '@/features/graph-v2/ui/SigmaSidePanel'
import { SigmaRootLoader } from '@/features/graph-v2/ui/SigmaRootLoader'
import { SigmaEmptyState } from '@/features/graph-v2/ui/SigmaEmptyState'
import {
  SigmaLoadProgressHud,
  SigmaLoadingOverlay,
} from '@/features/graph-v2/ui/SigmaLoadingOverlay'
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
import {
  buildSocialCaptureDebugFilename,
  buildSocialCaptureDebugPayload,
  isSocialCaptureDebugDownloadEnabled,
  readSocialCaptureDebugBrowserSnapshot,
  readSocialCaptureDebugLocationSnapshot,
  type SocialCaptureDebugProgressSnapshot,
} from '@/features/graph-v2/ui/socialCaptureDebug'
import { useLiveZapFeed } from '@/features/graph-v2/zaps/useLiveZapFeed'
import type { ParsedZap } from '@/features/graph-v2/zaps/zapParser'
import {
  shouldTraceZapPair,
  traceZapFlow,
} from '@/features/graph-runtime/debug/zapTrace'
import { downloadBlob } from '@/features/graph-runtime/export/download'
import type { NostrProfile } from '@/lib/nostr'

type SigmaSettingsTab = 'renderer' | 'relays' | 'dev'

const SOCIAL_CAPTURE_FORMAT_LABELS: Record<SocialGraphCaptureFormat, string> = {
  wide: 'Wide 3840x2160',
  square: 'Square 2160',
  story: 'Story 2160x3840',
}

const SOCIAL_CAPTURE_PHASE_LABELS: Record<SocialGraphCapturePhase, string> = {
  preparing: 'preparando',
  'loading-avatars': 'cargando avatares',
  'generating-image': 'generando imagen',
  completed: 'finalizando',
}

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

type ValidRootIdentity = Extract<RootIdentityResolution, { status: 'valid' }>

interface LoadRootInput
  extends Omit<Pick<ValidRootIdentity, 'pubkey' | 'relays' | 'evidence'>, 'relays'> {
  relays?: string[]
  source?: ValidRootIdentity['source']
  npub?: string
  profile?: SavedRootProfileSnapshot | null
  profileFetchedAt?: number | null
}

const PUBLIC_SIGMA_SETTINGS_TABS: Array<{ id: SigmaSettingsTab; label: string }> = [
  { id: 'renderer', label: 'Render' },
  { id: 'relays', label: 'Relays' },
]

const DEV_SIGMA_SETTINGS_TAB: { id: SigmaSettingsTab; label: string } = {
  id: 'dev',
  label: 'Dev',
}

const IDENTITY_FIRST_RUN_HELP_KEY = 'sigma.identityFirstRunHelpDismissed'
const VISIBLE_PROFILE_WARMUP_BATCH_SIZE = 48
const VISIBLE_PROFILE_WARMUP_COOLDOWN_MS = 2 * 60 * 1000
const VISIBLE_PROFILE_WARMUP_LOOP_DELAY_MS = 1500
const VISIBLE_PROFILE_WARMUP_INITIAL_DELAY_MS = 250

const selectSavedRootState = (state: AppStore) => ({
  savedRoots: state.savedRoots,
  savedRootsHydrated: state.savedRootsHydrated,
  upsertSavedRoot: state.upsertSavedRoot,
  removeSavedRoot: state.removeSavedRoot,
  setSavedRootProfile: state.setSavedRootProfile,
})

const selectRuntimeInspectorStoreState = (state: AppStore) => ({
  nodeCount: Object.keys(state.nodes).length,
  linkCount: state.links.length,
  maxNodes: state.graphCaps.maxNodes,
  capReached: state.graphCaps.capReached,
  devicePerformanceProfile: state.devicePerformanceProfile,
  effectiveGraphCaps: state.effectiveGraphCaps,
  effectiveImageBudget: state.effectiveImageBudget,
  zapStatus: state.zapLayer.status,
  zapEdgeCount: state.zapLayer.edges.length,
  zapSkippedReceipts: state.zapLayer.skippedReceipts,
  zapLoadedFrom: state.zapLayer.loadedFrom,
  zapMessage: state.zapLayer.message,
  zapTargetCount: state.zapLayer.targetPubkeys.length,
  zapLastUpdatedAt: state.zapLayer.lastUpdatedAt,
})

const HEX_PUBKEY_RE = /^[0-9a-f]{64}$/i

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

const withClientSceneSignature = <T extends CanonicalGraphSceneState>(
  state: T,
): T => ({
  ...state,
  sceneSignature: createClientSceneSignature(state),
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
  overrideStatus,
  isGraphStale,
  onApply,
  onRevert,
}: {
  relayUrls: readonly string[]
  overrideStatus: string
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
      <h4>Relays conectados</h4>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: 12, color: 'var(--sg-fg-muted)' }}>Bridge override</span>
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
          {overrideStatus} / {isGraphStale ? 'stale' : 'live'}
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
        <button
          className="sg-btn"
          onClick={() => {
            startTransition(() => {
              void onRevert()
                .then(() => { setMessage('Se revirtio el override de relays.') })
                .catch((error) => {
                  setMessage(error instanceof Error ? error.message : 'No se pudo revertir el override.')
                })
            })
          }}
          style={{ flex: 'none' }}
          type="button"
        >
          Revertir
        </button>
      </div>
      {message ? <p style={{ marginTop: 8, fontSize: 12, color: 'var(--sg-fg-muted)' }}>{message}</p> : null}
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

function RenderOptionsPanel({
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
      <h4>Avatares y monogramas</h4>
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
      <div className="sg-setting-row">
        <div>
          <div className="sg-setting-row__lbl">Letras de monograma</div>
          <div className="sg-setting-row__desc">Iniciales dentro del fallback</div>
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
      <div className="sg-setting-row">
        <div>
          <div className="sg-setting-row__lbl">Ocultar fotos en movimiento</div>
          <div className="sg-setting-row__desc">Pasa a monograma durante pan/drag o cuando el nodo cambia rápido de posición en pantalla</div>
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
      <div className="sg-slider-row">
        <div className="sg-slider-row__head">
          <span className="sg-slider-row__lbl">Radio cerca del mouse</span>
          <span className="sg-slider-row__val">{avatarRuntimeOptions.hoverRevealRadiusPx.toFixed(0)}px</span>
        </div>
        <p style={{ fontSize: 10.5, color: 'var(--sg-fg-faint)', margin: '2px 0 4px' }}>
          Fuerza fotos para los nodos más cercanos dentro de ese radio.
        </p>
        <input
          className="sg-slider"
          max={180}
          min={0}
          onChange={(event) => {
            onAvatarRuntimeOptionsChange({ ...avatarRuntimeOptions, hoverRevealRadiusPx: Number.parseInt(event.target.value, 10) })
          }}
          step={4}
          type="range"
          value={avatarRuntimeOptions.hoverRevealRadiusPx}
        />
      </div>
      <div className="sg-slider-row">
        <div className="sg-slider-row__head">
          <span className="sg-slider-row__lbl">Máx cerca del mouse</span>
          <span className="sg-slider-row__val">{avatarRuntimeOptions.hoverRevealMaxNodes.toFixed(0)} nodos</span>
        </div>
        <p style={{ fontSize: 10.5, color: 'var(--sg-fg-faint)', margin: '2px 0 4px' }}>
          Limita cuántas fotos puede forzar el radio; prioriza las más cercanas al puntero.
        </p>
        <input
          className="sg-slider"
          max={96}
          min={0}
          onChange={(event) => {
            onAvatarRuntimeOptionsChange({ ...avatarRuntimeOptions, hoverRevealMaxNodes: Number.parseInt(event.target.value, 10) })
          }}
          step={4}
          type="range"
          value={avatarRuntimeOptions.hoverRevealMaxNodes}
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
      <div className="sg-setting-row">
        <div>
          <div className="sg-setting-row__lbl">Bucket captura max</div>
          <div className="sg-setting-row__desc">Presupuesto visual para PNG social</div>
        </div>
        <select
          className="sg-select"
          onChange={(event) => onAvatarRuntimeOptionsChange({
            ...avatarRuntimeOptions,
            maxSocialCaptureBucket: Number.parseInt(event.target.value, 10) as AvatarRuntimeOptions['maxSocialCaptureBucket'],
          })}
          value={avatarRuntimeOptions.maxSocialCaptureBucket}
        >
          {[128, 256, 512, 1024].map((bucket) => (
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
            ['Frame EMA', avatarPerfSnapshot ? `${avatarPerfSnapshot.emaFrameMs.toFixed(1)}ms` : 'n/a'],
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

function PersonSearchPanel({
  query,
  matches,
  totalNodeCount,
  onChange,
  onClear,
  onSelect,
}: {
  query: string
  matches: readonly PersonSearchMatch[]
  totalNodeCount: number
  onChange: (value: string) => void
  onClear: () => void
  onSelect: (pubkey: string) => void
}) {
  const trimmedQuery = query.trim()
  const visibleMatches = matches.slice(0, 8)
  const hasMoreMatches = matches.length > visibleMatches.length
  const status = !trimmedQuery
    ? `Busca entre ${totalNodeCount} nodos visibles.`
    : matches.length === 0
      ? 'Sin coincidencias visibles.'
      : `${matches.length} coincidencia${matches.length === 1 ? '' : 's'} visible${matches.length === 1 ? '' : 's'}.`

  return (
    <div className="sg-person-search">
      <label className="sg-person-search__label" htmlFor="sigma-person-search">
        Nombre
      </label>
      <div className="sg-person-search__row">
        <input
          aria-describedby="sigma-person-search-status"
          autoComplete="off"
          autoFocus
          className="sg-person-search__field"
          id="sigma-person-search"
          inputMode="search"
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return
            const firstMatch = visibleMatches[0]
            if (!firstMatch) return
            event.preventDefault()
            onSelect(firstMatch.pubkey)
          }}
          placeholder="Ej: fiatjaf, la crypta, mari"
          spellCheck={false}
          type="search"
          value={query}
        />
        <button
          className="sg-btn"
          disabled={!trimmedQuery}
          onClick={onClear}
          style={{ flex: 'none' }}
          type="button"
        >
          Limpiar
        </button>
      </div>
      <p
        className="sg-person-search__status"
        id="sigma-person-search-status"
      >
        {status}
      </p>
      {trimmedQuery ? (
        <div className="sg-person-search__results">
          {visibleMatches.map((match) => (
            <button
              className="sg-person-search__result"
              key={match.pubkey}
              onClick={() => onSelect(match.pubkey)}
              type="button"
            >
              <span className="sg-person-search__result-name">{match.label}</span>
              <span className="sg-person-search__result-key">
                {match.pubkey.slice(0, 10)}...
              </span>
            </button>
          ))}
          {hasMoreMatches ? (
            <div className="sg-person-search__more">
              +{matches.length - visibleMatches.length} mas resaltadas en el grafo
            </div>
          ) : null}
        </div>
      ) : (
        <p className="sg-person-search__hint">
          Coincide por fragmento, sin importar mayusculas, minusculas o acentos.
        </p>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function GraphAppV2() {
  const searchParams = useSearchParams()
  const fixtureName = searchParams.get('fixture')
  const isTestMode = searchParams.get('testMode') === '1'
  const isFixtureMode = isTestMode && fixtureName === 'drag-local'
  const [bridge] = useState(() => new LegacyKernelBridge())
  const [loadFeedback, setLoadFeedback] = useState<string | null>(
    isFixtureMode ? 'Fixture drag-local cargado para Playwright.' : null,
  )
  const [actionFeedback, setActionFeedback] = useState<string | null>(null)
  const [isIdentityHelpDismissed, setIsIdentityHelpDismissed] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.sessionStorage.getItem(IDENTITY_FIRST_RUN_HELP_KEY) === '1'
  })
  const liveSceneState = useSyncExternalStore(
    bridge.subscribeScene,
    bridge.getSceneState,
    bridge.getSceneState,
  )
  const liveUiState = useSyncExternalStore(
    bridge.subscribeUi,
    bridge.getUiState,
    bridge.getUiState,
  )
  const [fixtureState, setFixtureState] = useState<CanonicalGraphState | null>(
    () => (isFixtureMode ? createDragLocalFixture().state : null),
  )
  const [lastViewportRatio, setLastViewportRatio] = useState<number | null>(null)
  const [dragInfluenceTuning, setDragInfluenceTuning] =
    useState<DragNeighborhoodInfluenceTuning>(DEFAULT_DRAG_NEIGHBORHOOD_INFLUENCE_TUNING)
  const [physicsTuning, setPhysicsTuning] =
    useState<ForceAtlasPhysicsTuning>(DEFAULT_FORCE_ATLAS_PHYSICS_TUNING)
  const [devPhysicsAutoFreezeEnabled, setDevPhysicsAutoFreezeEnabled] = useState(false)
  const [avatarRuntimeOptions, setAvatarRuntimeOptions] =
    useState<AvatarRuntimeOptions>(DEFAULT_AVATAR_RUNTIME_OPTIONS)
  const [avatarPerfSnapshot, setAvatarPerfSnapshot] = useState<PerfBudgetSnapshot | null>(null)
  const [socialCaptureFormat, setSocialCaptureFormat] =
    useState<SocialGraphCaptureFormat>('wide')
  const [socialCapturePhase, setSocialCapturePhase] =
    useState<SocialGraphCapturePhase | null>(null)
  const [socialCaptureProgress, setSocialCaptureProgress] =
    useState<SocialCaptureDebugProgressSnapshot | null>(null)
  const [isSocialCaptureBusy, setIsSocialCaptureBusy] = useState(false)
  const [activeSettingsTab, setActiveSettingsTab] = useState<SigmaSettingsTab>('relays')
  const [isRootSheetOpen, setIsRootSheetOpen] = useState(!isFixtureMode)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isRuntimeInspectorOpen, setIsRuntimeInspectorOpen] = useState(false)
  const [isPersonSearchOpen, setIsPersonSearchOpen] = useState(false)
  const [personSearchQuery, setPersonSearchQuery] = useState('')
  const [isRootLoadScreenOpen, setIsRootLoadScreenOpen] = useState(false)
  // Rail toggles — direct controls, decoupled from the settings panel
  const [physicsEnabled, setPhysicsEnabled] = useState(true)
  const [showZaps, setShowZaps] = useState(true)
  const sigmaHostRef = useRef<SigmaCanvasHostHandle | null>(null)
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
    if (process.env.NEXT_PUBLIC_GRAPH_V2_PERF !== '1') return
    console.info('[graph-v2 perf] enabled')
    const id = setInterval(() => {
      const proj = getProjectionCacheStats()
      const snap = getSnapshotCacheStats()
      console.info(
        `[graph-v2 perf] projection calls=${proj.calls} hits=${proj.hits} misses=${proj.misses}` +
        ` | snapshot calls=${snap.calls} hits=${snap.hits} misses=${snap.misses}`,
      )
    }, 2000)
    return () => clearInterval(id)
  }, [])

  const sceneState = fixtureState ?? liveSceneState
  const uiState = fixtureState ? pickFixtureUiState(fixtureState) : liveUiState
  const controller = useMemo(() => new GraphInteractionController(bridge), [bridge])

  useEffect(() => {
    if (sceneState.rootPubkey && !isFixtureMode) {
      setIsRootSheetOpen(false)
    }
  }, [sceneState.rootPubkey, isFixtureMode])

  const isDev = process.env.NODE_ENV === 'development'
  const canUseRuntimeInspector = isDev

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (isPersonSearchOpen) { setIsPersonSearchOpen(false); return }
        if (isSettingsOpen) { setIsSettingsOpen(false); return }
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
          setIsPersonSearchOpen(true)
          return
        }
        setIsRootSheetOpen(true)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [canUseRuntimeInspector, sceneState.rootPubkey, isPersonSearchOpen, isRootSheetOpen, isRuntimeInspectorOpen, isSettingsOpen])

  const callbacks = useMemo<GraphInteractionCallbacks>(
    () =>
      isFixtureMode
        ? {
            onNodeClick: (pubkey: string) => {
              setFixtureState((current) =>
                current ? { ...current, selectedNodePubkey: pubkey } : current,
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
        : controller.callbacks,
    [controller, isFixtureMode],
  )

  const prevSignatureRef = useRef<string | null>(null)
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_GRAPH_V2_PERF !== '1') return
    const sig = sceneState.sceneSignature
    const prev = prevSignatureRef.current
    if (prev !== null && prev !== sig) {
      const prevParts = prev.split('|')
      const nextParts = sig.split('|')
      const KEYS = ['rootPubkey','activeLayer','connectionsSourceLayer','selectedNodePubkey','graphRevision','inboundGraphRevision','connectionsLinksRevision','nodeVisualRevision','expandedNodePubkeys','nodeCount','edgeCount','pinnedNodePubkeys']
      const changed = KEYS.filter((k, i) => prevParts[i] !== nextParts[i])
      console.info('[graph-v2 perf] sceneSignature changed:', changed.join(', '))
    }
    prevSignatureRef.current = sig
  })

  const scene = useMemo(
    () => buildGraphSceneSnapshot(sceneState),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sceneState.sceneSignature],
  )
  const deferredScene = useDeferredValue(scene)
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
    () => applyPersonSearchHighlight(deferredScene, personSearchMatches),
    [deferredScene, personSearchMatches],
  )
  const detail = useMemo(() => buildNodeDetailProjection(sceneState), [sceneState])

  useEffect(() => {
    if (isFixtureMode || !sceneState.rootPubkey || deferredScene.render.nodes.length === 0) {
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
      const scenePubkeys = deferredScene.render.nodes.map((node) => node.pubkey)
      const selection = selectVisibleProfileWarmupPubkeys({
        viewportPubkeys,
        scenePubkeys,
        nodesByPubkey: sceneState.nodesByPubkey,
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
          nodesByPubkey: sceneState.nodesByPubkey,
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

      if (process.env.NODE_ENV === 'development') {
        console.debug('[profile-warmup] visible profile batch', {
          requested: pubkeys.length,
          viewportPubkeys: selection.viewportPubkeyCount,
          scenePubkeys: selection.scenePubkeyCount,
          eligible: selection.eligibleCount,
          skipped: selection.skipped,
          sample: pubkeys.slice(0, 6).map((pubkey) => pubkey.slice(0, 12)),
        })
      }

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
    deferredScene.render.nodes,
    sceneState.nodesByPubkey,
    sceneState.rootPubkey,
    isFixtureMode,
  ])

  // Pre-calcular la capa completa (graph) en segundo plano para que el
  // usuario no tenga penalidad de tiempo al alternar desde "mutuos"
  useEffect(() => {
    if (isFixtureMode || sceneState.activeLayer === 'graph' || !sceneState.rootPubkey) {
      return
    }

    const timeoutId = setTimeout(() => {
      const warmupState = withClientSceneSignature({
        ...sceneState,
        activeLayer: 'graph',
      })
      // Ejecutar la proyección almacena la salida en snapshotCache
      buildGraphSceneSnapshot(warmupState)
    }, 200)

    return () => {
      clearTimeout(timeoutId)
    }
  }, [isFixtureMode, sceneState])

  const currentRootNode = sceneState.rootPubkey
    ? sceneState.nodesByPubkey[sceneState.rootPubkey] ?? null
    : null
  const rootLoadMessage = uiState.rootLoad.message
  const visibleLoadFeedback =
    loadFeedback === 'Cargando root...' && rootLoadMessage
      ? rootLoadMessage
      : loadFeedback ?? rootLoadMessage
  const rootLoadStatus = uiState.rootLoad.status
  // Show overlay while the root is actively being fetched, but not inside the
  // loader modal (the modal has its own feedback) and not if we already have
  // a meaningful number of nodes drawn.
  const isGraphLoading =
    !isRootSheetOpen &&
    (isRootLoadScreenOpen ||
      (sceneState.rootPubkey !== null &&
        rootLoadStatus === 'loading' &&
        scene.render.nodes.length < 3))
  const shouldShowLoadProgressHud =
    !isGraphLoading &&
    !isRootSheetOpen &&
    sceneState.rootPubkey !== null &&
    uiState.rootLoad.visibleLinkProgress !== null &&
    (rootLoadStatus === 'loading' || rootLoadStatus === 'partial')
  const isDragFixtureLab = fixtureName === 'drag-local'
  const hasSavedRoots = savedRoots.length > 0
  const shouldShowSavedRootsSection = !savedRootsHydrated || hasSavedRoots

  const updateFixtureState = useCallback((updater: (current: CanonicalGraphState) => CanonicalGraphState) => {
    setFixtureState((current) => current ? withClientSceneSignature(updater(current)) : current)
  }, [])

  const dismissIdentityHelp = useCallback(() => {
    setIsIdentityHelpDismissed(true)
    if (typeof window === 'undefined') return
    window.sessionStorage.setItem(IDENTITY_FIRST_RUN_HELP_KEY, '1')
  }, [])

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

  const handleExploreConnections = useCallback((pubkey: string, isExpanded: boolean) => {
    dismissIdentityHelp()
    if (isExpanded) return

    startTransition(() => {
      if (isFixtureMode) {
        setActionFeedback('El fixture no trae conexiones por relay.')
        return
      }
      void bridge.expandNode(pubkey)
        .then((result) => {
          setActionFeedback(result.message)
        })
        .catch((error) => {
          setActionFeedback(
            error instanceof Error
              ? `No se pudo expandir: ${error.message}`
              : 'No se pudo expandir el nodo seleccionado.',
          )
        })
    })
  }, [bridge, dismissIdentityHelp, isFixtureMode])

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

  const visiblePubkeys = useMemo(
    () => deferredScene.render.nodes.map((node) => node.pubkey),
    [deferredScene.render.nodes],
  )
  const visibleNodeSet = useMemo(() => new Set(visiblePubkeys), [visiblePubkeys])

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
      if (shouldTrace) {
        traceZapFlow('uiZapGate.dropped', {
          reason: 'endpoint-not-visible',
          fromPubkey: zap.fromPubkey,
          toPubkey: zap.toPubkey,
          sats: zap.sats,
          hasVisibleFrom,
          hasVisibleTo,
          visibleNodeCount: visibleNodeSet.size,
        })
      }
      return false
    }
    
    // Verificar que exista una conexión estructurada, sin importar la dirección
    let hasConnection = false
    let matchedConnection: { source: string; target: string; relation: string; origin?: string } | null = null
    for (const edge of Object.values(sceneState.edgesById)) {
      if (
        (edge.source === zap.fromPubkey && edge.target === zap.toPubkey) ||
        (edge.source === zap.toPubkey && edge.target === zap.fromPubkey)
      ) {
        hasConnection = true
        matchedConnection = {
          source: edge.source,
          target: edge.target,
          relation: edge.relation,
          origin: edge.origin,
        }
        break
      }
    }
    
    if (!hasConnection) {
      if (shouldTrace) {
        traceZapFlow('uiZapGate.dropped', {
          reason: 'missing-scene-connection',
          fromPubkey: zap.fromPubkey,
          toPubkey: zap.toPubkey,
          sats: zap.sats,
          sceneEdgeCount: Object.keys(sceneState.edgesById).length,
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
  }, [sceneState.edgesById, showZaps, visibleNodeSet])

  // Propagate physics pause/resume to the Sigma runtime when toggled.
  useEffect(() => {
    sigmaHostRef.current?.setPhysicsSuspended(!physicsEnabled)
  }, [physicsEnabled])

  const shouldEnableLiveZapFeed =
    showZaps && !isFixtureMode && sceneState.activeLayer !== 'connections'
  const handleLiveZap = useCallback((zap: ParsedZap) => {
    handleZap(zap)
    setLiveZapFeedFeedback(null)
  }, [handleZap])
  useLiveZapFeed({
    visiblePubkeys,
    enabled: shouldEnableLiveZapFeed,
    onZap: handleLiveZap,
    onDropped: (msg: string) => {
      setLiveZapFeedFeedback(msg)
      setZapFeedback(msg)
    },
  })

  useEffect(() => {
    if (!shouldEnableLiveZapFeed) {
      setLiveZapFeedFeedback(null)
    }
  }, [shouldEnableLiveZapFeed])

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
    setZapFeedback(
      played
        ? `Zap simulado: ${sats} sats ${fromPubkey.slice(0, 8)}… → ${toPubkey.slice(0, 8)}…`
        : 'No se pudo reproducir el zap simulado.',
    )
  }, [findSimulationPair, handleZap])

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
    setIsRuntimeInspectorOpen(false)
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

  const handleDeleteSavedRoot = useCallback(
    (savedRoot: SavedRootEntry) => { removeSavedRoot(savedRoot.pubkey) },
    [removeSavedRoot],
  )

  // ── Derived values for UI components ───────────────────────────────────────

  const hasRoot = sceneState.rootPubkey !== null

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
      swatch: 'oklch(76% 0.1 180)',
      hint: 'Conexiones: vinculos entre cuentas visibles, sin centrar la raiz.',
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
      v: `${uiState.relayState.isGraphStale ? Math.max(0, uiState.relayState.urls.length - 1) : uiState.relayState.urls.length}/${uiState.relayState.urls.length}`,
      tone: uiState.relayState.isGraphStale ? 'warn' : 'good',
    },
    {
      k: 'Frame',
      v: avatarPerfSnapshot ? `${avatarPerfSnapshot.emaFrameMs.toFixed(1)}ms` : '—',
      tone: avatarPerfSnapshot && avatarPerfSnapshot.emaFrameMs > 20 ? 'warn' : 'default',
    },
  ], [
    avatarPerfSnapshot,
    deferredScene.physics.diagnostics.edgeCount,
    deferredScene.render.diagnostics.nodeCount,
    deferredScene.render.diagnostics.visibleEdgeCount,
    physicsEnabled,
    uiState.relayState.isGraphStale,
    uiState.relayState.urls.length,
  ])

  // Rail buttons — every entry is a DIRECT action or toggle.
  // Settings panel keeps the detailed controls; rail gives quick toggles
  // without duplicating what the panel does.
  const handleOpenRootSheet = useCallback(() => {
    setIsPersonSearchOpen(false)
    setIsSettingsOpen(false)
    setIsRuntimeInspectorOpen(false)
    setIsRootSheetOpen(true)
  }, [])

  const handleOpenPersonSearch = useCallback(() => {
    if (!sceneState.rootPubkey) {
      setIsRootSheetOpen(true)
      return
    }
    setIsRootSheetOpen(false)
    setIsSettingsOpen(false)
    setIsRuntimeInspectorOpen(false)
    setIsPersonSearchOpen(true)
  }, [sceneState.rootPubkey])

  const handleClearPersonSearch = useCallback(() => {
    setPersonSearchQuery('')
  }, [])

  const handleSelectPersonSearchMatch = useCallback((pubkey: string) => {
    if (isFixtureMode) {
      updateFixtureState((current) => ({ ...current, selectedNodePubkey: pubkey }))
    } else {
      bridge.selectNode(pubkey)
    }
    setIsPersonSearchOpen(false)
  }, [bridge, isFixtureMode, updateFixtureState])

  const handleToggleSettings = useCallback(() => {
    if (isSettingsOpen) {
      setIsSettingsOpen(false)
      return
    }
    openSettingsTab(activeSettingsTab)
  }, [activeSettingsTab, isSettingsOpen, openSettingsTab])

  const handleToggleRuntimeInspector = useCallback(() => {
    if (!canUseRuntimeInspector) {
      return
    }
    setIsPersonSearchOpen(false)
    setIsSettingsOpen(false)
    setIsRootSheetOpen(false)
    setIsRuntimeInspectorOpen((current) => !current)
  }, [canUseRuntimeInspector])

  const handleTogglePhysics = useCallback(() => {
    setPhysicsEnabled((current) => {
      const next = !current
      setActionFeedback(next ? 'Fisica reanudada.' : 'Fisica en pausa.')
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

  const handleRecenter = useCallback(() => {
    sigmaHostRef.current?.recenterCamera()
  }, [])

  const handleStaleRelays = useCallback(() => {
    if (!uiState.relayState.isGraphStale) {
      setActionFeedback('Relays al dia: no hay override para revertir.')
      return
    }
    void handleRevertRelays()
  }, [handleRevertRelays, uiState.relayState.isGraphStale])

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

    const state = host.getAvatarRuntimeDebugSnapshot()
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

  const handleShareImage = useCallback(() => {
    if (isSocialCaptureBusy) {
      return
    }
    const host = sigmaHostRef.current
    if (!host) {
      setActionFeedback('El grafo todavia no esta listo para capturar.')
      return
    }

    setIsSocialCaptureBusy(true)
    setSocialCapturePhase('preparing')
    setSocialCaptureProgress(null)
    let latestCaptureProgress: SocialCaptureDebugProgressSnapshot | null = null

    void host
      .captureSocialGraph({
        format: socialCaptureFormat,
        onProgress: (progress) => {
          setSocialCapturePhase(progress.phase)
          if (
            (progress.phase === 'loading-avatars' ||
              progress.phase === 'generating-image' ||
              progress.phase === 'completed') &&
            progress.totalAvatarCount !== undefined
          ) {
            const reasons = progress.failureReasons ?? {}
            const topFailureReason = Object.entries(reasons).sort(
              (a, b) => b[1] - a[1],
            )[0]?.[0]
            const hosts = progress.failureHosts ?? {}
            const topFailureHost = Object.entries(hosts).sort(
              (a, b) => b[1] - a[1],
            )[0]?.[0]
            const hostReasons = progress.failureHostReasons ?? {}
            const topFailureHostReason = Object.entries(hostReasons).sort(
              (a, b) => b[1] - a[1],
            )[0]?.[0]
            latestCaptureProgress = {
              loaded: progress.loadedAvatarCount ?? 0,
              total: progress.totalAvatarCount,
              failed: progress.failedAvatarCount,
              missing: progress.missingPhotoCount,
              drawn: progress.drawnImageCount,
              fallbackWithPhoto: progress.fallbackWithPhotoCount,
              attempted: progress.attemptedAvatarCount,
              retried: progress.retriedAvatarCount,
              timedOut: progress.timedOut,
              topFailureReason,
              topFailureHost,
              topFailureHostReason,
              failureReasons: progress.failureReasons,
              failureHosts: progress.failureHosts,
              failureHostReasons: progress.failureHostReasons,
              failureSamples: progress.failureSamples,
              drawFallbackReasons: progress.drawFallbackReasons,
              drawFallbackHosts: progress.drawFallbackHosts,
              drawFallbackSamples: progress.drawFallbackSamples,
            }
            setSocialCaptureProgress(latestCaptureProgress)
          }
        },
      })
      .then((blob) => {
        const generatedAt = new Date().toISOString()
        const stamp = generatedAt.replace(/[:.]/g, '-')
        const pngFileName = `sigma-graph-${socialCaptureFormat}-${stamp}.png`
        downloadBlob(blob, pngFileName)
        if (isSocialCaptureDebugDownloadEnabled()) {
          const debugPayload = buildSocialCaptureDebugPayload({
            generatedAt,
            format: socialCaptureFormat,
            formatLabel: SOCIAL_CAPTURE_FORMAT_LABELS[socialCaptureFormat],
            pngFileName,
            progress: latestCaptureProgress,
            browser: readSocialCaptureDebugBrowserSnapshot(),
            location: readSocialCaptureDebugLocationSnapshot(),
          })
          downloadBlob(
            new Blob([JSON.stringify(debugPayload, null, 2)], {
              type: 'application/json',
            }),
            buildSocialCaptureDebugFilename(socialCaptureFormat, stamp),
          )
        }
        const failedCount =
          latestCaptureProgress?.fallbackWithPhoto ??
          latestCaptureProgress?.failed ??
          0
        const summary = latestCaptureProgress
          ? ` ${latestCaptureProgress.drawn ?? latestCaptureProgress.loaded}/${latestCaptureProgress.total} fotos reales${
              latestCaptureProgress.missing
                ? `; ${latestCaptureProgress.missing} sin foto`
                : ''
            }${
              failedCount
                ? `; ${failedCount} con foto fallida${
                    latestCaptureProgress?.topFailureReason
                      ? ` (${latestCaptureProgress.topFailureReason})`
                      : ''
                  }`
                : ''
            }${
              latestCaptureProgress?.topFailureHost
                ? `; host principal: ${latestCaptureProgress.topFailureHost}`
                : ''
            }${
              latestCaptureProgress?.topFailureHostReason
                ? `; patrón: ${latestCaptureProgress.topFailureHostReason}`
                : ''
            }${
              latestCaptureProgress?.retried
                ? `; ${latestCaptureProgress.retried} reintentos`
                : ''
            }${latestCaptureProgress?.timedOut ? '; timeout parcial' : ''}.`
          : ''
        setActionFeedback(
          `Imagen ${SOCIAL_CAPTURE_FORMAT_LABELS[socialCaptureFormat]} generada.${summary}`,
        )
      })
      .catch((error: unknown) => {
        setActionFeedback(
          error instanceof Error
            ? `No se pudo generar la imagen: ${error.message}`
            : 'No se pudo generar la imagen.',
        )
      })
      .finally(() => {
        setIsSocialCaptureBusy(false)
        setSocialCapturePhase(null)
        setSocialCaptureProgress(null)
      })
  }, [isSocialCaptureBusy, socialCaptureFormat])

  const socialCaptureStatus = useMemo(() => {
    if (!socialCapturePhase) {
      return null
    }
    const label = SOCIAL_CAPTURE_PHASE_LABELS[socialCapturePhase]
    if (
      (socialCapturePhase === 'loading-avatars' ||
        socialCapturePhase === 'generating-image' ||
        socialCapturePhase === 'completed') &&
      socialCaptureProgress
    ) {
      return `${label} ${socialCaptureProgress.drawn ?? socialCaptureProgress.loaded}/${socialCaptureProgress.total}`
    }
    if (socialCapturePhase !== 'loading-avatars' || !socialCaptureProgress) {
      return label
    }
    return `${label} ${socialCaptureProgress.loaded}/${socialCaptureProgress.total}`
  }, [socialCapturePhase, socialCaptureProgress])

  const railButtons: RailButton[] = useMemo(() => [
    {
      id: 'settings',
      tip: isSettingsOpen ? 'Cerrar ajustes' : 'Ajustes',
      icon: <GearIcon />,
      active: isSettingsOpen,
      onClick: handleToggleSettings,
    },
    ...(canUseRuntimeInspector
      ? [{
          id: 'runtime',
          tip: isRuntimeInspectorOpen
            ? 'Cerrar inspector de runtime'
            : 'Inspector de runtime (Shift + D)',
          icon: <PulseIcon />,
          active: isRuntimeInspectorOpen,
          onClick: handleToggleRuntimeInspector,
        } satisfies RailButton]
      : []),
    {
      id: 'physics',
      tip: physicsEnabled ? 'Pausar física' : 'Reanudar física',
      icon: <AtomIcon />,
      active: physicsEnabled,
      onClick: handleTogglePhysics,
    },
    {
      id: 'zaps',
      tip: showZaps ? 'Ocultar zaps' : 'Mostrar zaps',
      icon: <ZapIcon />,
      active: showZaps,
      onClick: handleToggleZaps,
      dividerAfter: true,
    },
    {
      id: 'recenter',
      tip: 'Recentrar vista',
      icon: <TargetIcon />,
      onClick: handleRecenter,
    },
    {
      id: 'stale',
      tip: uiState.relayState.isGraphStale ? 'Revertir relays' : 'Relays al día',
      icon: <ClockIcon />,
      active: uiState.relayState.isGraphStale,
      onClick: handleStaleRelays,
      dividerAfter: true,
    },
    {
      id: 'search',
      tip: personSearchQuery.trim()
        ? `Buscar persona: ${personSearchMatches.length} coincidencia${personSearchMatches.length === 1 ? '' : 's'}`
        : 'Buscar persona (/)',
      icon: <SearchIcon />,
      active: isPersonSearchOpen || personSearchQuery.trim().length > 0,
      onClick: handleOpenPersonSearch,
    },
  ], [
    canUseRuntimeInspector,
    handleOpenPersonSearch,
    handleRecenter,
    handleStaleRelays,
    handleTogglePhysics,
    handleToggleRuntimeInspector,
    handleToggleSettings,
    handleToggleZaps,
    isPersonSearchOpen,
    isRuntimeInspectorOpen,
    isSettingsOpen,
    personSearchMatches.length,
    personSearchQuery,
    physicsEnabled,
    showZaps,
    uiState.relayState.isGraphStale,
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
    sigmaHostRef.current?.recenterCamera()
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
      case 'renderer':
        return (
          <RenderOptionsPanel
            avatarPerfSnapshot={avatarPerfSnapshot}
            avatarRuntimeOptions={avatarRuntimeOptions}
            onAvatarRuntimeOptionsChange={setAvatarRuntimeOptions}
          />
        )
      case 'relays':
        return (
          <RelayEditor
            isGraphStale={uiState.relayState.isGraphStale}
            onApply={handleApplyRelays}
            onRevert={handleRevertRelays}
            overrideStatus={uiState.relayState.overrideStatus}
            relayUrls={uiState.relayState.urls}
          />
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
            <RenderOptionsPanel
              avatarPerfSnapshot={avatarPerfSnapshot}
              avatarRuntimeOptions={avatarRuntimeOptions}
              onAvatarRuntimeOptionsChange={setAvatarRuntimeOptions}
            />
            <PhysicsTuningPanel
              onChange={updatePhysicsTuning}
              onReset={() => setPhysicsTuning(DEFAULT_FORCE_ATLAS_PHYSICS_TUNING)}
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
                ['Relays',       String(uiState.relayState.urls.length)],
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
    const exploreActionLabel = detail.isExpanded ? 'Conexiones exploradas' : 'Explorar conexiones'
    const expansionState = detail.node.nodeExpansionState
    const expansionStatusLabel = expansionState
      ? NODE_EXPANSION_STATUS_LABELS[expansionState.status]
      : NODE_EXPANSION_STATUS_LABELS.idle
    const expansionMessage = expansionState?.message?.trim() || null
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
        <div className="sg-node-hero">
          <div style={{ position: 'relative' }}>
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
              {detail.pubkey ? (
                <button
                  aria-label={pinActionLabel}
                  aria-pressed={detail.isPinned}
                  className={`sg-node-pin-action${detail.isPinned ? ' sg-node-pin-action--active' : ''}`}
                  onClick={() => {
                    if (!detail.pubkey) return
                    handleToggleDetailPin(detail.pubkey)
                  }}
                  title={pinActionLabel}
                  type="button"
                >
                  <PinIcon />
                </button>
              ) : null}
            </div>
            <div className="sg-node-hero__handle">{detail.pubkey?.slice(0, 12)}…</div>
            <div className="sg-node-hero__badges">
              <span className={`sg-badge ${relBadgeClass}`}>{relBadge}</span>
              {detail.nip05 && <span className="sg-badge sg-badge--ok">nip05</span>}
              {detail.isExpanded && <span className="sg-badge">conexiones exploradas</span>}
            </div>
          </div>
        </div>

        {shouldShowIdentityHelp ? (
          <div className="sg-identity-help">
            <p>Abriste una identidad. Explorá sus conexiones o anclala para compararla.</p>
            <button
              className={`sg-btn${detail.isExpanded ? '' : ' sg-btn--primary'}`}
              onClick={() => {
                if (detail.isExpanded) {
                  dismissIdentityHelp()
                  return
                }
                if (!detail.pubkey) return
                handleExploreConnections(detail.pubkey, detail.isExpanded)
              }}
              type="button"
            >
              {detail.isExpanded ? 'Entendido' : exploreActionLabel}
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
          </span>
        </div>

        <div className="sg-actions">
          <button
            className={`sg-btn${detail.isExpanded ? '' : ' sg-btn--primary'}`}
            disabled={detail.isExpanded}
            onClick={() => {
              if (!detail.pubkey) return
              handleExploreConnections(detail.pubkey, detail.isExpanded)
            }}
            type="button"
          >
            {exploreActionLabel}
          </button>
        </div>
      </div>
    )
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const isPersonSearchPanelOpen = isPersonSearchOpen && !isRootSheetOpen && hasRoot
  const isIdentityPanelOpen =
    detail.node !== null &&
    !isRootSheetOpen &&
    !isSettingsOpen &&
    !isPersonSearchPanelOpen
  const handleCloseSidePanel = useCallback(() => {
    if (isSettingsOpen) {
      setIsSettingsOpen(false)
      return
    }
    if (isPersonSearchPanelOpen) {
      setIsPersonSearchOpen(false)
      return
    }
    if (isIdentityPanelOpen && !isIdentityHelpDismissed) {
      dismissIdentityHelp()
    }
    if (!isFixtureMode) bridge.selectNode(null)
  }, [
    bridge,
    dismissIdentityHelp,
    isFixtureMode,
    isIdentityHelpDismissed,
    isIdentityPanelOpen,
    isPersonSearchPanelOpen,
    isSettingsOpen,
  ])

  return (
    <main
      className="sg-app"
      data-graph-loading={isGraphLoading ? 'true' : undefined}
      data-graph-v2=""
    >
      {/* Canvas — always present, full bleed under all chrome */}
      <SigmaCanvasHost
        avatarRuntimeOptions={stableAvatarRuntimeOptions}
        callbacks={callbacks}
        dragInfluenceTuning={dragInfluenceTuning}
        enableDebugProbe={isTestMode}
        hideAvatarsOnMove={stableAvatarRuntimeOptions.hideImagesOnFastNodes}
        onAvatarPerfSnapshot={handleAvatarPerfSnapshot}
        physicsAutoFreezeEnabled={isDev ? devPhysicsAutoFreezeEnabled : true}
        physicsTuning={physicsTuning}
        ref={sigmaHostRef}
        scene={displayScene}
      />

      {/* Loading overlay — while root data is arriving */}
      {isGraphLoading && (
        <SigmaLoadingOverlay
          identityLabel={rootDisplayName ?? sceneState.rootPubkey?.slice(0, 10) ?? null}
          message={visibleLoadFeedback}
          nodeCount={displayScene.render.nodes.length}
          relayState={uiState.relayState}
          rootLoad={uiState.rootLoad}
        />
      )}

      {/* Top bar: root chip (left) + brand (right) */}
      <SigmaTopBar
        canShare={hasRoot}
        onSwitchRoot={handleOpenRootSheet}
        onShareFormatChange={setSocialCaptureFormat}
        onShareImage={isDev ? handleShareImage : undefined}
        rootDisplayName={hasRoot ? (rootDisplayName ?? sceneState.rootPubkey?.slice(0, 10) ?? null) : null}
        rootNpub={rootNpubEncoded}
        rootPictureUrl={rootPictureUrl}
        shareBusy={isSocialCaptureBusy}
        shareFormat={socialCaptureFormat}
        shareStatus={socialCaptureStatus}
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
          <SigmaHud stats={hudStats} />
          {shouldShowLoadProgressHud && (
            <SigmaLoadProgressHud
              identityLabel={rootDisplayName ?? sceneState.rootPubkey?.slice(0, 10) ?? null}
              message={visibleLoadFeedback}
              nodeCount={displayScene.render.nodes.length}
              rootLoad={uiState.rootLoad}
            />
          )}
          {!isIdentityPanelOpen && !isPersonSearchPanelOpen && (
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

      {/* Side panel — search, detail, or settings (right), one at a time */}
      {canUseRuntimeInspector && isRuntimeInspectorOpen && hasRoot ? (
        <RuntimeInspectorDrawer
          avatarPerfSnapshot={avatarPerfSnapshot}
          deviceSummary={runtimeInspectorStoreState.deviceSummary}
          graphSummary={runtimeInspectorStoreState.graphSummary}
          liveZapFeedback={liveZapFeedFeedback}
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
      ) : null}

      {(isSettingsOpen || isPersonSearchPanelOpen || isIdentityPanelOpen) &&
        !isRuntimeInspectorOpen && (
        <SigmaSidePanel
          closeOnOutsidePointerDown={isSettingsOpen || isPersonSearchPanelOpen}
          eyebrow={isSettingsOpen ? 'AJUSTES' : isPersonSearchPanelOpen ? 'BUSCAR PERSONA' : 'IDENTIDAD'}
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
                  </button>
                ))}
              </div>
            ) : undefined
          }
        >
          {isSettingsOpen ? (
            renderSettingsContent()
          ) : isPersonSearchPanelOpen ? (
            <PersonSearchPanel
              matches={personSearchMatches}
              onChange={setPersonSearchQuery}
              onClear={handleClearPersonSearch}
              onSelect={handleSelectPersonSearchMatch}
              query={personSearchQuery}
              totalNodeCount={deferredScene.render.nodes.length}
            />
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
              feedback={visibleLoadFeedback}
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
