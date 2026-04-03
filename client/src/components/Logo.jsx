/**
 * Avails logo — a mini 4x4 heatmap grid representing overlapping availability.
 * Teal cells at varying opacities on a dark background.
 */
export default function Logo({ size = 32 }) {
  const cellSize = size * 0.175
  const gap = size * 0.05
  const padding = size * 0.12
  const radius = size * 0.2
  const cellRadius = size * 0.04

  // Heatmap pattern — represents the core "overlapping availability" concept
  const cells = [
    // row 1
    0, 0.25, 0, 0.25,
    // row 2
    0.25, 0.5, 0.75, 0.25,
    // row 3
    0, 0.75, 1, 0.5,
    // row 4
    0, 0.25, 0.5, 0,
  ]

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} fill="none">
      <rect width={size} height={size} rx={radius} fill="#1a1a1a" />
      {cells.map((opacity, i) => {
        const row = Math.floor(i / 4)
        const col = i % 4
        const x = padding + col * (cellSize + gap)
        const y = padding + row * (cellSize + gap)
        return (
          <rect
            key={i}
            x={x}
            y={y}
            width={cellSize}
            height={cellSize}
            rx={cellRadius}
            fill={opacity > 0 ? `rgba(13, 148, 136, ${opacity})` : 'rgba(255, 255, 255, 0.06)'}
          />
        )
      })}
    </svg>
  )
}
