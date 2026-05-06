import type { GitBranchCompareReport } from '../types'

export function isGitBranchCompareReportCandidate(value: unknown): value is GitBranchCompareReport {
  if (!value || typeof value !== 'object') {
    return false
  }
  const candidate = value as Partial<GitBranchCompareReport>
  return (
    candidate.type === 'git-branch-compare-report-v1' &&
    typeof candidate.generatedAt === 'string' &&
    typeof candidate.repoRootName === 'string' &&
    typeof candidate.baseRef === 'string' &&
    typeof candidate.targetRef === 'string' &&
    typeof candidate.mergeBase === 'string' &&
    !!candidate.summary &&
    typeof candidate.summary.changedFiles === 'number' &&
    typeof candidate.summary.totalChurn === 'number' &&
    Array.isArray(candidate.files)
  )
}
