// Absolute ADAS Books (AR) — staff routes + the nightly cron entry.
import express from 'express'
import catalyst from 'zcatalyst-sdk-node'
import { importPlan, syncAccounts, syncCreditNotes, syncAllocations, reconcile, lastReconcile, runs, maybeNightlyAr, postDrift, rowToAccount } from '../services/ar.js'
import { syncMonths, readMeta, readAll } from '../services/zohoMirror.js'

const router = express.Router()
const who = req => req.user?.name || req.user?.email || 'staff'
const fail = (res, e, w) => { console.log(`[ar] ${w}:`, e.message); res.status(500).json({ error: e.message }) }
const q = s => String(s ?? '').replace(/'/g, "''")
const app = req => catalyst.initialize(req, { type: 'advancedio' })
async function zcqlAll(a, table, sql) { const out = []; for (let off = 0; ; off += 300) { const rows = await a.zcql().executeZCQLQuery(`${sql} LIMIT ${off}, 300`); const b = (rows || []).map(r => r?.[table] || r).filter(Boolean); out.push(...b); if (b.length < 300) break } return out }

router.get('/status', async (req, res) => {
  try {
    const a = app(req)
    const [meta, last, accs, al, cn] = await Promise.all([readMeta(req), lastReconcile(req), a.zcql().executeZCQLQuery(`SELECT COUNT(ROWID) FROM ArAccounts`).catch(() => []), a.zcql().executeZCQLQuery(`SELECT COUNT(ROWID) FROM ArAllocations`).catch(() => []), a.zcql().executeZCQLQuery(`SELECT COUNT(ROWID) FROM ArCreditNotes`).catch(() => [])])
    const cnt = r => { const f = r?.[0]; const v = f ? Object.values(f)[0] : 0; return Number(v && typeof v === 'object' ? Object.values(v)[0] : v) || 0 }
    res.json({ ok: true, mirror: meta, last_reconcile: last, accounts: cnt(accs), allocations: cnt(al), credit_notes: cnt(cn) })
  } catch (e) { fail(res, e, 'status') }
})
router.get('/import/plan', async (req, res) => { try { res.json({ ok: true, ...(await importPlan(req)) }) } catch (e) { fail(res, e, 'plan') } })
// Preview = zero writes. Run = Mark confirmed in the UI. Two months per call keeps us under the 30s gateway.
router.post('/import/preview', async (req, res) => { try { const months = (req.body?.months || []).slice(0, 3); res.json({ ok: true, ...(await syncMonths(req, months, { dryRun: true })) }) } catch (e) { fail(res, e, 'preview') } })
router.post('/import/run', async (req, res) => { try { const months = (req.body?.months || []).slice(0, 3); if (!months.length) return res.status(400).json({ error: 'months required' }); res.json({ ok: true, ...(await syncMonths(req, months)) }) } catch (e) { fail(res, e, 'import') } })
router.post('/sync/accounts', async (req, res) => { try { res.json(await syncAccounts(req, who(req))) } catch (e) { fail(res, e, 'accounts') } })
router.post('/sync/credit-notes', async (req, res) => { try { const months = (req.body?.months || []).slice(0, 4); res.json(await syncCreditNotes(req, months, who(req))) } catch (e) { fail(res, e, 'credit notes') } })
router.post('/sync/allocations', async (req, res) => { try { res.json(await syncAllocations(req, { limit: Math.min(Number(req.body?.limit) || 40, 60), by: who(req) })) } catch (e) { fail(res, e, 'allocations') } })
router.post('/reconcile', async (req, res) => { try { const s = await reconcile(req, who(req)); if (req.body?.post) await postDrift(req, s, who(req)); res.json(s) } catch (e) { fail(res, e, 'reconcile') } })
router.get('/runs', async (req, res) => { try { res.json({ ok: true, runs: await runs(req, 40) }) } catch (e) { fail(res, e, 'runs') } })
router.get('/accounts', async (req, res) => {
  try {
    const rows = (await zcqlAll(app(req), 'ArAccounts', `SELECT * FROM ArAccounts`)).map(rowToAccount)
    rows.sort((x, y) => Math.abs(y.drift_cents) - Math.abs(x.drift_cents) || y.app_balance_cents - x.app_balance_cents || x.name.localeCompare(y.name))
    res.json({ ok: true, accounts: rows })
  } catch (e) { fail(res, e, 'accounts list') }
})
router.get('/accounts/:contactId', async (req, res) => {
  try {
    const a = app(req); const id = q(req.params.contactId)
    const [accRows, invs, pays, allocs, cns] = await Promise.all([
      a.zcql().executeZCQLQuery(`SELECT * FROM ArAccounts WHERE ac_contact_id = '${id}' LIMIT 1`),
      zcqlAll(a, 'AdasInvoices', `SELECT * FROM AdasInvoices WHERE customer_id = '${id}' ORDER BY inv_date DESC`),
      zcqlAll(a, 'AdasPayments', `SELECT * FROM AdasPayments WHERE customer_id = '${id}' ORDER BY pay_date DESC`),
      zcqlAll(a, 'ArAllocations', `SELECT * FROM ArAllocations WHERE al_customer_id = '${id}'`),
      zcqlAll(a, 'ArCreditNotes', `SELECT * FROM ArCreditNotes WHERE cn_customer_id = '${id}' ORDER BY cn_date DESC`),
    ])
    const accRow = accRows?.[0]?.ArAccounts || accRows?.[0]
    if (!accRow) return res.status(404).json({ error: 'Account not found in the mirror yet' })
    const byInv = {}; for (const x of allocs) if (x.al_kind !== 'unapplied') byInv[String(x.al_invoice_id)] = (byInv[String(x.al_invoice_id)] || 0) + (Number(x.al_amount_cents) || 0)
    res.json({ ok: true, account: rowToAccount(accRow),
      invoices: invs.map(r => ({ invoice_id: String(r.zoho_invoice_id), number: r.invoice_number, date: r.inv_date, due_date: r.inv_due_date, status: r.inv_status, total_cents: Math.round(Number(r.inv_total) * 100), balance_cents: Math.round(Number(r.inv_balance) * 100), applied_cents: byInv[String(r.zoho_invoice_id)] || 0, reference: r.reference_number, last_payment: r.last_payment_date })),
      payments: pays.map(r => ({ payment_id: String(r.zoho_payment_id), number: r.payment_number, date: r.pay_date, amount_cents: Math.round(Number(r.pay_amount) * 100), mode: r.payment_mode, reference: r.reference_number, invoices: r.invoice_numbers, allocated: allocs.some(x => String(x.al_payment_id) === String(r.zoho_payment_id)) })),
      credit_notes: cns.map(r => ({ id: String(r.cn_creditnote_id), number: r.cn_number, date: r.cn_date, status: r.cn_status, total_cents: Number(r.cn_total_cents) || 0, balance_cents: Number(r.cn_balance_cents) || 0 })),
      unapplied: allocs.filter(x => x.al_kind === 'unapplied').map(x => ({ payment_id: String(x.al_payment_id), amount_cents: Number(x.al_amount_cents) || 0, date: x.al_applied_date })),
    })
  } catch (e) { fail(res, e, 'account') }
})
router.get('/invoices', async (req, res) => {
  try {
    const needle = String(req.query.q || '').trim().toLowerCase()
    const all = await readAll(req, 'inv')
    const list = (needle ? all.filter(i => `${i.invoice_number} ${i.customer_name} ${i.reference_number}`.toLowerCase().includes(needle)) : all).sort((x, y) => (y.date || '').localeCompare(x.date || '')).slice(0, 300)
    res.json({ ok: true, invoices: list })
  } catch (e) { fail(res, e, 'invoices') }
})
export default router

// Cron entry (x-cron-secret): nightly AR sync + reconcile + drift post
export const arCronRouter = express.Router()
arCronRouter.get('/nightly', async (req, res) => {
  const secret = String(process.env.BRIEFING_CRON_SECRET || process.env.MORNING_CRON_SECRET || 'morning-2026').trim()
  const got = String(req.headers['x-cron-secret'] || req.query.secret || '').trim()
  if (got !== secret) return res.status(401).json({ error: 'bad secret' })
  try { res.json({ ok: true, ...(await maybeNightlyAr(req)) }) } catch (e) { fail(res, e, 'nightly') }
})
