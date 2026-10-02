// 🌐 Public online report (signed link, no login). See services/publicReport.js.
import express from 'express'

const router = express.Router()
const notFound = res => res.status(404).send('<!doctype html><p style="font-family:sans-serif;padding:24px">This report link is not valid. Text Absolute ADAS at (425) 675-1329.</p>')

router.get('/:token', async (req, res) => {
  try {
    const R = await import('../services/publicReport.js')
    const id = await R.scrubIdFromToken(req, req.params.token)
    if (!id) return notFound(res)
    const data = await R.reportData(req, id)
    if (!data) return notFound(res)
    res.set('Cache-Control', 'private, max-age=60').send(R.renderReport(data, req.params.token))
  } catch (e) { console.error('[public report]', e.message); res.status(500).send('<p>Could not load the report. Text (425) 675-1329.</p>') }
})

// The cited OEM document, served inline so "#page=N" opens it at the page.
router.get('/:token/doc/:n', async (req, res) => {
  try {
    const R = await import('../services/publicReport.js')
    const id = await R.scrubIdFromToken(req, req.params.token)
    if (!id) return notFound(res)
    const data = await R.reportData(req, id)
    const d = (data?.cited || []).find(x => String(x.n) === String(req.params.n))
    if (!d?.bytes) return notFound(res)
    const name = String(d.row.doc_title || 'OEM document').replace(/[^\w .()-]+/g, ' ').slice(0, 90)
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${name}.pdf"`, 'Cache-Control': 'private, max-age=300' }).send(d.bytes)
  } catch (e) { console.error('[public report doc]', e.message); res.status(500).send('error') }
})

// 💬 Feedback on one line → #dispatch + Mark's alerts, kept on AppConfig for the record.
router.post('/:token/feedback', express.urlencoded({ extended: false, limit: '20kb' }), async (req, res) => {
  try {
    const R = await import('../services/publicReport.js')
    const id = await R.scrubIdFromToken(req, req.params.token)
    if (!id) return res.status(404).json({ error: 'bad link' })
    const clip = (v, n) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, n)
    const fb = { at: new Date().toISOString(), sensor: clip(req.body?.sensor, 80), kind: clip(req.body?.kind, 40), note: clip(req.body?.note, 600), who: clip(req.body?.who, 60) }
    const { getScrub } = await import('../services/scrubStore.js')
    const s = await getScrub(req, id)
    const catalyst = (await import('zcatalyst-sdk-node')).default
    const app = catalyst.initialize(req, { type: 'advancedio' })
    try {
      const key = 'report_feedback'
      const r = await app.zcql().executeZCQLQuery(`SELECT ROWID, config_value FROM AppConfig WHERE config_key = '${key}' LIMIT 1`)
      const row = r?.[0]?.AppConfig
      const list = [{ ...fb, scrubId: id, car: s?.vehicle || '', shop: s?.shop || '', ro: s?.ro || '' }, ...(() => { try { return JSON.parse(row?.config_value || '[]') } catch { return [] } })()].slice(0, 200)
      if (row) await app.datastore().table('AppConfig').updateRow({ ROWID: row.ROWID, config_value: JSON.stringify(list) })
      else await app.datastore().table('AppConfig').insertRow({ config_key: key, config_value: JSON.stringify(list) })
    } catch (e) { console.warn('[report feedback] store:', e.message) }
    const msg = `💬 *Report feedback* · ${s?.shop || '?'} · ${s?.vehicle || ''}${s?.ro ? ` · RO ${s.ro}` : ''}\n*${fb.sensor}* — ${fb.kind}${fb.note ? `\n"${fb.note}"` : ''}${fb.who ? `\n— ${fb.who}` : ''}`
    const { postToCliqChannel, postToCliqChannelById, DISPATCH_CHANNEL, MARK_ALERT_CHANNEL_ID } = await import('../services/cliq.js')
    await Promise.allSettled([postToCliqChannel(DISPATCH_CHANNEL, msg), postToCliqChannelById(MARK_ALERT_CHANNEL_ID, msg)])
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

export default router
