import { useAppStore } from '@/features/graph/app/store'
import type { ArrowType } from '@/features/graph/app/store/types'
import { createInitialUiSliceState } from '@/features/graph/app/store/slices/uiSlice'
import { normalizeAvatarZoomThresholds } from '@/features/graph/render/avatarQualityGuide'

const DEFAULT_RENDER_CONFIG = createInitialUiSliceState().renderConfig

export function RenderConfigPanel() {
  const renderConfig = useAppStore((state) => state.renderConfig)
  const setRenderConfig = useAppStore((state) => state.setRenderConfig)
  const zoomThresholds = normalizeAvatarZoomThresholds(renderConfig)

  return (
    <div className="settings-form">
      <section className="settings-card">
        <div className="settings-card__title-row">
          <h3>Connections</h3>
        </div>

        <div className="settings-field">
          <div className="settings-field__label-row">
            <label htmlFor="edge-thickness-input">Peso de conexiones</label>
            <span>{renderConfig.edgeThickness}px</span>
          </div>
          <input
            id="edge-thickness-input"
            max="5"
            min="1"
            onChange={(event) =>
              setRenderConfig({ edgeThickness: parseFloat(event.target.value) })
            }
            step="0.5"
            type="range"
            value={renderConfig.edgeThickness}
          />
        </div>

        <div className="settings-field">
          <label htmlFor="arrow-type-select">Direccion</label>
          <select
            id="arrow-type-select"
            onChange={(event) =>
              setRenderConfig({ arrowType: event.target.value as ArrowType })
            }
            value={renderConfig.arrowType}
          >
            <option value="none">Ninguna</option>
            <option value="arrow">Linea V</option>
            <option value="triangle">Triangulo</option>
          </select>
        </div>
      </section>

      <section className="settings-card">
        <div className="settings-card__title-row">
          <h3>Nodes</h3>
        </div>

        <label className="settings-toggle">
          <input
            checked={renderConfig.autoSizeNodes}
            onChange={(event) =>
              setRenderConfig({ autoSizeNodes: event.target.checked })
            }
            type="checkbox"
          />
          <span>Escala automatica</span>
        </label>

        <div className="settings-field">
          <div className="settings-field__label-row">
            <label htmlFor="node-size-input">Escala manual</label>
            <span>
              {renderConfig.autoSizeNodes
                ? 'Auto'
                : `${renderConfig.nodeSizeFactor.toFixed(1)}x`}
            </span>
          </div>
          <input
            disabled={renderConfig.autoSizeNodes}
            id="node-size-input"
            max="2.5"
            min="0.5"
            onChange={(event) =>
              setRenderConfig({ nodeSizeFactor: parseFloat(event.target.value) })
            }
            step="0.1"
            type="range"
            value={renderConfig.nodeSizeFactor}
          />
        </div>

        <div className="settings-field">
          <div className="settings-field__label-row">
            <label htmlFor="node-spacing-input">Separacion del layout</label>
            <span>{renderConfig.nodeSpacingFactor.toFixed(1)}x</span>
          </div>
          <input
            id="node-spacing-input"
            max="2.5"
            min="0.5"
            onChange={(event) =>
              setRenderConfig({
                nodeSpacingFactor: parseFloat(event.target.value),
              })
            }
            step="0.1"
            type="range"
            value={renderConfig.nodeSpacingFactor}
          />
        </div>
      </section>

      <section className="settings-card">
        <div className="settings-card__title-row">
          <h3>Images and emphasis</h3>
        </div>

        <label className="settings-toggle">
          <input
            checked={renderConfig.showDiscoveryState ?? true}
            onChange={(event) =>
              setRenderConfig({ showDiscoveryState: event.target.checked })
            }
            type="checkbox"
          />
          <span>Mostrar Discovery state</span>
        </label>

        <div className="settings-field">
          <div className="settings-field__label-row">
            <label htmlFor="avatar-hd-zoom-threshold-input">
              Zoom minimo para HD
            </label>
            <span>{zoomThresholds.avatarHdZoomThreshold.toFixed(2)}</span>
          </div>
          <input
            id="avatar-hd-zoom-threshold-input"
            max={zoomThresholds.avatarFullHdZoomThreshold}
            min="0.5"
            onChange={(event) =>
              setRenderConfig({
                avatarHdZoomThreshold: parseFloat(event.target.value),
              })
            }
            step="0.05"
            type="range"
            value={zoomThresholds.avatarHdZoomThreshold}
          />
        </div>

        <div className="settings-field">
          <div className="settings-field__label-row">
            <label htmlFor="avatar-full-hd-zoom-threshold-input">
              Zoom minimo para Full HD
            </label>
            <span>{zoomThresholds.avatarFullHdZoomThreshold.toFixed(2)}</span>
          </div>
          <input
            id="avatar-full-hd-zoom-threshold-input"
            max="4"
            min={zoomThresholds.avatarHdZoomThreshold}
            onChange={(event) =>
              setRenderConfig({
                avatarFullHdZoomThreshold: parseFloat(event.target.value),
              })
            }
            step="0.05"
            type="range"
            value={zoomThresholds.avatarFullHdZoomThreshold}
          />
          <p className="settings-field__hint">
            El pipeline de imagen corre fijo en Full HD. Estos umbrales solo
            deciden desde que zoom entra el escalon HD y cuando sube al escalon
            Full HD.
          </p>
        </div>

        <label className="settings-toggle">
          <input
            checked={renderConfig.showSharedEmphasis}
            onChange={(event) =>
              setRenderConfig({ showSharedEmphasis: event.target.checked })
            }
            type="checkbox"
          />
          <span>Resaltar nodos compartidos</span>
        </label>

        <label className="settings-toggle">
          <input
            checked={renderConfig.showAvatarQualityGuide ?? false}
            onChange={(event) =>
              setRenderConfig({ showAvatarQualityGuide: event.target.checked })
            }
            type="checkbox"
          />
          <span>Mostrar guia de calidad por zoom</span>
        </label>

        <button
          className="settings-secondary-btn"
          onClick={() =>
            setRenderConfig({
              ...DEFAULT_RENDER_CONFIG,
            })
          }
          type="button"
        >
          Restaurar predeterminados
        </button>
      </section>
    </div>
  )
}
