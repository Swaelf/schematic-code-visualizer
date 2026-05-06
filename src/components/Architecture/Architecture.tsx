import { ARCHITECTURE_MATCHER_LAYERS, ARCHITECTURE_RULE_LAYERS } from '../../constants'
import type { DependencyEdge, DependencyGraph, ScannedProject } from '../../lib/models'
import type {
  ArchitectureConfig,
  ArchitectureConfigMode,
  ArchitectureLayerId,
  ArchitectureViolation,
} from '../../types'

type ArchitectureProps = {
  architectureRuleLines: string[]
  architectureViolations: ArchitectureViolation[]
  architectureViolationByKind: Record<DependencyEdge['kind'], number>
  architectureLayerDistribution: Record<ArchitectureLayerId, number>
  architectureViolationByPair: Array<[string, number]>
  architectureConfig: ArchitectureConfig
  architectureConfigMode: ArchitectureConfigMode
  setArchitectureConfigMode: (mode: ArchitectureConfigMode) => void
  architectureConfigDraft: string
  setArchitectureConfigDraft: (value: string) => void
  architectureConfigError: string | null
  applyArchitectureConfigDraft: () => void
  resetArchitectureConfig: () => void
  updateArchitectureMatchers: (layer: ArchitectureLayerId, value: string) => void
  updateArchitectureAllowedTarget: (
    fromLayer: ArchitectureLayerId,
    toLayer: ArchitectureLayerId,
    nextEnabled: boolean,
  ) => void
  exportArchitectureReportJson: () => void
  exportArchitectureReportMarkdown: () => void
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
  architectureConfigMode,
  setArchitectureConfigMode,
  architectureConfigDraft,
  setArchitectureConfigDraft,
  architectureConfigError,
  applyArchitectureConfigDraft,
  resetArchitectureConfig,
  updateArchitectureMatchers,
  updateArchitectureAllowedTarget,
  exportArchitectureReportJson,
  exportArchitectureReportMarkdown,
  focusViolationOnBoard,
  scanResult,
  dependencyGraph,
}: ArchitectureProps) {
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
