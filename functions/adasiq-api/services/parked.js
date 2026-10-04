// 🅿 Parked ideas (Mark 2026-10-04: "I always have ideas come to my head" and
// "I don't always have my planner with me"). Anything Mark texts to the shop
// number from his own cell, or sends from the Siri shortcut, lands here, out of
// his head. Ada reads the list in the morning briefing and offers them as Big 3
// candidates; the planner shows them with "→ Big 3" / "done" / "drop".
import catalyst from 'zcatalyst-sdk-node'

const KEY = 'parked_ideas'
const app = req => catalyst.initialize(req, { type: 'advancedio' })
async function readRow(req) {
  const r = await app(req).zcql().executeZCQLQuery(`SELECT ROWID, config_value FROM AppConfig WHERE config_key = '${KEY}' LIMIT 1`)
  const row = r?.[0]?.AppConfig || null
  let list = []; try { list = JSON.parse(row?.config_value || '[]') || [] } catch { list = [] }
  return { row, list }
}
async function writeList(req, row, list) {
  const json = JSON.stringify(list.slice(-300))
  const t = app(req).datastore().table('AppConfig')
  if (row) await t.updateRow({ ROWID: row.ROWID, config_value: json })
  else await t.insertRow({ config_key: KEY, config_value: json })
}

export async function addParked(req, text, via = 'app') {
  const clean = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 500)
  if (!clean) return null
  const { row, list } = await readRow(req)
  const item = { id: `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, at: new Date().toISOString(), text: clean, via, status: 'open' }
  await writeList(req, row, [...list, item])
  return item
}
export async function listParked(req, { open = true } = {}) {
  const { list } = await readRow(req)
  return (open ? list.filter(x => x.status === 'open') : list).sort((a, b) => String(b.at).localeCompare(String(a.at)))
}
export async function setParked(req, id, status) {
  if (!['open', 'used', 'done', 'dropped'].includes(status)) throw new Error('bad status')
  const { row, list } = await readRow(req)
  const next = list.map(x => x.id === id ? { ...x, status, closed_at: status === 'open' ? '' : new Date().toISOString() } : x)
  await writeList(req, row, next)
  return next.find(x => x.id === id) || null
}
/** Spoken line for the morning briefing. */
export async function parkedForBrief(req) {
  try {
    const open = await listParked(req)
    if (!open.length) return ''
    const since = open.filter(x => Date.now() - new Date(x.at) < 36 * 3600 * 1000)
    const show = (since.length ? since : open).slice(0, 4)
    return `You parked ${open.length === 1 ? 'one thing' : `${open.length} things`}${since.length && since.length !== open.length ? `, ${since.length} since yesterday` : ''}. ${show.map(x => x.text.replace(/[.!?]+$/, '')).join('. ')}.`
  } catch { return '' }
}
