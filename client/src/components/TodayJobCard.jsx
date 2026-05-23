// Mobile-first job card for the /today screen.
// Visual state is derived from timestamps, not the Kanban status enum.
//
// Props:
//   job              — enriched job (with state cache merged, shop_address, coords)
//   onAction(name)   — called with one of: 'navigate' | 'start' | 'complete' | 'running-late' | "can't-access"
//   isExpanded       — controlled expand state
//   onToggleExpand() — toggles the expand state
//
// State machine:
//   none                 → 'scheduled' (gray pill)
//   en_route_at          → 'en-route' (orange pill, pulse dot)
//   started_at           → 'on-site' (amber pill, elapsed counter)
//   completed_at         → 'complete' (collapsed, green checkmark)
//
// All buttons are full-width with min-height 48px for tap targets.

import { useEffect, useState } from 'react'

const ORANGE = '#CD4419'
const GRAY_BG = '#f5f3f0'
const STATE_STYLE = {
  scheduled: { label: 'Scheduled', bg: '#e8e4e0', fg: '#555' },
  'en-route': { label: 'En Route',  bg: '#fef3c7', fg: '#b45309' },
  'on-site':  { label: 'On Site',   bg: '#fff3b3', fg: '#7a5e00' },
  complete:   { label: 'Complete',  bg: '#dcfce7', fg: '#15803d' },
}

function deriveState(job) {
  if (job.completed_at) return 'complete'
  if (job.started_at)   return 'on-site'
  if (job.en_route_at)  return 'en-route'
  return 'scheduled'
}

function parseRO(notes) {
  const m = (notes || '').match(/RO#[:\s]*([^\s|,]+)/i)
  return m?.[1] || ''
}

function parseDescription(notes) {
  return (notes || '')
    .split('\n')
    .filter(line => !/^RO#[:\s]/i.test(line.trim()) && !/^\|?\s*Quote[:\s]/i.test(line.trim()))
    .join('\n')
    .trim()
}

function parseCalibrations(cals) {
  if (!cals) return []
  try {
    const arr = typeof cals === 'string' ? JSON.parse(cals) : cals
    return Array.isArray(arr) ? arr : []
  } catch { return [] }
}

function fmtElapsed(startedAt) {
  if (!startedAt) return ''
  const ms = Date.now() - new Date(startedAt).getTime()
  if (ms < 0) return ''
  const m = Math.floor(ms / 60000)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return `${h}h ${m - h * 60}m`
}

export default function TodayJobCard({ job, onAction, isExpanded, onToggleExpand }) {
  const state = deriveState(job)
  const style = STATE_STYLE[state]
  const cals = parseCalibrations(job.calibrations)
  const ro = parseRO(job.notes)
  const description = parseDescription(job.notes)
  const vehicle = job.vehicle || [job.year, job.make, job.model].filter(Boolean).join(' ')
  const insurer = job.insurer || 'Customer Pay (CP)'

  // Live-tick elapsed time when on-site
  const [, setTick] = useState(0)
  useEffect(() => {
    if (state !== 'on-site') return
    const id = setInterval(() => setTick(t => t + 1), 30000)
    return () => clearInterval(id)
  }, [state])

  const collapsed = state === 'complete'
  const expanded = isExpanded && !collapsed

  return (
    <div
      className="rounded-2xl border bg-white shadow-sm overflow-hidden"
      style={{
        borderColor: '#ebebeb',
        opacity: collapsed ? 0.65 : 1,
      }}
    >
      {/* Header (always visible; tap to expand) */}
      <button
        type="button"
        onClick={onToggleExpand}
        disabled={collapsed}
        className="w-full text-left px-4 py-4"
        style={{ minHeight: 72 }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              {job.drive_order != null && (
                <span
                  className="flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold text-white flex-shrink-0"
                  style={{ backgroundColor: ORANGE }}
                >{job.drive_order}</span>
              )}
              <span className="font-bold text-base truncate" style={{ color: '#1a1a1a' }}>
                {job.shop_name || 'Unknown shop'}
              </span>
            </div>
            <div className="text-sm" style={{ color: '#555' }}>{vehicle}</div>
            {(job.time_window_start || job.time_window_end) && (
              <div className="text-xs mt-1" style={{ color: '#888' }}>
                ⏰ {job.time_window_start || '—'} – {job.time_window_end || '—'}
              </div>
            )}
          </div>
          <span
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold flex-shrink-0"
            style={{ backgroundColor: style.bg, color: style.fg }}
          >
            {state === 'en-route' && (
              <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: style.fg }} />
            )}
            {state === 'complete' && '✓ '}
            {style.label}
            {state === 'on-site' && job.started_at && (
              <span className="ml-1 opacity-75">· {fmtElapsed(job.started_at)}</span>
            )}
          </span>
        </div>

        {/* Cal summary (collapsed view only) */}
        {!expanded && cals.length > 0 && (
          <div className="text-xs mt-2" style={{ color: '#666' }}>
            🔧 {cals.length} cal{cals.length !== 1 ? 's' : ''}: {
              cals.slice(0, 2).map(c => c.name || c.calibration_name).filter(Boolean).join(', ')
            }
            {cals.length > 2 && ` +${cals.length - 2} more`}
          </div>
        )}
      </button>

      {/* Expanded body */}
      {expanded && (
        <div className="px-4 pb-4" style={{ borderTop: '1px solid #f0ece8' }}>
          <div className="grid grid-cols-1 gap-3 mt-3 text-sm">
            {job.shop_address && (
              <div>
                <div className="text-xs uppercase tracking-wider" style={{ color: '#888', fontFamily: 'IBM Plex Mono, monospace' }}>Address</div>
                <div style={{ color: '#1a1a1a' }}>{job.shop_address}</div>
              </div>
            )}
            {(job.shop_contact || job.shop_phone) && (
              <div className="flex gap-3 items-baseline">
                {job.shop_contact && (
                  <div className="flex-1">
                    <div className="text-xs uppercase tracking-wider" style={{ color: '#888', fontFamily: 'IBM Plex Mono, monospace' }}>Contact</div>
                    <div style={{ color: '#1a1a1a' }}>{job.shop_contact}</div>
                  </div>
                )}
                {job.shop_phone && (
                  <a
                    href={`tel:${job.shop_phone.replace(/[^\d+]/g, '')}`}
                    className="flex-shrink-0 px-3 py-2 rounded-lg text-sm font-semibold"
                    style={{ backgroundColor: '#fdf3ef', color: ORANGE, minHeight: 36 }}
                  >📞 Call</a>
                )}
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              {ro && (
                <div>
                  <div className="text-xs uppercase tracking-wider" style={{ color: '#888', fontFamily: 'IBM Plex Mono, monospace' }}>RO#</div>
                  <div style={{ color: '#1a1a1a' }}>{ro}</div>
                </div>
              )}
              {job.vin && (
                <div>
                  <div className="text-xs uppercase tracking-wider" style={{ color: '#888', fontFamily: 'IBM Plex Mono, monospace' }}>VIN</div>
                  <div className="font-mono text-xs" style={{ color: '#1a1a1a' }}>{job.vin}</div>
                </div>
              )}
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider" style={{ color: '#888', fontFamily: 'IBM Plex Mono, monospace' }}>Insurance</div>
              <div style={{ color: '#1a1a1a' }}>{insurer}</div>
            </div>

            {cals.length > 0 && (
              <div>
                <div className="text-xs uppercase tracking-wider mb-1.5" style={{ color: '#888', fontFamily: 'IBM Plex Mono, monospace' }}>Calibrations</div>
                <ul className="space-y-1">
                  {cals.map((c, i) => (
                    <li key={i} className="text-sm flex items-center gap-2" style={{ color: '#333' }}>
                      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: ORANGE }} />
                      {c.name || c.calibration_name}
                      {c.mode && c.mode.toLowerCase() !== 'static' && (
                        <span className="text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: '#f5f3f0', color: '#666' }}>{c.mode}</span>
                      )}
                    </li>
                  ))}
                  <li className="text-xs" style={{ color: '#999' }}>+ PCSI, POST (always included)</li>
                </ul>
              </div>
            )}

            {description && (
              <div className="px-3 py-2 rounded-lg" style={{ backgroundColor: GRAY_BG, borderLeft: `3px solid ${ORANGE}` }}>
                <div className="text-xs uppercase tracking-wider mb-1" style={{ color: '#888', fontFamily: 'IBM Plex Mono, monospace' }}>Notes</div>
                <div className="text-sm whitespace-pre-wrap" style={{ color: '#333' }}>{description}</div>
              </div>
            )}

            {(job.folder_url || job.report_url) && (
              <div className="flex flex-col gap-1.5">
                {job.folder_url && (
                  <a href={job.folder_url} target="_blank" rel="noopener noreferrer"
                    className="text-sm font-semibold" style={{ color: ORANGE }}>
                    📁 WorkDrive folder →
                  </a>
                )}
                {job.report_url && (
                  <a href={job.report_url} target="_blank" rel="noopener noreferrer"
                    className="text-sm font-semibold" style={{ color: ORANGE }}>
                    📄 Scan report →
                  </a>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Action footer */}
      {!collapsed && (
        <div className="px-4 pb-4 flex flex-col gap-2" style={{ borderTop: expanded ? 'none' : '1px solid #f0ece8', paddingTop: expanded ? 0 : 12 }}>
          {/* Navigate button — always present until complete */}
          <button
            type="button"
            onClick={() => onAction('navigate')}
            className="w-full rounded-xl text-white font-bold text-base"
            style={{ backgroundColor: ORANGE, minHeight: 52 }}
          >🧭 Navigate</button>

          {/* State-dependent action */}
          {(state === 'scheduled' || state === 'en-route') && (
            <button
              type="button"
              onClick={() => onAction('start')}
              className="w-full rounded-xl font-semibold"
              style={{ backgroundColor: '#fdf3ef', color: ORANGE, border: `1.5px solid ${ORANGE}`, minHeight: 48 }}
            >▶ Start Job</button>
          )}
          {state === 'on-site' && (
            <button
              type="button"
              onClick={() => onAction('complete')}
              className="w-full rounded-xl font-bold text-white"
              style={{ backgroundColor: '#7e22ce', minHeight: 52 }}
            >✓ Complete Job</button>
          )}

          {/* Secondary actions (expanded only) */}
          {expanded && (state === 'en-route' || state === 'on-site') && (
            <div className="grid grid-cols-2 gap-2 pt-1">
              <button type="button" onClick={() => onAction('running-late')}
                className="rounded-lg text-sm font-medium"
                style={{ backgroundColor: '#fffbeb', color: '#92400e', border: '1px solid #fde68a', minHeight: 40 }}
              >⏰ Running late</button>
              <button type="button" onClick={() => onAction("can't-access")}
                className="rounded-lg text-sm font-medium"
                style={{ backgroundColor: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca', minHeight: 40 }}
              >🚫 Can't access</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
