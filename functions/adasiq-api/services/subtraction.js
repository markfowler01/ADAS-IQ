// The Subtraction — a private 30-day practice.
//
// Not a habit added. One behaviour removed. Mark's own document flagged the
// candidate: the swat in passing, which he suspects reads as dismissive rather
// than affectionate. So this tracks a thing NOT done.
//
// PRIVACY: never goes to Cliq, including his own #Ada channel. A channel is a
// place other people can end up, and his first guardrail is "no announcement".
// Email, SMS and the private page only. It is also absent from the spoken
// script — he plays that in the van, sometimes with a passenger.
//
// TONE: his rule is "missing a day is fine, quitting after a missed day is the
// failure." So there is no streak here. A streak is a thing that breaks, and a
// broken streak is the standard reason people quit on day nine. It states the
// day number and the one thing. That is all.
const START = process.env.SUBTRACTION_START || '2026-09-05'
const LENGTH = 30

// The one thing being removed. Changing this is a one-line edit.
const THING = process.env.SUBTRACTION_THING ||
  'The swat in passing. Hand on her back instead, and stop moving for three seconds.'

export function subtraction(todayISO) {
  const start = new Date(START + 'T12:00:00Z')
  const today = new Date(todayISO + 'T12:00:00Z')
  const day = Math.floor((today - start) / 86400000) + 1
  if (day < 1 || day > LENGTH) return null

  const end = new Date(start)
  end.setUTCDate(end.getUTCDate() + LENGTH - 1)

  return {
    day,
    of: LENGTH,
    thing: THING,
    endsOn: end.toISOString().slice(0, 10),
    isFinalDay: day === LENGTH,
    finalPrompt: day === LENGTH
      ? 'Ask her: "Has anything felt different lately?" Then just listen. Do not explain it.'
      : null,
  }
}

/** One quiet line. Never a streak, never a miss count. */
export function formatSubtraction(s) {
  if (!s) return ''
  const L = ['', `The Subtraction — day ${s.day} of ${s.of}.`, s.thing]
  if (s.finalPrompt) L.push(s.finalPrompt)
  return L.join('\n')
}
