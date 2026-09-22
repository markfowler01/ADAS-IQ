// 💵 Collect (Mark 2026-09-22): on a billed, pays-on-site card. The total,
// a QR to the Books invoice page (Pay Now = Zoho Payments), and Check /
// Cash. Techs see the total — they need it to take a check. Same panel on
// the tech's phone and Kat's board.
import { useEffect, useState } from 'react'
import { API_BASE, apiFetch } from '../utils/api.js'

const GREEN = '#15803d', RED = '#b91c1c'
const fmt = n => `$${Number(n || 0).toFixed(2)}`

export default function CollectPanel({ job, onPaid }) {
  const [d, setD] = useState(null)
  const [err, setErr] = useState('')
  const [mode, setMode] = useState(null)      // 'check' | 'cash' | null
  const [ref, setRef] = useState('')
  const [busy, setBusy] = useState('')
  const [big, setBig] = useState(false)
  const load = () => apiFetch(`${API_BASE}/api/jobs/${job.id}/collect`).then(r => r.json()).then(x => { if (x.error) setErr(x.error); else { setD(x); if (x.invoice?.paid) onPaid && onPaid(x.invoice) } }).catch(e => setErr(e.message))
  useEffect(() => { load() }, [job.id]) // eslint-disable-line react-hooks/exhaustive-deps
  async function pay(m) {
    setBusy(m); setErr('')
    try {
      const r = await apiFetch(`${API_BASE}/api/jobs/${job.id}/collect`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: m, reference: ref }) })
      const x = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(x.error || `HTTP ${r.status}`)
      setMode(null); setRef('')
      await load()
      if (x.invoice?.paid) onPaid && onPaid(x.invoice)
    } catch (e) { setErr(e.message) } finally { setBusy('') }
  }
  if (!d && !err) return <div className="rounded-xl p-3 mb-2 text-xs" style={{ backgroundColor: '#f0fdfa', border: '1.5px solid #99f6e4', color: '#0f766e' }}>💵 Loading the invoice…</div>
  if (err && !d) return <div className="rounded-xl p-3 mb-2 text-xs" style={{ backgroundColor: '#fef2f2', border: '1.5px solid #fecaca', color: RED }}>{err}</div>
  const inv = d.invoice
  if (!inv) return <div className="rounded-xl p-3 mb-2 text-xs" style={{ backgroundColor: '#fffbeb', border: '1.5px solid #fde68a', color: '#92400e' }}>💵 {d.why}</div>
  if (inv.paid) return <div className="rounded-xl p-3 mb-2" style={{ backgroundColor: '#dcfce7', border: '1.5px solid #86efac' }}><div className="text-sm font-extrabold" style={{ color: GREEN }}>✅ Paid · {fmt(inv.total)}</div><div className="text-[11px]" style={{ color: '#166534' }}>{inv.invoice_number}{d.paid_via ? ` · ${d.paid_via}` : ''} — receipt went from Books.</div></div>
  return (
    <div className="rounded-xl p-3 mb-2" style={{ backgroundColor: '#f0fdfa', border: '2px solid #14b8a6' }} onClick={e => e.stopPropagation()}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <div>
          <div className="text-[10px] uppercase tracking-wider font-bold" style={{ color: '#0f766e', fontFamily: 'IBM Plex Mono, monospace' }}>💵 Collect · {inv.invoice_number}</div>
          <div className="text-2xl font-extrabold leading-tight" style={{ color: '#134e4a' }}>{fmt(inv.balance)}{inv.balance !== inv.total ? <span className="text-xs font-normal" style={{ color: '#0f766e' }}> of {fmt(inv.total)}</span> : null}</div>
        </div>
        {d.qr && <button type="button" onClick={() => setBig(b => !b)} className="flex-shrink-0 rounded-lg overflow-hidden" style={{ border: '2px solid #14b8a6', backgroundColor: 'white' }} title="Card — they scan this"><img src={d.qr} alt="Pay by card" style={{ width: big ? 240 : 72, height: big ? 240 : 72, display: 'block' }} /></button>}
      </div>
      {big && <div className="text-xs text-center mb-2 font-semibold" style={{ color: '#0f766e' }}>They scan → Pay Now on the invoice. Tap the code to shrink it.</div>}
      {!mode ? (
        <div className="flex gap-2">
          <button type="button" onClick={() => setMode('check')} disabled={!!busy} className="flex-1 rounded-xl py-2.5 text-sm font-bold text-white" style={{ backgroundColor: '#0f766e' }}>🧾 Check</button>
          <button type="button" onClick={() => setMode('cash')} disabled={!!busy} className="flex-1 rounded-xl py-2.5 text-sm font-bold text-white" style={{ backgroundColor: '#0f766e' }}>💵 Cash</button>
          <button type="button" onClick={() => pay('card')} disabled={!!busy} className="flex-1 rounded-xl py-2.5 text-sm font-bold" style={{ backgroundColor: 'white', color: '#0f766e', border: '1.5px solid #14b8a6' }}>{busy === 'card' ? '…' : '💳 Paid on QR?'}</button>
        </div>
      ) : (
        <div className="flex gap-2 items-center flex-wrap">
          {mode === 'check' && <input autoFocus value={ref} onChange={e => setRef(e.target.value)} placeholder="Check #" inputMode="numeric" className="rounded-lg px-3 py-2 text-base w-32" style={{ border: '1.5px solid #14b8a6', outline: 'none', backgroundColor: 'white' }} onKeyDown={e => { if (e.key === 'Enter' && ref.trim()) pay('check'); if (e.key === 'Escape') setMode(null) }} />}
          <button type="button" onClick={() => pay(mode)} disabled={!!busy || (mode === 'check' && !ref.trim())} className="rounded-xl px-4 py-2.5 text-sm font-bold text-white" style={{ backgroundColor: GREEN, opacity: mode === 'check' && !ref.trim() ? .5 : 1 }}>{busy ? 'Recording…' : `✓ Got ${fmt(inv.balance)} ${mode === 'check' ? 'by check' : 'cash'}`}</button>
          <button type="button" onClick={() => setMode(null)} className="text-sm px-2" style={{ color: '#888' }}>cancel</button>
        </div>
      )}
      {err && <div className="text-xs mt-2 font-semibold" style={{ color: RED }}>{err}</div>}
      <div className="text-[11px] mt-2" style={{ color: '#0f766e' }}>Recorded in Books on the spot · receipt emails itself · card closes when it's paid.</div>
    </div>
  )
}
