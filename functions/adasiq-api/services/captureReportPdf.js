// Partnership Discount Report — 1-page personalized PDF.
//
// v3.1 doctrine ("The Partnership Discount" — replaces v2.5's Capture
// System). Shows the shop's monthly + annual margin earned via the
// partnership discount, broken down by tier (Standard 15% / Volume 20%
// / Preferred Partner 25%), and compared against vendors that don't
// discount (margin = $0).
//
// Internally still called captureReportPdf for codebase continuity.
//
// Generated on form submission, attached to the email + offered as download.

import PDFDocument from 'pdfkit'

const ORANGE      = '#CD4419'
const ORANGE_DARK = '#b33a15'
const DARK        = '#0d0d0d'
const DARK_2      = '#1a1a1a'
const GREEN       = '#16a34a'
const GREEN_DARK  = '#15803d'
const GRAY_DARK   = '#444444'
const GRAY_MID    = '#6b6b6b'
const GRAY_LIGHT  = '#e5e7eb'
const WHITE       = '#ffffff'
const OFF_WHITE   = '#fafafa'

const PAGE_W    = 612
const PAGE_H    = 792
const MARGIN    = 48
const CONTENT_W = PAGE_W - MARGIN * 2

// Canonical pricing per docs/absolute-adas-cost-list.xlsx (v3.1).
const DEFAULT_LIST_PRICE = 450

function fmtCurrency(n) {
  if (!Number.isFinite(n)) return '$0'
  return '$' + Math.round(n).toLocaleString('en-US')
}

function fmtCurrency2(n) {
  if (!Number.isFinite(n)) return '$0.00'
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/**
 * @param {Object} input
 * @param {string} input.shopName
 * @param {string} input.contactName
 * @param {number} input.calibrationsPerMonth
 * @param {number} input.listPrice
 * @param {Object} input.calc   - output of computePartnershipNumbers()
 * @returns {Promise<Buffer>}
 */
export function generateCaptureReportPdf(input) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 0 })
    const chunks = []
    doc.on('data', c => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    const { shopName, contactName, calibrationsPerMonth, listPrice, calc } = input

    // ── HEADER BAND ─────────────────────────────────────────────────────────
    doc.rect(0, 0, PAGE_W, 56).fill(DARK)
    doc.roundedRect(MARGIN, 16, 24, 24, 5).fill(ORANGE)
    doc.font('Helvetica-Bold').fontSize(11).fillColor(WHITE).text('A', MARGIN, 22, { width: 24, align: 'center' })
    doc.font('Helvetica-Bold').fontSize(12).fillColor(WHITE).text('ABSOLUTE ADAS', MARGIN + 32, 21, { characterSpacing: 1.2 })
    doc.font('Helvetica').fontSize(8).fillColor('#9ca3af').text('Partnership Discount Report  ·  Personalized for your shop', MARGIN + 32, 36)
    doc.font('Helvetica').fontSize(8).fillColor('#9ca3af')
      .text(new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }), MARGIN, 36, { width: CONTENT_W, align: 'right' })

    // ── TITLE / HOOK ────────────────────────────────────────────────────────
    let y = 90
    doc.font('Helvetica-Bold').fontSize(22).fillColor(DARK_2)
      .text(`${shopName || 'Your shop'}'s margin on calibrations`, MARGIN, y, { width: CONTENT_W })
    y += 32
    doc.font('Helvetica').fontSize(11).fillColor(GRAY_DARK)
      .text(`${contactName ? contactName + '. H' : 'H'}ere's what the partnership discount earns ${shopName || 'your shop'} on the calibration volume you're already doing — invoiced at insurance-approved list price, with the discount applied automatically every invoice.`,
            MARGIN, y, { width: CONTENT_W, lineGap: 1.5 })
    y += 50

    // ── INPUTS BOX ──────────────────────────────────────────────────────────
    doc.roundedRect(MARGIN, y, CONTENT_W, 70, 6).fill(OFF_WHITE).stroke(GRAY_LIGHT)
    doc.font('Helvetica-Bold').fontSize(8).fillColor(GRAY_MID).text('YOUR INPUTS', MARGIN + 16, y + 12, { characterSpacing: 1.5 })
    const col1 = MARGIN + 16
    const col2 = MARGIN + (CONTENT_W / 3) + 8
    const col3 = MARGIN + (CONTENT_W * 2 / 3) - 4
    doc.font('Helvetica').fontSize(9).fillColor(GRAY_MID).text('Calibrations per month', col1, y + 30)
    doc.font('Helvetica-Bold').fontSize(16).fillColor(DARK_2).text(String(calibrationsPerMonth), col1, y + 42)
    doc.font('Helvetica').fontSize(9).fillColor(GRAY_MID).text('Average list price', col2, y + 30)
    doc.font('Helvetica-Bold').fontSize(16).fillColor(DARK_2).text(fmtCurrency(listPrice), col2, y + 42)
    doc.font('Helvetica').fontSize(9).fillColor(GRAY_MID).text('Your tier (auto)', col3, y + 30)
    doc.font('Helvetica-Bold').fontSize(16).fillColor(ORANGE).text(calc.tierLabel, col3, y + 42)
    y += 90

    // ── HEADLINE NUMBER ─────────────────────────────────────────────────────
    doc.roundedRect(MARGIN, y, CONTENT_W, 116, 8).fill('#f0fdf4').stroke('#bbf7d0')
    doc.font('Helvetica-Bold').fontSize(9).fillColor(GREEN_DARK).text('YOUR PARTNERSHIP MARGIN', MARGIN + 18, y + 14, { characterSpacing: 1.5 })
    doc.font('Helvetica-Bold').fontSize(34).fillColor(GREEN).text(fmtCurrency(calc.annualMargin), MARGIN + 18, y + 30)
    doc.font('Helvetica').fontSize(10).fillColor(GRAY_DARK)
      .text(`per year on calibrations you bill insurance for at list. That's ${fmtCurrency(calc.monthlyMargin)} every month, earned automatically through your existing RO flow.`,
            MARGIN + 18, y + 72, { width: CONTENT_W - 36, lineGap: 1.5 })
    y += 136

    // ── PER-JOB MATH BREAKDOWN ──────────────────────────────────────────────
    doc.font('Helvetica-Bold').fontSize(11).fillColor(DARK_2).text('How the math works on every invoice', MARGIN, y, { width: CONTENT_W })
    y += 18
    const mathRows = [
      ['List price (what your shop bills customer / insurance)', fmtCurrency2(calc.listPrice)],
      [`What your shop pays Absolute ADAS (${calc.tierDiscountPct}% partner discount)`, `-${fmtCurrency2(calc.partnerPrice)}`],
      ['Your margin per calibration', fmtCurrency2(calc.marginPerCal)],
    ]
    mathRows.forEach(([label, value], i) => {
      const isLast = i === mathRows.length - 1
      doc.font('Helvetica').fontSize(10).fillColor(isLast ? GREEN_DARK : GRAY_DARK).text(label, MARGIN, y + 4, { width: CONTENT_W - 100 })
      doc.font(isLast ? 'Helvetica-Bold' : 'Helvetica').fontSize(11).fillColor(isLast ? GREEN_DARK : DARK_2).text(value, MARGIN, y + 4, { width: CONTENT_W, align: 'right' })
      if (!isLast) {
        doc.moveTo(MARGIN, y + 22).lineTo(PAGE_W - MARGIN, y + 22).strokeColor(GRAY_LIGHT).lineWidth(0.5).stroke()
      } else {
        doc.moveTo(MARGIN, y + 22).lineTo(PAGE_W - MARGIN, y + 22).strokeColor(GREEN).lineWidth(1.5).stroke()
      }
      y += 26
    })
    y += 10

    // ── TIER LADDER ─────────────────────────────────────────────────────────
    doc.font('Helvetica-Bold').fontSize(11).fillColor(DARK_2).text('Your annual margin at every tier', MARGIN, y, { width: CONTENT_W })
    y += 16
    doc.font('Helvetica').fontSize(9).fillColor(GRAY_MID).text('Margin scales with volume. Same list price, bigger partner discount.', MARGIN, y, { width: CONTENT_W })
    y += 16
    const tierRows = [
      ['Standard (1-14 cals/mo)',    '15% off list', calc.annualAtStandard, calc.tier === 'standard'],
      ['Volume (15-29 cals/mo)',     '20% off list', calc.annualAtVolume,   calc.tier === 'volume'],
      ['Preferred Partner (30+/mo)', '25% off list', calc.annualAtPreferred, calc.tier === 'preferred'],
    ]
    tierRows.forEach(([tierName, discountLabel, annual, isCurrent]) => {
      const bg = isCurrent ? '#fef7ed' : WHITE
      doc.roundedRect(MARGIN, y, CONTENT_W, 24, 4).fill(bg).stroke(isCurrent ? ORANGE : GRAY_LIGHT)
      doc.font(isCurrent ? 'Helvetica-Bold' : 'Helvetica').fontSize(10).fillColor(isCurrent ? ORANGE : DARK_2).text(tierName, MARGIN + 10, y + 7)
      doc.font('Helvetica').fontSize(9).fillColor(GRAY_MID).text(discountLabel, MARGIN + 220, y + 8)
      doc.font(isCurrent ? 'Helvetica-Bold' : 'Helvetica').fontSize(11).fillColor(isCurrent ? ORANGE : DARK_2).text(fmtCurrency(annual) + '/yr', MARGIN, y + 7, { width: CONTENT_W - 10, align: 'right' })
      y += 28
    })
    y += 6

    // ── GUARANTEE ───────────────────────────────────────────────────────────
    doc.roundedRect(MARGIN, y, CONTENT_W, 60, 8).fill(DARK_2)
    doc.font('Helvetica-Bold').fontSize(9).fillColor(ORANGE).text('THE PARTNERSHIP GUARANTEE', MARGIN + 18, y + 12, { characterSpacing: 1.5 })
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(WHITE)
      .text(`If we don't deliver every calibration on-time, with full OEM documentation, AND apply your partnership discount on every single invoice for your first 90 days, we work for free until we do. AND we cut you a check for $500 to make it right.`,
            MARGIN + 18, y + 26, { width: CONTENT_W - 36, lineGap: 1.5 })
    y += 76

    // ── CTA ─────────────────────────────────────────────────────────────────
    doc.font('Helvetica-Bold').fontSize(10).fillColor(DARK_2)
      .text(`Ready to start? Book a free 15-minute Partnership Audit.`, MARGIN, y, { width: CONTENT_W })
    y += 16
    doc.roundedRect(MARGIN, y, 200, 28, 6).fill(ORANGE)
    doc.font('Helvetica-Bold').fontSize(10).fillColor(WHITE).text('Book your audit  →', MARGIN, y + 9, { width: 200, align: 'center' })
    doc.font('Helvetica').fontSize(9).fillColor(GRAY_MID)
      .text('absoluteadas.com/audit  ·  1-844-349-2327', MARGIN + 212, y + 10)

    // ── FOOTER ──────────────────────────────────────────────────────────────
    const fy = PAGE_H - 30
    doc.moveTo(MARGIN, fy).lineTo(PAGE_W - MARGIN, fy).strokeColor(GRAY_LIGHT).lineWidth(0.5).stroke()
    doc.font('Helvetica').fontSize(7).fillColor(GRAY_MID)
      .text(`Estimate based on $${listPrice} static calibration list price. Real per-job pricing varies by service type (BSM/LKA/360-view/etc.) — full cost list at absoluteadas.com.  Absolute ADAS  ·  Western Washington  ·  Preferred vendor with State Farm and other major carriers.`,
            MARGIN, fy + 8, { width: CONTENT_W, align: 'center' })

    doc.end()
  })
}

/**
 * Partnership Discount math (v3.1).
 *
 *   List price → partner discount (15/20/25%) → margin per cal
 *   Volume tier auto-derives from monthly calibration count.
 *
 * @param {{ calibrationsPerMonth: number, listPrice?: number }} input
 */
export function computePartnershipNumbers({ calibrationsPerMonth, listPrice = DEFAULT_LIST_PRICE }) {
  const cals = Math.max(0, Number(calibrationsPerMonth) || 0)
  const price = Math.max(0, Number(listPrice) || DEFAULT_LIST_PRICE)

  // Auto-derive tier from monthly volume per v3.1 cost-list xlsx.
  let tier, tierLabel, tierDiscount
  if (cals >= 30)      { tier = 'preferred'; tierLabel = 'Preferred Partner'; tierDiscount = 0.25 }
  else if (cals >= 15) { tier = 'volume';    tierLabel = 'Volume';            tierDiscount = 0.20 }
  else                 { tier = 'standard';  tierLabel = 'Standard';          tierDiscount = 0.15 }

  const partnerPrice  = price * (1 - tierDiscount)
  const marginPerCal  = price - partnerPrice
  const monthlyMargin = cals * marginPerCal
  const annualMargin  = monthlyMargin * 12

  // For the tier-ladder visualization in the PDF + email.
  const annualAtStandard  = cals * price * 0.15 * 12
  const annualAtVolume    = cals * price * 0.20 * 12
  const annualAtPreferred = cals * price * 0.25 * 12

  return {
    calibrationsPerMonth: cals,
    listPrice: price,
    tier,
    tierLabel,
    tierDiscount,
    tierDiscountPct: Math.round(tierDiscount * 100),
    partnerPrice,
    marginPerCal,
    monthlyMargin,
    annualMargin,
    annualAtStandard,
    annualAtVolume,
    annualAtPreferred,
    // Differential vs a vendor that charges list (margin = $0 to shop)
    annualVsListVendor: annualMargin,
  }
}

// Back-compat alias — the route currently imports the old name.
export { computePartnershipNumbers as computeCaptureNumbers }
