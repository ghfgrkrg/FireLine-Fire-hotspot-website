# SI/AI disclosure: written with Claude Code (Anthropic), an AI assistant, working with team Paween_and_Kpunn. See README.md.
"""Score harmonization variants on held-out years (sensor-outage days excluded from both sides).

Usage: python v2_score.py <cache dir> <model.json> <tag> <train_end_year> [out.csv]
"""
import sys
import numpy as np, pandas as pd
from calib_lib import fit, apply, keys
from v2_eval import score, add_region

C, MJSON, TAG, TRAIN_END = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
good = np.load(f"{C}/good_day.npy")
cal = pd.date_range("2000-01-01", periods=len(good))
YMI = ((cal.year - 2012) * 12 + cal.month - 1).values
NB = 360 * 720 * 180


def binsum(day, grow, gcol, w):
    ok = good[day] & (YMI[day] >= 1)  # from 2012-02
    k = ((grow[ok] // 5).astype(np.int64) * 720 + gcol[ok] // 5) * 180 + YMI[day[ok]]
    return np.bincount(k, weights=w[ok], minlength=NB)


L = lambda n: np.load(f"{C}/cd_{n}.npy", mmap_mode="r")
s = int(np.searchsorted(np.asarray(L("day")), 4402))
day = np.asarray(L("day")[s:]); grow = np.asarray(L("grow")[s:]); gcol = np.asarray(L("gcol")[s:])
M = binsum(day, grow, gcol, (np.asarray(L("m")[s:]) > 0).astype(float))
E = binsum(day, grow, gcol, np.asarray(L("eq")[s:]) / 100.0)
del day, grow, gcol
F = lambda n: np.load(f"{C}/f_{n}.npy")
P = binsum(F("day"), F("grow"), F("gcol"), np.load(f"{C}/pred_{TAG}.npy").astype(float))
nz = np.nonzero((M > 0) | (E > 0) | (P > 0))[0]
d = pd.DataFrame({"hrow": nz // 180 // 720, "hcol": nz // 180 % 720, "year": 2012 + (nz % 180) // 12, "month": (nz % 180) % 12 + 1,
                  "m": M[nz], "e": E[nz], "p": P[nz]})
d["region"] = add_region(d, MJSON)
d.to_parquet(f"{C}/agg_{TAG}.parquet")
print("rows", len(d), " MODIS", int(d.m.sum()), " stage-2 sum/MODIS", round(d.p.sum() / d.m.sum(), 3), flush=True)

tr = d[d.year <= TRAIN_END]
t5 = keys(d, "5")


def seasonal(col, lam, cap=1.3):
    """Extra factor per (5-degree tile, month of year), shrunk to 1."""
    g = d.loc[tr.index].groupby([t5.loc[tr.index], tr.month])[["m", col]].sum()
    f = ((g.m + lam) / (g[col] + lam)).clip(1 / cap, cap)
    return pd.Series(f.reindex(pd.MultiIndex.from_arrays([t5, d.month])).values, index=d.index).fillna(1.0)


m1 = fit(tr, 100, "1", cap=1.5); d["v1"] = d.e * apply(d, m1, "1")
root = tr.m.sum() / tr.p.sum()
m2 = fit(tr.assign(e=tr.p), 100, "1", cap=2.0, root=root)
d["v2"] = d.p * apply(d.assign(e=d.p), m2, "1", root=root)
tr = d[d.year <= TRAIN_END]
for lam in (300, 1000):
    d[f"v2s{lam}"] = d.v2 * seasonal("v2", lam)
d["v1s300"] = d.v1 * seasonal("v1", 300)
d["ceil"] = np.random.default_rng(0).poisson(d.m)
rows = []
for period, (a, b) in {"2019-2021": (2019, 2021), "2022-2023": (2022, 2023)}.items():
    if a <= TRAIN_END: continue
    t = d[(d.year >= a) & (d.year <= b)]
    for col, lab in [("e", "regional model"), ("v1", "v1 local factors"), ("v1s300", "v1 + seasonal"), ("v2", "v2 stage-2 + local"),
                     ("v2s300", "v2 + seasonal lam300"), ("v2s1000", "v2 + seasonal lam1000"), ("ceil", "ceiling (perfect model, counting noise)")]:
        rows.append({"period": period, **score(t, col, lab)})
out = pd.DataFrame(rows); pd.set_option("display.width", 320)
print(out.T.to_string(header=False))
if len(sys.argv) > 5: out.to_csv(sys.argv[5], index=False)
