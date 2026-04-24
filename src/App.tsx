import { useEffect, useMemo, useState } from 'react'
import { Background, Controls, MiniMap, ReactFlow } from '@xyflow/react'
import { analyzeProjectDependencies } from './lib/analyzer'
import { applyElkToBlockNodes } from './lib/elk-layout'
import { buildDependencyFlowGraph, type GraphBuildMode } from './lib/graph-builder'
import type { DependencyGraph, ScannedProject } from './lib/models'
import { scanProjectFolder } from './lib/scanner'
import { buildTreeLines } from './lib/tree-view'
import './App.css'
import '@xyflow/react/dist/style.css'

function App() {
  const [scanResult, setScanResult] = useState<ScannedProject | null>(null)
  const [dependencyGraph, setDependencyGraph] = useState<DependencyGraph | null>(null)
  const [graphMode, setGraphMode] = useState<GraphBuildMode>('file-level')
  const [layoutedNodes, setLayoutedNodes] = useState<ReturnType<typeof buildDependencyFlowGraph>['nodes']>([])
  const [isLayouting, setIsLayouting] = useState(false)
  const [isScanning, setIsScanning] = useState(false)
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
    return buildDependencyFlowGraph(scanResult, dependencyGraph, graphMode)
  }, [scanResult, dependencyGraph, graphMode])

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

  async function handlePickDirectory() {
    if (!isPickerAvailable) {
      setErrorMessage('Your browser does not support File System Access API (use Chromium-based browser).')
      return
    }

    setIsScanning(true)
    setErrorMessage(null)

    try {
      const directoryHandle = await window.showDirectoryPicker({
        mode: 'read',
      })
      const scannedProject = await scanProjectFolder(directoryHandle)
      setScanResult(scannedProject)
      setDependencyGraph(analyzeProjectDependencies(scannedProject.files))
    } catch (error) {
      if ((error as DOMException).name === 'AbortError') {
        return
      }
      setErrorMessage('Failed to scan the selected directory.')
      console.error(error)
    } finally {
      setIsScanning(false)
    }
  }

  return (
    <main className="app-shell">
      <section className="panel">
        <h1>Schematic Code Visualizer</h1>
        <p className="subtitle">
          Iteration v1 scans TypeScript files and maps directory structure into logical board blocks.
        </p>
        <div className="actions">
          <button type="button" onClick={handlePickDirectory} disabled={isScanning}>
            {isScanning ? 'Scanning...' : 'Select Project Folder'}
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
        {flowGraph ? (
          <>
            <p className="canvas-meta">
              Blocks: {flowGraph.blockCount}, Nodes: {flowGraph.nodes.length}, Edges: {flowGraph.edges.length}
              {isLayouting ? ' | Layout: running...' : ' | Layout: ELK ready'}
            </p>
            <div className="canvas-shell">
              <ReactFlow nodes={layoutedNodes} edges={flowGraph.edges} fitView minZoom={0.1} maxZoom={1.5}>
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
