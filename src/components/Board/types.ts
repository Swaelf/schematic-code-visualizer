import type { Edge, EdgeTypes, Node, NodeMouseHandler, NodeTypes, Viewport } from '@xyflow/react'
import type { RefObject } from 'react'
import type { BuiltGraph, FolderPackingMode, GraphBuildMode, RoutingStyle } from '../../lib/graph-builder'
import type {
  ArchitectureViolation,
  BranchDiffView,
  EdgeColorPriority,
  EdgeKindFilter,
  FolderControlMode,
  GitBranchCompareReport,
  ManualFolderDepth,
} from '../../types'

export type BoardProps = {
  graphMode: GraphBuildMode
  setGraphMode: (mode: GraphBuildMode) => void

  // Toggles
  showExternalImports: boolean
  setShowExternalImports: (value: boolean) => void
  simplifyHighlightedRoutes: boolean
  setSimplifyHighlightedRoutes: (value: boolean) => void
  traceIntoCollapsedFolders: boolean
  setTraceIntoCollapsedFolders: (value: boolean) => void
  highlightCycles: boolean
  setHighlightCycles: (value: boolean) => void
  highlightArchitectureViolations: boolean
  setHighlightArchitectureViolations: (value: boolean) => void
  showBaselineDiff: boolean
  setShowBaselineDiff: (value: boolean) => void
  showOnlyNewDiff: boolean
  setShowOnlyNewDiff: (value: boolean) => void
  hasBaselineGraphSnapshot: boolean

  // Branch diff
  branchDiffView: BranchDiffView
  setBranchDiffView: (value: BranchDiffView) => void
  highlightOnlyChangedBranchEdges: boolean
  setHighlightOnlyChangedBranchEdges: (value: boolean) => void
  gitBranchCompareReport: GitBranchCompareReport | null
  branchDiffVisibleFileNodeIds: Set<string>

  // Selection / direction
  selectedNodeId: string | null
  setSelectedNodeId: (value: string | null) => void
  directionFilter: 'all' | 'incoming' | 'outgoing'
  setDirectionFilter: (value: 'all' | 'incoming' | 'outgoing') => void

  // Edge / color / routing
  edgeKindFilter: EdgeKindFilter
  setEdgeKindFilter: (value: EdgeKindFilter) => void
  edgeColorPriority: EdgeColorPriority
  setEdgeColorPriority: (value: EdgeColorPriority) => void
  routingStyle: RoutingStyle
  setRoutingStyle: (value: RoutingStyle) => void
  folderPacking: FolderPackingMode
  setFolderPacking: (value: FolderPackingMode) => void

  // Folder depth controls
  autoFolderDepth: boolean
  setAutoFolderDepth: (value: boolean) => void
  setFolderControlMode: (value: FolderControlMode) => void
  manualFolderDepth: ManualFolderDepth
  setManualFolderDepth: (value: ManualFolderDepth) => void

  // Search & collapse
  searchQuery: string
  setSearchQuery: (value: string) => void
  selectedBlockId: string | null
  collapsedBlockIds: Set<string>
  collapsibleBlockIds: Set<string>
  areAllFoldersCollapsed: boolean
  toggleSelectedBlockCollapse: () => void
  toggleAllFoldersCollapse: () => void

  // Canvas core
  flowGraph: BuiltGraph | null
  displayEdges: Edge[]
  renderedNodes: Node[]
  nodeTypes: NodeTypes
  edgeTypes: EdgeTypes
  matchingFileNodeIds: Set<string>
  isLayouting: boolean
  architectureViolations: ArchitectureViolation[]

  // Canvas interaction
  canvasShellRef: RefObject<HTMLDivElement | null>
  toggleCanvasFullscreen: () => void
  isCanvasFullscreen: boolean
  onNodeClick: NodeMouseHandler
  onNodeMouseEnter: NodeMouseHandler
  onNodeMouseLeave: NodeMouseHandler
  isCanvasLocked: boolean
  setIsCanvasLocked: (updater: (previous: boolean) => boolean) => void
  savedViewport: Viewport | null
  setSavedViewport: (value: Viewport) => void

  // Bottom strips / IO panel
  selectedInfoLine: string
  hoverInfoLine: string
  selectedFilePath: string | null
  selectedImportedFiles: string[]
  selectedImportedByFiles: string[]
}
