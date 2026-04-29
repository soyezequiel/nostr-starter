# Guia del codebase actual

Este documento resume el codigo que existe hoy y donde conviene tocarlo. No reemplaza `AGENTS.md`: aca solo queda el mapa tecnico vigente.

## Producto actual

- Las superficies publicas usan prefijo obligatorio de locale: `/{locale}`.
- `src/app/[locale]/page.tsx` renderiza la landing publica via `src/components/landing/LandingPage.tsx`.
- `src/app/[locale]/labs/sigma/page.tsx` es el explorador principal de identidad. Es el unico grafo vivo del producto.
- `src/components/Navbar.tsx` conecta las rutas publicas localizadas y la autenticacion compartida.
- `proxy.ts` resuelve locale para rutas publicas con esta precedencia: URL explicita, cookie `NEXT_LOCALE`, `Accept-Language`, fallback `es`.

No asumir que existe un grafo v1 en `/`, un switcher de secciones global o `store/nav.ts`.

## Mapa de ownership

| Area | Ruta principal | Responsabilidad |
| --- | --- | --- |
| Rutas Next | `src/app/` | Entrypoints de paginas, layout raiz y arbol localizado `src/app/[locale]/` |
| Componentes compartidos | `src/components/` | Navbar, login, perfil, badges, imagenes y home |
| I18n publica | `src/i18n/`, `messages/`, `proxy.ts` | Locales soportados, carga de mensajes, helpers de rutas/formatos y resolucion de idioma |
| Auth compartida | `src/store/auth.ts` | Estado de sesion usado por navbar, profile y badges |
| Nostr clasico | `src/lib/nostr.ts` | NDK, login, NIP-65, perfiles, followers, following, notas y badges |
| Media compartida | `src/lib/media.ts` | Normalizacion de imagenes/medios |
| Sigma UI/dominio | `src/features/graph-v2/` | UI, proyecciones, dominio canonico y renderer Sigma |
| Runtime de grafo | `src/features/graph-runtime/` | Store, kernel, relays, DB, workers, analysis y export |

## Sigma

Entrypoints:

- `src/app/[locale]/labs/sigma/page.tsx`
- `src/features/graph-v2/GraphClientV2.tsx`
- `src/features/graph-v2/ui/GraphAppV2.tsx`

Flujo actual:

1. `SigmaRootInput.tsx` acepta `npub`, `nprofile`, pubkey hex, NIP-05, links con puntero NIP-19 o la sesion conectada.
2. `resolveRootIdentity()` resuelve pubkey, relay hints y evidencia de origen.
3. `LegacyKernelBridge` conecta la UI nueva con `browserAppKernel` y separa snapshot de escena vs estado UI (`rootLoad` / relays) para no invalidar Sigma por progreso de carga.
4. El kernel carga raiz, relays, vecinos, expansion de nodos, detalle, capas, zaps y persistencia.
5. Los workers parsean eventos y calculan analisis pesado fuera de React.
6. `graph-v2/projections/` arma snapshots para render y fisica; la firma de escena vive sobre revisiones del store, no sobre serializacion completa de nodos.
7. `SigmaCanvasHost` monta Sigma y `renderer/` corre ForceAtlas2 sobre el grafo de fisica.

Limites importantes:

- Estado que afecta paneles, capas, seleccion, relays, export o runtime debe vivir en el store del grafo, no como estado local aislado.
- Procesamiento caro no va en render paths de React.
- Estilos de Sigma viven en `src/features/graph-v2/ui/graph-v2.css` y deben quedar scopeados bajo `[data-graph-v2]`.
- El runtime de avatares de Sigma vive en `src/features/graph-v2/renderer/avatar/`; no agregar caches paralelos de imagenes.
- La captura PNG social vive en `src/features/graph-v2/renderer/socialGraphCapture.ts` y usa el cache/loader de avatares. Para maximizar fotos reales sin taint de canvas, precarga imagenes por el proxy acotado `src/app/api/social-avatar/route.ts`. Es una salida visual, no el export auditable.

## Runtime de grafo

Subareas principales:

- `app/store/`: slices de grafo, UI, relays, analysis, zaps, keywords, pathfinding y export.
- `kernel/`: fachada, runtime browser, transiciones y modulos de ciclo de vida.
- `kernel/modules/`: root loading, relay session, expansion, detail, hydration, persistence, analysis, zaps y export orchestration.
- `nostr/`: transporte, adapters, NIP-05, errores y normalizacion de relays.
- `db/`: Dexie, entidades y repositorios.
- `analysis/`: tipos y claves de analisis compartido.
- `export/`: snapshot, canonicalizacion, ZIP multipart y descarga.
- `workers/`: gateway browser y workers de eventos, grafo y verificacion.

Export auditable existe en runtime y kernel, pero `GraphAppV2.tsx` no lo mezcla con la captura social. Si se toca esa capa, mantener salida deterministica, auditable y con estados de progreso/falla.

## Workers

`scripts/build-graph-workers.mjs` compila estos entrypoints hacia `public/workers`:

- `src/features/graph-runtime/workers/events.worker.ts`
- `src/features/graph-runtime/workers/graph.worker.ts`
- `src/features/graph-runtime/workers/verifyWorker.ts`

`next.config.ts` publica un `NEXT_PUBLIC_GRAPH_WORKER_BUILD_ID` derivado de esos artefactos para versionar las URLs del browser y evitar reutilizar bundles viejos despues de reinicios.

No existe `physics.worker`: la fisica actual corre desde el renderer de Sigma/Graphology.

## Donde tocar

- Nueva ruta publica: `src/app/[locale]/<route>/page.tsx`; si tambien debe existir sin prefijo por compatibilidad, agregar un stub en `src/app/<route>/page.tsx` que redirija.
- Cambio de home: `src/components/landing/`; si cambia la navegacion publica o el selector de idioma, revisar tambien `src/components/Navbar.tsx`, `src/components/LanguageSwitcher.tsx` y `src/i18n/routing.ts`.
- Perfil, badges o login clasico: `src/lib/nostr.ts`, `src/store/auth.ts` y componentes compartidos.
- Panel/control de Sigma: `src/features/graph-v2/ui/GraphAppV2.tsx` y componentes `Sigma*`.
- Semantica del grafo: bridge, proyecciones o dominio en `src/features/graph-v2/`.
- Discovery, relays, expansion, persistencia o protocolo: `src/features/graph-runtime/kernel/` y `nostr/`.
- Analisis pesado o parsing masivo: `src/features/graph-runtime/workers/` o `analysis/`.
- Export/evidencia: `src/features/graph-runtime/export/` y `kernel/modules/export-orch.ts`.

## Internacionalizacion publica

- `src/i18n/routing.ts` es la fuente unica de verdad para `locales`, `defaultLocale`, labels visibles y helper de prefijo.
- `src/i18n/request.ts` conecta `next-intl` con la carga de mensajes por request.
- `src/i18n/messages.ts` registra los namespaces que se cargan por locale. Agregar un idioma nuevo requiere:
  1. sumarlo en `src/i18n/routing.ts`
  2. copiar `messages/es/` a `messages/<locale>/`
  3. registrar el locale en `src/i18n/messages.ts`
- `messages/<locale>/` guarda los namespaces publicos actuales: `common`, `landing`, `profile`, `badges`, `auth`.
- Sigma ya vive bajo rutas localizadas, pero en esta etapa no traduce su UI interna; solo metadata y navegacion externa.

## Reglas tecnicas que no conviene romper

- Mantener fetches Nostr acotados por timeouts.
- Preservar UX de estados parciales, stale, vacios y fallas de relay.
- No hardcodear un unico relay cuando ya existe comportamiento relay-aware.
- No reintroducir el modelo viejo de grafo v1 ni un runtime paralelo en `/`.
- No presentar `pathfinding` como producto completo sin verificar un flujo UI end to end.
- No tratar export como una descarga cosmetica: es empaquetado de evidencia.
