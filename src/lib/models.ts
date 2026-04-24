export type TreeNode = {
  name: string
  path: string
  type: 'directory' | 'file'
  children?: TreeNode[]
}

export type SourceFileRecord = {
  name: string
  path: string
  content: string
}

export type ScannedProject = {
  rootName: string
  tree: TreeNode
  files: SourceFileRecord[]
  tsFileCount: number
  directoryCount: number
}

export type FileAnalysis = {
  path: string
  exports: string[]
  imports: string[]
  resolvedImports: string[]
  unresolvedImports: string[]
}

export type DependencyEdge = {
  fromPath: string
  toPath: string
  specifier: string
}

export type DependencyGraph = {
  files: FileAnalysis[]
  edges: DependencyEdge[]
  unresolvedImportCount: number
  aliasResolvedCount: number
}

export type TsConfigAliasConfig = {
  baseUrl?: string
  paths?: Record<string, string[]>
}
