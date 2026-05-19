// Voice scorer — the gate between Claude drafts and Mark's inbox.
//
// Per the v1.0 Engineering Brief, scoring drafts against a measurable
// fingerprint is "THE most important module" of the Capture System. Drafts
// that score below 70 get re-drafted before Mark ever sees them. The
// fingerprint updates over time from Mark's approvals, edits, and rejections.
//
// All dimensions are objective rules pulled from the v2.5 voice contract.
// Subjective taste lives in Mark's approval signal, not in this file.

const BANNED_PHRASES = [
  'delve', 'leverage', 'in today\'s fast-paced', 'in today\'s',
  'elevate', 'unlock', 'synergy', 'robust', 'harness',
  'navigate the landscape', 'tapestry',
  'revolutionary', 'game-changing', 'game changing',
  'cutting-edge', 'cutting edge',
  'pivotal', 'paradigm',
]

// Shop-owner vocabulary the voice contract requires drafts to lean on.
const SHOP_JARGON = [
  'gp%', 'gp ', 'gross profit', 'capture rate', 'capture %', 'cycle time',
  'sublet', 'drp', 'severity', 'touch time', 'r.o.', 'ro ', 'retail vs trade',
  'comeback', 'supplement', 'oem', 'calibration', 'pre-scan', 'post-scan',
  'i-car', 'adas', 'estimator', 'service writer', 'bay',
]

// Pattern-interrupt opens are good. The brief explicitly bans "Are you a body
// shop owner who..." style openers. This regex catches the obvious offenders.
const WEAK_OPENERS = [
  /^are you a (body shop|shop) owner/i,
  /^in today's (fast-paced|complex|modern) /i,
  /^as a (body shop|collision shop|shop) owner/i,
  /^have you ever wondered/i,
  /^if you('re| are) like most /i,
]

// ─── Core scoring ───────────────────────────────────────────────────────────
function countOccurrences(text, needle) {
  if (!text || !needle) return 0
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(escaped, 'gi')
  return (text.match(re) || []).length
}

function splitSentences(text) {
  return String(text || '')
    .replace(/\n+/g, ' ')
    .split(/(?<=[.!?])\s+(?=[A-Z])/)
    .map(s => s.trim())
    .filter(Boolean)
}

function avg(arr) {
  if (!arr.length) return 0
  return arr.reduce((a, b) => a + b, 0) / arr.length
}

function wordCount(text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean).length
}

/**
 * Measure the objective dimensions of a draft. Pure function, no I/O.
 * @param {string} text
 * @returns {Object} measurements
 */
export function measureDraft(text) {
  const t = String(text || '')
  const words = wordCount(t)
  const sentences = splitSentences(t)
  const sentLengths = sentences.map(wordCount)

  const emDashes = (t.match(/—|–/g) || []).length
  const banned = BANNED_PHRASES.reduce((acc, p) => acc + countOccurrences(t, p), 0)
  const jargon = SHOP_JARGON.reduce((acc, p) => acc + countOccurrences(t, p), 0)
  const firstPerson = countOccurrences(t, ' I ') + countOccurrences(t, '\nI ') + (t.match(/^I /m) ? 1 : 0)
  const questions = (t.match(/\?/g) || []).length
  const exclaims = (t.match(/!/g) || []).length

  const opener = sentences[0] || ''
  const weakOpener = WEAK_OPENERS.some(re => re.test(opener))
  const patternInterrupt = isPatternInterrupt(opener)

  // Capture System / 4-A name-drop check — every asset should reference at
  // least one per the v2.5 doctrine.
  // v3.1 doctrine: the mechanism is the Partnership Discount Model.
  // Accept either the full name OR any of the 4 component phrases, OR a
  // reference to the discount/partnership tier mechanics. v2.5's "Absolute
  // Capture System" / 4 A's no longer count (would be a regression).
  const namesMechanism = /partnership discount model|we come to you|discount off list|bill at list|volume rewards you|partnership discount|partner price|standard partner|preferred partner|volume tier/i.test(t)

  return {
    words,
    sentenceCount: sentences.length,
    avgSentenceLen: avg(sentLengths),
    maxSentenceLen: Math.max(...(sentLengths.length ? sentLengths : [0])),
    emDashes,
    bannedPhrases: banned,
    jargonHits: jargon,
    jargonDensityPer100w: words ? (jargon / words) * 100 : 0,
    firstPersonHits: firstPerson,
    questionsPer100w: words ? (questions / words) * 100 : 0,
    exclaimsPer100w: words ? (exclaims / words) * 100 : 0,
    opener: opener.slice(0, 120),
    weakOpener,
    patternInterrupt,
    namesMechanism,
  }
}

function isPatternInterrupt(opener) {
  if (!opener) return false
  if (WEAK_OPENERS.some(re => re.test(opener))) return false
  const first = opener.trim().split(/\s+/)[0]
  // Pattern interrupts tend to start with concrete nouns, names, numbers,
  // or short declarative verbs ("Mike runs..."). Not with "If/As/When/Are".
  return !/^(if|as|when|are|do|does|in|the )/i.test(first)
}

/**
 * Score a draft 0-100 against the v2.5 voice contract.
 * Below 70 should trigger a re-draft. Below 50 is a hard fail.
 *
 * @param {string} text
 * @param {Object} [opts]
 * @param {string} [opts.channel] — "linkedin"|"email"|"cold"|"nurture" (adjusts weights)
 * @returns {{score: number, measurements: Object, deductions: Array<{reason, points}>}}
 */
export function scoreDraft(text, opts = {}) {
  const m = measureDraft(text)
  const channel = opts.channel || 'generic'

  // Start at 100, deduct.
  const deductions = []
  let score = 100

  // Hard bans — voice contract violations. Each occurrence costs heavy.
  if (m.emDashes > 0) {
    const cost = m.emDashes * 15
    deductions.push({ reason: `${m.emDashes} em-dash(es)`, points: -cost })
    score -= cost
  }
  if (m.bannedPhrases > 0) {
    const cost = m.bannedPhrases * 12
    deductions.push({ reason: `${m.bannedPhrases} banned AI phrase(s)`, points: -cost })
    score -= cost
  }

  // Opener — pattern interrupt rewarded, weak opener heavily punished.
  if (m.weakOpener) {
    deductions.push({ reason: 'weak opener (Sabri Suby ban)', points: -20 })
    score -= 20
  } else if (!m.patternInterrupt) {
    deductions.push({ reason: 'opener is not a pattern interrupt', points: -8 })
    score -= 8
  }

  // Avg sentence length — Mark writes short. Target 8-18 word avg.
  if (m.avgSentenceLen > 22) {
    deductions.push({ reason: `sentences too long (avg ${m.avgSentenceLen.toFixed(1)} words)`, points: -10 })
    score -= 10
  } else if (m.avgSentenceLen > 18) {
    deductions.push({ reason: `sentences slightly long (avg ${m.avgSentenceLen.toFixed(1)} words)`, points: -4 })
    score -= 4
  }
  if (m.maxSentenceLen > 40) {
    deductions.push({ reason: `one sentence is ${m.maxSentenceLen} words long`, points: -5 })
    score -= 5
  }

  // Jargon density — needs SHOP vocabulary present. Email/LinkedIn = >=1 per 100w.
  if (m.jargonDensityPer100w < 1 && m.words > 60 && channel !== 'cold') {
    deductions.push({ reason: 'low shop-owner jargon density', points: -8 })
    score -= 8
  }

  // Mechanism reference — every customer-facing asset must name-drop.
  if (!m.namesMechanism && m.words > 100) {
    deductions.push({ reason: 'no mention of the Absolute Capture System / 4 A\'s', points: -10 })
    score -= 10
  }

  // Excess exclaims — not Mark's voice.
  if (m.exclaimsPer100w > 1) {
    deductions.push({ reason: 'too many exclamation marks', points: -6 })
    score -= 6
  }

  // Length sanity — long-form posts that are too short don't earn their CTA.
  if (m.words < 60) {
    deductions.push({ reason: `too short (${m.words} words)`, points: -6 })
    score -= 6
  }

  score = Math.max(0, Math.min(100, Math.round(score)))
  return { score, measurements: m, deductions }
}

/**
 * Compare two drafts ("before" + "after Mark edited"). Returns the diff as
 * voice-fingerprint deltas. Used to learn Mark's actual edits over time.
 *
 * @param {string} before
 * @param {string} after
 * @returns {Object} dimensional deltas
 */
export function diffDrafts(before, after) {
  const a = measureDraft(before)
  const b = measureDraft(after)
  return {
    avgSentenceLen: b.avgSentenceLen - a.avgSentenceLen,
    emDashes: b.emDashes - a.emDashes,
    bannedPhrases: b.bannedPhrases - a.bannedPhrases,
    jargonHits: b.jargonHits - a.jargonHits,
    jargonDensityPer100w: b.jargonDensityPer100w - a.jargonDensityPer100w,
    firstPersonHits: b.firstPersonHits - a.firstPersonHits,
    words: b.words - a.words,
    sentenceCount: b.sentenceCount - a.sentenceCount,
  }
}

// ─── Fingerprint storage (Catalyst Cache) ────────────────────────────────────
// One JSON blob updated on every approval/edit/rejection. Seeded with the v2.5
// contract values; drifts toward Mark's actual voice as he engages.
//
// Schema:
// {
//   seeded_at: ISO,
//   updated_at: ISO,
//   sample_count: int,
//   target: {
//     avgSentenceLen: { min, max, target },
//     jargonDensityPer100w: { min, target },
//     emDashes: 0,        // hard 0 always
//     bannedPhrases: 0,
//     namesMechanism: true,
//   },
//   approvals_by_category: {
//     story:     { up: int, down: int },
//     framework: { up: int, down: int },
//     case_study:{ up: int, down: int },
//   }
// }

const FINGERPRINT_KEY = 'capture_voice_fingerprint'

function seedFingerprint() {
  return {
    seeded_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    sample_count: 0,
    target: {
      avgSentenceLen: { min: 8, max: 18, target: 13 },
      jargonDensityPer100w: { min: 1.0, target: 2.5 },
      emDashes: 0,
      bannedPhrases: 0,
      namesMechanism: true,
    },
    approvals_by_category: {
      story:      { up: 0, down: 0 },
      framework:  { up: 0, down: 0 },
      case_study: { up: 0, down: 0 },
      educational:{ up: 0, down: 0 },
      cold_email: { up: 0, down: 0 },
      nurture:    { up: 0, down: 0 },
    },
  }
}

/**
 * Load fingerprint from Catalyst Cache. Seeds on first run.
 * @param {Object} segment — Catalyst cache segment
 */
export async function loadFingerprint(segment) {
  try {
    const val = await segment.getValue(FINGERPRINT_KEY)
    return val ? JSON.parse(val) : seedFingerprint()
  } catch (e) {
    if (e?.statusCode === 404 || e?.errorInfo?.statusCode === 404) return seedFingerprint()
    throw e
  }
}

async function persistFingerprint(segment, fp) {
  const str = JSON.stringify(fp)
  try { await segment.update(FINGERPRINT_KEY, str) }
  catch { await segment.put(FINGERPRINT_KEY, str) }
}

/**
 * Update the fingerprint from a Mark signal. Weights per v1.0 brief:
 *   thumbs-up:   +0.05 toward draft's measured dimensions
 *   thumbs-down: -0.10 (anti-target)
 *   edited+approved: +0.15 toward Mark's EDITED version's dimensions
 *
 * @param {Object} segment
 * @param {{category, signal: 'up'|'down'|'edited', text, editedText?}} payload
 */
export async function updateFingerprint(segment, { category, signal, text, editedText }) {
  const fp = await loadFingerprint(segment)
  const cat = category && fp.approvals_by_category[category]
    ? category
    : 'story'

  if (signal === 'up')        fp.approvals_by_category[cat].up += 1
  if (signal === 'down')      fp.approvals_by_category[cat].down += 1
  if (signal === 'edited')    fp.approvals_by_category[cat].up += 1 // edited+approved counts as approval

  // Drift the target avgSentenceLen toward observed approved/edited drafts.
  const sample = (signal === 'edited' && editedText) ? editedText : text
  if (sample) {
    const m = measureDraft(sample)
    const weight = signal === 'edited' ? 0.15 : signal === 'up' ? 0.05 : 0  // down doesn't drift target, just lowers cat trust
    if (weight > 0 && m.avgSentenceLen > 0) {
      const t = fp.target.avgSentenceLen
      t.target = round1(t.target * (1 - weight) + m.avgSentenceLen * weight)
      // Keep min/max envelope reasonable
      t.min = Math.max(6,  Math.round(t.target - 6))
      t.max = Math.min(24, Math.round(t.target + 8))
    }
  }

  fp.sample_count += 1
  fp.updated_at = new Date().toISOString()
  await persistFingerprint(segment, fp)
  return fp
}

function round1(n) { return Math.round(n * 10) / 10 }

/**
 * Per-category trust score (0-1). At 80%+ over the trailing window the brief
 * says that category can transition to auto-publish.
 */
export function categoryTrust(fp, category) {
  const c = fp?.approvals_by_category?.[category]
  if (!c) return 0
  const total = (c.up || 0) + (c.down || 0)
  if (total < 10) return 0   // not enough data
  return c.up / total
}
