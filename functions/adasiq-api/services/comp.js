// 💵 Pay & Benefits (Mark 2026-10-16: "it was very easy to forget about what
// benefits we have… some of the technicians will have different offer
// letters with different benefits"). One structured record per person,
// stored on the TeamMembers card (member.comp, durable Datastore). A
// package template fills the defaults; each person can differ. The offer
// letter is BUILT from this record, so the two can't drift apart.

export const PAYDAYS = 'the 6th and the 21st of each month'   // Mark 2026-10-16

// Field tech package = the terms in Jayden's March 2026 offer letter.
export const DEFAULT_TEMPLATES = {
  field_tech: {
    label: 'Field technician (standard)',
    employment: 'w2', pay_type: 'hourly', pay_rate: 20, hours_per_week: 40,
    title: 'Mobile ADAS Calibration Technician',
    work_area: 'Mobile — service area Bellingham to Tacoma, WA',
    bonuses: [
      { kind: 'revenue_tiers', label: 'Monthly revenue production bonus', threshold: 40000,
        tiers: [{ up_to: 55000, pct: 5 }, { up_to: null, pct: 8 }],
        note: 'Calibrations, pre/post scans, diagnostics and labor count; Calibration ID, technology and other pass-through fees do not. Paid the 15th of the following month.' },
      { kind: 'new_shop', label: 'New shop account bonus', amount: 500, min_jobs: 10,
        note: 'Paid the 15th of the month after the 10th job. No cap.' },
    ],
    benefits: {
      qsehra_monthly: 200,
      vacation_days: 5, vacation_wait_days: 90, vacation_carryover: false, vacation_notice_days: 14,
      sick_leave: 'wa',          // WA: 1h per 40 worked, ≤40h carries over
      paid_holidays: 5,
      company_van: true, tools_provided: true, training: true, phone: false,
      other: [],
    },
    review_after_days: 90,
    terms: { drug_free: true, at_will: true },
  },
  // Remote 1099 contractors (Kat, Joyce): no benefits, no at-will/drug-free
  // wording, paid by Wise. The letter switches to a contractor agreement.
  remote_contractor: {
    label: 'Remote contractor (1099)',
    employment: 'contractor', pay_type: 'hourly', pay_rate: 0, hours_per_week: 40,
    title: 'Operations & Billing Support (independent contractor)',
    work_area: 'Remote',
    bonuses: [],
    benefits: { qsehra_monthly: 0, vacation_days: 0, vacation_wait_days: 90, vacation_carryover: false, vacation_notice_days: 14, sick_leave: 'none', paid_holidays: 0, company_van: false, tools_provided: false, training: true, phone: false, other: [] },
    review_after_days: 0,
    terms: { drug_free: false, at_will: false },
  },
}
export const CONTRACTOR_PAYDAYS = 'the 1st and the 16th of each month, by Wise'

const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d }
const str = (v, max = 300) => String(v ?? '').slice(0, max)
const bool = v => v === true || v === 'true' || v === 1

export function normalizeComp(c = {}) {
  const b = c.benefits || {}
  return {
    template: str(c.template || 'field_tech', 40),
    employment: ['w2', 'contractor'].includes(c.employment) ? c.employment : 'w2',
    pay_type: ['hourly', 'salary', 'monthly', 'per_job'].includes(c.pay_type) ? c.pay_type : 'hourly',
    pay_rate: num(c.pay_rate), hours_per_week: num(c.hours_per_week, 40),
    title: str(c.title, 120), work_area: str(c.work_area, 160),
    start_date: str(c.start_date, 10), effective_date: str(c.effective_date, 10),
    bonuses: (Array.isArray(c.bonuses) ? c.bonuses : []).slice(0, 8).map(x => ({
      kind: ['revenue_tiers', 'new_shop', 'flat', 'other'].includes(x.kind) ? x.kind : 'other',
      label: str(x.label, 80), note: str(x.note, 400),
      threshold: num(x.threshold), amount: num(x.amount), min_jobs: num(x.min_jobs),
      tiers: (Array.isArray(x.tiers) ? x.tiers : []).slice(0, 5).map(t => ({ up_to: t.up_to === null || t.up_to === '' ? null : num(t.up_to), pct: num(t.pct) })),
    })),
    benefits: {
      qsehra_monthly: num(b.qsehra_monthly),
      vacation_days: num(b.vacation_days), vacation_wait_days: num(b.vacation_wait_days, 90),
      vacation_carryover: bool(b.vacation_carryover), vacation_notice_days: num(b.vacation_notice_days, 14),
      sick_leave: b.sick_leave === 'none' ? 'none' : 'wa',
      paid_holidays: num(b.paid_holidays),
      company_van: bool(b.company_van), tools_provided: bool(b.tools_provided), training: bool(b.training), phone: bool(b.phone),
      other: (Array.isArray(b.other) ? b.other : []).slice(0, 10).map(o => str(o, 160)).filter(Boolean),
    },
    review_after_days: num(c.review_after_days, 90),
    reviews: (Array.isArray(c.reviews) ? c.reviews : []).slice(-12).map(r => ({ date: str(r.date, 10), label: str(r.label, 80), done: bool(r.done), note: str(r.note, 300) })),
    terms: { drug_free: c.terms?.drug_free !== false, at_will: c.terms?.at_will !== false },
    notes: str(c.notes, 1000),
    letter: c.letter || null,           // { request_id, status, sent_at, signed_at, file_url }
    history: (Array.isArray(c.history) ? c.history : []).slice(-25),
  }
}

export function fromTemplate(tpl, member = {}) {
  const t = JSON.parse(JSON.stringify(tpl || DEFAULT_TEMPLATES.field_tech))
  return normalizeComp({ ...t, template: t.key || 'field_tech', title: t.employment === 'contractor' ? t.title : (member.title || t.title), start_date: member.hire_date || '' })
}

const $ = n => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: Number(n) % 1 ? 2 : 0, maximumFractionDigits: 2 })}`
export function payLine(c) {
  if (c.pay_type === 'salary') return `${$(c.pay_rate)} per year`
  if (c.pay_type === 'monthly') return `${$(c.pay_rate)} per month`
  if (c.employment === 'contractor' && c.pay_type === 'hourly') return `${$(c.pay_rate)} per hour of work you invoice`
  if (c.pay_type === 'per_job') return `${$(c.pay_rate)} per completed calibration job`
  return `${$(c.pay_rate)} per hour`
}
export function bonusLine(x) {
  if (x.kind === 'revenue_tiers') {
    let lo = x.threshold; const parts = []
    for (const t of x.tiers) { parts.push(t.up_to ? `${t.pct}% of revenue above ${$(x.threshold)} when the month is ${$(lo)} to ${$(t.up_to)}` : `${t.pct}% of revenue above ${$(x.threshold)} when the month is over ${$(lo)}`); if (t.up_to) lo = t.up_to }
    return `${x.label}: no bonus under ${$(x.threshold)}; ${parts.join('; ')}.`
  }
  if (x.kind === 'new_shop') return `${x.label}: ${$(x.amount)} for each new shop account you bring in, once it completes ${x.min_jobs} calibration jobs.`
  if (x.kind === 'flat') return `${x.label}: ${$(x.amount)}.`
  return x.label
}

// Plain-English list for the "My Pay & Benefits" card and the owner table.
export function summarize(c) {
  const b = c.benefits, out = []
  const k1099 = c.employment === 'contractor'
  out.push({ k: 'Pay', v: `${payLine(c)}${c.pay_type === 'hourly' && !k1099 ? `, ${c.hours_per_week} hrs/week, overtime 1.5× past 40` : ''}${k1099 ? ' · 1099 contractor' : ''}` })
  out.push({ k: 'Paydays', v: k1099 ? CONTRACTOR_PAYDAYS : PAYDAYS })
  for (const x of c.bonuses) out.push({ k: 'Bonus', v: bonusLine(x) })
  if (b.qsehra_monthly) out.push({ k: 'Health', v: `Up to ${$(b.qsehra_monthly)}/month tax-free reimbursement (QSEHRA) toward their own health plan, with monthly premium proof.` })
  if (b.vacation_days) out.push({ k: 'Vacation', v: `${b.vacation_days} paid days a year, after ${b.vacation_wait_days} days. ${b.vacation_carryover ? 'Unused days carry over.' : "Unused days don't carry over."} Ask ${b.vacation_notice_days} days ahead.` })
  if (b.sick_leave === 'wa') out.push({ k: 'Sick leave', v: '1 hour for every 40 worked (WA law). Up to 40 unused hours carry over.' })
  if (b.paid_holidays) out.push({ k: 'Holidays', v: `${b.paid_holidays} paid holidays a year.` })
  const perks = [b.company_van && 'company van for job travel', b.tools_provided && 'Autel equipment and tools', b.training && (k1099 ? 'app + billing training' : 'on-the-job ADAS training'), b.phone && 'company phone', ...b.other].filter(Boolean)
  if (perks.length) out.push({ k: 'Provided', v: perks.join(' · ') })
  const next = nextReview(c)
  if (next) out.push({ k: 'Next review', v: `${next.label} on ${next.date}` })
  return out
}

export function nextReview(c) {
  const open = (c.reviews || []).filter(r => !r.done && r.date).sort((a, b) => a.date.localeCompare(b.date))[0]
  if (open) return open
  if (c.start_date && c.review_after_days && !(c.reviews || []).some(r => r.label?.includes('90'))) {
    const d = new Date(c.start_date + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + c.review_after_days)
    if (d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() - 1)   // Saturday → Friday (same rule as the calendar booking)
    if (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() + 1)   // Sunday → Monday
    const iso = d.toISOString().slice(0, 10)
    if (iso >= new Date().toISOString().slice(0, 10)) return { date: iso, label: `${c.review_after_days}-day review`, done: false }
  }
  return null
}

// What changed, in words, for the history log.
export function diffWords(a = {}, b = {}) {
  const out = []
  if (a.pay_rate !== b.pay_rate || a.pay_type !== b.pay_type) out.push(`pay ${a.pay_rate ? payLine(a) : '—'} → ${payLine(b)}`)
  if (JSON.stringify(a.bonuses) !== JSON.stringify(b.bonuses)) out.push('bonuses updated')
  if (JSON.stringify(a.benefits) !== JSON.stringify(b.benefits)) out.push('benefits updated')
  if (JSON.stringify(a.reviews) !== JSON.stringify(b.reviews)) out.push('reviews updated')
  if (a.start_date !== b.start_date) out.push(`start date ${a.start_date || '—'} → ${b.start_date}`)
  if (a.title !== b.title) out.push(`title → ${b.title}`)
  return out.join('; ') || 'details updated'
}

// The offer letter's text, built from the record (W-2). Plain English,
// same terms Mark used in Jayden's March letter. Blocks: string or [heading, body].
export function compLetterBlocks(member, c, opts = {}) {
  return c.employment === 'contractor' ? contractorLetterBlocks(member, c, opts) : w2LetterBlocks(member, c, opts)
}

// Independent contractor agreement (Kat, Joyce). No benefits, no at-will
// employment language; same plain-English voice as the W-2 letter.
export function contractorLetterBlocks(member, c, { owner = 'Mark Fowler', company = 'Absolute ADAS', newHire = false } = {}) {
  const first = String(member.preferred_name || member.name || '').split(' ')[0]
  const longDate = iso => iso ? new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '(to be set)'
  const blocks = [
    `Dear ${first},`,
    newHire ? `This letter sets out the work ${company} is asking you to do as an independent contractor, what it pays, and how we work together.` : `This letter confirms your work with ${company} as an independent contractor: what you do, what it pays, and how we work together. It replaces any earlier agreement.`,
    ['The work', `${c.title || member.title}, working with ${owner}, Owner. Work location: ${c.work_area || 'remote'}. You decide how and when the work gets done inside the deadlines we agree on, and you may use your own equipment. Start date: ${longDate(c.start_date)}.`],
    ['Pay', `${payLine(c)}, paid on ${CONTRACTOR_PAYDAYS}.${c.effective_date && c.effective_date !== c.start_date ? ` This rate is effective ${longDate(c.effective_date)}.` : ''} You are responsible for your own taxes; ${company} does not withhold taxes and will issue a 1099 where required.`],
  ]
  if (c.bonuses.length) blocks.push(['Bonuses', c.bonuses.map(x => `${bonusLine(x)}${x.note ? ' ' + x.note : ''}`).join('\n')])
  const extras = [c.benefits.training && 'Training on the Absolute ADAS app and our billing process.', ...c.benefits.other.map(o => o.endsWith('.') ? o : o + '.')].filter(Boolean)
  if (extras.length) blocks.push(['What we provide', extras.join(' ')])
  blocks.push(['Time records', 'Log your hours in the Absolute ADAS app on the day you work them. Your invoice for each pay period matches what is in the app.'])
  blocks.push(['Not an employee', `This is a contractor relationship, not employment. You are not eligible for employee benefits, paid leave or workers' compensation from ${company}. You may work for others.`])
  blocks.push(['Confidentiality', `Customer lists, shop relationships, pricing, insurer rules, and everything inside the Absolute ADAS app and Zoho stay confidential, during and after this agreement. Work you create for us belongs to ${company}.`])
  blocks.push(['Ending it', "Either of us can end this agreement with 14 days' written notice. We pay for all work done up to the end date."])
  blocks.push(newHire ? 'If this works for you, sign below. Your onboarding link arrives as soon as you do.' : 'If this is right, sign below. You will get a copy of the signed agreement for your records.')
  return blocks
}

function w2LetterBlocks(member, c, { owner = 'Mark Fowler', company = 'Absolute ADAS', newHire = false } = {}) {
  const first = String(member.preferred_name || member.name || '').split(' ')[0]
  const b = c.benefits
  const longDate = iso => iso ? new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '(to be set)'
  const perks = [b.company_van && 'A company van for all job-related travel in the service area.', b.tools_provided && 'Autel calibration equipment and all required tools.', b.training && 'On-the-job ADAS calibration training.', b.phone && 'A company phone.', ...b.other.map(o => o.endsWith('.') ? o : o + '.')].filter(Boolean)
  const blocks = [
    `Dear ${first},`,
    newHire ? `We're glad to offer you a job at ${company}. Here is what the job is, what it pays, and the benefits that come with it.` : `This letter confirms your job at ${company}: what it is, what it pays, and the benefits that come with it. It replaces any earlier offer letter.`,
    ['Position', `${c.title || member.title}, full-time W-2 employee (${c.hours_per_week} hours a week), reporting to ${owner}, Owner. Work location: ${c.work_area || 'mobile, in our service area'}. Start date: ${longDate(c.start_date)}.`],
    ['Pay', `${payLine(c)}${c.pay_type === 'hourly' ? ` (about ${$(c.pay_rate * c.hours_per_week * 52)} a year at ${c.hours_per_week} hours a week)` : ''}, paid on ${PAYDAYS}. Hours over 40 in a workweek are paid at 1.5× your regular rate, per Washington law.${c.effective_date ? ` This rate is effective ${longDate(c.effective_date)}.` : ''}`],
  ]
  if (c.bonuses.length) blocks.push(['Bonuses', c.bonuses.map(x => `${bonusLine(x)}${x.note ? ' ' + x.note : ''}`).join('\n') + `\n${company} adjusts service pricing with the market from time to time; bonuses are figured on the prices in effect when the work is done.`])
  if (b.qsehra_monthly) blocks.push(['Health insurance reimbursement (QSEHRA)', `${company} reimburses up to ${$(b.qsehra_monthly)} a month, tax-free, toward an individual health plan you choose (for example through Washington Healthplanfinder). Send Mark proof of each month's premium. You must keep qualifying health coverage (Minimum Essential Coverage) for the reimbursement to be tax-free.`])
  const to = []
  if (b.vacation_days) to.push(`${b.vacation_days} days of paid vacation per calendar year, starting after your first ${b.vacation_wait_days} days. ${b.vacation_carryover ? 'Unused days carry over.' : 'Vacation days do not carry over to the next year.'} Requests go in the app at least ${b.vacation_notice_days} days ahead and depend on the schedule.`)
  if (b.sick_leave === 'wa') to.push('Paid sick leave under Washington law: 1 hour for every 40 hours worked, from your first day, for your own illness or care, or a family member\'s. Up to 40 unused hours carry over to the next year.')
  if (b.paid_holidays) to.push(`${b.paid_holidays} paid holidays a year.`)
  if (to.length) blocks.push(['Time off', to.join('\n')])
  if (perks.length) blocks.push(['What we provide', perks.join(' ') + ' You are responsible for the care, cleanliness and maintenance reporting of company property; damage from negligence may be your financial responsibility. The company van is for business use only, within the service area.'])
  const rv = nextReview(c)
  if (rv && rv.date >= new Date().toISOString().slice(0, 10)) blocks.push(['Reviews', `Your next performance and pay review is the ${rv.label.toLowerCase()} on ${longDate(rv.date)}. Changes are based on performance, technical skill and contribution to company revenue.`])
  blocks.push(['Hours and time records', 'Monday through Friday, with daily hours set by the work and the dispatch schedule. Record all your time in the Absolute ADAS app on the day you work it.'])
  if (c.terms.drug_free) blocks.push(['Drug-free workplace', `Because you drive a company vehicle and do safety-critical calibrations, ${company} is a drug-free workplace. You may be tested before employment, on reasonable suspicion, and after an accident.`])
  blocks.push(['Confidentiality', `Customer lists, shop relationships, pricing, processes and anything else not public about ${company} stay confidential, during and after your employment.`])
  blocks.push(['Company property', 'When your employment ends, return the van, keys, equipment, tools and any company devices on your last day. Unreturned property may be deducted from final pay as far as Washington law allows.'])
  if (c.terms.at_will) blocks.push(['At-will employment', 'Either of us can end employment at any time, with or without cause or notice. This letter is not a contract for a set period, and it is the whole agreement about your pay and benefits.'])
  blocks.push(['Equal opportunity', `${company} is an equal opportunity employer.`])
  blocks.push(newHire ? 'If this works for you, sign below. Your onboarding link arrives on your phone as soon as you do. We are looking forward to having you on the crew.' : 'If this is right, sign below. You will get a copy of the signed letter for your records.')
  return blocks
}
