// Sales leave-behind PDF — 2-page printable brochure (v3.1).
//
// Page 1 (front, dark): hook + headline math ($8,100/yr at 10 cals/mo)
// Page 2 (back, light): 4-component Partnership Discount Model + Guarantee + CTA
//
// Mark and Kat print these for in-person shop visits and direct mail.
// Generic, not personalized. Print letter-size, double-sided.
//
// v3.1 doctrine: villain is list-price sublet vendors that don't discount.
// Mechanism is the Partnership Discount Model (15/20/25% off list).
// Numbers come from the canonical cost-list xlsx (docs/absolute-adas-cost-list.xlsx).

import PDFDocument from 'pdfkit'

const ORANGE      = '#CD4419'
const DARK        = '#0d0d0d'
const DARK_2      = '#1a1a1a'
const GREEN       = '#16a34a'
const GREEN_DARK  = '#15803d'
const GRAY_DARK   = '#444444'
const GRAY_MID    = '#6b6b6b'
const GRAY_LIGHT  = '#e5e7eb'
const WHITE       = '#ffffff'
const OFF_WHITE   = '#fafafa'

const PAGE_W = 612
const PAGE_H = 792
const MARGIN = 48
const CONTENT_W = PAGE_W - MARGIN * 2

export function generateLeaveBehindPdf() {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 0 })
    const chunks = []
    doc.on('data', c => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    drawFront(doc)
    doc.addPage()
    drawBack(doc)

    doc.end()
  })
}

function drawFront(doc) {
  // Full-bleed dark background
  doc.rect(0, 0, PAGE_W, PAGE_H).fill(DARK)

  // Header band
  doc.roundedRect(MARGIN, 56, 28, 28, 6).fill(ORANGE)
  doc.font('Helvetica-Bold').fontSize(13).fillColor(WHITE).text('A', MARGIN, 64, { width: 28, align: 'center' })
  doc.font('Helvetica-Bold').fontSize(13).fillColor(WHITE).text('ABSOLUTE ADAS', MARGIN + 38, 63, { characterSpacing: 1.5 })
  doc.font('Helvetica').fontSize(9).fillColor('#9ca3af').text('Mobile ADAS Calibration  ·  Western Washington', MARGIN + 38, 78)

  // Hook
  let y = 130
  doc.font('Helvetica-Bold').fontSize(10).fillColor(ORANGE).text('FOR BODY SHOP OWNERS WHO SUBLET CALIBRATIONS', MARGIN, y, { characterSpacing: 1.4 })
  y += 22
  doc.font('Helvetica-Bold').fontSize(38).fillColor(WHITE)
    .text('Earn $8,100 a year', MARGIN, y, { width: CONTENT_W, lineGap: 2 })
  y += 44
  doc.font('Helvetica-Bold').fontSize(38).fillColor(WHITE).text('on calibrations', MARGIN, y, { width: CONTENT_W })
  y += 44
  doc.font('Helvetica-Bold').fontSize(38).fillColor(ORANGE).text('you already bill insurance for.', MARGIN, y, { width: CONTENT_W })
  y += 70

  // Body
  doc.font('Helvetica').fontSize(13).fillColor('#d1d5db')
    .text('Most mobile calibration vendors show up at your bay, use your power and parking, charge full list, send the invoice, and leave. The standard sublet playbook. They keep 100% of the margin on a job your facility helped make possible.', MARGIN, y, { width: CONTENT_W, lineGap: 4 })
  y += 88
  doc.font('Helvetica').fontSize(13).fillColor('#d1d5db')
    .text('We do it differently. Every Absolute ADAS invoice to a partner shop shows a 15-25% partner discount off list. You bill insurance at list (insurance-approved). The difference is your margin.', MARGIN, y, { width: CONTENT_W, lineGap: 4 })
  y += 76

  // Math example box
  doc.roundedRect(MARGIN, y, CONTENT_W, 132, 10).fill('#0a1f12').stroke(GREEN)
  doc.font('Helvetica-Bold').fontSize(10).fillColor(GREEN).text('REAL MATH, STANDARD PARTNER TIER', MARGIN + 20, y + 16, { characterSpacing: 1.5 })
  const rowY = y + 38
  const col1 = MARGIN + 20
  const col2 = MARGIN + CONTENT_W / 3 + 8
  const col3 = MARGIN + (CONTENT_W * 2) / 3
  doc.font('Helvetica').fontSize(9).fillColor('#9ca3af').text('Calibrations / month', col1, rowY)
  doc.font('Helvetica-Bold').fontSize(22).fillColor(WHITE).text('10', col1, rowY + 14)
  doc.font('Helvetica').fontSize(9).fillColor('#9ca3af').text('List price (per static cal)', col2, rowY)
  doc.font('Helvetica-Bold').fontSize(22).fillColor(WHITE).text('$450', col2, rowY + 14)
  doc.font('Helvetica').fontSize(9).fillColor('#9ca3af').text('Partner discount', col3, rowY)
  doc.font('Helvetica-Bold').fontSize(22).fillColor(ORANGE).text('15%', col3, rowY + 14)
  // Result row
  const resY = y + 92
  doc.font('Helvetica').fontSize(11).fillColor('#d1d5db').text('Your shop\'s annual margin (automatic, every invoice):', MARGIN + 20, resY)
  doc.font('Helvetica-Bold').fontSize(22).fillColor(GREEN).text('$8,100 / year', MARGIN + CONTENT_W - 180, resY - 4, { width: 180, align: 'right' })
  // Sub-text
  doc.font('Helvetica').fontSize(9).fillColor('#9ca3af').text('Volume tier (15+/mo, 20% off) = $16,200/yr  ·  Preferred Partner (30+/mo, 25%) = $40,500/yr', MARGIN + 20, resY + 24, { width: CONTENT_W - 40 })

  y += 152

  // CTA — run your numbers
  doc.font('Helvetica-Bold').fontSize(13).fillColor(WHITE).text('Run your shop\'s real numbers in 60 seconds.', MARGIN, y, { width: CONTENT_W })
  y += 22
  doc.roundedRect(MARGIN, y, 280, 36, 6).fill(ORANGE)
  doc.font('Helvetica-Bold').fontSize(12).fillColor(WHITE).text('absoluteadas.com/calculator', MARGIN, y + 13, { width: 280, align: 'center' })
  doc.font('Helvetica').fontSize(11).fillColor('#9ca3af').text('Free. No call required. PDF emailed.', MARGIN + 290, y + 14)

  // Footer
  const fy = PAGE_H - 56
  doc.moveTo(MARGIN, fy).lineTo(PAGE_W - MARGIN, fy).strokeColor('#374151').lineWidth(0.5).stroke()
  doc.font('Helvetica').fontSize(9).fillColor('#9ca3af').text('Mark Fowler  ·  Owner', MARGIN, fy + 12)
  doc.font('Helvetica').fontSize(9).fillColor('#9ca3af').text('1-844-349-2327  ·  absoluteadas.com', MARGIN, fy + 12, { width: CONTENT_W, align: 'right' })
  doc.font('Helvetica').fontSize(8).fillColor('#6b7280').text('50,000+ calibrations on the floor  ·  State Farm DRP preferred vendor  ·  $1M insured', MARGIN, fy + 26, { width: CONTENT_W, align: 'center' })
}

function drawBack(doc) {
  // Off-white background
  doc.rect(0, 0, PAGE_W, PAGE_H).fill('#fefcfa')

  // Header
  let y = 56
  doc.roundedRect(MARGIN, y, 24, 24, 5).fill(ORANGE)
  doc.font('Helvetica-Bold').fontSize(11).fillColor(WHITE).text('A', MARGIN, y + 7, { width: 24, align: 'center' })
  doc.font('Helvetica-Bold').fontSize(12).fillColor(DARK_2).text('THE PARTNERSHIP DISCOUNT MODEL', MARGIN + 34, y + 7, { characterSpacing: 1.4 })
  y += 50

  doc.font('Helvetica-Bold').fontSize(26).fillColor(DARK_2).text('How the discount lands on every invoice.', MARGIN, y, { width: CONTENT_W })
  y += 44
  doc.font('Helvetica').fontSize(12).fillColor(GRAY_DARK)
    .text('No paperwork. No quarterly rebate forms. The partner discount is on every Absolute ADAS invoice from day one. You bill insurance at list (insurance-approved — we\'re a preferred vendor with State Farm and other major carriers). The difference is your margin.', MARGIN, y, { width: CONTENT_W, lineGap: 3 })
  y += 76

  // 4 components
  const steps = [
    ['1. WE COME TO YOU',      'Mobile dispatch to your facility. Same-day when scheduled, next-day standard. No vehicle transport, no cycle time hit, no customer friction.'],
    ['2. WE DISCOUNT',          'Standard partner discount: 15% off list on every calibration. Automatic. No paperwork.'],
    ['3. YOU BILL AT LIST',     'Insurance and customers pay list (insurance-approved with State Farm and other major carriers). The discount we give you IS your margin.'],
    ['4. VOLUME REWARDS YOU',   '15+ cals/mo unlocks 20% off list. 30+ cals/mo unlocks 25% off + same-day priority + free documentation package.'],
  ]
  steps.forEach(([label, body]) => {
    doc.roundedRect(MARGIN, y, 132, 22, 4).fill(ORANGE)
    doc.font('Helvetica-Bold').fontSize(9).fillColor(WHITE).text(label, MARGIN, y + 7, { width: 132, align: 'center', characterSpacing: 0.6 })
    doc.font('Helvetica').fontSize(11).fillColor(DARK_2).text(body, MARGIN + 144, y + 4, { width: CONTENT_W - 144, lineGap: 2 })
    y += 42
  })

  y += 6
  // Guarantee
  doc.roundedRect(MARGIN, y, CONTENT_W, 96, 10).fill(DARK_2)
  doc.font('Helvetica-Bold').fontSize(10).fillColor(ORANGE).text('THE PARTNERSHIP GUARANTEE', MARGIN + 20, y + 14, { characterSpacing: 1.5 })
  doc.font('Helvetica-Bold').fontSize(11).fillColor(WHITE)
    .text('If we don\'t deliver every calibration on-time, with full OEM documentation, AND apply your partnership discount on every single invoice for your first 90 days, we work for free until we do. AND we cut you a check for $500 to make it right.',
          MARGIN + 20, y + 32, { width: CONTENT_W - 40, lineGap: 3 })
  y += 116

  // CTA block
  doc.roundedRect(MARGIN, y, CONTENT_W, 96, 10).fill(OFF_WHITE).stroke(ORANGE)
  doc.font('Helvetica-Bold').fontSize(15).fillColor(DARK_2).text('Next step: 15-minute Partnership Audit.', MARGIN + 20, y + 16, { width: CONTENT_W - 40 })
  doc.font('Helvetica').fontSize(11).fillColor(GRAY_DARK)
    .text('Free, no commitment. We walk through how the discount lands on your specific RO workflow + answer any questions before your first trial calibration.', MARGIN + 20, y + 38, { width: CONTENT_W - 40, lineGap: 2 })
  doc.font('Helvetica-Bold').fontSize(13).fillColor(ORANGE)
    .text('absoluteadas.com/partnership-audit', MARGIN + 20, y + 72)
  doc.font('Helvetica-Bold').fontSize(13).fillColor(ORANGE)
    .text('1-844-349-2327', MARGIN + 20, y + 72, { width: CONTENT_W - 40, align: 'right' })

  // Footer
  const fy = PAGE_H - 56
  doc.moveTo(MARGIN, fy).lineTo(PAGE_W - MARGIN, fy).strokeColor(GRAY_LIGHT).lineWidth(0.5).stroke()
  doc.font('Helvetica').fontSize(8).fillColor(GRAY_MID)
    .text('Absolute ADAS  ·  Mobile ADAS Calibration  ·  Western Washington  ·  50,000+ calibrations  ·  State Farm DRP preferred vendor', MARGIN, fy + 16, { width: CONTENT_W, align: 'center' })
}
