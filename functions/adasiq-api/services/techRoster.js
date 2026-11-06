// Dispatch roster. The saved list is Settings → dispatch_contacts
// (the same rows SettingsScreen edits). Mark and Jayden are always
// present so live jobs in dispatched_jaden / dispatched_mark stay on
// the board. A new name gets dispatched_<first name>.
//
// Cliq (TECH_CLIQ_IDS) and Zoho (SALESPERSON_FULL_NAME) are not this
// list. A new person shows on the board without those lines.

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

export function techsFromContacts(contacts) {
  const rows = Array.isArray(contacts) ? contacts.filter(c => String(c?.name || '').trim() && !isOffice(c)) : []
  const use = rows.length ? rows : [
    { name: 'Mark', email: 'mf@absoluteadas.com' },
    { name: 'Jayden', email: 'jayden@absoluteadas.com' },
  ]
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

export async function readDispatchTechs(req) {
  try {
    const { getSettings } = await import('../routes/settings.js')
    const settings = await getSettings(req)
    return techsFromContacts(settings?.dispatch_contacts)
  } catch (e) {
    console.warn('[tech-roster] settings read failed:', e.message)
    return techsFromContacts(null)
  }
}

// Status to save for a technician, or null when they are not on the roster
// (Kat, blank). Jayden and a stored "Jaden" both return dispatched_jaden.
export async function statusIdForRoster(req, name) {
  const id = statusIdForTech(name)
  if (!id) return null
  const techs = await readDispatchTechs(req)
  const first = String(name || '').trim().split(/\s+/)[0].toLowerCase()
  const onRoster = techs.some(t => t.id === id || t.name.toLowerCase() === first)
  return onRoster ? id : null
}
