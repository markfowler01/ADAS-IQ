// WorkDrive link watchdog (extracted 2026-07-27 so the hourly postscan
// cron can run it — the /api/cron/workdrive-health endpoint was never
// scheduled in the Catalyst console, AND its alert was a self-DM that
// Cliq silently blocks. Double failure; both fixed.)
//
// Checks every job for:
//   broken  — folder_url is an internal workdrive.zoho.com link
//             (outside users can't open it)
//   missing — active job (dispatched/parts/invoice/complete) created in
//             the last 14 days with NO folder link at all
// Alerts Mark's channel when anything is off. Silent when healthy.

export async function runWorkdriveHealth(req) {
  const { readJobsPublic } = await import('../routes/jobs.js')
  const { postToCliqChannelById, MARK_ALERT_CHANNEL_ID } = await import('./cliq.js')
  const jobs = await readJobsPublic(req)

  const broken = jobs.filter(j =>
    j.folder_url &&
    j.folder_url.includes('workdrive.zoho.com/folder/') &&
    !j.folder_url.includes('zohoexternal.com')
  )

  const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000
  const missing = jobs.filter(j =>
    !j.folder_url &&
    /^(dispatched_|pending_parts|ready_invoice|complete)/.test(j.status || '') &&
    new Date(j.created_at || 0).getTime() > cutoff
  )

  if (broken.length > 0 || missing.length > 0) {
    const line = j => {
      const vehicle = j.vehicle || [j.year, j.make, j.model].filter(Boolean).join(' ')
      return `• ${j.shop_name || 'Unknown'} — ${vehicle} (RO# ${j.invoice_number || j.quote_number || j.id})`
    }
    const msg = [
      `⚠️ *WorkDrive health check*`,
      broken.length ? `${broken.length} job${broken.length > 1 ? 's' : ''} with internal-only links (not public):` : null,
      ...broken.slice(0, 8).map(line),
      missing.length ? `${missing.length} active job${missing.length > 1 ? 's' : ''} with NO folder link:` : null,
      ...missing.slice(0, 8).map(line),
      '',
      'Tap "Open in WorkDrive" on each card to create/repair the public link.',
    ].filter(l => l !== null).join('\n')
    await postToCliqChannelById(MARK_ALERT_CHANNEL_ID, msg)
    console.log(`[workdrive-health] broken=${broken.length} missing=${missing.length} — Cliq alert sent`)
  } else {
    console.log('[workdrive-health] All job WorkDrive links look healthy ✅')
  }

  return { broken: broken.length, missing: missing.length }
}
