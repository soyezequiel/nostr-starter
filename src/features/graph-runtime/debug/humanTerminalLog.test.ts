import assert from 'node:assert/strict'
import test from 'node:test'

import {
  formatHumanTerminalLog,
  isHumanTerminalColorEnabled,
  isHumanTerminalDebugEnabled,
  summarizeHumanTerminalError,
  writeHumanTerminalLog,
} from '@/features/graph-runtime/debug/humanTerminalLog'

test('formatHumanTerminalLog renders a Spanish human-readable line', () => {
  const line = formatHumanTerminalLog(
    {
      level: 'aviso',
      area: 'Relays',
      message: 'Cobertura parcial',
      fields: {
        cargados: '5/8',
        motivo: 'tiempo de espera',
        limite_ms: 8000,
        recuperable: true,
      },
    },
    new Date('2026-04-24T15:41:15Z'),
  )

  assert.match(line, /AVISO\s+Relays\s+Cobertura parcial/)
  assert.match(line, /cargados=5\/8/)
  assert.match(line, /motivo=tiempo_de_espera/)
  assert.match(line, /limite_ms=8000/)
  assert.match(line, /recuperable=si/)
})

test('formatHumanTerminalLog can render colored levels without changing fields', () => {
  const line = formatHumanTerminalLog(
    {
      level: 'error',
      area: 'Relays',
      message: 'Relay sin respuesta',
      phase: 'cierre',
      operationId: 'load-7',
      fields: {
        motivo: 'timeout',
      },
    },
    new Date('2026-04-24T15:41:15Z'),
    { color: true },
  )

  assert.match(line, /\u001b\[31mERROR\s+\u001b\[0m/)
  assert.match(line, /fase=cierre/)
  assert.match(line, /operacion=load-7/)
  assert.match(line, /motivo=timeout/)
})

test('isHumanTerminalColorEnabled respects NO_COLOR, CI and non-TTY output', () => {
  assert.equal(isHumanTerminalColorEnabled({ isTTY: true }, {}), true)
  assert.equal(isHumanTerminalColorEnabled({ isTTY: true }, { NO_COLOR: '1' }), false)
  assert.equal(isHumanTerminalColorEnabled({ isTTY: true }, { CI: 'true' }), false)
  assert.equal(isHumanTerminalColorEnabled({ isTTY: false }, {}), false)
})

test('writeHumanTerminalLog hides debug-only lines unless terminal debug is enabled', () => {
  const originalInfo = console.info
  const originalDebug = process.env.GRAPH_V2_TERMINAL_DETAIL
  const lines: unknown[] = []
  console.info = (...args: unknown[]) => {
    lines.push(args.join(' '))
  }

  try {
    delete process.env.GRAPH_V2_TERMINAL_DETAIL
    writeHumanTerminalLog({
      level: 'detalle',
      area: 'Carga raiz',
      message: 'Ola discovery completada',
      debugOnly: true,
    })
    assert.equal(lines.length, 0)

    process.env.GRAPH_V2_TERMINAL_DETAIL = 'debug'
    writeHumanTerminalLog({
      level: 'detalle',
      area: 'Carga raiz',
      message: 'Ola discovery completada',
      debugOnly: true,
    })
    assert.equal(lines.length, 1)
    assert.match(String(lines[0]), /DETALLE\s+Carga raiz\s+Ola discovery completada/)
    assert.equal(
      isHumanTerminalDebugEnabled({ GRAPH_V2_TERMINAL_DETAIL: 'debug' }),
      true,
    )
  } finally {
    console.info = originalInfo
    if (typeof originalDebug === 'undefined') {
      delete process.env.GRAPH_V2_TERMINAL_DETAIL
    } else {
      process.env.GRAPH_V2_TERMINAL_DETAIL = originalDebug
    }
  }
})

test('summarizeHumanTerminalError keeps errors short for terminal output', () => {
  assert.equal(
    summarizeHumanTerminalError(new Error('Relay no respondio')),
    'Relay no respondio',
  )
  assert.equal(summarizeHumanTerminalError('  fallo externo  '), 'fallo externo')
  assert.equal(summarizeHumanTerminalError(null), 'sin_detalle')
})
