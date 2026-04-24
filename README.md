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

## Browser Notes

For folder selection, use a Chromium-based browser (Chrome/Edge) because this MVP relies on the File System Access API.

## Next Planned Steps

- Add cycle highlighting and import direction filters.
- Add `tsconfig` alias (`baseUrl`, `paths`) resolution.
- Reduce bundle size (move heavy analysis code to Web Worker / split chunks).
