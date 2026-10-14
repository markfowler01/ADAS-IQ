// 📞 /api/voice — the live-call bar (Mark 2026-10-05, the Grasshopper "##" replacement).
//   GET  /live                → calls this user may see: { calls: [{ sid, who, from, caller_name, shop_name, answered_at, transferring_to }] }
//   POST /transfer { sid, to } → redirect the CALLER's leg to mark | jayden | kat | desk | voicemail.
//                                The person's own leg drops because the bridge it was in is gone.
// Mounted with requireAuth only: technicians take calls too (Jayden is in the cascade).
import express from 'express'
import { listLive, getLive, patchLive, canSee, cascadeKeyFor, KEY_NAMES, logShopActivity } from '../services/liveCalls.js'
import catalyst from 'zcatalyst-sdk-node'
import { resolvePhoneConfig } from '../services/phoneConfig.js'
import { getTwilioClient, normalizePhoneUS } from '../services/twilio.js'
import { transferTwiML, conferenceTwiML, cascadeNumbers } from './voice.js'
import { pickFromNumber } from '../services/twilio.js'

export const voiceLiveRouter = express.Router()
voiceLiveRouter.use(express.json())

voiceLiveRouter.get('/live', async (req, res) => {
  try {
    const all = await listLive(req)
    const mine = all.filter(c => canSee(req.user, c))
    res.json({ ok: true, me: cascadeKeyFor(req.user), calls: mine.map(c => ({ sid: c.sid, status: c.status || 'live', mode: c.mode || '', target_answered: !!c.target_leg_sid, shop_id: c.shop_id || '', who: c.who, who_name: KEY_NAMES[c.who] || c.who, from: c.from, from_pretty: c.from_pretty || c.from, caller_name: c.caller_name || '', shop_name: c.shop_name || '', line: c.line || '', answered_at: c.answered_at, transferring_to: c.transferring_to || '', transferred_from: c.transferred_from || '' })) })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

voiceLiveRouter.post('/transfer', async (req, res) => {
  try {
    const sid = String(req.body?.sid || ''), to = String(req.body?.to || '').toLowerCase()
    if (!['mark', 'jayden', 'kat', 'desk', 'voicemail'].includes(to)) return res.status(400).json({ error: 'to must be mark, jayden, kat, desk or voicemail' })
    const call = await getLive(req, sid)
    if (!call || call.ended) return res.status(404).json({ error: 'That call is no longer live' })
    if (!canSee(req.user, call)) return res.status(403).json({ error: 'Only the person on the call (or Mark) can transfer it' })
    if (to === call.who) return res.status(400).json({ error: `They are already on with ${KEY_NAMES[to]}` })
    const cfg = await resolvePhoneConfig(req)
    const by = req.user?.techName || req.user?.name || req.user?.email || 'staff'
    // 🤝 Warm: park the caller, call the transferring person back and dial the target
    // inside that call so they talk first. Complete / Take back finish it.
    if (String(req.body?.mode || '') === 'warm' && to !== 'voicemail') {
      const fromKey = call.who
      const numbers = cascadeNumbers(cfg)
      const meTo = fromKey === 'desk' ? 'client:aa-desk' : numbers[fromKey]
      if (!meTo) return res.status(400).json({ error: 'Warm transfer needs your number in Phone Setup' })
      if (to !== 'desk' && !numbers[to]) return res.status(400).json({ error: `${KEY_NAMES[to]} has no number set in Phone Setup` })
      const client = await getTwilioClient(cfg)
      const base = (process.env.TWILIO_WEBHOOK_BASE_URL || '').replace(/\/$/, '') || 'https://adas-iq-904191467.development.catalystserverless.com/server/adasiq-api'
      await client.calls(sid).update({ twiml: conferenceTwiML(sid, { start: false, say: 'Please hold while I bring someone in.' }) })
      const consult = await client.calls.create({ to: meTo, from: pickFromNumber(call.line === 'local' ? 'local' : 'tollfree', cfg), url: `${base}/webhooks/twilio/voice/consult?sid=${encodeURIComponent(sid)}&to=${encodeURIComponent(to)}&from=${encodeURIComponent(fromKey)}`, method: 'POST', timeout: 25 })
      await patchLive(req, sid, { status: 'consulting', mode: 'warm', transferring_to: to, consult_sid: consult.sid, target_leg_sid: '', transferred_by: by, transferred_at: new Date().toISOString() })
      return res.json({ ok: true, mode: 'warm', to, to_name: KEY_NAMES[to] })
    }
    const fakeReq = { phoneCfg: cfg, body: { From: call.from, To: call.to } }
    const twiml = transferTwiML(fakeReq, { to, fromKey: call.who, callerNumber: call.from, lineType: call.line || '' })
    if (!twiml) return res.status(400).json({ error: `${KEY_NAMES[to]} has no number set in Phone Setup` })
    const client = await getTwilioClient(cfg)
    await client.calls(sid).update({ twiml })
    await patchLive(req, sid, { transferring_to: to, transferred_by: by, transferred_at: new Date().toISOString() })
    try {
      const { postToCliqChannel, DISPATCH_CHANNEL } = await import('../services/cliq.js')
      const who = [call.caller_name, call.shop_name].filter(Boolean).join(' · ') || call.from_pretty || normalizePhoneUS(call.from) || call.from
      await postToCliqChannel(DISPATCH_CHANNEL, `↪️ *Call transferred* · ${who} — ${by} sent it to ${KEY_NAMES[to]}.`)
    } catch { /* non-critical */ }
    res.json({ ok: true, to, to_name: KEY_NAMES[to] })
  } catch (e) {
    console.warn('[voice transfer]', e.message)
    res.status(500).json({ error: /not found|20404/i.test(e.message) ? 'That call already ended' : e.message })
  }
})

// 📇 Caller card — everything the drawer shows, in one call (Mark 2026-10-05).
voiceLiveRouter.get('/caller', async (req, res) => {
  try {
    const phone = normalizePhoneUS(req.query.phone) || String(req.query.phone || '')
    if (!phone) return res.status(400).json({ error: 'phone required' })
    const q = s => String(s || '').replace(/'/g, "''")
    const z = catalyst.initialize(req, { type: 'advancedio' }).zcql()
    let contact = null; try { const { findContactByPhone } = await import('../services/crmContacts.js'); contact = await findContactByPhone(req, phone) } catch { /* none */ }
    const { getAllShops } = await import('./shops.js')
    const all = await getAllShops(req)
    const last10 = phone.replace(/\D/g, '').slice(-10)
    const shop = all.find(s => contact?.shop_id && String(s.id) === String(contact.shop_id))
      || all.find(s => contact?.shop_name && String(s.shop_name).toLowerCase() === String(contact.shop_name).toLowerCase())
      || all.find(s => String(s.phone || '').replace(/\D/g, '').slice(-10) === last10 || (s.people || []).some(p => String(p.phone || '').replace(/\D/g, '').slice(-10) === last10))
      || null
    const out = { ok: true, phone, found: !!shop, contact: contact ? { contact_name: contact.contact_name || '', title: contact.title || '' } : null, shop: null, big3: null, full_service: false, ar: null, jobs: [], texts: [], activities: [] }
    try { const { listMessagesForPhone } = await import('../services/datastoreSms.js'); const msgs = await listMessagesForPhone(req, phone, { limit: 250 }); out.texts = msgs.slice(-3).reverse().map(m => ({ at: m.created_at || m.at || m.timestamp || '', direction: m.direction || (String(m.from_number || '') === phone ? 'inbound' : 'outbound'), body: String(m.body || '').slice(0, 160) })) } catch { /* none */ }
    if (shop) {
      let br = shop.billing_rules || {}; if (typeof br === 'string') { try { br = JSON.parse(br) } catch { br = {} } }
      out.shop = { id: shop.id, shop_name: shop.shop_name, pipeline_stage: shop.pipeline_stage || '', customer_type: br.customer_type || '', phone: shop.phone || '', address: shop.address || '', region: shop.region || '', assigned_to: shop.assigned_to || '', zoho_contact_id: shop.zoho_contact_id || '' }
      out.full_service = !!br.full_service
      try { const b3 = await import('../services/big3.js'); const r = await b3.readBig3(req, shop.shop_name); out.big3 = r?.rules || null } catch { /* none */ }
      out.activities = (Array.isArray(shop.activities) ? shop.activities : []).slice(-5).reverse().map(a => ({ id: a.id, at: a.at, by: a.by || '', text: a.text || '' }))
      try {
        const rows = await z.executeZCQLQuery(`SELECT ROWID, vehicle, status, ro_number, created_at, scheduled_date, technician, CREATEDTIME FROM Jobs WHERE shop_name = '${q(shop.shop_name)}' ORDER BY CREATEDTIME DESC LIMIT 5`)
        out.jobs = (rows || []).map(r => r.Jobs || r).map(j => ({ id: String(j.ROWID), vehicle: j.vehicle || '', status: j.status || '', ro_number: j.ro_number || '', technician: j.technician || '', when: j.scheduled_date || j.created_at || j.CREATEDTIME || '' }))
      } catch (e) { console.warn('[caller jobs]', e.message) }
      try {
        const since = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10), today = new Date().toISOString().slice(0, 10)
        const where = shop.zoho_contact_id ? `customer_id = '${q(shop.zoho_contact_id)}'` : `customer_name = '${q(shop.shop_name)}'`
        const rows = await z.executeZCQLQuery(`SELECT inv_date, inv_due_date, inv_total, inv_balance, inv_status FROM AdasInvoices WHERE ${where} AND inv_date >= '${since}' ORDER BY inv_date DESC LIMIT 200`)
        const inv = (rows || []).map(r => r.AdasInvoices || r).filter(i => !/void|draft/i.test(String(i.inv_status || '')))
        const open = inv.filter(i => Number(i.inv_balance) > 0)
        out.ar = { open: open.reduce((t, i) => t + Number(i.inv_balance || 0), 0), overdue: open.filter(i => i.inv_due_date && String(i.inv_due_date) < today).reduce((t, i) => t + Number(i.inv_balance || 0), 0), last_invoice: inv[0]?.inv_date || '', count_12mo: inv.length }
      } catch (e) { console.warn('[caller ar]', e.message) }
    }
    res.json(out)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// 📝 Note from the drawer → the shop's CRM timeline.
voiceLiveRouter.post('/note', async (req, res) => {
  try {
    const text = String(req.body?.text || '').trim(); if (!text) return res.status(400).json({ error: 'text required' })
    const by = req.user?.techName || req.user?.name || req.user?.email || 'staff'
    const act = await logShopActivity(req, { shopId: String(req.body?.shop_id || ''), text: `📞 ${req.body?.context ? `${req.body.context} · ` : ''}${text}`, by })
    if (!act) return res.status(404).json({ error: 'shop not found' })
    res.json({ ok: true, activity: act })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// 🤝 Warm transfer — Complete: the target joins the caller; the consult call hangs up.
voiceLiveRouter.post('/transfer/complete', async (req, res) => {
  try {
    const sid = String(req.body?.sid || ''); const call = await getLive(req, sid)
    if (!call || call.ended) return res.status(404).json({ error: 'That call is no longer live' })
    if (!canSee(req.user, call)) return res.status(403).json({ error: 'Not your call' })
    if (call.status !== 'consulting' || !call.target_leg_sid) return res.status(400).json({ error: call.status === 'consulting' ? `${KEY_NAMES[call.transferring_to] || 'They'} has not answered yet` : 'No warm transfer in progress' })
    const cfg = await resolvePhoneConfig(req); const client = await getTwilioClient(cfg)
    await client.calls(call.target_leg_sid).update({ twiml: conferenceTwiML(sid, { start: true, endOnExit: true }) })
    const by = req.user?.techName || req.user?.name || req.user?.email || 'staff'
    await patchLive(req, sid, { status: 'live', who: call.transferring_to, transferred_from: call.who, transferring_to: '', consult_sid: '', target_leg_sid: '', answered_at: new Date().toISOString() })
    try { const { postToCliqChannel, DISPATCH_CHANNEL } = await import('../services/cliq.js'); const who = [call.caller_name, call.shop_name].filter(Boolean).join(' · ') || call.from_pretty || call.from; await postToCliqChannel(DISPATCH_CHANNEL, `🤝 *Warm transfer* · ${who} — ${by} handed the call to ${KEY_NAMES[call.transferring_to]}.`) } catch { /* fine */ }
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})
// 🤝 Warm transfer — Take back: the transferring person rejoins the caller; the target drops.
voiceLiveRouter.post('/transfer/cancel', async (req, res) => {
  try {
    const sid = String(req.body?.sid || ''); const call = await getLive(req, sid)
    if (!call || call.ended) return res.status(404).json({ error: 'That call is no longer live' })
    if (!canSee(req.user, call)) return res.status(403).json({ error: 'Not your call' })
    if (call.status !== 'consulting' || !call.consult_sid) return res.status(400).json({ error: 'No warm transfer in progress' })
    const cfg = await resolvePhoneConfig(req); const client = await getTwilioClient(cfg)
    await client.calls(call.consult_sid).update({ twiml: conferenceTwiML(sid, { start: true, endOnExit: true, say: 'Reconnecting you to your caller.' }) })
    await patchLive(req, sid, { status: 'live', transferring_to: '', consult_sid: '', target_leg_sid: '' })
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})
