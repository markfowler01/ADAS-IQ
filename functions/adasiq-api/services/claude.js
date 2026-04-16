import Anthropic from '@anthropic-ai/sdk'

// Always read key fresh from env so dotenv override is respected
function getClient() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
}

const SYSTEM_PROMPT = `You are ADAS IQ. You read Kinetic calibration identification report PDFs and extract all calibration systems listed -- both required and not required.

From the PDF provided extract the following:

HEADER FIELDS:
- shop: customer/shop name
- claim: claim number
- insurer: insurance company name
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
- justification: one sentence referencing the OEM position statement and ALLDATA ADAS procedure. Format: "[System name] calibration required per [Make] OEM position statement and ALLDATA ADAS procedure following collision repair. [One sentence explaining why.] Failure to calibrate presents a safety liability and does not meet [Make] OEM repair standards."
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

const CCC_SYSTEM_PROMPT = `You are ADAS IQ. You read CCC ONE collision repair estimate PDFs and determine which ADAS calibrations are required based on the repairs being performed.

STEP 1 — EXTRACT HEADER FIELDS:
- shop: name of the repair facility (from "Inspection Location" or shop header)
- claim: claim number
- insurer: insurance company name
- ro_number: RO Number
- vehicle: full vehicle description (year make model trim)
- year: 4-digit model year
- make: manufacturer (e.g. "Toyota", "Ford", "Honda")
- model: model and trim (e.g. "Tacoma SR5", "F-150 XLT")
- vin: VIN number
- point_of_impact: impact zone description (e.g. "Left Front", "Rear")

STEP 2 — IDENTIFY VEHICLE ADAS EQUIPMENT:
Read the vehicle options/equipment section carefully. Note every ADAS-related feature listed, such as:
- Adaptive/Intelligent Cruise Control, Radar Cruise, ACC
- Lane Departure Warning/Alert, Lane Keep Assist, Lane Tracing
- Pre-Collision System, Forward Collision Warning, Automatic Emergency Braking
- Blind Spot Monitor/Detection, Rear Cross Traffic Alert
- Backup/Rear Camera, Surround View, 360 Camera
- Automatic High Beam, Adaptive Headlights
- Parking Sensors, Park Assist
- Traffic Sign Recognition
- Night Vision
- Any mention of Safety Sense, EyeSight, Honda Sensing, Co-Pilot360, SuperCruise, ProPilot, etc.

STEP 3 — ANALYZE REPAIR OPERATIONS:
Read every line item in the estimate. Identify repairs that trigger ADAS calibrations using this knowledge:

WINDSHIELD / GLASS:
- Replace or R&R windshield → calibrate ALL windshield-mounted camera systems (forward camera, LDW, LKA, PCS, AEB, TSR, AHB, EyeSight stereo cameras — whatever this vehicle is equipped with). Subaru EyeSight is especially sensitive.
- R&I windshield (remove and reinstall) → same as replacement for camera calibration purposes

FRONT BUMPER / GRILLE / FASCIA:
- Replace front bumper cover, fascia, or impact bar → check if vehicle has front radar (ACC/Intelligent Cruise/Pre-Collision). If so, front radar calibration required.
- Replace front grille, upper grille, or grille emblem → front radar calibration (radar often sits behind grille/emblem on Toyota, Honda, Subaru, GM, Ford, etc.)
- Replace front lower trim/spoiler → front radar may be affected depending on make/model
- R&I or replace front radar sensor directly → front radar calibration required

FRONT SUSPENSION / STEERING / ALIGNMENT:
- Replace or repair: knuckle, control arm, strut, wheel bearing, tie rod, subframe, crossmember → Steering Angle Sensor (SAS) calibration required
- Alignment (sublet or labor line) → SAS calibration required
- Any front-end structural repair involving geometry → SAS calibration

HEADLIGHTS:
- Replace headlamp assembly → aim headlamps (usually included in CCC as a separate line — if not listed, note it). For vehicles with camera-based ADB or adaptive headlights, additional calibration may be needed.

REAR BUMPER / REAR FASCIA:
- Replace rear bumper cover or fascia → check if vehicle has rear radar sensors (Blind Spot, RCTA). If so, rear radar calibration may be needed.
- Replace rear bumper reinforcement or impact bar → rear radar calibration if equipped

QUARTER PANELS / REAR CORNERS:
- Replace or repair left quarter panel → Left Blind Spot Monitor calibration if equipped
- Replace or repair right quarter panel → Right Blind Spot Monitor calibration if equipped
- Blend or repair rear quarter → evaluate based on extent of work

DOOR MIRRORS:
- Replace left mirror → Left Blind Spot sensor calibration if mirror-mounted BSM (many makes mount BSM radar in mirrors)
- Replace right mirror → Right Blind Spot sensor calibration

FRONT/REAR DOORS:
- Replace door shell or outer panel → generally does not trigger ADAS calibration unless mirror or pillar is involved

HOOD / FRONT STRUCTURAL:
- Replace hood or repair front structural components → may affect forward camera angle on some vehicles — note if applicable

REAR CAMERA:
- Replace liftgate, trunk lid, or rear fascia → Backup camera calibration if the camera mounting is disturbed. Note: R&I (remove and reinstall) of bumper alone usually does not require calibration unless camera is visibly disturbed.

MISCELLANEOUS:
- Pre/Post Scan is NOT a calibration — it is already in the estimate; do not include it as a calibration
- Headlamp aim (if already a line item in the estimate) is already covered — do not duplicate
- Battery disconnect (if present) → some vehicles require SAS reset or other relearns after battery reconnect; note if applicable for this make/model

STEP 4 — DETERMINE CALIBRATIONS:
For each triggered calibration, ONLY include it if the vehicle is actually equipped with that system (based on STEP 2). Do not suggest calibrations for systems the vehicle does not have.

For each calibration return:
- calibration_name: clear system name (e.g. "Pre-Collision System / Front Radar", "Steering Angle Sensor", "Lane Departure Alert Camera", "Blind Spot Monitor — Left Radar")
- cal_type: "Static", "Dynamic", or "Static/Dynamic" as appropriate for this make/model/system
- trigger: brief description of what in the estimate triggered it (e.g. "Front grille replacement", "Front suspension replacement + alignment", "Windshield R&R")
- line_references: relevant CCC line numbers that triggered this calibration (e.g. "18, 19, 22")
- justification: professional 2-3 sentence explanation for the insurance estimate. Format: "[System] calibration required per [Make] OEM position statement and industry standard procedures following collision repair. [Explain what was repaired and why it affects this system.] Failure to calibrate presents a safety liability and does not meet [Make] OEM repair standards."
- enabled: true (all detected calibrations should be enabled by default for CCC — the technician will review and disable any that don't apply)
- links: [] (empty array — no links from CCC estimates)

Also return:
- document_links: [] (always empty for CCC estimates)

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
      "trigger": "",
      "line_references": null,
      "justification": "",
      "enabled": true,
      "links": []
    }
  ]
}`

/**
 * Detect whether a PDF is a CCC ONE estimate or a Kinetic calibration report.
 * Uses a lightweight Claude call on just the first ~2 pages worth of text.
 */
async function detectPdfType(base64Pdf) {
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
    model: 'claude-opus-4-5',  // Use Opus for accuracy on complex estimation logic
    max_tokens: 8192,
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

  const raw = message.content[0].text.trim()
  const cleaned = raw.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim()

  let parsed
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    throw new Error(`Claude returned invalid JSON: ${cleaned.slice(0, 200)}`)
  }

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
