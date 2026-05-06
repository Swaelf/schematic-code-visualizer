import type { NodeProps } from '@xyflow/react'

type FolderBlockData = {
  label: string
  importCount: number
  exportCount: number
  exportPinYs?: number[]
  importPinYs?: number[]
}

export function FolderBlockNode({ data }: NodeProps) {
  const blockData = data as FolderBlockData
  const exportPinYs = blockData.exportPinYs ?? []
  const importPinYs = blockData.importPinYs ?? []

  return (
    <div className="folder-block-node">
      <div className="folder-header">{blockData.label}</div>
      <div className="folder-bus folder-bus-import">
        <span className="folder-bus-label">IMPORT BUS ({blockData.importCount})</span>
      </div>
      <div className="folder-bus folder-bus-export">
        <span className="folder-bus-label">EXPORT BUS ({blockData.exportCount})</span>
      </div>
      {importPinYs.length === 0 ? (
        <div className="folder-boundary-pin folder-boundary-pin-import" title="Folder import boundary pin" />
      ) : (
        importPinYs.map((y, index) => (
          <div
            key={`imp-${index}-${y}`}
            className="folder-pin folder-pin-import"
            style={{ top: y }}
            title="Folder import pin"
          />
        ))
      )}
      {exportPinYs.length === 0 ? (
        <div className="folder-boundary-pin folder-boundary-pin-export" title="Folder export boundary pin" />
      ) : (
        exportPinYs.map((y, index) => (
          <div
            key={`exp-${index}-${y}`}
            className="folder-pin folder-pin-export"
            style={{ top: y }}
            title="Folder export pin"
          />
        ))
      )}
    </div>
  )
}
