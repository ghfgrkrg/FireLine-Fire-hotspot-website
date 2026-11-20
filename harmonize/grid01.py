# SI/AI disclosure: written with Claude Code (Anthropic), an AI assistant, working with team Paween_and_Kpunn. See README.md.
"""Build the 0.1-degree monthly world grids the map's heat layer reads.

Output: <app_data>/v3/grid01/<year>.bin.gz, one per year, format FGM1:
  4 bytes magic 'FGM1', uint32 n, then n x uint32 cell (row*3600 + col, row 0 at -90, col 0 at -180),
  n x uint16 value (consistent-record fire cell-days x 100), n x uint8 month (0-11).
Records are sorted by cell, then month. Values are exactly what the app adds up from the tiles:
MODIS cell-days before 2012-01-20 (VS_DAY 4402), harmonized VIIRS (v3 eq2) from then on.

Usage: python grid01.py [app_data folder]
"""
import gzip, os, sys, struct, json
from datetime import date, timedelta
import numpy as np
from concurrent.futures import ProcessPoolExecutor

DATA = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "..", "..", "Fire_Hotspot_Data", "app_data")
VS_DAY = 4402
EPOCH = date(2000, 1, 1)
NDAYS = 11000
DAY_Y = np.array([(EPOCH + timedelta(d)).year for d in range(NDAYS)], np.int16)
DAY_M = np.array([(EPOCH + timedelta(d)).month - 1 for d in range(NDAYS)], np.int8)


def read_tile(name):
    a = gzip.open(os.path.join(DATA, "tiles", name + ".bin.gz")).read()
    b = gzip.open(os.path.join(DATA, "v3", "eq2", name + ".bin.gz")).read()
    n = struct.unpack_from("<I", a, 4)[0]
    assert a[:4] == b"FCT2" and b[:4] == b"FEQ2" and struct.unpack_from("<I", b, 4)[0] == n, name
    day = np.frombuffer(a, np.uint16, n, 8)
    cell = np.frombuffer(a, np.uint16, n, 8 + 2 * n)
    m = np.frombuffer(a, np.uint8, n, 8 + 8 * n)
    h = np.frombuffer(b, np.uint8, n, 8)
    rec = np.where(day < VS_DAY, (m > 0).astype(np.float64), h / 100.0)
    la0, lo0 = map(int, name.split("_"))
    row = (la0 + 90) * 10 + cell // 50
    col = (lo0 + 180) * 10 + cell % 50
    g = row.astype(np.int64) * 3600 + col
    yr, mo = DAY_Y[day], DAY_M[day]
    keep = rec > 0
    g, yr, mo, rec = g[keep], yr[keep], mo[keep], rec[keep]
    out = {}
    for y in np.unique(yr):
        s = yr == y
        key = g[s] * 12 + mo[s]
        u, inv = np.unique(key, return_inverse=True)
        out[int(y)] = (u, np.bincount(inv, rec[s]))
    return out


def main():
    idx = json.load(open(os.path.join(DATA, "index.json")))
    names = sorted(idx["tiles"])
    per_year = {}
    with ProcessPoolExecutor(14) as ex:
        for i, res in enumerate(ex.map(read_tile, names, chunksize=8)):
            for y, (k, v) in res.items():
                per_year.setdefault(y, []).append((k, v))
            if i % 100 == 0:
                print(f"{i}/{len(names)} tiles", flush=True)
    od = os.path.join(DATA, "v3", "grid01")
    os.makedirs(od, exist_ok=True)
    for y, parts in sorted(per_year.items()):
        k = np.concatenate([p[0] for p in parts]); v = np.concatenate([p[1] for p in parts])
        o = np.argsort(k, kind="stable"); k, v = k[o], v[o]
        cell = (k // 12).astype(np.uint32); mo = (k % 12).astype(np.uint8)
        val = np.clip(np.round(v * 100), 1, 65535).astype(np.uint16)
        with gzip.open(os.path.join(od, f"{y}.bin.gz"), "wb", 6) as f:
            f.write(b"FGM1" + struct.pack("<I", len(cell)) + cell.tobytes() + val.tobytes() + mo.tobytes())
        print(y, len(cell), "records, total", round(float(v.sum())), flush=True)


if __name__ == "__main__":
    main()
