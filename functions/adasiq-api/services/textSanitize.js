// Shared text sanitizer for AI-generated content.
//
// Even with hard "NEVER use em dashes" rules in system prompts, Claude
// occasionally slips one through. Belt-and-suspenders: post-process the
// output to strip em dashes (and en dashes) before they reach the email.
//
// Strategy:
//   " — "  →  ", "   (most common case: spaced em dash separator)
//   " – "  →  ", "
//   "—"    →  "-"    (rare unspaced em dash: hyphen substitute)
//   "–"    →  "-"

export function stripEmDashes(s) {
  return String(s || '')
    .replace(/\s+—\s+/g, ', ')
    .replace(/\s+–\s+/g, ', ')
    .replace(/—/g, '-')
    .replace(/–/g, '-')
}

// Catch-all sanitizer applied to every AI-generated line that hits the email.
// Strips em dashes + banned AI phrases that occasionally leak through prompts.
const BANNED_PHRASES = [
  /\bdelve into\b/gi,
  /\btapestry\b/gi,
  /\bin today's (?:fast-paced |competitive |dynamic )?(?:world|landscape|market)\b/gi,
  /\bnavigate the (?:complex |evolving )?landscape\b/gi,
  /\bunlock the (?:power|potential|secrets)\b/gi,
  /\bharness the (?:power|potential)\b/gi,
]

export function sanitizeAiOutput(s) {
  let out = stripEmDashes(s)
  // Don't actively rewrite the banned phrases (would change meaning); just
  // strip them entirely. The sentence usually reads fine without them.
  for (const re of BANNED_PHRASES) {
    out = out.replace(re, '')
  }
  // Collapse double spaces left behind
  return out.replace(/\s{2,}/g, ' ').trim()
}
