// 🗑 Job trash (Mark 2026-10-29: "this is really important for my business so I need you to
// create a system that this can never happen again"). An hourly invoice re-check deleted live
// cards — the Stanwood Gerber BMW M2 dispatched to Jayden, Northwest Diesel — and a deleted
// Datastore row is gone for good. Now nothing is hard-deleted:
//   1. every removal copies the full row here first (DurableKV `job_trash:<id>`, kept 90 days)
//   2. automation may only remove an invoiced card matched EXACTLY; live work needs a person
//   3. more than MAX_AUTO automatic removals in one run → stop and alert
//   4. every automatic removal is posted to #dispatch with a Restore link
import catalyst from 'zcatalyst-sdk-node'
import { kvGet, kvSet, kvDelete } from './durableKV.js'

export const KEEP_DAYS = 90
export const MAX_AUTO = 3
const PREFIX = 'job_trash:'
const EXACT = new Set(['vin', 'ro', 'invoice', 'estimate'])
const app = req => catalyst.initialize(req, { type: 'advancedio' })
const SYSTEM_COLS = new Set(['ROWID', 'CREATORID', 'CREATEDTIME', 'MODIFIEDTIME'])

/** Is a person doing this? Webhooks, crons and syncs have no signed-in user. */
export const isPerson = req => !!(req?.user?.email || req?.user?.name)
export const whoOf = req => req?.user?.techName || req?.user?.name || req?.user?.email || 'automation'

/**
 * The rule automation lives under. `match` is how the card was tied to the event:
 * vin | ro | invoice | estimate (exact keys), invoiced (the card's own invoiced flag), name (weak).
 */
export function checkAutoRemove(job, { reason, match } = {}) {
  if (!job) return { ok: false, why: 'card not found' }
  if (match === 'name') return { ok: false, why: 'matched by shop name only' }
  if (reason === 'estimate_closed') {
    return match === 'estimate' && ['job_requested', 'need_dispatch'].includes(job.status)
      ? { ok: true } : { ok: false, why: `estimate closed but the card is ${String(job.status || '').replace(/_/g, ' ')}` }
  }
  if (job.invoiced === true && (EXACT.has(match) || match === 'invoiced')) return { ok: true }
  if (reason === 'invoice_sent' && EXACT.has(match)) return { ok: true }   // the invoice itself is the proof
  return { ok: false, why: 'automation can only remove an invoiced card matched exactly' }
}

/** Copy the full row into the trash. Throws if it can't — the caller must not delete then. */
export async function trashRow(req, row, job, meta) {
  const id = String(row.ROWID)
  const entry = {
    id, at: new Date().toISOString(), by: meta.by, auto: !!meta.auto, reason: meta.reason || '', match: meta.match || '',
    detail: String(meta.detail || '').slice(0, 300),
    summary: { shop: job.shop_name || '', vehicle: job.vehicle || [job.year, job.make, job.model].filter(Boolean).join(' '), status: job.status || '',
      technician: job.technician || '', ro: job.quote_number || job.invoice_number || '', vin: job.vin || '', invoiced: !!job.invoiced },
    row: Object.fromEntries(Object.entries(row).filter(([k]) => !SYSTEM_COLS.has(k))),
    created: row.CREATEDTIME || '',
  }
  await kvSet(app(req), PREFIX + id, JSON.stringify(entry))
  const back = await kvGet(app(req), PREFIX + id)
  if (!back) throw new Error('trash write did not stick')
  return entry
}

export async function readTrash(req, id) {
  try { const v = await kvGet(app(req), PREFIX + id); return v ? JSON.parse(v) : null } catch { return null }
}

/** Newest first, summaries only (no full rows). Prunes entries past KEEP_DAYS. */
export async function listTrash(req) {
  const z = app(req).zcql(), keys = new Set()
  for (let off = 0; off < 6000; off += 300) {
    const r = await z.executeZCQLQuery(`SELECT kv_key FROM DurableKV WHERE kv_key LIKE '${PREFIX}*' AND kv_part = 0 LIMIT ${off}, 300`)
    const batch = (r || []).map(x => x.DurableKV?.kv_key).filter(Boolean)
    batch.forEach(k => keys.add(k))
    if (batch.length < 300) break
  }
  const cutoff = Date.now() - KEEP_DAYS * 864e5, out = []
  for (const k of keys) {
    const e = await readTrash(req, k.slice(PREFIX.length))
    if (!e) continue
    if (Date.parse(e.at) < cutoff) { await kvDelete(app(req), k).catch(() => {}); continue }
    const { row, ...rest } = e
    out.push(rest)
  }
  return out.sort((a, b) => String(b.at).localeCompare(String(a.at)))
}

/** Put the row back. New ROWID (Catalyst assigns it); the trash entry is removed. */
export async function restoreFromTrash(req, id) {
  const e = await readTrash(req, id)
  if (!e) throw Object.assign(new Error('Not in the trash (or older than 90 days)'), { status: 404 })
  const inserted = await app(req).datastore().table('Jobs').insertRow({ ...e.row })
  await kvDelete(app(req), PREFIX + id)
  console.log(`[job trash] restored ${id} → ${inserted.ROWID} (${e.summary.shop} ${e.summary.vehicle}) by ${whoOf(req)}`)
  return { old_id: id, id: String(inserted.ROWID), summary: e.summary }
}

const restoreLink = () => `${(process.env.CLIENT_URL || 'https://adas-iq-904191467.development.catalystserverless.com/app/index.html').split('?')[0]}?trash=1`
const REASONS = { invoice_sent: 'invoice sent', estimate_closed: 'quote closed in Books', clean_invoiced: 'Clean Out', cleanup: 'cleanup', quote_dead: 'quote marked dead', manual: 'deleted on the board' }
export const reasonText = r => REASONS[r] || r || 'removed'

export async function announceRemoval(entry) {
  const s = entry.summary
  const msg = `🗑 *Taken off the board* · ${s.shop}${s.vehicle ? ' · ' + s.vehicle : ''}\n` +
    `Why: ${reasonText(entry.reason)}${entry.match ? ` (matched by ${entry.match})` : ''}${entry.detail ? ` · ${entry.detail}` : ''}\n` +
    `Wrong? Restore it in one tap: ${restoreLink()}`
  try { const { postToCliqChannel, DISPATCH_CHANNEL } = await import('./cliq.js'); await postToCliqChannel(DISPATCH_CHANNEL, msg) }
  catch (e) { console.log('[job trash] announce failed:', e.message) }
}

export async function announceBlocked(req, job, meta, why) {
  // One post per card per reason per day — the hourly sweep must not spam #dispatch.
  const key = `job_block:${job.id}:${meta.reason || ''}:${new Date().toISOString().slice(0, 10)}`.slice(0, 64)
  try { if (await kvGet(app(req), key)) return; await kvSet(app(req), key, '1') } catch { /* post anyway */ }
  const msg = `🛑 *Kept on the board* · ${job.shop_name || 'Job'}${job.vehicle ? ' · ' + job.vehicle : ''} (${String(job.status || '').replace(/_/g, ' ')})\n` +
    `Automation wanted to remove it (${reasonText(meta.reason)}${meta.match ? `, matched by ${meta.match}` : ''}) but ${why}. If it's really done, remove it by hand.`
  console.log(`[job trash] BLOCKED ${job.id}: ${why}`)
  try { const { postToCliqChannel, DISPATCH_CHANNEL } = await import('./cliq.js'); await postToCliqChannel(DISPATCH_CHANNEL, msg) }
  catch (e) { console.log('[job trash] block announce failed:', e.message) }
}

export async function announceRunStopped(req, count) {
  const key = `job_runstop:${new Date().toISOString().slice(0, 13)}`
  try { if (await kvGet(app(req), key)) return; await kvSet(app(req), key, '1') } catch { /* post anyway */ }
  const msg = `🛑 *Automation stopped* — one run tried to remove more than ${MAX_AUTO} cards (${count}+). Nothing past ${MAX_AUTO} was removed. Mark, take a look before anything else comes off: ${restoreLink()}`
  console.log(`[job trash] RUN STOPPED after ${MAX_AUTO} removals`)
  try { const { postToCliqChannel, DISPATCH_CHANNEL } = await import('./cliq.js'); await postToCliqChannel(DISPATCH_CHANNEL, msg) }
  catch (e) { console.log('[job trash] runstop announce failed:', e.message) }
}
