import { buildDependencyFlowGraph } from '../src/lib/graph-builder'
import { computeBusRoutes } from '../src/lib/bus-router'
import type { DependencyGraph, ScannedProject, TreeNode } from '../src/lib/models'

type Failure = { name: string; reason: string }

function dir(name: string, parentPath: string, children: TreeNode[]): TreeNode {
  const path = parentPath ? `${parentPath}/${name}` : name
  return { name, path, type: 'directory', children }
}
function file(name: string, parentPath: string): TreeNode {
  return { name, path: `${parentPath}/${name}`, type: 'file' }
}

// Hand-built 3-level project:
//   root/
//     src/
//       a/
//         foo.ts (imports ../b/bar.ts and ../b/baz.ts)
//       b/
//         bar.ts
//         baz.ts (imports ./bar.ts)
function buildProject(): { project: ScannedProject; graph: DependencyGraph } {
  const tree = dir('root', '', [
    dir('src', 'root', [
      dir('a', 'root/src', [file('foo.ts', 'root/src/a')]),
      dir('b', 'root/src', [file('bar.ts', 'root/src/b'), file('baz.ts', 'root/src/b')]),
    ]),
  ])

  const files = [
    { name: 'foo.ts', path: 'root/src/a/foo.ts', content: '' },
    { name: 'bar.ts', path: 'root/src/b/bar.ts', content: '' },
    { name: 'baz.ts', path: 'root/src/b/baz.ts', content: '' },
  ]

  const project: ScannedProject = {
    rootName: 'root',
    tree,
    files,
    tsFileCount: files.length,
    directoryCount: 4,
  }

  const graph: DependencyGraph = {
    files: files.map((f) => ({
      path: f.path,
      exports: [],
      imports: [],
      resolvedImports: [],
      unresolvedImports: [],
    })),
    edges: [
      {
        fromPath: 'root/src/a/foo.ts',
        toPath: 'root/src/b/bar.ts',
        specifier: '../b/bar',
        kind: 'runtime',
      },
      {
        fromPath: 'root/src/a/foo.ts',
        toPath: 'root/src/b/baz.ts',
        specifier: '../b/baz',
        kind: 'runtime',
      },
      {
        fromPath: 'root/src/b/baz.ts',
        toPath: 'root/src/b/bar.ts',
        specifier: './bar',
        kind: 'runtime',
      },
    ],
    externalEdges: [],
    externalPackages: [],
    unresolvedImportCount: 0,
    unresolvedExternalCount: 0,
    unresolvedInternalCount: 0,
    aliasResolvedCount: 0,
  }

  return { project, graph }
}

type Rect = { x: number; y: number; width: number; height: number }
function absRect(node: { id: string; position: { x: number; y: number }; style?: Record<string, unknown>; parentId?: string }, all: Map<string, typeof node>): Rect {
  const w = Number(node.style?.width ?? 0)
  const h = Number(node.style?.height ?? 0)
  if (!node.parentId) return { x: node.position.x, y: node.position.y, width: w, height: h }
  const parent = all.get(node.parentId)!
  const parentRect = absRect(parent, all)
  return { x: parentRect.x + node.position.x, y: parentRect.y + node.position.y, width: w, height: h }
}

function pointInsideRect(point: { x: number; y: number }, rect: Rect, slack = 1): boolean {
  return (
    point.x >= rect.x - slack &&
    point.x <= rect.x + rect.width + slack &&
    point.y >= rect.y - slack &&
    point.y <= rect.y + rect.height + slack
  )
}

function segmentIntersectsRect(
  from: { x: number; y: number },
  to: { x: number; y: number },
  rect: Rect,
  slack = 0.5,
): boolean {
  const rx1 = rect.x + slack
  const ry1 = rect.y + slack
  const rx2 = rect.x + rect.width - slack
  const ry2 = rect.y + rect.height - slack
  if (rx2 <= rx1 || ry2 <= ry1) return false
  const minX = Math.min(from.x, to.x)
  const maxX = Math.max(from.x, to.x)
  const minY = Math.min(from.y, to.y)
  const maxY = Math.max(from.y, to.y)
  if (Math.abs(from.y - to.y) < 0.01) {
    // horizontal
    if (from.y < ry1 || from.y > ry2) return false
    return !(maxX < rx1 || minX > rx2)
  }
  if (Math.abs(from.x - to.x) < 0.01) {
    // vertical
    if (from.x < rx1 || from.x > rx2) return false
    return !(maxY < ry1 || minY > ry2)
  }
  // not orthogonal — bounding-box check fallback
  return !(maxX < rx1 || minX > rx2 || maxY < ry1 || minY > ry2)
}

function main() {
  const { project, graph } = buildProject()
  const flowGraph = buildDependencyFlowGraph(project, graph, 'file-level', { routingStyle: 'bus' })

  const nodesById = new Map(flowGraph.nodes.map((node) => [node.id, node]))
  const fileNodeToBlockId = new Map<string, string>()
  for (const node of flowGraph.nodes) {
    if (node.parentId && node.id.startsWith('file:')) {
      fileNodeToBlockId.set(node.id, node.parentId)
    }
  }
  const rectById = new Map<string, Rect>()
  for (const node of flowGraph.nodes) {
    rectById.set(node.id, absRect(node as never, nodesById as never))
  }

  const index = computeBusRoutes({
    visibleNodes: flowGraph.nodes,
    visibleEdges: flowGraph.edges,
    fileNodeToBlockId,
    routingStyle: 'bus',
    busDisplayMode: 'detailed',
  })

  const failures: Failure[] = []

  // Invariant 1: every routed edge has a path with at least one segment.
  for (const edge of flowGraph.edges) {
    const route = index.routesByEdgeId.get(edge.id)
    if (!route) {
      failures.push({ name: edge.id, reason: 'no route emitted' })
      continue
    }
    if (route.points.length < 2) {
      failures.push({ name: edge.id, reason: `path has ${route.points.length} points` })
    }
  }

  // Invariant 2: intra-folder paths stay inside the parent folder rect.
  for (const edge of flowGraph.edges) {
    const route = index.routesByEdgeId.get(edge.id)
    if (!route || route.isCrossFolder) continue
    const parentBlockRect = rectById.get(route.sourceBlockId)
    if (!parentBlockRect) {
      failures.push({ name: edge.id, reason: 'missing parent rect' })
      continue
    }
    for (const point of route.points) {
      if (!pointInsideRect(point, parentBlockRect)) {
        failures.push({
          name: edge.id,
          reason: `intra-folder point (${point.x.toFixed(1)}, ${point.y.toFixed(1)}) outside parent`,
        })
        break
      }
    }
  }

  // Invariant 3: no segment crosses a non-source/non-target file rect.
  const fileRectIds = flowGraph.nodes.filter((node) => node.id.startsWith('file:')).map((node) => node.id)
  for (const edge of flowGraph.edges) {
    const route = index.routesByEdgeId.get(edge.id)
    if (!route) continue
    for (let i = 0; i < route.points.length - 1; i += 1) {
      const from = route.points[i]
      const to = route.points[i + 1]
      for (const fileId of fileRectIds) {
        if (fileId === edge.source || fileId === edge.target) continue
        const rect = rectById.get(fileId)
        if (!rect) continue
        if (segmentIntersectsRect(from, to, rect, 1)) {
          failures.push({
            name: edge.id,
            reason: `segment ${i} crosses file ${fileId}`,
          })
        }
      }
    }
  }

  // Invariant 4: cross-folder paths visit each ancestor's pin set on its respective side.
  for (const edge of flowGraph.edges) {
    const route = index.routesByEdgeId.get(edge.id)
    if (!route || !route.isCrossFolder) continue
    const sourceBlockId = fileNodeToBlockId.get(edge.source)
    const targetBlockId = fileNodeToBlockId.get(edge.target)
    if (!sourceBlockId || !targetBlockId) continue
    const sourcePins = index.pinsByFolderId.get(sourceBlockId)
    const targetPins = index.pinsByFolderId.get(targetBlockId)
    if (!sourcePins || sourcePins.exports.length === 0) {
      failures.push({ name: edge.id, reason: `no export pin set on ${sourceBlockId}` })
    }
    if (!targetPins || targetPins.imports.length === 0) {
      failures.push({ name: edge.id, reason: `no import pin set on ${targetBlockId}` })
    }
  }

  const summary = `edges=${flowGraph.edges.length} routed=${index.routesByEdgeId.size} pinFolders=${index.pinsByFolderId.size}`
  if (failures.length === 0) {
    console.log(`OK bus-router smoke | ${summary}`)
    return
  }
  console.error(`FAIL bus-router smoke | ${summary}`)
  for (const failure of failures) {
    console.error(` - ${failure.name}: ${failure.reason}`)
  }
  process.exit(1)
}

main()
