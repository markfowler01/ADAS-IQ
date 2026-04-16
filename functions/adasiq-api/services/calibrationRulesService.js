import catalyst from 'zcatalyst-sdk-node'

const TABLE = 'AdasCalibrationRules'

/**
 * Vehicle platform aliases — rebadged vehicles that share ADAS procedures with another make.
 * When a vehicle matches an alias entry, rules for ALL listed alsoApplyMakes are evaluated
 * in addition to the vehicle's own make.
 *
 * Format:
 *   make:          vehicle make (lowercase, partial match ok)
 *   modelContains: substring to match in model name (lowercase), or null = any model
 *   alsoApplyMakes: array of makes to treat as equivalent for rule matching
 *   note:          human-readable explanation
 */
const VEHICLE_ALIASES = [
  {
    make:           'honda',
    modelContains:  'pro',   // Honda Prologue (also catches "Pro" shorthand)
    alsoApplyMakes: ['gm', 'general motors', 'chevrolet', 'chevy'],
    note:           'Honda Prologue is a rebadged Chevrolet Blazer EV (GM Ultium platform) — apply all GM/Chevrolet rules',
  },
]

/**
 * Given a vehicle make + model, return any additional makes whose rules should also apply.
 */
function getAliasedMakes(make, model) {
  const m = make.toLowerCase()
  const mo = model.toLowerCase()
  const extra = []
  for (const alias of VEHICLE_ALIASES) {
    if (!m.includes(alias.make)) continue
    if (alias.modelContains && !mo.includes(alias.modelContains)) continue
    extra.push(...alias.alsoApplyMakes)
    console.log(`[rulesService] Alias match: ${make} ${model} → also applying rules for: ${alias.alsoApplyMakes.join(', ')} (${alias.note})`)
  }
  return extra
}

/**
 * Fetch all enabled rules from the AdasCalibrationRules table.
 */
async function getAllRules(req) {
  const sdk = catalyst.initialize(req, { type: 'advancedio' })
  const table = sdk.datastore().table(TABLE)
  const rows = await table.getAllRows()
  return (rows || [])
    .filter(r => r.enabled !== 'false')
    .map(r => ({
      id:                 String(r.ROWID),
      make:               (r.make || '').toLowerCase(),
      model:              (r.model || '').toLowerCase(),
      year_start:         r.year_start || '',
      year_end:           r.year_end || '',
      trigger_category:   r.trigger_category || '',
      trigger_keywords:   r.trigger_keywords || '',
      required_equipment: r.required_equipment || '',
      calibration_name:   r.calibration_name || '',
      cal_type:           r.cal_type || null,
      justification_template: r.justification_template || '',
      source:             r.source || '',
      rule_priority:      parseInt(r.rule_priority || '5'),
    }))
}

/**
 * Check if a rule matches the vehicle make/model/year.
 */
function vehicleMatches(rule, make, model, year) {
  // If rule has no make restriction, it applies to all vehicles
  if (rule.make && rule.make !== make.toLowerCase()) return false
  if (rule.model && !model.toLowerCase().includes(rule.model)) return false
  if (rule.year_start || rule.year_end) {
    const y = parseInt(year)
    if (rule.year_start && y < parseInt(rule.year_start)) return false
    if (rule.year_end && y > parseInt(rule.year_end)) return false
  }
  return true
}

/**
 * Check if any trigger keywords from the rule appear in the repair text.
 */
function triggerMatches(rule, repairText) {
  if (!rule.trigger_keywords) return false
  const text = repairText.toLowerCase()
  const keywords = rule.trigger_keywords.split(',').map(k => k.trim().toLowerCase())
  return keywords.some(k => k && text.includes(k))
}

/**
 * Check if the vehicle is equipped with any of the required equipment for this rule.
 * If required_equipment is empty, the rule applies regardless of equipment.
 */
function equipmentMatches(rule, vehicleEquipment) {
  if (!rule.required_equipment) return true
  const equipText = vehicleEquipment.toLowerCase()
  const items = rule.required_equipment.split(',').map(e => e.trim().toLowerCase())
  return items.some(e => e && equipText.includes(e))
}

/**
 * Check if a calibration with a similar name is already in the extracted results.
 */
function alreadyCovered(calibrationName, existingCalibrations) {
  const name = calibrationName.toLowerCase()
  return existingCalibrations.some(cal => {
    const existing = (cal.calibration_name || '').toLowerCase()
    // Check for significant word overlap
    const nameWords = name.split(/[\s\/\-—]+/).filter(w => w.length > 3)
    return nameWords.some(w => existing.includes(w))
  })
}

/**
 * Cross-reference AI-extracted calibrations against the rules database.
 * Returns additional calibrations found in the rules DB that the AI may have missed.
 *
 * @param {object} req - Express request (for Catalyst SDK)
 * @param {object} extracted - AI extraction result
 * @param {string} repairText - Full text of repair lines (for keyword matching)
 * @param {string} vehicleEquipment - Text listing vehicle ADAS equipment
 * @returns {Promise<Array>} - Additional calibrations to merge in
 */
export async function crossReferenceRules(req, extracted, repairText, vehicleEquipment) {
  try {
    const rules = await getAllRules(req)
    const make = extracted.make || ''
    const model = extracted.model || ''
    const year = extracted.year || ''
    const existingCals = extracted.calibrations || []
    const additional = []

    // Include any aliased makes (e.g. Honda Prologue → also match GM/Chevrolet rules)
    const aliasedMakes = getAliasedMakes(make, model)
    const makesToMatch = [make, ...aliasedMakes]

    for (const rule of rules) {
      // Must match vehicle make (or any aliased make)
      const matchedMake = makesToMatch.find(m => vehicleMatches({ ...rule, make: rule.make }, m, model, year))
      if (!matchedMake) continue
      // Must match a triggered repair operation
      if (!triggerMatches(rule, repairText)) continue
      // Must match vehicle equipment (if rule has equipment requirements)
      if (!equipmentMatches(rule, vehicleEquipment)) continue
      // Don't add if already covered by AI extraction
      if (alreadyCovered(rule.calibration_name, existingCals)) continue

      const isAliasMatch = matchedMake.toLowerCase() !== make.toLowerCase()

      // Build justification from template
      const justification = rule.justification_template
        .replace(/\{make\}/g, make || 'OEM')
        .replace(/\{model\}/g, model || '')

      additional.push({
        calibration_name: rule.calibration_name,
        cal_type: rule.cal_type || null,
        trigger: `Rules DB match (${rule.trigger_category})${isAliasMatch ? ` — platform alias: ${make} ${model} uses ${matchedMake} procedures` : ''}`,
        line_references: null,
        justification: isAliasMatch
          ? `${justification}\n\nNote: ${make} ${model} is built on the ${matchedMake} platform — ${make} procedures follow ${matchedMake} OEM requirements.`
          : justification,
        enabled: true,
        links: [],
        _source: 'RULES_DB',
        _rule_id: rule.id,
      })
    }

    return additional
  } catch (err) {
    console.warn('[rulesService] Cross-reference failed (non-fatal):', err.message)
    return []
  }
}

/**
 * Save a confirmed calibration as a new rule in the database.
 * Called when a job is sent to Zoho Books, to grow the rules DB over time.
 *
 * @param {object} req - Express request
 * @param {object} job - Job data (make, model, year, calibrations)
 */
export async function saveCalibrationAsRule(req, { make, model, year, calibration }) {
  try {
    const sdk = catalyst.initialize(req, { type: 'advancedio' })
    const table = sdk.datastore().table(TABLE)

    const row = {
      make:                  make || '',
      model:                 model || '',
      year_start:            year || '',
      year_end:              year || '',
      trigger_category:      'AI_CONFIRMED',
      trigger_keywords:      (calibration.trigger || '').toLowerCase(),
      required_equipment:    '',
      calibration_name:      calibration.calibration_name || '',
      cal_type:              calibration.cal_type || '',
      justification_template: calibration.justification || '',
      source:                'AI_CONFIRMED',
      enabled:               'true',
      rule_priority:         '7',
      notes:                 `Auto-learned: ${year} ${make} ${model} — trigger: ${calibration.trigger || 'unknown'}`,
      created_at:            new Date().toISOString(),
    }

    await table.insertRow(row)
    console.log(`[rulesService] Saved rule: ${calibration.calibration_name} for ${year} ${make} ${model}`)
  } catch (err) {
    console.warn('[rulesService] Failed to save calibration as rule (non-fatal):', err.message)
  }
}
