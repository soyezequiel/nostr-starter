import { useEffect, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'

import {
  selectPathfindingContext,
  useAppStore,
} from '@/features/graph/app/store'
import type {
  GraphNode,
  PathfindingStatus,
  UiLayer,
} from '@/features/graph/app/store/types'
import type { RootLoader } from '@/features/graph/kernel'
import {
  decodeProfilePointer,
  type ProfilePointerDecodeResult,
} from '@/features/graph/kernel/nip19'
import { truncatePubkey } from '@/features/graph/render'

interface PathfindingPanelProps {
  runtime: RootLoader
}

type EffectivePathfindingStatus =
  | 'disabled'
  | 'ready'
  | Extract<PathfindingStatus, 'computing' | 'found' | 'not-found' | 'error'>

const getNodeTitle = (
  pubkey: string,
  nodes: Record<string, GraphNode>,
) => {
  const node = nodes[pubkey]
  if (!node) {
    return truncatePubkey(pubkey, 8, 6)
  }

  return node.label?.trim() || truncatePubkey(pubkey, 8, 6)
}

const buildPathMessage = (
  path: string[] | null,
  visitedCount: number,
) => {
  if (!path) {
    return 'No hay camino descubierto entre estos nodos.'
  }

  const hopCount = Math.max(0, path.length - 1)
  const hopLabel = hopCount === 1 ? 'salto' : 'saltos'
  const visitedLabel = visitedCount === 1 ? 'nodo' : 'nodos'

  return `Camino descubierto de ${hopCount} ${hopLabel} tras visitar ${visitedCount} ${visitedLabel}.`
}

const getErrorMessage = (error: unknown) => {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'NODE_NOT_FOUND'
  ) {
    return 'Primero expandi ese nodo para incluirlo en el grafo descubierto.'
  }

  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message
  }

  return 'No se pudo calcular el camino ahora.'
}

const getDecodedPubkey = (
  input: string,
  fallbackPubkey: string | null,
): {
  result: ProfilePointerDecodeResult
  pubkey: string | null
} => {
  const result = decodeProfilePointer(input)
  if (result.status === 'valid') {
    return {
      result,
      pubkey: result.pubkey,
    }
  }

  return {
    result,
    pubkey: fallbackPubkey,
  }
}

const resolvePreviousLayer = (
  activeLayer: UiLayer,
  previousLayer: UiLayer | null,
) => {
  if (activeLayer !== 'pathfinding') {
    return activeLayer
  }

  if (previousLayer && previousLayer !== 'pathfinding') {
    return previousLayer
  }

  return 'graph'
}

export function PathfindingPanel({ runtime }: PathfindingPanelProps) {
  const {
    pathfinding,
    openPanel,
    activeLayer,
    selectedNodePubkey,
    comparedNodePubkeys,
    rootLoadStatus,
    rootLoadMessage,
    nodeCount,
  } = useAppStore(useShallow(selectPathfindingContext))
  const nodes = useAppStore((state) => state.nodes)
  const setOpenPanel = useAppStore((state) => state.setOpenPanel)
  const setActiveLayer = useAppStore((state) => state.setActiveLayer)
  const setSelectedNodePubkey = useAppStore((state) => state.setSelectedNodePubkey)
  const setPathfindingInput = useAppStore((state) => state.setPathfindingInput)
  const setPathfindingEndpoint = useAppStore((state) => state.setPathfindingEndpoint)
  const setPathfindingSelectionMode = useAppStore(
    (state) => state.setPathfindingSelectionMode,
  )
  const setPathfindingPending = useAppStore((state) => state.setPathfindingPending)
  const setPathfindingResult = useAppStore((state) => state.setPathfindingResult)
  const setPathfindingError = useAppStore((state) => state.setPathfindingError)
  const resetPathfinding = useAppStore((state) => state.resetPathfinding)

  const isOpen = openPanel === 'pathfinding'
  const comparedPair = useMemo(() => {
    if (comparedNodePubkeys.size !== 2) {
      return null
    }

    return Array.from(comparedNodePubkeys)
  }, [comparedNodePubkeys])
  const decodedSource = useMemo(
    () => getDecodedPubkey(pathfinding.sourceQuery, pathfinding.sourcePubkey),
    [pathfinding.sourcePubkey, pathfinding.sourceQuery],
  )
  const decodedTarget = useMemo(
    () => getDecodedPubkey(pathfinding.targetQuery, pathfinding.targetPubkey),
    [pathfinding.targetPubkey, pathfinding.targetQuery],
  )
  const sourcePubkey = decodedSource.pubkey
  const targetPubkey = decodedTarget.pubkey

  useEffect(() => {
    if (!isOpen && pathfinding.selectionMode !== 'idle') {
      setPathfindingSelectionMode('idle')
    }
  }, [isOpen, pathfinding.selectionMode, setPathfindingSelectionMode])

  if (!isOpen) {
    return null
  }

  const disabledReason =
    nodeCount === 0 || rootLoadStatus === 'idle'
      ? rootLoadMessage ?? 'Carga un vecindario descubierto antes de buscar caminos.'
      : !sourcePubkey || !targetPubkey
        ? 'Define origen y destino con pubkey, npub, nprofile o seleccion desde el canvas.'
        : sourcePubkey === targetPubkey
          ? 'El origen y el destino deben ser nodos distintos.'
          : null

  const effectiveStatus: EffectivePathfindingStatus =
    pathfinding.status === 'idle'
      ? disabledReason
        ? 'disabled'
        : 'ready'
      : pathfinding.status

  const statusTone =
    effectiveStatus === 'found'
      ? 'ok'
      : effectiveStatus === 'not-found'
        ? 'warn'
        : effectiveStatus === 'error'
          ? 'error'
          : 'neutral'

  const statusMessage =
    pathfinding.selectionMode === 'source'
      ? 'Haz click en un nodo del canvas para fijar el origen.'
      : pathfinding.selectionMode === 'target'
        ? 'Haz click en un nodo del canvas para fijar el destino.'
        : effectiveStatus === 'disabled'
          ? disabledReason
          : effectiveStatus === 'ready'
            ? 'Listo para buscar sobre el grafo mutuo descubierto.'
            : pathfinding.message

  const handleClose = () => {
    setPathfindingSelectionMode('idle')
    setOpenPanel('overview')
  }

  const handleReset = () => {
    const previousLayer = resolvePreviousLayer(activeLayer, pathfinding.previousLayer)
    if (activeLayer === 'pathfinding') {
      setActiveLayer(previousLayer)
    }
    resetPathfinding()
  }

  const handleUseSelectedNode = (role: 'source' | 'target') => {
    if (!selectedNodePubkey) {
      return
    }

    setSelectedNodePubkey(selectedNodePubkey)
    setPathfindingEndpoint(role, {
      pubkey: selectedNodePubkey,
      query: selectedNodePubkey,
    })
  }

  const handleUseComparedPair = () => {
    if (!comparedPair) {
      return
    }

    setPathfindingEndpoint('source', {
      pubkey: comparedPair[0],
      query: comparedPair[0],
    })
    setPathfindingEndpoint('target', {
      pubkey: comparedPair[1],
      query: comparedPair[1],
    })
  }

  const handlePickFromCanvas = (role: 'source' | 'target') => {
    setPathfindingSelectionMode(
      pathfinding.selectionMode === role ? 'idle' : role,
    )
  }

  const handleSearch = async () => {
    if (!sourcePubkey || !targetPubkey || sourcePubkey === targetPubkey) {
      return
    }

    setPathfindingEndpoint('source', {
      pubkey: sourcePubkey,
      query: decodedSource.result.status === 'valid' ? decodedSource.result.input : sourcePubkey,
    })
    setPathfindingEndpoint('target', {
      pubkey: targetPubkey,
      query: decodedTarget.result.status === 'valid' ? decodedTarget.result.input : targetPubkey,
    })

    if (!nodes[sourcePubkey] || !nodes[targetPubkey]) {
      const previousLayer = resolvePreviousLayer(
        activeLayer,
        pathfinding.previousLayer,
      )
      if (activeLayer === 'pathfinding') {
        setActiveLayer(previousLayer)
      }
      setPathfindingError(
        'Primero expandi ese nodo para incluirlo en el grafo descubierto.',
        {
          algorithm: 'bfs',
          previousLayer,
        },
      )
      return
    }

    const previousLayer = resolvePreviousLayer(
      activeLayer,
      pathfinding.previousLayer,
    )
    setPathfindingPending('bfs')

    try {
      const result = await runtime.findPath(sourcePubkey, targetPubkey, 'bfs')
      const nextMessage = buildPathMessage(result.path, result.visitedCount)

      setPathfindingResult({
        path: result.path,
        visitedCount: result.visitedCount,
        algorithm: result.algorithm,
        message: nextMessage,
        previousLayer,
      })

      if (result.path) {
        if (activeLayer !== 'pathfinding') {
          setActiveLayer('pathfinding')
        }
        return
      }

      if (activeLayer === 'pathfinding') {
        setActiveLayer(previousLayer)
      }
    } catch (error) {
      if (activeLayer === 'pathfinding') {
        setActiveLayer(previousLayer)
      }

      setPathfindingError(getErrorMessage(error), {
        algorithm: 'bfs',
        previousLayer,
      })
    }
  }

  return (
    <aside
      className="node-detail-panel pathfinding-panel"
      data-pathfinding-panel
      aria-label="Panel de pathfinding"
    >
      <div className="node-detail-panel__header">
        <div className="node-detail-panel__title-block">
          <p className="eyebrow node-detail-panel__eyebrow">Pathfinding</p>
          <h2>Camino entre identidades</h2>
          <p className="pathfinding-panel__copy">
            Busca el camino mas corto sobre el grafo mutuo ya descubierto.
          </p>
        </div>
        <button
          aria-label="Cerrar panel de pathfinding"
          className="node-detail-panel__close"
          onClick={handleClose}
          type="button"
        >
          X
        </button>
      </div>

      <div className="pathfinding-panel__section">
        <label className="npub-input__label" htmlFor="pathfinding-source-input">
          Origen
        </label>
        <input
          autoComplete="off"
          className="npub-input__field"
          id="pathfinding-source-input"
          inputMode="text"
          onChange={(event) => setPathfindingInput('source', event.target.value)}
          placeholder="pubkey hex, npub o nprofile"
          spellCheck={false}
          type="text"
          value={pathfinding.sourceQuery}
        />
        <div className="node-detail-panel__actions pathfinding-panel__actions">
          <button
            className={`node-detail-panel__secondary-action${
              pathfinding.selectionMode === 'source'
                ? ' pathfinding-panel__selection-btn--active'
                : ''
            }`}
            onClick={() => handlePickFromCanvas('source')}
            type="button"
          >
            Seleccionar en canvas
          </button>
          <button
            className="node-detail-panel__secondary-action"
            disabled={!selectedNodePubkey}
            onClick={() => handleUseSelectedNode('source')}
            type="button"
          >
            Usar nodo seleccionado
          </button>
        </div>
      </div>

      <div className="pathfinding-panel__section">
        <label className="npub-input__label" htmlFor="pathfinding-target-input">
          Destino
        </label>
        <input
          autoComplete="off"
          className="npub-input__field"
          id="pathfinding-target-input"
          inputMode="text"
          onChange={(event) => setPathfindingInput('target', event.target.value)}
          placeholder="pubkey hex, npub o nprofile"
          spellCheck={false}
          type="text"
          value={pathfinding.targetQuery}
        />
        <div className="node-detail-panel__actions pathfinding-panel__actions">
          <button
            className={`node-detail-panel__secondary-action${
              pathfinding.selectionMode === 'target'
                ? ' pathfinding-panel__selection-btn--active'
                : ''
            }`}
            onClick={() => handlePickFromCanvas('target')}
            type="button"
          >
            Seleccionar en canvas
          </button>
          <button
            className="node-detail-panel__secondary-action"
            disabled={!selectedNodePubkey}
            onClick={() => handleUseSelectedNode('target')}
            type="button"
          >
            Usar nodo seleccionado
          </button>
        </div>
      </div>

      {comparedPair ? (
        <div className="pathfinding-panel__compare">
          <p className="pathfinding-panel__compare-copy">
            Comparacion activa: {getNodeTitle(comparedPair[0], nodes)} y{' '}
            {getNodeTitle(comparedPair[1], nodes)}.
          </p>
          <button
            className="node-detail-panel__secondary-action"
            onClick={handleUseComparedPair}
            type="button"
          >
            Usar comparacion actual
          </button>
        </div>
      ) : null}

      <div
        className={`node-detail-panel__feedback node-detail-panel__feedback--${statusTone}`}
        role={effectiveStatus === 'error' ? 'alert' : 'status'}
        aria-live="polite"
      >
        <p>{statusMessage}</p>
      </div>

      <div className="node-detail-panel__actions">
        <button
          className="node-detail-panel__primary-action"
          disabled={effectiveStatus === 'disabled' || effectiveStatus === 'computing'}
          onClick={() => void handleSearch()}
          type="button"
        >
          {effectiveStatus === 'computing' ? 'Buscando...' : 'Buscar camino'}
        </button>
        <button
          className="node-detail-panel__secondary-action"
          onClick={handleReset}
          type="button"
        >
          Limpiar
        </button>
      </div>

      {pathfinding.status === 'found' && pathfinding.path ? (
        <div className="pathfinding-panel__result">
          <div className="pathfinding-panel__metrics">
            <div>
              <p className="node-detail-panel__metric-label">Algoritmo</p>
              <p className="node-detail-panel__metric-value">{pathfinding.algorithm}</p>
            </div>
            <div>
              <p className="node-detail-panel__metric-label">Visitados</p>
              <p className="node-detail-panel__metric-value">{pathfinding.visitedCount}</p>
            </div>
            <div>
              <p className="node-detail-panel__metric-label">Saltos</p>
              <p className="node-detail-panel__metric-value">
                {Math.max(0, pathfinding.path.length - 1)}
              </p>
            </div>
          </div>
          <ol className="pathfinding-panel__path-list">
            {pathfinding.path.map((pubkey, index) => (
              <li className="pathfinding-panel__path-step" key={`${pubkey}-${index}`}>
                <span className="pathfinding-panel__path-index">{index + 1}</span>
                <div>
                  <p className="pathfinding-panel__path-title">
                    {getNodeTitle(pubkey, nodes)}
                  </p>
                  <code className="pathfinding-panel__path-pubkey">
                    {truncatePubkey(pubkey, 12, 10)}
                  </code>
                </div>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </aside>
  )
}
