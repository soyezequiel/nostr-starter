# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: graph-v2-drag-neighborhood.spec.ts >> arrastra un nodo real con influencia elastica continua al estilo Obsidian
- Location: tests\graph-v2-drag-neighborhood.spec.ts:181:5

# Error details

```
Error: No se pudo seleccionar fixture-drag-target. Ultima seleccion observada: null
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - button "Open Next.js Dev Tools" [ref=e7] [cursor=pointer]:
    - img [ref=e8]
  - alert [ref=e11]
  - main [ref=e12]:
    - generic:
      - generic [ref=e23]:
        - progressbar "40 nodos. Carga completa. 100 por ciento. 40 nodos visibles de 40 cargados; sin pendientes de dibujo." [ref=e24]
        - img [ref=e26]
        - searchbox "Buscar persona en el grafo" [ref=e29]
        - generic "40 nodos visibles de 40 cargados; sin pendientes de dibujo." [ref=e30]: 40/40 - 0 faltan
        - 'button "Cambiar identidad raiz: Root Fixture" [ref=e31] [cursor=pointer]':
          - generic [ref=e34]: RF
      - generic [ref=e36]:
        - link "Nostr Espacial" [ref=e37] [cursor=pointer]:
          - /url: /
          - img "Nostr Espacial" [ref=e39]
        - generic [ref=e40]: v0.3.2
    - text: Ajustes Notificaciones (0) Inspector de runtime (Shift + D) Pausar física Zaps Ajustar vista Relays al dia
    - navigation "Navegacion principal del grafo" [ref=e41]:
      - button "Filtros de conexiones" [ref=e42] [cursor=pointer]:
        - img [ref=e44]
        - generic [ref=e45]: Filtros
      - button "Zaps en vivo" [ref=e46] [cursor=pointer]:
        - img [ref=e48]
        - generic [ref=e50]: Zaps
      - button "Inspector de runtime" [ref=e51] [cursor=pointer]:
        - img [ref=e53]
        - generic [ref=e55]: Runtime
      - button "Ajustar vista" [ref=e56] [cursor=pointer]:
        - img [ref=e58]
        - generic [ref=e61]: Vista
      - button "Ajustes" [ref=e62] [cursor=pointer]:
        - img [ref=e64]
        - generic [ref=e67]: Ajustes
    - generic [ref=e69]:
      - generic [ref=e70]:
        - generic [ref=e71]: Nodos
        - generic [ref=e72]: "40"
      - generic [ref=e73]:
        - generic [ref=e74]: Aristas
        - generic [ref=e75]: "56"
      - generic [ref=e76]:
        - generic [ref=e77]: Visibles
        - generic [ref=e78]: "56"
      - generic [ref=e79]:
        - generic [ref=e80]: Física
        - generic [ref=e81]: activa
      - generic [ref=e82]:
        - generic [ref=e83]: Relays
        - generic [ref=e84]: 1/1
      - generic [ref=e85]:
        - generic [ref=e86]: FPS
        - generic [ref=e87]: 43 fps
    - generic [ref=e88]:
      - generic [ref=e89]:
        - generic [ref=e90]: MAPA
        - generic [ref=e91]: 0.05×
      - generic [ref=e94]:
        - button "＋" [ref=e95] [cursor=pointer]
        - button "−" [ref=e97] [cursor=pointer]
        - button "fit" [ref=e99] [cursor=pointer]
```

# Test source

```ts
  6   |   DebugDragRuntimeState,
  7   |   DebugSelectionState,
  8   |   DebugViewportPosition,
  9   | } from '../src/features/graph-v2/testing/browserDebug'
  10  | 
  11  | const SIGMA_LAB_URL = '/labs/sigma?fixture=drag-local&fixtureSource=local&testMode=1'
  12  | const TARGET_PUBKEY = 'fixture-drag-target'
  13  | const PINNED_NEIGHBOR_PUBKEY = 'fixture-pinned-neighbor'
  14  | const DEPTH1_MOVABLE_PUBKEY = 'fixture-hop1-a'
  15  | const DEPTH2_PUBKEY = 'fixture-hop2-a'
  16  | const DEPTH3_PUBKEY = 'fixture-hop3-a'
  17  | const OUTSIDE_PUBKEY = 'fixture-outside-a'
  18  | 
  19  | interface DragMetrics {
  20  |   selectedBeforeDrag: string | null
  21  |   selectedAfterDrag: string | null
  22  |   pinnedNeighborPubkey: string | null
  23  |   candidatePubkey: string | null
  24  |   degree: number | null
  25  |   cursorDistancePx: number[]
  26  |   meanDisplacements: Record<string, number>
  27  |   pinnedDisplacement: number | null
  28  |   residuals: number[]
  29  | }
  30  | 
  31  | interface SampledNodes {
  32  |   target: DebugNodePosition
  33  |   depth1: DebugNodePosition
  34  |   depth2: DebugNodePosition
  35  |   depth3: DebugNodePosition
  36  |   outside: DebugNodePosition
  37  |   pinned: DebugNodePosition
  38  | }
  39  | 
  40  | const getViewportPosition = async (page: Page, pubkey: string) =>
  41  |   page.evaluate(
  42  |     (targetPubkey) => window.__sigmaLabDebug?.getViewportPosition(targetPubkey) ?? null,
  43  |     pubkey,
  44  |   ) as Promise<DebugViewportPosition | null>
  45  | 
  46  | const getNodePosition = async (page: Page, pubkey: string) =>
  47  |   page.evaluate(
  48  |     (targetPubkey) => window.__sigmaLabDebug?.getNodePosition(targetPubkey) ?? null,
  49  |     pubkey,
  50  |   ) as Promise<DebugNodePosition | null>
  51  | 
  52  | const getNeighborGroups = async (page: Page, pubkey: string) =>
  53  |   page.evaluate(
  54  |     (targetPubkey) => window.__sigmaLabDebug?.getNeighborGroups(targetPubkey) ?? null,
  55  |     pubkey,
  56  |   ) as Promise<DebugNeighborGroups | null>
  57  | 
  58  | const getSelectionState = async (page: Page) =>
  59  |   page.evaluate(
  60  |     () => window.__sigmaLabDebug?.getSelectionState() ?? null,
  61  |   ) as Promise<DebugSelectionState | null>
  62  | 
  63  | const getDragRuntimeState = async (page: Page) =>
  64  |   page.evaluate(
  65  |     () => window.__sigmaLabDebug?.getDragRuntimeState() ?? null,
  66  |   ) as Promise<DebugDragRuntimeState | null>
  67  | 
  68  | const getFixedState = async (page: Page, pubkey: string) =>
  69  |   page.evaluate(
  70  |     (targetPubkey) => window.__sigmaLabDebug?.isNodeFixed(targetPubkey) ?? false,
  71  |     pubkey,
  72  |   ) as Promise<boolean>
  73  | 
  74  | const clickNodeUntilSelected = async (
  75  |   page: Page,
  76  |   pubkey: string,
  77  |   maxAttempts = 10,
  78  | ) => {
  79  |   const clickOffsets = [
  80  |     { x: 0, y: 0 },
  81  |     { x: 2, y: 0 },
  82  |     { x: -2, y: 0 },
  83  |     { x: 0, y: 2 },
  84  |     { x: 0, y: -2 },
  85  |     { x: 3, y: 3 },
  86  |     { x: -3, y: 3 },
  87  |     { x: 3, y: -3 },
  88  |     { x: -3, y: -3 },
  89  |   ]
  90  |   let lastSelection: DebugSelectionState | null = null
  91  | 
  92  |   for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
  93  |     const viewport = await getViewportPosition(page, pubkey)
  94  |     expect(viewport).not.toBeNull()
  95  | 
  96  |     for (const offset of clickOffsets) {
  97  |       await page.mouse.click(viewport!.clientX + offset.x, viewport!.clientY + offset.y)
  98  |       await page.waitForTimeout(80)
  99  |       lastSelection = await getSelectionState(page)
  100 |       if (lastSelection?.selectedNodePubkey === pubkey) {
  101 |         return
  102 |       }
  103 |     }
  104 |   }
  105 | 
> 106 |   throw new Error(
      |         ^ Error: No se pudo seleccionar fixture-drag-target. Ultima seleccion observada: null
  107 |     `No se pudo seleccionar ${pubkey}. Ultima seleccion observada: ${
  108 |       lastSelection?.selectedNodePubkey ?? 'null'
  109 |     }`,
  110 |   )
  111 | }
  112 | 
  113 | const distance = (left: DebugNodePosition, right: DebugNodePosition) =>
  114 |   Math.hypot(left.x - right.x, left.y - right.y)
  115 | 
  116 | const displacement = (
  117 |   baseline: DebugNodePosition,
  118 |   current: DebugNodePosition,
  119 | ) => distance(baseline, current)
  120 | 
  121 | const collectPositions = async (
  122 |   page: Page,
  123 |   pubkeys: readonly string[],
  124 | ) => {
  125 |   const entries = await Promise.all(
  126 |     pubkeys.map(async (pubkey) => [pubkey, await getNodePosition(page, pubkey)] as const),
  127 |   )
  128 | 
  129 |   return Object.fromEntries(
  130 |     entries.filter((entry): entry is readonly [string, DebugNodePosition] => Boolean(entry[1])),
  131 |   )
  132 | }
  133 | 
  134 | const meanDisplacement = (
  135 |   baseline: Record<string, DebugNodePosition>,
  136 |   current: Record<string, DebugNodePosition>,
  137 |   pubkeys: readonly string[],
  138 | ) => {
  139 |   const displacements = pubkeys
  140 |     .map((pubkey) => {
  141 |       const initial = baseline[pubkey]
  142 |       const next = current[pubkey]
  143 |       return initial && next ? distance(initial, next) : null
  144 |     })
  145 |     .filter((value): value is number => value !== null)
  146 | 
  147 |   if (displacements.length === 0) {
  148 |     return 0
  149 |   }
  150 | 
  151 |   return displacements.reduce((sum, value) => sum + value, 0) / displacements.length
  152 | }
  153 | 
  154 | const collectTrackedNodes = async (page: Page): Promise<SampledNodes> => {
  155 |   const [target, depth1, depth2, depth3, outside, pinned] = await Promise.all([
  156 |     getNodePosition(page, TARGET_PUBKEY),
  157 |     getNodePosition(page, DEPTH1_MOVABLE_PUBKEY),
  158 |     getNodePosition(page, DEPTH2_PUBKEY),
  159 |     getNodePosition(page, DEPTH3_PUBKEY),
  160 |     getNodePosition(page, OUTSIDE_PUBKEY),
  161 |     getNodePosition(page, PINNED_NEIGHBOR_PUBKEY),
  162 |   ])
  163 | 
  164 |   expect(target).not.toBeNull()
  165 |   expect(depth1).not.toBeNull()
  166 |   expect(depth2).not.toBeNull()
  167 |   expect(depth3).not.toBeNull()
  168 |   expect(outside).not.toBeNull()
  169 |   expect(pinned).not.toBeNull()
  170 | 
  171 |   return {
  172 |     target: target!,
  173 |     depth1: depth1!,
  174 |     depth2: depth2!,
  175 |     depth3: depth3!,
  176 |     outside: outside!,
  177 |     pinned: pinned!,
  178 |   }
  179 | }
  180 | 
  181 | test('arrastra un nodo real con influencia elastica continua al estilo Obsidian', async ({
  182 |   page,
  183 | }, testInfo) => {
  184 |   const metrics: DragMetrics = {
  185 |     selectedBeforeDrag: null,
  186 |     selectedAfterDrag: null,
  187 |     pinnedNeighborPubkey: null,
  188 |     candidatePubkey: null,
  189 |     degree: null,
  190 |     cursorDistancePx: [],
  191 |     meanDisplacements: {},
  192 |     pinnedDisplacement: null,
  193 |     residuals: [],
  194 |   }
  195 | 
  196 |   try {
  197 |     await page.goto(SIGMA_LAB_URL)
  198 |     await page.waitForFunction(
  199 |       () =>
  200 |         typeof window.__sigmaLabDebug !== 'undefined' &&
  201 |         window.__sigmaLabDebug !== null &&
  202 |         window.__sigmaLabDebug.findDragCandidate()?.pubkey === 'fixture-drag-target',
  203 |     )
  204 |     await expect.poll(() => getViewportPosition(page, TARGET_PUBKEY)).not.toBeNull()
  205 |     await expect.poll(() => getNodePosition(page, TARGET_PUBKEY)).not.toBeNull()
  206 | 
```