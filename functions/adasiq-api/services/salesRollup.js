// Cash sales by period, straight from Books payments (was booked invoices until 2026-10-17).
//
// The strip used to be about days elapsed. It is about dollars. This pages
// invoices from Jan 1 once and rolls them up per day, so day / week / month /
// quarter / year all come off one fetch.
//
// Cached for six hours. The brief runs once a day, but forced runs happen a
// lot while we are iterating, and each uncached call is three round trips to
// Books inside a 30s gateway budget.
import axios from 'axios'
import catalyst from 'zcatalyst-sdk-node'
import { getAccessToken } from './zoho.js'

function seg(req) { return catalyst.initialize(req, { type: 'advancedio' }).cache().segment() }
async function read(req, key) {
  try {
    const v = await seg(req).getValue(key)
    if (!v) return null
    return typeof v === 'string' ? JSON.parse(v) : v
  } catch { return null }
}
async function write(req, key, val) {
  const s = seg(req), payload = JSON.stringify(val)
  try { await s.update(key, payload) } catch { await s.put(key, payload, 48) }
}

const KEY = 'sales_rollup_v2_cash'
const TTL_MS = 6 * 60 * 60 * 1000

// Money that is actually money. A draft is a document, not a sale, and a void
// is a sale that stopped existing. Everything else Mark has earned.
const COUNTED = new Set(['sent', 'overdue', 'paid', 'partially_paid', 'viewed', 'unpaid'])

// 📊 Invoiced sales after discount by invoice date (Mark 2026-10-22: "everything
// invoiced sales after discount"). Same numbers as the GET SOME meeting.
export async function fetchYtdByDay(req, opts = {}) { return fetchCostByDay(req, opts) }

export function sumRange(byDay, startISO, endISO) {
  let t = 0
  for (const [d, v] of Object.entries(byDay || {})) if (d >= startISO && d <= endISO) t += v
  return Math.round(t)
}
