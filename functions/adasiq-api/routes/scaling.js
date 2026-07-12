// Scaling pipeline — one row per tech/van scale-up (hire → train → van →
// buildout → tools → systems). Rows live in the `ScalingPipeline` Datastore
// table (name varchar mandatory, target_date varchar, status varchar,
// data_json text — holds the task board + cost tracker as JSON).
// Datastore, not Cache: pipelines run for months, far past the 48h TTL cap.
//
// NOTE: the table must be created by hand in the Catalyst console (Data
// Store → Create Table) — Catalyst has no public API for table creation.
// Until it exists, GET / returns a 500 with a clear setup message.

import express from 'express'
import catalyst from 'zcatalyst-sdk-node'

const router = express.Router()
const TABLE = 'ScalingPipeline'

function app(req) {
  return catalyst.initialize(req, { type: 'advancedio' })
}

function getTable(req) {
  return app(req).datastore().table(TABLE)
}

function isAdmin(req) { return req.user?.role !== 'technician' }

function rowToPipeline(row) {
  const r = row[TABLE] || row
  let data = {}
  try { data = JSON.parse(r.data_json || '{}') } catch { data = {} }
  return {
    id: String(r.ROWID), // ROWIDs exceed MAX_SAFE_INTEGER — never Number()
    name: r.name || '',
    target_date: r.target_date || '',
    status: r.status || 'active',
    data,
    created: r.CREATEDTIME || null,
    modified: r.MODIFIEDTIME || null,
  }
}

// GET / — all pipelines, newest first
router.get('/', async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' })
    const rows = await app(req).zcql().executeZCQLQuery(
      `SELECT ROWID, CREATEDTIME, MODIFIEDTIME, name, target_date, status, data_json FROM ${TABLE} ORDER BY CREATEDTIME DESC`
    )
    res.json({ ok: true, pipelines: (rows || []).map(rowToPipeline) })
  } catch (e) {
    console.error('scaling list error:', e?.message || e)
    res.status(500).json({ error: 'Failed to load pipelines. Does the ScalingPipeline table exist?' })
  }
})

// POST / — create a pipeline { name, target_date, data }
router.post('/', async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' })
    const { name, target_date = '', data = {} } = req.body || {}
    if (!name) return res.status(400).json({ error: 'name required' })
    const row = await getTable(req).insertRow({
      name: String(name),
      target_date: String(target_date || ''),
      status: 'active',
      data_json: JSON.stringify(data),
    })
    res.json({ ok: true, pipeline: rowToPipeline(row) })
  } catch (e) {
    console.error('scaling create error:', e?.message || e)
    res.status(500).json({ error: 'Failed to create pipeline' })
  }
})

// PUT /:id — update { name?, target_date?, status?, data? }
router.put('/:id', async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' })
    const { name, target_date, status, data } = req.body || {}
    const update = { ROWID: String(req.params.id) }
    if (name !== undefined) update.name = String(name)
    if (target_date !== undefined) update.target_date = String(target_date)
    if (status !== undefined) update.status = String(status)
    if (data !== undefined) update.data_json = JSON.stringify(data)
    const row = await getTable(req).updateRow(update)
    res.json({ ok: true, pipeline: rowToPipeline(row) })
  } catch (e) {
    console.error('scaling update error:', e?.message || e)
    res.status(500).json({ error: 'Failed to update pipeline' })
  }
})

// DELETE /:id
router.delete('/:id', async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' })
    await getTable(req).deleteRow(String(req.params.id))
    res.json({ ok: true })
  } catch (e) {
    console.error('scaling delete error:', e?.message || e)
    res.status(500).json({ error: 'Failed to delete pipeline' })
  }
})

export default router
