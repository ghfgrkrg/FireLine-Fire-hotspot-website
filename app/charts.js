// SI/AI disclosure: written with Claude Code (Anthropic), an AI assistant, working with team Paween_and_Kpunn. See README.md.
// Chart rendering (plain SVG strings). Colours: one-hue ramp for magnitude, blue/red around a neutral grey for anomaly.

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// Two palettes. On the dark one the fire ramp runs dark -> bright, so "no fire" still recedes into the background.
const LIGHT = {
  INK: '#0b0b0b', INK2: '#52514e', MUTED: '#898781', GRID: '#e1e0d9', AXIS: '#c3c2b7', SURFACE: '#fcfcfb',
  C_MODIS: '#2a78d6', C_VIIRS: '#eb6834', C_HARM: '#1baf7a',
  SEQ: ['#fdf0e1', '#fddcb9', '#fdbf86', '#fb9c52', '#f3792a', '#de5a12', '#b9420a', '#8f3206', '#6b2504'],
  NEG: ['#f0efec', '#b7d3f6', '#5598e7', '#1c5cab', '#0d366b'], POS: ['#f0efec', '#f6c1b6', '#ea7a66', '#cf3a36', '#8c1c1c'], ZERO: '#f3f2ee',
  BAR: '#de5a12', BAR_SOFT: '#fdbf86', BAR_HI: '#8f3206', BAR_ON: '#b9420a', BAND1: '#e9e7e0', BAND2: '#d3d1c7', HATCH: '#fddcb9' };
const DARK = {
  INK: '#f0efec', INK2: '#c3c2b7', MUTED: '#898781', GRID: '#2c2c2a', AXIS: '#44443f', SURFACE: '#1a1a19',
  C_MODIS: '#3987e5', C_VIIRS: '#d95926', C_HARM: '#199e70',
  SEQ: ['#2b1c12', '#45240f', '#63300d', '#873c0b', '#ad4c0e', '#d4621a', '#ee8236', '#f9a962', '#fdd3a0'],
  NEG: ['#383835', '#27456b', '#2c66ad', '#4f92e3', '#9ec5f4'], POS: ['#383835', '#6e2b27', '#a83e37', '#de5f5c', '#f6b0a6'], ZERO: '#242422',
  BAR: '#de6a1a', BAR_SOFT: '#6b300c', BAR_HI: '#fdd3a0', BAR_ON: '#f9a962', BAND1: '#2c2c2a', BAND2: '#44443f', HATCH: '#45240f' };
export let INK, INK2, MUTED, GRID, AXIS, SURFACE, C_MODIS, C_VIIRS, C_HARM, BAR, BAR_SOFT, BAR_HI, BAR_ON, BAND1, BAND2, HATCH;
let SEQ, NEG, POS, ZERO;
export function setTheme(dark) {
  ({ INK, INK2, MUTED, GRID, AXIS, SURFACE, C_MODIS, C_VIIRS, C_HARM, SEQ, NEG, POS, ZERO, BAR, BAR_SOFT, BAR_HI, BAR_ON, BAND1, BAND2, HATCH } = dark ? DARK : LIGHT);
}
setTheme(false);
const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
function ramp(stops, t) {
  t = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(t)), f = t - i, a = hex(stops[i]), b = hex(stops[i + 1]);
  return `rgb(${a.map((v, k) => Math.round(v + (b[k] - v) * f)).join(',')})`;
}
export const seqColor = t => ramp(SEQ, t);
export const divColor = t => t < 0 ? ramp(NEG, -t) : ramp(POS, t);     // t in [-1, 1]
export const anomT = ratio => Math.max(-1, Math.min(1, Math.log(ratio) / Math.log(3)));
const lum = c => { const m = c.match(/\d+/g).map(Number); return (0.299 * m[0] + 0.587 * m[1] + 0.114 * m[2]) / 255; };

export function fmt(n) {
  if (n == null || isNaN(n)) return '–';
  const a = Math.abs(n);
  return a >= 100 ? Math.round(n).toLocaleString('en-US') : a >= 10 ? n.toFixed(0) : a >= 1 ? n.toFixed(1) : a === 0 ? '0' : n.toFixed(2);
}
export function fmtC(n) {
  if (n == null || isNaN(n)) return '–';
  const a = Math.abs(n);
  return a >= 1e6 ? (n / 1e6).toFixed(a >= 1e7 ? 1 : 2) + 'M' : a >= 1e4 ? (n / 1e3).toFixed(0) + 'k' : a >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : fmt(n);
}
export const pct = r => (r >= 1 ? '+' : '−') + Math.abs((r - 1) * 100).toFixed(Math.abs(r - 1) < 0.095 ? 1 : 0) + '%';
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const T = (x, y, s, o = {}) => `<text x="${x}" y="${y}" font-family='${FONT}' font-size="${o.size || 11}" fill="${o.fill || INK2}" text-anchor="${o.anchor || 'start'}" font-weight="${o.weight || 400}"${o.extra || ''}>${esc(s)}</text>`;

function niceMax(v) { if (!(v > 0)) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))), f = v / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 4 ? 4 : f <= 6 ? 6 : f <= 8 ? 8 : 10) * p; }

// ---------- burning calendar: years x months, or years x weeks
// md: model from app.js. o: {res:'month'|'week', mode:'count'|'anom', numbers, width, hiYear, sel:{y,c}, title (export only)}
const MSTART = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
export function calendar(md, o) {
  const g = o.res === 'week' ? md.wk : md.mo, NC = g.nc, G = NC > 12 ? 1 : 2;
  const W = Math.max(520, o.width), LBL = 40, BARW = 108, cw = (W - LBL - BARW - 8) / NC, ch = 19, top = o.title ? 62 : 22;
  const years = md.years, n = years.length, H = top + n * (ch + 2) + 12 + ch + 8 + (o.title ? 46 : 0);
  let vmax = 0, tmax = 0;
  for (const y of years) { for (let c = 0; c < NC; c++) { const v = g.val[y][c]; if (v != null && g.inRange(y, c) && v > vmax) vmax = v; } if (md.total[y] > tmax) tmax = md.total[y]; }
  vmax = vmax || 1;
  const damp = Math.max(1, .05 * Math.max(...g.med));
  const color = (v, c) => {
    if (v == null) return null;
    // periods that normally have almost no fire are damped, so a handful of fires in the off-season does not shout
    if (o.mode === 'anom') return divColor(anomT((v + damp) / (g.med[c] + damp)));
    return v <= 0 ? ZERO : seqColor(Math.sqrt(v / vmax));
  };
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Burning calendar">`;
  if (o.title) s += `<rect width="${W}" height="${H}" fill="${SURFACE}"/>` + T(0, 20, o.title, { size: 15, weight: 600, fill: INK }) + T(0, 38, o.subtitle || '', { size: 11, fill: INK2 });
  for (let m = 0; m < 12; m++) s += NC === 12 ? T(LBL + m * cw + cw / 2, top - 7, MONTHS[m], { anchor: 'middle', fill: MUTED }) : T(LBL + MSTART[m] / 7 * cw, top - 7, MONTHS[m], { fill: MUTED });
  s += T(LBL + NC * cw + 12, top - 7, 'Year total', { fill: MUTED });
  let selBox = '';
  years.forEach((y, i) => {
    const yy = top + i * (ch + 2), hi = o.hiYear === y;
    s += `<g class="yr" data-y="${y}">` + T(LBL - 8, yy + ch - 5.5, y, { anchor: 'end', fill: hi ? INK : INK2, weight: hi ? 700 : 400, extra: ' class="ylab" style="cursor:pointer"' });
    for (let c = 0; c < NC; c++) {
      const v = g.val[y][c], x = LBL + c * cw, inR = g.inRange(y, c);
      if (v == null) { if (NC === 12) s += `<rect x="${x}" y="${yy}" width="${cw - G}" height="${ch}" rx="2" fill="none" stroke="${GRID}" stroke-dasharray="2 3"/>`; continue; }
      const col = color(v, c), part = g.partial && g.partial.y === y && g.partial.c === c;
      s += `<rect class="cell" data-y="${y}" data-c="${c}" x="${x}" y="${yy}" width="${cw - G}" height="${ch}" rx="${NC > 12 ? 1 : 2}" fill="${col}" opacity="${inR ? 1 : .22}"${part ? ` stroke="${INK2}" stroke-dasharray="3 2" stroke-width="1"` : ''} style="cursor:pointer"/>`;
      if (o.numbers && cw > 34 && inR) s += T(x + (cw - G) / 2, yy + ch - 5.5, fmtC(v), { anchor: 'middle', size: 10, fill: lum(col) < .55 ? '#fff' : '#0b0b0b', extra: ' pointer-events="none"' });
      if (o.sel && o.sel.y === y && o.sel.c === c) selBox = `<rect x="${x - 1.5}" y="${yy - 1.5}" width="${cw - G + 3}" height="${ch + 3}" rx="3" fill="none" stroke="${INK}" stroke-width="2" pointer-events="none"/>`;
    }
    const bx = LBL + NC * cw + 12, bw = Math.max(1, (BARW - 58) * md.total[y] / (tmax || 1));
    s += `<rect class="tot" data-y="${y}" x="${bx}" y="${yy + 4}" width="${bw}" height="${ch - 8}" rx="2" fill="${md.totalPartial[y] ? BAR_SOFT : BAR}" style="cursor:pointer"/>` +
         T(bx + bw + 5, yy + ch - 5.5, fmtC(md.total[y]) + (md.totalPartial[y] ? '*' : ''), { size: 10, fill: INK2 }) + '</g>';
  });
  s += selBox;
  const my = top + n * (ch + 2) + 10;
  s += T(LBL - 8, my + ch - 5.5, 'Typical', { anchor: 'end', fill: INK, weight: 600 });
  for (let c = 0; c < NC; c++) {
    const col = o.mode === 'anom' ? NEG[0] : (g.med[c] <= 0 ? ZERO : seqColor(Math.sqrt(g.med[c] / vmax)));
    s += `<rect class="cell" data-y="med" data-c="${c}" x="${LBL + c * cw}" y="${my}" width="${cw - G}" height="${ch}" rx="${NC > 12 ? 1 : 2}" fill="${col}"${NC === 12 ? ` stroke="${AXIS}"` : ''}/>`;
    if (o.numbers && cw > 34) s += T(LBL + c * cw + (cw - G) / 2, my + ch - 5.5, fmtC(g.med[c]), { anchor: 'middle', size: 10, fill: lum(col) < .55 ? '#fff' : '#0b0b0b', extra: ' pointer-events="none"' });
  }
  s += T(LBL + NC * cw + 12, my + ch - 5.5, `median ${md.base[0]}–${md.base[md.base.length - 1]}`, { size: 10, fill: MUTED });
  if (o.title) s += legendSvg(o.mode, vmax, LBL, my + ch + 16, Math.min(320, W - LBL - 20)) + T(W, H - 6, 'Data: NASA FIRMS (MODIS + VIIRS), harmonized to the MODIS scale', { anchor: 'end', size: 9, fill: MUTED });
  return { svg: s + '</svg>', vmax };
}

// ---------- day by day: one bar per day of the window, the chosen days darker
// o: {width, days:[{d, v, tick}], sel0, sel1, typical}
export function daily(o) {
  const W = Math.max(320, o.width), H = 190, n = o.days.length;
  const f = frame(W, H, Math.max(o.typical || 0, ...o.days.map(x => x.v || 0)), o.days.map(x => x.tick || ''));
  const bw = Math.max(2, Math.min(26, f.pw / n - 2));
  let s = f.s;
  o.days.forEach((x, i) => {
    const cx = f.X(i), on = x.d >= o.sel0 && x.d <= o.sel1;
    if (x.v != null) {
      const h = Math.max(0, f.Tp + f.ph - f.Y(x.v)), r = Math.min(3, bw / 2, h), x0 = cx - bw / 2, y0 = f.Y(x.v);
      s += `<path d="M${x0},${f.Tp + f.ph}V${y0 + r}Q${x0},${y0} ${x0 + r},${y0}H${x0 + bw - r}Q${x0 + bw},${y0} ${x0 + bw},${y0 + r}V${f.Tp + f.ph}Z" fill="${on ? BAR_ON : BAR_SOFT}"/>`;
    }
    s += `<rect class="dhit" data-d="${x.d}" data-i="${i}" x="${cx - f.pw / n / 2}" y="${f.Tp}" width="${f.pw / n}" height="${f.ph}" fill="transparent" style="cursor:pointer"/>`;
  });
  if (o.typical > 0) s += `<line x1="${f.L}" x2="${W - f.R}" y1="${f.Y(o.typical)}" y2="${f.Y(o.typical)}" stroke="${INK2}" stroke-width="1.5" stroke-dasharray="5 4"/>` +
    T(W - f.R, f.Y(o.typical) - 5, 'typical day', { anchor: 'end', size: 10, fill: INK2 });
  return { svg: s + '</svg>' };
}
function legendSvg(mode, vmax, x, y, w) {
  let s = '<defs><linearGradient id="lg">';
  for (let i = 0; i <= 20; i++) s += `<stop offset="${i * 5}%" stop-color="${mode === 'anom' ? divColor(i / 10 - 1) : seqColor(i / 20)}"/>`;
  s += `</linearGradient></defs><rect x="${x}" y="${y}" width="${w}" height="9" rx="2" fill="url(#lg)"/>`;
  const ticks = mode === 'anom' ? [[0, '⅓×'], [.185, '½×'], [.5, 'typical'], [.815, '2×'], [1, '3×']] : [0, .25, .5, .75, 1].map(t => [t, fmtC(vmax * t * t)]);
  for (const [t, l] of ticks) s += T(x + t * w, y + 21, l, { anchor: t === 0 ? 'start' : t === 1 ? 'end' : 'middle', size: 10, fill: MUTED });
  return s;
}
export function legendHtml(mode, vmax) {
  const stops = Array.from({ length: 21 }, (_, i) => mode === 'anom' ? divColor(i / 10 - 1) : seqColor(i / 20)).join(',');
  const ticks = mode === 'anom' ? ['⅓× typical', '½×', 'typical', '2×', '3× typical'] : [0, .25, .5, .75, 1].map(t => fmtC(vmax * t * t));
  return `<div class="lgbar" style="background:linear-gradient(90deg,${stops})"></div><div class="lgticks">${ticks.map(t => `<span>${t}</span>`).join('')}</div>`;
}

// ---------- "why VIIRS sees more": share of VIIRS fire that MODIS also saw, by fire power
export function whyBars(rows, width) {
  const W = Math.max(300, width), H = 210, L = 40, R = 8, Tp = 22, B = 30, pw = W - L - R, ph = H - Tp - B, n = rows.length, bw = Math.min(46, pw / n - 8);
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`;
  for (const t of [0, .25, .5, .75, 1]) { const y = Tp + ph - ph * t; s += `<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" stroke="${t ? GRID : AXIS}"/>` + T(L - 6, y + 3.5, Math.round(t * 100) + '%', { anchor: 'end', size: 10, fill: MUTED }); }
  rows.forEach((r, i) => {
    const cx = L + pw * (i + .5) / n, h = ph * r.modis_also_saw, x = cx - bw / 2, y = Tp + ph - h, q = Math.min(4, h);
    s += `<path d="M${x},${Tp + ph}V${y + q}Q${x},${y} ${x + q},${y}H${x + bw - q}Q${x + bw},${y} ${x + bw},${y + q}V${Tp + ph}Z" fill="${C_MODIS}"/>` +
      T(cx, y - 5, Math.round(r.modis_also_saw * 100) + '%', { anchor: 'middle', size: 11, fill: INK, weight: 600 }) + T(cx, H - 12, r.power_mw, { anchor: 'middle', size: 10, fill: INK2 });
  });
  return s + T(L, 11, 'MODIS also saw it', { size: 10, fill: MUTED }) + T(W - R, H - 1, 'fire power, MW', { anchor: 'end', size: 9, fill: MUTED }) + '</svg>';
}

// ---------- generic frame for line/bar charts
function frame(W, H, ymax, xLabels, o = {}) {
  const L = 46, R = o.right || 14, Tp = 12, B = 26, pw = W - L - R, ph = H - Tp - B, top = niceMax(ymax);
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`;
  for (let i = 0; i <= 4; i++) {
    const y = Tp + ph - ph * i / 4;
    s += `<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" stroke="${i ? GRID : AXIS}" stroke-width="1"/>` + T(L - 7, y + 3.5, fmtC(top * i / 4), { anchor: 'end', size: 10, fill: MUTED, extra: ' style="font-variant-numeric:tabular-nums"' });
  }
  const X = i => L + pw * (i + .5) / xLabels.length, Y = v => Tp + ph - ph * v / top;
  xLabels.forEach((l, i) => { if (l !== '') s += T(X(i), H - 8, l, { anchor: 'middle', size: 10, fill: MUTED }); });
  return { s, X, Y, L, R, Tp, ph, pw, top };
}
const path = (pts, X, Y) => { let d = '', pen = false; pts.forEach((v, i) => { if (v == null) { pen = false; return; } d += `${pen ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`; pen = true; }); return d; };

// ---------- seasonal profile: typical range, plus chosen years
export function seasonal(md, o) {
  const W = Math.max(320, o.width), H = 230, lines = [];
  if (o.hiYear && o.hiYear !== md.last.y) lines.push({ y: o.hiYear, c: C_VIIRS });
  lines.push({ y: md.last.y, c: C_MODIS });
  let ymax = Math.max(...md.p90);
  for (const l of lines) for (let m = 0; m < 12; m++) { const v = md.val[l.y][m]; if (v != null && !(md.partial && md.partial.y === l.y && md.partial.m === m)) ymax = Math.max(ymax, v); }
  const f = frame(W, H, ymax, MONTHS), band = (lo, hi) => 'M' + lo.map((v, i) => `${f.X(i).toFixed(1)},${f.Y(v).toFixed(1)}`).join('L') + 'L' + hi.map((v, i) => `${f.X(i).toFixed(1)},${f.Y(v).toFixed(1)}`).reverse().join('L') + 'Z';
  let s = f.s + `<path d="${band(md.p10, md.p90)}" fill="${BAND1}"/><path d="${band(md.p25, md.p75)}" fill="${BAND2}"/>` +
    `<path d="${path(md.med, f.X, f.Y)}" fill="none" stroke="${INK2}" stroke-width="2" stroke-linejoin="round"/>`;
  for (const l of lines) {
    const pts = md.val[l.y].map((v, m) => (md.partial && md.partial.y === l.y && md.partial.m === m) ? null : v);
    s += `<path d="${path(pts, f.X, f.Y)}" fill="none" stroke="${l.c}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    pts.forEach((v, i) => { if (v != null) s += `<circle cx="${f.X(i)}" cy="${f.Y(v)}" r="3" fill="${l.c}" stroke="${SURFACE}" stroke-width="1.5"/>`; });
  }
  for (let m = 0; m < 12; m++) s += `<rect class="hit" data-m="${m}" x="${f.X(m) - f.pw / 24}" y="${f.Tp}" width="${f.pw / 12}" height="${f.ph}" fill="transparent"/>`;
  return { svg: s + `<line class="xh" x1="0" x2="0" y1="${f.Tp}" y2="${f.Tp + f.ph}" stroke="${AXIS}" visibility="hidden"/></svg>`, lines, X: f.X };
}

// ---------- yearly totals with median and trend
export function annual(md, o) {
  const W = Math.max(320, o.width), H = 230, ys = md.years, f = frame(W, H, Math.max(...ys.map(y => md.total[y])), ys.map((y, i) => (y % 5 === 0 || ys.length < 12) ? y : ''));
  const bw = Math.max(3, Math.min(22, f.pw / ys.length - 2));
  let s = f.s + `<defs><pattern id="hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="5" fill="${HATCH}"/><line x1="0" y1="0" x2="0" y2="5" stroke="${BAR}" stroke-width="1.6"/></pattern></defs>`;
  ys.forEach((y, i) => {
    const v = md.total[y], h = Math.max(0, f.Tp + f.ph - f.Y(v)), x = f.X(i) - bw / 2, r = Math.min(4, bw / 2, h);
    const fill = md.totalPartial[y] ? 'url(#hatch)' : (o.hiYear === y ? BAR_HI : BAR);
    s += `<path class="bar" data-y="${y}" d="M${x},${f.Tp + f.ph}V${f.Y(v) + r}Q${x},${f.Y(v)} ${x + r},${f.Y(v)}H${x + bw - r}Q${x + bw},${f.Y(v)} ${x + bw},${f.Y(v) + r}V${f.Tp + f.ph}Z" fill="${fill}" style="cursor:pointer"/>`;
  });
  if (md.medTotal > 0) s += `<line x1="${f.L}" x2="${W - f.R}" y1="${f.Y(md.medTotal)}" y2="${f.Y(md.medTotal)}" stroke="${INK2}" stroke-width="1.5" stroke-dasharray="5 4"/>` +
    T(W - f.R, f.Y(md.medTotal) - 5, 'median', { anchor: 'end', size: 10, fill: INK2 });
  if (md.trend && o.showTrend) {
    const a = ys.indexOf(md.trend.y0), b = ys.indexOf(md.trend.y1);
    if (a >= 0 && b >= 0) s += `<line x1="${f.X(a)}" x2="${f.X(b)}" y1="${f.Y(Math.max(0, md.trend.v0))}" y2="${f.Y(Math.max(0, md.trend.v1))}" stroke="${INK}" stroke-width="2"/>`;
  }
  return { svg: s + '</svg>' };
}

// ---------- the harmonization, made visible: raw MODIS, raw VIIRS and harmonized VIIRS per year
export function harmon(md, o) {
  const W = Math.max(320, o.width), H = 250, ys = md.allYears.filter(y => y >= 2001);
  const ser = [{ k: 'V', n: 'VIIRS, raw', c: C_VIIRS, from: 2012 }, { k: 'M', n: 'MODIS', c: C_MODIS, from: 2001 }, { k: 'H', n: 'VIIRS, harmonized', c: C_HARM, from: 2012 }];
  let ymax = 0; for (const z of ser) for (const y of ys) if (y >= z.from) ymax = Math.max(ymax, md.yr[z.k][y]);
  const f = frame(W, H, ymax, ys.map(y => y % 5 === 0 ? y : ''), { right: 118 });
  let s = f.s, labels = [];
  for (const z of ser) {
    const pts = ys.map(y => (y >= z.from && !(y === md.last.y && md.totalPartial[y])) ? md.yr[z.k][y] : null);
    s += `<path d="${path(pts, f.X, f.Y)}" fill="none" stroke="${z.c}" stroke-width="${z.k === 'H' ? 2.5 : 2}" stroke-linejoin="round"/>`;
    let li = pts.length - 1; while (li >= 0 && pts[li] == null) li--;
    if (li >= 0) { s += `<circle cx="${f.X(li)}" cy="${f.Y(pts[li])}" r="4" fill="${z.c}" stroke="${SURFACE}" stroke-width="2"/>`; labels.push({ y: f.Y(pts[li]), x: f.X(li) + 9, n: z.n, c: z.c }); }
  }
  labels.sort((a, b) => a.y - b.y); for (let i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < 13) labels[i].y = labels[i - 1].y + 13;
  for (const l of labels) s += `<rect x="${l.x}" y="${l.y - 4}" width="8" height="8" rx="2" fill="${l.c}"/>` + T(l.x + 12, l.y + 3.5, l.n, { size: 11, fill: INK2 });
  const vx = f.X(ys.indexOf(2012)) - f.pw / ys.length / 2;
  s += `<line x1="${vx}" x2="${vx}" y1="${f.Tp}" y2="${f.Tp + f.ph}" stroke="${AXIS}" stroke-dasharray="3 3"/>` + T(vx + 5, f.Tp + 9, 'VIIRS starts', { size: 10, fill: MUTED });
  ys.forEach((y, i) => { s += `<rect class="hit" data-y="${y}" x="${f.X(i) - f.pw / ys.length / 2}" y="${f.Tp}" width="${f.pw / ys.length}" height="${f.ph}" fill="transparent"/>`; });
  return { svg: s + `<line class="xh" x1="0" x2="0" y1="${f.Tp}" y2="${f.Tp + f.ph}" stroke="${AXIS}" visibility="hidden"/></svg>`, ser, X: f.X, ys };
}
