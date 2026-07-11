// Scaling — pipeline board for spinning up a new technician + van.
// One pipeline per scale-up. Columns are the six phases of the playbook
// (hire → train → van → buildout → tools → systems); cards are tasks with
// tap-to-cycle status pills. Deadlines are derived backwards from the
// target go-live date (Autel orders run ~3 weeks lead from Automotive
// Equipment Specialists; training runs a full month in the van with Mark).

import { useState, useEffect, useRef, useCallback } from 'react'
import { API_BASE, apiFetch } from '../utils/api.js'
import Navbar from './Navbar'

const ORANGE = '#CD4419'

const PHASES = [
  { id: 'hire',     label: 'Hire',         emoji: '🧑‍🔧' },
  { id: 'train',    label: 'Train',        emoji: '📚' },
  { id: 'van',      label: 'Van',          emoji: '🚐' },
  { id: 'buildout', label: 'Van Buildout', emoji: '🔧' },
  { id: 'tools',    label: 'Tools',        emoji: '🛠️' },
  { id: 'systems',  label: 'Systems',      emoji: '💻' },
]

// Task status pills — bright, color-coded, tap to cycle
const STATUS_ORDER = ['todo', 'progress', 'waiting', 'done']
const STATUS_INFO = {
  todo:     { label: '⚪ Not Started', bg: '#f5f3f0', color: '#57534e', border: '#e0dbd6' },
  progress: { label: '🔵 In Progress', bg: '#dbeafe', color: '#1d4ed8', border: '#bfdbfe' },
  waiting:  { label: '🟡 Waiting',     bg: '#fef3c7', color: '#b45309', border: '#fde68a' },
  done:     { label: '🟢 Done',        bg: '#dcfce7', color: '#15803d', border: '#bbf7d0' },
}

// Default playbook seeded into every new pipeline.
// leadWeeks = weeks before go-live this task must START to not be the bottleneck.
const DEFAULT_TASKS = [
  // Hire
  { phase: 'hire', title: 'Post job listing', weight: 2, leadWeeks: 10 },
  { phase: 'hire', title: 'Interview candidates', weight: 4, leadWeeks: 8 },
  { phase: 'hire', title: 'Hire technician', weight: 9, leadWeeks: 6, badge: '🎯 START OF TRAINING CLOCK' },
  // Train
  { phase: 'train', title: 'Month of training — riding with Mark in the van', weight: 15, leadWeeks: 5, badge: '⏱ 1 MONTH' },
  { phase: 'train', title: 'Sign-off: tech runs calibrations solo', weight: 5, leadWeeks: 1 },
  // Van
  { phase: 'van', title: 'Find 2023+ ProMaster High Roof', weight: 5, leadWeeks: 10 },
  { phase: 'van', title: 'Get van financing approved', weight: 5, leadWeeks: 9 },
  { phase: 'van', title: 'Purchase van', weight: 10, leadWeeks: 8 },
  { phase: 'van', title: 'Add van to insurance', weight: 5, leadWeeks: 8 },
  // Buildout
  { phase: 'buildout', title: 'Hire van buildout contractor', weight: 3, leadWeeks: 7 },
  { phase: 'buildout', title: 'Order shelving', weight: 2, leadWeeks: 7 },
  { phase: 'buildout', title: 'Front windows tinted', weight: 2, leadWeeks: 5 },
  { phase: 'buildout', title: 'Van wrapped — white base, "SAME DAY. DONE RIGHT."', weight: 5, leadWeeks: 5 },
  { phase: 'buildout', title: 'Install shelving', weight: 4, leadWeeks: 4 },
  { phase: 'buildout', title: 'Install power inverter', weight: 4, leadWeeks: 4 },
  // Tools
  { phase: 'tools', title: 'Line up tool financing (Autel in-house / Affirm)', weight: 3, leadWeeks: 6 },
  { phase: 'tools', title: 'Order Autel package — Automotive Equipment Specialists', weight: 7, leadWeeks: 5, badge: '⏱ 3 WK LEAD', link: 'https://automotiveequipmentspecialists.com' },
  { phase: 'tools', title: 'Receive tools + load van', weight: 5, leadWeeks: 1 },
  // Systems
  { phase: 'systems', title: 'Add tech to Zoho People + payroll', weight: 2, leadWeeks: 2 },
  { phase: 'systems', title: 'Add tech to Absolute ADAS app', weight: 2, leadWeeks: 2 },
  { phase: 'systems', title: 'Add tech to Kinetic', weight: 1, leadWeeks: 2 },
]

// Per-van Autel loadout (Automotive Equipment Specialists, prices 2026-07).
const VAN_LOADOUT = [
  { item: 'MA600 All-Systems Package w/ MS909 S2 Tablet', sku: 'MAS20T', qty: 1, price: 26985 },
  { item: 'TS508WFK-1 TPMS Kit (tool + 8 sensors)', sku: '700020', qty: 1, price: 419.95 },
  { item: 'MaxiBAS BT508 Battery Tester', sku: 'BT508', qty: 1, price: 295 },
  { item: 'Powerscan PS100', sku: 'PS100', qty: 1, price: 71.99 },
  { item: 'MA600 Crossbar Extensions', sku: 'MA600EXT', qty: 2, price: 230 },
  { item: 'Subaru Target 3-Pack (Mono Cam / EyeSight 2023+)', sku: '611-05', qty: 1, price: 625 },
  { item: 'Toyota/Lexus AVM Target + Bracket', sku: 'CSC0804-03', qty: 3, price: 249 },
  { item: 'Toyota AVM Strip Kit D8–D12', sku: 'CSC1004-10-D8-D12', qty: 2, price: 150 },
  { item: 'Toyota PVM Expansion Kit D13–D19', sku: 'CSC1004-10-D13-D19', qty: 2, price: 240 },
  { item: 'Subaru Calibration Mat Set', sku: 'CSC1014-17-18A-18B', qty: 1, price: 999 },
  { item: 'Ford AVM Pattern Package', sku: 'CSC1004-05', qty: 1, price: 1795 },
  { item: 'VW/Audi/Porsche AVM Pattern Package', sku: 'CSC1004-07', qty: 1, price: 1050 },
]
const LOADOUT_TOTAL = VAN_LOADOUT.reduce((s, l) => s + l.qty * l.price, 0)

// Cost tracker defaults — tools are real numbers, the rest get filled in as quotes land.
const DEFAULT_COSTS = [
  { label: 'Autel tools + targets (full loadout)', est: Math.round(LOADOUT_TOTAL * 100) / 100 },
  { label: 'Van — 2023+ ProMaster High Roof', est: 0 },
  { label: 'Van wrap', est: 0 },
  { label: 'Window tint (fronts)', est: 0 },
  { label: 'Shelving', est: 0 },
  { label: 'Power inverter', est: 0 },
  { label: 'Buildout labor', est: 0 },
]

function newPipelineData() {
  return {
    tasks: DEFAULT_TASKS.map((t, i) => ({ id: `t${i}`, status: 'todo', note: '', ...t })),
    costs: DEFAULT_COSTS.map((c, i) => ({ id: `c${i}`, actual: 0, ...c })),
  }
}

function fmtMoney(n) {
  return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(d) {
  if (!d) return ''
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// Task start-by date derived from go-live minus lead weeks
function startBy(targetDate, leadWeeks) {
  if (!targetDate || leadWeeks == null) return null
  const d = new Date(targetDate + 'T12:00:00')
  d.setDate(d.getDate() - leadWeeks * 7)
  return d
}

function isOverdue(targetDate, task) {
  if (task.status === 'done' || !targetDate || task.leadWeeks == null) return false
  const s = startBy(targetDate, task.leadWeeks)
  return s && s < new Date() && task.status === 'todo'
}

export default function ScalingScreen(props) {
  const [pipelines, setPipelines] = useState(null) // null = loading
  const [activeId, setActiveId] = useState(null)
  const [error, setError] = useState(null)
  const [showLoadout, setShowLoadout] = useState(false)
  const [showCosts, setShowCosts] = useState(false)
  const [saving, setSaving] = useState(false)
  const saveTimer = useRef(null)

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(`${API_BASE}/api/scaling`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load')
      setPipelines(data.pipelines || [])
      setActiveId(prev => prev || data.pipelines?.[0]?.id || null)
      setError(null)
    } catch (e) {
      setError(e.message)
      setPipelines([])
    }
  }, [])

  useEffect(() => { load() }, [load])

  const active = (pipelines || []).find(p => p.id === activeId) || null

  // Debounced save of the active pipeline
  const scheduleSave = useCallback((pipeline) => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      try {
        setSaving(true)
        await apiFetch(`${API_BASE}/api/scaling/${pipeline.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: pipeline.name,
            target_date: pipeline.target_date,
            status: pipeline.status,
            data: pipeline.data,
          }),
        })
      } catch { /* keep local state; next edit retries */ }
      finally { setSaving(false) }
    }, 600)
  }, [])

  function updateActive(mutate) {
    setPipelines(prev => prev.map(p => {
      if (p.id !== activeId) return p
      const next = mutate(structuredClone(p))
      scheduleSave(next)
      return next
    }))
  }

  async function createPipeline() {
    const name = window.prompt('Name this scale-up (e.g. "Van 3 — Tech #3")')
    if (!name) return
    const target = window.prompt('Target go-live date (YYYY-MM-DD), or leave blank') || ''
    try {
      const res = await apiFetch(`${API_BASE}/api/scaling`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, target_date: target, data: newPipelineData() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to create')
      setPipelines(prev => [data.pipeline, ...(prev || [])])
      setActiveId(data.pipeline.id)
    } catch (e) { setError(e.message) }
  }

  async function deletePipeline(p) {
    if (!window.confirm(`Delete "${p.name}" and all its progress?`)) return
    try {
      await apiFetch(`${API_BASE}/api/scaling/${p.id}`, { method: 'DELETE' })
      setPipelines(prev => prev.filter(x => x.id !== p.id))
      if (activeId === p.id) setActiveId(null)
    } catch (e) { setError(e.message) }
  }

  function cycleStatus(taskId) {
    updateActive(p => {
      const t = p.data.tasks.find(t => t.id === taskId)
      if (t) t.status = STATUS_ORDER[(STATUS_ORDER.indexOf(t.status) + 1) % STATUS_ORDER.length]
      return p
    })
  }

  const tasks = active?.data?.tasks || []
  const doneCount = tasks.filter(t => t.status === 'done').length
  // Weighted progress: each task carries its % share of the whole job
  // (weights sum to 100 in the default playbook; tasks missing a weight
  // from older pipelines fall back to an equal share).
  const fallbackW = tasks.length ? 100 / tasks.length : 0
  const w = t => (Number.isFinite(t.weight) ? t.weight : fallbackW)
  const totalWeight = tasks.reduce((s, t) => s + w(t), 0)
  const doneWeight = tasks.filter(t => t.status === 'done').reduce((s, t) => s + w(t), 0)
  const pct = totalWeight ? Math.round((doneWeight / totalWeight) * 100) : 0
  const costs = active?.data?.costs || []
  const estTotal = costs.reduce((s, c) => s + Number(c.est || 0), 0)
  const actualTotal = costs.reduce((s, c) => s + Number(c.actual || 0), 0)

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#f5f3f0' }}>
      <Navbar {...props} />
      <div className="max-w-[1400px] mx-auto px-4 py-6">

        {/* Header row */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h1 className="text-xl font-bold" style={{ color: '#1a1a1a' }}>Scaling</h1>
            <p className="text-sm" style={{ color: '#888' }}>The playbook for adding a tech + van. Tap a status pill to move a task along.</p>
          </div>
          <div className="flex items-center gap-2">
            {saving && <span className="text-xs" style={{ color: '#aaa' }}>Saving…</span>}
            <button onClick={() => setShowLoadout(true)}
              className="text-sm font-medium px-3 py-1.5 rounded-lg"
              style={{ backgroundColor: 'white', border: '1px solid #e0dbd6', color: '#57534e' }}>
              🛠️ Van Loadout ({fmtMoney(LOADOUT_TOTAL)})
            </button>
            <button onClick={createPipeline}
              className="text-sm font-semibold px-3 py-1.5 rounded-lg text-white"
              style={{ backgroundColor: ORANGE }}>
              + New Scale-Up
            </button>
          </div>
        </div>

        {error && (
          <div className="rounded-xl p-4 mb-4 text-sm" style={{ backgroundColor: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c' }}>
            {error}{error.includes('table') && ' — create the ScalingPipeline table in the Catalyst console (see README note in routes/scaling.js).'}
          </div>
        )}

        {pipelines === null && <p className="text-sm" style={{ color: '#888' }}>Loading…</p>}

        {pipelines !== null && pipelines.length === 0 && !error && (
          <div className="rounded-xl p-8 text-center" style={{ backgroundColor: 'white', border: '1px solid #e8e4e0' }}>
            <p className="text-3xl mb-2">🚐</p>
            <p className="font-semibold mb-1" style={{ color: '#1a1a1a' }}>No scale-ups yet</p>
            <p className="text-sm mb-4" style={{ color: '#888' }}>Start one when you're ready to add the next tech and van.</p>
            <button onClick={createPipeline} className="text-sm font-semibold px-4 py-2 rounded-lg text-white" style={{ backgroundColor: ORANGE }}>
              + New Scale-Up
            </button>
          </div>
        )}

        {/* Pipeline tabs */}
        {(pipelines || []).length > 0 && (
          <div className="flex flex-wrap items-center gap-2 mb-4">
            {pipelines.map(p => (
              <button key={p.id} onClick={() => setActiveId(p.id)}
                className="text-sm font-medium px-3 py-1.5 rounded-full"
                style={p.id === activeId
                  ? { backgroundColor: ORANGE, color: 'white' }
                  : { backgroundColor: 'white', color: '#57534e', border: '1px solid #e0dbd6' }}>
                {p.name}
              </button>
            ))}
          </div>
        )}

        {active && (
          <>
            {/* Summary bar: target date, progress, costs */}
            <div className="rounded-xl p-4 mb-4 flex flex-wrap items-center gap-x-6 gap-y-3" style={{ backgroundColor: 'white', border: '1px solid #e8e4e0' }}>
              <div>
                <label className="block text-xs mb-0.5" style={{ color: '#aaa' }}>Target go-live</label>
                <input type="date" value={active.target_date || ''}
                  onChange={e => updateActive(p => { p.target_date = e.target.value; return p })}
                  className="text-sm font-medium rounded-md px-2 py-1"
                  style={{ border: '1px solid #e0dbd6', color: '#1a1a1a', backgroundColor: 'white' }} />
              </div>
              <div className="flex-1 min-w-[160px]">
                <div className="flex justify-between text-xs mb-1" style={{ color: '#888' }}>
                  <span>{doneCount}/{tasks.length} tasks done</span><span>{pct}%</span>
                </div>
                <div className="h-2 rounded-full" style={{ backgroundColor: '#f0ece8' }}>
                  <div className="h-2 rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: pct === 100 ? '#15803d' : ORANGE }} />
                </div>
              </div>
              <button onClick={() => setShowCosts(s => !s)} className="text-sm font-medium px-3 py-1.5 rounded-lg" style={{ backgroundColor: '#f5f3f0', color: '#57534e' }}>
                💰 {fmtMoney(actualTotal || estTotal)} {actualTotal ? 'spent' : 'est.'}
              </button>
              <button onClick={() => deletePipeline(active)} className="text-xs" style={{ color: '#c2410c' }}>Delete</button>
            </div>

            {/* Cost tracker */}
            {showCosts && (
              <div className="rounded-xl p-4 mb-4" style={{ backgroundColor: 'white', border: '1px solid #e8e4e0' }}>
                <h3 className="font-semibold text-sm mb-3" style={{ color: '#1a1a1a' }}>Cost Tracker</h3>
                <div className="space-y-2">
                  {costs.map(c => (
                    <div key={c.id} className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="flex-1 min-w-[200px]" style={{ color: '#57534e' }}>{c.label}</span>
                      <label className="text-xs" style={{ color: '#aaa' }}>est.</label>
                      <input type="number" value={c.est || ''} placeholder="0"
                        onChange={e => updateActive(p => { const x = p.data.costs.find(x => x.id === c.id); if (x) x.est = Number(e.target.value || 0); return p })}
                        className="w-28 rounded-md px-2 py-1 text-right" style={{ border: '1px solid #e0dbd6' }} />
                      <label className="text-xs" style={{ color: '#aaa' }}>actual</label>
                      <input type="number" value={c.actual || ''} placeholder="0"
                        onChange={e => updateActive(p => { const x = p.data.costs.find(x => x.id === c.id); if (x) x.actual = Number(e.target.value || 0); return p })}
                        className="w-28 rounded-md px-2 py-1 text-right" style={{ border: '1px solid #e0dbd6' }} />
                    </div>
                  ))}
                </div>
                <div className="flex justify-end gap-6 mt-3 pt-3 text-sm font-semibold" style={{ borderTop: '1px solid #f0ece8', color: '#1a1a1a' }}>
                  <span>Est: {fmtMoney(estTotal)}</span>
                  <span>Actual: {fmtMoney(actualTotal)}</span>
                </div>
              </div>
            )}

            {/* Phase board — horizontal scroll desktop, stacked mobile */}
            <div className="flex gap-4 overflow-x-auto pb-4 flex-col md:flex-row">
              {PHASES.map(phase => {
                const phaseTasks = tasks.filter(t => t.phase === phase.id)
                const phaseDone = phaseTasks.filter(t => t.status === 'done').length
                const complete = phaseTasks.length > 0 && phaseDone === phaseTasks.length
                return (
                  <div key={phase.id} className="md:w-72 md:flex-shrink-0 rounded-xl p-3"
                    style={{ backgroundColor: complete ? '#f0fdf4' : '#efece8', border: `1px solid ${complete ? '#bbf7d0' : '#e5e0da'}` }}>
                    <div className="flex items-center justify-between mb-3 px-1">
                      <span className="font-semibold text-sm" style={{ color: '#1a1a1a' }}>
                        {phase.emoji} {phase.label}
                        <span className="ml-1.5 font-normal text-xs" style={{ color: '#aaa' }}>
                          {Math.round(phaseTasks.reduce((s, t) => s + w(t), 0))}% of job
                        </span>
                      </span>
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full"
                        style={complete
                          ? { backgroundColor: '#dcfce7', color: '#15803d', border: '1px solid #bbf7d0' }
                          : { backgroundColor: 'white', color: '#888', border: '1px solid #e0dbd6' }}>
                        {complete ? '✓ Done' : `${phaseDone}/${phaseTasks.length}`}
                      </span>
                    </div>
                    <div className="space-y-2">
                      {phaseTasks.map(task => {
                        const si = STATUS_INFO[task.status] || STATUS_INFO.todo
                        const overdue = isOverdue(active.target_date, task)
                        const sb = startBy(active.target_date, task.leadWeeks)
                        return (
                          <div key={task.id} className="rounded-xl p-3" style={{ backgroundColor: 'white', border: `1px solid ${overdue ? '#fca5a5' : '#e8e4e0'}` }}>
                            <p className="text-sm font-medium mb-1.5" style={{ color: task.status === 'done' ? '#aaa' : '#1a1a1a', textDecoration: task.status === 'done' ? 'line-through' : 'none' }}>
                              {task.link
                                ? <a href={task.link} target="_blank" rel="noreferrer" style={{ textDecoration: 'underline' }}>{task.title}</a>
                                : task.title}
                            </p>
                            <div className="flex flex-wrap items-center gap-1.5">
                              <button onClick={() => cycleStatus(task.id)}
                                className="text-xs font-medium px-2 py-0.5 rounded-full cursor-pointer active:opacity-70"
                                style={{ backgroundColor: si.bg, color: si.color, border: `1px solid ${si.border}` }}>
                                {si.label}
                              </button>
                              {task.badge && (
                                <span className="font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                                  style={{ background: '#1d4ed8', color: '#fff', fontSize: 10, letterSpacing: '0.06em' }}>
                                  {task.badge}
                                </span>
                              )}
                              {overdue && (
                                <span className="font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                                  style={{ background: '#b91c1c', color: '#fff', fontSize: 10, letterSpacing: '0.06em' }}>
                                  🔥 START NOW
                                </span>
                              )}
                              {sb && task.status !== 'done' && !overdue && (
                                <span className="text-xs" style={{ color: '#aaa' }}>start by {fmtDate(sb.toISOString().slice(0, 10))}</span>
                              )}
                              <span className="text-xs font-semibold ml-auto px-1.5 py-0.5 rounded-md"
                                style={{ backgroundColor: task.status === 'done' ? '#dcfce7' : '#f5f3f0', color: task.status === 'done' ? '#15803d' : '#888' }}>
                                {Math.round(w(task) * 10) / 10}%
                              </span>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}

        {/* Van Loadout modal */}
        {showLoadout && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.4)' }} onClick={() => setShowLoadout(false)}>
            <div className="rounded-xl p-5 max-w-2xl w-full max-h-[85vh] overflow-y-auto" style={{ backgroundColor: 'white' }} onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-1">
                <h3 className="font-bold" style={{ color: '#1a1a1a' }}>🛠️ Per-Van Autel Loadout</h3>
                <button onClick={() => setShowLoadout(false)} className="text-xl leading-none" style={{ color: '#aaa' }}>×</button>
              </div>
              <p className="text-xs mb-3" style={{ color: '#888' }}>
                Order from <a href="https://automotiveequipmentspecialists.com" target="_blank" rel="noreferrer" style={{ color: ORANGE, textDecoration: 'underline' }}>Automotive Equipment Specialists</a> — ~3 week lead time. Prices as of July 2026.
              </p>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs" style={{ color: '#aaa' }}>
                    <th className="py-1 pr-2 font-medium">Item</th>
                    <th className="py-1 pr-2 font-medium">SKU</th>
                    <th className="py-1 pr-2 font-medium text-right">Qty</th>
                    <th className="py-1 font-medium text-right">Each</th>
                  </tr>
                </thead>
                <tbody>
                  {VAN_LOADOUT.map((l, i) => (
                    <tr key={i} style={{ borderTop: '1px solid #f0ece8' }}>
                      <td className="py-1.5 pr-2" style={{ color: '#1a1a1a' }}>{l.item}</td>
                      <td className="py-1.5 pr-2 font-mono text-xs" style={{ color: '#888' }}>{l.sku}</td>
                      <td className="py-1.5 pr-2 text-right" style={{ color: '#57534e' }}>{l.qty}</td>
                      <td className="py-1.5 text-right" style={{ color: '#57534e' }}>{fmtMoney(l.price)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="text-right mt-3 pt-3 font-bold" style={{ borderTop: '1px solid #f0ece8', color: '#1a1a1a' }}>
                Per-van total: {fmtMoney(LOADOUT_TOTAL)}
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
