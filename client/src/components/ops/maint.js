// 🔧 Van maintenance, shared by the van map, the Due list and the Vans tab
// (Mark 2026-10-04: "build this into the system"). A service is due by time OR
// by miles, whichever comes first; the van's odometer makes the miles side work.
export const MAINT_TYPES = ['Milestone 30k', 'Milestone 60k', 'Milestone 90k', 'Milestone 120k', 'Milestone 150k', 'Oil Change', 'Tires', 'Tire Rotation', 'Brakes', 'Inspection', 'Registration', 'Repair', 'Wrap', 'Tint', 'Electrical', 'Transmission', 'Coolant', 'Battery', 'Other']
export const MAINT_INTERVALS = {
  'Oil Change':    { miles: 5000,  months: 6 },
  'Tire Rotation': { miles: 7500,  months: 6 },
  'Tires':         { miles: 50000, months: 48 },
  'Brakes':        { miles: 40000, months: 36 },
  'Inspection':    { miles: null,  months: 12 },
  'Transmission':  { miles: 60000, months: 48 },
  'Coolant':       { miles: 30000, months: 24 },
}
// Ford severe-duty milestones for a working Transit. A service record of type
// "Milestone 30k" (etc.) marks one done. Due inside 1,000 mi; overdue once past.
export const MILESTONES = [
  { miles: 30000, items: ['Engine oil + filter', 'Brake pads, rotors, fluid', 'Tire rotation + wear', 'Cabin + engine air filters', 'Battery test', 'Belts, hoses, coolant level', 'Suspension + steering check', 'Wipers, lights, horn'] },
  { miles: 60000, items: ['Everything from 30k', 'Transmission fluid', 'Coolant flush', 'Spark plugs (if due)', 'Differential + transfer case fluid', 'Fuel filter (diesel)', 'Brake fluid flush'] },
  { miles: 90000, items: ['Everything from 30k', 'Tires (likely due)', 'Drive belt', 'Shocks + struts', 'Exhaust + mounts', 'Wheel bearings + CV boots'] },
  { miles: 120000, items: ['Everything from 60k', 'Timing components per Ford', 'Water pump + thermostat check'] },
  { miles: 150000, items: ['Everything from 30k', 'Transmission service', 'Full cooling system'] },
]
export const milestoneType = m => `Milestone ${m / 1000}k`
export function milestoneStatus(van) {
  const odo = vanOdometer(van)
  const recs = van.maintenance || []
  return MILESTONES.map(m => {
    const done = recs.find(r => String(r.type || '').toLowerCase() === milestoneType(m.miles).toLowerCase())
    const left = odo ? m.miles - odo : null
    const sev = done ? 0 : left === null ? 0 : left < 0 ? 3 : left <= 1000 ? 2 : 1
    return { ...m, done, left, sev, text: done ? `done ${done.date}${done.mileage ? ` at ${Number(done.mileage).toLocaleString()} mi` : ''}` : left === null ? 'enter the odometer' : left < 0 ? `${Math.abs(left).toLocaleString()} mi past due` : `${left.toLocaleString()} mi away` }
  })
}
const days = d => d ? Math.ceil((new Date(d) - new Date()) / 86400000) : null
const addMonths = (d, m) => { if (!d) return ''; const x = new Date(d + 'T12:00:00'); x.setMonth(x.getMonth() + Number(m || 0)); return x.toISOString().slice(0, 10) }

/** Best known odometer: the van's own reading, or the newest service record's. */
export function vanOdometer(van) {
  const recs = (van.maintenance || []).filter(r => Number(r.mileage) > 0)
  const fromRecs = recs.length ? Math.max(...recs.map(r => Number(r.mileage))) : 0
  return Math.max(Number(van.odometer) || 0, fromRecs) || null
}

/** One line per interval service: when it's next due, by date and by miles. */
export function maintStatus(van) {
  const recs = (van.maintenance || []).slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
  const odo = vanOdometer(van)
  return Object.entries(MAINT_INTERVALS).map(([type, iv]) => {
    const last = recs.find(r => r.type === type)
    if (!last) return { type, last: null, dueDate: '', daysUntil: null, dueMiles: null, milesLeft: null, sev: 0, text: 'no record yet' }
    const dueDate = iv.months ? addMonths(last.date, iv.months) : ''
    const daysUntil = days(dueDate)
    const dueMiles = iv.miles && Number(last.mileage) > 0 ? Number(last.mileage) + iv.miles : null
    const milesLeft = dueMiles && odo ? dueMiles - odo : null
    // 3 overdue · 2 due soon (≤30 days or ≤500 mi) · 1 fine
    let sev = 1
    if ((daysUntil !== null && daysUntil < 0) || (milesLeft !== null && milesLeft < 0)) sev = 3
    else if ((daysUntil !== null && daysUntil <= 30) || (milesLeft !== null && milesLeft <= 500)) sev = 2
    const bits = []
    if (daysUntil !== null) bits.push(daysUntil < 0 ? `${Math.abs(daysUntil)}d overdue` : daysUntil === 0 ? 'due today' : `in ${daysUntil}d`)
    if (milesLeft !== null) bits.push(milesLeft < 0 ? `${Math.abs(milesLeft).toLocaleString()} mi over` : `${milesLeft.toLocaleString()} mi left`)
    else if (dueMiles) bits.push(`at ${dueMiles.toLocaleString()} mi`)
    return { type, last, dueDate, daysUntil, dueMiles, milesLeft, sev, text: bits.join(' · ') || `last ${last.date}` }
  })
}

/** The van's worst maintenance state (0 none/unknown · 1 fine · 2 due soon · 3 overdue). */
export const maintSev = van => Math.max(0, ...maintStatus(van).map(m => m.sev), ...milestoneStatus(van).map(m => m.sev))
