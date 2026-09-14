// New-look upload review (Mark 2026-09-14): the Kinetic-report review
// screen rebuilt on the Bill it review kit so the app reads the same
// front to back. Pure presentation — every handler and every piece of
// state still lives in ToggleBoard; this only lays it out.
import { useState } from 'react'
import { Panel, Row, Eyebrow, Title, Field, Notice, Pill, Switch, Chip, Footer, PrimaryButton, SecondaryButton, fmt, ORANGE, GREEN } from '../ui/ReviewKit.jsx'
import CalibrationLine from './CalibrationLine.jsx'
import CustomerPicker from '../CustomerPicker'
import SalespersonPicker from '../SalespersonPicker'
import ManualAddForm from '../ManualAddForm'
import { Big3Badge, DrpBadge } from '../books/Big3Rules.jsx'

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
  onOldLook,
}) {
  const [showNotRequired, setShowNotRequired] = useState(false)
  const [copied, setCopied] = useState(false)
  const vehicle = [jobData.year, jobData.make, jobData.model].filter(Boolean).join(' ')
  const isService = c => c.calibration_name === 'Diagnostic 1' || c.calibration_name === 'Mechanical'
  const required = calibrations.filter(c => c.enabled && !isService(c))
  const notRequired = calibrations.filter(c => !c.enabled && !isService(c))
  const services = calibrations.filter(isService)
  const pool = poolLabel(jobData.insurer, cashMode)
  const shopName = selectedCustomer?.name || jobData.shop || ''
  const canCreate = !!selectedCustomer && selected.length > 0 && !busy && !previewBusy
  const priceOf = c => rowPrices ? rowPrices[String(c.calibration_name || '').toLowerCase()] : null

  async function copyVin() {
    try { await navigator.clipboard.writeText(jobData.vin || ''); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* ignore */ }
  }

  return (
    <>
      <div className="max-w-3xl mx-auto px-4 py-5 flex flex-col gap-4">
        {/* Header */}
        <div className="flex items-end justify-between gap-3 flex-wrap">
          <div>
            <Eyebrow>📄 Kinetic report · review before creating the job</Eyebrow>
            <Title sub={shopName ? shopName : 'Pick the Zoho customer below'}>{vehicle || 'Vehicle'}</Title>
          </div>
          <div className="flex items-center gap-2">
            <Chip tone={pool.tone === 'gray' ? 'gray' : pool.tone}>{pool.label}</Chip>
          </div>
        </div>

        {jobData._demo && (
          <Notice>🧪 <b>Demo mode</b> — {jobData._demoReason === 'billing' ? 'Anthropic API credits not found on this key.' : 'Sample data. Add Anthropic API credits to process real Kinetic reports.'}</Notice>
        )}

        {/* Job details */}
        <Panel tone="blue" title="🚗 Job details" right={jobData.ro_number ? `RO# ${jobData.ro_number}` : ''} bodyClass="p-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-3">
            <Field label="Year" value={jobData.year} />
            <Field label="Make" value={jobData.make} />
            <Field label="Model" value={jobData.model} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
            <Field label="Shop" value={shopName} />
            <Field label="Claim" value={jobData.claim} />
            <Field label="Insurer">
              <span style={{ color: cashMode ? GREEN : '#1a1a1a' }}>{cashMode ? '💵 Cash' : (jobData.insurer || '—')}</span>
            </Field>
            <Field label="VIN" mono>
              <span className="inline-flex items-center gap-2">{jobData.vin || '—'}{jobData.vin && <button type="button" onClick={copyVin} className="text-[11px] font-bold rounded-full px-2 py-0.5" style={{ backgroundColor: copied ? '#dcfce7' : '#f5f3f0', color: copied ? GREEN : '#555', border: '1px solid #e0dbd6' }}>{copied ? 'Copied ✓' : 'Copy'}</button>}</span>
            </Field>
          </div>
          {/* 💵 Swap to Cash — same rule, now a pill inside the panel */}
          <div className="flex items-center justify-between gap-3 rounded-xl px-3 py-2.5" style={{ backgroundColor: cashMode ? '#f0fdf4' : '#fafaf9', border: `1.5px solid ${cashMode ? '#86efac' : '#e7e5e4'}` }}>
            <div className="text-sm" style={{ color: cashMode ? '#166534' : '#555' }}>
              <b>💵 {cashMode ? 'Cash job — CP pricing · $700 max' : 'Customer paying out of pocket?'}</b>
              <div className="text-xs">{cashMode ? (String(jobData?.insurer || '').trim() ? 'Tap No to undo.' : 'Report had no insurer — tap No if it\'s an insurance job.') : 'Yes = CP schedule + $700 cap on the quote.'}</div>
            </div>
            <div className="flex gap-1">
              <Pill on={!cashMode} onClick={() => cashMode && toggleCash()} tone="plain" disabled={busy}>No</Pill>
              <Pill on={cashMode} onClick={() => !cashMode && toggleCash()} tone="green" disabled={busy}>Yes</Pill>
            </div>
          </div>
        </Panel>

        {/* Customer · salesperson · date */}
        <Panel tone={selectedCustomer ? 'green' : 'amber'} title="🏢 Customer" right={selectedCustomer ? 'Zoho Books customer selected' : 'required before Create job'} bodyClass="p-4 space-y-3">
          <CustomerPicker shopName={jobData.shop} onSelect={setSelectedCustomer} />
          {!selectedCustomer && <div className="text-xs font-semibold" style={{ color: '#92400e' }}>Pick the shop, or use "➕ Create new customer" in the list — it opens the New Customer form and adds them to Zoho Books.</div>}
          {selectedCustomer?.name && (
            <div className="flex items-center gap-2 flex-wrap text-xs">
              <Big3Badge shopName={selectedCustomer.name} size="sm" />
              <DrpBadge shopName={selectedCustomer.name} size="sm" />
              <span style={{ color: '#888' }}>Big 4 + discount apply at the pricing step — change them there if this job is different.</span>
            </div>
          )}
          <SalespersonPicker onSelect={setSelectedSalesperson} />
          <div className="flex items-center gap-3 flex-wrap">
            <Eyebrow>Job date</Eyebrow>
            <input type="date" value={jobDate} onChange={e => setJobDate(e.target.value)} className="rounded-lg px-3 py-2 text-base" style={{ border: `1px solid ${jobDate === todayPT() ? '#e0dbd6' : '#e8710a'}` }} />
            {jobDate !== todayPT() && <span className="text-xs font-semibold" style={{ color: '#e8710a' }}>books for {new Date(jobDate + 'T12:00').toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' })}</span>}
          </div>
        </Panel>

        {/* Calibrations */}
        <Panel tone="orange" title="🎯 Calibrations" right={`${required.length} on · ${notRequired.length} not required`}>
          {required.length === 0 && <Row left={<span style={{ color: '#888' }}>Nothing switched on yet — turn on what this repair needs.</span>} />}
          {required.map(cal => (
            <CalibrationLine key={cal._id} cal={cal} onToggle={() => toggleCal(cal._id)} price={priceOf(cal)} onField={(f, v) => updateCalField(cal._id, f, v)} vehicle={{ year: jobData.year, make: jobData.make, model: jobData.model }} />
          ))}
          {notRequired.length > 0 && (
            <button type="button" onClick={() => setShowNotRequired(o => !o)} className="w-full text-left px-4 py-3 text-sm font-semibold" style={{ borderTop: '1px solid #f1f5f9', backgroundColor: '#fafaf9', color: '#666' }}>
              {showNotRequired ? '▾' : '▸'} {notRequired.length} not required for this repair · {showNotRequired ? 'hide' : 'show'}
            </button>
          )}
          {showNotRequired && notRequired.map(cal => (
            <CalibrationLine key={cal._id} cal={cal} onToggle={() => toggleCal(cal._id)} price={priceOf(cal)} onField={(f, v) => updateCalField(cal._id, f, v)} vehicle={{ year: jobData.year, make: jobData.make, model: jobData.model }} />
          ))}
          <div className="px-4 py-3" style={{ borderTop: '1px solid #f1f5f9' }}>
            {showManualForm ? (
              <ManualAddForm onAdd={addManual} onCancel={() => setShowManualForm(false)} />
            ) : (
              <button type="button" onClick={() => setShowManualForm(true)} className="w-full rounded-xl py-3 text-sm font-bold" style={{ border: `1.5px dashed ${ORANGE}`, color: ORANGE, backgroundColor: 'white' }}>＋ Add a missed calibration</button>
            )}
          </div>
        </Panel>

        {/* Extras: Diagnostic 1 / Mechanical */}
        <Panel tone="plain" title="🔧 Extras" right="diagnostic · mechanical">
          {services.map(cal => (
            <div key={cal._id} style={{ borderTop: '1px solid #f1f5f9', backgroundColor: 'white' }}>
              <div className="flex items-center gap-3 px-4" style={{ minHeight: 52 }}>
                <Switch on={cal.enabled} onClick={() => toggleCal(cal._id)} />
                <span className="flex-1 text-base font-semibold" style={{ color: '#1a1a1a' }}>{cal.calibration_name}</span>
                {cal.enabled && (
                  <div className="flex items-center gap-1">
                    <span className="text-xs" style={{ color: '#888' }}>Qty</span>
                    <button type="button" onClick={() => updateCalField(cal._id, 'quantity', Math.max(1, (cal.quantity || 1) - 1))} className="w-7 h-7 rounded-lg font-bold" style={{ backgroundColor: '#f0eeec', color: '#555' }}>−</button>
                    <span className="w-6 text-center text-base font-semibold">{cal.quantity || 1}</span>
                    <button type="button" onClick={() => updateCalField(cal._id, 'quantity', Math.min(99, (cal.quantity || 1) + 1))} className="w-7 h-7 rounded-lg font-bold" style={{ backgroundColor: '#f0eeec', color: '#555' }}>+</button>
                  </div>
                )}
              </div>
              {cal.enabled && (
                <div className="px-4 pb-3">
                  <textarea value={cal.description || ''} onChange={e => updateCalField(cal._id, 'description', e.target.value)} rows={2}
                    placeholder={cal.calibration_name === 'Diagnostic 1' ? 'What was diagnosed…' : 'What was done / replaced…'}
                    className="w-full text-sm rounded-lg px-3 py-2" style={{ border: '1px solid #e0dbd6', backgroundColor: '#fafaf8', resize: 'vertical', outline: 'none' }} />
                </div>
              )}
            </div>
          ))}
        </Panel>

        {invoiceError && <Notice tone="red">{invoiceError}</Notice>}
        {kanbanWarning && <Notice>⚠️ {kanbanWarning}</Notice>}
        {resultCard}

        {/* Absolute ADAS Books path — used internally (Mark 2026-09-14), kept visible */}
        {!resultCard && (
          <Panel tone="blue" title="🧪 Absolute ADAS Books" right="internal · no Zoho side effects" bodyClass="p-4 flex items-center justify-between gap-3 flex-wrap">
            <div className="text-sm" style={{ color: '#555' }}>Creates the job in Absolute ADAS Books only. Use this for internal jobs and testing.</div>
            <button type="button" onClick={onCreateLegacy} disabled={selected.length === 0 || busy} className="rounded-xl px-4 py-2.5 text-sm font-bold" style={{ backgroundColor: '#eff6ff', color: '#2563eb', border: '1.5px solid #bfdbfe', opacity: selected.length === 0 || busy ? .5 : 1 }}>
              {creatingLegacy ? 'Creating…' : 'Create a Job (Absolute ADAS Books)'}
            </button>
          </Panel>
        )}
        <div className="text-center"><button type="button" onClick={onOldLook} className="text-xs" style={{ color: '#aaa' }}>switch to the old look</button></div>
        <div style={{ height: 8 }} />
      </div>

      {/* Sticky footer */}
      {!resultCard && (
        <Footer
          note={!selectedCustomer ? 'Pick the Zoho customer to enable Create job' : selected.length === 0 ? 'Turn on at least one calibration' : null}
          secondary={<div className="flex-1 flex items-center gap-3 px-1"><span className="text-2xl font-extrabold tabular-nums" style={{ color: '#1a1a1a' }}>{liveTotal != null ? fmt(liveTotal) : '—'}</span><span className="text-sm" style={{ color: '#666' }}><b style={{ color: ORANGE }}>{selected.length}</b> selected · {removed.length} off</span></div>}
          primary={<PrimaryButton tone="orange" onClick={onCreate} disabled={!canCreate}>{creating ? 'Creating job…' : previewBusy ? 'Pricing lines…' : `Create job${liveTotal != null ? ` — ${fmt(liveTotal)}` : ''} →`}</PrimaryButton>}
        />
      )}
    </>
  )
}
