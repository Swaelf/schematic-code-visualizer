/// <reference lib="webworker" />

import { analyzeProjectDependencies } from '../lib/analyzer'
import type { AnalysisWorkerRequest, AnalysisWorkerResponse } from '../lib/analysis-worker-protocol'

addEventListener('message', (event: MessageEvent<AnalysisWorkerRequest>) => {
  try {
    const graph = analyzeProjectDependencies(event.data.files, event.data.options)
    const payload: AnalysisWorkerResponse = {
      type: 'result',
      graph,
    }
    postMessage(payload)
  } catch (error) {
    const payload: AnalysisWorkerResponse = {
      type: 'error',
      message: error instanceof Error ? error.message : 'Unknown analysis worker error.',
    }
    postMessage(payload)
  }
})

export {}
