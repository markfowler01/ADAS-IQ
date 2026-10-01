// ⚡ Scrub fast paths (Mark 2026-09-30: "make this way faster — we're gonna get
// a ton of estimates"). Two shortcuts that skip the slow full read, both
// deliberately conservative — when in doubt, the full scrub runs.
//
// 1. Nothing to calibrate: if NO line of the estimate touches anything ADAS
//    lives on or near (bumpers, glass, sensors, alignment, steering,
//    suspension, structure, lamps, seats/airbags, battery, programming…), the
//    car can't need a calibration. The word list is a SUPERSET of the guard's
//    trigger categories, so this never skips something the guard would catch.
//    Needs real text (≥ MIN_LINES lines) — a scanned/blank PDF never qualifies.
//
// 2. Supplement with no ADAS change: CCC sends a new version on every save. If
//    the ADAS-relevant lines (operation + description) are identical to the
//    last scrubbed version of the same estimate, reuse that result.

export const ADAS_WORDS = new RegExp([
  'bumper', 'fascia', 'grill', 'emblem', 'badge', 'valance', 'absorber', 'reinf', 'impact bar', 'energy',
  'windshield', 'w/shield', '\\bw/s\\b', 'windscreen', 'glass', 'mirror',
  'radar', 'camera', 'sensor', 'module', 'unit', 'ultrasonic', 'parking', 'park assist', 'blind', 'bsm', 'blis', 'cruise', '\\bacc\\b', 'lane', 'distronic', 'eyesight', 'sensing',
  'align', 'steering', 'suspension', 'strut', 'shock', 'spring', 'control arm', 'tie rod', 'knuckle', 'spindle', 'hub', 'axle', 'subframe', 'cradle', 'crossmember', 'wheel', 'tire',
  'frame', '\\brail\\b', 'apron', 'radiator support', 'core support', 'pillar', 'roof', 'rocker', 'floor', 'quarter', 'unibody', 'pull', 'measure', 'structural', 'section',
  'liftgate', 'tailgate', 'trunk', 'decklid', 'deck lid', 'hatch', 'back door',
  'head ?l', 'lamp', 'light', 'fog',
  'battery', 'disconnect', '12v', 'hybrid', '\\bhv\\b',
  'airbag', 'air bag', '\\bsrs\\b', 'seat', 'belt', 'pretension', 'occupant', 'curtain',
  'calibrat', 'reset', 'program', 'initiali', 'relearn', 'learn', 'aim', 'scan',
  'sublet', 'diagnos',
].join('|'), 'i')

const MIN_LINES = 6

/** The estimate's repair lines from plain text (CCC BMS text or PDF text). */
export function repairLines(text) {
  const t = String(text || '')
  const body = t.includes('\nLINES:\n') ? t.split('\nLINES:\n')[1] : t
  return body.split('\n').map(l => l.trim()).filter(l => /^\d{1,3}\b/.test(l) && l.length > 4)
}

/**
 * true only when there are enough real lines and NONE mentions an ADAS-related
 * word. Returns { skip, lines, hits } for the log.
 */
export function nothingToCalibrate(text) {
  const lines = repairLines(text)
  if (lines.length < MIN_LINES) return { skip: false, lines: lines.length, why: 'too few readable lines' }
  const hits = lines.filter(l => ADAS_WORDS.test(l))
  return { skip: hits.length === 0, lines: lines.length, hits: hits.length }
}

/** Fingerprint of the ADAS-relevant lines only (prices and other lines ignored). */
export function adasSignature(text) {
  const rel = repairLines(text).filter(l => ADAS_WORDS.test(l))
    .map(l => l.split('|').slice(1, 3).join('|').replace(/\s+/g, ' ').trim().toLowerCase())   // operation + description
    .sort()
  return rel.join('\n')
}

/** A finished "no calibrations" scrub, shaped like the full scrubber's output. */
export function noAdasResult(meta = {}) {
  return {
    ...meta,
    calibrations: [],
    _pdfType: 'CCC',
    _fast: 'no-adas',
    notes: 'Fast check: no line on this estimate touches a bumper, glass, sensor, alignment, steering, suspension, structure, lamp, seat/airbag, battery or programming. No calibrations required. Re-scrub fully if anything looks off.',
  }
}
