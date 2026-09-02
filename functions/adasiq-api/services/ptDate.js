// PT-local date, shared. Lives on its own so briefing.js, coach.js and
// eveningCheckin.js can all use it without importing each other — the
// evening review needs briefing's gatherer, which would otherwise close
// a cycle back through eveningCheckin.
//
// Everything in the day coach is keyed on the PT date, not UTC: at 7 PM PT
// the UTC date has already rolled over, so a UTC key files the evening
// check-in against tomorrow.
export function ptDate(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d)
}
