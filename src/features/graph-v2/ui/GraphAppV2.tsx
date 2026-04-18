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
import { SavedRootsPanel } from '@/features/graph/components/SavedRootsPanel'
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
import type { GraphInteractionCallbacks, GraphViewportState } from '@/features/graph-v2/renderer/contracts'
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
import { useLiveZapFeed } from '@/features/graph-v2/zaps/useLiveZapFeed'
import type { ParsedZap } from '@/features/graph-v2/zaps/zapParser'
import { fetchProfileByPubkey, type NostrProfile } from '@/lib/nostr'

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

const resolveConnectionFilterLabel = (
  relationshipToggleState: RelationshipToggleState,
) => {
  if (relationshipToggleState.following && relationshipToggleState.followers) {
    return 'Filtro: mutuos'
  }

  if (relationshipToggleState.following) {
    return relationshipToggleState.onlyNonReciprocal
      ? 'Filtro: sigo sin reciprocidad'
      : 'Filtro: sigo'
  }

  if (relationshipToggleState.followers) {
    return relationshipToggleState.onlyNonReciprocal
      ? 'Filtro: me siguen sin reciprocidad'
      : 'Filtro: me siguen'
  }

  return 'Filtro: vecindario visible'
}

const SIGMA_SETTINGS_TABS: Array<{ id: SigmaSettingsTab; label: string }> = [
  { id: 'renderer', label: 'Renderer' },
  { id: 'physics', label: 'Physics' },
  { id: 'layers', label: 'Layers' },
  { id: 'relays', label: 'Relays' },
  { id: 'internal', label: 'Internal' },
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
  if (!value) {
    return 'N'
  }

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
    Object.keys(state.nodesByPubkey).length,
    Object.keys(state.edgesById).length,
    Array.from(state.pinnedNodePubkeys).sort().join(','),
  ].join('|')

const withClientSceneSignature = (
  state: CanonicalGraphState,
): CanonicalGraphState => ({
  ...state,
  sceneSignature: createClientSceneSignature(state),
})

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
    <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-white/50">Relays</p>
          <h2 className="mt-1 text-sm font-semibold text-white">
            Override del bridge
          </h2>
        </div>
        <span className="rounded-full border border-white/10 px-2 py-1 text-[11px] text-white/60">
          {overrideStatus} / {isGraphStale ? 'stale' : 'live'}
        </span>
      </div>

      <textarea
        className="mt-3 h-32 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none placeholder:text-white/30"
        onChange={(event) => setDraft(event.target.value)}
        placeholder="wss://relay.example"
        spellCheck={false}
        value={draft}
      />

      <div className="mt-3 flex gap-2">
        <button
          className="rounded-xl bg-[#7dd3a7] px-3 py-2 text-sm font-medium text-black"
          onClick={() => {
            const nextRelayUrls = draft
              .split(/\s+/)
              .map((entry) => entry.trim())
              .filter(Boolean)

            startTransition(() => {
              void onApply(nextRelayUrls)
                .then(() => {
                  setMessage(`Aplicados ${nextRelayUrls.length} relays.`)
                })
                .catch((error) => {
                  setMessage(
                    error instanceof Error
                      ? error.message
                      : 'No se pudieron aplicar los relays.',
                  )
                })
            })
          }}
          type="button"
        >
          Aplicar
        </button>
        <button
          className="rounded-xl border border-white/10 px-3 py-2 text-sm text-white/80"
          onClick={() => {
            startTransition(() => {
              void onRevert()
                .then(() => {
                  setMessage('Se revirtio el override de relays.')
                })
                .catch((error) => {
                  setMessage(
                    error instanceof Error
                      ? error.message
                      : 'No se pudo revertir el override.',
                  )
                })
            })
          }}
          type="button"
        >
          Revertir
        </button>
      </div>

      {message ? <p className="mt-3 text-xs text-white/60">{message}</p> : null}
    </section>
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
  {
    key: 'centripetalForce',
    label: 'Fuerza centripeta',
    description: 'Multiplica gravity: compacta el grafo hacia el centro.',
    min: 0.25,
    max: 2.5,
    step: 0.05,
  },
  {
    key: 'repulsionForce',
    label: 'Fuerza de repelencia',
    description: 'Multiplica scalingRatio: separa nodos y clusters.',
    min: 0.25,
    max: 5,
    step: 0.05,
  },
  {
    key: 'linkForce',
    label: 'Fuerza de enlace',
    description: 'Multiplica edgeWeightInfluence: cohesion por aristas.',
    min: 0.25,
    max: 2.5,
    step: 0.05,
  },
  {
    key: 'linkDistance',
    label: 'Distancia de enlace',
    description: 'Aproxima distancia: mas alto abre enlaces sin cambiar FA2.',
    min: 0.5,
    max: 2,
    step: 0.05,
  },
  {
    key: 'damping',
    label: 'Amortiguacion',
    description: 'Multiplica slowDown: controla velocidad e inercia.',
    min: 0.25,
    max: 2.5,
    step: 0.05,
  },
]

function PhysicsTuningPanel({
  tuning,
  onChange,
  onReset,
}: {
  tuning: ForceAtlasPhysicsTuning
  onChange: <K extends keyof ForceAtlasPhysicsTuning>(
    key: K,
    value: ForceAtlasPhysicsTuning[K],
  ) => void
  onReset: () => void
}) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-white/50">Physics</p>
          <h2 className="mt-1 text-sm font-semibold text-white">
            Preset Obsidian
          </h2>
        </div>
        <button
          className="rounded-xl border border-white/10 px-3 py-2 text-xs text-white/70 hover:border-white/20"
          onClick={onReset}
          type="button"
        >
          Reset
        </button>
      </div>

      <div className="mt-4 grid gap-4">
        {PHYSICS_TUNING_SLIDERS.map((slider) => {
          const value = tuning[slider.key]
          return (
            <label className="block" key={slider.key}>
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-white/85">{slider.label}</span>
                <span className="rounded-full border border-white/10 px-2 py-1 font-mono text-[11px] text-[#7dd3a7]">
                  {value.toFixed(2)}x
                </span>
              </div>
              <p className="mt-1 text-xs text-white/50">{slider.description}</p>
              <input
                className="mt-3 h-2 w-full cursor-pointer accent-[#7dd3a7]"
                max={slider.max}
                min={slider.min}
                onChange={(event) => {
                  onChange(
                    slider.key,
                    Number.parseFloat(event.target.value) as ForceAtlasPhysicsTuning[typeof slider.key],
                  )
                }}
                step={slider.step}
                type="range"
                value={value}
              />
              <div className="mt-1 flex items-center justify-between text-[11px] text-white/35">
                <span>{slider.min.toFixed(2)}x</span>
                <span>{slider.max.toFixed(2)}x</span>
              </div>
            </label>
          )
        })}
      </div>
    </section>
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
  {
    key: 'edgeStiffness',
    label: 'Edge stiffness',
    description: 'Cuanto se propaga el tiron por las aristas reales.',
    min: 0.01,
    max: 0.12,
    step: 0.002,
  },
  {
    key: 'anchorStiffnessPerHop',
    label: 'Anchor por hop',
    description: 'Cuanto vuelve cada hop a su posicion inicial.',
    min: 0.001,
    max: 0.02,
    step: 0.0005,
  },
  {
    key: 'baseDamping',
    label: 'Base damping',
    description: 'Amortiguacion de velocidad; mas alto, mas inercia.',
    min: 0.75,
    max: 0.95,
    step: 0.005,
  },
]

function DragTuningPanel({
  tuning,
  onChange,
  onReset,
}: {
  tuning: DragNeighborhoodInfluenceTuning
  onChange: <K extends keyof DragNeighborhoodInfluenceTuning>(
    key: K,
    value: DragNeighborhoodInfluenceTuning[K],
  ) => void
  onReset: () => void
}) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-white/50">Drag tuning</p>
          <h2 className="mt-1 text-sm font-semibold text-white">
            Springs del laboratorio
          </h2>
          <p className="mt-2 text-xs leading-5 text-white/55">
            Ajusta el feel del drag en vivo. Esto no toca el dominio ni persiste fuera de la pagina.
          </p>
        </div>
        <button
          className="rounded-xl border border-white/10 px-3 py-2 text-xs text-white/70 hover:border-white/20"
          onClick={onReset}
          type="button"
        >
          Reset
        </button>
      </div>

      <div className="mt-4 grid gap-4">
        {DRAG_TUNING_SLIDERS.map((slider) => {
          const value = tuning[slider.key]
          return (
            <label className="block" key={slider.key}>
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-white/85">{slider.label}</span>
                <span className="rounded-full border border-white/10 px-2 py-1 font-mono text-[11px] text-[#7dd3a7]">
                  {value.toFixed(3)}
                </span>
              </div>
              <p className="mt-1 text-xs text-white/50">{slider.description}</p>
              <input
                className="mt-3 h-2 w-full cursor-pointer accent-[#7dd3a7]"
                max={slider.max}
                min={slider.min}
                onChange={(event) => {
                  onChange(
                    slider.key,
                    Number.parseFloat(event.target.value) as DragNeighborhoodInfluenceTuning[typeof slider.key],
                  )
                }}
                step={slider.step}
                type="range"
                value={value}
              />
              <div className="mt-1 flex items-center justify-between text-[11px] text-white/35">
                <span>{slider.min.toFixed(3)}</span>
                <span>{slider.max.toFixed(3)}</span>
              </div>
            </label>
          )
        })}
      </div>
    </section>
  )
}

function mapNostrProfileToSavedRootProfile(
  profile: NostrProfile,
): SavedRootProfileSnapshot {
  return {
    displayName: profile.displayName ?? null,
    name: profile.name ?? null,
    picture: profile.picture ?? null,
    about: profile.about ?? null,
    nip05: profile.nip05 ?? null,
    lud16: profile.lud16 ?? null,
  }
}

function mapCanonicalNodeToSavedRootProfile(
  node: CanonicalNode,
): SavedRootProfileSnapshot {
  return {
    displayName: node.label ?? null,
    name: node.label ?? null,
    picture: node.picture ?? null,
    about: node.about ?? null,
    nip05: node.nip05 ?? null,
    lud16: node.lud16 ?? null,
  }
}

function IdentityIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="18"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
      width="18"
    >
      <path d="M12 12.4a4.2 4.2 0 1 0 0-8.4 4.2 4.2 0 0 0 0 8.4Z" />
      <path d="M4.6 20a7.8 7.8 0 0 1 14.8 0" />
    </svg>
  )
}

function SettingsIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="18"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
      width="18"
    >
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.84l.05.05a2 2 0 0 1-2.82 2.83l-.06-.06a1.7 1.7 0 0 0-1.84-.33 1.7 1.7 0 0 0-1.04 1.56V21a2 2 0 1 1-4 0v-.08a1.7 1.7 0 0 0-1.04-1.56 1.7 1.7 0 0 0-1.84.33l-.06.06a2 2 0 1 1-2.82-2.83l.05-.05A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.04H3a2 2 0 1 1 0-4h.08A1.7 1.7 0 0 0 4.64 8.4a1.7 1.7 0 0 0-.33-1.84l-.06-.06a2 2 0 1 1 2.83-2.82l.06.05a1.7 1.7 0 0 0 1.84.34h.02a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 1 1 4 0v.08a1.7 1.7 0 0 0 1.04 1.56 1.7 1.7 0 0 0 1.84-.34l.06-.05a2 2 0 1 1 2.82 2.82l-.05.06A1.7 1.7 0 0 0 19.4 8.4v.02a1.7 1.7 0 0 0 1.56 1.03H21a2 2 0 1 1 0 4h-.08A1.7 1.7 0 0 0 19.4 15Z" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="18"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.9"
      viewBox="0 0 24 24"
      width="18"
    >
      <path d="m6.5 6.5 11 11" />
      <path d="m17.5 6.5-11 11" />
    </svg>
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
    ? Math.max(
      avatarRuntimeOptions.sizeThreshold,
      avatarPerfSnapshot.budget.sizeThreshold,
    )
    : avatarRuntimeOptions.sizeThreshold
  const effectiveZoomThreshold = avatarPerfSnapshot && adaptiveVisualsActive
    ? Math.min(
      avatarRuntimeOptions.zoomThreshold,
      avatarPerfSnapshot.budget.zoomThreshold,
    )
    : avatarRuntimeOptions.zoomThreshold

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-white/50">Render</p>
          <h2 className="mt-1 text-sm font-semibold text-white">
            Avatares
          </h2>
        </div>
        <span className="rounded-full border border-white/10 px-2 py-1 text-[11px] text-white/60">
          {hideAvatarsOnMove ? 'fluido' : 'visible'}
        </span>
      </div>

      <label className="mt-4 flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/10 px-3 py-3">
        <span className="text-sm text-white/80">
          Ocultar durante pan, zoom y drag
        </span>
        <input
          checked={hideAvatarsOnMove}
          className="h-4 w-4 accent-[#7dd3a7]"
          onChange={(event) => {
            onHideAvatarsOnMoveChange(event.target.checked)
          }}
          type="checkbox"
        />
      </label>

      <div className="mt-4 grid gap-4">
        <label className="block">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-white/85">Radio minimo</span>
            <span className="rounded-full border border-white/10 px-2 py-1 font-mono text-[11px] text-[#7dd3a7]">
              {avatarRuntimeOptions.sizeThreshold.toFixed(0)}px
            </span>
          </div>
          <input
            className="mt-3 h-2 w-full cursor-pointer accent-[#7dd3a7]"
            max={32}
            min={4}
            onChange={(event) => {
              onAvatarRuntimeOptionsChange({
                ...avatarRuntimeOptions,
                sizeThreshold: Number.parseInt(event.target.value, 10),
              })
            }}
            step={1}
            type="range"
            value={avatarRuntimeOptions.sizeThreshold}
          />
          <div className="mt-1 flex items-center justify-between text-[11px] text-white/35">
            <span>4px</span>
            <span>32px</span>
          </div>
        </label>

        <label className="block">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-white/85">Zoom max</span>
            <span className="rounded-full border border-white/10 px-2 py-1 font-mono text-[11px] text-[#7dd3a7]">
              {avatarRuntimeOptions.zoomThreshold.toFixed(2)}x
            </span>
          </div>
          <input
            className="mt-3 h-2 w-full cursor-pointer accent-[#7dd3a7]"
            max={4}
            min={0.6}
            onChange={(event) => {
              onAvatarRuntimeOptionsChange({
                ...avatarRuntimeOptions,
                zoomThreshold: Number.parseFloat(event.target.value),
              })
            }}
            step={0.05}
            type="range"
            value={avatarRuntimeOptions.zoomThreshold}
          />
          <div className="mt-1 flex items-center justify-between text-[11px] text-white/35">
            <span>0.60x</span>
            <span>4.00x</span>
          </div>
        </label>

        <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/10 px-3 py-3">
          <span className="text-sm text-white/80">
            Monograma si se mueve rapido
          </span>
          <input
            checked={avatarRuntimeOptions.hideImagesOnFastNodes}
            className="h-4 w-4 accent-[#7dd3a7]"
            onChange={(event) => {
              onAvatarRuntimeOptionsChange({
                ...avatarRuntimeOptions,
                hideImagesOnFastNodes: event.target.checked,
              })
            }}
            type="checkbox"
          />
        </label>

        <label className="block">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-white/85">Velocidad max</span>
            <span className="rounded-full border border-white/10 px-2 py-1 font-mono text-[11px] text-[#7dd3a7]">
              {avatarRuntimeOptions.fastNodeVelocityThreshold.toFixed(0)}px/s
            </span>
          </div>
          <input
            className="mt-3 h-2 w-full cursor-pointer accent-[#7dd3a7] disabled:cursor-not-allowed disabled:opacity-40"
            disabled={!avatarRuntimeOptions.hideImagesOnFastNodes}
            max={1000}
            min={40}
            onChange={(event) => {
              onAvatarRuntimeOptionsChange({
                ...avatarRuntimeOptions,
                fastNodeVelocityThreshold: Number.parseInt(
                  event.target.value,
                  10,
                ),
              })
            }}
            step={20}
            type="range"
            value={avatarRuntimeOptions.fastNodeVelocityThreshold}
          />
          <div className="mt-1 flex items-center justify-between text-[11px] text-white/35">
            <span>40px/s</span>
            <span>1000px/s</span>
          </div>
        </label>

        <button
          className="rounded-xl border border-white/10 px-3 py-2 text-xs text-white/70 hover:border-white/20"
          onClick={() => {
            onAvatarRuntimeOptionsChange(DEFAULT_AVATAR_RUNTIME_OPTIONS)
          }}
          type="button"
        >
          Reset
        </button>

        <div className="rounded-xl border border-white/10 bg-black/10 px-3 py-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-white/80">Adaptivo</span>
            <span className="rounded-full border border-white/10 px-2 py-1 font-mono text-[11px] text-[#7dd3a7]">
              {perfStatusLabel}
            </span>
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
            <div className="rounded-lg bg-white/[0.03] px-2 py-1">
              <dt className="text-white/35">Frame EMA</dt>
              <dd className="mt-0.5 font-mono text-white/70">
                {avatarPerfSnapshot
                  ? `${avatarPerfSnapshot.emaFrameMs.toFixed(1)}ms`
                  : 'n/a'}
              </dd>
            </div>
            <div className="rounded-lg bg-white/[0.03] px-2 py-1">
              <dt className="text-white/35">Base</dt>
              <dd className="mt-0.5 font-mono text-white/70">
                {avatarPerfSnapshot?.baseTier ?? 'n/a'}
              </dd>
            </div>
            <div className="rounded-lg bg-white/[0.03] px-2 py-1">
              <dt className="text-white/35">Loads</dt>
              <dd className="mt-0.5 font-mono text-white/70">
                {avatarPerfSnapshot?.budget.concurrency ?? 'n/a'}
              </dd>
            </div>
            <div className="rounded-lg bg-white/[0.03] px-2 py-1">
              <dt className="text-white/35">Bucket</dt>
              <dd className="mt-0.5 font-mono text-white/70">
                {avatarPerfSnapshot
                  ? `${avatarPerfSnapshot.budget.maxBucket}px`
                  : 'n/a'}
              </dd>
            </div>
            <div className="rounded-lg bg-white/[0.03] px-2 py-1">
              <dt className="text-white/35">LRU</dt>
              <dd className="mt-0.5 font-mono text-white/70">
                {avatarPerfSnapshot?.budget.lruCap ?? 'n/a'}
              </dd>
            </div>
            <div className="rounded-lg bg-white/[0.03] px-2 py-1">
              <dt className="text-white/35">Draw</dt>
              <dd className="mt-0.5 font-mono text-white/70">
                {avatarPerfSnapshot?.budget.drawAvatars ?? false ? 'on' : 'off'}
              </dd>
            </div>
            <div className="rounded-lg bg-white/[0.03] px-2 py-1">
              <dt className="text-white/35">Radio eff</dt>
              <dd className="mt-0.5 font-mono text-white/70">
                {`${effectiveSizeThreshold.toFixed(0)}px`}
              </dd>
            </div>
            <div className="rounded-lg bg-white/[0.03] px-2 py-1">
              <dt className="text-white/35">Zoom eff</dt>
              <dd className="mt-0.5 font-mono text-white/70">
                {`${effectiveZoomThreshold.toFixed(2)}x`}
              </dd>
            </div>
            <div className="rounded-lg bg-white/[0.03] px-2 py-1">
              <dt className="text-white/35">Avatars cap</dt>
              <dd className="mt-0.5 font-mono text-white/70">
                {avatarPerfSnapshot?.budget.maxAvatarDrawsPerFrame ?? 'n/a'}
              </dd>
            </div>
            <div className="rounded-lg bg-white/[0.03] px-2 py-1">
              <dt className="text-white/35">Fotos cap</dt>
              <dd className="mt-0.5 font-mono text-white/70">
                {avatarPerfSnapshot?.budget.maxImageDrawsPerFrame ?? 'n/a'}
              </dd>
            </div>
          </dl>
        </div>
      </div>
    </section>
  )
}

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
  const liveDomainState = useSyncExternalStore(
    bridge.subscribe,
    bridge.getState,
    bridge.getState,
  )
  const [fixtureState, setFixtureState] = useState<CanonicalGraphState | null>(
    () => (isFixtureMode ? createDragLocalFixture().state : null),
  )
  const [lastViewportRatio, setLastViewportRatio] = useState<number | null>(null)
  const [dragInfluenceTuning, setDragInfluenceTuning] =
    useState<DragNeighborhoodInfluenceTuning>(
      DEFAULT_DRAG_NEIGHBORHOOD_INFLUENCE_TUNING,
    )
  const [physicsTuning, setPhysicsTuning] =
    useState<ForceAtlasPhysicsTuning>(DEFAULT_FORCE_ATLAS_PHYSICS_TUNING)
  const [hideAvatarsOnMove, setHideAvatarsOnMove] = useState(false)
  const [avatarRuntimeOptions, setAvatarRuntimeOptions] =
    useState<AvatarRuntimeOptions>(DEFAULT_AVATAR_RUNTIME_OPTIONS)
  const [avatarPerfSnapshot, setAvatarPerfSnapshot] =
    useState<PerfBudgetSnapshot | null>(null)
  const [activeSettingsTab, setActiveSettingsTab] =
    useState<SigmaSettingsTab>('renderer')
  const [isRootSheetOpen, setIsRootSheetOpen] = useState(!isFixtureMode)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
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
      if (event.key !== 'Escape') {
        return
      }
      if (isSettingsOpen) {
        setIsSettingsOpen(false)
        return
      }
      if (isRootSheetOpen && domainState.rootPubkey) {
        setIsRootSheetOpen(false)
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
                current
                  ? {
                      ...current,
                      selectedNodePubkey: pubkey,
                    }
                  : current,
              )
            },
            onClearSelection: () => {
              setFixtureState((current) =>
                current
                  ? {
                      ...current,
                      selectedNodePubkey: null,
                    }
                  : current,
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
      const KEYS = [
        'rootPubkey', 'activeLayer', 'connectionsSourceLayer',
        'selectedNodePubkey', 'nodeVisuals', 'nodeCount', 'linkCount',
        'inboundLinkCount', 'connectionsLinkCount', 'pinnedNodePubkeys',
      ]
      const changed = KEYS.filter((k, i) => prevParts[i] !== nextParts[i])
      console.info('[graph-v2 perf] sceneSignature changed:', changed.join(', '))
    }
    prevSignatureRef.current = sig
  })

  const scene = useMemo(
    () => buildGraphSceneSnapshot(domainState),
    // domainState also carries relay/progress objects; sceneSignature is the
    // structural key that decides when Sigma must receive a new scene.
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
  const isDragFixtureLab = fixtureName === 'drag-local'
  const hasSavedRoots = savedRoots.length > 0
  const shouldShowSavedRootsSection = !savedRootsHydrated || hasSavedRoots
  const rootEntryTitle = domainState.rootPubkey === null
    ? shouldShowSavedRootsSection
      ? 'Identidades guardadas'
      : 'Ingresa una npub o nprofile'
    : shouldShowSavedRootsSection
      ? 'Cambiar identidad'
      : 'Cambiar root'
  const rootEntryEyebrow = domainState.rootPubkey === null
    ? shouldShowSavedRootsSection
      ? 'Guardadas'
      : 'Root'
    : 'Root'

  const updateFixtureState = (
    updater: (current: CanonicalGraphState) => CanonicalGraphState,
  ) => {
    setFixtureState((current) =>
      current ? withClientSceneSignature(updater(current)) : current,
    )
  }

  const relationshipControlLayer = useMemo(
    () =>
      resolveRelationshipControlLayer(
        domainState.activeLayer,
        domainState.connectionsSourceLayer,
      ),
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
  const isNonReciprocalAvailable =
    canToggleOnlyNonReciprocal && onlyOneRelationshipSideActive
  const isNonReciprocalActive =
    isNonReciprocalAvailable && relationshipToggleState.onlyNonReciprocal
  const connectionFilterLabel = resolveConnectionFilterLabel(
    relationshipToggleState,
  )

  useEffect(() => {
    if (!savedRootsHydrated || savedRoots.length === 0) {
      return
    }

    const rootsNeedingRefresh = savedRoots
      .filter(
        (savedRoot) =>
          savedRoot.profileFetchedAt === null ||
          Date.now() - savedRoot.profileFetchedAt > SAVED_ROOT_PROFILE_STALE_MS,
      )
      .slice(0, MAX_SAVED_ROOT_REFRESHES)

    if (rootsNeedingRefresh.length === 0) {
      return
    }

    let cancelled = false

    void Promise.allSettled(
      rootsNeedingRefresh.map(async (savedRoot) => {
        const profile = await fetchProfileByPubkey(savedRoot.pubkey)
        if (cancelled) {
          return
        }

        setSavedRootProfile(
          savedRoot.pubkey,
          mapNostrProfileToSavedRootProfile(profile),
          Date.now(),
        )
      }),
    )

    return () => {
      cancelled = true
    }
  }, [savedRoots, savedRootsHydrated, setSavedRootProfile])

  useEffect(() => {
    if (!domainState.rootPubkey || !currentRootNode) {
      return
    }

    if (
      !currentRootNode.label &&
      !currentRootNode.picture &&
      !currentRootNode.nip05 &&
      !currentRootNode.about &&
      !currentRootNode.lud16
    ) {
      return
    }

    setSavedRootProfile(
      domainState.rootPubkey,
      mapCanonicalNodeToSavedRootProfile(currentRootNode),
      currentRootNode.profileFetchedAt ?? Date.now(),
    )
  }, [currentRootNode, domainState.rootPubkey, setSavedRootProfile])

  const togglePinnedNode = (pubkey: string) => {
    if (!isFixtureMode) {
      bridge.togglePinnedNode(pubkey)
      return
    }

    updateFixtureState((current) => {
      const pinnedNodePubkeys = new Set(current.pinnedNodePubkeys)

      if (pinnedNodePubkeys.has(pubkey)) {
        pinnedNodePubkeys.delete(pubkey)
      } else {
        pinnedNodePubkeys.add(pubkey)
      }

      return {
        ...current,
        pinnedNodePubkeys,
      }
    })
  }

  const toggleLayer = (layer: (typeof GRAPH_V2_LAYERS)[number]) => {
    if (!isFixtureMode) {
      bridge.toggleLayer(layer)
      return
    }

    updateFixtureState((current) => ({
      ...current,
      activeLayer: layer,
      connectionsSourceLayer:
        layer === 'connections' && current.activeLayer !== 'connections'
          ? 'mutuals'
          : current.connectionsSourceLayer,
    }))
  }

  const handleToggleConnections = () => {
    toggleLayer(domainState.activeLayer === 'connections' ? 'graph' : 'connections')
  }

  const setConnectionsSourceLayer = (layer: ConnectionsSourceLayer) => {
    if (!isFixtureMode) {
      bridge.setConnectionsSourceLayer(layer)
      return
    }

    updateFixtureState((current) => ({
      ...current,
      connectionsSourceLayer: layer,
    }))
  }

  const handleToggleRelationship = (role: 'following' | 'followers') => {
    const current = getRelationshipToggleState(relationshipControlLayer)
    const nextFollowing =
      role === 'following' ? !current.following : current.following
    const nextFollowers =
      role === 'followers' ? !current.followers : current.followers

    if (domainState.activeLayer === 'connections') {
      if (!nextFollowing && !nextFollowers) {
        toggleLayer('graph')
        return
      }

      if (nextFollowing && nextFollowers) {
        setConnectionsSourceLayer('mutuals')
        return
      }

      if (nextFollowing) {
        setConnectionsSourceLayer(
          current.onlyNonReciprocal ? 'following-non-followers' : 'following',
        )
        return
      }

      setConnectionsSourceLayer(
        current.onlyNonReciprocal
          ? 'nonreciprocal-followers'
          : 'followers',
      )
      return
    }

    if (!nextFollowing && !nextFollowers) {
      toggleLayer('graph')
      return
    }

    if (nextFollowing && nextFollowers) {
      toggleLayer('mutuals')
      return
    }

    if (nextFollowing) {
      toggleLayer(
        current.onlyNonReciprocal ? 'following-non-followers' : 'following',
      )
      return
    }

    toggleLayer(
      current.onlyNonReciprocal
        ? 'nonreciprocal-followers'
        : 'followers',
    )
  }

  const handleToggleOnlyNonReciprocal = () => {
    const current = getRelationshipToggleState(relationshipControlLayer)

    if (!canToggleOnlyNonReciprocal || !onlyOneRelationshipSideActive) {
      return
    }

    if (domainState.activeLayer === 'connections') {
      if (current.following) {
        setConnectionsSourceLayer(
          current.onlyNonReciprocal ? 'following' : 'following-non-followers',
        )
        return
      }

      if (current.followers) {
        setConnectionsSourceLayer(
          current.onlyNonReciprocal
            ? 'followers'
            : 'nonreciprocal-followers',
        )
      }
      return
    }

    if (current.following) {
      toggleLayer(
        current.onlyNonReciprocal ? 'following' : 'following-non-followers',
      )
      return
    }

    if (current.followers) {
      toggleLayer(
        current.onlyNonReciprocal
          ? 'followers'
          : 'nonreciprocal-followers',
      )
    }
  }

  const updateDragInfluenceTuning = <
    K extends keyof DragNeighborhoodInfluenceTuning,
  >(
    key: K,
    value: DragNeighborhoodInfluenceTuning[K],
  ) => {
    setDragInfluenceTuning((current) => ({
      ...current,
      [key]: value,
    }))
  }

  const visiblePubkeys = useMemo(
    () => deferredScene.nodes.map((node) => node.pubkey),
    [deferredScene],
  )
  const visibleEdgeKeys = useMemo(() => {
    const set = new Set<string>()
    for (const edge of deferredScene.visibleEdges) {
      if (edge.hidden) continue
      // Store both directions so a zap from A->B matches a visible edge B->A too.
      set.add(`${edge.source}|${edge.target}`)
      set.add(`${edge.target}|${edge.source}`)
    }
    return set
  }, [deferredScene])
  const visibleNodeSet = useMemo(
    () => new Set(visiblePubkeys),
    [visiblePubkeys],
  )

  const handleZap = (zap: Pick<ParsedZap, 'fromPubkey' | 'toPubkey' | 'sats'>) => {
    if (!visibleNodeSet.has(zap.fromPubkey)) return false
    if (!visibleNodeSet.has(zap.toPubkey)) return false
    if (!visibleEdgeKeys.has(`${zap.fromPubkey}|${zap.toPubkey}`)) return false
    return sigmaHostRef.current?.playZap(zap) ?? false
  }

  useLiveZapFeed({
    visiblePubkeys,
    enabled: !isFixtureMode,
    onZap: (zap) => {
      handleZap(zap)
    },
  })

  const isDev = process.env.NODE_ENV === 'development'
  const findSimulationPair = ():
    | { from: string; to: string }
    | null => {
    for (const edge of deferredScene.visibleEdges) {
      if (edge.hidden) continue
      if (!visibleNodeSet.has(edge.source)) continue
      if (!visibleNodeSet.has(edge.target)) continue
      return { from: edge.source, to: edge.target }
    }
    return null
  }
  const simulationPair = isDev ? findSimulationPair() : null
  const stableAvatarRuntimeOptions = useMemo(
    () => avatarRuntimeOptions,
    [avatarRuntimeOptions],
  )
  const handleAvatarPerfSnapshot = useCallback(
    (snapshot: PerfBudgetSnapshot | null) => {
      setAvatarPerfSnapshot(snapshot)
    },
    [],
  )

  const handleSimulateZap = () => {
    const pair = findSimulationPair()
    if (!pair) {
      setZapFeedback('Sin pares visibles conectados para simular.')
      return
    }
    // Random direction so sender/receiver alternate on repeated clicks.
    const flipped = Math.random() < 0.5
    const fromPubkey = flipped ? pair.to : pair.from
    const toPubkey = flipped ? pair.from : pair.to
    // Skewed sats sample to exercise the radius scale across its range.
    const buckets = [21, 210, 2_100, 21_000, 210_000]
    const sats = buckets[Math.floor(Math.random() * buckets.length)]
    const played = handleZap({ fromPubkey, toPubkey, sats })
    setZapFeedback(
      played
        ? `Zap simulado: ${sats} sats ${fromPubkey.slice(0, 8)}… → ${toPubkey.slice(0, 8)}…`
        : 'No se pudo reproducir el zap simulado (nodos o arista ya no visibles).',
    )
  }

  const updatePhysicsTuning = <K extends keyof ForceAtlasPhysicsTuning>(
    key: K,
    value: ForceAtlasPhysicsTuning[K],
  ) => {
    setPhysicsTuning((current) => ({
      ...current,
      [key]: value,
    }))
  }

  const handleApplyRelays = async (relayUrls: string[]) => {
    if (isFixtureMode) {
      updateFixtureState((current) => ({
        ...current,
        relayState: {
          ...current.relayState,
          urls: relayUrls,
        },
      }))
      setActionFeedback(`Fixture actualizado con ${relayUrls.length} relays.`)
      return {
        relayUrls,
        overrideStatus: 'idle',
        isGraphStale: false,
        message: `Fixture actualizado con ${relayUrls.length} relays.`,
      }
    }

    const result = await bridge.setRelays(relayUrls)
    setActionFeedback(result.message)
    return result
  }

  const handleRevertRelays = async () => {
    if (isFixtureMode) {
      updateFixtureState((current) => ({
        ...current,
        relayState: {
          ...current.relayState,
          urls: ['wss://fixture.local'],
        },
      }))
      setActionFeedback('Fixture de relays revertido.')
      return
    }

    const result = await bridge.revertRelays()
    setActionFeedback(
      result?.message ?? 'No habia override activo para revertir.',
    )
  }

  const openSettingsTab = (tab: SigmaSettingsTab) => {
    setActiveSettingsTab(tab)
    setIsRootSheetOpen(false)
    setIsSettingsOpen(true)
  }

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
        if (isFixtureMode) {
          setLoadFeedback('El fixture no admite cargar roots manuales.')
          return
        }

        const encodedNpub = npub ?? nip19.npubEncode(pubkey)
        upsertSavedRoot({
          pubkey,
          npub: encodedNpub,
          openedAt: Date.now(),
          relayHints: relays,
          profile,
          profileFetchedAt,
        })

        void bridge
          .loadRoot(pubkey, {
            bootstrapRelayUrls: relays,
          })
          .then((result) => {
            setLoadFeedback(result.message)
            setIsRootSheetOpen(false)
          })
          .catch((error) => {
            setLoadFeedback(
              error instanceof Error
                ? error.message
                : 'No se pudo cargar el root.',
            )
          })
      })
    },
    [bridge, isFixtureMode, upsertSavedRoot],
  )

  const handleSelectSavedRoot = useCallback(
    (savedRoot: SavedRootEntry) => {
      loadRootFromPointer({
        pubkey: savedRoot.pubkey,
        kind: 'npub',
        npub: savedRoot.npub,
        relays: savedRoot.relayHints ?? [],
        profile: savedRoot.profile,
        profileFetchedAt: savedRoot.profileFetchedAt,
      })
    },
    [loadRootFromPointer],
  )

  const handleDeleteSavedRoot = useCallback(
    (savedRoot: SavedRootEntry) => {
      removeSavedRoot(savedRoot.pubkey)
    },
    [removeSavedRoot],
  )

  const settingsStatusItems = [
    { label: 'Root', value: domainState.rootPubkey ? 'loaded' : 'empty' },
    { label: 'Layer', value: domainState.activeLayer },
    {
      label: 'Filtro',
      value:
        domainState.activeLayer === 'connections'
          ? domainState.connectionsSourceLayer
          : 'directo',
    },
    {
      label: 'Relays',
      value: `${domainState.relayState.urls.length} ${
        domainState.relayState.isGraphStale ? 'stale' : 'live'
      }`,
    },
  ]

  const renderSettingsContent = () => {
    switch (activeSettingsTab) {
      case 'renderer':
        return (
          <section className="settings-panel">
            <div className="settings-panel__header">
              <p className="settings-panel__eyebrow">Renderer</p>
              <h2>Avatares Sigma</h2>
              <p className="settings-panel__copy">
                Ajusta fotos, fallback y degradacion sin reiniciar la fisica.
              </p>
            </div>
            <RenderOptionsPanel
              avatarRuntimeOptions={avatarRuntimeOptions}
              avatarPerfSnapshot={avatarPerfSnapshot}
              hideAvatarsOnMove={hideAvatarsOnMove}
              onAvatarRuntimeOptionsChange={setAvatarRuntimeOptions}
              onHideAvatarsOnMoveChange={setHideAvatarsOnMove}
            />
          </section>
        )
      case 'physics':
        return (
          <section className="settings-panel">
            <div className="settings-panel__header">
              <p className="settings-panel__eyebrow">Physics</p>
              <h2>ForceAtlas2</h2>
              <p className="settings-panel__copy">
                Tunea el feel del grafo vivo sin tocar el dominio.
              </p>
            </div>
            <PhysicsTuningPanel
              onChange={updatePhysicsTuning}
              onReset={() => {
                setPhysicsTuning(DEFAULT_FORCE_ATLAS_PHYSICS_TUNING)
              }}
              tuning={physicsTuning}
            />
            {isDragFixtureLab ? (
              <DragTuningPanel
                onChange={updateDragInfluenceTuning}
                onReset={() => {
                  setDragInfluenceTuning(
                    DEFAULT_DRAG_NEIGHBORHOOD_INFLUENCE_TUNING,
                  )
                }}
                tuning={dragInfluenceTuning}
              />
            ) : null}
          </section>
        )
      case 'layers':
        return (
          <section className="settings-panel">
            <div className="settings-panel__header">
              <p className="settings-panel__eyebrow">Layers</p>
              <h2>Proyeccion activa</h2>
              <p className="settings-panel__copy">
                Cambia la lectura del vecindario visible en Sigma.
              </p>
            </div>
            <section className="settings-card sigma-lab-layer-list">
              {GRAPH_V2_LAYERS.map((layer) => {
                const isActive = layer === domainState.activeLayer
                return (
                  <button
                    aria-pressed={isActive}
                    className={`settings-pill${
                      isActive ? ' settings-pill--active' : ''
                    }`}
                    key={layer}
                    onClick={() => {
                      toggleLayer(layer)
                    }}
                    type="button"
                  >
                    {LAYER_LABELS[layer]}
                  </button>
                )
              })}
            </section>
          </section>
        )
      case 'relays':
        return (
          <section className="settings-panel">
            <div className="settings-panel__header">
              <p className="settings-panel__eyebrow">Relays</p>
              <h2>Bridge override</h2>
              <p className="settings-panel__copy">
                Cambia relays manteniendo estados parciales visibles.
              </p>
            </div>
            <RelayEditor
              isGraphStale={domainState.relayState.isGraphStale}
              onApply={handleApplyRelays}
              onRevert={handleRevertRelays}
              overrideStatus={domainState.relayState.overrideStatus}
              relayUrls={domainState.relayState.urls}
            />
          </section>
        )
      case 'internal':
        return (
          <section className="settings-panel">
            <div className="settings-panel__header">
              <p className="settings-panel__eyebrow">Internal</p>
              <h2>Runtime Sigma</h2>
              <p className="settings-panel__copy">
                Lectura tecnica compacta del renderer, topologia y viewport.
              </p>
            </div>
            <section className="dev-panel dev-panel--sidebar">
              <p className="dev-panel__title">Diagnostics</p>
              <dl>
                <div>
                  <dt>Topologia</dt>
                  <dd>{deferredScene.diagnostics.topologySignature}</dd>
                </div>
                <div>
                  <dt>Relays</dt>
                  <dd>{deferredScene.diagnostics.relayCount}</dd>
                </div>
                <div>
                  <dt>Pinned</dt>
                  <dd>{domainState.pinnedNodePubkeys.size}</dd>
                </div>
                <div>
                  <dt>Viewport</dt>
                  <dd>
                    {isFixtureMode
                      ? lastViewportRatio
                        ? `${lastViewportRatio.toFixed(2)}x`
                        : 'idle'
                      : controller.getLastViewport()
                        ? `${controller.getLastViewport()?.ratio.toFixed(2)}x`
                        : 'idle'}
                  </dd>
                </div>
              </dl>
            </section>
            {isDev ? (
              <section className="settings-card">
                <p className="settings-card__label">Zaps dev</p>
                <h3 className="sigma-lab-settings-title">Simulador</h3>
                <p className="settings-panel__fineprint">
                  Reproduce el pipeline visual de zaps sobre una arista visible.
                </p>
                <button
                  className="settings-primary-btn sigma-lab-full-button"
                  disabled={!simulationPair}
                  onClick={handleSimulateZap}
                  type="button"
                >
                  {simulationPair ? 'Simular zap' : 'Sin pares conectados'}
                </button>
                {zapFeedback ? (
                  <p className="settings-panel__fineprint">{zapFeedback}</p>
                ) : null}
              </section>
            ) : null}
          </section>
        )
    }
  }

  return (
    <main className="app-shell app-shell--immersive sigma-lab-shell">
      <section className="workspace-shell sigma-lab-workspace">
        <header className="workspace-topbar sigma-lab-topbar">
          <div className="workspace-topbar__actions">
            <button
              aria-expanded={isRootSheetOpen}
              aria-label="Abrir selector de root"
              className={`workspace-icon-btn${
                isRootSheetOpen ? ' workspace-icon-btn--active' : ''
              }`}
              onClick={() => {
                setIsSettingsOpen(false)
                setIsRootSheetOpen((value) => !value)
              }}
              type="button"
            >
              <IdentityIcon />
            </button>
            <button
              aria-expanded={isSettingsOpen}
              aria-label="Abrir configuracion Sigma"
              className={`workspace-icon-btn${
                isSettingsOpen ? ' workspace-icon-btn--active' : ''
              }`}
              onClick={() => {
                setIsRootSheetOpen(false)
                setIsSettingsOpen((value) => !value)
              }}
              type="button"
            >
              <SettingsIcon />
            </button>
          </div>
        </header>

        {(isSettingsOpen || isRootSheetOpen) && (
          <button
            aria-hidden="true"
            className="workspace-scrim sigma-lab-scrim"
            onClick={() => {
              setIsSettingsOpen(false)
              if (domainState.rootPubkey) {
                setIsRootSheetOpen(false)
              }
            }}
            tabIndex={-1}
            type="button"
          />
        )}

        {isRootSheetOpen ? (
          <section
            aria-labelledby="sigma-root-title"
            aria-modal={domainState.rootPubkey ? 'true' : undefined}
            className={`root-entry-sheet sigma-lab-root-sheet${
              domainState.rootPubkey ? '' : ' root-entry-sheet--inline'
            }${shouldShowSavedRootsSection ? ' root-entry-sheet--chooser' : ''}`}
            role={domainState.rootPubkey ? 'dialog' : 'region'}
          >
            <div className="root-entry-sheet__header">
              <div>
                <p className="root-entry-sheet__eyebrow">{rootEntryEyebrow}</p>
                <h2 id="sigma-root-title">{rootEntryTitle}</h2>
              </div>
              {domainState.rootPubkey ? (
                <button
                  aria-label="Cerrar selector de root"
                  className="root-entry-sheet__close"
                  onClick={() => setIsRootSheetOpen(false)}
                  type="button"
                >
                  <CloseIcon />
                </button>
              ) : null}
            </div>

            <div className="root-entry-sheet__body sigma-lab-root-body">
              <SavedRootsPanel
                entries={savedRoots}
                isHydrated={savedRootsHydrated}
                onDelete={handleDeleteSavedRoot}
                onSelect={handleSelectSavedRoot}
              />

              {shouldShowSavedRootsSection ? (
                <div className="root-entry-sheet__divider" aria-hidden="true">
                  <span>Otra npub</span>
                </div>
              ) : null}

              <div className="sigma-lab-root-copy">
                <p>
                  Dominio canonico, proyecciones explicitas y renderer Sigma en
                  ruta paralela.
                </p>
                <dl className="sigma-lab-root-stats">
                  <div>
                    <dt>Root</dt>
                    <dd>{domainState.rootPubkey ?? 'sin root'}</dd>
                  </div>
                  <div>
                    <dt>Load</dt>
                    <dd>{domainState.discoveryState.rootLoad.status}</dd>
                  </div>
                  <div>
                    <dt>Nodos</dt>
                    <dd>{scene.diagnostics.nodeCount}</dd>
                  </div>
                  <div>
                    <dt>Force edges</dt>
                    <dd>{scene.diagnostics.forceEdgeCount}</dd>
                  </div>
                </dl>
              </div>

              <div className="root-entry-sheet__manual">
                <NpubInput
                  onInvalidRoot={(payload) => {
                    setValidationFeedback(payload.message)
                  }}
                  onValidRoot={loadRootFromPointer}
                />
              </div>
            </div>
            {visibleLoadFeedback || validationFeedback ? (
              <p className="root-entry-sheet__fineprint">
                {visibleLoadFeedback ?? validationFeedback}
              </p>
            ) : null}
            <p className="root-entry-sheet__fineprint">
              {shouldShowSavedRootsSection
                ? 'Solo se guardan npub publicas en este navegador.'
                : domainState.rootPubkey === null
                  ? 'Pega una identidad para abrir el grafo Sigma.'
                  : 'El grafo Sigma muestra vecindario descubierto.'}
            </p>
          </section>
        ) : null}

        {isSettingsOpen ? (
          <aside
            className="settings-drawer settings-drawer--open sigma-lab-settings"
            data-settings-drawer
          >
            <div className="settings-drawer__hero">
              <div className="settings-drawer__hero-copy">
                <p className="settings-drawer__eyebrow">Workspace controls</p>
                <h2 className="settings-drawer__title">Sigma Lab</h2>
                <p className="settings-drawer__intro">
                  Ajusta renderer, fisica, relays y diagnostico sin salir del
                  grafo.
                </p>
              </div>
              <button
                aria-label="Cerrar configuracion Sigma"
                className="settings-drawer__close"
                onClick={() => setIsSettingsOpen(false)}
                type="button"
              >
                <CloseIcon />
              </button>
            </div>

            <div
              className="settings-drawer__status"
              aria-label="Estado actual de Sigma"
            >
              {settingsStatusItems.map((item) => (
                <div className="settings-status-pill" key={item.label}>
                  <span className="settings-status-pill__label">
                    {item.label}
                  </span>
                  <span className="settings-status-pill__value">
                    {item.value}
                  </span>
                </div>
              ))}
            </div>

            <div className="settings-drawer__layout">
              <nav
                className="settings-nav"
                aria-label="Secciones de configuracion Sigma"
              >
                <div className="settings-nav__section">
                  <span className="settings-nav__label">Main</span>
                  <div className="settings-tabs">
                    {SIGMA_SETTINGS_TABS.map((tab) => {
                      const isActive = activeSettingsTab === tab.id
                      return (
                        <button
                          className={`settings-tab${
                            isActive ? ' settings-tab--active' : ''
                          }`}
                          key={tab.id}
                          onClick={() => setActiveSettingsTab(tab.id)}
                          type="button"
                        >
                          {tab.label}
                        </button>
                      )
                    })}
                  </div>
                </div>
              </nav>

              <div className="settings-drawer__body">
                {renderSettingsContent()}
              </div>
            </div>
          </aside>
        ) : null}

        <section className="sigma-lab-canvas-frame" data-graph-panel>
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
        </section>

        {detail.node ? (
          <aside className="node-detail-panel sigma-lab-node-panel">
            <div className="node-detail-panel__header">
              <div className="node-detail-panel__title-block">
                <p className="node-detail-panel__eyebrow">Node Detail</p>
                <h2>{detail.displayName}</h2>
              </div>
            </div>

            <div className="node-detail-panel__hero">
              <div className="node-detail-panel__avatar">
                {detail.pictureUrl ? (
                  <img
                    alt=""
                    className="node-detail-panel__avatar-image"
                    src={detail.pictureUrl}
                  />
                ) : (
                  <AvatarFallback
                    initials={getInitials(detail.displayName)}
                    labelClassName="node-detail-panel__avatar-fallback"
                  />
                )}
              </div>
              <div className="node-detail-panel__hero-copy">
                <span className="node-detail-panel__pubkey-label">Pubkey</span>
                <p className="node-detail-panel__pubkey">{detail.pubkey}</p>
              </div>
            </div>

            <p className="node-detail-panel__about">
              {detail.about?.trim() || 'Sin bio conocida.'}
            </p>

            <dl className="node-detail-panel__grid">
              <div>
                <dt>Following</dt>
                <dd>{detail.followingCount}</dd>
              </div>
              <div>
                <dt>Followers</dt>
                <dd>{detail.followerCount}</dd>
              </div>
              <div>
                <dt>Mutuals</dt>
                <dd>{detail.mutualCount}</dd>
              </div>
            </dl>

            <div className="node-detail-panel__actions">
              <button
                className="node-detail-panel__primary-action"
                onClick={() => {
                  const selectedPubkey = detail.pubkey

                  if (!selectedPubkey) {
                    return
                  }

                  startTransition(() => {
                    if (isFixtureMode) {
                      setActionFeedback('El fixture no expande nodos por relay.')
                      return
                    }

                    void bridge.expandNode(selectedPubkey).then((result) => {
                      setActionFeedback(result.message)
                    })
                  })
                }}
                type="button"
              >
                {detail.isExpanded ? 'Nodo expandido' : 'Expandir nodo'}
              </button>
              <button
                className={`node-detail-panel__secondary-action${
                  detail.isPinned
                    ? ' node-detail-panel__secondary-action--active'
                    : ''
                }`}
                onClick={() => {
                  const selectedPubkey = detail.pubkey

                  if (!selectedPubkey) {
                    return
                  }

                  togglePinnedNode(selectedPubkey)
                }}
                type="button"
              >
                {detail.isPinned ? 'Quitar pin' : 'Fijar nodo'}
              </button>
            </div>

            <dl className="node-detail-panel__identity">
              <div>
                <span className="node-detail-panel__metric-label">nip05</span>
                <span className="node-detail-panel__metric-value">
                  {detail.nip05?.trim() || 'n/a'}
                </span>
              </div>
              <div>
                <span className="node-detail-panel__metric-label">lud16</span>
                <span className="node-detail-panel__metric-value">
                  {detail.lud16?.trim() || 'n/a'}
                </span>
              </div>
              <div>
                <span className="node-detail-panel__metric-label">
                  expansion
                </span>
                <span className="node-detail-panel__metric-value">
                  {detail.node.nodeExpansionState?.status ?? 'idle'}
                </span>
              </div>
            </dl>
          </aside>
        ) : null}

        {actionFeedback ? (
          <p className="sigma-lab-action-feedback" role="status">
            {actionFeedback}
          </p>
        ) : null}

        <section className="sigma-lab-control-bar">
          <div className="sigma-lab-control-summary">
            <span className="graph-panel__control-summary-label">
              {domainState.activeLayer === 'connections' ? 'Conexiones' : 'Vista'}
            </span>
            <strong className="graph-panel__control-summary-value">
              {domainState.activeLayer === 'connections'
                ? connectionFilterLabel
                : LAYER_LABELS[domainState.activeLayer]}
            </strong>
            <span>
              {deferredScene.diagnostics.visibleEdgeCount} visibles /{' '}
              {deferredScene.diagnostics.forceEdgeCount} fuerza
            </span>
          </div>
          <div className="sigma-lab-control-actions">
            <div
              className="graph-panel__control-group graph-panel__control-group--primary"
              data-relationship-mode={
                domainState.activeLayer === 'connections'
                  ? relationshipControlLayer
                  : undefined
              }
              role="group"
              aria-label="Vista principal del grafo Sigma"
            >
              <button
                aria-pressed={domainState.activeLayer === 'graph'}
                className={`graph-panel__control-btn${
                  domainState.activeLayer === 'graph'
                    ? ' graph-panel__control-btn--primary'
                    : ''
                }`}
                data-control-tone="neutral"
                onClick={() => toggleLayer('graph')}
                type="button"
              >
                Grafo
              </button>
              <button
                aria-pressed={domainState.activeLayer === 'connections'}
                aria-label={
                  domainState.activeLayer === 'connections'
                    ? 'Salir de conexiones'
                    : 'Activar conexiones'
                }
                className={`graph-panel__control-btn${
                  domainState.activeLayer === 'connections'
                    ? ' graph-panel__control-btn--primary'
                    : ''
                }`}
                data-control-tone="connections"
                onClick={handleToggleConnections}
                type="button"
              >
                {domainState.activeLayer === 'connections' ? 'Salir' : 'Conexiones'}
              </button>
              <button
                aria-pressed={relationshipToggleState.following}
                className={`graph-panel__control-btn${
                  relationshipToggleState.following
                    ? ' graph-panel__control-btn--primary'
                    : ''
                }`}
                data-control-tone="relationship"
                onClick={() => handleToggleRelationship('following')}
                type="button"
              >
                Sigo
              </button>
              <button
                aria-pressed={relationshipToggleState.followers}
                className={`graph-panel__control-btn${
                  relationshipToggleState.followers
                    ? ' graph-panel__control-btn--primary'
                    : ''
                }`}
                data-control-tone="relationship"
                onClick={() => handleToggleRelationship('followers')}
                type="button"
              >
                Me siguen
              </button>
              {domainState.activeLayer === 'connections' ? (
                <span className="graph-panel__control-filter-state">
                  {connectionFilterLabel}
                </span>
              ) : null}
            </div>
            <div
              aria-hidden={!isNonReciprocalAvailable}
              className="graph-panel__control-group graph-panel__control-group--aux"
              data-available={isNonReciprocalAvailable ? 'true' : 'false'}
              role="group"
              aria-label="Filtro de reciprocidad Sigma"
            >
              <button
                aria-pressed={isNonReciprocalActive}
                className={`graph-panel__control-btn graph-panel__control-btn--aux${
                  isNonReciprocalActive ? ' graph-panel__control-btn--primary' : ''
                }`}
                data-control-tone="relationship"
                disabled={!isNonReciprocalAvailable}
                onClick={handleToggleOnlyNonReciprocal}
                tabIndex={isNonReciprocalAvailable ? 0 : -1}
                type="button"
              >
                Sin reciprocidad
              </button>
            </div>
            <div
              className="graph-panel__control-group sigma-lab-control-group--settings"
              role="group"
              aria-label="Ajustes de Sigma"
            >
              <button
                className="graph-panel__control-btn"
                onClick={() => openSettingsTab('renderer')}
                type="button"
              >
                Renderer
              </button>
              <button
                className="graph-panel__control-btn"
                onClick={() => openSettingsTab('physics')}
                type="button"
              >
                Ajustes fisica
              </button>
              <button
                className="graph-panel__control-btn"
                onClick={() => openSettingsTab('internal')}
                type="button"
              >
                Diagnostics
              </button>
            </div>
          </div>
        </section>
      </section>
    </main>
  )
}
