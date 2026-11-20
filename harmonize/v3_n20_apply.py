# SI/AI disclosure: written with Claude Code (Anthropic), an AI assistant, working with team Paween_and_Kpunn. See README.md.
"""Re-predict the NOAA-20 days with the NOAA-20 orbit-cycle table (they were predicted with lg16 = 0).

Usage: python v3_n20_apply.py <cache dir> <stage-2 model .ubj> <tag = prod3>
Rebuilds the stage-2 inputs for the rows on NOAA-20 days exactly as v2_train.py does (same climatology, from the same
training rows), sets lg16 from <cache>/geom16_n20.npy, predicts, and patches <cache>/pred_<tag>.npy in place.
The untouched predictions are kept as pred_<tag>_n20zero.npy. Run v2_apply.py afterwards.
"""
import os, shutil, sys
import numpy as np, pandas as pd, xgboost as xgb

C, MODEL = sys.argv[1], sys.argv[2]; TAG = sys.argv[3] if len(sys.argv) > 3 else "prod3"
TRAIN_END = 2021
F = lambda n: np.load(f"{C}/f_{n}.npy")
day = F("day"); grow = F("grow"); gcol = F("gcol")
cal = pd.date_range("2000-01-01", periods=int(day.max()) + 1)
year = cal.year.values.astype(np.int16)[day]; month = cal.month.values.astype(np.int8)[day]; doy = cal.dayofyear.values.astype(np.int16)[day]
ym = year.astype(np.int32) * 100 + month
is_train = (ym >= 201202) & (year <= TRAIN_END) & np.load(f"{C}/good_day.npy")[day]

# climatology, identical to v2_train.py
cell1 = (grow // 10).astype(np.int32) * 360 + gcol // 10
c1 = np.bincount(cell1[is_train].astype(np.int64) * 12 + month[is_train] - 1, minlength=64800 * 12).reshape(64800, 12).astype(float)
r1, k1 = np.divmod(np.arange(64800), 360); t5 = (r1 // 5) * 72 + k1 // 5
c5 = np.zeros((36 * 72, 12)); np.add.at(c5, t5, c1)
share5 = c5 / np.maximum(c5.sum(1, keepdims=True), 1)
share1 = (c1 + 50 * share5[t5]) / (c1.sum(1, keepdims=True) + 50)
dens1 = np.log10(c1.sum(1) / (TRAIN_END - 2012 + 1) + 1).astype(np.float32); peak1 = share1.argmax(1)

ix = np.nonzero(np.load(f"{C}/n20_day.npy")[day])[0]
G = np.load(f"{C}/geom16_n20.npy")
FEATS = ["eq", "v", "lfrp", "n3", "n5", "v3", "lf3", "eq3", "p3", "prev7", "lat", "lon", "month", "doy", "dens", "mshare", "phase", "lg16"]
X = np.empty((len(ix), len(FEATS)), np.float32)
for j, k in enumerate(FEATS[:10]): X[:, j] = F(k)[ix]
c = cell1[ix]; mo = month[ix].astype(np.int64)
X[:, 10] = grow[ix] / 10 - 90 + .05; X[:, 11] = gcol[ix] / 10 - 180 + .05; X[:, 12] = mo; X[:, 13] = doy[ix]
X[:, 14] = dens1[c]; X[:, 15] = share1[c, mo - 1]; X[:, 16] = (mo - 1 - peak1[c] + 6) % 12 - 6
X[:, 17] = G[day[ix].astype(np.int64) % 16, grow[ix] // 50, gcol[ix] // 10]

bst = xgb.Booster(); bst.load_model(MODEL)
p = f"{C}/pred_{TAG}.npy"; keep = f"{C}/pred_{TAG}_n20zero.npy"
if not os.path.exists(keep): shutil.copy(p, keep)
pred = np.load(keep)
# check that this script reproduces the stored predictions when lg16 = 0, before changing anything
X0 = X.copy(); X0[:, 17] = 0
d0 = np.abs(bst.inplace_predict(X0) - pred[ix]).max()
new = bst.inplace_predict(X)
print(f"NOAA-20 rows: {len(ix)} on {len(np.unique(day[ix]))} days; reproduction error with lg16=0: {d0:.2e}")
print(f"sum of predictions on those rows: {pred[ix].sum():.0f} with lg16=0, {new.sum():.0f} with the NOAA-20 table ({new.sum() / pred[ix].sum() - 1:+.1%})")
pred[ix] = new; np.save(p, pred)
