import type { NodeProgramType } from 'sigma/rendering'
import type { NodeDisplayData, RenderParams } from 'sigma/types'

export class NoopNodeHoverProgram {
  public drawLabel = undefined

  public drawHover = undefined

  public constructor(
    _gl: WebGLRenderingContext,
    _pickingBuffer: WebGLFramebuffer | null,
    _renderer: unknown,
  ) {
    void _gl
    void _pickingBuffer
    void _renderer
  }

  public kill() {}

  public reallocate(_capacity: number) {
    void _capacity
  }

  public process(
    _nodeIndex: number,
    _offset: number,
    _data: NodeDisplayData,
  ) {
    void _nodeIndex
    void _offset
    void _data
  }

  public render(_params: RenderParams) {
    void _params
  }
}

export const noopNodeHoverProgram =
  NoopNodeHoverProgram as NodeProgramType
