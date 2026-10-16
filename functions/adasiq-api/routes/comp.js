// 💵 Pay & Benefits API — see services/comp.js for the why.
//
// MARK ONLY (Mark 2026-10-16: "this to only come up for me. Personally no one
// else can have access to this data"). Every route checks Mark's own login
// email — NOT the owner role (Kat is an owner) and NOT self-access (a tech
// cannot read their own record here). The records live in their own
// AppConfig rows (`mpb:<memberId>`), never on the TeamMembers card, so the
// Directory, profile, payroll, onboarding and backup endpoints can't expose
// them. Signed letters stay in Zoho Sign and stream back only to Mark; they
// are not filed into the shared personnel folder.
//
//   GET  /api/comp                    everyone's terms, side by side
//   GET  /api/comp/templates          packages   PUT same
//   PUT  /api/comp/:id                save one person's terms
//   GET  /api/comp/:id/letter.pdf     preview the letter built from the record
//   POST /api/comp/:id/send-letter    send it through Zoho Sign (explicit click only)
//   POST /api/comp/:id/letter-check   pull Zoho Sign status
//   GET  /api/comp/:id/signed.pdf     the signed copy, straight from Zoho Sign
import express from 'express'
import { normalizeComp, fromTemplate, summarize, nextReview, diffWords, compLetterBlocks, DEFAULT_TEMPLATES } from '../services/comp.js'

const router = express.Router()
const MARK_EMAILS = ['mark@absoluteadas.com', 'mf@absoluteadas.com', 'mfowler4456@gmail.com']
export const isMark = req => MARK_EMAILS.includes(String(req.user?.email || '').trim().toLowerCase())

// Gate the whole router. 404 (not 403) so the feature doesn't advertise itself.
router.use((req, res, next) => {
  if (!isMark(req)) { console.log(`[comp] blocked ${req.method} ${req.path} for ${req.user?.email || 'unknown'}`); return res.status(404).json({ error: 'Not found' }) }
  next()
})

const KEY = id => `mpb:${String(id).replace(/[^a-z0-9_]/gi, '')}`
const TPL_KEY = 'mpb_templates'
const cfg = () => import('./people.js')
async function readComp(req, id) { const { cfgReadJson } = await cfg(); const v = await cfgReadJson(req, KEY(id), null); return v ? normalizeComp(v) : null }
async function writeComp(req, id, c) { const { cfgWriteJson } = await cfg(); await cfgWriteJson(req, KEY(id), normalizeComp(c)) }
async function templates(req) { const { cfgReadJson } = await cfg(); const s = await cfgReadJson(req, TPL_KEY, null); return s && Object.keys(s).length ? s : DEFAULT_TEMPLATES }
async function members(req) { const { readTeamMembers } = await import('./team.js'); return (await readTeamMembers(req)).filter(m => m.employment !== 'owner') }
async function memberById(req, id) { return (await members(req)).find(m => m.id === id) || null }
// Scheduled check-ins (services/reviewSchedule.js) count as upcoming reviews.
async function withCheckins(req, m, c) {
  if (!c) return c
  const { readSchedule } = await import('../services/reviewSchedule.js')
  const sch = await readSchedule(req, m.id).catch(() => null)
  const extra = (sch?.items || []).filter(it => it.status === 'booked' && !(c.reviews || []).some(r => r.date === it.date))
    .map(it => ({ date: it.date, label: it.label, done: false, auto: true, note: `${it.slot === 'coffee' ? 'Coffee before work' : 'Drinks after work'} ${it.start}` }))
  return { ...c, reviews: [...(c.reviews || []), ...extra], _checkins: sch?.items || [] }
}

const view = (m, c) => {
  const base = { id: m.id, name: m.name, title: m.title, email: m.email, employment: m.employment, hire_date: m.hire_date, active: m.active !== false, has_comp: !!c }
  if (!c) return base
  return { ...base, comp: c, summary: summarize(c), next_review: nextReview(c), letter: c.letter ? { status: c.letter.status, sent_at: c.letter.sent_at, signed_at: c.letter.signed_at } : null }
}

router.get('/templates', async (req, res) => {
  try { res.json({ templates: await templates(req) }) } catch (e) { res.status(500).json({ error: e.message }) }
})
router.put('/templates', async (req, res) => {
  try {
    const clean = {}
    for (const [k, v] of Object.entries(req.body?.templates || {}).slice(0, 10)) clean[String(k).replace(/[^a-z0-9_]/gi, '').slice(0, 30) || 'package'] = { ...normalizeComp(v), label: String(v.label || k).slice(0, 60) }
    const { cfgWriteJson } = await cfg(); await cfgWriteJson(req, TPL_KEY, clean)
    res.json({ ok: true, templates: clean })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.get('/', async (req, res) => {
  try {
    const list = (await members(req)).filter(m => m.active !== false)
    const out = []
    const { readSchedule } = await import('../services/reviewSchedule.js')
    const { cfgReadJson } = await cfg()
    for (const m of list) {
      const v = view(m, await withCheckins(req, m, await readComp(req, m.id)))
      v.checkins = (await readSchedule(req, m.id).catch(() => null))?.items || []
      const ws = await cfgReadJson(req, `mpp:${String(m.id).replace(/[^a-z0-9_]/gi, '')}`, null).catch(() => null)
      v.work_style = ws?.taken_at ? { taken_at: ws.taken_at, top: ws.simple?.strengths?.[0]?.title || '', drives: ws.drives || [] } : null
      const notes = await readNotes(req, m.id).catch(() => [])
      v.notes_count = notes.length
      v.last_note = sortNotes(notes.filter(n => !n.pinned))[0] || null
      v.pinned = notes.filter(n => n.pinned).slice(0, 3)
      v.next_checkin = (v.checkins || []).filter(x => x.status === 'booked' && x.date >= new Date().toISOString().slice(0, 10)).sort((a, b) => a.date.localeCompare(b.date))[0] || null
      out.push(v)
    }
    res.json({ members: out, templates: await templates(req) })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.put('/:id', async (req, res) => {
  try {
    const m = await memberById(req, req.params.id)
    if (!m) return res.status(404).json({ error: 'Not found' })
    let next
    if (req.body?.from_template) {
      const t = (await templates(req))[req.body.from_template]
      if (!t) return res.status(400).json({ error: 'No such package' })
      next = fromTemplate({ ...t, key: req.body.from_template }, m)
    } else { const b = req.body?.comp || {}; next = normalizeComp({ ...b, reviews: (b.reviews || []).filter(r => !r.auto) }) }
    const prev = await readComp(req, m.id)
    next.letter = prev?.letter || null
    next.history = [...(prev?.history || []), { at: new Date().toISOString(), by: 'Mark', what: prev ? diffWords(prev, next) : 'Pay & benefits record created' }].slice(-25)
    await writeComp(req, m.id, next)
    res.json({ member: view(m, next) })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

async function buildLetter(m, c) {
  const { buildOfferPdf } = await import('../services/offerLetter.js')
  const k1099 = c.employment === 'contractor'
  return buildOfferPdf({ name: m.name, email: m.email, phone: m.phone }, { employment: k1099 ? 'contractor' : 'w2' }, { title: k1099 ? 'Independent Contractor Agreement' : 'Offer of Employment: Pay & Benefits', blocks: compLetterBlocks(m, c) })
}

router.get('/:id/letter.pdf', async (req, res) => {
  try {
    const m = await memberById(req, req.params.id)
    const c = m && await readComp(req, m.id)
    if (!c) return res.status(404).json({ error: 'No pay & benefits record yet' })
    const { pdf } = await buildLetter(m, await withCheckins(req, m, c))
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Content-Disposition', `inline; filename="Offer letter - ${m.name}.pdf"`)
    res.send(pdf)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.post('/:id/send-letter', async (req, res) => {
  try {
    const m = await memberById(req, req.params.id)
    const c = m && await readComp(req, m.id)
    if (!c) return res.status(404).json({ error: 'No pay & benefits record yet' })
    if (!c.start_date) return res.status(400).json({ error: 'Set a start date first.' })
    if (!(c.pay_rate > 0)) return res.status(400).json({ error: 'Set the pay first.' })
    if (!m.email) return res.status(400).json({ error: `${m.name} has no email on file.` })
    const es = await import('../services/esign.js')
    if (c.letter?.request_id && c.letter.status === 'inprogress') {
      if (c.letter.via === 'app') await es.voidEnvelope(req, c.letter.request_id, 'Replaced by an updated letter')
      else { try { const sign = await import('../services/zohoSign.js'); await sign.loadStoredToken(req); await sign.recallRequest(c.letter.request_id, 'Replaced by an updated letter') } catch (e) { console.log('[comp] recall failed (continuing):', e.message) } }
    }
    const { pdf, sign: sig, date } = await buildLetter(m, await withCheckins(req, m, c))
    const first = m.name.split(' ')[0]
    const k1099 = c.employment === 'contractor', doc = k1099 ? 'contractor agreement' : 'offer letter'
    const { env } = await es.createEnvelope(req, { kind: 'comp_letter', ref: m.id, subject: `${k1099 ? 'Contractor agreement' : 'Offer letter'} — ${m.name} — Absolute ADAS`, signer: { name: m.name, email: m.email, phone: m.personal_phone || m.phone || '' }, pdf, fields: { sign: sig, date },
      invite: k1099
        ? { sms: `Hey ${first}, it's Mark. Here's your contractor agreement with your pay and how we work together, all in one place. Read it and sign right on your phone:`, emailIntro: "Here's your contractor agreement with your pay and how we work together, all in one place. Read it over and sign right on your phone. It takes a minute." }
        : { sms: `Hey ${first}, it's Mark. Here's your updated offer letter with your pay and benefits all in one place. Read it and sign right on your phone:`, emailIntro: "Here's your updated offer letter with your pay and benefits all in one place. Read it over and sign right on your phone. It takes a minute." } })
    const r = { request_id: env.id }
    c.letter = { request_id: r.request_id, status: 'inprogress', sent_at: new Date().toISOString(), via: 'app' }
    c.history = [...c.history, { at: c.letter.sent_at, by: 'Mark', what: `${doc[0].toUpperCase() + doc.slice(1)} sent to sign in the app` }].slice(-25)
    await writeComp(req, m.id, c)
    res.json({ ok: true, letter: c.letter })
  } catch (e) { res.status(500).json({ error: e.response?.data?.message || e.message }) }
})

// Status only. The signed PDF stays in Zoho Sign; the shared record gets a
// bare "contract signed" tick (date only, no file, no terms) so onboarding
// still shows it done.
export async function checkLetter(req, m, c) {
  if (!c?.letter?.request_id || c.letter.status !== 'inprogress') return c?.letter || null
  if (c.letter.via === 'app') { const es = await import('../services/esign.js'); const env = await es.readEnvelope(req, c.letter.request_id); if (env?.status === 'completed') await es.finishEnvelope(req, env.id); return (await readComp(req, m.id))?.letter || c.letter }
  const sign = await import('../services/zohoSign.js')
  await sign.loadStoredToken(req)
  const st = await sign.requestStatus(c.letter.request_id)
  if (st.status === 'inprogress') return c.letter
  c.letter = { ...c.letter, status: st.status, [st.status === 'completed' ? 'signed_at' : 'ended_at']: st.signed_at || new Date().toISOString() }
  c.history = [...c.history, { at: new Date().toISOString(), by: 'Zoho Sign', what: `Offer letter ${st.status}` }].slice(-25)
  await writeComp(req, m.id, c)
  if (st.status === 'completed') {
    try {
      m.signatures = { ...(m.signatures || {}), contract: { at: c.letter.signed_at, version: 'offer-letter' } }
      const { saveMemberPublic } = await import('./team.js'); await saveMemberPublic(req, m)
    } catch (e) { console.log('[comp] signature tick', e.message) }
    try { const { postToCliqChannelById, MARK_ALERT_CHANNEL_ID } = await import('../services/cliq.js'); await postToCliqChannelById(MARK_ALERT_CHANNEL_ID, `✅ ${m.name} signed the offer letter. It's in Pay & Benefits.`) } catch { /* fine */ }
  }
  return c.letter
}
// ✍️ In-app signature finished (services/esign.js finishEnvelope → here).
export async function onLetterSigned(req, memberId, env) {
  const m = await memberById(req, memberId)
  const c = m && await readComp(req, m.id)
  if (!c) return
  c.letter = { ...(c.letter || {}), request_id: env.id, status: 'completed', signed_at: env.signed_at, via: 'app' }
  c.history = [...c.history, { at: new Date().toISOString(), by: env.signed_name, what: 'Offer letter signed in the app' }].slice(-25)
  await writeComp(req, m.id, c)
  try { m.signatures = { ...(m.signatures || {}), contract: { at: env.signed_at, version: 'offer-letter' } }; const { saveMemberPublic } = await import('./team.js'); await saveMemberPublic(req, m) } catch (e) { console.log('[comp] signature tick', e.message) }
  try { const { postToCliqChannelById, MARK_ALERT_CHANNEL_ID } = await import('../services/cliq.js'); await postToCliqChannelById(MARK_ALERT_CHANNEL_ID, `✅ ${m.name} signed the offer letter. Copy in your email and in Pay & Benefits.`) } catch { /* fine */ }
}
router.post('/:id/letter-check', async (req, res) => {
  try {
    const m = await memberById(req, req.params.id)
    const c = m && await readComp(req, m.id)
    if (!c) return res.status(404).json({ error: 'No record' })
    res.json({ letter: await checkLetter(req, m, c) })
  } catch (e) { res.status(500).json({ error: e.message }) }
})
router.get('/:id/signed.pdf', async (req, res) => {
  try {
    const m = await memberById(req, req.params.id)
    const c = m && await readComp(req, m.id)
    if (!c?.letter?.request_id || c.letter.status !== 'completed') return res.status(404).json({ error: 'No signed letter yet' })
    let pdf
    if (c.letter.via === 'app') { const es = await import('../services/esign.js'); pdf = await es.readPdf(req, c.letter.request_id, true); if (!pdf) return res.status(404).json({ error: 'Signed copy not found' }) }
    else { const sign = await import('../services/zohoSign.js'); await sign.loadStoredToken(req); pdf = await sign.downloadSignedPdf(c.letter.request_id) }
    res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Content-Disposition', `inline; filename="Signed offer letter - ${m.name}.pdf"`)
    res.send(pdf)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── 🔒 Mark's notes: tips, tricks, things he knows about each person ──
// Unlimited, chunked in DurableKV (`mpn:<memberId>`) — not exposed by any
// other route. Each note: { id, at, tag, text, pinned }.
export const NOTE_TAGS = { tip: '💡 Tip', life: '❤️ Life & family', win: '⭐ Win', concern: '⚠️ Concern', goal: '🎯 Goal', other: '🗒 Note' }
const MPN = id => `mpn:${String(id).replace(/[^a-z0-9_]/gi, '')}`
export async function readNotes(req, id) {
  const catalyst = (await import('zcatalyst-sdk-node')).default
  const { kvGet } = await import('../services/durableKV.js')
  const raw = await kvGet(catalyst.initialize(req), MPN(id)).catch(() => null)
  try { const v = JSON.parse(raw || '[]'); return Array.isArray(v) ? v : [] } catch { return [] }
}
async function writeNotes(req, id, notes) {
  const catalyst = (await import('zcatalyst-sdk-node')).default
  const { kvSet } = await import('../services/durableKV.js')
  await kvSet(catalyst.initialize(req), MPN(id), JSON.stringify(notes))
}
const sortNotes = n => n.slice().sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || String(b.at).localeCompare(String(a.at)))
router.get('/:id/notes', async (req, res) => {
  try { res.json({ notes: sortNotes(await readNotes(req, req.params.id)), tags: NOTE_TAGS }) } catch (e) { res.status(500).json({ error: e.message }) }
})
router.post('/:id/notes', async (req, res) => {
  try {
    const m = await memberById(req, req.params.id)
    if (!m) return res.status(404).json({ error: 'Not found' })
    const text = String(req.body?.text || '').trim().slice(0, 4000)
    if (!text) return res.status(400).json({ error: 'Write something first.' })
    const tag = NOTE_TAGS[req.body?.tag] ? req.body.tag : 'other'
    const notes = await readNotes(req, m.id)
    notes.push({ id: `n_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, at: new Date().toISOString(), tag, text, pinned: !!req.body?.pinned })
    await writeNotes(req, m.id, notes)
    res.json({ notes: sortNotes(notes) })
  } catch (e) { res.status(500).json({ error: e.message }) }
})
router.put('/:id/notes/:nid', async (req, res) => {
  try {
    const notes = await readNotes(req, req.params.id)
    const n = notes.find(x => x.id === req.params.nid)
    if (!n) return res.status(404).json({ error: 'Note not found' })
    if (req.body?.text !== undefined) n.text = String(req.body.text).trim().slice(0, 4000)
    if (req.body?.tag && NOTE_TAGS[req.body.tag]) n.tag = req.body.tag
    if (req.body?.pinned !== undefined) n.pinned = !!req.body.pinned
    n.edited_at = new Date().toISOString()
    await writeNotes(req, req.params.id, notes)
    res.json({ notes: sortNotes(notes) })
  } catch (e) { res.status(500).json({ error: e.message }) }
})
router.delete('/:id/notes/:nid', async (req, res) => {
  try {
    const notes = (await readNotes(req, req.params.id)).filter(x => x.id !== req.params.nid)
    await writeNotes(req, req.params.id, notes)
    res.json({ notes: sortNotes(notes) })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── 🧭 How I work: Mark's deep view ───────────────────────────────────
const MPP = id => `mpp:${String(id).replace(/[^a-z0-9_]/gi, '')}`
router.get('/:id/work-style', async (req, res) => {
  try {
    const m = await memberById(req, req.params.id)
    if (!m) return res.status(404).json({ error: 'Not found' })
    const { cfgReadJson } = await cfg()
    const rec = await cfgReadJson(req, MPP(m.id), null)
    if (!rec?.taken_at) return res.json({ taken: false })
    const ws = await import('../services/workStyle.js')
    res.json({ taken: true, taken_at: rec.taken_at, scores: rec.scores, drives: rec.drives, simple: rec.simple, deep: ws.deepReport(rec), ai: rec.ai || null, ai_at: rec.ai_at || null, traits: ws.TRAITS })
  } catch (e) { res.status(500).json({ error: e.message }) }
})
router.post('/:id/work-style/ai', async (req, res) => {
  try {
    const m = await memberById(req, req.params.id)
    const { cfgReadJson, cfgWriteJson } = await cfg()
    const rec = m && await cfgReadJson(req, MPP(m.id), null)
    if (!rec?.taken_at) return res.status(404).json({ error: 'Not taken yet' })
    const ws = await import('../services/workStyle.js')
    rec.ai = await ws.aiNarrative({ scores: rec.scores, drives: rec.drives, title: m.title })
    rec.ai_at = new Date().toISOString()
    await cfgWriteJson(req, MPP(m.id), rec)
    res.json({ ai: rec.ai, ai_at: rec.ai_at })
  } catch (e) { res.status(500).json({ error: e.message }) }
})
router.delete('/:id/work-style', async (req, res) => {
  try {
    const m = await memberById(req, req.params.id)
    if (!m) return res.status(404).json({ error: 'Not found' })
    const { cfgWriteJson } = await cfg()
    await cfgWriteJson(req, MPP(m.id), null)
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// Hourly piggyback (no user — runs as the system): review reminders to
// Mark's private alerts chat (names + dates only, never pay), and letter
// status pickup. Each reminder fires once.
export async function maybeCompReminders(req) {
  const { cfgReadJson, cfgWriteJson } = await cfg()
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date())
  const sent = await cfgReadJson(req, 'mpb_reminders_sent', {}) || {}
  const lines = []
  for (const m of (await members(req)).filter(x => x.active !== false)) {
    const c = await readComp(req, m.id)
    if (c?.letter?.status === 'inprogress') { try { await checkLetter(req, m, c) } catch (e) { console.log('[comp] letter check', m.name, e.message) } }
    // 📋 Prep brief the day before a booked check-in (talking points + pinned notes).
    try {
      const { readSchedule } = await import('../services/reviewSchedule.js')
      const tomorrow = new Date(today + 'T12:00:00'); tomorrow.setDate(tomorrow.getDate() + 1)
      const tk = tomorrow.toISOString().slice(0, 10)
      for (const it of ((await readSchedule(req, m.id))?.items || []).filter(x => x.status === 'booked' && x.date === tk)) {
        const k = `prep:${m.id}:${it.date}`
        if (sent[k]) continue
        const ws = await cfgReadJson(req, `mpp:${String(m.id).replace(/[^a-z0-9_]/gi, '')}`, null).catch(() => null)
        const ws2 = ws?.taken_at ? (await import('../services/workStyle.js')).deepReport(ws) : null
        const pts = ws2 ? ws2.talk[it.key === '90d' ? '90d' : '6mo'] : []
        const notes = (await readNotes(req, m.id)).filter(n => n.pinned || ['concern', 'goal', 'life'].includes(n.tag)).slice(-5)
        lines.push(`📋 *Tomorrow ${it.start === '07:00' ? '7:00 AM ☕ coffee' : '5:30 PM 🍺 drinks'} with ${m.name}* · ${it.label}` +
          (pts.length ? `\n${pts.map(p => `   • ${p}`).join('\n')}` : '') +
          (notes.length ? `\n   Your notes: ${notes.map(n => n.text.slice(0, 120)).join(' | ')}` : '') +
          (ws ? '' : `\n   (${m.name.split(' ')[0]} hasn't taken How I work yet.)`))
        sent[k] = today
      }
    } catch (e) { console.log('[comp] prep brief', m.name, e.message) }
    if (!c) continue
    const rv = nextReview(await withCheckins(req, m, c))
    if (!rv?.date) continue
    const days = Math.round((new Date(rv.date + 'T12:00:00') - new Date(today + 'T12:00:00')) / 86400000)
    for (const [when, label] of [[14, 'in 2 weeks'], [0, 'TODAY']]) {
      const k = `${m.id}:${rv.date}:${when}`
      if (days <= when && days >= (when === 0 ? -3 : 1) && !sent[k]) { lines.push(`• ${m.name}: ${rv.label} ${label} (${rv.date})`); sent[k] = today }
    }
  }
  if (lines.length) {
    try { const { postToCliqChannelById, MARK_ALERT_CHANNEL_ID } = await import('../services/cliq.js'); await postToCliqChannelById(MARK_ALERT_CHANNEL_ID, `⭐ *Your people*\n${lines.join('\n')}`) } catch (e) { console.log('[comp] cliq', e.message) }
    await cfgWriteJson(req, 'mpb_reminders_sent', sent)
  }
  return { reminders: lines.length }
}

export default router
