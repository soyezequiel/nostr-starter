'use client'

import { useCallback, useEffect, useState } from 'react'

import {
  clearSiteCache,
  requestBrowserSiteDataClear,
} from '@/lib/dev/clearSiteCache'

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
      setIsSigmaLabRoute(window.location.pathname.startsWith('/labs/sigma'))
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
    setMessage('Borrando cache local y datos persistidos del navegador...')

    try {
      const summary = await clearSiteCache()
      const browserSiteDataCleared = await requestBrowserSiteDataClear()
      setMessage(
        browserSiteDataCleared
          ? `Datos del sitio borrados: ${summary.indexedDbDatabases} IndexedDB, ${summary.indexedDbStores} stores, ${summary.cacheStorageCaches} caches. Recargando...`
          : `Cache local borrado: ${summary.indexedDbDatabases} IndexedDB, ${summary.indexedDbStores} stores, ${summary.cacheStorageCaches} caches. Recargando...`,
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

  if (!shouldShow || isSigmaLabRoute) {
    return null
  }

  return (
    <button
      aria-label={message ?? 'Borrar cache local de desarrollo'}
      className="fixed bottom-3 right-3 z-[2147483647] inline-flex min-h-10 items-center gap-2 rounded-full border border-white/10 bg-[#070c18]/58 px-3 py-2 text-slate-50 shadow-[0_10px_28px_rgba(2,6,23,0.18)] backdrop-blur-xl transition-opacity duration-150 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f06a67] focus-visible:ring-offset-2 focus-visible:ring-offset-[#020617] sm:bottom-4 sm:right-4"
      disabled={isRunning}
      onClick={() => {
        void handleClearPageCache()
      }}
      style={{
        cursor: isRunning ? 'not-allowed' : 'pointer',
        opacity: isRunning ? 0.82 : 0.42,
      }}
      title={message ?? 'Borrar cache local de desarrollo'}
      type="button"
    >
      <span
        aria-hidden="true"
        className="h-2.5 w-2.5 rounded-full"
        style={{
          background: isRunning ? '#e3b56c' : '#f06a67',
          boxShadow: isRunning
            ? '0 0 16px rgba(227, 181, 108, 0.5)'
            : '0 0 16px rgba(240, 106, 103, 0.45)',
          flex: '0 0 auto',
        }}
      />
      <span className="hidden text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-300 sm:inline">
        Cache
      </span>
      <span className="hidden text-[12px] font-bold text-slate-50 lg:inline">
        {isRunning ? 'Limpiando...' : 'Limpiar'}
      </span>
    </button>
  )
}
