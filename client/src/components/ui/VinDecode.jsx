// VIN decoder for every VIN box in the app (Mark 2026-09-14: "add this vin
// decoder to everywhere there is a vin number input"). NHTSA vPIC through
// the server (check digit first, cached). Auto-decodes the moment 17 good
// characters are in the box, and there's a button for a re-run.
import { useEffect, useRef, useState } from 'react'
import { API_BASE, apiFetch } from '../../utils/api.js'

const ORANGE = '#CD4419'
export const cleanVin = v => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
export const vehicleOf = d => [d?.year, d?.make, d?.model, d?.trim].filter(Boolean).join(' ')
const ADAS = { fcw: 'FCW', aeb: 'AEB', lane_departure: 'LDW', lane_keep: 'Lane keep', blind_spot: 'Blind spot', acc: 'ACC', rear_cross: 'RCTA', park_assist: 'Park assist', backup_cam: 'Backup cam' }
export const adasOn = d => d?.adas ? Object.entries(ADAS).filter(([k]) => /standard|optional/i.test(d.adas[k] || '')).map(([, l]) => l) : []

/**
 * <VinDecodeButton vin onDecoded(d) [auto] [fetcher] [url] [compact] />
 *  - onDecoded gets { year, make, model, trim, body, engine, adas, ... }
 *  - auto (default true): decodes by itself once the VIN is 17 chars
 *  - fetcher/url: the shop portal passes its own (portalFetch + /api/portal/vin)
 */
export function VinDecodeButton({ vin, onDecoded, auto = true, fetcher = apiFetch, url = v => `${API_BASE}/api/estimator/vin/${encodeURIComponent(v)}`, compact = false, className = '' }) {
  const [state, setState] = useState({ busy: false, data: null, err: '' })
  const lastRef = useRef('')
  const v = cleanVin(vin)
  const ready = v.length === 17

  async function decode(force = false) {
    if (!ready || state.busy) return
    if (!force && lastRef.current === v) return
    lastRef.current = v
    setState({ busy: true, data: null, err: '' })
    try {
      const r = await fetcher(url(v)); const d = await r.json().catch(() => ({}))
      if (!r.ok || !d.ok) { setState({ busy: false, data: null, err: d.reason || d.error || `HTTP ${r.status}` }); return }
      setState({ busy: false, data: d, err: '' })
      onDecoded && onDecoded(d)
    } catch (e) { setState({ busy: false, data: null, err: e.message }) }
  }
  useEffect(() => { if (auto && ready && lastRef.current !== v) { const t = setTimeout(() => decode(), 250); return () => clearTimeout(t) } if (!ready) { lastRef.current = ''; setState(s => s.data || s.err ? { busy: false, data: null, err: '' } : s) } }, [v, auto, ready]) // eslint-disable-line react-hooks/exhaustive-deps

  const feats = adasOn(state.data)
  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`} style={{ marginTop: compact ? 0 : 4 }}>
      <button type="button" onClick={() => decode(true)} disabled={!ready || state.busy} title={ready ? 'Decode with NHTSA' : 'Needs 17 characters'}
        className="text-[11px] font-bold rounded-lg px-2 py-1 text-white" style={{ backgroundColor: ORANGE, opacity: !ready || state.busy ? .45 : 1, whiteSpace: 'nowrap' }}>
        {state.busy ? '🔎 Decoding…' : '🔎 Decode VIN'}
      </button>
      {state.data && <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: '#dcfce7', color: '#166534' }}>✓ {vehicleOf(state.data)}{state.data.body ? ` · ${state.data.body}` : ''}</span>}
      {!compact && feats.map(f => <span key={f} className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full" style={{ backgroundColor: '#fdeee8', color: ORANGE }}>{f}</span>)}
      {state.err && <span className="text-[11px] font-semibold" style={{ color: '#b91c1c' }}>{state.err}</span>}
    </div>
  )
}

/** Read-only VIN check: decodes and says whether it matches the year/make/model on the page. */
export function VinCheck({ vin, expect = {}, fetcher = apiFetch }) {
  const [d, setD] = useState(null)
  const v = cleanVin(vin)
  useEffect(() => {
    let dead = false
    if (v.length !== 17) { setD(null); return }
    fetcher(`${API_BASE}/api/estimator/vin/${encodeURIComponent(v)}`).then(r => r.json()).then(x => { if (!dead) setD(x) }).catch(() => {})
    return () => { dead = true }
  }, [v]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return null
  if (!d.ok) return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: '#fef2f2', color: '#b91c1c' }} title={d.reason}>⚠ VIN doesn't decode</span>
  const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')
  const mismatch = [['year', d.year], ['make', d.make], ['model', d.model]].filter(([k, val]) => expect[k] && val && !norm(val).includes(norm(expect[k])) && !norm(expect[k]).includes(norm(val)))
  return mismatch.length
    ? <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: '#fffbeb', color: '#92400e' }} title="NHTSA decode disagrees with the report">⚠ VIN says {vehicleOf(d)}</span>
    : <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: '#dcfce7', color: '#166534' }}>✓ VIN matches{adasOn(d).length ? ` · ${adasOn(d).join(' · ')}` : ''}</span>
}
export default VinDecodeButton
