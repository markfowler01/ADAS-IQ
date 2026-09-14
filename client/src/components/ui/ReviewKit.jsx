// Review kit (Mark 2026-09-14: "make this more like the Ready to Invoice
// screen… keep the system looking the same front to back"). The pieces
// the 💸 Bill it review is built from, pulled out so the upload review,
// the calibration review, the tech sheet and the onboarding form share
// one look: mono eyebrow, bold title, bordered panels with a colored
// header strip, one-line rows with tabular amounts, a big total row, an
// always-visible footer, amber warnings, pill switches.
export const ORANGE = '#CD4419'
export const GREEN = '#15803d'
export const BLUE = '#1d4ed8'
export const fmt = n => `$${Number(n || 0).toFixed(2)}`

const TONES = {
  blue:  { border: '#bfdbfe', head: '#eff6ff', text: BLUE },
  green: { border: '#bbf7d0', head: '#f0fdf4', text: GREEN },
  amber: { border: '#fde68a', head: '#fffbeb', text: '#92400e' },
  orange:{ border: '#f5c9b8', head: '#fff5f0', text: ORANGE },
  plain: { border: '#e8e4e0', head: '#f8f6f4', text: '#1a1a1a' },
}

export function Eyebrow({ children, style = {} }) {
  return <div className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: '#888', fontFamily: 'IBM Plex Mono, monospace', ...style }}>{children}</div>
}

export function Title({ children, sub }) {
  return (
    <div>
      <div className="font-bold text-base" style={{ color: '#1a1a1a' }}>{children}</div>
      {sub && <div className="text-xs" style={{ color: '#666' }}>{sub}</div>}
    </div>
  )
}

/** Bordered panel with a colored header strip. `right` renders on the header's right. */
export function Panel({ tone = 'plain', title, right, children, className = '', bodyClass = '' }) {
  const t = TONES[tone] || TONES.plain
  return (
    <div className={`rounded-xl overflow-hidden flex flex-col ${className}`} style={{ border: `1.5px solid ${t.border}`, backgroundColor: 'white' }}>
      {(title || right) && (
        <div className="px-3 py-2 text-sm font-bold flex items-center justify-between gap-2 flex-wrap" style={{ backgroundColor: t.head, color: t.text }}>
          <span>{title}</span>
          {right && <span className="text-xs font-semibold" style={{ color: t.text, opacity: .85 }}>{right}</span>}
        </div>
      )}
      <div className={bodyClass}>{children}</div>
    </div>
  )
}

/** One-line row: left content, right amount/control, optional grey note under the left. */
export function Row({ left, right, sub, muted = false, bg, onClick, className = '' }) {
  return (
    <div onClick={onClick} className={`px-3 text-sm ${className}`} style={{ borderTop: '1px solid #f1f5f9', backgroundColor: bg || 'white', opacity: muted ? .5 : 1, cursor: onClick ? 'pointer' : 'default' }}>
      <div className="flex items-center justify-between gap-3" style={{ minHeight: 38 }}>
        <div className="flex-1 min-w-0" style={{ color: '#1a1a1a' }}>{left}</div>
        {right != null && <div className="flex-shrink-0 tabular-nums font-semibold flex items-center gap-2" style={{ color: '#555' }}>{right}</div>}
      </div>
      {sub && <div className="pb-2 -mt-1 text-xs" style={{ color: '#666' }}>{sub}</div>}
    </div>
  )
}

export function TotalRow({ label, value, tone = 'plain' }) {
  const t = TONES[tone] || TONES.plain
  return (
    <div className="flex justify-between px-3 py-2.5 text-base font-extrabold" style={{ borderTop: `2px solid ${t.border}`, color: tone === 'plain' ? '#1a1a1a' : t.text, marginTop: 'auto' }}>
      <span>{label}</span><span className="tabular-nums">{value}</span>
    </div>
  )
}

/** Amber / red / green notice box. */
export function Notice({ tone = 'amber', children, className = '' }) {
  const s = tone === 'red' ? { backgroundColor: '#fef2f2', border: '1.5px solid #fecaca', color: '#991b1b' }
    : tone === 'green' ? { backgroundColor: '#f0fdf4', border: '1.5px solid #86efac', color: '#166534' }
    : { backgroundColor: '#fffbeb', border: '1.5px solid #fde68a', color: '#92400e' }
  return <div className={`rounded-lg px-3 py-2 text-xs space-y-1 ${className}`} style={s}>{children}</div>
}

/** Pill switch (the Charge / Included look). */
export function Pill({ on, onClick, children, tone = 'green', disabled = false, size = 'md' }) {
  const t = TONES[tone] || TONES.green
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className={`rounded-full font-bold ${size === 'sm' ? 'text-xs px-2.5 py-1' : 'text-sm px-3.5 py-1.5'}`}
      style={{ backgroundColor: on ? t.text : 'white', color: on ? 'white' : t.text, border: `1.5px solid ${on ? t.text : t.border}`, opacity: disabled ? .5 : 1 }}>
      {children}
    </button>
  )
}

/** iOS-style toggle, orange when on. */
export function Switch({ on, onClick, disabled = false }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-pressed={on}
      style={{ flexShrink: 0, width: 44, height: 24, borderRadius: 12, backgroundColor: on ? ORANGE : '#d4d4d4', position: 'relative', transition: 'background-color .18s', opacity: disabled ? .5 : 1 }}>
      <span style={{ position: 'absolute', top: 3, left: on ? 23 : 3, width: 18, height: 18, borderRadius: '50%', backgroundColor: 'white', boxShadow: '0 1px 3px rgba(0,0,0,.2)', transition: 'left .18s' }} />
    </button>
  )
}

/** Small mono tag (chip). */
export function Chip({ tone = 'gray', children }) {
  const s = tone === 'orange' ? { backgroundColor: '#fdeee8', color: ORANGE } : tone === 'green' ? { backgroundColor: '#dcfce7', color: GREEN } : tone === 'blue' ? { backgroundColor: '#dbeafe', color: BLUE } : { backgroundColor: '#f2f2f2', color: '#666' }
  return <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ fontFamily: "'IBM Plex Mono', monospace", ...s }}>{children}</span>
}

/** Sticky footer: grey cancel/secondary on the left, big primary on the right. */
export function Footer({ secondary, primary, note }) {
  return (
    <div className="sticky bottom-0 left-0 right-0 z-30" style={{ backgroundColor: 'rgba(245,243,240,.96)', backdropFilter: 'blur(6px)', borderTop: '1px solid #e8e4e0' }}>
      <div className="max-w-5xl mx-auto px-4 py-2.5">
        {note && <div className="text-xs mb-2 text-center font-semibold" style={{ color: '#92400e' }}>{note}</div>}
        <div className="flex gap-2">
          {secondary}
          {primary}
        </div>
      </div>
    </div>
  )
}

export function PrimaryButton({ children, onClick, disabled = false, tone = 'green', className = '' }) {
  const bg = tone === 'orange' ? ORANGE : tone === 'blue' ? BLUE : GREEN
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={`flex-[2] rounded-xl py-3 text-base font-bold text-white ${className}`} style={{ backgroundColor: bg, opacity: disabled ? .45 : 1 }}>
      {children}
    </button>
  )
}

export function SecondaryButton({ children, onClick, disabled = false }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="flex-1 rounded-xl py-3 text-sm font-semibold" style={{ backgroundColor: '#f5f3f0', color: '#555', border: '1px solid #e0dbd6', opacity: disabled ? .5 : 1 }}>
      {children}
    </button>
  )
}

/** Label/value pair for detail grids. */
export function Field({ label, value, mono = false, children }) {
  return (
    <div className="min-w-0">
      <Eyebrow>{label}</Eyebrow>
      <div className="text-sm font-semibold truncate" style={{ color: value || children ? '#1a1a1a' : '#bbb', fontFamily: mono ? "'IBM Plex Mono', monospace" : undefined }}>{children || value || '—'}</div>
    </div>
  )
}
