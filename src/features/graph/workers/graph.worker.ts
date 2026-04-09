/// <reference lib="webworker" />

import { createGraphWorkerRegistry } from '@/features/graph/workers/graph/handlers'
import { bindWorkerScope } from '@/features/graph/workers/shared/runtime'

declare const self: DedicatedWorkerGlobalScope

bindWorkerScope(self, createGraphWorkerRegistry())

export {}
