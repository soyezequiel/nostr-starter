import { useEffect, useState } from 'react'

import { appStore, useAppStore } from '@/features/graph/app/store'
import type { RootLoader } from '@/features/graph/kernel'

interface RelayConfigPanelProps {
  rootLoader: RootLoader
  mode?: 'standalone' | 'embedded'
}

function parseRelayDraft(value: string): string[] {
  return value
    .split(/[\s,]+/)
    .map((relayUrl) => relayUrl.trim())
    .filter(Boolean)
}

export function RelayConfigPanel({
  rootLoader,
  mode = 'standalone',
}: RelayConfigPanelProps) {
  const relayUrls = useAppStore((state) => state.relayUrls)
  const relayOverrideStatus = useAppStore((state) => state.relayOverrideStatus)
  const isGraphStale = useAppStore((state) => state.isGraphStale)
  const openPanel = useAppStore((state) => state.openPanel)
  const setOpenPanel = useAppStore((state) => state.setOpenPanel)
  const setRelayOverrideStatus = useAppStore(
    (state) => state.setRelayOverrideStatus,
  )
  const [draftValue, setDraftValue] = useState(relayUrls.join('\n'))
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null)
  const [diagnostics, setDiagnostics] = useState<string[]>([])

  const isEmbedded = mode === 'embedded'
  const isOpen = isEmbedded || openPanel === 'relay-config'

  useEffect(() => {
    setDraftValue(relayUrls.join('\n'))
  }, [relayUrls])
  const resetDraftValue = () => {
    setDraftValue(appStore.getState().relayUrls.join('\n'))
  }

  const markEditing = () => {
    if (
      relayOverrideStatus !== 'validating' &&
      relayOverrideStatus !== 'applying'
    ) {
      setRelayOverrideStatus('editing')
    }
  }

  const togglePanel = () => {
    if (isOpen) {
      setOpenPanel('overview')
      return
    }

    markEditing()
    resetDraftValue()
    setOpenPanel('relay-config')
  }

  const applyDraft = async () => {
    const result = await rootLoader.reconfigureRelays({
      relayUrls: parseRelayDraft(draftValue),
    })
    resetDraftValue()
    setFeedbackMessage(result.message)
    setDiagnostics(result.diagnostics)
  }

  const restoreDefaults = async () => {
    const result = await rootLoader.reconfigureRelays({ restoreDefault: true })
    resetDraftValue()
    setFeedbackMessage(result.message)
    setDiagnostics(result.diagnostics)
  }

  const revertOverride = async () => {
    const result = await rootLoader.revertRelayOverride()
    resetDraftValue()
    setFeedbackMessage(result?.message ?? 'No hay un override pendiente para revertir.')
    setDiagnostics(result?.diagnostics ?? [])
  }

  return (
    <section
      aria-live="polite"
      className={`relay-config-panel${isEmbedded ? ' relay-config-panel--embedded' : ' root-panel'}`}
    >
      <div className="relay-config-panel__header">
        <div>
          <h2>{isEmbedded ? 'Relays de la sesion' : 'Configuracion de relays'}</h2>
          <p className="relay-config-panel__meta">
            Estado {relayOverrideStatus}, grafo {isGraphStale ? 'stale' : 'vigente'}
          </p>
        </div>
        {!isEmbedded ? (
          <button
            className="relay-config-panel__toggle"
            onClick={togglePanel}
            type="button"
          >
            {isOpen ? 'Cerrar panel' : 'Cambiar relays'}
          </button>
        ) : null}
      </div>

      {isOpen ? (
        <div className="relay-config-panel__body">
          <label className="npub-input__label" htmlFor="relay-config-input">
            Relays de la sesion
          </label>
          <textarea
            className="relay-config-panel__textarea"
            id="relay-config-input"
            onChange={(event) => {
              markEditing()
              setDraftValue(event.target.value)
            }}
            rows={5}
            value={draftValue}
          />

          <div className="relay-config-panel__actions">
            <button onClick={() => void applyDraft()} type="button">
              Aplicar override
            </button>
            <button onClick={() => void restoreDefaults()} type="button">
              Restaurar default
            </button>
            <button
              disabled={relayOverrideStatus !== 'revertible'}
              onClick={() => void revertOverride()}
              type="button"
            >
              Revertir
            </button>
          </div>

          {feedbackMessage ? (
            <p className="relay-config-panel__feedback">{feedbackMessage}</p>
          ) : null}

          {diagnostics.length > 0 ? (
            <ul className="relay-config-panel__diagnostics">
              {diagnostics.map((diagnostic) => (
                <li key={diagnostic}>{diagnostic}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : !isEmbedded ? (
        <p className="relay-config-panel__feedback">
          Mantiene el grafo visible mientras pruebas otro set y deja el override revertible si no mejora.
        </p>
      ) : null}
    </section>
  )
}
