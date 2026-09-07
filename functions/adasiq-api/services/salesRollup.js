// Booked sales by period, straight from Books.
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

const KEY = 'sales_rollup_v1'
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

  const token = await getAccessToken()
  const orgId = process.env.ZOHO_ORGANIZATION_ID
  const byDay = {}
  let count = 0
  let truncated = false

  for (let page = 1; page <= 12; page++) {
    const r = await axios.get('https://www.zohoapis.com/books/v3/invoices', {
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
      params: {
        organization_id: orgId, per_page: 200, page,
        sort_column: 'date', sort_order: 'A', date_start: `${year}-01-01`,
      },
      timeout: 20000, validateStatus: s => s < 500,
    })
    const batch = r.data?.invoices || []
    for (const i of batch) {
      const st = String(i.status || '').toLowerCase()
      if (st === 'draft' || st === 'void') continue
      if (COUNTED.size && !COUNTED.has(st)) continue
      const d = String(i.date || '').slice(0, 10)
      if (!d) continue
      byDay[d] = (byDay[d] || 0) + (parseFloat(i.total) || 0)
      count++
    }
    if (batch.length < 200) break
    if (page === 12) truncated = true
  }

  const rec = { year, byDay, invoices: count, truncated, at: new Date().toISOString() }
  await write(req, KEY, rec).catch(() => {})
  return { ...rec, cached: false }
}

export function sumRange(byDay, startISO, endISO) {
  let t = 0
  for (const [d, v] of Object.entries(byDay || {})) if (d >= startISO && d <= endISO) t += v
  return Math.round(t)
}
