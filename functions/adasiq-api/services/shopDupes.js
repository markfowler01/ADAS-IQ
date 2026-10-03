// 🔎 CRM duplicate finder (Mark 2026-10-02: "I see 2 Showcases"). Read-only: groups
// shops whose names match once "auto / body / collision / rebuild / shop / inc / llc"
// are ignored, or share a phone / email / Books link. Nothing is merged here.
export async function findShopDuplicates(req) {
    const { getAllShops } = await import('../routes/shops.js')
    const shops = await getAllShops(req)
    const loose = n => String(n || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]/g, ' ').replace(/\b(the|auto|automotive|body|bodyshop|shop|collision|repair|repairs|center|centre|rebuild|rebuilders|inc|llc|co|company|and|of)\b/g, ' ').replace(/\s+/g, ' ').trim()
    const digits = p => String(p || '').replace(/\D/g, '').slice(-10)
    const groups = new Map()
    const add = (k, sh, why) => { if (!k) return; const g = groups.get(k) || { key: k, why, shops: new Map() }; g.shops.set(sh.id, sh); groups.set(k, g) }
    for (const sh of shops) {
      const ln = loose(sh.shop_name); if (ln.length >= 3) add(`name:${ln}`, sh, 'same name')
      const ph = digits(sh.phone || sh.shop_phone); if (ph.length === 10) add(`phone:${ph}`, sh, 'same phone')
      const em = String(sh.email || '').toLowerCase().trim(); if (/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(em) && !/\.(png|jpe?g|gif|webp|svg)$/i.test(em)) add(`email:${em}`, sh, 'same email')
      if (sh.zoho_contact_id) add(`books:${sh.zoho_contact_id}`, sh, 'same Books customer')
    }
    const out = [...groups.values()].filter(g => g.shops.size > 1).map(g => ({ why: g.why, key: g.key, shops: [...g.shops.values()].map(s => ({ id: s.id, name: s.shop_name, stage: s.pipeline_stage || '', city: s.city || '', phone: s.phone || '', books: s.zoho_contact_id || '', jobs: s.job_count ?? null, has_rules: !!(s.billing_rules && Object.keys(s.billing_rules).length), active: ['active', 'active2', 'second_active'].includes(s.pipeline_stage), twin: false })) }))
  // Likely real duplicates first: same phone / email / Books customer, or a same-name
  // pair where one is a customer. Same-name chains with different phones (Maaco ×8)
  // are usually separate locations.
  const digitsOf = g => new Set(g.shops.map(x => digits(x.phone)).filter(Boolean))
  for (const g of out) g.likely = g.why !== 'same name' || (digitsOf(g).size < g.shops.length) || g.shops.some(x => ['active', 'active2', 'second_active'].includes(x.stage))
  const { pickKeeper } = await import('./shopMerge.js')
  for (const g of out) {
    g.keep = pickKeeper(g.shops).id
    g.twin = g.shops.length > 1 && new Set(g.shops.map(x => digits(x.phone))).size === 1 && digits(g.shops[0].phone).length === 10 && new Set(g.shops.map(x => loose(x.name))).size === 1
  }
  out.sort((a, b) => Number(b.likely) - Number(a.likely))
  return { total_shops: shops.length, groups: out }
}
