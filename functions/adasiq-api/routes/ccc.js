// 📥 CCC Secure Share webhook (Mark 2026-09-30, app 1800 "Absolute ADAS",
// Vehicle Diagnostics Reporting, Push, v9).
//
// Base URL given to CCC:  https://<host>/server/adasiq-api/api/ccc
// CCC calls:              POST {base}/estimate?appId=1800&trigger=save|lock|manual
//
// Rules from CCC's docs: verify X-SecureShare-Signature (base64 HMAC-SHA1 of the
// full URL + the first 200 chars of the body, keyed with the secret set on the
// Environments tab) BEFORE processing; answer 2xx fast or CCC retries (7 tries
// over 4 hours, then the estimate is gone); messages can arrive more than once.
//
// So this handler only: checks the signature → saves the raw XML to WorkDrive
// → records it in the scrub queue (deduped by content hash) → 200. Scrubbing
// happens in the parallel workers (services/cccScrub.js). If saving fails we
// answer 500 so CCC keeps the message and retries — never 200 on a lost car.
//
// Secrets live in the function's environment variables (never in code):
//   CCC_SECURESHARE_SECRET          production secret
//   CCC_SECURESHARE_SECRET_SANDBOX  sandbox secret (optional)
import crypto from 'node:crypto'

const PUBLIC_BASE = process.env.API_PUBLIC_BASE || 'https://adas-iq-904191467.development.catalystserverless.com/server/adasiq-api'
const APP_ID = '1800'
let _inboxId = ''

// Secrets: env vars if present, else the owner-only CCC screen in the app
// (AppConfig ccc_secret_sandbox / ccc_secret_production) — Catalyst's env-var
// limit was full (2026-09-30). Cached a minute; never returned by any route.
import catalyst from 'zcatalyst-sdk-node'
import express from 'express'
let _sec = { at: 0, list: [] }

// 🔐 CCC Secure Share standards §4.1: "All API secret keys and credentials
// should be encrypted." Secrets are stored AES-256-GCM, keyed from an env-only
// secret (never in code). Old plain rows still work and get re-saved encrypted.
const ENC = 'enc:v1:'
function encKey() {
  const base = process.env.SESSION_SECRET || process.env.ZOHO_CLIENT_SECRET || ''
  if (!base) throw new Error('no encryption key in the environment')
  return crypto.createHash('sha256').update(`ccc-secret|${base}`).digest()
}
export function sealSecret(plain) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', encKey(), iv)
  const body = Buffer.concat([c.update(String(plain), 'utf8'), c.final()])
  return ENC + Buffer.concat([iv, c.getAuthTag(), body]).toString('base64')
}
export function openSecret(stored) {
  const v = String(stored || '')
  if (!v.startsWith(ENC)) return v
  const buf = Buffer.from(v.slice(ENC.length), 'base64')
  const d = crypto.createDecipheriv('aes-256-gcm', encKey(), buf.subarray(0, 12)); d.setAuthTag(buf.subarray(12, 28))
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8')
}

// 🔒 CCC standards §4.1 (data use, minimum necessary): the scrubber never uses
// the vehicle owner's, insured's or claimant's personal details, so they are
// cut out of the BMS before anything is stored. Shop, estimator, insurer,
// claim, vehicle and damage lines stay.
const PERSONAL = ['Owner', 'Insured', 'Claimant', 'PolicyHolder', 'Customer', 'Driver', 'InsuranceAgent', 'PolicyInfo']
export function redactBms(xml) {
  let out = String(xml || '')
  for (const t of PERSONAL) out = out.replace(new RegExp(`<((?:\\w+:)?${t})\\b[^>]*>[\\s\\S]*?</\\1>`, 'g'), `<$1 redacted="true"/>`)
  return out.replace(/<((?:\w+:)?PolicyNum)\b[^>]*>[\s\S]*?<\/\1>/g, '<$1 redacted="true"/>')
}
const cfgKey = env => `ccc_secret_${env === 'production' ? 'production' : 'sandbox'}`
async function readCfg(req, key) {
  try {
    const rows = await catalyst.initialize(req, { type: 'advancedio' }).zcql().executeZCQLQuery(`SELECT ROWID, config_value FROM AppConfig WHERE config_key = '${key}' ORDER BY MODIFIEDTIME DESC LIMIT 1`)
    const r = rows?.[0]?.AppConfig
    if (!r) return { row: null, value: '' }
    const stored = String(r.config_value || '')
    const value = openSecret(stored)
    // Upgrade a plain row in place.
    if (value && !stored.startsWith(ENC)) { try { await catalyst.initialize(req, { type: 'advancedio' }).datastore().table('AppConfig').updateRow({ ROWID: String(r.ROWID), config_key: key, config_value: sealSecret(value) }); console.log(`[ccc] ${key} encrypted at rest`) } catch (e) { console.warn('[ccc] encrypt upgrade failed', e.message) } }
    return { row: String(r.ROWID), value }
  } catch { return { row: null, value: '' } }
}
async function loadSecrets(req) {
  if (Date.now() - _sec.at < 60000) return _sec.list
  const [sb, pr] = await Promise.all([readCfg(req, cfgKey('sandbox')), readCfg(req, cfgKey('production'))])
  _sec = { at: Date.now(), list: [process.env.CCC_SECURESHARE_SECRET, process.env.CCC_SECURESHARE_SECRET_SANDBOX, pr.value, sb.value].filter(Boolean) }
  return _sec.list
}

function signatureOk(req, raw, secrets) {
  const got = String(req.headers['x-secureshare-signature'] || '').trim()
  if (!got || !secrets.length) return { ok: false, why: !secrets.length ? 'no secret configured on the server' : 'no signature header' }
  // The URL CCC signed is the one it called; behind Catalyst's gateway we see a
  // rewritten path, so try the public form and what the request itself says.
  const host = req.headers['x-forwarded-host'] || req.get('host') || ''
  const path = req.originalUrl || req.url || ''
  const urls = [...new Set([
    `${PUBLIC_BASE}${path.replace(/^\/server\/adasiq-api/, '')}`,
    `https://${host}${path}`,
    `https://${host}/server/adasiq-api${path.replace(/^\/server\/adasiq-api/, '')}`,
  ])]
  const body200 = String(raw || '').slice(0, 200)
  for (const secret of secrets) for (const u of urls) {
    const want = crypto.createHmac('sha1', Buffer.from(secret, 'utf8')).update(u + body200, 'utf8').digest('base64')
    if (want.length === got.length && crypto.timingSafeEqual(Buffer.from(want), Buffer.from(got))) return { ok: true, url: u }
  }
  return { ok: false, why: 'signature did not match', tried: urls }
}

async function inboxFolder(token) {
  if (_inboxId) return _inboxId
  const { listChildren, createFolderUnder, JOB_PARENT_FOLDER_ID } = await import('../services/workdrive.js')
  const kids = await listChildren(JOB_PARENT_FOLDER_ID, token, { folders: true }).catch(() => [])
  _inboxId = kids.find(k => k.name === 'CCC Inbox')?.id || (await createFolderUnder(JOB_PARENT_FOLDER_ID, 'CCC Inbox', token))?.folderId || ''
  return _inboxId
}

export async function cccEstimateWebhook(req, res) {
  // CCC's "Test connection" and uptime checks.
  if (req.method === 'GET' || req.method === 'HEAD') return res.status(200).json({ ok: true, app: 'Absolute ADAS', appId: APP_ID })
  const raw = typeof req.body === 'string' ? req.body : Buffer.isBuffer(req.body) ? req.body.toString('utf8') : ''
  const sig = signatureOk(req, raw, await loadSecrets(req))
  if (!sig.ok) {
    console.warn(`[ccc] rejected: ${sig.why}${sig.tried ? ` · tried ${sig.tried.join(' | ')}` : ''}`)
    return res.status(401).json({ error: sig.why })
  }
  if (req.query.appId && String(req.query.appId) !== APP_ID) console.warn(`[ccc] unexpected appId ${req.query.appId}`)
  if (!/VehicleDamageEstimateAddRq/.test(raw)) return res.status(200).json({ ok: true, ignored: 'not an estimate message' })
  try {
    const { parseBms } = await import('../services/cccScrub.js')
    const e = parseBms(raw)
    const hash = crypto.createHash('sha1').update(raw).digest('hex')
    const { getAccessToken } = await import('../services/zoho.js'); const token = await getAccessToken()
    const { uploadFileToFolder } = await import('../services/workdrive.js')
    const folder = await inboxFolder(token)
    if (!folder) throw new Error('no CCC Inbox folder')
    const safe = s => String(s || '').replace(/[^A-Za-z0-9 _.-]/g, '').trim()
    const name = `${safe(e.ro) || 'noRO'} ${safe([e.year, e.make, e.model].join(' '))} ${e.verCode === 'SV' ? `S${e.version}` : 'EM'} ${String(req.query.trigger || '')} ${hash.slice(0, 8)}.xml`.replace(/\s+/g, ' ')
    const up = await uploadFileToFolder(folder, name, Buffer.from(redactBms(raw), 'utf8'), token, 'application/xml')
    const { enqueue } = await import('../services/scrubQueue.js')
    const q = await enqueue(req, { key: `ccc:${hash}`, file: up?.fileId || '', name, source: 'ccc', by: e.shop || 'CCC', priority: 1 })
    console.log(`[ccc] ${req.query.trigger || '?'} · ${e.shop} · RO ${e.ro} · ${e.lines.length} lines · ${q.existed ? 'duplicate (already queued)' : 'queued'}`)
    // ⚡ Start a scrubber now instead of waiting for the next dispatcher round.
    // The request has to leave before we answer (Catalyst can freeze us after
    // the response); the worker runs on its own invocation. If it doesn't get
    // going, the 2-minute dispatcher picks the row up anyway — nothing is lost.
    if (!q.existed) {
      try {
        const axios = (await import('axios')).default
        const kick = axios.post(`${PUBLIC_BASE}/api/crm-sync-cron/scrub-worker?w=ccc${Date.now().toString(36)}`, {}, { headers: { 'x-cron-secret': process.env.CRM_SYNC_CRON_SECRET || 'crm-sync-2026' }, timeout: 20000 }).catch(() => null)
        await Promise.race([kick, new Promise(r => setTimeout(r, 1500))])
      } catch { /* the dispatcher has it */ }
    }
    return res.status(200).json({ ok: true, queued: !q.existed })
  } catch (err) {
    console.error('[ccc] could not save the estimate — CCC will retry:', err.message)
    return res.status(500).json({ error: 'temporarily unable to accept; please retry' })
  }
}

// ── Owner-only settings (the "CCC Secure Share" screen) ──────────────────────
export const cccAdminRouter = express.Router()
const isOwner = req => ['mark@absoluteadas.com', 'mf@absoluteadas.com', 'mfowler4456@gmail.com'].includes(String(req.user?.email || '').toLowerCase()) || req.user?.role === 'owner'
cccAdminRouter.get('/status', async (req, res) => {
  if (!isOwner(req)) return res.status(403).json({ error: 'Owner only' })
  const [sb, pr] = await Promise.all([readCfg(req, cfgKey('sandbox')), readCfg(req, cfgKey('production'))])
  let recent = []
  try { const rows = await catalyst.initialize(req, { type: 'advancedio' }).zcql().executeZCQLQuery(`SELECT sj_name, sj_status, sj_error, CREATEDTIME, sj_ms FROM AdasScrubJobs WHERE sj_source = 'ccc' ORDER BY CREATEDTIME DESC LIMIT 15`); recent = rows.map(r => r.AdasScrubJobs) } catch { /* table empty */ }
  res.json({ webhook: `${PUBLIC_BASE}/api/ccc`, appId: APP_ID, sandbox: !!(sb.value || process.env.CCC_SECURESHARE_SECRET_SANDBOX), production: !!(pr.value || process.env.CCC_SECURESHARE_SECRET), recent })
})
cccAdminRouter.post('/secret', express.json(), async (req, res) => {
  if (!isOwner(req)) return res.status(403).json({ error: 'Owner only' })
  const env = req.body?.env === 'production' ? 'production' : 'sandbox'
  const secret = String(req.body?.secret || '').trim()
  if (secret.length < 16) return res.status(400).json({ error: 'Use at least 16 characters (30+ is better).' })
  const cur = await readCfg(req, cfgKey(env))
  const t = catalyst.initialize(req, { type: 'advancedio' }).datastore().table('AppConfig')
  const sealed = sealSecret(secret)
  if (cur.row) await t.updateRow({ ROWID: cur.row, config_key: cfgKey(env), config_value: sealed }); else await t.insertRow({ config_key: cfgKey(env), config_value: sealed })
  _sec.at = 0
  console.log(`[ccc] ${env} secret set by ${req.user?.email || '?'}`)   // never log the value
  res.json({ ok: true, env })
})
