"""Answer key for the scrubber benchmark (2026-09-28).

Every Kinetic_ID_*.pdf under ~/Downloads is a Calibration Identification
Report Kinetic produced for one of our cars. Read each one and record, per
VIN: shop, RO, claim, vehicle, and every sensor with Kinetic's verdict.

Kinetic's text layout: after "Sensor Repair Triggers Line Numbers Type",
each sensor name is followed either by "— —" (not required) or by trigger
text plus estimate line numbers (required). Output: kinetic.json.
"""
import os, re, json, glob
from pypdf import PdfReader

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "kinetic.json")
SENSORS = [
    "Front Windshield Camera", "Front Radar", "Front Side Radar", "Rear Blind Spot Radar",
    "Back Up Camera", "Around View Camera", "Park Distance Sensor", "Steering Angle Sensor",
    "Seat Weight Sensor", "Headlamp Aim", "Night Vision Camera", "Driver Monitor Camera",
    "Rear Radar", "Rear Camera Mirror", "Lane Departure Camera", "Rear Cross Traffic Radar",
    "Side Radar", "Rear Camera", "Surround View Camera", "Occupant Classification System",
    "Headlight Module", "Side Camera",
]
# Kinetic wraps long names ("Steering Angle\nSensor"), so match on
# whitespace-normalised text and anywhere in the line, longest names first.
SENSOR_RE = re.compile(r"(" + "|".join(re.escape(s) for s in sorted(SENSORS, key=len, reverse=True)) + r")\b", re.I)

def field(t, label):
    m = re.search(r"^" + re.escape(label) + r":\s*(.+)$", t, re.M)
    return m.group(1).strip() if m else ""

def parse(path):
    r = PdfReader(path)
    t = "\n".join((p.extract_text() or "") for p in r.pages[:3])
    if "Calibration Identi" not in t:
        return None
    vin = field(t, "VIN").upper()
    claim = field(t, "Claim")
    m = re.match(r"([^\s(]+)", claim); claim_no = m.group(1) if m else claim
    out = {
        "file": os.path.basename(path), "vin": vin, "ro": field(t, "Customer Repair Order"),
        "claim": claim_no, "shop": field(t, "Customer"), "vehicle": field(t, "Vehicle"),
        "required": [], "not_required": [],
    }
    m = re.search(r"Required Operations\s+(\d+)", t); out["required_count"] = int(m.group(1)) if m else None
    ops = t.split("Line Numbers Type", 1)
    if len(ops) < 2:
        return out
    body = re.sub(r"[ \t]*\n[ \t]*", " ", ops[1])          # unwrap lines
    body = body.split("Safety References")[0].split("NoYes")[0]  # drop the footer
    hits = list(SENSOR_RE.finditer(body))
    for i, h in enumerate(hits):
        name = h.group(1)
        seg = body[h.end(): hits[i + 1].start() if i + 1 < len(hits) else len(body)]
        seg = seg.replace("\n", " ").strip()
        # Kinetic marks the verdict with private-use icon glyphs: \uf332 =
        # required, \uf26a = not required, \uf1c5 = a reference link. Required
        # rows also carry line numbers and a Type (Static / Dynamic).
        req = ("\uf332" in seg) or bool(re.search(r"\bStatic\b|\bDynamic\b", seg)) or (bool(re.search(r"\d", seg)) and "\uf26a" not in seg)
        (out["required"] if req else out["not_required"]).append(name)
        clean = re.sub(r"[\uf000-\uf8ff]", "", seg).strip()
        lm = re.search(r"((?:\d+(?:-\d+)?)(?:,\s*\d+(?:-\d+)?)*)\s*(?:Static|Dynamic|$)", clean)
        out.setdefault("detail", []).append({"n": name, "r": req, "l": lm.group(1) if (req and lm) else "", "g": re.sub(r"\s*\d[\d,\s-]*\s*(Static.*|Dynamic.*)?$", "", clean).strip()[:80] if req else ""})
    # sanity: Kinetic prints the required count in the summary
    if out["required_count"] is not None and out["required_count"] != len(out["required"]):
        out["parse_warning"] = f"summary says {out['required_count']} required, parsed {len(out['required'])}"
    return out

def main():
    files = glob.glob(os.path.expanduser("~/Downloads/**/Kinetic_ID_*.pdf"), recursive=True)
    byvin, dupes, bad = {}, 0, 0
    for f in sorted(files):
        try:
            k = parse(f)
        except Exception as e:
            bad += 1; continue
        if not k or not k["vin"]:
            bad += 1; continue
        # newest report per VIN wins (supplements)
        if k["vin"] in byvin:
            dupes += 1
            if os.path.getmtime(f) < os.path.getmtime(os.path.expanduser("~/Downloads/" + byvin[k["vin"]]["file"])) if os.path.exists(os.path.expanduser("~/Downloads/" + byvin[k["vin"]]["file"])) else False:
                continue
        byvin[k["vin"]] = k
    json.dump(byvin, open(OUT, "w"), indent=1)
    warn = sum(1 for k in byvin.values() if k.get("parse_warning"))
    print(f"kinetic reports: {len(files)} files → {len(byvin)} cars (dupes {dupes}, unreadable {bad}, parse warnings {warn})")
    from collections import Counter
    c = Counter(s for k in byvin.values() for s in k["required"])
    print("Kinetic's most-required sensors:", c.most_common(8))

if __name__ == "__main__":
    main()
