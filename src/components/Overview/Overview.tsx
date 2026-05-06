import type { BuiltGraph } from '../../lib/graph-builder'
import type { DependencyGraph, ScannedProject } from '../../lib/models'
import {
  ProjectStructureViz,
  type StructureViewMode,
  type TreemapMetricMode,
} from '../ProjectStructureViz'

type OverviewProps = {
  scanResult: ScannedProject | null
  dependencyGraph: DependencyGraph | null
  flowGraph: BuiltGraph | null
  matchingFileNodeIds: Set<string>
  isBusy: boolean
  errorMessage: string | null
  pickButtonLabel: () => string
  handlePickDirectory: () => void
  overviewStructureMode: StructureViewMode
  setOverviewStructureMode: (mode: StructureViewMode) => void
  overviewTreemapMetric: TreemapMetricMode
  setOverviewTreemapMetric: (metric: TreemapMetricMode) => void
  fileLocByPath: Map<string, number>
  treeLines: string[]
}

export function Overview({
  scanResult,
  dependencyGraph,
  flowGraph,
  matchingFileNodeIds,
  isBusy,
  errorMessage,
  pickButtonLabel,
  handlePickDirectory,
  overviewStructureMode,
  setOverviewStructureMode,
  overviewTreemapMetric,
  setOverviewTreemapMetric,
  fileLocByPath,
  treeLines,
}: OverviewProps) {
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
