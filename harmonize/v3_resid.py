# SI/AI disclosure: written with Claude Code (Anthropic), an AI assistant, working with team Paween_and_Kpunn. See README.md.
"""Stage 3: a monthly correction at 1 degree, fitted on what stages 1-2 and the k/s factors leave behind.

Usage: python v3_resid.py <cache dir> <model.json> <tag> <train_end_year> [out.csv]
Poisson model for MODIS cell-days per (1-degree cell, month) with offset log(v2). Features describe the month's
VIIRS fire (amount, intensity, clustering, persistence), how unusual the month is against the training-period
climatology, and the cell's climatological MODIS-only ("orphan") background. Climatologies are leave-one-year-out
for training rows so the target year never informs its own features.
"""
import sys
import numpy as np, pandas as pd, xgboost as xgb
from calib_lib import fit, apply, keys
from v2_eval import score, add_region

C, MJSON, TAG, TE = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
good = np.load(f"{C}/good_day.npy"); cal = pd.date_range("2000-01-01", periods=len(good))
YMI = ((cal.year - 2012) * 12 + cal.month - 1).values
NYM = 180; NB1 = 64800 * NYM

# ---- v2 at 0.5 degree (same recipe as production)
d = pd.read_parquet(f"{C}/agg_{TAG}.parquet"); tr = d[d.year <= TE]
t5 = keys(d, "5"); root = tr.m.sum() / tr.p.sum()
mdl = fit(tr.assign(e=tr.p), 100, "1", cap=2.0, root=root); d["v2"] = d.p * apply(d.assign(e=d.p), mdl, "1", root=root)
g = d.loc[tr.index].groupby([t5.loc[tr.index], tr.month])[["m", "v2"]].sum(); f = ((g.m + 300) / (g.v2 + 300)).clip(1 / 1.3, 1.3)
d["v2"] *= pd.Series(f.reindex(pd.MultiIndex.from_arrays([t5, d.month])).values, index=d.index).fillna(1.0)
d["c1"] = (d.hrow // 2) * 360 + d.hcol // 2; d["ymi"] = (d.year - 2012) * 12 + d.month - 1

# ---- per (1-degree cell, month) sums from the VIIRS cell-day features
F = lambda n: np.load(f"{C}/f_{n}.npy")
day, grow, gcol = F("day"), F("grow"), F("gcol"); ok = good[day] & (YMI[day] >= 1)
k1 = ((grow[ok] // 10).astype(np.int64) * 360 + gcol[ok] // 10) * NYM + YMI[day[ok]]
S = lambda w: np.bincount(k1, weights=w, minlength=NB1)
N = np.bincount(k1, minlength=NB1).astype(float)
feats = {"n": N, "y": S(F("y")[ok].astype(float))}
for nm in ("eq", "lfrp", "n3", "prev7", "p3"): feats["mean_" + nm] = S(F(nm)[ok].astype(float))
feats["share_single"] = S((F("v")[ok] == 1).astype(float))
dk = k1 * 400 + (day[ok] % 400)   # distinct active days per cell-month
feats["days"] = np.bincount(np.unique(dk) // 400, minlength=NB1).astype(float)
del day, grow, gcol, k1, dk

a = d.groupby(["c1", "ymi"], as_index=False)[["m", "v2"]].sum()
kk = a.c1.values.astype(np.int64) * NYM + a.ymi.values
for nm, arr in feats.items(): a[nm] = arr[kk]
for nm in ("mean_eq", "mean_lfrp", "mean_n3", "mean_prev7", "mean_p3", "share_single"): a[nm] = a[nm] / np.maximum(a.n, 1)
a["year"] = 2012 + a.ymi // 12; a["month"] = a.ymi % 12 + 1
a["orph"] = (a.m - a.y).clip(lower=0)
a["lat"] = a.c1 // 360 - 90 + .5; a["lon"] = a.c1 % 360 - 180 + .5
a["t5"] = (a.c1 // 360 // 5) * 72 + (a.c1 % 360) // 5

# ---- climatologies over training years, leave-one-year-out for training rows
istr = a.year <= TE; nyr = TE - 2012 + 1
for col, grp, out in [("v2", ["c1", "month"], "clim_v2"), ("orph", ["c1", "month"], "clim_orph"), ("m", ["c1", "month"], "clim_m"),
                      ("orph", ["c1"], "clim_orph_yr"), ("v2", ["c1"], "clim_v2_yr")]:
    s = a[istr].groupby(grp)[col].sum().rename("s")
    tot = a[grp].merge(s, left_on=grp, right_index=True, how="left").s.fillna(0).values
    per = 1 if len(grp) == 2 else 12
    a[out] = np.where(istr, (tot - np.where(istr, a[col], 0)) / (nyr - 1), tot / nyr) / per
tm = a.groupby(["t5", "ymi"])[["v2"]].sum().rename(columns={"v2": "tile_v2"}); a = a.merge(tm, left_on=["t5", "ymi"], right_index=True)
tc = a[istr].groupby(["t5", "month"]).v2.sum().rename("tile_clim") / nyr; a = a.merge(tc, left_on=["t5", "month"], right_index=True, how="left").fillna({"tile_clim": 0})
L = lambda x: np.log1p(x)
X = pd.DataFrame({
    "l_v2": L(a.v2), "l_n": L(a.n), "days": a.days, "mean_eq": a.mean_eq, "mean_lfrp": a.mean_lfrp, "mean_n3": a.mean_n3,
    "mean_prev7": a.mean_prev7, "mean_p3": a.mean_p3, "share_single": a.share_single,
    "l_clim_v2": L(a.clim_v2), "l_clim_orph": L(a.clim_orph), "l_clim_m": L(a.clim_m), "l_clim_orph_yr": L(a.clim_orph_yr),
    "anom": L(a.v2) - L(a.clim_v2), "orph_vs_v2": L(a.clim_orph) - L(a.v2), "clim_ratio": L(a.clim_m) - L(a.clim_v2),
    "l_tile_v2": L(a.tile_v2), "tile_anom": L(a.tile_v2) - L(a.tile_clim), "lat": a.lat, "lon": a.lon, "month": a.month}).astype(np.float32)
FE = list(X.columns)
base = np.log(a.v2.values + 0.05)
P = dict(objective="count:poisson", tree_method="hist", max_depth=6, eta=0.05, min_child_weight=30, subsample=0.8, colsample_bytree=0.8,
         reg_lambda=5, nthread=16, eval_metric="poisson-nloglik")


def dm(mask):
    q = xgb.DMatrix(X[mask], a.m[mask], feature_names=FE); q.set_base_margin(base[mask]); return q


inner_tr = istr & (a.year <= TE - 2); inner_va = istr & (a.year > TE - 2)
b = xgb.train(P, dm(inner_tr), 1500, [(dm(inner_va), "valid")], early_stopping_rounds=50, verbose_eval=100)
rounds = b.best_iteration + 1; print("rounds", rounds)
b = xgb.train(P, dm(istr), rounds)
imp = b.get_score(importance_type="total_gain"); tot = sum(imp.values())
print("importance:", {k: round(v / tot, 3) for k, v in sorted(imp.items(), key=lambda kv: -kv[1])[:10]})
allm = xgb.DMatrix(X, feature_names=FE); allm.set_base_margin(base)
a["v3"] = b.predict(allm); a["corr"] = (a.v3 / (a.v2 + 0.05)).clip(0.2, 5)
b.save_model(f"{C}/stage3_{TAG}.ubj"); a.to_parquet(f"{C}/cellmonth_{TAG}.parquet")

# ---- back to the 0.5-degree rows: multiplicative correction, plus the part that has no VIIRS to scale
d = d.merge(a[["c1", "ymi", "corr", "v3", "v2"]].rename(columns={"v2": "v2c"}), on=["c1", "ymi"], how="left")
rows_per = d.groupby(["c1", "ymi"]).m.transform("size")
d["v3"] = np.where(d.v2c > 0.5, d.v2 * d["corr"], d["v3"] / rows_per)
d["region"] = add_region(d, MJSON)
rows = []
for period, (y0, y1) in {"2019-2021": (2019, 2021), "2022-2023": (2022, 2023)}.items():
    if y0 <= TE: continue
    t = d[(d.year >= y0) & (d.year <= y1)]
    for col, lab in [("v2", "v2"), ("v3", "v3: v2 + monthly stage 3")]: rows.append({"period": period, **score(t, col, lab)})
out = pd.DataFrame(rows); pd.set_option("display.width", 320); print(out.T.to_string(header=False))
if len(sys.argv) > 5: out.to_csv(sys.argv[5], index=False)
d.to_parquet(f"{C}/agg_{TAG}_v3.parquet")
