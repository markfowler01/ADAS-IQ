// Phase 6 enhancements to the jobs workflow:
// - VIN-driven required calibrations auto-lookup
// - Per-job GPS arrival/departure time tracking
// - Calibration Completion Report PDF

import express from 'express'
import catalyst from 'zcatalyst-sdk-node'
import PDFDocument from 'pdfkit'
import { sendEmail, getBranding } from '../services/comms.js'

const router = express.Router()

function getSegment(req) {
  return catalyst.initialize(req).cache().segment()
}

function isNotFound(e) {
  return e?.statusCode === 404 || e?.errorInfo?.statusCode === 404
}

async function cacheSet(segment, key, value) {
  const str = typeof value === 'string' ? value : JSON.stringify(value)
  try { await segment.update(key, str) }
  catch (e) { await segment.put(key, str) }
}

async function cacheGet(segment, key, fallback = null) {
  try {
    const val = await segment.getValue(key)
    return val ? JSON.parse(val) : fallback
  } catch (e) {
    if (isNotFound(e)) return fallback
    throw e
  }
}

async function readJobs(req) {
  const segment = getSegment(req)
  try {
    const meta = await cacheGet(segment, 'adas_jobs_meta', null)
    if (meta && meta.chunks > 0) {
      const parts = await Promise.all(
        Array.from({ length: meta.chunks }, (_, i) =>
          cacheGet(segment, `adas_jobs_chunk_${i}`, [])
        )
      )
      return parts.flat()
    }
    return (await cacheGet(segment, 'adas_jobs', [])) || []
  } catch { return [] }
}

async function writeJobs(req, jobs) {
  const segment = getSegment(req)
  const CHUNK_SIZE = 30
  const chunks = []
  for (let i = 0; i < jobs.length; i += CHUNK_SIZE) {
    chunks.push(jobs.slice(i, i + CHUNK_SIZE))
  }
  if (chunks.length === 0) chunks.push([])
  for (let i = 0; i < chunks.length; i++) {
    await cacheSet(segment, `adas_jobs_chunk_${i}`, chunks[i])
  }
  await cacheSet(segment, 'adas_jobs_meta', {
    chunks: chunks.length, total: jobs.length,
    updated: new Date().toISOString(),
  })
}

function getUserId(req) { return req.user?.email || req.user?.id || req.user?.name || 'unknown' }
function getUserName(req) { return req.user?.name || req.user?.email || 'Unknown' }

// ── VIN-driven required calibrations ─────────────────────────────────────────

// Load rules from datastore (same pattern as calibrationRules.js)
async function loadAllRules(req) {
  try {
    const app = catalyst.initialize(req)
    const tbl = app.datastore().table('CalibrationRules')
    const rows = await tbl.getAllRows()
    return rows.map(r => {
      const row = r.toJSON ? r.toJSON() : r
      return {
        id: row.ROWID,
        make: row.make || '',
        model: row.model || '',
        year_start: row.year_start || '',
        year_end: row.year_end || '',
        trigger_category: row.trigger_category || '',
        trigger_keywords: row.trigger_keywords || '',
        calibration_name: row.calibration_name || '',
        cal_type: row.cal_type || '',
        required_equipment: row.required_equipment || '',
        justification_template: row.justification_template || '',
        rule_priority: Number(row.rule_priority) || 10,
        enabled: row.enabled !== 'false',
      }
    })
  } catch (e) {
    console.error('[job-enhancements] rules load failed:', e.message)
    return []
  }
}

// Match rules against a job
function matchRules(rules, { make, model, year, damage_points }) {
  const makeLower = (make || '').toLowerCase().trim()
  const modelLower = (model || '').toLowerCase().trim()
  const yearNum = year ? Number(year) : null
  const damageSet = new Set((damage_points || []).map(d => (d || '').toLowerCase().trim()))

  const matched = []
  for (const r of rules) {
    if (!r.enabled) continue
    if (!r.calibration_name) continue

    // Make match (empty = universal)
    if (r.make && r.make.toLowerCase() !== makeLower) continue
    // Model match (empty = any)
    if (r.model && r.model.toLowerCase() !== modelLower) continue
    // Year range
    if (yearNum && r.year_start) {
      const y0 = Number(r.year_start) || 0
      const y1 = Number(r.year_end) || 9999
      if (yearNum < y0 || yearNum > y1) continue
    }

    // Damage trigger
    const triggers = (r.trigger_keywords || '')
      .split(',')
      .map(t => t.toLowerCase().trim())
      .filter(Boolean)
    const catTrigger = (r.trigger_category || '').toLowerCase().trim()

    if (triggers.length > 0 || catTrigger) {
      const hasDamageMatch = [...damageSet].some(dp => {
        if (catTrigger && dp.includes(catTrigger.replace('_', ' '))) return true
        return triggers.some(t => dp.includes(t))
      })
      if (!hasDamageMatch) continue
    }

    matched.push({
      calibration_name: r.calibration_name,
      cal_type: r.cal_type,
      required_equipment: r.required_equipment,
      justification: r.justification_template
        ?.replace(/\{make\}/g, make || '')
        ?.replace(/\{model\}/g, model || '')
        ?.replace(/\{year\}/g, year || ''),
      priority: r.rule_priority,
      rule_id: r.id,
    })
  }

  // Dedupe by calibration_name (keep highest priority)
  const byName = new Map()
  for (const m of matched) {
    if (!byName.has(m.calibration_name)
        || byName.get(m.calibration_name).priority < m.priority) {
      byName.set(m.calibration_name, m)
    }
  }

  return Array.from(byName.values()).sort((a, b) => b.priority - a.priority)
}

// Lookup required calibrations for a vehicle + damage list
router.post('/required-calibrations', async (req, res) => {
  try {
    const { make, model, year, damage_points, vin } = req.body
    const rules = await loadAllRules(req)
    const matched = matchRules(rules, { make, model, year, damage_points })
    res.json({
      vin,
      vehicle: { year, make, model },
      damage_points: damage_points || [],
      required: matched,
      total_matched: matched.length,
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Auto-populate required calibrations on an existing job
router.post('/:id/auto-populate-calibrations', async (req, res) => {
  try {
    const jobs = await readJobs(req)
    const job = jobs.find(j => j.id === req.params.id)
    if (!job) return res.status(404).json({ error: 'Not found' })

    const rules = await loadAllRules(req)
    const matched = matchRules(rules, {
      make: job.make, model: job.model, year: job.year,
      damage_points: job.damage_points || [],
    })

    // Preserve any calibrations already on the job, just append new ones
    const existing = Array.isArray(job.calibrations) ? job.calibrations : []
    const existingNames = new Set(existing.map(c =>
      (typeof c === 'string' ? c : c.name || '').toLowerCase().trim()))

    const added = []
    for (const m of matched) {
      if (!existingNames.has(m.calibration_name.toLowerCase().trim())) {
        existing.push({
          name: m.calibration_name,
          cal_type: m.cal_type,
          auto_added: true,
          rule_id: m.rule_id,
          justification: m.justification,
        })
        added.push(m.calibration_name)
      }
    }

    job.calibrations = existing
    job.updated_at = new Date().toISOString()
    await writeJobs(req, jobs)

    res.json({ job, added, total_calibrations: existing.length })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── Per-job GPS time tracking ────────────────────────────────────────────────

// Lookup the billing contact email for notifications (prefers billing_rules contact)
async function getShopEmail(req, job) {
  if (!job.crm_shop_id && !job.shop_name) return null
  try {
    const app = catalyst.initialize(req)
    const tbl = app.datastore().table('CRMShops')
    const rows = await tbl.getAllRows()
    const shops = rows.map(r => {
      const row = r.toJSON ? r.toJSON() : r
      try { if (typeof row.billing_rules === 'string') row.billing_rules = JSON.parse(row.billing_rules) } catch {}
      return row
    })
    const shop = (job.crm_shop_id && shops.find(s => s.ROWID === job.crm_shop_id))
      || shops.find(s => (s.shop_name || '').toLowerCase() === (job.shop_name || '').toLowerCase())
    if (!shop) return null
    return shop.billing_rules?.billing_contact_email || shop.email || null
  } catch { return null }
}

// Tech arrives on-site
router.post('/:id/arrive', async (req, res) => {
  try {
    const jobs = await readJobs(req)
    const job = jobs.find(j => j.id === req.params.id)
    if (!job) return res.status(404).json({ error: 'Not found' })

    job.arrived_at = new Date().toISOString()
    job.arrived_location = req.body?.location || null
    job.arrived_by = getUserName(req)
    job.status = 'in_progress'
    await writeJobs(req, jobs)

    // Fire-and-forget notification to the shop
    if (req.body?.notify !== false) {
      getShopEmail(req, job).then(async email => {
        if (!email) return
        const branding = await getBranding(req)
        const vehicle = [job.year, job.make, job.model].filter(Boolean).join(' ') || 'the vehicle'
        await sendEmail(req, {
          to: email,
          subject: `[${branding.company_name}] Tech arrived — ${vehicle}${job.ro_number ? ` (RO# ${job.ro_number})` : ''}`,
          category: 'job_status_arrived',
          related_id: job.id,
          body: `
            <div style="font-family:system-ui,sans-serif;max-width:560px;padding:24px;">
              <div style="background:${branding.primary_color};color:white;padding:14px 20px;border-radius:8px;margin-bottom:16px;">
                <strong style="font-size:16px;">${branding.company_name}</strong>
              </div>
              <p>Hi,</p>
              <p>Our technician ${job.technician || job.arrived_by} just arrived at <strong>${job.shop_name}</strong>
                 for ${vehicle}${job.ro_number ? ` (RO# ${job.ro_number})` : ''}.</p>
              <p>We'll send another update when the calibration is complete.</p>
              <p style="color:#888;font-size:13px;margin-top:24px;">— ${branding.email_signature}<br>${branding.website}</p>
            </div>
          `,
        }).catch(e => console.warn('[arrive notify] failed:', e.message))
      })
    }
    res.json(job)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Tech leaves on-site
router.post('/:id/depart', async (req, res) => {
  try {
    const jobs = await readJobs(req)
    const job = jobs.find(j => j.id === req.params.id)
    if (!job) return res.status(404).json({ error: 'Not found' })

    job.departed_at = new Date().toISOString()
    job.departed_location = req.body?.location || null

    if (job.arrived_at) {
      const onsiteMs = new Date(job.departed_at).getTime() - new Date(job.arrived_at).getTime()
      job.onsite_minutes = Math.round(onsiteMs / 60000)
    }

    await writeJobs(req, jobs)

    // Notify shop that calibration is complete
    if (req.body?.notify !== false) {
      getShopEmail(req, job).then(async email => {
        if (!email) return
        const branding = await getBranding(req)
        const vehicle = [job.year, job.make, job.model].filter(Boolean).join(' ') || 'the vehicle'
        const cals = Array.isArray(job.calibrations)
          ? job.calibrations.map(c => typeof c === 'string' ? c : c.name).filter(Boolean)
          : []
        await sendEmail(req, {
          to: email,
          subject: `[${branding.company_name}] Calibration complete — ${vehicle}${job.ro_number ? ` (RO# ${job.ro_number})` : ''}`,
          category: 'job_status_complete',
          related_id: job.id,
          body: `
            <div style="font-family:system-ui,sans-serif;max-width:560px;padding:24px;">
              <div style="background:${branding.primary_color};color:white;padding:14px 20px;border-radius:8px;margin-bottom:16px;">
                <strong style="font-size:16px;">${branding.company_name}</strong>
              </div>
              <p>Hi,</p>
              <p>The calibration on ${vehicle}${job.ro_number ? ` (RO# ${job.ro_number})` : ''}
                 at <strong>${job.shop_name}</strong> is complete.</p>
              ${cals.length > 0 ? `<p><strong>Calibrations performed:</strong></p>
                <ul style="color:#555;">${cals.map(c => `<li>${c}</li>`).join('')}</ul>` : ''}
              <p>The invoice will follow shortly. Thanks for the work!</p>
              <p style="color:#888;font-size:13px;margin-top:24px;">— ${branding.email_signature}<br>${branding.website}</p>
            </div>
          `,
        }).catch(e => console.warn('[depart notify] failed:', e.message))
      })
    }
    res.json(job)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Send pre-calibration prep sheet (manual, for scheduled future jobs)
router.post('/:id/send-prep-sheet', async (req, res) => {
  try {
    const jobs = await readJobs(req)
    const job = jobs.find(j => j.id === req.params.id)
    if (!job) return res.status(404).json({ error: 'Not found' })

    const email = await getShopEmail(req, job)
    if (!email) return res.status(400).json({ error: 'No shop email on file' })

    const branding = await getBranding(req)
    const vehicle = [job.year, job.make, job.model].filter(Boolean).join(' ') || 'the vehicle'
    const cals = Array.isArray(job.calibrations)
      ? job.calibrations.map(c => typeof c === 'string' ? c : c.name).filter(Boolean)
      : []
    const scheduled = job.scheduled_date
      ? new Date(job.scheduled_date).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })
      : 'the scheduled date'

    await sendEmail(req, {
      to: email,
      subject: `[${branding.company_name}] Prep sheet: ${vehicle} on ${scheduled}`,
      category: 'prep_sheet',
      related_id: job.id,
      body: `
        <div style="font-family:system-ui,sans-serif;max-width:560px;padding:24px;">
          <div style="background:${branding.primary_color};color:white;padding:14px 20px;border-radius:8px;margin-bottom:16px;">
            <strong style="font-size:16px;">${branding.company_name}</strong> — Calibration Prep Sheet
          </div>
          <p>Hi,</p>
          <p>We're scheduled to calibrate <strong>${vehicle}</strong>${job.ro_number ? ` (RO# ${job.ro_number})` : ''}
             at your shop on ${scheduled}.</p>
          ${cals.length > 0 ? `<p><strong>Calibrations planned:</strong></p>
            <ul style="color:#555;">${cals.map(c => `<li>${c}</li>`).join('')}</ul>` : ''}
          <p><strong>Please ensure before arrival:</strong></p>
          <ul style="color:#555;">
            <li>Tire pressure set to placard specification (all 4 tires)</li>
            <li>Vehicle is at ride height (no weight in cargo areas, fuel at least ¼ tank)</li>
            <li>Windshield fully installed and cured (if applicable)</li>
            <li>Clear bay of at least 15' × 25' with no reflective surfaces</li>
            <li>12V supply available if battery voltage is low</li>
            <li>Wheel alignment is within spec (critical for radar calibrations)</li>
          </ul>
          <p>Unprepared vehicles cost us a dispatch trip and delay your customer — thanks for the prep!</p>
          <p style="color:#888;font-size:13px;margin-top:24px;">— ${branding.email_signature}<br>${branding.website}</p>
        </div>
      `,
    })
    res.json({ ok: true, sent_to: email })
  } catch (e) {
    console.error('[prep-sheet]', e.message)
    res.status(500).json({ error: e.message })
  }
})

// ── Record declined calibrations on a job ────────────────────────────────────
// (separate from /api/declined which logs events — this updates the job itself)

router.post('/:id/declined-calibration', async (req, res) => {
  try {
    const jobs = await readJobs(req)
    const job = jobs.find(j => j.id === req.params.id)
    if (!job) return res.status(404).json({ error: 'Not found' })

    const entry = {
      id: `dec_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      calibration_name: req.body.calibration_name,
      recommended_price: Number(req.body.recommended_price) || 0,
      decline_reason: req.body.decline_reason || '',
      decline_code: req.body.decline_code || 'other',
      logged_at: new Date().toISOString(),
      logged_by: getUserName(req),
    }
    job.declined_calibrations = Array.isArray(job.declined_calibrations)
      ? job.declined_calibrations : []
    job.declined_calibrations.push(entry)
    await writeJobs(req, jobs)

    // Also mirror to the /api/declined log for reporting
    try {
      const segment = getSegment(req)
      const log = (await cacheGet(segment, 'declined_calibrations', [])) || []
      log.unshift({
        id: entry.id,
        job_id: job.id,
        shop_name: job.shop_name,
        crm_shop_id: job.crm_shop_id,
        calibration_name: entry.calibration_name,
        recommended_price: entry.recommended_price,
        decline_reason: entry.decline_reason,
        decline_code: entry.decline_code,
        vehicle: { year: job.year, make: job.make, model: job.model },
        ro_number: job.ro_number,
        logged_by_name: entry.logged_by,
        created_at: entry.logged_at,
      })
      await cacheSet(segment, 'declined_calibrations', log.slice(0, 2000))
    } catch { /* noop */ }

    res.json({ ok: true, entry, job })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── Calibration Completion Report PDF ────────────────────────────────────────

router.get('/:id/completion-report', async (req, res) => {
  try {
    const jobs = await readJobs(req)
    const job = jobs.find(j => j.id === req.params.id)
    if (!job) return res.status(404).json({ error: 'Not found' })

    const segment = getSegment(req)
    const branding = await cacheGet(segment, 'adas_iq_branding', {}) || {}
    const companyName = branding.company_name || 'Absolute ADAS'
    const website = branding.website || 'absoluteadas.com'
    const phone = branding.phone || ''
    const primaryColor = branding.primary_color || '#CD4419'
    const footerText = branding.invoice_footer || 'Thank you for your business!'

    const doc = new PDFDocument({ size: 'LETTER', margin: 50 })
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition',
      `attachment; filename="calibration-report-${job.ro_number || job.id.slice(-8)}.pdf"`)
    doc.pipe(res)

    // Header
    doc.rect(0, 0, 612, 90).fill(primaryColor)
    doc.fillColor('white').fontSize(22).text(companyName.toUpperCase(), 50, 28)
    doc.fontSize(10).text(`${website}${phone ? ` · ${phone}` : ''}`, 50, 56)
    doc.fontSize(14).text('CALIBRATION', 430, 22, { width: 130, align: 'right' })
    doc.text('COMPLETION REPORT', 430, 38, { width: 130, align: 'right' })

    // Job summary block
    let y = 120
    doc.fillColor('black').fontSize(11).font('Helvetica-Bold').text('Job Details', 50, y)
    y += 18
    doc.font('Helvetica').fontSize(10).fillColor('#555')

    const leftCol = [
      ['Shop:', job.shop_name || '—'],
      ['RO#:', job.ro_number || '—'],
      ['Insurer:', job.insurer || '—'],
    ]
    const rightCol = [
      ['Vehicle:', [job.year, job.make, job.model].filter(Boolean).join(' ') || '—'],
      ['VIN:', job.vin || '—'],
      ['Technician:', job.technician || '—'],
    ]
    for (let i = 0; i < Math.max(leftCol.length, rightCol.length); i++) {
      if (leftCol[i]) {
        doc.fillColor('#888').text(leftCol[i][0], 50, y, { width: 60, continued: true })
        doc.fillColor('black').text(' ' + leftCol[i][1], { width: 240 })
      }
      if (rightCol[i]) {
        doc.fillColor('#888').text(rightCol[i][0], 320, y, { width: 70, continued: true })
        doc.fillColor('black').text(' ' + rightCol[i][1], { width: 220 })
      }
      y += 16
    }

    y += 5
    doc.moveTo(50, y).lineTo(562, y).stroke('#e5e7eb')
    y += 15

    // Timing
    doc.font('Helvetica-Bold').fontSize(11).fillColor('black').text('On-Site Timing', 50, y)
    y += 18
    doc.font('Helvetica').fontSize(10)
    const fmtDT = iso => iso ? new Date(iso).toLocaleString() : '—'
    doc.fillColor('#888').text('Arrived:', 50, y, { width: 70, continued: true })
    doc.fillColor('black').text(' ' + fmtDT(job.arrived_at), { width: 240 })
    doc.fillColor('#888').text('Departed:', 320, y, { width: 70, continued: true })
    doc.fillColor('black').text(' ' + fmtDT(job.departed_at), { width: 240 })
    y += 16
    if (job.onsite_minutes) {
      const h = Math.floor(job.onsite_minutes / 60), m = job.onsite_minutes % 60
      doc.fillColor('#888').text('Duration:', 50, y, { width: 70, continued: true })
      doc.fillColor('black').text(` ${h}h ${m}m on-site`, { width: 240 })
      y += 16
    }
    if (job.arrived_location?.lat) {
      doc.fillColor('#888').fontSize(8).text(
        `GPS: ${job.arrived_location.lat.toFixed(5)}, ${job.arrived_location.lng.toFixed(5)}`,
        50, y
      )
      y += 12
    }

    y += 5
    doc.moveTo(50, y).lineTo(562, y).stroke('#e5e7eb')
    y += 15

    // Calibrations performed
    doc.font('Helvetica-Bold').fontSize(11).fillColor('black').text('Calibrations Performed', 50, y)
    y += 18
    doc.font('Helvetica').fontSize(10)
    const cals = Array.isArray(job.calibrations) ? job.calibrations : []
    if (cals.length === 0) {
      doc.fillColor('#888').text('No calibrations recorded.', 50, y)
      y += 14
    } else {
      for (const c of cals) {
        const name = typeof c === 'string' ? c : (c.name || c.description || 'Calibration')
        const type = typeof c === 'object' ? c.cal_type : ''
        doc.fillColor('black').text(`✓ ${name}${type ? ` (${type})` : ''}`, 70, y, { width: 480 })
        y += 14
        if (typeof c === 'object' && c.justification) {
          doc.fillColor('#888').fontSize(8).text(`    ${c.justification}`, 70, y, { width: 480 })
          doc.fontSize(10)
          y += 11
        }
        if (y > 700) { doc.addPage(); y = 50 }
      }
    }

    // Declined calibrations
    const declined = Array.isArray(job.declined_calibrations) ? job.declined_calibrations : []
    if (declined.length > 0) {
      y += 10
      doc.font('Helvetica-Bold').fontSize(11).fillColor('#b91c1c')
        .text('Calibrations Declined by Customer', 50, y)
      y += 18
      doc.font('Helvetica').fontSize(10).fillColor('#555')
      for (const d of declined) {
        doc.fillColor('#555').text(`• ${d.calibration_name}`, 70, y, { continued: true })
        doc.fillColor('#888').text(` — ${d.decline_reason || d.decline_code || 'declined'}`)
        y += 14
        if (y > 700) { doc.addPage(); y = 50 }
      }
    }

    // Photos / documentation
    y += 10
    doc.font('Helvetica-Bold').fontSize(11).fillColor('black').text('Documentation Captured', 50, y)
    y += 18
    doc.font('Helvetica').fontSize(10)
    const photoCount = Array.isArray(job.photos) ? job.photos.length : 0
    doc.fillColor('#555').text(`Photos: ${photoCount}`, 50, y)
    y += 14
    if (job.prescan_url) {
      doc.text(`Pre-scan: attached`, 50, y)
      y += 14
    }
    if (job.postscan_url) {
      doc.text(`Post-scan: attached`, 50, y)
      y += 14
    }

    // Notes
    if (job.notes && job.notes.trim()) {
      y += 10
      doc.font('Helvetica-Bold').fontSize(11).fillColor('black').text('Notes', 50, y)
      y += 18
      doc.font('Helvetica').fontSize(10).fillColor('#555')
        .text(job.notes, 50, y, { width: 500 })
      y += 40
    }

    // Warranty footer
    if (y > 650) { doc.addPage(); y = 50 }
    y = 700
    doc.moveTo(50, y).lineTo(562, y).stroke('#e5e7eb')
    y += 10
    doc.fontSize(8).fillColor('#888').text(
      `This calibration was performed to OEM specifications. Carries a 90-day workmanship warranty.`,
      50, y, { width: 500, align: 'center' }
    )
    y += 12
    doc.text(`${footerText} · ${companyName} · ${website}`, 50, y,
      { width: 500, align: 'center' })

    doc.end()
  } catch (e) {
    console.error('[completion-report]', e.message)
    if (!res.headersSent) res.status(500).json({ error: e.message })
  }
})

export default router
