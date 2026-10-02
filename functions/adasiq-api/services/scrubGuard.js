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
const CAM_AFTER_ALIGN = /^(?!.*(honda|acura)).*/i   // every make after an alignment (Mark 2026-10-02) EXCEPT Honda/Acura: Honda's job aid + ALLDATA say camera/radar are NOT required after an alignment

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
- rear_bumper_rpr: rear bumper cover / fascia REPAIRED (Rpr, body labor on the cover itself — not refinish or blend only)
- alignment: wheel alignment (labor or sublet), "align", "4 wheel", "steering system reset"
- battery: battery disconnect / D&R / remove and install battery / hybrid battery
- seat_airbag: front passenger seat, seat cushion / track, seat belt, pretensioner, airbag, air bag, SRS
- liftgate: liftgate / tailgate / trunk lid / decklid replaced, removed-and-installed, or ADJUSTED / aligned (a panel with a camera in it that is moved needs the camera calibrated)
- mirror: exterior mirror (left or right) replaced or removed-and-installed
- radar_sensor: a line naming a RADAR: "radar", "millimeter wave", "distronic", "ACC sensor", "adaptive cruise sensor". NOT park distance / parking / PDC / ultrasonic / proximity sensors — those are never radar
- camera: any line naming a camera (front, rear, side, surround, 360)
- headlamp: headlamp / headlight assembly replaced or removed-and-installed
- fender: FRONT fender (left or right) replaced, removed-and-installed, repaired or adjusted — not the fender liner, molding or flare alone
- structural: STRUCTURAL body repair lines: a welded / riveted / bonded unibody panel (quarter panel, rocker, pillar, rail, apron, floor pan, rear body panel, roof panel, wheelhouse) that is REPLACED or SECTIONED, or REPAIRED with more than 1.0 hour of body labor; a bumper reinforcement / impact bar repaired or replaced; a DOOR SHELL or door assembly REPLACED (new intrusion beam); a radiator / core support or bolt-on front bulkhead replaced; any frame/unibody pull or measure. NOT structural: refinish, blend, mask, buff, denib, trim or molding R&I, and panel repairs of 1.0 hour or less
- grille: front grille / upper grille / grille emblem replaced or removed-and-installed (not grille moldings or refinish only)
- front_door: driver or front passenger DOOR — replaced, removed-and-installed, repaired (door shell / skin) or adjusted
- park_sensor: a parking / back-up / ultrasonic / PDC / distance sensor (park assist) line: replaced, removed-and-installed, or transferred to a new bumper cover
- srs_deploy: an air bag / airbag module or SRS seat-belt pretensioner REPLACED (a deployment)
- b_pillar: B-pillar / center pillar — outer or inner panel repaired, replaced or sectioned, OR the B-pillar trim / applique removed or replaced

Return ONLY JSON: {"windshield":[...],"windshield_excluded":[...],"front_bumper":[...],"rear_bumper":[...],"alignment":[...],"battery":[...],"seat_airbag":[...],"liftgate":[...],"mirror":[...],"radar_sensor":[...],"camera":[...],"headlamp":[...],"fender":[...],"b_pillar":[...],"structural":[...],"srs_deploy":[...],"park_sensor":[...],"grille":[...],"front_door":[...],"rear_bumper_rpr":[...]} with line numbers as strings. Empty arrays when nothing matches. No prose.` },
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
    const hondaAlign = al.length && /honda|acura/i.test(make)
    require(cals, /steering angle|\bsas\b|vsa/, 'Steering Angle Sensor', 'Reset',
      al.length ? `Wheel alignment (line ${al.join(', ')})${hondaAlign ? ' — VSA sensor neutral position memorization' : ''}` : `Battery disconnect (line ${bat.join(', ')}) — zero-point after power loss on ${make}`, ref,
      hondaAlign
        ? `Steering angle / VSA sensor neutral position memorization required per Honda service information (Wheel Alignment procedure): "After adjusting the wheel alignment, do the VSA sensor neutral position memorization" (line${ref.length > 1 ? 's' : ''} ${ref.join(', ')}). Failure to perform it presents a safety liability and does not meet Honda repair standards.`
        : `Steering Angle Sensor ${al.length ? 'calibration' : 'zero-point reset'} required per ${per(make)} following ${al.length ? 'wheel alignment' : 'battery disconnect'} (line${ref.length > 1 ? 's' : ''} ${ref.join(', ')}). Failure to calibrate presents a safety liability and does not meet ${make || 'OEM'} repair standards.`,out, true)   // every make, every model: added even when the scrub didn't list it (Mark 2026-10-02)
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
  // 4c. Toyota/Lexus seat weight (Mark 2026-10-02): required for OCS ECU/sensor
  //     replacement or seat/SRS work (prompt rules). On every other Toyota
  //     collision, flag the pre-scan check: Toyota requires the zero-point
  //     calibration when the occupant sensors log a collision-detection code.
  if (/toyota|lexus/i.test(make)) {
    const NOTE = 'Check pre-scan for B1785, B1786, B1787 or B1788 (occupant classification sensor collision detection). If any is present, Toyota requires the seat weight zero-point calibration and sensitivity check.'
    let sws = has(cals, /seat weight|occupant|\bocs\b/)
    if (!sws) { sws = { calibration_name: 'Seat Weight Sensor', cal_type: 'Reset', trigger: '', line_references: '', justification: 'Not required by the repair lines — no front passenger seat, occupant sensor or SRS operation on this estimate.', enabled: false, _guard: 'listed' }; cals.push(sws) }
    if (sws.enabled !== true && !/B178[5-8]/.test(`${sws.justification || ''} ${sws.note || ''}`)) sws.justification = [sws.justification, NOTE].filter(Boolean).join(' ')   // the report prints the justification
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
  // 5b. Tesla (Mark 2026-10-02): every camera panel moved = camera calibration.
  //     The trunk/liftgate camera, the front fender repeater cameras and the
  //     B-pillar cameras are all part of Tesla's camera (Around View) system.
  if (/tesla/i.test(make)) {
    const fen = lines(hits.fender), bp = lines(hits.b_pillar)
    const tl = [...new Set([...lg, ...fen, ...bp, ...cam])]
    if (tl.length) {
      const what = [lg.length && `trunk/liftgate (line ${lg.join(', ')})`, fen.length && `front fender (line ${fen.join(', ')})`, bp.length && `B-pillar (line ${bp.join(', ')})`, cam.length && `camera (line ${cam.join(', ')})`].filter(Boolean).join(', ')
      require(cals, /around view|surround|360|bird|camera calibration|autopilot camera/i, 'Around View Camera', 'Dynamic',
        `Tesla camera panel moved: ${what}`, tl,
        `Tesla camera calibration required per ${per(make)}: ${what} carries one of the vehicle's Autopilot/surround cameras (trunk/liftgate rear camera, front fender repeater cameras, B-pillar cameras). Any repair, replacement, removal or adjustment of a panel holding a camera moves the camera and requires calibration. Failure to calibrate presents a safety liability and does not meet Tesla repair standards.`, out, true)
    }
  }
  // 5d. Honda/Acura (Honda job aid "Aiming Driving Support Systems", Nov 2022 v11,
  //     pp. 6 and 8; Mark 2026-10-02): a structural body repair anywhere — Honda's
  //     definition, Mark's thresholds: quarter repaired > 1.0 hr, door replaced —
  //     or an SRS deployment requires BOTH the front radar and the windshield camera.
  if (/honda|acura/i.test(make)) {
    const st = lines(hits.structural), srs = lines(hits.srs_deploy)
    const ref = [...new Set([...st, ...srs])]
    if (ref.length) {
      const why = `${st.length ? `structural body repair (line${st.length > 1 ? 's' : ''} ${st.join(', ')})` : ''}${st.length && srs.length ? ' and ' : ''}${srs.length ? `SRS deployment (line${srs.length > 1 ? 's' : ''} ${srs.join(', ')})` : ''}`
      const cite = `per Honda's "Aiming Driving Support Systems" job aid (November 2022), which requires aiming "after a collision repair requiring a structural body repair" and after an SRS deployment; structural includes welded/riveted/bonded unibody parts, bumper reinforcements and door intrusion beams`
      require(cals, /^front radar|millimeter|distance sensor|acc radar/i, 'Front Radar', 'Static', `Honda: ${why}`, ref, `Front Radar (millimeter wave) aiming required ${cite} (${why}). Failure to aim presents a safety liability and does not meet Honda repair standards.`, out)
      require(cals, /windshield|front camera|multipurpose|lane depart|forward camera/i, 'Front Windshield Camera', 'Static', `Honda: ${why}`, ref, `Multipurpose / windshield camera aiming required ${cite} (${why}). Failure to aim presents a safety liability and does not meet Honda repair standards.`, out)
    }
  }
  // 5f. Honda/Acura (ALLDATA 2024 Pilot + Honda job aid p. 9, Mark 2026-10-02):
  //     the millimeter wave radar sits in the GRILLE (grille R&I/Repl moves it), and
  //     the Multi View cameras need aiming after the front bumper, grille, a front
  //     door, a mirror or the tailgate is replaced or removed/installed, a front
  //     door or the tailgate is adjusted, or any collision repair to a front door.
  if (/honda|acura/i.test(make)) {
    const gr = lines(hits.grille), fd = lines(hits.front_door)
    if (gr.length) require(cals, /^front radar|millimeter|distance sensor|acc radar/i, 'Front Radar', 'Static',
      `Grille removed/replaced (line${gr.length > 1 ? 's' : ''} ${gr.join(', ')}) — the millimeter wave radar is mounted in the grille`, gr,
      `Millimeter wave radar aiming required per ALLDATA ADAS Quick Reference (Honda: Millimeter Wave Radar, location Grille, R&R / R&I, static + dynamic): the grille operation on line${gr.length > 1 ? 's' : ''} ${gr.join(', ')} removes the radar. Failure to aim presents a safety liability and does not meet Honda repair standards.`, out)
    const mv = has(cals, /around view|surround|multi.?view|360|bird/i)
    const mvTrig = [...new Set([...fb.slice(0, 3), ...gr, ...fd, ...mir, ...lg])]
    if (mv && mv.enabled !== true && mvTrig.length) require(cals, /around view|surround|multi.?view|360|bird/i, 'Around View Camera', 'Static',
      `Multi View camera location disturbed (line${mvTrig.length > 1 ? 's' : ''} ${mvTrig.join(', ')})`, mvTrig,
      `Multi View camera aiming required per Honda's "Aiming Driving Support Systems" job aid (November 2022, page 9): after replacing or removing/reinstalling the front bumper, front grille, a front door, a power mirror or the tailgate, after adjusting a front door or the tailgate, or after any collision repair to a front door (line${mvTrig.length > 1 ? 's' : ''} ${mvTrig.join(', ')}). Failure to aim presents a safety liability and does not meet Honda repair standards.`, out)
  }
  // 5e. Honda/Acura park sensors (ALLDATA ADAS Quick Reference, 2024 Pilot: "Parking
  //     and Back-Up Sensors — R&R, R&I — Static — component reset may be
  //     required"; Mark 2026-10-02: required for every shop). Sensor removed,
  //     replaced or transferred → Park Distance Sensor reset REQUIRED.
  if (/honda|acura/i.test(make)) {
    // Bumper removed or replaced moves the sensors with it (Mark 2026-10-02) — flips the
    // row when the car has park sensors (the scrub lists them only when equipped).
    const bump = [...new Set([...fb.slice(0, 3), ...rb.slice(0, 3)])]
    const psRow = has(cals, /park|ultrasonic|pdc|back.?up sensor|parking sensor/i)
    if (bump.length && psRow && psRow.enabled !== true) require(cals, /park|ultrasonic|pdc|back.?up sensor|parking sensor/i, 'Park Distance Sensor', 'Reset',
      `Bumper removed/replaced with parking sensors (line${bump.length > 1 ? 's' : ''} ${bump.join(', ')})`, bump,
      `Parking and back-up sensor reset required per ALLDATA ADAS Quick Reference (Honda: Parking and Back-Up Sensors, R&R / R&I, static reset with scan tool): the bumper removal or replacement on line${bump.length > 1 ? 's' : ''} ${bump.join(', ')} disconnects and moves the sensors.`, out)
    const ps = lines(hits.park_sensor)
    if (ps.length) require(cals, /park|ultrasonic|pdc|back.?up sensor|parking sensor/i, 'Park Distance Sensor', 'Reset',
      `Parking / back-up sensor removed, replaced or transferred (line${ps.length > 1 ? 's' : ''} ${ps.join(', ')})`, ps,
      `Parking and back-up sensor reset required per ALLDATA ADAS Quick Reference (Honda: Parking and Back-Up Sensors, R&R / R&I, static reset with scan tool) following sensor removal, replacement or transfer (line${ps.length > 1 ? 's' : ''} ${ps.join(', ')}).`, out, true)
  }
  // 5g. Toyota/Lexus (ALLDATA 2024 RAV4: Rear Television Camera and Ultrasonic
  //     Sensors — R&R / R&I, static; Mark 2026-10-02): back-up camera after the
  //     decklid / liftgate / tailgate is adjusted, removed or replaced; park sensors
  //     after the front or rear bumper is removed/installed or replaced.
  if (/toyota|lexus/i.test(make)) {
    const ps = lines(hits.park_sensor)
    const camLines = [...new Set([...lg, ...cam])]
    if (camLines.length) require(cals, /back ?up|rear view camera|rear camera|reverse camera|rear television/i, 'Back Up Camera', 'Static',
      `Decklid / liftgate / tailgate adjusted, removed or replaced, or rear camera removed (line${camLines.length > 1 ? 's' : ''} ${camLines.join(', ')})`, camLines,
      `Back-up (rear television) camera calibration required per ALLDATA ADAS Quick Reference (Toyota: Rear Television Camera on the decklid / liftgate / tailgate, R&R / R&I, static): the camera's panel was adjusted, removed or replaced (line${camLines.length > 1 ? 's' : ''} ${camLines.join(', ')}). Failure to calibrate presents a safety liability and does not meet Toyota repair standards.`, out, true)
    const bump = [...new Set([...fb.slice(0, 3), ...rb.slice(0, 3)])]
    const psRow = has(cals, /park|ultrasonic|pdc|clearance sonar|parking sensor/i)
    const psTrig = [...new Set([...ps, ...(psRow ? bump : [])])]
    if (psTrig.length) require(cals, /park|ultrasonic|pdc|clearance sonar|parking sensor/i, 'Park Distance Sensor', 'Static',
      `Park sensors / bumper removed or replaced (line${psTrig.length > 1 ? 's' : ''} ${psTrig.join(', ')})`, psTrig,
      `Ultrasonic (park) sensor calibration required per ALLDATA ADAS Quick Reference (Toyota: Ultrasonic Sensor, front and rear bumper, R&R / R&I, static): the bumper or sensor operation on line${psTrig.length > 1 ? 's' : ''} ${psTrig.join(', ')} removes the sensors.`, out, ps.length > 0)
  }
  // 5h. Subaru (ALLDATA 2024 Outback, Mark 2026-10-02): rear view camera R&R/R&I
  //     (liftgate moved = camera moved) → back-up camera; sonar (park) sensors —
  //     "installation height and angle must be checked if the bumper face, sonar
  //     holder, and/or sonar sensor are replaced" → bumper cover REPLACED or sensor
  //     replaced → park sensor check required (R&I of the bumper alone: not required).
  if (/subaru/i.test(make)) {
    // Mark 2026-10-02: rear blind spot on any rear bumper R&I or replacement; Around
    // View on any grille, decklid / trunk / hatch, or side mirror moved (cars with it).
    if (rb.length) require(cals, /blind.?spot|rear.*radar/i, 'Rear Blind Spot Radar', 'Static',
      `Rear bumper removed/installed or replaced (line${rb.length > 1 ? 's' : ''} ${rb.join(', ')})`, rb,
      `Rear radar (blind spot) calibration required per ALLDATA ADAS Quick Reference (Subaru: rear Radar Sensors in the rear bumper, R&R / R&I, static with targets): the rear bumper operation on line${rb.length > 1 ? 's' : ''} ${rb.join(', ')} moves the radars. Failure to calibrate presents a safety liability and does not meet Subaru repair standards.`, out)
    const grS = lines(hits.grille)
    const avTrig = [...new Set([...grS, ...lg, ...mir])]
    if (avTrig.length && has(cals, /around view|surround|360|bird/i)) require(cals, /around view|surround|360|bird/i, 'Around View Camera', 'Static',
      `Surround camera panel moved: ${[grS.length && `grille (line ${grS.join(', ')})`, lg.length && `decklid/trunk/hatch (line ${lg.join(', ')})`, mir.length && `side mirror (line ${mir.join(', ')})`].filter(Boolean).join(', ')}`, avTrig,
      `Surround view (Around View) camera calibration required per ALLDATA ADAS Quick Reference (Subaru: Front View Camera in the grille and Rear View Camera on the liftgate, R&R / R&I, static) whenever the grille, decklid / trunk / hatch or a side mirror carrying a camera is moved (line${avTrig.length > 1 ? 's' : ''} ${avTrig.join(', ')}). Failure to calibrate presents a safety liability and does not meet Subaru repair standards.`, out)
    const camLines = [...new Set([...lg, ...cam])]
    if (camLines.length) require(cals, /back ?up|rear view camera|rear camera|reverse camera/i, 'Back Up Camera', 'Static',
      `Liftgate / rear camera removed, replaced or adjusted (line${camLines.length > 1 ? 's' : ''} ${camLines.join(', ')})`, camLines,
      `Rear view camera calibration required per ALLDATA ADAS Quick Reference (Subaru: Rear View Camera on the liftgate, R&R / R&I, static): the camera or its panel was moved (line${camLines.length > 1 ? 's' : ''} ${camLines.join(', ')}). Failure to calibrate presents a safety liability and does not meet Subaru repair standards.`, out, true)
    const ps = lines(hits.park_sensor)
    const psRow = has(cals, /park|ultrasonic|sonar|pdc|parking sensor/i)
    const replacedBumper = psRow ? [...fb.slice(0, 2), ...rb.slice(0, 2)] : []
    // fb/rb include R&I; the model's row text tells replaced vs R&I — only flip when the guard sees a sensor line, or the row's own trigger says replaced.
    if (ps.length || (replacedBumper.length && /repl|replace/i.test(`${psRow?.trigger || ''} ${psRow?.justification || ''}`))) {
      const ref = [...new Set([...ps, ...replacedBumper])]
      require(cals, /park|ultrasonic|sonar|pdc|parking sensor/i, 'Park Distance Sensor', 'Static', `Bumper face / sonar sensor replaced (line${ref.length > 1 ? 's' : ''} ${ref.join(', ')})`, ref,
        `Sonar (park) sensor installation height and angle check required per ALLDATA ADAS Quick Reference (Subaru: "Installation height and angle must be checked if the bumper face, sonar holder, and/or sonar sensor are replaced") (line${ref.length > 1 ? 's' : ''} ${ref.join(', ')}).`, out, ps.length > 0)
    }
  }
  // 5i. Hyundai / Kia / Genesis (Mark 2026-10-02: "anytime the rear bumper is removed
  //     and installed, especially if it's replaced or repaired"): rear bumper R&I,
  //     replaced or repaired → rear blind spot radar calibration.
  const rbH = [...new Set([...rb, ...lines(hits.rear_bumper_rpr)])]
  if (/hyundai|kia|genesis/i.test(make) && rbH.length) require(cals, /blind.?spot|rear.*radar|\bbsd\b/i, 'Rear Blind Spot Radar', 'Static',
    `Rear bumper removed/installed, replaced or repaired (line${rbH.length > 1 ? 's' : ''} ${rbH.join(', ')}) — the blind spot radars sit behind the rear bumper`, rbH,
    `Rear blind spot (BSD) radar calibration required per ${per(make)}: the rear bumper operation on line${rbH.length > 1 ? 's' : ''} ${rbH.join(', ')} disturbs the radars mounted behind it (ALLDATA: Blind Spot Detection unit, rear bumper, static calibration). Failure to calibrate presents a safety liability and does not meet ${make} repair standards.`, out)
  // 5j. Ford / Lincoln park sensors (ALLDATA 2024 Transit: Parking Aid Sensor and
  //     Active Park Assist Sensor — R&R / R&I, static; Mark 2026-10-02: "calibrated
  //     anytime the bumpers are removed and installed") → front or rear bumper R&I or
  //     replaced, or a sensor removed/replaced, on cars with park sensors.
  if (/ford|lincoln/i.test(make)) {
    const ps = lines(hits.park_sensor)
    const psRow = has(cals, /park|ultrasonic|pdc|parking aid|parking sensor/i)
    const trig = [...new Set([...ps, ...(psRow ? [...fb.slice(0, 3), ...rb.slice(0, 3)] : [])])]
    if (trig.length) require(cals, /park|ultrasonic|pdc|parking aid|parking sensor/i, 'Park Distance Sensor', 'Static',
      `Bumper removed/installed or replaced, or park sensor removed (line${trig.length > 1 ? 's' : ''} ${trig.join(', ')})`, trig,
      `Parking aid sensor calibration required per ALLDATA ADAS Quick Reference (Ford: Parking Aid Sensor / Active Park Assist Sensor in the front and rear bumpers, R&R / R&I, static with targets): the operation on line${trig.length > 1 ? 's' : ''} ${trig.join(', ')} removes the sensors.`, out, ps.length > 0)
  }
  // 5c. Stellantis — Dodge, Chrysler, Jeep, Ram, Fiat, Alfa Romeo (ALLDATA ADAS
  //     Quick Reference: 2023 Ram ProMaster + 2018 Dodge Challenger, pasted by Mark
  //     2026-10-02; "All Stellantis"). The ACC radar lives in the FRONT BUMPER:
  //     bumper R&I or replacement moves it, and a wheel alignment requires it.
  //     Rear blind spot, park sensors and a basic back-up camera: calibration NOT
  //     required (the back-up camera is, on cars with surround view).
  if (/dodge|chrysler|jeep|\bram\b|fiat|alfa/i.test(make) || /promaster/i.test(String(data.model || data.vehicle || ''))) {
    const cite = 'per ALLDATA ADAS Quick Reference (Stellantis: Adaptive Cruise Control module in the front bumper — R&R, R&I and Wheel Alignment)'
    const trig = [...new Set([...fb, ...rs, ...al])]
    if (trig.length) require(cals, /^front radar|front radar|distance sensor|acc radar|adaptive cruise/i, 'Front Radar', 'Static',
      `${fb.length ? `Front bumper R&I/Repl (line ${fb.join(', ')}) — the ACC radar is mounted in the front bumper` : ''}${fb.length && al.length ? '; ' : ''}${al.length ? `wheel alignment (line ${al.join(', ')})` : ''}${!fb.length && !al.length ? `Radar named on line ${rs.join(', ')}` : ''}`, trig,
      `Adaptive cruise (front radar) calibration required ${cite}: the module is mounted in the front bumper and requires calibration when removed and installed or replaced, and after a wheel alignment (lines ${trig.join(', ')}). Failure to calibrate presents a safety liability and does not meet Stellantis repair standards.`, out)
    const notReq = (re, why) => { const c = cals.find(x => re.test(String(x.calibration_name || '')) && !/front/i.test(String(x.calibration_name || ''))); if (c && c.enabled === true) { Object.assign(c, { enabled: false, trigger: '', line_references: '', justification: why, _guard: 'demoted' }); out.demoted = [...(out.demoted || []), c.calibration_name] } }
    notReq(/blind.?spot|rear.*radar/i, 'Not required: ALLDATA lists no calibration for the Stellantis rear blind spot sensors (validate operation at post-scan, per the Stellantis Bumper/Fascia Repair with ADAS statement).')
    notReq(/park|ultrasonic|pdc/i, 'Not required: ALLDATA lists no calibration for the Stellantis park assist sensors.')
    if (!has(cals, /around view|surround|360|bird/i)) notReq(/back ?up|rear view camera|rear camera/i, 'Not required: ALLDATA lists no calibration for the Stellantis rear view camera on vehicles without surround view.')
  }
  // 5. Liftgate / rear camera line → Back Up Camera.
  if (lg.length || cam.some(l => true) && /rear|back/.test(JSON.stringify(cam))) {
    const ref = [...new Set([...lg])]
    if (ref.length) require(cals, /back ?up|rear view camera|rear camera|reverse camera/, 'Back Up Camera', 'Static/Dynamic',
      `Liftgate / tailgate / trunk lid R&I or Repl (line${ref.length > 1 ? 's' : ''} ${ref.join(', ')})`, ref,
      `Back Up Camera calibration required per ${per(make)} following liftgate, tailgate or trunk lid removal or replacement (line${ref.length > 1 ? 's' : ''} ${ref.join(', ')}); the camera is mounted in that panel and its aim is disturbed. Failure to calibrate presents a safety liability and does not meet ${make || 'OEM'} repair standards.`, out)
  }
  // 6. 📷 Rear camera = "Back Up Camera" (Mark 2026-10-02: "the industry standard is
  //    backup camera calibration, but in the description … if equipped with around
  //    view, this is the around view calibration"). A surround-view line raised only
  //    by rear work (liftgate / trunk / rear bumper / rear camera) becomes the Back Up
  //    Camera line instead — one calibration, billed once.
  {
    const isAvc = c => /around view|surround|multi.?view|360|bird/i.test(String(c.calibration_name || ''))
    const isBuc = c => /back ?up|rear view camera|rearview camera|rear camera|reverse camera/i.test(String(c.calibration_name || ''))
    const avc = cals.find(isAvc), rear = new Set([...lg, ...rb])
    const refs = r => String(r?.line_references || '').split(/[,\s]+/).filter(Boolean)
    if (avc && avc.enabled === true && refs(avc).length && refs(avc).every(l => rear.has(l))) {
      let buc = cals.find(isBuc)
      if (!buc) { buc = { calibration_name: 'Back Up Camera', cal_type: avc.cal_type || 'Static' }; cals.push(buc) }
      if (buc.enabled !== true) Object.assign(buc, { enabled: true, trigger: avc.trigger, line_references: avc.line_references, justification: avc.justification, _guard: 'from-surround' })
      Object.assign(avc, { enabled: false, trigger: '', line_references: '', justification: 'Not a separate calibration: the rear camera work on this estimate is billed once as the Back Up Camera line (performed as the surround-view calibration on cars equipped with it).', _guard: 'merged' })
      out.flipped.push('Around View (rear only) → Back Up Camera')
    }
    const buc = cals.find(isBuc)
    if (buc && buc.enabled === true && avc && !/around view calibration/i.test(buc.justification || ''))
      buc.justification = `${buc.justification || ''} If equipped with surround view (Around View / 360), this is performed as the Around View calibration.`.trim()
  }

  // 6b. GM "any collision" front radar only when the car HAS adaptive cruise radar
  //     (Mark 2026-10-02: Kinetic's 6-of-62 = most Chevys have no radar). Kept when
  //     the VIN decode or the estimate's options show adaptive cruise, or a front
  //     bumper / grille / radar line is on the estimate; otherwise "if equipped".
  if (/chevrolet|gmc|buick|cadillac/i.test(make)) {
    const fr = cals.find(c => /^front radar|distance sensor|acc radar/i.test(String(c.calibration_name || '')) && !/side|corner/i.test(String(c.calibration_name || '')))
    const equipped = /adaptive cruise/i.test(String(data.vin_equipment || '')) || /adaptive cruise|\bacc\b|intelligent cruise|full.?speed range/i.test(`${fr?.justification || ''} ${fr?.note || ''}`)
    const frontWork = fb.length || rs.length || lines(hits.grille).length
    if (fr && fr.enabled === true && !equipped && !frontWork) {
      Object.assign(fr, { enabled: false, line_references: '', _guard: 'if-equipped',
        justification: 'If equipped with adaptive cruise (front radar), GM requires the front radar calibration after this collision repair — confirm the radar at pre-scan. The VIN decode and estimate options do not show adaptive cruise, so it is not billed by default.' })
      out.demoted = [...(out.demoted || []), 'Front Radar (GM, no adaptive cruise shown)']
    }
  }

  // 7. 🚫 Front Radar from an alignment or windshield alone is a model error
  //    (benchmark 2026-10-02: 8 cars, prompt STEP 4f ignored). Demote it unless
  //    the estimate has a front bumper / radar line, its trigger names a front
  //    part, or a make-wide collision rule (GM, Ford/Lincoln) applies.
  {
    const fr = cals.find(c => /^front radar|distance sensor|distronic|acc radar/i.test(String(c.calibration_name || '')) && !/side|corner/i.test(String(c.calibration_name || '')))
    const trig = `${fr?.trigger || ''} ${fr?.justification || ''}`
    const frontPart = /bumper|fascia|grille|grill|emblem|absorber|reinforc|impact bar|radiator support|core support|apron|rail|radar|distance sensor|bracket|structur|hood|in collision/i
    const makeRule = /chevrolet|gmc|buick|cadillac|ford|lincoln|dodge|chrysler|jeep|\bram\b|fiat|alfa/i.test(make) || /promaster/i.test(String(data.model || data.vehicle || ''))   // Stellantis: ALLDATA lists ACC calibration after alignment
    if (fr && fr.enabled === true && !fb.length && !rs.length && !makeRule && !frontPart.test(fr.trigger || '') && /align|windshield|w\/s|glass/i.test(trig)) {
      fr.enabled = false
      fr.justification = `Not required: a wheel alignment or windshield replacement does not disturb the front radar (it sits behind the bumper/grille, not the glass), and no front bumper, grille or radar operation is on this estimate.`
      fr.trigger = ''; fr.line_references = ''; fr._guard = 'demoted'
      out.demoted = [...(out.demoted || []), 'Front Radar (alignment/windshield only)']
    }
  }
  if (out.flipped.length || out.added.length) console.log(`[guard] ${make} ${data.year || ''}: flipped ${out.flipped.length}, added ${out.added.length}${out.demoted ? `, demoted ${out.demoted.length}` : ''} — ${[...out.flipped, ...out.added, ...(out.demoted || [])].join(' · ')}`)
  data._guard = { flipped: out.flipped, added: out.added }
  return out
}
