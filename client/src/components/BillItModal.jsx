// 💸 Bill it (Mark 2026-09-10) — the in-app review of BOTH documents
// before anything is emailed: the insurance invoice (the estimate, at
// list) and the cost invoice (per-line partnership discount). Staff only;
// the server refuses technicians and refuses to double-bill.
import { useEffect, useState } from 'react'
import { API_BASE, apiFetch } from '../utils/api.js'

const ORANGE = '#CD4419'
const GREEN = '#15803d'
const fmt = n => `$${Number(n || 0).toFixed(2)}`

export default function BillItModal({ job, user, onClose, onBilled }) {
  const [p, setP] = useState(null)
  const [err, setErr] = useState('')
  const [emails, setEmails] = useState('')
  const [pct, setPct] = useState(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null)
  const [dry, setDry] = useState(false)
  const isOwner = String(user?.email || '').toLowerCase().startsWith('mark@') || user?.role === 'owner'

  useEffect(() => {
    let dead = false
    apiFetch(`${API_BASE}/api/jobs/${job.id}/bill/preview`, { method: 'POST' }).then(async r => {
      const d = await r.json().catch(() => ({}))
      if (dead) return
      if (!r.ok) { setErr(d.error || `HTTP ${r.status}`); return }
      setP(d); setEmails((d.emails || []).join(', ')); setPct(d.discount_pct)
    }).catch(e => !dead && setErr(e.message))
    return () => { dead = true }
  }, [job.id])

  async function send() {
    if (!p) return
    const list = emails.split(/[,\s]+/).map(s => s.trim()).filter(Boolean)
    if (!list.length) { setErr('Add at least one email.'); return }
    if (!dry && !window.confirm(`Send BOTH to ${list.join(', ')}?\n\nInsurance invoice ${p.estimate_number}: ${fmt(p.insurance_total)}\nCost invoice at ${pct}%: ${fmt(p.cost_total)}`)) return
    setBusy(true); setErr('')
    try {
      const r = await apiFetch(`${API_BASE}/api/jobs/${job.id}/bill${dry ? '?dry=1' : ''}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ emails: list, discount_pct: pct }) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)
      setDone(d); if (!dry) onBilled && onBilled(d)
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  // Recompute cost lines client-side when Kat edits the % (server recomputes on send).
  const lines = (p?.lines || []).map(l => {
    const eligible = l.discount_pct > 0 || (l.why === '' && l.amount > 0 && l.product_type !== 'goods')
    const d = eligible && pct > 0 ? pct : 0
    return { ...l, d, cost: Math.round(l.amount * (1 - d / 100) * 100) / 100 }
  })
  const insTotal = lines.reduce((s, l) => s + l.amount, 0)
  const costTotal = lines.reduce((s, l) => s + l.cost, 0)

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.55)' }} onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white w-full sm:max-w-2xl rounded-t-2xl sm:rounded-2xl flex flex-col" style={{ maxHeight: '94vh' }}>
        <div className="flex items-center justify-between px-5 py-3" style={{ borderBottom: '1px solid #ebebeb' }}>
          <div>
            <div className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: '#888', fontFamily: 'IBM Plex Mono, monospace' }}>💸 Bill it · review before anything is sent</div>
            <div className="font-bold text-base" style={{ color: '#1a1a1a' }}>{p?.shop_name || job.shop_name}{p?.estimate_number ? ` · ${p.estimate_number}` : ''}</div>
          </div>
          <button onClick={onClose} className="text-2xl leading-none" style={{ color: '#888' }}>×</button>
        </div>

        <div className="px-5 py-4 overflow-y-auto space-y-3">
          {err && <div className="text-sm px-3 py-2 rounded-lg" style={{ backgroundColor: '#fef2f2', color: '#b91c1c' }}>{err}</div>}
          {!p && !err && <div className="text-sm py-6 text-center" style={{ color: '#888' }}>Reading the estimate from Books…</div>}
          {done && (
            <div className="rounded-xl p-4" style={{ backgroundColor: done.dry ? '#fffbeb' : '#f0fdf4', border: `1.5px solid ${done.dry ? '#fde68a' : '#86efac'}` }}>
              <div className="font-bold text-sm" style={{ color: done.dry ? '#92400e' : GREEN }}>{done.dry ? '🧪 Dry run — nothing sent. Here is what it would have done:' : '✅ Both sent.'}</div>
              <div className="text-xs mt-1" style={{ color: '#555' }}>
                Insurance invoice {p.estimate_number} → {done.emails.join(', ')}<br />
                Cost invoice {done.invoice?.number || p.estimate_number} at {pct}% → {fmt(costTotal)}{done.invoice ? ` (Books total ${fmt(done.invoice.total)})` : ''}
              </div>
              <button onClick={onClose} className="mt-3 text-sm font-bold rounded-xl px-4 py-2 text-white" style={{ backgroundColor: GREEN }}>Done</button>
            </div>
          )}
          {p && !done && (<>
            {p.warnings.length > 0 && (
              <div className="rounded-xl p-3 text-xs space-y-1" style={{ backgroundColor: '#fffbeb', border: '1.5px solid #fde68a', color: '#92400e' }}>
                {p.warnings.map((w, i) => <div key={i}>⚠️ {w}</div>)}
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="rounded-xl overflow-hidden" style={{ border: '1.5px solid #bfdbfe' }}>
                <div className="px-3 py-2 text-xs font-bold" style={{ backgroundColor: '#eff6ff', color: '#1d4ed8' }}>🏦 Insurance invoice · estimate {p.estimate_number} as-is</div>
                {lines.map((l, i) => (
                  <div key={i} className="flex justify-between gap-2 px-3 py-1.5 text-xs" style={{ borderTop: '1px solid #f1f5f9' }}>
                    <span className="truncate" style={{ color: '#1a1a1a' }}>{l.name}{l.quantity > 1 ? ` ×${l.quantity}` : ''}{l._extra ? ' ➕' : ''}</span>
                    <span className="flex-shrink-0" style={{ color: '#555' }}>{fmt(l.amount)}</span>
                  </div>
                ))}
                <div className="flex justify-between px-3 py-2 text-sm font-extrabold" style={{ borderTop: '1px solid #e2e8f0', color: '#1a1a1a' }}><span>Total</span><span>{fmt(insTotal)}</span></div>
              </div>
              <div className="rounded-xl overflow-hidden" style={{ border: '1.5px solid #bbf7d0' }}>
                <div className="px-3 py-2 text-xs font-bold flex items-center justify-between" style={{ backgroundColor: '#f0fdf4', color: GREEN }}>
                  <span>💸 Cost invoice · {p.customer_type ? p.customer_type.replace(/_/g, ' ') : 'shop'} discount</span>
                  <span className="flex items-center gap-1">
                    <input type="number" min="0" max="50" value={pct ?? 0} onChange={e => setPct(Number(e.target.value))} className="w-14 text-xs rounded-md px-1.5 py-0.5 text-right" style={{ border: '1px solid #bbf7d0' }} />%
                  </span>
                </div>
                {lines.map((l, i) => (
                  <div key={i} className="flex justify-between gap-2 px-3 py-1.5 text-xs" style={{ borderTop: '1px solid #f1f5f9' }}>
                    <span className="truncate" style={{ color: '#1a1a1a' }}>{l.name}{l.quantity > 1 ? ` ×${l.quantity}` : ''}{l.d ? <span style={{ color: GREEN }}> −{l.d}%</span> : l.why ? <span style={{ color: '#888' }}> · {l.why}</span> : null}</span>
                    <span className="flex-shrink-0" style={{ color: l.d ? GREEN : '#555' }}>{fmt(l.cost)}</span>
                  </div>
                ))}
                <div className="flex justify-between px-3 py-2 text-sm font-extrabold" style={{ borderTop: '1px solid #dcfce7', color: GREEN }}><span>Total · Due on Receipt</span><span>{fmt(costTotal)}</span></div>
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1" style={{ color: '#888' }}>Send both to</label>
              <input value={emails} onChange={e => setEmails(e.target.value)} placeholder="shop@email.com, second@email.com" className="w-full rounded-lg px-3 py-2 text-sm" style={{ border: '1px solid #e0dbd6', outline: 'none' }} />
              <div className="text-[11px] mt-1" style={{ color: '#888' }}>From the Books contact. Saves the shop {fmt(insTotal - costTotal)}. Rule on file: {p.rule}.</div>
            </div>
            {isOwner && (
              <label className="flex items-center gap-2 text-xs" style={{ color: '#92400e' }}>
                <input type="checkbox" checked={dry} onChange={e => setDry(e.target.checked)} /> Dry run — build it, post to #dispatch, send nothing (Mark only)
              </label>
            )}
          </>)}
        </div>

        {p && !done && (
          <div className="px-5 py-3 flex gap-2" style={{ borderTop: '1px solid #ebebeb' }}>
            <button onClick={onClose} className="flex-1 rounded-xl py-2.5 text-sm font-semibold" style={{ backgroundColor: '#f5f3f0', color: '#555' }}>Cancel</button>
            <button onClick={send} disabled={busy || (!dry && !p.can_bill)} className="flex-[2] rounded-xl py-2.5 text-sm font-bold text-white" style={{ backgroundColor: dry ? '#92400e' : GREEN, opacity: busy || (!dry && !p.can_bill) ? .45 : 1 }}>
              {busy ? 'Sending…' : dry ? '🧪 Dry run' : `💸 Send both — ${fmt(insTotal)} insurance · ${fmt(costTotal)} cost`}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
