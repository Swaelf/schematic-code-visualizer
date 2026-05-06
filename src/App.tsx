import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import type { Edge, NodeMouseHandler } from '@xyflow/react'
import { About } from './components/About'
import { Architecture } from './components/Architecture'
import { Board } from './components/Board'
import { BusEdge } from './components/BusEdge'
import { ChipFileNode } from './components/ChipFileNode'
import { ClassicEdge } from './components/ClassicEdge'
import { Dependencies } from './components/Dependencies'
import { Diagnostics } from './components/Diagnostics'
import { FolderBlockNode } from './components/FolderBlockNode'
import { Overview } from './components/Overview'
import { TabNav } from './components/TabNav'
import type { StructureViewMode, TreemapMetricMode } from './components/ProjectStructureViz'
import { analyzeProjectDependenciesInWorker } from './lib/analyzer-worker-client'
import { computeBusRoutes } from './lib/bus-router'
import { routeDirectOrthogonal } from './lib/direct-router'
import { applyElkToBlockNodes } from './lib/elk-layout'
import {
  buildDependencyFlowGraph,
  type FolderPackingMode,
  type GraphBuildMode,
  type RoutingStyle,
} from './lib/graph-builder'
import type { DependencyEdge, DependencyGraph, FileAnalysis, ScannedProject } from './lib/models'
import { scanProjectFolder } from './lib/scanner'
import { readTsConfigAliasConfig } from './lib/tsconfig-reader'
import { buildTreeLines } from './lib/tree-view'
import './App.css'
import '@xyflow/react/dist/style.css'

import type {
  AnalysisExportReport,
  AppTab,
  ArchitectureConfig,
  ArchitectureConfigMode,
  ArchitectureExportReport,
  ArchitectureLayerId,
  ArchitectureViolation,
  BranchDiffView,
  EdgeColorPriority,
  EdgeKindFilter,
  FolderControlMode,
  GitBranchCompareReport,
  GitChurnReport,
  GitLiveCommit,
  GitLiveRefsResponse,
  ManualFolderDepth,
} from './types'

import {
  ARCHITECTURE_RULE_LAYERS,
  ARCHITECTURE_STORAGE_KEY,
  DEFAULT_ARCHITECTURE_CONFIG,
} from './constants'

import { buildArchitectureMarkdownReport } from './utils/build-architecture-markdown-report'
import { buildMarkdownReport } from './utils/build-markdown-report'
import { detectArchitectureLayer } from './utils/detect-architecture-layer'
import { downloadTextFile } from './utils/download-text-file'
import { findTopCycleGroups } from './utils/find-top-cycle-groups'
import { getTopLevelBlockLabelForPath } from './utils/get-top-level-block-label-for-path'
import { hashText } from './utils/hash-text'
import { isAnalysisExportReportCandidate } from './utils/is-analysis-export-report-candidate'
import { isArchitectureEdgeAllowed } from './utils/is-architecture-edge-allowed'
import { isGitBranchCompareReportCandidate } from './utils/is-git-branch-compare-report-candidate'
import { isGitChurnReportCandidate } from './utils/is-git-churn-report-candidate'
import { isGitLiveLogResponseCandidate } from './utils/is-git-live-log-response-candidate'
import { isGitLiveRefsResponseCandidate } from './utils/is-git-live-refs-response-candidate'
import { mergeBranchDiffBuckets } from './utils/merge-branch-diff-buckets'
import { normalizeArchitectureConfig } from './utils/normalize-architecture-config'
import { toBranchDiffBucket } from './utils/to-branch-diff-bucket'

function App() {
  const [activeTab, setActiveTab] = useState<AppTab>('overview')
  const canvasShellRef = useRef<HTMLDivElement | null>(null)
  const [isCanvasFullscreen, setIsCanvasFullscreen] = useState(false)
  const [overviewStructureMode, setOverviewStructureMode] = useState<StructureViewMode>('treemap')
  const [overviewTreemapMetric, setOverviewTreemapMetric] = useState<TreemapMetricMode>('files')
  const [scanResult, setScanResult] = useState<ScannedProject | null>(null)
  const [projectReadmeName, setProjectReadmeName] = useState<string | null>(null)
  const [projectReadmeContent, setProjectReadmeContent] = useState<string | null>(null)
  const [dependencyGraph, setDependencyGraph] = useState<DependencyGraph | null>(null)
  const [graphMode, setGraphMode] = useState<GraphBuildMode>('file-level')
  const [routingStyle, setRoutingStyle] = useState<RoutingStyle>('classic')
  const [folderPacking, setFolderPacking] = useState<FolderPackingMode>('balanced')
  const [highlightCycles, setHighlightCycles] = useState(false)
  const [showExternalImports, setShowExternalImports] = useState(true)
  const [simplifyHighlightedRoutes, setSimplifyHighlightedRoutes] = useState(true)
  const [traceIntoCollapsedFolders, setTraceIntoCollapsedFolders] = useState(true)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [directionFilter, setDirectionFilter] = useState<'all' | 'incoming' | 'outgoing'>('all')
  const [edgeKindFilter, setEdgeKindFilter] = useState<EdgeKindFilter>('all')
  const [edgeColorPriority, setEdgeColorPriority] = useState<EdgeColorPriority>('direction')
  const [highlightArchitectureViolations, setHighlightArchitectureViolations] = useState(true)
  const [showBaselineDiff, setShowBaselineDiff] = useState(false)
  const [showOnlyNewDiff, setShowOnlyNewDiff] = useState(false)
  const [branchDiffView, setBranchDiffView] = useState<BranchDiffView>('off')
  const [highlightOnlyChangedBranchEdges, setHighlightOnlyChangedBranchEdges] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [collapsedBlockIds, setCollapsedBlockIds] = useState<Set<string>>(new Set())
  const [autoFolderDepth, setAutoFolderDepth] = useState(true)
  const [manualFolderDepth, setManualFolderDepth] = useState<ManualFolderDepth>(2)
  const [folderControlMode, setFolderControlMode] = useState<FolderControlMode>('preset')
  const [architectureConfig, setArchitectureConfig] = useState<ArchitectureConfig>(DEFAULT_ARCHITECTURE_CONFIG)
  const [architectureConfigMode, setArchitectureConfigMode] = useState<ArchitectureConfigMode>('visual')
  const [architectureConfigDraft, setArchitectureConfigDraft] = useState(
    JSON.stringify(DEFAULT_ARCHITECTURE_CONFIG, null, 2),
  )
  const [architectureConfigError, setArchitectureConfigError] = useState<string | null>(null)
  const [hoveredFilePath, setHoveredFilePath] = useState<string | null>(null)
  const [isCanvasLocked, setIsCanvasLocked] = useState(false)
  const [savedViewport, setSavedViewport] = useState<{ x: number; y: number; zoom: number } | null>(null)
  const [layoutedNodes, setLayoutedNodes] = useState<ReturnType<typeof buildDependencyFlowGraph>['nodes']>([])
  const [isLayouting, setIsLayouting] = useState(false)
  const [isScanning, setIsScanning] = useState(false)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [baselineReport, setBaselineReport] = useState<AnalysisExportReport | null>(null)
  const [baselineReportName, setBaselineReportName] = useState<string | null>(null)
  const [baselineReportError, setBaselineReportError] = useState<string | null>(null)
  const [gitChurnReport, setGitChurnReport] = useState<GitChurnReport | null>(null)
  const [gitChurnReportName, setGitChurnReportName] = useState<string | null>(null)
  const [gitChurnReportError, setGitChurnReportError] = useState<string | null>(null)
  const [gitBranchCompareReport, setGitBranchCompareReport] = useState<GitBranchCompareReport | null>(null)
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
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const treeLines = useMemo(() => buildTreeLines(scanResult?.tree ?? null), [scanResult])
  const fileLocByPath = useMemo(() => {
    const map = new Map<string, number>()
    for (const file of scanResult?.files ?? []) {
      const loc = file.content.split(/\r?\n/).length
      map.set(file.path, Math.max(1, loc))
    }
    return map
  }, [scanResult])
  const nodeTypes = useMemo(() => ({ chipFile: ChipFileNode, folderBlock: FolderBlockNode }), [])
  const edgeTypes = useMemo(() => ({ bus: BusEdge, classicLine: ClassicEdge }), [])

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
  const incomingEdgeCountByPath = useMemo(() => {
    const map = new Map<string, number>()
    for (const edge of dependencyGraph?.edges ?? []) {
      map.set(edge.toPath, (map.get(edge.toPath) ?? 0) + 1)
    }
    return map
  }, [dependencyGraph])
  const outgoingEdgeCountByPath = useMemo(() => {
    const map = new Map<string, number>()
    for (const edge of dependencyGraph?.edges ?? []) {
      map.set(edge.fromPath, (map.get(edge.fromPath) ?? 0) + 1)
    }
    return map
  }, [dependencyGraph])
  const hotspotFiles = useMemo(() => {
    if (!dependencyGraph) {
      return []
    }
    return dependencyGraph.files
      .map((file) => {
        const incoming = incomingEdgeCountByPath.get(file.path) ?? 0
        const outgoing = outgoingEdgeCountByPath.get(file.path) ?? 0
        const loc = fileLocByPath.get(file.path) ?? 0
        const score = incoming * 2 + outgoing + Math.round(loc / 180)
        return {
          path: file.path,
          incoming,
          outgoing,
          exports: file.exports.length,
          loc,
          score,
        }
      })
      .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path))
      .slice(0, 10)
  }, [dependencyGraph, fileLocByPath, incomingEdgeCountByPath, outgoingEdgeCountByPath])
  const potentiallyDeadExportFiles = useMemo(() => {
    if (!dependencyGraph) {
      return []
    }
    return dependencyGraph.files
      .filter((file) => file.exports.length > 0 && (incomingEdgeCountByPath.get(file.path) ?? 0) === 0)
      .sort((left, right) => right.exports.length - left.exports.length || left.path.localeCompare(right.path))
      .slice(0, 12)
  }, [dependencyGraph, incomingEdgeCountByPath])
  const topCycleGroups = useMemo(() => {
    if (!dependencyGraph) {
      return []
    }
    return findTopCycleGroups(
      dependencyGraph.files.map((file) => file.path),
      dependencyGraph.edges.map((edge) => ({ fromPath: edge.fromPath, toPath: edge.toPath })),
      5,
    )
  }, [dependencyGraph])
  const cycleFilePathSet = useMemo(() => {
    if (!dependencyGraph) {
      return new Set<string>()
    }
    const groups = findTopCycleGroups(
      dependencyGraph.files.map((file) => file.path),
      dependencyGraph.edges.map((edge) => ({ fromPath: edge.fromPath, toPath: edge.toPath })),
      Number.MAX_SAFE_INTEGER,
    )
    const ids = new Set<string>()
    for (const group of groups) {
      for (const filePath of group.filePaths) {
        ids.add(filePath)
      }
    }
    return ids
  }, [dependencyGraph])
  const dependencyEdgeKindCounts = useMemo(() => {
    const counts: Record<DependencyEdge['kind'], number> = {
      runtime: 0,
      type: 0,
      're-export': 0,
    }
    for (const edge of dependencyGraph?.edges ?? []) {
      counts[edge.kind] += 1
    }
    return counts
  }, [dependencyGraph])
  const riskByFile = useMemo(() => {
    if (!dependencyGraph) {
      return []
    }
    const inRuntime = new Map<string, number>()
    const outRuntime = new Map<string, number>()
    const inType = new Map<string, number>()
    const outType = new Map<string, number>()
    const inReexport = new Map<string, number>()
    const outReexport = new Map<string, number>()

    for (const edge of dependencyGraph.edges) {
      if (edge.kind === 'runtime') {
        inRuntime.set(edge.toPath, (inRuntime.get(edge.toPath) ?? 0) + 1)
        outRuntime.set(edge.fromPath, (outRuntime.get(edge.fromPath) ?? 0) + 1)
      } else if (edge.kind === 'type') {
        inType.set(edge.toPath, (inType.get(edge.toPath) ?? 0) + 1)
        outType.set(edge.fromPath, (outType.get(edge.fromPath) ?? 0) + 1)
      } else {
        inReexport.set(edge.toPath, (inReexport.get(edge.toPath) ?? 0) + 1)
        outReexport.set(edge.fromPath, (outReexport.get(edge.fromPath) ?? 0) + 1)
      }
    }

    return dependencyGraph.files
      .map((file) => {
        const incomingRuntime = inRuntime.get(file.path) ?? 0
        const outgoingRuntime = outRuntime.get(file.path) ?? 0
        const incomingType = inType.get(file.path) ?? 0
        const outgoingType = outType.get(file.path) ?? 0
        const incomingReexport = inReexport.get(file.path) ?? 0
        const outgoingReexport = outReexport.get(file.path) ?? 0
        const loc = fileLocByPath.get(file.path) ?? 0
        const cycleBoost = cycleFilePathSet.has(file.path) ? 6 : 0
        const score =
          incomingRuntime * 2.4 +
          outgoingRuntime * 1.35 +
          incomingType * 0.8 +
          outgoingType * 0.6 +
          incomingReexport * 1.1 +
          outgoingReexport * 1.2 +
          Math.round(loc / 220) +
          cycleBoost

        return {
          path: file.path,
          score: Number(score.toFixed(2)),
          incomingRuntime,
          outgoingRuntime,
          incomingType,
          outgoingType,
          incomingReexport,
          outgoingReexport,
        }
      })
      .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path))
      .slice(0, 12)
  }, [dependencyGraph, fileLocByPath, cycleFilePathSet])
  const riskByBlock = useMemo(() => {
    if (!scanResult || riskByFile.length === 0 || !dependencyGraph) {
      return []
    }
    const aggregated = new Map<
      string,
      {
        scoreSum: number
        fileCount: number
        incomingCrossBlockRuntime: number
        outgoingCrossBlockRuntime: number
      }
    >()

    const ensureBlock = (label: string) => {
      const existing = aggregated.get(label)
      if (existing) {
        return existing
      }
      const created = {
        scoreSum: 0,
        fileCount: 0,
        incomingCrossBlockRuntime: 0,
        outgoingCrossBlockRuntime: 0,
      }
      aggregated.set(label, created)
      return created
    }

    for (const fileRisk of riskByFile) {
      const blockLabel = getTopLevelBlockLabelForPath(fileRisk.path, scanResult.rootName)
      const bucket = ensureBlock(blockLabel)
      bucket.scoreSum += fileRisk.score
      bucket.fileCount += 1
    }

    for (const edge of dependencyGraph.edges) {
      if (edge.kind !== 'runtime') {
        continue
      }
      const sourceBlock = getTopLevelBlockLabelForPath(edge.fromPath, scanResult.rootName)
      const targetBlock = getTopLevelBlockLabelForPath(edge.toPath, scanResult.rootName)
      if (sourceBlock === targetBlock) {
        continue
      }
      ensureBlock(sourceBlock).outgoingCrossBlockRuntime += 1
      ensureBlock(targetBlock).incomingCrossBlockRuntime += 1
    }

    return [...aggregated.entries()]
      .map(([label, bucket]) => {
        const normalized = bucket.scoreSum / Math.sqrt(Math.max(bucket.fileCount, 1))
        const score = normalized + bucket.incomingCrossBlockRuntime * 1.4 + bucket.outgoingCrossBlockRuntime
        return {
          label,
          score: Number(score.toFixed(2)),
          fileCount: bucket.fileCount,
          incomingCrossBlockRuntime: bucket.incomingCrossBlockRuntime,
          outgoingCrossBlockRuntime: bucket.outgoingCrossBlockRuntime,
        }
      })
      .sort((left, right) => right.score - left.score || left.label.localeCompare(right.label))
      .slice(0, 8)
  }, [scanResult, dependencyGraph, riskByFile])
  const architectureLayerByPath = useMemo(() => {
    const map = new Map<string, ArchitectureLayerId>()
    for (const file of dependencyGraph?.files ?? []) {
      map.set(file.path, detectArchitectureLayer(file.path, architectureConfig))
    }
    return map
  }, [dependencyGraph, architectureConfig])
  const architectureLayerDistribution = useMemo(() => {
    const counts: Record<ArchitectureLayerId, number> = {
      ui: 0,
      domain: 0,
      infra: 0,
      shared: 0,
      tests: 0,
      unknown: 0,
    }
    for (const layer of architectureLayerByPath.values()) {
      counts[layer] += 1
    }
    return counts
  }, [architectureLayerByPath])
  const architectureViolations = useMemo(() => {
    if (!dependencyGraph) {
      return []
    }
    const violations: ArchitectureViolation[] = []
    for (const edge of dependencyGraph.edges) {
      const fromLayer = architectureLayerByPath.get(edge.fromPath) ?? 'unknown'
      const toLayer = architectureLayerByPath.get(edge.toPath) ?? 'unknown'
      if (isArchitectureEdgeAllowed(fromLayer, toLayer, architectureConfig)) {
        continue
      }
      violations.push({
        fromPath: edge.fromPath,
        toPath: edge.toPath,
        fromLayer,
        toLayer,
        kind: edge.kind,
      })
    }
    return violations
      .sort(
        (left, right) =>
          left.fromLayer.localeCompare(right.fromLayer) ||
          left.toLayer.localeCompare(right.toLayer) ||
          left.fromPath.localeCompare(right.fromPath) ||
          left.toPath.localeCompare(right.toPath),
      )
      .slice(0, 40)
  }, [dependencyGraph, architectureLayerByPath, architectureConfig])
  const architectureViolationByPair = useMemo(() => {
    const counts = new Map<string, number>()
    for (const violation of architectureViolations) {
      const key = `${violation.fromLayer}->${violation.toLayer}`
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return [...counts.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, 10)
  }, [architectureViolations])
  const architectureViolationByKind = useMemo(() => {
    const counts: Record<DependencyEdge['kind'], number> = {
      runtime: 0,
      type: 0,
      're-export': 0,
    }
    for (const violation of architectureViolations) {
      counts[violation.kind] += 1
    }
    return counts
  }, [architectureViolations])
  const architectureRuleLines = useMemo(
    () => ARCHITECTURE_RULE_LAYERS.map((layer) => `${layer} -> ${architectureConfig.allowedTargets[layer].join('/')}`),
    [architectureConfig],
  )
  const refactorSignalStatsByPath = useMemo(() => {
    const stats = new Map<
      string,
      {
        incomingRuntime: number
        outgoingRuntime: number
        incomingType: number
        outgoingType: number
        incomingReexport: number
        outgoingReexport: number
      }
    >()
    const ensure = (path: string) => {
      const existing = stats.get(path)
      if (existing) {
        return existing
      }
      const created = {
        incomingRuntime: 0,
        outgoingRuntime: 0,
        incomingType: 0,
        outgoingType: 0,
        incomingReexport: 0,
        outgoingReexport: 0,
      }
      stats.set(path, created)
      return created
    }
    for (const file of dependencyGraph?.files ?? []) {
      ensure(file.path)
    }
    for (const edge of dependencyGraph?.edges ?? []) {
      const from = ensure(edge.fromPath)
      const to = ensure(edge.toPath)
      if (edge.kind === 'runtime') {
        from.outgoingRuntime += 1
        to.incomingRuntime += 1
      } else if (edge.kind === 'type') {
        from.outgoingType += 1
        to.incomingType += 1
      } else {
        from.outgoingReexport += 1
        to.incomingReexport += 1
      }
    }
    return stats
  }, [dependencyGraph])
  const orphanRuntimeModules = useMemo(() => {
    if (!dependencyGraph) {
      return []
    }
    return dependencyGraph.files
      .filter((file) => {
        const stats = refactorSignalStatsByPath.get(file.path)
        if (!stats) {
          return false
        }
        const lower = file.path.toLowerCase()
        if (lower.includes('/__tests__/') || lower.includes('.test.') || lower.includes('.spec.')) {
          return false
        }
        return stats.incomingRuntime === 0 && stats.outgoingRuntime === 0
      })
      .map((file) => {
        const stats = refactorSignalStatsByPath.get(file.path)!
        return {
          path: file.path,
          exports: file.exports.length,
          typeTouches: stats.incomingType + stats.outgoingType,
          reexportTouches: stats.incomingReexport + stats.outgoingReexport,
        }
      })
      .sort(
        (left, right) =>
          right.exports - left.exports ||
          right.typeTouches - left.typeTouches ||
          left.path.localeCompare(right.path),
      )
      .slice(0, 20)
  }, [dependencyGraph, refactorSignalStatsByPath])
  const reexportHubFiles = useMemo(() => {
    if (!dependencyGraph) {
      return []
    }
    return dependencyGraph.files
      .map((file) => {
        const stats = refactorSignalStatsByPath.get(file.path)
        const outgoingReexport = stats?.outgoingReexport ?? 0
        const incomingRuntime = stats?.incomingRuntime ?? 0
        return {
          path: file.path,
          outgoingReexport,
          incomingRuntime,
          exports: file.exports.length,
        }
      })
      .filter((item) => item.outgoingReexport > 0)
      .sort(
        (left, right) =>
          right.outgoingReexport - left.outgoingReexport ||
          right.incomingRuntime - left.incomingRuntime ||
          left.path.localeCompare(right.path),
      )
      .slice(0, 20)
  }, [dependencyGraph, refactorSignalStatsByPath])
  const duplicateUtilityGroups = useMemo(() => {
    if (!scanResult || scanResult.files.length === 0) {
      return []
    }
    const groups = new Map<string, { baseName: string; hash: string; paths: string[] }>()
    for (const file of scanResult.files) {
      const normalizedPath = file.path.toLowerCase()
      const isUtilityPath =
        normalizedPath.includes('/utils/') ||
        normalizedPath.includes('/helpers/') ||
        normalizedPath.includes('/common/') ||
        normalizedPath.includes('/shared/') ||
        normalizedPath.includes('/lib/') ||
        normalizedPath.includes('/hooks/') ||
        normalizedPath.endsWith('.util.ts') ||
        normalizedPath.endsWith('.utils.ts')
      if (!isUtilityPath) {
        continue
      }
      const fileName = file.path.split('/').pop() ?? file.path
      const normalizedContent = file.content
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '')
        .replace(/\s+/g, ' ')
        .trim()
      if (!normalizedContent) {
        continue
      }
      const hash = hashText(normalizedContent)
      const key = `${fileName.toLowerCase()}::${hash}`
      const existing = groups.get(key)
      if (existing) {
        existing.paths.push(file.path)
      } else {
        groups.set(key, { baseName: fileName, hash, paths: [file.path] })
      }
    }
    return [...groups.values()]
      .filter((item) => item.paths.length > 1)
      .map((item) => ({
        baseName: item.baseName,
        hash: item.hash,
        paths: [...item.paths].sort((left, right) => left.localeCompare(right)),
      }))
      .sort((left, right) => right.paths.length - left.paths.length || left.baseName.localeCompare(right.baseName))
      .slice(0, 20)
  }, [scanResult])
  const reexportBottleneckFiles = useMemo(() => {
    if (!dependencyGraph) {
      return []
    }
    return dependencyGraph.files
      .map((file) => {
        const stats = refactorSignalStatsByPath.get(file.path)
        const outgoingReexport = stats?.outgoingReexport ?? 0
        const incomingReexport = stats?.incomingReexport ?? 0
        const incomingRuntime = stats?.incomingRuntime ?? 0
        const score = outgoingReexport * 2 + incomingRuntime + incomingReexport * 1.5
        return {
          path: file.path,
          score: Number(score.toFixed(2)),
          incomingRuntime,
          incomingReexport,
          outgoingReexport,
        }
      })
      .filter((item) => item.outgoingReexport > 0 && (item.incomingRuntime > 0 || item.incomingReexport > 0))
      .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path))
      .slice(0, 20)
  }, [dependencyGraph, refactorSignalStatsByPath])
  const reexportChains = useMemo(() => {
    if (!dependencyGraph) {
      return []
    }
    const adjacency = new Map<string, Set<string>>()
    const incomingCount = new Map<string, number>()

    for (const file of dependencyGraph.files) {
      adjacency.set(file.path, new Set<string>())
      incomingCount.set(file.path, 0)
    }
    for (const edge of dependencyGraph.edges) {
      if (edge.kind !== 're-export') {
        continue
      }
      adjacency.get(edge.fromPath)?.add(edge.toPath)
      incomingCount.set(edge.toPath, (incomingCount.get(edge.toPath) ?? 0) + 1)
    }

    const starts = [...adjacency.keys()].filter((path) => (incomingCount.get(path) ?? 0) === 0)
    const roots = starts.length > 0 ? starts : [...adjacency.keys()]
    const chains = new Set<string>()
    const maxDepth = 6

    const dfs = (current: string, path: string[]) => {
      if (path.length > maxDepth) {
        return
      }
      const nextTargets = [...(adjacency.get(current) ?? [])].sort((left, right) => left.localeCompare(right))
      if (nextTargets.length === 0) {
        if (path.length >= 3) {
          chains.add(path.join(' -> '))
        }
        return
      }
      let extended = false
      for (const next of nextTargets) {
        if (path.includes(next)) {
          continue
        }
        extended = true
        dfs(next, [...path, next])
      }
      if (!extended && path.length >= 3) {
        chains.add(path.join(' -> '))
      }
    }

    for (const root of roots) {
      dfs(root, [root])
    }

    return [...chains]
      .sort((left, right) => right.split(' -> ').length - left.split(' -> ').length || left.localeCompare(right))
      .slice(0, 20)
  }, [dependencyGraph])
  const gitChurnByPath = useMemo(() => {
    const map = new Map<string, { commits: number; additions: number; deletions: number; churn: number }>()
    const rootName = scanResult?.rootName
    for (const item of gitChurnReport?.files ?? []) {
      const normalized = item.path.replace(/\\/g, '/').replace(/^\.\//, '')
      map.set(normalized, {
        commits: item.commits,
        additions: item.additions,
        deletions: item.deletions,
        churn: item.churn,
      })
      if (rootName && !normalized.startsWith(`${rootName}/`)) {
        map.set(`${rootName}/${normalized}`, {
          commits: item.commits,
          additions: item.additions,
          deletions: item.deletions,
          churn: item.churn,
        })
      }
    }
    return map
  }, [gitChurnReport, scanResult?.rootName])
  const churnHotFiles = useMemo(() => {
    if (!dependencyGraph) {
      return []
    }
    return dependencyGraph.files
      .map((file) => {
        const churn = gitChurnByPath.get(file.path)
        const incoming = incomingEdgeCountByPath.get(file.path) ?? 0
        const outgoing = outgoingEdgeCountByPath.get(file.path) ?? 0
        const centrality = incoming + outgoing
        const churnScore = churn?.churn ?? 0
        const commits = churn?.commits ?? 0
        const weighted = Number((churnScore * (1 + Math.log2(centrality + 1))).toFixed(2))
        return {
          path: file.path,
          churn: churnScore,
          commits,
          centrality,
          weighted,
        }
      })
      .filter((item) => item.churn > 0)
      .sort((left, right) => right.weighted - left.weighted || right.churn - left.churn || left.path.localeCompare(right.path))
      .slice(0, 20)
  }, [dependencyGraph, gitChurnByPath, incomingEdgeCountByPath, outgoingEdgeCountByPath])
  const branchCompareByPath = useMemo(() => {
    const map = new Map<string, { changeType: string; additions: number; deletions: number; churn: number; oldPath?: string }>()
    const rootName = scanResult?.rootName
    for (const item of gitBranchCompareReport?.files ?? []) {
      const normalized = item.path.replace(/\\/g, '/').replace(/^\.\//, '')
      map.set(normalized, item)
      if (rootName && !normalized.startsWith(`${rootName}/`)) {
        map.set(`${rootName}/${normalized}`, item)
      }
    }
    return map
  }, [gitBranchCompareReport, scanResult?.rootName])
  const branchCompareHotFiles = useMemo(() => {
    if (!dependencyGraph) {
      return []
    }
    return dependencyGraph.files
      .map((file) => {
        const changed = branchCompareByPath.get(file.path)
        const incoming = incomingEdgeCountByPath.get(file.path) ?? 0
        const outgoing = outgoingEdgeCountByPath.get(file.path) ?? 0
        const centrality = incoming + outgoing
        const churn = changed?.churn ?? 0
        const weighted = Number((churn * (1 + Math.log2(centrality + 1))).toFixed(2))
        return {
          path: file.path,
          changeType: changed?.changeType ?? 'M',
          additions: changed?.additions ?? 0,
          deletions: changed?.deletions ?? 0,
          churn,
          centrality,
          weighted,
          oldPath: changed?.oldPath,
        }
      })
      .filter((item) => item.churn > 0)
      .sort((left, right) => right.weighted - left.weighted || right.churn - left.churn || left.path.localeCompare(right.path))
      .slice(0, 20)
  }, [dependencyGraph, branchCompareByPath, incomingEdgeCountByPath, outgoingEdgeCountByPath])
  const branchDiffBucketByFileNodeId = useMemo(() => {
    const map = new Map<string, Exclude<BranchDiffView, 'off' | 'all'>>()
    for (const [path, item] of branchCompareByPath.entries()) {
      map.set(`file:${path}`, toBranchDiffBucket(item.changeType as GitBranchCompareReport['files'][number]['changeType']))
    }
    return map
  }, [branchCompareByPath])
  const branchDiffVisibleFileNodeIds = useMemo(() => {
    if (branchDiffView === 'off' || !gitBranchCompareReport) {
      return new Set<string>()
    }
    const ids = new Set<string>()
    for (const [fileNodeId, bucket] of branchDiffBucketByFileNodeId.entries()) {
      if (branchDiffView === 'all' || bucket === branchDiffView) {
        ids.add(fileNodeId)
      }
    }
    return ids
  }, [branchDiffView, gitBranchCompareReport, branchDiffBucketByFileNodeId])
  const architectureViolationEdgeKeySet = useMemo(() => {
    const keys = new Set<string>()
    for (const item of architectureViolations) {
      keys.add(`${item.fromPath}->${item.toPath}`)
    }
    return keys
  }, [architectureViolations])
  const architectureViolationBlockPairCount = useMemo(() => {
    const counts = new Map<string, number>()
    for (const item of architectureViolations) {
      const sourceBlock = `block:${getTopLevelBlockLabelForPath(item.fromPath, scanResult?.rootName)}`
      const targetBlock = `block:${getTopLevelBlockLabelForPath(item.toPath, scanResult?.rootName)}`
      if (sourceBlock === targetBlock) {
        continue
      }
      const key = `${sourceBlock}->${targetBlock}`
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return counts
  }, [architectureViolations, scanResult?.rootName])
  const architectureViolationNodeIds = useMemo(() => {
    const ids = new Set<string>()
    for (const item of architectureViolations) {
      ids.add(`file:${item.fromPath}`)
      ids.add(`file:${item.toPath}`)
      ids.add(`block:${getTopLevelBlockLabelForPath(item.fromPath, scanResult?.rootName)}`)
      ids.add(`block:${getTopLevelBlockLabelForPath(item.toPath, scanResult?.rootName)}`)
    }
    return ids
  }, [architectureViolations, scanResult?.rootName])
  const analysisReport = useMemo<AnalysisExportReport>(() => {
    const now = new Date().toISOString()
    return {
      generatedAt: now,
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
        cycleGroups: topCycleGroups.map((group) => ({
          id: group.id,
          size: group.size,
          files: group.filePaths,
        })),
      },
      risk: {
        files: riskByFile,
        blocks: riskByBlock,
      },
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
  const architectureReport = useMemo<ArchitectureExportReport>(
    () => ({
      generatedAt: new Date().toISOString(),
      projectRoot: scanResult?.rootName ?? null,
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
    }),
    [
      architectureLayerDistribution,
      architectureRuleLines,
      architectureViolationByKind,
      architectureViolationByPair,
      architectureViolations,
      scanResult?.rootName,
    ],
  )
  const baselineDelta = useMemo(() => {
    if (!baselineReport) {
      return null
    }
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
  const hasBaselineGraphSnapshot = useMemo(
    () =>
      !!baselineReport &&
      Array.isArray(baselineReport.graphSnapshot?.files) &&
      Array.isArray(baselineReport.graphSnapshot?.edges),
    [baselineReport],
  )
  const baselineFilePathSet = useMemo(() => {
    if (!hasBaselineGraphSnapshot) {
      return new Set<string>()
    }
    return new Set(baselineReport?.graphSnapshot?.files ?? [])
  }, [hasBaselineGraphSnapshot, baselineReport])
  const baselineEdgeKeySet = useMemo(() => {
    const keys = new Set<string>()
    if (!hasBaselineGraphSnapshot) {
      return keys
    }
    for (const edge of baselineReport?.graphSnapshot?.edges ?? []) {
      keys.add(`${edge.fromPath}->${edge.toPath}::${edge.kind}`)
    }
    return keys
  }, [hasBaselineGraphSnapshot, baselineReport])
  const newFilePathSet = useMemo(() => {
    const ids = new Set<string>()
    if (!showBaselineDiff || !hasBaselineGraphSnapshot) {
      return ids
    }
    for (const file of dependencyGraph?.files ?? []) {
      if (!baselineFilePathSet.has(file.path)) {
        ids.add(file.path)
      }
    }
    return ids
  }, [showBaselineDiff, hasBaselineGraphSnapshot, dependencyGraph, baselineFilePathSet])
  const newFileEdgeKeySet = useMemo(() => {
    const keys = new Set<string>()
    if (!showBaselineDiff || !hasBaselineGraphSnapshot) {
      return keys
    }
    for (const edge of dependencyGraph?.edges ?? []) {
      if (edgeKindFilter !== 'all' && edge.kind !== edgeKindFilter) {
        continue
      }
      const key = `${edge.fromPath}->${edge.toPath}::${edge.kind}`
      if (!baselineEdgeKeySet.has(key)) {
        keys.add(key)
      }
    }
    return keys
  }, [showBaselineDiff, hasBaselineGraphSnapshot, dependencyGraph, edgeKindFilter, baselineEdgeKeySet])
  const newBlockPairSet = useMemo(() => {
    const keys = new Set<string>()
    if (!showBaselineDiff || !hasBaselineGraphSnapshot) {
      return keys
    }
    for (const edge of dependencyGraph?.edges ?? []) {
      if (edgeKindFilter !== 'all' && edge.kind !== edgeKindFilter) {
        continue
      }
      const fileEdgeKey = `${edge.fromPath}->${edge.toPath}::${edge.kind}`
      if (!newFileEdgeKeySet.has(fileEdgeKey)) {
        continue
      }
      const sourceBlock = `block:${getTopLevelBlockLabelForPath(edge.fromPath, scanResult?.rootName)}`
      const targetBlock = `block:${getTopLevelBlockLabelForPath(edge.toPath, scanResult?.rootName)}`
      if (sourceBlock === targetBlock) {
        continue
      }
      keys.add(`${sourceBlock}->${targetBlock}`)
    }
    return keys
  }, [showBaselineDiff, hasBaselineGraphSnapshot, dependencyGraph, edgeKindFilter, newFileEdgeKeySet, scanResult?.rootName])
  const diffRelevantNodeIds = useMemo(() => {
    const ids = new Set<string>()
    if (!showBaselineDiff || !showOnlyNewDiff || layoutedNodes.length === 0) {
      return ids
    }
    const parentById = new Map<string, string>()
    for (const node of layoutedNodes) {
      if (node.parentId) {
        parentById.set(node.id, node.parentId)
      }
    }
    for (const path of newFilePathSet) {
      const fileNodeId = `file:${path}`
      ids.add(fileNodeId)
      let parentId = parentById.get(fileNodeId)
      while (parentId) {
        ids.add(parentId)
        parentId = parentById.get(parentId)
      }
    }
    for (const pair of newBlockPairSet) {
      const [source, target] = pair.split('->')
      if (source) {
        ids.add(source)
      }
      if (target) {
        ids.add(target)
      }
    }
    return ids
  }, [showBaselineDiff, showOnlyNewDiff, layoutedNodes, newFilePathSet, newBlockPairSet])

  const flowGraph = useMemo(() => {
    if (!scanResult || !dependencyGraph) {
      return null
    }
    return buildDependencyFlowGraph(scanResult, dependencyGraph, graphMode, {
      highlightCycles,
      routingStyle,
      folderPacking,
      edgeKindFilter,
      includeExternalImports: showExternalImports,
    })
  }, [scanResult, dependencyGraph, graphMode, highlightCycles, routingStyle, folderPacking, edgeKindFilter, showExternalImports])

  const fileNodeToBlockId = useMemo(() => {
    const map = new Map<string, string>()
    for (const node of flowGraph?.nodes ?? []) {
      if (node.parentId && node.id.startsWith('file:')) {
        map.set(node.id, node.parentId)
      }
    }
    return map
  }, [flowGraph])
  const branchDiffVisibleBlockIds = useMemo(() => {
    if (branchDiffVisibleFileNodeIds.size === 0) {
      return new Set<string>()
    }
    const ids = new Set<string>()
    for (const fileNodeId of branchDiffVisibleFileNodeIds) {
      const blockId = fileNodeToBlockId.get(fileNodeId)
      if (blockId) {
        ids.add(blockId)
      }
    }
    return ids
  }, [branchDiffVisibleFileNodeIds, fileNodeToBlockId])
  const branchDiffBucketsByBlockId = useMemo(() => {
    const map = new Map<string, Exclude<BranchDiffView, 'off' | 'all'>>()
    for (const [fileNodeId, bucket] of branchDiffBucketByFileNodeId.entries()) {
      const blockId = fileNodeToBlockId.get(fileNodeId)
      if (!blockId) {
        continue
      }
      const merged = mergeBranchDiffBuckets(map.get(blockId), bucket)
      if (merged) {
        map.set(blockId, merged)
      }
    }
    return map
  }, [branchDiffBucketByFileNodeId, fileNodeToBlockId])

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
    const parentById = new Map<string, string>()
    for (const node of flowGraph.nodes) {
      if (node.parentId) {
        parentById.set(node.id, node.parentId)
      }
    }
    for (const node of flowGraph.nodes) {
      let parentId = node.parentId
      let isHidden = false
      while (parentId) {
        if (collapsedBlockIds.has(parentId)) {
          isHidden = true
          break
        }
        parentId = parentById.get(parentId)
      }
      if (isHidden) {
        ids.add(node.id)
      }
    }
    return ids
  }, [flowGraph, graphMode, collapsedBlockIds])

  const visibleEdges = useMemo(() => {
    if (!flowGraph) {
      return []
    }
    const parentByNodeId = new Map<string, string>()
    for (const node of flowGraph.nodes) {
      if (node.parentId) parentByNodeId.set(node.id, node.parentId)
    }
    const findVisibleAncestor = (nodeId: string): string | null => {
      let cur: string | undefined = nodeId
      while (cur && hiddenNodeIds.has(cur)) {
        cur = parentByNodeId.get(cur)
      }
      return cur ?? null
    }
    let filteredByCollapse: Edge[]
    if (traceIntoCollapsedFolders && selectedNodeId) {
      filteredByCollapse = []
      for (const edge of flowGraph.edges) {
        const sourceHidden = hiddenNodeIds.has(edge.source)
        const targetHidden = hiddenNodeIds.has(edge.target)
        if (!sourceHidden && !targetHidden) {
          filteredByCollapse.push(edge)
          continue
        }
        // Only redirect when the visible endpoint is the selected node — otherwise drop.
        const visibleEnd = sourceHidden ? edge.target : edge.source
        if (visibleEnd !== selectedNodeId) continue
        const newSource = sourceHidden ? findVisibleAncestor(edge.source) : edge.source
        const newTarget = targetHidden ? findVisibleAncestor(edge.target) : edge.target
        if (!newSource || !newTarget || newSource === newTarget) continue
        filteredByCollapse.push({
          ...edge,
          id: `${edge.id}::traced`,
          source: newSource,
          target: newTarget,
          data: {
            ...(edge.data ?? {}),
            tracedToCollapsed: true,
            originalSource: edge.source,
            originalTarget: edge.target,
          },
        })
      }
    } else {
      filteredByCollapse = flowGraph.edges.filter(
        (edge) => !hiddenNodeIds.has(edge.source) && !hiddenNodeIds.has(edge.target),
      )
    }
    if (showBaselineDiff && showOnlyNewDiff && hasBaselineGraphSnapshot) {
      filteredByCollapse = filteredByCollapse.filter((edge) => {
        const isFileEdge = edge.source.startsWith('file:') && edge.target.startsWith('file:')
        if (isFileEdge) {
          const kind = String(edge.data?.dependencyKind ?? 'runtime')
          return newFileEdgeKeySet.has(`${edge.source.slice(5)}->${edge.target.slice(5)}::${kind}`)
        }
        const isBlockEdge = edge.source.startsWith('block:') && edge.target.startsWith('block:')
        if (isBlockEdge) {
          return newBlockPairSet.has(`${edge.source}->${edge.target}`)
        }
        return false
      })
    }
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
  }, [
    flowGraph,
    hiddenNodeIds,
    selectedNodeId,
    directionFilter,
    showBaselineDiff,
    showOnlyNewDiff,
    hasBaselineGraphSnapshot,
    newFileEdgeKeySet,
    newBlockPairSet,
    branchDiffView,
    gitBranchCompareReport,
    highlightOnlyChangedBranchEdges,
    branchDiffBucketByFileNodeId,
    branchDiffBucketsByBlockId,
    traceIntoCollapsedFolders,
  ])

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

  const incomingRelatedNodeIds = useMemo(() => {
    const ids = new Set<string>()
    if (!selectedNodeId) {
      return ids
    }
    for (const edge of visibleEdges) {
      if (edge.target === selectedNodeId) {
        ids.add(edge.source)
      }
    }
    return ids
  }, [selectedNodeId, visibleEdges])

  const outgoingRelatedNodeIds = useMemo(() => {
    const ids = new Set<string>()
    if (!selectedNodeId) {
      return ids
    }
    for (const edge of visibleEdges) {
      if (edge.source === selectedNodeId) {
        ids.add(edge.target)
      }
    }
    return ids
  }, [selectedNodeId, visibleEdges])

  const visibleNodes = useMemo(() => {
    if (!flowGraph || layoutedNodes.length === 0) {
      return []
    }
    return layoutedNodes
      .filter((node) => {
        if (hiddenNodeIds.has(node.id)) {
          return false
        }
        if (showBaselineDiff && showOnlyNewDiff && hasBaselineGraphSnapshot) {
          return diffRelevantNodeIds.has(node.id)
        }
        return true
      })
      .map((node) => {
        const isSelected = node.id === selectedNodeId
        const isConnected = connectedNodeIds.has(node.id)
        const isFileNode = node.id.startsWith('file:')
        const isMatch = matchingFileNodeIds.has(node.id)
        const isBlockWithMatch = blockIdsWithMatches.has(node.id)
        const isIncomingRelated = incomingRelatedNodeIds.has(node.id)
        const isOutgoingRelated = outgoingRelatedNodeIds.has(node.id)
        const isArchitectureViolationNode = architectureViolationNodeIds.has(node.id)
        const isNewFileNode = node.id.startsWith('file:') && newFilePathSet.has(node.id.slice(5))
        const branchDiffBucket = isFileNode ? branchDiffBucketByFileNodeId.get(node.id) : undefined
        const isBranchDiffVisibleFile = isFileNode && branchDiffVisibleFileNodeIds.has(node.id)
        const isBranchDiffVisibleBlock = !isFileNode && branchDiffVisibleBlockIds.has(node.id)
        const isBranchDiffViewEnabled = branchDiffView !== 'off' && !!gitBranchCompareReport
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
        if (showBaselineDiff && hasBaselineGraphSnapshot && isFileNode && !isNewFileNode) {
          nextStyle.opacity = Math.min(nextStyle.opacity, 0.28)
        }
        if (isBranchDiffViewEnabled && !highlightOnlyChangedBranchEdges) {
          if (isFileNode && !isBranchDiffVisibleFile) {
            nextStyle.opacity = Math.min(nextStyle.opacity, 0.2)
          }
          if (!isFileNode && !isBranchDiffVisibleBlock) {
            nextStyle.opacity = Math.min(nextStyle.opacity, 0.3)
          }
        }
        if (!highlightOnlyChangedBranchEdges && !isSelected && isBranchDiffVisibleFile && branchDiffBucket) {
          if (branchDiffBucket === 'added') {
            nextStyle.border = '2px solid #38d39f'
            nextStyle.boxShadow = '0 0 0 2px rgba(56, 211, 159, 0.28), 0 0 10px rgba(56, 211, 159, 0.18)'
          } else if (branchDiffBucket === 'modified') {
            nextStyle.border = '2px solid #ffd166'
            nextStyle.boxShadow = '0 0 0 2px rgba(255, 209, 102, 0.3), 0 0 10px rgba(255, 209, 102, 0.16)'
          } else if (branchDiffBucket === 'deleted') {
            nextStyle.border = '2px solid #ff7d7d'
            nextStyle.boxShadow = '0 0 0 2px rgba(255, 125, 125, 0.3), 0 0 10px rgba(255, 125, 125, 0.18)'
          } else if (branchDiffBucket === 'renamed') {
            nextStyle.border = '2px solid #8ac7ff'
            nextStyle.boxShadow = '0 0 0 2px rgba(138, 199, 255, 0.3), 0 0 10px rgba(138, 199, 255, 0.16)'
          }
        } else if (!highlightOnlyChangedBranchEdges && !isSelected && isBranchDiffVisibleBlock) {
          nextStyle.outline = '1px solid rgba(255, 209, 102, 0.55)'
          nextStyle.outlineOffset = '1px'
        }
        if (selectedNodeId && isSelected) {
          nextStyle.border = '2px solid #ffe79f'
          nextStyle.boxShadow = '0 0 0 2px rgba(255, 231, 159, 0.5), 0 0 14px rgba(255, 231, 159, 0.35)'
        } else if (selectedNodeId && (isIncomingRelated || isOutgoingRelated)) {
          if (isIncomingRelated && !isOutgoingRelated) {
            nextStyle.border = '2px solid #6fdc9a'
          } else if (isOutgoingRelated && !isIncomingRelated) {
            nextStyle.border = '2px solid #f5b04d'
          } else {
            nextStyle.border = '2px solid #ffe79f'
          }
        }
        if (normalizedSearchQuery && isMatch && !isSelected) {
          nextStyle.boxShadow = '0 0 0 2px rgba(255, 231, 159, 0.55)'
        } else if (!isSelected) {
          nextStyle.boxShadow = 'none'
        }
        if (showBaselineDiff && hasBaselineGraphSnapshot && isNewFileNode && !isSelected) {
          nextStyle.border = '2px solid #57e6ff'
          nextStyle.boxShadow = '0 0 0 2px rgba(87, 230, 255, 0.4), 0 0 12px rgba(87, 230, 255, 0.22)'
        }
        if (highlightArchitectureViolations && isArchitectureViolationNode && !isSelected) {
          if (!selectedNodeId) {
            nextStyle.boxShadow = '0 0 0 2px rgba(255, 107, 154, 0.45)'
          }
          nextStyle.outline = '1px solid rgba(255, 107, 154, 0.95)'
          nextStyle.outlineOffset = '1px'
        } else if (!(!highlightOnlyChangedBranchEdges && isBranchDiffViewEnabled && !isFileNode && isBranchDiffVisibleBlock && !isSelected)) {
          nextStyle.outline = 'none'
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
    incomingRelatedNodeIds,
    outgoingRelatedNodeIds,
    normalizedSearchQuery,
    matchingFileNodeIds,
    blockIdsWithMatches,
    architectureViolationNodeIds,
    highlightArchitectureViolations,
    showBaselineDiff,
    showOnlyNewDiff,
    hasBaselineGraphSnapshot,
    newFilePathSet,
    diffRelevantNodeIds,
    branchDiffView,
    gitBranchCompareReport,
    highlightOnlyChangedBranchEdges,
    branchDiffBucketByFileNodeId,
    branchDiffVisibleFileNodeIds,
    branchDiffVisibleBlockIds,
  ])

  const busRouteIndex = useMemo(
    () =>
      computeBusRoutes({
        visibleNodes,
        visibleEdges,
        fileNodeToBlockId,
        routingStyle,
      }),
    [visibleNodes, visibleEdges, fileNodeToBlockId, routingStyle],
  )

  const directRouteContext = useMemo(() => {
    type Rect = { x: number; y: number; width: number; height: number }
    const nodeById = new Map(visibleNodes.map((node) => [node.id, node]))
    const parentByNodeId = new Map<string, string>()
    for (const node of visibleNodes) {
      if (node.parentId) parentByNodeId.set(node.id, node.parentId)
    }
    const rectById = new Map<string, Rect>()
    const computeRect = (nodeId: string): Rect | null => {
      const cached = rectById.get(nodeId)
      if (cached) return cached
      const node = nodeById.get(nodeId)
      if (!node) return null
      const width = Number(node.style?.width ?? 0)
      const height = Number(node.style?.height ?? 0)
      let rect: Rect
      if (!node.parentId) {
        rect = { x: node.position.x, y: node.position.y, width, height }
      } else {
        const parentRect = computeRect(node.parentId)
        if (!parentRect) return null
        rect = { x: parentRect.x + node.position.x, y: parentRect.y + node.position.y, width, height }
      }
      rectById.set(nodeId, rect)
      return rect
    }
    for (const node of visibleNodes) computeRect(node.id)
    // Obstacles: files + collapsed folders that are in the current highlight set
    // (i.e., the selected node and its visible neighbours). Unrelated/dimmed nodes
    // are transparent — wires pass through them freely. Expanded folders are also
    // transparent so the direct router can hop diagonal-ish through containers.
    const baseObstacles: Array<{ id: string; rect: Rect }> = []
    for (const node of visibleNodes) {
      if (!connectedNodeIds.has(node.id)) continue
      const rect = rectById.get(node.id)
      if (!rect) continue
      const isFile = node.id.startsWith('file:')
      const isCollapsedFolder = node.id.startsWith('block:') && collapsedBlockIds.has(node.id)
      if (isFile || isCollapsedFolder) {
        baseObstacles.push({ id: node.id, rect })
      }
    }
    const ancestorIds = (nodeId: string): Set<string> => {
      const set = new Set<string>([nodeId])
      let cur: string | undefined = parentByNodeId.get(nodeId)
      while (cur) {
        set.add(cur)
        cur = parentByNodeId.get(cur)
      }
      return set
    }
    return { rectById, parentByNodeId, baseObstacles, ancestorIds }
  }, [visibleNodes, collapsedBlockIds, connectedNodeIds])

  const renderedNodes = useMemo(() => {
    if (busRouteIndex.pinsByFolderId.size === 0) return visibleNodes
    return visibleNodes.map((node) => {
      if (!node.id.startsWith('block:')) return node
      const pins = busRouteIndex.pinsByFolderId.get(node.id)
      if (!pins) return node
      return {
        ...node,
        data: {
          ...(node.data ?? {}),
          exportPinYs: pins.exports,
          importPinYs: pins.imports,
        },
      }
    })
  }, [visibleNodes, busRouteIndex])

  const displayEdges = useMemo<Edge[]>(() => {
    // Token in the edge id only includes inputs that change geometry / edge type.
    // Selection-driven styling propagates through `data` and `style`, so it must NOT
    // mutate the id — otherwise old edges briefly co-exist with the new ones during
    // remount and leave stale paths behind on the canvas.
    const edgeRenderToken = `${routingStyle}`
    const selectedLogicalEdgeIds = selectedNodeId ? new Set(visibleEdges.map((edge) => edge.id)) : new Set<string>()
    const isBranchOverlayEnabled = branchDiffView !== 'off' && !!gitBranchCompareReport
    const getBranchColor = (bucket: Exclude<BranchDiffView, 'off' | 'all'>) => {
      if (bucket === 'added') {
        return '#38d39f'
      }
      if (bucket === 'deleted') {
        return '#ff7d7d'
      }
      if (bucket === 'renamed') {
        return '#8ac7ff'
      }
      return '#ffd166'
    }

    const preparedEdges: Edge[] = []
    for (const edge of visibleEdges) {
      const isIncoming = selectedNodeId ? edge.target === selectedNodeId : false
      const isOutgoing = selectedNodeId ? edge.source === selectedNodeId : false
      const isConnected = isIncoming || isOutgoing
      const isNewFileEdge =
        edge.source.startsWith('file:') &&
        edge.target.startsWith('file:') &&
        newFileEdgeKeySet.has(
          `${edge.source.slice(5)}->${edge.target.slice(5)}::${String(edge.data?.dependencyKind ?? 'runtime')}`,
        )
      const isNewBlockEdge =
        edge.source.startsWith('block:') &&
        edge.target.startsWith('block:') &&
        newBlockPairSet.has(`${edge.source}->${edge.target}`)
      const isFileViolationEdge =
        edge.source.startsWith('file:') &&
        edge.target.startsWith('file:') &&
        architectureViolationEdgeKeySet.has(`${edge.source.slice(5)}->${edge.target.slice(5)}`)
      const isBlockViolationEdge =
        edge.source.startsWith('block:') &&
        edge.target.startsWith('block:') &&
        (architectureViolationBlockPairCount.get(`${edge.source}->${edge.target}`) ?? 0) > 0
      const isArchitectureViolationEdge = isFileViolationEdge || isBlockViolationEdge
      const isNewDiffEdge = showBaselineDiff && hasBaselineGraphSnapshot && (isNewFileEdge || isNewBlockEdge)
      const fileBranchBucket =
        edge.source.startsWith('file:') && edge.target.startsWith('file:')
          ? mergeBranchDiffBuckets(
              branchDiffBucketByFileNodeId.get(edge.source),
              branchDiffBucketByFileNodeId.get(edge.target),
            )
          : null
      const blockBranchBucket =
        edge.source.startsWith('block:') && edge.target.startsWith('block:')
          ? mergeBranchDiffBuckets(
              branchDiffBucketsByBlockId.get(edge.source),
              branchDiffBucketsByBlockId.get(edge.target),
            )
          : null
      const branchEdgeBucket = fileBranchBucket ?? blockBranchBucket
      const isBranchEdgeMatch = isBranchOverlayEnabled
        ? branchDiffView === 'all'
          ? !!branchEdgeBucket
          : branchEdgeBucket === branchDiffView
        : false
      if (isBranchOverlayEnabled && highlightOnlyChangedBranchEdges && !isBranchEdgeMatch) {
        continue
      }

      const dependencyKind = edge.data?.dependencyKind as DependencyEdge['kind'] | undefined
      const kindColor = dependencyKind === 'type' ? '#b792ff' : dependencyKind === 're-export' ? '#59ccff' : '#7ea3bd'
      let color = isNewDiffEdge ? '#57e6ff' : isArchitectureViolationEdge && highlightArchitectureViolations ? '#ff6b9a' : kindColor
      let strokeWidth = Math.max(Number(edge.style?.strokeWidth ?? 0), 1.4)
      const isCycleColored = String(edge.style?.stroke ?? '').startsWith('#ff')
      let strokeOpacity = 1

      if (selectedNodeId && isConnected) {
        if (isBranchEdgeMatch && branchEdgeBucket) {
          color = getBranchColor(branchEdgeBucket)
        } else if (isNewDiffEdge) {
          color = '#57e6ff'
        } else if (isArchitectureViolationEdge && highlightArchitectureViolations) {
          color = '#ff6b9a'
        } else if (edgeColorPriority === 'direction') {
          if (isOutgoing && !isIncoming) {
            color = '#f5b04d'
          } else if (isIncoming && !isOutgoing) {
            color = '#6fdc9a'
          } else {
            color = '#ffe79f'
          }
        } else {
          color = kindColor
        }
        strokeWidth = Math.max(
          strokeWidth,
          isBranchEdgeMatch ? 2.8 : isNewDiffEdge ? 2.8 : isArchitectureViolationEdge && highlightArchitectureViolations ? 2.8 : 2,
        )
      } else if (isCycleColored) {
        color = String(edge.style?.stroke)
      } else if (isBranchEdgeMatch && branchEdgeBucket) {
        color = getBranchColor(branchEdgeBucket)
      } else {
        color = isNewDiffEdge ? '#57e6ff' : isArchitectureViolationEdge && highlightArchitectureViolations ? '#ff6b9a' : kindColor
      }

      if (isArchitectureViolationEdge && highlightArchitectureViolations) {
        strokeWidth = Math.max(strokeWidth, 2.4)
      }
      if (isNewDiffEdge) {
        strokeWidth = Math.max(strokeWidth, 2.6)
      }
      if (isBranchEdgeMatch) {
        strokeWidth = Math.max(strokeWidth, 2.6)
      } else if (showBaselineDiff && hasBaselineGraphSnapshot) {
        strokeOpacity = 0.22
      }
      if (isBranchOverlayEnabled && !isBranchEdgeMatch) {
        strokeOpacity = Math.min(strokeOpacity, 0.18)
      }

      const isTracedEdge = !!(edge.data as { tracedToCollapsed?: boolean } | undefined)?.tracedToCollapsed
      const baseEdge: Edge = {
        ...edge,
        id: `${edge.id}::${edgeRenderToken}`,
        type: routingStyle === 'bus' ? 'bus' : 'classicLine',
        style: {
          ...(edge.style ?? {}),
          stroke: color,
          strokeWidth: isTracedEdge ? Math.max(strokeWidth, 1.6) : strokeWidth,
          strokeDasharray: isTracedEdge ? '5 4' : undefined,
          opacity: strokeOpacity,
        },
        markerEnd:
          edge.markerEnd && typeof edge.markerEnd === 'object'
            ? { ...edge.markerEnd, color }
            : { type: 'arrowclosed' as const, color },
      }

      // Direct orthogonal routing kicks in for highlighted edges (when simplify is on)
      // and ALWAYS for traced edges (the bus router can't terminate on a folder block).
      const useDirectRouting =
        isTracedEdge || (simplifyHighlightedRoutes && isConnected && selectedNodeId !== null)
      if (useDirectRouting) {
        const sourceRect = directRouteContext.rectById.get(edge.source)
        const targetRect = directRouteContext.rectById.get(edge.target)
        if (sourceRect && targetRect) {
          const sourcePoint = {
            x: sourceRect.x + sourceRect.width,
            y: sourceRect.y + sourceRect.height / 2,
          }
          const targetPoint = { x: targetRect.x, y: targetRect.y + targetRect.height / 2 }
          const exclude = new Set<string>([
            ...directRouteContext.ancestorIds(edge.source),
            ...directRouteContext.ancestorIds(edge.target),
          ])
          const obstacles = directRouteContext.baseObstacles
            .filter((entry) => !exclude.has(entry.id))
            .map((entry) => entry.rect)
          const points = routeDirectOrthogonal(sourcePoint, targetPoint, obstacles)
          preparedEdges.push({
            ...baseEdge,
            type: 'bus',
            data: {
              ...(baseEdge.data ?? {}),
              logicalEdgeId: edge.id,
              logicalEdgeIds: [edge.id],
              segmentIds: [],
              points,
              busLane: 0,
              busCount: 1,
              isPairPrimary: true,
              pairKey: `direct:${edge.id}`,
              pairCount: 1,
              highlightedSegmentIds: [],
            },
          })
          continue
        }
        // Rect lookup failed (shouldn't happen) — fall back to bus or base edge below.
      }

      const bus = busRouteIndex.routesByEdgeId.get(edge.id) ?? null
      if (!bus) {
        preparedEdges.push(baseEdge)
        continue
      }

      preparedEdges.push({
        ...baseEdge,
        data: {
          ...(baseEdge.data ?? {}),
          logicalEdgeId: edge.id,
          logicalEdgeIds: bus.logicalEdgeIds,
          segmentIds: bus.segmentIds,
          points: bus.points,
          busLane: bus.lane,
          busCount: bus.laneCount,
          isPairPrimary: bus.isPairPrimary,
          pairKey: bus.pairKey,
          pairCount: bus.pairCount,
          highlightedSegmentIds: [],
        },
      })
    }

    if (!selectedNodeId || routingStyle !== 'bus') {
      return preparedEdges
    }

    return preparedEdges.map((edge) => {
      const segmentIds = Array.isArray(edge.data?.segmentIds) ? (edge.data.segmentIds as string[]) : []
      const highlightedSegmentIds = segmentIds.filter((segmentId) => {
        const logicalIds = busRouteIndex.segmentLogicalIds.get(segmentId)
        if (!logicalIds) {
          return false
        }
        for (const logicalId of logicalIds) {
          if (selectedLogicalEdgeIds.has(logicalId)) {
            return true
          }
        }
        return false
      })
      return {
        ...edge,
        data: {
          ...(edge.data ?? {}),
          highlightedSegmentIds,
        },
      }
    })
  }, [
    visibleEdges,
    busRouteIndex,
    directRouteContext,
    routingStyle,
    selectedNodeId,
    directionFilter,
    edgeColorPriority,
    simplifyHighlightedRoutes,
    architectureViolationEdgeKeySet,
    architectureViolationBlockPairCount,
    highlightArchitectureViolations,
    showBaselineDiff,
    showOnlyNewDiff,
    hasBaselineGraphSnapshot,
    newFileEdgeKeySet,
    newBlockPairSet,
    branchDiffView,
    gitBranchCompareReport,
    highlightOnlyChangedBranchEdges,
    branchDiffBucketByFileNodeId,
    branchDiffBucketsByBlockId,
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
        const nextNodes = await applyElkToBlockNodes(
          flowGraph.nodes,
          flowGraph.blockLayoutEdges,
          graphMode === 'file-level' ? 'compact' : 'dependency',
        )
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
    setRoutingStyle('classic')
    setCollapsedBlockIds(new Set())
    setAutoFolderDepth(true)
    setFolderControlMode('preset')
    setEdgeKindFilter('all')
    setEdgeColorPriority('direction')
    setShowBaselineDiff(false)
    setShowOnlyNewDiff(false)
    setBranchDiffView('off')
    setHighlightOnlyChangedBranchEdges(false)
    setSearchQuery('')
    setHoveredFilePath(null)
    setIsCanvasLocked(false)
    setSavedViewport(null)
    setActiveTab('overview')
  }, [scanResult?.rootName])

  useEffect(() => {
    setSelectedNodeId(null)
    setDirectionFilter('all')
  }, [routingStyle, folderPacking])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }
    try {
      const raw = window.localStorage.getItem(ARCHITECTURE_STORAGE_KEY)
      if (!raw) {
        return
      }
      const parsed = JSON.parse(raw) as unknown
      const normalized = normalizeArchitectureConfig(parsed)
      if (!normalized) {
        return
      }
      setArchitectureConfig(normalized)
      setArchitectureConfigDraft(JSON.stringify(normalized, null, 2))
      setArchitectureConfigError(null)
    } catch {
      setArchitectureConfigError('Failed to load architecture config preset from localStorage.')
    }
  }, [])

  async function readProjectReadme(directoryHandle: FileSystemDirectoryHandle) {
    const candidateNames = ['README.md', 'Readme.md', 'readme.md', 'README.MD']
    for (const name of candidateNames) {
      try {
        const fileHandle = await directoryHandle.getFileHandle(name)
        const file = await fileHandle.getFile()
        return {
          name,
          content: await file.text(),
        }
      } catch {
        // Continue search
      }
    }
    return {
      name: null,
      content: null,
    }
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
      const directoryHandle = await window.showDirectoryPicker({
        mode: 'read',
      })
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

  const hoveredFileAnalysis = hoveredFilePath ? fileAnalysisByPath.get(hoveredFilePath) ?? null : null
  const hoverInfoLine = hoveredFileAnalysis
    ? `${hoveredFilePath ?? '-'} | Exports: ${
        hoveredFileAnalysis.exports.length > 0 ? hoveredFileAnalysis.exports.join(', ') : 'none'
      }`
    : (hoveredFilePath ?? '-')
  const selectedInfoLine = selectedNodeId ?? '-'
  const selectedFilePath = useMemo(() => {
    if (!selectedNodeId) return null
    if (selectedNodeId.startsWith('file:')) return selectedNodeId.slice('file:'.length)
    return null
  }, [selectedNodeId])
  const selectedImportedFiles = useMemo(() => {
    if (!selectedFilePath || !dependencyGraph) return [] as string[]
    const set = new Set<string>()
    for (const edge of dependencyGraph.edges) {
      if (edge.fromPath === selectedFilePath) set.add(edge.toPath)
    }
    if (showExternalImports) {
      for (const edge of dependencyGraph.externalEdges) {
        if (edge.fromPath === selectedFilePath) set.add(edge.toPath)
      }
    }
    return Array.from(set).sort()
  }, [selectedFilePath, dependencyGraph, showExternalImports])
  const selectedImportedByFiles = useMemo(() => {
    if (!selectedFilePath || !dependencyGraph) return [] as string[]
    const set = new Set<string>()
    for (const edge of dependencyGraph.edges) {
      if (edge.toPath === selectedFilePath) set.add(edge.fromPath)
    }
    if (showExternalImports) {
      for (const edge of dependencyGraph.externalEdges) {
        if (edge.toPath === selectedFilePath) set.add(edge.fromPath)
      }
    }
    return Array.from(set).sort()
  }, [selectedFilePath, dependencyGraph, showExternalImports])

  function toggleSelectedBlockCollapse() {
    if (!selectedBlockId || graphMode !== 'file-level') {
      return
    }
    setAutoFolderDepth(false)
    setFolderControlMode('manual')
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

  function getFolderDepth(blockId: string) {
    if (!blockId.startsWith('block:')) {
      return 0
    }
    const relative = blockId.slice('block:'.length)
    if (!relative || relative === '(root)') {
      return 0
    }
    return relative.split('/').length
  }

  function applyFolderDepthPreset(maxDepth: ManualFolderDepth) {
    if (!flowGraph || graphMode !== 'file-level') {
      return
    }
    if (maxDepth === 'any') {
      setCollapsedBlockIds(new Set())
      setSelectedNodeId(null)
      setDirectionFilter('all')
      return
    }
    const nextCollapsed = new Set<string>()
    for (const node of flowGraph.nodes) {
      if (!node.id.startsWith('block:')) {
        continue
      }
      if (getFolderDepth(node.id) > maxDepth) {
        nextCollapsed.add(node.id)
      }
    }
    setCollapsedBlockIds(nextCollapsed)
    setSelectedNodeId(null)
    setDirectionFilter('all')
  }

  function estimateVisibleNodeCountAtDepth(maxDepth: number) {
    if (!flowGraph) {
      return 0
    }

    const parentById = new Map<string, string>()
    const collapsed = new Set<string>()
    for (const node of flowGraph.nodes) {
      if (node.parentId) {
        parentById.set(node.id, node.parentId)
      }
      if (node.id.startsWith('block:') && getFolderDepth(node.id) > maxDepth) {
        collapsed.add(node.id)
      }
    }

    let visibleCount = 0
    for (const node of flowGraph.nodes) {
      let parentId = node.parentId
      let hidden = false
      while (parentId) {
        if (collapsed.has(parentId)) {
          hidden = true
          break
        }
        parentId = parentById.get(parentId)
      }
      if (!hidden) {
        visibleCount += 1
      }
    }
    return visibleCount
  }

  function applyAutoFolderDepth() {
    if (!flowGraph || graphMode !== 'file-level') {
      return
    }

    const folderDepths = flowGraph.nodes
      .filter((node) => node.id.startsWith('block:'))
      .map((node) => getFolderDepth(node.id))
    const maxFolderDepth = Math.max(1, ...folderDepths)
    const maxCandidateDepth = Math.min(maxFolderDepth, 8)
    const targetVisibleNodes = 140

    let chosenDepth = 1
    for (let depth = 1; depth <= maxCandidateDepth; depth += 1) {
      const visibleCount = estimateVisibleNodeCountAtDepth(depth)
      if (visibleCount <= targetVisibleNodes) {
        chosenDepth = depth
      } else {
        break
      }
    }

    applyFolderDepthPreset(chosenDepth)
  }

  function applyArchitectureConfigDraft() {
    try {
      const parsed = JSON.parse(architectureConfigDraft) as unknown
      const normalized = normalizeArchitectureConfig(parsed)
      if (!normalized) {
        setArchitectureConfigError('Invalid config shape. Check layer names and allowed targets.')
        return
      }
      applyArchitectureConfig(normalized)
    } catch {
      setArchitectureConfigError('Invalid JSON format for architecture config.')
    }
  }

  function applyArchitectureConfig(nextConfig: ArchitectureConfig) {
    setArchitectureConfig(nextConfig)
    setArchitectureConfigDraft(JSON.stringify(nextConfig, null, 2))
    setArchitectureConfigError(null)
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(ARCHITECTURE_STORAGE_KEY, JSON.stringify(nextConfig))
    }
  }

  function updateArchitectureAllowedTarget(
    fromLayer: ArchitectureLayerId,
    toLayer: ArchitectureLayerId,
    isAllowed: boolean,
  ) {
    const existing = architectureConfig.allowedTargets[fromLayer]
    const nextTargets = isAllowed
      ? [...new Set([...existing, toLayer])]
      : existing.filter((item) => item !== toLayer)
    if (nextTargets.length === 0) {
      setArchitectureConfigError(`Layer "${fromLayer}" must allow at least one target layer.`)
      return
    }
    applyArchitectureConfig({
      ...architectureConfig,
      allowedTargets: {
        ...architectureConfig.allowedTargets,
        [fromLayer]: nextTargets,
      },
    })
  }

  function updateArchitectureMatchers(layer: ArchitectureLayerId, csvValue: string) {
    const nextMatchers = csvValue
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean)
    applyArchitectureConfig({
      ...architectureConfig,
      layerMatchers: {
        ...architectureConfig.layerMatchers,
        [layer]: [...new Set(nextMatchers)],
      },
    })
  }

  function resetArchitectureConfig() {
    applyArchitectureConfig(DEFAULT_ARCHITECTURE_CONFIG)
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(ARCHITECTURE_STORAGE_KEY)
    }
  }

  const collapsibleBlockIds = useMemo(() => {
    const ids = new Set<string>()
    for (const node of flowGraph?.nodes ?? []) {
      if (!node.id.startsWith('block:')) {
        continue
      }
      if (getFolderDepth(node.id) > 0) {
        ids.add(node.id)
      }
    }
    return ids
  }, [flowGraph])

  const areAllFoldersCollapsed = useMemo(() => {
    if (collapsibleBlockIds.size === 0) {
      return false
    }
    for (const blockId of collapsibleBlockIds) {
      if (!collapsedBlockIds.has(blockId)) {
        return false
      }
    }
    return true
  }, [collapsibleBlockIds, collapsedBlockIds])

  function toggleAllFoldersCollapse() {
    if (graphMode !== 'file-level' || collapsibleBlockIds.size === 0) {
      return
    }
    setAutoFolderDepth(false)
    setFolderControlMode('manual')
    if (areAllFoldersCollapsed) {
      setCollapsedBlockIds(new Set())
    } else {
      setCollapsedBlockIds(new Set(collapsibleBlockIds))
    }
  }

  function focusFileOnBoard(filePath: string) {
    setGraphMode('file-level')
    setSelectedNodeId(`file:${filePath}`)
    setDirectionFilter('all')
    setActiveTab('board')
  }

  function focusViolationOnBoard(violation: ArchitectureViolation) {
    setGraphMode('file-level')
    setSelectedNodeId(`file:${violation.fromPath}`)
    setDirectionFilter('outgoing')
    setEdgeKindFilter(violation.kind)
    setActiveTab('board')
  }

  function exportAnalysisReportJson() {
    const projectName = scanResult?.rootName ?? 'project'
    const fileName = `analysis-report-${projectName}.json`
    downloadTextFile(fileName, JSON.stringify(analysisReport, null, 2), 'application/json;charset=utf-8')
  }

  function exportAnalysisReportMarkdown() {
    const projectName = scanResult?.rootName ?? 'project'
    const fileName = `analysis-report-${projectName}.md`
    downloadTextFile(fileName, buildMarkdownReport(analysisReport), 'text/markdown;charset=utf-8')
  }

  function exportArchitectureReportJson() {
    const projectName = scanResult?.rootName ?? 'project'
    const fileName = `architecture-report-${projectName}.json`
    downloadTextFile(fileName, JSON.stringify(architectureReport, null, 2), 'application/json;charset=utf-8')
  }

  function exportArchitectureReportMarkdown() {
    const projectName = scanResult?.rootName ?? 'project'
    const fileName = `architecture-report-${projectName}.md`
    downloadTextFile(fileName, buildArchitectureMarkdownReport(architectureReport), 'text/markdown;charset=utf-8')
  }

  function buildGitLiveUrl(path: string, params: Record<string, string>) {
    const normalizedBase = gitLiveApiBase.trim().replace(/\/+$/, '')
    const url = new URL(`${normalizedBase}${path}`)
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value)
    }
    return url.toString()
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

  async function fetchGitLiveCommitsFor(side: 'base' | 'target', ref: string) {
    if (!gitLiveRepoPath.trim()) {
      return
    }
    const response = await fetch(buildGitLiveUrl('/api/git/log', { repo: gitLiveRepoPath.trim(), ref, limit: '60' }))
    const parsed = (await response.json()) as unknown
    if (!response.ok) {
      throw new Error((parsed as { error?: string })?.error ?? `Git live log error (${response.status}).`)
    }
    if (!isGitLiveLogResponseCandidate(parsed)) {
      throw new Error('Invalid log response from git live server.')
    }
    if (side === 'base') {
      setGitLiveBaseCommits(parsed.commits)
    } else {
      setGitLiveTargetCommits(parsed.commits)
    }
  }

  async function refreshGitLiveCommits(side: 'base' | 'target') {
    const ref = side === 'base' ? gitLiveBaseRef : gitLiveTargetRef
    setIsGitLiveLoading(true)
    setGitLiveError(null)
    try {
      await fetchGitLiveCommitsFor(side, ref)
      if (side === 'base') {
        setGitLiveBaseCommitOverride('')
      } else {
        setGitLiveTargetCommitOverride('')
      }
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
    if (!file) {
      return
    }
    try {
      const raw = await file.text()
      const parsed = JSON.parse(raw) as unknown
      if (!isAnalysisExportReportCandidate(parsed)) {
        setBaselineReportError('Selected file is not a valid analysis report JSON.')
        setBaselineReport(null)
        setBaselineReportName(null)
        return
      }
      setBaselineReport(parsed)
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
    if (!file) {
      return
    }
    try {
      const raw = await file.text()
      const parsed = JSON.parse(raw) as unknown
      if (!isGitChurnReportCandidate(parsed)) {
        setGitChurnReportError('Selected file is not a valid git churn report JSON.')
        setGitChurnReport(null)
        setGitChurnReportName(null)
        return
      }
      setGitChurnReport(parsed)
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
    if (!file) {
      return
    }
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
      setGitBranchCompareReport(parsed)
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

  useEffect(() => {
    if (!flowGraph || graphMode !== 'file-level') {
      return
    }
    if (folderControlMode === 'manual') {
      return
    }
    if (autoFolderDepth) {
      applyAutoFolderDepth()
      return
    }
    applyFolderDepthPreset(manualFolderDepth)
  }, [flowGraph, graphMode, autoFolderDepth, manualFolderDepth, folderControlMode])

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
    <main className="app-shell">
      <TabNav activeTab={activeTab} setActiveTab={setActiveTab} />

      {activeTab === 'overview' && (
        <Overview
          scanResult={scanResult}
          dependencyGraph={dependencyGraph}
          flowGraph={flowGraph}
          matchingFileNodeIds={matchingFileNodeIds}
          isBusy={isBusy}
          errorMessage={errorMessage}
          pickButtonLabel={pickButtonLabel}
          handlePickDirectory={handlePickDirectory}
          overviewStructureMode={overviewStructureMode}
          setOverviewStructureMode={setOverviewStructureMode}
          overviewTreemapMetric={overviewTreemapMetric}
          setOverviewTreemapMetric={setOverviewTreemapMetric}
          fileLocByPath={fileLocByPath}
          treeLines={treeLines}
        />
      )}

      {activeTab === 'about' && (
        <About
          scanResult={scanResult}
          projectReadmeName={projectReadmeName}
          projectReadmeContent={projectReadmeContent}
        />
      )}

      {activeTab === 'dependencies' && (
        <Dependencies topConnectedFiles={topConnectedFiles} previewEdges={previewEdges} />
      )}

      {activeTab === 'diagnostics' && (
        <Diagnostics
          dependencyGraph={dependencyGraph}
          isLayouting={isLayouting}
          scanResult={scanResult}
          exportAnalysisReportJson={exportAnalysisReportJson}
          exportAnalysisReportMarkdown={exportAnalysisReportMarkdown}
          importBaselineReport={importBaselineReport}
          baselineReport={baselineReport}
          setBaselineReport={setBaselineReport}
          baselineReportName={baselineReportName}
          setBaselineReportName={setBaselineReportName}
          baselineReportError={baselineReportError}
          setBaselineReportError={setBaselineReportError}
          baselineDelta={baselineDelta}
          importGitChurnReport={importGitChurnReport}
          gitChurnReport={gitChurnReport}
          setGitChurnReport={setGitChurnReport}
          gitChurnReportName={gitChurnReportName}
          setGitChurnReportName={setGitChurnReportName}
          gitChurnReportError={gitChurnReportError}
          setGitChurnReportError={setGitChurnReportError}
          churnHotFiles={churnHotFiles}
          gitLiveApiBase={gitLiveApiBase}
          setGitLiveApiBase={setGitLiveApiBase}
          gitLiveRepoPath={gitLiveRepoPath}
          setGitLiveRepoPath={setGitLiveRepoPath}
          fetchGitLiveRefs={fetchGitLiveRefs}
          runGitLiveCompare={runGitLiveCompare}
          isGitLiveLoading={isGitLiveLoading}
          gitLiveRefs={gitLiveRefs}
          gitLiveBaseRef={gitLiveBaseRef}
          setGitLiveBaseRef={setGitLiveBaseRef}
          gitLiveTargetRef={gitLiveTargetRef}
          setGitLiveTargetRef={setGitLiveTargetRef}
          refreshGitLiveCommits={refreshGitLiveCommits}
          gitLiveBaseCommitOverride={gitLiveBaseCommitOverride}
          setGitLiveBaseCommitOverride={setGitLiveBaseCommitOverride}
          gitLiveTargetCommitOverride={gitLiveTargetCommitOverride}
          setGitLiveTargetCommitOverride={setGitLiveTargetCommitOverride}
          gitLiveBaseCommits={gitLiveBaseCommits}
          gitLiveTargetCommits={gitLiveTargetCommits}
          gitLiveError={gitLiveError}
          importGitBranchCompareReport={importGitBranchCompareReport}
          gitBranchCompareReport={gitBranchCompareReport}
          setGitBranchCompareReport={setGitBranchCompareReport}
          gitBranchCompareReportName={gitBranchCompareReportName}
          setGitBranchCompareReportName={setGitBranchCompareReportName}
          gitBranchCompareReportError={gitBranchCompareReportError}
          setGitBranchCompareReportError={setGitBranchCompareReportError}
          setBranchDiffView={setBranchDiffView}
          setHighlightOnlyChangedBranchEdges={setHighlightOnlyChangedBranchEdges}
          branchCompareHotFiles={branchCompareHotFiles}
          hotspotFiles={hotspotFiles}
          potentiallyDeadExportFiles={potentiallyDeadExportFiles}
          topCycleGroups={topCycleGroups}
          dependencyEdgeKindCounts={dependencyEdgeKindCounts}
          riskByFile={riskByFile}
          riskByBlock={riskByBlock}
          orphanRuntimeModules={orphanRuntimeModules}
          reexportHubFiles={reexportHubFiles}
          duplicateUtilityGroups={duplicateUtilityGroups}
          reexportBottleneckFiles={reexportBottleneckFiles}
          reexportChains={reexportChains}
          architectureRuleLines={architectureRuleLines}
          architectureViolations={architectureViolations}
          architectureViolationByKind={architectureViolationByKind}
          architectureLayerDistribution={architectureLayerDistribution}
          architectureViolationByPair={architectureViolationByPair}
          architectureConfig={architectureConfig}
          selectedNodeId={selectedNodeId}
          hoveredFilePath={hoveredFilePath}
          hoveredFileAnalysis={hoveredFileAnalysis}
          focusFileOnBoard={focusFileOnBoard}
        />
      )}

      {activeTab === 'architecture' && (
        <Architecture
          architectureRuleLines={architectureRuleLines}
          architectureViolations={architectureViolations}
          architectureViolationByKind={architectureViolationByKind}
          architectureLayerDistribution={architectureLayerDistribution}
          architectureViolationByPair={architectureViolationByPair}
          architectureConfig={architectureConfig}
          architectureConfigMode={architectureConfigMode}
          setArchitectureConfigMode={setArchitectureConfigMode}
          architectureConfigDraft={architectureConfigDraft}
          setArchitectureConfigDraft={setArchitectureConfigDraft}
          architectureConfigError={architectureConfigError}
          applyArchitectureConfigDraft={applyArchitectureConfigDraft}
          resetArchitectureConfig={resetArchitectureConfig}
          updateArchitectureMatchers={updateArchitectureMatchers}
          updateArchitectureAllowedTarget={updateArchitectureAllowedTarget}
          exportArchitectureReportJson={exportArchitectureReportJson}
          exportArchitectureReportMarkdown={exportArchitectureReportMarkdown}
          focusViolationOnBoard={focusViolationOnBoard}
          scanResult={scanResult}
          dependencyGraph={dependencyGraph}
        />
      )}

      {activeTab === 'board' && (
        <Board
          graphMode={graphMode}
          setGraphMode={setGraphMode}
          showExternalImports={showExternalImports}
          setShowExternalImports={setShowExternalImports}
          simplifyHighlightedRoutes={simplifyHighlightedRoutes}
          setSimplifyHighlightedRoutes={setSimplifyHighlightedRoutes}
          traceIntoCollapsedFolders={traceIntoCollapsedFolders}
          setTraceIntoCollapsedFolders={setTraceIntoCollapsedFolders}
          highlightCycles={highlightCycles}
          setHighlightCycles={setHighlightCycles}
          highlightArchitectureViolations={highlightArchitectureViolations}
          setHighlightArchitectureViolations={setHighlightArchitectureViolations}
          showBaselineDiff={showBaselineDiff}
          setShowBaselineDiff={setShowBaselineDiff}
          showOnlyNewDiff={showOnlyNewDiff}
          setShowOnlyNewDiff={setShowOnlyNewDiff}
          hasBaselineGraphSnapshot={hasBaselineGraphSnapshot}
          branchDiffView={branchDiffView}
          setBranchDiffView={setBranchDiffView}
          highlightOnlyChangedBranchEdges={highlightOnlyChangedBranchEdges}
          setHighlightOnlyChangedBranchEdges={setHighlightOnlyChangedBranchEdges}
          gitBranchCompareReport={gitBranchCompareReport}
          branchDiffVisibleFileNodeIds={branchDiffVisibleFileNodeIds}
          selectedNodeId={selectedNodeId}
          setSelectedNodeId={setSelectedNodeId}
          directionFilter={directionFilter}
          setDirectionFilter={setDirectionFilter}
          edgeKindFilter={edgeKindFilter}
          setEdgeKindFilter={setEdgeKindFilter}
          edgeColorPriority={edgeColorPriority}
          setEdgeColorPriority={setEdgeColorPriority}
          routingStyle={routingStyle}
          setRoutingStyle={setRoutingStyle}
          folderPacking={folderPacking}
          setFolderPacking={setFolderPacking}
          autoFolderDepth={autoFolderDepth}
          setAutoFolderDepth={setAutoFolderDepth}
          setFolderControlMode={setFolderControlMode}
          manualFolderDepth={manualFolderDepth}
          setManualFolderDepth={setManualFolderDepth}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          selectedBlockId={selectedBlockId}
          collapsedBlockIds={collapsedBlockIds}
          collapsibleBlockIds={collapsibleBlockIds}
          areAllFoldersCollapsed={areAllFoldersCollapsed}
          toggleSelectedBlockCollapse={toggleSelectedBlockCollapse}
          toggleAllFoldersCollapse={toggleAllFoldersCollapse}
          flowGraph={flowGraph}
          displayEdges={displayEdges}
          renderedNodes={renderedNodes}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          matchingFileNodeIds={matchingFileNodeIds}
          isLayouting={isLayouting}
          architectureViolations={architectureViolations}
          canvasShellRef={canvasShellRef}
          toggleCanvasFullscreen={toggleCanvasFullscreen}
          isCanvasFullscreen={isCanvasFullscreen}
          onNodeClick={onNodeClick}
          onNodeMouseEnter={onNodeMouseEnter}
          onNodeMouseLeave={onNodeMouseLeave}
          isCanvasLocked={isCanvasLocked}
          setIsCanvasLocked={setIsCanvasLocked}
          savedViewport={savedViewport}
          setSavedViewport={setSavedViewport}
          selectedInfoLine={selectedInfoLine}
          hoverInfoLine={hoverInfoLine}
          selectedFilePath={selectedFilePath}
          selectedImportedFiles={selectedImportedFiles}
          selectedImportedByFiles={selectedImportedByFiles}
        />
      )}
    </main>
  )
}

export default App
