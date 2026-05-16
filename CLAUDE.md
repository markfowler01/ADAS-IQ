# ADAS IQ — Developer Reference

Internal operations tool for Absolute ADAS: job board (Kanban), invoicing, CRM, Zoho integrations.

---

## Stack & Repo

- **Repo**: `markfowler01/ADAS-IQ`, branch `develop`
- **Platform**: Zoho Catalyst (serverless functions + static hosting)
- **Backend**: Node.js Express → `functions/adasiq-api/`
- **Frontend**: React + Tailwind → `client/src/`
- **Deploy command**: `npm run deploy:staging` (from repo root — runs build + `catalyst deploy`)
- **Dev URL**: `https://adas-iq-904191467.development.catalystserverless.com/app/index.html`
- **Prod URL**: `https://adas-iq-904191467.development.catalystserverless.com/app/index.html` — requires manual "Create Deployment" in Catalyst console

---

## Key Architecture Rules

- **No fire-and-forget after `res.json()`** — Catalyst kills the container. Email/Cliq sends must be awaited before responding.
- **Catalyst Cache value cap**: ~64–100 KB. Don't store large arrays without trimming.
- **Gateway timeout**: 30 seconds (not 540s). Long ops must respond quickly or use cron.
- **Datastore ROWIDs**: exceed `Number.MAX_SAFE_INTEGER`. Always pass as strings — never `Number(rowId)`.

---

## Auth

- **Login**: Zoho OAuth → HMAC-signed JWT stored in `sessionStorage`, sent as `X-Auth-Token` header
- **Protected routes**: `requireAuth` middleware on all `/api/*` routes except webhooks, cron, postscan
- **Role map** (`auth.js`): `jayden@absoluteadas.com` → `{ role: 'technician', techName: 'Jaden' }`. All others → `role: admin`.
- **Cron auth**: `x-cron-secret` header checked against env var — no session required

---

## Data Storage

| Data | Storage |
|------|---------|
| Jobs | Catalyst Datastore `Jobs` table |
| CRM shops | Catalyst Cache key `crm_shops` |
| Notifications | Catalyst Cache key `adas_iq_notifications` |
| Invoices (local) | Catalyst Cache key `adas_iq_invoices` |
| Completions | Catalyst Cache key `tech_completions` |
| Job history | Catalyst Cache key `job_history` |

---

## Route Map

| Method | Path | File | What it does |
|--------|------|------|-------------|
| POST | `/api/jobs/sync-quotes` | `routes/jobs.js` | Manual: pull Zoho Books draft/sent/accepted estimates → create jobs at `need_dispatch` |
| POST | `/api/cron/sync-quotes` | `index.js` | Cron-safe version of above (x-cron-secret) |
| PATCH | `/api/jobs/:id` | `routes/jobs.js` | Update job fields; fires Cliq DM when tech changes |
| GET | `/api/jobs/:id/workdrive-folder` | `routes/jobs.js` | Returns public `zohoexternal.com` link — creates one if needed |
| POST | `/api/jobs/:id/photos` | `routes/jobs.js` | Uploads images to job's WorkDrive folder |
| POST | `/webhooks/zoho-books` | `routes/webhook.js` | Zoho Books invoice event → marks job as invoiced |
| POST | `/webhooks/zoho-books-estimate` | `routes/webhook.js` | Zoho Books estimate created/updated → triggers sync-quotes |
| POST | `/api/books/invoices/from-job` | `routes/books.js` | Creates insurance + shop invoices from a job |
| POST | `/api/notifications` | `routes/notifications.js` | Create in-app notification + email + Cliq |
| GET | `/api/notifications` | `routes/notifications.js` | Fetch notifications for user |
| POST | `/api/postscan/run` | `routes/postscan.js` | Read postscan@ email → extract RO# → upload PDF to WorkDrive |
| POST | `/api/mail-agent/run` | `routes/mail-agent.js` | Triage inbox emails with Claude, draft replies |
| GET | `/api/crm-reminder/run` | `routes/crmReminder.js` | Daily email to Mark: overdue CRM follow-ups |

---

## Kanban Board (`client/src/components/KanbanBoard.jsx`)

### Columns (in order)
`job_requested` → `need_dispatch` → `dispatched_jaden` → `dispatched_mark` → `pending_parts` → `ready_invoice` → `complete`

### Two card components — important
- **Desktop**: `KanbanCard` — full action buttons, drag-and-drop
- **Mobile** (`< 768px`): `MobileJobCard` — separate simpler component. Accepts: `job`, `onEdit`, `onMoveToReadyInvoice`, `onCreateInvoices`. Top section tappable for edit. Shows "Ready to Invoice" (purple) or "Create Invoices" (green) button at bottom.
- When adding buttons/features to cards, you must update **both** components.

### Key handlers in KanbanBoard
- `handleMoveToReadyInvoice(job)` — PATCHes status to `ready_invoice`, optimistic update
- `handleOpenWorkDrive(job)` — GETs `/api/jobs/:id/workdrive-folder`, opens zohoexternal.com link
- `setInvoicingJob(job)` — opens invoice creation modal
- `handleComplete(job)` — marks complete, logs to completions cache

---

## Zoho WorkDrive Integration

- **Share link creation**: `services/workdrive.js` → `createShareLink(folderId, folderName, accessToken)`
- **role_id: 34** = Viewer for folders → generates `zohoexternal.com` public links (CORRECT)
- **role_id: 6** = View & Comment for Zoho Docs only → always 400 on folders (WRONG)
- **link_name max length**: ~50 chars. Zoho error F6005 = name too long. Always use `"Job {RO#}"` format.
- **URL regex**: workspace browser URLs use `/folders/` (plural). All regexes must be `/folders?/` to match both `/folder/` and `/folders/`.
- **List existing links**: `GET /files/{folderId}/links` — check before creating to avoid duplicates
- **Flow**: already public? return immediately → have internal URL? convert → no URL? search by RO# or shop/vehicle → create share link → save back to job

---

## Cliq Notifications (`services/cliq.js`)

- All Cliq sends use `ZOHO_CLIQ_REFRESH_TOKEN` OAuth (not zapikey webhooks)
- **Self-DM restriction**: Mark's token can't DM Mark's own account (`buddies_self_message_restricted`)
  - Fix: use `postToCliqChannelById(MARK_ALERT_CHANNEL_ID, msg)` for Mark
  - `MARK_ALERT_CHANNEL_ID = 'P6015142000000718001'`

### TECH_CLIQ_IDS
```js
Mark:   858216366          // use channel instead of DM (self-DM blocked)
Kat:    914153354
Kath:   914153354
Jaden:  'jayden@absoluteadas.com'
Jayden: 'jayden@absoluteadas.com'
```

### Channels
```
#technicians  — name: 'technicians', Channel ID: O6015142000000681005, Chat ID: CT_1423989185010509377_883116359
Mark alerts   — Channel ID: P6015142000000718001  (MARK_ALERT_CHANNEL_ID constant)
```
Both exported from `services/cliq.js` as `TECHNICIANS_CHANNEL` and `MARK_ALERT_CHANNEL_ID`.

### When notifications fire
| Trigger | Who gets notified | Message style |
|---------|-------------------|---------------|
| Job assigned/reassigned | Tech (DM) + `#technicians` channel | Rich: shop, vehicle, VIN, insurer, date, full cal list, notes, quote#, WorkDrive/report URLs |
| Job → ready_invoice | Kat (DM) | Simple |
| New quote synced from Zoho | Mark (channel) + salesperson if not Mark | Simple |
| Invoice created (books.js) | Mark | Simple |
| Billing reminders sent | Kat | Simple |
| Zoho Books invoice webhook | Mark's alert channel | Simple |

---

## Quote → Kanban Sync Flow

1. Quote created in Zoho Books
2. Zoho Books fires webhook → `POST /webhooks/zoho-books-estimate`
3. Handler calls `performSyncQuotes(req)`
4. Estimates with status `draft`, `sent`, or `accepted` get imported as jobs at `need_dispatch`
5. Cliq alert fires: Mark (always) + salesperson (if not Mark)
6. Existing jobs only deleted if still at `need_dispatch` — progressed jobs are never auto-deleted

**Zoho Books webhook config** (one-time setup in Zoho Books console):
- Settings → Integrations → Webhooks → New Webhook
- Event: Estimate → Created (+ optionally Updated)
- URL: `https://adas-iq-904191467.development.catalystserverless.com/server/adasiq-api/webhooks/zoho-books-estimate`
- Header: `x-webhook-secret: {WEBHOOK_SECRET env var value}`

**Zoho estimate field → job field mapping:**
- `customer_name` → `shop_name`
- `salesperson_name` → `technician`
- `cf_year`, `cf_make`, `cf_model`, `cf_vin`, `cf_insurer` → vehicle fields
- `estimate_number` → `quote_number`
- `cf_scan_report_and_documentation` → `folder_url`

---

## Environment Variables (Catalyst env vars on `adasiq-api`)

| Var | Used for |
|-----|---------|
| `ZOHO_CLIENT_ID` / `ZOHO_CLIENT_SECRET` | Zoho OAuth |
| `ZOHO_REFRESH_TOKEN` | Zoho Books/CRM API |
| `ZOHO_MAIL_REFRESH_TOKEN` | Zoho Mail API |
| `ZOHO_CLIQ_REFRESH_TOKEN` | Cliq messaging |
| `ZOHO_WORKDRIVE_REFRESH_TOKEN` | WorkDrive API |
| `WEBHOOK_SECRET` | Zoho Books webhook auth (`x-webhook-secret` header) |
| `SYNC_QUOTES_CRON_SECRET` | Cron auth for sync-quotes |
| `POSTSCAN_CRON_SECRET` | `postscan-2026` |
| `BACKUP_CRON_SECRET` | `backup-2026` |
| `MAIL_AGENT_CRON_SECRET` | Mail agent cron |
| `CRM_CRON_SECRET` | CRM reminder cron |
| `CATALYST_PROJECT_ID` | Datastore/Cache API calls |
| `CLIENT_URL` | OAuth redirect, set per environment |

---

## PostScan Flow

Hourly cron reads `postscan@absoluteadas.com` inbox → extracts RO# from subject → finds WorkDrive folder → uploads PDF attachments → marks email read.

- Mail folder ID: `147686000000057026` (SCAN REPORTS folder)
- Zoho Mail messageIds are > MAX_SAFE_INTEGER — must be treated as strings (use `safeParseMailResponse()`)
- WorkDrive `/files/{id}/files` does NOT accept query params (F6012) — no params, returns ~50 items
- WorkDrive upload response: `data[0].attributes.resource_id`

---

## Cron Jobs (Catalyst console)

| Name | Endpoint | Schedule | Secret |
|------|----------|----------|--------|
| postscan-fetcher | POST `/api/postscan/run` | Every 60 min | `postscan-2026` |
| backup | GET `/api/backup/run` | Every 5 hours | `backup-2026` |
| mailagenthourly | POST `/api/mail-agent/run` | Every 1 hour | `MAIL_AGENT_CRON_SECRET` |
| garmindailysync | POST `/api/garmin/sync` | Daily 03:00 PT | `GARMIN_CRON_SECRET` |
| crm-reminder | GET `/api/crm-reminder/run` | Daily 07:30 PT | `CRM_CRON_SECRET` |

---

## Calibration Review Modal (added 2026-05-16)

`client/src/components/CalibrationReviewModal.jsx` — mobile-first bottom sheet

- Intercepts "Ready to Invoice" click everywhere (sets `calReviewJob` state instead of immediately PATCHing)
- Shows current job calibrations with ✕ remove buttons (min 52px tap targets)
- Top 10 quick-add chips from `GET /api/jobs/top-calibrations` (historical frequency)
- "+ More" caret → searchable dropdown from `GET /api/calibration-rules`
- Added cals store `{ name, cal_type, rule_id }` — rule_id used for report enrichment
- "Done" button: PATCH calibrations + PATCH status → ready_invoice in one call
- PCSI and POST shown as always-included badges (not editable — they're standard)

## ADAS IQ Calibration Report (updated 2026-05-16)

Report generation MOVED from quote creation to post-invoice.

**Before (wrong):** Generated in `services/zoho.js createDraftQuote()` when Kinetic report uploaded — reflected original quote, not final work done.

**After (correct):** Generated in `routes/books.js generateAndUploadReport()` called after `POST /api/books/invoices/from-job` succeeds.

- Source of truth: actual invoice line items (guaranteed to match the bill)
- All calibrations are `enabled: true` / REQUIRED (if billed, it was required)
- Enriched with OEM justification text from `AdasCalibrationRules.justification_template`
- `{make}` and `{model}` placeholders filled in from job data
- Uploaded to WorkDrive folder (creates one if missing), share link saved to job
- Non-blocking — fires after `res.json()` so it doesn't delay invoicing response
- Purpose: insurance defense document — justifies every billed calibration with OEM language

**`generateADASIQPdf` signature** (`services/pdf.js`):
```js
{ shop, ro_number, insurer, vin, vehicle, year, make, model, claim, calibrations, document_links }
// calibrations: [{ calibration_name, enabled, cal_type, trigger, justification, links }]
```

## Known Quirks & Past Bug Fixes

- **WorkDrive role_id**: must be `34` (integer) for folder Viewer. `'6'` or `6` = Zoho Docs only, always 400 on folders.
- **WorkDrive link_name**: Zoho error F6005 = name > ~50 chars. Use `"Job {RO#}"`.
- **WorkDrive URL format**: workspace browser URLs use `/folders/` (plural). Regex must be `/folders?/`.
- **Cliq self-DM**: `buddies_self_message_restricted` when token user tries to DM themselves. Use channel post for Mark.
- **Catalyst cache admin token**: `catalystHeaders()` must use `Catalyst-Cred-Token` scheme for admin tokens (not `Zoho-oauthtoken`). Wrong scheme → 403 on cache POST.
- **ROWID precision**: Catalyst Datastore ROWIDs > MAX_SAFE_INTEGER. Never `Number(rowId)` — always string.
- **Zoho Mail large IDs**: same precision issue — use `safeParseMailResponse()` before JSON.parse.
- **No FF after response**: `await Promise.all([email, cliq])` before `res.json()` — don't fire-and-forget.
