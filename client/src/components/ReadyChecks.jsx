// Ready-to-Invoice checks (Mark 2026-09-11) — shown on BOTH the tech's
// Live Day sheet and the board's calibration review, so every job gets:
//   💵 Customer pay? → which number the customer was told ($350 / $700).
//      Relayed to Kat + #dispatch by the server, shown on the card, and
//      carried into Bill it so the invoice matches what was promised.
//   🛞 Tire pressures set to the manufacturer spec — required every job.
//      Default 36 F / 36 R, editable.
//   🪟 Windshield checked before calibrating — only when the job has a
//      windshield / forward camera calibration.
import { needsWindshieldCheck } from './MobileJobCard.jsx'

const GREEN = '#15803d'
const ORANGE = '#CD4419'

export const DEFAULT_CHECKS = { cash: 'no', belts: false, airbags: false, front: 36, rear: 36, tiresOk: false, windshieldOk: false }

export function readyChecksValid(v, job) {
  if (!v.belts || !v.airbags) return false
  if (!v.tiresOk) return false
  if (v.cash === 'yes') return false                       // picked "yes" but no number yet
  if (needsWindshieldCheck(job) && !v.windshieldOk) return false
  return true
}
export function readyChecksMissing(v, job) {
  const out = []
  if (!v.belts) out.push('check the seat belts')
  if (!v.airbags) out.push('inspect the airbag system')
  if (!v.tiresOk) out.push('confirm the tire pressures')
  if (v.cash === 'yes') out.push('pick $350 or $700')
  if (needsWindshieldCheck(job) && !v.windshieldOk) out.push('confirm the windshield check')
  return out
}
// → fields for the PATCH that moves the job to Ready to Invoice
export function readyChecksToPatch(v, who) {
  const at = new Date().toISOString()
  const stamp = `${Number(v.front) || 36}F/${Number(v.rear) || 36}R psi · ${who || 'tech'} · ${at.slice(0, 16)}`
  const patch = { tires_set: stamp, pcsi_checks: JSON.stringify({ belts: !!v.belts, airbags: !!v.airbags, front: Number(v.front) || 36, rear: Number(v.rear) || 36, windshield: !!v.windshieldOk, by: who || '', at }) }
  if (v.cash === '350' || v.cash === '700') patch.cash_quoted = v.cash
  return patch
}
export function readyChecksNote(v, job) {
  const bits = []
  if (needsWindshieldCheck(job) && v.windshieldOk) bits.push('🪟 windshield checked before calibration')
  return bits.join(' · ')
}

export default function ReadyChecks({ job, value, onChange, compact = false }) {
  const v = { ...DEFAULT_CHECKS, ...(value || {}) }
  const set = patch => onChange({ ...v, ...patch })
  const big = { minHeight: 48, fontSize: 16 }
  const windshield = needsWindshieldCheck(job)
  return (
    <div className="space-y-2">
      {/* 💵 Customer pay */}
      <div className="rounded-xl p-3" style={{ backgroundColor: v.cash === 'no' ? '#fafaf9' : '#f0fdf4', border: `1.5px solid ${v.cash === 'no' ? '#e7e5e4' : '#86efac'}` }}>
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-bold" style={{ color: '#1a1a1a' }}>💵 Customer pay?</span>
          <div className="flex gap-1">
            {[['no', 'No'], ['yes', 'Yes']].map(([id, label]) => {
              const on = id === 'no' ? v.cash === 'no' : v.cash !== 'no'
              return <button key={id} type="button" onClick={() => set({ cash: id === 'no' ? 'no' : (v.cash === 'no' ? 'yes' : v.cash) })} className="rounded-full px-4 font-bold text-sm" style={{ minHeight: 40, backgroundColor: on ? (id === 'no' ? '#555' : GREEN) : 'white', color: on ? 'white' : '#555', border: '1.5px solid #ddd' }}>{label}</button>
            })}
          </div>
        </div>
        {v.cash !== 'no' && (
          <div className="mt-2">
            <div className="text-xs mb-1" style={{ color: '#166534' }}>What was the customer told?</div>
            <div className="grid grid-cols-2 gap-2">
              {['350', '700'].map(n => (
                <button key={n} type="button" onClick={() => set({ cash: n })} className="rounded-xl font-extrabold" style={{ ...big, minHeight: 56, fontSize: 22, backgroundColor: v.cash === n ? GREEN : 'white', color: v.cash === n ? 'white' : GREEN, border: `2px solid ${GREEN}` }}>${n}</button>
              ))}
            </div>
            {v.cash === 'yes' && <div className="text-xs mt-1 font-semibold" style={{ color: ORANGE }}>Pick the number — Kat bills exactly that.</div>}
          </div>
        )}
      </div>

      {/* 🦺 PCSI: belts + airbags */}
      <div className="rounded-xl p-3 space-y-2" style={{ backgroundColor: v.belts && v.airbags ? '#f0fdf4' : '#fff7ed', border: `1.5px solid ${v.belts && v.airbags ? '#86efac' : '#fdba74'}` }}>
        <div className="text-sm font-bold" style={{ color: '#1a1a1a' }}>🦺 Post Collision Safety Inspection</div>
        <button type="button" onClick={() => set({ belts: !v.belts })} className="w-full rounded-xl font-bold text-left px-3 flex items-center gap-2" style={{ ...big, backgroundColor: v.belts ? GREEN : 'white', color: v.belts ? 'white' : '#9a3412', border: `1.5px solid ${v.belts ? GREEN : '#fdba74'}` }}>
          <span className="text-xl">{v.belts ? '☑' : '☐'}</span> Seat belts checked at every position (latch + retract)
        </button>
        <button type="button" onClick={() => set({ airbags: !v.airbags })} className="w-full rounded-xl font-bold text-left px-3 flex items-center gap-2" style={{ ...big, backgroundColor: v.airbags ? GREEN : 'white', color: v.airbags ? 'white' : '#9a3412', border: `1.5px solid ${v.airbags ? GREEN : '#fdba74'}` }}>
          <span className="text-xl">{v.airbags ? '☑' : '☐'}</span> Airbag system visually inspected (no light, covers intact)
        </button>
      </div>

      {/* 🛞 Tires */}
      <div className="rounded-xl p-3" style={{ backgroundColor: v.tiresOk ? '#f0fdf4' : '#fff7ed', border: `1.5px solid ${v.tiresOk ? '#86efac' : '#fdba74'}` }}>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-bold flex-1" style={{ color: '#1a1a1a' }}>🛞 Tire pressures</span>
          <label className="flex items-center gap-1 text-xs" style={{ color: '#555' }}>F
            <input type="number" inputMode="numeric" min="20" max="80" value={v.front} onChange={e => set({ front: e.target.value })} className="w-16 rounded-lg px-2 text-center font-bold" style={{ ...big, border: '1px solid #e0dbd6' }} />
          </label>
          <label className="flex items-center gap-1 text-xs" style={{ color: '#555' }}>R
            <input type="number" inputMode="numeric" min="20" max="80" value={v.rear} onChange={e => set({ rear: e.target.value })} className="w-16 rounded-lg px-2 text-center font-bold" style={{ ...big, border: '1px solid #e0dbd6' }} />
          </label>
          <span className="text-xs" style={{ color: '#888' }}>psi</span>
        </div>
        <button type="button" onClick={() => set({ tiresOk: !v.tiresOk })} className="mt-2 w-full rounded-xl font-bold text-left px-3 flex items-center gap-2" style={{ ...big, backgroundColor: v.tiresOk ? GREEN : 'white', color: v.tiresOk ? 'white' : '#9a3412', border: `1.5px solid ${v.tiresOk ? GREEN : '#fdba74'}` }}>
          <span className="text-xl">{v.tiresOk ? '☑' : '☐'}</span> All four set to the manufacturer spec
        </button>
      </div>

      {/* 🪟 Windshield */}
      {windshield && (
        <button type="button" onClick={() => set({ windshieldOk: !v.windshieldOk })} className="w-full rounded-xl font-bold text-left px-3 flex items-center gap-2" style={{ ...big, backgroundColor: v.windshieldOk ? GREEN : '#fef3c7', color: v.windshieldOk ? 'white' : '#92400e', border: `1.5px solid ${v.windshieldOk ? GREEN : '#f59e0b'}` }}>
          <span className="text-xl">{v.windshieldOk ? '☑' : '☐'}</span> 🪟 Windshield checked before calibrating (glass, bracket, cracks, tint)
        </button>
      )}
    </div>
  )
}
