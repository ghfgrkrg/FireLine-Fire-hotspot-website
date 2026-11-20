// SI/AI disclosure: written with Claude Code (Anthropic), an AI assistant, working with team Paween_and_Kpunn. See README.md.
import * as D from './data.js';
import * as C from './charts.js';

const $ = id => document.getElementById(id);
const MAX_TILES = 40;                      // larger areas use the 1-degree weekly grid
const S = { sel: null, agg: null, md: null, res: 'month', period: null, dots: null, dotTok: 0, mode: 'count', numbers: false, hiYear: null, token: 0, from: null, to: null, mapYear: null };
S.mapStyle = (() => { try { return localStorage.getItem('fl-mapstyle') === 'grid' ? 'grid' : 'heat'; } catch { return 'heat'; } })();
S.dark = (() => { try { return localStorage.getItem('bc-theme') !== 'light'; } catch { return true; } })();   // dark unless light was chosen
C.setTheme(S.dark); document.documentElement.dataset.theme = S.dark ? 'dark' : 'light';
const MAPC = () => S.dark ? { land: '#1f1f1d', sel: '#fdd3a0', prov: '#f9a962', dot: '#ff8a4c', base: 'World_Dark_Gray_Base' }
                          : { land: '#f4f3ee', sel: '#8f3206', prov: '#b9420a', dot: '#c2330c', base: 'World_Light_Gray_Base' };
const CHIPS = [
  { n: 'Portugal', country: 'PRT' }, { n: 'Northern Thailand', bbox: [97.3, 17.2, 101.5, 20.5] }, { n: 'California', admin: ['USA', 'US-CA'] },
  { n: 'Rondônia, Brazil', admin: ['BRA', 'BR-RO'] }, { n: 'Zambia', country: 'ZMB' }, { n: 'Victoria, Australia', admin: ['AUS', 'AU-VIC'] }];

// ---------- small helpers
const quant = (sorted, q) => { if (!sorted.length) return 0; const p = (sorted.length - 1) * q, i = Math.floor(p), f = p - i; return sorted[i] + (sorted[Math.min(i + 1, sorted.length - 1)] - sorted[i]) * f; };
const median = a => quant([...a].sort((x, y) => x - y), .5);
const ord = n => n + (['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : n % 10] || 'th');
const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
function status(msg, cls) { const el = $('status'); el.hidden = !msg; el.className = 'status' + (cls ? ' ' + cls : ''); el.innerHTML = msg || ''; }
function download(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); }
const slug = s => norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'area';

// ---------- the model: everything the charts need, from the monthly sums of one area
function buildModel(agg) {
  const L = D.LAST, dim = new Date(Date.UTC(L.y, L.m, 0)).getUTCDate();
  const partial = L.d < dim ? { y: L.y, m: L.m - 1, days: L.d, of: dim } : null;
  const lastFull = !partial ? { y: L.y, m: L.m - 1 } : (L.m === 1 ? { y: L.y - 1, m: 11 } : { y: L.y, m: L.m - 2 });
  const firstMi = D.miOf(2000, 11), lastMi = D.miOf(L.y, L.m);
  const allYears = []; for (let y = 2001; y <= L.y; y++) allYears.push(y);
  const val = {}, yr = { M: {}, V: {}, H: {} };
  for (const y of allYears) {
    val[y] = Array.from({ length: 12 }, (_, m) => { const mi = D.miOf(y, m + 1); return (mi < firstMi || mi > lastMi) ? null : agg.R[mi]; });
    for (const k of ['M', 'V', 'H']) { let s = 0; for (let m = 1; m <= 12; m++) s += agg[k][D.miOf(y, m)] || 0; yr[k][y] = s; }
  }
  const base = []; for (let y = 2003; y <= (lastFull.m === 11 ? lastFull.y : lastFull.y - 1); y++) base.push(y);
  const sorted = [], med = [], p10 = [], p25 = [], p75 = [], p90 = [];
  for (let m = 0; m < 12; m++) {
    const a = base.map(y => val[y][m]).sort((x, y) => x - y); sorted.push(a);
    med.push(quant(a, .5)); p10.push(quant(a, .1)); p25.push(quant(a, .25)); p75.push(quant(a, .75)); p90.push(quant(a, .9));
  }
  const fMi = D.miOf(S.from.y, S.from.m), tMi = D.miOf(S.to.y, S.to.m);
  const inRange = (y, m) => { const mi = D.miOf(y, m + 1); return mi >= fMi && mi <= tMi; };
  const years = allYears.filter(y => D.miOf(y, 12) >= fMi && D.miOf(y, 1) <= tMi);
  const total = {}, totalPartial = {}, full = {};
  for (const y of allYears) {
    let s = 0, n = 0, f = 0;
    for (let m = 0; m < 12; m++) { const v = val[y][m]; if (v == null) continue; f += v; if (inRange(y, m)) { s += v; if (!(partial && partial.y === y && partial.m === m)) n++; } }
    total[y] = s; totalPartial[y] = n < 12; full[y] = f;
  }
  const baseTotals = base.map(y => full[y]), medTotal = median(baseTotals);
  // Theil–Sen trend over the baseline years
  let trend = null;
  if (base.length >= 8 && medTotal > 0) {
    const sl = []; for (let i = 0; i < base.length; i++) for (let j = i + 1; j < base.length; j++) sl.push((baseTotals[j] - baseTotals[i]) / (base[j] - base[i]));
    const slope = median(sl), icpt = median(base.map((y, i) => baseTotals[i] - slope * y));
    trend = { slope, y0: base[0], y1: base[base.length - 1], v0: icpt + slope * base[0], v1: icpt + slope * base[base.length - 1], perDecade: slope * 10 / medTotal };
  }
  let rangeTotal = 0; for (const y of years) rangeTotal += total[y];
  const mo = { nc: 12, val, med, p10, p90, sorted, inRange, partial: partial && { y: partial.y, c: partial.m } };
  // weeks: week w covers days 7w..7w+6 of the year; the last one runs to 31 Dec
  const j0 = D.dateToDay(L.y, 1, 1), lw = Math.min(51, Math.floor((L.day - j0) / 7)), wEnd = lw === 51 ? D.dateToDay(L.y, 12, 31) : j0 + lw * 7 + 6;
  const wval = {}; for (const y of allYears) wval[y] = Array.from({ length: 52 }, (_, w) => (y === L.y && w > lw) ? null : agg.Wk[D.wkOf(y, w)]);
  const ws = [], wmed = [], w10 = [], w90 = [];
  for (let w = 0; w < 52; w++) { const a = base.map(y => wval[y][w]).sort((x, y) => x - y); ws.push(a); wmed.push(quant(a, .5)); w10.push(quant(a, .1)); w90.push(quant(a, .9)); }
  const wInRange = (y, w) => { const t = D.dayToDate(D.dateToDay(y, 1, 1) + w * 7 + 3); return inRange(t.getUTCFullYear(), t.getUTCMonth()); };
  const wk = { nc: 52, val: wval, med: wmed, p10: w10, p90: w90, sorted: ws, inRange: wInRange, partial: L.day < wEnd ? { y: L.y, c: lw } : null };
  return { mo, wk, val, med, p10, p25, p75, p90, sorted, base, years, allYears, total, totalPartial, full, medTotal, baseTotals, trend, yr, partial, lastFull, last: L, inRange, rangeTotal, agg };
}

function cellStats(md, g, y, c) {
  const v = g.val[y][c], a = g.sorted[c], med = g.med[c];
  return { v, med, ratio: med > 0 ? v / med : null, rank: 1 + a.filter(x => x > v).length, n: a.length + (md.base.includes(y) ? 0 : 1) };
}
const monthStats = (md, y, m) => cellStats(md, md.mo, y, m);

// ---------- a chosen month, week or day
const FULLM = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dstr = d => { const t = D.dayToDate(d); return `${t.getUTCDate()} ${C.MONTHS[t.getUTCMonth()]} ${t.getUTCFullYear()}`; };
const weekOf = d => { const t = D.dayToDate(d), y = t.getUTCFullYear(); return { y, c: Math.min(51, Math.floor((d - D.dateToDay(y, 1, 1)) / 7)) }; };
function periodOf(type, y, c) {
  if (type === 'month') { const d0 = D.dateToDay(y, c + 1, 1), end = D.dateToDay(y, c + 2, 0); return { type, y, c, d0, d1: Math.min(D.LAST.day, end), w0: d0, w1: end, label: `${FULLM[c]} ${y}` }; }
  const d0 = D.dateToDay(y, 1, 1) + c * 7, d1 = Math.min(D.LAST.day, c === 51 ? D.dateToDay(y, 12, 31) : d0 + 6);
  return { type: 'week', y, c, d0, d1, w0: d0 - 14, w1: d1 + 14, label: `${dstr(d0).replace(/ \d{4}$/, '')} – ${dstr(d1)}` };
}
function dayPeriod(d, w0, w1) { const t = D.dayToDate(d); return { type: 'day', d0: d, d1: d, w0, w1, label: `${DOW[t.getUTCDay()]} ${dstr(d)}` }; }
function setPeriod(p) { const was = S.period && S.period.type === 'month' ? S.period.label : null; S.period = p; renderCalendar(); renderDaily(); loadDots(); if (was || (p && p.type === 'month')) drawFire(); }
function shiftPeriod(dir) {
  const p = S.period; if (!p) return; let q;
  if (p.type === 'month') { const t = new Date(Date.UTC(p.y, p.c + dir, 1)); q = periodOf('month', t.getUTCFullYear(), t.getUTCMonth()); }
  else if (p.type === 'week') { const w = weekOf(p.d0 + dir * (p.c === 51 && dir > 0 ? 10 : 7)); q = periodOf('week', w.y, w.c); }
  else { const d = p.d0 + dir, sh = (d < p.w0 || d > p.w1) ? dir * (p.w1 - p.w0 + 1) : 0; q = dayPeriod(d, p.w0 + sh, p.w1 + sh); }
  if (q.d0 >= D.dateToDay(2001, 1, 1) && q.d0 <= D.LAST.day) setPeriod(q);
}
function renderDaily() {
  const card = $('dayCard'), p = S.period, md = S.md, a = S.agg;
  if (!p || !md) { card.hidden = true; return; }
  card.hidden = false; $('dayTitle').textContent = p.label;
  if (!a.daily) { $('daily').innerHTML = ''; $('daySum').textContent = 'Day-by-day values need a smaller area. Pick a province or draw a box.'; return; }
  const days = [];
  for (let d = p.w0; d <= p.w1; d++) {
    const t = D.dayToDate(d), dom = t.getUTCDate();
    days.push({ d, v: (d > D.LAST.day || d < 0) ? null : a.daily[d], tick: dom === 1 ? `1 ${C.MONTHS[t.getUTCMonth()]}` : (dom % 5 === 0 && dom < 30 ? dom : '') });
  }
  const t0 = D.dayToDate(p.d0), m = t0.getUTCMonth(), y = t0.getUTCFullYear(), typDay = md.med[m] / new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  $('daily').innerHTML = C.daily({ width: $('daily').clientWidth, days, sel0: p.d0, sel1: p.d1, typical: typDay }).svg;
  let total = 0; for (let d = p.d0; d <= p.d1; d++) total += a.daily[d] || 0;
  let cmp = '';
  if (p.type === 'day') { if (typDay > 0) cmp = `, ${C.pct(total / typDay)} against a typical ${FULLM[m]} day`; }
  else { const st = cellStats(md, p.type === 'month' ? md.mo : md.wk, p.y, p.c); if (st.ratio != null) cmp = `, ${C.pct(st.ratio)} against typical (${C.fmt(st.med)})`; }
  const dots = S.dots ? ` · ${(S.dots.modis + S.dots.viirs).toLocaleString('en-US')} hotspots on the map (MODIS ${S.dots.modis.toLocaleString('en-US')}, VIIRS ${S.dots.viirs.toLocaleString('en-US')})`
    : (S.sel.kind !== 'world' && D.tilesFor(S.sel.bbox).length > MAX_TILES ? ' · the map shows single hotspots only for smaller areas, such as a province' : '');
  $('daySum').innerHTML = `<b>${C.fmt(total)}</b> fire cell-days${cmp}${dots}. Click a bar to see one day.`;
  $('dayPrev').disabled = p.d0 <= D.dateToDay(2001, 1, 1); $('dayNext').disabled = p.d1 >= D.LAST.day;
}

// ---------- rendering
function render() {
  const md = S.md = buildModel(S.agg), sel = S.sel, agg = S.agg;
  $('areaName').textContent = sel.name; $('intro').hidden = sel.kind !== 'world';
  const bits = [];
  if (sel.kind !== 'world') { const [w, s, e, n] = sel.bbox; bits.push(`${Math.abs(s).toFixed(1)}°${s < 0 ? 'S' : 'N'}–${Math.abs(n).toFixed(1)}°${n < 0 ? 'S' : 'N'}, ${Math.abs(w).toFixed(1)}°${w < 0 ? 'W' : 'E'}–${Math.abs(e).toFixed(1)}°${e < 0 ? 'W' : 'E'}`); }
  if (agg.km2) bits.push(`about ${C.fmtC(agg.km2)} km²`);
  bits.push(agg.exact ? `grid ${agg.grid}` : `large drawn area: uses the coarser ${agg.grid} grid, so values are approximate`);
  $('areaMeta').textContent = bits.join(' · ');
  for (const el of document.querySelectorAll('.tone')) el.textContent = S.dark ? 'Brighter' : 'Darker';
  renderKpis(md); renderCalendar(); renderDaily(); renderSeasonal(); renderAnnual(); renderHarmon();
  $('dlSub').textContent = `${sel.name}, ${C.MONTHS[S.from.m - 1]} ${S.from.y} to ${C.MONTHS[S.to.m - 1]} ${S.to.y}`;
  $('dlHotspots').disabled = sel.kind === 'world';
  $('dlHotspots').title = sel.kind === 'world' ? 'Select an area first' : '';
}

function kpi(l, v, s) { return `<div class="kpi"><div class="l">${l}</div><div class="v">${v}</div><div class="s">${s}</div></div>`; }
const delta = r => r == null ? '–' : `<i class="${r >= 1 ? 'up' : 'down'}">${r >= 1 ? '▲' : '▼'}</i>${C.pct(r)}`;
function renderKpis(md) {
  const out = [], rangeLbl = `${C.MONTHS[S.from.m - 1]} ${S.from.y} – ${C.MONTHS[S.to.m - 1]} ${S.to.y}`;
  out.push(kpi(`Fire activity, ${rangeLbl}`, C.fmtC(md.rangeTotal), 'fire cell-days, MODIS scale'));
  // latest full month against its typical value
  const lf = md.lastFull, ms = monthStats(md, lf.y, lf.m);
  out.push(kpi(`${C.MONTHS[lf.m]} ${lf.y}, latest full month`, delta(ms.ratio), ms.ratio == null ? 'no fire is typical this month' : `${C.fmt(ms.v)} vs ${C.fmt(ms.med)} typical · ${ord(ms.rank)} highest of ${ms.n}${isProvisional(lf.y, lf.m) ? ' · provisional' : ''}`));
  // year to date
  let ytd = 0; for (let m = 0; m <= lf.m; m++) ytd += md.val[lf.y][m] || 0;
  const ytdBase = median(md.base.map(y => { let s = 0; for (let m = 0; m <= lf.m; m++) s += md.val[y][m]; return s; }));
  out.push(kpi(`${lf.y} so far, Jan–${C.MONTHS[lf.m]}`, delta(ytdBase > 0 ? ytd / ytdBase : null), `${C.fmtC(ytd)} vs ${C.fmtC(ytdBase)} typical`));
  // peak season
  const sum = md.med.reduce((a, b) => a + b, 0);
  if (sum > 0) {
    const pk = md.med.indexOf(Math.max(...md.med)); let a = pk, b = pk, share = md.med[pk];
    while (b - a < 10 && md.med[(a + 11) % 12] >= md.med[pk] / 2) { a--; share += md.med[(a + 120) % 12]; }
    while (b - a < 10 && md.med[(b + 1) % 12] >= md.med[pk] / 2) { b++; share += md.med[b % 12]; }
    const lbl = a === b ? C.MONTHS[pk] : `${C.MONTHS[(a + 120) % 12]}–${C.MONTHS[b % 12]}`;
    out.push(kpi('Peak season', lbl, `${Math.round(share / sum * 100)}% of a typical year's fire`));
  } else out.push(kpi('Peak season', '–', 'almost no fire recorded'));
  // most active full year
  const fy = md.allYears.filter(y => md.val[y].every(v => v != null) && !(md.partial && md.partial.y === y));
  const top = fy.reduce((a, y) => md.full[y] > md.full[a] ? y : a, fy[0]);
  out.push(kpi('Most active year', top, md.medTotal > 0 ? `${C.fmtC(md.full[top])}, ${(md.full[top] / md.medTotal).toFixed(1)}× a typical year` : C.fmtC(md.full[top])));
  out.push(kpi(`Trend, ${md.base[0]}–${md.base[md.base.length - 1]}`, md.trend ? `${md.trend.perDecade >= 0 ? '+' : '−'}${Math.abs(md.trend.perDecade * 100).toFixed(0)}%` : '–', md.trend ? 'per decade (median slope)' : 'not enough fire to tell'));
  $('kpis').innerHTML = out.join('');
}

function renderCalendar() {
  const md = S.md, el = $('calendar'), p = S.period, unit = S.res === 'week' ? 'week' : 'month';
  const selc = p && (S.res === 'week' ? weekOf(p.d0) : { y: D.dayToDate(p.d0).getUTCFullYear(), c: D.dayToDate(p.d0).getUTCMonth() });
  const r = C.calendar(md, { res: S.res, mode: S.mode, numbers: S.numbers && S.res === 'month', width: el.clientWidth, hiYear: S.hiYear, sel: selc });
  el.innerHTML = r.svg; S.calMax = r.vmax;
  $('calLegend').innerHTML = C.legendHtml(S.mode, r.vmax);
  $('nums').disabled = S.res === 'week';
  $('calSub').textContent = (S.mode === 'anom' ? `Each ${unit} against the typical value for that ${unit} (median of ${md.base[0]}–${md.base[md.base.length - 1]}).` : `Fire cell-days per ${unit}. ${S.dark ? 'Brighter' : 'Darker'} means more fire.`) + ` Click a ${unit} to see its days and hotspots.`;
}
function renderSeasonal() {
  const md = S.md, r = C.seasonal(md, { width: $('seasonal').clientWidth, hiYear: S.hiYear });
  $('seasonal').innerHTML = r.svg; S.sea = r;
  $('seaSub').textContent = `Each month against ${md.base[0]}–${md.base[md.base.length - 1]}. Click a year in the calendar to add it.`;
  $('seaLegend').innerHTML = r.lines.map(l => `<span><i style="background:${l.c}"></i>${l.y}${md.partial && l.y === md.partial.y ? ' (to ' + C.MONTHS[md.lastFull.m] + ')' : ''}</span>`).join('') +
    `<span><i style="background:${C.INK2}"></i>Typical (median)</span><span><i class="band" style="background:${C.BAND2}"></i>Middle half of years</span><span><i class="band" style="background:${C.BAND1}"></i>8 in 10 years</span>`;
}
function renderAnnual() {
  const md = S.md, r = C.annual(md, { width: $('annual').clientWidth, hiYear: S.hiYear, showTrend: true });
  $('annual').innerHTML = r.svg;
  $('annSub').textContent = 'Total fire activity per year in the chosen period';
  $('annLegend').innerHTML = `<span><i class="band" style="background:${C.BAR}"></i>Full year</span><span><i class="band" style="background:repeating-linear-gradient(45deg,${C.BAR} 0 2px,${C.HATCH} 2px 5px)"></i>Part of a year</span>` +
    (md.trend ? `<span><i style="background:${C.INK}"></i>Trend</span>` : '');
}
function renderHarmon() {
  const md = S.md, r = C.harmon(md, { width: $('harmon').clientWidth }); $('harmon').innerHTML = r.svg; S.har = r;
  const ys = md.allYears.filter(y => y >= 2013 && y <= 2021); let m = 0, v = 0, h = 0; for (const y of ys) { m += md.yr.M[y]; v += md.yr.V[y]; h += md.yr.H[y]; }
  $('harSub').textContent = m > 0 ? `In this area raw VIIRS counts ${(v / m).toFixed(1)}× what MODIS does. After harmonization it reads ${(h / m).toFixed(2)}× MODIS (2013–2021).`
    : 'Raw VIIRS reports more fire than MODIS for the same burning. Harmonization puts it on the MODIS scale.';
}

// ---------- tooltips
const tip = $('tip');
function showTip(html, ev) {
  tip.innerHTML = html; tip.hidden = false;
  const r = tip.getBoundingClientRect(); let x = ev.clientX + 14, y = ev.clientY + 14;
  if (x + r.width > innerWidth - 8) x = ev.clientX - r.width - 14; if (y + r.height > innerHeight - 8) y = ev.clientY - r.height - 14;
  tip.style.left = Math.max(4, x) + 'px'; tip.style.top = Math.max(4, y) + 'px';
}
const hideTip = () => { tip.hidden = true; };
const row = (a, b, k) => `<div class="row"><span>${k ? `<span class="k" style="background:${k}"></span>` : ''}${a}</span><span>${b}</span></div>`;
const sourceOf = (y, m) => { const mi = D.miOf(y, m + 1); return mi < D.miOf(D.AQUA_FROM.y, D.AQUA_FROM.m) ? 'MODIS, one satellite only' : mi < D.miOf(2012, 1) ? 'MODIS' : mi === D.miOf(2012, 1) ? 'MODIS, then VIIRS from 20 Jan' : 'VIIRS, harmonized'; };
const isProvisional = (y, m) => D.miOf(y, m + 1) >= D.miOf(D.NRT_FROM.y, D.NRT_FROM.m);
const noteOf = (y, m) => D.miOf(y, m + 1) < D.miOf(D.AQUA_FROM.y, D.AQUA_FROM.m) ? row('Note', 'reads low: one satellite') : isProvisional(y, m) ? row('Note', 'provisional, early data') : '';

$('calendar').addEventListener('mousemove', ev => {
  const t = ev.target, md = S.md; if (!md) return;
  if (t.classList.contains('cell')) {
    const c = +t.dataset.c, wkMode = S.res === 'week', g = wkMode ? md.wk : md.mo;
    const name = y => wkMode ? periodOf('week', y, c).label : `${C.MONTHS[c]} ${y}`;
    if (t.dataset.y === 'med') return showTip(`<b>Typical ${wkMode ? 'week of ' + name(2001).replace(/ 2001$/, '') : C.MONTHS[c]}</b><div class="big">${C.fmt(g.med[c])}</div>${row('8 in 10 years', `${C.fmt(g.p10[c])} – ${C.fmt(g.p90[c])}`)}${row('Highest', C.fmt(g.sorted[c][g.sorted[c].length - 1]))}`, ev);
    const y = +t.dataset.y, m = wkMode ? D.dayToDate(periodOf('week', y, c).d0).getUTCMonth() : c, st = cellStats(md, g, y, c), part = g.partial && g.partial.y === y && g.partial.c === c;
    showTip(`<b>${name(y)}</b><div class="big">${C.fmt(st.v)} <span style="font-size:12px;font-weight:400;color:${C.INK2}">fire cell-days</span></div>` +
      row('Typical', C.fmt(st.med)) + (st.ratio != null ? row('Against typical', C.pct(st.ratio)) : '') + (part ? '' : row('Rank', `${ord(st.rank)} highest of ${st.n}`)) +
      row('Sensor', sourceOf(y, m)) + noteOf(y, m) + (part ? row(wkMode ? 'Week' : 'Month', 'in progress') : ''), ev);
  } else if (t.classList.contains('tot')) {
    const y = +t.dataset.y;
    showTip(`<b>${y}</b><div class="big">${C.fmt(md.total[y])}</div>` + (md.totalPartial[y] ? row('Note', 'part of the year only') : (md.medTotal > 0 ? row('Against a typical year', C.pct(md.total[y] / md.medTotal)) : '')), ev);
  } else hideTip();
});
$('calendar').addEventListener('mouseleave', hideTip);
$('calendar').addEventListener('click', ev => {
  const t = ev.target, g = t.closest('.yr'); if (!g) return;
  if (t.classList.contains('ylab') || t.classList.contains('tot')) setHiYear(+g.dataset.y);
  else if (t.classList.contains('cell')) setPeriod(periodOf(S.res, +t.dataset.y, +t.dataset.c));
});
$('daily').addEventListener('mousemove', ev => {
  const t = ev.target; if (!t.classList.contains('dhit')) return hideTip();
  const d = +t.dataset.d, v = d <= D.LAST.day ? S.agg.daily[d] : null, dt = D.dayToDate(d);
  showTip(`<b>${DOW[dt.getUTCDay()]} ${dstr(d)}</b>` + (v == null ? row('No data yet', '') : `<div class="big">${C.fmt(v)} <span style="font-size:12px;font-weight:400;color:${C.INK2}">fire cell-days</span></div>`), ev);
});
$('daily').addEventListener('mouseleave', hideTip);
$('daily').addEventListener('click', ev => { const t = ev.target; if (t.classList.contains('dhit') && +t.dataset.d <= D.LAST.day) setPeriod(dayPeriod(+t.dataset.d, S.period.w0, S.period.w1)); });
$('dayPrev').onclick = () => shiftPeriod(-1); $('dayNext').onclick = () => shiftPeriod(1); $('dayClear').onclick = () => setPeriod(null);
function setHiYear(y) {
  S.hiYear = S.hiYear === y ? null : y; renderCalendar(); renderSeasonal(); renderAnnual();
  if (S.hiYear && $('mapYear').querySelector(`option[value="${S.hiYear}"]`)) { $('mapYear').value = S.hiYear; drawFire(S.hiYear); }
}
function hoverX(elId, key, fn) {
  const el = $(elId);
  el.addEventListener('mousemove', ev => {
    const t = ev.target, xh = el.querySelector('.xh');
    if (!t.classList.contains('hit')) { hideTip(); if (xh) xh.setAttribute('visibility', 'hidden'); return; }
    const i = +t.dataset[key], x = +t.getAttribute('x') + +t.getAttribute('width') / 2;
    if (xh) { xh.setAttribute('x1', x); xh.setAttribute('x2', x); xh.setAttribute('visibility', 'visible'); }
    showTip(fn(i), ev);
  });
  el.addEventListener('mouseleave', () => { hideTip(); const xh = el.querySelector('.xh'); if (xh) xh.setAttribute('visibility', 'hidden'); });
}
hoverX('seasonal', 'm', m => {
  const md = S.md; let h = `<b>${C.MONTHS[m]}</b>`;
  for (const l of S.sea.lines) { const v = md.val[l.y][m], part = md.partial && md.partial.y === l.y && md.partial.m === m; if (v != null) h += row(l.y + (part ? ' (in progress)' : ''), C.fmt(v), l.c); }
  return h + row('Typical', C.fmt(md.med[m]), C.INK2) + row('8 in 10 years', `${C.fmt(md.p10[m])} – ${C.fmt(md.p90[m])}`);
});
hoverX('harmon', 'y', y => {
  const md = S.md, M = md.yr.M[y], V = md.yr.V[y], H = md.yr.H[y];
  let h = `<b>${y}${y === md.last.y ? ' (to date)' : ''}</b>` + row('MODIS', C.fmt(M), C.C_MODIS);
  if (y >= 2012) h += row('VIIRS, raw', C.fmt(V), C.C_VIIRS) + row('VIIRS, harmonized', C.fmt(H), C.C_HARM) + (M > 0 ? row('Harmonized ÷ MODIS', (H / M).toFixed(2) + '×') + row('Raw ÷ MODIS', (V / M).toFixed(2) + '×') : '');
  return h;
});
$('annual').addEventListener('mousemove', ev => {
  const t = ev.target, md = S.md; if (!t.classList.contains('bar')) return hideTip();
  const y = +t.dataset.y;
  showTip(`<b>${y}</b><div class="big">${C.fmt(md.total[y])}</div>` + (md.totalPartial[y] ? row('Note', 'part of the year only') : (md.medTotal > 0 ? row('Against a typical year', C.pct(md.total[y] / md.medTotal)) : '')), ev);
});
$('annual').addEventListener('mouseleave', hideTip);
$('annual').addEventListener('click', ev => { if (ev.target.classList.contains('bar')) setHiYear(+ev.target.dataset.y); });

// ---------- map
const map = L.map('map', { worldCopyJump: true, minZoom: 1, zoomSnap: .25, zoomDelta: .5, wheelPxPerZoomLevel: 90 }).setView([12, 15], 2);
// Land is drawn from our own border file (works offline); the online basemap, when reachable, adds detail on top of it.
map.createPane('land').style.zIndex = 150; map.getPane('land').style.pointerEvents = 'none';
const BASEURL = () => `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/${MAPC().base}/MapServer/tile/{z}/{y}/{x}`;
const baseLayer = L.tileLayer(BASEURL(), { maxZoom: 12, attribution: 'Basemap: Esri, HERE, Garmin, © OpenStreetMap contributors · Fire data: NASA FIRMS' }).addTo(map);
map.createPane('fire').style.zIndex = 350; map.getPane('fire').style.pointerEvents = 'none';
map.createPane('pts').style.zIndex = 370; map.getPane('pts').style.pointerEvents = 'none';
map.createPane('prov').style.zIndex = 450; map.createPane('sel').style.zIndex = 460; map.getPane('sel').style.pointerEvents = 'none';
let landLayer = null, countriesLayer = null, provLayer = null, selLayer = null, countries = null, drawing = false, drawRect = null, drawStart = null, lastDraw = 0;
const provCache = {};

// Web Mercator helpers, in world units (0..1); multiply by 256 * 2^zoom for pixels
const mercY = lat => { const p = Math.max(-85.06, Math.min(85.06, lat)) * Math.PI / 180; return .5 - Math.log(Math.tan(Math.PI / 4 + p / 2)) / (2 * Math.PI); };
const ROWY = new Float64Array(1800), EDGEY = new Float64Array(1801);       // 0.1-degree rows (row 0 at -90): centre and southern edge
for (let r = 0; r < 1800; r++) ROWY[r] = mercY(-90 + (r + .5) / 10);
for (let r = 0; r <= 1800; r++) EDGEY[r] = mercY(-90 + r / 10);
const lowerBound = (a, n, x) => { let lo = 0, hi = n; while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] < x) lo = m + 1; else hi = m; } return lo; };

// A canvas that moves and scales with the map during pans, wheel zooms and fly-to animations, and is
// redrawn sharp only when the movement ends. This is what keeps the fire layers from jumping around.
const CanvasLayer = L.Layer.extend({
  options: { pane: 'fire', pad: .25 },
  onAdd(m) {
    this._cv = L.DomUtil.create('canvas', 'leaflet-zoom-animated', m.getPane(this.options.pane));
    m.on('moveend viewreset resize', this._redraw, this); m.on('zoom', this._onZoom, this);
    if (m.options.zoomAnimation) m.on('zoomanim', this._onAnim, this);
    this._redraw();
  },
  onRemove(m) { this._cv.remove(); m.off('moveend viewreset resize', this._redraw, this); m.off('zoom', this._onZoom, this); m.off('zoomanim', this._onAnim, this); },
  _xf(center, zoom) {
    if (!this._tl) return;
    const s = this._map.getZoomScale(zoom, this._z);
    L.DomUtil.setTransform(this._cv, this._tl.multiplyBy(s).subtract(this._map._getNewPixelOrigin(center, zoom)), s);
  },
  _onAnim(e) { this._xf(e.center, e.zoom); },
  _onZoom() { this._xf(this._map.getCenter(), this._map.getZoom()); },
  _frame() {           // size the canvas to the view plus a margin; returns the pixel frame to draw in
    const m = this._map, size = m.getSize(), p = size.multiplyBy(this.options.pad).round(), W = size.x + 2 * p.x, H = size.y + 2 * p.y;
    const lp = m.containerPointToLayerPoint([-p.x, -p.y]);
    this._tl = m.getPixelOrigin().add(lp); this._z = m.getZoom();
    L.DomUtil.setPosition(this._cv, lp);
    if (this._cv.width !== W || this._cv.height !== H) { this._cv.width = W; this._cv.height = H; }
    const ctx = this._cv.getContext('2d'); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.clearRect(0, 0, W, H);
    return { W, H, ox: this._tl.x, oy: this._tl.y, sc: 256 * Math.pow(2, this._z), ctx };
  },
  _redraw() { if (this._map) this.draw(this._frame()); }
});

// The selected area as a canvas path (for dimming what is outside it)
function selPath(f) {
  const sel = S.sel; if (!sel || sel.kind === 'world') return null;
  const path = new Path2D(), X = lon => (lon + 180) / 360 * f.sc - f.ox, Y = lat => mercY(lat) * f.sc - f.oy;
  const shifts = [-f.sc, 0, f.sc].filter(d => X(sel.bbox[2]) + d > -10 && X(sel.bbox[0]) + d < f.W + 10);
  const rings = sel.geometry ? (sel.geometry.type === 'Polygon' ? [sel.geometry.coordinates] : sel.geometry.coordinates).flat()
    : [[[sel.bbox[0], sel.bbox[1]], [sel.bbox[2], sel.bbox[1]], [sel.bbox[2], sel.bbox[3]], [sel.bbox[0], sel.bbox[3]]]];
  for (const d of shifts) for (const ring of rings) { ring.forEach((pt, i) => path[i ? 'lineTo' : 'moveTo'](X(pt[0]) + d, Y(pt[1]))); path.closePath(); }
  return path;
}

// separable box blur, three passes ~ a Gaussian of the given sigma (in pixels)
function blur(buf, tmp, W, H, sigma) {
  const n = 3, wIdeal = Math.sqrt(12 * sigma * sigma / n + 1); let wl = Math.floor(wIdeal); if (wl % 2 === 0) wl--;
  const m = Math.round((12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4));
  for (let k = 0; k < n; k++) { const r = ((k < m ? wl : wl + 2) - 1) / 2; if (r < 1) continue; boxH(buf, tmp, W, H, r); boxV(tmp, buf, W, H, r); }
}
function boxH(src, dst, W, H, r) {
  const iarr = 1 / (2 * r + 1);
  for (let y = 0; y < H; y++) {
    const o = y * W; let acc = 0;
    for (let x = -r; x <= r; x++) acc += x >= 0 && x < W ? src[o + x] : 0;
    for (let x = 0; x < W; x++) { dst[o + x] = acc * iarr; const a = x + r + 1, b = x - r; if (a < W) acc += src[o + a]; if (b >= 0) acc -= src[o + b]; }
  }
}
function boxV(src, dst, W, H, r) {
  const iarr = 1 / (2 * r + 1);
  for (let x = 0; x < W; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += y >= 0 && y < H ? src[y * W + x] : 0;
    for (let y = 0; y < H; y++) { dst[y * W + x] = acc * iarr; const a = y + r + 1, b = y - r; if (a < H) acc += src[a * W + x]; if (b >= 0) acc -= src[b * W + x]; }
  }
}

// Fire activity per 0.1-degree square (exact sums from the tiles), drawn as a heat map or as the squares themselves.
// Values are always fire cell-days per 0.1-degree square. Zoomed out, several squares share one screen pixel and the pixel
// shows their average; the heat map then spreads each square over a radius no smaller than the square itself.
const FireLayer = CanvasLayer.extend({
  setData(g, vmax) { this._g = g; this._vmax = vmax; this._redraw(); },
  draw(f) {
    const g = this._g; if (!g || !g.n) return;
    const { W, H, ox, oy, sc, ctx } = f, cellW = sc / 3600, vmax = this._vmax, heat = S.mapStyle === 'heat';
    const lut = this._lut || (this._lut = Array.from({ length: 256 }, (_, i) => C.seqColor(.12 + .88 * i / 255).match(/\d+/g).map(Number)));
    const off = this._offCv || (this._offCv = document.createElement('canvas')); off.width = W; off.height = H;
    const octx = off.getContext('2d');
    // rows in view (row-major order lets us skip straight to them)
    const latAt = y => (2 * Math.atan(Math.exp(Math.PI * (1 - 2 * y / sc))) - Math.PI / 2) * 180 / Math.PI;
    const sigma = heat ? Math.max(1.3, .55 * cellW) : 0, M = Math.ceil(3 * sigma) + 1;
    const rTop = Math.min(1799, Math.floor((latAt(oy - M) + 90) * 10)), rBot = Math.max(0, Math.floor((latAt(oy + H + M) + 90) * 10));
    const i0 = lowerBound(g.cell, g.n, rBot * 3600), i1 = lowerBound(g.cell, g.n, (rTop + 1) * 3600);
    if (!heat && cellW >= 2.5) {                              // squares, big enough to draw one by one
      for (let i = i0; i < i1; i++) {
        const c = g.cell[i], r = (c / 3600) | 0, col = c - r * 3600, v = g.val[i];
        const y0 = EDGEY[r + 1] * sc - oy, y1 = EDGEY[r] * sc - oy; if (y1 < 0 || y0 > H) continue;
        let x = col / 3600 * sc - ox; x -= Math.floor(x / sc) * sc;
        const t = Math.min(1, Math.sqrt(v / vmax)), k = lut[Math.round(t * 255)];
        octx.fillStyle = `rgba(${k[0]},${k[1]},${k[2]},${S.dark ? .35 + .65 * t : .9})`;
        for (; x < W; x += sc) if (x + cellW > 0) octx.fillRect(x, y0, cellW + .3, y1 - y0 + .3);
      }
    } else {                                                  // average per pixel, smoothed for the heat map
      const BW = W + 2 * M, BH = H + 2 * M, n = BW * BH;
      if (!this._buf || this._buf.length < n) { this._buf = new Float32Array(n); this._tmp = new Float32Array(n); }
      const buf = this._buf.subarray(0, n), tmp = this._tmp.subarray(0, n); buf.fill(0);
      for (let i = i0; i < i1; i++) {
        const c = g.cell[i], r = (c / 3600) | 0, col = c - r * 3600;
        const y = (ROWY[r] * sc - oy + M) | 0; if (y < 0 || y >= BH) continue;
        let x = (col + .5) / 3600 * sc - ox + M; x -= Math.floor(x / sc) * sc;
        for (; x < BW; x += sc) buf[y * BW + (x | 0)] += g.val[i];
      }
      if (sigma > 0) blur(buf, tmp, BW, BH, sigma);
      const img = octx.createImageData(W, H), d = img.data, aMax = S.dark ? 245 : 235, floor = vmax * .002;
      for (let y = 0; y < H; y++) {
        const lat = latAt(oy + y + .5), area = cellW * cellW / Math.cos(lat * Math.PI / 180), o = (y + M) * BW + M;   // pixels per 0.1-degree square here
        for (let x = 0; x < W; x++) {
          const v = buf[o + x] * area; if (v <= floor) continue;
          const t = Math.min(1, Math.sqrt(v / vmax)), k = lut[Math.round(t * 255)], p = (y * W + x) * 4;
          d[p] = k[0]; d[p + 1] = k[1]; d[p + 2] = k[2]; d[p + 3] = aMax * Math.min(1, (S.dark ? .25 : .35) + t * 1.4);
        }
      }
      octx.putImageData(img, 0, 0);
    }
    const path = selPath(f);
    if (!path) { ctx.drawImage(off, 0, 0); return; }
    ctx.globalAlpha = .3; ctx.drawImage(off, 0, 0);
    ctx.save(); ctx.clip(path, 'evenodd'); ctx.globalAlpha = 1; ctx.drawImage(off, 0, 0); ctx.restore();
  }
});
const fireLayer = new FireLayer({ pane: 'fire' }).addTo(map);

// What the map shows: a year, or the chosen month. Weeks and days have no grid of their own, so the map keeps the year
// and the single hotspots of that week or day go on top.
async function drawFire(year = S.mapYear) {
  S.mapYear = String(year);
  const p = S.period, month = p && p.type === 'month' ? p : null, y = month ? month.y : +S.mapYear, tok = S.fireTok = (S.fireTok || 0) + 1;
  try {
    const [g, ref] = await Promise.all([D.grid01(y), D.grid01(2015)]);
    if (tok !== S.fireTok) return;
    if (!S.scale) {       // one fixed colour scale per period length, from 2015: the 99.5th percentile of squares with fire
      const q = a => { const v = Array.from(a).sort((x, z) => x - z); return quant(v, .995) || 1; };
      S.scale = { year: q(D.gridSum(ref).val), month: q(Array.from(ref.val, v => v / 100)) };
    }
    const data = month ? D.gridSum(g, month.c, month.c) : D.gridSum(g), world = month ? S.scale.month : S.scale.year;
    const local = localVmax(data, world);
    S.fire = { data, label: month ? month.label : S.mapYear, vmax: local || world, fitted: !!local };
    fireLayer.setData(data, S.fire.vmax); mapLegend();
  } catch (e) { console.error(e); status(`Could not load the map grid: ${e.message}`, 'err'); }
}
// For a selected area, fit the colour scale to the squares inside its box (99th percentile, at least 1 fire cell-day),
// so a country with little fire is not drawn in near-black. The legend always shows the real numbers.
function localVmax(g, world) {
  const sel = S.sel; if (!sel || sel.kind === 'world') return null;
  // squares inside the area itself (main land mass box first, then the exact outline)
  const b = viewBounds(sel), w = Math.max(-180, b.getWest()), e = Math.min(180, b.getEast()), s = b.getSouth(), n = b.getNorth();
  const test = D.makeTester(sel), r0 = Math.max(0, Math.floor((s + 90) * 10)), r1 = Math.min(1799, Math.floor((n + 90) * 10));
  const c0 = Math.max(0, Math.floor((w + 180) * 10)), c1 = Math.min(3599, Math.floor((e + 180) * 10)), v = [];
  for (let r = r0; r <= r1; r++) {
    for (let i = lowerBound(g.cell, g.n, r * 3600 + c0), end = r * 3600 + c1; i < g.n && g.cell[i] <= end; i++) {
      const c = g.cell[i] - r * 3600; if (test(-180 + (c + .5) / 10, -90 + (r + .5) / 10)) v.push(g.val[i]);
    }
  }
  if (v.length < 20) return null;
  v.sort((a, b) => a - b);
  return Math.min(world, Math.max(1, quant(v, .99)));
}
function mapLegend() {
  if (!S.fire) return;
  const v = S.fire.vmax;
  $('mapRampLo').textContent = '0'; $('mapRampHi').textContent = C.fmt(v) + '+';
  const z = map.getZoom(), cellPx = 256 * Math.pow(2, z) / 3600, sigma = Math.max(1.3, .55 * cellPx);
  const km = sigma * 40075 * Math.cos(map.getCenter().lat * Math.PI / 180) / (256 * Math.pow(2, z));
  $('mapUnit').textContent = `fire cell-days per 0.1° square (about 11 km), ${S.fire.label}` + (S.fire.fitted ? ' · colours fitted to this area' : '') +
    (S.mapStyle === 'heat' ? ` · smoothed over about ${km < 10 ? km.toFixed(1) : Math.round(km)} km` : cellPx < 2.5 ? ' · zoomed out: each pixel shows the average of the squares in it' : '');
}
map.on('zoomend moveend', mapLegend);
// read the exact value of the 0.1-degree square under the pointer
map.on('mousemove', e => {
  const out = $('mapRead'); if (!S.fire || drawing) { out.textContent = ''; return; }
  const lat = e.latlng.lat, lon = ((e.latlng.lng + 180) % 360 + 360) % 360 - 180;
  const r = Math.floor((lat + 90) * 10), c = Math.floor((lon + 180) * 10), id = r * 3600 + c, g = S.fire.data, i = lowerBound(g.cell, g.n, id);
  const v = i < g.n && g.cell[i] === id ? g.val[i] : 0, sq = `${Math.abs(r / 10 - 90).toFixed(1)}°${r >= 900 ? 'N' : 'S'} ${Math.abs(c / 10 - 180).toFixed(1)}°${c >= 1800 ? 'E' : 'W'}`;
  out.innerHTML = `Square at ${sq}: <b>${v ? C.fmt(v) : 'no'}</b> fire cell-day${v === 1 ? '' : 's'} in ${S.fire.label}`;
});
map.on('mouseout', () => { $('mapRead').textContent = ''; });

// individual hotspots of the chosen month, week or day
const PointsLayer = CanvasLayer.extend({
  setData(p) { this._p = p; this._redraw(); },
  draw(f) {
    const p = this._p; if (!p || !p.shown) return;
    const { W, H, ox, oy, sc, ctx } = f, z = this._z;
    const many = p.shown > 8000, r = z < 5 ? .8 : z < 7 ? (many ? 1 : 1.5) : z < 9 ? (many ? 1.5 : 2.3) : 3;
    ctx.globalAlpha = many ? .6 : .85; ctx.fillStyle = MAPC().dot;
    for (let i = 0; i < p.shown; i++) {
      let x = (p.lon[i] + 180) / 360 * sc - ox; const y = mercY(p.lat[i]) * sc - oy; if (y < -4 || y > H + 4) continue;
      x -= Math.floor(x / sc) * sc;
      for (; x < W + 4; x += sc) ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
    }
  }
});
const ptsLayer = new PointsLayer({ pane: 'pts' }).addTo(map);
function showDots(r) {
  S.dots = r; const on = !!r;
  ptsLayer.setData(r);
  map.getPane('fire').style.opacity = on ? .45 : 1;
  $('mapDotGrp').hidden = !on;
  if (on) $('mapDotLbl').textContent = `Hotspots, ${S.period.label}` + (r.shown < r.modis + r.viirs ? ` (first ${r.shown.toLocaleString('en-US')} shown)` : '');
}
async function loadDots() {
  const p = S.period, sel = S.sel, tok = ++S.dotTok;
  if (!p || !sel || sel.kind === 'world' || D.tilesFor(sel.bbox).length > MAX_TILES) { showDots(null); if (p) renderDaily(); return; }
  try { const r = await D.hotspotsFor(sel, p.d0, p.d1); if (tok !== S.dotTok) return; showDots(r); renderDaily(); }
  catch (e) { console.error(e); showDots(null); }
}

// Where to point the map for an area: its main land mass, not overseas islands that would zoom the map out to the
// whole world (France and French Guiana, the USA and Guam), and with no jump across the 180° line (Russia, Fiji).
function viewBounds(sel) {
  if (!sel.geometry) { const [w, s, e, n] = sel.bbox; return L.latLngBounds([s, w], [n, e]); }
  const polys = (sel.geometry.type === 'Polygon' ? [sel.geometry.coordinates] : sel.geometry.coordinates).map(p => {
    let w = 1e9, s = 1e9, e = -1e9, n = -1e9, a = 0; const ring = p[0];
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [x, y] = ring[i]; if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y;
      a += (ring[j][0] - x) * (ring[j][1] + y) / 2;
    }
    return { w, s, e, n, a: Math.abs(a) * Math.cos((s + n) / 2 * Math.PI / 180) };
  }).sort((p, q) => q.a - p.a);
  const big = polys[0];
  const unwrap = p => { const d = (p.w + p.e) / 2 - (big.w + big.e) / 2; return d > 180 ? { ...p, w: p.w - 360, e: p.e - 360 } : d < -180 ? { ...p, w: p.w + 360, e: p.e + 360 } : p; };
  const grow = (B, p) => ({ w: Math.min(B.w, p.w), s: Math.min(B.s, p.s), e: Math.max(B.e, p.e), n: Math.max(B.n, p.n) });
  let b = polys.filter(p => p.a >= big.a * .3).map(unwrap).reduce(grow, { w: 1e9, s: 1e9, e: -1e9, n: -1e9 });
  // add nearby smaller parts (Kyushu next to Honshu, Sicily next to Italy)
  const gx = (b.e - b.w) * .25, gy = (b.n - b.s) * .25;
  for (const p0 of polys) {
    if (p0.a < big.a * .005) continue;
    const p = unwrap(p0), cx = (p.w + p.e) / 2, cy = (p.s + p.n) / 2;
    if (cx > b.w - gx && cx < b.e + gx && cy > b.s - gy && cy < b.n + gy) b = grow(b, p);
  }
  return L.latLngBounds([b.s, b.w], [b.n, b.e]);
}
function frameArea(sel) {
  if (sel.kind === 'world') { map.flyTo([12, 15], 2, { duration: .6 }); return; }
  const b = viewBounds(sel), z = map.getZoom(), fitZ = Math.min(9, map.getBoundsZoom(b, false, L.point(48, 48)));
  if (map.getBounds().contains(b) && z >= fitZ - 1) return;                          // already framed well: leave the map alone
  if (sel.kind !== 'bbox' && b.contains(map.getCenter()) && z > fitZ) return;         // zoomed in on part of this area: keep that view
  map.flyToBounds(b, { padding: [24, 24], maxZoom: 9, duration: .7 });
}

async function initMap() {
  countries = await D.getJson(`${D.DATA}/admin/countries.json`);
  landLayer = L.geoJSON(countries, { pane: 'land', interactive: false, style: { stroke: false, fillColor: MAPC().land, fillOpacity: 1 } }).addTo(map);
  countriesLayer = L.geoJSON(countries, {
    style: { color: '#898781', weight: .7, fillColor: '#000', fillOpacity: 0 },
    onEachFeature: (f, l) => {
      l.on('click', () => { if (!drawing && Date.now() - lastDraw > 400) selectCountry(f.properties.id); });
      l.on('mouseover', () => { if (!drawing) l.setStyle({ weight: 1.6, color: '#52514e' }); });
      l.on('mouseout', () => l.setStyle({ weight: .7, color: '#898781' }));
      l.bindTooltip(f.properties.name, { sticky: true, direction: 'top', opacity: .9 });
    }
  }).addTo(map);
}
const countryFeature = id => countries.features.find(f => f.properties.id === id);
async function provinces(iso) { if (!(iso in provCache)) { try { provCache[iso] = await D.getJson(`${D.DATA}/admin/${iso}.json`); } catch { provCache[iso] = null; } } return provCache[iso]; }
async function showProvinces(iso) {
  if (provLayer) { map.removeLayer(provLayer); provLayer = null; }
  const fc = iso && await provinces(iso); if (!fc || !fc.features.length) return;
  provLayer = L.geoJSON(fc, {
    pane: 'prov', style: { color: MAPC().prov, weight: .8, opacity: .55, fillColor: '#000', fillOpacity: 0 },
    onEachFeature: (f, l) => {
      l.on('click', ev => { L.DomEvent.stopPropagation(ev); if (!drawing && Date.now() - lastDraw > 400) selectAdmin(iso, f.properties.id); });
      l.on('mouseover', () => l.setStyle({ weight: 2, opacity: 1 })); l.on('mouseout', () => l.setStyle({ weight: .8, opacity: .55 }));
      l.bindTooltip(f.properties.name, { sticky: true, direction: 'top', opacity: .9 });
    }
  }).addTo(map);
}
function outline(sel) {
  if (selLayer) { map.removeLayer(selLayer); selLayer = null; }
  if (sel.kind === 'world') return;
  const st = { pane: 'sel', color: MAPC().sel, weight: 2.5, fill: false, interactive: false };
  const [w, s, e, n] = sel.bbox;
  selLayer = sel.geometry ? L.geoJSON({ type: 'Feature', geometry: sel.geometry }, { style: st, pane: 'sel', interactive: false }) : L.rectangle([[s, w], [n, e]], st);
  selLayer.addTo(map);
}

// ---------- selecting an area
async function select(sel, fit = true) {
  S.sel = sel; S.period = null; S.dotTok++; showDots(null); outline(sel); drawFire();
  if (fit) frameArea(sel);
  if (sel.kind !== 'admin') showProvinces(sel.kind === 'country' ? sel.iso : null);
  const token = ++S.token, prog = (a, b) => { if (token === S.token) status(`Reading fire data for ${sel.name} <progress value="${a}" max="${b}"></progress>`); };
  status(`Reading fire data for ${sel.name}…`);
  try {
    let agg;
    if (sel.kind === 'world') agg = await D.aggregateWorld();
    else if (D.tilesFor(sel.bbox).length <= MAX_TILES) agg = await D.aggregateTiles(sel, prog);
    else if (sel.kind === 'country') { try { agg = await D.aggregateCountry(sel.iso); } catch { agg = await D.aggregateCoarse(sel, prog); } }   // large countries: exact, precomputed
    else agg = await D.aggregateCoarse(sel, prog);
    if (token !== S.token) return;
    S.agg = agg; status(''); render();
  } catch (e) { if (token === S.token) status(`Could not load the data: ${e.message}`, 'err'); console.error(e); }
}
const WORLD = { kind: 'world', name: 'Whole world', bbox: [-180, -90, 180, 90] };
function selectCountry(iso) { const f = countryFeature(iso); if (f) select({ kind: 'country', iso, name: f.properties.name, bbox: f.properties.bbox, geometry: f.geometry }); }
async function selectAdmin(iso, id) {
  const fc = await provinces(iso), f = fc && fc.features.find(x => x.properties.id === id); if (!f) return;
  const cn = countryFeature(iso); await showProvinces(iso);
  select({ kind: 'admin', iso, name: `${f.properties.name}${cn ? ', ' + cn.properties.name : ''}`, bbox: f.properties.bbox, geometry: f.geometry });
}
const selectBox = (b, name = 'Custom area') => select({ kind: 'bbox', name, bbox: b.map(v => +(+v).toFixed(3)) });

// draw a rectangle
$('drawBtn').onclick = () => { drawing = !drawing; $('drawBtn').classList.toggle('on', drawing); $('map').classList.toggle('drawing', drawing); map.dragging[drawing ? 'disable' : 'enable'](); };
map.on('mousedown', e => { if (!drawing) return; drawStart = e.latlng; drawRect = L.rectangle([drawStart, drawStart], { color: MAPC().sel, weight: 2, fillOpacity: .08, interactive: false }).addTo(map); });
map.on('mousemove', e => { if (drawRect) drawRect.setBounds(L.latLngBounds(drawStart, e.latlng)); });
map.on('mouseup', () => {
  if (!drawRect) return;
  const b = drawRect.getBounds(); map.removeLayer(drawRect); drawRect = null; lastDraw = Date.now(); $('drawBtn').onclick();
  if (b.getEast() - b.getWest() < .05 || b.getNorth() - b.getSouth() < .05) return;
  selectBox([Math.max(-180, b.getWest()), Math.max(-90, b.getSouth()), Math.min(180, b.getEast()), Math.min(90, b.getNorth())]);
});
$('coordBtn').onclick = () => { const f = $('coordForm'); f.hidden = !f.hidden; if (!f.hidden && S.sel && S.sel.kind !== 'world') { const [w, s, e, n] = S.sel.bbox; f.s.value = s; f.w.value = w; f.n.value = n; f.e.value = e; } map.invalidateSize(); };
$('coordForm').onsubmit = ev => { ev.preventDefault(); const f = ev.target, s = +f.s.value, w = +f.w.value, n = +f.n.value, e = +f.e.value; if (n > s && e > w) selectBox([w, s, e, n]); else status('North must be greater than south, and east greater than west.', 'err'); };
$('worldBtn').onclick = () => select(WORLD);
for (const c of CHIPS) {
  const b = document.createElement('button'); b.textContent = c.n;
  b.onclick = () => c.country ? selectCountry(c.country) : c.admin ? selectAdmin(...c.admin) : selectBox(c.bbox, c.n);
  $('chips').appendChild(b);
}

// search
let searchIdx = null, suggItems = [], suggOn = -1;
async function loadSearch() { if (!searchIdx) { const raw = await D.getJson(`${D.DATA}/admin/search.json`); searchIdx = raw.map(x => ({ x, k: norm(x.n) })); } }
function suggest() {
  const q = norm($('q').value.trim()), ul = $('sugg'); if (q.length < 2 || !searchIdx) { ul.hidden = true; return; }
  const sc = r => (r.k === q ? 0 : r.k.startsWith(q) ? 1 : 2) * 10 + (r.x.t === 'country' ? 0 : r.x.t === 'place' ? 2 : 1);
  suggItems = searchIdx.filter(r => r.k.includes(q)).sort((a, b) => sc(a) - sc(b) || (b.x.pop || 0) - (a.x.pop || 0) || a.k.length - b.k.length).slice(0, 9).map(r => r.x);
  suggOn = -1;
  ul.innerHTML = suggItems.map((x, i) => `<li data-i="${i}"><span>${x.n}</span><small>${x.t === 'country' ? 'country' : x.t === 'place' ? `town, ${x.cn}` : `${x.t.split('|')[0]}, ${x.cn}`}</small></li>`).join('') || '<li><span>No match</span></li>';
  ul.hidden = false;
}
function pick(x) {
  if (!x) return; $('sugg').hidden = true; $('q').value = x.n;
  if (x.t === 'country') selectCountry(x.id);
  else if (x.t === 'place') selectBox([x.ll[0] - .5, x.ll[1] - .5, x.ll[0] + .5, x.ll[1] + .5], `Around ${x.n}, ${x.cn}`);
  else selectAdmin(x.c, x.id).then(() => { if (!S.sel || !S.sel.name.startsWith(x.n)) selectBox(x.b, `${x.n}, ${x.cn}`); });
}
$('q').addEventListener('focus', () => loadSearch().then(suggest));
$('q').addEventListener('input', () => loadSearch().then(suggest));
$('q').addEventListener('keydown', ev => {
  const li = $('sugg').querySelectorAll('li[data-i]');
  if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { ev.preventDefault(); suggOn = (suggOn + (ev.key === 'ArrowDown' ? 1 : -1) + li.length) % li.length; li.forEach((l, i) => l.classList.toggle('on', i === suggOn)); }
  else if (ev.key === 'Enter') { ev.preventDefault(); pick(suggItems[Math.max(0, suggOn)]); }
  else if (ev.key === 'Escape') $('sugg').hidden = true;
});
$('sugg').addEventListener('mousedown', ev => { const li = ev.target.closest('li[data-i]'); if (li) pick(suggItems[+li.dataset.i]); });
document.addEventListener('click', ev => { if (!ev.target.closest('.search')) $('sugg').hidden = true; });

// ---------- controls
$('modeCount').onclick = () => { S.mode = 'count'; $('modeCount').classList.add('on'); $('modeAnom').classList.remove('on'); renderCalendar(); };
$('modeAnom').onclick = () => { S.mode = 'anom'; $('modeAnom').classList.add('on'); $('modeCount').classList.remove('on'); renderCalendar(); };
$('resMonth').onclick = () => { S.res = 'month'; $('resMonth').classList.add('on'); $('resWeek').classList.remove('on'); renderCalendar(); };
$('resWeek').onclick = () => { S.res = 'week'; $('resWeek').classList.add('on'); $('resMonth').classList.remove('on'); renderCalendar(); };
$('nums').onchange = ev => { S.numbers = ev.target.checked; renderCalendar(); };
function paintRamp() { $('mapRamp').style.background = `linear-gradient(90deg,${Array.from({ length: 9 }, (_, i) => C.seqColor(.12 + .88 * i / 8)).join(',')})`; }
$('themeBtn').onclick = () => {
  S.dark = !S.dark; try { localStorage.setItem('bc-theme', S.dark ? 'dark' : 'light'); } catch { }
  C.setTheme(S.dark); document.documentElement.dataset.theme = S.dark ? 'dark' : 'light'; $('themeBtn').textContent = S.dark ? 'Light mode' : 'Dark mode';
  baseLayer.setUrl(BASEURL()); if (landLayer) landLayer.setStyle({ fillColor: MAPC().land });
  if (provLayer) provLayer.setStyle({ color: MAPC().prov }); if (S.sel) outline(S.sel);
  paintRamp(); fireLayer._lut = null; fireLayer._redraw(); ptsLayer._redraw();
  if (S.agg) render(); if ($('about').open) $('aboutBtn').onclick();
};
$('themeBtn').textContent = S.dark ? 'Light mode' : 'Dark mode';
$('aboutBtn').onclick = async () => {
  $('about').showModal();
  try {
    const w = S.why || (S.why = await D.getJson('why.json')), set = (id, v) => { $(id).textContent = v; };
    set('wRatio', w.ratio.toFixed(1)); set('wPm', w.pixels.MODIS.median_pixel_km2.toFixed(1)); set('wPv', w.pixels.VIIRS.median_pixel_km2.toFixed(1));
    set('wPx', Math.round(w.pixels.MODIS.median_pixel_km2 / w.pixels.VIIRS.median_pixel_km2));
    set('wSv', Math.round(w.pixels.VIIRS.share_under_5mw * 100)); set('wSm', Math.round(w.pixels.MODIS.share_under_5mw * 100));
    set('wOnly', Math.round(w.viirs_only / w.viirs_cell_days * 100));
    $('whyChart').innerHTML = C.whyBars(w.by_power, $('whyChart').clientWidth);
  } catch (e) { console.error(e); }
};
$('whyLink').onclick = ev => { ev.preventDefault(); $('aboutBtn').onclick(); };
$('mapYear').onchange = ev => drawFire(ev.target.value);
for (const st of ['heat', 'grid']) $('style_' + st).onclick = () => {
  S.mapStyle = st; for (const o of ['heat', 'grid']) $('style_' + o).classList.toggle('on', o === st);
  try { localStorage.setItem('fl-mapstyle', st); } catch { }
  fireLayer._redraw(); mapLegend();
};
function rangeChanged() {
  const f = $('from').value.split('-').map(Number), t = $('to').value.split('-').map(Number);
  if (f.length < 2 || t.length < 2 || isNaN(f[0]) || isNaN(t[0])) return;
  if (D.miOf(f[0], f[1]) > D.miOf(t[0], t[1])) return status('The start month must not be after the end month.', 'err');
  S.from = { y: f[0], m: f[1] }; S.to = { y: t[0], m: t[1] }; status(''); if (S.agg) render();
}
$('from').onchange = rangeChanged; $('to').onchange = rangeChanged;
let rz; addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (S.md) { renderCalendar(); renderDaily(); renderSeasonal(); renderAnnual(); renderHarmon(); } }, 150); });

// ---------- downloads
$('dlMonthly').onclick = () => {
  const md = S.md, a = S.agg; if (!md) return;
  const rows = ['year,month,fire_cell_days_harmonized,sensor,typical_median,percent_vs_typical,month_complete,data_status,modis_cell_days,viirs_cell_days_raw,viirs_cell_days_harmonized,modis_hotspots,viirs_hotspots'];
  for (const y of md.years) for (let m = 0; m < 12; m++) {
    const v = md.val[y][m]; if (v == null || !md.inRange(y, m)) continue;
    const mi = D.miOf(y, m + 1), med = md.med[m], part = md.partial && md.partial.y === y && md.partial.m === m;
    rows.push([y, m + 1, v.toFixed(2), `"${sourceOf(y, m)}"`, med.toFixed(2), med > 0 ? ((v / med - 1) * 100).toFixed(1) : '', part ? 'no' : 'yes', isProvisional(y, m) ? 'provisional' : 'final',
      a.M[mi].toFixed(1), a.V[mi].toFixed(1), a.H[mi].toFixed(2), a.MD ? a.MD[mi] : '', a.VD ? a.VD[mi] : ''].join(','));
  }
  download(new Blob([rows.join('\n') + '\n'], { type: 'text/csv' }), `fireline_${slug(S.sel.name)}_monthly.csv`);
};
$('dlHotspots').onclick = async () => {
  const sel = S.sel, msg = $('dlMsg'); if (!sel || sel.kind === 'world') return;
  const d0 = D.dateToDay(S.from.y, S.from.m, 1), d1 = Math.min(D.LAST.day, D.dateToDay(S.to.y, S.to.m + 1, 0));
  $('dlHotspots').disabled = true;
  try {
    const r = await D.exportHotspots(sel, d0, d1, 1500000, (a, b, n) => { msg.textContent = `Collecting hotspots: file ${a} of ${b}, ${n.toLocaleString('en-US')} rows`; });
    if (!r.rows) msg.textContent = 'No hotspots in this area and period.';
    else { download(r.blob, `fireline_${slug(sel.name)}_hotspots.csv`); msg.textContent = `${r.rows.toLocaleString('en-US')} hotspots saved${r.truncated ? ' (stopped at the 1.5 million row limit; choose a shorter period for the rest)' : ''}.`; }
  } catch (e) { msg.textContent = `Download failed: ${e.message}`; }
  $('dlHotspots').disabled = false;
};
$('dlPng').onclick = () => {
  const md = S.md; if (!md) return;
  const r = C.calendar(md, { res: S.res, mode: S.mode, numbers: S.numbers && S.res === 'month', width: 980, hiYear: null, title: `Burning calendar: ${S.sel.name}`,
    subtitle: (S.mode === 'anom' ? `Each ${S.res} against its typical value` : `Fire cell-days per ${S.res}, MODIS scale`) + ` · ${C.MONTHS[S.from.m - 1]} ${S.from.y} to ${C.MONTHS[S.to.m - 1]} ${S.to.y}` });
  const img = new Image(), w = +r.svg.match(/width="(\d+(?:\.\d+)?)"/)[1], h = +r.svg.match(/height="(\d+(?:\.\d+)?)"/)[1];
  img.onload = () => { const cv = document.createElement('canvas'); cv.width = w * 2; cv.height = h * 2; const cx = cv.getContext('2d'); cx.scale(2, 2); cx.drawImage(img, 0, 0); cv.toBlob(b => download(b, `fireline_${slug(S.sel.name)}.png`)); };
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(r.svg);
};

// ---------- start
(async () => {
  try {
    await D.init();
    const L0 = D.LAST, mm = String(L0.m).padStart(2, '0');
    S.from = { y: 2001, m: 1 }; S.to = { y: L0.y, m: L0.m };
    for (const [id, v] of [['from', '2001-01'], ['to', `${L0.y}-${mm}`]]) { const el = $(id); el.min = '2001-01'; el.max = `${L0.y}-${mm}`; el.value = v; }
    $('span').textContent = `2001 to ${L0.d} ${C.MONTHS[L0.m - 1]} ${L0.y}`;
    const sel = $('mapYear'); for (let y = L0.y; y >= 2001; y--) sel.add(new Option(y, y)); sel.value = L0.y - 1;
    paintRamp(); for (const o of ['heat', 'grid']) $('style_' + o).classList.toggle('on', o === S.mapStyle);
    drawFire(String(L0.y - 1)); initMap();
    await select(WORLD, false);
  } catch (e) { status(`Could not start: ${e.message}. Is the data folder being served at /data?`, 'err'); console.error(e); }
})();
