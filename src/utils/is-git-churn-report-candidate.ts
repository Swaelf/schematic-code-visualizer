import type { GitChurnReport } from '../types'

export function isGitChurnReportCandidate(value: unknown): value is GitChurnReport {
  if (!value || typeof value !== 'object') {
    return false
  }
  const candidate = value as Partial<GitChurnReport>
  return (
    candidate.type === 'git-churn-report-v1' &&
    typeof candidate.generatedAt === 'string' &&
    typeof candidate.repoRootName === 'string' &&
    typeof candidate.since === 'string' &&
    Array.isArray(candidate.files)
  )
}
