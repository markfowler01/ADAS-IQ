# Dispatch Map + Tech Today — Wake-Up Setup

Mark, when you wake up, do these in order. Everything is deployed already; these are the external setup steps the code can't do.

## 1. Get a Mapbox access token (free)

1. Sign up at https://account.mapbox.com/ (free tier covers 50k map loads/month, plenty for us).
2. Create a public token. Default scopes are fine.
3. URL-restrict the token to your domains: `*.catalystserverless.com` and `localhost:5173`.
4. Add it to a local `.env` file at the repo root:

   ```
   VITE_MAPBOX_PUBLIC_TOKEN=pk.eyJ1...
   ```

5. Redeploy: `npm run deploy:staging`. Vite picks the token up at build time and bakes it into the bundle.

Without this, the dispatch map shows a "Map token not configured" placeholder; everything else (Today screen, geocoding cron) still works.

## 2. Enable Geocoding API on your existing Google key

You already have `GOOGLE_PLACES_API_KEY` set in Catalyst (used by the CRM "Search Places" feature). The geocoding cron reuses this same key. You just need to enable one more API on it.

1. Go to https://console.cloud.google.com/apis/library
2. Search for "Geocoding API"
3. Click **Enable** on the same project that owns your Places key.

No new env var to add. Free tier is 40k geocoding requests/month; we'll use ~30 per cron run.

## 3. Schedule the geocoding cron in Catalyst console

1. Catalyst console → your `adasiq-api` function → Cron Jobs → Add Cron.
2. Endpoint: `POST /api/cron/geocode-shops`
3. Schedule: **Daily, 03:00 PT** (or whenever; weekly is fine too, addresses rarely change).
4. Header: `x-cron-secret: <BILLING_CRON_SECRET value>` (reuses the existing billing-cron secret).

You can also hit it manually any time with the same header to force a backfill.

## 4. (Optional) Migrate to real Datastore columns

The new field state (drive order, en-route timestamp, started/completed timestamps, time windows, shop lat/lng) is currently stored in **Catalyst Cache** keys (`absolute_adas_job_state`, `absolute_adas_geocache`). This works fine and was chosen so the feature works without a schema migration.

If you want proper columns later, add these to the `Jobs` table:

| Column | Type | Notes |
|---|---|---|
| `drive_order` | INT | nullable |
| `en_route_at` | VARCHAR(64) | ISO timestamp |
| `started_at` | VARCHAR(64) | ISO timestamp |
| `completed_at` | VARCHAR(64) | ISO timestamp |
| `time_window_start` | VARCHAR(8) | `"HH:MM"` |
| `time_window_end` | VARCHAR(8) | `"HH:MM"` |

And these to the `CRMShops` table:

| Column | Type | Notes |
|---|---|---|
| `lat` | DECIMAL | nullable |
| `lng` | DECIMAL | nullable |
| `geocoded_at` | VARCHAR(64) | ISO timestamp |
| `geocode_status` | VARCHAR(16) | `ok`/`ambiguous`/`failed` |
| `geocode_source` | VARCHAR(16) | `google`/`manual` |

Then tell me and I'll move the code from cache reads to Datastore reads. No rush.

## 5. Tech home bases

Already recorded in `absolute_adas_tech_config`:

- **Mark:** 2307 Cedar Rd, Lake Stevens, WA
- **Jayden:** 13322 78th St SE, Lake Stevens, WA

Lat/lng will populate on the first cron run (or first manual `/api/cron/geocode-shops` call).

## 6. Smoke test order

1. Hit `POST /api/cron/geocode-shops` once manually to geocode existing CRM shops + tech home bases.
2. Open `/app/index.html` → click "Today" in the nav. Should show your jobs for today (if any are scheduled).
3. Click "Dispatch Map" in the nav. If you set the Mapbox token in step 1, you see the map. Otherwise a placeholder.
4. Tap a job card on Today → Navigate / Start / Complete. Complete still routes through the existing Calibration Review modal → Ready to Invoice → Kat notification (unchanged).

## What changed in the Kanban

Nothing visible should regress. The only addition is a "View on Map" link on each card. All existing flows (drag-and-drop, Ready to Invoice, Create Invoices, dispatch notifications) work exactly as before.
