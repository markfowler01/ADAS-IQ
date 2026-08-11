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
//
// SELF-HEAL (Mark 2026-08-11: "i keep getting alerts for jobs not having
// an external workdrive and they do"): several creation paths stamp the
// link on the invoice but not the job row, so job.folder_url being empty
// does NOT mean the folder is missing. Before alerting, search WorkDrive
// the same way the "Open in WorkDrive" button does (by RO, then by
// shop+vehicle), create/reuse the public share link, and stamp the job.
// Only jobs whose folder genuinely can't be found get alerted.

const HEAL_CAP = 5           // lookups per hourly run — keeps the tick fast
const TIME_BUDGET_MS = 15000 // hard stop so the postscan tick never drags

export async function runWorkdriveHealth(req) {
  const { readJobsPublic, updateJobPublic } = await import('../routes/jobs.js')
  const { postToCliqChannelById, MARK_ALERT_CHANNEL_ID } = await import('./cliq.js')
  const jobs = await readJobsPublic(req)

  const broken = jobs.filter(j =>
    j.folder_url &&
    j.folder_url.includes('workdrive.zoho.com/folder/') &&
    !j.folder_url.includes('zohoexternal.com')
  )

  const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000
  const candidates = jobs.filter(j =>
    !j.folder_url &&
    /^(dispatched_|pending_parts|ready_invoice|complete)/.test(j.status || '') &&
    new Date(j.created_at || 0).getTime() > cutoff
  )

  // Try to find + stamp the folder for each candidate before alerting.
  const healed = []
  const missing = []
  if (candidates.length > 0) {
    const started = Date.now()
    let wdToken = null
    let helpers = null
    try {
      const zoho = await import('./zoho.js')
      wdToken = await zoho.getAccessToken()
      helpers = await import('./workdrive.js')
    } catch (e) {
      console.warn('[workdrive-health] token/helpers unavailable, skipping heal:', e.message)
    }

    for (const j of candidates) {
      if (!wdToken || !helpers || healed.length + missing.length >= HEAL_CAP ||
          Date.now() - started > TIME_BUDGET_MS) {
        // Out of budget — leave the rest for the next hourly tick rather
        // than alerting on jobs we haven't actually checked.
        break
      }
      try {
        const roNumber = j.invoice_number || j.quote_number
        const vehicle = j.vehicle || [j.year, j.make, j.model].filter(Boolean).join(' ')
        let found = null
        if (roNumber) found = await helpers.findFolderByRO(roNumber, wdToken)
        if (!found && j.shop_name) found = await helpers.findFolderByShopVehicle(j.shop_name, vehicle, wdToken)
        if (found) {
          const label = found.folderName || [roNumber, j.shop_name, vehicle].filter(Boolean).join(' — ') || `Job ${j.id}`
          const shareLink = await helpers.createShareLink(found.folderId, label, wdToken)
          if (shareLink) {
            // Merge-update — updateJobPublic rebuilds the full row, so
            // spread the existing job to avoid blanking columns.
            await updateJobPublic(req, j.id, { ...j, folder_url: shareLink })
            healed.push(j)
            console.log(`[workdrive-health] healed ${j.shop_name} RO# ${roNumber || j.id} → ${shareLink}`)
            continue
          }
        }
        missing.push(j)
      } catch (e) {
        console.warn(`[workdrive-health] heal failed for job ${j.id}:`, e.message)
        missing.push(j)
      }
    }
  }

  if (broken.length > 0 || missing.length > 0) {
    const line = j => {
      const vehicle = j.vehicle || [j.year, j.make, j.model].filter(Boolean).join(' ')
      return `• ${j.shop_name || 'Unknown'} — ${vehicle} (RO# ${j.invoice_number || j.quote_number || j.id})`
    }
    const msg = [
      `⚠️ *WorkDrive health check*`,
      broken.length ? `${broken.length} job${broken.length > 1 ? 's' : ''} with internal-only links (not public):` : null,
      ...broken.slice(0, 8).map(line),
      missing.length ? `${missing.length} job${missing.length > 1 ? 's' : ''} with NO folder found in WorkDrive (searched by RO and shop/vehicle):` : null,
      ...missing.slice(0, 8).map(line),
      healed.length ? `\n🔧 Auto-repaired ${healed.length} job${healed.length > 1 ? 's' : ''} whose folder existed but wasn't linked on the card.` : null,
      '',
      'For the NOT-FOUND ones the folder likely was never created — use "Open in WorkDrive" on the card to create it.',
    ].filter(l => l !== null).join('\n')
    await postToCliqChannelById(MARK_ALERT_CHANNEL_ID, msg)
    console.log(`[workdrive-health] broken=${broken.length} missing=${missing.length} healed=${healed.length} — Cliq alert sent`)
  } else if (healed.length > 0) {
    // Quiet success — folders existed, links now stamped. Tell Mark once
    // so he knows the earlier noise is resolved, without a scary ⚠️.
    await postToCliqChannelById(MARK_ALERT_CHANNEL_ID,
      `🔧 WorkDrive check: auto-linked ${healed.length} job${healed.length > 1 ? 's' : ''} to their existing folders. No problems found.`)
    console.log(`[workdrive-health] healed=${healed.length}, nothing broken ✅`)
  } else {
    console.log('[workdrive-health] All job WorkDrive links look healthy ✅')
  }

  return { broken: broken.length, missing: missing.length, healed: healed.length }
}
