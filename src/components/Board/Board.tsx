import { useEffect, useMemo, useRef, useState } from 'react'
import { Background, MiniMap, ReactFlow, type Viewport } from '@xyflow/react'
import { getFolderDepth } from '../../utils/get-folder-depth'
import { BusEdge } from '../BusEdge'
import { CanvasNavWheel } from '../CanvasNavWheel'
import { ChipFileNode } from '../ChipFileNode'
import { ClassicEdge } from '../ClassicEdge'
import { FolderBlockNode } from '../FolderBlockNode'
import type { BoardProps } from './types'

export function Board({
  graphMode,
  setGraphMode,
  showExternalImports,
  setShowExternalImports,
  simplifyHighlightedRoutes,
  setSimplifyHighlightedRoutes,
  traceIntoCollapsedFolders,
  setTraceIntoCollapsedFolders,
  highlightCycles,
  setHighlightCycles,
  highlightArchitectureViolations,
  setHighlightArchitectureViolations,
  showBaselineDiff,
  setShowBaselineDiff,
  showOnlyNewDiff,
  setShowOnlyNewDiff,
  hasBaselineGraphSnapshot,
  branchDiffView,
  setBranchDiffView,
  highlightOnlyChangedBranchEdges,
  setHighlightOnlyChangedBranchEdges,
  gitBranchCompareReport,
  branchDiffVisibleFileNodeIds,
  selectedNodeId,
  setSelectedNodeId,
  directionFilter,
  setDirectionFilter,
  edgeKindFilter,
  setEdgeKindFilter,
  edgeColorPriority,
  setEdgeColorPriority,
  routingStyle,
  setRoutingStyle,
  folderPacking,
  setFolderPacking,
  autoFolderDepth,
  setAutoFolderDepth,
  setFolderControlMode,
  manualFolderDepth,
  setManualFolderDepth,
  searchQuery,
  setSearchQuery,
  collapsedBlockIds,
  setCollapsedBlockIds,
  fileNodeToBlockId,
  flowGraph,
  displayEdges,
  renderedNodes,
  matchingFileNodeIds,
  isLayouting,
  architectureViolations,
  onNodeClick,
  onNodeMouseEnter,
  onNodeMouseLeave,
  selectedInfoLine,
  hoverInfoLine,
  selectedFilePath,
  selectedImportedFiles,
  selectedImportedByFiles,
}: BoardProps) {
  const canvasShellRef = useRef<HTMLDivElement | null>(null)
  const [isCanvasFullscreen, setIsCanvasFullscreen] = useState(false)
  const [isCanvasLocked, setIsCanvasLocked] = useState(false)
  const [savedViewport, setSavedViewport] = useState<Viewport | null>(null)
  const nodeTypes = useMemo(() => ({ chipFile: ChipFileNode, folderBlock: FolderBlockNode }), [])
  const edgeTypes = useMemo(() => ({ bus: BusEdge, classicLine: ClassicEdge }), [])

  const selectedBlockId = useMemo(() => {
    if (!selectedNodeId) return null
    if (selectedNodeId.startsWith('block:')) return selectedNodeId
    return fileNodeToBlockId.get(selectedNodeId) ?? null
  }, [selectedNodeId, fileNodeToBlockId])

  const collapsibleBlockIds = useMemo(() => {
    const ids = new Set<string>()
    for (const node of flowGraph?.nodes ?? []) {
      if (!node.id.startsWith('block:')) continue
      if (getFolderDepth(node.id) > 0) ids.add(node.id)
    }
    return ids
  }, [flowGraph])

  const areAllFoldersCollapsed = useMemo(() => {
    if (collapsibleBlockIds.size === 0) return false
    for (const blockId of collapsibleBlockIds) {
      if (!collapsedBlockIds.has(blockId)) return false
    }
    return true
  }, [collapsibleBlockIds, collapsedBlockIds])

  function toggleSelectedBlockCollapse() {
    if (!selectedBlockId || graphMode !== 'file-level') return
    setAutoFolderDepth(false)
    setFolderControlMode('manual')
    setCollapsedBlockIds((previous) => {
      const next = new Set(previous)
      if (next.has(selectedBlockId)) next.delete(selectedBlockId)
      else next.add(selectedBlockId)
      return next
    })
  }

  function toggleAllFoldersCollapse() {
    if (graphMode !== 'file-level' || collapsibleBlockIds.size === 0) return
    setAutoFolderDepth(false)
    setFolderControlMode('manual')
    if (areAllFoldersCollapsed) setCollapsedBlockIds(new Set())
    else setCollapsedBlockIds(new Set(collapsibleBlockIds))
  }

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsCanvasFullscreen(document.fullscreenElement === canvasShellRef.current)
    }
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange)
  }, [])

  const toggleCanvasFullscreen = () => {
    const element = canvasShellRef.current
    if (!element) return
    if (document.fullscreenElement === element) {
      void document.exitFullscreen()
    } else {
      void element.requestFullscreen()
    }
  }

  return (
    <section className="panel grid board-grid">
      <div className="stats board-sidebar">
        <div className="flow-header">
          <h2>Dependency Canvas</h2>
          <div className="mode-switch">
            <button
              type="button"
              className={graphMode === 'file-level' ? 'is-active' : ''}
              onClick={() => setGraphMode('file-level')}
            >
              File-Level
            </button>
            <button
              type="button"
              className={graphMode === 'inter-block' ? 'is-active' : ''}
              onClick={() => setGraphMode('inter-block')}
            >
              Inter-Block
            </button>
          </div>
        </div>
        <div className="flow-controls">
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={showExternalImports}
              onChange={(event) => setShowExternalImports(event.target.checked)}
            />
            Show external imports
          </label>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={simplifyHighlightedRoutes}
              onChange={(event) => setSimplifyHighlightedRoutes(event.target.checked)}
            />
            Simplify highlighted routes
          </label>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={traceIntoCollapsedFolders}
              onChange={(event) => setTraceIntoCollapsedFolders(event.target.checked)}
            />
            Trace into collapsed folders
          </label>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={highlightCycles}
              onChange={(event) => setHighlightCycles(event.target.checked)}
            />
            Highlight cycles
          </label>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={highlightArchitectureViolations}
              onChange={(event) => setHighlightArchitectureViolations(event.target.checked)}
            />
            Highlight architecture violations
          </label>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={showBaselineDiff}
              onChange={(event) => {
                const next = event.target.checked
                setShowBaselineDiff(next)
                if (!next) {
                  setShowOnlyNewDiff(false)
                }
              }}
              disabled={!hasBaselineGraphSnapshot}
            />
            Show baseline diff
          </label>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={showOnlyNewDiff}
              onChange={(event) => setShowOnlyNewDiff(event.target.checked)}
              disabled={!showBaselineDiff || !hasBaselineGraphSnapshot}
            />
            Show only new
          </label>
          <label className="toggle-row">
            Branch diff
            <select
              value={branchDiffView}
              onChange={(event) => {
                const next = event.target.value as typeof branchDiffView
                setBranchDiffView(next)
                if (next === 'off') {
                  setHighlightOnlyChangedBranchEdges(false)
                }
              }}
              disabled={!gitBranchCompareReport}
            >
              <option value="off">off</option>
              <option value="all">all changed</option>
              <option value="added">added</option>
              <option value="modified">modified</option>
              <option value="deleted">deleted</option>
              <option value="renamed">renamed</option>
            </select>
          </label>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={highlightOnlyChangedBranchEdges}
              onChange={(event) => setHighlightOnlyChangedBranchEdges(event.target.checked)}
              disabled={!gitBranchCompareReport || branchDiffView === 'off'}
            />
            Highlight only changed edges
          </label>
          <label className="toggle-row">
            Direction
            <select
              value={directionFilter}
              onChange={(event) => setDirectionFilter(event.target.value as 'all' | 'incoming' | 'outgoing')}
              disabled={!selectedNodeId}
            >
              <option value="all">all</option>
              <option value="incoming">incoming</option>
              <option value="outgoing">outgoing</option>
            </select>
          </label>
          <label className="toggle-row">
            Edge type
            <select value={edgeKindFilter} onChange={(event) => setEdgeKindFilter(event.target.value as typeof edgeKindFilter)}>
              <option value="all">all</option>
              <option value="runtime">runtime</option>
              <option value="type">type</option>
              <option value="re-export">re-export</option>
            </select>
          </label>
          <label className="toggle-row">
            Color priority
            <select
              value={edgeColorPriority}
              onChange={(event) => setEdgeColorPriority(event.target.value as typeof edgeColorPriority)}
            >
              <option value="direction">direction</option>
              <option value="kind">kind</option>
            </select>
          </label>
          <label className="toggle-row">
            Routing
            <select
              value={routingStyle}
              onChange={(event) => setRoutingStyle(event.target.value as typeof routingStyle)}
            >
              <option value="classic">classic</option>
              <option value="bus">bus</option>
            </select>
          </label>
          <label className="toggle-row">
            Folder packing
            <select
              value={folderPacking}
              onChange={(event) => setFolderPacking(event.target.value as typeof folderPacking)}
              disabled={graphMode !== 'file-level'}
            >
              <option value="balanced">balanced</option>
              <option value="dense">dense</option>
            </select>
          </label>
          <label className="toggle-row">
            Auto depth
            <input
              type="checkbox"
              checked={autoFolderDepth}
              onChange={(event) => {
                setAutoFolderDepth(event.target.checked)
                setFolderControlMode('preset')
              }}
              disabled={graphMode !== 'file-level' || !flowGraph}
            />
          </label>
          <label className="toggle-row">
            Depth
            <select
              value={String(manualFolderDepth)}
              onChange={(event) => {
                const nextValue = event.target.value === 'any' ? 'any' : Number(event.target.value)
                setManualFolderDepth(nextValue)
                setAutoFolderDepth(false)
                setFolderControlMode('preset')
              }}
              disabled={graphMode !== 'file-level' || autoFolderDepth}
            >
              <option value="any">any</option>
              <option value={1}>1</option>
              <option value={2}>2</option>
              <option value={3}>3</option>
              <option value={4}>4</option>
              <option value={5}>5</option>
              <option value={6}>6</option>
              <option value={7}>7</option>
              <option value={8}>8</option>
            </select>
          </label>
          <label className="toggle-row search-row">
            Search file
            <input
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="name or path"
            />
          </label>
          <div className="board-action-grid">
            <button
              type="button"
              className="board-icon-btn"
              title={selectedBlockId && collapsedBlockIds.has(selectedBlockId) ? 'Expand selected block' : 'Collapse selected block'}
              aria-label={selectedBlockId && collapsedBlockIds.has(selectedBlockId) ? 'Expand selected block' : 'Collapse selected block'}
              onClick={toggleSelectedBlockCollapse}
              disabled={graphMode !== 'file-level' || !selectedBlockId}
            >
              {selectedBlockId && collapsedBlockIds.has(selectedBlockId) ? '⤢' : '⤡'}
            </button>
            <button
              type="button"
              className="board-icon-btn"
              title={areAllFoldersCollapsed ? 'Expand all folders' : 'Collapse all folders'}
              aria-label={areAllFoldersCollapsed ? 'Expand all folders' : 'Collapse all folders'}
              onClick={toggleAllFoldersCollapse}
              disabled={graphMode !== 'file-level' || collapsibleBlockIds.size === 0}
            >
              {areAllFoldersCollapsed ? '⤢' : '⤡'}
            </button>
            <button
              type="button"
              className="board-icon-btn"
              title="Clear selection"
              aria-label="Clear selection"
              onClick={() => {
                setSelectedNodeId(null)
                setDirectionFilter('all')
              }}
              disabled={!selectedNodeId}
            >
              ⨯
            </button>
          </div>
        </div>
        <div className="board-legend">
          <span className="legend-item">
            <span className="legend-swatch legend-swatch-neutral" />
            Runtime edge
          </span>
          <span className="legend-item">
            <span className="legend-swatch legend-swatch-type" />
            Type edge
          </span>
          <span className="legend-item">
            <span className="legend-swatch legend-swatch-reexport" />
            Re-export edge
          </span>
          <span className="legend-item">
            <span className="legend-swatch legend-swatch-violation" />
            Architecture violation
          </span>
          <span className="legend-item">
            <span className="legend-swatch legend-swatch-diff" />
            New vs baseline
          </span>
          <span className="legend-item">
            <span className="legend-swatch legend-swatch-branch-added" />
            Branch: added
          </span>
          <span className="legend-item">
            <span className="legend-swatch legend-swatch-branch-modified" />
            Branch: modified
          </span>
          <span className="legend-item">
            <span className="legend-swatch legend-swatch-branch-deleted" />
            Branch: deleted
          </span>
          <span className="legend-item">
            <span className="legend-swatch legend-swatch-branch-renamed" />
            Branch: renamed
          </span>
          <span className="legend-item">
            <span className="legend-swatch legend-swatch-import" />
            Incoming (selected)
          </span>
          <span className="legend-item">
            <span className="legend-swatch legend-swatch-export" />
            Outgoing (selected)
          </span>
          <span className="legend-note">
            `Color priority` controls whether selected edges keep kind colors or switch to direction colors.
          </span>
          {showBaselineDiff && (
            <span className="legend-note">`Show only new` hides baseline nodes/edges and leaves only additions.</span>
          )}
          {!hasBaselineGraphSnapshot && (
            <span className="legend-note">Load baseline JSON in Diagnostics to enable diff mode.</span>
          )}
          {!gitBranchCompareReport && (
            <span className="legend-note">Load branch compare JSON in Diagnostics to enable branch overlay.</span>
          )}
          {gitBranchCompareReport && branchDiffView !== 'off' && highlightOnlyChangedBranchEdges && (
            <span className="legend-note">`Highlight only changed edges` hides non-matching edges and keeps nodes unchanged.</span>
          )}
        </div>
      </div>
      <div className="board-main">
        {flowGraph ? (
          <>
            <p className="canvas-meta">
              Blocks: {flowGraph.blockCount}, Nodes: {flowGraph.nodes.length}, Visible edges: {displayEdges.length}
              {' | '}Cycles: {flowGraph.cycleEdgeCount}
              {' | '}Matches: {matchingFileNodeIds.size}
              {gitBranchCompareReport && branchDiffView !== 'off'
                ? ` | Branch matches: ${branchDiffVisibleFileNodeIds.size}`
                : ''}
              {isLayouting ? ' | Layout: running...' : ' | Layout: ELK ready'}
            </p>
            <div className="canvas-shell" ref={canvasShellRef}>
              <button
                type="button"
                className="canvas-fullscreen-btn"
                onClick={toggleCanvasFullscreen}
                title={isCanvasFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
              >
                {isCanvasFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              </button>
              <ReactFlow
                key={`rf-${graphMode}-${routingStyle}-${folderPacking}-${
                  routingStyle === 'classic'
                    ? `${selectedNodeId ?? 'none'}-${directionFilter}-${edgeKindFilter}-${edgeColorPriority}`
                    : `stable-${edgeKindFilter}-${edgeColorPriority}`
                }-${highlightArchitectureViolations ? 'arch-on' : 'arch-off'}-${
                  showBaselineDiff ? 'diff-on' : 'diff-off'
                }-${showOnlyNewDiff ? 'only-new' : 'all-diff'}-${
                  hasBaselineGraphSnapshot ? 'baseline-ready' : 'baseline-missing'
                }-${
                  architectureViolations.length
                }`}
                nodes={renderedNodes}
                edges={displayEdges}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                onNodeClick={onNodeClick}
                onPaneClick={() => {
                  setSelectedNodeId(null)
                  setDirectionFilter('all')
                }}
                onNodeMouseEnter={onNodeMouseEnter}
                onNodeMouseLeave={onNodeMouseLeave}
                defaultViewport={savedViewport ?? { x: 0, y: 0, zoom: 1 }}
                fitView={!savedViewport}
                minZoom={0.1}
                maxZoom={1.5}
                panOnDrag={!isCanvasLocked}
                panOnScroll={!isCanvasLocked}
                zoomOnScroll={!isCanvasLocked}
                zoomOnPinch={!isCanvasLocked}
                zoomOnDoubleClick={!isCanvasLocked}
                nodesDraggable={!isCanvasLocked}
                elementsSelectable={!isCanvasLocked}
                onInit={(instance) => {
                  setSavedViewport(instance.getViewport())
                }}
                onMoveEnd={(_event, viewport) => {
                  setSavedViewport(viewport)
                }}
              >
                <MiniMap
                  position="bottom-right"
                  pannable
                  zoomable
                  nodeColor="#335f82"
                  bgColor="rgba(4, 16, 29, 0.92)"
                  maskColor="rgba(2, 9, 16, 0.72)"
                />
                <CanvasNavWheel
                  isLocked={isCanvasLocked}
                  onToggleLock={() => setIsCanvasLocked((previous) => !previous)}
                />
                <Background gap={24} size={1} color="#3a6689" />
              </ReactFlow>
            </div>
            <p className="canvas-selected-strip" title={selectedInfoLine}>
              Selected: <span className="canvas-selected-value">{selectedInfoLine}</span>
            </p>
            <p className="canvas-hover-strip" title={hoverInfoLine}>
              Hover: <span className="canvas-hover-value">{hoverInfoLine}</span>
            </p>
            <div className="canvas-selected-io">
              {selectedFilePath ? (
                <>
                  <div className="canvas-selected-io-col">
                    <h4 title="Files this file imports">
                      Imports ({selectedImportedFiles.length})
                    </h4>
                    {selectedImportedFiles.length > 0 ? (
                      <ul>
                        {selectedImportedFiles.map((path) => (
                          <li
                            key={`imp-${path}`}
                            title={path}
                            onClick={() => setSelectedNodeId(`file:${path}`)}
                          >
                            {path}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="canvas-selected-io-empty">none</p>
                    )}
                  </div>
                  <div className="canvas-selected-io-col">
                    <h4 title="Files that import this file">
                      Used by ({selectedImportedByFiles.length})
                    </h4>
                    {selectedImportedByFiles.length > 0 ? (
                      <ul>
                        {selectedImportedByFiles.map((path) => (
                          <li
                            key={`impby-${path}`}
                            title={path}
                            onClick={() => setSelectedNodeId(`file:${path}`)}
                          >
                            {path}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="canvas-selected-io-empty">none</p>
                    )}
                  </div>
                </>
              ) : (
                <p className="canvas-selected-io-empty">
                  {selectedNodeId
                    ? 'Select a file node to see incoming and outgoing imports.'
                    : 'No file selected.'}
                </p>
              )}
            </div>
          </>
        ) : (
          <p className="canvas-meta">Scan a folder to build and render dependency canvas.</p>
        )}
      </div>
    </section>
  )
}
