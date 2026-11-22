/* Trend Bettors command dashboard (private, Nick only; owner 11/21). Ported from docs/mockups/command/r4.* with h2 + the 20:52 tweak
   locked: no h0/h1, no mockup pill, no DEMO night. Phone-first. Served from GitHub Pages (slate-public app/command/) so it shares the
   app's My Bets storage (app/mybets.js, localStorage sp.mybets.v1): Tail / Fade saves go through MyBets, unchanged.
   Data: data.enc, written by scripts/command.py on the props runs, AES-256-GCM over gzip. The key comes once from the unlock link
   (#k=<43 characters>) and stays in this browser's localStorage (tb.cmd.key); it is never sent anywhere.
   Deep links are a plain hash: #board, #board-am (8 AM picks), #live, #results, #sheet-tail, #sheet-fade, #sheet-filter (add -am);
   a -shot token skips the boot (screenshots). Live scores and stat lines come with piece B (app/live.js); until then every pick
   reads as not started and started games say so. */
(function () {
  'use strict';

  var Q = new URLSearchParams(location.search);
  var TABS = ['board', 'live', 'results'];
  var S = {
    live: false,         // real live tracking arrives with piece B (app/live.js)
    card: Q.get('card') === 'am' ? 'am' : 'pm',   // which card the Board shows: 2 PM (default) or 8 AM
    bs: null,            // Tail / Fade sheet draft
    tab: TABS.indexOf(Q.get('tab')) > -1 ? Q.get('tab') : 'board',
    shot: Q.get('shot') === '1',
    f: blankFilters(), draft: null, sheet: '',   // sheet: '' | 'filter' | 'bet'
    open: '',            // expanded board row (bid)
    gopen: '',           // expanded game on the Live tab (gid)
    gsport: '', gpicks: false,
    per: 'season',
    D: null
  };
  var app = document.getElementById('cd-app');
  var REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var SINCE_FALLBACK = { NHL: '2026-11-20' };
  var SIM_CLOCK = '21:55:00';            // demo "now", ET
  var GAME_MIN = { NBA: 140, NHL: 150 };  // demo real-time length of a game
  var STAT_SHORT = { pra: 'P+R+A', ra: 'R+A', pa: 'P+A', pr: 'P+R', pts: 'Pts', reb: 'Reb', ast: 'Ast', a: 'Ast', g: 'Goals', sog: 'Shots' };
  var BOOKS = { draftkings: 'DraftKings', caesars: 'Caesars', fanduel: 'FanDuel', betmgm: 'BetMGM', espnbet: 'ESPN BET', fanatics: 'Fanatics' };
  var MB = window.MyBets || null;                       // app/mybets.js, loaded as a classic script before this one
  var mem = MB ? MB.load() : { schema: 1, bets: {} };   // this tab's copy of the My Bets store
  var UMIN = 0.25, UMAX = 5, USTEP = 0.25, FADE_UNITS = 0.25;
  var SORTS = [['rank', 'Rank'], ['edge', 'Edge'], ['P', 'Model chance'], ['ev8', 'Model EV'], ['kick', 'Start time']];
  var PERS = [['lastNight', 'Last night'], ['last7', 'Last 7 days'], ['season', 'Season']];
  /* One simulated box score per player: which counting stats make up each market. */
  var COMP = {
    NBA: { pts: ['pts'], reb: ['reb'], ast: ['ast'], pra: ['pts', 'reb', 'ast'], pr: ['pts', 'reb'], pa: ['pts', 'ast'], ra: ['reb', 'ast'] },
    NHL: { g: ['g'], a: ['a'], pts: ['g', 'a'], sog: ['sog'] }
  };
  var SHARE = { pts: 0.62, reb: 0.2, ast: 0.18, g: 0.4, a: 0.6, sog: 1 };
  var CLBL = { pts: 'PTS', reb: 'REB', ast: 'AST', g: 'G', a: 'A', sog: 'SOG' };
  var CORDER = ['pts', 'reb', 'ast', 'g', 'a', 'sog'];

  function blankFilters() { return { q: '', sport: '', stake: '', tier: '', side: '', market: '', game: '', edge: 0, chance: 0, status: '', sort: 'rank' }; }
  function copy(o) { var n = {}; for (var k in o) n[k] = o[k]; return n; }

  /* ---------- deep-link state: query first, then the hash wins ---------- */
  function readHash() {
    var t = location.hash.replace(/^#/, '').toLowerCase().split('-').filter(Boolean);
    if (!t.length) return null;
    var o = { tab: '', card: '', sheet: '', shot: false }, first = t[0];
    if (TABS.indexOf(first) > -1) o.tab = first;
    else if (first === 'sheet') { o.tab = 'board'; o.sheet = 'filter'; }
    else return null;
    t.slice(1).forEach(function (k) {
      if (k === 'am') o.card = 'am'; else if (k === 'pm') o.card = 'pm'; else if (k === 'shot') o.shot = true;
      else if (first === 'sheet' && (k === 'tail' || k === 'fade' || k === 'filter')) o.sheet = k;
    });
    return o;
  }
  var wantSheet = Q.get('sheet') === '1' ? 'filter' : (/^(tail|fade|filter)$/.test(Q.get('sheet') || '') ? Q.get('sheet') : '');
  var hashCard = '';   // a card named in the link wins over the before-2-PM default
  function takeHash() {
    var h = readHash(); if (!h) return false;
    if (h.tab) S.tab = h.tab;
    if (h.card) { S.card = h.card; hashCard = h.card; }
    wantSheet = h.sheet;
    if (h.shot) S.shot = true;
    S.f.status = '';
    return true;
  }
  /* keep the hash in step with the tab / card, so a reload lands on the same screen */
  function syncHash() {
    var h = '#' + S.tab + (S.card === 'am' ? '-am' : '') + (/-shot\b/.test(location.hash) ? '-shot' : '');
    try { if (location.hash !== h) history.replaceState(null, '', location.pathname + location.search + h); } catch (e) { /* ignore */ }
  }

  /* ---------- formatting ---------- */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function num(x, d) {
    if (x == null || isNaN(x)) return '—';
    var s = (+x).toFixed(d == null ? 1 : d);
    if (s.indexOf('.') > -1) s = s.replace(/0+$/, '').replace(/\.$/, '');
    return s === '-0' ? '0' : s;
  }
  function signed(x, d) { if (x == null) return '—'; var s = num(Math.abs(x), d); return s === '0' ? '0' : (x < 0 ? '-' : '+') + s; }
  function price(p) { if (p == null || isNaN(p)) return '—'; p = Math.round(p); return p > 0 ? '+' + p : '−' + Math.abs(p); }   // typographic minus on screen; inputs use a plain '-'
  /* edge and ev8 in the data are already percents (2.79 = 2.79%), not fractions. One decimal everywhere;
     a positive value that would round to 0.0 reads "<0.1%" instead of a misleading "+0.02%". */
  function pctTxt(e) {
    if (e == null || isNaN(e)) return '—';
    if (Math.abs(e) < 0.05) return e === 0 ? '0.0%' : (e < 0 ? '>-0.1%' : '<0.1%');
    return (e < 0 ? '-' : '+') + Math.abs(e).toFixed(1) + '%';
  }
  function md(iso) { if (!iso) return ''; var p = iso.split('-'); return (+p[1]) + '/' + (+p[2]); }
  function book(b) { return BOOKS[b] || (b ? b.charAt(0).toUpperCase() + b.slice(1) : ''); }
  function unitsTxt(u) { return num(u, 2) + 'u'; }
  function tierKey(p) { return p.units > 0 ? p.tier : 'TRK'; }
  function shortStat(p) { return STAT_SHORT[p.stat] || p.market; }
  function gameLabel(g) { return String(g).replace('@', ' @ '); }
  function clockTxt(iso) { return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) + ' ET'; }
  function dateTxt(iso) { return new Date(iso + 'T12:00:00-05:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/New_York' }); }
  function pullTxt() { return S.D && S.D.pulledAt ? clockTxt(S.D.pulledAt) : 'next'; }
  function cap1(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }
  function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }

  /* ---------- demo simulation (only used when S.live) ---------- */
  function hash(str) { var h = 2166136261; for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } h ^= h >>> 15; h = Math.imul(h, 2246822519); h ^= h >>> 13; return ((h >>> 0) % 10000) / 10000; }
  function simNow() { return new Date(S.D.date + 'T' + SIM_CLOCK + '-05:00'); }
  var gCache = {};
  function gameState(g) {
    var key = (S.live ? 'L' : 'P') + g.gid;
    if (gCache[key]) return gCache[key];
    var out;
    if (!S.live) out = { st: 'pre', started: new Date(g.kickoff) < new Date() };
    else {
      var mins = (simNow() - new Date(g.kickoff)) / 60000, dur = GAME_MIN[g.sport] || 150;
      if (mins < 0) out = { st: 'pre' };
      else {
        var frac = Math.min(1, mins / dur), fin = frac >= 1;
        var ha = hash(g.gid + 'a'), hh = hash(g.gid + 'h'), fa, fh;
        if (g.sport === 'NHL') { fa = Math.round(g.projAway * (0.45 + 1.1 * ha)); fh = Math.round(g.projHome * (0.45 + 1.1 * hh)); }
        else { fa = Math.round(g.projAway * (0.93 + 0.14 * ha)); fh = Math.round(g.projHome * (0.93 + 0.14 * hh)); }
        if (fa === fh) { if (hh >= ha) fh++; else fa++; }
        var a = fin ? fa : Math.round(fa * frac * (0.94 + 0.12 * hh)), h = fin ? fh : Math.round(fh * frac * (0.94 + 0.12 * ha));
        var clock = 'Final';
        if (!fin) {
          var parts = g.sport === 'NHL' ? 3 : 4, len = g.sport === 'NHL' ? 20 : 12;
          var pos = frac * parts, per = Math.min(parts, Math.floor(pos) + 1), left = len * (1 - (pos - Math.floor(pos)));
          var mm = Math.floor(left), ss = Math.floor((left - mm) * 60);
          clock = (g.sport === 'NHL' ? 'P' : 'Q') + per + ' ' + mm + ':' + (ss < 10 ? '0' : '') + ss;
        }
        out = { st: fin ? 'final' : 'live', frac: frac, a: a, h: h, clock: clock };
      }
    }
    gCache[key] = out;
    return out;
  }
  function gameById(gid) { for (var i = 0; i < S.D.games.length; i++) if (S.D.games[i].gid === gid) return S.D.games[i]; return null; }

  /* Players: every pick of one player reads from the same simulated stat line. */
  var PL = null;
  function pid(p) { var m = String(p.bid || '').split('-'); return p.sport + ':' + (m[5] || (p.name + p.team)); }
  function players() {
    if (PL) return PL;
    PL = {};
    allRows().forEach(function (p) {
      var k = pid(p);
      var pl = PL[k] = PL[k] || { id: k, name: p.name, team: p.team, sport: p.sport, gid: p.gid, picks: [], mean: {}, fin: {} };
      if (!pl.picks.some(function (x) { return x.bid === p.bid; })) pl.picks.push(p);
    });
    Object.keys(PL).forEach(function (k) { solve(PL[k]); });
    return PL;
  }
  /* Back out per-stat projections from the player's market projections (singles first, then combos). */
  function solve(pl) {
    var comps = COMP[pl.sport] || {}, m = pl.mean, todo = pl.picks.filter(function (p) { return comps[p.stat]; });
    var unk = function (p) { return comps[p.stat].filter(function (c) { return m[c] == null; }); };
    while (todo.length) {
      todo.sort(function (a, b) { return unk(a).length - unk(b).length; });
      var p = todo.shift(), u = unk(p);
      if (!u.length) continue;
      var known = 0, tot = 0;
      comps[p.stat].forEach(function (c) { if (m[c] != null) known += m[c]; });
      u.forEach(function (c) { tot += SHARE[c] || 1; });
      var rest = Math.max(p.proj - known, 0.15 * u.length);
      u.forEach(function (c) { m[c] = rest * (SHARE[c] || 1) / tot; });
    }
    Object.keys(m).forEach(function (c) {
      var mean = m[c], h = hash(pl.id + c + 'fin'), n;
      if (mean >= 3) n = Math.round(mean * (0.6 + 0.8 * h));
      else { var k = 0, pr = Math.exp(-mean), cum = pr; while (h > cum && k < 12) { k++; pr *= mean / k; cum += pr; } n = k; }   // Poisson draw for small counts
      pl.fin[c] = n;
    });
  }
  function compNow(pl, c, frac) {
    var n = pl.fin[c] || 0;
    if (frac >= 1) return n;
    var k = 0; for (var i = 0; i < n; i++) if (hash(pl.id + c + i) <= frac) k++;
    return k;
  }
  function statLine(pl) {
    var g = gameById(pl.gid), gs = g ? gameState(g) : { st: 'pre' };
    if (gs.st === 'pre') return null;
    var frac = gs.st === 'final' ? 1 : gs.frac, out = [];
    CORDER.forEach(function (c) { if (pl.fin[c] != null) out.push([CLBL[c], compNow(pl, c, frac)]); });
    return out;
  }
  function pickState(p) {
    if (!S.live) return { st: 'pre' };
    var g = gameById(p.gid), gs = g ? gameState(g) : { st: 'pre' };
    if (gs.st === 'pre') return { st: 'pre' };
    var pl = players()[pid(p)], cs = (COMP[p.sport] || {})[p.stat], frac = gs.st === 'final' ? 1 : gs.frac, stat = 0;
    if (cs) cs.forEach(function (c) { stat += compNow(pl, c, frac); });
    else stat = Math.round(p.proj * (0.6 + 0.8 * hash(pl.id + p.stat)) * frac);
    var under = p.side === 'Under', over = stat > p.line;
    if (gs.st === 'final') return { st: (under ? !over : over) ? 'w' : 'l', stat: stat, done: true };
    if (over) return { st: under ? 'l' : 'w', stat: stat, early: true };
    var pace = stat / Math.max(gs.frac, 0.05);
    return { st: 'live', stat: stat, track: (under ? pace <= p.line : pace >= p.line) ? 'ok' : 'risk', clock: gs.clock };
  }
  function stateWord(s) { return s.st === 'w' ? 'Won' : s.st === 'l' ? 'Lost' : s.st === 'live' ? (s.track === 'ok' ? 'On track' : 'At risk') : 'Not started'; }
  function stateCls(s) { return s.st === 'w' ? 'w' : s.st === 'l' ? 'l' : s.st === 'live' ? s.track : 'pre'; }

  /* ---------- filtering ---------- */
  var FKEYS = ['q', 'sport', 'stake', 'tier', 'side', 'market', 'game', 'edge', 'chance', 'status'];
  function match(p, f) {
    if (f.sport && p.sport !== f.sport) return false;
    if (f.stake && (f.stake === 'bet') !== (p.units > 0)) return false;
    if (f.tier && tierKey(p) !== f.tier) return false;
    if (f.side && p.side !== f.side) return false;
    if (f.market && p.market !== f.market) return false;
    if (f.game && p.gid !== f.game) return false;
    if (f.edge && p.edge < f.edge) return false;
    if (f.chance && p.P < f.chance) return false;
    if (f.status && pickState(p).st !== f.status) return false;
    if (f.q) {
      var hay = (p.name + ' ' + p.team + ' ' + p.game + ' ' + p.market + ' ' + p.sport).toLowerCase(), words = f.q.toLowerCase().split(/\s+/);
      for (var i = 0; i < words.length; i++) if (words[i] && hay.indexOf(words[i]) < 0) return false;
    }
    return true;
  }
  function activeCount(f) { var n = 0; FKEYS.forEach(function (k) { if (f[k]) n++; }); return n; }
  function sorted(list, k) {
    var out = list.slice();
    out.sort(function (a, b) {
      if (k === 'edge') return b.edge - a.edge || a.rank - b.rank;
      if (k === 'P') return b.P - a.P || a.rank - b.rank;
      if (k === 'ev8') return b.ev8 - a.ev8 || a.rank - b.rank;
      if (k === 'kick') return new Date(a.kickoff) - new Date(b.kickoff) || a.rank - b.rank;
      return a.rank - b.rank;
    });
    return out;
  }
  function countBy(fn) { var m = {}; cur().forEach(function (p) { var k = fn(p); m[k] = (m[k] || 0) + 1; }); return m; }
  function label(list, v) { for (var i = 0; i < list.length; i++) if (list[i][0] === v) return list[i][1]; return v; }
  function filterLabel(k, v) {
    if (k === 'q') return 'Search: ' + v;
    if (k === 'stake') return v === 'bet' ? 'With units' : 'Tracked only';
    if (k === 'tier') return 'Tier ' + v;
    if (k === 'game') { var g = gameById(v); return g ? g.away + ' @ ' + g.home : v; }
    if (k === 'edge') return 'Edge ' + pctTxt(v) + ' or more';
    if (k === 'chance') return 'Chance ' + num(v) + '% or more';
    if (k === 'status') return { pre: 'Not started', live: 'Live', w: 'Won', l: 'Lost' }[v];
    return v;
  }

  /* ---------- small pieces ---------- */
  function logo() {
    return '<svg class="cd-mark" viewBox="0 0 36 36" aria-hidden="true"><path d="M18 2 L31 7 L34 18 L31 29 L18 34 L5 29 L2 18 L5 7 Z" fill="none" stroke="#5B7CFF" stroke-width="1.75"/><text x="18" y="23" text-anchor="middle" font-family="Saira Semi Condensed, Saira, sans-serif" font-weight="700" font-size="14" fill="#F3F5F9">TB</text><circle cx="30" cy="6" r="2.5" fill="#2FD67B"/></svg>';
  }
  function demoTag() { return S.live ? '<span class="cd-demo">DEMO</span>' : ''; }
  function sportTag(sp) { return '<em class="cd-sp cd-sp-' + sp.toLowerCase() + '">' + sp + '</em>'; }
  function cu(v, d, pre, suf) { return '<span class="cd-cu" data-cu="' + v + '" data-d="' + d + '" data-pre="' + (pre || '') + '" data-suf="' + (suf || '') + '">' + (pre || '') + num(v, d) + (suf || '') + '</span>'; }
  function bar(pct, cls) { return '<i class="cd-bar' + (cls ? ' ' + cls : '') + '"><i data-w="' + Math.max(0, Math.min(100, pct)).toFixed(1) + '"></i></i>'; }
  function ring(v, txt, aria, cls) {
    var C = 188.5, on = Math.max(0, Math.min(1, v)) * C;
    return '<svg class="cd-ring ' + (cls || '') + '" viewBox="0 0 72 72" role="img" aria-label="' + esc(aria) + '"><circle class="cd-ring-bg" cx="36" cy="36" r="30"/><circle class="cd-ring-fg" cx="36" cy="36" r="30" transform="rotate(-90 36 36)" stroke-dasharray="' + on.toFixed(1) + ' ' + C + '"/><text x="36" y="41" text-anchor="middle">' + txt + '</text></svg>';
  }
  function tierChip(p) {
    if (!(p.units > 0)) return '<span class="cd-chip cd-t-trk">Tracked</span>';
    return '<span class="cd-chip cd-t-' + p.tier.toLowerCase() + '">' + esc(p.tier) + '<b>' + unitsTxt(p.units) + '</b></span>';
  }
  var ICON = {
    board: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h3M4 12h3M4 18h3M10 6h10M10 12h10M10 18h10"/></svg>',
    live: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="2.5"/><path d="M7.5 7.5a6.4 6.4 0 0 0 0 9M16.5 7.5a6.4 6.4 0 0 1 0 9M4.6 4.6a10.5 10.5 0 0 0 0 14.8M19.4 4.6a10.5 10.5 0 0 1 0 14.8"/></svg>',
    results: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20V4M4 20h16M8 16v-4M12 16V8M16 16v-6"/></svg>',
    filter: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/></svg>'
  };

  /* ---------- chrome: mockup pill, header, ticker, tabs ---------- */
  function topHTML() {
    var D = S.D;
    return '<header class="cd-top"><div class="cd-brand">' + logo() + '<span class="cd-brand-t">Trend Bettors<small>Command ' + demoTag() + '</small></span></div>' +
      '<div class="cd-top-meta"><b>' + esc(dateTxt(D.date)) + '</b><span>Pull ' + esc(pullTxt()) + '</span></div></header>';
  }
  function demoBarHTML() {
    if (!S.live) return '';
    return '<div class="cd-demobar" role="note"><b>DEMO</b><span>Simulated night at ' + esc(clockTxt(S.D.date + 'T' + SIM_CLOCK + '-05:00')) + '. Scores, stat lines and W/L are made up. Lines, prices, edges and records are the real ' + esc(pullTxt()) + ' pull.</span></div>';
  }
  function tabsHTML() {
    var names = { board: 'Board', live: 'Live', results: 'Results' };
    var h = '<nav class="cd-tabs" aria-label="Sections"><div class="cd-tabs-in" role="tablist" data-at="' + TABS.indexOf(S.tab) + '">';
    TABS.forEach(function (t) {
      var on = S.tab === t;
      h += '<button type="button" role="tab" class="cd-tab' + (on ? ' cd-on' : '') + '" data-act="tab" data-v="' + t + '" aria-selected="' + on + '">' + ICON[t] + '<span>' + names[t] + '</span>' + (t === 'live' && S.live ? '<i class="cd-tab-dot" aria-label="Demo live"></i>' : '') + '</button>';
    });
    h += '<i class="cd-tabglow" aria-hidden="true"><i class="cd-trail"></i></i>';
    return h + '</div></nav>';
  }

  /* ---------- Board ---------- */
  /* Cap meter: my tailed + faded units today against the daily cap. The state is a word, not just a color. */
  function capState(used, cap) {
    var f = cap > 0 ? used / cap : 0;
    if (f > 1 + 1e-9) return { k: 'red', w: 'Over cap by ' + unitsTxt(used - cap) };
    if (f >= 0.8 - 1e-9) return { k: 'amber', w: f >= 1 - 1e-9 ? 'At cap' : 'Near cap' };
    return { k: 'ok', w: 'Under cap' };
  }
  function capHTML() {
    var D = S.D, used = todayUnits(), c = { tail: 0, fade: 0 }, picks = cardPicks(), passed = 0;
    picks.forEach(function (p) { var b = betOf(p.bid); if (!b) passed++; else c[isFade(b, p) ? 'fade' : 'tail']++; });
    var frac = used / D.capUnits, left = D.capUnits - used, st = capState(used, D.capUnits);
    return '<section class="cd-cap cd-panel cd-cap-' + st.k + '" aria-label="Unit cap">' + reactor(frac, used, D.capUnits) + '<div class="cd-cap-main"><span class="cd-lbl">My units</span>' +
      '<span class="cd-cap-v" id="cd-cap-v">' + cu(used, 2, '', '') + '<small> / ' + num(D.capUnits, 2) + 'u today</small></span>' +
      '<span class="cd-cap-s"><b class="cd-cap-w">' + st.w + '</b>' + (left > 0 ? ' · ' + num(left, 2) + 'u left' : '') + '<br>Tailed ' + c.tail + ' · Faded ' + c.fade + ' · Passed ' + passed + '</span></div>' +
      /* round 3's Pull box is gone: the pull time is in the header and the pick count is in the line under "Rated board" */
      '</section>';
  }
  function liveStrip(p, s) {
    if (s.st === 'pre') return S.live ? '<span class="cd-rlive cd-tr-pre"><span class="cd-rl-st">Not started · ' + esc(p.kick) + '</span></span>' : '';
    var c = stateCls(s), when = s.st === 'live' ? '<i class="cd-dot cd-pulse"></i>' + esc(s.clock) : (s.early ? 'Line crossed' : 'Final');
    return '<span class="cd-rlive cd-tr-' + c + '"><span class="cd-rl-st">' + when + '</span><span class="cd-rl-v"><b>' + s.stat + '</b> / ' + num(p.line) + '</span><em>' + stateWord(s) + '</em>' + bar(s.stat / p.line * 100) + '</span>';
  }
  function rowHTML(p, i) {
    var s = pickState(p), open = S.open === p.bid, moved = p.line !== p.line8, alt = p.best && p.best.book && p.best.book !== 'draftkings';
    var gap = p.proj - p.line, id = 'cd-d-' + S.card + p.rank, am = p.card === 'am', eL = am ? '8 AM edge' : '2 PM edge';
    var hero = i === 0 && p.rank === topRank();
    var h = '<article class="cd-row cd-panel cd-st-' + s.st + (p.units > 0 ? ' cd-bet' : ' cd-trk') + (open ? ' cd-open' : '') + (hero ? ' cd-hero' : '') + '" data-bid="' + esc(p.bid) + '" data-i="' + Math.min(i, 12) + '">';
    if (hero) h += '<i class="cd-foil" aria-hidden="true"></i>';
    h += '<button type="button" class="cd-rowb" data-act="row" data-v="' + esc(p.bid) + '" aria-expanded="' + open + '" aria-controls="' + id + '">';
    if (hero) h += heroInner(p); else {
    h += '<span class="cd-rk"><span class="cd-sr">Rank </span>' + p.rank + '</span>';
    h += '<span class="cd-rmain"><span class="cd-rname"><b>' + esc(p.name) + '</b><i>' + esc(p.team) + '</i>' + sportTag(p.sport) + '</span>';
    h += '<span class="cd-rpick"><b>' + esc(p.side) + ' ' + num(p.line) + '</b> ' + esc(p.market) + '</span>';
    h += '<span class="cd-rmeta">' + tierChip(p) + '<span class="cd-rproj">Proj <b>' + num(p.proj) + '</b></span>' + alsoTag(p) + (p.note ? '<span class="cd-flag" title="News flag">News</span>' : '') + '</span>' + pmLine(p) + '</span>';
    h += '<span class="cd-redge"><b>' + pctTxt(p.edge) + '</b><small>' + eL + '</small><i class="cd-chev" aria-hidden="true"></i></span>';
    }
    h += liveStrip(p, s) + '</button>' + actHTML(p);
    h += '<div class="cd-rdet" id="' + id + '"><div class="cd-rdet-in"><dl class="cd-dl">';
    h += dd('Model projection', num(p.proj) + ' <small>' + signed(gap) + ' vs line</small>');
    h += dd('Model chance', num(p.P) + '%');
    h += dd('Model EV, 8 AM price', pctTxt(p.ev8));
    h += dd(am ? 'Edge, 8 AM price' : 'Edge, 2 PM price', pctTxt(p.edge));
    h += dd('DraftKings price' + (am ? ', 8 AM' : ''), price(p.dk));
    h += dd('Best price', alt ? '<span class="cd-pos">' + price(p.best.price) + '</span> <small>' + esc(book(p.best.book)) + '</small>' : price(p.dk) + ' <small>DraftKings</small>');
    if (am) h += dd('At 2 PM', p.pm ? num(p.pm.line) + (p.pm.dk != null ? ' <small>' + price(p.pm.dk) + '</small>' : '') : '<small>Not on the 2 PM card</small>');
    else h += dd('Line at 8 AM', num(p.line8) + (moved ? ' <small class="cd-amber">now ' + num(p.line) + '</small>' : ' <small>unchanged</small>'));
    h += dd('Other side, DraftKings', p.dkOther != null ? price(p.dkOther) + ' <small>' + otherSide(p.side) + '</small>' : '<small>No price at this pull</small>');
    h += dd('Tier and units', p.units > 0 ? esc(p.tier) + ' · ' + unitsTxt(p.units) : 'Tracked, 0u');
    h += '</dl>';
    if (p.note) h += '<p class="cd-note"><b>News flag</b>' + esc(cap1(p.note)) + '</p>';
    h += '<button type="button" class="cd-btn cd-btn-ghost" data-act="togame" data-v="' + esc(p.gid) + '">' + esc(gameLabel(p.game)) + ' · ' + esc(p.kick) + '<span>Open in Live</span></button>';
    return h + '</div></div></article>';
  }
  function dd(k, v) { return '<div><dt>' + k + '</dt><dd>' + v + '</dd></div>'; }
  function cardSwitch() {
    var n = function (list) { return list.filter(function (p) { return p.units > 0; }).length; };
    var h = '<div class="cd-seg cd-cseg" role="group" aria-label="Card shown">';
    [['pm', '2 PM card', n(S.D.top20)], ['am', '8 AM picks', n(S.D.am)]].forEach(function (o) {
      h += '<button type="button" class="cd-segb' + (S.card === o[0] ? ' cd-on' : '') + '" data-act="card" data-v="' + o[0] + '" aria-pressed="' + (S.card === o[0]) + '">' + o[1] + '<i>' + o[2] + '</i></button>';
    });
    return h + '</div>';
  }
  function boardHTML() {
    var T = cur(), am = S.card === 'am', f = S.f, list = sorted(T.filter(function (p) { return match(p, f); }), f.sort), n = activeCount(f);
    var h = '<div class="cd-view cd-v-board">' + capHTML() + cardSwitch();
    h += '<div class="cd-tools"><div class="cd-tools-t"><h2 class="cd-h">' + (am ? '8 AM picks ' : 'Rated board ') + demoTag() + '</h2><span class="cd-sub" aria-live="polite">Showing ' + list.length + ' of ' + T.length + ' · Sorted by ' + (f.sort === 'rank' ? 'rank' : label(SORTS, f.sort).toLowerCase()) + '</span></div>';
    h += '<button type="button" class="cd-btn cd-filterb' + (n ? ' cd-on' : '') + '" data-act="sheet-open" aria-haspopup="dialog">' + ICON.filter + '<span>Filter</span>' + (n ? '<b class="cd-badge" aria-label="' + n + ' active">' + n + '</b>' : '') + '</button></div>';
    if (n) {
      h += '<div class="cd-active" aria-label="Active filters">';
      FKEYS.forEach(function (k) { if (f[k]) h += '<button type="button" class="cd-achip" data-act="fclear" data-k="' + k + '" aria-label="Remove filter ' + esc(filterLabel(k, f[k])) + '"><span>' + esc(filterLabel(k, f[k])) + '</span><i aria-hidden="true">×</i></button>'; });
      h += '</div>';
    }
    h += '<div class="cd-rows">';
    if (!T.length) h += '<div class="cd-empty cd-panel"><b>' + (am ? 'No 8 AM picks today.' : 'Nothing on the 2 PM board yet.') + '</b></div>';
    else if (!list.length) h += '<div class="cd-empty cd-panel"><b>No picks match these filters.</b><span>' + plural(T.length, 'pick') + ' on this card today.</span><button type="button" class="cd-btn" data-act="freset">Reset filters</button></div>';
    /* round 5: one labeled break between the card picks and the 0u pool, when the sort keeps the two apart (hidden in h0) */
    var nb = list.filter(function (p) { return p.units > 0; }).length, split = nb > 0 && nb < list.length && list.slice(0, nb).every(function (p) { return p.units > 0; });
    list.forEach(function (p, i) {
      if (split && i === nb) h += '<h3 class="cd-pool-h"><b>Rest of the board</b><span>' + plural(list.length - nb, 'pick') + ' · tracked, 0u</span></h3>';
      h += rowHTML(p, i);
    });
    h += '</div>';
    if (am) h += '<p class="cd-foot">Prices here are the 8 AM DraftKings prices. A pick on both cards is one bet: Tail or Fade it on either card and both show it.</p>';
    else if (T.length < 20) h += '<p class="cd-foot">' + (20 - T.length) + ' open slots. Only ' + T.length + ' picks cleared the bar at the ' + esc(pullTxt()) + ' pull, so the list stops there. Tracked rows carry no units, so there is nothing to Tail or Fade.</p>';
    return h + '</div>';
  }

  /* ---------- Live ---------- */
  function pickLine(p) {
    var s = pickState(p), c = stateCls(s);
    var h = '<div class="cd-lp cd-tr-' + c + '"><span class="cd-lp-m"><i>#' + p.rank + '</i><b>' + esc(shortStat(p)) + '</b> ' + esc(p.side) + ' ' + num(p.line) + (p.units > 0 ? ' <span class="cd-lp-u">' + unitsTxt(p.units) + '</span>' : '') + '</span>';
    if (s.st === 'pre') return h + '<span class="cd-lp-v">Proj <b>' + num(p.proj) + '</b></span><em>' + pctTxt(p.edge) + '</em></div>';
    return h + '<span class="cd-lp-v"><b>' + s.stat + '</b> / ' + num(p.line) + '</span><em>' + stateWord(s) + '</em>' + bar(s.stat / p.line * 100) + '</div>';
  }
  function gamePicksHTML(picks) {
    var groups = [], seen = {};
    picks.forEach(function (p) { var k = pid(p); if (!seen[k]) { seen[k] = { pl: players()[k], picks: [] }; groups.push(seen[k]); } seen[k].picks.push(p); });
    return groups.map(function (g) {
      var sl = statLine(g.pl);
      return '<div class="cd-pl"><div class="cd-pl-h"><b>' + esc(g.pl.name) + '</b><i>' + esc(g.pl.team) + '</i>' +
        (sl ? '<span class="cd-pl-sl" aria-label="Simulated stat line">' + sl.map(function (x) { return '<b>' + x[1] + '</b> ' + x[0]; }).join('<i>·</i>') + '</span>' : '') + '</div>' + g.picks.map(pickLine).join('') + '</div>';
    }).join('');
  }
  function gameHTML(g, picks, gi) {
    var gs = gameState(g), has = picks.length > 0, open = has && (S.gopen === g.gid || (S.live && gs.st === 'live' && S.gopen !== '!' + g.gid));
    var fav = g.fav === 'A' ? g.away : g.fav === 'B' ? g.home : '';
    var hw = g.winHome >= 50, d = g.sport === 'NHL' ? 2 : 1;
    var when = gs.st === 'pre' ? (gs.started ? 'Started ' + g.kick : g.kick) : gs.clock;
    var stWord = gs.st === 'live' ? 'Live' : gs.st === 'final' ? 'Final' : gs.started ? 'Started' : 'Pre-game';
    var tag = has ? 'button' : 'div', id = 'cd-gp-' + g.gid;
    var h = '<article class="cd-g cd-panel cd-g-' + gs.st + (has ? ' cd-g-has' : '') + (open ? ' cd-open' : '') + '" data-gid="' + g.gid + '" data-i="' + Math.min(gi || 0, 12) + '">';
    h += '<' + tag + (has ? ' type="button" data-act="gopen" data-v="' + g.gid + '" aria-expanded="' + open + '" aria-controls="' + id + '"' : '') + ' class="cd-g-head">';
    h += '<span class="cd-g-top">' + sportTag(g.sport) + '<span class="cd-g-st cd-g-st-' + gs.st + '">' + (gs.st === 'live' ? '<i class="cd-dot cd-pulse"></i>' : '') + stWord + '</span><span class="cd-g-when">' + esc(gs.st === 'final' ? g.kick : when) + '</span></span>';
    h += '<span class="cd-g-teams"><span class="cd-g-t' + (gs.st !== 'pre' && gs.a > gs.h ? ' cd-lead' : '') + '">' + g.away + (gs.st !== 'pre' ? '<b>' + gs.a + '</b>' : '') + '</span><i>@</i><span class="cd-g-t' + (gs.st !== 'pre' && gs.h > gs.a ? ' cd-lead' : '') + '">' + g.home + (gs.st !== 'pre' ? '<b>' + gs.h + '</b>' : '') + '</span></span>';
    h += '<span class="cd-g-line"><span>' + (fav && g.spread ? fav + ' -' + num(+g.spread) + ' · ' : '') + 'Total ' + num(+g.total) + '</span><span>Model ' + num(g.projAway, d) + ' – ' + num(g.projHome, d) + '</span></span>';
    h += '<span class="cd-g-wpl"><span>' + g.away + ' ' + num(100 - g.winHome) + '%</span><span>Model win chance</span><span>' + g.home + ' ' + num(g.winHome) + '%</span></span>';
    h += '<i class="cd-g-wp' + (hw ? ' cd-g-wp-h' : '') + '"><i data-w="' + (100 - g.winHome).toFixed(1) + '"></i></i>';
    if (has) {
      var sum = '';
      if (gs.st !== 'pre') { var c = { w: 0, l: 0, ok: 0, risk: 0 }; picks.forEach(function (p) { c[stateCls(pickState(p))]++; }); sum = [c.w ? c.w + ' won' : '', c.l ? c.l + ' lost' : '', c.ok ? c.ok + ' on track' : '', c.risk ? c.risk + ' at risk' : ''].filter(Boolean).join(' · '); }
      h += '<span class="cd-g-n"><b>' + plural(picks.length, 'board pick') + '</b>' + (sum ? '<span>' + sum + '</span>' : '') + '<i class="cd-chev" aria-hidden="true"></i></span>';
    }
    h += '</' + tag + '>';
    if (has) h += '<div class="cd-g-picks" id="' + id + '"><div class="cd-g-picks-in">' + gamePicksHTML(picks) + '</div></div>';
    return h + '</article>';
  }
  function tile(l, v, cls) { return '<div class="cd-tile cd-panel' + (cls ? ' ' + cls : '') + '"><b>' + v + '</b><span>' + l + '</span></div>'; }
  function liveHTML() {
    var D = S.D, byG = {}, cnt = {};
    D.top20.forEach(function (p) { (byG[p.gid] = byG[p.gid] || []).push(p); });
    D.games.forEach(function (g) { cnt[g.sport] = (cnt[g.sport] || 0) + 1; });
    var withPicks = D.games.filter(function (g) { return byG[g.gid]; }).length;
    var list = D.games.filter(function (g) { return (!S.gsport || g.sport === S.gsport) && (!S.gpicks || byG[g.gid]); });
    var ord = { live: 0, pre: 1, final: 2 };
    list.sort(function (a, b) { return (S.live ? ord[gameState(a).st] - ord[gameState(b).st] : 0) || new Date(a.kickoff) - new Date(b.kickoff); });
    var h = '<div class="cd-view cd-v-live"><div class="cd-vhead"><div><h2 class="cd-h">' + (S.live ? 'Live night ' + demoTag() : 'Tonight') + '</h2><span class="cd-sub">' + (S.live ? 'Board picks tracked against simulated stat lines' : 'Start times and model numbers from the ' + esc(pullTxt()) + ' pull · live scores come in the next piece') + '</span></div>';
    h += '</div>';   // closes cd-vhead (the demo button is gone)
    h += radarHTML(byG);
    h += '<div class="cd-tiles">';
    if (S.live) {
      var c = { w: 0, l: 0, live: 0, pre: 0 };
      D.top20.forEach(function (p) { c[pickState(p).st]++; });
      h += tile('Won', cu(c.w, 0), 'cd-tile-w') + tile('Lost', cu(c.l, 0), 'cd-tile-l') + tile((c.live ? '<i class="cd-dot cd-pulse"></i>' : '') + 'Live', cu(c.live, 0), 'cd-tile-live') + tile('Not started', cu(c.pre, 0));
    } else {
      h += tile('Games', cu(D.games.length, 0)) + tile('With picks', cu(withPicks, 0)) + tile('Board picks', cu(D.top20.length, 0)) + tile('First start', esc(D.games.slice().sort(function (a, b) { return new Date(a.kickoff) - new Date(b.kickoff); })[0].kick.replace(' ET', '').replace(':00', '')));
    }
    h += '</div><div class="cd-seg cd-gseg" role="group" aria-label="Games shown">';
    [['', 'All', D.games.length]].concat(Object.keys(cnt).map(function (k) { return [k, k, cnt[k]]; })).forEach(function (o) {
      h += '<button type="button" class="cd-segb' + (S.gsport === o[0] ? ' cd-on' : '') + '" data-act="gsport" data-v="' + o[0] + '" aria-pressed="' + (S.gsport === o[0]) + '">' + o[1] + '<i>' + o[2] + '</i></button>';
    });
    h += '<button type="button" class="cd-segb cd-seg-gap' + (S.gpicks ? ' cd-on' : '') + '" data-act="gpicks" aria-pressed="' + S.gpicks + '">Picks only<i>' + withPicks + '</i></button></div>';
    h += '<div class="cd-glist">';
    if (!list.length) h += '<div class="cd-empty cd-panel"><b>No games match.</b><button type="button" class="cd-btn" data-act="gsport" data-v="">Show all games</button></div>';
    list.forEach(function (g, gi) { h += gameHTML(g, byG[g.gid] || [], gi); });
    return h + '</div></div>';
  }

  /* ---------- Results ---------- */
  function spark(daily) {
    if (!daily || !daily.length) return '';
    var max = Math.max.apply(null, daily.map(function (d) { return Math.abs(d.roi || 0); })) || 1;
    var h = '<div class="cd-days" role="img" aria-label="Daily ROI, ' + daily.length + ' graded days"><span class="cd-lbl">Daily ROI</span><div class="cd-days-in">';
    daily.forEach(function (d) {
      var pos = (d.roi || 0) >= 0, hgt = Math.max(6, Math.abs(d.roi || 0) / max * 100);
      h += '<div class="cd-day ' + (pos ? 'cd-day-pos' : 'cd-day-neg') + '"><span class="cd-day-v">' + signed(d.roi) + '%</span><i class="cd-day-b"><i data-h="' + hgt.toFixed(0) + '"></i></i><span class="cd-day-d">' + md(d.d) + '</span><span class="cd-day-r">' + d.W + '-' + d.L + '</span></div>';
    });
    return h + '</div></div>';
  }
  function stat(l, v, cls, extra) { return '<div class="cd-stat' + (cls ? ' ' + cls : '') + '"><span class="cd-lbl">' + l + '</span><b>' + v + '</b>' + (extra || '') + '</div>'; }
  function recHTML(sp, r, ri) {
    var since = r.since || SINCE_FALLBACK[sp], p = r[S.per], empty = !r.season || !r.season.n;
    var cls = function (x) { return x > 0 ? 'cd-pos' : x < 0 ? 'cd-neg' : ''; };
    var h = '<article class="cd-rec cd-panel' + (empty ? ' cd-rec-empty' : '') + '" data-i="' + (ri || 0) + '"><header class="cd-rec-h">' + sportTag(sp) + '<span class="cd-rec-m">Official model ' + esc(r.model) + '</span><span class="cd-rec-since">Since ' + (since ? md(since) : '—') + '</span></header>';
    if (empty) return h + '<div class="cd-rec-none"><b>No graded picks yet</b><span>The first grades land after tonight. Nothing to show until then.</span></div></article>';
    if (!p || !p.n) h += '<div class="cd-rec-none"><b>No graded picks ' + (S.per === 'lastNight' ? 'last night' : 'in this window') + '</b><span>Switch the window above to see ' + sp + ' results.</span></div>';
    else {
      var rec = p.W + '-' + p.L + (p.P ? '-' + p.P : '');
      h += '<div class="cd-rec-top">' + ring(p.hit / 100, num(p.hit) + '%', 'Win rate ' + num(p.hit) + '%', p.hit >= 50 ? 'cd-ring-pos' : 'cd-ring-neg') + '<div class="cd-rec-wl"><span class="cd-lbl">Record · Win %</span><b>' + rec + '</b><small>' + p.n + ' graded picks</small></div></div>';
      h += '<div class="cd-stats">' + stat('ROI', cu(p.roi, 1, p.roi > 0 ? '+' : '', '%'), cls(p.roi)) + stat('Units', cu(p.units, 1, p.units > 0 ? '+' : '', 'u'), cls(p.units)) + stat('Beat the close', cu(p.beat, 1, '', '%'), '') + '</div>';
    }
    return h + spark(r.daily) + '</article>';
  }
  function resultsHTML() {
    var R = S.D.records;
    var h = '<div class="cd-view cd-v-results"><div class="cd-vhead"><div><h2 class="cd-h">Results</h2><span class="cd-sub">The official model record next to what I tailed and what I faded.</span></div></div>';
    h += '<div class="cd-seg cd-pseg" role="group" aria-label="Window">';
    PERS.forEach(function (o) { h += '<button type="button" class="cd-segb' + (S.per === o[0] ? ' cd-on' : '') + '" data-act="per" data-v="' + o[0] + '" aria-pressed="' + (S.per === o[0]) + '">' + o[1] + '</button>'; });
    h += '</div>' + splitHTML() + '<div class="cd-recs">';
    Object.keys(R).forEach(function (sp, ri) { h += recHTML(sp, R[sp], ri + 1); });
    return h + '</div><p class="cd-foot">Beat the close is the share of picks where the closing line or price moved toward the model side.</p></div>';
  }

  /* ---------- filter sheet ---------- */
  function group(key, opts, title) {
    var f = S.draft, h = '<div class="cd-fgroup"><span class="cd-flabel" id="cd-l-' + key + '">' + title + '</span><div class="cd-chips" role="group" aria-labelledby="cd-l-' + key + '">';
    opts.forEach(function (o) {
      var on = f[key] === o[0], off = o[2] === 0;
      h += '<button type="button" class="cd-fchip' + (on ? ' cd-on' : '') + '" data-act="fset" data-k="' + key + '" data-v="' + esc(o[0]) + '" aria-pressed="' + on + '"' + (off ? ' disabled' : '') + '>' + esc(o[1]) + (o[2] != null ? '<i>' + o[2] + '</i>' : '') + '</button>';
    });
    return h + '</div></div>';
  }
  function sheetBodyHTML() {
    var T = cur(), f = S.draft;
    var sp = countBy(function (p) { return p.sport; }), tk = countBy(tierKey), sd = countBy(function (p) { return p.side; }), mk = countBy(function (p) { return p.market; });
    var bets = T.filter(function (p) { return p.units > 0; }).length;
    var sports = [['', 'All']].concat(Object.keys(S.D.records).map(function (k) { return [k, k, sp[k] || 0]; }));
    var tiers = [['', 'All']];
    ['T1', 'T2', 'T3', 'NHL'].forEach(function (t) { if (tk[t]) tiers.push([t, t, tk[t]]); });
    var markets = [['', 'All']].concat(Object.keys(mk).sort().map(function (m) { return [m, m, mk[m]]; }));
    var games = [['', 'All']], seen = {};
    sorted(T, 'kick').forEach(function (p) { if (!seen[p.gid]) { seen[p.gid] = 1; games.push([p.gid, gameLabel(p.game) + ' ' + p.kick.replace(' ET', ''), T.filter(function (x) { return x.gid === p.gid; }).length]); } });
    var maxEdge = Math.ceil(Math.max.apply(null, T.map(function (p) { return p.edge; })));
    var minP = Math.floor(Math.min.apply(null, T.map(function (p) { return p.P; }))), maxP = Math.ceil(Math.max.apply(null, T.map(function (p) { return p.P; })));
    var h = group('sort', SORTS, 'Sort by');
    h += '<div class="cd-fgroup"><label class="cd-flabel" for="cd-q">Player, team or game</label><input id="cd-q" class="cd-input" type="search" data-f="q" placeholder="Search, for example Strus or DAL" value="' + esc(f.q) + '" autocomplete="off" enterkeyhint="search"></div>';
    h += group('sport', sports, 'Sport');
    h += group('stake', [['', 'All'], ['bet', 'With units', bets], ['trk', 'Tracked only', T.length - bets]], 'Units');
    h += group('tier', tiers, 'Tier');
    if (S.live) h += group('status', [['', 'All'], ['pre', 'Not started'], ['live', 'Live'], ['w', 'Won'], ['l', 'Lost']], 'Status <span class="cd-demo">DEMO</span>');
    h += group('side', [['', 'All'], ['Over', 'Over', sd.Over || 0], ['Under', 'Under', sd.Under || 0]], 'Side');
    h += group('market', markets, 'Market');
    h += group('game', games, 'Game');
    h += '<div class="cd-fgroup"><label class="cd-flabel" for="cd-fe">Minimum 2 PM edge <output id="cd-fe-out">' + (f.edge ? pctTxt(f.edge) : 'Any') + '</output></label><input id="cd-fe" type="range" class="cd-range" data-f="edge" min="0" max="' + maxEdge + '" step="0.25" value="' + f.edge + '"></div>';
    h += '<div class="cd-fgroup"><label class="cd-flabel" for="cd-fc">Minimum model chance <output id="cd-fc-out">' + (f.chance ? num(f.chance) + '%' : 'Any') + '</output></label><input id="cd-fc" type="range" class="cd-range" data-f="chance" min="' + minP + '" max="' + maxP + '" step="0.5" value="' + (f.chance || minP) + '"></div>';
    return h;
  }
  function draftCount() { var f = S.draft; return cur().filter(function (p) { return match(p, f); }).length; }
  function sheetHTML() {
    return '<div class="cd-scrim" data-act="sheet-close"></div><section class="cd-sheet" id="cd-sheet" role="dialog" aria-modal="true" aria-labelledby="cd-sheet-t" tabindex="-1">' +
      '<div class="cd-grab" data-drag="1"><i class="cd-handle" aria-hidden="true"></i><div class="cd-sheet-h"><h2 class="cd-h" id="cd-sheet-t"></h2><span class="cd-sub" id="cd-sheet-n"></span><button type="button" class="cd-x" data-act="sheet-close" aria-label="Close">×</button></div></div>' +
      '<div class="cd-sheet-body" id="cd-sheet-body"></div>' +
      '<div class="cd-sheet-foot" id="cd-sheet-foot"></div></section>';
  }
  function syncSheet() {
    var n = draftCount(), a = activeCount(S.draft);
    if (S.sheet !== 'filter') return;
    document.getElementById('cd-apply').textContent = 'Apply · ' + plural(n, 'pick');
    document.getElementById('cd-sheet-n').textContent = a ? plural(a, 'filter') + ' on' : 'No filters on';
  }
  /* One sheet shell, two uses: 'filter' (round 3's) and 'bet' (Tail / Fade).
     armed: a finger tap that opens the sheet is followed by a click that lands on whatever is now under the finger (the new
     backdrop or a sheet button). So nothing in the sheet or its backdrop reacts until a fresh press starts on it. */
  var sheetArmed = false, sheetFrom = null;
  function showSheet(kind, title, foot) {
    S.sheet = kind; sheetArmed = false;
    document.getElementById('cd-sheet-t').textContent = title;
    document.getElementById('cd-sheet-n').textContent = '';
    document.getElementById('cd-sheet-foot').innerHTML = foot;
    document.getElementById('cd-sheet-body').scrollTop = 0;
    document.body.classList.add('cd-sheet-open');
    var sh = document.getElementById('cd-sheet'); sh.style.transform = ''; sh.setAttribute('data-kind', kind);
    try { sh.focus({ preventScroll: true }); } catch (e) { /* older browsers */ }
  }
  function openSheet() {
    S.draft = copy(S.f); S.bs = null;
    document.getElementById('cd-sheet-body').innerHTML = sheetBodyHTML();
    showSheet('filter', 'Filter and sort', '<button type="button" class="cd-btn cd-btn-ghost" data-act="sheet-reset">Reset</button><button type="button" class="cd-btn cd-btn-main" data-act="sheet-apply" id="cd-apply">Apply</button>');
    syncSheet();
  }
  function closeSheet(apply) {
    if (!S.sheet) return;
    var kind = S.sheet, bs = S.bs;
    S.sheet = ''; S.bs = null;
    document.body.classList.remove('cd-sheet-open');
    document.getElementById('cd-sheet').style.transform = '';
    if (kind === 'filter' && apply) { S.f = copy(S.draft); renderView(false); }
    S.draft = null;
    var back = kind === 'bet' && bs ? rowEl(bs.bid) && rowEl(bs.bid).querySelector('.cd-act button:not(:disabled)') : app.querySelector('.cd-filterb');
    if (back) try { back.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
  }
  document.addEventListener('pointerdown', function (e) {
    if (S.sheet && e.target.closest && e.target.closest('.cd-sheet,.cd-scrim')) sheetArmed = true;
  }, true);

  /* =====================================================================
     Round 4: Tail / Fade. Storage is app/mybets.js, untouched: one bet per bid, id = the pick's bid.
     Tailed vs Faded is never stored. It is read back from the side: stored side == the model's side -> Tailed, else Faded.
     ===================================================================== */
  function rowsOf(card) { return (card === 'am' ? S.D.am : S.D.top20) || []; }
  function cur() { return rowsOf(S.card); }
  function allRows() { return rowsOf('pm').concat(rowsOf('am')); }
  /* today's card picks (units > 0), one per bid: the 2 PM row first, then 8 AM picks that fell off the 2 PM card */
  function cardPicks() {
    var seen = {}, out = [];
    allRows().forEach(function (p) { if (p.units > 0 && !seen[p.bid]) { seen[p.bid] = 1; out.push(p); } });
    return out;
  }
  function pickOf(bid, card) {
    var find = function (list) { for (var i = 0; i < list.length; i++) if (list[i].bid === bid) return list[i]; return null; };
    return find(rowsOf(card || S.card)) || find(allRows());
  }
  function rowEl(bid) { var els = app.querySelectorAll('.cd-row'); for (var i = 0; i < els.length; i++) if (els[i].dataset.bid === bid) return els[i]; return null; }
  function sideCode(side) { return side === 'Over' ? 'o' : 'u'; }
  function sideWord(code) { return code === 'o' ? 'Over' : 'Under'; }
  function otherSide(side) { return side === 'Over' ? 'Under' : 'Over'; }
  function betOf(bid) { return mem.bets[bid] || null; }
  /* The model's side for a saved bet: today's pick when we have it, else the side letter the slate bet id ends with. */
  function modelSide(b) {
    if (!b || b.type !== 'prop') return '';
    var p = b.date === S.D.date ? pickOf(b.id) : null;
    if (p) return sideCode(p.side);
    var m = /-([ou])$/.exec(b.id);
    return m ? m[1] : '';
  }
  function isFade(b, p) { return b.side !== (p ? sideCode(p.side) : modelSide(b)); }
  function isMine(b) { return !!modelSide(b) && (b.side === 'o' || b.side === 'u'); }
  function r2(v) { return Math.round(v * 100) / 100; }
  function todayUnits(skipId) {
    var u = 0;
    Object.keys(mem.bets).forEach(function (id) { var b = mem.bets[id]; if (id !== skipId && b.date === S.D.date && b.status !== 'void' && isMine(b)) u += b.units; });
    return r2(u);
  }
  function betWords(p, fade) { var side = fade ? otherSide(p.side) : p.side; return p.name + ' ' + side + ' ' + p.line + ' ' + p.market; }
  /* Same fields, same order as the app's newBet (app/app.js), so cleanBet hands it back unchanged. */
  function makeBet(p, fade, units, odds) {
    var g = gameById(p.gid) || {}, parts = String(p.game || '').split('@');
    var away = g.away || parts[0] || '', home = g.home || parts[1] || '', side = fade ? otherSide(p.side) : p.side, def = fade ? p.dkOther : p.dk;
    var b = {
      id: p.bid, sport: String(p.sport).toLowerCase(), date: S.D.date, gid: String(p.gid), type: 'prop', market: p.stat, side: sideCode(side), line: p.line, odds: odds, units: units,
      label: betWords(p, fade), team: p.team || '', opp: p.team === away ? home : p.team === home ? away : '',
      addedAt: new Date().toISOString(), oddsEdited: odds !== def, status: 'open', settledAt: '', pl: 0
    };
    if (p.pid != null && p.pid !== '') b.pid = p.pid;
    if (p.kickoff) b.start = p.kickoff;
    if (away) b.away = away;
    if (home) b.home = home;
    return b;
  }
  /* every write goes through MyBets.commit (re-reads storage, applies one change by id). Not written = nothing changes here. */
  function commitOps(ops) {
    if (!MB) return false;
    var r;
    try { r = MB.commit(mem, ops); } catch (e) { return false; }
    if (!r || !r.ok) return false;
    mem = r.store;
    return true;
  }
  var toastT = 0;
  function toast(msg) {
    var el = document.getElementById('cd-toast');
    if (!el) { el = document.createElement('div'); el.id = 'cd-toast'; el.className = 'cd-toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.textContent = msg; void el.offsetWidth; el.classList.add('cd-show');
    clearTimeout(toastT); toastT = setTimeout(function () { el.classList.remove('cd-show'); }, 3000);
  }
  function pop(bid) {
    if (REDUCED) return;
    var row = rowEl(bid), els = [row && row.querySelector('.cd-act'), document.getElementById('cd-cap-v')];
    els.forEach(function (el) { if (!el) return; el.classList.remove('cd-pop'); void el.offsetWidth; el.classList.add('cd-pop'); });
  }

  /* row pieces */
  function alsoTag(p) { return p.card === 'pm' && p.onAm ? '<span class="cd-also">Also 8 AM</span>' : ''; }
  function pmLine(p) {
    if (p.card !== 'am') return '';
    if (!p.pm) return '<span class="cd-rpm cd-rpm-off">Not on the 2 PM card</span>';
    return '<span class="cd-rpm' + (p.pm.onCard ? '' : ' cd-rpm-off') + '">2 PM: ' + p.side.charAt(0) + ' ' + num(p.pm.line) + (p.pm.dk != null ? ' ' + price(p.pm.dk) : '') + ' · ' + (p.pm.onCard ? 'on the card' : 'not on the card') + '</span>';
  }
  function mineTxt(b, fade) { return '<b>' + (fade ? 'Faded' : 'Tailed') + '</b> ' + unitsTxt(b.units) + ' @ ' + price(b.odds); }
  function actHTML(p) {
    if (!(p.units > 0)) return '';
    var b = betOf(p.bid), bid = esc(p.bid), h = '<div class="cd-act">';
    if (b && isMine(b)) {
      var fade = isFade(b, p), open = b.status === 'open', moved = b.line !== p.line;
      h += '<span class="cd-mine cd-mine-' + (fade ? 'fade' : 'tail') + '">' + mineTxt(b, fade) + '</span>';
      if (open) h += '<button type="button" class="cd-minib" data-act="bet-edit" data-v="' + bid + '" aria-label="Edit my bet on ' + esc(p.name) + '">Edit</button><button type="button" class="cd-minib" data-act="bet-undo" data-v="' + bid + '" aria-label="Undo my bet on ' + esc(p.name) + '">Undo</button>';
      else h += '<span class="cd-mine-res ' + (b.pl > 0 ? 'cd-pos' : b.pl < 0 ? 'cd-neg' : '') + '">' + (b.status === 'void' ? 'Void' : b.status === 'W' ? 'Won' : b.status === 'L' ? 'Lost' : 'Push') + (b.status === 'void' ? '' : ' ' + signed(b.pl, 2) + 'u') + '</span>';
      if (fade || moved) h += '<span class="cd-act-why">' + esc(sideWord(b.side) + ' ' + num(b.line) + ' ' + p.market) + (moved ? ' · saved at ' + num(b.line) + ', this card shows ' + num(p.line) : '') + '</span>';
      return h + '</div>';
    }
    var noFade = p.dkOther == null, why = 'cd-why-' + S.card + p.rank;
    h += '<button type="button" class="cd-actb cd-actb-tail" data-act="tail" data-v="' + bid + '" aria-haspopup="dialog"><b>Tail</b><small>' + esc(p.side) + ' · ' + unitsTxt(p.units) + ' @ ' + price(p.dk) + '</small></button>';
    h += '<button type="button" class="cd-actb cd-actb-fade" data-act="fade" data-v="' + bid + '" aria-haspopup="dialog"' + (noFade ? ' disabled aria-describedby="' + why + '"' : '') + '><b>Fade</b><small>' + esc(otherSide(p.side)) + (noFade ? ' · no price' : ' · ' + unitsTxt(FADE_UNITS) + ' @ ' + price(p.dkOther)) + '</small></button>';
    if (noFade) h += '<span class="cd-act-why" id="' + why + '">No other-side price at this pull</span>';
    return h + '</div>';
  }

  /* the Tail / Fade sheet */
  function parseUnits(txt) {
    var t = String(txt == null ? '' : txt).trim().replace(',', '.').replace(/u$/i, '');
    if (!/^(\d+\.?\d*|\.\d+)$/.test(t)) return null;
    var n = Math.round(parseFloat(t) / USTEP) * USTEP;
    return n >= UMIN && n <= UMAX ? r2(n) : null;
  }
  function betSheetHTML() {
    var bs = S.bs, p = bs.p, g = gameById(p.gid), where = (g ? g.away + ' @ ' + g.home : gameLabel(p.game)) + ' · ' + p.kick;
    var cardName = p.card === 'am' ? '8 AM' : '2 PM';
    var h = '<div class="cd-bs-bet"><b>' + esc(betWords(p, bs.fade)) + '</b><span>' + esc(where) + '</span>' +
      '<span>' + (bs.fade ? 'The other side of the model pick: ' : 'The model pick: ') + esc(p.side + ' ' + num(p.line)) + ' · ' + esc(p.tier) + ' ' + unitsTxt(p.units) + '</span></div>';
    h += '<div class="cd-fgroup"><label class="cd-flabel" for="cd-bs-u">Units <output>' + (bs.fade ? 'Fade starts at ' + unitsTxt(FADE_UNITS) : 'Rulebook ' + esc(p.tier) + ': ' + unitsTxt(p.units)) + '</output></label>' +
      '<div class="cd-step"><button type="button" class="cd-stepb" data-act="bs-step" data-v="-1" aria-label="Less, a quarter unit">−</button>' +
      '<input id="cd-bs-u" class="cd-input" data-bs="u" inputmode="decimal" autocomplete="off" value="' + num(bs.units, 2) + '" aria-describedby="cd-bs-uerr" aria-invalid="false">' +
      '<button type="button" class="cd-stepb" data-act="bs-step" data-v="1" aria-label="More, a quarter unit">+</button></div>' +
      '<p class="cd-bs-err" id="cd-bs-uerr" role="alert" hidden>Units go from ' + UMIN + ' to ' + UMAX + ', in quarter units.</p></div>';
    h += '<div class="cd-fgroup"><label class="cd-flabel" for="cd-bs-o">Price, American odds <output>' + (bs.def != null ? 'DraftKings ' + cardName + ': ' + price(bs.def) : '') + '</output></label>' +
      '<input id="cd-bs-o" class="cd-input" data-bs="o" inputmode="text" autocomplete="off" autocapitalize="off" spellcheck="false" value="' + esc(bs.oddsTxt) + '" aria-describedby="cd-bs-oerr" aria-invalid="false">' +
      '<p class="cd-bs-err" id="cd-bs-oerr" role="alert" hidden>Enter American odds like -110 or +105.</p></div>';
    return h + '<p class="cd-bs-warn" id="cd-bs-warn" role="status" hidden></p>';
  }
  function oddsIn(o) { o = Math.round(o); return (o > 0 ? '+' : '') + o; }
  function openBet(bid, mode) {
    var p = pickOf(bid); if (!p || !(p.units > 0)) return;
    var prev = betOf(bid), fade, units, def, odds;
    if (prev && isMine(prev)) { if (prev.status !== 'open') return; fade = isFade(prev, p); units = prev.units; odds = prev.odds; def = fade ? p.dkOther : p.dk; }
    else {
      prev = null; fade = mode === 'fade'; def = fade ? p.dkOther : p.dk;
      if (def == null) return;                       // Fade with no other-side price stays off
      units = fade ? FADE_UNITS : p.units; odds = def;
    }
    S.bs = { bid: bid, p: p, fade: fade, prev: prev, units: units, def: def, oddsTxt: oddsIn(odds) };
    S.draft = null;
    document.getElementById('cd-sheet-body').innerHTML = betSheetHTML();
    showSheet('bet', fade ? 'Fade' : 'Tail', '<button type="button" class="cd-btn cd-btn-ghost" data-act="sheet-close">Cancel</button><button type="button" class="cd-btn cd-btn-main" data-act="bs-save" id="cd-bs-save">Save</button>');
    document.getElementById('cd-sheet-n').textContent = prev ? 'Editing my bet' : 'No tap = pass';
    bsWarn();
  }
  function bsErr(which, on) {
    var inp = document.getElementById('cd-bs-' + which), err = document.getElementById('cd-bs-' + which + 'err');
    if (!inp || !err) return;
    err.hidden = !on; inp.setAttribute('aria-invalid', on ? 'true' : 'false');
  }
  /* amber line when this save would push today past the cap. It warns and never blocks. */
  function bsWarn() {
    var bs = S.bs, el = document.getElementById('cd-bs-warn'); if (!bs || !el) return;
    var u = parseUnits(document.getElementById('cd-bs-u').value), cap = S.D.capUnits;
    var tot = u == null ? 0 : r2(todayUnits(bs.bid) + u), over = u != null && tot > cap + 1e-9;
    el.hidden = !over;
    el.textContent = over ? 'Heads up: this puts today at ' + unitsTxt(tot) + ', over the ' + unitsTxt(cap) + ' cap.' : '';
  }
  function bsStep(dir) {
    var inp = document.getElementById('cd-bs-u'), u = parseUnits(inp.value);
    if (u == null) u = S.bs.units;
    u = Math.max(UMIN, Math.min(UMAX, r2(u + dir * USTEP)));
    inp.value = num(u, 2); bsErr('u', false); bsWarn();
  }
  function bsSave() {
    var bs = S.bs; if (!bs) return;
    var ui = document.getElementById('cd-bs-u'), oi = document.getElementById('cd-bs-o');
    var units = parseUnits(ui.value), odds = MB ? MB.parseOdds(oi.value) : null;
    bsErr('u', units == null); bsErr('o', MB && odds === null);
    if (units == null) { ui.focus(); return; }
    if (!MB) { toast('Couldn’t save on this browser'); return; }
    if (odds === null) { oi.focus(); return; }
    var bet = bs.prev ? Object.assign({}, bs.prev, { odds: odds, units: units, oddsEdited: bs.prev.oddsEdited || odds !== bs.prev.odds }) : makeBet(bs.p, bs.fade, units, odds);
    if (!MB.validBet(bet) || !commitOps([{ t: 'set', bet: bet }])) { toast('Couldn’t save on this browser'); return; }   // sheet stays as it was, nothing on the card changes
    var bid = bs.bid;
    closeSheet(false);
    renderView(false); pop(bid);
    var back = rowEl(bid) && rowEl(bid).querySelector('.cd-act button'); if (back) try { back.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
  }
  function undoBet(bid) {
    var b = betOf(bid); if (!b || b.status !== 'open') return;
    if (!commitOps([{ t: 'del', id: bid }])) { toast('Couldn’t save on this browser'); return; }
    renderView(false); pop(bid);
    toast('Bet removed');
  }
  window.addEventListener('storage', function (e) {      // another tab (or the app itself) changed My Bets
    if (!MB || !S.D || (e.key && e.key !== MB.KEY)) return;
    mem = MB.load();
    if (!S.sheet) renderView(false);
  });

  /* Results split: the model's official record next to my Tailed and my Faded bets (matched by id + side).
     In DEMO, today's open bets get a simulated final grade for this view only. Nothing here is ever saved. */
  function simFinal(b) {
    var p = pickOf(b.id); if (!p) return null;
    var pl = players()[pid(p)], cs = (COMP[p.sport] || {})[p.stat], stat = 0;
    if (!pl) return null;
    if (cs) cs.forEach(function (c) { stat += pl.fin[c] || 0; }); else stat = Math.round(p.proj * (0.6 + 0.8 * hash(pl.id + p.stat)));
    var res = stat === b.line ? 'P' : ((stat > b.line) === (b.side === 'o') ? 'W' : 'L');
    return { status: res, pl: res === 'P' ? 0 : r2(MB.calcPL(res, b.odds, b.units)) };
  }
  function dayShift(iso, n) { var d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function inWindow(date) {
    if (S.per === 'lastNight') return date === dayShift(S.D.date, -1);
    if (S.per === 'last7') return date > dayShift(S.D.date, -7) && date <= S.D.date;
    return true;
  }
  function mySplit() {
    var mk = function () { return { W: 0, L: 0, P: 0, pl: 0, staked: 0, pending: 0, demo: 0 }; }, out = { tail: mk(), fade: mk() };
    Object.keys(mem.bets).forEach(function (id) {
      var b = mem.bets[id]; if (!isMine(b) || b.status === 'void') return;
      var t = out[isFade(b) ? 'fade' : 'tail'], st = b.status, pl = b.pl;
      if (st === 'open' && S.live && MB && b.date === S.D.date) { var g = simFinal(b); if (g) { st = g.status; pl = g.pl; t.demo++; } }
      if (st === 'open') { t.pending++; return; }
      if (!inWindow(b.date)) return;
      t[st]++; t.pl += pl; t.staked += b.units;
    });
    [out.tail, out.fade].forEach(function (t) { t.pl = r2(t.pl); t.n = t.W + t.L + t.P; t.roi = t.staked > 0 ? t.pl / t.staked * 100 : null; });
    return out;
  }
  function cardSports() {
    var seen = {};
    (S.D.top20 || []).concat(S.D.am || []).forEach(function (r) { if (r.sport && S.D.records[r.sport]) seen[r.sport] = 1; });
    return Object.keys(seen).sort();
  }
  function modelTotals() {
    var R = S.D.records, t = { W: 0, L: 0, P: 0, pl: 0, n: 0 };
    // only the sports on the 8 AM + 2 PM cards, so Model compares like with like
    cardSports().forEach(function (sp) { var p = R[sp][S.per]; if (!p || !p.n) return; t.W += p.W; t.L += p.L; t.P += p.P || 0; t.pl += p.units; t.n += p.n; });
    t.pl = r2(t.pl); t.roi = t.n ? t.pl / t.n * 100 : null;   // official record = flat 1u a pick
    t.pending = cardPicks().length;
    return t;
  }
  function splitCol(name, cls, t, demo) {
    var tone = function (x) { return x > 0 ? ' class="cd-pos"' : x < 0 ? ' class="cd-neg"' : ''; };
    return '<div class="cd-s3c ' + cls + '"><span class="cd-lbl">' + name + (demo ? ' <span class="cd-demo">DEMO</span>' : '') + '</span>' +
      '<b aria-label="' + t.W + ' wins, ' + t.L + ' losses, ' + t.P + ' pushes">' + t.W + '-' + t.L + '-' + t.P + '</b><dl>' +
      '<div><dt>Units</dt><dd' + tone(t.pl) + '>' + (t.n ? signed(t.pl, 2) + 'u' : '—') + '</dd></div>' +
      '<div><dt>ROI</dt><dd' + tone(t.roi) + '>' + (t.roi == null ? '—' : signed(t.roi, 1) + '%') + '</dd></div>' +
      '<div><dt>Pending</dt><dd>' + t.pending + '</dd></div></dl></div>';
  }
  function splitHTML() {
    var my = mySplit(), mo = modelTotals(), passed = cardPicks().filter(function (p) { return !betOf(p.bid); }).length, demo = my.tail.demo + my.fade.demo;
    var h = '<section class="cd-split cd-panel" data-i="0" aria-label="Model, Tailed and Faded records"><header class="cd-split-h"><span class="cd-rec-m">Model vs me</span><span class="cd-split-w">W-L-P</span></header><div class="cd-s3">';
    h += splitCol('Model', 'cd-s3-model', mo, 0) + splitCol('Tailed', 'cd-s3-tail', my.tail, my.tail.demo) + splitCol('Faded', 'cd-s3-fade', my.fade, my.fade.demo);
    h += '</div><p class="cd-split-f"><b>Passed: ' + passed + '</b> of ' + plural(cardPicks().length, 'card pick') + ' today, no tap.' +
      (demo ? ' <span class="cd-split-demo"><span class="cd-demo">DEMO</span> ' + plural(demo, 'bet') + ' from today graded on simulated finals. Not saved.</span>' : '') + '</p>';
    return h + '<p class="cd-split-n">Model is the official record for ' + cardSports().join(' + ') + ' (the sports on the cards) at a flat 1u, with today\'s card picks pending. Tailed and Faded are my bets at my units and price.</p></section>';
  }

  /* swipe down on the handle area closes the sheet */
  function bindDrag() {
    var sh = document.getElementById('cd-sheet'), y0 = null, dy = 0;
    sh.addEventListener('pointerdown', function (e) {
      if (!e.target.closest('[data-drag]') || e.target.closest('button')) return;
      y0 = e.clientY; dy = 0; sh.classList.add('cd-dragging');
      try { e.target.closest('[data-drag]').setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    });
    sh.addEventListener('pointermove', function (e) { if (y0 == null) return; dy = Math.max(0, e.clientY - y0); sh.style.transform = 'translateY(' + dy + 'px)'; });
    var end = function () {
      if (y0 == null) return;
      y0 = null; sh.classList.remove('cd-dragging');
      if (dy > 80) closeSheet(false); else sh.style.transform = '';
    };
    sh.addEventListener('pointerup', end); sh.addEventListener('pointercancel', end);
  }

  /* =====================================================================
     Round 3 extras. Reactor ring, tab light trail, light sweep, hero card, radar, tilt, boot. All on: round 4 is C++ only.
     ===================================================================== */
  function topRank() { var m = Infinity; cur().forEach(function (p) { if (p.rank < m) m = p.rank; }); return m; }

  /* C+ unit-cap ring: one segment per quarter unit of the cap, lit as units are used. */
  function reactor(frac, used, cap) {
    var N = Math.round(cap * 4); if (!(N >= 12 && N <= 40)) N = 24;
    var C = 188.5, seg = C / N, f = Math.max(0, Math.min(1, frac)), on = f * N, full = Math.floor(on + 1e-6), part = on - full;
    var pc = Math.round(frac * 100), step = 360 / N, gapDeg = 1.9 / C * 360;
    var h = '<svg class="cd-ring cd-ring-cap cd-rx" viewBox="0 0 72 72" role="img" aria-label="Cap used ' + pc + '%, ' + num(used, 2) + 'u of ' + num(cap, 2) + 'u">';
    h += '<circle class="cd-rx-in" cx="36" cy="36" r="23"/><g class="cd-rx-segs">';
    for (var i = 0; i < N; i++) {
      var cls = i < full ? ' cd-on' : (i === full && part > 0.05 ? ' cd-on cd-part' : '');
      var tone = i / N < 0.34 ? 'a' : i / N < 0.67 ? 'b' : 'c';
      h += '<circle class="cd-rx-seg cd-rx-' + tone + cls + '" data-i="' + i + '" cx="36" cy="36" r="30" stroke-dasharray="' + (seg - 1.9).toFixed(2) + ' ' + C + '" transform="rotate(' + (-90 + i * step + gapDeg / 2).toFixed(2) + ' 36 36)"/>';
    }
    return h + '</g><text x="36" y="41" text-anchor="middle">' + pc + '%</text></svg>';
  }

  /* C++ hero card: the top-ranked pick, key numbers big. Same button and details as any other row. */
  function heroInner(p) {
    var g = gameById(p.gid);
    return '<span class="cd-hero-top"><span class="cd-hero-tag"><span class="cd-sr">Rank </span>#' + p.rank + ' · Top pick</span>' + (p.note ? '<span class="cd-flag" title="News flag">News</span>' : '') + sportTag(p.sport) + tierChip(p) + '</span>' +
      '<span class="cd-rname cd-hero-name"><b>' + esc(p.name) + '</b><i>' + esc(p.team) + '</i></span>' +
      '<span class="cd-rpick cd-hero-pick"><b>' + esc(p.side) + ' ' + num(p.line) + '</b> ' + esc(p.market) + ' ' + alsoTag(p) + '</span>' + pmLine(p) +
      '<span class="cd-hero-nums"><span><small>Model chance</small><b>' + num(p.P) + '%</b></span><span class="cd-hero-edge"><small>' + (p.card === 'am' ? '8 AM edge' : '2 PM edge') + '</small><b>' + pctTxt(p.edge) + '</b></span><span><small>Units</small><b>' + (p.units > 0 ? unitsTxt(p.units) : '0u') + '</b></span></span>' +
      '<span class="cd-hero-foot"><span>Proj <b>' + num(p.proj) + '</b> · ' + esc(g ? g.away + ' @ ' + g.home : gameLabel(p.game)) + ' · ' + esc(p.kick) + '</span><i class="cd-chev" aria-hidden="true"></i></span>';
  }

  /* C++ Live radar: one blip per live game. Angle is just a slot (start-time order); distance from the
     center is how far through the game it is (rim = final). Color = how the board picks in it are tracking. */
  function radarHTML(byG) {
    var D = S.D, live = [], fin = 0, pre = 0, slots = {}, order = [];
    D.games.forEach(function (g) {
      var gs = gameState(g);
      if (gs.st === 'live') live.push(g);
      else if (gs.st === 'final') fin++;
      else { pre++; if (!gs.started) { if (!slots[g.kick]) { slots[g.kick] = 0; order.push([g.kick, +new Date(g.kickoff)]); } slots[g.kick]++; } }
    });
    live.sort(function (a, b) { return new Date(a.kickoff) - new Date(b.kickoff); });
    var n = live.length, blips = '', rows = '';
    live.forEach(function (g, i) {
      var gs = gameState(g), c = { ok: 0, risk: 0 };
      (byG[g.gid] || []).forEach(function (p) { var k = stateCls(pickState(p)); if (c[k] != null) c[k]++; });
      var st = c.risk ? 'risk' : c.ok ? 'ok' : 'none', word = st === 'risk' ? 'a pick at risk' : st === 'ok' ? 'picks on track' : 'no open picks';
      var a = (-90 + (i + 0.5) * 360 / n) * Math.PI / 180, r = 15 + gs.frac * 37, x = 60 + r * Math.cos(a), y = 60 + r * Math.sin(a);
      blips += '<g class="cd-bl cd-bl-' + st + '" data-i="' + i + '"><circle class="cd-bl-ping" cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="7"/><circle class="cd-bl-dot" cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="7"/><text x="' + x.toFixed(1) + '" y="' + (y + 3.4).toFixed(1) + '" text-anchor="middle">' + (i + 1) + '</text></g>';
      if (i < 8) rows += '<li class="cd-bl-' + st + '"><i>' + (i + 1) + '</i><b>' + g.away + ' @ ' + g.home + '</b><span>' + esc(gs.clock) + '<span class="cd-sr">, ' + Math.round(gs.frac * 100) + '% played, ' + word + '</span></span></li>';
    });
    if (n > 8) rows += '<li class="cd-radar-more">+' + (n - 8) + ' more below</li>';
    if (!n) {
      order.sort(function (a, b) { return a[1] - b[1]; });
      rows = '<li class="cd-radar-none"><b>' + (S.D.games.some(function (g) { return new Date(g.kickoff) < new Date(); }) ? 'Live tracking comes in the next piece' : 'No games live right now') + '</b></li>';
      order.slice(0, 5).forEach(function (o) { rows += '<li class="cd-radar-slot"><b>' + esc(o[0].replace(' ET', '')) + '</b><span>' + plural(slots[o[0]], 'game') + ' to start</span></li>'; });
    }
    var sum = S.live ? [n + ' live', fin ? fin + ' final' : '', pre ? pre + ' to start' : ''].filter(Boolean).join(' · ') : 'Standby · ' + plural(D.games.length, 'game');
    var h = '<section class="cd-radar cd-panel' + (n ? '' : ' cd-radar-idle') + '" aria-label="Live radar"><div class="cd-radar-h"><span class="cd-lbl">Live radar ' + demoTag() + '</span><span class="cd-radar-sum">' + sum + '</span></div>';
    h += '<div class="cd-radar-d"><i class="cd-radar-sw" aria-hidden="true"></i><svg viewBox="0 0 120 120" role="img" aria-label="' + (n ? plural(n, 'live game') + ', farther from the center means closer to final' : 'No live games') + '">' +
      '<circle class="cd-radar-r" cx="60" cy="60" r="54"/><circle class="cd-radar-r cd-radar-r2" cx="60" cy="60" r="33.5"/><circle class="cd-radar-r cd-radar-r2" cx="60" cy="60" r="15"/><path class="cd-radar-x" d="M60 6V114M6 60H114"/><circle class="cd-radar-c" cx="60" cy="60" r="1.6"/>' + blips + '</svg></div>';
    h += '<ol class="cd-radar-l">' + rows + '</ol>';
    h += '<p class="cd-radar-k">' + (n ? '<span>Center = start · rim = final</span><span class="cd-radar-keys"><i class="cd-bl-ok"></i>On track<i class="cd-bl-risk"></i>At risk<i class="cd-bl-none"></i>No open picks</span>' : '<span>Each live game shows up as a blip. Center = start · rim = final.</span>') + '</p>';
    return h + '</section>';
  }

  /* C+ tab bar: the glow glides to the tapped tab (CSS transition on data-at) and leaves a short fading trail. */
  function tabTrail(from, to) {
    var bar = app.querySelector('.cd-tabs-in'); if (!bar) return;
    bar.setAttribute('data-at', to);
    var tr = bar.querySelector('.cd-trail'); if (!tr || REDUCED || from === to) return;
    tr.className = 'cd-trail';
    tr.style.width = Math.round(Math.abs(to - from) * bar.offsetWidth / 3 * 0.8) + 'px';
    void tr.offsetWidth;
    tr.className = 'cd-trail ' + (to > from ? 'cd-trail-r' : 'cd-trail-l');
  }

  /* C+ light sweep: after the entrance pass, one visible panel gets a sheen every few seconds. Never several at once. */
  var sweepT = 0;
  var IDLE_SWEEP = false;   // random light sweeps on idle panels: off for scroll smoothness (owner 11/21: choppy)
  function sweepTick() {
    clearTimeout(sweepT);
    if (!IDLE_SWEEP || REDUCED || S.shot || document.hidden) return;
    sweepT = setTimeout(sweepTick, 4200 + Math.random() * 3600);
    if (S.sheet || booting) return;
    var els = app.querySelectorAll('.cd-main .cd-panel'), vis = [], H = window.innerHeight;
    for (var i = 0; i < els.length; i++) { var r = els[i].getBoundingClientRect(); if (r.bottom > 90 && r.top < H - 90) vis.push(els[i]); }
    if (!vis.length) return;
    var el = vis[Math.floor(Math.random() * vis.length)];
    el.classList.add('cd-sweep');
    setTimeout(function () { el.classList.remove('cd-sweep'); }, 1400);
  }
  document.addEventListener('visibilitychange', function () { if (document.hidden) { clearTimeout(sweepT); tiltEnd(); } else if (S.D) sweepTick(); });

  /* C++ touch tilt: a pressed card leans a few degrees toward the finger and springs back on release.
     Passive listeners only, so it never blocks a scroll; it starts after a short hold so a scroll flick does not wobble the card. */
  var tilt = null, tiltWait = 0, tiltRaf = 0, TILT_MAX = 6, foilX = 0;
  function tiltPaint() {
    tiltRaf = 0; if (!tilt || !tilt.on) return;
    tilt.el.style.transform = 'perspective(900px) rotateX(' + tilt.rx.toFixed(2) + 'deg) rotateY(' + tilt.ry.toFixed(2) + 'deg)';
    if (tilt.foil) { foilX = -tilt.ry * 2; parallax(); }
  }
  function tiltCalc(e) {
    var r = tilt.r, kx = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width - 0.5) * 2)), ky = Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height - 0.5) * 2));
    tilt.ry = kx * tilt.max; tilt.rx = -ky * tilt.max * 0.8;
    if (tilt.on && !tiltRaf) tiltRaf = requestAnimationFrame(tiltPaint);
  }
  function tiltEnd() {
    clearTimeout(tiltWait);
    if (!tilt) return;
    if (tilt.on) { tilt.el.classList.remove('cd-tilting'); tilt.el.style.transform = ''; if (tilt.foil) { foilX = 0; parallax(); } }
    tilt = null;
  }
  document.addEventListener('pointerdown', function (e) {
    tiltEnd();
    if (REDUCED || S.shot || S.sheet || booting || !e.isPrimary || !e.target.closest || e.target.closest('.cd-act')) return;   // Tail / Fade buttons stay still under the finger
    var el = e.target.closest('.cd-main .cd-panel'); if (!el || el.classList.contains('cd-tile')) return;
    var r = el.getBoundingClientRect();
    tilt = { el: el, r: r, id: e.pointerId, y0: e.clientY, on: false, rx: 0, ry: 0, max: TILT_MAX * Math.min(1, 170 / r.height), foil: el.classList.contains('cd-hero') };
    tiltCalc(e);
    tiltWait = setTimeout(function () { if (!tilt) return; tilt.on = true; tilt.el.classList.add('cd-tilting'); tiltPaint(); }, 110);
  }, { passive: true });
  document.addEventListener('pointermove', function (e) {
    if (!tilt || e.pointerId !== tilt.id) return;
    if (!tilt.on && Math.abs(e.clientY - tilt.y0) > 8) { tiltEnd(); return; }   // it is a scroll, leave the card alone
    tiltCalc(e);
  }, { passive: true });
  ['pointerup', 'pointercancel'].forEach(function (t) { document.addEventListener(t, function (e) { if (tilt && e.pointerId === tilt.id) tiltEnd(); }, { passive: true }); });
  window.addEventListener('blur', tiltEnd);

  /* C++ hero foil: drifts a few px against the scroll (and against the tilt) for a slight parallax. */
  var pxRaf = 0;
  function parallax() {
    pxRaf = 0;
    if (REDUCED || S.shot || S.tab !== 'board') return;
    var foil = app.querySelector('.cd-hero .cd-foil'); if (!foil) return;
    var r = foil.parentNode.getBoundingClientRect(), H = window.innerHeight;
    if (r.bottom < 0 || r.top > H) return;
    var k = Math.max(-1, Math.min(1, ((r.top + r.height / 2) / H - 0.5) * 2));
    foil.style.transform = 'translate3d(' + foilX.toFixed(1) + 'px,' + (k * -14).toFixed(1) + 'px,0)';
  }
  window.addEventListener('scroll', function () { if (!pxRaf && !REDUCED && S.tab === 'board' && !document.hidden) pxRaf = requestAnimationFrame(parallax); }, { passive: true });

  /* C++ boot-up: HUD lines draw, panels assemble (CSS, under body.cd-booting), header text decodes. About 0.8 s,
     once per session, any tap skips it. Never with shot=1 or reduced motion. */
  var booting = false, bootT = 0, bootRaf = 0, bootFx = null, bootTxt = [];
  function startBoot() {
    if (S.shot || REDUCED) return;
    try { if (sessionStorage.getItem('cd-r4-boot')) return; sessionStorage.setItem('cd-r4-boot', '1'); } catch (e) { /* storage blocked: the boot just plays on each load */ }
    booting = true;
    document.body.classList.add('cd-booting');
    bootFx = document.createElement('div');
    bootFx.className = 'cd-bootfx';
    bootFx.innerHTML = '<i class="cd-bootbg"></i><i class="cd-bootl cd-bootl-t"></i><i class="cd-bootl cd-bootl-b"></i><i class="cd-bootl cd-bootl-l"></i><i class="cd-bootl cd-bootl-r"></i>' +
      '<div class="cd-bootc"><b>Trend Bettors Command</b><span>Loading the ' + esc(pullTxt()) + ' pull</span><i class="cd-bar"><i></i></i><small>Tap to skip</small></div>';
    document.body.appendChild(bootFx);
    bootFx.addEventListener('click', endBoot);
    document.addEventListener('keydown', endBoot);
    /* header decode: brand name and the date/pull stamp resolve left to right out of scrambled glyphs */
    var nodes = [], bt = app.querySelector('.cd-brand-t'), mb = app.querySelector('.cd-top-meta b'), ms = app.querySelector('.cd-top-meta span');
    if (bt && bt.firstChild && bt.firstChild.nodeType === 3) nodes.push(bt.firstChild);
    if (mb && mb.firstChild) nodes.push(mb.firstChild);
    if (ms && ms.firstChild) nodes.push(ms.firstChild);
    bootTxt = nodes.map(function (n) { return [n, n.nodeValue]; });
    var GL = 'ABCDEFGHKLMNPRSTUVXYZ0123456789#/<>', t0 = null, last = 0;
    var step = function (t) {
      if (!booting) return;
      if (t0 == null) t0 = t;
      var k = Math.max(0, Math.min(1, (t - t0 - 100) / 450));
      if (t - last > 45) {
        last = t;
        bootTxt.forEach(function (x) {
          var s = x[1], cut = Math.floor(k * s.length), out = s.slice(0, cut);
          for (var i = cut; i < s.length; i++) out += s.charAt(i) === ' ' ? ' ' : GL.charAt(Math.floor(Math.random() * GL.length));
          x[0].nodeValue = out;
        });
      }
      if (k < 1 && !document.hidden) bootRaf = requestAnimationFrame(step); else bootTxt.forEach(function (x) { x[0].nodeValue = x[1]; });
    };
    bootRaf = requestAnimationFrame(step);
    bootT = setTimeout(endBoot, 800);
  }
  function endBoot() {
    if (!booting) return;
    booting = false;
    clearTimeout(bootT); cancelAnimationFrame(bootRaf);
    document.removeEventListener('keydown', endBoot);
    bootTxt.forEach(function (x) { x[0].nodeValue = x[1]; }); bootTxt = [];
    var v = document.getElementById('cd-view'); if (v) v.classList.remove('cd-enter');   // everything lands in its final state at once
    document.body.classList.remove('cd-booting');
    if (bootFx && bootFx.parentNode) bootFx.parentNode.removeChild(bootFx);
    bootFx = null;
  }

  /* ---------- render ---------- */
  function applyVars(root) {
    Array.prototype.forEach.call(root.querySelectorAll('[data-w]'), function (el) { el.style.width = el.getAttribute('data-w') + '%'; });
    Array.prototype.forEach.call(root.querySelectorAll('[data-h]'), function (el) { el.style.height = el.getAttribute('data-h') + '%'; });
    Array.prototype.forEach.call(root.querySelectorAll('[data-i]'), function (el) { el.style.setProperty('--i', el.getAttribute('data-i')); });
  }
  function countUps(root) {
    if (REDUCED) return;
    Array.prototype.forEach.call(root.querySelectorAll('.cd-cu'), function (el) {
      var v = +el.dataset.cu, d = +el.dataset.d, pre = el.dataset.pre, suf = el.dataset.suf, t0 = null, dur = 520;
      if (!v) return;
      var step = function (t) {
        if (t0 == null) t0 = t;
        var k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
        el.textContent = pre + (k < 1 ? (v * e).toFixed(d) : num(v, d)) + suf;
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }
  function viewHTML() { return S.tab === 'live' ? liveHTML() : S.tab === 'results' ? resultsHTML() : boardHTML(); }
  function renderView(animate) {
    var v = document.getElementById('cd-view');
    v.innerHTML = viewHTML();
    v.classList.toggle('cd-enter', !!animate);
    if (animate) { void v.offsetWidth; }
    applyVars(v);
    if (animate) countUps(v);
    parallax();
  }
  function render(animate) {
    document.body.dataset.live = S.live ? '1' : '0';
    tiltEnd(); endBoot();
    document.body.classList.remove('cd-sheet-open'); S.sheet = ''; S.draft = null; S.bs = null;
    app.innerHTML = '<svg class="cd-defs" width="0" height="0" aria-hidden="true" focusable="false"><defs><linearGradient id="cd-holo" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7CF3FF"/><stop offset=".5" stop-color="#8FA6FF"/><stop offset="1" stop-color="#C58BFF"/></linearGradient></defs></svg>' +
      '<div class="cd-grid" aria-hidden="true"><i></i></div>' + topHTML() + '<main id="cd-view" class="cd-main"></main>' + tabsHTML() + sheetHTML();
    bindDrag();
    renderView(animate);
  }
  function setTab(t) {
    if (S.tab === t) { window.scrollTo(0, 0); return; }
    tabTrail(TABS.indexOf(S.tab), TABS.indexOf(t));
    S.tab = t;
    Array.prototype.forEach.call(app.querySelectorAll('.cd-tab'), function (b) { var on = b.dataset.v === t; b.classList.toggle('cd-on', on); b.setAttribute('aria-selected', on); });
    syncHash();
    renderView(true);
    window.scrollTo(0, 0);
  }
  function setCard(c) {
    if (S.card === c) return;
    S.card = c; S.open = ''; S.f = blankFilters();    // the two cards have different picks, so filters start clean
    syncHash(); renderView(true);
  }
  function toggleRow(bid, forceOpen) {
    var prev = S.open; S.open = (prev === bid && !forceOpen) ? '' : bid;
    Array.prototype.forEach.call(app.querySelectorAll('.cd-row'), function (r) {
      var on = r.dataset.bid === S.open; r.classList.toggle('cd-open', on);
      r.querySelector('.cd-rowb').setAttribute('aria-expanded', on);
    });
  }
  function reveal(sel) {
    var el = app.querySelector(sel); if (!el) return;
    var top = app.querySelector('.cd-top'), y = el.getBoundingClientRect().top + window.pageYOffset - (top ? top.offsetHeight : 0) - 12;
    window.scrollTo({ top: Math.max(0, y), behavior: REDUCED ? 'auto' : 'smooth' });
  }

  /* ---------- events ---------- */
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]'); if (!b || b.disabled) return;
    /* a click inside the sheet or on its backdrop only counts after a fresh press there (e.detail 0 = keyboard) */
    if (S.sheet && b.closest('.cd-sheet,.cd-scrim') && !sheetArmed && e.detail !== 0) return;
    var act = b.dataset.act, v = b.dataset.v;
    if (act === 'tab') setTab(v);
    else if (act === 'card') setCard(v);
    else if (act === 'tail' || act === 'fade') openBet(v, act);
    else if (act === 'bet-edit') openBet(v, 'edit');
    else if (act === 'bet-undo') undoBet(v);
    else if (act === 'bs-step') bsStep(+v);
    else if (act === 'bs-save') bsSave();
    else if (act === 'row') toggleRow(v);
    else if (act === 'jump') {
      S.f = blankFilters(); S.open = v;
      if (S.tab !== 'board') setTab('board'); else renderView(false);
      reveal('.cd-row.cd-open');
    }
    else if (act === 'togame') { S.gsport = ''; S.gpicks = false; S.gopen = v; setTab('live'); reveal('.cd-g[data-gid="' + v + '"]'); }
    else if (act === 'gopen') {
      var art = b.closest('.cd-g'), on = !art.classList.contains('cd-open');
      S.gopen = on ? v : '!' + v;
      art.classList.toggle('cd-open', on); b.setAttribute('aria-expanded', on);
    }
    else if (act === 'gsport') { S.gsport = v; renderView(false); }
    else if (act === 'gpicks') { S.gpicks = !S.gpicks; renderView(false); }
    else if (act === 'per') { S.per = v; renderView(false); countUps(document.getElementById('cd-view')); }
    else if (act === 'sheet-open') openSheet();
    else if (act === 'sheet-close') closeSheet(false);
    else if (act === 'sheet-apply') closeSheet(true);
    else if (act === 'sheet-reset') { S.draft = blankFilters(); document.getElementById('cd-sheet-body').innerHTML = sheetBodyHTML(); syncSheet(); }
    else if (act === 'fset') {
      S.draft[b.dataset.k] = v;
      Array.prototype.forEach.call(b.parentNode.children, function (c) { var on = c === b; c.classList.toggle('cd-on', on); c.setAttribute('aria-pressed', on); });
      syncSheet();
    }
    else if (act === 'fclear') { S.f[b.dataset.k] = b.dataset.k === 'edge' || b.dataset.k === 'chance' ? 0 : ''; renderView(false); }
    else if (act === 'freset') { S.f = blankFilters(); renderView(false); }
  });
  document.addEventListener('input', function (e) {
    var bk = e.target.dataset && e.target.dataset.bs;
    if (bk && S.bs) { bsErr(bk, false); if (bk === 'u') bsWarn(); return; }
    var k = e.target.dataset && e.target.dataset.f; if (!k || !S.draft) return;
    if (k === 'q') S.draft.q = e.target.value.trim();
    else if (k === 'edge') { S.draft.edge = +e.target.value; document.getElementById('cd-fe-out').textContent = S.draft.edge ? pctTxt(S.draft.edge) : 'Any'; }
    else if (k === 'chance') { var c = +e.target.value; S.draft.chance = c <= +e.target.min ? 0 : c; document.getElementById('cd-fc-out').textContent = S.draft.chance ? num(c) + '%' : 'Any'; }
    syncSheet();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && S.sheet) closeSheet(false);
    if (e.key === 'Enter' && S.sheet === 'filter' && e.target.id === 'cd-q') { e.preventDefault(); closeSheet(true); }
    if (e.key === 'Enter' && S.sheet === 'bet' && e.target.dataset && e.target.dataset.bs) { e.preventDefault(); bsSave(); }
  });
  document.addEventListener('change', function (e) {     // typed units snap to the nearest quarter unit
    if (!S.bs || !e.target.dataset || e.target.dataset.bs !== 'u') return;
    var u = parseUnits(e.target.value);
    if (u != null) e.target.value = num(u, 2); else bsErr('u', true);
    bsWarn();
  });
  function wantedSheet() {
    var w = wantSheet; wantSheet = '';
    if (!w || S.tab !== 'board') return;
    if (w === 'filter') { openSheet(); return; }
    var picks = cur().filter(function (p) { return p.units > 0 && (w === 'tail' || p.dkOther != null); });
    var p = picks.filter(function (x) { return !betOf(x.bid); })[0] || picks[0];
    if (p) { openBet(p.bid, w); sheetArmed = true; }   // opened by a link, not a tap: no ghost click to wait out
  }
  window.addEventListener('hashchange', function () { if (S.D && takeHash()) { render(true); wantedSheet(); } });

  /* ---------- unlock + data ---------- */
  var KEY_STORE = 'tb.cmd.key', AAD = 'tb-command-v1';
  function takeKey() {   // #k=<key> from the unlock link: saved on this phone, then dropped from the address bar
    var m = /^#k=([A-Za-z0-9_-]{43})$/.exec(location.hash), k = '';
    if (m) {
      k = m[1];
      try { localStorage.setItem(KEY_STORE, k); } catch (e) { /* private mode: this visit only */ }
      try { history.replaceState(null, '', location.pathname + location.search + '#board'); } catch (e) { /* ignore */ }
      return k;
    }
    try { k = localStorage.getItem(KEY_STORE) || ''; } catch (e) { k = ''; }
    return k;
  }
  function b64u(s) {
    s = String(s).replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '=';
    var b = atob(s), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u;
  }
  function openBox(box, k) {
    return crypto.subtle.importKey('raw', b64u(k), 'AES-GCM', false, ['decrypt']).then(function (key) {
      return crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64u(box.iv), additionalData: new TextEncoder().encode(AAD) }, key, b64u(box.ct));
    }).then(function (buf) {
      return new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).json();
    });
  }
  function locked(msg) {
    app.innerHTML = '<div class="cd-lock cd-panel"><b>Command is locked</b><p>' + msg + '</p></div>';
  }

  /* ---------- boot ---------- */
  var KEY = takeKey();
  takeHash();
  if (!KEY) locked('Open your unlock link once on this phone. It saves the key here; nothing is sent anywhere.');
  else fetch('data.enc', { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error('data ' + r.status); return r.json(); }).then(function (box) {
    return openBox(box, KEY).catch(function () { throw new Error('key'); });
  }).then(function (D) {
    D.top20 = D.top20 || []; D.am = D.am || [];
    D.am.forEach(function (p, i) { if (p.rank == null) p.rank = i + 1; p.card = 'am'; });
    D.top20.forEach(function (p) { p.card = 'pm'; });
    if (!hashCard && D.pmReady === false) S.card = 'am';   // before the afternoon pull the 8 AM picks are the card
    S.D = D;
    render(true);
    if (!wantSheet) startBoot();
    sweepTick();
    wantedSheet();
  }).catch(function (err) {
    if (err.message === 'key') locked('This phone\'s key doesn\'t open today\'s data. Open the unlock link again.');
    else app.innerHTML = '<p class="cd-boot">Today\'s data did not load (' + esc(err.message) + '). Pull down to retry.</p>';
  });
})();
