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
    for (const m of list) {
      const v = view(m, await withCheckins(req, m, await readComp(req, m.id)))
      v.checkins = (await readSchedule(req, m.id).catch(() => null))?.items || []
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
  return buildOfferPdf({ name: m.name, email: m.email, phone: m.phone }, { employment: 'w2' }, { title: 'Offer of Employment: Pay & Benefits', blocks: compLetterBlocks(m, c) })
}

router.get('/:id/letter.pdf', async (req, res) => {
  try {
    const m = await memberById(req, req.params.id)
    const c = m && await readComp(req, m.id)
    if (!c) return res.status(404).json({ error: 'No pay & benefits record yet' })
    if (c.employment === 'contractor') return res.status(400).json({ error: 'Contractor agreements still go out from Recruiting.' })
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
    const sign = await import('../services/zohoSign.js')
    await sign.loadStoredToken(req)
    const probe = await sign.isConfigured()
    if (!probe.ok) return res.status(503).json({ error: `Zoho Sign isn't connected (${probe.why}).` })
    if (c.letter?.request_id && c.letter.status === 'inprogress') { try { await sign.recallRequest(c.letter.request_id, 'Replaced by an updated letter') } catch (e) { console.log('[comp] recall failed (continuing):', e.message) } }
    const { pdf, sign: sig, date } = await buildLetter(m, await withCheckins(req, m, c))
    const subject = `Offer letter — ${m.name} — Absolute ADAS`
    const r = await sign.sendForSignature({ pdf, filename: `${subject}.pdf`, recipientName: m.name, recipientEmail: m.email, subject,
      note: `Hi ${m.name.split(' ')[0]}, here's your updated offer letter with your pay and benefits. Sign on your phone. — Mark`,
      fields: [{ type: 'Signature', ...sig, name: 'Signature' }, { type: 'Date', ...date, name: 'Date signed' }] })
    c.letter = { request_id: r.request_id, status: 'inprogress', sent_at: new Date().toISOString() }
    c.history = [...c.history, { at: c.letter.sent_at, by: 'Mark', what: 'Offer letter sent through Zoho Sign' }].slice(-25)
    await writeComp(req, m.id, c)
    res.json({ ok: true, letter: c.letter })
  } catch (e) { res.status(500).json({ error: e.response?.data?.message || e.message }) }
})

// Status only. The signed PDF stays in Zoho Sign; the shared record gets a
// bare "contract signed" tick (date only, no file, no terms) so onboarding
// still shows it done.
export async function checkLetter(req, m, c) {
  if (!c?.letter?.request_id || c.letter.status !== 'inprogress') return c?.letter || null
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
    const sign = await import('../services/zohoSign.js'); await sign.loadStoredToken(req)
    const pdf = await sign.downloadSignedPdf(c.letter.request_id)
    res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Content-Disposition', `inline; filename="Signed offer letter - ${m.name}.pdf"`)
    res.send(pdf)
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
    if (!c) continue
    if (c.letter?.status === 'inprogress') { try { await checkLetter(req, m, c) } catch (e) { console.log('[comp] letter check', m.name, e.message) } }
    const rv = nextReview(await withCheckins(req, m, c))
    if (!rv?.date) continue
    const days = Math.round((new Date(rv.date + 'T12:00:00') - new Date(today + 'T12:00:00')) / 86400000)
    for (const [when, label] of [[14, 'in 2 weeks'], [0, 'TODAY']]) {
      const k = `${m.id}:${rv.date}:${when}`
      if (days <= when && days >= (when === 0 ? -3 : 1) && !sent[k]) { lines.push(`• ${m.name}: ${rv.label} ${label} (${rv.date})`); sent[k] = today }
    }
  }
  if (lines.length) {
    try { const { postToCliqChannelById, MARK_ALERT_CHANNEL_ID } = await import('../services/cliq.js'); await postToCliqChannelById(MARK_ALERT_CHANNEL_ID, `⭐ *Reviews coming up*\n${lines.join('\n')}`) } catch (e) { console.log('[comp] cliq', e.message) }
    await cfgWriteJson(req, 'mpb_reminders_sent', sent)
  }
  return { reminders: lines.length }
}

export default router
