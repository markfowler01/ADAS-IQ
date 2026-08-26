import express from 'express'
import catalyst from 'zcatalyst-sdk-node'
import { createNotification } from './notification-helper.js'

const router = express.Router()
const REQUESTS_KEY = 'pto_requests'
const BALANCES_KEY = 'pto_balances'

// ── Cache helpers ───────────────────────────────────────────────────────────
function getSegment(req) {
  const app = catalyst.initialize(req)
  return app.cache().segment()
}

function isNotFound(e) {
  return e?.statusCode === 404 || e?.errorInfo?.statusCode === 404
}

async function readCache(req, key, fallback) {
  try {
    const seg = getSegment(req)
    const item = await seg.get(key)
    return item?.cache_value ? JSON.parse(item.cache_value) : fallback
  } catch (e) {
    if (isNotFound(e)) return fallback
    console.warn(`[pto] Cache read failed (${key}):`, e.message)
    return fallback
  }
}

async function writeCache(req, key, value) {
  const seg = getSegment(req)
  const json = JSON.stringify(value)
  try {
    await seg.update(key, json)
  } catch (updateErr) {
    try {
      await seg.put(key, json)
    } catch (putErr) {
      console.error(`[pto] Cache save failed (${key}):`, updateErr.message, '/', putErr.message)
      throw putErr
    }
  }
}

// ── DURABLE storage (Mark 2026-08-15: "this is not built in cache —
// this needs to stay very accurate"). PTO requests and balances live in
// AppConfig Datastore rows (permanent), NOT the 48h Catalyst cache.
// First read self-migrates any legacy cache data into the Datastore.
async function readDurable(req, key, fallback) {
  const app = catalyst.initialize(req, { type: 'advancedio' })
  const rows = await app.zcql().executeZCQLQuery(
    `SELECT config_value FROM AppConfig WHERE config_key = 'durable_${key}' LIMIT 1`
  )
  const r = rows?.[0]?.AppConfig || rows?.[0] || null
  if (r?.config_value) {
    try { return JSON.parse(r.config_value) } catch { return fallback }
  }
  // Not in Datastore yet — migrate whatever the legacy cache holds.
  const legacy = await readCache(req, key, null)
  if (legacy != null) {
    try { await writeDurable(req, key, legacy) } catch (e) { console.warn('[pto] migrate failed:', e.message) }
    return legacy
  }
  return fallback
}
async function writeDurable(req, key, value) {
  const app = catalyst.initialize(req, { type: 'advancedio' })
  const cfgKey = `durable_${key}`
  const json = JSON.stringify(value)
  const rows = await app.zcql().executeZCQLQuery(
    `SELECT ROWID FROM AppConfig WHERE config_key = '${cfgKey}' LIMIT 1`
  )
  const existing = rows?.[0]?.AppConfig || rows?.[0] || null
  const table = app.datastore().table('AppConfig')
  if (existing?.ROWID) await table.updateRow({ ROWID: String(existing.ROWID), config_key: cfgKey, config_value: json })
  else await table.insertRow({ config_key: cfgKey, config_value: json })
}

export async function getRequestsDurable(req) { return readDurable(req, REQUESTS_KEY, []) }
export async function getBalancesDurable(req) { return readDurable(req, BALANCES_KEY, {}) }
async function getRequests(req) { return readDurable(req, REQUESTS_KEY, []) }
async function saveRequests(req, requests) { return writeDurable(req, REQUESTS_KEY, requests) }
async function getBalances(req) { return readDurable(req, BALANCES_KEY, {}) }
async function saveBalances(req, balances) { return writeDurable(req, BALANCES_KEY, balances) }

// ── Defaults ─────────────────────────────────────────────────────────────────
const DEFAULT_BALANCE = {
  // Policy (HR SOP 2026-08): NO paid vacation or personal time by
  // default — sick is live-computed from hours worked, not this bucket.
  // Mark can still grant vacation/personal per person on the Balances tab.
  accrual_rate: 0,
  balance_vacation: 0,
  balance_sick: 0,
  balance_personal: 0,
  carryover_max: 80,
  year_start_balance: 80,
  taken_ytd: 0,
  last_accrual_date: '',
}

// Which balance bucket applies to a given request type
const BUCKET_FOR = {
  vacation:     'balance_vacation',
  sick:         'balance_sick',
  personal:     'balance_personal',
  unpaid:       null,  // unpaid — no balance change
  bereavement:  null,
  jury_duty:    null,
}

const VALID_TYPES = ['vacation', 'sick', 'personal', 'unpaid', 'bereavement', 'jury_duty']
const VALID_STATUSES = ['pending', 'approved', 'denied', 'cancelled']

function ensureUserBalance(balances, userId) {
  if (!balances[userId]) {
    balances[userId] = { user_id: userId, ...DEFAULT_BALANCE }
  }
  return balances[userId]
}

function userFromReq(req) {
  const u = req.user || {}
  return {
    user_id: u.email || u.id || u.name || 'unknown',
    user_name: u.name || u.email || 'Unknown User',
    is_admin: u.role !== 'technician',
  }
}

function makeRequestId() {
  return `pto_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function validateRequestBody(body) {
  const errors = []
  const { type, start_date, end_date, hours_requested } = body
  if (!type || !VALID_TYPES.includes(type)) errors.push(`type must be one of: ${VALID_TYPES.join(', ')}`)
  if (!start_date || !/^\d{4}-\d{2}-\d{2}$/.test(start_date)) errors.push('start_date must be YYYY-MM-DD')
  if (!end_date || !/^\d{4}-\d{2}-\d{2}$/.test(end_date)) errors.push('end_date must be YYYY-MM-DD')
  if (start_date && end_date && end_date < start_date) errors.push('end_date must be on or after start_date')
  const hrs = Number(hours_requested)
  if (!Number.isFinite(hrs) || hrs <= 0) errors.push('hours_requested must be a positive number')
  // Whole-hour increments, max 8h per day in the range (Mark 2026-08-28)
  if (Number.isFinite(hrs) && hrs !== Math.round(hrs)) errors.push('hours_requested must be whole hours (1-hour increments)')
  if (start_date && end_date && /^\d{4}-\d{2}-\d{2}$/.test(start_date) && /^\d{4}-\d{2}-\d{2}$/.test(end_date) && end_date >= start_date) {
    const days = Math.round((new Date(end_date + 'T12:00Z') - new Date(start_date + 'T12:00Z')) / 86400000) + 1
    if (Number.isFinite(hrs) && hrs > days * 8) errors.push(`hours_requested cannot exceed ${days * 8}h for a ${days}-day request (8h/day max)`)
  }
  return errors
}

// ── POST /requests — submit a new request ──────────────────────────────────
router.post('/requests', async (req, res) => {
  try {
    const { user_id, user_name } = userFromReq(req)
    const { type, start_date, end_date, hours_requested, half_day, reason } = req.body || {}

    const errs = validateRequestBody(req.body || {})
    if (errs.length) return res.status(400).json({ error: errs.join('; ') })

    const newReq = {
      id: makeRequestId(),
      user_id,
      user_name,
      type,
      start_date,
      end_date,
      hours_requested: Number(hours_requested),
      half_day: !!half_day,
      reason: reason || '',
      status: 'pending',
      approved_by: '',
      approved_at: '',
      denied_reason: '',
      created_at: new Date().toISOString(),
    }

    const requests = await getRequests(req)
    requests.unshift(newReq)
    await saveRequests(req, requests)

    // Notify admin
    try {
      await createNotification(req, {
        title: `Time Off Request — ${user_name}`,
        message: `${user_name} requested ${hours_requested}h of ${type} from ${start_date} to ${end_date}`,
        type: 'pto_request',
        link: 'pto',
        data: { requestId: newReq.id, user_id, type },
      })
    } catch (e) {
      console.warn('[pto] Notification failed:', e.message)
    }

    res.json({ ok: true, request: newReq })
  } catch (err) {
    console.error('[pto POST /requests]', err)
    res.status(500).json({ error: err.message })
  }
})

// ── GET /requests — list (admin: all; tech: own) ──────────────────────────
router.get('/requests', async (req, res) => {
  try {
    const { user_id, is_admin } = userFromReq(req)
    const all = await getRequests(req)
    const statusFilter = req.query.status
    const userFilter = req.query.user_id

    let out = all
    if (!is_admin) out = out.filter(r => r.user_id === user_id)
    else if (userFilter) out = out.filter(r => r.user_id === userFilter)
    if (statusFilter) out = out.filter(r => r.status === statusFilter)

    res.json({ ok: true, requests: out })
  } catch (err) {
    console.error('[pto GET /requests]', err)
    res.status(500).json({ error: err.message })
  }
})

// ── GET /requests/mine — own requests ──────────────────────────────────────
router.get('/requests/mine', async (req, res) => {
  try {
    const { user_id } = userFromReq(req)
    const all = await getRequests(req)
    const mine = all.filter(r => r.user_id === user_id)
    res.json({ ok: true, requests: mine })
  } catch (err) {
    console.error('[pto GET /requests/mine]', err)
    res.status(500).json({ error: err.message })
  }
})

// ── PUT /requests/:id — update own pending request ─────────────────────────
router.put('/requests/:id', async (req, res) => {
  try {
    const { user_id, is_admin } = userFromReq(req)
    const id = req.params.id
    const requests = await getRequests(req)
    const idx = requests.findIndex(r => r.id === id)
    if (idx < 0) return res.status(404).json({ error: 'Request not found' })
    const existing = requests[idx]
    if (!is_admin && existing.user_id !== user_id) return res.status(403).json({ error: 'Forbidden' })
    if (existing.status !== 'pending') return res.status(400).json({ error: 'Only pending requests can be edited' })

    const body = req.body || {}
    const patch = {}
    const patchable = ['type', 'start_date', 'end_date', 'hours_requested', 'half_day', 'reason']
    for (const k of patchable) if (k in body) patch[k] = body[k]

    const merged = { ...existing, ...patch }
    const errs = validateRequestBody(merged)
    if (errs.length) return res.status(400).json({ error: errs.join('; ') })
    if (patch.hours_requested != null) merged.hours_requested = Number(patch.hours_requested)
    if ('half_day' in patch) merged.half_day = !!patch.half_day

    requests[idx] = merged
    await saveRequests(req, requests)
    res.json({ ok: true, request: merged })
  } catch (err) {
    console.error('[pto PUT /requests/:id]', err)
    res.status(500).json({ error: err.message })
  }
})

// ── POST /requests/:id/approve (admin) ─────────────────────────────────────
router.post('/requests/:id/approve', async (req, res) => {
  try {
    const { user_id: adminId, is_admin } = userFromReq(req)
    if (!is_admin) return res.status(403).json({ error: 'Admin only' })
    // All time-off approvals route to Mark (Mark 2026-08-15 / HR SOP:
    // "Approver: Mark, single level"). Kat gets visibility, not the button.
    const approverEmail = String(req.user?.email || '').toLowerCase()
    if (approverEmail && !/^mark@/.test(approverEmail)) {
      return res.status(403).json({ error: 'Time-off approvals go to Mark only' })
    }

    const id = req.params.id
    const requests = await getRequests(req)
    const idx = requests.findIndex(r => r.id === id)
    if (idx < 0) return res.status(404).json({ error: 'Request not found' })
    const r = requests[idx]
    if (r.status !== 'pending') return res.status(400).json({ error: `Cannot approve ${r.status} request` })

    // WA sick leave (Mark 2026-08-15 HR build): balance is LIVE-computed
    // from the durable timeclock (1h per 40h worked) minus approved sick.
    // May go to -40 (advance, repaid by future accrual) — never further.
    if (r.type === 'sick') {
      try {
        const { computeSickBalances, SICK_NEGATIVE_FLOOR } = await import('../services/hr.js')
        const balances = await computeSickBalances(req)
        const key = String(r.user_name || r.user_id).trim().split(/\s+/)[0].toLowerCase()
        const current = balances[key]?.sick_balance_hours ?? 0
        const after = current - Number(r.hours_requested || 0)
        if (after < SICK_NEGATIVE_FLOOR) {
          return res.status(400).json({
            error: `This would put ${r.user_name} at ${after.toFixed(1)}h sick balance — below the -40h advance limit. Current balance: ${current.toFixed(1)}h.`,
          })
        }
        if (after < 0) {
          // Flag every negative balance to Mark (SOP: "Flag it to me directly")
          try {
            const { postToCliqChannelById, MARK_ALERT_CHANNEL_ID } = await import('../services/cliq.js')
            await postToCliqChannelById(MARK_ALERT_CHANNEL_ID,
              `⚠️ *Negative sick balance* — ${r.user_name} is at ${after.toFixed(1)}h after this approval (advanced hours, repaid from future accrual).`)
          } catch { /* non-fatal */ }
        }
      } catch (e) { console.warn('[pto] sick balance check failed (approving anyway):', e.message) }
    }

    // Legacy bucket bookkeeping (vacation/personal still use stored buckets)
    const balances = await getBalances(req)
    const bal = ensureUserBalance(balances, r.user_id)
    const bucket = BUCKET_FOR[r.type]
    if (bucket && r.type !== 'sick') {
      bal[bucket] = Math.max(0, Number(bal[bucket] || 0) - Number(r.hours_requested || 0))
    }
    bal.taken_ytd = Number(bal.taken_ytd || 0) + Number(r.hours_requested || 0)
    await saveBalances(req, balances)

    r.status = 'approved'
    r.approved_by = adminId
    r.approved_at = new Date().toISOString()
    r.denied_reason = ''
    requests[idx] = r
    await saveRequests(req, requests)

    try {
      await createNotification(req, {
        title: `Time Off Approved`,
        message: `Your ${r.type} request (${r.start_date} to ${r.end_date}, ${r.hours_requested}h) was approved.`,
        type: 'pto_approved',
        link: 'pto',
        data: { requestId: r.id, user_id: r.user_id },
      })
    } catch (e) { console.warn('[pto] Notification failed:', e.message) }

    res.json({ ok: true, request: r, balance: bal })
  } catch (err) {
    console.error('[pto POST /approve]', err)
    res.status(500).json({ error: err.message })
  }
})

// ── POST /requests/:id/deny (admin) ─────────────────────────────────────
router.post('/requests/:id/deny', async (req, res) => {
  try {
    const { user_id: adminId, is_admin } = userFromReq(req)
    if (!is_admin) return res.status(403).json({ error: 'Admin only' })
    const approverEmail = String(req.user?.email || '').toLowerCase()
    if (approverEmail && !/^mark@/.test(approverEmail)) {
      return res.status(403).json({ error: 'Time-off approvals go to Mark only' })
    }

    const id = req.params.id
    const reason = (req.body && req.body.reason) || ''
    if (!reason.trim()) return res.status(400).json({ error: 'Denial reason is required' })

    const requests = await getRequests(req)
    const idx = requests.findIndex(r => r.id === id)
    if (idx < 0) return res.status(404).json({ error: 'Request not found' })
    const r = requests[idx]
    if (r.status !== 'pending') return res.status(400).json({ error: `Cannot deny ${r.status} request` })

    r.status = 'denied'
    r.approved_by = adminId
    r.approved_at = new Date().toISOString()
    r.denied_reason = reason.trim()
    requests[idx] = r
    await saveRequests(req, requests)

    try {
      await createNotification(req, {
        title: `Time Off Denied`,
        message: `Your ${r.type} request (${r.start_date} to ${r.end_date}) was denied: ${reason.trim()}`,
        type: 'pto_denied',
        link: 'pto',
        data: { requestId: r.id, user_id: r.user_id },
      })
    } catch (e) { console.warn('[pto] Notification failed:', e.message) }

    res.json({ ok: true, request: r })
  } catch (err) {
    console.error('[pto POST /deny]', err)
    res.status(500).json({ error: err.message })
  }
})

// ── POST /requests/:id/cancel — user cancels own pending ─────────────────
router.post('/requests/:id/cancel', async (req, res) => {
  try {
    const { user_id, is_admin } = userFromReq(req)
    const id = req.params.id
    const requests = await getRequests(req)
    const idx = requests.findIndex(r => r.id === id)
    if (idx < 0) return res.status(404).json({ error: 'Request not found' })
    const r = requests[idx]
    if (!is_admin && r.user_id !== user_id) return res.status(403).json({ error: 'Forbidden' })
    if (r.status !== 'pending') return res.status(400).json({ error: 'Only pending requests can be cancelled' })
    r.status = 'cancelled'
    requests[idx] = r
    await saveRequests(req, requests)
    res.json({ ok: true, request: r })
  } catch (err) {
    console.error('[pto POST /cancel]', err)
    res.status(500).json({ error: err.message })
  }
})

// ── GET /balance — current user ─────────────────────────────────────────
// Live WA sick balances for everyone (computed, never stored)
router.get('/sick-balances', async (req, res) => {
  try {
    const { computeSickBalances } = await import('../services/hr.js')
    res.json({ ok: true, balances: await computeSickBalances(req) })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Manual hours-report trigger (backup-2026) — verification + on-demand
router.post('/hours-report-run', async (req, res) => {
  const secret = req.headers['x-cron-secret'] || req.query.secret || ''
  if (secret !== 'backup-2026') return res.status(401).json({ error: 'unauthorized' })
  try {
    const { buildHoursReport } = await import('../services/hr.js')
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
    const start = `${today.slice(0, 8)}01`
    const report = await buildHoursReport(req, start, today)
    const { postToCliqChannelById, MARK_ALERT_CHANNEL_ID } = await import('../services/cliq.js')
    await postToCliqChannelById(MARK_ALERT_CHANNEL_ID,
      `🕒 *Hours report (manual test)* — ${start} to ${today}\n\n` + '```\n' + report.text.slice(0, 3000) + '\n```')
    res.json({ ok: true, ...report })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/balance', async (req, res) => {
  try {
    const { user_id } = userFromReq(req)
    const balances = await getBalances(req)
    const bal = ensureUserBalance(balances, user_id)
    res.json({ ok: true, balance: bal })
  } catch (err) {
    console.error('[pto GET /balance]', err)
    res.status(500).json({ error: err.message })
  }
})

// ── GET /balances — admin only ───────────────────────────────────────────
router.get('/balances', async (req, res) => {
  try {
    const { is_admin } = userFromReq(req)
    if (!is_admin) return res.status(403).json({ error: 'Admin only' })
    const balances = await getBalances(req)
    res.json({ ok: true, balances })
  } catch (err) {
    console.error('[pto GET /balances]', err)
    res.status(500).json({ error: err.message })
  }
})

// ── PUT /balances/:user_id — admin adjust ────────────────────────────────
router.put('/balances/:user_id', async (req, res) => {
  try {
    const { is_admin } = userFromReq(req)
    if (!is_admin) return res.status(403).json({ error: 'Admin only' })
    const uid = req.params.user_id
    const balances = await getBalances(req)
    const cur = ensureUserBalance(balances, uid)
    const patch = req.body || {}
    const allowed = ['accrual_rate', 'balance_vacation', 'balance_sick', 'balance_personal',
                     'carryover_max', 'year_start_balance', 'taken_ytd', 'last_accrual_date',
                     // Pre-app history: hours earned before the timeclock existed
                     // (folded into the live-computed sick balance).
                     'sick_opening_credit']
    for (const k of allowed) {
      if (k in patch) {
        if (k === 'last_accrual_date') cur[k] = String(patch[k] || '')
        else cur[k] = Number(patch[k] || 0)
      }
    }
    balances[uid] = cur
    await saveBalances(req, balances)
    res.json({ ok: true, balance: cur })
  } catch (err) {
    console.error('[pto PUT /balances/:user_id]', err)
    res.status(500).json({ error: err.message })
  }
})

// ── GET /calendar?from=&to= — approved PTO for everyone ─────────────────
router.get('/calendar', async (req, res) => {
  try {
    const { from, to } = req.query
    const all = await getRequests(req)
    let approved = all.filter(r => r.status === 'approved')
    if (from) approved = approved.filter(r => r.end_date >= from)
    if (to) approved = approved.filter(r => r.start_date <= to)
    // Minimal projection
    const projected = approved.map(r => ({
      id: r.id,
      user_id: r.user_id,
      user_name: r.user_name,
      type: r.type,
      start_date: r.start_date,
      end_date: r.end_date,
      hours_requested: r.hours_requested,
      half_day: r.half_day,
    }))
    res.json({ ok: true, requests: projected })
  } catch (err) {
    console.error('[pto GET /calendar]', err)
    res.status(500).json({ error: err.message })
  }
})

export default router
