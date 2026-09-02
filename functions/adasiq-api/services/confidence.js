// Guards against confident numbers derived from too little data.
//
// WHY THIS EXISTS: the brief once told Mark he was "on pace for $60,469, ahead
// of the $50,000 mark by $10,469" — on September 2nd, from two working days.
// The arithmetic was right and the statement was worthless, because at that
// sample one invoice swings the projection by five figures. He nearly acted on
// it: his hiring gate is "$40K, two months running", and that is the number it
// reads against.
//
// The lesson generalises. Any figure that divides, averages, extrapolates or
// claims a trend is only as good as its n, and JavaScript will happily hand you
// a mean of one sample with no complaint. So every such figure in the coach
// goes through here, and "not enough data" is a first-class result the caller
// has to render — not a silent number that looks like the others.
//
// The shape is deliberately awkward to ignore: you get { enough, n, value },
// and value is null when enough is false. Reaching for .value without checking
// .enough gives you null, not a plausible lie.

/** Mean of a sample, withheld below minN. */
export function mean(values, minN = 3) {
  const xs = (values || []).filter(v => typeof v === 'number' && Number.isFinite(v))
  if (xs.length < minN) return { enough: false, n: xs.length, minN, value: null }
  return { enough: true, n: xs.length, minN, value: xs.reduce((a, b) => a + b, 0) / xs.length }
}

/** A hit rate, withheld below minN attempts. */
export function rate(hits, attempts, minN = 3) {
  if (!attempts || attempts < minN) return { enough: false, n: attempts || 0, minN, value: null }
  return { enough: true, n: attempts, minN, value: hits / attempts }
}

/**
 * Extrapolate a period total from elapsed progress.
 * minElapsed defaults to 5 working days — below that a single invoice moves
 * the answer by more than the answer is worth.
 */
export function project(total, elapsed, periodLength, minElapsed = 5) {
  if (!elapsed || elapsed < minElapsed) {
    return {
      enough: false, n: elapsed || 0, minN: minElapsed, value: null,
      perUnit: elapsed ? Math.round(total / elapsed) : null,
    }
  }
  return {
    enough: true, n: elapsed, minN: minElapsed,
    value: Math.round((total / elapsed) * periodLength),
    perUnit: Math.round(total / elapsed),
  }
}

/**
 * Render a guarded figure for humans. Never invents a number; when the sample
 * is short it says so, in words, with the count.
 */
export function say(guarded, format = v => String(v), noun = 'days') {
  if (!guarded || !guarded.enough) {
    const n = guarded?.n ?? 0
    return `not enough data yet (${n} ${noun}, needs ${guarded?.minN ?? '?'})`
  }
  return format(guarded.value)
}
