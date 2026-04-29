[English](./README.md) | [Espa&ntilde;ol](./README.es.md)

<div align="center">

# Nostr Espacial

### Relay-aware Nostr identity explorer powered by Sigma

[![Live Demo](https://img.shields.io/badge/Demo-Vercel-black?style=for-the-badge&logo=vercel)](https://nostr-en-el-espacio.vercel.app/)
[![Hackathon](https://img.shields.io/badge/La%20Crypta-IDENTITY%202026-f7931a?style=for-the-badge)](https://github.com/lacrypta/hackathons-2026)
[![Next.js](https://img.shields.io/badge/Next.js-16-111111?style=for-the-badge&logo=nextdotjs)](https://nextjs.org/)
[![Nostr](https://img.shields.io/badge/Nostr-Graph%20First-6f42c1?style=for-the-badge)](https://github.com/nostr-protocol/nostr)

[View demo](https://nostr-en-el-espacio.vercel.app/) - [La Crypta Hackathon](https://github.com/lacrypta/hackathons-2026) - [Current architecture (Spanish)](./docs/current-codebase.md)

<br />

<img src="./public/graph-explorer-preview.png" alt="Panoramic preview of the Nostr Espacial Sigma explorer" width="1040" />

<sub>A graph-first view for exploring identities, relationships, social layers, and trust signals with relay-aware reads.</sub>

</div>

> Project submitted to **IDENTITY**, the **April 2026** challenge within **Lightning Hackathons 2026** by **La Crypta**.

**Nostr Espacial** is a **graph-first** experience for exploring identity in Nostr, reading social context, and watching live zaps as they happen.

## Demo

**Public deploy:** [https://nostr-en-el-espacio.vercel.app/](https://nostr-en-el-espacio.vercel.app/)

## What this project solves

- Explore identity neighborhoods starting from an `npub` or `nprofile`
- Discover connections, mutuals, and live zaps
- Work against real relays while exposing relay health and partial coverage
- Integrate profile and zap information into the graph reading
- Keep the graph state, its layers, and partial data visually understandable

## Why it fits IDENTITY

The proposal does not stop at "viewing a profile". The core idea is **identity as a network**:

- relational identity
- live zap signals between the connections currently in view

## How to interact with the graph

The Nostr Espacial identity explorer offers a few core interactions to navigate the Nostr network and discover relationships:

- **Expand nodes:** Expand any node to discover and load its direct connections (follows and followers). You can do this by **double-clicking** the node, or by selecting it and using the **Expand connections** button in the side panel.
- **Pin nodes:** To keep the graph visually stable while you inspect it, you can pin a node to a screen position so the physics engine does not move it. To pin or unpin a node, simply **drag and drop** it on the canvas, or use the pin button in the selected profile panel.

## Product surfaces

| Route | Purpose |
| --- | --- |
| `/{locale}` | Entry landing page with product narrative and language switcher |
| `/{locale}/labs/sigma` | Main identity graph explorer powered by Sigma, plus social PNG capture |
| `/{locale}/profile` | Classic connected-account profile view |
| `/{locale}/badges` | Connected-account NIP-58 badges view |

Initial supported locales: `es`, `en`.

## Stack

- Next.js 16
- React 19
- TypeScript
- Tailwind CSS v4
- NDK v3
- nostr-tools
- Zustand
- Sigma.js
- Graphology
- ForceAtlas2
- Dexie
- Web Workers
- qrcode.react
- fflate

## Local development

```bash
npm install
npm run dev
```

To define the canonical URL used in localized metadata and `hreflang`, configure:

```bash
NEXT_PUBLIC_SITE_URL=https://nostr-en-el-espacio.vercel.app
```

## Internationalization

- Public routes use a required locale prefix, for example: `/es`, `/en`, `/es/profile`.
- Locale resolution follows this priority:
  1. explicit locale in the URL
  2. `NEXT_LOCALE` cookie
  3. `Accept-Language` header
  4. `es` fallback
- The first delivery translates the landing page, navbar, login modal, profile view, badges view, and public metadata.
- Sigma already enters through localized routes, but its internal UI is still largely unchanged for now.

### Add a new language

1. Register the locale in `src/i18n/routing.ts`.
2. Copy `messages/es/` to `messages/<new-locale>/`.
3. Translate the values.
4. Register the locale in `src/i18n/messages.ts`.
5. Run `npm run lint` and `npm run build`.

## Validation

```bash
npm run lint
npm run build
npx tsx --test src/i18n/messages.test.ts src/i18n/proxy.test.ts
```

## Architecture snapshot

```text
src/
|-- app/                    # Next.js routes
|-- components/             # Navbar, login, profile, badges
|-- features/graph-v2/      # Sigma UI, domain, projections, and renderer
|-- features/graph-runtime/ # Store, kernel, relays, DB, analysis, and graph workers
|-- lib/                    # Shared Nostr and media helpers
|-- store/                  # Shared auth state
`-- types/                  # Type definitions
```

## Important note

The main product surface is the Sigma graph at `/{locale}/labs/sigma`. `/{locale}` acts as the public landing page that frames the demo and routes people into the key surfaces; `profile` is still useful, but the strongest story in this project is identity exploration plus live zap visualization.

## Troubleshooting

If you run into sync errors, stale data, or issues loading the graph for an identity, try clearing the local cache. Open the profile selector and click the **Clear local cache** button (broom icon).
