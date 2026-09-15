// Estimator settings (owner): default labor rate + parts markup, shop
// supplies, invoice detail level, zip → sales tax map, job category →
// Zoho Books item map, Rick's models, company block for the PDF.
import { useEffect, useState } from 'react'
import { API_BASE, apiFetch } from '../../utils/api.js'
import { Eyebrow, Panel, Row, Pill, Notice, PrimaryButton, SecondaryButton, Chip, ORANGE, GREEN, BLUE } from '../ui/ReviewKit.jsx'
import { fromCents, toCents } from '../../lib/estimatorCalc.js'

const inp = { border: '1px solid #e0dbd6', outline: 'none', backgroundColor: 'white', borderRadius: 8 }
const CATS = [['calibration', '🎯 Calibration'], ['diagnostic', '🔍 Diagnostic'], ['mechanical', '🔧 Mechanical'], ['programming', '💾 Programming'], ['sublet', '🤝 Sublet'], ['supplies', '🧴 Shop supplies'], ['parts', '📦 Parts (itemized only)'], ['labor', '🕒 Labor fallback (itemized only)']]
const j = async (url, opts) => { const r = await apiFetch(`${API_BASE}${url}`, opts); const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`); return d }

export default function EstimatorSettings({ onClose }) {
  const [s, setS] = useState(null)
  const [items, setItems] = useState([])
  const [q, setQ] = useState({})
  const [zip, setZip] = useState({ zip: '', city: '', rate: '', tax_id: '' })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [isOwner, setIsOwner] = useState(true)
  useEffect(() => {
    j('/api/estimator/settings').then(d => { setS(d.settings); setIsOwner(d.is_owner) }).catch(e => setErr(e.message))
    j('/api/estimator/catalog').then(d => setItems(d.items || [])).catch(() => {})
  }, [])
  const set = f => setS(x => ({ ...x, ...f }))
  async function save() { setBusy(true); setErr(''); try { const d = await j('/api/estimator/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(s) }); setS(d.settings); onClose() } catch (e) { setErr(e.message) } finally { setBusy(false) } }
  if (!s) return <Overlay onClose={onClose}><div className="p-5 text-sm" style={{ color: '#888' }}>{err || 'Loading…'}</div></Overlay>
  const itemName = id => items.find(i => i.item_id === id)?.name || (id ? `item ${id}` : '')
  const hits = k => (q[k] || '').trim() ? items.filter(i => i.name.toLowerCase().includes(q[k].trim().toLowerCase())).slice(0, 6) : []

  return (
    <Overlay onClose={onClose}>
      <div className="px-5 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid #ebebeb' }}><div><Eyebrow>⚙️ Estimator settings</Eyebrow><div className="font-bold" style={{ color: '#1a1a1a' }}>Defaults, tax, Books mapping, Rick</div></div><button onClick={onClose} className="text-2xl leading-none" style={{ color: '#888' }}>×</button></div>
      <div className="px-5 py-4 space-y-3 overflow-y-auto" style={{ maxHeight: '72vh' }}>
        {err && <Notice tone="red">{err}</Notice>}
        {!isOwner && <Notice tone="amber">Read only — only Mark can change these.</Notice>}
        <Panel tone="green" title="Defaults for new estimates">
          <Row left="Labor rate ($/hr)" right={<input defaultValue={fromCents(s.labor_rate_cents ?? 20000)} onBlur={e => set({ labor_rate_cents: toCents(e.target.value) || 20000 })} className="px-2 py-1 text-sm w-24 text-right" style={inp} />} />
          <Row left="Parts markup (% on cost)" right={<input defaultValue={((s.parts_markup_bp ?? 4000) / 100).toFixed(0)} onBlur={e => set({ parts_markup_bp: Math.round(Number(e.target.value) * 100) || 0 })} className="px-2 py-1 text-sm w-24 text-right" style={inp} />} />
          <Row left="Shop supplies (% of labor · cap $)" right={<div className="flex gap-1"><input defaultValue={((s.supplies_pct_bp ?? 700) / 100).toFixed(1)} onBlur={e => set({ supplies_pct_bp: Math.round(Number(e.target.value) * 100) || 0 })} className="px-2 py-1 text-sm w-16 text-right" style={inp} /><input defaultValue={fromCents(s.supplies_cap_cents ?? 5000)} onBlur={e => set({ supplies_cap_cents: toCents(e.target.value) })} className="px-2 py-1 text-sm w-20 text-right" style={inp} /></div>} />
          <Row left="Books invoice detail" right={<div className="flex gap-1"><Pill size="sm" on={(s.detail_level || 'rolled_up') === 'rolled_up'} onClick={() => set({ detail_level: 'rolled_up' })}>Rolled up</Pill><Pill size="sm" on={s.detail_level === 'itemized'} onClick={() => set({ detail_level: 'itemized' })}>Itemized</Pill></div>} sub="Rolled up = one Books line per job (customer PDF is always itemized). Itemized = header, lines, subtotal per job." />
          <Row left="Resale exemption id (Books)" right={<input defaultValue={s.resale_exemption_id || ''} onBlur={e => set({ resale_exemption_id: e.target.value.trim() })} placeholder="from Books settings" className="px-2 py-1 text-xs w-40" style={{ ...inp, fontFamily: 'IBM Plex Mono, monospace' }} />} />
        </Panel>
        <Panel tone="blue" title="Sales tax by zip" right="destination based · rate snapshots onto the estimate">
          {Object.entries(s.tax_by_zip || {}).map(([z, r]) => <Row key={z} left={<span><b style={{ fontFamily: 'IBM Plex Mono, monospace' }}>{z}</b> {r.city}</span>} right={<span className="flex items-center gap-2">{((r.rate_bp || 0) / 100).toFixed(2)}%{r.tax_id ? <Chip tone="green">Books tax ✓</Chip> : <Chip>no Books tax id</Chip>}<button onClick={() => { const m = { ...s.tax_by_zip }; delete m[z]; set({ tax_by_zip: m }) }} className="text-xs" style={{ color: '#bbb' }}>✕</button></span>} />)}
          <div className="p-3 grid grid-cols-4 gap-1.5" style={{ borderTop: '1px solid #f1f5f9' }}>
            <input value={zip.zip} onChange={e => setZip(z => ({ ...z, zip: e.target.value }))} placeholder="Zip" className="px-2 py-1.5 text-sm" style={inp} />
            <input value={zip.city} onChange={e => setZip(z => ({ ...z, city: e.target.value }))} placeholder="City" className="px-2 py-1.5 text-sm" style={inp} />
            <input value={zip.rate} onChange={e => setZip(z => ({ ...z, rate: e.target.value }))} placeholder="Rate % (10.3)" className="px-2 py-1.5 text-sm" style={inp} />
            <input value={zip.tax_id} onChange={e => setZip(z => ({ ...z, tax_id: e.target.value }))} placeholder="Books tax_id" className="px-2 py-1.5 text-sm" style={{ ...inp, fontFamily: 'IBM Plex Mono, monospace' }} />
            <button disabled={!zip.zip || !zip.rate} onClick={() => { set({ tax_by_zip: { ...(s.tax_by_zip || {}), [zip.zip.trim()]: { city: zip.city.trim(), rate_bp: Math.round(Number(zip.rate) * 100), tax_id: zip.tax_id.trim() } } }); setZip({ zip: '', city: '', rate: '', tax_id: '' }) }} className="col-span-4 rounded-lg py-1.5 text-xs font-bold text-white" style={{ backgroundColor: BLUE, opacity: !zip.zip || !zip.rate ? .5 : 1 }}>＋ Add zip</button>
          </div>
        </Panel>
        <Panel tone="orange" title="Job category → Zoho Books item" right="one item per category">
          {CATS.map(([k, l]) => (
            <div key={k} className="px-3 py-2" style={{ borderTop: '1px solid #f1f5f9' }}>
              <div className="flex items-center justify-between gap-2"><span className="text-sm font-semibold">{l}</span>{s.category_items?.[k] ? <span className="text-xs flex items-center gap-1"><Chip tone="green">{itemName(s.category_items[k])}</Chip><button onClick={() => set({ category_items: { ...(s.category_items || {}), [k]: '' } })} style={{ color: '#bbb' }}>✕</button></span> : <span className="text-[11px]" style={{ color: '#888' }}>not mapped · pushes as a plain line</span>}</div>
              <input value={q[k] || ''} onChange={e => setQ(x => ({ ...x, [k]: e.target.value }))} placeholder="Search Books items…" className="w-full mt-1 px-2 py-1 text-xs" style={inp} />
              {hits(k).map(it => <button key={it.item_id} onClick={() => { set({ category_items: { ...(s.category_items || {}), [k]: it.item_id } }); setQ(x => ({ ...x, [k]: '' })) }} className="block w-full text-left text-xs px-2 py-1" style={{ color: '#1a1a1a' }}>{it.name} <span style={{ color: GREEN }}>${it.rate_cents / 100}</span></button>)}
            </div>
          ))}
        </Panel>
        <Panel tone="plain" title="🤖 Rick">
          <Row left="Invoice-line model" right={<input defaultValue={s.rick_model || 'claude-haiku-4-5'} onBlur={e => set({ rick_model: e.target.value.trim() })} className="px-2 py-1 text-xs w-44" style={{ ...inp, fontFamily: 'IBM Plex Mono, monospace' }} />} />
          <Row left="3 C's model" right={<input defaultValue={s.rick_model_3c || 'claude-sonnet-4-6'} onBlur={e => set({ rick_model_3c: e.target.value.trim() })} className="px-2 py-1 text-xs w-44" style={{ ...inp, fontFamily: 'IBM Plex Mono, monospace' }} />} />
        </Panel>
        <Panel tone="plain" title="Company block on estimates and PDFs">
          <div className="p-3 grid grid-cols-2 gap-2">
            {[['name', 'Name'], ['tagline', 'Tagline'], ['address', 'Address'], ['phone', 'Phone'], ['email', 'Email'], ['web', 'Website']].map(([k, l]) => <div key={k}><Eyebrow>{l}</Eyebrow><input defaultValue={s.company?.[k] || ''} onBlur={e => set({ company: { ...(s.company || {}), [k]: e.target.value } })} className="w-full px-2 py-1.5 text-sm" style={inp} /></div>)}
          </div>
        </Panel>
      </div>
      <div className="px-5 py-3 flex gap-2" style={{ borderTop: '1px solid #ebebeb' }}><SecondaryButton onClick={onClose}>Cancel</SecondaryButton><PrimaryButton tone="orange" onClick={save} disabled={busy || !isOwner}>{busy ? 'Saving…' : 'Save settings'}</PrimaryButton></div>
    </Overlay>
  )
}
function Overlay({ children, onClose }) {
  return <div className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,.55)' }} onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}><div className="bg-white w-full sm:max-w-2xl rounded-t-2xl sm:rounded-2xl overflow-hidden flex flex-col" style={{ maxHeight: '94vh' }}>{children}</div></div>
}
