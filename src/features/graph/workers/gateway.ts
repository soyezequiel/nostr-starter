import type { EventsWorkerActionMap } from '@/features/graph/workers/events/contracts'
import { createEventsWorkerRegistry } from '@/features/graph/workers/events/handlers'
import type { GraphWorkerActionMap } from '@/features/graph/workers/graph/contracts'
import { createGraphWorkerRegistry } from '@/features/graph/workers/graph/handlers'
import {
  TypedWorkerClient,
  createInlineWorkerLike,
  dispatchWorkerRequest,
} from '@/features/graph/workers/shared/runtime'

export function createInlineEventsWorkerGateway(): TypedWorkerClient<EventsWorkerActionMap> {
  return new TypedWorkerClient(
    createInlineWorkerLike((request) => dispatchWorkerRequest(createEventsWorkerRegistry(), request)),
    'events.worker',
  )
}

export function createInlineGraphWorkerGateway(): TypedWorkerClient<GraphWorkerActionMap> {
  return new TypedWorkerClient(
    createInlineWorkerLike((request) => dispatchWorkerRequest(createGraphWorkerRegistry(), request)),
    'graph.worker',
  )
}
