import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { execFileSync } from 'node:child_process'
import { basename, resolve } from 'node:path'

type BranchChangeType = 'A' | 'M' | 'D' | 'R' | 'C' | 'T' | 'U'

type BranchCompareFileMetric = {
  path: string
  changeType: BranchChangeType
  additions: number
  deletions: number
  churn: number
  oldPath?: string
}

type GitBranchCompareReport = {
  type: 'git-branch-compare-report-v1'
  generatedAt: string
  repoRootName: string
  baseRef: string
  targetRef: string
  mergeBase: string
  summary: {
    changedFiles: number
    added: number
    modified: number
    deleted: number
    renamed: number
    totalAdditions: number
    totalDeletions: number
    totalChurn: number
  }
  files: BranchCompareFileMetric[]
}

function withCors(response: ServerResponse) {
  response.setHeader('Access-Control-Allow-Origin', '*')
  response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

function writeJson(response: ServerResponse, statusCode: number, payload: unknown) {
  withCors(response)
  response.statusCode = statusCode
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.end(JSON.stringify(payload))
}

function runGit(repo: string, args: string[]) {
  return execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 1024 * 1024 * 20,
  }).trimEnd()
}

function normalizePath(input: string) {
  return input.replace(/\\/g, '/').replace(/^\.\//, '').trim()
}

function extractPathFromNumstat(rawPath: string) {
  const normalized = normalizePath(rawPath)
  if (!normalized.includes('=>')) {
    return normalized
  }

  if (normalized.includes('{') && normalized.includes('}')) {
    const start = normalized.indexOf('{')
    const end = normalized.indexOf('}', start + 1)
    if (start >= 0 && end > start) {
      const prefix = normalized.slice(0, start)
      const inside = normalized.slice(start + 1, end)
      const suffix = normalized.slice(end + 1)
      const right = inside.split('=>')[1]?.trim()
      if (right) {
        return normalizePath(`${prefix}${right}${suffix}`)
      }
    }
  }

  const right = normalized.split('=>')[1]?.trim()
  return right ? normalizePath(right) : normalized
}

function normalizeChangeType(input: string): BranchChangeType {
  const raw = input.trim().charAt(0).toUpperCase()
  if (raw === 'A' || raw === 'D' || raw === 'R' || raw === 'C' || raw === 'T' || raw === 'U') {
    return raw
  }
  return 'M'
}

function ensureRepo(repo: string) {
  const repoPath = resolve(repo)
  const isRepo = runGit(repoPath, ['rev-parse', '--is-inside-work-tree'])
  if (isRepo.trim() !== 'true') {
    throw new Error('Provided path is not a git repository.')
  }
  return repoPath
}

function getRefs(repo: string) {
  const currentBranch = runGit(repo, ['branch', '--show-current']).trim()
  const head = runGit(repo, ['rev-parse', 'HEAD']).trim()
  const branches = runGit(repo, ['for-each-ref', '--format=%(refname:short)', 'refs/heads'])
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const tags = runGit(repo, ['for-each-ref', '--format=%(refname:short)', 'refs/tags'])
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  return { currentBranch, head, branches, tags }
}

function getLog(repo: string, ref: string, limit: number) {
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(limit, 300)) : 40
  const lines = runGit(repo, ['log', ref, '--date=short', `--max-count=${safeLimit}`, '--pretty=format:%H%x09%h%x09%ad%x09%s'])
    .split(/\r?\n/)
    .filter(Boolean)
  return lines.map((line) => {
    const [hash = '', shortHash = '', date = '', subject = ''] = line.split('\t')
    return { hash, shortHash, date, subject }
  })
}

function buildCompareReport(repo: string, base: string, target: string): GitBranchCompareReport {
  const mergeBase = runGit(repo, ['merge-base', base, target]).trim()
  if (!mergeBase) {
    throw new Error(`Cannot resolve merge-base for ${base} and ${target}.`)
  }

  const statusLines = runGit(repo, ['diff', '--name-status', '--find-renames', mergeBase, target]).split(/\r?\n/)
  const statusByPath = new Map<string, { changeType: BranchChangeType; oldPath?: string }>()
  for (const line of statusLines) {
    if (!line) {
      continue
    }
    const parts = line.split('\t')
    if (parts.length < 2) {
      continue
    }
    const changeType = normalizeChangeType(parts[0] ?? 'M')
    if (changeType === 'R' || changeType === 'C') {
      const oldPath = normalizePath(parts[1] ?? '')
      const newPath = normalizePath(parts[2] ?? '')
      if (!newPath) {
        continue
      }
      statusByPath.set(newPath, { changeType, oldPath: oldPath || undefined })
      continue
    }
    const path = normalizePath(parts[1] ?? '')
    if (!path) {
      continue
    }
    statusByPath.set(path, { changeType })
  }

  const numstatLines = runGit(repo, ['diff', '--numstat', '--find-renames', mergeBase, target]).split(/\r?\n/)
  const numstatByPath = new Map<string, { additions: number; deletions: number }>()
  for (const line of numstatLines) {
    if (!line) {
      continue
    }
    const parts = line.split('\t')
    if (parts.length < 3) {
      continue
    }
    const additionsRaw = parts[0] ?? '0'
    const deletionsRaw = parts[1] ?? '0'
    const path = extractPathFromNumstat(parts.slice(2).join('\t'))
    if (!path) {
      continue
    }
    const additions = additionsRaw === '-' ? 0 : Number(additionsRaw)
    const deletions = deletionsRaw === '-' ? 0 : Number(deletionsRaw)
    if (!Number.isFinite(additions) || !Number.isFinite(deletions)) {
      continue
    }
    numstatByPath.set(path, { additions, deletions })
  }

  const allPaths = new Set<string>([...statusByPath.keys(), ...numstatByPath.keys()])
  const files: BranchCompareFileMetric[] = [...allPaths]
    .map((path) => {
      const status = statusByPath.get(path)
      const metric = numstatByPath.get(path) ?? { additions: 0, deletions: 0 }
      return {
        path,
        changeType: status?.changeType ?? 'M',
        additions: metric.additions,
        deletions: metric.deletions,
        churn: metric.additions + metric.deletions,
        oldPath: status?.oldPath,
      }
    })
    .sort((left, right) => right.churn - left.churn || left.path.localeCompare(right.path))

  const summary = {
    changedFiles: files.length,
    added: files.filter((item) => item.changeType === 'A').length,
    modified: files.filter((item) => item.changeType === 'M' || item.changeType === 'T').length,
    deleted: files.filter((item) => item.changeType === 'D').length,
    renamed: files.filter((item) => item.changeType === 'R').length,
    totalAdditions: files.reduce((sum, item) => sum + item.additions, 0),
    totalDeletions: files.reduce((sum, item) => sum + item.deletions, 0),
    totalChurn: files.reduce((sum, item) => sum + item.churn, 0),
  }

  return {
    type: 'git-branch-compare-report-v1',
    generatedAt: new Date().toISOString(),
    repoRootName: basename(repo),
    baseRef: base,
    targetRef: target,
    mergeBase,
    summary,
    files,
  }
}

function handleRequest(request: IncomingMessage, response: ServerResponse) {
  if (!request.url) {
    writeJson(response, 400, { error: 'Missing URL.' })
    return
  }
  if (request.method === 'OPTIONS') {
    withCors(response)
    response.statusCode = 204
    response.end()
    return
  }
  if (request.method !== 'GET') {
    writeJson(response, 405, { error: 'Only GET is supported.' })
    return
  }

  const url = new URL(request.url, 'http://localhost')
  if (url.pathname === '/api/git/health') {
    writeJson(response, 200, { ok: true, service: 'git-live-server' })
    return
  }

  try {
    const repoParam = url.searchParams.get('repo')
    if (!repoParam) {
      writeJson(response, 400, { error: 'Query parameter `repo` is required.' })
      return
    }
    const repo = ensureRepo(repoParam)

    if (url.pathname === '/api/git/refs') {
      writeJson(response, 200, { repo, ...getRefs(repo) })
      return
    }
    if (url.pathname === '/api/git/log') {
      const ref = url.searchParams.get('ref') || 'HEAD'
      const limit = Number(url.searchParams.get('limit') ?? '40')
      writeJson(response, 200, { repo, ref, commits: getLog(repo, ref, limit) })
      return
    }
    if (url.pathname === '/api/git/compare') {
      const base = url.searchParams.get('base') || 'main'
      const target = url.searchParams.get('target') || 'HEAD'
      writeJson(response, 200, buildCompareReport(repo, base, target))
      return
    }

    writeJson(response, 404, { error: 'Unknown endpoint.' })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown git error.'
    writeJson(response, 500, { error: message })
  }
}

const port = Number(process.env.GIT_LIVE_PORT ?? 3031)
const host = process.env.GIT_LIVE_HOST ?? '127.0.0.1'

createServer(handleRequest).listen(port, host, () => {
  process.stdout.write(`Git live server started: http://${host}:${port}\n`)
  process.stdout.write('Endpoints: /api/git/health, /api/git/refs, /api/git/log, /api/git/compare\n')
})
