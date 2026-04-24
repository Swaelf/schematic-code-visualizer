# Schematic Code Visualizer (MVP v1)

Web app for the first iteration of your idea: scan a local TypeScript project and show its directory structure as a base for future schematic/PCB-style dependency visualization.

## Current Features

- Folder selection via File System Access API (`showDirectoryPicker`).
- Recursive scan of `.ts` and `.tsx` files.
- Excludes directories: `node_modules`, `.git`, `dist`, `build`.
- Tree preview with file and directory counters.
- TypeScript AST analysis for static imports and exports.
- Internal dependency graph extraction (relative imports only in MVP).
- Dependency summary (edge count, unresolved imports, top connected files).
- Interactive dependency canvas with directory blocks.
- Two modes: `File-Level` and aggregated `Inter-Block` links.
- ELK-based auto layout for block positioning.
- Cycle detection and highlight mode.
- Direction filters (`all`, `incoming`, `outgoing`) for selected node.
- `tsconfig.json` alias resolution (`baseUrl` + `paths`) for import links.
- Dependency analysis runs in a Web Worker to keep UI responsive.
- File search (by name or path) with match highlighting.
- Block collapse/expand controls for dense file-level graphs.
- Hover details for file path and exported symbols.

## Tech Stack

- React + TypeScript
- Vite

## Run

```bash
npm install
npm run dev
```

Open the local URL from Vite (usually `http://localhost:5173`).

## Build

```bash
npm run build
```

## Smoke Tests

Run parser/resolver smoke checks on local TypeScript repositories:

```bash
npm run smoke -- <repo-path-1> <repo-path-2> <repo-path-3>
```

The report includes `unresolvedExternal` vs `unresolvedInternal` to separate package imports from likely local/alias misses.

Example:

```bash
npm run smoke -- .\smoke-repos\zustand .\smoke-repos\tsup .\smoke-repos\nanostores
```

Alias/extends fixture check:

```bash
npm run smoke -- .\smoke-fixtures\alias-extends
```

## Git Churn Report

Generate a git churn JSON that can be imported in `Diagnostics -> Git Churn`:

```bash
npm run git-churn -- --since "180 days ago" --out git-churn-report.json
```

Optional arguments:

- `--repo <path>`: repository root (defaults to current directory)
- `--since <git-date-expression>`: date range for `git log`
- `--out <file>`: output JSON filename/path (relative to repo root by default)

## Browser Notes

For folder selection, use a Chromium-based browser (Chrome/Edge) because this MVP relies on the File System Access API.

## Next Planned Steps

- Smoke test on 2-3 real TypeScript repositories.
- Capture issues and polish UX for MVP stability.
