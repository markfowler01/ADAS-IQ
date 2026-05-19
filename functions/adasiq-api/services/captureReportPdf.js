// Capture Rate Calculator — 1-page personalized PDF report.
//
// Front: hook + the shop's specific numbers (current leak in red, potential
// capture in green). Back: the 4-A Absolute Capture System + Grand Slam
// Guarantee + CTA.
//
// Generated on form submission, attached to the email + offered as download.

import PDFDocument from 'pdfkit'

const ORANGE      = '#CD4419'
const ORANGE_DARK = '#b33a15'
const DARK        = '#0d0d0d'
const DARK_2      = '#1a1a1a'
const RED         = '#dc2626'
const GREEN       = '#16a34a'
const GRAY_DARK   = '#444444'
const GRAY_MID    = '#6b6b6b'
const GRAY_LIGHT  = '#e5e7eb'
const WHITE       = '#ffffff'
const OFF_WHITE   = '#fafafa'

const PAGE_W    = 612
const PAGE_H    = 792
const MARGIN    = 48
const CONTENT_W = PAGE_W - MARGIN * 2

function fmtCurrency(n) {
  if (!Number.isFinite(n)) return '$0'
  return '$' + Math.round(n).toLocaleString('en-US')
}

function fmtPct(n) {
  if (!Number.isFinite(n)) return '0%'
  return Math.round(n) + '%'
}

/**
 * @param {Object} input
 * @param {string} input.shopName
 * @param {string} input.contactName
 * @param {number} input.calibrationsPerMonth
 * @param {number} input.avgTicket
 * @param {number} input.currentCapturePct  - 0-100, the GP% they make on subs today
 * @param {Object} input.calc   - output of computeCaptureNumbers()
 * @returns {Promise<Buffer>}
 */
export function generateCaptureReportPdf(input) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 0 })
    const chunks = []
    doc.on('data', c => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    const { shopName, contactName, calibrationsPerMonth, avgTicket, currentCapturePct, calc } = input

    // ── HEADER BAND ─────────────────────────────────────────────────────────
    doc.rect(0, 0, PAGE_W, 56).fill(DARK)
    doc.roundedRect(MARGIN, 16, 24, 24, 5).fill(ORANGE)
    doc.font('Helvetica-Bold').fontSize(11).fillColor(WHITE).text('A', MARGIN + 0, 22, { width: 24, align: 'center' })
    doc.font('Helvetica-Bold').fontSize(12).fillColor(WHITE).text('ABSOLUTE ADAS', MARGIN + 32, 21, { characterSpacing: 1.2 })
    doc.font('Helvetica').fontSize(8).fillColor('#9ca3af').text('Capture Rate Report  ·  Personalized for your shop', MARGIN + 32, 36)
    doc.font('Helvetica').fontSize(8).fillColor('#9ca3af')
      .text(new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }), MARGIN, 36, { width: CONTENT_W, align: 'right' })

    // ── TITLE / HOOK ────────────────────────────────────────────────────────
    let y = 90
    doc.font('Helvetica-Bold').fontSize(22).fillColor(DARK_2)
      .text(`${shopName || 'Your shop'}'s hidden GP leak`, MARGIN, y, { width: CONTENT_W })
    y += 32
    doc.font('Helvetica').fontSize(11).fillColor(GRAY_DARK)
      .text(`${contactName ? contactName + ' — ' : ''}here's what 60 seconds of math told us about your sublet calibration P&L.`, MARGIN, y, { width: CONTENT_W })
    y += 36

    // ── INPUTS BOX ──────────────────────────────────────────────────────────
    doc.roundedRect(MARGIN, y, CONTENT_W, 70, 6).fill(OFF_WHITE).stroke(GRAY_LIGHT)
    doc.font('Helvetica-Bold').fontSize(8).fillColor(GRAY_MID).text('YOUR INPUTS', MARGIN + 16, y + 12, { characterSpacing: 1.5 })
    const col1 = MARGIN + 16
    const col2 = MARGIN + (CONTENT_W / 3) + 8
    const col3 = MARGIN + (CONTENT_W * 2 / 3) - 4
    doc.font('Helvetica').fontSize(9).fillColor(GRAY_MID).text('Calibrations subbed / mo', col1, y + 30)
    doc.font('Helvetica-Bold').fontSize(16).fillColor(DARK_2).text(String(calibrationsPerMonth), col1, y + 42)
    doc.font('Helvetica').fontSize(9).fillColor(GRAY_MID).text('Average ticket', col2, y + 30)
    doc.font('Helvetica-Bold').fontSize(16).fillColor(DARK_2).text(fmtCurrency(avgTicket), col2, y + 42)
    doc.font('Helvetica').fontSize(9).fillColor(GRAY_MID).text('Current capture %', col3, y + 30)
    doc.font('Helvetica-Bold').fontSize(16).fillColor(DARK_2).text(fmtPct(currentCapturePct), col3, y + 42)
    y += 90

    // ── LEAK CARD (RED) ─────────────────────────────────────────────────────
    doc.roundedRect(MARGIN, y, CONTENT_W, 96, 8).fill('#fef2f2').stroke('#fecaca')
    doc.font('Helvetica-Bold').fontSize(9).fillColor(RED).text('THE LEAK — RIGHT NOW', MARGIN + 18, y + 14, { characterSpacing: 1.5 })
    doc.font('Helvetica-Bold').fontSize(34).fillColor(RED).text(fmtCurrency(calc.annualLeak), MARGIN + 18, y + 30)
    doc.font('Helvetica').fontSize(10).fillColor(GRAY_DARK)
      .text(`per year walking out your bay door as sublet vendor margin.`, MARGIN + 18, y + 72, { width: CONTENT_W - 36 })
    y += 116

    // ── CAPTURE CARD (GREEN) ────────────────────────────────────────────────
    doc.roundedRect(MARGIN, y, CONTENT_W, 96, 8).fill('#f0fdf4').stroke('#bbf7d0')
    doc.font('Helvetica-Bold').fontSize(9).fillColor(GREEN).text('THE CAPTURE — WITH THE ABSOLUTE CAPTURE SYSTEM', MARGIN + 18, y + 14, { characterSpacing: 1.5 })
    doc.font('Helvetica-Bold').fontSize(34).fillColor(GREEN).text(fmtCurrency(calc.annualCapture), MARGIN + 18, y + 30)
    doc.font('Helvetica').fontSize(10).fillColor(GRAY_DARK)
      .text(`net new gross profit per year, captured automatically through your existing RO flow. No capex.`, MARGIN + 18, y + 72, { width: CONTENT_W - 36 })
    y += 124

    // ── THE 4-A SYSTEM ──────────────────────────────────────────────────────
    doc.font('Helvetica-Bold').fontSize(13).fillColor(DARK_2).text('How we close the leak — The Absolute Capture System', MARGIN, y, { width: CONTENT_W })
    y += 22
    const steps = [
      ['1. AUDIT',    'We pull your last 90 days of sublet invoices and ROs and confirm your exact capture number.'],
      ['2. ACTIVATE', 'We become your white-label calibration department. Same-day mobile dispatch, OEM tools, full documentation.'],
      ['3. ALLOCATE', 'A defined percentage of every calibration becomes shop GP automatically. No invoicing. No reconciliation.'],
      ['4. AMPLIFY',  'Once capture is running, we help you market your new ADAS capability to insurance, dealers, and glass shops.'],
    ]
    steps.forEach(([label, body]) => {
      doc.font('Helvetica-Bold').fontSize(9).fillColor(ORANGE).text(label, MARGIN, y, { characterSpacing: 1.2 })
      doc.font('Helvetica').fontSize(9.5).fillColor(GRAY_DARK).text(body, MARGIN + 70, y, { width: CONTENT_W - 70 })
      y += 22
    })
    y += 8

    // ── GRAND SLAM GUARANTEE ────────────────────────────────────────────────
    doc.roundedRect(MARGIN, y, CONTENT_W, 70, 8).fill(DARK_2)
    doc.font('Helvetica-Bold').fontSize(9).fillColor(ORANGE).text('THE GUARANTEE', MARGIN + 18, y + 12, { characterSpacing: 1.5 })
    doc.font('Helvetica-Bold').fontSize(10.5).fillColor(WHITE)
      .text(`If the Absolute Capture System doesn't add at least $10,000 in new monthly GP within 90 days of activation, we work for free until it does. And we cut you a check for $1,000 for the time we wasted.`, MARGIN + 18, y + 28, { width: CONTENT_W - 36, lineGap: 2 })
    y += 86

    // ── CTA ─────────────────────────────────────────────────────────────────
    doc.font('Helvetica-Bold').fontSize(11).fillColor(DARK_2)
      .text(`Want to see the rest of your number?`, MARGIN, y, { width: CONTENT_W })
    y += 18
    doc.font('Helvetica').fontSize(10).fillColor(GRAY_DARK)
      .text(`Book a free 15-minute Revenue Audit. We pull your real sublet invoices and walk you through what your number actually is — not the calculator's estimate.`, MARGIN, y, { width: CONTENT_W, lineGap: 1.5 })
    y += 32
    doc.roundedRect(MARGIN, y, 200, 32, 6).fill(ORANGE)
    doc.font('Helvetica-Bold').fontSize(11).fillColor(WHITE).text('Book your audit  →', MARGIN, y + 11, { width: 200, align: 'center' })
    doc.font('Helvetica').fontSize(9).fillColor(GRAY_MID)
      .text('absoluteadas.com/audit  ·  1-844-FIX-ADAS', MARGIN + 212, y + 12)

    // ── FOOTER ──────────────────────────────────────────────────────────────
    const fy = PAGE_H - 30
    doc.moveTo(MARGIN, fy).lineTo(PAGE_W - MARGIN, fy).strokeColor(GRAY_LIGHT).lineWidth(0.5).stroke()
    doc.font('Helvetica').fontSize(7).fillColor(GRAY_MID)
      .text(`Estimate based on industry-typical sublet margins. Real numbers vary by carrier mix and vehicle profile. Absolute ADAS  ·  Western Washington  ·  50,000+ calibrations on the floor.`,
            MARGIN, fy + 8, { width: CONTENT_W, align: 'center' })

    doc.end()
  })
}

/**
 * The math. Returns the dollar leak + dollar capture under the Absolute model.
 *
 * Assumptions baked in:
 *   - Target capture rate under our model: 30% (mid of the 25-40% range).
 *   - Current capture % is what the shop reports; we trust their number.
 *
 * @param {{ calibrationsPerMonth: number, avgTicket: number, currentCapturePct: number }} input
 */
export function computeCaptureNumbers({ calibrationsPerMonth, avgTicket, currentCapturePct }) {
  const TARGET_CAPTURE = 0.30
  const cals = Math.max(0, Number(calibrationsPerMonth) || 0)
  const ticket = Math.max(0, Number(avgTicket) || 0)
  const cur = Math.max(0, Math.min(100, Number(currentCapturePct) || 0)) / 100

  const monthlyRev      = cals * ticket
  const currentMonthlyGp = monthlyRev * cur
  const targetMonthlyGp  = monthlyRev * TARGET_CAPTURE
  const monthlyLeak      = Math.max(0, targetMonthlyGp - currentMonthlyGp)
  const monthlyCapture   = monthlyLeak

  return {
    monthlyRev,
    currentMonthlyGp,
    targetMonthlyGp,
    monthlyLeak,
    annualLeak: monthlyLeak * 12,
    monthlyCapture,
    annualCapture: monthlyCapture * 12,
    targetCapturePct: TARGET_CAPTURE * 100,
  }
}
