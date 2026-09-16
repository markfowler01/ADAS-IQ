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
import { readTeamMembers, findMemberByIdentity, saveMemberPublic as saveMember } from './team.js'

const router = express.Router()
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
async function cfgJson(req, key, fallback) { const r = await cfgRead(req, key).catch(() => null); if (!r?.value) return fallback; try { return JSON.parse(r.value) } catch { return fallback } }

async function memberFor(req, id) {
  const members = await readTeamMembers(req)
  return { members, m: members.find(x => x.id === id || x.user_id === String(id).toLowerCase()) || null }
}
function isSelf(req, m) { const e = String(req.user?.email || '').toLowerCase(); return !!m && (m.user_id === e || (m.email && m.email === e) || (req.user?.name && m.name.toLowerCase() === String(req.user.name).toLowerCase())) }
function stripPay(m) { const { hourly_rate, payroll_type, salary_annual, period_bonus, filing_status, wise_email, wise_currency, zoho_payroll_employee_id, notes, ...rest } = m; return rest }

// ── Checklists ────────────────────────────────────────────────────────
const ONBOARDING = [
  { key: 'login',     label: 'App login + access level set (Directory → App access)' },
  { key: 'cliq',      label: 'Added to Cliq (#dispatch, #aajobs)' },
  { key: 'timeclock', label: 'Walked through the time clock (clock in/out, breaks, photo set)' },
  { key: 'payroll',   label: 'Payroll set up — W-2 in Zoho Payroll or contractor in Wise' },
  { key: 'w4',        label: 'W-4 / I-9 / direct deposit on file (W-2) — or contract signed (contractor)' },
  { key: 'handbook',  label: 'HR policy acknowledged in the app' },
  { key: 'emergency', label: 'Emergency contact + photo on the Directory card' },
  { key: 'gear',      label: 'Van / tools / phone issued and listed under Equipment' },
  { key: 'rideaong',  label: 'First-week ride-along with Mark' },
  { key: 'checkin30', label: '30-day check-in on the calendar' },
]
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
    res.json({ ok: true, ...out })
  } catch (e) { console.error('[people profile]', e.message); res.status(500).json({ error: e.message }) }
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
  const m = await createMemberPublic(req, { name: cand.name, email, user_id: email, phone: cand.phone || '', title: cand.role || 'ADAS Calibration Technician', department: 'Field', access: 'none', employment: 'w2', reports_to: 'mark@absoluteadas.com', region: cand.city || '', hire_date: todayPT(), notes: `From Recruiting${cand.source ? ` (${cand.source})` : ''}. Set App access to Technician once ready.` })
  startChecklist(m, 'onboarding', req.user?.name || 'Recruiting')
  await saveMember(req, m)
  try { const { postToCliqChannelById, MARK_ALERT_CHANNEL_ID } = await import('../services/cliq.js'); await postToCliqChannelById(MARK_ALERT_CHANNEL_ID, `🎉 *${m.name} marked Hired* — added to the Directory (no login yet) and onboarding checklist started. Directory → ${m.name} → Onboarding.`) } catch {}
  return { created: true, member: m }
}

export default router
