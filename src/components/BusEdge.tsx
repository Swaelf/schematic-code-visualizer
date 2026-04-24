import { BaseEdge, EdgeLabelRenderer, type EdgeProps } from '@xyflow/react'

type BusEdgeData = {
  busLane?: number
  busCount?: number
  points?: Array<{ x: number; y: number }>
  logicalEdgeId?: string
  logicalEdgeIds?: string[]
  segmentIds?: string[]
  highlightedSegmentIds?: string[]
}

type Point = { x: number; y: number }

function pathWithChamfer(points: Point[], chamfer = 10) {
  if (points.length < 2) {
    return ''
  }

  const safe = [...points]
  const pathParts: string[] = [`M ${safe[0].x} ${safe[0].y}`]

  for (let index = 1; index < safe.length - 1; index += 1) {
    const previous = safe[index - 1]
    const current = safe[index]
    const next = safe[index + 1]

    const inVector = { x: current.x - previous.x, y: current.y - previous.y }
    const outVector = { x: next.x - current.x, y: next.y - current.y }

    const inLength = Math.hypot(inVector.x, inVector.y)
    const outLength = Math.hypot(outVector.x, outVector.y)
    if (inLength < 0.1 || outLength < 0.1) {
      pathParts.push(`L ${current.x} ${current.y}`)
      continue
    }

    const inUnit = { x: inVector.x / inLength, y: inVector.y / inLength }
    const outUnit = { x: outVector.x / outLength, y: outVector.y / outLength }

    const inCut = Math.min(chamfer, inLength / 2)
    const outCut = Math.min(chamfer, outLength / 2)

    const beforeCorner = { x: current.x - inUnit.x * inCut, y: current.y - inUnit.y * inCut }
    const afterCorner = { x: current.x + outUnit.x * outCut, y: current.y + outUnit.y * outCut }

    pathParts.push(`L ${beforeCorner.x} ${beforeCorner.y}`)
    pathParts.push(`L ${afterCorner.x} ${afterCorner.y}`)
  }

  const last = safe[safe.length - 1]
  pathParts.push(`L ${last.x} ${last.y}`)

  return pathParts.join(' ')
}

export function BusEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  markerEnd,
  style,
  label,
  data,
}: EdgeProps) {
  const edgeData = (data ?? {}) as BusEdgeData
  const lane = edgeData.busLane ?? 0
  const count = edgeData.busCount ?? 1
  const laneOffset = (lane - (count - 1) / 2) * 8

  const fallbackMidX = sourceX + (targetX - sourceX) * 0.5 + laneOffset
  const fallbackPoints = [
    { x: sourceX, y: sourceY },
    { x: sourceX + 18, y: sourceY },
    { x: fallbackMidX, y: sourceY },
    { x: fallbackMidX, y: targetY },
    { x: targetX - 18, y: targetY },
    { x: targetX, y: targetY },
  ]
  const points = edgeData.points && edgeData.points.length > 1 ? edgeData.points : fallbackPoints
  const path = pathWithChamfer(points, 8)
  const segmentIds = edgeData.segmentIds ?? []
  const highlightedSegments = new Set(edgeData.highlightedSegmentIds ?? [])

  const middlePoint = points[Math.floor(points.length / 2)] ?? { x: fallbackMidX, y: sourceY + (targetY - sourceY) * 0.5 }
  const labelX = middlePoint.x
  const labelY = middlePoint.y

  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />
      {segmentIds.length > 0 && highlightedSegments.size > 0
        ? segmentIds.map((segmentId, index) => {
            if (!highlightedSegments.has(segmentId)) {
              return null
            }
            const from = points[index]
            const to = points[index + 1]
            if (!from || !to) {
              return null
            }
            return (
              <path
                key={`${id}:${segmentId}`}
                d={`M ${from.x} ${from.y} L ${to.x} ${to.y}`}
                fill="none"
                stroke={String(style?.stroke ?? '#e8f5ff')}
                strokeWidth={Math.max(Number(style?.strokeWidth ?? 2), 2.8)}
                strokeLinecap="round"
                opacity={0.95}
              />
            )
          })
        : null}
      {label ? (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: 'none',
              color: '#b9f7cf',
              fontSize: 11,
              fontWeight: 700,
              background: 'rgba(6, 20, 35, 0.95)',
              border: '1px solid rgba(111, 220, 154, 0.3)',
              borderRadius: 6,
              padding: '2px 6px',
            }}
            className="nodrag nopan"
          >
            {String(label)}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  )
}
