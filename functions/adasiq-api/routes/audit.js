import express from 'express'
import multer from 'multer'
import { extractFromPdf } from '../services/claude.js'
import { getItemCatalogForAudit, findBestMatchExported } from '../services/zoho.js'

const router = express.Router()

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    cb(null, file.mimetype === 'application/pdf')
  },
})

router.post('/', upload.array('pdfs', 20), async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No PDF files uploaded.' })
  }

  try {
    // 1. Extract calibration names from every PDF in parallel
    const results = await Promise.allSettled(
      req.files.map(async (file) => {
        const data = await extractFromPdf(file.buffer)
        return {
          filename: file.originalname,
          calibrations: (data.calibrations || []).map((c) => c.calibration_name),
        }
      })
    )

    // Collect all unique names with source files
    const nameMap = new Map() // name → Set of filenames
    for (const result of results) {
      if (result.status === 'fulfilled') {
        for (const name of result.value.calibrations) {
          if (!nameMap.has(name)) nameMap.set(name, new Set())
          nameMap.get(name).add(result.value.filename)
        }
      }
    }

    // 2. Get Zoho catalog
    const { exactMap, allItems } = await getItemCatalogForAudit()

    // 3. Match each unique calibration name
    const rows = []
    for (const [calName, files] of nameMap.entries()) {
      const match = findBestMatchExported(calName, exactMap, allItems)
      rows.push({
        calibration_name: calName,
        source_files: [...files],
        matched_item: match ? match.matchedName : null,
        score: match ? Math.round(match.score * 100) : 0,
        status: match ? (match.score === 1 ? 'exact' : 'fuzzy') : 'unmatched',
      })
    }

    // Sort: unmatched first, then fuzzy, then exact — so gaps are at the top
    const order = { unmatched: 0, fuzzy: 1, exact: 2 }
    rows.sort(
      (a, b) =>
        order[a.status] - order[b.status] ||
        a.calibration_name.localeCompare(b.calibration_name)
    )

    res.json({
      total_unique: rows.length,
      pdfs_processed: req.files.length,
      rows,
    })
  } catch (err) {
    console.error('[audit]', err.message)
    res.status(500).json({ error: err.message || 'Audit failed.' })
  }
})

export default router
