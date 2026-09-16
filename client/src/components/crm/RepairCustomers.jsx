// Repair customers in the CRM (Mark 2026-09-14: "build my repair customers
// in the CRM also but keep them separate"). People who bring their own
// car — not body shops. Own table (EstRetailCustomers), own tab, own
// Books customer type (individual). Everything the estimator learns about
// them (vehicles, last contact) shows up here.
import { useEffect, useMemo, useState } from 'react'
import { isOwnerUser, isMarkUser } from '../utils/identity.js'
import { API_BASE, apiFetch } from '../../utils/api.js'
import { Eyebrow, Title, Panel, Row, Notice, Chip, ORANGE, GREEN, BLUE } from '../ui/ReviewKit.jsx'
import { fmtCents } from '../../lib/estimatorCalc.js'
import TextAsMarkModal from '../TextAsMarkModal.jsx'

const inp = { border: '1px solid #e0dbd6', outline: 'none', backgroundColor: 'white', borderRadius: 8 }
const ST = { draft: '#666', sent: BLUE, approved: GREEN, invoiced: '#7c3aed', declined: '#b91c1c' }
const j = async (url, opts) => { const r = await apiFetch(`${API_BASE}${url}`, opts); const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`); return d }
const body = (method, b) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) })
const ago = iso => { if (!iso) return 'never'; const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000); return d <= 0 ? 'today' : d === 1 ? 'yesterday' : d < 30 ? `${d}d ago` : d < 365 ? `${Math.floor(d / 30)}mo ago` : `${Math.floor(d / 365)}y ago` }
const vName = v => [v.year, v.make, v.model].filter(Boolean).join(' ') || v.vin || 'vehicle'

function F({ label, value, onChange, placeholder, mono, span = 1, rows = 0, disabled }) {
  const [v, setV] = useState(value || '')
  useEffect(() => { setV(value || '') }, [value])
  const commit = () => v !== (value || '') && onChange(v)
  const st = { ...inp, fontFamily: mono ? 'IBM Plex Mono, monospace' : undefined }
  return <div style={{ gridColumn: `span ${span}` }}><Eyebrow>{label}</Eyebrow>{rows ? <textarea value={v} rows={rows} disabled={disabled} onChange={e => setV(e.target.value)} onBlur={commit} placeholder={placeholder} className="w-full px-2.5 py-1.5 text-sm" style={{ ...st, resize: 'vertical' }} /> : <input value={v} disabled={disabled} onChange={e => setV(e.target.value)} onBlur={commit} onKeyDown={e => e.key === 'Enter' && e.target.blur()} placeholder={placeholder} className="w-full px-2.5 py-1.5 text-sm" style={st} />}</div>
}

export default function RepairCustomers({ user, onNavigate, modeToggle }) {
  const [list, setList] = useState([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [selId, setSelId] = useState(null)
  const [adding, setAdding] = useState(false)
  const [err, setErr] = useState('')
  const isTech = user?.role === 'technician'
  const canEdit = !isTech

  const load = () => j('/api/estimator/retail-customers').then(d => setList(d.customers || [])).catch(e => setErr(e.message)).finally(() => setLoading(false))
  useEffect(() => { load() }, [])
  const needle = q.trim().toLowerCase()
  const shown = useMemo(() => needle ? list.filter(c => `${c.name} ${c.phone} ${c.email} ${c.vehicles.map(v => `${v.vin} ${vName(v)} ${v.plate}`).join(' ')}`.toLowerCase().includes(needle)) : list, [list, needle])
  const lifetime = list.reduce((s, c) => s + (c.won_cents || 0), 0)
  const openCents = list.reduce((s, c) => s + (c.open_cents || 0), 0)

  const openEstimate = id => { try { sessionStorage.setItem('adas_estimator_open', id) } catch {} ; onNavigate && onNavigate('estimator') }

  return (
    <div className="max-w-[1500px] mx-auto px-3 sm:px-5 py-4">
      <div className="flex items-end justify-between gap-3 flex-wrap mb-3">
        <div>
          <Eyebrow>CRM · repair customers · kept separate from body shops</Eyebrow>
          <div className="flex items-center gap-3 flex-wrap">
            <Title sub={`${list.length} ${list.length === 1 ? 'person' : 'people'} · open ${fmtCents(openCents)} · lifetime approved ${fmtCents(lifetime)}`}>Repair customers</Title>
            {modeToggle}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search name, phone, VIN, plate, vehicle" className="px-3 py-2 text-sm w-64 max-w-full" style={inp} />
          {canEdit && <button onClick={() => setAdding(true)} className="rounded-xl px-4 py-2 text-sm font-bold text-white" style={{ backgroundColor: ORANGE }}>＋ New customer</button>}
          {canEdit && <button onClick={async () => { const name = prompt('Zoho Books customer name to bring over (with all invoices):'); if (!name) return; setErr(''); try { let r = await j('/api/estimator/retail-customers/import-books', body('POST', { name })); let n = r.imported.length; while (r.remaining > 0) { r = await j('/api/estimator/retail-customers/import-books', body('POST', { contact_id: r.books.contact_id })); n += r.imported.length } await load(); setSelId(r.customer.id); alert(`${r.books.name}: ${n} invoice${n === 1 ? '' : 's'} imported as service history`) } catch (e) { setErr(e.message + (e.candidates ? '' : '')) } }} className="rounded-xl px-3 py-2 text-sm font-bold" style={{ backgroundColor: 'white', color: BLUE, border: '1.5px solid #bfdbfe' }}>⬇ From Zoho Books</button>}
        </div>
      </div>
      {err && <Notice tone="red" className="mb-3">{err} <button className="underline ml-2" onClick={() => setErr('')}>dismiss</button></Notice>}

      {loading ? <div className="text-sm" style={{ color: '#888' }}>Loading…</div> : shown.length === 0 ? (
        <div className="rounded-xl p-8 text-center text-sm" style={{ backgroundColor: 'white', border: '1.5px dashed #e0dbd6', color: '#888' }}>{needle ? 'No one matches.' : 'No repair customers yet. Add one here, or they appear automatically when you make an estimate for a person in the Estimator.'}</div>
      ) : (
        <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(270px, 1fr))' }}>
          {shown.map(c => (
            <button key={c.id} onClick={() => setSelId(c.id)} className="text-left rounded-xl p-3" style={{ backgroundColor: 'white', border: `1.5px solid ${selId === c.id ? ORANGE : '#e8e4e0'}`, boxShadow: '0 1px 2px rgba(0,0,0,.04)' }}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-bold text-sm truncate" style={{ color: '#1a1a1a' }}>🙂 {c.name}</div>
                  <div className="text-xs truncate" style={{ color: '#666' }}>{[c.phone, c.email].filter(Boolean).join(' · ') || 'no contact info'}</div>
                </div>
                {c.zoho_contact_id ? <Chip tone="green">Books ✓</Chip> : null}
              </div>
              <div className="flex gap-1 flex-wrap mt-2">
                {c.vehicles.slice(0, 3).map((v, i) => <Chip key={i} tone="blue">🚗 {vName(v)}</Chip>)}
                {c.vehicles.length > 3 && <Chip>+{c.vehicles.length - 3}</Chip>}
                {c.vehicles.length === 0 && <span className="text-[11px]" style={{ color: '#bbb' }}>no vehicle on file</span>}
              </div>
              <div className="flex items-center justify-between mt-2 text-[11px]" style={{ color: '#888' }}>
                <span>{c.estimates_count ? `${c.estimates_count} estimate${c.estimates_count === 1 ? '' : 's'} · last ${ago(c.last_estimate_at)}` : 'no estimates yet'}</span>
                <span className="font-bold tabular-nums" style={{ color: c.won_cents ? GREEN : '#bbb' }}>{fmtCents(c.won_cents)}</span>
              </div>
            </button>
          ))}
        </div>
      )}

      {selId && <CustomerPanel id={selId} user={user} canEdit={canEdit} onClose={() => { setSelId(null); load() }} onOpenEstimate={openEstimate} onDeleted={() => { setSelId(null); load() }} />}
      {adding && <NewCustomer onClose={() => setAdding(false)} onCreated={c => { setAdding(false); load(); setSelId(c.id) }} />}
    </div>
  )
}

function NewCustomer({ onClose, onCreated }) {
  const [f, setF] = useState({ name: '', phone: '', email: '', address: '', city: '', zip: '', source: '' })
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  const set = k => e => setF(p => ({ ...p, [k]: e.target.value }))
  async function save() { setBusy(true); setErr(''); try { const d = await j('/api/estimator/retail-customers', body('POST', f)); onCreated(d.customer) } catch (e) { setErr(e.message); setBusy(false) } }
  return (
    <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,.55)' }} onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl overflow-hidden">
        <div className="px-5 py-3" style={{ backgroundColor: '#f0fdf4', borderBottom: '1px solid #bbf7d0' }}><Eyebrow>🙂 New repair customer</Eyebrow><div className="font-bold" style={{ color: '#1a1a1a' }}>A person, not a body shop</div></div>
        <div className="px-5 py-4 grid grid-cols-2 gap-2">
          {err && <div className="col-span-2 text-sm px-3 py-2 rounded-lg" style={{ backgroundColor: '#fef2f2', color: '#b91c1c' }}>{err}</div>}
          {[['name', 'Name', 2], ['phone', 'Phone', 1], ['email', 'Email', 1], ['address', 'Address', 2], ['city', 'City', 1], ['zip', 'Zip', 1], ['source', 'How they found us', 2]].map(([k, l, sp]) => (
            <div key={k} style={{ gridColumn: `span ${sp}` }}><Eyebrow>{l}</Eyebrow><input autoFocus={k === 'name'} value={f[k]} onChange={set(k)} className="w-full px-2.5 py-1.5 text-sm" style={inp} onKeyDown={e => e.key === 'Enter' && f.name.trim() && save()} /></div>
          ))}
        </div>
        <div className="px-5 py-3 flex gap-2" style={{ borderTop: '1px solid #ebebeb' }}>
          <button onClick={onClose} className="flex-1 rounded-xl py-3 text-sm font-semibold" style={{ backgroundColor: '#f5f3f0', color: '#555' }}>Cancel</button>
          <button onClick={save} disabled={busy || !f.name.trim()} className="flex-[2] rounded-xl py-3 text-base font-bold text-white" style={{ backgroundColor: GREEN, opacity: busy || !f.name.trim() ? .45 : 1 }}>{busy ? 'Saving…' : 'Save customer'}</button>
        </div>
      </div>
    </div>
  )
}

function CustomerPanel({ id, user, canEdit, onClose, onOpenEstimate, onDeleted }) {
  const [c, setC] = useState(null)
  const [hist, setHist] = useState(null)
  const [openVeh, setOpenVeh] = useState({})
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState('')
  const [vin, setVin] = useState('')
  const [manual, setManual] = useState(null)
  const [textTo, setTextTo] = useState(null)
  const isMark = isMarkUser(user) // 💬 as Mark = his personal cell
  const load = () => Promise.all([j(`/api/estimator/retail-customers/${id}`).then(d => setC(d.customer)), j(`/api/estimator/retail-customers/${id}/history`).then(setHist).catch(() => setHist({ vehicles: [] }))]).catch(e => setErr(e.message))
  useEffect(() => { load() }, [id])
  const patch = async f => { setC(x => ({ ...x, ...f })); try { const d = await j(`/api/estimator/retail-customers/${id}`, body('PUT', f)); setC(x => ({ ...x, ...d.customer })) } catch (e) { setErr(e.message) } }

  async function addVin() {
    setBusy('vin'); setErr('')
    try {
      const r = await apiFetch(`${API_BASE}/api/estimator/vin/${encodeURIComponent(vin)}`); const d = await r.json()
      if (!d.ok) throw new Error(d.reason || 'Could not decode')
      await patch({ vehicles: [{ vin: d.vin, year: d.year, make: d.make, model: d.model, trim: d.trim, plate: '' }, ...(c.vehicles || []).filter(v => v.vin !== d.vin)] }); setVin('')
    } catch (e) { setErr(e.message) } finally { setBusy('') }
  }
  async function addManual() { if (!manual?.make) return; await patch({ vehicles: [{ vin: '', year: manual.year || '', make: manual.make, model: manual.model || '', trim: '', plate: manual.plate || '' }, ...(c.vehicles || [])] }); setManual(null) }
  async function books() { setBusy('books'); setErr(''); try { const d = await j(`/api/estimator/retail-customers/${id}/books-customer`, body('POST', {})); setC(x => ({ ...x, zoho_contact_id: d.contact_id })) } catch (e) { setErr(e.message) } finally { setBusy('') } }
  async function newEstimate(v) {
    setBusy('est'); setErr('')
    try {
      const veh = v || ((c.vehicles || []).length === 1 ? c.vehicles[0] : null)
      const d = await j('/api/estimator', body('POST', { customer_kind: 'retail', customer_id: c.id, customer_name: c.name, zoho_contact_id: c.zoho_contact_id, customer_contact: { phone: c.phone, email: c.email, address: c.address, city: c.city, zip: c.zip }, service_address: c.address, service_city: c.city, service_zip: c.zip, ...(veh ? { vin: veh.vin, year: veh.year, make: veh.make, model: veh.model, trim: veh.trim, plate: veh.plate } : {}) }))
      onOpenEstimate(d.estimate.id)
    } catch (e) { setErr(e.message); setBusy('') }
  }
  async function del() { if (!confirm(`Delete ${c.name}? This does not touch Zoho Books.`)) return; try { await j(`/api/estimator/retail-customers/${id}`, { method: 'DELETE' }); onDeleted() } catch (e) { setErr(e.message) } }

  return (
    <div className="fixed inset-0 z-[70] flex justify-end" style={{ backgroundColor: 'rgba(0,0,0,.35)' }} onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="h-full w-full sm:max-w-[520px] overflow-y-auto" style={{ backgroundColor: '#f5f3f0', boxShadow: '-8px 0 24px rgba(0,0,0,.15)' }}>
        {!c ? <div className="p-5 text-sm" style={{ color: '#888' }}>{err || 'Loading…'}</div> : (<>
          <div className="sticky top-0 z-10 px-4 py-3 flex items-start justify-between gap-2" style={{ backgroundColor: 'rgba(245,243,240,.96)', backdropFilter: 'blur(6px)', borderBottom: '1px solid #e8e4e0' }}>
            <div className="min-w-0">
              <Eyebrow>🙂 Repair customer · since {String(c.created_at).slice(0, 10)} · last contact {ago(c.last_contact)}</Eyebrow>
              <div className="font-bold text-lg truncate" style={{ color: '#1a1a1a' }}>{c.name}</div>
              <div className="flex gap-1 flex-wrap mt-1">{c.zoho_contact_id ? <Chip tone="green">Books ✓</Chip> : <Chip>not in Books</Chip>}{c.source && <Chip>{c.source}</Chip>}{(c.tags || []).map(t => <Chip key={t} tone="orange">{t}</Chip>)}</div>
            </div>
            <button onClick={onClose} className="text-2xl leading-none" style={{ color: '#888' }}>×</button>
          </div>
          <div className="p-4 space-y-3">
            {err && <Notice tone="red">{err} <button className="underline ml-2" onClick={() => setErr('')}>dismiss</button></Notice>}
            {canEdit && (
              <div className="flex gap-2 flex-wrap">
                <button onClick={() => newEstimate()} disabled={busy === 'est'} className="flex-1 rounded-xl py-2.5 text-sm font-bold text-white" style={{ backgroundColor: ORANGE }}>{busy === 'est' ? 'Creating…' : '📝 New estimate'}</button>
                {c.zoho_contact_id && <button onClick={async () => { setBusy('imp'); setErr(''); try { let r = await j('/api/estimator/retail-customers/import-books', body('POST', { contact_id: c.zoho_contact_id })); let n = r.imported.length; while (r.remaining > 0) { r = await j('/api/estimator/retail-customers/import-books', body('POST', { contact_id: c.zoho_contact_id })); n += r.imported.length } await load(); alert(n ? `${n} new invoice${n === 1 ? '' : 's'} imported` : 'Already up to date with Books') } catch (e) { setErr(e.message) } finally { setBusy('') } }} disabled={busy === 'imp'} className="rounded-xl px-3 py-2.5 text-sm font-bold" style={{ backgroundColor: 'white', color: BLUE, border: `1.5px solid #bfdbfe` }}>{busy === 'imp' ? '…' : '⬇ Pull Books history'}</button>}
                {!c.zoho_contact_id && <button onClick={books} disabled={busy === 'books'} className="rounded-xl px-3 py-2.5 text-sm font-bold" style={{ backgroundColor: 'white', color: BLUE, border: `1.5px solid #bfdbfe` }}>{busy === 'books' ? '…' : '🧾 Create in Books'}</button>}
                {isMark && c.phone && <button onClick={() => setTextTo({ phone: c.phone, name: c.name })} className="rounded-xl px-3 py-2.5 text-sm font-bold" style={{ backgroundColor: 'white', color: '#555', border: '1.5px solid #e0dbd6' }}>💬 as Mark</button>}
              </div>
            )}
            <Panel tone="blue" title="Person">
              <div className="p-3 grid grid-cols-2 gap-2">
                <F label="Name" value={c.name} onChange={v => patch({ name: v })} span={2} disabled={!canEdit} />
                <F label="Phone" value={c.phone} onChange={v => patch({ phone: v })} mono disabled={!canEdit} />
                <F label="Email" value={c.email} onChange={v => patch({ email: v })} disabled={!canEdit} />
                <F label="Address" value={c.address} onChange={v => patch({ address: v })} span={2} disabled={!canEdit} />
                <F label="City" value={c.city} onChange={v => patch({ city: v })} disabled={!canEdit} />
                <F label="Zip" value={c.zip} onChange={v => patch({ zip: v })} mono disabled={!canEdit} />
                <F label="How they found us" value={c.source} onChange={v => patch({ source: v })} disabled={!canEdit} />
                <F label="Tags (comma separated)" value={(c.tags || []).join(', ')} onChange={v => patch({ tags: v.split(',').map(t => t.trim()).filter(Boolean) })} disabled={!canEdit} />
              </div>
            </Panel>
            <Panel tone="plain" title={`🚗 Vehicles · ${(c.vehicles || []).length}`} right="learned from estimates">
              {(c.vehicles || []).map((v, i) => (
                <Row key={i} left={<div><div className="font-semibold">{vName(v)}{v.trim ? ` ${v.trim}` : ''}</div><div className="text-[11px]" style={{ color: '#888', fontFamily: 'IBM Plex Mono, monospace' }}>{v.vin || 'no VIN'}{v.plate ? ` · ${v.plate}` : ''}</div><div className="text-[11px]" style={{ color: '#666' }}>{v.last_mileage != null ? `${Number(v.last_mileage).toLocaleString()} mi` : 'no odometer yet'}{v.last_service ? ` · last service ${v.last_service}` : ''}{(() => { const hv = (hist?.vehicles || []).find(x => (v.vin && x.vin === v.vin) || (!v.vin && x.make?.toLowerCase() === (v.make || '').toLowerCase() && x.model?.toLowerCase() === (v.model || '').toLowerCase() && String(x.year) === String(v.year))); return hv?.under_warranty ? <span className="ml-1 font-bold" style={{ color: GREEN }}>· 🛡 {hv.under_warranty} job{hv.under_warranty === 1 ? '' : 's'} under warranty</span> : null })()}</div></div>}
                  right={canEdit ? <div className="flex gap-1"><button onClick={() => newEstimate(v)} className="text-[11px] font-bold px-2 py-1 rounded-lg text-white" style={{ backgroundColor: ORANGE }}>Estimate</button><button onClick={() => patch({ vehicles: c.vehicles.filter((_, k) => k !== i) })} className="text-xs px-1" style={{ color: '#bbb' }}>✕</button></div> : null} />
              ))}
              {canEdit && (
                <div className="p-3 space-y-2" style={{ borderTop: '1px solid #f1f5f9' }}>
                  <div className="flex gap-1.5"><input value={vin} onChange={e => setVin(e.target.value.toUpperCase())} placeholder="Add by VIN (17 chars) · decodes via NHTSA" className="flex-1 px-2.5 py-1.5 text-sm" style={{ ...inp, fontFamily: 'IBM Plex Mono, monospace' }} onKeyDown={e => e.key === 'Enter' && vin.length === 17 && addVin()} /><button onClick={addVin} disabled={vin.length !== 17 || busy === 'vin'} className="rounded-lg px-3 text-xs font-bold text-white" style={{ backgroundColor: ORANGE, opacity: vin.length !== 17 ? .45 : 1 }}>{busy === 'vin' ? '…' : '🔎 Add'}</button></div>
                  {manual ? <div className="grid grid-cols-4 gap-1.5">{[['year', 'Year'], ['make', 'Make'], ['model', 'Model'], ['plate', 'Plate']].map(([k, l]) => <input key={k} value={manual[k] || ''} onChange={e => setManual(m => ({ ...m, [k]: e.target.value }))} placeholder={l} className="px-2 py-1.5 text-sm" style={inp} />)}<button onClick={addManual} className="col-span-4 rounded-lg py-1.5 text-xs font-bold text-white" style={{ backgroundColor: BLUE }}>Add vehicle</button></div>
                    : <button onClick={() => setManual({})} className="text-xs font-bold" style={{ color: BLUE }}>＋ add without a VIN</button>}
                </div>
              )}
            </Panel>
            {c.zoho_contact_id && <BooksAccount contactId={c.zoho_contact_id} onOpenEstimate={onOpenEstimate} />}
            <Panel tone="orange" title={`🔧 Service history · ${(hist?.vehicles || []).reduce((s, v) => s + v.visits, 0)} visit${(hist?.vehicles || []).reduce((s, v) => s + v.visits, 0) === 1 ? '' : 's'}`} right={hist?.warranty ? `guaranteed ${hist.warranty.months} mo / ${Number(hist.warranty.miles).toLocaleString()} mi` : ''}>
              {!hist && <div className="px-3 py-3 text-xs" style={{ color: '#999' }}>Loading…</div>}
              {hist && !hist.vehicles.length && <div className="px-3 py-3 text-xs italic" style={{ color: '#999' }}>No work recorded yet. Approved and invoiced estimates show up here per car, with the odometer at each visit.</div>}
              {(hist?.vehicles || []).map(v => (
                <div key={v.key} style={{ borderTop: '1px solid #f1f5f9' }}>
                  <button onClick={() => setOpenVeh(o => ({ ...o, [v.key]: !o[v.key] }))} className="w-full text-left px-3 py-2 flex items-center justify-between gap-2">
                    <span><span className="font-semibold text-sm" style={{ color: '#1a1a1a' }}>🚗 {[v.year, v.make, v.model].filter(Boolean).join(' ')}</span><span className="text-[11px] ml-2" style={{ color: '#888' }}>{v.visits} visit{v.visits === 1 ? '' : 's'}{v.last_mileage != null ? ` · ${v.last_mileage.toLocaleString()} mi` : ''}{v.last_service ? ` · last ${v.last_service}` : ''}</span></span>
                    <span className="text-xs font-bold tabular-nums" style={{ color: GREEN }}>{fmtCents(v.lifetime_cents)} {openVeh[v.key] ? '▾' : '▸'}</span>
                  </button>
                  {openVeh[v.key] && v.entries.map(en => (
                    <div key={en.estimate_id} className="px-3 pb-2">
                      <button onClick={() => onOpenEstimate(en.estimate_id)} className="w-full text-left rounded-lg p-2" style={{ backgroundColor: '#fffdfb', border: '1px solid #f1ede9' }}>
                        <div className="flex items-center justify-between gap-2 text-xs"><span><b>{en.date || '—'}</b> · <span style={{ fontFamily: 'IBM Plex Mono, monospace' }}>{en.number}</span>{en.invoice_number ? ` · inv ${en.invoice_number}` : ''} · <span style={{ color: en.status === 'invoiced' ? '#7c3aed' : en.status === 'approved' ? GREEN : '#888' }}>{en.status}</span>{en.mileage != null ? ` · ${en.mileage.toLocaleString()} mi` : ' · no odometer'}</span><span className="font-bold tabular-nums">{fmtCents(en.total_cents)}</span></div>
                        {en.jobs.map(jb => (
                          <div key={jb.id} className="mt-1 text-xs" style={{ color: jb.status === 'approved' ? '#1a1a1a' : '#999' }}>
                            <div className="flex items-center justify-between gap-2"><span>{jb.status === 'approved' ? '✓' : '·'} {jb.invoice_description || jb.name}{jb.lines.some(l => l.parts.length) ? <span style={{ color: '#888' }}> · parts: {jb.lines.flatMap(l => l.parts).map(p => `${p.pn ? p.pn + ' ' : ''}${p.desc}`).join(', ')}</span> : null}</span><span className="tabular-nums">{fmtCents(jb.total_cents)}</span></div>
                            {jb.warranty && <div className="text-[10px] font-bold" style={{ color: jb.warranty.active ? GREEN : '#999' }}>🛡 {jb.warranty.active ? `Under warranty until ${jb.warranty.until_date}${jb.warranty.until_miles != null ? ` or ${jb.warranty.until_miles.toLocaleString()} mi` : ''}${jb.warranty.miles_left != null ? ` (${jb.warranty.miles_left.toLocaleString()} mi left)` : ''}` : `Warranty expired (${jb.warranty.expired_by === 'miles' ? 'mileage' : 'time'}) · was until ${jb.warranty.until_date}${jb.warranty.until_miles != null ? ` / ${jb.warranty.until_miles.toLocaleString()} mi` : ''}`}</div>}
                          </div>
                        ))}
                      </button>
                    </div>
                  ))}
                </div>
              ))}
            </Panel>
            <Panel tone="green" title={`📝 Estimates · ${c.estimates_count || 0}`} right={c.won_cents ? `approved ${fmtCents(c.won_cents)}` : ''}>
              {(c.estimates || []).map(e => (
                <Row key={e.id} onClick={() => onOpenEstimate(e.id)} left={<div><span className="text-[11px] font-bold px-1.5 py-0.5 rounded mr-2" style={{ backgroundColor: '#f2f2f2', color: '#555', fontFamily: 'IBM Plex Mono, monospace' }}>{e.number}</span><span className="text-xs font-bold" style={{ color: ST[e.status] || '#666' }}>{e.status}</span><div className="text-xs" style={{ color: '#666' }}>{e.vehicle || 'no vehicle'} · {String(e.created_at).slice(0, 10)}</div></div>} right={fmtCents(e.grand_total_cents)} />
              ))}
              {!(c.estimates || []).length && <div className="px-3 py-3 text-xs italic" style={{ color: '#999' }}>No estimates yet.</div>}
            </Panel>
            <Panel tone="plain" title="Notes"><div className="p-3"><F label="" value={c.notes} onChange={v => patch({ notes: v })} rows={4} placeholder="Anything worth remembering about this person or their car." disabled={!canEdit} /></div></Panel>
            {canEdit && <div className="text-right"><button onClick={del} className="text-xs font-semibold px-2 py-1 rounded-lg" style={{ color: '#b91c1c', backgroundColor: '#fef2f2' }}>Delete customer</button></div>}
          </div>
        </>)}
      </div>
      {textTo && <TextAsMarkModal to={textTo.phone} toName={textTo.name} purpose="repair customer" onClose={() => setTextTo(null)} />}
    </div>
  )
}


// Books account: balance, invoices with what's still owed, and every payment — from the AR mirror.
function BooksAccount({ contactId, onOpenEstimate }) {
  const [d, setD] = useState(null); const [err, setErr] = useState('')
  useEffect(() => { j(`/api/ar/accounts/${contactId}`).then(setD).catch(e => setErr(e.message)) }, [contactId])
  if (err) return <Notice tone="amber">Books account not in the mirror yet ({err}). It appears after the nightly pull, or tap "Pull accounts" in Books → Accounts.</Notice>
  if (!d) return null
  const a = d.account; const open = d.invoices.filter(i => i.balance_cents > 0)
  return (
    <Panel tone="blue" title="🏦 Zoho Books account" right={a.books_outstanding_cents > 0 ? <span style={{ color: '#b91c1c' }}>owes {fmtCents(a.books_outstanding_cents)}</span> : 'paid up'}>
      <div className="px-3 py-2 text-xs" style={{ color: '#555' }}>{d.invoices.length} invoice{d.invoices.length === 1 ? '' : 's'} · {d.payments.length} payment{d.payments.length === 1 ? '' : 's'}{a.last_payment ? ` · last paid ${a.last_payment}` : ''}{a.unused_credits_cents > 0 ? ` · unused credit ${fmtCents(a.unused_credits_cents)}` : ''}</div>
      {open.map(i => <Row key={i.invoice_id} left={<span className="text-xs"><b>{i.number}</b> · {i.date} · {i.status}</span>} right={<span className="text-xs font-bold" style={{ color: '#b91c1c' }}>due {fmtCents(i.balance_cents)}</span>} />)}
      {d.payments.slice(0, 8).map(p => <Row key={p.payment_id} left={<span className="text-xs">💳 {p.date} · {p.mode}{p.invoices ? ` · ${p.invoices}` : ''}</span>} right={<span className="text-xs">{fmtCents(p.amount_cents)}</span>} />)}
      {d.payments.length > 8 && <div className="px-3 pb-2 text-[11px]" style={{ color: '#888' }}>+{d.payments.length - 8} more payments in Books → Accounts</div>}
    </Panel>
  )
}
