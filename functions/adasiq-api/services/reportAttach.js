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

/** The calibration report PDFs in a job's folder (Kinetic first, newest first). */
export async function findJobReportPdfs(req, job) {
  const { getAccessToken } = await import('./zoho.js')
  const { listChildren } = await import('./workdrive.js')
  const { resolveJobFolderPublic } = await import('../routes/jobs.js')
  const wdToken = await getAccessToken()
  const folderId = await resolveJobFolderPublic(req, job, wdToken, { noCreate: true })
  if (!folderId) return []
  const files = (await listChildren(folderId, wdToken, { folders: false })).filter(f => /\.pdf$/i.test(f.name || '') && REPORT_RE.test(f.name || '') && !NOT_RE.test(f.name || '') && (f.size || 0) <= MAX_BYTES)
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
  const buffer = await generateADASIQPdf({ shop: job.shop_name || '', ro_number: ro, insurer: job.insurer || '', vin: job.vin || '', vehicle: job.vehicle || '', year: job.year || '', make: job.make || '', model: job.model || '', claim: job.claim_number || '', calibrations: cals, document_links: [], technician: job.technician || '', folder_share_url: job.folder_url || '' })
  const name = `Absolute ADAS_${ro || 'report'}${job.vin ? `_${job.vin}` : ''}.pdf`
  const wdToken = await getAccessToken()
  const folderId = files[0]?.folderId || await resolveJobFolderPublic(req, job, wdToken)
  let id = ''
  if (folderId) { try { ({ fileId: id } = await uploadFileToFolder(folderId, name, buffer, wdToken)); console.log(`[report-attach] generated + filed ${name}`) } catch (e) { console.warn('[report-attach] could not file the generated report:', e.message) } }
  return [{ id, name, size: buffer.length, folderId, buffer }, ...files]
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
export async function attachJobReports(req, token, job, targets) {
  const out = { attached: [], errors: [] }
  let files = []
  try { files = await findJobReportPdfs(req, job) } catch (e) { out.errors.push(`folder: ${e.message}`); return out }
  try { files = await ensureAbsoluteReport(req, job, files) } catch (e) { out.errors.push(`absolute report: ${e.message}`) }
  if (!files.length) return out
  const have = new Map()
  for (const t of targets.filter(t => t && t.id)) have.set(`${t.kind}/${t.id}`, await existingAttachmentNames(token, t.kind, t.id))
  for (const f of files) {
    let buffer = f.buffer; if (!buffer) { try { buffer = await download(f.id) } catch (e) { out.errors.push(`${f.name}: download ${e.message}`); continue } }
    for (const t of targets.filter(t => t && t.id)) {
      if (have.get(`${t.kind}/${t.id}`)?.has(f.name.toLowerCase())) { out.skipped = [...(out.skipped || []), `${f.name} already on ${t.kind}/${t.id}`]; continue }
      try { await attachToBooks(token, t.kind, t.id, { name: f.name, buffer }); if (!out.attached.includes(f.name)) out.attached.push(f.name) }
      catch (e) { out.errors.push(`${f.name} → ${t.kind}/${t.id}: ${e.message}`) }
    }
  }
  console.log(`[report-attach] ${job.shop_name || job.id}: attached ${out.attached.join(', ') || 'nothing'}${out.errors.length ? ' · errors: ' + out.errors.join(' | ') : ''}`)
  return out
}
