// Item Map API — backs the More → Item Mapping screen (Mark 2026-08-11).
//
//   GET    /api/item-map          → { map, books_items, vocab }
//   PUT    /api/item-map          { kinetic_name, item_name, item_id } — upsert one
//   POST   /api/item-map/delete   { kinetic_name }
//   POST   /api/item-map/seed     → Claude proposes pairings for every
//                                   unmapped vocab entry; stored source:'seed'
//
// Mounted with requireAuth. See services/itemMap.js for storage.

import express from 'express'
import {
  readItemMap, upsertMapping, deleteMapping, normalizeMapKey, KINETIC_SENSOR_VOCAB,
} from '../services/itemMap.js'
import { getItemCatalogForAudit } from '../services/zoho.js'

const router = express.Router()

router.get('/', async (req, res) => {
  try {
    const [map, catalog] = await Promise.all([
      readItemMap(req),
      getItemCatalogForAudit().catch(e => {
        console.warn('[item-map] catalog fetch failed:', e.message)
        return { allItems: [] }
      }),
    ])
    // Diagnostic: AppConfig total rows. Full-table scans cap at 20k —
    // if this number approaches that, card notes / tech to-dos / push
    // subs need the same index-row treatment this map now uses.
    let table_rows = null
    try {
      const catalystMod = (await import('zcatalyst-sdk-node')).default
      const app = catalystMod.initialize(req, { type: 'advancedio' })
      const r = await app.zcql().executeZCQLQuery('SELECT COUNT(ROWID) FROM AppConfig')
      const row = r?.[0]?.AppConfig || r?.[0] || {}
      table_rows = Number(Object.values(row)[0]) || null
    } catch { /* diagnostic only */ }

    res.json({
      ok: true,
      map,
      books_items: (catalog.allItems || []).sort((a, b) => a.name.localeCompare(b.name)),
      vocab: KINETIC_SENSOR_VOCAB,
      table_rows,
    })
  } catch (err) {
    console.error('[item-map GET]', err.message)
    res.status(500).json({ error: err.message })
  }
})

router.put('/', async (req, res) => {
  try {
    const { kinetic_name, item_name, item_id } = req.body || {}
    if (!kinetic_name || !item_name) {
      return res.status(400).json({ error: 'kinetic_name and item_name required' })
    }
    await upsertMapping(req, kinetic_name, { item_name, item_id: item_id || '', source: 'manual' })
    res.json({ ok: true, key: normalizeMapKey(kinetic_name) })
  } catch (err) {
    console.error('[item-map PUT]', err.message)
    res.status(500).json({ error: err.message })
  }
})

router.post('/delete', async (req, res) => {
  try {
    const { kinetic_name } = req.body || {}
    if (!kinetic_name) return res.status(400).json({ error: 'kinetic_name required' })
    const removed = await deleteMapping(req, kinetic_name)
    res.json({ ok: true, removed })
  } catch (err) {
    console.error('[item-map delete]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// Seed: Claude proposes a Books item for every vocab entry that isn't
// mapped yet. Existing mappings are never overwritten.
// ── Pricing Brain (Mark 2026-08-29 fix #1): learned insurer tiers ──────
router.get('/tiers', async (req, res) => {
  try {
    const { readTierMap } = await import('../services/tierMap.js')
    const map = await readTierMap(req)
    const entries = Object.entries(map).map(([key, item]) => {
      const [pool, make, cal] = key.split('|')
      return { key, pool, make, calibration: cal, item }
    }).sort((a, z) => (a.pool + a.make + a.calibration).localeCompare(z.pool + z.make + z.calibration))
    res.json({ ok: true, entries })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.post('/tiers/delete', async (req, res) => {
  try {
    if (req.user?.role === 'technician') return res.status(403).json({ error: 'Staff only' })
    const key = String(req.body?.key || '')
    if (!key) return res.status(400).json({ error: 'key required' })
    const { deleteTierMapping } = await import('../services/tierMap.js')
    res.json({ ok: true, ...(await deleteTierMapping(req, key)) })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.post('/seed', async (req, res) => {
  try {
    const [map, catalog] = await Promise.all([readItemMap(req), getItemCatalogForAudit()])
    const unmapped = KINETIC_SENSOR_VOCAB.filter(n => !map[normalizeMapKey(n)])
    if (unmapped.length === 0) {
      return res.json({ ok: true, seeded: 0, message: 'Everything already mapped' })
    }
    const { proposeItemMap } = await import('../services/claude.js')
    const proposals = await proposeItemMap({
      kineticNames: unmapped,
      catalogItems: catalog.allItems || [],
    })
    let seeded = 0
    const skipped = []
    for (const p of proposals) {
      if (p?.kinetic_name && p.item_name && p.item_id) {
        await upsertMapping(req, p.kinetic_name, {
          item_name: p.item_name, item_id: p.item_id, source: 'seed',
        })
        seeded++
      } else if (p?.kinetic_name) {
        skipped.push(p.kinetic_name)
      }
    }
    res.json({ ok: true, seeded, skipped })
  } catch (err) {
    console.error('[item-map seed]', err.message)
    res.status(500).json({ error: err.message })
  }
})

export { router as itemMapRouter }
