// Pure rules for the time clock store.
// A save is a union. It can update a punch it was given and drop a punch
// only when the caller names that punch. It can never turn a failed read
// into an empty month.

export const TEXT_MAX = 9000

export function parseBucket(raw, key = 'timeclock') {
  if (raw == null || raw === '') return []
  let value
  try { value = JSON.parse(raw) }
  catch {
    throw new Error(`time clock row ${key} is unreadable — left untouched`)
  }
  if (!Array.isArray(value)) {
    throw new Error(`time clock row ${key} is not a list — left untouched`)
  }
  return value
}

// Incoming wins on the same id. Ids only in `existing` stay.
// Ids in dropIds are removed even if incoming still carries them.
export function unionEntries(existing, incoming, dropIds = []) {
  const drop = new Set(dropIds || [])
  const map = new Map()
  for (const entry of existing || []) {
    if (!entry?.id || drop.has(entry.id)) continue
    map.set(entry.id, entry)
  }
  for (const entry of incoming || []) {
    if (!entry?.id || drop.has(entry.id)) continue
    map.set(entry.id, entry)
  }
  return [...map.values()]
}

// Restore path: keep the live punch, add backup punches the live store lost.
export function addMissingEntries(existing, incoming) {
  const map = new Map()
  for (const entry of existing || []) if (entry?.id) map.set(entry.id, entry)
  let added = 0
  for (const entry of incoming || []) {
    if (!entry?.id || map.has(entry.id)) continue
    map.set(entry.id, entry)
    added += 1
  }
  return { entries: [...map.values()], added }
}

export function punchesThatWouldBeLost(oldList, nextIds, dropIds = []) {
  const next = nextIds instanceof Set ? nextIds : new Set(nextIds || [])
  const drop = new Set(dropIds || [])
  return (oldList || []).filter(entry => entry?.id && !drop.has(entry.id) && !next.has(entry.id))
}

// Split a person-month so one AppConfig text cell stays under TEXT_MAX.
// First piece keeps `key`. Later pieces are `key~2`, `key~3`, …
export function packLists(entriesByKey) {
  const out = {}
  for (const [key, list] of Object.entries(entriesByKey || {})) {
    let chunk = []
    let n = 0
    const flush = () => {
      n += 1
      out[n === 1 ? key : `${key}~${n}`] = chunk
      chunk = []
    }
    for (const entry of list || []) {
      const trial = chunk.concat([entry])
      if (JSON.stringify(trial).length > TEXT_MAX && chunk.length) {
        flush()
        chunk = [entry]
        if (JSON.stringify(chunk).length > TEXT_MAX) {
          throw new Error(`one punch is bigger than the save limit (${key})`)
        }
      } else {
        chunk = trial
      }
    }
    if (chunk.length || n === 0) flush()
  }
  return out
}
