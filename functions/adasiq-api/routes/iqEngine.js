// 🔌 The scrub engine for ADAS IQ (Mark 2026-11-04: "i want this to be exactly
// like the absolute adas app scrubber"). ADAS IQ (its own Catalyst project,
// Retail-ADAS-IQ) sends each estimate here and gets back the exact result this
// app would give: same prompt, OEM position-statement library, VIN equipment,
// guard rules, lessons and calibration-rules cross-check.
//
// Nothing is filed here: no Scrub Library row, no #dispatch post, no rule
// learning from other shops' cars (learn: false, keep: false).
//
//   POST /api/iq-engine/scrub   { job, kind: 'bms'|'pdf', xml | pdf_b64, callback }
//   → does the scrub (can outrun the 30 s gateway; the function keeps going)
//   → POSTs { job, ok, data | error } to the callback on ADAS IQ, signed.
//
// Both sides sign with one shared key: HMAC-SHA256 of `${ts}.${sha256(body)}`
// in X-IQ-Sig + X-IQ-Ts (5-minute window). The key is made in the ADAS IQ owner
// console and pasted here once by Mark (AppConfig iq_engine_key, encrypted).
import crypto from 'node:crypto'
import express from 'express'
import catalyst from 'zcatalyst-sdk-node'
import { sealSecret, openSecret } from './ccc.js'

const CFG = 'iq_engine_key'
const CALLBACK_HOSTS = ['retail-adas-iq-904191467.development.catalystserverless.com', 'retail-adas-iq-904191467.catalystserverless.com', 'api.adas-iq.com']
let _key = { at: 0, v: '' }

async function engineKey(req) {
  if (Date.now() - _key.at < 60000) return _key.v
  try {
    const r = await catalyst.initialize(req, { type: 'advancedio' }).zcql().executeZCQLQuery(`SELECT config_value FROM AppConfig WHERE config_key = '${CFG}' ORDER BY MODIFIEDTIME DESC LIMIT 1`)
    _key = { at: Date.now(), v: openSecret(r?.[0]?.AppConfig?.config_value || '') }
  } catch { _key = { at: Date.now(), v: '' } }
  return _key.v
}
export async function saveEngineKey(req, key) {
  const t = catalyst.initialize(req, { type: 'advancedio' }).datastore().table('AppConfig')
  const r = await catalyst.initialize(req, { type: 'advancedio' }).zcql().executeZCQLQuery(`SELECT ROWID FROM AppConfig WHERE config_key = '${CFG}' LIMIT 1`)
  const row = { config_key: CFG, config_value: sealSecret(key) }
  if (r?.[0]?.AppConfig?.ROWID) await t.updateRow({ ROWID: String(r[0].AppConfig.ROWID), ...row }); else await t.insertRow(row)
  _key = { at: 0, v: '' }
}
export async function engineKeySet(req) { return !!(await engineKey(req)) }

const sign = (key, ts, body) => crypto.createHmac('sha256', key).update(`${ts}.${crypto.createHash('sha256').update(body).digest('hex')}`).digest('hex')
function verify(key, req, raw) {
  const ts = Number(req.headers['x-iq-ts'] || 0), got = String(req.headers['x-iq-sig'] || '')
  if (!key || !ts || Math.abs(Date.now() - ts) > 5 * 60000) return false
  const want = sign(key, ts, raw)
  return want.length === got.length && crypto.timingSafeEqual(Buffer.from(want), Buffer.from(got))
}

export const iqEngineRouter = express.Router()
iqEngineRouter.post('/scrub', express.text({ type: '*/*', limit: '30mb' }), async (req, res) => {
  const raw = typeof req.body === 'string' ? req.body : ''
  const key = await engineKey(req)
  if (!verify(key, req, raw)) return res.status(401).json({ error: key ? 'bad signature' : 'ADAS IQ is not connected yet' })
  let b
  try { b = JSON.parse(raw) } catch { return res.status(400).json({ error: 'bad json' }) }
  let cb
  try { cb = new URL(String(b.callback || '')); if (cb.protocol !== 'https:' || !CALLBACK_HOSTS.includes(cb.host)) throw new Error('host') } catch { return res.status(400).json({ error: 'callback must be ADAS IQ' }) }

  const t0 = Date.now()
  let out
  try {
    let data
    if (b.kind === 'pdf') {
      const buf = Buffer.from(String(b.pdf_b64 || ''), 'base64')
      if (buf.subarray(0, 4).toString() !== '%PDF') throw new Error('not a PDF')
      const { scrubPdfBuffer } = await import('./extract.js')
      data = await scrubPdfBuffer(req, buf, { learn: false, keep: false, force: true, strictKind: true, source: 'adas-iq', by: 'ADAS IQ' })
    } else {
      const { parseBms, scrubBmsCore } = await import('../services/cccScrub.js')
      const e = parseBms(String(b.xml || ''))
      if (!e.lines.length) throw new Error('no damage lines in the BMS message')
      data = (await scrubBmsCore(req, e, { reuse: false })).data
    }
    try { const { flush } = await import('../services/spend.js'); await flush(req) } catch { /* fine */ }
    delete data.claim
    out = { job: b.job, ok: true, data, engine_ms: Date.now() - t0 }
  } catch (e) {
    out = { job: b.job, ok: false, error: String(e.message || e).slice(0, 500) }
  }
  console.log(`[iq engine] ${b.kind} ${b.job} · ${out.ok ? `${(out.data.calibrations || []).filter(c => c.enabled === true).length} required` : `error: ${out.error}`} · ${Math.round((Date.now() - t0) / 1000)}s`)
  const body = JSON.stringify(out), ts = Date.now()
  try {
    const axios = (await import('axios')).default
    await axios.post(cb.toString(), body, { headers: { 'Content-Type': 'text/plain', 'X-IQ-Ts': String(ts), 'X-IQ-Sig': sign(key, ts, body) }, timeout: 30000 })
  } catch (e) { console.warn('[iq engine] callback failed (ADAS IQ will resend):', e?.response?.status || e.message) }
  res.json({ ok: out.ok })
})

// 📄 The report PDF for an ADAS IQ scrub: THIS app's report builder (services/pdf.js),
// ADAS IQ brand, no Absolute-only parts (Full Service rules, online-report link).
// Signed like /scrub; answers with the PDF bytes (it builds in a few seconds).
iqEngineRouter.post('/report-pdf', express.text({ type: '*/*', limit: '5mb' }), async (req, res) => {
  const raw = typeof req.body === 'string' ? req.body : ''
  const key = await engineKey(req)
  if (!verify(key, req, raw)) return res.status(401).json({ error: key ? 'bad signature' : 'ADAS IQ is not connected yet' })
  let r
  try { r = JSON.parse(raw) } catch { return res.status(400).json({ error: 'bad json' }) }
  try {
    const { generateADASIQPdf, ADAS_IQ_BRAND } = await import('../services/pdf.js')
    const pdf = await generateADASIQPdf({
      shop: r.shop, ro_number: r.ro_number, insurer: r.insurer, vin: r.vin, vehicle: r.vehicle, year: r.year, make: r.make, model: r.model,
      calibrations: r.calibrations || [], document_links: r.document_links || [], vin_equipment: r.vin_equipment,
      technician: r.prepared_by || '', _brand: ADAS_IQ_BRAND,
    })
    res.set('Content-Type', 'application/pdf')
    res.send(pdf)
  } catch (e) { console.error('[iq engine] report-pdf', e.message); res.status(500).json({ error: e.message }) }
})
