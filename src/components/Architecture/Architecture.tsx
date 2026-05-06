import { useMemo, useState } from 'react'
import {
  ARCHITECTURE_MATCHER_LAYERS,
  ARCHITECTURE_RULE_LAYERS,
  ARCHITECTURE_STORAGE_KEY,
  DEFAULT_ARCHITECTURE_CONFIG,
} from '../../constants'
import type { DependencyEdge, DependencyGraph, ScannedProject } from '../../lib/models'
import type {
  ArchitectureConfig,
  ArchitectureConfigMode,
  ArchitectureExportReport,
  ArchitectureLayerId,
  ArchitectureViolation,
} from '../../types'
import { buildArchitectureMarkdownReport } from '../../utils/build-architecture-markdown-report'
import { downloadTextFile } from '../../utils/download-text-file'
import { normalizeArchitectureConfig } from '../../utils/normalize-architecture-config'

type ArchitectureProps = {
  architectureRuleLines: string[]
  architectureViolations: ArchitectureViolation[]
  architectureViolationByKind: Record<DependencyEdge['kind'], number>
  architectureLayerDistribution: Record<ArchitectureLayerId, number>
  architectureViolationByPair: Array<[string, number]>
  architectureConfig: ArchitectureConfig
  setArchitectureConfig: (config: ArchitectureConfig) => void
  focusViolationOnBoard: (item: ArchitectureViolation) => void
  scanResult: ScannedProject | null
  dependencyGraph: DependencyGraph | null
}

export function Architecture({
  architectureRuleLines,
  architectureViolations,
  architectureViolationByKind,
  architectureLayerDistribution,
  architectureViolationByPair,
  architectureConfig,
  setArchitectureConfig,
  focusViolationOnBoard,
  scanResult,
  dependencyGraph,
}: ArchitectureProps) {
  const architectureReport = useMemo<ArchitectureExportReport>(
    () => ({
      generatedAt: new Date().toISOString(),
      projectRoot: scanResult?.rootName ?? null,
      rules: architectureRuleLines,
      layerDistribution: architectureLayerDistribution,
      violationsByKind: architectureViolationByKind,
      violationsByLayerPair: architectureViolationByPair.map(([pair, count]) => ({ pair, count })),
      violations: architectureViolations.map((item) => ({
        kind: item.kind,
        fromLayer: item.fromLayer,
        toLayer: item.toLayer,
        fromPath: item.fromPath,
        toPath: item.toPath,
      })),
    }),
    [
      architectureLayerDistribution,
      architectureRuleLines,
      architectureViolationByKind,
      architectureViolationByPair,
      architectureViolations,
      scanResult?.rootName,
    ],
  )

  function exportArchitectureReportJson() {
    const projectName = scanResult?.rootName ?? 'project'
    downloadTextFile(`architecture-report-${projectName}.json`, JSON.stringify(architectureReport, null, 2), 'application/json;charset=utf-8')
  }

  function exportArchitectureReportMarkdown() {
    const projectName = scanResult?.rootName ?? 'project'
    downloadTextFile(`architecture-report-${projectName}.md`, buildArchitectureMarkdownReport(architectureReport), 'text/markdown;charset=utf-8')
  }
  const [architectureConfigMode, setArchitectureConfigMode] = useState<ArchitectureConfigMode>('visual')
  const [architectureConfigDraft, setArchitectureConfigDraft] = useState(() =>
    JSON.stringify(architectureConfig, null, 2),
  )
  const [architectureConfigError, setArchitectureConfigError] = useState<string | null>(null)

  function applyArchitectureConfig(nextConfig: ArchitectureConfig) {
    setArchitectureConfig(nextConfig)
    setArchitectureConfigDraft(JSON.stringify(nextConfig, null, 2))
    setArchitectureConfigError(null)
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(ARCHITECTURE_STORAGE_KEY, JSON.stringify(nextConfig))
    }
  }

  function applyArchitectureConfigDraft() {
    try {
      const parsed = JSON.parse(architectureConfigDraft) as unknown
      const normalized = normalizeArchitectureConfig(parsed)
      if (!normalized) {
        setArchitectureConfigError('Invalid config shape. Check layer names and allowed targets.')
        return
      }
      applyArchitectureConfig(normalized)
    } catch {
      setArchitectureConfigError('Invalid JSON format for architecture config.')
    }
  }

  function updateArchitectureAllowedTarget(
    fromLayer: ArchitectureLayerId,
    toLayer: ArchitectureLayerId,
    isAllowed: boolean,
  ) {
    const existing = architectureConfig.allowedTargets[fromLayer]
    const nextTargets = isAllowed
      ? [...new Set([...existing, toLayer])]
      : existing.filter((item) => item !== toLayer)
    if (nextTargets.length === 0) {
      setArchitectureConfigError(`Layer "${fromLayer}" must allow at least one target layer.`)
      return
    }
    applyArchitectureConfig({
      ...architectureConfig,
      allowedTargets: {
        ...architectureConfig.allowedTargets,
        [fromLayer]: nextTargets,
      },
    })
  }

  function updateArchitectureMatchers(layer: ArchitectureLayerId, csvValue: string) {
    const nextMatchers = csvValue
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean)
    applyArchitectureConfig({
      ...architectureConfig,
      layerMatchers: {
        ...architectureConfig.layerMatchers,
        [layer]: [...new Set(nextMatchers)],
      },
    })
  }

  function resetArchitectureConfig() {
    applyArchitectureConfig(DEFAULT_ARCHITECTURE_CONFIG)
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(ARCHITECTURE_STORAGE_KEY)
    }
  }

  return (
    <section className="panel grid architecture-grid">
      <div className="stats">
        <div className="section-card">
          <h2>Architecture Rules</h2>
          <ul className="rule-list">
            {architectureRuleLines.map((line) => (
              <li key={`arch-rule-${line}`}>{line}</li>
            ))}
          </ul>
          <p>
            <strong>Violations:</strong> {architectureViolations.length}
          </p>
          <p>
            <strong>Violations by kind:</strong> runtime {architectureViolationByKind.runtime}, type{' '}
            {architectureViolationByKind.type}, re-export {architectureViolationByKind['re-export']}
          </p>
          <p>
            <strong>Layer distribution:</strong> ui {architectureLayerDistribution.ui}, domain {architectureLayerDistribution.domain},
            infra {architectureLayerDistribution.infra}, shared {architectureLayerDistribution.shared}, tests{' '}
            {architectureLayerDistribution.tests}, unknown {architectureLayerDistribution.unknown}
          </p>
        </div>

        <div className="section-card">
          <h2>Architecture Config</h2>
          <div className="architecture-config-panel">
            <div className="architecture-config-mode">
              <button
                type="button"
                className={architectureConfigMode === 'visual' ? 'is-active' : ''}
                onClick={() => setArchitectureConfigMode('visual')}
              >
                Visual
              </button>
              <button
                type="button"
                className={architectureConfigMode === 'json' ? 'is-active' : ''}
                onClick={() => setArchitectureConfigMode('json')}
              >
                Advanced JSON
              </button>
            </div>
            {architectureConfigMode === 'visual' ? (
              <div className="architecture-visual-editor">
                <p className="hint">
                  Layer matchers (comma-separated path fragments). First matched layer in priority order wins.
                </p>
                {ARCHITECTURE_MATCHER_LAYERS.map((layer) => (
                  <label key={layer} className="architecture-matcher-row">
                    <span>{layer}</span>
                    <input
                      type="text"
                      value={architectureConfig.layerMatchers[layer].join(', ')}
                      onChange={(event) => updateArchitectureMatchers(layer, event.target.value)}
                      placeholder="e.g. /components/, /ui/"
                    />
                  </label>
                ))}
                <p className="hint">Allowed dependency directions:</p>
                <div className="architecture-matrix-wrap">
                  <table className="architecture-matrix">
                    <thead>
                      <tr>
                        <th>From \\ To</th>
                        {ARCHITECTURE_RULE_LAYERS.map((layer) => (
                          <th key={`head-${layer}`}>{layer}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {ARCHITECTURE_RULE_LAYERS.map((fromLayer) => (
                        <tr key={`row-${fromLayer}`}>
                          <th>{fromLayer}</th>
                          {ARCHITECTURE_RULE_LAYERS.map((toLayer) => {
                            const isAllowed = architectureConfig.allowedTargets[fromLayer].includes(toLayer)
                            return (
                              <td key={`${fromLayer}->${toLayer}`}>
                                <input
                                  type="checkbox"
                                  checked={isAllowed}
                                  onChange={(event) =>
                                    updateArchitectureAllowedTarget(fromLayer, toLayer, event.target.checked)
                                  }
                                />
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <textarea
                value={architectureConfigDraft}
                onChange={(event) => setArchitectureConfigDraft(event.target.value)}
                spellCheck={false}
                rows={12}
              />
            )}
            <div className="architecture-config-actions">
              {architectureConfigMode === 'json' && (
                <button type="button" onClick={applyArchitectureConfigDraft}>
                  Apply config
                </button>
              )}
              <button type="button" onClick={resetArchitectureConfig}>
                Reset default
              </button>
            </div>
            {architectureConfigError && <p className="error">{architectureConfigError}</p>}
          </div>
        </div>

        <div className="section-card">
          <h2>Export Architecture</h2>
          <p>Save architecture rules and violations as JSON or Markdown.</p>
          <div className="actions">
            <button type="button" onClick={exportArchitectureReportJson} disabled={!scanResult || !dependencyGraph}>
              Export JSON
            </button>
            <button
              type="button"
              onClick={exportArchitectureReportMarkdown}
              disabled={!scanResult || !dependencyGraph}
            >
              Export Markdown
            </button>
          </div>
        </div>

        {architectureViolations.length > 0 && (
          <div className="section-card">
            <h2>Violation Quick Actions</h2>
            <ul className="quick-action-list">
              {architectureViolations.slice(0, 12).map((item) => (
                <li key={`arch-v-${item.kind}-${item.fromPath}-${item.toPath}`}>
                  <code>
                    [{item.kind}] {item.fromLayer}-&gt;{item.toLayer}: {item.fromPath}
                  </code>
                  <button
                    type="button"
                    className="quick-action-button"
                    onClick={() => focusViolationOnBoard(item)}
                  >
                    Show on Board
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <div className="tree right-stack">
        <div className="section-card">
          <h2>Architecture Rules Snapshot</h2>
          <pre className="report-pre">{architectureRuleLines.map((line) => `- ${line}`).join('\n')}</pre>
        </div>
        <div className="section-card">
          <h2>Violations by Layer Pair</h2>
          <pre className="report-pre">
            {architectureViolationByPair.length > 0
              ? architectureViolationByPair.map(([pair, count]) => `- ${pair}: ${count}`).join('\n')
              : '- no violations'}
          </pre>
        </div>
        <div className="section-card">
          <h2>Violation Sample</h2>
          <pre className="report-pre">
            {architectureViolations.length > 0
              ? architectureViolations
                  .slice(0, 40)
                  .map(
                    (item) =>
                      `- [${item.kind}] ${item.fromLayer}->${item.toLayer} | ${item.fromPath} -> ${item.toPath}`,
                  )
                  .join('\n')
              : '- no violations'}
          </pre>
        </div>
      </div>
    </section>
  )
}
