import type { ScannedProject } from '../../lib/models'

type AboutProps = {
  scanResult: ScannedProject | null
  projectReadmeName: string | null
  projectReadmeContent: string | null
}

export function About({ scanResult, projectReadmeName, projectReadmeContent }: AboutProps) {
  return (
    <section className="panel grid about-grid">
      <div className="stats">
        <div className="section-card">
          <h2>About This App</h2>
          <p>
            Schematic Code Visualizer analyzes a selected TypeScript project and renders structure + dependency
            relations as a board-like diagram.
          </p>
          <p>
            <strong>Core idea:</strong> files as components, imports/exports as routing, folders as logical blocks.
          </p>
          <p>
            <strong>Current focus:</strong> readability modes (`classic` / `bus`), hierarchy-aware grouping, and
            interactive exploration.
          </p>
        </div>

        <div className="section-card">
          <h2>Project Context</h2>
          <p>
            <strong>Selected project:</strong> {scanResult?.rootName ?? '-'}
          </p>
          <p>
            <strong>README:</strong> {projectReadmeName ?? 'not found in project root'}
          </p>
        </div>
      </div>

      <div className="right-stack">
        <div className="section-card tree">
          <h2>Project README</h2>
          <pre className="report-pre">{projectReadmeContent ?? 'README.md not found or not loaded yet.'}</pre>
        </div>
      </div>
    </section>
  )
}
