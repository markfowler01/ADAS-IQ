import express from 'express'
import { readHistory, writeHistory, pruneHistory } from '../services/history.js'

const router = express.Router()

const DEMO_ENTRY = {
  id: 'demo_001',
  shop: 'Prestige Auto Body',
  vehicle: '2022 Toyota RAV4',
  roNumber: 'EST-00142',
  vin: '2T3RWRFV1NW123456',
  calibrations: [{ name: 'Front Radar', mode: 'Static' }, { name: 'Front Camera', mode: 'Static' }],
  estimateUrl: '',
  pdfUrl: '',
  technician: 'Jaden',
  createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2 hrs ago
}

// GET /api/history
router.get('/', async (req, res) => {
  try {
    let records = await readHistory(req)
    if (records.length === 0) {
      records = [DEMO_ENTRY]
      await writeHistory(req, records)
    }
    res.json(records.slice().reverse())
  } catch (err) {
    console.error('[history GET]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// POST /api/history
router.post('/', async (req, res) => {
  const entry = {
    id:           `hist_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    shop:         req.body.shop         || '',
    vehicle:      req.body.vehicle      || '',
    roNumber:     req.body.roNumber     || '',
    vin:          req.body.vin          || '',
    calibrations: req.body.calibrations || [],
    estimateUrl:  req.body.estimateUrl  || '',
    pdfUrl:       req.body.pdfUrl       || '',
    technician:   req.body.technician   || '',
    createdAt:    new Date().toISOString(),
  }

  try {
    const records = await readHistory(req)
    if (!records.find(r => r.id === entry.id)) records.push(entry)
    await writeHistory(req, pruneHistory(records))
    res.status(201).json(entry)
  } catch (err) {
    console.error('[history POST]', err.message)
    res.status(500).json({ error: err.message })
  }
})

export default router
