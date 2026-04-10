# Avatar Pipeline Troubleshooting

Fecha: 2026-04-10

Este documento resume los problemas reales que aparecieron durante la
optimizacion del pipeline de imagenes del grafo y como resolverlos si vuelven a
aparecer. No asumir que la cache de imagenes esta limitada por cantidad fija de
filas: casi todos los problemas vistos fueron limites aguas arriba del pipeline.

## Mapa rapido

Archivos clave:

- `src/features/graph/kernel/modules/root-loader.ts`
- `src/features/graph/kernel/modules/profile-hydration.ts`
- `src/features/graph/kernel/modules/constants.ts`
- `src/features/graph/render/imageRuntime.ts`
- `src/features/graph/render/avatarAtlasManager.ts`
- `src/features/graph/db/repositories.ts`
- `src/features/graph/db/database.ts`
- `src/features/graph/db/entities.ts`

Tablas IndexedDB relevantes:

- DB: `nostr-graph-explorer`
- Perfiles: `profiles`
- Variantes de imagen: `imageVariants`

`imageVariants` guarda variantes por `[sourceUrl+bucket]`, no una fila por
usuario. La misma imagen puede tener varias filas: buckets `32, 64, 128, 256,
512, 1024`.

## Limites reales actuales

Cache persistente de imagenes:

- TTL: `IMAGE_VARIANT_TTL_MS = 7 dias`
- Presupuesto default: `DEFAULT_STORAGE_BUDGET_BYTES = 256 MB`
- Presupuesto maximo: `MAX_STORAGE_BUDGET_BYTES = 512 MB`
- Si el browser expone `navigator.storage.estimate()`, se usa 20% de la cuota,
  acotado entre 256 MB y 512 MB.
- La eviction borra por `lastAccessedAt`, desde lo menos usado.

Pipeline de red/perfiles:

- `NODE_PROFILE_HYDRATION_BATCH_SIZE = 150`
- `NODE_PROFILE_HYDRATION_BATCH_CONCURRENCY = 3`
- `NODE_PROFILE_PERSIST_CONCURRENCY = 8`
- El relay adapter tambien parte filtros por `DEFAULT_MAX_AUTHORS_PER_FILTER =
  50`, asi que subir el batch de perfiles no manda un unico filtro enorme.

Pipeline de imagenes:

- `PREFETCH_RING_FACTOR = 1`
- `BASE_FETCH_CONCURRENCY = 12`
- `BOOSTED_FETCH_CONCURRENCY = 16`
- `MAX_UPLOADS_PER_FRAME = 8`
- `MAX_UPLOAD_BYTES_PER_FRAME = 4 MB`

## Sintoma: tarda 30-60s antes de mostrar imagenes

Causa raiz:

Los nodos aparecian desde el snapshot/contact list cacheado, pero no tenian
`pictureUrl` hasta que terminaba la carga live de relays. `prepareFrame()` en
`imageRuntime.ts` salta cualquier nodo sin `pictureUrl`, asi que la cache de
imagenes no podia hacer nada.

Fix esperado:

1. En `root-loader.ts`, despues del primer `replaceRootGraph()` con datos
   cacheados, llamar temprano a `hydrateNodeProfiles(...)` con root + follows
   cacheados. Esto sincroniza perfiles desde `profiles` mientras la carga live
   de relays sigue en paralelo.
2. En `profile-hydration.ts`, leer perfiles cacheados en bulk para todos los
   pubkeys antes de entrar a batches de red:
   - `ctx.repositories.profiles.getMany(uniquePubkeys)`
   - `syncNodeProfile(...)` para cada cache hit
3. Si el problema vuelve, revisar que `profiles.getMany()` exista en
   `db/repositories.ts`.

No resolver solo subiendo la cache de imagenes: sin `pictureUrl`, no hay nada
que cachear.

## Sintoma: aparece una primera tanda y la segunda tarda cerca de 1 minuto

Causa raiz:

La hidratacion de kind:0 usaba `collectRelayEvents()`, que acumula eventos y
resuelve al final de la suscripcion, cuando todos los relays terminan o hacen
timeout. Eso bloqueaba la UI aunque los perfiles fueran llegando.

Fix esperado:

En `profile-hydration.ts`, para kind:0 usar `adapter.subscribe(...).subscribe`
con `next` / `nextBatch`:

- procesar cada `RelayEventEnvelope` apenas llega;
- guardar el ultimo evento por pubkey en `latestEnvelopesByPubkey`;
- llamar a `syncNodeProfile(...)` inmediatamente;
- persistir a IDB en background al completar el batch con
  `runWithConcurrencyLimit(envelopes, NODE_PROFILE_PERSIST_CONCURRENCY, ...)`.

Mantener la comparacion replaceable:

- `created_at` mas alto gana;
- si empata, menor `event.id` gana.

## Sintoma: las imagenes aparecen, se van y vuelven

Causa raiz:

`replaceRootGraph()` hacia `resetGraph()` cuando llegaba el grafo live. Luego
recreaba nodos con `profileState: 'loading'`, borrando `picture`, `about`,
`nip05`, etc. La segunda hidratacion volvia a ponerlos, causando parpadeo.

Fix esperado:

En `root-loader.ts`, antes de `state.resetGraph()`, capturar:

```ts
const previousNodes = state.nodes
```

Despues, al crear nodos nuevos, usar un helper tipo `resolveProfilePatch(...)`
que preserve metadata si el nodo anterior estaba `profileState === 'ready'` y
no hay un perfil fallback mas nuevo.

Regla importante:

- La topologia puede reemplazarse.
- El perfil del mismo pubkey no debe volver a `loading` si ya estaba `ready`.

## Sintoma: desaparece la foto de perfil de la raiz

Causa raiz:

Con el streaming de kind:0, podia llegar primero un evento viejo desde algun
relay, posiblemente sin `picture`, y pisar el perfil cacheado mas nuevo de la
raiz. Antes, al esperar el batch completo, se elegia el ultimo replaceable al
final.

Fix esperado:

En `profile-hydration.ts`, mantener un `cachedProfilesByPubkey` global para la
hidratacion y comparar cada evento live contra el perfil cacheado antes de
sincronizar:

- si `envelope.event.created_at < profile.createdAt`, ignorar;
- si empata y `envelope.event.id` no gana el tie-break, ignorar;
- solo un kind:0 realmente mas nuevo puede pisar el cacheado.

El helper esperado es equivalente a:

```ts
function isEnvelopeNewerThanProfile(envelope, profile) {
  if (envelope.event.created_at !== profile.createdAt) {
    return envelope.event.created_at > profile.createdAt
  }

  return envelope.event.id.localeCompare(profile.eventId) < 0
}
```

## Sintoma: `imageVariants` queda clavado en 50 filas

Causa raiz:

No era un limite de IndexedDB. Era el batch de perfiles:

```ts
NODE_PROFILE_HYDRATION_BATCH_SIZE = 50
```

La cache de imagenes solo puede guardar imagenes para nodos con `pictureUrl`.
Si solo 50 perfiles tenian `pictureUrl`, `imageVariants` quedaba cerca de 50.

Fix aplicado:

En `constants.ts`:

```ts
export const NODE_PROFILE_HYDRATION_BATCH_SIZE = 150
export const NODE_PROFILE_HYDRATION_BATCH_CONCURRENCY = 3
```

En `imageRuntime.ts`:

```ts
const PREFETCH_RING_FACTOR = 1
```

Si sigue clavado, revisar:

1. Cuantos nodos tienen perfil cacheado en `profiles`.
2. Cuantos nodos tienen `pictureUrl` en el render model.
3. Contadores del probe: `missingSourceNodes`, `usableSourceNodes`,
   `visibleRequests`, `prefetchRequests`.

## Requisito: si la imagen esta en cache, no aplicar limites de viewport/red

Interpretacion correcta:

- No quitar limites de red ni memoria.
- Si el perfil y la imagen ya estan cacheados, no deben depender del batch de
  relays ni del viewport para ser precalentados.

Fix esperado:

1. `ProfilesRepository.getMany(pubkeys)` en `db/repositories.ts`.
2. `profile-hydration.ts` debe sincronizar todos los perfiles cacheados antes
   de los batches de red.
3. `imageRuntime.ts` debe crear `cacheOnlyRequests` para nodos con `pictureUrl`
   que estan fuera del viewport/prefetch ring:
   - usar buckets base `64` y `128` (`BASE_ATLAS_MIN_BUCKET`,
     `BASE_ATLAS_MAX_BUCKET`);
   - llamar `batchPreloadFromPersistent(cacheOnlyRequests, frameNow, {
     cacheOnly: true })`;
   - no llamar `scheduleEnsureVariant(...)` para estos requests cache-only, para
     no disparar red;
   - recordar misses en `cacheOnlyPersistentMisses` para no consultar IDB cada
     frame;
   - borrar el miss cuando una variante se persiste con exito.

## Como inspeccionar la cache en DevTools

Ruta:

1. DevTools
2. Application
3. IndexedDB
4. `nostr-graph-explorer`
5. `imageVariants`

Snippet para contar:

```js
const req = indexedDB.open('nostr-graph-explorer')

req.onsuccess = () => {
  const db = req.result
  const tx = db.transaction('imageVariants', 'readonly')
  const store = tx.objectStore('imageVariants')

  let variants = 0
  let totalBytes = 0
  const uniqueUrls = new Set()
  const buckets = new Map()

  store.openCursor().onsuccess = (event) => {
    const cursor = event.target.result

    if (!cursor) {
      console.log({
        variants,
        uniqueImages: uniqueUrls.size,
        totalMB: (totalBytes / 1024 / 1024).toFixed(2),
      })

      console.table(
        [...buckets.entries()].map(([bucket, value]) => ({
          bucket,
          variants: value.variants,
          mb: (value.bytes / 1024 / 1024).toFixed(2),
        })),
      )
      return
    }

    const record = cursor.value
    const bytes = record.byteSize ?? record.blob?.size ?? 0

    variants += 1
    totalBytes += bytes
    uniqueUrls.add(record.sourceUrl)

    const bucket = record.bucket
    const current = buckets.get(bucket) ?? { variants: 0, bytes: 0 }
    current.variants += 1
    current.bytes += bytes
    buckets.set(bucket, current)

    cursor.continue()
  }
}
```

Interpretacion:

- `variants`: filas en `imageVariants`.
- `uniqueImages`: URLs unicas.
- `totalMB`: uso aproximado.
- Tabla por bucket: cuantas variantes por resolucion.

## Probe y validacion

Usar el workflow documentado en `docs/avatar-pipeline-validation.md`.

Comandos utiles:

```bash
npm run avatar:validate -- --output tmp/avatar-current.json
npm run avatar:compare -- tmp/avatar-before.json tmp/avatar-after.json
```

Para mirar el probe manual:

```text
http://127.0.0.1:3200/?avatarProbe=1
```

En consola:

```js
window.__NOSTR_AVATAR_PIPELINE_PROBE__
```

Counters utiles:

- `hydrationBacklog`
- `visibleRequests`
- `prefetchRequests`
- `missingSourceNodes`
- `usableSourceNodes`
- `readyVisibleNodes`
- `paintedVisibleNodes`
- `queuedVisibleBaseRequests`
- `inFlightVisibleBaseRequests`
- `proxyFallbackSources`

## Verificacion despues de tocar este pipeline

Siempre correr:

```bash
npx tsc --noEmit --pretty false
npm run lint -- --max-warnings=0
npm run build
```

Chequeo manual:

1. Cargar `/`.
2. Ingresar un root con muchos follows.
3. Confirmar que la raiz no pierde su foto cuando entra el grafo live.
4. Confirmar que las imagenes cacheadas aparecen sin esperar el batch de red.
5. Mirar `imageVariants` y confirmar que supera 50 variantes si hay mas nodos
   con perfiles/imagenes disponibles.
6. Mover el grafo: el numero debe subir gradualmente, no quedarse en 50.

## Reglas para cambios futuros

- No tratar `imageVariants` como cache por usuario; es cache por
  `sourceUrl+bucket`.
- No quitar todos los limites de red para resolver cache: separar siempre
  "cache hit" de "network miss".
- No volver a usar `collectRelayEvents()` para pintar perfiles kind:0 si se
  necesita UI progresiva; usar streaming con `nextBatch`.
- No permitir que eventos kind:0 viejos pisen perfiles cacheados mas nuevos.
- No dejar que `replaceRootGraph()` borre metadata `profileState: 'ready'` de un
  pubkey que sigue en el grafo.
- Si el conteo de imagenes parece bajo, primero verificar cuantos nodos tienen
  `pictureUrl`; despues mirar cache.
