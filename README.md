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

## Git Branch Compare Report

Generate a branch compare JSON that can be imported in `Diagnostics -> Git Branch Compare`:

```bash
npm run git-compare -- --base main --target HEAD --out git-branch-compare-report.json
```

Optional arguments:

- `--repo <path>`: repository root (defaults to current directory)
- `--base <ref>`: base branch/ref (for example `main`)
- `--target <ref>`: target branch/ref (for example `feature/my-branch` or `HEAD`)
- `--out <file>`: output JSON filename/path (relative to repo root by default)

## Live Git Compare (Local Repo, No Export)

Run local git API server:

```bash
npm run git-live
```

By default it starts on `http://127.0.0.1:3031` and exposes:

- `GET /api/git/health`
- `GET /api/git/refs?repo=<absolute-path>`
- `GET /api/git/log?repo=<absolute-path>&ref=<ref>&limit=60`
- `GET /api/git/compare?repo=<absolute-path>&base=<ref-or-hash>&target=<ref-or-hash>`

Then in the app open `Diagnostics -> Git Branch Compare`:

1. Set Git API URL and local repository path.
2. Load refs.
3. Choose base/target branch or commit overrides.
4. Run live compare (result is applied directly to Board branch overlay).

## Browser Notes

For folder selection, use a Chromium-based browser (Chrome/Edge) because this MVP relies on the File System Access API.

## Next Planned Steps

- Smoke test on 2-3 real TypeScript repositories.
- Capture issues and polish UX for MVP stability.
