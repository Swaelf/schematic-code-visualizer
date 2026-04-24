import type { NodeProps } from '@xyflow/react'

type FolderBlockData = {
  label: string
  importCount: number
  exportCount: number
}

export function FolderBlockNode({ data }: NodeProps) {
  const blockData = data as FolderBlockData

  return (
    <div className="folder-block-node">
      <div className="folder-header">{blockData.label}</div>
      <div className="folder-bus folder-bus-import">
        <span className="folder-bus-label">IMPORT BUS ({blockData.importCount})</span>
      </div>
      <div className="folder-bus folder-bus-export">
        <span className="folder-bus-label">EXPORT BUS ({blockData.exportCount})</span>
      </div>
      <div className="folder-boundary-pin folder-boundary-pin-import" title="Folder import boundary pin" />
      <div className="folder-boundary-pin folder-boundary-pin-export" title="Folder export boundary pin" />
    </div>
  )
}
