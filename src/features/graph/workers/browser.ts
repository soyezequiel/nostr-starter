import {
  createInlineEventsWorkerGateway,
  createInlineGraphWorkerGateway,
} from '@/features/graph/workers/gateway'

export const createEventsWorkerGateway = createInlineEventsWorkerGateway

export const createGraphWorkerGateway = createInlineGraphWorkerGateway
