# SI/AI disclosure: written with Claude Code (Anthropic), an AI assistant, working with team Paween_and_Kpunn. See README.md.
"""Mark the days when NOAA-20 stands in for Suomi NPP (its orbit phase differs, so the cycle feature is switched off).

Usage: python v3_n20days.py <Fire_Hotspot_Data dir> <twin dir from twin_extract.py> <cache dir>
  2019-2025: days with under 5% of the median Suomi NPP cell-days in the yearly archives
  2026:      days whose Suomi NPP daily file holds only the header, and every day after the last Suomi NPP file
Writes <cache>/n20_day.npy (bool per day index from 2000-01-01).
"""
import glob, os, sys
import numpy as np, pandas as pd

ROOT, TWIN, C = sys.argv[1], sys.argv[2], sys.argv[3]
cal = pd.date_range("2000-01-01", periods=10300); n20 = np.zeros(len(cal), bool)
cnt = np.zeros(len(cal))
for y in range(2019, 2026):
    cnt += np.bincount(np.load(f"{TWIN}/viirs-snpp_{y}.npy") // 6480000, minlength=len(cal))
d0 = (pd.Timestamp("2019-01-01") - cal[0]).days; d1 = (pd.Timestamp("2026-01-01") - cal[0]).days
n20[np.nonzero(cnt[d0:d1] < 0.05 * np.median(cnt[d0:d1]))[0] + d0] = True
seen = {}
for src in ("VIIRS_SNPP_SP", "VIIRS_SNPP_NRT"):
    for f in glob.glob(f"{ROOT}/raw/firms_daily_api/{src}/*.csv"): seen[os.path.basename(f)[:10]] = os.path.getsize(f)
for d, size in seen.items():
    if size < 300: n20[(pd.Timestamp(d) - cal[0]).days] = True
n20[(pd.Timestamp(max(seen)) - cal[0]).days + 1:] = True
np.save(f"{C}/n20_day.npy", n20)
print("NOAA-20 days before 2026-11-13:", int(n20[:(pd.Timestamp("2026-11-13") - cal[0]).days].sum()), "| last Suomi NPP file:", max(seen))
