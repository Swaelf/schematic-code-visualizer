import type { GitLiveLogResponse } from '../types'

export function isGitLiveLogResponseCandidate(value: unknown): value is GitLiveLogResponse {
  if (!value || typeof value !== 'object') {
    return false
  }
  const candidate = value as Partial<GitLiveLogResponse>
  return typeof candidate.repo === 'string' && typeof candidate.ref === 'string' && Array.isArray(candidate.commits)
}
