import { Router } from 'express'
import Anthropic from '@anthropic-ai/sdk'

const router = Router()

const SYSTEM = `You are Mark Fowler's planner assistant. Mark owns Absolute ADAS, a mobile ADAS calibration shop in Seattle. He just brain-dumped his head onto the page and you turn that into a structured 5:30 daily planner draft for him to review and refine.

Mark's planner has these slots:
- intention: one short sentence — the day's overall theme or focus
- big3: top 3 must-do priorities for the day. Concise action phrases (5-10 words). The most important things Mark must move on.
- delegations: tasks Mark wants to hand to Kat or Jaden (Jayden). Each has a task description and an assignee ("Kat" or "Jayden"). Pull anything Mark mentioned should be done by someone else.
- notToDo: 1-3 things Mark explicitly wants to avoid today (distractions, energy drains, things that don't move the needle).
- notes: anything else worth capturing that doesn't fit the above — context, ideas, follow-ups.

EXTRACTION RULES:
- Pull only what Mark actually said or strongly implied. Don't invent priorities he didn't mention.
- If you can't fill a slot from the dump, return an empty array / empty string for that slot — DO NOT make stuff up.
- Big 3 should genuinely be the BIG things, not minor tasks. If Mark only mentions one or two big rocks, leave the rest empty.
- For delegations, only include if Mark mentioned someone else doing it.
- Keep phrasing crisp and Mark's own voice — don't over-formalize.

OUTPUT FORMAT — raw JSON only (no markdown, no preamble):
{
  "intention": "<one sentence>",
  "big3": ["...", "...", "..."],
  "delegations": [{"task": "...", "assignee": "Kat" | "Jayden"}],
  "notToDo": ["...", "...", "..."],
  "notes": "<short string of leftover context>"
}

If a slot has no content, return "" or [] for that slot.`

// POST /api/planner/brain-dump — public (planner is a separate app, no auth)
router.post('/brain-dump', async (req, res) => {
  try {
    const text = (req.body?.text || '').trim()
    if (!text) return res.status(400).json({ error: 'text is required' })
    if (text.length > 8000) return res.status(400).json({ error: 'text too long (max 8000 chars)' })

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const aiRes = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 1000,
      system: SYSTEM,
      messages: [{ role: 'user', content: text }],
    })
    const raw = (aiRes.content[0]?.text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')

    let parsed
    try { parsed = JSON.parse(raw) }
    catch { return res.status(500).json({ error: 'Claude returned invalid JSON', raw: raw.slice(0, 500) }) }

    res.json({ ok: true, ...parsed })
  } catch (err) {
    console.error('[brain-dump]', err.response?.data || err.message)
    res.status(500).json({ ok: false, error: err.message })
  }
})

export default router
