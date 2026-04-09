/// <reference lib="webworker" />

import { createEventsWorkerRegistry } from '@/features/graph/workers/events/handlers'
import { bindWorkerScope } from '@/features/graph/workers/shared/runtime'

declare const self: DedicatedWorkerGlobalScope

bindWorkerScope(self, createEventsWorkerRegistry())

export {}
