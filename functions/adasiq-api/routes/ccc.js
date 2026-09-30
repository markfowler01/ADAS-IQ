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

function signatureOk(req, raw) {
  const got = String(req.headers['x-secureshare-signature'] || '').trim()
  const secrets = [process.env.CCC_SECURESHARE_SECRET, process.env.CCC_SECURESHARE_SECRET_SANDBOX].filter(Boolean)
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
  const sig = signatureOk(req, raw)
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
    const up = await uploadFileToFolder(folder, name, Buffer.from(raw, 'utf8'), token, 'application/xml')
    const { enqueue } = await import('../services/scrubQueue.js')
    const q = await enqueue(req, { key: `ccc:${hash}`, file: up?.fileId || '', name, source: 'ccc', by: e.shop || 'CCC', priority: 1 })
    console.log(`[ccc] ${req.query.trigger || '?'} · ${e.shop} · RO ${e.ro} · ${e.lines.length} lines · ${q.existed ? 'duplicate (already queued)' : 'queued'}`)
    return res.status(200).json({ ok: true, queued: !q.existed })
  } catch (err) {
    console.error('[ccc] could not save the estimate — CCC will retry:', err.message)
    return res.status(500).json({ error: 'temporarily unable to accept; please retry' })
  }
}
