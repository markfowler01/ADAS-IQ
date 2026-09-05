// What kind of day is this, and how long is the work window?
//
// Mark's week is not uniform and the brief was treating it as though it were —
// he got a full field-ops brief on a Saturday, complete with job board and
// shop-call pressure, on a day when no shop is open.
//
//   Mon-Fri  field work, full day
//   Saturday admin — reports, forms, NASTF filings, the things that can wait
//   Sunday   marketing, then church and volunteering
//
// Every day he wakes at 4:30 and works until the family gets up, then he is
// with them. On weekends that IS the day: roughly a two to three hour window,
// and nothing after it. A Big 3 sized for eight hours is the wrong instrument
// for a Saturday morning, and a thin board on a Sunday is the plan working.
export function dayShape(dateISO) {
  const dow = new Date(dateISO + 'T12:00:00Z').getUTCDay()   // 0 Sun .. 6 Sat
  if (dow === 0) return {
    kind: 'sunday',
    label: 'Sunday',
    window: 'about 2 to 3 hours, 4:30 until the family is up',
    focus: 'marketing',
    fieldWork: false,
    guidance: 'Marketing morning. Content, outreach prep, next week\'s marketing. Church is every Sunday and he volunteers — that is not negotiable and it is not a task. After the family wakes he is done working.',
  }
  if (dow === 6) return {
    kind: 'saturday',
    label: 'Saturday',
    window: 'about 2 to 3 hours, 4:30 until the family is up',
    focus: 'admin',
    fieldWork: false,
    guidance: 'Admin morning. Reports, forms, NASTF filings, invoicing, quotes, paperwork that waits all week. No shops are open, so no calls and no field work. After the family wakes he is done working.',
  }
  return {
    kind: 'weekday',
    label: 'Weekday',
    window: 'a full working day',
    focus: 'field',
    fieldWork: true,
    guidance: 'Field day. Jobs, shops, the board, the team.',
  }
}
