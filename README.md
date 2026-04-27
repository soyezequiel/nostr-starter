<div align="center">

# Nostr Espacial

### Explorador relay-aware de identidad Nostr con Sigma

[![Demo en vivo](https://img.shields.io/badge/Demo-Vercel-black?style=for-the-badge&logo=vercel)](https://nostr-en-el-espacio.vercel.app/)
[![Hackathon](https://img.shields.io/badge/La%20Crypta-IDENTITY%202026-f7931a?style=for-the-badge)](https://github.com/lacrypta/hackathons-2026)
[![Next.js](https://img.shields.io/badge/Next.js-16-111111?style=for-the-badge&logo=nextdotjs)](https://nextjs.org/)
[![Nostr](https://img.shields.io/badge/Nostr-Graph%20First-6f42c1?style=for-the-badge)](https://github.com/nostr-protocol/nostr)

[Ver demo](https://nostr-en-el-espacio.vercel.app/) - [Hackathon La Crypta](https://github.com/lacrypta/hackathons-2026) - [Arquitectura actual](./docs/current-codebase.md)

<br />

<img src="./public/graph-explorer-preview.png" alt="Captura panoramica del explorador Sigma de Nostr Espacial" width="1040" />

<sub>Vista graph-first para explorar identidades, relaciones, capas sociales y senales de confianza con lectura relay-aware.</sub>

</div>

> Proyecto participante de **IDENTITY**, el desafio de **abril de 2026** dentro de **Lightning Hackathons 2026** de **La Crypta**.

**Nostr Espacial**, una experiencia **graph-first** para explorar identidad en Nostr, leer contexto social y observar los zaps en vivo.

## Demo

**Deploy publico:** [https://nostr-en-el-espacio.vercel.app/](https://nostr-en-el-espacio.vercel.app/)

## Que resuelve este proyecto

- Explora vecindarios de identidad a partir de un `npub` o `nprofile`
- Descubre conexiones, mutuals, zaps en vivo
- Trabaja con relays reales, mostrando salud, cobertura parcial
- Integra informacion como perfiles y zaps
- Mantiene una lectura visual clara del estado del grafo, sus capas y sus datos parciales
## Por que encaja bien en IDENTITY

La propuesta no se limita a "ver un perfil". El foco esta en **identidad como red**:

- identidad relacional
- senales de zaps entre los conexiones presentes


## Cómo interactuar con el grafo

El explorador de identidades de nostr espacial ofrece varias interacciones clave para navegar la red Nostr y descubrir conexiones:

- **Expandir nodos:** Puedes expandir cualquier nodo para descubrir y cargar sus conexiones directas (follows y followers). Para hacerlo, haz **doble clic** sobre el nodo, o bien selecciónalo y usa el botón de "Expandir conexiones" en el panel lateral.
- **Fijar (Anclar) nodos:** Para organizar visualmente el grafo y mantener la estructura estable, puedes "fijar" un nodo en una posición de la pantalla, evitando que el motor de físicas lo mueva. Para anclar o desanclar un nodo, simplemente **arrástralo y suéltalo** libremente en el lienzo, o utiliza el botón de anclar en el panel del perfil seleccionado.

## Superficies del producto

| Ruta | Para que sirve |
| --- | --- |
| `/` | Landing de entrada con narrativa de producto |
| `/labs/sigma` | Explorador principal del grafo de identidad con Sigma y captura PNG social |


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

## Desarrollo local

```bash
npm install
npm run dev
```

## Validacion

```bash
npm run lint
npm run build
```

## Arquitectura rapida

```text
src/
|-- app/                  # Rutas Next.js
|-- components/           # Navbar, login, profile, badges
|-- features/graph-v2/    # Sigma UI, dominio, proyecciones y renderer
|-- features/graph-runtime/ # Store, kernel, relays, DB, analysis y workers del grafo
|-- lib/                  # Helpers compartidos de Nostr y media
|-- store/                # Estado compartido de autenticacion
`-- types/                # Tipados
```
## Nota importante

La superficie principal del producto es el grafo Sigma en `/labs/sigma`. `/` funciona como landing de entrada para orientar la demo y enviar a las rutas clave; `profile` sigue siendo util, pero la historia mas fuerte del proyecto esta en la exploracion de identidad, y la visualizacion de los zaps en vivo.

## Solución de problemas

Si experimentas algún error de sincronización, datos desactualizados o problemas al cargar el grafo de una identidad, puedes probar limpiar la caché local. Para hacer esto, simplemente abre el selector de perfiles y haz clic en el botón de "Limpiar caché local" (ícono de escoba).


