import { Router } from 'express'
import {
  getMailAccessToken,
  getMailAccountId,
  getUnreadPostscanMessages,
  getMessageAttachments,
  downloadAccountAttachment,
  markAccountMessageRead,
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

// GET /api/postscan/debug — diagnostic endpoint, no auth required
router.get('/debug', async (req, res) => {
  const steps = {}
  try {
    steps.env_mail_refresh  = !!process.env.ZOHO_MAIL_REFRESH_TOKEN
    steps.env_client_id     = !!process.env.ZOHO_CLIENT_ID
    steps.env_client_secret = !!process.env.ZOHO_CLIENT_SECRET

    const mailToken = await getMailAccessToken()
    steps.mail_token = mailToken.substring(0, 20) + '...'

    const accountId = await getMailAccountId(mailToken)
    steps.account_id = accountId

    const messages = await getUnreadPostscanMessages(mailToken, accountId)
    steps.unread_postscan_count = messages.length
    steps.unread_subjects = messages.map(m => m.subject)

    steps.unread_count = messages.length
  } catch (err) {
    steps.error = err.message
    steps.detail = err.response?.data ? JSON.stringify(err.response.data) : null
  }
  res.json(steps)
})

/**
 * POST /api/postscan/run
 *
 * Reads unread emails from the SCAN REPORTS folder in Mark's mailbox,
 * extracts the RO number from each subject, finds the matching WorkDrive folder,
 * uploads any PDF attachments, then marks the email as read.
 *
 * Protected by X-Cron-Secret header (set POSTSCAN_CRON_SECRET env var).
 */
router.post('/run', async (req, res) => {
  const cronSecret = process.env.POSTSCAN_CRON_SECRET
  if (cronSecret && req.headers['x-cron-secret'] !== cronSecret) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const processed = []
  const skipped = []
  const errors = []

  try {
    // 1. Get mail + WorkDrive tokens
    console.log('[postscan] Getting tokens...')
    const mailToken = await getMailAccessToken()
    const accountId = await getMailAccountId(mailToken)
    const wdToken = await getAccessToken()

    // 2. Fetch unread messages from SCAN REPORTS folder
    const messages = await getUnreadPostscanMessages(mailToken, accountId)
    console.log(`[postscan] ${messages.length} unread message(s)`)

    for (const msg of messages) {
      const messageId = msg.messageId
      const folderId = msg.folderId
      const subject = msg.subject || ''
      const roNumber = extractRO(subject)

      if (!roNumber) {
        console.log(`[postscan] Skipping — no RO number in subject: "${subject}"`)
        skipped.push({ subject, reason: 'no RO number found' })
        continue
      }

      // 3. Find matching WorkDrive folder
      const folder = await findFolderByRO(roNumber, wdToken)
      if (!folder) {
        console.log(`[postscan] No folder found for RO ${roNumber}`)
        skipped.push({ subject, roNumber, reason: `no WorkDrive folder starting with ${roNumber}` })
        continue
      }

      console.log(`[postscan] RO ${roNumber} → folder "${folder.folderName}" (${folder.folderId})`)

      // 4. Fetch attachment list for this message
      const attachments = await getMessageAttachments(mailToken, accountId, folderId, messageId)
      const pdfs = attachments.filter(a =>
        a.attachmentName?.toLowerCase().endsWith('.pdf') ||
        a.name?.toLowerCase().endsWith('.pdf') ||
        a.contentType?.toLowerCase().includes('pdf')
      )

      if (pdfs.length === 0) {
        console.log(`[postscan] No PDF attachments in message "${subject}"`)
        skipped.push({ subject, roNumber, reason: 'no PDF attachments' })
        continue
      }

      // 5. Upload each PDF to WorkDrive
      let uploadedCount = 0
      for (const pdf of pdfs) {
        const attachmentId = pdf.attachmentId || pdf.aid
        const filename = pdf.attachmentName || pdf.name || `PostScan-${roNumber}.pdf`

        try {
          const buffer = await downloadAccountAttachment(mailToken, accountId, folderId, messageId, attachmentId)
          await uploadFileToFolder(folder.folderId, filename, buffer, wdToken)
          console.log(`[postscan] Uploaded "${filename}" to folder "${folder.folderName}"`)
          uploadedCount++
        } catch (uploadErr) {
          console.error(`[postscan] Upload failed for "${filename}":`, uploadErr.message)
          errors.push({ subject, roNumber, filename, error: uploadErr.message })
        }
      }

      // 6. Mark as read so it won't be reprocessed
      if (uploadedCount > 0) {
        try {
          await markAccountMessageRead(mailToken, accountId, folderId, messageId)
          console.log(`[postscan] Marked message ${messageId} as read`)
        } catch (markErr) {
          console.warn(`[postscan] Could not mark message as read:`, markErr.message)
        }
        processed.push({ subject, roNumber, folderName: folder.folderName, uploaded: uploadedCount })
      }
    }
  } catch (err) {
    const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message
    console.error('[postscan] Fatal error:', detail)
    return res.status(500).json({ error: err.message, detail, processed, skipped, errors })
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
