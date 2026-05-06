import type { AnalysisExportReport } from '../types'

export function buildMarkdownReport(report: AnalysisExportReport) {
  const lines: string[] = []
  lines.push('# Schematic Code Visualizer Report')
  lines.push('')
  lines.push(`- Generated: ${report.generatedAt}`)
  lines.push(`- Project: ${report.projectRoot ?? '-'}`)
  lines.push('')
  lines.push('## Summary')
  lines.push(`- TS files: ${report.summary.tsFiles}`)
  lines.push(`- Directories: ${report.summary.directories}`)
  lines.push(`- Dependency edges: ${report.summary.dependencyEdges}`)
  lines.push(`- Cycle edges: ${report.summary.cycleEdges}`)
  lines.push(`- Unresolved imports: ${report.summary.unresolvedImports}`)
  lines.push(`- Unresolved internal: ${report.summary.unresolvedInternal}`)
  lines.push(`- Unresolved external: ${report.summary.unresolvedExternal}`)
  lines.push(`- Alias resolved: ${report.summary.aliasResolved}`)
  lines.push('')
  lines.push('## Edge Kinds')
  lines.push(`- runtime: ${report.edgeKinds.runtime}`)
  lines.push(`- type: ${report.edgeKinds.type}`)
  lines.push(`- re-export: ${report.edgeKinds['re-export']}`)
  lines.push('')
  lines.push('## Code Health')
  lines.push('### Hotspots')
  if (report.codeHealth.hotspots.length === 0) {
    lines.push('- none')
  } else {
    for (const item of report.codeHealth.hotspots) {
      lines.push(`- ${item.path} | score=${item.score} | in=${item.incoming} | out=${item.outgoing} | loc=${item.loc}`)
    }
  }
  lines.push('')
  lines.push('### Potential Dead Exports')
  if (report.codeHealth.deadExports.length === 0) {
    lines.push('- none')
  } else {
    for (const item of report.codeHealth.deadExports) {
      lines.push(`- ${item.path} | exports=${item.exportCount} | symbols=${item.exports.join(', ')}`)
    }
  }
  lines.push('')
  lines.push('### Cycle Groups')
  if (report.codeHealth.cycleGroups.length === 0) {
    lines.push('- none')
  } else {
    for (const item of report.codeHealth.cycleGroups) {
      lines.push(`- cycle-${item.id} | size=${item.size} | ${item.files.join(' -> ')}`)
    }
  }
  lines.push('')
  lines.push('## Risk')
  lines.push('### File Risk')
  if (report.risk.files.length === 0) {
    lines.push('- none')
  } else {
    for (const item of report.risk.files) {
      lines.push(
        `- ${item.path} | score=${item.score} | runtime ${item.incomingRuntime}/${item.outgoingRuntime} | type ${item.incomingType}/${item.outgoingType} | re-export ${item.incomingReexport}/${item.outgoingReexport}`,
      )
    }
  }
  lines.push('')
  lines.push('### Block Risk')
  if (report.risk.blocks.length === 0) {
    lines.push('- none')
  } else {
    for (const item of report.risk.blocks) {
      lines.push(
        `- ${item.label} | score=${item.score} | files=${item.fileCount} | cross runtime in=${item.incomingCrossBlockRuntime} out=${item.outgoingCrossBlockRuntime}`,
      )
    }
  }
  lines.push('')
  lines.push('## Refactor Signals')
  lines.push('### Orphan Runtime Modules')
  if (report.refactorSignals.orphanRuntimeModules.length === 0) {
    lines.push('- none')
  } else {
    for (const item of report.refactorSignals.orphanRuntimeModules) {
      lines.push(
        `- ${item.path} | exports=${item.exports} | typeTouches=${item.typeTouches} | reexportTouches=${item.reexportTouches}`,
      )
    }
  }
  lines.push('')
  lines.push('### Re-export Hubs')
  if (report.refactorSignals.reexportHubs.length === 0) {
    lines.push('- none')
  } else {
    for (const item of report.refactorSignals.reexportHubs) {
      lines.push(`- ${item.path} | re-export out=${item.outgoingReexport} | runtime in=${item.incomingRuntime} | exports=${item.exports}`)
    }
  }
  lines.push('')
  lines.push('### Duplicate Utility Groups')
  if (report.refactorSignals.duplicateUtilityGroups.length === 0) {
    lines.push('- none')
  } else {
    for (const item of report.refactorSignals.duplicateUtilityGroups) {
      lines.push(`- ${item.baseName} [${item.hash}]`)
      for (const path of item.paths) {
        lines.push(`  - ${path}`)
      }
    }
  }
  lines.push('')
  lines.push('### Re-export Bottlenecks')
  if (report.refactorSignals.reexportBottlenecks.length === 0) {
    lines.push('- none')
  } else {
    for (const item of report.refactorSignals.reexportBottlenecks) {
      lines.push(
        `- ${item.path} | score=${item.score} | runtime-in=${item.incomingRuntime} | reexport-in=${item.incomingReexport} | reexport-out=${item.outgoingReexport}`,
      )
    }
  }
  lines.push('')
  lines.push('### Re-export Chains')
  if (report.refactorSignals.reexportChains.length === 0) {
    lines.push('- none')
  } else {
    for (const chain of report.refactorSignals.reexportChains) {
      lines.push(`- ${chain}`)
    }
  }
  lines.push('')
  lines.push('## Architecture')
  lines.push('### Rules')
  for (const line of report.architecture.rules) {
    lines.push(`- ${line}`)
  }
  lines.push('')
  lines.push('### Layer Distribution')
  lines.push(
    `- ui ${report.architecture.layerDistribution.ui}, domain ${report.architecture.layerDistribution.domain}, infra ${report.architecture.layerDistribution.infra}, shared ${report.architecture.layerDistribution.shared}, tests ${report.architecture.layerDistribution.tests}, unknown ${report.architecture.layerDistribution.unknown}`,
  )
  lines.push('')
  lines.push('### Violations by Kind')
  lines.push(
    `- runtime ${report.architecture.violationsByKind.runtime}, type ${report.architecture.violationsByKind.type}, re-export ${report.architecture.violationsByKind['re-export']}`,
  )
  lines.push('')
  lines.push('### Violations by Layer Pair')
  if (report.architecture.violationsByLayerPair.length === 0) {
    lines.push('- none')
  } else {
    for (const item of report.architecture.violationsByLayerPair) {
      lines.push(`- ${item.pair}: ${item.count}`)
    }
  }
  lines.push('')
  lines.push('### Violation Sample')
  if (report.architecture.violations.length === 0) {
    lines.push('- none')
  } else {
    for (const item of report.architecture.violations) {
      lines.push(`- [${item.kind}] ${item.fromLayer}->${item.toLayer} | ${item.fromPath} -> ${item.toPath}`)
    }
  }
  lines.push('')
  return lines.join('\n')
}
