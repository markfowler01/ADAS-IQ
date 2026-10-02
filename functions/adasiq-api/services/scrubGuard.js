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

import { tracked } from './spend.js'
const client = () => tracked(new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }))

// Makes whose statements require radar aiming after ANY front bumper removal
// AND whose front radar is standard on 2018+. BMW/MINI are deliberately not
// here: the radar is optional on many models (a base i3 has none) and the
// scrub lists a not-required radar row either way, so the guard cannot tell
// 'no radar' from 'radar untouched'. BMW stays a judgment call in the prompt.
const AIM_AFTER_BUMPER = /toyota|lexus|honda|acura|nissan|infiniti|hyundai|kia|genesis|mercedes|ford|lincoln/i   // Ford/Lincoln added 2026-10-02 (ADAS Integrity statement May 2026: fascia R&I = ADAS-related repair)   // Toyota added 2026-09-29 (Corolla miss)
// Makes that always carry a surround-view camera in the inventory (2019+ or 2022+ Hyundai/Kia).
const ALWAYS_AVC = /mercedes|bmw|audi|porsche|volvo|land rover|range rover|genesis|lexus/i
const AVC_KIA = /hyundai|kia/i
// Makes that need an SAS reset after a battery disconnect. Mark 2026-10-01:
// "steering angle sensors need to be calibrated after any alignment and for
// honda and subaru any battery disconnect" — only these two (Acura = Honda).
const SAS_AFTER_BATTERY = /honda|acura|subaru/i
// Honda/Acura: front passenger weight sensor output check after ANY collision,
// deployed or not (Honda S/I "Front Passenger's Weight Sensor Output Check
// After a Vehicle Collision"; Honda/Acura post-collision position statement).
const SWS_ANY_COLLISION = /honda|acura|mazda/i   // Mazda added 2026-10-02 (Mark: "every mazda in a collision")
// Makes whose statements require the camera after a wheel alignment.
const CAM_AFTER_ALIGN = /./   // Mark 2026-10-02: "yes every alignment" — windshield camera after any alignment, every make (when the car has one)

/** One Haiku read: which lines carry which trigger words. */
export async function triggerLines(base64Pdf, { text = '' } = {}) {
  const msg = await client().messages.create({
    model: 'claude-haiku-4-5', max_tokens: 1200,
    messages: [{ role: 'user', content: [
      text ? { type: 'text', text: `ESTIMATE LINES:\n${text}` } : { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64Pdf } },
      { type: 'text', text: `This is a collision repair estimate. Go through EVERY numbered line on every page, including supplements and sublet lines. For each category below, list the line numbers whose OPERATION or DESCRIPTION matches. Read the operation column carefully: "Repl" / "R&R" = replace, "R&I" = remove and install, "Rpr" = repair, "Blnd" = blend, "Sublet" = outside work.

Categories:
- windshield: the FRONT windshield only — "windshield", "w/shield", "w/s", "windscreen" — and ONLY when the GLASS ITSELF IS REMOVED FROM THE CAR: operation Repl / R&R / R&I, or a glass sublet. The operation column decides this, not the word "windshield". NEVER liftgate glass, back glass, rear window, quarter glass, door glass, mirror glass, sunroof, washer, wiper or molding lines (a rear-hit Odyssey's liftgate glass was counted as a windshield, 2026-09-28)
- windshield_excluded: windshield lines that are NOT a removal, and never justify a calibration — masking or protecting the glass for refinish ("mask windshield", "mask & protect", "cover", "tape", "plastic", typically 0.2–0.5 hrs), chip or rock-chip repair, glass polish or denib, tint, urethane/molding-only lines, cowl, wipers, and "Add for" lines. If the glass stays in the car, it belongs HERE, not in windshield (a masked windshield at 0.3 hrs was billed as a camera calibration, 2026-09-29)
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

Return ONLY JSON: {"windshield":[...],"windshield_excluded":[...],"front_bumper":[...],"rear_bumper":[...],"alignment":[...],"battery":[...],"seat_airbag":[...],"liftgate":[...],"mirror":[...],"radar_sensor":[...],"camera":[...],"headlamp":[...]} with line numbers as strings. Empty arrays when nothing matches. No prose.` },
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
export async function guardScrub(data, base64Pdf, { hitsPromise = null } = {}) {
  const out = { flipped: [], added: [], hits: {} }
  if (!data || !Array.isArray(data.calibrations)) return out
  let hits = {}
  try { hits = await (hitsPromise || triggerLines(base64Pdf)) } catch (e) { out.error = e.message; return out }   // ⚡ usually already running beside the main read
  out.hits = hits
  const cals = data.calibrations
  const make = String(data.make || ''), year = Number(data.year || 0)
  const per = (m, s) => `${m || 'OEM'} OEM position statement and ALLDATA ADAS procedure${s ? ' — ' + s : ''}`

  // 0. Normalise the inventory before any rule fires (Mark, 2026-09-29).
  //    a) Blind spot is ONE calibration for the whole system, billed once —
  //       never a Left row and a Right row (a pair double-billed an Audi).
  //       Merge: required if either side was; sides and line refs kept in
  //       the trigger. The single name is in KINETIC_ALIASES → blind spot item.
  const isBsm = c => /blind.?spot|rear.*radar/i.test(name(c)) && !/front/i.test(name(c))
  const sideOf = c => /left/i.test(name(c)) ? 'left' : /right/i.test(name(c)) ? 'right' : ''
  const bsmRows = cals.filter(isBsm)
  if (bsmRows.length > 1) {
    const on = bsmRows.filter(c => c.enabled === true)
    const sides = [...new Set((on.length ? on : bsmRows).map(sideOf).filter(Boolean))]
    const sideNote = sides.length === 2 ? 'both sides' : sides.length === 1 ? `${sides[0]} side` : ''
    const keep = on[0] || bsmRows[0]
    const refs = [...new Set(bsmRows.flatMap(c => String(c.line_references || '').split(/,\s*/)).filter(Boolean))]
    keep.calibration_name = 'Rear Blind Spot Radar Calibration'
    if (keep.sensor) keep.sensor = 'Rear Blind Spot Radar'
    keep.enabled = on.length > 0
    keep.line_references = refs.join(', ')
    keep.trigger = [keep.trigger || '', sideNote ? `(${sideNote} — one calibration covers both radars)` : ''].filter(Boolean).join(' ')
    for (const c of bsmRows) if (c !== keep) cals.splice(cals.indexOf(c), 1)
    out.merged = [`Rear Blind Spot Radar ← ${bsmRows.length} rows${sideNote ? ' (' + sideNote + ')' : ''}`]
  } else if (bsmRows.length === 1 && sideOf(bsmRows[0])) {
    const c = bsmRows[0], side = sideOf(c)
    c.calibration_name = 'Rear Blind Spot Radar Calibration'
    if (c.sensor) c.sensor = 'Rear Blind Spot Radar'
    c.trigger = [c.trigger || '', `(${side} side — one calibration covers both radars)`].filter(Boolean).join(' ')
  }
  //    b) Toyota / Lexus have no front side radars. Drop the row before
  //       rule 2 can flip it on (a Toyota scrub carried one, 2026-09-29).
  if (/toyota|lexus/i.test(make)) {
    for (let i = cals.length - 1; i >= 0; i--) {
      if (/front side radar|front corner radar|front cross/i.test(name(cals[i]))) {
        out.dropped = out.dropped || []
        out.dropped.push(`${cals[i].calibration_name || name(cals[i])}: Toyota/Lexus have no front side radar`)
        cals.splice(i, 1)
      }
    }
  }

  // 1. Windshield replaced → the camera, always (2015+).
  // Masking/protecting the glass for refinish (0.3 hrs) is NOT a removal — the
  // glass never leaves the car and the camera is never disturbed. This rule is
  // the only one that may ADD a sensor, so a stray "mask windshield" line used
  // to manufacture a whole calibration on its own (Mark, 2026-09-29). Anything
  // the categoriser parked in windshield_excluded can never reach it.
  const wsExcluded = new Set(lines(hits.windshield_excluded))
  const ws = lines(hits.windshield).filter(l => !wsExcluded.has(l))
  if (wsExcluded.size) {
    out.ignored = [...wsExcluded].map(l => `windshield line ${l}: masking / non-removal — glass stays in the car, no calibration`)
  }
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
  // 4a. 🧰 Full Service: any battery disconnect → the power-loss resets (windows, sunroof, liftgate…).
  if (bat.length) {
    require(cals, /battery.?disconnect reset|window|sunroof|moon ?roof/i, 'Battery-Disconnect Resets', 'Reset',
      `Battery disconnect (line${bat.length > 1 ? 's' : ''} ${bat.join(', ')})`, bat,
      `Power-loss initializations required per ${per(make)} after the battery disconnect (line${bat.length > 1 ? 's' : ''} ${bat.join(', ')}): power window auto up/down, sunroof, power liftgate / sliding door and memory settings must be re-initialized or they will not operate as designed.`, out, true)
  }
  // 4b. Honda/Acura/Mazda collision → Seat Weight Sensor check (any damage).
  if (SWS_ANY_COLLISION.test(make)) {
    const sa = lines(hits.seat_airbag)
    const honda = /honda|acura/i.test(make)
    const why = honda
      ? `Front Passenger Weight Sensor output check required per ${per(make, "Honda service information: 'Check the front passenger's weight sensor output after a vehicle collision, regardless if the airbags and seatbelt tensioners deployed or not'")}`
      : `Front passenger seat weight sensor (occupant classification) check required on every ${make} collision repair per ${per(make)}`
    require(cals, /seat weight|occupant|\bods\b|\bocs\b|passenger seat/, 'Seat Weight Sensor', 'Reset',
      sa.length ? `Seat / SRS lines ${sa.join(', ')}; ${make} requires the weight sensor check after any collision` : `In collision: ${make} requires the front passenger weight sensor check after any collision, deployed or not`, sa,
      `${why}${sa.length ? ` (seat/SRS line${sa.length > 1 ? 's' : ''} ${sa.join(', ')}: initialization if the SRS unit, weight sensor, seat frame or rail was replaced or removed)` : ''}. Failure to check presents a safety liability and does not meet ${make} repair standards.`, out, true)
  }
  if (al.length && CAM_AFTER_ALIGN.test(make)) {
    require(cals, /windshield|front camera|lane depart|forward camera/, 'Front Windshield Camera', 'Static/Dynamic',
      `Wheel alignment (line ${al.join(', ')}) — ${make} requires forward camera calibration after alignment`, al,
      `Front Windshield Camera calibration required per ${per(make, 'camera calibration is required after any wheel alignment on this make')} (line${al.length > 1 ? 's' : ''} ${al.join(', ')}). Failure to calibrate presents a safety liability and does not meet ${make || 'OEM'} repair standards.`, out)
  }
  // 5a. 🧰 Full Service: rear bumper removed on a car WITH blind spot, but the OEM
  //     doesn't require the aim (e.g. Honda cover dropped for paint). Mark
  //     2026-10-02: "when full service is selected … Blindspot on everything that
  //     has had the rear bumper removed." Added NOT required here; the shop's Full
  //     Service rule turns it on (We do it / Ask) or drops it (Full Service off).
  {
    const bsm = cals.find(c => /blind.?spot|rear.*radar/i.test(String(c.calibration_name || c.name || '')) && !/front/i.test(String(c.calibration_name || '')))
    if (rb.length && bsm && bsm.enabled !== true && !has(cals, /rear bumper removed/i)) {
      cals.push({ calibration_name: 'Blind Spot Aim (Rear Bumper Removed)', cal_type: 'Static', trigger: `Rear bumper removed (line${rb.length > 1 ? 's' : ''} ${rb.join(', ')})`, line_references: rb.join(', '),
        justification: `Blind spot radar aim recommended after the rear bumper was removed (line${rb.length > 1 ? 's' : ''} ${rb.join(', ')}): the radar's field of view and the bumper cover in front of it were disturbed. Performed as a Full Service verification; the manufacturer's procedure does not require it for a cover removal alone.`,
        enabled: false, _guard: 'full-service' })
      out.added.push(`Blind Spot Aim (Rear Bumper Removed) ← ${rb.join(', ')} (Full Service)`)
    }
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
