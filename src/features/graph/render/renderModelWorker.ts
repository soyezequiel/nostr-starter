import { createGraphWorkerGateway } from '@/features/graph/workers/browser'
import type { GraphWorkerActionMap } from '@/features/graph/workers/graph/contracts'
import type { WorkerClient } from '@/features/graph/workers/shared/runtime'

export type GraphRenderModelWorkerGateway = Pick<
  WorkerClient<GraphWorkerActionMap>,
  'invoke' | 'dispose'
>

export function createGraphRenderModelWorkerGateway(): GraphRenderModelWorkerGateway {
  return createGraphWorkerGateway()
}
