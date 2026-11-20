# SI/AI disclosure: written with Claude Code (Anthropic), an AI assistant, working with team Paween_and_Kpunn. See README.md.
"""Identical-sensor ceiling: how well does NOAA-20 VIIRS reproduce Suomi NPP VIIRS fire cell-days?

Usage: python twin_score.py <twin dir from twin_extract.py> <model.json> [out.csv]
Same instrument, same filters, orbits 50 minutes apart. Suomi NPP plays the role of MODIS (truth) and NOAA-20 the
predictor, with the same k (1-degree) and seasonal (5-degree x month) factors, fitted on 2022-2025 and scored on
2019-2021 with the same metrics. Days when either satellite was partly down are excluded by the same rule.
"""
import sys
import numpy as np, pandas as pd
from calib_lib import fit, apply, keys
from v2_eval import score, add_region

T, MJSON = sys.argv[1], sys.argv[2]
Y0, Y1 = 2019, 2025
cal = pd.date_range("2000-01-01", periods=10000); CY = cal.year.values; CM = cal.month.values
NYM = (Y1 - Y0 + 1) * 12


def load(sensor):
    k = np.unique(np.concatenate([np.load(f"{T}/{sensor}_{y}.npy") for y in range(Y0, Y1 + 1)]))
    day = k // 6480000
    ok = (CY[day] >= Y0) & (CY[day] <= Y1)
    return k[ok]


S, N = load("viirs-snpp"), load("viirs-jpss1")
d0 = (pd.Timestamp(f"{Y0}-01-01") - cal[0]).days; nd = (pd.Timestamp(f"{Y1 + 1}-01-01") - cal[0]).days - d0
ds = np.bincount(S // 6480000 - d0, minlength=nd).astype(float); dn = np.bincount(N // 6480000 - d0, minlength=nd).astype(float)
r = pd.Series(np.log((ds + 50) / (dn + 50))); dev = r - r.rolling(91, center=True, min_periods=20).median()
good = np.ones(len(cal), bool); good[d0 + np.nonzero((dev.abs() > 0.2).values)[0]] = False
print(f"days flagged: {(dev.abs() > 0.2).sum()} of {nd}; NOAA-20 / Suomi NPP cell-days overall: {dn.sum() / ds.sum():.3f}")
both = np.intersect1d(S, N).size
print(f"cell-days seen by both: {both / len(S):.1%} of Suomi NPP's, {both / len(N):.1%} of NOAA-20's")


def agg(k):
    day = k // 6480000; row = (k % 6480000) // 3600; col = k % 3600; ok = good[day]
    b = ((row[ok] // 5) * 720 + col[ok] // 5) * NYM + (CY[day[ok]] - Y0) * 12 + CM[day[ok]] - 1
    return np.bincount(b, minlength=360 * 720 * NYM).astype(float)


M, P = agg(S), agg(N); nz = np.nonzero((M > 0) | (P > 0))[0]
d = pd.DataFrame({"hrow": nz // NYM // 720, "hcol": nz // NYM % 720, "year": Y0 + (nz % NYM) // 12, "month": (nz % NYM) % 12 + 1,
                  "m": M[nz], "p": P[nz]})
d["region"] = add_region(d, MJSON)
tr = d[d.year >= 2022]; t5 = keys(d, "5"); root = tr.m.sum() / tr.p.sum()
mdl = fit(tr.assign(e=tr.p), 100, "1", cap=2.0, root=root); d["cal"] = d.p * apply(d.assign(e=d.p), mdl, "1", root=root)
g = d.loc[tr.index].groupby([t5.loc[tr.index], tr.month])[["m", "cal"]].sum(); f = ((g.m + 300) / (g.cal + 300)).clip(1 / 1.3, 1.3)
d["cal"] *= pd.Series(f.reindex(pd.MultiIndex.from_arrays([t5, d.month])).values, index=d.index).fillna(1.0)
d["raw"] = d.p * root
t = d[(d.year >= 2019) & (d.year <= 2021)]
out = pd.DataFrame([score(t, "raw", "NOAA-20 x one global factor"), score(t, "cal", "NOAA-20 x local and seasonal factors")])
pd.set_option("display.width", 250); print(out.T.to_string(header=False))
if len(sys.argv) > 3: out.to_csv(sys.argv[3], index=False)
