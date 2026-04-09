/* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps, @next/next/no-img-element */

import { nip19 } from 'nostr-tools'
import { useEffect, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'

import AvatarFallback from '@/components/AvatarFallback'
import { selectNodeDetailContext, useAppStore } from '@/features/graph/app/store'
import type { GraphNode, GraphNodeProfile } from '@/features/graph/app/store/types'
import type { ExpandNodeResult, RootLoader } from '@/features/graph/kernel'
import {
  getAvatarMonogram,
  isSafeAvatarUrl,
  truncatePubkey,
  type ImageRuntime,
} from '@/features/graph/render'

interface NodeDetailPanelProps {
  imageRuntime?: ImageRuntime | null
  runtime: RootLoader
}

type PanelStatus = 'loading' | 'populated' | 'stale'
type ExpandFeedbackTone = 'neutral' | 'ok' | 'warn' | 'error'

interface ExpandFeedback {
  tone: ExpandFeedbackTone
  message: string
}

const buildNodeProfileSnapshot = (
  node: GraphNode | null,
): GraphNodeProfile | null => {
  if (!node || node.profileState === 'missing') {
    return null
  }

  return {
    eventId: node.profileEventId ?? '',
    fetchedAt: node.profileFetchedAt ?? 0,
    name: node.label ?? null,
    about: node.about ?? null,
    picture: node.picture ?? null,
    nip05: node.nip05 ?? null,
    lud16: node.lud16 ?? null,
  }
}

const buildProfileSignature = (profile: GraphNodeProfile | null) => {
  if (!profile) {
    return 'missing'
  }

  return [
    profile.eventId,
    profile.fetchedAt,
    profile.name ?? '',
    profile.about ?? '',
    profile.picture ?? '',
    profile.nip05 ?? '',
    profile.lud16 ?? '',
  ].join('|')
}

const buildExpandFeedback = (result: ExpandNodeResult): ExpandFeedback => {
  switch (result.status) {
    case 'ready':
      return {
        tone: 'ok',
        message: result.message,
      }
    case 'partial':
      return {
        tone: 'warn',
        message: result.message,
      }
    case 'empty':
      return {
        tone: 'warn',
        message: result.message,
      }
    case 'error':
      return {
        tone: 'error',
        message: result.message,
      }
  }
}

export function NodeDetailPanel({
  imageRuntime = null,
  runtime,
}: NodeDetailPanelProps) {
  const {
    selectedNodePubkey,
    selectedNode,
    openPanel,
    rootNodePubkey,
    graphCapReached,
    graphMaxNodes,
    followsDiscovered,
    followersDiscovered,
    mutualsDiscovered,
    hasLoadedFollowsDiscovered,
    isExpanded,
    selectedDeepUserCount,
    maxSelectedDeepUsers,
    slotsRemaining,
    isDeepSelectionLocked,
    isSelectedForDeepCapture,
    nodeExpansionState,
    nodeStructurePreviewState,
  } = useAppStore(useShallow(selectNodeDetailContext))
  const toggleDeepUserSelection = useAppStore(
    (state) => state.toggleDeepUserSelection,
  )
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)
  const selectedProfileSnapshot = buildNodeProfileSnapshot(selectedNode)
  const selectedProfileSignature = buildProfileSignature(selectedProfileSnapshot)
  const initialStatus: PanelStatus =
    selectedNode?.profileState === 'loading' || selectedNode?.profileState === undefined
      ? 'loading'
      : 'populated'
  const [snapshot, setSnapshot] = useState<GraphNodeProfile | null | undefined>(
    initialStatus === 'loading' ? undefined : selectedProfileSnapshot,
  )
  const [status, setStatus] = useState<PanelStatus>(initialStatus)
  const loadedPubkeyRef = useRef<string | null>(null)
  const loadedSignatureRef = useRef<string | null>(null)
  const copyResetTimerRef = useRef<number | null>(null)
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle')
  const [expandFeedback, setExpandFeedback] = useState<ExpandFeedback | null>(null)
  const [selectionFeedback, setSelectionFeedback] = useState<ExpandFeedback | null>(
    null,
  )
  
  const [avatarImageFailed, setAvatarImageFailed] = useState(false)
  const [detailAvatarSrc, setDetailAvatarSrc] = useState<string | null>(null)
  
  const isOpen = openPanel === 'node-detail' && Boolean(selectedNodePubkey)
  const displayProfile = snapshot !== undefined ? snapshot : selectedProfileSnapshot
  const displayPicture = displayProfile?.picture ?? selectedNode?.picture ?? null
  const displayName =
    selectedNode?.profileState === 'missing'
      ? truncatePubkey(selectedNodePubkey ?? '', 8, 6)
      : displayProfile?.name?.trim() ||
        selectedNode?.label?.trim() ||
        truncatePubkey(selectedNodePubkey ?? '', 8, 6)
  const npub = selectedNodePubkey ? nip19.npubEncode(selectedNodePubkey) : null
  const isMissingProfile = selectedNode?.profileState === 'missing' || displayProfile === null
  const isStructurallyExpanding =
    nodeExpansionState?.status === 'loading'
  const canExpand = Boolean(
    selectedNode && !isExpanded && !graphCapReached && !isStructurallyExpanding,
  )
  const isRootDeepCaptureEntry =
    selectedNodePubkey !== null && selectedNodePubkey === rootNodePubkey
  const isStructurePreviewEligible =
    Boolean(selectedNodePubkey) &&
    selectedNodePubkey !== rootNodePubkey &&
    !isExpanded
  const expandLabel = isStructurallyExpanding
    ? 'Expandiendo...'
    : isExpanded
    ? 'Expandido'
    : graphCapReached
      ? 'Cap alcanzado'
      : 'Expandir'

  const hasAvatarImage = isSafeAvatarUrl(displayPicture) && !avatarImageFailed
  const resolvedAvatarSrc = hasAvatarImage ? detailAvatarSrc : null
  const deepCaptureButtonLabel = isRootDeepCaptureEntry
    ? 'Root incluido'
    : isDeepSelectionLocked
      ? 'Seleccion bloqueada por job'
      : isSelectedForDeepCapture
        ? 'Quitar de captura profunda'
        : slotsRemaining === 0
          ? 'Maximo alcanzado'
          : 'Marcar para captura profunda'
  const canToggleDeepCapture =
    !isRootDeepCaptureEntry &&
    !isDeepSelectionLocked &&
    (isSelectedForDeepCapture || slotsRemaining > 0)

  useEffect(() => {
    if (!isOpen) {
      if (copyResetTimerRef.current !== null) {
        window.clearTimeout(copyResetTimerRef.current)
        copyResetTimerRef.current = null
      }

      loadedPubkeyRef.current = null
      loadedSignatureRef.current = null
      setStatus('loading')
      setCopyState('idle')
      setExpandFeedback(null)
      setSelectionFeedback(null)
      setDetailAvatarSrc(null)
      return
    }

    setAvatarImageFailed(false)

    if (!selectedNodePubkey || !selectedNode) {
      return
    }

    const currentSnapshot = selectedProfileSnapshot
    const currentSignature = selectedProfileSignature
    const isNewSelection = loadedPubkeyRef.current !== selectedNodePubkey
    loadedPubkeyRef.current = selectedNodePubkey

    if (isNewSelection) {
      setExpandFeedback(null)
      setSelectionFeedback(null)
    }

    if (selectedNode.profileState === 'loading' || selectedNode.profileState === undefined) {
      loadedSignatureRef.current = null
      setStatus('loading')
      let cancelled = false

      void runtime.getNodeDetail(selectedNodePubkey).then((profile) => {
        if (cancelled) {
          return
        }

        const nextSnapshot = profile ?? null
        setSnapshot(nextSnapshot)
        loadedSignatureRef.current = buildProfileSignature(nextSnapshot)
        setStatus('populated')
      })

      return () => {
        cancelled = true
      }
    }

    if (isNewSelection || loadedSignatureRef.current === null) {
      loadedSignatureRef.current = currentSignature
      setSnapshot(currentSnapshot)
      setStatus('populated')
      return
    }

    if (loadedSignatureRef.current !== currentSignature) {
      setStatus('stale')
      const timer = window.setTimeout(() => {
        loadedSignatureRef.current = currentSignature
        setSnapshot(currentSnapshot)
        setStatus('populated')
      }, 120)

      return () => window.clearTimeout(timer)
    }

    loadedSignatureRef.current = currentSignature
    setSnapshot(currentSnapshot)
    setStatus('populated')
  }, [
    isOpen,
    runtime,
    selectedNode?.profileState,
    selectedNodePubkey,
    selectedProfileSignature,
  ])

  useEffect(() => {
    return () => {
      if (copyResetTimerRef.current !== null) {
        window.clearTimeout(copyResetTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!hasAvatarImage || !displayPicture || imageRuntime === null) {
      setDetailAvatarSrc(null)
      return
    }

    let cancelled = false
    setDetailAvatarSrc(null)

    void imageRuntime
      .requestDetail({
        sourceUrl: displayPicture,
        targetPx: 256,
      })
      .then((handle) => {
        if (cancelled) {
          return
        }

        setDetailAvatarSrc(handle?.url ?? null)
      })
      .catch(() => {
        if (!cancelled) {
          setDetailAvatarSrc(null)
        }
      })

    return () => {
      cancelled = true
    }
  }, [displayPicture, hasAvatarImage, imageRuntime])

  useEffect(() => {
    if (isOpen) {
      closeButtonRef.current?.focus()
    }
  }, [isOpen, selectedNodePubkey])

  const handleCopyNpub = async () => {
    if (!npub || !navigator.clipboard?.writeText) {
      return
    }

    await navigator.clipboard.writeText(npub)
    setCopyState('copied')

    if (copyResetTimerRef.current !== null) {
      window.clearTimeout(copyResetTimerRef.current)
    }

    copyResetTimerRef.current = window.setTimeout(() => {
      setCopyState('idle')
      copyResetTimerRef.current = null
    }, 1400)
  }

  const handleExpand = async () => {
    if (!selectedNodePubkey || !canExpand) {
      return
    }

    setExpandFeedback(null)
    try {
      const result = await runtime.expandNode(selectedNodePubkey)
      setExpandFeedback(buildExpandFeedback(result))
    } catch (error) {
      setExpandFeedback({
        tone: 'error',
        message:
          error instanceof Error && error.message.trim().length > 0
            ? error.message
            : 'No se pudo expandir este nodo.',
      })
    }
  }

  const handleToggleDeepCapture = () => {
    if (!selectedNodePubkey) {
      return
    }

    if (isRootDeepCaptureEntry) {
      setSelectionFeedback({
        tone: 'neutral',
        message: 'El root siempre se incluye en la captura profunda.',
      })
      return
    }

    const shouldSelect = !isSelectedForDeepCapture
    const result = toggleDeepUserSelection(selectedNodePubkey, shouldSelect)

    if (result.reason === 'job-active') {
      setSelectionFeedback({
        tone: 'warn',
        message:
          'La seleccion esta bloqueada mientras el job de captura profunda sigue corriendo.',
      })
      return
    }

    if (result.reason === 'max-selected') {
      setSelectionFeedback({
        tone: 'warn',
        message: 'Ya marcaste 4 extras. Quita uno para liberar un slot.',
      })
      return
    }

    if (result.reason === 'root-required') {
      setSelectionFeedback({
        tone: 'neutral',
        message: 'El root siempre se incluye en la captura profunda.',
      })
      return
    }

    setSelectionFeedback({
      tone: shouldSelect ? 'ok' : 'neutral',
      message: shouldSelect
        ? `Usuario marcado. Quedan ${result.slotsRemaining} slots extra.`
        : `Usuario removido. Quedan ${result.slotsRemaining} slots extra.`,
    })
  }

  if (!isOpen || !selectedNodePubkey || !selectedNode) {
    return null
  }

  return (
    <aside
      aria-labelledby="node-detail-title"
      aria-live="polite"
      className="node-detail-panel"
      data-node-detail-panel
    >
      <div className="node-detail-panel__header">
        <div className="node-detail-panel__title-block">
          <p className="eyebrow node-detail-panel__eyebrow">Detalle de nodo</p>
          <h2 id="node-detail-title">{displayName}</h2>
          <div className="node-detail-panel__badges">
            <span className="node-detail-panel__badge">
              {selectedNode.source}
            </span>
            {selectedNode.profileState === 'loading' ? (
              <span className="node-detail-panel__badge node-detail-panel__badge--pending">
                Cargando detalle
              </span>
            ) : null}
            {status === 'stale' ? (
              <span className="node-detail-panel__badge node-detail-panel__badge--warn">
                Datos nuevos
              </span>
            ) : null}
            {isExpanded ? (
              <span className="node-detail-panel__badge node-detail-panel__badge--ok">
                Expandido
              </span>
            ) : null}
          </div>
        </div>

        <button
          ref={closeButtonRef}
          className="node-detail-panel__close"
          onClick={() => runtime.selectNode(null)}
          type="button"
        >
          Cerrar
        </button>
      </div>

      <div className="node-detail-panel__hero">
        <div className="node-detail-panel__avatar" aria-hidden="true">
          {resolvedAvatarSrc ? (
            <img
              alt=""
              className="node-detail-panel__avatar-image"
              decoding="async"
              height={72}
              onError={() => setAvatarImageFailed(true)}
              loading="lazy"
              referrerPolicy="no-referrer"
              src={resolvedAvatarSrc ?? undefined}
              width={72}
            />
          ) : (
            <AvatarFallback
              initials={getAvatarMonogram(displayName)}
              labelClassName="text-[1.1rem] tracking-[0.08em]"
            />
          )}
        </div>

        <div className="node-detail-panel__hero-copy">
          <p className="node-detail-panel__pubkey-label">pubkey</p>
          <code className="node-detail-panel__pubkey">{selectedNodePubkey}</code>

          <div className="node-detail-panel__npub-row">
            <div>
              <p className="node-detail-panel__metric-label">npub</p>
              <code className="node-detail-panel__npub">
                {npub ? truncatePubkey(npub, 12, 8) : 'n/a'}
              </code>
            </div>
            <button
              className="node-detail-panel__copy"
              onClick={() => void handleCopyNpub()}
              type="button"
            >
              {copyState === 'copied' ? 'Copiado' : 'Copiar'}
            </button>
          </div>
        </div>
      </div>

      {status === 'loading' ? (
        <div className="node-detail-panel__loading" aria-busy="true">
          <p className="node-detail-panel__loading-title">Cargando detalle...</p>
          <p className="node-detail-panel__loading-copy">
            Hidratando metadata local del nodo seleccionado.
          </p>
        </div>
      ) : null}

      {status !== 'loading' ? (
        <>
          <p className="node-detail-panel__about">
            {isMissingProfile
              ? 'Perfil no encontrado.'
              : displayProfile?.about?.trim() || 'Sin bio conocida.'}
          </p>

          {isStructurePreviewEligible &&
          nodeStructurePreviewState?.status === 'loading' &&
          nodeStructurePreviewState.message ? (
            <div className="node-detail-panel__feedback node-detail-panel__feedback--neutral">
              <p>{nodeStructurePreviewState.message}</p>
            </div>
          ) : isStructurePreviewEligible &&
            !hasLoadedFollowsDiscovered &&
            nodeStructurePreviewState?.status !== 'error' ? (
            <div className="node-detail-panel__feedback node-detail-panel__feedback--neutral">
              <p>
                Este nodo todavia no completo su carga estructural. Los follows
                descubiertos se cargan automaticamente al abrir el perfil.
                Expandir agrega ese vecindario al grafo.
              </p>
            </div>
          ) : isStructurePreviewEligible &&
            hasLoadedFollowsDiscovered &&
            nodeStructurePreviewState?.status === 'ready' ? (
            <div className="node-detail-panel__feedback node-detail-panel__feedback--neutral">
              <p>
                El conteo de follows ya se cargo para este panel. Expandir
                agrega ese vecindario al grafo.
              </p>
            </div>
          ) : isStructurePreviewEligible &&
            nodeStructurePreviewState?.status === 'partial' &&
            nodeStructurePreviewState.message ? (
            <div className="node-detail-panel__feedback node-detail-panel__feedback--warn">
              <p>{nodeStructurePreviewState.message}</p>
            </div>
          ) : isStructurePreviewEligible &&
            nodeStructurePreviewState?.status === 'empty' &&
            nodeStructurePreviewState.message ? (
            <div className="node-detail-panel__feedback node-detail-panel__feedback--warn">
              <p>{nodeStructurePreviewState.message}</p>
            </div>
          ) : isStructurePreviewEligible &&
            nodeStructurePreviewState?.status === 'error' &&
            nodeStructurePreviewState.message ? (
            <div className="node-detail-panel__feedback node-detail-panel__feedback--error">
              <p>{nodeStructurePreviewState.message}</p>
            </div>
          ) : null}

          <dl className="node-detail-panel__grid">
            <div>
              <dt>Follows descubiertos</dt>
              <dd>{hasLoadedFollowsDiscovered ? followsDiscovered : 'pendiente'}</dd>
            </div>
            <div>
              <dt>Followers descubiertos</dt>
              <dd>{followersDiscovered}</dd>
            </div>
            <div>
              <dt>Mutuals descubiertos</dt>
              <dd>{mutualsDiscovered}</dd>
            </div>
            <div>
              <dt>Cap</dt>
              <dd>
                {graphCapReached ? 'alcanzado' : `${graphMaxNodes} max`}
              </dd>
            </div>
          </dl>

          <div className="node-detail-panel__identity">
            <div>
              <p className="node-detail-panel__metric-label">nip05</p>
              <p className="node-detail-panel__metric-value">
                {displayProfile?.nip05?.trim() || 'n/a'}
              </p>
            </div>
            <div>
              <p className="node-detail-panel__metric-label">lud16</p>
              <p className="node-detail-panel__metric-value">
                {displayProfile?.lud16?.trim() || 'n/a'}
              </p>
            </div>
          </div>

          <div className="node-detail-panel__actions">
            {canExpand ? (
              <button
                className="node-detail-panel__primary-action"
                disabled={isStructurallyExpanding}
                onClick={() => void handleExpand()}
                type="button"
              >
                {isStructurallyExpanding ? 'Expandiendo...' : 'Expandir'}
              </button>
            ) : (
              <button
                className="node-detail-panel__secondary-action"
                disabled
                type="button"
              >
                {expandLabel}
              </button>
            )}

            <button
              className={
                isSelectedForDeepCapture && canToggleDeepCapture
                  ? 'node-detail-panel__secondary-action node-detail-panel__secondary-action--active'
                  : 'node-detail-panel__secondary-action'
              }
              disabled={!canToggleDeepCapture}
              onClick={handleToggleDeepCapture}
              type="button"
            >
              {deepCaptureButtonLabel}
            </button>
          </div>

          <div className="node-detail-panel__selection-caption">
            <span>
              Captura profunda: root + {selectedDeepUserCount} de{' '}
              {maxSelectedDeepUsers} extras
            </span>
            <span>{slotsRemaining} slots restantes</span>
          </div>

          {selectionFeedback ? (
            <div
              aria-live="polite"
              className={`node-detail-panel__feedback node-detail-panel__feedback--${selectionFeedback.tone}`}
              role={selectionFeedback.tone === 'error' ? 'alert' : 'status'}
            >
              <p>{selectionFeedback.message}</p>
            </div>
          ) : null}

          {isRootDeepCaptureEntry ? (
            <div
              aria-live="polite"
              className="node-detail-panel__feedback node-detail-panel__feedback--neutral"
              role="status"
            >
              <p>Este nodo es el root y no puede desmarcarse.</p>
            </div>
          ) : null}

          {isDeepSelectionLocked ? (
            <div
              aria-live="polite"
              className="node-detail-panel__feedback node-detail-panel__feedback--warn"
              role="status"
            >
              <p>
                La seleccion esta bloqueada hasta que termine el job de captura profunda.
              </p>
            </div>
          ) : null}

          {selectionFeedback === null &&
          !isDeepSelectionLocked &&
          !isRootDeepCaptureEntry &&
          !isSelectedForDeepCapture &&
          slotsRemaining === 0 ? (
            <div
              aria-live="polite"
              className="node-detail-panel__feedback node-detail-panel__feedback--warn"
              role="status"
            >
              <p>Ya alcanzaste el maximo de 4 extras.</p>
            </div>
          ) : null}

          {selectionFeedback === null &&
          !isDeepSelectionLocked &&
          !isRootDeepCaptureEntry &&
          isSelectedForDeepCapture ? (
            <div
              aria-live="polite"
              className="node-detail-panel__feedback node-detail-panel__feedback--ok"
              role="status"
            >
              <p>Este usuario ya forma parte de la captura profunda.</p>
            </div>
          ) : null}

          {expandFeedback ? (
            <div
              aria-live="polite"
              className={`node-detail-panel__feedback node-detail-panel__feedback--${expandFeedback.tone}`}
              role={expandFeedback.tone === 'error' ? 'alert' : 'status'}
            >
              <p>{expandFeedback.message}</p>
            </div>
          ) : nodeExpansionState?.status === 'loading' && nodeExpansionState.message ? (
            <div
              aria-live="polite"
              className="node-detail-panel__feedback node-detail-panel__feedback--neutral"
              role="status"
            >
              <p>{nodeExpansionState.message}</p>
            </div>
          ) : nodeExpansionState?.status === 'partial' && nodeExpansionState.message ? (
            <div
              aria-live="polite"
              className="node-detail-panel__feedback node-detail-panel__feedback--warn"
              role="status"
            >
              <p>{nodeExpansionState.message}</p>
            </div>
          ) : (nodeExpansionState?.status === 'empty' || nodeExpansionState?.status === 'error') &&
            nodeExpansionState.message ? (
            <div
              aria-live="polite"
              className={`node-detail-panel__feedback node-detail-panel__feedback--${
                nodeExpansionState.status === 'error' ? 'error' : 'warn'
              }`}
              role={nodeExpansionState.status === 'error' ? 'alert' : 'status'}
            >
              <p>{nodeExpansionState.message}</p>
            </div>
          ) : null}
        </>
      ) : null}
    </aside>
  )
}
