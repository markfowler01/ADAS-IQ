// 📥 Scrub queue (Mark 2026-09-30: "if we get a lot of shops … create your own
// piles and keep scrubbing more and more, so the scalability is limitless").
//
// One row per estimate in AdasScrubJobs — no cap, nothing overwritten (the old
// queue was one AppConfig list capped at 40 that silently dropped the oldest,
// and two writers at once erased each other). Every source records here FIRST;
// scrubbing happens after, in as many parallel workers as there are cars
// waiting (no maximum — Mark). A worker claims a row, scrubs it, marks it done.
//   queued → working → done
//                    ↘ queued again (retry, backoff)  ↘ dead after 3 tries → a human
// A worker that dies mid-scrub is reclaimed after STALE_MS. Rate-limit /
// overload errors don't use up a try.
import catalyst from 'zcatalyst-sdk-node'

const T = 'AdasScrubJobs'
const STALE_MS = 6 * 60 * 1000
const MAX_TRIES = 3
const BACKOFF_MIN = [2, 10, 30]
const ds = req => catalyst.initialize(req, { type: 'advancedio' })
const nowIso = () => new Date().toISOString()
const q = v => String(v ?? '').replace(/'/g, "''")
const str = (v, n) => String(v ?? '').slice(0, n)
const rowOf = r => r?.[T] || r
export const toItem = r => ({ id: String(r.ROWID), key: r.sj_key || '', job: r.sj_job || '', file: r.sj_file || '', name: r.sj_name || '', source: r.sj_source || '', by: r.sj_by || '', status: r.sj_status || '', tries: Number(r.sj_tries || 0), priority: Number(r.sj_priority || 5), next_at: r.sj_next_at || '', claimed_by: r.sj_claimed_by || '', claimed_at: r.sj_claimed_at || '', error: r.sj_error || '', done_at: r.sj_done_at || '', ms: Number(r.sj_ms || 0), created: r.CREATEDTIME || '' })

async function query(req, sql) { return (await ds(req).zcql().executeZCQLQuery(sql)).map(rowOf) }

/**
 * Record an estimate to scrub. Idempotent: the same key (file id, or CCC
 * workfile id) already queued/working is not added twice.
 * priority: 1 = live job / shop email, 3 = quote, 5 = backfill / benchmark.
 */
export async function enqueue(req, { job = '', file = '', name = '', source = 'email', by = '', priority = 1, key = '' } = {}) {
  const k = str(key || file || `job:${job}`, 200)
  // CCC keys are a hash of the exact message: seen once in ANY state = a re-delivery, skip it.
  if (k.startsWith('ccc:')) { const any = await query(req, `SELECT ROWID FROM ${T} WHERE sj_key = '${q(k)}' LIMIT 1`); if (any.length) return { id: String(any[0].ROWID), existed: true } }
  const open = await query(req, `SELECT ROWID, sj_status FROM ${T} WHERE sj_key = '${q(k)}' AND sj_status = 'queued'`)
  const busy = open.length ? open : await query(req, `SELECT ROWID, sj_status FROM ${T} WHERE sj_key = '${q(k)}' AND sj_status = 'working'`)
  if (busy.length) return { id: String(busy[0].ROWID), existed: true }
  const row = await ds(req).datastore().table(T).insertRow({ sj_key: k, sj_job: str(job, 64), sj_file: str(file, 120), sj_name: str(name, 255), sj_source: str(source, 40), sj_by: str(by, 100), sj_status: 'queued', sj_priority: Number(priority) || 5, sj_tries: 0, sj_next_at: nowIso() })
  return { id: String(row.ROWID), existed: false }
}

/** Claim the next ready row for this worker. Re-reads to make sure it won the race. */
export async function claimNext(req, worker) {
  const now = nowIso()
  const cands = await query(req, `SELECT * FROM ${T} WHERE sj_status = 'queued' AND sj_next_at <= '${now}' ORDER BY sj_priority ASC, CREATEDTIME ASC LIMIT 8`)
  for (const c of cands) {
    await ds(req).datastore().table(T).updateRow({ ROWID: String(c.ROWID), sj_status: 'working', sj_claimed_by: str(worker, 60), sj_claimed_at: nowIso() })
    const back = (await query(req, `SELECT * FROM ${T} WHERE ROWID = '${c.ROWID}'`))[0]
    if (back && back.sj_claimed_by === str(worker, 60) && back.sj_status === 'working') return toItem(back)
  }
  return null
}

export async function markDone(req, item, ms = 0) {
  await ds(req).datastore().table(T).updateRow({ ROWID: item.id, sj_status: 'done', sj_done_at: nowIso(), sj_ms: Math.round(ms), sj_error: '' })
}

/** A failed try. Returns 'retry' or 'dead'. Overload / rate limits don't count as a try. */
export async function markFailed(req, item, err) {
  const msg = str(err?.message || err, 250)
  const transient = /\b(429|529|overloaded|rate.?limit|timeout|ETIMEDOUT|ECONNRESET|socket hang up)\b/i.test(msg)
  const tries = transient ? item.tries : item.tries + 1
  if (tries >= MAX_TRIES) {
    await ds(req).datastore().table(T).updateRow({ ROWID: item.id, sj_status: 'dead', sj_tries: tries, sj_error: msg, sj_done_at: nowIso() })
    return 'dead'
  }
  const waitMin = transient ? 1 : BACKOFF_MIN[Math.min(tries - 1, BACKOFF_MIN.length - 1)]
  await ds(req).datastore().table(T).updateRow({ ROWID: item.id, sj_status: 'queued', sj_tries: tries, sj_error: msg, sj_next_at: new Date(Date.now() + waitMin * 60000).toISOString(), sj_claimed_by: '' })
  return 'retry'
}

/** Workers that died mid-scrub: put their rows back in the pile. */
export async function reclaimStale(req) {
  const cut = new Date(Date.now() - STALE_MS).toISOString()
  const stale = await query(req, `SELECT ROWID FROM ${T} WHERE sj_status = 'working' AND sj_claimed_at < '${cut}' LIMIT 100`)
  for (const r of stale) await ds(req).datastore().table(T).updateRow({ ROWID: String(r.ROWID), sj_status: 'queued', sj_next_at: nowIso(), sj_claimed_by: '', sj_error: 'worker timed out — back in the pile' })
  return stale.length
}

/** How much is waiting and how it's going. */
export async function queueStats(req) {
  const now = nowIso(), dayAgo = new Date(Date.now() - 864e5).toISOString()
  const count = async where => Number((await ds(req).zcql().executeZCQLQuery(`SELECT COUNT(ROWID) FROM ${T} WHERE ${where}`))[0]?.[T]?.['COUNT(ROWID)'] || 0)
  const [ready, waiting, working, dead, doneToday] = await Promise.all([
    count(`sj_status = 'queued' AND sj_next_at <= '${now}'`),
    count(`sj_status = 'queued'`),
    count(`sj_status = 'working'`),
    count(`sj_status = 'dead'`),
    count(`sj_status = 'done' AND sj_done_at >= '${dayAgo}'`),
  ])
  const oldest = (await query(req, `SELECT CREATEDTIME, sj_name FROM ${T} WHERE sj_status = 'queued' ORDER BY CREATEDTIME ASC LIMIT 1`))[0]
  const recent = await query(req, `SELECT sj_ms FROM ${T} WHERE sj_status = 'done' AND sj_done_at >= '${dayAgo}' ORDER BY CREATEDTIME DESC LIMIT 50`)
  const avgMs = recent.length ? Math.round(recent.reduce((a, r) => a + Number(r.sj_ms || 0), 0) / recent.length) : 0
  return { ready, waiting, working, dead, done_24h: doneToday, oldest_waiting: oldest ? { since: oldest.CREATEDTIME, name: oldest.sj_name } : null, avg_seconds: Math.round(avgMs / 1000) }
}

export async function listDead(req, limit = 50) {
  return (await query(req, `SELECT * FROM ${T} WHERE sj_status = 'dead' ORDER BY CREATEDTIME DESC LIMIT ${Math.min(limit, 200)}`)).map(toItem)
}
