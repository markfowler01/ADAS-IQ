# ADAS IQ

AI-powered calibration extraction and Zoho invoice creation for Kinetic calibration identification reports.

**Powered by Claude AI (claude-sonnet-4-6) · Zoho Invoice API**

---

## How It Works

1. Upload a Kinetic calibration PDF
2. Claude extracts all calibration systems, job details, and justifications
3. Review and toggle calibrations on/off
4. Hit **Create Zoho Invoice Draft** — a draft invoice is created in Zoho with one line item per calibration

---

## Prerequisites

- Node.js 20+
- An Anthropic API key
- A Zoho Invoice account with OAuth 2.0 credentials

---

## Get Your Anthropic API Key

1. Go to [console.anthropic.com](https://console.anthropic.com)
2. Sign in or create an account
3. Navigate to **API Keys** and click **Create Key**
4. Copy the key and add it to `.env` as `ANTHROPIC_API_KEY`

---

## Set Up Zoho Invoice OAuth 2.0

### Step 1 — Create a Self Client in Zoho API Console

1. Go to [api-console.zoho.com](https://api-console.zoho.com)
2. Click **Add Client** → choose **Self Client**
3. Note down your **Client ID** and **Client Secret**

### Step 2 — Generate an Authorization Code

1. In the Self Client page, click **Generate Code**
2. Enter these scopes (space-separated):
   ```
   ZohoInvoice.invoices.CREATE ZohoInvoice.invoices.READ ZohoInvoice.contacts.READ
   ```
3. Set duration to **10 minutes** (long enough to complete the next step)
4. Click **Create** and copy the **Authorization Code**

### Step 3 — Exchange for Refresh Token

Run this curl command (replace placeholders):

```bash
curl -X POST "https://accounts.zoho.com/oauth/v2/token" \
  -d "grant_type=authorization_code" \
  -d "client_id=YOUR_CLIENT_ID" \
  -d "client_secret=YOUR_CLIENT_SECRET" \
  -d "redirect_uri=https://www.zoho.com/books" \
  -d "code=YOUR_AUTHORIZATION_CODE"
```

The response contains `refresh_token` — copy it. **Save it somewhere safe; you only get it once.**

### Step 4 — Get Your Organization ID

1. Log into [invoice.zoho.com](https://invoice.zoho.com)
2. Go to **Settings → Preferences**
3. The Organization ID is shown at the top, or visible in the URL as `?organization_id=XXXXXXXX`

### Step 5 — Add to .env

```
ZOHO_CLIENT_ID=your_client_id
ZOHO_CLIENT_SECRET=your_client_secret
ZOHO_REFRESH_TOKEN=your_refresh_token
ZOHO_ORGANIZATION_ID=your_org_id
```

---

## Run Locally

```bash
# 1. Clone and enter the project
cd adas-iq

# 2. Copy and fill in your env file
cp .env.example .env
# Edit .env with your API keys

# 3. Install server dependencies
npm install

# 4. Install client dependencies
cd client && npm install && cd ..

# 5. Run both servers concurrently (frontend + backend)
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

The Express API runs on port 3001. The Vite dev server proxies `/api` requests to it automatically.

---

## Deploy to Railway

### 1. Push to GitHub

```bash
git init
git add .
git commit -m "Initial ADAS IQ build"
gh repo create adas-iq --private --source=. --push
```

### 2. Create a Railway Project

1. Go to [railway.app](https://railway.app) and sign in
2. Click **New Project** → **Deploy from GitHub repo**
3. Select your `adas-iq` repo

### 3. Add Environment Variables

In Railway project → **Variables**, add all keys from `.env.example`.

### 4. Set the Build & Start Commands

Railway auto-detects Node. In **Settings**:
- **Build Command:** `npm install && npm run build`
- **Start Command:** `npm start`

`npm run build` compiles the React client into `client/dist/`. The Express server then serves those static files in production.

### 5. Deploy

Railway deploys automatically on every push to `main`.

---

## Project Structure

```
adas-iq/
├── client/
│   ├── index.html
│   └── src/
│       ├── App.jsx
│       ├── index.css
│       ├── main.jsx
│       └── components/
│           ├── CalibrationRow.jsx
│           ├── JobCard.jsx
│           ├── ManualAddForm.jsx
│           ├── SummaryBar.jsx
│           ├── ToggleBoard.jsx
│           └── UploadScreen.jsx
├── server/
│   ├── index.js
│   ├── routes/
│   │   ├── extract.js
│   │   └── invoice.js
│   └── services/
│       ├── claude.js
│       └── zoho.js
├── .env.example
├── .gitignore
├── package.json
└── README.md
```
