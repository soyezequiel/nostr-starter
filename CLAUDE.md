# CLAUDE.md

## Idioma

Responde siempre en español. Usa lenguaje claro y directo, evitando jerga innecesaria.
Cuando menciones términos técnicos en inglés (nombres de funciones, librerías, patrones, etc.), agrega su traducción o explicación en español entre paréntesis para que el programador entienda qué hace cada cosa. Ejemplo: "el `store` (almacén de estado)" o "`kernel` (núcleo de procesamiento del grafo)".
Si sospechás que el programador puede no saber qué es un concepto técnico (ya sea un patrón de diseño, una herramienta, un término de arquitectura, etc.), explicá brevemente qué es y para qué sirve en el contexto del proyecto, sin asumir conocimiento previo. La meta es que el programador entienda qué está haciendo y por qué, no solo que copie código.

## Project overview

Nostr Explorer is a Sigma-first identity app for La Crypta IDENTITY Hackathon 2026.

- `/` is a minimal non-graph home.
- `/labs/sigma` is the main graph product: identity graph exploration, relay-aware discovery, trust signals, and auditable export.
- `/profile` is the classic connected-account profile view.
- `/badges` is the NIP-58 badge view.
- Preserve partial relay coverage, stale graph state, timeouts, and deterministic export behavior.

## Important directories

- `src/app/` - Next.js routes.
- `src/components/` - shared navbar, login, profile, badges, image fallback UI.
- `src/lib/nostr.ts` - shared NDK/auth/profile/badge helpers.
- `src/store/auth.ts` - shared auth Zustand state.
- `src/features/graph-v2/` - Sigma UI, bridge, domain, projections and renderer.
- `src/features/graph-runtime/` - shared graph runtime used by Sigma: store, kernel, relay/protocol code, DB, analysis, export and workers.
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
- Prefer Sigma graph improvements unless the request is clearly profile- or badge-centric.
- Keep work scoped to requested files/features.
- Check git status before large edits and do not overwrite unrelated user changes.
- Explain skipped validation in the final response.

## Editing rules

- For shared auth/profile/badge fetches, use `src/lib/nostr.ts`.
- For graph relay/session behavior, use `src/features/graph-runtime/nostr/` or `src/features/graph-runtime/kernel/`.
- Put durable graph state in `src/features/graph-runtime/app/store/` when it affects layers, selection, export, relays, or runtime behavior.
- Put Sigma-only UI state in `src/features/graph-v2/ui/`.
- Put heavy work in `workers/`, `analysis/`, renderer, or `kernel/`, not React render paths.
- Add top-level routes through `src/app/<route>/page.tsx` and `src/components/Navbar.tsx`.
- Add Sigma panels/controls through `src/features/graph-v2/ui/GraphAppV2.tsx` and the relevant UI/runtime boundary.
- Keep export changes deterministic and inside `src/features/graph-runtime/export/`.
- Match the shared La Crypta visual language in `globals.css`; keep Sigma styling scoped in `graph-v2.css`.

## Validation expectations

Default before finishing, unless the user explicitly restricts validation:

```bash
npm run lint
```

Use targeted checks when relevant:
- Worker/runtime changes: `npm run workers:build`; run `npm run build` only when explicitly requested.
- Avatar/image pipeline changes: follow `docs/avatar-pipeline-validation.md`.
- Export changes: verify manifest/files/ZIP output are deterministic and auditable.
- Relay/Nostr changes: verify timeout, stale-state, and partial-coverage behavior.
- UI changes: manually check `/`; also check `/profile` or `/badges` if touched.

## Project-specific conventions

- Stack: Next.js 16, React 19, TypeScript strict, Tailwind CSS v4, NDK v3, nostr-tools, Zustand, Sigma.js, Graphology, ForceAtlas2, Dexie, Web Workers, fflate.
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
