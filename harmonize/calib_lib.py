# SI/AI disclosure: written with Claude Code (Anthropic), an AI assistant, working with team Paween_and_Kpunn. See README.md.
"""Hierarchical local calibration of MODIS-equivalent counts.

k at each level = (M + lam * k_parent) / (E + lam), where M = MODIS cell-days and E = summed MODIS-equivalent
in the overlap (training) period. Levels: world (1.0) -> 5 deg -> 1 deg -> 0.5 deg [-> month of year].
Shrinkage lam is in cell-day units: cells with little fire stay close to their parent's factor.
"""
import numpy as np, pandas as pd

LEVELS = {"5": 10, "1": 2, "h": 1}  # divisor applied to 0.5-deg indices


def keys(df, lvl):
    d = LEVELS[lvl]
    return (df.hrow // d).astype(np.int32) * 10000 + (df.hcol // d).astype(np.int32)


def fit(train, lam, depth="h", seasonal_lam=None, cap=None, root=1.0):
    """Return dict level -> Series(key -> k), plus optional seasonal table."""
    out, parent = {}, None
    for lvl in ["5", "1", "h"]:
        k = keys(train, lvl)
        g = train.groupby(k)[["m", "e"]].sum()
        if parent is None:
            pk = pd.Series(root, index=g.index)
        else:
            plvl, pser = parent
            pidx = (g.index // 10000 // (LEVELS[plvl] // LEVELS[lvl])) * 10000 + \
                   (g.index % 10000) // (LEVELS[plvl] // LEVELS[lvl])
            pk = pd.Series(pser.reindex(pidx).values, index=g.index).fillna(root)
        ks = (g.m + lam * pk) / (g.e + lam)
        if cap is not None: ks = ks.clip(root / cap, root * cap)
        out[lvl] = ks
        parent = (lvl, ks)
        if lvl == depth: break
    if seasonal_lam is not None:
        k = keys(train, depth)
        g = train.groupby([k, train.month])[["m", "e"]].sum()
        base = out[depth].reindex(g.index.get_level_values(0)).values
        out["season"] = (g.m + seasonal_lam * base) / (g.e + seasonal_lam)
    return out


def apply(df, model, depth="h", root=1.0):
    """Factor for each row of df (cells unseen in training fall back up the hierarchy, finally 1.0)."""
    f = pd.Series(root, index=df.index)
    for lvl in ["5", "1", "h"]:
        if lvl in model:
            v = keys(df, lvl).map(model[lvl])
            f = v.where(v.notna(), f)
        if lvl == depth: break
    if "season" in model:
        mi = pd.MultiIndex.from_arrays([keys(df, depth), df.month])
        v = pd.Series(model["season"].reindex(mi).values, index=df.index)
        f = v.where(v.notna(), f)
    return f
