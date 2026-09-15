// Public estimate page (no login): /app/estimate?e=<id>&t=<token>. The shop
// or car owner reads the itemized estimate, approves or declines each job
// (recorded as the RCW authorization), or approves everything at once.
import { useEffect, useState } from 'react'
import { API_BASE } from '../../utils/portal'

const ORANGE = '#CD4419', GREEN = '#15803d', BLUE = '#1d4ed8', RED = '#b91c1c'
const fmt = c => `$${(Number(c || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const SRC = { oem: 'OEM', aftermarket: 'Aftermarket', recycled: 'Used', reconditioned: 'Reconditioned', sublet: 'Sublet' }
const ST = { approved: { l: 'Approved', c: GREEN, bg: '#dcfce7' }, declined: { l: 'Declined', c: RED, bg: '#fee2e2' }, recommended: { l: 'Needs your OK', c: BLUE, bg: '#eff6ff' }, deferred: { l: 'Deferred', c: '#666', bg: '#f5f3f0' } }

export default function EstimateApprovalScreen() {
  const params = new URLSearchParams(window.location.search)
  const id = params.get('estimate') || params.get('e') || '', t = params.get('t') || ''
  const [est, setEst] = useState(null)
  const [err, setErr] = useState('')
  const [name, setName] = useState(() => { try { return localStorage.getItem('adas_est_name') || '' } catch { return '' } })
  const [contact, setContact] = useState('')
  const [busy, setBusy] = useState('')
  const [declining, setDeclining] = useState(null)
  const [reason, setReason] = useState('')
  const [open, setOpen] = useState({})
  const base = `${API_BASE}/api/public/estimate/${encodeURIComponent(id)}`

  useEffect(() => {
    if (!id || !t) { setErr('This link is missing its reference. Ask Absolute ADAS to resend it.'); return }
    fetch(`${base}?t=${encodeURIComponent(t)}`).then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Could not load'); setEst(d.estimate) }).catch(e => setErr(e.message))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function act(path, body, key) {
    if (!name.trim()) { setErr('Please enter your name first — it goes on the authorization.'); window.scrollTo({ top: 0, behavior: 'smooth' }); return }
    try { localStorage.setItem('adas_est_name', name.trim()) } catch {}
    setBusy(key); setErr('')
    try {
      const r = await fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ t, name: name.trim(), contact, ...body }) })
      const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Something went wrong')
      setEst(d.estimate); setDeclining(null); setReason('')
    } catch (e) { setErr(e.message) } finally { setBusy('') }
  }

  if (err && !est) return <Shell><div className="rounded-xl p-5 text-sm" style={{ backgroundColor: '#fef2f2', color: RED }}>{err}</div></Shell>
  if (!est) return <Shell><div className="text-sm" style={{ color: '#888' }}>Loading your estimate…</div></Shell>
  const tt = est.totals
  const pending = est.jobs.filter(j => j.status === 'recommended' || j.status === 'deferred')
  const done = est.status === 'invoiced'
  const co = est.company || {}

  return (
    <Shell>
      <div className="rounded-2xl overflow-hidden" style={{ backgroundColor: 'white', border: '1.5px solid #e8e4e0' }}>
        <div className="px-5 py-4" style={{ backgroundColor: ORANGE, color: 'white' }}>
          <div className="text-[11px] font-bold uppercase tracking-wider" style={{ opacity: .85, fontFamily: 'IBM Plex Mono, monospace' }}>{co.name || 'Absolute ADAS'} · Estimate {est.number}</div>
          <div className="text-xl font-extrabold mt-0.5">{est.vehicle || 'Your vehicle'}</div>
          <div className="text-sm" style={{ opacity: .9 }}>{est.customer_name}{est.ro_number ? ` · RO ${est.ro_number}` : ''}{est.vin ? ` · VIN ${est.vin}` : ''}</div>
        </div>
        <div className="px-5 py-4 space-y-4">
          {est.concern && <div className="text-sm" style={{ color: '#444' }}><span className="text-[10px] font-bold uppercase tracking-wider block" style={{ color: '#888' }}>Requested work</span>{est.concern}</div>}
          {err && <div className="rounded-lg px-3 py-2 text-sm" style={{ backgroundColor: '#fef2f2', color: RED }}>{err}</div>}
          {!done && pending.length > 0 && (
            <div className="rounded-xl p-3" style={{ backgroundColor: '#fffbeb', border: '1.5px solid #fde68a' }}>
              <div className="text-sm font-bold" style={{ color: '#92400e' }}>Approve the work you want done</div>
              <div className="text-xs mt-0.5" style={{ color: '#92400e' }}>Your name goes on the authorization. We will not charge more than 110% of what you approve without asking you first.</div>
              <div className="grid grid-cols-2 gap-2 mt-2">
                <input value={name} onChange={e => setName(e.target.value)} placeholder="Your name (required)" className="px-3 py-2 text-sm rounded-lg" style={{ border: '1px solid #e0dbd6', backgroundColor: 'white' }} />
                <input value={contact} onChange={e => setContact(e.target.value)} placeholder="Phone or email (optional)" className="px-3 py-2 text-sm rounded-lg" style={{ border: '1px solid #e0dbd6', backgroundColor: 'white' }} />
              </div>
              {pending.length > 1 && <button disabled={!!busy} onClick={() => act('/approve-all', {}, 'all')} className="mt-2 w-full rounded-xl py-3 text-base font-bold text-white" style={{ backgroundColor: GREEN, opacity: busy ? .6 : 1 }}>{busy === 'all' ? 'Saving…' : `✅ Approve everything · ${fmt(tt.grand_total + tt.recommended_total + tt.deferred_total)}`}</button>}
            </div>
          )}
          {done && <div className="rounded-xl p-3 text-sm font-semibold" style={{ backgroundColor: '#f3e8ff', color: '#6d28d9' }}>This estimate has been invoiced. Thank you!</div>}
          {!done && pending.length === 0 && <div className="rounded-xl p-3 text-sm font-semibold" style={{ backgroundColor: '#f0fdf4', color: GREEN }}>✅ All set — every item has your answer. We'll be in touch to schedule.</div>}

          {est.jobs.map(j => {
            const s = ST[j.status] || ST.recommended; const isOpen = !!open[j.id]
            return (
              <div key={j.id} className="rounded-xl overflow-hidden" style={{ border: `1.5px solid ${j.status === 'approved' ? '#86efac' : '#e8e4e0'}` }}>
                <div className="px-3 py-2.5 flex items-start justify-between gap-2" style={{ backgroundColor: s.bg }}>
                  <div className="min-w-0">
                    <div className="font-bold text-sm" style={{ color: '#1a1a1a' }}>{j.invoice_description || j.name}</div>
                    <div className="text-[11px] font-bold" style={{ color: s.c }}>{s.l}{j.status === 'approved' && j.authorized_by_name ? ` · by ${j.authorized_by_name}` : ''}{j.status === 'declined' && j.decline_reason ? ` · ${j.decline_reason.replace(/^Declined by .*? via approval link:? ?/, '')}` : ''}</div>
                  </div>
                  <div className="text-right"><div className="font-extrabold tabular-nums" style={{ color: j.status === 'declined' ? '#999' : '#1a1a1a', fontSize: 17, textDecoration: j.status === 'declined' ? 'line-through' : 'none' }}>{fmt(j.total_cents)}</div><button onClick={() => setOpen(o => ({ ...o, [j.id]: !isOpen }))} className="text-[11px] font-semibold" style={{ color: '#888' }}>{isOpen ? 'hide details' : 'see details'}</button></div>
                </div>
                {isOpen && (
                  <div className="px-3 py-2 text-xs space-y-1" style={{ color: '#444' }}>
                    {j.lines.map((l, i) => (
                      <div key={i}>
                        <div className="flex justify-between gap-2"><span>{l.desc || 'Labor'}{!l.flat && l.hours ? <span style={{ color: '#888' }}> · {Number(l.hours).toFixed(1)} hr</span> : null}</span><span className="tabular-nums">{fmt(l.labor_cents)}</span></div>
                        {l.parts.map((p, k) => <div key={k} className="flex justify-between gap-2 pl-3" style={{ color: '#666' }}><span>{p.pn ? `${p.pn} · ` : ''}{p.desc} · {SRC[p.source] || p.source} · {p.qty} × {fmt(p.price_each_cents)}</span><span className="tabular-nums">{fmt(p.total_cents)}</span></div>)}
                      </div>
                    ))}
                  </div>
                )}
                {!done && (j.status === 'recommended' || j.status === 'deferred') && (
                  <div className="px-3 py-2 flex gap-2" style={{ borderTop: '1px solid #f1ede9' }}>
                    <button disabled={!!busy} onClick={() => act(`/jobs/${j.id}/approve`, {}, j.id)} className="flex-[2] rounded-lg py-2 text-sm font-bold text-white" style={{ backgroundColor: GREEN, opacity: busy ? .6 : 1 }}>{busy === j.id ? '…' : `✅ Approve · ${fmt(j.total_cents)}`}</button>
                    <button disabled={!!busy} onClick={() => setDeclining(declining === j.id ? null : j.id)} className="flex-1 rounded-lg py-2 text-sm font-bold" style={{ backgroundColor: 'white', color: RED, border: `1.5px solid #fecaca` }}>Decline</button>
                  </div>
                )}
                {declining === j.id && (
                  <div className="px-3 pb-2 flex gap-2"><input autoFocus value={reason} onChange={e => setReason(e.target.value)} placeholder="Reason (optional)" className="flex-1 px-3 py-2 text-sm rounded-lg" style={{ border: '1px solid #e0dbd6' }} /><button disabled={!!busy} onClick={() => act(`/jobs/${j.id}/decline`, { reason }, 'd' + j.id)} className="rounded-lg px-3 py-2 text-sm font-bold text-white" style={{ backgroundColor: RED }}>Confirm decline</button></div>
                )}
              </div>
            )
          })}

          <div className="rounded-xl overflow-hidden" style={{ border: '1.5px solid #bbf7d0' }}>
            <div className="px-3 py-2 text-sm font-bold" style={{ backgroundColor: '#f0fdf4', color: GREEN }}>Total for approved work</div>
            <div className="px-3 py-2 text-sm space-y-1">
              <Row l="Labor" v={fmt(tt.labor_subtotal)} /><Row l="Parts" v={fmt(tt.parts_subtotal)} />
              {tt.discount > 0 && <Row l="Discount" v={`− ${fmt(tt.discount)}`} />}
              {est.supplies_enabled && <Row l="Shop supplies" v={fmt(tt.supplies)} />}
              {est.tax_enabled && <Row l={`Sales tax (${(tt.tax_rate_bp / 100).toFixed(2)}%)`} v={fmt(tt.tax)} />}
              <div className="flex justify-between font-extrabold text-base pt-1" style={{ borderTop: '2px solid #bbf7d0', color: GREEN }}><span>Total</span><span className="tabular-nums">{fmt(tt.grand_total)}</span></div>
              {tt.recommended_total + tt.deferred_total > 0 && <div className="text-[11px]" style={{ color: '#888' }}>Not yet approved: {fmt(tt.recommended_total + tt.deferred_total)}</div>}
            </div>
          </div>
          <a href={`${base}/pdf?t=${encodeURIComponent(t)}`} target="_blank" rel="noreferrer" className="block text-center text-sm font-bold" style={{ color: BLUE }}>📄 Download the itemized estimate (PDF)</a>
          <div className="text-[11px] text-center" style={{ color: '#888' }}>{co.name || 'Absolute ADAS'} · {co.address || 'Lake Stevens, WA'}{co.phone ? ` · ${co.phone}` : ''} · {co.web || 'absoluteadas.com'}<br />Written estimate under RCW 46.71. Charges will not exceed 110% of the authorized amount, exclusive of sales tax, without additional authorization.</div>
        </div>
      </div>
    </Shell>
  )
}
const Row = ({ l, v }) => <div className="flex justify-between" style={{ color: '#444' }}><span>{l}</span><span className="tabular-nums">{v}</span></div>
function Shell({ children }) { return <div className="min-h-screen px-3 py-4 sm:py-8" style={{ backgroundColor: '#f5f3f0' }}><div className="max-w-xl mx-auto">{children}</div></div> }
