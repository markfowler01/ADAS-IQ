#!/bin/bash
# Re-scrub the benchmark cars with the current prompt and score them again.
# Run AFTER `catalyst login` + `npm run deploy:function` (the prompt change
# in commit 52bc5ca must be live). Each re-scrub lands under source
# "benchmark-v2" so the scorer can compare against the baseline rows.
#
#   bash bench_rerun.sh            # re-scrub + score
#   BENCH_SOURCE=benchmark-v2 python3 bench_score.py   # score only
set -u
SP="$(cd "$(dirname "$0")" && pwd)"   # run from bench/; kinetic.json + scrubs.json live here
B="https://adas-iq-904191467.development.catalystserverless.com/server/adasiq-api/api/crm-sync-cron"
S="x-cron-secret: crm-sync-2026"
SRC="${BENCH_SOURCE:-benchmark-v2}"

python3 - "$SP" <<'PY' > "$SP/bench_files.txt"
import json, sys
R = json.load(open(f"{sys.argv[1]}/bench_results.json"))
seen = set()
for p in R["pairs"]:
    f = p.get("file")
    if f and f not in seen:
        seen.add(f); print(f)
PY
echo "re-scrubbing $(wc -l < "$SP/bench_files.txt" | tr -d ' ') benchmark estimates under source $SRC"
n=0
while IFS= read -r name; do
  f=$(find ~/Downloads -name "$name" -print -quit 2>/dev/null)
  if [ -z "$f" ]; then echo "  missing locally: $name"; continue; fi
  n=$((n+1))
  R=$(curl -s -m 170 -X POST -H "$S" -F "file=@$f;type=application/pdf" -F "name=$name" -F "source=$SRC" -F "force=1" "$B/scrub-file")
  echo "$R" | python3 -c "
import json,sys
try: d=json.load(sys.stdin)
except: print('  $n: $name | gateway cut (scrub lands anyway)'); sys.exit()
if d.get('ok'): print(f\"  $n: {d.get('vehicle','')[:40]} | req {d.get('required')}\")
else: print(f\"  $n: $name | {d.get('skipped') or d.get('error')}\")"
  sleep 2
done < "$SP/bench_files.txt"
echo "waiting 90s for gateway-cut scrubs to land…"; sleep 90
curl -s -m 120 -H "$S" "$B/scrubs-export" -o "$SP/scrubs.json"
echo "=== AFTER (source $SRC)"; BENCH_SOURCE="$SRC" python3 "$SP/bench_score.py" | head -30
