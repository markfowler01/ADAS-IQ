// Per-technician to-do lists for the Live view (Mark 2026-07-24).
// Storage: AppConfig KV rows `tech_todos:<tech lowercase>` holding a
// JSON array of { id, text, done, created_at }. Durable (Datastore),
// same pattern as customer card notes.
//
//   GET  /api/tech-todos          → { todos: { "<Tech>": [items] } }
//   POST /api/tech-todos          { technician, todos: [items] } — replaces that tech's list

import express from 'express'
import catalyst from 'zcatalyst-sdk-node'

const router = express.Router()
const TABLE = 'AppConfig'
const PREFIX = 'tech_todos:'

function todoKey(tech) {
  return (PREFIX + String(tech || '').toLowerCase().trim()).slice(0, 64)
}

// Paginated prefix scan — AppConfig grows daily (invoice stamps, day
// totals, tombstones), single LIMIT windows silently drop rows.
router.get('/', async (req, res) => {
  try {
    const app = catalyst.initialize(req, { type: 'advancedio' })
    const todos = {}
    const PAGE = 250
    for (let offset = 0; offset < 20000; offset += PAGE) {
      const rows = await app.zcql().executeZCQLQuery(
        `SELECT config_key, config_value FROM ${TABLE} LIMIT ${PAGE} OFFSET ${offset}`
      )
      for (const row of rows || []) {
        const r = row[TABLE] || row
        const key = String(r?.config_key || '')
        if (key.startsWith(PREFIX) && r.config_value) {
          const tech = key.slice(PREFIX.length)
          try {
            const arr = JSON.parse(r.config_value)
            if (Array.isArray(arr)) todos[tech] = arr
          } catch { /* skip malformed */ }
        }
      }
      if (!rows || rows.length < PAGE) break
    }
    res.json({ ok: true, todos })
  } catch (err) {
    console.error('[tech-todos GET]', err.message)
    res.status(500).json({ error: err.message })
  }
})

router.post('/', async (req, res) => {
  try {
    const tech = String(req.body?.technician || '').trim()
    if (!tech) return res.status(400).json({ error: 'technician required' })
    const todos = (Array.isArray(req.body?.todos) ? req.body.todos : [])
      .map(t => ({
        id:         String(t?.id || `t_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`),
        text:       String(t?.text || '').trim().slice(0, 300),
        done:       !!t?.done,
        created_at: String(t?.created_at || new Date().toISOString()),
      }))
      .filter(t => t.text)
      .slice(0, 50)

    const app = catalyst.initialize(req, { type: 'advancedio' })
    const key = todoKey(tech)
    const rows = await app.zcql().executeZCQLQuery(
      `SELECT ROWID FROM ${TABLE} WHERE config_key = '${key.replace(/'/g, "''")}' LIMIT 1`
    )
    const existing = rows?.[0]?.[TABLE] || rows?.[0] || null
    const table = app.datastore().table(TABLE)
    const value = JSON.stringify(todos)
    if (existing?.ROWID) {
      await table.updateRow({ ROWID: String(existing.ROWID), config_key: key, config_value: value })
    } else {
      await table.insertRow({ config_key: key, config_value: value })
    }
    res.json({ ok: true, technician: tech, count: todos.length })
  } catch (err) {
    console.error('[tech-todos POST]', err.message)
    res.status(500).json({ error: err.message })
  }
})

export { router as techTodosRouter }
