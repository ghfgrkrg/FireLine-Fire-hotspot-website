// SI/AI disclosure: written with Claude Code (Anthropic), an AI assistant, working with team Paween_and_Kpunn. See README.md.
// Data layer: loads the processed fire data and adds it up for a selected area.
// Formats are described in Fire_Hotspot_Data/DATA_FORMATS.md.

export const DATA = '/data';
export const HARM = 'v3';                 // harmonization folder inside app_data
const EPOCH = Date.UTC(2000, 0, 1);
export const VS_DAY = 4402;               // 2012-01-20, first VIIRS day
export const Y0 = 2000;
// Data facts the page needs to be honest about (from Fire_Hotspot_Data/DATA_FORMATS.md):
export const NRT_FROM = { y: 2026, m: 8 };     // from this month the VIIRS files are near-real-time, not NASA's final product
export const AQUA_FROM = { y: 2002, m: 7 };    // before this month only one MODIS satellite (Terra) was flying
export let INDEX = null, NMI = 0, DAY_MI = null, DAY_WK = null, LAST = null;
export const wkOf = (y, w) => (y - Y0) * 52 + w;      // week w = min(floor(day of year / 7), 51)

export const dayToDate = d => new Date(EPOCH + d * 864e5);
export const dateToDay = (y, m, d) => Math.round((Date.UTC(y, m - 1, d) - EPOCH) / 864e5);
export const miOf = (y, m) => (y - Y0) * 12 + (m - 1);

async function gz(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
}
const gzJson = async url => JSON.parse(new TextDecoder().decode(await gz(url)));
export const getJson = async url => { const r = await fetch(url); if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`); return r.json(); };

export async function init() {
  INDEX = await getJson(`${DATA}/index.json`);
  const last = dayToDate(INDEX.last_day);
  LAST = { day: INDEX.last_day, y: last.getUTCFullYear(), m: last.getUTCMonth() + 1, d: last.getUTCDate() };
  NMI = (LAST.y - Y0 + 1) * 12;
  DAY_MI = new Uint16Array(INDEX.last_day + 400);
  DAY_WK = new Uint16Array(DAY_MI.length);
  for (let d = 0; d < DAY_MI.length; d++) {
    const t = dayToDate(d), y = t.getUTCFullYear(); DAY_MI[d] = miOf(y, t.getUTCMonth() + 1);
    DAY_WK[d] = wkOf(y, Math.min(51, Math.floor((d - dateToDay(y, 1, 1)) / 7)));
  }
}

// ---------- geometry
function inRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function inPoly(x, y, poly) {
  if (!inRing(x, y, poly[0])) return false;
  for (let k = 1; k < poly.length; k++) if (inRing(x, y, poly[k])) return false;
  return true;
}
export function makeTester(sel) {
  const [w, s, e, n] = sel.bbox;
  if (!sel.geometry) return (x, y) => x >= w && x < e && y >= s && y < n;
  const polys = (sel.geometry.type === 'Polygon' ? [sel.geometry.coordinates] : sel.geometry.coordinates).map(p => {
    let a = 1e9, b = 1e9, c = -1e9, d = -1e9;
    for (const pt of p[0]) { if (pt[0] < a) a = pt[0]; if (pt[0] > c) c = pt[0]; if (pt[1] < b) b = pt[1]; if (pt[1] > d) d = pt[1]; }
    return { p, a, b, c, d };
  });
  return (x, y) => { for (const q of polys) if (x >= q.a && x <= q.c && y >= q.b && y <= q.d && inPoly(x, y, q.p)) return true; return false; };
}

// ---------- tiles (0.1 degree, daily)
const tileCache = new Map();
function loadTile(name) {
  if (!tileCache.has(name)) {
    tileCache.set(name, (async () => {
      const [a, b] = await Promise.all([gz(`${DATA}/tiles/${name}.bin.gz`), gz(`${DATA}/${HARM}/eq2/${name}.bin.gz`)]);
      const n = new DataView(a).getUint32(4, true);
      return { n, day: new Uint16Array(a, 8, n), cell: new Uint16Array(a, 8 + 2 * n, n), m: new Uint8Array(a, 8 + 8 * n, n),
               v: new Uint8Array(a, 8 + 9 * n, n), h: new Uint8Array(b, 8, n) };
    })());
    if (tileCache.size > 70) tileCache.delete(tileCache.keys().next().value);
  }
  return tileCache.get(name);
}
export function tilesFor(bbox) {
  const [w, s, e, n] = bbox, out = [];
  for (let la = Math.floor(s / 5) * 5; la < n; la += 5)
    for (let lo = Math.floor(w / 5) * 5; lo < e; lo += 5) { const k = `${la}_${lo}`; if (INDEX.tiles[k]) out.push(k); }
  return out;
}
const blank = () => ({ M: new Float64Array(NMI), V: new Float64Array(NMI), H: new Float64Array(NMI), R: new Float64Array(NMI),
                       MD: new Float64Array(NMI), VD: new Float64Array(NMI), Wk: new Float64Array((LAST.y - Y0 + 1) * 52) });

async function pool(items, limit, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => { while (i < items.length) await fn(items[i++]); }));
}

export async function aggregateTiles(sel, onProgress) {
  const names = tilesFor(sel.bbox), test = makeTester(sel), out = blank();
  out.daily = new Float32Array(INDEX.last_day + 1); out.cells = 0; out.km2 = 0; out.exact = true; out.grid = '0.1°, daily';
  let done = 0;
  await pool(names, 6, async name => {
    const [la, lo] = name.split('_').map(Number), mask = new Uint8Array(2500);
    let any = false;
    for (let r = 0; r < 50; r++) for (let c = 0; c < 50; c++) {
      const y = la + (r + .5) * .1;
      if (test(lo + (c + .5) * .1, y)) { mask[r * 50 + c] = 1; any = true; out.cells++; out.km2 += 123.6 * Math.cos(y * Math.PI / 180); }
    }
    if (any) {
      const t = await loadTile(name), { day, cell, m, v, h } = t, { M, V, H, R, MD, VD, daily, Wk } = out;
      for (let i = 0; i < t.n; i++) {
        const c = cell[i]; if (!mask[c]) continue;
        const d = day[i], mi = DAY_MI[d], hv = h[i] / 100;
        if (m[i]) { M[mi]++; MD[mi] += m[i]; }
        if (v[i]) { V[mi]++; VD[mi] += v[i]; H[mi] += hv; }
        const rec = d < VS_DAY ? (m[i] ? 1 : 0) : hv;
        R[mi] += rec; daily[d] += rec; Wk[DAY_WK[d]] += rec;
      }
    }
    onProgress && onProgress(++done, names.length);
  });
  return out;
}

// ---------- 1 degree weekly grids, for areas too large to read tile by tile
let worldGrids = null;
function loadWorldGrids(onProgress) {
  if (!worldGrids) worldGrids = (async () => {
    const years = []; for (let y = 2000; y <= LAST.y; y++) years.push(y);
    const out = {}; let done = 0;
    await pool(years, 6, async y => {
      const a = await gz(`${DATA}/${HARM}/world/${y}.bin.gz`), n = new DataView(a).getUint32(4, true);
      out[y] = { n, cell: new Uint16Array(a, 8, n), m: new Uint16Array(a, 8 + 2 * n, n), v: new Uint16Array(a, 8 + 4 * n, n),
                 e: new Uint16Array(a, 8 + 6 * n, n), wk: new Uint8Array(a, 8 + 8 * n, n) };
      onProgress && onProgress(++done, years.length);
    });
    return out;
  })();
  return worldGrids;
}
export async function aggregateCoarse(sel, onProgress) {
  const g = await loadWorldGrids(onProgress), test = makeTester(sel), out = blank();
  const mask = new Uint8Array(64800); out.cells = 0; out.km2 = 0;
  for (let r = 0; r < 180; r++) for (let c = 0; c < 360; c++)
    if (test(c - 180 + .5, r - 90 + .5)) { mask[r * 360 + c] = 1; out.cells += 100; out.km2 += 12360 * Math.cos((r - 89.5) * Math.PI / 180); }
  for (const y in g) {
    const t = g[y], wkMi = new Uint16Array(52), yr = +y;
    for (let w = 0; w < 52; w++) wkMi[w] = miOf(yr, new Date(Date.UTC(yr, 0, 1 + w * 7 + 3)).getUTCMonth() + 1);
    for (let i = 0; i < t.n; i++) {
      if (!mask[t.cell[i]]) continue;
      const mi = wkMi[t.wk[i]], m = t.m[i] / 10, v = t.v[i] / 10, e = t.e[i] / 10;
      out.M[mi] += m; out.V[mi] += v; out.H[mi] += e;
      const rec = (yr < 2012 || (yr === 2012 && t.wk[i] < 3)) ? m : e;
      out.R[mi] += rec; out.Wk[wkOf(yr, t.wk[i])] += rec;
    }
  }
  out.MD = out.VD = null; out.daily = null; out.exact = false; out.grid = '1°, weekly';
  return out;
}

// ---------- a whole country, from its precomputed exact series (harmonize/countries_series.py)
export async function aggregateCountry(iso) {
  const s = await gzJson(`${DATA}/${HARM}/countries/${iso}.json.gz`), out = blank(), f0 = s.first_day;
  out.daily = new Float32Array(INDEX.last_day + 1);
  for (let i = 0; i < s.daily.length; i++) { const d = f0 + i, v = s.daily[i]; out.daily[d] = v; out.R[DAY_MI[d]] += v; out.Wk[DAY_WK[d]] += v; }
  for (const k of ['M', 'V', 'H', 'MD', 'VD']) for (let i = 0; i < Math.min(NMI, s[k].length); i++) out[k][i] = s[k][i];
  out.exact = true; out.grid = '0.1°, daily'; out.cells = s.cells; out.km2 = s.km2;
  return out;
}

// ---------- whole world, from the daily series
let seriesP = null;
export async function aggregateWorld() {
  if (!seriesP) seriesP = gzJson(`${DATA}/${HARM}/series.json.gz`);
  const s = await seriesP, out = blank(), f0 = s.first_day;
  out.daily = new Float32Array(INDEX.last_day + 1);
  for (let i = 0; i < s.modis.length; i++) {
    const d = f0 + i, mi = DAY_MI[d];
    out.M[mi] += s.modis[i]; out.V[mi] += s.viirs[i]; out.H[mi] += s.eq2[i]; out.R[mi] += s.record2[i]; out.daily[d] = s.record2[i]; out.Wk[DAY_WK[d]] += s.record2[i];
  }
  out.MD = out.VD = null; out.exact = true; out.grid = '0.1°, daily'; out.cells = null; out.km2 = null;
  return out;
}

// ---------- world summary (yearly 1 degree totals) for the map layer
let summaryP = null;
export const worldSummary = () => summaryP || (summaryP = gzJson(`${DATA}/${HARM}/world_summary.json.gz`));

// ---------- 0.1-degree monthly world grids for the map (harmonize/grid01.py, format FGM1)
// Each record: one 0.1-degree square, one month, the consistent-record fire cell-days in it (exact, from the tiles).
const gridCache = new Map();
export function grid01(y) {
  y = +y;
  if (!gridCache.has(y)) {
    gridCache.set(y, (async () => {
      const a = await gz(`${DATA}/${HARM}/grid01/${y}.bin.gz`), n = new DataView(a).getUint32(4, true);
      return { n, cell: new Uint32Array(a, 8, n), val: new Uint16Array(a, 8 + 4 * n, n), mo: new Uint8Array(a, 8 + 6 * n, n) };
    })());
    if (gridCache.size > 4) { const k = gridCache.keys().next().value; if (k !== 2015) gridCache.delete(k); }
  }
  return gridCache.get(y);
}
// sum the months [m0, m1] (0-11) of one year: squares sorted by index, value in fire cell-days
export function gridSum(g, m0 = 0, m1 = 11) {
  const cell = new Uint32Array(g.n), val = new Float32Array(g.n); let k = -1, last = -1;
  for (let i = 0; i < g.n; i++) {
    const mo = g.mo[i]; if (mo < m0 || mo > m1) continue;
    const c = g.cell[i]; if (c !== last) { k++; cell[k] = c; last = c; }
    val[k] += g.val[i] / 100;
  }
  return { n: k + 1, cell: cell.subarray(0, k + 1), val: val.subarray(0, k + 1) };
}

// ---------- individual hotspots of a short period, for the map
const ptCache = new Map();
function loadPoints(name, y) {
  const k = `${name}/${y}`;
  if (!ptCache.has(k)) {
    ptCache.set(k, (async () => {
      const a = await gz(`${DATA}/points/${name}/${y}.bin.gz`), n = new DataView(a).getUint32(4, true);
      return { n, lat: new Uint16Array(a, 8, n), lon: new Uint16Array(a, 8 + 2 * n, n), day: new Uint16Array(a, 8 + 6 * n, n), sat: new Uint8Array(a, 8 + 10 * n, n) };
    })());
    if (ptCache.size > 60) ptCache.delete(ptCache.keys().next().value);
  }
  return ptCache.get(k);
}
export async function hotspotsFor(sel, day0, day1, cap = 300000) {
  const names = tilesFor(sel.bbox), test = makeTester(sel), y0 = dayToDate(day0).getUTCFullYear(), y1 = dayToDate(day1).getUTCFullYear();
  const lon = [], lat = [], sat = []; let modis = 0, viirs = 0;
  const jobs = []; for (const name of names) for (const y of (INDEX.points[name] || [])) if (y >= y0 - 1 && y <= y1 + 1) jobs.push([name, y]);
  await pool(jobs, 6, async ([name, y]) => {
    const t = await loadPoints(name, y), [la0, lo0] = name.split('_').map(Number);
    for (let i = 0; i < t.n; i++) {
      const d = t.day[i]; if (d < day0 || d > day1) continue;
      const la = la0 + t.lat[i] / 65535 * 5, lo = lo0 + t.lon[i] / 65535 * 5; if (!test(lo, la)) continue;
      if (t.sat[i] < 2) modis++; else viirs++;
      if (lon.length < cap) { lon.push(lo); lat.push(la); sat.push(t.sat[i]); }
    }
  });
  return { lon, lat, sat, modis, viirs, shown: lon.length };
}

// ---------- individual hotspots for the CSV download
const SAT = ['Terra', 'Aqua', 'Suomi NPP', 'NOAA-20'], CONF = ['low', 'nominal', 'high'];
export async function exportHotspots(sel, day0, day1, maxRows, onProgress) {
  const names = tilesFor(sel.bbox), test = makeTester(sel);
  const y0 = dayToDate(day0).getUTCFullYear(), y1 = dayToDate(day1).getUTCFullYear();
  const jobs = [];
  for (const name of names) for (const y of (INDEX.points[name] || [])) if (y >= y0 - 1 && y <= y1 + 1) jobs.push([name, y]);
  const chunks = ['latitude,longitude,acq_date,acq_time_utc,satellite,instrument,frp_mw,daynight,confidence,scan_km,track_km\n'];
  let rows = 0, done = 0, truncated = false;
  for (const [name, y] of jobs) {
    if (truncated) break;
    const a = await gz(`${DATA}/points/${name}/${y}.bin.gz`), n = new DataView(a).getUint32(4, true);
    const lat = new Uint16Array(a, 8, n), lon = new Uint16Array(a, 8 + 2 * n, n), frp = new Uint16Array(a, 8 + 4 * n, n),
          day = new Uint16Array(a, 8 + 6 * n, n), hm = new Uint16Array(a, 8 + 8 * n, n),
          sat = new Uint8Array(a, 8 + 10 * n, n), fl = new Uint8Array(a, 8 + 11 * n, n), sc = new Uint8Array(a, 8 + 12 * n, n), tr = new Uint8Array(a, 8 + 13 * n, n);
    const [la0, lo0] = name.split('_').map(Number), buf = [];
    for (let i = 0; i < n; i++) {
      const d = day[i]; if (d < day0 || d > day1) continue;
      const la = la0 + lat[i] / 65535 * 5, lo = lo0 + lon[i] / 65535 * 5;
      if (!test(lo, la)) continue;
      if (rows >= maxRows) { truncated = true; break; }
      const t = dayToDate(d), h = hm[i];
      buf.push(`${la.toFixed(5)},${lo.toFixed(5)},${t.toISOString().slice(0, 10)},${String(Math.floor(h / 100)).padStart(2, '0')}:${String(h % 100).padStart(2, '0')},` +
        `${SAT[sat[i]] || sat[i]},${sat[i] < 2 ? 'MODIS' : 'VIIRS'},${Math.expm1(frp[i] / 4000).toFixed(1)},${fl[i] & 1 ? 'N' : 'D'},${CONF[(fl[i] >> 1) & 3] || ''},${(sc[i] * .02).toFixed(2)},${(tr[i] * .02).toFixed(2)}`);
      rows++;
    }
    if (buf.length) chunks.push(buf.join('\n') + '\n');
    onProgress && onProgress(++done, jobs.length, rows);
  }
  return { blob: new Blob(chunks, { type: 'text/csv' }), rows, truncated };
}
