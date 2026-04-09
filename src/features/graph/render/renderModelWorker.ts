import { createGraphWorkerGateway } from '@/features/graph/workers/browser'
import type { GraphWorkerActionMap } from '@/features/graph/workers/graph/contracts'
import type { TypedWorkerClient } from '@/features/graph/workers/shared/runtime'

export type GraphRenderModelWorkerGateway = Pick<
  TypedWorkerClient<GraphWorkerActionMap>,
  'invoke' | 'dispose'
>

export function createGraphRenderModelWorkerGateway(): GraphRenderModelWorkerGateway {
  return createGraphWorkerGateway()
}
