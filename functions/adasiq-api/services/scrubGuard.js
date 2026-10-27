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
const SWS_ANY_COLLISION = /honda|acura|mazda|nissan|infiniti/i   // Nissan/Infiniti added 2026-10-02 (ALLDATA collision inspection: passenger seat removed for the OCS check → zero point reset; Mark: "any time the vehicle is in a collision")   // Mazda added 2026-10-02 (Mark: "every mazda in a collision")
// Makes whose statements require the camera after a wheel alignment.
const CAM_AFTER_ALIGN = /^(?!.*(honda|acura)).*/i   // every make after an alignment (Mark 2026-10-02) EXCEPT Honda/Acura: Honda's job aid + ALLDATA say camera/radar are NOT required after an alignment

const EMPTY_HITS = () => ({
  windshield: [], windshield_excluded: [], front_bumper: [], rear_bumper: [],
  rear_bumper_rpr: [], alignment: [], battery: [], seat_airbag: [], liftgate: [],
  mirror: [], radar_sensor: [], camera: [], headlamp: [], fender: [],
  structural: [], grille: [], front_door: [], module_repl: [], park_sensor: [],
  srs_deploy: [], b_pillar: [],
})

// CCC PDF text comes out glued: "53S01R&IR&I bumper cover2.2", "56*S03ReplBumper cover
// w/o auto park…", "68<>    S01   Repl   Bumper cover…", and the location lives on a
// numbered heading row above the lines ("52REAR BUMPER"), not in the description.
// Until 2026-10-26 the reader used \b word boundaries ("S01R&I" has none) and wanted
// "rear bumper" in the line itself, so on most estimates it found nothing and every
// rule that needs a line hit (bumper → radar, quarter → structural…) sat idle.
const OP_RE = /^(Repl|R&I|R&R|Rpr|O\/H|Subl(?:et)?|Blnd|Refn|Algn|D&R)/i
/** One numbered estimate row → { n, flags, sup, op, desc } (null for anything else). */
export function parseEstimateRow(row) {
  const raw = String(row || '')
  // Secure Share text (cccScrub.bmsToText): "3 | R&I | Bumper cover | new OEM, SUBLET | 1.8 hr | S01"
  const pm = raw.match(/^\s*(\d{1,3})\s*\|(.*)$/)
  if (pm) {
    const [opCol = '', desc = '', parts = '', hours = '', supp = ''] = pm[2].split('|').map(x => x.trim())
    let op = (opCol.match(OP_RE)?.[1] || (/^align/i.test(opCol) ? 'algn' : '')).toLowerCase().replace(/^sublet$/, 'subl')
    if (!op && /sublet/i.test(parts)) op = 'subl'
    return desc ? { n: pm[1], flags: '', sup: (supp.match(/S\d{2}/) || [''])[0], op, desc: `${desc} ${hours.replace(/\s*hr$/, '')}`.trim() } : null
  }
  // CCC PDF text: "53S01R&IR&I bumper cover2.2", "68<>    S01   Repl   Bumper cover…"
  const m = raw.match(/^\s*(\d{1,3})(?!\d)\s*((?:[#*<>]+\s*)*)(S\d{2})?\s*(.*)$/)
  if (!m || !m[4]) return null
  let rest = m[4].trim(), op = ''
  const om = rest.match(OP_RE)
  if (om) { op = om[1].toLowerCase().replace(/^sublet$/, 'subl'); rest = rest.slice(om[1].length).trim() }
  else { const any = rest.match(/(?:^|\s)(Repl|R&I|R&R|Rpr|O\/H|Subl(?:et)?|D&R)(?=\s|$)/i); if (any) op = any[1].toLowerCase().replace(/^sublet$/, 'subl') }   // "22 Battery R&I"
  return { n: m[1], flags: m[2].replace(/\s+/g, ''), sup: m[3] || '', op, desc: rest }
}
// Mitchell (Cloud Estimating) PDF text, 2026-10-26 (BMW X7 came back "blind"): the line
// number is glued to a 6-digit operation code or AUTO ("29204870Rear Bumper Cover AssyOverhaul
// Body3.4#Existing"), the operation is spelled out and wraps ("Remove /" ⏎ "Install"), and the
// section headings ("Rear Bumper") are plain lines with no number.
const MITCHELL_OPS = [[/remove\s*\/\s*install/i, 'r&i'], [/remove\s*\/\s*replace/i, 'repl'], [/overhaul/i, 'o/h'], [/\balign(ment)?\b(?=\s*body|\s*mech|\s*\*|\s*$)|align(?=body|mech)/i, 'algn'], [/blend/i, 'blnd'], [/refinish/i, 'refn'], [/repair(?=\s*(body|mech|glass|frame|structural|refinish|\*))/i, 'rpr'], [/additional\s*(labor|operation|cost)/i, '']]
const MITCHELL_NOISE = /^(committed on|version|mitchell|oem |copyright|all rights|printed on|profile|tm$|page |metro |labor|line #|\*\*|tt |##|dd |disclaimer|estimate totals)/i
const MITCHELL_AREA = /bumper|door|roof|body|glass|lamp|hood|fender|grille|windshield|quarter|rocker|pillar|floor|liftgate|tailgate|trunk|deck|wheel|tire|suspension|steering|cooling|radiator|engine|electrical|mirror|seat|restraint|additional|special|manual|frame|cowl|dash|console|panel|interior|front|rear|side|sensor|camera/i
function mitchellRows(text) {
  const lines = String(text || '').split(/\r?\n/)
  const out = []
  let section = '', cur = null, last = 0, pendingHead = ''
  const finish = () => {
    if (!cur) return
    const joined = cur.parts.join(' ').replace(/\s+/g, ' ').trim()
    let op = '', at = joined.length
    for (const [re, code] of MITCHELL_OPS) { const m = joined.match(re); if (m && m.index < at && m.index > 0) { at = m.index; op = code } }
    if (/remove\s*\/\s*replace/i.test(joined) && /sublet/i.test(joined) && !op) op = 'subl'
    out.push({ n: cur.n, flags: '', sup: '', op, desc: joined.slice(0, at).replace(/^(\d{6}|AUTO)\s*/, '').trim(), section: cur.section })
    cur = null
  }
  for (const raw of lines) {
    const line = raw.trim()
    if (/^estimate totals/i.test(line)) break
    const m = line.match(/^(\d{7,9})(?!\d)(.*)$/) || line.match(/^(\d{1,3})(AUTO)(.*)$/)
    let n = '', rest = ''
    if (m && m[2] === 'AUTO') { n = m[1]; rest = 'AUTO' + m[3] }
    else if (m) {
      const digits = m[1], cands = []
      for (let k = 1; k <= 3 && digits.length - k >= 6; k++) cands.push({ n: Number(digits.slice(0, k)), rest: digits.slice(k + 6) + m[2] })
      const pick = cands.find(c => c.n === last + 1) || cands.filter(c => c.n > last && c.n <= last + 40).sort((a, b) => a.n - b.n)[0] || (last === 0 ? cands[0] : null)
      if (pick) { n = String(pick.n); rest = pick.rest }
    }
    if (n) {
      finish()
      if (pendingHead) { section = pendingHead.toLowerCase(); pendingHead = '' }
      cur = { n, parts: [rest], section }; last = Number(n)
      continue
    }
    if (!line) continue
    const done = cur && MITCHELL_OPS.some(([re]) => re.test(cur.parts.join(' ')))
    if (cur && !done) { cur.parts.push(line); continue }
    if (cur && done && /^(body|glass|mechanical|refinish|frame|structural|existing|new|sublet|install|replace|only|operation|cost|labor)/i.test(line)) { cur.parts.push(line); continue }
    if (!MITCHELL_NOISE.test(line) && /^[A-Za-z][A-Za-z &/,'-]{2,40}$/.test(line) && line.split(/\s+/).length <= 5 && MITCHELL_AREA.test(line)) pendingHead = line
  }
  finish()
  return out
}

/** The numbered rows of an estimate with the section heading each sits under. */
export function estimateRows(text) {
  const out = []
  let t = String(text || '')
  if (/mitchell/i.test(t) && /^\s*\d{7,9}\D/m.test(t)) return mitchellRows(t)
  // CCC PDF: the vehicle options block ("Dual MirrorsBackup Camera…") comes before the
  // first "LineOper…" column header — never read it as repair lines.
  const hdr = t.search(/Line\s*Oper/i)
  if (hdr > 0) t = t.slice(hdr)
  let section = ''
  for (const row of t.split(/\r?\n/)) {
    const r = parseEstimateRow(row)
    if (!r) continue
    // "1REAR BUMPER", "2FRONT BUMPER & GRILLE", "73PILLARS, ROCKER & FLOOR"
    if (!r.op && !r.flags && !r.sup && /^[A-Z][A-Z0-9 &,/'().-]{2,60}$/.test(r.desc) && !/\d\.\d/.test(r.desc)) { section = r.desc.toLowerCase(); continue }
    out.push({ ...r, section })
  }
  return out
}

/** Instant line categorizer from CCC text — same buckets as the Haiku pass, no model. */
export function triggerLinesFromText(text) {
  const hits = EMPTY_HITS()
  if (!text) return hits
  const push = (k, n) => { if (n && !hits[k].includes(n)) hits[k].push(n) }
  for (const { n, op, desc, section } of estimateRows(text)) {
    // "mirror0.3", "Alignment1162.49", "front bumper00.00": split the hours/price off the words.
    const d = desc.toLowerCase().replace(/([a-z)])(\d)/g, '$1 $2').replace(/\bfrt\b/g, 'front').replace(/\bmoulding\b/g, 'molding').replace(/\s+/g, ' ')
    const ctx = `${section} ${d}`
    const addFor = /^add for\b/.test(d)
    const opOut = /^(repl|r&r|r&i|subl|o\/h)$/.test(op)          // the part comes off the car
    const opRi = /^(repl|r&r|r&i|o\/h)$/.test(op)
    const opRpr = op === 'rpr'
    const hrs = Math.max(0, ...(d.match(/\d+\.\d/g) || []).map(Number).filter(x => x < 30))

    const wsWord = /(windshield|w\/shield|windscreen|\bw\/s\b)/.test(d) || (/windshield/.test(section) && /\bglass\b/.test(d))
    const wsKeep = /(mask|protect|cover|tape|plastic|chip|polish|denib|tint|urethane|molding|mldg|cowl|wiper|washer|kit|add for)/.test(d)
    const notFront = /(liftgate|back glass|back window|rear (window|glass)|quarter glass|door glass|mirror glass|sunroof|moonroof)/.test(d)
    if (wsWord && opOut && !wsKeep && !notFront) push('windshield', n)
    else if (wsWord && !notFront) push('windshield_excluded', n)

    const bumperPart = /\b(bumper|fascia)\b/.test(d) || (/bumper/.test(section) && /^(cover|bumper cover)\b/.test(d))
    const bumperTrim = /(bracket|absorber|impact bar|reinforc|lamp|trim|grille|add for|add w\/|rivet|filler|step pad|molding|mldg|guard|insert|lower cover|valance|spoiler|skid|prep|clear coat|license|tow hook|emblem|retainer|clip)/.test(d)
    const front = /front bumper|front fascia/.test(ctx) || (/bumper/.test(section) && /front/.test(section))
    const rear = /rear bumper|rear fascia/.test(ctx) || (/bumper/.test(section) && /rear/.test(section))
    if (bumperPart && !bumperTrim) {
      if (front && !rear) { if (opRi) push('front_bumper', n) }
      else if (rear) { if (opRi) push('rear_bumper', n); else if (opRpr) push('rear_bumper_rpr', n) }
    }
    if (/\b(align|alignment|4[- ]wheel)\b/.test(d) || /steering system reset/.test(d)) push('alignment', n)
    if (/\bbattery\b/.test(d) && (/^(r&i|repl|r&r|d&r)$/.test(op) || /\b(d&r|disconnect|remove)\b/.test(d))) push('battery', n)
    if (/(passenger seat|seat cushion|seat track|seat belt|pretensioner|air ?bag|\bsrs\b)/.test(d) && op) push('seat_airbag', n)
    if (/(liftgate|lift gate|tailgate|trunk lid|deck ?lid|back door)/.test(d) && (opRi || /adjust|align/.test(d)) && !/(trim|molding|mldg|emblem|nameplate|handle|strut|w'strip|weatherstrip|glass|wiper|spoiler|lamp|light)/.test(d)) push('liftgate', n)
    if (/\bmirror\b/.test(d) && opRi && !/mirror (glass|cover|cap)|inside mirror|interior mirror/.test(d) && !(/rear ?view mirror/.test(d) && !/^(l|r|lt|rt|left|right)\b|front|door/.test(d))) push('mirror', n)
    const radarWord = /(radar|millimeter|distronic|acc sensor|adaptive cruise|cruise control sensor)/.test(d) || (/distance sensor/.test(d) && !/bumper/.test(section))
    if (radarWord && !/(park|pdc|ultrasonic|proximity|prk)/.test(d)) push('radar_sensor', n)
    if (/\bcamera\b/.test(d)) push('camera', n)
    if (/(headlamp|headlight)/.test(d) && opRi && !/(bulb|aim labor|aiming|\baim\b|bracket|washer)/.test(d)) push('headlamp', n)
    if (/\bfender\b/.test(d) && !/(liner|molding|flare|rear)/.test(d) && (opRi || opRpr || /adjust/.test(d))) push('fender', n)
    const trim = /(trim|molding|mldg|applique|garnish|seal|w'strip|weatherstrip|nameplate|emblem|liner|cover|cap\b|plug|clip|insulator)/.test(d)
    if (/(quarter panel|rocker|pillar|\bplr\b|\brail\b|apron|floor pan|rear body|roof panel|wheelhouse|rear panel)/.test(d) && !trim && (/^(repl)$/.test(op) || /\bsection/.test(d) || (opRpr && hrs >= 1))) push('structural', n)
    if (/(bumper reinforcement|impact bar|door shell|door assy|door assembly|core support|radiator support)/.test(d) && op === 'repl') push('structural', n)
    if (/\bgrill/.test(d) && opRi && !/(molding|mldg|refn|blnd|cowl|emblem|nameplate|clip)/.test(d)) push('grille', n)
    const frontDoorPart = /(door shell|door assy|door assembly|outer panel|door skin|\bdoor\b)/.test(d) && !/(trim|molding|mldg|handle|glass|regulator|w'strip|weatherstrip|striker|check|hinge|lock|speaker|switch|applique|nameplate)/.test(d)
    if (((/front door/.test(ctx) && !/rear door/.test(d)) || (/front door/.test(section) && frontDoorPart)) && frontDoorPart && (opRi || opRpr || /adjust/.test(d))) push('front_door', n)
    const moduleWord = /\b(module|ecu|sdm|gateway|control unit)\b/.test(d) || /(radar|distance sensor|\bcamera\b)/.test(d)
    const airBag = /air ?bag/.test(d) && !/(control|sdm|sensing|diagnos)/.test(d)   // CCC "Air bag module" = the bag itself (Voyager 2026-10-20)
    if (moduleWord && op === 'repl' && !airBag && !/\badd\b/.test(d) && !/(park|pdc|ultrasonic|prk|bracket|cover|aim|calibrat|wiring|harness|mount|holder|bezel|trim|lens)/.test(d)) push('module_repl', n)
    const parkWord = /(park(ing)? (aid |assist |distance )?sensor|ultrasonic|\bpdc\b|parktronic|sonar|prk sensor|reverse sensor|back ?up sensor|park assist)/.test(d) || /add w\/ ?distance sensor/.test(d)   // BMW/Mitchell "Add w/Distance Sensor" = the bumper's PDC sensors (a Ford "Distance sensor" is the radar)
    if (parkWord && (opRi || addFor || /transfer/.test(d)) && !/\bw\/o\b[^,]*(park|prk|sensor)/.test(d)) push('park_sensor', n)
    else if (bumperPart && (opRi || opRpr) && /\bw\/\s*(prk|park|parking|sensor|pdc|ultrasonic)/.test(d)) push('park_sensor', n)   // "Bumper cover w/prk sensor" — the sensors come off with it
    if (/(air ?bag|pretensioner)/.test(d) && op === 'repl') push('srs_deploy', n)
    if (/(b-?pillar|center pillar|center plr)/.test(d)) push('b_pillar', n)
  }
  return hits
}

/** One Haiku read: which lines carry which trigger words. Text path uses triggerLinesFromText instead. */
export async function triggerLines(base64Pdf, { text = '' } = {}) {
  if (text && String(text).length >= 400) return triggerLinesFromText(text)
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
- module_repl: an ELECTRONIC module or sensor unit REPLACED (Repl / new part): radar sensor (front, corner, blind spot), camera, body control module, SRS / airbag control unit (SDM), ABS / brake module, engine or transmission control module, park assist / sonar module, headlamp control module, keyless / smart key module, power liftgate module, instrument cluster, gateway, telematics, HVAC control module. ONE line number per module. NOT R&I, NOT wiring/connectors/brackets, NOT bulbs, NOT lamps without a module
- park_sensor: a parking / back-up / ultrasonic / PDC / distance sensor (park assist) line: replaced, removed-and-installed, or transferred to a new bumper cover
- srs_deploy: an air bag / airbag module or SRS seat-belt pretensioner REPLACED (a deployment)
- b_pillar: B-pillar / center pillar — outer or inner panel repaired, replaced or sectioned, OR the B-pillar trim / applique removed or replaced

Return ONLY JSON: {"windshield":[...],"windshield_excluded":[...],"front_bumper":[...],"rear_bumper":[...],"alignment":[...],"battery":[...],"seat_airbag":[...],"liftgate":[...],"mirror":[...],"radar_sensor":[...],"camera":[...],"headlamp":[...],"fender":[...],"b_pillar":[...],"structural":[...],"srs_deploy":[...],"park_sensor":[...],"grille":[...],"front_door":[...],"rear_bumper_rpr":[...],"module_repl":[...]} with line numbers as strings. Empty arrays when nothing matches. No prose.` },
    ] }],
  })
  const raw = (msg.content || []).map(b => b.text || '').join('').trim()
  try { const m = raw.match(/\{[\s\S]*\}/); return m ? JSON.parse(m[0]) : {} } catch { return {} }
}

const name = c => String(c?.sensor || c?.calibration_name || '').toLowerCase()
const has = (cals, re) => cals.find(c => re.test(name(c)))
const lines = arr => (Array.isArray(arr) ? arr : []).map(String).filter(Boolean)
const BLIND_SPOT_ROW = /blind.?spot|rear.*radar/i

/** Tesla has no blind-spot sensors (Mark 2026-10-19). Drop the row so it cannot be billed. */
export function stripTeslaBlindSpot(data) {
  if (!data || !/tesla/i.test(`${data.make || ''} ${data.vehicle || ''}`)) return []
  const cals = data.calibrations
  if (!Array.isArray(cals)) return []
  const dropped = []
  for (let i = cals.length - 1; i >= 0; i--) {
    const label = String(cals[i]?.calibration_name || cals[i]?.sensor || cals[i]?.name || '')
    if (!BLIND_SPOT_ROW.test(label) || /front/i.test(label)) continue
    dropped.push(label)
    cals.splice(i, 1)
  }
  return dropped
}

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

const NISSAN_PARK_WHY = 'Not required. Dropping the bumper cover does not call for a Nissan sonar sensor reset. The sonar sensors are a separate removal. This estimate does not remove or replace a park sensor.'

/** A stored Nissan park row whose trigger is a bumper-cover drop, not a sensor that was removed. */
export function parkRowIsBumperOnly(c) {
  const t = `${c?.trigger || ''} ${c?.justification || ''}`
  if (/(?:sonar|ultrasonic|\bpdc\b|parktronic|(?:park(?:ing)? )?(?:aid |distance )?sensor).{0,80}\b(repl|r&i|r&r|removed|replaced|transfer)/i.test(t)) return false
  if (/\b(repl|r&i|r&r)\b.{0,40}(?:sonar|ultrasonic|\bpdc\b|parktronic)/i.test(t)) return false
  return true
}

const ALIGN_ROW = /^(?:wheel alignment|4-way alignment|four-wheel alignment|four wheel alignment)$/i
function isAlignCal(c) {
  return ALIGN_ROW.test(String(c?.calibration_name || '').trim())
}
function fourWayWhy(radarLines) {
  const where = radarLines.length ? ` (line ${radarLines.join(', ')})` : ''
  return `The ACC / front radar is required because of the front bumper removal${where}. This 4-way alignment is required before that ACC radar aim, because Nissan's distance-sensor procedure says a 4-wheel alignment must be performed before the radar alignment.`
}
const SAS_CONDITIONAL = 'Conditional. The steering angle sensor neutral-position adjustment is required only when a four-wheel alignment adjustment was performed. An alignment inspection is not an adjustment. Confirm the alignment result before this operation is required.'
const SAS_SECONDARY = 'The steering angle sensor neutral-position adjustment is required after the wheel alignment adjustment on this estimate.'
const RADAR_ALIGN_NOTE = /Prerequisite: wheel alignment required before this radar can be aimed\.|The wheel alignment on lines? [\d, ]+ must be performed before the radar alignment\.|A 4-wheel vehicle alignment must be performed before proceeding with (?:radar|distance sensor) alignment procedure\.|Always perform the radar alignment after removing and installing or replacing the distance sensor\./g
const CLASS_DIRECT = 'REQUIRED: DIRECT TRIGGER'
const CLASS_PREREQ = 'REQUIRED: OEM PREREQUISITE'
const CLASS_SECONDARY = 'REQUIRED: SECONDARY OPERATION'
const CLASS_CONDITIONAL = 'CONDITIONAL: VERIFICATION NEEDED'
const CLASS_VERIFIED = 'NOT REQUIRED: VERIFIED'
const CLASS_REVIEW = 'REVIEW NEEDED'

function setFields(row, fields) {
  let changed = false
  for (const [k, v] of Object.entries(fields)) {
    if (v == null) continue
    if (row[k] !== v) { row[k] = v; changed = true }
  }
  return changed
}

function labelNissanOperations(data) {
  if (!/nissan|infiniti/i.test(`${data?.make || ''} ${data?.vehicle || ''}`)) return false
  let changed = false
  for (const c of data?.calibrations || []) {
    const n = `${c.calibration_name || ''} ${c.sensor || ''}`
    if (isFrontRadarRow(c) && c.enabled === true) {
      changed = setFields(c, {
        classification: CLASS_DIRECT,
        procedure: c.procedure || c.cal_type || 'Static',
        required_before: '4-Way Alignment. This aiming procedure is last.',
        repair_relationship: c.repair_relationship || `Qualifying front repair${c.line_references ? ` (line ${c.line_references})` : ''}.`,
        oem_reference: c.oem_reference || 'Nissan distance sensor alignment procedure',
      }) || changed
    } else if (/blind.?spot|rear.*radar/i.test(n) && !/front/i.test(n) && c.enabled === true) {
      changed = setFields(c, {
        classification: CLASS_DIRECT,
        procedure: c.procedure || c.cal_type || 'Static',
        required_before: 'None for this chain. It is its own direct trigger.',
        repair_relationship: c.repair_relationship || (c.trigger || 'Rear bumper repair'),
        oem_reference: c.oem_reference || 'Nissan side radar alignment',
      }) || changed
    } else if (/seat weight|occupant classification/i.test(n) && c.enabled === true) {
      changed = setFields(c, {
        classification: CLASS_DIRECT,
        procedure: c.procedure || 'Reset',
        required_before: 'None for the radar chain.',
        repair_relationship: c.repair_relationship || 'Any Nissan collision. The seat is removed to inspect the occupant classification system.',
        oem_reference: c.oem_reference || 'Nissan Repairs and Inspections Required After a Collision',
      }) || changed
    } else if (/park|ultrasonic|sonar|\bpdc\b|parking sensor/i.test(n) && c.enabled !== true && /bumper cover|sonar sensor/i.test(`${c.justification || ''} ${c.trigger || ''}`)) {
      changed = setFields(c, {
        classification: CLASS_VERIFIED,
        procedure: '—',
        required_before: 'None.',
        repair_relationship: 'Bumper-cover drop only. No sonar sensor line.',
        oem_reference: c.oem_reference || 'Nissan front bumper removal and installation. The sonar sensors are a separate step.',
      }) || changed
    }
  }
  return changed
}

function isFrontRadarRow(c) {
  const n = `${c?.calibration_name || ''} ${c?.sensor || ''}`
  if (/park|ultrasonic|sonar|\bpdc\b|side|corner/i.test(n)) return false
  return /front radar|acc radar|adaptive cruise|distance sensor/i.test(n)
}

function estimateAlignmentLines(data, alignmentLines) {
  if (Array.isArray(alignmentLines)) return [...new Set(alignmentLines.map(String).filter(Boolean))]
  const found = []
  for (const c of data?.calibrations || []) {
    if (isAlignCal(c)) continue
    const m = String(c?.trigger || '').match(/^Wheel alignment \(lines? ([0-9, ]+)\)/i)
    if (m) found.push(...m[1].split(/,\s*/))
  }
  return [...new Set(found.filter(Boolean))]
}

function stripRadarAlignNote(row) {
  if (!row) return false
  const prev = String(row.justification || '').trim()
  const next = prev.replace(RADAR_ALIGN_NOTE, '').replace(/\s+/g, ' ').trim()
  if (next === prev) return false
  row.justification = next
  return true
}

function wheelNamedLines(data) {
  const wheel = (data?.calibrations || []).find(isAlignCal)
  const m = String(wheel?.trigger || '').match(/^Wheel alignment \(lines? ([0-9, ]+)\)/i)
  return m ? [...new Set(m[1].split(/,\s*/).filter(Boolean))] : []
}

/**
 * Nissan/Infiniti distance-sensor chain. Front radar stays a direct trigger.
 * 4-Way Alignment stays on the report as the OEM prerequisite. Invoicing that
 * row is a shop switch and defaults off, so this row has no price and no
 * labor hour. One row: a stored "Wheel Alignment" line is renamed, not copied.
 * Steering angle is conditional until an alignment adjustment is on the
 * estimate, then it is one secondary row. An inspection is not an adjustment.
 * A battery disconnect does not turn SAS on. Rear blind spot type is not touched.
 */
export function noteNissanRadarAlignment(data, alignmentLines, opts = {}) {
  if (!/nissan|infiniti/i.test(`${data?.make || ''} ${data?.vehicle || ''}`)) return false
  const cals = data?.calibrations
  if (!Array.isArray(cals)) return false
  let changed = labelNissanOperations(data)
  const radar = cals.find(c => c?.enabled === true && isFrontRadarRow(c))
  if (!radar) {
    for (let i = cals.length - 1; i >= 0; i--) {
      const c = cals[i]
      if (isAlignCal(c) && (c.classification === CLASS_PREREQ || c._guard === 'added' || c._guard === 'flipped')) {
        cals.splice(i, 1)
        changed = true
      }
    }
    return changed
  }
  const passed = Array.isArray(alignmentLines)
  const named = passed ? estimateAlignmentLines(data, alignmentLines) : wheelNamedLines(data)
  const alignRows = cals.filter(isAlignCal)
  const wheelNow = alignRows[0]
  for (let i = cals.length - 1; i >= 0 && alignRows.length > 1; i--) {
    if (isAlignCal(cals[i]) && cals[i] !== wheelNow) { cals.splice(i, 1); changed = true }
  }
  const adjusted = Array.isArray(opts.adjustmentLines)
    ? [...new Set(opts.adjustmentLines.map(String).filter(Boolean))]
    : (passed ? named : (wheelNow?._alignmentAdjusted === false ? [] : named))
  const radarLines = String(radar.line_references || '').split(/,\s*/).filter(Boolean)
  const lines = named.length ? named : radarLines
  const why = fourWayWhy(radarLines)
  const where = named.length
    ? `Wheel alignment (line${lines.length > 1 ? 's' : ''} ${lines.join(', ')}). ${why}`
    : why
  const wheelFields = {
    calibration_name: '4-Way Alignment', operation_title: '4-Way Alignment', cal_type: '', enabled: true,
    trigger: where, line_references: lines.join(', '), justification: why,
    classification: CLASS_PREREQ, procedure: 'Alignment',
    required_before: 'The ACC / front radar aim.',
    repair_relationship: 'OEM prerequisite before the ACC / front radar aim. The front bumper removal is why the radar is required, not why this alignment is required.',
    oem_reference: 'Nissan distance sensor alignment procedure',
    _alignmentAdjusted: adjusted.length > 0,
  }
  const wheel = cals.find(isAlignCal)
  if (!wheel) {
    cals.push({ ...wheelFields, _guard: 'added' })
    changed = true
  } else if (setFields(wheel, wheelFields)) {
    wheel._guard = wheel._guard || 'flipped'
    changed = true
  }
  if (wheel) { delete wheel.rate; delete wheel.price; delete wheel.hours; delete wheel.labor_hours }
  const sas = cals.find(c => /steering angle|\bsas\b/i.test(`${c?.calibration_name || ''} ${c?.sensor || ''}`))
  const fromChain = !sas || sas.enabled !== true || /wheel alignment|neutral-position|verification needed/i.test(`${sas.justification || ''} ${sas.trigger || ''}`) || sas.classification === CLASS_CONDITIONAL || sas.classification === CLASS_SECONDARY
  const sasFields = adjusted.length ? {
    enabled: true,
    classification: CLASS_SECONDARY,
    procedure: 'Neutral position',
    trigger: `Wheel alignment adjustment (line${adjusted.length > 1 ? 's' : ''} ${adjusted.join(', ')})`,
    line_references: adjusted.join(', '),
    justification: SAS_SECONDARY,
    required_before: 'Front radar aiming. Do this reset after the alignment adjustment.',
    repair_relationship: 'Secondary operation. The estimate already has an alignment adjustment.',
    oem_reference: 'Nissan steering angle sensor neutral position procedure',
  } : {
    enabled: false,
    classification: CLASS_CONDITIONAL,
    procedure: 'Neutral position',
    trigger: 'Verification needed. Required only after an alignment adjustment, not an inspection.',
    line_references: '',
    justification: SAS_CONDITIONAL,
    required_before: 'Front radar aiming, and only if the alignment was adjusted.',
    repair_relationship: 'Not required yet. The alignment prerequisite alone does not require it. A battery disconnect does not require it.',
    oem_reference: 'Nissan steering angle sensor neutral position procedure',
  }
  if (!sas) {
    cals.push({ calibration_name: 'Steering Angle Sensor', cal_type: 'Reset', ...sasFields, _guard: 'added' })
    changed = true
  } else if (!adjusted.length && sas.enabled === true && !fromChain) {
    changed = setFields(sas, { classification: sas.classification || CLASS_DIRECT, procedure: sas.procedure || sas.cal_type || 'Reset' }) || changed
  } else if (setFields(sas, sasFields)) {
    if (!sas.cal_type) sas.cal_type = 'Reset'
    sas._guard = sas._guard || 'flipped'
    changed = true
  }
  if (stripRadarAlignNote(radar)) changed = true
  return changed
}

const NISSAN_BATTERY_MARK = 'Operations Required after Disconnecting Battery'
const BATTERY_RESET_TITLE = 'Battery Reset'

/** The Battery Operations sentences already written on a reset row, or ''. */
export function batteryOperationsNote(cals) {
  for (const c of cals || []) {
    const n = `${c?.calibration_name || ''} ${c?.name || ''} ${c?.sensor || ''}`
    if (!/battery.?disconnect reset/i.test(n)) continue
    const m = String(c.justification || c.why || '').match(/12V battery disconnect[\s\S]*?Position Statement Power Window Servicing Post-Repair\./)
    if (m) return m[0]
  }
  return ''
}

/**
 * Add the Nissan battery-reset row when a saved scrub has the disconnect
 * lines but never stored the row, then write the procedure on it.
 * Pass line numbers from the estimate. Omit them when the row is already stored.
 */
export function ensureNissanBatteryRow(data, batteryLines) {
  if (!/nissan|infiniti/i.test(`${data?.make || ''} ${data?.vehicle || ''}`)) return false
  const linesIn = Array.isArray(batteryLines) ? [...new Set(batteryLines.map(String).filter(Boolean))] : null
  if (!Array.isArray(data?.calibrations)) return false
  const row = data.calibrations.find(c => /battery.?disconnect reset|\bbattery reset\b|operations required after disconnecting battery/i.test(`${c?.calibration_name || ''} ${c?.sensor || ''} ${c?.name || ''} ${c?.operation_title || ''}`))
  if (!row) {
    if (!linesIn?.length) return false
    data.calibrations.push({
      calibration_name: 'Battery-Disconnect Resets',
      cal_type: 'Reset',
      enabled: true,
      line_references: linesIn.join(', '),
      trigger: '',
      justification: '',
    })
  }
  return noteNissanBatteryProcedure(data, linesIn?.length ? linesIn : undefined)
}

const NISSAN_BATTERY_NAME = /battery.?disconnect reset|\bbattery reset\b|operations required after disconnecting battery/i

export function nissanBatteryEnabled(data) {
  return (data?.calibrations || []).some(c => NISSAN_BATTERY_NAME.test(`${c?.calibration_name || ''} ${c?.sensor || ''} ${c?.name || ''} ${c?.operation_title || ''}`) && c.enabled === true)
}

/**
 * Line numbers for a battery disconnect. The one-line CCC form is handled by
 * triggerLinesFromText. pdf-parse often puts the line number on its own line
 * and the operation on the next lines, which that parser misses.
 */
export function batteryDisconnectLines(text) {
  const hits = triggerLinesFromText(text)
  const found = [...(hits.battery || [])]
  const rows = String(text || '').split(/\r?\n/)
  for (let i = 0; i < rows.length; i++) {
    const only = rows[i].match(/^\s*(\d+)\s*$/)
    if (!only) continue
    const window = rows.slice(i + 1, i + 5).join(' ')
    if (/\bbattery\b/i.test(window) && /\b(d&r|r&i|disconnect|remove)\b/i.test(window) && !found.includes(only[1])) found.push(only[1])
  }
  return found
}

/**
 * What opening a saved Nissan scrub should do about Battery Reset.
 * `_batteryChecked` is ignored on purpose: an earlier look that stored no
 * line list must read the estimate again. A stored line list with numbers
 * rebuilds the row without another download.
 */
export function nissanBatteryProbe(data, { fileId = '', batteryLines } = {}) {
  if (!/nissan|infiniti/i.test(`${data?.make || ''} ${data?.vehicle || ''}`)) return 'skip'
  if (nissanBatteryEnabled(data)) return 'have-row'
  if (Array.isArray(batteryLines) && batteryLines.length) return 'use-stored'
  if (Array.isArray(batteryLines)) return 'none'
  if (fileId) return 'read-file'
  return 'no-file'
}

/**
 * Create or enable Battery Reset from a battery D&R. A missing row is added.
 * A disabled row is turned on. Nothing here sets `_learned`.
 */
export function openNissanBattery(data, { text = '', batteryLines = null } = {}) {
  if (!/nissan|infiniti/i.test(`${data?.make || ''} ${data?.vehicle || ''}`)) return false
  const stored = Array.isArray(batteryLines) ? batteryLines.map(String).filter(Boolean) : []
  const fromText = text ? batteryDisconnectLines(text) : []
  const lines = [...new Set([...stored, ...fromText])]
  if (lines.length) return ensureNissanBatteryRow(data, lines)
  return noteNissanBatteryProcedure(data)
}

export function noteNissanBatteryProcedure(data, batteryLines) {
  if (!/nissan|infiniti/i.test(`${data?.make || ''} ${data?.vehicle || ''}`)) return false
  const row = (data?.calibrations || []).find(c => /battery.?disconnect reset|\bbattery reset\b|operations required after disconnecting battery/i.test(`${c?.calibration_name || ''} ${c?.sensor || ''} ${c?.name || ''} ${c?.operation_title || ''}`))
  if (!row) return false
  const fromArg = Array.isArray(batteryLines) ? batteryLines.map(String).filter(Boolean) : null
  if (fromArg && !fromArg.length) return false
  const turnedOn = row.enabled !== true
  if (turnedOn) row.enabled = true
  const fromRow = String(row.line_references || '').split(/,\s*/).map(s => s.trim()).filter(Boolean)
  const lines = [...new Set([...(fromArg || []), ...fromRow])]
  const where = lines.length
    ? `12V battery disconnect on line${lines.length > 1 ? 's' : ''} ${lines.join(', ')}.`
    : '12V battery disconnect.'
  const steps = `${where} Positive cable on first. Clamp both cables tight. Check the terminals for corrosion. Nissan procedure: ${NISSAN_BATTERY_MARK}. Power windows: Position Statement Power Window Servicing Post-Repair.`
  const note = `Review applicability. ${steps} Additional service: Additional Service When Removing Battery Negative Terminal. These references start the verification. They do not make every available reset mandatory.`
  const keepRequired = /^REQUIRED:/.test(String(row.classification || ''))
  const changed = setFields(row, {
    _reportRequired: true,
    _onReport: true,
    operation_title: BATTERY_RESET_TITLE,
    classification: keepRequired ? row.classification : CLASS_REVIEW,
    procedure: 'Initialization',
    trigger: steps,
    justification: note,
    required_before: 'None. This reviews which initializations apply. It is not a step in the radar chain.',
    repair_relationship: lines.length ? `Battery disconnect on line ${lines.join(', ')}.` : 'Battery disconnect on this estimate.',
    oem_reference: 'Operations Required after Disconnecting Battery; Position Statement Power Window Servicing Post-Repair; Additional Service When Removing Battery Negative Terminal',
  })
  let stripped = false
  for (const k of ['rate', 'price', 'hours', 'labor_hours']) if (k in row) { delete row[k]; stripped = true }
  return changed || turnedOn || stripped
}

/** Turn Nissan/Infiniti park rows off when the saved trigger is only a bumper drop. Mutates data. */
export function demoteNissanParkRows(data) {
  if (!/nissan|infiniti/i.test(`${data?.make || ''} ${data?.vehicle || ''}`)) return false
  let changed = false
  for (const c of data?.calibrations || []) {
    const n = `${c.calibration_name || ''} ${c.sensor || ''}`
    if (!/park|ultrasonic|sonar|pdc|parking sensor/i.test(n) || c.enabled !== true) continue
    if (!parkRowIsBumperOnly(c)) continue
    Object.assign(c, {
      enabled: false, trigger: '', line_references: '', _guard: 'demoted', justification: NISSAN_PARK_WHY,
      classification: 'NOT REQUIRED: VERIFIED', procedure: '—',
      required_before: 'None.',
      repair_relationship: 'Bumper-cover drop only. No sonar sensor line.',
      oem_reference: 'Nissan front bumper removal and installation. The sonar sensors are a separate step.',
    })
    changed = true
  }
  return changed
}

/**
 * Enforce the hard rules on a finished scrub. Mutates data.calibrations.
 * Returns what it changed so the report can say "guard: …".
 */
export async function guardScrub(data, base64Pdf, { hitsPromise = null, text = '' } = {}) {
  const out = { flipped: [], added: [], hits: {} }
  if (!data || !Array.isArray(data.calibrations)) return out
  let hits = {}
  try { hits = await (hitsPromise || triggerLines(base64Pdf)) } catch (e) { out.error = e.message; return out }   // ⚡ usually already running beside the main read
  out.hits = hits
  const cals = data.calibrations
  const make = String(data.make || ''), year = Number(data.year || 0)
  const per = (m, s) => `${m || 'OEM'} OEM position statement and ALLDATA ADAS procedure${s ? ' — ' + s : ''}`
  // Raw text of one numbered estimate line (CCC: "3 # Subl Seat Weight Sensor 1 100.00") — '' when we have no text.
  // Spaced out ("S01 Repl USED RT door assy") so word tests work on CCC's glued text.
  const lineRaw = n => { if (!text) return ''; const num = String(n).replace(/\D/g, ''); if (!num) return ''; for (const row of String(text).split(/\r?\n/)) { const r = parseEstimateRow(row); if (r && r.n === num) return [r.flags, r.sup, r.op, r.desc].filter(Boolean).join(' ') } return '' }
  // The CCC section heading a line sits under ("rear body & floor") — '' when we have no text.
  const sectionOf = (() => { const m = new Map(); for (const r of estimateRows(text)) if (!m.has(r.n)) m.set(r.n, r.section); return n => m.get(String(n).replace(/\D/g, '')) || '' })()

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
      : /nissan|infiniti/i.test(make)
        ? `Occupant classification (seat weight) zero point reset required per Nissan service information (ALLDATA "Repairs and Inspections Required After a Collision"): "Remove passenger seat assembly … Perform zero point reset function after front passenger seat is installed in the vehicle", whether or not the airbags deployed`
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
  // 4d. Mark 2026-10-02: "if a four wheel alignment is completed, the front radar needs
  //     to be calibrated, every make, if equipped." Flips the radar row the scrub listed
  //     (= the car has one). Honda/Acura excluded: Honda's job aid says radar/camera are
  //     NOT required after an alignment alone.
  if (al.length && !/honda|acura/i.test(make)) require(cals, /^front radar|front radar|distance sensor|acc radar|millimeter/i, 'Front Radar', 'Static',
    `Four-wheel alignment (line${al.length > 1 ? 's' : ''} ${al.join(', ')}) — the front radar must be re-aimed to the new thrust angle`, al,
    `Front radar calibration required per ${per(make, 'the radar is aimed to the vehicle thrust line, so a wheel alignment requires the radar to be calibrated')} (line${al.length > 1 ? 's' : ''} ${al.join(', ')}). Failure to calibrate presents a safety liability and does not meet ${make || 'OEM'} repair standards.`, out)
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
  // 5k. Nissan / Infiniti park sensors (2024 Ariya front bumper R&I, RO 8097,
  //     2026-10-20). Dropping the cover does not call for a sonar reset. The
  //     sonar sensors are a later, separate removal. Required only when a
  //     park / sonar / ultrasonic sensor line is removed, replaced, or transferred.
  if (/nissan|infiniti/i.test(`${make} ${data.vehicle || ''}`)) {
    const ps = lines(hits.park_sensor)
    if (ps.length) require(cals, /park|ultrasonic|sonar|pdc|parking sensor/i, 'Park Distance Sensor', 'Reset',
      `Park / sonar sensor removed, replaced or transferred (line${ps.length > 1 ? 's' : ''} ${ps.join(', ')})`, ps,
      `Parking sensor reset required because a sonar sensor was removed or replaced (line${ps.length > 1 ? 's' : ''} ${ps.join(', ')}). A bumper cover drop alone does not call for this reset.`, out, true)
    else if (demoteNissanParkRows(data)) out.demoted = [...(out.demoted || []), 'Park Distance Sensor']
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
    // Equipment gate (2018 Compass Sport vs 1Source, 2026-10-02): base Stellantis trims
    // have plain cruise and no radar. Required only when the VIN or the estimate shows
    // adaptive cruise / forward collision / emergency braking, or a radar line is on it.
    {
      const fr = cals.find(c => /^front radar|front radar|distance sensor|acc radar|adaptive cruise/i.test(String(c.calibration_name || '')) && !/side|corner/i.test(String(c.calibration_name || '')))
      const why = `${fr?.justification || ''} ${fr?.note || ''}`
      const equipped = rs.length > 0 || /adaptive cruise|emergency braking|forward collision/i.test(String(data.vin_equipment || '')) || (/adaptive cruise|\bacc\b|forward collision|full.?speed|emergency brak/i.test(why) && !/not equipped|no adaptive|not listed|base trim|if equipped/i.test(why))
      if (fr && fr.enabled === true && !equipped) {
        Object.assign(fr, { enabled: false, line_references: '', _guard: 'if-equipped', justification: 'If equipped with adaptive cruise / forward collision warning (front radar in the front bumper), the radar calibration is required after this bumper work — confirm at pre-scan. The VIN and estimate options do not show adaptive cruise or forward collision braking, so it is not billed by default.' })
        out.demoted = [...(out.demoted || []), 'Front Radar (Stellantis, no radar shown)']
      }
    }
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
  // 6. Backup vs Around View is decided in 6f, after the equipment gate.
  //    A rear-only surround line used to be renamed to Back Up Camera (2026-10-02).
  //    Mark 2026-10-19: when the car has Around View, that calibration covers the
  //    backup camera. Renaming it the other way double-billed the rear camera.

  // 6c. Front side (corner) radars (Mark 2026-10-02): only on select cars. Equipped
  //     (scrub says so, a corner-radar line, or the row already cites the options) +
  //     front bumper R&I/Repl → required. Not shown as equipped → "if equipped".
  {
    const fsr = cals.find(c => /front side radar|front corner|front cross/i.test(String(c.calibration_name || '')))
    if (fsr && fb.length) {
      const why = `${fsr.justification || ''} ${fsr.note || ''}`
      const equipped = String(fsr.equipped || '').toLowerCase() === 'yes' || /corner radar|side radar|cross.?traffic/i.test(String(rs.map(String).join(' '))) || /\b(equipped|options? (show|list)|front cross.?traffic|driving assistance|driver assist)/i.test(why) && !/if equipped|not equipped|unknown/i.test(why)
      if (equipped && fsr.enabled !== true) require(cals, /front side radar|front corner|front cross/i, 'Front Side Radar', 'Static', `Front bumper R&I/Repl (line${fb.length > 1 ? 's' : ''} ${fb.join(', ')}) — car has front corner radars`, fb,
        `Front corner (side) radar calibration required per ${per(make)}: the front corner radars mount behind the front bumper, and the bumper removal or replacement on line${fb.length > 1 ? 's' : ''} ${fb.join(', ')} disturbs them. Failure to calibrate presents a safety liability and does not meet ${make || 'OEM'} repair standards.`, out)
      if (!equipped && fsr.enabled === true) {
        Object.assign(fsr, { enabled: false, line_references: '', _guard: 'if-equipped', justification: 'If equipped with front corner radars, calibration is required after the front bumper removal — confirm at pre-scan. The estimate options and VIN do not show them, so it is not billed by default.' })
        out.demoted = [...(out.demoted || []), 'Front Side Radar (not shown as equipped)']
      }
    }
  }

  // 6d. Nissan/Infiniti Intelligent Around View only when the car has it (2022 Altima SR
  //     benchmark vs 1Source: base trims have only a rear camera).
  if (/nissan|infiniti/i.test(make)) {
    const av = cals.find(c => /around view|surround|360|bird/i.test(String(c.calibration_name || '')))
    const why = `${av?.justification || ''} ${av?.note || ''}`
    const equipped = String(av?.equipped || '').toLowerCase() === 'yes' || (/around view monitor|intelligent around view|options? (show|list)/i.test(why) && !/if equipped|unknown/i.test(why)) || lines(hits.camera).length > 0
    if (av && av.enabled === true && !equipped) {
      Object.assign(av, { enabled: false, line_references: '', _guard: 'if-equipped', justification: 'If equipped with Intelligent Around View Monitor, the camera calibration is required after this repair — confirm at pre-scan. The estimate options do not show Around View, so it is not billed by default.' })
      out.demoted = [...(out.demoted || []), 'Around View (Nissan, not shown as equipped)']
    }
  }

  // 6e. Around View on EVERY make only when the car has the system (Mark 2026-10-02,
  //     2022 Yukon Denali CH11819: "yes if the car has the around view system, this
  //     car does not"). Proof = the estimate itself (options block or a line) names a
  //     surround / 360 / around-view / bird's-eye / multi-view camera. The model's own
  //     "equipped" guess is not proof. Only judged when we have the estimate text.
  if (text) {
    const AV_PROOF = /surround[- ]?vision|surround[- ]?view|around[- ]?view|360[°º]?[- ]?(degree[- ]?)?(camera|view|vision)|bird'?s?[- ]?eye|multi[- ]?view camera|panoramic view (monitor|camera)|top[- ]?view camera|overhead (view )?camera|side view camera|hd surround/i
    // A bumper / mirror "Add for front camera" / "add for side camera" line is the MOTOR
    // add-on for a car that HAS the surround-view camera there (2019 AMG GT 53 RO 33607,
    // line 12 "Add for front camera", 2026-10-05: Kinetic required it, we demoted it).
    const AV_ADDFOR = /add[- ]?(?:for|'l)\s+(?:front|side|surround|360)[- ]?(?:view\s*)?camera/i
    const hasAv = AV_PROOF.test(text) || AV_ADDFOR.test(text)
    for (const av of cals.filter(c => /around view|surround|360|bird|multi[- ]?view/i.test(String(c.calibration_name || '')))) {
      if (av.enabled === true && !hasAv && !av._fs) {
        Object.assign(av, { enabled: false, line_references: '', equipped: 'unknown', _guard: 'if-equipped', justification: 'Not required — the estimate shows no surround-view (Around View / 360) camera system on this vehicle. If it is equipped, the Around View calibration is required after this repair — confirm at pre-scan.' })
        out.demoted = [...(out.demoted || []), 'Around View (no surround-view system shown)']
      }
    }
  }

  // 6f. Around View covers the backup camera (Mark 2026-10-19). When we are
  //     doing Around View, that procedure includes the rear camera, so Back Up
  //     Camera is not a second calibration. A car with a backup camera and no
  //     Around View still gets the Back Up Camera line. Runs after 6e so a
  //     demoted Around View cannot take the backup camera with it.
  {
    const isAvc = c => /around view|surround|multi.?view|360|bird/i.test(String(c.calibration_name || ''))
    const isBuc = c => /back ?up|rear ?view camera|rearview|reverse camera|rear camera/i.test(String(c.calibration_name || '')) && !/around|surround|360|mirror/i.test(String(c.calibration_name || ''))
    const avc = cals.find(c => isAvc(c) && c.enabled === true)
    if (avc) {
      for (const buc of cals.filter(c => isBuc(c) && c.enabled === true)) {
        Object.assign(buc, { enabled: false, trigger: '', line_references: '', _guard: 'covered-by-around-view', justification: 'Covered by the Around View calibration. The surround-view procedure includes the backup camera, so it is not a separate calibration on this vehicle.' })
        out.demoted = [...(out.demoted || []), 'Back Up Camera (covered by Around View)']
      }
      if (!/covers the backup camera/i.test(avc.justification || '')) avc.justification = `${avc.justification || ''} The Around View calibration covers the backup camera on this vehicle.`.trim()
    }
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
    if (fr && fr.enabled === true && !fb.length && !rs.length && !al.length && !makeRule && !frontPart.test(fr.trigger || '') && /windshield|w\/s|glass/i.test(trig)) {
      fr.enabled = false
      fr.justification = `Not required: a windshield replacement does not disturb the front radar (it sits behind the bumper/grille, not the glass), and no front bumper, grille, radar or alignment operation is on this estimate.`
      fr.trigger = ''; fr.line_references = ''; fr._guard = 'demoted'
      out.demoted = [...(out.demoted || []), 'Front Radar (windshield only)']
    }
  }
  // 7d. Front Windshield Camera only when something actually disturbs it: the glass out,
  //     the camera itself replaced, a wheel alignment / suspension or steering operation,
  //     or a make rule that set it (those carry _guard). A bumper / grille / front radar
  //     job alone does not re-aim the windshield camera on any OEM we carry — Mercedes-Benz
  //     ADAS guide: "the camera has to be re-calibrated if the windshield is replaced, the
  //     camera is replaced or the suspension is modified" (RO 33607 2026-10-05: we billed
  //     it on a bumper-only AMG GT; Kinetic did not).
  {
    const fwc = cals.find(c => /windshield camera|front camera|forward camera|multipurpose|lane depart/i.test(String(c.calibration_name || '')) && !/around|surround|360|side|rear|back/i.test(String(c.calibration_name || '')))
    // GM: front camera calibration after ANY collision (GM position statement; Kinetic
    // "In Collision" on every Chevy/GMC/Cadillac — Silverado HD, XT5, Equinox EV, Oct 2026).
    const gmCollision = /chevrolet|gmc|buick|cadillac/i.test(make)
    if (fwc && fwc.enabled === true && !fwc._guard && !fwc._fs && !gmCollision) {
      const camHit = lines(hits.camera).some(n => /windshield|w\/s|multipurpose|multi-purpose|forward|lane|mpc|front view camera unit|camera unit/i.test(lineRaw(n)))
      // Rear structure (quarter, rear body, floor) does not move the windshield camera (2023 Model 3 rear hit).
      const frontStructure = lines(hits.structural).some(n => { const t = `${sectionOf(n)} ${lineRaw(n)}`; return /(a-?pillar|hinge pillar|front pillar|windshield|roof|cowl|dash|apron|radiator support|core support|front rail|frame rail|upper rail|\brail\b)/i.test(t) && !/\b(rear|quarter|floor|trunk)\b/i.test(t) })
      const disturbed = ws.length || al.length || camHit || frontStructure || /\b(strut|control arm|knuckle|subframe|steering (gear|rack|column)|tie rod|suspension|ride height)\b/i.test(JSON.stringify(cals.map(c => c.trigger || '')) + ' ' + (text || '').slice(0, 20000))
      if (!disturbed) {
        const mb = /mercedes|benz/i.test(make)
        Object.assign(fwc, { enabled: false, trigger: '', line_references: '', _guard: 'demoted',
          justification: mb ? 'Not required — Mercedes-Benz: the multifunction camera is re-calibrated only if the windshield is replaced, the camera is replaced or the suspension is modified. None of those operations is on this estimate (front bumper / grille / radar work does not disturb the windshield camera). Confirm at pre-scan.'
            : `Not required — the windshield camera is re-aimed when the windshield is replaced, the camera is replaced, or an alignment / suspension / steering operation is performed. None of those is on this estimate; a bumper, grille or front radar job does not disturb the windshield camera on ${make || 'this make'}. Confirm at pre-scan.` })
        out.demoted = [...(out.demoted || []), 'Front Windshield Camera (nothing disturbs it)']
      }
    }
  }
  // 7b. 🔑 Module programming (Mark 2026-10-02): "any module replaced … programming will
  //     need to be added … every make and model except Toyota and Honda." One line,
  //     "Module Programming and Reflash - <Make>" (the Books item; body shops get the
  //     Collision twin), quantity = modules replaced, each module named.
  {
    // Never from a sublet or a non-replace line (RO 33607 2026-10-05: "# Subl Seat Weight
    // Sensor" was counted as a module replaced and a programming line went on the report).
    const mods = lines(hits.module_repl).filter(n => { const r = lineRaw(n); if (!r) return true; if (/\bsubl(et)?\b/i.test(r)) return false; return /\b(repl|r&r|replace)\b/i.test(r) })
    if (mods.length && make && !/toyota|lexus|honda|acura/i.test(make)) {
      const MAKES = { chevrolet: 'Chevrolet', chevy: 'Chevrolet', gmc: 'GMC', buick: 'Buick', cadillac: 'Cadillac', ford: 'Ford', lincoln: 'Lincoln', dodge: 'Dodge', chrysler: 'Chrysler', jeep: 'Jeep', ram: 'Ram', fiat: 'Fiat', 'alfa romeo': 'Alfa Romeo', alfa: 'Alfa Romeo', audi: 'Audi', volkswagen: 'Volkswagen', vw: 'Volkswagen', bmw: 'BMW', mini: 'MINI', 'mercedes-benz': 'Mercedes-Benz', mercedes: 'Mercedes-Benz', porsche: 'Porsche', volvo: 'Volvo', 'land rover': 'Land Rover', jaguar: 'Jaguar', nissan: 'Nissan', infiniti: 'Infiniti', hyundai: 'Hyundai', kia: 'Kia', genesis: 'Genesis', mazda: 'Mazda', subaru: 'Subaru', mitsubishi: 'Mitsubishi', tesla: 'Tesla', rivian: 'Rivian' }
      const mk = MAKES[String(make).toLowerCase().trim()] || Object.entries(MAKES).find(([k]) => String(make).toLowerCase().includes(k))?.[1] || make
      const name = `Module Programming and Reflash - ${mk}`
      if (!cals.some(c => /module programming/i.test(String(c.calibration_name || '')) && c.enabled === true)) {
        cals.push({ calibration_name: name, cal_type: 'Programming', trigger: `Module replaced (line${mods.length > 1 ? 's' : ''} ${mods.join(', ')})`, line_references: mods.join(', '), quantity: mods.length, enabled: true, equipped: 'yes', _guard: 'added',
          justification: `Module programming / coding required per ${per(mk)}: ${mods.length} electronic module${mods.length > 1 ? 's are' : ' is'} replaced on this estimate (line${mods.length > 1 ? 's' : ''} ${mods.join(', ')}). A new ${mk} module must be programmed and configured to this VIN (and coded where the OEM requires it) before it will operate and before any related calibration can be performed. One programming operation per module.` })
        out.added.push(`${name} ×${mods.length} ← ${mods.join(', ')}`)
      }
    }
  }

  // 7e. The outside mirror carries the blind spot WARNING LIGHT, not the radar (the radars
  //     sit behind the rear bumper / quarter). A blind spot cal cited only on a mirror line is
  //     a model error (2021 Silverado HD: "mirror carries blind spot radar hardware"; Kinetic: no).
  {
    const bsm = cals.find(c => /blind.?spot|rear.*radar/i.test(String(c.calibration_name || '')) && !/front/i.test(String(c.calibration_name || '')))
    const refs = String(bsm?.line_references || '').split(/[,\s]+/).filter(Boolean)
    const rearWork = rb.length || lines(hits.rear_bumper_rpr).length || lines(hits.structural).some(n => /quarter|rear|wheelhouse/i.test(lineRaw(n))) || rs.length
    if (bsm && bsm.enabled === true && !bsm._guard && refs.length && !rearWork && refs.every(n => /mirror/i.test(lineRaw(n)))) {
      Object.assign(bsm, { enabled: false, trigger: '', line_references: '', _guard: 'demoted',
        justification: 'Not required — the outside mirror holds only the blind spot warning indicator; the blind spot radars are behind the rear bumper / quarter panels, and no rear bumper, quarter panel or radar operation is on this estimate. Confirm the system at post-scan.' })
      out.demoted = [...(out.demoted || []), 'Rear Blind Spot Radar (mirror only)']
    }
  }

  // 7c. GM front radar + windshield camera are DYNAMIC (drive-cycle) learns (1Source
  //     2025 Yukon: "Radar Sensor Module – Long Range Learn" / "Front View Camera Module
  //     Learn", both Dynamic; Kinetic agrees). Rear blind spot radar too (Mark
  //     2026-10-02: "both calibrations are dynamic, the rear blind spot and front radar").
  if (/chevrolet|gmc|buick|cadillac/i.test(make)) for (const c of cals) {
    const n = String(c.calibration_name || '')
    if (c.enabled !== true) continue
    if (/^front radar|long range|windshield|front camera|front view camera/i.test(n) && !/side|corner/i.test(n)) c.cal_type = 'Dynamic'
    else if (/blind ?spot|side object|rear.*radar|\bbsm\b|side blind/i.test(n)) c.cal_type = 'Dynamic'
  }

  // 8. 🔎 Equipment check on every sensor row (Mark 2026-10-02, "yes" to checking
  //    equipment across all makes after the Altima / Compass over-calls). The scrub
  //    marks each row equipped yes / no / unknown. A required row on a car that clearly
  //    lacks the sensor → "if equipped, confirm at pre-scan" (not billed); unknown → stays
  //    required with a confirm note. The VIN decode or the sensor's own estimate line wins.
  {
    const vinEq = String(data.vin_equipment || '')
    const GATES = [
      { re: /^front radar|distance sensor|acc radar|millimeter/i, vin: /adaptive cruise|emergency braking|forward collision/i, lines: rs, what: 'adaptive cruise / forward collision (front radar)' },
      { re: /front side radar|front corner|front cross/i, vin: /$^/, lines: rs, what: 'front corner radars' },
      { re: /blind.?spot|rear.*radar|\bbsd\b/i, vin: /blind spot|rear cross/i, lines: rs, what: 'blind spot monitoring' },
      { re: /windshield|front camera|multipurpose|lane depart|forward camera/i, vin: /lane keep|lane departure|forward collision|emergency braking/i, lines: [...ws, ...cam], what: 'a forward-facing windshield camera' },
      { re: /around view|surround|multi.?view|360|bird/i, vin: /$^/, lines: cam, what: 'a surround-view (360) camera system' },
      { re: /park|ultrasonic|sonar|pdc|parking aid/i, vin: /park assist/i, lines: lines(hits.park_sensor), what: 'park sensors' },
    ]
    for (const c of cals) {
      if (c.enabled !== true || c._fs) continue
      const g = GATES.find(x => x.re.test(String(c.calibration_name || '')) && !(x.re === GATES[0].re && /side|corner/i.test(String(c.calibration_name || ''))))
      if (!g) continue
      const eq = String(c.equipped || '').toLowerCase()
      const proven = g.vin.test(vinEq) || (g.lines || []).length > 0 || eq === 'yes'
      if (proven) continue
      if (eq === 'no') {
        Object.assign(c, { enabled: false, line_references: '', _guard: 'if-equipped', justification: `If equipped with ${g.what}, this calibration is required after this repair — confirm at pre-scan. The VIN decode and estimate options show this trim without it, so it is not billed by default.` })
        out.demoted = [...(out.demoted || []), `${c.calibration_name} (not equipped)`]
      } else if (!/confirm (it is )?equipped|if equipped/i.test(c.justification || '')) {
        c.justification = `${c.justification || ''} Confirm the vehicle is equipped with ${g.what} at pre-scan.`.trim()
      }
    }
  }

  const teslaBsm = stripTeslaBlindSpot(data)
  if (teslaBsm.length) {
    out.dropped = [...(out.dropped || []), ...teslaBsm.map(n => `${n}: Tesla has no blind spot sensors`)]
    console.log(`[guard] Tesla: dropped blind spot — ${teslaBsm.join(' · ')}`)
  }

  // Nissan distance-sensor chain. Alignment is the prerequisite. Steering angle
  // stays conditional unless an alignment line is an adjustment, not an inspection.
  const adjustedAl = al.filter(n => {
    const raw = lineRaw(n).toLowerCase()
    if (!raw) return true
    return !(/inspect|inspection/.test(raw) && !/\badjust/.test(raw))
  })
  if (noteNissanRadarAlignment(data, al, { adjustmentLines: adjustedAl })) out.added.push('4-Way Alignment prerequisite')

  // Nissan/Infiniti battery reconnect. The battery bucket already matched, or
  // this does nothing. It writes on the reset row from 4a. It does not add a
  // row and it does not turn the steering angle sensor on.
  if (noteNissanBatteryProcedure(data, bat)) out.noted = [...(out.noted || []), 'Battery Operations: 12V reconnect procedure']

  if (out.flipped.length || out.added.length) console.log(`[guard] ${make} ${data.year || ''}: flipped ${out.flipped.length}, added ${out.added.length}${out.demoted ? `, demoted ${out.demoted.length}` : ''} — ${[...out.flipped, ...out.added, ...(out.demoted || [])].join(' · ')}`)
  data._guard = { flipped: out.flipped, added: out.added }
  return out
}
