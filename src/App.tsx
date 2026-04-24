import { useEffect, useMemo, useState } from 'react'
import { Background, MiniMap, ReactFlow, type Edge, type NodeMouseHandler } from '@xyflow/react'
import { BusEdge } from './components/BusEdge'
import { ClassicEdge } from './components/ClassicEdge'
import { CanvasNavWheel } from './components/CanvasNavWheel'
import { ChipFileNode } from './components/ChipFileNode'
import { FolderBlockNode } from './components/FolderBlockNode'
import { analyzeProjectDependenciesInWorker } from './lib/analyzer-worker-client'
import { applyElkToBlockNodes } from './lib/elk-layout'
import {
  buildDependencyFlowGraph,
  type FolderPackingMode,
  type GraphBuildMode,
  type RoutingStyle,
} from './lib/graph-builder'
import type { DependencyGraph, FileAnalysis, ScannedProject } from './lib/models'
import { scanProjectFolder } from './lib/scanner'
import { readTsConfigAliasConfig } from './lib/tsconfig-reader'
import { buildTreeLines } from './lib/tree-view'
import './App.css'
import '@xyflow/react/dist/style.css'

type AppTab = 'overview' | 'board' | 'dependencies' | 'diagnostics'
type BusDisplayMode = 'detailed' | 'trunk-only'

function App() {
  const [activeTab, setActiveTab] = useState<AppTab>('overview')
  const [scanResult, setScanResult] = useState<ScannedProject | null>(null)
  const [dependencyGraph, setDependencyGraph] = useState<DependencyGraph | null>(null)
  const [graphMode, setGraphMode] = useState<GraphBuildMode>('file-level')
  const [routingStyle, setRoutingStyle] = useState<RoutingStyle>('classic')
  const [busDisplayMode, setBusDisplayMode] = useState<BusDisplayMode>('detailed')
  const [folderPacking, setFolderPacking] = useState<FolderPackingMode>('balanced')
  const [highlightCycles, setHighlightCycles] = useState(false)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [directionFilter, setDirectionFilter] = useState<'all' | 'incoming' | 'outgoing'>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [collapsedBlockIds, setCollapsedBlockIds] = useState<Set<string>>(new Set())
  const [hoveredFilePath, setHoveredFilePath] = useState<string | null>(null)
  const [isCanvasLocked, setIsCanvasLocked] = useState(false)
  const [savedViewport, setSavedViewport] = useState<{ x: number; y: number; zoom: number } | null>(null)
  const [layoutedNodes, setLayoutedNodes] = useState<ReturnType<typeof buildDependencyFlowGraph>['nodes']>([])
  const [isLayouting, setIsLayouting] = useState(false)
  const [isScanning, setIsScanning] = useState(false)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const treeLines = useMemo(() => buildTreeLines(scanResult?.tree ?? null), [scanResult])
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

  const flowGraph = useMemo(() => {
    if (!scanResult || !dependencyGraph) {
      return null
    }
    return buildDependencyFlowGraph(scanResult, dependencyGraph, graphMode, {
      highlightCycles,
      routingStyle,
      folderPacking,
    })
  }, [scanResult, dependencyGraph, graphMode, highlightCycles, routingStyle, folderPacking])

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
    const filteredByCollapse = flowGraph.edges.filter(
      (edge) => !hiddenNodeIds.has(edge.source) && !hiddenNodeIds.has(edge.target),
    )
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
  }, [flowGraph, hiddenNodeIds, selectedNodeId, directionFilter])

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
      .filter((node) => !hiddenNodeIds.has(node.id))
      .map((node) => {
        const isSelected = node.id === selectedNodeId
        const isConnected = connectedNodeIds.has(node.id)
        const isFileNode = node.id.startsWith('file:')
        const isMatch = matchingFileNodeIds.has(node.id)
        const isBlockWithMatch = blockIdsWithMatches.has(node.id)
        const isIncomingRelated = incomingRelatedNodeIds.has(node.id)
        const isOutgoingRelated = outgoingRelatedNodeIds.has(node.id)
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
  ])

  const displayEdges = useMemo<Edge[]>(() => {
    const edgeRenderToken = `${routingStyle}|${busDisplayMode}|${selectedNodeId ?? 'none'}|${directionFilter}`
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

      let color = '#7ea3bd'
      let strokeWidth = Math.max(Number(edge.style?.strokeWidth ?? 0), 1.4)

      if (selectedNodeId && isConnected) {
        if (isOutgoing && !isIncoming) {
          color = '#f5b04d'
        } else if (isIncoming && !isOutgoing) {
          color = '#6fdc9a'
        } else {
          color = '#ffe79f'
        }
        strokeWidth = Math.max(strokeWidth, 2)
      } else if (String(edge.style?.stroke ?? '').startsWith('#ff')) {
        color = String(edge.style?.stroke)
      }

      const baseEdge: Edge = {
        ...edge,
        id: `${edge.id}::${edgeRenderToken}`,
        type: routingStyle === 'bus' ? 'bus' : 'classicLine',
        style: {
          ...(edge.style ?? {}),
          stroke: color,
          strokeWidth,
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
  }, [visibleEdges, visibleNodes, fileNodeToBlockId, flowGraph, hiddenNodeIds, routingStyle, busDisplayMode, selectedNodeId, directionFilter])


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
    setSearchQuery('')
    setHoveredFilePath(null)
    setIsCanvasLocked(false)
    setSavedViewport(null)
    setActiveTab('overview')
  }, [graphMode, scanResult?.rootName])

  useEffect(() => {
    setSelectedNodeId(null)
    setDirectionFilter('all')
  }, [routingStyle, busDisplayMode, folderPacking])

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

  function applyFolderDepthPreset(maxDepth: number) {
    if (!flowGraph || graphMode !== 'file-level') {
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
      </section>

      {activeTab === 'overview' && (
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
              <strong>Cycles:</strong> {flowGraph?.cycleEdgeCount ?? 0}
            </p>
            <p>
              <strong>Search Matches:</strong> {matchingFileNodeIds.size}
            </p>
          </div>
          <div className="tree">
            <h2>Directory Tree</h2>
            <pre>{treeLines.length > 0 ? treeLines.join('\n') : 'Select a folder to scan.'}</pre>
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
        <section className="panel grid">
          <div className="stats">
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
          <div className="tree">
            <h2>Selection / Hover</h2>
            <pre>
              {selectedNodeId ? `Selected: ${selectedNodeId}\n` : 'Selected: -\n'}
              {hoveredFilePath ? `Hover: ${hoveredFilePath}\n` : 'Hover: -\n'}
              {hoveredFileAnalysis
                ? `Exports: ${
                    hoveredFileAnalysis.exports.length > 0 ? hoveredFileAnalysis.exports.join(', ') : 'none'
                  }`
                : 'Exports: -'}
            </pre>
          </div>
        </section>
      )}

      {activeTab === 'board' && (
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
            <label className="toggle-row search-row">
              Search file
              <input
                type="text"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="name or path"
              />
            </label>
            <button
              type="button"
              onClick={toggleSelectedBlockCollapse}
              disabled={graphMode !== 'file-level' || !selectedBlockId}
            >
              {selectedBlockId && collapsedBlockIds.has(selectedBlockId) ? 'Expand block' : 'Collapse block'}
            </button>
            <button
              type="button"
              onClick={() => setCollapsedBlockIds(new Set())}
              disabled={collapsedBlockIds.size === 0 || graphMode !== 'file-level'}
            >
              Expand all folders
            </button>
          <button
            type="button"
            onClick={applyAutoFolderDepth}
            disabled={graphMode !== 'file-level' || !flowGraph}
          >
            Auto depth
          </button>
          <button
            type="button"
            onClick={() => applyFolderDepthPreset(1)}
            disabled={graphMode !== 'file-level'}
          >
            Depth 1
          </button>
          <button
            type="button"
            onClick={() => applyFolderDepthPreset(2)}
            disabled={graphMode !== 'file-level'}
          >
            Depth 2
          </button>
          <button
            type="button"
            onClick={() => applyFolderDepthPreset(3)}
            disabled={graphMode !== 'file-level'}
          >
            Depth 3
          </button>
          <button
            type="button"
            onClick={() => {
              setSelectedNodeId(null)
              setDirectionFilter('all')
            }}
            disabled={!selectedNodeId}
          >
            Clear selection
          </button>
          </div>
          <div className="board-legend">
            <span className="legend-item">
              <span className="legend-swatch legend-swatch-neutral" />
              Neutral edge
            </span>
            <span className="legend-item">
              <span className="legend-swatch legend-swatch-import" />
              Incoming (import)
            </span>
            <span className="legend-item">
              <span className="legend-swatch legend-swatch-export" />
              Outgoing (export)
            </span>
            <span className="legend-note">
              Colors are directional when selected; `trunk-only` keeps channels aggregated.
            </span>
          </div>
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
                    routingStyle === 'classic' ? `${selectedNodeId ?? 'none'}-${directionFilter}` : 'stable'
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
        </section>
      )}
    </main>
  )
}

export default App
