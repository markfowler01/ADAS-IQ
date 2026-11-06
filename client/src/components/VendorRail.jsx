// Always-visible vendor shortcuts. One tap from every screen into the
// tools techs actually use. Ink on cream so they look like Absolute ADAS;
// orange only on Scrubs because that one is ours. Direct <a> tags (not
// window.open after await) so iOS PWA can still leave the webview.

const ORANGE = '#CD4419'
const INK = '#1a1a1a'
const LINE = '#e8e4e0'

const VENDORS = [
  { id: 'alldata',   label: 'AllData',   href: 'https://my.alldata.com/migrate/#/home' },
  { id: 'kinetic',   label: 'Kinetic',   href: 'https://ops.kinetic.auto/id/' },
  { id: 'onesource', label: '1Source',   href: 'https://portal.1sourceadas.com/' },
  { id: 'identifix', label: 'Identifix', href: 'https://dh.identifix.com/Default/LogOnIdentifix?sessionTerminated=True' },
  { id: 'opus',      label: 'Opus CCP',  href: 'https://opusccp.com/' },
]

const chip = {
  minHeight: 44,
  border: `1px solid ${LINE}`,
  backgroundColor: 'white',
  color: INK,
  fontFamily: 'IBM Plex Sans, sans-serif',
}

export default function VendorRail({ onNavigate }) {
  return (
    <div style={{ backgroundColor: '#f5f3f0', borderBottom: `1px solid ${LINE}` }}>
      <div className="max-w-6xl mx-auto px-3 sm:px-6 py-1.5 grid grid-cols-3 sm:grid-cols-6 gap-1.5">
        {VENDORS.map(v => (
          <a
            key={v.id}
            href={v.href}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center px-2 rounded-lg text-[13px] font-semibold"
            style={chip}
            title={`Open ${v.label}`}
          >{v.label}</a>
        ))}
        <button
          type="button"
          onClick={() => onNavigate && onNavigate('scrubs')}
          className="flex items-center justify-center px-2 rounded-lg text-[13px] font-semibold text-white"
          style={{ minHeight: 44, backgroundColor: ORANGE }}
          title="Open our Scrub Library"
        >Scrubs</button>
      </div>
    </div>
  )
}
