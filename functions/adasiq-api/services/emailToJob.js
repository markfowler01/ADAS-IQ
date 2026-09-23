// 📧 Email → Job Request (Mark 2026-09-23: "the next step of this is I want
// to do this with email also"). Hourly: unread inbox mail at mark@ + info@
// from senders who are CRM shop contacts → same extractor as texts → Job
// Requested card marked "via email". Mail is never marked read or moved;
// processed message ids are stamped in AppConfig so nothing runs twice.
import catalyst from 'zcatalyst-sdk-node'
import { getMailAccessToken, getMailAccountIdFor, getUnreadInboxMessages, getMessageContent } from './mail.js'
import { maybeCreateJobsFromText } from './textToJob.js'

const KEY = 'email2job_done'
const INBOXES = ['mark@absoluteadas.com', 'info@absoluteadas.com']
const MAX_AGE_MS = 3 * 24 * 3600 * 1000

const normEmail = e => String(e || '').toLowerCase().replace(/^.*<([^>]+)>.*$/, '$1').trim()
export function buildEmailIndex(shops) {
  const idx = new Map()
  for (const shop of shops || []) {
    const fallback = (shop.contact_name || '').trim() || ((shop.people || []).map(p => (p?.name || '').trim()).find(Boolean) || '')
    const main = normEmail(shop.email)
    if (main && !idx.has(main)) idx.set(main, { contact_name: fallback, shop_name: shop.shop_name || '', shop_id: shop.id, email: main })
    for (const p of shop.people || []) { const e = normEmail(p?.email); if (e && !idx.has(e)) idx.set(e, { contact_name: (p.name || '').trim() || fallback, shop_name: shop.shop_name || '', shop_id: shop.id, email: e }) }
  }
  return idx
}
const stripHtml = h => String(h || '').replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, '').replace(/<br\s*\/?>|<\/p>|<\/div>|<\/tr>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim()
// Drop quoted replies / signatures so the extractor reads the new part only.
const newPart = t => String(t).split(/\n(?:On .{5,80} wrote:|From: |-----Original Message-----|> )/)[0].trim()

async function readDone(req) {
  try { const rows = await catalyst.initialize(req, { type: 'advancedio' }).zcql().executeZCQLQuery(`SELECT ROWID, config_value FROM AppConfig WHERE config_key = '${KEY}' LIMIT 1`); const r = rows?.[0]?.AppConfig; return r ? { row: String(r.ROWID), ids: new Set(JSON.parse(r.config_value || '[]')) } : { row: null, ids: new Set() } } catch { return { row: null, ids: new Set() } }
}
async function writeDone(req, row, ids) {
  const t = catalyst.initialize(req, { type: 'advancedio' }).datastore().table('AppConfig'); const value = JSON.stringify([...ids].slice(-400))
  if (row) await t.updateRow({ ROWID: row, config_key: KEY, config_value: value }); else await t.insertRow({ config_key: KEY, config_value: value })
}

// Off until Mark has seen a dry run (AppConfig email2job_enabled = 'true' turns it on).
async function emailToJobEnabled(req) {
  try { const rows = await catalyst.initialize(req, { type: 'advancedio' }).zcql().executeZCQLQuery(`SELECT config_value FROM AppConfig WHERE config_key = 'email2job_enabled' LIMIT 1`); return String(rows?.[0]?.AppConfig?.config_value || '') === 'true' } catch { return false }
}
export async function sweepEmailToJob(req, { dry = false, maxPerRun = 6 } = {}) {
  const out = { checked: 0, matched: 0, created: 0, appended: 0, flagged: 0, dry, items: [] }
  if (!dry && !(await emailToJobEnabled(req))) { out.skipped = 'email2job_enabled is not true'; return out }
  const token = await getMailAccessToken()
  const { getAllShops } = await import('../routes/shops.js')
  const idx = buildEmailIndex(await getAllShops(req))
  const jobsMod = await import('../routes/jobs.js')
  const jobs = { findOpenRequestFor: jobsMod.findOpenRequestFor, insertJob: jobsMod.insertJob, updateJob: jobsMod.updateJob, readAll: jobsMod.readJobsPublic }
  const { row, ids } = await readDone(req)
  const seenAccounts = new Set()
  let budget = maxPerRun
  for (const inbox of INBOXES) {
    let accountId; try { accountId = await getMailAccountIdFor(token, inbox) } catch (e) { console.log('[email→job] no account for', inbox, e.message); continue }
    if (seenAccounts.has(accountId)) continue; seenAccounts.add(accountId)
    let msgs = []; try { msgs = await getUnreadInboxMessages(token, accountId) } catch (e) { console.log('[email→job] inbox read failed', inbox, e.message); continue }
    for (const m of msgs) {
      out.checked++
      const id = String(m.messageId || ''); if (!id || ids.has(id)) continue
      const from = normEmail(m.fromAddress || m.sender || '')
      const contact = idx.get(from); if (!contact) continue
      const age = Date.now() - Number(m.receivedTime || 0); if (Number.isFinite(age) && age > MAX_AGE_MS) { ids.add(id); continue }
      if (budget-- <= 0) break
      out.matched++
      let text = String(m.summary || '')
      try { const c = await getMessageContent(token, accountId, m.folderId, id); const body = newPart(stripHtml(c.content || c.body || '')); if (body.length > text.length) text = body } catch { /* summary is enough */ }
      const subject = String(m.subject || '').trim()
      const combined = `${subject ? subject + '\n' : ''}${text}`.slice(0, 1500)
      if (!dry) ids.add(id)
      const r = await maybeCreateJobsFromText(req, { from, body: combined, contact, lineType: 'email', jobs, channel: 'email', dry, subject })
      out.created += r.created?.length || 0; out.appended += r.appended?.length || 0; if (r.flagged) out.flagged++
      out.items.push({ inbox, from, who: `${contact.contact_name} @ ${contact.shop_name}`, subject, skipped: r.skipped || '', extraction: r.extraction || null, created: r.created || [], appended: r.appended || [] })
    }
  }
  if (!dry) await writeDone(req, row, ids)
  console.log(`[email→job] checked ${out.checked}, matched ${out.matched}, created ${out.created}, appended ${out.appended}, flagged ${out.flagged}${dry ? ' (dry)' : ''}`)
  return out
}
