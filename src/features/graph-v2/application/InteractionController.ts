import type {
  GraphInteractionCallbacks,
  GraphViewportState,
} from '@/features/graph-v2/renderer/contracts'
import type { LegacyKernelBridge } from '@/features/graph-v2/bridge/LegacyKernelBridge'

export class GraphInteractionController {
  private lastViewport: GraphViewportState | null = null

  public readonly callbacks: GraphInteractionCallbacks

  public constructor(private readonly bridge: LegacyKernelBridge) {
    this.callbacks = {
      onNodeClick: (pubkey) => {
        this.bridge.selectNode(pubkey)
      },
      onNodeHover: () => {
        // Hover stays local to the renderer in v1.
      },
      onNodeDragStart: () => {
        // Drag is handled inside the renderer/runtime projection.
      },
      onNodeDragMove: () => {
        // Drag is handled inside the renderer/runtime projection.
      },
      onNodeDragEnd: () => {
        // Drag is handled inside the renderer/runtime projection.
      },
      onViewportChange: (viewport) => {
        this.lastViewport = viewport
      },
    }
  }

  public getLastViewport() {
    return this.lastViewport
  }
}

