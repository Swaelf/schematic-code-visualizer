import type { ChangeEvent } from 'react'
import type { DependencyEdge, DependencyGraph, FileAnalysis, ScannedProject } from '../../lib/models'
import type {
  ArchitectureConfig,
  ArchitectureLayerId,
  ArchitectureViolation,
  BranchDiffView,
  CycleGroup,
  GitBranchCompareReport,
  GitChurnReport,
  GitLiveCommit,
  GitLiveRefsResponse,
} from '../../types'

export type HotspotFile = { path: string; score: number; incoming: number; outgoing: number; loc: number }

export type RiskFile = {
  path: string
  score: number
  incomingRuntime: number
  outgoingRuntime: number
  incomingType: number
  outgoingType: number
  incomingReexport: number
  outgoingReexport: number
}

export type RiskBlock = {
  label: string
  score: number
  fileCount: number
  incomingCrossBlockRuntime: number
  outgoingCrossBlockRuntime: number
}

export type OrphanRuntimeModule = { path: string; exports: number; typeTouches: number; reexportTouches: number }
export type ReexportHubFile = { path: string; outgoingReexport: number; incomingRuntime: number; exports: number }
export type DuplicateUtilityGroup = { baseName: string; hash: string; paths: string[] }
export type ReexportBottleneckFile = {
  path: string
  score: number
  incomingRuntime: number
  incomingReexport: number
  outgoingReexport: number
}

export type ChurnHotFile = { path: string; weighted: number; churn: number; commits: number; centrality: number }
export type BranchCompareHotFile = {
  path: string
  changeType: string
  weighted: number
  churn: number
  additions: number
  deletions: number
  centrality: number
}

export type BaselineDelta = {
  tsFiles: number
  directories: number
  dependencyEdges: number
  cycleEdges: number
  unresolvedImports: number
  architectureViolations: number
  edgeKinds: Record<DependencyEdge['kind'], number>
}

export type DiagnosticsProps = {
  // Resolver / layout summary
  dependencyGraph: DependencyGraph | null
  isLayouting: boolean

  // Export buttons
  scanResult: ScannedProject | null
  exportAnalysisReportJson: () => void
  exportAnalysisReportMarkdown: () => void

  // Baseline compare
  importBaselineReport: (event: ChangeEvent<HTMLInputElement>) => void
  baselineReport: unknown
  setBaselineReport: (value: null) => void
  baselineReportName: string | null
  setBaselineReportName: (value: null) => void
  baselineReportError: string | null
  setBaselineReportError: (value: null) => void
  baselineDelta: BaselineDelta | null

  // Git churn
  importGitChurnReport: (event: ChangeEvent<HTMLInputElement>) => void
  gitChurnReport: GitChurnReport | null
  setGitChurnReport: (value: null) => void
  gitChurnReportName: string | null
  setGitChurnReportName: (value: null) => void
  gitChurnReportError: string | null
  setGitChurnReportError: (value: null) => void
  churnHotFiles: ChurnHotFile[]

  // Git live compare
  gitLiveApiBase: string
  setGitLiveApiBase: (value: string) => void
  gitLiveRepoPath: string
  setGitLiveRepoPath: (value: string) => void
  fetchGitLiveRefs: () => void
  runGitLiveCompare: () => void
  isGitLiveLoading: boolean
  gitLiveRefs: GitLiveRefsResponse | null
  gitLiveBaseRef: string
  setGitLiveBaseRef: (value: string) => void
  gitLiveTargetRef: string
  setGitLiveTargetRef: (value: string) => void
  refreshGitLiveCommits: (which: 'base' | 'target') => void
  gitLiveBaseCommitOverride: string
  setGitLiveBaseCommitOverride: (value: string) => void
  gitLiveTargetCommitOverride: string
  setGitLiveTargetCommitOverride: (value: string) => void
  gitLiveBaseCommits: GitLiveCommit[]
  gitLiveTargetCommits: GitLiveCommit[]
  gitLiveError: string | null

  // Branch compare report
  importGitBranchCompareReport: (event: ChangeEvent<HTMLInputElement>) => void
  gitBranchCompareReport: GitBranchCompareReport | null
  setGitBranchCompareReport: (value: null) => void
  gitBranchCompareReportName: string | null
  setGitBranchCompareReportName: (value: null) => void
  gitBranchCompareReportError: string | null
  setGitBranchCompareReportError: (value: null) => void
  setBranchDiffView: (value: BranchDiffView) => void
  setHighlightOnlyChangedBranchEdges: (value: boolean) => void
  branchCompareHotFiles: BranchCompareHotFile[]

  // Code health / refactor signals
  hotspotFiles: HotspotFile[]
  potentiallyDeadExportFiles: FileAnalysis[]
  topCycleGroups: CycleGroup[]
  dependencyEdgeKindCounts: Record<DependencyEdge['kind'], number>
  riskByFile: RiskFile[]
  riskByBlock: RiskBlock[]
  orphanRuntimeModules: OrphanRuntimeModule[]
  reexportHubFiles: ReexportHubFile[]
  duplicateUtilityGroups: DuplicateUtilityGroup[]
  reexportBottleneckFiles: ReexportBottleneckFile[]
  reexportChains: string[]

  // Architecture (read-only here)
  architectureRuleLines: string[]
  architectureViolations: ArchitectureViolation[]
  architectureViolationByKind: Record<DependencyEdge['kind'], number>
  architectureLayerDistribution: Record<ArchitectureLayerId, number>
  architectureViolationByPair: Array<[string, number]>
  architectureConfig: ArchitectureConfig

  // Selection / hover
  selectedNodeId: string | null
  hoveredFilePath: string | null
  hoveredFileAnalysis: FileAnalysis | null

  // Cross-tab navigation
  focusFileOnBoard: (path: string) => void
}
