// HR handbook / policy text — the ONE copy (2026-09-16). The HR Policy page,
// the onboarding sign-off PDF and the AI Q&A all read from here. Edits here
// change the version hash → everyone is asked to acknowledge again.
import crypto from 'crypto'
export const SECTIONS = [
  {
    title: 'Paid Holidays',
    body: `Absolute ADAS observes five paid holidays each year:

• New Year's Day
• Memorial Day
• Independence Day
• Labor Day
• Christmas Day

Full-time employees receive eight hours of holiday pay at their regular rate for each of these dates, regardless of the day of the week on which the holiday falls. We do not shift holidays to an adjacent weekday. When a holiday falls on a weekend, you receive the holiday pay for that date.

Holiday hours are not hours worked and do not count toward overtime.

If you are asked to work on a holiday, you will be paid for the hours worked in addition to your holiday pay.`,
  },
  {
    title: 'Paid Sick Leave',
    body: `All employees accrue one hour of paid sick leave for every 40 hours worked, including overtime hours. Accrual begins on your first day of employment. You may begin using accrued sick leave on your 90th calendar day of employment.

Paid sick leave may be used for your own illness, injury, or health condition; to care for a family member with an illness, injury, or health condition; when our workplace or your child's school or place of care is closed by a public official for health reasons; and for absences that qualify under Washington's Domestic Violence Leave Act.

To request sick leave, notify Mark as far in advance as possible, or as soon as practical for unforeseen absences. Documentation is not required for absences of three or fewer consecutive scheduled workdays.

If you need sick leave beyond what you have accrued, we may advance you up to 40 additional hours at our discretion. Advanced hours are repaid automatically out of future accrual.

Unused sick leave carries over to the next year. Sick leave is not paid out at separation. If you are rehired within 12 months, your unused balance will be restored.

Using paid sick leave will not be counted against you under any attendance or performance policy.`,
  },
  {
    title: 'Other Time Off',
    body: `We do not currently offer paid vacation. Time off that does not qualify as a paid holiday or paid sick leave is unpaid and subject to approval based on scheduling coverage.

Request all time off through the Time Off page in this app. Requests route to Mark for approval.`,
  },
]

export const policyId = t => String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-')
// Same hash the client used (djb2 → base36) so existing acknowledgments stay valid.
export function policyVersion(body) { let h = 5381; for (let i = 0; i < body.length; i++) h = ((h << 5) + h + body.charCodeAt(i)) | 0; return (h >>> 0).toString(36) }
export function handbookText() { return SECTIONS.map(s => `## ${s.title}\n${s.body}`).join('\n\n') }
export function handbookHash() { return crypto.createHash('sha256').update(handbookText()).digest('hex').slice(0, 12) }
