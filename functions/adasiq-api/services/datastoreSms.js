// Datastore-backed SMS messages storage. Replaces the `sms_threads`
// cache blob so message history is durable (no 48h TTL, no ~40KB
// per-key size cap, no 100-record ceiling). Same pattern as
// datastoreCallLog.js + datastoreVoicemails.js.
//
// Table shape (Mark's schema, `sms_threads` lowercase):
//   message_sid varchar
//   thread_key varchar         counterparty phone — same as threadKey()
//   from_number varchar (mandatory)
//   to_number varchar (mandatory)
//   direction varchar (mandatory)   inbound|outbound
//   body text
//   time_stamp varchar (mandatory)  ISO 8601
//   cliq_channel varchar             which Cliq channel got the alert
//   contact_id varchar
//   contact_name varchar
//   shop_name varchar
//   sender_name varchar              which app user sent it (outbound)
//
// The schema does NOT store Twilio delivery-tracking metadata (status,
// error_code, error_message, attempts) or MMS media URLs. Those fields
// still flow through the API response objects for the current request,
// but aren't persisted. Media is proxied via signed URLs generated at
// serve time from message_sid + index, so re-render works as long as
// the Twilio-side media hasn't expired.

import catalyst from 'zcatalyst-sdk-node'

const TABLE = 'sms_threads'

function getTable(req) {
  const app = catalyst.initialize(req, { type: 'advancedio' })
  return app.datastore().table(TABLE)
}

// A "thread" is a conversation with one external phone number. Key is
// the counterparty's E.164, regardless of direction. Precomputed on
// write so /threads/:phone can query directly instead of scanning +
// bucketing in memory.
function computeThreadKey(rec) {
  return String(rec.direction === 'inbound' ? rec.from_number : rec.to_number || '')
}

function toRow(rec) {
  const now = new Date().toISOString()
  return {
    message_sid:  String(rec.message_sid || ''),
    thread_key:   computeThreadKey(rec),
    direction:    String(rec.direction || ''),
    from_number:  String(rec.from_number || ''),
    to_number:    String(rec.to_number || ''),
    body:         String(rec.body || ''),
    time_stamp:   String(rec.timestamp || rec.time_stamp || now),
    cliq_channel: String(rec.cliq_channel || ''),
    contact_id:   String(rec.contact_id || ''),
    contact_name: String(rec.contact_name || ''),
    shop_name:    String(rec.shop_name || ''),
    sender_name:  String(rec.sender || rec.sender_name || ''),
  }
}

function fromRow(row) {
  const r = row[TABLE] || row
  return {
    id:           String(r.ROWID || ''),
    message_sid:  r.message_sid || '',
    thread_key:   r.thread_key || '',
    direction:    r.direction || '',
    from_number:  r.from_number || '',
    to_number:    r.to_number || '',
    body:         r.body || '',
    timestamp:    r.time_stamp || '',
    cliq_channel: r.cliq_channel || '',
    contact_id:   r.contact_id || '',
    contact_name: r.contact_name || '',
    shop_name:    r.shop_name || '',
    sender:       r.sender_name || '',
    // Not persisted — media URLs regenerated from message_sid on serve
    // via signed proxy; delivery-tracking fields default so UI code that
    // reads them doesn't crash.
    media:                [],
    num_media:            0,
    line_type:            '',
    twilio_status:        '',
    twilio_error_code:    '',
    twilio_error_message: '',
    attempts:             1,
  }
}

// INSERT or UPDATE by message_sid. Twilio SIDs are globally unique per
// message; the initial send/inbound writes the record, StatusCallback
// updates twilio_status on the same row.
export async function upsertMessage(req, rec) {
  const table = getTable(req)
  const sid = String(rec.message_sid || '')
  if (!sid) throw new Error('upsertMessage: message_sid required')

  let existing = null
  try {
    const app = catalyst.initialize(req, { type: 'advancedio' })
    const rows = await app.zcql().executeZCQLQuery(
      `SELECT ROWID FROM ${TABLE} WHERE message_sid = '${sid.replace(/'/g, "''")}' LIMIT 1`
    )
    existing = rows?.[0]?.[TABLE] || rows?.[0] || null
  } catch (e) {
    console.warn(`[${TABLE} zcql lookup]`, e.message)
  }

  const row = toRow(rec)
  if (existing?.ROWID) {
    const updated = await table.updateRow({ ROWID: String(existing.ROWID), ...row })
    return fromRow(updated)
  }
  const inserted = await table.insertRow(row)
  return fromRow(inserted)
}

// List all messages, newest first. Bounded at 2000 for safety; the UI
// paginates from there.
export async function listMessages(req, { limit = 500 } = {}) {
  const app = catalyst.initialize(req, { type: 'advancedio' })
  const q = `SELECT * FROM ${TABLE} ORDER BY CREATEDTIME DESC LIMIT ${Math.min(Math.max(1, limit), 2000)}`
  const rows = await app.zcql().executeZCQLQuery(q)
  return (rows || []).map(fromRow)
}

// Full conversation with one phone number. Uses the precomputed
// thread_key column for a direct-index lookup instead of scanning
// from_number OR to_number.
export async function listMessagesForPhone(req, phoneNorm, { limit = 500 } = {}) {
  if (!phoneNorm) return []
  const safe = String(phoneNorm).replace(/'/g, "''")
  const app = catalyst.initialize(req, { type: 'advancedio' })
  const q = `SELECT * FROM ${TABLE} WHERE thread_key = '${safe}' ORDER BY CREATEDTIME ASC LIMIT ${Math.min(Math.max(1, limit), 2000)}`
  const rows = await app.zcql().executeZCQLQuery(q)
  return (rows || []).map(fromRow)
}

// Fetch one by SID (for status-callback updates)
export async function getMessageBySid(req, sid) {
  if (!sid) return null
  const app = catalyst.initialize(req, { type: 'advancedio' })
  const q = `SELECT * FROM ${TABLE} WHERE message_sid = '${String(sid).replace(/'/g, "''")}' LIMIT 1`
  const rows = await app.zcql().executeZCQLQuery(q)
  return rows?.[0] ? fromRow(rows[0]) : null
}

// No-op: the `sms_threads` table doesn't have twilio_status /
// twilio_error_code / twilio_error_message columns. The status
// callback still fires Cliq alerts on delivered/failed via the
// route handler; this function is kept so callers compile but it
// just returns the current row for context. Add those columns to
// the table if delivery-tracking persistence is needed later.
export async function updateMessageStatus(req, sid /* , { status, errorCode, errorMessage } */) {
  if (!sid) return null
  return getMessageBySid(req, sid)
}

// Table name — exported so callers/tests can log which table is active.
export const SMS_TABLE_NAME = TABLE
