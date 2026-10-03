// The Kinetic review, Build-job style (Mark 2026-09-22: "I like this way
// better — make the w/ Kinetic report like this"). Same props as
// ReviewLayout — every handler and every piece of state still lives in
// ToggleBoard; this only lays it out: what Kinetic found, add more, who
// and when, one Create button. Justifications sit behind ✏️.
import { useState, useEffect } from 'react'
import { poolLabel, PoolPill } from './ReviewLayout.jsx'
import CalibrationLine from './CalibrationLine.jsx'
import LinePicker from './LinePicker.jsx'
import CustomerPicker from '../CustomerPicker'
import { API_BASE, apiFetch } from '../../utils/api.js'
import { Big3Picker, describeRules, BillingPill, useBig3Map, shopKeyOf } from '../books/Big3Rules.jsx'
import { VinCheck } from '../ui/VinDecode.jsx'
import { Notice, fmt, ORANGE, GREEN } from '../ui/ReviewKit.jsx'

const RED = '#b91c1c'
const POOL_NAMES = { STD: 'Retail · standard pricing', CP: '💵 Cash · CP schedule · $700 max', SF: 'State Farm pricing', AS: 'Allstate pricing', AMFAM: 'AmFam pricing', GEICO: 'GEICO pricing' }
const inp = { border: '1.5px solid #e0dbd6', outline: 'none', backgroundColor: 'white' }

// Bill it-style panel. Module level on purpose: defined inside the component it
// would be a new type every render and remount the customer picker mid-typing.
const Panel = ({ title, right, tone = 'neutral', clip = true, children }) => {
  const t = tone === 'blue' ? { br: '#bfdbfe', bg: '#eff6ff', fg: '#1d4ed8' } : tone === 'green' ? { br: '#bbf7d0', bg: '#f0fdf4', fg: GREEN } : tone === 'amber' ? { br: '#fde68a', bg: '#fffbeb', fg: '#92400e' } : { br: '#e8e4e0', bg: '#fafaf9', fg: '#1a1a1a' }
  return (
    // clip={false} for panels holding a dropdown (the customer list opens below
    // its box — overflow-hidden cut it off, 2026-09-30).
    <div className={`rounded-2xl bg-white ${clip ? 'overflow-hidden' : 'relative z-30'}`} style={{ border: `1.5px solid ${t.br}` }}>
      <div className="px-4 py-2.5 flex items-center justify-between gap-2 rounded-t-2xl" style={{ backgroundColor: t.bg }}>
        <span className="text-sm font-bold" style={{ color: t.fg }}>{title}</span>{right}
      </div>
      {children}
    </div>
  )
  }

// Tap-to-open row: label left, one-line summary right. Module level so the
// line picker inside it doesn't remount on every parent render.
const Fold = ({ id, icon, label, summary, openFold, setOpenFold, children }) => (
  <div style={{ borderTop: '1px solid #e2e8f0' }}>
    <button type="button" onClick={() => setOpenFold(openFold === id ? null : id)} className="w-full flex items-center gap-2 px-3 text-left" style={{ minHeight: 40, backgroundColor: openFold === id ? '#f8fafc' : 'white' }}>
      <span className="text-xs font-bold flex-shrink-0" style={{ color: '#555' }}>{icon} {label}</span>
      <span className="flex-1 min-w-0 text-[11px] truncate text-right" style={{ color: '#888' }}>{summary}</span>
      <span className="text-xs flex-shrink-0" style={{ color: '#aaa' }}>{openFold === id ? '▾' : '▸'}</span>
    </button>
    {openFold === id && <div style={{ backgroundColor: '#f8fafc' }}>{children}</div>}
  </div>
)

export default function ReviewCompact(props) {
  const {
    jobData, cashMode, toggleCash, calibrations, rowPrices, toggleCal, updateCalField, addManual,
    selectedCustomer, setSelectedCustomer, setSelectedSalesperson, jobDate, setJobDate, todayPT,
    liveTotal, selected, onCreate, creating, previewBusy, invoiceError, kanbanWarning, resultCard, busy,
    dispatch = 'mark', setDispatch = () => {}, poolOverride = null, onPool = () => {},
    big3Rules = null, big3Info = null, onBig3 = () => {}, big3Save = true, setBig3Save = () => {}, big3Msg = '',
    listTotal = null, cashCap = 700, setCashCap = () => {}, onOldLook, onPanelLook,
  } = props
  const [showNotRequired, setShowNotRequired] = useState(false)
  const [editing, setEditing] = useState(null)   // _id whose justification is open
  const [openFold, setOpenFold] = useState(null) // 'fees' | 'add'
  // Big 4 follows the customer type (Mark 2026-09-30): collision shops get the
  // four switches right under the customer; auto repair shops get none.
  const big3Map = useBig3Map()
  const ctype = selectedCustomer?.name ? big3Map[shopKeyOf(selectedCustomer.name)]?.billing?.customer_type || '' : ''
  const noBig4 = ctype === 'repair_shop'
  const ALL_OFF = { cal_id: 'off', pcsi: 'off', pre_scan: 'off', post_scan: 'off', snapshot: 'off' }
  useEffect(() => {
    if (noBig4) { onBig3(ALL_OFF); setBig3Save(false) }
  }, [noBig4, selectedCustomer?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  // Salesperson = whoever the job is dispatched to (Mark 2026-09-30: "I don't
  // want there to be two items to select"). Jayden → Jayden's Zoho
  // salesperson; Mark or the Dispatch queue → Mark Fowler.
  const [spList, setSpList] = useState(null)
  useEffect(() => {
    apiFetch(`${API_BASE}/api/salespersons`).then(r => r.json()).then(d => setSpList(Array.isArray(d) ? d : [])).catch(() => setSpList([]))
  }, [])
  const salesperson = (() => {
    if (!spList) return null
    const want = dispatch === 'jaden' ? /jay?den/i : /mark fowler/i
    const p = spList.find(x => want.test(x.name || ''))
    return p ? { id: p.user_id, name: p.name } : null
  })()
  useEffect(() => { if (spList) setSelectedSalesperson(salesperson) }, [spList, salesperson?.id])
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
  // 🧭 One screen (Mark 2026-09-30: "make this all on one page so you don't
  // have to scroll"). Same pricing order — car → who pays → lines → dispatch —
  // but everything that's usually left alone (Big 4 fees, add-ons,
  // salesperson) folds to a one-line summary you tap to open. The sticky
  // footer carries the total, so there's no second total in the page.
  const fromScrub = !!jobData._scrubId || String(jobData._pdfType || '').toUpperCase() === 'CCC'
  const src = fromScrub ? 'Absolute ADAS scrub' : 'Kinetic report'
  const fixedLines = (rowPrices?._fixed_lines || [])
  const feeTotal = fixedLines.reduce((a, l) => a + (Number(l.amount) || 0), 0)
  const rules = big3Rules || { cal_id: 'charge', pcsi: 'included', pre_scan: 'off', post_scan: 'included', snapshot: 'off' }
  const onServices = services.filter(c => c.enabled)
  return (
    <div className="max-w-2xl mx-auto px-3 py-2 flex flex-col gap-2">
      {/* 1 · The car — two lines */}
      <div className="px-1">
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="font-extrabold text-lg leading-tight truncate" style={{ color: '#1a1a1a' }}>{vehicle || 'Vehicle'}</span>
          {jobData.ro_number && <span className="text-xs font-mono flex-shrink-0" style={{ color: '#888' }}>RO {jobData.ro_number}</span>}
        </div>
        <div className="text-[11px] truncate" style={{ color: '#888' }}>{src} · {jobData.shop || 'Shop not read'}{jobData.vin ? ` · VIN …${String(jobData.vin).slice(-6)}` : ''}</div>
        {jobData.vin && <div className="text-[11px] mt-0.5 truncate"><VinCheck vin={jobData.vin} expect={veh} /></div>}
      </div>

      {/* 2 · Who pays + schedule + cash, in one block */}
      <Panel clip={false} title="🏢 Customer and pricing" tone={selectedCustomer ? 'green' : 'amber'} right={selectedCustomer?.name ? <BillingPill shopName={selectedCustomer.name} /> : null}>
        <div className="p-2.5 flex flex-col gap-2">
          <CustomerPicker shopName={jobData.shop} onSelect={setSelectedCustomer} />
          <div className="flex items-center gap-1.5 flex-wrap">
            <PoolPill pool={pool} poolOverride={poolOverride} onPool={onPool} disabled={busy} />
            <button type="button" onClick={toggleCash} className="text-xs font-bold rounded-full px-3 py-1.5" style={cashMode ? { backgroundColor: GREEN, color: 'white' } : { backgroundColor: 'white', color: '#555', border: '1px solid #e0dbd6' }}>💵 Cash {cashMode ? 'on' : 'off'}</button>
            {cashMode && [[700, '$700'], [350, '$350'], [0, 'No cap']].map(([v, l]) => <button key={v} type="button" onClick={() => setCashCap(v)} className="text-xs font-bold rounded-full px-2 py-1" style={cashCap === v ? { backgroundColor: '#166534', color: 'white' } : { backgroundColor: 'white', color: '#166534', border: '1px solid #86efac' }}>{l}</button>)}
          </div>
          {cashMode && selectedCustomer && <div className="text-[11px]" style={{ color: '#92400e' }}>⚠ Cash overrides {selectedCustomer.name}'s terms (CP prices, cap, 15% cash rule). Turn Cash off if the shop pays.</div>}
          {selectedCustomer && (noBig4
            ? <div className="text-[11px] rounded-lg px-2.5 py-1.5" style={{ backgroundColor: '#f5f3f0', color: '#555' }}>🔧 Auto repair shop — no Big 4 fees on this job.</div>
            : <div className="rounded-xl px-2.5 py-2" style={{ backgroundColor: '#fafaf9', border: '1px solid #ece8e4' }}>
                <div className="flex items-center justify-between mb-1.5"><span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: '#555' }}>🧾 Big 4{feeTotal ? ` · ${fmt(feeTotal)}` : ''}</span><span className="text-[10px]" style={{ color: '#888' }}>{big3Info?.source === 'shop' ? 'shop rule' : big3Info?.source === 'insurer' ? 'insurer rule' : big3Info?.source === 'modal' ? 'edited here' : 'default'}</span></div>
                <Big3Picker rules={rules} onChange={onBig3} compact />
                <label className="flex items-center gap-2 text-[11px] mt-1.5" style={{ color: '#555' }}><input type="checkbox" checked={big3Save} onChange={e => setBig3Save(e.target.checked)} /> Remember for {shopName || 'this shop'}</label>{big3Msg && <div className="text-[11px] mt-1 font-semibold" style={{ color: big3Msg.startsWith('✗') ? '#b91c1c' : big3Msg.startsWith('✓') ? '#166534' : '#888' }}>{big3Msg}</div>}
              </div>)}
        </div>
      </Panel>

      {/* 3 · Every priced line; the usually-untouched parts fold */}
      <Panel title={`🎯 What the ${fromScrub ? 'scrub' : 'report'} found`} tone="blue" right={<span className="text-xs" style={{ color: '#1d4ed8' }}>{required.length} on</span>}>
        {required.length === 0 && <div className="px-4 py-2.5 text-sm" style={{ color: '#888' }}>Nothing on — switch one on or add a line.</div>}
        {required.map(cal => <Row key={cal._id} cal={cal} />)}
        {notRequired.length > 0 && <button type="button" onClick={() => setShowNotRequired(o => !o)} className="w-full text-left px-3 py-1.5 text-[11px] font-semibold" style={{ borderTop: '1px solid #f1f5f9', backgroundColor: '#fafaf9', color: '#666' }}>{showNotRequired ? '▾' : '▸'} {notRequired.length} not required · {showNotRequired ? 'hide' : 'show'}</button>}
        {showNotRequired && notRequired.map(cal => <Row key={cal._id} cal={cal} />)}
        {fellBack.length > 0 && <div className="mx-3 my-1.5 rounded-lg px-2.5 py-1.5 text-[11px]" style={{ backgroundColor: '#fffbeb', border: '1.5px solid #fde68a', color: '#92400e' }}><b>⚠ {fellBack.length} line{fellBack.length === 1 ? '' : 's'} had no {PRICE_NAMES[fellBack[0].pool_fallback] || fellBack[0].pool_fallback} item</b> — standard rate.</div>}


        <Fold openFold={openFold} setOpenFold={setOpenFold} id="add" icon="＋" label="Add a line" summary={onServices.length ? onServices.map(c => c.calibration_name).join(', ') : 'diagnostic, mechanical, programming, any Books item'}>
          {services.map(cal => (
            <div key={cal._id}>
              <div className="flex items-center gap-2.5 px-3" style={{ minHeight: 40 }}>
                <button type="button" onClick={() => toggleCal(cal._id)} className="w-10 h-6 rounded-full flex-shrink-0 relative" style={{ backgroundColor: cal.enabled ? GREEN : '#d6d3d1' }}><span className="absolute top-0.5 w-5 h-5 rounded-full bg-white" style={{ left: cal.enabled ? 18 : 2 }} /></button>
                <span className="flex-1 text-sm font-semibold" style={{ color: cal.enabled ? '#1a1a1a' : '#999' }}>{cal.calibration_name}</span>
                {cal.enabled && <div className="flex items-center gap-1"><button type="button" onClick={() => updateCalField(cal._id, 'quantity', Math.max(1, (cal.quantity || 1) - 1))} className="w-6 h-6 rounded-md font-bold text-sm" style={{ backgroundColor: '#f0eeec', color: '#555' }}>−</button><span className="w-5 text-center text-sm font-semibold">{cal.quantity || 1}</span><button type="button" onClick={() => updateCalField(cal._id, 'quantity', (cal.quantity || 1) + 1)} className="w-6 h-6 rounded-md font-bold text-sm" style={{ backgroundColor: '#f0eeec', color: '#555' }}>+</button></div>}
                {priceOf(cal) && <span className="text-sm tabular-nums font-semibold" style={{ color: cal.enabled ? '#1a1a1a' : '#aaa', minWidth: 48, textAlign: 'right' }}>${Number(priceOf(cal).rate).toFixed(0)}</span>}
              </div>
              {cal.enabled && <div className="px-3 pb-2"><input value={cal.description || ''} onChange={e => updateCalField(cal._id, 'description', e.target.value)} placeholder={cal.calibration_name === 'Diagnostic 1' ? 'What was diagnosed…' : 'What was done / replaced…'} className="w-full text-xs rounded-lg px-2.5 py-1.5" style={inp} /></div>}
            </div>
          ))}
          <div className="p-2.5"><LinePicker onAdd={addFromPicker} jobMake={jobData.make || ''} existingNames={existingNames} initialTab="calibration" /></div>
        </Fold>
      </Panel>

      {/* 4 · Dispatch — one row; the salesperson is whoever it's dispatched to */}
      <div className="rounded-2xl bg-white overflow-hidden" style={{ border: '1.5px solid #e8e4e0' }}>
        <div className="flex items-center gap-1.5 p-2">
          <span className="text-base flex-shrink-0" title="Dispatch">🚐</span>
          {[['need_dispatch', 'Dispatch'], ['jaden', 'Jayden'], ['mark', 'Mark']].map(([id, l]) => <button key={id} type="button" onClick={() => setDispatch(id)} disabled={busy} className="flex-1 text-xs font-bold rounded-lg py-2" style={dispatch === id ? { backgroundColor: ORANGE, color: 'white' } : { backgroundColor: 'white', color: '#555', border: '1px solid #e0dbd6' }}>{l}</button>)}
          <input type="date" value={jobDate} onChange={e => setJobDate(e.target.value)} className="text-xs rounded-lg px-1.5 py-1.5 flex-shrink-0" style={{ ...inp, width: 118, borderColor: jobDate === todayPT() ? '#e0dbd6' : '#e8710a' }} />
        </div>
        <div className="px-3 pb-2 text-[11px]" style={{ color: '#888' }}>👤 Salesperson: <b style={{ color: salesperson ? '#555' : RED }}>{salesperson?.name || (spList ? 'no Zoho salesperson for ' + (dispatch === 'jaden' ? 'Jayden' : 'Mark') : 'loading…')}</b> · follows who it's dispatched to</div>
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
    </div>
  )
}
