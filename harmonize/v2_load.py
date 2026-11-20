# SI/AI disclosure: written with Claude Code (Anthropic), an AI assistant, working with team Paween_and_Kpunn. See README.md.
"""Load every FCT2 tile into flat global arrays (one row per cell-day) and cache them.

Usage: python v2_load.py <Fire_Hotspot_Data dir> <cache dir>
Writes <cache>/cd_{day,grow,gcol,vfrp,m,v,eq}.npy   (grow/gcol = 0.1-degree indices from -90/-180), sorted by (day, grow, gcol)
"""
import gzip, json, struct, sys, os
import numpy as np

ROOT, CACHE = sys.argv[1], sys.argv[2]
os.makedirs(CACHE, exist_ok=True)
idx = json.load(open(f"{ROOT}/app_data/index.json"))
N = sum(t["n"] for t in idx["tiles"].values())
day = np.empty(N, np.uint16); grow = np.empty(N, np.uint16); gcol = np.empty(N, np.uint16)
vfrp = np.empty(N, np.uint16); m = np.empty(N, np.uint8); v = np.empty(N, np.uint8); eq = np.empty(N, np.uint8)
o = 0
for name in idx["tiles"]:
    lat0, lon0 = map(int, name.split("_"))
    b = gzip.open(f"{ROOT}/app_data/tiles/{name}.bin.gz").read()
    n = struct.unpack("<I", b[4:8])[0]
    cell = np.frombuffer(b, "<u2", n, 8 + 2 * n)
    s = slice(o, o + n)
    day[s] = np.frombuffer(b, "<u2", n, 8)
    grow[s] = (lat0 + 90) * 10 + cell // 50; gcol[s] = (lon0 + 180) * 10 + cell % 50
    vfrp[s] = np.frombuffer(b, "<u2", n, 8 + 6 * n)
    p = 8 + 8 * n
    m[s] = np.frombuffer(b, "u1", n, p); v[s] = np.frombuffer(b, "u1", n, p + n); eq[s] = np.frombuffer(b, "u1", n, p + 2 * n)
    o += n
assert o == N
key = day.astype(np.int64) * 6480000 + grow.astype(np.int64) * 3600 + gcol
order = np.argsort(key, kind="stable")
for nm, arr in [("day", day), ("grow", grow), ("gcol", gcol), ("vfrp", vfrp), ("m", m), ("v", v), ("eq", eq)]:
    np.save(f"{CACHE}/cd_{nm}.npy", arr[order])
print("records", N, "modis cell-days", int((m > 0).sum()), "viirs cell-days", int((v > 0).sum()),
      "modis-only", int(((m > 0) & (v == 0)).sum()))
