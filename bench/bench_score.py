"""Score our scrubs against Kinetic's reports, car by car (2026-09-28).

Inputs: kinetic.json (answer key, by VIN) and scrubs.json (our library
export). Pairs by VIN, normalises sensor names to Kinetic's vocabulary, and
reports precision / recall on the REQUIRED set, per sensor and per make, plus
the cars we got most wrong. Kinetic is the reference, not the truth: a
"false positive" may be a defensible extra. But the pattern is the signal.
"""
import json, os, re, sys
from collections import Counter, defaultdict

SP = os.path.dirname(os.path.abspath(__file__))
K = json.load(open(os.path.join(SP, "kinetic.json")))
S = json.load(open(os.path.join(SP, "scrubs.json")))["rows"]

# our names → Kinetic's names
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
    return None   # not a sensor Kinetic scores (Rivian base lines, PCSI, etc.)

BENCH_SOURCE = os.environ.get("BENCH_SOURCE", "")   # e.g. benchmark-v2: score only the re-scrubbed rows
def ours_for(vin):
    rows = [r for r in S if (r.get("vin") or "").upper() == vin]
    if BENCH_SOURCE:
        rows = [r for r in rows if r.get("source") == BENCH_SOURCE]
    else:
        rows = [r for r in rows if not str(r.get("source", "")).startswith("benchmark")]   # baseline = the original scrubs only
    if not rows: return None
    # prefer a real scrub over reports-only; edited over raw; newest last
    rows.sort(key=lambda r: (r.get("status") in ("ok", "edited", "from-card"), r.get("status") == "edited", r.get("at") or ""))
    return rows[-1]

pairs, unmatched = [], 0
for vin, k in K.items():
    if k.get("parse_warning"): continue
    o = ours_for(vin)
    if not o or not (o["required"] or o["not_required"]): unmatched += 1; continue
    kreq = {canon(x) for x in k["required"]} - {None}
    oreq = {canon(x) for x in o["required"]} - {None}   # Kinetic scores headlamp as "Headlight Module" — counted
    headlamp = sum(1 for x in o["required"] if canon(x) == "Headlamp Aim")
    pairs.append({"vin": vin, "headlamp": headlamp, "ours_detail": o.get("detail", []), "kinetic_detail": k.get("detail", []), "vehicle": k["vehicle"], "make": (o.get("make") or k["vehicle"].split(" ")[1] if k["vehicle"] else "?"),
                  "kinetic": sorted(kreq), "ours": sorted(oreq),
                  "tp": sorted(kreq & oreq), "fp": sorted(oreq - kreq), "fn": sorted(kreq - oreq), "file": o.get("file"), "source": o.get("source")})

tp = sum(len(p["tp"]) for p in pairs); fp = sum(len(p["fp"]) for p in pairs); fn = sum(len(p["fn"]) for p in pairs)
prec = tp / (tp + fp) if tp + fp else 0; rec = tp / (tp + fn) if tp + fn else 0
exact = sum(1 for p in pairs if not p["fp"] and not p["fn"])
# Headlamp both ways: Kinetic only scores a REPLACED module, we also call
# LED/adaptive R&I (module initialization) — a known, defensible disagreement.
tp2 = sum(len([x for x in p["tp"] if x != "Headlamp Aim"]) for p in pairs); fp2 = sum(len([x for x in p["fp"] if x != "Headlamp Aim"]) for p in pairs); fn2 = sum(len([x for x in p["fn"] if x != "Headlamp Aim"]) for p in pairs)
prec2 = tp2 / (tp2 + fp2) if tp2 + fp2 else 0; rec2 = tp2 / (tp2 + fn2) if tp2 + fn2 else 0
exact2 = sum(1 for p in pairs if not [x for x in p["fp"] if x != "Headlamp Aim"] and not [x for x in p["fn"] if x != "Headlamp Aim"])

print(f"BENCHMARK: {len(pairs)} cars paired (Kinetic cars with no scrub of ours: {unmatched}, parse-warned skipped: {sum(1 for k in K.values() if k.get('parse_warning'))})")
print(f"required-set precision {prec:.0%}  recall {rec:.0%}  · exact match on {exact}/{len(pairs)} cars  · TP {tp} FP {fp} FN {fn}")
print(f"  without headlamp:  precision {prec2:.0%}  recall {rec2:.0%}  · exact {exact2}/{len(pairs)}  (Kinetic scores only a replaced module; we also call LED/adaptive R&I initialization)")
print()
fpc, fnc = Counter(), Counter()
for p in pairs: fpc.update(p["fp"]); fnc.update(p["fn"])
print("WE CALL IT, KINETIC DOESN'T (over-calls):"); [print(f"  {n:26} {c}") for n, c in fpc.most_common()]
print("KINETIC CALLS IT, WE DON'T (misses):");     [print(f"  {n:26} {c}") for n, c in fnc.most_common()]
print()
bymake = defaultdict(lambda: [0, 0, 0, 0])
for p in pairs:
    m = bymake[p["make"]]; m[0] += 1; m[1] += len(p["tp"]); m[2] += len(p["fp"]); m[3] += len(p["fn"])
print("BY MAKE (cars · tp · over · miss):"); [print(f"  {mk:16} {v[0]:2} · {v[1]:2} · {v[2]:2} · {v[3]:2}") for mk, v in sorted(bymake.items(), key=lambda x: -(x[1][2] + x[1][3]))]
print()
print("WORST CARS:")
for p in sorted(pairs, key=lambda p: -(len(p["fp"]) + len(p["fn"])))[:10]:
    print(f"  {p['vehicle'][:34]:34} over {p['fp']}  miss {p['fn']}  ({p['file']})")
print()
print("DETAIL — worst 8 (ours: sensor ← lines · trigger | kinetic: sensor ← lines · trigger):")
for p in sorted(pairs, key=lambda p: -(len(p["fp"]) + len(p["fn"])))[:8]:
    print(f"\n  {p['vehicle'][:40]}  [{p['file']}]")
    for d in p["ours_detail"]:
        tag = "OVER " if canon(d["n"]) in p["fp"] else ("ok   " if canon(d["n"]) in p["tp"] else "     ")
        if d.get("r"): print(f"    ours {tag} {d['n'][:30]:30} ← {str(d.get('l') or '—')[:14]:14} · {str(d.get('g') or '')[:60]}")
    for d in p["kinetic_detail"]:
        tag = "MISS " if canon(d["n"]) in p["fn"] else "     "
        if d.get("r"): print(f"    kin  {tag} {d['n'][:30]:30} ← {str(d.get('l') or '—')[:14]:14} · {str(d.get('g') or '')[:60]}")
print()
print("ZERO-REQUIRED ON OUR SIDE WHERE KINETIC REQUIRED SOMETHING:")
for p in pairs:
    if not p["ours"] and p["kinetic"]: print(f"  {p['vehicle'][:34]:34} kinetic {p['kinetic']}  ({p['file']})")
json.dump({"pairs": pairs, "precision": prec, "recall": rec, "exact": exact, "fp": dict(fpc), "fn": dict(fnc)}, open(os.path.join(SP, "bench_results.json"), "w"), indent=1)
