import type { AnalysisWorkerRequest, AnalysisWorkerResponse } from './analysis-worker-protocol'
import type { DependencyGraph, SourceFileRecord, TsConfigAliasConfig } from './models'

type AnalyzeInWorkerOptions = {
  rootName: string
  tsconfigAliases?: TsConfigAliasConfig | null
}

export async function analyzeProjectDependenciesInWorker(
  files: SourceFileRecord[],
  options: AnalyzeInWorkerOptions,
): Promise<DependencyGraph> {
  const worker = new Worker(new URL('../workers/dependency.worker.ts', import.meta.url), {
    type: 'module',
  })

  const payload: AnalysisWorkerRequest = {
    files,
    options,
  }

  return new Promise<DependencyGraph>((resolve, reject) => {
    const cleanup = () => worker.terminate()

    worker.onmessage = (event: MessageEvent<AnalysisWorkerResponse>) => {
      cleanup()
      if (event.data.type === 'result') {
        resolve(event.data.graph)
        return
      }
      reject(new Error(event.data.message))
    }

    worker.onerror = () => {
      cleanup()
      reject(new Error('Worker crashed during dependency analysis.'))
    }

    worker.postMessage(payload)
  })
}
