// Datastore-backed CallLog storage. Replaces the calls_log cache blob
// so call history is durable (no 48h TTL, no 20KB per-key cap) and can
// scale beyond the ~100-record ceiling cache forced on us.
//
// Table shape (Mark's schema, table name `CallLog`):
//   call_sid varchar UNIQUE
//   from_e164 varchar
//   to_e164 varchar
//   direction varchar          inbound|outbound
//   status varchar             ringing|completed|no-answer|busy|failed
//   duration int
//   started_at varchar         ISO 8601
//   contact_id varchar
//   contact_name varchar
//   shop_name varchar
//   recording_url text
//   recording_duration int
//   transcription text
//   crm_activity_id varchar
//   created_time varchar       ISO 8601
//
// The record shape used by voice.js callers has slightly different names
// (from_number/to_number/timestamp/duration_seconds). We normalize on
// write and denormalize on read so callers stay identical.

import catalyst from 'zcatalyst-sdk-node'

const TABLE = 'CallLog'

function getTable(req) {
  const app = catalyst.initialize(req, { type: 'advancedio' })
  return app.datastore().table(TABLE)
}

// caller-shape → row-shape
function toRow(rec) {
  const now = new Date().toISOString()
  return {
    call_sid:            String(rec.call_sid || ''),
    from_e164:           String(rec.from_number || rec.from_e164 || ''),
    to_e164:             String(rec.to_number   || rec.to_e164   || ''),
    direction:           String(rec.direction || ''),
    status:              String(rec.status || ''),
    duration:            Number.isFinite(+rec.duration_seconds) ? +rec.duration_seconds
                          : Number.isFinite(+rec.duration) ? +rec.duration : 0,
    started_at:          String(rec.timestamp || rec.started_at || now),
    contact_id:          String(rec.contact_id || ''),
    contact_name:        String(rec.contact_name || ''),
    shop_name:           String(rec.shop_name || ''),
    recording_url:       String(rec.recording_url || ''),
    recording_duration:  Number.isFinite(+rec.recording_duration_sec) ? +rec.recording_duration_sec
                          : Number.isFinite(+rec.recording_duration) ? +rec.recording_duration : 0,
    transcription:       String(rec.transcription || ''),
    crm_activity_id:     String(rec.crm_activity_id || ''),
    created_time:        String(rec.created_at || now),
  }
}

// row-shape → caller-shape
function fromRow(row) {
  const r = row.CallLog || row
  return {
    id:                     String(r.ROWID || ''),
    call_sid:               r.call_sid || '',
    direction:              r.direction || '',
    from_number:            r.from_e164 || '',
    to_number:              r.to_e164   || '',
    status:                 r.status || '',
    duration_seconds:       Number(r.duration || 0),
    timestamp:              r.started_at || r.created_time || '',
    contact_id:             r.contact_id || '',
    contact_name:           r.contact_name || '',
    shop_name:              r.shop_name || '',
    recording_url:          r.recording_url || '',
    recording_duration_sec: Number(r.recording_duration || 0),
    transcription:          r.transcription || '',
    crm_activity_id:        r.crm_activity_id || '',
    created_at:             r.created_time || '',
    // Not stored — the frontend uses this for the 425/844 badge. Classify
    // best-effort from the to_e164 if it looks like the tollfree.
    line_type:              (String(r.to_e164 || '').includes('8443492327')) ? 'tollfree' : 'local',
  }
}

// UPSERT by call_sid. Twilio guarantees the SID is unique per call; the
// initial "ringing" write happens on inbound, later status callbacks
// merge fields onto the same row.
export async function upsertCall(req, rec) {
  const table = getTable(req)
  const callSid = String(rec.call_sid || '')
  if (!callSid) throw new Error('upsertCall: call_sid required')

  const q = `SELECT * FROM ${TABLE} WHERE call_sid = '${callSid.replace(/'/g, "''")}' LIMIT 1`
  let existing = null
  try {
    const app = catalyst.initialize(req, { type: 'advancedio' })
    const rows = await app.zcql().executeZCQLQuery(q)
    existing = rows?.[0]?.CallLog || rows?.[0] || null
  } catch (e) {
    console.warn('[CallLog zcql lookup]', e.message)
  }

  if (existing?.ROWID) {
    // MERGE onto the existing row — callers send partial records
    // (status updates, recording callbacks) and a bare toRow(rec)
    // would blank every column they omitted.
    const row = toRow({ ...fromRow(existing), ...rec })
    const updated = await table.updateRow({ ROWID: String(existing.ROWID), ...row })
    return fromRow(updated)
  } else {
    const inserted = await table.insertRow(toRow(rec))
    return fromRow(inserted)
  }
}

// List, newest first. Limit defaults to 200 (matches historical UI).
export async function listCalls(req, { limit = 200 } = {}) {
  // Paged — ZCQL rejects large single LIMITs (see datastoreSms.js).
  const app = catalyst.initialize(req, { type: 'advancedio' })
  const cap = Math.min(Math.max(1, limit), 1000)
  const PAGE = 250
  const out = []
  for (let offset = 0; offset < cap; offset += PAGE) {
    const take = Math.min(PAGE, cap - offset)
    const q = `SELECT * FROM ${TABLE} ORDER BY CREATEDTIME DESC LIMIT ${take} OFFSET ${offset}`
    const rows = await app.zcql().executeZCQLQuery(q)
    out.push(...(rows || []).map(fromRow))
    if (!rows || rows.length < take) break
  }
  return out
}

// Fetch one by SID (for status-update handlers)
export async function getCallBySid(req, callSid) {
  if (!callSid) return null
  const app = catalyst.initialize(req, { type: 'advancedio' })
  const q = `SELECT * FROM ${TABLE} WHERE call_sid = '${String(callSid).replace(/'/g, "''")}' LIMIT 1`
  const rows = await app.zcql().executeZCQLQuery(q)
  return rows?.[0] ? fromRow(rows[0]) : null
}
