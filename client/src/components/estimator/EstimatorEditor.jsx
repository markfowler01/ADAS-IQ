// The estimator page (2026-09-14). Review-kit look, front to back: left =
// customer · vehicle (VIN decode) · job info · pricing · totals; right =
// jobs (collapsible cards, drag to reorder, templates, Books calibration
// items). Live totals come from the shared engine on every keystroke;
// the server recomputes on save and owns the stored numbers.
import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { API_BASE, apiFetch } from '../../utils/api.js'
import { Eyebrow, Title, Panel, Row, TotalRow, Notice, Pill, Switch, Chip, Footer, PrimaryButton, SecondaryButton, ORANGE, GREEN, BLUE } from '../ui/ReviewKit.jsx'
import { computeEstimate, readyToSend, fmtCents, fromCents, toCents } from '../../lib/estimatorCalc.js'
import JobCard, { Money, MarkupBox, STATUS_STYLE } from './JobCard.jsx'
import AuthorizeModal from './AuthorizeModal.jsx'

const inp = { border: '1px solid #e0dbd6', outline: 'none', backgroundColor: 'white', borderRadius: 8 }
const EST_STATUS = {
  draft:    { label: 'Draft', fg: '#666', bg: '#f5f3f0' },
  sent:     { label: 'Sent', fg: BLUE, bg: '#eff6ff' },
  approved: { label: 'Approved', fg: GREEN, bg: '#dcfce7' },
  invoiced: { label: 'Invoiced', fg: '#7c3aed', bg: '#f3e8ff' },
  declined: { label: 'Declined', fg: '#b91c1c', bg: '#fee2e2' },
}
const j = async (url, opts) => { const r = await apiFetch(`${API_BASE}${url}`, opts); const d = await r.json().catch(() => ({})); if (!r.ok) { const e = new Error(d.error || `HTTP ${r.status}`); e.data = d; throw e } return d }
const post = (url, body) => j(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) })
const put = (url, body) => j(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) })

/** Text field bound to an estimate key; commits on blur / Enter. */
function F({ label, value, onChange, placeholder, mono = false, disabled, type = 'text', span = 1, rows = 0 }) {
  const [v, setV] = useState(value || '')
  useEffect(() => { setV(value || '') }, [value])
  const commit = () => v !== (value || '') && onChange(v)
  const cls = 'w-full px-2.5 py-1.5 text-sm'
  const st = { ...inp, fontFamily: mono ? 'IBM Plex Mono, monospace' : undefined }
  return (
    <div style={{ gridColumn: `span ${span}` }}>
      <Eyebrow>{label}</Eyebrow>
      {rows ? <textarea value={v} disabled={disabled} rows={rows} onChange={e => setV(e.target.value)} onBlur={commit} placeholder={placeholder} className={cls} style={{ ...st, resize: 'vertical' }} />
        : <input type={type} value={v} disabled={disabled} onChange={e => setV(e.target.value)} onBlur={commit} onKeyDown={e => e.key === 'Enter' && e.target.blur()} placeholder={placeholder} className={cls} style={st} />}
    </div>
  )
}

export default function EstimatorEditor({ id, user, onBack }) {
  const [est, setEst] = useState(null)
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)
  const [catalog, setCatalog] = useState([])
  const [templates, setTemplates] = useState([])
  const [common, setCommon] = useState([])
  const [shops, setShops] = useState([])
  const [retail, setRetail] = useState([])
  const [custQ, setCustQ] = useState('')
  const [newPerson, setNewPerson] = useState(null)
  const [authJob, setAuthJob] = useState(null)
  const [declineJob, setDeclineJob] = useState(null)
  const [tplOpen, setTplOpen] = useState(false)
  const [vinBusy, setVinBusy] = useState(false)
  const [vinInfo, setVinInfo] = useState(null)
  const [dragId, setDragId] = useState(null)
  const [armed, setArmed] = useState(null)
  const [toast, setToast] = useState('')
  const pendingEst = useRef({})
  const pendingJobs = useRef({})
  const timer = useRef(null)
  const isTech = user?.role === 'technician'
  const canEdit = !!est && !isTech && est.status !== 'invoiced'

  const load = useCallback(async () => {
    try { const d = await j(`/api/estimator/${id}`); setEst(d.estimate); setErr('') } catch (e) { setErr(e.message) }
  }, [id])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    j('/api/estimator/catalog').then(d => setCatalog(d.items || [])).catch(() => {})
    j('/api/estimator/templates').then(d => setTemplates(d.templates || [])).catch(() => {})
    j('/api/estimator/common-jobs').then(d => setCommon(d.common || [])).catch(() => {})
    j('/api/estimator/shops').then(d => setShops(d.shops || [])).catch(() => {})
    j('/api/estimator/retail-customers').then(d => setRetail(d.customers || [])).catch(() => {})
  }, [])
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 2200); return () => clearTimeout(t) }, [toast])
  useEffect(() => { const up = () => setArmed(null); window.addEventListener('mouseup', up); return () => window.removeEventListener('mouseup', up) }, [])

  // ── Autosave (debounced; header + per-job) ──────────────────────────────
  const mergeServer = d => setEst(cur => cur ? { ...cur, totals: d.estimate.totals, flags: d.estimate.flags, ready: d.estimate.ready, status: d.estimate.status, number: d.estimate.number } : cur)
  const flush = useCallback(async () => {
    const eFields = pendingEst.current; pendingEst.current = {}
    const jobsMap = pendingJobs.current; pendingJobs.current = {}
    if (!Object.keys(eFields).length && !Object.keys(jobsMap).length) return
    setSaving(true)
    try {
      if (Object.keys(eFields).length) mergeServer(await put(`/api/estimator/${id}`, eFields))
      for (const [jid, fields] of Object.entries(jobsMap)) mergeServer(await put(`/api/estimator/${id}/jobs/${jid}`, fields))
    } catch (e) { setErr(e.message) } finally { setSaving(false) }
  }, [id])
  const schedule = useCallback(() => { clearTimeout(timer.current); timer.current = setTimeout(flush, 900) }, [flush])
  useEffect(() => () => { clearTimeout(timer.current); flush() }, [flush])
  const patchEst = f => { setEst(c => ({ ...c, ...f })); Object.assign(pendingEst.current, f); schedule() }
  const patchJob = (jid, f) => { setEst(c => ({ ...c, jobs: c.jobs.map(x => x.id === jid ? { ...x, ...f } : x) })); pendingJobs.current[jid] = { ...(pendingJobs.current[jid] || {}), ...f }; schedule() }
  const structural = async fn => { clearTimeout(timer.current); await flush(); setSaving(true); try { const d = await fn(); if (d?.estimate) setEst(d.estimate); return d } catch (e) { setErr(e.message); throw e } finally { setSaving(false) } }

  // ── Live numbers ────────────────────────────────────────────────────────
  const live = useMemo(() => est ? computeEstimate({ ...est, jobs: est.jobs || [] }, est.settings) : null, [est])
  const ready = useMemo(() => est ? readyToSend({ ...est, jobs: est.jobs || [] }) : { ok: false, missing: [] }, [est])
  const t = live?.totals

  if (err && !est) return <div className="p-6"><Notice tone="red">{err}</Notice><button onClick={onBack} className="mt-3 text-sm font-bold" style={{ color: ORANGE }}>← Back</button></div>
  if (!est || !t) return <div className="p-6 text-sm" style={{ color: '#888' }}>Loading estimate…</div>

  // ── Handlers ────────────────────────────────────────────────────────────
  const setJobStatus = async (job, status) => {
    if (status === 'approved') return setAuthJob(job)
    if (status === 'declined') return setDeclineJob(job)
    await structural(() => put(`/api/estimator/${id}/jobs/${job.id}`, { status }))
  }
  const confirmAuth = async auth => { await structural(() => put(`/api/estimator/${id}/jobs/${authJob.id}`, { status: 'approved', ...auth })); setAuthJob(null); setToast('✅ Job approved and authorization recorded') }
  const confirmDecline = async reason => { await structural(() => put(`/api/estimator/${id}/jobs/${declineJob.id}`, { status: 'declined', decline_reason: reason })); setDeclineJob(null) }
  const addJob = body => structural(() => post(`/api/estimator/${id}/jobs`, body)).then(() => setTplOpen(false))
  const dupJob = jid => structural(() => post(`/api/estimator/${id}/jobs/${jid}/duplicate`))
  const delJob = async jid => { if (!confirm('Delete this job?')) return; await structural(() => j(`/api/estimator/${id}/jobs/${jid}`, { method: 'DELETE' })) }
  const saveTpl = async jid => { const name = prompt('Template name'); if (!name) return; try { const d = await post(`/api/estimator/${id}/jobs/${jid}/save-template`, { name }); setTemplates(x => [d.template, ...x]); setToast('Saved as template') } catch (e) { setErr(e.message) } }
  const setStatus = async (status, force = false) => { try { await structural(() => post(`/api/estimator/${id}/status`, { status, force })); setToast(`Marked ${status}`) } catch (e) { /* err shown */ } }
  const drop = async targetId => {
    if (!dragId || dragId === targetId) return
    const ids = est.jobs.map(x => x.id); const from = ids.indexOf(dragId), to = ids.indexOf(targetId)
    ids.splice(to, 0, ids.splice(from, 1)[0])
    setEst(c => ({ ...c, jobs: ids.map(i => c.jobs.find(x => x.id === i)) })); setDragId(null)
    await structural(() => post(`/api/estimator/${id}/reorder`, { order: ids }))
  }
  const decode = async () => {
    setVinBusy(true); setVinInfo(null)
    try {
      const d = await j(`/api/estimator/vin/${encodeURIComponent(est.vin)}`)
      setVinInfo(d)
      const f = {}
      if (d.year && !est.year) f.year = d.year; if (d.make && !est.make) f.make = d.make; if (d.model && !est.model) f.model = d.model; if (d.trim && !est.trim) f.trim = d.trim
      if (d.year && est.year && d.year !== est.year) f.year = d.year
      if (d.make && est.make && d.make.toLowerCase() !== est.make.toLowerCase()) f.make = d.make
      if (d.model && est.model && d.model.toLowerCase() !== est.model.toLowerCase()) f.model = d.model
      if (Object.keys(f).length) patchEst(f)
    } catch (e) { setVinInfo({ ok: false, reason: e.data?.reason || e.message }) } finally { setVinBusy(false) }
  }
  const pickShop = s => { patchEst({ customer_kind: 'shop', customer_id: s.id, customer_name: s.name, zoho_contact_id: s.zoho_contact_id, customer_type: 'wholesale', tax_enabled: false, customer_contact: { name: s.contact_name, phone: s.phone, email: s.email, address: s.address }, service_address: est.service_address || s.address, ...(s.discount_pct > 0 && est.discount_type === 'none' ? { discount_type: 'pct', discount_value: Math.round(s.discount_pct * 100) } : {}) }); setCustQ('') }
  const pickRetail = c => { patchEst({ customer_kind: 'retail', customer_id: c.id, customer_name: c.name, zoho_contact_id: c.zoho_contact_id || '', customer_type: 'retail', tax_enabled: true, supplies_enabled: true, customer_contact: { phone: c.phone, email: c.email, address: c.address, city: c.city, zip: c.zip }, service_zip: est.service_zip || c.zip, service_city: est.service_city || c.city, service_address: est.service_address || c.address }); setCustQ(''); setNewPerson(null) }
  const createPerson = async () => { try { const d = await post('/api/estimator/retail-customers', newPerson); setRetail(x => [d.customer, ...x]); pickRetail(d.customer) } catch (e) { setErr(e.message) } }

  const q = custQ.trim().toLowerCase()
  const shopHits = q ? shops.filter(s => s.name.toLowerCase().includes(q)).slice(0, 8) : []
  const retailHits = q ? retail.filter(c => `${c.name} ${c.phone}`.toLowerCase().includes(q)).slice(0, 6) : []
  const S = EST_STATUS[est.status] || EST_STATUS.draft
  const vehicle = [est.year, est.make, est.model, est.trim].filter(Boolean).join(' ')
  const adasOn = vinInfo?.adas ? Object.entries({ fcw: 'FCW', aeb: 'AEB', lane_departure: 'LDW', lane_keep: 'Lane keep', blind_spot: 'Blind spot', acc: 'ACC', rear_cross: 'RCTA', park_assist: 'Park assist', backup_cam: 'Backup cam' }).filter(([k]) => /standard|optional/i.test(vinInfo.adas[k] || '')).map(([, l]) => l) : []

  const footerPrimary = est.status === 'draft'
    ? <PrimaryButton tone="orange" onClick={() => setStatus('sent')} disabled={!canEdit || !ready.ok}>📤 Ready to send · {fmtCents(t.grand_total)}</PrimaryButton>
    : est.status === 'sent'
    ? <PrimaryButton tone="green" onClick={() => setStatus('approved')} disabled={!canEdit || !t.approved_jobs}>✅ Mark approved · {fmtCents(t.grand_total)}</PrimaryButton>
    : est.status === 'approved'
    ? <PrimaryButton tone="blue" disabled>💸 Push to Zoho Books · next phase</PrimaryButton>
    : est.status === 'declined' ? <PrimaryButton tone="orange" onClick={() => setStatus('draft')} disabled={!canEdit}>Reopen as draft</PrimaryButton>
    : <PrimaryButton disabled>Invoiced · locked</PrimaryButton>
  const footerSecondary = est.status === 'sent' ? <SecondaryButton onClick={() => setStatus('draft')} disabled={!canEdit}>Back to draft</SecondaryButton>
    : est.status === 'approved' ? <SecondaryButton onClick={() => setStatus('sent')} disabled={!canEdit}>Back to sent</SecondaryButton>
    : <SecondaryButton onClick={onBack}>← Estimates</SecondaryButton>

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#f5f3f0' }}>
      <div className="max-w-[1400px] mx-auto px-3 sm:px-4 pt-3 pb-28">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
          <div className="flex items-start gap-3">
            <button onClick={onBack} className="text-sm font-bold mt-1" style={{ color: ORANGE }}>← Estimates</button>
            <div>
              <Eyebrow>Estimate <span style={{ color: '#1a1a1a' }}>{est.number}</span> · <span style={{ color: S.fg }}>{S.label}</span> · {est.created_by || 'staff'} · {String(est.created_at).slice(0, 10)}{saving ? ' · saving…' : ''}</Eyebrow>
              <Title sub={vehicle || 'No vehicle yet'}>{est.customer_name || 'No customer yet'}</Title>
            </div>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {(est.flags || []).includes('over110') && <Chip tone="orange">⚠ over 110%</Chip>}
            {isTech && <Chip>read only</Chip>}
            <span className="text-xs font-bold px-2.5 py-1 rounded-full" style={{ backgroundColor: S.bg, color: S.fg }}>{S.label}</span>
            {canEdit && est.status === 'draft' && <button onClick={async () => { if (!confirm(`Delete ${est.number}?`)) return; await j(`/api/estimator/${id}`, { method: 'DELETE' }); onBack() }} className="text-xs font-semibold px-2 py-1 rounded-lg" style={{ color: '#b91c1c', backgroundColor: '#fef2f2' }}>Delete</button>}
          </div>
        </div>
        {/* Mark 2026-09-14: "adjust the parts markup with a box at the top and also the labor" — defaults $200/hr and 40% on parts */}
        <div className="flex items-center gap-3 flex-wrap rounded-xl px-3 py-2 mb-3" style={{ backgroundColor: 'white', border: '1.5px solid #e8e4e0' }}>
          <Eyebrow>⚙️ Rates for this estimate</Eyebrow>
          <label className="flex items-center gap-1.5 text-sm font-semibold" style={{ color: '#1a1a1a' }}>Labor <Money cents={est.labor_rate_cents ?? 20000} onChange={v => patchEst({ labor_rate_cents: v && v > 0 ? v : 20000 })} width={86} bold disabled={!canEdit} /><span className="text-xs font-normal" style={{ color: '#888' }}>/ hr</span></label>
          <label className="flex items-center gap-1.5 text-sm font-semibold" style={{ color: '#1a1a1a' }}>Parts markup <MarkupBox bp={est.parts_markup_bp ?? 4000} estMarkup={-1} onChange={bp => patchEst({ parts_markup_bp: bp == null ? 4000 : bp })} width={64} disabled={!canEdit} /><span className="text-xs font-normal" style={{ color: '#888' }}>% on cost</span></label>
          <span className="text-[11px]" style={{ color: '#888' }}>Every line and part follows these unless you type its own number.</span>
        </div>
        {err && <Notice tone="red" className="mb-3">{err} <button className="underline ml-2" onClick={() => setErr('')}>dismiss</button></Notice>}
        {t.over_110 && <Notice tone="red" className="mb-3"><b>Exceeds authorized amount, reauthorization required.</b> Approved work is {fmtCents(t.pre_tax_total)} against {fmtCents(t.authorized_total)} authorized (110% line is {fmtCents(Math.round(t.authorized_total * 1.1))}). Get a new authorization before the job grows further.</Notice>}

        <div className="grid gap-3 grid-cols-1 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
          {/* ── LEFT ── */}
          <div className="space-y-3 min-w-0">
            <Panel tone="blue" title="👤 Customer" right={est.customer_type === 'wholesale' ? 'Wholesale · resale' : 'Retail · taxable'}>
              <div className="p-3 space-y-2">
                {est.customer_name && (
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-bold text-sm" style={{ color: '#1a1a1a' }}>{est.customer_name}</div>
                      <div className="text-xs" style={{ color: '#666' }}>{[est.customer_contact?.name, est.customer_contact?.phone, est.customer_contact?.email].filter(Boolean).join(' · ') || 'no contact details'}</div>
                      <div className="text-xs" style={{ color: '#888' }}>{est.customer_contact?.address}</div>
                      <div className="mt-1 flex gap-1 flex-wrap"><Chip tone={est.customer_kind === 'shop' ? 'blue' : 'green'}>{est.customer_kind === 'shop' ? 'CRM shop' : 'retail person'}</Chip>{est.zoho_contact_id ? <Chip tone="green">Books ✓</Chip> : <Chip>no Books contact</Chip>}</div>
                    </div>
                    {canEdit && <button onClick={() => patchEst({ customer_name: '', customer_id: '', zoho_contact_id: '', customer_contact: {} })} className="text-xs font-semibold" style={{ color: '#888' }}>change</button>}
                  </div>
                )}
                {est.customer_name && est.customer_kind === 'retail' && (retail.find(c => c.id === est.customer_id)?.vehicles || []).length > 0 && (
                  <div className="flex gap-1 flex-wrap items-center"><Eyebrow>Their cars ·</Eyebrow>{retail.find(c => c.id === est.customer_id).vehicles.map((v, i) => <button key={i} disabled={!canEdit} onClick={() => patchEst({ vin: v.vin || est.vin, year: v.year, make: v.make, model: v.model, trim: v.trim || '', plate: v.plate || est.plate })} className="text-xs font-semibold rounded-full px-2.5 py-1" style={{ backgroundColor: est.vin && est.vin === v.vin ? BLUE : 'white', color: est.vin && est.vin === v.vin ? 'white' : BLUE, border: '1px solid #bfdbfe' }}>🚗 {[v.year, v.make, v.model].filter(Boolean).join(' ') || v.vin}</button>)}</div>
                )}
                {est.customer_name ? null : (
                  <div>
                    <input autoFocus={!est.customer_name} value={custQ} disabled={!canEdit} onChange={e => setCustQ(e.target.value)} placeholder="Search CRM shops or retail people…" className="w-full px-3 py-2 text-sm" style={inp} />
                    {(shopHits.length > 0 || retailHits.length > 0) && (
                      <div className="rounded-lg overflow-hidden mt-1" style={{ border: '1px solid #e0dbd6' }}>
                        {shopHits.map(s => <button key={`s${s.id}`} onClick={() => pickShop(s)} className="w-full text-left px-3 py-1.5 text-sm flex justify-between" style={{ borderTop: '1px solid #f1ede9' }}><span>🏪 {s.name}</span><span className="text-xs" style={{ color: '#888' }}>{s.discount_pct ? `${s.discount_pct}% off` : ''}{s.zoho_contact_id ? ' · Books' : ''}</span></button>)}
                        {retailHits.map(c => <button key={`r${c.id}`} onClick={() => pickRetail(c)} className="w-full text-left px-3 py-1.5 text-sm" style={{ borderTop: '1px solid #f1ede9' }}>🙂 {c.name} <span className="text-xs" style={{ color: '#888' }}>{c.phone}</span></button>)}
                      </div>
                    )}
                    {canEdit && !newPerson && <button onClick={() => setNewPerson({ name: custQ, phone: '', email: '', address: '', city: '', zip: '' })} className="text-xs font-bold mt-2" style={{ color: BLUE }}>＋ New retail customer{custQ ? ` "${custQ}"` : ''}</button>}
                    {newPerson && (
                      <div className="mt-2 grid grid-cols-2 gap-2 rounded-lg p-2" style={{ backgroundColor: '#eff6ff' }}>
                        {[['name', 'Name', 2], ['phone', 'Phone', 1], ['email', 'Email', 1], ['address', 'Address', 2], ['city', 'City', 1], ['zip', 'Zip', 1]].map(([k, l, sp]) => (
                          <div key={k} style={{ gridColumn: `span ${sp}` }}><Eyebrow>{l}</Eyebrow><input value={newPerson[k]} onChange={e => setNewPerson(p => ({ ...p, [k]: e.target.value }))} className="w-full px-2 py-1.5 text-sm" style={inp} /></div>
                        ))}
                        <div className="col-span-2 flex gap-2"><button onClick={createPerson} disabled={!newPerson.name.trim()} className="flex-1 rounded-lg py-1.5 text-sm font-bold text-white" style={{ backgroundColor: BLUE }}>Save person</button><button onClick={() => setNewPerson(null)} className="text-xs" style={{ color: '#888' }}>cancel</button></div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </Panel>

            <Panel tone="plain" title="🚗 Vehicle" right={vinInfo?.ok ? (vinInfo.cached ? 'decoded (cached)' : 'decoded · NHTSA') : ''}>
              <div className="p-3 grid grid-cols-4 gap-2">
                <div className="col-span-3"><Eyebrow>VIN</Eyebrow><div className="flex gap-1"><F label="" value={est.vin} onChange={v => patchEst({ vin: v.toUpperCase().replace(/[^A-Z0-9]/g, '') })} placeholder="17 characters" mono disabled={!canEdit} span={1} /></div></div>
                <div className="flex items-end"><button onClick={decode} disabled={!canEdit || vinBusy || String(est.vin || '').length !== 17} className="w-full rounded-lg py-1.5 text-xs font-bold text-white" style={{ backgroundColor: ORANGE, opacity: !canEdit || vinBusy || String(est.vin || '').length !== 17 ? .45 : 1 }}>{vinBusy ? '…' : '🔎 Decode'}</button></div>
                {vinInfo && !vinInfo.ok && <div className="col-span-4 text-xs px-2 py-1 rounded" style={{ backgroundColor: '#fef2f2', color: '#b91c1c' }}>{vinInfo.reason}</div>}
                {vinInfo?.ok && <div className="col-span-4 text-xs" style={{ color: '#555' }}>{[vinInfo.body, vinInfo.engine, vinInfo.drive].filter(Boolean).join(' · ')}{adasOn.length ? <div className="mt-1 flex gap-1 flex-wrap"><span className="text-[10px] font-bold" style={{ color: '#888' }}>ADAS on this VIN:</span>{adasOn.map(a => <Chip key={a} tone="orange">{a}</Chip>)}</div> : null}</div>}
                <F label="Year" value={est.year} onChange={v => patchEst({ year: v })} disabled={!canEdit} />
                <F label="Make" value={est.make} onChange={v => patchEst({ make: v })} disabled={!canEdit} />
                <F label="Model" value={est.model} onChange={v => patchEst({ model: v })} disabled={!canEdit} span={2} />
                <F label="Trim" value={est.trim} onChange={v => patchEst({ trim: v })} disabled={!canEdit} span={2} />
                <F label="Plate" value={est.plate} onChange={v => patchEst({ plate: v.toUpperCase() })} disabled={!canEdit} mono />
                <F label="Odometer" value={est.mileage} onChange={v => patchEst({ mileage: v })} disabled={!canEdit} placeholder="miles" />
              </div>
            </Panel>

            <Panel tone="plain" title="📋 Job info">
              <div className="p-3 grid grid-cols-2 gap-2">
                <F label="RO #" value={est.ro_number} onChange={v => patchEst({ ro_number: v })} disabled={!canEdit} mono />
                <F label="Claim #" value={est.claim_number} onChange={v => patchEst({ claim_number: v })} disabled={!canEdit} mono />
                <F label="Insurer" value={est.insurer} onChange={v => patchEst({ insurer: v })} disabled={!canEdit} span={2} placeholder="blank = customer pay" />
                <F label="Service address (where the work happens)" value={est.service_address} onChange={v => patchEst({ service_address: v })} disabled={!canEdit} span={2} />
                <F label="City" value={est.service_city} onChange={v => patchEst({ service_city: v })} disabled={!canEdit} />
                <F label="Zip (sets the tax rate)" value={est.service_zip} onChange={v => { const row = est.settings?.tax_by_zip?.[v]; patchEst({ service_zip: v, ...(row ? { tax_rate_bp: row.rate_bp, zoho_tax_id: row.tax_id || '', service_city: est.service_city || row.city || '' } : {}) }) }} disabled={!canEdit} mono />
                <F label="Reported problem / requested repairs (goes on the estimate)" value={est.concern} onChange={v => patchEst({ concern: v })} disabled={!canEdit} span={2} rows={2} placeholder="e.g. Windshield replaced, front camera calibration requested by shop" />
              </div>
            </Panel>

            <Panel tone="green" title="💲 Pricing">
              <Row left={<span className="font-semibold">Customer type</span>} right={<div className="flex gap-1"><Pill size="sm" on={est.customer_type === 'retail'} onClick={() => canEdit && patchEst({ customer_type: 'retail', tax_enabled: true })}>Retail</Pill><Pill size="sm" tone="blue" on={est.customer_type === 'wholesale'} onClick={() => canEdit && patchEst({ customer_type: 'wholesale', tax_enabled: false })}>Wholesale</Pill></div>} />
              {est.customer_type === 'wholesale' && <Row left={<span className="text-xs">Reseller permit # <span style={{ color: '#999' }}>(required, no sales tax)</span></span>} right={<input value={est.reseller_permit || ''} disabled={!canEdit} onChange={e => patchEst({ reseller_permit: e.target.value })} placeholder="permit #" className="px-2 py-1 text-xs w-32" style={{ ...inp, fontFamily: 'IBM Plex Mono, monospace' }} />} />}
              <Row left={<span className="font-semibold">Sales tax {est.tax_enabled && <span className="text-xs font-normal" style={{ color: '#666' }}>· {(est.tax_rate_bp / 100).toFixed(2)}%</span>}</span>} right={<div className="flex items-center gap-2">{est.tax_enabled && <input value={(est.tax_rate_bp / 100).toFixed(2)} disabled={!canEdit} onChange={() => {}} onBlur={e => patchEst({ tax_rate_bp: Math.round(Number(e.target.value) * 100) || 0 })} className="px-2 py-1 text-xs w-16 text-right" style={inp} />}<Switch on={!!est.tax_enabled} disabled={!canEdit} onClick={() => patchEst({ tax_enabled: !est.tax_enabled })} /></div>} sub={est.tax_enabled && !est.tax_rate_bp ? '⚠ No rate for this zip yet — type the combined rate, or set it in Settings.' : (!est.tax_enabled && est.customer_type === 'retail' ? <input value={est.tax_note || ''} disabled={!canEdit} onChange={e => patchEst({ tax_note: e.target.value })} placeholder="Why no tax on a retail job? (required)" className="w-full px-2 py-1 text-xs" style={inp} /> : null)} />
              <Row left={<span className="font-semibold">Shop supplies <span className="text-xs font-normal" style={{ color: '#666' }}>· {(est.supplies_pct_bp / 100).toFixed(1)}% of labor, max {fmtCents(est.supplies_cap_cents)}</span></span>} right={<Switch on={!!est.supplies_enabled} disabled={!canEdit} onClick={() => patchEst({ supplies_enabled: !est.supplies_enabled })} />} sub={est.supplies_enabled ? <div className="flex gap-2 items-center"><span>pct</span><input defaultValue={(est.supplies_pct_bp / 100).toFixed(1)} disabled={!canEdit} onBlur={e => patchEst({ supplies_pct_bp: Math.round(Number(e.target.value) * 100) || 0 })} className="px-2 py-0.5 text-xs w-14 text-right" style={inp} /><span>cap $</span><input defaultValue={fromCents(est.supplies_cap_cents)} disabled={!canEdit} onBlur={e => patchEst({ supplies_cap_cents: toCents(e.target.value) })} className="px-2 py-0.5 text-xs w-16 text-right" style={inp} />{t.supplies_capped && <Chip tone="orange">cap hit</Chip>}</div> : null} />
              <Row left={<span className="font-semibold">Discount</span>} right={<div className="flex items-center gap-1"><Pill size="sm" tone="plain" on={est.discount_type === 'none'} onClick={() => canEdit && patchEst({ discount_type: 'none', discount_value: 0 })}>None</Pill><Pill size="sm" on={est.discount_type === 'pct'} onClick={() => canEdit && patchEst({ discount_type: 'pct' })}>%</Pill><Pill size="sm" on={est.discount_type === 'flat'} onClick={() => canEdit && patchEst({ discount_type: 'flat' })}>$</Pill>{est.discount_type === 'pct' && <input defaultValue={(est.discount_value / 100).toFixed(1)} key={`d${est.discount_type}`} disabled={!canEdit} onBlur={e => patchEst({ discount_value: Math.round(Number(e.target.value) * 100) || 0 })} className="px-2 py-1 text-xs w-14 text-right" style={inp} />}{est.discount_type === 'flat' && <Money cents={est.discount_value} onChange={v => patchEst({ discount_value: v || 0 })} width={80} disabled={!canEdit} />}</div>} />
            </Panel>

            <Panel tone="green" title="Σ Totals" right={`${t.approved_jobs} of ${t.job_count} jobs approved`}>
              <Row left="Labor (approved)" right={fmtCents(t.labor_subtotal)} />
              <Row left="Parts (approved)" right={fmtCents(t.parts_subtotal)} />
              <Row left={<b>Subtotal</b>} right={<b>{fmtCents(t.subtotal)}</b>} />
              {t.discount > 0 && <Row left={`Discount${est.discount_type === 'pct' ? ` (${(est.discount_value / 100).toFixed(1)}%)` : ''}`} right={`− ${fmtCents(t.discount)}`} />}
              {est.supplies_enabled && <Row left="Shop supplies" right={fmtCents(t.supplies)} />}
              {est.tax_enabled && <Row left={`Sales tax (${(t.tax_rate_bp / 100).toFixed(2)}%)`} right={fmtCents(t.tax)} />}
              <TotalRow tone="green" label="Grand total" value={fmtCents(t.grand_total)} />
              {(t.recommended_total > 0 || t.declined_total > 0 || t.deferred_total > 0) && (
                <div className="px-3 pb-2 text-[11px] space-y-0.5" style={{ color: '#666' }}>
                  {t.recommended_total > 0 && <div>Recommended, not yet approved: <b>{fmtCents(t.recommended_total)}</b></div>}
                  {t.deferred_total > 0 && <div>Deferred: <b>{fmtCents(t.deferred_total)}</b></div>}
                  {t.declined_total > 0 && <div>Declined: <b>{fmtCents(t.declined_total)}</b></div>}
                </div>
              )}
              {t.authorized_total > 0 && <div className="px-3 pb-2 text-[11px]" style={{ color: t.over_110 ? '#b91c1c' : '#166534' }}>Authorized {fmtCents(t.authorized_total)} · 110% line {fmtCents(Math.round(t.authorized_total * 1.1))} · pre-tax now {fmtCents(t.pre_tax_total)}</div>}
            </Panel>
          </div>

          {/* ── RIGHT: jobs ── */}
          <div className="min-w-0">
            <Panel tone="orange" title={`🔧 Jobs · ${est.jobs.length}`} right={canEdit ? <span className="flex gap-1.5"><button onClick={() => setTplOpen(o => !o)} className="text-xs font-bold px-2 py-0.5 rounded-lg" style={{ backgroundColor: 'white', color: ORANGE, border: '1px solid #f5c9b8' }}>＋ From template</button><button onClick={() => addJob({})} className="text-xs font-bold px-2 py-0.5 rounded-lg text-white" style={{ backgroundColor: ORANGE }}>＋ Blank job</button></span> : null}>
              <div className="p-2.5 space-y-2">
                {tplOpen && (
                  <div className="rounded-lg p-2 grid gap-1.5" style={{ backgroundColor: '#fff5f0', border: '1px solid #f5c9b8', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
                    {templates.map(tp => <button key={tp.id} onClick={() => addJob({ template_id: tp.id })} className="text-left rounded-lg px-2.5 py-1.5 text-sm" style={{ backgroundColor: 'white', border: '1px solid #f5c9b8' }}><div className="font-semibold" style={{ color: '#1a1a1a' }}>{tp.name}</div><div className="text-[10px]" style={{ color: '#888' }}>{tp.category} · {tp.lines.length} line{tp.lines.length === 1 ? '' : 's'}{tp.uses ? ` · used ${tp.uses}×` : ''}</div></button>)}
                    {templates.length === 0 && <div className="text-xs" style={{ color: '#888' }}>No templates yet.</div>}
                  </div>
                )}
                {canEdit && common.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 items-center px-0.5 pb-1">
                    <Eyebrow>🤖 Rick knows these jobs ·</Eyebrow>
                    {common.slice(0, 8).map(c => (
                      <button key={c.name} onClick={() => addJob({ name: c.name, category: c.category, lines: c.lines, invoice_description: c.invoice_description })} title={`Used ${c.count}× · usually ${fmtCents(c.usual_cents)}`} className="text-xs font-semibold rounded-full px-2.5 py-1" style={{ backgroundColor: 'white', color: '#1a1a1a', border: '1px solid #f5c9b8' }}>
                        {c.name} <span className="tabular-nums" style={{ color: GREEN }}>{fmtCents(c.usual_cents)}</span><span style={{ color: '#bbb' }}> · {c.count}×</span>
                      </button>
                    ))}
                  </div>
                )}
                {live.jobs.length === 0 && <div className="text-sm italic px-2 py-6 text-center" style={{ color: '#999' }}>No jobs yet. Start from a template or a blank job. Only <b>approved</b> jobs count toward the total.</div>}
                {live.jobs.map(job => (
                  <JobCard key={job.id} job={job} settings={{ ...est.settings, labor_rate_cents: est.labor_rate_cents ?? 20000, parts_markup_bp: est.parts_markup_bp ?? 4000 }} catalog={catalog} canEdit={canEdit} vehicle={vehicle} usual={common.find(c => c.name.toLowerCase() === String(job.name || '').replace(/\s*\(copy\)\s*$/i, '').trim().toLowerCase())}
                    onPatch={f => patchJob(job.id, f)} onStatus={s => setJobStatus(job, s)} onDuplicate={() => dupJob(job.id)} onDelete={() => delJob(job.id)} onSaveTemplate={() => saveTpl(job.id)}
                    dragProps={{ draggable: armed === job.id, onHandleDown: () => setArmed(job.id), onDragStart: () => setDragId(job.id), onDragOver: e => { e.preventDefault() }, onDrop: () => drop(job.id), style: dragId === job.id ? { opacity: .4 } : undefined }} />
                ))}
              </div>
            </Panel>
            <div className="text-[11px] mt-2 px-1" style={{ color: '#888' }}>Statuses: <b style={{ color: BLUE }}>Recommended</b> is on the estimate but not in the total · <b style={{ color: GREEN }}>Approved</b> counts and needs an authorization · Declined and Deferred stay on the paper at $0.</div>
          </div>
        </div>
      </div>

      <Footer note={est.status === 'draft' && !ready.ok ? `Before sending: ${ready.missing.join(', ')}` : (est.flags || []).includes('no_permit') ? 'Wholesale with no reseller permit on file — tax is off. Add the permit # or flip to Retail.' : null} secondary={footerSecondary} primary={footerPrimary} />

      {authJob && <AuthorizeModal job={live.jobs.find(x => x.id === authJob.id) || authJob} user={user} onConfirm={confirmAuth} onCancel={() => setAuthJob(null)} />}
      {declineJob && <DeclineModal job={declineJob} onConfirm={confirmDecline} onCancel={() => setDeclineJob(null)} />}
      {toast && <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[95] text-sm font-bold text-white px-4 py-2 rounded-full" style={{ backgroundColor: '#1a1a1a' }}>{toast}</div>}
    </div>
  )
}

function DeclineModal({ job, onConfirm, onCancel }) {
  const [reason, setReason] = useState('')
  return (
    <div className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,.55)' }} onMouseDown={e => { if (e.target === e.currentTarget) onCancel() }}>
      <div className="bg-white w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl p-5 space-y-3">
        <Eyebrow>Decline job</Eyebrow>
        <div className="font-bold" style={{ color: '#1a1a1a' }}>{job.name}</div>
        <input autoFocus value={reason} onChange={e => setReason(e.target.value)} placeholder="Reason (stays on the estimate at $0)" className="w-full px-3 py-2 text-sm" style={inp} onKeyDown={e => e.key === 'Enter' && onConfirm(reason || 'declined')} />
        <div className="flex gap-2"><SecondaryButton onClick={onCancel}>Cancel</SecondaryButton><PrimaryButton tone="orange" onClick={() => onConfirm(reason || 'declined')}>Decline</PrimaryButton></div>
      </div>
    </div>
  )
}
