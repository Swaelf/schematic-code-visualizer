import { useEffect, useMemo, useState } from 'react'
import { Background, Controls, MiniMap, ReactFlow, type NodeMouseHandler } from '@xyflow/react'
import { analyzeProjectDependenciesInWorker } from './lib/analyzer-worker-client'
import { applyElkToBlockNodes } from './lib/elk-layout'
import { buildDependencyFlowGraph, type GraphBuildMode } from './lib/graph-builder'
import type { DependencyGraph, ScannedProject } from './lib/models'
import { scanProjectFolder } from './lib/scanner'
import { readTsConfigAliasConfig } from './lib/tsconfig-reader'
import { buildTreeLines } from './lib/tree-view'
import './App.css'
import '@xyflow/react/dist/style.css'

function App() {
  const [scanResult, setScanResult] = useState<ScannedProject | null>(null)
  const [dependencyGraph, setDependencyGraph] = useState<DependencyGraph | null>(null)
  const [graphMode, setGraphMode] = useState<GraphBuildMode>('file-level')
  const [highlightCycles, setHighlightCycles] = useState(false)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [directionFilter, setDirectionFilter] = useState<'all' | 'incoming' | 'outgoing'>('all')
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
  const flowGraph = useMemo(() => {
    if (!scanResult || !dependencyGraph) {
      return null
    }
    return buildDependencyFlowGraph(scanResult, dependencyGraph, graphMode, { highlightCycles })
  }, [scanResult, dependencyGraph, graphMode, highlightCycles])

  const visibleEdges = useMemo(() => {
    if (!flowGraph) {
      return []
    }
    if (!selectedNodeId) {
      return flowGraph.edges
    }
    if (directionFilter === 'incoming') {
      return flowGraph.edges.filter((edge) => edge.target === selectedNodeId)
    }
    if (directionFilter === 'outgoing') {
      return flowGraph.edges.filter((edge) => edge.source === selectedNodeId)
    }
    return flowGraph.edges.filter((edge) => edge.source === selectedNodeId || edge.target === selectedNodeId)
  }, [flowGraph, selectedNodeId, directionFilter])

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
    if (!selectedNodeId) {
      return layoutedNodes
    }
    return layoutedNodes.map((node) => {
      const isSelected = node.id === selectedNodeId
      const isConnected = connectedNodeIds.has(node.id)
      const nextStyle = {
        ...(node.style ?? {}),
        opacity: isConnected ? 1 : 0.32,
      }
      if (isSelected) {
        nextStyle.border = '2px solid #ffe79f'
      }
      return {
        ...node,
        style: nextStyle,
      }
    })
  }, [flowGraph, layoutedNodes, selectedNodeId, connectedNodeIds])

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
            <strong>Unresolved Imports:</strong> {dependencyGraph?.unresolvedImportCount ?? 0}
          </p>
          <p>
            <strong>Alias Resolved:</strong> {dependencyGraph?.aliasResolvedCount ?? 0}
          </p>
        </div>
        <div className="tree">
          <h2>Directory Tree</h2>
          <pre>{treeLines.length > 0 ? treeLines.join('\n') : 'Select a folder to scan.'}</pre>
        </div>
      </section>

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
          <button type="button" onClick={() => setSelectedNodeId(null)} disabled={!selectedNodeId}>
            Clear selection
          </button>
        </div>
        {flowGraph ? (
          <>
            <p className="canvas-meta">
              Blocks: {flowGraph.blockCount}, Nodes: {flowGraph.nodes.length}, Visible edges: {visibleEdges.length}
              {' | '}Cycles: {flowGraph.cycleEdgeCount}
              {isLayouting ? ' | Layout: running...' : ' | Layout: ELK ready'}
              {selectedNodeId ? ` | Selected: ${selectedNodeId}` : ''}
            </p>
            <div className="canvas-shell">
              <ReactFlow
                nodes={visibleNodes}
                edges={visibleEdges}
                onNodeClick={onNodeClick}
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
    </main>
  )
}

export default App
