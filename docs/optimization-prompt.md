# Prompt: auditoría y optimización de rendimiento

Copiá y pegá lo que está debajo de `---` en otro chat de Claude Code abierto en este mismo repo.

---

Sos un ingeniero de performance trabajando sobre **Nostr Explorer** (Next.js 16 + React 19 + TypeScript estricto + Zustand + Sigma.js + Graphology + ForceAtlas2 + Web Workers). El producto principal es el grafo en `/labs/sigma`. Quiero que la app se sienta **fluida** y consuma **menos CPU/GPU/memoria**.

## Tu tarea

Encontrá y aplicá **wins verificables** de rendimiento. No especules: si no podés probar el problema leyendo el código, no lo toques.

## Reglas duras

- **Verificá antes de proponer.** Cada hallazgo necesita: archivo + línea, snippet real (3–6 líneas), y por qué causa trabajo extra (no "podría ser más lento").
- **Cambios quirúrgicos.** Una a tres líneas por edit. Sin refactors grandes, sin nuevas abstracciones, sin features.
- **Respetá la arquitectura existente** (ver `CLAUDE.md`): bridge memoiza estado, FA2 ya tiene convergencia + auto-freeze, avatar scheduler tiene control de concurrencia, `dispose()` libera RAF/observers/listeners, `LegacyStoreSnapshotAdapter` cachea por revisión. **No "arregles" lo que ya está bien.**
- **No introduzcas regresiones funcionales.** Si una optimización cambia comportamiento visible (ej: ocultar labels), justificá por qué encaja con el resto del producto.
- **No toques tests `.test.ts` rotos pre-existentes** (tipos desincronizados con producción).

## Áreas con mayor probabilidad de wins

Ordenadas por impacto típico:

1. **Hot paths del renderer Sigma** (`src/features/graph-v2/renderer/SigmaRendererAdapter.ts`):
   - `nodeReducer` / `edgeReducer` corren **por nodo/arista por frame**. Spreads dobles, allocations redundantes y helpers que siempre alocan son targets.
   - Listeners de mouse/hover/drag (`moveBody`, `enterNode`) — ¿alocan por evento?
   - Settings de Sigma: `labelGridCellSize`, `labelDensity`, `labelRenderedSizeThreshold`, programs custom.
2. **React re-renders innecesarios** (`src/features/graph-v2/ui/GraphAppV2.tsx` y paneles):
   - `useSyncExternalStore` con `getSnapshot` que devuelve objetos nuevos.
   - Selectores Zustand sin `useShallow`.
   - `useMemo`/`useCallback` con deps mal armadas.
   - Props inline pasadas a hijos memoizados.
   - `setInterval` que dispara setState aunque la UI dependiente no sea visible.
3. **Workers** (`src/features/graph-runtime/workers/`, `workers/`):
   - postMessage de objetos grandes sin `transferable`.
   - Pool de verificación: tamaño según `navigator.hardwareConcurrency`.
4. **Pipeline de avatares** (`src/features/graph-v2/renderer/avatar/`):
   - Decode en main thread, retries sin backoff, cache leaks.
5. **Capa Nostr** (`src/features/graph-runtime/nostr/`):
   - Subs sin EOSE, fetches sin timeout, dedupe.

## Workflow obligatorio

Para cada candidato:

1. **Probar el problema** leyendo el código (no asumas).
2. **Decidir**: ¿es bajo riesgo? ¿impact real medible o razonado? Si dudás, no toques.
3. **Aplicar el cambio** (Edit, no Write completo).
4. **Validar**: `npm run lint`. Si tocaste workers: `npm run workers:build`. Si es UI observable, levantar preview en `/labs/sigma` y verificar consola sin errores.
5. **Reportar al usuario** con file:line del cambio y una línea explicando *por qué* mejora.

## Optimizaciones ya aplicadas (no las repitas)

Verificalas con `git log --oneline -20` antes de empezar. Si ya están, salteá:

- `hideEdgesOnMove: true` / `hideLabelsOnMove: true` en `SigmaRendererAdapter.ts` (settings de Sigma).
- Polling de `avatarPerfSnapshot` bajado de 500ms → 1000ms en `SigmaCanvasHost.tsx`.
- `applySelectedLabelVisibility` con fast-path para evitar spread cuando el input ya está en el shape destino.
- Rama no-focus de `resolveNodeHoverAttributes` consolidada en un solo spread.

## Output esperado

- Lista de hallazgos verificados con file:line + snippet + razón.
- Cambios aplicados, uno a uno, con `npm run lint` pasando entre cada batch lógico.
- Mensaje final corto (≤120 palabras) listando los cambios y por qué.

## Anti-patrón explícito a evitar

No escribas "podría haber un leak", "quizá se re-renderiza de más", "el worker pool podría escalar". Si no podés mostrar el código que lo prueba, ese hallazgo no existe. **Mejor 2 wins reales que 10 sospechas.**
