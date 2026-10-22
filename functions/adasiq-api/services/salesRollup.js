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

export async function fetchYtdByDay(req, { year, force = false } = {}) {
  if (!force) {
    const hit = await read(req, KEY)
    if (hit?.year === year && Date.now() - new Date(hit.at).getTime() < TTL_MS) {
      return { ...hit, cached: true }
    }
  }

  // 💵 Cash basis, after discount (Mark 2026-10-17): money received by payment date.
  const { cashByDay } = await import('./cashRevenue.js')
  const { byDay, payments: count } = await cashByDay(`${year}-01-01`, `${year}-12-31`)
  const truncated = false

  const rec = { year, byDay, invoices: count, truncated, at: new Date().toISOString() }
  await write(req, KEY, rec).catch(() => {})
  return { ...rec, cached: false }
}

// Cost invoices by invoice date. Books invoice `total` is what the shop was
// billed after the partnership discount (the discount sits on the lines).
// Estimates are the list-price insurance copy and are not included.
// The brief still uses fetchYtdByDay (cash). The GET SOME meeting uses this.
const COST_KEY = 'sales_rollup_v3_cost'
export async function fetchCostByDay(req, { year, force = false } = {}) {
  if (!force) {
    const hit = await read(req, COST_KEY)
    if (hit?.year === year && Date.now() - new Date(hit.at).getTime() < TTL_MS) return { ...hit, cached: true }
  }
  const token = await getAccessToken()
  const byDay = {}
  let count = 0
  let truncated = false
  for (let page = 1; page <= 12; page++) {
    const r = await axios.get('https://www.zohoapis.com/books/v3/invoices', {
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
      params: { organization_id: process.env.ZOHO_ORGANIZATION_ID, per_page: 200, page, sort_column: 'date', sort_order: 'A', date_start: `${year}-01-01` },
      timeout: 20000, validateStatus: s => s < 500,
    })
    const batch = r.data?.invoices || []
    for (const i of batch) {
      const st = String(i.status || '').toLowerCase()
      if (!COUNTED.has(st)) continue
      const d = String(i.date || '').slice(0, 10)
      if (!d || !d.startsWith(String(year))) continue
      byDay[d] = (byDay[d] || 0) + (parseFloat(i.total) || 0)
      count++
    }
    if (batch.length < 200) break
    if (page === 12) truncated = true
  }
  const rec = { year, byDay, invoices: count, truncated, at: new Date().toISOString() }
  await write(req, COST_KEY, rec).catch(() => {})
  return { ...rec, cached: false }
}

export function sumRange(byDay, startISO, endISO) {
  let t = 0
  for (const [d, v] of Object.entries(byDay || {})) if (d >= startISO && d <= endISO) t += v
  return Math.round(t)
}
