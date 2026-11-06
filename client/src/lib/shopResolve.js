// Client twin of functions/adasiq-api/services/shopResolve.js — keep the
// stop list in sync. Used to group library chips when two letterhead
// spellings are the same shop (Express Collision Repair LLC = Express Auto Body & Paint).
const STOP = new Set([
  'the', 'a', 'an', 'and', 'of', 'at', 'for', 'in',
  'auto', 'automotive', 'body', 'bodyshop', 'shop',
  'collision', 'repair', 'repairs', 'paint', 'rebuild', 'rebuilders', 'rebuilding',
  'center', 'centre', 'works',
  'inc', 'llc', 'llp', 'co', 'corp', 'corporation', 'company', 'ltd', 'dba',
])

export function shopKey(name) {
  return String(name || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '')
}

// Same store-code cleanup as services/shopResolve.js.
function stripStoreCodes(name) {
  return String(name || '')
    .replace(/\(([^)]*)\)/g, (full, inner) => {
      const t = String(inner || '').trim()
      if (/^[A-Za-z0-9]{2,6}$/.test(t) && (/\d/.test(t) || /^[A-Z]{2,4}$/.test(t))) return ' '
      return full
    })
    .replace(/\s*[-–—]\s*[A-Za-z]*\d[A-Za-z0-9]{0,8}\s*$/, ' ')
}

export function shopTokens(name) {
  return stripStoreCodes(name).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/).filter(w => w && !STOP.has(w))
}

export function shopCoreKey(name) {
  return shopTokens(name).join('')
}
