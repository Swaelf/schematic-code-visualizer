export type Point = { x: number; y: number }
export type Rect = { x: number; y: number; width: number; height: number }

const STUB = 10
const ATTEMPT_LIMIT = 8
const NUDGE_MARGIN = 8

function rectsOverlapX(rect: Rect, x1: number, x2: number): boolean {
  const xmin = Math.min(x1, x2)
  const xmax = Math.max(x1, x2)
  return rect.x < xmax && rect.x + rect.width > xmin
}

// True when the orthogonal segment from `from` to `to` actually crosses any obstacle's
// interior. Segments that only graze a rect's boundary are not considered blocked,
// so a path can run alongside the source/target rect edges without false positives.
function segmentBlocks(from: Point, to: Point, obstacles: Rect[]): boolean {
  const horizontal = Math.abs(from.y - to.y) < 0.5
  const vertical = Math.abs(from.x - to.x) < 0.5
  if (!horizontal && !vertical) return false
  if (horizontal) {
    const y = from.y
    const x1 = Math.min(from.x, to.x)
    const x2 = Math.max(from.x, to.x)
    for (const r of obstacles) {
      if (r.x < x2 && r.x + r.width > x1) {
        if (y > r.y && y < r.y + r.height) return true
      }
    }
    return false
  }
  const x = from.x
  const y1 = Math.min(from.y, to.y)
  const y2 = Math.max(from.y, to.y)
  for (const r of obstacles) {
    if (r.y < y2 && r.y + r.height > y1) {
      if (x > r.x && x < r.x + r.width) return true
    }
  }
  return false
}

function pickFreeTrunkY(candidate: number, x1: number, x2: number, obstacles: Rect[]): number {
  let y = candidate
  for (let attempt = 0; attempt < ATTEMPT_LIMIT; attempt += 1) {
    let blocker: Rect | null = null
    for (const r of obstacles) {
      if (!rectsOverlapX(r, x1, x2)) continue
      if (y >= r.y && y <= r.y + r.height) {
        blocker = r
        break
      }
    }
    if (!blocker) return y
    const above = blocker.y - NUDGE_MARGIN
    const below = blocker.y + blocker.height + NUDGE_MARGIN
    y = Math.abs(above - candidate) <= Math.abs(below - candidate) ? above : below
  }
  return y
}

function pickDetourY(
  prefer: 'top' | 'bottom',
  source: Point,
  target: Point,
  obstacles: Rect[],
  riserSourceX: number,
  riserTargetX: number,
): number {
  const minY = Math.min(source.y, target.y)
  const maxY = Math.max(source.y, target.y)
  let limitTop = minY
  let limitBottom = maxY
  const sourceX1 = Math.min(source.x, riserSourceX)
  const sourceX2 = Math.max(source.x, riserSourceX)
  const targetX1 = Math.min(target.x, riserTargetX)
  const targetX2 = Math.max(target.x, riserTargetX)
  const trunkX1 = Math.min(riserSourceX, riserTargetX)
  const trunkX2 = Math.max(riserSourceX, riserTargetX)
  for (const r of obstacles) {
    if (
      rectsOverlapX(r, sourceX1, sourceX2) ||
      rectsOverlapX(r, targetX1, targetX2) ||
      rectsOverlapX(r, trunkX1, trunkX2)
    ) {
      limitTop = Math.min(limitTop, r.y)
      limitBottom = Math.max(limitBottom, r.y + r.height)
    }
  }
  const topY = limitTop - 30
  const bottomY = limitBottom + 30
  return prefer === 'top' ? topY : bottomY
}

// Returns the simplest orthogonal polyline from `source` to `target` that does not
// cross any obstacle rect's interior. Tries a 2-segment monotone L-shape first
// (the path closest to the direct diagonal); falls back to a 6-point Z-shape with
// stubs + a free trunk Y when both L orientations are blocked.
export function routeDirectOrthogonal(source: Point, target: Point, obstacles: Rect[]): Point[] {
  const dx = Math.abs(target.x - source.x)
  const dy = Math.abs(target.y - source.y)
  const cornerH = { x: target.x, y: source.y } // horizontal first, then vertical
  const cornerV = { x: source.x, y: target.y } // vertical first, then horizontal
  // Prefer the orientation whose first leg is the longer one — it hugs the diagonal.
  const lShapes = dx >= dy ? [cornerH, cornerV] : [cornerV, cornerH]
  for (const corner of lShapes) {
    if (
      Math.abs(corner.x - source.x) < 0.5 && Math.abs(corner.y - source.y) < 0.5
    ) continue
    if (
      Math.abs(corner.x - target.x) < 0.5 && Math.abs(corner.y - target.y) < 0.5
    ) continue
    if (
      !segmentBlocks(source, corner, obstacles) &&
      !segmentBlocks(corner, target, obstacles)
    ) {
      return [source, corner, target]
    }
  }

  const cleanLeftToRight = source.x + STUB + 4 < target.x - STUB
  if (cleanLeftToRight) {
    const riserSourceX = source.x + STUB
    const riserTargetX = target.x - STUB
    const xmin = Math.min(riserSourceX, riserTargetX)
    const xmax = Math.max(riserSourceX, riserTargetX)
    const candidate = (source.y + target.y) / 2
    const trunkY = pickFreeTrunkY(candidate, xmin, xmax, obstacles)
    return [
      source,
      { x: riserSourceX, y: source.y },
      { x: riserSourceX, y: trunkY },
      { x: riserTargetX, y: trunkY },
      { x: riserTargetX, y: target.y },
      target,
    ]
  }
  // Detour: target is at or to the left of source. Loop above by default; if obstacles
  // crowd the top, pick the bottom path.
  const riserSourceX = source.x + STUB
  const riserTargetX = target.x - STUB
  const minY = Math.min(source.y, target.y)
  const obstaclesNearTop = obstacles.some(
    (r) => r.y + r.height >= minY - 60 && r.y <= minY && rectsOverlapX(r, riserTargetX, riserSourceX),
  )
  const prefer: 'top' | 'bottom' = obstaclesNearTop ? 'bottom' : 'top'
  const detourY = pickDetourY(prefer, source, target, obstacles, riserSourceX, riserTargetX)
  return [
    source,
    { x: riserSourceX, y: source.y },
    { x: riserSourceX, y: detourY },
    { x: riserTargetX, y: detourY },
    { x: riserTargetX, y: target.y },
    target,
  ]
}
