import { Panel, useReactFlow } from '@xyflow/react'

const PAN_STEP = 180

export function CanvasPanPanel() {
  const reactFlow = useReactFlow()

  function panBy(deltaX: number, deltaY: number) {
    const viewport = reactFlow.getViewport()
    reactFlow.setViewport(
      {
        x: viewport.x + deltaX,
        y: viewport.y + deltaY,
        zoom: viewport.zoom,
      },
      { duration: 140 },
    )
  }

  return (
    <Panel position="bottom-left" className="pan-panel">
      <button type="button" className="pan-btn" onClick={() => panBy(0, PAN_STEP)} title="Pan up">
        ↑
      </button>
      <button type="button" className="pan-btn" onClick={() => panBy(PAN_STEP, 0)} title="Pan left">
        ←
      </button>
      <button type="button" className="pan-btn" onClick={() => panBy(-PAN_STEP, 0)} title="Pan right">
        →
      </button>
      <button type="button" className="pan-btn" onClick={() => panBy(0, -PAN_STEP)} title="Pan down">
        ↓
      </button>
    </Panel>
  )
}
