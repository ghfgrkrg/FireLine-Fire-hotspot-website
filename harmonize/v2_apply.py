# SI/AI disclosure: written with Claude Code (Anthropic), an AI assistant, working with team Paween_and_Kpunn. See README.md.
"""Write the v2 harmonized products.  Run after: v2_train.py <cache> 2021 prod ; v2_score.py <cache> <model.json> prod 2021

Usage: python v2_apply.py <Fire_Hotspot_Data dir> <cache dir> [tag=prod] [output folder name=v2]

harmonized value per VIIRS cell-day (eq2) = stage-2 prediction x k(1-deg cell) x s(5-deg tile, month of year)

Writes app_data/<output folder>/ (nothing existing is modified):
  eq2/<tile>.bin.gz        "FEQ2", uint32 n, n x uint8: eq2 x 100 for each record of tiles/<tile>.bin.gz, same order (0 if no VIIRS)
  world/<year>.bin.gz      FWK1 weekly 1-degree grids rebuilt from the tiles, e = eq2
  series.json.gz           worldwide daily modis, viirs, eq (v0), eq2, record2 (MODIS before VIIRS start, eq2 after)
  world_summary.json.gz    consistent record per 1-degree cell per year, [lon, lat, value]
  factors.json             root, k grid, seasonal grid, settings
"""
import gzip, json, os, struct, sys
import numpy as np, pandas as pd
from calib_lib import fit, keys

ROOT, C = sys.argv[1], sys.argv[2]
TAG = sys.argv[3] if len(sys.argv) > 3 else "prod"            # which pred_<tag>.npy / agg_<tag>.parquet to use
TRAIN_END, LAM, CAP, SLAM, SCAP, SCALE = 2021, 100, 2.0, 300, 1.3, 100
APP = f"{ROOT}/app_data"; OUT = f"{APP}/{sys.argv[4] if len(sys.argv) > 4 else 'v2'}"
for sub in ("eq2", "world"): os.makedirs(f"{OUT}/{sub}", exist_ok=True)
idx = json.load(open(f"{APP}/index.json"))
VS = (pd.Timestamp(idx["viirs_start"]) - pd.Timestamp(idx["epoch"])).days

# ---- 1. local and seasonal factors from the outage-free 2012-02 .. 2021 aggregate
d = pd.read_parquet(f"{C}/agg_{TAG}.parquet"); tr = d[d.year <= TRAIN_END]
root = float(tr.m.sum() / tr.p.sum())
mdl = fit(tr.assign(e=tr.p), LAM, "1", cap=CAP, root=root)
K = np.full(64800, root)
for key, k in mdl["5"].items():
    r5, c5 = key // 10000, key % 10000
    for r in range(r5 * 5, r5 * 5 + 5): K[r * 360 + c5 * 5: r * 360 + c5 * 5 + 5] = k
for key, k in mdl["1"].items(): K[(key // 10000) * 360 + key % 10000] = k
c1 = (tr.hrow // 2).values * 360 + (tr.hcol // 2).values; t5 = (tr.hrow // 10).values * 72 + (tr.hcol // 10).values
g = pd.DataFrame({"t5": t5, "mo": tr.month.values, "m": tr.m.values, "c": tr.p.values * K[c1]}).groupby(["t5", "mo"]).sum()
S = np.ones((36 * 72, 12))
S[g.index.get_level_values(0), g.index.get_level_values(1) - 1] = ((g.m + SLAM) / (g.c + SLAM)).clip(1 / SCAP, SCAP).values
json.dump({"formula": "eq2 = stage2 x k[1-deg cell] x s[5-deg tile][month-1]", "root": round(root, 4), "lam": LAM, "cap": CAP,
           "seasonal_lam": SLAM, "seasonal_cap": SCAP, "train": ["2012-02", "2021-12"],
           "k": [[int(i % 360) - 180, int(i // 360) - 90, round(float(K[i]), 3)] for i in np.nonzero(np.abs(K - root) > 5e-4)[0]],
           "s": {f"{int(t // 72) * 5 - 90}_{int(t % 72) * 5 - 180}": [round(float(x), 3) for x in S[t]]
                 for t in np.nonzero(np.abs(S - 1).max(1) > 5e-4)[0]}},
          open(f"{OUT}/factors.json", "w"), separators=(",", ":"))

# ---- 2. final value for every VIIRS cell-day
F = lambda n: np.load(f"{C}/f_{n}.npy")
fday, fgrow, fgcol = F("day"), F("grow"), F("gcol")
cal = pd.date_range(idx["epoch"], periods=int(idx["last_day"]) + 400)
CY = cal.year.values; CM = cal.month.values; CDOY = cal.dayofyear.values - 1
val = np.load(f"{C}/pred_{TAG}.npy").astype(np.float64)
val *= K[(fgrow // 10).astype(np.int64) * 360 + fgcol // 10]
val *= S[(fgrow // 50).astype(np.int64) * 72 + fgcol // 50, CM[fday] - 1]
q = np.minimum(np.rint(val * SCALE), 255).astype(np.uint8)
print(f"eq2 sum {val.sum():.0f}; after uint8 coding {q.sum() / SCALE:.0f} (lost to the 2.55 cap: {np.clip(val - 2.55, 0, None).sum() / val.sum():.5%})")
KV = fday.astype(np.int64) * 6480000 + fgrow.astype(np.int64) * 3600 + fgcol
del val
# The source tiles split ~10k cell-days on Dec 31 / Jan 1 into two records. Count each once: larger value on the first, 0 on the second.
dup = np.nonzero(np.diff(KV) == 0)[0]
q[dup] = np.maximum(q[dup], q[dup + 1]); q[dup + 1] = 0
print("split cell-days merged:", len(dup))

# ---- 3. per-tile sidecars (same record order as the tile)
total = 0
for name in idx["tiles"]:
    lat0, lon0 = map(int, name.split("_"))
    b = gzip.open(f"{APP}/tiles/{name}.bin.gz").read(); n = struct.unpack("<I", b[4:8])[0]
    day = np.frombuffer(b, "<u2", n, 8).astype(np.int64); cell = np.frombuffer(b, "<u2", n, 8 + 2 * n).astype(np.int64)
    v = np.frombuffer(b, "u1", n, 8 + 9 * n)
    key = day * 6480000 + ((lat0 + 90) * 10 + cell // 50) * 3600 + (lon0 + 180) * 10 + cell % 50
    out = np.zeros(n, np.uint8); has = v > 0
    i = np.searchsorted(KV, key[has])
    assert (KV[np.minimum(i, len(KV) - 1)] == key[has]).all(), name
    first = np.zeros(len(i), bool); first[np.unique(i, return_index=True)[1]] = True   # second half of a split cell-day stays 0
    out[has] = np.where(first, q[i], 0); total += int(out.sum())
    with gzip.open(f"{OUT}/eq2/{name}.bin.gz", "wb", compresslevel=6) as f:
        f.write(b"FEQ2" + struct.pack("<I", n) + out.tobytes())
assert total == int(q.sum()), (total, int(q.sum()))
print("sidecars written:", len(idx["tiles"]), flush=True)

# ---- 4. world products from the global cell-day arrays
L = lambda n: np.load(f"{C}/cd_{n}.npy", mmap_mode="r")
day = np.asarray(L("day")); grow = np.asarray(L("grow")); gcol = np.asarray(L("gcol"))
m = (np.asarray(L("m")) > 0).astype(np.float64); vv = np.asarray(L("v")) > 0
e2 = np.zeros(len(day)); e2[vv & (day >= VS)] = q / SCALE          # same order: both sorted by (day, row, col)
e0 = np.asarray(L("eq")) / idx["eq_scale"]
kall = day.astype(np.int64) * 6480000 + grow.astype(np.int64) * 3600 + gcol
dd = np.nonzero(np.diff(kall) == 0)[0]                              # split cell-days: merge into the first record
m[dd] = np.maximum(m[dd], m[dd + 1]); m[dd + 1] = 0
vv = vv.copy(); vv[dd] |= vv[dd + 1]; vv[dd + 1] = False
e0 = e0.copy(); e0[dd] = np.maximum(e0[dd], e0[dd + 1]); e0[dd + 1] = 0
del kall
F0, F1 = idx["first_day"], idx["last_day"]; n = F1 - F0 + 1
ser = {k: np.bincount(day - F0, weights=w, minlength=n) for k, w in [("modis", m), ("viirs", vv.astype(float)), ("eq", e0), ("eq2", e2)]}
rec = np.where(day < VS, m, e2)
ser["record2"] = np.bincount(day - F0, weights=rec, minlength=n)
json.dump({"first_day": F0, "last_day": F1, "viirs_start": idx["viirs_start"],
           **{k: [round(float(x), 1) for x in a] for k, a in ser.items()}}, gzip.open(f"{OUT}/series.json.gz", "wt"), separators=(",", ":"))

cell1 = (grow // 10).astype(np.int64) * 360 + gcol // 10; yr = CY[day]
summ = {}
for y in range(int(yr.min()), int(yr.max()) + 1):
    a, b_ = np.searchsorted(day, [(pd.Timestamp(f"{y}-01-01") - cal[0]).days, (pd.Timestamp(f"{y + 1}-01-01") - cal[0]).days])
    sl = slice(a, b_)
    s1 = np.bincount(cell1[sl], weights=rec[sl], minlength=64800); nzc = np.nonzero(s1 > 0.05)[0]
    summ[str(y)] = [[int(c % 360) - 180, int(c // 360) - 90, round(float(s1[c]), 1)] for c in nzc]
    wk = np.minimum(CDOY[day[sl]] // 7, 51).astype(np.int64); kk = wk * 64800 + cell1[sl]
    cols = [np.bincount(kk, weights=w[sl], minlength=52 * 64800) for w in (m, vv.astype(float), e2)]
    nzk = np.nonzero((cols[0] > 0) | (cols[1] > 0))[0]
    body = (nzk % 64800).astype("<u2").tobytes() + b"".join(np.minimum(np.rint(c[nzk] * 10), 65535).astype("<u2").tobytes() for c in cols) \
        + (nzk // 64800).astype(np.uint8).tobytes()
    with gzip.open(f"{OUT}/world/{y}.bin.gz", "wb") as f: f.write(b"FWK1" + struct.pack("<I", len(nzk)) + body)
json.dump({"res_deg": 1, "record": "MODIS before viirs_start, eq2 after", "years": summ}, gzip.open(f"{OUT}/world_summary.json.gz", "wt"),
          separators=(",", ":"))

# ---- 5. report
good = np.load(f"{C}/good_day.npy")[F0:F0 + n]
t = pd.DataFrame({k: ser[k] for k in ("modis", "eq", "eq2")}, index=cal[F0:F0 + n])
t = t[(t.index >= idx["viirs_start"]) & good].groupby(lambda x: x.year).sum()
print("worldwide / MODIS by year (outage days excluded):")
print(pd.DataFrame({"v0 regional": t["eq"] / t.modis, "v2": t.eq2 / t.modis}).round(3).T.to_string())
