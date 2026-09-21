// WorkDrive folder cleanup (Mark 2026-09-21: "a tool that searches for
// WorkDrive folders that are for the same vehicle and combines them").
// Two folders for one car happen when the photo path and the report path
// each create one, or when an RO is typed two ways. Owner-only.
//
//   GET  /scan   → groups of job folders that look like the same vehicle
//                  (RO digits first, then shop + vehicle words), with the
//                  Jobs-table cards that point at each. Nothing changes.
//   POST /merge  → { keep_id, drop_ids[] }: move every file out of each
//                  drop folder into keep (renaming on a name clash), trash
//                  the emptied folder, repoint any Jobs card at keep.
//                  One group per call, explicit ids — Mark presses it.
import express from 'express'
import catalyst from 'zcatalyst-sdk-node'
import { getAccessToken } from '../services/zoho.js'
import { listChildren, moveFile, renameFile, trashFile, JOB_PARENT_FOLDER_ID } from '../services/workdrive.js'

const router = express.Router()
const MARK_EMAILS = ['mark@absoluteadas.com', 'mf@absoluteadas.com', 'mfowler4456@gmail.com']
const isOwner = req => MARK_EMAILS.includes(String(req.user?.email || '').toLowerCase()) || req.user?.role === 'owner'

// Folder names come in two styles: the app's "18892 — Shop — 2016 Ram 1500"
// and the older hand-made "CMP 2012 Chevrolet Volt". A model year or a
// "1500" is NOT an RO, so the RO key only takes a leading RO-looking token
// (digits, or letters+digits like MR551905) that isn't a plausible year.
const YEAR = /\b(19[89]\d|20[0-3]\d)\b/
const isYear = t => /^(19[89]\d|20[0-3]\d)$/.test(t)
export const roOf = name => { const m = String(name).trim().match(/^([A-Za-z]{0,3}\d{4,})\b/); const t = m ? m[1] : ''; return t && !isYear(t.replace(/^[A-Za-z]+/, '')) ? t.replace(/^[A-Za-z]+/, '') : '' }
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
// Same car = same shop (first word) + year + make + model. Shop is the
// middle segment of "RO — Shop — Vehicle", else whatever precedes the year.
export const vehKey = name => {
  const n = String(name || '')
  const y = (n.match(YEAR) || [''])[0]
  if (!y) return ''
  const parts = n.split(/\s+[—–-]\s+/)
  let shop = '', veh = ''
  if (parts.length >= 3) { shop = parts[1]; veh = parts.slice(2).join(' ') }
  else { const i = n.indexOf(y); shop = n.slice(0, i); veh = n.slice(i) }
  // Shop key: first word when it's a real word (avon, showcase, mindy), the
  // first two when they're initials (b h, l m) — so B&H and L-M stay apart.
  const st = norm(shop).split(' ').filter(w => w && !STOP.has(w))
  const shopKey = st.length ? (st[0].length >= 4 ? st[0] : st.slice(0, 2).join(' ')) : norm(shop).slice(0, 8)
  const vw = norm(veh).split(' ').filter(Boolean)
  const yi = vw.indexOf(y)
  const make = vw[yi + 1] || ''
  const model = vw[yi + 2] ? (vw[yi + 2].length === 1 && vw[yi + 3] ? `${vw[yi + 2]} ${vw[yi + 3]}` : vw[yi + 2]) : ''   // "f 150" stays whole
  if (!make) return ''
  return `${shopKey}|${y} ${make}${model ? ' ' + model : ''}`
}
const STOP = new Set(['the', 'and', 'of', 'inc', 'llc', 'ltd', 'co'])
const isBackup = name => /backup/i.test(String(name || ''))

/** Jobs cards keyed by the folder id they point at. */
async function cardsByFolder(req) {
  const app = catalyst.initialize(req, { type: 'advancedio' })
  const out = new Map()
  const add = (fid, card) => { if (!fid) return; const list = out.get(fid) || []; list.push(card); out.set(fid, list) }
  for (let off = 0; ; off += 300) {
    const rows = await app.zcql().executeZCQLQuery(`SELECT ROWID, shop_name, vehicle, status, invoice_number, quote_number, folder_url, photo_slots FROM Jobs LIMIT ${off}, 300`).catch(() => [])
    const batch = (rows || []).map(r => r.Jobs || r)
    for (const j of batch) {
      const card = { id: String(j.ROWID), shop: j.shop_name || '', vehicle: j.vehicle || '', status: j.status || '', ro: j.invoice_number || j.quote_number || '' }
      const m = String(j.folder_url || '').match(/workdrive\.zoho\.com\/(?:folder|home[^ ]*?\/folders)\/([a-z0-9]+)/i)
      if (m) add(m[1], card)
      try { const fid = JSON.parse(j.photo_slots || '{}')?._folder_id; if (fid && fid !== m?.[1]) add(fid, card) } catch { /* ignore */ }
    }
    if (batch.length < 300) break
  }
  return out
}

router.get('/scan', async (req, res) => {
  try {
    if (!isOwner(req)) return res.status(403).json({ error: 'Owners only' })
    const token = await getAccessToken()
    const [folders, cards] = await Promise.all([listChildren(JOB_PARENT_FOLDER_ID, token, { folders: true }), cardsByFolder(req)])
    const groups = new Map()
    const put = (key, kind, f) => { if (!key) return; const g = groups.get(key) || { key, kind, folders: [] }; if (!g.folders.some(x => x.id === f.id)) g.folders.push(f); groups.set(key, g) }
    const decorated = folders.filter(f => !isBackup(f.name)).map(f => ({ ...f, ro: roOf(f.name), veh: vehKey(f.name), cards: cards.get(f.id) || [] })).filter(f => f.ro || f.veh)
    for (const f of decorated) put(f.ro ? `ro:${f.ro}` : '', 'ro', f)
    // Same shop + vehicle words with no RO in common (or no RO at all).
    for (const f of decorated) if (f.veh) put(`veh:${f.veh}`, 'vehicle', f)
    const out = []
    const seenPair = new Set()
    for (const g of groups.values()) {
      if (g.folders.length < 2) continue
      // Same car under two different ROs is usually a return visit — not a
      // duplicate. A vehicle group only counts when its folders share one RO
      // (or some have none).
      if (g.kind === 'vehicle') { const ros = new Set(g.folders.map(f => f.ro).filter(Boolean)); if (ros.size > 1) continue }
      const sig = g.folders.map(f => f.id).sort().join('|')
      if (seenPair.has(sig)) continue
      seenPair.add(sig)
      // Suggested keeper: the one a card points at, else the one with the most files, else the oldest.
      const keep = [...g.folders].sort((a, b) => (b.cards.length - a.cards.length) || ((b.files_count || 0) - (a.files_count || 0)) || ((a.created || 0) - (b.created || 0)))[0]
      out.push({ key: g.key, kind: g.kind, label: g.kind === 'ro' ? `RO ${g.key.slice(3)}` : g.key.slice(4).replace('|', ' · '), keep_id: keep.id, folders: g.folders.map(f => ({ id: f.id, name: f.name, files: f.files_count, created: f.created ? new Date(Number(f.created)).toISOString().slice(0, 10) : '', cards: f.cards })) })
    }
    out.sort((a, b) => (a.kind === 'ro' ? 0 : 1) - (b.kind === 'ro' ? 0 : 1) || a.key.localeCompare(b.key))
    console.log(`[wd-cleanup] scanned ${folders.length} job folders → ${out.length} duplicate group(s)`)
    res.json({ ok: true, scanned: folders.length, groups: out })
  } catch (e) { console.error('[wd-cleanup scan]', e.message); res.status(500).json({ error: e.message }) }
})

router.post('/merge', async (req, res) => {
  try {
    if (!isOwner(req)) return res.status(403).json({ error: 'Owners only' })
    const keep = String(req.body?.keep_id || '').trim()
    const drops = (Array.isArray(req.body?.drop_ids) ? req.body.drop_ids : []).map(String).filter(id => id && id !== keep)
    if (!keep || !drops.length) return res.status(400).json({ error: 'keep_id and drop_ids required' })
    const token = await getAccessToken()
    const existing = new Set((await listChildren(keep, token)).map(f => f.name.toLowerCase()))
    const moved = [], failed = [], trashed = []
    for (const drop of drops) {
      const items = await listChildren(drop, token)
      for (const it of items) {
        try {
          let name = it.name
          if (existing.has(name.toLowerCase())) {
            const m = name.match(/^(.*?)(\.[a-z0-9]+)?$/i); name = `${m[1]} (from duplicate)${m[2] || ''}`
            await renameFile(it.id, name, token)
          }
          await moveFile(it.id, keep, token)
          existing.add(name.toLowerCase()); moved.push({ id: it.id, name })
        } catch (e) { failed.push({ id: it.id, name: it.name, error: e.message }) }
      }
      const left = await listChildren(drop, token)
      if (!left.length) { try { await trashFile(drop, token); trashed.push(drop) } catch (e) { failed.push({ id: drop, name: '(folder)', error: e.message }) } }
    }
    // Repoint any card that referenced a dropped folder.
    let repointed = 0
    try {
      const app = catalyst.initialize(req, { type: 'advancedio' })
      const table = app.datastore().table('Jobs')
      for (let off = 0; ; off += 300) {
        const rows = await app.zcql().executeZCQLQuery(`SELECT ROWID, folder_url, photo_slots FROM Jobs LIMIT ${off}, 300`).catch(() => [])
        const batch = (rows || []).map(r => r.Jobs || r)
        for (const j of batch) {
          let changed = false
          const patch = { ROWID: String(j.ROWID) }
          const m = String(j.folder_url || '').match(/workdrive\.zoho\.com\/(?:folder|home[^ ]*?\/folders)\/([a-z0-9]+)/i)
          if (m && drops.includes(m[1])) { patch.folder_url = `https://workdrive.zoho.com/folder/${keep}`; changed = true }
          try { const slots = JSON.parse(j.photo_slots || '{}'); if (slots?._folder_id && drops.includes(slots._folder_id)) { slots._folder_id = keep; patch.photo_slots = JSON.stringify(slots); changed = true } } catch { /* ignore */ }
          if (changed) { await table.updateRow(patch); repointed++ }
        }
        if (batch.length < 300) break
      }
    } catch (e) { console.warn('[wd-cleanup] repoint failed:', e.message) }
    console.log(`[wd-cleanup] merge → ${keep}: moved ${moved.length}, trashed ${trashed.length} folder(s), repointed ${repointed} card(s), failed ${failed.length} (${req.user?.name})`)
    res.json({ ok: true, keep_id: keep, moved: moved.length, trashed, repointed, failed })
  } catch (e) { console.error('[wd-cleanup merge]', e.message); res.status(500).json({ error: e.message }) }
})

export default router
