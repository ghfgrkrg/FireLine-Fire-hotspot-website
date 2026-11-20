# SI/AI disclosure: written with Claude Code (Anthropic), an AI assistant, working with team Paween_and_Kpunn. See README.md.
"""Facts for the pitch: what a naive user would conclude from the raw record, against the harmonized one.

Usage: python pitch_facts.py <Fire_Hotspot_Data dir> <out.json>
"Naive" record = MODIS fire cell-days before 2012, raw VIIRS fire cell-days from 2012 (what you get by switching sensors).
Compares the 2013-2021 yearly average with the 2003-2011 yearly average, for the world and for a few boxes.
"""
import gzip, json, struct, sys
import numpy as np, pandas as pd

ROOT, OUT = sys.argv[1], sys.argv[2]
APP = f"{ROOT}/app_data"
days = pd.date_range("2000-01-01", periods=12000); YEAR = days.year.values
VS = (pd.Timestamp("2012-01-20") - pd.Timestamp("2000-01-01")).days


def summarise(name, y, m, v, h):
    """y: year per record; m, v: 0/1 fire flags; h: harmonized value."""
    df = pd.DataFrame({"y": y, "m": m, "v": v, "h": h}).groupby("y").sum()
    a = df.loc[2003:2011]; b = df.loc[2013:2021]
    naive = b.v.mean() / a.m.mean(); harm = b.h.mean() / a.m.mean(); modis = b.m.mean() / a.m.mean()
    peak_old = int(a.m.idxmax()); worst_naive = int(b.v.idxmax())
    return {"area": name, "modis_per_year_2003_2011": round(float(a.m.mean())), "raw_viirs_per_year_2013_2021": round(float(b.v.mean())),
            "harmonized_per_year_2013_2021": round(float(b.h.mean())), "modis_per_year_2013_2021": round(float(b.m.mean())),
            "naive_change_pct": round((naive - 1) * 100), "harmonized_change_pct": round((harm - 1) * 100), "modis_change_pct": round((modis - 1) * 100),
            "raw_over_modis_2013_2021": round(float(b.v.sum() / b.m.sum()), 2), "harmonized_over_modis_2013_2021": round(float(b.h.sum() / b.m.sum()), 2),
            "years_2013_2021_above_every_modis_year_naive": int((b.v > a.m.max()).sum()),
            "years_2013_2021_above_every_modis_year_harmonized": int((b.h > a.m.max()).sum()), "worst_modis_era_year": peak_old}


res = []
s = json.load(gzip.open(f"{APP}/v3/series.json.gz")); f0 = s["first_day"]; n = len(s["modis"])
res.append(summarise("World", YEAR[f0:f0 + n], np.array(s["modis"]), np.array(s["viirs"]), np.array(s["eq2"])))

BOXES = {"Northern Thailand": (97.3, 17.2, 101.5, 20.5), "Portugal (mainland)": (-9.6, 36.9, -6.1, 42.2), "California (box)": (-124.5, 32.5, -114.1, 42.0),
         "Rondonia, Brazil (box)": (-66.8, -13.7, -59.8, -7.9), "Zambia (box)": (22.0, -18.1, 33.7, -8.2)}
for name, (w, sth, e, nth) in BOXES.items():
    Y, M, V, H = [], [], [], []
    for la in range(int(np.floor(sth / 5) * 5), int(np.ceil(nth)), 5):
        for lo in range(int(np.floor(w / 5) * 5), int(np.ceil(e)), 5):
            try: b = gzip.open(f"{APP}/tiles/{la}_{lo}.bin.gz").read()
            except FileNotFoundError: continue
            k = struct.unpack("<I", b[4:8])[0]
            day = np.frombuffer(b, "<u2", k, 8); cell = np.frombuffer(b, "<u2", k, 8 + 2 * k)
            m = np.frombuffer(b, "u1", k, 8 + 8 * k) > 0; v = np.frombuffer(b, "u1", k, 8 + 9 * k) > 0
            h = np.frombuffer(gzip.open(f"{APP}/v3/eq2/{la}_{lo}.bin.gz").read(), "u1", k, 8) / 100
            lat = la + (cell // 50 + .5) * .1; lon = lo + (cell % 50 + .5) * .1
            ok = (lat >= sth) & (lat < nth) & (lon >= w) & (lon < e)
            Y.append(YEAR[day[ok]]); M.append(m[ok]); V.append(v[ok]); H.append(h[ok])
    res.append(summarise(name, np.concatenate(Y), np.concatenate(M).astype(float), np.concatenate(V).astype(float), np.concatenate(H)))
json.dump(res, open(OUT, "w"), indent=1)
print(pd.DataFrame(res).set_index("area").T.to_string())
