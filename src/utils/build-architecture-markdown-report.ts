import type { ArchitectureExportReport } from '../types'

export function buildArchitectureMarkdownReport(report: ArchitectureExportReport) {
  const lines: string[] = []
  lines.push('# Architecture Report')
  lines.push('')
  lines.push(`- Generated: ${report.generatedAt}`)
  lines.push(`- Project: ${report.projectRoot ?? '-'}`)
  lines.push('')
  lines.push('## Rules')
  for (const rule of report.rules) {
    lines.push(`- ${rule}`)
  }
  lines.push('')
  lines.push('## Layer Distribution')
  lines.push(
    `- ui ${report.layerDistribution.ui}, domain ${report.layerDistribution.domain}, infra ${report.layerDistribution.infra}, shared ${report.layerDistribution.shared}, tests ${report.layerDistribution.tests}, unknown ${report.layerDistribution.unknown}`,
  )
  lines.push('')
  lines.push('## Violations by Kind')
  lines.push(
    `- runtime ${report.violationsByKind.runtime}, type ${report.violationsByKind.type}, re-export ${report.violationsByKind['re-export']}`,
  )
  lines.push('')
  lines.push('## Violations by Layer Pair')
  if (report.violationsByLayerPair.length === 0) {
    lines.push('- none')
  } else {
    for (const item of report.violationsByLayerPair) {
      lines.push(`- ${item.pair}: ${item.count}`)
    }
  }
  lines.push('')
  lines.push('## Violation Sample')
  if (report.violations.length === 0) {
    lines.push('- none')
  } else {
    for (const item of report.violations) {
      lines.push(`- [${item.kind}] ${item.fromLayer}->${item.toLayer} | ${item.fromPath} -> ${item.toPath}`)
    }
  }
  lines.push('')
  return lines.join('\n')
}
