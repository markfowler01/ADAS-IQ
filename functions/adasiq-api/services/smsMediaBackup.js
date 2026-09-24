// 📷 Texted pictures, kept (Mark 2026-09-24: "make sure the pics are all
// backed up in data store also").
//
// Until now an MMS photo lived only on Twilio: the message row carried a URL,
// and the app fetched it on demand. Twilio expires its own media, so a shop's
// damage photo from a few months back would quietly 404.
//
// Now every picture is copied into WorkDrive (where all our other files live)
// and the file ids are written to sms_threads.media_files, so the Datastore
// row is the durable record. The viewer falls back to the WorkDrive copy the
// moment Twilio's is gone.
import axios from 'axios'
import catalyst from 'zcatalyst-sdk-node'

const TABLE = 'sms_threads'
const FOLDER_KEY = 'sms_media_folder_id'
const MAX_BYTES = 16 * 1024 * 1024

async function cfgGet(req, key) {
  try { const r = await catalyst.initialize(req, { type: 'advancedio' }).zcql().executeZCQLQuery(`SELECT ROWID, config_value FROM AppConfig WHERE config_key = '${key}' LIMIT 1`); const x = r?.[0]?.AppConfig; return x ? { row: String(x.ROWID), value: x.config_value } : { row: null, value: '' } } catch { return { row: null, value: '' } }
}
async function cfgPut(req, key, row, value) {
  const t = catalyst.initialize(req, { type: 'advancedio' }).datastore().table('AppConfig')
  if (row) await t.updateRow({ ROWID: row, config_key: key, config_value: value }); else await t.insertRow({ config_key: key, config_value: value })
}

/** One WorkDrive folder for every texted picture, made once and remembered. */
async function mediaFolderId(req, wdToken) {
  const { row, value } = await cfgGet(req, FOLDER_KEY)
  if (value) return value
  const { createJobFolder } = await import('./workdrive.js')
  const made = await createJobFolder('SMS Photos — texted pictures', wdToken)
  const id = made?.folderId || ''
  if (id) await cfgPut(req, FOLDER_KEY, row, id)
  return id
}

const extFor = t => ({ 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/heic': 'heic', 'image/webp': 'webp', 'video/mp4': 'mp4', 'application/pdf': 'pdf' })[String(t || '').toLowerCase()] || 'bin'

/**
 * Copy one message's pictures into WorkDrive and stamp the ids on its
 * Datastore row. Never throws — a failed backup must not break a text.
 * @returns {Promise<{saved:number, files:Array}>}
 */
export async function backupMessageMedia(req, { message_sid, media = [], cfg, conversation = null }) {
  const out = { saved: 0, files: [], skipped: '' }
  const items = (media || []).filter(m => m && (m.url || m.sid))
  if (!items.length) { out.skipped = 'no media'; return out }
  try {
    const { getAccessToken } = await import('./zoho.js')
    const { uploadFileToFolder } = await import('./workdrive.js')
    const wdToken = await getAccessToken()
    const folderId = await mediaFolderId(req, wdToken)
    if (!folderId) { out.skipped = 'no WorkDrive folder'; return out }

    for (let i = 0; i < items.length; i++) {
      const m = items[i]
      try {
        let buffer, contentType = m.contentType || ''
        if (m.url) {
          const r = await axios.get(m.url, { auth: { username: cfg.TWILIO_ACCOUNT_SID, password: cfg.TWILIO_AUTH_TOKEN }, responseType: 'arraybuffer', timeout: 25000, maxRedirects: 5, maxContentLength: MAX_BYTES })
          buffer = Buffer.from(r.data); contentType = contentType || r.headers['content-type'] || ''
        } else if (m.sid && conversation) {
          const { fetchConversationMedia } = await import('./conversations.js')
          const got = await fetchConversationMedia(cfg, conversation, m.sid)
          buffer = got?.buffer; contentType = contentType || got?.contentType || ''
        }
        if (!buffer || buffer.length < 64) continue
        const name = `${String(message_sid || 'msg').replace(/[^\w-]/g, '')}-${i}.${extFor(contentType)}`
        const { fileId } = await uploadFileToFolder(folderId, name, buffer, wdToken, contentType || 'application/octet-stream')
        out.files.push({ fileId, name, type: contentType, bytes: buffer.length })
        out.saved++
      } catch (e) { console.warn(`[sms-media] ${message_sid}[${i}] backup failed:`, e.message) }
    }
    if (out.files.length) await stampRow(req, message_sid, out.files)
  } catch (e) { out.skipped = e.message; console.warn('[sms-media] backup failed:', e.message) }
  return out
}

/** Write the file ids onto the message's Datastore row. */
async function stampRow(req, message_sid, files) {
  try {
    const app = catalyst.initialize(req, { type: 'advancedio' })
    const rows = await app.zcql().executeZCQLQuery(`SELECT ROWID FROM ${TABLE} WHERE message_sid = '${String(message_sid).replace(/'/g, "''")}' LIMIT 1`)
    const rowid = rows?.[0]?.[TABLE]?.ROWID
    if (!rowid) return
    await app.datastore().table(TABLE).updateRow({ ROWID: String(rowid), media_files: JSON.stringify(files).slice(0, 9800) })
  } catch (e) { console.warn('[sms-media] stamp failed:', e.message) }
}

/** The backed-up copies for a message, if any. */
export async function backedUpMedia(req, message_sid) {
  try {
    const rows = await catalyst.initialize(req, { type: 'advancedio' }).zcql().executeZCQLQuery(`SELECT media_files FROM ${TABLE} WHERE message_sid = '${String(message_sid).replace(/'/g, "''")}' LIMIT 1`)
    const raw = rows?.[0]?.[TABLE]?.media_files
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

/**
 * Catch up anything sent before the backup existed. One page per call so the
 * 30s gateway cap can't kill it mid-file.
 */
export async function backfillSmsMedia(req, { limit = 5 } = {}) {
  const out = { looked: 0, saved: 0, messages: [], left: 0 }
  const { resolvePhoneConfig } = await import('./phoneConfig.js')
  const cfg = await resolvePhoneConfig(req)
  const t0 = Date.now()
  // Twilio is the only place that still knows which messages carried media.
  // Newest 1000 — today's test traffic buries anything older at PageSize=100.
  const r = await axios.get(`https://api.twilio.com/2010-04-01/Accounts/${cfg.TWILIO_ACCOUNT_SID}/Messages.json?PageSize=1000`, { auth: { username: cfg.TWILIO_ACCOUNT_SID, password: cfg.TWILIO_AUTH_TOKEN }, timeout: 25000 })
  const withMedia = (r.data?.messages || []).filter(m => Number(m.num_media || 0) > 0)
  out.scanned = (r.data?.messages || []).length
  out.looked = withMedia.length
  for (const m of withMedia) {
    if (out.saved >= limit || Date.now() - t0 > 20000) { out.left = withMedia.length - out.messages.length; break }
    const already = await backedUpMedia(req, m.sid)
    if (already.length) continue
    const list = await axios.get(`https://api.twilio.com${m.subresource_uris?.media || `/2010-04-01/Accounts/${cfg.TWILIO_ACCOUNT_SID}/Messages/${m.sid}/Media.json`}`, { auth: { username: cfg.TWILIO_ACCOUNT_SID, password: cfg.TWILIO_AUTH_TOKEN }, timeout: 20000, validateStatus: () => true })
    const media = (list.data?.media_list || []).map(x => ({ url: `https://api.twilio.com${x.uri.replace(/\.json$/, '')}`, contentType: x.content_type }))
    if (!media.length) continue
    const b = await backupMessageMedia(req, { message_sid: m.sid, media, cfg })
    if (b.saved) { out.saved += b.saved; out.messages.push({ sid: m.sid, from: m.from, saved: b.saved }) }
  }
  return out
}
