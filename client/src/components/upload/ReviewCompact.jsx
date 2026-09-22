// The Kinetic review, Build-job style (Mark 2026-09-22: "I like this way
// better — make the w/ Kinetic report like this"). Same props as
// ReviewLayout — every handler and every piece of state still lives in
// ToggleBoard; this only lays it out: what Kinetic found, add more, who
// and when, one Create button. Justifications sit behind ✏️.
import { useState } from 'react'
import { poolLabel, PoolPill } from './ReviewLayout.jsx'
import CalibrationLine from './CalibrationLine.jsx'
import LinePicker from './LinePicker.jsx'
import CustomerPicker from '../CustomerPicker'
import SalespersonPicker from '../SalespersonPicker'
import { Big3Picker, describeRules, BillingPill } from '../books/Big3Rules.jsx'
import { VinCheck } from '../ui/VinDecode.jsx'
import { Notice, fmt, ORANGE, GREEN } from '../ui/ReviewKit.jsx'

const RED = '#b91c1c'
const POOL_NAMES = { STD: 'Retail · standard pricing', CP: '💵 Cash · CP schedule · $700 max', SF: 'State Farm pricing', AS: 'Allstate pricing', AMFAM: 'AmFam pricing', GEICO: 'GEICO pricing' }
const inp = { border: '1.5px solid #e0dbd6', outline: 'none', backgroundColor: 'white' }

export default function ReviewCompact(props) {
  const {
    jobData, cashMode, toggleCash, calibrations, rowPrices, toggleCal, updateCalField, addManual,
    selectedCustomer, setSelectedCustomer, setSelectedSalesperson, jobDate, setJobDate, todayPT,
    liveTotal, selected, onCreate, creating, previewBusy, invoiceError, kanbanWarning, resultCard, busy,
    dispatch = 'mark', setDispatch = () => {}, poolOverride = null, onPool = () => {},
    big3Rules = null, big3Info = null, onBig3 = () => {}, big3Save = true, setBig3Save = () => {},
    listTotal = null, cashCap = 700, setCashCap = () => {}, onOldLook, onPanelLook,
  } = props
  const [showNotRequired, setShowNotRequired] = useState(false)
  const [editing, setEditing] = useState(null)   // _id whose justification is open
  const vehicle = [jobData.year, jobData.make, jobData.model].filter(Boolean).join(' ')
  const isService = c => c.calibration_name === 'Diagnostic 1' || c.calibration_name === 'Mechanical'
  const required = calibrations.filter(c => c.enabled && !isService(c))
  const notRequired = calibrations.filter(c => !c.enabled && !isService(c))
  const services = calibrations.filter(isService)
  const pool = poolOverride ? { label: POOL_NAMES[poolOverride] || poolOverride, tone: poolOverride === 'CP' ? 'green' : 'blue' } : poolLabel(jobData.insurer, cashMode)
  const shopName = selectedCustomer?.name || jobData.shop || ''
  const canCreate = !!selectedCustomer && selected.length > 0 && !busy && !previewBusy
  const priceOf = c => rowPrices ? rowPrices[String(c.calibration_name || '').toLowerCase()] : null
  const veh = { year: jobData.year, make: jobData.make, model: jobData.model }
  const existingNames = calibrations.map(c => c.calibration_name)
  const fellBack = calibrations.filter(c => c.enabled).map(priceOf).filter(p => p && !p.needs_price && p.pool_fallback)
  const PRICE_NAMES = { SF: 'State Farm', AS: 'Allstate', AMFAM: 'AmFam', GEICO: 'GEICO', CP: 'cash' }

  function addFromPicker(it, extra = {}) {
    addManual({ calibration_name: it.name, cal_type: null, trigger: 'Added on review', line_references: null, justification: extra.description != null ? '' : null, enabled: true, item_id: it.item_id || null, _added: true, ...(extra.description != null ? { description: '' } : {}) })
  }
  // A compact row: switch · name · type/lines chips · price · ✏️
  const Row = ({ cal }) => {
    const p = priceOf(cal)
    const open = editing === cal._id
    return (
      <div style={{ borderTop: '1px solid #f1f5f9', backgroundColor: cal._added ? '#f0fdf4' : 'white', opacity: cal.enabled ? 1 : .55 }}>
        <div className="flex items-center gap-2.5 px-3" style={{ minHeight: 44 }}>
          <button type="button" onClick={() => toggleCal(cal._id)} className="w-10 h-6 rounded-full flex-shrink-0 relative" style={{ backgroundColor: cal.enabled ? GREEN : '#d6d3d1' }} aria-label="toggle"><span className="absolute top-0.5 w-5 h-5 rounded-full bg-white" style={{ left: cal.enabled ? 18 : 2, transition: 'left .15s' }} /></button>
          <button type="button" onClick={() => toggleCal(cal._id)} className="flex-1 min-w-0 text-left">
            <div className="text-sm font-semibold leading-snug truncate" style={{ color: '#1a1a1a' }}>{cal.calibration_name}{cal._added ? <span className="text-[10px] font-bold ml-1" style={{ color: GREEN }}>added</span> : null}</div>
            <div className="text-[11px] truncate" style={{ color: '#888' }}>{[cal.cal_type, cal.line_references ? `lines ${cal.line_references}` : '', cal.trigger].filter(Boolean).join(' · ')}</div>
          </button>
          {p && <span className="flex flex-col items-end flex-shrink-0"><span className="text-xs font-bold px-2 py-0.5 rounded tabular-nums" style={p.needs_price ? { backgroundColor: '#fef2f2', color: RED } : { backgroundColor: cal.enabled ? '#dcfce7' : '#f5f3f0', color: cal.enabled ? GREEN : '#999' }}>{p.needs_price ? 'no price' : `$${Number(p.rate).toFixed(0)}`}</span>{p.tier_rule && <span className="text-[10px] font-bold" style={{ color: '#0e7490' }}>{PRICE_NAMES[p.tier_rule.pool] || p.tier_rule.pool} {p.tier_rule.kind === 'dynamic' ? 'L2' : { a: '3A', b: '3B', c: '3C' }[p.tier_rule.band] || ''}{p.tier_rule.additional ? ' add\'l' : ''}</span>}{p.step2 && <span className="text-[10px] font-bold" style={{ color: '#7e22ce' }}>+ ${Number(p.step2.rate).toFixed(0)} step 2</span>}{p.pool_fallback && !p.needs_price && <span className="text-[10px] font-bold" style={{ color: '#b45309' }}>⚠ no {PRICE_NAMES[p.pool_fallback] || p.pool_fallback} price</span>}</span>}
          {cal.enabled && <button type="button" onClick={() => setEditing(open ? null : cal._id)} className="text-xs font-bold rounded-full px-2 py-1 flex-shrink-0" style={{ backgroundColor: open ? '#1a1a1a' : '#f5f3f0', color: open ? 'white' : '#555' }} title="Why this calibration — the justification on the invoice">✏️</button>}
        </div>
        {open && <div className="px-1 pb-1"><CalibrationLine cal={cal} onToggle={() => toggleCal(cal._id)} price={null} onField={(f, v) => updateCalField(cal._id, f, v)} vehicle={veh} /></div>}
      </div>
    )
  }
  return (
    <div className="max-w-2xl mx-auto px-4 py-4 flex flex-col gap-3">
      {/* Header */}
      <div className="rounded-2xl p-4 bg-white" style={{ border: '1.5px solid #e8e4e0' }}>
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: ORANGE, fontFamily: 'IBM Plex Mono, monospace' }}>📄 Kinetic report · build the job</div>
            <div className="font-extrabold text-lg leading-tight" style={{ color: '#1a1a1a' }}>{vehicle || 'Vehicle'}</div>
            <div className="text-xs" style={{ color: '#666' }}>{shopName || 'pick the customer below'}{jobData.ro_number ? ` · RO ${jobData.ro_number}` : ''}{jobData.claim ? ` · claim ${jobData.claim}` : ''}</div>
            {jobData.vin && <div className="text-[11px] font-mono mt-0.5 flex items-center gap-2" style={{ color: '#888' }}>{jobData.vin} <VinCheck vin={jobData.vin} expect={veh} /></div>}
          </div>
          <PoolPill pool={pool} poolOverride={poolOverride} onPool={onPool} disabled={busy} />
        </div>
        {jobData._demo && <Notice>🧪 <b>Demo mode</b> — sample data.</Notice>}
      </div>

      {/* 1 · What Kinetic found */}
      <div className="rounded-2xl overflow-hidden bg-white" style={{ border: '1.5px solid #fdba74' }}>
        <div className="px-4 py-2.5 flex items-center justify-between" style={{ backgroundColor: '#fff5f0' }}>
          <span className="text-sm font-bold" style={{ color: ORANGE }}>🎯 What Kinetic found</span>
          <span className="text-xs" style={{ color: '#9a3412' }}>{required.length} on · {notRequired.length} not required</span>
        </div>
        {required.length === 0 && <div className="px-4 py-3 text-sm" style={{ color: '#888' }}>Nothing switched on — turn on what this repair needs, or add below.</div>}
        {required.map(cal => <Row key={cal._id} cal={cal} />)}
        {notRequired.length > 0 && <button type="button" onClick={() => setShowNotRequired(o => !o)} className="w-full text-left px-4 py-2 text-xs font-semibold" style={{ borderTop: '1px solid #f1f5f9', backgroundColor: '#fafaf9', color: '#666' }}>{showNotRequired ? '▾' : '▸'} {notRequired.length} not required for this repair · {showNotRequired ? 'hide' : 'show'}</button>}
        {showNotRequired && notRequired.map(cal => <Row key={cal._id} cal={cal} />)}
        {services.map(cal => (
          <div key={cal._id} style={{ borderTop: '1px solid #f1f5f9', backgroundColor: 'white' }}>
            <div className="flex items-center gap-2.5 px-3" style={{ minHeight: 44 }}>
              <button type="button" onClick={() => toggleCal(cal._id)} className="w-10 h-6 rounded-full flex-shrink-0 relative" style={{ backgroundColor: cal.enabled ? GREEN : '#d6d3d1' }}><span className="absolute top-0.5 w-5 h-5 rounded-full bg-white" style={{ left: cal.enabled ? 18 : 2 }} /></button>
              <span className="flex-1 text-sm font-semibold" style={{ color: '#1a1a1a' }}>{cal.calibration_name}</span>
              {cal.enabled && <div className="flex items-center gap-1"><button type="button" onClick={() => updateCalField(cal._id, 'quantity', Math.max(1, (cal.quantity || 1) - 1))} className="w-6 h-6 rounded-md font-bold text-sm" style={{ backgroundColor: '#f0eeec', color: '#555' }}>−</button><span className="w-5 text-center text-sm font-semibold">{cal.quantity || 1}</span><button type="button" onClick={() => updateCalField(cal._id, 'quantity', Math.min(99, (cal.quantity || 1) + 1))} className="w-6 h-6 rounded-md font-bold text-sm" style={{ backgroundColor: '#f0eeec', color: '#555' }}>+</button></div>}
              {priceOf(cal) && <span className="text-xs font-bold px-2 py-0.5 rounded" style={{ backgroundColor: '#dcfce7', color: GREEN }}>${Number(priceOf(cal).rate).toFixed(0)}</span>}
            </div>
            {cal.enabled && <div className="px-3 pb-2.5"><input value={cal.description || ''} onChange={e => updateCalField(cal._id, 'description', e.target.value)} placeholder={cal.calibration_name === 'Diagnostic 1' ? 'What was diagnosed…' : 'What was done / replaced…'} className="w-full text-xs rounded-lg px-2.5 py-1.5" style={inp} /></div>}
          </div>
        ))}
        {fellBack.length > 0 && <div className="mx-3 my-2 rounded-lg px-2.5 py-2 text-[11px]" style={{ backgroundColor: '#fffbeb', border: '1.5px solid #fde68a', color: '#92400e' }}><b>⚠ {fellBack.length} line{fellBack.length === 1 ? '' : 's'} didn't match a {PRICE_NAMES[fellBack[0].pool_fallback] || fellBack[0].pool_fallback} item</b> — billing our standard rate. Pick the tier at Create job.</div>}
      </div>

      {/* 2 · Add more */}
      <div className="rounded-2xl p-3 bg-white" style={{ border: '1.5px solid #e8e4e0' }}>
        <div className="text-sm font-bold mb-2" style={{ color: '#1a1a1a' }}>＋ Add more</div>
        <LinePicker onAdd={addFromPicker} jobMake={jobData.make || ''} existingNames={existingNames} initialTab="calibration" />
      </div>

      {/* 3 · Who and when */}
      <div className="rounded-2xl p-3 bg-white flex flex-col gap-2.5" style={{ border: `1.5px solid ${selectedCustomer ? '#bbf7d0' : '#fde68a'}` }}>
        <div className="flex items-center justify-between"><span className="text-sm font-bold" style={{ color: '#1a1a1a' }}>🏢 Who and when</span>{selectedCustomer?.name && <span className="flex gap-1"><BillingPill shopName={selectedCustomer.name} /></span>}</div>
        <CustomerPicker shopName={jobData.shop} onSelect={setSelectedCustomer} />
        {!selectedCustomer && <div className="text-[11px] font-semibold" style={{ color: '#92400e' }}>Pick the Zoho customer — or ➕ Create new customer in the list.</div>}
        <div className="flex items-center justify-between gap-2 rounded-lg px-2.5 py-2" style={{ backgroundColor: cashMode ? '#f0fdf4' : '#fafaf9', border: `1.5px solid ${cashMode ? '#86efac' : '#e7e5e4'}` }}>
          <div className="text-xs" style={{ color: cashMode ? '#166534' : '#555' }}><b>💵 {cashMode ? 'Cash job — CP pricing' : 'Customer paying out of pocket?'}</b>{cashMode && <span className="ml-2">{[[700, '$700 max'], [350, '$350 max'], [0, 'No cap']].map(([v, l]) => <button key={v} type="button" onClick={() => setCashCap(v)} className="text-[11px] font-bold rounded-full px-2 py-0.5 ml-1" style={cashCap === v ? { backgroundColor: GREEN, color: 'white' } : { backgroundColor: 'white', color: '#166534', border: '1px solid #86efac' }}>{l}</button>)}</span>}</div>
          <div className="flex gap-1"><button type="button" onClick={() => cashMode && toggleCash()} className="text-xs font-bold rounded-full px-3 py-1" style={!cashMode ? { backgroundColor: '#1a1a1a', color: 'white' } : { backgroundColor: 'white', color: '#555', border: '1px solid #e0dbd6' }}>No</button><button type="button" onClick={() => !cashMode && toggleCash()} className="text-xs font-bold rounded-full px-3 py-1" style={cashMode ? { backgroundColor: GREEN, color: 'white' } : { backgroundColor: 'white', color: '#555', border: '1px solid #e0dbd6' }}>Yes</button></div>
        </div>
        <div>
          <div className="flex items-center justify-between gap-2"><span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: '#888' }}>🧾 Big 4 for {shopName || 'this shop'}</span><span className="text-[11px]" style={{ color: '#166534' }}>{big3Info?.source === 'shop' ? `shop rule · ${big3Info.set_by || ''}` : big3Info?.source === 'modal' ? 'edited here' : 'default'} · {big3Rules ? describeRules(big3Rules) : ''}</span></div>
          <div className="mt-1"><Big3Picker rules={big3Rules || { cal_id: 'charge', pcsi: 'included', post_scan: 'included', snapshot: 'off' }} onChange={onBig3} compact /></div>
          <label className="flex items-center gap-2 text-[11px] mt-1" style={{ color: '#555' }}><input type="checkbox" checked={big3Save} onChange={e => setBig3Save(e.target.checked)} /> Remember for {shopName || 'this shop'}</label>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div><div className="text-[11px] font-bold uppercase tracking-wider mb-1" style={{ color: '#888' }}>Goes to</div><div className="flex gap-1">{[['need_dispatch', '📋 Dispatch'], ['jaden', 'Jayden'], ['mark', 'Mark']].map(([id, l]) => <button key={id} type="button" onClick={() => setDispatch(id)} disabled={busy} className="flex-1 text-xs font-bold rounded-lg py-2" style={dispatch === id ? { backgroundColor: ORANGE, color: 'white' } : { backgroundColor: 'white', color: '#555', border: '1px solid #e0dbd6' }}>{l}</button>)}</div></div>
          <div><div className="text-[11px] font-bold uppercase tracking-wider mb-1" style={{ color: '#888' }}>Job date</div><input type="date" value={jobDate} onChange={e => setJobDate(e.target.value)} className="w-full text-sm rounded-lg px-2 py-1.5" style={{ ...inp, borderColor: jobDate === todayPT() ? '#e0dbd6' : '#e8710a' }} /></div>
        </div>
        <SalespersonPicker onSelect={setSelectedSalesperson} />
      </div>

      {invoiceError && <Notice tone="red">{invoiceError}</Notice>}
      {kanbanWarning && <Notice>⚠️ {kanbanWarning}</Notice>}
      {resultCard}

      {!resultCard && (
        <div className="sticky bottom-0 rounded-2xl p-3 bg-white flex items-center gap-3" style={{ border: '1.5px solid #e8e4e0', boxShadow: '0 -6px 20px rgba(0,0,0,.06)' }}>
          <div className="min-w-0"><div className="text-xl font-extrabold tabular-nums" style={{ color: '#1a1a1a' }}>{liveTotal != null ? fmt(liveTotal) : '—'}</div><div className="text-[11px] truncate" style={{ color: '#888' }}>{!selectedCustomer ? 'Pick the Zoho customer' : selected.length === 0 ? 'Turn on at least one line' : `${selected.length} line${selected.length === 1 ? '' : 's'} · ${pool.label}${listTotal != null && cashMode && cashCap > 0 && listTotal > cashCap ? ` · list ${fmt(listTotal)} capped` : ''}`}</div></div>
          <button type="button" onClick={onCreate} disabled={!canCreate} className="flex-1 rounded-xl py-3 text-base font-bold text-white" style={{ backgroundColor: ORANGE, opacity: canCreate ? 1 : .45 }}>{creating ? 'Creating job…' : previewBusy ? 'Pricing…' : `Create job → ${dispatch === 'need_dispatch' ? 'Dispatch' : dispatch === 'jaden' ? 'Jayden' : 'Mark'}`}</button>
        </div>
      )}
      <div className="text-center text-[11px] pb-2" style={{ color: '#aaa' }}>{onPanelLook && <button type="button" onClick={onPanelLook} className="underline">panel look</button>}{onPanelLook && onOldLook ? ' · ' : ''}{onOldLook && <button type="button" onClick={onOldLook} className="underline">legacy look</button>}</div>
    </div>
  )
}
