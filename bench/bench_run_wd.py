"""Re-scrub every paired benchmark car straight from WorkDrive (2026-10-01).

Pairs come from bench_results.json (run bench_score.py first). Each estimate is
pulled by its WorkDrive file id and re-scrubbed under source $SRC, 4 at a time.
    SRC=benchmark-v3 python3 bench_run_wd.py
then: scrubs-export > scrubs.json and BENCH_SOURCE=$SRC python3 bench_score.py
"""
import json, os, subprocess, sys
from concurrent.futures import ThreadPoolExecutor

SP = os.path.dirname(os.path.abspath(__file__))
B = "https://adas-iq-904191467.development.catalystserverless.com/server/adasiq-api/api/crm-sync-cron"
H = "x-cron-secret: crm-sync-2026"
SRC = os.environ.get("SRC", "benchmark-v3")
TMP = os.path.join(SP, ".wd"); os.makedirs(TMP, exist_ok=True)

R = json.load(open(os.path.join(SP, "bench_results.json")))
rows = json.load(open(os.path.join(SP, "scrubs.json")))["rows"]
byfile = {}
for r in rows:
    if r.get("fileId") and r.get("file"): byfile.setdefault(r["file"], r["fileId"])
jobs, seen = [], set()
for p in R["pairs"]:
    f = p.get("file"); fid = byfile.get(f)
    if f and fid and fid not in seen: seen.add(fid); jobs.append((fid, f))
print(f"re-scrubbing {len(jobs)} estimates under {SRC}", flush=True)

def one(j):
    fid, name = j; out = os.path.join(TMP, fid + ".pdf")
    if not os.path.exists(out) or os.path.getsize(out) < 1000:
        subprocess.run(["curl", "-s", "-m", "90", "-H", H, f"{B}/wd/file?id={fid}", "-o", out])
    r = subprocess.run(["curl", "-s", "-m", "170", "-X", "POST", "-H", H, "-F", f"file=@{out};type=application/pdf",
                        "-F", f"name={name}", "-F", f"source={SRC}", "-F", "force=1", f"{B}/scrub-file"], capture_output=True, text=True)
    print(f"{name[:60]} | {r.stdout[:120]}", flush=True)

with ThreadPoolExecutor(int(os.environ.get("PAR", "4"))) as ex: list(ex.map(one, jobs))
print("done", flush=True)
