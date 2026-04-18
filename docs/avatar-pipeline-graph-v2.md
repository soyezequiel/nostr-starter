# Avatar pipeline for graph-v2 (Sigma overlay)

Nostr avatars are painted on top of Sigma nodes in `/labs/sigma`, tuned for
low-end mobile. The implementation uses a canvas 2D overlay because the repo
does not include a ready-made Sigma image-node program; a custom WebGL program
would require shader and texture-atlas work that is not justified for the
current 50-500 node target.

## Modules (`src/features/graph-v2/renderer/avatar/`)

- `types.ts` - `AvatarEntry`, `AvatarBudget`, `DeviceTier`,
  `DEFAULT_BUDGETS`.
- `avatarBitmapCache.ts` - LRU keyed by `pubkey::url`. Stores `ImageBitmap` or
  `HTMLCanvasElement`. Produces a monogram `HTMLCanvasElement` per pubkey as
  fallback, bounded by an LRU cap tied to the image cache. Calls
  `ImageBitmap.close()` on eviction.
- `avatarLoader.ts` - `fetch` + `createImageBitmap` downscale to LOD bucket
  (off-main-thread) + circular composite via `OffscreenCanvas`. Rejects unsafe
  URLs; merges external `AbortSignal` with an 8s timeout. Maintains a blocklist
  with configurable TTL. Timeouts are treated as failures so they do not spin
  in a retry loop. If the CORS fetch path fails, it falls back to
  `HTMLImageElement` loading so avatars from image hosts without CORS can still
  render.
- `avatarScheduler.ts` - Accepts a visible-candidate list per frame. Enforces
  concurrency cap. Aborts in-flight loads for pubkeys that left the viewport.
  Marks `failed` and blocklists on error. Signals the adapter when a load
  settles so Sigma repaints and the next queued candidates can start even if
  physics is idle.
- `avatarOverlayRenderer.ts` - Hooks `sigma.on('afterRender', ...)`, draws on
  the `labels` 2D canvas. It culls by viewport/size, prioritizes visible nodes,
  then applies per-frame draw caps before painting. Nodes past the avatar cap
  fall back to Sigma's WebGL circle; nodes past the photo cap keep the monogram
  instead of the heavier image. Feeds `PerfBudget.recordFrame` with the
  inter-frame delta and applies the current LRU cap from the performance budget.
  It uses Sigma's
  `framedGraphToViewport` and `scaleSize` APIs so the avatar center and radius
  match the WebGL node, with a 1px inset to avoid bleeding outside the node.
- `deviceTier.ts` - Classifies `low | mid | high` from
  `hardwareConcurrency`, `deviceMemory`, `connection.effectiveType`,
  `saveData`, and UA.
- `perfBudget.ts` - EMA of frame time. Downgrades the tier after 2s above
  40ms; upgrades after 5s below 18ms. Falls back to per-field overrides once
  the lowest tier is reached.

## Integration

`SigmaRendererAdapter.mount` instantiates the pipeline and binds motion
tracking. `dispose` tears it down, closing bitmaps and clearing timers.

Motion is marked in three places:

1. Any `camera.updated` event (pan, zoom, inertia).
2. Any drag `flushPendingDragFrame`.
3. `startDrag`.

`/labs/sigma` exposes a Render / Avatares checkbox to control whether avatars
are hidden while the camera or drag interaction is moving. The default is off
so avatars stay visible during interaction. When enabled and `motionActive` is true, the overlay
short-circuits before iterating the graph. When the debounce timer expires
(`MOTION_RESUME_MS = 140`) we call `sigma.refresh()` once to force a paint that
includes the avatars again.

The same panel exposes two live thresholds:

- `Radio minimo`: minimum on-screen avatar radius in pixels. Below this, the
  overlay does not draw the avatar. Default: `15px`.
- `Zoom max`: maximum Sigma camera ratio for enqueueing new avatar loads.
  Raising it loads avatars farther into zoom-out; lowering it protects network
  and decode work. Default: `2.10x`.
- `Monograma si se mueve rapido`: per-node option that temporarily replaces a
  cached photo with the monogram when that node's screen velocity exceeds the
  configured `Velocidad max`. Camera movement is ignored so this does not
  duplicate the global hide-on-pan/zoom option.

The panel also shows an adaptive debug block. It reports whether the avatar
budget is running at its base device tier or has been downgraded (`degradado a
low/mid/high`), plus the frame EMA, load concurrency, max image bucket, and LRU
cap currently applied by `PerfBudget`. It also shows the avatar/photo draw caps
that protect the frame loop when many profile images are already cached, plus
the effective radius/zoom thresholds after adaptive limits are applied.

## Performance strategy

- **Optional hide-on-move**: disabled by default so avatars stay visible while
  panning or dragging. Users can enable it in `/labs/sigma` for 0
  avatar-overlay work per frame during interaction.
- **Live thresholds**: `/labs/sigma` can adjust the minimum draw radius and
  maximum load zoom at runtime without recreating Sigma or restarting FA2.
- **Per-node motion fallback**: when enabled, fast-moving nodes use monograms
  and skip new avatar load enqueueing until their screen velocity drops below
  the configured threshold.
- **Visible adaptive state**: `/labs/sigma` polls the renderer budget at a
  low cadence and shows the current tier/debug values without subscribing React
  to the per-frame render loop.
- **Per-frame draw caps**: the overlay limits total avatar draws and real-photo
  draws separately. Prioritization keeps root, selected, neighbors, and nodes
  closer to the viewport center first. Overflow nodes degrade to monograms or
  pure Sigma circles instead of spending unbounded `drawImage` work.
- **Adaptive thresholds still win under pressure**: runtime sliders remain live,
  but when the budget is degraded or running at the smallest image bucket, the
  renderer can raise the effective minimum radius and lower the effective load
  zoom to protect the frame loop.
- **Size threshold + viewport cull**: nodes smaller than the threshold or
  outside the container rect are skipped before any cache lookup.
- **Zoom threshold**: no load is enqueued when `cameraRatio >
  budget.zoomThreshold`.
- **Pre-rendered circular bitmap**: no `ctx.clip()` in the hot path. One
  `drawImage` per node per frame.
- **Same transform as Sigma**: avatar overlay uses the same viewport transform
  and size scaling as Sigma labels/hover, then draws with a small inset so the
  image never extends beyond the node circle.
- **`createImageBitmap` downscale**: never hold full-res bytes in memory.
- **No-CORS image fallback**: avatars first try the efficient fetch/decode path;
  if the host blocks CORS, the loader falls back to regular browser image
  loading and still composes a circular cached bitmap.
- **LOD bucket hysteresis**: reuses existing `applyImageBucketHysteresis` to
  avoid thrashing on zoom wiggles.
- **LRU eviction with `ImageBitmap.close()`**: bounded VRAM.
- **Bounded monogram cache**: fallback canvases are also LRU capped so long
  sessions do not grow without limit.
- **Adaptive degradation**: `PerfBudget` downgrades tier and eventually
  per-field overrides if the EMA frame time rises above 40ms.

## Tests (`node:test` + `tsx`)

Run the suite with:

```bash
npx tsx --test src/features/graph-v2/renderer/avatar/*.test.ts
```

Covered:

- `deviceTier`: 6 scenarios across low/mid/high + missing navigator.
- `perfBudget`: init, downgrade, upgrade, brief spike, disable/enable, NaN.
- `avatarLoader`: blocklist lifecycle, TTL, unblock, rejection of unsafe URLs.
- `avatarBitmapCache`: bitmap close-on-evict and bounded monogram LRU.

Not covered with unit tests because they depend on Sigma/browser rendering:
`avatarScheduler` and `avatarOverlayRenderer`. These require manual browser
validation below.

## Pending validation on a real device

The Samsung S21 target has not been validated end to end. To validate:

1. Load `/labs/sigma` with a real kind-0-enriched root that yields 200-500
   visible nodes with `pictureUrl` set.
2. Measure FPS during idle, pan, zoom, drag, and sustained FA2 simulation.
   Target: >=30 fps idle, >=24 fps during drag.
3. Inspect VRAM / heap after 5 min of continuous navigation; verify the LRU
   cap holds and no unbounded growth occurs.
4. Test with relays that serve large or slow images; verify concurrency cap and
   blocklist keep the main thread responsive.
5. Check fallback path on a WebView that lacks `createImageBitmap` - monogram
   should stay visible and no console errors should fire.
6. Verify hover, drag, selection, physics, and export remain unaffected.
