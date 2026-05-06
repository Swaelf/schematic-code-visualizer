import type { DependencyEdge, DependencyGraph, FileAnalysis, ScannedProject } from '../../lib/models'
import type {
  AnalysisExportReport,
  ArchitectureConfig,
  ArchitectureLayerId,
  ArchitectureViolation,
  BranchDiffView,
  CycleGroup,
  GitBranchCompareReport,
  GitChurnReport,
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

  // Export
  scanResult: ScannedProject | null

  // Baseline compare (report itself stays in App for downstream computation; delta is computed locally)
  baselineReport: AnalysisExportReport | null
  setBaselineReport: (value: AnalysisExportReport | null) => void

  // Git churn (report itself stays in App; consumed by hot-files memo there)
  gitChurnReport: GitChurnReport | null
  setGitChurnReport: (value: GitChurnReport | null) => void
  churnHotFiles: ChurnHotFile[]

  // Branch compare report (shared with Board)
  gitBranchCompareReport: GitBranchCompareReport | null
  setGitBranchCompareReport: (value: GitBranchCompareReport | null) => void
  branchDiffView: BranchDiffView
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
