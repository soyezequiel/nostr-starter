# AGENTS.md

## Purpose

Help ship the Nostr Explorer identity product for La Crypta IDENTITY Hackathon 2026. The app is now graph-first; do not follow old starter-kit assumptions.

Main product priorities:
- `/` is the identity graph explorer and primary demo surface.
- `/profile` is the classic connected-account profile view.
- `/badges` is the NIP-58 badge view.
- Preserve relay-aware discovery, partial-state UX, and auditable export behavior.

## Repo map

- `src/app/` - Next.js routes and `globals.css`.
- `src/app/page.tsx` - home route; loads the graph client.
- `src/app/profile/page.tsx`, `src/app/badges/page.tsx` - classic routes.
- `src/components/` - shared navbar, login, profile, badges, image fallback UI.
- `src/lib/nostr.ts` - shared NDK/auth/profile/badge helpers.
- `src/lib/media.ts` - shared media normalization.
- `src/store/auth.ts` - shared auth state.
- `src/features/graph/` - graph application slice.
- `src/features/graph/GraphApp.tsx` - graph shell and panel orchestration.
- `src/features/graph/app/store/` - graph Zustand store and slices.
- `src/features/graph/components/` - graph UI, canvas, panels, controls.
- `src/features/graph/kernel/` - runtime, root loading, relay/export orchestration.
- `src/features/graph/nostr/` - graph-specific relay/protocol transport.
- `src/features/graph/analysis/` - graph analysis types/helpers.
- `src/features/graph/workers/` - expensive event, graph, render, verification work.
- `src/features/graph/render/` - deck.gl model, viewport, avatar/image pipeline.
- `src/features/graph/db/` - Dexie persistence and repositories.
- `src/features/graph/export/` - deterministic snapshot/ZIP evidence packaging.
- `docs/current-codebase.md` - current architecture notes.
- `docs/avatar-pipeline-*.md` - avatar pipeline validation/troubleshooting.

## How to work in this repo

- Prefer extending the graph explorer over adding profile-page features unless the request is clearly profile-centric.
- For account/profile/badge fetches, use `src/lib/nostr.ts`.
- For graph-specific relay/session behavior, use `src/features/graph/nostr/` or `src/features/graph/kernel/`.
- Keep async Nostr fetches bounded by existing timeout patterns.
- Preserve stale, partial, timeout, and relay-failure states as user-visible UX.
- Put graph UI state in the graph store, not local component state, when it affects panels, layers, selection, export, relays, or runtime behavior.
- Keep expensive processing out of React render paths; use `workers/`, `analysis/`, `render/`, or `kernel/` as appropriate.
- If adding a top-level route, update both `src/app/<route>/page.tsx` and `src/components/Navbar.tsx`.
- If adding graph controls/panels, wire through `GraphApp.tsx` and the relevant store slice.
- If touching export, keep output deterministic, auditable, and routed through `src/features/graph/export/`.

## Commands to run

Use npm; `package-lock.json` is present.

```bash
npm install
npm run dev
npm run build
npm run lint
```

Useful targeted commands:

```bash
npm run workers:build
npm run avatar:validate -- --output tmp/avatar-current.json
npm run avatar:compare -- tmp/avatar-before.json tmp/avatar-after.json
```

Notes:
- `npm run dev`, `npm run build`, and `npm run start` rebuild graph workers via pre-scripts.
- For avatar pipeline validation, install Chromium once if needed: `npx playwright install chromium`.

## Coding conventions

- Stack: Next.js 16, React 19, TypeScript strict mode, Tailwind CSS v4, NDK v3, nostr-tools, Zustand, deck.gl, d3-force, Dexie, Web Workers, fflate.
- Use the `@/*` import alias for `src/*` when it improves clarity.
- Match existing component, store slice, kernel module, and worker patterns.
- Keep La Crypta visual language in `src/app/globals.css` and `src/features/graph/graph.css`.
- Keep protocol helpers typed and close to their owning layer.
- Prefer deterministic transforms for export and evidence code.
- Use existing media/avatar pipeline helpers instead of adding parallel image caches.

## Git & Workflow conventions

- Branch names MUST be in Argentine Spanish (español argentino). Use natural phrasing (e.g., `caracteristica/agregar-boton-piola`, `arreglo/arreglar-quilombo-de-websockets`).
- Commits MUST also be in Argentine Spanish (español argentino). Both the title and the description must be written naturally in this dialect.

## Validation / done criteria

Run the smallest checks that cover your change; explain any skipped check.

Default checks before finishing:

```bash
npm run lint
npm run build
```

Add targeted validation when relevant:
- Worker/runtime changes: `npm run workers:build` plus `npm run build`.
- Avatar/image pipeline changes: follow `docs/avatar-pipeline-validation.md`.
- Export changes: verify deterministic manifest/file output and ZIP contents.
- Relay/Nostr changes: verify timeout, stale-state, and partial-coverage behavior.
- UI changes: run the app and check `/`; also check `/profile` or `/badges` if touched.

Done means:
- The requested behavior is implemented.
- Existing graph-first flows still work.
- Relay failures and partial data do not collapse the UI.
- Relevant docs are updated when architecture, commands, validation, or user-visible workflow changes.

## Constraints / do-not rules

- Do not reintroduce the old `store/nav.ts` or single-page section switcher model.
- Do not hardcode one relay when relay-aware behavior exists.
- Do not add unbounded Nostr/network fetches.
- Do not put heavy graph analysis, event parsing, or render prep in React render paths.
- Do not treat export as a cosmetic download; it is evidence packaging.
- Do not document or demo `pathfinding` as complete unless the end-user UI workflow is verified end to end.
- Do not overwrite unrelated user changes.
- Do not modify generated or cache outputs such as `.next/`, `node_modules/`, `tsconfig.tsbuildinfo`, or temporary screenshots unless explicitly asked.

## Planning rules

- For small fixes, inspect the relevant files and implement directly.
- For multi-file or risky changes, state a short plan before editing.
- When uncertain, prefer repo docs and current code over starter assumptions.
- Choose feature directions that strengthen identity graph exploration, trust signals, relay reliability, comparison, badges/zaps in analysis, and exportable evidence.
- Ask only when the missing decision changes product behavior or risks data/protocol correctness.

## Documentation update rules

Update docs only when the change makes existing docs wrong or incomplete.

- Update `README.md` for user-facing setup, route, demo, or feature changes.
- Update `docs/current-codebase.md` for architecture, directory ownership, or workflow changes.
- Update avatar pipeline docs when image runtime, avatar cache, probe counters, or validation workflow changes.
- Update `AGENTS.md` / `CLAUDE.md` when agent instructions, commands, or repo conventions change.
