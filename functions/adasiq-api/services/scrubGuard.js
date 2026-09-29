// 🛡️ Deterministic guard under the scrubber (benchmark night, 2026-09-28).
//
// The Opus scrub is a judgment call, and judgment varies run to run: the same
// Mercedes SL estimate came back with the front radar required at 22:40 and
// not required at 23:30, on the same prompt. The rules that matter most are
// not judgment calls at all — a replaced windshield means the camera, a
// front bumper off a Mercedes means the radar — so they are enforced here,
// in code, after the scrub.
//
// How: one cheap Haiku pass reads the same PDF and lists every estimate line
// whose operation carries a trigger word, with the line number. That is a
// transcription task, far more stable than a verdict. The hard rules then
// compare those hits with the scrub's verdicts and flip or add what the
// rules require, citing the line. Nothing is ever removed — the guard only
// makes the report safer, never thinner.
import Anthropic from '@anthropic-ai/sdk'

const client = () => new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// Makes whose statements require radar aiming after ANY front bumper removal
// AND whose front radar is standard on 2018+. BMW/MINI are deliberately not
// here: the radar is optional on many models (a base i3 has none) and the
// scrub lists a not-required radar row either way, so the guard cannot tell
// 'no radar' from 'radar untouched'. BMW stays a judgment call in the prompt.
const AIM_AFTER_BUMPER = /honda|acura|nissan|infiniti|hyundai|kia|genesis|mercedes/i
// Makes that always carry a surround-view camera in the inventory (2019+ or 2022+ Hyundai/Kia).
const ALWAYS_AVC = /mercedes|bmw|audi|porsche|volvo|land rover|range rover|genesis|lexus/i
const AVC_KIA = /hyundai|kia/i
// Makes whose statements require SAS zero-point after a battery disconnect.
const SAS_AFTER_BATTERY = /toyota|lexus|honda|acura|subaru|nissan|infiniti|hyundai|kia|mazda|mitsubishi/i
// Makes whose statements require the camera after a wheel alignment.
const CAM_AFTER_ALIGN = /toyota|lexus|subaru|honda|acura|mazda|hyundai|kia|nissan|infiniti/i

/** One Haiku read: which lines carry which trigger words. */
export async function triggerLines(base64Pdf) {
  const msg = await client().messages.create({
    model: 'claude-haiku-4-5', max_tokens: 1200,
    messages: [{ role: 'user', content: [
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64Pdf } },
      { type: 'text', text: `This is a collision repair estimate. Go through EVERY numbered line on every page, including supplements and sublet lines. For each category below, list the line numbers whose OPERATION or DESCRIPTION matches. Read the operation column carefully: "Repl" / "R&R" = replace, "R&I" = remove and install, "Rpr" = repair, "Blnd" = blend, "Sublet" = outside work.

Categories:
- windshield: the FRONT windshield only — "windshield", "w/shield", "w/s", "windscreen" — replaced OR removed-and-installed OR sublet. NEVER liftgate glass, back glass, rear window, quarter glass, door glass, mirror glass, sunroof, washer, wiper or molding lines (a rear-hit Odyssey's liftgate glass was counted as a windshield, 2026-09-28)
- front_bumper: ONLY the front bumper cover / fascia / bumper assembly line itself, replaced OR removed-and-installed — not brackets, grilles, absorbers, lamps, trim or add-for lines (one or two line numbers at most)
- rear_bumper: rear bumper cover / fascia, replaced OR removed-and-installed
- alignment: wheel alignment (labor or sublet), "align", "4 wheel", "steering system reset"
- battery: battery disconnect / D&R / remove and install battery / hybrid battery
- seat_airbag: front passenger seat, seat cushion / track, seat belt, pretensioner, airbag, air bag, SRS
- liftgate: liftgate / tailgate / trunk lid / decklid replaced or removed-and-installed
- mirror: exterior mirror (left or right) replaced or removed-and-installed
- radar_sensor: a line naming a RADAR: "radar", "millimeter wave", "distronic", "ACC sensor", "adaptive cruise sensor". NOT park distance / parking / PDC / ultrasonic / proximity sensors — those are never radar
- camera: any line naming a camera (front, rear, side, surround, 360)
- headlamp: headlamp / headlight assembly replaced or removed-and-installed

Return ONLY JSON: {"windshield":[...],"front_bumper":[...],"rear_bumper":[...],"alignment":[...],"battery":[...],"seat_airbag":[...],"liftgate":[...],"mirror":[...],"radar_sensor":[...],"camera":[...],"headlamp":[...]} with line numbers as strings. Empty arrays when nothing matches. No prose.` },
    ] }],
  })
  const raw = (msg.content || []).map(b => b.text || '').join('').trim()
  try { const m = raw.match(/\{[\s\S]*\}/); return m ? JSON.parse(m[0]) : {} } catch { return {} }
}

const name = c => String(c?.sensor || c?.calibration_name || '').toLowerCase()
const has = (cals, re) => cals.find(c => re.test(name(c)))
const lines = arr => (Array.isArray(arr) ? arr : []).map(String).filter(Boolean)

// `mayAdd`: only the windshield camera may be added when the scrub left it
// out. Everything else is flip-only — the scrub decides what the car HAS, the
// guard only decides a listed sensor's verdict. Without this the guard put a
// front radar and a surround-view camera on a base BMW i3 (2026-09-28).
function require(cals, re, label, calType, trigger, lineRefs, why, out, mayAdd = false) {
  const row = has(cals, re)
  if (row) {
    if (row.enabled === true) return
    row.enabled = true
    row.trigger = trigger; row.line_references = lineRefs.join(', ')
    row.justification = why
    row._guard = 'flipped'
    out.flipped.push(`${label} ← ${lineRefs.join(', ')}`)
  } else if (mayAdd) {
    cals.push({ calibration_name: label, cal_type: calType, trigger, line_references: lineRefs.join(', '), justification: why, enabled: true, _guard: 'added' })
    out.added.push(`${label} ← ${lineRefs.join(', ')}`)
  } else {
    out.skipped = out.skipped || []; out.skipped.push(`${label}: not in the scrub's inventory — left alone`)
  }
}

/**
 * Enforce the hard rules on a finished scrub. Mutates data.calibrations.
 * Returns what it changed so the report can say "guard: …".
 */
export async function guardScrub(data, base64Pdf) {
  const out = { flipped: [], added: [], hits: {} }
  if (!data || !Array.isArray(data.calibrations)) return out
  let hits = {}
  try { hits = await triggerLines(base64Pdf) } catch (e) { out.error = e.message; return out }
  out.hits = hits
  const cals = data.calibrations
  const make = String(data.make || ''), year = Number(data.year || 0)
  const per = (m, s) => `${m || 'OEM'} OEM position statement and ALLDATA ADAS procedure${s ? ' — ' + s : ''}`

  // 1. Windshield replaced → the camera, always (2015+).
  const ws = lines(hits.windshield)
  if (ws.length && (!year || year >= 2015)) {
    require(cals, /windshield|front camera|lane depart|forward camera/, 'Front Windshield Camera', 'Static/Dynamic',
      `Windshield replaced / R&I (line${ws.length > 1 ? 's' : ''} ${ws.join(', ')}) — if equipped, confirm at pre-scan`, ws,
      `Front Windshield Camera calibration required per ${per(make)} following windshield replacement or removal (line${ws.length > 1 ? 's' : ''} ${ws.join(', ')}). The forward camera is bonded to or mounted against the glass and must be re-aimed whenever the windshield is disturbed. Failure to calibrate presents a safety liability and does not meet ${make || 'OEM'} repair standards.`, out, true)
  }
  // 2. Front bumper off on a make that aims after any bumper removal → front radar (+ front side radar row if present).
  const fb = lines(hits.front_bumper), rs = lines(hits.radar_sensor)
  if ((fb.length && AIM_AFTER_BUMPER.test(make)) || rs.length) {
    const ref = (rs.length ? [...new Set(rs)] : [...new Set(fb)]).slice(0, 6)
    require(cals, /^front radar|front radar|distance sensor|distronic|acc radar|pre.?collision radar/, 'Front Radar', 'Static',
      rs.length ? `Radar sensor named on line${rs.length > 1 ? 's' : ''} ${rs.join(', ')}${fb.length ? '; front bumper R&I/Repl line ' + fb.join(', ') : ''}` : `Front bumper R&I/Repl (line${fb.length > 1 ? 's' : ''} ${fb.join(', ')}) — ${make} requires radar aiming after any front bumper removal`, ref,
      `Front Radar calibration required per ${per(make, rs.length ? 'the radar sensor itself is on the estimate' : 'radar aiming is required after any front bumper removal on this make')} (line${ref.length > 1 ? 's' : ''} ${ref.join(', ')}). Failure to calibrate presents a safety liability and does not meet ${make || 'OEM'} repair standards.`, out)
    const side = has(cals, /front side radar|front corner/)
    if (side && side.enabled !== true && fb.length && AIM_AFTER_BUMPER.test(make)) { side.enabled = true; side.trigger = `Front bumper R&I/Repl (line ${fb.join(', ')})`; side.line_references = fb.join(', '); side._guard = 'flipped'; out.flipped.push(`Front Side Radar ← ${fb.join(', ')}`) }
  }
  // 3. Surround-view makes: bumper / mirror / liftgate / camera line → Around View Camera, and never absent from the list.
  const mir = lines(hits.mirror), lg = lines(hits.liftgate), cam = lines(hits.camera), rb = lines(hits.rear_bumper)
  const avcMake = ALWAYS_AVC.test(make) && (!year || year >= 2019) || (AVC_KIA.test(make) && year >= 2022)
  const avcTrig = [...new Set([...mir, ...lg, ...cam, ...fb.slice(0, 3), ...rb.slice(0, 3)])]
  if (avcMake && avcTrig.length) {
    require(cals, /around view|surround|360|bird/, 'Around View Camera', 'Static',
      `Surround-view camera location disturbed (line${avcTrig.length > 1 ? 's' : ''} ${avcTrig.join(', ')}) — if equipped, confirm at pre-scan`, avcTrig,
      `Around View Camera calibration required per ${per(make)}: a bumper, mirror, liftgate or camera operation on this estimate (line${avcTrig.length > 1 ? 's' : ''} ${avcTrig.join(', ')}) disturbs a surround-view camera location on this vehicle. Failure to calibrate presents a safety liability and does not meet ${make || 'OEM'} repair standards.`, out)
  } else if (avcMake && !has(cals, /around view|surround|360|bird/)) {
    cals.push({ calibration_name: 'Around View Camera', cal_type: 'Static', trigger: '', line_references: '', justification: `Not required — no bumper, mirror, liftgate or camera operation on this estimate disturbs a surround-view camera (${make} carries one on most trims; confirm at pre-scan).`, enabled: false, _guard: 'listed' })
  }
  // 4. Alignment → SAS (all makes) and the camera on the makes that require it.
  const al = lines(hits.alignment), bat = lines(hits.battery)
  if (al.length || (bat.length && SAS_AFTER_BATTERY.test(make))) {
    const ref = [...new Set([...al, ...bat])]
    require(cals, /steering angle|\bsas\b/, 'Steering Angle Sensor', 'Reset',
      al.length ? `Wheel alignment (line ${al.join(', ')})` : `Battery disconnect (line ${bat.join(', ')}) — zero-point after power loss on ${make}`, ref,
      `Steering Angle Sensor ${al.length ? 'calibration' : 'zero-point reset'} required per ${per(make)} following ${al.length ? 'wheel alignment' : 'battery disconnect'} (line${ref.length > 1 ? 's' : ''} ${ref.join(', ')}). Failure to calibrate presents a safety liability and does not meet ${make || 'OEM'} repair standards.`, out)
  }
  if (al.length && CAM_AFTER_ALIGN.test(make)) {
    require(cals, /windshield|front camera|lane depart|forward camera/, 'Front Windshield Camera', 'Static/Dynamic',
      `Wheel alignment (line ${al.join(', ')}) — ${make} requires forward camera calibration after alignment`, al,
      `Front Windshield Camera calibration required per ${per(make, 'camera calibration is required after any wheel alignment on this make')} (line${al.length > 1 ? 's' : ''} ${al.join(', ')}). Failure to calibrate presents a safety liability and does not meet ${make || 'OEM'} repair standards.`, out)
  }
  // 5. Liftgate / rear camera line → Back Up Camera.
  if (lg.length || cam.some(l => true) && /rear|back/.test(JSON.stringify(cam))) {
    const ref = [...new Set([...lg])]
    if (ref.length) require(cals, /back ?up|rear view camera|rear camera|reverse camera/, 'Back Up Camera', 'Static/Dynamic',
      `Liftgate / tailgate / trunk lid R&I or Repl (line${ref.length > 1 ? 's' : ''} ${ref.join(', ')})`, ref,
      `Back Up Camera calibration required per ${per(make)} following liftgate, tailgate or trunk lid removal or replacement (line${ref.length > 1 ? 's' : ''} ${ref.join(', ')}); the camera is mounted in that panel and its aim is disturbed. Failure to calibrate presents a safety liability and does not meet ${make || 'OEM'} repair standards.`, out)
  }
  if (out.flipped.length || out.added.length) console.log(`[guard] ${make} ${data.year || ''}: flipped ${out.flipped.length}, added ${out.added.length} — ${[...out.flipped, ...out.added].join(' · ')}`)
  data._guard = { flipped: out.flipped, added: out.added }
  return out
}
