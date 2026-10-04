// 🅿 Parked ideas (Mark 2026-10-04: "I always have ideas come to my head" and
// "I don't always have my planner with me"). Anything Mark texts to the shop
// number from his own cell, or sends from the Siri shortcut, lands here, out of
// his head. Ada reads the list in the morning briefing and offers them as Big 3
// candidates; the planner shows them with "→ Big 3" / "done" / "drop".
import catalyst from 'zcatalyst-sdk-node'
import axios from 'axios'

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

// ── Notion as the store (Mark 2026-10-04: "Notion can be a good place for this —
// I can connect it to Ada"). When NOTION_TOKEN (env) or AppConfig notion_token is
// set, parked ideas live in the Notion "🅿 Parked" database and AppConfig is only the
// fallback. Properties: Idea (title) · Status (select: Open / Big 3 / Done / Dropped) ·
// Source (select) · Captured (date).
const NOTION = 'https://api.notion.com/v1'
const NOTION_DB = process.env.NOTION_PARKED_DB || ''   // set after the database is created (also AppConfig notion_parked_db)
async function notionCfg(req) {
  let token = process.env.NOTION_TOKEN || '', db = NOTION_DB
  try {
    const r = await app(req).zcql().executeZCQLQuery("SELECT config_key, config_value FROM AppConfig WHERE config_key = 'notion_token' OR config_key = 'notion_parked_db'")
    for (const x of r || []) { const c = x.AppConfig || x; if (c.config_key === 'notion_token' && !token) token = c.config_value; if (c.config_key === 'notion_parked_db' && c.config_value) db = c.config_value }
  } catch { /* fallback store */ }
  return token && db ? { token, db, H: { Authorization: `Bearer ${token}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' } } : null
}
const STATUS_TO_NOTION = { open: 'Open', used: 'Big 3', done: 'Done', dropped: 'Dropped' }
const NOTION_TO_STATUS = { Open: 'open', 'Big 3': 'used', Done: 'done', Dropped: 'dropped' }
const fromPage = pg => ({ id: pg.id, at: pg.properties?.Captured?.date?.start || pg.created_time, text: (pg.properties?.Idea?.title || []).map(t => t.plain_text).join(''), via: pg.properties?.Source?.select?.name || '', status: NOTION_TO_STATUS[pg.properties?.Status?.select?.name] || 'open', notion: true })
async function notionAdd(cfg, text, via) {
  const r = await axios.post(`${NOTION}/pages`, { parent: { database_id: cfg.db }, properties: { Idea: { title: [{ text: { content: text } }] }, Status: { select: { name: 'Open' } }, Source: { select: { name: via || 'app' } }, Captured: { date: { start: new Date().toISOString() } } } }, { headers: cfg.H, timeout: 15000 })
  return fromPage(r.data)
}
async function notionList(cfg, open) {
  const body = { page_size: 100, sorts: [{ property: 'Captured', direction: 'descending' }], ...(open ? { filter: { property: 'Status', select: { equals: 'Open' } } } : {}) }
  const r = await axios.post(`${NOTION}/databases/${cfg.db}/query`, body, { headers: cfg.H, timeout: 15000 })
  return (r.data?.results || []).map(fromPage)
}
async function notionSet(cfg, id, status) {
  const r = await axios.patch(`${NOTION}/pages/${id}`, { properties: { Status: { select: { name: STATUS_TO_NOTION[status] || 'Open' } } } }, { headers: cfg.H, timeout: 15000 })
  return fromPage(r.data)
}

export async function addParked(req, text, via = 'app') {
  const clean0 = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 500)
  if (!clean0) return null
  const cfg = await notionCfg(req)
  if (cfg) { try { return await notionAdd(cfg, clean0, via) } catch (e) { console.warn('[parked] notion add failed, using fallback:', e.response?.data?.message || e.message) } }
  return addParkedLocal(req, clean0, via)
}
export async function listParked(req, { open = true } = {}) {
  const cfg = await notionCfg(req)
  if (cfg) { try { return await notionList(cfg, open) } catch (e) { console.warn('[parked] notion list failed, using fallback:', e.response?.data?.message || e.message) } }
  return listParkedLocal(req, { open })
}
export async function setParked(req, id, status) {
  if (!['open', 'used', 'done', 'dropped'].includes(status)) throw new Error('bad status')
  const cfg = await notionCfg(req)
  if (cfg && String(id).includes('-')) { try { return await notionSet(cfg, id, status) } catch (e) { console.warn('[parked] notion set failed:', e.response?.data?.message || e.message) } }
  return setParkedLocal(req, id, status)
}

async function addParkedLocal(req, text, via = 'app') {
  const clean = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 500)
  if (!clean) return null
  const { row, list } = await readRow(req)
  const item = { id: `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, at: new Date().toISOString(), text: clean, via, status: 'open' }
  await writeList(req, row, [...list, item])
  return item
}
async function listParkedLocal(req, { open = true } = {}) {
  const { list } = await readRow(req)
  return (open ? list.filter(x => x.status === 'open') : list).sort((a, b) => String(b.at).localeCompare(String(a.at)))
}
async function setParkedLocal(req, id, status) {
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
