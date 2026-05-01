'use client'

import {
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  memo,
  useEffect,
  useMemo,
  useState,
} from 'react'

import {
  GRAPH_EVENT_KIND_COLORS,
  GRAPH_EVENT_KIND_SINGULAR_LABELS,
  type GraphEventFeedMode,
  type GraphEventKind,
  type GraphEventToggleState,
} from '@/features/graph-v2/events/types'

// Variante E v3 del rediseño Panel de Actividad: filas densas de 2 líneas,
// buckets de tiempo sticky, color edge + dot, animación de entrada para
// eventos frescos, shift-click sobre filtro = aislar (modo "solo").

export type SigmaActivityKind = GraphEventKind

export interface SigmaActivityPanelV3Entry {
  id: string
  kind: SigmaActivityKind
  source: 'live' | 'recent' | 'simulated'
  fromPubkey: string
  toPubkey: string
  fromLabel: string
  toLabel: string
  played: boolean
  receivedAt: number
  sats: number
  text: string
}

export interface SigmaActivityPanelReplayMetric {
  label: string
  value: string
  tone?: 'good' | 'warn'
}

export interface SigmaActivityPanelTimelineHandlers {
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void
  onPointerMove: (event: PointerEvent<HTMLDivElement>) => void
  onPointerUp: (event: PointerEvent<HTMLDivElement>) => void
  onPointerCancel: (event: PointerEvent<HTMLDivElement>) => void
  onLostPointerCapture: (event: PointerEvent<HTMLDivElement>) => void
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void
}

export interface SigmaActivityPanelV3Props {
  // Datos
  entries: SigmaActivityPanelV3Entry[]
  totalEntryCount: number
  emptyLabel: string

  // Filtros por tipo (kind)
  toggles: GraphEventToggleState
  onSetToggle: (kind: GraphEventKind, value: boolean) => void
  onIsolateKind: (kind: GraphEventKind) => void
  onResetKinds: () => void

  // Modo
  mode: GraphEventFeedMode
  onChangeMode: (mode: GraphEventFeedMode) => void

  // Estado live
  isLiveActive: boolean
  isWorking: boolean
  liveStatusLabel: string
  liveFeedback: string | null

  // Replay
  replayCollectionPct: number
  replayPlaybackPct: number
  replayPlaybackPaused: boolean
  onTogglePlay: () => void
  onReplayCache: () => void
  onRefresh: () => void
  canControlReplay: boolean
  canTogglePlayback: boolean

  // Ventana histórica
  lookbackHours: number
  onChangeLookbackHours: (hours: number) => void
  lookbackMinHours: number
  lookbackMaxHours: number
  appliedLookbackLabel: string
  windowPresets: Array<{ hours: number; label: string }>

  // Timeline scrub
  timelineProgressPct: number
  timelineCurrentLabel: string
  timelineStartLabel: string
  timelineEndLabel: string
  canSeekTimeline: boolean
  timelineHandlers: SigmaActivityPanelTimelineHandlers
  isScrubbing: boolean

  // Métricas avanzadas
  advancedMetrics: SigmaActivityPanelReplayMetric[]

  // Acciones por entrada
  onReplayEntry: (entry: SigmaActivityPanelV3Entry) => void
  onOpenEntryDetail: (entry: SigmaActivityPanelV3Entry) => void

  // Etiquetas i18n
  labels: {
    eyebrow: string
    searchPlaceholder: string
    searchTitle: string
    sortByTime: string
    sortByValue: string
    sortAriaLabel: string
    historicalWindow: string
    collection: string
    collectionComplete: string
    playback: string
    playLabel: string
    pauseLabel: string
    cacheLabel: string
    refreshLabel: string
    advancedToggle: string
    emptyFiltered: string
    clearFilters: string
    outsideView: string
    detailsLabel: string
    moveReplay: string
    isolateHint: string
    liveLabel: string
    replayLabel: string
  }
}

const ALL_KINDS: GraphEventKind[] = ['zap', 'like', 'repost', 'save', 'quote', 'comment']

const KIND_GLYPH: Record<GraphEventKind, string> = {
  zap: '⚡',
  like: '♥',
  repost: '↻',
  save: '✚',
  quote: '❝',
  comment: '✉',
}

function compactSats(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`
  return String(n)
}

function formatRelative(ms: number): string {
  const diff = Date.now() - ms
  const s = Math.floor(diff / 1000)
  if (s < 60) return `${Math.max(0, s)}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

function bucketName(ms: number): string {
  const m = (Date.now() - ms) / 60000
  if (m < 1) return 'Ahora'
  if (m < 5) return 'Últimos 5 min'
  if (m < 30) return 'Últimos 30 min'
  if (m < 60) return 'Última hora'
  if (m < 60 * 6) return 'Hoy · más temprano'
  if (m < 60 * 24) return 'Hoy'
  return 'Antes'
}

interface Bucket {
  bucket: string
  entries: SigmaActivityPanelV3Entry[]
}

function groupByBucket(items: SigmaActivityPanelV3Entry[]): Bucket[] {
  const out: Bucket[] = []
  let cur: Bucket | null = null
  for (const it of items) {
    const b = bucketName(it.receivedAt)
    if (!cur || cur.bucket !== b) {
      cur = { bucket: b, entries: [] }
      out.push(cur)
    }
    cur.entries.push(it)
  }
  return out
}

// Hash determinista para color de avatar a partir del pubkey.
function hueFromPubkey(pubkey: string): number {
  let h = 0
  for (let i = 0; i < pubkey.length; i++) {
    h = (h * 31 + pubkey.charCodeAt(i)) | 0
  }
  return ((h % 360) + 360) % 360
}

function ActorAvatar({ pubkey, label, size = 18 }: { pubkey: string; label: string; size?: number }) {
  const hue = hueFromPubkey(pubkey || label)
  const initial = (label || '?').replace(/^[@#]/, '').charAt(0).toUpperCase() || '?'
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        borderRadius: '50%',
        background: `oklch(72% 0.14 ${hue})`,
        color: '#0a0a0a',
        fontSize: Math.round(size * 0.5),
        fontWeight: 700,
        flexShrink: 0,
        fontFamily: 'var(--ne-font-sans)',
      }}
    >
      {initial}
    </span>
  )
}

const eyebrow: CSSProperties = {
  fontSize: 10.5,
  color: 'var(--sg-fg-faint)',
  textTransform: 'uppercase',
  letterSpacing: 0,
  fontWeight: 600,
}

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '10px 12px',
  background: 'var(--sg-bg-panel-solid)',
  borderBottom: '1px solid var(--sg-stroke)',
  flexShrink: 0,
}

const toolbarStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 10px',
  borderBottom: '1px solid var(--sg-stroke)',
  flexShrink: 0,
}

const selectStyle: CSSProperties = {
  background: 'var(--sg-bg-deep)',
  border: '1px solid var(--sg-stroke)',
  color: 'var(--sg-fg-muted)',
  fontSize: 11,
  padding: '5px 8px',
  borderRadius: 6,
  fontFamily: 'var(--ne-font-ui)',
  cursor: 'pointer',
}

const listStyle: CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  background: 'var(--sg-bg-deep)',
  minHeight: 0,
}

const bucketHeaderStyle: CSSProperties = {
  position: 'sticky',
  top: 0,
  zIndex: 1,
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  padding: '8px 12px 6px',
  fontSize: 10,
  fontFamily: 'var(--ne-font-mono)',
  color: 'var(--sg-fg-muted)',
  textTransform: 'uppercase',
  letterSpacing: 0,
  fontWeight: 600,
  background: 'linear-gradient(180deg, var(--sg-bg-deep) 60%, transparent)',
  backdropFilter: 'blur(6px)',
}

const consoleWrap: CSSProperties = {
  borderBottom: '1px solid var(--sg-stroke)',
  background: 'var(--sg-bg-panel-solid)',
  flexShrink: 0,
}

const consoleHeader: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  padding: '10px 12px',
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  textAlign: 'left',
  color: 'var(--sg-fg)',
}

const transportPrimary: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  flex: 1,
  justifyContent: 'center',
  padding: '7px 10px',
  background: 'var(--sg-accent)',
  color: 'var(--sg-bg-deep)',
  border: 'none',
  borderRadius: 6,
  fontSize: 12,
  fontFamily: 'var(--ne-font-ui)',
  fontWeight: 700,
  cursor: 'pointer',
  boxShadow: '0 0 14px color-mix(in oklab, var(--sg-accent) 50%, transparent)',
  letterSpacing: 0,
}

const transportSecondary: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  padding: '7px 10px',
  background: 'transparent',
  color: 'var(--sg-fg-muted)',
  border: '1px solid var(--sg-stroke)',
  borderRadius: 6,
  fontSize: 11,
  fontFamily: 'var(--ne-font-ui)',
  fontWeight: 500,
  cursor: 'pointer',
}

const miniLabel: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'baseline',
  fontSize: 10.5,
  color: 'var(--sg-fg-faint)',
  fontFamily: 'var(--ne-font-ui)',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: 0,
  marginBottom: 6,
}

const PlayGlyph = (
  <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor" aria-hidden="true">
    <path d="M4 2.5v11l10-5.5z" />
  </svg>
)
const PauseGlyph = (
  <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor" aria-hidden="true">
    <rect x="3" y="2.5" width="3.5" height="11" rx="1" />
    <rect x="9.5" y="2.5" width="3.5" height="11" rx="1" />
  </svg>
)
const RefreshGlyph = (
  <svg
    viewBox="0 0 16 16"
    width="13"
    height="13"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M14 8a6 6 0 1 1-1.76-4.24" />
    <path d="M14 2v4h-4" />
  </svg>
)
const CacheGlyph = (
  <svg
    viewBox="0 0 16 16"
    width="13"
    height="13"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <ellipse cx="8" cy="3.6" rx="5.5" ry="2" />
    <path d="M2.5 3.6v8.8c0 1.1 2.46 2 5.5 2s5.5-.9 5.5-2V3.6" />
    <path d="M2.5 8c0 1.1 2.46 2 5.5 2s5.5-.9 5.5-2" />
  </svg>
)
const CaretGlyph = (
  <svg viewBox="0 0 16 16" width="11" height="11" fill="currentColor" aria-hidden="true">
    <path d="M4 6l4 4 4-4z" />
  </svg>
)
const SearchGlyph = (
  <svg
    viewBox="0 0 16 16"
    width="12"
    height="12"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    aria-hidden="true"
  >
    <circle cx="7" cy="7" r="4.5" />
    <path d="M10.5 10.5l3 3" />
  </svg>
)

function ModeToggle({
  mode,
  onChange,
  liveLabel,
  replayLabel,
  isWorking,
}: {
  mode: GraphEventFeedMode
  onChange: (m: GraphEventFeedMode) => void
  liveLabel: string
  replayLabel: string
  isWorking: boolean
}) {
  const isLive = mode === 'live'
  const dotColor = isLive ? 'var(--sg-good)' : 'var(--sg-fg-faint)'
  const animation = isLive
    ? 'sg-activity-v3-pulse 1.4s ease-in-out infinite'
    : isWorking
      ? 'sg-activity-v3-pulse 1.4s ease-in-out infinite'
      : 'none'
  return (
    <div
      style={{
        display: 'inline-flex',
        background: 'var(--sg-bg-deep)',
        border: '1px solid var(--sg-stroke)',
        borderRadius: 8,
        padding: 2,
        height: 28,
      }}
      role="group"
    >
      <button onClick={() => onChange('live')} type="button" style={modeBtnStyle(isLive)}>
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: dotColor,
            boxShadow: isLive ? '0 0 8px var(--sg-good)' : 'none',
            animation,
          }}
        />
        {liveLabel}
      </button>
      <button onClick={() => onChange('recent')} type="button" style={modeBtnStyle(!isLive)}>
        {replayLabel}
      </button>
    </div>
  )
}

function modeBtnStyle(active: boolean): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '0 10px',
    border: 'none',
    borderRadius: 6,
    background: active ? 'var(--sg-bg-panel-solid)' : 'transparent',
    color: active ? 'var(--sg-fg)' : 'var(--sg-fg-muted)',
    fontSize: 11.5,
    fontFamily: 'var(--ne-font-ui)',
    fontWeight: active ? 600 : 500,
    letterSpacing: 0,
    cursor: 'pointer',
  }
}

function IconBtn({
  active,
  children,
  onClick,
  title,
}: {
  active?: boolean
  children: ReactNode
  onClick: () => void
  title: string
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      type="button"
      aria-pressed={active ? true : undefined}
      style={{
        width: 28,
        height: 28,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: active ? 'var(--sg-bg-panel-solid)' : 'transparent',
        border: `1px solid ${active ? 'var(--sg-stroke-strong)' : 'transparent'}`,
        color: active ? 'var(--sg-fg)' : 'var(--sg-fg-muted)',
        borderRadius: 6,
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  )
}

function FilterPill({
  kind,
  active,
  count,
  isolateHint,
  onClick,
}: {
  kind: GraphEventKind
  active: boolean
  count: number
  isolateHint: string
  onClick: (event: MouseEvent<HTMLButtonElement>) => void
}) {
  const color = GRAPH_EVENT_KIND_COLORS[kind]
  const label = GRAPH_EVENT_KIND_SINGULAR_LABELS[kind]
  return (
    <button
      onClick={onClick}
      type="button"
      title={`${label} (${count}) · ${isolateHint}`}
      aria-pressed={active}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        width: 38,
        height: 28,
        background: active ? `color-mix(in oklab, ${color} 18%, transparent)` : 'transparent',
        border: `1px solid ${active ? color : 'var(--sg-stroke)'}`,
        color: active ? color : 'var(--sg-fg-faint)',
        borderRadius: 8,
        fontSize: 13,
        cursor: 'pointer',
        position: 'relative',
        transition: 'all 140ms ease',
        flexShrink: 0,
      }}
    >
      <span aria-hidden="true">{KIND_GLYPH[kind]}</span>
      {active && count > 0 && (
        <span
          style={{
            position: 'absolute',
            top: -5,
            right: -5,
            fontSize: 9,
            padding: '1px 4px',
            borderRadius: 8,
            background: color,
            color: '#0a0a0a',
            fontFamily: 'var(--ne-font-mono)',
            fontWeight: 700,
            lineHeight: 1.2,
            minWidth: 14,
            textAlign: 'center',
          }}
        >
          {count}
        </span>
      )}
    </button>
  )
}

function Row({
  entry,
  onReplay,
  onOpenDetail,
  outsideViewLabel,
  detailsLabel,
}: {
  entry: SigmaActivityPanelV3Entry
  onReplay: () => void
  onOpenDetail: () => void
  outsideViewLabel: string
  detailsLabel: string
}) {
  const color = GRAPH_EVENT_KIND_COLORS[entry.kind]
  const isZap = entry.kind === 'zap'
  const hasText = !!entry.text && (entry.kind === 'quote' || entry.kind === 'comment')
  const [hover, setHover] = useState(false)
  const [isFresh, setIsFresh] = useState(() => Date.now() - entry.receivedAt < 1500)

  useEffect(() => {
    if (!isFresh) return
    const id = window.setTimeout(() => setIsFresh(false), 1100)
    return () => window.clearTimeout(id)
  }, [isFresh])

  const handleKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    onReplay()
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onReplay}
      onKeyDown={handleKey}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      aria-label={`${GRAPH_EVENT_KIND_SINGULAR_LABELS[entry.kind]} de ${entry.fromLabel} a ${entry.toLabel}`}
      style={{
        display: 'grid',
        gridTemplateColumns: '3px 1fr auto',
        cursor: 'pointer',
        background: isFresh
          ? `color-mix(in oklab, ${color} 12%, transparent)`
          : hover
            ? 'rgba(255,255,255,0.025)'
            : 'transparent',
        opacity: entry.played ? 1 : 0.55,
        borderBottom: '1px solid var(--border-hair, rgba(255,255,255,0.09))',
        transition: 'background 240ms ease',
        animation: isFresh ? 'sg-activity-v3-slide-in 280ms ease' : 'none',
      }}
    >
      <span style={{ background: color, opacity: hover ? 1 : 0.85 }} />

      <div style={{ padding: '8px 10px 8px 10px', minWidth: 0 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 12.5,
            fontFamily: 'var(--ne-font-ui)',
          }}
        >
          <span
            aria-hidden="true"
            style={{
              color,
              fontSize: 13,
              lineHeight: 1,
              width: 14,
              textAlign: 'center',
              flexShrink: 0,
            }}
          >
            {KIND_GLYPH[entry.kind]}
          </span>
          <ActorAvatar pubkey={entry.fromPubkey} label={entry.fromLabel} />
          <span
            style={{
              color: 'var(--sg-fg)',
              fontWeight: 500,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              maxWidth: 110,
            }}
          >
            {entry.fromLabel}
          </span>
          <span style={{ color: 'var(--sg-fg-faint)', fontSize: 10 }}>→</span>
          <ActorAvatar pubkey={entry.toPubkey} label={entry.toLabel} />
          <span
            style={{
              color: 'var(--sg-fg-muted)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              maxWidth: 90,
            }}
          >
            {entry.toLabel}
          </span>
          <span style={{ flex: 1 }} />
          {isZap && entry.sats > 0 && (
            <span
              style={{
                fontFamily: 'var(--ne-font-mono)',
                color,
                fontSize: 12.5,
                fontWeight: 700,
                letterSpacing: 0,
              }}
            >
              {compactSats(entry.sats)}
              <span style={{ color: 'var(--sg-fg-faint)', fontWeight: 400, marginLeft: 2 }}>
                sats
              </span>
            </span>
          )}
        </div>
        <div
          style={{
            marginTop: 3,
            marginLeft: 22,
            fontSize: 11.5,
            lineHeight: 1.4,
            color: hasText ? 'var(--sg-fg-dim)' : 'var(--sg-fg-faint)',
            fontFamily: 'var(--ne-font-ui)',
            overflow: 'hidden',
            display: '-webkit-box',
            WebkitLineClamp: hover && hasText ? 3 : 1,
            WebkitBoxOrient: 'vertical',
            transition: 'all 200ms ease',
          }}
        >
          {hasText ? (
            <>“{entry.text}”</>
          ) : (
            <span>
              <span
                style={{
                  color,
                  textTransform: 'uppercase',
                  fontSize: 10,
                  fontWeight: 600,
                  letterSpacing: 0,
                  fontFamily: 'var(--ne-font-mono)',
                }}
              >
                {GRAPH_EVENT_KIND_SINGULAR_LABELS[entry.kind]}
              </span>
              {!entry.played && (
                <span style={{ marginLeft: 8, color: 'var(--sg-fg-faint)', fontSize: 11 }}>
                  {outsideViewLabel}
                </span>
              )}
            </span>
          )}
        </div>
      </div>

      <div
        style={{
          padding: '8px 10px 8px 4px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          justifyContent: 'flex-start',
          gap: 4,
          fontFamily: 'var(--ne-font-mono)',
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 11, color: 'var(--sg-fg-faint)' }}>
          {formatRelative(entry.receivedAt)}
        </span>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            onOpenDetail()
          }}
          onKeyDown={(event) => event.stopPropagation()}
          aria-label={`${detailsLabel} ${GRAPH_EVENT_KIND_SINGULAR_LABELS[entry.kind]} ${entry.fromLabel}`}
          style={{
            border: '1px solid var(--sg-stroke)',
            background: 'transparent',
            color: 'var(--sg-fg-muted)',
            fontSize: 9.5,
            padding: '2px 6px',
            borderRadius: 4,
            cursor: 'pointer',
            fontFamily: 'var(--ne-font-ui)',
            textTransform: 'uppercase',
            letterSpacing: 0,
            fontWeight: 600,
          }}
        >
          {detailsLabel}
        </button>
      </div>
    </div>
  )
}

function ProgressBar({
  pct,
  working,
  color,
}: {
  pct: number
  working: boolean
  color: string
}) {
  return (
    <div
      style={{
        position: 'relative',
        height: 5,
        background: 'var(--sg-bg-deep)',
        border: '1px solid var(--sg-stroke)',
        borderRadius: 4,
        overflow: 'hidden',
      }}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
    >
      <div
        style={{
          width: `${pct}%`,
          height: '100%',
          background: working ? color : 'var(--sg-good)',
          transition: 'width 320ms ease',
          boxShadow: `0 0 12px ${working ? color : 'var(--sg-good)'}`,
          opacity: 0.9,
        }}
      />
      {working && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background:
              'linear-gradient(90deg, transparent 30%, rgba(255,255,255,0.18) 50%, transparent 70%)',
            backgroundSize: '200% 100%',
            animation: 'sg-activity-v3-shimmer 1.6s linear infinite',
            mixBlendMode: 'screen',
          }}
        />
      )}
    </div>
  )
}

function Timeline({
  pct,
  startLabel,
  endLabel,
  currentLabel,
  canSeek,
  handlers,
  isScrubbing,
  moveAriaLabel,
}: {
  pct: number
  startLabel: string
  endLabel: string
  currentLabel: string
  canSeek: boolean
  handlers: SigmaActivityPanelTimelineHandlers
  isScrubbing: boolean
  moveAriaLabel: string
}) {
  const ticks = Array.from({ length: 7 }, (_, i) => i / 6)

  return (
    <div style={{ userSelect: 'none' }}>
      <div
        role="slider"
        aria-disabled={!canSeek}
        aria-label={moveAriaLabel}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        tabIndex={canSeek ? 0 : -1}
        onPointerDown={handlers.onPointerDown}
        onPointerMove={handlers.onPointerMove}
        onPointerUp={handlers.onPointerUp}
        onPointerCancel={handlers.onPointerCancel}
        onLostPointerCapture={handlers.onLostPointerCapture}
        onKeyDown={handlers.onKeyDown}
        style={{
          position: 'relative',
          height: 20,
          cursor: canSeek ? 'pointer' : 'not-allowed',
          display: 'flex',
          alignItems: 'center',
          touchAction: 'none',
          opacity: canSeek ? 1 : 0.6,
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            height: 4,
            top: 8,
            background: 'var(--sg-bg-deep)',
            border: '1px solid var(--sg-stroke)',
            borderRadius: 4,
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: 0,
            height: 4,
            top: 8,
            width: `${pct}%`,
            background: 'var(--sg-accent)',
            borderRadius: 4,
            boxShadow: '0 0 8px var(--sg-accent)',
            opacity: isScrubbing ? 0.95 : 0.7,
            transition: isScrubbing ? 'none' : 'width 200ms ease',
          }}
        />
        {ticks.map((t, i) => (
          <span
            key={i}
            style={{
              position: 'absolute',
              left: `${t * 100}%`,
              transform: 'translateX(-0.5px)',
              top: 4,
              height: 12,
              width: 1,
              background: 'var(--sg-stroke-strong)',
              opacity: 0.55,
            }}
          />
        ))}
        <span
          style={{
            position: 'absolute',
            left: `${pct}%`,
            transform: 'translateX(-50%)',
            top: 3,
            width: 14,
            height: 14,
            background: 'var(--sg-fg)',
            borderRadius: '50%',
            boxShadow: '0 0 0 3px var(--sg-bg-panel-solid), 0 0 12px var(--sg-accent)',
            border: '1px solid var(--sg-accent)',
            transition: isScrubbing ? 'none' : 'left 200ms ease',
          }}
        />
      </div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 10,
          fontFamily: 'var(--ne-font-mono)',
          color: 'var(--sg-fg-faint)',
          marginTop: 2,
        }}
      >
        <span>{startLabel}</span>
        <span style={{ color: 'var(--sg-fg)', fontWeight: 600 }}>{currentLabel}</span>
        <span>{endLabel}</span>
      </div>
    </div>
  )
}

function MetricCell({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: 'good' | 'warn'
}) {
  const color =
    tone === 'good' ? 'var(--sg-good)' : tone === 'warn' ? 'var(--sg-warn)' : 'var(--sg-fg)'
  return (
    <div
      style={{
        padding: '6px 8px',
        background: 'var(--sg-bg-deep)',
        border: '1px solid var(--sg-stroke)',
        borderRadius: 6,
      }}
    >
      <div
        style={{
          fontSize: 9,
          color: 'var(--sg-fg-faint)',
          fontFamily: 'var(--ne-font-ui)',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: 0,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: 'var(--ne-font-mono)',
          fontSize: 13,
          color,
          fontWeight: 600,
          marginTop: 2,
        }}
      >
        {value}
      </div>
    </div>
  )
}

function ReplayConsole({
  open,
  onToggle,
  lookbackHours,
  onChangeLookbackHours,
  lookbackMinHours,
  lookbackMaxHours,
  appliedLookbackLabel,
  windowPresets,
  collectionPct,
  playbackPct,
  playing,
  onTogglePlay,
  canTogglePlay,
  canControlReplay,
  onReplayCache,
  onRefresh,
  advancedOpen,
  setAdvancedOpen,
  advancedMetrics,
  timelineProgressPct,
  timelineCurrentLabel,
  timelineStartLabel,
  timelineEndLabel,
  canSeekTimeline,
  timelineHandlers,
  isScrubbing,
  labels,
}: {
  open: boolean
  onToggle: () => void
  lookbackHours: number
  onChangeLookbackHours: (h: number) => void
  lookbackMinHours: number
  lookbackMaxHours: number
  appliedLookbackLabel: string
  windowPresets: Array<{ hours: number; label: string }>
  collectionPct: number
  playbackPct: number
  playing: boolean
  onTogglePlay: () => void
  canTogglePlay: boolean
  canControlReplay: boolean
  onReplayCache: () => void
  onRefresh: () => void
  advancedOpen: boolean
  setAdvancedOpen: (next: boolean) => void
  advancedMetrics: SigmaActivityPanelReplayMetric[]
  timelineProgressPct: number
  timelineCurrentLabel: string
  timelineStartLabel: string
  timelineEndLabel: string
  canSeekTimeline: boolean
  timelineHandlers: SigmaActivityPanelTimelineHandlers
  isScrubbing: boolean
  labels: SigmaActivityPanelV3Props['labels']
}) {
  const collecting = collectionPct < 100
  const presetMatch = windowPresets.find((p) => p.hours === lookbackHours)
  const headerWindowLabel = presetMatch?.label ?? appliedLookbackLabel

  return (
    <div style={consoleWrap}>
      <button onClick={onToggle} style={consoleHeader} type="button" aria-expanded={open}>
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: collecting ? 'var(--sg-warn)' : 'var(--sg-good)',
            boxShadow: collecting ? '0 0 8px var(--sg-warn)' : '0 0 8px var(--sg-good)',
            animation: collecting ? 'sg-activity-v3-pulse 1.4s ease-in-out infinite' : 'none',
            flexShrink: 0,
          }}
        />
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--sg-fg)' }}>
          {labels.replayLabel}
        </span>
        <span style={{ color: 'var(--sg-fg-faint)', fontSize: 11 }}>·</span>
        <span
          style={{
            fontSize: 11,
            color: 'var(--sg-fg-muted)',
            fontFamily: 'var(--ne-font-mono)',
          }}
        >
          {headerWindowLabel}
        </span>
        <span style={{ flex: 1 }} />
        <span
          style={{
            fontSize: 11,
            color: 'var(--sg-fg-faint)',
            fontFamily: 'var(--ne-font-mono)',
          }}
        >
          {collecting ? `${Math.round(collectionPct)}% rec` : 'cache'} ·{' '}
          {Math.round(playbackPct)}%
        </span>
        <span
          style={{
            color: 'var(--sg-fg-faint)',
            transform: open ? 'rotate(0)' : 'rotate(-90deg)',
            transition: 'transform 200ms ease',
            display: 'inline-flex',
          }}
        >
          {CaretGlyph}
        </span>
      </button>

      {open && (
        <div
          style={{
            padding: '4px 12px 12px',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          <div>
            <div style={miniLabel}>
              <span>{labels.historicalWindow}</span>
              <span
                style={{
                  color: 'var(--sg-fg-muted)',
                  fontFamily: 'var(--ne-font-mono)',
                }}
              >
                {lookbackHours} h
              </span>
            </div>
            <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
              {windowPresets.map((p) => {
                const isActive = lookbackHours === p.hours
                return (
                  <button
                    key={p.hours}
                    type="button"
                    onClick={() => onChangeLookbackHours(p.hours)}
                    style={{
                      flex: 1,
                      padding: '5px 0',
                      fontSize: 11,
                      fontFamily: 'var(--ne-font-mono)',
                      fontWeight: 600,
                      background: isActive ? 'rgba(255,255,255,0.06)' : 'transparent',
                      color: isActive ? 'var(--sg-fg)' : 'var(--sg-fg-muted)',
                      border: `1px solid ${isActive ? 'var(--sg-stroke-strong)' : 'var(--sg-stroke)'}`,
                      borderRadius: 6,
                      cursor: 'pointer',
                    }}
                  >
                    {p.label}
                  </button>
                )
              })}
            </div>
            <input
              type="range"
              min={lookbackMinHours}
              max={lookbackMaxHours}
              value={lookbackHours}
              onChange={(e) => onChangeLookbackHours(Number(e.target.value))}
              style={{ width: '100%', accentColor: 'var(--sg-accent)' }}
            />
          </div>

          <div>
            <div style={miniLabel}>
              <span>{labels.collection}</span>
              <span
                style={{
                  color: collecting ? 'var(--sg-warn)' : 'var(--sg-good)',
                  fontFamily: 'var(--ne-font-mono)',
                }}
              >
                {collecting ? `${Math.round(collectionPct)}%` : labels.collectionComplete}
              </span>
            </div>
            <ProgressBar pct={collectionPct} working={collecting} color="var(--sg-accent)" />
          </div>

          <div>
            <div style={miniLabel}>
              <span>{labels.playback}</span>
              <span
                style={{
                  color: 'var(--sg-fg-muted)',
                  fontFamily: 'var(--ne-font-mono)',
                }}
              >
                {timelineCurrentLabel} · {Math.round(playbackPct)}%
              </span>
            </div>
            <Timeline
              pct={timelineProgressPct}
              startLabel={timelineStartLabel}
              endLabel={timelineEndLabel}
              currentLabel={timelineCurrentLabel}
              canSeek={canSeekTimeline}
              handlers={timelineHandlers}
              isScrubbing={isScrubbing}
              moveAriaLabel={labels.moveReplay}
            />
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              <button
                onClick={onTogglePlay}
                type="button"
                disabled={!canTogglePlay}
                style={{ ...transportPrimary, opacity: canTogglePlay ? 1 : 0.5 }}
                aria-label={playing ? labels.pauseLabel : labels.playLabel}
              >
                {playing ? PauseGlyph : PlayGlyph}
                <span>{playing ? labels.pauseLabel : labels.playLabel}</span>
              </button>
              <button
                onClick={onReplayCache}
                type="button"
                disabled={!canControlReplay}
                style={{ ...transportSecondary, opacity: canControlReplay ? 1 : 0.5 }}
              >
                {CacheGlyph}
                <span>{labels.cacheLabel}</span>
              </button>
              <button
                onClick={onRefresh}
                type="button"
                disabled={!canControlReplay}
                style={{ ...transportSecondary, opacity: canControlReplay ? 1 : 0.5 }}
              >
                {RefreshGlyph}
                <span>{labels.refreshLabel}</span>
              </button>
            </div>
          </div>

          {advancedMetrics.length > 0 && (
            <>
              <button
                onClick={() => setAdvancedOpen(!advancedOpen)}
                type="button"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '4px 0',
                  marginTop: -2,
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--sg-fg-faint)',
                  fontSize: 10.5,
                  fontFamily: 'var(--ne-font-ui)',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: 0,
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <span
                  style={{
                    transform: advancedOpen ? 'rotate(0)' : 'rotate(-90deg)',
                    transition: 'transform 200ms ease',
                    display: 'inline-flex',
                  }}
                >
                  {CaretGlyph}
                </span>
                {labels.advancedToggle}
              </button>
              {advancedOpen && (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr 1fr',
                    gap: 6,
                    marginTop: -6,
                  }}
                >
                  {advancedMetrics.map((m) => (
                    <MetricCell key={m.label} label={m.label} value={m.value} tone={m.tone} />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function SigmaActivityPanelV3(props: SigmaActivityPanelV3Props) {
  const {
    entries,
    totalEntryCount,
    emptyLabel,
    toggles,
    onSetToggle,
    onIsolateKind,
    onResetKinds,
    mode,
    onChangeMode,
    isLiveActive,
    isWorking,
    liveStatusLabel,
    liveFeedback,
    replayCollectionPct,
    replayPlaybackPct,
    replayPlaybackPaused,
    onTogglePlay,
    onReplayCache,
    onRefresh,
    canControlReplay,
    canTogglePlayback,
    lookbackHours,
    onChangeLookbackHours,
    lookbackMinHours,
    lookbackMaxHours,
    appliedLookbackLabel,
    windowPresets,
    timelineProgressPct,
    timelineCurrentLabel,
    timelineStartLabel,
    timelineEndLabel,
    canSeekTimeline,
    timelineHandlers,
    isScrubbing,
    advancedMetrics,
    onReplayEntry,
    onOpenEntryDetail,
    labels,
  } = props

  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<'time' | 'value'>('time')
  const [replayConsoleOpen, setReplayConsoleOpen] = useState(true)
  const [advancedOpen, setAdvancedOpen] = useState(false)

  const counts = useMemo(() => {
    const c: Record<GraphEventKind, number> = {
      zap: 0,
      like: 0,
      repost: 0,
      save: 0,
      quote: 0,
      comment: 0,
    }
    for (const it of entries) {
      c[it.kind]++
    }
    return c
  }, [entries])

  const filtered = useMemo(() => {
    let out = entries.filter((it) => toggles[it.kind])
    const q = query.trim().toLowerCase()
    if (q) {
      out = out.filter(
        (it) =>
          it.fromLabel.toLowerCase().includes(q) ||
          it.toLabel.toLowerCase().includes(q) ||
          it.text.toLowerCase().includes(q),
      )
    }
    if (sort === 'value') {
      out = [...out].sort((a, b) => (b.sats || 0) - (a.sats || 0))
    }
    return out
  }, [entries, toggles, query, sort])

  const grouped = useMemo(() => groupByBucket(filtered), [filtered])

  const someFiltered =
    ALL_KINDS.some((k) => !toggles[k]) || query.trim().length > 0

  const handleFilterClick = (
    k: GraphEventKind,
    event: MouseEvent<HTMLButtonElement>,
  ) => {
    if (event.shiftKey) {
      onIsolateKind(k)
      return
    }
    onSetToggle(k, !toggles[k])
  }

  const handleClearFilters = () => {
    onResetKinds()
    setQuery('')
  }

  const isReplayMode = mode === 'recent'
  const playing = !replayPlaybackPaused

  return (
    <div
      data-component="sigma-activity-panel-v3"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        background: 'var(--sg-bg)',
        color: 'var(--sg-fg)',
        fontFamily: 'var(--ne-font-sans)',
      }}
    >
      <div style={headerStyle}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={eyebrow}>{labels.eyebrow}</span>
          <span
            style={{
              fontSize: 13,
              color: 'var(--sg-fg-muted)',
              fontFamily: 'var(--ne-font-mono)',
            }}
          >
            <strong style={{ color: 'var(--sg-fg)', fontWeight: 600 }}>
              {filtered.length}
            </strong>
            <span style={{ color: 'var(--sg-fg-faint)' }}> / {totalEntryCount}</span>
          </span>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span
            title={liveStatusLabel}
            style={{
              fontSize: 10.5,
              color: isLiveActive
                ? 'var(--sg-good)'
                : isWorking
                  ? 'var(--sg-warn)'
                  : 'var(--sg-fg-faint)',
              fontFamily: 'var(--ne-font-mono)',
              textTransform: 'uppercase',
              letterSpacing: 0,
              fontWeight: 600,
              maxWidth: 100,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {liveStatusLabel}
          </span>
          <IconBtn
            active={searchOpen}
            onClick={() => {
              setSearchOpen((o) => {
                if (o) setQuery('')
                return !o
              })
            }}
            title={labels.searchTitle}
          >
            {SearchGlyph}
          </IconBtn>
          <ModeToggle
            mode={mode}
            onChange={onChangeMode}
            liveLabel={labels.liveLabel}
            replayLabel={labels.replayLabel}
            isWorking={isWorking}
          />
        </div>
      </div>

      {searchOpen && (
        <div
          style={{
            padding: '8px 12px',
            borderBottom: '1px solid var(--sg-stroke)',
            background: 'var(--sg-bg-panel-solid)',
            flexShrink: 0,
          }}
        >
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={labels.searchPlaceholder}
            style={{
              width: '100%',
              height: 30,
              background: 'var(--sg-bg-deep)',
              border: '1px solid var(--sg-stroke)',
              color: 'var(--sg-fg)',
              fontSize: 12,
              padding: '0 10px',
              borderRadius: 6,
              outline: 'none',
              fontFamily: 'var(--ne-font-ui)',
              boxSizing: 'border-box',
            }}
          />
        </div>
      )}

      {isReplayMode && (
        <ReplayConsole
          open={replayConsoleOpen}
          onToggle={() => setReplayConsoleOpen((o) => !o)}
          lookbackHours={lookbackHours}
          onChangeLookbackHours={onChangeLookbackHours}
          lookbackMinHours={lookbackMinHours}
          lookbackMaxHours={lookbackMaxHours}
          appliedLookbackLabel={appliedLookbackLabel}
          windowPresets={windowPresets}
          collectionPct={replayCollectionPct}
          playbackPct={replayPlaybackPct}
          playing={playing}
          onTogglePlay={onTogglePlay}
          canTogglePlay={canTogglePlayback}
          canControlReplay={canControlReplay}
          onReplayCache={onReplayCache}
          onRefresh={onRefresh}
          advancedOpen={advancedOpen}
          setAdvancedOpen={setAdvancedOpen}
          advancedMetrics={advancedMetrics}
          timelineProgressPct={timelineProgressPct}
          timelineCurrentLabel={timelineCurrentLabel}
          timelineStartLabel={timelineStartLabel}
          timelineEndLabel={timelineEndLabel}
          canSeekTimeline={canSeekTimeline}
          timelineHandlers={timelineHandlers}
          isScrubbing={isScrubbing}
          labels={labels}
        />
      )}

      {!isReplayMode && liveFeedback && (
        <div
          style={{
            padding: '8px 12px',
            background: 'var(--sg-bg-panel-solid)',
            borderBottom: '1px solid var(--sg-stroke)',
            color: 'var(--sg-fg-muted)',
            fontSize: 12,
            lineHeight: 1.45,
            flexShrink: 0,
          }}
        >
          {liveFeedback}
        </div>
      )}

      <div style={toolbarStyle}>
        <div style={{ display: 'flex', gap: 4, flex: 1, flexWrap: 'wrap' }}>
          {ALL_KINDS.map((k) => (
            <FilterPill
              key={k}
              kind={k}
              active={toggles[k]}
              count={counts[k]}
              isolateHint={labels.isolateHint}
              onClick={(event) => handleFilterClick(k, event)}
            />
          ))}
        </div>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as 'time' | 'value')}
          style={selectStyle}
          aria-label={labels.sortAriaLabel}
        >
          <option value="time">{labels.sortByTime}</option>
          <option value="value">{labels.sortByValue}</option>
        </select>
      </div>

      <div style={listStyle}>
        {filtered.length === 0 ? (
          <Empty
            filtered={someFiltered}
            onClear={handleClearFilters}
            emptyLabel={emptyLabel}
            filteredLabel={labels.emptyFiltered}
            clearLabel={labels.clearFilters}
          />
        ) : (
          grouped.map((g) => (
            <div key={g.bucket}>
              <div style={bucketHeaderStyle}>
                <span>{g.bucket}</span>
                <span
                  style={{
                    color: 'var(--sg-fg-faint)',
                    fontWeight: 400,
                    marginLeft: 6,
                  }}
                >
                  {g.entries.length}
                </span>
                <span
                  style={{
                    flex: 1,
                    height: 1,
                    background: 'var(--border-hair, rgba(255,255,255,0.09))',
                    marginLeft: 8,
                  }}
                />
              </div>
              {g.entries.map((entry) => (
                <Row
                  key={entry.id}
                  entry={entry}
                  onReplay={() => onReplayEntry(entry)}
                  onOpenDetail={() => onOpenEntryDetail(entry)}
                  outsideViewLabel={labels.outsideView}
                  detailsLabel={labels.detailsLabel}
                />
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function Empty({
  filtered,
  onClear,
  emptyLabel,
  filteredLabel,
  clearLabel,
}: {
  filtered: boolean
  onClear: () => void
  emptyLabel: string
  filteredLabel: string
  clearLabel: string
}) {
  return (
    <div
      style={{
        padding: '40px 24px',
        textAlign: 'center',
        color: 'var(--sg-fg-faint)',
        fontSize: 13,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 12,
      }}
    >
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: '50%',
          border: '1px dashed var(--sg-stroke-strong)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--sg-fg-faint)',
          fontSize: 18,
        }}
      >
        ·
      </div>
      <div>{filtered ? filteredLabel : emptyLabel}</div>
      {filtered && (
        <button
          type="button"
          onClick={onClear}
          style={{
            padding: '6px 12px',
            background: 'transparent',
            border: '1px solid var(--sg-stroke-strong)',
            borderRadius: 6,
            color: 'var(--sg-fg-muted)',
            fontSize: 11,
            cursor: 'pointer',
            fontFamily: 'var(--ne-font-ui)',
          }}
        >
          {clearLabel}
        </button>
      )}
    </div>
  )
}

export default memo(SigmaActivityPanelV3)
