# AGENTS.md - Nostr Explorer for Identity Hackathon

You are helping a participant of La Crypta's IDENTITY Hackathon (April 2026).
Your goal: help them ship a polished Nostr identity project on top of this repo's current codebase, not the original starter assumptions.

## Reality Check

This repository started from the La Crypta Nostr starter, but the current app is now graph-first:

- `/` renders the identity graph explorer
- `/profile` renders the classic profile view
- `/badges` renders the NIP-58 badge view

Do not assume the old `store/nav.ts` or "single-page section switcher" flow still exists. It does not match the current code.

## What Judges Still Care About

1. Identity innovation
2. Working demo
3. UX polish
4. Protocol understanding
5. Completeness

For this repo, the strongest angle is identity graph exploration, trust signals, relay-aware discovery, and exportable evidence.

## Current Stack

- Next.js 16 + TypeScript + Tailwind CSS v4
- NDK v3 for auth, profile, badges, and relay-aware fetches
- nostr-tools for low-level NIP-19 helpers and protocol utilities
- Zustand for auth state and the graph app store
- deck.gl for graph rendering
- d3-force for graph layout work
- Dexie for client-side persistence in the graph feature
- Web Workers for graph analysis and event processing
- qrcode.react for NIP-46 bunker login

## Current Route Map

- `src/app/page.tsx`
  Home route. Loads the graph explorer client.
- `src/app/profile/page.tsx`
  Profile route. Uses the shared `Navbar` and `Profile` component.
- `src/app/badges/page.tsx`
  Badges route. Uses the shared `Navbar` and `Badges` component.

## Actual Project Structure

```text
src/
├── app/
│   ├── layout.tsx
│   ├── page.tsx
│   ├── badges/page.tsx
│   ├── profile/page.tsx
│   └── globals.css
├── components/
│   ├── Navbar.tsx
│   ├── LoginModal.tsx
│   ├── Profile.tsx
│   ├── Badges.tsx
│   └── SkeletonImage.tsx
├── features/
│   └── graph/
│       ├── GraphApp.tsx
│       ├── GraphClient.tsx
│       ├── analysis/
│       ├── app/store/
│       ├── components/
│       ├── db/
│       ├── export/
│       ├── kernel/
│       ├── nostr/
│       ├── render/
│       └── workers/
├── lib/
│   ├── media.ts
│   └── nostr.ts
├── store/
│   └── auth.ts
└── types/
    └── nostr.d.ts
```

## What's Already Built

- 3 auth methods: NIP-07, nsec, NIP-46 bunker
- Profile route with skeleton loading, social stats, notes timeline, and media normalization
- Badge route for NIP-58 award display
- Graph route with:
  - root input via `npub` or `nprofile`
  - relay health and relay override controls
  - node detail panel
  - graph analysis state
  - export flow with auditable snapshot packaging
  - layered rendering and diagnostics
  - worker-backed processing

## Working Rules for This Repo

### General

- Prefer adapting the graph explorer over bolting identity features onto the legacy profile page unless the feature is clearly profile-centric.
- Keep the La Crypta visual language already present in `globals.css` and `src/features/graph/graph.css`.
- Preserve loading, timeout, and partial-state behavior. This codebase already treats relay/network uncertainty as a first-class concern.

### Nostr and Data Fetching

- For auth, profile, badges, and generic user fetches, use `src/lib/nostr.ts`.
- Keep fetches bounded by timeouts. Reuse the existing timeout pattern rather than introducing unbounded requests.
- Reuse relay-aware behavior instead of hardcoding one relay.

### Graph Feature

- Treat `src/features/graph` as its own application slice.
- UI state belongs in the graph Zustand store under `src/features/graph/app/store`.
- Expensive processing belongs in `workers/` or `analysis/`, not inside React render paths.
- Rendering-specific code belongs in `render/`.
- Nostr transport or relay behavior specific to the graph belongs in `nostr/` or `kernel/`.
- Export logic belongs in `export/`.

### Navigation and Routes

- If you add a new top-level route, update `src/components/Navbar.tsx` and add an app route in `src/app/`.
- If you add a new graph-side panel or control, wire it through the graph store and `GraphApp.tsx`.
- Do not follow the old instruction to add sections via `store/nav.ts`; that file is not part of the current app.

## Best Feature Directions for This Codebase

These fit the current implementation better than generic starter-kit ideas:

1. NIP-05 trust overlay on graph nodes
2. Web-of-trust scoring and explanation panel
3. Follow pathfinding between identities
4. Identity card export from selected nodes
5. Badge and zap signals integrated into graph analysis
6. Compare two identities in the node detail workflow
7. Relay reliability insights tied to discovery confidence
8. External identity attestation surfaced on node detail

## File-Level Guidance

- `src/lib/nostr.ts`
  Shared auth and classic profile/badge data helpers.
- `src/store/auth.ts`
  Shared authenticated user state used by navbar/profile/badges.
- `src/features/graph/GraphApp.tsx`
  Main graph shell and panel orchestration.
- `src/features/graph/components/`
  UI controls and graph-facing panels.
- `src/features/graph/app/store/slices/`
  Graph app state organization.
- `src/features/graph/kernel/`
  App runtime and root loading orchestration.
- `src/features/graph/workers/`
  Background processing for graph/event workloads.
- `src/features/graph/export/`
  Snapshot and ZIP export pipeline.

## Practical Advice

- If the user wants a fast hackathon win, build on the graph route.
- If the user wants a simpler feature, use `/profile` or `/badges`.
- If a feature needs both, keep auth/profile in `lib/nostr.ts` and integrate derived identity insights into `features/graph`.

## Commands

```bash
npm install
npm run dev
npm run build
npm run lint
```

## Extra Repo Docs

- `README.md` gives the current product overview
- `docs/current-codebase.md` explains the real architecture and where to extend it
