---
name: scrub-accuracy
description: Checks Absolute ADAS scrubber accuracy against the Kinetic benchmark and the live scrub library. Use when Mark says check the scrubber, scrub accuracy, bench the scrubber, did we miss a calibration, false positive, false negative, Kinetic mismatch, or tune the scrub prompt/guard.
---

# Scrub accuracy agent

Kinetic is the **reference, not the truth**. We over-call on purpose (safer bill). A "false positive" is often a defensible extra. A **miss (FN) is the dangerous one** — that is a calibration we should have required and did not.

## Do this first

```bash
python3 bench/check.py
```

Optional:

```bash
python3 bench/check.py --refresh          # pull live library, then score
python3 bench/check.py --vin 1GKS2DKL     # one car (VIN prefix ok)
python3 bench/check.py --source benchmark-v8m
```

`--refresh` hits `GET /api/crm-sync-cron/scrubs-export` with `x-cron-secret: crm-sync-2026` and writes `bench/scrubs.json`. Do not invent another secret.

Then read `bench/check_report.json` if you need the structured pairs.

**Target: 90% recall on the UNION of every other scrubber.** If Kinetic, Identifix, or 1Source required it, we should have it. Precision can stay lower — we over-call on purpose. Drop more ID JSON into `bench/keys/` (`identifix.json`, `onesource.json`, same VIN → `{required, vehicle, detail}` shape as `kinetic.json`).

## Feedback → the scrubber learns by itself

After every scrub Mark can tap **Missed** (should have been required) or **Extra** (should not) on a line. That:

1. Flips the line on this car.
2. Stores a lesson in AppConfig `scrub_lessons` (`GET /api/scrubs/lessons`).
3. The **next** CCC scrub of that make applies active lessons after the guard (`applyLessons` in `services/scrubLearn.js`).

Require-lessons apply on the first tap. Drop-lessons need two confirms and never override a guard flip.

Editing lines and saving also records the diff as lessons. When Mark tells you a correction in chat, either:

- POST `/api/scrubs/:id/feedback` `{ sensor, action: "miss"|"extra" }`, or
- add a hard rule in `scrubGuard.js` if it is an OEM always-rule (windshield → camera, Mercedes bumper → radar).

Do not wait for a prompt rewrite when a lesson will do.

## How to read a mismatch

1. Look at **ours trigger + line numbers** vs **Kinetic trigger + lines** in the report.
2. Classify with the labels `check.py` already printed (`defensible` / `real` / `review`).
3. Only treat `real` misses as bugs. `defensible` over-calls stay.
4. Before changing `services/claude.js` (prompt) or `services/scrubGuard.js` (hard rules), name the VIN, the sensor, the estimate line, and whether the guard should have caught it.

## Do not

- Tune the prompt from one FP without the estimate line.
- Remove a guard rule to chase Kinetic precision. The guard only **adds** required — never thins a report.
- Score Full Service lines (TPMS, programming, battery resets) against Kinetic. They are not calibrations Kinetic grades.
- Show benchmark-source rows in the Scrubs UI. `listScrubs` already hides `source` starting with `benchmark`.

## Known defensible over-calls (we keep)

| We call | Kinetic often skips | Why we keep it |
|---|---|---|
| Headlamp Aim | Only a replaced module | We also call LED/adaptive R&I initialization |
| Front Radar | Bumper R&I on Toyota/Lexus, Honda/Acura, Nissan/Infiniti, Hyundai/Kia/Genesis, Mercedes, Ford/Lincoln | OEM / ADAS Integrity: fascia off = aim the radar |
| Steering Angle Sensor | After alignment | We call SAS after almost every alignment |
| Seat Weight Sensor | Honda/Acura/Mazda/Nissan any collision | Position statement / ALLDATA OCS check |
| Rear Blind Spot | Rear bumper cover R&I | Many OEMs require aim after bumper removal. Tesla is the exception: no blind spot sensors, so the row is dropped |

## Real bugs (fix these)

- **Miss (FN)** on a sensor Kinetic required — especially Seat Weight, Around View, Front Side Radar.
- **Front Windshield Camera** required when the glass was only masked / chip-repaired (not removed).
- **Camera after alignment on Honda/Acura** — Honda job aid says camera/radar are NOT required after alignment.
- **Front Radar on BMW/MINI** — radar is optional; guard cannot tell "no radar" from "untouched".
- **Windshield camera** from a liftgate / back glass line (Odyssey miss, 2026-09-28).

## Where the scrubber lives

| Piece | File | Role |
|---|---|---|
| Judgment | `functions/adasiq-api/services/claude.js` | Opus verdict on each sensor |
| Hard rules | `functions/adasiq-api/services/scrubGuard.js` | Haiku line hits + flips to required |
| Entry | `functions/adasiq-api/routes/extract.js` | PDF → text → Opus → guard → save |
| Score | `bench/bench_score.py` | Precision / recall vs Kinetic |
| Agent report | `bench/check.py` | All keys + union vs 90% + defensible vs real |
| Learn | `functions/adasiq-api/services/scrubLearn.js` | Lessons from Missed/Extra / edits |

Guard rules that must not regress: `AIM_AFTER_BUMPER`, `ALWAYS_AVC`, `SAS_AFTER_BATTERY`, `SWS_ANY_COLLISION`, `CAM_AFTER_ALIGN` (Honda excluded), `stripTeslaBlindSpot` (Tesla never gets a blind spot calibration). Details in [reference.md](reference.md).

## Report to Mark

Lead with the number that matters: **misses**, then over-calls that are actually wrong, then the Kinetic score.

```
Scrub accuracy
N cars paired · recall X% · precision Y% · exact Z/N
REAL misses: …
REAL over-calls: …
Defensible extras (kept): Headlamp N, Front Radar N, …
Worst car: YEAR MAKE MODEL — miss […] over […]
```

Shop-floor voice. No "false positive rate" lecture. If nothing is a real miss, say the scrubber is safe and Kinetic is just thinner than we are.

## After a prompt or guard change

1. Deploy the function (`npm run deploy:function` — runs the deploy gate).
2. `bash bench/bench_rerun.sh` re-scrubs the paired PDFs under `benchmark-vN`.
3. `python3 bench/check.py --source benchmark-vN`
4. Recall must not drop. Precision can stay low if the extras are defensible.
