/**
 * ADAS IQ — Batch Job Aid Rule Importer
 * Reads all relevant PDFs from the R&D folder, extracts calibration rules,
 * and saves them directly to the AdasCalibrationRules database.
 *
 * Run: node scripts/batch-import-rules.mjs
 */

import fs from 'fs'
import path from 'path'
import Anthropic from '@anthropic-ai/sdk'
import crypto from 'crypto'

// ── Config ────────────────────────────────────────────────────────────────────

const RD_DIR = '/Users/marks/Documents/AA /9.  Research & Development (R&D)'
const API_BASE = 'https://adas-iq-904191467.development.catalystserverless.com/server/adasiq-api'
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
const SESSION_SECRET = process.env.SESSION_SECRET
if (!ANTHROPIC_API_KEY || !SESSION_SECRET) {
  console.error('Missing ANTHROPIC_API_KEY or SESSION_SECRET env vars')
  process.exit(1)
}
const MAX_FILE_SIZE_MB = 15  // Skip files larger than this
const DELAY_MS = 2000         // Delay between API calls to avoid rate limits

// Folders to skip — not relevant for calibration rules
const SKIP_FOLDERS = [
  'Clings',
  'Vans',
  'Autel tool order',
  'Cool Tools',
  'Equipment',
  'Insurance Docs',
  'CAS Catalog',
]

// ── Auth token ─────────────────────────────────────────────────────────────────

function makeToken() {
  const payload = Buffer.from(JSON.stringify({
    user: { name: 'BatchImport', email: 'mark@absoluteadas.com' },
    exp: Date.now() + 24 * 60 * 60 * 1000,
  })).toString('base64url')
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url')
  return `${payload}.${sig}`
}

const AUTH_TOKEN = makeToken()

// ── Rule extraction prompt ─────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are ADAS IQ's rule extraction engine. You read automotive documents — OEM position statements, ADAS calibration guides, I-CAR materials, collision repair job aids, service bulletins, or any industry reference material — and extract structured calibration trigger rules from them.

For each rule you find, identify:
- calibration_name: the ADAS system requiring calibration (e.g. "Pre-Collision System / Front Radar")
- cal_type: "Static", "Dynamic", or "Static/Dynamic" — if not specified, use "Static"
- trigger_category: one of WINDSHIELD, FRONT_BUMPER, FRONT_SUSPENSION, HEADLIGHTS, REAR_BUMPER, QUARTER_PANEL, MIRROR, REAR_CAMERA, PARKING_SENSORS, SURROUND_VIEW, BATTERY, or OTHER
- trigger_keywords: comma-separated list of repair operations or components that trigger this calibration
- required_equipment: comma-separated list of ADAS systems the vehicle must be equipped with (leave empty if applies to all vehicles)
- make: vehicle make if make-specific (e.g. "Toyota"), or leave empty for universal rules
- model: vehicle model — leave empty if applies to all models of that make
- year_start: earliest model year — leave empty if unknown or universal
- year_end: latest model year — leave empty if ongoing
- justification_template: professional 2-3 sentence justification for an insurance estimate. Use {make} and {model} as placeholders. Reference OEM position statements.
- source: always "JOB_AID"
- notes: additional context, caveats, or source reference from the document

RULES:
- Only extract rules where a specific repair operation triggers a calibration requirement
- Do not include rules about airbags, seatbelts, SRS, structural repairs, or non-ADAS items
- Focus on: cameras, radar, lidar, ultrasonic sensors, steering angle sensors, headlights, and ADAS-related calibrations
- If the document has no ADAS calibration content, return an empty array []
- Extract as many distinct rules as possible

Return ONLY a raw JSON array. No explanation, no markdown fences, no wrapper object.`

// ── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

function shouldSkip(filePath) {
  return SKIP_FOLDERS.some(folder => filePath.includes(folder))
}

function getAllPdfs(dir) {
  const results = []
  function walk(d) {
    try {
      const entries = fs.readdirSync(d, { withFileTypes: true })
      for (const entry of entries) {
        const full = path.join(d, entry.name)
        if (entry.isDirectory()) {
          walk(full)
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.pdf')) {
          if (!shouldSkip(full)) {
            const stats = fs.statSync(full)
            const sizeMB = stats.size / (1024 * 1024)
            if (sizeMB <= MAX_FILE_SIZE_MB) {
              results.push({ path: full, sizeMB: sizeMB.toFixed(1) })
            } else {
              console.log(`  ⏭  SKIPPING (too large ${sizeMB.toFixed(1)}MB): ${path.basename(full)}`)
            }
          }
        }
      }
    } catch (e) {
      console.warn(`  ⚠️  Cannot read dir: ${d}`)
    }
  }
  walk(dir)
  return results
}

async function extractRules(pdfPath) {
  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY })
  const base64Pdf = fs.readFileSync(pdfPath).toString('base64')

  const message = await client.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: base64Pdf },
        },
        {
          type: 'text',
          text: 'Extract all ADAS calibration trigger rules from this document. Return a raw JSON array only.',
        },
      ],
    }],
  })

  const raw = message.content[0].text.trim()
  const cleaned = raw.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim()

  try {
    const rules = JSON.parse(cleaned)
    return Array.isArray(rules) ? rules : []
  } catch {
    return []
  }
}

async function saveRule(rule) {
  const res = await fetch(`${API_BASE}/api/calibration-rules`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Auth-Token': AUTH_TOKEN,
    },
    body: JSON.stringify({ ...rule, source: 'JOB_AID', enabled: 'true' }),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Save failed: ${err}`)
  }
  return res.json()
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🔍 Scanning R&D folder for PDFs...')
  const pdfs = getAllPdfs(RD_DIR)
  console.log(`📚 Found ${pdfs.length} PDFs to process (skipping large files and irrelevant folders)\n`)

  const log = []
  let totalRules = 0
  let filesWithRules = 0
  let errors = 0

  for (let i = 0; i < pdfs.length; i++) {
    const { path: pdfPath, sizeMB } = pdfs[i]
    const name = path.basename(pdfPath)
    const relPath = pdfPath.replace(RD_DIR + '/', '')

    console.log(`[${i + 1}/${pdfs.length}] Processing: ${name} (${sizeMB}MB)`)

    try {
      const rules = await extractRules(pdfPath)

      if (rules.length === 0) {
        console.log(`  → no ADAS rules found`)
        log.push({ file: relPath, rules: 0, status: 'no_rules' })
      } else {
        let saved = 0
        for (const rule of rules) {
          try {
            await saveRule(rule)
            saved++
            console.log(`  ✅ Saved: ${rule.calibration_name}`)
          } catch (e) {
            console.warn(`  ⚠️  Save failed for "${rule.calibration_name}": ${e.message}`)
          }
        }
        console.log(`  → ${saved} rule(s) saved`)
        log.push({ file: relPath, rules: saved, status: 'ok', calibrations: rules.map(r => r.calibration_name) })
        totalRules += saved
        filesWithRules++
      }
    } catch (e) {
      console.log(`  ❌ Error: ${e.message?.slice(0, 120)}`)
      log.push({ file: relPath, rules: 0, status: 'error', error: e.message })
      errors++
    }

    // Delay between calls
    if (i < pdfs.length - 1) await sleep(DELAY_MS)
  }

  // Summary
  console.log('\n' + '═'.repeat(60))
  console.log(`✅ COMPLETE`)
  console.log(`   PDFs processed:    ${pdfs.length}`)
  console.log(`   Files with rules:  ${filesWithRules}`)
  console.log(`   Total rules saved: ${totalRules}`)
  console.log(`   Errors:            ${errors}`)
  console.log('═'.repeat(60))

  // Write log
  const logPath = '/Users/marks/Documents/adas-iq/scripts/batch-import-log.json'
  fs.writeFileSync(logPath, JSON.stringify(log, null, 2))
  console.log(`\n📋 Full log saved to: ${logPath}`)
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
