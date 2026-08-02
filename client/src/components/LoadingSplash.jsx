// Branded loading splash (Mark 2026-08-02): the logo car "calibrating" —
// expanding sensor waves ripple outward in brand orange while a radar
// sweep circles the mark. Used by App.jsx's loading state; index.html
// carries a matching static copy for the pre-React boot moment.

const ORANGE = '#CD4419'

export default function LoadingSplash({ label = 'Calibrating systems' }) {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#f5f3f0' }}>
      <style>{`
        @keyframes aa-wave {
          0%   { transform: scale(0.55); opacity: 0.55; }
          80%  { opacity: 0.08; }
          100% { transform: scale(1.55); opacity: 0; }
        }
        @keyframes aa-sweep {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        @keyframes aa-breathe {
          0%, 100% { transform: scale(1); }
          50%      { transform: scale(1.06); }
        }
        @keyframes aa-dots {
          0%, 20%  { content: ''; }
        }
        @keyframes aa-dot-blink {
          0%, 60%, 100% { opacity: 0.2; }
          30%           { opacity: 1; }
        }
      `}</style>

      <div className="flex flex-col items-center gap-5">
        <div style={{ position: 'relative', width: 148, height: 148 }}>
          {/* Expanding sensor waves */}
          {[0, 1, 2].map(i => (
            <div key={i} style={{
              position: 'absolute', inset: 0, borderRadius: '50%',
              border: `2.5px solid ${ORANGE}`,
              animation: `aa-wave 2.4s cubic-bezier(0.2, 0.6, 0.4, 1) ${i * 0.8}s infinite`,
            }} />
          ))}

          {/* Radar sweep ring */}
          <div style={{
            position: 'absolute', inset: 10, borderRadius: '50%',
            background: `conic-gradient(from 0deg, transparent 0deg, transparent 300deg, ${ORANGE}33 330deg, ${ORANGE} 360deg)`,
            WebkitMask: 'radial-gradient(farthest-side, transparent calc(100% - 5px), black calc(100% - 4px))',
            mask: 'radial-gradient(farthest-side, transparent calc(100% - 5px), black calc(100% - 4px))',
            animation: 'aa-sweep 1.8s linear infinite',
          }} />

          {/* Tick marks — calibration reticle */}
          {[0, 90, 180, 270].map(deg => (
            <div key={deg} style={{
              position: 'absolute', left: '50%', top: '50%', width: 3, height: 10,
              backgroundColor: '#d8d2cc', borderRadius: 2,
              transform: `rotate(${deg}deg) translateY(-66px) translateX(-50%)`,
              transformOrigin: '0 0',
            }} />
          ))}

          {/* The mark itself, breathing gently */}
          <div style={{
            position: 'absolute', inset: 0, display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            animation: 'aa-breathe 2.4s ease-in-out infinite',
          }}>
            <img
              src={import.meta.env.BASE_URL + 'logo.png'}
              alt="Absolute ADAS"
              style={{ width: 64, height: 64, objectFit: 'contain' }}
            />
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
