// WebGL2 instanced renderer for activity overlay animations.
// Replaces graphEventOverlay.ts Canvas2D drawing with GPU-side rendering:
//   - All 180 animations dispatched in ONE instanced draw call per frame
//   - Glow / SDF shapes computed analytically in fragment shader (no shadowBlur)
//   - Radial/linear gradients replaced by GPU math (no per-frame GC)
//
// Route lines + labels remain in a thin Canvas2D overlay on top
// (text rendering in WebGL is painful; lines are not the bottleneck).
//
// Falls back to null if WebGL2 is unavailable — caller must use GraphEventOverlay.

import type { ParsedGraphEvent } from '@/features/graph-v2/events/types'
import { GRAPH_EVENT_KIND_COLORS } from '@/features/graph-v2/events/types'
import type { ViewportPositionResolver } from '@/features/graph-v2/events/graphEventOverlay'
import { satsToRadiusPx } from '@/features/graph-v2/events/graphEventOverlay'
import type { ParsedZap } from '@/features/graph-v2/zaps/zapParser'

// ── constants ──────────────────────────────────────────────────────────────
const MAX_INSTANCES = 180
const DEFAULT_DURATION_MS = 1250
const ZAP_DURATION_MS = 1350
const MIN_RADIUS_PX = 2.4
const TAIL_SPARKS = 9
const MAX_DPR = 2
const KIND_ZAP = 0
const KIND_LIKE = 1
const KIND_REPOST = 2
const KIND_SAVE = 3
const KIND_QUOTE = 4
const KIND_COMMENT = 5
const KIND_MAP: Record<ParsedGraphEvent['kind'], number> = {
  zap: KIND_ZAP,
  like: KIND_LIKE,
  repost: KIND_REPOST,
  save: KIND_SAVE,
  quote: KIND_QUOTE,
  comment: KIND_COMMENT,
}

// Per-instance layout (floats): fromX fromY toX toY startMs duration radius r g b kind flicker arrivalOnly
const FLOATS_PER_INSTANCE = 13
const INSTANCE_BYTES = FLOATS_PER_INSTANCE * 4

// ── shader source ──────────────────────────────────────────────────────────
const VERT_SRC = /* glsl */`#version 300 es
in vec2 a_corner;
in vec2 a_from;
in vec2 a_to;
in float a_startMs;
in float a_duration;
in float a_radius;
in vec3 a_color;
in float a_kind;
in float a_flicker;
in float a_arrivalOnly;

uniform float u_time;
uniform vec2 u_viewport;

out vec2 v_uv;
out float v_progress;
out float v_lifeAlpha;
flat out vec3 v_color;
flat out float v_kind;
out float v_flicker;

float ease_inout_quad(float t){return t<.5?2.*t*t:1.-pow(-2.*t+2.,2.)*.5;}
float ease_out_cubic(float t){float t1=1.-t;return 1.-t1*t1*t1;}
float ss(float e0,float e1,float x){float t=clamp((x-e0)/(e1-e0),0.,1.);return t*t*(3.-2.*t);}

void main(){
  float progress=clamp((u_time-a_startMs)/a_duration,0.,1.);
  v_progress=progress;
  float fadeIn=a_kind<.5?ss(0.,.12,progress):ss(0.,.14,progress);
  float fadeOut=1.-ss(.84,1.,progress);
  v_lifeAlpha=fadeIn*fadeOut;
  v_color=a_color;
  v_kind=a_kind;
  v_flicker=.86+sin(progress*3.14159*18.+a_flicker)*.14;

  vec2 pos;float half;
  if(a_arrivalOnly>.5||length(a_to-a_from)<1.){
    pos=a_to;
    half=a_kind<.5?max(a_radius*4.5,22.):20.;
  } else {
    float dx=a_to.x-a_from.x;
    float dy=a_to.y-a_from.y;
    if(a_kind<.5){
      float e=ease_inout_quad(progress);
      pos=a_from+vec2(dx,dy)*e;
      half=max(a_radius*4.5,20.);
    } else {
      float e=ease_out_cubic(progress);
      float dist=length(vec2(dx,dy));
      vec2 n=dist>0.?vec2(-dy,dx)/dist:vec2(0.,-1.);
      float arc=sin(progress*3.14159)*min(26.,dist*.18);
      pos=a_from+vec2(dx,dy)*e+n*arc;
      half=18.;
    }
  }

  v_uv=a_corner;
  vec2 css=pos+a_corner*half;
  gl_Position=vec4(css.x/u_viewport.x*2.-1.,1.-css.y/u_viewport.y*2.,0.,1.);
}`

const FRAG_SRC = /* glsl */`#version 300 es
precision highp float;
in vec2 v_uv;
in float v_progress;
in float v_lifeAlpha;
flat in vec3 v_color;
flat in float v_kind;
in float v_flicker;
out vec4 fragColor;

float ss(float e0,float e1,float x){float t=clamp((x-e0)/(e1-e0),0.,1.);return t*t*(3.-2.*t);}

float sdHeart(vec2 p){
  p.x=abs(p.x);p.y=-(p.y-.25);
  if(p.y+p.x>1.){return length(p-vec2(.25,.75))-sqrt(2.)*.25;}
  return sqrt(min(dot(p-vec2(0.,1.),p-vec2(0.,1.)),
    dot(p-.5*max(p.x+p.y,0.)*vec2(1.),p-.5*max(p.x+p.y,0.)*vec2(1.))))*sign(p.x-p.y);
}
float sdRRect(vec2 p,vec2 b,float r){vec2 q=abs(p)-b+r;return length(max(q,0.))+min(max(q.x,q.y),0.)-r;}
float sdBookmark(vec2 p){float rect=max(abs(p.x)-.55,abs(p.y)-1.);float notch=p.y-1.+.54*(1.-abs(p.x)/.55);return max(rect,-notch);}

vec4 drawZap(vec2 uv,float la,float flicker,float progress){
  float r=length(uv);
  float gm=3.3+flicker*.55;
  float glow=(1.-r/gm);glow=max(0.,glow*glow);
  float core=max(0.,1.-r*gm*2.5);
  float pulse=ss(.62,1.,progress);
  float pR=1.8/gm+pulse*3.;
  float ring=max(0.,1.-abs(r-pR)*gm*8.)*(1.-pulse)*.48;
  vec3 hot=vec3(1.,.957,.812);vec3 warm=vec3(.984,.847,.42);vec3 base=vec3(.949,.6,.29);
  vec3 col=mix(base,mix(warm,hot,core),glow);
  float a=clamp((glow*.88+core*.12+ring)*la,0.,1.);
  return vec4(col*a,a);
}
vec4 drawLike(vec2 uv,vec3 c,float la){
  float s=sdHeart(uv*1.2);
  float sh=1.-ss(-.06,.06,s);float gw=max(0.,1.-(s+.15)/.4)*.5;
  float a=clamp((sh+gw)*la,0.,1.);return vec4(c*a,a);
}
vec4 drawRepost(vec2 uv,vec3 c,float la,float progress){
  float r=length(uv);float tR=.58;
  float ring=max(0.,1.-abs(r-tR)/.12);float gw=max(0.,1.-abs(r-tR)/.35)*.4;
  float ang=atan(uv.y,uv.x);
  float mask=1.-(ss(-3.14159*.88,-3.14159*.92,ang)+ss(-3.14159*.7,-3.14159*.66,-ang));
  float a=clamp((ring*mask+gw*mask)*la,0.,1.);return vec4(c*a,a);
}
vec4 drawSave(vec2 uv,vec3 c,float la){
  float s=sdBookmark(uv*vec2(1.6,1.2));
  float sh=1.-ss(-.04,.04,s);float gw=max(0.,1.-(s+.2)/.45)*.45;
  float a=clamp((sh+gw)*la,0.,1.);return vec4(c*a,a);
}
vec4 drawQuote(vec2 uv,vec3 c,float la){
  vec2 p1=uv+vec2(.32,0.);vec2 p2=uv-vec2(.32,0.);
  float c1=1.-ss(0.,.3,length(p1)-.28);float c2=1.-ss(0.,.3,length(p2)-.28);
  float sh=clamp(c1+c2,0.,1.);
  float gw=clamp(max(0.,1.-(length(p1)-.28)/.5)+max(0.,1.-(length(p2)-.28)/.5),0.,1.)*.35;
  float a=clamp((sh+gw)*la,0.,1.);return vec4(c*a,a);
}
vec4 drawComment(vec2 uv,vec3 c,float la){
  float s=sdRRect(uv,vec2(.6,.4),.18);
  float sh=1.-ss(-.04,.04,s);float gw=max(0.,1.-(s+.15)/.4)*.4;
  float a=clamp((sh+gw)*la,0.,1.);return vec4(c*a,a);
}

void main(){
  if(v_lifeAlpha<=0.001){discard;}
  vec4 col;
  if(v_kind<.5)       col=drawZap(v_uv,v_lifeAlpha,v_flicker,v_progress);
  else if(v_kind<1.5) col=drawLike(v_uv,v_color,v_lifeAlpha);
  else if(v_kind<2.5) col=drawRepost(v_uv,v_color,v_lifeAlpha,v_progress);
  else if(v_kind<3.5) col=drawSave(v_uv,v_color,v_lifeAlpha);
  else if(v_kind<4.5) col=drawQuote(v_uv,v_color,v_lifeAlpha);
  else                col=drawComment(v_uv,v_color,v_lifeAlpha);
  fragColor=col;
}`

// ── route lines + labels shader (Canvas2D 2D pass) ────────────────────────
// (no shader needed — drawn on the label canvas)

// ── types ──────────────────────────────────────────────────────────────────
interface ActiveAnim {
  kind: ParsedGraphEvent['kind']
  fromPubkey: string | null
  toPubkey: string | null
  virtualFrom?: { x: number; y: number }
  virtualTo?: { x: number; y: number }
  radiusPx: number
  label: string
  startMs: number
  durationMs: number
  flickerSeed: number
  arrivalOnly: boolean
}

// ── helpers ────────────────────────────────────────────────────────────────
function hexToRgb(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  return [r, g, b]
}

function easeInOutQuad(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
}
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}
function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

function getKindRadius(kind: ParsedGraphEvent['kind']): number {
  switch (kind) {
    case 'zap': return MIN_RADIUS_PX
    case 'like': return 5.8
    case 'repost': return 6.2
    case 'save': return 5.4
    case 'quote': return 6.2
    case 'comment': return 6.4
  }
}

function getEventLabel(event: ParsedGraphEvent): string {
  switch (event.payload.kind) {
    case 'zap': return formatSatsLabel(event.payload.data.amountSats ?? 0)
    case 'like': return event.payload.data.reaction.length <= 3 ? event.payload.data.reaction : 'Like'
    case 'repost': return 'Repost'
    case 'save': return 'Save'
    case 'quote': return 'Quote'
    case 'comment': return 'Comment'
  }
}

function formatSatsLabel(sats: number): string {
  if (!Number.isFinite(sats) || sats <= 0) return '0'
  if (sats < 1_000) return Math.floor(sats).toString()
  if (sats < 1_000_000) return `${(sats / 1_000).toFixed(1).replace(/\.0$/, '')}k`
  return `${(sats / 1_000_000).toFixed(1).replace(/\.0$/, '')}m`
}

// ── WebGL setup helpers ────────────────────────────────────────────────────
function compileShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const shader = gl.createShader(type)!
  gl.shaderSource(shader, src)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader)
    gl.deleteShader(shader)
    throw new Error(`Shader compile error: ${log}`)
  }
  return shader
}

function linkProgram(gl: WebGL2RenderingContext, vert: WebGLShader, frag: WebGLShader): WebGLProgram {
  const prog = gl.createProgram()!
  gl.attachShader(prog, vert)
  gl.attachShader(prog, frag)
  gl.linkProgram(prog)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog)
    gl.deleteProgram(prog)
    throw new Error(`Program link error: ${log}`)
  }
  return prog
}

// ── main class ─────────────────────────────────────────────────────────────
export class WebGLEventRenderer {
  private readonly glCanvas: HTMLCanvasElement
  private readonly gl: WebGL2RenderingContext
  private readonly labelCanvas: HTMLCanvasElement
  private readonly labelCtx: CanvasRenderingContext2D
  private readonly resizeObserver: ResizeObserver | null = null

  private readonly program: WebGLProgram
  private readonly vao: WebGLVertexArrayObject
  private readonly cornerVbo: WebGLBuffer
  private readonly instanceVbo: WebGLBuffer
  private readonly instanceData: Float32Array

  private readonly uTime: WebGLUniformLocation
  private readonly uViewport: WebGLUniformLocation

  private animations: ActiveAnim[] = []
  private rafId: number | null = null
  private disposed = false
  private paused = false
  private pausedAtMs: number | null = null
  private devicePixelRatio = 1
  private cssWidth = 1
  private cssHeight = 1

  private constructor(
    private readonly container: HTMLElement,
    private readonly getCssViewportPosition: ViewportPositionResolver,
    gl: WebGL2RenderingContext,
    glCanvas: HTMLCanvasElement,
    labelCanvas: HTMLCanvasElement,
    labelCtx: CanvasRenderingContext2D,
  ) {
    this.gl = gl
    this.glCanvas = glCanvas
    this.labelCanvas = labelCanvas
    this.labelCtx = labelCtx

    // Compile shaders
    const vert = compileShader(gl, gl.VERTEX_SHADER, VERT_SRC)
    const frag = compileShader(gl, gl.FRAGMENT_SHADER, FRAG_SRC)
    this.program = linkProgram(gl, vert, frag)
    gl.deleteShader(vert)
    gl.deleteShader(frag)

    // Uniform locations
    this.uTime = gl.getUniformLocation(this.program, 'u_time')!
    this.uViewport = gl.getUniformLocation(this.program, 'u_viewport')!

    // Quad corners for 2 triangles covering [-1,1]
    const corners = new Float32Array([
      -1, -1,  1, -1,  1,  1,
      -1, -1,  1,  1, -1,  1,
    ])

    this.cornerVbo = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cornerVbo)
    gl.bufferData(gl.ARRAY_BUFFER, corners, gl.STATIC_DRAW)

    // Instance buffer — pre-allocated for MAX_INSTANCES
    this.instanceData = new Float32Array(MAX_INSTANCES * FLOATS_PER_INSTANCE)
    this.instanceVbo = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceVbo)
    gl.bufferData(gl.ARRAY_BUFFER, this.instanceData.byteLength, gl.DYNAMIC_DRAW)

    // VAO setup
    this.vao = gl.createVertexArray()!
    gl.bindVertexArray(this.vao)

    // a_corner (per-vertex, divisor 0)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cornerVbo)
    const aCorner = gl.getAttribLocation(this.program, 'a_corner')
    gl.enableVertexAttribArray(aCorner)
    gl.vertexAttribPointer(aCorner, 2, gl.FLOAT, false, 0, 0)
    gl.vertexAttribDivisor(aCorner, 0)

    // Per-instance attributes (divisor 1)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceVbo)
    const stride = INSTANCE_BYTES
    const bindInstanced = (name: string, size: number, offset: number) => {
      const loc = gl.getAttribLocation(this.program, name)
      gl.enableVertexAttribArray(loc)
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset * 4)
      gl.vertexAttribDivisor(loc, 1)
    }
    bindInstanced('a_from',       2,  0)
    bindInstanced('a_to',         2,  2)
    bindInstanced('a_startMs',    1,  4)
    bindInstanced('a_duration',   1,  5)
    bindInstanced('a_radius',     1,  6)
    bindInstanced('a_color',      3,  7)
    bindInstanced('a_kind',       1, 10)
    bindInstanced('a_flicker',    1, 11)
    bindInstanced('a_arrivalOnly',1, 12)

    gl.bindVertexArray(null)

    // WebGL state
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE) // additive blending (same as Canvas2D 'lighter')

    this.resize()

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.resize())
      this.resizeObserver.observe(container)
    }

    gl.canvas.addEventListener('webglcontextlost', this.onContextLost, false)
  }

  // ── factory ──────────────────────────────────────────────────────────────

  static tryCreate(
    container: HTMLElement,
    getCssViewportPosition: ViewportPositionResolver,
  ): WebGLEventRenderer | null {
    try {
      const containerStyle = getComputedStyle(container)
      if (containerStyle.position === 'static') {
        container.style.position = 'relative'
      }

      // WebGL canvas (bottom layer)
      const glCanvas = document.createElement('canvas')
      glCanvas.style.position = 'absolute'
      glCanvas.style.inset = '0'
      glCanvas.style.width = '100%'
      glCanvas.style.height = '100%'
      glCanvas.style.pointerEvents = 'none'
      glCanvas.style.zIndex = '5'
      glCanvas.setAttribute('data-activity-webgl', 'true')
      container.appendChild(glCanvas)

      const gl = glCanvas.getContext('webgl2', {
        alpha: true,
        premultipliedAlpha: true,
        antialias: false,
        depth: false,
        stencil: false,
        preserveDrawingBuffer: false,
      }) as WebGL2RenderingContext | null

      if (!gl) {
        container.removeChild(glCanvas)
        return null
      }

      // Label canvas (top layer — Canvas2D for text + route lines)
      const labelCanvas = document.createElement('canvas')
      labelCanvas.style.position = 'absolute'
      labelCanvas.style.inset = '0'
      labelCanvas.style.width = '100%'
      labelCanvas.style.height = '100%'
      labelCanvas.style.pointerEvents = 'none'
      labelCanvas.style.zIndex = '6'
      labelCanvas.setAttribute('data-activity-labels', 'true')
      container.appendChild(labelCanvas)

      const labelCtx = labelCanvas.getContext('2d')
      if (!labelCtx) {
        container.removeChild(glCanvas)
        container.removeChild(labelCanvas)
        return null
      }

      return new WebGLEventRenderer(
        container, getCssViewportPosition,
        gl, glCanvas, labelCanvas, labelCtx,
      )
    } catch {
      return null
    }
  }

  // ── public API (matches GraphEventOverlay) ────────────────────────────────

  public play(event: ParsedGraphEvent): boolean {
    if (this.disposed) return false
    const amountSats = event.payload.kind === 'zap' ? event.payload.data.amountSats ?? 0 : 0
    return this.enqueue({
      kind: event.kind,
      fromPubkey: event.fromPubkey,
      toPubkey: event.toPubkey,
      radiusPx: event.kind === 'zap' ? satsToRadiusPx(amountSats) : getKindRadius(event.kind),
      label: getEventLabel(event),
      durationMs: event.kind === 'zap' ? ZAP_DURATION_MS : DEFAULT_DURATION_MS,
      arrivalOnly: false,
    })
  }

  public playZap(zap: Pick<ParsedZap, 'fromPubkey' | 'toPubkey' | 'sats'>): boolean {
    if (this.disposed) return false
    return this.enqueue({
      kind: 'zap',
      fromPubkey: zap.fromPubkey,
      toPubkey: zap.toPubkey,
      radiusPx: satsToRadiusPx(zap.sats),
      label: formatSatsLabel(zap.sats),
      durationMs: ZAP_DURATION_MS,
      arrivalOnly: false,
    })
  }

  public playZapArrival(zap: Pick<ParsedZap, 'toPubkey' | 'sats'>): boolean {
    if (this.disposed) return false
    return this.enqueue({
      kind: 'zap',
      fromPubkey: null,
      toPubkey: zap.toPubkey,
      radiusPx: satsToRadiusPx(zap.sats),
      label: formatSatsLabel(zap.sats),
      durationMs: ZAP_DURATION_MS,
      arrivalOnly: true,
    })
  }

  public setPaused(paused: boolean): void {
    if (this.disposed || this.paused === paused) return
    if (paused) {
      this.paused = true
      this.pausedAtMs = performance.now()
      if (this.rafId !== null) {
        cancelAnimationFrame(this.rafId)
        this.rafId = null
      }
      return
    }
    const pausedAtMs = this.pausedAtMs
    const pausedForMs = pausedAtMs === null ? 0 : Math.max(0, performance.now() - pausedAtMs)
    this.paused = false
    this.pausedAtMs = null
    if (pausedForMs > 0) {
      this.animations = this.animations.map(a => ({ ...a, startMs: a.startMs + pausedForMs }))
    }
    if (this.animations.length > 0) this.ensureTicking()
  }

  public redrawPausedFrame(): void {
    if (this.disposed || !this.paused || this.animations.length === 0) return
    this.renderFrame(this.pausedAtMs ?? performance.now())
  }

  public dispose(): void {
    this.disposed = true
    this.animations = []
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
    this.resizeObserver?.disconnect()
    this.glCanvas.removeEventListener('webglcontextlost', this.onContextLost)

    const gl = this.gl
    gl.deleteVertexArray(this.vao)
    gl.deleteBuffer(this.cornerVbo)
    gl.deleteBuffer(this.instanceVbo)
    gl.deleteProgram(this.program)

    if (this.glCanvas.parentElement === this.container) this.container.removeChild(this.glCanvas)
    if (this.labelCanvas.parentElement === this.container) this.container.removeChild(this.labelCanvas)
  }

  // ── private ───────────────────────────────────────────────────────────────

  private readonly onContextLost = (e: Event) => {
    e.preventDefault()
    // Context lost: stop ticking; caller will observe disposed-equivalent state
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
  }

  private enqueue(input: {
    kind: ActiveAnim['kind']
    fromPubkey: string | null
    toPubkey: string
    radiusPx: number
    label: string
    durationMs: number
    arrivalOnly: boolean
  }): boolean {
    const toPos = this.getCssViewportPosition(input.toPubkey)
    if (input.arrivalOnly) {
      if (!toPos) return false
      this.pushAnimation({ ...input, fromPubkey: null, toPubkey: input.toPubkey, startMs: this.pausedAtMs ?? performance.now(), flickerSeed: Math.random() * Math.PI * 2 })
      return true
    }

    const fromPos = input.fromPubkey === null ? null : this.getCssViewportPosition(input.fromPubkey)
    if (!fromPos && !toPos) return false

    let virtualFrom: { x: number; y: number } | undefined
    let virtualTo: { x: number; y: number } | undefined
    let fromPubkey = input.fromPubkey
    let toPubkey: string | null = input.toPubkey

    if (!fromPos && toPos) {
      virtualFrom = this.getOutsidePoint(toPos)
      fromPubkey = null
    } else if (fromPos && !toPos) {
      virtualTo = this.getOutsidePoint(fromPos)
      toPubkey = null
    }

    this.pushAnimation({ ...input, fromPubkey, toPubkey, virtualFrom, virtualTo, startMs: this.pausedAtMs ?? performance.now(), flickerSeed: Math.random() * Math.PI * 2 })
    return true
  }

  private pushAnimation(anim: ActiveAnim): void {
    this.animations.push(anim)
    if (this.animations.length > MAX_INSTANCES) {
      this.animations = this.animations.slice(-MAX_INSTANCES)
    }
    this.ensureTicking()
  }

  private getOutsidePoint(target: { x: number; y: number }): { x: number; y: number } {
    const w = this.cssWidth, h = this.cssHeight
    let dx = target.x - w / 2, dy = target.y - h / 2
    if (Math.abs(dx) < 0.1 && Math.abs(dy) < 0.1) dy = -1
    const dist = Math.hypot(dx, dy); dx /= dist; dy /= dist
    const margin = 50
    const tX = dx > 0 ? (w + margin - target.x) / dx : dx < 0 ? (-margin - target.x) / dx : Infinity
    const tY = dy > 0 ? (h + margin - target.y) / dy : dy < 0 ? (-margin - target.y) / dy : Infinity
    const t = Math.min(tX, tY)
    return { x: target.x + dx * t, y: target.y + dy * t }
  }

  private resize(): void {
    const rect = this.container.getBoundingClientRect()
    const dpr = Math.min(Math.max(window.devicePixelRatio || 1, 1), MAX_DPR)
    this.devicePixelRatio = dpr
    this.cssWidth = rect.width
    this.cssHeight = rect.height

    const pw = Math.max(1, Math.floor(rect.width * dpr))
    const ph = Math.max(1, Math.floor(rect.height * dpr))

    this.glCanvas.width = pw
    this.glCanvas.height = ph
    this.gl.viewport(0, 0, pw, ph)

    this.labelCanvas.width = pw
    this.labelCanvas.height = ph
    this.labelCtx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  private ensureTicking(): void {
    if (this.rafId !== null || this.disposed || this.paused) return
    this.rafId = requestAnimationFrame(this.tick)
  }

  private readonly tick = (timestamp: number) => {
    this.rafId = null
    if (this.disposed || this.paused) return
    this.renderFrame(timestamp)
    if (this.animations.length > 0) this.ensureTicking()
  }

  private renderFrame(timestamp: number): void {
    const gl = this.gl
    const w = this.cssWidth, h = this.cssHeight

    // ── Expire animations ───────────────────────────────────────────────────
    const next: ActiveAnim[] = []
    let instanceCount = 0
    const resolvedPositions: Array<{
      from: { x: number; y: number } | null
      to: { x: number; y: number } | null
      progress: number
      lifeAlpha: number
      anim: ActiveAnim
    }> = []

    for (const anim of this.animations) {
      const elapsed = timestamp - anim.startMs
      if (elapsed >= anim.durationMs) continue

      const to = anim.toPubkey === null ? anim.virtualTo : this.getCssViewportPosition(anim.toPubkey)
      if (!to) continue

      const from = anim.arrivalOnly || (anim.fromPubkey === null && !anim.virtualFrom)
        ? null
        : (anim.fromPubkey === null ? anim.virtualFrom ?? null : this.getCssViewportPosition(anim.fromPubkey))

      if (!anim.arrivalOnly && from === null && !anim.virtualFrom) continue

      const progress = Math.min(1, Math.max(0, elapsed / anim.durationMs))
      const fadeIn = anim.kind === 'zap' ? smoothstep(0, 0.12, progress) : smoothstep(0, 0.14, progress)
      const fadeOut = 1 - smoothstep(0.84, 1, progress)
      const lifeAlpha = fadeIn * fadeOut

      next.push(anim)
      resolvedPositions.push({ from, to, progress, lifeAlpha, anim })

      if (instanceCount < MAX_INSTANCES) {
        const fx = from?.x ?? to.x, fy = from?.y ?? to.y
        const [r, g, b] = hexToRgb(GRAPH_EVENT_KIND_COLORS[anim.kind])
        const base = instanceCount * FLOATS_PER_INSTANCE
        const d = this.instanceData
        d[base + 0] = fx;    d[base + 1] = fy
        d[base + 2] = to.x;  d[base + 3] = to.y
        d[base + 4] = anim.startMs
        d[base + 5] = anim.durationMs
        d[base + 6] = anim.radiusPx
        d[base + 7] = r;  d[base + 8] = g;  d[base + 9] = b
        d[base + 10] = KIND_MAP[anim.kind]
        d[base + 11] = anim.flickerSeed
        d[base + 12] = anim.arrivalOnly ? 1 : 0
        instanceCount++
      }
    }

    this.animations = next

    // ── WebGL pass: particles/glow ─────────────────────────────────────────
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)

    if (instanceCount > 0) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceVbo)
      gl.bufferSubData(gl.ARRAY_BUFFER, 0,
        this.instanceData.subarray(0, instanceCount * FLOATS_PER_INSTANCE))

      gl.useProgram(this.program)
      gl.uniform1f(this.uTime, timestamp)
      gl.uniform2f(this.uViewport, w, h)

      gl.bindVertexArray(this.vao)
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, instanceCount)
      gl.bindVertexArray(null)
    }

    // ── Canvas2D pass: route lines + labels ────────────────────────────────
    const lctx = this.labelCtx
    lctx.clearRect(0, 0, w, h)

    for (const { from, to, progress, lifeAlpha, anim } of resolvedPositions) {
      if (!to) continue
      const color = GRAPH_EVENT_KIND_COLORS[anim.kind]

      if (from) {
        // Route line
        lctx.save()
        lctx.globalAlpha = (anim.kind === 'zap' ? 0.22 : 0.18) * lifeAlpha
        lctx.strokeStyle = color
        lctx.lineWidth = 1.15
        lctx.lineCap = 'round'
        if (anim.kind === 'quote') lctx.setLineDash([4, 6])
        lctx.beginPath()
        lctx.moveTo(from.x, from.y)
        lctx.lineTo(to.x, to.y)
        lctx.stroke()
        if (anim.kind === 'quote') lctx.setLineDash([])
        lctx.restore()
      }

      // Label
      const labelAlpha = lifeAlpha * (1 - smoothstep(0.7, 1, progress))
      if (labelAlpha > 0.02 && anim.label) {
        const dx = from ? to.x - from.x : 0
        const dy = from ? to.y - from.y : -1
        const dist = Math.hypot(dx, dy)
        const nx = dist > 0 ? -dy / dist : 0
        const ny = dist > 0 ? dx / dist : -1
        const eased = anim.kind === 'zap' ? easeInOutQuad(progress) : easeOutCubic(progress)
        const arc = from ? Math.sin(progress * Math.PI) * Math.min(26, dist * 0.18) : 0
        const lx = (from ? from.x + dx * eased : to.x) + nx * arc + nx * 12
        const ly = (from ? from.y + dy * eased : to.y) + ny * arc + ny * 12 - 4

        lctx.save()
        lctx.font = '600 11px system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif'
        lctx.textAlign = 'center'
        lctx.textBaseline = 'middle'
        lctx.globalAlpha = labelAlpha * 0.7
        lctx.strokeStyle = 'rgba(0,0,0,0.8)'
        lctx.lineWidth = 3
        lctx.lineJoin = 'round'
        lctx.strokeText(anim.label, lx, ly)
        lctx.globalAlpha = labelAlpha
        lctx.fillStyle = color
        lctx.fillText(anim.label, lx, ly)
        lctx.restore()
      }

      // Zap tail sparks (CPU-computed, Canvas2D drawn — 9 sparks, cheap)
      if (from && anim.kind === 'zap' && lifeAlpha > 0.01) {
        const dx = to.x - from.x, dy = to.y - from.y
        const eased = easeInOutQuad(progress)
        const baseAlpha = 0.28 * lifeAlpha * (1 - progress * 0.28)
        const zapColor = GRAPH_EVENT_KIND_COLORS.zap

        lctx.save()
        lctx.fillStyle = zapColor
        lctx.beginPath()
        for (let i = TAIL_SPARKS; i >= 1; i -= 1) {
          if (i % 2 !== 0) continue
          const t = Math.max(0, eased - i * 0.018)
          const sx = from.x + dx * t, sy = from.y + dy * t
          const sr = Math.max(0.85, anim.radiusPx * (0.2 + (TAIL_SPARKS - i) * 0.035))
          lctx.globalAlpha = ((TAIL_SPARKS - i + 1) / TAIL_SPARKS) * baseAlpha
          lctx.moveTo(sx + sr, sy)
          lctx.arc(sx, sy, sr, 0, Math.PI * 2)
        }
        lctx.fill()

        lctx.fillStyle = '#ff5da2'
        lctx.beginPath()
        for (let i = TAIL_SPARKS; i >= 1; i -= 1) {
          if (i % 2 === 0) continue
          const t = Math.max(0, eased - i * 0.018)
          const sx = from.x + dx * t, sy = from.y + dy * t
          const sr = Math.max(0.85, anim.radiusPx * (0.2 + (TAIL_SPARKS - i) * 0.035))
          lctx.globalAlpha = ((TAIL_SPARKS - i + 1) / TAIL_SPARKS) * baseAlpha
          lctx.moveTo(sx + sr, sy)
          lctx.arc(sx, sy, sr, 0, Math.PI * 2)
        }
        lctx.fill()
        lctx.restore()
      }
    }
  }
}
