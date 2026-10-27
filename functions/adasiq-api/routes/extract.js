import express from 'express'
import catalyst from 'zcatalyst-sdk-node'
import multer from 'multer'
import { extractFromPdf } from '../services/claude.js'
import { crossReferenceRules, saveCalibrationAsRule } from '../services/calibrationRulesService.js'
import { saveScrub } from '../services/scrubStore.js'

const router = express.Router()

// Store file in memory (no disk I/O needed)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB max
  fileFilter(req, file, cb) {
    if (file.mimetype !== 'application/pdf') {
      cb(new Error('Only PDF files are accepted'))
    } else {
      cb(null, true)
    }
  },
})

// ---------------------------------------------------------------------------
// Demo payload — used when ANTHROPIC_API_KEY has no credits or is missing
// ---------------------------------------------------------------------------
const DEMO_PAYLOAD = {
  _demo: true,
  shop: 'Prestige Auto Body — Demo',
  claim: 'CLM-2024-087432',
  insurer: 'State Farm Insurance',
  ro_number: 'RO-10492',
  vehicle: '2022 Toyota RAV4 XSE Hybrid',
  year: '2022',
  make: 'Toyota',
  model: 'RAV4 XSE Hybrid',
  vin: '2T3RWRFV8NW204817',
  calibrations: [
    {
      calibration_name: 'Pre-Collision System (PCS) Camera',
      cal_type: 'Static',
      trigger: 'In Collision',
      line_references: '3, 6, 8, 11',
      justification:
        'Pre-Collision System camera calibration required per Toyota OEM position statement and ALLDATA ADAS procedure following collision repair. The forward-facing camera must be recalibrated after any windshield replacement or front-end structural repair to ensure accurate object detection and automatic emergency braking function. Failure to calibrate presents a safety liability and does not meet Toyota OEM repair standards.',
      enabled: true,
    },
    {
      calibration_name: 'Lane Departure Alert (LDA) / Lane Tracing Assist (LTA)',
      cal_type: 'Static',
      trigger: 'In Collision',
      line_references: '3, 6, 8',
      justification:
        'Lane Departure Alert and Lane Tracing Assist calibration required per Toyota OEM position statement and ALLDATA ADAS procedure following collision repair. These systems share the forward camera and require recalibration any time the camera is disturbed or the windshield is replaced to maintain lane boundary detection accuracy. Failure to calibrate presents a safety liability and does not meet Toyota OEM repair standards.',
      enabled: true,
    },
    {
      calibration_name: 'Blind Spot Monitor (BSM) — Left Radar',
      cal_type: 'Static',
      trigger: 'In Collision',
      line_references: '17, 20',
      justification:
        'Blind Spot Monitor left radar calibration required per Toyota OEM position statement and ALLDATA ADAS procedure following collision repair. Rear quarter panel repairs or replacement can alter radar aim angle, resulting in false alerts or missed vehicle detections in adjacent lanes. Failure to calibrate presents a safety liability and does not meet Toyota OEM repair standards.',
      enabled: true,
    },
    {
      calibration_name: 'Blind Spot Monitor (BSM) — Right Radar',
      cal_type: 'Static',
      trigger: 'In Collision',
      line_references: '17, 20',
      justification:
        'Blind Spot Monitor right radar calibration required per Toyota OEM position statement and ALLDATA ADAS procedure following collision repair. Rear quarter panel repairs or replacement can alter radar aim angle, resulting in false alerts or missed vehicle detections in adjacent lanes. Failure to calibrate presents a safety liability and does not meet Toyota OEM repair standards.',
      enabled: true,
    },
    {
      calibration_name: 'Rear Cross-Traffic Alert (RCTA)',
      cal_type: 'Dynamic',
      trigger: 'In Collision',
      line_references: '17, 20, 33',
      justification:
        'Rear Cross-Traffic Alert calibration required per Toyota OEM position statement and ALLDATA ADAS procedure following collision repair. The rear radar sensors that enable cross-traffic detection must be recalibrated after any rear impact or bumper replacement to ensure proper detection angles are maintained. Failure to calibrate presents a safety liability and does not meet Toyota OEM repair standards.',
      enabled: true,
    },
    {
      calibration_name: 'Steering Angle Sensor (SAS)',
      cal_type: 'Dynamic',
      trigger: 'Suspension/Alignment',
      line_references: '33, 37',
      justification:
        'Steering Angle Sensor calibration required per Toyota OEM position statement and ALLDATA ADAS procedure following collision repair. Any repair involving suspension components, alignment correction, or steering system work necessitates SAS recalibration to ensure accurate vehicle dynamics input for stability control and ADAS systems. Failure to calibrate presents a safety liability and does not meet Toyota OEM repair standards.',
      enabled: true,
    },
    {
      calibration_name: 'Automatic High Beam (AHB)',
      cal_type: 'Static',
      trigger: 'In Collision',
      line_references: '3, 6',
      justification:
        'Automatic High Beam calibration required per Toyota OEM position statement and ALLDATA ADAS procedure following collision repair. The AHB system relies on the same forward camera as PCS and must be recalibrated after windshield replacement or camera repositioning to correctly detect oncoming headlights and taillights. Failure to calibrate presents a safety liability and does not meet Toyota OEM repair standards.',
      enabled: false,
    },
    {
      calibration_name: 'Backup Camera (RCD) Aiming',
      cal_type: 'Static',
      trigger: 'In Collision',
      line_references: '69',
      justification:
        'Backup Camera aiming calibration required per Toyota OEM position statement and ALLDATA ADAS procedure following collision repair. Rear liftgate or bumper replacement can disturb camera mounting position, causing the displayed guidelines to be misaligned with actual vehicle path. Failure to calibrate presents a safety liability and does not meet Toyota OEM repair standards.',
      enabled: false,
    },
  ],
}

// AI justification rewrite (Mark 2026-08-30): when Kinetic missed a
// calibration and Kat toggles/adds it with the estimate line numbers,
// one tap writes a clean house-format justification for the report +
// invoice description.
router.post('/rewrite-justification', async (req, res) => {
  try {
    const { calibration_name, year, make, model, trigger, line_references } = req.body || {}
    if (!calibration_name) return res.status(400).json({ error: 'calibration_name required' })
    const Anthropic = (await import('@anthropic-ai/sdk')).default
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 20000, maxRetries: 1 })
    const vehicle = [year, make, model].filter(Boolean).join(' ') || 'this vehicle'
    const basis = line_references
      ? `triggered by estimate line${String(line_references).includes(',') ? 's' : ''} ${line_references}${trigger ? ` (${trigger})` : ''}`
      : trigger ? `following ${trigger}` : 'following collision repair'
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 300,
      messages: [{ role: 'user', content:
        `Write EXACTLY one justification paragraph (2-3 sentences) for an insurance-facing ADAS report. ` +
        `Calibration: ${calibration_name}. Vehicle: ${vehicle}. Basis: ${basis}.\n` +
        `Required format: "${calibration_name} calibration required per ${make || 'OEM'} OEM position statement and ALLDATA ADAS procedure, ${basis}. ` +
        `[One sentence: which repair operations disturb this sensor and why recalibration is needed.] ` +
        `Failure to calibrate presents a safety liability and does not meet ${make || 'OEM'} OEM repair standards."\n` +
        `Never say "not required". No preamble — return only the paragraph.` }],
    })
    const text = (msg.content || []).map(b => b.text || '').join('').trim()
    if (!text) throw new Error('empty response')
    res.json({ ok: true, justification: text })
  } catch (e) {
    console.error('[rewrite-justification]', e.message)
    res.status(500).json({ error: e.message })
  }
})

// Rivian's published labor for every ADAS calibration visit (Mark's
// Rivian labor table, 2026-09-08). Hours ride in the trigger chip so the
// report shows them; the justification is Rivian's own description.
const RIVIAN_BASE_ITEMS = [
  {
    calibration_name: 'RIV - Pre ADAS-Calibration Vehicle Inspection',
    cal_type: 'Rivian base', trigger: '0.5 hr · every Rivian', line_references: '',
    justification: 'Rivian required pre-calibration inspection: tire pressure check, firmware check and update launch as required, estimate review, and required calibration repair planning. Published Rivian labor time 0.5 hr.',
    enabled: true, base_item: true,
  },
  {
    calibration_name: 'RIV - RiDE Set-Up',
    cal_type: 'Rivian base', trigger: '0.3 hr · every Rivian', line_references: '',
    justification: 'One-time RiDE (Rivian Diagnostic Environment) set-up: connection and initial software setup prior to performing the calibration process. Published Rivian labor time 0.3 hr.',
    enabled: true, base_item: true,
  },
  {
    calibration_name: 'RIV - Driver Assistance Calibration Setup',
    cal_type: 'Rivian base', trigger: '1.0 hr · every Rivian', line_references: '',
    justification: 'Rivian Driver Assistance calibration setup: setup of the approved target placement system and the alignment checks with the vehicle during the initial calibration process, plus time to store the equipment after use. Published Rivian labor time 1.0 hr.',
    enabled: true, base_item: true,
  },
]

// Shared scrub (2026-09-24): the upload screen AND the email intake run the
// same extractor + rules DB + Rivian base lines + auto-learn, so a CCC
// estimate that arrives by email is scrubbed exactly like one Kat uploads.
// 🔁 One scrub per CCC (Mark 2026-10-08: "duplicates are costing me money"). Before any
// AI call: the same PDF bytes (sha1), the same estimate version for the same VIN + RO,
// or the same VIN + RO scrubbed in the last 6 hours → hand back the existing scrub.
// `force` (owner's "Scrub again") is the only way past it. Keys persist in AppConfig.
const _cfgGet = async (req, key) => { try { const r = await catalyst.initialize(req, { type: 'advancedio' }).zcql().executeZCQLQuery(`SELECT ROWID, config_value FROM AppConfig WHERE config_key = '${key.replace(/'/g, "''")}' LIMIT 1`); return r?.[0]?.AppConfig?.config_value || '' } catch { return '' } }
const _cfgPut = async (req, key, value) => { try { const app = catalyst.initialize(req, { type: 'advancedio' }); const r = await app.zcql().executeZCQLQuery(`SELECT ROWID FROM AppConfig WHERE config_key = '${key.replace(/'/g, "''")}' LIMIT 1`); if (r?.length) return; await app.datastore().table('AppConfig').insertRow({ config_key: key.slice(0, 100), config_value: String(value) }) } catch { /* best effort */ } }
function estimateKeyFromText(text) {
  const t = String(text || '')
  const vin = (t.toUpperCase().match(/\b[A-HJ-NPR-Z0-9]{17}\b/g) || []).find(v => /\d/.test(v) && /[A-Z]/.test(v)) || ''
  const ro = (t.match(/RO\s*(?:Number|#|No\.?)?\s*[:#]?\s*([A-Z0-9-]{3,20})/i) || [])[1] || ''
  const sup = (t.match(/Supplement\s*(?:of\s*Record\s*)?(\d+)/i) || [])[1]
  const ver = sup ? `S${sup}` : /Preliminary|Estimate/i.test(t) ? 'E' : 'X'
  return vin && ro ? { vin, ro: ro.toUpperCase(), ver, key: `scrub_est:${vin}:${ro.toUpperCase()}:${ver}` } : null
}
async function findDuplicateScrub(req, buffer, { estText = '', pdfType = '' } = {}) {
  const S = await import('../services/scrubStore.js')
  const sha1 = (await import('crypto')).createHash('sha1').update(buffer).digest('hex')
  const byHash = await _cfgGet(req, `scrub_sha1:${sha1}`)
  if (byHash) { const s = await S.getScrub(req, byHash); if (s?.payload) return { scrub: s, sha1, why: 'same PDF' } }
  let est = null
  if (!/kinetic|report/i.test(pdfType || '') && estText) {
    est = estimateKeyFromText(estText)
    if (est) {
      const byEst = await _cfgGet(req, est.key)
      if (byEst) { const s = await S.getScrub(req, byEst); if (s?.payload) return { scrub: s, sha1, est, why: `same estimate (${est.ver === 'E' ? 'original' : 'supplement ' + est.ver.slice(1)}) for this VIN + RO` } }
      try {
        const rows = (await S.scrubsByRo(req, est.ro)).filter(r => String(r.vin || '').toUpperCase() === est.vin && r.status !== 'archived' && Date.now() - new Date(r.at).getTime() < 6 * 3600 * 1000)
        if (rows[0]) { const s = await S.getScrub(req, rows[0].id); if (s?.payload) return { scrub: s, sha1, est, why: 'same VIN + RO scrubbed in the last 6 hours' } }
      } catch { /* fine */ }
    }
  }
  return { scrub: null, sha1, est }
}

function headerFromText(t) {
  const s = String(t || '')
  const vin = (s.toUpperCase().match(/\b[A-HJ-NPR-Z0-9]{17}\b/g) || []).find(v => /\d/.test(v) && /[A-Z]/.test(v)) || ''
  const ro = (s.match(/RO\s*(?:Number|#|No\.?)?\s*[:#]?\s*([A-Z0-9-]{3,20})/i) || [])[1] || ''
  const ym = s.match(/\b((?:19|20)\d{2})\s+([A-Z][A-Za-z]+(?:[- ][A-Z][a-z]+)?)\s+([A-Z0-9][A-Za-z0-9-]+)/)
  return { vin, ro, year: ym?.[1] || '', make: ym?.[2] || '', model: ym?.[3] || '' }
}

export async function scrubPdfBuffer(req, buffer, { learn = true, jobId = '', by = '', source = 'upload', file = {}, keep = true, pdfType = '', make = '', textMode = true, effort = '', force = false, strictKind = false } = {}) {
  const t0 = Date.now()
  const wait = ms => new Promise(r => setTimeout(r, ms))
  // ONE pdf-parse — used for classify, duplicate check, the main read, and the guard.
  let estText = ''
  if (!/kinetic|report/i.test(pdfType || '')) {
    try { const pdf = (await import('pdf-parse/lib/pdf-parse.js')).default; estText = ((await pdf(buffer)).text || '').trim() } catch { estText = '' }
  }
  const { classifyFromText, guessMakeFromText } = await import('../services/claude.js')
  const classified = classifyFromText(estText) || {}
  if (!make) make = classified.make || guessMakeFromText(estText) || ''
  if (!pdfType) {
    if (classified.kind === 'REPORT') pdfType = 'KINETIC'
    else if (classified.kind === 'CCC' || classified.kind === 'ESTIMATE') pdfType = 'CCC'
  }
  if (classified.kind === 'ABSOLUTE') keep = false
  if (strictKind) {
    if (classified.kind === 'ABSOLUTE') { const e = new Error('That is one of our own Absolute ADAS reports — upload the shop\'s estimate instead.'); e.kind = 'ABSOLUTE'; throw e }
    if (classified.kind && !['CCC', 'ESTIMATE', 'REPORT'].includes(classified.kind)) { const e = new Error(`That does not look like an estimate or a calibration report (read as ${String(classified.kind).toLowerCase()}).`); e.kind = classified.kind; throw e }
  }

  const dup = await findDuplicateScrub(req, buffer, { estText, pdfType })
  if (dup.scrub && !force) {
    console.log(`[scrub 🔁] reused ${dup.scrub.id} (${dup.why}) — no AI spend · source ${source}`)
    const p = { ...(dup.scrub.payload || {}) }
    p.calibrations = Array.isArray(p.calibrations) ? p.calibrations : []
    p.make = p.make || dup.scrub.make || ''
    p.vehicle = p.vehicle || dup.scrub.vehicle || ''
    p._pdfType = p._pdfType || 'CCC'
    // A saved scrub skips the model, but a rule added since that scrub still
    // has to land (RO 8097: re-uploading the same CCC kept the old park-sensor call).
    if (String(p._pdfType).toUpperCase() === 'CCC' && p.calibrations.length) {
      try {
        const { guardScrub, triggerLinesFromText } = await import('../services/scrubGuard.js')
        const before = JSON.stringify(p.calibrations.map(c => [c.calibration_name, !!c.enabled, c.trigger || '']))
        await guardScrub(p, '', { hitsPromise: Promise.resolve(triggerLinesFromText(estText)), text: estText || '' })
        const after = JSON.stringify(p.calibrations.map(c => [c.calibration_name, !!c.enabled, c.trigger || '']))
        if (before !== after) {
          const { replaceScrubCalibrations } = await import('../services/scrubStore.js')
          await replaceScrubCalibrations(req, dup.scrub.id, p.calibrations)
        }
      } catch (e) { console.warn('[extract] reuse guard skipped:', e.message) }
    }
    return { ...p, calibrations: p.calibrations, vin: p.vin || dup.scrub.vin, ro_number: p.ro_number || dup.scrub.ro, vehicle: p.vehicle || dup.scrub.vehicle, shop: p.shop || dup.scrub.shop, _scrubId: dup.scrub.id, _reused: true, _reusedWhy: dup.why, _reusedAt: dup.scrub.at, _pdfType: p._pdfType || 'CCC', _elapsed_ms: Date.now() - t0 }
  }
  const _dupKeys = { sha1: dup.sha1, est: dup.est }
  const textReady = !!(textMode && estText.length >= 800 && !/kinetic|report/i.test(pdfType || ''))
  const header = headerFromText(estText)
  const mk = make || header.make || ''

  // Kick off everything that does not need the main read. VIN and OEM refs
  // get a short head start; we do not wait on NHTSA if the cache is cold.
  let oemP = Promise.resolve('')
  try { const { oemReferenceBlock } = await import('../services/positionStatements.js'); oemP = oemReferenceBlock(req, { make: mk }).catch(() => '') } catch { oemP = Promise.resolve('') }
  let vinP = Promise.resolve(null)
  if (textReady) { try { const V = await import('../services/estimator/vin.js'); vinP = V.vinEquipment(req, V.findVinInText(estText)).catch(() => null) } catch { vinP = Promise.resolve(null) } }
  let hitsPromise = null
  if (!/kinetic|report/i.test(pdfType || '')) {
    const { triggerLines, triggerLinesFromText } = await import('../services/scrubGuard.js')
    hitsPromise = textReady ? Promise.resolve(triggerLinesFromText(estText)) : triggerLines(buffer.toString('base64'))
    hitsPromise.catch(() => {})
  }
  const fileP = (keep && !file?.id && buffer?.length)
    ? fileEstimateCopy(req, buffer, { name: file?.name, data: { year: header.year, make: mk, model: header.model, ro_number: header.ro } }).catch(e => { console.warn('[extract] estimate copy not filed:', e.message); return {} })
    : Promise.resolve(file || {})

  const [refs, equip] = await Promise.all([
    Promise.race([oemP, wait(700).then(() => '')]),
    Promise.race([vinP, wait(400).then(() => null)]),
  ])

  let data
  if (textReady) {
    const { extractFromCccText } = await import('../services/claude.js')
    data = await extractFromCccText(`${equip ? equip.block + '\n\n' : ''}${estText.slice(0, 50000)}`, { oemRefs: refs || '', effort })
    data._textMode = true
    if (equip) data.vin_equipment = equip.summary
  } else {
    data = await extractFromPdf(buffer, { oemRefs: refs || '', pdfType, make: mk, effort })
  }
  if (!data.vin_equipment) {
    try { const late = await Promise.race([vinP, wait(20).then(() => null)]); if (late) data.vin_equipment = late.summary } catch { /* fine */ }
  }
  data._kind = classified.kind || ''
  data._ourReport = classified.kind === 'ABSOLUTE'
  console.log(`[scrub ⏱] main read ${Math.round((Date.now() - t0) / 1000)}s${data._fast ? ' · fast' : ''}`)

  // 🛡️ Hard rules in code under the judgment call (benchmark night 2026-09-28):
  // a replaced windshield means the camera, a front bumper off a Mercedes
  // means the radar. The scrub varied run to run on exactly these; the guard
  // does not. Only on estimates (never on a Kinetic report read), and it can
  // only add or flip to required — never remove.
  if (String(data?._pdfType || '').toUpperCase() === 'CCC' && !data._demo) {
    try { const { guardScrub } = await import('../services/scrubGuard.js'); await guardScrub(data, buffer.toString('base64'), { hitsPromise, text: estText || '' }); console.log(`[scrub ⏱] + guard ${Math.round((Date.now() - t0) / 1000)}s`) }
    catch (e) { console.warn('[extract] guard skipped:', e.message) }
    // 👀 Did the line reader actually see the estimate? (10-14 → 10-26 it silently didn't.)
    if (data._textMode) { try { const { noteReaderHealth } = await import('../services/scrubWatch.js'); await Promise.race([noteReaderHealth(req, { data, text: estText || '', hits: await (hitsPromise || Promise.resolve({})).catch(() => ({})) }), wait(4000)]) } catch (e) { console.warn('[extract] reader health skipped:', e.message) } }
    try { const { applyLessons } = await import('../services/scrubLearn.js'); const L = await applyLessons(req, data); if (L.applied?.length) console.log(`[scrub ⏱] + learn ${L.applied.length}`) }
    catch (e) { console.warn('[extract] learn skipped:', e.message) }
  }

  // Fallback: if no RO number found, use last 8 digits of VIN
  if (!data.ro_number && data.vin && data.vin.length >= 8) {
    const vinLast8 = data.vin.slice(-8)
    data.ro_number = vinLast8
    data._ro_from_vin = true
    console.log(`[extract] No RO number found — using last 8 of VIN: ${vinLast8}`)
  }

  // For CCC estimates, cross-reference against the rules DB to catch anything the AI missed
  if (data._pdfType === 'CCC') {
    const repairText = (data._repairText || '') + ' ' +
      (data.calibrations || []).map(c => c.trigger || '').join(' ')
    const vehicleEquipment = (data._vehicleEquipment || '') + ' ' +
      (data.calibrations || []).map(c => c.calibration_name || '').join(' ')

    const additional = await crossReferenceRules(req, data, repairText, vehicleEquipment)
    if (additional.length > 0) {
      // Since the Kinetic-style rewrite (2026-09-24) the scrub itself lists every
      // sensor with a verdict; a history rule only adds a disabled "history
      // suggests" row so a learned false positive can never re-add itself as required.
      const have = new Set((data.calibrations || []).map(c => String(c.sensor || c.calibration_name || '').toLowerCase()))
      const extras = additional.filter(a => ![...have].some(h => h && (h.includes(String(a.calibration_name).toLowerCase()) || String(a.calibration_name).toLowerCase().includes(h)))).map(a => ({ ...a, enabled: false, trigger: `History suggests (${a.trigger}) — verify`, justification: `Not required by this estimate's operations. ${a.justification}` }))
      console.log(`[extract] Rules DB suggested ${additional.length} (${extras.length} shown as suggestions)`)
      data.calibrations = [...(data.calibrations || []), ...extras]
    }
    try {
      const { stripTeslaBlindSpot } = await import('../services/scrubGuard.js')
      const dropped = stripTeslaBlindSpot(data)
      if (dropped.length) console.log(`[extract] Tesla: dropped blind spot — ${dropped.join(' · ')}`)
    } catch { /* fine */ }
  }

  // Rivian base procedures (Mark 2026-09-08): every Rivian scrub carries
  // Rivian's published pre-calibration labor as REQUIRED base lines on
  // the Absolute ADAS report + invoice, then whatever calibrations the
  // estimate actually needs. Names match the Zoho Books items Mark is
  // adding for Rivian — keep them identical so the invoice matcher
  // finds them by exact name.
  if (/rivian/i.test(String(data.make || '')) || /rivian/i.test(String(data.vehicle || ''))) {
    const have = new Set((data.calibrations || []).map(c => String(c.calibration_name || '').toLowerCase().trim()))
    const base = RIVIAN_BASE_ITEMS.filter(b => !have.has(b.calibration_name.toLowerCase()))
    if (base.length) {
      data.calibrations = [...base.map(b => ({ ...b })), ...(data.calibrations || [])]
      console.log(`[extract] Rivian: added ${base.length} base procedure line(s)`)
    }
  }

  // Auto-learn: save all detected calibrations as rules (non-blocking, runs after response)
  // Applies to every PDF type — CCC, Kinetic, and any future formats
  if (learn && !data._demo && data.make && data.year && data.calibrations?.length) {
    setImmediate(() => {
      for (const cal of data.calibrations) {
        if (cal.base_item) continue   // Rivian base labor is not a calibration rule
        saveCalibrationAsRule(req, {
          make: data.make,
          model: data.model || '',
          year: data.year,
          calibration: cal,
        }).catch(() => {})
      }
      console.log(`[extract] Auto-learned ${data.calibrations.length} calibration(s) for ${data.year} ${data.make} ${data.model}`)
    })
  }

  // 🔬 Keep it (Mark 2026-09-28: "every job that is scrubbed saved and
  // searchable"). Every scrub lands in AdasScrubs regardless of where it was
  // started — upload screen, email queue, or the Scrub button on a card.
  // Demo payloads are not real work, so they are not filed. saveScrub never
  // throws, so the library can never fail the scrub Kat is waiting on.
  if (keep && !data._demo) {
    // 📎 The estimate itself travels with the scrub (Mark 2026-09-29: "on every
    // scrub save the estimate and attach it so the technician on his phone can
    // click and look at the CCC estimate"). A scrub from the email queue or a
    // job folder already has a WorkDrive file; everything else — upload
    // screen, Scrub button, Downloads — is filed into the Scrub Library folder
    // now. Never blocks the scrub: a failed upload just leaves the link off.
    let filed = file || {}
    if (!filed.id && buffer?.length) {
      try { filed = await fileP } catch (e) { console.warn('[extract] estimate copy not filed:', e.message); filed = {} }
    }
    data._scrubId = (await saveScrub(req, { jobId, data, source, by, file: filed })).id || ''
    data._estimateFileId = filed.id || ''
    if (data._scrubId) {
      await _cfgPut(req, `scrub_sha1:${_dupKeys.sha1}`, data._scrubId)
      const est = _dupKeys.est || (data.vin && data.ro_number ? { key: `scrub_est:${String(data.vin).toUpperCase()}:${String(data.ro_number).toUpperCase()}:X` } : null)
      if (est?.key) await _cfgPut(req, est.key, data._scrubId)
    }
  }
  data._elapsed_ms = Date.now() - t0
  console.log(`[scrub ⏱] total ${Math.round(data._elapsed_ms / 1000)}s`)
  // ⏱ Keep the last 30 scrub timings — skip when we are already at the 10s budget.
  if (Date.now() - t0 < 9500) {
    try {
      const app = (await import('zcatalyst-sdk-node')).default.initialize(req, { type: 'advancedio' })
      const rec = { at: new Date().toISOString(), car: String(data?.vehicle || [data?.year, data?.make, data?.model].filter(Boolean).join(' ')).slice(0, 50), mode: data?._textMode ? 'text' : 'pdf', fast: !!data?._fast, total: Date.now() - t0, main: data?._usage?.ms || null, outTok: data?._usage?.out || null, inTok: data?._usage?.in || null, cacheRead: data?._usage?.cacheRead || null, thinkingChars: data?._usage?.thinkingChars || null, jsonChars: data?._usage?.jsonChars || null, textChars: estText.length }
      const r = await app.zcql().executeZCQLQuery("SELECT ROWID, config_value FROM AppConfig WHERE config_key = 'scrub_timings' LIMIT 1")
      const row = r?.[0]?.AppConfig
      const list = [rec, ...(() => { try { return JSON.parse(row?.config_value || '[]') } catch { return [] } })()].slice(0, 30)
      if (row) await app.datastore().table('AppConfig').updateRow({ ROWID: row.ROWID, config_value: JSON.stringify(list) })
      else await app.datastore().table('AppConfig').insertRow({ config_key: 'scrub_timings', config_value: JSON.stringify(list) })
    } catch (e) { console.warn('[scrub ⏱] timing save failed:', e.message) }
    try { const { flush } = await import('../services/spend.js'); await flush(req) } catch { /* never block */ }
  }
  return data
}

// One WorkDrive folder for estimates that have no job folder yet. Found once
// per instance, created on first use under the same parent as job folders.
let _scrubFolderId = ''
async function fileEstimateCopy(req, buffer, { name = '', data = {} } = {}) {
  const { getAccessToken } = await import('../services/zoho.js')
  const { listChildren, createFolderUnder, uploadFileToFolder, JOB_PARENT_FOLDER_ID } = await import('../services/workdrive.js')
  const token = await getAccessToken()
  if (!_scrubFolderId) {
    const kids = await listChildren(JOB_PARENT_FOLDER_ID, token, { folders: true }).catch(() => [])
    const have = (kids || []).find(f => /^scrub library$/i.test(f.name || ''))
    _scrubFolderId = have?.id || (await createFolderUnder(JOB_PARENT_FOLDER_ID, 'Scrub Library', token))?.folderId || ''
    if (!_scrubFolderId) throw new Error('no Scrub Library folder')
  }
  const base = String(name || '').replace(/\.pdf$/i, '').replace(/[^\w .()&-]+/g, ' ').trim()
  const label = [data.year, data.make, data.model].filter(Boolean).join(' ').slice(0, 50)
  const fname = `${data.ro_number ? 'RO ' + data.ro_number + ' - ' : ''}${label || base || 'estimate'}${base && label ? ' - ' + base : ''}.pdf`.slice(0, 120)
  const { fileId } = await uploadFileToFolder(_scrubFolderId, fname, buffer, token)
  return { id: fileId, name: fname }
}

router.post('/', (req, res, next) => {
  upload.single('pdf')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: err.message || 'File upload error.' })
    }
    next()
  })
}, async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No PDF file uploaded.' })
  }

  // Demo mode: only if no API key is configured (Fix #4 — removed ?demo=1 bypass)
  const hasKey = !!process.env.ANTHROPIC_API_KEY
  if (!hasKey) {
    console.log('[extract] Running in DEMO mode — no ANTHROPIC_API_KEY set')
    return res.json(DEMO_PAYLOAD)
  }

  // Guard: reject empty or suspiciously small files
  const fileSizeKB = req.file.buffer.length / 1024
  console.log(`[extract] File received: "${req.file.originalname}" — ${fileSizeKB.toFixed(1)} KB`)
  if (req.file.buffer.length < 512) {
    return res.status(400).json({
      error: `PDF appears to be empty or too small (${Math.round(req.file.buffer.length)} bytes). ` +
             'If this file is stored in iCloud or cloud storage, make sure it has fully downloaded before uploading.',
    })
  }

  try {
    // Classify happens inside the scrub from the same PDF parse — no extra
    // Haiku call. Our own Absolute ADAS reports are extracted but not filed.
    const data = await scrubPdfBuffer(req, req.file.buffer, {
      source: 'upload',
      by: req.user?.name || req.user?.email || '',
      file: { name: req.file.originalname || '' },
      force: req.body?.force === '1' || req.query.force === '1',
      effort: ['low', 'medium', 'high'].includes(req.body?.effort) ? req.body.effort : (req.query.effort || ''),
    })

    res.json(data)
  } catch (err) {
    console.error('[extract] ERROR:', err.message)

    // Billing errors → fall back to demo so the app stays usable
    const isBillingError =
      err.message?.includes('credit balance') ||
      err.message?.includes('too low') ||
      err.message?.includes('billing')

    if (isBillingError) {
      console.log('[extract] Billing issue — serving demo data')
      return res.json({ ...DEMO_PAYLOAD, _demo: true, _demoReason: 'billing' })
    }

    // Clean up Anthropic SDK errors — extract just the human-readable message
    const claudeMsg = err.message?.match(/"message":"([^"]+)"/)
    res.status(500).json({ error: claudeMsg ? claudeMsg[1] : (err.message || 'Extraction failed.') })
  }
})

export default router
