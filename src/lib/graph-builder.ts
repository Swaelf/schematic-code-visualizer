import { Position, type Edge, type Node } from '@xyflow/react'
import type { DependencyGraph, ScannedProject } from './models'

const BLOCK_HEADER_HEIGHT = 38
const FILE_NODE_WIDTH = 240
const FILE_NODE_HEIGHT = 90
const FILE_NODE_GAP_X = 16
const FILE_NODE_GAP_Y = 12
const BLOCK_PADDING = 14
const BLOCK_GAP_X = 40
const BLOCK_GAP_Y = 40
const BLOCK_COLUMNS = 3

export type GraphBuildMode = 'file-level' | 'inter-block'

export type BuiltGraph = {
  nodes: Node[]
  edges: Edge[]
  blockCount: number
  blockLayoutEdges: Array<{ source: string; target: string }>
  cycleEdgeCount: number
}

type BlockInfo = {
  id: string
  label: string
  files: string[]
}

type GraphOptions = {
  highlightCycles?: boolean
}

type ConnectionItem = {
  source: string
  target: string
  count: number
}

function getRelativePath(path: string, rootName: string) {
  const prefix = `${rootName}/`
  if (path.startsWith(prefix)) {
    return path.slice(prefix.length)
  }
  return path
}

function getBlockLabel(path: string, rootName: string) {
  const relativePath = getRelativePath(path, rootName)
  const [firstSegment] = relativePath.split('/')
  return firstSegment || '(root)'
}

function createBlocks(project: ScannedProject) {
  const blockMap = new Map<string, BlockInfo>()

  for (const file of project.files) {
    const label = getBlockLabel(file.path, project.rootName)
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

function createNodes(
  blocks: BlockInfo[],
  project: ScannedProject,
  dependencyGraph: DependencyGraph,
  cycleFileNodeIds: Set<string>,
  cycleBlockNodeIds: Set<string>,
) {
  const nodes: Node[] = []
  const fileNodeToBlock = new Map<string, string>()
  const fileAnalysisByPath = new Map(dependencyGraph.files.map((file) => [file.path, file]))

  blocks.forEach((block, blockIndex) => {
    const col = blockIndex % BLOCK_COLUMNS
    const row = Math.floor(blockIndex / BLOCK_COLUMNS)
    const files = [...block.files].sort((a, b) => a.localeCompare(b))
    const filesPerRow = 2
    const rowCount = Math.ceil(files.length / filesPerRow)
    const blockWidth = BLOCK_PADDING * 2 + filesPerRow * FILE_NODE_WIDTH + (filesPerRow - 1) * FILE_NODE_GAP_X
    const blockHeight =
      BLOCK_PADDING * 2 +
      BLOCK_HEADER_HEIGHT +
      rowCount * FILE_NODE_HEIGHT +
      Math.max(0, rowCount - 1) * FILE_NODE_GAP_Y

    const blockNode: Node = {
      id: block.id,
      type: 'group',
      position: {
        x: col * (blockWidth + BLOCK_GAP_X),
        y: row * (blockHeight + BLOCK_GAP_Y),
      },
      data: { label: `${block.label} (${files.length})` },
      style: {
        width: blockWidth,
        height: blockHeight,
        borderRadius: 12,
        border: cycleBlockNodeIds.has(block.id) ? '2px solid #ff8f8f' : '1px solid #5f90b7',
        background: 'rgba(8, 32, 54, 0.78)',
      },
    }

    nodes.push(blockNode)

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
  cycleEdgeKeys: Set<string>,
  highlightCycles: boolean,
): Edge[] {
  return dependencyGraph.edges.map((edge) => ({
    id: `edge:file:${edge.fromPath}->${edge.toPath}`,
    source: `file:${edge.fromPath}`,
    target: `file:${edge.toPath}`,
    animated: false,
    markerEnd: { type: 'arrowclosed', color: '#f5b04d' },
    style: cycleEdgeKeys.has(`${edge.fromPath}->${edge.toPath}`) && highlightCycles
      ? { stroke: '#ff9898', strokeWidth: 2.4 }
      : { stroke: '#6fdc9a', strokeWidth: 1.6 },
  }))
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

function createInterBlockEdges(items: ConnectionItem[], cycleEdgeKeys: Set<string>, highlightCycles: boolean): Edge[] {
  return items.map((item) => ({
    id: `edge:block:${item.source}->${item.target}`,
    source: item.source,
    target: item.target,
    label: String(item.count),
    markerEnd: { type: 'arrowclosed', color: '#f5b04d' },
    style: cycleEdgeKeys.has(`${item.source}->${item.target}`) && highlightCycles
      ? { stroke: '#ff9898', strokeWidth: Math.min(3 + item.count * 0.2, 7) }
      : { stroke: '#6fdc9a', strokeWidth: Math.min(2 + item.count * 0.15, 6) },
    labelStyle: { fill: '#b9f7cf', fontSize: 12, fontWeight: 600 },
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
  const blocks = createBlocks(project)
  const fileEdgesRaw = dependencyGraph.edges.map((edge) => ({
    source: `file:${edge.fromPath}`,
    target: `file:${edge.toPath}`,
  }))
  const allFileNodeIds = project.files.map((file) => `file:${file.path}`)
  const fileCycles = detectCycleNodeIds(allFileNodeIds, fileEdgesRaw)

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

  const { nodes, fileNodeToBlock } = createNodes(
    blocks,
    project,
    dependencyGraph,
    fileCycles.cycleNodeIds,
    cycleBlockNodeIds,
  )
  const interBlockConnections = collectInterBlockConnections(dependencyGraph, fileNodeToBlock)
  const blockCycles = detectCycleNodeIds(
    blocks.map((block) => block.id),
    interBlockConnections.map((edge) => ({
      source: edge.source,
      target: edge.target,
    })),
  )
  const edges =
    mode === 'inter-block'
      ? createInterBlockEdges(interBlockConnections, blockCycles.cycleEdgeKeys, highlightCycles)
      : createFileEdges(dependencyGraph, fileCycles.cycleEdgeKeys, highlightCycles)
  const cycleEdgeCount = mode === 'inter-block' ? blockCycles.cycleEdgeKeys.size : fileCycles.cycleEdgeKeys.size

  return {
    nodes,
    edges,
    blockCount: blocks.length,
    blockLayoutEdges: interBlockConnections.map((connection) => ({
      source: connection.source,
      target: connection.target,
    })),
    cycleEdgeCount,
  }
}
