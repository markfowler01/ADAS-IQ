// 📧 Email intake (Mark 2026-09-24): "anytime we get estimate in the subject
// line or in an email I watch and it has a CCC PDF, automatically create a
// quote request ticket; if I get any email that says the car is ready with
// a CCC estimate, create a job ticket. No useless tickets we have to delete."
//
// Watches every mailbox shops write to (mark@, info@, kat@ + AppConfig
// email2job_inboxes). Reads the last 3 days, read or unread (Mark opens mail
// on his phone before the sweep runs). Never marks mail read, never moves it.
//
// Stage A  sweepEmailToJob  — list unread → guardrails → classify (Haiku) →
//          download the CCC PDF → read its header (Haiku) → ticket via the
//          text→job machinery → file the PDF in the job folder → queue the
//          scrub. Budgeted to ~20s per call (Catalyst gateway cap).
// Stage B  runScrubQueue    — one queued PDF per call: full CCC scrub (same
//          extractor + rules as the upload screen) → calibrations on the
//          card + AppConfig scrub_<job> for the review screen.
//
// Guardrails: known shop only (CRM sender / CRM domain / CCC header names a
// CRM shop, else a Kat bell and no card); our own mail, auto-replies,
// bounces, receipts, newsletters skipped; suppress list; one car one card
// (RO → VIN → last-4+shop → shop+vehicle, then the email thread); low
// confidence → Kat bell; every skip logged (email2job_skipped).
import catalyst from 'zcatalyst-sdk-node'
import Anthropic from '@anthropic-ai/sdk'
import { getMailAccessToken, getRecentInboxMessages, getMessageContent, getMessageAttachments, downloadAccountAttachment } from './mail.js'
import { maybeCreateJobsFromText } from './textToJob.js'
import { postToCliqChannel, DISPATCH_CHANNEL } from './cliq.js'

const KEY = 'email2job_done'
const DEFAULT_INBOXES = ['mark@absoluteadas.com', 'info@absoluteadas.com', 'k.belmonte@absoluteadas.com']
const MAX_AGE_MS = 3 * 24 * 3600 * 1000
const MAX_PDF_BYTES = 15 * 1024 * 1024
const TIME_BUDGET_MS = 20000
const OUR_DOMAIN = 'absoluteadas.com'
const FREE_MAIL = new Set(['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com', 'aol.com', 'live.com', 'msn.com', 'me.com', 'comcast.net', 'att.net', 'protonmail.com'])
const NOISE_FROM_RE = /(^|[.\-_])(no-?reply|do-?not-?reply|mailer-daemon|postmaster|notifications?|newsletter|marketing|billing|bounce)[@.\-_]/i
const NOISE_SUBJ_RE = /\b(auto(matic)?[- ]?reply|out of (the )?office|delivery (status|failure)|undeliverable|mail delivery|unsubscribe|webinar|docusign|zoho sign|completed: |password|verify your|your (order|receipt|statement)|payment (received|receipt)|invoice #?\d)/i
const ESTIMATE_RE = /\b(estimate|quote|scrub|supplement|pre-?scan|what (does|will) (this|it) need)\b/i

const normEmail = e => String(e || '').toLowerCase().replace(/^.*<([^>]+)>.*$/, '$1').trim()
const domainOf = e => normEmail(e).split('@')[1] || ''
const normName = s => String(s || '').toLowerCase().replace(/\b(inc|llc|co|corp|ltd|the)\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
const normSubject = s => String(s || '').replace(/^\s*((re|fw|fwd|aw|tr)\s*:\s*)+/i, '').trim().toLowerCase().replace(/\s+/g, ' ')

// Every address a Zoho Mail account answers to (primary, aliases, group/incoming names, from-addresses).
function accountAddresses(a) {
  const list = [a.primaryEmailAddress, a.mailboxAddress, a.incomingUserName, a.accountDisplayName, a.displayName, a.accountName,
    ...(a.emailAddress || []).map(e => (typeof e === 'string' ? e : e?.mailId)), ...(a.sendMailDetails || []).map(d => d?.fromAddress)]
  return [...new Set(list.filter(x => typeof x === 'string' && x.includes('@')).map(x => x.toLowerCase().trim()))]
}
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
// Sender's company domain matches a CRM shop's email domain (never free mail).
function domainIndex(idx) {
  const d = new Map()
  for (const c of idx.values()) { const dom = domainOf(c.email); if (dom && !FREE_MAIL.has(dom) && dom !== OUR_DOMAIN && !d.has(dom)) d.set(dom, c) }
  return d
}
// The CCC header's "shop" against the CRM list — exact, or one contains the other (both ≥ 8 chars).
export function matchShopName(name, shops) {
  const n = normName(name); if (n.length < 4) return null
  const exact = shops.find(s => normName(s.shop_name) === n); if (exact) return exact
  const hits = shops.filter(s => { const m = normName(s.shop_name); return m.length >= 8 && n.length >= 8 && (m.includes(n) || n.includes(m)) })
  return hits.length === 1 ? hits[0] : null
}

const stripHtml = h => String(h || '').replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, '').replace(/<br\s*\/?>|<\/p>|<\/div>|<\/tr>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim()
const newPart = t => String(t).split(/\n(?:On .{5,80} wrote:|From: |-----Original Message-----|> )/)[0].trim()

// ── AppConfig helpers (small JSON blobs; text cap ~10k) ──────────────────────
async function cfgRead(req, key, fallback) {
  try { const rows = await catalyst.initialize(req, { type: 'advancedio' }).zcql().executeZCQLQuery(`SELECT ROWID, config_value FROM AppConfig WHERE config_key = '${key}' LIMIT 1`); const r = rows?.[0]?.AppConfig; if (!r) return { row: null, value: fallback }; try { return { row: String(r.ROWID), value: JSON.parse(r.config_value) } } catch { return { row: String(r.ROWID), value: r.config_value } } } catch { return { row: null, value: fallback } }
}
async function cfgWrite(req, key, row, value) {
  const t = catalyst.initialize(req, { type: 'advancedio' }).datastore().table('AppConfig'); const v = typeof value === 'string' ? value : JSON.stringify(value)
  if (row) await t.updateRow({ ROWID: row, config_key: key, config_value: v }); else await t.insertRow({ config_key: key, config_value: v })
}
async function readDone(req) { const { row, value } = await cfgRead(req, KEY, []); return { row, ids: new Set(Array.isArray(value) ? value : []) } }
async function writeDone(req, row, ids) { await cfgWrite(req, KEY, row, [...ids].slice(-400)) }
async function emailToJobEnabled(req) { const { value } = await cfgRead(req, 'email2job_enabled', ''); return String(value) === 'true' }
export async function watchedInboxes(req) {
  const { value } = await cfgRead(req, 'email2job_inboxes', '')
  const list = String(Array.isArray(value) ? value.join(',') : value || '').split(/[,\s]+/).map(normEmail).filter(Boolean)
  return list.length ? list : DEFAULT_INBOXES
}
async function logSkipped(req, item) {
  try { const { row, value } = await cfgRead(req, 'email2job_skipped', []); const list = Array.isArray(value) ? value : []; list.push({ at: new Date().toISOString(), ...item }); await cfgWrite(req, 'email2job_skipped', row, list.slice(-60)) } catch { /* fine */ }
}
export async function mailboxStatus(req) {
  const { getAllMailAccounts } = await import('./mail.js')
  const token = await getMailAccessToken()
  const accounts = await getAllMailAccounts(token)
  const seen = accounts.map(a => ({ accountId: String(a.accountId), primary: a.primaryEmailAddress || a.mailboxAddress || a.incomingUserName || a.accountDisplayName || '', aliases: accountAddresses(a), keys: Object.keys(a).slice(0, 40) }))
  const inboxes = await watchedInboxes(req)
  const reach = inboxes.map(i => { const hit = seen.find(a => [a.primary, ...a.aliases].map(x => String(x).toLowerCase()).includes(i)); return { inbox: i, reachable: !!hit, via: hit ? (hit.primary.toLowerCase() === i ? 'own account' : `account ${hit.primary || hit.accountId}`) : 'NOT visible to the mail token (separate user mailbox)' } })
  return { accounts: seen, inboxes: reach }
}
export async function readSkipped(req) { const { value } = await cfgRead(req, 'email2job_skipped', []); return Array.isArray(value) ? value : [] }
export async function addSuppressed(req, entry) {
  const e = String(entry || '').trim().toLowerCase(); if (!e) return []
  const { row, value } = await cfgRead(req, 'email2job_suppress', []); const list = Array.isArray(value) ? value : []
  if (!list.includes(e)) list.push(e); await cfgWrite(req, 'email2job_suppress', row, list.slice(-200)); return list
}
async function readSuppressed(req) { const { value } = await cfgRead(req, 'email2job_suppress', []); return Array.isArray(value) ? value : [] }
// Thread memory: normalized subject + sender → the card it made (14 days).
async function threadLookup(req, key) { const { value } = await cfgRead(req, 'email2job_threads', []); const cut = Date.now() - 14 * 86400000; return (Array.isArray(value) ? value : []).find(t => t.k === key && Date.parse(t.at) > cut)?.job || '' }
async function threadRemember(req, key, job) { try { const { row, value } = await cfgRead(req, 'email2job_threads', []); const list = (Array.isArray(value) ? value : []).filter(t => t.k !== key); list.push({ k: key, job: String(job), at: new Date().toISOString() }); await cfgWrite(req, 'email2job_threads', row, list.slice(-150)) } catch { /* fine */ } }

// ── Claude: classify the email; read the CCC header ──────────────────────────
const client = () => new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const ptToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const parseJson = raw => { const t = String(raw || ''); return JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)) }

export async function classifyEmail({ subject, body, attachments, shop, sender, hasCcc }) {
  const prompt = `You read emails sent to Absolute ADAS, a mobile ADAS calibration + programming + diagnostics company, by auto body / repair shops. Decide what the email wants.

Today is ${ptToday()} (Pacific). Shop: ${shop || 'unknown'}. Sender: ${sender || 'unknown'}. Attachments: ${attachments.length ? attachments.join(', ') : 'none'}${hasCcc ? ' (one is a CCC ONE collision estimate)' : ''}.

kind:
- "quote": they want the calibrations priced / scrubbed / quoted BEFORE the car is repaired or ready ("estimate", "quote", "scrub", "supplement", "what does this need", "can you look at this", or just an estimate attached with little text).
- "job": a car is ready / will be ready / needs calibration or programming now / when can you come / schedule it.
- "both": the car is ready AND they want the attached estimate scrubbed.
- "report": they sent a finished document (post-scan, completed report, invoice, receipt, paid notice) — nothing to schedule or price.
- "reply": a short reply on an earlier thread (thanks / ok / sounds good / see you then) with no new car.
- "other": vendor, newsletter, personal, spam, anything else.

vehicles: one entry per distinct car (a different RO, VIN/last-4, or year/make/model is a different car). Keep their words. Don't invent a VIN, RO or vehicle that isn't in the email. Empty string when unknown.

Reply with JSON only:
{
  "kind": "quote" | "job" | "both" | "report" | "reply" | "other",
  "vehicles": [{ "year": "", "make": "", "model": "", "vin": "", "ro": "", "services": [], "needed_by_date": "", "needed_by_text": "", "note": "" }],
  "summary": "",
  "confidence": 0.0
}

Subject: ${String(subject || '').slice(0, 200)}
Body:
"""${String(body || '').slice(0, 1800)}"""`
  const msg = await client().messages.create({ model: 'claude-haiku-4-5', max_tokens: 700, messages: [{ role: 'user', content: prompt }] })
  const out = parseJson(msg.content?.[0]?.text || '')
  out.kind = ['quote', 'job', 'both', 'report', 'reply', 'other'].includes(out.kind) ? out.kind : 'other'
  out.vehicles = Array.isArray(out.vehicles) ? out.vehicles.filter(v => v && (v.year || v.make || v.model || v.vin || v.ro)) : []
  out.confidence = Number(out.confidence) || 0
  return out
}

// Fast header read (Haiku): who/what the estimate is for. The full scrub (Opus) runs in stage B.
export async function readCccHeader(buffer) {
  const msg = await client().messages.create({ model: 'claude-haiku-4-5', max_tokens: 300, messages: [{ role: 'user', content: [
    { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buffer.toString('base64') } },
    { type: 'text', text: 'From this CCC ONE estimate return JSON only: {"shop": "repair facility / shop name", "ro": "RO or workfile number", "vin": "17-char VIN", "year": "", "make": "full manufacturer name — Toyota not TOYO, Mercedes-Benz not BENZ, Chevrolet not CHEV", "model": "model name only, no trim / body / drive codes (Grand Highlander, not Grand Highlander Hybrid XLE AWD 4D UTV)", "insurer": "insurance company", "claim": "claim number", "owner": "vehicle owner name"}. Empty string when not shown.' },
  ] }] })
  const h = parseJson(msg.content?.[0]?.text || '')
  for (const k of ['shop', 'ro', 'vin', 'year', 'make', 'model', 'insurer', 'claim', 'owner']) h[k] = String(h[k] || '').trim()
  h.vin = h.vin.toUpperCase().replace(/[^A-Z0-9]/g, '')
  return h
}

// ── Stage A ──────────────────────────────────────────────────────────────────
export async function sweepEmailToJob(req, { dry = false, maxPerRun = 4, inboxOnly = '', messageId = '' } = {}) {
  const t0 = Date.now()
  const out = { checked: 0, matched: 0, created: 0, appended: 0, flagged: 0, skipped: 0, queued: 0, dry, items: [] }
  if (!dry && !(await emailToJobEnabled(req))) { out.disabled = 'email2job_enabled is not true'; return out }
  const token = await getMailAccessToken()
  const { getAllShops } = await import('../routes/shops.js')
  const shops = await getAllShops(req)
  const idx = buildEmailIndex(shops)
  const byDomain = domainIndex(idx)
  const suppressed = await readSuppressed(req)
  const scrubOn = String((await cfgRead(req, 'email2job_scrub', '')).value) === 'true'
  const { value: adasRaw } = await cfgRead(req, 'adasmaps_sender_domain', ''); const adasDomain = String(adasRaw || '').toLowerCase().replace(/^@/, '')
  const jobsMod = await import('../routes/jobs.js')
  const jobs = { findOpenRequestFor: jobsMod.findOpenRequestFor, insertJob: jobsMod.insertJob, updateJob: jobsMod.updateJob, readAll: jobsMod.readJobsPublic }
  const { createNotification } = await import('../routes/notifications.js')
  const { row, ids } = await readDone(req)
  const inboxes = (await watchedInboxes(req)).filter(i => !inboxOnly || i === normEmail(inboxOnly))
  const seenAccounts = new Set()
  let budget = maxPerRun
  const skip = async (m, inbox, why, extra = {}) => { out.skipped++; ids.add(String(m.messageId)); out.items.push({ inbox, from: normEmail(m.fromAddress || m.sender), subject: m.subject || '', skipped: why }); if (!/^(own mail|too old|done)$/.test(why)) await logSkipped(req, { inbox, from: normEmail(m.fromAddress || m.sender), subject: String(m.subject || '').slice(0, 120), why, ...extra }) }

  outer: for (const inbox of inboxes) {
    let accountId
    try {
      const { getAllMailAccounts } = await import('./mail.js'); const accounts = await getAllMailAccounts(token)
      const hit = accounts.find(a => accountAddresses(a).includes(inbox))
      if (!hit) { out.unreachable = [...(out.unreachable || []), inbox]; continue }
      accountId = String(hit.accountId)
    } catch (e) { console.log('[email intake] no account for', inbox, e.message); continue }
    if (seenAccounts.has(accountId)) continue; seenAccounts.add(accountId)
    let msgs = []; try { msgs = await getRecentInboxMessages(token, accountId, 60) } catch (e) { console.log('[email intake] inbox read failed', inbox, e.message); continue }
    for (const m of msgs) {
      const id = String(m.messageId || ''); if (!id || ids.has(id)) continue
      if (messageId && id !== String(messageId)) continue
      out.checked++
      const from = normEmail(m.fromAddress || m.sender || '')
      const subject = String(m.subject || '').trim()
      const age = Date.now() - Number(m.receivedTime || 0); if (Number.isFinite(age) && age > MAX_AGE_MS) { await skip(m, inbox, 'too old'); continue }
      if (!from || from.endsWith('@' + OUR_DOMAIN)) { await skip(m, inbox, 'own mail'); continue }
      if (suppressed.some(s => from === s || from.endsWith('@' + s) || (s.length > 3 && subject.toLowerCase().includes(s)))) { await skip(m, inbox, 'suppressed sender/subject'); continue }
      let contact = idx.get(from) || byDomain.get(domainOf(from)) || null
      // 🔗 ADAS Maps "car is ready" notifications.
      if (!contact && adasDomain && from.endsWith('@' + adasDomain)) {
        const hay = `${subject} ${m.summary || ''}`.toLowerCase()
        const shop = shops.find(sh => sh.shop_name && hay.includes(String(sh.shop_name).toLowerCase()))
        if (shop) { contact = { contact_name: 'ADAS Maps', shop_name: shop.shop_name, shop_id: shop.id, email: from }; try { const { markConnected } = await import('./integrations.js'); await markConnected(req, shop.shop_name, 'adasmaps', 'first ADAS Maps notification received') } catch { /* fine */ } }
      }
      if (NOISE_FROM_RE.test(from + '@') && !contact) { await skip(m, inbox, 'automated sender'); continue }
      if (NOISE_SUBJ_RE.test(subject)) { await skip(m, inbox, 'auto-reply / receipt / notice subject'); continue }
      const estimateWord = ESTIMATE_RE.test(`${subject} ${m.summary || ''}`)
      // Unknown sender with no estimate word and no attachment → not ours.
      if (!contact && !estimateWord && m.hasAttachment === false) { await skip(m, inbox, 'unknown sender'); continue }
      if (Date.now() - t0 > TIME_BUDGET_MS || budget <= 0) break outer

      // Body (new part only) + attachments
      let text = String(m.summary || '')
      try { const c = await getMessageContent(token, accountId, m.folderId, id); const body = newPart(stripHtml(c.content || c.body || '')); if (body.length > text.length) text = body } catch { /* summary is enough */ }
      let atts = []; if (m.hasAttachment !== false) { try { atts = await getMessageAttachments(token, accountId, m.folderId, id) } catch (e) { console.log('[email intake] attachmentinfo failed:', e.message) } }
      const pdfs = atts.filter(a => /\.pdf$/i.test(a.attachmentName || '') && Number(a.attachmentSize || 0) <= MAX_PDF_BYTES).slice(0, 2)
      const hasEstimateWord = estimateWord || ESTIMATE_RE.test(text)
      if (!contact && !hasEstimateWord && !pdfs.length) { await skip(m, inbox, 'unknown sender'); continue }

      // CCC estimate attached? (detect is a fast Haiku call; Kinetic reports are not tickets)
      let ccc = null, header = null, otherPdf = ''
      for (const a of pdfs) {
        if (ccc) break
        try {
          const buf = await downloadAccountAttachment(token, accountId, m.folderId, id, a.attachmentId)
          if (!buf || buf.length < 512) continue
          const { detectPdfType } = await import('./claude.js')
          const type = await detectPdfType(buf.toString('base64')).catch(() => 'UNKNOWN')
          if (type === 'CCC') ccc = { buffer: buf, name: a.attachmentName || 'estimate.pdf' }
          else otherPdf = a.attachmentName || 'report.pdf'
        } catch (e) { console.log('[email intake] attachment download failed:', e.message) }
      }
      if (ccc) { try { header = await readCccHeader(ccc.buffer) } catch (e) { console.log('[email intake] header read failed:', e.message); header = null } }
      // Unknown sender: the estimate header may name a shop we know.
      if (!contact && header?.shop) { const shop = matchShopName(header.shop, shops); if (shop) contact = { contact_name: (shop.contact_name || '').trim() || from, shop_name: shop.shop_name, shop_id: shop.id, email: from, _via: 'estimate header' } }
      if (!contact) {
        if (ccc) {
          // A real estimate from a shop not in the CRM → Kat decides, nothing created.
          out.flagged++
          const who = header?.shop || from
          if (!dry) {
            await createNotification(req, { to: 'Kath', toEmail: 'k.belmonte@absoluteadas.com', type: 'job_requested', title: `📧 Estimate from a shop not in the CRM — ${who}`, body: `${[header?.year, header?.make, header?.model].filter(Boolean).join(' ') || 'Vehicle ?'}${header?.ro ? ` · RO ${header.ro}` : ''} · from ${from} · "${subject.slice(0, 80)}". Add the shop in the CRM, then forward the email to info@ or request the quote by hand.`, skipCliq: true, skipTechChannel: true }).catch(() => {})
            await postToCliqChannel(DISPATCH_CHANNEL, `📧 *Estimate from a shop not in the CRM* — ${who}\n${[header?.year, header?.make, header?.model].filter(Boolean).join(' ') || 'Vehicle ?'}${header?.ro ? ` · RO ${header.ro}` : ''} · from ${from} · "${subject.slice(0, 100)}"\nNothing created. Add the shop in the CRM and forward the email to info@, or request the quote by hand.`).catch(() => {})
          }
          await skip(m, inbox, 'estimate from unknown shop', { shop: who }); continue
        }
        await skip(m, inbox, 'unknown sender'); continue
      }
      budget--
      out.matched++

      // Classify (one Haiku call over subject + body + attachment names)
      let cls
      try { cls = await classifyEmail({ subject, body: text, attachments: atts.map(a => a.attachmentName || '').filter(Boolean), shop: contact.shop_name, sender: contact.contact_name, hasCcc: !!ccc }) }
      catch (e) { console.log('[email intake] classify failed:', e.message); cls = { kind: ccc ? 'quote' : 'other', vehicles: [], summary: '', confidence: ccc ? 0.8 : 0 } }
      if (ccc && cls.kind === 'other' && hasEstimateWord) cls.kind = 'quote'
      if (ccc && ['report', 'other'].includes(cls.kind)) cls.kind = 'quote'   // Mark's rule: estimate + CCC PDF = quote request
      if (ccc && cls.confidence < 0.85) cls.confidence = 0.85                 // a known shop's CCC estimate is real work
      const threadKey = `${normSubject(subject)}|${from}`
      const threadJobId = await threadLookup(req, threadKey).catch(() => '')
      if (['report', 'other'].includes(cls.kind) || (cls.kind === 'reply' && !threadJobId)) { await skip(m, inbox, `${cls.kind}${otherPdf ? ` (${otherPdf})` : ''}`, { summary: cls.summary }); continue }
      if (cls.kind === 'quote' && !ccc && cls.confidence < 0.75) { await skip(m, inbox, 'quote wording, no estimate attached, low confidence', { summary: cls.summary }); continue }
      // A reply on a thread we already ticketed → the words land on that card, nothing new.
      if (cls.kind === 'reply' && threadJobId && !ccc) {
        if (!dry) {
          ids.add(id)
          try { const t = (await jobs.readAll(req)).find(j => String(j.id) === String(threadJobId)); if (t) { await jobs.updateJob(req, t.id, { ...t, notes: `📧 ${new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} · ${contact.contact_name || from} replied: "${text.slice(0, 300)}"\n${t.notes || ''}`.slice(0, 9000) }); out.appended++ } } catch (e) { console.log('[email intake] thread append failed:', e.message) }
        }
        out.items.push({ inbox, from, subject, kind: 'reply', thread: threadJobId }); continue
      }
      const requestType = cls.kind === 'quote' ? 'equote' : 'email'
      const intent = 'new_job'
      const pre = { intent, vehicles: cls.vehicles, confidence: cls.confidence, summary: cls.summary }
      const combined = `${subject ? subject + '\n' : ''}${text}`.slice(0, 1500)
      if (!dry) ids.add(id)
      const r = await maybeCreateJobsFromText(req, { from, body: combined, contact, lineType: 'email', jobs, channel: 'email', dry, subject, pre, requestType, header, pdf: ccc ? { buffer: ccc.buffer, name: ccc.name, scrub: scrubOn } : null, threadJobId, minConfidence: 0.7, senderEmail: from })
      out.created += r.created?.length || 0; out.appended += r.appended?.length || 0; if (r.flagged) out.flagged++
      const jobId = r.created?.[0]?.id || r.appended?.[0]?.id || ''
      if (!dry && jobId) await threadRemember(req, threadKey, jobId)
      // Auto-scrub is OFF (Mark 2026-09-24: "our scrubber is not that good yet") — the
      // PDF is filed in the folder and the ticket carries the header. AppConfig
      // email2job_scrub = 'true' turns the scrub back on.
      if (!dry && r.pdf?.fileId && r.pdf.jobId && scrubOn) { await queueScrub(req, { job: String(r.pdf.jobId), file: r.pdf.fileId, name: r.pdf.name }); out.queued++ }
      out.items.push({ inbox, from, who: `${contact.contact_name} @ ${contact.shop_name}${contact._via ? ` (via ${contact._via})` : ''}`, subject, kind: cls.kind, requestType, ccc: !!ccc, header, skipped: r.skipped || '', extraction: r.extraction || null, created: r.created || [], appended: r.appended || [] })
    }
  }
  if (!dry) await writeDone(req, row, ids)
  out.ms = Date.now() - t0
  console.log(`[email intake] checked ${out.checked}, matched ${out.matched}, created ${out.created}, appended ${out.appended}, flagged ${out.flagged}, skipped ${out.skipped}, queued ${out.queued} in ${out.ms}ms${dry ? ' (dry)' : ''}`)
  return out
}

// ── Stage B: the scrub queue ─────────────────────────────────────────────────
const QKEY = 'email2job_scrub_queue'
async function queueScrub(req, item) { const { row, value } = await cfgRead(req, QKEY, []); const q = (Array.isArray(value) ? value : []).filter(x => x.job !== item.job); q.push({ ...item, at: new Date().toISOString(), tries: 0 }); await cfgWrite(req, QKEY, row, q.slice(-40)) }
// Put a card back on the scrub queue from the newest PDF in its WorkDrive folder.
export async function requeueScrub(req, jobId) {
  const jobsMod = await import('../routes/jobs.js')
  const job = (await jobsMod.readJobsPublic(req)).find(j => String(j.id) === String(jobId))
  if (!job) throw new Error('card not found')
  const { getAccessToken } = await import('./zoho.js'); const { listChildren } = await import('./workdrive.js')
  const wdToken = await getAccessToken()
  const folderId = await jobsMod.resolveJobFolderPublic(req, job, wdToken, { noCreate: true })
  if (!folderId) throw new Error('no folder for this card')
  const pdfs = (await listChildren(folderId, wdToken, { folders: false })).filter(f => /\.pdf$/i.test(f.name || '')).sort((a, b) => Number(b.created || 0) - Number(a.created || 0))
  if (!pdfs.length) throw new Error('no PDF in the folder')
  await queueScrub(req, { job: String(job.id), file: pdfs[0].id, name: pdfs[0].name })
  return { job: job.id, file: pdfs[0].id, name: pdfs[0].name }
}
// Take our scrub off a card (calibrations + note) — the estimate stays in the folder.
export async function unscrubCard(req, jobId) {
  const jobsMod = await import('../routes/jobs.js')
  const job = (await jobsMod.readJobsPublic(req)).find(j => String(j.id) === String(jobId))
  if (!job) throw new Error('card not found')
  const notes = String(job.notes || '').split('\n').filter(l => !/^📎 CCC estimate (scrubbed|attached — scrub failed)/.test(l)).join('\n').replace(/ · scrubbing…/g, '')
  const upd = await jobsMod.updateJobPublic(req, job.id, { ...job, calibrations: '[]', notes })
  try { const { row } = await cfgRead(req, `scrub_${job.id}`, null); if (row) await catalyst.initialize(req, { type: 'advancedio' }).datastore().table('AppConfig').deleteRow(row) } catch { /* fine */ }
  return { job: upd.id, vehicle: upd.vehicle, notes: upd.notes.slice(0, 200) }
}
export async function scrubQueue(req) { const { value } = await cfgRead(req, QKEY, []); return Array.isArray(value) ? value : [] }

// Trim the extraction so it fits an AppConfig row (~10k chars).
function compactScrub(data) {
  const d = { ...data }; delete d._repairText; delete d._vehicleEquipment
  let s = JSON.stringify(d)
  if (s.length > 9500) { d.calibrations = (d.calibrations || []).map(c => ({ ...c, justification: String(c.justification || '').slice(0, 220) })); s = JSON.stringify(d) }
  if (s.length > 9500) { d.calibrations = (d.calibrations || []).map(c => ({ calibration_name: c.calibration_name, cal_type: c.cal_type, trigger: String(c.trigger || '').slice(0, 80), enabled: c.enabled !== false, justification: String(c.justification || '').slice(0, 120) })); s = JSON.stringify(d) }
  return s.slice(0, 9800)
}

export async function runScrubQueue(req, { max = 1 } = {}) {
  const out = { ran: 0, ok: 0, failed: 0, items: [] }
  const { row, value } = await cfgRead(req, QKEY, []); let q = Array.isArray(value) ? value : []
  const jobsMod = await import('../routes/jobs.js')
  const { createNotification } = await import('../routes/notifications.js')
  for (const item of q.slice()) {
    if (out.ran >= max) break
    out.ran++
    item.tries = (item.tries || 0) + 1
    await cfgWrite(req, QKEY, row, q)   // stamp the try first so a gateway kill can't loop forever
    const job = (await jobsMod.readJobsPublic(req)).find(j => String(j.id) === item.job)
    if (!job) { q = q.filter(x => x !== item); out.items.push({ job: item.job, result: 'card gone' }); continue }
    try {
      const { getAccessToken } = await import('./zoho.js'); const { downloadFile } = await import('./workdrive.js')
      let buffer; try { ({ buffer } = await downloadFile(item.file, await getAccessToken())) } catch (e) { throw new Error(`download: ${e.message}`) }
      if (!buffer || buffer.length < 512) throw new Error(`download: ${buffer?.length || 0} bytes`)
      const { scrubPdfBuffer } = await import('../routes/extract.js')
      let data; try { data = await scrubPdfBuffer(req, buffer) } catch (e) { throw new Error(`scrub: ${String(e.message).slice(0, 300)}`) }
      const cals = (data.calibrations || []).filter(c => c.enabled !== false)
      const names = cals.map(c => c.calibration_name).filter(Boolean)
      const patch = { ...job, calibrations: JSON.stringify(cals) }
      if (!job.insurer && data.insurer) patch.insurer = data.insurer
      if ((!job.vin || job.vin.length < 17) && data.vin?.length === 17) patch.vin = data.vin
      if (!job.quote_number && data.ro_number && !data._ro_from_vin) patch.quote_number = String(data.ro_number).slice(0, 40)
      for (const k of ['year', 'make', 'model', 'vehicle']) if (!job[k] && data[k]) patch[k] = data[k]
      // CCC abbreviates makes (TOYO, BENZ, CHEV) — the scrub's full name wins.
      if (/^[A-Z]{3,5}$/.test(String(job.make || '')) && data.make && data.make.length > 4) { patch.make = data.make; if (data.model) patch.model = data.model; patch.vehicle = data.vehicle || [patch.year || job.year, patch.make, patch.model || job.model].filter(Boolean).join(' ') }
      patch.notes = `📎 CCC estimate scrubbed · ${names.length} calibration${names.length === 1 ? '' : 's'}${names.length ? ': ' + names.join(', ') : ' found'}${data.claim ? ` · claim ${data.claim}` : ''}\n${String(job.notes || '').replace(/ · scrubbing…/, '')}`.slice(0, 9000)
      const upd = await jobsMod.updateJobPublic(req, job.id, patch)
      const { row: srow } = await cfgRead(req, `scrub_${job.id}`, null); await cfgWrite(req, `scrub_${job.id}`, srow, compactScrub({ ...data, _job: job.id, _file: item.file, _at: new Date().toISOString() }))
      q = q.filter(x => x !== item); out.ok++
      out.items.push({ job: job.id, result: 'ok', calibrations: names })
      const isQuote = ['quote', 'equote'].includes(String(upd.request_type || '').toLowerCase())
      await postToCliqChannel(DISPATCH_CHANNEL, `📎 *Estimate scrubbed* · ${upd.shop_name}${upd.vehicle ? ` · ${upd.vehicle}` : ''}${upd.quote_number ? ` · RO ${upd.quote_number}` : ''}${upd.insurer ? ` · 🏦 ${upd.insurer}` : ''}\n${names.length ? `🔧 ${names.join(', ')}` : '🔧 No calibrations found on this estimate'}\n${isQuote ? 'On the Quotes Requested column — open the card → 📎 Open scrub to price it.' : 'On Job Requested — open the card → 📎 Open scrub to build the job.'}`).catch(() => {})
      await createNotification(req, { to: 'Kath', toEmail: 'k.belmonte@absoluteadas.com', type: 'job_requested', title: `📎 Scrubbed: ${upd.shop_name} · ${names.length} calibration${names.length === 1 ? '' : 's'}`, body: `${upd.vehicle || 'Vehicle ?'}${upd.quote_number ? ` · RO ${upd.quote_number}` : ''}${names.length ? ` · ${names.join(', ')}` : ''}`.slice(0, 300), jobId: upd.id, job: upd, skipCliq: true, skipTechChannel: true }).catch(() => {})
    } catch (e) {
      console.warn(`[email intake] scrub failed for ${item.job} (try ${item.tries}):`, e.message)
      out.items.push({ job: item.job, result: `failed: ${e.message}`, tries: item.tries })
      if (item.tries >= 2) {
        q = q.filter(x => x !== item); out.failed++
        try { await jobsMod.updateJobPublic(req, job.id, { ...job, notes: `📎 CCC estimate attached — scrub failed, open the PDF in the folder.\n${String(job.notes || '').replace(/ · scrubbing…/, '')}`.slice(0, 9000) }) } catch { /* fine */ }
        await createNotification(req, { to: 'Kath', toEmail: 'k.belmonte@absoluteadas.com', type: 'job_requested', title: `📎 Scrub failed: ${job.shop_name}`, body: `${job.vehicle || 'Vehicle ?'} — the estimate is in the job folder, open it by hand.`, jobId: job.id, job, skipCliq: true, skipTechChannel: true }).catch(() => {})
      }
    }
  }
  await cfgWrite(req, QKEY, row, q)
  out.left = q.length
  return out
}

// Zoho Mail incoming webhook → sweep now (one inbox when the payload names it).
export async function handleZohoMailWebhook(req, payload) {
  const to = normEmail(payload?.toAddress || payload?.to || payload?.receiver || '')
  const inboxes = await watchedInboxes(req)
  const inboxOnly = inboxes.includes(to) ? to : ''
  const messageId = String(payload?.messageId || payload?.msgId || '')
  return sweepEmailToJob(req, { inboxOnly, messageId: inboxOnly ? messageId : '', maxPerRun: 2 })
}
