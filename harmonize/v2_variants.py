# SI/AI disclosure: written with Claude Code (Anthropic), an AI assistant, working with team Paween_and_Kpunn. See README.md.
"""Compare ways of handling orphan MODIS cell-days (seen by MODIS, nothing from VIIRS nearby).

Usage: python v2_variants.py <cache dir> <tag> <train_end_year>
  cap variants : multiplicative local factor k with different caps
  additive     : stage-2 x k (fitted to the allocated part only) + orphan climatology per (1-deg cell, month of year)
"""
import sys
import numpy as np, pandas as pd
from calib_lib import fit, apply, keys
from v2_eval import score

C, TAG, TRAIN_END = sys.argv[1], sys.argv[2], int(sys.argv[3])
d = pd.read_parquet(f"{C}/agg_{TAG}.parquet")
if "y" not in d:
    good = np.load(f"{C}/good_day.npy"); cal = pd.date_range("2000-01-01", periods=len(good))
    YMI = ((cal.year - 2012) * 12 + cal.month - 1).values
    F = lambda n: np.load(f"{C}/f_{n}.npy")
    day, grow, gcol = F("day"), F("grow"), F("gcol"); ok = good[day] & (YMI[day] >= 1)
    k = ((grow[ok] // 5).astype(np.int64) * 720 + gcol[ok] // 5) * 180 + YMI[day[ok]]
    Y = np.bincount(k, weights=F("y")[ok].astype(float), minlength=360 * 720 * 180)
    kk = (d.hrow.values.astype(np.int64) * 720 + d.hcol.values) * 180 + (d.year.values - 2012) * 12 + d.month.values - 1
    d["y"] = Y[kk]; d.to_parquet(f"{C}/agg_{TAG}.parquet")
d["orph"] = (d.m - d.y).clip(lower=0)
tr = d[d.year <= TRAIN_END]; nyr = TRAIN_END - 2012 + 1
t5, c1 = keys(d, "5"), keys(d, "1")
print("orphan share of MODIS (train):", round(tr.orph.sum() / tr.m.sum(), 3))


def seasonal(col, lam=300, cap=1.3):
    g = d.loc[tr.index].groupby([t5.loc[tr.index], tr.month])[["m", col]].sum()
    f = ((g.m + lam) / (g[col] + lam)).clip(1 / cap, cap)
    return pd.Series(f.reindex(pd.MultiIndex.from_arrays([t5, d.month])).values, index=d.index).fillna(1.0)


cols = {}
root = tr.m.sum() / tr.p.sum()
for cap in (1.5, 2.0, 3.0):
    mdl = fit(tr.assign(e=tr.p), 100, "1", cap=cap, root=root)
    d[f"mult{cap}"] = d.p * apply(d.assign(e=d.p), mdl, "1", root=root)
    d[f"mult{cap}s"] = d[f"mult{cap}"] * seasonal(f"mult{cap}")
    cols[f"mult{cap}s"] = f"multiplicative k, cap {cap}, + seasonal"
# additive orphan climatology: mean orphans per calendar month in each 1-deg cell, spread over the cell's 0.5-deg rows
oc = tr.groupby([c1.loc[tr.index], tr.month]).orph.sum() / nyr
rows_per = d.groupby([c1, "year", "month"]).p.transform("size")          # 0.5-deg rows present for that cell-month
d["oclim"] = pd.Series(oc.reindex(pd.MultiIndex.from_arrays([c1, d.month])).values, index=d.index).fillna(0) / rows_per
root_y = tr.y.sum() / tr.p.sum()
mdl = fit(tr.assign(e=tr.p, m=tr.y), 100, "1", cap=1.5, root=root_y)
d["alloc"] = d.p * apply(d.assign(e=d.p), mdl, "1", root=root_y)
d["add"] = d.alloc + d.oclim; d["adds"] = d["add"] * seasonal("add"); cols["adds"] = "additive orphan climatology + seasonal"
for a in (0.5,):  # hybrid: half of the orphans additive, half proportional
    mdl = fit(tr.assign(e=tr.p, m=tr.y + (1 - a) * tr.orph), 100, "1", cap=2.0, root=(tr.y.sum() + (1 - a) * tr.orph.sum()) / tr.p.sum())
    d["hyb"] = d.p * apply(d.assign(e=d.p), mdl, "1", root=(tr.y.sum() + (1 - a) * tr.orph.sum()) / tr.p.sum()) + a * d.oclim
    d["hybs"] = d.hyb * seasonal("hyb"); cols["hybs"] = "hybrid 50/50 + seasonal"
rows = []
for period, (a, b) in {"2019-2021": (2019, 2021), "2022-2023": (2022, 2023)}.items():
    t = d[(d.year >= a) & (d.year <= b)]
    for c, lab in cols.items(): rows.append({"period": period, **score(t, c, lab)})
pd.set_option("display.width", 320); print(pd.DataFrame(rows).T.to_string(header=False))
t = d[(d.year >= 2019) & (d.year <= 2021)]; g = t.groupby("region")[["m"] + list(cols)].sum(); g = g[g.m > 3000]
print((g[list(cols)].div(g.m, axis=0)).round(3).assign(modis=g.m.astype(int)).sort_values("modis").to_string())
