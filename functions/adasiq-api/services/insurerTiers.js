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
  },
  AS: {
    label: 'Allstate',
    static: {
      a: 'AS - Calibration - Level 3a (Static)*',
      b: 'AS - Calibration - Level 3b (Static)**',
      c: 'AS - Calibration - Level 3c (Static)***',
    },
    dynamic: 'AS - Calibration - Level 2 (Dynamic)',
  },
  GEICO: {
    label: 'GEICO',
    static: {
      a: 'GEICO - Level 3 (Static)',
      b: 'GEICO - Level 4 (Static) Mercedes and Subaru',
      c: 'GEICO - Level 5 (Static) Audi, VW and Porsche',
    },
    dynamic: 'GEICO - Level 2 (Dynamic)',
  },
}

export const isTierPool = pool => !!TIERS[String(pool || '').toUpperCase()]

export function bandForMake(make) {
  const m = norm(make)
  if (!m) return 'a'
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
