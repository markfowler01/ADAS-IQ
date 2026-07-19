// Datastore-backed voicemails storage. Replaces the `voicemails` cache
// blob so voicemail history is durable.
//
// Table shape (Mark's schema, table name `voicemails` — LOWERCASE):
//   call_sid varchar UNIQUE (mandatory)
//   from_number varchar (mandatory)
//   to_number varchar (mandatory)
//   recording_url text
//   transcription text
//   time_stamp varchar (mandatory)   ISO 8601
//   contact_id varchar
//   contact_name varchar
//   duration_seconds varchar
//
// Callers use record shape with timestamp / recording_duration_sec /
// recording_sid / transcription_status — those get normalized on write
// and back on read so the voice.js call sites don't have to change.

import catalyst from 'zcatalyst-sdk-node'

const TABLE = 'voicemails'

function getTable(req) {
  const app = catalyst.initialize(req, { type: 'advancedio' })
  return app.datastore().table(TABLE)
}

function toRow(rec) {
  const now = new Date().toISOString()
  const durSec =
    Number.isFinite(+rec.recording_duration_sec) ? +rec.recording_duration_sec :
    Number.isFinite(+rec.duration_seconds)       ? +rec.duration_seconds :
    0
  return {
    call_sid:         String(rec.call_sid || ''),
    from_number:      String(rec.from_number || ''),
    to_number:        String(rec.to_number || ''),
    recording_url:    String(rec.recording_url || ''),
    transcription:    String(rec.transcription || ''),
    time_stamp:       String(rec.timestamp || rec.time_stamp || now),
    contact_id:       String(rec.contact_id || ''),
    contact_name:     String(rec.contact_name || ''),
    duration_seconds: String(durSec || ''),
  }
}

function fromRow(row) {
  const r = row.voicemails || row
  return {
    id:                     String(r.ROWID || ''),
    call_sid:               r.call_sid || '',
    from_number:            r.from_number || '',
    to_number:              r.to_number || '',
    recording_url:          r.recording_url || '',
    transcription:          r.transcription || '',
    timestamp:              r.time_stamp || '',
    contact_id:             r.contact_id || '',
    contact_name:           r.contact_name || '',
    recording_duration_sec: Number(r.duration_seconds || 0),
    // Fields not stored in the table — reconstruct sensible defaults.
    transcription_status:   r.transcription ? 'completed' : 'pending',
    line_type:              '',  // no column; classify at read time if needed
  }
}

// UPSERT by call_sid. Voicemail-done fires the initial insert; the
// transcription-callback merges the transcript onto the same row.
export async function upsertVoicemail(req, rec) {
  const table = getTable(req)
  const callSid = String(rec.call_sid || '')
  if (!callSid) throw new Error('upsertVoicemail: call_sid required')

  const q = `SELECT * FROM ${TABLE} WHERE call_sid = '${callSid.replace(/'/g, "''")}' LIMIT 1`
  let existing = null
  try {
    const app = catalyst.initialize(req, { type: 'advancedio' })
    const rows = await app.zcql().executeZCQLQuery(q)
    existing = rows?.[0]?.voicemails || rows?.[0] || null
  } catch (e) {
    console.warn('[voicemails zcql lookup]', e.message)
  }

  if (existing?.ROWID) {
    // MERGE onto the existing row — the transcription callback sends a
    // partial record; a bare toRow(rec) would blank the recording fields.
    const row = toRow({ ...fromRow(existing), ...rec })
    const updated = await table.updateRow({ ROWID: String(existing.ROWID), ...row })
    return fromRow(updated)
  } else {
    const inserted = await table.insertRow(toRow(rec))
    return fromRow(inserted)
  }
}

// List, newest first.
export async function listVoicemails(req, { limit = 200 } = {}) {
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

export async function getVoicemailBySid(req, callSid) {
  if (!callSid) return null
  const app = catalyst.initialize(req, { type: 'advancedio' })
  const q = `SELECT * FROM ${TABLE} WHERE call_sid = '${String(callSid).replace(/'/g, "''")}' LIMIT 1`
  const rows = await app.zcql().executeZCQLQuery(q)
  return rows?.[0] ? fromRow(rows[0]) : null
}
