# Nostr Explorer

Graph-first Nostr identity explorer for La Crypta's IDENTITY Hackathon.

This repo started from the original starter kit, but the current app is no longer just a profile viewer. The home route is now an identity graph explorer with relay-aware discovery, worker-backed analysis, and auditable export.

## Routes

- `/` - Graph explorer
- `/profile` - Logged-in profile view
- `/badges` - Logged-in NIP-58 badge view

## Quick Start

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Current Features

- NIP-07, nsec, and NIP-46 bunker login
- Profile route with banner, avatar, bio, links, followers/following stats, and notes
- Badge route for NIP-58 awards
- Graph explorer with:
  - `npub` and `nprofile` root input
  - relay health and relay override controls
  - node detail panel
  - graph analysis state
  - exportable auditable snapshots
  - worker-backed processing
  - deck.gl rendering

## Stack

- Next.js 16
- React 19
- TypeScript
- Tailwind CSS v4
- NDK v3
- nostr-tools
- Zustand
- deck.gl
- Dexie
- d3-force

## Code Map

```text
src/
├── app/                  # Next.js routes
├── components/           # Shared profile/login/navbar UI
├── features/graph/       # Graph application
├── lib/                  # Shared Nostr and media helpers
├── store/                # Shared auth store
└── types/                # Browser Nostr typings
```

Graph-specific code lives under `src/features/graph/` and is split into:

- `app/store/` for Zustand slices and selectors
- `components/` for graph panels and controls
- `kernel/` for orchestration/runtime
- `nostr/` for graph transport concerns
- `render/` for rendering code
- `workers/` for heavy background work
- `export/` for deterministic snapshot packaging

## Best Hackathon Directions

This repo is especially strong for:

- web-of-trust exploration
- relay-aware identity discovery
- NIP-05 and identity verification overlays
- graph-based social analysis
- evidence/export flows for identity research

## Notes

- The old starter docs are partially outdated.
- Use [`docs/current-codebase.md`](./docs/current-codebase.md) for the adapted architecture guide.
- Use [`AGENTS.md`](./AGENTS.md) for assistant-specific coding guidance grounded in the current repo.
