// 🏦 Accounts — Absolute ADAS Books, Phase 1 (2026-09-15). The drift
// number lives here: every account's balance computed by the app next to
// what Zoho Books says. Zoho stays the truth until the number reads $0.00
// for long enough. Also runs the one-time full import (previewed, then
// confirmed by Mark) and the manual syncs.
import { useEffect, useMemo, useState } from 'react'
import { API_BASE, apiFetch } from '../../utils/api.js'
import { Eyebrow, Title, Panel, Row, Notice, Chip, Pill, ORANGE, GREEN, BLUE } from '../ui/ReviewKit.jsx'

const RED = '#b91c1c', AMBER = '#92400e'
const $ = c => `${Number(c) < 0 ? '-' : ''}$${(Math.abs(Number(c || 0)) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const j = async (url, opts) => { const r = await apiFetch(`${API_BASE}${url}`, opts); const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`); return d }
const post = (url, b) => j(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) })
const when = iso => iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'never'
const inp = { border: '1px solid #e0dbd6', outline: 'none', backgroundColor: 'white', borderRadius: 8 }

export default function ArTab({ user }) {
  const [status, setStatus] = useState(null)
  const [accounts, setAccounts] = useState([])
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(null)
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [log, setLog] = useState([])
  const [plan, setPlan] = useState(null)
  const [preview, setPreview] = useState(null)
  const [runsOpen, setRunsOpen] = useState(false)
  const [runs, setRuns] = useState([])
  const isOwner = String(user?.email || '').toLowerCase().startsWith('mark@') || user?.role === 'owner'
  const say = m => setLog(l => [`${new Date().toLocaleTimeString()} ${m}`, ...l].slice(0, 40))

  const load = () => Promise.all([j('/api/ar/status'), j('/api/ar/accounts')]).then(([s, a]) => { setStatus(s); setAccounts(a.accounts || []) }).catch(e => setErr(e.message))
  useEffect(() => { load() }, [])
  const imported = !!status?.mirror?.last_sync
  const last = status?.last_reconcile

  async function run(key, fn) { setBusy(key); setErr(''); try { await fn() } catch (e) { setErr(e.message); say(`✗ ${e.message}`) } finally { setBusy(''); load() } }
  async function loadPlan() { await run('plan', async () => { const p = await j('/api/ar/import/plan'); setPlan(p); say(`Books history starts ${p.first_invoice_date} · ${p.months.length} months · ${p.remaining.length} not mirrored yet`) }) }
  async function doPreview() { await run('preview', async () => { let inv = 0, pay = 0, it = 0, pt = 0; for (const batch of chunks(plan.remaining, 3)) { const r = await post('/api/ar/import/preview', { months: batch }); inv += r.invoices; pay += r.payments; it += r.invoice_total; pt += r.payment_total; say(`preview ${batch.join(', ')}: ${r.invoices} invoices ${$(Math.round(r.invoice_total * 100))} · ${r.payments} payments`) } setPreview({ inv, pay, it, pt }) }) }
  async function doImport() {
    if (!confirm(`Import ${plan.remaining.length} months (${preview.inv} invoices, ${preview.pay} payments) from Zoho Books into the mirror? Zoho is not changed.`)) return
    await run('import', async () => { for (const batch of chunks(plan.remaining, 2)) { const r = await post('/api/ar/import/run', { months: batch }); say(`imported ${batch.join(', ')}: ${r.invoices} invoices · ${r.payments} payments`) } say('✓ full import done'); setPlan(null); setPreview(null) })
    await run('accounts', async () => { const r = await post('/api/ar/sync/accounts'); say(`accounts: ${r.contacts} customers (${r.linked_crm} linked to CRM shops)`) })
    await run('reconcile', async () => { const s = await post('/api/ar/reconcile', { post: true }); say(`drift ${$(s.drift_cents)} · ${s.accounts_with_drift} accounts differ`) })
  }
  const syncAccounts = () => run('accounts', async () => { const r = await post('/api/ar/sync/accounts'); say(`accounts: ${r.contacts} customers · ${r.inserted} new · ${r.linked_crm} linked to CRM`) })
  const syncCn = () => run('cn', async () => { const m = lastMonths(3); const r = await post('/api/ar/sync/credit-notes', { months: m }); say(`credit notes ${m[0]}…${m[2]}: ${r.inserted + r.updated} rows`) })
  const syncAlloc = () => run('alloc', async () => { for (let i = 0; i < 5; i++) { const r = await post('/api/ar/sync/allocations', { limit: 40 }); say(`allocations: fetched ${r.fetched} payments · ${r.pending_after} still to go`); if (!r.pending_after || !r.fetched) break } })
  const doReconcile = () => run('reconcile', async () => { const s = await post('/api/ar/reconcile', { post: true }); say(`drift ${$(s.drift_cents)} · ${s.accounts_with_drift} accounts differ · ${s.mismatched} invoice mismatches · coverage ${s.coverage_pct}%`) })
  const showRuns = async () => { setRunsOpen(o => !o); if (!runs.length) try { setRuns((await j('/api/ar/runs')).runs) } catch (e) { setErr(e.message) } }

  const needle = q.trim().toLowerCase()
  const shown = useMemo(() => needle ? accounts.filter(a => `${a.name} ${a.company} ${a.email}`.toLowerCase().includes(needle)) : accounts, [accounts, needle])
  const totals = useMemo(() => accounts.reduce((s, a) => ({ books: s.books + a.books_outstanding_cents, app: s.app + a.app_balance_cents, drift: s.drift + Math.abs(a.drift_cents), open: s.open + a.open_count }), { books: 0, app: 0, drift: 0, open: 0 }), [accounts])
  const driftTone = !last ? 'plain' : last.drift_cents === 0 && last.mismatched === 0 ? 'green' : last.drift_cents < 10000 ? 'amber' : 'orange'

  return (
    <div className="space-y-4">
      <div><Eyebrow>🏦 Absolute ADAS Books · accounts receivable · shadow mode</Eyebrow><Title sub="Zoho Books is still the truth. This is the app doing the math on its own, next to Zoho, every night.">Accounts</Title></div>
      {err && <Notice tone="red">{err} <button className="underline ml-2" onClick={() => setErr('')}>dismiss</button></Notice>}

      {/* The drift number */}
      <Panel tone={driftTone} title={last ? `${last.drift_cents === 0 && last.mismatched === 0 ? '🟢' : last.drift_cents < 10000 ? '🟡' : '🔴'} Drift ${$(last.drift_cents)}` : '⚪ No reconcile yet'} right={last ? `last run ${when(last.at)} · ${last.by}` : ''}>
        <div className="p-3 grid grid-cols-2 sm:grid-cols-5 gap-3">
          <Stat label="Books says (AR)" value={$(totals.books)} />
          <Stat label="App says (AR)" value={$(totals.app)} color={totals.app === totals.books ? GREEN : AMBER} />
          <Stat label="Our own math (total − paid)" value={$(accounts.reduce((x, a) => x + a.ledger_balance_cents, 0))} sub={last ? `${last.accounts_with_ledger_drift || 0} account${(last.accounts_with_ledger_drift || 0) === 1 ? '' : 's'} differ · ledger drift ${$(last.ledger_drift_cents || 0)}` : ''} color={last && last.ledger_drift_cents ? AMBER : GREEN} />
          <Stat label="Accounts that differ" value={last ? `${last.accounts_with_drift} of ${last.counts?.accounts ?? accounts.length}` : '—'} />
          <Stat label="Invoice mismatches · unapplied" value={last ? `${last.mismatched} · ${last.unmatched}` : '—'} sub={last ? `allocation coverage ${last.coverage_pct}%` : ''} />
        </div>
        {last?.top?.length > 0 && <div className="px-3 pb-2 text-xs" style={{ color: '#555' }}><b>Biggest differences:</b> {last.top.slice(0, 5).map(d => <span key={d.contact_id} className="mr-3">{d.account} <span style={{ color: d.diff_cents > 0 ? AMBER : RED }}>{d.diff_cents > 0 ? '+' : ''}{$(d.diff_cents)}</span></span>)}</div>}
        {last?.ledger_top?.length > 0 && <div className="px-3 pb-2 text-xs" style={{ color: '#555' }}><b>Our math disagrees with Books on:</b> {last.ledger_top.slice(0, 5).map(d => <span key={d.contact_id} className="mr-3">{d.account} <span style={{ color: AMBER }}>{d.diff_cents > 0 ? '+' : ''}{$(d.diff_cents)}</span>{d.credits_cents ? <span style={{ color: '#888' }}> (has credits {$(d.credits_cents)})</span> : null}</span>)}</div>}
        {last?.write_offs?.length > 0 && <div className="px-3 pb-2 text-xs" style={{ color: '#555' }}><b>Written off in Books ({$(last.write_off_cents)}):</b> {last.write_offs.slice(0, 8).map(w => <span key={w.invoice} className="mr-3">{w.invoice} {$(w.cents)}</span>)}</div>}
        {last?.mismatches?.length > 0 && <div className="px-3 pb-2 text-xs" style={{ color: '#555' }}><b>Invoices where payments don't add up:</b> {last.mismatches.slice(0, 5).map(m => <span key={m.invoice} className="mr-3">{m.invoice} (Books {$(m.books_balance_cents)} vs ledger {$(m.ledger_balance_cents)}{m.hint ? ` · ${m.hint}` : ''})</span>)}</div>}
        <div className="px-3 pb-3 flex flex-wrap gap-2">
          <button disabled={!!busy || !imported} onClick={doReconcile} className="text-xs font-bold rounded-lg px-3 py-1.5 text-white" style={{ backgroundColor: ORANGE, opacity: busy || !imported ? .5 : 1 }}>{busy === 'reconcile' ? 'Reconciling…' : '↻ Reconcile now'}</button>
          <button disabled={!!busy || !imported} onClick={syncAccounts} className="text-xs font-bold rounded-lg px-3 py-1.5" style={{ backgroundColor: 'white', color: '#555', border: '1px solid #e0dbd6' }}>{busy === 'accounts' ? '…' : 'Pull accounts'}</button>
          <button disabled={!!busy || !imported} onClick={syncCn} className="text-xs font-bold rounded-lg px-3 py-1.5" style={{ backgroundColor: 'white', color: '#555', border: '1px solid #e0dbd6' }}>{busy === 'cn' ? '…' : 'Pull credit notes'}</button>
          <button disabled={!!busy || !imported} onClick={syncAlloc} className="text-xs font-bold rounded-lg px-3 py-1.5" style={{ backgroundColor: 'white', color: '#555', border: '1px solid #e0dbd6' }}>{busy === 'alloc' ? '…' : 'Pull payment allocations'}</button>
          <button onClick={showRuns} className="text-xs font-bold rounded-lg px-3 py-1.5" style={{ color: BLUE }}>{runsOpen ? 'hide runs' : 'run history'}</button>
          <span className="text-[11px] self-center" style={{ color: '#888' }}>Nightly after 8pm PT: accounts, credit notes, allocations, reconcile, then the drift posts to Mark's alerts chat.</span>
        </div>
        {runsOpen && <div className="px-3 pb-3 text-[11px] space-y-0.5" style={{ color: '#555' }}>{runs.map(r => <div key={r.id}>{when(r.started)} · <b>{r.kind}</b> · {r.ok ? '✓' : '✗ ' + r.error} · {r.kind === 'reconcile' ? `drift ${$(r.drift_cents)} · ${r.mismatched} mismatched` : JSON.stringify(r.counts).slice(0, 120)} · {r.by}</div>)}{!runs.length && <div>No runs yet.</div>}</div>}
      </Panel>

      {/* First import */}
      {!imported && (
        <Panel tone="blue" title="1️⃣ First import · every invoice and payment in Zoho Books" right="preview first, then Mark confirms">
          <div className="p-3 space-y-2 text-sm" style={{ color: '#444' }}>
            <div>The mirror is empty. This pulls the full history read-only. Nothing in Zoho changes.</div>
            {!plan && <button disabled={!!busy} onClick={loadPlan} className="rounded-lg px-3 py-1.5 text-xs font-bold text-white" style={{ backgroundColor: BLUE }}>{busy === 'plan' ? '…' : 'Find the history'}</button>}
            {plan && <div className="text-xs">First invoice <b>{plan.first_invoice_date}</b> · <b>{plan.remaining.length}</b> months to import ({plan.remaining[0]} → {plan.remaining[plan.remaining.length - 1]})</div>}
            {plan && !preview && <button disabled={!!busy} onClick={doPreview} className="rounded-lg px-3 py-1.5 text-xs font-bold text-white" style={{ backgroundColor: BLUE }}>{busy === 'preview' ? 'Counting…' : 'Preview (no writes)'}</button>}
            {preview && <div className="rounded-lg p-2 text-xs" style={{ backgroundColor: '#eff6ff' }}><b>{preview.inv}</b> invoices totaling <b>{$(Math.round(preview.it * 100))}</b> · <b>{preview.pay}</b> payments totaling <b>{$(Math.round(preview.pt * 100))}</b></div>}
            {preview && (isOwner ? <button disabled={!!busy} onClick={doImport} className="rounded-lg px-4 py-2 text-sm font-bold text-white" style={{ backgroundColor: GREEN }}>{busy === 'import' ? 'Importing…' : '✅ Confirm import'}</button> : <Notice tone="amber">Only Mark can confirm the first import.</Notice>)}
          </div>
        </Panel>
      )}
      {log.length > 0 && <div className="rounded-lg px-3 py-2 text-[11px] space-y-0.5" style={{ backgroundColor: '#1a1a1a', color: '#d4d4d4', fontFamily: 'IBM Plex Mono, monospace' }}>{log.slice(0, 12).map((l, i) => <div key={i}>{l}</div>)}</div>}

      {/* Accounts */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <Eyebrow>{accounts.length} accounts · {totals.open} open invoices · {shown.length} shown</Eyebrow>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search accounts" className="px-3 py-1.5 text-sm w-64 max-w-full" style={inp} />
      </div>
      <div className="rounded-xl overflow-hidden" style={{ border: '1.5px solid #e8e4e0', backgroundColor: 'white' }}>
        <div className="hidden sm:grid px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider" style={{ gridTemplateColumns: '2fr 1fr 1fr 1fr 2fr 0.7fr', color: '#888', backgroundColor: '#f8f6f4', fontFamily: 'IBM Plex Mono, monospace' }}><span>Account</span><span className="text-right">Books</span><span className="text-right">App</span><span className="text-right">Drift</span><span>Aging</span><span className="text-right">Open</span></div>
        {shown.slice(0, 300).map(a => (
          <button key={a.id} onClick={() => setSel(a)} className="w-full text-left grid px-3 py-2 text-sm items-center gap-2" style={{ gridTemplateColumns: '2fr 1fr 1fr 1fr 2fr 0.7fr', borderTop: '1px solid #f1f5f9', backgroundColor: a.drift_cents ? '#fffbeb' : 'white' }}>
            <span className="min-w-0"><span className="font-semibold truncate block" style={{ color: '#1a1a1a' }}>{a.name}</span><span className="text-[10px]" style={{ color: '#888' }}>{a.crm_shop_id ? 'CRM ✓' : a.retail_id ? 'retail ✓' : 'not linked'}{a.terms ? ` · ${a.terms}` : ''}{a.last_payment ? ` · paid ${a.last_payment}` : ''}</span></span>
            <span className="text-right tabular-nums">{$(a.books_outstanding_cents)}</span>
            <span className="text-right tabular-nums font-semibold" style={{ color: a.drift_cents ? AMBER : '#1a1a1a' }}>{$(a.app_balance_cents)}</span>
            <span className="text-right tabular-nums font-bold" style={{ color: a.drift_cents ? RED : GREEN }}>{a.drift_cents ? `${a.drift_cents > 0 ? '+' : ''}${$(a.drift_cents)}` : '✓'}</span>
            <span><AgingBar aging={a.aging} /></span>
            <span className="text-right tabular-nums" style={{ color: '#666' }}>{a.open_count}</span>
          </button>
        ))}
        {!shown.length && <div className="px-3 py-6 text-center text-sm" style={{ color: '#999' }}>{imported ? 'No accounts pulled yet — tap "Pull accounts".' : 'Run the first import.'}</div>}
      </div>
      {sel && <AccountPanel account={sel} onClose={() => setSel(null)} />}
    </div>
  )
}
const Stat = ({ label, value, sub, color = '#1a1a1a' }) => <div><Eyebrow>{label}</Eyebrow><div className="font-extrabold text-lg tabular-nums" style={{ color }}>{value}</div>{sub && <div className="text-[10px]" style={{ color: '#888' }}>{sub}</div>}</div>
function AgingBar({ aging }) {
  if (!aging) return <span className="text-[10px]" style={{ color: '#bbb' }}>—</span>
  const tot = Object.values(aging).reduce((s, v) => s + v, 0); if (!tot) return <span className="text-[10px]" style={{ color: '#bbb' }}>paid up</span>
  const C = { current: GREEN, d30: '#84cc16', d60: '#f59e0b', d90: '#f97316', d90plus: RED }
  return <div className="flex h-3 rounded overflow-hidden w-full" title={Object.entries(aging).map(([k, v]) => `${k}: ${$(v)}`).join(' · ')}>{Object.entries(aging).map(([k, v]) => v > 0 && <span key={k} style={{ width: `${(v / tot) * 100}%`, backgroundColor: C[k] }} />)}</div>
}
function AccountPanel({ account, onClose }) {
  const [d, setD] = useState(null); const [err, setErr] = useState('')
  useEffect(() => { j(`/api/ar/accounts/${account.contact_id}`).then(setD).catch(e => setErr(e.message)) }, [account.contact_id])
  const a = d?.account || account
  return (
    <div className="fixed inset-0 z-[70] flex justify-end" style={{ backgroundColor: 'rgba(0,0,0,.35)' }} onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="h-full w-full sm:max-w-[560px] overflow-y-auto" style={{ backgroundColor: '#f5f3f0', boxShadow: '-8px 0 24px rgba(0,0,0,.15)' }}>
        <div className="sticky top-0 z-10 px-4 py-3 flex items-start justify-between gap-2" style={{ backgroundColor: 'rgba(245,243,240,.96)', backdropFilter: 'blur(6px)', borderBottom: '1px solid #e8e4e0' }}>
          <div><Eyebrow>🏦 Account · Books id {a.contact_id}</Eyebrow><div className="font-bold text-lg" style={{ color: '#1a1a1a' }}>{a.name}</div><div className="text-xs" style={{ color: '#666' }}>{[a.email, a.phone, a.terms].filter(Boolean).join(' · ')}</div></div>
          <button onClick={onClose} className="text-2xl leading-none" style={{ color: '#888' }}>×</button>
        </div>
        <div className="p-4 space-y-3">
          {err && <Notice tone="red">{err}</Notice>}
          <div className="grid grid-cols-3 gap-2"><Stat label="Books" value={$(a.books_outstanding_cents)} /><Stat label="App" value={$(a.app_balance_cents)} color={a.drift_cents ? AMBER : GREEN} /><Stat label="Ledger (total − paid)" value={$(a.ledger_balance_cents)} /></div>
          {a.unused_credits_cents > 0 && <Notice tone="amber">Unused credits in Books: {$(a.unused_credits_cents)}</Notice>}
          <Panel tone="plain" title={`Invoices · ${d?.invoices?.length ?? '…'}`}>
            {(d?.invoices || []).map(i => <Row key={i.invoice_id} left={<span><b>{i.number}</b> <span className="text-xs" style={{ color: '#888' }}>{i.date} · {i.status}{i.reference ? ` · ${i.reference}` : ''}</span></span>} right={<span className="text-right"><div>{$(i.total_cents)}</div>{i.balance_cents > 0 && <div className="text-[10px]" style={{ color: RED }}>due {$(i.balance_cents)}</div>}{i.applied_cents > 0 && i.total_cents - i.applied_cents !== i.balance_cents && <div className="text-[10px]" style={{ color: AMBER }}>paid {$(i.applied_cents)} ≠</div>}</span>} />)}
          </Panel>
          <Panel tone="green" title={`Payments · ${d?.payments?.length ?? '…'}`}>
            {(d?.payments || []).map(p => <Row key={p.payment_id} left={<span><b>{p.number || p.payment_id}</b> <span className="text-xs" style={{ color: '#888' }}>{p.date} · {p.mode}{p.invoices ? ` · ${p.invoices}` : ''}{p.allocated ? '' : ' · allocation not pulled yet'}</span></span>} right={$(p.amount_cents)} />)}
            {(d?.unapplied || []).map((u, i) => <Row key={i} left={<span style={{ color: AMBER }}>Unapplied payment {u.date}</span>} right={$(u.amount_cents)} />)}
          </Panel>
          {(d?.credit_notes || []).length > 0 && <Panel tone="amber" title={`Credit notes · ${d.credit_notes.length}`}>{d.credit_notes.map(c => <Row key={c.id} left={<span><b>{c.number}</b> <span className="text-xs" style={{ color: '#888' }}>{c.date} · {c.status}</span></span>} right={$(c.total_cents)} />)}</Panel>}
        </div>
      </div>
    </div>
  )
}
function chunks(a, n) { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o }
function lastMonths(n) { const out = []; const d = new Date(); for (let i = n - 1; i >= 0; i--) { const x = new Date(d.getFullYear(), d.getMonth() - i, 1); out.push(`${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`) } return out }
