// Branded loading splash (Mark 2026-10-02 v2: "just the car and then a
// horizontal line kinda like a laser scanning the car all the way up to the
// radars so it goes up and down real slow"). The logo car with a glowing scan
// line sweeping wheels → radar waves → wheels. Used by App.jsx's loading
// state and as the overlay while a report is scrubbed or a job created;
// index.html carries a matching static copy for the pre-React boot moment.

const ORANGE = '#CD4419'
const SIZE = 168          // the car mark
const SCAN = '4.2s'       // one way; it eases back down the same speed

// The car mark with the laser sweeping it, at any size — the splash below, and
// inline in the Scrubs drop box while an estimate is scrubbed (Mark 2026-10-02:
// "this scrubbing window is boring… add the loading logo with the laser").
export function ScanLogo({ size = SIZE }) {
  const kf = `aa-scan-${size}`
  return (
    <div style={{ position: 'relative', width: size + 24, height: size, margin: '0 auto' }}>
      <style>{`@keyframes ${kf} { from { transform: translateY(${Math.round(size * 0.86)}px); } to { transform: translateY(${Math.round(size * 0.08)}px); } }`}</style>
      <img src={import.meta.env.BASE_URL + 'logo.png'} alt="Absolute ADAS" style={{ position: 'absolute', left: 12, top: 0, width: size, height: size, objectFit: 'contain' }} />
      <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 0, animation: `${kf} ${SCAN} ease-in-out infinite alternate` }}>
        <div style={{ position: 'absolute', left: 0, right: 0, top: -12, height: 24, background: `linear-gradient(to bottom, transparent, ${ORANGE}22 40%, ${ORANGE}33 50%, ${ORANGE}22 60%, transparent)` }} />
        <div style={{ position: 'absolute', left: 0, right: 0, top: -1, height: 2, borderRadius: 2, background: `linear-gradient(to right, transparent, #ff6a3d 12%, #ffd2c2 50%, #ff6a3d 88%, transparent)`, boxShadow: `0 0 8px 2px ${ORANGE}99, 0 0 18px 4px ${ORANGE}44` }} />
      </div>
    </div>
  )
}

// `overlay` renders it as a translucent full-screen layer on TOP of the
// current screen — used while the AI is scrubbing a report or creating
// a job (Mark 2026-08-02) instead of replacing the page.
export default function LoadingSplash({ label = 'Calibrating systems', overlay = false }) {
  return (
    <div
      className={overlay
        ? 'fixed inset-0 z-50 flex items-center justify-center'
        : 'min-h-screen flex items-center justify-center'}
      style={{ backgroundColor: overlay ? 'rgba(245,243,240,0.94)' : '#f5f3f0' }}>
      <style>{`
        @keyframes aa-scan {
          from { transform: translateY(${Math.round(SIZE * 0.86)}px); }
          to   { transform: translateY(${Math.round(SIZE * 0.08)}px); }
        }
        @keyframes aa-dot-blink {
          0%, 60%, 100% { opacity: 0.2; }
          30%           { opacity: 1; }
        }
      `}</style>

      <div className="flex flex-col items-center gap-5">
        <div style={{ position: 'relative', width: SIZE + 40, height: SIZE }}>
          <img
            src={import.meta.env.BASE_URL + 'logo.png'}
            alt="Absolute ADAS"
            style={{ position: 'absolute', left: 20, top: 0, width: SIZE, height: SIZE, objectFit: 'contain' }}
          />
          {/* The laser: a soft beam band with a bright core line, wheels → radars → wheels */}
          <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 0, animation: `aa-scan ${SCAN} ease-in-out infinite alternate` }}>
            <div style={{ position: 'absolute', left: 0, right: 0, top: -14, height: 28, background: `linear-gradient(to bottom, transparent, ${ORANGE}22 40%, ${ORANGE}33 50%, ${ORANGE}22 60%, transparent)` }} />
            <div style={{ position: 'absolute', left: 0, right: 0, top: -1, height: 2, borderRadius: 2, background: `linear-gradient(to right, transparent, #ff6a3d 12%, #ffd2c2 50%, #ff6a3d 88%, transparent)`, boxShadow: `0 0 8px 2px ${ORANGE}99, 0 0 18px 4px ${ORANGE}44` }} />
          </div>
        </div>

        <div className="flex flex-col items-center gap-1">
          <div style={{
            fontWeight: 800, fontSize: 15, letterSpacing: '0.14em',
            textTransform: 'uppercase', color: '#1a1a1a',
          }}>
            Absolute <span style={{ color: ORANGE }}>ADAS</span>
          </div>
          <div style={{ fontSize: 12, color: '#9a938c', display: 'flex', gap: 2, alignItems: 'baseline' }}>
            {label}
            {[0, 1, 2].map(i => (
              <span key={i} style={{
                display: 'inline-block', width: 3, height: 3, borderRadius: '50%',
                backgroundColor: '#9a938c', marginLeft: 2,
                animation: `aa-dot-blink 1.4s ease-in-out ${i * 0.2}s infinite`,
              }} />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
