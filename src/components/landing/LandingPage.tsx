'use client'

import Image from 'next/image'
import Link from 'next/link'
import IdentityPulse from '@/components/landing/IdentityPulse'
import LandingMotionProvider from '@/components/landing/LandingMotionProvider'
import Reveal from '@/components/landing/Reveal'

const valueSignals = [
  {
    label: 'Relaciones',
    text: 'Explorá conexiones directas e indirectas entre identidades Nostr.',
  },
  {
    label: 'Relays',
    text: 'Ves qué relays respondieron y dónde todavía faltan datos.',
  },
  {
    label: 'Contexto',
    text: 'Perfiles, badges y actividad ayudan a interpretar cada nodo.',
  },
]

const technologies = [
  {
    name: 'Nostr',
    href: 'https://github.com/nostr-protocol/nips',
    text: 'Protocolo abierto para identidad, eventos y relaciones públicas.',
  },
  {
    name: 'NDK',
    href: 'https://github.com/nostr-dev-kit/ndk',
    text: 'Capa de conexión para trabajar con relays y datos Nostr.',
  },
  {
    name: 'Sigma.js',
    href: 'https://www.sigmajs.org/',
    text: 'Render WebGL para explorar grafos grandes en el navegador.',
  },
  {
    name: 'Graphology',
    href: 'https://graphology.github.io/',
    text: 'Modelo de grafo para relaciones, métricas y transformaciones.',
  },
  {
    name: 'Next.js + React',
    href: 'https://nextjs.org/',
    text: 'Base web para una interfaz rápida, tipada y mantenible.',
  },
]

const ecosystem = [
  {
    name: 'La Crypta',
    href: 'https://lacrypta.ar/',
    text: 'Comunidad que impulsa el aprendizaje y la cultura Bitcoin en Argentina.',
  },
  {
    name: 'Lightning Hackathons 2026',
    href: 'https://hackaton.lacrypta.ar/',
    text: 'Programa donde IDENTITY pone el foco en identidad, Nostr y social graph.',
  },
]

export default function LandingPage() {
  return (
    <LandingMotionProvider>
      <main className="landing-cypher min-h-screen overflow-hidden bg-[#070707] text-[#f7f5ef]">
        <section className="relative flex min-h-[92svh] flex-col overflow-hidden px-5 py-6 sm:px-8 lg:px-12">
          <IdentityPulse />

          <header className="relative z-10 flex items-center justify-between gap-6 text-sm">
            <Link
              className="font-semibold text-[#f7f5ef] underline-offset-4 hover:underline"
              href="/"
            >
              Nostr Espacial
            </Link>
            <span className="hidden text-[#b9b2aa] sm:block">
              IDENTITY / NOSTR GRAPH
            </span>
          </header>

          <div className="relative z-10 flex flex-1 items-center py-20 sm:py-24">
            <div className="max-w-5xl">
              <Reveal>
                <p className="mb-5 text-sm font-semibold uppercase text-[#ff4b5d]">
                  Cypherpunk identity lab
                </p>
                <h1 className="max-w-4xl text-5xl font-black leading-[0.95] text-[#f7f5ef] sm:text-7xl lg:text-8xl">
                  Seguí la identidad, no el perfil.
                </h1>
                <p className="mt-7 max-w-2xl text-lg leading-8 text-[#c9c2ba] sm:text-xl">
                  Un explorador visual para entender relaciones, relays y señales
                  públicas en Nostr.
                </p>
                <div className="mt-9">
                  <Link
                    className="inline-flex min-h-12 items-center justify-center rounded-md bg-[#ff4b5d] px-6 text-base font-bold text-[#080808] shadow-[0_0_44px_rgba(255,75,93,0.24)] hover:bg-[#ff6a78] focus:outline-none focus:ring-2 focus:ring-[#ff9aa4] focus:ring-offset-2 focus:ring-offset-[#070707]"
                    href="/labs/sigma"
                  >
                    Abrir grafo
                  </Link>
                </div>
              </Reveal>
            </div>
          </div>

          <div className="relative z-10 flex items-end justify-between border-t border-[#ffffff1f] pt-5 text-xs text-[#9d968e]">
            <span>Relay-aware discovery</span>
            <span className="hidden sm:inline">La red habla en conexiones</span>
          </div>
        </section>

        <section className="border-y border-[#ffffff18] bg-[#0c0c0c] px-5 py-20 sm:px-8 lg:px-12">
          <div className="mx-auto grid max-w-6xl gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:items-start">
            <Reveal>
              <p className="text-sm font-semibold uppercase text-[#ff4b5d]">
                Que abre el grafo
              </p>
              <h2 className="mt-4 max-w-xl text-4xl font-black leading-tight text-[#f7f5ef] sm:text-5xl">
                Identidad pública como red viva.
              </h2>
            </Reveal>

            <div className="divide-y divide-[#ffffff18] border-y border-[#ffffff18]">
              {valueSignals.map((signal, index) => (
                <Reveal
                  className="grid gap-3 py-7 sm:grid-cols-[11rem_1fr] sm:gap-8"
                  delay={index * 0.08}
                  key={signal.label}
                >
                  <h3 className="text-lg font-bold text-[#f7f5ef]">{signal.label}</h3>
                  <p className="max-w-2xl text-base leading-7 text-[#bdb6ad]">
                    {signal.text}
                  </p>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        <section className="relative min-h-[72svh] overflow-hidden">
          <Image
            alt="Vista abstracta del explorador de identidad Nostr"
            className="object-cover opacity-35 grayscale contrast-125"
            fill
            loading="eager"
            sizes="100vw"
            src="/graph-explorer-preview.png"
          />
          <div className="absolute inset-0 bg-[linear-gradient(90deg,#070707_0%,rgba(7,7,7,0.72)_44%,rgba(7,7,7,0.26)_100%),linear-gradient(0deg,#070707_0%,transparent_32%,#070707_100%)]" />
          <div className="relative z-10 flex min-h-[72svh] items-center px-5 py-24 sm:px-8 lg:px-12">
            <Reveal className="max-w-3xl">
              <p className="text-sm font-semibold uppercase text-[#ff4b5d]">
                Señal sobre ruido
              </p>
              <h2 className="mt-4 text-4xl font-black leading-tight text-[#f7f5ef] sm:text-6xl">
                Salimos del perfil. Lo importante es la red.
              </h2>
              <p className="mt-6 max-w-2xl text-lg leading-8 text-[#c9c2ba]">
                Entrar a Nostr Espacial es pasar del dato aislado a una lectura
                  relacional: conexiones, relaciones de n orden y filtros.
              </p>
            </Reveal>
          </div>
        </section>

        <section className="bg-[#090909] px-5 py-20 sm:px-8 lg:px-12">
          <div className="mx-auto max-w-6xl">
            <Reveal className="flex flex-col justify-between gap-5 border-b border-[#ffffff1f] pb-8 sm:flex-row sm:items-end">
              <div>
                <p className="text-sm font-semibold uppercase text-[#ff4b5d]">
                  Stack principal
                </p>
                <h2 className="mt-4 text-4xl font-black text-[#f7f5ef] sm:text-5xl">
                  Tecnología elegida por criterio.
                </h2>
              </div>
            </Reveal>

            <div className="divide-y divide-[#ffffff18]">
              {technologies.map((technology, index) => (
                <Reveal
                  className="grid gap-4 py-7 sm:grid-cols-[14rem_1fr_auto] sm:items-center"
                  delay={index * 0.06}
                  key={technology.name}
                >
                  <h3 className="text-2xl font-black text-[#f7f5ef]">
                    {technology.name}
                  </h3>
                  <p className="max-w-2xl text-base leading-7 text-[#bdb6ad]">
                    {technology.text}
                  </p>
                  <Link
                    className="w-fit rounded-md border border-[#ffffff26] px-4 py-2 text-sm font-semibold text-[#f7f5ef] hover:border-[#ff4b5d] hover:text-[#ff7885] focus:outline-none focus:ring-2 focus:ring-[#ff9aa4] focus:ring-offset-2 focus:ring-offset-[#090909]"
                    href={technology.href}
                    rel="noreferrer"
                    target="_blank"
                  >
                    Sitio
                  </Link>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        <section className="border-y border-[#ffffff18] bg-[#0c0c0c] px-5 py-20 sm:px-8 lg:px-12">
          <div className="mx-auto max-w-6xl">
            <Reveal>
              <p className="text-sm font-semibold uppercase text-[#ff4b5d]">
                Ecosistema
              </p>
              <h2 className="mt-4 max-w-3xl text-4xl font-black leading-tight text-[#f7f5ef] sm:text-5xl">
                Impulsado desde una comunidad que entiende Bitcoin y la identidad
                distribuida.
              </h2>
            </Reveal>

            <div className="mt-12 grid border-y border-[#ffffff18] lg:grid-cols-2 lg:divide-x lg:divide-[#ffffff18]">
              {ecosystem.map((item, index) => (
                <Reveal
                  className="group border-b border-[#ffffff18] py-8 last:border-b-0 lg:border-b-0 lg:p-8"
                  delay={index * 0.1}
                  key={item.name}
                >
                  <Link
                    className="block focus:outline-none focus:ring-2 focus:ring-[#ff9aa4] focus:ring-offset-2 focus:ring-offset-[#0c0c0c]"
                    href={item.href}
                    rel="noreferrer"
                    target="_blank"
                  >
                    <span className="text-3xl font-black text-[#f7f5ef] group-hover:text-[#ff7885] sm:text-4xl">
                      {item.name}
                    </span>
                    <p className="mt-5 max-w-xl text-base leading-7 text-[#bdb6ad]">
                      {item.text}
                    </p>
                  </Link>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        <footer className="bg-[#070707] px-5 py-8 sm:px-8 lg:px-12">
          <div className="mx-auto flex max-w-6xl flex-col gap-6 text-sm text-[#a9a29a] sm:flex-row sm:items-center sm:justify-between">
            <p className="font-semibold text-[#f7f5ef]">Nostr Espacial</p>
            <nav
              aria-label="Navegación secundaria"
              className="flex flex-wrap gap-x-5 gap-y-3"
            >
              <Link className="hover:text-[#ff7885]" href="/labs/sigma">
                Abrir grafo
              </Link>
              <Link className="hover:text-[#ff7885]" href="/profile">
                Perfil
              </Link>
              <Link className="hover:text-[#ff7885]" href="/badges">
                Badges
              </Link>
              <Link
                className="hover:text-[#ff7885]"
                href="https://lacrypta.ar/"
                rel="noreferrer"
                target="_blank"
              >
                La Crypta
              </Link>
              <Link
                className="hover:text-[#ff7885]"
                href="https://hackaton.lacrypta.ar/"
                rel="noreferrer"
                target="_blank"
              >
                Hackathon
              </Link>
            </nav>
          </div>
        </footer>
      </main>
    </LandingMotionProvider>
  )
}
