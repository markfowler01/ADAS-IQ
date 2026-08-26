// HR Policy — the handbook text WA requires us to post where the team
// can see it (Mark's HR SOP, 2026-08-15). Static by design: policy
// changes are deliberate edits, not data.

import Navbar from '../components/Navbar.jsx'

const ORANGE = '#CD4419'

const SECTIONS = [
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

export default function HRPolicyScreen({ user, onLogout, currentScreen, onNavigate }) {
  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: '#f5f3f0' }}>
      <Navbar user={user} onLogout={onLogout} currentScreen={currentScreen} onNavigate={onNavigate} />
      <div className="max-w-2xl w-full mx-auto px-4 py-6 flex-1">
        <div className="text-[11px] uppercase tracking-widest" style={{ color: '#888', fontFamily: 'IBM Plex Mono, monospace' }}>Absolute ADAS</div>
        <h1 className="text-xl font-bold mb-1" style={{ color: '#1a1a1a' }}>Time Off & Holiday Policy</h1>
        <p className="text-xs mb-5" style={{ color: '#888' }}>
          Washington State requires this notice of your paid sick leave rights. Questions → Mark.
        </p>
        {SECTIONS.map(s => (
          <div key={s.title} className="rounded-2xl bg-white p-5 mb-4" style={{ border: '1px solid #ebebeb' }}>
            <h2 className="text-sm font-bold mb-2" style={{ color: ORANGE }}>{s.title}</h2>
            <div className="text-sm whitespace-pre-wrap" style={{ color: '#333', lineHeight: 1.65 }}>{s.body}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
