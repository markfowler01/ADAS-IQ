// Side panel for the dispatch map. Groups jobs by tech. Supports:
//   - drag jobs BETWEEN tech groups to reassign
//   - drag jobs WITHIN a group to reorder (drive_order renumbered server-side)
//   - click pin on the map -> selectedJob shows a detail card with Reassign
//   - calibration count + key fields on each row
//
// Props:
//   pins, onReassign(jobId, newTech), onReorder(tech, orderedJobIds),
//   onJobClick(job), ambiguousShops, ungeocodedShops, onManualGeocode,
//   selectedJob, onClearSelection

import { useState } from 'react'

const ORANGE = '#CD4419'
const TECH_COLOR = { Mark: '#CD4419', Jayden: '#1F8B8B', Unassigned: '#999' }

function techGroupOf(pin) {
  const t = (pin.technician || '').toLowerCase()
  if (!t || pin.status === 'need_dispatch') return 'Unassigned'
  if (t.includes('mark')) return 'Mark'
  if (t.includes('jayden') || t.includes('jaden')) return 'Jayden'
  return pin.technician || 'Unassigned'
}

function parseCals(c) {
  if (!c) return []
  try { return typeof c === 'string' ? JSON.parse(c) : (Array.isArray(c) ? c : []) }
  catch { return [] }
}

function parseRO(notes) {
  return (notes || '').match(/RO#[:\s]*([^\s|,]+)/i)?.[1] || ''
}

export default function DispatchSidePanel({
  pins, onReassign, onReorder, onJobClick,
  ambiguousShops = [], ungeocodedShops = [], onManualGeocode,
  selectedJob, onClearSelection,
  capacities = {},
}) {
  const [dragJob, setDragJob] = useState(null)
  const [dragOverGroup, setDragOverGroup] = useState(null)
  const [dragOverIndex, setDragOverIndex] = useState(null) // within-group index

  const groups = { Mark: [], Jayden: [], Unassigned: [] }
  for (const p of pins) {
    const g = techGroupOf(p)
    if (!groups[g]) groups[g] = []
    groups[g].push(p)
  }
  for (const g of Object.keys(groups)) {
    groups[g].sort((a, b) => {
      const ao = a.drive_order ?? Number.POSITIVE_INFINITY
      const bo = b.drive_order ?? Number.POSITIVE_INFINITY
      return ao - bo
    })
  }

  function handleDragStart(e, job) {
    setDragJob(job)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(job.id))
  }
  function handleDragEnd() {
    setDragJob(null)
    setDragOverGroup(null)
    setDragOverIndex(null)
  }
  function handleGroupDragOver(e, groupName) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverGroup(groupName)
  }
  function handleRowDragOver(e, groupName, index) {
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    setDragOverGroup(groupName)
    setDragOverIndex(index)
  }
  function handleDrop(e, groupName) {
    e.preventDefault()
    if (!dragJob) { handleDragEnd(); return }
    const currentGroup = techGroupOf(dragJob)
    if (currentGroup === groupName) {
      // Reorder within group at dragOverIndex (or end if null)
      const list = groups[groupName] || []
      const without = list.filter(j => j.id !== dragJob.id)
      const insertAt = dragOverIndex == null ? without.length : Math.min(dragOverIndex, without.length)
      without.splice(insertAt, 0, dragJob)
      const orderedIds = without.map(j => j.id)
      onReorder && onReorder(groupName, orderedIds)
    } else {
      // Reassign to new tech. Warn if the target is already at/over cap.
      const targetCap = capacities[groupName]
      if (targetCap?.atCap && groupName !== 'Unassigned') {
        const ok = window.confirm(
          `${groupName} is already at ${targetCap.used} of ${targetCap.cap}. Assign anyway?`
        )
        if (!ok) { handleDragEnd(); return }
      }
      const newTech = (groupName === 'Unassigned') ? '' : groupName
      onReassign && onReassign(dragJob.id, newTech)
    }
    handleDragEnd()
  }

  function renderRow(p, groupName, i) {
    const cals = parseCals(p.calibrations)
    const ro = parseRO(p.notes)
    return (
      <li
        key={p.id}
        draggable
        onDragStart={(e) => handleDragStart(e, p)}
        onDragEnd={handleDragEnd}
        onDragOver={(e) => handleRowDragOver(e, groupName, i)}
        onClick={() => onJobClick && onJobClick(p)}
        className="rounded-lg px-3 py-2 cursor-pointer"
        style={{
          backgroundColor: dragJob?.id === p.id ? '#fdf3ef' : '#fafaf9',
          border: dragOverGroup === groupName && dragOverIndex === i
            ? `2px dashed ${ORANGE}`
            : '1px solid #f0ece8',
          opacity: dragJob?.id === p.id ? 0.5 : 1,
        }}
      >
        <div className="flex items-center gap-2 mb-0.5">
          {p.drive_order != null && (
            <span
              className="flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold text-white flex-shrink-0"
              style={{ backgroundColor: TECH_COLOR[groupName] || '#999' }}
            >{p.drive_order}</span>
          )}
          <span className="font-semibold text-sm truncate" style={{ color: '#1a1a1a' }}>
            {p.shop_name || 'Unknown'}
          </span>
        </div>
        <div className="text-xs truncate" style={{ color: '#666' }}>
          {p.vehicle || [p.year, p.make, p.model].filter(Boolean).join(' ')}
          {p.time_window_start && ` · ${p.time_window_start}`}
        </div>
        <div className="flex items-center gap-2 mt-1 text-[11px]" style={{ color: '#888' }}>
          <span>🔧 {cals.length} cal{cals.length !== 1 ? 's' : ''}</span>
          {ro && <span>· RO# {ro}</span>}
        </div>
        {!p.coords && (
          <div className="text-[10px] mt-1 font-semibold" style={{ color: '#c2410c' }}>⚠ No location</div>
        )}
      </li>
    )
  }

  function renderGroup(name) {
    const list = groups[name] || []
    const isDropTarget = dragOverGroup === name && dragOverIndex == null
    const cap = capacities[name] || null
    // Capacity styling: amber at cap, red over cap, green when room.
    let capStyle = null
    if (cap) {
      if (cap.status === 'over')      capStyle = { bg: '#fef2f2', border: '#fecaca', fg: '#991b1b', label: 'OVER CAP' }
      else if (cap.status === 'full') capStyle = { bg: '#fffbeb', border: '#fde68a', fg: '#92400e', label: 'FULL' }
      else                            capStyle = { bg: '#f0fdf4', border: '#bbf7d0', fg: '#166534', label: `${cap.available} OPEN` }
    }
    return (
      <div
        key={name}
        onDragOver={(e) => handleGroupDragOver(e, name)}
        onDrop={(e) => handleDrop(e, name)}
        className="rounded-xl mb-3"
        style={{
          backgroundColor: isDropTarget ? '#fff3eb' : 'white',
          border: `1.5px solid ${isDropTarget ? ORANGE : '#ebebeb'}`,
          padding: 12,
        }}
      >
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full" style={{ backgroundColor: TECH_COLOR[name] || '#999' }} />
            <span className="font-bold text-sm" style={{ color: '#1a1a1a' }}>{name}</span>
            {cap ? (
              <span className="text-xs font-semibold" style={{ color: '#555' }}>
                {cap.used} / {cap.cap}
              </span>
            ) : (
              <span className="text-xs" style={{ color: '#888' }}>({list.length})</span>
            )}
          </div>
          {capStyle && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
              style={{ backgroundColor: capStyle.bg, color: capStyle.fg, border: `1px solid ${capStyle.border}` }}>
              {capStyle.label}
            </span>
          )}
        </div>
        {list.length === 0 ? (
          <p className="text-xs italic px-1" style={{ color: '#bbb' }}>Drop a job here to assign</p>
        ) : (
          <ul className="space-y-1.5">
            {list.map((p, i) => renderRow(p, name, i))}
          </ul>
        )}
      </div>
    )
  }

  // Render the selected job detail above the groups
  function renderSelectedDetail() {
    if (!selectedJob) return null
    const cals = parseCals(selectedJob.calibrations)
    const ro = parseRO(selectedJob.notes)
    const currentTech = techGroupOf(selectedJob)
    return (
      <div className="rounded-xl mb-3 bg-white" style={{ border: `2px solid ${ORANGE}`, padding: 12 }}>
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-wider mb-0.5 font-semibold"
              style={{ color: ORANGE, fontFamily: 'IBM Plex Mono, monospace' }}>
              Selected
            </div>
            <div className="font-bold text-base truncate" style={{ color: '#1a1a1a' }}>
              {selectedJob.shop_name || 'Unknown'}
            </div>
            <div className="text-xs mt-0.5" style={{ color: '#555' }}>
              {selectedJob.vehicle || [selectedJob.year, selectedJob.make, selectedJob.model].filter(Boolean).join(' ')}
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5 text-[11px]" style={{ color: '#666' }}>
              {ro && <span>📋 RO# {ro}</span>}
              <span>🔧 {cals.length} cal{cals.length !== 1 ? 's' : ''}</span>
              {selectedJob.time_window_start && (
                <span>⏰ {selectedJob.time_window_start} – {selectedJob.time_window_end || ''}</span>
              )}
            </div>
          </div>
          <button
            onClick={onClearSelection}
            className="text-base px-1 flex-shrink-0"
            style={{ color: '#888' }}
            title="Close"
          >×</button>
        </div>
        <div className="mt-2">
          <label className="text-[10px] uppercase tracking-wider font-semibold block mb-1"
            style={{ color: '#888', fontFamily: 'IBM Plex Mono, monospace' }}>
            Reassign to
          </label>
          <div className="flex gap-1">
            {['Mark', 'Jayden', 'Unassigned'].map(opt => {
              const isCurrent = currentTech === opt
              return (
                <button
                  key={opt}
                  onClick={() => {
                    if (isCurrent) return
                    const newTech = opt === 'Unassigned' ? '' : opt
                    // Match the drag-drop confirm: warn before overbooking an at-cap tech.
                    const targetCap = capacities[opt]
                    if (targetCap?.atCap && opt !== 'Unassigned') {
                      const ok = confirm(`${opt} is already at ${targetCap.used} of ${targetCap.cap}. Assign anyway?`)
                      if (!ok) return
                    }
                    onReassign && onReassign(selectedJob.id, newTech)
                  }}
                  disabled={isCurrent}
                  className="flex-1 rounded-lg py-2 text-xs font-semibold"
                  style={{
                    backgroundColor: isCurrent ? (TECH_COLOR[opt] || '#999') : 'white',
                    color: isCurrent ? 'white' : '#1a1a1a',
                    border: isCurrent ? 'none' : `1px solid ${TECH_COLOR[opt] || '#ddd'}`,
                    cursor: isCurrent ? 'default' : 'pointer',
                    opacity: isCurrent ? 1 : 1,
                  }}
                  title={isCurrent ? 'Currently assigned to ' + opt : 'Reassign to ' + opt}
                >{opt}{isCurrent && ' ✓'}</button>
              )
            })}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto p-3" style={{ backgroundColor: '#f5f3f0' }}>
      {renderSelectedDetail()}
      {renderGroup('Mark')}
      {renderGroup('Jayden')}
      {renderGroup('Unassigned')}

      {(ambiguousShops.length > 0 || ungeocodedShops.length > 0) && (
        <div className="rounded-xl mt-2" style={{ border: '1px solid #fde68a', backgroundColor: '#fffbeb', padding: 12 }}>
          <div className="text-xs uppercase tracking-wider mb-2 font-semibold" style={{ color: '#92400e', fontFamily: 'IBM Plex Mono, monospace' }}>
            ⚠ Locations needing review
          </div>
          {ungeocodedShops.map(name => (
            <button
              key={name}
              onClick={() => onManualGeocode && onManualGeocode(name)}
              className="block w-full text-left text-sm px-2 py-1.5 rounded hover:underline"
              style={{ color: '#92400e' }}
            >
              {name} <span className="text-xs opacity-60">(no location)</span>
            </button>
          ))}
          {ambiguousShops.map(s => (
            <button
              key={s.shop_name}
              onClick={() => onManualGeocode && onManualGeocode(s.shop_name)}
              className="block w-full text-left text-sm px-2 py-1.5 rounded hover:underline"
              style={{ color: '#92400e' }}
            >
              {s.shop_name} <span className="text-xs opacity-60">(ambiguous)</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
