'use client'

import { useCallback, useEffect, useState } from 'react'

import { clearSiteCache } from '@/features/graph/dev/clearSiteCache'

const IS_DEVELOPMENT_BUILD = process.env.NODE_ENV === 'development'

export default function DevCacheButton() {
  const [status, setStatus] = useState<'idle' | 'running' | 'failed'>('idle')
  const [message, setMessage] = useState<string | null>(null)
  const [isLocalHost, setIsLocalHost] = useState(false)
  const [isSigmaLabRoute, setIsSigmaLabRoute] = useState(false)
  const isRunning = status === 'running'
  const shouldShow = IS_DEVELOPMENT_BUILD || isLocalHost

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setIsLocalHost(
        window.location.hostname === 'localhost' ||
          window.location.hostname === '127.0.0.1' ||
          window.location.hostname === '0.0.0.0',
      )
      setIsSigmaLabRoute(
        window.location.pathname.startsWith('/labs/sigma') &&
          window.matchMedia('(max-width: 640px)').matches,
      )
    }, 0)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [])

  const handleClearPageCache = useCallback(async () => {
    if (!shouldShow || status === 'running') {
      return
    }

    const confirmed = window.confirm(
      'Borrar todo el cache local de esta pagina? Se limpiaran IndexedDB, Cache Storage, localStorage y sessionStorage, y la pagina se recargara.',
    )

    if (!confirmed) {
      return
    }

    setStatus('running')
    setMessage('Borrando cache local...')

    try {
      const summary = await clearSiteCache()
      setMessage(
        `Cache borrado: ${summary.indexedDbDatabases} IndexedDB, ${summary.indexedDbStores} stores, ${summary.cacheStorageCaches} caches. Recargando...`,
      )

      window.setTimeout(() => {
        window.location.reload()
      }, 650)
    } catch (error) {
      const nextMessage =
        error instanceof Error
          ? error.message
          : 'No se pudo borrar el cache local.'
      setStatus('failed')
      setMessage(nextMessage)
      window.alert(nextMessage)
    }
  }, [shouldShow, status])

  if (!shouldShow) {
    return null
  }

  return (
    <button
      className="dev-cache-floating-btn"
      disabled={isRunning}
      onClick={() => {
        void handleClearPageCache()
      }}
      style={{
        position: 'fixed',
        top: isSigmaLabRoute ? '76px' : '18px',
        left: '18px',
        zIndex: isSigmaLabRoute ? 42 : 2147483647,
        display: 'inline-flex',
        alignItems: 'center',
        gap: '10px',
        minHeight: '46px',
        padding: '0 14px 0 12px',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        borderRadius: '8px',
        background: 'rgba(7, 12, 24, 0.72)',
        boxShadow: '0 14px 34px rgba(2, 6, 23, 0.26)',
        backdropFilter: 'blur(16px)',
        color: '#f8fafc',
        cursor: isRunning ? 'not-allowed' : 'pointer',
        opacity: isRunning ? 0.62 : 1,
      }}
      title={message ?? 'Borrar cache local de desarrollo'}
      type="button"
    >
      <span
        aria-hidden="true"
        style={{
          width: '8px',
          height: '8px',
          borderRadius: '999px',
          background: isRunning ? '#e3b56c' : '#f06a67',
          boxShadow: isRunning
            ? '0 0 16px rgba(227, 181, 108, 0.5)'
            : '0 0 16px rgba(240, 106, 103, 0.45)',
          flex: '0 0 auto',
        }}
      />
      <span
        style={{
          display: 'grid',
          gap: '2px',
          textAlign: 'left',
        }}
      >
        <span
          style={{
            color: 'rgba(148, 163, 184, 0.88)',
            fontSize: '10px',
            fontWeight: 800,
            letterSpacing: '0.12em',
            lineHeight: 1,
            textTransform: 'uppercase',
          }}
        >
          Dev cache
        </span>
        <span
          style={{
            color: '#f8fafc',
            fontSize: '13px',
            fontWeight: 800,
            letterSpacing: '0.01em',
            lineHeight: 1.15,
          }}
        >
          {isRunning ? 'Limpiando...' : 'Limpiar local'}
        </span>
      </span>
    </button>
  )
}
