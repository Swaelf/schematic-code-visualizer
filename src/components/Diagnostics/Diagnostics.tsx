import { useMemo, useState, type ChangeEvent } from 'react'
import type {
  AnalysisExportReport,
  GitBranchCompareReport,
  GitChurnReport,
  GitLiveCommit,
  GitLiveRefsResponse,
} from '../../types'
import { architectureConfigDescription } from '../../utils/architecture-config-description'
import { buildMarkdownReport } from '../../utils/build-markdown-report'
import { downloadTextFile } from '../../utils/download-text-file'
import { isAnalysisExportReportCandidate } from '../../utils/is-analysis-export-report-candidate'
import { isGitBranchCompareReportCandidate } from '../../utils/is-git-branch-compare-report-candidate'
import { isGitChurnReportCandidate } from '../../utils/is-git-churn-report-candidate'
import { isGitLiveLogResponseCandidate } from '../../utils/is-git-live-log-response-candidate'
import { isGitLiveRefsResponseCandidate } from '../../utils/is-git-live-refs-response-candidate'
import type { DiagnosticsProps } from './types'

export function Diagnostics({
  dependencyGraph,
  isLayouting,
  scanResult,
  baselineReport,
  setBaselineReport,
  gitChurnReport,
  setGitChurnReport,
  churnHotFiles,
  gitBranchCompareReport,
  setGitBranchCompareReport,
  branchDiffView,
  setBranchDiffView,
  setHighlightOnlyChangedBranchEdges,
  branchCompareHotFiles,
  hotspotFiles,
  potentiallyDeadExportFiles,
  topCycleGroups,
  dependencyEdgeKindCounts,
  riskByFile,
  riskByBlock,
  orphanRuntimeModules,
  reexportHubFiles,
  duplicateUtilityGroups,
  reexportBottleneckFiles,
  reexportChains,
  architectureRuleLines,
  architectureViolations,
  architectureViolationByKind,
  architectureLayerDistribution,
  architectureViolationByPair,
  architectureConfig,
  selectedNodeId,
  hoveredFilePath,
  hoveredFileAnalysis,
  focusFileOnBoard,
}: DiagnosticsProps) {
  // Per-tab UI state for the report-name / error labels and the live-git workflow.
  const [baselineReportName, setBaselineReportName] = useState<string | null>(null)
  const [baselineReportError, setBaselineReportError] = useState<string | null>(null)
  const [gitChurnReportName, setGitChurnReportName] = useState<string | null>(null)
  const [gitChurnReportError, setGitChurnReportError] = useState<string | null>(null)
  const [gitBranchCompareReportName, setGitBranchCompareReportName] = useState<string | null>(null)
  const [gitBranchCompareReportError, setGitBranchCompareReportError] = useState<string | null>(null)

  const [gitLiveApiBase, setGitLiveApiBase] = useState('http://127.0.0.1:3031')
  const [gitLiveRepoPath, setGitLiveRepoPath] = useState('')
  const [gitLiveRefs, setGitLiveRefs] = useState<GitLiveRefsResponse | null>(null)
  const [gitLiveBaseRef, setGitLiveBaseRef] = useState('main')
  const [gitLiveTargetRef, setGitLiveTargetRef] = useState('HEAD')
  const [gitLiveBaseCommits, setGitLiveBaseCommits] = useState<GitLiveCommit[]>([])
  const [gitLiveTargetCommits, setGitLiveTargetCommits] = useState<GitLiveCommit[]>([])
  const [gitLiveBaseCommitOverride, setGitLiveBaseCommitOverride] = useState('')
  const [gitLiveTargetCommitOverride, setGitLiveTargetCommitOverride] = useState('')
  const [isGitLiveLoading, setIsGitLiveLoading] = useState(false)
  const [gitLiveError, setGitLiveError] = useState<string | null>(null)

  const analysisReport = useMemo<AnalysisExportReport>(() => {
    return {
      generatedAt: new Date().toISOString(),
      projectRoot: scanResult?.rootName ?? null,
      summary: {
        tsFiles: scanResult?.tsFileCount ?? 0,
        directories: scanResult?.directoryCount ?? 0,
        dependencyEdges: dependencyGraph?.edges.length ?? 0,
        cycleEdges: topCycleGroups.length,
        unresolvedImports: dependencyGraph?.unresolvedImportCount ?? 0,
        unresolvedInternal: dependencyGraph?.unresolvedInternalCount ?? 0,
        unresolvedExternal: dependencyGraph?.unresolvedExternalCount ?? 0,
        aliasResolved: dependencyGraph?.aliasResolvedCount ?? 0,
      },
      edgeKinds: dependencyEdgeKindCounts,
      codeHealth: {
        hotspots: hotspotFiles.map((item) => ({
          path: item.path,
          score: item.score,
          incoming: item.incoming,
          outgoing: item.outgoing,
          loc: item.loc,
        })),
        deadExports: potentiallyDeadExportFiles.map((file) => ({
          path: file.path,
          exportCount: file.exports.length,
          exports: file.exports,
        })),
        cycleGroups: topCycleGroups.map((group) => ({ id: group.id, size: group.size, files: group.filePaths })),
      },
      risk: { files: riskByFile, blocks: riskByBlock },
      refactorSignals: {
        orphanRuntimeModules,
        reexportHubs: reexportHubFiles,
        duplicateUtilityGroups,
        reexportBottlenecks: reexportBottleneckFiles,
        reexportChains,
      },
      architecture: {
        rules: architectureRuleLines,
        layerDistribution: architectureLayerDistribution,
        violationsByKind: architectureViolationByKind,
        violationsByLayerPair: architectureViolationByPair.map(([pair, count]) => ({ pair, count })),
        violations: architectureViolations.map((item) => ({
          kind: item.kind,
          fromLayer: item.fromLayer,
          toLayer: item.toLayer,
          fromPath: item.fromPath,
          toPath: item.toPath,
        })),
      },
      graphSnapshot: {
        files: dependencyGraph?.files.map((file) => file.path) ?? [],
        edges:
          dependencyGraph?.edges.map((edge) => ({
            fromPath: edge.fromPath,
            toPath: edge.toPath,
            kind: edge.kind,
          })) ?? [],
      },
    }
  }, [
    architectureLayerDistribution,
    architectureRuleLines,
    architectureViolationByKind,
    architectureViolationByPair,
    architectureViolations,
    dependencyEdgeKindCounts,
    dependencyGraph,
    hotspotFiles,
    orphanRuntimeModules,
    potentiallyDeadExportFiles,
    duplicateUtilityGroups,
    reexportBottleneckFiles,
    reexportChains,
    reexportHubFiles,
    riskByBlock,
    riskByFile,
    scanResult?.directoryCount,
    scanResult?.rootName,
    scanResult?.tsFileCount,
    topCycleGroups,
  ])

  const baselineDelta = useMemo(() => {
    if (!baselineReport) return null
    return {
      tsFiles: analysisReport.summary.tsFiles - baselineReport.summary.tsFiles,
      directories: analysisReport.summary.directories - baselineReport.summary.directories,
      dependencyEdges: analysisReport.summary.dependencyEdges - baselineReport.summary.dependencyEdges,
      cycleEdges: analysisReport.summary.cycleEdges - baselineReport.summary.cycleEdges,
      unresolvedImports: analysisReport.summary.unresolvedImports - baselineReport.summary.unresolvedImports,
      unresolvedInternal: analysisReport.summary.unresolvedInternal - baselineReport.summary.unresolvedInternal,
      unresolvedExternal: analysisReport.summary.unresolvedExternal - baselineReport.summary.unresolvedExternal,
      aliasResolved: analysisReport.summary.aliasResolved - baselineReport.summary.aliasResolved,
      edgeKinds: {
        runtime: analysisReport.edgeKinds.runtime - baselineReport.edgeKinds.runtime,
        type: analysisReport.edgeKinds.type - baselineReport.edgeKinds.type,
        're-export': analysisReport.edgeKinds['re-export'] - baselineReport.edgeKinds['re-export'],
      },
      architectureViolations:
        analysisReport.architecture.violations.length - baselineReport.architecture.violations.length,
      orphanRuntimeModules:
        analysisReport.refactorSignals.orphanRuntimeModules.length -
        (baselineReport.refactorSignals?.orphanRuntimeModules?.length ?? 0),
      reexportHubs:
        analysisReport.refactorSignals.reexportHubs.length - (baselineReport.refactorSignals?.reexportHubs?.length ?? 0),
    }
  }, [analysisReport, baselineReport])

  function exportAnalysisReportJson() {
    const projectName = scanResult?.rootName ?? 'project'
    downloadTextFile(`analysis-report-${projectName}.json`, JSON.stringify(analysisReport, null, 2), 'application/json;charset=utf-8')
  }

  function exportAnalysisReportMarkdown() {
    const projectName = scanResult?.rootName ?? 'project'
    downloadTextFile(`analysis-report-${projectName}.md`, buildMarkdownReport(analysisReport), 'text/markdown;charset=utf-8')
  }

  function buildGitLiveUrl(path: string, params: Record<string, string>) {
    const normalizedBase = gitLiveApiBase.trim().replace(/\/+$/, '')
    const url = new URL(`${normalizedBase}${path}`)
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value)
    }
    return url.toString()
  }

  async function fetchGitLiveCommitsFor(side: 'base' | 'target', ref: string) {
    if (!gitLiveRepoPath.trim()) return
    const response = await fetch(buildGitLiveUrl('/api/git/log', { repo: gitLiveRepoPath.trim(), ref, limit: '60' }))
    const parsed = (await response.json()) as unknown
    if (!response.ok) {
      throw new Error((parsed as { error?: string })?.error ?? `Git live log error (${response.status}).`)
    }
    if (!isGitLiveLogResponseCandidate(parsed)) {
      throw new Error('Invalid log response from git live server.')
    }
    if (side === 'base') setGitLiveBaseCommits(parsed.commits)
    else setGitLiveTargetCommits(parsed.commits)
  }

  async function fetchGitLiveRefs() {
    if (!gitLiveRepoPath.trim()) {
      setGitLiveError('Set local git repository path first.')
      return
    }
    setIsGitLiveLoading(true)
    setGitLiveError(null)
    try {
      const response = await fetch(buildGitLiveUrl('/api/git/refs', { repo: gitLiveRepoPath.trim() }))
      const parsed = (await response.json()) as unknown
      if (!response.ok) {
        throw new Error((parsed as { error?: string })?.error ?? `Git live refs error (${response.status}).`)
      }
      if (!isGitLiveRefsResponseCandidate(parsed)) {
        throw new Error('Invalid refs response from git live server.')
      }
      setGitLiveRefs(parsed)
      const fallbackBase = parsed.currentBranch || parsed.branches[0] || 'main'
      setGitLiveBaseRef(fallbackBase)
      setGitLiveTargetRef('HEAD')
      setGitLiveBaseCommitOverride('')
      setGitLiveTargetCommitOverride('')
      await Promise.all([fetchGitLiveCommitsFor('base', fallbackBase), fetchGitLiveCommitsFor('target', 'HEAD')])
    } catch (error) {
      setGitLiveError(error instanceof Error ? error.message : 'Failed to load refs from git live server.')
    } finally {
      setIsGitLiveLoading(false)
    }
  }

  async function refreshGitLiveCommits(side: 'base' | 'target') {
    const ref = side === 'base' ? gitLiveBaseRef : gitLiveTargetRef
    setIsGitLiveLoading(true)
    setGitLiveError(null)
    try {
      await fetchGitLiveCommitsFor(side, ref)
      if (side === 'base') setGitLiveBaseCommitOverride('')
      else setGitLiveTargetCommitOverride('')
    } catch (error) {
      setGitLiveError(error instanceof Error ? error.message : 'Failed to load commit history from git live server.')
    } finally {
      setIsGitLiveLoading(false)
    }
  }

  async function runGitLiveCompare() {
    if (!gitLiveRepoPath.trim()) {
      setGitLiveError('Set local git repository path first.')
      return
    }
    const base = gitLiveBaseCommitOverride || gitLiveBaseRef
    const target = gitLiveTargetCommitOverride || gitLiveTargetRef
    if (!base || !target) {
      setGitLiveError('Select base and target refs/commits.')
      return
    }
    setIsGitLiveLoading(true)
    setGitLiveError(null)
    try {
      const response = await fetch(buildGitLiveUrl('/api/git/compare', { repo: gitLiveRepoPath.trim(), base, target }))
      const parsed = (await response.json()) as unknown
      if (!response.ok) {
        throw new Error((parsed as { error?: string })?.error ?? `Git live compare error (${response.status}).`)
      }
      if (!isGitBranchCompareReportCandidate(parsed)) {
        throw new Error('Invalid compare response from git live server.')
      }
      setGitBranchCompareReport(parsed)
      setGitBranchCompareReportName(`live:${base}...${target}`)
      setGitBranchCompareReportError(null)
      if (branchDiffView === 'off') {
        setBranchDiffView('all')
      }
    } catch (error) {
      setGitLiveError(error instanceof Error ? error.message : 'Failed to compare refs via git live server.')
    } finally {
      setIsGitLiveLoading(false)
    }
  }

  async function importBaselineReport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      const raw = await file.text()
      const parsed = JSON.parse(raw) as unknown
      if (!isAnalysisExportReportCandidate(parsed)) {
        setBaselineReportError('Selected file is not a valid analysis report JSON.')
        setBaselineReport(null)
        setBaselineReportName(null)
        return
      }
      setBaselineReport(parsed satisfies AnalysisExportReport)
      setBaselineReportName(file.name)
      setBaselineReportError(null)
    } catch {
      setBaselineReportError('Failed to import baseline report (invalid JSON or unreadable file).')
      setBaselineReport(null)
      setBaselineReportName(null)
    } finally {
      event.target.value = ''
    }
  }

  async function importGitChurnReport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      const raw = await file.text()
      const parsed = JSON.parse(raw) as unknown
      if (!isGitChurnReportCandidate(parsed)) {
        setGitChurnReportError('Selected file is not a valid git churn report JSON.')
        setGitChurnReport(null)
        setGitChurnReportName(null)
        return
      }
      setGitChurnReport(parsed satisfies GitChurnReport)
      setGitChurnReportName(file.name)
      setGitChurnReportError(null)
    } catch {
      setGitChurnReportError('Failed to import git churn report (invalid JSON or unreadable file).')
      setGitChurnReport(null)
      setGitChurnReportName(null)
    } finally {
      event.target.value = ''
    }
  }

  async function importGitBranchCompareReport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      const raw = await file.text()
      const parsed = JSON.parse(raw) as unknown
      if (!isGitBranchCompareReportCandidate(parsed)) {
        setGitBranchCompareReportError('Selected file is not a valid git branch compare report JSON.')
        setGitBranchCompareReport(null)
        setGitBranchCompareReportName(null)
        setBranchDiffView('off')
        setHighlightOnlyChangedBranchEdges(false)
        return
      }
      setGitBranchCompareReport(parsed satisfies GitBranchCompareReport)
      setGitBranchCompareReportName(file.name)
      setGitBranchCompareReportError(null)
    } catch {
      setGitBranchCompareReportError('Failed to import git branch compare report (invalid JSON or unreadable file).')
      setGitBranchCompareReport(null)
      setGitBranchCompareReportName(null)
      setBranchDiffView('off')
      setHighlightOnlyChangedBranchEdges(false)
    } finally {
      event.target.value = ''
    }
  }

  return (
    <section className="panel grid diagnostics-grid">
      <div className="stats">
        <div className="section-card">
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

        <div className="section-card">
          <h2>Export Report</h2>
          <p>Save current diagnostics snapshot as JSON or Markdown.</p>
          <div className="actions">
            <button type="button" onClick={exportAnalysisReportJson} disabled={!scanResult || !dependencyGraph}>
              Export JSON
            </button>
            <button type="button" onClick={exportAnalysisReportMarkdown} disabled={!scanResult || !dependencyGraph}>
              Export Markdown
            </button>
          </div>
        </div>

        <div className="section-card">
          <h2>Compare with Baseline</h2>
          <p>Import a previously exported analysis JSON to see deltas.</p>
          <div className="actions">
            <input type="file" accept=".json,application/json" onChange={importBaselineReport} />
            <button
              type="button"
              onClick={() => {
                setBaselineReport(null)
                setBaselineReportName(null)
                setBaselineReportError(null)
              }}
              disabled={!baselineReport}
            >
              Clear baseline
            </button>
          </div>
          {baselineReportName && (
            <p>
              <strong>Loaded:</strong> {baselineReportName}
            </p>
          )}
          {baselineReportError && <p className="error">{baselineReportError}</p>}
          {baselineDelta && (
            <ul className="flat-list">
              <li>
                <strong>TS Files:</strong> {baselineDelta.tsFiles >= 0 ? '+' : ''}
                {baselineDelta.tsFiles}
              </li>
              <li>
                <strong>Dependency Edges:</strong> {baselineDelta.dependencyEdges >= 0 ? '+' : ''}
                {baselineDelta.dependencyEdges}
              </li>
              <li>
                <strong>Cycle Edges:</strong> {baselineDelta.cycleEdges >= 0 ? '+' : ''}
                {baselineDelta.cycleEdges}
              </li>
              <li>
                <strong>Unresolved Imports:</strong> {baselineDelta.unresolvedImports >= 0 ? '+' : ''}
                {baselineDelta.unresolvedImports}
              </li>
              <li>
                <strong>Architecture Violations:</strong> {baselineDelta.architectureViolations >= 0 ? '+' : ''}
                {baselineDelta.architectureViolations}
              </li>
            </ul>
          )}
        </div>

        <div className="section-card">
          <h2>Git Churn</h2>
          <p>Import git churn JSON generated via `npm run git-churn`.</p>
          <div className="actions">
            <input type="file" accept=".json,application/json" onChange={importGitChurnReport} />
            <button
              type="button"
              onClick={() => {
                setGitChurnReport(null)
                setGitChurnReportName(null)
                setGitChurnReportError(null)
              }}
              disabled={!gitChurnReport}
            >
              Clear churn
            </button>
          </div>
          {gitChurnReportName && (
            <p>
              <strong>Loaded:</strong> {gitChurnReportName}
            </p>
          )}
          {gitChurnReport && (
            <p>
              <strong>Since:</strong> {gitChurnReport.since} | <strong>Files:</strong> {gitChurnReport.files.length}
            </p>
          )}
          {gitChurnReportError && <p className="error">{gitChurnReportError}</p>}
          {churnHotFiles.length > 0 && (
            <>
              <h2>Churn Hotspots</h2>
              <ul className="quick-action-list">
                {churnHotFiles.slice(0, 8).map((item) => (
                  <li key={`churn-${item.path}`}>
                    <code>{item.path}</code>
                    <button type="button" className="quick-action-button" onClick={() => focusFileOnBoard(item.path)}>
                      Show on Board
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        <div className="section-card">
          <h2>Git Branch Compare</h2>
          <p>Live compare from local git repo (no remote, no export) or import JSON report.</p>
          <div className="git-live-grid">
            <label className="git-live-field">
              Git API URL
              <input
                type="text"
                value={gitLiveApiBase}
                onChange={(event) => setGitLiveApiBase(event.target.value)}
                placeholder="http://127.0.0.1:3031"
              />
            </label>
            <label className="git-live-field">
              Local repo path
              <input
                type="text"
                value={gitLiveRepoPath}
                onChange={(event) => setGitLiveRepoPath(event.target.value)}
                placeholder="C:\\path\\to\\repo"
              />
            </label>
          </div>
          <div className="actions">
            <button type="button" onClick={fetchGitLiveRefs} disabled={isGitLiveLoading || !gitLiveRepoPath.trim()}>
              Load refs
            </button>
            <button
              type="button"
              onClick={runGitLiveCompare}
              disabled={isGitLiveLoading || !gitLiveRepoPath.trim() || !gitLiveBaseRef || !gitLiveTargetRef}
            >
              Run live compare
            </button>
          </div>
          {gitLiveRefs && (
            <>
              <p>
                <strong>Repo:</strong> {gitLiveRefs.repo} | <strong>Current branch:</strong>{' '}
                {gitLiveRefs.currentBranch || '(detached)'}
              </p>
              <div className="git-live-grid">
                <label className="git-live-field">
                  Base ref
                  <select
                    value={gitLiveBaseRef}
                    onChange={(event) => {
                      setGitLiveBaseRef(event.target.value)
                      setGitLiveBaseCommitOverride('')
                    }}
                  >
                    <option value="HEAD">HEAD</option>
                    {gitLiveRefs.branches.map((branch) => (
                      <option key={`base-branch-${branch}`} value={branch}>
                        {branch}
                      </option>
                    ))}
                    {gitLiveRefs.tags.map((tag) => (
                      <option key={`base-tag-${tag}`} value={tag}>
                        tag:{tag}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="git-live-field">
                  Target ref
                  <select
                    value={gitLiveTargetRef}
                    onChange={(event) => {
                      setGitLiveTargetRef(event.target.value)
                      setGitLiveTargetCommitOverride('')
                    }}
                  >
                    <option value="HEAD">HEAD</option>
                    {gitLiveRefs.branches.map((branch) => (
                      <option key={`target-branch-${branch}`} value={branch}>
                        {branch}
                      </option>
                    ))}
                    {gitLiveRefs.tags.map((tag) => (
                      <option key={`target-tag-${tag}`} value={tag}>
                        tag:{tag}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="actions">
                <button type="button" onClick={() => refreshGitLiveCommits('base')} disabled={isGitLiveLoading || !gitLiveBaseRef}>
                  Load base commits
                </button>
                <button
                  type="button"
                  onClick={() => refreshGitLiveCommits('target')}
                  disabled={isGitLiveLoading || !gitLiveTargetRef}
                >
                  Load target commits
                </button>
              </div>
              <div className="git-live-grid">
                <label className="git-live-field">
                  Base commit override
                  <select
                    value={gitLiveBaseCommitOverride}
                    onChange={(event) => setGitLiveBaseCommitOverride(event.target.value)}
                  >
                    <option value="">(use ref)</option>
                    {gitLiveBaseCommits.map((commit) => (
                      <option key={`base-commit-${commit.hash}`} value={commit.hash}>
                        {commit.shortHash} · {commit.date} · {commit.subject}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="git-live-field">
                  Target commit override
                  <select
                    value={gitLiveTargetCommitOverride}
                    onChange={(event) => setGitLiveTargetCommitOverride(event.target.value)}
                  >
                    <option value="">(use ref)</option>
                    {gitLiveTargetCommits.map((commit) => (
                      <option key={`target-commit-${commit.hash}`} value={commit.hash}>
                        {commit.shortHash} · {commit.date} · {commit.subject}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </>
          )}
          {gitLiveError && <p className="error">{gitLiveError}</p>}
          <p>Or import branch compare JSON generated via `npm run git-compare`.</p>
          <div className="actions">
            <input type="file" accept=".json,application/json" onChange={importGitBranchCompareReport} />
            <button
              type="button"
              onClick={() => {
                setGitBranchCompareReport(null)
                setGitBranchCompareReportName(null)
                setGitBranchCompareReportError(null)
                setBranchDiffView('off')
                setHighlightOnlyChangedBranchEdges(false)
              }}
              disabled={!gitBranchCompareReport}
            >
              Clear compare
            </button>
          </div>
          {gitBranchCompareReportName && (
            <p>
              <strong>Loaded:</strong> {gitBranchCompareReportName}
            </p>
          )}
          {gitBranchCompareReport && (
            <p>
              <strong>Range:</strong> {gitBranchCompareReport.baseRef}...{gitBranchCompareReport.targetRef} |{' '}
              <strong>Changed files:</strong> {gitBranchCompareReport.summary.changedFiles} | <strong>Churn:</strong>{' '}
              {gitBranchCompareReport.summary.totalChurn}
            </p>
          )}
          {gitBranchCompareReportError && <p className="error">{gitBranchCompareReportError}</p>}
          {branchCompareHotFiles.length > 0 && (
            <>
              <h2>Changed Hotspots</h2>
              <ul className="quick-action-list">
                {branchCompareHotFiles.slice(0, 8).map((item) => (
                  <li key={`branch-compare-${item.path}`}>
                    <code>{item.path}</code>
                    <button type="button" className="quick-action-button" onClick={() => focusFileOnBoard(item.path)}>
                      Show on Board
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        <div className="section-card">
          <h2>Code Health (MVP)</h2>
          <p>
            <strong>Hotspots:</strong> {hotspotFiles.length}
          </p>
          <p>
            <strong>Potential dead export files:</strong> {potentiallyDeadExportFiles.length}
          </p>
          <p>
            <strong>Cycle groups:</strong> {topCycleGroups.length}
          </p>
          <p>
            <strong>Edge kinds:</strong> runtime {dependencyEdgeKindCounts.runtime}, type {dependencyEdgeKindCounts.type},
            re-export {dependencyEdgeKindCounts['re-export']}
          </p>
          <p>
            <strong>Risky files:</strong> {riskByFile.length}
          </p>
          <p>
            <strong>Risky blocks:</strong> {riskByBlock.length}
          </p>
        </div>

        <div className="section-card">
          <h2>Refactor Signals</h2>
          <p>
            <strong>Orphan runtime modules:</strong> {orphanRuntimeModules.length}
          </p>
          <p>
            <strong>Re-export hubs:</strong> {reexportHubFiles.length}
          </p>
          <p>
            <strong>Duplicate utility groups:</strong> {duplicateUtilityGroups.length}
          </p>
          <p>
            <strong>Re-export bottlenecks:</strong> {reexportBottleneckFiles.length}
          </p>
          <p>
            <strong>Re-export chains:</strong> {reexportChains.length}
          </p>
          {orphanRuntimeModules.length > 0 && (
            <>
              <h2>Orphan Candidates</h2>
              <ul className="quick-action-list">
                {orphanRuntimeModules.slice(0, 8).map((item) => (
                  <li key={`orphan-${item.path}`}>
                    <code>{item.path}</code>
                    <button type="button" className="quick-action-button" onClick={() => focusFileOnBoard(item.path)}>
                      Show on Board
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          {reexportHubFiles.length > 0 && (
            <>
              <h2>Re-export Hubs</h2>
              <ul className="quick-action-list">
                {reexportHubFiles.slice(0, 8).map((item) => (
                  <li key={`rehub-${item.path}`}>
                    <code>{item.path}</code>
                    <button type="button" className="quick-action-button" onClick={() => focusFileOnBoard(item.path)}>
                      Show on Board
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          {reexportBottleneckFiles.length > 0 && (
            <>
              <h2>Re-export Bottlenecks</h2>
              <ul className="quick-action-list">
                {reexportBottleneckFiles.slice(0, 8).map((item) => (
                  <li key={`rebot-${item.path}`}>
                    <code>{item.path}</code>
                    <button type="button" className="quick-action-button" onClick={() => focusFileOnBoard(item.path)}>
                      Show on Board
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        <div className="section-card">
          <h2>Architecture Rules</h2>
          <ul className="rule-list">
            {architectureRuleLines.map((line) => (
              <li key={`diag-rule-${line}`}>{line}</li>
            ))}
          </ul>
          <p>
            <strong>Violations:</strong> {architectureViolations.length}
          </p>
          <p>
            <strong>Violations by kind:</strong> runtime {architectureViolationByKind.runtime}, type{' '}
            {architectureViolationByKind.type}, re-export {architectureViolationByKind['re-export']}
          </p>
          <p>
            <strong>Layer distribution:</strong> ui {architectureLayerDistribution.ui}, domain {architectureLayerDistribution.domain},
            infra {architectureLayerDistribution.infra}, shared {architectureLayerDistribution.shared}, tests{' '}
            {architectureLayerDistribution.tests}, unknown {architectureLayerDistribution.unknown}
          </p>
        </div>
      </div>
      <div className="tree right-stack">
        <div className="section-card">
          <h2>Code Health Details</h2>
          <pre className="report-pre">
            Hotspots (score = in*2 + out + LOC factor):
            {hotspotFiles.length > 0
              ? `\n${hotspotFiles
                  .map(
                    (item) =>
                      `- ${item.path} | score=${item.score} | in=${item.incoming} | out=${item.outgoing} | loc=${item.loc}`,
                  )
                  .join('\n')}`
              : '\n- no data'}
            {'\n\n'}
            Potential dead export files (no internal incoming edges):
            {potentiallyDeadExportFiles.length > 0
              ? `\n${potentiallyDeadExportFiles
                  .map((file) => `- ${file.path} | exports=${file.exports.length} | symbols=${file.exports.join(', ')}`)
                  .join('\n')}`
              : '\n- no candidates'}
            {'\n\n'}
            Top cycle groups:
            {topCycleGroups.length > 0
              ? `\n${topCycleGroups
                  .map((group) => `- cycle-${group.id} | size=${group.size} | ${group.filePaths.join(' -> ')}`)
                  .join('\n')}`
              : '\n- no cycles'}
          </pre>
        </div>

        <div className="section-card">
          <h2>Risk & Refactor</h2>
          <pre className="report-pre">
            Dependency Quality Risk (files):
            {riskByFile.length > 0
              ? `\n${riskByFile
                  .map(
                    (item) =>
                      `- ${item.path} | score=${item.score} | runtime ${item.incomingRuntime}/${item.outgoingRuntime} | type ${item.incomingType}/${item.outgoingType} | re-export ${item.incomingReexport}/${item.outgoingReexport}`,
                  )
                  .join('\n')}`
              : '\n- no data'}
            {'\n\n'}
            Dependency Quality Risk (blocks):
            {riskByBlock.length > 0
              ? `\n${riskByBlock
                  .map(
                    (item) =>
                      `- ${item.label} | score=${item.score} | files=${item.fileCount} | cross runtime in=${item.incomingCrossBlockRuntime} out=${item.outgoingCrossBlockRuntime}`,
                  )
                  .join('\n')}`
              : '\n- no data'}
            {'\n\n'}
            Refactor signals - orphan runtime modules:
            {orphanRuntimeModules.length > 0
              ? `\n${orphanRuntimeModules
                  .map(
                    (item) =>
                      `- ${item.path} | exports=${item.exports} | typeTouches=${item.typeTouches} | reexportTouches=${item.reexportTouches}`,
                  )
                  .join('\n')}`
              : '\n- no candidates'}
            {'\n\n'}
            Refactor signals - re-export hubs:
            {reexportHubFiles.length > 0
              ? `\n${reexportHubFiles
                  .map(
                    (item) =>
                      `- ${item.path} | re-export out=${item.outgoingReexport} | runtime in=${item.incomingRuntime} | exports=${item.exports}`,
                  )
                  .join('\n')}`
              : '\n- no candidates'}
            {'\n\n'}
            Refactor signals - duplicate utility groups:
            {duplicateUtilityGroups.length > 0
              ? `\n${duplicateUtilityGroups
                  .map((group) => `- ${group.baseName} [${group.hash}] | ${group.paths.join(' | ')}`)
                  .join('\n')}`
              : '\n- no candidates'}
            {'\n\n'}
            Refactor signals - re-export bottlenecks:
            {reexportBottleneckFiles.length > 0
              ? `\n${reexportBottleneckFiles
                  .map(
                    (item) =>
                      `- ${item.path} | score=${item.score} | runtime-in=${item.incomingRuntime} | reexport-in=${item.incomingReexport} | reexport-out=${item.outgoingReexport}`,
                  )
                  .join('\n')}`
              : '\n- no candidates'}
            {'\n\n'}
            Refactor signals - re-export chains:
            {reexportChains.length > 0 ? `\n${reexportChains.map((chain) => `- ${chain}`).join('\n')}` : '\n- no chains'}
            {'\n\n'}
            Git churn hotspots (weighted by centrality):
            {churnHotFiles.length > 0
              ? `\n${churnHotFiles
                  .map(
                    (item) =>
                      `- ${item.path} | weighted=${item.weighted} | churn=${item.churn} | commits=${item.commits} | centrality=${item.centrality}`,
                  )
                  .join('\n')}`
              : '\n- churn report not loaded'}
            {'\n\n'}
            Branch compare hotspots (weighted by centrality):
            {branchCompareHotFiles.length > 0
              ? `\n${branchCompareHotFiles
                  .map(
                    (item) =>
                      `- ${item.path} | ${item.changeType} | weighted=${item.weighted} | churn=${item.churn} | +${item.additions}/-${item.deletions} | centrality=${item.centrality}`,
                  )
                  .join('\n')}`
              : '\n- branch compare report not loaded'}
          </pre>
        </div>

        <div className="section-card">
          <h2>Architecture & Selection</h2>
          <pre className="report-pre">
            Baseline diff:
            {baselineDelta
              ? `\n- files ${baselineDelta.tsFiles >= 0 ? '+' : ''}${baselineDelta.tsFiles}
- dirs ${baselineDelta.directories >= 0 ? '+' : ''}${baselineDelta.directories}
- edges ${baselineDelta.dependencyEdges >= 0 ? '+' : ''}${baselineDelta.dependencyEdges}
- cycles ${baselineDelta.cycleEdges >= 0 ? '+' : ''}${baselineDelta.cycleEdges}
- unresolved ${baselineDelta.unresolvedImports >= 0 ? '+' : ''}${baselineDelta.unresolvedImports}
- arch violations ${baselineDelta.architectureViolations >= 0 ? '+' : ''}${baselineDelta.architectureViolations}
- edge kinds runtime ${baselineDelta.edgeKinds.runtime >= 0 ? '+' : ''}${baselineDelta.edgeKinds.runtime}, type ${baselineDelta.edgeKinds.type >= 0 ? '+' : ''}${baselineDelta.edgeKinds.type}, re-export ${baselineDelta.edgeKinds['re-export'] >= 0 ? '+' : ''}${baselineDelta.edgeKinds['re-export']}`
              : '\n- baseline not loaded'}
            {'\n\n'}
            Architecture rule set:
            {'\n'}- {architectureConfigDescription(architectureConfig)}
            {'\n\n'}
            Architecture violations by layer pair:
            {architectureViolationByPair.length > 0
              ? `\n${architectureViolationByPair.map(([pair, count]) => `- ${pair}: ${count}`).join('\n')}`
              : '\n- no violations'}
            {'\n\n'}
            Architecture violations (sample):
            {architectureViolations.length > 0
              ? `\n${architectureViolations
                  .slice(0, 20)
                  .map(
                    (item) =>
                      `- [${item.kind}] ${item.fromLayer}->${item.toLayer} | ${item.fromPath} -> ${item.toPath}`,
                  )
                  .join('\n')}`
              : '\n- no violations'}
            {'\n\n'}
            Selection / Hover:
            {'\n'}
            {selectedNodeId ? `Selected: ${selectedNodeId}\n` : 'Selected: -\n'}
            {hoveredFilePath ? `Hover: ${hoveredFilePath}\n` : 'Hover: -\n'}
            {hoveredFileAnalysis
              ? `Exports: ${
                  hoveredFileAnalysis.exports.length > 0 ? hoveredFileAnalysis.exports.join(', ') : 'none'
                }`
              : 'Exports: -'}
          </pre>
        </div>
      </div>
    </section>
  )
}
