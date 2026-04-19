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
      onClearSelection: () => {
        this.bridge.selectNode(null)
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
      onNodeDragEnd: (pubkey, _position, options) => {
        if (options?.pinNode) {
          this.bridge.pinNode(pubkey)
        }
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
