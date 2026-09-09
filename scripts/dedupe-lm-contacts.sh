#!/bin/bash
# Delete the $0 "L-M Body Shop Inc" duplicate customers from Zoho Books
# (Mark 2026-09-09). Runs the app's owner-only dedupe route in throttled
# passes (~34 deletes per pass, 650ms apart, under Books' 100 req/min)
# until none remain. Contacts with money or transactions are never
# deleted — Books refuses those and the script reports them.
#
# Usage:  ./scripts/dedupe-lm-contacts.sh            (deletes)
#         DRY=1 ./scripts/dedupe-lm-contacts.sh      (report only)
set -u
NAME="${NAME:-L-M Body Shop Inc}"
MODE="${MODE:-books}"     # books = Zoho Books customers · crm = Zoho CRM leads/accounts/contacts
BASE="https://adas-iq-904191467.development.catalystserverless.com/server/adasiq-api"
ENVF="$(dirname "$0")/../functions/adasiq-api/.env"
SEC="$(grep -h '^BILLING_CRON_SECRET\|^MORNING_CRON_SECRET' "$ENVF" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"')"
SEC="${SEC:-morning-2026}"
TOK="$(/usr/bin/curl -s -m 20 -X POST "$BASE/auth/demo" -H 'Content-Type: application/json' -d '{"type":"calibration"}' | /usr/bin/python3 -c 'import sys,json;print(json.load(sys.stdin).get("token",""))')"
DRYFLAG="${DRY:-0}"
[ "$DRYFLAG" = "1" ] && DRYV="1" || DRYV="0"

for i in $(seq 1 30); do
  if [ "$MODE" = "crm" ]; then
    R="$(/usr/bin/curl -s -m 29 -X POST "$BASE/api/item-map/dedupe-crm" \
      -H "X-Auth-Token: $TOK" -H "x-cron-secret: $SEC" -H 'Content-Type: application/json' \
      -d "{\"name\":\"$NAME\",\"dry\":\"$DRYV\"}")"
    echo "pass $i: $R" | head -c 600; echo
    [ "$DRYV" = "1" ] && exit 0
    echo "$R" | grep -q '"partial":true' || { echo "done"; exit 0; }
    sleep 5; continue
  fi
  R="$(/usr/bin/curl -s -m 29 -X POST "$BASE/api/item-map/dedupe-contacts" \
    -H "X-Auth-Token: $TOK" -H "x-cron-secret: $SEC" -H 'Content-Type: application/json' \
    -d "{\"name\":\"$NAME\",\"dry\":\"$DRYV\",\"keep_one\":\"0\",\"limit\":34}")"
  echo "pass $i: $(echo "$R" | /usr/bin/python3 -c 'import sys,json;d=json.load(sys.stdin);print({k:d.get(k) for k in ("matched","to_delete","deleted","remaining","rate_limited","error") if d.get(k) is not None}, "refused:", len(d.get("refused",[])))' 2>/dev/null || echo "$R" | head -c 300)"
  [ "$DRYV" = "1" ] && exit 0
  rem="$(echo "$R" | /usr/bin/python3 -c 'import sys,json;d=json.load(sys.stdin);print(d.get("remaining", d.get("to_delete", -1)))' 2>/dev/null)"
  [ "$rem" = "0" ] && { echo "done — no duplicates left"; exit 0; }
  echo "$R" | grep -q '"rate_limited":true' && { echo "  (rate limited — waiting 45s)"; sleep 45; }
  sleep 5
done
echo "stopped after 30 passes — run again if anything remains"
