// Estimate / invoice PDF (spec §7: customer-facing PDFs are ALWAYS fully
// itemized — parts with source, qty, price; labor with hours and rate —
// regardless of the Books detail level). RCW 46.71 header fields on top,
// authorization records and the 110% notice at the bottom.
import PDFDocument from 'pdfkit'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { fmtCents } from './calc.js'

let LOGO = null
try { LOGO = readFileSync(fileURLToPath(new URL('../assets/logo.png', import.meta.url))) } catch { LOGO = null }
const ORANGE = '#CD4419', DARK = '#1a1a1a', MID = '#555', LIGHT = '#888', LINE = '#e5e5e5', GREEN = '#15803d', RED = '#b91c1c'
const SRC = { oem: 'OEM', aftermarket: 'Aftermarket', recycled: 'Used / recycled', reconditioned: 'Reconditioned', sublet: 'Sublet' }
const STATUS = { approved: ['APPROVED', GREEN], recommended: ['RECOMMENDED · not included', '#1d4ed8'], declined: ['DECLINED · not included', RED], deferred: ['DEFERRED · not included', LIGHT] }
const W = 612, H = 792, M = 40, CW = W - 2 * M

export function buildEstimatePdf({ est, jobs, totals, kind = 'estimate', company = {}, threeC = {}, warranty = null }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: M, info: { Title: `${kind === 'invoice' ? 'Invoice' : 'Estimate'} ${est.number}`, Author: 'Absolute ADAS' } })
    const chunks = []
    doc.on('data', c => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject)
    const co = { name: 'Absolute ADAS', tagline: 'Mobile ADAS Calibration & Diagnostics', address: 'Lake Stevens, WA', phone: '', email: '', web: 'absoluteadas.com', ...company }
    const title = kind === 'invoice' ? 'INVOICE' : 'ESTIMATE'
    const date = String(est.created_at || '').slice(0, 10)

    const ensure = need => { if (doc.y + need > H - 70) { doc.addPage(); header(true) } }
    const header = (cont = false) => {
      doc.rect(0, 0, W, 40).fill(ORANGE)
      if (LOGO) { try { doc.image(LOGO, M, 8, { height: 24 }) } catch { /* text mark below */ } }
      doc.font('Helvetica-Bold').fontSize(13).fillColor('white').text(co.name, M + (LOGO ? 34 : 0), 12)
      doc.font('Helvetica-Bold').fontSize(13).fillColor('white').text(`${title} ${est.number}${cont ? ' (continued)' : ''}`, M, 12, { width: CW, align: 'right' })
      doc.font('Helvetica').fontSize(7.5).fillColor(MID).text([co.tagline, co.address, co.phone, co.email, co.web].filter(Boolean).join('   ·   '), M, 46, { width: CW })
      doc.moveTo(M, 60).lineTo(W - M, 60).strokeColor(LINE).lineWidth(.5).stroke()
      doc.y = 68
    }
    const label = (t, x, y, w) => doc.font('Helvetica-Bold').fontSize(6.5).fillColor(LIGHT).text(t.toUpperCase(), x, y, { width: w, characterSpacing: .5 })
    const val = (t, x, y, w, size = 9, color = DARK, bold = false) => doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size).fillColor(color).text(t || '—', x, y, { width: w })

    header()
    // ── Who / what (RCW 46.71.025 fields) ───────────────────────────────
    const c = est.customer_contact || {}
    const colW = (CW - 16) / 3
    let y = doc.y
    label('Customer', M, y, colW); val(est.customer_name, M, y + 9, colW, 10, DARK, true)
    val([c.name, c.phone, c.email].filter(Boolean).join(' · '), M, y + 22, colW, 8, MID); val([c.address, [c.city, c.zip].filter(Boolean).join(' ')].filter(Boolean).join(', '), M, y + 32, colW, 8, MID)
    const x2 = M + colW + 8
    label('Vehicle', x2, y, colW); val([est.year, est.make, est.model, est.trim].filter(Boolean).join(' '), x2, y + 9, colW, 10, DARK, true)
    val(`VIN ${est.vin || '—'}`, x2, y + 22, colW, 8, MID); val(`Plate ${est.plate || '—'}   ·   Odometer ${est.mileage || '—'}`, x2, y + 32, colW, 8, MID)
    const x3 = M + 2 * (colW + 8)
    label(kind === 'invoice' ? 'Invoice' : 'Estimate', x3, y, colW); val(`${est.number}   ·   ${date}`, x3, y + 9, colW, 10, DARK, true)
    val([est.ro_number && `RO ${est.ro_number}`, est.claim_number && `Claim ${est.claim_number}`, est.insurer && `Insurer ${est.insurer}`].filter(Boolean).join(' · ') || (est.customer_type === 'retail' ? 'Customer pay' : ''), x3, y + 22, colW, 8, MID)
    val([est.service_address, [est.service_city, est.service_zip].filter(Boolean).join(' ')].filter(Boolean).join(', ') ? `Work performed at ${[est.service_address, [est.service_city, est.service_zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')}` : '', x3, y + 32, colW, 8, MID)
    doc.y = y + 46
    if (est.concern) { ensure(30); label('Reported problem / requested repairs', M, doc.y, CW); doc.font('Helvetica').fontSize(9).fillColor(DARK).text(est.concern, M, doc.y + 9, { width: CW }); doc.y += 6 }
    doc.moveTo(M, doc.y + 4).lineTo(W - M, doc.y + 4).strokeColor(LINE).stroke(); doc.y += 12

    // ── Jobs ─────────────────────────────────────────────────────────────
    const colAmt = W - M - 70
    for (const job of jobs) {
      ensure(60)
      const [stLabel, stColor] = STATUS[job.status] || STATUS.recommended
      const included = job.status === 'approved'
      doc.rect(M, doc.y, CW, 18).fill(included ? '#f0fdf4' : '#f5f3f0')
      doc.font('Helvetica-Bold').fontSize(10).fillColor(DARK).text(job.name || 'Job', M + 6, doc.y + 4, { width: CW - 200 })
      doc.font('Helvetica-Bold').fontSize(7).fillColor(stColor).text(stLabel, M + CW - 260, doc.y - 8, { width: 180, align: 'right' })
      doc.font('Helvetica-Bold').fontSize(10).fillColor(included ? DARK : LIGHT).text(fmtCents(job.total_cents), colAmt, doc.y - 10, { width: 70, align: 'right' })
      doc.y += 12
      if (job.invoice_description && job.invoice_description !== job.name) { doc.font('Helvetica-Oblique').fontSize(8).fillColor(MID).text(job.invoice_description, M + 6, doc.y, { width: CW - 12 }); doc.y += 2 }
      for (const l of job.lines || []) {
        ensure(24)
        const ly = doc.y
        doc.font('Helvetica').fontSize(8.5).fillColor(DARK).text(l.desc || 'Labor', M + 12, ly, { width: CW - 200 })
        const laborTxt = l.flat_cents != null ? 'flat' : `${Number(l.hours || 0).toFixed(1)} hr × ${fmtCents(l.rate_override_cents ?? (l.labor_cents && l.hours ? Math.round(l.labor_cents / l.hours) : 0))}/hr`
        doc.font('Helvetica').fontSize(7.5).fillColor(LIGHT).text(laborTxt, M + CW - 250, ly + 1, { width: 170, align: 'right' })
        doc.font('Helvetica').fontSize(8.5).fillColor(included ? DARK : LIGHT).text(fmtCents(l.labor_cents), colAmt, ly, { width: 70, align: 'right' })
        doc.y = Math.max(doc.y, ly + 12)
        for (const p of l.parts || []) {
          ensure(14)
          const py = doc.y
          doc.font('Helvetica').fontSize(8).fillColor(MID).text(`${p.pn ? p.pn + '  ' : ''}${p.desc || 'Part'}  ·  ${SRC[p.source] || p.source || 'OEM'}`, M + 24, py, { width: CW - 220 })
          doc.font('Helvetica').fontSize(7.5).fillColor(LIGHT).text(`${p.qty || 1} × ${fmtCents(p.price_each_cents ?? p.price_cents ?? 0)}`, M + CW - 250, py + 1, { width: 170, align: 'right' })
          doc.font('Helvetica').fontSize(8).fillColor(included ? DARK : LIGHT).text(fmtCents(p.total_cents), colAmt, py, { width: 70, align: 'right' })
          doc.y = Math.max(doc.y, py + 11)
        }
      }
      if (job.status === 'declined' && job.decline_reason) { doc.font('Helvetica-Oblique').fontSize(7.5).fillColor(RED).text(`Declined: ${job.decline_reason}`, M + 12, doc.y, { width: CW - 24 }); doc.y += 2 }
      const tc = threeC[job.id]
      if (included && tc && (tc.concern || tc.cause || tc.correction || tc.verification)) {
        ensure(50)
        for (const [k, lbl] of [['concern', 'Concern'], ['cause', 'Cause'], ['correction', 'Correction'], ['verification', 'Verification']]) {
          if (!tc[k]) continue
          ensure(20)
          doc.font('Helvetica-Bold').fontSize(7.5).fillColor(ORANGE).text(lbl.toUpperCase(), M + 12, doc.y, { width: 70, continued: false })
          doc.font('Helvetica').fontSize(8).fillColor(DARK).text(tc[k], M + 80, doc.y - 9, { width: CW - 92 })
          doc.y += 3
        }
      }
      doc.y += 6
    }

    // ── Totals ───────────────────────────────────────────────────────────
    ensure(130)
    const tx = W - M - 230, tw = 230
    const row = (l, v, bold = false, color = DARK) => { doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 10 : 8.5).fillColor(color).text(l, tx, doc.y, { width: tw - 80 }); doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 10 : 8.5).fillColor(color).text(v, tx + tw - 80, doc.y - (bold ? 12 : 10), { width: 80, align: 'right' }); doc.y += 3 }
    doc.moveTo(tx, doc.y).lineTo(W - M, doc.y).strokeColor(LINE).stroke(); doc.y += 5
    row('Labor (approved)', fmtCents(totals.labor_subtotal)); row('Parts (approved)', fmtCents(totals.parts_subtotal)); row('Subtotal', fmtCents(totals.subtotal))
    if (totals.discount > 0) row(`Discount${est.discount_type === 'pct' ? ` (${(est.discount_value / 100).toFixed(1)}%)` : ''}`, `− ${fmtCents(totals.discount)}`)
    if (est.supplies_enabled) row('Shop supplies', fmtCents(totals.supplies))
    if (est.tax_enabled) row(`Sales tax (${(totals.tax_rate_bp / 100).toFixed(2)}%)`, fmtCents(totals.tax))
    doc.moveTo(tx, doc.y + 1).lineTo(W - M, doc.y + 1).strokeColor(DARK).lineWidth(1).stroke(); doc.y += 5
    row(kind === 'invoice' ? 'TOTAL DUE' : 'ESTIMATE TOTAL', fmtCents(totals.grand_total), true, GREEN)
    const extras = [totals.recommended_total > 0 && `Recommended, not approved: ${fmtCents(totals.recommended_total)}`, totals.deferred_total > 0 && `Deferred: ${fmtCents(totals.deferred_total)}`, totals.declined_total > 0 && `Declined: ${fmtCents(totals.declined_total)}`].filter(Boolean)
    if (extras.length) { doc.font('Helvetica').fontSize(7.5).fillColor(LIGHT).text(extras.join('   ·   '), tx, doc.y + 2, { width: tw, align: 'right' }); doc.y += 4 }
    doc.y += 8

    // ── Authorizations ───────────────────────────────────────────────────
    const auths = jobs.filter(j => j.status === 'approved' && j.authorized_by_name)
    if (auths.length) {
      ensure(20 + auths.length * 11)
      label('Authorization on file', M, doc.y, CW); doc.y += 9
      for (const j of auths) { doc.font('Helvetica').fontSize(7.5).fillColor(MID).text(`${j.name}: ${fmtCents(j.authorized_amount_cents)} authorized ${String(j.authorized_at || '').slice(0, 16).replace('T', ' ')} by ${j.authorized_by_name} (${j.authorized_method}), taken by ${j.authorized_by_employee}`, M, doc.y, { width: CW }); doc.y += 1 }
      doc.y += 6
    }
    if (est.notes) { ensure(30); label('Notes', M, doc.y, CW); doc.font('Helvetica').fontSize(8).fillColor(DARK).text(est.notes, M, doc.y + 9, { width: CW }); doc.y += 6 }
    if (est.terms) { ensure(30); label('Terms', M, doc.y, CW); doc.font('Helvetica').fontSize(8).fillColor(DARK).text(est.terms, M, doc.y + 9, { width: CW }); doc.y += 6 }
    if (warranty && (warranty.months || warranty.miles) && jobs.some(j => j.status === 'approved')) { ensure(24); doc.font('Helvetica-Bold').fontSize(8).fillColor(GREEN).text(`🛡 Guaranteed for ${[warranty.months && `${warranty.months} months`, warranty.miles && `${warranty.miles.toLocaleString('en-US')} miles`].filter(Boolean).join(' or ')} from the service date and the odometer shown above (${est.mileage || 'odometer not recorded'}).`.replace('🛡 ', ''), M, doc.y + 4, { width: CW }); doc.y += 4 }
    ensure(30)
    doc.font('Helvetica').fontSize(7).fillColor(LIGHT).text(kind === 'invoice'
      ? 'Parts are listed with source (OEM, aftermarket, used, reconditioned, sublet), price per part, total parts, total labor, and total charge, per RCW 46.71.'
      : `Written estimate${est.valid_until ? `, valid through ${est.valid_until}` : ''}. Charges will not exceed 110% of the authorized amount, exclusive of sales tax, without additional authorization (RCW 46.71). Only approved items are included in the total.`, M, doc.y + 6, { width: CW })
    doc.end()
  })
}
