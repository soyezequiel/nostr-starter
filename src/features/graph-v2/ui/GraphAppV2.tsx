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
import { useAppStore } from '@/features/graph/app/store'
import type {
  AppStore,
  ConnectionsSourceLayer,
  SavedRootEntry,
  SavedRootProfileSnapshot,
} from '@/features/graph/app/store/types'
import { NpubInput } from '@/features/graph/components/NpubInput'
import { GraphInteractionController } from '@/features/graph-v2/application/InteractionController'
import { LegacyKernelBridge } from '@/features/graph-v2/bridge/LegacyKernelBridge'
import { GRAPH_V2_LAYERS } from '@/features/graph-v2/domain/invariants'
import type {
  CanonicalGraphState,
  CanonicalNode,
} from '@/features/graph-v2/domain/types'
import {
  buildGraphSceneSnapshot,
  getSnapshotCacheStats,
} from '@/features/graph-v2/projections/buildGraphSceneSnapshot'
import { getProjectionCacheStats } from '@/features/graph-v2/projections/buildLayerProjection'
import { buildNodeDetailProjection } from '@/features/graph-v2/projections/buildNodeDetailProjection'
import type {
  GraphInteractionCallbacks,
  GraphSceneSnapshot,
  GraphViewportState,
} from '@/features/graph-v2/renderer/contracts'
import {
  DEFAULT_AVATAR_RUNTIME_OPTIONS,
  type AvatarRuntimeOptions,
} from '@/features/graph-v2/renderer/avatar/types'
import type { PerfBudgetSnapshot } from '@/features/graph-v2/renderer/avatar/perfBudget'
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
  GearIcon,
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
import { SigmaLoadingOverlay } from '@/features/graph-v2/ui/SigmaLoadingOverlay'
import { SigmaSavedRootsPanel } from '@/features/graph-v2/ui/SigmaSavedRootsPanel'
import { SigmaToasts, type SigmaToast } from '@/features/graph-v2/ui/SigmaToasts'
import { useLiveZapFeed } from '@/features/graph-v2/zaps/useLiveZapFeed'
import type { ParsedZap } from '@/features/graph-v2/zaps/zapParser'
import { fetchProfileByPubkey, type NostrProfile } from '@/lib/nostr'

// ── Layer labels ──────────────────────────────────────────────────────────────

const LAYER_LABELS: Record<(typeof GRAPH_V2_LAYERS)[number], string> = {
  graph: 'Grafo',
  connections: 'Conexiones',
  following: 'Sigo',
  followers: 'Me siguen',
  mutuals: 'Mutuos',
  'following-non-followers': 'Sigo sin reciprocidad',
  'nonreciprocal-followers': 'Me siguen sin reciprocidad',
}

type SigmaSettingsTab = 'renderer' | 'physics' | 'layers' | 'relays' | 'internal'

interface RelationshipToggleState {
  following: boolean
  followers: boolean
  onlyNonReciprocal: boolean
}

const isRelationshipLayer = (
  layer: (typeof GRAPH_V2_LAYERS)[number] | ConnectionsSourceLayer,
) =>
  layer === 'following' ||
  layer === 'following-non-followers' ||
  layer === 'mutuals' ||
  layer === 'followers' ||
  layer === 'nonreciprocal-followers'

const resolveRelationshipControlLayer = (
  activeLayer: (typeof GRAPH_V2_LAYERS)[number],
  connectionsSourceLayer: ConnectionsSourceLayer,
) => (activeLayer === 'connections' ? connectionsSourceLayer : activeLayer)

const getRelationshipToggleState = (
  layer: (typeof GRAPH_V2_LAYERS)[number] | ConnectionsSourceLayer,
): RelationshipToggleState => ({
  following:
    layer === 'following' ||
    layer === 'following-non-followers' ||
    layer === 'mutuals',
  followers:
    layer === 'followers' ||
    layer === 'nonreciprocal-followers' ||
    layer === 'mutuals',
  onlyNonReciprocal:
    layer === 'following-non-followers' ||
    layer === 'nonreciprocal-followers',
})

const hasVisibleEdgeBetween = (
  scene: GraphSceneSnapshot,
  source: string,
  target: string,
) => {
  for (const edge of scene.visibleEdges) {
    if (edge.hidden) continue
    if (
      (edge.source === source && edge.target === target) ||
      (edge.source === target && edge.target === source)
    ) {
      return true
    }
  }
  return false
}

const SIGMA_SETTINGS_TABS: Array<{ id: SigmaSettingsTab; label: string }> = [
  { id: 'renderer', label: 'Render' },
  { id: 'physics', label: 'Física' },
  { id: 'layers', label: 'Capas' },
  { id: 'relays', label: 'Relays' },
  { id: 'internal', label: 'Diagnóstico' },
]

const SAVED_ROOT_PROFILE_STALE_MS = 6 * 60 * 60 * 1000
const MAX_SAVED_ROOT_REFRESHES = 6

const selectSavedRootState = (state: AppStore) => ({
  savedRoots: state.savedRoots,
  savedRootsHydrated: state.savedRootsHydrated,
  upsertSavedRoot: state.upsertSavedRoot,
  removeSavedRoot: state.removeSavedRoot,
  setSavedRootProfile: state.setSavedRootProfile,
})

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

const createClientSceneSignature = (state: CanonicalGraphState) =>
  [
    state.rootPubkey ?? 'no-root',
    state.activeLayer,
    state.connectionsSourceLayer,
    state.selectedNodePubkey ?? 'no-selection',
    Object.values(state.nodesByPubkey)
      .map((node) =>
        JSON.stringify([
          node.pubkey,
          node.label ?? '',
          node.picture ?? '',
          node.source,
          node.discoveredAt ?? '',
        ]),
      )
      .sort()
      .join('|'),
    Array.from(state.discoveryState.expandedNodePubkeys).sort().join(','),
    Object.keys(state.nodesByPubkey).length,
    Object.keys(state.edgesById).length,
    state.discoveryState.graphRevision,
    state.discoveryState.inboundGraphRevision,
    state.discoveryState.connectionsLinksRevision,
    state.relayState.urls.join(','),
    state.relayState.isGraphStale ? 'stale' : 'fresh',
    Array.from(state.pinnedNodePubkeys).sort().join(','),
  ].join('|')

const withClientSceneSignature = (
  state: CanonicalGraphState,
): CanonicalGraphState => ({
  ...state,
  sceneSignature: createClientSceneSignature(state),
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
  { key: 'centripetalForce', label: 'Fuerza centrípeta', description: 'Multiplica gravity: compacta el grafo.', min: 0.25, max: 2.5, step: 0.05 },
  { key: 'repulsionForce', label: 'Repulsión', description: 'Multiplica scalingRatio: separa nodos.', min: 0.25, max: 5, step: 0.05 },
  { key: 'linkForce', label: 'Fuerza de enlace', description: 'Multiplica edgeWeightInfluence.', min: 0.25, max: 2.5, step: 0.05 },
  { key: 'linkDistance', label: 'Distancia de enlace', description: 'Aproxima distancia sin cambiar FA2.', min: 0.5, max: 2, step: 0.05 },
  { key: 'damping', label: 'Amortiguación', description: 'Multiplica slowDown: velocidad e inercia.', min: 0.25, max: 2.5, step: 0.05 },
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
  hideAvatarsOnMove,
  avatarRuntimeOptions,
  avatarPerfSnapshot,
  onHideAvatarsOnMoveChange,
  onAvatarRuntimeOptionsChange,
}: {
  hideAvatarsOnMove: boolean
  avatarRuntimeOptions: AvatarRuntimeOptions
  avatarPerfSnapshot: PerfBudgetSnapshot | null
  onHideAvatarsOnMoveChange: (enabled: boolean) => void
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
          <div className="sg-setting-row__lbl">Ocultar durante pan/drag</div>
          <div className="sg-setting-row__desc">Cambia a monograma durante movimiento</div>
        </div>
        <button
          className={`sg-toggle${hideAvatarsOnMove ? ' sg-toggle--on' : ''}`}
          onClick={() => onHideAvatarsOnMoveChange(!hideAvatarsOnMove)}
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
          <div className="sg-setting-row__lbl">Monograma si se mueve rápido</div>
        </div>
        <button
          className={`sg-toggle${avatarRuntimeOptions.hideImagesOnFastNodes ? ' sg-toggle--on' : ''}`}
          onClick={() => onAvatarRuntimeOptionsChange({ ...avatarRuntimeOptions, hideImagesOnFastNodes: !avatarRuntimeOptions.hideImagesOnFastNodes })}
          type="button"
        />
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

// ── Main component ────────────────────────────────────────────────────────────

export default function GraphAppV2() {
  const searchParams = useSearchParams()
  const fixtureName = searchParams.get('fixture')
  const isTestMode = searchParams.get('testMode') === '1'
  const isFixtureMode = isTestMode && fixtureName === 'drag-local'
  const [bridge] = useState(() => new LegacyKernelBridge())
  const [validationFeedback, setValidationFeedback] = useState<string | null>(null)
  const [loadFeedback, setLoadFeedback] = useState<string | null>(
    isFixtureMode ? 'Fixture drag-local cargado para Playwright.' : null,
  )
  const [actionFeedback, setActionFeedback] = useState<string | null>(null)
  const liveDomainState = useSyncExternalStore(bridge.subscribe, bridge.getState, bridge.getState)
  const [fixtureState, setFixtureState] = useState<CanonicalGraphState | null>(
    () => (isFixtureMode ? createDragLocalFixture().state : null),
  )
  const [lastViewportRatio, setLastViewportRatio] = useState<number | null>(null)
  const [dragInfluenceTuning, setDragInfluenceTuning] =
    useState<DragNeighborhoodInfluenceTuning>(DEFAULT_DRAG_NEIGHBORHOOD_INFLUENCE_TUNING)
  const [physicsTuning, setPhysicsTuning] =
    useState<ForceAtlasPhysicsTuning>(DEFAULT_FORCE_ATLAS_PHYSICS_TUNING)
  const [hideAvatarsOnMove, setHideAvatarsOnMove] = useState(false)
  const [avatarRuntimeOptions, setAvatarRuntimeOptions] =
    useState<AvatarRuntimeOptions>(DEFAULT_AVATAR_RUNTIME_OPTIONS)
  const [avatarPerfSnapshot, setAvatarPerfSnapshot] = useState<PerfBudgetSnapshot | null>(null)
  const [activeSettingsTab, setActiveSettingsTab] = useState<SigmaSettingsTab>('renderer')
  const [isRootSheetOpen, setIsRootSheetOpen] = useState(!isFixtureMode)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  // Rail toggles — direct controls, decoupled from the settings panel
  const [physicsEnabled, setPhysicsEnabled] = useState(true)
  const [showZaps, setShowZaps] = useState(true)
  const sigmaHostRef = useRef<SigmaCanvasHostHandle | null>(null)
  const [zapFeedback, setZapFeedback] = useState<string | null>(null)
  const {
    savedRoots,
    savedRootsHydrated,
    upsertSavedRoot,
    removeSavedRoot,
    setSavedRootProfile,
  } = useAppStore(useShallow(selectSavedRootState))

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

  const domainState = fixtureState ?? liveDomainState
  const controller = useMemo(() => new GraphInteractionController(bridge), [bridge])

  useEffect(() => {
    if (domainState.rootPubkey && !isFixtureMode) {
      setIsRootSheetOpen(false)
    }
  }, [domainState.rootPubkey, isFixtureMode])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (isSettingsOpen) { setIsSettingsOpen(false); return }
        if (isRootSheetOpen && domainState.rootPubkey) { setIsRootSheetOpen(false); return }
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
        setIsRootSheetOpen(true)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [domainState.rootPubkey, isRootSheetOpen, isSettingsOpen])

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
            onNodeDragEnd: () => {},
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
    const sig = domainState.sceneSignature
    const prev = prevSignatureRef.current
    if (prev !== null && prev !== sig) {
      const prevParts = prev.split('|')
      const nextParts = sig.split('|')
      const KEYS = ['rootPubkey','activeLayer','connectionsSourceLayer','selectedNodePubkey','nodeVisuals','expandedNodePubkeys','nodeCount','edgeCount','graphRevision','inboundGraphRevision','connectionsLinksRevision','relayUrls','relayFreshness','pinnedNodePubkeys']
      const changed = KEYS.filter((k, i) => prevParts[i] !== nextParts[i])
      console.info('[graph-v2 perf] sceneSignature changed:', changed.join(', '))
    }
    prevSignatureRef.current = sig
  })

  const scene = useMemo(
    () => buildGraphSceneSnapshot(domainState),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [domainState.sceneSignature],
  )
  const deferredScene = useDeferredValue(scene)
  const detail = useMemo(() => buildNodeDetailProjection(domainState), [domainState])
  const currentRootNode = domainState.rootPubkey
    ? domainState.nodesByPubkey[domainState.rootPubkey] ?? null
    : null
  const rootLoadMessage = domainState.discoveryState.rootLoad.message
  const visibleLoadFeedback =
    loadFeedback === 'Cargando root...' && rootLoadMessage
      ? rootLoadMessage
      : loadFeedback ?? rootLoadMessage
  const rootLoadStatus = domainState.discoveryState.rootLoad.status
  // Show overlay while the root is actively being fetched, but not inside the
  // loader modal (the modal has its own feedback) and not if we already have
  // a meaningful number of nodes drawn.
  const isGraphLoading =
    domainState.rootPubkey !== null &&
    !isRootSheetOpen &&
    (rootLoadStatus === 'loading' || rootLoadStatus === 'partial') &&
    scene.nodes.length < 3
  const isDragFixtureLab = fixtureName === 'drag-local'
  const hasSavedRoots = savedRoots.length > 0
  const shouldShowSavedRootsSection = !savedRootsHydrated || hasSavedRoots

  const updateFixtureState = useCallback((updater: (current: CanonicalGraphState) => CanonicalGraphState) => {
    setFixtureState((current) => current ? withClientSceneSignature(updater(current)) : current)
  }, [])

  const relationshipControlLayer = useMemo(
    () => resolveRelationshipControlLayer(domainState.activeLayer, domainState.connectionsSourceLayer),
    [domainState.activeLayer, domainState.connectionsSourceLayer],
  )
  const relationshipToggleState = useMemo(
    () => getRelationshipToggleState(relationshipControlLayer),
    [relationshipControlLayer],
  )
  const onlyOneRelationshipSideActive =
    relationshipToggleState.following !== relationshipToggleState.followers
  const canToggleOnlyNonReciprocal =
    isRelationshipLayer(relationshipControlLayer) &&
    (relationshipToggleState.following || relationshipToggleState.followers)
  const isNonReciprocalAvailable = canToggleOnlyNonReciprocal && onlyOneRelationshipSideActive
  const isNonReciprocalActive = isNonReciprocalAvailable && relationshipToggleState.onlyNonReciprocal
  useEffect(() => {
    if (!savedRootsHydrated || savedRoots.length === 0) return
    const rootsNeedingRefresh = savedRoots
      .filter((savedRoot) =>
        savedRoot.profileFetchedAt === null ||
        Date.now() - savedRoot.profileFetchedAt > SAVED_ROOT_PROFILE_STALE_MS,
      )
      .slice(0, MAX_SAVED_ROOT_REFRESHES)
    if (rootsNeedingRefresh.length === 0) return
    let cancelled = false
    void Promise.allSettled(
      rootsNeedingRefresh.map(async (savedRoot) => {
        const profile = await fetchProfileByPubkey(savedRoot.pubkey)
        if (cancelled) return
        setSavedRootProfile(savedRoot.pubkey, mapNostrProfileToSavedRootProfile(profile), Date.now())
      }),
    )
    return () => { cancelled = true }
  }, [savedRoots, savedRootsHydrated, setSavedRootProfile])

  useEffect(() => {
    if (!domainState.rootPubkey || !currentRootNode) return
    if (!currentRootNode.label && !currentRootNode.picture && !currentRootNode.nip05 && !currentRootNode.about && !currentRootNode.lud16) return
    setSavedRootProfile(
      domainState.rootPubkey,
      mapCanonicalNodeToSavedRootProfile(currentRootNode),
      currentRootNode.profileFetchedAt ?? Date.now(),
    )
  }, [currentRootNode, domainState.rootPubkey, setSavedRootProfile])

  const togglePinnedNode = useCallback((pubkey: string) => {
    if (!isFixtureMode) { bridge.togglePinnedNode(pubkey); return }
    updateFixtureState((current) => {
      const pinnedNodePubkeys = new Set(current.pinnedNodePubkeys)
      if (pinnedNodePubkeys.has(pubkey)) pinnedNodePubkeys.delete(pubkey)
      else pinnedNodePubkeys.add(pubkey)
      return { ...current, pinnedNodePubkeys }
    })
  }, [bridge, isFixtureMode, updateFixtureState])

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

  const setConnectionsSourceLayer = useCallback((layer: ConnectionsSourceLayer) => {
    if (!isFixtureMode) { bridge.setConnectionsSourceLayer(layer); return }
    updateFixtureState((current) => ({ ...current, connectionsSourceLayer: layer }))
  }, [bridge, isFixtureMode, updateFixtureState])

  const handleToggleRelationship = useCallback((role: 'following' | 'followers') => {
    const current = getRelationshipToggleState(relationshipControlLayer)
    const nextFollowing = role === 'following' ? !current.following : current.following
    const nextFollowers = role === 'followers' ? !current.followers : current.followers

    if (domainState.activeLayer === 'connections') {
      if (!nextFollowing && !nextFollowers) { toggleLayer('graph'); return }
      if (nextFollowing && nextFollowers) { setConnectionsSourceLayer('mutuals'); return }
      if (nextFollowing) { setConnectionsSourceLayer(current.onlyNonReciprocal ? 'following-non-followers' : 'following'); return }
      setConnectionsSourceLayer(current.onlyNonReciprocal ? 'nonreciprocal-followers' : 'followers')
      return
    }
    if (!nextFollowing && !nextFollowers) { toggleLayer('graph'); return }
    if (nextFollowing && nextFollowers) { toggleLayer('mutuals'); return }
    if (nextFollowing) { toggleLayer(current.onlyNonReciprocal ? 'following-non-followers' : 'following'); return }
    toggleLayer(current.onlyNonReciprocal ? 'nonreciprocal-followers' : 'followers')
  }, [domainState.activeLayer, relationshipControlLayer, setConnectionsSourceLayer, toggleLayer])

  const handleToggleOnlyNonReciprocal = useCallback(() => {
    const current = getRelationshipToggleState(relationshipControlLayer)
    if (!canToggleOnlyNonReciprocal || !onlyOneRelationshipSideActive) return
    if (domainState.activeLayer === 'connections') {
      if (current.following) { setConnectionsSourceLayer(current.onlyNonReciprocal ? 'following' : 'following-non-followers'); return }
      if (current.followers) { setConnectionsSourceLayer(current.onlyNonReciprocal ? 'followers' : 'nonreciprocal-followers') }
      return
    }
    if (current.following) { toggleLayer(current.onlyNonReciprocal ? 'following' : 'following-non-followers'); return }
    if (current.followers) { toggleLayer(current.onlyNonReciprocal ? 'followers' : 'nonreciprocal-followers') }
  }, [
    canToggleOnlyNonReciprocal,
    domainState.activeLayer,
    onlyOneRelationshipSideActive,
    relationshipControlLayer,
    setConnectionsSourceLayer,
    toggleLayer,
  ])

  const updateDragInfluenceTuning = useCallback(function updateDragInfluenceTuning<K extends keyof DragNeighborhoodInfluenceTuning>(
    key: K, value: DragNeighborhoodInfluenceTuning[K],
  ) { setDragInfluenceTuning((current) => ({ ...current, [key]: value })) }, [])

  const visiblePubkeys = useMemo(() => deferredScene.nodes.map((node) => node.pubkey), [deferredScene.nodes])
  const visibleNodeSet = useMemo(() => new Set(visiblePubkeys), [visiblePubkeys])

  const handleZap = useCallback((zap: Pick<ParsedZap, 'fromPubkey' | 'toPubkey' | 'sats'>) => {
    if (!showZaps) return false
    if (!visibleNodeSet.has(zap.fromPubkey)) return false
    if (!visibleNodeSet.has(zap.toPubkey)) return false
    if (!hasVisibleEdgeBetween(deferredScene, zap.fromPubkey, zap.toPubkey)) return false
    return sigmaHostRef.current?.playZap(zap) ?? false
  }, [deferredScene, showZaps, visibleNodeSet])

  // Propagate physics pause/resume to the Sigma runtime when toggled.
  useEffect(() => {
    sigmaHostRef.current?.setPhysicsSuspended(!physicsEnabled)
  }, [physicsEnabled])

  const shouldEnableLiveZapFeed =
    showZaps && !isFixtureMode && domainState.activeLayer !== 'connections'
  const handleLiveZap = useCallback((zap: ParsedZap) => {
    handleZap(zap)
  }, [handleZap])
  useLiveZapFeed({
    visiblePubkeys,
    enabled: shouldEnableLiveZapFeed,
    onZap: handleLiveZap,
  })

  const isDev = process.env.NODE_ENV === 'development'
  const findSimulationPair = useCallback((): { from: string; to: string } | null => {
    for (const edge of deferredScene.visibleEdges) {
      if (edge.hidden) continue
      if (!visibleNodeSet.has(edge.source)) continue
      if (!visibleNodeSet.has(edge.target)) continue
      return { from: edge.source, to: edge.target }
    }
    return null
  }, [deferredScene.visibleEdges, visibleNodeSet])
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
    setIsSettingsOpen(true)
  }, [])

  const loadRootFromPointer = useCallback(
    ({
      pubkey,
      relays = [],
      npub,
      profile,
      profileFetchedAt,
    }: {
      pubkey: string
      kind: 'npub' | 'nprofile'
      relays?: string[]
      npub?: string
      profile?: SavedRootProfileSnapshot | null
      profileFetchedAt?: number | null
    }) => {
      setValidationFeedback(null)
      setLoadFeedback('Cargando root...')
      startTransition(() => {
        if (isFixtureMode) { setLoadFeedback('El fixture no admite cargar roots manuales.'); return }
        const encodedNpub = npub ?? nip19.npubEncode(pubkey)
        upsertSavedRoot({ pubkey, npub: encodedNpub, openedAt: Date.now(), relayHints: relays, profile, profileFetchedAt })
        void bridge
          .loadRoot(pubkey, { bootstrapRelayUrls: relays })
          .then((result) => { setLoadFeedback(result.message); setIsRootSheetOpen(false) })
          .catch((error) => {
            setLoadFeedback(error instanceof Error ? error.message : 'No se pudo cargar el root.')
          })
      })
    },
    [bridge, isFixtureMode, upsertSavedRoot],
  )

  const handleSelectSavedRoot = useCallback(
    (savedRoot: SavedRootEntry) => {
      loadRootFromPointer({ pubkey: savedRoot.pubkey, kind: 'npub', npub: savedRoot.npub, relays: savedRoot.relayHints ?? [], profile: savedRoot.profile, profileFetchedAt: savedRoot.profileFetchedAt })
    },
    [loadRootFromPointer],
  )

  const handleDeleteSavedRoot = useCallback(
    (savedRoot: SavedRootEntry) => { removeSavedRoot(savedRoot.pubkey) },
    [removeSavedRoot],
  )

  // ── Derived values for UI components ───────────────────────────────────────

  const hasRoot = domainState.rootPubkey !== null

  // Saved-roots profile snapshot as fallback while the kernel is still
  // hydrating `currentRootNode` — prevents empty avatar / display name on
  // first paint after selecting a saved root.
  const savedRootProfile = useMemo(() => {
    if (!domainState.rootPubkey) return null
    return savedRoots.find((r) => r.pubkey === domainState.rootPubkey)?.profile ?? null
  }, [savedRoots, domainState.rootPubkey])
  const rootDisplayName =
    currentRootNode?.label ?? savedRootProfile?.displayName ?? savedRootProfile?.name ?? null
  const rootPictureUrl = currentRootNode?.picture ?? savedRootProfile?.picture ?? null
  const rootNpubEncoded = useMemo(() => {
    const pk = domainState.rootPubkey
    if (!pk || !/^[0-9a-f]{64}$/i.test(pk)) return null
    try { return nip19.npubEncode(pk) } catch { return null }
  }, [domainState.rootPubkey])

  // Filter bar: active pill maps from active layer
  const filterActiveId = useMemo((): FilterPill['id'] => {
    const layer = domainState.activeLayer
    if (layer === 'following') return 'following'
    if (layer === 'followers') return 'followers'
    if (layer === 'mutuals') return 'mutuals'
    if (layer === 'following-non-followers' || layer === 'nonreciprocal-followers') return 'oneway'
    return 'all'
  }, [domainState.activeLayer])

  const filterPills: FilterPill[] = useMemo(() => [
    { id: 'all',       label: 'Todos',            count: deferredScene.diagnostics.nodeCount, swatch: 'oklch(55% 0.02 230)' },
    { id: 'following', label: 'Sigo',             count: null, swatch: 'oklch(65% 0.10 220)' },
    { id: 'followers', label: 'Me siguen',        count: null, swatch: 'oklch(65% 0.08 300)' },
    { id: 'mutuals',   label: 'Mutuos',           count: null, swatch: 'oklch(72% 0.06 220)' },
    { id: 'oneway',    label: 'Sin reciprocidad', count: null, swatch: 'oklch(60% 0.06 80)' },
  ], [deferredScene.diagnostics.nodeCount])

  const handleFilterSelect = useCallback((id: FilterPill['id']) => {
    if (id === 'all')       { toggleLayer('graph'); return }
    if (id === 'following') { toggleLayer('following'); return }
    if (id === 'followers') { toggleLayer('followers'); return }
    if (id === 'mutuals')   { toggleLayer('mutuals'); return }
    if (id === 'oneway') {
      const cur = domainState.activeLayer
      if (cur === 'following-non-followers' || cur === 'nonreciprocal-followers') return
      toggleLayer('following-non-followers')
    }
  }, [domainState.activeLayer, toggleLayer])

  // HUD stats
  const hudStats: HudStat[] = useMemo(() => [
    { k: 'Nodos',   v: String(deferredScene.diagnostics.nodeCount) },
    { k: 'Aristas', v: String(deferredScene.diagnostics.forceEdgeCount) },
    { k: 'Visibles', v: String(deferredScene.diagnostics.visibleEdgeCount) },
    {
      k: 'Física',
      v: physicsEnabled ? 'activa' : 'pausa',
      tone: physicsEnabled ? 'good' : 'warn',
    },
    {
      k: 'Relays',
      v: `${domainState.relayState.isGraphStale ? Math.max(0, deferredScene.diagnostics.relayCount - 1) : deferredScene.diagnostics.relayCount}/${deferredScene.diagnostics.relayCount}`,
      tone: domainState.relayState.isGraphStale ? 'warn' : 'good',
    },
    {
      k: 'Frame',
      v: avatarPerfSnapshot ? `${avatarPerfSnapshot.emaFrameMs.toFixed(1)}ms` : '—',
      tone: avatarPerfSnapshot && avatarPerfSnapshot.emaFrameMs > 20 ? 'warn' : 'default',
    },
  ], [
    avatarPerfSnapshot,
    deferredScene.diagnostics.forceEdgeCount,
    deferredScene.diagnostics.nodeCount,
    deferredScene.diagnostics.relayCount,
    deferredScene.diagnostics.visibleEdgeCount,
    domainState.relayState.isGraphStale,
    physicsEnabled,
  ])

  // Rail buttons — every entry is a DIRECT action or toggle.
  // Settings panel keeps the detailed controls; rail gives quick toggles
  // without duplicating what the panel does.
  const handleOpenRootSheet = useCallback(() => {
    setIsRootSheetOpen(true)
  }, [])

  const handleToggleSettings = useCallback(() => {
    if (isSettingsOpen) {
      setIsSettingsOpen(false)
      return
    }
    openSettingsTab(activeSettingsTab)
  }, [activeSettingsTab, isSettingsOpen, openSettingsTab])

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
    if (!domainState.relayState.isGraphStale) {
      setActionFeedback('Relays al dia: no hay override para revertir.')
      return
    }
    void handleRevertRelays()
  }, [domainState.relayState.isGraphStale, handleRevertRelays])

  const railButtons: RailButton[] = useMemo(() => [
    {
      id: 'settings',
      tip: isSettingsOpen ? 'Cerrar ajustes' : 'Ajustes',
      icon: <GearIcon />,
      active: isSettingsOpen,
      onClick: handleToggleSettings,
    },
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
      tip: domainState.relayState.isGraphStale ? 'Revertir relays' : 'Relays al día',
      icon: <ClockIcon />,
      active: domainState.relayState.isGraphStale,
      onClick: handleStaleRelays,
      dividerAfter: true,
    },
    {
      id: 'search',
      tip: 'Cargar identidad (/)',
      icon: <SearchIcon />,
      onClick: handleOpenRootSheet,
    },
  ], [
    domainState.relayState.isGraphStale,
    handleOpenRootSheet,
    handleRecenter,
    handleStaleRelays,
    handleTogglePhysics,
    handleToggleSettings,
    handleToggleZaps,
    isSettingsOpen,
    physicsEnabled,
    showZaps,
  ])

  // Toasts — combine feedback sources
  const toastEntries: SigmaToast[] = useMemo(() => {
    const entries: SigmaToast[] = []
    if (actionFeedback) entries.push({ id: 'action', msg: actionFeedback, tone: 'default' })
    if (zapFeedback)    entries.push({ id: 'zap', msg: zapFeedback, tone: 'zap' })
    if (validationFeedback) entries.push({ id: 'validation', msg: validationFeedback, tone: 'warn' })
    return entries
  }, [actionFeedback, zapFeedback, validationFeedback])

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
            hideAvatarsOnMove={hideAvatarsOnMove}
            onAvatarRuntimeOptionsChange={setAvatarRuntimeOptions}
            onHideAvatarsOnMoveChange={setHideAvatarsOnMove}
          />
        )
      case 'physics':
        return (
          <>
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
          </>
        )
      case 'layers':
        return (
          <div className="sg-settings-section">
            <h4>Proyección activa</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {GRAPH_V2_LAYERS.map((layer) => {
                const isActive = layer === domainState.activeLayer
                return (
                  <button
                    aria-pressed={isActive}
                    className={`sg-btn${isActive ? ' sg-btn--primary' : ''}`}
                    key={layer}
                    onClick={() => toggleLayer(layer)}
                    style={{ justifyContent: 'flex-start' }}
                    type="button"
                  >
                    {LAYER_LABELS[layer]}
                  </button>
                )
              })}
            </div>
            <div style={{ marginTop: 16 }}>
              <h4>Filtros de relación</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div className="sg-setting-row">
                  <span className="sg-setting-row__lbl">Sigo</span>
                  <button
                    className={`sg-toggle${relationshipToggleState.following ? ' sg-toggle--on' : ''}`}
                    onClick={() => handleToggleRelationship('following')}
                    type="button"
                  />
                </div>
                <div className="sg-setting-row">
                  <span className="sg-setting-row__lbl">Me siguen</span>
                  <button
                    className={`sg-toggle${relationshipToggleState.followers ? ' sg-toggle--on' : ''}`}
                    onClick={() => handleToggleRelationship('followers')}
                    type="button"
                  />
                </div>
                {isNonReciprocalAvailable ? (
                  <div className="sg-setting-row">
                    <span className="sg-setting-row__lbl">Solo sin reciprocidad</span>
                    <button
                      className={`sg-toggle${isNonReciprocalActive ? ' sg-toggle--on' : ''}`}
                      onClick={handleToggleOnlyNonReciprocal}
                      type="button"
                    />
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        )
      case 'relays':
        return (
          <RelayEditor
            isGraphStale={domainState.relayState.isGraphStale}
            onApply={handleApplyRelays}
            onRevert={handleRevertRelays}
            overrideStatus={domainState.relayState.overrideStatus}
            relayUrls={domainState.relayState.urls}
          />
        )
      case 'internal':
        return (
          <div>
            <div className="sg-settings-section">
              <h4>Diagnóstico runtime</h4>
              {[
                ['Topología',    deferredScene.diagnostics.topologySignature],
                ['Relays',       String(deferredScene.diagnostics.relayCount)],
                ['Pinned',       String(domainState.pinnedNodePubkeys.size)],
                ['Viewport',     isFixtureMode
                  ? (lastViewportRatio ? `${lastViewportRatio.toFixed(2)}×` : 'idle')
                  : (controller.getLastViewport() ? `${controller.getLastViewport()?.ratio.toFixed(2)}×` : 'idle')],
                ['Capa activa',  domainState.activeLayer],
                ['Root',         domainState.rootPubkey ? 'cargado' : 'vacío'],
              ].map(([k, v]) => (
                <div className="sg-diag-row" key={k as string}>
                  <span className="sg-diag-row__k">{k}</span>
                  <span className="sg-diag-row__v">{v}</span>
                </div>
              ))}
            </div>
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

    const isRootNode = detail.pubkey === domainState.rootPubkey
    const relBadge = isRootNode ? 'IDENTIDAD RAÍZ' :
      (detail.mutualCount > 0) ? 'MUTUO' :
      detail.followingCount > 0 ? 'LO SIGO' :
      detail.followerCount > 0 ? 'ME SIGUE' : 'SIN RECIPROCIDAD'

    const relBadgeClass = isRootNode ? 'sg-badge--accent' :
      (detail.mutualCount > 0) ? 'sg-badge--ok' :
      detail.followingCount > 0 ? 'sg-badge--accent' :
      detail.followerCount > 0 ? '' : 'sg-badge--warn'

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
                />
              )}
            </div>
            {detail.isPinned && (
              <div className="sg-node-hero__pin">◆</div>
            )}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2>{detail.displayName ?? '—'}</h2>
            <div className="sg-node-hero__handle">{detail.pubkey?.slice(0, 12)}…</div>
            <div className="sg-node-hero__badges">
              <span className={`sg-badge ${relBadgeClass}`}>{relBadge}</span>
              {detail.nip05 && <span className="sg-badge sg-badge--ok">nip05</span>}
              {detail.isExpanded && <span className="sg-badge">expandido</span>}
            </div>
          </div>
        </div>

        <p className={`sg-bio${detail.about?.trim() ? '' : ' sg-bio--empty'}`}>
          {detail.about?.trim() || 'Sin bio conocida.'}
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
        <div className="sg-field">
          <span className="sg-field__k">nip05</span>
          <span className={`sg-field__v${detail.nip05 ? '' : ' sg-field__v--missing'}`}>
            {detail.nip05?.trim() || '—'}
          </span>
        </div>
        <div className="sg-field">
          <span className="sg-field__k">lud16</span>
          <span className={`sg-field__v${detail.lud16 ? '' : ' sg-field__v--missing'}`}>
            {detail.lud16?.trim() || '—'}
          </span>
        </div>
        <div className="sg-field">
          <span className="sg-field__k">Expansión</span>
          <span className="sg-field__v">
            {detail.node.nodeExpansionState?.status ?? 'idle'}
          </span>
        </div>

        <div className="sg-actions">
          <button
            className={`sg-btn${detail.isExpanded ? '' : ' sg-btn--primary'}`}
            disabled={detail.isExpanded}
            onClick={() => {
              const selectedPubkey = detail.pubkey
              if (!selectedPubkey) return
              startTransition(() => {
                if (isFixtureMode) { setActionFeedback('El fixture no expande nodos por relay.'); return }
                void bridge.expandNode(selectedPubkey).then((result) => { setActionFeedback(result.message) })
              })
            }}
            type="button"
          >
            {detail.isExpanded ? 'Expandido' : 'Expandir 1 salto'}
          </button>
          <button
            className="sg-btn"
            onClick={() => {
              if (!detail.pubkey) return
              togglePinnedNode(detail.pubkey)
            }}
            type="button"
          >
            {detail.isPinned ? 'Liberar' : 'Fijar'}
          </button>
        </div>
      </div>
    )
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <main className="sg-app" data-graph-v2="">
      {/* Canvas — always present, full bleed under all chrome */}
      <SigmaCanvasHost
        avatarRuntimeOptions={stableAvatarRuntimeOptions}
        callbacks={callbacks}
        dragInfluenceTuning={dragInfluenceTuning}
        enableDebugProbe={isTestMode}
        hideAvatarsOnMove={hideAvatarsOnMove}
        onAvatarPerfSnapshot={handleAvatarPerfSnapshot}
        physicsTuning={physicsTuning}
        ref={sigmaHostRef}
        scene={deferredScene}
      />

      {/* Loading overlay — while root data is arriving */}
      {isGraphLoading && (
        <SigmaLoadingOverlay
          message={visibleLoadFeedback}
          nodeCount={scene.nodes.length}
        />
      )}

      {/* Top bar: root chip (left) + brand (right) */}
      <SigmaTopBar
        onSwitchRoot={handleOpenRootSheet}
        rootDisplayName={hasRoot ? (rootDisplayName ?? domainState.rootPubkey?.slice(0, 10) ?? null) : null}
        rootNpub={rootNpubEncoded}
        rootPictureUrl={rootPictureUrl}
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
        </>
      )}

      {/* Side panel — detail (right) or settings (right), one at a time */}
      {(isSettingsOpen || (detail.node !== null && !isRootSheetOpen)) && (
        <SigmaSidePanel
          eyebrow={isSettingsOpen ? 'AJUSTES' : 'IDENTIDAD'}
          onClose={() => {
            if (isSettingsOpen) { setIsSettingsOpen(false); return }
            if (!isFixtureMode) bridge.selectNode(null)
          }}
          tabs={
            isSettingsOpen ? (
              <div className="sg-panel-tabs">
                {SIGMA_SETTINGS_TABS.map((tab) => (
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
          {isSettingsOpen ? renderSettingsContent() : renderDetailContent()}
        </SigmaSidePanel>
      )}

      {/* Root loader modal */}
      {isRootSheetOpen && (
        <SigmaRootLoader
          canClose={hasRoot}
          feedback={visibleLoadFeedback ?? validationFeedback}
          manualInputSlot={
            <NpubInput
              onInvalidRoot={(payload) => setValidationFeedback(payload.message)}
              onValidRoot={loadRootFromPointer}
            />
          }
          onClose={() => setIsRootSheetOpen(false)}
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
      <SigmaToasts toasts={toastEntries} />
    </main>
  )
}
