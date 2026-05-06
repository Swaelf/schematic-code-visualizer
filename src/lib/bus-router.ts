import type { Edge, Node } from '@xyflow/react'
import type { RoutingStyle } from './graph-builder'

export type Point = { x: number; y: number }

export type BusRoute = {
  points: Point[]
  segmentIds: string[]
  logicalEdgeIds: string[]
  lane: number
  laneCount: number
  pairKey: string
  pairCount: number
  isPairPrimary: boolean
  isCrossFolder: boolean
  sourceBlockId: string
  targetBlockId: string
}

export type FolderPinSet = {
  exports: number[]
  imports: number[]
}

export type BusRouteIndex = {
  routesByEdgeId: Map<string, BusRoute>
  segmentLogicalIds: Map<string, Set<string>>
  pinsByFolderId: Map<string, FolderPinSet>
}

export type BusRouterInput = {
  visibleNodes: Node[]
  visibleEdges: Edge[]
  fileNodeToBlockId: Map<string, string>
  routingStyle: RoutingStyle
}

type Rect = { x: number; y: number; width: number; height: number }

type ResolvedRouting = {
  sourceLeafFolderId: string
  targetLeafFolderId: string
  sourceRouteFolderId: string
  targetRouteFolderId: string
  lcaFolderId: string | null
}

const EMPTY_INDEX: BusRouteIndex = {
  routesByEdgeId: new Map(),
  segmentLogicalIds: new Map(),
  pinsByFolderId: new Map(),
}

export function computeBusRoutes(input: BusRouterInput): BusRouteIndex {
  const { visibleNodes, visibleEdges, fileNodeToBlockId, routingStyle } = input

  if (routingStyle !== 'bus') {
    return EMPTY_INDEX
  }

  const nodeById = new Map(visibleNodes.map((node) => [node.id, node]))
  const parentById = new Map<string, string>()
  for (const node of visibleNodes) {
    if (node.parentId) {
      parentById.set(node.id, node.parentId)
    }
  }
  const folderNodeIds = new Set(
    visibleNodes.filter((node) => node.id.startsWith('block:')).map((node) => node.id),
  )

  const absoluteRectById = new Map<string, Rect>()
  const getAbsoluteRect = (nodeId: string): Rect | null => {
    const cached = absoluteRectById.get(nodeId)
    if (cached) return cached
    const node = nodeById.get(nodeId)
    if (!node) return null
    const width = Number(node.style?.width ?? 0)
    const height = Number(node.style?.height ?? 0)
    let rect: Rect
    if (!node.parentId) {
      rect = { x: node.position.x, y: node.position.y, width, height }
    } else {
      const parentRect = getAbsoluteRect(node.parentId)
      if (!parentRect) return null
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

  const siblingsByFolderId = new Map<string, Rect[]>()
  for (const node of visibleNodes) {
    if (!node.parentId) continue
    const rect = absoluteRectById.get(node.id)
    if (!rect) continue
    const list = siblingsByFolderId.get(node.parentId)
    if (list) list.push(rect)
    else siblingsByFolderId.set(node.parentId, [rect])
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
  const roundPoint = (value: number) => Math.round(value * 10) / 10
  const segmentIdFromPoints = (
    sourceBlockId: string,
    targetBlockId: string,
    pairKey: string,
    from: Point,
    to: Point,
  ) =>
    [
      'seg',
      sourceBlockId,
      targetBlockId,
      pairKey,
      `${roundPoint(from.x)}:${roundPoint(from.y)}`,
      `${roundPoint(to.x)}:${roundPoint(to.y)}`,
    ].join('|')

  const routingFolderByEdgeId = new Map<string, ResolvedRouting>()
  const resolveRoutingFolders = (edge: Edge): ResolvedRouting => {
    const cached = routingFolderByEdgeId.get(edge.id)
    if (cached) return cached
    const sourceLeafFolderId = fileNodeToBlockId.get(edge.source) ?? edge.source
    const targetLeafFolderId = fileNodeToBlockId.get(edge.target) ?? edge.target
    const lcaFolderId = findFolderLca(sourceLeafFolderId, targetLeafFolderId)
    const sourceRouteFolderId = lcaFolderId
      ? getChildUnderAncestor(sourceLeafFolderId, lcaFolderId)
      : sourceLeafFolderId
    const targetRouteFolderId = lcaFolderId
      ? getChildUnderAncestor(targetLeafFolderId, lcaFolderId)
      : targetLeafFolderId
    const resolved: ResolvedRouting = {
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
    if (sourceBlockId === targetBlockId) {
      // Intra-folder (Phase 1): each file-pair has its own lane group.
      return `intra:${edge.source}->${edge.target}`
    }
    // Cross-folder (Phase 2): each logical edge stands alone with hierarchical routing.
    return `cross:${edge.id}`
  }

  const laneInfoByEdgeId = new Map<string, { lane: number; laneCount: number; pairKey: string }>()
  const pairMetaByKey = new Map<string, { count: number; primaryEdgeId: string }>()
  const logicalEdgeIdsByPair = new Map<string, string[]>()

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

  // Phase 2: pin registration per ancestor folder along source/target chains.
  // Phase 3: pin Y assignment is driven by linked-child Y to reduce crossings, computed
  //          bottom-up by folder depth.
  const exportPinEdgesByFolderId = new Map<string, string[]>()
  const importPinEdgesByFolderId = new Map<string, string[]>()
  const sourceChainByEdgeId = new Map<string, string[]>()
  const targetChainByEdgeId = new Map<string, string[]>()
  const sourceFileCYByEdgeId = new Map<string, number>()
  const targetFileCYByEdgeId = new Map<string, number>()
  for (const edge of visibleEdges) {
    if (!edge.source.startsWith('file:') || !edge.target.startsWith('file:')) continue
    const routed = resolveRoutingFolders(edge)
    if (routed.sourceLeafFolderId === routed.targetLeafFolderId) continue
    if (!routed.lcaFolderId) continue
    const sourceFileRect = absoluteRectById.get(edge.source)
    const targetFileRect = absoluteRectById.get(edge.target)
    if (!sourceFileRect || !targetFileRect) continue
    sourceFileCYByEdgeId.set(edge.id, sourceFileRect.y + sourceFileRect.height / 2)
    targetFileCYByEdgeId.set(edge.id, targetFileRect.y + targetFileRect.height / 2)

    const sourceChain: string[] = []
    let cur: string | undefined = routed.sourceLeafFolderId
    while (cur && cur !== routed.lcaFolderId) {
      sourceChain.push(cur)
      const list = exportPinEdgesByFolderId.get(cur) ?? []
      list.push(edge.id)
      exportPinEdgesByFolderId.set(cur, list)
      const parent = parentById.get(cur)
      if (!parent) break
      cur = parent
    }
    sourceChainByEdgeId.set(edge.id, sourceChain)

    const targetChain: string[] = []
    cur = routed.targetLeafFolderId
    while (cur && cur !== routed.lcaFolderId) {
      targetChain.push(cur)
      const list = importPinEdgesByFolderId.get(cur) ?? []
      list.push(edge.id)
      importPinEdgesByFolderId.set(cur, list)
      const parent = parentById.get(cur)
      if (!parent) break
      cur = parent
    }
    targetChainByEdgeId.set(edge.id, targetChain)
  }

  const folderDepthByFolderId = new Map<string, number>()
  const computeFolderDepth = (folderId: string): number => {
    const cached = folderDepthByFolderId.get(folderId)
    if (cached != null) return cached
    let depth = 0
    let cur: string | undefined = folderId
    while (cur) {
      const parent = parentById.get(cur)
      if (!parent) break
      depth += 1
      cur = parent
    }
    folderDepthByFolderId.set(folderId, depth)
    return depth
  }

  const pinYFor = (folderRect: Rect, index: number, total: number): number => {
    if (total <= 0) return folderRect.y + folderRect.height / 2
    const pad = 16
    const usable = Math.max(8, folderRect.height - 2 * pad)
    return folderRect.y + pad + ((index + 0.5) / total) * usable
  }

  // Bottom-up Y assignment for export pins (source-side chain).
  // Incoming Y at folder F for edge e =
  //   - source file's CY when F is the leaf source folder for e
  //   - F's source-chain child's export pin Y (already computed) otherwise.
  const exportPinYByFolderId = new Map<string, Map<string, number>>()
  const sortedSourceFolders = [...exportPinEdgesByFolderId.keys()].sort(
    (a, b) => computeFolderDepth(b) - computeFolderDepth(a),
  )
  for (const folderId of sortedSourceFolders) {
    const folderRect = absoluteRectById.get(folderId)
    const edgeIds = exportPinEdgesByFolderId.get(folderId) ?? []
    if (!folderRect || edgeIds.length === 0) continue
    const incomingY = new Map<string, number>()
    for (const edgeId of edgeIds) {
      const chain = sourceChainByEdgeId.get(edgeId) ?? []
      const idx = chain.indexOf(folderId)
      if (idx < 0) continue
      if (idx === 0) {
        incomingY.set(edgeId, sourceFileCYByEdgeId.get(edgeId) ?? folderRect.y + folderRect.height / 2)
      } else {
        const prevFolderId = chain[idx - 1]
        const prevY = exportPinYByFolderId.get(prevFolderId)?.get(edgeId)
        incomingY.set(edgeId, prevY ?? folderRect.y + folderRect.height / 2)
      }
    }
    const sortedEdges = [...edgeIds].sort((a, b) => {
      const ay = incomingY.get(a) ?? 0
      const by = incomingY.get(b) ?? 0
      if (ay !== by) return ay - by
      return a.localeCompare(b)
    })
    const yMap = new Map<string, number>()
    sortedEdges.forEach((edgeId, rank) => {
      yMap.set(edgeId, pinYFor(folderRect, rank, sortedEdges.length))
    })
    exportPinYByFolderId.set(folderId, yMap)
  }

  // Same on target side: outgoing Y at F = next-deeper level's import pin Y, or target file CY at leaf.
  const importPinYByFolderId = new Map<string, Map<string, number>>()
  const sortedTargetFolders = [...importPinEdgesByFolderId.keys()].sort(
    (a, b) => computeFolderDepth(b) - computeFolderDepth(a),
  )
  for (const folderId of sortedTargetFolders) {
    const folderRect = absoluteRectById.get(folderId)
    const edgeIds = importPinEdgesByFolderId.get(folderId) ?? []
    if (!folderRect || edgeIds.length === 0) continue
    const outgoingY = new Map<string, number>()
    for (const edgeId of edgeIds) {
      const chain = targetChainByEdgeId.get(edgeId) ?? []
      const idx = chain.indexOf(folderId)
      if (idx < 0) continue
      if (idx === 0) {
        outgoingY.set(edgeId, targetFileCYByEdgeId.get(edgeId) ?? folderRect.y + folderRect.height / 2)
      } else {
        const childFolderId = chain[idx - 1]
        const childY = importPinYByFolderId.get(childFolderId)?.get(edgeId)
        outgoingY.set(edgeId, childY ?? folderRect.y + folderRect.height / 2)
      }
    }
    const sortedEdges = [...edgeIds].sort((a, b) => {
      const ay = outgoingY.get(a) ?? 0
      const by = outgoingY.get(b) ?? 0
      if (ay !== by) return ay - by
      return a.localeCompare(b)
    })
    const yMap = new Map<string, number>()
    sortedEdges.forEach((edgeId, rank) => {
      yMap.set(edgeId, pinYFor(folderRect, rank, sortedEdges.length))
    })
    importPinYByFolderId.set(folderId, yMap)
  }

  const getExportPinPoint = (folderId: string, edgeId: string): Point | null => {
    const folderRect = absoluteRectById.get(folderId)
    const y = exportPinYByFolderId.get(folderId)?.get(edgeId)
    if (!folderRect || y == null) return null
    return { x: folderRect.x + folderRect.width, y }
  }
  const getImportPinPoint = (folderId: string, edgeId: string): Point | null => {
    const folderRect = absoluteRectById.get(folderId)
    const y = importPinYByFolderId.get(folderId)?.get(edgeId)
    if (!folderRect || y == null) return null
    return { x: folderRect.x, y }
  }

  const rectsOverlapX = (rect: Rect, x1: number, x2: number) => {
    const xmin = Math.min(x1, x2)
    const xmax = Math.max(x1, x2)
    return rect.x < xmax && rect.x + rect.width > xmin
  }

  const yIntersectsRect = (y: number, rect: Rect) => y >= rect.y && y <= rect.y + rect.height

  const pickTrunkYInRange = (
    candidate: number,
    x1: number,
    x2: number,
    obstacles: Rect[],
    interiorTop: number,
    interiorBottom: number,
  ): number => {
    const margin = 8
    let y = candidate
    for (let attempt = 0; attempt < 6; attempt += 1) {
      let blocker: Rect | null = null
      for (const r of obstacles) {
        if (!rectsOverlapX(r, x1, x2)) continue
        if (yIntersectsRect(y, r)) {
          blocker = r
          break
        }
      }
      if (!blocker) {
        return Math.max(interiorTop, Math.min(interiorBottom, y))
      }
      const above = blocker.y - margin
      const below = blocker.y + blocker.height + margin
      y = Math.abs(above - candidate) <= Math.abs(below - candidate) ? above : below
    }
    return Math.max(interiorTop, Math.min(interiorBottom, y))
  }

  // Generic 6-point orthogonal channel router inside `containerRect`.
  // `sourcePoint` is where the wire exits going +X; `targetPoint` is where it arrives from -X.
  // `obstacles` should already exclude any rects the wire is "leaving" (source/target rects).
  const routeChannel = (
    sourcePoint: Point,
    targetPoint: Point,
    containerRect: Rect,
    obstacles: Rect[],
    laneShift: number,
  ): Point[] => {
    const stub = 8
    const interiorTop = containerRect.y + 12
    const interiorBottom = containerRect.y + containerRect.height - 12
    const interiorLeft = containerRect.x + 6
    const interiorRight = containerRect.x + containerRect.width - 6
    const cleanLeftToRight = sourcePoint.x + stub + 4 < targetPoint.x - stub

    if (cleanLeftToRight) {
      const riserSourceX = Math.min(interiorRight, sourcePoint.x + stub)
      const riserTargetX = Math.max(interiorLeft, targetPoint.x - stub)
      const xmin = Math.min(riserSourceX, riserTargetX)
      const xmax = Math.max(riserSourceX, riserTargetX)
      const candidate = (sourcePoint.y + targetPoint.y) / 2 + laneShift
      const trunkY = pickTrunkYInRange(candidate, xmin, xmax, obstacles, interiorTop, interiorBottom)
      return [
        sourcePoint,
        { x: riserSourceX, y: sourcePoint.y },
        { x: riserSourceX, y: trunkY },
        { x: riserTargetX, y: trunkY },
        { x: riserTargetX, y: targetPoint.y },
        targetPoint,
      ]
    }

    // Detour: target is at or to the left of source. Loop above/below both endpoints.
    const minY = Math.min(sourcePoint.y, targetPoint.y)
    const maxY = Math.max(sourcePoint.y, targetPoint.y)
    const spaceAbove = minY - interiorTop
    const spaceBelow = interiorBottom - maxY
    const detourTop = spaceAbove >= spaceBelow
    const detourMargin = stub + 6
    const rawDetourY = detourTop ? minY - detourMargin : maxY + detourMargin
    const riserSourceX = Math.min(interiorRight, sourcePoint.x + stub)
    const riserTargetX = Math.max(interiorLeft, targetPoint.x - stub)
    const xmin = Math.min(riserSourceX, riserTargetX)
    const xmax = Math.max(riserSourceX, riserTargetX)
    const detourY = pickTrunkYInRange(rawDetourY + laneShift, xmin, xmax, obstacles, interiorTop, interiorBottom)
    return [
      sourcePoint,
      { x: riserSourceX, y: sourcePoint.y },
      { x: riserSourceX, y: detourY },
      { x: riserTargetX, y: detourY },
      { x: riserTargetX, y: targetPoint.y },
      targetPoint,
    ]
  }

  const routeIntraFolder = (
    sourceRect: Rect,
    targetRect: Rect,
    folderRect: Rect,
    siblings: Rect[],
    laneShift: number,
  ): Point[] => {
    const sourcePoint: Point = {
      x: sourceRect.x + sourceRect.width,
      y: sourceRect.y + sourceRect.height / 2,
    }
    const targetPoint: Point = { x: targetRect.x, y: targetRect.y + targetRect.height / 2 }
    const obstacles = siblings.filter((rect) => rect !== sourceRect && rect !== targetRect)
    return routeChannel(sourcePoint, targetPoint, folderRect, obstacles, laneShift)
  }

  // Phase 2: hierarchical cross-folder routing.
  // Decomposes the wire into per-level segments inside each ancestor folder.
  // Returns null when any required pin/rect can't be resolved — caller should fall back.
  const routeCrossFolderHierarchical = (
    edge: Edge,
    sourceFileRect: Rect,
    targetFileRect: Rect,
    routed: ResolvedRouting,
    laneShift: number,
  ): Point[] | null => {
    const lca = routed.lcaFolderId
    if (!lca) return null
    const lcaRect = absoluteRectById.get(lca)
    if (!lcaRect) return null

    const sourceChain: string[] = []
    {
      let cur: string | undefined = routed.sourceLeafFolderId
      while (cur && cur !== lca) {
        sourceChain.push(cur)
        const parent = parentById.get(cur)
        if (!parent) break
        cur = parent
      }
    }
    const targetChain: string[] = []
    {
      let cur: string | undefined = routed.targetLeafFolderId
      while (cur && cur !== lca) {
        targetChain.push(cur)
        const parent = parentById.get(cur)
        if (!parent) break
        cur = parent
      }
    }
    if (sourceChain.length === 0 || targetChain.length === 0) return null
    const lcaSourceChild = sourceChain[sourceChain.length - 1]
    const lcaTargetChild = targetChain[targetChain.length - 1]

    const sourceFilePoint: Point = {
      x: sourceFileRect.x + sourceFileRect.width,
      y: sourceFileRect.y + sourceFileRect.height / 2,
    }
    const targetFilePoint: Point = {
      x: targetFileRect.x,
      y: targetFileRect.y + targetFileRect.height / 2,
    }

    const out: Point[] = []
    const appendPath = (segPoints: Point[]) => {
      if (segPoints.length === 0) return
      if (out.length === 0) {
        out.push(...segPoints)
        return
      }
      const last = out[out.length - 1]
      const first = segPoints[0]
      const isSame = Math.abs(last.x - first.x) < 0.01 && Math.abs(last.y - first.y) < 0.01
      out.push(...(isSame ? segPoints.slice(1) : segPoints))
    }

    // Source side: leaf → ... → lcaSourceChild (each level's export pin is its target).
    for (let i = 0; i < sourceChain.length; i += 1) {
      const folderId = sourceChain[i]
      const folderRect = absoluteRectById.get(folderId)
      const exportPin = getExportPinPoint(folderId, edge.id)
      if (!folderRect || !exportPin) return null

      let levelSource: Point
      let excludeRect: Rect | null
      if (i === 0) {
        levelSource = sourceFilePoint
        excludeRect = sourceFileRect
      } else {
        const prevId = sourceChain[i - 1]
        const prevRect = absoluteRectById.get(prevId)
        const prevPin = getExportPinPoint(prevId, edge.id)
        if (!prevRect || !prevPin) return null
        levelSource = prevPin
        excludeRect = prevRect
      }
      const obstacles = (siblingsByFolderId.get(folderId) ?? []).filter((r) => r !== excludeRect)
      appendPath(routeChannel(levelSource, exportPin, folderRect, obstacles, laneShift))
    }

    // LCA: lcaSourceChild's export pin → lcaTargetChild's import pin.
    const lcaSourceChildRect = absoluteRectById.get(lcaSourceChild)
    const lcaTargetChildRect = absoluteRectById.get(lcaTargetChild)
    const lcaSourcePin = getExportPinPoint(lcaSourceChild, edge.id)
    const lcaTargetPin = getImportPinPoint(lcaTargetChild, edge.id)
    if (!lcaSourceChildRect || !lcaTargetChildRect || !lcaSourcePin || !lcaTargetPin) return null
    const lcaObstacles = (siblingsByFolderId.get(lca) ?? []).filter(
      (r) => r !== lcaSourceChildRect && r !== lcaTargetChildRect,
    )
    appendPath(routeChannel(lcaSourcePin, lcaTargetPin, lcaRect, lcaObstacles, laneShift))

    // Target side: walked from leaf upward into targetChain, but path goes top→leaf.
    // targetChain[length-1] = lcaTargetChild; targetChain[0] = leaf. Iterate descending index.
    for (let i = targetChain.length - 1; i >= 0; i -= 1) {
      const folderId = targetChain[i]
      const folderRect = absoluteRectById.get(folderId)
      const importPin = getImportPinPoint(folderId, edge.id)
      if (!folderRect || !importPin) return null

      let levelTarget: Point
      let excludeRect: Rect | null
      if (i === 0) {
        levelTarget = targetFilePoint
        excludeRect = targetFileRect
      } else {
        const childId = targetChain[i - 1]
        const childRect = absoluteRectById.get(childId)
        const childPin = getImportPinPoint(childId, edge.id)
        if (!childRect || !childPin) return null
        levelTarget = childPin
        excludeRect = childRect
      }
      const obstacles = (siblingsByFolderId.get(folderId) ?? []).filter((r) => r !== excludeRect)
      appendPath(routeChannel(importPin, levelTarget, folderRect, obstacles, laneShift))
    }

    return out.length >= 2 ? out : null
  }

  const buildPoints = (edge: Edge): BusRoute | null => {
    if (!edge.source.startsWith('file:') || !edge.target.startsWith('file:')) {
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
    const laneShiftForGeometry = laneShift
    const isPairPrimary = pairMeta?.primaryEdgeId === edge.id
    const logicalEdgeIds = logicalEdgeIdsByPair.get(pairKey) ?? [edge.id]

    const sourcePoint = { x: sourceRect.x + sourceRect.width, y: sourceRect.y + sourceRect.height / 2 }
    const targetPoint = { x: targetRect.x, y: targetRect.y + targetRect.height / 2 }
    const sourceExportBusY = sourceBlockRect.y + sourceBlockRect.height - 16
    const targetImportBusY = targetBlockRect.y + 16
    const sourceBoundaryPin = { x: sourceBlockRect.x + sourceBlockRect.width + 5, y: sourceExportBusY }
    const targetBoundaryPin = { x: targetBlockRect.x - 5, y: targetImportBusY }
    const trunkY = sourceExportBusY + (targetImportBusY - sourceExportBusY) * 0.5
    const sourceTrunkX = sourceBoundaryPin.x + 12
    const targetTrunkX = targetBoundaryPin.x - 12
    const sourceBranchX = sourceBoundaryPin.x + 20 + laneShiftForGeometry
    const targetBranchX = targetBoundaryPin.x - 20 + laneShiftForGeometry
    const isCrossFolder = sourceBlockId !== targetBlockId

    const fallbackTrunkPoints: Point[] = [
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

    let points: Point[]
    if (!isCrossFolder) {
      points = routeIntraFolder(
        sourceRect,
        targetRect,
        sourceBlockRect,
        siblingsByFolderId.get(sourceBlockId) ?? [],
        laneShiftForGeometry,
      )
    } else {
      points =
        routeCrossFolderHierarchical(edge, sourceRect, targetRect, routed, laneShiftForGeometry) ??
        fallbackTrunkPoints
    }

    const segmentIds: string[] = []
    for (let index = 0; index < points.length - 1; index += 1) {
      segmentIds.push(segmentIdFromPoints(sourceBlockId, targetBlockId, pairKey, points[index], points[index + 1]))
    }

    return {
      points,
      segmentIds,
      logicalEdgeIds,
      lane,
      laneCount,
      pairKey,
      pairCount: pairMeta?.count ?? laneCount,
      isPairPrimary,
      isCrossFolder,
      sourceBlockId,
      targetBlockId,
    }
  }

  const routesByEdgeId = new Map<string, BusRoute>()
  const segmentLogicalIds = new Map<string, Set<string>>()
  for (const edge of visibleEdges) {
    const route = buildPoints(edge)
    if (!route) continue
    routesByEdgeId.set(edge.id, route)
    for (const segmentId of route.segmentIds) {
      const existing = segmentLogicalIds.get(segmentId)
      if (existing) {
        for (const logicalEdgeId of route.logicalEdgeIds) existing.add(logicalEdgeId)
      } else {
        segmentLogicalIds.set(segmentId, new Set(route.logicalEdgeIds))
      }
    }
  }

  const pinsByFolderId = new Map<string, FolderPinSet>()
  const ensurePinSet = (folderId: string): FolderPinSet => {
    const existing = pinsByFolderId.get(folderId)
    if (existing) return existing
    const created: FolderPinSet = { exports: [], imports: [] }
    pinsByFolderId.set(folderId, created)
    return created
  }
  for (const [folderId, yMap] of exportPinYByFolderId) {
    const folderRect = absoluteRectById.get(folderId)
    if (!folderRect || yMap.size === 0) continue
    const localYs = [...yMap.values()].map((y) => y - folderRect.y).sort((a, b) => a - b)
    ensurePinSet(folderId).exports = localYs
  }
  for (const [folderId, yMap] of importPinYByFolderId) {
    const folderRect = absoluteRectById.get(folderId)
    if (!folderRect || yMap.size === 0) continue
    const localYs = [...yMap.values()].map((y) => y - folderRect.y).sort((a, b) => a - b)
    ensurePinSet(folderId).imports = localYs
  }

  return { routesByEdgeId, segmentLogicalIds, pinsByFolderId }
}
