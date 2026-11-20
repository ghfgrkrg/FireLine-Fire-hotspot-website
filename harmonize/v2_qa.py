# SI/AI disclosure: written with Claude Code (Anthropic), an AI assistant, working with team Paween_and_Kpunn. See README.md.
"""Flag days when one sensor was (partly) down, from the worldwide daily MODIS / MODIS-equivalent ratio.

Usage: python v2_qa.py <Fire_Hotspot_Data dir> <cache dir>
A day is flagged when log(MODIS/eq) departs by more than 0.2 from its 91-day centred median; gaps of up to
2 days inside a run of flagged days are flagged too. Writes <cache>/good_day.npy (bool per day index from
2000-01-01) and app_data/calib/qa_days.json. Flagged days are left out of model fitting and scoring only;
the app still shows them.
"""
import gzip, json, sys
import numpy as np, pandas as pd

ROOT, C = sys.argv[1], sys.argv[2]
s = json.load(gzip.open(f"{ROOT}/app_data/calib/series_cal.json.gz"))
F0 = s["first_day"]; n = len(s["modis"])
idx = pd.date_range("2000-01-01", periods=F0 + n)[F0:]
d = pd.DataFrame({"m": s["modis"], "e": s["eq"]}, index=idx)["2012-01-20":]
r = np.log((d.m + 50) / (d.e + 50)); dev = r - r.rolling(91, center=True, min_periods=20).median()
low_m = dev < -0.2; low_v = dev > 0.2


def close(f):  # fill gaps of <= 2 days between flagged days
    a = f.values.copy()
    for g in (1, 2):
        for i in range(1, len(a) - g):
            if a[i - 1] and a[i + g] and not a[i:i + g].all(): a[i:i + g] = True
    return pd.Series(a, index=f.index)


low_m, low_v = close(low_m), close(low_v)
good = np.ones(F0 + n + 400, bool)
day_index = (d.index - pd.Timestamp("2000-01-01")).days.values
good[day_index[(low_m | low_v).values]] = False
np.save(f"{C}/good_day.npy", good)


def runs(f):
    f = f[f]; grp = (f.index.to_series().diff().dt.days != 1).cumsum()
    return [[str(g.index[0].date()), str(g.index[-1].date())] for _, g in f.groupby(grp)]


json.dump({"rule": "abs(log(MODIS/eq) - 91-day centred median) > 0.2, gaps <= 2 days filled",
           "modis_low": runs(low_m), "viirs_low": runs(low_v)}, open(f"{ROOT}/app_data/calib/qa_days.json", "w"), indent=0)
print(f"flagged {int((low_m | low_v).sum())} of {len(d)} days ({(low_m | low_v).mean():.1%}): MODIS low {int(low_m.sum())}, VIIRS low {int(low_v.sum())}")
print("MODIS-low runs of 3+ days:", [x for x in runs(low_m) if x[0] != x[1] and (pd.Timestamp(x[1]) - pd.Timestamp(x[0])).days >= 2])
print("VIIRS-low runs of 3+ days:", [x for x in runs(low_v) if (pd.Timestamp(x[1]) - pd.Timestamp(x[0])).days >= 2])
