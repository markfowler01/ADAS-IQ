import { useState, useEffect, useCallback } from 'react'
import Navbar from './Navbar'
import {
  API_BASE, apiFetch, COLORS, PageHeader, SectionLabel,
  Card, Button, StatCard, EmptyState, Tabs, EmptyState as Empty,
} from './books/shared'

function fmt(n) { return `$${Number(n || 0).toFixed(2)}` }

const TYPE_LABEL = {
  w2_zoho: { label: 'W-2 (Zoho)', bg: COLORS.infoSoft, color: COLORS.info },
  contractor_wise: { label: 'Contractor (Wise)', bg: COLORS.successSoft, color: COLORS.success },
  contractor_other: { label: 'Contractor (Other)', bg: COLORS.warningSoft, color: COLORS.warning },
  excluded: { label: 'Excluded', bg: COLORS.surfaceSoft, color: COLORS.textMuted },
}

export default function PayrollScreen({ user, onLogout, currentScreen, onNavigate }) {
  const [tab, setTab] = useState('current')
  const [settings, setSettings] = useState(null)
  const [payRun, setPayRun] = useState(null)
  const [runs, setRuns] = useState([])
  const [team, setTeam] = useState([])
  const [loading, setLoading] = useState(true)
  const [approving, setApproving] = useState(false)
  const [periodEnd, setPeriodEnd] = useState(new Date().toISOString().slice(0, 10))
  const [editingLine, setEditingLine] = useState(null)
  const [editingMember, setEditingMember] = useState(null)

  const isAdmin = user?.role !== 'technician'

  const loadRun = useCallback(async () => {
    setLoading(true)
    try {
      const [s, r, h, t] = await Promise.all([
        apiFetch(`${API_BASE}/api/payroll/settings`).then(r => r.json()),
        apiFetch(`${API_BASE}/api/payroll/pay-run?period_end=${periodEnd}`).then(r => r.json()),
        apiFetch(`${API_BASE}/api/payroll/runs`).then(r => r.json()),
        apiFetch(`${API_BASE}/api/team/members`).then(r => r.json()),
      ])
      setSettings(s)
      setPayRun(r.error ? null : r)
      setRuns(Array.isArray(h) ? h : [])
      setTeam(Array.isArray(t) ? t : [])
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }, [periodEnd])

  useEffect(() => { loadRun() }, [loadRun])

  async function approveRun() {
    if (!payRun) return
    if (!confirm(`Approve pay run for ${payRun.period.start} — ${payRun.period.end}?\n\nGross: ${fmt(payRun.totals.gross)}\nThis logs expenses to Books. Payments still need to be sent via Zoho Payroll / Wise.`)) return
    setApproving(true)
    try {
      const r = await apiFetch(`${API_BASE}/api/payroll/pay-run/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          period: payRun.period,
          lines: payRun.lines,
          totals: payRun.totals,
        }),
      })
      if (!r.ok) throw new Error((await r.json()).error)
      alert('Pay run approved! Now download the export files to run payroll.')
      loadRun()
    } catch (e) { alert(e.message) }
    finally { setApproving(false) }
  }

  async function downloadCSV(type) {
    if (!payRun) return
    const res = await apiFetch(`${API_BASE}/api/payroll/export/${type}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lines: payRun.lines, period: payRun.period }),
    })
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${type}-${payRun.period.end}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function downloadPaystub(line) {
    const res = await apiFetch(`${API_BASE}/api/payroll/paystub`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ line, period: payRun.period, settings }),
    })
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    window.open(url, '_blank')
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen" style={{ backgroundColor: 'white' }}>
        <Navbar user={user} onLogout={onLogout} currentScreen={currentScreen} onNavigate={onNavigate} />
        <div className="py-16 text-center text-gray-400 text-sm">Admin access required</div>
      </div>
    )
  }

  const tabs = [
    { id: 'current', label: 'Current Run' },
    { id: 'employees', label: 'Employees' },
    { id: 'history', label: `History`, count: runs.length || null },
    { id: 'settings', label: 'Settings' },
  ]

  return (
    <div className="min-h-screen" style={{ backgroundColor: COLORS.surfaceMuted }}>
      <Navbar user={user} onLogout={onLogout} currentScreen={currentScreen} onNavigate={onNavigate} />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        <PageHeader title="Payroll"
          subtitle="Calculate pay → review → export to Zoho Payroll + Wise" />

        <Tabs tabs={tabs} active={tab} onChange={setTab} className="mb-6" />

        {tab === 'current' && (
          <CurrentRun payRun={payRun} loading={loading} periodEnd={periodEnd}
            setPeriodEnd={setPeriodEnd}
            approving={approving}
            onApprove={approveRun}
            onDownloadCSV={downloadCSV}
            onDownloadPaystub={downloadPaystub}
            onEditLine={setEditingLine} />
        )}
        {tab === 'employees' && (
          <EmployeesTab team={team} onEdit={setEditingMember} onReload={loadRun} />
        )}
        {tab === 'history' && <HistoryTab runs={runs} />}
        {tab === 'settings' && (
          <SettingsTab settings={settings} onSaved={() => loadRun()} />
        )}

        {editingLine && (
          <LineAdjustModal line={editingLine} period={payRun.period}
            onClose={() => setEditingLine(null)}
            onSaved={() => { setEditingLine(null); loadRun() }} />
        )}
        {editingMember && (
          <EmployeePayrollModal member={editingMember}
            onClose={() => setEditingMember(null)}
            onSaved={() => { setEditingMember(null); loadRun() }} />
        )}
      </div>
    </div>
  )
}

// ── Current Run tab ──────────────────────────────────────────────────────────

function CurrentRun({ payRun, loading, periodEnd, setPeriodEnd, approving,
                     onApprove, onDownloadCSV, onDownloadPaystub, onEditLine }) {
  if (loading) return <div className="py-16 text-center text-gray-400 text-sm">Computing pay run…</div>
  if (!payRun) return <div className="py-16 text-center text-red-600 text-sm">Failed to load</div>

  const w2Count = payRun.lines.filter(l => l.payroll_type === 'w2_zoho').length
  const contractorCount = payRun.lines.filter(l => l.payroll_type?.startsWith('contractor')).length

  return (
    <div className="space-y-5">
      {/* Period selector */}
      <Card>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <SectionLabel>Pay period</SectionLabel>
            <p className="text-lg font-bold" style={{ color: COLORS.text }}>
              {payRun.period.start} — {payRun.period.end}
            </p>
            <p className="text-xs mt-0.5" style={{ color: COLORS.textMuted }}>
              {payRun.settings.pay_frequency} · {payRun.lines.length} people
              · {w2Count} W-2 · {contractorCount} contractor
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input type="date" value={periodEnd}
              onChange={e => setPeriodEnd(e.target.value)}
              className="border rounded-lg px-3 py-2 text-sm"
              style={{ borderColor: COLORS.borderStrong }} />
          </div>
        </div>
      </Card>

      {/* Totals */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Gross Pay" value={fmt(payRun.totals.gross)} tone="primary" />
        <StatCard label="Employee Withholdings" value={fmt(payRun.totals.employee_withholding)}
          tone="info" sublabel="FIT + FICA + Medicare (est.)" />
        <StatCard label="Net Pay" value={fmt(payRun.totals.net)} tone="success" />
        <StatCard label="Employer Cost" value={fmt(payRun.totals.total_cost)}
          tone="warning" sublabel={`+ ${fmt(payRun.totals.employer_taxes.total)} employer taxes`} />
      </div>

      {/* Pay lines table */}
      <Card padded={false}>
        <div className="p-5 border-b" style={{ borderColor: COLORS.border }}>
          <h3 className="text-sm font-semibold">People on this pay run</h3>
        </div>
        {payRun.lines.length === 0 ? (
          <EmptyState emoji="👥" title="No one on this pay run"
            subtitle="Mark team members as active + set their payroll type in Employees tab." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead style={{ backgroundColor: COLORS.surfaceMuted }}>
                <tr className="text-xs text-gray-400">
                  <th className="text-left px-4 py-2 font-medium">Employee</th>
                  <th className="text-left px-4 py-2 font-medium">Type</th>
                  <th className="text-right px-4 py-2 font-medium">Hours</th>
                  <th className="text-right px-4 py-2 font-medium">Gross</th>
                  <th className="text-right px-4 py-2 font-medium">Withholding</th>
                  <th className="text-right px-4 py-2 font-medium">Net</th>
                  <th className="text-right px-4 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y" style={{ borderColor: '#f7f4f1' }}>
                {payRun.lines.map(l => {
                  const typeStyle = TYPE_LABEL[l.payroll_type] || TYPE_LABEL.excluded
                  return (
                    <tr key={l.user_id}>
                      <td className="px-4 py-3">
                        <p className="font-semibold">{l.user_name}</p>
                        <p className="text-xs text-gray-500">{l.email || '—'}</p>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs font-medium px-2 py-0.5 rounded-full"
                          style={{ backgroundColor: typeStyle.bg, color: typeStyle.color }}>
                          {typeStyle.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-gray-600">
                        {l.hours.regular + l.hours.overtime > 0 ? `${l.hours.regular}${l.hours.overtime ? ` + ${l.hours.overtime} OT` : ''}` : '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-medium">{fmt(l.gross)}</td>
                      <td className="px-4 py-3 text-right text-gray-500">
                        {l.total_withholding > 0 ? `-${fmt(l.total_withholding)}` : '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold" style={{ color: COLORS.success }}>
                        {fmt(l.net)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button onClick={() => onDownloadPaystub(l)}
                          className="text-xs font-medium" style={{ color: COLORS.info }}>
                          📄 Paystub
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Export + approve */}
      {payRun.lines.length > 0 && (
        <Card>
          <SectionLabel>Run Payroll</SectionLabel>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
            <Button variant="info" onClick={() => onDownloadCSV('zoho-payroll')}
              disabled={w2Count === 0}>
              📥 Zoho Payroll CSV ({w2Count})
            </Button>
            <Button variant="success" onClick={() => onDownloadCSV('wise')}
              disabled={contractorCount === 0}>
              🏦 Wise Batch CSV ({contractorCount})
            </Button>
            <Button variant="primary" onClick={onApprove} disabled={approving}>
              {approving ? 'Approving…' : '✓ Approve & Log to Books'}
            </Button>
          </div>
          <div className="rounded-lg p-3 text-xs" style={{ backgroundColor: COLORS.primarySoft, color: COLORS.primary }}>
            <strong>Workflow:</strong> 1) Download Zoho Payroll CSV → import into Zoho Payroll → approve there.
            2) Download Wise Batch CSV → upload to Wise → pay. 3) Come back here and click "Approve & Log to Books" to record the expenses.
          </div>
        </Card>
      )}
    </div>
  )
}

// ── Employees tab ────────────────────────────────────────────────────────────

function EmployeesTab({ team, onEdit }) {
  if (team.length === 0) {
    return <EmptyState emoji="👥" title="No team members yet"
      subtitle="Add team members in the Team screen first." />
  }
  return (
    <Card padded={false}>
      <div className="p-5 border-b" style={{ borderColor: COLORS.border }}>
        <h3 className="text-sm font-semibold">Payroll configuration per employee</h3>
        <p className="text-xs text-gray-500 mt-1">
          Classify each person as W-2 (Zoho) or Contractor (Wise). Set hourly rate or annual salary.
        </p>
      </div>
      <div className="divide-y" style={{ borderColor: '#f7f4f1' }}>
        {team.filter(m => m.active !== false).map(m => {
          const type = m.payroll_type || 'w2_zoho'
          const typeStyle = TYPE_LABEL[type] || TYPE_LABEL.excluded
          return (
            <div key={m.id || m.ROWID} className="px-5 py-3 flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-semibold flex-shrink-0"
                  style={{ backgroundColor: m.avatar_color || COLORS.primary }}>
                  {(m.name || '?').split(' ').map(s => s[0]).slice(0, 2).join('').toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="font-semibold text-sm">{m.name}</p>
                  <p className="text-xs text-gray-500">
                    {m.hourly_rate > 0 && `$${m.hourly_rate}/hr`}
                    {m.salary_annual > 0 && ` · $${Number(m.salary_annual).toLocaleString()}/yr`}
                    {!m.hourly_rate && !m.salary_annual && 'No rate set'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium px-2 py-0.5 rounded-full"
                  style={{ backgroundColor: typeStyle.bg, color: typeStyle.color }}>
                  {typeStyle.label}
                </span>
                <Button variant="secondary" size="sm" onClick={() => onEdit(m)}>Configure</Button>
              </div>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

// ── History tab ──────────────────────────────────────────────────────────────

function HistoryTab({ runs }) {
  if (runs.length === 0) {
    return <EmptyState emoji="📋" title="No pay runs yet"
      subtitle="Your first approved pay run will appear here." />
  }
  return (
    <div className="space-y-2">
      {runs.map(run => (
        <Card key={run.id} className="hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <p className="font-semibold">{run.period_start} — {run.period_end}</p>
              <p className="text-xs text-gray-500">
                {(run.lines || []).length} people · Approved {new Date(run.approved_at).toLocaleDateString()}
              </p>
            </div>
            <div className="text-right">
              <p className="text-lg font-bold" style={{ color: COLORS.primary }}>{fmt(run.totals?.gross)}</p>
              <p className="text-xs text-gray-500">Gross</p>
            </div>
          </div>
        </Card>
      ))}
    </div>
  )
}

// ── Settings tab ─────────────────────────────────────────────────────────────

function SettingsTab({ settings, onSaved }) {
  const [form, setForm] = useState(settings || {})
  useEffect(() => { if (settings) setForm(settings) }, [settings])
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    try {
      await apiFetch(`${API_BASE}/api/payroll/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      onSaved()
    } catch (e) { alert(e.message) }
    finally { setSaving(false) }
  }

  if (!settings) return <div className="py-12 text-center text-gray-400 text-sm">Loading…</div>

  return (
    <Card className="max-w-2xl">
      <SectionLabel>Pay schedule</SectionLabel>
      <div className="space-y-3 mb-5">
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1.5">Pay frequency</label>
          <select value={form.pay_frequency} onChange={e => setForm(f => ({ ...f, pay_frequency: e.target.value }))}
            className="w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: COLORS.borderStrong }}>
            <option value="weekly">Weekly (52 runs/yr)</option>
            <option value="biweekly">Bi-weekly (26 runs/yr)</option>
            <option value="semimonthly">Semi-monthly (24 runs/yr)</option>
            <option value="monthly">Monthly (12 runs/yr)</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1.5">
            First period end date <span className="font-normal text-gray-400">— anchor for pay calendar</span>
          </label>
          <input type="date" value={form.first_period_end || ''}
            onChange={e => setForm(f => ({ ...f, first_period_end: e.target.value }))}
            className="w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: COLORS.borderStrong }} />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1.5">State</label>
          <input value={form.state || 'WA'}
            onChange={e => setForm(f => ({ ...f, state: e.target.value.toUpperCase() }))}
            maxLength="2" placeholder="WA"
            className="w-full border rounded-lg px-3 py-2 text-sm uppercase" style={{ borderColor: COLORS.borderStrong }} />
          <p className="text-xs text-gray-500 mt-1">WA, TX, FL, NV, SD, TN, WY have no state income tax. Others coming soon.</p>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1.5">Employer EIN</label>
          <input value={form.employer_ein || ''}
            onChange={e => setForm(f => ({ ...f, employer_ein: e.target.value }))}
            placeholder="XX-XXXXXXX"
            className="w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: COLORS.borderStrong }} />
        </div>
      </div>
      <Button variant="primary" onClick={save} disabled={saving}>
        {saving ? 'Saving…' : 'Save Settings'}
      </Button>
    </Card>
  )
}

// ── Employee payroll modal ───────────────────────────────────────────────────

function EmployeePayrollModal({ member, onClose, onSaved }) {
  const [form, setForm] = useState({
    payroll_type: member.payroll_type || 'w2_zoho',
    hourly_rate: member.hourly_rate || 0,
    salary_annual: member.salary_annual || 0,
    filing_status: member.filing_status || 'single',
    wise_email: member.wise_email || member.email || '',
    wise_currency: member.wise_currency || 'USD',
    zoho_payroll_employee_id: member.zoho_payroll_employee_id || '',
  })
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    try {
      await apiFetch(`${API_BASE}/api/team/members/${member.id || member.ROWID}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      onSaved()
    } catch (e) { alert(e.message) }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <Card className="max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <div>
            <h2 className="text-lg font-bold">{member.name}</h2>
            <p className="text-xs text-gray-500">Payroll configuration</p>
          </div>
          <button onClick={onClose} className="text-gray-400 text-xl">×</button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">Type</label>
            <select value={form.payroll_type}
              onChange={e => setForm(f => ({ ...f, payroll_type: e.target.value }))}
              className="w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: COLORS.borderStrong }}>
              <option value="w2_zoho">W-2 Employee (paid via Zoho Payroll)</option>
              <option value="contractor_wise">Independent Contractor (paid via Wise)</option>
              <option value="contractor_other">Contractor (paid other way)</option>
              <option value="excluded">Excluded from payroll</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">Hourly rate</label>
              <input type="number" step="0.01" value={form.hourly_rate}
                onChange={e => setForm(f => ({ ...f, hourly_rate: Number(e.target.value) }))}
                className="w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: COLORS.borderStrong }} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">OR annual salary</label>
              <input type="number" step="1000" value={form.salary_annual}
                onChange={e => setForm(f => ({ ...f, salary_annual: Number(e.target.value) }))}
                className="w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: COLORS.borderStrong }} />
            </div>
          </div>

          {form.payroll_type === 'w2_zoho' && (
            <>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">Filing status (for fed withholding estimate)</label>
                <select value={form.filing_status}
                  onChange={e => setForm(f => ({ ...f, filing_status: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: COLORS.borderStrong }}>
                  <option value="single">Single / Head of Household</option>
                  <option value="married">Married filing jointly</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">
                  Zoho Payroll Employee ID <span className="font-normal text-gray-400">— for CSV matching</span>
                </label>
                <input value={form.zoho_payroll_employee_id}
                  onChange={e => setForm(f => ({ ...f, zoho_payroll_employee_id: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: COLORS.borderStrong }} />
              </div>
            </>
          )}

          {form.payroll_type === 'contractor_wise' && (
            <>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">Wise recipient email</label>
                <input type="email" value={form.wise_email}
                  onChange={e => setForm(f => ({ ...f, wise_email: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: COLORS.borderStrong }} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">Target currency</label>
                <select value={form.wise_currency}
                  onChange={e => setForm(f => ({ ...f, wise_currency: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: COLORS.borderStrong }}>
                  <option>USD</option><option>PHP</option><option>INR</option>
                  <option>EUR</option><option>GBP</option><option>MXN</option>
                  <option>CAD</option><option>AUD</option>
                </select>
              </div>
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-5 pt-4 border-t" style={{ borderColor: COLORS.border }}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </Card>
    </div>
  )
}

// Placeholder — reserved for future manual adjustments
function LineAdjustModal({ line, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <Card className="max-w-md w-full">
        <div className="flex justify-between items-start mb-3">
          <h2 className="text-lg font-bold">{line.user_name}</h2>
          <button onClick={onClose} className="text-gray-400 text-xl">×</button>
        </div>
        <p className="text-sm text-gray-600">Manual adjustments coming soon.</p>
        <Button variant="ghost" onClick={onClose} className="mt-4">Close</Button>
      </Card>
    </div>
  )
}
