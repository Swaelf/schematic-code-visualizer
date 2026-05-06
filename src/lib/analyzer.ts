import ts from 'typescript'
import type { DependencyEdge, DependencyGraph, FileAnalysis, SourceFileRecord, TsConfigAliasConfig } from './models'
import { dirname, joinPath, normalizePath } from './path-utils'

const SUPPORTED_EXTENSIONS = ['.ts', '.tsx']

type AnalyzeOptions = {
  rootName: string
  tsconfigAliases?: TsConfigAliasConfig | null
}

type ResolvedImport = {
  path: string
  viaAlias: boolean
}

type ImportReference = {
  specifier: string
  kind: DependencyEdge['kind']
}

function scriptKindFromPath(path: string) {
  return path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
}

function hasExportModifier(node: ts.Node) {
  if (!ts.canHaveModifiers(node)) {
    return false
  }
  const modifiers = ts.getModifiers(node)
  return !!modifiers?.some((modifier: ts.Modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
}

function addExportedBindingNames(list: string[], declarationList: ts.VariableDeclarationList) {
  for (const declaration of declarationList.declarations) {
    if (ts.isIdentifier(declaration.name)) {
      list.push(declaration.name.text)
    }
  }
}

function collectFileAnalysis(file: SourceFileRecord): { imports: ImportReference[]; exports: string[] } {
  const sourceFile = ts.createSourceFile(
    file.path,
    file.content,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFromPath(file.path),
  )

  const imports: ImportReference[] = []
  const exports: string[] = []

  function visit(node: ts.Node) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      imports.push({
        specifier: node.moduleSpecifier.text,
        kind: node.importClause?.isTypeOnly ? 'type' : 'runtime',
      })
    }

    if (ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        imports.push({
          specifier: node.moduleSpecifier.text,
          kind: 're-export',
        })
      }
      if (node.exportClause && ts.isNamedExports(node.exportClause)) {
        for (const element of node.exportClause.elements) {
          exports.push(element.name.text)
        }
      }
    }

    if (ts.isExportAssignment(node)) {
      exports.push('default')
    }

    if (ts.isFunctionDeclaration(node) && hasExportModifier(node) && node.name) {
      exports.push(node.name.text)
    }
    if (ts.isClassDeclaration(node) && hasExportModifier(node) && node.name) {
      exports.push(node.name.text)
    }
    if (ts.isInterfaceDeclaration(node) && hasExportModifier(node)) {
      exports.push(node.name.text)
    }
    if (ts.isTypeAliasDeclaration(node) && hasExportModifier(node)) {
      exports.push(node.name.text)
    }
    if (ts.isEnumDeclaration(node) && hasExportModifier(node)) {
      exports.push(node.name.text)
    }
    if (ts.isVariableStatement(node) && hasExportModifier(node)) {
      addExportedBindingNames(exports, node.declarationList)
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return { imports, exports }
}

function expandCandidates(base: string) {
  const variants = new Set<string>()
  variants.add(base)

  for (const extension of ['.js', '.mjs', '.cjs', '.jsx']) {
    if (base.endsWith(extension)) {
      variants.add(base.slice(0, -extension.length))
    }
  }

  const candidates: string[] = []
  for (const variant of variants) {
    candidates.push(normalizePath(variant))
    for (const extension of SUPPORTED_EXTENSIONS) {
      candidates.push(normalizePath(`${variant}${extension}`))
      candidates.push(normalizePath(`${variant}/index${extension}`))
    }
  }
  return candidates
}

function resolveRelativeImport(importingFilePath: string, specifier: string, projectFileSet: Set<string>) {
  const base = joinPath(dirname(importingFilePath), specifier)
  for (const candidate of expandCandidates(base)) {
    if (projectFileSet.has(candidate)) {
      return candidate
    }
  }
  return null
}

function parsePathPattern(pattern: string) {
  const wildcardIndex = pattern.indexOf('*')
  if (wildcardIndex < 0) {
    return { prefix: pattern, suffix: '', hasWildcard: false }
  }
  return {
    prefix: pattern.slice(0, wildcardIndex),
    suffix: pattern.slice(wildcardIndex + 1),
    hasWildcard: true,
  }
}

function matchAliasPattern(specifier: string, pattern: string) {
  const parsed = parsePathPattern(pattern)
  if (!parsed.hasWildcard) {
    return specifier === pattern ? '' : null
  }
  if (!specifier.startsWith(parsed.prefix) || !specifier.endsWith(parsed.suffix)) {
    return null
  }
  return specifier.slice(parsed.prefix.length, specifier.length - parsed.suffix.length)
}

function mayBeInternalAliasSpecifier(specifier: string, aliasConfig: TsConfigAliasConfig | null | undefined) {
  if (!aliasConfig) {
    return false
  }

  if (aliasConfig.paths) {
    for (const pattern of Object.keys(aliasConfig.paths)) {
      if (matchAliasPattern(specifier, pattern) !== null) {
        return true
      }
    }
  }

  if (aliasConfig.baseUrl) {
    return true
  }

  return false
}

function applyCapturedValue(template: string, captured: string) {
  return template.includes('*') ? template.replace('*', captured) : template
}

function resolveAliasImport(
  specifier: string,
  projectFileSet: Set<string>,
  options: AnalyzeOptions,
): string | null {
  const aliasConfig = options.tsconfigAliases
  const rootPrefix = options.rootName
  const baseUrl = aliasConfig?.baseUrl?.trim() || ''
  const baseRootPath = !baseUrl
    ? rootPrefix
    : baseUrl === rootPrefix || baseUrl.startsWith(`${rootPrefix}/`)
      ? baseUrl
      : joinPath(rootPrefix, baseUrl)

  if (aliasConfig?.paths) {
    for (const [pattern, targetPatterns] of Object.entries(aliasConfig.paths)) {
      const captured = matchAliasPattern(specifier, pattern)
      if (captured === null) {
        continue
      }
      for (const targetPattern of targetPatterns) {
        const replaced = applyCapturedValue(targetPattern, captured)
        const base = joinPath(baseRootPath, replaced)
        for (const candidate of expandCandidates(base)) {
          if (projectFileSet.has(candidate)) {
            return candidate
          }
        }
      }
    }
  }

  if (baseUrl) {
    const base = joinPath(baseRootPath, specifier)
    for (const candidate of expandCandidates(base)) {
      if (projectFileSet.has(candidate)) {
        return candidate
      }
    }
  }

  return null
}

function resolveImport(
  importingFilePath: string,
  specifier: string,
  projectFileSet: Set<string>,
  options: AnalyzeOptions,
): ResolvedImport | null {
  if (specifier.startsWith('.')) {
    const path = resolveRelativeImport(importingFilePath, specifier, projectFileSet)
    return path ? { path, viaAlias: false } : null
  }

  const aliasPath = resolveAliasImport(specifier, projectFileSet, options)
  return aliasPath ? { path: aliasPath, viaAlias: true } : null
}

function getPackageName(specifier: string): string {
  if (specifier.startsWith('@')) {
    const parts = specifier.split('/')
    return parts.slice(0, 2).join('/')
  }
  return specifier.split('/')[0]
}

function externalPath(packageName: string): string {
  return `external:${packageName}`
}

export function analyzeProjectDependencies(files: SourceFileRecord[], options: AnalyzeOptions): DependencyGraph {
  const projectFileSet = new Set(files.map((file) => file.path))
  const analyses: FileAnalysis[] = []
  const edges: DependencyEdge[] = []
  const externalEdges: DependencyEdge[] = []
  const externalPackageSet = new Set<string>()
  let unresolvedImportCount = 0
  let unresolvedExternalCount = 0
  let unresolvedInternalCount = 0
  let aliasResolvedCount = 0

  for (const file of files) {
    const { imports, exports } = collectFileAnalysis(file)
    const resolvedImports: string[] = []
    const unresolvedImports: string[] = []

    for (const importRef of imports) {
      const resolved = resolveImport(file.path, importRef.specifier, projectFileSet, options)
      if (!resolved) {
        unresolvedImports.push(importRef.specifier)
        if (importRef.specifier.startsWith('.') || mayBeInternalAliasSpecifier(importRef.specifier, options.tsconfigAliases)) {
          unresolvedInternalCount += 1
        } else {
          unresolvedExternalCount += 1
          const packageName = getPackageName(importRef.specifier)
          externalPackageSet.add(packageName)
          externalEdges.push({
            fromPath: file.path,
            toPath: externalPath(packageName),
            specifier: importRef.specifier,
            kind: importRef.kind,
          })
        }
        continue
      }
      resolvedImports.push(resolved.path)
      if (resolved.viaAlias) {
        aliasResolvedCount += 1
      }
      edges.push({
        fromPath: file.path,
        toPath: resolved.path,
        specifier: importRef.specifier,
        kind: importRef.kind,
      })
    }

    unresolvedImportCount += unresolvedImports.length
    analyses.push({
      path: file.path,
      imports: imports.map((item) => item.specifier),
      exports,
      resolvedImports,
      unresolvedImports,
    })
  }

  return {
    files: analyses,
    edges,
    externalEdges,
    externalPackages: [...externalPackageSet].sort(),
    unresolvedImportCount,
    unresolvedExternalCount,
    unresolvedInternalCount,
    aliasResolvedCount,
  }
}
