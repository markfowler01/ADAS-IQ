import express from 'express'
import catalyst from 'zcatalyst-sdk-node'

const router = express.Router()

function getSegment(req) {
  return catalyst.initialize(req).cache().segment()
}

function isNotFound(e) {
  return e?.statusCode === 404 || e?.errorInfo?.statusCode === 404
}

async function cacheSet(segment, key, value) {
  const str = typeof value === 'string' ? value : JSON.stringify(value)
  try { await segment.update(key, str) }
  catch (e) { await segment.put(key, str) }
}

async function cacheGet(segment, key, fallback = null) {
  try {
    const val = await segment.getValue(key)
    return val ? JSON.parse(val) : fallback
  } catch (e) {
    if (isNotFound(e)) return fallback
    throw e
  }
}

function getUserId(req) {
  return req.user?.email || req.user?.id || req.user?.name || 'unknown'
}

function isAdmin(req) {
  return req.user?.role !== 'technician'
}

function newId() {
  return `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

const DEFAULT_MEMBERS = [
  {
    id: 'mem_mark',
    user_id: 'mark@absoluteadas.com',
    name: 'Mark Fowler',
    email: 'mark@absoluteadas.com',
    phone: '',
    role: 'owner',     // owner, admin, manager, technician, office
    title: 'Owner',
    department: 'Operations',
    hire_date: '',
    region: '',
    hourly_rate: 0,
    active: true,
    avatar_color: '#CD4419',
    notes: '',
    emergency_contact: { name: '', phone: '', relationship: '' },
    created_at: new Date().toISOString(),
  },
]

// ── Endpoints ────────────────────────────────────────────────────────────────

router.get('/members', async (req, res) => {
  try {
    const segment = getSegment(req)
    let members = await cacheGet(segment, 'team_members', null)
    if (!members) {
      members = DEFAULT_MEMBERS
      await cacheSet(segment, 'team_members', members)
    }
    // Techs see everyone but limited fields; admin sees all
    if (!isAdmin(req)) {
      members = members.filter(m => m.active).map(m => ({
        id: m.id, user_id: m.user_id, name: m.name, email: m.email,
        title: m.title, department: m.department, role: m.role,
        avatar_color: m.avatar_color, region: m.region,
      }))
    }
    res.json(members)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.get('/members/me', async (req, res) => {
  try {
    const segment = getSegment(req)
    const members = await cacheGet(segment, 'team_members', DEFAULT_MEMBERS)
    const userId = getUserId(req)
    const me = members.find(m => m.user_id === userId || m.email === userId)
    res.json(me || null)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.post('/members', async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' })
    const segment = getSegment(req)
    const members = await cacheGet(segment, 'team_members', [])

    const colors = ['#CD4419', '#2563eb', '#16a34a', '#7c3aed', '#b45309', '#0e7490', '#db2777', '#0891b2']

    const member = {
      id: newId(),
      user_id: req.body.user_id || req.body.email || '',
      name: req.body.name || '',
      email: req.body.email || '',
      phone: req.body.phone || '',
      role: req.body.role || 'technician',
      title: req.body.title || '',
      department: req.body.department || '',
      hire_date: req.body.hire_date || '',
      region: req.body.region || '',
      hourly_rate: Number(req.body.hourly_rate) || 0,
      active: req.body.active !== false,
      avatar_color: req.body.avatar_color || colors[members.length % colors.length],
      notes: req.body.notes || '',
      emergency_contact: req.body.emergency_contact || { name: '', phone: '', relationship: '' },
      created_at: new Date().toISOString(),
    }
    members.push(member)
    await cacheSet(segment, 'team_members', members)
    res.json(member)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.put('/members/:id', async (req, res) => {
  try {
    const segment = getSegment(req)
    const members = await cacheGet(segment, 'team_members', [])
    const idx = members.findIndex(m => m.id === req.params.id)
    if (idx < 0) return res.status(404).json({ error: 'Not found' })

    const userId = getUserId(req)
    const targetMember = members[idx]
    const editingSelf = targetMember.user_id === userId || targetMember.email === userId
    if (!isAdmin(req) && !editingSelf) {
      return res.status(403).json({ error: 'Not authorized' })
    }

    // Non-admins can only edit a few fields
    const allowedForUser = ['phone', 'emergency_contact', 'avatar_color']
    const allowedForAdmin = [...allowedForUser, 'user_id', 'name', 'email', 'role', 'title',
      'department', 'hire_date', 'region', 'hourly_rate', 'active', 'notes']
    const allowed = isAdmin(req) ? allowedForAdmin : allowedForUser

    for (const f of allowed) {
      if (req.body[f] !== undefined) members[idx][f] = req.body[f]
    }

    await cacheSet(segment, 'team_members', members)
    res.json(members[idx])
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.delete('/members/:id', async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' })
    const segment = getSegment(req)
    const members = await cacheGet(segment, 'team_members', [])
    const remaining = members.filter(m => m.id !== req.params.id)
    await cacheSet(segment, 'team_members', remaining)
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── Announcements ────────────────────────────────────────────────────────────

router.get('/announcements', async (req, res) => {
  try {
    const segment = getSegment(req)
    const ann = await cacheGet(segment, 'announcements', []) || []
    // Filter out expired
    const now = new Date().toISOString()
    const active = ann.filter(a => !a.expires_at || a.expires_at >= now)
    active.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)
      || (b.created_at || '').localeCompare(a.created_at || ''))
    res.json(active)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.post('/announcements', async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' })
    const segment = getSegment(req)
    const ann = await cacheGet(segment, 'announcements', []) || []
    const entry = {
      id: `ann_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      title: req.body.title || 'Announcement',
      body: req.body.body || '',
      priority: req.body.priority || 'normal',  // normal, high, urgent
      audience: req.body.audience || 'all',  // all, technicians, admins, office
      pinned: !!req.body.pinned,
      expires_at: req.body.expires_at || '',
      author_id: getUserId(req),
      author_name: req.user?.name || getUserId(req),
      created_at: new Date().toISOString(),
      reads: [],  // array of user_ids
    }
    ann.unshift(entry)
    await cacheSet(segment, 'announcements', ann)
    res.json(entry)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.put('/announcements/:id', async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' })
    const segment = getSegment(req)
    const ann = await cacheGet(segment, 'announcements', [])
    const idx = ann.findIndex(a => a.id === req.params.id)
    if (idx < 0) return res.status(404).json({ error: 'Not found' })
    const allowed = ['title', 'body', 'priority', 'audience', 'pinned', 'expires_at']
    for (const f of allowed) {
      if (req.body[f] !== undefined) ann[idx][f] = req.body[f]
    }
    await cacheSet(segment, 'announcements', ann)
    res.json(ann[idx])
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.delete('/announcements/:id', async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' })
    const segment = getSegment(req)
    const ann = await cacheGet(segment, 'announcements', [])
    const remaining = ann.filter(a => a.id !== req.params.id)
    await cacheSet(segment, 'announcements', remaining)
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.post('/announcements/:id/read', async (req, res) => {
  try {
    const segment = getSegment(req)
    const ann = await cacheGet(segment, 'announcements', [])
    const entry = ann.find(a => a.id === req.params.id)
    if (!entry) return res.status(404).json({ error: 'Not found' })
    const userId = getUserId(req)
    entry.reads = entry.reads || []
    if (!entry.reads.includes(userId)) entry.reads.push(userId)
    await cacheSet(segment, 'announcements', ann)
    res.json(entry)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

export default router
