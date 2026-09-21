// Tier-priced insurers (Mark 2026-09-21). State Farm, Allstate and GEICO
// do NOT price by calibration name — their schedules price by what the
// Kinetic report calls the calibration (static or dynamic) and by the
// manufacturer. Mark's rules, verbatim:
//
//   "3A, 3B and 3C are all static calibrations, and that's if it says
//    static on the Kinetic report. Level 2 dynamic would be a dynamic
//    calibration if it says dynamic only on the calibration report.
//    3B is Mercedes and Subaru, 3C is Audi Porsche and Volkswagen. And
//    if you do a 3B and it is a Subaru you also add in Level 2 Dynamic
//    Calibration — it's a two-step calibration."
//
// Allstate and GEICO carry the same shape with their own item names, so
// one table drives all three. Item names are the exact Zoho Books names;
// if an item is renamed in Books, fix it HERE (the resolver matches on
// normalized name, so punctuation and case drift are already tolerated).

import catalyst from 'zcatalyst-sdk-node'

const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

// Band b = Mercedes + Subaru · band c = Audi, Porsche, VW · everyone else = a
export const BAND_B_MAKES = ['mercedes', 'mercedes benz', 'subaru']
export const BAND_C_MAKES = ['audi', 'porsche', 'volkswagen', 'vw']
// A static calibration on these makes is a two-step: the static tier line
// PLUS the dynamic line (Subaru EyeSight).
export const TWO_STEP_MAKES = ['subaru']

export const TIERS = {
  SF: {
    label: 'State Farm',
    static: {
      a: 'SFP - 3A Static Calibrations - (All others)',
      b: 'SFP - 3B Static Calibrations - (Mercedes and Subaru)',
      c: 'SFP - 3C Static Calibrations - (Audi, Porsche, Volkswagen)',
    },
    dynamic: 'SFP - Level 2 - Dynamic Calibrations',
    additional: {
      a: 'SFP - Additional Static Calibration(s) - Level 3A',
      b: 'SFP - Additional Static Calibration(s) - Level 3B',
      c: 'SFP - Additional static Calibration(s) - Level 3C',
      dynamic: 'SFP - Additional Static Calibration(s) - Level 2 - dynamic',
    },
  },
  AS: {
    label: 'Allstate',
    static: {
      a: 'AS - Calibration - Level 3a (Static)*',
      b: 'AS - Calibration - Level 3b (Static)**',
      c: 'AS - Calibration - Level 3c (Static)***',
    },
    dynamic: 'AS - Calibration - Level 2 (Dynamic)',
    // Allstate publishes no "additional" rates — every calibration on the
    // car bills the full tier.
    additional: null,
  },
  GEICO: {
    label: 'GEICO',
    static: {
      a: 'GEICO - Level 3 (Static)',
      b: 'GEICO - Level 4 (Static) Mercedes and Subaru',
      c: 'GEICO - Level 5 (Static) Audi, VW and Porsche',
    },
    dynamic: 'GEICO - Level 2 (Dynamic)',
    additional: {
      a: 'GEICO - Level 3 Additional (same RO)',
      b: 'GEICO - Level 4 Additional (same RO)',
      c: 'GEICO - Level 5 Additional (same RO)',
      dynamic: 'GEICO - Level 2 Additional (same RO)',
    },
  },
}

export const isTierPool = pool => !!TIERS[String(pool || '').toUpperCase()]

export function bandForMake(make) {
  const m = norm(make)
  if (!m) return 'a'
  // Anything Kat corrected on the price review wins over the built-in list.
  for (const [k, v] of Object.entries(_bands)) if (k && m.includes(k) && ['a', 'b', 'c'].includes(v)) return v
  if (BAND_C_MAKES.some(x => m.includes(x))) return 'c'
  if (BAND_B_MAKES.some(x => m.includes(x))) return 'b'
  return 'a'
}

export const isTwoStepMake = make => TWO_STEP_MAKES.some(x => norm(make).includes(x))

// "Static", "Static or Dynamic" → static tier. Only a report that says
// dynamic and nothing else is a Level 2. No type on the report = no
// guess; the name matcher handles it as before.
export function calKind(calType) {
  const t = norm(calType)
  if (!t) return null
  if (t.includes('static')) return 'static'
  if (t.includes('dynamic')) return 'dynamic'
  return null
}

/**
 * Which tier item this calibration bills on.
 * → { itemName, band, kind, two_step, alsoItemName } or null when the
 *   pool isn't tier-priced or the report didn't say static/dynamic.
 */
export function tierFor(pool, make, calType) {
  const t = TIERS[String(pool || '').toUpperCase()]
  if (!t) return null
  const kind = calKind(calType)
  if (!kind) return null
  if (kind === 'dynamic') return { itemName: t.dynamic, band: 'dynamic', kind, two_step: false, alsoItemName: null }
  const band = bandForMake(make)
  const two = isTwoStepMake(make)
  return { itemName: t.static[band], band, kind, two_step: two, alsoItemName: two ? t.dynamic : null }
}

/** Resolve a tier item name against the live catalog (tolerates name drift). */
export function findTierItem(allItems, itemName) {
  if (!itemName) return null
  const want = norm(itemName)
  return (allItems || []).find(i => norm(i.name) === want)
      || (allItems || []).find(i => norm(i.name).startsWith(want.slice(0, 24)))
      || null
}

/**
 * Plan a whole car at once (Mark 2026-09-21: "the main static calibration
 * is the full price and then the additional is the Level 2 on a Subaru,
 * and so on"). The dearest calibration bills its full tier; every other
 * one on the same RO drops to that pool's Additional rate. The second
 * step of a two-step is never the main line, so it always bills as an
 * additional.
 *
 * calibrations: [{ calibration_name, cal_type }]
 * items: the Books catalog (for rates and to confirm the item exists)
 * → Map keyed by lowercased calibration name →
 *     { item, band, kind, additional, also, two_step }
 */
export function planTiers({ pool, make, calibrations, items }) {
  const plan = new Map()
  const P = String(pool || '').toUpperCase()
  const t = TIERS[P]
  if (!t) return plan
  const rateOf = it => Number(it?.rate) || 0
  const addItem = band => (t.additional ? findTierItem(items, t.additional[band]) : null)

  // 1. Base tier for every calibration the report typed.
  const entries = []
  for (const c of calibrations || []) {
    const name = c?.calibration_name || c?.name
    if (!name) continue
    const r = tierFor(P, make, c?.cal_type)
    if (!r) continue
    const full = findTierItem(items, r.itemName)
    if (!full) continue
    entries.push({ name, r, full })
  }
  if (!entries.length) return plan

  // 2. The dearest line is the main one; ties keep report order.
  let mainAt = 0
  for (let i = 1; i < entries.length; i++) if (rateOf(entries[i].full) > rateOf(entries[mainAt].full)) mainAt = i

  // 3. Everything else bills the additional rate when the pool has one.
  entries.forEach((e, i) => {
    const isAdd = i !== mainAt
    const alt = isAdd ? addItem(e.r.kind === 'dynamic' ? 'dynamic' : e.r.band) : null
    const also = e.r.alsoItemName
      ? (addItem('dynamic') || findTierItem(items, e.r.alsoItemName))   // step 2 is always an additional
      : null
    plan.set(String(e.name).toLowerCase(), {
      item: alt || e.full,
      band: e.r.band, kind: e.r.kind,
      additional: isAdd && !!alt,
      two_step: !!also,
      also,
    })
  })
  return plan
}

// ── Learning from Kat ──────────────────────────────────────────────────
// Mark 2026-09-21: "whatever Kat changes can you learn from her on this."
// A swap on the price review teaches two different things:
//   · a one-off item for this calibration → the tier map (tierMap.js)
//   · a WHOLE MAKE that sits in the wrong band → here, so every other
//     calibration on that make prices right too.
// Band overrides live in AppConfig `insurer_tier_bands`: { "genesis": "b" }.
const BANDS_KEY = 'insurer_tier_bands'
let _bands = {}, _bandsAt = 0

export function bandOverrides() { return _bands }

export async function loadBandOverrides(req, force = false) {
  if (!force && Date.now() - _bandsAt < 5 * 60000) return _bands
  try {
    const app = catalyst.initialize(req)
    const rows = await app.zcql().executeZCQLQuery(
      `SELECT config_value FROM AppConfig WHERE config_key = '${BANDS_KEY}' LIMIT 1`)
    const v = rows?.[0]?.AppConfig?.config_value || rows?.[0]?.config_value
    const parsed = v ? JSON.parse(v) : {}
    if (parsed && typeof parsed === 'object') _bands = parsed
  } catch (e) { console.warn('[tiers] band overrides unavailable:', e.message) }
  _bandsAt = Date.now()
  return _bands
}

export async function saveBandOverride(req, make, band, by) {
  const m = norm(make)
  if (!m || !['a', 'b', 'c'].includes(band)) return { saved: false }
  await loadBandOverrides(req, true)
  if (_bands[m] === band) return { saved: false }
  _bands = { ..._bands, [m]: band }
  const app = catalyst.initialize(req)
  const table = app.datastore().table('AppConfig')
  const rows = await app.zcql().executeZCQLQuery(
    `SELECT ROWID FROM AppConfig WHERE config_key = '${BANDS_KEY}' LIMIT 1`).catch(() => [])
  const r = rows?.[0]?.AppConfig || rows?.[0]
  const str = JSON.stringify(_bands)
  if (r?.ROWID) await table.updateRow({ ROWID: String(r.ROWID), config_key: BANDS_KEY, config_value: str })
  else await table.insertRow({ config_key: BANDS_KEY, config_value: str })
  _bandsAt = Date.now()
  console.log(`[tiers] learned band: ${m} → ${band} (by ${by || '?'})`)
  return { saved: true, make: m, band }
}

/** Which band (and whether it's the additional rate) an item name belongs to. */
export function bandOfItem(pool, itemName) {
  const t = TIERS[String(pool || '').toUpperCase()]
  if (!t || !itemName) return null
  const want = norm(itemName)
  for (const [band, n] of Object.entries(t.static)) if (norm(n) === want) return { band, additional: false }
  if (norm(t.dynamic) === want) return { band: 'dynamic', additional: false }
  for (const [band, n] of Object.entries(t.additional || {})) if (norm(n) === want) return { band, additional: true }
  return null
}

export const isAdditionalItem = (pool, itemName) => !!bandOfItem(pool, itemName)?.additional
