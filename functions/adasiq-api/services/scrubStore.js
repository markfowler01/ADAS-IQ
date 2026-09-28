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

/** A sensor counts as required when the scrub enabled it. */
const isRequired = c => c?.enabled === true || /^required$/i.test(String(c?.verdict || ''))
const sensorName = c => String(c?.sensor || c?.calibration_name || '').trim()

/**
 * One scrub → one row. Never throws: a library write must not be able to
 * fail the scrub the tech is waiting on.
 */
export async function saveScrub(req, { jobId, data, source = 'button', by = '', file = {}, status = 'ok', error = '' } = {}) {
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

const LIST_COLS = 'ROWID, scrub_job_id, scrub_shop, scrub_vehicle, scrub_year, scrub_make, scrub_model, scrub_vin, scrub_ro, scrub_claim, scrub_insurer, scrub_source, scrub_by, scrub_status, scrub_at, scrub_sensor_count, scrub_required_count, scrub_required_names, scrub_sensors, scrub_search'

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
  }
}

/** One scrub with its full payload (justifications and all). */
export async function getScrub(req, id) {
  try {
    const rows = await ds(req).zcql().executeZCQLQuery(
      `SELECT * FROM ${TABLE} WHERE ROWID = ${Number(id)} LIMIT 1`)
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
