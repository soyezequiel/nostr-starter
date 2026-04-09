# Current Codebase Guide

This document adapts the original starter-kit documentation to the code that actually exists in this repository today.

## 1. What changed from the original starter

The original starter was a profile-centric app with a simple main page and a section switcher.

That is no longer true.

Today:

- the home route renders a dedicated graph application
- profile and badges moved to their own routes
- there is no `src/store/nav.ts`
- `src/features/graph/` is the main product surface
- the repo now includes analysis, export, storage, rendering, and worker layers

## 2. Route map

### `/`

Entry point:

- `src/app/page.tsx`
- `src/features/graph/GraphClient.tsx`
- `src/features/graph/GraphApp.tsx`

Purpose:

- explore a Nostr identity neighborhood from an `npub` or `nprofile`
- inspect nodes
- tune relays and rendering
- export an auditable snapshot

### `/profile`

Entry point:

- `src/app/profile/page.tsx`
- `src/components/Profile.tsx`

Purpose:

- authenticate
- load the connected user's profile
- show social stats and recent notes

### `/badges`

Entry point:

- `src/app/badges/page.tsx`
- `src/components/Badges.tsx`

Purpose:

- load NIP-58 badge awards for the connected profile

## 3. Shared app layer

### `src/lib/nostr.ts`

Use this for the classic app surfaces:

- login with extension, nsec, and bunker
- shared NDK singleton setup
- relay bootstrap and NIP-65 relay enrichment
- profile parsing
- followers/following/notes fetches

Important patterns already present:

- singleton NDK instance
- relay-aware behavior
- timeout-bounded fetches
- graceful fallback on partial failures

### `src/store/auth.ts`

Shared auth state used by:

- `Navbar`
- `Profile`
- `Badges`

It persists:

- login method
- parsed profile

## 4. Graph architecture

The graph is not just a component. It is a small client application inside the repo.

### Top-level shell

- `src/features/graph/GraphApp.tsx`

Responsibilities:

- orchestration of the graph workspace
- root input flow
- settings panels
- relay status display
- export controls
- high-level diagnostics

### State

- `src/features/graph/app/store/`

Key slices:

- `graphSlice.ts` for nodes, links, adjacency, root state
- `relaySlice.ts` for relay URLs and health
- `uiSlice.ts` for selected node, panels, render config, root loading state
- `analysisSlice.ts` for discovered graph analysis results
- `zapSlice.ts` for zap-related overlay state
- `exportSlice.ts` for deep-user selection and export progress

When adding graph features:

- put persistent UI/application state in the relevant slice
- add selectors before duplicating derivation logic in components

### Kernel and runtime

- `src/features/graph/kernel/`

This layer handles:

- root decoding and loading
- runtime orchestration
- headless execution helpers
- transcript and relay runtime concerns

If a behavior feels like "application workflow" rather than "presentational component logic", it probably belongs here.

### Transport and protocol details

- `src/features/graph/nostr/`

This layer is for graph-specific relay and transport behavior, separate from the simpler shared helpers in `src/lib/nostr.ts`.

### Rendering

- `src/features/graph/render/`

This layer owns:

- deck.gl integration
- viewport logic
- avatar/image handling
- scene geometry
- render-model payload work

Do not put render-tuning logic in unrelated UI files if it belongs here.

### Workers

- `src/features/graph/workers/`

Use this layer for heavy operations such as:

- event processing
- discovered graph analysis
- validation
- worker/browser gateway coordination

If a feature can block the main thread, consider putting it here.

### Export

- `src/features/graph/export/`

This layer already supports:

- frozen snapshots
- deterministic packaging
- ZIP generation
- manifest/file tree building
- profile photo archiving

If the user wants "download evidence", "shareable investigation package", or "auditable export", extend this layer instead of rebuilding export elsewhere.

## 5. Data flow for the graph route

At a high level:

1. The user enters an `npub` or `nprofile`.
2. `NpubInput.tsx` validates and decodes the root pointer.
3. The kernel loads the root identity and discovered neighborhood.
4. Store slices receive nodes, links, relay state, analysis, and export state.
5. Render/model code translates graph data into deck.gl-friendly structures.
6. Panels such as node detail and relay config read from the store.

That means:

- validation should stay near the root input/kernel boundary
- network and discovery workflow should stay in runtime/kernel/worker layers
- visual concerns should stay in render/components

## 6. Existing identity strengths in this repo

The codebase is already well positioned for:

- web-of-trust exploration
- relay-aware identity discovery
- visual comparison of social neighborhoods
- evidence-oriented exports
- profile and badge enrichment

This is a stronger hackathon story than treating the project as a plain profile clone.

## 7. Best places to add new features

### Add a new top-level page

Touch:

- `src/app/<route>/page.tsx`
- `src/components/Navbar.tsx`

Use this for:

- standalone profile tools
- badge workflows
- simple identity utilities

### Add a graph panel or graph control

Touch:

- `src/features/graph/GraphApp.tsx`
- one or more files in `src/features/graph/components/`
- the appropriate graph store slice

Use this for:

- trust score overlays
- compare mode
- explanation panels
- node filters

### Add heavy discovery or analysis logic

Touch:

- `src/features/graph/kernel/`
- `src/features/graph/workers/`
- `src/features/graph/analysis/`

Use this for:

- new ranking/scoring
- structural analysis
- expensive graph transforms

### Add shared Nostr account capabilities

Touch:

- `src/lib/nostr.ts`
- `src/store/auth.ts`
- `src/components/LoginModal.tsx`

Use this for:

- new auth flows
- shared publishing helpers
- account-level profile mutations

## 8. Feature ideas adapted to the current code

Instead of following the original starter ideas literally, prefer ideas that match the current architecture:

### Beginner

- NIP-05 verification badge with live validation on node detail
- identity card export from the selected node
- richer profile drawer with follow counts and relay confidence

### Intermediate

- follow pathfinding between two identities
- compare two nodes side by side
- graph filter by verified identities only

### Advanced

- web-of-trust scoring with explanation
- external identity attestations surfaced in the graph
- signed research/export package with stronger provenance metadata

## 9. Working conventions for future edits

- Keep asynchronous fetches bounded by timeouts.
- Preserve partial-state UX; relay failure should degrade gracefully.
- Reuse the existing La Crypta design language.
- Prefer extending `src/features/graph/` instead of bypassing it.
- Do not reintroduce the old `store/nav.ts` pattern.

## 10. Recommended reading order

If you are new to this repo, read files in this order:

1. `src/app/page.tsx`
2. `src/features/graph/GraphClient.tsx`
3. `src/features/graph/GraphApp.tsx`
4. `src/features/graph/app/store/types.ts`
5. `src/features/graph/kernel/`
6. `src/features/graph/workers/`
7. `src/lib/nostr.ts`
8. `src/components/Profile.tsx`
9. `src/components/Badges.tsx`
