// Mark's cell number, resolved correctly.
//
// MARK_PHONE_NUMBER is NOT an environment variable — it lives in the
// phone_config Datastore row alongside the Twilio credentials. Reading it from
// process.env silently yields '' and every caller then skips the send.
//
// That single wrong lookup had taken out the whole evening loop: the 7 PM
// check-in never sent, and tryHandleCheckinReply compared the inbound sender
// against '' so a reply would never have been recognised even if it had.
import { resolvePhoneConfig } from './phoneConfig.js'

export async function getMarkPhone(req) {
  try {
    const cfg = await resolvePhoneConfig(req)
    const fromCfg = String(cfg?.MARK_PHONE_NUMBER || '').trim()
    if (fromCfg) return fromCfg
  } catch (e) {
    console.warn('[markPhone] phone_config lookup failed:', e.message)
  }
  return String(process.env.MARK_PHONE_NUMBER || '').trim()
}
