// Planner delegations from messages — reads Mark's unread mail (and Cliq once the
// ZohoCliq.Messages.READ scope is granted), then AI-extracts action items / things
// people committed to, formatted for the 5:30 app's Delegations section.
//
//   GET /api/planner/delegations   -> { ok, delegations: [{ task, assignee, who, source, due }] }
//
// Public (the 5:30 app has no auth), best-effort: a dead source is skipped, never fatal.
import { Router } from 'express'
import Anthropic from '@anthropic-ai/sdk'
import {
  getMailAccessToken, getMailAccountId, getUnreadInboxMessages, getMessageContent,
} from '../services/mail.js'

const router = Router()
const SCAN_REPORTS_FOLDER_ID = '147686000000057026' // postscan folder — not commitments

const stripHtml = s => String(s || '')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&amp;|&lt;|&gt;|&#\d+;/g, ' ')
  .replace(/\s+/g, ' ').trim()

async function safe(label, fn) {
  try { return await fn() } catch (e) { console.error('[delegations]', label, e.message); return null }
}

async function getEmailBlocks() {
  return (await safe('email', async () => {
    const token = await getMailAccessToken()
    const accountId = await getMailAccountId(token)
    const unread = (await getUnreadInboxMessages(token, accountId)) || []
    const usable = unread.filter(m => String(m.folderId) !== SCAN_REPORTS_FOLDER_ID).slice(0, 10)
    const blocks = await Promise.all(usable.map(m =>
      safe('email:msg', () => getMessageContent(token, accountId, m.folderId, m.messageId))
        .then(c => {
          const body = stripHtml(c?.content || c?.body || '').slice(0, 700)
          const from = m.fromAddress || m.sender || 'unknown'
          return body ? `SOURCE: email\nFROM: ${from}\nSUBJECT: ${m.subject || ''}\n${body}` : null
        })))
    return blocks.filter(Boolean)
  })) || []
}

const SYSTEM = `You are Mark Fowler's chief of staff. Mark owns Absolute ADAS, a mobile ADAS calibration shop in Seattle. His team is Kat (office/admin) and Jayden (technician, also called Jaden/Jay).

You are given his unread messages (email, and Cliq chat when available). Pull out every ACTION ITEM and COMMITMENT — anything that someone needs to do, follow up on, answer, or that someone promised. These become cards in his "Delegations" list so nothing slips.

For each item produce:
- task: a short imperative action phrase in Mark's voice (5-12 words). e.g. "Send Mike the calibration quote", "Follow up with Kat on parts order".
- assignee: who should own it — "Kat", "Jayden", or "Mark" if it's Mark's own to do. Best guess; default "Mark".
- who: the person the item involves / came from (a name or email). "" if unclear.
- source: "email" or "cliq" — where it came from.
- due: an ISO date (YYYY-MM-DD) ONLY if a date/deadline is explicitly stated; otherwise "".

RULES:
- Only include real action items or commitments. Skip newsletters, receipts, automated notices, marketing, FYI-only messages.
- One card per distinct action. Don't merge unrelated asks.
- Keep Mark's plain, direct voice. Don't over-formalize.
- If there are no real action items, return an empty array.

OUTPUT — raw JSON only, no markdown, no preamble:
{ "delegations": [ { "task": "...", "assignee": "Kat|Jayden|Mark", "who": "...", "source": "email|cliq", "due": "" } ] }`

router.get('/delegations', async (req, res) => {
  try {
    const blocks = await getEmailBlocks() // + cliq blocks once Messages.READ is granted
    if (!blocks.length) {
      return res.json({ ok: true, delegations: [], note: 'No unread messages with action items (Cliq read still pending token scope).' })
    }
    const text = blocks.join('\n\n---\n\n').slice(0, 8000)
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 15000, maxRetries: 1 })
    const aiRes = await client.messages.create({
      model: 'claude-haiku-4-5', max_tokens: 1200, system: SYSTEM,
      messages: [{ role: 'user', content: text }],
    })
    const raw = (aiRes.content[0]?.text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
    let parsed
    try { parsed = JSON.parse(raw) } catch { return res.status(500).json({ ok: false, error: 'invalid JSON from model', raw: raw.slice(0, 400) }) }
    res.json({ ok: true, delegations: Array.isArray(parsed.delegations) ? parsed.delegations : [] })
  } catch (err) {
    console.error('[planner-delegations]', err.response?.data || err.message)
    res.status(500).json({ ok: false, error: err.message })
  }
})

export default router
