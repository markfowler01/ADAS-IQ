// Who is Mark? His Zoho sign-in can arrive under any of these addresses
// (2026-09-16: it was NOT mark@, so the app hid every owner-only screen).
export const MARK_EMAILS = ['mark@absoluteadas.com', 'mf@absoluteadas.com', 'mfowler4456@gmail.com']
export const isMarkUser = u => MARK_EMAILS.includes(String(u?.email || '').trim().toLowerCase())
export const isOwnerUser = u => isMarkUser(u) || u?.role === 'owner'
