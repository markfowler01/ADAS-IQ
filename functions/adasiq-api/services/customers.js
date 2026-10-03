// ⭐ Customers view (Mark 2026-10-03: customers out of the pipeline into their own
// view — keep and grow them). One row per current customer (stage active / active2):
// last invoice, this month vs their usual pace, open AR, setup gaps, upsell ideas.
// Activity comes from the in-app Books invoice mirror (AdasInvoices), matched by the
// shop's Books customer id first, then by name.
import catalyst from 'zcatalyst-sdk-node'

export const CUSTOMER_STAGES = ['active', 'active2']
export const WIN_BACK_DAYS = 60
const r2 = n => Math.round((Number(n) || 0) * 100) / 100
const ymOf = d => String(d || '').slice(0, 7)
const loose = n => String(n || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]/g, ' ').replace(/\b(the|auto|automotive|body|bodyshop|shop|collision|repair|repairs|center|centre|rebuild|inc|llc|co|company|and|of)\b/g, ' ').replace(/\s+/g, ' ').trim()

async function invoicesSince(req, since) {
  const z = catalyst.initialize(req, { type: 'advancedio' }).zcql()
  const out = [], seen = new Set()
  for (let off = 0; off < 20000; off += 300) {
    const rows = await z.executeZCQLQuery(`SELECT ROWID, customer_id, customer_name, inv_date, inv_due_date, inv_total, inv_balance, inv_status FROM AdasInvoices WHERE inv_date >= '${since}' ORDER BY ROWID LIMIT ${off}, 300`)
    const b = (rows || []).map(r => r.AdasInvoices || r)
    for (const x of b) { const id = String(x.ROWID); if (seen.has(id)) continue; seen.add(id); out.push(x) }
    if (b.length < 300) break
  }
  return out.filter(i => !/void|draft/i.test(String(i.inv_status || '')))
}

export async function customerReport(req) {
  const { getAllShops } = await import('../routes/shops.js')
  const b3 = await import('./big3.js')
  const shops = (await getAllShops(req)).filter(s => CUSTOMER_STAGES.includes(s.pipeline_stage))
  const now = new Date(), today = now.toISOString().slice(0, 10)
  const since = new Date(now.getFullYear(), now.getMonth() - 12, 1).toISOString().slice(0, 10)
  let inv = []
  try { inv = await invoicesSince(req, since) } catch (e) { console.warn('[customers] invoices:', e.message) }
  const byId = new Map(), byName = new Map()
  for (const i of inv) {
    if (i.customer_id) byId.set(String(i.customer_id), [...(byId.get(String(i.customer_id)) || []), i])
    const k = loose(i.customer_name); if (k) byName.set(k, [...(byName.get(k) || []), i])
  }
  const thisYm = today.slice(0, 7)
  const prevYms = [1, 2, 3].map(n => { const d = new Date(now.getFullYear(), now.getMonth() - n, 1); return d.toISOString().slice(0, 7) })
  const day = now.getDate(), daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  const rows = shops.map(s => {
    let br = s.billing_rules || {}; if (typeof br === 'string') { try { br = JSON.parse(br) } catch { br = {} } }
    const mine = (s.zoho_contact_id && byId.get(String(s.zoho_contact_id))) || byName.get(loose(s.shop_name)) || []
    const dates = mine.map(i => String(i.inv_date || '')).filter(Boolean).sort()
    const last = dates[dates.length - 1] || ''
    const daysSince = last ? Math.floor((now - new Date(last)) / 86400000) : null
    const inMonth = ym => mine.filter(i => ymOf(i.inv_date) === ym)
    const thisCount = inMonth(thisYm).length, thisAmt = r2(inMonth(thisYm).reduce((t, i) => t + Number(i.inv_total || 0), 0))
    const avgCount = r2(prevYms.reduce((t, ym) => t + inMonth(ym).length, 0) / 3)
    const avgAmt = r2(prevYms.reduce((t, ym) => t + inMonth(ym).reduce((x, i) => x + Number(i.inv_total || 0), 0), 0) / 3)
    const pace = day >= 5 && avgCount >= 2 ? r2((thisCount / day) * daysInMonth / avgCount) : null   // 1 = on their usual pace
    // Last 6 months, oldest first — the little bar chart on the card.
    const series = [5, 4, 3, 2, 1, 0].map(n => { const d = new Date(now.getFullYear(), now.getMonth() - n, 1); const ym = d.toISOString().slice(0, 7); const m = inMonth(ym); return { ym, count: m.length, amount: r2(m.reduce((t, i) => t + Number(i.inv_total || 0), 0)) } })
    const open = mine.filter(i => Number(i.inv_balance) > 0)
    const overdue = open.filter(i => i.inv_due_date && i.inv_due_date < today)
    const oldestDue = overdue.map(i => i.inv_due_date).sort()[0] || ''
    const rules = b3.normalizeRules(br.big3)
    const collision = !b3.NON_COLLISION.has(br.customer_type)
    const setup = [
      !br.customer_type && 'customer type',
      collision && !(rules && b3.BIG3.every(b => rules[b.key])) && 'Big 4 rule',
      collision && br.discount_value == null && 'discount',
      !s.zoho_contact_id && 'Books link',
    ].filter(Boolean)
    const upsell = [
      collision && br.full_service_on !== true && 'Full Service is OFF — pitch it',
      collision && rules && rules.pre_scan === 'off' && 'No pre-scans — offer them',
    ].filter(Boolean)
    const flags = []
    if (daysSince != null && daysSince > WIN_BACK_DAYS) flags.push('win_back')
    else if (pace != null && pace < 0.6) flags.push('slipping')
    if (!mine.length) flags.push('no_invoices')
    if (overdue.length) flags.push('overdue')
    return {
      id: s.id, name: s.shop_name, stage: s.pipeline_stage, type: br.customer_type || '', phone: s.phone || '', address: s.address || '',
      people: (s.people || []).slice(0, 3).map(p => ({ name: p.name || '', title: p.title || '', phone: p.phone || '', email: p.email || '' })),
      last_invoice: last, days_since: daysSince, this_month: { count: thisCount, amount: thisAmt }, usual: { count: avgCount, amount: avgAmt }, pace,
      ar: { open: r2(open.reduce((t, i) => t + Number(i.inv_balance || 0), 0)), overdue: r2(overdue.reduce((t, i) => t + Number(i.inv_balance || 0), 0)), oldest_due: oldestDue, count: open.length },
      year: { count: mine.length, amount: r2(mine.reduce((t, i) => t + Number(i.inv_total || 0), 0)) },
      series, setup, upsell, flags, books_linked: !!s.zoho_contact_id,
    }
  })
  const rank = r => (r.flags.includes('win_back') ? 0 : r.flags.includes('slipping') ? 1 : r.flags.includes('overdue') ? 2 : 3)
  rows.sort((a, b) => rank(a) - rank(b) || (b.year.amount - a.year.amount))
  return { as_of: today, win_back_days: WIN_BACK_DAYS, invoices_read: inv.length, customers: rows }
}

// Why does a customer's card say what it says? One shop's match trail + a sample of
// the newest mirror rows, so a wrong number can be traced in one call.
export async function debugCustomer(req, name) {
  const { getAllShops } = await import('../routes/shops.js')
  const shop = (await getAllShops(req)).find(s => String(s.shop_name).toLowerCase().includes(name.toLowerCase()))
  const now = new Date(); const since = new Date(now.getFullYear(), now.getMonth() - 12, 1).toISOString().slice(0, 10)
  const inv = await invoicesSince(req, since)
  const newest = [...inv].sort((a, b) => String(b.inv_date).localeCompare(String(a.inv_date))).slice(0, 8).map(i => ({ date: i.inv_date, customer_id: i.customer_id, name: i.customer_name, status: i.inv_status, total: i.inv_total }))
  if (!shop) return { found: false, invoices_read: inv.length, newest }
  const byId = inv.filter(i => String(i.customer_id) === String(shop.zoho_contact_id || '-'))
  const byNm = inv.filter(i => loose(i.customer_name) === loose(shop.shop_name))
  const show = l => [...l].sort((a, b) => String(b.inv_date).localeCompare(String(a.inv_date))).slice(0, 6).map(i => ({ date: i.inv_date, customer_id: i.customer_id, name: i.customer_name, status: i.inv_status }))
  const names = [...new Set(inv.filter(i => String(i.customer_name).toLowerCase().includes(name.toLowerCase().split(' ')[0])).map(i => `${i.customer_name} [${i.customer_id}]`))]
  return { shop: { id: shop.id, name: shop.shop_name, zoho_contact_id: shop.zoho_contact_id || '' }, loose_name: loose(shop.shop_name), invoices_read: inv.length, by_id: { count: byId.length, newest: show(byId) }, by_name: { count: byNm.length, newest: show(byNm) }, books_names_like: names.slice(0, 10), newest_in_mirror: newest }
}
