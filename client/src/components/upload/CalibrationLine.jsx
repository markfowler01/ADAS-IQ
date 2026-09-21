// One calibration in the new-look upload review (2026-09-14). Same data
// and handlers as CalibrationRow, restyled to the Bill it row: switch,
// name, chips, price on one line; the justification shown IN FULL and
// editable in place (Mark: "it needs to be shown and editable" — it's
// what convinces the insurer); estimate lines + trigger editable too;
// 🪄 AI rewrite kept.
import { useState } from 'react'
import { API_BASE, apiFetch } from '../../utils/api.js'
import { Switch, Chip, ORANGE } from '../ui/ReviewKit.jsx'

export default function CalibrationLine({ cal, onToggle, price, onField, vehicle }) {
  const { calibration_name, cal_type, trigger, line_references, justification, enabled } = cal
  const [aiBusy, setAiBusy] = useState(false)
  const [metaOpen, setMetaOpen] = useState(false)

  async function aiRewrite(e) {
    e.stopPropagation()
    setAiBusy(true)
    try {
      const r = await apiFetch(`${API_BASE}/api/extract/rewrite-justification`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ calibration_name, year: vehicle?.year, make: vehicle?.make, model: vehicle?.model, trigger: cal.trigger || '', line_references: cal.line_references || '' }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || `Error ${r.status}`)
      onField && onField('justification', d.justification)
    } catch (err) { alert(err.message) }
    finally { setAiBusy(false) }
  }

  // The insurer's list doesn't carry this op, so it billed our standard
  // rate (Mark 2026-09-18: picked State Farm, the price didn't move and
  // nothing said why). POOL_NAMES keeps the flag readable.
  const POOL_NAMES = { SF: 'State Farm', AS: 'Allstate', AMFAM: 'AmFam', GEICO: 'GEICO', CP: 'cash' }
  const fellBack = price && !price.needs_price && price.pool_fallback
  // Which tier rule priced this line (Mark 2026-09-21) — SF/AS/GEICO
  // bill by static-vs-dynamic + manufacturer, so say which one landed.
  const tier = price && price.tier_rule
  const BAND = { a: '3A', b: '3B', c: '3C', dynamic: 'Dynamic' }
  const tierChip = tier
    ? `${POOL_NAMES[tier.pool] || tier.pool} ${tier.kind === 'dynamic' ? 'Level 2 Dynamic' : BAND[tier.band] || tier.band}`
    : null
  const priceEl = price
    ? <span className="flex flex-col items-end flex-shrink-0">
        <span className="text-xs font-bold px-2 py-0.5 rounded tabular-nums" style={price.needs_price ? { backgroundColor: '#fef2f2', color: '#b91c1c' } : { backgroundColor: enabled ? '#dcfce7' : '#f5f3f0', color: enabled ? '#15803d' : '#999' }}>
          {price.needs_price ? 'no price' : `$${Number(price.rate).toFixed(0)}`}
        </span>
        {tierChip && (
          <span className="text-[10px] font-bold mt-0.5 whitespace-nowrap" style={{ color: '#0e7490' }}
            title={`${tierChip} — priced off the ${POOL_NAMES[tier.pool] || tier.pool} tier schedule for a ${tier.kind} calibration${tier.make ? ` on a ${tier.make}` : ''}.`}>
            {tierChip}
          </span>
        )}
        {price?.step2 && (
          <span className="text-[10px] font-bold mt-0.5 whitespace-nowrap" style={{ color: '#7e22ce' }}
            title={`Two-step calibration — ${price.step2.name} bills as the second step.`}>
            + ${Number(price.step2.rate).toFixed(0)} step 2
          </span>
        )}
        {fellBack && (
          <span className="text-[10px] font-bold mt-0.5 whitespace-nowrap" style={{ color: '#b45309' }}
            title={`No ${POOL_NAMES[price.pool_fallback] || price.pool_fallback} item matched this calibration, so our standard rate is billing. Pick the right one on the price review at Create job.`}>
            ⚠ no {POOL_NAMES[price.pool_fallback] || price.pool_fallback} price
          </span>
        )}
      </span>
    : null

  return (
    <div style={{ borderTop: '1px solid #f1f5f9', backgroundColor: 'white', opacity: enabled ? 1 : .55 }}>
      {/* Line: switch · name · chips · price */}
      <div className="flex items-center gap-2.5 px-3" style={{ minHeight: 40 }}>
        <Switch on={enabled} onClick={onToggle} />
        <button type="button" onClick={onToggle} className="flex-1 min-w-0 text-left">
          <div className="text-sm font-semibold leading-snug" style={{ color: '#1a1a1a' }}>{calibration_name}</div>
          {(cal_type || trigger || line_references) && (
            <div className="flex flex-wrap gap-1.5 mt-1">
              {cal_type && <Chip>{cal_type}</Chip>}
              {trigger && <Chip tone="orange">{trigger}</Chip>}
              {line_references && <Chip>Lines {line_references}</Chip>}
            </div>
          )}
        </button>
        {priceEl}
      </div>

      {/* Justification — always visible when on, editable in place */}
      {enabled && (
        <div className="px-3 pb-2.5" onClick={e => e.stopPropagation()}>
          <textarea
            value={justification || ''}
            onChange={e => onField && onField('justification', e.target.value)}
            placeholder="Why this calibration is required (goes on the report and the quote)…"
            rows={Math.min(6, Math.max(2, Math.ceil(String(justification || '').length / 130)))}
            className="w-full text-xs rounded-lg px-2.5 py-1.5 leading-relaxed"
            style={{ border: '1px solid #e0dbd6', backgroundColor: '#fafaf8', color: '#444', fontStyle: justification ? 'normal' : 'italic', resize: 'vertical', outline: 'none' }}
            onFocus={e => (e.target.style.borderColor = ORANGE)}
            onBlur={e => (e.target.style.borderColor = '#e0dbd6')}
          />
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <button type="button" onClick={() => setMetaOpen(o => !o)} className="text-[11px] font-bold px-2 py-0.5 rounded-lg" style={{ backgroundColor: '#f5f3f0', color: '#666' }}>
              {metaOpen ? '▾ lines / trigger' : '▸ lines / trigger'}
            </button>
            <button type="button" onClick={aiRewrite} disabled={aiBusy} className="text-[11px] font-bold px-2.5 py-0.5 rounded-lg text-white" style={{ backgroundColor: '#7c3aed', opacity: aiBusy ? .6 : 1 }}>
              {aiBusy ? '🪄 Writing…' : '🪄 AI rewrite'}
            </button>
          </div>
          {metaOpen && (
            <div className="flex gap-2 mt-2">
              <div className="flex-1">
                <label className="block text-[10px] font-bold mb-0.5" style={{ color: '#999' }}>ESTIMATE LINES</label>
                <input value={cal.line_references || ''} onChange={e => onField('line_references', e.target.value)} placeholder="e.g. 2, 8" className="w-full text-sm px-2 py-1.5 rounded-lg" style={{ border: '1px solid #ddd' }} />
              </div>
              <div className="flex-[2]">
                <label className="block text-[10px] font-bold mb-0.5" style={{ color: '#999' }}>TRIGGER / OPERATION</label>
                <input value={cal.trigger || ''} onChange={e => onField('trigger', e.target.value)} placeholder="e.g. Bumper Removal -- Front" className="w-full text-sm px-2 py-1.5 rounded-lg" style={{ border: '1px solid #ddd' }} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
