import { promises as fs } from 'node:fs'
import path from 'node:path'
import { analyzeProjectDependencies } from '../src/lib/analyzer'
import type { SourceFileRecord, TsConfigAliasConfig } from '../src/lib/models'
import { dirname, joinPath, normalizePath } from '../src/lib/path-utils'

const IGNORED_DIRECTORIES = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.turbo'])
const TARGET_EXTENSIONS = ['.ts', '.tsx']

type RepoResult = {
  repoPath: string
  rootName: string
  files: number
  edges: number
  unresolved: number
  unresolvedExternal: number
  unresolvedInternal: number
  aliasResolved: number
}

function normalizeToPosix(inputPath: string) {
  return inputPath.replaceAll('\\', '/')
}

function isTargetFile(fileName: string) {
  return TARGET_EXTENSIONS.some((extension) => fileName.endsWith(extension)) && !fileName.endsWith('.d.ts')
}

async function collectSourceFiles(repoPath: string): Promise<SourceFileRecord[]> {
  const rootName = path.basename(repoPath)
  const output: SourceFileRecord[] = []

  async function walk(currentPath: string) {
    const entries = await fs.readdir(currentPath, { withFileTypes: true })
    for (const entry of entries) {
      const absolutePath = path.join(currentPath, entry.name)
      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name)) {
          continue
        }
        await walk(absolutePath)
        continue
      }

      if (!entry.isFile() || !isTargetFile(entry.name)) {
        continue
      }

      const relativePath = normalizeToPosix(path.relative(repoPath, absolutePath))
      output.push({
        name: entry.name,
        path: `${rootName}/${relativePath}`,
        content: await fs.readFile(absolutePath, 'utf8'),
      })
    }
  }

  await walk(repoPath)
  return output
}

async function readAliasConfig(repoPath: string): Promise<TsConfigAliasConfig | null> {
  const MAX_EXTENDS_DEPTH = 8
  const visited = new Set<string>()

  type TsConfigRoot = {
    extends?: string
    compilerOptions?: {
      baseUrl?: string
      paths?: Record<string, string[]>
    }
  }

  function resolveExtendsPath(currentConfigPath: string, extendsValue: string) {
    if (!extendsValue.startsWith('.') && !extendsValue.startsWith('/')) {
      return null
    }
    let resolved = extendsValue.startsWith('/')
      ? normalizePath(extendsValue.slice(1))
      : joinPath(dirname(currentConfigPath), extendsValue)
    if (!resolved.endsWith('.json')) {
      resolved = `${resolved}.json`
    }
    return resolved
  }

  function mergePathMappings(
    parentPaths: Record<string, string[]> | undefined,
    localPaths: Record<string, string[]> | undefined,
  ) {
    const merged: Record<string, string[]> = {}
    for (const [key, value] of Object.entries(parentPaths ?? {})) {
      merged[key] = [...value]
    }
    for (const [key, value] of Object.entries(localPaths ?? {})) {
      merged[key] = [...value]
    }
    return Object.keys(merged).length > 0 ? merged : undefined
  }

  async function readConfig(configPath: string, depth: number): Promise<TsConfigAliasConfig | null> {
    if (depth > MAX_EXTENDS_DEPTH) {
      return null
    }

    const normalizedConfigPath = normalizePath(configPath)
    if (visited.has(normalizedConfigPath)) {
      return null
    }
    visited.add(normalizedConfigPath)

    let configText = ''
    try {
      configText = await fs.readFile(path.join(repoPath, normalizedConfigPath), 'utf8')
    } catch {
      return null
    }

    let rawConfig: TsConfigRoot
    try {
      rawConfig = JSON.parse(configText) as TsConfigRoot
    } catch {
      return null
    }

    let inherited: TsConfigAliasConfig | null = null
    if (typeof rawConfig.extends === 'string') {
      const extendsPath = resolveExtendsPath(normalizedConfigPath, rawConfig.extends)
      if (extendsPath) {
        inherited = await readConfig(extendsPath, depth + 1)
      }
    }

    const compilerOptions = rawConfig.compilerOptions ?? {}
    const localBaseUrl = typeof compilerOptions.baseUrl === 'string' && compilerOptions.baseUrl.length > 0
      ? joinPath(path.basename(repoPath), joinPath(dirname(normalizedConfigPath), compilerOptions.baseUrl))
      : undefined
    const mergedBaseUrl = localBaseUrl ?? inherited?.baseUrl
    const mergedPaths = mergePathMappings(inherited?.paths, compilerOptions.paths)

    if (!mergedBaseUrl && !mergedPaths) {
      return null
    }

    return {
      baseUrl: mergedBaseUrl,
      paths: mergedPaths,
    }
  }

  try {
    return await readConfig('tsconfig.json', 0)
  } catch {
    return null
  }
}

async function runForRepo(repoPath: string): Promise<RepoResult> {
  const rootName = path.basename(repoPath)
  const files = await collectSourceFiles(repoPath)
  if (files.length === 0) {
    throw new Error(`No .ts/.tsx files found in ${repoPath}`)
  }

  const graph = analyzeProjectDependencies(files, {
    rootName,
    tsconfigAliases: await readAliasConfig(repoPath),
  })

  if (graph.files.length !== files.length) {
    throw new Error(`File analysis count mismatch for ${repoPath}: ${graph.files.length} vs ${files.length}`)
  }

  return {
    repoPath,
    rootName,
    files: files.length,
    edges: graph.edges.length,
    unresolved: graph.unresolvedImportCount,
    unresolvedExternal: graph.unresolvedExternalCount,
    unresolvedInternal: graph.unresolvedInternalCount,
    aliasResolved: graph.aliasResolvedCount,
  }
}

async function main() {
  const repoArgs = process.argv.slice(2)
  if (repoArgs.length === 0) {
    console.error('Usage: npm run smoke -- <repo-path-1> <repo-path-2> ...')
    process.exit(1)
  }

  const absoluteRepoPaths = repoArgs.map((repo) => path.resolve(repo))
  console.log(`Running smoke tests for ${absoluteRepoPaths.length} repo(s)...`)

  const results: RepoResult[] = []
  for (const repoPath of absoluteRepoPaths) {
    const result = await runForRepo(repoPath)
    results.push(result)
    console.log(
      [
        `OK ${result.rootName}`,
        `files=${result.files}`,
        `edges=${result.edges}`,
        `unresolved=${result.unresolved}`,
        `unresolvedExternal=${result.unresolvedExternal}`,
        `unresolvedInternal=${result.unresolvedInternal}`,
        `aliasResolved=${result.aliasResolved}`,
      ].join(' | '),
    )
  }

  const totals = results.reduce(
    (acc, item) => {
      acc.files += item.files
      acc.edges += item.edges
      acc.unresolved += item.unresolved
      acc.unresolvedExternal += item.unresolvedExternal
      acc.unresolvedInternal += item.unresolvedInternal
      acc.aliasResolved += item.aliasResolved
      return acc
    },
    { files: 0, edges: 0, unresolved: 0, unresolvedExternal: 0, unresolvedInternal: 0, aliasResolved: 0 },
  )

  console.log('---')
  console.log(
    [
      `TOTAL repos=${results.length}`,
      `files=${totals.files}`,
      `edges=${totals.edges}`,
      `unresolved=${totals.unresolved}`,
      `unresolvedExternal=${totals.unresolvedExternal}`,
      `unresolvedInternal=${totals.unresolvedInternal}`,
      `aliasResolved=${totals.aliasResolved}`,
    ].join(' | '),
  )
}

main().catch((error) => {
  console.error('Smoke test failed:', error)
  process.exit(1)
})
