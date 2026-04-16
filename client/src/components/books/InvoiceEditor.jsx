import { useState, useRef } from 'react'
import { API_BASE, apiFetch, ORANGE, fmt } from './shared'
import PaymentModal from './PaymentModal'

export default function InvoiceEditor({ invoice, services, onClose, onSaved }) {
  const isNew = !invoice

  const today = new Date().toISOString().slice(0, 10)
  const defaultDue = (() => {
    const d = new Date(today)
    d.setDate(d.getDate() + 14)
    return d.toISOString().slice(0, 10)
  })()

  const [form, setForm] = useState(() => invoice ? { ...invoice } : {
    invoice_number: '',
    customer_name: '',
    customer_email: '',
    customer_phone: '',
    customer_address: '',
    customer_contact: '',
    po_number: '',
    date: today,
    due_date: defaultDue,
    terms: 'Net 14',
    line_items: [],
    tax_rate: 0,
    discount: 0,
    discount_pct: 0,
    notes: '',
    status: 'draft',
    customer_type: 'b2b',
    invoice_type: 'standard',
    crm_shop_id: '',
  })

  const [shopSearch, setShopSearch] = useState(invoice?.customer_name || '')
  const [shopResults, setShopResults] = useState([])
  const [shopLoading, setShopLoading] = useState(false)
  const shopSearchTimer = useRef(null)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [showCatalog, setShowCatalog] = useState(false)
  const [showPayment, setShowPayment] = useState(false)

  // Recompute derived line amounts and totals
  const discPct = (form.invoice_type === 'shop') ? (Number(form.discount_pct) || 0) : 0
  const line_items = (form.line_items || []).map(li => ({
    ...li,
    amount: Math.round((Number(li.qty) || 0) * (Number(li.rate) || 0) * (1 - discPct / 100) * 100) / 100,
    retail_amount: Math.round((Number(li.qty) || 0) * (Number(li.rate) || 0) * 100) / 100,
  }))
  const subtotal = line_items.reduce((s, li) => s + li.amount, 0)
  const retail_subtotal = line_items.reduce((s, li) => s + li.retail_amount, 0)
  const tax_amount = Math.round(subtotal * (Number(form.tax_rate) || 0)) / 100
  const discount = Number(form.discount) || 0
  const total = Math.max(0, subtotal + tax_amount - discount)
  const amount_paid = Number(form.amount_paid) || 0
  const balance_due = Math.max(0, total - amount_paid)

  function setField(field, value) {
    setForm(f => ({ ...f, [field]: value }))
  }

  function updateTerms(terms) {
    const daysMap = { 'Net 7': 7, 'Net 14': 14, 'Net 30': 30, 'Due on Receipt': 0 }
    const days = daysMap[terms] ?? 14
    const d = new Date(form.date || today)
    d.setDate(d.getDate() + days)
    setForm(f => ({ ...f, terms, due_date: d.toISOString().slice(0, 10) }))
  }

  function setCustomerType(type) {
    const defaultTerms = type === 'b2b' ? 'Net 14' : 'Due on Receipt'
    const daysMap = { 'Net 7': 7, 'Net 14': 14, 'Net 30': 30, 'Due on Receipt': 0 }
    const days = daysMap[defaultTerms] ?? 14
    const d = new Date(form.date || today)
    d.setDate(d.getDate() + days)
    setForm(f => ({
      ...f,
      customer_type: type,
      terms: defaultTerms,
      due_date: d.toISOString().slice(0, 10),
      invoice_type: type === 'personal' ? 'standard' : f.invoice_type,
      customer_name: '',
      customer_email: '',
      customer_phone: '',
      customer_address: '',
      customer_contact: '',
      crm_shop_id: '',
      discount_pct: 0,
    }))
    setShopSearch('')
    setShopResults([])
  }

  function handleShopSearchChange(val) {
    setShopSearch(val)
    clearTimeout(shopSearchTimer.current)
    if (val.length < 2) { setShopResults([]); return }
    shopSearchTimer.current = setTimeout(async () => {
      setShopLoading(true)
      try {
        const r = await apiFetch(`${API_BASE}/api/books/shop-lookup/${encodeURIComponent(val)}`)
        const data = await r.json()
        if (data.results) setShopResults(data.results)
        else if (data.found) setShopResults([data.shop])
        else setShopResults([])
      } catch { setShopResults([]) }
      finally { setShopLoading(false) }
    }, 350)
  }

  function selectShop(shop) {
    const discPctVal = parseFloat(shop.shop_rate || 0)
    setForm(f => ({
      ...f,
      customer_name: shop.shop_name || '',
      customer_email: shop.email || '',
      customer_phone: shop.phone || '',
      customer_address: shop.address || '',
      customer_contact: shop.people?.[0]?.name || '',
      crm_shop_id: shop.id || '',
      discount_pct: discPctVal,
    }))
    setShopSearch(shop.shop_name || '')
    setShopResults([])
  }

  function addCustomLine() {
    setForm(f => ({
      ...f,
      line_items: [...(f.line_items || []), { id: `li_${Date.now()}`, description: '', qty: 1, rate: 0, amount: 0 }],
    }))
  }

  function addFromCatalog(svc) {
    setForm(f => ({
      ...f,
      line_items: [...(f.line_items || []), { id: `li_${Date.now()}`, description: svc.name, qty: 1, rate: svc.unit_price, amount: svc.unit_price }],
    }))
    setShowCatalog(false)
  }

  function updateLine(idx, field, value) {
    setForm(f => {
      const items = [...(f.line_items || [])]
      items[idx] = { ...items[idx], [field]: value }
      return { ...f, line_items: items }
    })
  }

  function removeLine(idx) {
    setForm(f => {
      const items = [...(f.line_items || [])]
      items.splice(idx, 1)
      return { ...f, line_items: items }
    })
  }

  async function save(status) {
    setLoading(true)
    setError(null)
    try {
      const payload = {
        ...form,
        line_items,
        status: status || form.status,
        sent_at: status === 'sent' ? (form.sent_at || new Date().toISOString()) : form.sent_at,
        customer_type: form.customer_type || 'b2b',
        invoice_type: form.invoice_type || 'standard',
        customer_contact: form.customer_contact || '',
        po_number: form.po_number || '',
        discount_pct: Number(form.discount_pct) || 0,
        crm_shop_id: form.crm_shop_id || '',
      }
      let r
      if (isNew) {
        r = await apiFetch(`${API_BASE}/api/books/invoices`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
      } else {
        r = await apiFetch(`${API_BASE}/api/books/invoices/${invoice.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
      }
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || 'Save failed')
      onSaved(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl my-6">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: '#f0ece8' }}>
          <h2 className="text-lg font-bold" style={{ color: '#1a1a1a' }}>
            {isNew ? 'New Invoice' : `Edit ${invoice.invoice_number}`}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">x</button>
        </div>

        <div className="p-6 space-y-6">

          {/* Invoice number */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">
              Invoice # {isNew && <span className="font-normal normal-case text-gray-400">-- leave blank to auto-assign</span>}
            </label>
            {isNew ? (
              <input
                className="w-full border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none"
                style={{ borderColor: '#e5e7eb' }}
                placeholder="e.g. RO#12345 -- or leave blank for INV-0001"
                value={form.invoice_number || ''}
                onChange={e => setField('invoice_number', e.target.value)}
              />
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-base font-bold font-mono" style={{ color: ORANGE }}>
                  {form.invoice_number}
                </span>
                <span className="text-xs text-gray-400">(invoice # cannot be changed after creation)</span>
              </div>
            )}
          </div>

          {/* B2B / Personal toggle */}
          <div className="flex gap-2">
            {['b2b', 'personal'].map(type => (
              <button key={type} type="button" onClick={() => setCustomerType(type)}
                className="flex-1 py-2 rounded-lg text-sm font-semibold border transition-colors"
                style={{
                  backgroundColor: form.customer_type === type ? ORANGE : 'white',
                  color: form.customer_type === type ? 'white' : '#555',
                  borderColor: form.customer_type === type ? ORANGE : '#e5e7eb',
                }}>
                {type === 'b2b' ? 'B2B' : 'Personal'}
              </button>
            ))}
          </div>

          {/* Invoice Type (B2B only) */}
          {form.customer_type === 'b2b' && (
            <div>
              <h3 className="text-xs font-semibold mb-2" style={{ color: ORANGE }}>Invoice Type</h3>
              <div className="flex gap-2">
                {['standard', 'insurance', 'shop'].map(t => (
                  <button key={t} type="button"
                    onClick={() => setField('invoice_type', t)}
                    className="flex-1 py-1.5 rounded-lg text-xs font-semibold border transition-colors capitalize"
                    style={{
                      backgroundColor: form.invoice_type === t ? ORANGE : 'white',
                      color: form.invoice_type === t ? 'white' : '#555',
                      borderColor: form.invoice_type === t ? ORANGE : '#e5e7eb',
                    }}>
                    {t === 'insurance' ? 'Insurance' : t === 'shop' ? 'Shop' : 'Standard'}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Customer info */}
          <div>
            <h3 className="text-sm font-semibold mb-3" style={{ color: ORANGE }}>
              {form.customer_type === 'b2b' ? 'Company / Shop' : 'Customer'}
            </h3>

            {form.customer_type === 'b2b' && (
              <div className="mb-3 relative">
                <label className="block text-xs font-medium text-gray-600 mb-1">Search CRM Shops <span style={{ color: ORANGE }}>*</span></label>
                <input className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none"
                  style={{ borderColor: '#e5e7eb' }}
                  placeholder="Type shop name..."
                  value={shopSearch}
                  onChange={e => handleShopSearchChange(e.target.value)} />
                {shopLoading && <p className="text-xs text-gray-400 mt-1">Searching...</p>}
                {shopResults.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full bg-white border rounded-lg shadow-lg max-h-48 overflow-y-auto" style={{ borderColor: '#e5e7eb' }}>
                    {shopResults.map(s => (
                      <button key={s.id} type="button" onClick={() => selectShop(s)}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 border-b last:border-0"
                        style={{ borderColor: '#f5f3f0' }}>
                        <span className="font-medium">{s.shop_name}</span>
                        {s.shop_rate ? <span className="ml-2 text-xs text-gray-400">{s.shop_rate}% discount</span> : null}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {form.customer_type === 'b2b' ? (
                <>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Company Name</label>
                    <input className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none"
                      style={{ borderColor: '#e5e7eb' }}
                      value={form.customer_name} onChange={e => setField('customer_name', e.target.value)} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Contact Person</label>
                    <input className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none"
                      style={{ borderColor: '#e5e7eb' }}
                      value={form.customer_contact || ''} onChange={e => setField('customer_contact', e.target.value)} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
                    <input className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none"
                      style={{ borderColor: '#e5e7eb' }}
                      type="email" value={form.customer_email} onChange={e => setField('customer_email', e.target.value)} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Phone</label>
                    <input className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none"
                      style={{ borderColor: '#e5e7eb' }}
                      value={form.customer_phone} onChange={e => setField('customer_phone', e.target.value)} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Address</label>
                    <input className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none"
                      style={{ borderColor: '#e5e7eb' }}
                      value={form.customer_address} onChange={e => setField('customer_address', e.target.value)} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">PO Number</label>
                    <input className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none"
                      style={{ borderColor: '#e5e7eb' }}
                      placeholder="Optional"
                      value={form.po_number || ''} onChange={e => setField('po_number', e.target.value)} />
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">First Name</label>
                    <input className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none"
                      style={{ borderColor: '#e5e7eb' }}
                      value={form.customer_name} onChange={e => setField('customer_name', e.target.value)} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
                    <input className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none"
                      style={{ borderColor: '#e5e7eb' }}
                      type="email" value={form.customer_email} onChange={e => setField('customer_email', e.target.value)} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Phone</label>
                    <input className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none"
                      style={{ borderColor: '#e5e7eb' }}
                      value={form.customer_phone} onChange={e => setField('customer_phone', e.target.value)} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Address</label>
                    <input className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none"
                      style={{ borderColor: '#e5e7eb' }}
                      value={form.customer_address} onChange={e => setField('customer_address', e.target.value)} />
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Invoice details */}
          <div>
            <h3 className="text-sm font-semibold mb-3" style={{ color: ORANGE }}>Invoice Details</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Date <span style={{ color: ORANGE }}>*</span></label>
                <input type="date" className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none"
                  style={{ borderColor: '#e5e7eb' }}
                  value={form.date} onChange={e => setField('date', e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Due Date <span style={{ color: ORANGE }}>*</span></label>
                <input type="date" className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none"
                  style={{ borderColor: '#e5e7eb' }}
                  value={form.due_date} onChange={e => setField('due_date', e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Terms</label>
                <select className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none"
                  style={{ borderColor: '#e5e7eb' }}
                  value={form.terms} onChange={e => updateTerms(e.target.value)}>
                  {form.customer_type === 'b2b' ? (
                    <>
                      <option>Net 14</option>
                      <option>Net 7</option>
                      <option>Net 30</option>
                      <option>Due on Receipt</option>
                    </>
                  ) : (
                    <>
                      <option>Due on Receipt</option>
                      <option>Net 7</option>
                      <option>Net 14</option>
                      <option>Net 30</option>
                    </>
                  )}
                </select>
              </div>
            </div>
          </div>

          {/* Line items */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold" style={{ color: ORANGE }}>Line Items</h3>
              <div className="flex gap-2">
                <button onClick={() => setShowCatalog(v => !v)}
                  className="text-xs px-3 py-1.5 rounded-lg font-medium border"
                  style={{ borderColor: ORANGE, color: ORANGE }}>
                  + From Catalog
                </button>
                <button onClick={addCustomLine}
                  className="text-xs px-3 py-1.5 rounded-lg font-medium border"
                  style={{ borderColor: '#e5e7eb', color: '#555' }}>
                  + Custom Line
                </button>
              </div>
            </div>

            {showCatalog && (
              <div className="mb-3 rounded-xl border p-3 max-h-48 overflow-y-auto"
                style={{ borderColor: '#e5e7eb', backgroundColor: '#fafafa' }}>
                <p className="text-xs font-medium text-gray-500 mb-2">Select a service:</p>
                <div className="space-y-1">
                  {services.filter(s => s.active).map(svc => (
                    <button key={svc.id} onClick={() => addFromCatalog(svc)}
                      className="w-full text-left flex items-center justify-between px-3 py-1.5 rounded-lg hover:bg-white text-sm transition-colors"
                      style={{ border: '1px solid transparent' }}>
                      <span className="font-medium" style={{ color: '#1a1a1a' }}>{svc.name}</span>
                      <span className="font-semibold ml-2" style={{ color: ORANGE }}>{fmt(svc.unit_price)}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {line_items.length > 0 && (
              <div className="hidden sm:grid grid-cols-12 gap-2 text-xs font-semibold text-gray-400 px-1 mb-1">
                <div className="col-span-5">Description</div>
                <div className="col-span-2 text-center">Qty</div>
                <div className="col-span-2 text-right">Rate</div>
                <div className="col-span-2 text-right">Amount</div>
                <div className="col-span-1" />
              </div>
            )}

            <div className="space-y-2">
              {line_items.map((li, idx) => (
                <div key={li.id || idx} className="grid grid-cols-12 gap-2 items-center">
                  <div className="col-span-12 sm:col-span-5">
                    <input className="w-full border rounded-lg px-2 py-1.5 text-sm focus:outline-none"
                      style={{ borderColor: '#e5e7eb' }}
                      placeholder="Description"
                      value={li.description} onChange={e => updateLine(idx, 'description', e.target.value)} />
                  </div>
                  <div className="col-span-4 sm:col-span-2">
                    <input type="number" min="0" step="1"
                      className="w-full border rounded-lg px-2 py-1.5 text-sm text-center focus:outline-none"
                      style={{ borderColor: '#e5e7eb' }}
                      value={li.qty} onChange={e => updateLine(idx, 'qty', e.target.value)} />
                  </div>
                  <div className="col-span-4 sm:col-span-2">
                    <input type="number" min="0" step="0.01"
                      className="w-full border rounded-lg px-2 py-1.5 text-sm text-right focus:outline-none"
                      style={{ borderColor: '#e5e7eb' }}
                      value={li.rate} onChange={e => updateLine(idx, 'rate', e.target.value)} />
                  </div>
                  <div className="col-span-3 sm:col-span-2 text-right text-sm font-medium" style={{ color: '#1a1a1a' }}>
                    {fmt(li.amount)}
                  </div>
                  <div className="col-span-1 flex justify-center">
                    <button onClick={() => removeLine(idx)}
                      className="text-gray-300 hover:text-red-400 transition-colors text-lg leading-none">x</button>
                  </div>
                </div>
              ))}
              {line_items.length === 0 && (
                <p className="text-sm text-gray-400 py-4 text-center border border-dashed rounded-lg"
                  style={{ borderColor: '#e5e7eb' }}>
                  No line items. Add from catalog or add a custom line.
                </p>
              )}
            </div>
          </div>

          {/* Shop discount */}
          {form.invoice_type === 'shop' && (
            <div className="flex justify-end">
              <div className="w-full sm:w-72">
                <div className="flex justify-between items-center text-sm">
                  <span className="text-gray-500 font-medium">Shop Discount (%)</span>
                  <input type="number" min="0" max="100" step="1"
                    className="w-20 border rounded-lg px-2 py-1 text-sm text-right focus:outline-none"
                    style={{ borderColor: ORANGE }}
                    value={form.discount_pct} onChange={e => setField('discount_pct', e.target.value)} />
                </div>
              </div>
            </div>
          )}

          {/* Totals */}
          <div className="flex justify-end">
            <div className="w-full sm:w-72 space-y-2">
              {form.invoice_type === 'shop' && discPct > 0 ? (
                <>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Retail Total</span>
                    <span className="font-medium">{fmt(retail_subtotal)}</span>
                  </div>
                  <div className="flex justify-between text-sm" style={{ color: '#16a34a' }}>
                    <span>Discount ({discPct}%)</span>
                    <span>-{fmt(retail_subtotal - subtotal)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Subtotal</span>
                    <span className="font-medium">{fmt(subtotal)}</span>
                  </div>
                </>
              ) : (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Subtotal</span>
                  <span className="font-medium">{fmt(subtotal)}</span>
                </div>
              )}
              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-500">Tax Rate (%)</span>
                <input type="number" min="0" max="100" step="0.1"
                  className="w-20 border rounded-lg px-2 py-1 text-sm text-right focus:outline-none"
                  style={{ borderColor: '#e5e7eb' }}
                  value={form.tax_rate} onChange={e => setField('tax_rate', e.target.value)} />
              </div>
              {tax_amount > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Tax Amount</span>
                  <span>{fmt(tax_amount)}</span>
                </div>
              )}
              {form.invoice_type !== 'shop' && (
                <div className="flex justify-between items-center text-sm">
                  <span className="text-gray-500">Discount ($)</span>
                  <input type="number" min="0" step="0.01"
                    className="w-20 border rounded-lg px-2 py-1 text-sm text-right focus:outline-none"
                    style={{ borderColor: '#e5e7eb' }}
                    value={form.discount} onChange={e => setField('discount', e.target.value)} />
                </div>
              )}
              <div className="flex justify-between items-center pt-2 border-t" style={{ borderColor: '#e5e7eb' }}>
                <span className="font-bold text-base">Total Due</span>
                <span className="font-bold text-xl" style={{ color: ORANGE }}>{fmt(total)}</span>
              </div>
              {amount_paid > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Amount Paid</span>
                  <span className="font-medium text-green-600">-{fmt(amount_paid)}</span>
                </div>
              )}
              {amount_paid > 0 && (
                <div className="flex justify-between text-sm font-bold"
                  style={{ color: balance_due <= 0 ? '#16a34a' : '#dc2626' }}>
                  <span>Balance Due</span>
                  <span>{fmt(balance_due)}</span>
                </div>
              )}
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
            <textarea rows={3}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none resize-none"
              style={{ borderColor: '#e5e7eb' }}
              value={form.notes} onChange={e => setField('notes', e.target.value)} />
          </div>

          {error && (
            <div className="text-red-600 text-sm bg-red-50 rounded-lg px-3 py-2">{error}</div>
          )}

          {/* Footer actions */}
          <div className="flex flex-wrap gap-2 pt-2 border-t" style={{ borderColor: '#f0ece8' }}>
            <button onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm font-medium border"
              style={{ borderColor: '#e5e7eb', color: '#555' }}>
              Cancel
            </button>
            <div className="flex-1" />
            {!isNew && (invoice.balance_due || 0) > 0 && (
              <button onClick={() => setShowPayment(true)}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-white"
                style={{ backgroundColor: '#16a34a' }}>
                Record Payment
              </button>
            )}
            <button onClick={() => save('draft')} disabled={loading}
              className="px-4 py-2 rounded-lg text-sm font-semibold border"
              style={{ borderColor: ORANGE, color: ORANGE, opacity: loading ? 0.7 : 1 }}>
              {loading ? 'Saving...' : 'Save Draft'}
            </button>
            <button onClick={() => save('sent')} disabled={loading}
              className="px-4 py-2 rounded-lg text-sm font-semibold text-white"
              style={{ backgroundColor: ORANGE, opacity: loading ? 0.7 : 1 }}>
              {loading ? 'Saving...' : 'Mark as Sent'}
            </button>
          </div>
        </div>
      </div>

      {showPayment && (
        <PaymentModal
          invoice={{ ...invoice, balance_due }}
          onClose={() => setShowPayment(false)}
          onSave={data => { onSaved(data); setShowPayment(false) }}
        />
      )}
    </div>
  )
}
