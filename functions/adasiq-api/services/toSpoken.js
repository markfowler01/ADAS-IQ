// Written text -> spoken text.
//
// The Big 3 and the affirmation are written for a phone screen and were being
// handed to TTS verbatim, so Ada read punctuation and shorthand out loud:
// "$40K" as "dollar forty kay", "3 jobs/day" as "three jobs slash day", em
// dashes as nothing at all. formatVoiceMorning() was already spoken-formatted;
// everything else bypassed it.
//
// Order matters here — currency before plain numbers, longer patterns before
// shorter ones that would otherwise eat them.
export function toSpoken(input) {
  let t = String(input || '')

  // Currency with a magnitude suffix first: $40K, $1.2M
  t = t.replace(/\$\s?([\d.]+)\s?[kK]\b/g, (_, n) => `${n} thousand dollars`)
  t = t.replace(/\$\s?([\d.]+)\s?[mM]\b/g, (_, n) => `${n} million dollars`)
  // Plain currency: $4,932 -> "4,932 dollars" (TTS reads grouped digits well)
  t = t.replace(/\$\s?([\d,]+(?:\.\d{2})?)/g, (_, n) => `${n.replace(/\.00$/, '')} dollars`)

  // Bare magnitudes: 40K -> forty thousand
  t = t.replace(/\b(\d+(?:\.\d+)?)[kK]\b/g, '$1 thousand')

  // Ratios and rates
  t = t.replace(/(\d+)\s*\/\s*(\d+)/g, '$1 out of $2')          // 7/10
  t = t.replace(/\b(\w+)\s*\/\s*(day|week|month|hr|hour)\b/gi, '$1 a $2')  // jobs/day
  t = t.replace(/\b(\d+)\s?x\b/gi, '$1 times')                   // 3x

  // Symbols that TTS either skips or mangles
  t = t.replace(/\s*[—–]\s*/g, ', ')     // em/en dash -> a real pause
  t = t.replace(/\s+&\s+/g, ' and ')
  t = t.replace(/\s*\+\s*/g, ' plus ')
  t = t.replace(/#(\d+)/g, 'number $1')
  t = t.replace(/\bw\/\s?/gi, 'with ')
  t = t.replace(/\be\.g\.\s?/gi, 'for example, ')
  t = t.replace(/\bi\.e\.\s?/gi, 'that is, ')
  t = t.replace(/\bvs\.?\b/gi, 'versus')
  t = t.replace(/\bASAP\b/g, 'as soon as possible')

  // Common shorthand in Mark's world
  t = t.replace(/\bBig 3\b/gi, 'big three')
  t = t.replace(/\bF3\b/g, 'F three')
  t = t.replace(/\bRO#?\s?(\d+)/gi, 'R O $1')
  t = t.replace(/\bMTD\b/g, 'month to date')
  t = t.replace(/\bEOD\b/g, 'end of day')
  t = t.replace(/\bEOY\b/g, 'end of year')

  // Parentheticals read better as clauses than as silent gaps
  t = t.replace(/\s*\(([^)]{1,60})\)/g, ', $1,')

  // Bullets and stray marks
  t = t.replace(/^[\s•\-*]+/gm, '')
  t = t.replace(/["""'']/g, '')
  t = t.replace(/\.{2,}/g, '.')

  // Tidy the punctuation the substitutions leave behind
  t = t.replace(/\s+([.,])/g, '$1')
     .replace(/([.,])\1+/g, '$1')
     .replace(/,\s*\./g, '.')
     .replace(/,\s*([.!?])/g, '$1')   // parenthetical left ", not bad," dangling
     .replace(/,\s*$/g, '.')
     .replace(/\s{2,}/g, ' ')
     .trim()

  return t
}
