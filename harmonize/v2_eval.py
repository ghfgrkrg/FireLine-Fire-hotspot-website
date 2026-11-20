# SI/AI disclosure: written with Claude Code (Anthropic), an AI assistant, working with team Paween_and_Kpunn. See README.md.
"""Shared scoring for harmonization variants. All shares are weighted by MODIS fire activity."""
import json
import numpy as np, pandas as pd
from calib_lib import keys


def add_region(df, model_json):
    tr = json.load(open(model_json))["tile_region"]
    t = (df.hrow // 10 - 18).astype(str) + "_" + (df.hcol // 10 - 36).astype(str)  # 5-degree tile indices
    return t.map(tr).fillna("World")


def _within(g, col, lo, hi):
    r = g[col] / g.m; w = g.m / g.m.sum()
    return round(float(w[(r > lo) & (r < hi)].sum()), 3)


def score(t, col, label):
    """t: rows (hrow, hcol, year, month, region, m, <col>) for the test period."""
    r = {"model": label}
    for lvl, name, mn in [("5", "5deg", 500), ("1", "1deg", 100)]:
        g = t.groupby(keys(t, lvl))[["m", col]].sum(); g = g[g.m >= mn]
        r[f"{name}_tot_in10"] = _within(g, col, .9, 1.1); r[f"{name}_tot_in20"] = _within(g, col, .8, 1.2)
    # monthly values, the unit the calendar shows
    for lvl, name, mn in [("5", "5deg", 200), ("1", "1deg", 100)]:
        g = t.groupby([keys(t, lvl), "year", "month"])[["m", col]].sum(); g = g[g.m >= mn]
        r[f"{name}_month_in10"] = _within(g, col, .9, 1.1); r[f"{name}_month_in20"] = _within(g, col, .8, 1.2)
    g = t.groupby(["region", "year", "month"])[["m", col]].sum(); g = g[g.m >= 500]
    r["region_month_in10"] = _within(g, col, .9, 1.1)
    g = t.groupby("region")[["m", col]].sum(); g = g[g.m >= 3000]; rr = g[col] / g.m
    r["regions_in10"] = f"{int(((rr > .9) & (rr < 1.1)).sum())}/{len(rr)}"
    r["region_range"] = f"{rr.min():.2f}-{rr.max():.2f}"
    g = t.groupby(["year", "month"])[["m", col]].sum(); wm = g[col] / g.m
    r["world_month_range"] = f"{wm.min():.2f}-{wm.max():.2f}"
    r["world"] = round(float(t[col].sum() / t.m.sum()), 3)
    return r
