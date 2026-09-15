// 🤖 Rick writes the 3 C's + Verification (spec §8). Rick writes prose,
// never facts: every DTC, part, procedure, or measurement comes from the
// form. Missing facts become [PLACEHOLDERS] that block approval.
export const TRIGGERS = ['windshield replacement', 'front bumper cover R&R or replacement', 'grille or radar bracket R&R', 'front-end collision damage', 'rear bumper R&R or replacement', 'mirror replacement', 'suspension or steering repair', 'wheel alignment performed', 'ride height change', 'module replacement or reprogramming', 'battery disconnect', 'customer-reported system fault', 'other']
export const SYSTEMS = ['front camera', 'front radar', 'left blind spot', 'right blind spot', 'rear radar', '360 camera front', '360 camera rear', '360 camera left', '360 camera right', 'parking sensors', 'steering angle sensor', 'night vision', 'other']
export const BLOCKERS = ['pre-existing damage', 'windshield out of OEM spec', 'tire pressure or tread out of spec', 'fuel level', 'ride height out of spec', 'insufficient target space at shop', 'alignment out of spec', 'related module fault', 'vehicle not repaired to pre-loss condition']
export const OUTCOMES = ['completed', 'completed with notes', 'could not complete']
export const POST_SCAN = ['all cleared', 'codes remain', 'not performed']

export const SYSTEM_PROMPT = `You write the 3 C's (Concern, Cause, Correction) plus a Verification
statement for ADAS calibration and diagnostic repair orders at Absolute
ADAS, a mobile ADAS calibration company in Washington State.

Your output goes onto billing documents reviewed by collision shops and
insurance adjusters. Accuracy matters more than completeness.

ABSOLUTE RULES:
- Use ONLY the facts provided in the input. Never introduce a DTC code,
  part number, torque spec, procedure name, OEM document number, or
  measurement that is not in the input.
- If a needed fact is missing, write a bracketed placeholder such as
  [DTC CODE] or [OEM PROCEDURE REF]. Never guess or infer one.
- Do not claim a system was verified, road tested, or scanned unless the
  input says so.
- Do not state that an OEM "requires" calibration unless an OEM reference
  was provided. Without one, write that calibration is indicated by the
  repair operation performed.

STYLE:
- Third person, past tense, factual. No marketing language, no adjectives
  that are not load bearing.
- Concern: 1 to 2 sentences. The triggering operation or reported symptom
  only. Never the diagnosis and never the repair.
- Cause: 2 to 4 sentences. Connect the trigger operation to why calibration
  or diagnosis was indicated. Name the specific systems affected.
- Correction: 2 to 5 sentences. What was actually performed, per system,
  including static or dynamic and any prerequisites set.
- Verification: 1 to 3 sentences. Post-calibration confirmation, scan
  result, and road test if performed. Close by addressing the original
  concern directly.
- If outcome is "could not complete," Correction states what was attempted
  and Verification states the blocking condition plainly and what must
  happen before calibration can be completed.

OUTPUT: valid JSON only, no preamble, no markdown fences:
{"concern":"","cause":"","correction":"","verification":""}`

export const PLACEHOLDER_RE = /\[[A-Z][A-Z0-9 _\/\-]{1,40}\]/

export function inputsToText(inp = {}) {
  const sys = (inp.systems || []).map(s => `${s}${inp.calibration_types?.[s] ? ` (${inp.calibration_types[s]})` : ''}`).join('; ')
  return [
    `Vehicle: ${inp.vehicle || '(unknown)'}`, `VIN: ${inp.vin || '(none)'}`, `RO: ${inp.ro_number || '(none)'}`, `Shop / customer: ${inp.shop || '(none)'}`,
    `Trigger event: ${inp.trigger_event || '(none)'}`, `Systems calibrated: ${sys || '(none)'}`,
    `Pre-scan: ${inp.no_dtcs_present ? 'no DTCs present' : (inp.pre_scan_dtcs || '(not stated)')}`,
    `Post-scan: ${inp.post_scan_result || '(not stated)'}${inp.post_scan_result === 'codes remain' && inp.post_scan_remaining_dtcs ? ` — remaining: ${inp.post_scan_remaining_dtcs}` : ''}`,
    `Outcome: ${inp.outcome || '(not stated)'}${inp.outcome === 'could not complete' && inp.blocking_reason ? ` — blocked by: ${inp.blocking_reason}` : ''}`,
    `Road test: ${inp.road_test ? 'performed' : 'not stated'}`,
    `OEM reference: ${inp.oem_reference || '(none provided)'}`, `Audience: ${inp.audience || 'insurer'}-facing`,
    `Technician notes: ${inp.free_notes || '(none)'}`,
  ].join('\n')
}

function parse(text) {
  const t = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try { const o = JSON.parse(t); if (o && typeof o === 'object') return { concern: String(o.concern || ''), cause: String(o.cause || ''), correction: String(o.correction || ''), verification: String(o.verification || '') } } catch { /* fallthrough */ }
  const m = t.match(/\{[\s\S]*\}/); if (m) { try { const o = JSON.parse(m[0]); return { concern: String(o.concern || ''), cause: String(o.cause || ''), correction: String(o.correction || ''), verification: String(o.verification || '') } } catch { /* no */ } }
  return null
}

/** examples: [{ inputs, approved:{concern,cause,correction,verification} }] (most recent approved sets, same trigger) */
export async function generateThreeC({ inputs, examples = [], model = 'claude-sonnet-4-6' }) {
  const Anthropic = (await import('@anthropic-ai/sdk')).default
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 25000, maxRetries: 1 })
  const messages = []
  for (const ex of examples.slice(0, 3)) {
    messages.push({ role: 'user', content: inputsToText(ex.inputs) })
    messages.push({ role: 'assistant', content: JSON.stringify(ex.approved) })
  }
  messages.push({ role: 'user', content: inputsToText(inputs) })
  const ask = async () => { const m = await client.messages.create({ model, max_tokens: 1000, temperature: 0.2, system: SYSTEM_PROMPT, messages }); return String(m.content?.[0]?.text || '') }
  let raw = await ask(); let out = parse(raw)
  if (!out) { raw = await ask(); out = parse(raw) }
  return { ok: !!out, ...(out || {}), raw: out ? undefined : raw, model }
}
