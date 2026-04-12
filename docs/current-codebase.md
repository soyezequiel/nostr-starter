# Guia del codebase actual

Este documento describe el codigo que realmente existe hoy en este repositorio. Reemplaza a conciencia varias suposiciones del starter original.

## 1. Forma actual del producto

El starter inicial estaba centrado en perfil.

Este repositorio ahora es **graph-first**.

Hoy:

- la ruta principal monta una aplicacion dedicada al grafo de identidad
- `profile` y `badges` viven en rutas separadas
- la incertidumbre de relays forma parte de la UX, no es un caso borde
- el slice del grafo ya incluye storage, workers, analisis, export y render
- la app soporta export orientado a evidencia, no solo exploracion en pantalla

## 2. Mapa de rutas

### `/`

Puntos de entrada:

- `src/app/page.tsx`
- `src/features/graph/GraphClient.tsx`
- `src/features/graph/GraphApp.tsx`

Objetivo:

- aceptar un `npub` o `nprofile`
- cargar un vecindario descubierto
- inspeccionar y expandir nodos
- cambiar sets de relays
- ajustar el render
- exportar un paquete auditable de snapshot

Notas:

- `GraphClient.tsx` carga la app del grafo con `ssr: false`
- esta ruta es la superficie principal del producto

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

- grafo
- profile
- badges

Tambien expone el punto comun de conectar y desconectar mediante `LoginModal`.

### `src/components/LoginModal.tsx`

Flujos de login actuales:

- extension `NIP-07`
- `nsec`
- bunker `NIP-46`
- flujo QR de Nostr Connect para bunker login

### `src/components/SkeletonImage.tsx`

Wrapper de imagen compartido, usado en las rutas clasicas y en la navbar para:

- placeholders de carga
- fallback de media cuando algo falla
- render de avatar y banner

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

Persiste:

- metodo de login
- perfil parseado

## 4. Arquitectura del grafo

El grafo no es un componente aislado. Es una aplicacion cliente completa dentro del repo.

### Shell principal

- `src/features/graph/GraphApp.tsx`

Responsabilidades:

- flujo de entrada del root
- orquestacion del drawer de configuracion
- paneles de relays y export
- diagnosticos de runtime
- coordinacion entre canvas del grafo y detalle de nodo

### Estado

- `src/features/graph/app/store/`

Slices importantes:

- `graphSlice.ts` para nodos, links, adyacencia, estado del root y expansion
- `relaySlice.ts` para URLs de relays, salud, overrides y estado stale del grafo
- `uiSlice.ts` para panel activo, nodo seleccionado, comparacion, render config y capa activa
- `analysisSlice.ts` para estado de analisis del grafo descubierto y reutilizacion de resultados
- `zapSlice.ts` para estado de la capa de zaps y ordenamiento de aristas
- `exportSlice.ts` para seleccion profunda de usuarios y progreso del job de export

Capas actuales representadas en store y render:

- `graph`
- `connections`
- `following`
- `following-non-followers`
- `mutuals`
- `followers`
- `nonreciprocal-followers`
- `keywords`
- `zaps`
- `pathfinding`

Advertencia importante:

- `pathfinding` existe en los contratos de runtime, store y render, pero hay que tratarlo como infraestructura parcial hasta que tenga workflow y panel de usuario completos

### Kernel y runtime

- `src/features/graph/kernel/runtime.ts`
- `src/features/graph/kernel/runner.ts`
- `src/features/graph/kernel/headless.ts`
- `src/features/graph/kernel/transcript-relay.ts`

Esta capa resuelve:

- decodificacion y carga del root
- manejo de sesiones de relays
- overrides reversibles de relays
- hidratacion del detalle de nodo
- preview estructural y expansion
- busqueda por keywords
- cambio de capas
- programacion del analisis del grafo descubierto
- precarga de la capa de zaps
- orquestacion del export de snapshots

Si la logica se parece a workflow, ciclo de vida de sesion o comportamiento transversal del grafo, pertenece aca.

### Como funciona la capa `connections`

La capa `connections` no expande el grafo ni agrega nodos nuevos.

Su objetivo es mostrar un **subgrafo inducido** usando solamente cuentas que ya
estan presentes en `state.nodes`.

Reglas:

- solo se renderizan aristas cuyo `source` y `target` ya existen en el grafo actual
- no se agregan cuentas externas
- no se usan edges centrados en el root para esta vista
- se preserva direccion
- `follow` e `inbound` se distinguen visualmente

#### Donde vive cada parte

- wiring del boton: `src/features/graph/components/GraphControlRail.tsx`
- cambio de capa y refresco reactivo: `src/features/graph/kernel/facade.ts`
- estado derivado para conexiones: `src/features/graph/app/store/slices/graphSlice.ts`
- derivacion final de aristas renderizables: `src/features/graph/render/buildGraphRenderModel.ts`
- color por tipo de relacion: `src/features/graph/render/GraphSceneLayer.ts`

#### Fuente de datos

La capa se apoya en tres fuentes de evidencia ya conocidas por la app:

- `links`: follows ya presentes en memoria
- `inboundLinks`: evidencia inbound/follower ya presente en memoria
- `connectionsLinks`: edges extra derivados desde contact lists cacheadas para nodos ya visibles

`connectionsLinks` existe para cubrir el caso donde dos nodos del grafo actual
si tienen relacion entre si, pero esa arista todavia no vive en `links` o
`inboundLinks` porque no se expandio manualmente ese nodo.

#### Derivacion

En `facade.ts`, `deriveConnectionsLinks()` hace esto:

1. toma el conjunto actual de pubkeys en `state.nodes`
2. busca en IndexedDB (`contactLists`) las contact lists de esos nodos
3. si faltan contact lists para nodos ya visibles, intenta traer sus kind:3 desde relays
4. persiste esas contact lists faltantes
5. deriva edges `source -> target` solo cuando ambos endpoints ya estan en el grafo actual
6. guarda el resultado en `state.connectionsLinks`

Luego, en `buildGraphRenderModel.ts`, la capa `connections` arma las aristas
renderizables a partir de:

- `links`
- `inboundLinks`
- `connectionsLinks`

pero filtra cualquier edge donde:

- algun endpoint no exista en `nodes`
- `source` o `target` sean el root
- la relacion sea `zap`

Eso deja solamente conexiones internas entre nodos ya descubiertos.

#### Distincion visual

En `GraphSceneLayer.ts`:

- `follow` usa `CONNECTIONS_FOLLOW_COLOR`
- `inbound` usa `CONNECTIONS_INBOUND_COLOR`

Eso permite diferenciar:

- evidencia outbound confirmada (`A sigue a B`)
- evidencia inbound observada por traversal/cache (`A aparece siguiendo a B`)

#### Fix importante de timing

La primera version del feature tenia un bug: si la persona entraba a
`connections` mientras el root todavia estaba cargando, la derivacion podia
ejecutarse demasiado temprano y quedarse en `0 conexiones internas` hasta salir
y volver a entrar a la capa.

Eso se corrigio en `facade.ts` con un refresco reactivo:

- mientras `activeLayer === 'connections'`, la app vuelve a derivar conexiones si cambian `graphRevision`
- tambien rederiva si cambia `inboundGraphRevision`
- el refresco usa cola simple para evitar derivaciones concurrentes

Con eso, la capa `connections` acompana el crecimiento del grafo durante la
carga inicial y durante expansiones posteriores, sin requerir retogglear el
boton.

### Base de datos y persistencia

- `src/features/graph/db/`

Esta capa maneja persistencia cliente con Dexie y helpers de repositorio para:

- perfiles
- listas de contactos
- eventos crudos
- heads replaceable y addressable
- registros de zaps
- referencias entrantes

### Transporte y detalles de protocolo

- `src/features/graph/nostr/`

Usar esta capa para comportamiento de relays y suscripciones especifico del grafo. Los helpers genericos de auth y perfil deben seguir en `src/lib/nostr.ts`.

### Render

- `src/features/graph/render/`
- `src/features/graph/components/GraphCanvas.tsx`

Esta capa maneja:

- integracion con deck.gl
- viewport y logica de fit
- generacion del render model apoyada en workers
- runtime de avatares e imagenes con umbrales segun zoom
- seleccion de labels y geometria de escena
- resaltado de comparacion y transformaciones visuales por capa

### Workers

- `src/features/graph/workers/events.worker.ts`
- `src/features/graph/workers/graph.worker.ts`
- `src/features/graph/workers/verifyWorker.ts`

Conviene usar workers para operaciones pesadas o repetidas como:

- parseo y normalizacion de eventos
- extraccion de keywords
- analisis del grafo
- preparacion del render model
- verificacion de firmas de eventos

### Export

- `src/features/graph/export/`

Esta capa ya soporta:

- snapshots congelados
- ZIP deterministico
- generacion de archivos multipart
- manifiesto y arbol de archivos
- artefactos de archivo para fotos de perfil
- empaquetado de evidencia por usuario

Si el pedido tiene que ver con evidencia descargable, procedencia o captura reproducible, conviene extender esta capa en vez de abrir una segunda via de export en otro lado.

## 5. Workflow actual del grafo

A nivel general:

1. La persona usuaria ingresa un `npub` o `nprofile`.
2. `NpubInput.tsx` valida y decodifica el puntero raiz.
3. El kernel carga el vecindario raiz desde el set activo de relays.
4. Los workers parsean eventos y calculan analisis del grafo.
5. Los slices del store reciben nodos, links, estado de relays, analisis, estado de zaps y estado de export.
6. El pipeline de render traduce esos datos a estructuras aptas para deck.gl.
7. La UI expone detalle de nodo, controles de relays, controles de render, acciones de export y diagnosticos de runtime.

Esto implica:

- la validacion vive cerca del borde input-kernel
- la sesion y el comportamiento de relays viven en el kernel
- las transformaciones costosas van en workers o analysis
- las decisiones visuales van en render y components

## 6. Fortalezas de producto que ya existen

El repo ya es fuerte en:

- descubrimiento de identidad relay-aware
- exploracion de grafo con degradacion controlada
- expansion de nodos sin perder la sesion en curso
- comparacion visual entre identidades seleccionadas
- analisis del grafo descubierto para comunidades, lideres y puentes
- lectura del grafo con soporte para zaps
- export orientado a evidencia para investigacion o demos

Para un hackathon, esta historia es bastante mas solida que presentar la app como un visor de perfiles.

## 7. Puntos seguros para extender

### Agregar una ruta nueva

Tocar:

- `src/app/<route>/page.tsx`
- `src/components/Navbar.tsx`

Sirve para:

- utilidades standalone de perfil
- workflows de badges
- visores de export

### Agregar un panel o control del lado del grafo

Tocar:

- `src/features/graph/GraphApp.tsx`
- uno o mas archivos en `src/features/graph/components/`
- el slice de store correspondiente

Sirve para:

- overlays de confianza
- paneles de explicacion
- workflows mas ricos de detalle de nodo
- controles de modo comparacion

### Agregar logica pesada de discovery o analysis

Tocar:

- `src/features/graph/kernel/`
- `src/features/graph/analysis/`
- `src/features/graph/workers/`

Sirve para:

- ranking y scoring
- heuristicas de comunidades
- completar `pathfinding`
- transformaciones de grafo mas costosas

### Agregar capacidades compartidas de cuenta

Tocar:

- `src/lib/nostr.ts`
- `src/store/auth.ts`
- `src/components/LoginModal.tsx`

Sirve para:

- nuevos flujos de auth
- helpers compartidos de publicacion
- mutaciones a nivel cuenta

## 8. Features recomendadas para seguir

Las que mejor encajan con el codebase actual son:

- overlay de confianza NIP-05 sobre nodos y detalle de nodo
- scoring de web of trust con explicacion
- overlays mas fuertes de badges y zaps dentro del analisis
- identity cards exportables para nodos seleccionados
- resumen de confiabilidad de relays ligado a confianza de discovery
- attestations externas mostradas en detalle de nodo

Feature plausible, pero todavia incompleta:

- seguimiento de `pathfinding` entre identidades

Si se avanza con eso, conviene cerrar el flujo completo:

- pedido al runtime
- estado en store
- controles de UI
- copy explicativo
- tratamiento visual de la capa

## 9. Convenciones de trabajo

- Mantener fetches async acotados por timeouts.
- Preservar la UX de estado parcial cuando los relays rinden mal.
- Reutilizar el lenguaje visual actual de La Crypta.
- Preferir extensiones dentro de `src/features/graph/` antes que rodearlo.
- No reintroducir el patron viejo de `store/nav.ts`.

## 10. Orden de lectura recomendado

Si alguien se suma al repo o hace onboarding tecnico, este orden funciona bien:

1. `src/app/page.tsx`
2. `src/features/graph/GraphClient.tsx`
3. `src/features/graph/GraphApp.tsx`
4. `src/features/graph/app/store/types.ts`
5. `src/features/graph/kernel/runtime.ts`
6. `src/features/graph/components/GraphCanvas.tsx`
7. `src/features/graph/export/types.ts`
8. `src/features/graph/analysis/types.ts`
9. `src/lib/nostr.ts`
10. `src/components/Profile.tsx`
11. `src/components/Badges.tsx`
