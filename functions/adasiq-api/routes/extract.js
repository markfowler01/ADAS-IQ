import express from 'express'
import multer from 'multer'
import { extractFromPdf } from '../services/claude.js'

const router = express.Router()

// Store file in memory (no disk I/O needed)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB max
  fileFilter(req, file, cb) {
    if (file.mimetype !== 'application/pdf') {
      cb(new Error('Only PDF files are accepted'))
    } else {
      cb(null, true)
    }
  },
})

// ---------------------------------------------------------------------------
// Demo payload — used when ANTHROPIC_API_KEY has no credits or is missing
// ---------------------------------------------------------------------------
const DEMO_PAYLOAD = {
  _demo: true,
  shop: 'Prestige Auto Body — Demo',
  claim: 'CLM-2024-087432',
  insurer: 'State Farm Insurance',
  ro_number: 'RO-10492',
  vehicle: '2022 Toyota RAV4 XSE Hybrid',
  year: '2022',
  make: 'Toyota',
  model: 'RAV4 XSE Hybrid',
  vin: '2T3RWRFV8NW204817',
  calibrations: [
    {
      calibration_name: 'Pre-Collision System (PCS) Camera',
      cal_type: 'Static',
      trigger: 'In Collision',
      line_references: '3, 6, 8, 11',
      justification:
        'Pre-Collision System camera calibration required per Toyota OEM position statement and ALLDATA ADAS procedure following collision repair. The forward-facing camera must be recalibrated after any windshield replacement or front-end structural repair to ensure accurate object detection and automatic emergency braking function. Failure to calibrate presents a safety liability and does not meet Toyota OEM repair standards.',
      enabled: true,
    },
    {
      calibration_name: 'Lane Departure Alert (LDA) / Lane Tracing Assist (LTA)',
      cal_type: 'Static',
      trigger: 'In Collision',
      line_references: '3, 6, 8',
      justification:
        'Lane Departure Alert and Lane Tracing Assist calibration required per Toyota OEM position statement and ALLDATA ADAS procedure following collision repair. These systems share the forward camera and require recalibration any time the camera is disturbed or the windshield is replaced to maintain lane boundary detection accuracy. Failure to calibrate presents a safety liability and does not meet Toyota OEM repair standards.',
      enabled: true,
    },
    {
      calibration_name: 'Blind Spot Monitor (BSM) — Left Radar',
      cal_type: 'Static',
      trigger: 'In Collision',
      line_references: '17, 20',
      justification:
        'Blind Spot Monitor left radar calibration required per Toyota OEM position statement and ALLDATA ADAS procedure following collision repair. Rear quarter panel repairs or replacement can alter radar aim angle, resulting in false alerts or missed vehicle detections in adjacent lanes. Failure to calibrate presents a safety liability and does not meet Toyota OEM repair standards.',
      enabled: true,
    },
    {
      calibration_name: 'Blind Spot Monitor (BSM) — Right Radar',
      cal_type: 'Static',
      trigger: 'In Collision',
      line_references: '17, 20',
      justification:
        'Blind Spot Monitor right radar calibration required per Toyota OEM position statement and ALLDATA ADAS procedure following collision repair. Rear quarter panel repairs or replacement can alter radar aim angle, resulting in false alerts or missed vehicle detections in adjacent lanes. Failure to calibrate presents a safety liability and does not meet Toyota OEM repair standards.',
      enabled: true,
    },
    {
      calibration_name: 'Rear Cross-Traffic Alert (RCTA)',
      cal_type: 'Dynamic',
      trigger: 'In Collision',
      line_references: '17, 20, 33',
      justification:
        'Rear Cross-Traffic Alert calibration required per Toyota OEM position statement and ALLDATA ADAS procedure following collision repair. The rear radar sensors that enable cross-traffic detection must be recalibrated after any rear impact or bumper replacement to ensure proper detection angles are maintained. Failure to calibrate presents a safety liability and does not meet Toyota OEM repair standards.',
      enabled: true,
    },
    {
      calibration_name: 'Steering Angle Sensor (SAS)',
      cal_type: 'Dynamic',
      trigger: 'Suspension/Alignment',
      line_references: '33, 37',
      justification:
        'Steering Angle Sensor calibration required per Toyota OEM position statement and ALLDATA ADAS procedure following collision repair. Any repair involving suspension components, alignment correction, or steering system work necessitates SAS recalibration to ensure accurate vehicle dynamics input for stability control and ADAS systems. Failure to calibrate presents a safety liability and does not meet Toyota OEM repair standards.',
      enabled: true,
    },
    {
      calibration_name: 'Automatic High Beam (AHB)',
      cal_type: 'Static',
      trigger: 'In Collision',
      line_references: '3, 6',
      justification:
        'Automatic High Beam calibration required per Toyota OEM position statement and ALLDATA ADAS procedure following collision repair. The AHB system relies on the same forward camera as PCS and must be recalibrated after windshield replacement or camera repositioning to correctly detect oncoming headlights and taillights. Failure to calibrate presents a safety liability and does not meet Toyota OEM repair standards.',
      enabled: false,
    },
    {
      calibration_name: 'Backup Camera (RCD) Aiming',
      cal_type: 'Static',
      trigger: 'In Collision',
      line_references: '69',
      justification:
        'Backup Camera aiming calibration required per Toyota OEM position statement and ALLDATA ADAS procedure following collision repair. Rear liftgate or bumper replacement can disturb camera mounting position, causing the displayed guidelines to be misaligned with actual vehicle path. Failure to calibrate presents a safety liability and does not meet Toyota OEM repair standards.',
      enabled: false,
    },
  ],
}

router.post('/', (req, res, next) => {
  upload.single('pdf')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: err.message || 'File upload error.' })
    }
    next()
  })
}, async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No PDF file uploaded.' })
  }

  // Demo mode: only if no API key is configured (Fix #4 — removed ?demo=1 bypass)
  const hasKey = !!process.env.ANTHROPIC_API_KEY
  if (!hasKey) {
    console.log('[extract] Running in DEMO mode — no ANTHROPIC_API_KEY set')
    return res.json(DEMO_PAYLOAD)
  }

  // Guard: reject empty or suspiciously small files
  const fileSizeKB = req.file.buffer.length / 1024
  console.log(`[extract] File received: "${req.file.originalname}" — ${fileSizeKB.toFixed(1)} KB`)
  if (req.file.buffer.length < 512) {
    return res.status(400).json({
      error: `PDF appears to be empty or too small (${Math.round(req.file.buffer.length)} bytes). ` +
             'If this file is stored in iCloud or cloud storage, make sure it has fully downloaded before uploading.',
    })
  }

  try {
    const data = await extractFromPdf(req.file.buffer)
    res.json(data)
  } catch (err) {
    console.error('[extract] ERROR:', err.message)

    // Billing errors → fall back to demo so the app stays usable
    const isBillingError =
      err.message?.includes('credit balance') ||
      err.message?.includes('too low') ||
      err.message?.includes('billing')

    if (isBillingError) {
      console.log('[extract] Billing issue — serving demo data')
      return res.json({ ...DEMO_PAYLOAD, _demo: true, _demoReason: 'billing' })
    }

    // Clean up Anthropic SDK errors — extract just the human-readable message
    const claudeMsg = err.message?.match(/"message":"([^"]+)"/)
    res.status(500).json({ error: claudeMsg ? claudeMsg[1] : (err.message || 'Extraction failed.') })
  }
})

export default router
