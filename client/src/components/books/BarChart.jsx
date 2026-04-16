import { ORANGE } from './shared'

export default function BarChart({ months }) {
  if (!months || months.length === 0) return null
  const maxVal = Math.max(...months.map(m => Math.max(m.revenue, m.expenses)), 1)
  const H = 130
  const barW = 14
  const gap = 4
  const groupW = barW * 2 + gap + 6
  const totalW = months.length * groupW

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${totalW} ${H + 20}`} style={{ width: '100%', minWidth: totalW }}>
        {months.map((m, i) => {
          const revH = Math.max(2, (m.revenue / maxVal) * H)
          const expH = Math.max(2, (m.expenses / maxVal) * H)
          const x = i * groupW + 3
          return (
            <g key={m.key}>
              {/* Revenue bar */}
              <rect x={x} y={H - revH} width={barW} height={revH}
                fill={ORANGE} rx="2" opacity="0.85" />
              {/* Expense bar */}
              <rect x={x + barW + gap} y={H - expH} width={barW} height={expH}
                fill="#6b7280" rx="2" opacity="0.5" />
              {/* Month label */}
              <text x={x + barW} y={H + 14} textAnchor="middle"
                fontSize="8" fill="#999">{m.label}</text>
            </g>
          )
        })}
        {/* Legend */}
        <rect x={0} y={0} width={8} height={8} fill={ORANGE} rx="1" opacity="0.85" />
        <text x={11} y={8} fontSize="8" fill="#888">Revenue</text>
        <rect x={55} y={0} width={8} height={8} fill="#6b7280" rx="1" opacity="0.5" />
        <text x={66} y={8} fontSize="8" fill="#888">Expenses</text>
      </svg>
    </div>
  )
}
