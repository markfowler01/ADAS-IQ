// Employee profile (phase 3) + documents (4) + onboarding (5) + 1:1s /
// reviews / training log (7). Fetches /api/people/profile/:id. Owners see
// everything; the person sees their own hours, balances, certs, log
// (minus private notes); everyone else sees the directory card.
import { useEffect, useState } from 'react'
import { API_BASE, apiFetch, ORANGE } from '../books/shared'
import { isOwnerUser } from '../../utils/identity.js'
import { Avatar } from './Directory.jsx'

const GREEN = '#15803d', BLUE = '#1d4ed8', RED = '#b91c1c'
const j = async (url, opts) => { const r = await apiFetch(`${API_BASE}${url}`, opts); const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`); return d }
const h = n => `${Number(n || 0).toFixed(2)}h`
const tel = p => `tel:${String(p || '').replace(/[^\d+]/g, '')}`
const sms = p => `sms:${String(p || '').replace(/[^\d+]/g, '')}`
const yearsSince = d => { if (!d) return ''; const y = (Date.now() - new Date(d + 'T12:00:00')) / 31557600000; return y < 1 ? `${Math.max(1, Math.round(y * 12))} months` : `${Math.floor(y)} year${Math.floor(y) === 1 ? '' : 's'}` }
const daysUntil = d => d ? Math.round((new Date(d + 'T12:00:00') - new Date(new Date().toDateString())) / 86400000) : null
const LOG_LABEL = { '1on1': '🗣 1:1', review: '⭐ Review', training: '🎓 Training', note: '🔒 Note' }

function Section({ title, right, children }) {
  return (
    <div className="rounded-xl mb-3 overflow-hidden" style={{ border: '1px solid #e8e4e0' }}>
      <div className="px-3 py-2 flex items-center justify-between" style={{ backgroundColor: '#f8f6f4' }}>
        <div className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: '#888', fontFamily: 'IBM Plex Mono, monospace' }}>{title}</div>
        {right}
      </div>
      <div className="px-3 py-2">{children}</div>
    </div>
  )
}
const Row = ({ k, v }) => v ? <div className="flex justify-between gap-3 py-1 text-sm" style={{ borderBottom: '1px solid #f3f3f3' }}><span style={{ color: '#888' }}>{k}</span><span className="font-semibold text-right" style={{ color: '#1a1a1a' }}>{v}</span></div> : null
const Small = ({ children, onClick, tone = 'gray' }) => <button type="button" onClick={onClick} className="text-[11px] font-bold rounded-full px-2.5 py-1" style={tone === 'orange' ? { backgroundColor: 'white', color: ORANGE, border: `1px solid ${ORANGE}` } : tone === 'red' ? { backgroundColor: '#fef2f2', color: RED } : { backgroundColor: '#f5f3f0', color: '#555' }}>{children}</button>

export default function ProfileDrawer({ m: card, members, user, onClose, onEdit, onChanged }) {
  const owner = isOwnerUser(user)
  const [p, setP] = useState(null)
  const [err, setErr] = useState('')
  const [adding, setAdding] = useState(null)   // 'cert' | 'equipment' | 'document' | 'log'
  const [form, setForm] = useState({})
  const [busy, setBusy] = useState(false)
  const load = () => j(`/api/people/profile/${card.id}`).then(setP).catch(e => setErr(e.message))
  useEffect(() => { load() }, [card.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const m = p?.member || card
  const me = String(user?.email || '').toLowerCase() === m.user_id || String(user?.name || '').toLowerCase() === String(m.name || '').toLowerCase()
  const canSee = owner || me
  async function patch(fields) { setBusy(true); try { await j(`/api/team/members/${m.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fields) }); await load(); onChanged && onChanged() } catch (e) { alert(e.message) } finally { setBusy(false) } }
  async function addItem() {
    setBusy(true)
    try {
      if (adding === 'cert') await patch({ certifications: [...(m.certifications || []), { name: form.name || '', issuer: form.issuer || '', expires: form.expires || '', added: new Date().toISOString().slice(0, 10) }] })
      if (adding === 'equipment') await patch({ equipment: [...(m.equipment || []), { name: form.name || '', serial: form.serial || '', issued: form.issued || new Date().toISOString().slice(0, 10) }] })
      if (adding === 'document') await patch({ documents: [...(m.documents || []), { name: form.name || '', url: form.url || '', added: new Date().toISOString().slice(0, 10), by: user?.name || '' }] })
      if (adding === 'log') { await j('/api/people/log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: m.user_id, type: form.type || '1on1', date: form.date, title: form.title, body: form.body, cost: form.cost, private: !!form.private }) }); await load() }
      setAdding(null); setForm({})
    } catch (e) { alert(e.message) } finally { setBusy(false) }
  }
  const inp = { border: '1px solid #e0dbd6', outline: 'none', backgroundColor: 'white' }
  const F = ({ k, ph, type = 'text', w = '' }) => <input type={type} value={form[k] || ''} placeholder={ph} onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))} className={`text-sm rounded-lg px-2 py-1.5 ${w}`} style={inp} />
  const AddBox = ({ children }) => <div className="rounded-lg p-2 mt-2 flex gap-2 flex-wrap items-center" style={{ backgroundColor: '#fff5f0', border: `1px solid ${ORANGE}` }}>{children}<button onClick={addItem} disabled={busy} className="text-xs font-bold rounded-lg px-3 py-1.5 text-white" style={{ backgroundColor: GREEN }}>{busy ? '…' : 'Add'}</button><button onClick={() => { setAdding(null); setForm({}) }} className="text-xs font-semibold px-2" style={{ color: '#888' }}>cancel</button></div>
  const cl = m.checklist
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,.5)' }} onClick={onClose}>
      <div className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl p-4 max-h-[94vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-start gap-3 mb-3">
          <Avatar m={m} size={64} />
          <div className="flex-1 min-w-0">
            <div className="font-extrabold text-xl leading-tight" style={{ color: '#1a1a1a' }}>{m.name}</div>
            <div className="text-sm font-semibold" style={{ color: '#555' }}>{m.title}</div>
            <div className="text-xs" style={{ color: '#888' }}>{m.department} · {m.employment === 'w2' ? 'W-2 employee' : m.employment === 'contractor' ? 'Contractor' : 'Owner'}{m.active === false ? ' · inactive' : ''}</div>
            <div className="flex gap-1.5 flex-wrap mt-2">
              {m.phone && <a href={tel(m.phone)} className="text-xs font-bold rounded-lg px-2.5 py-1.5" style={{ backgroundColor: '#dcfce7', color: GREEN }}>📞 Call</a>}
              {m.phone && <a href={sms(m.phone)} className="text-xs font-bold rounded-lg px-2.5 py-1.5" style={{ backgroundColor: '#dbeafe', color: BLUE }}>💬 Text</a>}
              {m.email && <a href={`mailto:${m.email}`} className="text-xs font-bold rounded-lg px-2.5 py-1.5" style={{ backgroundColor: '#f5f3f0', color: '#555' }}>✉️ Email</a>}
              {(owner || me) && <button onClick={() => onEdit(m)} className="text-xs font-bold rounded-lg px-2.5 py-1.5 text-white" style={{ backgroundColor: ORANGE }}>✏️ {me && !owner ? 'Edit my card' : 'Edit'}</button>}
            </div>
          </div>
          <button onClick={onClose} className="text-2xl leading-none px-1" style={{ color: '#888' }}>×</button>
        </div>
        {err && <div className="text-xs mb-2" style={{ color: RED }}>{err}</div>}

        <Section title="Job">
          <Row k="Reports to" v={p?.boss ? `${p.boss.name} · ${p.boss.title}` : ''} />
          <Row k="Direct reports" v={p?.reports?.length ? p.reports.map(r => r.name).join(', ') : ''} />
          <Row k="Started" v={m.hire_date ? `${m.hire_date} · ${yearsSince(m.hire_date)}` : ''} />
          <Row k="Home base" v={m.region} />
          <Row k="Van" v={m.van} />
          <Row k="Birthday" v={m.birthday} />
          {(owner || me) && m.emergency_contact?.name && <Row k="Emergency" v={`${m.emergency_contact.name}${m.emergency_contact.relationship ? ` (${m.emergency_contact.relationship})` : ''} · ${m.emergency_contact.phone || ''}`} />}
          {(owner || me) && <Row k="Personal phone" v={m.personal_phone} />}
        </Section>

        {canSee && p?.hours && (
          <Section title={`This period · ${p.hours.period.label}`}>
            <div className="flex items-baseline justify-between"><span className="text-sm" style={{ color: '#555' }}>Worked so far</span><span className="text-xl font-extrabold tabular-nums">{h(p.hours.worked)}</span></div>
            <div className="text-xs" style={{ color: '#888' }}>{p.hours.days} days{p.hours.ot ? ` · OT ${h(p.hours.ot)}` : ''}{p.hours.holiday ? ` · holiday ${h(p.hours.holiday)}` : ''}{p.hours.sick ? ` · sick ${h(p.hours.sick)}` : ''}{p.hours.vacation ? ` · vacation ${h(p.hours.vacation)}` : ''}</div>
            <div className="flex gap-1.5 flex-wrap mt-1.5">
              <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={p.hours.prev_reviewed ? { backgroundColor: '#dcfce7', color: GREEN } : { backgroundColor: '#fef3c7', color: '#92400e' }}>{p.hours.prev_reviewed ? '✅' : '⏳'} {p.hours.prev_period.label} time card {p.hours.prev_reviewed ? 'approved' : 'not reviewed'}</span>
              {p.hours.flags?.open > 0 && <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: '#fef2f2', color: RED }}>⏱ clocked in now</span>}
              {p.hours.flags?.pending_edits > 0 && <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: '#fef2f2', color: RED }}>✏️ {p.hours.flags.pending_edits} edit waiting</span>}
            </div>
          </Section>
        )}
        {canSee && p?.sick && m.employment === 'w2' && (
          <Section title="Time off">
            <Row k="Sick leave earned" v={h(p.sick.sick_accrued_hours)} />
            <Row k="Sick leave used" v={h(p.sick.sick_used_hours)} />
            <div className="flex justify-between py-1 text-sm"><span style={{ color: '#888' }}>Sick balance</span><b className="tabular-nums" style={{ color: Number(p.sick.sick_balance_hours) < 0 ? RED : GREEN }}>{h(p.sick.sick_balance_hours)}</b></div>
            <div className="text-[11px]" style={{ color: '#888' }}>1 hour earned per 40 worked (WA). Request time off on the Time Off page.</div>
          </Section>
        )}

        {canSee && (
          <Section title="Certifications & licenses" right={owner && <Small tone="orange" onClick={() => { setAdding('cert'); setForm({}) }}>＋ add</Small>}>
            {(m.certifications || []).length === 0 && !m.license_expiry && <div className="text-xs" style={{ color: '#999' }}>None on file yet.</div>}
            {(m.certifications || []).map((c, i) => { const d = daysUntil(c.expires); return (
              <div key={i} className="flex items-center justify-between gap-2 py-1 text-sm" style={{ borderBottom: '1px solid #f3f3f3' }}>
                <div><b>{c.name}</b>{c.issuer ? <span style={{ color: '#888' }}> · {c.issuer}</span> : null}{c.expires ? <span className="ml-2 text-xs font-bold" style={{ color: d != null && d < 0 ? RED : d != null && d <= 30 ? '#b45309' : '#888' }}>{d != null && d < 0 ? `expired ${c.expires}` : `expires ${c.expires}${d != null && d <= 30 ? ` (${d}d)` : ''}`}</span> : null}</div>
                {owner && <Small tone="red" onClick={() => patch({ certifications: m.certifications.filter((_, k) => k !== i) })}>remove</Small>}
              </div>) })}
            {m.license_expiry && <Row k="Driver's license expires" v={`${m.license_expiry}${daysUntil(m.license_expiry) <= 30 ? ' ⚠️' : ''}`} />}
            {adding === 'cert' && <AddBox><F k="name" ph="e.g. I-CAR ADAS, Autel ADAS Level 2" w="flex-1 min-w-[160px]" /><F k="issuer" ph="Issuer" w="w-28" /><F k="expires" type="date" w="w-36" /></AddBox>}
          </Section>
        )}

        {canSee && (
          <Section title="Equipment issued" right={owner && <Small tone="orange" onClick={() => { setAdding('equipment'); setForm({}) }}>＋ add</Small>}>
            {(m.equipment || []).length === 0 && <div className="text-xs" style={{ color: '#999' }}>Nothing listed.</div>}
            {(m.equipment || []).map((e, i) => <div key={i} className="flex items-center justify-between gap-2 py-1 text-sm" style={{ borderBottom: '1px solid #f3f3f3' }}><div><b>{e.name}</b>{e.serial ? <span style={{ color: '#888' }}> · {e.serial}</span> : null}{e.issued ? <span className="text-xs" style={{ color: '#888' }}> · since {e.issued}</span> : null}</div>{owner && <Small tone="red" onClick={() => patch({ equipment: m.equipment.filter((_, k) => k !== i) })}>returned</Small>}</div>)}
            {adding === 'equipment' && <AddBox><F k="name" ph="e.g. Autel MA600, Van 2, iPhone" w="flex-1 min-w-[160px]" /><F k="serial" ph="Serial / plate" w="w-32" /><F k="issued" type="date" w="w-36" /></AddBox>}
          </Section>
        )}

        {owner && (
          <Section title="Documents" right={<Small tone="orange" onClick={() => { setAdding('document'); setForm({}) }}>＋ link</Small>}>
            {(m.documents || []).length === 0 && <div className="text-xs" style={{ color: '#999' }}>No documents linked. Paste WorkDrive links: W-4, I-9, direct deposit, signed handbook, contract.</div>}
            {(m.documents || []).map((d, i) => <div key={i} className="flex items-center justify-between gap-2 py-1 text-sm" style={{ borderBottom: '1px solid #f3f3f3' }}><a href={d.url} target="_blank" rel="noreferrer" className="font-semibold" style={{ color: BLUE }}>📎 {d.name}</a><span className="text-xs" style={{ color: '#888' }}>{d.added}</span><Small tone="red" onClick={() => patch({ documents: m.documents.filter((_, k) => k !== i) })}>remove</Small></div>)}
            {p?.acks && <div className="text-xs mt-1" style={{ color: '#555' }}>HR policy acknowledged: {Object.keys(p.acks).length ? Object.entries(p.acks).map(([k, a]) => `${k} (${String(a.at).slice(0, 10)})`).join(', ') : <span style={{ color: '#b45309' }}>not yet</span>}</div>}
            {adding === 'document' && <AddBox><F k="name" ph="Document name" w="w-40" /><F k="url" ph="https://workdrive.zoho.com/…" w="flex-1 min-w-[200px]" /></AddBox>}
          </Section>
        )}

        {canSee && (
          <Section title={cl ? `${cl.kind === 'offboarding' ? 'Offboarding' : 'Onboarding'} · ${cl.items.filter(i => i.done).length}/${cl.items.length}${cl.completed_at ? ' · done' : ''}` : 'Onboarding'} right={owner && (!cl || cl.completed_at) && <div className="flex gap-1"><Small tone="orange" onClick={() => j(`/api/people/checklist/${m.id}/start`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'onboarding' }) }).then(load)}>▶ start onboarding</Small><Small tone="red" onClick={() => { if (confirm(`Start offboarding ${m.name}? Finishing the list turns off their login.`)) j(`/api/people/checklist/${m.id}/start`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'offboarding' }) }).then(() => { load(); onChanged && onChanged() }) }}>offboard</Small></div>}>
            {!cl && <div className="text-xs" style={{ color: '#999' }}>No checklist running.</div>}
            {cl && cl.items.map(it => (
              <label key={it.key} className="flex items-start gap-2 py-1 text-sm" style={{ borderBottom: '1px solid #f3f3f3', cursor: owner ? 'pointer' : 'default' }}>
                <input type="checkbox" checked={!!it.done} disabled={!owner} onChange={() => j(`/api/people/checklist/${m.id}/toggle`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: it.key }) }).then(() => { load(); onChanged && onChanged() })} className="mt-1" />
                <span style={{ color: it.done ? '#999' : '#1a1a1a', textDecoration: it.done ? 'line-through' : 'none' }}>{it.label}{it.done && it.by ? <span className="text-[11px]" style={{ color: '#aaa' }}> · {it.by} {String(it.at).slice(0, 10)}</span> : null}</span>
              </label>
            ))}
          </Section>
        )}

        {canSee && (
          <Section title="1:1s · reviews · training" right={(owner || me) && <Small tone="orange" onClick={() => { setAdding('log'); setForm({ type: owner ? '1on1' : 'training', date: new Date().toISOString().slice(0, 10) }) }}>＋ add</Small>}>
            {adding === 'log' && (
              <div className="rounded-lg p-2 mb-2" style={{ backgroundColor: '#fff5f0', border: `1px solid ${ORANGE}` }}>
                <div className="flex gap-2 flex-wrap mb-2">
                  <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} className="text-sm rounded-lg px-2 py-1.5" style={inp}>{(owner ? ['1on1', 'review', 'training', 'note'] : ['training']).map(t => <option key={t} value={t}>{LOG_LABEL[t]}</option>)}</select>
                  <F k="date" type="date" w="w-36" />
                  <F k="title" ph="Title (e.g. Sept 1:1, 90-day review, Autel ADAS class)" w="flex-1 min-w-[180px]" />
                  {form.type === 'training' && <F k="cost" ph="Cost $" type="number" w="w-24" />}
                </div>
                <textarea value={form.body || ''} onChange={e => setForm(f => ({ ...f, body: e.target.value }))} rows={3} placeholder="Notes — what was said, what was agreed, next steps" className="w-full text-sm rounded-lg px-2 py-1.5" style={inp} />
                <div className="flex items-center gap-2 mt-2">
                  {owner && <label className="text-xs flex items-center gap-1" style={{ color: '#555' }}><input type="checkbox" checked={!!form.private} onChange={e => setForm(f => ({ ...f, private: e.target.checked }))} /> private (owners only — {m.name.split(' ')[0]} won't see it)</label>}
                  <button onClick={addItem} disabled={busy} className="ml-auto text-xs font-bold rounded-lg px-3 py-1.5 text-white" style={{ backgroundColor: GREEN }}>{busy ? '…' : 'Save'}</button>
                  <button onClick={() => { setAdding(null); setForm({}) }} className="text-xs font-semibold px-2" style={{ color: '#888' }}>cancel</button>
                </div>
              </div>
            )}
            {(p?.log || []).length === 0 && <div className="text-xs" style={{ color: '#999' }}>Nothing logged yet. 1:1 notes, 90-day / annual reviews, and classes go here.</div>}
            {(p?.log || []).map(e => (
              <div key={e.id} className="py-1.5 text-sm" style={{ borderBottom: '1px solid #f3f3f3' }}>
                <div className="flex items-center justify-between gap-2"><div><span className="text-[11px] font-bold px-1.5 py-0.5 rounded-full mr-1.5" style={{ backgroundColor: '#f5f3f0', color: '#555' }}>{LOG_LABEL[e.type] || e.type}{e.private ? ' 🔒' : ''}</span><b>{e.title || '—'}</b></div><span className="text-xs" style={{ color: '#888' }}>{e.date} · {e.by}{e.cost ? ` · $${e.cost}` : ''}</span></div>
                {e.body && <div className="text-xs mt-0.5 whitespace-pre-wrap" style={{ color: '#555' }}>{e.body}</div>}
                {owner && <div className="text-right"><Small tone="red" onClick={() => { if (confirm('Delete this entry?')) j(`/api/people/log/${e.id}`, { method: 'DELETE' }).then(load) }}>delete</Small></div>}
              </div>
            ))}
          </Section>
        )}

        {owner && (
          <Section title="Owners only · pay">
            <div className="text-sm" style={{ color: '#1a1a1a' }}>{m.payroll_type === 'w2_zoho' ? 'W-2 via Zoho Payroll' : m.payroll_type === 'contractor_wise' ? 'Contractor via Wise' : m.payroll_type === 'excluded' ? 'Not on payroll' : m.payroll_type || '—'}{m.hourly_rate ? ` · $${m.hourly_rate}/hr` : ''}{m.salary_annual ? ` · $${Number(m.salary_annual).toLocaleString()}/yr` : ''}</div>
            {m.notes && <div className="text-xs mt-1 whitespace-pre-wrap" style={{ color: '#555' }}>{m.notes}</div>}
          </Section>
        )}
        <button onClick={onClose} className="w-full rounded-xl py-2.5 text-sm font-semibold" style={{ backgroundColor: '#f5f3f0', color: '#555' }}>Close</button>
      </div>
    </div>
  )
}
