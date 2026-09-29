// 📥 Scrub every PDF in a mailbox — backfill and ongoing (Mark 2026-09-28:
// "read ar@absoluteadas.com … scrub every PDF that is in those emails in the
// past and ongoing").
//
// Deliberately NOT the email intake. That one creates job cards and is fenced
// with known-shop guardrails so it cannot make junk tickets. This one creates
// nothing: it walks a mailbox's history, finds PDF attachments, and files the
// ones that are actually estimates or calibration reports into the scrub
// library. An AR mailbox is full of remittances and statements, so the PDF
// type detector decides what is worth an Opus scrub rather than burning one
// on every bank notice.
//
// Shape of the thing, and why:
//   • cursor, not a queue — a backfill can be hundreds of mails and an
//     AppConfig row caps near 10k, so state is a position plus a bounded
//     list of short hashes rather than a list of everything to do
//   • one scrub per call — a scrub can outrun Catalyst's ~30s gateway cap
//     (the function keeps running to 540s, the HTTP response does not), so
//     progress is stamped BEFORE the work and a cron drives it repeatedly
//   • nothing is ever marked read; this must be invisible to whoever owns
//     the mailbox
import catalyst from 'zcatalyst-sdk-node'
import {
  getMailAccessToken, getAllMailAccounts, getInboxFolderId,
  getMessageAttachments, downloadAccountAttachment,
} from './mail.js'

const MAIL_API = 'https://mail.zoho.com/api'
const CURSOR = 'mailscrub_cursor'          // { inbox: { start, done: [hash], at, scanned, scrubbed, skipped } }
const MAX_PDF_BYTES = 12 * 1024 * 1024
const PAGE = 50
const DONE_KEEP = 600                      // ~9 chars each, comfortably inside the 10k row
const OURS_RE = /@(absoluteadas|adas-iq)\.com$/i   // our own sends

const ds = req => catalyst.initialize(req, { type: 'advancedio' })
const normEmail = e => String(e || '').toLowerCase().replace(/^.*<|>.*$/g, '').trim()
const nowIso = () => new Date().toISOString()

// Short stable id for "this attachment on this message", so the done list
// stays small enough to live in one AppConfig row.
function hash(s) {
  let h = 0
  for (let i = 0; i < String(s).length; i++) { h = ((h << 5) - h + String(s).charCodeAt(i)) | 0 }
  return (h >>> 0).toString(36)
}

async function cfgRead(req, key, fb) {
  try {
    const rows = await ds(req).zcql().executeZCQLQuery(
      `SELECT ROWID, config_value FROM AppConfig WHERE config_key = '${key}' ORDER BY MODIFIEDTIME DESC LIMIT 1`)   // racing first passes once left 4 rows; the newest is the truth
    const r = rows?.[0]?.AppConfig
    if (!r) return { row: null, value: fb }
    try { return { row: String(r.ROWID), value: JSON.parse(r.config_value) } }
    catch { return { row: String(r.ROWID), value: r.config_value } }
  } catch { return { row: null, value: fb } }
}
async function cfgWrite(req, key, row, value) {
  const t = ds(req).datastore().table('AppConfig')
  const v = typeof value === 'string' ? value : JSON.stringify(value)
  if (row) await t.updateRow({ ROWID: row, config_key: key, config_value: v })
  else await t.insertRow({ config_key: key, config_value: v })
}

/** Every address an account answers to (primary + aliases + send-as). */
function accountAddresses(a) {
  const out = new Set()
  for (const k of ['primaryEmailAddress', 'mailboxAddress', 'incomingUserName', 'accountDisplayName']) {
    if (a?.[k]) out.add(normEmail(a[k]))
  }
  for (const list of [a?.sendMailDetails, a?.emailAddress, a?.emailAddresses]) {
    for (const e of Array.isArray(list) ? list : []) {
      const v = normEmail(e?.fromAddress || e?.emailAddress || e?.mailId || e)
      if (v) out.add(v)
    }
  }
  return [...out].filter(Boolean)
}

/**
 * Which Zoho account can read this address? Returns null when the token
 * cannot see it at all — which is the honest answer for a separate user
 * mailbox like ar@ or kat@ until it is aliased or delegated in Zoho admin.
 */
export async function resolveMailbox(req, inbox) {
  const want = normEmail(inbox)
  const token = await getMailAccessToken()
  const accounts = await getAllMailAccounts(token)
  for (const a of accounts) {
    if (accountAddresses(a).includes(want)) {
      return { token, accountId: String(a.accountId), primary: normEmail(a.primaryEmailAddress || ''), via: 'alias' }
    }
  }
  return { token, accountId: '', reachable: false, accounts: accounts.map(a => normEmail(a.primaryEmailAddress || '')) }
}

/** Is this mailbox readable right now? (drives the status screen + the plan) */
export async function mailboxReachable(req, inbox) {
  const r = await resolveMailbox(req, inbox).catch(e => ({ error: e.message }))
  return {
    inbox: normEmail(inbox),
    reachable: !!r.accountId,
    via: r.accountId ? `account ${r.primary || r.accountId}` : 'NOT visible to the mail token — add it as an alias on the app\'s Zoho account, or forward it to info@',
    error: r.error || '',
  }
}

/** One page of a mailbox, newest first. Zoho pages with a 1-based `start`. */
async function pageMessages(token, accountId, start, limit) {
  const axios = (await import('axios')).default
  const folderId = await getInboxFolderId(token, accountId).catch(() => null)
  const params = { start: Math.max(1, start), limit, sortBy: 'date', sortorder: false }
  if (folderId) params.folderId = folderId
  const res = await axios.get(`${MAIL_API}/accounts/${accountId}/messages/view`, {
    headers: { Authorization: `Zoho-oauthtoken ${token}`, Accept: 'application/json' },
    params, timeout: 20000,
  })
  return res.data?.data || []
}

/**
 * Walk the mailbox and scrub what deserves it.
 *
 * `max` is how many PDFs to actually scrub this call — one by default,
 * because a scrub can outrun the gateway. Everything else (paging, listing
 * attachments, the done bookkeeping) is cheap and runs to the budget.
 */
export async function runMailboxScrub(req, { inbox = 'ar@absoluteadas.com', max = 1, budgetMs = 22000, dry = false, match = '', via = '', includeOwn = false, depth = 0 } = {}) {
  const t0 = Date.now()
  // `via` lets us harvest one correspondent's mail out of a mailbox we CAN
  // read. ar@ is not a mailbox the token can open, but ar@'s mail is copied
  // into mark@ — so inbox=mark@&via=ar@ gets the AR paperwork today without
  // waiting on a Zoho admin change (Mark 2026-09-28).
  const key = normEmail(inbox)
  const need = String(via || match || '').toLowerCase().trim()
  const hits = m => !need || [m.fromAddress, m.toAddress, m.sender, m.subject]
    .some(v => String(v || '').toLowerCase().includes(need))
  const out = { inbox: key, via: need || null, scanned: 0, found: 0, scrubbed: 0, skipped: 0, filed: [], done: false, dry }

  const mb = await resolveMailbox(req, key)
  if (!mb.accountId) {
    out.error = `the mail token cannot see ${key}`
    out.fix = 'Add it as an alias on the app\'s Zoho Mail account, or forward it to info@absoluteadas.com.'
    out.visible = mb.accounts || []
    return out
  }

  // A filtered run and a full run must not share a cursor, or one would skip
  // what the other already walked past.
  const ckey = need ? `${key}|${need}` : key
  const { row, value } = await cfgRead(req, CURSOR, {})
  const all = (value && typeof value === 'object' && !Array.isArray(value)) ? value : {}
  const st = all[ckey] || { start: 1, done: [], scanned: 0, scrubbed: 0, skipped: 0 }
  const doneSet = new Set(Array.isArray(st.done) ? st.done : [])

  const save = async () => {
    st.done = [...doneSet].slice(-DONE_KEEP)
    st.at = nowIso()
    all[ckey] = st
    if (!dry) await cfgWrite(req, CURSOR, row, all)
  }

  try {
    // `depth` caps how deep one run walks. The ongoing ticker only needs to
    // see recent mail; without a cap it re-walks thousands of old messages
    // every cycle looking for a handful of matches.
    while (Date.now() - t0 < budgetMs && out.scrubbed < max && (!depth || out.scanned < depth)) {
      const msgs = await pageMessages(mb.token, mb.accountId, st.start, PAGE)
      if (!msgs.length) { out.done = true; st.start = 1; break }   // caught up — next run starts at the top

      for (const m of msgs) {
        if (Date.now() - t0 > budgetMs || out.scrubbed >= max) break
        if (depth && out.scanned >= depth) break
        out.scanned++; st.scanned = (st.scanned || 0) + 1
        st.start++                                  // advance past this message whatever happens
        if (m.hasAttachment === false) continue
        if (!hits(m)) continue                     // not the correspondent we are harvesting
        // ar@ is an OUTGOING address (Mark 2026-09-28: "it's supposed to be
        // for outgoing, but some companies respond back to invoices"). Our own
        // sends are the invoices we mailed; the value is in what came back.
        if (!includeOwn && OURS_RE.test(normEmail(m.fromAddress || m.sender || ''))) continue

        const id = String(m.messageId || m.msgId || '')
        const folderId = String(m.folderId || '')
        if (!id) continue

        let atts = []
        try { atts = await getMessageAttachments(mb.token, mb.accountId, folderId, id) } catch { continue }
        const pdfs = (atts || []).filter(a => /\.pdf$/i.test(a.attachmentName || '') && Number(a.attachmentSize || 0) <= MAX_PDF_BYTES)

        for (const a of pdfs) {
          if (out.scrubbed >= max) break
          // Dedupe on the FILE, not the message. Our invoice emails send the
          // same PDF twice (insurance + cost copy) and shops reply quoting it,
          // so a message-scoped key scrubbed one estimate four times.
          const h = hash(`${String(a.attachmentName || '').toLowerCase()}:${a.attachmentSize || 0}`)
          if (doneSet.has(h)) continue
          out.found++
          doneSet.add(h)                            // stamp BEFORE the work — a gateway kill must not loop
          await save()
          if (dry) { out.filed.push({ name: a.attachmentName, from: m.fromAddress, subject: m.subject, would: 'scrub' }); continue }

          try {
            const buf = await downloadAccountAttachment(mb.token, mb.accountId, folderId, id, a.attachmentId)
            if (!buf || buf.length < 512) { out.skipped++; st.skipped = (st.skipped || 0) + 1; continue }

            // An AR mailbox is mostly remittances and statements. Only an
            // estimate or a calibration report is worth an Opus scrub.
            // detectPdfMeta is binary (CCC, else KINETIC) so it can never say
            // "this is a bank notice". detectPdfKind can, which is the whole
            // point here — an AR mailbox is mostly paperwork we should not
            // spend an Opus call on.
            const { detectPdfKind } = await import('./claude.js')
            let kind = 'OTHER', make = ''
            try { ({ kind, make } = await detectPdfKind(buf.toString('base64'))) } catch { kind = 'OTHER' }
            // Estimates only (Mark: "scrub every CCC estimate"). Our own
            // Absolute ADAS reports are never scrubbed — the first info@ pass
            // ingested three of them as if they were cars. Kinetic reports are
            // the benchmark set, not library content.
            if (!['CCC', 'ESTIMATE'].includes(kind)) {
              out.skipped++; st.skipped = (st.skipped || 0) + 1
              out.filed.push({ name: a.attachmentName, kind, result: kind === 'ABSOLUTE' ? 'our own report — skipped' : 'not an estimate — skipped' })
              continue
            }
            const type = kind
            // Same estimate is often both an attachment and a Downloads file.
            const { hasScrubForFile } = await import('./scrubStore.js')
            if (await hasScrubForFile(req, a.attachmentName)) {
              out.skipped++; st.skipped = (st.skipped || 0) + 1
              out.filed.push({ name: a.attachmentName, kind, result: 'already in the library' })
              continue
            }
            const { scrubPdfBuffer } = await import('../routes/extract.js')
            const data = await scrubPdfBuffer(req, buf, {
              learn: false,
              source: `mail:${key}`,
              by: `mailbox ${key}`,
              file: { name: a.attachmentName || 'attachment.pdf' },
              pdfType: 'CCC',   // ESTIMATE (Mitchell/Audatex) → the CCC scrubber too
              make,
            })
            out.scrubbed++; st.scrubbed = (st.scrubbed || 0) + 1
            out.filed.push({
              name: a.attachmentName, kind,
              shop: data?.shop || '', vehicle: data?.vehicle || '',
              ro: data?.ro_number || '', scrubId: data?._scrubId || '',
              required: (data?.calibrations || []).filter(c => c.enabled !== false).length,
            })
          } catch (e) {
            out.skipped++; st.skipped = (st.skipped || 0) + 1
            out.filed.push({ name: a.attachmentName, error: String(e.message).slice(0, 200) })
          }
        }
      }
      await save()
    }
  } catch (e) {
    out.error = e.message
  }

  await save()
  out.cursor = st.start
  out.totals = { scanned: st.scanned || 0, scrubbed: st.scrubbed || 0, skipped: st.skipped || 0 }
  out.ms = Date.now() - t0
  console.log(`[mail-scrub] ${key}: scanned ${out.scanned}, scrubbed ${out.scrubbed}, skipped ${out.skipped} (cursor ${st.start}) in ${out.ms}ms${dry ? ' (dry)' : ''}`)
  return out
}

/** Where the backfill has got to, per mailbox. */
export async function mailboxScrubStatus(req) {
  const { value } = await cfgRead(req, CURSOR, {})
  return (value && typeof value === 'object' && !Array.isArray(value)) ? value : {}
}

/** Start the backfill over again from the newest message. */
export async function resetMailboxScrub(req, inbox) {
  const key = normEmail(inbox)
  const { row, value } = await cfgRead(req, CURSOR, {})
  const all = (value && typeof value === 'object' && !Array.isArray(value)) ? value : {}
  delete all[key]
  await cfgWrite(req, CURSOR, row, all)
  return { reset: key }
}
