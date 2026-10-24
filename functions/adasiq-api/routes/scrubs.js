// 🔬 Scrub button + scrub library (Mark 2026-09-28).
//
//   POST /api/scrubs/job/:id      run a scrub on that card's estimate, now
//   GET  /api/scrubs              search the library
//   GET  /api/scrubs/stats        how many scrubs we hold
//   GET  /api/scrubs/job/:id      every scrub ever run on one card
//   GET  /api/scrubs/:id          one scrub, full payload
//
// The run route deliberately reuses the email queue's machinery rather than
// repeating it: requeueScrub picks the right PDF out of the car's WorkDrive
// folder, runScrubQueue does the scrub, patches the card, writes the review
// blob and posts to Cliq. The button just starts it and waits.
//
// Catalyst caps a gateway request near 30s. A scrub usually lands inside
// that (the upload screen has always run one synchronously), but when it
// does not we return queued:true and the 15-minute ticker finishes the job
// instead of the request dying with nothing saved.
import express from 'express'
import multer from 'multer'
import { requeueScrub, runScrubQueue, scrubQueue } from '../services/emailToJob.js'
import { listScrubs, getScrub, scrubsForJob, scrubStats, refreshFromCard, updateScrubCalibrations, replaceScrubCalibrations, alldataLinksFor, saveAlldataLink, setScrubStageById, linkScrubJob, clearScrubInvoice } from '../services/scrubStore.js'

const router = express.Router()
const who = req => req.user?.name || req.user?.email || 'staff'

// Opening or reprinting a saved scrub applies the Nissan rules to the stored
// lines. A bumper-cover drop is not a park reset. A required front radar keeps
// the alignment prerequisite and a conditional steering-angle row. A battery
// disconnect is added as Battery Reset even when the saved scrub has no
// enabled battery row. A previous look that did not store line numbers is
// not trusted. No re-upload.
async function estimateText(req, s) {
  if (!s?.fileId) return ''
  const { getAccessToken } = await import('../services/zoho.js')
  const { downloadFile } = await import('../services/workdrive.js')
  const { buffer } = await downloadFile(s.fileId, await getAccessToken())
  if (!buffer || buffer.length < 512) return ''
  const pdf = (await import('pdf-parse/lib/pdf-parse.js')).default
  return ((await pdf(buffer)).text || '').trim()
}
async function refreshNissanRules(req, s) {
  const p = s?.payload && typeof s.payload === 'object' ? s.payload : null
  const cals = Array.isArray(p?.calibrations) ? p.calibrations.map(c => ({ ...c })) : null
  if (!cals?.length) return s
  const data = { ...p, make: p.make || s.make || '', vehicle: p.vehicle || s.vehicle || '', calibrations: cals }
  const { demoteNissanParkRows, noteNissanRadarAlignment, openNissanBattery, batteryDisconnectLines, nissanBatteryProbe } = await import('../services/scrubGuard.js')
  const park = demoteNissanParkRows(data)
  const align = noteNissanRadarAlignment(data)
  let battery = false
  let looked = false
  let probeLines = null
  const probe = nissanBatteryProbe(data, { fileId: s.fileId, batteryLines: p._batteryLines })
  if (probe === 'use-stored') {
    battery = openNissanBattery(data, { batteryLines: p._batteryLines }) || battery
  } else if (probe === 'read-file') {
    try {
      const text = await estimateText(req, s)
      looked = true
      probeLines = text ? batteryDisconnectLines(text) : []
      battery = openNissanBattery(data, { text, batteryLines: probeLines }) || battery
    } catch (e) {
      console.warn('[scrubs] nissan battery file check:', e.message)
      battery = openNissanBattery(data) || battery
    }
  } else if (probe !== 'skip') {
    battery = openNissanBattery(data) || battery
  }
  if (!park && !align && !battery && !looked) return s
  const extra = probeLines ? { _batteryChecked: true, _batteryLines: probeLines } : null
  await replaceScrubCalibrations(req, s.id, data.calibrations, extra)
  return (await getScrub(req, s.id)) || s
}

// ── Run a scrub on a card, on demand ────────────────────────────────────────
router.post('/job/:id', async (req, res) => {
  const jobId = String(req.params.id || '')
  if (!jobId) return res.status(400).json({ error: 'job id required' })
  try {
    const picked = await requeueScrub(req, jobId, { source: 'button', by: who(req) })
    const run = await runScrubQueue(req, { max: 1 })
    const item = (run.items || [])[0] || {}
    if (run.ok) {
      const scrubs = await scrubsForJob(req, jobId)
      return res.json({ ok: true, file: picked.name, scrub: scrubs[0] || null, result: item.result || 'scrubbed' })
    }
    if (run.failed) return res.status(502).json({ error: item.result || 'the scrub failed', file: picked.name })
    // Still on the queue: the gateway ran out of time, the ticker will finish it.
    return res.json({ ok: true, queued: true, file: picked.name })
  } catch (e) {
    const msg = String(e.message || 'scrub failed')
    const known = /card not found|no folder|no PDF/i.test(msg)
    res.status(known ? 400 : 500).json({ error: msg })
  }
})

// Is this card waiting on a scrub right now? (drives the button's spinner)
router.get('/job/:id/pending', async (req, res) => {
  try {
    const q = await scrubQueue(req)
    res.json({ pending: q.some(x => String(x.job) === String(req.params.id)) })
  } catch { res.json({ pending: false }) }
})

// ── Upload a report straight into the library (Mark 2026-09-29) ─────────────
// A CCC or other-format estimate is scrubbed; a Kinetic / scan report is read
// as a report; our own Absolute ADAS report is refused. A scrub usually
// outruns the ~30s gateway, so the client polls the list for the file name
// rather than waiting on this response.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } }).single('file')
router.post('/upload', (req, res) => {
  upload(req, res, async err => {
    if (err) return res.status(400).json({ error: err.message })
    if (!req.file || req.file.buffer.length < 512) return res.status(400).json({ error: 'No usable PDF.' })
    const name = String(req.file.originalname || 'estimate.pdf').slice(0, 255)
    // 🔁 One file, one scrub (2026-10-02: a single upload of the Denali estimate was
    // re-sent ~every 40s and scrubbed 21 times — the request outlives the gateway's
    // 30s window and comes back). Same bytes within 15 min → hand back the scrub
    // already done or still running instead of paying for another one.
    const hash = (await import('crypto')).createHash('sha1').update(req.file.buffer).digest('hex')
    const lockKey = `scrub_up_${hash}`
    let seg = null
    try { seg = (await import('zcatalyst-sdk-node')).default.initialize(req).cache().segment() } catch { seg = null }
    const readLock = async () => { try { return JSON.parse(await seg.getValue(lockKey)) || null } catch { return null } }
    if (seg) {
      for (let i = 0; i < 6; i++) {
        const l = await readLock()
        if (!l || Date.now() - Number(l.at || 0) > 15 * 60 * 1000) break
        if (l.state === 'done') return res.json({ ...l.result, duplicate: true })
        if (l.state === 'running' && Date.now() - Number(l.at || 0) > 3 * 60 * 1000) break   // stale
        if (l.state === 'running') { if (i === 5) return res.status(202).json({ ok: true, pending: true, name }); await new Promise(r => setTimeout(r, 4000)); continue }
        break
      }
      try { await seg.put(lockKey, JSON.stringify({ state: 'running', at: Date.now() }), 1) } catch { /* no lock, scrub anyway */ }
    }
    try {
      const unlock = async () => { if (seg) { try { await seg.delete(lockKey) } catch { /* fine */ } } }
      const { scrubPdfBuffer } = await import('./extract.js')
      const force = req.body?.force === '1' || req.query.force === '1'
      let data
      try {
        data = await scrubPdfBuffer(req, req.file.buffer, { learn: true, source: 'upload', by: who(req), file: { name }, force, strictKind: true })
      } catch (e) {
        await unlock()
        if (e.kind) return res.status(400).json({ error: e.message, kind: e.kind })
        throw e
      }
      const kind = data?._kind || 'CCC'
      const out = { ok: true, kind, name, scrubId: data?._scrubId || '', vehicle: data?.vehicle || '', required: (data?.calibrations || []).filter(c => c.enabled !== false).length, duplicate: !!data?._reused, duplicate_why: data?._reusedWhy || '', scrubbed_at: data?._reusedAt || '', elapsed_ms: data?._elapsed_ms || null }
      if (seg) { try { await seg.put(lockKey, JSON.stringify({ state: 'done', at: Date.now(), result: out }), 1) } catch { /* fine */ } }
      res.json(out)
    } catch (e) {
      if (seg) { try { await seg.delete(lockKey) } catch { /* fine */ } }
      res.status(500).json({ error: e.message, name })
    }
  })
})

// 📸 Photos of a printed estimate (Mark 2026-10-24: "the technician will be on
// site and he will take pictures … send it through the scrubber"). The phone
// shrinks each page to a JPEG; here the pages become ONE PDF and run through the
// exact same scrubber as an uploaded PDF (scanned PDFs already read page by page).
// Same gateway story as /upload: the scrub outlives the 30s window, so the app
// polls the library for `name`.
const photoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024, files: 15 } }).array('pages', 15)
export async function photosToPdf(files) {
  const { PDFDocument } = await import('pdf-lib')
  const doc = await PDFDocument.create()
  for (const f of files) {
    const isPng = /png/i.test(f.mimetype) || (f.buffer[0] === 0x89 && f.buffer[1] === 0x50)
    const img = isPng ? await doc.embedPng(f.buffer) : await doc.embedJpg(f.buffer)
    const page = doc.addPage([img.width, img.height])
    page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height })
  }
  return Buffer.from(await doc.save())
}
router.post('/upload-photos', (req, res) => {
  photoUpload(req, res, async err => {
    if (err) return res.status(400).json({ error: err.message })
    const files = (req.files || []).filter(f => f.buffer?.length > 2000 && /image\/(jpe?g|png)/i.test(f.mimetype || 'image/jpeg'))
    if (!files.length) return res.status(400).json({ error: 'No photos came through. Take a picture of each page and try again.' })
    const name = String(req.body?.name || `Photo estimate ${new Date().toISOString().slice(0, 16).replace('T', ' ')}.pdf`).replace(/[^\w .()-]/g, '').slice(0, 120)
    try {
      const pdf = await photosToPdf(files)
      console.log(`[scrub 📸] ${files.length} page photo(s) → ${Math.round(pdf.length / 1024)} KB PDF · ${who(req)} · ${name}`)
      const { scrubPdfBuffer } = await import('./extract.js')
      const data = await scrubPdfBuffer(req, pdf, { learn: true, source: 'photos', by: who(req), file: { name }, pdfType: 'CCC', textMode: false })
      res.json({ ok: true, name, pages: files.length, scrubId: data?._scrubId || '', vehicle: data?.vehicle || '', required: (data?.calibrations || []).filter(c => c.enabled !== false).length, duplicate: !!data?._reused })
    } catch (e) {
      console.error('[scrub 📸]', e.message)
      res.status(500).json({ error: e.message, name })
    }
  })
})

// ── The library ─────────────────────────────────────────────────────────────
router.get('/lessons', async (req, res) => {
  try {
    const { listLessons } = await import('../services/scrubLearn.js')
    const lessons = await listLessons(req)
    res.json({ count: lessons.length, active: lessons.filter(l => l.active).length, lessons })
  } catch (e) { res.status(500).json({ error: e.message }) }
})
router.get('/stats', async (req, res) => {
  res.json(await scrubStats(req))
})

router.get('/job/:id', async (req, res) => {
  res.json({ scrubs: await scrubsForJob(req, req.params.id) })
})

router.post('/resolve-shops', async (req, res) => {
  try {
    const { backfillResolvedShops } = await import('../services/scrubStore.js')
    res.json(await backfillResolvedShops(req, { limit: Math.min(Number(req.body?.limit) || 400, 1000) }))
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.get('/', async (req, res) => {
  try {
    const r = await listScrubs(req, {
      q: req.query.q || '',
      make: req.query.make || '',
      shop: req.query.shop || '',
      sensor: req.query.sensor || '',
      archived: req.query.archived === '1',
      limit: Math.min(Number(req.query.limit) || 60, 1000),   // the library groups by shop + archive client-side
    })
    res.json(r)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// 📄 The Absolute ADAS report for this scrub, straight off the library
// (Mark 2026-09-28: "I want to be able to download a PDF the Absolute ADAS
// report directly from here"). Built from the stored payload, so it works
// for a scrub that never reached a job card or an invoice.
// 🚶 Lot walks (Mark 2026-09-30). Anyone signed in (techs walk lots).
const walker = req => req.user?.techName || (req.user?.name || '').split(' ')[0] || req.user?.email || 'tech'
router.get('/walks', async (req, res) => {
  try { const { recentWalks } = await import('../services/scrubStore.js'); res.json({ walks: await recentWalks(req, String(req.query.shop || ''), Number(req.query.limit) || 10) }) }
  catch (e) { res.status(500).json({ error: e.message }) }
})
router.post('/walks', express.json(), async (req, res) => {
  try {
    const shop = String(req.body?.shop || '').trim(); if (!shop) return res.status(400).json({ error: 'shop required' })
    const { startWalk } = await import('../services/scrubStore.js'); res.json({ walk: await startWalk(req, { shop, by: walker(req) }) })
  } catch (e) { res.status(500).json({ error: e.message }) }
})
router.post('/walks/:wid/mark', express.json(), async (req, res) => {
  try { const { markWalkCar } = await import('../services/scrubStore.js'); res.json(await markWalkCar(req, req.params.wid, { scrubId: String(req.body?.scrubId || ''), status: String(req.body?.status || ''), note: req.body?.note || '', label: req.body?.label || '', stage: req.body?.stage || '', due: req.body?.due || '', shop: req.body?.shop || '', siblings: Array.isArray(req.body?.siblings) ? req.body.siblings : [], techKey: req.user?.techName || '', by: walker(req) })) }
  catch (e) { res.status(400).json({ error: e.message }) }
})
// 🚗 Live Day follow-up on a car: Ready / Still not ready (new day) / Gone.
router.post('/seen', express.json(), async (req, res) => {
  try {
    const { setSeen } = await import('../services/scrubStore.js')
    const ids = (Array.isArray(req.body?.scrubIds) ? req.body.scrubIds : []).map(String).filter(x => /^\d+$/.test(x)).slice(0, 10)
    const s = String(req.body?.status || ''); if (!['here', 'not_ready', 'estimate', 'gone'].includes(s) || !ids.length) return res.status(400).json({ error: 'status + scrubIds required' })
    let seen = null
    for (const id of ids) seen = await setSeen(req, id, { s, by: walker(req), st: req.body?.stage || '', d: req.body?.due || '', n: req.body?.note || '' })
    res.json({ ok: true, seen })
  } catch (e) { res.status(500).json({ error: e.message }) }
})
router.post('/walks/:wid/found', express.json(), async (req, res) => {
  try { const { addFoundCar } = await import('../services/scrubStore.js'); res.json(await addFoundCar(req, req.params.wid, { ...req.body, by: walker(req) })) }
  catch (e) { res.status(400).json({ error: e.message }) }
})
router.post('/walks/:wid/finish', express.json(), async (req, res) => {
  try {
    const { finishWalk, WALK_STATUSES } = await import('../services/scrubStore.js')
    const w = await finishWalk(req, req.params.wid)
    const lines = w.items.filter(i => i.status !== 'here').map(i => `• ${WALK_STATUSES[i.status]}: ${i.label || 'car'}${i.note ? ` — ${i.note}` : ''}`)
    const msg = `🚶 *Lot walk · ${w.shop}* by ${w.by}: ${w.summary}${lines.length ? '\n' + lines.join('\n') : ''}`
    try { const { postToCliqChannel, DISPATCH_CHANNEL } = await import('../services/cliq.js'); await postToCliqChannel(DISPATCH_CHANNEL, msg) } catch {}
    try { const { createNotification } = await import('./notifications.js'); await createNotification(req, { to: 'Kath', toEmail: 'k.belmonte@absoluteadas.com', type: 'lot_walk', title: `🚶 Lot walk · ${w.shop}: ${w.summary}`, body: lines.join('\n') || 'Every car on the lot.', skipCliq: true, skipTechChannel: true }) } catch {}
    res.json({ walk: w })
  } catch (e) { res.status(400).json({ error: e.message }) }
})

router.get('/:id/pdf', async (req, res) => {
  try {
    const s = await refreshNissanRules(req, await getScrub(req, req.params.id))
    if (!s) return res.status(404).json({ error: 'not found' })
    const p = s.payload || {}
    const cals = Array.isArray(p.calibrations) && p.calibrations.length
      ? p.calibrations
      : (s.sensors || []).map(x => ({ calibration_name: x.n, cal_type: x.t, trigger: x.g, line_references: x.l, enabled: !!x.r, justification: '' }))
    if (!cals.length) {
      // Billed before the library learned to read the card, and the card is
      // gone (removed on invoice-sent, Mark's rule). The report that actually
      // went out is still in WorkDrive — serve that rather than a dead button.
      const stored = (s.reports || []).find(r => r.kind === 'absolute' && r.id)
      if (!stored) return res.status(400).json({ error: 'this scrub has no calibrations and no stored report' })
      const { getAccessToken } = await import('../services/zoho.js')
      const { downloadFile } = await import('../services/workdrive.js')
      const { buffer } = await downloadFile(stored.id, await getAccessToken())
      if (!buffer || buffer.length < 512) return res.status(502).json({ error: 'could not read the stored report from WorkDrive' })
      res.setHeader('Content-Type', 'application/pdf')
      res.setHeader('Content-Disposition', `attachment; filename="${String(stored.name || 'Absolute ADAS report.pdf').replace(/"/g, '')}"`)
      res.setHeader('Content-Length', buffer.length)
      return res.end(buffer)
    }

    const { generateADASIQPdf } = await import('../services/pdf.js')
    const buffer = await generateADASIQPdf({
      _scrubId: s.id,
      _fsOverride: p.fs_override || '',
      shop: s.shop || p.shop || '',
      ro_number: s.ro || p.ro_number || '',
      insurer: s.insurer || p.insurer || '',
      vin: s.vin || p.vin || '',
      vehicle: s.vehicle || p.vehicle || '',
      year: s.year || p.year || '',
      make: s.make || p.make || '',
      model: s.model || p.model || '',
      claim: s.claim || p.claim || '',
      calibrations: cals,
      document_links: Array.isArray(p.document_links) ? p.document_links : [],
      technician: s.by || '',
      folder_share_url: '',
    })
    const safe = [s.year, s.make, s.model].filter(Boolean).join(' ').replace(/[^A-Za-z0-9 _-]/g, '').trim()
    const name = `Absolute ADAS_${s.ro || safe || 'report'}${s.vin ? `_${s.vin}` : ''}.pdf`
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`)
    res.setHeader('Content-Length', buffer.length)
    res.end(buffer)
  } catch (e) {
    console.error('[scrubs] pdf failed:', e.message)
    res.status(500).json({ error: e.message })
  }
})

// 🔄 Reload this row's calibrations from the job card it points at.
router.post('/:id/from-card', async (req, res) => {
  try {
    const r = await refreshFromCard(req, req.params.id)
    if (!r.ok) return res.status(400).json(r)
    res.json({ ...r, scrub: await getScrub(req, req.params.id) })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// One-tap feedback on a line (Mark 2026-10-09): miss = we should have
// required it, extra = we should not have. Flips the line and stores a
// lesson so the next similar car gets the same call.
router.post('/:id/feedback', express.json(), async (req, res) => {
  try {
    const s = await getScrub(req, req.params.id)
    if (!s) return res.status(404).json({ error: 'not found' })
    const actionIn = String(req.body?.action || '').toLowerCase()
    if (actionIn === 'confirm') {
      return res.json({ ok: true, confirmed: true, scrub: s })
    }
    const action = actionIn === 'extra' || actionIn === 'drop' ? 'drop' : 'require'
    const sensor = String(req.body?.sensor || req.body?.name || '').trim()
    if (!sensor) return res.status(400).json({ error: 'sensor required' })
    const { recordLesson, canonSensor, applyMiss } = await import('../services/scrubLearn.js')
    const name = canonSensor(sensor)
    const p = s.payload && typeof s.payload === 'object' ? s.payload : {}
    const cals = Array.isArray(p.calibrations) ? p.calibrations.map(c => ({ ...c })) : (s.sensors || []).map(x => ({
      calibration_name: x.n, cal_type: x.t || '', trigger: x.g || '', line_references: x.l || '', enabled: !!x.r, justification: '',
    }))
    let row = cals.find(c => canonSensor(c.calibration_name || c.sensor) === name)
    if (!row) {
      row = { calibration_name: name, cal_type: '', trigger: String(req.body?.trigger || ''), line_references: String(req.body?.lines || ''), enabled: action === 'require', justification: 'Added from feedback.', _added: true, _learned: action === 'require' ? 'added' : '', _by: who(req) }
      cals.push(row)
    } else if (action === 'require') {
      const applied = applyMiss(row)
      if (applied.keptOff) {
        return res.json({ ok: true, keptOff: true, scrub: s, message: `Kept off — ${name} stays off. A hard rule demoted it, so Missed does not turn it back on.` })
      }
      row._by = who(req)
      if (req.body?.trigger) row.trigger = String(req.body.trigger)
      if (req.body?.lines) row.line_references = String(req.body.lines)
    } else {
      row.enabled = false
      row._edited = true
      row._by = who(req)
      if (req.body?.trigger) row.trigger = String(req.body.trigger)
      if (req.body?.lines) row.line_references = String(req.body.lines)
    }
    const lesson = await recordLesson(req, {
      action, sensor: name, make: s.make || p.make, year: s.year || p.year,
      vin: s.vin, scrub_id: s.id, by: who(req),
      trigger: row.trigger, lines: row.line_references, note: String(req.body?.note || ''),
    })
    const r = await updateScrubCalibrations(req, s.id, cals, { by: who(req), skipLearn: true })
    if (!r.ok) return res.status(400).json(r)
    res.json({ ok: true, lesson: lesson.lesson, scrub: await getScrub(req, s.id) })
  } catch (e) { res.status(500).json({ error: e.message }) }
})
// ✏️ Save hand-edited calibration lines (added / toggled / rewritten).
router.put('/:id/calibrations', async (req, res) => {
  try {
    const r = await updateScrubCalibrations(req, req.params.id, req.body?.calibrations, { by: who(req) })
    if (!r.ok) return res.status(400).json(r)
    res.json({ ...r, scrub: await getScrub(req, req.params.id) })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// 💸 Record the invoice the 💸 Create invoice button just made, so the scrub
// shows its green "invoiced" badge and the number it went out under. The
// invoice itself is created by POST /api/books/from-extract — the same path
// the jobs page uses — so there is exactly one place money gets made. This
// only does the bookkeeping, and by design it never fails the billing: if the
// stamp does not take, the invoice still exists.
// 🧾 The review screen created a job from this scrub → link it (one card per scrub).
router.post('/:id/job', express.json(), async (req, res) => {
  try {
    const r = await linkScrubJob(req, req.params.id, { jobId: String(req.body?.jobId || ''), quoteNumber: String(req.body?.quoteNumber || ''), quoteId: String(req.body?.quoteId || ''), stage: String(req.body?.stage || 'job') })
    if (!r.ok) return res.status(400).json(r)
    res.json({ ...r, scrub: await getScrub(req, req.params.id) })
  } catch (e) { res.status(500).json({ error: e.message }) }
})
// Owner-only: clear an invoice stamp left by the retired Invoice-now shortcut.
router.post('/:id/clear-invoice', async (req, res) => {
  if (String(req.user?.role || '') === 'technician') return res.status(403).json({ error: 'Owner / Kat only' })
  try { await clearScrubInvoice(req, req.params.id); res.json({ ok: true, scrub: await getScrub(req, req.params.id) }) } catch (e) { res.status(500).json({ error: e.message }) }
})

router.post('/:id/invoice', express.json(), async (req, res) => {
  try {
    const { invoiceNumber = '', invoiceId = '', quoteNumber = '', quoteId = '', stage = '' } = req.body || {}
    if (!invoiceNumber && !invoiceId && !quoteNumber && !quoteId) return res.status(400).json({ error: 'a quote or invoice number/id is required' })
    const before = await getScrub(req, req.params.id)
    if (!before) return res.status(404).json({ error: 'not found' })
    // A quote moves the scrub to "quoted", an invoice to "invoiced"; stages only move forward.
    const want = ['quoted', 'invoiced'].includes(stage) ? stage : ((invoiceNumber || invoiceId) ? 'invoiced' : 'quoted')
    const r = await setScrubStageById(req, req.params.id, want, { invoiceNumber, invoiceId, quoteNumber, quoteId })
    res.json({ ...r, scrub: await getScrub(req, req.params.id) })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// 📎 The source estimate PDF, so the estimator can read the CCC lines while
// adding a calibration. Only scrubs that came from a filed PDF have one.
// ✨ "Why?" for the in-app report: the online-report link + each row's OEM references
// (same data the shop's online report shows; Mark 2026-10-02).
router.get('/:id/why', async (req, res) => {
  try {
    const R = await import('../services/publicReport.js')
    const data = await R.reportData(req, req.params.id)
    if (!data) return res.status(404).json({ error: 'not found' })
    const url = await R.reportUrl(req, req.params.id)
    const rows = data.cals.map(c => ({ name: c.calibration_name || '', always: !!c._always, required: !!c.enabled, type: c.cal_type || '', trigger: c.trigger || '', why: c.justification || '',
      refs: (c._refs || []).map(r => ({ ...r, href: `${url}/doc/${r.n}${r.pages?.[0] ? `#page=${r.pages[0]}` : ''}` })),
      named: (c._citeTitles || []).filter(t => !(c._refs || []).some(r => r.title === t)) }))
    res.json({ url, rows, docs: data.cited.map(d => ({ n: d.n, title: `${d.row.doc_oem ? d.row.doc_oem + ': ' : ''}${d.row.doc_title}`, href: `${url}/doc/${d.n}` })) })
  } catch (e) { res.status(500).json({ error: e.message }) }
})
router.get('/:id/estimate', async (req, res) => {
  try {
    const s = await getScrub(req, req.params.id)
    if (!s) return res.status(404).json({ error: 'not found' })
    if (!s.fileId) return res.status(404).json({ error: 'no filed estimate on this scrub' })
    const { getAccessToken } = await import('../services/zoho.js')
    const { downloadFile } = await import('../services/workdrive.js')
    const { buffer } = await downloadFile(s.fileId, await getAccessToken())
    if (!buffer || buffer.length < 512) return res.status(502).json({ error: 'could not read the estimate from WorkDrive' })
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `inline; filename="${String(s.fileName || 'estimate.pdf').replace(/"/g, '')}"`)
    res.setHeader('Content-Length', buffer.length)
    res.end(buffer)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// 📚 ALLDATA quick reference for this car: known deep links, or nothing (the
// report then copies the VIN and opens the vehicle selector).
router.get('/:id/alldata', async (req, res) => {
  try {
    const s = await getScrub(req, req.params.id); if (!s) return res.status(404).json({ error: 'not found' })
    res.json(await alldataLinksFor(req, { year: s.year, make: s.make, model: s.model }))
  } catch (e) { res.status(500).json({ error: e.message }) }
})
router.post('/:id/alldata', express.json(), async (req, res) => {
  try {
    const s = await getScrub(req, req.params.id); if (!s) return res.status(404).json({ error: 'not found' })
    const r = await saveAlldataLink(req, { year: s.year, make: s.make, model: s.model, url: req.body?.url, label: req.body?.label, ro: s.ro, by: who(req) })
    if (!r.ok) return res.status(400).json(r)
    res.json({ ...r, ...(await alldataLinksFor(req, { year: s.year, make: s.make, model: s.model })) })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// 🔬 Scan lifecycle (Mark 2026-10-07/08). GET preview = what billing the pre-scan would do;
// POST { which: 'pre'|'post', done: true|false, emails? } ticks the box — pre + rule charge
// bills on the spot (one line, both documents emailed).
router.get('/:id/scan/preview', async (req, res) => {
  try { const s = await getScrub(req, req.params.id); if (!s) return res.status(404).json({ error: 'not found' }); const L = await import('../services/scanLifecycle.js'); res.json(await L.preScanPreview(req, s)) }
  catch (e) { res.status(500).json({ error: e.message }) }
})
router.post('/:id/scan', async (req, res) => {
  try {
    const L = await import('../services/scanLifecycle.js')
    const r = await L.markScan(req, req.params.id, String(req.body?.which || 'pre'), { done: req.body?.done !== false, by: who(req), emails: Array.isArray(req.body?.emails) ? req.body.emails : null })
    res.json({ ...r, scrub: await getScrub(req, req.params.id) })
  } catch (e) { res.status(e.status || 500).json({ error: e.message, preview: e.preview || undefined }) }
})
// 🗄 Archive / resurrect (Mark 2026-10-07). Body { reason } on archive.
router.post('/:id/archive', async (req, res) => {
  try { const { archiveScrub } = await import('../services/scrubStore.js'); const r = await archiveScrub(req, req.params.id, { reason: String(req.body?.reason || ''), by: who(req) }); if (!r.ok) return res.status(404).json(r); res.json(r) }
  catch (e) { res.status(500).json({ error: e.message }) }
})
router.post('/:id/resurrect', async (req, res) => {
  try { const { resurrectScrub } = await import('../services/scrubStore.js'); const r = await resurrectScrub(req, req.params.id, { by: who(req) }); if (!r.ok) return res.status(404).json(r); res.json(r) }
  catch (e) { res.status(500).json({ error: e.message }) }
})
// 🔁 Full Service for THIS report only (Mark 2026-10-07). Body { override: 'on' | 'off' | '' }.
// The CRM rule is untouched; returns the effective rules so the screen can redraw.
router.post('/:id/full-service-override', async (req, res) => {
  try {
    const ov = String(req.body?.override || '')
    if (!['on', 'off', ''].includes(ov)) return res.status(400).json({ error: "override must be 'on', 'off' or ''" })
    const { setScrubFsOverride } = await import('../services/scrubStore.js')
    const r = await setScrubFsOverride(req, req.params.id, ov, { by: who(req) })
    if (!r.ok) return res.status(404).json(r)
    const fs = await import('../services/fullService.js')
    const s = await getScrub(req, req.params.id)
    const eff = await fs.readFullServiceForScrub(req, s)
    res.json({ ok: true, fs_override: r.fs_override, rules: eff.rules, on: eff.on, collision: eff.collision, set: eff.set, shop_id: eff.shop_id })
  } catch (e) { res.status(500).json({ error: e.message }) }
})
router.get('/:id', async (req, res) => {
  const s = await refreshNissanRules(req, await getScrub(req, req.params.id))
  if (!s) return res.status(404).json({ error: 'not found' })
  res.json(s)
})

export default router
