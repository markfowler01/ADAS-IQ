import express from 'express'
import catalyst from 'zcatalyst-sdk-node'

const router = express.Router()

// GET /api/jobs — fetch all jobs
router.get('/', async (req, res) => {
  try {
    const app = catalyst.initialize(req, { type: catalyst.type.ADVANCEDIO })
    const table = app.datastore().table('Jobs')
    const rows = await table.getAllRows()
    res.json(rows)
  } catch (err) {
    console.error('[jobs GET]', err.message)
    res.status(500).json({ error: err.message || 'Failed to fetch jobs' })
  }
})

// POST /api/jobs — create a job
router.post('/', async (req, res) => {
  try {
    const app = catalyst.initialize(req, { type: catalyst.type.ADVANCEDIO })
    const table = app.datastore().table('Jobs')
    const {
      shop_name,
      vehicle,
      vin,
      technician,
      scheduled_date,
      calibrations,
      notes,
      report_url,
      status,
      created_at,
    } = req.body

    const data = {
      shop_name: shop_name || '',
      vehicle: vehicle || '',
      vin: vin || '',
      technician: technician || '',
      scheduled_date: scheduled_date || '',
      calibrations: typeof calibrations === 'string' ? calibrations : JSON.stringify(calibrations || []),
      notes: notes || '',
      report_url: report_url || '',
      status: status || 'scheduled',
      created_at: created_at || new Date().toISOString(),
    }

    const row = await table.insertRow(data)
    res.status(201).json(row)
  } catch (err) {
    console.error('[jobs POST]', err.message)
    res.status(500).json({ error: err.message || 'Failed to create job' })
  }
})

// PUT /api/jobs/:id — update a job
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params
    const app = catalyst.initialize(req, { type: catalyst.type.ADVANCEDIO })
    const table = app.datastore().table('Jobs')
    const {
      shop_name,
      vehicle,
      vin,
      technician,
      scheduled_date,
      calibrations,
      notes,
      report_url,
      status,
      created_at,
    } = req.body

    const data = {
      ROWID: id,
      shop_name: shop_name || '',
      vehicle: vehicle || '',
      vin: vin || '',
      technician: technician || '',
      scheduled_date: scheduled_date || '',
      calibrations: typeof calibrations === 'string' ? calibrations : JSON.stringify(calibrations || []),
      notes: notes || '',
      report_url: report_url || '',
      status: status || 'scheduled',
    }

    if (created_at !== undefined) data.created_at = created_at

    const row = await table.updateRow(data)
    res.json(row)
  } catch (err) {
    console.error('[jobs PUT]', err.message)
    res.status(500).json({ error: err.message || 'Failed to update job' })
  }
})

// DELETE /api/jobs/:id — delete a job
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params
    const app = catalyst.initialize(req, { type: catalyst.type.ADVANCEDIO })
    const table = app.datastore().table('Jobs')
    await table.deleteRow(id)
    res.json({ success: true })
  } catch (err) {
    console.error('[jobs DELETE]', err.message)
    res.status(500).json({ error: err.message || 'Failed to delete job' })
  }
})

export default router
