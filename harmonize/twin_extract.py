# SI/AI disclosure: written with Claude Code (Anthropic), an AI assistant, working with team Paween_and_Kpunn. See README.md.
"""Fire cell-days per sensor-year straight from the raw FIRMS yearly zips (for the identical-sensor ceiling test).

Usage: python twin_extract.py <Fire_Hotspot_Data dir> <out dir> <sensor> <year> [<sensor> <year> ...]
sensor: viirs-snpp | viirs-jpss1.  Same filters as the processed data: type 0, confidence nominal/high,
0.1-degree cells, local solar day.  Writes <out>/<sensor>_<year>.npy: sorted unique keys day*6480000 + row*3600 + col.
"""
import sys, zipfile
from concurrent.futures import ProcessPoolExecutor
import numpy as np, pandas as pd

ROOT, OUT = sys.argv[1], sys.argv[2]
EPOCH = pd.Timestamp("2000-01-01")


def one(job):
    sensor, year = job
    z = zipfile.ZipFile(f"{ROOT}/raw/firms_yearly_zips/{sensor}/{sensor}_{year}_all_countries.zip")
    parts = []
    for nm in z.namelist():
        if not nm.endswith(".csv"): continue
        df = pd.read_csv(z.open(nm), usecols=["latitude", "longitude", "acq_date", "acq_time", "confidence", "type"],
                         dtype={"confidence": str})
        df = df[(df.type == 0) & df.confidence.isin(["n", "h"])]
        if not len(df): continue
        dd = (pd.to_datetime(df.acq_date) - EPOCH).dt.days.values.astype(np.int64)
        t = df.acq_time.values.astype(np.int64)
        day = np.floor((dd * 1440 + (t // 100) * 60 + t % 100 + df.longitude.values * 4) / 1440).astype(np.int64)
        row = np.floor((df.latitude.values + 90) * 10).astype(np.int64); col = np.floor((df.longitude.values + 180) * 10).astype(np.int64)
        parts.append(np.unique(day * 6480000 + row * 3600 + np.clip(col, 0, 3599)))
    keys = np.unique(np.concatenate(parts))
    np.save(f"{OUT}/{sensor}_{year}.npy", keys)
    return f"{sensor} {year}: {len(keys)} cell-days"


if __name__ == "__main__":
    import os; os.makedirs(OUT, exist_ok=True)
    jobs = [(sys.argv[i], int(sys.argv[i + 1])) for i in range(3, len(sys.argv), 2)]
    with ProcessPoolExecutor(5) as ex:
        for r in ex.map(one, jobs): print(r, flush=True)
