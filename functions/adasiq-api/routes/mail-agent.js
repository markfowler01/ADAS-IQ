import { Router } from 'express'
import catalyst from 'zcatalyst-sdk-node'
import Anthropic from '@anthropic-ai/sdk'
import {
  getMailAccessToken,
  getMailAccountId,
  getAllMailAccounts,
  getUnreadInboxMessages,
  getRecentSentMessages,
  getMessageContent,
  saveDraftReply,
} from '../services/mail.js'
import { listCustomers } from '../services/zoho.js'
import { postToCliqUser, TECH_CLIQ_IDS } from '../services/cliq.js'

const router = Router()

const SYSTEM_PROMPT = `You are Mark Fowler's executive assistant. Mark owns Absolute ADAS, a mobile ADAS calibration shop in the Pacific Northwest that serves body shops and dealerships. You triage every incoming email and decide:

1) priority — would a sharp EA interrupt Mark for this?
2) is this a client (existing or potential customer)? — used for routing
3) draft a reply (if it warrants a personal response)

PRIORITY — BIAS TOWARD "important". When in doubt, use "important" rather than "normal", and "normal" rather than "noise". Missing something important is far worse than an extra ping.
- "important" — Mark needs to see this within the hour. This is a broad category. Include:
  · Any existing client communication (scheduling, questions, complaints, status checks)
  · New customer inquiries or anyone asking about calibration services / pricing
  · Vendor issues (delayed parts, equipment problems, billing disputes)
  · Time-sensitive items (legal, tax, insurance, contract deadlines, regulatory notices)
  · Anything involving money moving: payment received, invoice paid, refund, dispute — even from a no-reply system if it names a specific business
  · Job requests, work authorizations, or insurance approvals
  · Anything from a body shop, dealership, fleet manager, or insurance adjuster
  · Urgent personal matters
  · ANY email where a 1-hour delay could cost money, damage a relationship, or miss an opportunity
- "normal" — routine correspondence, non-urgent. Friendly vendor updates, casual personal email, FYI with no action needed.
- "noise" — Mark would delete without reading. Mass newsletters, marketing blasts, account/password notifications, automated system alerts with no business relevance, calendar confirmations, unsubscribe confirmations. DO NOT classify something as noise if there is any chance it involves a client or money.

IS_CLIENT:
- true if the sender is or appears to be a customer: body shop, dealership, insurance adjuster, fleet manager, technician, or anyone asking about calibration services / pricing / scheduling / work-in-progress.
- false otherwise.

DRAFT (only for important/normal — skip for noise):
- Concise. 2-4 short paragraphs max.
- Professional but friendly. No corporate fluff, no "I hope this email finds you well", no "thank you for reaching out".
- First-person as Mark. Sign off: "— Mark"
- Don't apologize unnecessarily.
- Don't make up facts. Use bracketed placeholders like [check pricing] or write "let me confirm and circle back" if needed.

OUTPUT FORMAT:
Return ONLY raw JSON (no markdown, no preamble) in this exact shape:
{"priority": "important" | "normal" | "noise", "isClient": true | false, "draft": "<reply body>" | null, "summary": "<one short sentence summarizing what they want and why it matters>"}

If priority is "noise", set draft to null. Always include a summary.`

function isAutomatedFrom(from) {
  if (!from) return false
  const f = String(from).toLowerCase()
  return /noreply|no-reply|donotreply|do-not-reply|mailer-daemon|bounce|@notification|@notifications|automated@/.test(f)
}

function extractEmail(addr) {
  if (!addr) return ''
  const m = String(addr).match(/<([^>]+)>/)
  return (m ? m[1] : addr).trim().toLowerCase()
}

function htmlEscape(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function toHtmlBody(plain) {
  const lines = String(plain).split('\n').map(l => l.trim())
  return '<div>' + lines.map(l => l ? '<p>' + htmlEscape(l) + '</p>' : '<br>').join('') + '</div>'
}

// Build an email -> {shopName, contactName, source} lookup from BOTH CRM Datastore and Zoho Books customers.
async function loadCrmContactLookup(req) {
  const lookup = new Map()

  // Source 1: CRM shops (Catalyst Datastore)
  try {
    const app = catalyst.initialize(req, { type: 'advancedio' })
    const rows = await app.datastore().table('CRMShops').getAllRows()
    function parse(val) { try { return JSON.parse(val) } catch { return val } }
    for (const row of (rows || [])) {
      const r = row.CRMShops || row
      const shopName = r.shop_name || ''
      if (r.email) {
        lookup.set(String(r.email).toLowerCase().trim(), { shopName, contactName: r.contact_name || '', source: 'crm' })
      }
      const people = typeof r.people === 'string' ? parse(r.people) : (r.people || [])
      for (const p of (people || [])) {
        if (p?.email) {
          lookup.set(String(p.email).toLowerCase().trim(), { shopName, contactName: p.name || '', source: 'crm' })
        }
      }
    }
  } catch (e) {
    console.warn('[mail-agent] CRM load failed:', e.message)
  }

  // Source 2: Zoho Books customers (don't overwrite an existing CRM hit — CRM has richer naming)
  try {
    const customers = await listCustomers()
    for (const c of (customers || [])) {
      if (!c.email) continue
      const key = String(c.email).toLowerCase().trim()
      if (lookup.has(key)) continue
      lookup.set(key, {
        shopName: c.company_name || c.contact_name || '',
        contactName: c.contact_name || '',
        source: 'books',
      })
    }
  } catch (e) {
    console.warn('[mail-agent] Books customer load failed:', e.message)
  }

  return lookup
}

async function sendCliqAlert(text) {
  try {
    await postToCliqUser(TECH_CLIQ_IDS.Mark, text)
    return { sent: true }
  } catch (e) {
    console.warn('[mail-agent] Cliq alert failed:', e.response?.data || e.message)
    return { sent: false, reason: e.response?.data || e.message }
  }
}

function buildClientAlert({ kind, fromAddr, subject, summary, shopName, contactName }) {
  const who = shopName
    ? `${contactName ? contactName + ' @ ' : ''}${shopName}`
    : fromAddr
  const tag =
    kind === 'existing' ? '🔔 *Existing client*' :
    kind === 'new'      ? '🆕 *New / potential client*' :
                          '⚠️ *Important*'
  const lines = [
    `${tag}: ${who}`,
    `_Subject:_ ${subject}`,
  ]
  if (summary) lines.push(`_Summary:_ ${summary}`)
  lines.push(`_Draft saved in Zoho Mail._`)
  return lines.join('\n')
}

// POST /api/mail-agent/run — cron-triggered: read ALL inboxes (primary + group), alert on client emails via Cliq, draft replies
router.post('/run', async (req, res) => {
  const cronSecret = process.env.MAIL_AGENT_CRON_SECRET
  if (cronSecret && req.headers['x-cron-secret'] !== cronSecret) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    const token = await getMailAccessToken()

    // Fetch unread messages from ALL accounts (primary + group inboxes like info@, postscan@, etc.)
    const accounts = await getAllMailAccounts(token)
    const allMessages = []
    for (const acct of accounts) {
      try {
        const msgs = await getUnreadInboxMessages(token, acct.accountId)
        for (const m of msgs) {
          allMessages.push({ ...m, _accountId: acct.accountId, _accountEmail: acct.emailAddress?.[0]?.mailId || '' })
        }
      } catch (e) {
        console.warn(`[mail-agent] failed to fetch inbox for account ${acct.accountId}:`, e.message)
      }
    }

    const segment = catalyst.initialize(req).cache().segment()
    const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const crmLookup = await loadCrmContactLookup(req)

    // Load cached voice profile and auto-refresh once per day.
    let voiceProfile = ''
    let voiceUpdatedAt = 0
    try {
      const v = await segment.getValue('mail_agent_voice_profile')
      if (v) { const parsed = JSON.parse(v); voiceProfile = parsed.profile || ''; voiceUpdatedAt = parsed.updatedAt || 0 }
    } catch {}
    const ONE_DAY = 24 * 60 * 60 * 1000
    const profileStale = !voiceProfile || (Date.now() - voiceUpdatedAt) > ONE_DAY
    if (profileStale) {
      try {
        const refreshed = await refreshVoiceProfile(req, segment, claude)
        if (refreshed.ok) voiceProfile = refreshed.preview ? (await segment.getValue('mail_agent_voice_profile').then(v => JSON.parse(v).profile).catch(() => voiceProfile)) : voiceProfile
        console.log('[mail-agent] voice profile refresh:', refreshed)
      } catch (e) { console.warn('[mail-agent] voice refresh failed:', e.message) }
    }

    const results = []
    let drafted = 0
    let alerted = 0

    for (const msg of allMessages) {
      const msgId = String(msg.messageId)
      const accountId = msg._accountId
      const cacheKey = `mail_agent_drafted_${msgId}`

      const force = req.query.force === 'true'
      if (!force) {
        try {
          const cached = await segment.getValue(cacheKey)
          if (cached) { results.push({ msgId, status: 'already-processed' }); continue }
        } catch {}
      }

      const fromRaw = msg.fromAddress || msg.sender || ''
      const fromEmail = extractEmail(fromRaw)
      // Hard-skip only bounces — everything else (including no-reply transactional) goes to Claude
      if (/mailer-daemon|@bounce/i.test(fromRaw)) {
        results.push({ msgId, status: 'bounce-skip', from: fromRaw, subject: msg.subject })
        await segment.put(cacheKey, JSON.stringify({ skipped: 'bounce', ts: Date.now() })).catch(() => {})
        continue
      }

      const crmHit = crmLookup.get(fromEmail) || null

      try {
        const content = await getMessageContent(token, accountId, msg.folderId, msgId)
        const rawBody = content.content || content.body || ''
        const bodyText = String(rawBody).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 5000)
        const subject = msg.subject || '(no subject)'

        const systemWithVoice = voiceProfile
          ? `${SYSTEM_PROMPT}\n\n## MARK'S WRITING VOICE — match this when drafting:\n${voiceProfile}`
          : SYSTEM_PROMPT
        const aiRes = await claude.messages.create({
          model: 'claude-haiku-4-5',
          max_tokens: 1000,
          system: systemWithVoice,
          messages: [{ role: 'user', content:
            `From: ${fromRaw}\nSubject: ${subject}\n\nBody:\n${bodyText}\n\nReturn the JSON.`
          }],
        })
        const aiText = (aiRes.content[0]?.text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
        let parsed
        try { parsed = JSON.parse(aiText) } catch { parsed = { priority: 'noise', isClient: false, draft: null, summary: '' } }

        const priority = parsed.priority || 'noise'
        const isClient = !!parsed.isClient
        const summary = parsed.summary || ''
        const draftBody = parsed.draft || null

        // Alert rules — in priority order:
        // 1. ALWAYS alert if sender is a known Zoho Books / CRM contact (never miss a client)
        // 2. Alert if Claude flagged important (any sender)
        // 3. Alert if Claude flagged normal + thinks it's a client (new shop not in CRM yet)
        let cliqResult = null
        const shouldAlert = crmHit  // known client — always alert regardless of Claude's classification
          || priority === 'important'
          || (priority === 'normal' && isClient)
        if (shouldAlert) {
          const alertText = buildClientAlert({
            kind: crmHit ? 'existing' : (isClient ? 'new' : 'important'),
            fromAddr: fromEmail,
            subject,
            summary,
            shopName: crmHit?.shopName,
            contactName: crmHit?.contactName,
          })
          cliqResult = await sendCliqAlert(alertText)
          if (cliqResult.sent) alerted++
        }

        // Draft reply if AI gave one
        let draftResult = null
        if (draftBody && priority !== 'noise') {
          const replySubject = /^re:/i.test(subject) ? subject : 'Re: ' + subject
          try {
            const draftRes = await saveDraftReply(token, accountId, {
              to: fromEmail,
              subject: replySubject,
              body: toHtmlBody(draftBody),
              inReplyTo: msgId,
            })
            const draftId = draftRes?.messageId || draftRes?.message_id || null
            draftResult = { ok: true, draftId }
            drafted++
          } catch (e) {
            draftResult = { ok: false, error: e.response?.data || e.message }
          }
        }

        await segment.put(cacheKey, JSON.stringify({
          priority, isClient, crmHit: !!crmHit, alerted: !!cliqResult?.sent, draftId: draftResult?.draftId, ts: Date.now(),
        })).catch(() => {})

        results.push({
          msgId,
          inbox: msg._accountEmail,
          from: fromEmail,
          subject,
          priority,
          isClient,
          crmHit: crmHit ? { shopName: crmHit.shopName, contactName: crmHit.contactName } : null,
          cliq: cliqResult,
          draft: draftResult,
        })
      } catch (e) {
        const err = e.response?.data || e.message
        results.push({ msgId, status: 'error', inbox: msg._accountEmail, error: typeof err === 'string' ? err : JSON.stringify(err).slice(0, 300) })
      }
    }

    res.json({ ok: true, accounts: accounts.length, scanned: allMessages.length, drafted, alerted, crmContactsKnown: crmLookup.size, results })
  } catch (err) {
    console.error('[mail-agent] failed:', err.response?.data || err.message)
    res.status(500).json({ ok: false, error: err.message, detail: err.response?.data })
  }
})

// GET /api/mail-agent/debug — env presence + CRM lookup size
const VOICE_LEARN_PROMPT = `You analyze a set of emails written by Mark Fowler (owner of Absolute ADAS, mobile ADAS calibration shop in Seattle) and produce a concise STYLE PROFILE that another AI can use to draft replies in his voice.

Cover:
- Typical opening (does he greet? skip greetings?)
- Sentence length and rhythm
- Tone (warm/curt, formal/casual, dry humor?)
- Recurring phrases he uses
- How he closes (sign-off, what comes before it)
- Things he NEVER says (corporate fluff, "kind regards", etc.)
- How he handles different audiences (clients, vendors, friends)

Output the profile as plain prose, ~150-250 words, written in second person ("Mark opens with...", "Use short sentences..."). No headings, no bullets. Tight and actionable.`

async function buildVoiceProfile(claude, sentSamples) {
  const samples = sentSamples
    .filter(s => s.body && s.body.length > 30)
    .slice(0, 30)
    .map((s, i) => `--- Email ${i + 1} ---\nSubject: ${s.subject}\n\n${s.body.slice(0, 1500)}`)
    .join('\n\n')
  const aiRes = await claude.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 600,
    system: VOICE_LEARN_PROMPT,
    messages: [{ role: 'user', content:
      `Here are ${sentSamples.length} emails Mark has sent. Extract his style profile.\n\n${samples}`
    }],
  })
  return (aiRes.content[0]?.text || '').trim()
}

async function refreshVoiceProfile(req, segment, claude) {
  const token = await getMailAccessToken()
  const accountId = await getMailAccountId(token)
  const sentList = await getRecentSentMessages(token, accountId, 25)
  if (!sentList.length) return { ok: false, reason: 'no sent messages found' }
  // Fetch bodies
  const samples = []
  for (const m of sentList) {
    try {
      const c = await getMessageContent(token, accountId, m.folderId, String(m.messageId))
      const raw = c.content || c.body || ''
      const text = String(raw).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
      samples.push({ subject: m.subject || '', body: text })
    } catch {}
  }
  if (!samples.length) return { ok: false, reason: 'no fetchable bodies' }
  const profile = await buildVoiceProfile(claude, samples)
  await segment.put('mail_agent_voice_profile', JSON.stringify({ profile, updatedAt: Date.now(), samplesUsed: samples.length })).catch(async () => {
    await segment.update('mail_agent_voice_profile', JSON.stringify({ profile, updatedAt: Date.now(), samplesUsed: samples.length }))
  })
  return { ok: true, samplesUsed: samples.length, preview: profile.slice(0, 200) }
}

// POST /api/mail-agent/learn-style — one-time (or on-demand) voice profile rebuild from Sent folder
router.post('/learn-style', async (req, res) => {
  const cronSecret = process.env.MAIL_AGENT_CRON_SECRET
  if (cronSecret && req.headers['x-cron-secret'] !== cronSecret) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  try {
    const segment = catalyst.initialize(req).cache().segment()
    const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const result = await refreshVoiceProfile(req, segment, claude)
    res.json(result)
  } catch (err) {
    res.status(500).json({ ok: false, error: err.response?.data || err.message })
  }
})

router.get('/debug', async (req, res) => {
  const out = {
    env_anthropic: !!process.env.ANTHROPIC_API_KEY,
    env_mail_refresh: !!process.env.ZOHO_MAIL_REFRESH_TOKEN,
    env_cron_secret: !!process.env.MAIL_AGENT_CRON_SECRET,
    env_cliq_webhook: !!process.env.ZOHO_CLIQ_WEBHOOK_URL,
  }
  try {
    const lookup = await loadCrmContactLookup(req)
    out.crm_contacts_loaded = lookup.size
  } catch (e) {
    out.crm_load_error = e.message
  }
  res.json(out)
})

// POST /api/mail-agent/cliq-test — sends a test message to confirm the Cliq webhook works
router.post('/cliq-test', async (req, res) => {
  const cronSecret = process.env.MAIL_AGENT_CRON_SECRET
  if (cronSecret && req.headers['x-cron-secret'] !== cronSecret) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  const result = await sendCliqAlert('🧪 Test ping from ADAS IQ mail agent — if you see this on your phone, Cliq alerts are wired up.')
  res.json(result)
})

export default router
