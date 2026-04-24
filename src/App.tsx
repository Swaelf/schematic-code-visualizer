import { useEffect, useMemo, useState } from 'react'
import { Background, Controls, MiniMap, ReactFlow, type NodeMouseHandler } from '@xyflow/react'
import { analyzeProjectDependenciesInWorker } from './lib/analyzer-worker-client'
import { applyElkToBlockNodes } from './lib/elk-layout'
import { buildDependencyFlowGraph, type GraphBuildMode } from './lib/graph-builder'
import type { DependencyGraph, FileAnalysis, ScannedProject } from './lib/models'
import { scanProjectFolder } from './lib/scanner'
import { readTsConfigAliasConfig } from './lib/tsconfig-reader'
import { buildTreeLines } from './lib/tree-view'
import './App.css'
import '@xyflow/react/dist/style.css'

type AppTab = 'overview' | 'board' | 'dependencies' | 'diagnostics'

function App() {
  const [activeTab, setActiveTab] = useState<AppTab>('overview')
  const [scanResult, setScanResult] = useState<ScannedProject | null>(null)
  const [dependencyGraph, setDependencyGraph] = useState<DependencyGraph | null>(null)
  const [graphMode, setGraphMode] = useState<GraphBuildMode>('file-level')
  const [highlightCycles, setHighlightCycles] = useState(false)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [directionFilter, setDirectionFilter] = useState<'all' | 'incoming' | 'outgoing'>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [collapsedBlockIds, setCollapsedBlockIds] = useState<Set<string>>(new Set())
  const [hoveredFilePath, setHoveredFilePath] = useState<string | null>(null)
  const [layoutedNodes, setLayoutedNodes] = useState<ReturnType<typeof buildDependencyFlowGraph>['nodes']>([])
  const [isLayouting, setIsLayouting] = useState(false)
  const [isScanning, setIsScanning] = useState(false)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const treeLines = useMemo(() => buildTreeLines(scanResult?.tree ?? null), [scanResult])

  const isPickerAvailable = typeof window !== 'undefined' && 'showDirectoryPicker' in window

  const topConnectedFiles = useMemo(() => {
    if (!dependencyGraph) {
      return []
    }
    return [...dependencyGraph.files]
      .sort(
        (left, right) =>
          right.resolvedImports.length - left.resolvedImports.length ||
          left.path.localeCompare(right.path),
      )
      .slice(0, 8)
  }, [dependencyGraph])

  const previewEdges = useMemo(() => dependencyGraph?.edges.slice(0, 20) ?? [], [dependencyGraph])
  const fileAnalysisByPath = useMemo(() => {
    const map = new Map<string, FileAnalysis>()
    for (const file of dependencyGraph?.files ?? []) {
      map.set(file.path, file)
    }
    return map
  }, [dependencyGraph])

  const flowGraph = useMemo(() => {
    if (!scanResult || !dependencyGraph) {
      return null
    }
    return buildDependencyFlowGraph(scanResult, dependencyGraph, graphMode, { highlightCycles })
  }, [scanResult, dependencyGraph, graphMode, highlightCycles])

  const fileNodeToBlockId = useMemo(() => {
    const map = new Map<string, string>()
    for (const node of flowGraph?.nodes ?? []) {
      if (node.parentId && node.id.startsWith('file:')) {
        map.set(node.id, node.parentId)
      }
    }
    return map
  }, [flowGraph])

  const normalizedSearchQuery = searchQuery.trim().toLowerCase()
  const matchingFileNodeIds = useMemo(() => {
    if (!flowGraph || !normalizedSearchQuery) {
      return new Set<string>()
    }
    const ids = new Set<string>()
    for (const node of flowGraph.nodes) {
      if (!node.id.startsWith('file:')) {
        continue
      }
      const filePath = node.id.slice(5)
      const label = String(node.data?.label ?? '')
      if (label.toLowerCase().includes(normalizedSearchQuery) || filePath.toLowerCase().includes(normalizedSearchQuery)) {
        ids.add(node.id)
      }
    }
    return ids
  }, [flowGraph, normalizedSearchQuery])

  const blockIdsWithMatches = useMemo(() => {
    const ids = new Set<string>()
    for (const fileNodeId of matchingFileNodeIds) {
      const blockId = fileNodeToBlockId.get(fileNodeId)
      if (blockId) {
        ids.add(blockId)
      }
    }
    return ids
  }, [matchingFileNodeIds, fileNodeToBlockId])

  const hiddenNodeIds = useMemo(() => {
    const ids = new Set<string>()
    if (!flowGraph || graphMode !== 'file-level' || collapsedBlockIds.size === 0) {
      return ids
    }
    for (const node of flowGraph.nodes) {
      if (node.parentId && collapsedBlockIds.has(node.parentId)) {
        ids.add(node.id)
      }
    }
    return ids
  }, [flowGraph, graphMode, collapsedBlockIds])

  const visibleEdges = useMemo(() => {
    if (!flowGraph) {
      return []
    }
    const filteredByCollapse = flowGraph.edges.filter(
      (edge) => !hiddenNodeIds.has(edge.source) && !hiddenNodeIds.has(edge.target),
    )
    if (!selectedNodeId) {
      return filteredByCollapse
    }
    if (directionFilter === 'incoming') {
      return filteredByCollapse.filter((edge) => edge.target === selectedNodeId)
    }
    if (directionFilter === 'outgoing') {
      return filteredByCollapse.filter((edge) => edge.source === selectedNodeId)
    }
    return filteredByCollapse.filter((edge) => edge.source === selectedNodeId || edge.target === selectedNodeId)
  }, [flowGraph, hiddenNodeIds, selectedNodeId, directionFilter])

  const connectedNodeIds = useMemo(() => {
    const ids = new Set<string>()
    if (!selectedNodeId) {
      return ids
    }
    ids.add(selectedNodeId)
    for (const edge of visibleEdges) {
      ids.add(edge.source)
      ids.add(edge.target)
    }
    return ids
  }, [selectedNodeId, visibleEdges])

  const visibleNodes = useMemo(() => {
    if (!flowGraph || layoutedNodes.length === 0) {
      return []
    }
    return layoutedNodes
      .filter((node) => !hiddenNodeIds.has(node.id))
      .map((node) => {
      const isSelected = node.id === selectedNodeId
      const isConnected = connectedNodeIds.has(node.id)
      const isFileNode = node.id.startsWith('file:')
      const isMatch = matchingFileNodeIds.has(node.id)
      const isBlockWithMatch = blockIdsWithMatches.has(node.id)
      const nextStyle = {
        ...(node.style ?? {}),
        opacity: 1,
      }
      if (selectedNodeId) {
        nextStyle.opacity = isConnected ? 1 : 0.32
      }
      if (normalizedSearchQuery) {
        if (isFileNode && !isMatch) {
          nextStyle.opacity = Math.min(nextStyle.opacity, 0.2)
        }
        if (!isFileNode && !isBlockWithMatch) {
          nextStyle.opacity = Math.min(nextStyle.opacity, 0.3)
        }
      }
      if (isSelected) {
        nextStyle.border = '2px solid #ffe79f'
      }
      if (normalizedSearchQuery && isMatch) {
        nextStyle.boxShadow = '0 0 0 2px rgba(255, 231, 159, 0.55)'
      } else {
        nextStyle.boxShadow = 'none'
      }
      return {
        ...node,
        style: nextStyle,
      }
    })
  }, [
    flowGraph,
    layoutedNodes,
    hiddenNodeIds,
    selectedNodeId,
    connectedNodeIds,
    normalizedSearchQuery,
    matchingFileNodeIds,
    blockIdsWithMatches,
  ])

  useEffect(() => {
    let isCancelled = false

    async function runLayout() {
      if (!flowGraph) {
        setLayoutedNodes([])
        return
      }

      setLayoutedNodes(flowGraph.nodes)
      setIsLayouting(true)
      try {
        const nextNodes = await applyElkToBlockNodes(flowGraph.nodes, flowGraph.blockLayoutEdges)
        if (!isCancelled) {
          setLayoutedNodes(nextNodes)
        }
      } catch (error) {
        if (!isCancelled) {
          setLayoutedNodes(flowGraph.nodes)
          console.error('ELK layout failed, using fallback positions.', error)
        }
      } finally {
        if (!isCancelled) {
          setIsLayouting(false)
        }
      }
    }

    runLayout()
    return () => {
      isCancelled = true
    }
  }, [flowGraph])

  useEffect(() => {
    setSelectedNodeId(null)
    setDirectionFilter('all')
    setCollapsedBlockIds(new Set())
    setSearchQuery('')
    setHoveredFilePath(null)
    setActiveTab('overview')
  }, [graphMode, scanResult?.rootName])

  async function handlePickDirectory() {
    if (!isPickerAvailable) {
      setErrorMessage('Your browser does not support File System Access API (use Chromium-based browser).')
      return
    }

    setIsScanning(true)
    setIsAnalyzing(false)
    setErrorMessage(null)

    try {
      const directoryHandle = await window.showDirectoryPicker({
        mode: 'read',
      })
      const scannedProject = await scanProjectFolder(directoryHandle)
      const tsconfigAliases = await readTsConfigAliasConfig(directoryHandle)
      setScanResult(scannedProject)
      setIsAnalyzing(true)
      const graph = await analyzeProjectDependenciesInWorker(scannedProject.files, {
        rootName: scannedProject.rootName,
        tsconfigAliases,
      })
      setDependencyGraph(graph)
    } catch (error) {
      if ((error as DOMException).name === 'AbortError') {
        return
      }
      setErrorMessage('Failed to scan or analyze the selected directory.')
      console.error(error)
    } finally {
      setIsScanning(false)
      setIsAnalyzing(false)
    }
  }

  const onNodeClick: NodeMouseHandler = (_event, node) => {
    if (graphMode === 'inter-block' && node.parentId) {
      setSelectedNodeId(node.parentId)
      return
    }
    setSelectedNodeId(node.id)
  }

  const onNodeMouseEnter: NodeMouseHandler = (_event, node) => {
    if (!node.id.startsWith('file:')) {
      setHoveredFilePath(null)
      return
    }
    setHoveredFilePath(node.id.slice(5))
  }

  const onNodeMouseLeave: NodeMouseHandler = () => {
    setHoveredFilePath(null)
  }

  const isBusy = isScanning || isAnalyzing

  function pickButtonLabel() {
    if (isScanning) {
      return 'Scanning files...'
    }
    if (isAnalyzing) {
      return 'Analyzing dependencies...'
    }
    return 'Select Project Folder'
  }

  const selectedBlockId = useMemo(() => {
    if (!selectedNodeId) {
      return null
    }
    if (selectedNodeId.startsWith('block:')) {
      return selectedNodeId
    }
    return fileNodeToBlockId.get(selectedNodeId) ?? null
  }, [selectedNodeId, fileNodeToBlockId])

  const hoveredFileAnalysis = hoveredFilePath ? fileAnalysisByPath.get(hoveredFilePath) : null

  function toggleSelectedBlockCollapse() {
    if (!selectedBlockId || graphMode !== 'file-level') {
      return
    }
    setCollapsedBlockIds((previous) => {
      const next = new Set(previous)
      if (next.has(selectedBlockId)) {
        next.delete(selectedBlockId)
      } else {
        next.add(selectedBlockId)
      }
      return next
    })
  }

  return (
    <main className="app-shell">
      <section className="panel">
        <h1>Schematic Code Visualizer</h1>
        <p className="subtitle">
          Iteration v1 scans TypeScript files and maps directory structure into logical board blocks.
        </p>
        <div className="actions">
          <button type="button" onClick={handlePickDirectory} disabled={isBusy}>
            {pickButtonLabel()}
          </button>
          <span className="hint">Supported: `.ts`, `.tsx`; excludes `node_modules`, `.git`, `dist`, `build`.</span>
        </div>
        {errorMessage && <p className="error">{errorMessage}</p>}
      </section>

      <section className="panel tab-nav">
        <button type="button" className={activeTab === 'overview' ? 'is-active' : ''} onClick={() => setActiveTab('overview')}>
          Overview
        </button>
        <button type="button" className={activeTab === 'board' ? 'is-active' : ''} onClick={() => setActiveTab('board')}>
          Board
        </button>
        <button
          type="button"
          className={activeTab === 'dependencies' ? 'is-active' : ''}
          onClick={() => setActiveTab('dependencies')}
        >
          Dependencies
        </button>
        <button
          type="button"
          className={activeTab === 'diagnostics' ? 'is-active' : ''}
          onClick={() => setActiveTab('diagnostics')}
        >
          Diagnostics
        </button>
      </section>

      {activeTab === 'overview' && (
        <section className="panel grid">
          <div className="stats">
            <h2>Scan Summary</h2>
            <p>
              <strong>Root:</strong> {scanResult?.rootName ?? '-'}
            </p>
            <p>
              <strong>Directories:</strong> {scanResult?.directoryCount ?? 0}
            </p>
            <p>
              <strong>TS Files:</strong> {scanResult?.tsFileCount ?? 0}
            </p>
            <p>
              <strong>Dependency Edges:</strong> {dependencyGraph?.edges.length ?? 0}
            </p>
            <p>
              <strong>Cycles:</strong> {flowGraph?.cycleEdgeCount ?? 0}
            </p>
            <p>
              <strong>Search Matches:</strong> {matchingFileNodeIds.size}
            </p>
          </div>
          <div className="tree">
            <h2>Directory Tree</h2>
            <pre>{treeLines.length > 0 ? treeLines.join('\n') : 'Select a folder to scan.'}</pre>
          </div>
        </section>
      )}

      {activeTab === 'dependencies' && (
        <section className="panel grid">
          <div className="stats">
            <h2>Top Connected Files</h2>
            {topConnectedFiles.length > 0 ? (
              <ul className="flat-list">
                {topConnectedFiles.map((file) => (
                  <li key={file.path}>
                    <code>{file.path}</code> ({file.resolvedImports.length} links, {file.exports.length} exports)
                  </li>
                ))}
              </ul>
            ) : (
              <p>No dependency data yet.</p>
            )}
          </div>
          <div className="tree">
            <h2>Dependency Preview (first 20 edges)</h2>
            <pre>
              {previewEdges.length > 0
                ? previewEdges.map((edge) => `${edge.fromPath} -> ${edge.toPath}`).join('\n')
                : 'Scan a folder to generate dependency edges.'}
            </pre>
          </div>
        </section>
      )}

      {activeTab === 'diagnostics' && (
        <section className="panel grid">
          <div className="stats">
            <h2>Resolver Diagnostics</h2>
            <p>
              <strong>Unresolved Imports:</strong> {dependencyGraph?.unresolvedImportCount ?? 0}
            </p>
            <p>
              <strong>Unresolved External:</strong> {dependencyGraph?.unresolvedExternalCount ?? 0}
            </p>
            <p>
              <strong>Unresolved Internal:</strong> {dependencyGraph?.unresolvedInternalCount ?? 0}
            </p>
            <p>
              <strong>Alias Resolved:</strong> {dependencyGraph?.aliasResolvedCount ?? 0}
            </p>
            <p>
              <strong>Layout Status:</strong> {isLayouting ? 'running' : 'ready'}
            </p>
          </div>
          <div className="tree">
            <h2>Selection / Hover</h2>
            <pre>
              {selectedNodeId ? `Selected: ${selectedNodeId}\n` : 'Selected: -\n'}
              {hoveredFilePath ? `Hover: ${hoveredFilePath}\n` : 'Hover: -\n'}
              {hoveredFileAnalysis
                ? `Exports: ${
                    hoveredFileAnalysis.exports.length > 0 ? hoveredFileAnalysis.exports.join(', ') : 'none'
                  }`
                : 'Exports: -'}
            </pre>
          </div>
        </section>
      )}

      {activeTab === 'board' && (
        <section className="panel">
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
                checked={highlightCycles}
                onChange={(event) => setHighlightCycles(event.target.checked)}
              />
              Highlight cycles
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
            <label className="toggle-row search-row">
              Search file
              <input
                type="text"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="name or path"
              />
            </label>
            <button
              type="button"
              onClick={toggleSelectedBlockCollapse}
              disabled={graphMode !== 'file-level' || !selectedBlockId}
            >
              {selectedBlockId && collapsedBlockIds.has(selectedBlockId) ? 'Expand block' : 'Collapse block'}
            </button>
            <button
              type="button"
              onClick={() => setCollapsedBlockIds(new Set())}
              disabled={collapsedBlockIds.size === 0 || graphMode !== 'file-level'}
            >
              Expand all blocks
            </button>
            <button type="button" onClick={() => setSelectedNodeId(null)} disabled={!selectedNodeId}>
              Clear selection
            </button>
          </div>
          {flowGraph ? (
            <>
              <p className="canvas-meta">
                Blocks: {flowGraph.blockCount}, Nodes: {flowGraph.nodes.length}, Visible edges: {visibleEdges.length}
                {' | '}Cycles: {flowGraph.cycleEdgeCount}
                {' | '}Matches: {matchingFileNodeIds.size}
                {isLayouting ? ' | Layout: running...' : ' | Layout: ELK ready'}
                {selectedNodeId ? ` | Selected: ${selectedNodeId}` : ''}
              </p>
              <p className="canvas-meta">
                Hover: {hoveredFilePath ?? '-'}
                {hoveredFileAnalysis
                  ? ` | Exports: ${hoveredFileAnalysis.exports.length > 0 ? hoveredFileAnalysis.exports.join(', ') : 'none'}`
                  : ''}
              </p>
              <div className="canvas-shell">
                <ReactFlow
                  nodes={visibleNodes}
                  edges={visibleEdges}
                  onNodeClick={onNodeClick}
                  onNodeMouseEnter={onNodeMouseEnter}
                  onNodeMouseLeave={onNodeMouseLeave}
                  fitView
                  minZoom={0.1}
                  maxZoom={1.5}
                >
                  <MiniMap />
                  <Controls />
                  <Background gap={24} size={1} color="#3a6689" />
                </ReactFlow>
              </div>
            </>
          ) : (
            <p className="canvas-meta">Scan a folder to build and render dependency canvas.</p>
          )}
        </section>
      )}
    </main>
  )
}

export default App
