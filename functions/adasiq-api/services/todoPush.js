// Hand commitments to Zoho ToDo and let go.
//
// Ada used to keep her own task list. It grew to 66 items, two thirds with no
// due date so they could never surface, and nothing could ever be marked done
// in a way that stuck. Mark's call, and it is the right one: push each new
// commitment into Zoho ToDo, mention it in the next morning's brief once, then
// never speak of it again. Zoho owns completion. Ada owns capture.
//
// The one thing kept from the old system is same-task matching, because the
// extractor rewords the same promise every run ("Prepare budget", "Prepare
// budget document", "Prepare monthly budget report"). Without it, one job
// would land in his ToDo six times and the mess would just move house.
import axios from 'axios'

const TODO_API = 'https://mail.zoho.com/api/tasks/me'

let cachedToken = null
let tokenExpiresAt = 0

async function getTodoToken() {
  const now = Date.now()
  if (cachedToken && now < tokenExpiresAt - 60000) return cachedToken
  const refreshToken = process.env.ZOHO_TASKS_REFRESH_TOKEN
  if (!refreshToken) throw new Error('ZOHO_TASKS_REFRESH_TOKEN not set')
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: process.env.ZOHO_CLIENT_ID,
    client_secret: process.env.ZOHO_CLIENT_SECRET,
    refresh_token: refreshToken,
  })
  const res = await axios.post('https://accounts.zoho.com/oauth/v2/token', params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 10000,
  })
  if (!res.data?.access_token) throw new Error('ToDo token refresh failed')
  cachedToken = res.data.access_token
  tokenExpiresAt = now + (res.data.expires_in || 3600) * 1000
  return cachedToken
}

/**
 * Inbound commitments are somebody else's promise to Mark, so they go in as a
 * follow-up rather than as work he owes. Same list, honest verb.
 */
export function titleFor(c) {
  const who = String(c.person || '').trim()
  const text = String(c.text || '').trim()
  return c.direction === 'inbound' && who ? `Follow up with ${who}: ${text}` : text
}

/** Read the list before changing it. Paged: Zoho returns 200 at a time. */
export async function listTodos({ includeDone = false } = {}) {
  const token = await getTodoToken()
  // No paging params: this endpoint rejects start/limit with EXTRA_PARAM_FOUND
  // and returns the whole list in one go.
  const res = await axios.get(TODO_API, {
    headers: { Authorization: `Zoho-oauthtoken ${token}` },
    timeout: 20000, validateStatus: s => s < 500,
  })
  if (res.status >= 300) throw new Error(`ToDo list ${res.status}: ${JSON.stringify(res.data).slice(0, 200)}`)
  const d = res.data
  // Zoho nests the array differently across Mail API versions. Find the first
  // array of objects rather than guessing a key.
  const findList = (v, depth = 0) => {
    if (Array.isArray(v)) return v
    if (!v || typeof v !== 'object' || depth > 3) return null
    for (const k of Object.keys(v)) {
      const hit = findList(v[k], depth + 1)
      if (hit) return hit
    }
    return null
  }
  const out = findList(d) || []
  return includeDone ? out : out.filter(t => String(t.status ?? '').toLowerCase() !== 'completed' && t.status !== 2)
}

/** Shape probe: what does this endpoint actually hand back? */
export async function rawTodoResponse() {
  const token = await getTodoToken()
  const res = await axios.get(TODO_API, {
    headers: { Authorization: `Zoho-oauthtoken ${token}` },
    timeout: 20000, validateStatus: s => s < 500,
  })
  const d = res.data
  const shape = v => Array.isArray(v) ? `array[${v.length}]` : (v && typeof v === 'object' ? Object.keys(v).slice(0, 12) : typeof v)
  return { status: res.status, top: shape(d), nested: d && typeof d === 'object' && !Array.isArray(d)
    ? Object.fromEntries(Object.keys(d).slice(0, 8).map(k => [k, shape(d[k])])) : null,
    first: JSON.stringify(Array.isArray(d) ? d[0] : d).slice(0, 400) }
}

/** Where do the tasks actually live? Probe groups as well as "me". */
export async function probeTodoSources() {
  const token = await getTodoToken()
  const h = { Authorization: `Zoho-oauthtoken ${token}` }
  const get = async (url) => {
    try {
      const r = await axios.get(url, { headers: h, timeout: 15000, validateStatus: s => s < 500 })
      const d = r.data?.data ?? r.data
      return { url, status: r.status, type: Array.isArray(d) ? `array[${d.length}]` : typeof d,
               keys: d && typeof d === 'object' && !Array.isArray(d) ? Object.keys(d).slice(0, 10) : null,
               sample: JSON.stringify(d).slice(0, 220) }
    } catch (e) { return { url, error: String(e.message).slice(0, 120) } }
  }
  return [
    await get('https://mail.zoho.com/api/tasks/me'),
    await get('https://mail.zoho.com/api/tasks/groups'),
    await get('https://mail.zoho.com/api/tasks/groups/882217025'),
    await get('https://mail.zoho.com/api/tasks/allTasks'),
  ]
}

export async function completeTodo(id) {
  const token = await getTodoToken()
  const res = await axios.put(`${TODO_API}/${encodeURIComponent(id)}`, { status: 'Completed' }, {
    headers: { Authorization: `Zoho-oauthtoken ${token}`, 'Content-Type': 'application/json' },
    timeout: 10000, validateStatus: s => s < 500,
  })
  return { id, status: res.status, body: res.status >= 300 ? JSON.stringify(res.data).slice(0, 160) : null }
}

export async function createTodo(c) {
  const token = await getTodoToken()
  const body = { title: titleFor(c).slice(0, 240), priority: '2' }
  if (c.due) {
    const [y, m, d] = String(c.due).slice(0, 10).split('-')
    if (y && m && d) body.dueDate = `${d}/${m}/${y}`   // Zoho ToDo wants DD/MM/YYYY
  }
  const res = await axios.post(TODO_API, body, {
    headers: { Authorization: `Zoho-oauthtoken ${token}`, 'Content-Type': 'application/json' },
    timeout: 10000, validateStatus: s => s < 500,
  })
  if (res.status >= 300) throw new Error(`ToDo create ${res.status}: ${JSON.stringify(res.data).slice(0, 160)}`)
  return { id: res.data?.id || res.data?.taskId || null, title: body.title, status: res.status }
}
