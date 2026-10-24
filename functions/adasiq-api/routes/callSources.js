// 📞 "How'd you hear about us?" tags on calls (2026-10-24). Paid-ads readiness: ads and
// social posts all point at 1-844-FIX-ADAS, so the call log is where we learn which
// channel made the phone ring. Tags live in VanKV per month (call_sources_YYYY-MM =
// { [call_sid]: { source, by, at } }), separate from CallLog, so nothing in the voice
// pipeline changes.
import express from 'express'
import { getVal, setVal } from '../services/vanDatastore.js'

const router = express.Router()

export const CALL_SOURCES = ['Facebook', 'Instagram', 'LinkedIn', 'Google', 'Saw the van', 'Referral', 'Repeat customer', 'Sales stop', 'Website', 'Other']
const monthKey = iso => `call_sources_${String(iso || new Date().toISOString()).slice(0, 7)}`

function lastMonths(n) {
  const out = []
  const d = new Date()
  for (let i = 0; i < n; i++) {
    out.push(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1)).toISOString().slice(0, 7))
  }
  return out
}

// GET /api/call-sources?months=3 → { sources: { [call_sid]: {source, by, at} }, options }
router.get('/', async (req, res) => {
  try {
    const months = lastMonths(Math.min(12, Math.max(1, Number(req.query.months) || 3)))
    const sources = {}
    for (const m of months) Object.assign(sources, (await getVal(req, `call_sources_${m}`)) || {})
    res.json({ ok: true, sources, options: CALL_SOURCES })
  } catch (e) { res.status(500).json({ ok: false, error: e.message }) }
})

// POST /api/call-sources/:sid { source, timestamp }  (source '' clears the tag)
router.post('/:sid', express.json({ limit: '4kb' }), async (req, res) => {
  try {
    const sid = String(req.params.sid || '')
    const source = String(req.body?.source || '')
    if (!sid) return res.status(400).json({ ok: false, error: 'call sid required' })
    if (source && !CALL_SOURCES.includes(source)) return res.status(400).json({ ok: false, error: 'unknown source' })
    const key = monthKey(req.body?.timestamp)
    const map = (await getVal(req, key)) || {}
    if (source) map[sid] = { source, by: req.user?.name || req.user?.email || '', at: new Date().toISOString() }
    else delete map[sid]
    await setVal(req, key, map)
    res.json({ ok: true, sid, source })
  } catch (e) { res.status(500).json({ ok: false, error: e.message }) }
})

export default router
