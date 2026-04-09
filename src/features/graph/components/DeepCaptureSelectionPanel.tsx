import { useMemo, useState } from 'react'

import { useAppStore } from '@/features/graph/app/store'
import type { GraphNode } from '@/features/graph/app/store/types'
import { truncatePubkey } from '@/features/graph/render'

type SelectionFeedbackTone = 'neutral' | 'ok' | 'warn'

interface SelectionFeedback {
  tone: SelectionFeedbackTone
  message: string
}

const getNodeLabel = (node: GraphNode | null, pubkey: string) =>
  node?.label?.trim() || truncatePubkey(pubkey, 10, 8)

const getSelectionStateLabel = (
  selectionState: 'empty' | 'partial' | 'max' | 'locked',
) => {
  switch (selectionState) {
    case 'empty':
      return 'Seleccion vacia'
    case 'partial':
      return 'Seleccion parcial'
    case 'max':
      return 'Maximo alcanzado'
    case 'locked':
      return 'Bloqueada por job'
  }
}

const getSelectionStateCopy = (
  selectionState: 'empty' | 'partial' | 'max' | 'locked',
) => {
  switch (selectionState) {
    case 'empty':
      return 'Marca hasta 4 extras desde el detalle del nodo o desde este panel.'
    case 'partial':
      return 'La captura profunda ya tiene extras explicitamente marcados.'
    case 'max':
      return 'El budget extra esta completo. Quita un usuario para liberar un slot.'
    case 'locked':
      return 'Hay un job activo. Los cambios quedan bloqueados hasta que termine.'
  }
}

export function DeepCaptureSelectionPanel() {
  const rootNodePubkey = useAppStore((state) => state.rootNodePubkey)
  const nodes = useAppStore((state) => state.nodes)
  const selectedDeepUserPubkeys = useAppStore(
    (state) => state.selectedDeepUserPubkeys,
  )
  const maxSelectedDeepUsers = useAppStore(
    (state) => state.maxSelectedDeepUsers,
  )
  const exportJobPhase = useAppStore((state) => state.exportJob.phase)
  const selectedNodePubkey = useAppStore((state) => state.selectedNodePubkey)
  const toggleDeepUserSelection = useAppStore(
    (state) => state.toggleDeepUserSelection,
  )
  const [feedback, setFeedback] = useState<SelectionFeedback | null>(null)
  const rootNode = rootNodePubkey ? nodes[rootNodePubkey] ?? null : null
  const selectedDeepUserCount = selectedDeepUserPubkeys.length
  const slotsRemaining = Math.max(
    0,
    maxSelectedDeepUsers - selectedDeepUserCount,
  )
  const isSelectionLocked = !['idle', 'completed', 'failed'].includes(
    exportJobPhase,
  )
  const selectionState = isSelectionLocked
    ? ('locked' as const)
    : selectedDeepUserCount === 0
      ? ('empty' as const)
      : selectedDeepUserCount >= maxSelectedDeepUsers
        ? ('max' as const)
        : ('partial' as const)
  const currentNodePubkey =
    selectedNodePubkey && nodes[selectedNodePubkey] ? selectedNodePubkey : null
  const currentNode = currentNodePubkey ? nodes[currentNodePubkey] ?? null : null
  const currentNodeIsRoot = currentNodePubkey === rootNodePubkey
  const currentNodeIsSelected =
    currentNodePubkey !== null &&
    selectedDeepUserPubkeys.includes(currentNodePubkey)
  const selectedDeepUserNodes = useMemo(
    () =>
      selectedDeepUserPubkeys.map((pubkey) => ({
        pubkey,
        node: nodes[pubkey] ?? null,
      })),
    [nodes, selectedDeepUserPubkeys],
  )

  if (!rootNodePubkey) {
    return null
  }

  const handleToggle = (pubkey: string, shouldSelect: boolean) => {
    const result = toggleDeepUserSelection(pubkey, shouldSelect)

    if (result.reason === 'job-active') {
      setFeedback({
        tone: 'warn',
        message:
          'La seleccion esta bloqueada mientras el job de captura profunda sigue corriendo.',
      })
      return
    }

    if (result.reason === 'max-selected') {
      setFeedback({
        tone: 'warn',
        message: 'Ya marcaste 4 extras. Quita uno para liberar un slot.',
      })
      return
    }

    if (result.reason === 'root-required') {
      setFeedback({
        tone: 'neutral',
        message: 'El root siempre se incluye en la captura profunda.',
      })
      return
    }

    setFeedback({
      tone: shouldSelect ? 'ok' : 'neutral',
      message: shouldSelect
        ? `Usuario agregado. Quedan ${result.slotsRemaining} slots extra.`
        : `Usuario removido. Quedan ${result.slotsRemaining} slots extra.`,
    })
  }

  const currentNodeActionLabel = currentNodeIsRoot
    ? 'Nodo abierto = root'
    : currentNodeIsSelected
      ? 'Quitar nodo abierto'
      : slotsRemaining === 0
        ? 'Maximo alcanzado'
        : 'Agregar nodo abierto'

  return (
    <section className="settings-card settings-card--selection">
      <div className="settings-card__title-row">
        <div>
          <h3>Seleccion explicita</h3>
          <p className="settings-panel__fineprint">
            {getSelectionStateCopy(selectionState)}
          </p>
        </div>
        <span
          className={`deep-selection-state deep-selection-state--${selectionState}`}
        >
          {getSelectionStateLabel(selectionState)}
        </span>
      </div>

      <dl className="settings-metrics-list">
        <div>
          <dt>Contador</dt>
          <dd>
            root + {selectedDeepUserCount} de {maxSelectedDeepUsers} extras
          </dd>
        </div>
        <div>
          <dt>Budget activo</dt>
          <dd>1 root fijo + {maxSelectedDeepUsers} extras</dd>
        </div>
        <div>
          <dt>Slots restantes</dt>
          <dd>{slotsRemaining}</dd>
        </div>
      </dl>

      <div className="deep-selection-focus">
        <div>
          <p className="deep-selection-focus__label">Nodo abierto</p>
          <p className="deep-selection-focus__value">
            {currentNodePubkey
              ? getNodeLabel(currentNode, currentNodePubkey)
              : 'Selecciona un nodo en el canvas para marcarlo desde aqui.'}
          </p>
        </div>
        <button
          className="settings-secondary-btn"
          disabled={
            currentNodePubkey === null ||
            currentNodeIsRoot ||
            isSelectionLocked ||
            (!currentNodeIsSelected && slotsRemaining === 0)
          }
          onClick={() => {
            if (!currentNodePubkey || currentNodeIsRoot) {
              return
            }

            handleToggle(currentNodePubkey, !currentNodeIsSelected)
          }}
          type="button"
        >
          {currentNodeActionLabel}
        </button>
      </div>

      <div className="deep-selection-list" role="list">
        <article className="deep-selection-row" role="listitem">
          <div className="deep-selection-row__copy">
            <div className="deep-selection-row__headline">
              <strong>{getNodeLabel(rootNode, rootNodePubkey)}</strong>
              <span className="deep-selection-row__badge deep-selection-row__badge--root">
                Root fijo
              </span>
            </div>
            <code>{truncatePubkey(rootNodePubkey, 12, 10)}</code>
          </div>
          <button className="settings-secondary-btn" disabled type="button">
            Incluido
          </button>
        </article>

        {selectedDeepUserNodes.length === 0 ? (
          <p className="deep-selection-empty">
            Todavia no marcaste extras para la captura profunda.
          </p>
        ) : (
          selectedDeepUserNodes.map(({ pubkey, node }) => (
            <article className="deep-selection-row" key={pubkey} role="listitem">
              <div className="deep-selection-row__copy">
                <div className="deep-selection-row__headline">
                  <strong>{getNodeLabel(node, pubkey)}</strong>
                  <span className="deep-selection-row__badge">Extra</span>
                </div>
                <code>{truncatePubkey(pubkey, 12, 10)}</code>
              </div>
              <button
                className="settings-secondary-btn"
                disabled={isSelectionLocked}
                onClick={() => handleToggle(pubkey, false)}
                type="button"
              >
                Quitar
              </button>
            </article>
          ))
        )}
      </div>

      {feedback ? (
        <div
          className={`node-detail-panel__feedback node-detail-panel__feedback--${feedback.tone}`}
          role="status"
        >
          <p>{feedback.message}</p>
        </div>
      ) : null}
    </section>
  )
}
