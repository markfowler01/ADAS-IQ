import { useState, useEffect } from 'react'
import { API_BASE, apiFetch } from '../utils/api.js'

const ORANGE = '#CD4419'

function fmt(n) {
  return `$${Number(n || 0).toFixed(2)}`
}

export default function CreateInvoicesModal({ job, onClose, onCreated }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [crmShop, setCrmShop] = useState(null)
  const [shopFound, setShopFound] = useState(false)
  const [lineItems, setLineItems] = useState([])
  const [insuranceCompany, setInsuranceCompany] = useState('')
  const [shopDiscountPct, setShopDiscountPct] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState(null) // { insurance, shop } after creation
  // Invoice numbers — default to RO# if present, otherwise blank (backend auto-assigns)
  const ro = job.ro_number || ''
  const [insInvoiceNum, setInsInvoiceNum]   = useState(ro)
  const [shopInvoiceNum, setShopInvoiceNum] = useState(ro)

  const vehicle = job.vehicle || [job.year, job.make, job.model].filter(Boolean).join(' ')

  // Parse calibrations and match to services
  useEffect(() => {
    async function init() {
      setLoading(true)
      setError(null)
      try {
        // Fetch services catalog and shop lookup in parallel
        const [servicesRes, shopRes] = await Promise.all([
          apiFetch(`${API_BASE}/api/books/services`),
          job.shop_name
            ? apiFetch(`${API_BASE}/api/books/shop-lookup/${encodeURIComponent(job.shop_name)}`)
            : Promise.resolve(null),
        ])

        const services = await servicesRes.json()

        let shop = null
        if (shopRes) {
          const shopData = await shopRes.json()
          if (shopData.found && shopData.results && shopData.results.length > 0) {
            // Try to find best match
            const lc = (job.shop_name || '').toLowerCase()
            shop = shopData.results.find(s => s.shop_name.toLowerCase() === lc) || shopData.results[0]
            setShopFound(true)
          }
        }
        setCrmShop(shop)
        setShopDiscountPct(parseFloat(shop?.shop_rate || 0))

        // Parse calibrations
        let cals = []
        try {
          cals = typeof job.calibrations === 'string'
            ? JSON.parse(job.calibrations || '[]')
            : (job.calibrations || [])
        } catch { cals = [] }

        // Match to services
        const items = cals.map(cal => {
          const calName = cal.name || cal
          const lc = calName.toLowerCase()
          const firstWord = lc.split(' ')[0]
          const svc = services.find(s =>
            s.name.toLowerCase().includes(lc) ||
            s.name.toLowerCase().includes(firstWord)
          )
          return {
            id: `li_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            description: calName + (cal.mode ? ` (${cal.mode})` : ''),
            qty: 1,
            rate: svc ? svc.unit_price : 175,
            noMatch: !svc,
          }
        })
        setLineItems(items)
      } catch (e) {
        setError(e.message || 'Failed to load data')
      } finally {
        setLoading(false)
      }
    }
    init()
  }, [job])

  function updateItemRate(idx, val) {
    setLineItems(prev => {
      const next = [...prev]
      next[idx] = { ...next[idx], rate: parseFloat(val) || 0 }
      return next
    })
  }

  const retailTotal = lineItems.reduce((s, li) => s + (Number(li.qty) || 1) * (Number(li.rate) || 0), 0)
  const discPct = Number(shopDiscountPct) || 0
  const shopTotal = Math.round(retailTotal * (1 - discPct / 100) * 100) / 100

  async function handleGenerate() {
    setSubmitting(true)
    setError(null)
    try {
      const r = await apiFetch(`${API_BASE}/api/books/invoices/from-job`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job: {
            ...job,
            calibrations: JSON.stringify(lineItems.map(li => ({
              name: li.description,
              rate_override: li.rate,
            }))),
          },
          crm_shop: crmShop
            ? { ...crmShop, shop_rate: String(shopDiscountPct) }
            : { shop_name: job.shop_name || '', shop_rate: String(shopDiscountPct) },
          insurance_company: insuranceCompany,
          line_items_override: lineItems,
          invoice_number_insurance: insInvoiceNum.trim() || undefined,
          invoice_number_shop:      shopInvoiceNum.trim() || undefined,
        }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || 'Failed to create invoices')
      setResult(data)
    } catch (e) {
      setError(e.message)
    } finally {
      setSubmitting(false)
    }
  }

  // ── Success state ──────────────────────────────────────────────────────────
  if (result) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
        style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
          <div className="text-center mb-5">
            <div className="text-3xl mb-2">✅</div>
            <h2 className="text-lg font-bold" style={{ color: '#1a1a1a' }}>Invoices Created!</h2>
          </div>

          {/* Insurance invoice */}
          <div className="rounded-xl border p-4 mb-3" style={{ borderColor: '#e5e7eb' }}>
            <div className="flex items-center justify-between mb-2">
              <div>
                <span className="font-bold text-sm" style={{ color: ORANGE }}>{result.insurance.invoice_number}</span>
                <span className="text-xs text-gray-500 ml-2">Insurance</span>
              </div>
              <span className="font-bold text-sm">{fmt(result.insurance.total)}</span>
            </div>
            <p className="text-xs text-gray-400 mb-3">{insuranceCompany || 'Insurance'} · Full retail</p>
            <button
              onClick={() => window.open(`${API_BASE}/api/books/invoices/${result.insurance.id}/pdf`)}
              className="w-full py-2 rounded-lg text-sm font-semibold border"
              style={{ borderColor: ORANGE, color: ORANGE }}>
              Download PDF
            </button>
          </div>

          {/* Shop invoice */}
          <div className="rounded-xl border p-4 mb-5" style={{ borderColor: '#e5e7eb' }}>
            <div className="flex items-center justify-between mb-2">
              <div>
                <span className="font-bold text-sm" style={{ color: ORANGE }}>{result.shop.invoice_number}</span>
                <span className="text-xs text-gray-500 ml-2">Shop</span>
              </div>
              <span className="font-bold text-sm">{fmt(result.shop.total)}</span>
            </div>
            <p className="text-xs text-gray-400 mb-3">{result.shop.customer_name} · {discPct}% discount</p>
            <button
              onClick={() => window.open(`${API_BASE}/api/books/invoices/${result.shop.id}/pdf`)}
              className="w-full py-2 rounded-lg text-sm font-semibold border"
              style={{ borderColor: ORANGE, color: ORANGE }}>
              Download PDF
            </button>
          </div>

          <button
            onClick={() => onCreated({ insurance: result.insurance.invoice_number, shop: result.shop.invoice_number })}
            className="w-full py-2.5 rounded-xl text-sm font-bold text-white"
            style={{ backgroundColor: ORANGE }}>
            Done — Close & Mark Job Complete
          </button>
        </div>
      </div>
    )
  }

  // ── Loading state ──────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
        style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-8 text-center">
          <p className="text-gray-500 text-sm">Loading services and shop data…</p>
        </div>
      </div>
    )
  }

  // ── Main UI ────────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg my-6">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: '#f0ece8' }}>
          <div>
            <h2 className="text-base font-bold" style={{ color: '#1a1a1a' }}>Create Invoices</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {job.shop_name} · {vehicle}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        <div className="p-5 space-y-5">

          {/* Calibrations table */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: ORANGE }}>
              Calibrations Performed
            </h3>
            <div className="rounded-xl border overflow-hidden" style={{ borderColor: '#e5e7eb' }}>
              <div className="grid grid-cols-12 gap-2 px-3 py-2 text-xs font-semibold text-gray-400 bg-gray-50">
                <div className="col-span-8">Service</div>
                <div className="col-span-4 text-right">Price</div>
              </div>
              {lineItems.length === 0 ? (
                <div className="px-3 py-4 text-sm text-gray-400 text-center">No calibrations found on this job.</div>
              ) : (
                lineItems.map((li, idx) => (
                  <div key={li.id || idx}
                    className="grid grid-cols-12 gap-2 px-3 py-2 items-center border-t"
                    style={{ borderColor: '#f5f3f0' }}>
                    <div className="col-span-8">
                      <span className="text-sm" style={{ color: '#1a1a1a' }}>{li.description}</span>
                      {li.noMatch && (
                        <span className="ml-1 text-xs font-semibold px-1.5 py-0.5 rounded"
                          style={{ backgroundColor: '#fef9c3', color: '#a16207' }}>
                          no match
                        </span>
                      )}
                    </div>
                    <div className="col-span-4 flex justify-end">
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-gray-400">$</span>
                        <input
                          type="number"
                          min="0"
                          step="5"
                          value={li.rate}
                          onChange={e => updateItemRate(idx, e.target.value)}
                          className="w-16 border rounded-lg px-1.5 py-1 text-sm text-right focus:outline-none"
                          style={{ borderColor: li.noMatch ? '#fbbf24' : '#e5e7eb' }}
                        />
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
            <p className="text-xs text-gray-400 mt-1">Click prices to edit if needed.</p>
          </div>

          {/* Insurance Invoice section */}
          <div className="rounded-xl border p-4 space-y-3" style={{ borderColor: '#dbeafe', backgroundColor: '#f0f7ff' }}>
            <h3 className="text-xs font-semibold uppercase tracking-wide" style={{ color: '#1d4ed8' }}>
              Insurance Invoice
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Invoice # <span className="font-normal text-gray-400">(leave blank = auto)</span>
                </label>
                <input
                  className="w-full border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none bg-white"
                  style={{ borderColor: '#bfdbfe' }}
                  placeholder={ro || 'e.g. 12345'}
                  value={insInvoiceNum}
                  onChange={e => setInsInvoiceNum(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Insurance Company</label>
                <input
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none bg-white"
                  style={{ borderColor: '#bfdbfe' }}
                  placeholder="State Farm Insurance"
                  value={insuranceCompany}
                  onChange={e => setInsuranceCompany(e.target.value)}
                />
              </div>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Total (full retail)</span>
              <span className="font-bold">{fmt(retailTotal)}</span>
            </div>
          </div>

          {/* Shop Invoice section */}
          <div className="rounded-xl border p-4 space-y-3" style={{ borderColor: '#d1fae5', backgroundColor: '#f0fdf4' }}>
            <h3 className="text-xs font-semibold uppercase tracking-wide" style={{ color: '#15803d' }}>
              Shop Invoice
            </h3>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Invoice # <span className="font-normal text-gray-400">(leave blank = auto)</span>
              </label>
              <input
                className="w-full border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none bg-white"
                style={{ borderColor: '#bbf7d0' }}
                placeholder={ro || 'e.g. 12345'}
                value={shopInvoiceNum}
                onChange={e => setShopInvoiceNum(e.target.value)}
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <span className="text-sm font-medium" style={{ color: '#1a1a1a' }}>
                  {crmShop?.shop_name || job.shop_name || 'Unknown Shop'}
                </span>
                {shopFound ? (
                  <span className="ml-2 text-xs px-1.5 py-0.5 rounded font-medium"
                    style={{ backgroundColor: '#dcfce7', color: '#15803d' }}>
                    from CRM ✓
                  </span>
                ) : (
                  <span className="ml-2 text-xs px-1.5 py-0.5 rounded font-medium"
                    style={{ backgroundColor: '#fef9c3', color: '#a16207' }}>
                    not in CRM
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <label className="text-xs font-medium text-gray-600">Shop Discount</label>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                  value={shopDiscountPct}
                  onChange={e => setShopDiscountPct(parseFloat(e.target.value) || 0)}
                  className="w-16 border rounded-lg px-2 py-1 text-sm text-right focus:outline-none bg-white"
                  style={{ borderColor: '#bbf7d0' }}
                />
                <span className="text-sm text-gray-500">%</span>
              </div>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Total (after {discPct}% discount)</span>
              <span className="font-bold">{fmt(shopTotal)}</span>
            </div>
          </div>

          {error && (
            <div className="text-red-600 text-sm bg-red-50 rounded-lg px-3 py-2">{error}</div>
          )}

          {/* Footer */}
          <div className="flex gap-2 pt-2 border-t" style={{ borderColor: '#f0ece8' }}>
            <button onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm font-medium border"
              style={{ borderColor: '#e5e7eb', color: '#555' }}>
              Cancel
            </button>
            <button
              onClick={handleGenerate}
              disabled={submitting || lineItems.length === 0}
              className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white transition-opacity"
              style={{ backgroundColor: ORANGE, opacity: (submitting || lineItems.length === 0) ? 0.6 : 1 }}>
              {submitting ? 'Generating…' : 'Generate Both Invoices →'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
