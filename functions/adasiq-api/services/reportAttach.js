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
const REPORT_RE = /kinetic|calibration.?(id|identification)?.?report|adas.?report|cal.?report/i
const NOT_RE = /post.?scan|pre.?scan|invoice|estimate|supplement|photo|receipt|quote/i

/** The calibration report PDFs in a job's folder (Kinetic first, newest first). */
export async function findJobReportPdfs(req, job) {
  const { getAccessToken } = await import('./zoho.js')
  const { listChildren } = await import('./workdrive.js')
  const { resolveJobFolderPublic } = await import('../routes/jobs.js')
  const wdToken = await getAccessToken()
  const folderId = await resolveJobFolderPublic(req, job, wdToken, { noCreate: true })
  if (!folderId) return []
  const files = (await listChildren(folderId, wdToken, { folders: false })).filter(f => /\.pdf$/i.test(f.name || '') && REPORT_RE.test(f.name || '') && !NOT_RE.test(f.name || '') && (f.size || 0) <= MAX_BYTES)
  files.sort((a, b) => (Number(/kinetic/i.test(b.name)) - Number(/kinetic/i.test(a.name))) || (Number(b.created || 0) - Number(a.created || 0)))
  return files.slice(0, 2).map(f => ({ id: f.id, name: f.name, size: f.size }))
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
  if (!files.length) return out
  for (const f of files) {
    let buffer; try { buffer = await download(f.id) } catch (e) { out.errors.push(`${f.name}: download ${e.message}`); continue }
    for (const t of targets.filter(t => t && t.id)) {
      try { await attachToBooks(token, t.kind, t.id, { name: f.name, buffer }); if (!out.attached.includes(f.name)) out.attached.push(f.name) }
      catch (e) { out.errors.push(`${f.name} → ${t.kind}/${t.id}: ${e.message}`) }
    }
  }
  console.log(`[report-attach] ${job.shop_name || job.id}: attached ${out.attached.join(', ') || 'nothing'}${out.errors.length ? ' · errors: ' + out.errors.join(' | ') : ''}`)
  return out
}
