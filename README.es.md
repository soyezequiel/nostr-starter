[English](./README.md) | [Espa&ntilde;ol](./README.es.md)

<div align="center">

# Nostr Espacial

### Explorador relay-aware de identidad Nostr con Sigma

[![Demo en vivo](https://img.shields.io/badge/Demo-Vercel-black?style=for-the-badge&logo=vercel)](https://nostr-en-el-espacio.vercel.app/)
[![Hackathon](https://img.shields.io/badge/La%20Crypta-IDENTITY%202026-f7931a?style=for-the-badge)](https://github.com/lacrypta/hackathons-2026)
[![Next.js](https://img.shields.io/badge/Next.js-16-111111?style=for-the-badge&logo=nextdotjs)](https://nextjs.org/)
[![Nostr](https://img.shields.io/badge/Nostr-Graph%20First-6f42c1?style=for-the-badge)](https://github.com/nostr-protocol/nostr)

[Ver demo](https://nostr-en-el-espacio.vercel.app/) - [Hackathon La Crypta](https://github.com/lacrypta/hackathons-2026) - [Arquitectura actual](./docs/current-codebase.md)

<br />

<img src="./public/graph-explorer-preview.png" alt="Captura panor&aacute;mica del explorador Sigma de Nostr Espacial" width="1040" />

<sub>Vista graph-first para explorar identidades, relaciones, capas sociales y se&ntilde;ales de confianza con lectura relay-aware.</sub>

</div>

> Proyecto participante de **IDENTITY**, el desaf&iacute;o de **abril de 2026** dentro de **Lightning Hackathons 2026** de **La Crypta**.

**Nostr Espacial** es una experiencia **graph-first** para explorar identidad en Nostr, leer contexto social y observar los zaps en vivo.

## Demo

**Deploy p&uacute;blico:** [https://nostr-en-el-espacio.vercel.app/](https://nostr-en-el-espacio.vercel.app/)

## Qu&eacute; resuelve este proyecto

- Explora vecindarios de identidad a partir de un `npub` o `nprofile`
- Descubre conexiones, mutuals y zaps en vivo
- Trabaja con relays reales, mostrando salud y cobertura parcial
- Integra informaci&oacute;n de perfiles y zaps en la lectura del grafo
- Mantiene una lectura visual clara del estado del grafo, sus capas y sus datos parciales

## Por qu&eacute; encaja bien en IDENTITY

La propuesta no se limita a "ver un perfil". El foco est&aacute; en **identidad como red**:

- identidad relacional
- se&ntilde;ales de zaps en vivo entre las conexiones presentes

## C&oacute;mo interactuar con el grafo

El explorador de identidades de Nostr Espacial ofrece varias interacciones clave para navegar la red Nostr y descubrir conexiones:

- **Expandir nodos:** Puedes expandir cualquier nodo para descubrir y cargar sus conexiones directas (follows y followers). Para hacerlo, haz **doble clic** sobre el nodo, o bien selecci&oacute;nalo y usa el bot&oacute;n de **Expandir conexiones** en el panel lateral.
- **Fijar (anclar) nodos:** Para organizar visualmente el grafo y mantener la estructura estable, puedes fijar un nodo en una posici&oacute;n de la pantalla para evitar que el motor de f&iacute;sicas lo mueva. Para anclar o desanclar un nodo, simplemente **arr&aacute;stralo y su&eacute;ltalo** libremente en el lienzo, o utiliza el bot&oacute;n de anclar en el panel del perfil seleccionado.

## Superficies del producto

| Ruta | Para qu&eacute; sirve |
| --- | --- |
| `/{locale}` | Landing de entrada con narrativa de producto y selector de idioma |
| `/{locale}/labs/sigma` | Explorador principal del grafo de identidad con Sigma y captura PNG social |
| `/{locale}/profile` | Vista cl&aacute;sica del perfil conectado |
| `/{locale}/badges` | Vista de badges NIP-58 del perfil conectado |

Locales iniciales soportados: `es`, `en`.

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

Para definir la URL can&oacute;nica usada en metadata localizada y `hreflang`, puedes configurar:

```bash
NEXT_PUBLIC_SITE_URL=https://nostr-en-el-espacio.vercel.app
```

## Internacionalizaci&oacute;n

- Las rutas p&uacute;blicas usan prefijo obligatorio de locale, por ejemplo: `/es`, `/en`, `/es/profile`.
- La resoluci&oacute;n de idioma prioriza:
  1. locale expl&iacute;cito en la URL
  2. cookie `NEXT_LOCALE`
  3. header `Accept-Language`
  4. fallback `es`
- La primera entrega traduce la landing, la navbar, el modal de login, profile, badges y la metadata p&uacute;blica.
- Sigma ya entra por rutas localizadas, pero su UI interna sigue casi igual por ahora.

### Agregar un idioma nuevo

1. Registra el locale en `src/i18n/routing.ts`.
2. Copia `messages/es/` como `messages/<nuevo-locale>/`.
3. Traduce los valores.
4. Registra ese locale en `src/i18n/messages.ts`.
5. Corre `npm run lint` y `npm run build`.

## Validaci&oacute;n

```bash
npm run lint
npm run build
npx tsx --test src/i18n/messages.test.ts src/i18n/proxy.test.ts
```

## Arquitectura r&aacute;pida

```text
src/
|-- app/                    # Rutas Next.js
|-- components/             # Navbar, login, profile, badges
|-- features/graph-v2/      # Sigma UI, dominio, proyecciones y renderer
|-- features/graph-runtime/ # Store, kernel, relays, DB, analysis y workers del grafo
|-- lib/                    # Helpers compartidos de Nostr y media
|-- store/                  # Estado compartido de autenticaci&oacute;n
`-- types/                  # Tipados
```

## Nota importante

La superficie principal del producto es el grafo Sigma en `/{locale}/labs/sigma`. `/{locale}` funciona como landing de entrada para orientar la demo y enviar a las rutas clave; `profile` sigue siendo &uacute;til, pero la historia m&aacute;s fuerte del proyecto est&aacute; en la exploraci&oacute;n de identidad y la visualizaci&oacute;n de los zaps en vivo.

## Soluci&oacute;n de problemas

Si experimentas alg&uacute;n error de sincronizaci&oacute;n, datos desactualizados o problemas al cargar el grafo de una identidad, puedes probar limpiar la cach&eacute; local. Para hacer esto, abre el selector de perfiles y haz clic en el bot&oacute;n de **Limpiar cach&eacute; local** (&iacute;cono de escoba).
