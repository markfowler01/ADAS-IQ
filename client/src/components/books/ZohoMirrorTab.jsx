// Zoho Mirror tab (books scan B-02, Mark 2026-09-07): READ-ONLY view of
// what Zoho Books says — AR by shop, aging, this month's invoiced vs
// collected, and the month's invoice/payment lists. Nothing here writes
// to Zoho; the sync button pulls, never pushes.
import { useState, useEffect, useCallback } from 'react'
import { API_BASE, apiFetch } from '../../utils/api.js'

const ORANGE = '#CD4419'
const fmt$ = n => `$${Math.round(Number(n) || 0).toLocaleString('en-US')}`
const BUCKETS = ['current', '1-30', '31-60', '61-90', '90+']
const bucketColor = b => b === 'current' ? '#15803d' : b === '1-30' ? '#a16207' : b === '31-60' ? '#c2410c' : '#dc2626'

export default function ZohoMirrorTab({ user }) {
  const isOwner = String(user?.email || '').toLowerCase().startsWith('mark@') || user?.role === 'owner'
  const [summary, setSummary] = useState(null)
  const [err, setErr] = useState(null)
  const [month, setMonth] = useState(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit' }).format(new Date()))
  const [invoices, setInvoices] = useState([])
  const [payments, setPayments] = useState([])
  const [view, setView] = useState('invoices')
  const [syncing, setSyncing] = useState(false)
  const [toast, setToast] = useState(null)
  const say = m => { setToast(m); setTimeout(() => setToast(null), 3200) }

  const load = useCallback(async () => {
    try {
      const [s, i, p] = await Promise.all([
        apiFetch(`${API_BASE}/api/zoho-mirror/summary`).then(r => r.json()),
        apiFetch(`${API_BASE}/api/zoho-mirror/invoices?month=${month}`).then(r => r.json()),
        apiFetch(`${API_BASE}/api/zoho-mirror/payments?month=${month}`).then(r => r.json()),
      ])
      if (s.error) throw new Error(s.error)
      setSummary(s); setInvoices(i.invoices || []); setPayments(p.payments || []); setErr(null)
    } catch (e) { setErr(e.message) }
  }, [month])
  useEffect(() => { load() }, [load])

  async function syncRecent() {
    if (syncing) return
    setSyncing(true); say('⏳ Pulling the last 3 months from Zoho…')
    try {
      const d = new Date(); const ym = n => { const x = new Date(d.getFullYear(), d.getMonth() - n, 1); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}` }
      const r = await apiFetch(`${API_BASE}/api/zoho-mirror/sync`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ months: [ym(2), ym(1), ym(0)].join(',') }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      say(`✅ Mirrored ${j.invoices} invoices · ${j.payments} payments`)
      load()
    } catch (e) { say(`Sync failed: ${e.message}`) }
    finally { setSyncing(false) }
  }

  const never = summary && !summary.last_sync
  return (
    <div>
      <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest" style={{ color: '#888', fontFamily: "'IBM Plex Mono', monospace" }}>Read-only mirror of Zoho Books</p>
          <p className="text-xs mt-0.5" style={{ color: '#aaa' }}>
            {summary?.last_sync ? `Last pulled ${new Date(summary.last_sync).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} · ${summary.months_mirrored} months · ${summary.invoices_mirrored} invoices` : 'Not synced yet'}
          </p>
        </div>
        {isOwner && (
          <button onClick={syncRecent} disabled={syncing}
            className="text-xs font-bold rounded-lg px-3 py-2"
            style={{ backgroundColor: syncing ? '#f5f3f0' : 'white', color: '#555', border: '1px solid #e0dbd6' }}>
            {syncing ? '⏳ Pulling…' : '↻ Pull last 3 months'}
          </button>
        )}
      </div>

      {err && <p className="text-sm py-3" style={{ color: '#dc2626' }}>{err}</p>}
      {never && (
        <div className="rounded-xl p-4 mb-4 text-sm" style={{ backgroundColor: '#fff7ed', border: '1px solid #fed7aa', color: '#9a3412' }}>
          The mirror hasn't been filled yet. The first import is previewed and confirmed with Mark before anything is written — after that, it refreshes itself nightly.
        </div>
      )}

      {summary && summary.last_sync && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            {[
              ['Open AR', fmt$(summary.ar_total), `${summary.open_count} open invoices`, ORANGE],
              ['Invoiced this month', fmt$(summary.mtd_invoiced), `${summary.mtd_invoice_count} invoices`, '#1a1a1a'],
              ['Collected this month', fmt$(summary.mtd_collected), 'customer payments', '#15803d'],
              ['Past 60 days', fmt$((summary.aging['61-90'] || 0) + (summary.aging['90+'] || 0)), 'needs a call', '#dc2626'],
            ].map(([l, v, n, c]) => (
              <div key={l} className="rounded-xl p-3.5" style={{ backgroundColor: 'white', border: '1px solid #ebebeb' }}>
                <p className="text-[11px] font-semibold" style={{ color: '#888' }}>{l}</p>
                <p className="text-xl font-extrabold" style={{ color: c }}>{v}</p>
                <p className="text-[11px]" style={{ color: '#aaa' }}>{n}</p>
              </div>
            ))}
          </div>

          <div className="rounded-xl p-3.5 mb-4" style={{ backgroundColor: 'white', border: '1px solid #ebebeb' }}>
            <p className="text-xs font-bold mb-2" style={{ color: '#1a1a1a' }}>Aging</p>
            <div className="flex gap-1.5 flex-wrap">
              {BUCKETS.map(b => (
                <span key={b} className="text-xs font-bold px-2.5 py-1 rounded-full" style={{ backgroundColor: '#f5f3f0', color: bucketColor(b) }}>
                  {b}: {fmt$(summary.aging[b])}
                </span>
              ))}
            </div>
          </div>

          <div className="rounded-xl mb-5 overflow-hidden" style={{ backgroundColor: 'white', border: '1px solid #ebebeb' }}>
            <p className="text-xs font-bold px-3.5 py-2.5" style={{ color: '#1a1a1a', borderBottom: '1px solid #f0ece8' }}>Open balance by shop</p>
            {summary.by_shop.length === 0 && <p className="text-sm text-center py-6" style={{ color: '#aaa' }}>Nothing outstanding. 🎉</p>}
            {summary.by_shop.slice(0, 25).map(s => (
              <div key={s.shop} className="flex items-center justify-between gap-3 px-3.5 py-2" style={{ borderBottom: '1px solid #f7f4f0' }}>
                <div className="min-w-0">
                  <p className="text-sm font-semibold truncate" style={{ color: '#1a1a1a' }}>{s.shop}</p>
                  <p className="text-[11px]" style={{ color: '#888' }}>{s.count} open · oldest {s.oldest_days}d</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {s.oldest_days > 60 && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: '#fef2f2', color: '#dc2626' }}>60+ days</span>}
                  <span className="text-sm font-extrabold" style={{ color: ORANGE }}>{fmt$(s.open)}</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <input type="month" value={month} onChange={e => setMonth(e.target.value)}
          className="rounded-lg px-3 py-1.5 text-sm" style={{ border: '1px solid #e0dbd6' }} />
        {[['invoices', `Invoices ${invoices.length}`], ['payments', `Payments ${payments.length}`]].map(([v, l]) => (
          <button key={v} onClick={() => setView(v)} className="text-xs font-bold rounded-full px-3 py-1.5"
            style={view === v ? { backgroundColor: '#1a1a1a', color: 'white' } : { backgroundColor: 'white', border: '1px solid #e0dbd6', color: '#666' }}>{l}</button>
        ))}
      </div>
      <div className="overflow-x-auto rounded-xl" style={{ backgroundColor: 'white', border: '1px solid #ebebeb' }}>
        {view === 'invoices' ? (
          <table className="w-full text-sm" style={{ minWidth: 560 }}>
            <thead><tr style={{ color: '#888', fontSize: 11 }}>
              {['Date', 'Invoice', 'Shop', 'Status', 'Total', 'Balance'].map(h => <th key={h} className="text-left px-3 py-2 font-semibold">{h}</th>)}
            </tr></thead>
            <tbody>
              {invoices.length === 0 && <tr><td colSpan="6" className="text-center py-6" style={{ color: '#aaa' }}>No invoices mirrored for this month.</td></tr>}
              {invoices.map(i => (
                <tr key={i.invoice_id} style={{ borderTop: '1px solid #f7f4f0' }}>
                  <td className="px-3 py-1.5" style={{ color: '#666' }}>{i.date}</td>
                  <td className="px-3 py-1.5 font-mono text-xs">{i.invoice_number}</td>
                  <td className="px-3 py-1.5">{i.customer_name}</td>
                  <td className="px-3 py-1.5"><span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: i.status === 'paid' ? '#e6f4ea' : i.status === 'overdue' ? '#fef2f2' : '#f5f3f0', color: i.status === 'paid' ? '#15803d' : i.status === 'overdue' ? '#dc2626' : '#555' }}>{i.status}</span></td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{fmt$(i.total)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums font-bold" style={{ color: i.balance > 0 ? ORANGE : '#aaa' }}>{fmt$(i.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="w-full text-sm" style={{ minWidth: 560 }}>
            <thead><tr style={{ color: '#888', fontSize: 11 }}>
              {['Date', 'Shop', 'Amount', 'Method', 'Reference', 'Invoices'].map(h => <th key={h} className="text-left px-3 py-2 font-semibold">{h}</th>)}
            </tr></thead>
            <tbody>
              {payments.length === 0 && <tr><td colSpan="6" className="text-center py-6" style={{ color: '#aaa' }}>No payments mirrored for this month.</td></tr>}
              {payments.map(p => (
                <tr key={p.payment_id} style={{ borderTop: '1px solid #f7f4f0' }}>
                  <td className="px-3 py-1.5" style={{ color: '#666' }}>{p.date}</td>
                  <td className="px-3 py-1.5">{p.customer_name}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums font-bold" style={{ color: '#15803d' }}>{fmt$(p.amount)}</td>
                  <td className="px-3 py-1.5" style={{ color: '#666' }}>{p.payment_mode}</td>
                  <td className="px-3 py-1.5 font-mono text-xs" style={{ color: '#666' }}>{p.reference_number}</td>
                  <td className="px-3 py-1.5 font-mono text-xs" style={{ color: '#666' }}>{p.invoice_numbers}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {toast && <div className="fixed bottom-5 left-1/2 -translate-x-1/2 text-white text-xs font-semibold rounded-full px-4 py-2 z-50" style={{ backgroundColor: '#1a1a1a' }}>{toast}</div>}
    </div>
  )
}
