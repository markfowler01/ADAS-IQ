import express from 'express'
import catalyst from 'zcatalyst-sdk-node'
import { createRepairDraftQuote } from '../services/zoho.js'

const router = express.Router()
const TABLE = 'RepairEstimates'

function getTable(req) {
  const sdk = catalyst.initialize(req, { type: 'advancedio' })
  return sdk.datastore().table(TABLE)
}

function rowToEstimate(row) {
  let parts = []
  try { parts = JSON.parse(row.parts || '[]') } catch {}
  let labor_lines = []
  try { labor_lines = JSON.parse(row.labor_lines || '[]') } catch {}
  return {
    id:               String(row.ROWID),
    customer_id:      row.customer_id      || '',
    customer_name:    row.customer_name    || '',
    salesperson_id:   row.salesperson_id   || '',
    salesperson_name: row.salesperson_name || '',
    year:             row.year             || '',
    make:             row.make             || '',
    model:            row.model            || '',
    vin:              row.vin              || '',
    ro_number:        row.ro_number        || '',
    insurer:          row.insurer          || '',
    claim:            row.claim            || '',
    parts,
    labor_lines,
    labor_rate:       row.labor_rate       || '200',
    notes:            row.notes            || '',
    status:           row.status           || 'draft',
    zoho_estimate_id:  row.zoho_estimate_id  || '',
    zoho_quote_number: row.zoho_quote_number || '',
    zoho_quote_url:    row.zoho_quote_url    || '',
    created_at:       row.created_at       || '',
  }
}

function estimateToRow(e) {
  return {
    customer_id:      e.customer_id      || '',
    customer_name:    e.customer_name    || '',
    salesperson_id:   e.salesperson_id   || '',
    salesperson_name: e.salesperson_name || '',
    year:             e.year             || '',
    make:             e.make             || '',
    model:            e.model            || '',
    vin:              e.vin              || '',
    ro_number:        e.ro_number        || '',
    insurer:          e.insurer          || '',
    claim:            e.claim            || '',
    parts:       typeof e.parts === 'string'       ? e.parts       : JSON.stringify(e.parts       || []),
    labor_lines: typeof e.labor_lines === 'string' ? e.labor_lines : JSON.stringify(e.labor_lines || []),
    labor_rate:  String(e.labor_rate || '200'),
    notes:            e.notes            || '',
    status:           e.status           || 'draft',
    zoho_estimate_id:  e.zoho_estimate_id  || '',
    zoho_quote_number: e.zoho_quote_number || '',
    zoho_quote_url:    e.zoho_quote_url    || '',
    created_at:       e.created_at       || '',
  }
}

function extractErr(err) {
  return err?.data?.message || err?.response?.data?.message || err?.message || 'Unknown error'
}

// GET all estimates
router.get('/', async (req, res) => {
  try {
    const table = getTable(req)
    const rows = await table.getAllRows()
    const estimates = (rows || [])
      .map(rowToEstimate)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
    res.json(estimates)
  } catch (err) {
    res.status(500).json({ error: extractErr(err) })
  }
})

// GET single estimate
router.get('/:id', async (req, res) => {
  try {
    const table = getTable(req)
    const row = await table.getRow(req.params.id)
    res.json(rowToEstimate(row))
  } catch (err) {
    res.status(500).json({ error: extractErr(err) })
  }
})

// POST create estimate
router.post('/', async (req, res) => {
  try {
    const table = getTable(req)
    const data = { ...estimateToRow(req.body), created_at: new Date().toISOString() }
    const row = await table.insertRow(data)
    res.json(rowToEstimate(row))
  } catch (err) {
    res.status(500).json({ error: extractErr(err) })
  }
})

// PUT update estimate
router.put('/:id', async (req, res) => {
  try {
    const table = getTable(req)
    const row = { ROWID: req.params.id, ...estimateToRow(req.body) }
    const updated = await table.updateRow(row)
    res.json(rowToEstimate(updated))
  } catch (err) {
    res.status(500).json({ error: extractErr(err) })
  }
})

// DELETE estimate
router.delete('/:id', async (req, res) => {
  try {
    const table = getTable(req)
    await table.deleteRow(req.params.id)
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: extractErr(err) })
  }
})

// POST send to Zoho Books
router.post('/:id/send-to-zoho', async (req, res) => {
  try {
    const table = getTable(req)
    const row = await table.getRow(req.params.id)
    const estimate = rowToEstimate(row)

    const result = await createRepairDraftQuote({
      customerId:      estimate.customer_id   || null,
      customerName:    estimate.customer_name || null,
      salespersonId:   estimate.salesperson_id   || null,
      salespersonName: estimate.salesperson_name || null,
      shop:            estimate.customer_name || null,
      ro_number:       estimate.ro_number     || null,
      vin:             estimate.vin           || null,
      vehicle:         [estimate.year, estimate.make, estimate.model].filter(Boolean).join(' ') || null,
      year:            estimate.year          || null,
      make:            estimate.make          || null,
      model:           estimate.model         || null,
      insurer:         estimate.insurer       || null,
      claim:           estimate.claim         || null,
      parts:      estimate.parts,
      laborLines: estimate.labor_lines,
      laborRate:  parseFloat(estimate.labor_rate) || 200,
      notes:           estimate.notes         || null,
    })

    // Update estimate record with Zoho info + mark sent
    const updatedRow = {
      ROWID:             req.params.id,
      zoho_estimate_id:  result.quoteId     || '',
      zoho_quote_number: result.quoteNumber || '',
      zoho_quote_url:    result.quoteUrl    || '',
      status:            'sent',
    }
    await table.updateRow(updatedRow)

    res.json(result)
  } catch (err) {
    res.status(500).json({ error: extractErr(err) })
  }
})

export default router
