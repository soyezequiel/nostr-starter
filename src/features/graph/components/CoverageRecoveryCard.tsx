import type { CoverageRecoveryReason } from '@/features/graph/app/store'

interface CoverageRecoveryCardProps {
  reason: CoverageRecoveryReason
  relaySummary: {
    totalCount: number
    connectedCount: number
    degradedCount: number
    offlineCount: number
  }
  rootLoadMessage: string | null
  variant: 'empty' | 'overlay'
  onChangeRelays: () => void
  onTrySampleRoot: () => void
}

function buildRecoveryCopy(
  reason: CoverageRecoveryReason,
  relaySummary: CoverageRecoveryCardProps['relaySummary'],
) {
  switch (reason) {
    case 'browser-offline':
      return {
        title: 'La sesion parece estar sin red.',
        body: 'No pudimos confirmar cobertura desde este navegador. Puede ser un problema de red o de relays, no de la identidad que cargaste.',
        meta:
          relaySummary.totalCount > 0
            ? `${relaySummary.offlineCount}/${relaySummary.totalCount} relays marcados offline.`
            : 'No hay relays activos para esta sesion.',
      }
    case 'relays-unavailable':
      return {
        title: 'Los relays activos no estan dando cobertura.',
        body: 'Todos los relays configurados quedaron degradados u offline. El grafo puede verse incompleto aunque la identidad exista y tenga follows.',
        meta:
          relaySummary.totalCount > 0
            ? `${relaySummary.degradedCount + relaySummary.offlineCount}/${relaySummary.totalCount} relays sin cobertura util.`
            : 'No hay relays activos para esta sesion.',
      }
    case 'zero-follows':
      return {
        title: 'No aparecio evidencia suficiente para este root.',
        body: 'Puede ser un problema de cobertura parcial entre relays. Prueba otro set o carga una identidad de ejemplo con datos mas abundantes.',
        meta:
          relaySummary.totalCount > 0
            ? `${relaySummary.connectedCount}/${relaySummary.totalCount} relays conectados en esta carga.`
            : 'No hay relays activos para esta sesion.',
      }
  }
}

export function CoverageRecoveryCard({
  reason,
  relaySummary,
  rootLoadMessage,
  variant,
  onChangeRelays,
  onTrySampleRoot,
}: CoverageRecoveryCardProps) {
  const copy = buildRecoveryCopy(reason, relaySummary)

  return (
    <section
      aria-live="polite"
      className={`coverage-recovery-card coverage-recovery-card--${variant}`}
    >
      <p className="coverage-recovery-card__eyebrow">Coverage recovery</p>
      <h3 className="coverage-recovery-card__title">{copy.title}</h3>
      <p className="coverage-recovery-card__body">{copy.body}</p>
      <p className="coverage-recovery-card__meta">{copy.meta}</p>
      {rootLoadMessage ? (
        <p className="coverage-recovery-card__detail">{rootLoadMessage}</p>
      ) : null}
      <div className="coverage-recovery-card__actions">
        <button
          className="coverage-recovery-card__action coverage-recovery-card__action--primary"
          onClick={onChangeRelays}
          type="button"
        >
          Cambiar relays
        </button>
        <button
          className="coverage-recovery-card__action coverage-recovery-card__action--secondary"
          onClick={onTrySampleRoot}
          type="button"
        >
          Probar con una pubkey de ejemplo
        </button>
      </div>
    </section>
  )
}
