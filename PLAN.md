# Schematic Code Visualizer - Plan (MVP v1)

## Status
- MVP status: **Completed** (2026-04-24)
- Smoke report: `SMOKE_RESULTS.md`

## Goal
Build a web app that analyzes a selected TypeScript project folder and visualizes file structure and import/export relationships as an electronic-style schematic.

## Scope (Iteration 1)
- Language support: TypeScript (`.ts`, `.tsx`) only.
- Folder selection in browser (File System Access API).
- Parse files and build dependency graph from imports/exports.
- Visualize graph with folder-based logical blocks (PCB sections).
- Basic filters and interaction for readability.

## Core Concepts
- File = component (chip/symbol).
- Import/export relation = wiring/trace.
- Directory = logical board block (cluster).

## Architecture
1. Scanner
   - Traverse selected folder.
   - Include: `**/*.ts`, `**/*.tsx`.
   - Exclude: `node_modules`, `dist`, `build`, `.git`.

2. Analyzer
   - Parse TS/TSX via TypeScript Compiler API.
   - Extract:
     - static imports (`import ... from '...'`)
     - re-exports (`export ... from '...'`)
     - local exports (`export const`, `export function`, etc.)
   - Resolve local relative paths.

3. Graph Builder
   - Nodes:
     - `BlockNode` (directory cluster)
     - `FileNode` (file component)
   - Edges:
     - `import` edges file-to-file
     - aggregated inter-block edges (optional overlay)

4. Renderer
   - React Flow for graph rendering.
   - ELK layout:
     - first pass: block-level layout
     - second pass: file layout inside each block
   - Visual style: PCB-inspired colors, traces, ports.

## Layout Rules for Logical Blocks
- Top-level directories under `src` become primary blocks.
- Nested directories become sub-blocks (max depth 2-3 in MVP).
- Intra-block edges are light and thin.
- Inter-block edges are thicker and higher contrast.
- Many edges between two blocks can be bundled into one channel with a counter.

## UX (MVP)
- Select folder button.
- Main canvas with pan/zoom.
- Hover node: show path + exports.
- Click node: highlight incoming/outgoing edges.
- Toggles:
  - Collapse/Expand block
  - Show only inter-block edges
  - Highlight cycles
  - Search file by name

## Data Model (Draft)
- `BlockNode`
  - `id`, `name`, `path`, `parentBlockId`, `childrenBlockIds`, `fileIds`
- `FileNode`
  - `id`, `name`, `path`, `blockId`, `exports[]`, `importCount`, `exportCount`
- `GraphEdge`
  - `id`, `fromFileId`, `toFileId`, `fromBlockId`, `toBlockId`, `type`

## Technical Stack
- Vite + React + TypeScript
- `reactflow`
- `elkjs`
- `typescript`

## Implementation Roadmap
1. Project scaffold (Vite + React + TS). ✅
2. Folder picker + scanner. ✅
3. TS analyzer (imports/exports extraction). ✅
4. Graph generation (file nodes + edges). ✅
5. Block clustering by directories. ✅
6. ELK layout integration. ✅
7. PCB-style rendering + interactions. ✅
8. Filters/search/cycle highlighting. ✅
9. Smoke test on 2-3 TS repos. ✅

## Risks and Decisions
- Browser support for folder API is limited (best in Chromium).
- Path alias resolution (`tsconfig` `baseUrl/paths`) may be partial in MVP.
- Dynamic imports are out of scope for first iteration.

## Definition of Done (MVP)
- User selects a TS project folder.
- App renders file components grouped by directory blocks.
- Import/export relations are visible and navigable.
- Inter-block architecture can be inspected clearly.

## Post-MVP Focus
- Improve resolver for repo-specific internal unresolved patterns.
- Continue UI polish (readability, interaction ergonomics, visual hierarchy).
