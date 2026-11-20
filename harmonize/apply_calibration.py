# SI/AI disclosure: written with Claude Code (Anthropic), an AI assistant, working with team Paween_and_Kpunn. See README.md.
"""Fit the production local calibration and write calibrated products next to the originals.

Usage: python apply_calibration.py <Fire_Hotspot_Data dir> <agg.parquet from aggregate.py>

Writes (originals are left untouched):
  app_data/calib/calib_1deg.json        1-degree factor grid; multiply MODIS-equivalent (eq/e) by k of the cell's 1-degree parent
  app_data/calib/series_cal.json.gz     worldwide daily series, like world/series.json.gz plus "eq_cal" and "record_cal"
  app_data/calib/world_summary_cal.json.gz  like world_summary.json.gz, using calibrated eq
"""
import gzip, json, struct, sys
import numpy as np, pandas as pd
from calib_lib import fit

ROOT, AGG = sys.argv[1], sys.argv[2]
LAM, CAP, DEPTH = 100, 1.5, "1"
TRAIN = ("2012-02", "2021-12")
APP = f"{ROOT}/app_data"
idx = json.load(open(f"{APP}/index.json"))
VSTART = (pd.Timestamp(idx["viirs_start"]) - pd.Timestamp(idx["epoch"])).days
F0, F1 = idx["first_day"], idx["last_day"]

# ---- 1. fit
agg = pd.read_parquet(AGG)
ym = agg.year.astype(np.int32) * 100 + agg.month.astype(np.int32)
train = agg[(ym >= 201202) & (ym <= 202112)]
model = fit(train, LAM, DEPTH, cap=CAP)

# dense 1-degree grid: 1-degree factor where fitted, else its 5-degree factor; key = row*360+col from (-90,-180)
grid = np.ones(180 * 360, np.float32)
for key, k in model["5"].items():
    r5, c5 = key // 10000, key % 10000
    for r in range(r5 * 5, r5 * 5 + 5):
        grid[r * 360 + c5 * 5: r * 360 + c5 * 5 + 5] = k
for key, k in model["1"].items():
    grid[(key // 10000) * 360 + key % 10000] = k
cells = [[int(i % 360) - 180, int(i // 360) - 90, round(float(grid[i]), 3)]
         for i in np.nonzero(np.abs(grid - 1) > 5e-4)[0]]
import os; os.makedirs(f"{APP}/calib", exist_ok=True)
json.dump({"res_deg": 1, "default": 1.0, "lam": LAM, "cap": CAP, "train": list(TRAIN),
           "cell_format": "[lon_floor, lat_floor, k]", "applies_to": "eq (MODIS-equivalent) only; MODIS counts unchanged",
           "cells": cells}, open(f"{APP}/calib/calib_1deg.json", "w"), separators=(",", ":"))
print(f"factor grid: {len(cells)} cells != 1; k quantiles",
      np.round(np.quantile([c[2] for c in cells], [.05, .25, .5, .75, .95]), 3))

# ---- 2. one pass over tiles: daily series and per-year 1-degree summary, raw and calibrated
n = F1 - F0 + 1
eq_raw = np.zeros(n); eq_cal = np.zeros(n); mod = np.zeros(n); vir = np.zeros(n)
years = pd.date_range(idx["epoch"], periods=F1 + 1).year.values
summ_raw, summ_cal = {}, {}
for name in idx["tiles"]:
    lat0, lon0 = map(int, name.split("_"))
    b = gzip.open(f"{APP}/tiles/{name}.bin.gz").read()
    m_ = struct.unpack("<I", b[4:8])[0]
    day = np.frombuffer(b, "<u2", m_, 8).astype(np.int64); cell = np.frombuffer(b, "<u2", m_, 8 + 2 * m_).astype(np.int64)
    o = 8 + 8 * m_
    m = (np.frombuffer(b, "u1", m_, o) > 0).astype(float); e = np.frombuffer(b, "u1", m_, o + 2 * m_) / idx["eq_scale"]
    r1 = lat0 + 90 + (cell // 50) // 10; c1 = lon0 + 180 + (cell % 50) // 10
    k = grid[r1 * 360 + c1].astype(float)
    ec = e * k
    v = (np.frombuffer(b, "u1", m_, o + m_) > 0).astype(float)
    np.add.at(eq_raw, day - F0, e); np.add.at(eq_cal, day - F0, ec); np.add.at(mod, day - F0, m); np.add.at(vir, day - F0, v)
    pre = day < VSTART
    rec_raw = np.where(pre, m, e); rec_cal = np.where(pre, m, ec)
    df = pd.DataFrame({"y": years[day], "lon": c1 - 180, "lat": r1 - 90, "r": rec_raw, "c": rec_cal})
    for (y, lo, la), row in df.groupby(["y", "lon", "lat"])[["r", "c"]].sum().iterrows():
        if row.r > 0: summ_raw.setdefault(str(y), []).append([int(lo), int(la), round(float(row.r), 1)])
        if row.c > 0: summ_cal.setdefault(str(y), []).append([int(lo), int(la), round(float(row.c), 1)])

if len(sys.argv) > 3: np.savez(sys.argv[3], mod=mod, eq_raw=eq_raw)
# ---- 3. sanity checks against the existing products
s = json.load(gzip.open(f"{APP}/world/series.json.gz"))
print("series check  max|modis diff| =", np.abs(np.array(s["modis"]) - mod[:len(s["modis"])]).max(),
      " max|eq diff| =", round(np.abs(np.array(s["eq"]) - eq_raw[:len(s["eq"])]).max(), 2))
ws = json.load(gzip.open(f"{APP}/world_summary.json.gz"))
for y in ["2005", "2015", "2025"]:
    a = sum(v[2] for v in ws["years"][y]); b2 = sum(v[2] for v in summ_raw[y])
    print(f"summary check {y}: existing {a:.0f}  rebuilt {b2:.0f}")

# ---- 4. write
L = len(s["modis"])
rec_cal_series = np.where(np.arange(F0, F0 + L) < VSTART, mod[:L], eq_cal[:L])
# modis/viirs/eq are rebuilt from the tiles: the original world/series.json.gz undercounts Dec 31 and Jan 1 of every year
r1d = lambda a: [round(float(x), 1) for x in a[:L]]
out = dict(s, modis=r1d(mod), viirs=r1d(vir), eq=r1d(eq_raw), eq_cal=r1d(eq_cal),
           note="modis/viirs/eq rebuilt from tiles (fixes Dec 31/Jan 1 undercount in world/series.json.gz)")
out["record_cal"] = [round(float(x), 1) for x in rec_cal_series]
json.dump(out, gzip.open(f"{APP}/calib/series_cal.json.gz", "wt"), separators=(",", ":"))
for y in summ_cal: summ_cal[y].sort(key=lambda v: (v[1], v[0]))
json.dump({"res_deg": 1, "years": summ_cal, "calibrated": True}, gzip.open(f"{APP}/calib/world_summary_cal.json.gz", "wt"),
          separators=(",", ":"))
yr = pd.DataFrame({"m": mod[:L], "e": eq_raw[:L], "c": eq_cal[:L]}, index=pd.date_range(idx["epoch"], periods=F1 + 1)[F0:F0 + L])
yr = yr[yr.index >= idx["viirs_start"]].groupby(lambda d: d.year).sum()
yr["eq/modis"] = (yr.e / yr.m).round(3); yr["cal/modis"] = (yr.c / yr.m).round(3)
print(yr[["eq/modis", "cal/modis"]].T.to_string())
