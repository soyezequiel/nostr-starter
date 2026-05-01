type HumanTerminalLevel = 'ok' | 'aviso' | 'error' | 'detalle'
type HumanTerminalPhase = 'inicio' | 'progreso' | 'cierre'

type HumanTerminalFieldValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | Error
  | readonly string[]
  | readonly number[]

export type HumanTerminalFields = Record<string, HumanTerminalFieldValue>

export interface HumanTerminalLogEntry {
  level: HumanTerminalLevel
  area: string
  message: string
  fields?: HumanTerminalFields
  operationId?: string
  phase?: HumanTerminalPhase
  debugOnly?: boolean
}

const LEVEL_LABELS: Record<HumanTerminalLevel, string> = {
  ok: 'OK',
  aviso: 'AVISO',
  error: 'ERROR',
  detalle: 'DETALLE',
}

const LEVEL_TO_CONSOLE: Record<HumanTerminalLevel, 'info' | 'warn' | 'error'> = {
  ok: 'info',
  aviso: 'warn',
  error: 'error',
  detalle: 'info',
}

const LEVEL_COLORS: Record<HumanTerminalLevel, string> = {
  ok: '\u001b[32m',
  aviso: '\u001b[33m',
  error: '\u001b[31m',
  detalle: '\u001b[36m',
}

const ANSI_RESET = '\u001b[0m'
const HUMAN_TERMINAL_DETAIL_ENV = 'GRAPH_V2_TERMINAL_DETAIL'
const PUBLIC_HUMAN_TERMINAL_DETAIL_ENV =
  'NEXT_PUBLIC_GRAPH_V2_TERMINAL_DETAIL'

interface HumanTerminalFormatOptions {
  color?: boolean
}

type HumanTerminalEnv = Record<string, string | undefined>

const padRight = (value: string, size: number) =>
  value.length >= size ? value : `${value}${' '.repeat(size - value.length)}`

const colorize = (
  value: string,
  level: HumanTerminalLevel,
  enabled: boolean,
) => (enabled ? `${LEVEL_COLORS[level]}${value}${ANSI_RESET}` : value)

const formatTime = (date: Date): string => {
  const hours = date.getHours().toString().padStart(2, '0')
  const minutes = date.getMinutes().toString().padStart(2, '0')
  const seconds = date.getSeconds().toString().padStart(2, '0')

  return `${hours}:${minutes}:${seconds}`
}

const getProcessEnv = (): HumanTerminalEnv => {
  if (typeof process === 'undefined') {
    return {}
  }

  return process.env
}

export const isHumanTerminalDebugEnabled = (
  env: HumanTerminalEnv = getProcessEnv(),
): boolean =>
  env[HUMAN_TERMINAL_DETAIL_ENV] === 'debug' ||
  env[PUBLIC_HUMAN_TERMINAL_DETAIL_ENV] === 'debug'

export const isHumanTerminalColorEnabled = (
  stream: { isTTY?: boolean } | undefined =
    typeof process === 'undefined' ? undefined : process.stdout,
  env: HumanTerminalEnv = getProcessEnv(),
): boolean =>
  Boolean(stream?.isTTY) &&
  env.NO_COLOR !== '1' &&
  typeof env.NO_COLOR === 'undefined' &&
  env.CI !== '1' &&
  env.CI !== 'true'

export const summarizeHumanTerminalError = (error: unknown): string => {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message.trim()
  }

  if (typeof error === 'string' && error.trim().length > 0) {
    return error.trim()
  }

  return 'sin_detalle'
}

const formatFieldValue = (value: HumanTerminalFieldValue): string => {
  if (value instanceof Error) {
    return summarizeHumanTerminalError(value)
  }

  if (Array.isArray(value)) {
    return value.length > 0 ? value.join(',') : 'vacio'
  }

  if (typeof value === 'boolean') {
    return value ? 'si' : 'no'
  }

  if (value === null || typeof value === 'undefined') {
    return 'sin_dato'
  }

  return String(value).replace(/\s+/g, '_')
}

export function formatHumanTerminalLog(
  entry: HumanTerminalLogEntry,
  date = new Date(),
  options: HumanTerminalFormatOptions = {},
): string {
  const level = colorize(
    padRight(LEVEL_LABELS[entry.level], 7),
    entry.level,
    options.color === true,
  )
  const fields = Object.entries({
    ...(entry.phase ? { fase: entry.phase } : {}),
    ...(entry.operationId ? { operacion: entry.operationId } : {}),
    ...(entry.fields ?? {}),
  })
    .filter(([, value]) => typeof value !== 'undefined')
    .map(([key, value]) => `${key}=${formatFieldValue(value)}`)
    .join(' ')

  return [
    formatTime(date),
    level,
    padRight(entry.area, 14),
    padRight(entry.message, 34),
    fields,
  ]
    .filter((part) => part.length > 0)
    .join(' ')
    .trimEnd()
}

export function writeHumanTerminalLog(entry: HumanTerminalLogEntry): void {
  if (entry.debugOnly && !isHumanTerminalDebugEnabled()) {
    return
  }

  console[LEVEL_TO_CONSOLE[entry.level]](
    formatHumanTerminalLog(entry, new Date(), {
      color: isHumanTerminalColorEnabled(),
    }),
  )
}

export function logTerminalOk(
  area: string,
  message: string,
  fields?: HumanTerminalFields,
  options: Omit<HumanTerminalLogEntry, 'level' | 'area' | 'message' | 'fields'> = {},
): void {
  writeHumanTerminalLog({ level: 'ok', area, message, fields, ...options })
}

export function logTerminalWarning(
  area: string,
  message: string,
  fields?: HumanTerminalFields,
  options: Omit<HumanTerminalLogEntry, 'level' | 'area' | 'message' | 'fields'> = {},
): void {
  writeHumanTerminalLog({ level: 'aviso', area, message, fields, ...options })
}

export function logTerminalError(
  area: string,
  message: string,
  fields?: HumanTerminalFields,
  options: Omit<HumanTerminalLogEntry, 'level' | 'area' | 'message' | 'fields'> = {},
): void {
  writeHumanTerminalLog({ level: 'error', area, message, fields, ...options })
}

export function logTerminalDetail(
  area: string,
  message: string,
  fields?: HumanTerminalFields,
  options: Omit<HumanTerminalLogEntry, 'level' | 'area' | 'message' | 'fields'> = {},
): void {
  writeHumanTerminalLog({
    level: 'detalle',
    area,
    message,
    fields,
    debugOnly: true,
    ...options,
  })
}
