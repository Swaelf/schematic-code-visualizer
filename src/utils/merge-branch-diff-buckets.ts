import type { BranchDiffView } from '../types'

export function mergeBranchDiffBuckets(
  left: Exclude<BranchDiffView, 'off' | 'all'> | undefined,
  right: Exclude<BranchDiffView, 'off' | 'all'> | undefined,
): Exclude<BranchDiffView, 'off' | 'all'> | null {
  const rank = (value: Exclude<BranchDiffView, 'off' | 'all'> | undefined) => {
    if (value === 'deleted') {
      return 4
    }
    if (value === 'added') {
      return 3
    }
    if (value === 'renamed') {
      return 2
    }
    if (value === 'modified') {
      return 1
    }
    return 0
  }
  const leftRank = rank(left)
  const rightRank = rank(right)
  if (leftRank === 0 && rightRank === 0) {
    return null
  }
  return leftRank >= rightRank ? (left as Exclude<BranchDiffView, 'off' | 'all'>) : (right as Exclude<BranchDiffView, 'off' | 'all'>)
}
