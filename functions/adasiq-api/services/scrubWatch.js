// 👀 Scrub watch (Mark 2026-10-26: "can we create some learning to catch this
// without my prompting"). From 10-14 to 10-26 the guard's line reader found
// nothing on CCC's glued PDF text and the VIN never decoded, and nobody knew
// until Mark asked about accuracy. Two alarms so that never sits quiet again:
//
// 1. Reader health, every CCC scrub. "Blind" = real estimate text, but the
//    reader parsed almost no numbered rows, or the AI cited lines for a required
//    calibration while the reader found zero trigger lines. Also counts scrubs
//    with no VIN found. 2+ blind or 3+ no-VIN in one PT day → Cliq DM to Mark, once a day.
// 2. Kinetic scorecard. Every time a Kinetic report and our CCC scrub exist for the
//    same VIN, the two required sets are compared and logged. Mondays: a weekly
//    scorecard DM. Any day: if the last 10 pairs drop under 70% recall → alert
//    (once a week). Kinetic is a reference, not truth — the alert says "look", it
//    never changes a rule.
//
// DurableKV: scrub_watch:<date>, kinetic_diff_log, scrub_watch_alerts.
import catalyst from 'zcatalyst-sdk-node'
import { kvGet, kvSet } from './durableKV.js'

const app = req => catalyst.initialize(req)
const todayPT = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const hourPT = () => Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', hour12: false }).format(new Date()))
const dowPT = () => new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short' }).format(new Date())
async function getJson(req, key, fallback) { try { const v = await kvGet(app(req), key); return v ? JSON.parse(v) : fallback } catch { return fallback } }
const setJson = (req, key, val) => kvSet(app(req), key, JSON.stringify(val))
async function dmMark(text) {
  try { const { postToCliqUser, TECH_CLIQ_IDS } = await import('./cliq.js'); await postToCliqUser(TECH_CLIQ_IDS.Mark, text) } catch (e) { console.warn('[scrub-watch] DM', e.message) }
}
// Once per tag (alerts never repeat for the same day / week).
async function once(req, tag) {
  const seen = await getJson(req, 'scrub_watch_alerts', [])
  if (seen.includes(tag)) return false
  await setJson(req, 'scrub_watch_alerts', [...seen, tag].slice(-200))
  return true
}

/** 1. After the guard, on every CCC scrub. Never throws. */
export async function noteReaderHealth(req, { data, text = '', hits = {} } = {}) {
  try {
    if (!data || data._demo || String(data._pdfType || '').toUpperCase() !== 'CCC') return null
    const textChars = String(text || '').length
    if (textChars < 3000) return null   // scanned / photo / Secure Share short text — not this reader's job
    const { estimateRows } = await import('./scrubGuard.js')
    const rows = estimateRows(text).length
    const totalHits = Object.values(hits || {}).reduce((n, a) => n + (Array.isArray(a) ? a.length : 0), 0)
    const aiCited = (data.calibrations || []).some(c => c.enabled === true && /\d/.test(String(c.line_references || '')))
    const blind = rows < 5 || (aiCited && totalHits === 0)
    const noVin = !data.vin_equipment
    data._readerHealth = { rows, hits: totalHits, blind, noVin }
    if (!blind && !noVin) return data._readerHealth
    const date = todayPT(), key = `scrub_watch:${date}`
    const day = await getJson(req, key, { blind: 0, noVin: 0, cars: [] })
    if (blind) day.blind++
    if (noVin) day.noVin++
    day.cars = [...day.cars, `${[data.year, data.make, data.model].filter(Boolean).join(' ') || 'car'}${blind ? ' (reader found ' + rows + ' rows, ' + totalHits + ' trigger lines)' : ''}${noVin ? ' (no VIN decode)' : ''}`].slice(-10)
    await setJson(req, key, day)
    if ((day.blind >= 2 || day.noVin >= 3) && await once(req, `health:${date}`)) {
      await dmMark([
        `🚨 *Scrubber check failed today* — the safety rules may be running blind.`,
        day.blind ? `• ${day.blind} estimate${day.blind > 1 ? 's' : ''} had real text but the line reader found almost nothing (no bumper / quarter / alignment lines), so the guard rules could not fire.` : '',
        day.noVin ? `• ${day.noVin} estimate${day.noVin > 1 ? 's' : ''} had no VIN decode, so equipment was guessed.` : '',
        `Cars: ${day.cars.join(' · ')}`,
        `Ask Claude to look at services/scrubGuard.js (estimateRows / triggerLinesFromText) and estimator/vin.js (findVinInText).`,
      ].filter(Boolean).join('\n'))
    }
    return data._readerHealth
  } catch (e) { console.warn('[scrub-watch] health', e.message); return null }
}

// Kinetic's vocabulary vs ours, the sensors both sides score (headlamp, battery,
// alignment and programming are outside Kinetic's list or billed differently).
const canon = n => { n = String(n || '').toLowerCase()
  if (/programming|reflash|headl|battery|align|tpms/.test(n)) return null
  if (/around view|surround|360|multi.?view/.test(n)) return 'Around View'
  if (/park/.test(n)) return 'Park Sensors'
  if (/windshield|front camera|forward camera|mono camera|stereo camera|eyesight/.test(n)) return 'Windshield Camera'
  if (/front side|corner/.test(n)) return 'Front Side Radar'
  if (/front radar|distance sensor|acc radar|distronic/.test(n)) return 'Front Radar'
  if (/blind/.test(n)) return 'Blind Spot'
  if (/back ?up|rear camera|rear view/.test(n)) return 'Back Up Camera'
  if (/steering/.test(n)) return 'Steering Angle'
  if (/seat weight|occupant/.test(n)) return 'Seat Weight'
  return null }
const reqSet = sensors => { const s = new Set((sensors || []).filter(x => x.r).map(x => canon(x.n)).filter(Boolean)); if (s.has('Around View')) s.delete('Back Up Camera'); return s }

/** 2. Called from saveScrub. When this scrub and its other half (Kinetic ⇄ CCC) both exist for the VIN, log the comparison. */
export async function noteKineticPair(req, { vin, pdfType, source = '', sensors = [], vehicle = '', id = '' } = {}) {
  try {
    vin = String(vin || '').toUpperCase()
    if (vin.length !== 17 || /^bench/i.test(source)) return null
    const type = String(pdfType || '').toUpperCase()
    if (type !== 'KINETIC' && type !== 'CCC') return null
    const want = type === 'KINETIC' ? 'CCC' : 'KINETIC'
    const rows = (await app(req).zcql().executeZCQLQuery(`SELECT ROWID, scrub_pdf_type, scrub_source, scrub_sensors, scrub_at FROM AdasScrubs WHERE scrub_vin = '${vin.replace(/[^A-Z0-9]/g, '')}' ORDER BY CREATEDTIME DESC LIMIT 20`) || [])
      .map(r => r.AdasScrubs || r).filter(r => String(r.scrub_pdf_type || '').toUpperCase() === want && !/^bench/i.test(r.scrub_source || ''))
    const other = rows[0]
    if (!other) return null
    let otherSensors = []; try { otherSensors = JSON.parse(other.scrub_sensors || '[]') } catch { /* none */ }
    const ours = reqSet(type === 'CCC' ? sensors : otherSensors)
    const kin = reqSet(type === 'KINETIC' ? sensors : otherSensors)
    const missed = [...kin].filter(x => !ours.has(x)), extra = [...ours].filter(x => !kin.has(x))
    const entry = { vin, car: vehicle, at: new Date().toISOString(), tp: [...kin].filter(x => ours.has(x)).length, missed, extra, ours: [...ours], kinetic: [...kin], ids: [id, other.ROWID] }
    const log = (await getJson(req, 'kinetic_diff_log', [])).filter(x => x.vin !== vin)   // latest pair per car
    log.push(entry)
    await setJson(req, 'kinetic_diff_log', log.slice(-500))
    // Rolling alarm: the last 10 pairs.
    const last = log.slice(-10)
    const tp = last.reduce((n, x) => n + x.tp, 0), fn = last.reduce((n, x) => n + x.missed.length, 0)
    const recall = tp + fn ? tp / (tp + fn) : 1
    if (last.length >= 10 && recall < 0.7 && await once(req, `recall:${isoWeek()}`)) {
      await dmMark([
        `📉 *Scrubber vs Kinetic: ${Math.round(recall * 100)}% on the last 10 cars* (we usually run 85%+). Something may have broken.`,
        ...last.filter(x => x.missed.length).slice(-6).map(x => `• ${x.car || x.vin}: Kinetic called ${x.missed.join(', ')}, we did not`),
        `Ask Claude to compare these against the estimates before touching any rule — Kinetic is a reference, not truth.`,
      ].join('\n'))
    }
    return entry
  } catch (e) { console.warn('[scrub-watch] kinetic pair', e.message); return null }
}

const isoWeek = () => { const d = new Date(`${todayPT()}T12:00:00Z`); const day = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - day); return d.toISOString().slice(0, 10) }

/** Summary of pairs logged since `sinceMs`. */
export function scoreLog(log, sinceMs, untilMs = Infinity) {
  const rows = (log || []).filter(x => { const t = Date.parse(x.at); return t >= sinceMs && t < untilMs })
  const tp = rows.reduce((n, x) => n + x.tp, 0), fn = rows.reduce((n, x) => n + x.missed.length, 0), fp = rows.reduce((n, x) => n + x.extra.length, 0)
  const tally = key => Object.entries(rows.flatMap(x => x[key]).reduce((m, s) => (m[s] = (m[s] || 0) + 1, m), {})).sort((a, b) => b[1] - a[1])
  return { cars: rows.length, recall: tp + fn ? tp / (tp + fn) : null, precision: tp + fp ? tp / (tp + fp) : null, missed: tally('missed'), extra: tally('extra'), rows }
}

/** Mondays from 7 AM PT, once: last week's scorecard to Mark. Piggybacks the daily tick. */
export async function maybeWeeklyScorecard(req, { force = false } = {}) {
  if (!force && (dowPT() !== 'Mon' || hourPT() < 7)) return { fired: false, reason: 'not-monday-morning' }
  if (!force && !(await once(req, `weekly:${isoWeek()}`))) return { fired: false, reason: 'already' }
  const log = await getJson(req, 'kinetic_diff_log', [])
  const now = Date.now(), wk = 7 * 86400000
  const cur = scoreLog(log, now - wk), prev = scoreLog(log, now - 2 * wk, now - wk)
  const pct = v => v == null ? '—' : `${Math.round(v * 100)}%`
  const health = []
  for (let i = 1; i <= 7; i++) { const d = new Date(Date.now() - i * 86400000); const k = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d); const h = await getJson(req, `scrub_watch:${k}`, null); if (h) health.push(h) }
  const blind = health.reduce((n, h) => n + h.blind, 0), noVin = health.reduce((n, h) => n + h.noVin, 0)
  const text = [
    `🧪 *Scrubber scorecard — last 7 days*`,
    cur.cars ? `${cur.cars} cars with a Kinetic report to compare. Caught ${pct(cur.recall)} of Kinetic's calls (last week ${pct(prev.recall)}); ${pct(cur.precision)} of ours matched Kinetic.` : 'No Kinetic reports came in for cars we scrubbed this week, so nothing to compare.',
    cur.missed.length ? `Missed most: ${cur.missed.slice(0, 4).map(([s, n]) => `${s} ×${n}`).join(', ')}` : '',
    cur.extra.length ? `Extra (often your own rules — alignment, Honda/Mazda/Nissan seat weight): ${cur.extra.slice(0, 4).map(([s, n]) => `${s} ×${n}`).join(', ')}` : '',
    ...cur.rows.filter(x => x.missed.length).slice(0, 5).map(x => `• ${x.car || x.vin}: missed ${x.missed.join(', ')}`),
    `Reader health: ${blind ? `⚠️ ${blind} blind read${blind > 1 ? 's' : ''}` : '✅ no blind reads'}${noVin ? ` · ${noVin} without a VIN decode` : ''}.`,
  ].filter(Boolean).join('\n')
  await dmMark(text)
  return { fired: true, cars: cur.cars, recall: cur.recall, precision: cur.precision }
}
