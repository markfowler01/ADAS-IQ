// 🧾 Scrub invoices: storage, month close, ADAS IQ's Zoho Books, payment
// tracking + past due (Mark 2026-11-04, phase 3). Rules: services/scrubInvoice.js.
//
// Mark picked Zoho for everything (Books org 945498731 + Zoho Payments), so
// Stripe is gone. The flow:
//   1st (PT, after 2 AM) → build one invoice per paying account from the ledger
//   → create the customer + invoice in ADAS IQ's Books (same IQ-YYYYMM-### number),
//     marked sent, no email (customer templates wait for Mark's OK)
//   → the hourly tick reads Books: paid there (Zoho Payments link, check, ACH) = paid here
//   → still unpaid 30 days after the invoice date → past due → new estimates held.
// Automatic card charging plugs in at chargeInvoice() once Zoho confirms Zoho
// Payments can charge a saved card on these invoices.
//
// One DurableKV doc per month, `scrub_invoices_YYYY-MM`:
//   { month, started_at, built_at, by, invoices: [...] }
// started_at is the send lock: a second close within 10 minutes does nothing,
// an invoice that exists is never rebuilt, and Books is checked by number
// before creating, so a retry can't make a second Books invoice.
import catalyst from 'zcatalyst-sdk-node'
import { kvGet, kvSet } from '../services/durableKV.js'
import { buildInvoice, prevMonth, closeWindow, reminderText } from '../services/scrubInvoice.js'
import { readConfig, writeConfig, monthRows } from './scrubBilling.js'

export const UNPAID_PAST_DUE_DAYS = 30
const DOC = m => `scrub_invoices_${m}`
const monthOfNumber = n => { const m = String(n || '').match(/^IQ-(\d{4})(\d{2})-\d+$/); return m ? `${m[1]}-${m[2]}` : '' }
const addMonths = (m, k) => { const [y, mo] = m.split('-').map(Number); const d = new Date(y, mo - 1 + k, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }
const invoiceDate = month => { const [y, m] = month.split('-').map(Number); return new Date(Date.UTC(y, m, 1)) }
const OPEN = ['sent', 'failed']

export async function readDoc(req, month) {
  try { const v = await kvGet(catalyst.initialize(req), DOC(month)); return v ? JSON.parse(v) : { month, invoices: [] } } catch { return { month, invoices: [] } }
}
const writeDoc = (req, d) => kvSet(catalyst.initialize(req), DOC(d.month), JSON.stringify(d))

async function alertMark(text) {
  try { const { postToCliqChannelById, MARK_ALERT_CHANNEL_ID } = await import('../services/cliq.js'); await postToCliqChannelById(MARK_ALERT_CHANNEL_ID, text) } catch (e) { console.warn('[iq invoices] alert', e.message) }
}

/** Build `month`'s invoices, then put them in Books. Never rebuilds one that exists. */
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
  console.log(`[iq invoices] ${month} closed by ${by}: ${made} new, ${doc.invoices.length} total`)
  const pushed = made ? await pushAll(req, month) : { pushed: 0, failed: 0 }
  if (made) {
    const total = doc.invoices.reduce((t, i) => t + (i.status === 'void' ? 0 : i.total), 0)
    await alertMark(`🧾 *ADAS IQ invoices for ${month}* · ${made} account${made === 1 ? '' : 's'} · $${total.toFixed(2)}\n📒 ${pushed.pushed} in ADAS IQ's Zoho Books${pushed.failed ? ` · ⚠️ ${pushed.failed} didn't go in (the hourly check retries)` : ''}.`)
  }
  return { made, doc, pushed }
}

/** Every invoice of the month that isn't in Books yet → Books. Saves after each. */
export async function pushAll(req, month) {
  const B = await import('../services/iqBooks.js')
  const out = { pushed: 0, failed: 0 }
  const doc = await readDoc(req, month)
  const todo = doc.invoices.filter(i => !i.books_invoice_id && i.status !== 'void')
  if (!todo.length) return out
  const cfg = await readConfig(req)
  cfg.iq_books = cfg.iq_books || {}
  const which = cfg.iq_books.org === 'absolute' ? 'absolute' : 'iq'   // Mark 2026-11-04: ADAS IQ's Books, paid through Absolute ADAS's Zoho Payments for now
  cfg.iq_books.items = cfg.iq_books.items || {}
  let cfgDirty = false
  try { const id = await B.ensureItem(which, cfg.iq_books.items[which]); if (id !== cfg.iq_books.items[which]) { cfg.iq_books.items[which] = id; cfgDirty = true } } catch (e) { console.warn('[iq books] item', B.booksError(e)); return { ...out, failed: todo.length } }
  for (const inv of todo) {
    try {
      const a = cfg.accounts.find(x => x.id === inv.account_id)
      if (!a) throw new Error('account is gone')
      const contactId = await B.ensureContact(which, a)
      if (a.books_contacts?.[which] !== contactId) { a.books_contacts = { ...(a.books_contacts || {}), [which]: contactId }; cfgDirty = true }
      const r = await B.pushInvoice(which, inv, { contactId, itemId: cfg.iq_books.items[which] })
      Object.assign(inv, { books_org: which, books_invoice_id: r.invoice_id, books_url: r.invoice_url, books_error: '', status: inv.status === 'draft' ? 'sent' : inv.status, sent_at: inv.sent_at || new Date().toISOString() })
      out.pushed++
    } catch (e) {
      inv.books_error = B.booksError(e).slice(0, 200); out.failed++
      console.warn(`[iq books] ${inv.number}: ${inv.books_error}`)
    }
    await writeDoc(req, doc)
  }
  if (cfgDirty) await writeConfig(req, cfg)
  return out
}

/**
 * Charge the card on file. Waits on Zoho Payments: until Zoho confirms the app
 * can charge a saved card on these invoices, shops pay from the Books invoice
 * (Zoho Payments' Pay now) and the hourly check marks them paid.
 */
export async function chargeInvoice() {
  return { error: 'Card charging turns on once Zoho Payments is set up for ADAS IQ. Until then shops pay from the Books invoice and it shows paid here by itself.' }
}

// An account goes back to active once nothing it owes is overdue or failed.
async function clearPastDue(req, accountId) {
  const cfg = await readConfig(req)
  const a = cfg.accounts.find(x => x.id === accountId)
  if (a?.status !== 'past_due') return
  const last = prevMonth()
  for (let k = -1; k < 4; k++) { const d = await readDoc(req, addMonths(last, -k)); if (d.invoices.some(i => i.account_id === accountId && i.past_due_at && OPEN.includes(i.status))) return }
  a.status = 'active'; a.past_due_at = null
  await writeConfig(req, cfg)
  await alertMark(`✅ *ADAS IQ* · ${a.name} is paid up. Scrubbing is back on.`)
}

async function findInvoice(req, number) {
  const doc = await readDoc(req, monthOfNumber(number))
  return { doc, inv: doc.invoices.find(i => i.number === number) }
}

/** "Paid other way" (check / ACH) → paid here + a payment in Books. */
export async function markPaid(req, number, by, { mode = 'check', reference = '' } = {}) {
  const { doc, inv } = await findInvoice(req, number)
  if (!inv) return { error: 'No such invoice' }
  if (inv.books_invoice_id) {
    try {
      const B = await import('../services/iqBooks.js')
      const cfg = await readConfig(req); const a = cfg.accounts.find(x => x.id === inv.account_id)
      await B.recordPayment(inv, { contactId: a?.books_contacts?.[inv.books_org || 'absolute'], mode, reference })
    } catch (e) { const B = await import('../services/iqBooks.js'); return { error: `Books didn't take the payment: ${B.booksError(e)}` } }
  }
  Object.assign(inv, { status: 'paid_manual', paid_at: new Date().toISOString(), charged_by: by })
  await writeDoc(req, doc); await clearPastDue(req, inv.account_id)
  return { ok: true, inv }
}
export async function voidInvoice(req, number, by) {
  const { doc, inv } = await findInvoice(req, number)
  if (!inv) return { error: 'No such invoice' }
  if (['paid', 'paid_manual'].includes(inv.status)) return { error: 'A paid invoice gets a refund or credit note in Books, not a void' }
  try { const B = await import('../services/iqBooks.js'); await B.voidInBooks(inv) } catch (e) { const B = await import('../services/iqBooks.js'); return { error: `Books didn't void it: ${B.booksError(e)}` } }
  Object.assign(inv, { status: 'void', voided_by: by, voided_at: new Date().toISOString() })
  await writeDoc(req, doc); await clearPastDue(req, inv.account_id)
  return { ok: true, inv }
}

/** Hourly: close last month in the window, retry Books, pick up payments, past due. */
export async function billingTick(req) {
  const out = { close: null, pushed: 0, paid: 0, past_due: 0 }
  const last = prevMonth()
  if (closeWindow()) {
    const d = await readDoc(req, last)
    if (!d.built_at) out.close = (await closeMonth(req, last, { by: 'auto' })).made ?? 'skipped'
  }
  const B = await import('../services/iqBooks.js')
  for (let k = 0; k < 4; k++) {
    const month = addMonths(last, -k)
    out.pushed += (await pushAll(req, month)).pushed
    const doc = await readDoc(req, month)
    let dirty = false
    for (const inv of doc.invoices.filter(i => OPEN.includes(i.status) && i.books_invoice_id)) {
      let st = null
      try { st = await B.booksStatus(inv) } catch (e) { console.warn(`[iq books] status ${inv.number}`, B.booksError(e)) }
      if (st === 'paid') { Object.assign(inv, { status: 'paid', paid_at: new Date().toISOString(), charged_by: 'books' }); dirty = true; out.paid++; await writeDoc(req, doc); await clearPastDue(req, inv.account_id); continue }
      if (st === 'void') { Object.assign(inv, { status: 'void', voided_at: new Date().toISOString(), voided_by: 'books' }); dirty = true; continue }
      const days = (Date.now() - invoiceDate(inv.month).getTime()) / 86400000
      if (!inv.past_due_at && days >= UNPAID_PAST_DUE_DAYS) {
        inv.past_due_at = new Date().toISOString(); dirty = true; out.past_due++
        const c = await readConfig(req); const a = c.accounts.find(x => x.id === inv.account_id)
        if (a && a.status !== 'past_due') { a.status = 'past_due'; a.past_due_at = inv.past_due_at; await writeConfig(req, c) }
        await alertMark(`⛔ *ADAS IQ past due* · ${inv.account_name} · ${inv.number} $${inv.total.toFixed(2)} unpaid ${UNPAID_PAST_DUE_DAYS} days. New estimates are held until it's paid.\n\nReminder to send them (your words first):\n${reminderText(inv)}`)
      }
    }
    if (dirty) await writeDoc(req, doc)
  }
  return out
}
