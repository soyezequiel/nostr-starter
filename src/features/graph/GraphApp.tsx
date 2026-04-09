'use client'
/* eslint-disable react-hooks/set-state-in-effect */

import { useEffect, useState } from 'react'
import { nip19 } from 'nostr-tools'

import { useAppStore } from '@/features/graph/app/store'
import type {
  GraphNode,
  SavedRootEntry,
  SavedRootProfileSnapshot,
  UiPanel,
} from '@/features/graph/app/store/types'
import {
  GraphCanvas,
  type GraphCanvasDiagnostics,
} from '@/features/graph/components/GraphCanvas'
import { NpubInput } from '@/features/graph/components/NpubInput'
import { RelayConfigPanel } from '@/features/graph/components/RelayConfigPanel'
import { RelayHealthIndicator } from '@/features/graph/components/RelayHealthIndicator'
import { RenderConfigPanel } from '@/features/graph/components/RenderConfigPanel'
import { SavedRootsPanel } from '@/features/graph/components/SavedRootsPanel'
import {
  browserAppKernel,
  CURATED_SAMPLE_ROOT,
  type LoadRootOptions,
  type RootLoader,
} from '@/features/graph/kernel'
import {
  fetchProfileByPubkey,
  type NostrProfile,
} from '@/lib/nostr'

interface AppProps {
  rootLoader?: RootLoader
}

type SettingsTab = 'appearance' | 'relay' | 'zip' | 'internal'

const SETTINGS_TABS: Array<{ id: SettingsTab; label: string }> = [
  { id: 'appearance', label: 'Visualization' },
  { id: 'relay', label: 'Relays' },
  { id: 'zip', label: 'Export' },
  { id: 'internal', label: 'Internal' },
]
const SAVED_ROOT_PROFILE_STALE_MS = 6 * 60 * 60 * 1000
const MAX_SAVED_ROOT_REFRESHES = 6

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

function mapGraphNodeToSavedRootProfile(node: GraphNode): SavedRootProfileSnapshot {
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

function GearIcon() {
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

function PathIcon() {
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
      <circle cx="6.5" cy="6.5" r="2.5" />
      <circle cx="17.5" cy="17.5" r="2.5" />
      <path d="M8.5 8.5 12 12l3.5-3.5" />
      <path d="M12 12v4" />
      <path d="M12 16h3" />
    </svg>
  )
}

function mapPanelToSettingsTab(panel: UiPanel): SettingsTab | null {
  switch (panel) {
    case 'relay-config':
      return 'relay'
    case 'render-config':
      return 'appearance'
    case 'export':
      return 'zip'
    default:
      return null
  }
}

function formatMs(value: number) {
  return value > 0 ? `${value.toFixed(1)} ms` : 'n/a'
}

function formatImageHealth(
  health: GraphCanvasDiagnostics['image']['snapshot']['diagnostics']['health'],
) {
  switch (health) {
    case 'healthy':
      return 'Saludable'
    case 'degraded':
      return 'Degradado'
    case 'blocked':
      return 'Bloqueado'
  }
}

function formatBottleneck(
  stage: GraphCanvasDiagnostics['image']['snapshot']['diagnostics']['bottleneckStage'],
) {
  switch (stage) {
    case 'source':
      return 'Origen'
    case 'persistent':
      return 'SSD'
    case 'compressed':
      return 'RAM comprimida'
    case 'decoded':
      return 'RAM decodificada'
    case 'resident':
      return 'VRAM'
    case 'screen':
      return 'Pantalla'
    case null:
      return 'Sin cuello'
  }
}

function App({ rootLoader = browserAppKernel }: AppProps) {
  const [rootKind, setRootKind] = useState<'npub' | 'nprofile' | null>(null)
  const [activeTab, setActiveTab] = useState<SettingsTab>('appearance')
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isRootEntryOpen, setIsRootEntryOpen] = useState(false)
  const [graphDiagnostics, setGraphDiagnostics] =
    useState<GraphCanvasDiagnostics | null>(null)
  const rootPubkey = useAppStore((state) => state.rootNodePubkey)
  const currentRootNode = useAppStore((state) =>
    state.rootNodePubkey ? state.nodes[state.rootNodePubkey] ?? null : null,
  )
  const nodeCount = useAppStore((state) => Object.keys(state.nodes).length)
  const linkCount = useAppStore((state) => state.links.length)
  const maxNodes = useAppStore((state) => state.graphCaps.maxNodes)
  const capReached = useAppStore((state) => state.graphCaps.capReached)
  const relayUrls = useAppStore((state) => state.relayUrls)
  const relayOverrideStatus = useAppStore((state) => state.relayOverrideStatus)
  const isGraphStale = useAppStore((state) => state.isGraphStale)
  const openPanel = useAppStore((state) => state.openPanel)
  const setOpenPanel = useAppStore((state) => state.setOpenPanel)
  const activeLayer = useAppStore((state) => state.activeLayer)
  const currentKeyword = useAppStore((state) => state.currentKeyword)
  const rootLoadStatus = useAppStore((state) => state.rootLoad.status)
  const rootLoadMessage = useAppStore((state) => state.rootLoad.message)
  const rootLoadSource = useAppStore((state) => state.rootLoad.loadedFrom)
  const selectedDeepUserCount = useAppStore(
    (state) => state.selectedDeepUserPubkeys.length,
  )
  const maxSelectedDeepUsers = useAppStore(
    (state) => state.maxSelectedDeepUsers,
  )
  const exportJobPhase = useAppStore((state) => state.exportJob.phase)
  const exportJobPercent = useAppStore((state) => state.exportJob.percent)
  const comparedNodeCount = useAppStore(
    (state) => state.comparedNodePubkeys.size,
  )
  const selectedNodePubkey = useAppStore((state) => state.selectedNodePubkey)
  const savedRoots = useAppStore((state) => state.savedRoots)
  const savedRootsHydrated = useAppStore((state) => state.savedRootsHydrated)
  const upsertSavedRoot = useAppStore((state) => state.upsertSavedRoot)
  const removeSavedRoot = useAppStore((state) => state.removeSavedRoot)
  const setSavedRootProfile = useAppStore((state) => state.setSavedRootProfile)
  const pathfindingSelectionMode = useAppStore(
    (state) => state.pathfinding.selectionMode,
  )
  const setPathfindingSelectionMode = useAppStore(
    (state) => state.setPathfindingSelectionMode,
  )
  const isNodeDetailOpen = useAppStore(
    (state) =>
      state.openPanel === 'node-detail' && state.selectedNodePubkey !== null,
  )
  const isPathfindingOpen = useAppStore(
    (state) => state.openPanel === 'pathfinding',
  )

  useEffect(() => {
    const mappedTab = mapPanelToSettingsTab(openPanel)
    if (mappedTab) {
      setActiveTab(mappedTab)
      setIsSettingsOpen(true)
      setIsRootEntryOpen(false)
      return
    }

    if (openPanel === 'node-detail' || openPanel === 'pathfinding') {
      setIsSettingsOpen(false)
      setIsRootEntryOpen(false)
    }
  }, [openPanel])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (isRootEntryOpen) {
          setIsRootEntryOpen(false)
          return
        }

        if (isSettingsOpen) {
          setIsSettingsOpen(false)
          if (mapPanelToSettingsTab(openPanel)) {
            setOpenPanel('overview')
          }
          return
        }

        if (isPathfindingOpen) {
          if (pathfindingSelectionMode !== 'idle') {
            setPathfindingSelectionMode('idle')
            return
          }

          setOpenPanel('overview')
          return
        }

        if (isNodeDetailOpen) {
          rootLoader.selectNode(null)
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [
    isNodeDetailOpen,
    isPathfindingOpen,
    isRootEntryOpen,
    isSettingsOpen,
    openPanel,
    pathfindingSelectionMode,
    rootLoader,
    setPathfindingSelectionMode,
    setOpenPanel,
  ])

  useEffect(() => {
    if (!isNodeDetailOpen && !isPathfindingOpen) {
      return
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Element)) {
        return
      }

      if (
        target.closest('[data-node-detail-panel]') ||
        target.closest('[data-pathfinding-panel]') ||
        target.closest('[data-graph-panel]') ||
        target.closest('[data-settings-drawer]')
      ) {
        return
      }

      if (isNodeDetailOpen) {
        rootLoader.selectNode(null)
        return
      }

      setOpenPanel('overview')
    }

    document.addEventListener('pointerdown', handlePointerDown)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
    }
  }, [isNodeDetailOpen, isPathfindingOpen, rootLoader, setOpenPanel])

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
    if (!rootPubkey || !currentRootNode) {
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
      rootPubkey,
      mapGraphNodeToSavedRootProfile(currentRootNode),
      currentRootNode.profileFetchedAt ?? Date.now(),
    )
  }, [currentRootNode, rootPubkey, setSavedRootProfile])

  const relayCount = relayUrls.length
  const isRootEntryInline = rootPubkey === null
  const shouldShowRootEntry = isRootEntryInline || isRootEntryOpen
  const hasSavedRoots = savedRoots.length > 0
  const shouldShowSavedRootsSection = !savedRootsHydrated || hasSavedRoots
  const rootEntryTitle = isRootEntryInline
    ? shouldShowSavedRootsSection
      ? 'Identidades guardadas'
      : 'Ingresa una npub o nprofile'
    : shouldShowSavedRootsSection
      ? 'Cambiar identidad'
      : 'Cambiar root'
  const rootEntryEyebrow = isRootEntryInline
    ? shouldShowSavedRootsSection
      ? 'Guardadas'
      : 'Root'
    : 'Root'
  const rootEntryButtonLabel = isRootEntryInline
    ? 'Entrada de root activa'
    : 'Abrir selector de root'
  const primaryTabs = SETTINGS_TABS.filter((tab) => tab.id !== 'internal')
  const advancedTabs = SETTINGS_TABS.filter((tab) => tab.id === 'internal')
  const settingsStatusItems = [
    { label: 'Root', value: rootLoadStatus },
    { label: 'Layer', value: activeLayer },
    {
      label: 'Relays',
      value: `${relayCount} ${isGraphStale ? 'stale' : 'live'}`,
    },
  ]

  const handleResolveRoot = ({
    kind,
    npub,
    pubkey,
  }: {
    npub?: string
    pubkey: string
    kind: 'npub' | 'nprofile'
  }, loadOptions?: LoadRootOptions) => {
    setRootKind(kind)
    upsertSavedRoot({
      pubkey,
      npub: npub ?? nip19.npubEncode(pubkey),
      openedAt: Date.now(),
    })
    setIsSettingsOpen(false)
    setIsRootEntryOpen(false)
    void rootLoader.loadRoot(pubkey, loadOptions)
  }

  const handleSelectSavedRoot = (savedRoot: SavedRootEntry) => {
    handleResolveRoot({
      pubkey: savedRoot.pubkey,
      kind: 'npub',
      npub: savedRoot.npub,
    })
  }

  const handleLoadCuratedSampleRoot = () => {
    handleResolveRoot(
      {
        pubkey: CURATED_SAMPLE_ROOT.pubkey,
        kind: 'npub',
        npub: CURATED_SAMPLE_ROOT.npub,
      },
      { useDefaultRelays: true },
    )
  }

  const handleOpenSettings = (tab: SettingsTab = 'appearance') => {
    if (openPanel === 'node-detail' || openPanel === 'pathfinding') {
      setOpenPanel('overview')
    }

    setActiveTab(tab)
    setIsRootEntryOpen(false)
    setIsSettingsOpen(true)
  }

  const handleTogglePathfinding = () => {
    if (isPathfindingOpen) {
      if (pathfindingSelectionMode !== 'idle') {
        setPathfindingSelectionMode('idle')
      }
      setOpenPanel('overview')
      return
    }

    if (openPanel === 'node-detail') {
      setOpenPanel('overview')
    }

    setIsSettingsOpen(false)
    setIsRootEntryOpen(false)
    setPathfindingSelectionMode('idle')
    setOpenPanel('pathfinding')
  }

  const handleCloseSettings = () => {
    setIsSettingsOpen(false)
    if (mapPanelToSettingsTab(openPanel)) {
      setOpenPanel('overview')
    }
  }

  const handleOpenRootEntry = () => {
    if (openPanel === 'node-detail' || openPanel === 'pathfinding') {
      setOpenPanel('overview')
    }

    setIsSettingsOpen(false)
    setIsRootEntryOpen(true)
  }

  const handleCloseRootEntry = () => {
    if (isRootEntryInline) {
      return
    }
    setIsRootEntryOpen(false)
  }

  const exportSummary =
    exportJobPhase === 'idle'
      ? 'Snapshot listo'
      : exportJobPhase === 'freezing-snapshot'
        ? 'Congelando snapshot'
        : exportJobPhase === 'packaging'
          ? `Empaquetando ${exportJobPercent}%`
          : exportJobPhase === 'completed'
            ? 'ZIP listo'
            : exportJobPhase === 'failed'
              ? 'Error de export'
              : exportJobPhase

  const renderSidebarContent = () => {
    switch (activeTab) {
      case 'appearance':
        return (
          <section className="settings-panel">
            <div className="settings-panel__header">
              <p className="settings-panel__eyebrow">Visualization</p>
              <h2>Visualizacion del grafo</h2>
              <p className="settings-panel__copy">
                Agrupa nodos, conexiones e imagenes para priorizar lectura del vecindario descubierto.
              </p>
            </div>
            <RenderConfigPanel />
          </section>
        )
      case 'relay':
        return (
          <section className="settings-panel">
            <div className="settings-panel__header">
              <p className="settings-panel__eyebrow">Relay control</p>
              <h2>Relays</h2>
              <p className="settings-panel__copy">
                Cambia el set activo manteniendo visible el vecindario previo hasta que haya nueva evidencia.
              </p>
            </div>
            <div className="settings-stack">
              <RelayConfigPanel mode="embedded" rootLoader={rootLoader} />
              <section className="settings-card">
                <RelayHealthIndicator />
              </section>
            </div>
          </section>
        )
      case 'zip':
        return (
          <section className="settings-panel">
            <div className="settings-panel__header">
              <p className="settings-panel__eyebrow">Audit export</p>
              <h2>Export</h2>
              <p className="settings-panel__copy">
                Exporta el snapshot descubierto con evidencia auditable y particionado deterministico cuando haga falta.
              </p>
            </div>

            <section className="settings-card settings-card--export">
              <h3>Snapshot auditable</h3>
              <p className="settings-panel__fineprint">
                Incluye query plan, fetch log y eventos aceptados o rechazados por usuario exportado.
              </p>
              <dl className="settings-metrics-list">
                <div>
                  <dt>Seleccion</dt>
                  <dd>
                    {selectedDeepUserCount}/{maxSelectedDeepUsers}
                  </dd>
                </div>
                <div>
                  <dt>Fase</dt>
                  <dd>{exportSummary}</dd>
                </div>
              </dl>
              <button
                className="settings-primary-btn"
                disabled={
                  nodeCount === 0 ||
                  exportJobPhase === 'freezing-snapshot' ||
                  exportJobPhase === 'packaging'
                }
                onClick={() => {
                  void browserAppKernel.exportSnapshot()
                }}
                type="button"
              >
                {exportJobPhase === 'freezing-snapshot'
                  ? 'Congelando snapshot...'
                  : exportJobPhase === 'packaging'
                    ? `Empaquetando... ${exportJobPercent}%`
                    : 'Descargar ZIP'}
              </button>
            </section>
          </section>
        )
      case 'internal': {
        const imageSnapshot = graphDiagnostics?.image.snapshot ?? null

        return (
          <section className="settings-panel">
            <div className="settings-panel__header">
              <p className="settings-panel__eyebrow">Runtime readout</p>
              <h2>Estado interno</h2>
              <p className="settings-panel__copy">
                Lectura tecnica del runtime, residencia de imagenes y estado vivo de la sesion.
              </p>
            </div>

            <div className="settings-stack">
              <section className="dev-panel dev-panel--sidebar">
                <p className="dev-panel__title">Session state</p>
                <dl>
                  <div>
                    <dt>Graph</dt>
                    <dd>
                      {nodeCount} nodos / {linkCount} links / cap {maxNodes}{' '}
                      {capReached ? 'alcanzado' : 'disponible'}
                    </dd>
                  </div>
                  <div>
                    <dt>Relays</dt>
                    <dd>
                      {relayCount} relays / override {relayOverrideStatus} /{' '}
                      {isGraphStale ? 'stale' : 'vigente'}
                    </dd>
                  </div>
                  <div>
                    <dt>UI</dt>
                    <dd>
                      panel={openPanel} / capa={activeLayer} / comparando=
                      {comparedNodeCount} / kw={currentKeyword || '-'}
                    </dd>
                  </div>
                  <div>
                    <dt>Root</dt>
                    <dd>
                      {rootKind ?? '-'} / {rootLoadStatus} /{' '}
                      {rootLoadSource !== 'none' ? rootLoadSource : 'no-source'}
                    </dd>
                  </div>
                  <div>
                    <dt>Export</dt>
                    <dd>
                      {selectedDeepUserCount}/{maxSelectedDeepUsers} selec. /{' '}
                      {exportJobPhase}{' '}
                      {exportJobPercent > 0 ? `${exportJobPercent}%` : ''}
                    </dd>
                  </div>
                  <div>
                    <dt>Diagnostics</dt>
                    <dd>
                      {graphDiagnostics
                        ? `${graphDiagnostics.stream.label} / ${graphDiagnostics.stream.meta}`
                        : 'sin snapshot'}
                    </dd>
                  </div>
                </dl>
              </section>

              <section className="dev-panel dev-panel--sidebar">
                <p className="dev-panel__title">Image runtime</p>
                {imageSnapshot ? (
                  <dl>
                    <div>
                      <dt>Health</dt>
                      <dd>
                        {formatImageHealth(imageSnapshot.diagnostics.health)} / cuello{' '}
                        {formatBottleneck(imageSnapshot.diagnostics.bottleneckStage)}
                      </dd>
                    </div>
                    <div>
                      <dt>Coverage</dt>
                      <dd>
                        {imageSnapshot.presentation.paintedVisibleNodes}/
                        {imageSnapshot.visibility.visibleScreenNodes} visibles pintados
                      </dd>
                    </div>
                    <div>
                      <dt>Runtime</dt>
                      <dd>
                        listas {graphDiagnostics?.image.readyImageCount ?? 0} / pendientes{' '}
                        {imageSnapshot.pendingWork.queuedRequests +
                          imageSnapshot.pendingWork.inFlightRequests}
                      </dd>
                    </div>
                    <div>
                      <dt>IconLayer</dt>
                      <dd>
                        pendientes {imageSnapshot.presentation.iconLayerPendingVisibleNodes}{' '}
                        / fallos {imageSnapshot.presentation.iconLayerExplicitFailedVisibleNodes}{' '}
                        / dropped {imageSnapshot.presentation.iconLayerDroppedVisibleNodes}
                      </dd>
                    </div>
                    <div>
                      <dt>Context</dt>
                      <dd>
                        modo {imageSnapshot.context.imageQualityMode ?? 'n/a'} / visibles{' '}
                        {imageSnapshot.context.visibleRequests} / precarga{' '}
                        {imageSnapshot.context.prefetchRequests}
                      </dd>
                    </div>
                    <div>
                      <dt>Queue</dt>
                      <dd>
                        cola {imageSnapshot.pendingWork.queuedRequests} / en vuelo{' '}
                        {imageSnapshot.pendingWork.inFlightRequests} / URLs bloqueadas{' '}
                        {imageSnapshot.failures.blockedSourceUrls}
                      </dd>
                    </div>
                    <div>
                      <dt>Primary</dt>
                      <dd>{imageSnapshot.diagnostics.primarySummary}</dd>
                    </div>
                    {imageSnapshot.diagnostics.secondarySummary ? (
                      <div>
                        <dt>Secondary</dt>
                        <dd>{imageSnapshot.diagnostics.secondarySummary}</dd>
                      </div>
                    ) : null}
                  </dl>
                ) : (
                  <p className="settings-panel__fineprint">
                    El canvas todavia no emitio un snapshot de diagnostico.
                  </p>
                )}
              </section>

              <section className="dev-panel dev-panel--sidebar">
                <p className="dev-panel__title">Render loop</p>
                <dl>
                  <div>
                    <dt>Status</dt>
                    <dd>
                      {graphDiagnostics?.render.status ?? 'idle'} /{' '}
                      {graphDiagnostics?.render.reasons.join(', ') || 'sin motivos'}
                    </dd>
                  </div>
                  <div>
                    <dt>Model</dt>
                    <dd>
                      {graphDiagnostics?.render.nodeCount ?? 0} nodos /{' '}
                      {graphDiagnostics?.render.edgeCount ?? 0} edges /{' '}
                      {graphDiagnostics?.render.labelCount ?? 0} labels
                    </dd>
                  </div>
                  <div>
                    <dt>Perf</dt>
                    <dd>
                      ultimo {formatMs(graphDiagnostics?.render.lastBuildMs ?? 0)} / promedio{' '}
                      {formatMs(graphDiagnostics?.render.avgBuildMs ?? 0)}
                    </dd>
                  </div>
                  <div>
                    <dt>Trigger</dt>
                    <dd>{graphDiagnostics?.render.lastRenderTrigger ?? 'n/a'}</dd>
                  </div>
                  <div>
                    <dt>Thinning</dt>
                    <dd>{graphDiagnostics?.render.thinnedEdgeCount ?? 0} edges podados</dd>
                  </div>
                  <div>
                    <dt>Selection</dt>
                    <dd>{selectedNodePubkey ?? 'sin nodo seleccionado'}</dd>
                  </div>
                </dl>
              </section>
            </div>
          </section>
        )
      }
    }
  }

  return (
    <main className="app-shell app-shell--immersive">
      <section className="workspace-shell">
        <GraphCanvas
          onTrySampleRoot={handleLoadCuratedSampleRoot}
          onDiagnosticsChange={setGraphDiagnostics}
          runtime={rootLoader}
        />

        <header className="workspace-topbar">
          <div className="workspace-topbar__actions">
            <button
              aria-expanded={isPathfindingOpen}
              aria-label="Abrir pathfinding"
              className={`workspace-icon-btn${
                isPathfindingOpen ? ' workspace-icon-btn--active' : ''
              }`}
              onClick={handleTogglePathfinding}
              type="button"
            >
              <PathIcon />
            </button>
            <button
              aria-expanded={shouldShowRootEntry}
              aria-label={rootEntryButtonLabel}
              className={`workspace-icon-btn${
                shouldShowRootEntry ? ' workspace-icon-btn--active' : ''
              }`}
              onClick={() => {
                if (shouldShowRootEntry) {
                  handleCloseRootEntry()
                } else {
                  handleOpenRootEntry()
                }
              }}
              type="button"
            >
              <IdentityIcon />
            </button>
            <button
              aria-expanded={isSettingsOpen}
              aria-label="Abrir configuracion"
              className={`workspace-icon-btn${
                isSettingsOpen ? ' workspace-icon-btn--active' : ''
              }`}
              onClick={() => {
                if (isSettingsOpen) {
                  handleCloseSettings()
                } else {
                  handleOpenSettings('appearance')
                }
              }}
              type="button"
            >
              <GearIcon />
            </button>
          </div>
        </header>

        {(isSettingsOpen || (isRootEntryOpen && !isRootEntryInline)) && (
          <button
            aria-hidden="true"
            className="workspace-scrim"
            onClick={() => {
              if (isRootEntryOpen && !isRootEntryInline) {
                handleCloseRootEntry()
              }
              if (isSettingsOpen) {
                handleCloseSettings()
              }
            }}
            tabIndex={-1}
            type="button"
          />
        )}

        {shouldShowRootEntry ? (
          <section
            aria-labelledby="root-entry-title"
            aria-modal={isRootEntryInline ? undefined : 'true'}
            className={`root-entry-sheet${
              isRootEntryInline ? ' root-entry-sheet--inline' : ''
            }${shouldShowSavedRootsSection ? ' root-entry-sheet--chooser' : ''}`}
            role={isRootEntryInline ? 'region' : 'dialog'}
          >
            <div className="root-entry-sheet__header">
              <div>
                <p className="root-entry-sheet__eyebrow">{rootEntryEyebrow}</p>
                <h2 id="root-entry-title">{rootEntryTitle}</h2>
              </div>
              {!isRootEntryInline ? (
                <button
                  aria-label="Cerrar entrada de root"
                  className="root-entry-sheet__close"
                  onClick={handleCloseRootEntry}
                  type="button"
                >
                  X
                </button>
              ) : null}
            </div>

            <div className="root-entry-sheet__body">
              <SavedRootsPanel
                entries={savedRoots}
                isHydrated={savedRootsHydrated}
                onDelete={(savedRoot) => removeSavedRoot(savedRoot.pubkey)}
                onSelect={handleSelectSavedRoot}
              />

              {shouldShowSavedRootsSection ? (
                <div className="root-entry-sheet__divider" aria-hidden="true">
                  <span>Otra npub</span>
                </div>
              ) : null}

              <div className="root-entry-sheet__manual">
                <NpubInput
                  onInvalidRoot={() => {
                    setRootKind(null)
                  }}
                  onValidRoot={handleResolveRoot}
                />
              </div>
            </div>
            {rootLoadMessage ? (
              <p className="root-entry-sheet__status" role="status">
                {rootLoadMessage}
              </p>
            ) : null}
            <p className="root-entry-sheet__fineprint">
              {shouldShowSavedRootsSection
                ? 'Solo se guardan npub publicas en este navegador.'
                : isRootEntryInline
                  ? 'Pega una identidad para abrir el grafo.'
                  : 'El grafo muestra vecindario descubierto.'}
            </p>
          </section>
        ) : null}

        {isSettingsOpen ? (
          <aside className="settings-drawer settings-drawer--open" data-settings-drawer>
            <div className="settings-drawer__hero">
              <div className="settings-drawer__hero-copy">
                <p className="settings-drawer__eyebrow">Workspace controls</p>
                <h2 className="settings-drawer__title">Settings</h2>
                <p className="settings-drawer__intro">
                  Ajusta visualizacion, relays y export sin salir del grafo.
                </p>
              </div>
              <button
                aria-label="Ocultar panel de configuracion"
                className="settings-drawer__close"
                onClick={handleCloseSettings}
                type="button"
              >
                X
              </button>
            </div>

            <div className="settings-drawer__status" aria-label="Estado actual del workspace">
              {settingsStatusItems.map((item) => (
                <div className="settings-status-pill" key={item.label}>
                  <span className="settings-status-pill__label">{item.label}</span>
                  <span className="settings-status-pill__value">{item.value}</span>
                </div>
              ))}
            </div>

            <div className="settings-drawer__layout">
              <nav className="settings-nav" aria-label="Secciones de configuracion">
                <div className="settings-nav__section">
                  <span className="settings-nav__label">Main</span>
                  <div className="settings-tabs">
                    {primaryTabs.map((tab) => {
                      const isActive = activeTab === tab.id
                      return (
                        <button
                          key={tab.id}
                          className={`settings-tab${isActive ? ' settings-tab--active' : ''}`}
                          onClick={() => setActiveTab(tab.id)}
                          type="button"
                        >
                          {tab.label}
                        </button>
                      )
                    })}
                  </div>
                </div>

                <div className="settings-nav__section settings-nav__section--advanced">
                  <span className="settings-nav__label">Advanced</span>
                  <div className="settings-tabs settings-tabs--advanced">
                    {advancedTabs.map((tab) => {
                      const isActive = activeTab === tab.id
                      return (
                        <button
                          key={tab.id}
                          className={`settings-tab${isActive ? ' settings-tab--active' : ''}`}
                          onClick={() => setActiveTab(tab.id)}
                          type="button"
                        >
                          {tab.label}
                        </button>
                      )
                    })}
                  </div>
                </div>
              </nav>

              <div className="settings-drawer__body">{renderSidebarContent()}</div>
            </div>
          </aside>
        ) : null}
      </section>
    </main>
  )
}

export default App
