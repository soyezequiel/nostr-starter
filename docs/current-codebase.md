# Guia del codebase actual

Este documento describe el codigo que existe hoy en el repositorio. La aplicacion ya no conserva el grafo v1 de `/`; Sigma es el unico grafo vivo.

Complemento recomendado para onboarding tecnico:

- [Diagramas para programadores](./diagramas-programador/README.md)

## 1. Forma actual del producto

Hoy:

- `/` es una landing de entrada sin runtime de grafo
- `/labs/sigma` monta el explorador de identidad con Sigma.js, Graphology y ForceAtlas2
- `profile` y `badges` viven en rutas separadas
- la incertidumbre de relays forma parte de la UX, no es un caso borde
- el runtime compartido del grafo vive en `src/features/graph-runtime/`
- la app soporta export orientado a evidencia, no solo exploracion en pantalla

## 2. Mapa de rutas

### `/`

Punto de entrada:

- `src/app/page.tsx`

Objetivo:

- presentar una landing de entrada sin canvas ni runtime de grafo
- enviar a `/labs/sigma`, `/profile` y `/badges`

### `/labs/sigma`

Puntos de entrada:

- `src/app/labs/sigma/page.tsx`
- `src/features/graph-v2/GraphClientV2.tsx`
- `src/features/graph-v2/ui/GraphAppV2.tsx`

Objetivo:

- cargar una identidad desde `npub`, `nprofile`, pubkey hex, NIP-05, links con puntero NIP-19 o la sesion conectada
- consultar relays con estados parciales, stale y timeouts visibles
- proyectar el vecindario social con Sigma.js
- expandir nodos, alternar capas, ver detalle de identidades y zaps
- conservar export deterministico y persistencia local

Notas:

- `GraphClientV2.tsx` carga la app con `ssr: false`
- `graph-v2/` encapsula UI, dominio canonico, bridge, proyecciones y renderer Sigma
- el runtime heredado necesario fue movido a `graph-runtime/`

### `/profile`

Puntos de entrada:

- `src/app/profile/page.tsx`
- `src/components/Profile.tsx`

Objetivo:

- autenticar a la cuenta conectada
- renderizar metadata de perfil, estadisticas sociales y notas
- reutilizar auth y helpers compartidos de Nostr

### `/badges`

Puntos de entrada:

- `src/app/badges/page.tsx`
- `src/components/Badges.tsx`

Objetivo:

- traer premios NIP-58 para la identidad conectada
- resolver definiciones de badges y sus medios asociados

## 3. Capa compartida de la app

### `src/components/Navbar.tsx`

Navegacion compartida entre:

- home
- Sigma
- profile
- badges

Tambien expone el punto comun de conectar y desconectar mediante `LoginModal`.

### `src/lib/nostr.ts`

Usar este modulo para las superficies clasicas de la app:

- setup compartido del singleton de NDK
- metodos de login
- enriquecimiento de relays via `NIP-65`
- parseo de perfiles
- fetches de followers, following y notas
- timeouts acotados para llamadas de red visibles para usuario

### `src/store/auth.ts`

Estado compartido de autenticacion usado por:

- `Navbar`
- `Profile`
- `Badges`

## 4. Arquitectura del grafo Sigma

### UI y renderer

- `src/features/graph-v2/ui/GraphAppV2.tsx`
- `src/features/graph-v2/ui/SigmaCanvasHost.tsx`
- `src/features/graph-v2/renderer/`

Responsabilidades:

- shell visual del laboratorio Sigma
- selector de identidad
- paneles y controles del grafo
- renderer Sigma sobre un grafo de render dedicado
- ForceAtlas2 sobre un grafo de fisica separado
- bridge explicito de posiciones entre fisica y render
- avatar runtime propio de graph-v2

Los estilos de Sigma viven en `src/features/graph-v2/ui/graph-v2.css` y deben quedar scopeados bajo `[data-graph-v2]`.

### Bridge y dominio

- `src/features/graph-v2/bridge/`
- `src/features/graph-v2/domain/`
- `src/features/graph-v2/projections/`

Responsabilidades:

- adaptar el store/runtime compartido a un dominio canonico para Sigma
- construir snapshots de escena separados en `render` y `physics`
- mantener separados edges visibles y edges usados por fuerza/layout
- dejar la politica de elegibilidad de fisica encapsulada para futuras fases

### Runtime compartido

- `src/features/graph-runtime/app/store/`
- `src/features/graph-runtime/kernel/`
- `src/features/graph-runtime/nostr/`
- `src/features/graph-runtime/db/`
- `src/features/graph-runtime/analysis/`
- `src/features/graph-runtime/export/`
- `src/features/graph-runtime/workers/`

Esta capa resuelve:

- decodificacion y carga del root
- manejo de sesiones de relays
- overrides reversibles de relays
- hidratacion del detalle de nodo
- preview estructural y expansion
- cambio de capas
- programacion del analisis del grafo descubierto
- precarga de la capa de zaps
- persistencia local con Dexie
- export deterministico de snapshots

Si la logica se parece a workflow, ciclo de vida de sesion, protocolo, persistencia o evidencia, pertenece en `graph-runtime`.

### Workers

Los entrypoints actuales estan en `scripts/build-graph-workers.mjs`:

- `src/features/graph-runtime/workers/events.worker.ts`
- `src/features/graph-runtime/workers/graph.worker.ts`
- `src/features/graph-runtime/workers/verifyWorker.ts`

Ya no existe `physics.worker`: las fisicas v1 fueron eliminadas junto con el render Deck/d3.

## 5. Workflow actual del grafo

A nivel general:

1. La persona usuaria ingresa un `npub`, `nprofile`, pubkey hex, NIP-05, link de perfil o usa la sesion conectada en `/labs/sigma`.
2. `SigmaRootInput.tsx` llama a `resolveRootIdentity()` para resolver el input a una pubkey, relay hints y evidencia de origen.
3. El bridge llama al runtime compartido para cargar el vecindario raiz desde el set activo de relays.
4. Los workers parsean eventos y calculan analisis del grafo.
5. Los slices del store reciben nodos, links, estado de relays, analisis, zaps y export.
6. Las proyecciones de `graph-v2` traducen ese estado a snapshots para Sigma.
7. `SigmaCanvasHost` monta Sigma con el grafo de render y el adapter corre FA2 sobre el grafo de fisica.
8. Un ledger compartido preserva posiciones entre rebuilds y espeja los nodos fisicos hacia el render mientras la simulacion corre.
9. La UI expone detalle de nodo, relays, render, capas, export y diagnosticos.

Esto implica:

- la validacion vive cerca del borde input-kernel
- la sesion y el comportamiento de relays viven en el kernel
- las transformaciones costosas van en workers o analysis
- las decisiones visuales van en `graph-v2/ui` y `graph-v2/renderer`

## 6. Puntos seguros para extender

### Agregar una ruta nueva

Tocar:

- `src/app/<route>/page.tsx`
- `src/components/Navbar.tsx`

### Agregar un panel o control de Sigma

Tocar:

- `src/features/graph-v2/ui/GraphAppV2.tsx`
- componentes nuevos dentro de `src/features/graph-v2/ui/`
- el bridge o runtime solamente si cambia semantica de grafo

### Agregar logica pesada de discovery o analysis

Tocar:

- `src/features/graph-runtime/kernel/`
- `src/features/graph-runtime/analysis/`
- `src/features/graph-runtime/workers/`

### Agregar capacidades compartidas de cuenta

Tocar:

- `src/lib/nostr.ts`
- `src/store/auth.ts`
- `src/components/LoginModal.tsx`

## 7. Convenciones de trabajo

- Mantener fetches async acotados por timeouts.
- Preservar la UX de estado parcial cuando los relays rinden mal.
- Reutilizar el lenguaje visual actual de La Crypta.
- Preferir extensiones dentro de `/labs/sigma` y `graph-v2` para UX de grafo.
- No reintroducir el patron viejo de `store/nav.ts`.
- No volver a crear un grafo v1 paralelo en `/`.

## 8. Orden de lectura recomendado

1. `src/app/page.tsx`
2. `src/app/labs/sigma/page.tsx`
3. `src/features/graph-v2/GraphClientV2.tsx`
4. `src/features/graph-v2/ui/GraphAppV2.tsx`
5. `src/features/graph-v2/bridge/LegacyKernelBridge.ts`
6. `src/features/graph-runtime/app/store/types.ts`
7. `src/features/graph-runtime/kernel/runtime.ts`
8. `src/features/graph-v2/renderer/SigmaRendererAdapter.ts`
9. `src/features/graph-runtime/export/types.ts`
10. `src/lib/nostr.ts`
