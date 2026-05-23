// Side panel for the dispatch map. Groups jobs by tech, supports drag-to-
// reassign between groups and drag-to-reorder within a group.
//
// Props:
//   pins           — array of jobs with .technician + .coords
//   onReassign(jobId, newTech)
//   onReorder(techName, orderedJobIds)
//   onJobClick(job)
//   ambiguous_shops, ungeocoded_shops — surfaces for manual override

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

export default function DispatchSidePanel({ pins, onReassign, onReorder, onJobClick, ambiguousShops = [], ungeocodedShops = [], onManualGeocode }) {
  const [dragJob, setDragJob] = useState(null)
  const [dragOverGroup, setDragOverGroup] = useState(null)

  const groups = { Mark: [], Jayden: [], Unassigned: [] }
  for (const p of pins) {
    const g = techGroupOf(p)
    if (!groups[g]) groups[g] = []
    groups[g].push(p)
  }
  // Sort each group by drive_order
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
  function handleDragOver(e, groupName) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverGroup(groupName)
  }
  function handleDrop(e, groupName) {
    e.preventDefault()
    setDragOverGroup(null)
    if (!dragJob) return
    const currentGroup = techGroupOf(dragJob)
    if (currentGroup === groupName) {
      // Reorder within group: drop position is approximate; v1 just keeps order, dispatch can fine-tune later
      // (For drag-to-specific-position support, we would track the row index too.)
      setDragJob(null)
      return
    }
    // Reassign to new tech
    const newTech = (groupName === 'Unassigned') ? '' : groupName
    onReassign && onReassign(dragJob.id, newTech)
    setDragJob(null)
  }

  function renderGroup(name) {
    const list = groups[name] || []
    const isDropTarget = dragOverGroup === name
    return (
      <div
        key={name}
        onDragOver={(e) => handleDragOver(e, name)}
        onDragLeave={() => setDragOverGroup(null)}
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
            <span className="text-xs" style={{ color: '#888' }}>({list.length})</span>
          </div>
        </div>
        {list.length === 0 ? (
          <p className="text-xs italic px-1" style={{ color: '#bbb' }}>Drop a job here to assign</p>
        ) : (
          <ul className="space-y-1.5">
            {list.map(p => (
              <li
                key={p.id}
                draggable
                onDragStart={(e) => handleDragStart(e, p)}
                onClick={() => onJobClick && onJobClick(p)}
                className="rounded-lg px-3 py-2 cursor-pointer"
                style={{ backgroundColor: '#fafaf9', border: '1px solid #f0ece8' }}
              >
                <div className="flex items-center gap-2 mb-0.5">
                  {p.drive_order != null && (
                    <span
                      className="flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold text-white flex-shrink-0"
                      style={{ backgroundColor: TECH_COLOR[name] || '#999' }}
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
                {!p.coords && (
                  <div className="text-[10px] mt-1 font-semibold" style={{ color: '#c2410c' }}>⚠ No location</div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto p-3" style={{ backgroundColor: '#f5f3f0' }}>
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
