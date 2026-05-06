import type { BranchDiffView, GitBranchCompareReport } from '../types'

export function toBranchDiffBucket(
  changeType: GitBranchCompareReport['files'][number]['changeType'],
): Exclude<BranchDiffView, 'off' | 'all'> {
  if (changeType === 'A') {
    return 'added'
  }
  if (changeType === 'D') {
    return 'deleted'
  }
  if (changeType === 'R') {
    return 'renamed'
  }
  return 'modified'
}
