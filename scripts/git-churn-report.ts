import { execFileSync } from 'node:child_process'
import { basename, resolve } from 'node:path'
import { writeFileSync } from 'node:fs'

type CliOptions = {
  repo: string
  since: string
  out: string
}

type ChurnFileMetric = {
  path: string
  commits: number
  additions: number
  deletions: number
  churn: number
}

type GitChurnReport = {
  type: 'git-churn-report-v1'
  generatedAt: string
  repoRootName: string
  since: string
  files: ChurnFileMetric[]
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    repo: process.cwd(),
    since: '180 days ago',
    out: 'git-churn-report.json',
  }

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === '--repo') {
      options.repo = argv[index + 1] ?? options.repo
      index += 1
      continue
    }
    if (token === '--since') {
      options.since = argv[index + 1] ?? options.since
      index += 1
      continue
    }
    if (token === '--out') {
      options.out = argv[index + 1] ?? options.out
      index += 1
      continue
    }
  }

  options.repo = resolve(options.repo)
  options.out = resolve(options.repo, options.out)
  return options
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

function buildReport(options: CliOptions): GitChurnReport {
  const stdout = execFileSync(
    'git',
    ['-C', options.repo, 'log', '--since', options.since, '--numstat', '--pretty=format:__COMMIT__%H'],
    {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 1024 * 1024 * 20,
    },
  )

  const metricByPath = new Map<string, { commits: number; additions: number; deletions: number }>()
  let currentCommitTouched = new Set<string>()

  const flushCommitTouched = () => {
    currentCommitTouched = new Set<string>()
  }

  const lines = stdout.split(/\r?\n/)
  for (const line of lines) {
    if (!line) {
      continue
    }
    if (line.startsWith('__COMMIT__')) {
      flushCommitTouched()
      continue
    }
    const parts = line.split('\t')
    if (parts.length < 3) {
      continue
    }
    const additionsRaw = parts[0]
    const deletionsRaw = parts[1]
    const filePath = extractPathFromNumstat(parts.slice(2).join('\t'))
    if (!filePath) {
      continue
    }

    const additions = additionsRaw === '-' ? 0 : Number(additionsRaw)
    const deletions = deletionsRaw === '-' ? 0 : Number(deletionsRaw)
    if (!Number.isFinite(additions) || !Number.isFinite(deletions)) {
      continue
    }

    const existing = metricByPath.get(filePath) ?? { commits: 0, additions: 0, deletions: 0 }
    if (!currentCommitTouched.has(filePath)) {
      existing.commits += 1
      currentCommitTouched.add(filePath)
    }
    existing.additions += additions
    existing.deletions += deletions
    metricByPath.set(filePath, existing)
  }

  const files: ChurnFileMetric[] = [...metricByPath.entries()]
    .map(([path, metric]) => ({
      path,
      commits: metric.commits,
      additions: metric.additions,
      deletions: metric.deletions,
      churn: metric.additions + metric.deletions,
    }))
    .sort((left, right) => right.churn - left.churn || right.commits - left.commits || left.path.localeCompare(right.path))

  return {
    type: 'git-churn-report-v1',
    generatedAt: new Date().toISOString(),
    repoRootName: basename(options.repo),
    since: options.since,
    files,
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  const report = buildReport(options)
  writeFileSync(options.out, JSON.stringify(report, null, 2), 'utf8')
  process.stdout.write(`Git churn report written: ${options.out}\n`)
  process.stdout.write(`Files analyzed: ${report.files.length}\n`)
}

main()
