# SI/AI disclosure: written with Claude Code (Anthropic), an AI assistant, working with team Paween_and_Kpunn. See README.md.
"""Exact fire series for every country, at full 0.1-degree daily detail, so the app need not approximate large areas.

Usage: python countries_series.py <Fire_Hotspot_Data dir> [harmonization folder = v3]
A 0.1-degree cell belongs to a country when its centre lies inside the country's polygon (admin/countries.json),
the same rule the app applies. Reads every tile and its eq2 sidecar once.
Writes app_data/<folder>/countries/<ISO3>.json.gz:
  first_day, daily  : consistent record per day (MODIS before VIIRS start, eq2 after), from first_day
  M, V, H, MD, VD   : per month from January 2000: MODIS cell-days, VIIRS cell-days, harmonized VIIRS, MODIS and VIIRS detections
  cells, km2        : size of the country on the grid
"""
import gzip, io, json, os, struct, sys
import numpy as np, pandas as pd, shapely
from shapely.geometry import shape

ROOT = sys.argv[1]; HARM = sys.argv[2] if len(sys.argv) > 2 else "v3"
APP = f"{ROOT}/app_data"; OUT = f"{APP}/{HARM}/countries"; os.makedirs(OUT, exist_ok=True)
idx = json.load(open(f"{APP}/index.json"))
F0, F1 = idx["first_day"], idx["last_day"]; ND = F1 + 1
VS = (pd.Timestamp(idx["viirs_start"]) - pd.Timestamp(idx["epoch"])).days
cal = pd.date_range(idx["epoch"], periods=ND); MI = ((cal.year - 2000) * 12 + cal.month - 1).values; NMI = int(MI.max()) + 1

# ---- rasterise countries onto the 0.1-degree grid (cell centres)
fc = json.load(io.open(f"{APP}/admin/countries.json", encoding="utf-8"))["features"]
grid = np.full((1800, 3600), -1, np.int16)
for ci, f in enumerate(fc):
    g = shape(f["geometry"]); w, s, e, n = g.bounds
    r0, r1 = max(0, int(np.floor((s + 90) * 10))), min(1800, int(np.ceil((n + 90) * 10)))
    c0, c1 = max(0, int(np.floor((w + 180) * 10))), min(3600, int(np.ceil((e + 180) * 10)))
    lat = (np.arange(r0, r1) + .5) / 10 - 90; lon = (np.arange(c0, c1) + .5) / 10 - 180
    X, Y = np.meshgrid(lon, lat)
    inside = shapely.contains_xy(g, X, Y)
    sub = grid[r0:r1, c0:c1]; sub[inside & (sub < 0)] = ci
NC = len(fc)
cells = np.bincount(grid[grid >= 0], minlength=NC)
latc = (np.arange(1800) + .5) / 10 - 90
km2 = np.array([(123.6 * np.cos(np.radians(latc))[:, None] * (grid == ci)).sum() for ci in range(NC)])
print("rasterised", NC, "countries;", int((grid >= 0).sum()), "land cells", flush=True)

# ---- one pass over the tiles
daily = np.zeros(NC * ND); mon = {k: np.zeros(NC * NMI) for k in ("M", "V", "H", "MD", "VD")}
for name in idx["tiles"]:
    la, lo = map(int, name.split("_"))
    b = gzip.open(f"{APP}/tiles/{name}.bin.gz").read(); k = struct.unpack("<I", b[4:8])[0]
    day = np.frombuffer(b, "<u2", k, 8).astype(np.int64); cell = np.frombuffer(b, "<u2", k, 8 + 2 * k).astype(np.int64)
    md = np.frombuffer(b, "u1", k, 8 + 8 * k); vd = np.frombuffer(b, "u1", k, 8 + 9 * k)
    h = np.frombuffer(gzip.open(f"{APP}/{HARM}/eq2/{name}.bin.gz").read(), "u1", k, 8) / 100.0
    cid = grid[(la + 90) * 10 + cell // 50, (lo + 180) * 10 + cell % 50].astype(np.int64)
    ok = cid >= 0
    if not ok.any(): continue
    cid, day, md, vd, h = cid[ok], day[ok], md[ok], vd[ok], h[ok]
    m = (md > 0).astype(float); v = (vd > 0).astype(float)
    daily += np.bincount(cid * ND + day, weights=np.where(day < VS, m, h), minlength=NC * ND)
    km = cid * NMI + MI[day]
    for key, w in (("M", m), ("V", v), ("H", np.where(vd > 0, h, 0.0)), ("MD", md.astype(float)), ("VD", vd.astype(float))):
        mon[key] += np.bincount(km, weights=w, minlength=NC * NMI)
daily = daily.reshape(NC, ND); mon = {k: a.reshape(NC, NMI) for k, a in mon.items()}

# ---- write
tot = 0
for ci, f in enumerate(fc):
    iso = f["properties"]["id"]
    out = {"first_day": F0, "cells": int(cells[ci]), "km2": round(float(km2[ci])), "daily": [round(float(x), 2) for x in daily[ci, F0:]],
           "M": [round(float(x), 1) for x in mon["M"][ci]], "V": [round(float(x), 1) for x in mon["V"][ci]],
           "H": [round(float(x), 2) for x in mon["H"][ci]], "MD": [int(x) for x in mon["MD"][ci]], "VD": [int(x) for x in mon["VD"][ci]]}
    with gzip.open(f"{OUT}/{iso}.json.gz", "wt") as fh: json.dump(out, fh, separators=(",", ":"))
    tot += daily[ci].sum()
top = sorted(((daily[ci].sum(), fc[ci]["properties"]["name"]) for ci in range(NC)), reverse=True)[:6]
print("written", NC, "files; record total", round(tot), "; largest:", [(n, round(v)) for v, n in top])
