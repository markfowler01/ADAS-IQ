import express from 'express'
import crypto from 'crypto'

const router = express.Router()
const SECRET = process.env.SESSION_SECRET || 'adasiq-secret-2026'

function makeToken(user) {
  const payload = Buffer.from(JSON.stringify({
    user,
    exp: Date.now() + 24 * 60 * 60 * 1000, // 24 hours for demo
  })).toString('base64url')
  const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url')
  return `${payload}.${sig}`
}

const DEMO_USERS = {
  calibration: {
    name: 'Absolute ADAS — Demo',
    email: 'demo@adas-iq.com',
    demo: true,
    demoType: 'calibration',
  },
  bodyshop: {
    name: 'Premier Body Shop — Demo',
    email: 'demo-bodyshop@adas-iq.com',
    demo: true,
    demoType: 'bodyshop',
  },
}

// POST /auth/demo — one-click demo login
// Body: { type: 'calibration' | 'bodyshop' }
router.post('/', (req, res) => {
  const { type } = req.body
  const demoUser = DEMO_USERS[type]
  if (!demoUser) return res.status(400).json({ error: 'Invalid demo type. Use "calibration" or "bodyshop".' })
  const token = makeToken(demoUser)
  res.json({ user: demoUser, token })
})

// GET /auth/demo/data — pre-loaded fake data for demo screens
router.get('/data', (req, res) => {
  res.json({
    customers: DEMO_CUSTOMERS,
    salespersons: DEMO_SALESPERSONS,
    jobs: DEMO_JOBS,
    history: DEMO_HISTORY,
    estimates: DEMO_ESTIMATES,
  })
})

// ── Demo Data ──────────────────────────────────────────────────────────────────

const DEMO_CUSTOMERS = [
  { contact_id: 'demo-c1', contact_name: 'State Farm Insurance' },
  { contact_id: 'demo-c2', contact_name: 'GEICO' },
  { contact_id: 'demo-c3', contact_name: 'Allstate Insurance' },
  { contact_id: 'demo-c4', contact_name: 'Progressive Insurance' },
  { contact_id: 'demo-c5', contact_name: 'Farmers Insurance' },
]

const DEMO_SALESPERSONS = [
  { salesperson_id: 'demo-s1', salesperson_name: 'Mark Fowler' },
  { salesperson_id: 'demo-s2', salesperson_name: 'Tyler James' },
]

const DEMO_JOBS = [
  {
    ROWID: 'demo-job-1',
    ro_number: '24301',
    shop: 'Premier Body Shop',
    vehicle: '2023 Toyota RAV4 XSE Hybrid',
    year: '2023', make: 'Toyota', model: 'RAV4 XSE Hybrid',
    vin: '2T3RWRFV8NW204817',
    insurer: 'State Farm Insurance',
    claim: 'CLM-2024-087432',
    status: 'Scheduled',
    invoice_number: null,
    created_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    ROWID: 'demo-job-2',
    ro_number: '24298',
    shop: 'Eastside Collision Center',
    vehicle: '2022 Honda CR-V EX-L',
    year: '2022', make: 'Honda', model: 'CR-V EX-L',
    vin: '7FARW2H87NE012345',
    insurer: 'GEICO',
    claim: 'CLM-2024-091234',
    status: 'In Progress',
    invoice_number: 'EST-000234',
    created_at: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    ROWID: 'demo-job-3',
    ro_number: '24289',
    shop: 'Northwest Auto Body',
    vehicle: '2021 Ford F-150 Platinum',
    year: '2021', make: 'Ford', model: 'F-150 Platinum',
    vin: '1FTFW1E83MFC12345',
    insurer: 'Allstate Insurance',
    claim: 'CLM-2024-082111',
    status: 'Completed',
    invoice_number: 'EST-000229',
    created_at: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    ROWID: 'demo-job-4',
    ro_number: '24312',
    shop: 'Cascade Collision Repair',
    vehicle: '2024 Subaru Outback Premium',
    year: '2024', make: 'Subaru', model: 'Outback Premium',
    vin: '4S4BTACC4R3123456',
    insurer: 'Progressive Insurance',
    claim: 'CLM-2024-094501',
    status: 'Pending Review',
    invoice_number: null,
    created_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    ROWID: 'demo-job-5',
    ro_number: '24275',
    shop: 'Premier Body Shop',
    vehicle: '2022 BMW X5 xDrive40i',
    year: '2022', make: 'BMW', model: 'X5 xDrive40i',
    vin: '5UXCR6C08N9K12345',
    insurer: 'Farmers Insurance',
    claim: 'CLM-2024-078322',
    status: 'Invoiced',
    invoice_number: 'EST-000218',
    created_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
  },
]

const DEMO_HISTORY = [
  {
    id: 'demo-h1',
    ro_number: '24289',
    shop: 'Northwest Auto Body',
    vehicle: '2021 Ford F-150 Platinum',
    insurer: 'Allstate Insurance',
    estimate_number: 'EST-000229',
    estimate_url: '#',
    workdrive_url: 'https://workdrive.zohoexternal.com/demo',
    calibrations: [
      { calibration_name: 'Pre-Collision System / Front Radar', cal_type: 'Static' },
      { calibration_name: 'Lane Departure Warning', cal_type: 'Static' },
      { calibration_name: 'Steering Angle Sensor', cal_type: 'Static' },
    ],
    created_at: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'demo-h2',
    ro_number: '24275',
    shop: 'Premier Body Shop',
    vehicle: '2022 BMW X5 xDrive40i',
    insurer: 'Farmers Insurance',
    estimate_number: 'EST-000218',
    estimate_url: '#',
    workdrive_url: 'https://workdrive.zohoexternal.com/demo',
    calibrations: [
      { calibration_name: 'Night Vision Camera', cal_type: 'Static' },
      { calibration_name: 'Surround View Camera', cal_type: 'Static' },
      { calibration_name: 'Front Radar / Active Cruise Control', cal_type: 'Static' },
      { calibration_name: 'Steering Angle Sensor', cal_type: 'Static' },
    ],
    created_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'demo-h3',
    ro_number: '24261',
    shop: 'Eastside Collision Center',
    vehicle: '2023 Tesla Model Y Long Range',
    insurer: 'State Farm Insurance',
    estimate_number: 'EST-000211',
    estimate_url: '#',
    workdrive_url: 'https://workdrive.zohoexternal.com/demo',
    calibrations: [
      { calibration_name: 'Autopilot Forward Camera', cal_type: 'Static' },
      { calibration_name: 'Autopilot Rear Camera', cal_type: 'Static' },
      { calibration_name: 'Autopilot Side Cameras (x4)', cal_type: 'Static' },
    ],
    created_at: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString(),
  },
]

const DEMO_ESTIMATES = [
  {
    id: 'demo-e1',
    ro_number: '24302',
    shop: 'Premier Body Shop',
    vehicle: '2022 Toyota Tacoma TRD Pro',
    year: '2022', make: 'Toyota', model: 'Tacoma TRD Pro',
    customer_name: 'State Farm Insurance',
    parts: [
      { name: 'Front Bumper Cover', cost: 485, multiplier: null },
      { name: 'Upper Grille Assembly', cost: 210, multiplier: null },
      { name: 'Front Impact Bar', cost: 320, multiplier: null },
    ],
    labor_lines: [
      { description: 'Pre/Post Scan', hours: 1.0 },
      { description: 'Front Radar Calibration — Static', hours: 1.5 },
      { description: 'Steering Angle Sensor Reset', hours: 0.5 },
    ],
    labor_rate: 200,
    notes: 'All calibrations per Toyota OEM position statement.',
    zoho_sent: false,
    created_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
  },
]

export default router
