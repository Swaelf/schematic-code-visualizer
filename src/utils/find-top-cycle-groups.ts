import type { CycleGroup } from '../types'

export function findTopCycleGroups(
  filePaths: string[],
  edges: Array<{ fromPath: string; toPath: string }>,
  limit = 5,
): CycleGroup[] {
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
