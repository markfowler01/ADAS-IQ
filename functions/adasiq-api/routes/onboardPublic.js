// Public onboarding portal (Mark 2026-09-16): the new hire opens a signed
// link on their phone — no login — and does everything themselves:
// their info, a profile photo, photos of ID / Social Security card /
// voided check / certs, direct deposit (validated, written to a signed
// PDF), handbook sign-off, the training course with quizzes, and an AI
// Q&A over the handbook. Every file lands in THEIR WorkDrive folder
// (Command Center → HR → Team → <Name>) with a numbered, clear name.
// Bank numbers and SSNs are never stored in the app database.
import express from 'express'
import crypto from 'crypto'
import multer from 'multer'
import catalyst from 'zcatalyst-sdk-node'
import PDFDocument from 'pdfkit'
import { readTeamMembers, saveMemberPublic as saveMember } from './team.js'
import { ensurePersonFolder, tickChecklist, readCourse, cfgWriteJson, cfgReadJson, readLadder, ladderProgress } from './people.js'

const router = express.Router()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } })
const secret = () => process.env.SESSION_SECRET || 'adasiq-portal-secret'
const todayPT = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const emailKey = uid => String(uid || 'unknown').toLowerCase().replace(/[^a-z0-9]+/g, '_')

export function makeOnboardToken(memberId) {
  const body = Buffer.from(JSON.stringify({ type: 'onboarding', id: String(memberId), exp: Date.now() + 45 * 86400000 })).toString('base64url')
  return `${body}.${crypto.createHmac('sha256', secret()).update(body).digest('base64url')}`
}
export function verifyOnboardToken(token, memberId) {
  if (!token) return false
  const [body, sig] = String(token).split('.')
  if (!body || !sig || sig !== crypto.createHmac('sha256', secret()).update(body).digest('base64url')) return false
  try { const d = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); return d.type === 'onboarding' && d.exp > Date.now() && String(d.id) === String(memberId) } catch { return false }
}
export const photoKey = memberId => crypto.createHmac('sha256', secret()).update(`photo:${memberId}`).digest('base64url').slice(0, 16)
export const photoUrlFor = memberId => `/server/adasiq-api/api/public/onboard/photo/${memberId}?k=${photoKey(memberId)}`

// Clear, numbered file names in the person's folder
const KINDS = {
  photo:        { n: '00', label: 'Profile photo' },
  dl_front:     { n: '01', label: "Driver's license (front)", tick: 'ids' },
  dl_back:      { n: '02', label: "Driver's license (back)", tick: 'ids' },
  ssn:          { n: '03', label: 'Social Security card', tick: 'ids' },
  passport:     { n: '04', label: 'Passport / other ID' },
  voided_check: { n: '05', label: 'Voided check' },
  deposit:      { n: '06', label: 'Payout authorization (signed)', tick: 'direct_deposit' },
  cert:         { n: '07', label: 'Certification' },
  handbook:     { n: '08', label: 'Signed handbook acknowledgment', tick: 'handbook' },
  contract:     { n: '09', label: 'Signed contract / offer letter', tick: 'contract' },
  other:        { n: '10', label: 'Document' },
}
const extOf = (f) => (f.originalname || '').match(/\.[a-z0-9]+$/i)?.[0]?.toLowerCase() || (f.mimetype === 'application/pdf' ? '.pdf' : /png/.test(f.mimetype) ? '.png' : /webp/.test(f.mimetype) ? '.webp' : '.jpg')
const safe = s => String(s || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
export function fileNameFor(kind, m, label, ext) { const k = KINDS[kind] || KINDS.other; const what = kind === 'cert' || kind === 'other' ? `${k.label}${label ? ` — ${safe(label)}` : ''}` : k.label; return `${k.n} ${what} — ${safe(m.name)}${ext}` }

async function guard(req, res) {
  const t = req.query.t || req.body?.t
  if (!verifyOnboardToken(t, req.params.id)) { res.status(401).json({ error: 'This onboarding link is not valid or has expired. Ask Mark for a new one.' }); return null }
  const members = await readTeamMembers(req)
  const m = members.find(x => x.id === req.params.id)
  if (!m) { res.status(404).json({ error: 'Not found' }); return null }
  return { m, members }
}
async function putFile(req, m, kind, label, buffer, mimetype, ext) {
  await ensurePersonFolder(req, m)
  const { getAccessToken } = await import('../services/zoho.js')
  const { uploadFileToFolder } = await import('../services/workdrive.js')
  const filename = fileNameFor(kind, m, label, ext)
  const up = await uploadFileToFolder(m.workdrive_folder_id, filename, buffer, await getAccessToken(), mimetype)
  const fileId = String(up?.fileId || up?.id || up || '')
  const doc = { kind, name: filename.replace(/\.[a-z0-9]+$/i, ''), url: fileId ? `https://workdrive.zoho.com/file/${fileId}` : m.workdrive_folder_url, file_id: fileId, added: todayPT(), by: m.name }
  // one file per single-slot kind (re-uploads replace the entry, the newer file wins in WorkDrive too via override-name-exist)
  const single = !['cert', 'other'].includes(kind)
  m.documents = [...(Array.isArray(m.documents) ? m.documents : []).filter(d => !(single && d.kind === kind)), doc]
  if (KINDS[kind]?.tick) tickChecklist(m, KINDS[kind].tick, m.name)
  return doc
}
function pdfBuffer(build) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 54 }); const chunks = []
    doc.on('data', c => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject)
    build(doc); doc.end()
  })
}
const ip = req => String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim()

// ── GET /:id — everything the portal needs ───────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const g = await guard(req, res); if (!g) return
    const { m, members } = g
    const boss = members.find(x => x.user_id === m.reports_to)
    const course = await readCourse(req)
    const progress = m.training || {}
    const company = await cfgReadJson(req, 'company_page', null)
    res.json({ ok: true,
      member: { id: m.id, name: m.name, preferred_name: m.preferred_name || '', title: m.title, department: m.department, hire_date: m.hire_date, employment: m.employment, track: m.track || 'tech', region: m.region || '', boss: boss ? { name: boss.name, title: boss.title, phone: boss.phone } : null, phone: m.phone || '', personal_phone: m.personal_phone || '', personal_email: m.personal_email || '', address: m.address || '', birthday: m.birthday || '', shirt_size: m.shirt_size || '', emergency_contact: m.emergency_contact || { name: '', phone: '', relationship: '' }, photo_url: m.photo_url || '' },
      documents: (m.documents || []).map(d => ({ kind: d.kind || 'other', name: d.name, added: d.added })),
      direct_deposit: m.direct_deposit ? { bank: m.direct_deposit.bank, last4: m.direct_deposit.last4, type: m.direct_deposit.type, at: m.direct_deposit.at } : null,
      signed: m.signatures || {},
      checklist: m.checklist || null,
      payout: m.payout ? { method: m.payout.method, email: m.payout.email, currency: m.payout.currency, at: m.payout.at } : null,
      ladder: m.track === 'apprentice' ? ladderProgress(m, await readLadder(req)) : null,
      course: { pass_pct: course.pass_pct, track: m.track || 'tech', modules: course.modules.filter(mod => (mod.tracks || ['core']).includes('core') || (mod.tracks || []).includes(m.track || 'tech')).map(mod => ({ id: mod.id, title: mod.title, tracks: mod.tracks || ['core'], minutes: mod.minutes, video_url: mod.video_url, reading: mod.reading, quiz: (mod.quiz || []).map(q => ({ id: q.id, q: q.q, options: q.options })), progress: progress[mod.id] || null })) },
      company: company ? { mission: company.mission, who_to_call: company.who_to_call } : null, kinds: KINDS })
  } catch (e) { console.error('[onboard get]', e.message); res.status(500).json({ error: e.message }) }
})

// ── About you ────────────────────────────────────────────────────────
router.post('/:id/profile', async (req, res) => {
  try {
    const g = await guard(req, res); if (!g) return
    const { m } = g; const b = req.body || {}
    for (const k of ['preferred_name', 'personal_phone', 'personal_email', 'address', 'birthday', 'shirt_size']) if (b[k] !== undefined) m[k] = String(b[k]).slice(0, 200)
    if (b.phone !== undefined && !m.phone) m.phone = String(b.phone).slice(0, 40)
    if (b.emergency_contact) m.emergency_contact = { name: String(b.emergency_contact.name || '').slice(0, 120), phone: String(b.emergency_contact.phone || '').slice(0, 40), relationship: String(b.emergency_contact.relationship || '').slice(0, 60) }
    if (m.emergency_contact?.name && m.emergency_contact?.phone) tickChecklist(m, 'emergency', m.name)
    await saveMember(req, m)
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── Uploads (photo, IDs, SSN card, voided check, certs) ─────────────
router.post('/:id/upload', upload.single('file'), async (req, res) => {
  try {
    const g = await guard(req, res); if (!g) return
    const { m } = g
    if (!req.file) return res.status(400).json({ error: 'No file' })
    const kind = KINDS[req.body?.kind] ? req.body.kind : 'other'
    const doc = await putFile(req, m, kind, req.body?.label || '', req.file.buffer, req.file.mimetype, extOf(req.file))
    if (kind === 'photo') { m.photo_file_id = doc.file_id; m.photo_url = photoUrlFor(m.id); tickChecklist(m, 'photo', m.name) }
    await saveMember(req, m)
    console.log(`[onboard] ${m.name} uploaded ${doc.name}`)
    res.json({ ok: true, document: { kind, name: doc.name, added: doc.added }, photo_url: m.photo_url || '' })
  } catch (e) { console.error('[onboard upload]', e.message); res.status(500).json({ error: e.message }) }
})

// ── Direct deposit — validated, PDF into the folder, numbers never kept ──
function abaValid(r) { if (!/^\d{9}$/.test(r)) return false; const d = r.split('').map(Number); return ((3 * (d[0] + d[3] + d[6])) + (7 * (d[1] + d[4] + d[7])) + (d[2] + d[5] + d[8])) % 10 === 0 }
router.post('/:id/direct-deposit', async (req, res) => {
  try {
    const g = await guard(req, res); if (!g) return
    const { m } = g; const b = req.body || {}
    const routing = String(b.routing || '').replace(/\D/g, ''), account = String(b.account || '').replace(/\D/g, ''), account2 = String(b.account2 || '').replace(/\D/g, '')
    const bank = String(b.bank || '').trim().slice(0, 80), type = b.type === 'savings' ? 'savings' : 'checking', nameOn = String(b.name_on_account || m.name).trim().slice(0, 120), typed = String(b.signature || '').trim().slice(0, 120)
    if (!bank) return res.status(400).json({ error: 'Bank name is required.' })
    if (!abaValid(routing)) return res.status(400).json({ error: 'That routing number is not valid — it must be 9 digits and pass the bank check. Read it off a check or your bank app, not a deposit slip.' })
    if (!/^\d{4,17}$/.test(account)) return res.status(400).json({ error: 'Account number should be 4–17 digits.' })
    if (account !== account2) return res.status(400).json({ error: 'The account numbers you typed do not match. Type it again, slowly.' })
    if (typed.toLowerCase().replace(/\s+/g, ' ') !== m.name.toLowerCase().replace(/\s+/g, ' ')) return res.status(400).json({ error: `Sign by typing your full name exactly: ${m.name}` })
    const when = new Date().toISOString(), from = ip(req)
    const buf = await pdfBuffer(doc => {
      doc.fontSize(18).text('Absolute ADAS — Direct Deposit Authorization', { align: 'left' }).moveDown(0.5)
      doc.fontSize(10).fillColor('#555').text('Absolute ADAS LLC · Mobile ADAS Calibration & Diagnostics · Washington').moveDown(1).fillColor('#000')
      doc.fontSize(12).text(`Employee / contractor: ${m.name}`).text(`Title: ${m.title || ''}`).text(`Pay type: ${m.employment === 'contractor' ? 'Contractor' : 'W-2 employee'}`).moveDown(1)
      doc.text(`Bank: ${bank}`).text(`Account type: ${type}`).text(`Name on account: ${nameOn}`).text(`Routing number: ${routing}`).text(`Account number: ${account}`).moveDown(1)
      doc.fontSize(11).text('I authorize Absolute ADAS to deposit my pay to the account above and, if necessary, to reverse a deposit made in error. This authorization stays in effect until I give written notice to change or cancel it.').moveDown(1.5)
      doc.fontSize(12).text(`Signed: ${typed}`).text(`Date: ${when.slice(0, 10)} (${when})`).text(`Signed from IP ${from || 'n/a'} via the Absolute ADAS onboarding link`).moveDown(2)
      doc.fontSize(9).fillColor('#777').text('Keep this document in the employee\'s personnel folder. The app stores only the bank name and the last four digits.')
    })
    const doc = await putFile(req, m, 'deposit', '', buf, 'application/pdf', '.pdf')
    m.direct_deposit = { bank, last4: account.slice(-4), type, at: when }
    await saveMember(req, m)
    console.log(`[onboard] ${m.name} direct deposit on file (${bank} …${account.slice(-4)})`)
    res.json({ ok: true, direct_deposit: m.direct_deposit, document: { kind: 'deposit', name: doc.name, added: doc.added } })
  } catch (e) { console.error('[onboard deposit]', e.message); res.status(500).json({ error: e.message }) }
})

// ── Contractor payout (Wise) — instead of a US bank; signed PDF, app keeps method + email
router.post('/:id/payout', async (req, res) => {
  try {
    const g = await guard(req, res); if (!g) return
    const { m } = g; const b = req.body || {}
    const email = String(b.email || '').trim().toLowerCase().slice(0, 120), email2 = String(b.email2 || '').trim().toLowerCase(), currency = String(b.currency || 'USD').toUpperCase().slice(0, 3), typed = String(b.signature || '').trim()
    const bank = String(b.bank || '').trim().slice(0, 120), acct = String(b.account_ref || '').trim().slice(0, 60)
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Enter the email your Wise account uses.' })
    if (email !== email2) return res.status(400).json({ error: 'The two emails do not match.' })
    if (typed.toLowerCase().replace(/\s+/g, ' ') !== m.name.toLowerCase().replace(/\s+/g, ' ')) return res.status(400).json({ error: `Sign by typing your full name exactly: ${m.name}` })
    const when = new Date().toISOString(), from = ip(req)
    const buf = await pdfBuffer(doc => {
      doc.fontSize(18).text('Absolute ADAS — Contractor Payout Authorization').moveDown(0.5)
      doc.fontSize(12).text(`Contractor: ${m.name}`).text(`Role: ${m.title || ''}`).text(`Location: ${m.region || ''}`).moveDown(1)
      doc.text(`Payout method: Wise`).text(`Wise account email: ${email}`).text(`Currency: ${currency}`)
      if (bank) doc.text(`Local bank (for reference): ${bank}`); if (acct) doc.text(`Account reference: ${acct}`)
      doc.moveDown(1).fontSize(11).text('I confirm the payout details above are mine and authorize Absolute ADAS to send contract payments to this account. I will give written notice to change them.').moveDown(1.5)
      doc.fontSize(12).text(`Signed: ${typed}`).text(`Date: ${when.slice(0, 10)} (${when})`).text(`Signed from IP ${from || 'n/a'} via the Absolute ADAS onboarding link`)
    })
    const d = await putFile(req, m, 'deposit', '', buf, 'application/pdf', '.pdf')
    m.payout = { method: 'wise', email, currency, at: when }; m.wise_email = email; m.wise_currency = currency
    await saveMember(req, m)
    console.log(`[onboard] ${m.name} Wise payout on file (${currency})`)
    res.json({ ok: true, payout: m.payout, document: { kind: 'deposit', name: d.name, added: d.added } })
  } catch (e) { console.error('[onboard payout]', e.message); res.status(500).json({ error: e.message }) }
})

// ── Sign the handbook (and a contract/offer the owner dropped in the folder) ──
router.post('/:id/sign', async (req, res) => {
  try {
    const g = await guard(req, res); if (!g) return
    const { m } = g; const what = req.body?.doc === 'contract' ? 'contract' : 'handbook'
    const typed = String(req.body?.signature || '').trim()
    if (typed.toLowerCase().replace(/\s+/g, ' ') !== m.name.toLowerCase().replace(/\s+/g, ' ')) return res.status(400).json({ error: `Sign by typing your full name exactly: ${m.name}` })
    const { SECTIONS, handbookHash, policyId, policyVersion } = await import('../services/handbook.js')
    const when = new Date().toISOString(), from = ip(req)
    const buf = await pdfBuffer(doc => {
      doc.fontSize(18).text(what === 'contract' ? 'Absolute ADAS — Contract / Offer Acknowledgment' : 'Absolute ADAS — Handbook & Policy Acknowledgment').moveDown(0.5)
      doc.fontSize(12).text(`Name: ${m.name}`).text(`Title: ${m.title || ''}`).moveDown(1)
      if (what === 'handbook') {
        doc.fontSize(11).text(`I have read and understand the Absolute ADAS policies below (version ${handbookHash()}).`).moveDown(0.5)
        for (const s of SECTIONS) { doc.fontSize(12).text(s.title, { underline: true }).moveDown(0.2); doc.fontSize(9).text(s.body).moveDown(0.8) }
      } else {
        doc.fontSize(11).text('I have received, read and agree to the contract / offer letter placed in my personnel folder by Absolute ADAS.').moveDown(0.5)
      }
      doc.moveDown(1).fontSize(12).text(`Signed: ${typed}`).text(`Date: ${when.slice(0, 10)} (${when})`).text(`Signed from IP ${from || 'n/a'} via the Absolute ADAS onboarding link`)
    })
    const d = await putFile(req, m, what, '', buf, 'application/pdf', '.pdf')
    m.signatures = { ...(m.signatures || {}), [what]: { at: when, file_id: d.file_id, version: what === 'handbook' ? handbookHash() : '' } }
    if (what === 'handbook') {
      const acks = await cfgReadJson(req, `policy_ack:${emailKey(m.user_id)}`, {})
      for (const s of SECTIONS) acks[policyId(s.title)] = { version: policyVersion(s.body), at: when, name: m.name, via: 'onboarding' }
      await cfgWriteJson(req, `policy_ack:${emailKey(m.user_id)}`, acks)
    }
    await saveMember(req, m)
    console.log(`[onboard] ${m.name} signed ${what}`)
    res.json({ ok: true, signed: m.signatures })
  } catch (e) { console.error('[onboard sign]', e.message); res.status(500).json({ error: e.message }) }
})

// ── Course: grade a module ───────────────────────────────────────────
router.post('/:id/course/:mid', async (req, res) => {
  try {
    const g = await guard(req, res); if (!g) return
    const { m } = g
    const course = await readCourse(req)
    const mod = course.modules.find(x => x.id === req.params.mid)
    if (!mod) return res.status(404).json({ error: 'No such module' })
    const answers = req.body?.answers || {}
    const total = (mod.quiz || []).length
    const right = (mod.quiz || []).filter(q => Number(answers[q.id]) === Number(q.correct)).length
    const score = total ? Math.round((right / total) * 100) : 100
    const passed = score >= (course.pass_pct || 80)
    const prev = (m.training || {})[mod.id] || { attempts: 0 }
    m.training = { ...(m.training || {}), [mod.id]: { score, passed: passed || !!prev.passed, at: new Date().toISOString(), attempts: (prev.attempts || 0) + 1, best: Math.max(score, prev.best || 0) } }
    const mine = course.modules.filter(x => (x.tracks || ['core']).includes('core') || (x.tracks || []).includes(m.track || 'tech'))
    if (mine.every(x => m.training[x.id]?.passed)) tickChecklist(m, 'training', m.name)
    await saveMember(req, m)
    res.json({ ok: true, score, passed, correct: (mod.quiz || []).map(q => ({ id: q.id, correct: q.correct })), progress: m.training[mod.id] })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── AI Q&A over the handbook, company page and course ───────────────
router.post('/:id/ask', async (req, res) => {
  try {
    const g = await guard(req, res); if (!g) return
    const { m } = g
    const q = String(req.body?.question || '').trim().slice(0, 600)
    if (!q) return res.status(400).json({ error: 'Ask something' })
    const { handbookText } = await import('../services/handbook.js')
    const course = await readCourse(req)
    const company = await cfgReadJson(req, 'company_page', null)
    const context = [`# Company\n${company?.mission || ''}\nWho to call:\n${(company?.who_to_call || []).map(w => `- ${w.need}: ${w.person}${w.note ? ` (${w.note})` : ''}`).join('\n')}`, `# Handbook\n${handbookText()}`, `# Training modules\n${course.modules.map(x => `## ${x.title}\n${x.reading}`).join('\n\n')}`].join('\n\n')
    const Anthropic = (await import('@anthropic-ai/sdk')).default
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const r = await client.messages.create({ model: 'claude-haiku-4-5', max_tokens: 500, system: `You are the onboarding buddy at Absolute ADAS, a mobile ADAS calibration company in Washington. Answer new-hire questions ONLY from the reference below, in plain short sentences (3rd-grade reading level). If the answer isn't in the reference, say "I don't have that — ask Mark" and give his role. Never invent pay rates, dates, or policies. The person asking is ${m.name}, ${m.title}.\n\n${context}`, messages: [{ role: 'user', content: q }] })
    const answer = r.content?.map(c => c.text || '').join('').trim() || "I don't have that — ask Mark."
    console.log(`[onboard ask] ${m.name}: ${q.slice(0, 80)}`)
    res.json({ ok: true, answer })
  } catch (e) { console.error('[onboard ask]', e.message); res.status(500).json({ error: e.message }) }
})

// ── Profile photo (served through the app; key is an HMAC of the id) ──
const photoCache = new Map()
router.get('/photo/:id', async (req, res) => {
  try {
    if (String(req.query.k || '') !== photoKey(req.params.id)) return res.status(403).end()
    const members = await readTeamMembers(req)
    const m = members.find(x => x.id === req.params.id)
    if (!m?.photo_file_id) return res.status(404).end()
    let hit = photoCache.get(m.photo_file_id)
    if (!hit || Date.now() - hit.at > 3600000) {
      const { getAccessToken } = await import('../services/zoho.js')
      const { downloadFile } = await import('../services/workdrive.js')
      const f = await downloadFile(m.photo_file_id, await getAccessToken())
      hit = { ...f, at: Date.now() }; photoCache.set(m.photo_file_id, hit)
    }
    res.set('Content-Type', hit.contentType.startsWith('image/') ? hit.contentType : 'image/jpeg'); res.set('Cache-Control', 'private, max-age=3600')
    res.send(hit.buffer)
  } catch (e) { console.error('[onboard photo]', e.message); res.status(500).end() }
})

export default router
