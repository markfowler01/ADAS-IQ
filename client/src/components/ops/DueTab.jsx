// 📋 Due (Mark 2026-10-03): everything on the Ops page that has a date, in one
// list, soonest first — subscription renewals, van registration, insurance and
// oil changes, equipment subscriptions. The Monday-morning page.
const BRAND = '#CD4419', INK = '#1a1a1a', MUTED = '#8a847e'
const days = d => d ? Math.ceil((new Date(d) - new Date()) / 86400000) : null
const addMonths = (d, m) => { if (!d) return ''; const x = new Date(d + 'T12:00:00'); x.setMonth(x.getMonth() + Number(m || 12)); return x.toISOString().slice(0, 10) }
const renewalOf = s => s.purchased ? addMonths(s.purchased, s.term_months || 12) : (s.renewal || '')

export function dueItems({ locations, assets, laptops, oem }) {
  const vanName = id => locations.find(l => l.id === id)?.name || ''
  const out = []
  for (const s of oem) { if (s.status === 'inactive' || s.kind === 'pass') continue; const d = renewalOf(s); out.push({ kind: 'Subscription', name: s.name, where: vanName(s.location), date: d, tab: 'oem', cost: s.cost }) }
  for (const a of assets) if (a.sub_exp) out.push({ kind: a.cat === 'Tablet' ? 'Tablet subscription' : 'Equipment subscription', name: a.nickname ? `${a.name} "${a.nickname}"` : a.name, where: vanName(a.location), date: a.sub_exp, tab: 'assets' })
  for (const v of locations) {
    if (v.reg_exp) out.push({ kind: 'Registration', name: v.name, where: v.name, date: v.reg_exp, tab: 'vans' })
    if (v.insurance) out.push({ kind: 'Insurance', name: v.name, where: v.name, date: v.insurance, tab: 'vans' })
    if (v.oil_change) out.push({ kind: 'Oil change', name: v.name, where: v.name, date: v.oil_change, tab: 'vans' })
  }
  return out.map(i => ({ ...i, n: days(i.date) }))
}

export default function DueTab({ locations, assets, laptops, oem, onGo }) {
  const items = dueItems({ locations, assets, laptops, oem })
  const dated = items.filter(i => i.n !== null).sort((a, b) => a.n - b.n)
  const undated = items.filter(i => i.n === null)
  const groups = [
    ['Overdue', dated.filter(i => i.n < 0), '#b71c1c', '#fde8e8'],
    ['Next 30 days', dated.filter(i => i.n >= 0 && i.n <= 30), '#7d5a00', '#fff3cd'],
    ['31 to 60 days', dated.filter(i => i.n > 30 && i.n <= 60), '#7d5a00', '#fff8e1'],
    ['Later', dated.filter(i => i.n > 60), '#1a7336', '#e6f4ea'],
  ].filter(g => g[1].length)
  const fmt = i => i.n < 0 ? `${Math.abs(i.n)}d overdue` : i.n === 0 ? 'today' : `in ${i.n}d`
  return (
    <div>
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 14 }}>
        {[['Overdue', dated.filter(i => i.n < 0).length, '#b71c1c'], ['Due in 30 days', dated.filter(i => i.n >= 0 && i.n <= 30).length, '#7d5a00'], ['Due in 60 days', dated.filter(i => i.n >= 0 && i.n <= 60).length, '#7d5a00'], ['No date yet', undated.length, MUTED]].map(([l, v, c]) => (
          <div key={l}><div style={{ fontSize: 24, fontWeight: 800, color: c, lineHeight: 1 }}>{v}</div><div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: MUTED, marginTop: 3 }}>{l}</div></div>
        ))}
      </div>
      {!dated.length && <div style={{ fontSize: 13, color: MUTED, marginBottom: 12 }}>Nothing has a date yet. Enter purchase dates on Subscriptions and the van dates on Vans, and this list fills itself.</div>}
      {groups.map(([title, list, fg, bg]) => (
        <div key={title} style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: fg, marginBottom: 6 }}>{title} · {list.length}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {list.map((i, k) => (
              <button key={k} onClick={() => onGo(i.tab)} style={{ textAlign: 'left', display: 'flex', alignItems: 'center', gap: 10, background: 'white', border: '1px solid #ebe7e2', borderLeft: `4px solid ${fg}`, borderRadius: 8, padding: '8px 12px', cursor: 'pointer' }}>
                <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 4, background: bg, color: fg, whiteSpace: 'nowrap' }}>{fmt(i)}</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: INK, flex: 1, minWidth: 0 }}>{i.name}<span style={{ fontWeight: 400, color: MUTED }}> · {i.kind}{i.where && i.where !== i.name ? ` · ${i.where}` : ''}</span></span>
                <span style={{ fontSize: 12, color: MUTED, fontFamily: 'IBM Plex Mono, monospace' }}>{i.date}</span>
                <span style={{ color: BRAND, fontWeight: 700 }}>›</span>
              </button>
            ))}
          </div>
        </div>
      ))}
      {undated.length > 0 && (
        <div style={{ fontSize: 12, color: MUTED, marginTop: 8 }}>No date yet: {undated.slice(0, 12).map(i => i.name).join(', ')}{undated.length > 12 ? ` and ${undated.length - 12} more` : ''}. Enter them on Subscriptions or Vans.</div>
      )}
    </div>
  )
}
