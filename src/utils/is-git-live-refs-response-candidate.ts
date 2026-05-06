import type { GitLiveRefsResponse } from '../types'

export function isGitLiveRefsResponseCandidate(value: unknown): value is GitLiveRefsResponse {
  if (!value || typeof value !== 'object') {
    return false
  }
  const candidate = value as Partial<GitLiveRefsResponse>
  return (
    typeof candidate.repo === 'string' &&
    typeof candidate.currentBranch === 'string' &&
    typeof candidate.head === 'string' &&
    Array.isArray(candidate.branches) &&
    Array.isArray(candidate.tags)
  )
}
