import { Handle, Position, type NodeProps } from '@xyflow/react'

type ChipNodeData = {
  label: string
  path: string
  importCount: number
  exportCount: number
}

function renderPins(limit: number, className: string) {
  return Array.from({ length: limit }, (_, index) => <span key={`${className}-${index}`} className={className} />)
}

export function ChipFileNode({ data }: NodeProps) {
  const chipData = data as ChipNodeData
  const visibleImportPins = Math.min(Math.max(chipData.importCount, 1), 6)
  const visibleExportPins = Math.min(Math.max(chipData.exportCount, 1), 6)

  return (
    <div className="chip-node">
      <Handle type="target" position={Position.Left} className="chip-handle chip-handle-import" />
      <Handle type="source" position={Position.Right} className="chip-handle chip-handle-export" />

      <div className="chip-rail chip-rail-left">{renderPins(visibleImportPins, 'chip-pin chip-pin-import')}</div>
      <div className="chip-body">
        <div className="chip-label">{chipData.label}</div>
        <div className="chip-meta">{chipData.path}</div>
        <div className="chip-counts">
          <span className="chip-count chip-count-import">I {chipData.importCount}</span>
          <span className="chip-count chip-count-export">E {chipData.exportCount}</span>
        </div>
      </div>
      <div className="chip-rail chip-rail-right">{renderPins(visibleExportPins, 'chip-pin chip-pin-export')}</div>
    </div>
  )
}
