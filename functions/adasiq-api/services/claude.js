import Anthropic from '@anthropic-ai/sdk'

// Always read key fresh from env so dotenv override is respected
function getClient() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
}

const SYSTEM_PROMPT = `You are ADAS IQ. You read Kinetic calibration identification report PDFs and extract all calibration systems listed -- both required and not required.

From the PDF provided extract the following:

HEADER FIELDS:
- shop: the REPAIR FACILITY / body shop name, ONLY if one is explicitly named (look for Repairer, Repair Facility, Shop, or a body-shop company name). IMPORTANT: Kinetic reports label the INSURANCE COMPANY as "Customer:" — that is NOT the shop. If the only company named is an insurance company, return "" for shop. Never put an insurance company name in the shop field.
- claim: claim number
- insurer: insurance company name (this is usually the "Customer:" line on Kinetic reports, e.g. "Allstate Fire And Casualty Insurance Company")
- ro_number: repair order number
- vehicle: full vehicle description (year make model trim) — the complete string
- year: model year as a 4-digit string (e.g. "2022")
- make: manufacturer name only (e.g. "Toyota")
- model: model name and trim only, no year or make (e.g. "RAV4 XSE Hybrid")
- vin: VIN number

CALIBRATIONS:
Extract EVERY calibration system listed in the Operations table — both those marked Required AND those marked Not Required.

Set the "enabled" field based on the Required/Not Required status in the report:
- If the calibration is marked "Required" → enabled: true
- If the calibration is marked "Not Required" → enabled: false

For each calibration return:
- calibration_name: name of the system (e.g. "Steering Angle Sensor")
- cal_type: "Static", "Dynamic", or null if not listed
- trigger: trigger description (e.g. "In Collision") or null if not listed
- line_references: line numbers listed (e.g. "3, 6, 8, 11, 17, 20, 33, 37, 69") or null if not listed
- justification: one sentence referencing the OEM position statement and ALLDATA ADAS procedure. For REQUIRED calibrations use: "[System name] calibration required per [Make] OEM position statement and ALLDATA ADAS procedure following collision repair. [One sentence explaining why.] Failure to calibrate presents a safety liability and does not meet [Make] OEM repair standards." For NOT REQUIRED calibrations use: "[System name] calibration not required for this repair — the estimate contains no operations that disturb this sensor per [Make] OEM position statement and ALLDATA ADAS procedure." Never include the safety-liability sentence on a Not Required calibration.
- enabled: true if Required, false if Not Required
- links: array of all hyperlinks/URLs found in the PDF that are associated with this calibration (OEM position statements, ALLDATA procedure links, TSB links, etc.). Each entry should be: { "label": "descriptive label", "url": "https://..." }. Extract the actual URLs visible in the document or embedded as hyperlinks. If no links are found for this calibration, return an empty array [].

Also extract any document-level links:
- document_links: array of any general links in the report not tied to a specific calibration (e.g. Kinetic company links, general OEM references). Each entry: { "label": "descriptive label", "url": "https://..." }. Return [] if none.

Return a single JSON object only. No explanation, no preamble, no markdown. Raw JSON only.

Format:
{
  "shop": "",
  "claim": "",
  "insurer": "",
  "ro_number": "",
  "vehicle": "",
  "year": "",
  "make": "",
  "model": "",
  "vin": "",
  "document_links": [],
  "calibrations": [
    {
      "calibration_name": "",
      "cal_type": null,
      "trigger": null,
      "line_references": null,
      "justification": "",
      "enabled": true,
      "links": []
    }
  ]
}`

const CCC_SYSTEM_PROMPT = `You are the Absolute ADAS calibration identifier. You read a CCC ONE collision repair estimate and produce a Calibration Identification Report: for EVERY ADAS sensor/system this exact vehicle carries, a verdict of Required or Not Required, with the estimate line numbers that triggered it. Accuracy matters more than volume — a false "required" costs the shop money and our credibility; a missed one is a safety liability. Work like a senior ADAS technician reading the estimate line by line.

STEP 1 — HEADER
shop (repair facility in the letterhead, not the owner or inspection location), claim, insurer, ro_number ("RO Number"), vehicle (full description line), year, make (full manufacturer name: Toyota not TOYO, Mercedes-Benz not BENZ, Chevrolet not CHEV, Hyundai not HYUN, Volkswagen not VOLK), model (model name plus trim, no body/drive codes), vin, point_of_impact, estimate_version ("Estimate", "Supplement of Record 1", …).

STEP 2 — SENSOR INVENTORY (what THIS vehicle has)
Build the list of ADAS sensors from (a) the options/equipment section and (b) what you know this year/make/model/trim ships with. Use these sensor names exactly when they apply:
- "Front Windshield Camera" (LDW/LKA/PCS/AEB/TSR/AHB/EyeSight/Honda Sensing camera — present on nearly every 2018+ vehicle; "Lane Departure Warning" or "Intelligent/Adaptive Cruise" in the options confirms it)
- "Front Radar" (ACC / pre-collision radar behind the grille or emblem or in the lower bumper)
- "Front Side Radar" (front cross-traffic / front corner radars — Toyota Safety Sense 3.0+, Honda 2023+, Hyundai/Kia, Mercedes-Benz, BMW, Audi, VW, Ford, GM with FCTA)
- "Rear Blind Spot Radar — Left" and "Rear Blind Spot Radar — Right" (BSM/BLIS/RCTA radars — "Blind Spot Detection" in options)
- "Back Up Camera"
- "Around View Camera" (only when options/knowledge show 360 / surround / panoramic / bird's-eye view — then also side cameras in the mirrors)
- "Park Distance Sensor" (ultrasonic front/rear sensors)
- "Steering Angle Sensor"
- "Seat Weight Sensor" (occupant classification, front passenger seat)
- "Headlamp Aim" (only when a headlamp assembly is replaced)
- "Night Vision Camera", "Driver Monitor Camera", "Rear Radar (rear AEB)", "Rear Camera Mirror" — only when equipped.
Do not list a sensor the vehicle does not have. When equipment is unclear, list it and decide from the repairs (an untouched sensor is simply Not Required).
The CCC options block is the insurer's build data and is often INCOMPLETE — it may omit the surround-view system, front radar or front side radars the trim actually has. So: (a) on Mercedes-Benz, BMW, Audi, Porsche, Volvo, Land Rover, Genesis, Lexus, Acura, Infiniti and any trim above base, assume the model-year-standard ADAS suite (Mercedes-Benz 2020+: Active Brake Assist front radar is standard even when a line says "w/o adaptive cruise"; a 360° camera is common with the Parking Package — its front camera sits in the grille star/emblem, side cameras in the mirrors, rear camera in the liftgate handle); (b) when a grille, emblem, mirror assembly, liftgate handle or bumper cover that carries a surround-view camera is R&I'd or replaced, list "Around View Camera" as REQUIRED with note "if equipped — confirm at pre-scan"; (c) a line reading "w/o adaptive cruise" only means no Distronic/ACC — the AEB radar is still there on 2018+ Mercedes-Benz, BMW, Audi, Toyota, Honda, Subaru, Nissan, Hyundai/Kia; (d) on Mercedes-Benz, BMW, Audi, Porsche, Volvo, Land Rover, Genesis and Lexus 2019+, ALWAYS carry "Around View Camera" in the inventory and let the repairs decide its verdict.
CCC naming traps: on Mercedes-Benz and BMW, "Distance sensor" / "Park distance sensor" lines under FRONT BUMPER or REAR BUMPER are PARKTRONIC/PDC ultrasonic sensors — NOT radars; they never trigger Front Radar or Front Side Radar. "Front Side Radar" is only on trims with the Driving Assistance Package / front cross-traffic; when the options do not show it and no line names a corner radar, mark it Not Required (do not guess it Required). Ultrasonic park sensors are plug-and-play on Mercedes-Benz too (Not Required after Repl) — only Audi/VW, BMW (2019+ PDC coding), Volvo and Land Rover need a sensor learn.

STEP 3 — READ EVERY LINE. The operation column decides everything:
- Repl / R&R = replace (part removed, new or recycled part installed). Rpr = repair of the panel in place. R&I = remove and reinstall the SAME part. Blnd = blend refinish only. Refn = refinish only. Subl = sublet. "Incl." lines still count as R&I of that part. D&R = disconnect and reconnect (battery).
- BLEND, REFINISH, CLEAR COAT, MASKING, "add for", corrosion protection, hazardous waste, cover car, labels, mylar/film, and PRE/POST SCAN lines NEVER trigger a calibration.
- R&I of interior trim, pillar trim (windshield pillar trim, center pillar trim, kick panels, scuff plates), moldings, weatherstrips, handles, glass run channels, door glass, applique, liners, wheel opening moldings, sight shields, mirror COVERS/glass NEVER trigger a calibration.
- A door shell, hinge, striker, lock, regulator or window motor NEVER triggers a calibration (no ADAS sensor lives in a door) unless the door carries a side camera of an Around View system that is being replaced.
- A trigger must name the sensor, the panel it is mounted to, or the OEM-documented reset condition. "Near the impact" is not a trigger.

STEP 4 — TRIGGER RULES PER SENSOR (apply the operation type strictly)
Front Windshield Camera → REQUIRED for: windshield Repl/R&R/R&I; camera or camera bracket/cover R&I or Repl; roof panel or roof rail Repl/section; headliner R&I ONLY when the camera is unplugged/removed with it (Subaru EyeSight, Mazda, some Honda); dash panel/cowl structural Repl; wheel alignment or suspension geometry work on makes whose OEM requires camera cal after alignment (Subaru, Honda/Acura, Mazda, Hyundai/Kia, Nissan). NOT for pillar trim, sun visor, mirror, tint, or wiper work.
Front Radar → REQUIRED for: Repl of front bumper cover / fascia / grille / upper grille / grille emblem / lower grille / impact bar / absorber / radiator support / bumper bracket; radar or radar bracket R&I or Repl; any front structural repair (rails, apron, core support); wheel alignment or front suspension/steering Repl on makes that require radar aim after alignment (Toyota/Lexus, Honda/Acura, Subaru, Nissan/Infiniti, Hyundai/Kia, Mazda). R&I of the bumper cover alone ("R&I bumper cover", "bumper cover — drop") is NOT REQUIRED unless the radar or its bracket is also removed, EXCEPT Honda/Acura, Nissan/Infiniti, Hyundai/Kia and Mercedes-Benz, whose position statements require radar aiming any time the front bumper is removed.
Front Side Radar → same triggers as Front Radar for the front bumper cover/fascia and front corner brackets; R&I alone Not Required unless the make above.
Rear Blind Spot Radar (Left / Right) → REQUIRED for: Repl of rear bumper cover / fascia / rear impact bar / absorber; radar or radar bracket R&I or Repl; quarter panel Repl or section; rear body panel / trunk floor structural repair; rear-end structural pull. R&I of the rear bumper cover alone Not Required EXCEPT Honda/Acura, Nissan/Infiniti, Hyundai/Kia, Mercedes-Benz (aim after any bumper removal). Quarter panel Rpr/Blnd, tail lamp, liftgate, door and MIRROR work do NOT trigger a rear radar. Mirror-mounted blind spot radars exist only on a few older vehicles (some Volvo, some GM/Cadillac 2013–2016, some Mercedes-Benz); Toyota/Lexus, Honda/Acura, Subaru, Nissan, Hyundai/Kia, Ford, Mazda, VW, BMW, Stellantis mount them behind the rear bumper. Only the side the work is on, unless the bumper/impact bar is replaced (then both).
Back Up Camera → REQUIRED for: camera Repl or R&I; Repl of the liftgate / tailgate / trunk lid / decklid or the garnish/handle assembly the camera is mounted in; rear bumper cover Repl when the camera lives in the bumper. R&I of the liftgate alone (hinges undisturbed) Not Required unless the camera is unplugged and removed.
Around View Camera → REQUIRED for: any side camera / mirror assembly Repl, front camera (grille) or rear camera Repl, bumper cover Repl carrying a camera, liftgate Repl. Only when equipped.
Park Distance Sensor → REQUIRED only for makes whose sensors need coding/registration after Repl (BMW, Audi/VW, Volvo, Land Rover) or when the OEM calls for a sensor learn after bumper Repl. Toyota/Honda/Subaru/Ford/GM/Mercedes-Benz sensors are plug-and-play → Not Required.
Steering Angle Sensor → REQUIRED for: wheel alignment (labor or sublet); Repl or Rpr of knuckle, control arm, strut, spring, tie rod, rack, steering column, subframe/crossmember, wheel bearing/hub; front structural repair; battery D&R / disconnect on Toyota/Lexus, Honda/Acura, Subaru, Nissan/Infiniti, Hyundai/Kia, Mazda, Mitsubishi (zero-point / neutral memorization after power loss); any suspension part removed from the vehicle; airbag deployment (steering wheel).
Seat Weight Sensor → REQUIRED for: front passenger seat Repl, R&I or removal (seat cushion, track, frame), seat belt pretensioner/buckle Repl, airbag deployment (SRS repairs) on Toyota/Lexus, Honda/Acura, Subaru, Nissan, Mazda, Hyundai/Kia (occupant classification zero-point). Battery disconnect alone does NOT trigger it.
Headlamp Aim → REQUIRED when a headlamp assembly is Repl (list it even if the estimate already has an aim line — mark trigger "already on estimate" in that case). R&I of a halogen headlamp Not Required. On Mercedes-Benz, BMW, Audi, Porsche, Volvo, Lexus and Genesis with LED / Xenon / adaptive / MULTIBEAM headlamps ("Xenon or L.E.D. Headlamps" in the options), headlamp R&I OR Repl → REQUIRED, calibration_name "Headlamp Module Initialization / Aim" (the module must be re-initialized and aimed after removal).
Rivian, Tesla, Lucid: also list the OEM pre-calibration procedures the maker publishes (Rivian: Pre ADAS-Calibration Inspection, RiDE Set-Up, Driver Assistance Calibration Setup).

STEP 5 — VERDICTS
Every sensor in the inventory appears once in "calibrations":
- REQUIRED → enabled: true, trigger = the operation in plain words ("Battery D&R", "Front bumper cover replaced", "LT quarter panel replaced"), line_references = the exact line numbers (e.g. "88" or "5, 9"), justification = 2–3 sentences for the insurer: "[System] calibration required per [Make] OEM position statement and repair procedures following collision repair. [What was done and why it disturbs / requires a reset of this sensor.] Failure to calibrate presents a safety liability and does not meet [Make] OEM repair standards."
- NOT REQUIRED → enabled: false, trigger = "", line_references = "", justification = one sentence: "Not required — no operation on this estimate disturbs the [sensor] (nearest operation: line N, [what it was], which does not affect it)." If nothing is near it, "Not required — no operation on this estimate affects this sensor."
- If a verdict is a judgment call, keep the verdict and add a short "note" ("verify at pre-scan: camera bracket may be disturbed by the roof rail repair").
Also fill: sensor (the inventory name), cal_type ("Static", "Dynamic", "Static/Dynamic" or "Reset" for SAS/seat weight/aim), links [].
Never include pre/post scan as a calibration. Never duplicate. Count required operations in "required_count".

Return ONE raw JSON object, no markdown, no prose:
{
  "shop": "", "claim": "", "insurer": "", "ro_number": "", "vehicle": "", "year": "", "make": "", "model": "", "vin": "",
  "point_of_impact": "", "estimate_version": "", "required_count": 0,
  "document_links": [],
  "calibrations": [
    { "sensor": "", "calibration_name": "", "enabled": true, "cal_type": "", "trigger": "", "line_references": "", "justification": "", "note": "", "links": [] }
  ]
}
calibration_name = the sensor name plus the word "Calibration" (or "Reset" / "Zero Point" / "Aim" where that is the procedure), e.g. "Steering Angle Sensor Zero Point", "Front Radar Calibration", "Rear Blind Spot Radar — Left Calibration".`

/**
 * Detect whether a PDF is a CCC ONE estimate or a Kinetic calibration report.
 * Uses a lightweight Claude call on just the first ~2 pages worth of text.
 */
export async function detectPdfType(base64Pdf) {
  const message = await getClient().messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 20,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: base64Pdf },
        },
        {
          type: 'text',
          text: 'Is this a CCC ONE collision repair estimate or a Kinetic ADAS calibration report? Reply with exactly one word: CCC or KINETIC.',
        },
      ],
    }],
  })
  const answer = message.content[0].text.trim().toUpperCase()
  return answer.includes('CCC') ? 'CCC' : 'KINETIC'
}

/**
 * Extract calibration data from a CCC ONE estimate PDF.
 * @param {Buffer} pdfBuffer
 * @returns {Promise<Object>} parsed JSON matching Kinetic extractor format
 */
export async function extractFromCccPdf(pdfBuffer) {
  const base64Pdf = pdfBuffer.toString('base64')

  const message = await getClient().messages.create({
    model: 'claude-opus-4-7',  // best model + adaptive thinking: this is a judgment task (Kinetic benchmark 2026-09-24)
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    system: CCC_SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: base64Pdf },
        },
        {
          type: 'text',
          text: 'Analyze this CCC ONE collision estimate. Identify all ADAS calibrations required based on the vehicle equipment and repair operations. Return raw JSON only.',
        },
      ],
    }],
  })

  const raw = (message.content.find(b => b.type === 'text')?.text || '').trim()
  const cleaned = raw.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim()

  let parsed
  try {
    parsed = JSON.parse(cleaned.slice(cleaned.indexOf('{'), cleaned.lastIndexOf('}') + 1))
  } catch {
    throw new Error(`Claude returned invalid JSON: ${cleaned.slice(0, 200)}`)
  }
  parsed.calibrations = Array.isArray(parsed.calibrations) ? parsed.calibrations.map(c => ({ ...c, enabled: c.enabled === true, line_references: c.line_references || null, links: [] })) : []

  // Tag as CCC so the extract route can cross-reference rules DB
  parsed._pdfType = 'CCC'
  // Build repair text and equipment text for rules matching (from calibrations triggers)
  parsed._repairText = (parsed.calibrations || []).map(c => c.trigger || '').join(' ')
  parsed._vehicleEquipment = (parsed.calibrations || []).map(c => c.calibration_name || '').join(' ')

  return parsed
}

/**
 * Extract calibration data from a PDF buffer using Claude.
 * Auto-detects whether it is a Kinetic report or a CCC ONE estimate.
 * @param {Buffer} pdfBuffer
 * @returns {Promise<Object>} parsed JSON from Claude
 */
export async function extractFromPdf(pdfBuffer) {
  const base64Pdf = pdfBuffer.toString('base64')

  // Auto-detect PDF type
  let pdfType = 'KINETIC'
  try {
    pdfType = await detectPdfType(base64Pdf)
    console.log(`[extract] PDF type detected: ${pdfType}`)
  } catch (e) {
    console.warn('[extract] PDF type detection failed, defaulting to KINETIC:', e.message)
  }

  // Route to appropriate extractor
  if (pdfType === 'CCC') {
    return extractFromCccPdf(pdfBuffer)
  }

  // Kinetic extractor
  const message = await getClient().messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 8192,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: base64Pdf,
            },
          },
          {
            type: 'text',
            text: 'Extract all calibration data from this Kinetic report and return raw JSON only.',
          },
        ],
      },
    ],
  })

  const raw = message.content[0].text.trim()
  const cleaned = raw.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim()

  let parsed
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    throw new Error(`Claude returned invalid JSON: ${cleaned.slice(0, 200)}`)
  }

  return parsed
}

const JOB_AID_SYSTEM_PROMPT = `You are ADAS IQ's rule extraction engine. You read automotive documents — OEM position statements, ADAS calibration guides, I-CAR materials, collision repair job aids, service bulletins, or any industry reference material — and extract structured calibration trigger rules from them.

For each rule you find, identify:
- calibration_name: the ADAS system requiring calibration (e.g. "Pre-Collision System / Front Radar")
- cal_type: "Static", "Dynamic", or "Static/Dynamic" — if not specified, use "Static"
- trigger_category: one of WINDSHIELD, FRONT_BUMPER, FRONT_SUSPENSION, HEADLIGHTS, REAR_BUMPER, QUARTER_PANEL, MIRROR, REAR_CAMERA, PARKING_SENSORS, SURROUND_VIEW, BATTERY, or OTHER
- trigger_keywords: comma-separated list of repair operations or components that trigger this calibration (e.g. "windshield,front glass,w/s replace")
- required_equipment: comma-separated list of ADAS systems the vehicle must be equipped with for this rule to apply (leave empty if it applies to all vehicles)
- make: vehicle make this applies to — if make-specific (e.g. "Toyota"), or leave empty for universal rules
- model: vehicle model — leave empty if it applies to all models of that make
- year_start: earliest model year this applies to — leave empty if unknown or universal
- year_end: latest model year — leave empty if ongoing
- justification_template: a professional 2-3 sentence justification paragraph suitable for an insurance estimate. Use {make} and {model} as placeholders. Reference OEM position statements and safety implications.
- source: always "JOB_AID"
- notes: any additional context, caveats, or source reference from the document

IMPORTANT RULES:
- Only extract rules where a specific repair/replacement operation triggers a specific calibration requirement
- Do not duplicate rules — if the same calibration is mentioned multiple times, extract it once with the broadest trigger keywords
- If the document references specific OEM procedures, include the procedure name in the justification_template
- Extract as many distinct rules as possible — be thorough
- If a rule is make-specific, set the make field; if it applies to all makes, leave it empty

Return ONLY a raw JSON array of rule objects. No explanation, no markdown, no wrapper object — just the array.

Example output format:
[
  {
    "calibration_name": "Pre-Collision System / Front Radar",
    "cal_type": "Static",
    "trigger_category": "FRONT_BUMPER",
    "trigger_keywords": "front bumper,front fascia,grille,grille emblem",
    "required_equipment": "Pre-Collision System,ACC,Adaptive Cruise",
    "make": "",
    "model": "",
    "year_start": "",
    "year_end": "",
    "justification_template": "Front radar calibration required per {make} OEM position statement following front bumper or grille replacement...",
    "source": "JOB_AID",
    "notes": "Per I-CAR position statement PLG01"
  }
]`

/**
 * Extract calibration rules from any automotive job aid, OEM position statement, or reference PDF.
 * @param {Buffer} pdfBuffer
 * @returns {Promise<Array>} array of rule objects ready to save to AdasCalibrationRules
 */
export async function extractRulesFromJobAid(pdfBuffer) {
  const base64Pdf = pdfBuffer.toString('base64')

  const message = await getClient().messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 8192,
    system: JOB_AID_SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: base64Pdf },
        },
        {
          type: 'text',
          text: 'Read this document carefully and extract every ADAS calibration trigger rule you can find. Return a raw JSON array only.',
        },
      ],
    }],
  })

  const raw = message.content[0].text.trim()
  const cleaned = raw.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim()

  let rules
  try {
    rules = JSON.parse(cleaned)
    if (!Array.isArray(rules)) throw new Error('Expected array')
  } catch {
    throw new Error(`Rule extraction returned invalid JSON: ${cleaned.slice(0, 200)}`)
  }

  return rules
}

/**
 * Clean up per-calibration justification notes on the Manual Invoice
 * screen (Mark 2026-07-14). Techs type shorthand like "lines 12 and 14"
 * (= flagged lines on the CCC estimate they're reading) — turn each into
 * a short professional justification with the OEM reasoning and the
 * standard repair trigger for that calibration type.
 *
 * @param {Object} params { year, make, model, items: [{ name, description }] }
 * @returns {Promise<string[]>} cleaned descriptions, same order as items
 */
// Propose Item Map pairings: Kinetic sensor names → Zoho Books catalog
// items. Seeds the More → Item Mapping table; Mark reviews/corrects.
export async function proposeItemMap({ kineticNames, catalogItems }) {
  const catalog = catalogItems.map(i => `- ${i.name} ($${i.rate || 0}) [id ${i.item_id}]`).join('\n')
  const names = kineticNames.map((n, i) => `${i + 1}. ${n}`).join('\n')

  const message = await getClient().messages.create({
    model: 'claude-opus-4-7',
    max_tokens: 2500,
    messages: [{
      role: 'user',
      content: `You map ADAS sensor names from Kinetic calibration reports to a calibration company's Zoho Books item catalog.

ZOHO BOOKS ITEM CATALOG (the only valid targets — use exact names and ids from this list; prefer NON-prefixed items; ignore items starting with "AS", "SF", "SFP", "CP" — those are insurer price variants handled separately):
${catalog}

KINETIC SENSOR NAMES to map:
${names}

Rules:
- Map each sensor to the catalog item that BILLS for calibrating it (e.g. "Around View Camera" → a 360/surround camera calibration item; "Front Windshield Camera" → front camera calibration; "Rear Blind Spot Radar" → blind spot calibration).
- Directional words matter: never map a front sensor to a rear item or radar to camera.
- If no catalog item plausibly covers a sensor, use null for that entry — do NOT force a bad match.
- Fixed report/inspection items map to their same-named catalog items when present.

Return ONLY a JSON array, same order, no markdown fences:
[{"kinetic_name": "...", "item_name": "..." or null, "item_id": "..." or null, "confidence": "high"|"low"}]`,
    }],
  })
  const raw = message.content[0].text.trim().replace(/^```(json)?/i, '').replace(/```$/, '').trim()
  const arr = JSON.parse(raw)
  if (!Array.isArray(arr)) throw new Error('proposeItemMap: expected JSON array')
  return arr
}

export async function cleanCalibrationDescriptions({ year, make, model, items }) {
  const vehicle = [year, make, model].filter(Boolean).join(' ') || 'the vehicle'
  const list = items.map((it, i) =>
    `${i + 1}. Calibration: ${it.name}\n   Tech's note: "${String(it.description || '').trim() || '(blank)'}"`
  ).join('\n')

  const message = await getClient().messages.create({
    model: 'claude-opus-4-7',
    max_tokens: 1500,
    messages: [{
      role: 'user',
      content: `You write invoice line-item justifications for an ADAS calibration company (Absolute ADAS). Vehicle: ${vehicle}.

For each calibration below, rewrite the technician's shorthand note into ONE professional sentence (two max) explaining why the calibration was required. Rules:
- "lines 12 and 14" or similar = those line numbers on the CCC ONE collision estimate flagged operations requiring this calibration. Phrase as: "Required per CCC estimate lines 12 and 14 — <operation> necessitates <calibration> calibration per ${make || 'OEM'} service information."
- Infer the standard repair trigger for the calibration type when not stated: front camera → windshield R&I/replacement; rear camera → tailgate/rear glass or rear-end repair; blind spot / rear radar → rear bumper R&I; front radar → front bumper/grille R&I; parking sensors → bumper R&I; 360/surround view → mirror or bumper repair; steering angle sensor → alignment or suspension repair.
- Cite the OEM requirement generically ("per ${make || 'OEM'} service information/position statement") — do NOT invent specific document numbers.
- Keep the tech's factual details; drop filler. Professional insurance-adjuster-friendly tone. No exclamation points.
- If the note is blank, write the standard justification for that calibration type from the repair-trigger rules above.

${list}

Return ONLY a JSON array of ${items.length} strings, same order, no markdown fences.`,
    }],
  })
  const raw = message.content[0].text.trim().replace(/^```(json)?/i, '').replace(/```$/, '').trim()
  const arr = JSON.parse(raw)
  if (!Array.isArray(arr) || arr.length !== items.length) {
    throw new Error(`Expected ${items.length} descriptions, got ${Array.isArray(arr) ? arr.length : typeof arr}`)
  }
  return arr.map(s => String(s))
}
