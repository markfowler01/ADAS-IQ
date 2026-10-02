// VIN decoder (2026-09-14). NHTSA vPIC — free, no key, server side only.
// Validates the check digit before calling out, caches decodes in
// EstVinCache so a VIN is decoded once.
import axios from 'axios'
import catalyst from 'zcatalyst-sdk-node'

const TABLE = 'EstVinCache'
const VPIC = 'https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues'
const TRANS = { A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8, J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9, S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9 }
const WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2]

export function cleanVin(v) { return String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '') }

/** { ok, reason } — 17 chars, no I/O/Q, check digit (position 9) must match. */
export function validateVin(raw) {
  const vin = cleanVin(raw)
  if (vin.length !== 17) return { ok: false, vin, reason: `VIN must be 17 characters (got ${vin.length})` }
  if (/[IOQ]/.test(vin)) return { ok: false, vin, reason: 'VINs never contain I, O or Q' }
  let sum = 0
  for (let i = 0; i < 17; i++) {
    const ch = vin[i]
    const val = /\d/.test(ch) ? Number(ch) : TRANS[ch]
    if (val == null) return { ok: false, vin, reason: `Bad character "${ch}"` }
    sum += val * WEIGHTS[i]
  }
  const check = sum % 11
  const expect = check === 10 ? 'X' : String(check)
  if (vin[8] !== expect) return { ok: false, vin, reason: `Check digit mismatch (position 9 is "${vin[8]}", expected "${expect}")`, check_digit: false }
  return { ok: true, vin }
}

function pick(r) {
  const s = k => String(r[k] ?? '').trim()
  const engine = [s('DisplacementL') && `${Number(s('DisplacementL')).toFixed(1)}L`, s('EngineCylinders') && `${s('EngineCylinders')}-cyl`, s('EngineHP') && `${s('EngineHP')} hp`, s('FuelTypePrimary')].filter(Boolean).join(' ')
  return {
    year: s('ModelYear'), make: s('Make').replace(/\b\w+/g, w => w[0] + w.slice(1).toLowerCase()), model: s('Model'), trim: s('Trim') || s('Series'),
    body: s('BodyClass'), drive: s('DriveType'), engine, doors: s('Doors'), vehicle_type: s('VehicleType'),
    plant: [s('PlantCity'), s('PlantCountry')].filter(Boolean).join(', '),
    adas: {
      fcw: s('ForwardCollisionWarning'), aeb: s('CIB') || s('DynamicBrakeSupport'), lane_departure: s('LaneDepartureWarning'), lane_keep: s('LaneKeepSystem'),
      blind_spot: s('BlindSpotMon'), acc: s('AdaptiveCruiseControl'), rear_cross: s('RearCrossTrafficAlert'), park_assist: s('ParkAssist'), backup_cam: s('RearVisibilitySystem'),
    },
    error_code: s('ErrorCode'), error_text: s('ErrorText'),
  }
}

export async function decodeVin(req, raw) {
  const v = validateVin(raw)
  if (!v.ok) return { ok: false, ...v }
  const vin = v.vin
  const app = catalyst.initialize(req, { type: 'advancedio' })
  try {
    const rows = await app.zcql().executeZCQLQuery(`SELECT ev_decoded_json FROM ${TABLE} WHERE ev_vin = '${vin}' LIMIT 1`)
    const hit = (rows || []).map(r => r[TABLE] || r)[0]
    if (hit?.ev_decoded_json) return { ok: true, vin, cached: true, ...JSON.parse(hit.ev_decoded_json) }
  } catch (e) { console.log('[vin] cache read failed:', e.message) }
  const r = await axios.get(`${VPIC}/${vin}?format=json`, { timeout: 9000 })
  const row = r.data?.Results?.[0]
  if (!row) return { ok: false, vin, reason: 'No result from NHTSA' }
  const d = pick(row)
  if (!d.make && !d.model) return { ok: false, vin, reason: d.error_text || 'NHTSA could not decode this VIN' }
  try { await app.datastore().table(TABLE).insertRow({ ev_vin: vin, ev_decoded_json: JSON.stringify(d).slice(0, 9900), ev_created_at: new Date().toISOString() }) } catch (e) { console.log('[vin] cache write failed:', e.message) }
  return { ok: true, vin, cached: false, ...d }
}

// 🔎 Equipment check for the scrubber (Mark 2026-10-02: "check the vin decoder and
// see if the vehicle is equipped with radar and such"). NHTSA's ADAS fields are a
// good YES and a poor NO: "Standard" is reliable, but blanks and "Optional" are
// common even on equipped cars (2024 Transits decode blank). So the block tells
// the scrubber: Standard = equipped; anything else = unknown, confirm at pre-scan.
const EQUIP = [['acc', 'Adaptive cruise (front radar)'], ['aeb', 'Automatic emergency braking (front radar/camera)'], ['fcw', 'Forward collision warning'],
  ['lane_keep', 'Lane keep (windshield camera)'], ['lane_departure', 'Lane departure warning (windshield camera)'], ['blind_spot', 'Blind spot (rear radars)'],
  ['rear_cross', 'Rear cross-traffic'], ['park_assist', 'Park assist'], ['backup_cam', 'Backup camera']]
export function findVinInText(text) {
  for (const m of String(text || '').toUpperCase().matchAll(/\b[A-HJ-NPR-Z0-9]{17}\b/g)) if (validateVin(m[0]).ok) return m[0]
  return ''
}
export async function vinEquipment(req, vin) {
  if (!vin) return null
  const d = await decodeVin(req, vin).catch(() => null)
  if (!d?.ok) return null
  const std = EQUIP.filter(([k]) => /standard/i.test(d.adas?.[k] || '')).map(([, l]) => l)
  const opt = EQUIP.filter(([k]) => /optional/i.test(d.adas?.[k] || '')).map(([, l]) => l)
  const summary = std.length ? `Standard per VIN: ${std.join('; ')}` : 'VIN decode lists no ADAS equipment as standard'
  const block = `VIN DECODE (NHTSA, ${d.year} ${d.make} ${d.model}${d.trim ? ' ' + d.trim : ''}):\n- STANDARD on this VIN: ${std.join('; ') || 'none listed'}\n- Optional (may or may not be fitted): ${opt.join('; ') || 'none listed'}\nHow to use it: "Standard" means the system is fitted, so treat its sensor as equipped. Blank or "Optional" means the decode cannot tell; NEVER drop a calibration for that reason; keep the verdict from the repair lines and add the note "if equipped, confirm at pre-scan".`
  return { vin, std, opt, summary, block, make: d.make || '', year: d.year || '', model: d.model || '' }
}
