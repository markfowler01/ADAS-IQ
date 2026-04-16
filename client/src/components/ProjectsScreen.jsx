import { useState, useEffect, useCallback } from 'react'
import Navbar from './Navbar'
import { API_BASE, apiFetch, ORANGE, fmt } from './books/shared'

const PRIORITY_COLORS = {
  low:    { bg: '#f5f3f0', color: '#6b7280', label: 'Low' },
  medium: { bg: '#eff6ff', color: '#2563eb', label: 'Medium' },
  high:   { bg: '#fff7f5', color: '#CD4419', label: 'High' },
  urgent: { bg: '#fef2f2', color: '#dc2626', label: 'Urgent' },
}

const STATUS_COLORS = {
  todo:        { bg: '#f5f3f0', color: '#6b7280', label: 'To Do' },
  in_progress: { bg: '#eff6ff', color: '#2563eb', label: 'In Progress' },
  blocked:     { bg: '#fef2f2', color: '#b91c1c', label: 'Blocked' },
  done:        { bg: '#f0fdf4', color: '#15803d', label: 'Done' },
}

const PROJECT_ICONS = ['📋', '🎯', '🚀', '💼', '🏗️', '⚡', '🎨', '📊', '🔧', '🎪']
const PROJECT_COLORS = ['#CD4419', '#2563eb', '#16a34a', '#7c3aed', '#b45309', '#0e7490', '#db2777', '#1a1a1a']

export default function ProjectsScreen({ user, onLogout, currentScreen, onNavigate }) {
  const [projects, setProjects] = useState([])
  const [activeProject, setActiveProject] = useState(null)
  const [tasks, setTasks] = useState([])
  const [myTasks, setMyTasks] = useState(null)
  const [view, setView] = useState('list') // 'list', 'board', 'my'
  const [loading, setLoading] = useState(true)
  const [showProjectForm, setShowProjectForm] = useState(false)
  const [editingTask, setEditingTask] = useState(null)

  const loadProjects = useCallback(async () => {
    try {
      const r = await apiFetch(`${API_BASE}/api/projects/projects`).then(r => r.json())
      setProjects(Array.isArray(r) ? r : [])
      setLoading(false)
    } catch (e) { console.error(e); setLoading(false) }
  }, [])

  const loadTasks = useCallback(async (projectId) => {
    if (!projectId) return
    try {
      const r = await apiFetch(`${API_BASE}/api/projects/tasks?project_id=${projectId}`).then(r => r.json())
      setTasks(Array.isArray(r) ? r : [])
    } catch (e) { console.error(e) }
  }, [])

  const loadMyTasks = useCallback(async () => {
    try {
      const r = await apiFetch(`${API_BASE}/api/projects/my-tasks`).then(r => r.json())
      setMyTasks(r)
    } catch (e) { console.error(e) }
  }, [])

  useEffect(() => { loadProjects(); loadMyTasks() }, [loadProjects, loadMyTasks])
  useEffect(() => { if (activeProject) loadTasks(activeProject.id) }, [activeProject, loadTasks])

  async function createProject(data) {
    try {
      const r = await apiFetch(`${API_BASE}/api/projects/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!r.ok) throw new Error((await r.json()).error)
      setShowProjectForm(false)
      loadProjects()
    } catch (e) { alert(e.message) }
  }

  async function toggleTaskComplete(task) {
    try {
      await apiFetch(`${API_BASE}/api/projects/tasks/${task.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ completed: !task.completed }),
      })
      if (activeProject) loadTasks(activeProject.id)
      loadMyTasks()
    } catch (e) { alert(e.message) }
  }

  async function deleteTask(id) {
    if (!confirm('Delete this task?')) return
    try {
      await apiFetch(`${API_BASE}/api/projects/tasks/${id}`, { method: 'DELETE' })
      if (activeProject) loadTasks(activeProject.id)
      loadMyTasks()
    } catch (e) { alert(e.message) }
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#fafafa' }}>
      <Navbar user={user} onLogout={onLogout} currentScreen={currentScreen} onNavigate={onNavigate} />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">

        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold" style={{ color: '#1a1a1a' }}>Projects</h1>
            <p className="text-sm text-gray-500 mt-0.5">Manage projects, tasks, and team work</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setView(view === 'my' ? 'list' : 'my')}
              className="text-xs px-3 py-1.5 rounded-lg font-semibold"
              style={{ backgroundColor: view === 'my' ? ORANGE : '#f5f3f0', color: view === 'my' ? 'white' : '#555' }}>
              👤 My Tasks
            </button>
            <button onClick={() => setShowProjectForm(true)}
              className="text-sm px-4 py-2 rounded-lg font-semibold text-white"
              style={{ backgroundColor: ORANGE }}>
              + New Project
            </button>
          </div>
        </div>

        {view === 'my' ? (
          <MyTasksView myTasks={myTasks} onToggle={toggleTaskComplete} onEdit={setEditingTask} projects={projects} />
        ) : activeProject ? (
          <ProjectBoardView
            project={activeProject}
            tasks={tasks}
            user={user}
            onBack={() => setActiveProject(null)}
            onRefreshTasks={() => loadTasks(activeProject.id)}
            onToggle={toggleTaskComplete}
            onEdit={setEditingTask}
            onDelete={deleteTask}
          />
        ) : (
          <ProjectsListView projects={projects} loading={loading} onSelect={setActiveProject} />
        )}

        {showProjectForm && (
          <ProjectFormModal onClose={() => setShowProjectForm(false)} onSave={createProject} />
        )}

        {editingTask && (
          <TaskEditModal
            task={editingTask}
            project={projects.find(p => p.id === editingTask.project_id)}
            onClose={() => setEditingTask(null)}
            onSaved={() => {
              setEditingTask(null)
              if (activeProject) loadTasks(activeProject.id)
              loadMyTasks()
            }}
          />
        )}
      </div>
    </div>
  )
}

function ProjectsListView({ projects, loading, onSelect }) {
  if (loading) return <div className="py-16 text-center text-gray-400 text-sm">Loading…</div>
  if (projects.length === 0) {
    return (
      <div className="py-16 text-center">
        <p className="text-5xl mb-2">📋</p>
        <p className="text-gray-500 text-sm">No projects yet. Create your first one!</p>
      </div>
    )
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {projects.map(p => (
        <button key={p.id} onClick={() => onSelect(p)}
          className="rounded-xl border p-5 shadow-sm bg-white text-left transition-shadow hover:shadow-md"
          style={{ borderColor: '#f0ece8' }}>
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="text-2xl">{p.icon}</span>
              <span className="text-xs font-medium px-2 py-0.5 rounded-full"
                style={{ backgroundColor: p.color + '22', color: p.color }}>
                {p.status}
              </span>
            </div>
            {p.due_date && (
              <span className="text-xs text-gray-400">Due {p.due_date}</span>
            )}
          </div>
          <h3 className="text-base font-bold mb-1" style={{ color: '#1a1a1a' }}>{p.name}</h3>
          {p.description && (
            <p className="text-xs text-gray-500 line-clamp-2">{p.description}</p>
          )}
          <div className="flex items-center justify-between mt-3 pt-3 border-t" style={{ borderColor: '#f7f4f1' }}>
            <span className="text-xs text-gray-400">{(p.members || []).length + 1} member{(p.members || []).length !== 0 ? 's' : ''}</span>
            <span className="text-xs text-gray-400">{p.sections?.length || 0} sections</span>
          </div>
        </button>
      ))}
    </div>
  )
}

function ProjectBoardView({ project, tasks, user, onBack, onRefreshTasks, onToggle, onEdit, onDelete }) {
  const [showNewTask, setShowNewTask] = useState(false)
  const [newSectionId, setNewSectionId] = useState(null)

  async function createTask(data) {
    try {
      const r = await apiFetch(`${API_BASE}/api/projects/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...data, project_id: project.id }),
      })
      if (!r.ok) throw new Error((await r.json()).error)
      setShowNewTask(false)
      onRefreshTasks()
    } catch (e) { alert(e.message) }
  }

  const tasksBySection = {}
  for (const section of (project.sections || [])) {
    tasksBySection[section.id] = tasks.filter(t => t.section_id === section.id)
  }
  const unsectioned = tasks.filter(t => !t.section_id)

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onBack}
          className="text-sm font-medium" style={{ color: ORANGE }}>
          ← Back to projects
        </button>
      </div>

      <div className="rounded-xl bg-white border p-5 shadow-sm mb-5" style={{ borderColor: '#f0ece8' }}>
        <div className="flex items-start gap-3">
          <span className="text-3xl">{project.icon}</span>
          <div className="flex-1">
            <h2 className="text-xl font-bold" style={{ color: '#1a1a1a' }}>{project.name}</h2>
            {project.description && (
              <p className="text-sm text-gray-500 mt-1">{project.description}</p>
            )}
          </div>
          <button onClick={() => { setNewSectionId(project.sections?.[0]?.id); setShowNewTask(true) }}
            className="text-sm px-4 py-2 rounded-lg font-semibold text-white"
            style={{ backgroundColor: ORANGE }}>
            + Add Task
          </button>
        </div>
      </div>

      {/* Board view */}
      <div className="flex gap-4 overflow-x-auto pb-4">
        {(project.sections || []).map(section => (
          <div key={section.id} className="flex-shrink-0 w-72">
            <div className="rounded-xl bg-white border shadow-sm h-full flex flex-col" style={{ borderColor: '#f0ece8' }}>
              <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: '#f0ece8' }}>
                <h3 className="text-sm font-semibold" style={{ color: '#1a1a1a' }}>{section.name}</h3>
                <span className="text-xs text-gray-400">{(tasksBySection[section.id] || []).length}</span>
              </div>
              <div className="flex-1 p-2 space-y-2 min-h-[100px]">
                {(tasksBySection[section.id] || []).map(task => (
                  <TaskCard key={task.id} task={task} onToggle={onToggle} onEdit={onEdit} onDelete={onDelete} />
                ))}
                <button onClick={() => { setNewSectionId(section.id); setShowNewTask(true) }}
                  className="w-full py-2 text-xs text-gray-400 hover:text-gray-600 rounded-lg border-2 border-dashed"
                  style={{ borderColor: '#f0ece8' }}>
                  + Add task
                </button>
              </div>
            </div>
          </div>
        ))}
        {unsectioned.length > 0 && (
          <div className="flex-shrink-0 w-72">
            <div className="rounded-xl bg-white border shadow-sm" style={{ borderColor: '#f0ece8' }}>
              <div className="px-4 py-3 border-b" style={{ borderColor: '#f0ece8' }}>
                <h3 className="text-sm font-semibold text-gray-500">Unsectioned ({unsectioned.length})</h3>
              </div>
              <div className="p-2 space-y-2">
                {unsectioned.map(task => (
                  <TaskCard key={task.id} task={task} onToggle={onToggle} onEdit={onEdit} onDelete={onDelete} />
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {showNewTask && (
        <TaskFormModal
          sections={project.sections}
          defaultSectionId={newSectionId}
          onClose={() => setShowNewTask(false)}
          onSave={createTask}
        />
      )}
    </div>
  )
}

function TaskCard({ task, onToggle, onEdit, onDelete }) {
  const priority = PRIORITY_COLORS[task.priority] || PRIORITY_COLORS.medium
  const overdue = !task.completed && task.due_date && task.due_date < new Date().toISOString().slice(0, 10)
  return (
    <div className="rounded-lg border p-3 bg-white shadow-sm hover:shadow-md transition-shadow cursor-pointer"
      style={{ borderColor: overdue ? '#fecaca' : '#f0ece8' }}
      onClick={() => onEdit(task)}>
      <div className="flex items-start gap-2">
        <button onClick={e => { e.stopPropagation(); onToggle(task) }}
          className="flex-shrink-0 w-4 h-4 rounded border mt-0.5 flex items-center justify-center"
          style={{ backgroundColor: task.completed ? '#16a34a' : 'white', borderColor: task.completed ? '#16a34a' : '#e5e7eb' }}>
          {task.completed && <span className="text-white text-xs">✓</span>}
        </button>
        <div className="flex-1 min-w-0">
          <p className={`text-sm ${task.completed ? 'line-through text-gray-400' : 'text-gray-700'}`}>
            {task.title}
          </p>
          <div className="flex items-center gap-1 mt-1.5 flex-wrap">
            {task.priority && task.priority !== 'medium' && (
              <span className="text-xs px-1.5 py-0.5 rounded-full"
                style={{ backgroundColor: priority.bg, color: priority.color }}>
                {priority.label}
              </span>
            )}
            {task.due_date && (
              <span className="text-xs" style={{ color: overdue ? '#dc2626' : '#888' }}>
                📅 {task.due_date.slice(5)}
              </span>
            )}
            {(task.assignees || []).length > 0 && (
              <span className="text-xs text-gray-400">👤 {task.assignees.length}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function MyTasksView({ myTasks, onToggle, onEdit, projects }) {
  if (!myTasks) return <div className="py-16 text-center text-gray-400 text-sm">Loading…</div>

  const projectName = id => projects.find(p => p.id === id)?.name || '—'

  const sections = [
    { key: 'overdue', label: '🚨 Overdue', items: myTasks.overdue },
    { key: 'due_today', label: '🔥 Due Today', items: myTasks.due_today },
    { key: 'due_tomorrow', label: '⏰ Due Tomorrow', items: myTasks.due_tomorrow },
    { key: 'upcoming', label: '📅 Upcoming', items: myTasks.upcoming },
    { key: 'no_due_date', label: '📝 No Due Date', items: myTasks.no_due_date },
  ]

  const hasAny = sections.some(s => s.items?.length > 0)
  if (!hasAny) {
    return (
      <div className="py-16 text-center">
        <p className="text-5xl mb-2">🎉</p>
        <p className="text-gray-500 text-sm">All caught up — no tasks assigned to you!</p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {sections.map(section => section.items?.length > 0 && (
        <div key={section.key} className="rounded-xl border shadow-sm bg-white" style={{ borderColor: '#f0ece8' }}>
          <div className="px-5 py-3 border-b" style={{ borderColor: '#f0ece8' }}>
            <h3 className="text-sm font-semibold" style={{ color: '#1a1a1a' }}>
              {section.label} ({section.items.length})
            </h3>
          </div>
          <div className="divide-y" style={{ borderColor: '#f7f4f1' }}>
            {section.items.map(t => (
              <div key={t.id} className="px-5 py-2 flex items-center gap-3 hover:bg-gray-50 cursor-pointer"
                onClick={() => onEdit(t)}>
                <button onClick={e => { e.stopPropagation(); onToggle(t) }}
                  className="flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center"
                  style={{ backgroundColor: t.completed ? '#16a34a' : 'white', borderColor: t.completed ? '#16a34a' : '#e5e7eb' }}>
                  {t.completed && <span className="text-white text-xs">✓</span>}
                </button>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-700 truncate">{t.title}</p>
                  <p className="text-xs text-gray-400">{projectName(t.project_id)} {t.due_date && `· ${t.due_date}`}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function ProjectFormModal({ onClose, onSave }) {
  const [form, setForm] = useState({
    name: '', description: '', icon: '📋', color: '#CD4419',
    status: 'active', visibility: 'team',
  })

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="px-5 py-4 border-b" style={{ borderColor: '#f0ece8' }}>
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold">New Project</h2>
            <button onClick={onClose} className="text-gray-400">×</button>
          </div>
        </div>
        <div className="p-5 space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Project Name</label>
            <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              className="w-full border rounded-lg px-3 py-2 text-sm"
              style={{ borderColor: '#e5e7eb' }} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
            <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              rows="3" className="w-full border rounded-lg px-3 py-2 text-sm"
              style={{ borderColor: '#e5e7eb' }} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Icon</label>
              <div className="flex gap-1 flex-wrap">
                {PROJECT_ICONS.map(i => (
                  <button key={i} onClick={() => setForm(f => ({ ...f, icon: i }))}
                    className="w-8 h-8 rounded-lg text-lg flex items-center justify-center"
                    style={{ backgroundColor: form.icon === i ? '#f5f3f0' : 'white', border: '1px solid #e5e7eb' }}>
                    {i}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Color</label>
              <div className="flex gap-1 flex-wrap">
                {PROJECT_COLORS.map(c => (
                  <button key={c} onClick={() => setForm(f => ({ ...f, color: c }))}
                    className="w-8 h-8 rounded-lg"
                    style={{ backgroundColor: c, border: form.color === c ? '3px solid #1a1a1a' : 'none' }} />
                ))}
              </div>
            </div>
          </div>
        </div>
        <div className="px-5 py-4 border-t flex justify-end gap-2" style={{ borderColor: '#f0ece8' }}>
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm border" style={{ borderColor: '#e5e7eb' }}>
            Cancel
          </button>
          <button onClick={() => onSave(form)} disabled={!form.name.trim()}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-white"
            style={{ backgroundColor: ORANGE, opacity: form.name.trim() ? 1 : 0.5 }}>
            Create Project
          </button>
        </div>
      </div>
    </div>
  )
}

function TaskFormModal({ sections, defaultSectionId, onClose, onSave }) {
  const [form, setForm] = useState({
    title: '', description: '', priority: 'medium',
    section_id: defaultSectionId || sections?.[0]?.id || '',
    due_date: '', assignees: [],
  })

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="px-5 py-4 border-b" style={{ borderColor: '#f0ece8' }}>
          <h2 className="text-lg font-bold">New Task</h2>
        </div>
        <div className="p-5 space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Title</label>
            <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              autoFocus className="w-full border rounded-lg px-3 py-2 text-sm"
              style={{ borderColor: '#e5e7eb' }} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
            <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              rows="2" className="w-full border rounded-lg px-3 py-2 text-sm"
              style={{ borderColor: '#e5e7eb' }} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Section</label>
              <select value={form.section_id} onChange={e => setForm(f => ({ ...f, section_id: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: '#e5e7eb' }}>
                {(sections || []).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Priority</label>
              <select value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: '#e5e7eb' }}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Due Date</label>
            <input type="date" value={form.due_date}
              onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))}
              className="w-full border rounded-lg px-3 py-2 text-sm"
              style={{ borderColor: '#e5e7eb' }} />
          </div>
        </div>
        <div className="px-5 py-4 border-t flex justify-end gap-2" style={{ borderColor: '#f0ece8' }}>
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm border" style={{ borderColor: '#e5e7eb' }}>
            Cancel
          </button>
          <button onClick={() => onSave(form)} disabled={!form.title.trim()}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-white"
            style={{ backgroundColor: ORANGE, opacity: form.title.trim() ? 1 : 0.5 }}>
            Create Task
          </button>
        </div>
      </div>
    </div>
  )
}

function TaskEditModal({ task, project, onClose, onSaved }) {
  const [form, setForm] = useState(task)
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    try {
      await apiFetch(`${API_BASE}/api/projects/tasks/${task.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      onSaved()
    } catch (e) { alert(e.message) }
    finally { setSaving(false) }
  }

  const pri = PRIORITY_COLORS[form.priority] || PRIORITY_COLORS.medium
  const st = STATUS_COLORS[form.status] || STATUS_COLORS.todo

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-xl w-full max-h-[90vh] overflow-y-auto">
        <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: '#f0ece8' }}>
          <h2 className="text-lg font-bold">Edit Task</h2>
          <button onClick={onClose} className="text-gray-400">×</button>
        </div>
        <div className="p-5 space-y-3">
          <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
            className="w-full text-lg font-semibold border-0 border-b py-2 focus:outline-none"
            style={{ borderColor: '#e5e7eb' }} />
          <textarea value={form.description || ''}
            onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            rows="4" placeholder="Add description…"
            className="w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: '#e5e7eb' }} />

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Status</label>
              <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
                className="w-full border rounded-lg px-2 py-1.5 text-sm" style={{ borderColor: '#e5e7eb' }}>
                <option value="todo">To Do</option>
                <option value="in_progress">In Progress</option>
                <option value="blocked">Blocked</option>
                <option value="done">Done</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Priority</label>
              <select value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}
                className="w-full border rounded-lg px-2 py-1.5 text-sm" style={{ borderColor: '#e5e7eb' }}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Due</label>
              <input type="date" value={form.due_date || ''}
                onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))}
                className="w-full border rounded-lg px-2 py-1.5 text-sm" style={{ borderColor: '#e5e7eb' }} />
            </div>
          </div>

          {project?.sections && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Section</label>
              <select value={form.section_id || ''}
                onChange={e => setForm(f => ({ ...f, section_id: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: '#e5e7eb' }}>
                <option value="">— None —</option>
                {project.sections.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          )}

          {form.comments?.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Comments</label>
              <div className="space-y-2 max-h-40 overflow-y-auto">
                {form.comments.map(c => (
                  <div key={c.id} className="bg-gray-50 rounded-lg p-2 text-xs">
                    <div className="flex justify-between mb-1">
                      <strong>{c.author_name}</strong>
                      <span className="text-gray-400">{new Date(c.created_at).toLocaleDateString()}</span>
                    </div>
                    <p className="text-gray-700">{c.text}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="px-5 py-4 border-t flex justify-end gap-2" style={{ borderColor: '#f0ece8' }}>
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm border" style={{ borderColor: '#e5e7eb' }}>
            Cancel
          </button>
          <button onClick={save} disabled={saving}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-white"
            style={{ backgroundColor: ORANGE, opacity: saving ? 0.6 : 1 }}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
