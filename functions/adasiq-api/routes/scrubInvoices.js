// 🧾 Scrub invoices: storage, Stripe charges, month close + failed-card steps
// (Mark 2026-11-04, phase 3). Rules: services/scrubInvoice.js.
//
// One DurableKV doc per month, `scrub_invoices_YYYY-MM`:
//   { month, started_at, built_at, by, invoices: [...] }
// started_at is the send lock (feedback: every pipeline that touches customers
// gets one): a second close within 10 minutes of the first does nothing, and
// an invoice that already exists is never rebuilt.
//
// Charging: Stripe PaymentIntent off-session on the card the shop saved in the
// portal, with idempotency key iq-<invoice>-<try>. Stripe emails the receipt
// from ADAS IQ's Stripe account. Auto-charge is OFF until Mark turns it on;
// until then the 1st builds drafts and Mark presses Charge.
import catalyst from 'zcatalyst-sdk-node'
import { kvGet, kvSet } from '../services/durableKV.js'
import { buildInvoice, dunningStep, prevMonth, closeWindow, reminderText } from '../services/scrubInvoice.js'
import { readConfig, writeConfig, monthRows } from './scrubBilling.js'

const DOC = m => `scrub_invoices_${m}`
const monthOfNumber = n => { const m = String(n || '').match(/^IQ-(\d{4})(\d{2})-\d+$/); return m ? `${m[1]}-${m[2]}` : '' }
const addMonths = (m, k) => { const [y, mo] = m.split('-').map(Number); const d = new Date(y, mo - 1 + k, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }

export async function readDoc(req, month) {
  try { const v = await kvGet(catalyst.initialize(req), DOC(month)); return v ? JSON.parse(v) : { month, invoices: [] } } catch { return { month, invoices: [] } }
}
const writeDoc = (req, d) => kvSet(catalyst.initialize(req), DOC(d.month), JSON.stringify(d))

async function alertMark(text) {
  try { const { postToCliqChannelById, MARK_ALERT_CHANNEL_ID } = await import('../services/cliq.js'); await postToCliqChannelById(MARK_ALERT_CHANNEL_ID, text) } catch (e) { console.warn('[iq invoices] alert', e.message) }
}

/** Build last month's (or `month`'s) invoices. Never rebuilds one that exists. */
export async function closeMonth(req, month, { by = 'auto' } = {}) {
  const doc = await readDoc(req, month)
  if (doc.started_at && !doc.built_at && Date.now() - new Date(doc.started_at).getTime() < 10 * 60000) return { skipped: 'another close is running', doc }
  doc.started_at = new Date().toISOString(); doc.by = by
  await writeDoc(req, doc)
  const [cfg, rows] = await Promise.all([readConfig(req), monthRows(req, month)])
  let seq = doc.invoices.length, made = 0
  const byAcct = new Map()
  for (const r of rows) { if (!byAcct.has(r.account_id)) byAcct.set(r.account_id, []); byAcct.get(r.account_id).push(r) }
  for (const [id, list] of byAcct) {
    const a = cfg.accounts.find(x => x.id === id)
    if (!a || doc.invoices.find(i => i.account_id === id)) continue
    const inv = buildInvoice(a, list, { month, seq: seq + 1 })
    if (inv) { doc.invoices.push(inv); seq++; made++ }
  }
  doc.built_at = new Date().toISOString()
  await writeDoc(req, doc)
  const total = doc.invoices.filter(i => i.status === 'draft').reduce((t, i) => t + i.total, 0)
  console.log(`[iq invoices] ${month} closed by ${by}: ${made} new, ${doc.invoices.length} total`)
  let charged = null
  if (made && cfg.billing?.auto_charge) charged = await chargeAll(req, month)
  if (made) await alertMark(`🧾 *ADAS IQ invoices for ${month}* · ${made} account${made === 1 ? '' : 's'} · $${total.toFixed(2)}\n${charged ? `Charged: ${charged.paid} paid, ${charged.failed} failed.` : 'Drafts ready. Press Charge on More → Admin → 💳 Scrub Billing (auto-charge is off).'}`)
  return { made, doc, charged }
}

/** Charge one invoice on the account's saved card. Saves after every outcome. */
export async function chargeInvoice(req, number, { by = 'auto' } = {}) {
  const month = monthOfNumber(number)
  const doc = await readDoc(req, month)
  const inv = doc.invoices.find(i => i.number === number)
  if (!inv) return { error: 'No such invoice' }
  // 'charging' that's been sitting 10+ min = the instance died mid-charge. Same try → same
  // idempotency key, so Stripe hands back the first result instead of charging again.
  const stuck = inv.status === 'charging' && Date.now() - new Date(inv.charging_at || 0).getTime() > 10 * 60000
  if (['paid', 'paid_manual', 'void'].includes(inv.status) || (inv.status === 'charging' && !stuck)) return { skipped: inv.status, inv }
  const cfg = await readConfig(req)
  const a = cfg.accounts.find(x => x.id === inv.account_id)
  const now = new Date().toISOString()
  const fail = async why => {
    Object.assign(inv, { status: 'failed', fail_reason: why, last_try_at: now, tries: (inv.tries || 0) + 1, first_failed_at: inv.first_failed_at || now })
    await writeDoc(req, doc)
    return { ok: false, inv }
  }
  if (!a?.card?.pm || !a.stripe_customer) return fail('no card on file')
  const { stripeFor } = await import('./scrubPortal.js')
  const stripe = await stripeFor(req)
  if (!stripe) return { error: 'ADAS IQ Stripe key is not set' }
  inv.status = 'charging'; inv.charging_at = new Date().toISOString(); await writeDoc(req, doc)
  try {
    const pi = await stripe.paymentIntents.create({
      amount: Math.round(inv.total * 100), currency: 'usd', customer: a.stripe_customer, payment_method: a.card.pm,
      off_session: true, confirm: true, receipt_email: a.email || undefined,
      description: `ADAS IQ ${inv.number}: ${inv.vins} VINs scrubbed in ${inv.month}`,
      metadata: { iq_invoice: inv.number, iq_account: a.id },
    }, { idempotencyKey: `iq-${inv.number}-${(inv.tries || 0) + 1}` })
    if (pi.status !== 'succeeded') return fail(`payment ${pi.status}`)
    Object.assign(inv, { status: 'paid', paid_at: new Date().toISOString(), payment_intent: pi.id, charged_by: by, tries: (inv.tries || 0) + 1 })
    await writeDoc(req, doc)
    await clearPastDue(req, a.id)
    return { ok: true, inv }
  } catch (e) {
    return fail(String(e?.raw?.message || e.message || 'card declined').slice(0, 200))
  }
}

export async function chargeAll(req, month, { by = 'auto' } = {}) {
  const doc = await readDoc(req, month)
  const out = { paid: 0, failed: 0, skipped: 0 }
  for (const inv of doc.invoices.filter(i => i.status === 'draft')) {
    const r = await chargeInvoice(req, inv.number, { by })
    if (r.ok) out.paid++; else if (r.inv?.status === 'failed') out.failed++; else out.skipped++
  }
  return out
}

// An account goes back to active once nothing it owes is failed.
async function clearPastDue(req, accountId) {
  const cfg = await readConfig(req)
  const a = cfg.accounts.find(x => x.id === accountId)
  if (a?.status !== 'past_due') return
  const now = prevMonth(new Date(Date.now() + 40 * 86400000))   // this month
  for (let k = 0; k < 4; k++) { const d = await readDoc(req, addMonths(now, -k)); if (d.invoices.some(i => i.account_id === accountId && i.status === 'failed')) return }
  a.status = 'active'; a.past_due_at = null
  await writeConfig(req, cfg)
  await alertMark(`✅ *ADAS IQ* · ${a.name} is paid up. Scrubbing is back on.`)
}

export async function markPaid(req, number, by) {
  const doc = await readDoc(req, monthOfNumber(number))
  const inv = doc.invoices.find(i => i.number === number)
  if (!inv) return { error: 'No such invoice' }
  Object.assign(inv, { status: 'paid_manual', paid_at: new Date().toISOString(), charged_by: by })
  await writeDoc(req, doc); await clearPastDue(req, inv.account_id)
  return { ok: true, inv }
}
export async function voidInvoice(req, number, by) {
  const doc = await readDoc(req, monthOfNumber(number))
  const inv = doc.invoices.find(i => i.number === number)
  if (!inv) return { error: 'No such invoice' }
  if (['paid', 'charging'].includes(inv.status)) return { error: 'A paid invoice is refunded in Stripe, not voided here' }
  Object.assign(inv, { status: 'void', voided_by: by, voided_at: new Date().toISOString() })
  await writeDoc(req, doc); await clearPastDue(req, inv.account_id)
  return { ok: true, inv }
}

/** Hourly: close last month in the window, then work the failed cards. */
export async function billingTick(req) {
  const out = { close: null, retried: 0, past_due: 0 }
  const last = prevMonth()
  if (closeWindow()) {
    const d = await readDoc(req, last)
    if (!d.built_at) out.close = (await closeMonth(req, last, { by: 'auto' })).made ?? 'skipped'
  }
  const cfg = await readConfig(req)
  for (let k = 0; k < 3; k++) {
    const month = addMonths(last, -k)
    const doc = await readDoc(req, month)
    for (const inv of doc.invoices) {
      const step = dunningStep(inv)
      if (step === 'retry' && cfg.billing?.auto_charge) { await chargeInvoice(req, inv.number); out.retried++ }
      if (step === 'past_due') {
        const fresh = await readDoc(req, month); const i = fresh.invoices.find(x => x.number === inv.number)
        i.past_due_at = new Date().toISOString(); await writeDoc(req, fresh)
        const c = await readConfig(req); const a = c.accounts.find(x => x.id === inv.account_id)
        if (a && a.status !== 'past_due') { a.status = 'past_due'; a.past_due_at = i.past_due_at; await writeConfig(req, c) }
        out.past_due++
        await alertMark(`⛔ *ADAS IQ past due* · ${inv.account_name} · ${inv.number} $${inv.total.toFixed(2)}. New estimates are held until it's paid.\n\nReminder to send them (your words first):\n${reminderText(i)}`)
      }
    }
  }
  return out
}
