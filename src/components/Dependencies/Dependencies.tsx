import type { DependencyEdge, FileAnalysis } from '../../lib/models'

type DependenciesProps = {
  topConnectedFiles: FileAnalysis[]
  previewEdges: DependencyEdge[]
}

export function Dependencies({ topConnectedFiles, previewEdges }: DependenciesProps) {
  return (
    <section className="panel grid dependencies-grid">
      <div className="stats">
        <div className="section-card">
          <h2>Top Connected Files</h2>
          {topConnectedFiles.length > 0 ? (
            <ul className="flat-list">
              {topConnectedFiles.map((file) => (
                <li key={file.path}>
                  <code>{file.path}</code> ({file.resolvedImports.length} links, {file.exports.length} exports)
                </li>
              ))}
            </ul>
          ) : (
            <p>No dependency data yet.</p>
          )}
        </div>
      </div>

      <div className="right-stack">
        <div className="section-card tree">
          <h2>Dependency Preview (first 20 edges)</h2>
          <pre className="report-pre">
            {previewEdges.length > 0
              ? previewEdges.map((edge) => `${edge.fromPath} -> ${edge.toPath}`).join('\n')
              : 'Scan a folder to generate dependency edges.'}
          </pre>
        </div>
      </div>
    </section>
  )
}
