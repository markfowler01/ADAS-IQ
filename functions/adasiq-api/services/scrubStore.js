// 🔬 The scrub library (Mark 2026-09-28).
//
// Every scrub we run is kept as a row in AdasScrubs: the car, the shop, the
// RO, the insurer, and every sensor with its required / not-required verdict.
// Before this, a scrub landed in a single AppConfig row per job, capped near
// 10k and impossible to search — so the thinking was paid for once and thrown
// away. Stored, the same work backs the Absolute Promise when an insurer
// pushes back, keeps two techs recommending the same thing on the same car,
// and is the part of this business that is actually worth licensing.
//
// Catalyst notes that shaped this file:
//   • a text column caps at 10,000 chars, so the full payload is chunked
//     across scrub_payload / 2 / 3 instead of being truncated
//   • ZCQL LIKE does not match reliably here — searching is done in JS over
//     paged rows, never with LIKE
//   • getAllRows() caps at 200 rows, so reads page through ZCQL
import catalyst from 'zcatalyst-sdk-node'

const TABLE = 'AdasScrubs'
const CHUNK = 9500          // headroom under the 10k text cap
const PAGE = 200            // ZCQL page size

const ds = req => catalyst.initialize(req, { type: 'advancedio' })
const str = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n)
const nowIso = () => new Date().toISOString()

/** Split a long string across the three payload columns (28.5k total). */
function chunkPayload(json) {
  const s = String(json || '')
  return {
    scrub_payload: s.slice(0, CHUNK),
    scrub_payload2: s.slice(CHUNK, CHUNK * 2),
    scrub_payload3: s.slice(CHUNK * 2, CHUNK * 3),
    _overflow: s.length > CHUNK * 3,
  }
}
const joinPayload = r => `${r.scrub_payload || ''}${r.scrub_payload2 || ''}${r.scrub_payload3 || ''}`

/**
 * What the job card knows. A card built from a scrub, or by hand on Build
 * job, keeps its calibrations as a JSON string of {calibration_name,
 * cal_type, trigger, line_references, justification, enabled}. That is
 * exactly what the Absolute ADAS report PDF is printed from, so it is good
 * enough to stand in for a scrub when no scrub was ever run.
 */
export function cardCalibrations(job) {
  let cals = []
  try { cals = typeof job?.calibrations === 'string' ? JSON.parse(job.calibrations || '[]') : (job?.calibrations || []) } catch { cals = [] }
  return (Array.isArray(cals) ? cals : [])
    .filter(c => c && (c.calibration_name || c.name || c.sensor))
    .map(c => ({
      calibration_name: c.calibration_name || c.name || c.sensor || '',
      cal_type: c.cal_type || '', trigger: c.trigger || '', line_references: c.line_references || '',
      justification: c.justification || '', enabled: c.enabled !== false,
    }))
}

/** The sensor / count / search columns for a set of calibrations. */
function calColumns(cals, extraSearch = []) {
  const required = cals.filter(isRequired)
  const sensors = cals.map(c => ({ n: sensorName(c), t: str(c.cal_type, 40), r: isRequired(c), l: str(c.line_references, 80), g: str(c.trigger, 120) }))
  return {
    scrub_sensor_count: cals.length,
    scrub_required_count: required.length,
    scrub_required_names: required.map(sensorName).filter(Boolean).join(', ').slice(0, CHUNK),
    scrub_sensors: JSON.stringify(sensors).slice(0, CHUNK),
    scrub_search: [...extraSearch, ...cals.map(sensorName)].filter(Boolean).join(' ').toLowerCase().slice(0, CHUNK),
  }
}

/** A sensor counts as required when the scrub enabled it. */
const isRequired = c => c?.enabled === true || /^required$/i.test(String(c?.verdict || ''))
const sensorName = c => String(c?.sensor || c?.calibration_name || '').trim()

/**
 * One scrub → one row. Never throws: a library write must not be able to
 * fail the scrub the tech is waiting on.
 */
export async function saveScrub(req, { jobId, data, source = 'button', by = '', file = {}, status = 'ok', error = '', sourceSystem = '', sourceRef = '' } = {}) {
  try {
    const cals = Array.isArray(data?.calibrations) ? data.calibrations : []
    const required = cals.filter(isRequired)
    // Compact per-sensor verdicts — this is what the library screen lists and
    // what a search matches on. Justifications ride in the payload.
    const sensors = cals.map(c => ({
      n: sensorName(c),
      t: str(c.cal_type, 40),
      r: isRequired(c),
      l: str(c.line_references, 80),
      g: str(c.trigger, 120),
    }))
    const vehicle = str(data?.vehicle || [data?.year, data?.make, data?.model].filter(Boolean).join(' '), 200)
    const names = required.map(c => sensorName(c)).filter(Boolean)

    const row = {
      scrub_job_id: str(jobId, 64),
      scrub_shop: str(data?.shop, 200),
      scrub_vehicle: vehicle,
      scrub_year: str(data?.year, 8),
      scrub_make: str(data?.make, 60),
      scrub_model: str(data?.model, 120),
      scrub_vin: str(data?.vin, 32).toUpperCase(),
      scrub_ro: str(data?.ro_number, 60),
      scrub_claim: str(data?.claim, 80),
      scrub_insurer: str(data?.insurer, 120),
      scrub_pdf_type: str(data?._pdfType || 'CCC', 20),
      scrub_source: str(source, 30),
      // 🔧 Lifecycle plumbing (Mark 2026-09-28, for the CCC integration and the
      // "quote on pre-scan, invoice on exit" dream): every scrub starts at
      // 'scrubbed' and setScrubStage moves it to quoted → job → invoiced → paid.
      // source_system says which door it came in; source_ref is the upstream
      // record id, so a CCC estimate id lands here the day that feed exists.
      scrub_stage: 'scrubbed',
      scrub_stage_at: nowIso(),
      scrub_source_system: str(sourceSystem || (String(source).startsWith('mail:') ? 'email' : source), 30),
      scrub_source_ref: str(sourceRef, 120),
      scrub_by: str(by, 120),
      scrub_status: str(status, 20),
      scrub_at: nowIso(),
      scrub_file_id: str(file?.id, 80),
      scrub_file_name: str(file?.name, 255),
      scrub_sensor_count: cals.length,
      scrub_required_count: required.length,
      scrub_required_names: names.join(', ').slice(0, CHUNK),
      scrub_sensors: JSON.stringify(sensors).slice(0, CHUNK),
      scrub_oem_refs: str(data?._oemRefsUsed, CHUNK),
      scrub_error: str(error, CHUNK),
      // One lowercase haystack so a free-text search is a single includes().
      scrub_search: [data?.shop, vehicle, data?.vin, data?.ro_number, data?.claim, data?.insurer, ...cals.map(sensorName)]
        .filter(Boolean).join(' ').toLowerCase().slice(0, CHUNK),
      ...chunkPayload(JSON.stringify(data || {})),
    }
    delete row._overflow

    const inserted = await ds(req).datastore().table(TABLE).insertRow(row)
    const id = String(inserted?.ROWID || inserted?.[0]?.ROWID || '')
    console.log(`[scrubs] saved ${id} · ${row.scrub_shop} · ${row.scrub_vehicle} · ${required.length}/${cals.length} required`)
    return { ok: true, id }
  } catch (e) {
    console.warn('[scrubs] save failed:', e.message)
    return { ok: false, error: e.message }
  }
}

/** Page the table newest-first. ZCQL only — getAllRows caps at 200. */
async function readPage(req, offset, cols) {
  const rows = await ds(req).zcql().executeZCQLQuery(
    `SELECT ${cols} FROM ${TABLE} ORDER BY CREATEDTIME DESC LIMIT ${PAGE} OFFSET ${offset}`)
  return (rows || []).map(r => r[TABLE] || r)
}

const LIST_COLS = 'ROWID, scrub_job_id, scrub_shop, scrub_vehicle, scrub_year, scrub_make, scrub_model, scrub_vin, scrub_ro, scrub_claim, scrub_insurer, scrub_source, scrub_by, scrub_status, scrub_at, scrub_sensor_count, scrub_required_count, scrub_required_names, scrub_sensors, scrub_search, scrub_reports, scrub_report_name, scrub_report_at, scrub_stage, scrub_stage_at, scrub_quote_number, scrub_invoice_number, scrub_source_system, scrub_source_ref'

/**
 * Search the library. `q` is matched in JS against the prepared haystack,
 * because ZCQL LIKE does not match on this datastore.
 */
export async function listScrubs(req, { q = '', make = '', shop = '', sensor = '', limit = 60, maxScan = 1000 } = {}) {
  const needle = String(q || '').trim().toLowerCase()
  const wantMake = String(make || '').trim().toLowerCase()
  const wantShop = String(shop || '').trim().toLowerCase()
  const wantSensor = String(sensor || '').trim().toLowerCase()
  const out = []
  let scanned = 0
  try {
    for (let off = 0; off < maxScan; off += PAGE) {
      const page = await readPage(req, off, LIST_COLS)
      scanned += page.length
      for (const r of page) {
        const hay = String(r.scrub_search || '').toLowerCase()
        if (needle && !hay.includes(needle)) continue
        if (wantMake && String(r.scrub_make || '').toLowerCase() !== wantMake) continue
        if (wantShop && !String(r.scrub_shop || '').toLowerCase().includes(wantShop)) continue
        if (wantSensor && !String(r.scrub_required_names || '').toLowerCase().includes(wantSensor)) continue
        out.push(shape(r))
        if (out.length >= limit) return { scrubs: out, scanned, truncated: true }
      }
      if (page.length < PAGE) break
    }
  } catch (e) {
    console.warn('[scrubs] list failed:', e.message)
    return { scrubs: out, scanned, error: e.message }
  }
  return { scrubs: out, scanned, truncated: false }
}

function shape(r) {
  let sensors = []
  try { sensors = JSON.parse(r.scrub_sensors || '[]') } catch { sensors = [] }
  return {
    id: String(r.ROWID || ''),
    jobId: r.scrub_job_id || '',
    shop: r.scrub_shop || '',
    vehicle: r.scrub_vehicle || '',
    year: r.scrub_year || '',
    make: r.scrub_make || '',
    model: r.scrub_model || '',
    vin: r.scrub_vin || '',
    ro: r.scrub_ro || '',
    claim: r.scrub_claim || '',
    insurer: r.scrub_insurer || '',
    source: r.scrub_source || '',
    by: r.scrub_by || '',
    status: r.scrub_status || '',
    at: r.scrub_at || '',
    sensorCount: Number(r.scrub_sensor_count || 0),
    requiredCount: Number(r.scrub_required_count || 0),
    requiredNames: r.scrub_required_names || '',
    sensors,
    reports: (() => { try { return JSON.parse(r.scrub_reports || '[]') } catch { return [] } })(),
    reportName: r.scrub_report_name || '',
    reportAt: r.scrub_report_at || '',
    stage: r.scrub_stage || 'scrubbed',
    stageAt: r.scrub_stage_at || '',
    quoteNumber: r.scrub_quote_number || '',
    invoiceNumber: r.scrub_invoice_number || '',
    sourceSystem: r.scrub_source_system || '',
    sourceRef: r.scrub_source_ref || '',
  }
}

/**
 * One scrub with its full payload (justifications and all).
 *
 * The id stays a STRING. A Catalyst ROWID (45874000000606283) is bigger than
 * JavaScript's safe integer range, so Number(id) silently rounds it to
 * ...280 and the row is never found — which is exactly what happened the
 * first time this screen went live (2026-09-28).
 */
export async function getScrub(req, id) {
  const rowId = String(id || '').trim()
  if (!/^\d{1,25}$/.test(rowId)) return null
  try {
    const rows = await ds(req).zcql().executeZCQLQuery(
      `SELECT * FROM ${TABLE} WHERE ROWID = ${rowId} LIMIT 1`)
    const r = (rows || []).map(x => x[TABLE] || x)[0]
    if (!r) return null
    let payload = null
    try { payload = JSON.parse(joinPayload(r)) } catch { payload = null }
    return { ...shape(r), oemRefs: r.scrub_oem_refs || '', error: r.scrub_error || '', payload }
  } catch (e) {
    console.warn('[scrubs] get failed:', e.message)
    return null
  }
}

/**
 * 📎 Record the report PDFs that came out of a job (Mark 2026-09-28: the
 * Kinetic report and the Absolute ADAS report should land in the datastore
 * too). Called after Bill it files / attaches them, so the library row shows
 * which paperwork actually went to the insurer, not just what we recommended.
 *
 * Attaches to the newest scrub for the card. When a job has no scrub row yet
 * (an old card, or one built by hand) it writes a stub row so the report is
 * still on the record. Never throws.
 */
export async function linkReports(req, jobId, files = [], job = {}) {
  try {
    const id = String(jobId || '').replace(/'/g, '')
    if (!id || !files.length) return { ok: false }
    const kindOf = n => /absolute.?adas/i.test(n) ? 'absolute' : /kinetic/i.test(n) ? 'kinetic' : /post.?scan|postscan/i.test(n) ? 'postscan' : 'other'
    const reports = files.filter(f => f?.name).map(f => ({
      kind: kindOf(f.name), name: String(f.name).slice(0, 255), id: String(f.id || ''), size: Number(f.size || 0),
    }))
    const ours = reports.find(r => r.kind === 'absolute')
    const patch = {
      scrub_reports: JSON.stringify(reports).slice(0, CHUNK),
      scrub_report_name: str(ours?.name || reports[0]?.name, 255),
      scrub_report_at: nowIso(),
    }

    const rows = await ds(req).zcql().executeZCQLQuery(
      `SELECT ROWID FROM ${TABLE} WHERE scrub_job_id = '${id}' ORDER BY CREATEDTIME DESC LIMIT 1`)
    const rowId = String((rows || []).map(r => r[TABLE] || r)[0]?.ROWID || '')

    if (rowId) {
      await ds(req).datastore().table(TABLE).updateRow({ ROWID: rowId, ...patch })
      console.log(`[scrubs] linked ${reports.length} report(s) to scrub ${rowId}`)
      return { ok: true, id: rowId, reports }
    }
    // No scrub on this card — keep the paperwork anyway, and take the
    // calibrations off the card itself (they are what the report was printed
    // from). A billed car must never show "0 sensors" just because nobody
    // pressed Scrub (Mark's Lexus RX screenshot, 2026-09-28).
    const cals = cardCalibrations(job)
    const vehicleStr = str(job?.vehicle || [job?.year, job?.make, job?.model].filter(Boolean).join(' '), 200)
    const stub = await ds(req).datastore().table(TABLE).insertRow({
      scrub_job_id: id,
      scrub_status: cals.length ? 'from-card' : 'report-only',
      scrub_stage: 'invoiced', scrub_stage_at: nowIso(),
      ...calColumns(cals, [job?.shop_name, vehicleStr, job?.vin, job?.invoice_number, job?.quote_number, job?.insurer, ...reports.map(r => r.name)]),
      ...chunkPayload(JSON.stringify({ shop: job?.shop_name || '', ro_number: job?.invoice_number || job?.quote_number || '', insurer: job?.insurer || '', vin: job?.vin || '', vehicle: vehicleStr, year: job?.year || '', make: job?.make || '', model: job?.model || '', claim: job?.claim_number || '', calibrations: cals, _from: 'job card' })),
      scrub_shop: str(job?.shop_name, 200),
      scrub_vehicle: vehicleStr,
      scrub_year: str(job?.year, 8), scrub_make: str(job?.make, 60), scrub_model: str(job?.model, 120),
      scrub_vin: str(job?.vin, 32).toUpperCase(),
      scrub_ro: str(job?.invoice_number || job?.quote_number, 60),
      scrub_claim: str(job?.claim_number, 80),
      scrub_insurer: str(job?.insurer, 120),
      scrub_source: 'report-only', scrub_source_system: 'job-card', scrub_at: nowIso(),
      ...patch,
    })
    const sid = String(stub?.ROWID || stub?.[0]?.ROWID || '')
    console.log(`[scrubs] no scrub on card ${id} — filed a report-only row ${sid}`)
    return { ok: true, id: sid, reports, stub: true }
  } catch (e) {
    console.warn('[scrubs] linkReports failed:', e.message)
    return { ok: false, error: e.message }
  }
}

/**
 * Reload a library row's calibrations from the job card it points at. For
 * rows written before the stub learned to read the card, and for any card
 * Kat edited after the scrub. Keeps the row's identity and stage; only the
 * sensor columns and payload change.
 */
export async function refreshFromCard(req, scrubId) {
  const s = await getScrub(req, scrubId)
  if (!s) return { ok: false, error: 'not found' }
  if (!s.jobId) return { ok: false, error: 'this scrub is not linked to a job card' }
  const jobsMod = await import('../routes/jobs.js')
  const job = (await jobsMod.readJobsPublic(req)).find(j => String(j.id) === String(s.jobId))
  if (!job) return { ok: false, error: 'the job card is gone' }
  const cals = cardCalibrations(job)
  if (!cals.length) return { ok: false, error: 'the job card has no calibrations on it either' }
  const vehicleStr = str(job.vehicle || [job.year, job.make, job.model].filter(Boolean).join(' '), 200)
  const p = s.payload && typeof s.payload === 'object' ? s.payload : {}
  const payload = { ...p, shop: p.shop || job.shop_name || '', vehicle: p.vehicle || vehicleStr, vin: p.vin || job.vin || '', ro_number: p.ro_number || job.invoice_number || job.quote_number || '', insurer: p.insurer || job.insurer || '', claim: p.claim || job.claim_number || '', calibrations: cals, _from: 'job card' }
  const patch = {
    ROWID: s.id,
    scrub_status: 'from-card',
    ...calColumns(cals, [job.shop_name, vehicleStr, job.vin, job.invoice_number, job.quote_number, job.insurer, job.claim_number]),
    ...chunkPayload(JSON.stringify(payload)),
  }
  delete patch._overflow
  if (!s.claim && job.claim_number) patch.scrub_claim = str(job.claim_number, 80)
  await ds(req).datastore().table(TABLE).updateRow(patch)
  console.log(`[scrubs] ${s.id} reloaded from card ${s.jobId}: ${patch.scrub_required_count}/${cals.length} required`)
  return { ok: true, id: s.id, sensors: cals.length, required: patch.scrub_required_count }
}

const STAGES = ['scrubbed', 'quoted', 'job', 'invoiced', 'paid']

/**
 * Move a card's newest scrub along the money path and record what it turned
 * into. Stages only move forward: a re-scrub of an invoiced car must not
 * drag the record back to "scrubbed". Never throws — billing must not be
 * able to fail on bookkeeping.
 */
export async function setScrubStage(req, jobId, stage, { quoteNumber = '', quoteId = '', invoiceNumber = '', invoiceId = '', sourceRef = '' } = {}) {
  try {
    const id = String(jobId || '').replace(/'/g, '')
    const want = STAGES.indexOf(String(stage || '').toLowerCase())
    if (!id || want < 0) return { ok: false }
    const rows = await ds(req).zcql().executeZCQLQuery(
      `SELECT ROWID, scrub_stage FROM ${TABLE} WHERE scrub_job_id = '${id}' ORDER BY CREATEDTIME DESC LIMIT 1`)
    const r = (rows || []).map(x => x[TABLE] || x)[0]
    if (!r?.ROWID) return { ok: false, reason: 'no scrub on this card' }
    const have = STAGES.indexOf(String(r.scrub_stage || 'scrubbed').toLowerCase())
    const patch = { ROWID: String(r.ROWID) }
    if (want > have) { patch.scrub_stage = STAGES[want]; patch.scrub_stage_at = nowIso() }
    if (quoteNumber) patch.scrub_quote_number = str(quoteNumber, 60)
    if (quoteId) patch.scrub_quote_id = str(quoteId, 64)
    if (invoiceNumber) patch.scrub_invoice_number = str(invoiceNumber, 60)
    if (invoiceId) patch.scrub_invoice_id = str(invoiceId, 64)
    if (sourceRef) patch.scrub_source_ref = str(sourceRef, 120)
    if (Object.keys(patch).length === 1) return { ok: true, unchanged: true }
    await ds(req).datastore().table(TABLE).updateRow(patch)
    console.log(`[scrubs] card ${id} → ${patch.scrub_stage || STAGES[have]}${invoiceNumber ? ` · invoice ${invoiceNumber}` : ''}${quoteNumber ? ` · quote ${quoteNumber}` : ''}`)
    return { ok: true, id: String(r.ROWID), stage: patch.scrub_stage || STAGES[have] }
  } catch (e) {
    console.warn('[scrubs] setScrubStage failed:', e.message)
    return { ok: false, error: e.message }
  }
}

/** Every scrub ever run on one job card, newest first. */
export async function scrubsForJob(req, jobId) {
  const id = String(jobId || '').replace(/'/g, '')
  if (!id) return []
  try {
    const rows = await ds(req).zcql().executeZCQLQuery(
      `SELECT ${LIST_COLS} FROM ${TABLE} WHERE scrub_job_id = '${id}' ORDER BY CREATEDTIME DESC LIMIT 20`)
    return (rows || []).map(r => shape(r[TABLE] || r))
  } catch (e) {
    console.warn('[scrubs] job lookup failed:', e.message)
    return []
  }
}

/** Headline counts for the library screen. */
export async function scrubStats(req) {
  try {
    const rows = await ds(req).zcql().executeZCQLQuery(
      `SELECT COUNT(ROWID) FROM ${TABLE}`)
    const first = (rows || [])[0] || {}
    const total = Number(Object.values(first[TABLE] || first)[0] || 0)
    return { total }
  } catch { return { total: 0 } }
}
