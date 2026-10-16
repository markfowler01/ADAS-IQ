// 🧭 "How I work" — a signed-in person's OWN short summary (strengths only).
// Scores, answers and the deep report are Mark-only (routes/comp.js).
import express from 'express'
const router = express.Router()
router.get('/me', async (req, res) => {
  try {
    const { findMemberByIdentity } = await import('./team.js')
    const m = await findMemberByIdentity(req, req.user?.email, req.user?.name)
    if (!m) return res.json({ done: false })
    const { cfgReadJson } = await import('./people.js')
    const rec = await cfgReadJson(req, `mpp:${String(m.id).replace(/[^a-z0-9_]/gi, '')}`, null)
    res.json({ done: !!rec?.taken_at, simple: rec?.simple || null })
  } catch (e) { res.status(500).json({ error: e.message }) }
})
export default router
