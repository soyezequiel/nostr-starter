import { spawn } from 'child_process'

const PORT = process.env.PORT ?? '3002'
const isWin = process.platform === 'win32'
const npmBin = isWin ? 'npm.cmd' : 'npm'
const args = ['run', 'dev', '--', '--port', PORT]

const benignStderrPatterns = [
  /ERR_IPC_CHANNEL_CLOSED/i,
  /IPC.*closed/i,
  /closed.*IPC/i,
]

const shouldSuppressStderrLine = (line) =>
  benignStderrPatterns.some((pattern) => pattern.test(line))

const child = spawn(npmBin, args, {
  stdio: ['inherit', 'inherit', 'pipe'],
  shell: false,
})

let stderrBuffer = ''

child.stderr.on('data', (chunk) => {
  stderrBuffer += chunk.toString()
  const lines = stderrBuffer.split(/\r?\n/)
  stderrBuffer = lines.pop() ?? ''

  for (const line of lines) {
    if (!shouldSuppressStderrLine(line)) {
      process.stderr.write(`${line}\n`)
    }
  }
})

const forwardSignal = (signal) => {
  if (!child.killed) {
    child.kill(signal)
  }
}

process.on('SIGINT', () => forwardSignal('SIGINT'))
process.on('SIGTERM', () => forwardSignal('SIGTERM'))

child.on('exit', (code) => {
  if (stderrBuffer && !shouldSuppressStderrLine(stderrBuffer)) {
    process.stderr.write(stderrBuffer)
  }

  process.exit(code ?? 0)
})
