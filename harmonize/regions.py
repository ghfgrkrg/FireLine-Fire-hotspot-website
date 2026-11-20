# SI/AI disclosure: written with Claude Code (Anthropic), an AI assistant, working with team Paween_and_Kpunn. See README.md.
"""Per-region before/after table for the chosen calibration (train 2012-2018).
Usage: python regions.py <agg.parquet> <model.json> <out.csv>"""
import json, sys
import numpy as np, pandas as pd
from calib_lib import fit, apply

agg = pd.read_parquet(sys.argv[1]); tile_region = json.load(open(sys.argv[2]))["tile_region"]
LAM, DEPTH = 100, "1"
CAP = float(sys.argv[4]) if len(sys.argv) > 4 else None
ov = agg[((agg.year > 2012) | ((agg.year == 2012) & (agg.month >= 2)))].copy()
tile = (ov.hrow // 10 - 18).astype(str) + "_" + (ov.hcol // 10 - 36).astype(str)  # tile_region keys are 5-deg indices
ov["region"] = tile.map(tile_region).fillna("World")
model = fit(ov[ov.year <= 2018], LAM, DEPTH, cap=CAP)
ov["ec"] = ov.e * apply(ov, model, DEPTH)

rows = []
for period, (y0, y1) in {"2019-2021": (2019, 2021), "2022-2023": (2022, 2023)}.items():
    t = ov[(ov.year >= y0) & (ov.year <= y1)]
    for reg, g in [("ALL", t)] + sorted(t.groupby("region")):
        mo = g.groupby(["year", "month"])[["m", "e", "ec", "v"]].sum()
        if mo.m.sum() < 1000: continue
        rows.append(dict(period=period, region=reg, modis=int(mo.m.sum()),
                         raw_over_modis=round(mo.v.sum() / mo.m.sum(), 2),
                         before=round(mo.e.sum() / mo.m.sum(), 3), after=round(mo.ec.sum() / mo.m.sum(), 3),
                         r_before=round(mo.m.corr(mo.e), 3), r_after=round(mo.m.corr(mo.ec), 3)))
out = pd.DataFrame(rows); out.to_csv(sys.argv[3], index=False)
print(out.to_string(index=False))
