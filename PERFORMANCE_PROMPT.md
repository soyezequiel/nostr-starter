# Prompt de optimización de performance — Nostr Explorer

> Generado a partir del análisis de un Chrome Performance Trace real (2026-04-11).
> Usar este prompt completo como contexto inicial en una sesión de optimización.

---

## Contexto del proyecto

Nostr Explorer es una app Next.js 16 / React 19 que renderiza grafos de identidades
Nostr usando deck.gl (WebGL) + d3-force en el layout, con web workers para análisis
de grafo y verificación de firmas, y Dexie/IndexedDB para persistencia local.

El código vive en `src/features/graph/`. Los archivos críticos para performance son:

- `src/features/graph/components/GraphCanvas.tsx` — render principal
- `src/features/graph/render/DeckGraphRenderer.tsx` — deck.gl
- `src/features/graph/render/buildGraphRenderModel.ts` — d3-force layout
- `src/features/graph/render/imageRuntime.ts` — carga de avatares
- `src/features/graph/workers/` — pool de workers
- `src/features/graph/nostr/relay-adapter.ts` — relay pool

---

## Hallazgos del trace (métricas reales)

| Métrica | Valor |
|---|---|
| Duración total del trace | ~30 segundos |
| Frames totales | 1.518 |
| **Frames dropped (>16.67ms)** | **225 / 15%** |
| **Frames muy lentos (>100ms)** | **31** |
| Frame más lento | **386.8ms** (luma.gl `_animationFrame`) |
| Gap máximo entre frames | **981ms** |
| GC total | **2.746ms — 18.242 eventos** |
| PostMessage overhead | **1.560ms — 1.002 mensajes** |
| Input event latency (max) | **45ms** (EventDispatch) |
| nostr-tools en main thread | **3.544ms** de FunctionCall |
| TimerFire total | **948ms — 478 timers** |
| RunMicrotasks total | **4.417ms — 3.369 checkpoints** |
| GPU tasks | **1.401ms — 3.366 tareas, max 57ms** |
| verify.worker.js | **723ms** |

---

## Cuellos de botella identificados — ordenados por impacto

### 🔴 1. Un solo frame de 386ms en luma.gl (CRÍTICO)

**Síntoma:** `FireAnimationFrame → _animationFrame` en
`node_modules/@luma_gl/engine` tomó 386.8ms bloqueando el main thread.
Esto causa el frame gap de 981ms y es la causa principal de los 31 frames >100ms.

**Causa probable:** luma.gl llama `requestAnimationFrame` y en ese callback hace
el render completo de deck.gl incluyendo layout d3-force, reconstrucción del modelo
de render, y posiblemente carga de imágenes — todo sincrónico en un frame.

**Fix requerido:**
- Separar el pipeline: **layout → postMessage → render** deben ocurrir en
  distintos frames/ticks, nunca todo en un RAF.
- En `DeckGraphRenderer.tsx`: asegurarse de que el render model llega ya
  construido desde el worker; el RAF de luma.gl solo debe hacer el draw call.
- Habilitar `useDevicePixels: false` en dispositivos de bajo rendimiento para
  reducir el trabajo de rasterización.
- Considerar `deck.gl` `onBeforeRender` / `onAfterRender` hooks para medir y
  saltear frames cuando la escena no cambió (`isDirty` flag).
- Usar `AnimationLoop.stop()` cuando el grafo está estático y reanudar solo
  al interactuar o al llegar datos nuevos del worker.

---

### 🔴 2. Worker PostMessage: 126–153ms por mensaje (CRÍTICO)

**Síntoma:** `HandlePostMessage` tomó 153ms y 126ms en la respuesta del
`graph.worker.js`. Son los mensajes de respuesta al main thread con el render model.

**Causa:** El worker serializa el `GraphRenderModel` completo a JSON en cada
actualización. Con grafos grandes (>500 nodos) el payload puede ser varios MB,
y la serialización + deserialización bloqueante toma 100ms+.

**Fix requerido:**
- Usar **Transferable objects** (`ArrayBuffer`) para los arrays de posiciones,
  colores y tamaños de nodos/edges. Cambiar los arrays tipados en
  `renderModelPayload.ts` a `Float32Array` / `Uint32Array` y transferirlos
  con `postMessage(msg, [msg.positions.buffer, msg.colors.buffer, ...])`.
- Enviar **diffs incrementales** en vez del modelo completo: solo los nodos/edges
  que cambiaron posición en la iteración de simulación.
- En `renderModelWorker.ts`: implementar un flag `hasConverged` — cuando d3-force
  converge (alpha < 0.001), detener los mensajes de actualización hasta que haya
  un cambio de datos.

---

### 🔴 3. nostr-tools `_onmessage` en el main thread: 3.544ms (CRÍTICO)

**Síntoma:** El handler de mensajes WebSocket de nostr-tools (`_onmessage`) corre
en el main thread y acumula 3.544ms de tiempo de CPU durante el trace.

**Causa:** `relay-transport.ts` instancia las conexiones WebSocket directamente
en el renderer process. Cada evento Nostr que llega (kind 3, profiles, zaps)
invoca callbacks en el main thread, bloqueando potencialmente el render loop.

**Fix requerido:**
- Mover toda la lógica de relay WebSocket a un **dedicated worker**
  (`relay.worker.ts`). El main thread solo recibe eventos ya procesados via
  postMessage batched.
- Si mover el relay completo es muy invasivo: al menos hacer batch de los eventos
  recibidos y procesarlos en `requestIdleCallback` en lugar de procesar
  sincrónico en el callback de WebSocket.
- En `relay-adapter.ts`: agregar un buffer de eventos con flush periódico
  (ej. cada 100ms) usando `setTimeout(flush, 100)` en lugar de emitir
  sincrónico por cada evento.

---

### 🟠 4. Input event latency de 30–45ms

**Síntoma:** `EventDispatch` / `WebFrameWidgetImpl::HandleInputEvent` toma
hasta 45ms. Con 141 eventos de input procesados, el total es 3.613ms.

**Causa:** Handlers de mouse/touch sobre el canvas de deck.gl disparan trabajo
React (store updates, selectors) sincrónico en el event handler.

**Fix requerido:**
- Marcar los event listeners del canvas como **passive** donde no se necesite
  `preventDefault()`. En `DeckGraphRenderer.tsx` / `DeckGL` props:
  ```ts
  eventRecognizerOptions={{ pan: { enable: false } }} // si pan lo maneja deck.gl
  ```
- Debounce de hover: el `onHover` de deck.gl está probablemente disparando
  zustand mutations en cada pixel. Usar `useRef` para el hover state y solo
  actualizar el store cada 16ms (throttle con RAF).
- En `GraphCanvas.tsx`: el selector zustand que reacciona a hover debe usar
  `shallow` equality y un `debounce` de al menos 50ms antes de actualizar
  `nodeDetailPanel`.

---

### 🟠 5. Presión de GC: 18.242 eventos, 2.746ms total

**Síntoma:** El GC corre constantemente (18k+ eventos), con major GC de hasta 17ms.
Esto indica churning de objetos — muchos objetos de corta vida creados y descartados.

**Causas probables:**
- En `buildGraphRenderModel.ts`: cada frame de simulación d3-force probablemente
  crea nuevos arrays de nodos/edges en lugar de mutar los existentes.
- En `imageRuntime.ts` / `avatarAtlasManager.ts`: creación frecuente de objetos
  de tarea de imagen.
- En `relay-adapter.ts`: cada evento Nostr crea nuevos objetos JS.

**Fix requerido:**
- **Object pooling** en el render model: pre-alocar arrays del tamaño máximo
  esperado y reusar. En lugar de `nodes.map(n => ({...}))`, mutar un array
  existente con índices.
- En `buildGraphRenderModel.ts`: usar `Float32Array` pre-alocado para posiciones
  y actualizar valores en lugar de recrear el array.
- Audit de `relay-adapter.ts`: usar un pool de objetos Event para no crear
  `{id, pubkey, kind, ...}` desde cero con cada mensaje WebSocket.

---

### 🟡 6. `scheduleImageFrameRefresh` — 58.7ms en un solo call

**Síntoma:** `GraphCanvas.useCallback[scheduleImageFrameRefresh]` tomó 58.7ms.
Aparece también con 28.7ms. Hay un timer de 58.9ms que probablemente es este.

**Causa:** Al actualizar el atlas de avatares, el callback está forzando una
recarga de todas las texturas o reconstruyendo el atlas completo en un tick.

**Fix requerido:**
- En `imageRuntime.ts`: usar **IntersectionObserver** o visibilidad de nodos
  para cargar avatares solo cuando el nodo está visible en el viewport actual.
- Carga incremental: máximo 5–10 avatares nuevos por frame, no todos a la vez.
- Separar el "schedule" del "execute": el schedule solo debe anotar qué nodos
  necesitan imagen; el execute ocurre en el siguiente RAF idle.
- En desktop: pre-cargar avatares en background. En mobile: solo cargar cuando
  el nodo tiene un radio > 8px en pantalla.

---

### 🟡 7. 596 UpdateLayoutTree (style recalcs) — 71ms total

**Síntoma:** Hay 596 recálculos de CSS durante el trace. Aunque el total es
manejable (71ms), la frecuencia indica re-renders React innecesarios.

**Causa:** Algún componente está actualizando estado con alta frecuencia,
forzando re-renders que tocan el DOM.

**Fix requerido:**
- Auditar con React DevTools Profiler qué componentes re-renderizan más.
- Sospechosos principales: `RelayHealthIndicator` (probablemente actualiza
  con cada evento de relay), `PerfOverlay` (si está activo, actualiza ~60fps),
  `NodeExpansionProgressCard`.
- Usar `useDeferredValue` para el estado de relay health si no requiere
  respuesta inmediata.
- Asegurarse que `PerfOverlay` esté desactivado en producción o use
  `requestAnimationFrame` con throttle.

---

### 🟡 8. TimerFire: 478 timers, 948ms total, max 58ms

**Síntoma:** Hay 478 disparos de timer en 30 segundos. El máximo de 58ms
coincide con `scheduleImageFrameRefresh`.

**Fix requerido:**
- Auditar todos los `setTimeout` / `setInterval` en el codebase.
- Reemplazar `setInterval` para polling con `requestIdleCallback` o
  suscripciones a eventos.
- El timer de 58ms max: identificar si es el image refresh y aplicar fix #6.
- En `relay-adapter.ts`: el "grace period" de 250ms usa `setTimeout` — asegurar
  que no se acumula (clearTimeout antes de re-schedule).

---

## Optimizaciones específicas para móvil

El trace fue grabado en desktop (DPR=1). En móvil los problemas se multiplican:

### Límites adaptativos recomendados

```ts
// En devicePerformance.ts — revisar y ajustar estos valores:
const DEVICE_CAPS = {
  desktop:         { maxNodes: 2000, maxEdges: 8000, avatarQuality: 'high',   dpr: devicePixelRatio },
  mobile:          { maxNodes: 300,  maxEdges: 1200, avatarQuality: 'medium', dpr: 1 },
  'low-end-mobile':{ maxNodes: 100,  maxEdges: 400,  avatarQuality: 'low',    dpr: 1 },
}
```

### Touch handling
- Agregar `touch-action: none` en el CSS del canvas para prevenir el scroll
  del browser compitiendo con deck.gl.
- Usar `pointer events` en lugar de separar mouse/touch handlers.
- Aumentar el radio de hit-testing de nodos en móvil (mínimo 44px touch target).

### Reducir trabajo por frame en móvil
- Target de 30fps en mobile (`AnimationLoop` con `useDevicePixels: false`).
- Pausar la simulación d3-force después de 2 segundos de inactividad en mobile.
- No renderizar labels en móvil si hay >50 nodos visibles.
- Usar `ScatterplotLayer` sin `IconLayer` (sin avatares) en low-end mobile.

### Carga inicial
- En mobile: cargar máximo 1 relay en la conexión inicial.
- Mostrar skeleton/placeholder inmediato antes de cualquier fetch Nostr.
- Usar `priority: 'low'` para avatares fuera del viewport inicial.

---

## Orden de implementación recomendado

1. **[MAYOR IMPACTO]** Fix worker PostMessage con Transferables — reduce 126-153ms → <5ms
2. **[MAYOR IMPACTO]** Separar el pipeline RAF: render model pre-construido en worker, RAF solo hace draw — elimina el frame de 386ms
3. **[ALTO IMPACTO]** Batch y mover nostr-tools a worker o idle callback — recupera 3.5s de CPU
4. **[ALTO IMPACTO]** Pasive listeners + debounce hover — reduce input latency de 45ms → <5ms
5. **[MEDIO]** Object pooling en render loop — reduce GC de 2.7s
6. **[MEDIO]** Límites adaptativos por dispositivo en devicePerformance.ts
7. **[MEDIO]** Fix scheduleImageFrameRefresh incremental
8. **[BAJO]** Audit de style recalcs con React Profiler

---

## Métricas objetivo post-fix

| Métrica | Actual | Target desktop | Target mobile |
|---|---|---|---|
| Frames dropped | 15% | <5% | <10% |
| Frame más lento | 386ms | <50ms | <80ms |
| Input latency | 45ms | <10ms | <16ms |
| Worker PostMessage | 126–153ms | <10ms | <10ms |
| GC total (30s) | 2.746ms | <500ms | <300ms |
| FPS promedio | ~50fps efectivo | 60fps | 30fps estable |

---

## Instrucciones para el agente de implementación

Sos un agente de performance especializado en apps React/WebGL. Tu tarea es
implementar las optimizaciones listadas arriba en orden de impacto.

**Reglas:**
- Leer cada archivo antes de modificarlo
- No agregar abstracciones nuevas innecesarias
- No cambiar la API pública del kernel (`facade.ts`)
- No cambiar el schema de Dexie (migrations son costosas)
- Para cada cambio: medir impacto antes y después con `performance.mark()`
- En cada archivo modificado: dejar un comentario `// PERF: <descripción>`
  para tracking

**Empezar por:**
1. Leer `src/features/graph/render/renderModelPayload.ts`
2. Leer `src/features/graph/render/renderModelWorker.ts`
3. Leer `src/features/graph/workers/graph/handlers.ts`
4. Implementar Transferables en el postMessage entre graph.worker y main thread
5. Agregar `hasConverged` flag para detener mensajes cuando d3-force converge
