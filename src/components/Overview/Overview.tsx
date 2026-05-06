import { useMemo, useState } from 'react'
import { analyzeProjectDependenciesInWorker } from '../../lib/analyzer-worker-client'
import type { BuiltGraph } from '../../lib/graph-builder'
import type { DependencyGraph, ScannedProject } from '../../lib/models'
import { scanProjectFolder } from '../../lib/scanner'
import { readTsConfigAliasConfig } from '../../lib/tsconfig-reader'
import { buildTreeLines } from '../../lib/tree-view'
import {
  ProjectStructureViz,
  type StructureViewMode,
  type TreemapMetricMode,
} from '../ProjectStructureViz'

type OverviewProps = {
  scanResult: ScannedProject | null
  setScanResult: (value: ScannedProject | null) => void
  dependencyGraph: DependencyGraph | null
  setDependencyGraph: (value: DependencyGraph | null) => void
  flowGraph: BuiltGraph | null
  matchingFileNodeIds: Set<string>
  setProjectReadmeName: (value: string | null) => void
  setProjectReadmeContent: (value: string | null) => void
}

async function readProjectReadme(directoryHandle: FileSystemDirectoryHandle) {
  const candidateNames = ['README.md', 'Readme.md', 'readme.md', 'README.MD']
  for (const name of candidateNames) {
    try {
      const fileHandle = await directoryHandle.getFileHandle(name)
      const file = await fileHandle.getFile()
      return { name, content: await file.text() }
    } catch {
      // continue
    }
  }
  return { name: null, content: null }
}

export function Overview({
  scanResult,
  setScanResult,
  dependencyGraph,
  setDependencyGraph,
  flowGraph,
  matchingFileNodeIds,
  setProjectReadmeName,
  setProjectReadmeContent,
}: OverviewProps) {
  const treeLines = useMemo(() => buildTreeLines(scanResult?.tree ?? null), [scanResult])
  const fileLocByPath = useMemo(() => {
    const map = new Map<string, number>()
    for (const file of scanResult?.files ?? []) {
      const loc = file.content.split(/\r?\n/).length
      map.set(file.path, Math.max(1, loc))
    }
    return map
  }, [scanResult])
  const [overviewStructureMode, setOverviewStructureMode] = useState<StructureViewMode>('treemap')
  const [overviewTreemapMetric, setOverviewTreemapMetric] = useState<TreemapMetricMode>('files')
  const [isScanning, setIsScanning] = useState(false)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const isBusy = isScanning || isAnalyzing
  const isPickerAvailable = typeof window !== 'undefined' && 'showDirectoryPicker' in window

  function pickButtonLabel() {
    if (isScanning) return 'Scanning files...'
    if (isAnalyzing) return 'Analyzing dependencies...'
    return 'Select Project Folder'
  }

  async function handlePickDirectory() {
    if (!isPickerAvailable) {
      setErrorMessage('Your browser does not support File System Access API (use Chromium-based browser).')
      return
    }
    setIsScanning(true)
    setIsAnalyzing(false)
    setErrorMessage(null)
    try {
      const directoryHandle = await window.showDirectoryPicker({ mode: 'read' })
      const readme = await readProjectReadme(directoryHandle)
      setProjectReadmeName(readme.name)
      setProjectReadmeContent(readme.content)
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
      if ((error as DOMException).name === 'AbortError') return
      setErrorMessage('Failed to scan or analyze the selected directory.')
      console.error(error)
    } finally {
      setIsScanning(false)
      setIsAnalyzing(false)
    }
  }
  return (
    <section className="panel grid">
      <div className="stats">
        <h2>Project Selection</h2>
        <div className="actions">
          <button type="button" onClick={handlePickDirectory} disabled={isBusy}>
            {pickButtonLabel()}
          </button>
          <span className="hint">Supported: `.ts`, `.tsx`; excludes `node_modules`, `.git`, `dist`, `build`.</span>
        </div>
        {errorMessage && <p className="error">{errorMessage}</p>}
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
      <div className="overview-visual-stack">
        <div className="overview-viz-panel">
          <div className="overview-viz-header">
            <h2>Structure View</h2>
            <div className="overview-viz-controls">
              <label className="toggle-row">
                View
                <select
                  value={overviewStructureMode}
                  onChange={(event) => setOverviewStructureMode(event.target.value as StructureViewMode)}
                >
                  <option value="treemap">treemap</option>
                  <option value="dendrogram">dendrogram</option>
                  <option value="tree">tree</option>
                </select>
              </label>
              <label className="toggle-row">
                Size
                <select
                  value={overviewTreemapMetric}
                  onChange={(event) => setOverviewTreemapMetric(event.target.value as TreemapMetricMode)}
                  disabled={overviewStructureMode !== 'treemap'}
                >
                  <option value="files">files</option>
                  <option value="loc">loc</option>
                </select>
              </label>
            </div>
          </div>
          <ProjectStructureViz
            tree={scanResult?.tree ?? null}
            mode={overviewStructureMode}
            treemapMetric={overviewTreemapMetric}
            fileValueByPath={fileLocByPath}
            treeLines={treeLines}
          />
        </div>
      </div>
    </section>
  )
}
