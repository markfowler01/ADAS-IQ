import { useState, useEffect } from 'react'
import Navbar from './Navbar'
import { API_BASE, apiFetch, ORANGE, fmt } from './books/shared'

export default function ZohoImportScreen({ user, onLogout, currentScreen, onNavigate }) {
  const [preview, setPreview] = useState(null)
  const [loading, setLoading] = useState(false)
  const [running, setRunning] = useState(null)
  const [results, setResults] = useState({})
  const [error, setError] = useState('')

  const isAdmin = user?.role !== 'technician'

  async function loadPreview() {
    setLoading(true)
    setError('')
    try {
      const r = await apiFetch(`${API_BASE}/api/zoho-import/preview`).then(r => r.json())
      if (r.error) throw new Error(r.error)
      setPreview(r)
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  async function runImport(type) {
    if (!confirm(`Import ${type} from Zoho Books? This merges with existing data — safe to re-run.`)) return
    setRunning(type)
    setError('')
    try {
      const endpoint = type === 'full' ? 'full' : type
      const r = await apiFetch(`${API_BASE}/api/zoho-import/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      }).then(r => r.json())
      if (r.error) throw new Error(r.error)
      setResults(prev => ({ ...prev, [type]: r }))
    } catch (e) { setError(e.message) }
    finally { setRunning(null) }
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen" style={{ backgroundColor: 'white' }}>
        <Navbar user={user} onLogout={onLogout} currentScreen={currentScreen} onNavigate={onNavigate} />
        <div className="py-16 text-center text-gray-400 text-sm">Admin access required</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'white' }}>
      <Navbar user={user} onLogout={onLogout} currentScreen={currentScreen} onNavigate={onNavigate} />
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold" style={{ color: '#1a1a1a' }}>Import from Zoho Books</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            One-time sync of customers, items (services), and invoice history into your Absolute ADAS Books.
          </p>
        </div>

        {error && (
          <div className="rounded-xl p-4 mb-4" style={{ backgroundColor: '#fef2f2', border: '1px solid #fecaca' }}>
            <p className="text-sm" style={{ color: '#b91c1c' }}>{error}</p>
          </div>
        )}

        {!preview ? (
          <div className="rounded-xl border p-5 shadow-sm" style={{ borderColor: '#f0ece8' }}>
            <p className="text-sm text-gray-600 mb-4">
              Click below to connect to Zoho Books and see what's available to import.
              Nothing will be copied until you explicitly run an import.
            </p>
            <button onClick={loadPreview} disabled={loading}
              className="px-5 py-2.5 rounded-lg text-sm font-semibold text-white"
              style={{ backgroundColor: ORANGE, opacity: loading ? 0.6 : 1 }}>
              {loading ? 'Checking Zoho Books…' : 'Preview What Can Be Imported'}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Preview cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <PreviewCard label="Customers" count={preview.customers.count} emoji="🏢" bg="#eff6ff" color="#2563eb" />
              <PreviewCard label="Invoices" count={preview.invoices.count} emoji="🧾" bg="#f0fdf4" color="#16a34a" />
              <PreviewCard label="Items / Services" count={preview.items.count} emoji="🛠️" bg="#fff7f5" color={ORANGE} />
            </div>

            {/* One-click full import */}
            <div className="rounded-xl p-5 shadow-sm"
              style={{ backgroundColor: '#fff7f5', border: `1px solid #fcd5c5` }}>
              <h2 className="text-sm font-semibold mb-1" style={{ color: ORANGE }}>
                🚀 Import Everything (Recommended)
              </h2>
              <p className="text-xs text-gray-600 mb-3">
                Imports customers, items, and all invoice history in the correct order.
                Safe to re-run — existing records are updated, not duplicated.
                This can take 1–5 minutes depending on invoice count.
              </p>
              <button onClick={() => runImport('full')} disabled={running !== null}
                className="px-5 py-2.5 rounded-lg text-sm font-semibold text-white"
                style={{ backgroundColor: ORANGE, opacity: running ? 0.6 : 1 }}>
                {running === 'full' ? 'Importing — this may take a few minutes…' : 'Import Everything'}
              </button>
              {results.full && (
                <div className="mt-3 rounded-lg p-3 text-xs bg-white" style={{ border: '1px solid #f0ece8' }}>
                  <p className="font-semibold mb-2" style={{ color: '#16a34a' }}>✓ Import complete!</p>
                  <ul className="space-y-1 text-gray-600">
                    <li>Customers: {results.full.results.customers.created} new, {results.full.results.customers.updated} updated</li>
                    <li>Items: {results.full.results.items.created} new, {results.full.results.items.updated} updated</li>
                    <li>Invoices: {results.full.results.invoices.created} new, {results.full.results.invoices.updated} updated, {results.full.results.invoices.failed} failed</li>
                  </ul>
                </div>
              )}
            </div>

            {/* Individual imports */}
            <div className="rounded-xl border p-5 shadow-sm" style={{ borderColor: '#f0ece8' }}>
              <h2 className="text-sm font-semibold mb-3" style={{ color: '#1a1a1a' }}>Import Individually</h2>
              <div className="space-y-2">
                <SectionRow title="Customers → CRM" description="Contacts from Zoho Books become active customers in your CRM"
                  count={preview.customers.count} onClick={() => runImport('customers')}
                  running={running === 'customers'} result={results.customers} />
                <SectionRow title="Items → Services Catalog" description="Your Zoho Books items become services for invoicing"
                  count={preview.items.count} onClick={() => runImport('items')}
                  running={running === 'items'} result={results.items} />
                <SectionRow title="Invoices → Books History" description="All your past invoices with line items, payments, and status"
                  count={preview.invoices.count} onClick={() => runImport('invoices')}
                  running={running === 'invoices'} result={results.invoices} />
              </div>
            </div>

            {/* Sample data */}
            <details className="rounded-xl border p-5 shadow-sm" style={{ borderColor: '#f0ece8' }}>
              <summary className="text-sm font-semibold cursor-pointer" style={{ color: '#1a1a1a' }}>
                Preview a sample
              </summary>
              <div className="mt-3 space-y-3 text-xs">
                <div>
                  <p className="font-semibold mb-1">Sample Customers:</p>
                  {preview.customers.sample.map(c => (
                    <p key={c.contact_id} className="text-gray-600">• {c.contact_name}</p>
                  ))}
                </div>
                <div>
                  <p className="font-semibold mb-1">Sample Invoices:</p>
                  {preview.invoices.sample.map((i, idx) => (
                    <p key={idx} className="text-gray-600">
                      • {i.invoice_number} — {i.customer_name} — {fmt(i.total)} — {i.status}
                    </p>
                  ))}
                </div>
                <div>
                  <p className="font-semibold mb-1">Sample Items:</p>
                  {preview.items.sample.map((i, idx) => (
                    <p key={idx} className="text-gray-600">• {i.name} — {fmt(i.rate)}</p>
                  ))}
                </div>
              </div>
            </details>
          </div>
        )}
      </div>
    </div>
  )
}

function PreviewCard({ label, count, emoji, bg, color }) {
  return (
    <div className="rounded-xl p-4 shadow-sm" style={{ backgroundColor: bg }}>
      <p className="text-xs font-medium" style={{ color }}>{emoji} {label}</p>
      <p className="text-3xl font-bold mt-1" style={{ color }}>{count}</p>
    </div>
  )
}

function SectionRow({ title, description, count, onClick, running, result }) {
  return (
    <div className="rounded-lg p-3 flex items-center justify-between gap-3"
      style={{ backgroundColor: '#fafafa' }}>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold" style={{ color: '#1a1a1a' }}>{title}</p>
        <p className="text-xs text-gray-500">{description} · <strong>{count} available</strong></p>
        {result && (
          <p className="text-xs mt-1" style={{ color: '#16a34a' }}>
            ✓ {result.created || result.results?.[title.toLowerCase()]?.created || 0} created,
            {' '}{result.updated || 0} updated
          </p>
        )}
      </div>
      <button onClick={onClick} disabled={running}
        className="text-xs px-3 py-1.5 rounded-md font-semibold text-white flex-shrink-0"
        style={{ backgroundColor: ORANGE, opacity: running ? 0.6 : 1 }}>
        {running ? 'Importing…' : 'Import'}
      </button>
    </div>
  )
}
