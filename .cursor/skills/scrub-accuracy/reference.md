# Scrub guard + canon (read when scoring a mismatch)

## Sensor names (our list ↔ Kinetic)

`bench/check.py` and `bench/bench_score.py` fold names with the same regexes:

- Front Windshield Camera ← windshield / front camera / LKAS / Eyesight / Honda Sensing
- Front Radar ← ACC / Distronic / millimeter wave
- Front Side Radar ← front corner / front cross
- Rear Blind Spot Radar ← BSM / BLIS / RCTA / rear corner
- Around View Camera ← 360 / surround / bird
- Back Up Camera ← rear view / reverse / RCD
- Park Distance Sensor ← ultrasonic / PDC / Parktronic
- Steering Angle Sensor ← SAS
- Seat Weight Sensor ← OCS / occupant / passenger seat
- Side Camera ← LaneWatch / lane change
- Headlamp Aim ← headlamp / headlight
- Night Vision / Driver Monitor / Rear Radar (rear AEB)

Dropped vs Kinetic: TPMS, programming, battery-disconnect resets, PCSI, Rivian base inspection.

## Guard only adds required

`guardScrub` never demotes a required sensor to not-required. If we over-called, the fix is the prompt or a tighter trigger category — not a "remove" rule.

Exception: a sensor the car does not have is dropped. Toyota/Lexus front side radar. Tesla blind spot (Mark 2026-10-19) — `stripTeslaBlindSpot`. Do not put it back.

## Trigger categories (Haiku)

`windshield` is glass **removed** (Repl / R&R / R&I / glass sublet). Mask / chip / tint / 0.2–0.5 hr protect lines go in `windshield_excluded`.

`front_bumper` / `rear_bumper` = cover/fascia Repl or R&I only — not brackets, grille, lamps, add-for.

`radar_sensor` is a line that names a radar. Park/ultrasonic is never radar.

`alignment` = wheel align or steering-system reset. Honda/Acura: camera/radar NOT required after alignment alone.

## Makes

- Radar after any front bumper R&I: Toyota, Lexus, Honda, Acura, Nissan, Infiniti, Hyundai, Kia, Genesis, Mercedes, Ford, Lincoln. Not BMW/MINI (optional radar).
- Always-on surround (2019+ / 2022+ Hyundai-Kia): Mercedes, BMW, Audi, Porsche, Volvo, Land Rover, Genesis, Lexus.
- SAS after battery disconnect: Honda, Acura, Subaru.
- Seat weight after any collision: Honda, Acura, Mazda, Nissan, Infiniti.
- Tesla: no blind spot sensors. Drop Rear Blind Spot Radar and any blind spot aim. A rear bumper does not create one.
- Around View covers the backup camera (Mark 2026-10-19). Both required → keep Around View, demote Back Up Camera. No Around View → Back Up Camera stands on its own.

## Re-scrub one estimate

PDFs for the Kinetic set live under `~/Downloads` as `Kinetic_ID_*.pdf` or the CCC estimate name in `bench_results.json` → `file`.

```bash
# live function, cron secret
curl -s -m 170 -X POST \
  -H "x-cron-secret: crm-sync-2026" \
  -F "file=@/path/to/estimate.pdf;type=application/pdf" \
  -F "name=estimate.pdf" \
  -F "source=benchmark-check" \
  -F "force=1" \
  https://adas-iq-904191467.development.catalystserverless.com/server/adasiq-api/api/crm-sync-cron/scrub-file
```

Gateway is 30s for normal requests; this cron path can run longer. If the body is empty, the scrub often still lands — wait and `--refresh`.
