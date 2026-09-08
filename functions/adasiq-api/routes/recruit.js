// Recruiting CRM (Mark 2026-09-07: "Zoho Recruit is way too complicated").
//
// Two routers:
//   publicRouter  → POST /api/public/recruit/apply   (no auth; the website form)
//   router        → /api/recruit/*                  (staff; the pipeline board)
//
// Storage: AdasCandidates Datastore table (created via Catalyst MCP
// 2026-09-07, table id 45874000000548907). Columns carry the cand_
// prefix because Datastore rejects reserved words as column names.
//
// Apply flow: validate → insert (stage 'new') → email Mark → Cliq ping
// to Mark's alerts. Everything is awaited BEFORE the response — Catalyst
// ends the function once res goes out.
import express from 'express'
import catalyst from 'zcatalyst-sdk-node'
import multer from 'multer'
// uploadFileToFolder resolves to { fileId } (sometimes a bare id) — always keep the string.
const wdId = r => String((r && typeof r === 'object') ? (r.fileId || r.id || r.resource_id || '') : (r || ''))
import axios from 'axios'

export const STAGES = [
  { id: 'new',          label: '📥 New' },
  { id: 'contacted',    label: '📞 Contacted' },
  { id: 'phone_screen', label: '🎙 Phone Screen' },
  { id: 'ride_along',   label: '🚐 Ride-Along' },
  { id: 'offer',        label: '📝 Offer' },
  { id: 'hired',        label: '✅ Hired' },
  { id: 'did_not_hire', label: '❌ Did Not Hire' },
  { id: 'do_not_hire',  label: '🚫 Do Not Hire' },
]
const STAGE_IDS = new Set(STAGES.map(s => s.id))
const TABLE = 'AdasCandidates'
const q = s => String(s ?? '').replace(/'/g, "''")
const clip = (v, n) => String(v ?? '').trim().slice(0, n)

function rowToCandidate(r) {
  return {
    id: String(r.ROWID),
    name: r.cand_name || '', phone: r.cand_phone || '', email: r.cand_email || '',
    city: r.cand_city || '', role: r.cand_role || '', experience: r.cand_experience || '',
    certs: r.cand_certs || '', availability: r.cand_availability || '', source: r.cand_source || '',
    message: r.cand_message || '', stage: r.cand_stage || 'new', notes: r.cand_notes || '',
    resume_url: r.cand_resume_url || '', photo_id: r.cand_photo_id || '', rating: Number(r.cand_rating) || 0,
    created_at: r.cand_created_at || r.CREATEDTIME || '', updated_at: r.cand_updated_at || '',
  }
}

async function readAll(req) {
  const app = catalyst.initialize(req)
  const out = []
  for (let off = 0; ; off += 300) {
    const rows = await app.zcql().executeZCQLQuery(`SELECT * FROM ${TABLE} LIMIT ${off}, 300`)
    const batch = (rows || []).map(r => r?.[TABLE] || r).filter(Boolean)
    out.push(...batch)
    if (batch.length < 300) break
  }
  return out.map(rowToCandidate).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
}

async function insertCandidate(req, c) {
  const app = catalyst.initialize(req)
  const now = new Date().toISOString()
  const row = await app.datastore().table(TABLE).insertRow({
    cand_name: clip(c.name, 200), cand_phone: clip(c.phone, 40), cand_email: clip(c.email, 200),
    cand_city: clip(c.city, 120), cand_role: clip(c.role, 100), cand_experience: clip(c.experience, 10000),
    cand_certs: clip(c.certs, 255), cand_availability: clip(c.availability, 120), cand_source: clip(c.source, 100),
    cand_message: clip(c.message, 10000), cand_stage: STAGE_IDS.has(c.stage) ? c.stage : 'new',
    cand_notes: clip(c.notes, 10000), cand_resume_url: clip(c.resume_url, 255), cand_photo_id: clip(c.photo_id, 120),
    cand_rating: Number(c.rating) || 0, cand_created_at: now, cand_updated_at: now,
  })
  return rowToCandidate(row)
}

// ── Notify Mark: email + Cliq (both bounded, non-fatal) ─────────────────
async function notifyMark(c) {
  const lines = [
    `Name: ${c.name}`, `Phone: ${c.phone || '—'}`, `Email: ${c.email || '—'}`, `City: ${c.city || '—'}`,
    `Applying for: ${c.role || '—'}`, `Availability: ${c.availability || '—'}`, `Certs/licenses: ${c.certs || '—'}`,
    `Heard about us: ${c.source || '—'}`, '', `Experience:`, c.experience || '—', '', `Message:`, c.message || '—',
  ]
  const text = lines.join('\n')
  const tasks = []
  tasks.push((async () => {
    const { getMailAccessToken, getMailAccountIdFor, sendMail } = await import('../services/mail.js')
    const token = await getMailAccessToken()
    const accountId = await getMailAccountIdFor(token, 'mark@absoluteadas.com')
    await sendMail(token, accountId, {
      to: 'mark@absoluteadas.com',
      subject: `🧑‍🔧 New applicant: ${c.name}${c.role ? ` — ${c.role}` : ''}`,
      body: `<pre style="font-family:Inter,Arial,sans-serif;font-size:14px;white-space:pre-wrap">${text.replace(/[<>&]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[ch]))}</pre>` +
            `<p><a href="https://adas-iq-904191467.development.catalystserverless.com/app/">Open the Recruiting board</a></p>`,
    })
  })().catch(e => console.warn('[recruit email]', e.message)))
  tasks.push((async () => {
    const { postToCliqChannelById, MARK_ALERT_CHANNEL_ID } = await import('../services/cliq.js')
    await postToCliqChannelById(MARK_ALERT_CHANNEL_ID,
      `🧑‍🔧 *New applicant: ${c.name}*${c.role ? ` · ${c.role}` : ''}${c.city ? ` · ${c.city}` : ''}\n` +
      `${c.phone || ''}${c.email ? ` · ${c.email}` : ''}\n${clip(c.experience || c.message, 240)}`)
  })().catch(e => console.warn('[recruit cliq]', e.message)))
  await Promise.race([Promise.all(tasks), new Promise(r => setTimeout(r, 12000))])
}

// ── Files (Mark 2026-09-07: "upload a picture and a resume spot") ──────
// Stored in a dedicated WorkDrive folder; streamed back through
// /api/recruit/file/:id so the board can show them behind auth.
// Plain multer like the (working) jobs photo upload: no fileFilter, no
// field map — Catalyst dropped every file part when those were set.
// Types are validated in storeFiles instead.
const fileUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024 } }).any()

async function cfgRow(app, key) {
  const rows = await app.zcql().executeZCQLQuery(`SELECT ROWID, config_value FROM AppConfig WHERE config_key = '${q(key)}' LIMIT 1`).catch(() => [])
  return rows?.[0]?.AppConfig || rows?.[0] || null
}
async function ensureCandidateFolder(req, wdToken) {
  const app = catalyst.initialize(req)
  const r = await cfgRow(app, 'recruit_files_folder_id')
  const saved = r?.config_value ? String(r.config_value).replace(/"/g, '') : ''
  if (saved) return saved
  const { createJobFolder } = await import('../services/workdrive.js')
  const f = await createJobFolder('Absolute ADAS Candidates', wdToken)
  const id = f?.folderId
  if (id) await app.datastore().table('AppConfig').insertRow({ config_key: 'recruit_files_folder_id', config_value: JSON.stringify(id) })
  return id
}
async function storeFiles(req, files, name) {
  const out = { photo_id: '', resume_url: '' }
  const list = Array.isArray(files) ? files : Object.values(files || {}).flat()
  const isImg = f => /^image\//.test(f.mimetype)
  const isDoc = f => /pdf|msword|officedocument|^image\//.test(f.mimetype)
  const photo = list.find(f => f.fieldname === 'photo' && isImg(f))
  const resume = list.find(f => f.fieldname === 'resume' && isDoc(f))
  for (const f of list) if ((f.fieldname === 'photo' && !isImg(f)) || (f.fieldname === 'resume' && !isDoc(f))) console.log('[recruit files] skipped', f.fieldname, f.mimetype)
  if (!photo && !resume) return out
  try {
    const { getAccessToken } = await import('../services/zoho.js')
    const { uploadFileToFolder } = await import('../services/workdrive.js')
    const wdToken = await getAccessToken()
    const folderId = await ensureCandidateFolder(req, wdToken)
    if (!folderId) return out
    const safe = String(name || 'candidate').replace(/[^A-Za-z0-9 _-]/g, '').trim().slice(0, 40) || 'candidate'
    const stamp = Date.now()
    if (photo) {
      const ext = (photo.mimetype.split('/')[1] || 'jpg').replace('jpeg', 'jpg')
      out.photo_id = wdId(await uploadFileToFolder(folderId, `${safe} - photo ${stamp}.${ext}`, photo.buffer, wdToken, photo.mimetype)))
    }
    if (resume) {
      const ext = resume.originalname?.includes('.') ? resume.originalname.split('.').pop().toLowerCase().slice(0, 5) : 'pdf'
      out.resume_url = wdId(await uploadFileToFolder(folderId, `${safe} - resume ${stamp}.${ext}`, resume.buffer, wdToken, resume.mimetype)))
    }
  } catch (e) { console.log('[recruit files] FAILED:', e.message, e.response?.data ? JSON.stringify(e.response.data).slice(0, 300) : '') }
  return out
}
async function fetchWdFile(fileId) {
  const { getAccessToken } = await import('../services/zoho.js')
  const wdToken = await getAccessToken()
  const r = await axios.get(`https://download.zoho.com/v1/workdrive/download/${fileId}`, {
    headers: { Authorization: `Zoho-oauthtoken ${wdToken}` }, responseType: 'arraybuffer', timeout: 25000, maxContentLength: 30 * 1024 * 1024,
  })
  return { buf: Buffer.from(r.data), mime: r.headers['content-type'] || 'application/octet-stream' }
}

// ── PUBLIC: website intake form ─────────────────────────────────────────
export const publicRouter = express.Router()
// Multer FIRST (it no-ops on non-multipart), then the urlencoded/json
// parsers for the plain-form path. With the parsers ahead of multer,
// Catalyst delivered the text fields but zero file parts (2026-09-07).
// Single-handler shape like the jobs upload route. NOTE (2026-09-07,
// found the hard way): Catalyst's gateway truncates a multipart body at
// any field value that STARTS with "(" — e.g. "(425) 555-0100" — so the
// website form normalizes values before sending (see careers form JS).
publicRouter.post('/apply', (req, res) => {
  const ct = String(req.headers['content-type'] || '')
  const parse = ct.includes('multipart/form-data') ? fileUpload
    : ct.includes('application/x-www-form-urlencoded') ? express.urlencoded({ extended: false, limit: '64kb' })
    : express.json({ limit: '64kb' })
  parse(req, res, err => { if (err) return res.status(400).json({ error: err.message }); handleApply(req, res) })
})
async function handleApply(req, res) {
  res.set('Access-Control-Allow-Origin', '*')
  try {
    const b = req.body || {}
    if (b.website && String(b.website).trim() !== '') return res.status(400).json({ error: 'Invalid submission' })  // honeypot
    const name = clip(b.name, 200)
    const phone = clip(b.phone, 40)
    const email = clip(b.email, 200).toLowerCase()
    if (!name) return res.status(400).json({ error: 'Name is required' })
    if (!phone && !email) return res.status(400).json({ error: 'A phone number or email is required' })
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'That email doesn\'t look right' })
    console.log('[recruit apply]', name, '· files:', (Array.isArray(req.files) ? req.files : []).map(f => `${f.fieldname}:${f.size}`).join(',') || 'none')
    const c = await insertCandidate(req, {
      name, phone, email, city: b.city, role: b.role || b.position, experience: b.experience,
      certs: b.certs, availability: b.availability, source: b.source || 'website', message: b.message, stage: 'new',
      ...(await storeFiles(req, req.files, name)),
    })
    await notifyMark(c)
    res.json({ ok: true })
  } catch (e) {
    console.error('[recruit apply]', e.message)
    res.status(500).json({ error: 'Server error — please call or text us instead.' })
  }
}
publicRouter.options('/apply', (req, res) => {
  res.set('Access-Control-Allow-Origin', '*')
  res.set('Access-Control-Allow-Headers', 'Content-Type')
  res.status(204).end()
})

// ── STAFF: pipeline board ───────────────────────────────────────────────
const router = express.Router()
const isOwner = req => String(req.user?.email || '').toLowerCase().startsWith('mark@') || req.user?.role === 'owner'

router.get('/file/:fileId', async (req, res) => {
  try {
    if (req.query.t) {
      const { verifyToken } = await import('./auth.js')
      if (!verifyToken(String(req.query.t))) return res.status(401).json({ error: 'unauthorized' })
    }
    const { buf, mime } = await fetchWdFile(String(req.params.fileId))
    res.setHeader('Cache-Control', 'private, max-age=86400')
    if (req.query.dl) res.setHeader('Content-Disposition', 'attachment')
    res.type(mime).send(buf)
  } catch (e) { res.status(404).json({ error: 'File not found' }) }
})

router.get('/', async (req, res) => {
  try { res.json({ stages: STAGES, candidates: await readAll(req) }) }
  catch (e) { res.status(500).json({ error: e.message }) }
})

router.post('/', async (req, res) => {
  try {
    const b = req.body || {}
    if (!clip(b.name, 200)) return res.status(400).json({ error: 'Name is required' })
    res.json({ ok: true, candidate: await insertCandidate(req, { ...b, source: b.source || 'manual' }) })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.patch('/:id', async (req, res) => {
  try {
    const app = catalyst.initialize(req)
    const b = req.body || {}
    const upd = { ROWID: String(req.params.id), cand_updated_at: new Date().toISOString() }
    if (b.stage !== undefined) { if (!STAGE_IDS.has(b.stage)) return res.status(400).json({ error: 'Unknown stage' }); upd.cand_stage = b.stage }
    if (b.notes !== undefined) upd.cand_notes = clip(b.notes, 10000)
    if (b.rating !== undefined) upd.cand_rating = Math.max(0, Math.min(5, Number(b.rating) || 0))
    for (const [k, col, n] of [['name', 'cand_name', 200], ['phone', 'cand_phone', 40], ['email', 'cand_email', 200], ['city', 'cand_city', 120],
      ['role', 'cand_role', 100], ['certs', 'cand_certs', 255], ['availability', 'cand_availability', 120], ['resume_url', 'cand_resume_url', 255],
      ['experience', 'cand_experience', 10000], ['message', 'cand_message', 10000], ['source', 'cand_source', 100]]) {
      if (b[k] !== undefined) upd[col] = clip(b[k], n)
    }
    const row = await app.datastore().table(TABLE).updateRow(upd)
    res.json({ ok: true, candidate: rowToCandidate(row) })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.delete('/:id', async (req, res) => {
  try {
    if (!isOwner(req)) return res.status(403).json({ error: 'Only Mark can delete candidates.' })
    await catalyst.initialize(req).datastore().table(TABLE).deleteRow(String(req.params.id))
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

export default router
