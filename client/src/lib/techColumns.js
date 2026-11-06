// Board columns from Settings → Dispatch Contacts. Same rules as
// functions/adasiq-api/services/techRoster.js. Mark and Jayden always
// stay. Jayden's stored status is dispatched_jaden.
import { useEffect, useState } from 'react'
import { API_BASE, apiFetch } from '../utils/api.js'

export function displayTechName(name) {
  const raw = String(name || '').trim()
  if (raw.toLowerCase() === 'jaden') return 'Jayden'
  return raw
}

export function statusIdForTech(name) {
  const first = String(name || '').trim().split(/\s+/)[0].toLowerCase().replace(/[^a-z0-9]/g, '')
  if (!first) return null
  if (first === 'jayden' || first === 'jaden') return 'dispatched_jaden'
  if (first === 'mark') return 'dispatched_mark'
  return `dispatched_${first}`
}

function firstName(name) {
  return displayTechName(name).split(/\s+/)[0] || ''
}

function isOffice(contact) {
  return /invoic|office|admin/i.test(String(contact?.role || ''))
}

export const DEFAULT_CONTACTS = [
  { name: 'Mark', email: 'mf@absoluteadas.com', phone: '' },
  { name: 'Jayden', email: 'jayden@absoluteadas.com', phone: '' },
]

export function techsFromContacts(contacts) {
  const rows = Array.isArray(contacts) ? contacts.filter(c => String(c?.name || '').trim() && !isOffice(c)) : []
  const use = rows.length ? rows : DEFAULT_CONTACTS
  const emailOf = (...keys) => {
    const hit = use.find(c => keys.includes(String(c?.name || '').trim().split(/\s+/)[0].toLowerCase()))
    return String(hit?.email || '').trim()
  }
  const pinned = [
    { id: 'dispatched_jaden', name: 'Jayden', email: emailOf('jayden', 'jaden') || 'jayden@absoluteadas.com', label: 'Dispatched to Jayden' },
    { id: 'dispatched_mark', name: 'Mark', email: emailOf('mark') || 'mf@absoluteadas.com', label: 'Dispatched to Mark' },
  ]
  const seen = new Set(pinned.map(t => t.id))
  const extra = []
  for (const c of use) {
    const id = statusIdForTech(c.name)
    if (!id || seen.has(id)) continue
    const name = firstName(c.name)
    if (!name) continue
    seen.add(id)
    extra.push({ id, name, email: String(c.email || '').trim(), label: `Dispatched to ${name}` })
  }
  return [...pinned, ...extra]
}

const FIXED_BEFORE = [
  { id: 'job_requested', label: 'Job Requested' },
  { id: 'need_dispatch', label: 'Need to Dispatch' },
]
const FIXED_AFTER = [
  { id: 'pending_parts', label: 'Pending / Waiting on Parts' },
  { id: 'ready_invoice', label: 'Ready to Invoice' },
  { id: 'complete', label: 'Completed' },
]

export function boardColumns(techs) {
  const list = techs?.length ? techs : techsFromContacts(null)
  return [
    ...FIXED_BEFORE,
    ...list.map(t => ({ id: t.id, label: t.label, tech: t.name })),
    ...FIXED_AFTER,
  ]
}

let cachedTechs = null
let inflight = null

export function clearDispatchTechCache() {
  cachedTechs = null
  inflight = null
}

async function loadDispatchTechs(force) {
  if (!force && cachedTechs) return cachedTechs
  if (!force && inflight) return inflight
  inflight = apiFetch(`${API_BASE}/api/settings`)
    .then(r => r.json())
    .then(d => {
      const techs = techsFromContacts(d?.settings?.dispatch_contacts)
      cachedTechs = techs
      return techs
    })
    .catch(() => {
      const techs = techsFromContacts(null)
      cachedTechs = techs
      return techs
    })
    .finally(() => { inflight = null })
  return inflight
}

export function useDispatchBoard() {
  const [techs, setTechs] = useState(() => cachedTechs || techsFromContacts(null))
  useEffect(() => {
    let dead = false
    const pull = () => loadDispatchTechs(true).then(t => { if (!dead) setTechs(t) })
    pull()
    window.addEventListener('adas:techs-changed', pull)
    return () => { dead = true; window.removeEventListener('adas:techs-changed', pull) }
  }, [])
  const columns = boardColumns(techs)
  const dispatchTech = Object.fromEntries(techs.map(t => [t.id, t.name]))
  return { techs, columns, dispatchTech }
}
