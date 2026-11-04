// 🔌 Diag only (Mark 2026-11-03): "sometimes a car just needs diag for an
// electrical problem and we do not charge for cal id, pcsi, or post … we keep
// adjusting the Cal ID and then it changes the CRM and that's not good."
//
// A per-CAR switch, never a shop rule. On: Cal ID, PCSI, Pre-Scan, Post-Scan and
// Snapshot all come off this one invoice; the shop's Big 4 on the CRM is never
// touched. It turns itself on when every priced line is a Diagnostic item and
// there are no calibrations. Kat's flip (on or off) is saved on the job state
// (`diag_only` = { on, by, at }) and always wins over the auto guess.

export const DIAG_RULES = { cal_id: 'off', pcsi: 'off', pre_scan: 'off', post_scan: 'off', snapshot: 'off' }
export const DIAG_PILL = '🔌 DIAG ONLY · no Cal ID / PCSI / Post-Scan'

const DIAG_NAME = /\bdiag(nostic|nosis|s)?\b/i
const BIG4_NAME = /calibration identification report|post collision safety inspection|\bpcsi\b|calibration snapshot|\b(pre|post)[- ]?(calibration )?scan/i
// Not "work" — a $0 line, a cash cap, a part never decides the job type.
const isWork = l => (Number(l?.rate) || 0) > 0 && !l?.is_part && !/cash cap/i.test(l?.name || '')

export const isDiagName = name => DIAG_NAME.test(String(name || '')) && !BIG4_NAME.test(String(name || ''))

/** Every priced line (Big 4 aside) is a Diagnostic item, and there is at least one. */
export function looksDiagOnly(lines) {
  const work = (lines || []).filter(l => isWork(l) && !BIG4_NAME.test(l.name || ''))
  return work.length > 0 && work.every(l => isDiagName(l.name))
}

/** Job calibrations (the card) → diag-only when every enabled one is a Diagnostic. */
export function calsLookDiagOnly(cals) {
  const on = (cals || []).filter(c => c && c.enabled !== false).map(c => c.calibration_name || c.name || String(c))
  return on.length > 0 && on.every(isDiagName)
}

/** saved = { on, by, at } | null from the job state. Kat's flip wins; else the auto guess. */
export function diagState(saved, auto) {
  if (saved && typeof saved.on === 'boolean') return { on: saved.on, auto: false, by: saved.by || '', at: saved.at || '' }
  return { on: !!auto, auto: !!auto, by: '', at: '' }
}

/** Big 4 lines left off when diag-only is on. */
export function stripBig4(lines) { return (lines || []).filter(l => !BIG4_NAME.test(l?.name || '')) }

export function takeDiag(body) {
  if (!body || !('diag_only' in body)) return undefined
  const v = body.diag_only
  delete body.diag_only
  if (v === null || v === '') return null
  return !!(v === true || v === 'true' || v === 1 || v === '1' || v?.on === true)
}
