// Offer letter + contractor agreement PDFs (Mark 2026-09-21, "go" on my
// drafting the wording — edit the TEXT blocks below, nothing else needs
// to change). Plain English on purpose: this is read on a phone by a
// tech, not a lawyer. Washington, at-will. Returns the PDF and where the
// signature line sits so Zoho Sign can drop its field on it.
import PDFDocument from 'pdfkit'

const COMPANY = { name: 'Absolute ADAS LLC', short: 'Absolute ADAS', line: 'Mobile ADAS Calibration & Diagnostics · Washington', owner: 'Mark Fowler', ownerTitle: 'Founder & Owner', email: 'mark@absoluteadas.com' }
const money = n => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const longDate = iso => iso ? new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : '(start date to be set)'
const payLine = o => o.pay_type === 'salary' ? `${money(o.pay_rate)} per year, paid twice a month (the 1st and the 16th)` : o.pay_type === 'per_job' ? `${money(o.pay_rate)} per completed calibration job, paid twice a month (the 1st and the 16th)` : `${money(o.pay_rate)} per hour, paid twice a month (the 1st and the 16th). Hours over 40 in a week are paid at time and a half.`

// ── W-2 offer letter ────────────────────────────────────────────────────
function w2Text(c, o) {
  return [
    `Dear ${c.name.split(' ')[0]},`,
    `We're glad to offer you the job of ${o.title} at ${COMPANY.short}. Here is what the job is, what it pays, and what we ask of each other.`,
    ['The job', `${o.title}, reporting to ${COMPANY.owner}. ${o.duties || 'You calibrate ADAS systems at body shops from our van, run pre- and post-scans, take the full photo set on every car, and keep the van stocked and clean.'} Your home base is ${o.region || 'the Seattle–Tacoma area'}; the job means driving to shops each day.`],
    ['Start date', `${longDate(o.start_date)}. Your first week is a ride-along with Mark or a senior tech.`],
    ['Pay', `${payLine(o)}${o.bonus ? ` ${o.bonus}` : ''} You are a W-2 employee. Taxes are taken out of each check and you get a W-2 each January.`],
    ['Hours', `${o.schedule || 'Full time, generally Monday through Friday, about 8 to 5, with the day set by the dispatch schedule. Some early starts and the occasional Saturday when a shop needs it.'} You clock in and out in the Absolute ADAS app.`],
    ['Time off', `Paid sick leave under Washington law: one hour for every 40 hours worked. ${o.pto || 'Five paid holidays a year (New Year\'s Day, Memorial Day, Independence Day, Thanksgiving, Christmas).'} Time off is requested in the app and approved by Mark.`],
    ['What we provide', `${o.provides || 'The van, the calibration equipment, targets and scan tools, a company phone, and your uniform shirts.'} You are responsible for the equipment while it is in your care.`],
    ['What we ask', 'A valid driver\'s license and a driving record we can insure. You will drive customers\' cars on test drives, so this matters. Show up when scheduled, do the job right the first time, take the photos, and tell the shop the truth. Company property, customer information and pricing stay confidential during and after your employment.'],
    ['At-will', `Employment at ${COMPANY.short} is at-will. Either of us can end it at any time, with or without cause or notice. Nothing in this letter is a contract for a set period. This letter is the whole offer; anything else we've said that isn't in here doesn't count.`],
    ['Before you start', `This offer depends on: proof you can work in the U.S. (Form I-9, within 3 business days of your start), a copy of your driver\'s license and Social Security card, a driving-record check, and finishing the onboarding on your phone (photo, direct deposit, handbook, training).`],
    `If this works for you, sign below. Then watch your phone: your onboarding link arrives as soon as you do. We're looking forward to having you on the crew.`,
    `GET SOME!!!`,
  ]
}

// ── Contractor agreement ────────────────────────────────────────────────
function contractorText(c, o) {
  return [
    `Dear ${c.name.split(' ')[0]},`,
    `This letter sets out the work ${COMPANY.short} is asking you to do as an independent contractor, what it pays, and how we will work together.`,
    ['The work', `${o.title}. ${o.duties || 'Billing and dispatch support: building invoices and quotes in Zoho Books from Kinetic reports, scheduling calibrations with shops, and following up on open invoices.'} You decide how and when the work gets done inside the deadlines we agree on; you may use your own equipment and work from wherever you like.`],
    ['Start date', `${longDate(o.start_date)}.`],
    ['Pay', `${o.pay_type === 'salary' ? `${money(o.pay_rate)} per month` : `${money(o.pay_rate)} per hour of work you invoice`}, paid twice a month (the 1st and the 16th) by Wise to the account you set up in onboarding.${o.bonus ? ` ${o.bonus}` : ''} You are responsible for your own taxes; ${COMPANY.short} does not withhold taxes and will issue a 1099 where required.`],
    ['Not an employee', `This is a contractor relationship, not employment. You are not eligible for employee benefits, paid leave or workers' compensation from ${COMPANY.short}. You may work for others.`],
    ['Confidentiality', 'Customer lists, pricing, insurer rules, and anything inside the Absolute ADAS app and Zoho are confidential, during and after this agreement. Work product you create for us belongs to Absolute ADAS.'],
    ['Ending it', 'Either of us can end this agreement with 14 days\' written notice. We pay for all work done up to the end date.'],
    ['Before you start', 'A copy of your government ID, the signed payout authorization from onboarding, and the handbook acknowledgment.'],
    `If this works for you, sign below. Your onboarding link arrives on your phone as soon as you do.`,
    `GET SOME!!!`,
  ]
}

/**
 * → { pdf: Buffer, sign: { page, x, y, w, h }, date: { page, x, y, w, h } }
 * Coordinates are from the top-left of the page in points (what Zoho Sign wants).
 */
export function buildOfferPdf(cand, offer) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margins: { top: 54, left: 60, right: 60, bottom: 60 } })
    const chunks = []; doc.on('data', c => chunks.push(c)); doc.on('error', reject)
    let sign = null, date = null, pageIdx = 0
    doc.on('pageAdded', () => { pageIdx++ })
    doc.on('end', () => resolve({ pdf: Buffer.concat(chunks), sign, date, pages: pageIdx + 1 }))
    const contractor = offer.employment === 'contractor'
    const W = doc.page.width - 120
    doc.fillColor('#CD4419').fontSize(20).font('Helvetica-Bold').text(COMPANY.name)
    doc.fillColor('#666').fontSize(9).font('Helvetica').text(COMPANY.line).moveDown(0.8)
    doc.fillColor('#000').fontSize(10).text(new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })).moveDown(0.6)
    doc.fontSize(14).font('Helvetica-Bold').text(contractor ? 'Independent Contractor Agreement' : 'Offer of Employment').moveDown(0.3)
    doc.fontSize(10).font('Helvetica').text(`${cand.name}${cand.email ? ` · ${cand.email}` : ''}${cand.phone ? ` · ${cand.phone}` : ''}`).moveDown(0.6)
    for (const block of (contractor ? contractorText : w2Text)(cand, offer)) {
      if (Array.isArray(block)) { doc.font('Helvetica-Bold').fontSize(10).text(block[0]); doc.font('Helvetica').fontSize(9.5).text(block[1], { width: W, lineGap: 0.6 }).moveDown(0.35) }
      else doc.font('Helvetica').fontSize(9.5).text(block, { width: W, lineGap: 0.6 }).moveDown(0.35)
    }
    doc.moveDown(0.3)
    // Signature block — keep it whole on one page
    if (doc.y > doc.page.height - 150) doc.addPage()
    const page = pageIdx
    doc.font('Helvetica-Bold').fontSize(10).text(`For ${COMPANY.name}`)
    doc.font('Helvetica').text(`${COMPANY.owner}, ${COMPANY.ownerTitle}`).moveDown(1.0)
    const y = doc.y
    doc.font('Helvetica-Bold').text('Accepted:')
    doc.moveTo(60, y + 40).lineTo(60 + 280, y + 40).strokeColor('#999').stroke()
    doc.font('Helvetica').fontSize(9).fillColor('#666').text(`${cand.name} — signature`, 60, y + 44)
    doc.moveTo(380, y + 40).lineTo(380 + 150, y + 40).stroke()
    doc.text('Date', 380, y + 44).fillColor('#000')
    sign = { page, x: 60, y: y + 6, w: 280, h: 32 }
    date = { page, x: 380, y: y + 12, w: 150, h: 26 }
    // Footer only if it fits under the lines — never a page of its own.
    if (y + 66 < doc.page.height - doc.page.margins.bottom) doc.fontSize(8).fillColor('#888').text('Signed electronically through Zoho Sign. The signed copy is filed in your personnel folder at Absolute ADAS.', 60, y + 56, { width: W, lineBreak: false })
    doc.end()
  })
}
