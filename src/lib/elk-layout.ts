import type { Node, XYPosition } from '@xyflow/react'
import ELK from 'elkjs/lib/elk.bundled.js'

type LayoutEdge = {
  source: string
  target: string
}

export type BlockLayoutMode = 'compact' | 'dependency'

const elk = new ELK()

function toNumber(value: unknown, fallback: number) {
  return typeof value === 'number' ? value : fallback
}

function applyCompactPackLayout(nodes: Node[]) {
  const blockNodes = nodes.filter(
    (node) => (node.type === 'folderBlock' || node.type === 'group') && !node.parentId,
  )
  if (blockNodes.length === 0) {
    return nodes
  }

  const gap = 30
  const outerPadding = 24
  const sorted = [...blockNodes].sort((left, right) => {
    const leftHeight = toNumber(left.style?.height, 220)
    const rightHeight = toNumber(right.style?.height, 220)
    if (rightHeight !== leftHeight) {
      return rightHeight - leftHeight
    }
    return left.id.localeCompare(right.id)
  })

  const totalArea = sorted.reduce((sum, node) => {
    const width = toNumber(node.style?.width, 400)
    const height = toNumber(node.style?.height, 220)
    return sum + (width + gap) * (height + gap)
  }, 0)
  const widestNode = sorted.reduce((max, node) => Math.max(max, toNumber(node.style?.width, 400)), 0)
  const targetRowWidth = Math.max(widestNode + outerPadding * 2, Math.sqrt(totalArea) * 1.1)

  const positions = new Map<string, XYPosition>()
  let x = outerPadding
  let y = outerPadding
  let rowHeight = 0

  for (const node of sorted) {
    const width = toNumber(node.style?.width, 400)
    const height = toNumber(node.style?.height, 220)
    const wouldOverflow = x > outerPadding && x + width > targetRowWidth
    if (wouldOverflow) {
      x = outerPadding
      y += rowHeight + gap
      rowHeight = 0
    }

    positions.set(node.id, { x, y })
    x += width + gap
    rowHeight = Math.max(rowHeight, height)
  }

  return nodes.map((node) => {
    if (node.type !== 'folderBlock' && node.type !== 'group') {
      return node
    }
    const nextPosition = positions.get(node.id)
    if (!nextPosition) {
      return node
    }
    return {
      ...node,
      position: nextPosition,
    }
  })
}

export async function applyElkToBlockNodes(
  nodes: Node[],
  edges: LayoutEdge[],
  mode: BlockLayoutMode = 'compact',
) {
  if (mode === 'compact') {
    return applyCompactPackLayout(nodes)
  }

  const blockNodes = nodes.filter((node) => node.type === 'folderBlock' || node.type === 'group')
    .filter((node) => !node.parentId)
  if (blockNodes.length === 0) {
    return nodes
  }

  const elkGraph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.layered.spacing.nodeNodeBetweenLayers': '62',
      'elk.spacing.nodeNode': '54',
      'elk.padding': '[top=18,left=18,bottom=18,right=18]',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.layered.nodePlacement.bk.fixedAlignment': 'BALANCED',
    },
    children: blockNodes.map((node) => ({
      id: node.id,
      width: toNumber(node.style?.width, 400),
      height: toNumber(node.style?.height, 220),
    })),
    edges: edges.map((edge, index) => ({
      id: `elk-edge-${index}`,
      sources: [edge.source],
      targets: [edge.target],
    })),
  }

  const layout = await elk.layout(elkGraph)
  const positionById = new Map<string, XYPosition>()

  for (const child of layout.children ?? []) {
    positionById.set(child.id, {
      x: child.x ?? 0,
      y: child.y ?? 0,
    })
  }

  return nodes.map((node) => {
    if (node.type !== 'folderBlock' && node.type !== 'group') {
      return node
    }
    const nextPosition = positionById.get(node.id)
    if (!nextPosition) {
      return node
    }
    return {
      ...node,
      position: nextPosition,
    }
  })
}
