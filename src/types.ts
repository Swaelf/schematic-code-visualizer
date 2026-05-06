import type { DependencyEdge } from './lib/models'

export type AppTab = 'overview' | 'board' | 'dependencies' | 'diagnostics' | 'architecture' | 'about'
export type FolderControlMode = 'preset' | 'manual'
export type ManualFolderDepth = 'any' | number
export type EdgeKindFilter = 'all' | DependencyEdge['kind']
export type EdgeColorPriority = 'direction' | 'kind'
export type BranchDiffView = 'off' | 'all' | 'added' | 'modified' | 'deleted' | 'renamed'

export type CycleGroup = {
  id: number
  size: number
  filePaths: string[]
}

export type ArchitectureLayerId = 'ui' | 'domain' | 'infra' | 'shared' | 'tests' | 'unknown'
export type ArchitectureConfigMode = 'visual' | 'json'

export type ArchitectureViolation = {
  fromPath: string
  toPath: string
  fromLayer: ArchitectureLayerId
  toLayer: ArchitectureLayerId
  kind: DependencyEdge['kind']
}

export type AnalysisExportReport = {
  generatedAt: string
  projectRoot: string | null
  summary: {
    tsFiles: number
    directories: number
    dependencyEdges: number
    cycleEdges: number
    unresolvedImports: number
    unresolvedInternal: number
    unresolvedExternal: number
    aliasResolved: number
  }
  edgeKinds: Record<DependencyEdge['kind'], number>
  codeHealth: {
    hotspots: Array<{ path: string; score: number; incoming: number; outgoing: number; loc: number }>
    deadExports: Array<{ path: string; exportCount: number; exports: string[] }>
    cycleGroups: Array<{ id: number; size: number; files: string[] }>
  }
  risk: {
    files: Array<{
      path: string
      score: number
      incomingRuntime: number
      outgoingRuntime: number
      incomingType: number
      outgoingType: number
      incomingReexport: number
      outgoingReexport: number
    }>
    blocks: Array<{
      label: string
      score: number
      fileCount: number
      incomingCrossBlockRuntime: number
      outgoingCrossBlockRuntime: number
    }>
  }
  refactorSignals: {
    orphanRuntimeModules: Array<{
      path: string
      exports: number
      typeTouches: number
      reexportTouches: number
    }>
    reexportHubs: Array<{
      path: string
      outgoingReexport: number
      incomingRuntime: number
      exports: number
    }>
    duplicateUtilityGroups: Array<{
      baseName: string
      hash: string
      paths: string[]
    }>
    reexportBottlenecks: Array<{
      path: string
      score: number
      incomingRuntime: number
      incomingReexport: number
      outgoingReexport: number
    }>
    reexportChains: string[]
  }
  architecture: {
    rules: string[]
    layerDistribution: Record<ArchitectureLayerId, number>
    violationsByKind: Record<DependencyEdge['kind'], number>
    violationsByLayerPair: Array<{ pair: string; count: number }>
    violations: Array<{
      kind: DependencyEdge['kind']
      fromLayer: ArchitectureLayerId
      toLayer: ArchitectureLayerId
      fromPath: string
      toPath: string
    }>
  }
  graphSnapshot?: {
    files: string[]
    edges: Array<{
      fromPath: string
      toPath: string
      kind: DependencyEdge['kind']
    }>
  }
}

export type ArchitectureExportReport = {
  generatedAt: string
  projectRoot: string | null
  rules: string[]
  layerDistribution: Record<ArchitectureLayerId, number>
  violationsByKind: Record<DependencyEdge['kind'], number>
  violationsByLayerPair: Array<{ pair: string; count: number }>
  violations: Array<{
    kind: DependencyEdge['kind']
    fromLayer: ArchitectureLayerId
    toLayer: ArchitectureLayerId
    fromPath: string
    toPath: string
  }>
}

export type GitChurnReport = {
  type: 'git-churn-report-v1'
  generatedAt: string
  repoRootName: string
  since: string
  files: Array<{
    path: string
    commits: number
    additions: number
    deletions: number
    churn: number
  }>
}

export type GitBranchCompareReport = {
  type: 'git-branch-compare-report-v1'
  generatedAt: string
  repoRootName: string
  baseRef: string
  targetRef: string
  mergeBase: string
  summary: {
    changedFiles: number
    added: number
    modified: number
    deleted: number
    renamed: number
    totalAdditions: number
    totalDeletions: number
    totalChurn: number
  }
  files: Array<{
    path: string
    changeType: 'A' | 'M' | 'D' | 'R' | 'C' | 'T' | 'U'
    additions: number
    deletions: number
    churn: number
    oldPath?: string
  }>
}

export type GitLiveRefsResponse = {
  repo: string
  currentBranch: string
  head: string
  branches: string[]
  tags: string[]
}

export type GitLiveCommit = {
  hash: string
  shortHash: string
  date: string
  subject: string
}

export type GitLiveLogResponse = {
  repo: string
  ref: string
  commits: GitLiveCommit[]
}

export type ArchitectureConfig = {
  layerMatchers: Record<ArchitectureLayerId, string[]>
  allowedTargets: Record<ArchitectureLayerId, ArchitectureLayerId[]>
}
