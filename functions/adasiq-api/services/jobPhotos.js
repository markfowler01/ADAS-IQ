// Job photo set (Mark 2026-09-08): every job folder carries the two PDFs
// plus a required photo set before the job can go Ready to Invoice.
//
//   1-4  four corners of the car (LF, RF, LR, RR)
//   5    VIN plate
//   6    odometer BEFORE the test drive
//   7    odometer AFTER the test drive   (after − before must be > 1.0 mi)
//   8    calibration setup (at least one, up to 10)
//
// Slots live on the Jobs row as `photo_slots` JSON:
//   { lf:{fileId,name,at}, rf:…, lr:…, rr:…, vin:…, odo_before:…,
//     odo_after:…, setup:[{fileId,name,at}, …] }
// Miles live on `odo_before` / `odo_after` (strings, tech-editable).
//
// Files land in the job's WorkDrive folder named so the folder reads
// itself: "01 LF corner · <RO>.jpg", "06 Odo before · <RO>.jpg", …
import Anthropic from '@anthropic-ai/sdk'

export const SLOTS = [
  { key: 'lf',         n: 1, label: 'Left front corner',      file: 'LF corner',   hint: 'Stand at the left headlight, get the whole car in.' },
  { key: 'rf',         n: 2, label: 'Right front corner',     file: 'RF corner',   hint: 'Same shot from the right headlight.' },
  { key: 'lr',         n: 3, label: 'Left rear corner',       file: 'LR corner',   hint: 'Left tail light, whole car in.' },
  { key: 'rr',         n: 4, label: 'Right rear corner',      file: 'RR corner',   hint: 'Right tail light, whole car in.' },
  { key: 'vin',        n: 5, label: 'VIN plate',              file: 'VIN plate',   hint: 'Door-jamb sticker or dash plate, straight on.' },
  { key: 'odo_before', n: 6, label: 'Odometer — before drive', file: 'Odo before', hint: 'Dash on, miles readable.' },
  { key: 'odo_after',  n: 7, label: 'Odometer — after drive',  file: 'Odo after',  hint: 'After the test drive. Needs more than 1 mile.' },
  { key: 'setup',      n: 8, label: 'Calibration setup',      file: 'Setup',       hint: 'Targets, rig, tablet — snap as many as you want.', multi: true },
]
export const MIN_TEST_DRIVE_MILES = 1.0
export const MAX_SETUP_PHOTOS = 10
// Gate applies to jobs created from this PT date on (Mark: jobs already
// in progress at go-live aren't blocked).
export const PHOTO_GATE_FROM = '2026-09-09'

export function parseSlots(raw) {
  if (!raw) return { setup: [] }
  try {
    const o = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!o || typeof o !== 'object') return { setup: [] }
    if (!Array.isArray(o.setup)) o.setup = o.setup ? [o.setup] : []
    return o
  } catch { return { setup: [] } }
}

export function milesOf(v) {
  const n = parseFloat(String(v ?? '').replace(/[^\d.]/g, ''))
  return Number.isFinite(n) ? n : null
}

export function photoProgress(job) {
  const slots = parseSlots(job?.photo_slots)
  const missing = []
  let filled = 0
  for (const s of SLOTS) {
    const ok = s.multi ? (slots.setup || []).length > 0 : !!slots[s.key]?.fileId
    if (ok) filled++
    else missing.push(s.key)
  }
  const before = milesOf(job?.odo_before)
  const after = milesOf(job?.odo_after)
  const delta = before != null && after != null ? Math.round((after - before) * 10) / 10 : null
  const milesOk = delta != null && delta > MIN_TEST_DRIVE_MILES
  const problems = [...missing]
  if (!missing.includes('odo_before') && !missing.includes('odo_after') && !milesOk) problems.push('miles')
  return {
    filled, total: SLOTS.length, missing, setupCount: (slots.setup || []).length,
    miles: { before, after, delta, ok: milesOk, min: MIN_TEST_DRIVE_MILES },
    complete: missing.length === 0 && milesOk,
    problems,
  }
}

// Mark 2026-09-10: "if the technician clicks ready to invoice and all
// eight pictures are not there I want to queue the pictures" — every job,
// no start date. (PHOTO_GATE_FROM kept for reference only.)
export function gateApplies() { return true }

export function slotLabel(key) { return SLOTS.find(s => s.key === key)?.label || key }

export function fileNameFor(slotKey, job, idx = 0, mime = 'image/jpeg') {
  const s = SLOTS.find(x => x.key === slotKey)
  const ext = (mime.split('/')[1] || 'jpg').replace('jpeg', 'jpg')
  const ro = job?.quote_number || job?.invoice_number || job?.ro_number || ''
  const n = String(s?.n || 9).padStart(2, '0')
  const part = s?.multi ? `${s.file} ${idx + 1}` : (s?.file || slotKey)
  return `${n} ${part}${ro ? ` · ${ro}` : ''}.${ext}`
}

export function describeMissing(progress) {
  const out = progress.missing.map(slotLabel)
  if (progress.problems.includes('miles')) {
    const d = progress.miles.delta
    out.push(d == null ? 'test-drive miles' : `test drive only ${d} mi (need more than ${MIN_TEST_DRIVE_MILES})`)
  }
  return out
}

// One Haiku call: which slot is this photo, and if it's an odometer,
// what does it read. Used when the tech shoots in any order / picks
// from the camera roll, and to read miles on odo slots.
export async function classifyPhoto(buffer, mimeType, { wantSlot = true } = {}) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const msg = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 200,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mimeType || 'image/jpeg', data: buffer.toString('base64') } },
        { type: 'text', text:
          `This is a photo taken by an ADAS calibration technician at a body shop. Classify it into exactly one category:\n` +
          `- "lf": exterior of the car shot from the LEFT FRONT corner (driver-side headlight visible, whole car)\n` +
          `- "rf": exterior from the RIGHT FRONT corner\n` +
          `- "lr": exterior from the LEFT REAR corner\n` +
          `- "rr": exterior from the RIGHT REAR corner\n` +
          `- "vin": a VIN plate / door-jamb sticker / VIN barcode label\n` +
          `- "odometer": an instrument cluster / dash showing the odometer mileage\n` +
          `- "setup": calibration equipment — targets, radar reflector, rig, frame, scan tool / tablet screen, doppler simulator\n` +
          `- "unknown": none of the above\n` +
          `US-market cars: the LEFT side is the driver side. If the photo shows the odometer, also read the total mileage as a number (ignore trip meters).\n` +
          `Return ONLY raw JSON: {"slot":"<category>","miles":<number or null>,"confidence":<0-1>}` },
      ],
    }],
  })
  const raw = String(msg.content?.[0]?.text || '').trim().replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim()
  try {
    const p = JSON.parse(raw)
    return { slot: String(p.slot || 'unknown'), miles: Number.isFinite(Number(p.miles)) ? Number(p.miles) : null, confidence: Number(p.confidence) || 0 }
  } catch { return { slot: 'unknown', miles: null, confidence: 0 } }
}
