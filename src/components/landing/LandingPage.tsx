'use client'

import Image from 'next/image'
import Link from 'next/link'
import IdentityPulse from '@/components/landing/IdentityPulse'
import LandingMotionProvider from '@/components/landing/LandingMotionProvider'
import OrangeSurprise from '@/components/landing/OrangeSurprise'
import Reveal from '@/components/landing/Reveal'

const signalMarks = [
  { title: 'Relaciones', detail: '1ro a n orden' },
  { title: 'Relays', detail: 'Cobertura visible' },
  { title: 'Contexto', detail: 'Badges y perfiles' },
]

const surfaces = [
  {
    href: '/labs/sigma',
    label: 'Demo principal',
    title: 'Sigma',
    detail: 'Explorador de identidad',
  },
  {
    href: '/profile',
    label: 'Vista clasica',
    title: 'Profile',
    detail: 'Cuentas conectadas',
  },
  {
    href: '/badges',
    label: 'NIP-58',
    title: 'Badges',
    detail: 'Senales verificables',
  },
]

const ecosystem = [
  { name: 'La Crypta', href: 'https://lacrypta.ar/' },
  { name: 'IDENTITY', href: 'https://hackaton.lacrypta.ar/' },
  { name: 'Nostr', href: 'https://github.com/nostr-protocol/nips' },
]

export default function LandingPage() {
  return (
    <LandingMotionProvider>
      <main className="landing-cypher overflow-hidden bg-[#060606] text-[#f6f1e8]">
        <section className="relative isolate min-h-screen overflow-hidden px-5 py-6 sm:px-8 lg:px-12">
          <IdentityPulse />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_18%,rgba(255,75,93,0.16),transparent_24%),radial-gradient(circle_at_74%_30%,rgba(255,110,78,0.18),transparent_22%),linear-gradient(180deg,rgba(6,6,6,0.14)_0%,#060606_88%)]" />
          <div className="absolute inset-y-0 right-[7%] hidden w-px bg-[linear-gradient(180deg,transparent,rgba(255,255,255,0.18),transparent)] lg:block" />

          <header className="relative z-10 flex items-center justify-between gap-6 text-sm">
            <Link
              className="font-semibold uppercase tracking-[0.18em] text-[#f6f1e8]"
              href="/"
            >
              Nostr Espacial
            </Link>
            <span className="hidden text-[#b8b0a6] sm:block">
              IDENTITY / NOSTR EXPLORER
            </span>
          </header>

          <div className="relative z-10 grid min-h-[calc(100svh-76px)] items-center gap-14 py-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(420px,0.95fr)] lg:gap-8 lg:py-16">
            <Reveal className="max-w-2xl">
              <p className="mb-5 text-xs font-semibold uppercase tracking-[0.34em] text-[#ff6675] sm:text-sm">
                Naranja Labs
                <OrangeSurprise />
              </p>
              <h1 className="max-w-4xl text-[3.4rem] font-black leading-[0.88] text-[#f6f1e8] sm:text-[5.4rem] lg:text-[7.4rem]">
                Nostr
                <br />
                explorer
              </h1>
              <p className="mt-6 max-w-lg text-base leading-7 text-[#cbc2b7] sm:text-lg">
                Mira identidad como red, no como ficha.
              </p>

              <div className="mt-8 flex flex-col items-start gap-4 sm:flex-row sm:flex-wrap sm:items-center">
                <Link
                  className="inline-flex min-h-12 items-center justify-center rounded-full bg-[#ff4b5d] px-6 text-base font-bold text-[#080808] shadow-[0_0_44px_rgba(255,75,93,0.24)] transition hover:bg-[#ff6a78] focus:outline-none focus:ring-2 focus:ring-[#ff9aa4] focus:ring-offset-2 focus:ring-offset-[#060606]"
                  href="/labs/sigma"
                >
                  Probar Nostr explorer
                </Link>
                <div className="flex flex-wrap gap-3 text-sm">
                  <span className="inline-flex items-center gap-2 rounded-full border border-[#ff4b5d]/35 bg-[#ff4b5d]/10 px-3 py-2 text-[#f6d7d3]">
                    <span className="h-2.5 w-2.5 rounded-full bg-[#ff6675]" />
                    Escritorio
                  </span>
                  <span className="inline-flex items-center gap-2 rounded-full border border-[#ffffff1f] bg-[#ffffff08] px-3 py-2 text-[#ada59b]">
                    <span className="h-2.5 w-2.5 rounded-full border border-[#ada59b]/60" />
                    Movil en progreso
                  </span>
                </div>
              </div>

              <div className="mt-12 grid max-w-xl gap-3 sm:grid-cols-3">
                {signalMarks.map((signal, index) => (
                  <Reveal
                    className="border-t border-[#ffffff18] pt-3"
                    delay={0.08 + index * 0.07}
                    key={signal.title}
                  >
                    <p className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-[#8f877f]">
                      {signal.title}
                    </p>
                    <p className="mt-2 text-base font-semibold text-[#f6f1e8]">
                      {signal.detail}
                    </p>
                  </Reveal>
                ))}
              </div>
            </Reveal>

            <Reveal className="relative lg:justify-self-end" delay={0.12}>
              <div className="relative mx-auto aspect-[0.95] w-full max-w-[600px] overflow-hidden rounded-[2rem] border border-[#ffffff14] bg-[#0c0c0c]/80 shadow-[0_32px_120px_rgba(0,0,0,0.45)]">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_24%_22%,rgba(255,75,93,0.24),transparent_26%),radial-gradient(circle_at_78%_28%,rgba(255,255,255,0.08),transparent_18%),linear-gradient(145deg,rgba(255,255,255,0.03),rgba(255,255,255,0))]" />
                <div className="absolute inset-x-0 top-0 h-28 bg-[linear-gradient(180deg,rgba(6,6,6,0.7),transparent)]" />
                <div className="absolute left-6 top-6 flex items-center gap-2 text-[0.72rem] font-semibold uppercase tracking-[0.26em] text-[#f6f1e8]">
                  <span className="h-2 w-2 rounded-full bg-[#ff4b5d]" />
                  Sigma live
                </div>
                <div className="absolute right-6 top-6 text-right">
                  <p className="text-[0.72rem] font-semibold uppercase tracking-[0.26em] text-[#918980]">
                    Relay-aware
                  </p>
                  <p className="mt-2 text-3xl font-black text-[#f6f1e8]">graph</p>
                </div>
                <div className="absolute left-6 top-24 text-[10rem] font-black leading-none tracking-[-0.08em] text-[#f6f1e8]/7 sm:text-[12rem]">
                  01
                </div>
                <div className="absolute inset-[12%] rounded-[1.6rem] border border-[#ffffff14] bg-[#0f0f0f]">
                  <Image
                    alt="Vista del explorador de identidad Nostr"
                    className="h-full w-full object-cover opacity-60 mix-blend-screen"
                    fill
                    loading="eager"
                    sizes="(min-width: 1024px) 40vw, 90vw"
                    src="/graph-explorer-preview.png"
                  />
                  <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(6,6,6,0.02),rgba(6,6,6,0.5)),radial-gradient(circle_at_60%_40%,transparent_0%,rgba(6,6,6,0.16)_58%,rgba(6,6,6,0.74)_100%)]" />
                </div>
                <div className="absolute bottom-6 left-6 right-6 flex items-end justify-between gap-6">
                  <div>
                    <p className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-[#8f877f]">
                      Identity map
                    </p>
                    <p className="mt-2 text-xl font-bold text-[#f6f1e8]">
                      conexiones, badges y contexto
                    </p>
                  </div>
                  <div className="hidden text-right lg:block">
                    <p className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-[#8f877f]">
                      Explorer mode
                    </p>
                    <p className="mt-2 text-sm text-[#cbc2b7]">menos lectura, mas senal</p>
                  </div>
                </div>
              </div>
            </Reveal>
          </div>
        </section>

        <section className="border-y border-[#ffffff14] bg-[#080808] px-5 py-16 sm:px-8 lg:px-12">
          <div className="mx-auto max-w-6xl">
            <Reveal className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-2xl">
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[#ff6675]">
                  Sigma hoy
                </p>
                <h2 className="mt-4 text-4xl font-black leading-tight text-[#f6f1e8] sm:text-5xl">
                  Lo que abre el demo.
                </h2>
              </div>
              <p className="max-w-md text-sm leading-6 text-[#a9a197] sm:text-base">
                Entrada raiz, estado de relays y contexto de identidad.
              </p>
            </Reveal>

            <div className="mt-10 grid gap-px overflow-hidden rounded-[1.5rem] bg-[#ffffff12] lg:grid-cols-3">
              <Reveal className="bg-[#0d0d0d] px-6 py-7 sm:px-8 sm:py-9" delay={0.06}>
                <p className="text-[0.72rem] font-semibold uppercase tracking-[0.26em] text-[#8f877f]">
                  Entrada
                </p>
                <p className="mt-6 text-5xl font-black tracking-[-0.06em] text-[#f6f1e8] sm:text-6xl">
                  npub
                </p>
                <p className="mt-3 max-w-xs text-sm leading-6 text-[#b9b0a5]">
                  Carga una identidad desde npub o nprofile.
                </p>
              </Reveal>
              <Reveal className="bg-[#101010] px-6 py-7 sm:px-8 sm:py-9" delay={0.12}>
                <p className="text-[0.72rem] font-semibold uppercase tracking-[0.26em] text-[#8f877f]">
                  Relays
                </p>
                <p className="mt-6 text-5xl font-black tracking-[-0.06em] text-[#f6f1e8] sm:text-6xl">
                  stale
                </p>
                <p className="mt-3 max-w-xs text-sm leading-6 text-[#b9b0a5]">
                  Muestra cobertura parcial, timeouts y faltantes.
                </p>
              </Reveal>
              <Reveal className="bg-[#0d0d0d] px-6 py-7 sm:px-8 sm:py-9" delay={0.18}>
                <p className="text-[0.72rem] font-semibold uppercase tracking-[0.26em] text-[#8f877f]">
                  Contexto
                </p>
                <p className="mt-6 text-5xl font-black tracking-[-0.06em] text-[#f6f1e8] sm:text-6xl">
                  badges
                </p>
                <p className="mt-3 max-w-xs text-sm leading-6 text-[#b9b0a5]">
                  Suma perfiles, badges y actividad al grafo.
                </p>
              </Reveal>
            </div>
          </div>
        </section>

        <section className="relative overflow-hidden px-5 py-18 sm:px-8 lg:px-12 lg:py-24">
          <div className="absolute inset-y-0 right-0 w-[46vw] bg-[radial-gradient(circle_at_center,rgba(255,75,93,0.16),transparent_58%)] opacity-70" />
          <div className="mx-auto grid max-w-6xl gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
            <Reveal className="max-w-xl">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[#ff6675]">
                Rutas
              </p>
              <h2 className="mt-4 text-4xl font-black leading-tight text-[#f6f1e8] sm:text-5xl">
                Entra por la superficie correcta.
              </h2>
            </Reveal>

            <div className="divide-y divide-[#ffffff12] border-y border-[#ffffff12]">
              {surfaces.map((surface, index) => (
                <Reveal delay={0.08 + index * 0.08} key={surface.title}>
                  <Link
                    className="group flex items-center justify-between gap-6 py-6 sm:py-7"
                    href={surface.href}
                  >
                    <div>
                      <p className="text-[0.72rem] font-semibold uppercase tracking-[0.26em] text-[#8f877f]">
                        {surface.label}
                      </p>
                      <p className="mt-2 text-3xl font-black text-[#f6f1e8] transition group-hover:text-[#ff7b88] sm:text-5xl">
                        {surface.title}
                      </p>
                    </div>
                    <div className="flex items-center gap-4">
                      <p className="hidden text-sm text-[#b9b0a5] sm:block">{surface.detail}</p>
                      <span className="text-2xl text-[#ff6675] transition group-hover:translate-x-1">
                        -&gt;
                      </span>
                    </div>
                  </Link>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        <section className="border-t border-[#ffffff14] bg-[#080808] px-5 py-10 sm:px-8 lg:px-12">
          <div className="mx-auto flex max-w-6xl flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
            <Reveal>
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#f6f1e8]">
                Nostr Espacial
              </p>
              <p className="mt-3 max-w-md text-sm leading-6 text-[#9c948a]">
                Minimal afuera. Grafo adentro.
              </p>
            </Reveal>

            <Reveal className="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm text-[#b9b0a5]" delay={0.08}>
              {ecosystem.map((item) => (
                <Link
                  className="uppercase tracking-[0.18em] transition hover:text-[#ff7b88]"
                  href={item.href}
                  key={item.name}
                  rel="noreferrer"
                  target="_blank"
                >
                  {item.name}
                </Link>
              ))}
            </Reveal>
          </div>
        </section>
      </main>
    </LandingMotionProvider>
  )
}
