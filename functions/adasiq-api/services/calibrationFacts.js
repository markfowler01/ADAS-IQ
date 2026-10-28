// Calibration facts Mark has locked. Every drafter that writes about how a car
// gets calibrated gets this block appended to its system prompt, and the
// From the Van validator rejects drafts that break the Ford/GM camera rule.
//
// Mark 2026-10-13, after From the Van #12 said an F-150 windshield camera
// "completed a static calibration" and "reads the targets": "Ford windshield
// cameras are strictly dynamic. They never have a target or a static set up.
// Same with GM."

export const CALIBRATION_FACTS = `CALIBRATION FACTS (locked by Mark Fowler; never contradict them, and never invent a procedure that conflicts with them):
- Ford and GM (Chevrolet, GMC, Cadillac, Buick) windshield cameras calibrate DYNAMICALLY ONLY, on the road. They never use targets or a static setup. Never write that a Ford or GM windshield camera completed a static calibration, read targets, sat in front of a target board, or was calibrated in the shop or bay.
- Subaru with EyeSight: any collision repair gets the calibration.
- Toyota/Lexus, Honda/Acura and Hyundai/Kia blind spot modules bolt to the quarter panel, not the bumper cover. Calibrate them with the rear bumper cover off, because they often need a hand adjustment.
- WORDING (Mark 2026-10-28): talk about calibration REQUIREMENTS, never recommendations. Write "required calibrations", "calibration requirements", "the car maker requires". Never write that Absolute ADAS or Mark "recommends" a calibration. The Absolute Promise reads: every calibration requirement we call out, the shop gets paid for.`

export const withCalibrationFacts = prompt => `${prompt}\n\n${CALIBRATION_FACTS}`

const FORD_GM = /\b(ford|lincoln|f-?150|f-?250|f-?350|super duty|chevy|chevrolet|silverado|gmc|cadillac|escalade|buick|\bgm\b)/i
const CAMERA = /\b(camera|ipma|windshield|windscreen|glass|lane[- ]?(keep|centering|departure)|fcm)\b/i
const STATIC = /\b(static|targets?|target board|in the (shop|bay))\b/i
const NEGATED = /\b(no|never|not|without|isn'?t|doesn'?t|don'?t|won'?t|only on the road|dynamic(ally)? only)\b/i

/**
 * Returns a violation string when a draft about a Ford or GM vehicle describes
 * its windshield camera with a static/target setup, else null. A sentence is
 * flagged when it pairs a static/target word with a camera/glass word (or the
 * draft mentions no radar at all, so any target talk is about the camera),
 * unless the sentence itself negates it ("no targets", "never static").
 */
export function fordGmStaticCameraViolation(text, vehicle = '') {
  const all = `${vehicle}\n${text}`
  if (!FORD_GM.test(all) || !CAMERA.test(text)) return null
  const mentionsRadar = /\bradar\b/i.test(text)
  const sentences = String(text).split(/(?<=[.?!])\s+|\n+/)
  const bad = sentences.find(s => STATIC.test(s) && (CAMERA.test(s) || !mentionsRadar) && !NEGATED.test(s))
  return bad
    ? `says a Ford/GM windshield camera uses a static or target setup ("${bad.trim().slice(0, 120)}"). Ford and GM windshield cameras calibrate on the road only, never with targets. Rewrite it as a dynamic (drive) calibration.`
    : null
}
