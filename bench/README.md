# Scrubber benchmark against Kinetic

1. Drop every `Kinetic_ID_*.pdf` you have into `~/Downloads` (any depth).
2. `python3 bench_kinetic.py` → `kinetic.json` (the answer key, by VIN).
3. `curl -H "x-cron-secret: $CRM_SYNC_CRON_SECRET" .../api/crm-sync-cron/scrubs-export > scrubs.json`
4. `python3 bench_score.py` → baseline against the original scrubs.
5. After a prompt change: `bash bench_rerun.sh` re-scrubs the paired cars under
   `benchmark-v2` and scores them; `BENCH_SOURCE=benchmark-v2 python3 bench_score.py` re-scores.

Kinetic is the reference, not the truth. Read every mismatch before tuning.
See the vault note "Kinetic Benchmark 2026-09-28" for the first results.
