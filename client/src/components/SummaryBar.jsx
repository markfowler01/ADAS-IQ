const ORANGE = '#CD4419'

export default function SummaryBar({ selected, removed }) {
  return (
    <div
      className="flex items-center justify-between px-4 py-3 rounded-xl"
      style={{ backgroundColor: 'white', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}
    >
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1.5">
          <span
            className="text-lg font-bold"
            style={{ color: ORANGE }}
          >
            {selected}
          </span>
          <span className="text-sm" style={{ color: '#888' }}>
            selected
          </span>
        </div>
        <div
          className="w-px h-4"
          style={{ backgroundColor: '#e0dbd6' }}
        />
        <div className="flex items-center gap-1.5">
          <span className="text-lg font-bold" style={{ color: '#aaa' }}>
            {removed}
          </span>
          <span className="text-sm" style={{ color: '#aaa' }}>
            removed
          </span>
        </div>
      </div>
      <span
        className="text-xs"
        style={{ fontFamily: "'IBM Plex Mono', monospace", color: '#bbb' }}
      >
        → Zoho Books Quote
      </span>
    </div>
  )
}
