// New-look upload review (Mark 2026-09-14): the Kinetic-report review
// screen rebuilt on the Bill it review kit so the app reads the same
// front to back. Pure presentation — every handler and every piece of
// state still lives in ToggleBoard; this only lays it out.
// Density pass (Mark: "this is more the look I'm going for" → the Bill it
// screenshot): small type, 40px rows, two columns on desktop.
import { useState } from 'react'
import { Panel, Row, Eyebrow, Title, Field, Notice, Pill, Switch, Chip, Footer, PrimaryButton, fmt, ORANGE, GREEN } from '../ui/ReviewKit.jsx'
import CalibrationLine from './CalibrationLine.jsx'
import CustomerPicker from '../CustomerPicker'
import SalespersonPicker from '../SalespersonPicker'
import AddCalibration from './AddCalibration.jsx'
import { Big3Badge, DrpBadge, Big3Picker, describeRules } from '../books/Big3Rules.jsx'
import { VinCheck } from '../ui/VinDecode.jsx'

// Which price list the insurer name will land on (informational — the
// server decides for real in resolvePricingPool).
export function poolLabel(insurer, cashMode) {
  if (cashMode) return { label: '💵 Cash · CP schedule · $700 max', tone: 'green' }
  const s = String(insurer || '').toLowerCase()
  if (!s.trim()) return { label: '💵 No insurer → Cash', tone: 'green' }
  if (/state farm/.test(s)) return { label: 'State Farm pricing', tone: 'blue' }
  if (/allstate/.test(s)) return { label: 'Allstate pricing', tone: 'blue' }
  if (/american family|amfam/.test(s)) return { label: 'AmFam pricing', tone: 'blue' }
  return { label: 'Standard pricing', tone: 'gray' }
}

export default function ReviewLayout({
  jobData, cashMode, toggleCash,
  calibrations, rowPrices, toggleCal, updateCalField,
  showManualForm, setShowManualForm, addManual,
  selectedCustomer, setSelectedCustomer, setSelectedSalesperson, jobDate, setJobDate, todayPT,
  liveTotal, selected, removed,
  onCreate, creating, previewBusy, onCreateLegacy, creatingLegacy,
  invoiceError, kanbanWarning, resultCard, busy,
  dispatch = 'mark', setDispatch = () => {},
  poolOverride = null, onPool = () => {}, big3Rules = null, big3Info = null, onBig3 = () => {}, big3Save = true, setBig3Save = () => {},
  listTotal = null, cashCap = 700, setCashCap = () => {},
  onOldLook,
}) {
  const [showNotRequired, setShowNotRequired] = useState(false)
  const [copied, setCopied] = useState(false)
  const vehicle = [jobData.year, jobData.make, jobData.model].filter(Boolean).join(' ')
  const isService = c => c.calibration_name === 'Diagnostic 1' || c.calibration_name === 'Mechanical'
  const required = calibrations.filter(c => c.enabled && !isService(c))
  const notRequired = calibrations.filter(c => !c.enabled && !isService(c))
  const services = calibrations.filter(isService)
  const POOLS = [[null, 'Auto'], ['STD', 'Standard'], ['CP', '💵 Cash'], ['SF', 'State Farm'], ['AS', 'Allstate'], ['AMFAM', 'AmFam']]
  const poolName = { STD: 'Standard pricing', CP: '💵 Cash · CP schedule · $700 max', SF: 'State Farm pricing', AS: 'Allstate pricing', AMFAM: 'AmFam pricing' }
  const pool = poolOverride ? { label: poolName[poolOverride] || poolOverride, tone: poolOverride === 'CP' ? 'green' : 'blue' } : poolLabel(jobData.insurer, cashMode)
  const shopName = selectedCustomer?.name || jobData.shop || ''
  const canCreate = !!selectedCustomer && selected.length > 0 && !busy && !previewBusy
  const priceOf = c => rowPrices ? rowPrices[String(c.calibration_name || '').toLowerCase()] : null
  const veh = { year: jobData.year, make: jobData.make, model: jobData.model }

  async function copyVin() {
    try { await navigator.clipboard.writeText(jobData.vin || ''); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* ignore */ }
  }

  return (
    <>
      <div className="max-w-5xl mx-auto px-4 py-4 flex flex-col gap-3">
        {/* Header */}
        <div className="flex items-end justify-between gap-3 flex-wrap">
          <div>
            <Eyebrow>📄 Kinetic report · review before creating the job</Eyebrow>
            <Title sub={shopName ? shopName : 'Pick the Zoho customer below'}>{vehicle || 'Vehicle'}</Title>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Chip tone={pool.tone === 'gray' ? 'gray' : pool.tone}>{pool.label}</Chip>
            {/* Where the card lands on the Jobs board (Mark 2026-09-14) */}
            <div className="flex items-center gap-1 rounded-full p-0.5" style={{ backgroundColor: 'white', border: '1.5px solid #e0dbd6' }}>
              {[['need_dispatch', '📋 Ready to dispatch'], ['jaden', '👤 Jayden'], ['mark', '👤 Mark']].map(([id, label]) => (
                <button key={id} type="button" onClick={() => setDispatch(id)} disabled={busy}
                  className="rounded-full px-3 py-1.5 text-xs font-bold"
                  style={{ backgroundColor: dispatch === id ? ORANGE : 'transparent', color: dispatch === id ? 'white' : '#555' }}>{label}</button>
              ))}
            </div>
          </div>
        </div>

        {jobData._demo && (
          <Notice>🧪 <b>Demo mode</b> — {jobData._demoReason === 'billing' ? 'Anthropic API credits not found on this key.' : 'Sample data. Add Anthropic API credits to process real Kinetic reports.'}</Notice>
        )}

        <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-start">
          {/* ── Left column: job · customer · extras · internal ── */}
          <div className="md:col-span-2 flex flex-col gap-3">
            <Panel tone="blue" title="🚗 Job details" right={jobData.ro_number ? `RO# ${jobData.ro_number}` : ''} bodyClass="p-3">
              <div className="grid grid-cols-3 gap-2 mb-2">
                <Field label="Year" value={jobData.year} />
                <Field label="Make" value={jobData.make} />
                <Field label="Model" value={jobData.model} />
              </div>
              <div className="grid grid-cols-2 gap-2 mb-2">
                <Field label="Shop" value={shopName} />
                <Field label="Claim" value={jobData.claim} />
                <Field label="Insurer">
                  <span style={{ color: cashMode ? GREEN : '#1a1a1a' }}>{cashMode ? '💵 Cash' : (jobData.insurer || '—')}</span>
                </Field>
                <Field label="VIN" mono>
                  <span className="inline-flex items-center gap-2">{jobData.vin || '—'}{jobData.vin && <button type="button" onClick={copyVin} className="text-[10px] font-bold rounded-full px-2 py-0.5" style={{ backgroundColor: copied ? '#dcfce7' : '#f5f3f0', color: copied ? GREEN : '#555', border: '1px solid #e0dbd6' }}>{copied ? 'Copied ✓' : 'Copy'}</button>}{jobData.vin && <VinCheck vin={jobData.vin} expect={{ year: jobData.year, make: jobData.make, model: jobData.model }} />}</span>
                </Field>
              </div>
              {/* 💵 Swap to Cash — same rule, now a pill inside the panel */}
              <div className="flex items-center justify-between gap-3 rounded-lg px-2.5 py-2" style={{ backgroundColor: cashMode ? '#f0fdf4' : '#fafaf9', border: `1.5px solid ${cashMode ? '#86efac' : '#e7e5e4'}` }}>
                <div className="text-xs" style={{ color: cashMode ? '#166534' : '#555' }}>
                  <b>💵 {cashMode ? 'Cash job — CP pricing · $700 max' : 'Customer paying out of pocket?'}</b>
                  <div className="text-[11px]">{cashMode ? (String(jobData?.insurer || '').trim() ? 'Tap No to undo.' : 'Report had no insurer — tap No if it\'s an insurance job.') : 'Yes = CP schedule + $700 cap on the quote.'}</div>
                </div>
                <div className="flex gap-1">
                  <Pill on={!cashMode} onClick={() => cashMode && toggleCash()} tone="plain" disabled={busy} size="sm">No</Pill>
                  <Pill on={cashMode} onClick={() => !cashMode && toggleCash()} tone="green" disabled={busy} size="sm">Yes</Pill>
                </div>
              </div>
            </Panel>

            <Panel tone={selectedCustomer ? 'green' : 'amber'} title="🏢 Customer" right={selectedCustomer ? 'Zoho Books customer selected' : 'required before Create job'} bodyClass="p-3 space-y-2">
              <CustomerPicker shopName={jobData.shop} onSelect={setSelectedCustomer} />
              {!selectedCustomer && <div className="text-[11px] font-semibold" style={{ color: '#92400e' }}>Pick the shop, or use "➕ Create new customer" in the list — it opens the New Customer form and adds them to Zoho Books.</div>}
              {selectedCustomer?.name && (
                <div className="flex items-center gap-2 flex-wrap text-[11px]">
                  <Big3Badge shopName={selectedCustomer.name} size="sm" />
                  <DrpBadge shopName={selectedCustomer.name} size="sm" />
                  <span style={{ color: '#888' }}>Rule and discount on file — adjust in Pricing below.</span>
                </div>
              )}
              <SalespersonPicker onSelect={setSelectedSalesperson} />
              <div className="flex items-center gap-3 flex-wrap">
                <Eyebrow>Job date</Eyebrow>
                <input type="date" value={jobDate} onChange={e => setJobDate(e.target.value)} className="rounded-lg px-2.5 py-1.5 text-sm" style={{ border: `1px solid ${jobDate === todayPT() ? '#e0dbd6' : '#e8710a'}` }} />
                {jobDate !== todayPT() && <span className="text-xs font-semibold" style={{ color: '#e8710a' }}>books for {new Date(jobDate + 'T12:00').toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' })}</span>}
              </div>
            </Panel>

            {/* 💲 Pricing options on the main screen (Mark 2026-09-14: "all the pricing options should be here") */}
            <Panel tone="green" title="💲 Pricing" right={big3Info?.source === 'shop' ? `shop rule${big3Info.set_by ? ` · ${big3Info.set_by}` : ''}` : big3Info?.source === 'modal' ? 'edited here' : 'default rule'} bodyClass="p-3 space-y-2">
              <div>
                <Eyebrow>Price schedule</Eyebrow>
                <div className="flex flex-wrap gap-1 mt-1">
                  {POOLS.map(([id, label]) => (
                    <button key={String(id)} type="button" onClick={() => onPool(id)} disabled={busy}
                      className="rounded-full px-2.5 py-1 text-xs font-bold"
                      style={{ backgroundColor: (poolOverride ?? null) === id ? GREEN : 'white', color: (poolOverride ?? null) === id ? 'white' : '#555', border: `1.5px solid ${(poolOverride ?? null) === id ? GREEN : '#e0dbd6'}` }}>{label}</button>
                  ))}
                </div>
                <div className="text-[11px] mt-1" style={{ color: '#888' }}>Auto follows the insurer ({pool.label}). Lines re-price when you change it.</div>
              </div>
              {cashMode && (
                <div className="rounded-lg px-2.5 py-2" style={{ backgroundColor: '#f0fdf4', border: '1.5px solid #86efac' }}>
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="text-xs font-bold" style={{ color: '#166534' }}>💵 Cash cap
                      <span className="font-normal">{listTotal != null ? (cashCap > 0 && listTotal > cashCap ? ` · list ${fmt(listTotal)} → ${fmt(cashCap)} (cap line −${fmt(listTotal - cashCap)})` : cashCap > 0 ? ` · list ${fmt(listTotal)} is under the cap` : ` · no cap, bills list ${fmt(listTotal)}`) : ''}</span>
                    </div>
                    <div className="flex gap-1">
                      {[[700, '$700 max'], [350, '$350 max'], [0, 'No cap']].map(([v, label]) => (
                        <button key={v} type="button" onClick={() => setCashCap(v)} disabled={busy} className="rounded-full px-2.5 py-1 text-xs font-bold"
                          style={{ backgroundColor: cashCap === v ? GREEN : 'white', color: cashCap === v ? 'white' : '#166534', border: `1.5px solid ${cashCap === v ? GREEN : '#86efac'}` }}>{label}</button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
              <div>
                <div className="flex items-center justify-between gap-2">
                  <Eyebrow>🧾 Big 4 for {shopName || 'this shop'}</Eyebrow>
                  <span className="text-[11px]" style={{ color: '#166534' }}>{big3Rules ? describeRules(big3Rules) : ''}</span>
                </div>
                <div className="mt-1">
                  <Big3Picker rules={big3Rules || { cal_id: 'charge', pcsi: 'included', post_scan: 'included', snapshot: 'off' }} onChange={onBig3} compact />
                </div>
                <label className="flex items-center gap-2 text-[11px] mt-1.5" style={{ color: '#555' }}>
                  <input type="checkbox" checked={big3Save} onChange={e => setBig3Save(e.target.checked)} /> Remember for {shopName || 'this shop'} (every invoice from now on)
                </label>
              </div>
            </Panel>

            <Panel tone="plain" title="🔧 Extras" right="diagnostic · mechanical">
              {services.map(cal => (
                <div key={cal._id} style={{ borderTop: '1px solid #f1f5f9', backgroundColor: 'white' }}>
                  <div className="flex items-center gap-2.5 px-3" style={{ minHeight: 40 }}>
                    <Switch on={cal.enabled} onClick={() => toggleCal(cal._id)} />
                    <span className="flex-1 text-sm font-semibold" style={{ color: '#1a1a1a' }}>{cal.calibration_name}</span>
                    {cal.enabled && (
                      <div className="flex items-center gap-1">
                        <span className="text-xs" style={{ color: '#888' }}>Qty</span>
                        <button type="button" onClick={() => updateCalField(cal._id, 'quantity', Math.max(1, (cal.quantity || 1) - 1))} className="w-6 h-6 rounded-md font-bold text-sm" style={{ backgroundColor: '#f0eeec', color: '#555' }}>−</button>
                        <span className="w-5 text-center text-sm font-semibold">{cal.quantity || 1}</span>
                        <button type="button" onClick={() => updateCalField(cal._id, 'quantity', Math.min(99, (cal.quantity || 1) + 1))} className="w-6 h-6 rounded-md font-bold text-sm" style={{ backgroundColor: '#f0eeec', color: '#555' }}>+</button>
                      </div>
                    )}
                  </div>
                  {cal.enabled && (
                    <div className="px-3 pb-2.5">
                      <textarea value={cal.description || ''} onChange={e => updateCalField(cal._id, 'description', e.target.value)} rows={2}
                        placeholder={cal.calibration_name === 'Diagnostic 1' ? 'What was diagnosed…' : 'What was done / replaced…'}
                        className="w-full text-xs rounded-lg px-2.5 py-1.5" style={{ border: '1px solid #e0dbd6', backgroundColor: '#fafaf8', resize: 'vertical', outline: 'none' }} />
                    </div>
                  )}
                </div>
              ))}
            </Panel>

            {/* Absolute ADAS Books path — used internally (Mark 2026-09-14), kept visible */}
            {!resultCard && (
              <Panel tone="blue" title="🧪 Absolute ADAS Books" right="internal · no Zoho" bodyClass="p-3 flex items-center justify-between gap-2 flex-wrap">
                <div className="text-xs" style={{ color: '#555' }}>Creates the job in Absolute ADAS Books only.</div>
                <button type="button" onClick={onCreateLegacy} disabled={selected.length === 0 || busy} className="rounded-lg px-3 py-1.5 text-xs font-bold" style={{ backgroundColor: '#eff6ff', color: '#2563eb', border: '1.5px solid #bfdbfe', opacity: selected.length === 0 || busy ? .5 : 1 }}>
                  {creatingLegacy ? 'Creating…' : 'Create a Job (Absolute ADAS Books)'}
                </button>
              </Panel>
            )}
          </div>

          {/* ── Right column: calibrations ── */}
          <div className="md:col-span-3 flex flex-col gap-3">
            <Panel tone="orange" title="🎯 Calibrations" right={`${required.length} on · ${notRequired.length} not required`}>
              {required.length === 0 && <Row left={<span style={{ color: '#888' }}>Nothing switched on yet — turn on what this repair needs.</span>} />}
              {required.map(cal => (
                <CalibrationLine key={cal._id} cal={cal} onToggle={() => toggleCal(cal._id)} price={priceOf(cal)} onField={(f, v) => updateCalField(cal._id, f, v)} vehicle={veh} />
              ))}
              {notRequired.length > 0 && (
                <button type="button" onClick={() => setShowNotRequired(o => !o)} className="w-full text-left px-3 py-2 text-xs font-semibold" style={{ borderTop: '1px solid #f1f5f9', backgroundColor: '#fafaf9', color: '#666' }}>
                  {showNotRequired ? '▾' : '▸'} {notRequired.length} not required for this repair · {showNotRequired ? 'hide' : 'show'}
                </button>
              )}
              {showNotRequired && notRequired.map(cal => (
                <CalibrationLine key={cal._id} cal={cal} onToggle={() => toggleCal(cal._id)} price={priceOf(cal)} onField={(f, v) => updateCalField(cal._id, f, v)} vehicle={veh} />
              ))}
              <div className="px-3 py-2" style={{ borderTop: '1px solid #f1f5f9' }}>
                {showManualForm ? (
                  <AddCalibration existingNames={calibrations.map(c => c.calibration_name)} vehicle={veh} onAdd={cal => { addManual(cal); setShowManualForm(false) }} onCancel={() => setShowManualForm(false)} />
                ) : (
                  <button type="button" onClick={() => setShowManualForm(true)} className="w-full rounded-lg py-2 text-sm font-bold" style={{ border: `1.5px dashed ${ORANGE}`, color: ORANGE, backgroundColor: 'white' }}>＋ Add a calibration Kinetic missed</button>
                )}
              </div>
            </Panel>
          </div>
        </div>

        {invoiceError && <Notice tone="red">{invoiceError}</Notice>}
        {kanbanWarning && <Notice>⚠️ {kanbanWarning}</Notice>}
        {resultCard}

        <div className="text-center"><button type="button" onClick={onOldLook} className="text-xs" style={{ color: '#aaa' }}>switch to the old look</button></div>
        <div style={{ height: 8 }} />
      </div>

      {/* Sticky footer */}
      {!resultCard && (
        <Footer
          note={!selectedCustomer ? 'Pick the Zoho customer to enable Create job' : selected.length === 0 ? 'Turn on at least one calibration' : null}
          secondary={<div className="flex-1 flex items-center gap-3 px-1"><span className="text-xl font-extrabold tabular-nums" style={{ color: '#1a1a1a' }}>{liveTotal != null ? fmt(liveTotal) : '—'}</span><span className="text-xs" style={{ color: '#666' }}><b style={{ color: ORANGE }}>{selected.length}</b> selected · {removed.length} off</span></div>}
          primary={<PrimaryButton tone="orange" onClick={onCreate} disabled={!canCreate}>{creating ? 'Creating job…' : previewBusy ? 'Pricing lines…' : `Create job${liveTotal != null ? ` — ${fmt(liveTotal)}` : ''} → ${dispatch === 'need_dispatch' ? 'Ready to dispatch' : dispatch === 'jaden' ? 'Jayden' : 'Mark'}`}</PrimaryButton>}
        />
      )}
    </>
  )
}
