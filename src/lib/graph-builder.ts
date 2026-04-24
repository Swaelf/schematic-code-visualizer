import type { Edge, Node } from '@xyflow/react'
import type { DependencyGraph, ScannedProject } from './models'

const BLOCK_HEADER_HEIGHT = 38
const FILE_NODE_WIDTH = 210
const FILE_NODE_HEIGHT = 44
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
}

type BlockInfo = {
  id: string
  label: string
  files: string[]
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

function createNodes(blocks: BlockInfo[], project: ScannedProject) {
  const nodes: Node[] = []
  const blockNodeIndex = new Map<string, Node>()
  const fileNodeToBlock = new Map<string, string>()

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
        border: '1px solid #5f90b7',
        background: 'rgba(8, 32, 54, 0.78)',
      },
    }

    nodes.push(blockNode)
    blockNodeIndex.set(block.id, blockNode)

    files.forEach((filePath, fileIndex) => {
      const fileCol = fileIndex % filesPerRow
      const fileRow = Math.floor(fileIndex / filesPerRow)
      const relativeLabel = getRelativePath(filePath, project.rootName)
      const fileName = relativeLabel.split('/').at(-1) ?? relativeLabel

      nodes.push({
        id: `file:${filePath}`,
        parentId: block.id,
        extent: 'parent',
        position: {
          x: BLOCK_PADDING + fileCol * (FILE_NODE_WIDTH + FILE_NODE_GAP_X),
          y: BLOCK_PADDING + BLOCK_HEADER_HEIGHT + fileRow * (FILE_NODE_HEIGHT + FILE_NODE_GAP_Y),
        },
        data: {
          label: fileName,
        },
        style: {
          width: FILE_NODE_WIDTH,
          height: FILE_NODE_HEIGHT,
          borderRadius: 8,
          border: '1px solid #78aacb',
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

  return { nodes, fileNodeToBlock, blockNodeIndex }
}

function createFileEdges(dependencyGraph: DependencyGraph): Edge[] {
  return dependencyGraph.edges.map((edge) => ({
    id: `edge:file:${edge.fromPath}->${edge.toPath}`,
    source: `file:${edge.fromPath}`,
    target: `file:${edge.toPath}`,
    animated: false,
    style: { stroke: '#a4c8e2', strokeWidth: 1.2 },
  }))
}

function createInterBlockEdges(dependencyGraph: DependencyGraph, fileNodeToBlock: Map<string, string>): Edge[] {
  const edgeCountByBlockPair = new Map<string, { source: string; target: string; count: number }>()

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

  return [...edgeCountByBlockPair.values()].map((item) => ({
    id: `edge:block:${item.source}->${item.target}`,
    source: item.source,
    target: item.target,
    label: String(item.count),
    markerEnd: { type: 'arrowclosed', color: '#f5c16e' },
    style: { stroke: '#f5c16e', strokeWidth: Math.min(2 + item.count * 0.15, 6) },
    labelStyle: { fill: '#ffe1a8', fontSize: 12, fontWeight: 600 },
  }))
}

export function buildDependencyFlowGraph(
  project: ScannedProject,
  dependencyGraph: DependencyGraph,
  mode: GraphBuildMode,
): BuiltGraph {
  const blocks = createBlocks(project)
  const { nodes, fileNodeToBlock } = createNodes(blocks, project)
  const edges = mode === 'inter-block' ? createInterBlockEdges(dependencyGraph, fileNodeToBlock) : createFileEdges(dependencyGraph)

  return {
    nodes,
    edges,
    blockCount: blocks.length,
  }
}
