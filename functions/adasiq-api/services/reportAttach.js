// 📎 Kinetic report on the insurance invoice / quote (Mark 2026-09-24: "is
// there any way to attach the kinetic report to the insurance invoice/quote?").
// Bill it looks in the job's WorkDrive folder for the calibration report
// PDF(s), attaches them to the Books estimate (= the insurance invoice) and to
// the invoice(s) with can_send_in_mail, so Books mails them with the document.
// Best effort — a missing report never blocks billing.
import axios from 'axios'
import FormData from 'form-data'

const API = 'https://www.zohoapis.com/books/v3'
const H = t => ({ Authorization: `Zoho-oauthtoken ${t}` })
const org = () => ({ organization_id: process.env.ZOHO_ORGANIZATION_ID })
const MAX_BYTES = 9 * 1024 * 1024
// Kinetic report + our Absolute ADAS report + the post-scan (Mark 2026-09-24:
// "attach the post scan to the insurance estimate and cost estimate").
const REPORT_RE = /kinetic|absolute.?adas|calibration.?(id|identification)?.?report|adas.?report|cal.?report|post.?scan|postscan|scan.?report|health.?report|diagnostic.?report|\btwf\b/i
const NOT_RE = /pre.?scan|invoice|estimate|supplement|photo|receipt|quote|pricing/i

/**
 * Does a report file name belong to THIS job? (2026-09-30: an Audi's reports
 * went out on a Ford's invoice.) Our reports are named with RO + VIN, Kinetic's
 * with the claim number — so the name must carry this job's RO, VIN (or its
 * last 6+) or claim. A file that names nothing of this car is never attached.
 */
export function belongsToJob(job) {
  const N = x => String(x || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  const ids = new Set()
  for (const r of [job.invoice_number, job.quote_number, job.ro_number]) {
    const n = N(r); if (n.length >= 4) ids.add(n)
    const tail = String(r || '').toUpperCase().split(/[^A-Z0-9]+/).filter(t => t.length >= 4)   // "ABS 20656" → 20656
    for (const t of tail) if (!/^(ABS|EABCR|PABR|GCGB|SB|T)$/.test(t)) ids.add(t.replace(/\d$/, m => m))
  }
  const vin = N(job.vin); if (vin.length === 17) { ids.add(vin); ids.add(vin.slice(-8)); ids.add(vin.slice(-6)) }
  const claim = N(job.claim_number || job.claim); if (claim.length >= 5) ids.add(claim)
  const list = [...ids].filter(x => x.length >= 4)
  return name => { const n = N(name); return list.some(id => n.includes(id)) }
}

/** A file name that carries a 17-char VIN that isn't this job's = another car's report. */
export function namesOtherCar(job) {
  const mine = String(job.vin || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  return name => {
    const vins = (String(name || '').toUpperCase().match(/[A-HJ-NPR-Z0-9]{17}/g) || []).filter(v => /\d/.test(v) && /[A-Z]/.test(v))
    if (!vins.length) return false
    if (mine.length !== 17) return true      // job has no VIN: can't prove a VIN-named report is ours → don't send it
    return !vins.includes(mine)
  }
}

/**
 * 🔒 The last gate before a report leaves the building (Mark 2026-09-30:
 * "make it so this can never happen again"). Opens the PDF and reads it:
 *   • the job's VIN printed inside            → ok
 *   • a VIN inside, but not the job's          → BLOCKED (another car)
 *   • no readable VIN, name carries RO/VIN     → ok (scanned post-scans)
 *   • job has no VIN                           → BLOCKED unless we built it
 * Names and folders can lie; the VIN printed in the report can't.
 */
export async function verifyReportForJob(job, name, buffer, { generated = false } = {}) {
  const jobVin = String(job.vin || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (generated) return { ok: true, why: 'built from this job' }
  if (jobVin.length !== 17) return { ok: false, why: 'the job has no VIN, so the report cannot be proven to be this car' }
  let text = ''
  try { const pdf = (await import('pdf-parse/lib/pdf-parse.js')).default; text = (await pdf(buffer, { max: 4 })).text || '' } catch { text = '' }
  const vins = [...new Set((text.toUpperCase().match(/[A-HJ-NPR-Z0-9]{17}/g) || []).filter(v => /\d/.test(v) && /[A-Z]/.test(v)))]
  if (vins.includes(jobVin)) return { ok: true, why: 'VIN matches' }
  if (vins.length) return { ok: false, why: `it is for a different car (VIN ${vins[0]})` }
  if (belongsToJob(job)(name)) return { ok: true, why: 'no readable VIN; file name matches this car' }
  return { ok: false, why: 'no VIN inside and the file name does not name this car' }
}

/** The calibration report PDFs in a job's folder (Kinetic first, newest first). */
export async function findJobReportPdfs(req, job) {
  const { getAccessToken } = await import('./zoho.js')
  const { listChildren } = await import('./workdrive.js')
  const { resolveJobFolderPublic } = await import('../routes/jobs.js')
  const wdToken = await getAccessToken()
  const folderId = await resolveJobFolderPublic(req, job, wdToken, { noCreate: true, exact: true })
  if (!folderId) return []
  // The folder is now resolved EXACTLY (its own link or a folder that starts
  // with this RO), so its files are this car's — except any that name a
  // different VIN, which are never attached. (Kinetic files are named by
  // claim, which jobs don't store, so "must name this car" would drop them.)
  const otherCar = namesOtherCar(job)
  const all = (await listChildren(folderId, wdToken, { folders: false })).filter(f => /\.pdf$/i.test(f.name || '') && REPORT_RE.test(f.name || '') && !NOT_RE.test(f.name || '') && (f.size || 0) <= MAX_BYTES)
  const foreign = all.filter(f => otherCar(f.name))
  // A folder holding another car's report is contaminated — then a Kinetic
  // file named only by claim can't be trusted either; it must name this car.
  const mine = belongsToJob(job)
  const files = all.filter(f => !otherCar(f.name) && (!foreign.length || !/kinetic/i.test(f.name) || mine(f.name)))
  if (foreign.length) console.warn(`[report-attach] ${job.shop_name || job.id}: skipped ${foreign.length} report(s) that don't name this car: ${foreign.map(f => f.name).join(', ')}`)
  const rank = n => /absolute.?adas/i.test(n) ? 0 : /kinetic/i.test(n) ? 1 : 2   // 2 = post-scan / other scan report
  files.sort((a, b) => (rank(a.name) - rank(b.name)) || (Number(b.created || 0) - Number(a.created || 0)))
  // One of each kind, newest wins.
  const seen = new Set(); const picked = []
  for (const f of files) { const k = rank(f.name); if (seen.has(k)) continue; seen.add(k); picked.push(f) }
  return picked.slice(0, 3).map(f => ({ id: f.id, name: f.name, size: f.size, folderId }))   // Absolute ADAS · Kinetic · post-scan
}

/** No Absolute ADAS report in the folder yet → build one from the card's calibrations and file it. */
async function ensureAbsoluteReport(req, job, files) {
  if (files.some(f => /absolute.?adas/i.test(f.name))) return files
  let cals = []; try { cals = typeof job.calibrations === 'string' ? JSON.parse(job.calibrations || '[]') : (job.calibrations || []) } catch { cals = [] }
  cals = (Array.isArray(cals) ? cals : []).map(c => ({ ...c, calibration_name: c.calibration_name || c.name || '', enabled: c.enabled !== false }))
  if (!cals.some(c => c.enabled)) return files
  const { generateADASIQPdf } = await import('./pdf.js')
  const { getAccessToken } = await import('./zoho.js'); const { uploadFileToFolder } = await import('./workdrive.js'); const { resolveJobFolderPublic } = await import('../routes/jobs.js')
  const ro = String(job.invoice_number || job.quote_number || '').trim()
  const buffer = await generateADASIQPdf({ _jobId: job.id, shop: job.shop_name || '', ro_number: ro, insurer: job.insurer || '', vin: job.vin || '', vehicle: job.vehicle || '', year: job.year || '', make: job.make || '', model: job.model || '', claim: job.claim_number || '', calibrations: cals, document_links: [], technician: job.technician || '', folder_share_url: job.folder_url || '' })
  const name = `Absolute ADAS_${ro || 'report'}${job.vin ? `_${job.vin}` : ''}.pdf`
  const wdToken = await getAccessToken()
  const folderId = files[0]?.folderId || await resolveJobFolderPublic(req, job, wdToken)
  let id = ''
  if (folderId) { try { ({ fileId: id } = await uploadFileToFolder(folderId, name, buffer, wdToken)); console.log(`[report-attach] generated + filed ${name}`) } catch (e) { console.warn('[report-attach] could not file the generated report:', e.message) } }
  return [{ id, name, size: buffer.length, folderId, buffer, generated: true }, ...files]
}

/** File names already attached to a Books document (so a re-run never doubles up). */
async function existingAttachmentNames(token, kind, id) {
  try {
    const r = await axios.get(`${API}/${kind}/${id}`, { headers: H(token), params: org(), timeout: 15000, validateStatus: s => s < 500 })
    const doc = r.data?.estimate || r.data?.invoice || {}
    return new Set((doc.documents || []).map(d => String(d.file_name || d.document_name || '').toLowerCase()))
  } catch { return new Set() }
}

async function download(fileId) {
  const { getAccessToken } = await import('./zoho.js'); const { downloadFile } = await import('./workdrive.js')
  const { buffer } = await downloadFile(fileId, await getAccessToken())
  return buffer
}

/** POST /books/v3/{invoices|estimates}/{id}/attachment?can_send_in_mail=true */
export async function attachToBooks(token, kind, id, { name, buffer }) {
  const form = new FormData()
  form.append('attachment', buffer, { filename: name, contentType: 'application/pdf' })
  const r = await axios.post(`${API}/${kind}/${id}/attachment`, form, { headers: { ...H(token), ...form.getHeaders() }, params: { ...org(), can_send_in_mail: true }, timeout: 30000, maxBodyLength: Infinity, validateStatus: s => s < 500 })
  if (r.data?.code !== 0) throw new Error(r.data?.message || `HTTP ${r.status}`)
  return true
}

/**
 * Attach the job's report PDF(s) to the given Books documents.
 * targets: [{ kind: 'estimates'|'invoices', id }]. Returns { attached: [names], errors: [] }.
 */
// The VIN printed on the Books document itself (custom field / any 17-char VIN in its JSON).
async function booksDocVin(token, kind, id) {
  try {
    const r = await axios.get(`${API}/${kind}/${id}`, { headers: H(token), params: org(), timeout: 15000, validateStatus: s => s < 500 })
    const doc = r.data?.estimate || r.data?.invoice || {}
    const vins = [...new Set((JSON.stringify({ ...doc, documents: undefined }).toUpperCase().match(/\b[A-HJ-NPR-Z0-9]{17}\b/g) || []).filter(v => /\d/.test(v) && /[A-Z]/.test(v)))]
    return vins[0] || ''
  } catch { return '' }
}
// The VIN on the newest scrub for this card (the estimate we actually read).
async function scrubVinFor(req, job) {
  try { const { scrubsForJob } = await import('./scrubStore.js'); const s = (await scrubsForJob(req, job.id))?.[0]; return String(s?.vin || '').toUpperCase().replace(/[^A-Z0-9]/g, '') } catch { return '' }
}

export async function attachJobReports(req, token, job, targets) {
  const out = { attached: [], errors: [] }
  // 🔒 2026-10-06 (Avon ABS 20755 / 20746: the job cards carried sample VINs, the generated
  // report inherited them and the "built from this job" bypass attached them to documents
  // for other cars). The CAR is whatever the Books document / the scrub says. If the card
  // disagrees, nothing is generated or attached, and Bill it shows exactly why.
  const jobVin = String(job.vin || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  let truth = ''
  for (const t of targets.filter(t => t && t.id)) { truth = await booksDocVin(token, t.kind, t.id); if (truth) break }
  if (!truth) truth = await scrubVinFor(req, job)
  if (truth && jobVin.length === 17 && truth !== jobVin) {
    out.vin_mismatch = { job: jobVin, document: truth }
    out.errors.push(`🔒 NOT attached — the job card says VIN ${jobVin} but the estimate/invoice is for ${truth}. Fix the VIN on the card, then Bill it again.`)
    try { const { postToCliqChannel, DISPATCH_CHANNEL } = await import('./cliq.js'); await postToCliqChannel(DISPATCH_CHANNEL, `🔒 *Report NOT attached* · ${job.shop_name || 'Job'}${job.vehicle ? ' · ' + job.vehicle : ''} — the card's VIN (${jobVin}) is not the car on the Books document (${truth}). Fix the card's VIN and re-run Bill it.`) } catch { /* fine */ }
    return out
  }
  if (truth && jobVin.length !== 17) job = { ...job, vin: truth }   // card had no VIN: the report carries the document's
  let files = []
  try { files = await findJobReportPdfs(req, job) } catch (e) { out.errors.push(`folder: ${e.message}`); return out }
  try { files = await ensureAbsoluteReport(req, job, files) } catch (e) { out.errors.push(`absolute report: ${e.message}`) }
  if (!files.length) return out
  const have = new Map()
  for (const t of targets.filter(t => t && t.id)) have.set(`${t.kind}/${t.id}`, await existingAttachmentNames(token, t.kind, t.id))
  const sent = []
  for (const f of files) {
    let buffer = f.buffer; if (!buffer) { try { buffer = await download(f.id) } catch (e) { out.errors.push(`${f.name}: download ${e.message}`); continue } }
    const check = await verifyReportForJob(job, f.name, buffer, { generated: !!f.generated })
    if (!check.ok) {
      out.blocked = [...(out.blocked || []), `${f.name}: ${check.why}`]
      out.errors.push(`🔒 NOT attached ${f.name} — ${check.why}`)
      console.warn(`[report-attach] BLOCKED ${f.name} for ${job.shop_name || job.id} (${job.vin || 'no VIN'}): ${check.why}`)
      continue
    }
    sent.push(f)
    for (const t of targets.filter(t => t && t.id)) {
      if (have.get(`${t.kind}/${t.id}`)?.has(f.name.toLowerCase())) { out.skipped = [...(out.skipped || []), `${f.name} already on ${t.kind}/${t.id}`]; continue }
      try { await attachToBooks(token, t.kind, t.id, { name: f.name, buffer }); if (!out.attached.includes(f.name)) out.attached.push(f.name) }
      catch (e) { out.errors.push(`${f.name} → ${t.kind}/${t.id}: ${e.message}`) }
    }
  }
  console.log(`[report-attach] ${job.shop_name || job.id}: attached ${out.attached.join(', ') || 'nothing'}${out.errors.length ? ' · errors: ' + out.errors.join(' | ') : ''}`)
  // 🔬 Put the paperwork on the record too (Mark 2026-09-28). The scrub says
  // what we recommended; this says which reports actually went out with the
  // invoice. Best effort — it can never fail billing.
  try {
    const { linkReports } = await import('./scrubStore.js')
    await linkReports(req, job.id, sent.map(f => ({ id: f.id, name: f.name, size: f.size })), job)
  } catch (e) { console.warn('[report-attach] scrub library link failed:', e.message) }
  return out
}
