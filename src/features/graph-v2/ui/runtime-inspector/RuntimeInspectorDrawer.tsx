'use client'

import {
  startTransition,
  type RefObject,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import {
  buildRuntimeInspectorSnapshot,
  type RuntimeInspectorBuildInput,
  type RuntimeInspectorMetric,
  type RuntimeInspectorProjectionDelta,
  type RuntimeInspectorSnapshot,
  type RuntimeInspectorTone,
} from '@/features/graph-runtime/devtools/runtimeInspector'
import type { CanonicalGraphSceneState, CanonicalGraphUiState } from '@/features/graph-v2/domain/types'
import type { PerfBudgetSnapshot } from '@/features/graph-v2/renderer/avatar/perfBudget'
import type { GraphSceneSnapshot } from '@/features/graph-v2/renderer/contracts'
import type { SigmaCanvasHostHandle } from '@/features/graph-v2/ui/SigmaCanvasHost'
import type { VisibleProfileWarmupDebugSnapshot } from '@/features/graph-v2/ui/visibleProfileWarmup'
import { CloseIcon, CopyIcon } from '@/features/graph-v2/ui/SigmaIcons'

type InspectorSectionId =
  | 'coverage'
  | 'profiles'
  | 'avatars'
  | 'zaps'
  | 'performance'
  | 'renderer'
  | 'relays'
  | 'load'

type InspectorMode = 'rapida' | 'detalle'

interface RuntimeInspectorEvent {
  id: string
  atLabel: string
  area: string
  message: string
}

interface Props {
  open: boolean
  onClose: () => void
  sceneState: CanonicalGraphSceneState
  uiState: CanonicalGraphUiState
  scene: GraphSceneSnapshot
  graphSummary: RuntimeInspectorBuildInput['graphSummary']
  deviceSummary: RuntimeInspectorBuildInput['deviceSummary']
  zapSummary: RuntimeInspectorBuildInput['zapSummary']
  avatarPerfSnapshot: PerfBudgetSnapshot | null
  visibleProfileWarmup: VisibleProfileWarmupDebugSnapshot | null
  liveZapFeedback: string | null
  showZaps: boolean
  physicsEnabled: boolean
  imageQualityMode: RuntimeInspectorBuildInput['imageQualityMode']
  sigmaHostRef: RefObject<SigmaCanvasHostHandle | null>
}

const MAX_EVENTS = 18
const RENDERER_SAMPLE_LIMIT = 12

const rendererRolePriority: Record<
  RuntimeInspectorSnapshot['renderer']['muestras'][number]['role'],
  number
> = {
  dragged: 6,
  released: 5,
  selected: 4,
  root: 3,
  hovered: 2,
  visible: 1,
}

type RendererDiagnostics = NonNullable<
  RuntimeInspectorBuildInput['rendererDiagnostics']
>
type RendererPoint = { x: number; y: number }
type RendererPreviousState = {
  viewports: Map<string, RendererPoint>
  renders: Map<string, RendererPoint>
  physics: Map<string, RendererPoint>
  projection: RendererDiagnostics['projection'] | null
}

const classForTone = (tone: RuntimeInspectorTone) => {
  switch (tone) {
    case 'ok':
      return 'sg-runtime__tone--ok'
    case 'warn':
      return 'sg-runtime__tone--warn'
    case 'bad':
      return 'sg-runtime__tone--bad'
    default:
      return 'sg-runtime__tone--neutral'
  }
}

const useChangeCadence = (signal: string) => {
  const timestampsRef = useRef<number[]>([])
  const [cadence, setCadence] = useState(0)

  useEffect(() => {
    const now = Date.now()
    timestampsRef.current = [...timestampsRef.current, now].filter(
      (stamp) => now - stamp <= 60_000,
    )
    setCadence(timestampsRef.current.length)
  }, [signal])

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      const now = Date.now()
      timestampsRef.current = timestampsRef.current.filter(
        (stamp) => now - stamp <= 60_000,
      )
      setCadence(timestampsRef.current.length)
    }, 1_000)

    return () => window.clearInterval(intervalId)
  }, [])

  return cadence
}

const copySnapshotToClipboard = async (snapshot: RuntimeInspectorSnapshot) => {
  const payload = JSON.stringify(snapshot, null, 2)
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(payload)
    return
  }
  const textArea = document.createElement('textarea')
  textArea.value = payload
  textArea.setAttribute('readonly', '')
  textArea.style.position = 'fixed'
  textArea.style.left = '-9999px'
  document.body.appendChild(textArea)
  textArea.select()
  try {
    document.execCommand('copy')
  } finally {
    document.body.removeChild(textArea)
  }
}

const formatRuntimeNumber = (value: number | null | undefined, digits = 1) => {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return 'sin dato'
  }
  return value.toFixed(digits)
}

const formatRuntimePoint = (
  point: { x: number; y: number } | null | undefined,
  digits = 1,
) => {
  if (!point) {
    return 'sin dato'
  }
  return `${formatRuntimeNumber(point.x, digits)}, ${formatRuntimeNumber(point.y, digits)}`
}

const formatRuntimePx = (value: number | null | undefined) => {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return 'sin dato'
  }
  return `${formatRuntimeNumber(value, 1)} px`
}

const distanceBetweenPoints = (
  left: { x: number; y: number } | null,
  right: { x: number; y: number } | null,
) => {
  if (!left || !right) {
    return null
  }
  return Math.hypot(left.x - right.x, left.y - right.y)
}

const bboxMaxDelta = (
  left: RendererDiagnostics['projection']['bbox'],
  right: RendererDiagnostics['projection']['bbox'],
) => {
  if (!left || !right) {
    return null
  }

  return Math.max(
    Math.abs(left.x[0] - right.x[0]),
    Math.abs(left.x[1] - right.x[1]),
    Math.abs(left.y[0] - right.y[0]),
    Math.abs(left.y[1] - right.y[1]),
  )
}

const bboxKey = (
  bbox: RendererDiagnostics['projection']['customBBox'],
) =>
  bbox
    ? `${bbox.x[0]}:${bbox.x[1]}:${bbox.y[0]}:${bbox.y[1]}`
    : 'null'

const resolveProjectionDelta = (
  current: RendererDiagnostics['projection'],
  previous: RendererDiagnostics['projection'] | null,
): RuntimeInspectorProjectionDelta | null => {
  if (!previous) {
    return null
  }

  return {
    cameraCenterDelta: distanceBetweenPoints(
      current.camera,
      previous.camera,
    ),
    cameraRatioDelta:
      current.camera && previous.camera
        ? Math.abs(current.camera.ratio - previous.camera.ratio)
        : null,
    bboxDelta: bboxMaxDelta(current.bbox, previous.bbox),
    customBBoxChanged:
      current.customBBoxKnown && previous.customBBoxKnown
        ? bboxKey(current.customBBox) !== bboxKey(previous.customBBox)
        : null,
  }
}

const renderMetricList = (metrics: RuntimeInspectorMetric[]) => (
  <div className="sg-runtime__metric-list">
    {metrics.map((metric) => (
      <div className="sg-runtime__metric" key={`${metric.label}:${metric.value}`}>
        <span className="sg-runtime__metric-label">{metric.label}</span>
        <span
          className={`sg-runtime__metric-value${
            metric.tone ? ` ${classForTone(metric.tone)}` : ''
          }`}
        >
          {metric.value}
        </span>
      </div>
    ))}
  </div>
)

const renderResourceTop = (snapshot: RuntimeInspectorSnapshot) => (
  <div className="sg-runtime__resource-list">
    {snapshot.resourceTop.map((item) => (
      <div
        className={`sg-runtime__resource-row ${classForTone(item.tone)}`}
        key={item.id}
      >
        <span className="sg-runtime__resource-rank">{item.rank}</span>
        <span className="sg-runtime__resource-main">
          <span className="sg-runtime__resource-title">{item.titulo}</span>
          <span className="sg-runtime__resource-detail">{item.detalle}</span>
        </span>
        <span className="sg-runtime__resource-value">{item.valor}</span>
        <span className="sg-runtime__resource-intensity">{item.intensidad}</span>
      </div>
    ))}
  </div>
)

const renderRendererSamples = (
  samples: RuntimeInspectorSnapshot['renderer']['muestras'],
) => {
  if (samples.length === 0) {
    return (
      <div className="sg-runtime__empty">
        Sin muestras de nodos para este poll.
      </div>
    )
  }

  return (
    <div className="sg-runtime__rows">
      {samples.map((sample) => (
        <div className="sg-runtime__row" key={`${sample.role}:${sample.pubkey}`}>
          <span className="sg-runtime__row-title">
            {sample.pubkey.length > 18
              ? `${sample.pubkey.slice(0, 10)}...${sample.pubkey.slice(-4)}`
              : sample.pubkey}
          </span>
          <span className="sg-runtime__row-state">{sample.role}</span>
          <span className="sg-runtime__row-detail">
            viewport {formatRuntimePoint(sample.viewport)} | render{' '}
            {formatRuntimePoint(sample.render, 2)} | fisica{' '}
            {formatRuntimePoint(sample.physics, 2)} | d viewport{' '}
            {formatRuntimePx(sample.viewportDeltaFromPreviousPx)} | d render{' '}
            {formatRuntimeNumber(sample.renderDeltaFromPreviousGraph, 2)} | d fisica{' '}
            {formatRuntimeNumber(sample.physicsDeltaFromPreviousGraph, 2)} | d render/fisica{' '}
            {formatRuntimeNumber(sample.renderPhysicsDelta, 2)}
          </span>
        </div>
      ))}
    </div>
  )
}

const collectRendererDiagnostics = (
  host: SigmaCanvasHostHandle,
  scene: GraphSceneSnapshot,
  visiblePubkeys: string[],
  previous: RendererPreviousState,
): {
  diagnostics: RuntimeInspectorBuildInput['rendererDiagnostics']
  nextState: RendererPreviousState
} => {
  const drag = host.getDragRuntimeState()
  const projection = host.getProjectionDiagnostics()
  const projectionDeltaFromPrevious = resolveProjectionDelta(
    projection,
    previous.projection,
  )
  const candidates = new Map<
    string,
    RuntimeInspectorSnapshot['renderer']['muestras'][number]['role']
  >()

  const addCandidate = (
    pubkey: string | null | undefined,
    role: RuntimeInspectorSnapshot['renderer']['muestras'][number]['role'],
  ) => {
    if (!pubkey) {
      return
    }
    const currentRole = candidates.get(pubkey)
    if (
      !currentRole ||
      rendererRolePriority[role] > rendererRolePriority[currentRole]
    ) {
      candidates.set(pubkey, role)
    }
  }

  addCandidate(drag.draggedNodePubkey, 'dragged')
  addCandidate(drag.pendingDragGesturePubkey, 'dragged')
  addCandidate(drag.lastReleasedNodePubkey, 'released')
  addCandidate(scene.render.selection.selectedNodePubkey, 'selected')
  addCandidate(scene.render.cameraHint.rootPubkey, 'root')
  addCandidate(scene.render.selection.hoveredNodePubkey, 'hovered')
  for (const pubkey of visiblePubkeys) {
    addCandidate(pubkey, 'visible')
    if (candidates.size >= RENDERER_SAMPLE_LIMIT) {
      break
    }
  }

  const orderedCandidates = [...candidates.entries()]
    .sort(
      (left, right) =>
        rendererRolePriority[right[1]] - rendererRolePriority[left[1]],
    )
    .slice(0, RENDERER_SAMPLE_LIMIT)
  const nextViewports = new Map<string, RendererPoint>()
  const nextRenders = new Map<string, RendererPoint>()
  const nextPhysics = new Map<string, RendererPoint>()
  const samples = orderedCandidates.map(([pubkey, role]) => {
    const viewport = host.getViewportPosition(pubkey)
    const renderPhysics = host.getRenderPhysicsPosition(pubkey)
    const previousViewport = previous.viewports.get(pubkey) ?? null
    const previousRender = previous.renders.get(pubkey) ?? null
    const previousPhysics = previous.physics.get(pubkey) ?? null

    if (viewport) {
      nextViewports.set(pubkey, { x: viewport.x, y: viewport.y })
    }
    if (renderPhysics.render) {
      nextRenders.set(pubkey, {
        x: renderPhysics.render.x,
        y: renderPhysics.render.y,
      })
    }
    if (renderPhysics.physics) {
      nextPhysics.set(pubkey, {
        x: renderPhysics.physics.x,
        y: renderPhysics.physics.y,
      })
    }

    return {
      pubkey,
      role,
      viewport,
      render: renderPhysics.render,
      physics: renderPhysics.physics,
      renderFixed: renderPhysics.renderFixed,
      physicsFixed: renderPhysics.physicsFixed,
      renderPhysicsDelta: distanceBetweenPoints(
        renderPhysics.render,
        renderPhysics.physics,
      ),
      renderDeltaFromPreviousGraph: distanceBetweenPoints(
        renderPhysics.render,
        previousRender,
      ),
      physicsDeltaFromPreviousGraph: distanceBetweenPoints(
        renderPhysics.physics,
        previousPhysics,
      ),
      viewportDeltaFromPreviousPx: distanceBetweenPoints(
        viewport,
        previousViewport,
      ),
    }
  })

  return {
    diagnostics: {
      capturedAtMs: Date.now(),
      rootPubkey: scene.render.cameraHint.rootPubkey,
      selectedNodePubkey: scene.render.selection.selectedNodePubkey,
      hoveredNodePubkey: scene.render.selection.hoveredNodePubkey,
      drag,
      projection,
      previousProjection: previous.projection,
      projectionDeltaFromPrevious,
      invalidation: host.getRenderInvalidationState(),
      timeline: host.getDragTimeline(),
      samples,
    },
    nextState: {
      viewports: nextViewports,
      renders: nextRenders,
      physics: nextPhysics,
      projection,
    },
  }
}

export function RuntimeInspectorDrawer({
  open,
  onClose,
  sceneState,
  uiState,
  scene,
  graphSummary,
  deviceSummary,
  zapSummary,
  avatarPerfSnapshot,
  visibleProfileWarmup,
  liveZapFeedback,
  showZaps,
  physicsEnabled,
  imageQualityMode,
  sigmaHostRef,
}: Props) {
  const [mode, setMode] = useState<InspectorMode>('rapida')
  const [hostAvatarSnapshot, setHostAvatarSnapshot] =
    useState<RuntimeInspectorBuildInput['avatarRuntimeSnapshot']>(null)
  const [hostPhysicsDiagnostics, setHostPhysicsDiagnostics] =
    useState<RuntimeInspectorBuildInput['physicsDiagnostics']>(null)
  const [rendererDiagnostics, setRendererDiagnostics] =
    useState<RuntimeInspectorBuildInput['rendererDiagnostics']>(null)
  const [visibleNodePubkeys, setVisibleNodePubkeys] = useState<string[]>([])
  const [events, setEvents] = useState<RuntimeInspectorEvent[]>([])
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null)
  const [focusedSection, setFocusedSection] = useState<InspectorSectionId | null>(
    null,
  )
  const sectionRefs = useRef<Record<InspectorSectionId, HTMLElement | null>>({
    coverage: null,
    profiles: null,
    avatars: null,
    zaps: null,
    performance: null,
    renderer: null,
    relays: null,
    load: null,
  })
  const previousSnapshotRef = useRef<RuntimeInspectorSnapshot | null>(null)
  const previousRendererStateRef = useRef<RendererPreviousState>({
    viewports: new Map(),
    renders: new Map(),
    physics: new Map(),
    projection: null,
  })

  const uiSignal = useMemo(
    () =>
      [
        uiState.rootLoad.status,
        uiState.rootLoad.message ?? '',
        uiState.rootLoad.loadedFrom,
        uiState.relayState.overrideStatus,
        uiState.relayState.isGraphStale ? 'stale' : 'live',
        uiState.relayState.urls
          .map((relayUrl) => `${relayUrl}:${uiState.relayState.endpoints[relayUrl]?.status ?? 'unknown'}`)
          .join('|'),
      ].join('::'),
    [uiState],
  )
  const sceneUpdatesPerMinute = useChangeCadence(sceneState.sceneSignature)
  const uiUpdatesPerMinute = useChangeCadence(uiSignal)

  useEffect(() => {
    const host = sigmaHostRef.current
    host?.setAvatarDebugDetailsEnabled(open)
    return () => {
      host?.setAvatarDebugDetailsEnabled(false)
    }
  }, [open, sigmaHostRef])

  useEffect(() => {
    if (!open) {
      return
    }

    const syncSnapshots = () => {
      const host = sigmaHostRef.current
      if (!host) {
        previousRendererStateRef.current = {
          viewports: new Map(),
          renders: new Map(),
          physics: new Map(),
          projection: null,
        }
        startTransition(() => {
          setHostAvatarSnapshot(null)
          setHostPhysicsDiagnostics(null)
          setRendererDiagnostics(null)
          setVisibleNodePubkeys([])
        })
        return
      }
      const nextVisibleNodePubkeys = host.getVisibleNodePubkeys()
      const rendererCapture = collectRendererDiagnostics(
        host,
        scene,
        nextVisibleNodePubkeys,
        previousRendererStateRef.current,
      )
      previousRendererStateRef.current = rendererCapture.nextState
      startTransition(() => {
        setHostAvatarSnapshot(host.getAvatarRuntimeDebugSnapshot())
        setHostPhysicsDiagnostics(host.getPhysicsDiagnostics())
        setRendererDiagnostics(rendererCapture.diagnostics)
        setVisibleNodePubkeys(nextVisibleNodePubkeys)
      })
    }

    syncSnapshots()
    const intervalId = window.setInterval(syncSnapshots, 750)
    return () => window.clearInterval(intervalId)
  }, [open, scene, sigmaHostRef])

  const generatedAtMs = useMemo(() => {
    const relayCheckMs = uiState.relayState.urls.reduce<number | null>(
      (latest, relayUrl) => {
        const candidate = uiState.relayState.endpoints[relayUrl]?.lastCheckedAt ?? null
        if (candidate === null) {
          return latest
        }
        return latest === null ? candidate : Math.max(latest, candidate)
      },
      null,
    )
    const candidates = [
      visibleProfileWarmup?.generatedAtMs ?? null,
      hostAvatarSnapshot?.overlay?.generatedAtMs ?? null,
      uiState.rootLoad.visibleLinkProgress?.updatedAt ?? null,
      zapSummary.lastUpdatedAt,
      relayCheckMs,
      rendererDiagnostics?.capturedAtMs ?? null,
    ].filter((value): value is number => value !== null)

    return candidates.length > 0 ? Math.max(...candidates) : null
  }, [
    hostAvatarSnapshot,
    uiState.relayState.endpoints,
    uiState.relayState.urls,
    uiState.rootLoad.visibleLinkProgress?.updatedAt,
    visibleProfileWarmup,
    zapSummary.lastUpdatedAt,
    rendererDiagnostics?.capturedAtMs,
  ])

  const snapshot = useMemo(
    () =>
      buildRuntimeInspectorSnapshot({
        generatedAtMs,
        sceneState,
        uiState,
        scene,
        graphSummary,
        deviceSummary,
        zapSummary,
        avatarPerfSnapshot,
        avatarRuntimeSnapshot: hostAvatarSnapshot,
        physicsDiagnostics: hostPhysicsDiagnostics,
        rendererDiagnostics,
        visibleProfileWarmup,
        visibleNodePubkeys,
        liveZapFeedback,
        showZaps,
        physicsEnabled,
        imageQualityMode,
        sceneUpdatesPerMinute,
        uiUpdatesPerMinute,
      }),
    [
      avatarPerfSnapshot,
      deviceSummary,
      generatedAtMs,
      graphSummary,
      hostAvatarSnapshot,
      hostPhysicsDiagnostics,
      imageQualityMode,
      liveZapFeedback,
      physicsEnabled,
      rendererDiagnostics,
      scene,
      sceneState,
      sceneUpdatesPerMinute,
      showZaps,
      uiState,
      uiUpdatesPerMinute,
      visibleNodePubkeys,
      visibleProfileWarmup,
      zapSummary,
    ],
  )

  useEffect(() => {
    if (!open) {
      return
    }
    const previous = previousSnapshotRef.current
    previousSnapshotRef.current = snapshot
    if (!previous) {
      startTransition(() => {
        setEvents([
          {
            id: `init-${Date.now()}`,
            atLabel: snapshot.generadoA,
            area: 'Inspector',
            message: `Estado inicial: ${snapshot.primary.titulo}.`,
          },
        ])
      })
      return
    }

    const nextEvents: RuntimeInspectorEvent[] = []
    if (previous.primary.titulo !== snapshot.primary.titulo) {
      nextEvents.push({
        id: `primary-${Date.now()}`,
        atLabel: snapshot.generadoA,
        area: 'Resumen',
        message: `Problema principal: ${snapshot.primary.titulo}.`,
      })
    }
    if (previous.load.estado !== snapshot.load.estado) {
      nextEvents.push({
        id: `load-${Date.now()}`,
        atLabel: snapshot.generadoA,
        area: 'Carga Root',
        message: `Estado de carga: ${snapshot.load.estado}.`,
      })
    }
    if (previous.coverage.resumen !== snapshot.coverage.resumen) {
      nextEvents.push({
        id: `coverage-${Date.now()}`,
        atLabel: snapshot.generadoA,
        area: 'Cobertura',
        message: snapshot.coverage.resumen,
      })
    }
    if (previous.avatars.estado !== snapshot.avatars.estado) {
      nextEvents.push({
        id: `avatars-${Date.now()}`,
        atLabel: snapshot.generadoA,
        area: 'Avatares',
        message: snapshot.avatars.estado,
      })
    }
    if (previous.zaps.resumen !== snapshot.zaps.resumen) {
      nextEvents.push({
        id: `zaps-${Date.now()}`,
        atLabel: snapshot.generadoA,
        area: 'Zaps',
        message: snapshot.zaps.resumen,
      })
    }
    if (previous.renderer.resumen !== snapshot.renderer.resumen) {
      nextEvents.push({
        id: `renderer-${Date.now()}`,
        atLabel: snapshot.generadoA,
        area: 'Renderer',
        message: snapshot.renderer.resumen,
      })
    }

    if (nextEvents.length === 0) {
      return
    }

    startTransition(() => {
      setEvents((current) => [...nextEvents, ...current].slice(0, MAX_EVENTS))
    })
  }, [open, snapshot])

  const handleFocusSection = useCallback((sectionId: InspectorSectionId) => {
    setMode('detalle')
    setFocusedSection(sectionId)
    window.setTimeout(() => {
      sectionRefs.current[sectionId]?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      })
    }, 40)
  }, [])

  const handleCopySnapshot = useCallback(() => {
    void copySnapshotToClipboard(snapshot)
      .then(() => {
        setCopyFeedback('Snapshot copiado.')
        window.setTimeout(() => setCopyFeedback(null), 1800)
      })
      .catch(() => {
        setCopyFeedback('No se pudo copiar el snapshot.')
        window.setTimeout(() => setCopyFeedback(null), 1800)
      })
  }, [snapshot])

  const summaryRows = useMemo(
    () =>
      snapshot.summary.map((item) => (
        <button
          className={`sg-runtime__summary-row ${classForTone(item.tone)}`}
          key={item.id}
          onClick={() => handleFocusSection(item.id)}
          type="button"
        >
          <span className="sg-runtime__summary-title">{item.title}</span>
          <span className="sg-runtime__summary-state">{item.estado}</span>
          <span className="sg-runtime__summary-value">{item.valor}</span>
          <span className="sg-runtime__summary-detail">{item.detalle}</span>
        </button>
      )),
    [handleFocusSection, snapshot.summary],
  )

  if (!open) {
    return null
  }

  return (
    <aside className="sg-runtime" role="dialog" aria-label="Inspector de runtime">
      <div className="sg-runtime__header">
        <div className="sg-runtime__eyebrow">Inspector de runtime</div>
        <div className={`sg-runtime__headline ${classForTone(snapshot.primary.tone)}`}>
          {snapshot.primary.titulo}
        </div>
        <p className="sg-runtime__cause">{snapshot.primary.causaProbable}</p>
        <div className="sg-runtime__topline">
          <span>Confianza: {snapshot.primary.confianza}</span>
          <span>Actualizado: {snapshot.generadoA}</span>
        </div>
        <div className="sg-runtime__header-actions">
          <button
            className="sg-runtime__action sg-runtime__action--primary"
            onClick={() => handleFocusSection(snapshot.primary.abrirAhora)}
            type="button"
          >
            Abrir ahora
          </button>
          <button className="sg-runtime__action" onClick={handleCopySnapshot} type="button">
            <CopyIcon /> Copiar snapshot
          </button>
          <button
            aria-label="Cerrar inspector"
            className="sg-runtime__close"
            onClick={onClose}
            type="button"
          >
            <CloseIcon />
          </button>
        </div>
        {copyFeedback ? <div className="sg-runtime__copy-feedback">{copyFeedback}</div> : null}
      </div>

      <div className="sg-runtime__mode-switch">
        <button
          className={`sg-runtime__mode${mode === 'rapida' ? ' sg-runtime__mode--active' : ''}`}
          onClick={() => setMode('rapida')}
          type="button"
        >
          Vista rapida
        </button>
        <button
          className={`sg-runtime__mode${mode === 'detalle' ? ' sg-runtime__mode--active' : ''}`}
          onClick={() => setMode('detalle')}
          type="button"
        >
          Detalle
        </button>
      </div>

      <div className="sg-runtime__body">
        <section className="sg-runtime__summary">
          <div className="sg-runtime__section-title">Estado operativo</div>
          {summaryRows}
        </section>

        <section className="sg-runtime__resource">
          <div className="sg-runtime__section-title">Top consumo actual</div>
          {renderResourceTop(snapshot)}
        </section>

        {mode === 'rapida' ? (
          <>
            <section className="sg-runtime__quick">
              <div className="sg-runtime__section-title">Que abrir ahora</div>
              <div className="sg-runtime__quick-card">
                <div className="sg-runtime__quick-label">Siguiente paso</div>
                <div className="sg-runtime__quick-text">
                  {snapshot[snapshot.primary.abrirAhora].queLeerAhora}
                </div>
              </div>
            </section>

            <section className="sg-runtime__timeline">
              <div className="sg-runtime__section-title">Timeline reciente</div>
              {events.length === 0 ? (
                <div className="sg-runtime__empty">Sin eventos recientes.</div>
              ) : (
                <div className="sg-runtime__timeline-list">
                  {events.map((event) => (
                    <div className="sg-runtime__timeline-row" key={event.id}>
                      <span className="sg-runtime__timeline-time">{event.atLabel}</span>
                      <span className="sg-runtime__timeline-area">{event.area}</span>
                      <span className="sg-runtime__timeline-msg">{event.message}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        ) : (
          <>
            <InspectorSection
              focused={focusedSection === 'coverage'}
              onMount={(node) => {
                sectionRefs.current.coverage = node
              }}
              section={snapshot.coverage}
            >
              {renderMetricList(snapshot.coverage.cadena)}
              <div className="sg-runtime__subsection">Relays</div>
              <div className="sg-runtime__rows">
                {snapshot.coverage.relays.map((relay) => (
                  <div className="sg-runtime__row" key={relay.relay}>
                    <span className="sg-runtime__row-title">{relay.relay}</span>
                    <span className="sg-runtime__row-state">{relay.estado}</span>
                    <span className="sg-runtime__row-detail">{relay.detalle}</span>
                  </div>
                ))}
              </div>
              <div className="sg-runtime__notes">
                {snapshot.coverage.notas.map((note) => (
                  <p key={note}>{note}</p>
                ))}
              </div>
            </InspectorSection>

            <InspectorSection
              focused={focusedSection === 'load'}
              onMount={(node) => {
                sectionRefs.current.load = node
              }}
              section={snapshot.load}
            >
              {renderMetricList(snapshot.load.metricas)}
            </InspectorSection>

            <InspectorSection
              focused={focusedSection === 'profiles'}
              onMount={(node) => {
                sectionRefs.current.profiles = node
              }}
              section={snapshot.profiles}
            >
              {renderMetricList(snapshot.profiles.metricas)}
              <div className="sg-runtime__notes">
                {snapshot.profiles.notas.map((note) => (
                  <p key={note}>{note}</p>
                ))}
              </div>
            </InspectorSection>

            <InspectorSection
              focused={focusedSection === 'avatars'}
              onMount={(node) => {
                sectionRefs.current.avatars = node
              }}
              section={snapshot.avatars}
            >
              {renderMetricList(snapshot.avatars.metricas)}
              <div className="sg-runtime__subsection">Razones dominantes</div>
              {snapshot.avatars.razones.length > 0 ? (
                renderMetricList(snapshot.avatars.razones)
              ) : (
                <div className="sg-runtime__empty">Sin razones dominantes para mostrar.</div>
              )}
              <div className="sg-runtime__subsection">Casos de muestra</div>
              {snapshot.avatars.casos.length > 0 ? (
                <div className="sg-runtime__rows">
                  {snapshot.avatars.casos.map((item) => (
                    <div className="sg-runtime__row" key={`${item.nodo}:${item.causa}`}>
                      <span className="sg-runtime__row-title">{item.nodo}</span>
                      <span className="sg-runtime__row-detail">{item.causa}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="sg-runtime__empty">No hay casos problematicos visibles en este frame.</div>
              )}
            </InspectorSection>

            <InspectorSection
              focused={focusedSection === 'zaps'}
              onMount={(node) => {
                sectionRefs.current.zaps = node
              }}
              section={snapshot.zaps}
            >
              {renderMetricList(snapshot.zaps.cadena)}
              <div className="sg-runtime__notes">
                {snapshot.zaps.notas.map((note) => (
                  <p key={note}>{note}</p>
                ))}
              </div>
            </InspectorSection>

            <InspectorSection
              focused={focusedSection === 'performance'}
              onMount={(node) => {
                sectionRefs.current.performance = node
              }}
              section={snapshot.performance}
            >
              {renderMetricList(snapshot.performance.metricas)}
              <div className="sg-runtime__subsection">Top consumo actual</div>
              {renderResourceTop(snapshot)}
              <div className="sg-runtime__subsection">Sospechosos probables</div>
              <div className="sg-runtime__notes">
                {snapshot.performance.sospechosos.map((note) => (
                  <p key={note}>{note}</p>
                ))}
              </div>
            </InspectorSection>

            <InspectorSection
              focused={focusedSection === 'renderer'}
              onMount={(node) => {
                sectionRefs.current.renderer = node
              }}
              section={snapshot.renderer}
            >
              {renderMetricList(snapshot.renderer.metricas)}
              <div className="sg-runtime__subsection">Muestras render/fisica</div>
              {renderRendererSamples(snapshot.renderer.muestras)}
              <div className="sg-runtime__subsection">Notas de captura</div>
              <div className="sg-runtime__notes">
                {snapshot.renderer.notas.map((note) => (
                  <p key={note}>{note}</p>
                ))}
              </div>
            </InspectorSection>

            <InspectorSection
              focused={focusedSection === 'relays'}
              onMount={(node) => {
                sectionRefs.current.relays = node
              }}
              section={snapshot.relays}
            >
              {renderMetricList(snapshot.relays.metricas)}
              <div className="sg-runtime__rows">
                {snapshot.relays.filas.map((relay) => (
                  <div className="sg-runtime__row" key={relay.relay}>
                    <span className="sg-runtime__row-title">{relay.relay}</span>
                    <span className="sg-runtime__row-state">{relay.estado}</span>
                    <span className="sg-runtime__row-detail">{relay.detalle}</span>
                  </div>
                ))}
              </div>
            </InspectorSection>

            <section className="sg-runtime__timeline">
              <div className="sg-runtime__section-title">Timeline reciente</div>
              {events.length === 0 ? (
                <div className="sg-runtime__empty">Sin eventos recientes.</div>
              ) : (
                <div className="sg-runtime__timeline-list">
                  {events.map((event) => (
                    <div className="sg-runtime__timeline-row" key={event.id}>
                      <span className="sg-runtime__timeline-time">{event.atLabel}</span>
                      <span className="sg-runtime__timeline-area">{event.area}</span>
                      <span className="sg-runtime__timeline-msg">{event.message}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </aside>
  )
}

function InspectorSection({
  section,
  children,
  focused,
  onMount,
}: {
  section: RuntimeInspectorSnapshot[InspectorSectionId]
  children: ReactNode
  focused: boolean
  onMount: (node: HTMLElement | null) => void
}) {
  return (
    <section
      className={`sg-runtime__panel-section${focused ? ' sg-runtime__panel-section--focused' : ''}`}
      ref={onMount}
    >
      <div className="sg-runtime__section-title">{section.titulo}</div>
      <div className={`sg-runtime__section-state ${classForTone(section.tone)}`}>
        {section.resumen}
      </div>
      <div className="sg-runtime__section-statusline">{section.estado}</div>
      <div className="sg-runtime__guide">
        <div>
          <span className="sg-runtime__guide-label">Que significa</span>
          <p>{section.queSignifica}</p>
        </div>
        <div>
          <span className="sg-runtime__guide-label">Que esta pasando ahora</span>
          <p>{section.quePasaAhora}</p>
        </div>
        <div>
          <span className="sg-runtime__guide-label">Que leer ahora</span>
          <p>{section.queLeerAhora}</p>
        </div>
      </div>
      {children}
    </section>
  )
}
