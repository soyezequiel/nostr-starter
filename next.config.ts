import { statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import createNextIntlPlugin from 'next-intl/plugin'
import type { NextConfig } from 'next'

const repoRoot = path.dirname(fileURLToPath(import.meta.url))
const GRAPH_WORKER_ARTIFACTS = [
  'public/workers/events.worker.js',
  'public/workers/graph.worker.js',
  'public/workers/verify.worker.js',
]

function readGraphWorkerBuildId(): string {
  const signatures: string[] = []

  for (const relativePath of GRAPH_WORKER_ARTIFACTS) {
    const absolutePath = path.join(repoRoot, relativePath)

    try {
      const stats = statSync(absolutePath)
      signatures.push(
        `${path.basename(relativePath)}:${Math.trunc(stats.mtimeMs).toString(36)}:${stats.size.toString(36)}`,
      )
    } catch {
      return ''
    }
  }

  return signatures.join('.')
}

const nextConfig: NextConfig = {
  allowedDevOrigins: ['127.0.0.1'],
  env: {
    NEXT_PUBLIC_GRAPH_WORKER_BUILD_ID: readGraphWorkerBuildId(),
  },
}

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts')

export default withNextIntl(nextConfig)
