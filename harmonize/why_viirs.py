# SI/AI disclosure: written with Claude Code (Anthropic), an AI assistant, working with team Paween_and_Kpunn. See README.md.
"""Evidence for why VIIRS reports more fire than MODIS, measured on the processed data (2013-2021, outage days excluded).

Usage: python why_viirs.py <Fire_Hotspot_Data dir> <cache dir from v2_load.py> <out.json>
1. Pixel size of each sensor's hotspots (from the hotspot files of a sample of tiles).
2. For VIIRS fire cell-days grouped by fire power: the share MODIS also detected.
3. Where the extra VIIRS cell-days come from.
"""
import gzip, json, struct, sys
import numpy as np, pandas as pd

ROOT, C, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
good = np.load(f"{C}/good_day.npy")
L = lambda n: np.load(f"{C}/cd_{n}.npy", mmap_mode="r")
d0 = (pd.Timestamp("2013-01-01") - pd.Timestamp("2000-01-01")).days; d1 = (pd.Timestamp("2022-01-01") - pd.Timestamp("2000-01-01")).days
day = np.asarray(L("day")); a, b = np.searchsorted(day, [d0, d1]); day = day[a:b]
ok = good[day]
m = (np.asarray(L("m")[a:b]) > 0)[ok]; v = (np.asarray(L("v")[a:b]) > 0)[ok]; vpix = np.asarray(L("v")[a:b])[ok]
mw = np.expm1(np.asarray(L("vfrp")[a:b])[ok] / 4000.0)

res = {"period": "2013-2021", "modis_cell_days": int(m.sum()), "viirs_cell_days": int(v.sum()), "ratio": round(float(v.sum() / m.sum()), 2),
       "both": int((m & v).sum()), "viirs_only": int((v & ~m).sum()), "modis_only": int((m & ~v).sum())}
edges = [0, 2, 5, 10, 20, 50, 100, 300, 1e9]; labels = ["under 2", "2–5", "5–10", "10–20", "20–50", "50–100", "100–300", "over 300"]
rows = []
for lo, hi, lab in zip(edges[:-1], edges[1:], labels):
    k = v & (mw >= lo) & (mw < hi)
    rows.append({"power_mw": lab, "viirs_cell_days": int(k.sum()), "share_of_viirs": round(float(k.sum() / v.sum()), 4),
                 "modis_also_saw": round(float(m[k].mean()), 4), "median_viirs_pixels": float(np.median(vpix[k]))})
res["by_power"] = rows
k1 = v & (vpix == 1)
res["single_pixel"] = {"share_of_viirs": round(float(k1.sum() / v.sum()), 4), "modis_also_saw": round(float(m[k1].mean()), 4)}
k5 = v & (vpix >= 5)
res["five_plus_pixels"] = {"share_of_viirs": round(float(k5.sum() / v.sum()), 4), "modis_also_saw": round(float(m[k5].mean()), 4)}

# pixel sizes and night share from hotspot files of a spread of tiles, year 2019
idx = json.load(open(f"{ROOT}/app_data/index.json"))
sizes = {"MODIS": [], "VIIRS": []}; night = {"MODIS": [0, 0], "VIIRS": [0, 0]}; frp = {"MODIS": [], "VIIRS": []}
for name in ["15_100", "-10_20", "-10_-60", "35_-125", "40_-10", "-35_145", "5_0", "55_100"]:
    if 2019 not in idx["points"].get(name, []): continue
    bts = gzip.open(f"{ROOT}/app_data/points/{name}/2019.bin.gz").read(); n = struct.unpack("<I", bts[4:8])[0]
    f = np.frombuffer(bts, "<u2", n, 8 + 4 * n); sat = np.frombuffer(bts, "u1", n, 8 + 10 * n); fl = np.frombuffer(bts, "u1", n, 8 + 11 * n)
    sc = np.frombuffer(bts, "u1", n, 8 + 12 * n) * 0.02; tr = np.frombuffer(bts, "u1", n, 8 + 13 * n) * 0.02
    for nm, sel in [("MODIS", sat < 2), ("VIIRS", sat >= 2)]:
        sizes[nm].append(sc[sel] * tr[sel]); frp[nm].append(np.expm1(f[sel] / 4000.0)); night[nm][0] += int((fl[sel] & 1).sum()); night[nm][1] += int(sel.sum())
res["pixels"] = {nm: {"hotspots_sampled": night[nm][1], "median_pixel_km2": round(float(np.median(np.concatenate(sizes[nm]))), 2),
                      "smallest_pixel_km2": round(float(np.quantile(np.concatenate(sizes[nm]), .01)), 2),
                      "median_frp_mw": round(float(np.median(np.concatenate(frp[nm]))), 1),
                      "share_under_5mw": round(float((np.concatenate(frp[nm]) < 5).mean()), 3),
                      "night_share": round(night[nm][0] / max(1, night[nm][1]), 3)} for nm in sizes}
json.dump(res, open(OUT, "w"), indent=1, ensure_ascii=False)
print(json.dumps(res, indent=1, ensure_ascii=False))
