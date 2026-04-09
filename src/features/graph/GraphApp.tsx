'use client'
/* eslint-disable react-hooks/set-state-in-effect */

import { useEffect, useState } from 'react'

import { useAppStore } from '@/features/graph/app/store'
import type { RootLoadStatus, UiPanel } from '@/features/graph/app/store/types'
import {
  GraphCanvas,
  type GraphCanvasDiagnostics,
} from '@/features/graph/components/GraphCanvas'
import { NpubInput } from '@/features/graph/components/NpubInput'
import { RelayConfigPanel } from '@/features/graph/components/RelayConfigPanel'
import { RelayHealthIndicator } from '@/features/graph/components/RelayHealthIndicator'
import { RenderConfigPanel } from '@/features/graph/components/RenderConfigPanel'
import { browserAppKernel, type RootLoader } from '@/features/graph/kernel'

interface AppProps {
  rootLoader?: RootLoader
}

type SettingsTab = 'appearance' | 'relay' | 'zip' | 'internal'

const APP_VERSION = 'v0.1.0'

const SETTINGS_TABS: Array<{ id: SettingsTab; label: string }> = [
  { id: 'appearance', label: 'Visualization' },
  { id: 'relay', label: 'Relays' },
  { id: 'zip', label: 'Export' },
  { id: 'internal', label: 'Internal' },
]

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

function getDiscoveryHeadline(
  status: RootLoadStatus,
  connectedRelayCount: number,
  relayCount: number,
) {
  const relayCopy = `${connectedRelayCount}/${relayCount} relays`

  switch (status) {
    case 'loading':
      return `Descubriendo vecindario desde ${relayCopy}`
    case 'partial':
      return `Vecindario parcial descubierto desde ${relayCopy}`
    case 'ready':
    case 'empty':
      return `Vecindario descubierto desde ${relayCopy}`
    case 'error':
      return `No se pudo descubrir el vecindario desde ${relayCopy}`
    case 'idle':
      return 'Esperando root para descubrir vecindario'
  }
}

function getStatusTone(status: RootLoadStatus) {
  switch (status) {
    case 'ready':
      return 'ok'
    case 'partial':
    case 'loading':
      return 'pending'
    case 'error':
      return 'error'
    default:
      return 'idle'
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
  const [isDiscoveryExpanded, setIsDiscoveryExpanded] = useState(false)
  const [graphDiagnostics, setGraphDiagnostics] =
    useState<GraphCanvasDiagnostics | null>(null)
  const rootPubkey = useAppStore((state) => state.rootNodePubkey)
  const nodeCount = useAppStore((state) => Object.keys(state.nodes).length)
  const linkCount = useAppStore((state) => state.links.length)
  const maxNodes = useAppStore((state) => state.graphCaps.maxNodes)
  const capReached = useAppStore((state) => state.graphCaps.capReached)
  const relayUrls = useAppStore((state) => state.relayUrls)
  const relayHealth = useAppStore((state) => state.relayHealth)
  const relayOverrideStatus = useAppStore((state) => state.relayOverrideStatus)
  const isGraphStale = useAppStore((state) => state.isGraphStale)
  const openPanel = useAppStore((state) => state.openPanel)
  const setOpenPanel = useAppStore((state) => state.setOpenPanel)
  const activeLayer = useAppStore((state) => state.activeLayer)
  const currentKeyword = useAppStore((state) => state.currentKeyword)
  const rootLoadStatus = useAppStore((state) => state.rootLoad.status)
  const rootLoadMessage = useAppStore((state) => state.rootLoad.message)
  const rootLoadSource = useAppStore((state) => state.rootLoad.loadedFrom)
  const showDiscoveryState = useAppStore(
    (state) => state.renderConfig.showDiscoveryState ?? true,
  )
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
  const isNodeDetailOpen = useAppStore(
    (state) =>
      state.openPanel === 'node-detail' && state.selectedNodePubkey !== null,
  )

  useEffect(() => {
    const mappedTab = mapPanelToSettingsTab(openPanel)
    if (mappedTab) {
      setActiveTab(mappedTab)
      setIsSettingsOpen(true)
      setIsRootEntryOpen(false)
      return
    }

    if (openPanel === 'node-detail') {
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
    isRootEntryOpen,
    isSettingsOpen,
    openPanel,
    rootLoader,
    setOpenPanel,
  ])

  useEffect(() => {
    if (!isNodeDetailOpen) {
      return
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Element)) {
        return
      }

      if (
        target.closest('[data-node-detail-panel]') ||
        target.closest('[data-graph-panel]') ||
        target.closest('[data-settings-drawer]')
      ) {
        return
      }

      rootLoader.selectNode(null)
    }

    document.addEventListener('pointerdown', handlePointerDown)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
    }
  }, [isNodeDetailOpen, rootLoader])

  const relayCount = relayUrls.length
  const connectedRelayCount = relayUrls.filter(
    (url) => relayHealth[url]?.status === 'connected',
  ).length
  const discoveryHeadline = getDiscoveryHeadline(
    rootLoadStatus,
    connectedRelayCount,
    relayCount,
  )
  const statusTone = getStatusTone(rootLoadStatus)

  const handleOpenSettings = (tab: SettingsTab = 'appearance') => {
    if (openPanel === 'node-detail') {
      setOpenPanel('overview')
    }

    setActiveTab(tab)
    setIsRootEntryOpen(false)
    setIsSettingsOpen(true)
  }

  const handleCloseSettings = () => {
    setIsSettingsOpen(false)
    if (mapPanelToSettingsTab(openPanel)) {
      setOpenPanel('overview')
    }
  }

  const handleOpenRootEntry = () => {
    if (openPanel === 'node-detail') {
      setOpenPanel('overview')
    }

    setIsSettingsOpen(false)
    setIsRootEntryOpen(true)
  }

  const handleCloseRootEntry = () => {
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
          onDiagnosticsChange={setGraphDiagnostics}
          runtime={rootLoader}
        />

        <header className="workspace-topbar">
          <div className="workspace-brand">
            <span className="workspace-brand__name">Nostr Graph Explorer</span>
            <span className="workspace-brand__version">{APP_VERSION}</span>
          </div>

          <div className="workspace-topbar__actions">
            <button
              aria-expanded={isRootEntryOpen}
              aria-label="Abrir entrada de npub"
              className={`workspace-icon-btn${
                isRootEntryOpen ? ' workspace-icon-btn--active' : ''
              }`}
              onClick={() => {
                if (isRootEntryOpen) {
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

        {showDiscoveryState ? (
          <section
            className={`discovery-strip${
              isDiscoveryExpanded ? ' discovery-strip--expanded' : ''
            }`}
            aria-live="polite"
          >
            <div className="discovery-strip__summary">
              <div className="discovery-strip__primary">
                <p className="discovery-strip__eyebrow">Discovery state</p>
                <h1 className="discovery-strip__headline">{discoveryHeadline}</h1>
              </div>

              <div className="discovery-strip__side">
                <RelayHealthIndicator mode="summary" />
                <button
                  aria-expanded={isDiscoveryExpanded}
                  className="discovery-strip__toggle"
                  onClick={() => setIsDiscoveryExpanded((current) => !current)}
                  type="button"
                >
                  {isDiscoveryExpanded ? 'Ocultar detalle' : 'Ver detalle'}
                </button>
              </div>
            </div>

            <div className="discovery-strip__chips">
              <span
                className={`discovery-chip discovery-chip--${statusTone}`}
                data-testid="discovery-status-chip"
              >
                {rootLoadStatus}
              </span>
              <span className="discovery-chip">{nodeCount} nodos</span>
              <span className="discovery-chip">{linkCount} follows descubiertos</span>
              {isGraphStale ? (
                <span className="discovery-chip discovery-chip--warn">stale</span>
              ) : null}
              {comparedNodeCount > 0 ? (
                <span className="discovery-chip">comparando {comparedNodeCount}</span>
              ) : null}
            </div>

            {isDiscoveryExpanded ? (
              <div className="discovery-strip__details">
                <p className="discovery-strip__source">
                  {rootLoadSource !== 'none'
                    ? `Fuente ${rootLoadSource}`
                    : rootPubkey
                      ? 'Sin fuente confirmada'
                      : 'Sin root cargado'}
                </p>
                {rootLoadMessage ? (
                  <p className="discovery-notice" role="status">
                    {rootLoadMessage}
                  </p>
                ) : null}
              </div>
            ) : null}
          </section>
        ) : null}

        {(isSettingsOpen || isRootEntryOpen) && (
          <button
            aria-hidden="true"
            className="workspace-scrim"
            onClick={() => {
              if (isRootEntryOpen) {
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

        {isRootEntryOpen ? (
          <section
            aria-labelledby="root-entry-title"
            aria-modal="true"
            className="root-entry-sheet"
            role="dialog"
          >
            <div className="root-entry-sheet__header">
              <div>
                <p className="root-entry-sheet__eyebrow">Entry point</p>
                <h2 id="root-entry-title">Npub / Nprofile</h2>
              </div>
              <button
                aria-label="Cerrar entrada de root"
                className="root-entry-sheet__close"
                onClick={handleCloseRootEntry}
                type="button"
              >
                X
              </button>
            </div>

            <NpubInput
              onInvalidRoot={() => {
                setRootKind(null)
              }}
              onValidRoot={({ pubkey, kind }) => {
                setRootKind(kind)
                setIsRootEntryOpen(false)
                void rootLoader.loadRoot(pubkey)
              }}
            />
            <p className="root-entry-sheet__fineprint">
              Este producto muestra vecindario descubierto, no cobertura total de la red.
            </p>
          </section>
        ) : null}

        {isSettingsOpen ? (
          <aside className="settings-drawer settings-drawer--open" data-settings-drawer>
            <div className="settings-drawer__header">
              <div>
                <p className="settings-drawer__eyebrow">Workspace</p>
                <h2 className="settings-drawer__title">Settings</h2>
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

            <nav className="settings-tabs" aria-label="Secciones de configuracion">
              {SETTINGS_TABS.filter((tab) => tab.id !== 'internal').map((tab) => {
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
            </nav>

            <div className="settings-tabs settings-tabs--advanced" aria-label="Secciones internas">
              <span className="settings-tabs__group-label">Advanced</span>
              {SETTINGS_TABS.filter((tab) => tab.id === 'internal').map((tab) => {
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

            <div className="settings-drawer__body">{renderSidebarContent()}</div>
          </aside>
        ) : null}
      </section>
    </main>
  )
}

export default App
