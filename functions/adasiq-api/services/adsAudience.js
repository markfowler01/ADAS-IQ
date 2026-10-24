// 📣 Paid-ads readiness: Meta Custom Audience files (Mark 2026-10-24: "build out all the
// systems so that we're ready for [paid ads] once we can afford it").
//
// Two CSVs in Meta's customer-list format (email, phone, fn, ln, ct, st, zip, country),
// built from the CRM shops and saved to the private WorkDrive "Ads Ready" folder:
//   • customers  — pipeline_stage active (seed for lookalikes; exclude from prospecting ads)
//   • prospects  — every other shop stage (retarget / prospecting)
// Meta hashes the file on upload. Competitors, our own addresses and non-shop CRM rows are
// silently skipped (same filters as the guide drop). Nothing is uploaded to Meta from here.
import { getAllShops } from '../routes/shops.js'
import { getVal, setVal } from './vanDatastore.js'

const COMPETITOR_RE = /avscalibrations|hivecalibrations|abs-c|calibration/i
const OURS_RE = /@absoluteadas\.com$|@adas-iq\.com$|^mfowler/i
const NOT_A_SHOP_RE = /trucking|landscap|autozone|the auto repair shop/i
const BIZ_WORD_RE = /\b(llc|inc|co|corp|auto|autos|automotive|body|shop|collision|motors?|motorsports|transmission|glass|towing|tint|repair|sales|fleet|center|carstar|maaco|gerber|goodyear|ford|toyota|honda|subaru|credit|care|guys|pros|unlimited|international|pioneers|refinishing|service|dealer)\b/i
const HEADER = ['email', 'phone', 'fn', 'ln', 'ct', 'st', 'zip', 'country']

const csvCell = v => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v)

function e164(phone) {
  const d = String(phone || '').replace(/\D/g, '')
  if (d.length === 10) return `+1${d}`
  if (d.length === 11 && d.startsWith('1')) return `+${d}`
  return ''
}

/** "123 Main St, Lynnwood, WA 98036" → { ct, st, zip } (best effort). */
export function parseAddress(address) {
  const a = String(address || '')
  const m = a.match(/(?:^|,)\s*([^,]+?),?\s+([A-Z]{2})\s*(\d{5})?(?:-\d{4})?\s*(?:,\s*(?:USA|United States))?\s*$/i)
  if (!m) return { ct: '', st: '', zip: '' }
  return { ct: m[1].trim().toLowerCase(), st: m[2].toLowerCase(), zip: m[3] || '' }
}

function personName(name, shopName) {
  const n = String(name || '').trim()
  if (!n || n.toLowerCase() === String(shopName || '').trim().toLowerCase() || BIZ_WORD_RE.test(n)) return { fn: '', ln: '' }
  const parts = n.split(/\s+/)
  if (parts.length > 3) return { fn: '', ln: '' }
  return { fn: parts[0].toLowerCase(), ln: parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '' }
}

/** One row per distinct email or phone; competitors / ours / non-shops skipped. */
export function buildAudienceRows(shops) {
  const groups = { customers: [], prospects: [] }
  const seen = new Set()
  let skipped = 0
  for (const s of shops || []) {
    const shopName = String(s.shop_name || '')
    if (COMPETITOR_RE.test(`${shopName} ${s.email || ''}`) || NOT_A_SHOP_RE.test(shopName)) { skipped++; continue }
    const loc = parseAddress(s.address)
    const people = [...(s.people || []), { name: s.contact_name, email: s.email, phone: s.phone }]
    const group = String(s.pipeline_stage || '').toLowerCase() === 'active' ? 'customers' : 'prospects'
    for (const p of people) {
      const email = String(p?.email || '').trim().toLowerCase()
      const phone = e164(p?.phone)
      if (email && (OURS_RE.test(email) || COMPETITOR_RE.test(email))) continue
      const key = email || phone
      if (!key || seen.has(key)) continue
      seen.add(key)
      const { fn, ln } = personName(p?.name, shopName)
      groups[group].push({ email: email.includes('@') ? email : '', phone, fn, ln, ...loc, country: 'us' })
    }
  }
  return { ...groups, skipped }
}

export const toCsv = rows => [HEADER.join(','), ...rows.map(r => HEADER.map(h => csvCell(r[h] || '')).join(','))].join('\n') + '\n'

async function adsReadyFolder(req, token) {
  const meta = (await getVal(req, 'ads_ready').catch(() => null)) || {}
  if (meta.folder_id) return meta.folder_id
  const brand = (await getVal(req, 'family_brand').catch(() => null)) || {}
  if (!brand.photos_folder_id) throw new Error('no Father & Son folder to anchor the Ads Ready folder next to')
  const axios = (await import('axios')).default
  const info = await axios.get(`https://workdrive.zoho.com/api/v1/files/${brand.photos_folder_id}`, {
    headers: { Authorization: `Zoho-oauthtoken ${token}`, Accept: 'application/vnd.api+json' }, timeout: 15000,
  })
  const parentId = info.data?.data?.attributes?.parent_id
  if (!parentId) throw new Error('could not find the parent folder')
  const { createFolderUnder } = await import('./workdrive.js')
  const f = await createFolderUnder(parentId, 'Ads Ready', token)
  await setVal(req, 'ads_ready', { ...meta, folder_id: f.folderId, created_at: new Date().toISOString() })
  return f.folderId
}

/** Build both CSVs and save them (dated) to WorkDrive. Returns counts only, never the PII. */
export async function exportAudiences(req) {
  const rows = buildAudienceRows(await getAllShops(req))
  const { getAccessToken } = await import('./zoho.js')
  const { uploadFileToFolder } = await import('./workdrive.js')
  const token = await getAccessToken()
  const folderId = await adsReadyFolder(req, token)
  const date = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
  for (const group of ['customers', 'prospects']) {
    await uploadFileToFolder(folderId, `meta-audience-${group}-${date}.csv`, Buffer.from(toCsv(rows[group])), token, 'text/csv')
  }
  const meta = (await getVal(req, 'ads_ready').catch(() => null)) || {}
  await setVal(req, 'ads_ready', { ...meta, last_export: { date, customers: rows.customers.length, prospects: rows.prospects.length, skipped: rows.skipped } })
  return { ok: true, folder_url: `https://workdrive.zoho.com/folder/${folderId}`, customers: rows.customers.length, prospects: rows.prospects.length, skipped_shops: rows.skipped }
}
