// 💵 Collect (Mark 2026-09-22, single-invoice billing Phase B): after Bill
// it on a pays-on-site job, the card shows the total, a QR to the Books
// invoice page (Zoho Payments "Pay Now"), and Check / Cash buttons that
// record the payment in Books and flip the card to Paid. Techs can use it
// — they need the total to take a check — but only owners edit amounts.
// The invoice id isn't on the Jobs row; we find it by invoice_number (or
// reference = RO + customer) each time, which is also what Kat's manual
// invoices carry, so this works on those too.
import express from 'express'
import axios from 'axios'
import QRCode from 'qrcode'
import { getAccessToken } from '../services/zoho.js'
import { readJobsPublic, updateJobPublic } from './jobs.js'
import { postToCliqChannel, postToCliqChannelById, DISPATCH_CHANNEL, MARK_ALERT_CHANNEL_ID } from '../services/cliq.js'

const router = express.Router()
const API = 'https://www.zohoapis.com/books/v3'
const H = t => ({ Authorization: `Zoho-oauthtoken ${t}` })
const org = () => ({ organization_id: process.env.ZOHO_ORGANIZATION_ID })
const r2 = n => Math.round((Number(n) || 0) * 100) / 100
const todayPT = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())

async function findInvoice(token, job) {
  const number = String(job.invoice_number || '').trim()
  if (number) {
    const r = await axios.get(`${API}/invoices`, { headers: H(token), params: { ...org(), invoice_number: number }, timeout: 15000, validateStatus: s => s < 500 })
    const hit = (r.data?.invoices || []).find(i => i.invoice_number === number)
    if (hit) return hit
  }
  const ro = String(job.quote_number || job.ro_number || '').trim()
  if (ro) {
    const r = await axios.get(`${API}/invoices`, { headers: H(token), params: { ...org(), reference_number: ro }, timeout: 15000, validateStatus: s => s < 500 })
    const list = (r.data?.invoices || []).filter(i => i.reference_number === ro)
    const byShop = list.find(i => String(i.customer_name || '').toLowerCase() === String(job.shop_name || '').toLowerCase())
    if (byShop || list.length === 1) return byShop || list[0]
  }
  return null
}
const view = inv => ({ invoice_id: inv.invoice_id, invoice_number: inv.invoice_number, total: r2(inv.total), balance: r2(inv.balance), status: inv.status, paid: r2(inv.balance) <= 0 && r2(inv.total) > 0, url: inv.invoice_url || '', customer_id: inv.customer_id, customer_name: inv.customer_name })

router.get('/:id/collect', async (req, res) => {
  try {
    const job = (await readJobsPublic(req)).find(j => String(j.id) === String(req.params.id))
    if (!job) return res.status(404).json({ error: 'Job not found' })
    const token = await getAccessToken()
    const inv = await findInvoice(token, job)
    if (!inv) return res.json({ ok: true, invoice: null, why: job.invoiced ? 'Invoiced, but the invoice was not found in Books by number or RO.' : 'Not invoiced yet — Bill it first.' })
    const v = view(inv)
    let qr = ''
    if (v.url && !v.paid) { try { qr = await QRCode.toDataURL(v.url, { width: 360, margin: 1, color: { dark: '#1a1a1a', light: '#ffffff' } }) } catch { qr = '' } }
    // Books says paid (card via the QR, or Kat in Books) → close the card now instead of waiting for the sweep.
    if (v.paid && job.status !== 'complete') await markPaid(req, job, v, 'card / Books', req.user?.name || '').catch(() => {})
    res.json({ ok: true, invoice: v, qr, pay_mode: job.pay_mode || '', paid_via: job.paid_via || '' })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

async function markPaid(req, job, v, how, by) {
  await updateJobPublic(req, job.id, { ...job, status: 'complete', invoiced: true, invoice_number: v.invoice_number, invoice_status: 'paid', paid_via: how, paid_at: new Date().toISOString(),
    notes: `${job.notes ? job.notes + '\n' : ''}💵 Paid ${how}${by ? ` · ${by}` : ''} · ${v.invoice_number} $${v.total.toFixed(2)} · ${new Date().toISOString().slice(0, 16)}` })
  const line = `💵 *Paid · ${job.shop_name || v.customer_name}${job.vehicle ? ' · ' + job.vehicle : ''}* — ${v.invoice_number} $${v.total.toFixed(2)} ${how}${by ? ` (${by})` : ''}. Card → Completed.`
  await Promise.allSettled([postToCliqChannel(DISPATCH_CHANNEL, line), postToCliqChannelById(MARK_ALERT_CHANNEL_ID, line)])
}

// Check or cash at the van → a Books customer payment applied to the invoice.
router.post('/:id/collect', async (req, res) => {
  try {
    const job = (await readJobsPublic(req)).find(j => String(j.id) === String(req.params.id))
    if (!job) return res.status(404).json({ error: 'Job not found' })
    const mode = String(req.body?.mode || '').toLowerCase()
    if (!['check', 'cash', 'card'].includes(mode)) return res.status(400).json({ error: 'mode must be check, cash or card' })
    const token = await getAccessToken()
    const inv = await findInvoice(token, job)
    if (!inv) return res.status(404).json({ error: 'Invoice not found in Books — Bill it first.' })
    const v = view(inv)
    const by = req.user?.name || req.user?.email || 'tech'
    if (v.paid) { await markPaid(req, job, v, mode === 'card' ? 'by card' : mode, by); return res.json({ ok: true, invoice: v, already: true }) }
    if (mode === 'card') return res.status(409).json({ error: `Books still shows $${v.balance.toFixed(2)} due — the card payment hasn't landed yet. Give it a minute, or the customer hasn't finished on the QR.`, invoice: v })
    const isOwner = ['mark@absoluteadas.com', 'mf@absoluteadas.com', 'mfowler4456@gmail.com'].includes(String(req.user?.email || '').toLowerCase()) || req.user?.role === 'owner'
    // Techs collect the balance, exactly. Owners may take a different amount (partial / short pay).
    const amount = isOwner && Number.isFinite(Number(req.body?.amount)) && Number(req.body.amount) > 0 ? r2(req.body.amount) : v.balance
    const reference = String(req.body?.reference || '').trim().slice(0, 40)
    if (mode === 'check' && !reference) return res.status(400).json({ error: 'Check number, please — it goes on the payment in Books.' })
    const body = { customer_id: v.customer_id, payment_mode: mode === 'check' ? 'check' : 'cash', amount, date: todayPT(), reference_number: reference, description: `Collected on site by ${by} via the Absolute ADAS app`, invoices: [{ invoice_id: v.invoice_id, amount_applied: amount }] }
    const c = await axios.post(`${API}/customerpayments`, body, { headers: H(token), params: org(), timeout: 20000, validateStatus: s => s < 500 })
    if (c.data?.code !== 0) throw new Error(`Books refused the payment: ${c.data?.message || c.status}`)
    const after = await findInvoice(token, job)
    const v2 = after ? view(after) : { ...v, balance: r2(v.balance - amount), paid: r2(v.balance - amount) <= 0 }
    if (v2.paid) await markPaid(req, job, v2, mode === 'check' ? `by check #${reference}` : 'in cash', by)
    else await updateJobPublic(req, job.id, { ...job, notes: `${job.notes ? job.notes + '\n' : ''}💵 Partial ${mode} $${amount.toFixed(2)}${reference ? ` #${reference}` : ''} by ${by} · $${v2.balance.toFixed(2)} still due` })
    console.log(`[collect] ${job.shop_name} ${v.invoice_number}: ${mode} $${amount} by ${by} → balance $${v2.balance}`)
    res.json({ ok: true, invoice: v2, payment_id: c.data?.payment?.payment_id || null })
  } catch (e) { console.error('[collect]', e.message); res.status(500).json({ error: e.message }) }
})

/** Hourly: on-site cards billed but not closed — if Books shows them paid (QR / card), close them. */
export async function sweepCollect(req) {
  const jobs = (await readJobsPublic(req)).filter(j => j.invoiced && j.status === 'ready_invoice' && j.invoice_number)
  if (!jobs.length) return { checked: 0, closed: 0 }
  const token = await getAccessToken()
  let closed = 0
  for (const job of jobs) {
    try { const inv = await findInvoice(token, job); if (inv) { const v = view(inv); if (v.paid) { await markPaid(req, job, v, 'by card / Books', ''); closed++ } } } catch (e) { console.log('[collect sweep]', job.id, e.message) }
  }
  return { checked: jobs.length, closed }
}

export default router
