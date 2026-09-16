// Insurer families API (2026-09-16). Everyone reads; owners edit; staff can teach one.
import express from 'express'
import { loadFamilies, saveFamilies, learnInsurer, familyFor, POOLS } from '../services/insurerFamilies.js'
const router = express.Router()
const MARK = ['mark@absoluteadas.com', 'mf@absoluteadas.com', 'mfowler4456@gmail.com']
const isOwner = req => MARK.includes(String(req.user?.email || '').toLowerCase()) || req.user?.role === 'owner'
router.get('/families', async (req, res) => { try { res.json({ ok: true, families: await loadFamilies(req), pools: POOLS, editable: isOwner(req) }) } catch (e) { res.status(500).json({ error: e.message }) } })
router.put('/families', async (req, res) => {
  try { if (!isOwner(req)) return res.status(403).json({ error: 'Owners only' }); res.json({ ok: true, families: await saveFamilies(req, req.body?.families) }) } catch (e) { res.status(500).json({ error: e.message }) }
})
router.post('/learn', async (req, res) => {
  try { if (req.user?.role === 'technician') return res.status(403).json({ error: 'Ask Kat or Mark' }); await loadFamilies(req); res.json({ ok: true, families: await learnInsurer(req, req.body?.insurer, req.body?.pool, req.user?.name), family: familyFor(req.body?.insurer) }) } catch (e) { res.status(500).json({ error: e.message }) }
})
router.get('/resolve', async (req, res) => { try { await loadFamilies(req); res.json({ ok: true, family: familyFor(req.query.insurer) }) } catch (e) { res.status(500).json({ error: e.message }) } })
export default router
