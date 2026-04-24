import type { Node, XYPosition } from '@xyflow/react'
import ELK from 'elkjs/lib/elk.bundled.js'

type LayoutEdge = {
  source: string
  target: string
}

const elk = new ELK()

function toNumber(value: unknown, fallback: number) {
  return typeof value === 'number' ? value : fallback
}

export async function applyElkToBlockNodes(nodes: Node[], edges: LayoutEdge[]) {
  const blockNodes = nodes.filter((node) => node.type === 'group')
  if (blockNodes.length === 0) {
    return nodes
  }

  const elkGraph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.layered.spacing.nodeNodeBetweenLayers': '110',
      'elk.spacing.nodeNode': '70',
      'elk.padding': '[top=30,left=30,bottom=30,right=30]',
      'elk.edgeRouting': 'ORTHOGONAL',
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
    if (node.type !== 'group') {
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
