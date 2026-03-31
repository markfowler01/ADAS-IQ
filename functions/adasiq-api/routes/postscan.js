import { Router } from 'express'
import {
  getMailAccessToken,
  getMailAccountId,
  findPostscanGroup,
  getUnreadGroupMessages,
  downloadGroupAttachment,
  markGroupMessageRead,
} from '../services/mail.js'
import { findFolderByRO, uploadFileToFolder } from '../services/workdrive.js'
import { getAccessToken } from '../services/zoho.js'

const router = Router()

/**
 * Extract the RO number (4-6 digit sequence) from an email subject.
 * "lm 24223"       → "24223"
 * "LMBS 24223"     → "24223"
 * "Re: lm 24223"   → "24223"
 */
function extractRO(subject) {
  if (!subject) return null
  const match = subject.match(/\b(\d{4,6})\b/)
  return match ? match[1] : null
}

/**
 * POST /api/postscan/run
 *
 * Triggered by Catalyst cron job (or manually for testing).
 * Reads unread emails from postscan@absoluteadas.com group inbox,
 * extracts the RO number from each subject, finds the matching WorkDrive folder,
 * uploads any PDF attachments, then marks the email as read.
 *
 * Protected by X-Cron-Secret header (set POSTSCAN_CRON_SECRET env var).
 */
router.post('/run', async (req, res) => {
  // Validate cron secret (skip check if env var not set, e.g. during initial setup)
  const cronSecret = process.env.POSTSCAN_CRON_SECRET
  if (cronSecret && req.headers['x-cron-secret'] !== cronSecret) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const processed = []
  const skipped = []
  const errors = []

  try {
    // 1. Get Zoho Mail access token
    const mailToken = await getMailAccessToken()
    const accountId = await getMailAccountId(mailToken)
    const groupId = await findPostscanGroup(mailToken, accountId)
    console.log(`[postscan] Using account ${accountId}, group ${groupId}`)

    // 2. Get Zoho WorkDrive access token (same client, different refresh token)
    const wdToken = await getAccessToken()

    // 3. Fetch unread messages
    const messages = await getUnreadGroupMessages(mailToken, accountId, groupId)
    console.log(`[postscan] ${messages.length} unread message(s)`)

    for (const msg of messages) {
      const messageId = msg.messageId || msg.mid
      const subject = msg.subject || ''
      const roNumber = extractRO(subject)

      if (!roNumber) {
        console.log(`[postscan] Skipping — no RO number in subject: "${subject}"`)
        skipped.push({ subject, reason: 'no RO number found' })
        continue
      }

      // 4. Find matching WorkDrive folder
      const folder = await findFolderByRO(roNumber, wdToken)
      if (!folder) {
        console.log(`[postscan] No folder found for RO ${roNumber}`)
        skipped.push({ subject, roNumber, reason: `no WorkDrive folder starting with ${roNumber}` })
        continue
      }

      console.log(`[postscan] RO ${roNumber} → folder "${folder.folderName}" (${folder.folderId})`)

      // 5. Find PDF attachments and upload each one
      const attachments = msg.attachments || []
      const pdfs = attachments.filter(a =>
        a.attachmentName?.toLowerCase().endsWith('.pdf') ||
        a.contentType?.toLowerCase().includes('pdf')
      )

      if (pdfs.length === 0) {
        console.log(`[postscan] No PDF attachments in message "${subject}"`)
        skipped.push({ subject, roNumber, reason: 'no PDF attachments' })
        continue
      }

      let uploadedCount = 0
      for (const pdf of pdfs) {
        const attachmentId = pdf.attachmentId || pdf.aid
        const filename = pdf.attachmentName || `PostScan-${roNumber}.pdf`

        try {
          const buffer = await downloadGroupAttachment(mailToken, accountId, groupId, messageId, attachmentId)
          await uploadFileToFolder(folder.folderId, filename, buffer, wdToken)
          console.log(`[postscan] Uploaded "${filename}" to folder "${folder.folderName}"`)
          uploadedCount++
        } catch (uploadErr) {
          console.error(`[postscan] Upload failed for "${filename}":`, uploadErr.message)
          errors.push({ subject, roNumber, filename, error: uploadErr.message })
        }
      }

      // 6. Mark the email as read (even if some uploads failed — don't reprocess)
      if (uploadedCount > 0) {
        try {
          await markGroupMessageRead(mailToken, accountId, groupId, messageId)
          console.log(`[postscan] Marked message ${messageId} as read`)
        } catch (markErr) {
          console.warn(`[postscan] Could not mark message as read:`, markErr.message)
        }
        processed.push({ subject, roNumber, folderName: folder.folderName, uploaded: uploadedCount })
      }
    }
  } catch (err) {
    console.error('[postscan] Fatal error:', err.message)
    return res.status(500).json({ error: err.message, processed, skipped, errors })
  }

  res.json({
    ok: true,
    processed: processed.length,
    skipped: skipped.length,
    errors: errors.length,
    details: { processed, skipped, errors },
  })
})

export default router
