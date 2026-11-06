import { useState, useEffect, useCallback } from 'react'
import { API_BASE, portalFetch, getPortalToken } from '../utils/portal'
import { VinDecodeButton } from './ui/VinDecode.jsx'
import { BRAND, BrandBar, PublicFooter } from '../lib/brand.jsx'

const ORANGE = BRAND.orange

function fmt(n) { return `$${Number(n || 0).toFixed(2)}` }

function fmtBig(n) {
  return `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function useCountUp(value, ms = 1100) {
  const [n, setN] = useState(0)
  useEffect(() => {
    const target = Number(value) || 0
    const t0 = performance.now()
    let raf
    const tick = now => {
      const p = Math.min(1, (now - t0) / ms)
      setN(target * (1 - Math.pow(1 - p, 3)))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value, ms])
  return n
}

function DiscountRing({ pct }) {
  const p = Math.max(0, Math.min(100, Number(pct) || 0))
  const r = 38
  const c = 2 * Math.PI * r
  return (
    <div className="relative w-[118px] h-[118px] flex-shrink-0">
      <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
        <circle cx="50" cy="50" r={r} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="7" />
        <circle cx="50" cy="50" r={r} fill="none" stroke="#CD4419" strokeWidth="7"
          strokeLinecap="round" strokeDasharray={`${(p / 100) * c} ${c}`}
          style={{ filter: 'drop-shadow(0 0 10px rgba(205,68,25,0.85))' }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-extrabold text-white leading-none tracking-tight">{p}%</span>
        <span className="text-[9px] font-extrabold tracking-[0.18em] uppercase mt-1" style={{ color: '#F2A07A' }}>off list</span>
      </div>
    </div>
  )
}

function SavingsHero({ savings, shopName }) {
  const saved = useCountUp(savings?.saved || 0)
  const list = Number(savings?.list || 0)
  const cost = Number(savings?.cost || 0)
  const jobs = savings?.jobs || 0
  const pct = Number(savings?.discount_pct || 0)
  return (
    <div className="mb-5 overflow-hidden rounded-2xl relative"
      style={{
        background: 'linear-gradient(155deg, #1c1410 0%, #0A0A0A 48%, #16110e 100%)',
        border: '1px solid rgba(205,68,25,0.38)',
        boxShadow: '0 22px 50px rgba(10,10,10,0.28)',
        animation: 'portal-savings-rise 0.55s ease-out',
      }}>
      <div className="absolute -top-16 -right-10 w-64 h-64 rounded-full pointer-events-none"
        style={{
          background: 'radial-gradient(circle, rgba(205,68,25,0.45) 0%, transparent 70%)',
          animation: 'portal-savings-glow 4.5s ease-in-out infinite',
        }} />
      <div className="absolute -bottom-20 -left-10 w-56 h-56 rounded-full pointer-events-none"
        style={{ background: 'radial-gradient(circle, rgba(242,160,122,0.14) 0%, transparent 70%)' }} />

      <div className="relative px-5 sm:px-7 pt-5 pb-4 flex flex-col sm:flex-row sm:items-center gap-5">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-extrabold tracking-[0.18em] uppercase">
            <span className="text-white">The Absolute </span>
            <span style={{ color: BRAND.orange }}>Advantage</span>
          </p>
          <p className="text-xs mt-1 truncate" style={{ color: 'rgba(255,255,255,0.55)' }}>
            {shopName ? `${shopName} · ` : ''}your discount off our list price
          </p>
          <p className="font-extrabold tracking-tight mt-2 leading-none text-white"
            style={{ fontSize: 'clamp(2.4rem, 8vw, 3.6rem)', fontVariantNumeric: 'tabular-nums' }}>
            {fmtBig(saved)}
          </p>
          <p className="text-sm font-semibold mt-2" style={{ color: '#F2A07A' }}>
            What you keep because you partner with us
          </p>
        </div>
        <DiscountRing pct={pct} />
      </div>

      <div className="relative grid grid-cols-3 border-t" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
        {[
          { label: 'List price', value: fmtBig(list) },
          { label: 'You pay', value: fmtBig(cost) },
          { label: 'Jobs', value: String(jobs) },
        ].map((cell, i) => (
          <div key={cell.label} className="px-4 py-3 text-center"
            style={{ borderLeft: i ? '1px solid rgba(255,255,255,0.08)' : 'none' }}>
            <p className="text-[10px] font-bold tracking-widest uppercase" style={{ color: 'rgba(255,255,255,0.4)' }}>{cell.label}</p>
            <p className="text-sm sm:text-base font-extrabold text-white mt-0.5 tabular-nums">{cell.value}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

const STATUS_BADGES = {
  draft:    { bg: '#e8e4e0', color: '#0A0A0A', label: 'Draft' },
  sent:     { bg: '#f5e8e3', color: '#CD4419', label: 'Awaiting Payment' },
  paid:     { bg: '#dcfce7', color: '#15803d', label: 'Paid ✓' },
  overdue:  { bg: '#fee2e2', color: '#b91c1c', label: 'Overdue' },
  void:     { bg: '#e8e4e0', color: '#888888', label: 'Void' },
}

const TYPE_BADGES = {
  insurance: { bg: '#f5f3f0', color: '#0A0A0A', label: '📋 Insurance' },
  shop:      { bg: '#f5e8e3', color: '#CD4419', label: '🏪 Shop' },
  standard:  { bg: '#f5f3f0', color: '#555555', label: '📄 Invoice' },
}

const STAGE = {
  scrubbed: { bg: '#f5f3f0', color: '#555', label: 'Scrubbed' },
  quote_requested: { bg: BRAND.quoteSoft, color: BRAND.quote, label: 'Quote requested' },
  quoted: { bg: BRAND.quoteSoft, color: BRAND.quote, label: 'Quote sent' },
  requested: { bg: '#fff7f5', color: BRAND.orange, label: 'Job requested' },
  job: { bg: '#dcfce7', color: '#15803d', label: 'On the board' },
  invoiced: { bg: '#dcfce7', color: '#15803d', label: 'Invoiced' },
}

export default function PortalScreen({ shop, onLogout }) {
  const [tab, setTab] = useState('jobs')
  const [invoices, setInvoices] = useState([])
  const [myJobs, setMyJobs] = useState([])
  const [scrubs, setScrubs] = useState([])
  const [estimates, setEstimates] = useState([])
  const [openCar, setOpenCar] = useState(null)
  const [loading, setLoading] = useState(true)
  const [payModal, setPayModal] = useState(null)
  const [submitJobOpen, setSubmitJobOpen] = useState(false)
  const [savings, setSavings] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [inv, jobs, cars, est, sav] = await Promise.all([
        portalFetch(`${API_BASE}/api/portal/invoices`).then(r => r.json()),
        portalFetch(`${API_BASE}/api/portal/my-jobs`).then(r => r.json()).catch(() => []),
        portalFetch(`${API_BASE}/api/portal/scrubs`).then(r => r.json()).catch(() => ({ scrubs: [] })),
        portalFetch(`${API_BASE}/api/portal/estimates`).then(r => r.json()).catch(() => ({ estimates: [] })),
        portalFetch(`${API_BASE}/api/portal/savings`).then(r => r.json()).catch(() => null),
      ])
      setInvoices(Array.isArray(inv) ? inv : [])
      setMyJobs(Array.isArray(jobs) ? jobs : [])
      setScrubs(Array.isArray(cars.scrubs) ? cars.scrubs : [])
      setEstimates(Array.isArray(est.estimates) ? est.estimates : [])
      setSavings(sav && sav.saved != null ? sav : null)
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  function downloadPdf(inv) {
    const token = getPortalToken()
    window.open(`${API_BASE}/api/portal/invoices/${inv.id}/pdf?portal_token=${encodeURIComponent(token)}`, '_blank')
  }

  // Group + filter
  const unpaid = invoices.filter(i => ['sent', 'overdue'].includes(i.status) && (i.balance_due || i.total) > 0)
  const paid = invoices.filter(i => i.status === 'paid')
  const insurance = invoices.filter(i => i.invoice_type === 'insurance')
  const shopInv = invoices.filter(i => i.invoice_type === 'shop')

  const shown = tab === 'unpaid' ? unpaid
    : tab === 'paid' ? paid
    : tab === 'shop' ? shopInv
    : tab === 'all' ? invoices
    : []

  const totalOutstanding = unpaid.reduce((s, i) => s + Number(i.balance_due || i.total || 0), 0)

  return (
    <div className="min-h-screen" style={{ backgroundColor: BRAND.cream }}>
      <BrandBar />
      <header style={{ backgroundColor: BRAND.white, borderBottom: `1px solid ${BRAND.line}` }}>
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate" style={{ color: BRAND.ink }}>{shop.shop_name}</p>
            <p className="text-xs text-gray-500 truncate">
              {shop.user?.name || shop.user?.username || shop.email || ''}
              {shop.user?.username && shop.user?.name ? ` · ${shop.user.username}` : ''}
            </p>
          </div>
          <button onClick={onLogout}
            className="text-xs px-3 py-1.5 rounded-lg font-semibold flex-shrink-0"
            style={{ backgroundColor: BRAND.cream, color: '#555' }}>
            Log Out
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
        <SavingsHero savings={savings} shopName={shop.shop_name} />

        <div className="mb-5 grid grid-cols-2 gap-3">
          <div className="rounded-xl px-4 py-3 bg-white" style={{ border: `1px solid ${unpaid.length ? '#fcd5c5' : BRAND.line}` }}>
            <p className="text-[10px] font-extrabold tracking-widest uppercase" style={{ color: unpaid.length ? ORANGE : BRAND.muted }}>Outstanding</p>
            <p className="text-lg font-extrabold mt-0.5 tabular-nums" style={{ color: unpaid.length ? ORANGE : BRAND.ink }}>{fmtBig(totalOutstanding)}</p>
            <p className="text-[11px] text-gray-500">{unpaid.length} unpaid</p>
          </div>
          <div className="rounded-xl px-4 py-3 bg-white" style={{ border: `1px solid ${BRAND.line}` }}>
            <p className="text-[10px] font-extrabold tracking-widest uppercase" style={{ color: BRAND.muted }}>Paid with us</p>
            <p className="text-lg font-extrabold mt-0.5 tabular-nums" style={{ color: BRAND.ink }}>{paid.length}</p>
            <p className="text-[11px] text-gray-500">{fmtBig(paid.reduce((s, i) => s + Number(i.total || 0), 0))} lifetime</p>
          </div>
        </div>

        <div className="mb-6">
          <p className="text-[10px] font-extrabold tracking-[0.18em] uppercase mb-2" style={{ color: BRAND.muted }}>Job status</p>
          <MyJobsList jobs={myJobs} compact />
        </div>

        <div className="rounded-xl p-4 mb-6 flex items-center justify-between gap-3 flex-wrap"
          style={{ backgroundColor: BRAND.orangeSoft, border: `1px solid #fcd5c5` }}>
          <div>
            <p className="text-sm font-semibold" style={{ color: ORANGE }}>Need a calibration?</p>
            <p className="text-xs text-gray-600 mt-0.5">
              Open a car for Instant quote or Request job — or add one we do not have yet.
            </p>
          </div>
          <button onClick={() => setSubmitJobOpen(true)}
            className="text-xs px-4 py-2 rounded-lg font-semibold text-white flex-shrink-0"
            style={{ backgroundColor: ORANGE }}>
            + Request Job
          </button>
        </div>

        {/* Quick pay all */}
        {unpaid.length > 0 && (
          <div className="rounded-xl p-4 mb-6 flex items-center justify-between gap-3 flex-wrap"
            style={{ backgroundColor: '#fff7f5', border: `1px solid #fcd5c5` }}>
            <div>
              <p className="text-sm font-semibold" style={{ color: ORANGE }}>
                💳 Ready to pay?
              </p>
              <p className="text-xs text-gray-600 mt-0.5">
                Click any invoice below to pay it individually, or download a PDF.
              </p>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1.5 flex-wrap mb-4">
          {[
            { id: 'jobs', label: `Jobs (${myJobs.length})` },
            { id: 'cars', label: `Cars (${scrubs.length})` },
            { id: 'estimates', label: `Estimates (${estimates.length})` },
            { id: 'unpaid', label: `Unpaid (${unpaid.length})` },
            { id: 'paid', label: `Paid (${paid.length})` },
            { id: 'shop', label: `Shop invoices (${shopInv.length})` },
          ].map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className="text-xs px-3 py-1.5 rounded-full font-semibold"
              style={{
                backgroundColor: tab === t.id ? ORANGE : '#f5f3f0',
                color: tab === t.id ? 'white' : '#555',
              }}>
              {t.label}
            </button>
          ))}
        </div>

        {loading && (tab === 'cars' || tab === 'estimates' || tab === 'jobs') && (
          <div className="py-16 text-center text-gray-400 text-sm">Loading…</div>
        )}
        {tab === 'cars' && !loading && (
          <CarsList scrubs={scrubs} jobs={myJobs} onOpen={setOpenCar} />
        )}
        {tab === 'estimates' && !loading && (
          <EstimatesList estimates={estimates} jobs={myJobs} />
        )}
        {tab === 'jobs' && !loading && (
          <MyJobsList jobs={myJobs} />
        )}

        {tab !== 'jobs' && tab !== 'cars' && tab !== 'estimates' && (loading ? (
          <div className="py-16 text-center text-gray-400 text-sm">Loading…</div>
        ) : shown.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-5xl mb-2">📄</p>
            <p className="text-gray-400 text-sm">No invoices in this view.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {shown.map(inv => {
              const status = STATUS_BADGES[inv.status] || STATUS_BADGES.draft
              const type = TYPE_BADGES[inv.invoice_type] || TYPE_BADGES.standard
              const balance = Number(inv.balance_due ?? inv.total) || 0
                  const canPay = ['sent', 'overdue', 'draft'].includes(inv.status) && balance > 0 && inv.invoice_type !== 'insurance'
              return (
                <div key={inv.id} className="rounded-xl bg-white border shadow-sm p-4"
                  style={{ borderColor: inv.status === 'overdue' ? '#fecaca' : '#f0ece8' }}>
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="text-sm font-bold" style={{ color: ORANGE }}>
                          {inv.invoice_number}
                        </span>
                        <span className="text-xs font-medium px-2 py-0.5 rounded-full"
                          style={{ backgroundColor: type.bg, color: type.color }}>
                          {type.label}
                        </span>
                        <span className="text-xs font-medium px-2 py-0.5 rounded-full"
                          style={{ backgroundColor: status.bg, color: status.color }}>
                          {status.label}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500">
                        Date: {inv.date || '—'}
                        {inv.due_date && ` · Due: ${inv.due_date}`}
                        {inv.po_number && ` · PO# ${inv.po_number}`}
                      </p>
                      <p className="text-xs text-gray-400 mt-1">
                        {(inv.line_items || []).length} line item{(inv.line_items || []).length !== 1 ? 's' : ''}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-lg font-bold" style={{ color: '#1a1a1a' }}>{fmt(inv.total)}</p>
                      {inv.amount_paid > 0 && (
                        <p className="text-xs text-gray-500">
                          Paid: <span style={{ color: '#16a34a' }}>{fmt(inv.amount_paid)}</span>
                        </p>
                      )}
                      {balance > 0 && inv.status !== 'paid' && (
                        <p className="text-xs font-semibold" style={{ color: ORANGE }}>
                          Balance: {fmt(balance)}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2 mt-3 pt-3 border-t flex-wrap" style={{ borderColor: '#f7f4f1' }}>
                    <button onClick={() => downloadPdf(inv)}
                      className="text-xs px-3 py-1.5 rounded-md font-semibold"
                      style={{ backgroundColor: '#f5f3f0', color: '#555' }}>
                      📄 Download PDF
                    </button>
                    {canPay && (
                      <button onClick={() => setPayModal(inv)}
                        className="text-xs px-3 py-1.5 rounded-md font-semibold text-white ml-auto"
                        style={{ backgroundColor: ORANGE }}>
                        💳 Pay {fmt(balance)}
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        ))}
      </main>

      {payModal && (
        <PayInvoiceModal invoice={payModal}
          onClose={() => setPayModal(null)}
          onPaid={() => { setPayModal(null); load() }} />
      )}
      {submitJobOpen && (
        <SubmitJobModal shop={shop}
          onClose={() => setSubmitJobOpen(false)}
          onSubmitted={() => { setSubmitJobOpen(false); load() }} />
      )}
      {openCar && (
        <CarDetail id={openCar} onClose={() => setOpenCar(null)} onDone={() => { setOpenCar(null); load() }} />
      )}
      <PublicFooter />
    </div>
  )
}

function matchJob(jobs, { ro, vin, quote }) {
  const roK = String(ro || '').replace(/\s/g, '').toLowerCase()
  const vinK = String(vin || '').replace(/\s/g, '').slice(-8).toLowerCase()
  const qK = String(quote || '').toLowerCase()
  return (jobs || []).find(j => {
    if (qK && String(j.quote_number || '').toLowerCase() === qK) return true
    if (roK && String(j.ro_number || '').replace(/\s/g, '').toLowerCase() === roK) return true
    if (vinK && String(j.vehicle?.vin || '').replace(/\s/g, '').slice(-8).toLowerCase() === vinK) return true
    return false
  }) || null
}

function CarsList({ scrubs, jobs, onOpen }) {
  if (!scrubs.length) {
    return (
      <div className="py-16 text-center">
        <p className="text-5xl mb-2">🚗</p>
        <p className="text-gray-400 text-sm">No cars on file yet. CCC estimates for this shop land here.</p>
      </div>
    )
  }
  return (
    <div className="space-y-2">
      {scrubs.map(s => {
        const job = matchJob(jobs, { ro: s.ro, vin: s.vin, quote: s.quoteNumber })
        const st = job ? (STAGE_STYLE[job.stage] || STAGE_STYLE.scheduling) : (STAGE[s.stage] || STAGE.scrubbed)
        const label = job?.label || st.label
        return (
          <button key={s.id} type="button" onClick={() => onOpen(s.id)}
            className="w-full text-left rounded-xl bg-white border shadow-sm p-4"
            style={{ borderColor: job?.live ? ORANGE : (s.stage === 'quoted' ? BRAND.quoteLine : '#f0ece8') }}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-bold truncate" style={{ color: BRAND.ink }}>{s.vehicle || 'Vehicle'}</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {s.ro ? `RO ${s.ro}` : ''}{s.ro && s.insurer ? ' · ' : ''}{s.insurer || ''}
                  {s.vin ? ` · ${s.vin.slice(-6)}` : ''}
                </p>
                {job?.message && <p className="text-xs font-semibold mt-1" style={{ color: job.live ? ORANGE : '#555' }}>{job.message}</p>}
                {!job && (
                  <p className="text-xs mt-1" style={{ color: '#555' }}>
                    {s.requiredCount ? `${s.requiredCount} required` : 'Nothing required'}
                    {s.required?.length ? ` — ${s.required.slice(0, 3).join(', ')}${s.required.length > 3 ? '…' : ''}` : ''}
                  </p>
                )}
                {job && <JobPipe stage={job.stage} />}
              </div>
              <span className="text-[11px] font-bold px-2 py-1 rounded-full flex-shrink-0"
                style={{ backgroundColor: st.bg, color: st.fg || st.color }}>{job?.live ? '● ' : ''}{label}</span>
            </div>
          </button>
        )
      })}
    </div>
  )
}

function EstimatesList({ estimates, jobs }) {
  if (!estimates.length) {
    return (
      <div className="py-16 text-center">
        <p className="text-gray-400 text-sm">No estimates yet. Instant quote on a car puts one here.</p>
      </div>
    )
  }
  return (
    <div className="space-y-2">
      {estimates.map(e => {
        const job = matchJob(jobs, { ro: e.ro, vin: e.vin, quote: e.number })
        const st = job ? (STAGE_STYLE[job.stage] || STAGE_STYLE.scheduling) : null
        return (
          <div key={e.id} className="rounded-xl bg-white border shadow-sm p-4"
            style={{ borderColor: job?.live ? ORANGE : '#f0ece8' }}>
            <div className="flex justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-bold" style={{ color: BRAND.quote }}>{e.number || 'Estimate'}</p>
                <p className="text-xs text-gray-500 mt-0.5">{e.vehicle || '—'}{e.ro ? ` · RO ${e.ro}` : ''}</p>
                {job?.message && <p className="text-xs font-semibold mt-1" style={{ color: job.live ? ORANGE : '#555' }}>{job.message}</p>}
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-sm font-extrabold tabular-nums" style={{ color: BRAND.ink }}>{e.total ? fmt(e.total) : ''}</p>
                {e.saved > 0 && (
                  <p className="inline-block text-[11px] font-extrabold px-2 py-0.5 rounded-full mt-1"
                    style={{ backgroundColor: '#dcfce7', color: '#15803d' }}>
                    Advantage {fmt(e.saved)}
                  </p>
                )}
                <p className="text-[11px] font-extrabold px-2 py-0.5 rounded-full mt-1"
                  style={{ backgroundColor: st?.bg || '#f5f3f0', color: st?.fg || '#888' }}>
                  {job ? `${job.live ? '● ' : ''}${job.label}` : (e.status || '')}
                </p>
              </div>
            </div>
            {job && <JobPipe stage={job.stage} />}
          </div>
        )
      })}
    </div>
  )
}

function CarDetail({ id, onClose, onDone }) {
  const [car, setCar] = useState(null)
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  useEffect(() => {
    portalFetch(`${API_BASE}/api/portal/scrubs/${id}`)
      .then(r => r.json())
      .then(d => { if (d.error) setErr(d.error); else setCar(d) })
      .catch(e => setErr(e.message))
  }, [id])

  async function act(kind) {
    setBusy(kind); setErr(''); setMsg('')
    try {
      const path = kind === 'quote' ? 'instant-quote' : 'request-job'
      const r = await portalFetch(`${API_BASE}/api/portal/scrubs/${id}/${path}`, { method: 'POST' })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Failed')
      setMsg(d.message || 'Done')
      if (d.scrub) setCar(d.scrub)
      setTimeout(onDone, 900)
    } catch (e) { setErr(e.message) }
    finally { setBusy('') }
  }

  const st = STAGE[car?.stage] || STAGE.scrubbed
  const quoted = car?.stage === 'quoted' || !!car?.quoteNumber
  const onBoard = ['requested', 'job', 'invoiced'].includes(car?.stage || '')

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-xl shadow-xl max-w-lg w-full max-h-[92vh] overflow-y-auto">
        <div className="px-5 py-4 border-b sticky top-0 bg-white flex justify-between items-center" style={{ borderColor: '#f0ece8' }}>
          <div>
            <h2 className="text-lg font-bold">{car?.vehicle || 'Car'}</h2>
            <p className="text-xs text-gray-500">{car?.ro ? `RO ${car.ro}` : ''}{car?.insurer ? ` · ${car.insurer}` : ''}</p>
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 text-xl px-2">×</button>
        </div>
        <div className="p-5 space-y-4">
          {!car && !err && <p className="text-sm text-gray-400">Loading…</p>}
          {car && (
            <>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[11px] font-bold px-2 py-1 rounded-full" style={{ backgroundColor: st.bg, color: st.color }}>{st.label}</span>
                {car.quoteNumber && <span className="text-xs font-semibold" style={{ color: BRAND.quote }}>Quote {car.quoteNumber}</span>}
                {car.vin && <span className="text-xs font-mono text-gray-400">{car.vin}</span>}
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1">Required</p>
                {car.required?.length
                  ? <ul className="text-sm space-y-1">{car.required.map(n => <li key={n}>• {n}</li>)}</ul>
                  : <p className="text-sm text-gray-400">Nothing required on this estimate.</p>}
              </div>
              {car.notRequired?.length > 0 && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1">Not required</p>
                  <p className="text-xs text-gray-500">{car.notRequired.join(', ')}</p>
                </div>
              )}
              {msg && <p className="text-sm font-semibold" style={{ color: BRAND.green }}>{msg}</p>}
              {err && <p className="text-sm" style={{ color: BRAND.red }}>{err}</p>}
              <div className="grid grid-cols-2 gap-2 pt-1">
                <button type="button" disabled={!!busy || quoted}
                  onClick={() => act('quote')}
                  className="py-3 rounded-xl text-sm font-bold text-white"
                  style={{ backgroundColor: BRAND.quote, opacity: busy || quoted ? 0.45 : 1 }}>
                  {busy === 'quote' ? '…' : quoted ? 'Quote sent' : 'Instant quote'}
                </button>
                <button type="button" disabled={!!busy || onBoard}
                  onClick={() => act('job')}
                  className="py-3 rounded-xl text-sm font-bold text-white"
                  style={{ backgroundColor: BRAND.orange, opacity: busy || onBoard ? 0.45 : 1 }}>
                  {busy === 'job' ? '…' : onBoard ? 'On the board' : 'Request job'}
                </button>
              </div>
            </>
          )}
          {err && !car && <p className="text-sm" style={{ color: BRAND.red }}>{err}</p>}
        </div>
      </div>
    </div>
  )
}

function PayInvoiceModal({ invoice, onClose, onPaid }) {
  const balance = Number(invoice.balance_due ?? invoice.total) || 0
  const [method, setMethod] = useState('ACH / Bank Transfer')
  const [amount, setAmount] = useState(String(balance))
  const [reference, setReference] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [stripeOn, setStripeOn] = useState(false)

  useEffect(() => {
    fetch(`${API_BASE}/api/portal/stripe/status`)
      .then(r => r.json())
      .then(d => setStripeOn(!!d.configured))
      .catch(() => {})
  }, [])

  async function startStripe(payMethod) {
    setSaving(true)
    setError('')
    try {
      const r = await portalFetch(`${API_BASE}/api/portal/invoices/${invoice.id}/stripe-checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: payMethod }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || 'Failed')
      window.location.href = data.url
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function submit(e) {
    e.preventDefault()
    const amt = Number(amount)
    if (!amt || amt <= 0) { setError('Enter a valid amount'); return }
    setSaving(true)
    setError('')
    try {
      const r = await portalFetch(`${API_BASE}/api/portal/invoices/${invoice.id}/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: amt, method, reference, note }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || 'Failed')
      onPaid()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full">
        <div className="px-5 py-4 border-b" style={{ borderColor: '#f0ece8' }}>
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold" style={{ color: '#1a1a1a' }}>
              Pay {invoice.invoice_number}
            </h2>
            <button onClick={onClose} className="text-gray-400">×</button>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            Balance due: <strong style={{ color: ORANGE }}>{fmt(balance)}</strong>
          </p>
        </div>
        {stripeOn && (
          <div className="p-5 space-y-2 border-b" style={{ borderColor: '#f0ece8' }}>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
              Pay Online — Instant
            </p>
            <button onClick={() => startStripe('ach')} disabled={saving}
              className="w-full py-2.5 rounded-lg text-sm font-semibold text-white flex items-center justify-center gap-2"
              style={{ backgroundColor: ORANGE }}>
              🏦 Pay by Bank (ACH) · {fmt(balance)}
              <span className="text-xs font-normal opacity-75">· Save ~2%</span>
            </button>
            <button onClick={() => startStripe('card')} disabled={saving}
              className="w-full py-2.5 rounded-lg text-sm font-semibold text-white"
              style={{ backgroundColor: BRAND.ink }}>
              💳 Pay by Credit Card · {fmt(balance)}
            </button>
            <p className="text-xs text-gray-500 text-center">
              Secure payment by Stripe
            </p>
          </div>
        )}

        <form onSubmit={submit} className="p-5 space-y-3">
          {stripeOn && (
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 -mb-1">
              Or Record a Check/Zelle/Other
            </p>
          )}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Payment Method</label>
            <select value={method} onChange={e => setMethod(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: '#e5e7eb' }}>
              <option>ACH / Bank Transfer</option>
              <option>Check</option>
              <option>Zelle</option>
              <option>Credit Card</option>
              <option>Cash</option>
              <option>Other</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Amount</label>
            <input type="number" step="0.01" min="0.01" value={amount}
              onChange={e => setAmount(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: '#e5e7eb' }} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Reference (Check # / Confirmation #)
            </label>
            <input value={reference} onChange={e => setReference(e.target.value)}
              placeholder="Optional"
              className="w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: '#e5e7eb' }} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Note</label>
            <input value={note} onChange={e => setNote(e.target.value)}
              placeholder="Optional"
              className="w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: '#e5e7eb' }} />
          </div>
          {method === 'Credit Card' && (
            <div className="rounded-lg p-3" style={{ backgroundColor: '#fff7f5', border: `1px solid #fcd5c5` }}>
              <p className="text-xs" style={{ color: ORANGE }}>
                💡 Online card payments are being set up. For now, please select another method
                and contact us for card processing.
              </p>
            </div>
          )}
          {error && <p className="text-sm" style={{ color: '#dc2626' }}>{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm border" style={{ borderColor: '#e5e7eb' }}>
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="px-4 py-2 rounded-lg text-sm font-semibold text-white"
              style={{ backgroundColor: ORANGE, opacity: saving ? 0.6 : 1 }}>
              {saving ? 'Recording…' : `Record ${fmt(Number(amount) || 0)} Payment`}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

const STAGE_STYLE = {
  requested:      { bg: '#fff7f5', fg: '#CD4419' },
  quoted:         { bg: '#eff6ff', fg: '#1d4ed8' },
  scheduling:     { bg: '#fef3c7', fg: '#b45309' },
  booked:         { bg: '#f5e8e3', fg: '#CD4419' },
  waiting_parts:  { bg: '#fff7ed', fg: '#b45309' },
  on_the_way:     { bg: '#fef3c7', fg: '#b45309' },
  at_shop:        { bg: '#e6f4f4', fg: '#1F8B8B' },
  done:           { bg: '#dcfce7', fg: '#15803d' },
  complete:       { bg: '#dcfce7', fg: '#15803d' },
  cancelled:      { bg: '#fee2e2', fg: '#b91c1c' },
}

const PIPE = [
  { id: 'requested', label: 'Requested' },
  { id: 'booked', label: 'Booked' },
  { id: 'on_the_way', label: 'On the way' },
  { id: 'at_shop', label: 'At your shop' },
  { id: 'done', label: 'Done' },
]

function pipeIndex(stage) {
  if (stage === 'quoted' || stage === 'scheduling' || stage === 'requested') return 0
  if (stage === 'booked' || stage === 'waiting_parts') return 1
  if (stage === 'on_the_way') return 2
  if (stage === 'at_shop') return 3
  if (stage === 'done' || stage === 'complete') return 4
  return 0
}

function vehicleLabel(j) {
  return j.vehicle?.label || [j.vehicle?.year, j.vehicle?.make, j.vehicle?.model].filter(Boolean).join(' ') || 'Vehicle'
}

function calNames(cals) {
  let list = cals
  if (typeof list === 'string') {
    try { list = JSON.parse(list) } catch { return '' }
  }
  if (!Array.isArray(list) || !list.length) return ''
  return list.map(c => typeof c === 'string' ? c : (c.name || c.calibration_name || '')).filter(Boolean).slice(0, 4).join(', ')
}

function JobPipe({ stage }) {
  if (stage === 'cancelled') return null
  const at = pipeIndex(stage)
  return (
    <div className="flex items-center gap-1 mt-3">
      {PIPE.map((s, i) => (
        <div key={s.id} className="flex-1 min-w-0">
          <div className="h-1 rounded-full" style={{ backgroundColor: i <= at ? ORANGE : '#e8e4e0' }} />
          <p className="text-[9px] font-bold mt-1 truncate"
            style={{ color: i === at ? ORANGE : i < at ? '#888' : '#c4bfba' }}>
            {s.label}
          </p>
        </div>
      ))}
    </div>
  )
}

function JobStatusCard({ j }) {
  const st = STAGE_STYLE[j.stage] || STAGE_STYLE.scheduling
  return (
    <div className="rounded-xl bg-white border shadow-sm p-4"
      style={{ borderColor: j.live ? ORANGE : '#f0ece8', boxShadow: j.live ? '0 0 0 1px #CD4419' : undefined }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-extrabold truncate" style={{ color: BRAND.ink }}>{vehicleLabel(j)}</p>
          <p className="text-xs text-gray-500 mt-0.5">
            {j.ro_number ? `RO ${j.ro_number}` : ''}
            {j.ro_number && j.scheduled_label ? ' · ' : ''}
            {j.scheduled_label || ''}
          </p>
        </div>
        <span className="text-[11px] font-extrabold px-2 py-1 rounded-full flex-shrink-0"
          style={{ backgroundColor: st.bg, color: st.fg }}>
          {j.live ? '● ' : ''}{j.label}
        </span>
      </div>
      <p className="text-sm font-semibold mt-2" style={{ color: j.live ? ORANGE : '#333' }}>{j.message}</p>
      {calNames(j.calibrations) && (
        <p className="text-xs text-gray-500 mt-1">{calNames(j.calibrations)}</p>
      )}
      <JobPipe stage={j.stage} />
    </div>
  )
}

function MyJobsList({ jobs, compact }) {
  if (!jobs.length) {
    return (
      <div className={compact ? 'rounded-xl bg-white border px-4 py-5 text-center' : 'py-16 text-center'}
        style={compact ? { borderColor: '#f0ece8' } : undefined}>
        <p className="text-gray-400 text-sm">No jobs yet. Request a job or instant-quote a car.</p>
      </div>
    )
  }
  const rank = j => (j.live ? 0 : j.open ? 1 : 2)
  const ordered = [...jobs].sort((a, b) => rank(a) - rank(b) || String(b.scheduled_date || b.created_at || '').localeCompare(String(a.scheduled_date || a.created_at || '')))
  const active = ordered.filter(j => j.open || j.live)
  const done = ordered.filter(j => !j.open && !j.live)
  return (
    <div className="space-y-3">
      {active.map(j => <JobStatusCard key={j.id} j={j} />)}
      {done.length > 0 && (
        <p className="text-[10px] font-extrabold tracking-widest uppercase pt-2" style={{ color: '#aaa' }}>Finished</p>
      )}
      {done.map(j => <JobStatusCard key={j.id} j={j} />)}
    </div>
  )
}

function SubmitJobModal({ shop, onClose, onSubmitted }) {
  const [form, setForm] = useState({
    year: '', make: '', model: '', vin: '',
    ro_number: '', insurer: '',
    calibrations: '',
    damage_points: '',
    requested_date: '',
    requested_by_name: '',
    requested_by_phone: '',
    notes: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function submit(e) {
    e.preventDefault()
    if (!form.year && !form.make && !form.model && !form.vin) {
      setError('Please enter at least vehicle info or VIN')
      return
    }
    setSaving(true)
    setError('')
    try {
      const r = await portalFetch(`${API_BASE}/api/portal/submit-job`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          calibrations: form.calibrations.split(',').map(s => s.trim()).filter(Boolean),
          damage_points: form.damage_points.split(',').map(s => s.trim()).filter(Boolean),
        }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || 'Failed')
      onSubmitted()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[92vh] overflow-y-auto">
        <div className="px-5 py-4 border-b sticky top-0 bg-white flex justify-between items-center"
          style={{ borderColor: '#f0ece8' }}>
          <div>
            <h2 className="text-lg font-bold">Request a Calibration</h2>
            <p className="text-xs text-gray-500">From: {shop.shop_name}</p>
          </div>
          <button onClick={onClose} className="text-gray-400">×</button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Vehicle</label>
            <div className="grid grid-cols-3 gap-2">
              <input placeholder="Year" value={form.year}
                onChange={e => setForm(f => ({ ...f, year: e.target.value }))}
                className="border rounded-lg px-3 py-2 text-sm" style={{ borderColor: '#e5e7eb' }} />
              <input placeholder="Make" value={form.make}
                onChange={e => setForm(f => ({ ...f, make: e.target.value }))}
                className="border rounded-lg px-3 py-2 text-sm" style={{ borderColor: '#e5e7eb' }} />
              <input placeholder="Model" value={form.model}
                onChange={e => setForm(f => ({ ...f, model: e.target.value }))}
                className="border rounded-lg px-3 py-2 text-sm" style={{ borderColor: '#e5e7eb' }} />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">VIN</label>
            <input value={form.vin} onChange={e => setForm(f => ({ ...f, vin: e.target.value.toUpperCase() }))}
              placeholder="17-character VIN" maxLength="17"
              className="w-full border rounded-lg px-3 py-2 text-sm font-mono"
              style={{ borderColor: '#e5e7eb' }} />
            <VinDecodeButton vin={form.vin} fetcher={portalFetch} url={v => `${API_BASE}/api/portal/vin/${encodeURIComponent(v)}`} onDecoded={d => setForm(f => ({ ...f, year: d.year || f.year, make: d.make || f.make, model: d.model || f.model }))} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">RO # (your job number)</label>
              <input value={form.ro_number}
                onChange={e => setForm(f => ({ ...f, ro_number: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: '#e5e7eb' }} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Insurance Carrier</label>
              <input value={form.insurer} placeholder="e.g. State Farm"
                onChange={e => setForm(f => ({ ...f, insurer: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: '#e5e7eb' }} />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Calibrations needed <span className="text-gray-400">(comma-separated, or leave blank)</span>
            </label>
            <input value={form.calibrations}
              onChange={e => setForm(f => ({ ...f, calibrations: e.target.value }))}
              placeholder="e.g. Front Camera, Blind Spot, Lane Keep"
              className="w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: '#e5e7eb' }} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Damage points <span className="text-gray-400">(comma-separated)</span>
            </label>
            <input value={form.damage_points}
              onChange={e => setForm(f => ({ ...f, damage_points: e.target.value }))}
              placeholder="e.g. front bumper, windshield"
              className="w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: '#e5e7eb' }} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Preferred date</label>
            <input type="date" value={form.requested_date}
              onChange={e => setForm(f => ({ ...f, requested_date: e.target.value }))}
              className="w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: '#e5e7eb' }} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Your Name</label>
              <input value={form.requested_by_name}
                onChange={e => setForm(f => ({ ...f, requested_by_name: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: '#e5e7eb' }} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Your Phone</label>
              <input value={form.requested_by_phone}
                onChange={e => setForm(f => ({ ...f, requested_by_phone: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: '#e5e7eb' }} />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
            <textarea value={form.notes} rows="2"
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="Anything we should know (special instructions, access, etc.)"
              className="w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: '#e5e7eb' }} />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm border" style={{ borderColor: '#e5e7eb' }}>
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="px-4 py-2 rounded-lg text-sm font-semibold text-white"
              style={{ backgroundColor: ORANGE, opacity: saving ? 0.6 : 1 }}>
              {saving ? 'Submitting…' : 'Submit Request'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
