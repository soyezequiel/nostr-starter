'use client'

import { useCallback, useEffect, useState } from 'react'

import { clearSiteCache } from '@/features/graph/dev/clearSiteCache'

const IS_DEVELOPMENT_BUILD = process.env.NODE_ENV === 'development'

export default function DevCacheButton() {
  const [status, setStatus] = useState<'idle' | 'running' | 'failed'>('idle')
  const [message, setMessage] = useState<string | null>(null)
  const [isLocalHost, setIsLocalHost] = useState(false)
  const isRunning = status === 'running'
  const shouldShow = IS_DEVELOPMENT_BUILD || isLocalHost

  useEffect(() => {
    setIsLocalHost(
      window.location.hostname === 'localhost' ||
        window.location.hostname === '127.0.0.1' ||
        window.location.hostname === '0.0.0.0',
    )
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
        top: '28px',
        right: '128px',
        zIndex: 2147483647,
        minHeight: '44px',
        padding: '0 16px',
        border: '1px solid rgba(248, 113, 113, 0.5)',
        borderRadius: '8px',
        background: 'rgba(127, 29, 29, 0.96)',
        boxShadow: '0 18px 42px rgba(0, 0, 0, 0.42)',
        color: '#fee2e2',
        cursor: isRunning ? 'not-allowed' : 'pointer',
        fontSize: '13px',
        fontWeight: 800,
        letterSpacing: '0.02em',
        opacity: isRunning ? 0.62 : 1,
      }}
      title={message ?? 'Borrar cache local de desarrollo'}
      type="button"
    >
      {isRunning ? 'DEV: borrando...' : 'DEV: borrar cache'}
    </button>
  )
}
