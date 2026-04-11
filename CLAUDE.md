# CLAUDE.md

## Project overview

Nostr Explorer is a graph-first identity app for La Crypta IDENTITY Hackathon 2026.

- `/` is the main product: identity graph exploration, relay-aware discovery, comparison, trust signals, and auditable export.
- `/profile` is the classic connected-account profile view.
- `/badges` is the NIP-58 badge view.
- Preserve partial relay coverage, stale graph state, timeouts, and deterministic export behavior.

## Important directories

- `src/app/` - Next.js routes.
- `src/components/` - shared navbar, login, profile, badges, image fallback UI.
- `src/lib/nostr.ts` - shared NDK/auth/profile/badge helpers.
- `src/store/auth.ts` - shared auth Zustand state.
- `src/features/graph/GraphApp.tsx` - graph app shell.
- `src/features/graph/app/store/` - graph Zustand store/slices.
- `src/features/graph/components/` - graph UI, canvas, controls, panels.
- `src/features/graph/kernel/` - graph runtime, root loading, relay/export orchestration.
- `src/features/graph/nostr/` - graph-specific relay/protocol code.
- `src/features/graph/workers/` - expensive event, graph, render, verification work.
- `src/features/graph/render/` - deck.gl render model, viewport, avatar/image pipeline.
- `src/features/graph/db/` - Dexie persistence.
- `src/features/graph/export/` - deterministic evidence snapshot/ZIP pipeline.
- `docs/current-codebase.md` - architecture reference.
- `docs/avatar-pipeline-*.md` - avatar pipeline validation/troubleshooting.

## Key commands

Use npm; `package-lock.json` is present.

```bash
npm install
npm run dev
npm run build
npm run lint
```

Targeted:

```bash
npm run workers:build
npm run avatar:validate -- --output tmp/avatar-current.json
npm run avatar:compare -- tmp/avatar-before.json tmp/avatar-after.json
```

`dev`, `build`, and `start` rebuild graph workers through npm pre-scripts. Avatar validation may require `npx playwright install chromium` once.

## Local workflow expectations

- Read current code before editing; do not rely on original starter assumptions.
- Use TodoWrite for multi-step work; skip it for small one-file fixes.
- Prefer graph-route improvements unless the request is clearly profile- or badge-centric.
- Keep work scoped to requested files/features.
- Check git status before large edits and do not overwrite unrelated user changes.
- Explain skipped validation in the final response.

## Editing rules

- For shared auth/profile/badge fetches, use `src/lib/nostr.ts`.
- For graph relay/session behavior, use `src/features/graph/nostr/` or `src/features/graph/kernel/`.
- Put graph UI state in `src/features/graph/app/store/` when it affects panels, layers, selection, export, relays, or runtime behavior.
- Put heavy work in `workers/`, `analysis/`, `render/`, or `kernel/`, not React render paths.
- Add top-level routes through `src/app/<route>/page.tsx` and `src/components/Navbar.tsx`.
- Add graph panels/controls through `GraphApp.tsx`, `src/features/graph/components/`, and the relevant store slice.
- Keep export changes deterministic and inside `src/features/graph/export/`.
- Match the existing La Crypta visual language in `globals.css` and `graph.css`.

## Validation expectations

Default before finishing:

```bash
npm run lint
npm run build
```

Use targeted checks when relevant:
- Worker/runtime changes: `npm run workers:build` plus `npm run build`.
- Avatar/image pipeline changes: follow `docs/avatar-pipeline-validation.md`.
- Export changes: verify manifest/files/ZIP output are deterministic and auditable.
- Relay/Nostr changes: verify timeout, stale-state, and partial-coverage behavior.
- UI changes: manually check `/`; also check `/profile` or `/badges` if touched.

## Project-specific conventions

- Stack: Next.js 16, React 19, TypeScript strict, Tailwind CSS v4, NDK v3, nostr-tools, Zustand, deck.gl, d3-force, Dexie, Web Workers, fflate.
- Use `@/*` for `src/*` imports when helpful.
- Treat relay failure and partial data as normal UI states.
- Treat export as evidence packaging, not a convenience download.
- Preserve existing timeout and relay-aware fetch patterns.
- Prefer deterministic transforms for analysis/export artifacts.

## Common pitfalls

- Do not reintroduce `store/nav.ts` or a single-page section switcher.
- Do not hardcode one relay when relay-aware behavior exists.
- Do not add unbounded Nostr/network fetches.
- Do not market `pathfinding` as finished unless the end-user workflow is verified end to end.
- Do not modify generated/cache output such as `.next/`, `node_modules/`, `tsconfig.tsbuildinfo`, or temporary screenshots unless asked.
- Do not create a second avatar cache or export pipeline when existing ones can be extended.

## When to ask / when to proceed

- Proceed when the requested behavior maps clearly to existing routes, graph slices, kernel modules, or docs.
- Ask only when a missing decision changes product behavior, protocol correctness, data persistence, or export evidence semantics.
- If a command fails because of environment setup, report the command and failure; do not silently skip it.

## Lightweight checklist before finishing

- Behavior implemented and scoped.
- Relevant route checked.
- `npm run lint` and `npm run build` run, or skipped with reason.
- Relay/partial-state/export implications considered when touched.
- Docs updated if commands, architecture, validation, or user-visible workflows changed.
