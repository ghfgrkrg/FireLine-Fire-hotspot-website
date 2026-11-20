# SI/AI disclosure: written with Claude Code (Anthropic), an AI assistant, working with team Paween_and_Kpunn. See README.md.
"""Aggregate FCT2 tiles to a 0.5-degree x month table of MODIS, VIIRS and MODIS-equivalent cell-days.

Usage: python aggregate.py <Fire_Hotspot_Data dir> <out.parquet>
Output columns: hrow, hcol (0.5-deg indices from -90/-180), year, month, m, v, e
"""
import gzip, json, struct, sys
import numpy as np, pandas as pd

ROOT, OUT = sys.argv[1], sys.argv[2]
idx = json.load(open(f"{ROOT}/app_data/index.json"))
days = pd.date_range("2000-01-01", periods=12000)
YEAR = days.year.values.astype(np.int16); MONTH = days.month.values.astype(np.int8)

def read_tile(name):
    b = gzip.open(f"{ROOT}/app_data/tiles/{name}.bin.gz").read()
    n = struct.unpack("<I", b[4:8])[0]
    day = np.frombuffer(b, "<u2", n, 8); cell = np.frombuffer(b, "<u2", n, 8 + 2 * n)
    o = 8 + 8 * n
    m = np.frombuffer(b, "u1", n, o); v = np.frombuffer(b, "u1", n, o + n); e = np.frombuffer(b, "u1", n, o + 2 * n)
    return day, cell, m, v, e

parts = []
for i, name in enumerate(idx["tiles"]):
    lat0, lon0 = map(int, name.split("_"))
    day, cell, m, v, e = read_tile(name)
    df = pd.DataFrame({
        "hrow": ((lat0 + 90) * 2 + (cell // 50) // 5).astype(np.int16),
        "hcol": ((lon0 + 180) * 2 + (cell % 50) // 5).astype(np.int16),
        "year": YEAR[day], "month": MONTH[day],
        "m": (m > 0).astype(np.int32), "v": (v > 0).astype(np.int32), "e": e.astype(np.int32)})
    parts.append(df.groupby(["hrow", "hcol", "year", "month"], as_index=False).sum())
    if i % 100 == 0: print(i, name, flush=True)
out = pd.concat(parts, ignore_index=True)
out["e"] = out["e"] / idx["eq_scale"]
out.to_parquet(OUT)
print("rows", len(out), "m", out.m.sum(), "e", round(out.e.sum()))
