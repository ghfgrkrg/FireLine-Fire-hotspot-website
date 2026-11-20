# SI/AI disclosure: written with Claude Code (Anthropic), an AI assistant, working with team Paween_and_Kpunn. See README.md.
"""Train calibration on 2012-2018, evaluate on held-out 2019-2021.  Usage: python experiment.py <agg.parquet>"""
import sys
import numpy as np, pandas as pd
from calib_lib import fit, apply, keys

agg = pd.read_parquet(sys.argv[1])
ov = agg[((agg.year > 2012) | ((agg.year == 2012) & (agg.month >= 2))) & (agg.year <= 2021)].copy()
train = ov[ov.year <= 2018]; test = ov[ov.year >= 2019].copy()


def score(test, ecol, label):
    r = {"model": label}
    for lvl, name in [("5", "5deg"), ("1", "1deg")]:
        g = test.groupby(keys(test, lvl))[["m", ecol]].sum()
        g = g[g.m >= (500 if lvl == "5" else 100)]
        ratio = g[ecol] / g.m; w = g.m / g.m.sum()
        r[f"{name}_in10"] = round(w[(ratio > .9) & (ratio < 1.1)].sum(), 3)
        r[f"{name}_in20"] = round(w[(ratio > .8) & (ratio < 1.2)].sum(), 3)
        r[f"{name}_mae_log"] = round((w * np.abs(np.log(ratio))).sum(), 3)
    # monthly correlation per 5-deg tile (time series shape)
    t5 = test.assign(k=keys(test, "5")).groupby(["k", "year", "month"])[["m", ecol]].sum()
    big = t5.groupby("k").m.sum(); big = big[big >= 500].index
    cs = t5.loc[big].groupby("k").apply(lambda x: x.m.corr(x[ecol]))
    r["5deg_monthly_r_median"] = round(cs.median(), 3)
    r["world_ratio"] = round(test[ecol].sum() / test.m.sum(), 3)
    return r


rows = [score(test, "e", "baseline (regional model only)")]
for cap in [None, 3, 2, 1.5, 1.3]:
    model = fit(train, 100, "1", cap=cap)
    test["ec"] = test.e * apply(test, model, "1")
    rows.append(score(test, "ec", f"local 1, lam=100, cap={cap}"))
print(pd.DataFrame(rows).to_string(index=False))
