// PartsTech punchout routes (2026-09-22). Staff side mounted on the
// estimator router (session start, manual pull, status); the callback is a
// public router PartsTech posts to, checked with the same HMAC token scheme
// as the customer approval link.
import express from 'express'
import { createQuoteSession, quoteInfo, ordersToLines, partsTechConfigured, maskPartsTech } from '../services/partstech.js'
import { makeEstimateToken, verifyEstimateToken } from './estimatorMore.js'

const JOB_NAME = 'Parts — PartsTech'
const cfgKey = id => `partstech_est:${String(id).slice(0, 40)}`
const apiBase = req => (process.env.API_PUBLIC_BASE || `https://${req.get('host')}/server/adasiq-api`).replace(/\/$/, '')
const appBase = req => (process.env.WEB_BASE_URL || `https://${req.get('host')}/app`).replace(/\/$/, '')

async function readSession(req, I, estId) {
  const rows = I.unwrap(await I.zcql(req, `SELECT ROWID, config_value FROM AppConfig WHERE config_key = '${cfgKey(estId)}' LIMIT 1`), 'AppConfig')
  return rows[0] ? { rowid: String(rows[0].ROWID), ...I.json(rows[0].config_value, {}) } : null
}
async function writeSession(req, I, estId, data) {
  const cur = await readSession(req, I, estId)
  const t = I.tbl(req, 'AppConfig')
  const value = JSON.stringify(data).slice(0, 9000)
  if (cur?.rowid) await t.updateRow({ ROWID: cur.rowid, config_value: value }); else await t.insertRow({ config_key: cfgKey(estId), config_value: value })
}

/** Put PartsTech orders on the estimate. Same session twice replaces its lines instead of doubling them. */
export async function importOrders(req, I, estId, orders, meta) {
  const est = await I.getEst(req, estId)
  if (!est) throw Object.assign(new Error('Estimate not found'), { status: 404 })
  if (est.status === 'invoiced') throw Object.assign(new Error('Invoiced estimates are locked.'), { status: 409 })
  const fresh = ordersToLines(orders, meta)
  if (!fresh.length) return { added: 0, estimate: est }
  const jobs = await I.getJobs(req, estId)
  let job = jobs.find(j => j.name === JOB_NAME)
  const tag = meta.sessionId ? `session ${String(meta.sessionId).slice(0, 10)}` : null
  if (job) {
    const keep = (job.lines || []).filter(l => !(tag && String(l.notes || '').includes(tag)))
    await I.tbl(req, I.T.job).updateRow({ ROWID: String(job.id), ...I.jobToRow({ lines: [...keep, ...fresh], updated_at: I.now() }) })
  } else {
    const row = await I.tbl(req, I.T.job).insertRow(I.jobToRow({
      estimate_id: est.id, sort: jobs.length ? Math.max(...jobs.map(x => x.sort)) + 1 : 0, name: JOB_NAME, invoice_description: 'Parts',
      category: 'mechanical', status: 'recommended', lines: fresh, notes: 'Parts quoted/ordered through PartsTech. Move lines onto the right job if you want them grouped.', created_at: I.now(), updated_at: I.now(),
    }))
    job = { id: String(row.ROWID) }
  }
  const estimate = await I.recompute(req, estId, { touchedJobId: String(job.id) })
  return { added: fresh.reduce((n, l) => n + l.parts.length, 0), lines: fresh.length, estimate }
}

export function mountPartsTech(R, I) {
  // Is it connected? (ids only — keys never leave the server)
  R.get('/partstech/status', async (req, res) => {
    try { const s = await I.loadSettings(req); res.json({ ok: true, ...maskPartsTech(s) }) } catch (e) { I.fail(res, e, 'partstech status') }
  })
  // Start a punchout session on this estimate's VIN. Returns the URL to open in a new tab.
  R.post('/:id/partstech/session', I.staffOnly, async (req, res) => {
    try {
      const s = await I.loadSettings(req)
      if (!partsTechConfigured(s)) return res.status(409).json({ error: 'PartsTech is not connected yet — paste the partner + user keys in Estimator settings.', not_connected: true })
      const est = await I.getEst(req, req.params.id)
      if (!est) return res.status(404).json({ error: 'Estimate not found' })
      if (est.status === 'invoiced') return res.status(409).json({ error: 'Invoiced estimates are locked.' })
      const vin = String(est.vin || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase()
      if (vin.length !== 17) return res.status(400).json({ error: 'Add the full 17-character VIN first — PartsTech opens on the VIN.' })
      const t = encodeURIComponent(makeEstimateToken(`partstech:${est.id}`))
      const urls = {
        callbackUrl: `${apiBase(req)}/api/public/partstech/callback?est=${encodeURIComponent(est.id)}&t=${t}&kind=quote`,
        callbackOrderUrl: `${apiBase(req)}/api/public/partstech/callback?est=${encodeURIComponent(est.id)}&t=${t}&kind=order`,
        returnUrl: `${appBase(req)}/?partstech_return=${encodeURIComponent(est.id)}`,
      }
      const { sessionId, redirectUrl } = await createQuoteSession(s, { vin, urls, poNumber: est.number })
      await writeSession(req, I, est.id, { sessionId, at: I.now(), by: I.who(req), vin })
      console.log(`[partstech] session ${sessionId} for estimate ${est.number} (${vin})`)
      res.json({ ok: true, session_id: sessionId, url: redirectUrl })
    } catch (e) { I.fail(res, e, 'partstech session') }
  })
  // The callback didn't arrive (or Mark wants to re-pull): ask PartsTech for the session's quote.
  R.post('/:id/partstech/pull', I.staffOnly, async (req, res) => {
    try {
      const s = await I.loadSettings(req)
      if (!partsTechConfigured(s)) return res.status(409).json({ error: 'PartsTech is not connected yet.', not_connected: true })
      const sess = await readSession(req, I, req.params.id)
      if (!sess?.sessionId) return res.status(404).json({ error: 'No PartsTech session on this estimate yet — press Shop parts first.' })
      const info = await quoteInfo(s, sess.sessionId)
      const orders = info?.orders || info?.quote?.orders || []
      const out = await importOrders(req, I, req.params.id, orders, { action: 'SUBMIT_QUOTE', sessionId: sess.sessionId, poNumber: (await I.getEst(req, req.params.id))?.number })
      res.json({ ok: true, added: out.added, estimate: out.estimate, raw_orders: orders.length })
    } catch (e) { I.fail(res, e, 'partstech pull') }
  })
}

/** Public: PartsTech posts the cart here (SUBMIT_QUOTE) or the placed orders (PURCHASE). */
export function partsTechPublicRouter(I) {
  const r = express.Router()
  r.post('/callback', async (req, res) => {
    const estId = String(req.query.est || '')
    if (!estId || !verifyEstimateToken(String(req.query.t || ''), `partstech:${estId}`)) return res.status(401).json({ error: 'Bad token' })
    try {
      const body = req.body || {}
      const action = String(body.action || (req.query.kind === 'order' ? 'PURCHASE' : 'SUBMIT_QUOTE')).toUpperCase()
      const sess = await readSession(req, I, estId)
      if (sess?.sessionId && body.sessionId && String(body.sessionId) !== String(sess.sessionId)) console.log(`[partstech] callback session ${body.sessionId} ≠ stored ${sess.sessionId} for estimate ${estId} — importing anyway`)
      const est = await I.getEst(req, estId)
      const out = await importOrders(req, I, estId, body.orders || [], { action, sessionId: body.sessionId || sess?.sessionId || '', poNumber: est?.number || '' })
      await writeSession(req, I, estId, { ...(sess || {}), sessionId: body.sessionId || sess?.sessionId || '', last_callback: I.now(), last_action: action, last_parts: out.added })
      console.log(`[partstech] ${action} → estimate ${est?.number || estId}: ${out.added} part(s) on ${out.lines || 0} line(s)`)
      // Awaited before answering — Catalyst freezes the function after the response.
      try { const { postToCliqChannelById, MARK_ALERT_CHANNEL_ID } = await import('../services/cliq.js'); await postToCliqChannelById(MARK_ALERT_CHANNEL_ID, `🔩 PartsTech ${action === 'PURCHASE' ? 'order placed' : 'quote'} → ${est?.number || 'estimate'}: ${out.added} part(s) landed on the estimate.`) } catch { /* fine */ }
      res.json({ ok: true, added: out.added })
    } catch (e) { console.error('[partstech callback]', e.message); res.status(e.status || 500).json({ error: e.message }) }
  })
  return r
}
