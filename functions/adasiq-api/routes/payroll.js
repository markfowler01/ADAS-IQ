// Stage 1 Payroll:
// - Calculates gross pay from time clock + bonuses + salary + adjustments
// - Estimates FICA, Medicare, federal income tax (informational only)
// - Exports Wise Batch Payment CSV for contractors
// - Exports Zoho Payroll CSV for W-2 employees
// - Generates branded paystub PDFs
// - Approves a pay run → logs to Books as expenses

import express from 'express'
import catalyst from 'zcatalyst-sdk-node'
import PDFDocument from 'pdfkit'

const router = express.Router()

function getSegment(req) { return catalyst.initialize(req).cache().segment() }
function isNotFound(e) { return e?.statusCode === 404 || e?.errorInfo?.statusCode === 404 }

async function cacheSet(segment, key, value) {
  const str = typeof value === 'string' ? value : JSON.stringify(value)
  try { await segment.update(key, str) }
  catch (e) { await segment.put(key, str) }
}

async function cacheGet(segment, key, fallback = null) {
  try {
    const val = await segment.getValue(key)
    return val ? JSON.parse(val) : fallback
  } catch (e) {
    if (isNotFound(e)) return fallback
    throw e
  }
}

async function readTimeclock(req) {
  const segment = getSegment(req)
  try {
    const meta = await cacheGet(segment, 'timeclock_entries_meta', null)
    if (meta && meta.chunks > 0) {
      const parts = await Promise.all(
        Array.from({ length: meta.chunks }, (_, i) =>
          cacheGet(segment, `timeclock_entries_chunk_${i}`, [])
        )
      )
      return parts.flat()
    }
  } catch { /* noop */ }
  return []
}

async function readExpenses(req) {
  const segment = getSegment(req)
  return (await cacheGet(segment, 'books_expenses', [])) || []
}

async function writeExpenses(req, expenses) {
  const segment = getSegment(req)
  await cacheSet(segment, 'books_expenses', expenses)
}

async function readTeam(req) {
  const segment = getSegment(req)
  return (await cacheGet(segment, 'team_members', [])) || []
}

function isAdmin(req) { return req.user?.role !== 'technician' }
function getUserId(req) { return req.user?.email || req.user?.id || req.user?.name || 'unknown' }

// ── 2026 US payroll tax constants ───────────────────────────────────────────
// Updated annually. These are the actual 2026 IRS + SSA numbers.

const SS_RATE = 0.062          // employee Social Security
const MEDICARE_RATE = 0.0145   // employee Medicare
const MEDICARE_ADDL_RATE = 0.009  // additional Medicare over $200k YTD
const MEDICARE_ADDL_THRESHOLD = 200000
const SS_WAGE_BASE = 176100    // 2026 SSA wage base

// Federal income tax — Publication 15-T Percentage Method, 2026 tables
// Simplified: Standard (non-W-4 step 2) rates for biweekly pay periods.
// This is INFORMATIONAL. Zoho Payroll does the authoritative calc.
const FED_BIWEEKLY_SINGLE = [
  [0, 0],
  [559, 0],
  [1015, 0.10],
  [2384, 0.12],
  [4960, 0.22],
  [9484, 0.24],
  [17577, 0.32],
  [22027, 0.35],
  [54296, 0.37],
]
const FED_BIWEEKLY_MARRIED = [
  [0, 0],
  [1117, 0],
  [2029, 0.10],
  [4767, 0.12],
  [9920, 0.22],
  [18969, 0.24],
  [35155, 0.32],
  [44055, 0.35],
  [65394, 0.37],
]

function estimateFederalWithholding(biweeklyGross, filingStatus = 'single') {
  const tbl = filingStatus === 'married' ? FED_BIWEEKLY_MARRIED : FED_BIWEEKLY_SINGLE
  let tax = 0
  for (let i = tbl.length - 1; i >= 0; i--) {
    const [threshold, rate] = tbl[i]
    if (biweeklyGross > threshold) {
      const prevTax = i > 0 ? (biweeklyGross - threshold) * rate : 0
      tax = prevTax
      // Add all lower-tier accumulated tax
      for (let j = 1; j <= i; j++) {
        const [t1, r1] = tbl[j]
        const t0 = tbl[j - 1][0]
        tax += (j === i ? 0 : (t1 - t0) * r1)
      }
      break
    }
  }
  return Math.max(0, Math.round(tax * 100) / 100)
}

// ── Pay period helpers ──────────────────────────────────────────────────────

function defaultSettings() {
  return {
    pay_frequency: 'biweekly',   // weekly | biweekly | semimonthly | monthly
    pay_day: 'friday',
    first_period_end: '2026-01-03',  // anchor date for biweekly periods
    state: 'WA',                  // state of employment (WA = no state income tax)
    employer_ein: '',
    company_name: 'Absolute ADAS',
  }
}

function getPeriodForDate(settings, date) {
  // Returns { start, end } for the pay period containing `date`
  const d = new Date(date)
  const anchor = new Date(settings.first_period_end || '2026-01-03')

  if (settings.pay_frequency === 'biweekly') {
    // Find the biweekly period ending on-or-after date
    const msPerPeriod = 14 * 24 * 60 * 60 * 1000
    const diff = d - anchor
    const periodsFromAnchor = Math.floor(diff / msPerPeriod)
    const end = new Date(anchor.getTime() + (periodsFromAnchor + 1) * msPerPeriod)
    const start = new Date(end.getTime() - msPerPeriod + 24 * 60 * 60 * 1000)
    return {
      start: start.toISOString().slice(0, 10),
      end: end.toISOString().slice(0, 10),
    }
  }
  if (settings.pay_frequency === 'weekly') {
    const msPerWeek = 7 * 24 * 60 * 60 * 1000
    const diff = d - anchor
    const periodsFromAnchor = Math.floor(diff / msPerWeek)
    const end = new Date(anchor.getTime() + (periodsFromAnchor + 1) * msPerWeek)
    const start = new Date(end.getTime() - msPerWeek + 24 * 60 * 60 * 1000)
    return {
      start: start.toISOString().slice(0, 10),
      end: end.toISOString().slice(0, 10),
    }
  }
  if (settings.pay_frequency === 'monthly') {
    const start = new Date(d.getFullYear(), d.getMonth(), 1)
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0)
    return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) }
  }
  if (settings.pay_frequency === 'semimonthly') {
    const day = d.getDate()
    if (day <= 15) {
      return {
        start: new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10),
        end:   new Date(d.getFullYear(), d.getMonth(), 15).toISOString().slice(0, 10),
      }
    }
    return {
      start: new Date(d.getFullYear(), d.getMonth(), 16).toISOString().slice(0, 10),
      end:   new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10),
    }
  }
  // Default
  return { start: d.toISOString().slice(0, 10), end: d.toISOString().slice(0, 10) }
}

function periodsPerYear(freq) {
  return { weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12 }[freq] || 26
}

// ── Settings ────────────────────────────────────────────────────────────────

router.get('/settings', async (req, res) => {
  try {
    const segment = getSegment(req)
    const s = await cacheGet(segment, 'payroll_settings', defaultSettings())
    res.json({ ...defaultSettings(), ...s })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.put('/settings', async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' })
    const segment = getSegment(req)
    const current = await cacheGet(segment, 'payroll_settings', defaultSettings())
    const updated = { ...defaultSettings(), ...current, ...req.body }
    await cacheSet(segment, 'payroll_settings', updated)
    res.json(updated)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── Pay run calculation ─────────────────────────────────────────────────────

router.get('/pay-run', async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' })
    const segment = getSegment(req)
    const settings = { ...defaultSettings(), ...(await cacheGet(segment, 'payroll_settings', {})) }

    const { period_end } = req.query
    const referenceDate = period_end || new Date().toISOString().slice(0, 10)
    const period = getPeriodForDate(settings, referenceDate)
    const ppy = periodsPerYear(settings.pay_frequency)

    const [team, entries] = await Promise.all([readTeam(req), readTimeclock(req)])
    const active = team.filter(m => m.active !== false && m.payroll_type !== 'excluded')

    // Get already-approved runs so we can show YTD gross for Medicare/SS caps
    const runs = (await cacheGet(segment, 'payroll_runs', [])) || []
    const currentYear = new Date(referenceDate).getFullYear().toString()
    const ytdGrossByUser = {}
    for (const run of runs) {
      if (!run.period_end?.startsWith(currentYear)) continue
      for (const line of (run.lines || [])) {
        ytdGrossByUser[line.user_id] = (ytdGrossByUser[line.user_id] || 0) + (line.gross || 0)
      }
    }

    const lines = []
    for (const m of active) {
      const mId = m.user_id || m.email || m.id

      // Hours from time clock (for hourly workers)
      const myEntries = entries.filter(e =>
        (e.user_id === mId || e.user_name === m.name)
        && e.clock_out
        && e.clock_in?.slice(0, 10) >= period.start
        && e.clock_in?.slice(0, 10) <= period.end
      )
      const regularMinutes = myEntries.reduce((s, e) => s + (e.regular_minutes || 0), 0)
      const overtimeMinutes = myEntries.reduce((s, e) => s + (e.overtime_minutes || 0), 0)
      const regularHours = Math.round((regularMinutes / 60) * 100) / 100
      const otHours = Math.round((overtimeMinutes / 60) * 100) / 100

      const hourlyRate = Number(m.hourly_rate) || 0
      const salaryAnnual = Number(m.salary_annual) || 0

      let gross = 0
      let breakdown = []
      const payrollType = m.payroll_type || (m.role === 'technician' ? 'w2_zoho' : 'contractor_wise')

      if (salaryAnnual > 0) {
        gross = Math.round((salaryAnnual / ppy) * 100) / 100
        breakdown.push({ label: `Salary (${settings.pay_frequency})`, amount: gross })
      } else if (hourlyRate > 0) {
        const regPay = Math.round(regularHours * hourlyRate * 100) / 100
        const otPay = Math.round(otHours * hourlyRate * 1.5 * 100) / 100
        gross = regPay + otPay
        if (regPay > 0) breakdown.push({ label: `Regular: ${regularHours}h × $${hourlyRate}`, amount: regPay })
        if (otPay > 0) breakdown.push({ label: `OT: ${otHours}h × $${hourlyRate * 1.5}`, amount: otPay })
      }

      // Bonus for this period (from bonuses API logic — simple version: flat extra if set)
      const bonus = Number(m.period_bonus) || 0
      if (bonus > 0) {
        gross += bonus
        breakdown.push({ label: 'Bonus', amount: bonus })
      }

      gross = Math.round(gross * 100) / 100
      const ytdGrossBefore = ytdGrossByUser[mId] || 0

      // Only calculate taxes for W-2 employees. Contractors get gross.
      let federalWH = 0, ssTax = 0, medicareTax = 0, medicareAddlTax = 0
      if (payrollType === 'w2_zoho' && gross > 0) {
        // Federal withholding (informational — Zoho Payroll will override)
        const filing = m.filing_status || 'single'
        // Scale to biweekly equivalent for table lookup
        const biweeklyEquiv = gross * (26 / ppy)
        federalWH = estimateFederalWithholding(biweeklyEquiv, filing) * (ppy / 26)

        // Social Security — stops at wage base
        const ssEligible = Math.max(0, Math.min(gross, SS_WAGE_BASE - ytdGrossBefore))
        ssTax = Math.round(ssEligible * SS_RATE * 100) / 100

        // Medicare — no cap, but additional 0.9% over $200k YTD
        medicareTax = Math.round(gross * MEDICARE_RATE * 100) / 100
        const overThreshold = Math.max(0, (ytdGrossBefore + gross) - MEDICARE_ADDL_THRESHOLD)
        const addlEligible = Math.min(gross, overThreshold)
        medicareAddlTax = Math.round(addlEligible * MEDICARE_ADDL_RATE * 100) / 100
      }

      const totalWithholding = federalWH + ssTax + medicareTax + medicareAddlTax
      const net = Math.round((gross - totalWithholding) * 100) / 100

      lines.push({
        user_id: mId,
        user_name: m.name,
        email: m.email,
        payroll_type: payrollType,
        role: m.role,
        breakdown,
        hours: { regular: regularHours, overtime: otHours },
        gross: Math.round(gross * 100) / 100,
        federal_wh: federalWH,
        ss_tax: ssTax,
        medicare_tax: medicareTax,
        medicare_addl_tax: medicareAddlTax,
        total_withholding: Math.round(totalWithholding * 100) / 100,
        net: payrollType === 'w2_zoho' ? net : Math.round(gross * 100) / 100,  // contractors: net = gross
        ytd_gross_before: Math.round(ytdGrossBefore * 100) / 100,
        wise_email: m.wise_email || m.email,
        wise_currency: m.wise_currency || 'USD',
        zoho_employee_id: m.zoho_payroll_employee_id || '',
      })
    }

    // Employer-side tax estimate (informational)
    const employerTaxes = lines
      .filter(l => l.payroll_type === 'w2_zoho')
      .reduce((acc, l) => {
        const ssEmployer = Math.min(l.gross, Math.max(0, SS_WAGE_BASE - l.ytd_gross_before)) * SS_RATE
        const medEmployer = l.gross * MEDICARE_RATE
        const futa = Math.min(7000 - (l.ytd_gross_before || 0), l.gross) > 0 ? Math.min(7000 - l.ytd_gross_before, l.gross) * 0.006 : 0
        return {
          ss: acc.ss + ssEmployer,
          medicare: acc.medicare + medEmployer,
          futa: acc.futa + (futa > 0 ? futa : 0),
        }
      }, { ss: 0, medicare: 0, futa: 0 })

    const totals = {
      gross: Math.round(lines.reduce((s, l) => s + l.gross, 0) * 100) / 100,
      net: Math.round(lines.reduce((s, l) => s + l.net, 0) * 100) / 100,
      employee_withholding: Math.round(lines.reduce((s, l) => s + l.total_withholding, 0) * 100) / 100,
      employer_taxes: {
        ss: Math.round(employerTaxes.ss * 100) / 100,
        medicare: Math.round(employerTaxes.medicare * 100) / 100,
        futa: Math.round(employerTaxes.futa * 100) / 100,
        total: Math.round((employerTaxes.ss + employerTaxes.medicare + employerTaxes.futa) * 100) / 100,
      },
    }
    totals.total_cost = Math.round((totals.gross + totals.employer_taxes.total) * 100) / 100

    res.json({
      period, settings, lines, totals,
      info: 'Tax amounts are estimates. Zoho Payroll handles authoritative calculations + filings.',
    })
  } catch (e) {
    console.error('[payroll] pay-run failed:', e)
    res.status(500).json({ error: e.message })
  }
})

// Approve a pay run — logs to Books as an expense + saves to history
router.post('/pay-run/approve', async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' })
    const { period, lines, totals, notes } = req.body
    if (!period || !Array.isArray(lines) || lines.length === 0) {
      return res.status(400).json({ error: 'period + lines required' })
    }

    const segment = getSegment(req)

    // Save the pay run
    const runs = (await cacheGet(segment, 'payroll_runs', [])) || []
    const run = {
      id: `run_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      period_start: period.start,
      period_end: period.end,
      approved_at: new Date().toISOString(),
      approved_by: getUserId(req),
      lines,
      totals,
      notes: notes || '',
    }
    runs.unshift(run)
    await cacheSet(segment, 'payroll_runs', runs.slice(0, 500))

    // Log as expense in Books — one line for wages, one for employer taxes
    const expenses = await readExpenses(req)
    expenses.unshift({
      id: `exp_${Date.now()}_1`,
      date: new Date().toISOString().slice(0, 10),
      category: 'Payroll',
      vendor: 'Employees',
      description: `Payroll ${period.start} to ${period.end} · gross`,
      amount: Number(totals.gross) || 0,
      payment_method: 'ACH / Bank Transfer',
      receipt_note: `Pay run ${run.id}`,
      created_at: new Date().toISOString(),
    })
    if (totals.employer_taxes?.total > 0) {
      expenses.unshift({
        id: `exp_${Date.now()}_2`,
        date: new Date().toISOString().slice(0, 10),
        category: 'Payroll',
        vendor: 'IRS / State',
        description: `Employer payroll taxes ${period.start} to ${period.end}`,
        amount: Number(totals.employer_taxes.total) || 0,
        payment_method: 'ACH / Bank Transfer',
        receipt_note: `Pay run ${run.id} — employer FICA + FUTA`,
        created_at: new Date().toISOString(),
      })
    }
    await writeExpenses(req, expenses)

    res.json({ ok: true, run })
  } catch (e) {
    console.error('[payroll] approve failed:', e)
    res.status(500).json({ error: e.message })
  }
})

// List pay run history
router.get('/runs', async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' })
    const segment = getSegment(req)
    const runs = (await cacheGet(segment, 'payroll_runs', [])) || []
    res.json(runs)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── Exports ─────────────────────────────────────────────────────────────────

function escapeCSV(val) {
  const s = String(val ?? '')
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

// Wise Batch Payment CSV
// Matches Wise's template: Name,Recipient email,Payment reference,Receiver type,Amount,Currency,Source currency,Target currency
router.post('/export/wise', async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' })
    const { lines, period } = req.body
    if (!Array.isArray(lines)) return res.status(400).json({ error: 'lines required' })

    const contractors = lines.filter(l => l.payroll_type?.startsWith('contractor'))
    const header = ['Name', 'Recipient email', 'Payment reference', 'Receiver type',
      'Amount currency', 'Amount', 'Source currency', 'Target currency']
    const rows = [header.map(escapeCSV).join(',')]

    for (const l of contractors) {
      const currency = l.wise_currency || 'USD'
      rows.push([
        l.user_name,
        l.wise_email || '',
        `Payroll ${period?.end || ''}`,
        'PERSON',
        currency,
        l.net.toFixed(2),
        'USD',
        currency,
      ].map(escapeCSV).join(','))
    }

    const csv = rows.join('\n')
    res.setHeader('Content-Type', 'text/csv')
    res.setHeader('Content-Disposition',
      `attachment; filename="wise-batch-${period?.end || 'payroll'}.csv"`)
    res.send(csv)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Zoho Payroll CSV — pre-populate earnings for W-2 employees
// Zoho Payroll's import format: employee_id, component, amount (matches their Earnings import)
router.post('/export/zoho-payroll', async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' })
    const { lines, period } = req.body
    if (!Array.isArray(lines)) return res.status(400).json({ error: 'lines required' })

    const w2 = lines.filter(l => l.payroll_type === 'w2_zoho')
    const header = ['Employee ID', 'Employee Name', 'Pay Period Start', 'Pay Period End',
      'Regular Hours', 'Regular Pay', 'Overtime Hours', 'Overtime Pay', 'Bonus', 'Gross', 'Notes']
    const rows = [header.map(escapeCSV).join(',')]

    for (const l of w2) {
      const regPay = l.breakdown.find(b => b.label.startsWith('Regular'))?.amount || 0
      const otPay = l.breakdown.find(b => b.label.startsWith('OT'))?.amount || 0
      const salPay = l.breakdown.find(b => b.label.startsWith('Salary'))?.amount || 0
      const bonus = l.breakdown.find(b => b.label === 'Bonus')?.amount || 0
      rows.push([
        l.zoho_employee_id || '',
        l.user_name,
        period?.start || '',
        period?.end || '',
        l.hours.regular,
        (regPay + salPay).toFixed(2),
        l.hours.overtime,
        otPay.toFixed(2),
        bonus.toFixed(2),
        l.gross.toFixed(2),
        `Imported from Absolute ADAS payroll`,
      ].map(escapeCSV).join(','))
    }

    const csv = rows.join('\n')
    res.setHeader('Content-Type', 'text/csv')
    res.setHeader('Content-Disposition',
      `attachment; filename="zoho-payroll-${period?.end || 'payroll'}.csv"`)
    res.send(csv)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── Paystub PDF ─────────────────────────────────────────────────────────────

router.post('/paystub', async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' })
    const { line, period, settings: stubSettings } = req.body
    if (!line || !period) return res.status(400).json({ error: 'line + period required' })

    const segment = getSegment(req)
    const branding = (await cacheGet(segment, 'adas_iq_branding', {})) || {}
    const storedSettings = await cacheGet(segment, 'payroll_settings', defaultSettings())
    const payrollSettings = { ...defaultSettings(), ...storedSettings, ...(stubSettings || {}) }

    const companyName = branding.company_name || payrollSettings.company_name || 'Absolute ADAS'
    const address = branding.address || ''
    const primary = branding.primary_color || '#CD4419'

    const doc = new PDFDocument({ size: 'LETTER', margin: 50 })
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition',
      `attachment; filename="paystub-${(line.user_name || 'employee').replace(/\s+/g, '-')}-${period.end}.pdf"`)
    doc.pipe(res)

    // Header
    doc.rect(0, 0, 612, 80).fill(primary)
    doc.fillColor('white').fontSize(20).font('Helvetica-Bold').text(companyName.toUpperCase(), 50, 28)
    doc.fontSize(9).font('Helvetica').text('EARNINGS STATEMENT', 50, 55)
    doc.fontSize(9).text(`Pay period: ${period.start} – ${period.end}`,
      400, 28, { width: 162, align: 'right' })
    doc.text(line.payroll_type === 'w2_zoho' ? 'W-2 Employee' : 'Independent Contractor',
      400, 45, { width: 162, align: 'right' })

    // Employee info
    let y = 110
    doc.fillColor('black').fontSize(10).font('Helvetica-Bold').text('EMPLOYEE', 50, y)
    y += 14
    doc.font('Helvetica').text(line.user_name, 50, y)
    y += 12
    if (line.email) { doc.fillColor('#666').text(line.email, 50, y); y += 12 }
    doc.fillColor('black')

    doc.font('Helvetica-Bold').text('EMPLOYER', 320, 110)
    doc.font('Helvetica').text(companyName, 320, 124)
    if (address) doc.fillColor('#666').text(address, 320, 136, { width: 240 })

    y = Math.max(y, 160)
    doc.moveTo(50, y).lineTo(562, y).stroke('#e5e7eb')
    y += 12

    // Earnings
    doc.fillColor('black').fontSize(10).font('Helvetica-Bold').text('EARNINGS', 50, y)
    doc.text('AMOUNT', 500, y, { width: 62, align: 'right' })
    y += 14
    doc.font('Helvetica').fontSize(10)
    for (const b of (line.breakdown || [])) {
      doc.fillColor('#555').text(b.label, 50, y, { width: 400 })
      doc.fillColor('black').text(`$${Number(b.amount).toFixed(2)}`, 500, y, { width: 62, align: 'right' })
      y += 13
    }
    y += 4
    doc.moveTo(50, y).lineTo(562, y).stroke('#e5e7eb')
    y += 6
    doc.font('Helvetica-Bold').text('GROSS PAY', 50, y)
    doc.text(`$${Number(line.gross).toFixed(2)}`, 500, y, { width: 62, align: 'right' })
    y += 20

    // Withholding (W-2 only)
    if (line.payroll_type === 'w2_zoho' && line.total_withholding > 0) {
      doc.font('Helvetica-Bold').fontSize(10).text('WITHHOLDINGS (estimated)', 50, y)
      y += 14
      doc.font('Helvetica')
      const items = [
        ['Federal income tax', line.federal_wh],
        ['Social Security (6.2%)', line.ss_tax],
        ['Medicare (1.45%)', line.medicare_tax + (line.medicare_addl_tax || 0)],
      ]
      for (const [label, amt] of items) {
        doc.fillColor('#555').text(label, 50, y, { width: 400 })
        doc.fillColor('black').text(`-$${Number(amt || 0).toFixed(2)}`, 500, y, { width: 62, align: 'right' })
        y += 13
      }
      y += 4
      doc.moveTo(50, y).lineTo(562, y).stroke('#e5e7eb')
      y += 6
      doc.font('Helvetica-Bold').text('TOTAL WITHHOLDING', 50, y)
      doc.text(`-$${Number(line.total_withholding).toFixed(2)}`, 500, y, { width: 62, align: 'right' })
      y += 20
    }

    // Net pay
    doc.moveTo(50, y).lineTo(562, y).stroke('#1a1a1a')
    y += 10
    doc.fillColor(primary).fontSize(14).font('Helvetica-Bold').text('NET PAY', 50, y)
    doc.text(`$${Number(line.net).toFixed(2)}`, 480, y, { width: 82, align: 'right' })

    // Footer note
    y = 700
    doc.fillColor('#888').fontSize(8).font('Helvetica')
      .text(line.payroll_type === 'w2_zoho'
        ? 'Withholdings are estimated. Official amounts determined by Zoho Payroll at processing.'
        : 'Independent contractor — no taxes withheld. You are responsible for self-employment taxes.',
        50, y, { width: 512, align: 'center' })

    doc.end()
  } catch (e) {
    console.error('[payroll] paystub failed:', e)
    if (!res.headersSent) res.status(500).json({ error: e.message })
  }
})

export default router
