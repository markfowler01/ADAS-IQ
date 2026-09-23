// 🔗 Shop integrations (Mark 2026-09-23): Kinetic through CCC Secure Share,
// and ADAS Maps (Allstate + State Farm's platform). Two toggles on the CRM
// shop's Billing tab. The on-site step stays human — but anyone can do it
// with the phone walk-through — everything around it is automatic.
import catalyst from 'zcatalyst-sdk-node'
import { postToCliqChannel, postToCliqChannelById, DISPATCH_CHANNEL, MARK_ALERT_CHANNEL_ID } from './cliq.js'

export const WHICH = ['kinetic', 'adasmaps']
export const LABEL = { kinetic: 'Kinetic (CCC Secure Share)', adasmaps: 'ADAS Maps' }
const KAT = 'k.belmonte@absoluteadas.com'
const nowIso = () => new Date().toISOString()
const cfgRead = async (req, key, fb = '') => { try { const rows = await catalyst.initialize(req, { type: 'advancedio' }).zcql().executeZCQLQuery(`SELECT config_value FROM AppConfig WHERE config_key = '${key}' LIMIT 1`); return rows?.[0]?.AppConfig?.config_value ?? fb } catch { return fb } }

// ── The walk-through: one screen per click, anyone can follow it at the counter.
//    image keys map to AppConfig `walkthrough_images` (Mark's screenshots, added later).
export const KINETIC_STEPS = [
  { key: 'ask',     title: 'Ask for the person who runs CCC ONE', text: 'Say: "Hi, I\'m with Absolute ADAS. Two minutes on your CCC ONE lets your estimates flow to our calibration reports — no more emailing PDFs." Sit at their CCC ONE computer.', whatIf: 'Nobody available? Get the owner\'s name + email and tap "Turned on at the shop" later — the app will still email Kinetic once you tick it.' },
  { key: 'config',  title: 'Open Configuration', text: 'Top-right gear (or the ⋮ menu) → Configuration.', whatIf: 'No gear? They may be on an estimator-only login. Ask for an admin login.', image: 'kinetic_config' },
  { key: 'share',   title: 'Click CCC Secure Share', text: 'In the left list of Configuration, click "CCC Secure Share".', whatIf: 'Not in the list? Secure Share isn\'t enabled on their CCC account — they call CCC support (it\'s free) and we come back.', image: 'kinetic_secureshare' },
  { key: 'market',  title: 'Open Marketplace', text: 'Click the "Marketplace" tab at the top of Secure Share.', whatIf: 'Tab missing = not an admin. Ask the owner to log in.', image: 'kinetic_marketplace' },
  { key: 'kinetic', title: 'Find Kinetic and turn it ON', text: 'Scroll down to "Kinetic". Flip it ON (Enabled). Click Save if there is a Save button.', whatIf: 'Already ON? You\'re done — tap "Turned on at the shop".', image: 'kinetic_toggle' },
  { key: 'done',    title: 'Tap "Turned on at the shop" below', text: 'That\'s it on their side. The app now emails Kinetic (Parisa) the shop name, owner and email; Kinetic connects it within a few days and the first report proves it.', whatIf: '' },
]
export const ADASMAPS_STEPS = [
  { key: 'login',  title: 'Shop logs in to ADAS Maps', text: 'The shop (usually the estimator) opens ADAS Maps — the platform Allstate and State Farm use.', whatIf: 'Not on ADAS Maps? Then they don\'t need this — turn the toggle off.', image: 'adasmaps_home' },
  { key: 'vendors', title: 'Open Vendors', text: 'Menu → Vendors.', whatIf: '', image: 'adasmaps_vendors' },
  { key: 'search', title: 'Search "Absolute ADAS"', text: 'Type Absolute ADAS in the vendor search. We\'re the first result.', whatIf: 'Not showing? Try "Absolute" — and tell Mark.', image: 'adasmaps_search' },
  { key: 'add',    title: 'Add us as their vendor', text: 'Click Add. Done — from now on we\'re notified every time a car is ready.', whatIf: '', image: 'adasmaps_add' },
]

export function readIntegrations(shop) {
  const br = typeof shop?.billing_rules === 'string' ? (JSON.parse(shop.billing_rules || '{}') || {}) : (shop?.billing_rules || {})
  const ints = br.integrations || {}
  const norm = w => ({ state: 'off', history: [], ...(ints[w] || {}) })
  return { kinetic: norm('kinetic'), adasmaps: norm('adasmaps') }
}
async function save(req, shop, which, patch, by, note) {
  const { updateShop } = await import('../routes/shops.js')
  const br = typeof shop.billing_rules === 'string' ? (JSON.parse(shop.billing_rules || '{}') || {}) : (shop.billing_rules || {})
  const cur = { state: 'off', history: [], ...((br.integrations || {})[which] || {}) }
  const next = { ...cur, ...patch, history: [...(cur.history || []).slice(-19), { at: nowIso(), by: by || '', note: note || patch.state || '' }] }
  const integrations = { ...(br.integrations || {}), [which]: next }
  const updated = await updateShop(req, shop.id, { ...shop, billing_rules: { ...br, integrations } })
  return { shop: updated, integration: next }
}
const ownerOf = shop => { const p = (shop.people || []).find(x => x?.name || x?.email) || {}; return { name: p.name || shop.contact_name || '', email: p.email || shop.email || '', phone: p.phone || shop.phone || '' } }

export async function setState(req, shop, which, state, by, note) { return save(req, shop, which, { state, ...(state === 'connected' ? { connected_at: nowIso() } : {}), ...(state === 'off' ? { connected_at: '', emailed_at: '', invited_at: '' } : {}) }, by, note) }

/** Kinetic: the on-site step was done → email Parisa automatically (Mark 2026-09-23). */
export async function kineticStepDone(req, shop, by) {
  const owner = ownerOf(shop)
  const to = String(await cfgRead(req, 'kinetic_contact_email', 'parisa.sayadi@kinetic.auto')).trim() || 'parisa.sayadi@kinetic.auto'
  let emailed = false, err = ''
  try {
    const { getMailAccessToken, getMailAccountIdFor, sendMail } = await import('./mail.js')
    const token = await getMailAccessToken(); const accountId = await getMailAccountIdFor(token, 'mark@absoluteadas.com')
    const body = `<p>Hi Parisa,</p><p>Please connect a new shop to Absolute ADAS on Kinetic. They turned Kinetic on in CCC Secure Share today.</p>
<table style="border-collapse:collapse">${[['Shop', shop.shop_name], ['Owner / contact', owner.name || '—'], ['Email', owner.email || '—'], ['Phone', owner.phone || shop.phone || '—'], ['Address', shop.address || '—'], ['Calibration vendor', 'Absolute ADAS']].map(([k, v]) => `<tr><td style="padding:3px 10px 3px 0;color:#666">${k}</td><td style="padding:3px 0"><b>${String(v).replace(/</g, '&lt;')}</b></td></tr>`).join('')}</table>
<p>Thanks!<br>Mark Fowler · Absolute ADAS · (844) 349-2327</p>`
    await sendMail(token, accountId, { to, cc: KAT, subject: `Kinetic connection request — ${shop.shop_name}`, body })
    emailed = true
  } catch (e) { err = e.message; console.warn('[integrations] Parisa email failed:', e.message) }
  const r = await save(req, shop, 'kinetic', { state: 'pending', step_done_at: nowIso(), emailed_at: emailed ? nowIso() : '', owner_name: owner.name, owner_email: owner.email, email_error: err }, by, emailed ? `turned on at the shop · emailed ${to}` : `turned on at the shop · EMAIL FAILED: ${err}`)
  await postToCliqChannel(DISPATCH_CHANNEL, `🔗 *Kinetic turned on at ${shop.shop_name}* by ${by || 'staff'} — ${emailed ? `Parisa emailed (${owner.name || 'owner'}${owner.email ? ' · ' + owner.email : ''}). Connected when the first report lands.` : `⚠ email to Kinetic failed: ${err}`}`).catch(() => {})
  return { ...r, emailed, to, error: err }
}

/** ADAS Maps: send the shop the three steps (text + email), state → pending. */
export async function adasMapsInvite(req, shop, by) {
  const owner = ownerOf(shop)
  const steps = 'Open ADAS Maps → Vendors → search "Absolute ADAS" (we are the first one) → Add. That is it. We get told the moment a car is ready.'
  let texted = false, emailed = false, errs = []
  if (owner.phone) { try { const { sendTwilioSMS } = await import('./twilio.js'); const { resolvePhoneConfig } = await import('./phoneConfig.js'); const cfg = await resolvePhoneConfig(req); const r = await sendTwilioSMS({ to: owner.phone, body: `Absolute ADAS: ${owner.name ? owner.name.split(' ')[0] + ', ' : ''}quick one for ADAS Maps. ${steps} Questions? Call (844) 349-2327. — Mark`, from: 'local', cfg }); texted = !!r.ok; if (!r.ok) errs.push(r.error) } catch (e) { errs.push(e.message) } }
  if (owner.email) { try { const { getMailAccessToken, getMailAccountIdFor, sendMail } = await import('./mail.js'); const token = await getMailAccessToken(); const accountId = await getMailAccountIdFor(token, 'mark@absoluteadas.com'); await sendMail(token, accountId, { to: owner.email, cc: KAT, subject: `Add Absolute ADAS as your vendor in ADAS Maps (2 minutes)`, body: `<p>Hi ${owner.name ? owner.name.split(' ')[0] : 'there'},</p><p>Quick one so your ADAS calibrations flow straight to us:</p><ol><li>Open <b>ADAS Maps</b></li><li>Go to <b>Vendors</b></li><li>Search <b>Absolute ADAS</b> — we're the first result</li><li>Click <b>Add</b></li></ol><p>That's it. From then on we get told the moment a car is ready.</p><p>Thanks,<br>Mark Fowler · Absolute ADAS · (844) 349-2327</p>` }); emailed = true } catch (e) { errs.push(e.message) } }
  const r = await save(req, shop, 'adasmaps', { state: 'pending', invited_at: nowIso(), owner_name: owner.name, owner_email: owner.email, invite_error: errs.join('; ') }, by, `steps sent${texted ? ' by text' : ''}${emailed ? ' by email' : ''}${errs.length ? ' · errors: ' + errs.join('; ') : ''}`)
  await postToCliqChannel(DISPATCH_CHANNEL, `🔗 *ADAS Maps steps sent to ${shop.shop_name}* by ${by || 'staff'} — ${texted ? 'text ✓ ' : ''}${emailed ? 'email ✓ ' : ''}${errs.length ? '⚠ ' + errs.join('; ') : ''}${!owner.phone && !owner.email ? '⚠ no owner phone or email on the CRM card — nothing went out' : ''}`).catch(() => {})
  return { ...r, texted, emailed, errors: errs }
}

/** Auto-verify: a Kinetic report (or ADAS Maps notification) proves the link. */
export async function markConnected(req, shopName, which, note) {
  try {
    const { findShopByName } = await import('./big3.js')
    const shop = await findShopByName(req, shopName); if (!shop) return { ok: false, why: 'no shop' }
    const cur = readIntegrations(shop)[which]
    if (cur.state === 'connected') return { ok: true, already: true }
    await save(req, shop, which, { state: 'connected', connected_at: nowIso() }, 'auto', note || 'verified automatically')
    await postToCliqChannel(DISPATCH_CHANNEL, `🔗 *${shop.shop_name} is connected to ${LABEL[which]}* — ${note || 'verified automatically'}.`).catch(() => {})
    return { ok: true }
  } catch (e) { console.warn('[integrations] markConnected failed:', e.message); return { ok: false, why: e.message } }
}

// Daily 7am: pending too long → Mark's channel + Kat's bell. Business days.
const bizDaysSince = iso => { if (!iso) return 0; let d = new Date(iso), n = 0; const now = new Date(); while (d < now) { d = new Date(d.getTime() + 86400000); const wd = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short' }).format(d); if (!['Sat', 'Sun'].includes(wd)) n++ } return n }
export async function integrationNudges(req) {
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', hour12: false }).format(new Date()))
  if (hour < 7) return { fired: false }
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date())
  const seg = catalyst.initialize(req, { type: 'advancedio' }).cache().segment()
  try { if (await seg.getValue(`integration_nudges:${today}`)) return { fired: false, reason: 'already today' } } catch { /* fine */ }
  const { getAllShops } = await import('../routes/shops.js')
  const lines = []
  for (const sh of await getAllShops(req)) {
    const i = readIntegrations(sh)
    if (i.kinetic.state === 'pending' && bizDaysSince(i.kinetic.emailed_at || i.kinetic.step_done_at) >= 3) lines.push(`⏳ Kinetic · ${sh.shop_name} — emailed Parisa ${(i.kinetic.emailed_at || '').slice(0, 10)}, no report yet. Nudge her? (CRM → Billing → re-email)`)
    if (i.adasmaps.state === 'pending' && bizDaysSince(i.adasmaps.invited_at) >= 5) lines.push(`⏳ ADAS Maps · ${sh.shop_name} — steps sent ${(i.adasmaps.invited_at || '').slice(0, 10)}, nothing yet. Resend or call. (CRM → Billing)`)
    if (i.kinetic.state === 'off' && (sh.drps || []).some(d => /state farm|allstate/i.test(String(d)))) lines.push(`🏦 ${sh.shop_name} is a State Farm / Allstate shop with ADAS Maps OFF — worth setting up.`)
  }
  try { await seg.put(`integration_nudges:${today}`, '1', 48) } catch { /* fine */ }
  if (!lines.length) return { fired: true, sent: 0 }
  await postToCliqChannelById(MARK_ALERT_CHANNEL_ID, `🔗 *Shop integrations*\n${lines.slice(0, 12).join('\n')}`).catch(() => {})
  try { const { createNotification } = await import('../routes/notifications.js'); await createNotification(req, { to: 'Kath', toEmail: KAT, type: 'onboarding', title: 'Shop integrations waiting', body: lines.slice(0, 4).join(' · ').slice(0, 300), skipCliq: true, skipTechChannel: true }) } catch { /* fine */ }
  return { fired: true, sent: lines.length }
}
