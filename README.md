# Schematic Code Visualizer

Web app that scans a local TypeScript project and renders its structure + dependency graph as a board-like, schematic-style diagram. Files behave like components, imports like routing, folders like logical blocks.

## Tabs

- **Overview** — pick a folder, scan summary, structure visualisations (treemap / dendrogram / tree).
- **Board** — interactive dependency canvas (the main view). File-level and inter-block modes, multiple routing styles, search, selection-driven highlights, fullscreen.
- **Dependencies** — top-connected files and a sample of resolved edges.
- **Diagnostics** — resolver/layout status, code health, refactor signals, JSON/Markdown report export, baseline diff import, git churn import, live git branch compare (via local API server) or imported branch compare JSON.
- **Architecture** — layer matchers and an allowed-target matrix, violation list with "Show on Board" jump links, JSON/Markdown report export.
- **About** — project context + README preview.

## Features

### Project scan & analysis
- Folder selection via the File System Access API (`showDirectoryPicker`).
- Recursive scan of `.ts` / `.tsx` files (excludes `node_modules`, `.git`, `dist`, `build`).
- TypeScript AST analysis for static imports + exports.
- `tsconfig.json` alias resolution (`baseUrl` + `paths`, with `extends` chain).
- Internal dependency graph extraction (relative + alias-resolved imports).
- External imports tracked separately — visualised as a synthetic **External** block pinned to the left of the canvas with one chip per package.
- Worker-based analysis to keep the UI responsive on larger repos.

### Board / canvas
- Two graph modes: **File-Level** (hierarchical folders containing file chips) and **Inter-Block** (top-level folders only).
- Two routing styles: **classic** (smooth lines) and **bus** (orthogonal hierarchical routing — see below).
- Folder packing: balanced or dense.
- Auto folder depth or manual depth (1-8 / any) with one-click collapse/expand of the selected folder + collapse-all toggle.
- File search (name or path) with match highlighting.
- Direction filter on selected node (`all` / `incoming` / `outgoing`).
- Edge-kind filter: `runtime` / `type` / `re-export`.
- Selection-aware edge colouring with `direction` or `kind` priority.
- Cycle detection + cycle-edge highlight (Tarjan SCC).
- Architecture-violation highlight (per the configured layer rules).
- Baseline diff overlay — load a previously exported analysis JSON and see new vs baseline edges/nodes; `Show only new` filter.
- Branch diff overlay — load (or live-fetch) a branch compare JSON and tint added/modified/deleted/renamed file paths; `Highlight only changed edges` to filter the canvas.
- Selection panel under the canvas: **Imports** (files this file imports) and **Used by** (files importing this file) with click-through navigation; works for synthetic External chips too.
- Fullscreen toggle for the canvas.

### Bus routing (orthogonal, hierarchical)

Implemented in 5 phases (full notes were in `BUS_ROUTING_PLAN.md`):

- **Phase 0-1** — geometry extracted to `src/lib/bus-router.ts`; same-folder edges route inside the parent rectangle as a 6-point orthogonal path that dodges sibling rects, instead of escaping the folder.
- **Phase 2** — cross-folder routing decomposes into per-level segments. Each ancestor folder gets its own export/import boundary pins; the wire is the concatenation of `routeChannel` calls inside each ancestor.
- **Phase 3** — pin Y is assigned bottom-up by linked-child Y, so adjacent-rank wires fan out instead of crossing.
- **Phase 4** — visible pin nubs rendered on each folder's left/right edge.
- **Phase 5** — `npm run smoke-bus` smoke test asserts geometric invariants on a hand-built fixture.

### Highlighted-route simplification

Two Board toggles affect how *highlighted* edges (those touching the selected node) are drawn:

- **Simplify highlighted routes** — bypass the bus router for highlighted edges and draw a direct orthogonal path. Tries a 2-segment monotone L first (hugging the source→target diagonal), falls back to a 6-point Z with a free trunk Y. Obstacle set is narrowed to the currently-highlighted nodes only — unrelated dimmed nodes are transparent so the wire takes a much straighter line.
- **Trace into collapsed folders** — when an edge's other end sits inside a collapsed folder, redirect it to the folder's boundary (dashed line) instead of culling.

### Diagnostics computed views

Computed inside the **Diagnostics** tab from the dependency graph:

- Hotspots (centrality + LOC weight).
- Potential dead exports.
- Top cycle groups.
- Risk by file / by block.
- Refactor signals: orphan runtime modules, re-export hubs / bottlenecks / chains, duplicate utility groups.
- Git churn hotspots and branch-compare hotspots, both centrality-weighted.

## Run

```bash
npm install
npm run dev
```

Open the local URL printed by Vite (typically `http://localhost:5173`).

## Build

```bash
npm run build
```

## Smoke tests

Real-repo parser/resolver smoke checks (multiple paths supported):

```bash
npm run smoke -- <repo-path-1> <repo-path-2> <repo-path-3>
```

Reports `unresolvedExternal` vs `unresolvedInternal` to separate package imports from likely local/alias misses.

Bus-router geometric smoke (hand-built fixture, asserts no segment crosses a non-source/non-target file rect, intra-folder paths stay inside the parent, cross-folder paths populate the correct pin sets):

```bash
npm run smoke-bus
```

## Git churn report

Generate a JSON that can be imported into `Diagnostics → Git Churn`:

```bash
npm run git-churn -- --since "180 days ago" --out git-churn-report.json
```

Optional: `--repo <path>`, `--since <git-date-expression>`, `--out <file>`.

## Git branch-compare report

Generate a JSON that can be imported into `Diagnostics → Git Branch Compare`:

```bash
npm run git-compare -- --base main --target HEAD --out git-branch-compare-report.json
```

Optional: `--repo <path>`, `--base <ref>`, `--target <ref>`, `--out <file>`.

## Live git compare (no export)

Run a small local API server, then point the app at it from the Diagnostics tab:

```bash
npm run git-live
```

Default: `http://127.0.0.1:3031`. Endpoints:

- `GET /api/git/health`
- `GET /api/git/refs?repo=<absolute-path>`
- `GET /api/git/log?repo=<absolute-path>&ref=<ref>&limit=60`
- `GET /api/git/compare?repo=<absolute-path>&base=<ref-or-hash>&target=<ref-or-hash>`

Override host/port with `GIT_LIVE_HOST` / `GIT_LIVE_PORT`.

In Diagnostics → Git Branch Compare:

1. Set the Git API URL and a local repo path.
2. **Load refs**.
3. Pick base/target branches (and optional commit overrides).
4. **Run live compare** — the result becomes the active branch overlay on the Board.

## Source layout

```
src/
  App.tsx                 # session state, derived memo chain, tab dispatch
  types.ts                # cross-component type aliases
  constants.ts            # default architecture config + storage key
  components/
    About/  Architecture/  Board/  Dependencies/  Diagnostics/  Overview/  TabNav/
                          # one folder per tab; each has Component.tsx + index.ts
                          # (and types.ts for Board/Diagnostics)
    BusEdge.tsx ClassicEdge.tsx  CanvasNavWheel.tsx
    ChipFileNode.tsx FolderBlockNode.tsx
    ProjectStructureViz.tsx
  lib/
    analyzer.ts             # AST → dependency graph
    analyzer-worker-client.ts
    bus-router.ts           # hierarchical orthogonal routing
    direct-router.ts        # monotone-L direct routing for highlights
    elk-layout.ts           # block-level layout (compact pack + ELK)
    graph-builder.ts        # dependency graph → ReactFlow nodes/edges
    models.ts  scanner.ts  path-utils.ts  tree-view.ts  tsconfig-reader.ts
  utils/                    # one file per pure helper
  workers/dependency.worker.ts
scripts/
  smoke-test.ts             # real-repo analyzer smoke
  bus-router-smoke.ts       # router invariants smoke
  git-churn-report.ts  git-branch-compare-report.ts  git-live-server.ts
smoke-fixtures/             # tiny TS fixtures for alias/extends checks
```

## Browser notes

Folder selection requires a Chromium-based browser (Chrome / Edge) — the rest of the UI relies on the File System Access API, which isn't yet shipped in Firefox/Safari.
