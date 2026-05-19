# Absolute ADAS Marketing Agent
## Claude Code Engineering Brief v1.0
## Project codename: Capture
## Date: May 19, 2026
## Owner: Mark Fowler

---

## 0. READ THIS FIRST (CONTEXT FOR CLAUDE CODE)

You are building an autonomous-with-approval marketing agent for Absolute ADAS, a mobile ADAS calibration company in the Seattle area. The agent's job is to produce, schedule, publish, and learn from social media and SEO content targeting collision shop owners.

**The agent is a force multiplier for a 4-person team:**
- Mark Fowler (founder, voice, approver, strategy)
- Kat (offshore ops/admin, daily operator)
- Jaden Goshorn (W-2 field tech, content capture during real calibration jobs)
- Joyce (offshore bookkeeper, ROI reporting)

**Operating principle:**
The agent drafts 5x what ships. Mark approves with 1-click in Zoho Cliq. The agent never auto-publishes during the first 30 days of voice calibration. After 30 days, content categories with 80%+ thumbs-up rate transition to auto-post.

**Reference documents you must read before writing any code:**
- `prompts/master_prompt_v2.5.md` (the strategic playbook: Sabri Suby/Hormozi framework, voice rules, channel cadence, keyword bank, case study templates, Magic Lantern, Grand Slam Guarantee)
- `prompts/voice_samples/` (Mark's actual writing, to be added)
- `data/keyword_bank.json` (AnswerThePublic data)

---

## 1. PROJECT GOAL AND SUCCESS CRITERIA

### What "done" looks like

**30-day milestone:**
- Agent infrastructure live on Zoho Catalyst
- 3 LinkedIn posts/week shipping (Mark's personal profile)
- Cliq approval workflow with 1-click thumbs-up/down operational
- Voice calibration achieving 80%+ thumbs-up rate by day 30
- Capture Rate Calculator live on absoluteadas.com
- Website AI SEO audit complete with prioritized action list

**60-day milestone:**
- 5 LinkedIn posts/week + 3 IG/week + 3 FB/week
- 7-email nurture sequence deployed for Calculator opt-ins
- Pillar blog post live ("ADAS Calibration Cost: What You're Really Paying For")
- 3 service area landing pages live (Lake Stevens, Everett, Seattle)
- Schema markup on all key pages
- Approved content categories auto-posting

**90-day milestone:**
- 19+ posts/week steady state across all channels
- 7 service area landing pages live
- 50+ Calculator opt-ins captured
- 5-10 audit calls booked from inbound
- 2-4 new partner shops onboarded
- Agent self-tuning based on engagement signals

### Non-goals (out of scope for v1)

- Paid advertising automation (manual ad creation for now)
- Video editing pipeline (Jaden's footage handed to human editor)
- CRM-side automation (Kat handles lead routing manually in Zoho CRM)
- AI image generation (humans select/upload images for v1)

---

## 2. STACK DECISIONS (LOCKED)

- **Compute:** Zoho Catalyst (functions + cron jobs)
- **Storage:** Zoho Catalyst Data Store + Zoho WorkDrive (asset storage)
- **Approval UI:** Zoho Cliq bot with inline action buttons
- **AI layer:** Anthropic Claude API
  - Claude Sonnet 4.6 (`claude-sonnet-4-6`) for drafting and routine tasks
  - Claude Opus 4.7 (`claude-opus-4-7`) for strategic planning and voice calibration
- **Publishing APIs:**
  - LinkedIn Marketing API (personal + company page)
  - Meta Graph API (FB + IG)
  - Zoho Campaigns (email)
  - YouTube Data API v3 (manual upload v1, automated v2)
- **Website:** GitHub Pages (existing), Jekyll static site generator, deploys via GitHub Actions
- **CRM:** Zoho CRM (lead capture from Calculator routes here)
- **Analytics:** Zoho PageSense + native platform analytics

### Why this stack
Mark already pays for Zoho One. Adding Catalyst stays inside the same vendor relationship and billing. Cliq is where Mark already lives during the workday. GitHub Pages is current website hosting — no migration risk. Anthropic Claude API for the AI layer because Mark already has working knowledge of Claude.

---

## 3. REPOSITORY STRUCTURE

Create the following structure:

```
absolute-adas-agent/
├── README.md
├── .env.example
├── package.json
├── catalyst.json
├── prompts/
│   ├── master_prompt_v2.5.md            (copy from existing master prompt)
│   ├── post_draft_system_prompt.md      (you write this, scoped per platform)
│   ├── blog_post_system_prompt.md       (you write this)
│   ├── email_system_prompt.md           (you write this)
│   ├── voice_calibration_prompt.md      (you write this)
│   └── voice_samples/                   (Mark fills this in)
│       ├── README.md
│       ├── mark_linkedin_examples.md
│       ├── mark_email_examples.md
│       └── mark_adas_brew_examples.md
├── data/
│   ├── keyword_bank.json                (seed from current ATP data)
│   ├── content_calendar.json
│   ├── case_studies/                    (Mark/Kat populate over time)
│   ├── post_history.json
│   ├── voice_fingerprint.json           (auto-built from approvals)
│   └── kill_rules.json
├── src/
│   ├── agent/
│   │   ├── draft_generator.js
│   │   ├── voice_scorer.js
│   │   ├── content_scheduler.js
│   │   └── feedback_loop.js
│   ├── publishers/
│   │   ├── linkedin.js
│   │   ├── meta.js
│   │   ├── zoho_campaigns.js
│   │   └── github_pr.js
│   ├── approval/
│   │   ├── cliq_bot.js
│   │   └── approval_workflow.js
│   ├── analytics/
│   │   ├── engagement_collector.js
│   │   └── performance_scorer.js
│   └── lib/
│       ├── claude_client.js
│       ├── zoho_catalyst.js
│       └── logger.js
├── functions/                           (Catalyst serverless functions)
│   ├── daily_draft_batch/               (cron: 4am Pacific)
│   ├── cliq_approval_handler/           (webhook from Cliq bot)
│   ├── scheduled_publish/               (cron: every 15 min)
│   ├── engagement_collector/            (cron: hourly)
│   └── weekly_report/                   (cron: Fri 6am Pacific)
├── website/                             (Jekyll source for absoluteadas.com)
│   ├── _config.yml
│   ├── _includes/
│   │   ├── schema_local_business.html
│   │   ├── schema_faq.html
│   │   └── schema_service.html
│   ├── _layouts/
│   ├── _service_areas/                  (one MD file per area)
│   ├── _posts/                          (blog posts)
│   ├── tools/
│   │   └── capture_calculator/          (the lead magnet)
│   └── _data/
│       └── ai_seo_keywords.yml
└── tests/
    ├── voice_scorer.test.js
    ├── kill_rules.test.js
    └── publishers.test.js
```

---

## 4. THE AGENT CORE

### Voice calibration system (THE most important module)

The agent's #1 job in days 1-30 is learning Mark's voice. Build this first.

**`src/agent/voice_scorer.js` must:**

1. Maintain a `voice_fingerprint.json` file with these dimensions:
   - Sentence length distribution (Mark writes short)
   - Em dash count per 1000 words (must stay at 0)
   - First-person frequency
   - Question-to-statement ratio
   - Industry jargon density (shop owner terms: GP%, capture rate, sublet, DRP, severity, touch time, RO, retail vs trade, comeback, supplement)
   - Banned phrase count (delve, leverage, in today's fast-paced, elevate, unlock, synergy, robust)
   - Story-vs-bullet preference (Mark prefers story when length allows)
   - Opening pattern (pattern interrupt, never "Are you a shop owner who...")

2. Before any draft ships to Cliq, score it 0-100 against the fingerprint. Scores below 70 get re-drafted automatically (max 3 retries).

3. After each Mark approval/rejection, update the fingerprint:
   - Thumbs-up: weight the draft's dimensions into the fingerprint at 0.05
   - Thumbs-down: weight inversely (the draft's dimensions become anti-targets) at 0.10
   - Mark-edited-then-approved: parse the diff, weight Mark's edits at 0.15

4. Export weekly voice drift report Friday morning to Mark's Cliq.

### Draft generator

**`src/agent/draft_generator.js` must:**

1. Read master prompt v2.5 + voice samples + keyword bank + recent post history
2. Generate posts per channel per content category. Each draft includes:
   ```json
   {
     "id": "uuid",
     "channel": "linkedin_personal",
     "category": "story_post" | "framework_post" | "case_study" | "educational",
     "scheduled_for": "2026-05-26T13:30:00Z",
     "draft_text": "...",
     "image_brief": "...",
     "image_status": "needs_upload" | "ai_prompt_only" | "field_capture_assigned",
     "hook_variant": "greed" | "fear" | "identity" | "curiosity",
     "proof_variant": "case_study" | "authority" | "founder_story",
     "cta_variant": "calculator" | "audit" | "direct",
     "voice_score": 87,
     "kill_metric": "min_200_impressions_24h",
     "magic_lantern_reference": true,
     "keyword_anchor": "adas calibration cost"
   }
   ```

3. Always produce 3 variants per scheduled slot (axis: hook/proof/CTA). Mark picks the winner via Cliq.

4. Never invent: case study names, dollar figures, shop owner names, statistics. If a real data point isn't in `data/case_studies/`, use the composite label flag.

### Content scheduler

**`src/agent/content_scheduler.js` must enforce the cadence from the master prompt:**

Days 1-14 (calibration phase):
- LinkedIn personal: Mon/Wed/Fri at 6:30am Pacific only
- All other channels paused

Days 15-30:
- LinkedIn personal: Mon-Fri at 6:30am Pacific (5/week)
- IG company: Mon/Tue/Thu 11:30am Pacific (3/week)
- FB company: Mon/Wed/Fri 12:00pm Pacific (3/week)

Days 31-60:
- Above plus daily IG stories (auto-pulled from Jaden's WorkDrive uploads)
- 2 IG reels/week
- 1 YouTube video/week (Tuesday 6am, manual upload v1)
- Email nurture (auto-triggered on Calculator opt-in)

Days 61-90:
- Full cadence per master prompt v2.5

### Feedback loop

**`src/agent/feedback_loop.js` must:**

1. Pull engagement data hourly (impressions, reactions, comments, clicks, opt-ins)
2. Update each post's record with rolling 24h/72h/7d metrics
3. Apply kill rules from `data/kill_rules.json`:
   - <200 impressions in 24h on LinkedIn → variant marked dead
   - <50 IG reach in 48h → variant marked dead
   - 0 engagement in 7d on FB → variant marked dead
4. Feed winning variants back into the keyword/angle/hook bank with elevated weight
5. Surface kill rules triggered in Friday Cliq report to Mark

---

## 5. POSTING PIPELINE (THE DAILY LOOP)

### 4:00am Pacific (daily) — `daily_draft_batch`

1. Generate next 24h of drafts across all active channels
2. Score each against voice fingerprint
3. Re-draft anything below 70 (max 3 retries)
4. Post 3 variants per scheduled slot to Mark's Cliq approval channel

### Mark's Cliq experience (target: under 10 seconds per decision)

The Cliq bot DMs Mark each morning with a card per scheduled post:

```
─────────────────────────
LinkedIn post • Mon 6:30am
Category: Story post
Voice score: 87/100
Keyword: adas calibration cost
─────────────────────────

VARIANT A (greed hook):
[draft text, max 200 words]

VARIANT B (fear hook):
[draft text]

VARIANT C (identity hook):
[draft text]

[👍 Approve A]  [👍 Approve B]  [👍 Approve C]
[✏️ Edit]  [❌ Kill all]  [⏸ Defer]
```

If Mark hits Edit, the bot opens an inline text field. Mark types corrections. Bot saves diff for voice fingerprint update.

If Mark doesn't respond by 5:30am Pacific (1 hour before scheduled post), bot sends a single nudge. If no response by post time, post is auto-deferred 24 hours, NOT auto-published. Voice training mode means silence = defer.

After day 30, if a category has hit 80%+ thumbs-up over the prior 14 days, that category's posts transition to a "silent auto-publish with post-hoc review" mode. Mark sees them after they ship in a Friday digest.

### Every 15 minutes — `scheduled_publish`

1. Query approved drafts where scheduled_for is within the next 15 minutes
2. Publish to the correct channel via API
3. Update post_history.json with platform post ID
4. Send Mark a Cliq "shipped" notification with the live link

### Hourly — `engagement_collector`

Pull metrics for all posts shipped in the last 7 days. Update post_history.json. Apply kill rules.

### Friday 6am Pacific — `weekly_report`

Cliq message to Mark with:
- Week's posts shipped vs. drafted
- Voice score trend
- Top 3 performers
- Bottom 3 performers (and what was killed)
- Calculator opt-ins this week
- Joyce's spend/ROI summary (pulled from Zoho Books)
- Recommended changes for next week

---

## 6. THE CAPTURE RATE CALCULATOR

This is the central lead magnet. The agent points all CTAs to it. Build it before any social content ships.

### Functional requirements

**Inputs (form on absoluteadas.com/tools/capture-calculator):**
- Calibrations subbed out per month (number)
- Average sublet ticket charged to customer (dollar)
- Current capture % on sublet (slider 0-30%, default 10%)
- Shop name
- Owner first name
- Email
- Phone (optional)

**Outputs (instant on screen + PDF emailed):**
- Current annual revenue from calibrations: [calculations]
- Current annual GP captured: [shown in red]
- Annual GP if captured at 30%: [shown in green]
- Annual GP difference (the leak): [shown big]
- 5-year compound difference: [shown bigger]
- "What this means" paragraph customized to their number
- CTA: Book a 15-minute Revenue Audit

**Backend:**
- POST to a Catalyst function that:
  1. Saves the lead to Zoho CRM (new module: "Calculator Leads")
  2. Generates a personalized PDF report (use puppeteer or similar)
  3. Emails the PDF via Zoho Campaigns + triggers the 7-email nurture
  4. Posts a Cliq notification to Mark + Kat

**Tech notes:**
- Plain HTML/CSS/JS, no React for v1 (keep simple, hostable on GitHub Pages)
- Form validation client-side
- PDF generation server-side (Catalyst function)
- All math transparent in JS (no hidden assumptions)
- Mobile responsive (shop owners use phones)

---

## 7. WEBSITE AI SEO BUILD

### Audit phase (week 1)

Run an audit of the current GitHub-hosted absoluteadas.com. Output a markdown report covering:

1. Current page inventory
2. Schema markup status (likely none)
3. Meta description quality
4. Internal linking structure
5. Mobile performance (Core Web Vitals)
6. Existing content gaps vs. keyword bank
7. Sitemap and robots.txt status
8. Google Business Profile alignment
9. Current AI model citation status (test by asking ChatGPT and Gemini "best mobile ADAS calibration in Seattle" — is Absolute ADAS mentioned?)

### Build phase (weeks 2-8)

#### Pillar blog post (week 2)

Title: "ADAS Calibration Cost: What You're Really Paying For (2026)"

Requirements:
- 3,000-4,000 words
- Target keyword: "adas calibration cost" (2,400 searches/month)
- Answers all 11 People Also Ask questions from the keyword bank
- FAQ schema markup
- Internal links to service area pages (when built) and Calculator
- Featured image with alt text
- 3-5 embedded original photos (Jaden captures during real jobs)
- Author bio: Mark Fowler
- Last updated date prominent
- "How to cite this article" section (helps AI models)
- Sources cited inline (SCRS position statements, OEM service info, I-CAR)

#### Service area landing pages (weeks 3-5)

One page per service area. Build in this order:
1. Lake Stevens (home base)
2. Everett
3. Seattle
4. Bellevue
5. Lynnwood
6. Monroe
7. Tacoma

Each page (800-1200 words):
- H1: "Mobile ADAS Calibration in [City], WA"
- LocalBusiness + Service schema markup
- 3 hyperlocal references (landmarks, dealerships, body shops in that city)
- Embedded Google Map (Catalyst handles, or use static map)
- "Service areas we cover near [City]" with neighboring zip codes
- Customer testimonial (when available, composite labeled until then)
- Same FAQ structure pulled from pillar post
- CTA to Capture Calculator

#### Schema markup (week 6)

All pages get:
- Organization schema (root)
- LocalBusiness schema (every page)
- Service schema (service area pages)
- FAQ schema (pillar + service pages)
- BreadcrumbList schema
- Article schema (blog posts)
- Review schema (when reviews exist)

#### AI SEO specifics

This is what makes the site discoverable by AI models (ChatGPT, Gemini, Perplexity):

1. **llms.txt file at root** describing the site, services, expertise, contact info. AI crawlers reference this.

2. **Structured FAQ blocks** with exact-match questions from the keyword bank. AI models pull these for citations.

3. **Citation-ready content blocks**: Every claim has a date, a source link, and a clear authority signal. AI models prefer content they can cite.

4. **Author E-E-A-T signals**: Mark's bio page with credentials (50k+ calibrations, State Farm DRP, OEM-certified, years in industry). Schema-marked.

5. **Directory presence**: Get Absolute ADAS listed on:
   - Google Business Profile (verified, optimized)
   - Bing Places
   - Apple Maps
   - Yelp
   - BBB
   - Angi
   - RepairPal
   - I-CAR Gold Class directory (if eligible)
   
   Build a tracking sheet for which directories are live.

---

## 8. CLIQ BOT IMPLEMENTATION DETAILS

### Bot identity

- Name: "Capture Agent"
- Avatar: Absolute ADAS logo
- Presence: Always online

### Channels to create

- `#capture-approvals` (Mark + Kat, Mark is primary approver)
- `#capture-shipped` (Mark + Kat, notifications only)
- `#capture-engagement` (Mark + Kat, hourly metrics digest)
- `#capture-leads` (Mark + Kat, new Calculator opt-ins)

### Bot commands

- `/status` — current week's posting status
- `/voice` — current voice score trend
- `/leads` — Calculator opt-ins this week
- `/kill [post_id]` — manually kill a post variant
- `/pause [channel]` — pause publishing on a channel
- `/resume [channel]` — resume

### Approval card UX (CRITICAL)

The 1-click approval is the highest-friction interaction. It must be:
- Phone-friendly (Mark approves from F3 mornings, between calibrations)
- One thumb operable
- 10 seconds max from notification to decision
- No scrolling required for variant A
- Edit mode opens inline, doesn't switch contexts

If you can't make this work cleanly in Cliq's UI, fall back to a custom mini-web-app accessed via a Cliq link that renders the card in a mobile-optimized view.

---

## 9. SECURITY AND OPERATIONAL CONCERNS

### Secrets management

All API keys live in Catalyst's environment variables:
- `ANTHROPIC_API_KEY`
- `LINKEDIN_ACCESS_TOKEN` + `LINKEDIN_PERSON_URN`
- `META_ACCESS_TOKEN` + `META_AD_ACCOUNT_ID` + `META_PAGE_ID` + `META_IG_USER_ID`
- `ZOHO_CAMPAIGNS_TOKEN`
- `ZOHO_CRM_TOKEN`
- `ZOHO_CLIQ_BOT_TOKEN`
- `GITHUB_TOKEN` (for website PRs)

### Rate limits

- Claude API: respect tier limits, implement exponential backoff
- LinkedIn API: 100 posts/day max (we'll use <20)
- Meta API: 200 calls/hour per user token
- Build in retry queues with jitter

### Failure modes to handle

- API down → defer post, alert Mark in Cliq
- Voice score persistently low → halt drafting, alert Mark, do not silently degrade
- Mark unreachable → defer, don't publish
- Catalyst function timeout → break into smaller chunks
- All publishing failures → write to a dead letter queue, retry every 30 min, alert after 3 fails

### Compliance

- GDPR-style email opt-out on every Calculator follow-up email
- LinkedIn TOS: posts must originate from authenticated user account, no automation language in posts
- Meta TOS: same
- No fake engagement, no follow-for-follow schemes, no engagement pods

---

## 10. PHASED ROLLOUT (WEEK BY WEEK)

### Week 1: Foundation
- Set up repo, Catalyst project, env vars
- Build voice_scorer with seed fingerprint from master prompt
- Build Cliq bot (basic message → button → response)
- Mark provides 5-10 voice samples in voice_samples/
- Build the Capture Rate Calculator (HTML/CSS/JS + Catalyst function)
- Run website audit

### Week 2: First posts
- Connect Claude API
- Build draft_generator with master prompt v2.5
- Generate first batch of 9 LinkedIn drafts (3 slots x 3 variants)
- Mark approves in Cliq
- Manually publish (LinkedIn API integration ongoing)
- Write pillar blog post draft

### Week 3: Publishing automation
- LinkedIn API integration live
- First auto-published post (after Mark approval)
- Voice fingerprint updating from approvals
- Engagement collector running
- Pillar blog post live on website
- First service area page live (Lake Stevens)

### Week 4: Multi-channel
- Meta Graph API integration
- IG + FB drafts in approval queue
- 3 more service area pages live
- Schema markup deployed
- llms.txt live

### Weeks 5-8: Scale
- Hit full cadence per master prompt v2.5
- 7-email nurture sequence live in Zoho Campaigns
- All 7 service area pages live
- Auto-post transitions for proven categories
- Friday weekly report flowing

### Weeks 9-12: Optimize
- Performance scorer tuning
- Kill rules refinement
- Voice fingerprint stable
- Mark spending less than 30 min/week on approvals
- Inbound leads converting

---

## 11. OPEN QUESTIONS FOR MARK

Before you start, get answers to:

1. Does Mark have a LinkedIn Marketing Developer Platform app approved? (Required for posting via API; approval takes 1-2 weeks)
2. Does Mark have a Meta Business verification completed? (Required for IG/FB posting)
3. What's the current absoluteadas.com tech stack exactly? (Jekyll? Hugo? Plain HTML? This determines website integration approach)
4. Does Kat have Zoho CRM admin access? (Needed to create the Calculator Leads module)
5. Where do Jaden's field uploads go today, if anywhere? (Need to wire that to the agent's content library)

---

## 12. SUCCESS METRICS (REPORT THESE WEEKLY TO MARK)

- Posts shipped vs. drafted (efficiency)
- Average voice score (calibration)
- Mark's approval rate (voice fit)
- Mark's edit-then-approve rate (drift signal)
- Mark's time-in-Cliq per day (target: under 15 min)
- LinkedIn engagement rate (industry baseline: 2-3%, target: 4%+)
- Calculator opt-ins per week
- Audit calls booked
- Cost per opt-in (Anthropic API spend / opt-ins)
- Cost per booked audit
- Cost per onboarded partner shop

---

## 13. FINAL NOTES

- Read `prompts/master_prompt_v2.5.md` cover-to-cover before writing any code. It contains the strategic frame everything else hangs on.
- The agent is not creative on its own. It executes Mark's strategy with consistency and scale. Voice fidelity > volume.
- When in doubt, fail loud not silent. Mark would rather see "couldn't generate today" than ship something off-voice.
- Build for Kat as a future power-user. She'll eventually take over the daily approvals if Mark drops to weekly-only.
- This system must work when Mark is on the Rome trip July 15-23, 2026. By then, auto-post categories should cover the 9 days of absence.

End of brief.
