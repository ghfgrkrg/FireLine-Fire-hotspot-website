# SI/AI disclosure: written with Claude Code (Anthropic), an AI assistant, working with team Paween_and_Kpunn. See README.md.
"""Orbit-cycle table for NOAA-20 days.

Usage: python v3_n20_table.py <cache dir> <twin dir>
The production table lg16 is MODIS's yield relative to Suomi NPP's summed eq, by (day mod 16, 5-degree latitude band,
1-degree longitude). NOAA-20 flies the same orbit half a revolution away, so its cycle phase differs and the table
does not apply to it. NOAA-20's eq is not stored for ordinary days, only its fire cell-days (twin_extract.py), so the
NOAA-20 table is built from cell-day counts. Three checks decide whether that is sound:
  1. Suomi NPP: does a count-based table agree with the eq-based one?           (the substitution is valid)
  2. NOAA-20 table against the Suomi NPP table at the same cycle day             (they should differ)
  3. NOAA-20 table against the Suomi NPP table shifted by k days, k = 0..15      (orbit geometry predicts one best shift)
Writes <cache>/geom16_n20.npy, scaled to the eq-based table using the slope found in check 1.
"""
import sys
import numpy as np, pandas as pd

C, T = sys.argv[1], sys.argv[2]
Y0, Y1 = 2019, 2021                      # years with healthy MODIS and both VIIRS satellites
good = np.load(f"{C}/good_day.npy"); n20day = np.load(f"{C}/n20_day.npy")
cal = pd.date_range("2000-01-01", periods=len(good)); CY = cal.year.values
NL = 36; SHAPE = (16, NL, 360)
key = lambda d, r, c: ((d % 16) * NL + r // 50) * 360 + c // 10


def table(num, den):
    return np.log((num + 50) / (den * num.sum(0, keepdims=True) / np.maximum(den.sum(0, keepdims=True), 1e-9) + 50))


# MODIS cell-days and Suomi NPP summed eq from the processed tiles
L = lambda n: np.load(f"{C}/cd_{n}.npy", mmap_mode="r")
day = np.asarray(L("day")).astype(np.int64)
a, b = np.searchsorted(day, [(pd.Timestamp(f"{Y0}-01-01") - cal[0]).days, (pd.Timestamp(f"{Y1 + 1}-01-01") - cal[0]).days])
day = day[a:b]; row = np.asarray(L("grow")[a:b]).astype(np.int64); col = np.asarray(L("gcol")[a:b]).astype(np.int64)
ok = good[day] & ~n20day[day]
m = np.asarray(L("m")[a:b]) > 0; v = np.asarray(L("v")[a:b]) > 0; eq = np.asarray(L("eq")[a:b]) / 100.0
M = np.bincount(key(day[ok & m], row[ok & m], col[ok & m]), minlength=16 * NL * 360).astype(float).reshape(SHAPE)
E = np.bincount(key(day[ok & v], row[ok & v], col[ok & v]), weights=eq[ok & v], minlength=16 * NL * 360).reshape(SHAPE)


def counts(sensor):
    out = np.zeros(16 * NL * 360)
    for y in range(Y0, Y1 + 1):
        k = np.load(f"{T}/{sensor}_{y}.npy"); d = k // 6480000; r = (k % 6480000) // 3600; c = k % 3600
        g = (CY[d] >= Y0) & (CY[d] <= Y1) & good[d] & ~n20day[d]
        out += np.bincount(key(d[g], r[g], c[g]), minlength=16 * NL * 360)
    return out.reshape(SHAPE)


VS, VN = counts("viirs-snpp"), counts("viirs-jpss1")
G_eq, G_cs, G_cn = table(M, E), table(M, VS), table(M, VN)
w = M > 30                                # entries with enough MODIS fire to mean something


def corr(x, y): return float(np.corrcoef(x[w], y[w])[0, 1])


slope = float((G_eq[w] * G_cs[w]).sum() / (G_cs[w] ** 2).sum())
print(f"entries compared: {int(w.sum())}")
print(f"1. Suomi NPP, count-based vs eq-based table: correlation {corr(G_eq, G_cs):.3f}, slope {slope:.3f}")
print(f"2. NOAA-20 vs Suomi NPP, same cycle day:      correlation {corr(G_cn, G_cs):.3f}")
shifts = [float(np.corrcoef(G_cn[w], np.roll(G_cs, k, axis=0)[w])[0, 1]) for k in range(16)]
print("3. NOAA-20 vs Suomi NPP shifted by k days:", " ".join(f"{k}:{c:.2f}" for k, c in enumerate(shifts)), f"-> best shift {int(np.argmax(shifts))} days")
print(f"   sd of the NOAA-20 table (fire-weighted): {float(np.sqrt((G_cn ** 2 * M).sum() / M.sum())):.3f}; Suomi NPP: {float(np.sqrt((G_cs ** 2 * M).sum() / M.sum())):.3f}")
np.save(f"{C}/geom16_n20.npy", (G_cn * slope).clip(-3, 1.5).astype(np.float32))
print("saved geom16_n20.npy")
