// Monthly goal and push ratio — the two inputs the pace verdicts read.
//
// The GOAL is Mark's to set each month; it is a business decision, not a
// derived number, so it is stored and never inferred. Default $40,000, which
// is rung one of his ladder.
//
// The RATIO is derived from his own invoice history, so drift in it is real
// information rather than a setting someone forgot to change. Recomputed on
// demand (monthly, per the spec's first-Monday print) and cached — deriving it
// needs several pages of Books and cannot run inside the brief's 30s request.

import axios from 'axios'
import catalyst from 'zcatalyst-sdk-node'
import { getAccessToken } from './zoho.js'
import { deriveRatio } from './paceModel.js'
import { durable } from './durableKV.js'

const GOAL_KEY = 'pace_monthly_goal'
const RATIO_KEY = 'pace_ratio'
export const DEFAULT_GOAL = 40000
const DEFAULT_RATIO = 1.51   // measured Nov 2025 - Sep 2026, 633 invoices

function seg(req) {
  return durable(catalyst.initialize(req, { type: 'advancedio' }).cache().segment(), catalyst.initialize(req, { type: 'advancedio' }))
}

async function read(req, key, fallback) {
  try {
    const v = await seg(req).getValue(key)
    if (!v) return fallback
    return typeof v === 'string' ? JSON.parse(v) : v
  } catch { return fallback }
}

async function write(req, key, val) {
  const s = seg(req)
  const payload = JSON.stringify(val)
  try { await s.update(key, payload) } catch { await s.put(key, payload, 48) }
}

/** The goal the daily targets run off. Mark sets this; nothing derives it. */
export async function getMonthlyGoal(req) {
  const g = await read(req, GOAL_KEY, null)
  if (g && Number(g.goal) > 0) return { goal: Number(g.goal), setAt: g.setAt || null, source: 'set' }
  return { goal: DEFAULT_GOAL, setAt: null, source: 'default' }
}

export async function setMonthlyGoal(req, goal) {
  const n = Number(goal)
  if (!Number.isFinite(n) || n <= 0) throw new Error('goal must be a positive number')
  const rec = { goal: Math.round(n), setAt: new Date().toISOString() }
  await write(req, GOAL_KEY, rec)
  return rec
}

/** Cached ratio, with the default as fallback so the brief never blocks on it. */
export async function getRatio(req) {
  const r = await read(req, RATIO_KEY, null)
  if (r && Number(r.ratio) > 0) return r
  return { ratio: DEFAULT_RATIO, clamped: false, source: 'default', computedAt: null }
}

/**
 * Page Books for ~12 months and derive the ratio. Slow by design — call it
 * from its own endpoint, never from inside the brief.
 */
export async function recomputeRatio(req, { months = 12 } = {}) {
  const token = await getAccessToken()
  const orgId = process.env.ZOHO_ORGANIZATION_ID
  const start = new Date()
  start.setMonth(start.getMonth() - months)
  const dateStart = start.toISOString().slice(0, 10)

  // 💵 Cash basis (Mark 2026-10-17): pace learns from money received by payment date.
  const { invoicedRows } = await import('./salesBasis.js')   // 📊 invoiced after discount (Mark 2026-10-22)
  const invoices = (await invoicedRows(dateStart, new Date().toISOString().slice(0, 10))).map(i => ({ date: i.date, total: i.total }))

  const d = deriveRatio(invoices)
  const rec = {
    ratio: Number(d.ratio.toFixed(2)),
    raw: d.raw ? Number(d.raw.toFixed(2)) : null,
    clamped: d.clamped,
    reason: d.reason || null,
    sample: d.sample,
    pushAvg: Math.round(d.pushAvg),
    steadyAvg: Math.round(d.steadyAvg),
    invoices: invoices.length,
    computedAt: new Date().toISOString(),
    source: 'derived',
  }
  await write(req, RATIO_KEY, rec)
  return rec
}
