import { Position, type Edge, type Node, type XYPosition } from '@xyflow/react'
import type { DependencyGraph, ScannedProject, TreeNode } from './models'

const BLOCK_HEADER_HEIGHT = 38
const FILE_NODE_WIDTH = 240
const FILE_NODE_HEIGHT = 90
const FILE_NODE_GAP_X = 24
const FILE_NODE_GAP_Y = 18
const BLOCK_PADDING = 18
const BLOCK_CONTENT_BOTTOM_PADDING = 26
const BLOCK_GAP_X = 24
const BLOCK_GAP_Y = 24
const BLOCK_COLUMNS = 3

export type GraphBuildMode = 'file-level' | 'inter-block'
export type RoutingStyle = 'classic' | 'bus'
export type FolderPackingMode = 'balanced' | 'dense'

export type BuiltGraph = {
  nodes: Node[]
  edges: Edge[]
  blockCount: number
  blockLayoutEdges: Array<{ source: string; target: string }>
  cycleEdgeCount: number
}

type GraphOptions = {
  highlightCycles?: boolean
  routingStyle?: RoutingStyle
  folderPacking?: FolderPackingMode
}

type ConnectionItem = {
  source: string
  target: string
  count: number
}

type TopLevelBlockInfo = {
  id: string
  label: string
  files: string[]
}

type FolderInfo = {
  id: string
  label: string
  relativePath: string
  parentId?: string
  childFolderIds: string[]
  filePaths: string[]
}

type FolderLayout = {
  width: number
  height: number
  itemPositions: Map<string, XYPosition>
}

function toFolderId(relativeDirectoryPath: string) {
  return relativeDirectoryPath ? `block:${relativeDirectoryPath}` : 'block:(root)'
}

function getRelativePath(path: string, rootName: string) {
  const prefix = `${rootName}/`
  if (path.startsWith(prefix)) {
    return path.slice(prefix.length)
  }
  return path
}

function getRelativeDirectoryPath(path: string, rootName: string) {
  const relativePath = getRelativePath(path, rootName)
  const lastSlashIndex = relativePath.lastIndexOf('/')
  return lastSlashIndex >= 0 ? relativePath.slice(0, lastSlashIndex) : ''
}

function getTopLevelBlockLabel(path: string, rootName: string) {
  const relativePath = getRelativePath(path, rootName)
  const [firstSegment] = relativePath.split('/')
  return firstSegment || '(root)'
}

function createTopLevelBlocks(project: ScannedProject) {
  const blockMap = new Map<string, TopLevelBlockInfo>()

  for (const file of project.files) {
    const label = getTopLevelBlockLabel(file.path, project.rootName)
    const id = `block:${label}`
    const existing = blockMap.get(id)
    if (existing) {
      existing.files.push(file.path)
    } else {
      blockMap.set(id, { id, label, files: [file.path] })
    }
  }

  return [...blockMap.values()].sort((left, right) => left.label.localeCompare(right.label))
}

type PackedItems = {
  positions: Map<string, XYPosition>
  contentWidth: number
  contentHeight: number
}

type PackingItem = { id: string; width: number; height: number }

function packRows(items: PackingItem[], targetWidth: number, gapX: number, gapY: number): PackedItems {
  const rows: Array<{ items: PackingItem[]; widthUsed: number; height: number }> = []

  for (const item of items) {
    let bestRowIndex = -1
    let bestRemaining = Number.POSITIVE_INFINITY

    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index]
      const nextWidth = row.widthUsed + (row.items.length > 0 ? gapX : 0) + item.width
      if (nextWidth <= targetWidth) {
        const remaining = targetWidth - nextWidth
        if (remaining < bestRemaining) {
          bestRemaining = remaining
          bestRowIndex = index
        }
      }
    }

    if (bestRowIndex >= 0) {
      const row = rows[bestRowIndex]
      row.widthUsed += (row.items.length > 0 ? gapX : 0) + item.width
      row.height = Math.max(row.height, item.height)
      row.items.push(item)
    } else {
      rows.push({
        items: [item],
        widthUsed: item.width,
        height: item.height,
      })
    }
  }

  const positions = new Map<string, XYPosition>()
  let y = 0
  let contentWidth = 0
  for (const row of rows) {
    let x = 0
    for (const item of row.items) {
      positions.set(item.id, { x, y })
      x += item.width + gapX
    }
    contentWidth = Math.max(contentWidth, row.widthUsed)
    y += row.height + gapY
  }

  const contentHeight = rows.length > 0 ? y - gapY : 0
  return { positions, contentWidth, contentHeight }
}

function packItems(
  items: Array<{ id: string; width: number; height: number }>,
  gapX: number,
  gapY: number,
  mode: FolderPackingMode = 'balanced',
): PackedItems {
  const positions = new Map<string, XYPosition>()
  if (items.length === 0) {
    return { positions, contentWidth: 180, contentHeight: 40 }
  }

  const sortedItems =
    mode === 'dense'
      ? [...items].sort((left, right) => right.height - left.height || right.width - left.width || left.id.localeCompare(right.id))
      : [...items]

  const totalArea = sortedItems.reduce((sum, item) => sum + (item.width + gapX) * (item.height + gapY), 0)
  const maxWidth = sortedItems.reduce((max, item) => Math.max(max, item.width), 0)
  const sqrtWidth = Math.sqrt(totalArea)
  const widthCandidates = [
    Math.max(maxWidth, sqrtWidth * 0.92),
    Math.max(maxWidth, sqrtWidth * 1.02),
    Math.max(maxWidth, sqrtWidth * 1.12),
    Math.max(maxWidth, sqrtWidth * 1.24),
    Math.max(maxWidth, sqrtWidth * 1.38),
  ]

  let bestPacked: PackedItems | null = null
  let bestScore = Number.POSITIVE_INFINITY
  for (const candidateWidth of widthCandidates) {
    const packed = packRows(sortedItems, candidateWidth, gapX, gapY)
    const areaScore = packed.contentWidth * packed.contentHeight
    const ratioPenalty = Math.abs(packed.contentWidth - packed.contentHeight) * (mode === 'dense' ? 0.18 : 0.32)
    const score = areaScore + ratioPenalty * Math.sqrt(totalArea)
    if (score < bestScore) {
      bestScore = score
      bestPacked = packed
    }
  }

  return bestPacked ?? { positions, contentWidth: 180, contentHeight: 40 }
}

function collectHierarchicalFolders(project: ScannedProject) {
  const folderById = new Map<string, FolderInfo>()
  const filePathsByRelativeDir = new Map<string, string[]>()

  for (const file of project.files) {
    const relativeDirectoryPath = getRelativeDirectoryPath(file.path, project.rootName)
    const existing = filePathsByRelativeDir.get(relativeDirectoryPath)
    if (existing) {
      existing.push(file.path)
    } else {
      filePathsByRelativeDir.set(relativeDirectoryPath, [file.path])
    }
  }

  function walk(node: TreeNode, parentRelativePath: string | null) {
    if (node.type !== 'directory') {
      return
    }
    const currentRelativePath = getRelativePath(node.path, project.rootName)
    const isRoot = currentRelativePath === ''

    if (!isRoot) {
      const id = toFolderId(currentRelativePath)
      const parentId = parentRelativePath ? toFolderId(parentRelativePath) : undefined
      folderById.set(id, {
        id,
        label: node.name,
        relativePath: currentRelativePath,
        parentId,
        childFolderIds: [],
        filePaths: [],
      })
      if (parentId) {
        const parent = folderById.get(parentId)
        if (parent) {
          parent.childFolderIds.push(id)
        }
      }
    }

    for (const child of node.children ?? []) {
      if (child.type === 'directory') {
        walk(child, isRoot ? '' : currentRelativePath)
      }
    }
  }

  walk(project.tree, null)

  for (const folder of folderById.values()) {
    folder.filePaths = [...(filePathsByRelativeDir.get(folder.relativePath) ?? [])].sort((a, b) => a.localeCompare(b))
    folder.childFolderIds.sort((a, b) => {
      const left = folderById.get(a)?.label ?? a
      const right = folderById.get(b)?.label ?? b
      return left.localeCompare(right)
    })
  }

  if ((filePathsByRelativeDir.get('') ?? []).length > 0) {
    const rootFolderId = toFolderId('')
    folderById.set(rootFolderId, {
      id: rootFolderId,
      label: '(root)',
      relativePath: '',
      parentId: undefined,
      childFolderIds: [],
      filePaths: [...(filePathsByRelativeDir.get('') ?? [])].sort((a, b) => a.localeCompare(b)),
    })
  }

  const topLevelFolderIds = [...folderById.values()]
    .filter((folder) => !folder.parentId)
    .map((folder) => folder.id)
    .sort((left, right) => {
      const leftLabel = folderById.get(left)?.label ?? left
      const rightLabel = folderById.get(right)?.label ?? right
      return leftLabel.localeCompare(rightLabel)
    })

  return { folderById, topLevelFolderIds }
}

function createHierarchicalFileLevelNodes(
  project: ScannedProject,
  dependencyGraph: DependencyGraph,
  cycleFileNodeIds: Set<string>,
  cycleFolderNodeIds: Set<string>,
  folderPacking: FolderPackingMode,
) {
  const { folderById, topLevelFolderIds } = collectHierarchicalFolders(project)
  const fileAnalysisByPath = new Map(dependencyGraph.files.map((file) => [file.path, file]))
  const parentByFolderId = new Map<string, string>()
  for (const folder of folderById.values()) {
    if (folder.parentId) {
      parentByFolderId.set(folder.id, folder.parentId)
    }
  }

  const fileNodeToBlock = new Map<string, string>()
  for (const folder of folderById.values()) {
    for (const filePath of folder.filePaths) {
      fileNodeToBlock.set(`file:${filePath}`, folder.id)
    }
  }

  const importCountByFolder = new Map<string, number>()
  const exportCountByFolder = new Map<string, number>()
  function incrementAncestors(map: Map<string, number>, folderId: string | undefined) {
    let current = folderId
    while (current) {
      map.set(current, (map.get(current) ?? 0) + 1)
      current = parentByFolderId.get(current)
    }
  }
  for (const edge of dependencyGraph.edges) {
    const sourceFolderId = fileNodeToBlock.get(`file:${edge.fromPath}`)
    const targetFolderId = fileNodeToBlock.get(`file:${edge.toPath}`)
    incrementAncestors(exportCountByFolder, sourceFolderId)
    incrementAncestors(importCountByFolder, targetFolderId)
  }

  const layoutByFolderId = new Map<string, FolderLayout>()
  function computeFolderLayout(folderId: string): FolderLayout {
    const existing = layoutByFolderId.get(folderId)
    if (existing) {
      return existing
    }
    const folder = folderById.get(folderId)
    if (!folder) {
      const fallback: FolderLayout = {
        width: FILE_NODE_WIDTH + BLOCK_PADDING * 2,
        height: FILE_NODE_HEIGHT + BLOCK_PADDING * 2 + BLOCK_HEADER_HEIGHT + BLOCK_CONTENT_BOTTOM_PADDING,
        itemPositions: new Map(),
      }
      layoutByFolderId.set(folderId, fallback)
      return fallback
    }

    const folderItems = folder.childFolderIds.map((childFolderId) => {
      const childLayout = computeFolderLayout(childFolderId)
      return { id: childFolderId, width: childLayout.width, height: childLayout.height }
    })
    const fileItems = folder.filePaths.map((filePath) => ({
      id: `file:${filePath}`,
      width: FILE_NODE_WIDTH,
      height: FILE_NODE_HEIGHT,
    }))
    const items = [...folderItems, ...fileItems]
    const gapX = folderPacking === 'dense' ? Math.max(10, FILE_NODE_GAP_X - 8) : FILE_NODE_GAP_X
    const gapY = folderPacking === 'dense' ? Math.max(8, FILE_NODE_GAP_Y - 7) : FILE_NODE_GAP_Y
    const packed = packItems(items, gapX, gapY, folderPacking)

    const width = Math.max(300, BLOCK_PADDING * 2 + packed.contentWidth)
    const contentTop = BLOCK_PADDING + BLOCK_HEADER_HEIGHT
    const height = Math.max(
      180,
      contentTop + packed.contentHeight + BLOCK_PADDING + BLOCK_CONTENT_BOTTOM_PADDING,
    )

    const layout: FolderLayout = {
      width,
      height,
      itemPositions: packed.positions,
    }
    layoutByFolderId.set(folderId, layout)
    return layout
  }

  for (const folderId of folderById.keys()) {
    computeFolderLayout(folderId)
  }

  const topItems = topLevelFolderIds.map((folderId) => {
    const layout = layoutByFolderId.get(folderId)
    return {
      id: folderId,
      width: layout?.width ?? 300,
      height: layout?.height ?? 180,
    }
  })
  const topGapX = folderPacking === 'dense' ? Math.max(14, BLOCK_GAP_X - 8) : BLOCK_GAP_X
  const topGapY = folderPacking === 'dense' ? Math.max(14, BLOCK_GAP_Y - 8) : BLOCK_GAP_Y
  const topPacked = packItems(topItems, topGapX, topGapY, folderPacking)
  const topLevelPositionById = topPacked.positions

  const nodes: Node[] = []

  function pushFolder(folderId: string, parentId: string | undefined, position: XYPosition) {
    const folder = folderById.get(folderId)
    const layout = layoutByFolderId.get(folderId)
    if (!folder || !layout) {
      return
    }

    const node: Node = {
      id: folder.id,
      type: 'folderBlock',
      position,
      parentId,
      extent: parentId ? 'parent' : undefined,
      data: {
        label: `${folder.label} (${folder.filePaths.length + folder.childFolderIds.length})`,
        importCount: importCountByFolder.get(folder.id) ?? 0,
        exportCount: exportCountByFolder.get(folder.id) ?? 0,
      },
      style: {
        width: layout.width,
        height: layout.height,
        borderRadius: 12,
        border: cycleFolderNodeIds.has(folder.id) ? '2px solid #ff8f8f' : '1px solid #5f90b7',
        background: 'rgba(8, 32, 54, 0.78)',
      },
    }
    nodes.push(node)

    const contentOffsetY = BLOCK_PADDING + BLOCK_HEADER_HEIGHT
    for (const childFolderId of folder.childFolderIds) {
      const childPosition = layout.itemPositions.get(childFolderId)
      if (!childPosition) {
        continue
      }
      pushFolder(childFolderId, folder.id, {
        x: BLOCK_PADDING + childPosition.x,
        y: contentOffsetY + childPosition.y,
      })
    }

    for (const filePath of folder.filePaths) {
      const fileNodeId = `file:${filePath}`
      const filePosition = layout.itemPositions.get(fileNodeId)
      if (!filePosition) {
        continue
      }
      const relativeLabel = getRelativePath(filePath, project.rootName)
      const fileName = relativeLabel.split('/').at(-1) ?? relativeLabel
      const analysis = fileAnalysisByPath.get(filePath)
      nodes.push({
        id: fileNodeId,
        type: 'chipFile',
        parentId: folder.id,
        extent: 'parent',
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        position: {
          x: BLOCK_PADDING + filePosition.x,
          y: contentOffsetY + filePosition.y,
        },
        data: {
          label: fileName,
          path: relativeLabel,
          importCount: analysis?.imports.length ?? 0,
          exportCount: analysis?.exports.length ?? 0,
        },
        style: {
          width: FILE_NODE_WIDTH,
          height: FILE_NODE_HEIGHT,
          borderRadius: 8,
          border: cycleFileNodeIds.has(fileNodeId) ? '2px solid #ff8f8f' : '1px solid #78aacb',
          background: 'rgba(13, 57, 88, 0.85)',
          color: '#e8f5ff',
          fontSize: 12,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          padding: '0 8px',
        },
      })
    }
  }

  for (const folderId of topLevelFolderIds) {
    const position = topLevelPositionById.get(folderId) ?? { x: 0, y: 0 }
    pushFolder(folderId, undefined, position)
  }

  const interBlockConnections = collectInterBlockConnections(dependencyGraph, fileNodeToBlock)
  return {
    nodes,
    fileNodeToBlock,
    blockCount: folderById.size,
    blockLayoutEdges: interBlockConnections.map((connection) => ({ source: connection.source, target: connection.target })),
  }
}

function createTopLevelFileNodes(
  blocks: TopLevelBlockInfo[],
  project: ScannedProject,
  dependencyGraph: DependencyGraph,
  cycleFileNodeIds: Set<string>,
  cycleBlockNodeIds: Set<string>,
) {
  const nodes: Node[] = []
  const fileNodeToBlock = new Map<string, string>()
  const fileAnalysisByPath = new Map(dependencyGraph.files.map((file) => [file.path, file]))
  const importCountByBlock = new Map<string, number>()
  const exportCountByBlock = new Map<string, number>()

  for (const edge of dependencyGraph.edges) {
    const sourceBlockLabel = getTopLevelBlockLabel(edge.fromPath, project.rootName)
    const targetBlockLabel = getTopLevelBlockLabel(edge.toPath, project.rootName)
    const sourceBlockId = `block:${sourceBlockLabel}`
    const targetBlockId = `block:${targetBlockLabel}`
    exportCountByBlock.set(sourceBlockId, (exportCountByBlock.get(sourceBlockId) ?? 0) + 1)
    importCountByBlock.set(targetBlockId, (importCountByBlock.get(targetBlockId) ?? 0) + 1)
  }

  blocks.forEach((block, blockIndex) => {
    const col = blockIndex % BLOCK_COLUMNS
    const row = Math.floor(blockIndex / BLOCK_COLUMNS)
    const files = [...block.files].sort((a, b) => a.localeCompare(b))
    const filesPerRow = Math.max(1, Math.min(3, Math.ceil(Math.sqrt(files.length))))
    const rowCount = Math.ceil(files.length / filesPerRow)
    const blockWidth = BLOCK_PADDING * 2 + filesPerRow * FILE_NODE_WIDTH + (filesPerRow - 1) * FILE_NODE_GAP_X
    const blockHeight =
      BLOCK_PADDING * 2 +
      BLOCK_HEADER_HEIGHT +
      rowCount * FILE_NODE_HEIGHT +
      Math.max(0, rowCount - 1) * FILE_NODE_GAP_Y +
      BLOCK_CONTENT_BOTTOM_PADDING

    nodes.push({
      id: block.id,
      type: 'folderBlock',
      position: {
        x: col * (blockWidth + BLOCK_GAP_X),
        y: row * (blockHeight + BLOCK_GAP_Y),
      },
      data: {
        label: `${block.label} (${files.length})`,
        importCount: importCountByBlock.get(block.id) ?? 0,
        exportCount: exportCountByBlock.get(block.id) ?? 0,
      },
      style: {
        width: blockWidth,
        height: blockHeight,
        borderRadius: 12,
        border: cycleBlockNodeIds.has(block.id) ? '2px solid #ff8f8f' : '1px solid #5f90b7',
        background: 'rgba(8, 32, 54, 0.78)',
      },
    })

    files.forEach((filePath, fileIndex) => {
      const fileCol = fileIndex % filesPerRow
      const fileRow = Math.floor(fileIndex / filesPerRow)
      const relativeLabel = getRelativePath(filePath, project.rootName)
      const fileName = relativeLabel.split('/').at(-1) ?? relativeLabel
      const analysis = fileAnalysisByPath.get(filePath)

      nodes.push({
        id: `file:${filePath}`,
        type: 'chipFile',
        parentId: block.id,
        extent: 'parent',
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        position: {
          x: BLOCK_PADDING + fileCol * (FILE_NODE_WIDTH + FILE_NODE_GAP_X),
          y: BLOCK_PADDING + BLOCK_HEADER_HEIGHT + fileRow * (FILE_NODE_HEIGHT + FILE_NODE_GAP_Y),
        },
        data: {
          label: fileName,
          path: relativeLabel,
          importCount: analysis?.imports.length ?? 0,
          exportCount: analysis?.exports.length ?? 0,
        },
        style: {
          width: FILE_NODE_WIDTH,
          height: FILE_NODE_HEIGHT,
          borderRadius: 8,
          border: cycleFileNodeIds.has(`file:${filePath}`) ? '2px solid #ff8f8f' : '1px solid #78aacb',
          background: 'rgba(13, 57, 88, 0.85)',
          color: '#e8f5ff',
          fontSize: 12,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          padding: '0 8px',
        },
      })

      fileNodeToBlock.set(`file:${filePath}`, block.id)
    })
  })

  return { nodes, fileNodeToBlock }
}

function createFileEdges(
  dependencyGraph: DependencyGraph,
  fileNodeToBlock: Map<string, string>,
  cycleEdgeKeys: Set<string>,
  highlightCycles: boolean,
  routingStyle: RoutingStyle,
): Edge[] {
  const laneCounterByBus = new Map<string, number>()
  const countByBus = new Map<string, number>()

  for (const edge of dependencyGraph.edges) {
    const sourceBlock = fileNodeToBlock.get(`file:${edge.fromPath}`) ?? 'unknown'
    const targetBlock = fileNodeToBlock.get(`file:${edge.toPath}`) ?? 'unknown'
    const busKey = `${sourceBlock}->${targetBlock}`
    countByBus.set(busKey, (countByBus.get(busKey) ?? 0) + 1)
  }

  return dependencyGraph.edges.map((edge) => {
    const sourceBlock = fileNodeToBlock.get(`file:${edge.fromPath}`) ?? 'unknown'
    const targetBlock = fileNodeToBlock.get(`file:${edge.toPath}`) ?? 'unknown'
    const busKey = `${sourceBlock}->${targetBlock}`
    const lane = laneCounterByBus.get(busKey) ?? 0
    laneCounterByBus.set(busKey, lane + 1)

    return {
      id: `edge:file:${edge.fromPath}->${edge.toPath}`,
      type: routingStyle === 'bus' ? 'bus' : undefined,
      source: `file:${edge.fromPath}`,
      target: `file:${edge.toPath}`,
      animated: false,
      markerEnd: { type: 'arrowclosed', color: '#7ea3bd' },
      style: cycleEdgeKeys.has(`${edge.fromPath}->${edge.toPath}`) && highlightCycles
        ? { stroke: '#ff9898', strokeWidth: 2.4 }
        : { stroke: '#7ea3bd', strokeWidth: 1.4 },
      data: routingStyle === 'bus' ? { busLane: lane, busCount: countByBus.get(busKey) ?? 1 } : undefined,
    }
  })
}

function collectInterBlockConnections(
  dependencyGraph: DependencyGraph,
  fileNodeToBlock: Map<string, string>,
) {
  const edgeCountByBlockPair = new Map<string, ConnectionItem>()

  for (const edge of dependencyGraph.edges) {
    const sourceNodeId = `file:${edge.fromPath}`
    const targetNodeId = `file:${edge.toPath}`
    const sourceBlock = fileNodeToBlock.get(sourceNodeId)
    const targetBlock = fileNodeToBlock.get(targetNodeId)

    if (!sourceBlock || !targetBlock || sourceBlock === targetBlock) {
      continue
    }

    const key = `${sourceBlock}->${targetBlock}`
    const existing = edgeCountByBlockPair.get(key)
    if (existing) {
      existing.count += 1
    } else {
      edgeCountByBlockPair.set(key, { source: sourceBlock, target: targetBlock, count: 1 })
    }
  }

  return [...edgeCountByBlockPair.values()]
}

function createInterBlockEdges(
  items: ConnectionItem[],
  cycleEdgeKeys: Set<string>,
  highlightCycles: boolean,
  routingStyle: RoutingStyle,
): Edge[] {
  return items.map((item, index) => ({
    id: `edge:block:${item.source}->${item.target}`,
    type: routingStyle === 'bus' ? 'bus' : undefined,
    source: item.source,
    target: item.target,
    label: String(item.count),
    markerEnd: { type: 'arrowclosed', color: '#7ea3bd' },
    style: cycleEdgeKeys.has(`${item.source}->${item.target}`) && highlightCycles
      ? { stroke: '#ff9898', strokeWidth: Math.min(3 + item.count * 0.2, 7) }
      : { stroke: '#7ea3bd', strokeWidth: Math.min(2 + item.count * 0.15, 6) },
    labelStyle: { fill: '#c8d8e8', fontSize: 12, fontWeight: 600 },
    data: routingStyle === 'bus' ? { busLane: index % 3, busCount: 3 } : undefined,
  }))
}

function detectCycleNodeIds(nodeIds: string[], edges: Array<{ source: string; target: string }>) {
  const adjacency = new Map<string, string[]>()
  const edgeSet = new Set<string>()

  for (const nodeId of nodeIds) {
    adjacency.set(nodeId, [])
  }

  for (const edge of edges) {
    adjacency.get(edge.source)?.push(edge.target)
    edgeSet.add(`${edge.source}->${edge.target}`)
  }

  let currentIndex = 0
  const indexByNode = new Map<string, number>()
  const lowByNode = new Map<string, number>()
  const stack: string[] = []
  const inStack = new Set<string>()
  const cycleNodeIds = new Set<string>()
  const cycleEdgeKeys = new Set<string>()

  function strongConnect(nodeId: string) {
    indexByNode.set(nodeId, currentIndex)
    lowByNode.set(nodeId, currentIndex)
    currentIndex += 1
    stack.push(nodeId)
    inStack.add(nodeId)

    for (const next of adjacency.get(nodeId) ?? []) {
      if (!indexByNode.has(next)) {
        strongConnect(next)
        lowByNode.set(nodeId, Math.min(lowByNode.get(nodeId) ?? 0, lowByNode.get(next) ?? 0))
      } else if (inStack.has(next)) {
        lowByNode.set(nodeId, Math.min(lowByNode.get(nodeId) ?? 0, indexByNode.get(next) ?? 0))
      }
    }

    if ((lowByNode.get(nodeId) ?? -1) === (indexByNode.get(nodeId) ?? -2)) {
      const component: string[] = []
      let popped = ''
      do {
        popped = stack.pop() ?? ''
        if (popped) {
          inStack.delete(popped)
          component.push(popped)
        }
      } while (popped && popped !== nodeId)

      if (component.length > 1) {
        for (const id of component) {
          cycleNodeIds.add(id)
        }
        for (const source of component) {
          for (const target of component) {
            const key = `${source}->${target}`
            if (edgeSet.has(key)) {
              cycleEdgeKeys.add(key)
            }
          }
        }
      } else if (component.length === 1) {
        const selfLoopKey = `${component[0]}->${component[0]}`
        if (edgeSet.has(selfLoopKey)) {
          cycleNodeIds.add(component[0])
          cycleEdgeKeys.add(selfLoopKey)
        }
      }
    }
  }

  for (const nodeId of nodeIds) {
    if (!indexByNode.has(nodeId)) {
      strongConnect(nodeId)
    }
  }

  return { cycleNodeIds, cycleEdgeKeys }
}

export function buildDependencyFlowGraph(
  project: ScannedProject,
  dependencyGraph: DependencyGraph,
  mode: GraphBuildMode,
  options: GraphOptions = {},
): BuiltGraph {
  const highlightCycles = options.highlightCycles ?? false
  const routingStyle = options.routingStyle ?? 'classic'
  const folderPacking = options.folderPacking ?? 'balanced'
  const fileEdgesRaw = dependencyGraph.edges.map((edge) => ({
    source: `file:${edge.fromPath}`,
    target: `file:${edge.toPath}`,
  }))
  const allFileNodeIds = project.files.map((file) => `file:${file.path}`)
  const fileCycles = detectCycleNodeIds(allFileNodeIds, fileEdgesRaw)

  if (mode === 'file-level') {
    const cycleFolderNodeIds = new Set<string>()
    const fileNodeToFolderId = new Map<string, string>()
    for (const file of project.files) {
      const folderId = toFolderId(getRelativeDirectoryPath(file.path, project.rootName))
      fileNodeToFolderId.set(`file:${file.path}`, folderId)
    }
    const parentFolderByFolder = new Map<string, string>()
    const { folderById } = collectHierarchicalFolders(project)
    for (const folder of folderById.values()) {
      if (folder.parentId) {
        parentFolderByFolder.set(folder.id, folder.parentId)
      }
    }
    for (const fileNodeId of fileCycles.cycleNodeIds) {
      let folderId = fileNodeToFolderId.get(fileNodeId)
      while (folderId) {
        cycleFolderNodeIds.add(folderId)
        folderId = parentFolderByFolder.get(folderId)
      }
    }

    const hierarchical = createHierarchicalFileLevelNodes(
      project,
      dependencyGraph,
      fileCycles.cycleNodeIds,
      cycleFolderNodeIds,
      folderPacking,
    )
    return {
      nodes: hierarchical.nodes,
      edges: createFileEdges(
        dependencyGraph,
        hierarchical.fileNodeToBlock,
        fileCycles.cycleEdgeKeys,
        highlightCycles,
        routingStyle,
      ),
      blockCount: hierarchical.blockCount,
      blockLayoutEdges: hierarchical.blockLayoutEdges,
      cycleEdgeCount: fileCycles.cycleEdgeKeys.size,
    }
  }

  const blocks = createTopLevelBlocks(project)
  const cycleBlockNodeIds = new Set<string>()
  const blockIdByFileNode = new Map<string, string>()
  for (const block of blocks) {
    for (const filePath of block.files) {
      blockIdByFileNode.set(`file:${filePath}`, block.id)
    }
  }
  for (const fileNodeId of fileCycles.cycleNodeIds) {
    const blockId = blockIdByFileNode.get(fileNodeId)
    if (blockId) {
      cycleBlockNodeIds.add(blockId)
    }
  }

  const topLevel = createTopLevelFileNodes(
    blocks,
    project,
    dependencyGraph,
    fileCycles.cycleNodeIds,
    cycleBlockNodeIds,
  )
  const interBlockConnections = collectInterBlockConnections(dependencyGraph, topLevel.fileNodeToBlock)
  const blockCycles = detectCycleNodeIds(
    blocks.map((block) => block.id),
    interBlockConnections.map((edge) => ({ source: edge.source, target: edge.target })),
  )
  return {
    nodes: topLevel.nodes,
    edges: createInterBlockEdges(interBlockConnections, blockCycles.cycleEdgeKeys, highlightCycles, routingStyle),
    blockCount: blocks.length,
    blockLayoutEdges: interBlockConnections.map((connection) => ({
      source: connection.source,
      target: connection.target,
    })),
    cycleEdgeCount: blockCycles.cycleEdgeKeys.size,
  }
}
