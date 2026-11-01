// Results tab, Model view: pure calculation + HTML for the track record. No DOM access, no network.
// app.js loads the result months, keeps state.res, and calls RESULTS.view(ctx).
// Yardstick (BUILD_PLAN S1 log 10/31 14:30): edge = win % - break-even % of the odds taken, ROI (1u flat), beat close %.
// Same maths as scripts/grade_report.py (pushes out of win %, break-even averaged over won/lost bets, ROI over all bets).
(() => {
  const GR = ['S+', 'A', 'B', 'C', 'D', 'F'];
  const UNG = 'Ungraded';
  const GROUPS = [['S+/A', ['S+', 'A'], '#b88a22'], ['B/C', ['B', 'C'], '#3f92d6'], ['D/F', ['D', 'F'], '#dd554f']]; // validated with dataviz validate_palette (dark)
  const MINUS = '−';
  const MK = { pts: 'Points', reb: 'Rebounds', ast: 'Assists', tpm: '3-pointers', pra: 'Pts+Reb+Ast', pr: 'Pts+Reb', pa: 'Pts+Ast', ra: 'Reb+Ast',
    sog: 'Shots on goal', a: 'Assists', g: 'Goals', td3: 'Triple-double', atd: 'Anytime TD', spread: 'Spread', total: 'Total', ttA: 'Away team total', ttB: 'Home team total', ml: 'Moneyline' };
  const SP = { nfl: 'NFL', nba: 'NBA', nhl: 'NHL' };

  const be = (o) => (o > 0 ? 100 / (o + 100) : -o / (-o + 100));
  const pay = (o) => (o > 0 ? o / 100 : 100 / -o);
  const num = (x) => typeof x === 'number' && isFinite(x);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ---- formatting (the verification script reads these strings from the DOM) ----
  const sgn = (x, d) => { if (x === null) return '\u2014'; const t = Math.abs(x).toFixed(d); return (+t === 0 ? '' : x < 0 ? MINUS : '+') + t; };
  const f1 = (x) => (x === null ? '—' : (100 * x).toFixed(1) + '%');
  const fEdge = (x) => (x === null ? '—' : sgn(100 * x, 1));
  const fRoi = (x) => (x === null ? '—' : sgn(100 * x, 1) + '%');
  const fBeat = (a) => (a.beatN ? (100 * a.beatK / a.beatN).toFixed(0) + '%' : '—');
  const fU = (u) => sgn(u, 1) + 'u';
  // Color rules: green/red by size, neutral gray near 0 (same idea as EV: +-2 neutral). Edge in points, ROI in % per unit.
  const cls = (x, neu, hi) => (x === null ? 'rs-neu' : Math.abs(x) < neu ? 'rs-neu' : (x > 0 ? 'rs-pos' : 'rs-neg') + (Math.abs(x) >= hi ? ' rs-hi' : ''));
  const edgeCls = (e) => cls(e === null ? null : e * 100, 1, 3);
  const roiCls = (r) => cls(r === null ? null : r * 100, 2, 5);

  // ---- ranges ----
  function range(key, today) {
    const d = (n) => new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10) + n, 12)).toISOString().slice(0, 10);
    if (key === 'l7') return { from: d(-6), to: today };
    if (key === 'l30') return { from: d(-29), to: today };
    const y = +today.slice(0, 4), m = +today.slice(5, 7); // season starts Jul 1 (same cut as publish.season_start)
    return { from: (m >= 7 ? y : y - 1) + '-07-01', to: today };
  }
  function monthsIn(list, r) {
    const a = r.from.slice(0, 7), b = r.to.slice(0, 7);
    return (list || []).filter((m) => m >= a && m <= b);
  }

  // ---- one bet row -> counted record ----
  // Beat close: did the line or price we could have had at the open beat the close, on the same side?
  // Line moved our way = beat (over: close line higher; under/spread: lower); line unchanged = compare the odds payout. Needs open + close blocks.
  function beat(r) {
    const o = r.open, c = r.close;
    if (!o || !c || !num(o.odds) || !num(c.odds)) return null;
    if (num(o.line) && num(c.line) && o.line !== c.line) {
      const up = r.side === 'o' || (r.type === 'game' && r.market !== 'spread');
      return up ? c.line > o.line : o.line > c.line;
    }
    return pay(o.odds) > pay(c.odds);
  }
  const isHome = (r) => (r.market === 'ttB' ? true : r.market === 'ttA' ? false : r.market === 'total' || !r.team ? null : r.team === r.home);

  function agg(recs) {
    const a = { n: recs.length, W: 0, L: 0, P: 0, be: 0, units: 0, beatN: 0, beatK: 0 };
    recs.forEach((x) => {
      a[x.res]++;
      if (x.res !== 'P') a.be += be(x.odds);
      a.units += x.res === 'W' ? pay(x.odds) : x.res === 'L' ? -1 : 0;
      if (x.beat !== null) { a.beatN++; a.beatK += x.beat ? 1 : 0; }
    });
    const dec = a.W + a.L;
    a.win = dec ? a.W / dec : null;
    a.bep = dec ? a.be / dec : null;
    a.edge = dec ? a.win - a.bep : null;
    a.roi = a.n ? a.units / a.n : null;
    return a;
  }

  // rows: [{...row, sp}], o: { ph, from, to, mkt, ou, fd, ha }
  function build(rows, o) {
    const inRange = rows.filter((r) => r.date >= o.from && r.date <= o.to);
    const multi = new Set(inRange.map((r) => r.sp)).size > 1;
    const label = (r) => (multi ? SP[r.sp] + ' ' : '') + (MK[r.market] || r.market);
    const mset = {};
    inRange.forEach((r) => { if (r.status === 'graded') mset[r.sp + ':' + r.market] = label(r); });
    // favorite / underdog of a game line: spread = negative line; moneyline = the shorter price of the pair
    const pair = {};
    inRange.forEach((r) => { const b = r[o.ph]; if (r.type === 'game' && r.market === 'ml' && b && num(b.odds)) (pair[r.gid + '|' + r.date] = pair[r.gid + '|' + r.date] || []).push(b.odds); });
    const fav = (r) => {
      const b = r[o.ph];
      if (r.type !== 'game' || !b) return null;
      if (r.market === 'spread') return num(b.line) && b.line !== 0 ? (b.line < 0 ? 'fav' : 'dog') : null;
      if (r.market === 'ml' && num(b.odds)) { const p = pair[r.gid + '|' + r.date] || []; return p.length === 2 && p[0] !== p[1] ? (b.odds === Math.min(p[0], p[1]) ? 'fav' : 'dog') : null; }
      return null;
    };
    const mkt = mset[o.mkt] ? o.mkt : '';
    const excl = { flagged: 0, void: 0, noPhase: 0, noOdds: 0 };
    const recs = [];
    let scope = 0;
    inRange.forEach((r) => {
      if (mkt && r.sp + ':' + r.market !== mkt) return;
      if (o.ou && !(r.side === o.ou)) return;
      if (o.ou && r.type === 'game' && r.market === 'spread') return;
      if (o.fd && fav(r) !== o.fd) return;
      if (o.ha && (isHome(r) === null || (o.ha === 'home') !== isHome(r))) return;
      scope++;
      if (r.status !== 'graded') { excl[r.status === 'void' ? 'void' : 'flagged']++; return; }
      const b = r[o.ph];
      if (!b || !['W', 'L', 'P'].includes(b.result)) { excl.noPhase++; return; }
      if (!num(b.odds)) { excl.noOdds++; return; }
      recs.push({ date: r.date, sp: r.sp, type: r.type, mkey: r.sp + ':' + r.market, mlab: label(r), grade: GR.includes(b.grade) ? b.grade : UNG,
        res: b.result, odds: b.odds, beat: beat(r) });
    });
    const grades = {};
    GR.concat([UNG]).forEach((g) => { grades[g] = agg(recs.filter((x) => x.grade === g)); });
    const mm = {};
    recs.forEach((x) => { (mm[x.mkey] = mm[x.mkey] || { key: x.mkey, label: x.mlab, recs: [] }).recs.push(x); });
    const markets = Object.values(mm).map((m) => Object.assign({ key: m.key, label: m.label }, agg(m.recs)))
      .sort((a, b) => (b.roi - a.roi) || (b.n - a.n));
    // cumulative units, 1u flat, per grade group (ungraded bets are not charted)
    const dates = Array.from(new Set(recs.filter((x) => x.grade !== UNG).map((x) => x.date))).sort();
    const series = GROUPS.map(([k, gs, color]) => {
      let c = 0;
      const pts = dates.map((d) => {
        recs.forEach((x) => { if (x.date === d && gs.includes(x.grade)) c += x.res === 'W' ? pay(x.odds) : x.res === 'L' ? -1 : 0; });
        return c;
      });
      return { k, color, pts, n: recs.filter((x) => gs.includes(x.grade)).length };
    });
    return { recs, scope, excl, all: agg(recs), grades, markets, mopts: Object.keys(mset).map((k) => [k, mset[k]]).sort((a, b) => (a[1] < b[1] ? -1 : 1)),
      mkt, types: { prop: agg(recs.filter((x) => x.type === 'prop')), game: agg(recs.filter((x) => x.type === 'game')) }, dates, series };
  }

  // One line under the grade table: is edge falling S+ -> F, and is the sample big enough?
  function verdict(grades) {
    const pres = GR.filter((g) => grades[g].n > 0 && grades[g].edge !== null);
    const out = [];
    if (pres.length < 2) out.push({ t: 'Not enough grades to compare yet.', c: 'neu' });
    else {
      const r1 = (g) => Math.round(grades[g].edge * 1000) / 10; // compare at the displayed 0.1-point precision
      const bad = [];
      for (let i = 1; i < pres.length; i++) if (r1(pres[i]) > r1(pres[i - 1])) bad.push(pres[i - 1] + ' vs ' + pres[i]);
      out.push(bad.length ? { t: 'Out of order at ' + bad.join(', '), c: 'neg' } : { t: 'Grades in order', c: 'pos' });
    }
    if (GR.some((g) => grades[g].n > 0 && grades[g].n < 50)) out.push({ t: 'Small sample: n < 50, treat as noise.', c: 'warn' });
    return out;
  }

  // ---- HTML ----
  const rseg = (items, active, key, cls2) => `<div class="rseg ${cls2 || ''}" role="group">${items.map(([k, l]) =>
    `<button data-rs="${key}:${esc(k)}" class="${k === active ? 'on' : ''}" aria-pressed="${k === active}">${esc(l)}</button>`).join('')}</div>`;

  const tbl = (head, rows, cols) => `<div class="rs-scroll"><table class="rs-tbl" style="--cols:${cols}"><thead><tr>${head.map((h, i) => `<th class="${i ? 'r' : ''}">${h}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`;
  const statCells = (a, full) => `<td class="r">${a.n}${full ? `<small class="rs-wlp rs-m">${a.W}-${a.L}-${a.P}</small>` : ''}</td>` +
    `<td class="r rs-m">${f1(a.win)}</td>` + (full ? `<td class="r rs-m rs-dim">${f1(a.bep)}</td>` : '') +
    `<td class="r rs-m ${edgeCls(a.edge)}">${fEdge(a.edge)}</td><td class="r rs-m ${roiCls(a.roi)}">${fRoi(a.roi)}</td>` + (full ? `<td class="r rs-m rs-dim">${fBeat(a)}</td>` : '');

  function chart(B) {
    const W = 340, H = 190, L = 34, R = 10, T = 10, Bm = 26;
    const dates = B.dates;
    if (!dates.length) return '<p class="rs-empty">No graded bets to chart.</p>';
    const day = (d) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 864e5;
    const xs = [day(dates[0]) - 1].concat(dates.map(day)); // origin one day before the first game day
    const all = [0].concat.apply([], B.series.map((s) => s.pts));
    let lo = Math.min.apply(null, all), hi = Math.max.apply(null, all);
    if (hi - lo < 2) { hi += 1; lo -= 1; }
    const step = [1, 2, 5, 10, 20, 50, 100, 200, 500].find((s) => (hi - lo) / s <= 5) || 1000;
    lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
    const x = (v) => L + (xs.length > 1 ? (v - xs[0]) / (xs[xs.length - 1] - xs[0]) : 0) * (W - L - R);
    const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - Bm);
    let g = '';
    for (let t = lo; t <= hi + 1e-9; t += step) g += `<line class="${t === 0 ? 'zero' : 'grid'}" x1="${L}" x2="${W - R}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}"/><text class="ax" x="${L - 5}" y="${(y(t) + 3).toFixed(1)}" text-anchor="end">${t === 0 ? '0' : sgn(t, 0)}</text>`;
    const md = (d) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    const dl = (i) => md(new Date(xs[i] * 864e5 + 432e5).toISOString().slice(0, 10));
    const xl = [0, Math.floor((xs.length - 1) / 2), xs.length - 1].filter((v, i, a) => a.indexOf(v) === i)
      .map((i) => `<text class="ax" x="${x(xs[i]).toFixed(1)}" y="${H - 8}" text-anchor="${i === 0 ? 'start' : i === xs.length - 1 ? 'end' : 'middle'}">${i === 0 ? 'Start' : dl(i)}</text>`).join('');
    const lines = B.series.filter((s) => s.n).map((s) => {
      const p = [0].concat(s.pts).map((v, i) => `${x(xs[i]).toFixed(1)},${y(v).toFixed(1)}`);
      const last = s.pts[s.pts.length - 1];
      return `<polyline points="${p.join(' ')}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>` +
        `<circle cx="${x(xs[xs.length - 1]).toFixed(1)}" cy="${y(last).toFixed(1)}" r="4" fill="${s.color}" stroke="var(--card)" stroke-width="2"/>`;
    }).join('');
    const hits = dates.map((d, i) => {
      const cx = x(xs[i + 1]);
      const read = md(d) + ' · ' + B.series.filter((s) => s.n).map((s) => s.k + ' ' + fU(s.pts[i])).join(' · ');
      return `<g class="rs-x" data-i="${i}" data-read="${esc(read)}"><line class="xl" x1="${cx.toFixed(1)}" x2="${cx.toFixed(1)}" y1="${T}" y2="${H - Bm}"/><rect class="hit" x="${(cx - 14).toFixed(1)}" y="${T}" width="28" height="${H - T - Bm}"/></g>`;
    }).join('');
    const legend = B.series.map((s) => `<span class="rs-lg${s.n ? '' : ' off'}"><i style="background:${s.color}"></i>${s.k} <b class="rs-m">${s.n ? fU(s.pts[s.pts.length - 1]) : '—'}</b></span>`).join('');
    const rows = dates.map((d, i) => `<tr><td>${md(d)}</td>${B.series.map((s) => `<td class="r rs-m">${s.n ? fU(s.pts[i]) : '—'}</td>`).join('')}</tr>`).join('');
    return `<div class="rs-legend">${legend}</div>
      <svg class="rs-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${B.aria || 'Cumulative units by grade group, 1 unit flat bets'}, ${dates.length} game day${dates.length > 1 ? 's' : ''}">${g}${xl}${lines}${hits}</svg>
      <div class="rs-read" aria-live="polite">Tap the chart for a day’s total.</div>
      <details class="rs-details"><summary>Table</summary><table class="rs-tbl small"><thead><tr><th>${B.dayLbl || 'Day'}</th>${B.series.map((s) => `<th class="r">${s.k}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></details>`;
  }


  // ---- My Bets view (rm*): the user's tracked bets from window.MyBets; no network, no DOM ----
  const rmUnits = (u) => String(+u.toFixed(2)) + 'u';
  const rmGrade = (b) => (GR.includes(b.grade) ? b.grade : UNG);
  function rmAgg(list, clvOf) { // list of { b, clv } ; record/units over W/L/P, beat close over settled + open bets with a close price at their line
    const a = { n: 0, W: 0, L: 0, P: 0, voided: 0, open: 0, units: 0, staked: 0, beatN: 0, beatK: 0 };
    list.forEach((x) => {
      const b = x.b;
      if (b.status === 'void') { a.voided++; return; }
      if (b.status === 'open') a.open++;
      else { a[b.status]++; a.n++; a.units += b.pl; a.staked += b.units; }
      if (x.clv.beat !== null) { a.beatN++; a.beatK += x.clv.beat ? 1 : 0; }
    });
    a.units = Math.round(a.units * 100) / 100;
    a.roi = a.staked > 0 ? a.units / a.staked : null;
    return a;
  }
  // bets: store bets array; o: { from, to, sports (lowercase array | null), mkt, ou, fd, gr }; rowFor(bet) -> results row | undefined
  function rmBuild(bets, o, rowFor) {
    const clvOf = window.MyBets.clvOf;
    const inR = bets.filter((b) => b.date >= o.from && b.date <= o.to && (!o.sports || o.sports.includes(b.sport)));
    const multi = new Set(inR.map((b) => b.sport)).size > 1;
    const mk = (b) => b.sport + ':' + b.market;
    const label = (b) => (multi ? SP[b.sport] + ' ' : '') + (MK[b.market] || b.market);
    const mset = {};
    inR.forEach((b) => { mset[mk(b)] = label(b); });
    const mkt = mset[o.mkt] ? o.mkt : '';
    const f = inR.filter((b) => (!mkt || mk(b) === mkt) && (!o.ou || b.side === o.ou) && (!o.fd || (b.odds < 0 ? 'fav' : 'dog') === o.fd) && (!o.gr || rmGrade(b) === o.gr));
    const recs = f.map((b) => ({ b, clv: clvOf(b, rowFor(b)) }));
    const mm = {};
    recs.forEach((x) => { if (x.b.status !== 'void') (mm[mk(x.b)] = mm[mk(x.b)] || { key: mk(x.b), label: label(x.b), list: [] }).list.push(x); });
    const markets = Object.values(mm).map((m) => Object.assign({ key: m.key, label: m.label }, rmAgg(m.list))).filter((m) => m.n > 0)
      .sort((a, b) => (b.units - a.units) || (b.n - a.n) || (a.label < b.label ? -1 : 1));
    const sd = (b) => (b.settledAt || '').slice(0, 10) || b.date;
    const settled = f.filter((b) => b.status === 'W' || b.status === 'L' || b.status === 'P');
    const dates = Array.from(new Set(settled.map(sd))).sort();
    let c = 0;
    const pts = dates.map((d) => { settled.forEach((b) => { if (sd(b) === d) c += b.pl; }); return Math.round(c * 100) / 100; });
    const series = [{ k: 'Units', color: '#3ee6a0', pts, n: settled.length }];
    return { all: rmAgg(recs), markets, mopts: Object.keys(mset).map((k) => [k, mset[k]]).sort((a, b) => (a[1] < b[1] ? -1 : 1)), mkt, dates, series,
      aria: 'Cumulative units of your settled bets by settle day', dayLbl: 'Settled' };
  }

  function rmView(ctx, top) {
    const s = ctx.s, I = ctx.info;
    if (!ctx.total) return top + '<div class="card empty rs-card"><h2>My Bets</h2><p>No tracked bets yet. Tap + on any bet to track it; results settle here on their own.</p></div>';
    const rg = [['l7', 'Last 7'], ['l30', 'Last 30'], ['season', 'Season']];
    const M = ctx.M, mkSel = M ? M.mkt : '';
    const deep = ctx.gate(`<div class="rs-f"><span class="lbl">Market</span><div class="rs-mchips">${[['', 'All']].concat(M ? M.mopts : []).map(([k, l]) =>
      `<button data-rs="mmkt:${esc(k)}" class="${k === mkSel ? 'on' : ''}" aria-pressed="${k === mkSel}">${esc(l)}</button>`).join('')}</div></div>
      <div class="rs-f"><span class="lbl">Over / under</span>${rseg([['', 'All'], ['o', 'Over'], ['u', 'Under']], s.mou, 'mou')}</div>
      <div class="rs-f"><span class="lbl">Odds</span>${rseg([['', 'All'], ['fav', 'Favorite'], ['dog', 'Underdog']], s.mfd, 'mfd')}</div>
      <div class="rs-f"><span class="lbl">Grade when added</span><div class="rs-mchips">${[['', 'All']].concat(GR.concat([UNG]).map((g) => [g, g])).map(([k, l]) =>
        `<button data-rs="mgr:${esc(k)}" class="${k === s.mgr ? 'on' : ''}" aria-pressed="${k === s.mgr}">${esc(l)}</button>`).join('')}</div></div>
      <button class="rs-reset" data-rs="reset:1">Reset filters</button>`, '');
    const nAct = ['mmkt', 'mou', 'mfd', 'mgr'].filter((k) => s[k]).length;
    const fold = `<button class="rs-foldbtn" data-rs="fold:1" aria-expanded="${!!s.fold}"><span>Filters</span><span class="rs-fsum">${esc(rg.find((r) => r[0] === s.range)[1])}${nAct ? ' · ' + nAct + ' more' : ''}</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button>` +
      (s.fold ? `<div class="rs-fold"><div class="rs-f"><span class="lbl">Date range</span>${rseg(rg, s.range, 'range')}</div>${deep}</div>` : '');
    let out = top + `<div class="rs-filters">${fold}</div>`;
    if (ctx.loading) return out + '<div class="card rs-card"><div class="srows" aria-hidden="true">' + [0, 1, 2].map(() => '<div class="sk-row"><span class="bars"><span class="bar w85"></span><span class="bar w55"></span></span></div>').join('') + '</div><p class="rs-empty">Loading results…</p></div>';
    const a = M.all;
    if (!a.n) return out + '<div class="card empty rs-card"><h2>My Bets</h2><p>No settled bets in this filter yet.</p></div>';
    const tile = (lbl, key, val, c, sub) => `<div class="tile rs-tile"><div class="lbl rs-lbl">${lbl}${I(key).btn}</div><div class="num ${c || ''}">${val}</div><div class="rs-sub">${sub}</div></div>`;
    const uc = (u) => cls(u, 0.05, 3);
    out += `<div class="tiles rs-tiles rm-tiles" aria-label="${esc(ctx.sport)} My Bets results">` +
      tile('Record', 'mrecord', `${a.W}-${a.L}-${a.P}`, '', a.voided ? `${a.voided} void` : 'W-L-P') +
      tile('Units P/L', 'munits', fU(a.units), uc(a.units), `${rmUnits(a.staked)} staked`) +
      tile('ROI', 'mroi', fRoi(a.roi), roiCls(a.roi), 'on settled stakes') +
      tile('Beat close', 'mbeat', fBeat(a), '', a.beatN ? `${a.beatK} of ${a.beatN} with a close price` : 'no close price yet') + '</div>' +
      ['mrecord', 'munits', 'mroi', 'mbeat'].map((k) => I(k).note).join('');
    out += `<div class="sec">Cumulative units${I('munits').btn}</div><div class="card rs-card">${chart(M)}</div>`;
    const head = ['Market', 'Bets<small class="rs-wlp">W-L-P</small>', 'Units', 'ROI', 'Beat<br>close'];
    const rows = M.markets.map((m) => `<tr><td class="rs-name">${esc(m.label)}</td><td class="r">${m.n}<small class="rs-wlp rs-m">${m.W}-${m.L}-${m.P}</small></td>` +
      `<td class="r rs-m ${uc(m.units)}">${fU(m.units)}</td><td class="r rs-m ${roiCls(m.roi)}">${fRoi(m.roi)}</td>` +
      `<td class="r rs-m rs-dim">${fBeat(m)}${m.beatN ? `<small class="rs-wlp rs-m">${m.beatK}/${m.beatN}</small>` : ''}</td></tr>`).join('');
    out += `<div class="sec">By market, most units first</div><div class="card rs-card rs-flush">${tbl(head, rows, 5)}</div>`;
    out += `<p class="rs-foot">Counted: ${a.n} settled bets at the odds you saved${a.voided ? `; ${a.voided} void left out` : ''}. Beat close compares your odds with the closing price on the same line: ${a.beatN} of ${a.n + a.open} bets measured (settled and open); a bet whose line differs from the close line, or whose game has no close price, is not counted.</p>`;
    return out;
  }

  // ctx: { s: state.res, sport: 'All'|'NFL'.., B: build() result, info(key) -> {btn, note}, ranges, gate, loading, err, noData }
  function view(ctx) {
    const s = ctx.s, I = ctx.info;
    const top = rseg([['model', 'Model'], ['mine', 'My Bets']], s.view, 'view', 'big');
    if (s.view === 'mine') return rmView(ctx, top);
    const rg = [['l7', 'Last 7'], ['l30', 'Last 30'], ['season', 'Season']];
    const deep = ctx.gate(`<div class="rs-f"><span class="lbl">Market</span><div class="rs-mchips">${[['', 'All']].concat(ctx.B ? ctx.B.mopts : []).map(([k, l]) =>
      `<button data-rs="mkt:${esc(k)}" class="${k === (ctx.B ? ctx.B.mkt : '') ? 'on' : ''}" aria-pressed="${k === (ctx.B ? ctx.B.mkt : '')}">${esc(l)}</button>`).join('')}</div></div>
      <div class="rs-f"><span class="lbl">Over / under</span>${rseg([['', 'All'], ['o', 'Over'], ['u', 'Under']], s.ou, 'ou')}</div>
      <div class="rs-f"><span class="lbl">Game lines</span>${rseg([['', 'All'], ['fav', 'Favorite'], ['dog', 'Underdog']], s.fd, 'fd')}</div>
      <div class="rs-f"><span class="lbl">Home / away</span>${rseg([['', 'All'], ['home', 'Home'], ['away', 'Away']], s.ha, 'ha')}</div>
      <button class="rs-reset" data-rs="reset:1">Reset filters</button>`, '');
    const nAct = ['mkt', 'ou', 'fd', 'ha'].filter((k) => s[k]).length;
    const fold = `<button class="rs-foldbtn" data-rs="fold:1" aria-expanded="${s.fold}"><span>Filters</span><span class="rs-fsum">${esc(rg.find((r) => r[0] === s.range)[1])}${nAct ? ' · ' + nAct + ' more' : ''}</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button>` +
      (s.fold ? `<div class="rs-fold"><div class="rs-f"><span class="lbl">Date range</span>${rseg(rg, s.range, 'range')}</div>${deep}</div>` : '');
    const phase = `<div class="rs-phase"><span class="lbl">Graded at</span>${rseg([['close', 'Close'], ['open', 'Open']], s.ph, 'ph', 'sm')}</div>`;
    let out = top + `<div class="rs-bar">${phase}</div><div class="rs-filters">${fold}</div>`;
    if (ctx.loading) return out + '<div class="card rs-card"><div class="srows" aria-hidden="true">' + [0, 1, 2].map(() => '<div class="sk-row"><span class="bars"><span class="bar w85"></span><span class="bar w55"></span></span></div>').join('') + '</div><p class="rs-empty">Loading results…</p></div>';
    if (ctx.err) return out + '<div class="card empty rs-card"><h2>Results unavailable</h2><p>The results files did not load.</p><button class="pillbtn" data-rs="retry:1">Try again</button></div>';
    if (ctx.noData) return out + `<div class="card empty rs-card"><h2>No results yet</h2><p>${esc(ctx.noData)}</p></div>`;
    const B = ctx.B, a = B.all;
    const tile = (lbl, key, val, c, sub) => `<div class="tile rs-tile"><div class="lbl rs-lbl">${lbl}${key ? I(key).btn : ''}</div><div class="num ${c || ''}">${val}</div>${sub ? `<div class="rs-sub">${sub}</div>` : ''}</div>`;
    const notes = ['graded', 'win', 'edge', 'roi', 'beat'].map((k) => I(k).note).join('');
    out += `<div class="tiles rs-tiles" aria-label="${esc(ctx.sport)} model results">` +
      tile('Graded bets', 'graded', a.n, '', `${a.W}-${a.L}-${a.P}`) + tile('Win %', 'win', f1(a.win), '', `Break-even ${f1(a.bep)}`) +
      tile('Edge vs break-even', 'edge', fEdge(a.edge), edgeCls(a.edge), 'points') + tile('ROI', 'roi', fRoi(a.roi), roiCls(a.roi), `${fU(a.units)} on ${a.n} flat bets`) +
      tile('Beat close', 'beat', fBeat(a), '', a.beatN ? `${a.beatK} of ${a.beatN} bets` : 'not measurable') + '</div>' + notes;
    // grade table
    const gr = B.grades;
    const head = ['Grade', 'Bets<small class="rs-wlp">W-L-P</small>', 'Win %', 'Break-<wbr>even', 'Edge', 'ROI', 'Beat<br>close'];
    let rows = GR.map((g) => `<tr class="${gr[g].n ? '' : 'rs-zero'}"><td><span class="grade-badge" data-g="${g}">${g}</span></td>${statCells(gr[g], true)}</tr>`).join('');
    if (gr[UNG].n) rows += `<tr><td class="rs-ung">${UNG}</td>${statCells(gr[UNG], true)}</tr>`;
    const v = verdict(gr);
    out += `<div class="sec">By grade${I('grades').btn}</div>${I('grades').note}<div class="card rs-card rs-flush">${tbl(head, rows, 7)}</div>
      <div class="rs-verdict">${v.map((x) => `<span class="rs-v ${x.c}">${esc(x.t)}</span>`).join('')}</div>`;
    // chart
    out += `<div class="sec">Cumulative units${I('units').btn}</div>${I('units').note}<div class="card rs-card">${chart(B)}</div>`;
    // props vs game lines + markets
    const h5 = ['', 'Bets', 'Win %', 'Edge', 'ROI'];
    const tr = (name, x) => `<tr><td class="rs-name">${esc(name)}</td>${statCells(x, false)}</tr>`;
    out += `<div class="sec">Props vs game lines</div><div class="card rs-card rs-flush">${tbl(h5.map((h, i) => (i ? h : 'Type')), tr('Props', B.types.prop) + tr('Game lines', B.types.game), 5)}</div>`;
    out += `<div class="sec">By market, best ROI first</div><div class="card rs-card rs-flush">${B.markets.length ? tbl(h5.map((h, i) => (i ? h : 'Market')), B.markets.map((m) => tr(m.label, m)).join(''), 5) : '<p class="rs-empty">No bets match these filters.</p>'}</div>`;
    // footnote
    const e = B.excl, parts = [];
    if (e.flagged) parts.push(`${e.flagged} flagged`);
    if (e.void) parts.push(`${e.void} void or DNP`);
    if (e.noPhase) parts.push(`${e.noPhase} not in the ${s.ph} pull`);
    if (e.noOdds) parts.push(`${e.noOdds} without odds`);
    out += `<p class="rs-foot">Counted: ${a.n} graded bets, both sides of every prop, graded at the ${s.ph}. Left out: ${parts.length ? parts.join(', ') : 'none'}.
      Beat close needs both the open and close prices: ${a.beatN} of ${a.n} bets measured${B.types.game.n ? ' (game lines have no open price yet)' : ''}.${B.grades[UNG].n ? ' Ungraded: game-line grades are not published.' : ''}</p>`;
    return out;
  }

  window.RESULTS = { GR, build, rmBuild, verdict, view, range, monthsIn, beat, agg, be, pay, fmt: { f1, fEdge, fRoi, fBeat, fU } };
})();
