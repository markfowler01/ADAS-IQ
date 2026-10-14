// Shop portal accounts (Mark 2026-10-09). Username + password we issue —
// no Zoho, no self-signup. Lives on the CRM shop as billing_rules.portal_users
// so it survives Cache TTL and does not need a new Datastore table.
import crypto from 'crypto'
import { getAllShops, updateShop } from '../routes/shops.js'

const SCRYPT_N = 16384
const SCRYPT_R = 8
const SCRYPT_P = 1
const KEYLEN = 32
const LOCK_AFTER = 8
const LOCK_MS = 15 * 60 * 1000

export function normalizeRole(raw) {
  const r = String(raw || '').toLowerCase()
  if (r === 'owner') return 'owner'
  return 'estimator'
}

export function isPortalOwner(user, shop) {
  if (!user) return false
  if (normalizeRole(user.role) === 'owner') return true
  if (!shop) return false
  const list = usersOf(shop).filter(u => u.active !== false)
  return list.length === 1 && String(list[0].id) === String(user.id)
}

export function publicUser(u, shop) {
  if (!u) return null
  return {
    id: u.id,
    username: u.username,
    name: u.name || '',
    email: u.email || '',
    role: isPortalOwner(u, shop) ? 'owner' : 'estimator',
    active: u.active !== false,
    must_change: !!u.must_change,
    created_at: u.created_at || '',
    created_by: u.created_by || '',
    last_login: u.last_login || '',
  }
}

export function redactPortalSecrets(shop) {
  if (!shop?.billing_rules?.portal_users) return shop
  return {
    ...shop,
    billing_rules: {
      ...shop.billing_rules,
      portal_users: (shop.billing_rules.portal_users || []).map(u => publicUser(u, shop)),
    },
  }
}

function parseBR(shop) {
  const br = shop?.billing_rules
  if (!br) return {}
  if (typeof br === 'string') { try { return JSON.parse(br) || {} } catch { return {} } }
  return typeof br === 'object' && br ? br : {}
}

export function usersOf(shop) {
  const list = parseBR(shop).portal_users
  return Array.isArray(list) ? list : []
}

function slug(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '').slice(0, 24)
}

export function suggestUsername(name, shopName) {
  const person = slug(name).split('.')[0] || 'user'
  const shop = slug(shopName).split('.')[0] || 'shop'
  return `${person}.${shop}`.slice(0, 32)
}

export function normalizeUsername(raw) {
  const u = String(raw || '').trim().toLowerCase()
  if (!/^[a-z][a-z0-9._-]{2,31}$/.test(u)) return ''
  return u
}

export function hashPassword(password) {
  const salt = crypto.randomBytes(16)
  const hash = crypto.scryptSync(String(password), salt, KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P })
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64url')}$${hash.toString('base64url')}`
}

export function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$')
  if (parts[0] !== 'scrypt' || parts.length !== 6) return false
  const N = Number(parts[1]), r = Number(parts[2]), p = Number(parts[3])
  const salt = Buffer.from(parts[4], 'base64url')
  const want = Buffer.from(parts[5], 'base64url')
  const got = crypto.scryptSync(String(password), salt, want.length, { N, r, p })
  return got.length === want.length && crypto.timingSafeEqual(got, want)
}

export function tempPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let out = ''
  const bytes = crypto.randomBytes(10)
  for (let i = 0; i < 10; i++) out += chars[bytes[i] % chars.length]
  return `${out.slice(0, 5)}-${out.slice(5)}`
}

async function writeUsers(req, shop, users) {
  const br = { ...parseBR(shop), portal_users: users }
  return updateShop(req, shop.id, { ...shop, billing_rules: br, _replacePortalUsers: true })
}

function findUserEverywhere(shops, username) {
  const u = normalizeUsername(username)
  if (!u) return null
  for (const shop of shops) {
    const user = usersOf(shop).find(x => x.username === u)
    if (user) return { shop, user }
  }
  return null
}

export async function listPortalUsers(req, shopId) {
  const shops = await getAllShops(req)
  const shop = shops.find(s => String(s.id) === String(shopId))
  if (!shop) return { ok: false, error: 'shop not found', status: 404 }
  return { ok: true, shop_id: shop.id, shop_name: shop.shop_name, users: usersOf(shop).map(u => publicUser(u, shop)) }
}

export async function createPortalUser(req, shopId, raw, by = '') {
  const shops = await getAllShops(req)
  const shop = shops.find(s => String(s.id) === String(shopId))
  if (!shop) return { ok: false, error: 'shop not found', status: 404 }
  const name = String(raw.name || '').trim().slice(0, 80)
  const email = String(raw.email || '').trim().toLowerCase().slice(0, 120)
  let username = normalizeUsername(raw.username) || normalizeUsername(suggestUsername(name || email, shop.shop_name))
  if (!username) return { ok: false, error: 'Pick a username (letters, numbers, . _ -)', status: 400 }
  if (findUserEverywhere(shops, username)) return { ok: false, error: `Username "${username}" is already taken`, status: 409 }
  const password = String(raw.password || '').trim() || tempPassword()
  if (password.length < 8) return { ok: false, error: 'Password must be at least 8 characters', status: 400 }
  const user = {
    id: `pu_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`,
    username,
    password_hash: hashPassword(password),
    name,
    email,
    role: usersOf(shop).length === 0 ? 'owner' : normalizeRole(raw.role),
    active: true,
    must_change: raw.must_change !== false,
    created_at: new Date().toISOString(),
    created_by: String(by || '').slice(0, 80),
    failed_n: 0,
    failed_at: '',
    last_login: '',
  }
  const users = [...usersOf(shop), user]
  await writeUsers(req, shop, users)
  return { ok: true, user: publicUser(user, shop), password, shop_name: shop.shop_name }
}

export async function patchPortalUser(req, shopId, userId, raw, by = '') {
  const shops = await getAllShops(req)
  const shop = shops.find(s => String(s.id) === String(shopId))
  if (!shop) return { ok: false, error: 'shop not found', status: 404 }
  const users = usersOf(shop)
  const i = users.findIndex(u => String(u.id) === String(userId))
  if (i < 0) return { ok: false, error: 'user not found', status: 404 }
  const next = { ...users[i] }
  if (raw.name != null) next.name = String(raw.name).trim().slice(0, 80)
  if (raw.email != null) next.email = String(raw.email).trim().toLowerCase().slice(0, 120)
  if (raw.role === 'owner' || raw.role === 'estimator' || raw.role === 'office') next.role = normalizeRole(raw.role)
  if (raw.active === true || raw.active === false) next.active = raw.active
  let password = ''
  if (raw.reset_password) {
    password = tempPassword()
    next.password_hash = hashPassword(password)
    next.must_change = true
    next.failed_n = 0
    next.failed_at = ''
  }
  if (raw.username) {
    const username = normalizeUsername(raw.username)
    if (!username) return { ok: false, error: 'Bad username', status: 400 }
    const clash = findUserEverywhere(shops, username)
    if (clash && clash.user.id !== next.id) return { ok: false, error: `Username "${username}" is already taken`, status: 409 }
    next.username = username
  }
  users[i] = next
  await writeUsers(req, shop, users)
  return { ok: true, user: publicUser(next, shop), ...(password ? { password } : {}), by }
}

export async function deletePortalUser(req, shopId, userId) {
  const shops = await getAllShops(req)
  const shop = shops.find(s => String(s.id) === String(shopId))
  if (!shop) return { ok: false, error: 'shop not found', status: 404 }
  const users = usersOf(shop).filter(u => String(u.id) !== String(userId))
  await writeUsers(req, shop, users)
  return { ok: true }
}

export async function loginPortalUser(req, username, password) {
  const shops = await getAllShops(req)
  const hit = findUserEverywhere(shops, username)
  // Dummy hash so a missing user costs about the same as a real check.
  if (!hit) {
    verifyPassword(password || 'x', hashPassword('timing'))
    return { ok: false, error: 'Wrong username or password', status: 401 }
  }
  const { shop, user } = hit
  if (user.active === false) return { ok: false, error: 'This login is turned off. Ask Absolute ADAS.', status: 403 }
  if (user.failed_n >= LOCK_AFTER && user.failed_at && Date.now() - new Date(user.failed_at).getTime() < LOCK_MS) {
    return { ok: false, error: 'Too many tries. Wait 15 minutes or ask us to reset it.', status: 429 }
  }
  if (!verifyPassword(password, user.password_hash)) {
    const users = usersOf(shop).map(u => u.id === user.id ? { ...u, failed_n: (u.failed_n || 0) + 1, failed_at: new Date().toISOString() } : u)
    await writeUsers(req, shop, users).catch(() => {})
    return { ok: false, error: 'Wrong username or password', status: 401 }
  }
  const users = usersOf(shop).map(u => u.id === user.id ? { ...u, failed_n: 0, failed_at: '', last_login: new Date().toISOString() } : u)
  await writeUsers(req, shop, users).catch(() => {})
  return { ok: true, shop, user: users.find(u => u.id === user.id) || user }
}

export async function changePassword(req, shop, userId, { current, next }) {
  const fresh = (await getAllShops(req)).find(s => String(s.id) === String(shop.id)) || shop
  const users = usersOf(fresh)
  const i = users.findIndex(u => String(u.id) === String(userId))
  if (i < 0) return { ok: false, error: 'user not found', status: 404 }
  const user = users[i]
  if (!user.must_change && !verifyPassword(current, user.password_hash)) {
    return { ok: false, error: 'Current password is wrong', status: 401 }
  }
  if (String(next || '').length < 8) return { ok: false, error: 'New password must be at least 8 characters', status: 400 }
  users[i] = { ...user, password_hash: hashPassword(next), must_change: false, failed_n: 0, failed_at: '' }
  await writeUsers(req, fresh, users)
  return { ok: true, user: publicUser(users[i], fresh) }
}

export async function userOnShop(req, shopId, userId) {
  const shops = await getAllShops(req)
  const shop = shops.find(s => String(s.id) === String(shopId))
  if (!shop) return null
  const user = usersOf(shop).find(u => String(u.id) === String(userId))
  return user ? { shop, user } : { shop, user: null }
}
