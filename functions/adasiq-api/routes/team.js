import express from 'express'
import catalyst from 'zcatalyst-sdk-node'

const router = express.Router()

function getSegment(req) {
  return catalyst.initialize(req).cache().segment()
}

function isNotFound(e) {
  return e?.statusCode === 404 || e?.errorInfo?.statusCode === 404
}

async function cacheSet(segment, key, value) {
  const str = typeof value === 'string' ? value : JSON.stringify(value)
  try { await segment.update(key, str) }
  catch (e) { await segment.put(key, str) }
}

async function cacheGet(segment, key, fallback = null) {
  try {
    const val = await segment.getValue(key)
    return val ? JSON.parse(val) : fallback
  } catch (e) {
    if (isNotFound(e)) return fallback
    throw e
  }
}

function getUserId(req) {
  return req.user?.email || req.user?.id || req.user?.name || 'unknown'
}

function isAdmin(req) {
  return req.user?.role !== 'technician'
}
const MARK_EMAILS = ['mark@absoluteadas.com', 'mf@absoluteadas.com', 'mfowler4456@gmail.com']
function isOwner(req) {
  return MARK_EMAILS.includes(String(req.user?.email || '').toLowerCase()) || req.user?.role === 'owner'
}

function newId() {
  return `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

// ═══ Directory — the ONE person record (Mark 2026-09-16: "build this out
// like a real company… Directory and then add everybody… org chart").
// Durable Datastore table TeamMembers (45874000000587545): a few indexed
// columns + tm_json for everything else. Login, time clock, PTO, payroll
// and Cliq all key off tm_user_id (email). Replaces the Cache blob
// 'team_members' (migrated once, then left as a frozen backup).
const TM_TABLE = 'TeamMembers'
const DEPARTMENTS = ['Leadership', 'Operations', 'Field', 'Finance', 'Sales']
const ACCESS = ['owner', 'dispatcher', 'technician', 'none']
const COLORS = ['#CD4419', '#2563eb', '#16a34a', '#7c3aed', '#b45309', '#0e7490', '#db2777', '#0891b2']

// Mark's titles (2026-09-16): Founder & Owner · Operations Manager ·
// ADAS Calibration Technician · Accounting Specialist. Joyce has no login.
const SEED = [
  { id: 'mem_mark',   user_id: 'mark@absoluteadas.com',       name: 'Mark Fowler',    email: 'mark@absoluteadas.com',       title: 'Founder & Owner',             department: 'Leadership',  access: 'owner',      employment: 'owner',      reports_to: '',                      avatar_color: '#CD4419', payroll_type: 'excluded' },
  { id: 'mem_kat',    user_id: 'k.belmonte@absoluteadas.com', name: 'Kat Belmonte',   email: 'k.belmonte@absoluteadas.com', title: 'Operations Manager',          department: 'Operations',  access: 'owner',      employment: 'contractor', reports_to: 'mark@absoluteadas.com', avatar_color: '#7c3aed', payroll_type: 'contractor_wise' },
  { id: 'mem_jayden', user_id: 'jayden@absoluteadas.com',     name: 'Jayden Goshorn', email: 'jayden@absoluteadas.com',     title: 'ADAS Calibration Technician', department: 'Field',       access: 'technician', employment: 'w2',         reports_to: 'mark@absoluteadas.com', avatar_color: '#2563eb', payroll_type: 'w2_zoho' },
  { id: 'mem_joyce',  user_id: 'joyce@absoluteadas.com',      name: 'Joyce Cruz',     email: '',                            title: 'Accounting Specialist',       department: 'Finance',     access: 'none',       employment: 'contractor', reports_to: 'mark@absoluteadas.com', avatar_color: '#0e7490', payroll_type: 'contractor_wise' },
]
const BLANK = () => ({
  id: '', user_id: '', name: '', preferred_name: '', email: '', phone: '', personal_phone: '',
  title: '', department: 'Operations', access: 'technician', employment: 'w2', reports_to: '',
  hire_date: '', birthday: '', region: '', van: '', photo_url: '', avatar_color: COLORS[0],
  emergency_contact: { name: '', phone: '', relationship: '' }, notes: '', active: true,
  // payroll (owner-only)
  hourly_rate: 0, payroll_type: 'w2_zoho', salary_annual: 0, period_bonus: 0, filing_status: 'single',
  wise_email: '', wise_currency: 'USD', zoho_payroll_employee_id: '',
  certifications: [], equipment: [], created_at: '', updated_at: '',
})
// App permission role from the directory access level (legacy role names kept readable)
const roleOf = m => (m.access === 'owner' ? 'owner' : m.access === 'technician' ? 'technician' : m.access === 'none' ? 'none' : 'dispatcher')
const PAY_FIELDS = ['hourly_rate', 'payroll_type', 'salary_annual', 'period_bonus', 'filing_status', 'wise_email', 'wise_currency', 'zoho_payroll_employee_id', 'notes']

function tmTable(req) { return catalyst.initialize(req, { type: 'advancedio' }).datastore().table(TM_TABLE) }
function rowToMember(row) {
  const r = row?.[TM_TABLE] || row
  let extra = {}
  try { extra = r.tm_json ? JSON.parse(r.tm_json) : {} } catch { extra = {} }
  const m = { ...BLANK(), ...extra, id: r.tm_id, user_id: r.tm_user_id || extra.user_id || '', name: r.tm_name || extra.name || '', email: r.tm_email || extra.email || '', access: r.tm_access || extra.access || 'technician', active: r.tm_active !== false && r.tm_active !== 'false', _rowid: String(r.ROWID) }
  m.role = roleOf(m)
  return m
}
function memberToRow(m) {
  const { _rowid, role, ...rest } = m
  return { tm_id: m.id, tm_user_id: String(m.user_id || '').toLowerCase(), tm_name: m.name || '', tm_email: String(m.email || '').toLowerCase(), tm_access: m.access || 'technician', tm_active: m.active !== false, tm_json: JSON.stringify(rest).slice(0, 10000) }
}
let _migrated = false
export async function readTeamMembers(req) {
  const app = catalyst.initialize(req, { type: 'advancedio' })
  const rows = await app.zcql().executeZCQLQuery(`SELECT * FROM ${TM_TABLE} ORDER BY ROWID LIMIT 300`)
  let members = (rows || []).map(rowToMember)
  if (!members.length && !_migrated) {
    _migrated = true
    // One-time: bring the old Cache list over, then seed the four people Mark named.
    let old = []
    try { old = (await cacheGet(getSegment(req), 'team_members', [])) || [] } catch { old = [] }
    const merged = []
    for (const s of SEED) {
      const prev = old.find(o => String(o.user_id || o.email || '').toLowerCase() === s.user_id) || {}
      merged.push({ ...BLANK(), ...prev, ...s, active: true, created_at: prev.created_at || new Date().toISOString() })
    }
    for (const o of old) if (!merged.some(m => m.user_id === String(o.user_id || o.email || '').toLowerCase())) merged.push({ ...BLANK(), ...o, id: o.id || newId(), access: o.role === 'owner' ? 'owner' : o.role === 'technician' ? 'technician' : 'dispatcher' })
    const table = tmTable(req)
    for (const m of merged) await table.insertRow(memberToRow(m))
    console.log(`[team] migrated directory to TeamMembers: ${merged.map(m => m.name).join(', ')}`)
    members = (await app.zcql().executeZCQLQuery(`SELECT * FROM ${TM_TABLE} ORDER BY ROWID LIMIT 300`)).map(rowToMember)
  }
  return members.sort((a, b) => (a.department === 'Leadership' ? -1 : b.department === 'Leadership' ? 1 : a.name.localeCompare(b.name)))
}
export async function findMemberByIdentity(req, email, name) {
  const members = await readTeamMembers(req)
  const e = String(email || '').toLowerCase(), n = String(name || '').toLowerCase().trim()
  return members.find(m => e && (m.user_id === e || m.email === e))
    || members.find(m => n && m.name.toLowerCase() === n)
    || null
}
export async function saveMemberPublic(req, m) { return saveMember(req, m) }
export async function createMemberPublic(req, b) {
  const members = await readTeamMembers(req)
  const m = { ...BLANK(), ...b, id: newId(), user_id: String(b.user_id || b.email || '').toLowerCase(), email: String(b.email || '').toLowerCase(), avatar_color: b.avatar_color || COLORS[members.length % COLORS.length], created_at: new Date().toISOString() }
  await saveMember(req, m)
  return m
}
async function saveMember(req, m) {
  const table = tmTable(req)
  m.updated_at = new Date().toISOString()
  if (m._rowid) await table.updateRow({ ROWID: m._rowid, ...memberToRow(m) })
  else { const r = await table.insertRow(memberToRow(m)); m._rowid = String(r.ROWID) }
  return m
}
// Strip what non-owners must not see
function publicView(m, forSelf = false) {
  const { hourly_rate, payroll_type, salary_annual, period_bonus, filing_status, wise_email, wise_currency, zoho_payroll_employee_id, notes, ...rest } = m
  if (forSelf) return { ...rest, payroll_type }
  return rest
}
function isSelf(req, m) { const id = String(getUserId(req)).toLowerCase(); return m.user_id === id || (m.email && m.email === id) || (req.user?.name && m.name.toLowerCase() === String(req.user.name).toLowerCase()) }

// ── Endpoints ──────────────────────────────────────────────────────────

// Everyone gets the directory; only owners get pay + private notes.
router.get('/members', async (req, res) => {
  try {
    const members = await readTeamMembers(req)
    const owner = isOwner(req)
    res.json(members.map(m => owner ? m : publicView(m, isSelf(req, m))))
  } catch (e) { console.error('[team GET members]', e.message); res.status(500).json({ error: e.message }) }
})
router.get('/members/me', async (req, res) => {
  try {
    const me = await findMemberByIdentity(req, req.user?.email, req.user?.name)
    res.json(me ? (isOwner(req) ? me : publicView(me, true)) : null)
  } catch (e) { res.status(500).json({ error: e.message }) }
})
router.get('/directory/meta', (req, res) => res.json({ departments: DEPARTMENTS, access: ACCESS, colors: COLORS }))

router.post('/members', async (req, res) => {
  try {
    if (!isOwner(req)) return res.status(403).json({ error: 'Only Mark and Kat can add people.' })
    const members = await readTeamMembers(req)
    const b = req.body || {}
    const m = { ...BLANK(), ...b, id: newId(), user_id: String(b.user_id || b.email || '').toLowerCase(), email: String(b.email || '').toLowerCase(), avatar_color: b.avatar_color || COLORS[members.length % COLORS.length], created_at: new Date().toISOString() }
    if (!m.name) return res.status(400).json({ error: 'Name required' })
    if (m.user_id && members.some(x => x.user_id === m.user_id)) return res.status(409).json({ error: 'Someone already has that login email.' })
    await saveMember(req, m)
    res.json({ ...m, role: roleOf(m) })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.put('/members/:id', async (req, res) => {
  try {
    const members = await readTeamMembers(req)
    const m = members.find(x => x.id === req.params.id)
    if (!m) return res.status(404).json({ error: 'Not found' })
    const self = isSelf(req, m), owner = isOwner(req)
    if (!owner && !self) return res.status(403).json({ error: 'You can only edit your own card.' })
    const allowedForSelf = ['phone', 'personal_phone', 'preferred_name', 'emergency_contact', 'avatar_color', 'photo_url', 'birthday']
    const allowedForOwner = [...allowedForSelf, 'user_id', 'name', 'email', 'title', 'department', 'access', 'employment', 'reports_to', 'hire_date', 'region', 'van', 'active', 'certifications', 'equipment', 'documents', 'license_expiry', ...PAY_FIELDS]
    const allowed = owner ? allowedForOwner : allowedForSelf
    for (const f of allowed) if (req.body[f] !== undefined) m[f] = req.body[f]
    if (m.user_id) m.user_id = String(m.user_id).toLowerCase()
    if (m.email) m.email = String(m.email).toLowerCase()
    await saveMember(req, m)
    res.json({ ...m, role: roleOf(m) })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.delete('/members/:id', async (req, res) => {
  try {
    if (!isOwner(req)) return res.status(403).json({ error: 'Only Mark and Kat can remove people.' })
    const members = await readTeamMembers(req)
    const m = members.find(x => x.id === req.params.id)
    if (!m) return res.status(404).json({ error: 'Not found' })
    if (MARK_EMAILS.includes(m.user_id)) return res.status(400).json({ error: "Can't remove Mark." })
    // Soft delete: keep the record (payroll history points at it), hide it.
    m.active = false; m.left_at = new Date().toISOString()
    await saveMember(req, m)
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// Org chart: tree from reports_to + open seats (owner-editable list in AppConfig)
router.get('/org', async (req, res) => {
  try {
    const members = (await readTeamMembers(req)).filter(m => m.active !== false)
    const pub = members.map(m => ({ id: m.id, user_id: m.user_id, name: m.name, preferred_name: m.preferred_name, title: m.title, department: m.department, employment: m.employment, reports_to: m.reports_to, avatar_color: m.avatar_color, photo_url: m.photo_url, phone: m.phone, email: m.email, hire_date: m.hire_date }))
    let seats = []
    try { seats = (await cacheGet(getSegment(req), 'org_open_seats', [])) || [] } catch { seats = [] }
    res.json({ ok: true, members: pub, open_seats: seats })
  } catch (e) { res.status(500).json({ error: e.message }) }
})
router.put('/org/open-seats', async (req, res) => {
  try {
    if (!isOwner(req)) return res.status(403).json({ error: 'Only Mark and Kat can edit open seats.' })
    const seats = Array.isArray(req.body?.seats) ? req.body.seats.filter(s => s && s.title).map(s => ({ title: String(s.title).slice(0, 80), reports_to: String(s.reports_to || ''), department: String(s.department || '') })) : []
    await cacheSet(getSegment(req), 'org_open_seats', seats)
    res.json({ ok: true, seats })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── Announcements ────────────────────────────────────────────────────────────

router.get('/announcements', async (req, res) => {
  try {
    const segment = getSegment(req)
    const ann = await cacheGet(segment, 'announcements', []) || []
    // Filter out expired
    const now = new Date().toISOString()
    const active = ann.filter(a => !a.expires_at || a.expires_at >= now)
    active.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)
      || (b.created_at || '').localeCompare(a.created_at || ''))
    res.json(active)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.post('/announcements', async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' })
    const segment = getSegment(req)
    const ann = await cacheGet(segment, 'announcements', []) || []
    const entry = {
      id: `ann_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      title: req.body.title || 'Announcement',
      body: req.body.body || '',
      priority: req.body.priority || 'normal',  // normal, high, urgent
      audience: req.body.audience || 'all',  // all, technicians, admins, office
      pinned: !!req.body.pinned,
      expires_at: req.body.expires_at || '',
      author_id: getUserId(req),
      author_name: req.user?.name || getUserId(req),
      created_at: new Date().toISOString(),
      reads: [],  // array of user_ids
    }
    ann.unshift(entry)
    await cacheSet(segment, 'announcements', ann)
    res.json(entry)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.put('/announcements/:id', async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' })
    const segment = getSegment(req)
    const ann = await cacheGet(segment, 'announcements', [])
    const idx = ann.findIndex(a => a.id === req.params.id)
    if (idx < 0) return res.status(404).json({ error: 'Not found' })
    const allowed = ['title', 'body', 'priority', 'audience', 'pinned', 'expires_at']
    for (const f of allowed) {
      if (req.body[f] !== undefined) ann[idx][f] = req.body[f]
    }
    await cacheSet(segment, 'announcements', ann)
    res.json(ann[idx])
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.delete('/announcements/:id', async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' })
    const segment = getSegment(req)
    const ann = await cacheGet(segment, 'announcements', [])
    const remaining = ann.filter(a => a.id !== req.params.id)
    await cacheSet(segment, 'announcements', remaining)
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.post('/announcements/:id/read', async (req, res) => {
  try {
    const segment = getSegment(req)
    const ann = await cacheGet(segment, 'announcements', [])
    const entry = ann.find(a => a.id === req.params.id)
    if (!entry) return res.status(404).json({ error: 'Not found' })
    const userId = getUserId(req)
    entry.reads = entry.reads || []
    if (!entry.reads.includes(userId)) entry.reads.push(userId)
    await cacheSet(segment, 'announcements', ann)
    res.json(entry)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

export default router
