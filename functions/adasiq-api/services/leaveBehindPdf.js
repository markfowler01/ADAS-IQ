// Sales leave-behind PDF — 2-page printable brochure.
//
// Page 1 (front): hook + the math (greed angle, since it converts cold best)
// Page 2 (back):  4-A Absolute Capture System + Grand Slam Guarantee + CTA
//
// Mark and Kat print these for in-person shop visits and direct mail.
// Generic, not personalized (unlike the Capture Report which uses the shop's
// real inputs). Print on letter-size paper, double-sided.

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
  doc.font('Helvetica-Bold').fontSize(10).fillColor(ORANGE).text('IF YOU SUBLET CALIBRATIONS', MARGIN, y, { characterSpacing: 1.8 })
  y += 22
  doc.font('Helvetica-Bold').fontSize(38).fillColor(WHITE)
    .text('Your sublet vendor', MARGIN, y, { width: CONTENT_W, lineGap: 2 })
  y += 44
  doc.font('Helvetica-Bold').fontSize(38).fillColor(WHITE).text('is making profit', MARGIN, y, { width: CONTENT_W })
  y += 44
  doc.font('Helvetica-Bold').fontSize(38).fillColor(ORANGE).text('inside your building.', MARGIN, y, { width: CONTENT_W })
  y += 60

  // Body
  doc.font('Helvetica').fontSize(13).fillColor('#d1d5db')
    .text('Every time your shop subs out a calibration, you pay a vendor to make gross profit inside your bay. The vendor wins. You collect a thin markup at retail and call it capture.', MARGIN, y, { width: CONTENT_W, lineGap: 4 })
  y += 80
  doc.font('Helvetica').fontSize(13).fillColor('#d1d5db')
    .text('Most shops we audit are leaking between three and fifteen thousand dollars of gross profit a month they could be keeping.', MARGIN, y, { width: CONTENT_W, lineGap: 4 })
  y += 56

  // Math example box
  doc.roundedRect(MARGIN, y, CONTENT_W, 124, 10).fill('#1a1208').stroke(ORANGE)
  doc.font('Helvetica-Bold').fontSize(10).fillColor(ORANGE).text('REAL MATH, TYPICAL SHOP', MARGIN + 20, y + 16, { characterSpacing: 1.5 })
  // 3-column math grid
  const rowY = y + 38
  const col1 = MARGIN + 20
  const col2 = MARGIN + CONTENT_W / 3 + 8
  const col3 = MARGIN + (CONTENT_W * 2) / 3
  doc.font('Helvetica').fontSize(9).fillColor('#9ca3af').text('Calibrations / month', col1, rowY)
  doc.font('Helvetica-Bold').fontSize(22).fillColor(WHITE).text('18', col1, rowY + 14)
  doc.font('Helvetica').fontSize(9).fillColor('#9ca3af').text('Average ticket', col2, rowY)
  doc.font('Helvetica-Bold').fontSize(22).fillColor(WHITE).text('$450', col2, rowY + 14)
  doc.font('Helvetica').fontSize(9).fillColor('#9ca3af').text('Capture upside', col3, rowY)
  doc.font('Helvetica-Bold').fontSize(22).fillColor(ORANGE).text('+20%', col3, rowY + 14)
  // The result
  const resY = y + 86
  doc.font('Helvetica').fontSize(11).fillColor('#d1d5db').text('Annual GP currently leaking to your sublet vendor:', MARGIN + 20, resY)
  doc.font('Helvetica-Bold').fontSize(20).fillColor(RED).text('$19,440 / year', MARGIN + CONTENT_W - 160, resY - 4, { width: 160, align: 'right' })

  y += 144

  // CTA — run your number
  doc.font('Helvetica-Bold').fontSize(13).fillColor(WHITE).text('Run your shop\'s real number.', MARGIN, y, { width: CONTENT_W })
  y += 22
  doc.roundedRect(MARGIN, y, 280, 36, 6).fill(ORANGE)
  doc.font('Helvetica-Bold').fontSize(12).fillColor(WHITE).text('absoluteadas.com/calculator', MARGIN, y + 13, { width: 280, align: 'center' })
  doc.font('Helvetica').fontSize(11).fillColor('#9ca3af').text('60 seconds. Free. No call required.', MARGIN + 290, y + 14)

  // Footer
  const fy = PAGE_H - 56
  doc.moveTo(MARGIN, fy).lineTo(PAGE_W - MARGIN, fy).strokeColor('#374151').lineWidth(0.5).stroke()
  doc.font('Helvetica').fontSize(9).fillColor('#9ca3af').text('Mark Fowler  ·  Owner', MARGIN, fy + 12)
  doc.font('Helvetica').fontSize(9).fillColor('#9ca3af').text('1-844-FIX-ADAS  ·  absoluteadas.com', MARGIN, fy + 12, { width: CONTENT_W, align: 'right' })
  doc.font('Helvetica').fontSize(8).fillColor('#6b7280').text('50,000+ calibrations on the floor  ·  State Farm DRP  ·  $1M insured', MARGIN, fy + 26, { width: CONTENT_W, align: 'center' })
}

function drawBack(doc) {
  // Off-white background
  doc.rect(0, 0, PAGE_W, PAGE_H).fill('#fefcfa')

  // Header
  let y = 56
  doc.roundedRect(MARGIN, y, 24, 24, 5).fill(ORANGE)
  doc.font('Helvetica-Bold').fontSize(11).fillColor(WHITE).text('A', MARGIN, y + 7, { width: 24, align: 'center' })
  doc.font('Helvetica-Bold').fontSize(12).fillColor(DARK_2).text('THE ABSOLUTE CAPTURE SYSTEM', MARGIN + 34, y + 7, { characterSpacing: 1.5 })
  y += 50

  doc.font('Helvetica-Bold').fontSize(26).fillColor(DARK_2).text('Close the leak in 4 steps.', MARGIN, y, { width: CONTENT_W })
  y += 38
  doc.font('Helvetica').fontSize(12).fillColor(GRAY_DARK)
    .text('We become your white-label calibration department. You bill at retail through your existing RO flow. A defined percentage of every calibration becomes shop GP automatically.', MARGIN, y, { width: CONTENT_W, lineGap: 3 })
  y += 58

  // 4 A's
  const steps = [
    ['1. AUDIT',    'We pull 90 days of your sublet invoices and tell you the real number. One-page Capture Report. You keep it.'],
    ['2. ACTIVATE', 'We become your white-label calibration department. Same-day mobile dispatch, OEM tools, full documentation.'],
    ['3. ALLOCATE', 'A defined percentage of every calibration becomes shop GP automatically. No invoicing. No reconciliation.'],
    ['4. AMPLIFY',  'Once capture is running, we help you market your new ADAS capability to insurance, dealers, and glass shops.'],
  ]
  steps.forEach(([label, body]) => {
    doc.roundedRect(MARGIN, y, 88, 22, 4).fill(ORANGE)
    doc.font('Helvetica-Bold').fontSize(9).fillColor(WHITE).text(label, MARGIN, y + 7, { width: 88, align: 'center', characterSpacing: 0.8 })
    doc.font('Helvetica').fontSize(11).fillColor(DARK_2).text(body, MARGIN + 102, y + 4, { width: CONTENT_W - 102, lineGap: 2 })
    y += 38
  })

  y += 6
  // Guarantee
  doc.roundedRect(MARGIN, y, CONTENT_W, 96, 10).fill(DARK_2)
  doc.font('Helvetica-Bold').fontSize(10).fillColor(ORANGE).text('THE GUARANTEE', MARGIN + 20, y + 14, { characterSpacing: 1.5 })
  doc.font('Helvetica-Bold').fontSize(12).fillColor(WHITE)
    .text('If the Absolute Capture System does not add at least $10,000 in new monthly gross profit to your shop within 90 days of activation, we work for free until it does. AND we cut you a check for $1,000 for the time we wasted.',
          MARGIN + 20, y + 32, { width: CONTENT_W - 40, lineGap: 3 })
  y += 116

  // CTA block
  doc.roundedRect(MARGIN, y, CONTENT_W, 96, 10).fill(OFF_WHITE).stroke(ORANGE)
  doc.font('Helvetica-Bold').fontSize(15).fillColor(DARK_2).text('Next step: 15-minute Revenue Audit.', MARGIN + 20, y + 16, { width: CONTENT_W - 40 })
  doc.font('Helvetica').fontSize(11).fillColor(GRAY_DARK)
    .text('We pull your real sublet invoices and confirm your number. Free. No commitment. 2 onboarding slots open in Puget Sound this month.', MARGIN + 20, y + 38, { width: CONTENT_W - 40, lineGap: 2 })
  doc.font('Helvetica-Bold').fontSize(13).fillColor(ORANGE)
    .text('absoluteadas.com/audit', MARGIN + 20, y + 72)
  doc.font('Helvetica-Bold').fontSize(13).fillColor(ORANGE)
    .text('1-844-FIX-ADAS', MARGIN + 20, y + 72, { width: CONTENT_W - 40, align: 'right' })

  // Footer
  const fy = PAGE_H - 56
  doc.moveTo(MARGIN, fy).lineTo(PAGE_W - MARGIN, fy).strokeColor(GRAY_LIGHT).lineWidth(0.5).stroke()
  doc.font('Helvetica').fontSize(8).fillColor(GRAY_MID)
    .text('Absolute ADAS  ·  Mobile ADAS Calibration  ·  Western Washington  ·  50,000+ calibrations on the floor  ·  State Farm DRP', MARGIN, fy + 16, { width: CONTENT_W, align: 'center' })
}
