// "Calibration requirements", never "calibration recommendations" (Mark 2026-10-28:
// "whenever you talk about calibration recommendations I want you to phrase it like
// calibration requirements, and all social media posts").
//
// Drafters get the rule in their prompt (CALIBRATION_FACTS). This is the net under
// them: every Facebook, Instagram and LinkedIn publish/comment call runs its text
// through socialText(), so a stray "we recommend" never reaches a feed, whatever
// pipeline wrote it. Only posts about calibrations are touched.

const CAL = /\b(calibrat\w*|cals?|ADAS)\b/i

// tense of "recommend" → matching "call out"
const CALL_OUT = { recommend: 'call out', recommends: 'calls out', recommended: 'called out' }

function matchCase(src, out) {
  return /^[A-Z]/.test(src) ? out[0].toUpperCase() + out.slice(1) : out
}

// Safe in any sentence of a post about calibrations, even one that doesn't itself say
// "calibration" ("We only recommend what the car maker requires.", "If it's recommended...").
const POST_RULES = [
  // "we only recommend what the car maker requires" → "we only call out what the car maker requires"
  [/\b(we|Absolute ADAS)(\s+only)?\s+(recommend(?:s|ed)?)(\s+what)\b/gi,
    (m, who, only, verb, what) => `${who}${only || ''} ${CALL_OUT[verb.toLowerCase()]}${what}`],
  // "if it's recommended" → "if it's required"
  [/\b(it'?s|it is|they'?re|they are)\s+recommended\b/gi, (m, head) => `${head} required`],
]

// Only in sentences that mention calibrations.
const SENTENCE_RULES = [
  // "calibration recommendations" → "calibration requirements"
  [/\b(calibration|cal|ADAS)\s+recommendation(s?)\b/gi, (m, noun, s) => `${noun} requirement${s}`],
  // "recommended calibration(s)" → "required calibration(s)"
  [/\brecommended(\s+(?:ADAS\s+)?(?:calibrations?|cals?))\b/gi, (m, rest) => matchCase(m, `required${rest}`)],
  // "every calibration we recommend" → "every calibration requirement we call out"
  [/\b(calibration|cal)(s?)\s+(?:that\s+)?(we|Absolute ADAS)\s+(recommend(?:s|ed)?)\b/gi,
    (m, noun, s, who, verb) => `${noun} requirement${s} ${who} ${CALL_OUT[verb.toLowerCase()]}`],
  // "the calibration is recommended" → "the calibration is required"
  [/\b((?:calibrations?|cals?)\s+(?:is|are|was|were|gets|get)\s+)recommended\b/gi, (m, head) => `${head}required`],
  ...POST_RULES,
  // "we recommend a calibration after..." → "we require a calibration after..."
  [/\b(we|Absolute ADAS)(\s+only)?\s+recommend(s|ed)?\b/gi,
    (m, who, only, end) => `${who}${only || ''} require${end === 'ed' ? 'd' : end || ''}`],
  // anything left: "recommendation(s)" → "requirement(s)", "recommended" → "required"
  [/\brecommendation(s?)\b/gi, (m, s) => matchCase(m, `requirement${s}`)],
  [/\brecommended\b/gi, m => matchCase(m, 'required')],
]

const SENTENCE = /[^.!?\n]+[.!?]*|\n+/g
const apply = (rules, s) => rules.reduce((out, [re, fn]) => out.replace(re, fn), s)

/** Rewrites calibration "recommend" wording to "required/requirements". Other text is untouched. */
export function requiredWording(text) {
  if (!text || !/recommend/i.test(text) || !CAL.test(text)) return text
  return String(text).replace(SENTENCE, s => {
    if (!/recommend/i.test(s)) return s
    return apply(CAL.test(s) ? SENTENCE_RULES : POST_RULES, s)
  })
}

/** Sentences about calibrations that still say "recommend" after the rewrite (e.g. "Honda recommends"). */
export function recommendLeftovers(text) {
  return (String(requiredWording(text) || '').match(SENTENCE) || [])
    .filter(s => /recommend/i.test(s) && CAL.test(s))
    .map(s => s.trim())
}

/** requiredWording() plus a console warning for anything it could not rewrite. */
export function socialText(text, label = 'social') {
  const out = requiredWording(text)
  const left = recommendLeftovers(out)
  if (left.length) console.warn(`[requiredWording] ${label}: "recommend" left in ${left.length} sentence(s): ${left[0].slice(0, 120)}`)
  return out
}
