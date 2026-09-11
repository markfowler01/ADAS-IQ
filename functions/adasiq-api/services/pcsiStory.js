// PCSI story on the invoice (Mark 2026-09-11): "add in on the invoice that
// we did check the pressures and what they're at… part of the post
// collision safety inspection is also checking all the seatbelts and
// visually inspecting the airbag system."
//
// The tech's Ready-to-Invoice checks become one sentence block written
// onto the Books quote's Post Collision Safety Inspection line (fallback:
// Post-Scan line, then the first line). Written the moment the job goes to
// Ready to Invoice, so Kat's manual Convert and 💸 Bill it both carry it.
import axios from 'axios'

const API = 'https://www.zohoapis.com/books/v3'
const H = t => ({ Authorization: `Zoho-oauthtoken ${t}` })
const org = () => ({ organization_id: process.env.ZOHO_ORGANIZATION_ID })
export const STORY_PREFIX = 'Post-collision safety inspection:'

export function parseChecks(raw) {
  if (!raw) return null
  try { const o = typeof raw === 'string' ? JSON.parse(raw) : raw; return o && typeof o === 'object' ? o : null } catch { return null }
}

// Short "Jayden G." from "Jayden Goshorn"
function shortName(n) {
  const parts = String(n || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return ''
  return parts.length === 1 ? parts[0] : `${parts[0]} ${parts[parts.length - 1][0]}.`
}

/**
 * Build the customer-facing sentence block from the job's checks.
 *   checks: { belts, airbags, front, rear, windshield, by, at }
 *   miles:  test-drive delta from the photo set (number | null)
 */
export function buildStory(job, checks, miles = null) {
  const c = checks || parseChecks(job?.pcsi_checks)
  if (!c) return ''
  const bits = []
  if (c.belts) bits.push('seat belts checked at all positions')
  if (c.airbags) bits.push('airbag system visually inspected')
  if (c.front || c.rear) bits.push(`tire pressures set to manufacturer spec at ${Number(c.front) || 36} psi front / ${Number(c.rear) || 36} psi rear`)
  const sentences = []
  if (bits.length) sentences.push(`${STORY_PREFIX} ${bits.join(', ')}.`)
  if (miles != null && miles > 0) sentences.push(`Test drive ${Number(miles).toFixed(1).replace(/\.0$/, '')} mi after calibration.`)
  if (c.windshield) sentences.push('Windshield inspected before camera calibration.')
  const who = shortName(c.by || job?.technician)
  const when = c.at ? new Date(c.at) : new Date()
  const date = when.toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', month: 'numeric', day: 'numeric', year: 'numeric' })
  if (who) sentences.push(`Technician ${who}, ${date}.`)
  return sentences.join(' ')
}

// Replace an earlier story (same prefix) or append; keep the item's own words.
export function mergeDescription(existing, story) {
  const base = String(existing || '').split(/\n?Post-collision safety inspection:[^\n]*/i)[0].trimEnd()
  if (!story) return base
  return base ? `${base}\n${story}` : story
}

export function pickStoryLine(lineItems) {
  const li = lineItems || []
  return li.find(l => /post collision safety inspection|\bpcsi\b/i.test(l.name || ''))
    || li.find(l => /post[- ]?(calibration )?scan/i.test(l.name || ''))
    || li[0] || null
}

/** Write the story onto the Books estimate. Returns { line, story } or null. */
export async function writeStoryToEstimate(token, estimateId, story) {
  if (!estimateId || !story) return null
  const r = await axios.get(`${API}/estimates/${estimateId}`, { headers: H(token), params: org(), timeout: 15000, validateStatus: s => s < 500 })
  const est = r.data?.estimate
  if (!est) return null
  const target = pickStoryLine(est.line_items)
  if (!target) return null
  const merged = mergeDescription(target.description, story)
  if (merged === String(target.description || '')) return { line: target.name, story, unchanged: true }
  const lineItems = (est.line_items || []).map(li => ({
    line_item_id: li.line_item_id, item_id: li.item_id, name: li.name, rate: li.rate, quantity: li.quantity,
    description: li.line_item_id === target.line_item_id ? merged : (li.description || ''),
  }))
  const u = await axios.put(`${API}/estimates/${estimateId}`, { line_items: lineItems }, { headers: H(token), params: org(), timeout: 20000, validateStatus: s => s < 500 })
  if (u.data?.code !== 0) throw new Error(u.data?.message || `HTTP ${u.status}`)
  return { line: target.name, story }
}
