import type { AnalysisExportReport } from '../types'

export function isAnalysisExportReportCandidate(value: unknown): value is AnalysisExportReport {
  if (!value || typeof value !== 'object') {
    return false
  }
  const candidate = value as Partial<AnalysisExportReport>
  return (
    typeof candidate.generatedAt === 'string' &&
    !!candidate.summary &&
    typeof candidate.summary.tsFiles === 'number' &&
    typeof candidate.summary.dependencyEdges === 'number' &&
    !!candidate.edgeKinds &&
    typeof candidate.edgeKinds.runtime === 'number' &&
    typeof candidate.edgeKinds.type === 'number' &&
    typeof candidate.edgeKinds['re-export'] === 'number' &&
    !!candidate.architecture &&
    Array.isArray(candidate.architecture.rules)
  )
}
