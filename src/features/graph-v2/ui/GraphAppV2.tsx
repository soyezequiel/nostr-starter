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

import AvatarFallback from '@/components/AvatarFallback'
import { NpubInput } from '@/features/graph/components/NpubInput'
import { GraphInteractionController } from '@/features/graph-v2/application/InteractionController'
import { LegacyKernelBridge } from '@/features/graph-v2/bridge/LegacyKernelBridge'
import { GRAPH_V2_LAYERS } from '@/features/graph-v2/domain/invariants'
import type { CanonicalGraphState } from '@/features/graph-v2/domain/types'
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

const LAYER_LABELS: Record<(typeof GRAPH_V2_LAYERS)[number], string> = {
  graph: 'Graph',
  connections: 'Connections',
  following: 'Following',
  followers: 'Followers',
  mutuals: 'Mutuals',
  'following-non-followers': 'Following / Non Followers',
  'nonreciprocal-followers': 'Followers / Non Reciprocal',
}

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
  const sigmaHostRef = useRef<SigmaCanvasHostHandle | null>(null)
  const [zapFeedback, setZapFeedback] = useState<string | null>(null)
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
  const rootLoadMessage = domainState.discoveryState.rootLoad.message
  const visibleLoadFeedback =
    loadFeedback === 'Cargando root...' && rootLoadMessage
      ? rootLoadMessage
      : loadFeedback ?? rootLoadMessage
  const isDragFixtureLab = fixtureName === 'drag-local'

  const updateFixtureState = (
    updater: (current: CanonicalGraphState) => CanonicalGraphState,
  ) => {
    setFixtureState((current) =>
      current ? withClientSceneSignature(updater(current)) : current,
    )
  }

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
        layer === 'connections' ? 'mutuals' : current.connectionsSourceLayer,
    }))
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

  return (
    <main className="min-h-screen bg-[#0b0d0f] pt-16 text-white">
      <div className="mx-auto h-[calc(100vh-4rem)] max-w-[1600px] p-4">
        <div className="grid h-full gap-4 lg:grid-cols-[320px_minmax(0,1fr)_320px]">
          <aside className="flex min-h-0 flex-col gap-4 overflow-y-auto rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.02))] p-4">
            <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-white/50">Graph V2</p>
              <h1 className="mt-1 text-xl font-semibold">Sigma Lab</h1>
              <p className="mt-2 text-sm text-white/60">
                Dominio canonico, proyecciones explicitas y renderer intercambiable en ruta paralela.
              </p>
              <div className="mt-4">
                <NpubInput
                  onInvalidRoot={(payload) => {
                    setValidationFeedback(payload.message)
                  }}
                  onValidRoot={({ pubkey, relays }) => {
                    setValidationFeedback(null)
                    setLoadFeedback('Cargando root...')
                    startTransition(() => {
                      if (isFixtureMode) {
                        setLoadFeedback('El fixture no admite cargar roots manuales.')
                        return
                      }

                      void bridge
                        .loadRoot(pubkey, {
                          bootstrapRelayUrls: relays,
                        })
                        .then((result) => {
                          setLoadFeedback(result.message)
                        })
                        .catch((error) => {
                          setLoadFeedback(
                            error instanceof Error
                              ? error.message
                              : 'No se pudo cargar el root.',
                          )
                        })
                    })
                  }}
                />
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-white/40">Root</dt>
                  <dd className="mt-1 font-mono text-[11px] text-white/80">
                    {domainState.rootPubkey ?? 'sin root'}
                  </dd>
                </div>
                <div>
                  <dt className="text-white/40">Load</dt>
                  <dd className="mt-1 text-white/80">
                    {domainState.discoveryState.rootLoad.status}
                  </dd>
                </div>
                <div>
                  <dt className="text-white/40">Nodos</dt>
                  <dd className="mt-1 text-white/80">
                    {scene.diagnostics.nodeCount}
                  </dd>
                </div>
                <div>
                  <dt className="text-white/40">Force edges</dt>
                  <dd className="mt-1 text-white/80">
                    {scene.diagnostics.forceEdgeCount}
                  </dd>
                </div>
              </dl>
              {visibleLoadFeedback ? (
                <p className="mt-3 text-xs text-white/60">{visibleLoadFeedback}</p>
              ) : null}
              {validationFeedback ? (
                <p className="mt-3 text-xs text-white/60">{validationFeedback}</p>
              ) : null}
              {actionFeedback ? (
                <p className="mt-3 text-xs text-white/60">{actionFeedback}</p>
              ) : null}
            </section>

            <RelayEditor
              isGraphStale={domainState.relayState.isGraphStale}
              onApply={async (relayUrls) => {
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
              }}
              onRevert={async () => {
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
              }}
              overrideStatus={domainState.relayState.overrideStatus}
              relayUrls={domainState.relayState.urls}
            />

            <PhysicsTuningPanel
              onChange={updatePhysicsTuning}
              onReset={() => {
                setPhysicsTuning(DEFAULT_FORCE_ATLAS_PHYSICS_TUNING)
              }}
              tuning={physicsTuning}
            />

            <RenderOptionsPanel
              avatarRuntimeOptions={avatarRuntimeOptions}
              avatarPerfSnapshot={avatarPerfSnapshot}
              hideAvatarsOnMove={hideAvatarsOnMove}
              onAvatarRuntimeOptionsChange={setAvatarRuntimeOptions}
              onHideAvatarsOnMoveChange={setHideAvatarsOnMove}
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

            <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-white/50">Layers</p>
                  <h2 className="mt-1 text-sm font-semibold text-white">
                    Proyeccion activa
                  </h2>
                </div>
                <span className="rounded-full border border-white/10 px-2 py-1 text-[11px] text-white/60">
                  {domainState.activeLayer}
                </span>
              </div>

              <div className="mt-3 grid gap-2">
                {GRAPH_V2_LAYERS.map((layer) => {
                  const isActive = layer === domainState.activeLayer
                  return (
                    <button
                      className={`rounded-xl border px-3 py-2 text-left text-sm transition ${
                        isActive
                          ? 'border-[#7dd3a7] bg-[#7dd3a7]/15 text-[#7dd3a7]'
                          : 'border-white/10 bg-black/10 text-white/80 hover:border-white/20'
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
              </div>
            </section>

            {isDev ? (
              <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-white/50">Zaps (dev)</p>
                <h2 className="mt-1 text-sm font-semibold text-white">Simulador</h2>
                <p className="mt-2 text-xs leading-5 text-white/55">
                  Reproduce el pipeline visual de zaps sobre una arista visible. Solo en modo desarrollo.
                </p>
                <button
                  className="mt-3 w-full rounded-xl bg-[#ffd86b] px-3 py-2 text-sm font-medium text-black disabled:cursor-not-allowed disabled:opacity-40"
                  disabled={!simulationPair}
                  onClick={handleSimulateZap}
                  type="button"
                >
                  {simulationPair ? 'Simular zap' : 'Sin pares conectados'}
                </button>
                {zapFeedback ? (
                  <p className="mt-3 text-xs text-white/60">{zapFeedback}</p>
                ) : null}
              </section>
            ) : null}
          </aside>

          <section className="min-h-0 overflow-hidden rounded-[32px] border border-white/10 bg-[radial-gradient(circle_at_top,rgba(125,211,167,0.08),rgba(7,10,12,0.96)_45%)]">
            <div className="flex h-full flex-col">
              <header className="flex items-center justify-between border-b border-white/10 px-5 py-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-white/50">Renderer</p>
                  <h2 className="mt-1 text-sm font-semibold text-white">
                    Sigma + Graphology + ForceAtlas2
                  </h2>
                </div>
                <div className="flex items-center gap-2 text-xs text-white/50">
                  <span>{deferredScene.diagnostics.visibleEdgeCount} visibles</span>
                  <span>{deferredScene.diagnostics.forceEdgeCount} fuerza</span>
                </div>
              </header>
              <div className="min-h-0 flex-1">
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
              </div>
            </div>
          </section>

          <aside className="flex min-h-0 flex-col gap-4 overflow-y-auto rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.02))] p-4">
            <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-white/50">Node Detail</p>
              {detail.node ? (
                <>
                  <div className="mt-4 flex items-start gap-3">
                    <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-black/30">
                      {detail.pictureUrl ? (
                        <img
                          alt=""
                          className="h-full w-full object-cover"
                          src={detail.pictureUrl}
                        />
                      ) : (
                        <AvatarFallback
                          initials={getInitials(detail.displayName)}
                          labelClassName="text-lg font-semibold"
                        />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h2 className="truncate text-lg font-semibold text-white">
                        {detail.displayName}
                      </h2>
                      <p className="mt-1 font-mono text-[11px] text-white/50">
                        {detail.pubkey}
                      </p>
                    </div>
                  </div>

                  <p className="mt-4 text-sm leading-6 text-white/70">
                    {detail.about?.trim() || 'Sin bio conocida.'}
                  </p>

                  <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
                    <div>
                      <dt className="text-white/40">Following</dt>
                      <dd className="mt-1 text-white/80">{detail.followingCount}</dd>
                    </div>
                    <div>
                      <dt className="text-white/40">Followers</dt>
                      <dd className="mt-1 text-white/80">{detail.followerCount}</dd>
                    </div>
                    <div>
                      <dt className="text-white/40">Mutuals</dt>
                      <dd className="mt-1 text-white/80">{detail.mutualCount}</dd>
                    </div>
                  </dl>

                  <div className="mt-4 grid gap-2">
                    <button
                      className="rounded-xl bg-[#7dd3a7] px-3 py-2 text-sm font-medium text-black"
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
                      className={`rounded-xl border px-3 py-2 text-sm ${
                        detail.isPinned
                          ? 'border-[#ffb25b] bg-[#ffb25b]/15 text-[#ffb25b]'
                          : 'border-white/10 text-white/80'
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

                  <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-3 text-sm text-white/70">
                    <p>nip05: {detail.nip05?.trim() || 'n/a'}</p>
                    <p className="mt-1">lud16: {detail.lud16?.trim() || 'n/a'}</p>
                    <p className="mt-2 text-xs text-white/50">
                      Estado de expansion:{' '}
                      {detail.node.nodeExpansionState?.status ?? 'idle'}
                    </p>
                  </div>
                </>
              ) : (
                <div className="mt-4 rounded-2xl border border-dashed border-white/10 bg-black/20 p-4 text-sm text-white/50">
                  Selecciona un nodo en Sigma para inspeccionar el detalle y ejecutar acciones del bridge.
                </div>
              )}
            </section>

            <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-sm text-white/70">
              <p className="text-xs uppercase tracking-[0.2em] text-white/50">
                Diagnostics
              </p>
              <dl className="mt-3 grid gap-2">
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-white/40">Topologia</dt>
                  <dd className="max-w-[11rem] truncate text-white/70">
                    {deferredScene.diagnostics.topologySignature}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-white/40">Relays</dt>
                  <dd className="text-white/70">
                    {deferredScene.diagnostics.relayCount}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-white/40">Pinned</dt>
                  <dd className="text-white/70">
                    {domainState.pinnedNodePubkeys.size}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-white/40">Viewport</dt>
                  <dd className="text-white/70">
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
          </aside>
        </div>
      </div>
    </main>
  )
}
