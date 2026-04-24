import type { DependencyGraph, SourceFileRecord, TsConfigAliasConfig } from './models'

export type AnalysisWorkerRequest = {
  files: SourceFileRecord[]
  options: {
    rootName: string
    tsconfigAliases?: TsConfigAliasConfig | null
  }
}

export type AnalysisWorkerResultMessage = {
  type: 'result'
  graph: DependencyGraph
}

export type AnalysisWorkerErrorMessage = {
  type: 'error'
  message: string
}

export type AnalysisWorkerResponse = AnalysisWorkerResultMessage | AnalysisWorkerErrorMessage
