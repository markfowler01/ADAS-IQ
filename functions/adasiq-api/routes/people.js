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
import { VAN_KIT } from '../services/vanKit.js'

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
// Our side of Hired (Mark 2026-09-22: "two flows pop up… one for us on the
// backside so we don't forget anything"). Every item has an OWNER who gets
// nudged and a DUE day relative to the start date (negative = before day
// one). "auto" items tick themselves from the portal.
const ONBOARDING = [
  // ── before day one: accounts + kit (Mark 2026-09-22, the real list) ──
  { key: 'zoho_account',   label: 'Zoho user + email created — {email}', owner: 'kat', due: -10 },
  { key: 'invite',         label: 'Onboarding link sent (text + email)', owner: 'auto', due: -10 },
  { key: 'contract',       label: 'Contract / offer letter signed', owner: 'auto', due: -10 },
  { key: 'sim',            label: 'SIM card / hotspot ordered for the tablet', owner: 'kat', due: -7, tech_only: true },
  { key: 'uniform',        label: 'Uniform ordered — 6 khaki pants (Costco) {pants}, 6 embroidered polos {shirt}, hat', owner: 'kat', due: -7 },
  { key: 'insurance',      label: 'Added to the Progressive auto policy — BEFORE they drive', owner: 'kat', due: -3, tech_only: true },
  { key: 'fuel_card',      label: 'Fuel card ordered in their name (last 4 on the Cards line)', owner: 'kat', due: -5, tech_only: true },
  { key: 'remote_expert',  label: 'Remote Expert payment set up — preloaded Autel balance or a virtual card locked to Autel with a monthly cap; no physical credit card', owner: 'kat', due: -3, tech_only: true },
  { key: 'photo',          label: 'Profile photo uploaded', owner: 'auto', due: -7 },
  { key: 'emergency',      label: 'Personal info + emergency contact filled in', owner: 'auto', due: -7 },
  { key: 'ids',            label: "Driver's license + Social Security card photographed", owner: 'auto', due: -7 },
  { key: 'kinetic',        label: 'Kinetic: added to our account so they can look up calibrations (one-tap email below)', owner: 'kat', due: -3, tech_only: true },
  { key: 'alldata',        label: 'AllData login + password created', owner: 'kat', due: -3, tech_only: true },
  { key: 'autoauth',       label: 'AutoAuth (secure gateway) access set up', owner: 'kat', due: -3, tech_only: true },
  { key: 'w4',             label: 'Form W-4 uploaded', owner: 'auto', due: -3, w2_only: true },
  { key: 'mvr',            label: 'Driving record (MVR) on file — techs drive customers\' cars', owner: 'auto', due: -3, tech_only: true },
  { key: 'direct_deposit', label: 'Direct deposit / payout authorization signed', owner: 'auto', due: -3 },
  { key: 'handbook',       label: 'Handbook & policies signed', owner: 'auto', due: -3 },
  { key: 'van_assigned',   label: 'Van + scan tool assigned (set in Setup above)', owner: 'mark', due: -2, tech_only: true },
  { key: 'route',          label: 'Route assigned — area, service shops, shops to grow', owner: 'mark', due: -1, tech_only: true },
  { key: 'cliq',           label: 'Added to Cliq — {cliq}', owner: 'kat', due: -1 },
  { key: 'gear',           label: 'Gear handed over — van signed for by the tech (office: every personal line issued)', owner: 'mark', due: -1 },
  { key: 'training',       label: 'Training course passed — all modules', owner: 'auto', due: -1 },
  { key: 'login',          label: 'Signed into the Absolute ADAS app at least once (account is on from day one so they can poke around)', owner: 'auto', due: -3 },
  // ── day one and after ──
  { key: 'van_handover',   label: 'Van handover done by the tech on their portal — tools inventoried with photos + video, mileage, tread, damage, signed', owner: 'auto', due: 0, tech_only: true },
  { key: 'payroll',        label: 'Payroll set up — W-2 in Zoho Payroll or contractor in Wise, from the signed payout PDF', owner: 'kat', due: 2 },
  { key: 'i9',             label: 'Form I-9 completed in Zoho Payroll (within 3 business days of the start date)', owner: 'kat', due: 3, w2_only: true },
  { key: 'rideaong',       label: 'Ride-along with Mark done — {ride}', owner: 'mark', due: 7 },
  { key: 'oem',            label: 'OEM tool logins — one shared subscription if we can swing it', owner: 'kat', due: 30, tech_only: true },
  { key: 'checkin30',      label: '30-day check-in logged', owner: 'mark', due: 30 },
]
// Ride-along length depends on who they are (Mark): green → three weeks, certified → one.
const rideDays = m => (m.experience_level === 'certified' ? 7 : 21)
const rideText = m => (m.experience_level === 'certified' ? 'certified tech, about a week' : 'new to calibration, about three weeks')
const cliqText = m => ((m.track || 'tech') === 'ops' ? '#dispatch + #aajobs + #technicians' : '#technicians + #aajobs')
const emailFor = m => (m.email || `${String(m.preferred_name || m.name || '').trim().split(/\s+/)[0].toLowerCase().replace(/[^a-z0-9]/g, '')}@absoluteadas.com`)
function fillLabel(t, m) {
  const pants = m.pants_waist || m.pants_inseam ? `(W${m.pants_waist || '?'} × L${m.pants_inseam || '?'})` : '(waist/inseam from their portal)'
  const shirt = m.shirt_size ? `(${m.shirt_size})` : '(size from their portal)'
  return t.label.replace('{email}', emailFor(m)).replace('{cliq}', cliqText(m)).replace('{ride}', rideText(m)).replace('{pants}', pants).replace('{shirt}', shirt)
}
function dueFor(t, m) { return t.key === 'rideaong' ? rideDays(m) : t.due }
export { WELCOME_DEFAULT, vanKey, PERSONAL_GROUPS }
export function tickChecklist(m, key, by) {
  if (!m.checklist || m.checklist.kind !== 'onboarding') return
  const it = m.checklist.items.find(x => x.key === key)
  if (it && !it.done) { it.done = true; it.at = new Date().toISOString(); it.by = by || 'auto' }
  if (m.checklist.items.every(x => x.done)) m.checklist.completed_at = m.checklist.completed_at || new Date().toISOString()
}
const OFFBOARDING = [
  { key: 'access',    label: 'App access set to "No login" — Mark or Kat (Directory → Edit → App access)' },
  { key: 'cliq',      label: 'Removed from Cliq channels — Kat' },
  { key: 'gear',      label: 'Van, tools, phone, keys returned — Mark (check the Equipment list on the profile)' },
  { key: 'hours',     label: 'Final hours report sent to payroll — Mark (Payroll → Hours → Copy)' },
  { key: 'payroll',   label: 'Removed from Zoho Payroll / Wise — Mark' },
  { key: 'workdrive', label: 'WorkDrive + Zoho email access removed — Mark (Zoho admin)' },
  { key: 'exit',      label: 'Exit conversation logged under 1:1s — Mark' },
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
// One-shot / safety net: a folder for every active person (owner, or the cron secret).
router.post('/folders/ensure-all', async (req, res) => {
  try {
    const secret = String(process.env.BILLING_CRON_SECRET || process.env.MORNING_CRON_SECRET || 'morning-2026').trim()
    if (!isOwner(req) && String(req.headers['x-cron-secret'] || '').trim() !== secret) return res.status(403).json({ error: 'Owner only.' })
    const members = (await readTeamMembers(req)).filter(m => m.active !== false)
    const out = []
    for (const m of members) { try { const had = !!m.workdrive_folder_id; await ensurePersonFolder(req, m); out.push({ name: m.name, folder_id: m.workdrive_folder_id, created: !had }) } catch (e) { out.push({ name: m.name, error: e.message }) } }
    res.json({ ok: true, folders: out })
  } catch (e) { res.status(500).json({ error: e.message }) }
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
// Log a check-in / review from the calendar in one tap: writes the entry AND
// marks that check-in done so it leaves the calendar and the 7am nudge.
router.post('/checkin/:id/done', async (req, res) => {
  try {
    if (!isOwner(req)) return res.status(403).json({ error: 'Owners only' })
    const { m } = await memberFor(req, req.params.id)
    if (!m) return res.status(404).json({ error: 'Not found' })
    const key = String(req.body?.key || '').slice(0, 12)
    if (!/^(d30|d60|d90|y\d{4})$/.test(key)) return res.status(400).json({ error: 'bad key' })
    m.checkins = { ...(m.checkins || {}), [key]: { at: new Date().toISOString(), by: req.user?.name || '' } }
    await saveMember(req, m)
    res.json({ ok: true, checkins: m.checkins })
  } catch (e) { res.status(500).json({ error: e.message }) }
})
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
  const tpl = (kind === 'offboarding' ? OFFBOARDING : ONBOARDING).filter(t => (!t.w2_only || m.employment !== 'contractor') && (!t.tech_only || (m.track || 'tech') !== 'ops'))
  m.checklist = { kind, started_at: new Date().toISOString(), started_by: by, items: tpl.map(({ w2_only, tech_only, ...t }) => ({ ...t, label: kind === 'onboarding' ? fillLabel(t, m) : t.label, due: kind === 'onboarding' ? dueFor(t, m) : undefined, done: false, at: '', by: '', due_date: kind === 'onboarding' && m.hire_date && Number.isFinite(dueFor(t, m)) ? addDays(m.hire_date, dueFor(t, m)) : '' })) }
  return m
}
/** Re-stamp due dates when the start date changes. */
export function restampChecklist(m) {
  if (!m.checklist || m.checklist.kind !== 'onboarding' || !m.hire_date) return m
  for (const it of m.checklist.items) { const t = ONBOARDING.find(x => x.key === it.key); if (!t) continue; it.label = fillLabel(t, m); if (Number.isFinite(dueFor(t, m))) it.due_date = addDays(m.hire_date, dueFor(t, m)) }
  // Items added to the template after this checklist started (2026-09-22) join it in place.
  const have = new Set(m.checklist.items.map(i => i.key))
  for (const t of ONBOARDING) {
    if (have.has(t.key)) continue
    if ((t.w2_only && m.employment === 'contractor') || (t.tech_only && (m.track || 'tech') === 'ops')) continue
    const { w2_only, tech_only, ...rest } = t
    m.checklist.items.push({ ...rest, label: fillLabel(t, m), due: dueFor(t, m), done: false, at: '', by: '', due_date: Number.isFinite(dueFor(t, m)) ? addDays(m.hire_date, dueFor(t, m)) : '' })
  }
  m.checklist.items.sort((a, b) => (Number.isFinite(a.due) ? a.due : 99) - (Number.isFinite(b.due) ? b.due : 99))
  seedKit(m)
  if (!m.checklist.items.every(x => x.done)) m.checklist.completed_at = ''
  return m
}
// Per-role equipment kits (Mark 2026-09-22: automate our side). Landed on
// the record at Hired with no issue date; 'gear' ticks when every line has one.
// Handbook chapter 14, "Van Equipment Checklist" (Mark 2026-09-22: "you
// have an inventory list already"). Same list the tech verifies every
// morning — so the handover inventory IS the daily checklist.
const KIT_TECH = [
  ['Van', 'Van + keys'], ['Van', 'Fuel card'],
  ['Diagnostic', 'Autel MaxiSYS ADAS MA600 tablet'], ['Diagnostic', 'Autel VCI (MaxiVCI V150)'], ['Diagnostic', 'Cardaq 3/4 + case'], ['Diagnostic', 'OEM-specific VCI dongles'], ['Diagnostic', 'Laptop (ISTA / WiTech / HDS / FDRS / Xentry)'], ['Diagnostic', 'OBD2 extension cables (1 m + 3 m)'], ['Diagnostic', 'USB-C / USB-A charger cables'], ['Diagnostic', 'Mobile hotspot / SIM'],
  ['Targets', 'Full Autel ADAS target set — every panel'], ['Targets', 'Target stands — legs + locking pins'], ['Targets', 'Laser alignment tool / line laser'], ['Targets', 'Metric tape measure (5 m+)'], ['Targets', 'Plumb bob / magnetic level'], ['Targets', 'Chalk / floor marking tape'],
  ['Tools', 'Tire pressure gauge (digital)'], ['Tools', 'Tread depth gauge'], ['Tools', 'Air compressor adapter / portable inflator'], ['Tools', 'Microfiber towels'], ['Tools', 'Flashlight / work light'], ['Tools', 'Extension cord (25 ft+)'], ['Tools', 'Basic hand tools (screwdrivers, trim pry tools)'],
  ['Safety', 'First aid kit'], ['Safety', 'PPE kit — safety glasses, nitrile gloves, HV-rated insulated gloves'],
  ['Uniform', 'Khaki pants ×6'], ['Uniform', 'Embroidered polos ×6'], ['Uniform', 'Hat'],
  ['Cards', 'Fuel card (WEX / fleet) — last 4 in the serial box'], ['Cards', 'Remote Expert payment — Autel balance or merchant-locked virtual card'],
]
const KITS = {
  tech: KIT_TECH,
  apprentice: KIT_TECH.filter(([g]) => ['Tools', 'Safety', 'Uniform'].includes(g)),
  ops: [['Office', 'Laptop / logins to Zoho Books + Cliq'], ['Office', 'Headset'], ['Office', 'Company phone (optional)']],
}
// Mark 2026-09-22: "the van is assigned the tools, the technician is
// assigned the van." Personal kit (uniform, PPE, office gear) lives on the
// person; everything with wheels or a serial lives on the VAN record —
// AppConfig `vans` — and outlives whoever is driving it this year.
const PERSONAL_GROUPS = new Set(['Uniform', 'Safety', 'Office', 'Cards'])
export function seedKit(m) {
  const kit = (KITS[m.track || 'tech'] || KITS.tech).filter(([g]) => PERSONAL_GROUPS.has(g))
  if (!Array.isArray(m.equipment)) m.equipment = []
  const have = new Set(m.equipment.map(e => String(e.name || '').toLowerCase()))
  for (const [group, name] of kit) if (!have.has(name.toLowerCase())) m.equipment.push({ name, group, serial: '', issued: '', kit: true })
  for (const e of m.equipment) if (!e.group) { const t = KIT_TECH.find(([, n]) => n.toLowerCase() === String(e.name || '').toLowerCase()); e.group = t ? t[0] : 'Other' }
  // Old records carried van tools on the person — those move to the van when one is named.
  return m
}
export async function readVans(req) { const v = await cfgJson(req, 'vans', {}); return v && typeof v === 'object' ? v : {} }
export async function saveVans(req, vans) { return cfgWrite(req, 'vans', vans) }
const vanKey = name => String(name || '').trim().replace(/\s+/g, ' ')
/** The van record, seeded from handbook ch. 14 the first time its name is used. */
// Seeded from the fleet sheet (services/vanKit.js). A van that already
// exists picks up any template line it's missing — never loses one.
export async function ensureVan(req, name, by) {
  const key = vanKey(name); if (!key) return null
  const vans = await readVans(req)
  const line = t => ({ name: t.name, part: t.part || '', usage: t.usage || '', group: t.group, serial: '', added: todayPT(), added_by: 'fleet sheet' })
  let changed = false
  if (!vans[key]) { vans[key] = { name: key, created_at: new Date().toISOString(), created_by: by || '', current_tech: '', equipment: VAN_KIT.map(line), handovers: [] }; changed = true }
  else {
    const v = vans[key]; v.equipment = Array.isArray(v.equipment) ? v.equipment : []
    const have = new Set(v.equipment.map(e => `${String(e.part || '').toLowerCase()}|${String(e.name || '').toLowerCase()}`))
    for (const t of VAN_KIT) { const k = `${String(t.part || '').toLowerCase()}|${t.name.toLowerCase()}`; if (!have.has(k) && !v.equipment.some(e => e.name.toLowerCase() === t.name.toLowerCase() && (!t.part || !e.part))) { v.equipment.push(line(t)); changed = true } }
    if (changed) { const order = new Map(VAN_KIT.map((t, i) => [t.group, i])); v.equipment.sort((a, b) => (order.get(a.group) ?? 999) - (order.get(b.group) ?? 999)) }
  }
  if (changed) await saveVans(req, vans)
  return vans[key]
}
const VANS_FOLDER_NAME = 'Vans'
/** Command Center → HR → Team → Vans → <van>. Created on first use; id cached on the van record. */
export async function vanFolder(req, name) {
  const vans = await readVans(req); const key = vanKey(name); const v = vans[key]; if (!v) return null
  if (v.folder_id) return { folderId: v.folder_id, folderUrl: v.folder_url }
  const { getAccessToken } = await import('../services/zoho.js'); const { createFolderUnder, listChildren } = await import('../services/workdrive.js')
  const tok = await getAccessToken()
  let parent = await cfgJson(req, 'vans_folder', null)
  if (!parent?.folderId) {
    const kids = await listChildren(PEOPLE_FOLDER_ID, tok, { folders: true }).catch(() => [])
    const found = kids.find(k => k.name === VANS_FOLDER_NAME)
    parent = found ? { folderId: found.id } : await createFolderUnder(PEOPLE_FOLDER_ID, VANS_FOLDER_NAME, tok)
    await cfgWrite(req, 'vans_folder', parent)
  }
  const f = await createFolderUnder(parent.folderId, key, tok)
  v.folder_id = f.folderId; v.folder_url = f.folderUrl
  await saveVans(req, vans)
  return { folderId: f.folderId, folderUrl: f.folderUrl }
}
/** Owner edited the van — drop a fresh JSON snapshot next to the handovers (cheap, durable). */
export async function snapshotVan(req, name) {
  try { const vans = await readVans(req); const v = vans[vanKey(name)]; if (!v) return; const vf = await vanFolder(req, v.name); if (!vf) return; const { getAccessToken } = await import('../services/zoho.js'); const { uploadFileToFolder } = await import('../services/workdrive.js'); await uploadFileToFolder(vf.folderId, `${v.name} — inventory + history (latest).json`, Buffer.from(JSON.stringify(v, null, 2)), await getAccessToken(), 'application/json') } catch (e) { console.warn('[vans] snapshot failed:', e.message) }
}
export async function assignVan(req, m, by) {
  if (!m.van) return null
  const vans = await readVans(req); const key = vanKey(m.van)
  if (!vans[key]) { await ensureVan(req, key, by); return assignVan(req, m, by) }
  // van tools that were sitting on the person (pre-2026-09-22) move over once
  const stray = (m.equipment || []).filter(e => !PERSONAL_GROUPS.has(e.group || ''))
  if (stray.length) { const have = new Set(vans[key].equipment.map(e => e.name.toLowerCase())); for (const e of stray) if (!have.has(String(e.name).toLowerCase())) vans[key].equipment.push({ name: e.name, group: e.group || 'Other', serial: e.serial || '', added: e.issued || todayPT(), added_by: by || '' }); m.equipment = (m.equipment || []).filter(e => PERSONAL_GROUPS.has(e.group || '')) }
  vans[key].current_tech = m.name; vans[key].current_tech_id = m.id; vans[key].assigned_at = todayPT()
  await saveVans(req, vans)
  return vans[key]
}
// Things that should flip on their own once the pieces are in place. Run
// after every save that could complete a piece (portal steps, checklist ticks).
export async function autoAdvance(req, m) {
  if (!m.checklist || m.checklist.kind !== 'onboarding') return { changed: false }
  const done = k => !!m.checklist.items.find(x => x.key === k)?.done
  const has = k => !!m.checklist.items.find(x => x.key === k)
  let changed = false
  // gear: every kit line has an issue date
  if (has('gear') && !done('gear') && ((m.track || 'tech') !== 'ops' ? !!m.van_handover?.at : (Array.isArray(m.equipment) && m.equipment.length && m.equipment.every(e => e.issued)))) { tickChecklist(m, 'gear', 'auto'); changed = true }
  if (has('van_assigned') && !done('van_assigned') && m.van) { tickChecklist(m, 'van_assigned', 'auto'); changed = true }
  if (has('route') && !done('route') && m.route_zone) { tickChecklist(m, 'route', 'auto'); changed = true }
  return { changed }
}
export function addBusinessDays(iso, n) { let d = new Date(iso + 'T12:00:00Z'); let left = n; while (left > 0) { d.setUTCDate(d.getUTCDate() + 1); if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) left-- } return d.toISOString().slice(0, 10) }
export function i9Deadline(m) { return m.employment !== 'contractor' && m.hire_date ? addBusinessDays(m.hire_date, 3) : null }
/** Onboarding completion 0–100 from the record (mirrors the portal's progress bar). */
export function onboardingPct(m) {
  const docs = Array.isArray(m.documents) ? m.documents : []
  const has = k => docs.some(d => d.kind === k)
  const contractor = m.employment === 'contractor'
  const steps = [!!(m.emergency_contact?.name && m.personal_phone), !!m.photo_url, contractor ? (has('passport') || has('dl_front')) : (has('dl_front') && has('ssn')), !!(m.direct_deposit || m.payout), !!m.signatures?.handbook, !!(m.training && Object.values(m.training).length && Object.values(m.training).every(t => t.passed))]
  return Math.round((steps.filter(Boolean).length / steps.length) * 100)
}
// ── Onboarding board (Mark 2026-09-22): every hire in flight, one page ──
export function ourSide(m) {
  const items = m.checklist?.kind === 'onboarding' ? m.checklist.items : []
  const today = todayPT()
  const open = items.filter(i => !i.done)
  return { total: items.length, done: items.length - open.length, overdue: open.filter(i => i.due_date && i.due_date < today).map(i => i.key), due_today: open.filter(i => i.due_date === today).map(i => i.key), next: open.slice().sort((a, b) => String(a.due_date || '9').localeCompare(String(b.due_date || '9')))[0] || null }
}
router.get('/onboarding', async (req, res) => {
  try {
    if (!isOwner(req)) return res.status(403).json({ error: 'Owners only' })
    const members = await readTeamMembers(req)
    const today = todayPT()
    const list = members.filter(m => m.checklist?.kind === 'onboarding' && (!m.checklist.completed_at || m.checklist.completed_at.slice(0, 10) >= addDays(today, -14)))
      .map(m => ({ id: m.id, name: m.name, preferred_name: m.preferred_name || '', title: m.title, track: m.track || 'tech', employment: m.employment, hire_date: m.hire_date || '', photo_url: m.photo_url || '', days_to_start: m.hire_date ? Math.round((new Date(m.hire_date + 'T12:00:00') - new Date(today + 'T12:00:00')) / 86400000) : null, portal_pct: onboardingPct(m), ours: ourSide(m), invited_at: m.onboarding_invited_at || '', completed_at: m.checklist.completed_at || '', portal_done_at: m.onboarding_completed_at || '', access: m.access }))
      .sort((a, b) => String(a.hire_date || '9').localeCompare(String(b.hire_date || '9')))
    const welcome = await cfgJson(req, 'onboarding_welcome', WELCOME_DEFAULT)
    res.json({ ok: true, today, hires: list, welcome })
  } catch (e) { res.status(500).json({ error: e.message }) }
})
// What makes them pumped (phase 3): a video from Mark, the first-day plan.
const WELCOME_DEFAULT = { kinetic_email: 'parisa.sayadi@kinetic.auto', video_url: '', note: "Welcome to the crew. You're here because you do it right the first time — that's the whole job. First week you ride with me, then you're loose. GET SOME!!!", first_day: { where: 'Meet at the van — I\'ll text you the shop address the night before.', time: '7:45 AM', bring: "Driver's license, water, work boots, a good attitude. Shirts are in the van." } }
router.put('/onboarding/welcome', async (req, res) => {
  try {
    if (!isOwner(req)) return res.status(403).json({ error: 'Owners only' })
    const b = req.body || {}
    const w = { kinetic_email: String(b.kinetic_email || '').trim().slice(0, 120), video_url: String(b.video_url || '').slice(0, 300), note: String(b.note || '').slice(0, 1200), first_day: { where: String(b.first_day?.where || '').slice(0, 300), time: String(b.first_day?.time || '').slice(0, 40), bring: String(b.first_day?.bring || '').slice(0, 400) } }
    await cfgWrite(req, 'onboarding_welcome', w)
    res.json({ ok: true, welcome: w })
  } catch (e) { res.status(500).json({ error: e.message }) }
})
/** Everything the Launch view needs for one hire: our list with owners/dues, their steps, links, kit. */
router.get('/onboarding/:id/launch', async (req, res) => {
  try {
    if (!isOwner(req)) return res.status(403).json({ error: 'Owners only' })
    const { m, members } = await memberFor(req, req.params.id)
    if (!m) return res.status(404).json({ error: 'Not found' })
    if (m.checklist?.kind === 'onboarding' && m.hire_date) { const before = JSON.stringify([m.checklist, m.equipment]); restampChecklist(m); if (JSON.stringify([m.checklist, m.equipment]) !== before) await saveMember(req, m) }
    const docs = Array.isArray(m.documents) ? m.documents : []
    const has = k => docs.some(d => d.kind === k)
    const contractor = m.employment === 'contractor'
    const trainingDone = !!(m.training && Object.values(m.training).length && Object.values(m.training).every(t => t.passed))
    const theirs = [
      ['about', 'About you + emergency contact', !!(m.emergency_contact?.name && m.personal_phone)],
      ['photo', 'Profile photo', !!m.photo_url],
      ['docs', contractor ? 'Government ID' : "Driver's license + Social Security card", contractor ? (has('passport') || has('dl_front')) : (has('dl_front') && has('ssn'))],
      ...(contractor ? [] : [['w4', 'Form W-4', has('w4')]]),
      ...((m.track || 'tech') !== 'ops' ? [['mvr', 'Driving record', has('mvr')]] : []),
      ['deposit', contractor ? 'Payout (Wise)' : 'Direct deposit', !!(m.direct_deposit || m.payout)],
      ['sign', 'Handbook signed', !!m.signatures?.handbook],
      ['contract', 'Offer / contract signed', !!m.signatures?.contract],
      ['training', 'Training passed', trainingDone],
      ...((m.track || 'tech') !== 'ops' ? [['van', 'Van handover signed (photos, video, mileage, tread)', !!m.van_handover?.at]] : []),
    ].map(([key, label, done]) => ({ key, label, done }))
    const w = await cfgJson(req, 'onboarding_welcome', WELCOME_DEFAULT)
    const { ZONES } = await import('../services/pipeline.js')
    let route = null
    if (m.route_zone) { try { const { getAllShops } = await import('./shops.js'); const shops = (await getAllShops(req)).filter(x => x.region === m.route_zone); route = { service: shops.filter(x => ['active', 'active2'].includes(x.stage || x.pipeline_stage)).map(x => x.shop_name), grow: shops.filter(x => !['active', 'active2', 'lost', 'denied'].includes(x.stage || x.pipeline_stage)).map(x => x.shop_name).slice(0, 25) } } catch (e) { route = { error: e.message } } }
    const van = m.van ? (await ensureVan(req, m.van, req.user?.name)) : null
    const { VAN_GROUPS } = await import('../services/vanKit.js')
    res.json({ ok: true, zones: ZONES.map(z => ({ id: z.id, label: z.label, day: z.day })), route, van: van ? { name: van.name, equipment: van.equipment, current_tech: van.current_tech, handovers: (van.handovers || []).slice(-5) } : null, van_groups: VAN_GROUPS, member: { id: m.id, name: m.name, preferred_name: m.preferred_name || '', title: m.title, track: m.track || 'tech', employment: m.employment, hire_date: m.hire_date || '', photo_url: m.photo_url || '', phone: m.phone || m.personal_phone || '', email: m.personal_email || m.email || '', work_email: emailFor(m), access: m.access, boss: members.find(x => x.user_id === m.reports_to)?.name || '', experience_level: m.experience_level || 'green', van: m.van || '', scan_tool: m.scan_tool || '', region: m.region || '', route_zone: m.route_zone || '', route_notes: m.route_notes || '', pants_waist: m.pants_waist || '', pants_inseam: m.pants_inseam || '', shirt_size: m.shirt_size || '', kinetic_requested_at: m.kinetic_requested_at || '', van_handover: m.van_handover || null },
      kinetic_email: w.kinetic_email || '',
      ours: (m.checklist?.kind === 'onboarding' ? m.checklist.items : []).map(i => ({ ...i, owner: i.owner || ONBOARDING.find(t => t.key === i.key)?.owner || 'mark' })), theirs, portal_pct: onboardingPct(m), equipment: m.equipment || [],
      link: { invited_at: m.onboarding_invited_at || '', revoked_at: m.onboarding_revoked_at || '', completed_at: m.onboarding_completed_at || '' }, today: todayPT() })
  } catch (e) { res.status(500).json({ error: e.message }) }
})
// Setup from the Launch view: the few facts that change the plan.
router.post('/onboarding/:id/setup', async (req, res) => {
  try {
    if (!isOwner(req)) return res.status(403).json({ error: 'Owners only' })
    const { m } = await memberFor(req, req.params.id)
    if (!m) return res.status(404).json({ error: 'Not found' })
    const b = req.body || {}
    if (b.experience_level !== undefined) m.experience_level = b.experience_level === 'certified' ? 'certified' : 'green'
    for (const k of ['van', 'scan_tool', 'route_notes']) if (b[k] !== undefined) m[k] = String(b[k]).slice(0, k === 'route_notes' ? 600 : 80)
    if (b.route_zone !== undefined) { const { ZONE_BY_ID } = await import('../services/pipeline.js'); const z = ZONE_BY_ID[String(b.route_zone)]; m.route_zone = z ? z.id : ''; if (z) m.region = z.label }
    if (m.van) await assignVan(req, m, req.user?.name)
    if (b.hire_date !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(String(b.hire_date))) m.hire_date = b.hire_date
    if (b.email !== undefined) { const e = String(b.email).trim().toLowerCase().slice(0, 120); if (e && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) { m.email = e; if (!m.user_id || !m.user_id.includes('@')) m.user_id = e } }
    restampChecklist(m)
    await autoAdvance(req, m)
    await saveMember(req, m)
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})
// One tap: ask Kinetic to add the new tech to our account.
router.post('/onboarding/:id/kinetic-email', async (req, res) => {
  try {
    if (!isOwner(req)) return res.status(403).json({ error: 'Owners only' })
    const { m } = await memberFor(req, req.params.id)
    if (!m) return res.status(404).json({ error: 'Not found' })
    const w = await cfgJson(req, 'onboarding_welcome', WELCOME_DEFAULT)
    const to = String(req.body?.to || w.kinetic_email || WELCOME_DEFAULT.kinetic_email || '').trim()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return res.status(400).json({ error: 'Set the Kinetic support email first (🚀 Onboarding → Welcome video + first day).' })
    const email = emailFor(m)
    const { getMailAccessToken, getMailAccountId, sendMail } = await import('../services/mail.js')
    const t = await getMailAccessToken()
    const body = `<p>Hi Kinetic team,</p><p>Please add a new technician to the Absolute ADAS account so they can look up calibration requirements:</p><ul><li><b>Name:</b> ${m.name}</li><li><b>Email:</b> ${email}</li><li><b>Role:</b> ${m.title || 'ADAS Calibration Technician'}</li><li><b>Start date:</b> ${m.hire_date || 'TBD'}</li></ul><p>Same permissions as our other technicians. Thanks!</p><p>Mark Fowler<br>Absolute ADAS · mark@absoluteadas.com</p>`
    await sendMail(t, await getMailAccountId(t), { to, cc: 'mark@absoluteadas.com', subject: `New technician for the Absolute ADAS account — ${m.name}`, body })
    tickChecklist(m, 'kinetic', req.user?.name || 'app')
    m.kinetic_requested_at = new Date().toISOString()
    await saveMember(req, m)
    console.log(`[people] Kinetic add-user email sent for ${m.name} → ${to}`)
    res.json({ ok: true, to })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── Vans: the tools live here (owners edit any time, even after a handover) ──
router.get('/vans', async (req, res) => { try { if (!isOwner(req)) return res.status(403).json({ error: 'Owners only' }); res.json({ ok: true, vans: Object.values(await readVans(req)) }) } catch (e) { res.status(500).json({ error: e.message }) } })
router.post('/vans/:name/equipment', async (req, res) => {
  try {
    if (!isOwner(req)) return res.status(403).json({ error: 'Owners only' })
    const van = await ensureVan(req, req.params.name, req.user?.name)
    if (!van) return res.status(400).json({ error: 'Van name required' })
    const vans = await readVans(req); const v = vans[van.name]; const b = req.body || {}
    if (b.action === 'remove') { const i = Number(b.index); if (v.equipment[i]) v.equipment.splice(i, 1) }
    else if (b.action === 'edit') { const i = Number(b.index); if (v.equipment[i]) v.equipment[i] = { ...v.equipment[i], serial: String(b.serial ?? v.equipment[i].serial ?? '').slice(0, 80), name: String(b.name || v.equipment[i].name).slice(0, 100), group: String(b.group || v.equipment[i].group).slice(0, 30) } }
    else { const name = String(b.name || '').trim().slice(0, 100); if (!name) return res.status(400).json({ error: 'Name required' }); v.equipment.push({ name, part: String(b.part || '').slice(0, 40), usage: String(b.usage || '').slice(0, 80), group: String(b.group || 'Other').slice(0, 40), serial: String(b.serial || '').slice(0, 80), added: todayPT(), added_by: req.user?.name || '' }) }
    await saveVans(req, vans)
    snapshotVan(req, v.name).catch(() => {})
    res.json({ ok: true, van: v })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// Mark issues a kit line (date + serial) from the Launch view.
router.post('/onboarding/:id/equipment', async (req, res) => {
  try {
    if (!isOwner(req)) return res.status(403).json({ error: 'Owners only' })
    const { m } = await memberFor(req, req.params.id)
    if (!m) return res.status(404).json({ error: 'Not found' })
    const idx = Number(req.body?.index)
    if (!Array.isArray(m.equipment) || !m.equipment[idx]) return res.status(400).json({ error: 'No such line' })
    m.equipment[idx] = { ...m.equipment[idx], issued: req.body?.issued === '' ? '' : (req.body?.issued || todayPT()), serial: String(req.body?.serial ?? m.equipment[idx].serial ?? '').slice(0, 80) }
    await autoAdvance(req, m)
    await saveMember(req, m)
    res.json({ ok: true, equipment: m.equipment, checklist: m.checklist })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

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
    await autoAdvance(req, m)
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
      // Check-ins on a clock (D, 2026-09-21): 30 / 60 / 90 days from the hire
      // date, then an annual review on the anniversary. Owners only.
      if (owner && m.hire_date && m.employment !== 'owner') {
        for (const [n, label] of [[30, '30-day check-in'], [60, '60-day check-in'], [90, '90-day review']]) {
          const d = addDays(m.hire_date, n); if ((m.checkins || {})[`d${n}`]) continue
          ev.push({ date: d, type: 'checkin', title: `🗓 ${who} — ${label}`, user_id: m.user_id, member_id: m.id, checkin: `d${n}`, log_type: n === 90 ? 'review' : '1on1' })
        }
        for (let y = y0; y <= y1; y++) if (m.hire_date.slice(0, 4) < String(y) && !(m.checkins || {})[`y${y}`]) ev.push({ date: `${y}-${m.hire_date.slice(5)}`, type: 'checkin', title: `⭐ ${who} — annual review`, user_id: m.user_id, member_id: m.id, checkin: `y${y}`, log_type: 'review' })
      }
      if (owner && m.hire_date >= from && m.checklist?.kind === 'onboarding' && !m.checklist.completed_at) { ev.push({ date: m.hire_date, type: 'checkin', title: `🚀 ${who} — first day${(m.track || 'tech') === 'ops' ? ' (shadows Kat)' : ' (ride-along week starts)'}`, user_id: m.user_id }) }
      // Driving record: re-check yearly (techs drive customers' cars).
      if (owner && m.mvr_checked_at && (m.track || 'tech') !== 'ops') ev.push({ date: addDays(m.mvr_checked_at, 365), type: 'expiry', title: `🚗 ${who}: driving record re-check due`, user_id: m.user_id })
      const i9 = i9Deadline(m); const i9Item = m.checklist?.items?.find(x => x.key === 'i9')
      if (i9 && i9Item && !i9Item.done && owner) ev.push({ date: i9, type: 'checkin', title: `🪪 ${who} — Form I-9 due (3 business days from start)`, user_id: m.user_id })
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
router.get('/course', async (req, res) => { try { const c = await readCourse(req); const owner = isOwner(req); const me = await findMemberByIdentity(req, req.user?.email, req.user?.name); res.json({ ok: true, editable: owner, course: owner ? c : { ...c, modules: c.modules.map(m => ({ ...m, script: undefined, quiz: (m.quiz || []).map(q => ({ id: q.id, q: q.q, options: q.options })) })) }, my_progress: me?.training || {}, my_id: me?.id || null }) } catch (e) { res.status(500).json({ error: e.message }) } })
router.put('/course', async (req, res) => {
  try {
    if (!isOwner(req)) return res.status(403).json({ error: 'Owners only' })
    const b = req.body || {}
    const modules = (Array.isArray(b.modules) ? b.modules : []).map((m, i) => ({ id: String(m.id || `m${i + 1}`).replace(/[^a-z0-9_-]/gi, '').slice(0, 40) || `m${i + 1}`, tracks: (Array.isArray(m.tracks) && m.tracks.length ? m.tracks : ['core']).filter(t => ['core', 'tech', 'apprentice', 'ops'].includes(t)), title: String(m.title || '').slice(0, 120), minutes: Number(m.minutes) || 5, video_url: String(m.video_url || '').slice(0, 500), script: String(m.script || '').slice(0, 4000), reading: String(m.reading || '').slice(0, 6000),
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
export async function onboardingLink(req, m, mode = 'full') {
  const { makeOnboardToken } = await import('./onboardPublic.js')
  const base = process.env.WEB_BASE_URL || `${req.protocol}://${req.get('host')}/app`
  return `${base}/?onboard=${encodeURIComponent(m.id)}&t=${encodeURIComponent(makeOnboardToken(m, mode))}`
}
/** Kill every link sent so far for this person; the next invite mints a fresh one. */
export function revokeOnboardingLinks(m) { m.onboarding_token_v = (Number(m.onboarding_token_v) || 0) + 1; return m }
export async function sendOnboardingInvite(req, m, by, mode = 'full') {
  revokeOnboardingLinks(m)
  const link = await onboardingLink(req, m, mode)
  const to = { sms: m.personal_phone || m.phone || '', email: m.personal_email || m.email || '' }
  const out = { link, sms: null, email: null }
  const first = m.preferred_name || firstName(m.name)
  if (to.sms) {
    try { const { sendTwilioSMS } = await import('../services/twilio.js'); const body = mode === 'catchup'
      ? `Hi ${first}, Mark here — quick HR catch-up on your phone (about 5 minutes): a profile photo, your emergency contact, and signing the handbook. ${link}  — Mark`
      : `Hi ${first}, welcome to Absolute ADAS! Here's your onboarding link — takes about 20 minutes on your phone (photo, ID, direct deposit, a short training). ${link}  — Mark`
      const r = await sendTwilioSMS({ to: to.sms, body }); out.sms = r?.ok ? { ok: true, to: to.sms } : { ok: false, error: r?.error || 'failed' } } catch (e) { out.sms = { ok: false, error: e.message } }
  }
  if (to.email) {
    try {
      const { getMailAccessToken, getMailAccountId, sendMail } = await import('../services/mail.js')
      const token = await getMailAccessToken(); const accountId = await getMailAccountId(token)
      const html = mode === 'catchup'
        ? `<div style="font-family:-apple-system,Helvetica,Arial,sans-serif;max-width:560px;color:#1a1a1a"><div style="background:#CD4419;color:white;padding:14px 18px;border-radius:10px 10px 0 0;font-weight:700">Absolute ADAS · HR catch-up</div><div style="border:1px solid #e8e4e0;border-top:none;padding:18px;border-radius:0 0 10px 10px"><p>Hi ${first},</p><p>Quick one, about 5 minutes on your phone: a profile photo for the Directory, your emergency contact, and a signature on the handbook so your file is complete.</p><p style="text-align:center;margin:20px 0"><a href="${link}" style="background:#15803d;color:white;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:700">Finish my file</a></p><p>GET SOME!!!<br>— Mark</p></div></div>`
        : `<div style="font-family:-apple-system,Helvetica,Arial,sans-serif;max-width:560px;color:#1a1a1a"><div style="background:#CD4419;color:white;padding:14px 18px;border-radius:10px 10px 0 0;font-weight:700">Absolute ADAS · Welcome aboard</div><div style="border:1px solid #e8e4e0;border-top:none;padding:18px;border-radius:0 0 10px 10px"><p>Hi ${first},</p><p>Welcome to Absolute ADAS. Your onboarding is done on your phone and takes about 20 minutes: a profile photo, a photo of your driver's license and Social Security card, direct deposit, the handbook, and a short training with a few questions.</p><p style="text-align:center;margin:20px 0"><a href="${link}" style="background:#15803d;color:white;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:700">Start my onboarding</a></p><p style="color:#666;font-size:12px">The link is good for 45 days and is just for you. Questions — call Mark.</p><p>GET SOME!!!<br>— Mark</p></div></div>`
      await sendMail(token, accountId, { to: to.email, subject: mode === 'catchup' ? 'Quick HR catch-up — 5 minutes' : 'Welcome to Absolute ADAS — your onboarding link', body: html }); out.email = { ok: true, to: to.email }
    } catch (e) { out.email = { ok: false, error: e.message } }
  }
  if (mode !== 'catchup') {
    if (!m.checklist) startChecklist(m, 'onboarding', by || 'app')
    tickChecklist(m, 'invite', by || 'app')
    m.onboarding_invited_at = new Date().toISOString()
  } else m.catchup_invited_at = new Date().toISOString()
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
    const out = await sendOnboardingInvite(req, m, req.user?.name, req.body?.mode === 'catchup' ? 'catchup' : 'full')
    res.json({ ok: true, ...out })
  } catch (e) { console.error('[people invite]', e.message); res.status(500).json({ error: e.message }) }
})
// Kill every link out there for this person (lost phone, forwarded text).
router.post('/onboarding/:id/revoke', async (req, res) => {
  try {
    if (!isOwner(req)) return res.status(403).json({ error: 'Owners only' })
    const { m } = await memberFor(req, req.params.id)
    if (!m) return res.status(404).json({ error: 'Not found' })
    revokeOnboardingLinks(m); m.onboarding_revoked_at = new Date().toISOString()
    await saveMember(req, m)
    console.log(`[people] onboarding links revoked for ${m.name} by ${req.user?.name}`)
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
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
  const lines = [], katLines = []
  const mmdd = today.slice(5), tomorrow = addDays(today, 1).slice(5)
  for (const m of members) {
    const who = m.preferred_name || firstName(m.name)
    if (m.birthday === mmdd) lines.push(`🎂 ${who}'s birthday is TODAY`)
    else if (m.birthday === tomorrow) lines.push(`🎂 ${who}'s birthday is tomorrow`)
    if (m.hire_date && m.hire_date.slice(5) === mmdd && m.hire_date < today) lines.push(`🏅 ${who} — ${Number(today.slice(0, 4)) - Number(m.hire_date.slice(0, 4))} year(s) with Absolute ADAS today`)
    for (const c of Array.isArray(m.certifications) ? m.certifications : []) if (c?.expires && c.expires >= today && c.expires <= addDays(today, 30)) lines.push(`📄 ${who}: ${c.name} expires ${c.expires}`)
    if (m.license_expiry && m.license_expiry >= today && m.license_expiry <= addDays(today, 30)) lines.push(`🪪 ${who}: driver's license expires ${m.license_expiry}`)
    if (m.hire_date && m.employment !== 'owner') for (const [n, label, key] of [[30, '30-day check-in', 'd30'], [60, '60-day check-in', 'd60'], [90, '90-day review', 'd90']]) {
      const d = addDays(m.hire_date, n); if ((m.checkins || {})[key]) continue
      if (d === today) lines.push(`🗓 ${who}: ${label} is TODAY — Directory → ${who} → log it`); else if (d === addDays(today, 1)) lines.push(`🗓 ${who}: ${label} tomorrow`); else if (d < today && d >= addDays(today, -14)) lines.push(`🗓 ${who}: ${label} was ${d} — not logged yet`)
    }
    if (m.hire_date && m.hire_date.slice(5) === mmdd && m.hire_date < today && !(m.checkins || {})[`y${today.slice(0, 4)}`]) lines.push(`⭐ ${who}: annual review is due — log it under Reviews`)
    if ((m.track || 'tech') !== 'ops' && m.employment !== 'owner') {
      if (m.mvr_checked_at) { const due = addDays(m.mvr_checked_at, 365); if (due >= today && due <= addDays(today, 30)) lines.push(`🚗 ${who}: driving record re-check due ${due}`) }
      else if (m.checklist?.kind === 'onboarding' && m.checklist.started_at.slice(0, 10) <= addDays(today, -7)) lines.push(`🚗 ${who}: no driving record on file yet (techs drive customers' cars)`)
    }
    if (m.checklist && !m.checklist.completed_at) { const open = m.checklist.items.filter(i => !i.done).length; if (open && m.checklist.started_at.slice(0, 10) <= addDays(today, -7)) lines.push(`📋 ${who}: ${m.checklist.kind} still has ${open} open item(s) after a week`) }
    // Owned items with a clock (2026-09-22): the owner hears about it the day it's due and every day it's late.
    if (m.checklist?.kind === 'onboarding' && !m.checklist.completed_at) {
      for (const it of m.checklist.items) {
        if (it.done || !it.due_date || it.due_date > today) continue
        const owner = it.owner || ONBOARDING.find(t => t.key === it.key)?.owner || 'mark'
        if (owner === 'auto') continue
        const late = it.due_date < today ? ` — was due ${it.due_date}` : ' — due TODAY'
        const line = `☑️ ${who}: ${it.label.split(' — ')[0]}${late} (Directory → Onboarding)`
        if (owner === 'kat') katLines.push(line); else lines.push(line)
      }
    }
    // Day one, 7am: the hire gets where / when / who from us — once.
    if (m.hire_date === today && !m.day1_texted_at && m.employment !== 'owner') {
      try {
        const w = await cfgJson(req, 'onboarding_welcome', WELCOME_DEFAULT)
        const first = m.preferred_name || firstName(m.name)
        const boss = members.find(x => x.user_id === m.reports_to)
        const to = m.personal_phone || m.phone
        if (to) { const { sendTwilioSMS } = await import('../services/twilio.js'); await sendTwilioSMS({ to, body: `Morning ${first} — it's day one! ${w.first_day?.time ? `${w.first_day.time}. ` : ''}${w.first_day?.where || ''}${boss ? ` You're with ${boss.name}${boss.phone ? ` (${boss.phone})` : ''}.` : ''} ${w.first_day?.bring ? `Bring: ${w.first_day.bring}` : ''} GET SOME!!! — Mark` }) }
        m.day1_texted_at = new Date().toISOString(); await saveMember(req, m)
        lines.push(`🚀 ${who} starts TODAY — day-one text sent`)
      } catch (e) { console.warn('[people] day-one text failed:', e.message) }
    }
    const i9 = i9Deadline(m); const i9Item = m.checklist?.items?.find(x => x.key === 'i9')
    if (i9 && i9Item && !i9Item.done && m.checklist?.kind === 'onboarding') { if (i9 === today) lines.push(`🪪 ${who}: Form I-9 is due TODAY (Zoho Payroll) — tick it on the checklist when done`); else if (i9 < today) lines.push(`🚨 ${who}: Form I-9 is OVERDUE (was due ${i9}) — complete it in Zoho Payroll now`); else if (i9 === addDays(today, 1)) lines.push(`🪪 ${who}: Form I-9 due tomorrow`) }
    // Nudge the hire themselves on day 2 and day 5 after the invite if they haven't finished (Mark 2026-09-17).
    if (m.onboarding_invited_at && m.checklist?.kind === 'onboarding' && !m.checklist.completed_at) {
      const pct = onboardingPct(m); const sent = m.onboarding_invited_at.slice(0, 10)
      for (const [day, key] of [[2, 'd2'], [5, 'd5']]) {
        if (pct < 100 && today >= addDays(sent, day) && !(m.onboarding_nudged || {})[key]) {
          try {
            const link = await onboardingLink(req, m); const first = m.preferred_name || firstName(m.name)
            const msg = pct === 0 ? `Hi ${first}, it's Mark at Absolute ADAS — your onboarding link is waiting. About 20 minutes on your phone: ${link}` : `Hi ${first}, Mark here — you're ${pct}% through onboarding. A few minutes finishes it: ${link}`
            let ok = false
            if (m.personal_phone || m.phone) { try { const { sendTwilioSMS } = await import('../services/twilio.js'); const r = await sendTwilioSMS({ to: m.personal_phone || m.phone, body: msg }); ok = !!r?.ok } catch {} }
            if (m.personal_email || m.email) { try { const { getMailAccessToken, getMailAccountId, sendMail } = await import('../services/mail.js'); const t = await getMailAccessToken(); await sendMail(t, await getMailAccountId(t), { to: m.personal_email || m.email, subject: pct === 0 ? 'Your Absolute ADAS onboarding link' : `You're ${pct}% through onboarding`, body: `<p>${msg.replace(link, `<a href="${link}">${link}</a>`)}</p><p>GET SOME!!!<br>— Mark</p>` }); ok = true } catch {} }
            m.onboarding_nudged = { ...(m.onboarding_nudged || {}), [key]: new Date().toISOString() }; await saveMember(req, m)
            lines.push(`📨 ${who}: day-${day} onboarding reminder ${ok ? 'sent' : 'attempted'} (${pct}% done)`)
          } catch (e) { console.warn('[people] hire nudge failed:', e.message) }
        }
      }
    }
  }
  if (new Date(today + 'T12:00:00Z').getUTCDay() === 1) {
    for (const m of members) if (m.access !== 'none') { const acks = await policyAcksFor(req, m.user_id); if (!Object.keys(acks).length) lines.push(`📝 ${m.preferred_name || firstName(m.name)} hasn't acknowledged the HR policy yet`) }
  }
  await cfgWrite(req, stamp, new Date().toISOString())
  const { postToCliqChannelById, postToCliqChannel, MARK_ALERT_CHANNEL_ID, DISPATCH_CHANNEL } = await import('../services/cliq.js')
  if (katLines.length) {
    // Kat's onboarding items land in her working channel + her bell.
    await postToCliqChannel(DISPATCH_CHANNEL, `👥 *Kat — onboarding today*\n${katLines.join('\n')}`).catch(e => console.warn('[people] kat nudge failed:', e.message))
    try { const { createNotification } = await import('./notifications.js'); await createNotification(req, { to: 'Kath', toEmail: 'k.belmonte@absoluteadas.com', type: 'onboarding', title: 'Onboarding items due', body: katLines.map(l => l.replace(/ \(Directory.*\)$/, '')).join(' · '), skipCliq: true, skipTechChannel: true }) } catch { /* fine */ }
  }
  if (!lines.length) return { fired: true, sent: katLines.length }
  await postToCliqChannelById(MARK_ALERT_CHANNEL_ID, `👥 *People today*\n${lines.join('\n')}`)
  return { fired: true, sent: lines.length + katLines.length }
}

// Recruiting → Hired: create the directory entry + start onboarding
// G (2026-09-21): the moment onboarding hits 100%, the person hears it
// from us — text + email with the first-day plan — and Mark gets a ping.
// Once, ever (onboarding_completed_at).
export async function maybeWelcome(req, m) {
  if (m.onboarding_completed_at || onboardingPct(m) < 100) return { sent: false }
  m.onboarding_completed_at = new Date().toISOString()
  await saveMember(req, m)
  const first = m.preferred_name || firstName(m.name)
  const members = await readTeamMembers(req)
  const boss = members.find(x => x.user_id === m.reports_to)
  const start = m.hire_date ? new Date(m.hire_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) : 'your start date'
  const plan = (m.track || 'tech') === 'ops'
    ? `Day one: Kat walks you through dispatch and Zoho Books, then you shadow a full day of invoicing.`
    : `Day one: ride-along with ${boss?.name || 'Mark'}. Bring your license, wear the shirt, be at the van at 7:45.`
  const sms = `${first}, you're all set — onboarding is 100% done. 🎉 ${plan} See you ${start}. Questions: call Mark. GET SOME!!! — Mark`
  const out = { sms: null, email: null }
  const to = { sms: m.personal_phone || m.phone || '', email: m.personal_email || m.email || '' }
  if (to.sms) { try { const { sendTwilioSMS } = await import('../services/twilio.js'); const r = await sendTwilioSMS({ to: to.sms, body: sms }); out.sms = !!r?.ok } catch (e) { out.sms = false } }
  if (to.email) {
    try {
      const { getMailAccessToken, getMailAccountId, sendMail } = await import('../services/mail.js')
      const t = await getMailAccessToken()
      await sendMail(t, await getMailAccountId(t), { to: to.email, subject: `Welcome aboard, ${first} — you're all set`, body: `<div style="font-family:-apple-system,Helvetica,Arial,sans-serif;max-width:560px;color:#1a1a1a"><div style="background:#15803d;color:white;padding:14px 18px;border-radius:10px 10px 0 0;font-weight:700">Absolute ADAS · Welcome aboard</div><div style="border:1px solid #e8e4e0;border-top:none;padding:18px;border-radius:0 0 10px 10px"><p>Hi ${first},</p><p>Your onboarding is 100% done — photo, paperwork, handbook, training. Nice work.</p><p><b>${plan}</b></p><p>Start: ${start}.${boss ? ` You report to ${boss.name}${boss.phone ? ` (${boss.phone})` : ''}.` : ''}</p><p>Anything at all — call Mark.</p><p>GET SOME!!!<br>— Mark</p></div></div>` })
      out.email = true
    } catch (e) { out.email = false }
  }
  // The crew meets them before day one (Mark 2026-09-22: "make the new employee feel wanted").
  try { const { postToCliqChannel, DISPATCH_CHANNEL } = await import('../services/cliq.js'); const base = process.env.WEB_BASE_URL ? process.env.WEB_BASE_URL.replace(/\/app$/, '') : ''; await postToCliqChannel(DISPATCH_CHANNEL, `👋 *Say hi to ${first} — ${m.title}${m.region ? ', ' + m.region : ''}.* Starts ${start}. Onboarding done, ${(m.track || 'tech') === 'ops' ? 'shadowing Kat' : 'riding with ' + (boss?.name || 'Mark')} week one.${m.photo_url && base ? ` Photo: ${base}${m.photo_url}` : ''} Drop a welcome in here — they'll see it day one. GET SOME!!!`) } catch { /* fine */ }
  try { const { postToCliqChannelById, MARK_ALERT_CHANNEL_ID } = await import('../services/cliq.js'); await postToCliqChannelById(MARK_ALERT_CHANNEL_ID, `🎉 *${m.name} finished onboarding — 100%.* Welcome text ${out.sms ? 'sent' : 'not sent'}, email ${out.email ? 'sent' : 'not sent'}. Left for you: ${(m.checklist?.items || []).filter(i => !i.done).map(i => i.label.split(' — ')[0]).join(' · ') || 'nothing'}.`) } catch {}
  console.log(`[people] welcome sent to ${m.name}: sms=${out.sms} email=${out.email}`)
  return { sent: true, ...out }
}

// C (2026-09-21): live status for the Directory — who's on the clock,
// who's off today — plus the owner-only emergency card.
router.get('/status', async (req, res) => {
  try {
    const members = (await readTeamMembers(req)).filter(m => m.active !== false)
    const today = todayPT()
    const out = {}
    try {
      const { readEntriesPublic } = await import('./timeclock.js')
      const entries = await readEntriesPublic(req)
      for (const e of entries) if (e.clock_in && !e.clock_out) { const m = members.find(x => x.user_id === e.user_id || x.name.toLowerCase() === String(e.user_name || '').toLowerCase()); if (m) out[m.id] = { state: 'in', since: e.clock_in, on_break: !!e.break_start && !e.break_end } }
    } catch { /* clock unavailable */ }
    try {
      const { getRequestsDurable } = await import('./pto.js')
      for (const r of (await getRequestsDurable(req)) || []) if (String(r.status) === 'approved' && String(r.start_date) <= today && String(r.end_date) >= today) { const m = members.find(x => x.user_id === r.user_id); if (m && !out[m.id]) out[m.id] = { state: 'off', kind: r.type } }
    } catch { /* pto unavailable */ }
    res.json({ ok: true, today, status: out })
  } catch (e) { res.status(500).json({ error: e.message }) }
})
router.get('/emergency', async (req, res) => {
  try {
    if (!isOwner(req)) return res.status(403).json({ error: 'Owners only' })
    const members = (await readTeamMembers(req)).filter(m => m.active !== false)
    res.json({ ok: true, people: members.map(m => ({ id: m.id, name: m.name, phone: m.phone || m.personal_phone || '', personal_phone: m.personal_phone || '', van: m.van || '', region: m.region || '', emergency_contact: m.emergency_contact || null, license_expiry: m.license_expiry || '', blood_notes: m.medical_notes || '' })) })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

export async function onCandidateHired(req, cand) {
  const members = await readTeamMembers(req)
  const email = String(cand.email || '').toLowerCase()
  const exists = members.find(m => (email && (m.user_id === email || m.email === email)) || m.name.toLowerCase() === String(cand.name || '').toLowerCase())
  if (exists) return { created: false, member: exists }
  const { createMemberPublic } = await import('./team.js')
  const roleText = String(cand.role || '').toLowerCase()
  const track = /apprentice|trainee|junior/.test(roleText) ? 'apprentice' : /billing|dispatch|office|admin|assistant|book|account|ops/.test(roleText) ? 'ops' : 'tech'
  const m = await createMemberPublic(req, { name: cand.name, email, user_id: email, phone: cand.phone || '', title: cand.role || (track === 'apprentice' ? 'Apprentice ADAS Technician' : track === 'ops' ? 'Billing & Dispatch' : 'ADAS Calibration Technician'), department: track === 'ops' ? 'Operations' : 'Field', track, access: 'none', employment: 'w2', reports_to: 'mark@absoluteadas.com', region: cand.city || '', hire_date: todayPT(), notes: `From Recruiting${cand.source ? ` (${cand.source})` : ''}. Set App access once ready.` })
  // Account on from day one (Mark 2026-09-22: "make up an account so they can get familiar").
  m.access = track === 'ops' ? 'dispatcher' : 'technician'
  startChecklist(m, 'onboarding', req.user?.name || 'Recruiting')
  seedKit(m)
  await saveMember(req, m)
  try { await ensurePersonFolder(req, m) } catch (e) { console.warn('[people] folder on hire failed:', e.message) }
  try { if (m.phone || m.email) await sendOnboardingInvite(req, m, 'Recruiting') } catch (e) { console.warn('[people] invite on hire failed:', e.message) }
  try { const { postToCliqChannelById, MARK_ALERT_CHANNEL_ID } = await import('../services/cliq.js'); await postToCliqChannelById(MARK_ALERT_CHANNEL_ID, `🎉 *${m.name} marked Hired* — added to the Directory (no login yet) and onboarding checklist started. Directory → ${m.name} → Onboarding.`) } catch {}
  return { created: true, member: m }
}

export default router
