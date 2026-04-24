import { useEffect, useMemo, useState, type ChangeEvent } from 'react'
import { Background, MiniMap, ReactFlow, type Edge, type NodeMouseHandler } from '@xyflow/react'
import { BusEdge } from './components/BusEdge'
import { ClassicEdge } from './components/ClassicEdge'
import { CanvasNavWheel } from './components/CanvasNavWheel'
import { ChipFileNode } from './components/ChipFileNode'
import { FolderBlockNode } from './components/FolderBlockNode'
import {
  ProjectStructureViz,
  type StructureViewMode,
  type TreemapMetricMode,
} from './components/ProjectStructureViz'
import { analyzeProjectDependenciesInWorker } from './lib/analyzer-worker-client'
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

type AppTab = 'overview' | 'board' | 'dependencies' | 'diagnostics' | 'architecture' | 'about'
type BusDisplayMode = 'detailed' | 'trunk-only'
type FolderControlMode = 'preset' | 'manual'
type ManualFolderDepth = 'any' | number
type EdgeKindFilter = 'all' | DependencyEdge['kind']
type EdgeColorPriority = 'direction' | 'kind'
type CycleGroup = {
  id: number
  size: number
  filePaths: string[]
}
type ArchitectureLayerId = 'ui' | 'domain' | 'infra' | 'shared' | 'tests' | 'unknown'
type ArchitectureConfigMode = 'visual' | 'json'
type ArchitectureViolation = {
  fromPath: string
  toPath: string
  fromLayer: ArchitectureLayerId
  toLayer: ArchitectureLayerId
  kind: DependencyEdge['kind']
}
type AnalysisExportReport = {
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
type ArchitectureExportReport = {
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
type ArchitectureConfig = {
  layerMatchers: Record<ArchitectureLayerId, string[]>
  allowedTargets: Record<ArchitectureLayerId, ArchitectureLayerId[]>
}

const ARCHITECTURE_LAYER_ORDER: ArchitectureLayerId[] = ['tests', 'ui', 'domain', 'infra', 'shared']
const ARCHITECTURE_RULE_LAYERS: ArchitectureLayerId[] = ['ui', 'domain', 'infra', 'shared', 'tests', 'unknown']
const ARCHITECTURE_MATCHER_LAYERS: ArchitectureLayerId[] = ['tests', 'ui', 'domain', 'infra', 'shared']
const ARCHITECTURE_STORAGE_KEY = 'schematic-code-visualizer.architecture-config.v1'
const DEFAULT_ARCHITECTURE_CONFIG: ArchitectureConfig = {
  layerMatchers: {
    tests: ['/__tests__/', '.test.', '.spec.'],
    ui: ['/components/', '/screens/', '/pages/', '/ui/'],
    domain: ['/domain/', '/entities/', '/models/', '/features/', '/core/', '/services/'],
    infra: [
      '/infra/',
      '/infrastructure/',
      '/api/',
      '/gateway/',
      '/gateways/',
      '/repository/',
      '/repositories/',
      '/store/',
      '/data/',
      '/persistence/',
      '/db/',
    ],
    shared: ['/shared/', '/common/', '/utils/', '/helpers/', '/lib/', '/hooks/', '/types/'],
    unknown: [],
  },
  allowedTargets: {
    ui: ['ui', 'domain', 'shared', 'unknown'],
    domain: ['domain', 'shared', 'unknown'],
    infra: ['infra', 'domain', 'shared', 'unknown'],
    shared: ['shared', 'unknown'],
    tests: ['ui', 'domain', 'infra', 'shared', 'tests', 'unknown'],
    unknown: ['ui', 'domain', 'infra', 'shared', 'tests', 'unknown'],
  },
}

function architectureConfigDescription(config: ArchitectureConfig) {
  return ARCHITECTURE_RULE_LAYERS.map((layer) => `${layer} -> ${config.allowedTargets[layer].join('/')}`).join('; ')
}

function normalizeArchitectureConfig(input: unknown): ArchitectureConfig | null {
  if (!input || typeof input !== 'object') {
    return null
  }
  const candidate = input as Partial<ArchitectureConfig>
  const validLayers: ArchitectureLayerId[] = ['ui', 'domain', 'infra', 'shared', 'tests', 'unknown']

  const layerMatchers = {} as Record<ArchitectureLayerId, string[]>
  const allowedTargets = {} as Record<ArchitectureLayerId, ArchitectureLayerId[]>

  for (const layer of validLayers) {
    const rawMatchers = candidate.layerMatchers?.[layer]
    const nextMatchers = Array.isArray(rawMatchers)
      ? rawMatchers.filter((item): item is string => typeof item === 'string').map((item) => item.toLowerCase().trim()).filter(Boolean)
      : DEFAULT_ARCHITECTURE_CONFIG.layerMatchers[layer]
    layerMatchers[layer] = [...new Set(nextMatchers)]

    const rawAllowed = candidate.allowedTargets?.[layer]
    const nextAllowed = Array.isArray(rawAllowed)
      ? rawAllowed
          .filter((item): item is ArchitectureLayerId => typeof item === 'string' && validLayers.includes(item as ArchitectureLayerId))
      : DEFAULT_ARCHITECTURE_CONFIG.allowedTargets[layer]
    if (nextAllowed.length === 0) {
      return null
    }
    allowedTargets[layer] = [...new Set(nextAllowed)]
  }

  return {
    layerMatchers,
    allowedTargets,
  }
}

function getTopLevelBlockLabelForPath(filePath: string, rootName: string | null | undefined) {
  if (!rootName) {
    return '(root)'
  }
  const prefix = `${rootName}/`
  const relativePath = filePath.startsWith(prefix) ? filePath.slice(prefix.length) : filePath
  const [firstSegment] = relativePath.split('/')
  return firstSegment || '(root)'
}

function detectArchitectureLayer(filePath: string, config: ArchitectureConfig): ArchitectureLayerId {
  const path = filePath.toLowerCase()
  for (const layer of ARCHITECTURE_LAYER_ORDER) {
    const patterns = config.layerMatchers[layer]
    for (const pattern of patterns) {
      if (path.includes(pattern)) {
        return layer
      }
    }
  }
  return 'unknown'
}

function isArchitectureEdgeAllowed(fromLayer: ArchitectureLayerId, toLayer: ArchitectureLayerId, config: ArchitectureConfig) {
  return new Set(config.allowedTargets[fromLayer]).has(toLayer)
}

function findTopCycleGroups(filePaths: string[], edges: Array<{ fromPath: string; toPath: string }>, limit = 5): CycleGroup[] {
  const pathSet = new Set(filePaths)
  const adjacency = new Map<string, string[]>()
  const selfLoops = new Set<string>()

  for (const path of filePaths) {
    adjacency.set(path, [])
  }

  for (const edge of edges) {
    if (!pathSet.has(edge.fromPath) || !pathSet.has(edge.toPath)) {
      continue
    }
    adjacency.get(edge.fromPath)?.push(edge.toPath)
    if (edge.fromPath === edge.toPath) {
      selfLoops.add(edge.fromPath)
    }
  }

  let index = 0
  const stack: string[] = []
  const inStack = new Set<string>()
  const indexByNode = new Map<string, number>()
  const lowlinkByNode = new Map<string, number>()
  const groups: CycleGroup[] = []

  const strongConnect = (node: string) => {
    indexByNode.set(node, index)
    lowlinkByNode.set(node, index)
    index += 1
    stack.push(node)
    inStack.add(node)

    for (const next of adjacency.get(node) ?? []) {
      if (!indexByNode.has(next)) {
        strongConnect(next)
        lowlinkByNode.set(node, Math.min(lowlinkByNode.get(node) ?? 0, lowlinkByNode.get(next) ?? 0))
      } else if (inStack.has(next)) {
        lowlinkByNode.set(node, Math.min(lowlinkByNode.get(node) ?? 0, indexByNode.get(next) ?? 0))
      }
    }

    if ((lowlinkByNode.get(node) ?? -1) === (indexByNode.get(node) ?? -2)) {
      const component: string[] = []
      let popped: string | undefined
      do {
        popped = stack.pop()
        if (!popped) {
          break
        }
        inStack.delete(popped)
        component.push(popped)
      } while (popped !== node)

      const hasCycle = component.length > 1 || selfLoops.has(component[0])
      if (hasCycle) {
        groups.push({
          id: groups.length + 1,
          size: component.length,
          filePaths: [...component].sort((left, right) => left.localeCompare(right)),
        })
      }
    }
  }

  for (const path of filePaths) {
    if (!indexByNode.has(path)) {
      strongConnect(path)
    }
  }

  return groups.sort((left, right) => right.size - left.size || left.id - right.id).slice(0, limit)
}

function downloadTextFile(fileName: string, content: string, mimeType: string) {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return
  }
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

function hashText(input: string) {
  let hash = 5381
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 33) ^ input.charCodeAt(index)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function buildMarkdownReport(report: AnalysisExportReport) {
  const lines: string[] = []
  lines.push('# Schematic Code Visualizer Report')
  lines.push('')
  lines.push(`- Generated: ${report.generatedAt}`)
  lines.push(`- Project: ${report.projectRoot ?? '-'}`)
  lines.push('')
  lines.push('## Summary')
  lines.push(`- TS files: ${report.summary.tsFiles}`)
  lines.push(`- Directories: ${report.summary.directories}`)
  lines.push(`- Dependency edges: ${report.summary.dependencyEdges}`)
  lines.push(`- Cycle edges: ${report.summary.cycleEdges}`)
  lines.push(`- Unresolved imports: ${report.summary.unresolvedImports}`)
  lines.push(`- Unresolved internal: ${report.summary.unresolvedInternal}`)
  lines.push(`- Unresolved external: ${report.summary.unresolvedExternal}`)
  lines.push(`- Alias resolved: ${report.summary.aliasResolved}`)
  lines.push('')
  lines.push('## Edge Kinds')
  lines.push(`- runtime: ${report.edgeKinds.runtime}`)
  lines.push(`- type: ${report.edgeKinds.type}`)
  lines.push(`- re-export: ${report.edgeKinds['re-export']}`)
  lines.push('')
  lines.push('## Code Health')
  lines.push('### Hotspots')
  if (report.codeHealth.hotspots.length === 0) {
    lines.push('- none')
  } else {
    for (const item of report.codeHealth.hotspots) {
      lines.push(`- ${item.path} | score=${item.score} | in=${item.incoming} | out=${item.outgoing} | loc=${item.loc}`)
    }
  }
  lines.push('')
  lines.push('### Potential Dead Exports')
  if (report.codeHealth.deadExports.length === 0) {
    lines.push('- none')
  } else {
    for (const item of report.codeHealth.deadExports) {
      lines.push(`- ${item.path} | exports=${item.exportCount} | symbols=${item.exports.join(', ')}`)
    }
  }
  lines.push('')
  lines.push('### Cycle Groups')
  if (report.codeHealth.cycleGroups.length === 0) {
    lines.push('- none')
  } else {
    for (const item of report.codeHealth.cycleGroups) {
      lines.push(`- cycle-${item.id} | size=${item.size} | ${item.files.join(' -> ')}`)
    }
  }
  lines.push('')
  lines.push('## Risk')
  lines.push('### File Risk')
  if (report.risk.files.length === 0) {
    lines.push('- none')
  } else {
    for (const item of report.risk.files) {
      lines.push(
        `- ${item.path} | score=${item.score} | runtime ${item.incomingRuntime}/${item.outgoingRuntime} | type ${item.incomingType}/${item.outgoingType} | re-export ${item.incomingReexport}/${item.outgoingReexport}`,
      )
    }
  }
  lines.push('')
  lines.push('### Block Risk')
  if (report.risk.blocks.length === 0) {
    lines.push('- none')
  } else {
    for (const item of report.risk.blocks) {
      lines.push(
        `- ${item.label} | score=${item.score} | files=${item.fileCount} | cross runtime in=${item.incomingCrossBlockRuntime} out=${item.outgoingCrossBlockRuntime}`,
      )
    }
  }
  lines.push('')
  lines.push('## Refactor Signals')
  lines.push('### Orphan Runtime Modules')
  if (report.refactorSignals.orphanRuntimeModules.length === 0) {
    lines.push('- none')
  } else {
    for (const item of report.refactorSignals.orphanRuntimeModules) {
      lines.push(
        `- ${item.path} | exports=${item.exports} | typeTouches=${item.typeTouches} | reexportTouches=${item.reexportTouches}`,
      )
    }
  }
  lines.push('')
  lines.push('### Re-export Hubs')
  if (report.refactorSignals.reexportHubs.length === 0) {
    lines.push('- none')
  } else {
    for (const item of report.refactorSignals.reexportHubs) {
      lines.push(`- ${item.path} | re-export out=${item.outgoingReexport} | runtime in=${item.incomingRuntime} | exports=${item.exports}`)
    }
  }
  lines.push('')
  lines.push('### Duplicate Utility Groups')
  if (report.refactorSignals.duplicateUtilityGroups.length === 0) {
    lines.push('- none')
  } else {
    for (const item of report.refactorSignals.duplicateUtilityGroups) {
      lines.push(`- ${item.baseName} [${item.hash}]`)
      for (const path of item.paths) {
        lines.push(`  - ${path}`)
      }
    }
  }
  lines.push('')
  lines.push('### Re-export Bottlenecks')
  if (report.refactorSignals.reexportBottlenecks.length === 0) {
    lines.push('- none')
  } else {
    for (const item of report.refactorSignals.reexportBottlenecks) {
      lines.push(
        `- ${item.path} | score=${item.score} | runtime-in=${item.incomingRuntime} | reexport-in=${item.incomingReexport} | reexport-out=${item.outgoingReexport}`,
      )
    }
  }
  lines.push('')
  lines.push('### Re-export Chains')
  if (report.refactorSignals.reexportChains.length === 0) {
    lines.push('- none')
  } else {
    for (const chain of report.refactorSignals.reexportChains) {
      lines.push(`- ${chain}`)
    }
  }
  lines.push('')
  lines.push('## Architecture')
  lines.push('### Rules')
  for (const line of report.architecture.rules) {
    lines.push(`- ${line}`)
  }
  lines.push('')
  lines.push('### Layer Distribution')
  lines.push(
    `- ui ${report.architecture.layerDistribution.ui}, domain ${report.architecture.layerDistribution.domain}, infra ${report.architecture.layerDistribution.infra}, shared ${report.architecture.layerDistribution.shared}, tests ${report.architecture.layerDistribution.tests}, unknown ${report.architecture.layerDistribution.unknown}`,
  )
  lines.push('')
  lines.push('### Violations by Kind')
  lines.push(
    `- runtime ${report.architecture.violationsByKind.runtime}, type ${report.architecture.violationsByKind.type}, re-export ${report.architecture.violationsByKind['re-export']}`,
  )
  lines.push('')
  lines.push('### Violations by Layer Pair')
  if (report.architecture.violationsByLayerPair.length === 0) {
    lines.push('- none')
  } else {
    for (const item of report.architecture.violationsByLayerPair) {
      lines.push(`- ${item.pair}: ${item.count}`)
    }
  }
  lines.push('')
  lines.push('### Violation Sample')
  if (report.architecture.violations.length === 0) {
    lines.push('- none')
  } else {
    for (const item of report.architecture.violations) {
      lines.push(`- [${item.kind}] ${item.fromLayer}->${item.toLayer} | ${item.fromPath} -> ${item.toPath}`)
    }
  }
  lines.push('')
  return lines.join('\n')
}

function buildArchitectureMarkdownReport(report: ArchitectureExportReport) {
  const lines: string[] = []
  lines.push('# Architecture Report')
  lines.push('')
  lines.push(`- Generated: ${report.generatedAt}`)
  lines.push(`- Project: ${report.projectRoot ?? '-'}`)
  lines.push('')
  lines.push('## Rules')
  for (const rule of report.rules) {
    lines.push(`- ${rule}`)
  }
  lines.push('')
  lines.push('## Layer Distribution')
  lines.push(
    `- ui ${report.layerDistribution.ui}, domain ${report.layerDistribution.domain}, infra ${report.layerDistribution.infra}, shared ${report.layerDistribution.shared}, tests ${report.layerDistribution.tests}, unknown ${report.layerDistribution.unknown}`,
  )
  lines.push('')
  lines.push('## Violations by Kind')
  lines.push(
    `- runtime ${report.violationsByKind.runtime}, type ${report.violationsByKind.type}, re-export ${report.violationsByKind['re-export']}`,
  )
  lines.push('')
  lines.push('## Violations by Layer Pair')
  if (report.violationsByLayerPair.length === 0) {
    lines.push('- none')
  } else {
    for (const item of report.violationsByLayerPair) {
      lines.push(`- ${item.pair}: ${item.count}`)
    }
  }
  lines.push('')
  lines.push('## Violation Sample')
  if (report.violations.length === 0) {
    lines.push('- none')
  } else {
    for (const item of report.violations) {
      lines.push(`- [${item.kind}] ${item.fromLayer}->${item.toLayer} | ${item.fromPath} -> ${item.toPath}`)
    }
  }
  lines.push('')
  return lines.join('\n')
}

function isAnalysisExportReportCandidate(value: unknown): value is AnalysisExportReport {
  if (!value || typeof value !== 'object') {
    return false
  }
  const candidate = value as Partial<AnalysisExportReport>
  return (
    typeof candidate.generatedAt === 'string' &&
    !!candidate.summary &&
    typeof candidate.summary.tsFiles === 'number' &&
    typeof candidate.summary.dependencyEdges === 'number' &&
    !!candidate.edgeKinds &&
    typeof candidate.edgeKinds.runtime === 'number' &&
    typeof candidate.edgeKinds.type === 'number' &&
    typeof candidate.edgeKinds['re-export'] === 'number' &&
    !!candidate.architecture &&
    Array.isArray(candidate.architecture.rules)
  )
}

function App() {
  const [activeTab, setActiveTab] = useState<AppTab>('overview')
  const [overviewStructureMode, setOverviewStructureMode] = useState<StructureViewMode>('treemap')
  const [overviewTreemapMetric, setOverviewTreemapMetric] = useState<TreemapMetricMode>('files')
  const [scanResult, setScanResult] = useState<ScannedProject | null>(null)
  const [projectReadmeName, setProjectReadmeName] = useState<string | null>(null)
  const [projectReadmeContent, setProjectReadmeContent] = useState<string | null>(null)
  const [dependencyGraph, setDependencyGraph] = useState<DependencyGraph | null>(null)
  const [graphMode, setGraphMode] = useState<GraphBuildMode>('file-level')
  const [routingStyle, setRoutingStyle] = useState<RoutingStyle>('classic')
  const [busDisplayMode, setBusDisplayMode] = useState<BusDisplayMode>('detailed')
  const [folderPacking, setFolderPacking] = useState<FolderPackingMode>('balanced')
  const [highlightCycles, setHighlightCycles] = useState(false)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [directionFilter, setDirectionFilter] = useState<'all' | 'incoming' | 'outgoing'>('all')
  const [edgeKindFilter, setEdgeKindFilter] = useState<EdgeKindFilter>('all')
  const [edgeColorPriority, setEdgeColorPriority] = useState<EdgeColorPriority>('direction')
  const [highlightArchitectureViolations, setHighlightArchitectureViolations] = useState(true)
  const [showBaselineDiff, setShowBaselineDiff] = useState(false)
  const [showOnlyNewDiff, setShowOnlyNewDiff] = useState(false)
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
    })
  }, [scanResult, dependencyGraph, graphMode, highlightCycles, routingStyle, folderPacking, edgeKindFilter])

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
    let filteredByCollapse = flowGraph.edges.filter(
      (edge) => !hiddenNodeIds.has(edge.source) && !hiddenNodeIds.has(edge.target),
    )
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
        } else {
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
  ])

  const displayEdges = useMemo<Edge[]>(() => {
    const edgeRenderToken = `${routingStyle}|${busDisplayMode}|${selectedNodeId ?? 'none'}|${directionFilter}|${edgeColorPriority}|${
      showBaselineDiff ? 'diff-on' : 'diff-off'
    }|${showOnlyNewDiff ? 'only-new' : 'all-diff'}`
    const nodeById = new Map(visibleNodes.map((node) => [node.id, node]))
    const parentById = new Map<string, string>()
    for (const node of visibleNodes) {
      if (node.parentId) {
        parentById.set(node.id, node.parentId)
      }
    }

    const absoluteRectById = new Map<string, { x: number; y: number; width: number; height: number }>()
    const segmentLogicalIds = new Map<string, Set<string>>()
    const folderNodeIds = new Set(visibleNodes.filter((node) => node.id.startsWith('block:')).map((node) => node.id))

    const getAbsoluteRect = (nodeId: string): { x: number; y: number; width: number; height: number } | null => {
      const cached = absoluteRectById.get(nodeId)
      if (cached) {
        return cached
      }
      const node = nodeById.get(nodeId)
      if (!node) {
        return null
      }

      const width = Number(node.style?.width ?? 0)
      const height = Number(node.style?.height ?? 0)
      let rect: { x: number; y: number; width: number; height: number }
      if (!node.parentId) {
        rect = { x: node.position.x, y: node.position.y, width, height }
      } else {
        const parentRect = getAbsoluteRect(node.parentId)
        if (!parentRect) {
          return null
        }
        rect = {
          x: parentRect.x + node.position.x,
          y: parentRect.y + node.position.y,
          width,
          height,
        }
      }
      absoluteRectById.set(nodeId, rect)
      return rect
    }

    for (const node of visibleNodes) {
      getAbsoluteRect(node.id)
    }

    const getFolderChain = (folderId: string) => {
      const chain: string[] = []
      let current: string | undefined = folderId
      while (current && folderNodeIds.has(current)) {
        chain.push(current)
        current = parentById.get(current)
      }
      return chain
    }

    const findFolderLca = (leftFolderId: string, rightFolderId: string) => {
      const leftChain = getFolderChain(leftFolderId)
      const rightSet = new Set(getFolderChain(rightFolderId))
      for (const folderId of leftChain) {
        if (rightSet.has(folderId)) {
          return folderId
        }
      }
      return null
    }

    const getChildUnderAncestor = (folderId: string, ancestorId: string) => {
      if (folderId === ancestorId) {
        return folderId
      }
      let current = folderId
      let parent = parentById.get(current)
      while (parent && parent !== ancestorId) {
        current = parent
        parent = parentById.get(current)
      }
      return parent === ancestorId ? current : folderId
    }

    const blockPairKey = (sourceBlockId: string, targetBlockId: string) => `${sourceBlockId}->${targetBlockId}`
    const laneInfoByEdgeId = new Map<string, { lane: number; laneCount: number; pairKey: string }>()
    const pairMetaByKey = new Map<string, { count: number; primaryEdgeId: string }>()
    const logicalEdgeIdsByPair = new Map<string, string[]>()
    const routingFolderByEdgeId = new Map<
      string,
      {
        sourceLeafFolderId: string
        targetLeafFolderId: string
        sourceRouteFolderId: string
        targetRouteFolderId: string
        lcaFolderId: string | null
      }
    >()
    const compactTrunkMode = routingStyle === 'bus' && busDisplayMode === 'trunk-only'
    const roundPoint = (value: number) => Math.round(value * 10) / 10
    const segmentIdFromPoints = (
      sourceBlockId: string,
      targetBlockId: string,
      pairKey: string,
      from: { x: number; y: number },
      to: { x: number; y: number },
    ) =>
      [
        'seg',
        sourceBlockId,
        targetBlockId,
        pairKey,
        `${roundPoint(from.x)}:${roundPoint(from.y)}`,
        `${roundPoint(to.x)}:${roundPoint(to.y)}`,
      ].join('|')

    const resolveRoutingFolders = (edge: Edge) => {
      const cached = routingFolderByEdgeId.get(edge.id)
      if (cached) {
        return cached
      }
      const sourceLeafFolderId = fileNodeToBlockId.get(edge.source) ?? edge.source
      const targetLeafFolderId = fileNodeToBlockId.get(edge.target) ?? edge.target
      const lcaFolderId = findFolderLca(sourceLeafFolderId, targetLeafFolderId)
      const sourceRouteFolderId = lcaFolderId
        ? getChildUnderAncestor(sourceLeafFolderId, lcaFolderId)
        : sourceLeafFolderId
      const targetRouteFolderId = lcaFolderId
        ? getChildUnderAncestor(targetLeafFolderId, lcaFolderId)
        : targetLeafFolderId

      const resolved = {
        sourceLeafFolderId,
        targetLeafFolderId,
        sourceRouteFolderId,
        targetRouteFolderId,
        lcaFolderId,
      }
      routingFolderByEdgeId.set(edge.id, resolved)
      return resolved
    }

    const aggregationPairKey = (edge: Edge, sourceBlockId: string, targetBlockId: string) => {
      const baseKey = blockPairKey(sourceBlockId, targetBlockId)
      if (!compactTrunkMode || !selectedNodeId || sourceBlockId !== targetBlockId) {
        return baseKey
      }
      const isOutgoing = edge.source === selectedNodeId
      const isIncoming = edge.target === selectedNodeId
      if (isOutgoing && !isIncoming) {
        return `${baseKey}|out`
      }
      if (isIncoming && !isOutgoing) {
        return `${baseKey}|in`
      }
      return `${baseKey}|self`
    }

    if (routingStyle === 'bus') {
      const edgeIdsByPair = new Map<string, string[]>()
      for (const edge of visibleEdges) {
        if (!edge.source.startsWith('file:') || !edge.target.startsWith('file:')) {
          continue
        }
        const routed = resolveRoutingFolders(edge)
        const key = aggregationPairKey(edge, routed.sourceRouteFolderId, routed.targetRouteFolderId)
        const existing = edgeIdsByPair.get(key)
        if (existing) {
          existing.push(edge.id)
        } else {
          edgeIdsByPair.set(key, [edge.id])
        }
      }
      for (const [pairKey, edgeIds] of edgeIdsByPair.entries()) {
        edgeIds.sort((left, right) => left.localeCompare(right))
        const laneCount = edgeIds.length
        logicalEdgeIdsByPair.set(pairKey, [...edgeIds])
        pairMetaByKey.set(pairKey, { count: laneCount, primaryEdgeId: edgeIds[0] })
        edgeIds.forEach((edgeId, lane) => {
          laneInfoByEdgeId.set(edgeId, { lane, laneCount, pairKey })
        })
      }
    }

    const createBusPoints = (edge: Edge) => {
      if (routingStyle !== 'bus' || !edge.source.startsWith('file:') || !edge.target.startsWith('file:')) {
        return null
      }

      const routed = resolveRoutingFolders(edge)
      const sourceBlockId = routed.sourceRouteFolderId
      const targetBlockId = routed.targetRouteFolderId
      const sourceRect = absoluteRectById.get(edge.source)
      const targetRect = absoluteRectById.get(edge.target)
      const sourceBlockRect = absoluteRectById.get(sourceBlockId)
      const targetBlockRect = absoluteRectById.get(targetBlockId)

      if (!sourceRect || !targetRect || !sourceBlockRect || !targetBlockRect) {
        return null
      }

      const laneInfo = laneInfoByEdgeId.get(edge.id)
      const lane = laneInfo?.lane ?? 0
      const laneCount = laneInfo?.laneCount ?? 1
      const pairKey = laneInfo?.pairKey ?? blockPairKey(sourceBlockId, targetBlockId)
      const pairMeta = pairMetaByKey.get(pairKey)
      const laneShift = (lane - (laneCount - 1) / 2) * 7
      const laneShiftForGeometry = compactTrunkMode ? 0 : laneShift
      const isPairPrimary = pairMeta?.primaryEdgeId === edge.id
      const logicalEdgeIds = logicalEdgeIdsByPair.get(pairKey) ?? [edge.id]

      const sourcePoint = { x: sourceRect.x + sourceRect.width, y: sourceRect.y + sourceRect.height / 2 }
      const targetPoint = { x: targetRect.x, y: targetRect.y + targetRect.height / 2 }
      const sourceExportBusY = sourceBlockRect.y + sourceBlockRect.height - 16
      const targetImportBusY = targetBlockRect.y + 16
      const sourceBoundaryPin = { x: sourceBlockRect.x + sourceBlockRect.width + 5, y: sourceExportBusY }
      const targetBoundaryPin = { x: targetBlockRect.x - 5, y: targetImportBusY }
      const sourceOuterX = sourceBlockRect.x + sourceBlockRect.width + 22 + laneShiftForGeometry
      const localBridgeX = sourceOuterX
      const trunkY = sourceExportBusY + (targetImportBusY - sourceExportBusY) * 0.5
      const sourceTrunkX = sourceBoundaryPin.x + 12
      const targetTrunkX = targetBoundaryPin.x - 12
      const sourceBranchX = sourceBoundaryPin.x + 20 + laneShiftForGeometry
      const targetBranchX = targetBoundaryPin.x - 20 + laneShiftForGeometry
      const isCrossFolder = sourceBlockId !== targetBlockId

      const points =
        !isCrossFolder
          ? [
              sourcePoint,
              { x: sourcePoint.x + 8, y: sourcePoint.y },
              { x: sourcePoint.x + 8, y: sourceExportBusY },
              { x: localBridgeX, y: sourceExportBusY },
              { x: localBridgeX, y: targetImportBusY },
              { x: targetPoint.x - 8, y: targetImportBusY },
              { x: targetPoint.x - 8, y: targetPoint.y },
              targetPoint,
            ]
          : compactTrunkMode
            ? [
                sourcePoint,
                { x: sourcePoint.x + 8, y: sourcePoint.y },
                { x: sourcePoint.x + 8, y: sourceExportBusY },
                { x: sourceBoundaryPin.x, y: sourceExportBusY },
                { x: sourceTrunkX, y: sourceExportBusY },
                { x: sourceTrunkX, y: trunkY },
                { x: targetTrunkX, y: trunkY },
                { x: targetTrunkX, y: targetImportBusY },
                { x: targetBoundaryPin.x, y: targetImportBusY },
                { x: targetPoint.x - 8, y: targetImportBusY },
                { x: targetPoint.x - 8, y: targetPoint.y },
                targetPoint,
              ]
          : [
              sourcePoint,
              { x: sourcePoint.x + 8, y: sourcePoint.y },
              { x: sourcePoint.x + 8, y: sourceExportBusY },
              { x: sourceBoundaryPin.x, y: sourceExportBusY },
              { x: sourceBranchX, y: sourceExportBusY },
              { x: sourceBranchX, y: trunkY },
              { x: sourceTrunkX, y: trunkY },
              { x: targetTrunkX, y: trunkY },
              { x: targetBranchX, y: trunkY },
              { x: targetBranchX, y: targetImportBusY },
              { x: targetBoundaryPin.x, y: targetImportBusY },
              { x: targetPoint.x - 8, y: targetImportBusY },
              { x: targetPoint.x - 8, y: targetPoint.y },
              targetPoint,
            ]

      return {
        points,
        lane,
        laneCount,
        pairKey,
        pairMeta,
        isCrossFolder,
        isPairPrimary,
        logicalEdgeIds,
        sourceBlockId,
        targetBlockId,
      }
    }

    const selectedLogicalEdgeIds = selectedNodeId ? new Set(visibleEdges.map((edge) => edge.id)) : new Set<string>()

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

      const dependencyKind = edge.data?.dependencyKind as DependencyEdge['kind'] | undefined
      const kindColor = dependencyKind === 'type' ? '#b792ff' : dependencyKind === 're-export' ? '#59ccff' : '#7ea3bd'
      let color = isNewDiffEdge ? '#57e6ff' : isArchitectureViolationEdge && highlightArchitectureViolations ? '#ff6b9a' : kindColor
      let strokeWidth = Math.max(Number(edge.style?.strokeWidth ?? 0), 1.4)
      const isCycleColored = String(edge.style?.stroke ?? '').startsWith('#ff')
      let strokeOpacity = 1

      if (selectedNodeId && isConnected) {
        if (isNewDiffEdge) {
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
          isNewDiffEdge ? 2.8 : isArchitectureViolationEdge && highlightArchitectureViolations ? 2.8 : 2,
        )
      } else if (isCycleColored) {
        color = String(edge.style?.stroke)
      } else {
        color = isNewDiffEdge ? '#57e6ff' : isArchitectureViolationEdge && highlightArchitectureViolations ? '#ff6b9a' : kindColor
      }

      if (isArchitectureViolationEdge && highlightArchitectureViolations) {
        strokeWidth = Math.max(strokeWidth, 2.4)
      }
      if (isNewDiffEdge) {
        strokeWidth = Math.max(strokeWidth, 2.6)
      } else if (showBaselineDiff && hasBaselineGraphSnapshot) {
        strokeOpacity = 0.22
      }

      const baseEdge: Edge = {
        ...edge,
        id: `${edge.id}::${edgeRenderToken}`,
        type: routingStyle === 'bus' ? 'bus' : 'classicLine',
        style: {
          ...(edge.style ?? {}),
          stroke: color,
          strokeWidth,
          opacity: strokeOpacity,
        },
        markerEnd:
          edge.markerEnd && typeof edge.markerEnd === 'object'
            ? { ...edge.markerEnd, color }
            : { type: 'arrowclosed' as const, color },
      }

      const bus = createBusPoints(edge)
      if (!bus) {
        preparedEdges.push(baseEdge)
        continue
      }

      if (compactTrunkMode && (bus.pairMeta?.count ?? 1) > 1 && !bus.isPairPrimary) {
        continue
      }

      const segmentIds: string[] = []
      for (let index = 0; index < bus.points.length - 1; index += 1) {
        const from = bus.points[index]
        const to = bus.points[index + 1]
        const segmentId = segmentIdFromPoints(bus.sourceBlockId, bus.targetBlockId, bus.pairKey, from, to)
        segmentIds.push(segmentId)
        const existing = segmentLogicalIds.get(segmentId)
        const logicalEdgeIds = bus.logicalEdgeIds
        if (existing) {
          for (const logicalEdgeId of logicalEdgeIds) {
            existing.add(logicalEdgeId)
          }
        } else {
          segmentLogicalIds.set(segmentId, new Set(logicalEdgeIds))
        }
      }

      const aggregateCountLabel = bus.isCrossFolder && bus.isPairPrimary && (bus.pairMeta?.count ?? 1) > 1
        ? String(bus.pairMeta?.count ?? '')
        : undefined

      preparedEdges.push({
        ...baseEdge,
        label: aggregateCountLabel ?? baseEdge.label,
        data: {
          ...(baseEdge.data ?? {}),
          logicalEdgeId: edge.id,
          logicalEdgeIds: bus.logicalEdgeIds,
          segmentIds,
          points: bus.points,
          busLane: bus.lane,
          busCount: bus.laneCount,
          isPairPrimary: bus.isPairPrimary,
          pairKey: bus.pairKey,
          pairCount: bus.pairMeta?.count ?? 1,
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
        const logicalIds = segmentLogicalIds.get(segmentId)
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
    visibleNodes,
    fileNodeToBlockId,
    flowGraph,
    hiddenNodeIds,
    routingStyle,
    busDisplayMode,
    selectedNodeId,
    directionFilter,
    edgeColorPriority,
    architectureViolationEdgeKeySet,
    architectureViolationBlockPairCount,
    highlightArchitectureViolations,
    showBaselineDiff,
    showOnlyNewDiff,
    hasBaselineGraphSnapshot,
    newFileEdgeKeySet,
    newBlockPairSet,
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
    setSearchQuery('')
    setHoveredFilePath(null)
    setIsCanvasLocked(false)
    setSavedViewport(null)
    setActiveTab('overview')
  }, [scanResult?.rootName])

  useEffect(() => {
    setSelectedNodeId(null)
    setDirectionFilter('all')
  }, [routingStyle, busDisplayMode, folderPacking])

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

  const hoveredFileAnalysis = hoveredFilePath ? fileAnalysisByPath.get(hoveredFilePath) : null
  const hoverInfoLine = hoveredFileAnalysis
    ? `${hoveredFilePath ?? '-'} | Exports: ${
        hoveredFileAnalysis.exports.length > 0 ? hoveredFileAnalysis.exports.join(', ') : 'none'
      }`
    : (hoveredFilePath ?? '-')
  const selectedInfoLine = selectedNodeId ?? '-'

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

  return (
    <main className="app-shell">
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
        <button
          type="button"
          className={activeTab === 'architecture' ? 'is-active' : ''}
          onClick={() => setActiveTab('architecture')}
        >
          Architecture
        </button>
        <button
          type="button"
          className={activeTab === 'about' ? 'is-active' : ''}
          onClick={() => setActiveTab('about')}
        >
          About
        </button>
      </section>

      {activeTab === 'overview' && (
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
      )}

      {activeTab === 'about' && (
        <section className="panel grid">
          <div className="stats">
            <h2>About This App</h2>
            <p>
              Schematic Code Visualizer analyzes a selected TypeScript project and renders structure + dependency
              relations as a board-like diagram.
            </p>
            <p>
              <strong>Core idea:</strong> files as components, imports/exports as routing, folders as logical blocks.
            </p>
            <p>
              <strong>Current focus:</strong> readability modes (`classic` / `bus`), hierarchy-aware grouping, and
              interactive exploration.
            </p>
            <p>
              <strong>Selected project:</strong> {scanResult?.rootName ?? '-'}
            </p>
            <p>
              <strong>README:</strong> {projectReadmeName ?? 'not found in project root'}
            </p>
          </div>
          <div className="tree">
            <h2>Project README</h2>
            <pre>{projectReadmeContent ?? 'README.md not found or not loaded yet.'}</pre>
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
      )}

      {activeTab === 'architecture' && (
        <section className="panel grid architecture-grid">
          <div className="stats">
            <div className="section-card">
              <h2>Architecture Rules</h2>
              <ul className="rule-list">
                {architectureRuleLines.map((line) => (
                  <li key={`arch-rule-${line}`}>{line}</li>
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

            <div className="section-card">
              <h2>Architecture Config</h2>
              <div className="architecture-config-panel">
                <div className="architecture-config-mode">
                  <button
                    type="button"
                    className={architectureConfigMode === 'visual' ? 'is-active' : ''}
                    onClick={() => setArchitectureConfigMode('visual')}
                  >
                    Visual
                  </button>
                  <button
                    type="button"
                    className={architectureConfigMode === 'json' ? 'is-active' : ''}
                    onClick={() => setArchitectureConfigMode('json')}
                  >
                    Advanced JSON
                  </button>
                </div>
                {architectureConfigMode === 'visual' ? (
                  <div className="architecture-visual-editor">
                    <p className="hint">
                      Layer matchers (comma-separated path fragments). First matched layer in priority order wins.
                    </p>
                    {ARCHITECTURE_MATCHER_LAYERS.map((layer) => (
                      <label key={layer} className="architecture-matcher-row">
                        <span>{layer}</span>
                        <input
                          type="text"
                          value={architectureConfig.layerMatchers[layer].join(', ')}
                          onChange={(event) => updateArchitectureMatchers(layer, event.target.value)}
                          placeholder="e.g. /components/, /ui/"
                        />
                      </label>
                    ))}
                    <p className="hint">Allowed dependency directions:</p>
                    <div className="architecture-matrix-wrap">
                      <table className="architecture-matrix">
                        <thead>
                          <tr>
                            <th>From \\ To</th>
                            {ARCHITECTURE_RULE_LAYERS.map((layer) => (
                              <th key={`head-${layer}`}>{layer}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {ARCHITECTURE_RULE_LAYERS.map((fromLayer) => (
                            <tr key={`row-${fromLayer}`}>
                              <th>{fromLayer}</th>
                              {ARCHITECTURE_RULE_LAYERS.map((toLayer) => {
                                const isAllowed = architectureConfig.allowedTargets[fromLayer].includes(toLayer)
                                return (
                                  <td key={`${fromLayer}->${toLayer}`}>
                                    <input
                                      type="checkbox"
                                      checked={isAllowed}
                                      onChange={(event) =>
                                        updateArchitectureAllowedTarget(fromLayer, toLayer, event.target.checked)
                                      }
                                    />
                                  </td>
                                )
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : (
                  <textarea
                    value={architectureConfigDraft}
                    onChange={(event) => setArchitectureConfigDraft(event.target.value)}
                    spellCheck={false}
                    rows={12}
                  />
                )}
                <div className="architecture-config-actions">
                  {architectureConfigMode === 'json' && (
                    <button type="button" onClick={applyArchitectureConfigDraft}>
                      Apply config
                    </button>
                  )}
                  <button type="button" onClick={resetArchitectureConfig}>
                    Reset default
                  </button>
                </div>
                {architectureConfigError && <p className="error">{architectureConfigError}</p>}
              </div>
            </div>

            <div className="section-card">
              <h2>Export Architecture</h2>
              <p>Save architecture rules and violations as JSON or Markdown.</p>
              <div className="actions">
                <button type="button" onClick={exportArchitectureReportJson} disabled={!scanResult || !dependencyGraph}>
                  Export JSON
                </button>
                <button
                  type="button"
                  onClick={exportArchitectureReportMarkdown}
                  disabled={!scanResult || !dependencyGraph}
                >
                  Export Markdown
                </button>
              </div>
            </div>

            {architectureViolations.length > 0 && (
              <div className="section-card">
                <h2>Violation Quick Actions</h2>
                <ul className="quick-action-list">
                  {architectureViolations.slice(0, 12).map((item) => (
                    <li key={`arch-v-${item.kind}-${item.fromPath}-${item.toPath}`}>
                      <code>
                        [{item.kind}] {item.fromLayer}-&gt;{item.toLayer}: {item.fromPath}
                      </code>
                      <button
                        type="button"
                        className="quick-action-button"
                        onClick={() => focusViolationOnBoard(item)}
                      >
                        Show on Board
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <div className="tree right-stack">
            <div className="section-card">
              <h2>Architecture Rules Snapshot</h2>
              <pre className="report-pre">{architectureRuleLines.map((line) => `- ${line}`).join('\n')}</pre>
            </div>
            <div className="section-card">
              <h2>Violations by Layer Pair</h2>
              <pre className="report-pre">
                {architectureViolationByPair.length > 0
                  ? architectureViolationByPair.map(([pair, count]) => `- ${pair}: ${count}`).join('\n')
                  : '- no violations'}
              </pre>
            </div>
            <div className="section-card">
              <h2>Violation Sample</h2>
              <pre className="report-pre">
                {architectureViolations.length > 0
                  ? architectureViolations
                      .slice(0, 40)
                      .map(
                        (item) =>
                          `- [${item.kind}] ${item.fromLayer}->${item.toLayer} | ${item.fromPath} -> ${item.toPath}`,
                      )
                      .join('\n')
                  : '- no violations'}
              </pre>
            </div>
          </div>
        </section>
      )}

      {activeTab === 'board' && (
        <section className="panel grid board-grid">
          <div className="stats board-sidebar">
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
                <input
                  type="checkbox"
                  checked={highlightArchitectureViolations}
                  onChange={(event) => setHighlightArchitectureViolations(event.target.checked)}
                />
                Highlight architecture violations
              </label>
              <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={showBaselineDiff}
                  onChange={(event) => {
                    const next = event.target.checked
                    setShowBaselineDiff(next)
                    if (!next) {
                      setShowOnlyNewDiff(false)
                    }
                  }}
                  disabled={!hasBaselineGraphSnapshot}
                />
                Show baseline diff
              </label>
              <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={showOnlyNewDiff}
                  onChange={(event) => setShowOnlyNewDiff(event.target.checked)}
                  disabled={!showBaselineDiff || !hasBaselineGraphSnapshot}
                />
                Show only new
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
              <label className="toggle-row">
                Edge type
                <select value={edgeKindFilter} onChange={(event) => setEdgeKindFilter(event.target.value as EdgeKindFilter)}>
                  <option value="all">all</option>
                  <option value="runtime">runtime</option>
                  <option value="type">type</option>
                  <option value="re-export">re-export</option>
                </select>
              </label>
              <label className="toggle-row">
                Color priority
                <select
                  value={edgeColorPriority}
                  onChange={(event) => setEdgeColorPriority(event.target.value as EdgeColorPriority)}
                >
                  <option value="direction">direction</option>
                  <option value="kind">kind</option>
                </select>
              </label>
              <label className="toggle-row">
                Routing
                <select
                  value={routingStyle}
                  onChange={(event) => setRoutingStyle(event.target.value as RoutingStyle)}
                >
                  <option value="classic">classic</option>
                  <option value="bus">bus</option>
                </select>
              </label>
              <label className="toggle-row">
                Bus view
                <select
                  value={busDisplayMode}
                  onChange={(event) => setBusDisplayMode(event.target.value as BusDisplayMode)}
                  disabled={routingStyle !== 'bus'}
                >
                  <option value="detailed">detailed</option>
                  <option value="trunk-only">trunk-only</option>
                </select>
              </label>
              <label className="toggle-row">
                Folder packing
                <select
                  value={folderPacking}
                  onChange={(event) => setFolderPacking(event.target.value as FolderPackingMode)}
                  disabled={graphMode !== 'file-level'}
                >
                  <option value="balanced">balanced</option>
                  <option value="dense">dense</option>
                </select>
              </label>
              <label className="toggle-row">
                Auto depth
                <input
                  type="checkbox"
                  checked={autoFolderDepth}
                  onChange={(event) => {
                    setAutoFolderDepth(event.target.checked)
                    setFolderControlMode('preset')
                  }}
                  disabled={graphMode !== 'file-level' || !flowGraph}
                />
              </label>
              <label className="toggle-row">
                Depth
                <select
                  value={String(manualFolderDepth)}
                  onChange={(event) => {
                    const nextValue = event.target.value === 'any' ? 'any' : Number(event.target.value)
                    setManualFolderDepth(nextValue)
                    setAutoFolderDepth(false)
                    setFolderControlMode('preset')
                  }}
                  disabled={graphMode !== 'file-level' || autoFolderDepth}
                >
                  <option value="any">any</option>
                  <option value={1}>1</option>
                  <option value={2}>2</option>
                  <option value={3}>3</option>
                  <option value={4}>4</option>
                  <option value={5}>5</option>
                  <option value={6}>6</option>
                  <option value={7}>7</option>
                  <option value={8}>8</option>
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
              <div className="board-action-grid">
                <button
                  type="button"
                  className="board-icon-btn"
                  title={selectedBlockId && collapsedBlockIds.has(selectedBlockId) ? 'Expand selected block' : 'Collapse selected block'}
                  aria-label={selectedBlockId && collapsedBlockIds.has(selectedBlockId) ? 'Expand selected block' : 'Collapse selected block'}
                  onClick={toggleSelectedBlockCollapse}
                  disabled={graphMode !== 'file-level' || !selectedBlockId}
                >
                  {selectedBlockId && collapsedBlockIds.has(selectedBlockId) ? '⤢' : '⤡'}
                </button>
                <button
                  type="button"
                  className="board-icon-btn"
                  title={areAllFoldersCollapsed ? 'Expand all folders' : 'Collapse all folders'}
                  aria-label={areAllFoldersCollapsed ? 'Expand all folders' : 'Collapse all folders'}
                  onClick={toggleAllFoldersCollapse}
                  disabled={graphMode !== 'file-level' || collapsibleBlockIds.size === 0}
                >
                  {areAllFoldersCollapsed ? '⤢' : '⤡'}
                </button>
                <button
                  type="button"
                  className="board-icon-btn"
                  title="Clear selection"
                  aria-label="Clear selection"
                  onClick={() => {
                    setSelectedNodeId(null)
                    setDirectionFilter('all')
                  }}
                  disabled={!selectedNodeId}
                >
                  ⨯
                </button>
              </div>
            </div>
            <div className="board-legend">
              <span className="legend-item">
                <span className="legend-swatch legend-swatch-neutral" />
                Runtime edge
              </span>
              <span className="legend-item">
                <span className="legend-swatch legend-swatch-type" />
                Type edge
              </span>
              <span className="legend-item">
                <span className="legend-swatch legend-swatch-reexport" />
                Re-export edge
              </span>
              <span className="legend-item">
                <span className="legend-swatch legend-swatch-violation" />
                Architecture violation
              </span>
              <span className="legend-item">
                <span className="legend-swatch legend-swatch-diff" />
                New vs baseline
              </span>
              <span className="legend-item">
                <span className="legend-swatch legend-swatch-import" />
                Incoming (selected)
              </span>
              <span className="legend-item">
                <span className="legend-swatch legend-swatch-export" />
                Outgoing (selected)
              </span>
              <span className="legend-note">
                `Color priority` controls whether selected edges keep kind colors or switch to direction colors.
              </span>
              {showBaselineDiff && (
                <span className="legend-note">`Show only new` hides baseline nodes/edges and leaves only additions.</span>
              )}
              {!hasBaselineGraphSnapshot && (
                <span className="legend-note">Load baseline JSON in Diagnostics to enable diff mode.</span>
              )}
            </div>
          </div>
          <div className="board-main">
            {flowGraph ? (
              <>
                <p className="canvas-meta">
                  Blocks: {flowGraph.blockCount}, Nodes: {flowGraph.nodes.length}, Visible edges: {displayEdges.length}
                  {' | '}Cycles: {flowGraph.cycleEdgeCount}
                  {' | '}Matches: {matchingFileNodeIds.size}
                  {isLayouting ? ' | Layout: running...' : ' | Layout: ELK ready'}
                </p>
                <div className="canvas-shell">
                  <ReactFlow
                    key={`rf-${graphMode}-${routingStyle}-${busDisplayMode}-${folderPacking}-${
                      routingStyle === 'classic'
                        ? `${selectedNodeId ?? 'none'}-${directionFilter}-${edgeKindFilter}-${edgeColorPriority}`
                        : `stable-${edgeKindFilter}-${edgeColorPriority}`
                    }-${highlightArchitectureViolations ? 'arch-on' : 'arch-off'}-${
                      showBaselineDiff ? 'diff-on' : 'diff-off'
                    }-${showOnlyNewDiff ? 'only-new' : 'all-diff'}-${
                      hasBaselineGraphSnapshot ? 'baseline-ready' : 'baseline-missing'
                    }-${
                      architectureViolations.length
                    }`}
                    nodes={visibleNodes}
                    edges={displayEdges}
                    nodeTypes={nodeTypes}
                    edgeTypes={edgeTypes}
                    onNodeClick={onNodeClick}
                    onPaneClick={() => {
                      setSelectedNodeId(null)
                      setDirectionFilter('all')
                    }}
                    onNodeMouseEnter={onNodeMouseEnter}
                    onNodeMouseLeave={onNodeMouseLeave}
                    defaultViewport={savedViewport ?? { x: 0, y: 0, zoom: 1 }}
                    fitView={!savedViewport}
                    minZoom={0.1}
                    maxZoom={1.5}
                    panOnDrag={!isCanvasLocked}
                    panOnScroll={!isCanvasLocked}
                    zoomOnScroll={!isCanvasLocked}
                    zoomOnPinch={!isCanvasLocked}
                    zoomOnDoubleClick={!isCanvasLocked}
                    nodesDraggable={!isCanvasLocked}
                    elementsSelectable={!isCanvasLocked}
                    onInit={(instance) => {
                      setSavedViewport(instance.getViewport())
                    }}
                    onMoveEnd={(_event, viewport) => {
                      setSavedViewport(viewport)
                    }}
                  >
                    <MiniMap
                      position="bottom-right"
                      pannable
                      zoomable
                      nodeColor="#335f82"
                      bgColor="rgba(4, 16, 29, 0.92)"
                      maskColor="rgba(2, 9, 16, 0.72)"
                    />
                    <CanvasNavWheel
                      isLocked={isCanvasLocked}
                      onToggleLock={() => setIsCanvasLocked((previous) => !previous)}
                    />
                    <Background gap={24} size={1} color="#3a6689" />
                  </ReactFlow>
                </div>
                <p className="canvas-selected-strip" title={selectedInfoLine}>
                  Selected: <span className="canvas-selected-value">{selectedInfoLine}</span>
                </p>
                <p className="canvas-hover-strip" title={hoverInfoLine}>
                  Hover: <span className="canvas-hover-value">{hoverInfoLine}</span>
                </p>
              </>
            ) : (
              <p className="canvas-meta">Scan a folder to build and render dependency canvas.</p>
            )}
          </div>
        </section>
      )}
    </main>
  )
}

export default App
