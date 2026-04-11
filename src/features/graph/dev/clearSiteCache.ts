import { NOSTR_GRAPH_DB_NAME } from '@/features/graph/db'

type IndexedDbFactoryWithDatabases = IDBFactory & {
  databases?: () => Promise<Array<{ name?: string | null }>>
}

export interface ClearSiteCacheSummary {
  cacheStorageCaches: number
  indexedDbDatabases: number
  indexedDbStores: number
  localStorageCleared: boolean
  sessionStorageCleared: boolean
}

const FALLBACK_INDEXED_DB_NAMES = [NOSTR_GRAPH_DB_NAME]

function openIndexedDatabase(name: string): Promise<IDBDatabase | null> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name)

    request.onerror = () => {
      reject(request.error ?? new Error(`No se pudo abrir IndexedDB ${name}`))
    }

    request.onsuccess = () => {
      resolve(request.result)
    }
  })
}

function clearIndexedDatabaseStores(name: string): Promise<number> {
  return openIndexedDatabase(name).then(
    (db) =>
      new Promise((resolve, reject) => {
        if (!db) {
          resolve(0)
          return
        }

        const storeNames = Array.from(db.objectStoreNames)
        if (storeNames.length === 0) {
          db.close()
          resolve(0)
          return
        }

        const transaction = db.transaction(storeNames, 'readwrite')
        transaction.oncomplete = () => {
          db.close()
          resolve(storeNames.length)
        }
        transaction.onerror = () => {
          const error =
            transaction.error ??
            new Error(`No se pudo limpiar IndexedDB ${name}`)
          db.close()
          reject(error)
        }
        transaction.onabort = () => {
          const error =
            transaction.error ??
            new Error(`Se aborto la limpieza de IndexedDB ${name}`)
          db.close()
          reject(error)
        }

        for (const storeName of storeNames) {
          transaction.objectStore(storeName).clear()
        }
      }),
  )
}

async function listIndexedDatabaseNames(): Promise<string[]> {
  if (typeof indexedDB === 'undefined') {
    return []
  }

  const indexedDbFactory = indexedDB as IndexedDbFactoryWithDatabases
  if (typeof indexedDbFactory.databases !== 'function') {
    return FALLBACK_INDEXED_DB_NAMES
  }

  try {
    const databases = await indexedDbFactory.databases()
    const detectedNames = databases
      .map((database) => database.name)
      .filter((name): name is string => typeof name === 'string' && name.length > 0)

    return Array.from(new Set([...detectedNames, ...FALLBACK_INDEXED_DB_NAMES]))
  } catch {
    return FALLBACK_INDEXED_DB_NAMES
  }
}

async function clearCacheStorage(): Promise<number> {
  if (typeof caches === 'undefined') {
    return 0
  }

  const cacheNames = await caches.keys()
  await Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName)))
  return cacheNames.length
}

function clearStorage(storageName: 'localStorage' | 'sessionStorage'): boolean {
  try {
    const storage = window[storageName]
    if (!storage) {
      return false
    }

    storage.clear()
    return true
  } catch {
    return false
  }
}

export async function clearSiteCache(): Promise<ClearSiteCacheSummary> {
  const [cacheStorageCaches, databaseNames] = await Promise.all([
    clearCacheStorage(),
    listIndexedDatabaseNames(),
  ])

  const indexedDbStoreCounts = await Promise.all(
    databaseNames.map((databaseName) => clearIndexedDatabaseStores(databaseName)),
  )

  return {
    cacheStorageCaches,
    indexedDbDatabases: databaseNames.length,
    indexedDbStores: indexedDbStoreCounts.reduce((sum, count) => sum + count, 0),
    localStorageCleared: clearStorage('localStorage'),
    sessionStorageCleared: clearStorage('sessionStorage'),
  }
}
