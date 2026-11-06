import PDFDocument from 'pdfkit'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'

// Absolute ADAS logo — loaded once at startup. Falls back to a text mark if missing.
let LOGO_BUF = null
try {
  LOGO_BUF = readFileSync(fileURLToPath(new URL('./assets/logo.png', import.meta.url)))
} catch (e) {
  console.warn('[pdf] logo asset not found — using text fallback:', e.message)
}

// ── Brand palette ─────────────────────────────────────────────────────────────
const ORANGE        = '#CD4419'
const ORANGE_LIGHT  = '#fdf3ef'
const ORANGE_BORDER = '#e8c5b0'
const DARK          = '#1a1a1a'
const GRAY_DARK     = '#444444'
const GRAY_MID      = '#6b6b6b'
const GRAY_LIGHT    = '#f4f2f0'
const GRAY_BORDER   = '#e0dbd6'
const WHITE         = '#ffffff'

const PAGE_W    = 612
const PAGE_H    = 792
const MARGIN    = 48
const CONTENT_W = PAGE_W - MARGIN * 2

// 🏷 Brand on the report. Absolute ADAS by default; ADAS IQ asks for its own
// (routes/iqEngine.js /report-pdf) so its shops get this exact report under the
// ADAS IQ name, without Absolute's Full Service rules or online-report link.
const ABSOLUTE_BRAND = { name: 'Absolute ADAS', mark: 'AA', logo: true, title: 'ADAS Calibration & Diagnostic Report', footer1: 'Absolute ADAS   |   Mobile ADAS Calibration & Diagnostics   |   Lake Stevens, WA', footer2: 'Based on OEM position statements and ALLDATA ADAS procedures.  ·  absoluteadas.com' }
export const ADAS_IQ_BRAND = { name: 'ADAS IQ', mark: 'IQ', logo: false, title: 'Calibration Identification Report', footer1: 'ADAS IQ   |   Calibration identification from the repair estimate', footer2: 'Based on OEM position statements and ALLDATA ADAS procedures.  ·  adas-iq.com' }
let BRAND = ABSOLUTE_BRAND

function footer(doc) {
  const fy = PAGE_H - 42
  doc.moveTo(MARGIN, fy).lineTo(PAGE_W - MARGIN, fy)
    .strokeColor(GRAY_BORDER).lineWidth(0.5).stroke()
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor(GRAY_DARK)
    .text(
      BRAND.footer1,
      MARGIN, fy + 8, { width: CONTENT_W, align: 'center' }
    )
  doc.font('Helvetica').fontSize(6.5).fillColor(GRAY_MID)
    .text(
      BRAND.footer2,
      MARGIN, fy + 19, { width: CONTENT_W, align: 'center' }
    )
}

function contHeader(doc) {
  doc.rect(0, 0, PAGE_W, 36).fill(ORANGE)
  doc.roundedRect(MARGIN, 8, 22, 22, 4).fill(WHITE)
  if (LOGO_BUF && BRAND.logo) {
    doc.image(LOGO_BUF, MARGIN + 3, 11, { fit: [16, 16] })
  } else {
    doc.font('Helvetica-Bold').fontSize(8).fillColor(ORANGE).text(BRAND.mark, MARGIN, 14, { width: 22, align: 'center' })
  }
  doc.font('Helvetica-Bold').fontSize(9).fillColor(WHITE).text(BRAND.name, MARGIN + 30, 13)
  doc.font('Helvetica').fontSize(7.5).fillColor('rgba(255,255,255,0.75)')
    .text('ADAS Calibration & Diagnostic Report — continued', MARGIN + 105, 14)
}

function pill(doc, x, y, text, bgColor, textColor) {
  const tw = doc.widthOfString(text, { fontSize: 7 }) + 14
  doc.roundedRect(x, y, tw, 15, 7.5).fill(bgColor)
  doc.font('Helvetica-Bold').fontSize(7).fillColor(textColor).text(text, x, y + 4.5, { width: tw, align: 'center' })
  return tw
}

function chip(doc, x, y, text, bgColor, textColor) {
  const tw = doc.widthOfString(text, { fontSize: 7 }) + 10
  doc.roundedRect(x, y, tw, 13, 3).fill(bgColor)
  doc.font('Helvetica').fontSize(7).fillColor(textColor).text(text, x + 5, y + 3.5)
  return tw
}

/**
 * Generate an ADAS IQ PDF report buffer.
 * @param {Object} jobData - { shop, ro_number, insurer, vin, vehicle, year, make, model, claim, calibrations, document_links }
 * @returns {Promise<Buffer>}
 */
// 🔗 ALLDATA on every report (Mark 2026-09-30): the car's saved ALLDATA ADAS
// Quick Reference page when we have one (Scrub Library → ALLDATA box), else
// ALLDATA's front door with the VIN printed beside it. Every caller gets it —
// the lookup happens here, using the request the server is handling.
const ALLDATA_HOME = 'https://my.alldata.com/'
// Mark 2026-09-30: paused, then back on ("back to alldata"). false = no block on reports.
const ALLDATA_ON_REPORTS = true
function batteryOperationsNote(cals) {
  for (const c of cals || []) {
    if (!/battery.?disconnect reset/i.test(`${c?.calibration_name || ''} ${c?.name || ''}`)) continue
    const m = String(c.justification || '').match(/12V battery disconnect[\s\S]*?Position Statement Power Window Servicing Post-Repair\./)
    if (m) return m[0]
  }
  return ''
}

export async function generateADASIQPdf(jobData = {}) {
  if (jobData._brand) return generateBrandedPdf(jobData)
  const batteryNote = batteryOperationsNote(jobData.calibrations)
  if (!ALLDATA_ON_REPORTS && !jobData.alldata_url) return buildPdf({ ...jobData, _alldata: null, _batteryNote: batteryNote })
  let alldata = jobData.alldata_url ? { url: jobData.alldata_url, exact: true } : null
  if (!alldata) {
    try {
      const req = globalThis.__catalystReq
      if (req && jobData.year && jobData.make) {
        const { alldataLinksFor } = await import('./scrubStore.js')
        const r = await alldataLinksFor(req, { year: jobData.year, make: jobData.make, model: jobData.model })
        if (r?.links?.[0]?.url) alldata = { url: r.links[0].url, exact: r.match === 'exact' || r.match === 'model' }
      }
    } catch { /* the generic link below is fine */ }
  }
  // 🧰 Full Service rows follow the shop's CRM rule (We do it / Shop does it / Ask).
  let cals = jobData.calibrations
  try {
    const req = globalThis.__catalystReq
    const fs = await import('./fullService.js')
    let r = req && jobData.shop ? await fs.readFullService(req, jobData.shop) : null
    // Per-report override lives on the scrub (Mark 2026-10-07) — explicit, or looked up by scrub / job.
    let ov = jobData._fsOverride
    if (r && ov === undefined && req) {
      try {
        const S = await import('./scrubStore.js')
        let sid = jobData._scrubId || ''
        if (!sid && jobData._jobId) sid = (await S.scrubsForJob(req, jobData._jobId))?.[0]?.id || ''
        if (sid) ov = (await S.getScrub(req, sid))?.payload?.fs_override || ''
      } catch { ov = '' }
    }
    if (r && ov) r = fs.applyFsOverride(r, ov)
    cals = fs.tagRows((cals || []).map(c => ({ ...c })), r?.rules, { collision: r ? r.collision : true })
  } catch { /* untagged rows print as plain calibrations */ }
  // 📎 The OEM documents the justifications cite → numbered attachments (Mark 2026-10-02).
  let cited = []
  try {
    const req = globalThis.__catalystReq
    if (req) { const A = await import('./oemAttach.js'); cited = await A.fetchCited(req, await A.citedDocs(req, cals, jobData.make || ''), cals) }
  } catch (e) { console.warn('[pdf] cited docs:', e.message); cited = [] }
  // 🌐 Link + QR to the online report with the "Why?" popups (Mark 2026-10-02).
  let reportLink = '', reportQr = null
  try {
    const req = globalThis.__catalystReq
    let sid = jobData._scrubId || ''
    if (!sid && jobData._jobId && req) { const { scrubsForJob } = await import('./scrubStore.js'); sid = (await scrubsForJob(req, jobData._jobId))?.[0]?.id || '' }
    if (sid && req) {
      reportLink = await (await import('./publicReport.js')).reportUrl(req, sid)
      reportQr = await (await import('qrcode')).default.toBuffer(reportLink, { width: 256, margin: 1, color: { dark: '#9a3412', light: '#ffffff' } })
    }
  } catch (e) { console.warn('[pdf] report link:', e.message) }
  const report = await buildPdf({ ...jobData, calibrations: cals, _cited: cited, _reportLink: reportLink, _reportQr: reportQr, _batteryNote: batteryNote, _alldata: alldata || { url: ALLDATA_HOME, exact: false } })
  if (!cited.length) return report
  try { return await (await import('./oemAttach.js')).appendCitedDocs(globalThis.__catalystReq, report, cited) } catch { return report }
}

/** ADAS IQ's copy of this report: same builder, its brand, no Absolute-only parts. */
async function generateBrandedPdf(jobData) {
  const batteryNote = batteryOperationsNote(jobData.calibrations)
  let cited = []
  try { const req = globalThis.__catalystReq; if (req) { const A = await import('./oemAttach.js'); cited = await A.fetchCited(req, await A.citedDocs(req, jobData.calibrations, jobData.make || ''), jobData.calibrations) } } catch (e) { console.warn('[pdf] cited docs:', e.message); cited = [] }
  const report = await buildPdf({ ...jobData, _cited: cited, _batteryNote: batteryNote, _alldata: ALLDATA_ON_REPORTS ? { url: ALLDATA_HOME, exact: false } : null })
  if (!cited.length) return report
  try { return await (await import('./oemAttach.js')).appendCitedDocs(globalThis.__catalystReq, report, cited) } catch { return report }
}

function buildPdf(jobData) {
  BRAND = jobData._brand || ABSOLUTE_BRAND   // drawing below is synchronous, so this can't leak into another report
  return new Promise((resolve, reject) => {
    const { shop, ro_number, insurer, vin, vehicle, year, make, model, claim, calibrations, document_links,
      technician, folder_share_url, qr_png, _alldata, _cited = [], vin_equipment, _reportLink = '', _reportQr = null, _batteryNote = '' } = jobData
    const performedBy = technician || BRAND.name

    const held = c => /^(CONDITIONAL:|REVIEW NEEDED)/.test(c?.classification || '') || c?._reportRequired === true
    const required = (calibrations || []).filter(c => c.enabled && !c._fs && !held(c))
    const reviewRows = (calibrations || []).filter(c => held(c) && (!c._fs || c._reportRequired || c._onReport))
    const fullSvc  = (calibrations || []).filter(c => c.enabled && c._fs && !held(c))   // 🧰 Full Service (headlamp aim, TPMS, programming, resets)
    const notReq   = (calibrations || []).filter(c => !c.enabled && !c._fs && !held(c))

    const doc = new PDFDocument({ margin: 0, size: 'LETTER', autoFirstPage: true })
    const chunks = []
    doc.on('data', chunk => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    // ── PAGE 1 HEADER ─────────────────────────────────────────────────────
    doc.rect(0, 0, PAGE_W, 100).fill(ORANGE)
    doc.roundedRect(MARGIN, 22, 56, 56, 10).fill(WHITE)
    if (LOGO_BUF && BRAND.logo) {
      doc.image(LOGO_BUF, MARGIN + 8, 30, { fit: [40, 40] })
    } else {
      doc.font('Helvetica-Bold').fontSize(20).fillColor(ORANGE).text(BRAND.mark, MARGIN, 40, { width: 56, align: 'center' })
    }
    doc.font('Helvetica-Bold').fontSize(24).fillColor(WHITE).text(BRAND.name, MARGIN + 70, 28)
    doc.font('Helvetica').fontSize(11).fillColor('rgba(255,255,255,0.82)').text(BRAND.title, MARGIN + 70, 56)

    const dateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    doc.font('Helvetica').fontSize(8).fillColor('rgba(255,255,255,0.65)')
      .text(dateStr, 0, 30, { width: PAGE_W - MARGIN, align: 'right' })
    if (ro_number) {
      doc.font('Helvetica-Bold').fontSize(8).fillColor('rgba(255,255,255,0.9)')
        .text(`RO# ${ro_number}`, 0, 46, { width: PAGE_W - MARGIN, align: 'right' })
    }
    doc.font('Helvetica').fontSize(8).fillColor('rgba(255,255,255,0.82)')
      .text(`Performed by: ${performedBy}`, 0, ro_number ? 62 : 46, { width: PAGE_W - MARGIN, align: 'right' })

    let y = 118

    // ── VEHICLE INFO CARD ──────────────────────────────────────────────────
    const vehicleStr = [year, make, model].filter(Boolean).join(' ') || vehicle || '—'
    doc.roundedRect(MARGIN, y, CONTENT_W, 120, 8).fill(GRAY_LIGHT)
    doc.roundedRect(MARGIN, y, CONTENT_W, 120, 8).stroke(GRAY_BORDER).lineWidth(0.5)
    doc.roundedRect(MARGIN, y, 4, 120, 2).fill(ORANGE)
    doc.font('Helvetica-Bold').fontSize(15).fillColor(DARK).text(vehicleStr, MARGIN + 16, y + 14, { width: CONTENT_W - (_reportQr ? 120 : 32) })
    if (_reportQr) {   // 🌐 online report with the "Why?" explanations
      doc.image(_reportQr, MARGIN + CONTENT_W - 66, y + 8, { fit: [54, 54], link: _reportLink })
      doc.font('Helvetica-Bold').fontSize(6.5).fillColor(ORANGE).text('Online report', MARGIN + CONTENT_W - 140, y + 16, { width: 70, align: 'right', link: _reportLink, lineBreak: false })
      doc.font('Helvetica').fontSize(6).fillColor(GRAY_MID).text('Tap any calibration', MARGIN + CONTENT_W - 140, y + 26, { width: 70, align: 'right', lineBreak: false })
      doc.text('for the OEM "why"', MARGIN + CONTENT_W - 140, y + 34, { width: 70, align: 'right', lineBreak: false })
    }
    if (vin) {
      doc.font('Helvetica').fontSize(8).fillColor(GRAY_MID).text(`VIN  ${vin}`, MARGIN + 16, y + 36, { continued: !!vin_equipment })
      if (vin_equipment) doc.font('Helvetica').fontSize(7).fillColor('#5b21b6').text(`   ·   ${String(vin_equipment).slice(0, 150)}`, { lineBreak: false })
    }
    const ruleY = y + (vin ? 52 : 44)
    doc.moveTo(MARGIN + 16, ruleY).lineTo(MARGIN + CONTENT_W - 16, ruleY)
      .strokeColor(GRAY_BORDER).lineWidth(0.5).stroke()

    const detailFields = [['SHOP', shop], ['RO NUMBER', ro_number], ['INSURER', insurer], ['CLAIM #', claim]].filter(([, v]) => v)
    const colW = CONTENT_W / 4
    detailFields.forEach(([label, value], i) => {
      const fx = MARGIN + 16 + i * colW
      const fy = ruleY + 10
      doc.font('Helvetica').fontSize(7).fillColor(GRAY_MID).text(label, fx, fy)
      doc.font('Helvetica-Bold').fontSize(9).fillColor(DARK).text(value || '—', fx, fy + 11, { width: colW - 8 })
    })
    y += 132

    // ── SUMMARY STAT BOXES ─────────────────────────────────────────────────
    const statW = (CONTENT_W - 12) / 2
    doc.roundedRect(MARGIN, y, statW, 58, 8).fill(ORANGE_LIGHT)
    doc.roundedRect(MARGIN, y, statW, 58, 8).stroke(ORANGE_BORDER).lineWidth(0.5)
    doc.font('Helvetica-Bold').fontSize(34).fillColor(ORANGE).text(String(required.length), MARGIN + 18, y + 10)
    doc.font('Helvetica-Bold').fontSize(9).fillColor(GRAY_DARK).text('Calibrations', MARGIN + 18 + 36, y + 16)
    doc.font('Helvetica').fontSize(8).fillColor(GRAY_MID).text('Required', MARGIN + 18 + 36, y + 29)

    const sx2 = MARGIN + statW + 12
    doc.roundedRect(sx2, y, statW, 58, 8).fill(GRAY_LIGHT)
    doc.roundedRect(sx2, y, statW, 58, 8).stroke(GRAY_BORDER).lineWidth(0.5)
    doc.font('Helvetica-Bold').fontSize(34).fillColor(GRAY_MID).text(String(notReq.length), sx2 + 18, y + 10)
    doc.font('Helvetica-Bold').fontSize(9).fillColor(GRAY_DARK).text('Calibrations', sx2 + 18 + 36, y + 16)
    doc.font('Helvetica').fontSize(8).fillColor(GRAY_MID).text('Not Required', sx2 + 18 + 36, y + 29)
    y += 74

    const alignName = c => /^(wheel alignment|4-way alignment|four-wheel alignment)$/i.test(String(c?.calibration_name || '').trim()) || /^(wheel alignment|4-way alignment|four-wheel alignment)$/i.test(String(c?.operation_title || '').trim())
    const wheelOnReport = (calibrations || []).some(c => alignName(c) && c.classification === 'REQUIRED: OEM PREREQUISITE')
    const batteryOnReport = (calibrations || []).some(c => c.classification === 'REVIEW NEEDED' || (/battery.?disconnect reset/i.test(c.calibration_name || '') && /Operations Required after Disconnecting Battery/i.test(`${c.operation_title || ''} ${c.justification || ''}`)))
    const radarFirst = !wheelOnReport && required.some(c => /front radar|acc radar|distance sensor/i.test(c.calibration_name || '') && !/side|corner|park/i.test(c.calibration_name || '') && /4-wheel vehicle alignment must be performed/i.test(c.justification || ''))
    if (radarFirst) {
      const note = 'Prerequisite: wheel alignment required. A 4-wheel vehicle alignment must be performed before proceeding with radar alignment procedure.'
      const noteH = doc.font('Helvetica').fontSize(8).heightOfString(note, { width: CONTENT_W - 28 }) + 16
      doc.roundedRect(MARGIN, y, CONTENT_W, noteH, 6).fill('#fff7ed')
      doc.roundedRect(MARGIN, y, CONTENT_W, noteH, 6).stroke(ORANGE).lineWidth(1)
      doc.font('Helvetica').fontSize(8).fillColor(DARK).text(note, MARGIN + 14, y + 8, { width: CONTENT_W - 28 })
      y += noteH + 12
    }

    if (_batteryNote && !batteryOnReport) {
      const title = 'Battery Operations'
      const body = _batteryNote
      const noteH = doc.font('Helvetica-Bold').fontSize(8).heightOfString(title, { width: CONTENT_W - 28 })
        + doc.font('Helvetica').fontSize(8).heightOfString(body, { width: CONTENT_W - 28 }) + 20
      if (y + noteH > PAGE_H - 48) { footer(doc); doc.addPage(); contHeader(doc); y = 52 }
      doc.roundedRect(MARGIN, y, CONTENT_W, noteH, 6).fill('#fff7ed')
      doc.roundedRect(MARGIN, y, CONTENT_W, noteH, 6).stroke(ORANGE).lineWidth(1)
      doc.font('Helvetica-Bold').fontSize(8).fillColor(DARK).text(title, MARGIN + 14, y + 8, { width: CONTENT_W - 28 })
      doc.font('Helvetica').fontSize(8).fillColor(DARK).text(body, MARGIN + 14, y + 20, { width: CONTENT_W - 28 })
      y += noteH + 12
    }

    // ── OPERATIONS SUMMARY (Mark 2026-10-02: "the Kinetic report has all of the
    // calibrations all up top"): every sensor in one table — required first — before
    // the detailed Q&A cards. ───────────────────────────────────────────────────
    {
      const classed = (calibrations || []).some(c => c.classification)
      const rank = {
        'REQUIRED: DIRECT TRIGGER': 1,
        'REQUIRED: OEM PREREQUISITE': 2,
        'REQUIRED: SECONDARY OPERATION': 3,
        'CONDITIONAL: VERIFICATION NEEDED': 4,
        'REVIEW NEEDED': 5,
        'NOT REQUIRED: VERIFIED': 6,
      }
      const labelOf = c => c.classification || (c.enabled ? 'REQUIRED: DIRECT TRIGGER' : '')
      const summary = classed
        ? [...required, ...reviewRows, ...notReq.filter(c => c.classification)].sort((a, b) => (rank[labelOf(a)] || 9) - (rank[labelOf(b)] || 9))
        : [...required, ...fullSvc, ...notReq]
      const COL = classed
        ? { name: MARGIN + 8, trig: MARGIN + 128, lines: MARGIN + 292, type: MARGIN + 442 }
        : { name: MARGIN + 18, trig: MARGIN + 140, lines: MARGIN + 312, type: MARGIN + 416 }
      const W = classed
        ? { name: 116, trig: 158, lines: 146, type: 78 }
        : { name: 118, trig: 168, lines: 100, type: 92 }
      doc.font('Helvetica').fontSize(8).fillColor(GRAY_MID).text(`Prepared by ${performedBy}  ·  Status: Requirements identified`, MARGIN, y)
      y += 14
      doc.font('Helvetica-Bold').fontSize(10).fillColor(DARK).text('Operations', MARGIN, y)
      if (!classed) {
        const lx = MARGIN + CONTENT_W - 118
        doc.circle(lx, y + 5.5, 3).fill(ORANGE); doc.font('Helvetica').fontSize(7).fillColor(GRAY_MID).text('Required', lx + 6, y + 2, { lineBreak: false })
        doc.circle(lx + 52, y + 5.5, 3).lineWidth(1).fillAndStroke(WHITE, '#bdb7b1'); doc.fillColor(GRAY_MID).text('Not required', lx + 58, y + 2, { lineBreak: false })
      }
      y += 16
      doc.rect(MARGIN, y, CONTENT_W, 16).fill(ORANGE)
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor(WHITE)
      doc.text(classed ? 'Operation' : 'Sensor', COL.name, y + 5, { width: W.name })
      doc.text(classed ? 'Repair Trigger' : 'Repair triggers', COL.trig, y + 5, { width: W.trig })
      doc.text(classed ? 'Classification' : 'Lines', COL.lines, y + 5, { width: W.lines })
      doc.text(classed ? 'Procedure' : 'Type', COL.type, y + 5, { width: W.type, lineBreak: false })
      y += 16
      summary.forEach((c, i) => {
        const req = !!c.enabled && !/^(CONDITIONAL:|REVIEW NEEDED|NOT REQUIRED)/.test(c.classification || '')
        const faded = !c.enabled && !held(c)
        const name = String(c.operation_title || c.calibration_name || '').replace(/\s*calibration$/i, '')
        const trig = String(c.trigger || '—').replace(/\s+/g, ' ')
        const mid = classed ? (c.classification || (req ? 'REQUIRED: DIRECT TRIGGER' : '—')) : (req ? String(c.line_references || '—') : '—')
        const proc = classed ? String(c.procedure || c.cal_type || '—') : (req ? (c._fs ? 'Full Service' : String(c.cal_type || 'Required')) : 'Not required')
        const rowH = Math.max(16, doc.font('Helvetica').fontSize(6.5).heightOfString(trig, { width: W.trig }) + 8, doc.font('Helvetica-Bold').fontSize(7).heightOfString(name, { width: W.name }) + 8, doc.font('Helvetica').fontSize(6.5).heightOfString(mid, { width: W.lines }) + 8)
        if (y + rowH > PAGE_H - 48) { footer(doc); doc.addPage(); contHeader(doc); y = 52 }
        if (i % 2) doc.rect(MARGIN, y, CONTENT_W, rowH).fill('#faf8f6')
        if (!classed) doc.circle(MARGIN + 9, y + 7.5, 3).lineWidth(1).fillAndStroke(req ? ORANGE : WHITE, req ? ORANGE : '#bdb7b1')
        doc.font('Helvetica-Bold').fontSize(7).fillColor(faded ? '#9a948e' : DARK).text(name, COL.name, y + 4, { width: W.name })
        doc.font('Helvetica').fontSize(6.5).fillColor(faded ? '#b5afa9' : GRAY_DARK).text(trig, COL.trig, y + 4, { width: W.trig })
        doc.font('Helvetica').fontSize(6).fillColor(DARK).text(mid, COL.lines, y + 4, { width: W.lines })
        doc.font('Helvetica').fontSize(6.5).fillColor(GRAY_DARK).text(proc, COL.type, y + 4, { width: W.type })
        y += rowH
      })
      doc.moveTo(MARGIN, y).lineTo(MARGIN + CONTENT_W, y).strokeColor(GRAY_BORDER).lineWidth(0.5).stroke()
      y += 16
    }

    if ((calibrations || []).some(c => c.classification === 'REQUIRED: OEM PREREQUISITE')) {
      footer(doc); doc.addPage(); contHeader(doc); y = 52
      const byName = re => (calibrations || []).find(c => re.test(`${c.operation_title || ''} ${c.calibration_name || ''}`))
      const radar = byName(/front radar/i)
      const wheel = byName(/4-way alignment|wheel alignment|four-wheel alignment/i)
      const sas = byName(/steering angle/i)
      const steps = [
        ['1. Front radar calibration', radar?.classification || 'REQUIRED: DIRECT TRIGGER', radar?.trigger || 'Qualifying front repair', radar?.oem_reference || 'Nissan distance sensor alignment procedure', 'Direct trigger from the qualifying front repair. The front bumper removal is why this radar is required. Aiming stays the final operation.'],
        ['2. 4-Way Alignment', wheel?.classification || 'REQUIRED: OEM PREREQUISITE', 'Required before the ACC / front radar aim', wheel?.oem_reference || 'Nissan distance sensor alignment procedure', wheel?.justification || 'This 4-way alignment is required before that ACC radar aim, because Nissan\'s distance-sensor procedure says a 4-wheel alignment must be performed before the radar alignment. The front bumper removal is why the radar is required, not why this alignment is required.'],
        ['3. Steering angle sensor neutral-position adjustment', sas?.classification || 'CONDITIONAL: VERIFICATION NEEDED', sas?.trigger || '', sas?.oem_reference || 'Nissan steering angle sensor neutral position procedure', sas?.repair_relationship || 'Required only when an alignment adjustment was performed. An inspection is not an adjustment.'],
        ['4. Front radar aiming', 'Final operation', 'After the prerequisites', radar?.oem_reference || 'Nissan distance sensor alignment procedure', 'The aiming procedure is last, after the alignment prerequisite and any steering-angle reset that applies.'],
      ]
      doc.font('Helvetica-Bold').fontSize(13).fillColor(DARK).text('Dependency chain', MARGIN, y)
      y += 18
      doc.font('Helvetica').fontSize(8).fillColor(GRAY_DARK).text('Front radar → 4-Way Alignment → steering angle (only if the alignment was adjusted) → radar aim.', MARGIN, y, { width: CONTENT_W })
      y += 22
      for (const [title, klass, trigger, ref, why] of steps) {
        const body = `${klass}\nRepair trigger: ${trigger}\n${why}\nOEM reference: ${ref}`
        const h = doc.font('Helvetica').fontSize(8).heightOfString(body, { width: CONTENT_W - 28 }) + 28
        if (y + h > PAGE_H - 48) { footer(doc); doc.addPage(); contHeader(doc); y = 52 }
        doc.roundedRect(MARGIN, y, CONTENT_W, h, 6).fill('#fff7ed')
        doc.roundedRect(MARGIN, y, CONTENT_W, h, 6).stroke(ORANGE).lineWidth(0.75)
        doc.font('Helvetica-Bold').fontSize(9).fillColor(DARK).text(title, MARGIN + 12, y + 8, { width: CONTENT_W - 24 })
        doc.font('Helvetica').fontSize(8).fillColor(GRAY_DARK).text(body, MARGIN + 12, y + 22, { width: CONTENT_W - 24 })
        y += h + 8
      }
      footer(doc); doc.addPage(); contHeader(doc); y = 52
    }

    // ── CALIBRATION CARD RENDERER ──────────────────────────────────────────
    function drawCal(cal, isRequired, opt = {}) {
      const accentColor = isRequired ? ORANGE      : '#c8c4c0'
      const bgColor     = isRequired ? ORANGE_LIGHT : GRAY_LIGHT
      const borderColor = isRequired ? ORANGE_BORDER: GRAY_BORDER
      const nameColor   = isRequired ? DARK         : '#999'
      const textColor   = isRequired ? GRAY_DARK    : '#aaa'
      const pillBg      = isRequired ? ORANGE       : '#c8c4c0'

      const plainH = cal.plain_description
        ? doc.heightOfString(cal.plain_description || '', { width: CONTENT_W - 40, fontSize: 8.5 }) + 12 : 0
      // 📝 Required rows read like Kinetic's note (Mark 2026-10-02): Q / A / OEM Reference.
      const qa = isRequired && cal.justification
      const qText = qa ? `Q: Why is a ${String(cal.calibration_name || '').replace(/\s*calibration$/i, '')}${cal.cal_type ? ` – ${cal.cal_type}` : ''} calibration required?` : ''
      const refText = qa && Array.isArray(cal._refs) && cal._refs.length ? `OEM Reference: ${cal._refs.map(r => `Attachment ${r.n} — ${r.title}${r.pages.length ? `, see page${r.pages.length > 1 ? 's' : ''} ${r.pages.join(', ')}` : ''}`).join('; ')}` : ''
      const justH = cal.justification
        ? doc.heightOfString((qa ? 'A: ' : '') + (cal.justification || ''), { width: CONTENT_W - 40, fontSize: 8 }) + 12
          + (qa ? doc.heightOfString(qText, { width: CONTENT_W - 40, fontSize: 8.5 }) + 4 : 0)
          + (refText ? doc.heightOfString(refText, { width: CONTENT_W - 40, fontSize: 7.5 }) + 6 : 0) : 0
      const calLinks = Array.isArray(cal.links) ? cal.links.filter(l => l?.url) : []
      // 14px per link row, wrapped 2 per line — approximate
      const linksH   = calLinks.length > 0 ? Math.ceil(calLinks.length / 2) * 14 + 12 : 0
      const hasChips = cal.cal_type || cal.trigger || cal.line_references
      const rowH = 46 + (hasChips ? 22 : 4) + plainH + justH + linksH

      if (y + rowH > PAGE_H - 48) { footer(doc); doc.addPage(); contHeader(doc); y = 52 }

      doc.roundedRect(MARGIN, y, CONTENT_W, rowH, 6).fill(bgColor)
      doc.roundedRect(MARGIN, y, CONTENT_W, rowH, 6).stroke(borderColor).lineWidth(0.5)
      doc.roundedRect(MARGIN, y, 4, rowH, 2).fill(accentColor)

      const pillText = opt.pill || (isRequired ? 'REQUIRED' : 'NOT REQUIRED')
      const pillW = doc.widthOfString(pillText, { fontSize: 7 }) + 16
      pill(doc, MARGIN + CONTENT_W - pillW - 10, y + 10, pillText, opt.pillBg || pillBg, WHITE)

      doc.font('Helvetica-Bold').fontSize(10.5).fillColor(nameColor)
        .text(cal.calibration_name || '—', MARGIN + 14, y + 12, { width: CONTENT_W - pillW - 32 })

      let chipX = MARGIN + 14
      const chipY = y + 32
      if (cal.cal_type)        chipX += chip(doc, chipX, chipY, cal.cal_type,        isRequired ? '#fde8de' : '#e8e5e2', isRequired ? ORANGE : '#999') + 5
      if (cal.trigger)         chipX += chip(doc, chipX, chipY, cal.trigger,         isRequired ? '#fff0eb' : '#e8e5e2', isRequired ? '#a33510' : '#999') + 5
      if (cal.line_references) chipX += chip(doc, chipX, chipY, `Lines ${cal.line_references}`, '#e8e5e2', '#777') + 5
      if (opt.who) chipX += chip(doc, chipX, chipY, opt.who, opt.whoBg || '#e0f2fe', opt.whoFg || '#0369a1') + 5
      if (isRequired && Array.isArray(cal._attach) && cal._attach.length) chip(doc, chipX, chipY, `OEM doc: Attachment ${cal._attach.join(', ')}`, '#ede9fe', '#5b21b6')

      // Plain-language description ("third grader" style) — upright,
      // slightly larger, easy for an insurance adjuster to skim.
      let cursorY = y + (hasChips ? 54 : 36)
      if (cal.plain_description) {
        doc.font('Helvetica').fontSize(8.5).fillColor(GRAY_DARK)
          .text(cal.plain_description, MARGIN + 14, cursorY, { width: CONTENT_W - 30 })
        cursorY += doc.heightOfString(cal.plain_description, { width: CONTENT_W - 40, fontSize: 8.5 }) + 8
      }
      if (cal.justification && qa) {
        doc.font('Helvetica-Bold').fontSize(8.5).fillColor(DARK).text(qText, MARGIN + 14, cursorY, { width: CONTENT_W - 30 })
        cursorY += doc.heightOfString(qText, { width: CONTENT_W - 40, fontSize: 8.5 }) + 4
        doc.font('Helvetica').fontSize(8).fillColor(GRAY_DARK).text(`A: ${cal.justification}`, MARGIN + 14, cursorY, { width: CONTENT_W - 30 })
        cursorY += doc.heightOfString(`A: ${cal.justification}`, { width: CONTENT_W - 40, fontSize: 8 }) + 6
        if (refText) {
          doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#5b21b6').text(refText, MARGIN + 14, cursorY, { width: CONTENT_W - 30 })
          cursorY += doc.heightOfString(refText, { width: CONTENT_W - 40, fontSize: 7.5 }) + 6
        }
      } else if (cal.justification) {
        doc.font('Helvetica-Oblique').fontSize(8).fillColor(textColor)
          .text(cal.justification, MARGIN + 14, cursorY, { width: CONTENT_W - 30 })
        cursorY += doc.heightOfString(cal.justification, { width: CONTENT_W - 40, fontSize: 8 }) + 6
      }
      if (calLinks.length > 0) {
        doc.font('Helvetica-Bold').fontSize(7).fillColor(GRAY_MID)
          .text('REFERENCE LINKS', MARGIN + 14, cursorY)
        cursorY += 10
        let lx = MARGIN + 14, ly = cursorY
        calLinks.forEach((link, idx) => {
          const label = link.label || `Reference ${idx + 1}`
          // Measure with the same font that renders, and give the text
          // box slack — an exact-width box wrapped mid-label ("SR5"
          // dangling on its own line, 2026-08-29 report).
          doc.font('Helvetica').fontSize(7.5)
          const lw = doc.widthOfString(label) + 6
          if (lx + lw > MARGIN + CONTENT_W - 20) { lx = MARGIN + 14; ly += 14 }
          doc.fillColor(isRequired ? ORANGE : '#aaa')
            .text(label, lx, ly, { link: link.url, underline: true, continued: false, width: lw, lineBreak: false })
          lx += lw + 14
        })
      }
      y += rowH + 8
    }

    function drawClassified(cal) {
      const name = cal.operation_title || cal.calibration_name || '—'
      const why = String(cal.justification || '').replace(/Failure to calibrate presents a safety liability[^.]*\./gi, '').replace(/\s+/g, ' ').trim()
      const rows = [
        ['Classification', cal.classification || '—'],
        ['Why', why || '—'],
        ['Required before', cal.required_before || '—'],
        ['Repair relationship', cal.repair_relationship || '—'],
        ['OEM reference', cal.oem_reference || '—'],
      ]
      const body = rows.map(([k, v]) => `${k}: ${v}`).join('\n')
      const rowH = doc.font('Helvetica').fontSize(8).heightOfString(body, { width: CONTENT_W - 28 }) + 36
      if (y + rowH > PAGE_H - 48) { footer(doc); doc.addPage(); contHeader(doc); y = 52 }
      doc.roundedRect(MARGIN, y, CONTENT_W, rowH, 6).fill(ORANGE_LIGHT)
      doc.roundedRect(MARGIN, y, CONTENT_W, rowH, 6).stroke(ORANGE_BORDER).lineWidth(0.5)
      doc.roundedRect(MARGIN, y, 4, rowH, 2).fill(ORANGE)
      doc.font('Helvetica-Bold').fontSize(10).fillColor(DARK).text(name, MARGIN + 14, y + 8, { width: CONTENT_W - 28 })
      doc.font('Helvetica').fontSize(8).fillColor(GRAY_DARK).text(body, MARGIN + 14, y + 24, { width: CONTENT_W - 28 })
      y += rowH + 8
    }

    // ── REQUIRED SECTION ──────────────────────────────────────────────────
    if (required.length > 0) {
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(ORANGE).text('REQUIRED CALIBRATIONS', MARGIN, y)
      doc.font('Helvetica').fontSize(8).fillColor(GRAY_MID)
        .text(`${required.length} calibration${required.length !== 1 ? 's' : ''} identified as required for this vehicle`, MARGIN + 175, y + 0.5)
      y += 18
      required.forEach(cal => cal.classification ? drawClassified(cal) : drawCal(cal, true))
    }

    if (reviewRows.length) {
      if (y + 40 > PAGE_H - 48) { footer(doc); doc.addPage(); contHeader(doc); y = 52 }
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(ORANGE).text('CONDITIONAL AND REVIEW', MARGIN, y)
      y += 16
      reviewRows.forEach(cal => drawClassified(cal))
    }

    // ── 🧰 FULL SERVICE (Mark 2026-10-01) ────────────────────────────────
    // Required follow-up work around the calibrations. Who performs it comes
    // from the shop's CRM rule; "Ask" reads as an offer to the shop.
    if (fullSvc.length > 0) {
      if (y + 40 > PAGE_H - 48) { footer(doc); doc.addPage(); contHeader(doc); y = 52 }
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#0369a1').text('FULL SERVICE', MARGIN, y)
      doc.font('Helvetica').fontSize(8).fillColor(GRAY_MID)
        .text('Required follow-up operations for this repair (OEM procedures beyond the calibrations above)', MARGIN + 80, y + 0.5)
      y += 18
      fullSvc.forEach(cal => {
        const m = cal._fs?.mode
        if (m === 'shop') drawCal(cal, true, { pill: 'REQUIRED · SHOP', pillBg: '#78716c', who: 'Performed by the repair facility', whoBg: '#f5f5f4', whoFg: '#57534e' })
        else if (m === 'we') drawCal(cal, true, { who: `Performed by ${BRAND.name}` })
        else drawCal(cal, true, { who: `Available from ${BRAND.name}: ask your technician`, whoBg: '#dcfce7', whoFg: '#166534' })
      })
    }

    // ── SEATBELTS & POST-COLLISION SAFETY INSPECTION (Mark 2026-09-03:
    // on EVERY report — OEM service info requires it on any vehicle
    // involved in a collision, so it applies to every car we see) ──────────
    {
      const pcsiH = 58
      if (y + pcsiH + 16 > PAGE_H - 48) { footer(doc); doc.addPage(); contHeader(doc); y = 52 }
      y += 4
      doc.roundedRect(MARGIN, y, CONTENT_W, pcsiH, 6).fill('#fff7ed')
      doc.roundedRect(MARGIN, y, CONTENT_W, pcsiH, 6).strokeColor(ORANGE).lineWidth(1).stroke()
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#1a1a1a')
        .text('Seatbelts & Post-Collision Safety Inspection (SRS, Steering Columns)', MARGIN + 12, y + 9, { width: CONTENT_W - 160, lineBreak: false })
      doc.font('Helvetica-Bold').fontSize(6.5).fillColor(ORANGE)
        .text('REQUIRED — EVERY VEHICLE', MARGIN + CONTENT_W - 130, y + 10.5, { width: 120, align: 'right', lineBreak: false })
      doc.font('Helvetica').fontSize(8).fillColor('#4b5563')
        .text('OEM service information requires assessment of seat belt tensioner units, SRS components, and steering columns on any vehicle involved in a collision. This post-collision safety inspection is a required operation for this repair and is performed and documented with this calibration visit.', MARGIN + 12, y + 24, { width: CONTENT_W - 24 })
      y += pcsiH + 10
    }

    // ── PRE- & POST-REPAIR DIAGNOSTIC SCANS (Mark 2026-10-02: "add pre and post
    // scan to every report"). Every OEM's collision position statement requires
    // both; who performs them follows the shop's Big 4 rule, the requirement doesn't.
    {
      const scanH = 58
      if (y + scanH + 16 > PAGE_H - 48) { footer(doc); doc.addPage(); contHeader(doc); y = 52 }
      doc.roundedRect(MARGIN, y, CONTENT_W, scanH, 6).fill('#fff7ed')
      doc.roundedRect(MARGIN, y, CONTENT_W, scanH, 6).strokeColor(ORANGE).lineWidth(1).stroke()
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#1a1a1a')
        .text('Pre-Repair & Post-Repair Diagnostic Scans', MARGIN + 12, y + 9, { width: CONTENT_W - 160, lineBreak: false })
      doc.font('Helvetica-Bold').fontSize(6.5).fillColor(ORANGE)
        .text('REQUIRED — EVERY VEHICLE', MARGIN + CONTENT_W - 130, y + 10.5, { width: 120, align: 'right', lineBreak: false })
      doc.font('Helvetica').fontSize(8).fillColor('#4b5563')
        .text(`${make ? `${make}'s` : 'The manufacturer\'s'} collision position statement requires a pre-repair diagnostic scan to identify faults before repairs begin (warning lights are not a reliable indicator) and a post-repair diagnostic scan to confirm every system communicates with no new faults. Both are required operations for this repair.`, MARGIN + 12, y + 24, { width: CONTENT_W - 24 })
      y += scanH + 10
    }

    // ── NOT REQUIRED SECTION ───────────────────────────────────────────────
    if (notReq.length > 0) {
      if (y + 40 > PAGE_H - 48) { footer(doc); doc.addPage(); contHeader(doc); y = 52 }
      doc.moveTo(MARGIN, y + 6).lineTo(PAGE_W - MARGIN, y + 6).strokeColor(GRAY_BORDER).lineWidth(0.5).stroke()
      y += 20
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(GRAY_MID).text('SENSORS CHECKED — NOT REQUIRED', MARGIN, y)
      doc.font('Helvetica').fontSize(8).fillColor(GRAY_MID)
        .text(`${notReq.length} sensor${notReq.length !== 1 ? 's' : ''} reviewed, no repair triggers identified`, MARGIN + 190, y + 0.5)
      y += 18
      // Bare rule-outs (Kinetic-matrix parity) render as a compact
      // two-column checklist — six tall empty cards wasted a page.
      const bare = notReq.every(c => !c.plain_description && !c.justification && !(Array.isArray(c.links) && c.links.length))
      if (bare) {
        const halfW = (CONTENT_W - 10) / 2
        notReq.forEach((cal, i) => {
          const col = i % 2
          if (col === 0 && y + 32 > PAGE_H - 48) { footer(doc); doc.addPage(); contHeader(doc); y = 52 }
          const bx = MARGIN + col * (halfW + 10)
          doc.roundedRect(bx, y, halfW, 26, 5).fill(GRAY_LIGHT)
          doc.roundedRect(bx, y, halfW, 26, 5).stroke(GRAY_BORDER).lineWidth(0.5)
          doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#7a7a7a')
            .text(cal.calibration_name || '—', bx + 10, y + 9, { width: halfW - 118, lineBreak: false })
          doc.font('Helvetica-Bold').fontSize(6).fillColor('#9ca3af')
            .text('CHECKED — NOT REQUIRED', bx + halfW - 106, y + 10.5, { width: 100, align: 'right', lineBreak: false })
          if (col === 1) y += 32
        })
        if (notReq.length % 2 === 1) y += 32
        y += 4
      } else {
        notReq.forEach(cal => cal.classification ? drawClassified(cal) : drawCal(cal, false))
      }
    }

    // ── DOCUMENT LINKS ─────────────────────────────────────────────────────
    const docLinks = Array.isArray(document_links) ? document_links.filter(l => l?.url) : []
    if (docLinks.length > 0) {
      if (y + 40 > PAGE_H - 48) { footer(doc); doc.addPage(); contHeader(doc); y = 52 }
      doc.moveTo(MARGIN, y + 6).lineTo(PAGE_W - MARGIN, y + 6).strokeColor(GRAY_BORDER).lineWidth(0.5).stroke()
      y += 20
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(GRAY_MID).text('REFERENCE LINKS', MARGIN, y)
      y += 16
      docLinks.forEach(link => {
        if (y + 16 > PAGE_H - 48) { footer(doc); doc.addPage(); contHeader(doc); y = 52 }
        doc.font('Helvetica').fontSize(8.5).fillColor(ORANGE)
          .text('› ' + (link.label || link.url), MARGIN + 8, y, { link: link.url, underline: true, width: CONTENT_W - 16 })
        y += 16
      })
    }

    // ── ALLDATA · ADAS QUICK REFERENCE ──────────────────────────────────────
    if (_alldata?.url) {
      const blockH = 50
      if (y + blockH + 16 > PAGE_H - 48) { footer(doc); doc.addPage(); contHeader(doc); y = 52 }
      y += 6
      doc.roundedRect(MARGIN, y, CONTENT_W, blockH, 8).fill('#fff7ed')
      doc.roundedRect(MARGIN, y, 4, blockH, 2).fill(ORANGE)
      doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#9a3412')
        .text('ALLDATA · ADAS SYSTEMS, LOCATIONS & CALIBRATIONS', MARGIN + 16, y + 10)
      const carName = [year, make, model].filter(Boolean).join(' ') || vehicle || 'this vehicle'
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(ORANGE)
        .text(_alldata.exact ? `Open the ALLDATA ADAS Quick Reference for the ${carName} »` : 'Open ALLDATA and enter the VIN for the ADAS Quick Reference »', MARGIN + 16, y + 25,
          { link: _alldata.url, underline: true, width: CONTENT_W - 32, lineBreak: false })
      doc.font('Helvetica').fontSize(7.5).fillColor('#9a3412')
        .text(`${vin ? `VIN ${vin} · ` : ''}ALLDATA subscription required`, MARGIN + 16, y + 38, { width: CONTENT_W - 32, lineBreak: false })
      y += blockH + 10
    }

    // ── PROOF & DOCUMENTATION (Mark 2026-08-29: WorkDrive external link
    // front and center — scan report + proof photos — plus QR + tech) ──
    if (folder_share_url) {
      const blockH = 74
      if (y + blockH + 16 > PAGE_H - 48) { footer(doc); doc.addPage(); contHeader(doc); y = 52 }
      y += 6
      doc.roundedRect(MARGIN, y, CONTENT_W, blockH, 8).fill('#eff6ff')
      doc.roundedRect(MARGIN, y, CONTENT_W, blockH, 8).stroke('#bfdbfe').lineWidth(0.5)
      doc.roundedRect(MARGIN, y, 4, blockH, 2).fill('#1d4ed8')
      const textW = CONTENT_W - (qr_png ? 100 : 30)
      doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#1e3a8a')
        .text('PROOF & DOCUMENTATION', MARGIN + 16, y + 12)
      doc.font('Helvetica').fontSize(8.5).fillColor('#1e40af')
        .text('Scan report, calibration photos, and all supporting documents for this job:',
          MARGIN + 16, y + 27, { width: textW - 16 })
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#1d4ed8')
        .text('Open the job file (WorkDrive) »', MARGIN + 16, y + 42,
          { link: folder_share_url, underline: true, width: textW - 16, lineBreak: false })
      doc.font('Helvetica').fontSize(7).fillColor('#60a5fa')
        .text(qr_png ? 'Or scan the QR code from a printed copy.' : ' ', MARGIN + 16, y + 57, { width: textW - 16, lineBreak: false })
      if (qr_png) {
        doc.image(qr_png, MARGIN + CONTENT_W - 78, y + 5, { fit: [64, 64] })
      }
      y += blockH + 10
    }

    // Completion line — who did the work, dated.
    doc.font('Helvetica').fontSize(8).fillColor(GRAY_MID)
      .text(`${BRAND === ABSOLUTE_BRAND ? 'Work completed by' : 'Prepared by'} ${performedBy}${performedBy === BRAND.name ? '' : ` · ${BRAND.name}`} · ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`,
        MARGIN, y + 4, { width: CONTENT_W })

    footer(doc)

    // 📎 SUPPORTING OEM DOCUMENTS — index page; the documents follow it.
    if (_cited.length) {
      doc.addPage(); contHeader(doc); y = 52
      doc.font('Helvetica-Bold').fontSize(13).fillColor(DARK).text('Supporting OEM Documents', MARGIN, y)
      y += 20
      const index = _cited.map(d => `${d.n}. ${d.row?.doc_title || 'OEM document'}`).join('  ·  ')
      doc.font('Helvetica').fontSize(9).fillColor(GRAY_DARK)
        .text('The calibrations above are required by the vehicle manufacturer. Each document cited in a justification is attached behind this page, in order.', MARGIN, y, { width: CONTENT_W })
      y += 28
      doc.font('Helvetica-Bold').fontSize(8).fillColor(DARK).text('Attachment index', MARGIN, y)
      y += 12
      doc.font('Helvetica').fontSize(8).fillColor(GRAY_DARK).text(index, MARGIN, y, { width: CONTENT_W })
      y += doc.heightOfString(index, { width: CONTENT_W }) + 10
      for (const d of _cited) {
        const r = d.row || {}
        const h = 52
        doc.roundedRect(MARGIN, y, CONTENT_W, h, 6).fill('#faf5ff')
        doc.roundedRect(MARGIN, y, 4, h, 2).fill('#7c3aed')
        doc.font('Helvetica-Bold').fontSize(8).fillColor('#5b21b6').text(`ATTACHMENT ${d.n}`, MARGIN + 14, y + 8)
        doc.font('Helvetica-Bold').fontSize(10).fillColor(DARK).text(`${r.doc_oem ? r.doc_oem + ': ' : ''}${r.doc_title || ''}`, MARGIN + 14, y + 19, { width: CONTENT_W - 28, height: 13, ellipsis: true })
        doc.font('Helvetica').fontSize(8).fillColor(GRAY_MID).text(`Supports: ${[...new Set(d.cals)].join(', ')}${r.doc_published_date ? ` · Published ${r.doc_published_date}` : ''}`, MARGIN + 14, y + 35, { width: CONTENT_W - 28, height: 11, ellipsis: true })
        y += h + 8
      }
      footer(doc)
    }
    doc.end()
  })
}
