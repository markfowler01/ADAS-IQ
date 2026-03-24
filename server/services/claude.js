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

/**
 * Extract calibration data from a PDF buffer using Claude.
 * @param {Buffer} pdfBuffer
 * @returns {Promise<Object>} parsed JSON from Claude
 */
export async function extractFromPdf(pdfBuffer) {
  const base64Pdf = pdfBuffer.toString('base64')

  const message = await getClient().messages.create({
    model: 'claude-sonnet-4-6',
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

  // Strip any accidental markdown code fences
  const cleaned = raw.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim()

  let parsed
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    throw new Error(`Claude returned invalid JSON: ${cleaned.slice(0, 200)}`)
  }

  return parsed
}
