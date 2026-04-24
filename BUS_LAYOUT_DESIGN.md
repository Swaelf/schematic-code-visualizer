# Bus Layout Design (Folder-as-Component)

## Objective
Define a deterministic, readable, single-layer bus routing model where:
- each folder behaves like a component,
- file-level imports/exports are aggregated into folder buses,
- crossing is acceptable but wires should avoid running over chip bodies.

This document specifies the model before implementation.

## Scope
- In scope:
  - single-layer routing,
  - import/export buses inside folder blocks,
  - boundary pins for folder-to-folder connectivity,
  - per-segment edge mapping for precise highlighting.
- Out of scope:
  - multi-layer autoroute,
  - crossing-free guarantees,
  - CAD-grade optimization.

## Visual Semantics
- File node:
  - left pins: import side,
  - right pins: export side.
- Folder block:
  - top bus: `IMPORT_BUS`,
  - bottom bus: `EXPORT_BUS`,
  - side boundary pins for external connectivity.
- Colors:
  - imports (incoming relative to selected node): green,
  - exports (outgoing relative to selected node): orange.

## Core Model

### Node Types
1. `FolderNode` (can contain folders/files)
2. `FileNode` (leaf)
3. `BoundaryPin` (folder interface pin)

### Edge Classes
1. `InternalFileEdge`
   - source and target are files within the same folder.
2. `CrossFolderEdge`
   - source and target belong to different folders.
3. `AggregatedBusEdge`
   - visual segment on a bus carrying one or more logical edges.

### Hierarchy Rule
- A folder can be rendered in:
  - `expanded` mode: shows file nodes and buses.
  - `collapsed` mode: acts as one component with aggregated pins/counts.

## Data Structures

```ts
type LogicalEdgeId = string

type FolderBusLayout = {
  folderId: string
  importBus: BusLine
  exportBus: BusLine
  fileTaps: Record<string, FileTapLayout> // key: fileId
  boundaryPins: BoundaryPins
  segments: BusSegment[]
}

type BusLine = {
  id: string
  y: number
  xStart: number
  xEnd: number
}

type FileTapLayout = {
  fileId: string
  importTapX: number
  exportTapX: number
}

type BoundaryPins = {
  leftImportPin: PinLayout
  rightExportPin: PinLayout
}

type PinLayout = {
  id: string
  x: number
  y: number
}

type BusSegment = {
  id: string
  polyline: Array<{ x: number; y: number }>
  logicalEdgeIds: LogicalEdgeId[]
  lane: number
}
```

## Routing Strategy (Single Layer)

### Inside Folder (Expanded)
1. Place `IMPORT_BUS` near folder top.
2. Place `EXPORT_BUS` near folder bottom.
3. For each file:
   - import leg: bus -> file left side (downward branch),
   - export leg: file right side -> bus (downward branch to export bus).
4. Keep buses horizontal; branches vertical with optional 45-degree chamfer at corners.

### Across Folders
1. Convert cross-folder logical edges to boundary-pin connectivity:
   - source folder `EXPORT` pin -> target folder `IMPORT` pin.
2. Use deterministic lane assignment for repeated folder pairs.
3. Support trunk-like grouped paths for same folder-pair channels.

## Highlighting and Traceability
- Each rendered bus segment stores `logicalEdgeIds`.
- On selecting a file/edge:
  - compute relevant logical edge set,
  - highlight only segments containing those ids.
- This preserves precise tracing despite aggregation.

## API Proposal

```ts
function buildFolderBusLayouts(graph: DependencyGraph, hierarchy: FolderTree): FolderBusLayoutMap

function buildRenderedSegments(
  folderLayouts: FolderBusLayoutMap,
  mode: 'expanded' | 'collapsed'
): RenderedEdge[]

function resolveHighlightSegments(
  selectedNodeId: string | null,
  selectedDirection: 'all' | 'incoming' | 'outgoing',
  segmentIndex: SegmentEdgeIndex
): Set<string> // segment ids
```

## Incremental Implementation Plan

### Phase 1
- Implement folder-local buses (`IMPORT_BUS`, `EXPORT_BUS`) for top-level folders.
- Keep current layout engine, only change edge rendering logic.
- Keep `classic/bus` switch for comparison.

### Phase 2
- Add boundary pins and cross-folder trunk edges.
- Add lane assignment and stable channel ordering.

### Phase 3
- Add collapsed-folder behavior with aggregated counts.
- Add segment-to-logical-edge index for accurate highlights.

## Quality Gates
1. No edge drawn through chip body in normal cases.
2. Bus view is visibly cleaner than classic for medium repos.
3. Selection highlighting remains accurate for individual file edges.
4. Existing features keep working:
   - search,
   - cycles,
   - incoming/outgoing filters,
   - collapse/expand.

## Open Questions
1. Boundary pins side convention:
   - strict left/right by semantics, or adaptive by layout direction?
2. Bus lane spacing defaults:
   - fixed px vs density-based scaling.
3. Folder recursion depth:
   - full recursion now vs cap (e.g., 2 levels) for first rollout.
