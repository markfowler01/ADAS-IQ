// People tools, phases 3–8 (Mark 2026-09-16: "fully build this out").
//   profile      — one page per person: job, this period's hours + review
//                  status, sick balance, certs/licenses, equipment, docs,
//                  onboarding, 1:1s/reviews/training log, owner pay block
//   log          — PeopleLog table (1:1 · review · training · note)
//   policy acks  — "I've read this" per policy version (AppConfig)
//   onboarding   — checklists on the person record; Recruiting → Hired
//                  creates the directory entry and starts one
//   calendar     — holidays, approved time off, birthdays, anniversaries,
//                  paydays, review days, expiries
//   company      — mission / values / who-to-call / seats (AppConfig)
// Everyone sees the company; only Mark + Kat see pay, notes, others' logs.
import express from 'express'
import catalyst from 'zcatalyst-sdk-node'
import multer from 'multer'
import { readTeamMembers, findMemberByIdentity, saveMemberPublic as saveMember } from './team.js'

const router = express.Router()
// Personnel files root in WorkDrive: Absolute ADAS Command Center → HR → Team (Mark, 2026-09-16). One subfolder per person.
const PEOPLE_FOLDER_ID = 'mniqhb081c583db4e4b54ae1a007f31f84c1b'
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } })
export async function ensurePersonFolder(req, m) {
  if (m.workdrive_folder_id) return m
  const { getAccessToken } = await import('../services/zoho.js')
  const { createFolderUnder } = await import('../services/workdrive.js')
  const token = await getAccessToken()
  const f = await createFolderUnder(PEOPLE_FOLDER_ID, m.name, token)
  m.workdrive_folder_id = f.folderId; m.workdrive_folder_url = f.folderUrl
  await saveMember(req, m)
  console.log(`[people] WorkDrive folder for ${m.name}: ${f.folderId}`)
  return m
}
const MARK_EMAILS = ['mark@absoluteadas.com', 'mf@absoluteadas.com', 'mfowler4456@gmail.com']
const isOwner = req => MARK_EMAILS.includes(String(req.user?.email || '').toLowerCase()) || req.user?.role === 'owner'
const todayPT = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const emailKey = uid => String(uid || 'unknown').toLowerCase().replace(/[^a-z0-9]+/g, '_')
const newId = p => `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
const firstName = s => String(s || '').trim().split(/\s+/)[0]

// ── AppConfig helpers (same table the time clock and stamps use) ──────
async function cfgRead(req, key) {
  const app = catalyst.initialize(req)
  const rows = await app.zcql().executeZCQLQuery(`SELECT ROWID, config_value FROM AppConfig WHERE config_key = '${key.replace(/'/g, "''")}' LIMIT 1`)
  const r = rows?.[0]?.AppConfig || rows?.[0] || null
  return r ? { rowid: String(r.ROWID), value: r.config_value } : null
}
async function cfgWrite(req, key, value) {
  const app = catalyst.initialize(req); const table = app.datastore().table('AppConfig')
  const cur = await cfgRead(req, key)
  const v = typeof value === 'string' ? value : JSON.stringify(value)
  if (cur) await table.updateRow({ ROWID: cur.rowid, config_key: key, config_value: v })
  else await table.insertRow({ config_key: key, config_value: v })
}
export async function cfgWriteJson(req, key, value) { return cfgWrite(req, key, value) }
export async function cfgReadJson(req, key, fallback) { return cfgJson(req, key, fallback) }
async function cfgJson(req, key, fallback) { const r = await cfgRead(req, key).catch(() => null); if (!r?.value) return fallback; try { return JSON.parse(r.value) } catch { return fallback } }

async function memberFor(req, id) {
  const members = await readTeamMembers(req)
  return { members, m: members.find(x => x.id === id || x.user_id === String(id).toLowerCase()) || null }
}
function isSelf(req, m) { const e = String(req.user?.email || '').toLowerCase(); return !!m && (m.user_id === e || (m.email && m.email === e) || (req.user?.name && m.name.toLowerCase() === String(req.user.name).toLowerCase())) }
function stripPay(m) { const { hourly_rate, payroll_type, salary_annual, period_bonus, filing_status, wise_email, wise_currency, zoho_payroll_employee_id, notes, ...rest } = m; return rest }

// ── Checklists ────────────────────────────────────────────────────────
// Items marked (auto) tick themselves as the new hire works through the onboarding link.
const ONBOARDING = [
  { key: 'invite',         label: 'Onboarding link sent (text + email)' },
  { key: 'photo',          label: 'Profile photo uploaded (auto)' },
  { key: 'emergency',      label: 'Personal info + emergency contact filled in (auto)' },
  { key: 'ids',            label: "Driver's license + Social Security card photographed (auto)" },
  { key: 'direct_deposit', label: 'Direct deposit authorization signed (auto)' },
  { key: 'handbook',       label: 'Handbook & policies signed (auto)' },
  { key: 'contract',       label: 'Contract / offer letter signed (auto — owner drops the PDF in their folder first)' },
  { key: 'training',       label: 'Training course passed — all modules (auto)' },
  { key: 'login',          label: 'App login + access level set (Directory → App access)' },
  { key: 'cliq',           label: 'Added to Cliq (#dispatch, #aajobs)' },
  { key: 'payroll',        label: 'Payroll set up — W-2 in Zoho Payroll or contractor in Wise (use the signed deposit PDF)' },
  { key: 'gear',           label: 'Van / tools / phone issued and listed under Equipment' },
  { key: 'rideaong',       label: 'First-week ride-along with Mark' },
  { key: 'checkin30',      label: '30-day check-in on the calendar' },
]
export function tickChecklist(m, key, by) {
  if (!m.checklist || m.checklist.kind !== 'onboarding') return
  const it = m.checklist.items.find(x => x.key === key)
  if (it && !it.done) { it.done = true; it.at = new Date().toISOString(); it.by = by || 'auto' }
  if (m.checklist.items.every(x => x.done)) m.checklist.completed_at = m.checklist.completed_at || new Date().toISOString()
}
const OFFBOARDING = [
  { key: 'access',    label: 'App access set to "No login"' },
  { key: 'cliq',      label: 'Removed from Cliq channels' },
  { key: 'gear',      label: 'Van, tools, phone, keys returned (check Equipment list)' },
  { key: 'hours',     label: 'Final hours report sent to payroll' },
  { key: 'payroll',   label: 'Removed from Zoho Payroll / Wise' },
  { key: 'workdrive', label: 'WorkDrive + email access removed' },
  { key: 'exit',      label: 'Exit conversation logged (1:1s)' },
]

// ── Profile ───────────────────────────────────────────────────────────
router.get('/profile/:id', async (req, res) => {
  try {
    const { members, m } = await memberFor(req, req.params.id)
    if (!m) return res.status(404).json({ error: 'Not found' })
    const owner = isOwner(req), self = isSelf(req, m)
    const out = { member: owner ? m : self ? { ...stripPay(m), payroll_type: m.payroll_type } : stripPay(m), boss: members.find(x => x.user_id === m.reports_to) || null, reports: members.filter(x => x.reports_to === m.user_id && x.active !== false).map(x => ({ id: x.id, name: x.name, title: x.title })) }
    if (owner || self) {
      const today = todayPT()
      try {
        const { semiMonthlyPeriod, buildHoursReport, computeSickBalances } = await import('../services/hr.js')
        const { readAttestations } = await import('./timeclock.js')
        const period = semiMonthlyPeriod(today, 0)
        const rep = await buildHoursReport(req, period.start, period.end)
        const me = rep.people.find(p => p.user_id === m.user_id) || null
        const att = (await readAttestations(req, period.start, [m.user_id]))[m.user_id] || null
        const prev = semiMonthlyPeriod(today, -1)
        const attPrev = (await readAttestations(req, prev.start, [m.user_id]))[m.user_id] || null
        out.hours = me ? { period, worked: me.worked, ot: me.ot, holiday: me.holiday, sick: me.sick, vacation: me.vacation, payable: me.payable, days: me.days.length, flags: me.flags, reviewed: !!att, prev_period: prev, prev_reviewed: !!attPrev } : null
        const bal = (await computeSickBalances(req))[firstName(m.name).toLowerCase()] || null
        out.sick = bal
      } catch (e) { out.hours_error = e.message }
      // Log entries: owners see all; the person sees their own 1:1s, reviews, training (not private notes)
      try {
        const rows = await catalyst.initialize(req, { type: 'advancedio' }).zcql().executeZCQLQuery(`SELECT * FROM PeopleLog WHERE pl_user_id = '${m.user_id.replace(/'/g, "''")}' ORDER BY pl_date DESC LIMIT 100`)
        out.log = (rows || []).map(r => { const x = r.PeopleLog || r; let j = {}; try { j = x.pl_json ? JSON.parse(x.pl_json) : {} } catch {} return { id: x.pl_id, user_id: x.pl_user_id, type: x.pl_type, date: x.pl_date, by: x.pl_by, ...j } })
          .filter(e => owner || (self && e.type !== 'note' && !e.private))
      } catch (e) { out.log = [] }
      out.acks = await policyAcksFor(req, m.user_id)
    }
    out.checklist_templates = { onboarding: ONBOARDING, offboarding: OFFBOARDING }
    if ((m.track || '') === 'apprentice' || m.ladder) { out.ladder = ladderProgress(m, await readLadder(req)); out.can_sign_off = canSignOff(req) && !isSelf(req, m) }
    res.json({ ok: true, ...out })
  } catch (e) { console.error('[people profile]', e.message); res.status(500).json({ error: e.message }) }
})

// ── Personnel folder + uploads ───────────────────────────────────────
router.post('/folder/:id', async (req, res) => {
  try {
    if (!isOwner(req)) return res.status(403).json({ error: 'Owners only' })
    const { m } = await memberFor(req, req.params.id)
    if (!m) return res.status(404).json({ error: 'Not found' })
    await ensurePersonFolder(req, m)
    res.json({ ok: true, folder_id: m.workdrive_folder_id, folder_url: m.workdrive_folder_url })
  } catch (e) { console.error('[people folder]', e.message); res.status(500).json({ error: e.message }) }
})
// Owner or the person themselves: photo/PDF from the phone → their folder → listed under Documents.
router.post('/folder/:id/upload', upload.single('file'), async (req, res) => {
  try {
    const { m } = await memberFor(req, req.params.id)
    if (!m) return res.status(404).json({ error: 'Not found' })
    if (!isOwner(req) && !isSelf(req, m)) return res.status(403).json({ error: 'You can only upload to your own file.' })
    if (!req.file) return res.status(400).json({ error: 'No file' })
    await ensurePersonFolder(req, m)
    const { getAccessToken } = await import('../services/zoho.js')
    const { uploadFileToFolder } = await import('../services/workdrive.js')
    const label = String(req.body?.name || '').trim() || (req.file.originalname || 'document')
    const ext = (req.file.originalname || '').match(/\.[a-z0-9]+$/i)?.[0] || (req.file.mimetype === 'application/pdf' ? '.pdf' : /jpe?g/.test(req.file.mimetype) ? '.jpg' : /png/.test(req.file.mimetype) ? '.png' : '')
    const filename = `${label.replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 80)}${label.toLowerCase().endsWith(ext.toLowerCase()) ? '' : ext}`
    const up = await uploadFileToFolder(m.workdrive_folder_id, filename, req.file.buffer, await getAccessToken(), req.file.mimetype)
    const fileId = String(up?.fileId || up?.id || up || '')
    const doc = { name: label, url: fileId ? `https://workdrive.zoho.com/file/${fileId}` : m.workdrive_folder_url, file_id: fileId, added: todayPT(), by: req.user?.name || req.user?.email || '' }
    m.documents = [...(Array.isArray(m.documents) ? m.documents : []), doc]
    await saveMember(req, m)
    console.log(`[people] ${doc.by} uploaded "${filename}" for ${m.name}`)
    res.json({ ok: true, document: doc, documents: m.documents })
  } catch (e) { console.error('[people upload]', e.message); res.status(500).json({ error: e.message }) }
})

// ── Log (1:1 · review · training · note) ─────────────────────────────
const LOG_TYPES = ['1on1', 'review', 'training', 'note']
router.post('/log', async (req, res) => {
  try {
    const b = req.body || {}
    const { m } = await memberFor(req, String(b.user_id || ''))
    if (!m) return res.status(404).json({ error: 'Person not found' })
    const owner = isOwner(req), self = isSelf(req, m)
    if (!owner && !(self && b.type === 'training')) return res.status(403).json({ error: 'Only Mark and Kat can add to someone\'s record (you can log your own training).' })
    const type = LOG_TYPES.includes(b.type) ? b.type : 'note'
    const entry = { id: newId('pl'), user_id: m.user_id, type, date: /^\d{4}-\d{2}-\d{2}$/.test(String(b.date || '')) ? b.date : todayPT(), by: req.user?.name || req.user?.email || '', title: String(b.title || '').slice(0, 200), body: String(b.body || '').slice(0, 8000), cost: Number(b.cost) || 0, private: !!b.private && owner, rating: b.rating != null ? Number(b.rating) : null, created_at: new Date().toISOString() }
    const { id, user_id, type: t, date, by, ...rest } = entry
    await catalyst.initialize(req, { type: 'advancedio' }).datastore().table('PeopleLog').insertRow({ pl_id: id, pl_user_id: user_id, pl_type: t, pl_date: date, pl_by: by, pl_json: JSON.stringify(rest) })
    res.json({ ok: true, entry })
  } catch (e) { res.status(500).json({ error: e.message }) }
})
router.delete('/log/:id', async (req, res) => {
  try {
    if (!isOwner(req)) return res.status(403).json({ error: 'Owners only' })
    const app = catalyst.initialize(req, { type: 'advancedio' })
    const rows = await app.zcql().executeZCQLQuery(`SELECT ROWID FROM PeopleLog WHERE pl_id = '${String(req.params.id).replace(/'/g, "''")}' LIMIT 1`)
    const r = rows?.[0]?.PeopleLog || rows?.[0]
    if (!r) return res.status(404).json({ error: 'Not found' })
    await app.datastore().table('PeopleLog').deleteRow(String(r.ROWID))
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── Policy acknowledgments ───────────────────────────────────────────
async function policyAcksFor(req, userId) { return cfgJson(req, `policy_ack:${emailKey(userId)}`, {}) }
router.get('/policy/acks', async (req, res) => {
  try {
    const me = await findMemberByIdentity(req, req.user?.email, req.user?.name)
    const mine = me ? await policyAcksFor(req, me.user_id) : {}
    let all = null
    if (isOwner(req)) {
      const members = (await readTeamMembers(req)).filter(m => m.active !== false && m.access !== 'none')
      all = {}
      for (const m of members) all[m.user_id] = { name: m.name, acks: await policyAcksFor(req, m.user_id) }
    }
    res.json({ ok: true, mine, all, me: me ? { user_id: me.user_id, name: me.name } : null })
  } catch (e) { res.status(500).json({ error: e.message }) }
})
router.post('/policy/ack', async (req, res) => {
  try {
    const me = await findMemberByIdentity(req, req.user?.email, req.user?.name)
    if (!me) return res.status(400).json({ error: 'You are not in the Directory yet — ask Mark.' })
    const pid = String(req.body?.policy_id || '').slice(0, 80), ver = String(req.body?.version || '').slice(0, 40)
    if (!pid || !ver) return res.status(400).json({ error: 'policy_id + version required' })
    const acks = await policyAcksFor(req, me.user_id)
    acks[pid] = { version: ver, at: new Date().toISOString(), name: me.name }
    await cfgWrite(req, `policy_ack:${emailKey(me.user_id)}`, acks)
    console.log(`[people] ${me.name} acknowledged policy ${pid} v${ver}`)
    res.json({ ok: true, acks })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── Onboarding / offboarding ─────────────────────────────────────────
export function startChecklist(m, kind, by) {
  const tpl = kind === 'offboarding' ? OFFBOARDING : ONBOARDING
  m.checklist = { kind, started_at: new Date().toISOString(), started_by: by, items: tpl.map(t => ({ ...t, done: false, at: '', by: '' })) }
  return m
}
router.post('/checklist/:id/start', async (req, res) => {
  try {
    if (!isOwner(req)) return res.status(403).json({ error: 'Owners only' })
    const { m } = await memberFor(req, req.params.id)
    if (!m) return res.status(404).json({ error: 'Not found' })
    startChecklist(m, req.body?.kind === 'offboarding' ? 'offboarding' : 'onboarding', req.user?.name || '')
    await saveMember(req, m)
    res.json({ ok: true, checklist: m.checklist })
  } catch (e) { res.status(500).json({ error: e.message }) }
})
router.post('/checklist/:id/toggle', async (req, res) => {
  try {
    if (!isOwner(req)) return res.status(403).json({ error: 'Owners only' })
    const { m } = await memberFor(req, req.params.id)
    if (!m?.checklist) return res.status(404).json({ error: 'No checklist' })
    const it = m.checklist.items.find(x => x.key === req.body?.key)
    if (!it) return res.status(404).json({ error: 'No such item' })
    it.done = !it.done; it.at = it.done ? new Date().toISOString() : ''; it.by = it.done ? (req.user?.name || '') : ''
    const allDone = m.checklist.items.every(x => x.done)
    if (allDone) { m.checklist.completed_at = new Date().toISOString(); if (m.checklist.kind === 'offboarding') { m.active = false; m.access = 'none'; m.left_at = m.left_at || todayPT() } }
    await saveMember(req, m)
    res.json({ ok: true, checklist: m.checklist, member_active: m.active })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── Calendar ─────────────────────────────────────────────────────────
router.get('/calendar', async (req, res) => {
  try {
    const from = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from || '')) ? String(req.query.from) : todayPT()
    const to = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to || '')) ? String(req.query.to) : addDays(from, 90)
    const owner = isOwner(req)
    const members = (await readTeamMembers(req)).filter(m => m.active !== false)
    const { paidHolidaysForYear } = await import('../services/hr.js')
    const ev = []
    const y0 = Number(from.slice(0, 4)), y1 = Number(to.slice(0, 4))
    for (let y = y0; y <= y1; y++) for (const h of paidHolidaysForYear(y)) ev.push({ date: h.date, type: 'holiday', title: `🎉 ${h.name} — paid holiday` })
    for (const m of members) {
      const who = m.preferred_name || firstName(m.name)
      for (let y = y0; y <= y1; y++) {
        if (/^\d{2}-\d{2}$/.test(m.birthday || '')) ev.push({ date: `${y}-${m.birthday}`, type: 'birthday', title: `🎂 ${who}'s birthday`, user_id: m.user_id })
        if (m.hire_date && m.hire_date.slice(0, 4) < String(y)) { const n = y - Number(m.hire_date.slice(0, 4)); ev.push({ date: `${y}-${m.hire_date.slice(5)}`, type: 'anniversary', title: `🏅 ${who} — ${n} year${n === 1 ? '' : 's'} with Absolute ADAS`, user_id: m.user_id }) }
      }
      for (const c of Array.isArray(m.certifications) ? m.certifications : []) if (c?.expires) ev.push({ date: c.expires, type: 'expiry', title: `📄 ${who}: ${c.name} expires`, user_id: m.user_id })
      if (m.license_expiry) ev.push({ date: m.license_expiry, type: 'expiry', title: `🪪 ${who}: driver's license expires`, user_id: m.user_id })
      if (m.checklist && !m.checklist.completed_at && m.checklist.kind === 'onboarding' && m.checklist.started_at) ev.push({ date: addDays(m.checklist.started_at.slice(0, 10), 30), type: 'checkin', title: `🗓 ${who} — 30-day check-in`, user_id: m.user_id })
    }
    // paydays + review days
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const dd = d.slice(8), last = String(new Date(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)), 0)).getUTCDate())
      if (dd === '01' || dd === '16') ev.push({ date: d, type: 'payday', title: '💵 Payday' })
      if (dd === '15' || dd === last) ev.push({ date: d, type: 'review', title: '⏱ Time card review day — approve your hours' })
    }
    try {
      const { getRequestsDurable } = await import('./pto.js')
      const reqs = (await getRequestsDurable(req)) || []
      const me = String(req.user?.email || '').toLowerCase()
      for (const r of reqs) {
        if (String(r.status) !== 'approved') continue
        if (!(String(r.start_date) <= to && String(r.end_date) >= from)) continue
        const who = firstName(r.user_name || r.user_id)
        const kind = r.type === 'sick' ? '🤒 sick' : r.type === 'unpaid' ? '⏸ unpaid time off' : '🏖 time off'
        ev.push({ date: String(r.start_date), end: String(r.end_date), type: 'timeoff', title: `${who} — ${kind}${r.end_date && r.end_date !== r.start_date ? ` through ${r.end_date}` : ''}`, user_id: r.user_id, mine: r.user_id === me })
      }
    } catch { /* pto unavailable */ }
    const out = ev.filter(e => e.date >= from && e.date <= to).sort((a, b) => a.date.localeCompare(b.date) || a.type.localeCompare(b.type))
    res.json({ ok: true, from, to, events: owner ? out : out.filter(e => e.type !== 'expiry' || e.user_id === String(req.user?.email || '').toLowerCase()) })
  } catch (e) { console.error('[people calendar]', e.message); res.status(500).json({ error: e.message }) }
})
function addDays(iso, n) { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

// ── Company page ─────────────────────────────────────────────────────
const COMPANY_DEFAULT = {
  mission: 'Same day. Done right. We calibrate ADAS systems at the shop so cars leave safe, the shop gets paid, and nobody waits on a dealer.',
  values: ['Do it right the first time', 'Show up when we said we would', 'Tell the shop the truth, even when it costs us', 'Photos and paperwork on every car, every time', 'GET SOME!!!'],
  who_to_call: [
    { need: 'Scheduling a calibration / job status', person: 'Kat Belmonte', note: 'Dispatch — text or Cliq #dispatch' },
    { need: 'Invoices, quotes, Big 3 rules, insurer questions', person: 'Kat Belmonte', note: 'Billing' },
    { need: 'Technical question on a calibration or a scan', person: 'Mark Fowler', note: 'Call — urgent on the car' },
    { need: 'Van, tools, targets, equipment', person: 'Mark Fowler', note: '' },
    { need: 'Paycheck, hours, time off', person: 'Mark Fowler', note: 'Hours page in the app first' },
    { need: 'Bookkeeping, statements, receipts', person: 'Joyce Cruz', note: 'Through Mark' },
    { need: 'Emergency on site', person: '911, then Mark', note: '' },
  ],
  seats: [
    { title: 'Founder & Owner', person: 'Mark Fowler', responsibilities: 'Sets direction, sells, calibrates, approves time cards + time off, final say on pricing.' },
    { title: 'Operations Manager', person: 'Kat Belmonte', responsibilities: 'Dispatch, scheduling, invoicing + quotes, customer + insurer communication, CRM, Big 3 rules, sales-stop follow-ups.' },
    { title: 'ADAS Calibration Technician', person: 'Jayden Goshorn', responsibilities: 'Runs calibrations at the shop, full photo set + PCSI on every car, clock in/out, keeps the van stocked.' },
    { title: 'Accounting Specialist', person: 'Joyce Cruz', responsibilities: 'Books reconciliation, payroll hours to Zoho Payroll / Wise, monthly statements, receipts.' },
  ],
  updated_at: '', updated_by: '',
}
router.get('/company', async (req, res) => { try { res.json({ ok: true, company: await cfgJson(req, 'company_page', COMPANY_DEFAULT), editable: isOwner(req) }) } catch (e) { res.status(500).json({ error: e.message }) } })
router.put('/company', async (req, res) => {
  try {
    if (!isOwner(req)) return res.status(403).json({ error: 'Owners only' })
    const b = req.body || {}
    const company = { mission: String(b.mission || '').slice(0, 2000), values: (Array.isArray(b.values) ? b.values : []).map(v => String(v).slice(0, 200)).filter(Boolean).slice(0, 12),
      who_to_call: (Array.isArray(b.who_to_call) ? b.who_to_call : []).map(x => ({ need: String(x.need || '').slice(0, 200), person: String(x.person || '').slice(0, 120), note: String(x.note || '').slice(0, 200) })).filter(x => x.need).slice(0, 30),
      seats: (Array.isArray(b.seats) ? b.seats : []).map(x => ({ title: String(x.title || '').slice(0, 120), person: String(x.person || '').slice(0, 120), responsibilities: String(x.responsibilities || '').slice(0, 1000) })).filter(x => x.title).slice(0, 30),
      updated_at: new Date().toISOString(), updated_by: req.user?.name || req.user?.email || '' }
    await cfgWrite(req, 'company_page', company)
    res.json({ ok: true, company })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── Course (Directory → Training) + handbook ─────────────────────────
export async function readCourse(req) {
  const { DEFAULT_COURSE } = await import('../services/onboardingCourse.js')
  const c = await cfgJson(req, 'onboarding_course', null)
  return c && Array.isArray(c.modules) && c.modules.length ? c : DEFAULT_COURSE
}
router.get('/course', async (req, res) => { try { const c = await readCourse(req); const owner = isOwner(req); const me = await findMemberByIdentity(req, req.user?.email, req.user?.name); res.json({ ok: true, editable: owner, course: owner ? c : { ...c, modules: c.modules.map(m => ({ ...m, quiz: (m.quiz || []).map(q => ({ id: q.id, q: q.q, options: q.options })) })) }, my_progress: me?.training || {}, my_id: me?.id || null }) } catch (e) { res.status(500).json({ error: e.message }) } })
router.put('/course', async (req, res) => {
  try {
    if (!isOwner(req)) return res.status(403).json({ error: 'Owners only' })
    const b = req.body || {}
    const modules = (Array.isArray(b.modules) ? b.modules : []).map((m, i) => ({ id: String(m.id || `m${i + 1}`).replace(/[^a-z0-9_-]/gi, '').slice(0, 40) || `m${i + 1}`, tracks: (Array.isArray(m.tracks) && m.tracks.length ? m.tracks : ['core']).filter(t => ['core', 'tech', 'apprentice', 'ops'].includes(t)), title: String(m.title || '').slice(0, 120), minutes: Number(m.minutes) || 5, video_url: String(m.video_url || '').slice(0, 500), reading: String(m.reading || '').slice(0, 6000),
      quiz: (Array.isArray(m.quiz) ? m.quiz : []).map((q, k) => ({ id: String(q.id || `q${k + 1}`).slice(0, 20), q: String(q.q || '').slice(0, 300), options: (Array.isArray(q.options) ? q.options : []).map(o => String(o).slice(0, 200)).filter(Boolean).slice(0, 6), correct: Number(q.correct) || 0 })).filter(q => q.q && q.options.length >= 2) })).filter(m => m.title)
    const course = { version: (Number(b.version) || 1) + 1, pass_pct: Math.min(100, Math.max(50, Number(b.pass_pct) || 80)), modules, updated_at: new Date().toISOString(), updated_by: req.user?.name || '' }
    await cfgWrite(req, 'onboarding_course', course)
    res.json({ ok: true, course })
  } catch (e) { res.status(500).json({ error: e.message }) }
})
// ── Apprentice skills ladder (Mark 2026-09-16) ───────────────────────
export const DEFAULT_LADDER = [
  { key: 'photo_set',    label: 'Full photo set + safety inspection, no misses', need: 5 },
  { key: 'front_camera', label: 'Front camera — static calibration', need: 5 },
  { key: 'front_radar',  label: 'Front radar calibration', need: 5 },
  { key: 'blind_spot',   label: 'Blind spot / rear radar', need: 5 },
  { key: 'dynamic',      label: 'Dynamic (drive) calibration', need: 5 },
  { key: 'surround',     label: '360 / surround camera', need: 3 },
  { key: 'diagnostics',  label: 'Pre/post scan + clearing codes', need: 5 },
  { key: 'solo_day',     label: 'Full day solo with remote support', need: 2 },
]
export async function readLadder(req) { const l = await cfgJson(req, 'apprentice_ladder', null); return Array.isArray(l) && l.length ? l : DEFAULT_LADDER }
export function ladderProgress(m, ladder) { const so = m.ladder || {}; const rungs = ladder.map(r => ({ ...r, done: (so[r.key] || []).length, complete: (so[r.key] || []).length >= r.need, signoffs: so[r.key] || [] })); return { rungs, complete: rungs.every(r => r.complete), pct: Math.round((rungs.reduce((s, r) => s + Math.min(r.done, r.need), 0) / Math.max(1, rungs.reduce((s, r) => s + r.need, 0))) * 100) } }
const canSignOff = req => isOwner(req) || req.user?.role === 'technician' || req.user?.role === 'dispatcher'
router.get('/ladder', async (req, res) => { try { res.json({ ok: true, ladder: await readLadder(req), editable: isOwner(req) }) } catch (e) { res.status(500).json({ error: e.message }) } })
router.put('/ladder', async (req, res) => {
  try {
    if (!isOwner(req)) return res.status(403).json({ error: 'Owners only' })
    const ladder = (Array.isArray(req.body?.ladder) ? req.body.ladder : []).map((r, i) => ({ key: String(r.key || `r${i + 1}`).replace(/[^a-z0-9_]/gi, '').slice(0, 30) || `r${i + 1}`, label: String(r.label || '').slice(0, 120), need: Math.max(1, Math.min(50, Number(r.need) || 1)) })).filter(r => r.label)
    await cfgWrite(req, 'apprentice_ladder', ladder); res.json({ ok: true, ladder })
  } catch (e) { res.status(500).json({ error: e.message }) }
})
router.post('/ladder/:id/signoff', async (req, res) => {
  try {
    if (!canSignOff(req)) return res.status(403).json({ error: 'A technician, Kat or Mark signs rungs off.' })
    const { m } = await memberFor(req, req.params.id)
    if (!m) return res.status(404).json({ error: 'Not found' })
    if (isSelf(req, m)) return res.status(403).json({ error: "You can't sign off your own rung — the tech you rode with does it." })
    const ladder = await readLadder(req); const rung = ladder.find(r => r.key === req.body?.key)
    if (!rung) return res.status(404).json({ error: 'No such rung' })
    m.ladder = m.ladder || {}; m.ladder[rung.key] = [...(m.ladder[rung.key] || []), { at: new Date().toISOString(), by: req.user?.name || req.user?.email || '', note: String(req.body?.note || '').slice(0, 200), job: String(req.body?.job || '').slice(0, 60) }]
    const prog = ladderProgress(m, ladder)
    await saveMember(req, m)
    if (prog.complete && !m.ladder_complete_pinged) {
      m.ladder_complete_pinged = new Date().toISOString(); await saveMember(req, m)
      try { const { postToCliqChannelById, MARK_ALERT_CHANNEL_ID } = await import('../services/cliq.js'); await postToCliqChannelById(MARK_ALERT_CHANNEL_ID, `🎓 *${m.name} finished the apprentice ladder* — every rung signed off. Promote from Directory → ${m.name} → "Promote to technician".`) } catch {}
    }
    res.json({ ok: true, progress: prog })
  } catch (e) { res.status(500).json({ error: e.message }) }
})
router.post('/ladder/:id/undo', async (req, res) => {
  try {
    if (!isOwner(req)) return res.status(403).json({ error: 'Owners only' })
    const { m } = await memberFor(req, req.params.id)
    if (!m?.ladder?.[req.body?.key]?.length) return res.status(404).json({ error: 'Nothing to undo' })
    m.ladder[req.body.key].pop(); await saveMember(req, m); res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})
router.post('/promote/:id', async (req, res) => {
  try {
    if (!isOwner(req)) return res.status(403).json({ error: 'Owners only' })
    const { m } = await memberFor(req, req.params.id)
    if (!m) return res.status(404).json({ error: 'Not found' })
    m.track = 'tech'; m.title = 'ADAS Calibration Technician'; m.promoted_at = todayPT()
    if (m.access === 'none') m.access = 'technician'
    await saveMember(req, m)
    try { const { postToCliqChannel, postToCliqChannelById, DISPATCH_CHANNEL, MARK_ALERT_CHANNEL_ID } = await import('../services/cliq.js'); const line = `🎉 *${m.name} is now an ADAS Calibration Technician!* Ladder complete, promoted by ${req.user?.name || 'Mark'}. GET SOME!!!`; await Promise.allSettled([postToCliqChannel(DISPATCH_CHANNEL, line), postToCliqChannelById(MARK_ALERT_CHANNEL_ID, line)]) } catch {}
    res.json({ ok: true, member: m })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.get('/handbook', async (req, res) => { try { const { SECTIONS, handbookHash } = await import('../services/handbook.js'); res.json({ ok: true, sections: SECTIONS, version: handbookHash() }) } catch (e) { res.status(500).json({ error: e.message }) } })

// ── Onboarding link: owner sends it; the person can open their own ──
export async function onboardingLink(req, m) {
  const { makeOnboardToken } = await import('./onboardPublic.js')
  const base = process.env.WEB_BASE_URL || `${req.protocol}://${req.get('host')}/app`
  return `${base}/?onboard=${encodeURIComponent(m.id)}&t=${encodeURIComponent(makeOnboardToken(m.id))}`
}
export async function sendOnboardingInvite(req, m, by) {
  const link = await onboardingLink(req, m)
  const to = { sms: m.personal_phone || m.phone || '', email: m.personal_email || m.email || '' }
  const out = { link, sms: null, email: null }
  const first = m.preferred_name || firstName(m.name)
  if (to.sms) {
    try { const { sendTwilioSMS } = await import('../services/twilio.js'); const r = await sendTwilioSMS({ to: to.sms, body: `Hi ${first}, welcome to Absolute ADAS! Here's your onboarding link — takes about 20 minutes on your phone (photo, ID, direct deposit, a short training). ${link}  — Mark` }); out.sms = r?.ok ? { ok: true, to: to.sms } : { ok: false, error: r?.error || 'failed' } } catch (e) { out.sms = { ok: false, error: e.message } }
  }
  if (to.email) {
    try {
      const { getMailAccessToken, getMailAccountId, sendMail } = await import('../services/mail.js')
      const token = await getMailAccessToken(); const accountId = await getMailAccountId(token)
      const html = `<div style="font-family:-apple-system,Helvetica,Arial,sans-serif;max-width:560px;color:#1a1a1a"><div style="background:#CD4419;color:white;padding:14px 18px;border-radius:10px 10px 0 0;font-weight:700">Absolute ADAS · Welcome aboard</div><div style="border:1px solid #e8e4e0;border-top:none;padding:18px;border-radius:0 0 10px 10px"><p>Hi ${first},</p><p>Welcome to Absolute ADAS. Your onboarding is done on your phone and takes about 20 minutes: a profile photo, a photo of your driver's license and Social Security card, direct deposit, the handbook, and a short training with a few questions.</p><p style="text-align:center;margin:20px 0"><a href="${link}" style="background:#15803d;color:white;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:700">Start my onboarding</a></p><p style="color:#666;font-size:12px">The link is good for 45 days and is just for you. Questions — call Mark.</p><p>GET SOME!!!<br>— Mark</p></div></div>`
      await sendMail(token, accountId, { to: to.email, subject: 'Welcome to Absolute ADAS — your onboarding link', body: html }); out.email = { ok: true, to: to.email }
    } catch (e) { out.email = { ok: false, error: e.message } }
  }
  if (!m.checklist) startChecklist(m, 'onboarding', by || 'app')
  tickChecklist(m, 'invite', by || 'app')
  m.onboarding_invited_at = new Date().toISOString()
  await saveMember(req, m)
  console.log(`[people] onboarding invite for ${m.name}: sms ${out.sms?.ok ? 'ok' : out.sms?.error || 'none'} · email ${out.email?.ok ? 'ok' : out.email?.error || 'none'}`)
  return out
}
router.post('/onboarding/:id/invite', async (req, res) => {
  try {
    if (!isOwner(req)) return res.status(403).json({ error: 'Owners only' })
    const { m } = await memberFor(req, req.params.id)
    if (!m) return res.status(404).json({ error: 'Not found' })
    if (req.body?.personal_phone) m.personal_phone = String(req.body.personal_phone).slice(0, 40)
    if (req.body?.personal_email) m.personal_email = String(req.body.personal_email).slice(0, 120)
    try { await ensurePersonFolder(req, m) } catch (e) { console.warn('[people] folder before invite failed:', e.message) }
    const out = await sendOnboardingInvite(req, m, req.user?.name)
    res.json({ ok: true, ...out })
  } catch (e) { console.error('[people invite]', e.message); res.status(500).json({ error: e.message }) }
})
router.get('/onboarding/my-link', async (req, res) => {
  try {
    const me = await findMemberByIdentity(req, req.user?.email, req.user?.name)
    if (!me) return res.status(404).json({ error: 'You are not in the Directory yet.' })
    res.json({ ok: true, link: await onboardingLink(req, me) })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── Daily nudges to Mark (7am PT, once a day) — birthdays, anniversaries,
//    expiries ≤ 30 days, onboarding still open, policy acks missing (Mondays)
export async function maybePeopleNudges(req) {
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', hour12: false }).format(new Date()))
  if (hour < 7) return { fired: false, reason: 'before 7am' }
  const today = todayPT()
  const stamp = `people_nudges:${today}`
  if (await cfgRead(req, stamp).catch(() => null)) return { fired: false, reason: 'already today' }
  const members = (await readTeamMembers(req)).filter(m => m.active !== false)
  const lines = []
  const mmdd = today.slice(5), tomorrow = addDays(today, 1).slice(5)
  for (const m of members) {
    const who = m.preferred_name || firstName(m.name)
    if (m.birthday === mmdd) lines.push(`🎂 ${who}'s birthday is TODAY`)
    else if (m.birthday === tomorrow) lines.push(`🎂 ${who}'s birthday is tomorrow`)
    if (m.hire_date && m.hire_date.slice(5) === mmdd && m.hire_date < today) lines.push(`🏅 ${who} — ${Number(today.slice(0, 4)) - Number(m.hire_date.slice(0, 4))} year(s) with Absolute ADAS today`)
    for (const c of Array.isArray(m.certifications) ? m.certifications : []) if (c?.expires && c.expires >= today && c.expires <= addDays(today, 30)) lines.push(`📄 ${who}: ${c.name} expires ${c.expires}`)
    if (m.license_expiry && m.license_expiry >= today && m.license_expiry <= addDays(today, 30)) lines.push(`🪪 ${who}: driver's license expires ${m.license_expiry}`)
    if (m.checklist && !m.checklist.completed_at) { const open = m.checklist.items.filter(i => !i.done).length; if (open && m.checklist.started_at.slice(0, 10) <= addDays(today, -7)) lines.push(`📋 ${who}: ${m.checklist.kind} still has ${open} open item(s) after a week`) }
  }
  if (new Date(today + 'T12:00:00Z').getUTCDay() === 1) {
    for (const m of members) if (m.access !== 'none') { const acks = await policyAcksFor(req, m.user_id); if (!Object.keys(acks).length) lines.push(`📝 ${m.preferred_name || firstName(m.name)} hasn't acknowledged the HR policy yet`) }
  }
  await cfgWrite(req, stamp, new Date().toISOString())
  if (!lines.length) return { fired: true, sent: 0 }
  const { postToCliqChannelById, MARK_ALERT_CHANNEL_ID } = await import('../services/cliq.js')
  await postToCliqChannelById(MARK_ALERT_CHANNEL_ID, `👥 *People today*\n${lines.join('\n')}`)
  return { fired: true, sent: lines.length }
}

// Recruiting → Hired: create the directory entry + start onboarding
export async function onCandidateHired(req, cand) {
  const members = await readTeamMembers(req)
  const email = String(cand.email || '').toLowerCase()
  const exists = members.find(m => (email && (m.user_id === email || m.email === email)) || m.name.toLowerCase() === String(cand.name || '').toLowerCase())
  if (exists) return { created: false, member: exists }
  const { createMemberPublic } = await import('./team.js')
  const roleText = String(cand.role || '').toLowerCase()
  const track = /apprentice|trainee|junior/.test(roleText) ? 'apprentice' : /billing|dispatch|office|admin|assistant|book|account|ops/.test(roleText) ? 'ops' : 'tech'
  const m = await createMemberPublic(req, { name: cand.name, email, user_id: email, phone: cand.phone || '', title: cand.role || (track === 'apprentice' ? 'Apprentice ADAS Technician' : track === 'ops' ? 'Billing & Dispatch' : 'ADAS Calibration Technician'), department: track === 'ops' ? 'Operations' : 'Field', track, access: 'none', employment: 'w2', reports_to: 'mark@absoluteadas.com', region: cand.city || '', hire_date: todayPT(), notes: `From Recruiting${cand.source ? ` (${cand.source})` : ''}. Set App access once ready.` })
  startChecklist(m, 'onboarding', req.user?.name || 'Recruiting')
  await saveMember(req, m)
  try { await ensurePersonFolder(req, m) } catch (e) { console.warn('[people] folder on hire failed:', e.message) }
  try { if (m.phone || m.email) await sendOnboardingInvite(req, m, 'Recruiting') } catch (e) { console.warn('[people] invite on hire failed:', e.message) }
  try { const { postToCliqChannelById, MARK_ALERT_CHANNEL_ID } = await import('../services/cliq.js'); await postToCliqChannelById(MARK_ALERT_CHANNEL_ID, `🎉 *${m.name} marked Hired* — added to the Directory (no login yet) and onboarding checklist started. Directory → ${m.name} → Onboarding.`) } catch {}
  return { created: true, member: m }
}

export default router
