// Directory + Org chart (Mark 2026-09-16: "build all the company tools like
// Directory and then add everybody… like a real company, also an org
// chart"). Cards with one-tap Call / Text / Email, a profile drawer, self
// edit for your own contact + emergency info, owner edit for everything
// (incl. the pay block), and an org chart drawn from "reports to".
import { useEffect, useMemo, useState } from 'react'
import { API_BASE, apiFetch, ORANGE } from '../books/shared'
import { isOwnerUser } from '../../utils/identity.js'

const GREEN = '#15803d', BLUE = '#1d4ed8'
const DEPT_COLORS = { Leadership: '#b45309', Operations: '#7c3aed', Field: '#2563eb', Finance: '#0e7490', Sales: '#c2410c' }
const EMPLOYMENT = { owner: 'Owner', w2: 'W-2 employee', contractor: 'Contractor' }
const ACCESS_LABEL = { owner: 'Owner access', dispatcher: 'Dispatch access', technician: 'Technician access', none: 'No app login' }
const j = async (url, opts) => { const r = await apiFetch(`${API_BASE}${url}`, opts); const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`); return d }
const tel = p => `tel:${String(p || '').replace(/[^\d+]/g, '')}`
const sms = p => `sms:${String(p || '').replace(/[^\d+]/g, '')}`
const initials = n => (n || '?').split(' ').map(s => s[0]).slice(0, 2).join('').toUpperCase()
function yearsSince(d) { if (!d) return ''; const ms = Date.now() - new Date(d + 'T12:00:00'); const y = ms / 31557600000; return y < 1 ? `${Math.max(1, Math.round(y * 12))} mo` : `${Math.floor(y)} yr${Math.floor(y) === 1 ? '' : 's'}` }
function nextBirthday(mmdd) {
  if (!/^\d{2}-\d{2}$/.test(mmdd || '')) return null
  const now = new Date(); let d = new Date(now.getFullYear(), Number(mmdd.slice(0, 2)) - 1, Number(mmdd.slice(3, 5)))
  if (d < new Date(now.getFullYear(), now.getMonth(), now.getDate())) d = new Date(now.getFullYear() + 1, d.getMonth(), d.getDate())
  return Math.round((d - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000)
}

export function Avatar({ m, size = 44 }) {
  return m?.photo_url
    ? <img src={m.photo_url} alt="" className="rounded-full object-cover flex-shrink-0" style={{ width: size, height: size }} />
    : <div className="rounded-full flex items-center justify-center text-white font-bold flex-shrink-0" style={{ width: size, height: size, backgroundColor: m?.avatar_color || ORANGE, fontSize: size * 0.36 }}>{initials(m?.name)}</div>
}

function ContactButtons({ m, size = 'sm' }) {
  const cls = size === 'sm' ? 'text-xs px-2.5 py-1.5' : 'text-sm px-3 py-2'
  return (
    <div className="flex gap-1.5 flex-wrap">
      {m.phone && <a href={tel(m.phone)} onClick={e => e.stopPropagation()} className={`${cls} font-bold rounded-lg`} style={{ backgroundColor: '#dcfce7', color: GREEN }}>📞 Call</a>}
      {m.phone && <a href={sms(m.phone)} onClick={e => e.stopPropagation()} className={`${cls} font-bold rounded-lg`} style={{ backgroundColor: '#dbeafe', color: BLUE }}>💬 Text</a>}
      {m.email && <a href={`mailto:${m.email}`} onClick={e => e.stopPropagation()} className={`${cls} font-bold rounded-lg`} style={{ backgroundColor: '#f5f3f0', color: '#555' }}>✉️ Email</a>}
      {!m.phone && !m.email && <span className="text-xs" style={{ color: '#bbb' }}>no contact info yet</span>}
    </div>
  )
}

// ── Directory ──────────────────────────────────────────────────────────
const STATUS_CHIP = { in: { label: '🟢 On the clock', bg: '#dcfce7', color: '#15803d' }, off: { label: '🌴 Off today', bg: '#e0f2fe', color: '#0369a1' } }
export function DirectoryTab({ members, user, onOpen, onAdd, status = {} }) {
  const [q, setQ] = useState('')
  const [dept, setDept] = useState('')
  const [emergency, setEmergency] = useState(null)   // owner-only card: every emergency contact + van, one tap
  const owner = isOwnerUser(user)
  async function openEmergency() { try { setEmergency(await j('/api/people/emergency')) } catch (e) { alert(e.message) } }
  const depts = useMemo(() => [...new Set(members.map(m => m.department).filter(Boolean))], [members])
  const shown = members.filter(m => m.active !== false || owner).filter(m => !dept || m.department === dept).filter(m => {
    const n = q.trim().toLowerCase(); if (!n) return true
    return [m.name, m.preferred_name, m.title, m.department, m.email, m.phone, m.region].some(v => String(v || '').toLowerCase().includes(n))
  })
  const soon = members.map(m => ({ m, d: nextBirthday(m.birthday) })).filter(x => x.d != null && x.d <= 14).sort((a, b) => a.d - b.d)
  return (
    <div>
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search people, titles, departments…" className="flex-1 min-w-[200px] text-sm rounded-xl px-3 py-2" style={{ border: '1px solid #e0dbd6', backgroundColor: 'white', outline: 'none' }} />
        {depts.map(d => <button key={d} onClick={() => setDept(dept === d ? '' : d)} className="text-xs font-bold rounded-full px-3 py-1.5" style={dept === d ? { backgroundColor: DEPT_COLORS[d] || '#555', color: 'white' } : { backgroundColor: 'white', color: DEPT_COLORS[d] || '#555', border: `1px solid ${DEPT_COLORS[d] || '#ddd'}` }}>{d}</button>)}
        {owner && <button onClick={openEmergency} className="text-xs font-bold rounded-full px-3 py-1.5" style={{ backgroundColor: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca' }}>🚨 Emergency card</button>}
        {owner && <button onClick={onAdd} className="text-xs font-bold rounded-full px-3 py-1.5 text-white" style={{ backgroundColor: ORANGE }}>＋ Add person</button>}
      </div>
      {emergency && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,.5)' }} onClick={() => setEmergency(null)}>
          <div className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl p-4 max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2"><div className="font-extrabold text-lg" style={{ color: '#b91c1c' }}>🚨 Emergency card</div><button onClick={() => setEmergency(null)} className="text-2xl leading-none px-1" style={{ color: '#888' }}>×</button></div>
            <div className="text-xs mb-3" style={{ color: '#666' }}>Owners only. Who to call for each person, their van, and their license status. Fix gaps on their card.</div>
            {(emergency.people || []).map(p => (
              <div key={p.id} className="rounded-xl p-3 mb-2" style={{ border: '1px solid #e8e4e0' }}>
                <div className="flex items-center justify-between gap-2"><div className="font-bold text-sm" style={{ color: '#1a1a1a' }}>{p.name}{p.van ? ` · 🚐 ${p.van}` : ''}{p.region ? ` · 📍 ${p.region}` : ''}</div>{p.phone && <a href={tel(p.phone)} className="text-xs font-bold rounded-lg px-2.5 py-1.5" style={{ backgroundColor: '#dcfce7', color: GREEN }}>📞 {p.phone}</a>}</div>
                {p.emergency_contact?.name
                  ? <div className="flex items-center justify-between gap-2 mt-1.5 text-sm"><span style={{ color: '#374151' }}><b>{p.emergency_contact.name}</b>{p.emergency_contact.relationship ? ` (${p.emergency_contact.relationship})` : ''}</span>{p.emergency_contact.phone && <a href={tel(p.emergency_contact.phone)} className="text-xs font-bold rounded-lg px-2.5 py-1.5" style={{ backgroundColor: '#fef2f2', color: '#b91c1c' }}>🚨 {p.emergency_contact.phone}</a>}</div>
                  : <div className="text-xs mt-1.5 font-semibold" style={{ color: '#b91c1c' }}>No emergency contact on file — send them the catch-up link.</div>}
                {p.license_expiry && <div className="text-[11px] mt-1" style={{ color: p.license_expiry < new Date().toISOString().slice(0, 10) ? '#b91c1c' : '#888' }}>🪪 License {p.license_expiry < new Date().toISOString().slice(0, 10) ? 'EXPIRED' : 'expires'} {p.license_expiry}</div>}
              </div>
            ))}
          </div>
        </div>
      )}
      {soon.length > 0 && <div className="text-xs font-semibold mb-3 px-3 py-2 rounded-lg" style={{ backgroundColor: '#fff7ed', color: '#c2410c' }}>🎂 {soon.map(x => `${x.m.preferred_name || x.m.name.split(' ')[0]} ${x.d === 0 ? 'today!' : x.d === 1 ? 'tomorrow' : `in ${x.d} days`}`).join(' · ')}</div>}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {shown.map(m => {
          const me = String(user?.email || '').toLowerCase() === m.user_id || String(user?.name || '').toLowerCase() === String(m.name || '').toLowerCase()
          return (
            <button key={m.id} onClick={() => onOpen(m)} className="text-left rounded-2xl p-4 bg-white" style={{ border: '1.5px solid #e8e4e0', opacity: m.active === false ? .5 : 1, boxShadow: '0 1px 2px rgba(0,0,0,.04)' }}>
              <div className="flex items-start gap-3">
                <Avatar m={m} size={52} />
                <div className="flex-1 min-w-0">
                  <div className="font-extrabold text-base leading-tight" style={{ color: '#1a1a1a' }}>{m.preferred_name ? `${m.preferred_name} ${m.name.split(' ').slice(1).join(' ')}` : m.name}{me && <span className="text-xs font-normal ml-1" style={{ color: '#999' }}>(you)</span>}</div>
                  <div className="text-sm font-semibold" style={{ color: DEPT_COLORS[m.department] || '#555' }}>{m.title || '—'}</div>
                  <div className="text-xs mt-0.5" style={{ color: '#888' }}>{m.department}{m.employment ? ` · ${EMPLOYMENT[m.employment] || m.employment}` : ''}{m.track === 'apprentice' ? ' · 🪜 apprentice' : ''}{m.region ? ` · 📍 ${m.region}` : ''}{m.active === false ? ' · inactive' : ''}</div>
                  {status[m.id] && STATUS_CHIP[status[m.id].state] && <span className="inline-block text-[11px] font-bold rounded-full px-2 py-0.5 mt-1" style={{ backgroundColor: STATUS_CHIP[status[m.id].state].bg, color: STATUS_CHIP[status[m.id].state].color }}>{STATUS_CHIP[status[m.id].state].label}{status[m.id].on_break ? ' · on break' : ''}{status[m.id].state === 'in' && status[m.id].since ? ` since ${new Date(status[m.id].since).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : ''}</span>}
                </div>
              </div>
              <div className="mt-3"><ContactButtons m={m} /></div>
              {(m.hire_date || m.van) && <div className="text-[11px] mt-2" style={{ color: '#999' }}>{m.hire_date ? `With us ${yearsSince(m.hire_date)}` : ''}{m.van ? ` · 🚐 ${m.van}` : ''}</div>}
            </button>
          )
        })}
      </div>
      {shown.length === 0 && <div className="text-sm py-8 text-center" style={{ color: '#888' }}>Nobody matches.</div>}
    </div>
  )
}

// ── Org chart ──────────────────────────────────────────────────────────
function OrgNode({ m, kids, seats, onOpen, depth = 0 }) {
  const mySeats = seats.filter(s => (s.reports_to || '') === m.user_id)
  return (
    <div className="flex flex-col items-center">
      <button onClick={() => onOpen(m)} className="rounded-2xl px-4 py-3 bg-white text-center" style={{ border: `2px solid ${DEPT_COLORS[m.department] || '#ddd'}`, minWidth: 180, boxShadow: '0 2px 6px rgba(0,0,0,.06)' }}>
        <div className="flex justify-center mb-1.5"><Avatar m={m} size={44} /></div>
        <div className="font-extrabold text-sm leading-tight" style={{ color: '#1a1a1a' }}>{m.name}</div>
        <div className="text-xs font-semibold" style={{ color: DEPT_COLORS[m.department] || '#555' }}>{m.title}</div>
        <div className="text-[10px] mt-0.5" style={{ color: '#999' }}>{m.department}{m.employment === 'contractor' ? ' · contractor' : ''}</div>
      </button>
      {(kids.length > 0 || mySeats.length > 0) && (
        <>
          <div style={{ width: 2, height: 18, backgroundColor: '#d4d0cb' }} />
          <div className="flex gap-4 items-start flex-wrap justify-center" style={{ borderTop: (kids.length + mySeats.length) > 1 ? '2px solid #d4d0cb' : 'none', paddingTop: 18 }}>
            {kids.map(k => <OrgNode key={k.id} m={k.m} kids={k.kids} seats={seats} onOpen={onOpen} depth={depth + 1} />)}
            {mySeats.map((s, i) => (
              <div key={`seat${i}`} className="rounded-2xl px-4 py-3 text-center" style={{ border: '2px dashed #c9c4bf', minWidth: 180, color: '#888', backgroundColor: '#faf9f7' }}>
                <div className="text-2xl">🪑</div>
                <div className="font-bold text-sm" style={{ color: '#555' }}>{s.title}</div>
                <div className="text-[10px]">open seat · hiring{s.department ? ` · ${s.department}` : ''}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
export function OrgChartTab({ members, user, onOpen }) {
  const [seats, setSeats] = useState([])
  const [editSeats, setEditSeats] = useState(false)
  const [draft, setDraft] = useState([])
  const owner = isOwnerUser(user)
  useEffect(() => { j('/api/team/org').then(d => setSeats(d.open_seats || [])).catch(() => {}) }, [])
  const active = members.filter(m => m.active !== false)
  const byId = Object.fromEntries(active.map(m => [m.user_id, m]))
  const build = m => ({ id: m.id, m, kids: active.filter(k => k.reports_to && k.reports_to === m.user_id && k.user_id !== m.user_id).map(build) })
  const roots = active.filter(m => !m.reports_to || !byId[m.reports_to]).map(build)
  async function saveSeats() { try { const d = await j('/api/team/org/open-seats', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ seats: draft }) }); setSeats(d.seats); setEditSeats(false) } catch (e) { alert(e.message) } }
  return (
    <div>
      <div className="flex items-center gap-2 flex-wrap mb-4">
        <button onClick={() => window.print()} className="text-xs font-bold rounded-full px-3 py-1.5" style={{ backgroundColor: 'white', color: '#555', border: '1px solid #e0dbd6' }}>🖨 Print / PDF</button>
        {owner && !editSeats && <button onClick={() => { setDraft(seats.length ? seats : [{ title: 'ADAS Calibration Technician', reports_to: 'mark@absoluteadas.com', department: 'Field' }]); setEditSeats(true) }} className="text-xs font-bold rounded-full px-3 py-1.5" style={{ backgroundColor: 'white', color: ORANGE, border: `1px solid ${ORANGE}` }}>🪑 Open seats ({seats.length})</button>}
        <span className="text-xs" style={{ color: '#888' }}>Drawn from each person's "reports to". Tap a box for the profile.</span>
      </div>
      {editSeats && (
        <div className="rounded-xl p-3 mb-4" style={{ backgroundColor: '#fff5f0', border: `1.5px solid ${ORANGE}` }}>
          <div className="text-xs font-bold mb-2" style={{ color: '#1a1a1a' }}>Open seats — show as dashed boxes on the chart (and on the careers page later)</div>
          {draft.map((s, i) => (
            <div key={i} className="flex gap-2 mb-2 flex-wrap">
              <input value={s.title} onChange={e => setDraft(d => d.map((x, k) => k === i ? { ...x, title: e.target.value } : x))} placeholder="Title" className="flex-1 min-w-[160px] text-sm rounded-lg px-2 py-1.5" style={{ border: '1px solid #ddd' }} />
              <select value={s.reports_to} onChange={e => setDraft(d => d.map((x, k) => k === i ? { ...x, reports_to: e.target.value } : x))} className="text-sm rounded-lg px-2 py-1.5" style={{ border: '1px solid #ddd' }}>
                <option value="">Reports to…</option>{active.map(m => <option key={m.user_id} value={m.user_id}>{m.name}</option>)}
              </select>
              <select value={s.department} onChange={e => setDraft(d => d.map((x, k) => k === i ? { ...x, department: e.target.value } : x))} className="text-sm rounded-lg px-2 py-1.5" style={{ border: '1px solid #ddd' }}>
                <option value="">Dept…</option>{Object.keys(DEPT_COLORS).map(d => <option key={d}>{d}</option>)}
              </select>
              <button onClick={() => setDraft(d => d.filter((_, k) => k !== i))} className="text-xs font-bold px-2" style={{ color: '#b91c1c' }}>remove</button>
            </div>
          ))}
          <div className="flex gap-2">
            <button onClick={() => setDraft(d => [...d, { title: '', reports_to: 'mark@absoluteadas.com', department: 'Field' }])} className="text-xs font-bold rounded-lg px-3 py-1.5" style={{ backgroundColor: 'white', color: ORANGE, border: `1px solid ${ORANGE}` }}>＋ seat</button>
            <button onClick={saveSeats} className="text-xs font-bold rounded-lg px-3 py-1.5 text-white" style={{ backgroundColor: GREEN }}>Save</button>
            <button onClick={() => setEditSeats(false)} className="text-xs font-bold rounded-lg px-3 py-1.5" style={{ backgroundColor: '#f5f3f0', color: '#555' }}>Cancel</button>
          </div>
        </div>
      )}
      <div className="overflow-x-auto pb-4" id="org-chart-print">
        <div className="text-center mb-3 hidden print:block"><div className="font-extrabold text-lg">Absolute ADAS — Org Chart</div><div className="text-xs" style={{ color: '#888' }}>{new Date().toLocaleDateString()}</div></div>
        <div className="flex gap-8 justify-center items-start" style={{ minWidth: 'max-content', padding: '8px 16px' }}>
          {roots.map(r => <OrgNode key={r.id} m={r.m} kids={r.kids} seats={seats} onOpen={onOpen} />)}
        </div>
      </div>
      <style>{`@media print { body * { visibility: hidden } #org-chart-print, #org-chart-print * { visibility: visible } #org-chart-print { position: absolute; left: 0; top: 0; width: 100% } }`}</style>
    </div>
  )
}

// ── Profile drawer ─────────────────────────────────────────────────────
export function ProfileDrawer({ m, members, user, onClose, onEdit }) {
  const owner = isOwnerUser(user)
  const me = String(user?.email || '').toLowerCase() === m.user_id || String(user?.name || '').toLowerCase() === String(m.name || '').toLowerCase()
  const boss = members.find(x => x.user_id === m.reports_to)
  const reports = members.filter(x => x.reports_to === m.user_id && x.active !== false)
  const bd = nextBirthday(m.birthday)
  const Row = ({ k, v }) => v ? <div className="flex justify-between gap-3 py-1.5 text-sm" style={{ borderBottom: '1px solid #f3f3f3' }}><span style={{ color: '#888' }}>{k}</span><span className="font-semibold text-right" style={{ color: '#1a1a1a' }}>{v}</span></div> : null
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,.5)' }} onClick={onClose}>
      <div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-5 max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-start gap-3 mb-3">
          <Avatar m={m} size={64} />
          <div className="flex-1 min-w-0">
            <div className="font-extrabold text-xl leading-tight" style={{ color: '#1a1a1a' }}>{m.name}</div>
            <div className="text-sm font-semibold" style={{ color: DEPT_COLORS[m.department] || '#555' }}>{m.title}</div>
            <div className="text-xs" style={{ color: '#888' }}>{m.department} · {EMPLOYMENT[m.employment] || m.employment}{m.access ? ` · ${ACCESS_LABEL[m.access] || m.access}` : ''}</div>
          </div>
          <button onClick={onClose} className="text-2xl leading-none px-1" style={{ color: '#888' }}>×</button>
        </div>
        <div className="mb-3"><ContactButtons m={m} size="md" /></div>
        <Row k="Work phone" v={m.phone} />
        <Row k="Personal phone" v={owner || me ? m.personal_phone : ''} />
        <Row k="Email" v={m.email} />
        <Row k="Reports to" v={boss ? `${boss.name} · ${boss.title}` : (m.reports_to ? m.reports_to : '')} />
        <Row k="Direct reports" v={reports.length ? reports.map(r => r.name).join(', ') : ''} />
        <Row k="Hire date" v={m.hire_date ? `${m.hire_date} · ${yearsSince(m.hire_date)}` : ''} />
        <Row k="Birthday" v={m.birthday ? `${m.birthday}${bd != null ? ` · ${bd === 0 ? 'today 🎂' : `in ${bd} days`}` : ''}` : ''} />
        <Row k="Home base" v={m.region} />
        <Row k="Van" v={m.van} />
        {(owner || me) && m.emergency_contact?.name && <Row k="Emergency contact" v={`${m.emergency_contact.name}${m.emergency_contact.relationship ? ` (${m.emergency_contact.relationship})` : ''} · ${m.emergency_contact.phone || ''}`} />}
        {Array.isArray(m.certifications) && m.certifications.length > 0 && <Row k="Certifications" v={m.certifications.map(c => c.name || c).join(', ')} />}
        {owner && (
          <div className="rounded-xl p-3 mt-3" style={{ backgroundColor: '#fffbeb', border: '1px solid #fde68a' }}>
            <div className="text-[10px] uppercase tracking-wider font-semibold mb-1" style={{ color: '#92400e', fontFamily: 'IBM Plex Mono, monospace' }}>Owners only · pay</div>
            <div className="text-sm" style={{ color: '#1a1a1a' }}>{m.payroll_type === 'w2_zoho' ? 'W-2 via Zoho Payroll' : m.payroll_type === 'contractor_wise' ? 'Contractor via Wise' : m.payroll_type === 'excluded' ? 'Not on payroll' : m.payroll_type || '—'}{m.hourly_rate ? ` · $${m.hourly_rate}/hr` : ''}{m.salary_annual ? ` · $${Number(m.salary_annual).toLocaleString()}/yr` : ''}</div>
            {m.notes && <div className="text-xs mt-1 whitespace-pre-wrap" style={{ color: '#555' }}>{m.notes}</div>}
          </div>
        )}
        <div className="flex gap-2 mt-4">
          {(owner || me) && <button onClick={() => onEdit(m)} className="flex-1 rounded-xl py-2.5 text-sm font-bold text-white" style={{ backgroundColor: ORANGE }}>{me && !owner ? '✏️ Edit my card' : '✏️ Edit'}</button>}
          <button onClick={onClose} className="rounded-xl px-4 py-2.5 text-sm font-semibold" style={{ backgroundColor: '#f5f3f0', color: '#555' }}>Close</button>
        </div>
      </div>
    </div>
  )
}

// ── Edit / add ─────────────────────────────────────────────────────────
export function MemberEditModal({ member, members, user, onClose, onSaved }) {
  const owner = isOwnerUser(user)
  const [f, setF] = useState(() => member ? { ...member, emergency_contact: member.emergency_contact || { name: '', phone: '', relationship: '' } } : { name: '', preferred_name: '', email: '', user_id: '', phone: '', personal_phone: '', title: '', department: 'Field', track: 'tech', access: 'technician', employment: 'w2', reports_to: 'mark@absoluteadas.com', hire_date: '', birthday: '', region: '', van: '', avatar_color: '#2563eb', emergency_contact: { name: '', phone: '', relationship: '' }, hourly_rate: 0, payroll_type: 'w2_zoho', salary_annual: 0, notes: '', active: true })
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))
  const inp = { border: '1px solid #e0dbd6', outline: 'none', backgroundColor: 'white' }
  const I = ({ label, k, type = 'text', placeholder = '', full = false }) => (
    <label className={`text-[11px] font-bold ${full ? 'col-span-2' : ''}`} style={{ color: '#888' }}>{label}<input type={type} value={f[k] ?? ''} placeholder={placeholder} onChange={e => set(k, type === 'number' ? Number(e.target.value) : e.target.value)} className="w-full text-sm rounded-lg px-2.5 py-2 mt-0.5 font-normal" style={inp} /></label>
  )
  const S = ({ label, k, opts }) => (
    <label className="text-[11px] font-bold" style={{ color: '#888' }}>{label}<select value={f[k] ?? ''} onChange={e => set(k, e.target.value)} className="w-full text-sm rounded-lg px-2.5 py-2 mt-0.5 font-normal" style={inp}>{opts.map(o => Array.isArray(o) ? <option key={o[0]} value={o[0]}>{o[1]}</option> : <option key={o}>{o}</option>)}</select></label>
  )
  async function save() {
    setSaving(true)
    try {
      const body = owner ? f : { phone: f.phone, personal_phone: f.personal_phone, preferred_name: f.preferred_name, emergency_contact: f.emergency_contact, avatar_color: f.avatar_color, photo_url: f.photo_url, birthday: f.birthday }
      await j(member ? `/api/team/members/${member.id}` : '/api/team/members', { method: member ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      onSaved()
    } catch (e) { alert(e.message) } finally { setSaving(false) }
  }
  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,.5)' }} onClick={onClose}>
      <div className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3 flex items-center justify-between sticky top-0 bg-white" style={{ borderBottom: '1px solid #ebebeb' }}>
          <div className="font-bold" style={{ color: '#1a1a1a' }}>{member ? (owner ? `Edit ${member.name}` : 'Edit my card') : 'Add a person'}</div>
          <button onClick={onClose} className="text-2xl leading-none" style={{ color: '#888' }}>×</button>
        </div>
        <div className="p-5 grid grid-cols-2 gap-3">
          {owner && <I label="Full name" k="name" full />}
          <I label="Goes by" k="preferred_name" placeholder="e.g. Kat" />
          <I label="Birthday (MM-DD)" k="birthday" placeholder="07-04" />
          <I label="Work phone" k="phone" type="tel" />
          <I label="Personal phone" k="personal_phone" type="tel" />
          {owner && <I label="Email (login)" k="email" type="email" full />}
          {owner && <I label="Title" k="title" full />}
          {owner && <S label="Department" k="department" opts={Object.keys(DEPT_COLORS)} />}
          {owner && <S label="Reports to" k="reports_to" opts={[['', '—'], ...members.filter(m => m.user_id !== f.user_id).map(m => [m.user_id, m.name])]} />}
          {owner && <S label="Employment" k="employment" opts={[['w2', 'W-2 employee'], ['contractor', 'Contractor'], ['owner', 'Owner']]} />}
          {owner && <S label="Onboarding track" k="track" opts={[['tech', 'Technician'], ['apprentice', 'Apprentice technician'], ['ops', 'Billing & dispatch']]} />}
          {owner && <S label="App access" k="access" opts={[['owner', 'Owner (everything)'], ['dispatcher', 'Dispatch / office'], ['technician', 'Technician'], ['none', 'No login']]} />}
          {owner && <I label="Hire date" k="hire_date" type="date" />}
          {owner && <I label="Home base" k="region" placeholder="e.g. Everett" />}
          {owner && <I label="Van" k="van" placeholder="e.g. Van 2 · ProMaster" />}
          {owner && <I label="Driver's license expires" k="license_expiry" type="date" />}
          <div className="col-span-2 text-[11px] font-bold" style={{ color: '#888' }}>Emergency contact</div>
          <label className="text-[11px] font-bold" style={{ color: '#888' }}>Name<input value={f.emergency_contact?.name || ''} onChange={e => set('emergency_contact', { ...f.emergency_contact, name: e.target.value })} className="w-full text-sm rounded-lg px-2.5 py-2 mt-0.5 font-normal" style={inp} /></label>
          <label className="text-[11px] font-bold" style={{ color: '#888' }}>Phone<input value={f.emergency_contact?.phone || ''} onChange={e => set('emergency_contact', { ...f.emergency_contact, phone: e.target.value })} className="w-full text-sm rounded-lg px-2.5 py-2 mt-0.5 font-normal" style={inp} /></label>
          <label className="text-[11px] font-bold col-span-2" style={{ color: '#888' }}>Relationship<input value={f.emergency_contact?.relationship || ''} onChange={e => set('emergency_contact', { ...f.emergency_contact, relationship: e.target.value })} className="w-full text-sm rounded-lg px-2.5 py-2 mt-0.5 font-normal" style={inp} /></label>
          <div className="col-span-2 text-[11px] font-bold" style={{ color: '#888' }}>Card color</div>
          <div className="col-span-2 flex gap-2 flex-wrap">{['#CD4419', '#2563eb', '#16a34a', '#7c3aed', '#b45309', '#0e7490', '#db2777', '#0891b2'].map(c => <button key={c} onClick={() => set('avatar_color', c)} className="w-8 h-8 rounded-full" style={{ backgroundColor: c, border: f.avatar_color === c ? '3px solid #1a1a1a' : 'none' }} />)}</div>
          {owner && (
            <div className="col-span-2 rounded-xl p-3 grid grid-cols-2 gap-3" style={{ backgroundColor: '#fffbeb', border: '1px solid #fde68a' }}>
              <div className="col-span-2 text-[10px] uppercase tracking-wider font-semibold" style={{ color: '#92400e', fontFamily: 'IBM Plex Mono, monospace' }}>Owners only · pay</div>
              <S label="Payroll" k="payroll_type" opts={[['w2_zoho', 'W-2 (Zoho Payroll)'], ['contractor_wise', 'Contractor (Wise)'], ['contractor_other', 'Contractor (other)'], ['excluded', 'Not on payroll']]} />
              <I label="Hourly rate ($)" k="hourly_rate" type="number" />
              <I label="Salary ($/yr)" k="salary_annual" type="number" />
              <I label="Wise email" k="wise_email" type="email" />
              <label className="text-[11px] font-bold col-span-2" style={{ color: '#888' }}>Private notes<textarea value={f.notes || ''} onChange={e => set('notes', e.target.value)} rows={2} className="w-full text-sm rounded-lg px-2.5 py-2 mt-0.5 font-normal" style={inp} /></label>
              <label className="col-span-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={f.active !== false} onChange={e => set('active', e.target.checked)} /> Active (on the directory and org chart)</label>
            </div>
          )}
        </div>
        <div className="px-5 py-3 flex gap-2 sticky bottom-0 bg-white" style={{ borderTop: '1px solid #ebebeb' }}>
          <button onClick={onClose} className="flex-1 rounded-xl py-2.5 text-sm font-semibold" style={{ backgroundColor: '#f5f3f0', color: '#555' }}>Cancel</button>
          <button onClick={save} disabled={saving} className="flex-[2] rounded-xl py-2.5 text-sm font-bold text-white" style={{ backgroundColor: ORANGE, opacity: saving ? .6 : 1 }}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  )
}
