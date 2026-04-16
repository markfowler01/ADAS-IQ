import express from 'express'
import catalyst from 'zcatalyst-sdk-node'

const router = express.Router()

// ── Cache helpers ────────────────────────────────────────────────────────────

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

// ── Helpers ──────────────────────────────────────────────────────────────────

function getUserId(req) {
  return req.user?.email || req.user?.id || req.user?.name || 'unknown'
}

function getUserName(req) {
  return req.user?.name || req.user?.email || 'Unknown'
}

function isAdmin(req) {
  return req.user?.role !== 'technician'
}

function newId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

async function readProjects(req) {
  const segment = getSegment(req)
  return await cacheGet(segment, 'pm_projects', []) || []
}

async function writeProjects(req, projects) {
  const segment = getSegment(req)
  await cacheSet(segment, 'pm_projects', projects)
}

async function readTasks(req) {
  const segment = getSegment(req)
  return await cacheGet(segment, 'pm_tasks', []) || []
}

async function writeTasks(req, tasks) {
  const segment = getSegment(req)
  await cacheSet(segment, 'pm_tasks', tasks)
}

// ── Projects ─────────────────────────────────────────────────────────────────

router.get('/projects', async (req, res) => {
  try {
    const projects = await readProjects(req)
    const userId = getUserId(req)
    // Filter by visibility: user is owner, member, or admin
    const visible = projects.filter(p =>
      isAdmin(req) ||
      p.owner_id === userId ||
      (p.members || []).includes(userId) ||
      p.visibility === 'public'
    )
    res.json(visible.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')))
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.get('/projects/:id', async (req, res) => {
  try {
    const projects = await readProjects(req)
    const project = projects.find(p => p.id === req.params.id)
    if (!project) return res.status(404).json({ error: 'Not found' })
    res.json(project)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.post('/projects', async (req, res) => {
  try {
    const projects = await readProjects(req)
    const project = {
      id: newId('proj'),
      name: req.body.name || 'Untitled Project',
      description: req.body.description || '',
      color: req.body.color || '#CD4419',
      icon: req.body.icon || '📋',
      status: req.body.status || 'active',  // active, on_hold, complete, archived
      visibility: req.body.visibility || 'team',  // private, team, public
      owner_id: getUserId(req),
      owner_name: getUserName(req),
      members: Array.isArray(req.body.members) ? req.body.members : [],
      sections: Array.isArray(req.body.sections) ? req.body.sections : [
        { id: newId('sec'), name: 'To Do' },
        { id: newId('sec'), name: 'In Progress' },
        { id: newId('sec'), name: 'Done' },
      ],
      due_date: req.body.due_date || '',
      tags: Array.isArray(req.body.tags) ? req.body.tags : [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    projects.push(project)
    await writeProjects(req, projects)
    res.json(project)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.put('/projects/:id', async (req, res) => {
  try {
    const projects = await readProjects(req)
    const idx = projects.findIndex(p => p.id === req.params.id)
    if (idx < 0) return res.status(404).json({ error: 'Not found' })

    const userId = getUserId(req)
    if (!isAdmin(req) && projects[idx].owner_id !== userId) {
      return res.status(403).json({ error: 'Only owner or admin can edit' })
    }

    const allowed = ['name', 'description', 'color', 'icon', 'status', 'visibility', 'members', 'sections', 'due_date', 'tags']
    for (const f of allowed) {
      if (req.body[f] !== undefined) projects[idx][f] = req.body[f]
    }
    projects[idx].updated_at = new Date().toISOString()
    await writeProjects(req, projects)
    res.json(projects[idx])
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.delete('/projects/:id', async (req, res) => {
  try {
    const projects = await readProjects(req)
    const project = projects.find(p => p.id === req.params.id)
    if (!project) return res.status(404).json({ error: 'Not found' })
    const userId = getUserId(req)
    if (!isAdmin(req) && project.owner_id !== userId) {
      return res.status(403).json({ error: 'Only owner or admin can delete' })
    }
    const remaining = projects.filter(p => p.id !== req.params.id)
    await writeProjects(req, remaining)
    // Also delete tasks in this project
    const tasks = await readTasks(req)
    const taskRemaining = tasks.filter(t => t.project_id !== req.params.id)
    await writeTasks(req, taskRemaining)
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── Tasks ────────────────────────────────────────────────────────────────────

router.get('/tasks', async (req, res) => {
  try {
    const tasks = await readTasks(req)
    const { project_id, assigned_to, status, due_before } = req.query
    const userId = getUserId(req)

    let filtered = tasks
    if (project_id) filtered = filtered.filter(t => t.project_id === project_id)
    if (assigned_to === 'me') filtered = filtered.filter(t => (t.assignees || []).includes(userId))
    else if (assigned_to) filtered = filtered.filter(t => (t.assignees || []).includes(assigned_to))
    if (status) filtered = filtered.filter(t => t.status === status)
    if (due_before) filtered = filtered.filter(t => t.due_date && t.due_date <= due_before)

    filtered.sort((a, b) => {
      // Incomplete first, then by due date, then by created
      if (a.completed !== b.completed) return a.completed ? 1 : -1
      if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date)
      if (a.due_date) return -1
      if (b.due_date) return 1
      return (b.created_at || '').localeCompare(a.created_at || '')
    })
    res.json(filtered)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.get('/tasks/:id', async (req, res) => {
  try {
    const tasks = await readTasks(req)
    const task = tasks.find(t => t.id === req.params.id)
    if (!task) return res.status(404).json({ error: 'Not found' })
    res.json(task)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.post('/tasks', async (req, res) => {
  try {
    const tasks = await readTasks(req)
    const task = {
      id: newId('task'),
      project_id: req.body.project_id || '',
      section_id: req.body.section_id || '',
      title: req.body.title || 'Untitled Task',
      description: req.body.description || '',
      status: req.body.status || 'todo',  // todo, in_progress, blocked, done
      priority: req.body.priority || 'medium',  // low, medium, high, urgent
      assignees: Array.isArray(req.body.assignees) ? req.body.assignees : [],
      created_by: getUserId(req),
      created_by_name: getUserName(req),
      due_date: req.body.due_date || '',
      start_date: req.body.start_date || '',
      tags: Array.isArray(req.body.tags) ? req.body.tags : [],
      subtasks: Array.isArray(req.body.subtasks) ? req.body.subtasks : [],
      comments: [],
      completed: false,
      completed_at: null,
      completed_by: '',
      order: req.body.order || 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    tasks.push(task)
    await writeTasks(req, tasks)
    res.json(task)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.put('/tasks/:id', async (req, res) => {
  try {
    const tasks = await readTasks(req)
    const idx = tasks.findIndex(t => t.id === req.params.id)
    if (idx < 0) return res.status(404).json({ error: 'Not found' })

    const allowed = ['project_id', 'section_id', 'title', 'description', 'status',
      'priority', 'assignees', 'due_date', 'start_date', 'tags', 'subtasks', 'order']
    for (const f of allowed) {
      if (req.body[f] !== undefined) tasks[idx][f] = req.body[f]
    }
    // Handle completion transition
    if (req.body.completed !== undefined && req.body.completed !== tasks[idx].completed) {
      tasks[idx].completed = !!req.body.completed
      if (tasks[idx].completed) {
        tasks[idx].completed_at = new Date().toISOString()
        tasks[idx].completed_by = getUserId(req)
        tasks[idx].status = 'done'
      } else {
        tasks[idx].completed_at = null
        tasks[idx].completed_by = ''
        if (tasks[idx].status === 'done') tasks[idx].status = 'todo'
      }
    }
    tasks[idx].updated_at = new Date().toISOString()
    await writeTasks(req, tasks)
    res.json(tasks[idx])
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.delete('/tasks/:id', async (req, res) => {
  try {
    const tasks = await readTasks(req)
    const remaining = tasks.filter(t => t.id !== req.params.id)
    await writeTasks(req, remaining)
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Add comment to task
router.post('/tasks/:id/comments', async (req, res) => {
  try {
    const tasks = await readTasks(req)
    const task = tasks.find(t => t.id === req.params.id)
    if (!task) return res.status(404).json({ error: 'Not found' })
    task.comments = task.comments || []
    task.comments.push({
      id: newId('cmt'),
      text: req.body.text || '',
      author_id: getUserId(req),
      author_name: getUserName(req),
      created_at: new Date().toISOString(),
    })
    task.updated_at = new Date().toISOString()
    await writeTasks(req, tasks)
    res.json(task)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// My tasks summary
router.get('/my-tasks', async (req, res) => {
  try {
    const tasks = await readTasks(req)
    const userId = getUserId(req)
    const mine = tasks.filter(t => (t.assignees || []).includes(userId))

    const today = new Date().toISOString().slice(0, 10)
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

    res.json({
      overdue: mine.filter(t => !t.completed && t.due_date && t.due_date < today),
      due_today: mine.filter(t => !t.completed && t.due_date === today),
      due_tomorrow: mine.filter(t => !t.completed && t.due_date === tomorrow),
      upcoming: mine.filter(t => !t.completed && t.due_date && t.due_date > tomorrow),
      no_due_date: mine.filter(t => !t.completed && !t.due_date),
      completed_recent: mine.filter(t => t.completed && t.completed_at >
        new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()),
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

export default router
