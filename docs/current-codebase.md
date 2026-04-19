# Guia del codebase actual

Este documento resume el codigo que existe hoy y donde conviene tocarlo. No reemplaza `AGENTS.md`: aca solo queda el mapa tecnico vigente.

## Producto actual

- `/` es la home sin runtime de grafo. Entra por `src/app/page.tsx` y renderiza `src/components/landing/LandingPage.tsx`.
- `/labs/sigma` es el explorador principal de identidad. Es el unico grafo vivo del producto.
- `src/components/Navbar.tsx` conecta las rutas publicas y la autenticacion compartida.

No asumir que existe un grafo v1 en `/`, un switcher de secciones global o `store/nav.ts`.

## Mapa de ownership

| Area | Ruta principal | Responsabilidad |
| --- | --- | --- |
| Rutas Next | `src/app/` | Entrypoints de paginas, layout global y CSS base |
| Componentes compartidos | `src/components/` | Navbar, login, perfil, badges, imagenes y home |
| Auth compartida | `src/store/auth.ts` | Estado de sesion usado por navbar, profile y badges |
| Nostr clasico | `src/lib/nostr.ts` | NDK, login, NIP-65, perfiles, followers, following, notas y badges |
| Media compartida | `src/lib/media.ts` | Normalizacion de imagenes/medios |
| Sigma UI/dominio | `src/features/graph-v2/` | UI, proyecciones, dominio canonico y renderer Sigma |
| Runtime de grafo | `src/features/graph-runtime/` | Store, kernel, relays, DB, workers, analysis y export |

## Sigma

Entrypoints:

- `src/app/labs/sigma/page.tsx`
- `src/features/graph-v2/GraphClientV2.tsx`
- `src/features/graph-v2/ui/GraphAppV2.tsx`

Flujo actual:

1. `SigmaRootInput.tsx` acepta `npub`, `nprofile`, pubkey hex, NIP-05, links con puntero NIP-19 o la sesion conectada.
2. `resolveRootIdentity()` resuelve pubkey, relay hints y evidencia de origen.
3. `LegacyKernelBridge` conecta la UI nueva con `browserAppKernel`.
4. El kernel carga raiz, relays, vecinos, expansion de nodos, detalle, capas, zaps y persistencia.
5. Los workers parsean eventos y calculan analisis pesado fuera de React.
6. `graph-v2/projections/` arma snapshots para render y fisica.
7. `SigmaCanvasHost` monta Sigma y `renderer/` corre ForceAtlas2 sobre el grafo de fisica.

Limites importantes:

- Estado que afecta paneles, capas, seleccion, relays, export o runtime debe vivir en el store del grafo, no como estado local aislado.
- Procesamiento caro no va en render paths de React.
- Estilos de Sigma viven en `src/features/graph-v2/ui/graph-v2.css` y deben quedar scopeados bajo `[data-graph-v2]`.
- El runtime de avatares de Sigma vive en `src/features/graph-v2/renderer/avatar/`; no agregar caches paralelos de imagenes.

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

Export existe en runtime y kernel, pero `GraphAppV2.tsx` no expone hoy un flujo publico de export desde Sigma. Si se toca esa capa, mantener salida deterministica, auditable y con estados de progreso/falla.

## Workers

`scripts/build-graph-workers.mjs` compila estos entrypoints hacia `public/workers`:

- `src/features/graph-runtime/workers/events.worker.ts`
- `src/features/graph-runtime/workers/graph.worker.ts`
- `src/features/graph-runtime/workers/verifyWorker.ts`

No existe `physics.worker`: la fisica actual corre desde el renderer de Sigma/Graphology.

## Donde tocar

- Nueva ruta: `src/app/<route>/page.tsx` y `src/components/Navbar.tsx`.
- Cambio de home: `src/components/landing/` y, si cambia la navegacion, `Navbar`.
- Perfil, badges o login clasico: `src/lib/nostr.ts`, `src/store/auth.ts` y componentes compartidos.
- Panel/control de Sigma: `src/features/graph-v2/ui/GraphAppV2.tsx` y componentes `Sigma*`.
- Semantica del grafo: bridge, proyecciones o dominio en `src/features/graph-v2/`.
- Discovery, relays, expansion, persistencia o protocolo: `src/features/graph-runtime/kernel/` y `nostr/`.
- Analisis pesado o parsing masivo: `src/features/graph-runtime/workers/` o `analysis/`.
- Export/evidencia: `src/features/graph-runtime/export/` y `kernel/modules/export-orch.ts`.

## Reglas tecnicas que no conviene romper

- Mantener fetches Nostr acotados por timeouts.
- Preservar UX de estados parciales, stale, vacios y fallas de relay.
- No hardcodear un unico relay cuando ya existe comportamiento relay-aware.
- No reintroducir el modelo viejo de grafo v1 ni un runtime paralelo en `/`.
- No presentar `pathfinding` como producto completo sin verificar un flujo UI end to end.
- No tratar export como una descarga cosmetica: es empaquetado de evidencia.
