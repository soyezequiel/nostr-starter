import { useShallow } from 'zustand/react/shallow'

import { selectRelayHealthData, useAppStore } from '@/features/graph/app/store'
import type { RelayHealthStatus } from '@/features/graph/app/store/types'

const STATUS_LABEL: Record<RelayHealthStatus, string> = {
  connected: 'conectado',
  partial: 'salud mixta',
  degraded: 'degradado',
  offline: 'offline',
  unknown: 'desconocido',
}

const STATUS_COLOR: Record<RelayHealthStatus, string> = {
  connected: '#8cf2c4',
  partial: '#e3b56c',
  degraded: '#d47c5f',
  offline: '#f06a67',
  unknown: '#767676',
}

interface RelayHealthIndicatorProps {
  mode?: 'full' | 'summary'
}

export function RelayHealthIndicator({
  mode = 'full',
}: RelayHealthIndicatorProps) {
  const { relayUrls, relayHealth } = useAppStore(
    useShallow(selectRelayHealthData),
  )
  const setOpenPanel = useAppStore((state) => state.setOpenPanel)

  const relays = relayUrls.map((url) => ({
    url,
    health: relayHealth[url] ?? {
      status: 'unknown' as const,
      lastCheckedAt: null,
      lastNotice: null,
    },
  }))
  const connectedCount = relays.filter(
    (relay) => relay.health.status === 'connected',
  ).length
  const totalCount = relays.length
  const allOffline =
    totalCount > 0 && relays.every((relay) => relay.health.status === 'offline')
  const allConnected = totalCount > 0 && connectedCount === totalCount
  const allDegraded =
    totalCount > 0 &&
    relays.every(
      (relay) =>
        relay.health.status === 'degraded' ||
        relay.health.status === 'offline',
    )

  const globalSummary = allOffline
    ? 'Todos offline'
    : allDegraded
      ? 'Todos degradados'
      : allConnected
        ? 'Todos conectados'
        : `${connectedCount}/${totalCount} relays conectados`

  if (mode === 'summary') {
    const summaryStatus: RelayHealthStatus =
      totalCount === 0
        ? 'unknown'
        : allOffline
          ? 'offline'
          : allConnected
            ? 'connected'
            : allDegraded
              ? 'degraded'
              : 'partial'

    return (
      <button
        aria-label="Abrir configuracion de relays"
        className="relay-health relay-health--summary"
        onClick={() => setOpenPanel('relay-config')}
        type="button"
      >
        <span
          aria-hidden="true"
          className="relay-health__dot"
          style={{ backgroundColor: STATUS_COLOR[summaryStatus] }}
        />
        <span className="relay-health__summary-value">{globalSummary}</span>
        <span className="relay-health__summary-copy">
          {totalCount === 0 ? 'Sin relays configurados' : 'Abrir relays'}
        </span>
      </button>
    )
  }

  if (totalCount === 0) {
    return (
      <section aria-live="polite" className="relay-health">
        <h2>Salud de relays</h2>
        <p className="relay-health__empty">No hay relays configurados.</p>
      </section>
    )
  }

  return (
    <section
      aria-label="Salud de relays"
      aria-live="polite"
      className="relay-health"
    >
      <h2>Salud de relays</h2>

      <p aria-atomic="true" className="relay-health__summary">
        {globalSummary}
      </p>

      <ul className="relay-health__list" role="list">
        {relays.map(({ url, health }) => (
          <li key={url} className="relay-health__item">
            <span
              aria-hidden="true"
              className="relay-health__dot"
              style={{ backgroundColor: STATUS_COLOR[health.status] }}
            />
            <span className="relay-health__url">{url}</span>
            <span className="relay-health__status">
              {STATUS_LABEL[health.status]}
            </span>
          </li>
        ))}
      </ul>

      {allOffline ? (
        <p className="relay-health__cta" role="alert">
          Todos los relays estan offline.{' '}
          <button
            className="relay-health__cta-btn"
            onClick={() => setOpenPanel('relay-config')}
            type="button"
          >
            Cambiar relays
          </button>
        </p>
      ) : null}
    </section>
  )
}
