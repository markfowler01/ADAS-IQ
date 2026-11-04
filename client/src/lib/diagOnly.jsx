// 🔌 Diag only (Mark 2026-11-03): an electrical car that just needs diag — no
// Cal ID, PCSI, Pre/Post-Scan or Snapshot. A per-CAR switch, never the shop's
// CRM rule. Mirrors functions/adasiq-api/services/diagOnly.js.
//
// Big3Scope: every Big 4 edit asks "just this car, or every job at the shop?"
// — just this car is the default once a shop has a rule, so a one-off flip
// can't quietly rewrite the CRM.

export const DIAG_RULES = { cal_id: 'off', pcsi: 'off', pre_scan: 'off', post_scan: 'off', snapshot: 'off' }
export const DIAG_PILL = '🔌 DIAG ONLY · no Cal ID / PCSI / Post-Scan'

const DIAG_NAME = /\bdiag(nostic|nosis|s)?\b/i
const BIG4_NAME = /calibration identification report|post collision safety inspection|\bpcsi\b|calibration snapshot|\b(pre|post)[- ]?(calibration )?scan/i
export const isDiagName = name => DIAG_NAME.test(String(name || '')) && !BIG4_NAME.test(String(name || ''))

export function calsLookDiagOnly(cals) {
  const on = (cals || []).filter(c => c && c.enabled !== false).map(c => c.calibration_name || c.name || String(c))
  return on.length > 0 && on.every(isDiagName)
}
// The board card: Kat's saved flip wins, else the card's calibrations decide.
export function jobIsDiagOnly(job) {
  if (job?.diag_only && typeof job.diag_only.on === 'boolean') return job.diag_only.on
  let cals = job?.calibrations
  if (typeof cals === 'string') { try { cals = JSON.parse(cals || '[]') } catch { cals = [] } }
  return calsLookDiagOnly(Array.isArray(cals) ? cals : [])
}

export function DiagPill({ small = false }) {
  return (
    <span className="inline-flex items-center font-extrabold rounded-full whitespace-nowrap"
      style={{ backgroundColor: '#7c3aed', color: 'white', fontSize: small ? 10 : 12, padding: small ? '1px 7px' : '3px 10px' }}>
      {small ? '🔌 DIAG ONLY' : DIAG_PILL}
    </span>
  )
}

// The big switch: on = all Big 4 off for this car only.
export function DiagSwitch({ on, auto = false, by = '', onChange, disabled = false }) {
  return (
    <div className="rounded-xl p-3 flex items-center justify-between gap-3"
      style={on ? { backgroundColor: '#f5f3ff', border: '2px solid #7c3aed' } : { backgroundColor: '#fafaf9', border: '1.5px solid #e8e4e0' }}>
      <div className="min-w-0">
        <div className="font-extrabold text-base" style={{ color: on ? '#5b21b6' : '#334155' }}>{on ? DIAG_PILL : '🔌 Diag only is OFF'}</div>
        <div className="text-sm" style={{ color: on ? '#6d28d9' : '#64748b' }}>
          {on
            ? `${auto ? 'Turned on by itself: only diag on this car. ' : by ? `Switched on by ${by}. ` : ''}This car only. The shop's rules on the CRM stay as they are.`
            : 'Electrical car that just needs diag? Switch it on: Cal ID, PCSI and the scans come off this car only.'}
        </div>
      </div>
      <button type="button" disabled={disabled} onClick={() => onChange(!on)}
        className="text-sm font-extrabold rounded-xl px-4 py-2.5 whitespace-nowrap"
        style={on ? { backgroundColor: 'white', color: '#5b21b6', border: '1.5px solid #7c3aed' } : { backgroundColor: '#7c3aed', color: 'white' }}>
        {on ? 'Switch OFF' : 'Diag only'}
      </button>
    </div>
  )
}

// "Just this car" vs "Every <shop> job" — replaces the old Remember checkbox.
export function Big3Scope({ save, onChange, shopName = 'this shop', disabled = false, note = '' }) {
  const pill = active => active ? { backgroundColor: '#1a1a1a', color: 'white' } : { backgroundColor: 'white', color: '#555', border: '1px solid #e0dbd6' }
  return (
    <div className="mt-1.5">
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[11px] font-semibold" style={{ color: '#555' }}>Change for:</span>
        <button type="button" disabled={disabled} onClick={() => onChange(false)} className="text-[11px] font-bold rounded-full px-2.5 py-1" style={pill(!save)}>🚗 Just this car</button>
        <button type="button" disabled={disabled} onClick={() => onChange(true)} className="text-[11px] font-bold rounded-full px-2.5 py-1" style={pill(save)}>🏢 Every {shopName} job</button>
      </div>
      {note && <div className="text-[11px] mt-1" style={{ color: '#888' }}>{note}</div>}
      {save && !disabled && <div className="text-[11px] mt-1 font-semibold" style={{ color: '#92400e' }}>⚠️ This changes {shopName}'s rule on the CRM for every job from now on.</div>}
    </div>
  )
}
