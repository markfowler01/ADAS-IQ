// 📈 How a month really fills up (Mark 2026-11-01: "that is very normal for the industry — end of
// month numbers drives it"). Shops push cars out for their own month-end, so an even-split pace
// makes weeks 1–2 look behind every month and the last week look easy. The curve is learned from
// our own invoices: for each past month, what share of the month's sales had landed by each point
// in its working days. pace = goal × curve(share of working days done).
const GRID = 20                       // points 0, 0.05 … 1
const MIN_MONTH = 5000                // skip near-empty months (ramp-up, holidays with no work)
const FULL_TRUST = 6                  // months of history before the curve is used at full weight

const addDays = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const isBiz = iso => { const w = new Date(`${iso}T12:00:00Z`).getUTCDay(); return w !== 0 && w !== 6 }
export const businessDays = (a, b) => { let n = 0; for (let d = a; d <= b; d = addDays(d, 1)) if (isBiz(d)) n++; return n }
const monthBounds = ym => { const [y, m] = ym.split('-').map(Number); return [`${ym}-01`, new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)] }

/**
 * byDay: { 'YYYY-MM-DD': sales } (any span). months: ['YYYY-MM', …] complete months to learn from.
 * Returns { points: [GRID+1 cumulative shares], months: n used, weight } — monotonic, 0 → 1.
 */
export function learnCurve(byDay, months) {
  const curves = []
  for (const ym of months) {
    const [start, end] = monthBounds(ym), N = businessDays(start, end)
    let total = 0; for (let d = start; d <= end; d = addDays(d, 1)) total += Number(byDay[d]) || 0
    if (total < MIN_MONTH || !N) continue
    // (x = share of working days done by the end of d, y = share of sales by the end of d)
    const pts = []; let cum = 0
    for (let d = start; d <= end; d = addDays(d, 1)) { cum += Number(byDay[d]) || 0; pts.push([businessDays(start, d) / N, cum / total]) }
    const at = g => { let y = 0; for (const [x, v] of pts) { if (x <= g + 1e-9) y = Math.max(y, v) } return y }
    curves.push(Array.from({ length: GRID + 1 }, (_, i) => at(i / GRID)))
  }
  const n = curves.length, weight = Math.min(1, n / FULL_TRUST)
  const points = Array.from({ length: GRID + 1 }, (_, i) => {
    const learned = n ? curves.reduce((t, c) => t + c[i], 0) / n : i / GRID
    return weight * learned + (1 - weight) * (i / GRID)   // blend toward even split while history is thin
  })
  points[0] = 0; points[GRID] = 1
  for (let i = 1; i <= GRID; i++) points[i] = Math.max(points[i], points[i - 1])
  return { points: points.map(v => Math.round(v * 10000) / 10000), months: n, weight }
}

/** Share of the month's sales expected by `frac` (0–1) of its working days. */
export function curveAt(curve, frac) {
  const p = curve?.points; if (!p?.length) return Math.max(0, Math.min(1, frac))
  const f = Math.max(0, Math.min(1, frac)) * (p.length - 1), i = Math.floor(f)
  return i >= p.length - 1 ? p[p.length - 1] : p[i] + (p[i + 1] - p[i]) * (f - i)
}

/** The last `count` complete months before `dateStr`. */
export function priorMonths(dateStr, count = 12) {
  const out = []; let y = Number(dateStr.slice(0, 4)), m = Number(dateStr.slice(5, 7))
  for (let k = 0; k < count; k++) { m--; if (!m) { m = 12; y-- } out.push(`${y}-${String(m).padStart(2, '0')}`) }
  return out
}
