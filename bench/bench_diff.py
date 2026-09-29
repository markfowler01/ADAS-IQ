"""Car-by-car diff between two scrub versions against the Kinetic answer key.

  python3 bench_diff.py            # baseline (original scrubs) vs benchmark-v2
  python3 bench_diff.py v2 v3      # any two sources

Prints, per paired car, what changed: fixed misses, new misses, dropped
over-calls, new over-calls. The totals at the end are the ones to trust —
a single car swinging both ways is noise, a sensor moving the same way on
five cars is a rule.
"""
import json, os, re, sys
from collections import Counter

SP = os.path.dirname(os.path.abspath(__file__))
K = json.load(open(os.path.join(SP, "kinetic.json")))
S = json.load(open(os.path.join(SP, "scrubs.json")))["rows"]
A = sys.argv[1] if len(sys.argv) > 1 else ""            # "" = baseline (non-benchmark rows)
B = sys.argv[2] if len(sys.argv) > 2 else "benchmark-v2"

CANON = [
    (r"windshield|front camera|lane depart|forward camera|lkas|ldw|eyesight|honda sensing", "Front Windshield Camera"),
    (r"front side radar|front corner|front cross", "Front Side Radar"),
    (r"front radar|acc radar|distance sensor|distronic|pre.?collision radar|forward radar", "Front Radar"),
    (r"blind ?spot|rear cross|rear corner|bsm|blis|rcta|side radar", "Rear Blind Spot Radar"),
    (r"around view|surround|360|bird", "Around View Camera"),
    (r"back ?up|rear view camera|rear camera|reverse camera|rcd", "Back Up Camera"),
    (r"park|ultrasonic|pdc|parktronic", "Park Distance Sensor"),
    (r"steering angle|sas\b", "Steering Angle Sensor"),
    (r"seat weight|occupant|ocs|passenger seat", "Seat Weight Sensor"),
    (r"side camera|lanewatch|lane change", "Side Camera"),
    (r"headlamp|headlight", "Headlamp Aim"),
    (r"night vision", "Night Vision Camera"),
    (r"driver monitor", "Driver Monitor Camera"),
    (r"rear radar|rear aeb", "Rear Radar"),
]
def canon(n):
    t = str(n).lower()
    for pat, name in CANON:
        if re.search(pat, t): return name
    return None

def pick(vin, source):
    rows = [r for r in S if (r.get("vin") or "").upper() == vin]
    rows = [r for r in rows if r.get("source") == source] if source else [r for r in rows if not str(r.get("source", "")).startswith("benchmark")]
    rows = [r for r in rows if r.get("required") or r.get("not_required")]
    if not rows: return None
    rows.sort(key=lambda r: (r.get("status") in ("ok", "edited", "from-card"), r.get("at") or ""))
    return {canon(x) for x in rows[-1]["required"]} - {None}

fixed, newmiss, dropped, newover = Counter(), Counter(), Counter(), Counter()
cars = 0
for vin, k in K.items():
    if k.get("parse_warning"): continue
    a, b = pick(vin, A), pick(vin, B)
    if a is None or b is None: continue
    cars += 1
    kreq = {canon(x) for x in k["required"]} - {None}
    fa, fb = kreq - a, kreq - b           # misses before / after
    oa, ob = a - kreq, b - kreq           # over-calls before / after
    ch = []
    for x in sorted(fa - fb): fixed[x] += 1; ch.append(f"FIXED miss {x}")
    for x in sorted(fb - fa): newmiss[x] += 1; ch.append(f"NEW miss {x}")
    for x in sorted(oa - ob): dropped[x] += 1; ch.append(f"dropped over-call {x}")
    for x in sorted(ob - oa): newover[x] += 1; ch.append(f"NEW over-call {x}")
    if ch: print(f"{k['vehicle'][:36]:36} " + " · ".join(ch))

print(f"\n{cars} cars compared ({A or 'baseline'} → {B})")
for label, c in (("fixed misses", fixed), ("new misses", newmiss), ("dropped over-calls", dropped), ("new over-calls", newover)):
    print(f"  {label:20} {sum(c.values()):3}  " + ", ".join(f"{n} ×{v}" for n, v in c.most_common()))
