import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { build } from 'esbuild'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..')
const outdir = path.join(repoRoot, 'public', 'workers')

await mkdir(outdir, { recursive: true })

await build({
  absWorkingDir: repoRoot,
  bundle: true,
  entryPoints: {
    'events.worker': 'src/features/graph/workers/events.worker.ts',
    'graph.worker': 'src/features/graph/workers/graph.worker.ts',
  },
  format: 'esm',
  logLevel: 'info',
  outdir,
  platform: 'browser',
  sourcemap: true,
  target: ['es2020'],
  tsconfig: path.join(repoRoot, 'tsconfig.json'),
})
