// Read the old "Time clock + people + vans backup" emails and copy those
// punch files into the datastore. Live punches win on the same id. A
// punch that exists only in an email is put back. Nothing in the mailbox
// is marked read or deleted.

import { packLists, parseBucket, TEXT_MAX } from './timeclockGuard.js'
import { entryWorkedMinutes } from './hr.js'

const STATE_KEY = 'tcbak:mailrestore'
const SEARCHES = ['subject:"Time clock + people + vans backup"', 'entire:timeclock-']
const PAGE = 20

const ptDay = iso => {
  const t = new Date(iso || 0)
  if (Number.isNaN(t.getTime())) return ''
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(t)
}

async function appOf(req) {
  const catalyst = (await import('zcatalyst-sdk-node')).default
  return catalyst.initialize(req)
}

async function stateOf(req) {
  const rows = await (await appOf(req)).zcql().executeZCQLQuery(
    `SELECT ROWID, config_value FROM AppConfig WHERE config_key = '${STATE_KEY}' LIMIT 1`
  )
  const row = rows?.[0]?.AppConfig || rows?.[0] || null
  let value = { done: false, start: 1, search: 0, seen: [], added: 0, files: 0, accountId: '' }
  if (row?.config_value) {
    try { value = { ...value, ...JSON.parse(row.config_value) } } catch { /* keep the fresh state */ }
  }
  return { rowid: row?.ROWID ? String(row.ROWID) : '', value }
}

async function saveState(req, rowid, value) {
  const table = (await appOf(req)).datastore().table('AppConfig')
  if (JSON.stringify(value).length > TEXT_MAX) value.seen = (value.seen || []).slice(-80)
  const body = { config_key: STATE_KEY, config_value: JSON.stringify(value) }
  if (rowid) await table.updateRow({ ...body, ROWID: rowid })
  else {
    const inserted = await table.insertRow(body)
    return String(inserted?.ROWID || '')
  }
  return rowid
}

async function storeMailSnapshot(req, day, entries) {
  const app = await appOf(req)
  const table = app.datastore().table('AppConfig')
  const packed = packLists({ mail: entries })
  for (const [key, list] of Object.entries(packed)) {
    const part = key === 'mail' ? 0 : Number(String(key).split('~')[1]) - 1
    const config_key = `tcbak:mail:${day}:p${part}`
    const config_value = JSON.stringify(list)
    const existing = await app.zcql().executeZCQLQuery(
      `SELECT ROWID FROM AppConfig WHERE config_key = '${config_key}' LIMIT 1`
    )
    const row = existing?.[0]?.AppConfig || existing?.[0] || null
    if (row?.ROWID) await table.updateRow({ ROWID: String(row.ROWID), config_key, config_value })
    else await table.insertRow({ config_key, config_value })
  }
}

function jaydenOctHours(entries) {
  let minutes = 0
  const seen = new Set()
  for (const entry of entries) {
    if (String(entry.user_id || '').toLowerCase() !== 'jayden@absoluteadas.com') continue
    const day = ptDay(entry.clock_in)
    if (day < '2026-10-01' || day > '2026-10-15' || !entry.clock_out) continue
    minutes += entryWorkedMinutes(entry)
    seen.add(day)
  }
  return { hours: Math.round(minutes / 6) / 10, days: seen.size }
}

export async function maybeRecoverTimeclockMail(req, { budgetMs = 8000 } = {}) {
  const started = Date.now()
  const state = await stateOf(req)
  if (state.value.done) {
    return { done: true, added: 0, added_total: state.value.added || 0, files: 0, skipped: 'already finished' }
  }

  const { resolveMailbox } = await import('./mailboxScrub.js')
  const { searchMessages, getMessageAttachments, downloadAccountAttachment } = await import('./mail.js')
  const { mergeRecoveredEntries, readEntriesPublic, snapshotTimeclock } = await import('../routes/timeclock.js')

  const box = await resolveMailbox(req, 'mark@absoluteadas.com')
  if (!box.accountId) {
    return { done: false, added: 0, files: 0, error: 'mark@absoluteadas.com is not visible to the mail connection' }
  }
  state.value.accountId = box.accountId

  let files = 0
  let added = 0
  while (Date.now() - started < budgetMs && !state.value.done) {
    const start = Math.max(1, Number(state.value.start) || 1)
    const searchKey = SEARCHES[Math.min(Number(state.value.search) || 0, SEARCHES.length - 1)]
    const msgs = await searchMessages(box.token, box.accountId, searchKey, PAGE, start)
    const strict = (Number(state.value.search) || 0) > 0
    const fresh = (msgs || []).filter(m => {
      if (!m?.messageId || (state.value.seen || []).includes(String(m.messageId))) return false
      if (!strict) return true
      return /time clock/i.test(m.subject || '') && /backup/i.test(m.subject || '')
    })
    if (!fresh.length) {
      if (!msgs?.length && (Number(state.value.search) || 0) < SEARCHES.length - 1) {
        state.value.search = (Number(state.value.search) || 0) + 1
        state.value.start = 1
        continue
      }
      if (!msgs?.length || msgs.length < PAGE || start > 400) state.value.done = true
      else state.value.start = start + PAGE
      continue
    }
    let stop = false
    for (const msg of fresh) {
      if (Date.now() - started >= budgetMs) { stop = true; break }
      const messageId = String(msg.messageId)
      const folderId = String(msg.folderId || '')
      let attachments = []
      try {
        attachments = await getMessageAttachments(box.token, box.accountId, folderId, messageId)
      } catch (e) {
        console.warn('[tc-mail] attachment list failed:', e.message)
        stop = true
        break
      }
      const hits = (attachments || []).filter(a => /^timeclock-.*\.json$/i.test(a.attachmentName || ''))
      let failed = false
      for (const att of hits) {
        try {
          const buf = await downloadAccountAttachment(
            box.token, box.accountId, folderId, messageId, String(att.attachmentId)
          )
          const text = Buffer.isBuffer(buf) ? buf.toString('utf8') : String(buf || '')
          const day = (String(att.attachmentName).match(/(\d{4}-\d{2}-\d{2})/) || [])[1] || 'unknown'
          const entries = parseBucket(text, att.attachmentName)
          await storeMailSnapshot(req, day, entries)
          const merged = await mergeRecoveredEntries(req, entries)
          added += merged.added
          state.value.added = (state.value.added || 0) + merged.added
          files += 1
        } catch (e) {
          console.warn('[tc-mail] file failed:', e.message)
          failed = true
          break
        }
      }
      if (failed) { stop = true; break }
      state.value.seen = [...(state.value.seen || []), messageId].slice(-80)
      state.value.files = (state.value.files || 0) + hits.length
      state.value.at = new Date().toISOString()
      state.rowid = await saveState(req, state.rowid, state.value)
    }
    const pageIds = (msgs || []).map(m => String(m.messageId)).filter(Boolean)
    if (pageIds.length && pageIds.every(id => state.value.seen.includes(id))) {
      state.value.start = start + PAGE
      if (msgs.length < PAGE) state.value.done = true
    }
    if (stop) break
  }

  state.value.at = new Date().toISOString()
  state.rowid = await saveState(req, state.rowid, state.value)

  let jayden = null
  if (added > 0 || state.value.done) {
    try { await snapshotTimeclock(req) } catch (e) { console.warn('[tc-mail] snapshot failed:', e.message) }
    try { jayden = jaydenOctHours(await readEntriesPublic(req)) }
    catch (e) { console.warn('[tc-mail] summary failed:', e.message) }
  }
  return {
    done: !!state.value.done,
    added,
    added_total: state.value.added || 0,
    files,
    files_total: state.value.files || 0,
    jayden_oct_1_15: jayden,
  }
}
