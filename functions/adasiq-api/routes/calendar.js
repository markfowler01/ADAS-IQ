import { Router } from 'express'
import axios from 'axios'
import catalyst from 'zcatalyst-sdk-node'

const router = Router()

const ZOHO_TOKEN_URL = 'https://accounts.zoho.com/oauth/v2/token'
const ZOHO_CALENDAR_API = 'https://calendar.zoho.com/api/v1'
const CALENDAR_UID = '26e11aa19d91483f9f68f85d8f409f49'

// Use env vars for credentials — set these in Catalyst console
const CLIENT_ID = process.env.ZOHO_CALENDAR_CLIENT_ID || '1000.QRDSB8BZVJV4YI17B8VWAFB6WE6WCR'
const CLIENT_SECRET = process.env.ZOHO_CALENDAR_CLIENT_SECRET || '1e738bd80ed567119440145c3635701066ddb4554d'
const REFRESH_TOKEN = process.env.ZOHO_CALENDAR_REFRESH_TOKEN || '1000.7c82a7e0594e7872014c8027084dd421.cf4328d6347eb4fbab1d7c0df39acc7b'

let cachedAccessToken = null
let tokenExpiresAt = 0

async function getAccessToken() {
  if (cachedAccessToken && Date.now() < tokenExpiresAt - 60000) {
    return cachedAccessToken
  }
  const resp = await axios.post(ZOHO_TOKEN_URL, null, {
    params: {
      refresh_token: REFRESH_TOKEN,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: 'refresh_token',
    },
  })
  cachedAccessToken = resp.data.access_token
  tokenExpiresAt = Date.now() + (resp.data.expires_in * 1000)
  return cachedAccessToken
}

// GET /api/calendar/events?date=YYYY-MM-DD
router.get('/events', async (req, res) => {
  try {
    const dateStr = req.query.date || new Date().toISOString().slice(0, 10)
    const token = await getAccessToken()

    // Calculate UTC offset for Pacific time dynamically (handles PDT/PST)
    const dayStart = new Date(dateStr + 'T00:00:00-08:00') // PST baseline
    // Check if date falls in DST (second Sunday in March to first Sunday in November)
    const year = dayStart.getFullYear()
    const dstStart = getNthSunday(year, 2, 2) // 2nd Sunday in March
    const dstEnd = getNthSunday(year, 10, 1) // 1st Sunday in November
    const testDate = new Date(dateStr + 'T12:00:00')
    const isPDT = testDate >= dstStart && testDate < dstEnd
    const offsetHours = isPDT ? 7 : 8

    const datePart = dateStr.replace(/-/g, '')
    const nextDay = new Date(dateStr + 'T00:00:00')
    nextDay.setDate(nextDay.getDate() + 1)
    const nextDayPart = nextDay.toISOString().slice(0, 10).replace(/-/g, '')
    const pad = (n) => String(n).padStart(2, '0')

    const rangeParam = JSON.stringify({
      start: `${datePart}T${pad(offsetHours)}0000Z`,
      end: `${nextDayPart}T${pad(offsetHours)}0000Z`,
    })

    const resp = await axios.get(
      `${ZOHO_CALENDAR_API}/calendars/${CALENDAR_UID}/events`,
      {
        headers: { Authorization: `Zoho-oauthtoken ${token}` },
        params: { range: rangeParam },
      }
    )

    const events = (resp.data.events || [])
      .filter(e => !e.isallday)
      .map(e => {
        const start = e.dateandtime?.start || ''
        const end = e.dateandtime?.end || ''
        return {
          id: e.uid,
          title: e.title,
          startTime: parseZohoTime(start),
          endTime: parseZohoTime(end),
          date: parseZohoDate(start),
          note: e.description || '',
          colorCategory: 'work',
          source: 'zoho',
        }
      })

    // Also fetch Google family calendar events
    try {
      const icalResp = await axios.get('https://calendar.google.com/calendar/ical/mfowler4456%40gmail.com/private-2303c584bc498183e92904de0204e523/basic.ics', { timeout: 8000 })
      const ical = icalResp.data || ''
      // Parse iCal events for the requested date
      const targetDate = dateStr.replace(/-/g, '')
      const veventBlocks = ical.split('BEGIN:VEVENT').slice(1)
      for (const block of veventBlocks) {
        const getField = (name) => { const m = block.match(new RegExp(name + '[^:]*:(.+)')); return m ? m[1].trim() : '' }
        const summary = getField('SUMMARY')
        const dtstart = getField('DTSTART')
        if (!summary || !dtstart) continue
        // Check if event is on the target date
        const dateMatch = dtstart.match(/(\d{8})/)
        if (!dateMatch) continue
        const eventDate = dateMatch[1]
        if (eventDate !== targetDate) continue
        // Parse times
        const timeMatch = dtstart.match(/T(\d{2})(\d{2})/)
        const dtend = getField('DTEND')
        const endMatch = dtend.match(/T(\d{2})(\d{2})/)
        // Handle timezone conversion for UTC events
        const isUTC = dtstart.endsWith('Z')
        let startH = timeMatch ? parseInt(timeMatch[1]) : 0
        let startM = timeMatch ? parseInt(timeMatch[2]) : 0
        let endH = endMatch ? parseInt(endMatch[1]) : startH + 1
        let endM = endMatch ? parseInt(endMatch[2]) : 0
        if (isUTC) { startH -= offsetHours; endH -= offsetHours; if (startH < 0) continue; }
        // Skip all-day events (no time component)
        if (!timeMatch) continue
        events.push({
          id: 'gcal_' + Math.random().toString(36).slice(2, 8),
          title: '👨‍👩‍👧‍👦 ' + summary,
          startTime: `${String(startH).padStart(2,'0')}:${String(startM).padStart(2,'0')}`,
          endTime: `${String(endH).padStart(2,'0')}:${String(endM).padStart(2,'0')}`,
          date: dateStr,
          note: '',
          colorCategory: 'family',
          source: 'google',
        })
      }
    } catch (gcalErr) {
      console.warn('[calendar] Google Calendar fetch failed:', gcalErr.message)
    }

    res.json({ events, date: dateStr })
  } catch (err) {
    console.error('[calendar] Error fetching events:', err.response?.data || err.message)
    res.status(500).json({ error: 'Failed to fetch calendar events', detail: err.message })
  }
})

// GET /api/calendar/week?date=YYYY-MM-DD (returns events for the whole week)
router.get('/week', async (req, res) => {
  try {
    const dateStr = req.query.date || new Date().toISOString().slice(0, 10)
    const d = new Date(dateStr + 'T00:00:00')
    const day = d.getDay()
    const monday = new Date(d)
    monday.setDate(d.getDate() - ((day + 6) % 7))
    const sunday = new Date(monday)
    sunday.setDate(monday.getDate() + 6)

    const token = await getAccessToken()

    // Dynamic Pacific timezone offset
    const year = monday.getFullYear()
    const dstStart = getNthSunday(year, 2, 2)
    const dstEnd = getNthSunday(year, 10, 1)
    const isPDT = monday >= dstStart && monday < dstEnd
    const offsetHours = isPDT ? 7 : 8
    const pad = (n) => String(n).padStart(2, '0')

    const startRange = formatDateForZoho(monday) + `T${pad(offsetHours)}0000Z`
    const endSun = new Date(sunday)
    endSun.setDate(endSun.getDate() + 1)
    const endRange = formatDateForZoho(endSun) + `T${pad(offsetHours)}0000Z`

    const resp = await axios.get(
      `${ZOHO_CALENDAR_API}/calendars/${CALENDAR_UID}/events`,
      {
        headers: { Authorization: `Zoho-oauthtoken ${token}` },
        params: { range: JSON.stringify({ start: startRange, end: endRange }) },
      }
    )

    const events = (resp.data.events || [])
      .filter(e => !e.isallday)
      .map(e => {
        const start = e.dateandtime?.start || ''
        const end = e.dateandtime?.end || ''
        return {
          id: e.uid,
          title: e.title,
          startTime: parseZohoTime(start),
          endTime: parseZohoTime(end),
          date: parseZohoDate(start),
          note: e.description || '',
          colorCategory: 'work',
          source: 'zoho',
        }
      })

    res.json({ events })
  } catch (err) {
    console.error('[calendar] Error fetching week events:', err.response?.data || err.message)
    res.status(500).json({ error: 'Failed to fetch week events', detail: err.message })
  }
})

// GET /api/calendar/revenue?date=YYYY-MM-DD — daily revenue from Zoho Books
router.get('/revenue', async (req, res) => {
  try {
    const dateStr = req.query.date || new Date().toISOString().slice(0, 10)

    // Use the existing Zoho Books token (different OAuth client than calendar)
    const booksToken = await getBooksAccessToken()
    const orgId = process.env.ZOHO_ORGANIZATION_ID

    // Fetch all invoices created on that date (invoiced sales, any status)
    const resp = await axios.get('https://www.zohoapis.com/books/v3/invoices', {
      headers: { Authorization: `Zoho-oauthtoken ${booksToken}` },
      params: {
        organization_id: orgId,
        date: dateStr,
        per_page: 200,
      },
    })

    const invoices = resp.data.invoices || []
    const totalRevenue = invoices.reduce((sum, inv) => sum + (parseFloat(inv.total) || 0), 0)
    const invoiceCount = invoices.length

    res.json({
      date: dateStr,
      revenue: totalRevenue,
      invoiceCount,
      invoices: invoices.map(inv => ({
        id: inv.invoice_id,
        number: inv.invoice_number,
        customer: inv.customer_name,
        total: parseFloat(inv.total) || 0,
        date: inv.date,
      })),
    })
  } catch (err) {
    console.error('[revenue] Error:', err.response?.data || err.message)
    res.status(500).json({ error: 'Failed to fetch revenue', detail: err.message })
  }
})

// GET /api/calendar/revenue/summary — YTD, quarterly, monthly invoice totals
router.get('/revenue/summary', async (req, res) => {
  try {
    const booksToken = await getBooksAccessToken()
    const orgId = process.env.ZOHO_ORGANIZATION_ID
    const now = new Date()
    const year = now.getFullYear()
    const month = now.getMonth() + 1
    const quarter = Math.ceil(month / 3)
    const quarterStartMonth = (quarter - 1) * 3 + 1

    const ytdStart = `${year}-01-01`
    const qStart = `${year}-${String(quarterStartMonth).padStart(2, '0')}-01`
    const mStart = `${year}-${String(month).padStart(2, '0')}-01`
    const today = now.toISOString().slice(0, 10)

    // Fetch all invoices for the year (paginated)
    let allInvoices = []
    let page = 1
    let hasMore = true
    while (hasMore) {
      const resp = await axios.get('https://www.zohoapis.com/books/v3/invoices', {
        headers: { Authorization: `Zoho-oauthtoken ${booksToken}` },
        params: {
          organization_id: orgId,
          date_start: ytdStart,
          date_end: today,
          per_page: 200,
          page,
        },
      })
      const invoices = resp.data.invoices || []
      allInvoices = allInvoices.concat(invoices)
      hasMore = resp.data.page_context?.has_more_page || false
      page++
      if (page > 20) break // safety
    }

    // Calculate totals
    const ytdTotal = allInvoices.reduce((s, inv) => s + (parseFloat(inv.total) || 0), 0)
    const quarterlyTotal = allInvoices
      .filter(inv => inv.date >= qStart)
      .reduce((s, inv) => s + (parseFloat(inv.total) || 0), 0)
    const monthlyTotal = allInvoices
      .filter(inv => inv.date >= mStart)
      .reduce((s, inv) => s + (parseFloat(inv.total) || 0), 0)

    res.json({
      year,
      quarter: `Q${quarter}`,
      month: String(month).padStart(2, '0'),
      ytdTotal,
      quarterlyTotal,
      monthlyTotal,
      invoiceCount: allInvoices.length,
    })
  } catch (err) {
    console.error('[revenue/summary] Error:', err.response?.data || err.message)
    res.status(500).json({ error: 'Failed to fetch revenue summary', detail: err.message })
  }
})

// GET /api/calendar/kpis?date=YYYY-MM-DD — daily activity counts from ADAS IQ CRM
router.get('/kpis', async (req, res) => {
  try {
    const dateStr = req.query.date || new Date().toISOString().slice(0, 10)

    // Read shops from Catalyst cache
    const app = catalyst.initialize(req)
    const segment = app.cache().segment()
    let shops = []
    try {
      const metaRaw = await segment.getValue('crm_shops_meta')
      if (metaRaw) {
        const { chunks } = JSON.parse(metaRaw)
        const parts = await Promise.all(
          Array.from({ length: chunks }, (_, i) =>
            segment.getValue(`crm_shops_chunk_${i}`)
              .then(v => (v ? JSON.parse(v) : []))
              .catch(() => [])
          )
        )
        shops = parts.flat()
      }
    } catch (e) {
      try {
        const val = await segment.getValue('crm_shops')
        shops = val ? JSON.parse(val) : []
      } catch { shops = [] }
    }

    // Count activities by type for the given date
    let calls = 0
    let visits = 0
    shops.forEach(shop => {
      (shop.activities || []).forEach(a => {
        if (a.date === dateStr) {
          if (a.type === 'call') calls++
          if (a.type === 'visit') visits++
        }
      })
    })

    res.json({ date: dateStr, calls, visits, totalShops: shops.length })
  } catch (err) {
    console.error('[kpis] Error:', err.message)
    res.status(500).json({ error: 'Failed to fetch KPIs', detail: err.message })
  }
})

// Books token — uses the existing ADAS IQ Zoho Books credentials
let cachedBooksToken = null
let booksTokenExpiresAt = 0
async function getBooksAccessToken() {
  if (cachedBooksToken && Date.now() < booksTokenExpiresAt - 60000) return cachedBooksToken
  const resp = await axios.post(ZOHO_TOKEN_URL, null, {
    params: {
      refresh_token: process.env.ZOHO_REFRESH_TOKEN,
      client_id: process.env.ZOHO_CLIENT_ID,
      client_secret: process.env.ZOHO_CLIENT_SECRET,
      grant_type: 'refresh_token',
    },
  })
  cachedBooksToken = resp.data.access_token
  booksTokenExpiresAt = Date.now() + (resp.data.expires_in * 1000)
  return cachedBooksToken
}

// GET /api/calendar/events/note — add/update note on a Zoho Calendar event
router.get('/events/note', async (req, res) => {
  try {
    const { eventId, note } = req.query
    if (!eventId || !note) {
      return res.status(400).json({ error: 'eventId and note are required' })
    }
    const token = await getAccessToken()

    // First fetch the existing event to get its etag
    const getResp = await axios.get(
      `${ZOHO_CALENDAR_API}/calendars/${CALENDAR_UID}/events/${eventId}`,
      { headers: { Authorization: `Zoho-oauthtoken ${token}` } }
    )
    const existing = getResp.data.events?.[0]
    if (!existing) return res.status(404).json({ error: 'Event not found' })

    const etag = existing.etag
    const eventData = JSON.stringify({
      title: existing.title,
      description: note,
      dateandtime: existing.dateandtime,
    })

    const updateResp = await axios.put(
      `${ZOHO_CALENDAR_API}/calendars/${CALENDAR_UID}/events/${eventId}`,
      `eventdata=${encodeURIComponent(eventData)}`,
      {
        headers: {
          Authorization: `Zoho-oauthtoken ${token}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          etag: etag,
        },
      }
    )

    res.json({ success: true, event: { id: eventId, note } })
  } catch (err) {
    console.error('[calendar] Note update error:', err.response?.data || err.message)
    res.status(500).json({ error: 'Failed to update event note', detail: err.message })
  }
})

// GET /api/calendar/events/create — create event via GET (avoids CORS preflight)
router.get('/events/create', async (req, res) => {
  try {
    const { title, date, startTime, endTime } = req.query
    if (!title || !date || !startTime) {
      return res.status(400).json({ error: 'title, date, and startTime are required' })
    }
    const token = await getAccessToken()
    const datePart = date.replace(/-/g, '')
    const year = parseInt(date.split('-')[0])
    const dstStart = getNthSunday(year, 2, 2)
    const dstEnd = getNthSunday(year, 10, 1)
    const testDate = new Date(date + 'T12:00:00')
    const isPDT = testDate >= dstStart && testDate < dstEnd
    const offset = isPDT ? '0700' : '0800'
    const start = `${datePart}T${startTime.replace(':', '')}00-${offset}`
    const end = endTime
      ? `${datePart}T${endTime.replace(':', '')}00-${offset}`
      : `${datePart}T${String(parseInt(startTime.split(':')[0]) + (parseInt(startTime.split(':')[1]) >= 30 ? 1 : 0)).padStart(2, '0')}${parseInt(startTime.split(':')[1]) >= 30 ? '00' : '30'}00-${offset}`
    const eventData = JSON.stringify({ title, dateandtime: { start, end, timezone: 'America/Los_Angeles' } })
    const resp = await axios.post(
      `${ZOHO_CALENDAR_API}/calendars/${CALENDAR_UID}/events`,
      `eventdata=${encodeURIComponent(eventData)}`,
      { headers: { Authorization: `Zoho-oauthtoken ${token}`, 'Content-Type': 'application/x-www-form-urlencoded' } }
    )
    const created = resp.data.events?.[0]
    res.json({ success: true, event: { id: created?.uid, title: created?.title, startTime, endTime } })
  } catch (err) {
    console.error('[calendar] GET create error:', err.response?.data || err.message)
    res.status(500).json({ error: 'Failed to create event', detail: err.message })
  }
})

// POST /api/calendar/events — create a new event in Zoho Calendar
router.post('/events', async (req, res) => {
  try {
    const { title, date, startTime, endTime } = req.body
    if (!title || !date || !startTime) {
      return res.status(400).json({ error: 'title, date, and startTime are required' })
    }
    const token = await getAccessToken()
    const datePart = date.replace(/-/g, '')

    // Dynamic PDT/PST offset
    const year = parseInt(date.split('-')[0])
    const dstStart = getNthSunday(year, 2, 2)
    const dstEnd = getNthSunday(year, 10, 1)
    const testDate = new Date(date + 'T12:00:00')
    const isPDT = testDate >= dstStart && testDate < dstEnd
    const offset = isPDT ? '0700' : '0800'

    const start = `${datePart}T${startTime.replace(':', '')}00-${offset}`
    const end = endTime
      ? `${datePart}T${endTime.replace(':', '')}00-${offset}`
      : `${datePart}T${String(parseInt(startTime.split(':')[0]) + (parseInt(startTime.split(':')[1]) >= 30 ? 1 : 0)).padStart(2, '0')}${parseInt(startTime.split(':')[1]) >= 30 ? '00' : '30'}00-${offset}`

    console.log('[calendar] Creating event:', { title, date, start, end, offset, isPDT })

    const eventData = JSON.stringify({
      title,
      dateandtime: { start, end, timezone: 'America/Los_Angeles' },
    })

    const resp = await axios.post(
      `${ZOHO_CALENDAR_API}/calendars/${CALENDAR_UID}/events`,
      `eventdata=${encodeURIComponent(eventData)}`,
      {
        headers: {
          Authorization: `Zoho-oauthtoken ${token}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    )

    const created = resp.data.events?.[0]
    res.json({
      success: true,
      event: {
        id: created?.uid,
        title: created?.title,
        startTime,
        endTime: endTime || startTime,
      },
    })
  } catch (err) {
    console.error('[calendar] Error creating event:', err.response?.data || err.message)
    res.status(500).json({ error: 'Failed to create event', detail: err.message })
  }
})

// PUT /api/calendar/events/:uid — update an existing event (title, time, etc.)
router.put('/events/:uid', async (req, res) => {
  try {
    const { uid } = req.params
    const { title, date, startTime, endTime } = req.body
    if (!uid) return res.status(400).json({ error: 'Event UID is required' })
    const token = await getAccessToken()

    const updates = {}
    if (title) updates.title = title
    if (date && startTime) {
      const datePart = date.replace(/-/g, '')
      const year = parseInt(date.split('-')[0])
      const dstStart = getNthSunday(year, 2, 2)
      const dstEnd = getNthSunday(year, 10, 1)
      const testDate = new Date(date + 'T12:00:00')
      const isPDT = testDate >= dstStart && testDate < dstEnd
      const offset = isPDT ? '0700' : '0800'
      const start = `${datePart}T${startTime.replace(':', '')}00-${offset}`
      const end = endTime
        ? `${datePart}T${endTime.replace(':', '')}00-${offset}`
        : start
      updates.dateandtime = { start, end, timezone: 'America/Los_Angeles' }
    }

    const eventData = JSON.stringify(updates)
    const resp = await axios.put(
      `${ZOHO_CALENDAR_API}/calendars/${CALENDAR_UID}/events/${uid}`,
      `eventdata=${encodeURIComponent(eventData)}`,
      { headers: { Authorization: `Zoho-oauthtoken ${token}`, 'Content-Type': 'application/x-www-form-urlencoded' } }
    )
    const updated = resp.data.events?.[0]
    console.log('[calendar] Updated event:', uid, title)
    res.json({ success: true, event: { id: updated?.uid || uid, title: updated?.title || title } })
  } catch (err) {
    console.error('[calendar] Error updating event:', err.response?.data || err.message)
    res.status(500).json({ error: 'Failed to update event', detail: err.message })
  }
})

// DELETE /api/calendar/events/:uid — delete an event
router.delete('/events/:uid', async (req, res) => {
  try {
    const { uid } = req.params
    if (!uid) return res.status(400).json({ error: 'Event UID is required' })
    const token = await getAccessToken()
    await axios.delete(
      `${ZOHO_CALENDAR_API}/calendars/${CALENDAR_UID}/events/${uid}`,
      { headers: { Authorization: `Zoho-oauthtoken ${token}` } }
    )
    console.log('[calendar] Deleted event:', uid)
    res.json({ success: true })
  } catch (err) {
    console.error('[calendar] Error deleting event:', err.response?.data || err.message)
    res.status(500).json({ error: 'Failed to delete event', detail: err.message })
  }
})

// OAuth callback (for initial token exchange — already done, kept for reference)
router.get('/zoho/callback', (req, res) => {
  const code = req.query.code
  if (code) {
    res.json({ message: 'Auth code received. Exchange it for tokens via the CLI.', code })
  } else {
    res.status(400).json({ error: 'No code provided' })
  }
})

function parseZohoTime(zohoStr) {
  // "20260405T123000-0700" → "12:30"
  const match = zohoStr.match(/T(\d{2})(\d{2})/)
  if (!match) return ''
  return `${match[1]}:${match[2]}`
}

function parseZohoDate(zohoStr) {
  // "20260405T123000-0700" → "2026-04-05"
  const match = zohoStr.match(/^(\d{4})(\d{2})(\d{2})/)
  if (!match) return ''
  return `${match[1]}-${match[2]}-${match[3]}`
}

function formatDateForZoho(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}${m}${day}`
}

// Get the nth Sunday of a given month (0-indexed month)
function getNthSunday(year, month, n) {
  const d = new Date(year, month, 1)
  const dayOfWeek = d.getDay()
  const firstSunday = dayOfWeek === 0 ? 1 : 8 - dayOfWeek
  d.setDate(firstSunday + (n - 1) * 7)
  return d
}

// ── Zoho ToDo Tasks (pink to-do items on calendar) ──

const ZOHO_TODO_API = 'https://mail.zoho.com/api/tasks/me'
const ZOHO_TODO_GROUP_API = 'https://mail.zoho.com/api/tasks/groups'
const AR_GROUP_ID = '882217025'

let cachedTodoToken = null
let todoTokenExpiresAt = 0

async function getTodoAccessToken() {
  const now = Date.now()
  if (cachedTodoToken && now < todoTokenExpiresAt - 60000) return cachedTodoToken
  const refreshToken = process.env.ZOHO_TASKS_REFRESH_TOKEN
  if (!refreshToken) throw new Error('ZOHO_TASKS_REFRESH_TOKEN not set')
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: process.env.ZOHO_CLIENT_ID || '1000.QZ03TGBT8WM04EMRXU6DF5GYWZKEOK',
    client_secret: process.env.ZOHO_CLIENT_SECRET || '1f16a93ef39f422ed0637a9b2d21cafb5800e9bca7',
    refresh_token: refreshToken,
  })
  const res = await axios.post('https://accounts.zoho.com/oauth/v2/token', params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 10000,
  })
  if (!res.data.access_token) throw new Error('ToDo token refresh failed')
  cachedTodoToken = res.data.access_token
  todoTokenExpiresAt = now + (res.data.expires_in || 3600) * 1000
  return cachedTodoToken
}

// GET /api/calendar/tasks/create — create a Zoho ToDo task (pink on calendar)
router.get('/tasks/create', async (req, res) => {
  try {
    const { subject, dueDate, priority } = req.query
    if (!subject) return res.status(400).json({ error: 'subject is required' })
    const token = await getTodoAccessToken()
    // Format date as DD/MM/YYYY for Zoho ToDo
    const d = dueDate || new Date().toISOString().slice(0, 10)
    const [y, m, dd] = d.split('-')
    const body = { title: subject, dueDate: `${dd}/${m}/${y}` }
    if (priority === 'High') body.priority = '1'
    else body.priority = '2'
    const resp = await axios.post(ZOHO_TODO_API, body, {
      headers: { Authorization: `Zoho-oauthtoken ${token}`, 'Content-Type': 'application/json' }, timeout: 10000,
    })
    const taskId = resp.data?.data?.id
    console.log(`[calendar] Created ToDo: ${subject} → ${taskId}`)
    res.json({ success: true, taskId: String(taskId) })
  } catch (err) {
    console.error('[calendar] ToDo create error:', err.response?.data || err.message)
    res.status(500).json({ error: err.message })
  }
})

// PUT /api/calendar/tasks/:id — mark a ToDo as done
router.put('/tasks/:id', async (req, res) => {
  try {
    const token = await getTodoAccessToken()
    const updates = {}
    if (req.body.Subject) updates.title = req.body.Subject
    if (req.body.Status === 'Completed') updates.statusValue = 1
    await axios.put(`${ZOHO_TODO_API}/${req.params.id}`, updates, {
      headers: { Authorization: `Zoho-oauthtoken ${token}`, 'Content-Type': 'application/json' }, timeout: 10000,
    })
    res.json({ success: true })
  } catch (err) {
    console.error('[calendar] ToDo update error:', err.response?.data || err.message)
    res.status(500).json({ error: err.message })
  }
})

// DELETE /api/calendar/tasks/:id — delete a ToDo
router.delete('/tasks/:id', async (req, res) => {
  try {
    const token = await getTodoAccessToken()
    // Try personal first, then group
    try {
      await axios.delete(`${ZOHO_TODO_API}/${req.params.id}`, {
        headers: { Authorization: `Zoho-oauthtoken ${token}` }, timeout: 10000,
      })
    } catch {
      await axios.delete(`${ZOHO_TODO_GROUP_API}/${AR_GROUP_ID}/${req.params.id}`, {
        headers: { Authorization: `Zoho-oauthtoken ${token}` }, timeout: 10000,
      })
    }
    console.log(`[calendar] Deleted ToDo: ${req.params.id}`)
    res.json({ success: true })
  } catch (err) {
    console.error('[calendar] ToDo delete error:', err.response?.data || err.message)
    res.status(500).json({ error: err.message })
  }
})

// Zoho ToDo numeric user IDs for AR group members. Jayden does NOT have an active
// Zoho ToDo account, so his delegations are routed via Cliq DM (using his email).
const TODO_USER_IDS = {
  Mark: 858216366,
  Kat:  914153354,
  Kath: 914153354,
}

// GET /api/calendar/tasks/delegate — route delegation to the picked assignee.
// Kat → Zoho ToDo (Mark + Kat in AR group). Jayden → Cliq DM (no ToDo account).
router.get('/tasks/delegate', async (req, res) => {
  try {
    const { subject, dueDate, assignee } = req.query
    if (!subject) return res.status(400).json({ error: 'subject is required' })
    const assigneeName = (assignee || '').trim()

    // Jayden path: Cliq DM only (no Zoho ToDo). Awaited per Catalyst rule (no FF after res.json).
    if (/^jay(den)?$/i.test(assigneeName)) {
      const { postToCliqUser } = await import('../services/cliq.js')
      const text = `📋 *Delegation from Mark*\n${subject}${dueDate ? `\n_Due:_ ${dueDate}` : ''}`
      let cliqOk = false, cliqErr = null
      try { await postToCliqUser('jayden@absoluteadas.com', text); cliqOk = true }
      catch (e) { cliqErr = e.response?.data || e.message }
      console.log(`[calendar] Delegation to Jayden via Cliq: ${subject} — sent=${cliqOk}`)
      return res.json({ success: cliqOk, channel: 'cliq', assignee: 'Jayden', error: cliqErr || undefined })
    }

    // Kat (or default): Zoho ToDo in AR group, assigned to Mark + Kat
    const recipients = [TODO_USER_IDS.Mark]
    const assigneeId = TODO_USER_IDS[assigneeName]
    if (assigneeId && assigneeId !== TODO_USER_IDS.Mark) recipients.push(assigneeId)
    // Fallback: if no recognized assignee, default to Mark + Kat (back-compat with empty assignee)
    if (recipients.length === 1) recipients.push(TODO_USER_IDS.Kat)

    const token = await getTodoAccessToken()
    const d = dueDate || new Date().toISOString().slice(0, 10)
    const [y, m, dd] = d.split('-')
    const body = { title: subject, dueDate: `${dd}/${m}/${y}`, priority: '2' }
    const resp = await axios.post(`${ZOHO_TODO_GROUP_API}/${AR_GROUP_ID}`, body, {
      headers: { Authorization: `Zoho-oauthtoken ${token}`, 'Content-Type': 'application/json' }, timeout: 10000,
    })
    const taskId = resp.data?.data?.id

    let bulkOk = false
    try {
      await axios.put(`${ZOHO_TODO_GROUP_API}/${AR_GROUP_ID}/${taskId}`, { assignee: recipients }, {
        headers: { Authorization: `Zoho-oauthtoken ${token}`, 'Content-Type': 'application/json' }, timeout: 10000,
      })
      bulkOk = true
    } catch (assignErr) {
      console.warn('[calendar] Bulk assign failed, trying individually:', assignErr.response?.data?.data?.errorCode)
      for (const uid of recipients) {
        try {
          await axios.put(`${ZOHO_TODO_GROUP_API}/${AR_GROUP_ID}/${taskId}`, { assignee: uid }, {
            headers: { Authorization: `Zoho-oauthtoken ${token}`, 'Content-Type': 'application/json' }, timeout: 10000,
          })
        } catch {}
      }
    }

    console.log(`[calendar] AR delegation ${taskId}: assignee=${assigneeName} recipients=[${recipients.join(',')}] bulkOk=${bulkOk}`)
    res.json({ success: true, taskId: String(taskId), channel: 'zoho-todo', assignee: assigneeName, recipients })
  } catch (err) {
    console.error('[calendar] Delegate create error:', err.response?.data || err.message)
    res.status(500).json({ error: err.message })
  }
})

export default router
