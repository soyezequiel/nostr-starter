'use client'

interface Props {
  zoomRatio: number | null
  onZoomIn: () => void
  onZoomOut: () => void
  onFit: () => void
}

export function SigmaMinimap({ zoomRatio, onZoomIn, onZoomOut, onFit }: Props) {
  const zoomLabel = zoomRatio != null ? zoomRatio.toFixed(2) + '×' : '—'

  return (
    <div className="sg-minimap">
      <div className="sg-minimap__head">
        <span>MAPA</span>
        <span>{zoomLabel}</span>
      </div>
      <div className="sg-minimap__canvas">
        <div className="sg-minimap__canvas-dot" />
      </div>
      <div className="sg-minimap__foot">
        <button onClick={onZoomIn} title="Acercar" type="button">＋</button>
        <div className="sg-minimap__sep" />
        <button onClick={onZoomOut} title="Alejar" type="button">−</button>
        <div className="sg-minimap__sep" />
        <button onClick={onFit} title="Ajustar" type="button">fit</button>
      </div>
    </div>
  )
}
