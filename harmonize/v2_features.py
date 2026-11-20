# SI/AI disclosure: written with Claude Code (Anthropic), an AI assistant, working with team Paween_and_Kpunn. See README.md.
"""Stage-2 features and targets for every VIIRS cell-day (VIIRS era only).

Usage: python v2_features.py <cache dir from v2_load.py>
Features use VIIRS information only (and only the same day or earlier), so they exist after MODIS is gone.

Target y: MODIS cell-days attributed to this VIIRS cell-day =
    1 if MODIS fired in the same cell-day
  + a share of each nearby MODIS-only cell-day, allocated in this order of preference:
      A. VIIRS cell-days in the 3x3 neighbourhood, same day   (split equally)
      B. same cell, day-1 or day+1
      C. VIIRS cell-days in the 5x5 ring, same day
    MODIS-only cell-days with none of these are "orphans"; the local calibration factor absorbs them.
"""
import sys
import numpy as np

C = sys.argv[1]
VS = 4402  # 2012-01-20
L = lambda n: np.load(f"{C}/cd_{n}.npy", mmap_mode="r")
s = int(np.searchsorted(np.asarray(L("day")), VS))
day = np.asarray(L("day")[s:]).astype(np.int64); grow = np.asarray(L("grow")[s:]).astype(np.int64)
gcol = np.asarray(L("gcol")[s:]).astype(np.int64)
m = np.asarray(L("m")[s:]) > 0; vraw = np.asarray(L("v")[s:]); vm = vraw > 0
DAYK, ROWK = 6480000, 3600
key = day * DAYK + grow * ROWK + gcol
vi = np.nonzero(vm)[0]; KV = key[vi]; NV = len(KV)
Vv = vraw[vi].astype(np.float32); Veq = (np.asarray(L("eq")[s:])[vi] / 100).astype(np.float32)
Vlf = (np.asarray(L("vfrp")[s:])[vi] / 4000).astype(np.float32); Vf = np.expm1(Vlf)
print("VIIRS cell-days", NV, flush=True)


def look(q):
    i = np.searchsorted(KV, q); i[i == NV] = 0
    return KV[i] == q, i


n3 = np.zeros(NV, np.uint8); n5 = np.zeros(NV, np.uint8); v3 = np.zeros(NV, np.float32)
f3 = np.zeros(NV, np.float32); eq3 = np.zeros(NV, np.float32); p3 = np.zeros(NV, np.uint8); prev7 = np.zeros(NV, np.uint8)
CH = 4_000_000
for a in range(0, NV, CH):
    q = KV[a:a + CH]; sl = slice(a, a + CH)
    for dr in range(-2, 3):
        for dc in range(-2, 3):
            if dr == 0 and dc == 0: continue
            f, i = look(q + dr * ROWK + dc)
            if max(abs(dr), abs(dc)) == 1:
                n3[sl] += f; v3[sl] += np.where(f, Vv[i], 0); f3[sl] += np.where(f, Vf[i], 0); eq3[sl] += np.where(f, Veq[i], 0)
            else:
                n5[sl] += f
    for dr in (-1, 0, 1):
        for dc in (-1, 0, 1):
            f, _ = look(q - DAYK + dr * ROWK + dc); p3[sl] += f
    for d in range(1, 8):
        f, _ = look(q - d * DAYK); prev7[sl] += f
    print("features", a, flush=True)

# ---- targets
y = m[vi].astype(np.float32)
mo = np.nonzero(m & ~vm)[0]; qmo = key[mo]
left = np.ones(len(qmo), bool)
stats = {}
for name, offs in [("A_3x3", [dr * ROWK + dc for dr in (-1, 0, 1) for dc in (-1, 0, 1) if dr or dc]),
                   ("B_day+-1", [-DAYK, DAYK]),
                   ("C_5x5ring", [dr * ROWK + dc for dr in range(-2, 3) for dc in range(-2, 3) if max(abs(dr), abs(dc)) == 2])]:
    idxq = np.nonzero(left)[0]; q = qmo[idxq]
    F = np.zeros((len(q), len(offs)), bool); I = np.zeros((len(q), len(offs)), np.int64)
    for j, o in enumerate(offs):
        F[:, j], I[:, j] = look(q + o)
    cnt = F.sum(1); got = cnt > 0
    w = np.where(got, 1.0 / np.maximum(cnt, 1), 0).astype(np.float32)
    for j in range(len(offs)):
        sel = F[:, j]
        np.add.at(y, I[sel, j], w[sel])
    left[idxq[got]] = False; stats[name] = int(got.sum())
print("MODIS-only", len(qmo), "allocated", stats, "orphans", int(left.sum()), flush=True)
print("target sum", float(y.sum()), "MODIS cell-days in VIIRS era", int(m.sum()))

out = dict(day=day[vi].astype(np.uint16), grow=grow[vi].astype(np.uint16), gcol=gcol[vi].astype(np.uint16),
           eq=Veq, v=Vv.astype(np.uint8), lfrp=Vlf, n3=n3, n5=n5, v3=v3, lf3=np.log1p(f3), eq3=eq3, p3=p3, prev7=prev7, y=y)
for k, a in out.items(): np.save(f"{C}/f_{k}.npy", a)
print("saved", list(out))
