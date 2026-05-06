export type SimplifyPoint = { x: number; y: number }

const COORD_EPS = 0.5
const SHORT_STEP = 8

function pointsClose(a: SimplifyPoint, b: SimplifyPoint): boolean {
  return Math.abs(a.x - b.x) < COORD_EPS && Math.abs(a.y - b.y) < COORD_EPS
}

// Removes collinear midpoints and tiny zig-zags (small "step" detours that go out
// and immediately back) from an orthogonal polyline. Output keeps the same start
// and end points.
export function simplifyOrthogonalPath(points: SimplifyPoint[]): SimplifyPoint[] {
  if (points.length < 3) return [...points]
  // Step 1: drop adjacent duplicates.
  const dedup: SimplifyPoint[] = [points[0]]
  for (let i = 1; i < points.length; i += 1) {
    if (!pointsClose(points[i], dedup[dedup.length - 1])) {
      dedup.push(points[i])
    }
  }

  // Step 2: collapse colinear midpoints (orthogonal).
  let result = dedup
  for (let pass = 0; pass < 8; pass += 1) {
    let changed = false
    const next: SimplifyPoint[] = []
    for (let i = 0; i < result.length; i += 1) {
      if (i > 0 && i < result.length - 1) {
        const a = result[i - 1]
        const b = result[i]
        const c = result[i + 1]
        const colinearH = Math.abs(a.y - b.y) < COORD_EPS && Math.abs(b.y - c.y) < COORD_EPS
        const colinearV = Math.abs(a.x - b.x) < COORD_EPS && Math.abs(b.x - c.x) < COORD_EPS
        if (colinearH || colinearV) {
          changed = true
          continue
        }
      }
      next.push(result[i])
    }
    result = next
    if (!changed) break
  }

  // Step 3: remove tiny step detours (a-b-c-d where b-c is a short jog
  // perpendicular to the surrounding direction and d-y ≈ a-y, or x mirror).
  for (let pass = 0; pass < 8; pass += 1) {
    let changed = false
    let i = 0
    const next: SimplifyPoint[] = []
    while (i < result.length) {
      if (i + 3 < result.length) {
        const a = result[i]
        const b = result[i + 1]
        const c = result[i + 2]
        const d = result[i + 3]

        // horizontal-vertical-horizontal pattern with tiny vertical jog
        const abH = Math.abs(a.y - b.y) < COORD_EPS
        const bcV = Math.abs(b.x - c.x) < COORD_EPS
        const cdH = Math.abs(c.y - d.y) < COORD_EPS
        if (abH && bcV && cdH && Math.abs(b.y - c.y) < SHORT_STEP && Math.abs(d.y - a.y) < SHORT_STEP) {
          // Replace b,c,d with a single straight point at (d.x, a.y).
          next.push(a)
          next.push({ x: d.x, y: a.y })
          i += 4
          changed = true
          continue
        }

        // vertical-horizontal-vertical pattern with tiny horizontal jog
        const abV = Math.abs(a.x - b.x) < COORD_EPS
        const bcH = Math.abs(b.y - c.y) < COORD_EPS
        const cdV = Math.abs(c.x - d.x) < COORD_EPS
        if (abV && bcH && cdV && Math.abs(b.x - c.x) < SHORT_STEP && Math.abs(d.x - a.x) < SHORT_STEP) {
          next.push(a)
          next.push({ x: a.x, y: d.y })
          i += 4
          changed = true
          continue
        }
      }
      next.push(result[i])
      i += 1
    }
    result = next
    if (!changed) break
  }

  // Final pass: re-collapse any newly-colinear midpoints introduced by step 3.
  for (let pass = 0; pass < 4; pass += 1) {
    let changed = false
    const next: SimplifyPoint[] = []
    for (let i = 0; i < result.length; i += 1) {
      if (i > 0 && i < result.length - 1) {
        const a = result[i - 1]
        const b = result[i]
        const c = result[i + 1]
        const colinearH = Math.abs(a.y - b.y) < COORD_EPS && Math.abs(b.y - c.y) < COORD_EPS
        const colinearV = Math.abs(a.x - b.x) < COORD_EPS && Math.abs(b.x - c.x) < COORD_EPS
        if (colinearH || colinearV) {
          changed = true
          continue
        }
      }
      next.push(result[i])
    }
    result = next
    if (!changed) break
  }

  return result
}
