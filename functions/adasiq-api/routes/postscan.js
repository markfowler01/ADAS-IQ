import { Router } from 'express'
import {
  getMailAccessToken,
  getMailAccountId,
  getUnreadPostscanMessages,
  getMessageAttachments,
  downloadAccountAttachment,
  markAccountMessageRead,
  sendMail,
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

    // Show first 50 WorkDrive folder names so we can verify naming
    const { getAccessToken } = await import('../services/zoho.js')
    const axios = (await import('axios')).default
    const wdToken = await getAccessToken()
    const PARENT_FOLDER_ID = '28exmfc33000b044047f18dc7f1617c730889'
    const wdRes = await axios.get(`https://workdrive.zoho.com/api/v1/files/${PARENT_FOLDER_ID}/files`, {
      headers: { Authorization: `Zoho-oauthtoken ${wdToken}` },
      timeout: 15000,
    })
    const folders = (wdRes.data?.data || []).map(f => f.attributes?.name).filter(Boolean)
    steps.workdrive_folder_count = folders.length
    steps.workdrive_folder_names = folders.slice(0, 50)
  } catch (err) {
    steps.error = err.message
    steps.detail = err.response?.data ? JSON.stringify(err.response.data) : null
  }
  res.json(steps)
})

/**
 * GET /api/postscan/test-email — sends a test notification to techs@absoluteadas.com
 * Protected by X-Cron-Secret.
 */
router.get('/test-email', async (req, res) => {
  const cronSecret = process.env.POSTSCAN_CRON_SECRET
  if (cronSecret && req.headers['x-cron-secret'] !== cronSecret) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  try {
    const mailToken = await getMailAccessToken()
    const accountId = await getMailAccountId(mailToken)
    const to = req.query.to || 'techs@absoluteadas.com'
    const roNumber = '225916'
    const matchedRO = '255916'
    const folderName = 'TWF 255916 — Example Body Shop — 2022 Toyota RAV4'
    const subject = 'twf 225916'
    await sendMail(mailToken, accountId, {
      to,
      subject: `📎 PostScan Uploaded — Scan #${roNumber} matched to Work Order #${matchedRO}`,
      body: `
        <p>Hey there,</p>
        <p>We matched Post Scan Report <strong>#${roNumber}</strong> to WorkDrive folder <strong>#${matchedRO}</strong>. It wasn't an exact match, but it was close enough to run with — so we went ahead and uploaded the PDF.</p>
        <p>Feel free to move it if it landed in the wrong folder.</p>
        <p style="color:#888;font-size:13px;margin-top:16px;">Folder: ${folderName}<br>Email subject: ${subject}</p>
        <p style="color:#bbb;font-size:12px;margin-top:24px;">— ADAS IQ PostScan Automation</p>
      `,
    })
    res.json({ ok: true, message: `Test email sent to ${to}` })
  } catch (err) {
    const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message
    res.status(500).json({ ok: false, error: detail })
  }
})

/**
 * POST /api/postscan/mark-unread
 * Re-marks all read messages in Scan Reports as unread so the cron will reprocess them.
 * Protected by X-Cron-Secret.
 */
router.post('/mark-unread', async (req, res) => {
  const cronSecret = process.env.POSTSCAN_CRON_SECRET
  if (cronSecret && req.headers['x-cron-secret'] !== cronSecret) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    const axios = (await import('axios')).default
    const mailToken = await getMailAccessToken()
    const accountId = await getMailAccountId(mailToken)
    const SCAN_REPORTS_FOLDER_ID = '147686000000057026'
    const MAIL_API = 'https://mail.zoho.com/api'

    function safeParseMailResponse(raw) {
      const fixed = raw
        .replace(/"messageId"\s*:\s*(\d+)/g, '"messageId":"$1"')
        .replace(/"attachmentId"\s*:\s*(\d+)/g, '"attachmentId":"$1"')
      return JSON.parse(fixed)
    }

    // Fetch all messages (read + unread)
    const listRes = await axios.get(`${MAIL_API}/accounts/${accountId}/messages/view`, {
      headers: { Authorization: `Zoho-oauthtoken ${mailToken}` },
      params: { folderId: SCAN_REPORTS_FOLDER_ID, limit: 50 },
      timeout: 15000,
      transformResponse: [safeParseMailResponse],
    })

    const messages = listRes.data?.data || []
    const readMessages = messages.filter(m => m.status === 'read' || m.isRead === true || m.read === true || m.status !== 'unread')
    console.log(`[postscan/mark-unread] ${messages.length} total, ${readMessages.length} to mark unread`)

    const marked = []
    for (const msg of messages) {
      try {
        await axios.put(
          `${MAIL_API}/accounts/${accountId}/updatemessage`,
          { messageId: [msg.messageId], folderId: SCAN_REPORTS_FOLDER_ID, mode: 'markAsUnread' },
          { headers: { Authorization: `Zoho-oauthtoken ${mailToken}`, 'Content-Type': 'application/json' }, timeout: 10000 }
        )
        marked.push(msg.subject)
      } catch (e) {
        console.warn(`[postscan/mark-unread] Failed for "${msg.subject}":`, e.message)
      }
    }

    res.json({ ok: true, marked })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
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

      // 3a. Fuzzy match — upload anyway but notify Mark
      if (folder.fuzzyMatch) {
        console.warn(`[postscan] ⚠ Fuzzy match used: email RO "${roNumber}" → folder RO "${folder.matchedRO}" (distance ${folder.fuzzyDistance})`)
        try {
          await sendMail(mailToken, accountId, {
            to: 'techs@absoluteadas.com',
            subject: `📎 PostScan Uploaded — Scan #${roNumber} matched to Work Order #${folder.matchedRO}`,
            body: `
              <p>Hey there,</p>
              <p>We matched Post Scan Report <strong>#${roNumber}</strong> to WorkDrive folder <strong>#${folder.matchedRO}</strong>. It wasn't an exact match, but it was close enough to run with — so we went ahead and uploaded the PDF.</p>
              <p>Feel free to move it if it landed in the wrong folder.</p>
              <p style="color:#888;font-size:13px;margin-top:16px;">Folder: ${folder.folderName}<br>Email subject: ${subject}</p>
              <p style="color:#bbb;font-size:12px;margin-top:24px;">— ADAS IQ PostScan Automation</p>
            `,
          })
          console.log('[postscan] Fuzzy match notification sent to techs@absoluteadas.com')
        } catch (notifyErr) {
          const notifyDetail = notifyErr.response?.data ? JSON.stringify(notifyErr.response.data) : notifyErr.message
          console.warn('[postscan] Could not send fuzzy match notification:', notifyDetail)
          errors.push({ subject, roNumber, type: 'notify_failed', error: notifyDetail })
        }
      }

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
