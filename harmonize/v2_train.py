# SI/AI disclosure: written with Claude Code (Anthropic), an AI assistant, working with team Paween_and_Kpunn. See README.md.
"""Stage-2 model: gradient-boosted trees predicting MODIS cell-days attributed to each VIIRS cell-day.

Usage: python v2_train.py <cache dir> <train_end_year> <tag> [geom] [max_train_rows]
Fits on 2012-02 .. train_end_year (sensor-outage days from v2_qa.py excluded), predicts every VIIRS cell-day and
saves <cache>/pred_<tag>.npy plus the booster. Score with v2_score.py.

With "geom" (or "geomfine", which adds a 2.5 x 0.5-degree refinement of the table): adds the 16-day orbit-cycle feature lg16. Terra, Aqua and Suomi NPP repeat their ground tracks every
16 days, so MODIS's yield relative to VIIRS at a place depends on (day mod 16): at the swath edge MODIS pixels are
up to 10x larger and small fires are missed. lg16 = log of the relative yield MODIS / sum(eq) per
(cycle day, 5-degree latitude band, 1-degree longitude) over the training years. On days when NOAA-20 stands in
for Suomi NPP (different orbit phase) lg16 is 0. Also saves pred_<tag>_neutral.npy, predicted with lg16 = 0.
"""
import sys, json
import numpy as np, pandas as pd, xgboost as xgb

C, TRAIN_END, TAG = sys.argv[1], int(sys.argv[2]), sys.argv[3]
GEOM = "geom" in sys.argv[4:] or "geomfine" in sys.argv[4:]; FINE = "geomfine" in sys.argv[4:]
MAXR = 600   # the validation loss is flat after ~500 rounds
_n = [x for x in sys.argv[4:] if x.isdigit()]
MAXROWS = int(_n[0]) if _n else 24_000_000
F = lambda n: np.load(f"{C}/f_{n}.npy")
day = F("day"); grow = F("grow"); gcol = F("gcol")
cal = pd.date_range("2000-01-01", periods=int(day.max()) + 1)
year = cal.year.values.astype(np.int16)[day]; month = cal.month.values.astype(np.int8)[day]
doy = cal.dayofyear.values.astype(np.int16)[day]
ym = year.astype(np.int32) * 100 + month
is_train = (ym >= 201202) & (year <= TRAIN_END) & np.load(f"{C}/good_day.npy")[day]

# ---- static, target-free climatology from the training period (VIIRS only)
cell1 = (grow // 10).astype(np.int32) * 360 + gcol // 10
c1 = np.bincount(cell1[is_train].astype(np.int64) * 12 + month[is_train] - 1, minlength=64800 * 12).reshape(64800, 12).astype(float)
r1, k1 = np.divmod(np.arange(64800), 360); t5 = (r1 // 5) * 72 + k1 // 5
c5 = np.zeros((36 * 72, 12)); np.add.at(c5, t5, c1)
share5 = c5 / np.maximum(c5.sum(1, keepdims=True), 1)
share1 = (c1 + 50 * share5[t5]) / (c1.sum(1, keepdims=True) + 50)
nyears = TRAIN_END - 2012 + 1
dens1 = np.log10(c1.sum(1) / nyears + 1).astype(np.float32)
peak1 = share1.argmax(1)

FEATS = ["eq", "v", "lfrp", "n3", "n5", "v3", "lf3", "eq3", "p3", "prev7", "lat", "lon", "month", "doy", "dens", "mshare", "phase"]
base = {k: F(k) for k in ["eq", "v", "lfrp", "n3", "n5", "v3", "lf3", "eq3", "p3", "prev7"]}
y = F("y")

lg16 = None
if GEOM:
    FEATS = FEATS + ["lg16"]
    NLAT = 36; gk = lambda d_, r_, c_: ((d_.astype(np.int64) % 16) * NLAT + r_ // 50) * 360 + c_ // 10
    E = np.bincount(gk(day[is_train], grow[is_train], gcol[is_train]), weights=base["eq"][is_train].astype(float), minlength=16 * NLAT * 360)
    L = lambda n: np.load(f"{C}/cd_{n}.npy", mmap_mode="r")
    s0 = int(np.searchsorted(np.asarray(L("day")), 4402))
    cday = np.asarray(L("day")[s0:]); cm = np.asarray(L("m")[s0:]) > 0
    cyear = cal.year.values[cday]; cmon = cal.month.values[cday]
    ok = cm & ((cyear.astype(np.int32) * 100 + cmon) >= 201202) & (cyear <= TRAIN_END) & np.load(f"{C}/good_day.npy")[cday]
    M = np.bincount(gk(cday[ok], np.asarray(L("grow")[s0:])[ok].astype(np.int64), np.asarray(L("gcol")[s0:])[ok].astype(np.int64)),
                    minlength=16 * NLAT * 360).astype(float)
    M = M.reshape(16, NLAT, 360); E = E.reshape(16, NLAT, 360)
    G = np.log((M + 50) / (E * M.sum(0, keepdims=True) / np.maximum(E.sum(0, keepdims=True), 1e-9) + 50)).clip(-3, 1.5).astype(np.float32)
    np.save(f"{C}/geom16_{TAG}.npy", G)
    lg16 = G[day.astype(np.int64) % 16, grow // 50, gcol // 10]
    if FINE:
        # refinement at 2.5-degree latitude x 0.5-degree longitude, shrunk toward the coarse table (tracks converge at high latitude)
        fk = lambda d_, r_, c_: ((d_.astype(np.int64) % 16) * 72 + r_ // 25) * 720 + c_ // 5
        Ef = np.bincount(fk(day[is_train], grow[is_train], gcol[is_train]),
                         weights=base["eq"][is_train].astype(float) * np.exp(lg16[is_train]), minlength=16 * 72 * 720).reshape(16, 72, 720)
        Mf = np.bincount(fk(cday[ok], np.asarray(L("grow")[s0:])[ok].astype(np.int64), np.asarray(L("gcol")[s0:])[ok].astype(np.int64)),
                         minlength=16 * 72 * 720).astype(float).reshape(16, 72, 720)
        Gf = np.log((Mf + 30) / (Ef * Mf.sum(0, keepdims=True) / np.maximum(Ef.sum(0, keepdims=True), 1e-9) + 30)).astype(np.float32)
        np.save(f"{C}/geom16f_{TAG}.npy", Gf)
        lg16 = (lg16 + Gf[day.astype(np.int64) % 16, grow // 25, gcol // 5]).clip(-3.5, 2)
    lg16[np.load(f"{C}/n20_day.npy")[day]] = 0
    del cday, cm, cyear, cmon, ok
    print("geometry table: sd of lg16 over training rows", round(float(lg16[is_train].std()), 3), flush=True)
NEUTRAL = False


def build(ix):
    X = np.empty((len(ix), len(FEATS)), np.float32)
    for j, k in enumerate(FEATS[:10]): X[:, j] = base[k][ix]
    c = cell1[ix]; mo = month[ix].astype(np.int64)
    X[:, 10] = grow[ix] / 10 - 90 + .05; X[:, 11] = gcol[ix] / 10 - 180 + .05
    X[:, 12] = mo; X[:, 13] = doy[ix]; X[:, 14] = dens1[c]; X[:, 15] = share1[c, mo - 1]
    X[:, 16] = (mo - 1 - peak1[c] + 6) % 12 - 6
    if GEOM: X[:, 17] = 0 if NEUTRAL else lg16[ix]
    return X


rng = np.random.default_rng(0)
tr_ix = np.nonzero(is_train & (year < TRAIN_END))[0]; va_ix = np.nonzero(is_train & (year == TRAIN_END))[0]
if len(tr_ix) > MAXROWS: tr_ix = np.sort(rng.choice(tr_ix, MAXROWS, replace=False))
if len(va_ix) > 4_000_000: va_ix = np.sort(rng.choice(va_ix, 4_000_000, replace=False))
P = dict(objective="count:poisson", tree_method="hist", max_depth=9, eta=0.3, min_child_weight=50, subsample=0.8,
         colsample_bytree=0.8, max_bin=256, nthread=16, eval_metric="poisson-nloglik")
dtr = xgb.QuantileDMatrix(build(tr_ix), y[tr_ix], feature_names=FEATS)
dva = xgb.QuantileDMatrix(build(va_ix), y[va_ix], ref=dtr, feature_names=FEATS)
bst = xgb.train(P, dtr, MAXR, [(dva, "valid")], early_stopping_rounds=40, verbose_eval=100)
best = min(bst.best_iteration + 1, int(MAXR / 1.1))
print("best rounds", best, flush=True)
del dtr, dva
# refit on the whole training period with the chosen number of rounds
al_ix = np.nonzero(is_train)[0]
if len(al_ix) > MAXROWS: al_ix = np.sort(rng.choice(al_ix, MAXROWS, replace=False))
dal = xgb.QuantileDMatrix(build(al_ix), y[al_ix], feature_names=FEATS)
bst = xgb.train(P, dal, int(best * 1.1)); del dal
bst.save_model(f"{C}/stage2_{TAG}.ubj")
imp = bst.get_score(importance_type="total_gain"); tot = sum(imp.values())
print("feature importance (gain share):", {k: round(v / tot, 3) for k, v in sorted(imp.items(), key=lambda kv: -kv[1])})

pred = np.empty(len(day), np.float32)
for a in range(0, len(day), 5_000_000):
    ix = np.arange(a, min(a + 5_000_000, len(day)))
    pred[ix] = bst.inplace_predict(build(ix))
np.save(f"{C}/pred_{TAG}.npy", pred)
if GEOM:
    NEUTRAL = True
    for a in range(0, len(day), 5_000_000):
        ix = np.arange(a, min(a + 5_000_000, len(day)))
        pred[ix] = bst.inplace_predict(build(ix))
    np.save(f"{C}/pred_{TAG}_neutral.npy", pred)
json.dump({"feats": FEATS, "train_end": TRAIN_END, "rounds": int(best * 1.1), "params": P}, open(f"{C}/stage2_{TAG}.json", "w"))

