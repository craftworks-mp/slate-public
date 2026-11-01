(() => {
  const SPORTS = { nfl: 'NFL', nba: 'NBA', nhl: 'NHL' };
  const PAGES = { bets: 'BETS', results: 'RESULTS' };
  const SUBTITLES = { game: 'GAME', player: 'PLAYER', team: 'TEAM', standings: 'STANDINGS' };
  const FILTERS = ['All', 'NFL', 'NBA', 'NHL'];
  const PAIRS = {
    nfl: [['KC', 'BUF'], ['SF', 'DAL'], ['PHI', 'GB'], ['BAL', 'CIN']],
    nba: [['BOS', 'NYK'], ['LAL', 'DEN'], ['MIA', 'PHI'], ['GSW', 'PHX']],
    nhl: [['BOS', 'TOR'], ['NYR', 'FLA'], ['COL', 'VGK'], ['EDM', 'CGY']],
  };
  const STAT_LABELS = {
    nfl: ['YDS', 'TD', 'REC', 'TGT', 'CMP', 'ATT', 'INT', 'FUM', 'SCK', 'LNG'],
    nba: ['PTS', 'REB', 'AST', 'STL', 'BLK', 'FG%', '3P%', 'FT%', 'MIN', 'TO'],
    nhl: ['G', 'A', 'PTS', 'SOG', 'TOI', '+/-', 'PIM', 'PPP', 'HIT', 'BLK'],
  };
  const TABS = [['bets', 'Bets'], ['game', 'Game'], ['away', 'AWAY'], ['home', 'HOME']];
  // Model vs Book edge chip thresholds, per sport: [lean, strong]. spread = points, total/tt = % of the book line, win = win % points.
  // spread: null = always gray (thresholds not decided yet; the chip still shows the edge).
  const EDGE_T = {
    nba: { spread: [1.5, 3], total: [1, 2.5], tt: [1, 2.5], win: [2, 5] },
    nhl: { spread: null, total: [1, 2.5], tt: [1, 2.5], win: [2, 5] },
  };

  const state = {
    sel: { nfl: null, nba: null, nhl: null }, // selected date per sport (null = default), kept in memory
    gameTab: 'bets',
    filter: 'All',
    betSort: 'ev', // game Bets tab sort: ev | grade | player
    betF: { ga: false, mkt: '' }, // game Bets tab filters, kept across games
    betSide: 'model', // game Bets tab side toggle: model (pick side) | o | u
    betOpen: {}, // expanded bet rows (bet id -> true), kept in memory
    cmpSplit: 'season', // game Game tab comparison: season | l5 | ha
    playerTab: '', // player page tab (tonight | trends | matchup | recent); '' = default by props, kept across players
    pmore: {}, // player Recent tab 'Show all' ('<sport>/<pid>' -> true)
    chartStat: {}, // player page chart stat ('<sport>/<pid>' -> stat key)
    shotView: {}, // player Matchup tab shot matchup toggle ('<sport>/<pid>' -> 'his' | 'def')
    infoOpen: {}, // open definition notes ('<sport>/<key>' -> true)
    res: { view: 'model', ph: 'close', range: 'season', fold: false, mkt: '', ou: '', fd: '', ha: '' }, // Results tab, Model view (app/results.js)
  };
  let cur = { key: '', sport: null, kind: 'root', id: '' };

  const $ = (id) => document.getElementById(id);
  const view = $('view');

  // Noon UTC of today's New York calendar date, shifted by n days (DST-safe).
  function baseDate(n) {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' })
        .formatToParts(new Date()).map((x) => [x.type, x.value]));
    return new Date(Date.UTC(+p.year, +p.month - 1, +p.day + n, 12));
  }
  // YYYY-MM-DD strings (ET calendar dates) -> labels, formatted as UTC noon so no zone shifts the day
  const dnoon = (d) => new Date(d + 'T12:00:00Z');
  const fmtU = (o) => new Intl.DateTimeFormat('en-US', Object.assign({ timeZone: 'UTC' }, o));
  const F_DOW = fmtU({ weekday: 'short' }), F_MD = fmtU({ month: 'short', day: 'numeric' }), F_MON = fmtU({ month: 'long' }), F_LONG = fmtU({ weekday: 'short', month: 'short', day: 'numeric' });
  const dowOf = (d) => F_DOW.format(dnoon(d)).toUpperCase();
  const mdOf = (d) => F_MD.format(dnoon(d)).toUpperCase();
  const monthOf = (d) => F_MON.format(dnoon(d)).toUpperCase();
  const longOf = (d) => F_LONG.format(dnoon(d)).replace(',', '');

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function segmented(items, active, attr, cls) {
    return `<div class="seg ${cls || ''}" role="group"><span class="seg-hl" aria-hidden="true"></span>${items.map((i) => {
      const [k, label] = Array.isArray(i) ? i : [i, i];
      return `<button ${attr}="${k}" class="${k === active ? 'on' : ''}" aria-pressed="${k === active}">${esc(label)}</button>`;
    }).join('')}</div>`;
  }

  const ICONS = {
    Standings: '<path d="M4 20V4M4 20h16M8 16v-4M12 16V8M16 16v-6"/>',
    Bets: '<rect x="7" y="3" width="13" height="16" rx="2"/><path d="M4 7v12a2 2 0 0 0 2 2h10"/>',
  };
  const bar = (w) => `<span class="bar ${w || 'w70'}"></span>`;
  const skRows = (n) => `<div class="sk" aria-hidden="true">${Array.from({ length: n }, (_, i) =>
    `<div class="sk-row"><span class="dot"></span><span class="bars">${bar(i % 2 ? 'w55' : 'w85')}${bar(i % 2 ? 'w40' : 'w70')}</span></div>`).join('')}</div>`;
  function empty(icon, title, desc, rows) {
    return `<div class="card empty"><div class="ico"><svg viewBox="0 0 24 24">${ICONS[icon]}</svg></div>
      <h2>${esc(title)}</h2><p>${esc(desc)}</p>${rows ? `<div class="sec">Preview</div>${skRows(rows)}` : ''}</div>`;
  }
  const sec = (t) => `<div class="sec">${esc(t)}</div>`;
  const backBtn = '<button class="icon-btn back" data-back aria-label="Back">&#8249;</button>';
  const badge = (code, cls, href) => href
    ? `<a class="tb ${cls || ''}" href="${href}" aria-label="${esc(code)} team page">${esc(code)}</a>`
    : `<span class="tb ${cls || ''}" aria-hidden="true">${esc(code)}</span>`;
  const rowsGeneric = (n) => `<div class="srows" aria-hidden="true">${Array.from({ length: n }, (_, i) =>
    `<div class="sk-row"><span class="bars">${bar(i % 2 ? 'w55' : 'w85')}${bar(i % 2 ? 'w40' : 'w70')}</span></div>`).join('')}</div>`;

  // Sliding highlight for segmented controls. prev = {x,w} from last render of same kind.
  const lastHl = {};
  let lastKey = null;
  let bcScroll = 0; // Bets chip row scroll, kept across re-renders
  function placeHl(animate) {
    view.querySelectorAll('.seg').forEach((seg) => {
      const hl = seg.querySelector('.seg-hl');
      const on = seg.querySelector('button.on');
      if (!hl || !on) return;
      const b0 = seg.querySelector('button').dataset;
      const kind = b0.bseg !== undefined ? 'bseg' : b0.sub !== undefined ? 'sub' : b0.sort !== undefined ? 'sort' : b0.cmp !== undefined ? 'cmp' : b0.shotv !== undefined ? 'shotv' : b0.ptab !== undefined ? 'ptab' : b0.bside !== undefined ? 'bside' : 'filter';
      const x = on.offsetLeft, w = on.offsetWidth;
      const prev = lastHl[kind];
      lastHl[kind] = { x, w };
      const set = (px, pw) => { hl.style.width = pw + 'px'; hl.style.transform = `translateX(${px}px)`; };
      if (animate && prev && (prev.x !== x || prev.w !== w)) {
        seg.classList.add('nohl'); set(prev.x, prev.w);
        void hl.offsetWidth;
        seg.classList.remove('nohl'); set(x, w);
      } else {
        seg.classList.add('nohl'); set(x, w);
        void hl.offsetWidth;
        seg.classList.remove('nohl');
      }
    });
  }
  window.addEventListener('resize', () => placeHl(false));
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => placeHl(false));


  // ---- data layer ----
  const store = { days: {}, meta: {}, sched: {}, slates: {}, players: {}, hist: {}, teams: {}, def: {}, shots: {}, idx: null, idxDone: false };
  const MINUS = '−';
  const ver = () => (store.idx && store.idx.updated ? '?v=' + encodeURIComponent(store.idx.updated) : '');
  async function getJSON(url, opts) {
    const r = await fetch(url, opts);
    if (r.status === 404) return { nf: true };
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return { data: await r.json() };
  }
  const indexP = getJSON('../index.json', { cache: 'no-store' })
    .then((r) => { store.idx = r.data || null; }, () => { store.idx = null; })
    .then(() => { store.idxDone = true; });
  const rerender = () => { if (typeof render === 'function' && cur) render(); };
  function ensureMeta(sp) {
    if (store.meta[sp]) return store.meta[sp];
    const e = store.meta[sp] = { st: 'loading' };
    indexP.then(() => getJSON('../meta/' + sp + '.json' + ver())).then((r) => {
      e.st = r.data ? 'ok' : 'err'; e.data = r.data || {};
    }, () => { e.st = 'err'; e.data = {}; }).then(rerender);
    return e;
  }
  const ymd = (n) => baseDate(n).toISOString().slice(0, 10);
  function ensureDay(sp, date) {
    const k = sp + '/' + date;
    if (store.days[k]) return store.days[k];
    const e = store.days[k] = { st: 'loading', sp, date };
    indexP.then(() => {
      const list = store.idx && store.idx.sports && store.idx.sports[sp] && store.idx.sports[sp].days;
      if (Array.isArray(list) && !list.includes(date)) return { nf: true };
      return getJSON('../days/' + sp + '/' + date + '.json' + ver());
    }).then((r) => {
      if (r.nf) e.st = '404'; else { e.st = 'ok'; e.data = r.data || {}; }
    }, () => { e.st = 'err'; }).then(rerender);
    return e;
  }
  // Public slate (props/bets) for one sport + day: ../slates/<sp>/<date>.json
  function ensureSlate(sp, date) {
    const k = sp + '/' + date;
    if (store.slates[k]) return store.slates[k];
    const e = store.slates[k] = { st: 'loading', sp, date };
    indexP.then(() => getJSON('../slates/' + sp + '/' + date + '.json' + ver())).then((r) => {
      if (r.nf) e.st = '404'; else { e.st = 'ok'; e.data = r.data || {}; }
    }, () => { e.st = 'err'; }).then(rerender);
    return e;
  }
  // Research-world team stats: ../teams/<sp>.json ({ defs, teams: { CODE: { split: { season, l5, home, away, ... } } } }), cached per sport
  function ensureTeams(sp) {
    if (store.teams[sp]) return store.teams[sp];
    const e = store.teams[sp] = { st: 'loading' };
    indexP.then(() => {
      const s = store.idx && store.idx.sports && store.idx.sports[sp];
      if (store.idx && !(s && s.teams)) return { nf: true };
      return getJSON('../teams/' + sp + '.json' + ver());
    }).then((r) => {
      if (r.nf || !r.data) e.st = '404'; else { e.st = 'ok'; e.data = r.data; }
    }, () => { e.st = 'err'; }).then(rerender);
    return e;
  }
  // Research-world player file: ../players/<sp>/<pid>.json (role, pos, gp, st, l5, logs)
  function ensurePlayer(sp, pid) {
    const k = sp + '/' + pid;
    if (store.players[k]) return store.players[k];
    const e = store.players[k] = { st: 'loading', sp, pid };
    indexP.then(() => getJSON('../players/' + sp + '/' + encodeURIComponent(pid) + '.json' + ver())).then((r) => {
      if (r.nf) e.st = '404'; else { e.st = 'ok'; e.data = r.data || {}; }
    }, () => { e.st = 'err'; }).then(rerender);
    return e;
  }
  // Per-player game history: ../hist/<sp>/<pid>.json ({ rows: [[date, gid, team, opp, home, result, ts, os, ...stats]], cols }), newest first. 404 = no history ('nf').
  function ensureHist(sp, pid) {
    const k = sp + '/' + pid;
    if (store.hist[k]) return store.hist[k];
    const e = store.hist[k] = { st: 'loading', sp, pid };
    indexP.then(() => {
      const s = store.idx && store.idx.sports && store.idx.sports[sp];
      if (store.idx && !(s && s.hist)) return { nf: true };
      return getJSON('../hist/' + sp + '/' + encodeURIComponent(pid) + '.json' + ver());
    }).then((r) => {
      if (r.nf || !r.data || !Array.isArray(r.data.rows)) { e.st = '404'; return; }
      e.st = 'ok'; e.cols = r.data.cols || [];
      e.ci = {}; e.cols.forEach((c, i) => { e.ci[c] = i; });
      e.rows = r.data.rows.map((x) => ({ d: x[0], gid: x[1], team: x[2], opp: x[3], home: x[4], res: x[5], ts: x[6], os: x[7], v: x.slice(8) }));
    }, () => { e.st = 'err'; }).then(rerender);
    return e;
  }
  // Position defense (what each team allows to a position group, player ranks, team tags): ../defense/<sp>.json. 404 / not published = 'none': the section and the tags stay hidden.
  function ensureDef(sp) {
    if (store.def[sp]) return store.def[sp];
    const e = store.def[sp] = { st: 'loading' };
    indexP.then(() => {
      const s = store.idx && store.idx.sports && store.idx.sports[sp];
      if (store.idx && !(s && s.defense)) return { nf: true };
      return getJSON('../defense/' + sp + '.json' + ver());
    }).then((r) => {
      if (r.nf || !r.data || !r.data.teams) { e.st = 'none'; return; }
      e.st = 'ok'; e.data = r.data;
    }, () => { e.st = 'err'; }).then(rerender);
    return e;
  }
  // Shot zones (scripts/shots.py): ../shots/<sp>.json. 404 / not published = 'none': the shot matchup shows its empty note.
  function ensureShots(sp) {
    if (store.shots[sp]) return store.shots[sp];
    const e = store.shots[sp] = { st: 'loading' };
    indexP.then(() => {
      const s = store.idx && store.idx.sports && store.idx.sports[sp];
      if (store.idx && !(s && s.shots)) return { nf: true };
      return getJSON('../shots/' + sp + '.json' + ver());
    }).then((r) => {
      if (r.nf || !r.data || !r.data.players) { e.st = 'none'; return; }
      e.st = 'ok'; e.data = r.data;
    }, () => { e.st = 'err'; }).then(rerender);
    return e;
  }
  const defData = (sp) => { const e = store.def[sp]; return e && e.st === 'ok' ? e.data : null; };
  // Season schedule (data/schedule/<sp>.json via the public tree). 'none' = not published for this sport.
  function ensureSched(sp) {
    if (store.sched[sp]) return store.sched[sp];
    const e = store.sched[sp] = { st: 'loading' };
    indexP.then(() => {
      const s = store.idx && store.idx.sports && store.idx.sports[sp];
      if (store.idx && !(s && s.schedule)) return { nf: true };
      return getJSON('../schedule/' + sp + '.json' + ver());
    }).then((r) => {
      if (r.nf || !r.data) { e.st = 'none'; return; }
      e.st = 'ok'; e.data = prepSched(sp, r.data);
    }, () => { e.st = 'err'; }).then(rerender);
    return e;
  }
  // normalize schedule games to the shape of days-file games, and index them by date / team / id
  function prepSched(sp, raw) {
    const games = (raw.games || []).map((g) => ({
      gid: String(g.id), away: g.a, home: g.h, kickoff: g.t, d: g.d, tv: g.tv !== false, status: g.st,
      final: g.st === 'final' && typeof g.sa === 'number' && typeof g.sh === 'number' ? { away: g.sa, home: g.sh } : null,
      ot: g.ot || '', bc: g.bc || [], sched: true,
    }));
    const byDate = {}, byTeam = {}, byId = {};
    games.forEach((g) => {
      (byDate[g.d] = byDate[g.d] || []).push(g);
      byId[g.gid] = g;
      [g.away, g.home].forEach((c) => (byTeam[c] = byTeam[c] || []).push(g));
    });
    return { games, byDate, byTeam, byId, weeks: raw.weeks || [], byes: raw.byes || {}, raw };
  }
  const schedData = (sp) => { const e = store.sched[sp]; return e && e.st === 'ok' ? e.data : null; };
  // W-L (NHL W-L-OTL, NFL W-L-T) from schedule finals strictly before `date`
  function recOf(sp, code, date) {
    const sd = schedData(sp);
    if (!sd) return null;
    let w = 0, l = 0, o = 0, t = 0;
    (sd.byTeam[code] || []).forEach((g) => {
      if (g.status !== 'final' || !g.final || g.d >= date) return;
      const mine = g.final[g.away === code ? 'away' : 'home'], other = g.final[g.away === code ? 'home' : 'away'];
      if (mine > other) w++;
      else if (mine < other) { if (sp === 'nhl' && g.ot) o++; else l++; } else t++;
    });
    return w + '-' + l + (sp === 'nhl' ? '-' + o : '') + (sp === 'nfl' && t ? '-' + t : '');
  }
  const etDay = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
  // record shown on cards/headers: schedule-based (matches every day), days-file W-L only if the schedule is missing
  function recFor(sp, g, side) {
    const date = g.d || (g.kickoff ? etDay(g.kickoff) : null);
    return (date && recOf(sp, g[side], date)) || (g.rec && g.rec[side]) || null;
  }
  function schedGames(sp, date) {
    const sd = schedData(sp);
    return ((sd && sd.byDate[date]) || []).map((g) => Object.assign({}, g, { rec: { away: recOf(sp, g.away, date), home: recOf(sp, g.home, date) } }));
  }
  function gameDays(sp) {
    const out = new Set(), sd = schedData(sp);
    if (sd) Object.keys(sd.byDate).forEach((d) => out.add(d));
    const list = store.idx && store.idx.sports && store.idx.sports[sp] && store.idx.sports[sp].days;
    if (Array.isArray(list)) list.forEach((d) => out.add(d));
    return out;
  }
  // selected day: remembered pick, else today if it has games, else the most recent game day before today
  function selDate(sp) {
    if (state.sel[sp]) return state.sel[sp];
    const days = [...gameDays(sp)].sort(), t = ymd(0);
    if (days.includes(t)) return t;
    const before = days.filter((d) => d < t);
    return before.length ? before[before.length - 1] : (days.find((d) => d > t) || t);
  }
  const weekOf = (sp, date) => {
    const sd = schedData(sp);
    return sd ? sd.weeks.find((w) => w.start <= date && date <= w.end) : null;
  };
  const tinfo = (sp, code) => {
    const m = store.meta[sp];
    return (m && m.data && m.data[code]) || {};
  };
  const timeFmt = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });
  const fmtTime = (iso) => {
    const d = new Date(iso);
    return isNaN(d) ? '—' : timeFmt.format(d).replace(/[  ]/g, ' ');
  };
  const numStr = (v) => (typeof v === 'number' && isFinite(v) ? String(v) : null);
  function lineParts(g) {
    const ln = g.line || {}, out = [];
    const sp = numStr(ln.spread), tot = numStr(ln.total);
    if (sp !== null) {
      if (ln.spread === 0) out.push('PK');
      else if (ln.fav) out.push(esc(ln.fav) + ' ' + MINUS + esc(sp));
    }
    if (tot !== null) out.push('O/U ' + esc(tot));
    return out;
  }
  function findGame(sp, id) {
    for (const k in store.days) {
      const e = store.days[k];
      if (e.sp === sp && e.st === 'ok') {
        const g = ((e.data || {}).games || []).find((x) => x.gid === id);
        if (g) return { g, day: e.data.games, date: e.date };
      }
    }
    const sd = schedData(sp), sg = sd && sd.byId[id];
    if (sg) {
      const day = schedGames(sp, sg.d);
      return { g: day.find((x) => x.gid === id), day, date: sg.d };
    }
    return null;
  }
  // true while a game lookup could still succeed
  function lookupPending(sp) {
    const dates = [selDate(sp)];
    const list = store.idx && store.idx.sports && store.idx.sports[sp] && store.idx.sports[sp].days;
    if (Array.isArray(list)) dates.push(...list.slice(-7).reverse());
    let pending = !store.idxDone || ensureSched(sp).st === 'loading';
    new Set(dates).forEach((d) => { if (ensureDay(sp, d).st === 'loading') pending = true; });
    return pending;
  }

  // team badge: live = colored with logo; otherwise muted grey (code text fallback)
  function tbadge(sp, code, cls, href, live) {
    const t = tinfo(sp, code);
    const col = /^#[0-9a-f]{6}$/i.test(t.color || '') ? t.color : '';
    const inner = t.logo ? `<img src="${esc(t.logo)}" alt="${esc(code)}" loading="lazy" decoding="async">` : esc(code);
    const c = `tb ${cls || ''} ${live ? 'live' : ''}`;
    const st = live && col ? ` style="--tc:${col}"` : '';
    return href
      ? `<a class="${c}"${st} href="${href}" aria-label="${esc(code)} team page">${inner}</a>`
      : `<span class="${c}"${st}>${inner}</span>`;
  }
  view.addEventListener('error', (e) => {
    const im = e.target;
    if (im && im.tagName === 'IMG' && im.closest('.tb')) im.replaceWith(document.createTextNode(im.alt || ''));
  }, true);

  // ---- tags (team + player): stored ones come from the defense file; schedule / injury / goalie / matchup tags depend on the day viewed ----
  const SH = '<path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z"/>';
  const TAG_SVG = {
    'def-up': SH + '<path d="M9 13.5l3-3 3 3"/>', 'def-down': SH + '<path d="M9 10l3 3 3-3"/>',
    'pace-up': '<path d="M6 6l6 6-6 6M13 6l6 6-6 6"/>', 'pace-down': '<path d="M18 6l-6 6 6 6M11 6l-6 6 6 6"/>',
    'trend-up': '<path d="M4 16l5-5 4 4 7-7M15 8h5v5"/>', 'trend-down': '<path d="M4 8l5 5 4-4 7 7M15 16h5v-5"/>',
    b2b: '<rect x="3" y="8" width="16" height="8" rx="2"/><path d="M21 11v2M7 11v2"/>',
    rest: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
    road: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5h6v2"/>',
    travel: '<circle cx="12" cy="12" r="8"/><path d="M4 12h16M12 4c2.5 2.5 2.5 13.5 0 16M12 4c-2.5 2.5-2.5 13.5 0 16"/>',
    short: '<path d="M10 4h4v6h6v4h-6v6h-4v-6H4v-4h6z"/>',
    bkg: '<path d="M6 4h12v8a6 6 0 0 1-12 0z"/><path d="M9 9h6M12 9v5"/>',
    q: '<path d="M9 9a3 3 0 1 1 4 2.8c-.7.3-1 .9-1 1.6V15M12 19h.01"/>',
    back: '<path d="M9 14l-4-4 4-4"/><path d="M5 10h9a5 5 0 0 1 0 10h-2"/>',
    usage: '<circle cx="12" cy="12" r="8"/><path d="M12 16V8M8.5 11.5L12 8l3.5 3.5"/>',
    'min-up': '<circle cx="12" cy="13" r="7"/><path d="M12 10v3l2 1.5M12 3v3"/>', 'min-down': '<circle cx="12" cy="13" r="7"/><path d="M12 10v3l-2 1.5M12 3v3"/>',
    vol: '<path d="M3 12l4-6 4 12 4-12 4 6"/>', steady: '<path d="M4 12h16"/><path d="M4 8h16M4 16h16" stroke-opacity=".4"/>',
    new: '<path d="M7 7h11l-3-3M17 17H6l3 3"/>', favm: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>',
  };
  // categories (user 10/31 16:02): colors by kind of information, never good/bad (a tag can help an over and hurt an under)
  const TAG_CAT = { def: 'match', pace: 'match', favm: 'match', trend: 'form', b2b: 'sched', rest: 'sched', road: 'sched', travel: 'sched',
    short: 'avail', bkg: 'avail', q: 'avail', back: 'avail', usage: 'role', min: 'role', vol: 'role', steady: 'role', new: 'role' };
  const TAG_ORDER = ['q', 'short', 'bkg', 'usage', 'favm', 'def', 'trend', 'pace', 'back', 'min', 'b2b', 'travel', 'road', 'rest', 'vol', 'steady', 'new'];
  const tagKind = (id) => id.split('_')[0];
  const tagCat = (t) => TAG_CAT[tagKind(t.id)] || 'role';
  const tagSort = (xs) => xs.sort((a, b) => TAG_ORDER.indexOf(tagKind(a.id)) - TAG_ORDER.indexOf(tagKind(b.id)));
  const tagReg = {}; // popover texts of the tags rendered now (key -> { label, detail, rule })
  function tagRule(sport, id) {
    const k = tagKind(id), P = id.split('_')[1] || '';
    let r = ((window.GLOSSARY || {}).tags || {})[k];
    if (r && typeof r === 'object') r = r[sport];
    return r ? String(r).replace(/%P/g, P) : '';
  }
  // UTC offset (minutes) of an IANA zone at an instant, from the browser's tz database; null when unknown
  function tzOff(tz, iso) {
    try {
      const s = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' }).formatToParts(new Date(iso)).find((x) => x.type === 'timeZoneName').value;
      const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(s);
      return m ? (m[1] === '-' ? -1 : 1) * (+m[2] * 60 + +(m[3] || 0)) : 0;
    } catch (e) { return null; }
  }
  // all tags of a team for a game day (sg = that day's slate game, else null); [] without the defense file
  function teamTags(sport, code, date, sg) {
    const dd = defData(sport);
    if (!dd || !code) return [];
    const t = dd.teams[code] || {};
    const out = (t.tags || []).slice();
    const sd = schedData(sport);
    const tg = sd && date ? (sd.byTeam[code] || []).find((g) => g.d === date) : null;
    if (date) {
      const rd = restDays(sport, code, date);
      const prior = sd ? (sd.byTeam[code] || []).filter((g) => g.d < date && g.status !== 'post') : [];
      const in4 = prior.filter((g) => (dnoon(date) - dnoon(g.d)) / 864e5 <= 3).length;
      if (rd === 0) out.push({ id: 'b2b', label: 'Back-to-back', detail: 'Played yesterday' + (sport === 'nba' && in4 >= 2 ? '; 3rd game in 4 nights' : '') });
      else if (sport === 'nba' && in4 >= 2) out.push({ id: 'b2b', label: '3 in 4 nights', detail: '3rd game in 4 nights' });
      else if (rd !== null && rd >= 3) out.push({ id: 'rest', label: 'Well rested', detail: rd + ' days since the last game' });
      if (tg && tg.away === code) {
        const seq = (sd.byTeam[code] || []).filter((g) => g.d <= date && g.status !== 'post').sort((x, y) => (x.d < y.d ? -1 : 1));
        let k = 0;
        for (let i = seq.length - 1; i >= 0 && seq[i].away === code; i--) k++;
        if (k >= 4) out.push({ id: 'road', label: 'Long road trip', detail: 'Road game ' + k + ' in a row' });
        const home = (dd.teams[tg.home] || {}).tz;
        if (t.tz && home && tg.kickoff) {
          const a = tzOff(t.tz, tg.kickoff), h = tzOff(home, tg.kickoff);
          if (a !== null && h !== null && Math.abs(a - h) >= 120) out.push({ id: 'travel', label: 'Time-zone travel', detail: Math.round(Math.abs(a - h) / 60) + ' time zones ' + (h < a ? 'west' : 'east') });
        }
      }
    }
    if (sg && (sg.home === code || sg.away === code)) {
      const side = sg.home === code ? 'B' : 'A';
      const n = ((sg.inj || {})[side] || []).filter((x) => parseInj(x).status.toLowerCase() === 'out').length;
      if (n >= 2) out.push({ id: 'short', label: 'Shorthanded', detail: n + ' players out' });
      const gl = (sg.goalies || {})[side], dep = t.goalies || [];
      if (sport === 'nhl' && gl && gl.name && dep.length) {
        const me = dep.find((x) => gl.id && String(x.id) === String(gl.id));
        const g1 = dep[0], sv = (x) => (x.svp ? ', ' + x.svp.toFixed(3).replace(/^0/, '') + ' sv%' : '');
        if (!me || me.depth > 1) out.push({ id: 'bkg', label: me ? '#' + me.depth + ' G starting' : 'Call-up G starting',
          detail: gl.name + (me ? ' (#' + me.depth + ': ' + me.starts + ' starts in ' + t.games + ' games' + sv(me) + ')' : ' (no games this season)') + '; #1 ' + g1.name + ' (' + g1.starts + ' starts' + sv(g1) + ')' });
      }
    }
    return tagSort(out);
  }
  // all tags of a player for a game day: stored (trend, minutes, back, volatile/steady, new team) + tonight's (questionable, usage, matchup)
  function playerTags(sport, pid, date, sg, pinj, team) {
    const dd = defData(sport);
    if (!dd || !pid) return [];
    const e = dd.players[pid] || {};
    const out = (e.tags || []).slice();
    const st = String(pinj || '').toLowerCase();
    if (/questionable|day-to-day|doubtful/.test(st)) out.push({ id: 'q', label: pinj, detail: 'On tonight’s injury report' });
    if (sg && team && (sg.home === team || sg.away === team)) {
      const side = sg.home === team ? 'B' : 'A';
      const outs = ((sg.inj || {})[side] || []).map((x) => /^(.*?)\s*\((star|starter),\s*Out\b/i.exec(x)).filter(Boolean);
      if (outs.length) out.push({ id: 'usage', label: 'Usage up', detail: outs.map((m) => m[1] + ' (' + m[2] + ')').join(', ') + ' out' });
      const opp = side === 'B' ? sg.away : sg.home, P = e.pos;
      const dt = (((dd.teams[opp] || {}).tags) || []).find((x) => x.id === 'def_' + P && x.dir === 'down');
      if (dt) out.push({ id: 'favm', label: 'vs #' + dt.rank + ' DEF (' + P + ')', detail: opp + ': ' + dt.detail });
    }
    return tagSort(out);
  }
  const tagIcon = (t) => `<svg viewBox="0 0 24 24" aria-hidden="true">${TAG_SVG[tagKind(t.id) + (t.dir ? '-' + t.dir : '')] || TAG_SVG[tagKind(t.id)] || ''}</svg>`;
  function tagAttr(sport, code, t, ctx) {
    const key = [sport, code, t.id, ctx].join('|');
    tagReg[key] = { label: t.label, detail: t.detail || '', rule: tagRule(sport, t.id) };
    return `data-tag="${esc(key)}" role="button" tabindex="0"`;
  }
  const tagChip = (sport, code, t, ctx) => `<span class="tgc tg-${tagCat(t)}" ${tagAttr(sport, code, t, ctx)} aria-label="${esc(t.label)}">${tagIcon(t)}</span>`;
  const tagPill = (sport, code, t, ctx) => `<span class="tgp tg-${tagCat(t)}" ${tagAttr(sport, code, t, ctx)}>${tagIcon(t)}${esc(t.label)}</span>`;
  const tagRows = (sport, code, tags) => (tags.length ? `<div class="card tgrows">${tags.map((t) => `<div class="tgr tg-${tagCat(t)}" ${tagAttr(sport, code, t, 'team')}><span class="tgc tg-${tagCat(t)}">${tagIcon(t)}</span><span class="tgr-t"><b>${esc(t.label)}</b><small>${esc(t.detail || '')}</small></span><span class="tgr-i" aria-hidden="true">i</span></div>`).join('')}</div>`
    : '<div class="card empty"><p>No tags for this team right now.</p></div>');
  // the day's slate game for the Shorthanded count (public slate of that day; none when not published)
  function slateGame(sport, date, gid) {
    const s = store.idx && store.idx.sports && store.idx.sports[sport];
    if (!date || !s || !(s.slates || []).includes(date)) return null;
    const e = ensureSlate(sport, date);
    return e.st === 'ok' && e.data && e.data.games ? e.data.games[gid] || null : null;
  }
  // one popover at a time, fixed under the tapped tag; closes on outside tap, scroll, or a new render
  let tagPop = null, tagKey = '';
  function closeTag() { if (tagPop) { tagPop.remove(); tagPop = null; tagKey = ''; } }
  function openTag(el) {
    const key = el.dataset.tag;
    if (tagKey === key) { closeTag(); return; }
    closeTag();
    const r = tagReg[key];
    if (!r) return;
    const p = document.createElement('div');
    p.className = 'tagpop';
    p.setAttribute('role', 'dialog');
    p.innerHTML = `<b>${esc(r.label)}</b>${r.detail ? `<span class="tp-d">${esc(r.detail)}</span>` : ''}${r.rule ? `<span class="tp-r">${esc(r.rule)}</span>` : ''}`;
    document.body.appendChild(p);
    const b = el.getBoundingClientRect(), w = p.offsetWidth, h = p.offsetHeight;
    const nav = $('nav').offsetHeight;
    let top = b.bottom + 8;
    if (top + h > innerHeight - nav - 6) top = Math.max(8, b.top - h - 8);
    p.style.left = Math.max(8, Math.min(b.left + b.width / 2 - w / 2, innerWidth - w - 8)) + 'px';
    p.style.top = top + 'px';
    tagPop = p; tagKey = key;
  }
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-tag]');
    if (el) { e.preventDefault(); e.stopPropagation(); openTag(el); return; }
    if (tagPop && !e.target.closest('.tagpop')) closeTag();
  }, true);
  document.addEventListener('keydown', (e) => {
    const el = e.target.closest && e.target.closest('[data-tag]');
    if (el && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openTag(el); } else if (e.key === 'Escape') closeTag();
  });
  window.addEventListener('scroll', closeTag, { passive: true });

  // ---- views ----
  function sportRoot(sport) {
    const m = ensureMeta(sport), sc = ensureSched(sport);
    const head = `<div class="sechead"><h2>Games</h2><a class="textlink" href="#${sport}/standings">Standings &#8250;</a></div>`;
    if (!store.idxDone || sc.st === 'loading') return `<div class="dates" aria-hidden="true"><div class="pills">${'<button disabled><span class="d">&nbsp;</span><span class="s">&nbsp;</span></button>'.repeat(5)}</div></div>${head}${skList(sport)}`;
    const sel = selDate(sport), today = ymd(0), end = ymd(sport === 'nfl' ? 7 : 2);
    const days = new Set([...gameDays(sport)].filter((d) => d <= end));
    days.add(sel);
    const pill = (d) => `<button data-day="${d}" class="${d === sel ? 'on' : ''}" aria-pressed="${d === sel}"><span class="d">${d === today ? 'TODAY' : dowOf(d)}</span><span class="s">${mdOf(d)}</span></button>`;
    const wk = sport === 'nfl' ? weekOf(sport, sel) : null;
    const label = wk ? `<span class="lbl wk-lbl">WEEK ${wk.w}</span>` : '';
    return `<div class="dates"><div class="pills ${sport}" aria-label="Game days">${[...days].sort().map(pill).join('')}</div></div>
      ${head}${label}${dayList(sport, sel, m)}`;
  }

  const skList = (sport) => `<div class="glist">${PAIRS[sport].map(([aw, hm]) => `<div class="grow" aria-hidden="true"><span class="teams">
        <span class="tline">${badge(aw)}${bar('w55')}<span class="rec">—</span></span>
        <span class="tline">${badge(hm)}${bar('w70')}<span class="rec">—</span></span></span>
        <span class="tcol">${bar('w85')}${bar('w55')}</span></div>`).join('')}</div>`;

  function dayList(sport, date, m) {
    const d = ensureDay(sport, date);
    if (d.st === 'loading' || m.st === 'loading') return skList(sport);
    if (d.st === 'err') return `<div class="card empty"><h2>Couldn’t load games</h2><p>Check your connection and try again.</p><button class="pillbtn retry" data-retry="${esc(sport + '/' + date)}">Retry</button></div>`;
    const games = d.st === 'ok' ? ((d.data && d.data.games) || []) : [];
    if (games.length) return `<div class="glist">${games.map((g) => gameCard(sport, g)).join('')}</div>`;
    const sg = schedGames(sport, date);
    if (sg.length) return `<div class="glist">${sg.map((g) => gameCard(sport, g)).join('')}</div>`;
    return `<div class="card empty"><h2>No games ${esc(longOf(date))}</h2><p>${store.sched[sport].st === 'err' ? 'The schedule could not be loaded.' : 'Nothing scheduled for this day.'}</p></div>`;
  }

  const ktxt = (g) => (g.tv === false ? 'TBD' : fmtTime(g.kickoff));
  function sideCol(g) {
    const parts = lineParts(g), st = g.status || 'scheduled';
    let top;
    if (st === 'final') top = `<span class="lbl">Final${g.ot ? '/' + esc(g.ot) : ''}</span>`;
    else if (st === 'pending') top = '<span class="lbl amber">Final pending</span>';
    else if (st === 'live') top = '<span class="lbl amber">Live</span>';
    else if (st === 'post') top = '<span class="lbl">Postponed</span>';
    else if (st === 'scheduled') top = `<span class="ktime">${esc(ktxt(g))}</span>`;
    else top = `<span class="lbl">${esc(st)}</span>`;
    const bc = st === 'scheduled' && g.bc && g.bc[0] ? `<span class="kline">${esc(g.bc[0])}</span>` : '';
    return `${top}${bc}${parts.map((p) => `<span class="kline">${p}</span>`).join('')}`;
  }
  function teamRow(sport, g, side, tags) {
    const code = g[side] || '—', t = tinfo(sport, code);
    const chips = tags && tags.length ? `<span class="tchips">${tags.slice(0, 3).map((x) => tagChip(sport, code, x, 'gc' + g.gid)).join('')}</span>` : '';
    const rec = recFor(sport, g, side);
    let score = '';
    if (g.status === 'final' && g.final) {
      const mine = g.final[side], other = g.final[side === 'away' ? 'home' : 'away'];
      score = `<span class="score ${mine > other ? 'w' : 'l'}">${esc(mine)}</span>`;
    }
    return `<span class="tline">${tbadge(sport, code, '', '', true)}<span class="rec">${esc(rec || '—')}</span><span class="tn">${esc(t.short || '')}</span>${chips}${score}</span>`;
  }
  function gameCard(sport, g) {
    const b = g.bets || {}, n = b.n || 0, sp = b['S+'] || 0;
    const rated = sp + (b.A || 0) + (b.B || 0);
    const bline = n ? `<span class="bline">${esc(n)} bets${rated ? ` · ${esc(rated)} rated` : ''}</span>` : '';
    const acc = sp > 0 ? `<span class="acc-badge" role="img" aria-label="S+ value in this game">★ S+</span>` : '';
    let ta = null, th = null;
    if (sport !== 'nfl' && g.status !== 'final' && g.status !== 'post') {
      ensureDef(sport);
      const date = g.d || (g.kickoff ? etDay(g.kickoff) : '');
      const sg = slateGame(sport, date, g.gid);
      ta = teamTags(sport, g.away, date, sg); th = teamTags(sport, g.home, date, sg);
    }
    return `<a class="gcard${acc ? ' has-acc' : ''}" href="#${sport}/game/${encodeURIComponent(g.gid)}" aria-label="${esc(g.away)} at ${esc(g.home)}">${acc}
      <span class="gc-main"><span class="teams">${teamRow(sport, g, 'away', ta)}${teamRow(sport, g, 'home', th)}</span>
      <span class="gc-side">${sideCol(g)}</span></span>${bline}</a>`;
  }

  function standings(sport) {
    return `<div class="pagehead">${backBtn}<h2>${SPORTS[sport]} Standings</h2></div>
      ${empty('Standings', 'Standings', 'Standings land with the data step.', 0)}`;
  }

  const mvbSlate = (sport, date) => { const e = ensureSlate(sport, date); return e.st === 'ok' ? e.data || {} : null; };
  function liveGameView(sport, id) {
    ensureMeta(sport);
    const f = findGame(sport, id);
    if (!f) {
      if (lookupPending(sport) || store.meta[sport].st === 'loading') {
        return `<div class="pagehead">${backBtn}</div>${rowsGeneric(3)}`;
      }
      history.replaceState(null, '', '#' + sport);
      stack[stack.length - 1] = '#' + sport;
      cur = parse();
      return sportRoot(sport);
    }
    if (store.meta[sport].st === 'loading') return `<div class="pagehead">${backBtn}</div>${rowsGeneric(3)}`;
    const g = f.g, aw = g.away || '—', hm = g.home || '—';
    const chips = f.day.map((x) => `<a class="chip ${x.gid === g.gid ? 'on' : ''}" href="#${sport}/game/${encodeURIComponent(x.gid)}" ${x.gid === g.gid ? 'aria-current="true"' : ''}>${esc(x.away)} @ ${esc(x.home)}<small>${esc(ktxt(x))}</small></a>`).join('');
    const tab = state.gameTab;
    let body;
    state.betGid = g.gid;
    if (tab === 'bets') body = betsTab(sport, f.date);
    else if (tab === 'game') body = gameTab(sport, f.date, g);
    else body = rosterTab(sport, f.date, g, tab === 'away' ? aw : hm);
    const fin = g.status === 'final' && g.final;
    const center = fin
      ? `<span class="big fin">${esc(g.final.away)}<i>–</i>${esc(g.final.home)}</span><span class="lbl">Final${g.ot ? '/' + esc(g.ot) : ''}</span>`
      : g.status === 'post' ? '<span class="big">—</span><span class="lbl">Postponed</span>'
        : `<span class="big">${esc(ktxt(g))}</span>${g.status === 'pending' ? '<span class="lbl amber">Final pending</span>' : g.status === 'live' ? '<span class="lbl amber">Live</span>' : ''}${g.status === 'scheduled' && g.bc && g.bc[0] ? `<span class="kline">${esc(g.bc[0])}</span>` : ''}`;
    const lp = headLineParts(g, mvbSlate(sport, f.date)).map((p) => `<span class="kline">${p}</span>`).join('');
    const team = (code, side) => `<div class="gteam">${tbadge(sport, code, 'l', `#${sport}/team/${encodeURIComponent(code)}`, false)}
      <span class="rec">${esc(recFor(sport, g, side) || '—')}</span><span class="tn">${esc(tinfo(sport, code).short || '')}</span></div>`;
    return `<div class="pagehead">${backBtn}<div class="chips" aria-label="Games this day">${chips}</div></div>
      <div class="ghead">${team(aw, 'away')}<div class="gcenter">${center}${lp}</div>${team(hm, 'home')}</div>
      ${mvbCard(sport, g, mvbSlate(sport, f.date))}
      <div class="subtabs">${segmented(TABS.map(([k, l]) => [k, k === 'away' ? aw : k === 'home' ? hm : l]), tab, 'data-sub')}</div>
      ${body}`;
  }
  // ---- game Game tab: model projection, team comparison, injuries, goalies ----
  const CMP_SPLITS = [['season', 'Season'], ['l5', 'Last 5'], ['ha', 'Home/Road']];
  // [key, label, kind ('pct' = fraction shown as %), lowerIsBetter]
  const CMP_STATS = {
    nba: [['tt', 'PPG'], ['oppg', 'Opp PPG', '', 1], ['pace', 'Pace'], ['ortg', 'ORtg'], ['drtg', 'DRtg', '', 1], ['net', 'Net'],
      ['efg', 'eFG%', 'pct'], ['tp', '3P%', 'pct'], ['reb', 'REB'], ['tovp', 'TOV%', 'pct', 1]],
    nhl: [['gf', 'GF'], ['ga', 'GA', '', 1], ['sf', 'SF'], ['sa', 'SA', '', 1], ['sv', 'SV%', 'pct'], ['sh', 'SH%', 'pct'], ['pdo', 'PDO']],
  };
  // small tappable info icon + its note (generic: any label whose key has a text in `defs`)
  const infoBtn = (sport, key, defs) => (defs && defs[key]
    ? `<button class="info" data-info="${esc(sport + '/' + key)}" aria-expanded="${!!state.infoOpen[sport + '/' + key]}" aria-label="What is this?">i</button>` : '');
  const infoNote = (sport, key, defs) => (defs && defs[key] && state.infoOpen[sport + '/' + key] ? `<div class="info-note">${esc(defs[key])}</div>` : '');
  const projOf = (sg) => {
    for (const k of ['close', 'open']) {
      const p = sg && sg['proj_' + k];
      if (p && !p.err && isNum(p.away) && isNum(p.home) && isNum(p.total)) return { p, tag: k };
    }
    return null;
  };
  // ---- Model vs Book card (NBA + NHL), shown above the game tabs ----
  const MVB_DEFS = {
    mvb: 'Model = our projection. Book = DraftKings line. Edge = how far apart they are. Grades and EV for game lines stay hidden until they pass the calibration check.',
    winpct: 'Book win % is the moneyline price turned into a probability, with the bookmaker’s cut removed so both sides add to 100%. Edge = how many percentage points our model is above or below it.',
  };
  // latest phase of each game-line bet: { stat: { side: { line, odds } } } (close if present, else open)
  // game header line: latest phase (close, else open) of the game-line bets, like the Model vs Book card (user 10/31 16:44); else the day file's line
  function headLineParts(g, slate) {
    const bk = slate ? bookLines(slate, g.gid) : {}, out = [];
    const sA = bk.spread && bk.spread.A ? bk.spread.A.line : null, sB = bk.spread && bk.spread.B ? bk.spread.B.line : null;
    const lA = isNum(sA) ? sA : isNum(sB) ? -sB : null;
    const tl = bk.total ? ((bk.total.o || {}).line ?? (bk.total.u || {}).line) : null;
    if (!isNum(lA) && !isNum(tl)) return lineParts(g);
    if (isNum(lA)) out.push(lA === 0 ? 'PK' : esc(lA < 0 ? g.away : g.home) + ' ' + MINUS + esc(String(Math.abs(lA))));
    if (isNum(tl)) out.push('O/U ' + esc(String(tl)));
    return out;
  }
  function bookLines(slate, gid) {
    const out = {};
    Object.values(slate.bets || {}).forEach((b) => {
      if (!b || b.type !== 'game' || String(b.gid) !== String(gid)) return;
      const has = (p) => p && (isNum(p.line) || isNum(p.odds));
      const ph = has(b.close) ? b.close : b.open;
      if (!has(ph)) return;
      (out[b.stat] = out[b.stat] || {})[b.side] = { line: isNum(ph.line) ? ph.line : null, odds: isNum(ph.odds) ? ph.odds : null };
    });
    return out;
  }
  // 0 = gray, 1 = lean, 2 = strong
  const edgeLevel = (m, th) => (!th ? 0 : m >= th[1] ? 2 : m >= th[0] ? 1 : 0);
  function edgeChip(txt, lv, sub) {
    return `<span class="edge-c"><span class="edge lv${lv}">${txt}</span>${sub ? `<small>${sub}</small>` : ''}</span>`;
  }
  const impProb = (o) => (o > 0 ? 100 / (o + 100) : -o / (-o + 100));
  function mvbCard(sport, g, slate) {
    if (sport !== 'nba' && sport !== 'nhl') return '';
    const sg = slate && slate.games ? slate.games[g.gid] : null;
    const pr = projOf(sg);
    if (!pr) return '';
    const { p } = pr, dp = sport === 'nhl' ? 2 : 1, T = EDGE_T[sport];
    const bk = bookLines(slate, g.gid);
    const mg = isNum(p.margin) ? p.margin : p.away - p.home; // away - home
    const side = (v) => (v > 0 ? g.away : g.home);
    const book = (stat, sd) => (bk[stat] && bk[stat][sd]) || null;
    const rows = [];
    // spread row
    let lA = book('spread', 'A') ? book('spread', 'A').line : null, lB = book('spread', 'B') ? book('spread', 'B').line : null;
    if (!isNum(lA) && isNum(lB)) lA = -lB;
    if (!isNum(lB) && isNum(lA)) lB = -lA;
    const evenM = Math.abs(mg) < 0.05;
    if (isNum(lA)) {
      const bm = -lA; // book margin, away - home
      const d = mg - bm, ad = Math.abs(d), lv = ad < 0.05 ? 0 : edgeLevel(ad, T.spread);
      rows.push({
        label: 'Spread',
        book: bm === 0 ? 'PK' : `${esc(side(bm))} ${MINUS}${Math.abs(bm)}`,
        model: evenM ? 'Even' : `${esc(side(mg))} ${MINUS}${Math.abs(mg).toFixed(dp)}`,
        chip: ad < 0.05 ? edgeChip('Even', 0) : edgeChip(`${esc(side(d))} +${ad.toFixed(dp)} pts`, lv),
      });
    }
    // total + team totals
    const lineOf = (stat) => { const b = book(stat, 'o') || book(stat, 'u'); return b && isNum(b.line) ? b.line : null; };
    [['total', 'Total', p.total, T.total], ['ttA', g.away + ' total', p.away, T.tt], ['ttB', g.home + ' total', p.home, T.tt]].forEach(([stat, label, model, th]) => {
      const bl = lineOf(stat);
      if (bl === null || !isNum(model)) return;
      const d = model - bl, ad = Math.abs(d), pct = bl ? ad / bl * 100 : 0;
      rows.push({
        label: esc(label), book: String(bl), model: model.toFixed(dp),
        chip: ad < 0.05 ? edgeChip('Even', 0) : edgeChip(`${d > 0 ? 'Over' : 'Under'} ${ad.toFixed(dp)}`, edgeLevel(pct, th), `${pct.toFixed(1)}%`),
      });
    });
    // win %
    const oA = book('ml', 'A') ? book('ml', 'A').odds : null, oB = book('ml', 'B') ? book('ml', 'B').odds : null;
    if (isNum(p.winAway) && isNum(p.winHome) && isNum(oA) && isNum(oB)) {
      const ia = impProb(oA), ib = impProb(oB), na = ia / (ia + ib) * 100, nb = 100 - na;
      const favAway = na >= nb, ft = favAway ? g.away : g.home, ot = favAway ? g.home : g.away;
      const bv = favAway ? na : nb, mv = favAway ? p.winAway : p.winHome, d = mv - bv, ad = Math.abs(d);
      rows.push({
        label: 'Win %', info: 'winpct', book: `${esc(ft)} ${bv.toFixed(1)}%`, model: `${esc(ft)} ${mv.toFixed(1)}%`,
        chip: ad < 0.05 ? edgeChip('Even', 0) : edgeChip(`${esc(d > 0 ? ft : ot)} +${ad.toFixed(1)}`, edgeLevel(ad, T.win), 'win % pts'),
      });
    }
    const score = (code, v) => `<span class="mvb-t"><span class="pc">${esc(code)}</span><b>${v.toFixed(dp)}</b></span>`;
    const table = rows.length ? `<div class="mvb-tab"><span class="mvb-h"></span><span class="mvb-h">Book</span><span class="mvb-h">Model</span><span class="mvb-h">Edge</span>${rows.map((r) =>
      `<span class="mvb-lab">${r.label}${r.info ? infoBtn(sport, r.info, MVB_DEFS) : ''}</span><span class="mvb-v">${r.book}</span><span class="mvb-v mod">${r.model}</span>${r.chip}`).join('')}</div>` : '';
    return `<div class="card mvb"><div class="mvb-top"><span class="lbl">Projected score</span>${infoBtn(sport, 'mvb', MVB_DEFS)}</div>
      ${infoNote(sport, 'mvb', MVB_DEFS)}
      <div class="mvb-score">${score(g.away, p.away)}<i>–</i>${score(g.home, p.home)}</div>${table}${rows.filter((r) => r.info).map((r) => infoNote(sport, r.info, MVB_DEFS)).join('')}</div>`;
  }
  const fmtStat = (v, kind) => (isNum(v) ? (kind === 'pct' ? (v * 100).toFixed(1) + '%' : v.toFixed(1)) : '—');
  // team bar colors for the comparison: readable on the dark card, distinct from each other
  const hexRgb = (h) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(h || '')); return m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) : null; };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const cdist = (a, b) => Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
  const lighten = (c, t) => c.map((v) => Math.round(v + (255 - v) * t));
  const rgbStr = (c) => `rgb(${c.join(',')})`;
  function teamTone(m) { // primary, or alt when the primary is too dark; lightened if still dark
    const p = hexRgb(m && m.color), a = hexRgb(m && m.alt);
    let c = p && lum(p) >= 0.07 ? p : a && lum(a) >= 0.07 && lum(a) < 0.9 ? a : p || a;
    if (c && lum(c) < 0.07) c = lighten(c, 0.45);
    return c;
  }
  function cmpColors(sport, g) {
    const md = store.meta[sport] && store.meta[sport].st === 'ok' ? (store.meta[sport].data || {}) : {};
    let ca = teamTone(md[g.away]), ch = teamTone(md[g.home]);
    const NEUTRAL = [142, 166, 156];
    if (ca && ch && cdist(ca, ch) < 90) { // clash: away tries its other color, else neutral
      const alt = hexRgb(md[g.away] && md[g.away].alt);
      ca = alt && lum(alt) >= 0.07 && lum(alt) < 0.9 && cdist(alt, ch) >= 90 ? alt : NEUTRAL;
    }
    return [rgbStr(ca || NEUTRAL), rgbStr(ch || NEUTRAL)];
  }
  // population standard deviation of one stat across all teams for the split in use (Home/Road pools every team's home and away values); 0 = not enough data
  function teamSd(tm, split, k) {
    const sets = split === 'ha' ? ['home', 'away'] : [split];
    const xs = [];
    Object.values(tm).forEach((t) => sets.forEach((sk) => { const v = ((t && t.split) || {})[sk]; if (v && isNum(v[k])) xs.push(v[k]); }));
    if (xs.length < 5) return 0;
    const mean = xs.reduce((x, y) => x + y, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((x, y) => x + (y - mean) ** 2, 0) / xs.length);
    return sd > 0 ? sd : 0;
  }
  function cmpCard(sport, g) {
    const te = ensureTeams(sport);
    if (te.st === 'loading') return sec('Team comparison') + skRows(3);
    const tm = te.st === 'ok' ? (te.data.teams || {}) : {};
    if (!tm[g.away] && !tm[g.home]) return sec('Team comparison') + `<div class="card empty"><h2>${te.st === 'err' ? 'Couldn’t load team stats' : 'No team stats yet'}</h2><p>${te.st === 'err' ? 'Check your connection and try again.' : 'Team stats show up here once they are published.'}</p></div>`;
    const sk = state.cmpSplit === 'ha' ? ['away', 'home'] : [state.cmpSplit, state.cmpSplit];
    const A = ((tm[g.away] || {}).split || {})[sk[0]] || {}, H = ((tm[g.home] || {}).split || {})[sk[1]] || {};
    const defs = te.data.defs || {};
    const rows = CMP_STATS[sport].filter(([k]) => isNum(A[k]) || isNum(H[k])).map(([k, label, kind, low]) => {
      const a = A[k], h = H[k];
      let share = 0.5, ba = false, bh = false, la = false, lh = false;
      if (isNum(a) && isNum(h)) {
        const sd = teamSd(tm, state.cmpSplit, k);
        if (sd) share = 0.5 + 0.4 * Math.tanh(0.75 * (a - h) / sd); // raw values: the bigger number gets the bigger bar
        const ta = fmtStat(a, kind), th = fmtStat(h, kind);
        if (a !== h) { ba = low ? a < h : a > h; bh = !ba; la = a > h; lh = !la; }
        if (ta === th) { ba = bh = la = lh = false; share = 0.5; }
      }
      return `<div><div class="cmp-top"><span class="v${ba ? ' best' : ''}">${fmtStat(a, kind)}</span><span class="lab">${esc(label)}${infoBtn(sport, k, defs)}</span><span class="v${bh ? ' best' : ''}">${fmtStat(h, kind)}</span></div>
        ${infoNote(sport, k, defs)}<div class="split tc"><i class="${la ? 'lead' : ''}" style="flex:${share}"></i><i class="${lh ? 'lead' : ''}" style="flex:${1 - share}"></i></div></div>`;
    });
    if (!rows.length) return sec('Team comparison') + '<div class="card empty"><h2>No team stats yet</h2><p>This split has no games played.</p></div>';
    const gp = (o) => (isNum(o.gp) ? o.gp : '—');
    ensureMeta(sport);
    const cc = cmpColors(sport, g);
    return `${sec('Team comparison')}<div class="cmp-head">${segmented(CMP_SPLITS, state.cmpSplit, 'data-cmp', 'cmpseg')}</div>
      <div class="card cmp" style="--ca:${cc[0]};--ch:${cc[1]}"><div class="cmp-teams"><span><b><i class="tdot a"></i>${esc(g.away)}</b><small>${gp(A)} GP</small></span><span><b>${esc(g.home)}<i class="tdot h"></i></b><small>${gp(H)} GP</small></span></div>${rows.join('')}</div>`;
  }
  const INJ_CLS = { out: 'bad', doubtful: 'bad', questionable: 'warn', 'day-to-day': 'warn', dtd: 'warn', probable: 'ok' };
  // "Name (starter, Questionable, Ankle)" -> { name, status, rest }
  function parseInj(str) {
    const m = /^(.*?)\s*\((.*)\)\s*$/.exec(String(str));
    if (!m) return { name: String(str), status: '', rest: '' };
    const parts = m[2].split(',').map((x) => x.trim()).filter(Boolean);
    const i = parts.findIndex((x) => INJ_CLS[x.toLowerCase()]);
    if (i < 0) return { name: m[1], status: '', rest: parts.join(', ') };
    return { name: m[1], status: parts[i], rest: parts.filter((_, j) => j !== i).join(', ') };
  }
  function injCol(code, list) {
    const items = (list || []).map(parseInj).map((x) => `<div class="inj-row"><span class="inj-n">${esc(x.name)}</span>
      <span class="inj-s ${INJ_CLS[x.status.toLowerCase()] || ''}">${esc(x.status || '—')}</span>${x.rest ? `<span class="inj-d">${esc(x.rest)}</span>` : ''}</div>`).join('');
    return `<div class="inj-col"><div class="lbl">${esc(code)}</div>${items || '<div class="bet-none">No injuries reported</div>'}</div>`;
  }
  function goalieCol(code, gl) {
    if (!gl || !gl.name) return `<div class="inj-col"><div class="lbl">${esc(code)}</div><div class="bet-none">—</div></div>`;
    const meta = [isNum(gl.sv) ? 'SV% ' + gl.sv.toFixed(3).replace(/^0/, '') : '', isNum(gl.gp) ? gl.gp + ' GP' : '', gl.why || ''].filter(Boolean).join(' · ');
    return `<div class="inj-col"><div class="lbl">${esc(code)}</div><div class="inj-row"><span class="inj-n">${esc(gl.name)}</span></div>${meta ? `<div class="inj-d">${esc(meta)}</div>` : ''}</div>`;
  }
  function gameTab(sport, date, g) {
    const se = ensureSlate(sport, date);
    const sg = se.st === 'ok' && se.data && se.data.games ? se.data.games[g.gid] : null;
    let out = cmpCard(sport, g);
    if (sg && sg.inj && (sg.inj.A || sg.inj.B)) out += `${sec('Injuries')}<div class="card inj-card">${injCol(g.away, sg.inj.A)}${injCol(g.home, sg.inj.B)}</div>`;
    if (sg && sg.goalies) out += `${sec('Goalies')}<div class="card inj-card">${goalieCol(g.away, sg.goalies.A)}${goalieCol(g.home, sg.goalies.B)}</div>`;
    return out;
  }
  // ---- game Bets tab: projections list ----
  const BET_STAT = { pts: 'PTS', reb: 'REB', ast: 'AST', tpm: '3PM', pra: 'PRA', pr: 'P+R', pa: 'P+A', ra: 'R+A', sog: 'SOG', g: 'G', a: 'A' };
  const GRADE_ORDER = ['S+', 'A', 'B', 'C', 'D', 'F'];
  const SORTS = [['ev', 'EV'], ['grade', 'Grade'], ['player', 'Player']];
  const isNum = (v) => typeof v === 'number' && isFinite(v);
  const sgn = (v, dp) => { // signed fixed string off the rounded value, real minus
    const t = Math.abs(v).toFixed(dp);
    return (+t === 0 ? '' : v > 0 ? '+' : MINUS) + t;
  };
  const fmtOdds = (o) => (isNum(o) ? (o > 0 ? '+' : o < 0 ? MINUS : '') + Math.abs(Math.round(o)) : '—');
  const evCls = (ev) => (ev > 5 ? 'p5' : ev >= 2 ? 'p2' : ev > -2 ? 'n' : ev >= -5 ? 'm2' : 'm5');
  function betRows(slate, gid) {
    const players = slate.players || {};
    return Object.entries(slate.bets || {}).map(([id, b]) => {
      if (!b || b.type !== 'prop' || b.gid !== gid) return null;
      const ph = b.close || b.open;
      if (!ph || !isNum(ph.ev) || !isNum(ph.line) || !isNum(ph.proj)) return null;
      const p = players[b.pid] || {};
      return { id, b, ph, tag: b.close ? 'close' : 'open', pid: String(b.pid), team: p.team || '', pick: ph.pick !== false, name: p.name || String(b.pid), inj: p.inj || '' };
    }).filter(Boolean);
  }
  const UNCAL = '<span class="grade-badge uncal" role="img" aria-label="Not graded yet: model not calibrated">\u2013</span>'; // NFL until its calibration gate passes: no grade (gray dash), EV shown
  const gradeIdx = (r) => { const i = GRADE_ORDER.indexOf(r.ph.grade); return i < 0 ? 99 : i; };
  const byEv = (x, y) => y.ph.ev - x.ph.ev;
  function betGroups(rows, how) {
    const m = new Map();
    rows.forEach((r) => { if (!m.has(r.pid)) m.set(r.pid, []); m.get(r.pid).push(r); });
    const groups = [...m.values()].map((rs) => {
      rs.sort(byEv);
      return { pid: rs[0].pid, name: rs[0].name, team: rs[0].team, inj: rs[0].inj, rows: rs, ev: rs[0].ph.ev, gi: Math.min(...rs.map(gradeIdx)) };
    });
    const cmp = how === 'grade' ? (x, y) => x.gi - y.gi || y.ev - x.ev
      : how === 'player' ? (x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0) || y.ev - x.ev
        : (x, y) => y.ev - x.ev;
    return groups.sort(cmp);
  }
  function betRow(r, showPick) {
    const { b, ph } = r, open = !!state.betOpen[r.id];
    const gap = ph.proj - ph.line, pct = ph.line ? gap / ph.line * 100 : null;
    const c = evCls(ph.ev);
    const g = GRADE_ORDER.includes(ph.grade) ? ph.grade : '';
    const pros = (ph.pros || []).map((t) => `<div class="pro">${esc(t)}</div>`).join('');
    const cons = (ph.cons || []).map((t) => `<div class="con">${esc(t)}</div>`).join('');
    const ctx = pros || cons ? `<div class="bet-ctx"><div class="lbl">Context</div>${pros}${cons}</div>` : '<div class="bet-ctx"><div class="lbl">Context</div><div class="bet-none">No notes on this prop.</div></div>';
    const add = pgCtx.final ? '' : addBtn(cur.sport || 'nba', r);
    let fin = '';
    if (pgCtx.final) {
      const st = pgSettle(cur.sport || 'nba', r);
      fin = `<span class="pg-settle"><span class="pg-act">${isNum(st.act) ? 'Actual ' + fx(st.act, Number.isInteger(st.act) ? 0 : 1) : 'Did not play'}</span>${st.res ? `<span class="res-pill ${PG_RES[st.res] || ''}">${esc(st.res)}</span>` : ''}${st.beat === null ? '' : `<span class="pg-beat ${st.beat ? 'w' : 'l'}">Beat close: ${st.beat ? 'yes' : 'no'}</span>`}</span>`;
    }
    return `<div class="bet-wrap${open ? ' open' : ''}${showPick && !r.pick ? ' alt' : ''}${add ? ' has-add' : ''}"><button class="bet" data-bet="${esc(r.id)}" aria-expanded="${open}">
      <span class="bet-l"><span class="bet-mkt">${esc(BET_STAT[b.stat] || String(b.stat).toUpperCase())} ${b.side === 'u' ? 'U' : 'O'} ${esc(ph.line)}</span>
        <span class="bet-sub">${fmtOdds(ph.odds)} · ${r.tag.toUpperCase()}${showPick && !r.pick ? '<em class="side-tag">Other side</em>' : ''}</span></span>
      <span class="bet-m"><span class="bet-proj">Proj ${ph.proj.toFixed(1)}</span>
        <span class="ev gap ${c}">${sgn(gap, 1)}${pct === null ? '' : ` (${sgn(pct, 0)}%)`}</span></span>
      <span class="bet-r"><span class="ev bet-ev ${c}">${sgn(ph.ev, 1)}%</span>
        ${g ? `<span class="grade-badge" data-g="${g}">${g}</span>` : ph.uncal ? UNCAL : ''}</span>
    </button>${fin}${add}${open ? ctx : ''}</div>`;
  }
  function playerCard(sport, grp, showPick) {
    const best = GRADE_ORDER[Math.min(...grp.rows.map(gradeIdx))];
    const n = grp.rows.length;
    return `<div class="pcard"><button class="pcard-h" data-player="${esc(grp.pid)}" aria-label="${esc(grp.name)} player page">
      <span class="pcard-n">${grp.team ? tbadge(sport, grp.team, 's', '', true) : ''}<b>${esc(grp.name)}</b>${grp.inj ? `<i class="inj">${esc(grp.inj)}</i>` : ''}</span>
      <span class="pcard-r">${best ? `<span class="grade-badge" data-g="${best}">${best}</span>` : ''}<small>${n} ${n === 1 ? 'prop' : 'props'}</small></span>
      <span class="pcard-chev" aria-hidden="true">›</span></button>
      ${grp.rows.map((r) => betRow(r, showPick)).join('')}</div>`;
  }
  const COMBOS = ['pra', 'pr', 'pa', 'ra'];
  // table columns per sport [stat, label, decimals]; MIN/TOI first (season average + projected minutes only, no line)
  const TBL_COLS = {
    nba: [['min', 'MIN', 1], ['pts', 'PTS', 1], ['reb', 'REB', 1], ['ast', 'AST', 1], ['tpm', '3PM', 1]],
    nhl: [['min', 'TOI', 1], ['sog', 'SOG', 1], ['pts', 'PTS', 2], ['a', 'A', 2], ['g', 'G', 2]],
  };
  const BT_DEFS = {
    btproj: 'Our projection for this stat. The arrow shows if it is above (up) or below (down) the book line; the color follows the EV.',
    btev: 'EV = expected profit per $100 bet, at this price, if our model is right. Plus is good. The badge is our grade for the bet.',
  };
  function betChips(chipStats) {
    const f = state.betF;
    const chip = (k, label, on) => `<button class="bchip${on ? ' on' : ''}" data-bf="${k}" aria-pressed="${on}">${label}</button>`;
    const div = '<span class="bchip-div" aria-hidden="true"></span>';
    return `<div class="bchips" role="group" aria-label="Filter props">${chip('all', 'All', !f.ga && !f.mkt)}${chip('ga', 'S+/A', f.ga)}${chipStats.length ? div + chipStats.map((k) => chip('mkt:' + k, esc(BET_STAT[k]), f.mkt === k)).join('') : ''}</div>`;
  }
  const isGA = (r) => r.ph.grade === 'S+' || r.ph.grade === 'A';
  const latestMin = (pl) => { const m = pl && pl.min; const v = m && (isNum(m.close) ? m.close : m.open); return isNum(v) ? v : null; };
  // NBA / NHL: one table card per player. cells = { stat: row } (the shown side of each base stat)
  function tblCard(sport, grp, cols, slate, first) {
    const w = ensurePlayer(sport, grp.pid), st = (w.st === 'ok' && w.data && w.data.st) || {};
    const pl = (slate.players || {})[grp.pid] || {};
    const hl = (k) => (state.betF.mkt === k ? ' hl' : '');
    const cellsAll = Object.values(grp.cells);
    const best = GRADE_ORDER[Math.min(...cellsAll.map(gradeIdx))];
    const uncal = !best && cellsAll.some((r) => r.ph.uncal);
    const bt = (id, cls, inner) => `<button class="bt-c ${cls}${state.betOpen[id] ? ' open' : ''}" data-bet="${esc(id)}" aria-expanded="${!!state.betOpen[id]}">${inner}</button>`;
    let hd = '<span class="bt-l"></span>', sr = '<span class="bt-l">Season</span>', ln = '<span class="bt-l">Line</span>',
      pj = `<span class="bt-l">Proj${first ? infoBtn(sport, 'btproj', BT_DEFS) : ''}</span>`, ev = `<span class="bt-l">EV${first ? infoBtn(sport, 'btev', BT_DEFS) : ''}</span>`;
    const fin = pgCtx.final;
    let ad = fin ? '' : '<span class="bt-l">My bets</span>';
    let ac = '<span class="bt-l">Actual</span>', rs = '<span class="bt-l">Result</span>', bc = '<span class="bt-l">Beat close</span>';
    cols.forEach(([k, lab, dp]) => {
      const r = grp.cells[k], h = hl(k);
      if (fin) {
        const act = k === 'min' ? pgActual(sport, grp.pid, 'min') : r ? pgSettle(sport, r) : null;
        if (k === 'min') { ac += `<span class="bt-v${isNum(act) ? '' : ' nil'}">${isNum(act) ? (sport === 'nhl' ? pgToi(act) : act) : ''}</span>`; rs += '<span></span>'; bc += '<span></span>'; }
        else if (!act) { ac += `<span class="bt-v nil${h}">—</span>`; rs += '<span></span>'; bc += '<span></span>'; }
        else {
          ac += `<span class="bt-v pg-act${h}">${isNum(act.act) ? fx(act.act, Number.isInteger(act.act) ? 0 : 1) : '—'}</span>`;
          rs += `<span class="bt-v${h}">${act.res ? `<span class="res-pill ${PG_RES[act.res] || ''}">${esc(act.res)}</span>` : pgCtx.resLoading ? '<span class="bar w40"></span>' : '<span class="nil">—</span>'}</span>`;
          bc += `<span class="bt-v${h}">${act.beat === null ? '<span class="nil">—</span>' : `<span class="pg-beat ${act.beat ? 'w' : 'l'}">${act.beat ? 'Yes' : 'No'}</span>`}</span>`;
        }
      } else ad += r && k !== 'min' && addBtn(sport, r) ? `<span class="bt-ad">${addBtn(sport, r)}</span>` : '<span></span>';
      hd += `<span class="bt-h${h}">${lab}</span>`;
      sr += `<span class="bt-v${h}">${fx(st[k], dp)}</span>`;
      if (k === 'min') {
        ln += '<span class="bt-v"></span>';
        const m = latestMin(pl);
        pj += `<span class="bt-v">${m === null ? '' : m.toFixed(1)}</span>`;
        ev += '<span class="bt-v"></span>';
        return;
      }
      if (!r) {
        const pp = pl.proj && ((pl.proj.close && pl.proj.close[k]) || (pl.proj.open && pl.proj.open[k]));
        ln += `<span class="bt-v nil${h}">—</span>`;
        pj += isNum(pp && pp.v) ? `<span class="bt-v${h}">${pp.v.toFixed(dp)}</span>` : `<span class="bt-v nil${h}">—</span>`;
        ev += `<span class="bt-v nil${h}">—</span>`;
        return;
      }
      const c = evCls(r.ph.ev), g = GRADE_ORDER.includes(r.ph.grade) ? r.ph.grade : '';
      const arrow = r.ph.proj > r.ph.line ? '<i aria-label="over">▲</i>' : r.ph.proj < r.ph.line ? '<i aria-label="under">▼</i>' : '';
      ln += bt(r.id, 'bt-line' + h, `<b>${r.b.side === 'u' ? 'U' : 'O'} ${esc(r.ph.line)}</b><small>${fmtOdds(r.ph.odds)}</small>`);
      pj += bt(r.id, 'bt-pj ev ' + c + h, `${r.ph.proj.toFixed(dp)}${arrow}`);
      ev += bt(r.id, 'bt-ev' + h, `<span class="ev ${c}">${sgn(r.ph.ev, 1)}%</span>${g ? `<span class="grade-badge" data-g="${g}">${g}</span>` : r.ph.uncal ? UNCAL : ''}`);
    });
    const ctx = cellsAll.filter((r) => state.betOpen[r.id]).map((r) => {
      const pros = (r.ph.pros || []).map((t) => `<div class="pro">${esc(t)}</div>`).join('');
      const cons = (r.ph.cons || []).map((t) => `<div class="con">${esc(t)}</div>`).join('');
      return `<div class="bet-ctx"><div class="lbl">${esc(BET_STAT[r.b.stat] || r.b.stat)} ${r.b.side === 'u' ? 'U' : 'O'} ${esc(r.ph.line)} · ${fmtOdds(r.ph.odds)} · ${r.tag.toUpperCase()}</div>${pros || cons ? pros + cons : '<div class="bet-none">No notes on this prop.</div>'}</div>`;
    }).join('');
    const notes = !first ? '' : ['btproj', 'btev'].map((k) => infoNote(sport, k, BT_DEFS)).join('');
    const combo = grp.combos ? `<button class="bt-foot" data-player="${esc(grp.pid)}">${grp.combos} combo ${grp.combos === 1 ? 'line' : 'lines'} on profile ›</button>` : '';
    return `<div class="pcard"><button class="pcard-h" data-player="${esc(grp.pid)}" aria-label="${esc(grp.name)} player page">
      <span class="pcard-n">${grp.team ? tbadge(sport, grp.team, 's', '', true) : ''}<b>${esc(grp.name)}</b>${grp.inj ? `<i class="inj">${esc(grp.inj)}</i>` : ''}</span>
      <span class="pcard-r">${best ? `<span class="grade-badge" data-g="${best}">${best}</span>` : uncal ? UNCAL : ''}</span>
      <span class="pcard-chev" aria-hidden="true">›</span></button>
      <div class="btab${fin ? ' pg-fin' : ''}" style="--n:${cols.length}">${hd}${sr}${ln}${pj}${ev}${fin ? ac + rs + bc : ad}</div>${notes}${ctx}${combo}</div>`;
  }
  function betsTab(sport, date) {
    const e = ensureSlate(sport, date);
    if (e.st === 'loading') return skRows(4);
    if (e.st === 'err') return `<div class="card empty"><h2>Couldn’t load props</h2><p>Check your connection and try again.</p><button class="pillbtn retry" data-retry-slate="${esc(sport + '/' + date)}">Retry</button></div>`;
    const slate = e.st === 'ok' ? (e.data || {}) : {};
    const rows = e.st === 'ok' ? betRows(slate, state.betGid) : [];
    if (!rows.length) return pgCtx.past || pgCtx.final ? `<div class="card empty"><h2>No props for this game</h2>${PG_NOTE}</div>` : empty('Bets', 'No props for this game yet', 'Props show up here once the slate is published.', 0);
    const f = state.betF, mode = state.betSide;
    const table = !!TBL_COLS[sport];
    let cols = TBL_COLS[sport] || [];
    if (sport === 'nhl' && !Object.values(slate.bets || {}).some((b) => b && b.type === 'prop' && b.stat === 'g')) cols = cols.filter((c) => c[0] !== 'g');
    const sideOk = (r) => (mode === 'model' ? r.pick : r.b.side === mode);
    const present = new Set(rows.map((r) => r.b.stat));
    const chipStats = table ? cols.filter((c) => c[0] !== 'min' && present.has(c[0])).map((c) => c[0]) : Object.keys(BET_STAT).filter((k) => present.has(k) && !COMBOS.includes(k));
    if (f.mkt && !chipStats.includes(f.mkt)) f.mkt = '';
    const toggle = segmented([['model', 'Model'], ['o', 'Over'], ['u', 'Under']], mode, 'data-bside', 'sideseg');
    let n = 0, body, shownN;
    const empt = '<div class="card empty"><h2>No props match these filters</h2><button class="pillbtn" data-bf="all">Clear filters</button></div>';
    if (table) {
      const stats = new Set(cols.map((c) => c[0]));
      const m = new Map();
      rows.forEach((r) => {
        if (!stats.has(r.b.stat) || r.b.stat === 'min' || !sideOk(r)) return;
        if (!m.has(r.pid)) m.set(r.pid, { pid: r.pid, name: r.name, team: r.team, inj: r.inj, cells: {} });
        const c = m.get(r.pid).cells;
        if (!c[r.b.stat] || r.ph.ev > c[r.b.stat].ph.ev) c[r.b.stat] = r;
      });
      const combos = {};
      rows.forEach((r) => { if (COMBOS.includes(r.b.stat)) (combos[r.pid] = combos[r.pid] || new Set()).add(r.b.stat); });
      const groups = [...m.values()].filter((gp) => Object.values(gp.cells).some((r) => (!f.ga || isGA(r)) && (!f.mkt || r.b.stat === f.mkt)));
      groups.forEach((gp) => {
        const cs = Object.values(gp.cells);
        gp.combos = combos[gp.pid] ? combos[gp.pid].size : 0;
        gp.ev = Math.max(...cs.map((r) => r.ph.ev)); gp.gi = Math.min(...cs.map(gradeIdx));
      });
      const how = state.betSort;
      groups.sort(how === 'grade' ? (x, y) => x.gi - y.gi || y.ev - x.ev
        : how === 'player' ? (x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0) || y.ev - x.ev
          : (x, y) => y.ev - x.ev);
      n = groups.length; shownN = groups.reduce((a, gp) => a + Object.keys(gp.cells).length, 0);
      body = n ? `<div class="pcards">${groups.map((gp, i) => tblCard(sport, gp, cols, slate, i === 0)).join('')}</div>` : empt;
    } else {
      const shown = rows.filter((r) => sideOk(r) && (!f.ga || isGA(r)) && (!f.mkt || r.b.stat === f.mkt));
      const groups = betGroups(shown, state.betSort);
      n = groups.length; shownN = shown.length;
      body = n ? `<div class="pcards">${groups.map((gp) => playerCard(sport, gp, false)).join('')}</div>` : empt;
    }
    return `<div class="bets-head"><span class="bets-n">${n} ${n === 1 ? 'player' : 'players'} · ${shownN} ${shownN === 1 ? 'prop' : 'props'}</span>${segmented(SORTS, state.betSort, 'data-sort', 'sortseg')}</div>
      <div class="sidetog">${toggle}</div>${betChips(chipStats)}${body}`;
  }
  // ======== Past games: Final mode (box score from ../box/<sp>/<date>.json; prefix pg) ========
  store.box = {};
  state.pgTab = 'box'; // Final mode sub-tab: box | game | bets
  state.pgProj = true; // Box tab "Proj vs actual" toggle (modeled games)
  state.pgOpen = {}; // folds ('<key>' -> true): bench tables, more team stats
  const pgCtx = { final: false, box: null, res: null, resLoading: false, date: '', sgid: '', past: false }; // set while a Final-mode Bets tab renders (tblCard reads it)
  const pgScrolled = {};
  function pgEnsureBox(sp, date) {
    const k = sp + '/' + date;
    if (store.box[k]) return store.box[k];
    const e = store.box[k] = { st: 'loading', sp, date };
    indexP.then(() => {
      const s = store.idx && store.idx.sports && store.idx.sports[sp];
      if (store.idx && !(s && Array.isArray(s.box) && s.box.includes(date))) return { nf: true };
      return getJSON('../box/' + sp + '/' + date + '.json' + ver());
    }).then((r) => {
      if (r.nf || !r.data || !r.data.games) e.st = '404'; else { e.st = 'ok'; e.data = r.data; }
    }, () => { e.st = 'err'; }).then(rerender);
    return e;
  }
  // a box game by its app id or any source id (NHL games open under the ESPN id from the schedule and the NHL id from the slate)
  function pgFindBox(doc, id) {
    const gs = (doc && doc.games) || {};
    if (gs[id]) return Object.assign({ key: id }, gs[id]);
    for (const k in gs) {
      const ids = gs[k].ids || {};
      if (Object.keys(ids).some((n) => String(ids[n]) === String(id))) return Object.assign({ key: k }, gs[k]);
    }
    return null;
  }
  const pgNum = (v) => (isNum(v) ? v : 0);
  const pgPct = (v) => (isNum(v) ? (v * 100).toFixed(1) + '%' : '—');
  const pgToi = (v) => { if (!isNum(v)) return '—'; const m = Math.floor(v), s = Math.round((v - m) * 60); return m + ':' + String(s).padStart(2, '0'); };
  const pgSgn = (v) => (isNum(v) ? (v > 0 ? '+' : v < 0 ? MINUS : '') + Math.abs(v) : '—');
  // team totals rows: [key, label, kind ('pct' = fraction), lowerIsBetter, value fn, sub-text fn]
  const PG_TOT = {
    nba: [['pts', 'PTS'], ['fgp', 'FG%', 'pct', 0, (t) => (t.fga ? t.fgm / t.fga : null), (t) => `${pgNum(t.fgm)}-${pgNum(t.fga)}`],
      ['tpm', '3PM', '', 0, null, (t) => `of ${pgNum(t.tpa)}`], ['ftm', 'FTM', '', 0, null, (t) => `of ${pgNum(t.fta)}`], ['reb', 'REB', '', 0, null, (t) => `${pgNum(t.oreb)} off`], ['ast', 'AST'],
      ['tov', 'TO', '', 1], ['stl', 'STL'], ['blk', 'BLK'], ['paint', 'Paint pts'], ['fb', 'Fast break'], ['lead', 'Largest lead']],
    nhl: [['g', 'Goals'], ['sog', 'SOG'], ['svp', 'SV%', 'pct'], ['fo', 'FO%', 'pct'], ['hit', 'HIT'], ['blk', 'BLK'],
      ['pim', 'PIM', '', 1], ['ppg', 'PP goals'], ['gv', 'Giveaways', '', 1], ['tk', 'Takeaways']],
    nfl: [['pts', 'PTS'], ['tyd', 'Total yds', '', 0, (t) => pgNum(t.pyd) + pgNum(t.ryd)], ['pyd', 'Pass yds', '', 0, null, (t) => `${pgNum(t.cmp)}/${pgNum(t.att)}`], ['ryd', 'Rush yds', '', 0, null, (t) => `${pgNum(t.car)} car`],
      ['td', 'TD', '', 0, (t) => pgNum(t.ptd) + pgNum(t.rtd)], ['sck', 'Sacks'], ['dint', 'INT'], ['fgm', 'FG', '', 0, null, (t) => `of ${pgNum(t.fga)}`]],
  };
  const PG_LEAD = 6; // totals rows shown before the fold
  function pgTotals(sport, g, bg) {
    const A = (bg.teams || {})[g.away] || {}, H = (bg.teams || {})[g.home] || {};
    const defs = PG_TOT[sport] || [];
    const rows = defs.map(([k, label, kind, low, fn, sub]) => {
      const a = fn ? fn(A) : A[k], h = fn ? fn(H) : H[k];
      if (!isNum(a) && !isNum(h)) return '';
      const f = (v) => (kind === 'pct' ? pgPct(v) : isNum(v) ? String(v) : '—');
      let share = 0.5, ba = false, bh = false;
      if (isNum(a) && isNum(h) && a !== h) {
        const tot = Math.abs(a) + Math.abs(h);
        share = tot ? 0.5 + 0.4 * Math.tanh(4 * (a - h) / tot) : 0.5;
        ba = low ? a < h : a > h; bh = !ba;
      }
      const la = isNum(a) && isNum(h) && a > h, lh = isNum(a) && isNum(h) && h > a;
      return `<div><div class="cmp-top"><span class="v${ba ? ' best' : ''}">${f(a)}${sub ? `<small class="pg-sub">${esc(sub(A))}</small>` : ''}</span><span class="lab">${esc(label)}</span><span class="v${bh ? ' best' : ''}">${f(h)}${sub ? `<small class="pg-sub">${esc(sub(H))}</small>` : ''}</span></div>
        <div class="split tc"><i class="${la ? 'lead' : ''}" style="flex:${share}"></i><i class="${lh ? 'lead' : ''}" style="flex:${1 - share}"></i></div></div>`;
    }).filter(Boolean);
    if (!rows.length) return '';
    const fk = 'tot:' + sport + '/' + bg.key, open = !!state.pgOpen[fk];
    const more = rows.length - PG_LEAD;
    const shown = open || more <= 0 ? rows : rows.slice(0, PG_LEAD);
    const fold = more > 0 ? `<button class="pg-fold" data-pgfold="${esc(fk)}" aria-expanded="${open}">${open ? 'Fewer team stats' : `${more} more team stats`}</button>` : '';
    ensureMeta(sport);
    const cc = cmpColors(sport, g);
    return `${sec('Team totals')}<div class="card cmp pg-cmp" style="--ca:${cc[0]};--ch:${cc[1]}"><div class="cmp-teams"><span><b><i class="tdot a"></i>${esc(g.away)}</b></span><span><b>${esc(g.home)}<i class="tdot h"></i></b></span></div>${shown.join('')}${fold}</div>`;
  }
  // player box columns per sport: [label, cell fn, projection key (slate proj / bet stat) or '']
  const pgFg = (p) => `${pgNum(p.fgm)}-${pgNum(p.fga)}`;
  const PG_COLS = {
    nba: [['MIN', (p) => p.min, ''], ['PTS', (p) => p.pts, 'pts'], ['REB', (p) => p.reb, 'reb'], ['AST', (p) => p.ast, 'ast'], ['3PM', (p) => p.tpm, 'tpm'], ['FG', pgFg, ''], ['STL', (p) => p.stl, ''], ['BLK', (p) => p.blk, ''], ['TO', (p) => p.tov, '']],
    nhl: [['TOI', (p) => pgToi(p.toi), ''], ['G', (p) => p.g, 'g'], ['A', (p) => p.a, 'a'], ['PTS', (p) => p.p, 'pts'], ['SOG', (p) => p.sog, 'sog'], ['+/-', (p) => pgSgn(p.pm), '']],
    nhlG: [['SA', (p) => p.sa, ''], ['SV', (p) => p.sv, ''], ['SV%', (p) => (isNum(p.svp) ? p.svp.toFixed(3).replace(/^0/, '') : '—'), ''], ['TOI', (p) => pgToi(p.toi), '']],
    nfl: {
      Passing: [['C/ATT', (p) => `${pgNum(p.cmp)}/${pgNum(p.att)}`], ['YDS', (p) => pgNum(p.pyd)], ['TD', (p) => pgNum(p.ptd)], ['INT', (p) => pgNum(p.int)], ['SK', (p) => pgNum(p.sk)]],
      Rushing: [['CAR', (p) => pgNum(p.car)], ['YDS', (p) => pgNum(p.ryd)], ['TD', (p) => pgNum(p.rtd)]],
      Receiving: [['TGT', (p) => pgNum(p.tgt)], ['REC', (p) => pgNum(p.rec)], ['YDS', (p) => pgNum(p.recy)], ['TD', (p) => pgNum(p.rectd)]],
      Defense: [['TKL', (p) => pgNum(p.tkl)], ['SCK', (p) => pgNum(p.sck)], ['INT', (p) => pgNum(p.dint)], ['PD', (p) => pgNum(p.pd)], ['FF', (p) => pgNum(p.ff)]],
      Kicking: [['FG', (p) => `${pgNum(p.fgm)}/${pgNum(p.fga)}`], ['LNG', (p) => pgNum(p.fgl)], ['XP', (p) => `${pgNum(p.xpm)}/${pgNum(p.xpa)}`]],
    },
  };
  const PG_NFL_UNITS = [['Passing', (p) => pgNum(p.att) > 0, (p) => pgNum(p.pyd)], ['Rushing', (p) => pgNum(p.car) > 0, (p) => pgNum(p.ryd)], ['Receiving', (p) => pgNum(p.tgt) > 0 || pgNum(p.rec) > 0, (p) => pgNum(p.recy)],
    ['Defense', (p) => pgNum(p.tkl) > 0 || pgNum(p.sck) > 0 || pgNum(p.dint) > 0 || pgNum(p.pd) > 0 || pgNum(p.ff) > 0, (p) => pgNum(p.tkl) + 3 * pgNum(p.sck) + 3 * pgNum(p.dint)], ['Kicking', (p) => pgNum(p.fga) > 0 || pgNum(p.xpa) > 0, (p) => pgNum(p.fgm)]];
  const pgCell = (v) => (v === null || v === undefined ? '—' : esc(String(v)));
  // projection + line for a player's stat (slate: close if present, else open); hit = model side right (W), wrong (L), push (P), '' = no line
  function pgProjOf(ctx, pid, stat) {
    const pl = ctx.slate && ctx.slate.players && ctx.slate.players[pid];
    const pr = pl && pl.proj;
    const ph = pr && pr.close && pr.close[stat] ? pr.close[stat] : pr && pr.open && pr.open[stat];
    const v = ph && ph.v;
    if (!isNum(v)) return null;
    const r = ctx.picks[pid + '|' + stat] || null;
    return { v, r };
  }
  function pgHit(r, actual) {
    if (!r || !isNum(actual)) return '';
    if (actual === r.ph.line) return 'p';
    const over = actual > r.ph.line;
    return (r.b.side === 'u') === !over ? 'w' : 'l';
  }
  function pgRow(sport, p, cols, ctx, hl) {
    const dp = (k) => projDp(sport, k === 'pts' && sport === 'nhl' ? 'pts' : k);
    const cells = cols.map(([, fn, pk]) => {
      const v = fn(p);
      const pj = ctx.proj && pk ? pgProjOf(ctx, String(p.id), pk) : null;
      if (!pj) return `<td>${pgCell(v)}</td>`;
      const hit = pgHit(pj.r, isNum(v) ? v : null);
      return `<td class="pg-pa"><b class="${hit}">${pgCell(v)}</b><small>${pj.v.toFixed(dp(pk))}</small></td>`;
    }).join('');
    const nm = `<th scope="row"><button class="pg-pl" data-player="${esc(String(p.id))}"><b>${esc(p.n || p.id)}</b>${p.pos ? `<small>${esc(p.pos)}</small>` : ''}</button></th>`;
    return `<tr${hl ? ' class="pg-hl"' : ''}${hl ? ' id="pg-hl"' : ''}>${nm}${cells}</tr>`;
  }
  function pgTable(sport, cols, rows, ctx, extraHead) {
    const head = `<tr><th scope="col">${extraHead || ''}</th>${cols.map((c) => `<th scope="col">${esc(c[0])}</th>`).join('')}</tr>`;
    return `<div class="pg-scroll"><table class="pg-tbl"><thead>${head}</thead><tbody>${rows.map((p) => pgRow(sport, p, cols, ctx, ctx.hl && String(p.id) === ctx.hl)).join('')}</tbody></table></div>`;
  }
  function pgTeamBox(sport, g, bg, code, ctx) {
    const list = ((bg.players || {})[code] || []);
    const fk = 'bench:' + sport + '/' + bg.key + '/' + code;
    const title = `${sec(code + ' box')}`;
    let inner = '';
    if (sport === 'nba') {
      const played = list.filter((p) => p.dnp === null || p.dnp === undefined);
      const dnp = list.filter((p) => p.dnp !== null && p.dnp !== undefined);
      const starters = played.filter((p) => p.st === 1), bench = played.filter((p) => p.st !== 1);
      const forced = !!ctx.hl && bench.some((p) => String(p.id) === ctx.hl);
      const open = !!state.pgOpen[fk] || forced;
      const rows = open ? starters.concat(bench) : starters;
      inner = pgTable(sport, PG_COLS.nba, rows, ctx, 'Starters' + (open && bench.length ? ' + bench' : ''))
        + (bench.length ? `<button class="pg-fold" data-pgfold="${esc(fk)}" aria-expanded="${open}">${open ? 'Hide bench' : `Bench (${bench.length})`}</button>` : '')
        + (dnp.length ? `<p class="pg-dnp">DNP: ${dnp.map((p) => esc(p.n) + (p.dnp ? ` <i>${esc(String(p.dnp).toLowerCase())}</i>` : '')).join(', ')}</p>` : '');
    } else if (sport === 'nhl') {
      const sk = list.filter((p) => p.pos !== 'G').slice().sort((x, y) => pgNum(y.toi) - pgNum(x.toi));
      const gl = list.filter((p) => p.pos === 'G');
      const LEAD = 12;
      const forced = !!ctx.hl && sk.slice(LEAD).some((p) => String(p.id) === ctx.hl);
      const open = !!state.pgOpen[fk] || forced;
      const rows = open ? sk : sk.slice(0, LEAD);
      inner = pgTable(sport, PG_COLS.nhl, rows, ctx, 'Skaters')
        + (sk.length > LEAD ? `<button class="pg-fold" data-pgfold="${esc(fk)}" aria-expanded="${open}">${open ? 'Fewer skaters' : `${sk.length - LEAD} more skaters`}</button>` : '')
        + (gl.length ? pgTable(sport, PG_COLS.nhlG, gl, Object.assign({}, ctx, { proj: false }), 'Goalies') : '');
    } else {
      inner = PG_NFL_UNITS.map(([unit, has, sortv]) => {
        const rows = list.filter(has).sort((x, y) => sortv(y) - sortv(x));
        if (!rows.length) return '';
        const LEAD = unit === 'Defense' ? 8 : 99, uk = fk + '/' + unit;
        const forced = !!ctx.hl && rows.slice(LEAD).some((p) => String(p.id) === ctx.hl);
        const open = !!state.pgOpen[uk] || forced;
        return pgTable(sport, PG_COLS.nfl[unit], open ? rows : rows.slice(0, LEAD), ctx, unit)
          + (rows.length > LEAD ? `<button class="pg-fold" data-pgfold="${esc(uk)}" aria-expanded="${open}">${open ? 'Fewer players' : `${rows.length - LEAD} more players`}</button>` : '');
      }).join('');
    }
    if (!inner) inner = '<p class="pg-dnp">No player box for this team.</p>';
    return `${title}<div class="card pg-box">${inner}</div>`;
  }
  // period line score under the header
  function pgLineScore(g, bg) {
    const P = bg.periods;
    if (!P || !Array.isArray(P.labels) || !Array.isArray(P.away) || !Array.isArray(P.home)) return '';
    const row = (code, arr, tot, win) => `<span class="pg-lc${win ? ' w' : ''}">${esc(code)}</span>${P.labels.map((_, i) => `<span>${pgCell(arr[i])}</span>`).join('')}<span class="pg-lt${win ? ' w' : ''}">${esc(tot)}</span>`;
    return `<div class="card pg-ls" style="--n:${P.labels.length}" aria-label="Line score"><span></span>${P.labels.map((l) => `<span class="pg-lh">${esc(l)}</span>`).join('')}<span class="pg-lh">T</span>
      ${row(g.away, P.away, bg.sA, bg.sA > bg.sH)}${row(g.home, P.home, bg.sH, bg.sH > bg.sA)}</div>`;
  }
  // Game tab (modeled NBA / NHL): closing book line, our projection and the final, with the result of each market
  function pgBookCard(sport, g, bg, slate, sg, sgid) {
    const bk = bookLines(slate, sgid), dp = sport === 'nhl' ? 2 : 1;
    const pr = projOf(sg), p = pr && pr.p;
    const mg = bg.sA - bg.sH, tot = bg.sA + bg.sH;
    const side = (v) => (v > 0 ? g.away : g.home);
    const chip = (txt, lv) => `<span class="edge-c"><span class="edge lv${lv}">${txt}</span></span>`;
    const rows = [];
    let lA = bk.spread && bk.spread.A ? bk.spread.A.line : null, lB = bk.spread && bk.spread.B ? bk.spread.B.line : null;
    if (!isNum(lA) && isNum(lB)) lA = -lB;
    if (isNum(lA)) {
      const bm = -lA, d = mg - bm;
      rows.push({ label: 'Spread', book: bm === 0 ? 'PK' : `${esc(side(bm))} ${MINUS}${Math.abs(bm)}`, model: p && isNum(p.margin ?? (p.away - p.home)) ? (() => { const m = isNum(p.margin) ? p.margin : p.away - p.home; return Math.abs(m) < 0.05 ? 'Even' : `${esc(side(m))} ${MINUS}${Math.abs(m).toFixed(dp)}`; })() : '',
        fin: mg === 0 ? 'Tie' : `${esc(side(mg))} by ${Math.abs(mg)}`, chip: d === 0 ? chip('Push', 0) : chip(`${esc(side(d))} covered`, 0) });
    }
    const tl = bk.total ? ((bk.total.o || {}).line ?? (bk.total.u || {}).line) : null;
    if (isNum(tl)) {
      const d = tot - tl;
      rows.push({ label: 'Total', book: String(tl), model: p && isNum(p.total) ? p.total.toFixed(dp) : '', fin: String(tot), chip: d === 0 ? chip('Push', 0) : chip(`${d > 0 ? 'Over' : 'Under'} by ${Math.abs(d).toFixed(d % 1 ? 1 : 0)}`, 0) });
    }
    [['ttA', g.away, bg.sA, p && p.away], ['ttB', g.home, bg.sH, p && p.home]].forEach(([stat, code, act, mv]) => {
      const b = bk[stat] && (bk[stat].o || bk[stat].u);
      if (!b || !isNum(b.line)) return;
      const d = act - b.line;
      rows.push({ label: code + ' total', book: String(b.line), model: isNum(mv) ? mv.toFixed(dp) : '', fin: String(act), chip: d === 0 ? chip('Push', 0) : chip(`${d > 0 ? 'Over' : 'Under'} by ${Math.abs(d).toFixed(d % 1 ? 1 : 0)}`, 0) });
    });
    const oA = bk.ml && bk.ml.A ? bk.ml.A.odds : null, oB = bk.ml && bk.ml.B ? bk.ml.B.odds : null;
    if (isNum(oA) && isNum(oB) && mg !== 0) {
      const ia = impProb(oA), ib = impProb(oB), na = ia / (ia + ib) * 100;
      const fav = na >= 50 ? g.away : g.home, fv = na >= 50 ? na : 100 - na, won = side(mg);
      rows.push({ label: 'Win %', book: `${esc(fav)} ${fv.toFixed(1)}%`, model: p && isNum(p.winAway) ? `${esc(fav)} ${(fav === g.away ? p.winAway : p.winHome).toFixed(1)}%` : '', fin: `${esc(won)} won`, chip: chip(won === fav ? 'Favorite won' : 'Upset', 0) });
    }
    const hasModel = rows.some((r) => r.model);
    const score = p ? `<div class="mvb-score pg-ms">${[[g.away, p.away, bg.sA], [g.home, p.home, bg.sH]].map(([c, m, a]) => `<span class="mvb-t"><span class="pc">${esc(c)}</span><b>${esc(a)}</b><small>model ${isNum(m) ? m.toFixed(dp) : '—'}</small></span>`).join('<i>–</i>')}</div>` : '';
    if (!rows.length && !p) return '';
    const table = rows.length ? `<div class="mvb-tab pg-bt"><span class="mvb-h"></span><span class="mvb-h">Book</span><span class="mvb-h">Final</span><span class="mvb-h">Result</span>${rows.map((r) =>
      `<span class="mvb-lab">${r.label}</span><span class="mvb-v">${r.book}${r.model ? `<small class="pg-mod">model ${r.model}</small>` : ''}</span><span class="mvb-v mod">${r.fin}</span>${r.chip}`).join('')}</div>` : '';
    return `<div class="card mvb pg-mvb"><div class="mvb-top"><span class="lbl">${hasModel || p ? 'Projected vs final' : 'Book vs final'}</span></div>${score}${table}</div>`;
  }
  const PG_NOTE = '<p class="pg-note">The model wasn’t running for this game yet.</p>';
  function pgGameView(sport, id) {
    ensureMeta(sport);
    const q = cur.q || {};
    const f = findGame(sport, id);
    const date = f ? f.date : (q.d || '');
    if (!date) return liveGameView(sport, id);
    const be = pgEnsureBox(sport, date);
    if (be.st === 'loading' || !store.idxDone || store.meta[sport].st === 'loading') return `<div class="pagehead">${backBtn}</div>${rowsGeneric(3)}`;
    const bg = be.st === 'ok' ? pgFindBox(be.data, id) : null;
    if (!bg) {
      // past game without a box yet: the normal view, with honest empty states
      pgCtx.past = !!(f && f.g.status === 'final') || date < ymd(0);
      const html = liveGameView(sport, id);
      pgCtx.past = false;
      return html;
    }
    const g = f ? f.g : { gid: id, away: bg.away, home: bg.home, d: date, status: 'final', kickoff: '', final: { away: bg.sA, home: bg.sH }, ot: bg.ot || '', sched: true };
    const aw = g.away || bg.away, hm = g.home || bg.home;
    const sgid = sport === 'nhl' && bg.ids && bg.ids.nhl ? String(bg.ids.nhl) : String(bg.key);
    // slate for the day (modeled game) only when the index lists one
    const sx = store.idx && store.idx.sports && store.idx.sports[sport];
    const hasSlate = !!(sx && (sx.slates || []).includes(date));
    const se = hasSlate ? ensureSlate(sport, date) : null;
    if (se && se.st === 'loading') return `<div class="pagehead">${backBtn}</div>${rowsGeneric(3)}`;
    const slate = se && se.st === 'ok' ? (se.data || {}) : null;
    const sg = slate && slate.games ? slate.games[sgid] || null : null;
    const modeled = !!sg;
    const tabs = [['box', 'Box'], ['game', 'Game']].concat(modeled ? [['bets', 'Bets']] : []);
    const tab = tabs.some(([k]) => k === state.pgTab) ? state.pgTab : 'box';
    state.betGid = sgid;
    // header
    const dayGames = f ? f.day : Object.keys(be.data.games).map((k) => Object.assign({ gid: k }, be.data.games[k]));
    const chips = dayGames.map((x) => `<a class="chip ${(x.gid === g.gid || x.gid === bg.key) ? 'on' : ''}" href="#${sport}/game/${encodeURIComponent(x.gid)}${f ? '' : '?d=' + date}" ${(x.gid === g.gid || x.gid === bg.key) ? 'aria-current="true"' : ''}>${esc(x.away)} @ ${esc(x.home)}<small>${isNum(x.sA) ? `${x.sA}–${x.sH}` : x.final ? `${x.final.away}–${x.final.home}` : esc(ktxt(x))}</small></a>`).join('');
    const wA = bg.sA > bg.sH, wH = bg.sH > bg.sA;
    const center = `<span class="big fin pg-sc"><span class="${wA ? 'w' : 'l'}">${esc(bg.sA)}</span><i>–</i><span class="${wH ? 'w' : 'l'}">${esc(bg.sH)}</span></span><span class="lbl">Final${bg.ot ? ` <em class="pg-ot">${esc(bg.ot)}</em>` : ''}</span>`;
    const lp = slate ? headLineParts(Object.assign({}, g, { gid: sgid }), slate).map((p) => `<span class="kline">${p}</span>`).join('') : '';
    const team = (code, sd) => `<div class="gteam">${tbadge(sport, code, 'l', `#${sport}/team/${encodeURIComponent(code)}`, false)}
      <span class="rec">${esc((f && recFor(sport, g, sd)) || '—')}</span><span class="tn">${esc(tinfo(sport, code).short || '')}</span></div>`;
    const head = `<div class="pagehead">${backBtn}<div class="chips" aria-label="Games this day">${chips}</div></div>
      <div class="ghead pg-head">${team(aw, 'away')}<div class="gcenter">${center}${lp}<span class="kline pg-date">${esc(longOf(date))}</span></div>${team(hm, 'home')}</div>${pgLineScore(g, bg)}`;
    // body
    const picks = {};
    if (slate) betRows(slate, sgid).forEach((r) => { if (r.ph.pick !== false) { const k = r.b.pid + '|' + r.b.stat; if (!picks[k] || r.ph.ev > picks[k].ph.ev) picks[k] = r; } });
    const ctx = { slate, picks, proj: modeled && state.pgProj, hl: q.p || '' };
    let body = '';
    if (tab === 'box') {
      const tog = modeled ? `<div class="pg-togrow"><button class="pg-tog${state.pgProj ? ' on' : ''}" data-pgproj="1" role="switch" aria-checked="${state.pgProj}"><i></i>Proj vs actual</button>${state.pgProj ? '<span class="pg-key">actual over projection · <b class="w">green</b> model side hit · <b class="l">red</b> missed</span>' : ''}</div>` : PG_NOTE;
      body = tog + pgTotals(sport, g, bg) + pgTeamBox(sport, g, bg, aw, ctx) + pgTeamBox(sport, g, bg, hm, ctx);
    } else if (tab === 'game') {
      body = (modeled && (sport === 'nba' || sport === 'nhl') ? pgBookCard(sport, g, bg, slate, sg, sgid) : PG_NOTE) + pgTotals(sport, g, bg);
      if (sg && sg.inj && (sg.inj.A || sg.inj.B)) body += `${sec('Injuries as recorded')}<div class="card inj-card">${injCol(aw, sg.inj.A)}${injCol(hm, sg.inj.B)}</div>`;
      if (sg && sg.goalies) body += `${sec('Goalies as recorded')}<div class="card inj-card">${goalieCol(aw, sg.goalies.A)}${goalieCol(hm, sg.goalies.B)}</div>`;
    } else {
      const re = ensureResults(sport, date.slice(0, 7));
      const res = {};
      if (re.st === 'ok') re.rows.forEach((r) => { if (r.gid === sgid) res[`${r.date}-${r.sport}-${r.gid}-${r.pid}-${r.market}-${r.side}`] = r; });
      Object.assign(pgCtx, { final: true, box: bg, res, resLoading: re.st === 'loading', date, sgid });
      try { body = betsTab(sport, date); } finally { Object.assign(pgCtx, { final: false, box: null, res: null, resLoading: false }); }
    }
    return `${head}<div class="subtabs">${segmented(tabs, tab, 'data-pgsub')}</div>${body}`;
  }
  // actual value of a bet stat from the box (combos summed); null when the player did not play
  function pgActual(sport, pid, stat) {
    const bg = pgCtx.box;
    if (!bg) return null;
    let p = null;
    Object.values(bg.players || {}).forEach((l) => { l.forEach((x) => { if (String(x.id) === String(pid)) p = x; }); });
    if (!p || (sport === 'nba' && p.dnp !== null && p.dnp !== undefined)) return null;
    const v = (k) => (isNum(p[k]) ? p[k] : null);
    if (sport === 'nba') {
      const M = { pts: v('pts'), reb: v('reb'), ast: v('ast'), tpm: v('tpm'), min: v('min') };
      if (stat in M) return M[stat];
      const parts = { pra: ['pts', 'reb', 'ast'], pr: ['pts', 'reb'], pa: ['pts', 'ast'], ra: ['reb', 'ast'] }[stat];
      return parts && parts.every((k) => M[k] !== null) ? parts.reduce((a, k) => a + M[k], 0) : null;
    }
    const N = { sog: v('sog'), g: v('g'), a: v('a'), pts: v('p'), min: v('toi') };
    return stat in N ? N[stat] : null;
  }
  const PG_RES = { W: 'w', L: 'l', P: 'p' };
  // Actual / W-L-P / Beat close cells for one bet row in Final mode (results row when graded, else computed from the box)
  function pgSettle(sport, r) {
    const row = pgCtx.res && pgCtx.res[r.id];
    const act = row && isNum(row.actual) ? row.actual : pgActual(sport, r.pid, r.b.stat);
    let res = row && row[r.tag] && PG_RES[row[r.tag].result] ? row[r.tag].result : '';
    if (!res && row && row.status === 'void') res = 'Void';
    if (!res && isNum(act) && row === undefined) res = act === r.ph.line ? 'P' : (act > r.ph.line) === (r.b.side !== 'u') ? 'W' : 'L';
    const beat = row && window.RESULTS ? window.RESULTS.beat(row) : null;
    return { act, res, beat };
  }
  const gameView = pgGameView;

  // ---- game AWAY / HOME roster tabs ----
  // log columns (after date, opp, home) are in this order in both packs; keys match the world st/l5 objects
  const COLS = {
    nba: [['min', 'MIN', 1], ['pts', 'PTS', 1], ['reb', 'REB', 1], ['ast', 'AST', 1], ['tpm', '3PM', 1], ['tpa', '3PA', 1]],
    nhl: [['min', 'TOI', 1], ['g', 'G', 2], ['a', 'A', 2], ['sog', 'SOG', 1], ['blk', 'BLK', 2]],
  };
  const fx = (v, dp) => (isNum(v) ? v.toFixed(dp) : '—');
  const projDp = (sport, stat) => (sport === 'nhl' && stat !== 'sog' ? 2 : 1);
  const initials = (name) => {
    const w = String(name || '').split(/\s+/).filter((x) => x && !/^(jr|sr|ii|iii|iv)\.?$/i.test(x));
    const a = w.length > 1 ? w[0][0] + w[w.length - 1][0] : (w[0] || '').slice(0, 2);
    return a ? a.toUpperCase() : '—';
  };
  const roleTxt = (sport, d) => [d.pos, sport === 'nba' ? ({ S: 'Starter', B: 'Bench' }[d.role] || d.role) : d.role].filter(Boolean).join(' · ');
  const roleRank = (role) => {
    const m = /^([FDG])(\d+)?$/.exec(role || '');
    return m ? { F: 0, D: 100, G: 200 }[m[1]] + (+m[2] || 0) : 999;
  };
  // one row per player+stat: the best-EV side of the latest phase (both sides can exist)
  function bestSides(rows) {
    const m = {};
    rows.forEach((r) => {
      const k = r.b.pid + '|' + r.b.stat;
      if (!m[k] || r.ph.ev > m[k].ph.ev) m[k] = r;
    });
    return m;
  }
  // roster card table: fixed columns per sport; rows Season avg / Line / Projection ("—" when missing)
  const RCOLS = {
    nba: [['min', 'MIN', 1], ['pts', 'PTS', 1], ['reb', 'REB', 1], ['ast', 'AST', 1], ['tpm', '3PM', 1]],
    nhl: [['min', 'TOI', 1], ['sog', 'SOG', 1], ['g', 'G', 2], ['a', 'A', 2], ['pts', 'PTS', 2]],
  };
  function rosterRow(sport, id, p, w, picks, ptags) {
    // tag icons only (the card itself is the button; tags are tappable on the player page)
    const ptc = (ptags || []).slice(0, 3).map((x) => `<span class="tgc tg-${tagCat(x)}" role="img" aria-label="${esc(x.label)}">${tagIcon(x)}</span>`).join('');
    const d = w.st === 'ok' ? (w.data || {}) : null;
    const st = (d && d.st) || {};
    const sub = d ? roleTxt(sport, d) : '';
    const pr = p.proj || {};
    const cols = RCOLS[sport] || [];
    const cell = (t, cls) => `<span class="rc${cls ? ' ' + cls : ''}">${t}</span>`;
    const head = cols.map((c) => cell(c[1], 'rh')).join('');
    const season = cols.map((c) => cell(fx(st[c[0]], c[2]))).join('');
    const line = cols.map((c) => { const r = picks[id + '|' + c[0]]; return cell(r ? esc(r.ph.line) : '—', r ? '' : 'nil'); }).join('');
    const proj = cols.map((c) => {
      const ph = pr.close && pr.close[c[0]] ? pr.close : pr.open;
      const v = ph && ph[c[0]] && ph[c[0]].v;
      if (!isNum(v)) return cell('—', 'nil');
      const r = picks[id + '|' + c[0]];
      if (!r) return cell(v.toFixed(projDp(sport, c[0])));
      const arr = r.b.side === 'u' ? '\u25BC' : '\u25B2';
      return cell(`${v.toFixed(projDp(sport, c[0]))}<i aria-label="${r.b.side === 'u' ? 'under' : 'over'}">${arr}</i>`, 'pj ' + evCls(r.ph.ev));
    }).join('');
    const lab = (t) => `<span class="rl">${t}</span>`;
    return `<button class="prow rcard" data-player="${esc(id)}" aria-label="${esc(p.name || id)} player page">
      <span class="rc-top"><span class="ini sm" aria-hidden="true">${esc(initials(p.name))}</span>
        <span class="pr-name"><b>${esc(p.name || id)}</b>${p.inj ? `<i class="inj">${esc(p.inj)}</i>` : ''}${sub ? `<small>${esc(sub)}</small>` : ''}</span>${ptc ? `<span class="tchips">${ptc}</span>` : ''}<span class="chev" aria-hidden="true">\u203A</span></span>
      <span class="rtab" style="--n:${cols.length}">${lab('')}${head}${lab('Season avg')}${season}${lab('Line')}${line}${lab('Projection')}${proj}</span></button>`;
  }
  function rosterTab(sport, date, g, code) {
    const e = ensureSlate(sport, date);
    if (e.st === 'loading') return skRows(4);
    if (e.st === 'err') return `<div class="card empty"><h2>Couldn’t load players</h2><p>Check your connection and try again.</p><button class="pillbtn retry" data-retry-slate="${esc(sport + '/' + date)}">Retry</button></div>`;
    const sl = e.st === 'ok' ? (e.data || {}) : {};
    const list = Object.entries(sl.players || {}).filter(([, p]) => p && p.team === code && String(p.gid) === String(g.gid))
      .map(([id, p]) => ({ id, p, w: ensurePlayer(sport, id) }));
    if (!list.length) return pgCtx.past ? `<div class="card empty"><h2>No ${esc(code)} players</h2>${PG_NOTE}</div>` : empty('Bets', 'No players for ' + code + ' yet', 'Players show up here once the slate is published.', 0);
    const dd = (r) => (r.w.st === 'ok' ? r.w.data || {} : {});
    const mins = (r) => ((dd(r).st || {}).min);
    list.sort((x, y) => {
      let c = 0;
      if (sport === 'nba') c = (dd(x).role === 'S' ? 0 : 1) - (dd(y).role === 'S' ? 0 : 1) || (isNum(mins(y)) ? mins(y) : -1) - (isNum(mins(x)) ? mins(x) : -1);
      else c = roleRank(dd(x).role) - roleRank(dd(y).role);
      return c || (x.p.name < y.p.name ? -1 : x.p.name > y.p.name ? 1 : 0);
    });
    const picks = {}; // model's pick side per player+stat (old slates without the flag: every row counts as pick)
    betRows(sl, g.gid).forEach((r) => { if (r.ph.pick !== false) { const k = r.b.pid + '|' + r.b.stat; if (!picks[k] || r.ph.ev > picks[k].ph.ev) picks[k] = r; } });
    const sgm = (sl.games || {})[g.gid] || null;
    return `<div class="plist">${list.map((r) => rosterRow(sport, r.id, r.p, r.w, picks, playerTags(sport, r.id, date, sgm, r.p.inj, r.p.team))).join('')}</div>`;
  }

  // ---- player page: hero + tabs (Tonight · Trends · Matchup · Recent) ----
  const pHead = (extra) => `<div class="pagehead">${backBtn}</div>${extra || ''}`;
  const PTABS = [['tonight', 'Tonight'], ['trends', 'Trends'], ['matchup', 'Matchup'], ['recent', 'Recent']];
  // [world st/l5 key, label, hist col, decimals]; MIN/TOI first, then the four tile stats
  const TCOLS = {
    nba: [['min', 'MIN', 'min', 1], ['pts', 'PTS', 'pts', 1], ['reb', 'REB', 'reb', 1], ['ast', 'AST', 'ast', 1], ['tpm', '3PM', 'tpm', 1]],
    nhl: [['min', 'TOI', 'toi', 1], ['g', 'G', 'g', 2], ['a', 'A', 'a', 2], ['pts', 'PTS', 'p', 2], ['sog', 'SOG', 'sog', 1]],
  };
  // game-list columns (hist col, label, decimals); goalies have their own set
  const LCOLS = {
    nba: [['min', 'MIN', 0], ['pts', 'PTS', 0], ['reb', 'REB', 0], ['ast', 'AST', 0], ['tpm', '3PM', 0]],
    nhl: [['toi', 'TOI', 1], ['g', 'G', 0], ['a', 'A', 0], ['sog', 'SOG', 0], ['blk', 'BLK', 0]],
    nhlG: [['toi', 'TOI', 1], ['sa', 'SA', 0], ['sv', 'SV', 0], ['ga', 'GA', 0], ['svp', 'SV%', 3]],
  };
  const seasonOf = (d) => +d.slice(0, 4) - (+d.slice(5, 7) < 7 ? 1 : 0);
  const seasonLab = (y) => y + '-' + String(y + 1).slice(2);
  const hv = (h, r, k) => { const i = h.ci[k]; const v = i === undefined ? null : r.v[i]; return isNum(v) ? v : null; };
  const havg = (h, rows, k) => { const xs = rows.map((r) => hv(h, r, k)).filter((v) => v !== null); return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null; };
  const hcell = (v, dp, k) => (v === null || v === undefined ? '—' : k === 'svp' ? v.toFixed(3).replace(/^0/, '') : dp ? v.toFixed(dp) : String(v));
  const dMD = (d) => d.slice(5).replace('-', '/');
  // season being played now: the schedule's season, else the season of the selected day
  const curSeason = (sport) => { const sd = schedData(sport); return sd && sd.raw && isNum(sd.raw.season) ? sd.raw.season : seasonOf(selDate(sport)); };
  // his team's next game(s) from the schedule
  function nextGames(sport, team, n) {
    const sd = schedData(sport), today = ymd(0);
    if (!sd || !team) return [];
    return (sd.byTeam[team] || []).filter((g) => g.status !== 'final' && g.status !== 'post' && g.d >= today).slice(0, n);
  }
  const oppOf = (g, team) => (g.home === team ? g.away : g.home);
  // days of rest before `date` from the schedule: 0 = back-to-back
  function restDays(sport, team, date) {
    const sd = schedData(sport);
    if (!sd || !team) return null;
    const prev = (sd.byTeam[team] || []).filter((g) => g.d < date && g.status !== 'post').map((g) => g.d).sort().pop();
    return prev ? Math.round((dnoon(date) - dnoon(prev)) / 864e5) - 1 : null;
  }
  const restTxt = (n) => (n === null ? '' : n === 0 ? 'Back-to-back' : n + (n === 1 ? ' day rest' : ' days rest'));
  const resCell = (r) => `<b class="wl ${r.res === 'W' ? 'w' : 'l'}">${esc(r.res)}</b> ${esc(r.ts)}–${esc(r.os)}`;
  // game list: Date, Opp, Result, stats; `rows` newest first; season divider rows when the season changes
  function histList(h, rows, lcols, lim) {
    let prev = seasonOf(ymd(0)), shown = 0, out = ''; // a divider also opens the list when its first game is from an earlier season
    for (const r of rows) {
      if (lim && shown >= lim) break;
      const s = seasonOf(r.d);
      if (s !== prev) out += `<div class="gl-sea">${esc(seasonLab(s))}</div>`;
      prev = s; shown++;
      const href = r.gid ? `#${h.sp}/game/${encodeURIComponent(r.gid)}?p=${encodeURIComponent(h.pid)}&d=${r.d}` : '';
      out += `<${href ? 'a' : 'div'} class="gl-row${href ? ' pg-link' : ''}"${href ? ` href="${href}"` : ''}><span>${esc(dMD(r.d))}</span><span>${r.home ? 'vs' : '@'} ${esc(r.opp)}</span><span class="gl-res">${resCell(r)}</span>${lcols.map(([k, , dp]) => `<span>${hcell(hv(h, r, k), dp, k)}</span>`).join('')}</${href ? 'a' : 'div'}>`;
    }
    return `<div class="glog hl" style="--n:${lcols.length}"><div class="gl-row gl-h"><span>Date</span><span>Opp</span><span class="gl-res">Result</span>${lcols.map((c) => `<span>${c[1]}</span>`).join('')}</div>${out}</div>`;
  }
  const noteCard = (t) => `<div class="card empty"><p>${esc(t)}</p></div>`;
  const histErr = (sport, pid) => `<div class="card empty"><h2>Couldn’t load game history</h2><p>Check your connection and try again.</p><button class="pillbtn retry" data-retry-hist="${esc(sport + '/' + pid)}">Retry</button></div>`;

  // Him vs what OPP allows: his season per-game value + rank among his position vs what the opponent gave starters at that position (defense file). '' when anything is missing.
  const DEF_ROWS = {
    nba: [['pts', 'PTS', 1], ['fga', 'FGA', 1], ['fgp', 'FG%', 0, 1], ['tpa', '3PA', 1], ['tpm', '3PM', 1], ['tpp', '3P%', 0, 1], ['fta', 'FTA', 1], ['reb', 'REB', 1], ['ast', 'AST', 1]],
    nhl: [['g', 'G', 2], ['a', 'A', 2], ['p', 'P', 2], ['sog', 'SOG', 1], ['hit', 'HIT', 1], ['blk', 'BLK', 1], ['shp', 'SH%', 0, 1]],
  };
  function defTable(sport, pid, d, opp, hist, thisSea) {
    const dd = defData(sport), P = d.pos;
    if (!dd || !DEF_ROWS[sport] || !dd.groups.includes(P)) return '';
    const me = dd.players[pid], ot = dd.teams[opp], grp = ot && ot.season && ot.season[P];
    if (!me || !grp || !grp.v || !grp.gg) return '';
    const N = dd.n, st = d.st || {}, rk = me.ranks || {};
    const his = (k) => {
      if (me.v && isNum(me.v[k])) return me.v[k];
      if (k === 'hit') return hist && thisSea.length ? havg(hist, thisSea, 'hit') : null;
      const v = st[k === 'p' ? 'pts' : k];
      return isNum(v) && DEF_ROWS[sport].some((r) => r[0] === k && !r[3]) ? v : null;
    };
    const grpLab = sport === 'nba' ? 'starting ' + P : P === 'F' ? 'top-6 F' : 'top-4 D';
    const rows = DEF_ROWS[sport].map(([k, lab, dp, pct]) => {
      const hv0 = his(k), av = grp.v[k], ar = grp.r && grp.r[k], hr = rk[k];
      const f = (v) => (!isNum(v) ? '—' : pct ? (v * 100).toFixed(1) : v.toFixed(dp));
      let dl = '';
      if (isNum(hv0) && isNum(av)) {
        const x = pct ? (av - hv0) * 100 : hv0 > 0 ? (av - hv0) / hv0 * 100 : null;
        if (x !== null) {
          const a = Math.abs(x), cls = a < 3 ? 'n' : (x > 0 ? 'up' : 'dn') + (a >= 10 ? ' hi' : '');
          dl = `<span class="dl ${cls}" aria-label="${x > 0 ? 'they allow more' : 'they allow less'}">${sgn(x, pct ? 1 : 0)}${pct ? 'pp' : '%'}</span>`;
        }
      }
      const orc = ar >= N - 11 ? ' top' : ar <= 12 ? ' bot' : ''; // color rule: opponent top/bottom 12 (season ranks; this table shows season only)
      return `<div class="dt-r"><span class="dt-k">${lab}</span>
        <span class="dt-c">${f(hv0)}${isNum(hr) ? `<i class="rk">#${hr}</i>` : ''}</span>
        <span class="dt-c dt-o">${f(av)}${isNum(ar) ? `<i class="rk${orc}">#${ar}</i>` : ''}${dl}</span></div>`;
    }).join('');
    const foot = `Per game, this season. Him: his average and rank among ${me.n} ${P} (#1 = highest). ${opp}: allowed to ${grpLab}s over ${grp.gg} games, rank of ${N} (#${N} allows the most). Green: they allow more than he averages (pp = percentage points).`;
    return `${sec('Him vs what ' + opp + ' allows')}<div class="card dtab"><div class="dt-r dt-h"><span></span><span>Him<small>of ${esc(me.n)} ${esc(P)}</small></span><span>${esc(opp)} allows<small>rank of ${N}</small></span></div>${rows}<p class="dt-f">${esc(foot)}</p></div>`;
  }


  // ---- Shot matchup (Matchup tab): zone table + court / rink, "His shots" vs "OPP defense vs position" ----
  const SZ = {
    nba: {
      zones: ['rim', 'paint', 'midL', 'midC', 'midR', 'c3L', 'c3R', 'ab3L', 'ab3C', 'ab3R'],
      lab: ['Rim', 'Paint', 'Mid L', 'Mid C', 'Mid R', 'Corner 3 L', 'Corner 3 R', 'Above 3 L', 'Above 3 C', 'Above 3 R'],
      at: ['at the rim', 'in the paint', 'from left mid-range', 'from center mid-range', 'from right mid-range', 'from the left corner 3', 'from the right corner 3', 'from above-the-break 3, left', 'from above-the-break 3, center', 'from above-the-break 3, right'],
      min: 20, unit: 'FG%', verb: 'make', grp: { G: 'guards', F: 'forwards', C: 'centers' },
    },
    nhl: {
      zones: ['behind', 'slot', 'high', 'circL', 'circR', 'ptL', 'ptR'],
      lab: ['Behind net', 'Slot', 'High slot', 'L circle', 'R circle', 'L point', 'R point'],
      at: ['from behind the net', 'in the slot', 'from the high slot', 'from the left circle', 'from the right circle', 'from the left point', 'from the right point'],
      min: 15, unit: 'scoring %', verb: 'score', grp: { F: 'forwards', D: 'defensemen' },
    },
  };
  const SZ_TYPES = [['wrist', 'Wrist'], ['snap', 'Snap'], ['slap', 'Slap'], ['back', 'Backhand'], ['tip', 'Tip / defl.'], ['wrap', 'Wrap-around']];
  const SZ_PT = 0.03; // S% vs league: green at +3 pts or more, red at -3 or less
  const szHue = (s, l) => (!isNum(s) || !isNum(l) ? 'n' : s - l >= SZ_PT ? 'g' : s - l <= -SZ_PT ? 'r' : 'n');
  const szPct = (v) => (isNum(v) ? Math.round(v * 100) + '%' : '—');
  // fill: hue = S% vs league, strength = Dist. (alpha 0.10..0.55 across the view's zone shares; neutral 0.04..0.14)
  function szFills(S, D, LS) {
    const ds = D.filter(isNum), lo = Math.min(...ds), hi = Math.max(...ds);
    return D.map((dv, i) => {
      if (!isNum(dv)) return 'rgba(236,245,240,.03)';
      const t = hi > lo ? (dv - lo) / (hi - lo) : .5, h = szHue(S[i], LS[i]);
      if (h === 'n') return `rgba(236,245,240,${(.04 + t * .10).toFixed(3)})`;
      return (h === 'g' ? 'rgba(62,230,160,' : 'rgba(255,122,112,') + (.10 + t * .45).toFixed(3) + ')';
    });
  }
  // Option C presentation (design approved 10/31 20:29): lead verdict, one shaded court / rink, ranked zone list.
  const szcOpen = {}; // 'm:<sport>/<pid>' = zone list unfolded, 't:<sport>/<pid>' = NHL shot types open
  // F = fill per zone, T = printed label per zone ('' = none), hl = zone index to outline (mismatch zone)
  function szcCourt(F, T, hl) {
    const B = (shape, i) => `${shape.replace('/>', ' class="szb"/>')}${shape.replace('/>', ` style="fill:${F[i]}"/>`)}`;
    const ab = ['170,40 100,236 0,236 0,0 170,0', '170,40 100,236 240,236', '170,40 240,236 340,236 340,0 170,0'];
    const poly = (pts, i) => B(`<polygon points="${pts}"/>`, i);
    const txt = (x, y, i, sz) => (T[i] === '' ? '' : `<text x="${x}" y="${y}"${sz ? ` style="font-size:${sz}px"` : ''}>${T[i]}</text>`);
    // outline of the mismatch zone, drawn after every fill so no later zone paints over it
    const hs = [['<circle cx="170" cy="40" r="36"/>'], ['<rect x="120" y="0" width="100" height="124"/>'],
      [`<polygon points="${ab[0]}"/>`, 1], [`<polygon points="${ab[1]}"/>`, 1], [`<polygon points="${ab[2]}"/>`, 1],
      ['<rect x="0" y="0" width="56" height="110"/>'], ['<rect x="284" y="0" width="56" height="110"/>'],
      [`<polygon points="${ab[0]}"/>`], [`<polygon points="${ab[1]}"/>`], [`<polygon points="${ab[2]}"/>`]];
    const h = hl >= 0 && hs[hl] ? (hs[hl][1] ? `<g clip-path="url(#szc-arc)">` : '<g>') + hs[hl][0].replace('/>', ' class="szchl"/>') + '</g>' : '';
    return `<svg class="szsvg" viewBox="0 0 340 226" role="img" aria-label="Half court with 10 shot zones shaded by make percentage versus league" preserveAspectRatio="xMidYMin meet">
      <defs><clipPath id="szc-out"><path d="M12,0 H328 Q340,0 340,12 V110 A183.8 183.8 0 0 1 0,110 V12 Q0,0 12,0 Z"/></clipPath>
      <clipPath id="szc-arc"><path d="M56,0 L56,110 A133.8,133.8 0 0 0 284,110 L284,0 Z"/></clipPath></defs>
      <g clip-path="url(#szc-out)">
        ${poly(ab[0], 7)}${poly(ab[1], 8)}${poly(ab[2], 9)}
        ${B('<rect x="0" y="0" width="56" height="110"/>', 5)}${B('<rect x="284" y="0" width="56" height="110"/>', 6)}
        <g clip-path="url(#szc-arc)">${poly(ab[0], 2)}${poly(ab[1], 3)}${poly(ab[2], 4)}</g>
        ${B('<rect x="120" y="0" width="100" height="124"/>', 1)}${B('<circle cx="170" cy="40" r="36"/>', 0)}
        <path class="szl" d="M56,0 V110 A133.8,133.8 0 0 0 284,110 V0 M0,110 H56 M284,110 H340 M140,124 L108.1,213.1 M200,124 L231.9,213.1 M120,0 V124 H220 V0"/>
        <circle class="szl" cx="170" cy="40" r="36"/>
        <path class="szh" d="M158,8 H182"/><circle class="szh" cx="170" cy="13" r="4"/>
        ${h}
      </g>
      ${txt(170, 54, 0)}${txt(170, 104, 1)}${txt(88, 64, 2)}${txt(170, 158, 3)}${txt(252, 64, 4)}${txt(28, 61, 5, 16)}${txt(312, 61, 6, 16)}${txt(58, 162, 7)}${txt(170, 206, 8)}${txt(282, 162, 9)}
    </svg>`;
  }
  function szcRink(F, T, hl) {
    const B = (shape, i) => `${shape.replace('/>', ' class="szb"/>')}${shape.replace('/>', ` style="fill:${F[i]}"/>`)}`;
    const R = (x, y, w, h, i) => B(`<rect x="${x}" y="${y}" width="${w}" height="${h}"/>`, i);
    const txt = (x, y, i) => (T[i] === '' ? '' : `<text x="${x}" y="${y}">${T[i]}</text>`);
    const hs = ['<rect x="0" y="0" width="340" height="44"/>', '<rect x="112" y="44" width="116" height="80"/>', '<rect x="112" y="124" width="116" height="84"/>',
      '<rect x="0" y="44" width="112" height="164"/>', '<rect x="228" y="44" width="112" height="164"/>', '<rect x="0" y="208" width="170" height="92"/>', '<rect x="170" y="208" width="170" height="92"/>'];
    const h = hl >= 0 && hs[hl] ? hs[hl].replace('/>', ' class="szchl"/>') : '';
    return `<svg class="szsvg" viewBox="0 0 340 300" role="img" aria-label="Offensive zone with 7 shot zones shaded by scoring percentage versus league" preserveAspectRatio="xMidYMin meet">
      <defs><clipPath id="szc-rink"><path d="M0,300 L0,112 A112,112 0 0 1 112,0 L228,0 A112,112 0 0 1 340,112 L340,300 Z"/></clipPath></defs>
      <g clip-path="url(#szc-rink)">
        ${R(0, 0, 340, 44, 0)}${R(0, 44, 112, 164, 3)}${R(112, 44, 116, 80, 1)}${R(112, 124, 116, 84, 2)}${R(228, 44, 112, 164, 4)}${R(0, 208, 170, 92, 5)}${R(170, 208, 170, 92, 6)}
        <path class="szl" d="M112,44 V208 M228,44 V208 M112,124 H228 M0,208 H340 M170,208 V300"/>
        <circle cx="82" cy="124" r="60" style="fill:none;stroke:rgba(255,122,112,.45);stroke-width:1.2"/><circle cx="258" cy="124" r="60" style="fill:none;stroke:rgba(255,122,112,.45);stroke-width:1.2"/>
        <path d="M0,44 H340" style="stroke:rgba(255,122,112,.6);stroke-width:1.2"/>
        <path d="M146,44 A24,24 0 0 0 194,44" style="fill:none;stroke:rgba(124,195,255,.7);stroke-width:1.2"/>
        <path d="M0,298 H340" style="stroke:rgba(124,195,255,.7);stroke-width:2.4"/>
        ${h}
      </g>
      ${txt(170, 28, 0)}${txt(56, 132, 3)}${txt(170, 90, 1)}${txt(170, 172, 2)}${txt(284, 132, 4)}${txt(85, 260, 5)}${txt(255, 260, 6)}
    </svg>`;
  }

  function shotMatchup(sport, pid, d, opp, team, gsg) {
    const cfg = SZ[sport];
    const hd = (x) => `<div class="sec szh"><span>Shot matchup</span>${x || ''}</div>`;
    if (!cfg) return '';
    const se = ensureShots(sport);
    if (se.st === 'loading') return '';
    const none = hd() + noteCard('Not enough shots yet');
    if (se.st !== 'ok') return none;
    const sd = se.data, e = sd.players[pid], P = (e && e.pos) || d.pos;
    const lg = sd.league && sd.league[P], tm = sd.teams && sd.teams[opp] && sd.teams[opp][P];
    if (!e || !lg || !tm || !(e.n >= cfg.min)) return none;
    const nhl = sport === 'nhl', Z = cfg.zones.length;
    // tonight's projected goalie of the opponent (NHL): from the slate game when known and in the shots file
    let gk = null;
    if (nhl && gsg && gsg.goalies) {
      const gl = gsg.goalies[gsg.home === team ? 'A' : 'B'];
      const ge = gl && gl.id && sd.goalies && sd.goalies[String(gl.id)];
      if (ge && ge.n > 0) gk = { e: ge, name: gl.name };
    }
    const key = sport + '/' + pid, view = state.shotView[key] === 'def' ? 'def' : 'his';
    const defS = gk ? gk.e.s : tm.s, defLS = gk ? sd.league.all.s : lg.s;
    // summary: sum over zones of his Dist. x (allowed S% - league S%), in percentage points
    let tot = 0, best = -1, bi = -1;
    for (let i = 0; i < Z; i++) {
      if (!isNum(e.d[i]) || !isNum(defS[i]) || !isNum(defLS[i])) continue;
      const g = e.d[i] * (defS[i] - defLS[i]);
      tot += g;
      if (Math.abs(g) > best) { best = Math.abs(g); bi = i; }
    }
    tot *= 100;
    const cls = tot > .5 ? 'pos' : tot < -.5 ? 'neg' : '';
    const sum = `<span class="szsum ${cls}">${sgn(tot, 1)} pts ${cfg.unit} ${tot > .5 ? 'favorable' : tot < -.5 ? 'unfavorable' : 'even'}</span>`;
    const gname = cfg.grp[P] || P;
    const defLab = nhl && gk ? `${opp} + ${gk.name}` : `${opp} defense vs ${P}`;
    const tog = `<div class="sztog">${segmented([['his', 'His shots'], ['def', defLab]], view, 'data-shotv', 'szseg')}</div>`;
    const S = view === 'his' ? e.s : defS, D = view === 'his' ? e.d : tm.d;
    const LS = view === 'his' ? lg.s : defLS, LD = lg.d;
    const fills = szFills(S, D, LS);
    // labels only on the 3 highest-volume zones of this view; zones ranked by share of shots (Dist.), ties keep zone order
    const order = D.map((v, i) => i).sort((x, y) => (isNum(D[y]) ? D[y] : -1) - (isNum(D[x]) ? D[x] : -1));
    const top = order.slice(0, 3);
    const T = S.map((v, i) => (!top.includes(i) ? '' : isNum(v) ? Math.round(v * 100) + '' : '–'));
    const art = nhl ? szcRink(fills, T, bi) : szcCourt(fills, T, bi);
    const who = view === 'his' ? 'He ' + cfg.verb + 's' : (nhl && gk ? gk.name + ' allows' : opp + ' allows');
    const leg = `<div class="szc-leg"><span class="szc-sw g"></span>${esc(who)} more than league<span class="szc-sw r"></span>less<span class="szc-ramp"><u></u>darker = more shots</span></div>`;
    const okey = sport + '/' + pid, more = !!szcOpen['m:' + okey], dmax = isNum(D[order[0]]) && D[order[0]] > 0 ? D[order[0]] : 1;
    const rows = order.map((i, n) => {
      const sh = szHue(S[i], LS[i]), dd = isNum(S[i]) && isNum(LS[i]) ? (S[i] - LS[i]) * 100 : null;
      const chip = dd === null ? '<em class="szc-chip n">—</em>' : `<em class="szc-chip ${sh}">${sgn(dd, 0)}</em>`;
      const w = isNum(D[i]) ? Math.max(2, D[i] / dmax * 100).toFixed(0) : 0;
      return `<div class="szc-r${n >= 5 && !more ? ' szc-hide' : ''}${i === bi ? ' lead' : ''}"><span class="szc-k">${cfg.lab[i]}${i === bi ? '<span class="szc-tag">mismatch</span>' : ''}</span>`
        + `<span class="szc-d"><u style="width:${w}%;background:${fills[i]}"></u><i>${szPct(D[i])}</i></span><b class="sz-${sh}">${szPct(S[i])}</b>${chip}</div>`;
    }).join('');
    const hidden = order.length - 5;
    const moreBtn = hidden > 0 ? `<button class="szc-more" data-szcm="${esc(okey)}" aria-expanded="${more}">${more ? 'Fewer zones' : hidden + ' more zones'}</button>` : '';
    const list = `<div class="szc-list" role="table"><div class="szc-r szc-h"><span>Zone</span><span>Share of shots</span><span>S%</span><span>vs lg</span></div>${rows}${moreBtn}</div>`;
    // mismatch: zone with the biggest his-Dist. x (allowed - league) gap
    let mm = '';
    if (bi >= 0) {
      const dnm = (nhl && gk ? opp + ' with ' + gk.name : opp);
      mm = `${cfg.at[bi].replace(/^./, (c) => c.toUpperCase())}: ${szPct(e.d[bi])} of his shots${isNum(e.s[bi]) ? ', he ' + cfg.verb + 's ' + szPct(e.s[bi]) : ''}. ${esc(dnm)} ${nhl && gk ? 'let shooters' : 'lets ' + gname} ${cfg.verb} ${szPct(defS[bi])} there (league ${szPct(defLS[bi])}).`;
    }
    const lead = `<p class="szc-lead">${sum}${mm}</p>`;
    // NHL shot types
    let types = '';
    if (nhl && e.tc) {
      const tv = view === 'his' ? { s: e.ts, d: e.td, l: lg.ts } : gk ? { s: gk.e.ts, d: gk.e.td, l: sd.league.all.ts } : { s: tm.ts, d: tm.td, l: lg.ts };
      const mx = Math.max(.01, ...tv.d.slice(0, 6).filter(isNum));
      types = `<div class="sztypes">${SZ_TYPES.map(([k, lab]) => {
        const i = sd.types.indexOf(k), dv = tv.d[i], sv = tv.s[i], hh = szHue(sv, tv.l[i]);
        const txt = view === 'def' && gk ? (isNum(sv) ? (1 - sv).toFixed(3).replace(/^0/, '') + ' sv%' : '—') : `${szPct(dv)} · ${isNum(sv) ? Math.round(sv * 100) + '% G' : '—'}`;
        return `<div class="szt"><span class="szk">${lab}</span><span class="szbar"><u class="sz-bg-${hh}" style="width:${isNum(dv) ? Math.max(2, dv / mx * 100).toFixed(1) : 0}%"></u></span><span class="szv">${txt}</span></div>`;
      }).join('')}</div>`;
    }
    if (types) {
      const to = !!szcOpen['t:' + okey];
      types = `<div class="szc-types"><button class="szc-tbtn" data-szct="${esc(okey)}" aria-expanded="${to}">Shot types</button>${to ? types : ''}</div>`;
    }
    const html = hd() + `<div class="card szcard szc">${tog}${lead}<div class="szc-art">${art}${leg}</div>${list}${types}</div>`;
    const lock = hd() + noteCard('Shot matchup is part of the premium tier.');
    return window.gate ? window.gate('shotMatchup', html, lock) : html;
  }

  function playerView(sport, pid) {
    ensureMeta(sport);
    const pe = ensurePlayer(sport, pid), sc = ensureSched(sport);
    ensureDef(sport);
    ensureShots(sport);
    if (!store.idxDone || sc.st === 'loading' || store.meta[sport].st === 'loading' || pe.st === 'loading') {
      return pHead(`<div class="phero"><span class="dot"></span><span class="bars">${bar('w70')}${bar('w55')}</span></div>${rowsGeneric(3)}`);
    }
    if (pe.st === 'err') return pHead(`<div class="card empty"><h2>Couldn’t load player</h2><p>Check your connection and try again.</p><button class="pillbtn retry" data-retry-player="${esc(sport + '/' + pid)}">Retry</button></div>`);
    if (pe.st !== 'ok') return pHead(`<div class="card empty"><h2>No data for this player</h2><p>This player has no published stats yet.</p></div>`);
    const d = pe.data || {}, goalie = sport === 'nhl' && d.pos === 'G';
    const date = selDate(sport), se = ensureSlate(sport, date);
    const sl = se.st === 'ok' ? (se.data || {}) : null;
    const sp = sl && sl.players && sl.players[pid];
    const name = d.name || (sp && sp.name) || pid;
    const team = d.team || (sp && sp.team) || '';
    const inj = (sp && sp.inj) || d.inj || '', note = (sp && sp.injNote) || d.injNote || '';
    const mt = tinfo(sport, team);
    const tcol = /^#[0-9a-f]{6}$/i.test(mt.color || '') ? mt.color : 'var(--grey)';
    const meta = [roleTxt(sport, d), isNum(d.gp) ? 'GP ' + d.gp : ''].filter(Boolean).join(' · ');
    const st = d.st || {}, l5 = d.l5 || {};
    // stat tiles (inside the hero): season big, L5 under it with an arrow when it differs >= 10%
    const TILES = sport === 'nba' ? [['pts', 'PTS', 1], ['reb', 'REB', 1], ['ast', 'AST', 1], ['tpm', '3PM', 1]] : [['g', 'G', 2], ['a', 'A', 2], ['pts', 'PTS', 2], ['sog', 'SOG', 1]];
    const l5v = (k) => (sport === 'nhl' && k === 'pts' ? (isNum(l5.g) && isNum(l5.a) ? l5.g + l5.a : null) : l5[k]);
    const tiles = goalie ? '' : `<div class="stiles">${TILES.map(([k, lab, dp]) => {
      const sv = st[k], lv5 = l5v(k);
      let l5html = '';
      if (isNum(lv5)) {
        const big = isNum(sv) && sv > 0 && Math.abs(lv5 - sv) / sv >= 0.1;
        const up = lv5 > sv;
        l5html = `<span class="st-l5${big ? (up ? ' up' : ' dn') : ''}">${big ? `<i aria-label="${up ? 'up' : 'down'}">${up ? '▲' : '▼'}</i>` : ''}L5 ${lv5.toFixed(dp)}</span>`;
      }
      return `<div class="stile"><span class="st-lab">${lab}</span><span class="st-v">${fx(sv, dp)}</span>${l5html}</div>`;
    }).join('')}</div>`;
    const ptg = playerTags(sport, String(pid), date, sl && sp ? (sl.games || {})[sp.gid] || null : null, inj, team);
    const hero = `<div class="phero2" style="--tc:${tcol}"><div class="ph-top"><span class="ini xxl" aria-hidden="true">${esc(initials(name))}</span>
      <span class="pinfo"><h2 class="tname-xl">${esc(name)}</h2>
        <span class="pteam">${team ? tbadge(sport, team, '', `#${sport}/team/${encodeURIComponent(team)}`, true) : ''}<span class="pmeta">${esc(meta)}</span>${inj ? `<i class="inj">${esc(inj)}</i>` : ''}</span></span></div>${ptg.length ? `<div class="ph-tags">${ptg.map((x) => tagPill(sport, team, x, 'ph')).join('')}</div>` : ''}${tiles}</div>`;

    const allRows = sp ? betRows(sl, sp.gid).filter((r) => String(r.b.pid) === String(pid)) : [];
    const mine = Object.values(bestSides(allRows)).sort((x, y) => y.ph.ev - x.ph.ev);
    const tabs = goalie ? PTABS.filter(([k]) => k === 'tonight' || k === 'recent') : PTABS;
    const dflt = mine.length ? 'tonight' : goalie ? 'recent' : 'trends';
    const explicit = tabs.some(([k]) => k === state.playerTab);
    // the default depends on the slate: wait for it (tab bar without a selection) unless the user already chose
    const waiting = !explicit && se.st === 'loading';
    const tab = explicit ? state.playerTab : dflt;
    const bar2 = `<div class="ptabs">${segmented(tabs, waiting ? '' : tab, 'data-ptab', 'ptseg')}</div>`;
    if (waiting) return pHead(hero + bar2 + skRows(3));

    const he = ensureHist(sport, pid);
    const hist = he.st === 'ok' ? he : null;
    const histLoad = he.st === 'loading';
    const histBad = he.st === 'err';
    const hrows = hist ? hist.rows : [];
    const cur = curSeason(sport);
    const thisSea = hrows.filter((r) => seasonOf(r.d) === cur);
    const lcols = goalie ? LCOLS.nhlG : LCOLS[sport];
    const sg = sl && sp && sl.games && sl.games[sp.gid];
    const tonightOpp = sg && team ? (sg.home === team ? sg.away : sg.home) : '';
    let body = '';
    // the opponent's tags (up to 3) inside the matchup card
    const oppPills = (code, dt, sgm) => { const t = teamTags(sport, code, dt, sgm).slice(0, 3); return t.length ? `<div class="tgrow">${t.map((x) => tagPill(sport, code, x, 'pm')).join('')}</div>` : ''; };

    if (tab === 'tonight') {
      if (se.st === 'err') body = `<div class="card empty"><h2>Couldn’t load props</h2><p>Check your connection and try again.</p><button class="pillbtn retry" data-retry-slate="${esc(sport + '/' + date)}">Retry</button></div>`;
      else {
        let card = '';
        if (sg && tonightOpp) {
          const away = sg.home === tonightOpp;
          const rest = restTxt(restDays(sport, team, date));
          card = `<div class="card pmatch"><div class="pm-main">${tbadge(sport, tonightOpp, '', `#${sport}/team/${encodeURIComponent(tonightOpp)}`, true)}
            <span class="pm-t"><b>${away ? '@' : 'vs'} ${esc(tonightOpp)}</b>${rest ? `<small>${esc(rest)}</small>` : ''}</span><span class="pm-time">${esc(fmtTime(sg.kickoff))}</span></div>
            ${oppPills(tonightOpp, date, sg)}${inj ? `<div class="pm-inj"><i class="inj">${esc(inj)}</i>${note ? `<span>${esc(note)}</span>` : ''}</div>` : ''}</div>`;
        }
        const props = mine.length ? `${sec('Props')}<div class="betlist">${mine.map(betRow).join('')}</div>`
          : `<div class="card empty"><p>No props for him tonight.</p><button class="pillbtn" data-ptab="trends">See trends</button></div>`;
        body = card + props;
      }
    } else if (tab === 'trends') {
      const CH = sport === 'nba' ? [['pts', 'PTS'], ['reb', 'REB'], ['ast', 'AST'], ['tpm', '3PM'], ['pra', 'PRA']] : [['sog', 'SOG'], ['pts', 'PTS'], ['g', 'G'], ['a', 'A']];
      const cols = COLS[sport];
      const logsAll = Array.isArray(d.logs) ? d.logs : [];
      const ci = (k) => cols.findIndex((c) => c[0] === k);
      const lval = (r, k) => {
        const g = (x) => r[3 + ci(x)];
        if (k === 'pra') return isNum(g('pts')) && isNum(g('reb')) && isNum(g('ast')) ? g('pts') + g('reb') + g('ast') : null;
        if (sport === 'nhl' && k === 'pts') return isNum(g('g')) && isNum(g('a')) ? g('g') + g('a') : null;
        const v = g(k); return isNum(v) ? v : null;
      };
      let chart = '';
      if (logsAll.length >= 2) {
        const ck = sport + '/' + pid;
        const topStat = mine.length ? mine[0].b.stat : '';
        let cs = state.chartStat[ck];
        if (!CH.some((c) => c[0] === cs)) cs = CH.some((c) => c[0] === topStat) ? topStat : CH[0][0];
        const pts = logsAll.map((r) => ({ r, v: lval(r, cs) })).filter((x) => x.v !== null).slice(-10);
        const lr = allRows.find((r) => r.b.stat === cs);
        const line = lr ? lr.ph.line : null;
        const chips = `<div class="bchips" role="group" aria-label="Chart stat">${CH.map((c) => `<button class="bchip${c[0] === cs ? ' on' : ''}" data-cstat="${c[0]}" aria-pressed="${c[0] === cs}">${c[1]}</button>`).join('')}</div>`;
        if (pts.length >= 2) {
          const hasL = isNum(line);
          const max = Math.max(1, ...pts.map((x) => x.v), hasL ? line : 0);
          const H = 104, hOf = (v) => Math.round(v / max * H * 10) / 10;
          const over = hasL ? pts.filter((x) => x.v > line).length : 0;
          const head = hasL ? `Over ${line} in ${over} of ${pts.length}` : `Last ${pts.length} games`;
          const vf = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
          const cells = pts.map((x) => {
            const hi = hasL && x.v > line;
            const col = hasL ? (hi ? 'var(--pos)' : 'var(--faint)') : 'var(--accent)';
            const op = hasL ? (hi ? .85 : .7) : .7;
            const lab = (x.r[2] === 1 ? 'vs ' : x.r[2] === 0 ? '@ ' : '') + (x.r[1] || '');
            return `<div class="cb"><span class="cb-v">${vf(x.v)}</span><span class="cb-bar" style="height:${Math.max(2, hOf(x.v))}px;background:${col};opacity:${op}"></span>
              <span class="cb-x">${esc(lab)}</span><span class="cb-d">${esc(String(x.r[0] || '').replace('-', '/'))}</span></div>`;
          }).join('');
          const lineEl = hasL ? `<span class="cline" style="bottom:${hOf(line) + 38}px"><em>Line ${esc(line)}</em></span>` : '';
          chart = sec('Recent performances') + chips + `<div class="card cchart" style="--cn:${pts.length}"><div class="ch-h">${esc(head)}</div>
            <div class="cplot${hasL ? ' hl' : ''}${pts.length > 6 ? ' thin' : ''}${pts.length > 4 ? ' sm' : ''}" role="img" aria-label="${esc(CH.find((c) => c[0] === cs)[1])} in last ${pts.length} games: ${pts.map((x) => vf(x.v)).join(', ')}${hasL ? '. ' + head : ''}">${lineEl}${cells}</div></div>`;
        } else chart = sec('Recent performances') + chips + '<div class="card empty"><p>Not enough games with this stat.</p></div>';
      }
      // Season / Last 10 / Last 5 (hist, this season); without hist: world season + L5
      const tc = TCOLS[sport];
      const cell = (t, cls) => `<span class="rc${cls ? ' ' + cls : ''}">${t}</span>`;
      const trow = (lab, getter) => `<span class="rl">${lab}</span>${tc.map((c) => { const v = getter(c); return isNum(v) ? cell(v.toFixed(c[3])) : cell('—', 'nil'); }).join('')}`;
      let avg;
      if (histLoad) avg = sec('Averages') + skRows(2);
      else {
        const l10 = thisSea.slice(0, 10), l5h = thisSea.slice(0, 5);
        const n = (rows, m) => (rows.length < m ? rows.length : m);
        let rowsHtml = trow(`Season${isNum(d.gp) ? ` (${d.gp})` : ''}`, (c) => st[c[0]]);
        if (hist && l10.length) rowsHtml += trow(`Last ${n(l10, 10)}`, (c) => havg(hist, l10, c[2]));
        if (hist && l5h.length) rowsHtml += trow(`Last ${n(l5h, 5)}`, (c) => havg(hist, l5h, c[2]));
        else rowsHtml += trow('Last 5', (c) => (sport === 'nhl' && c[0] === 'pts' ? l5v('pts') : l5[c[0]]));
        avg = sec('Averages') + `<div class="card spl"><span class="rtab" style="--n:${tc.length}"><span class="rl"></span>${tc.map((c) => cell(c[1], 'rh')).join('')}${rowsHtml}</span></div>`;
      }
      // home / away splits
      // NHL `ha` has g and a but no pts: per-game pts = avg g + avg a (exact, same games)
      const addPts = (o) => (o && !isNum(o.pts) && isNum(o.g) && isNum(o.a) ? Object.assign({}, o, { pts: o.g + o.a }) : o);
      const ha0 = d.ha || {};
      const ha = sport === 'nhl' ? { home: addPts(ha0.home), away: addPts(ha0.away) } : ha0;
      const hcols = TILES.filter(([k]) => ha.home && ha.away && (isNum(ha.home[k]) || isNum(ha.away[k])));
      let splits = '';
      if ((ha.home || ha.away) && hcols.length) {
        const row = (lab, o) => `<span class="rl">${lab}${o && isNum(o.gp) ? ` (${o.gp})` : ''}</span>${hcols.map(([k, , dp]) => (o && isNum(o[k]) ? cell(o[k].toFixed(dp)) : cell('—', 'nil'))).join('')}`;
        splits = sec('Splits') + `<div class="card spl"><span class="rtab" style="--n:${hcols.length}"><span class="rl"></span>${hcols.map((c) => cell(c[1], 'rh')).join('')}${row('Home', ha.home)}${row('Away', ha.away)}</span></div>`;
      }
      body = (chart || (logsAll.length ? '' : sec('Recent performances') + noteCard('No games yet.'))) + avg + splits;
    } else if (tab === 'matchup') {
      let opp = '', label = '', away = false, gdate = '', gsg = null;
      if (tonightOpp) { opp = tonightOpp; away = sg.home === tonightOpp; label = 'Tonight'; gdate = date; gsg = sg; }
      else {
        const ng = nextGames(sport, team, 1)[0];
        if (ng) { opp = oppOf(ng, team); away = ng.home !== team; label = 'Next game · ' + dowOf(ng.d) + ' ' + mdOf(ng.d); gdate = ng.d; gsg = slateGame(sport, ng.d, ng.gid); }
      }
      if (!opp) body = noteCard(sc.st === 'ok' ? 'No upcoming game found for ' + (team || 'his team') + '.' : 'The schedule is not available yet.');
      else {
        const head = `<div class="card pmatch"><div class="pm-main">${tbadge(sport, opp, '', `#${sport}/team/${encodeURIComponent(opp)}`, true)}<span class="pm-t"><b>${away ? '@' : 'vs'} ${esc(opp)}</b><small>${esc(label)}</small></span></div>${oppPills(opp, gdate, gsg)}</div>`;
        const dtab = goalie ? '' : defTable(sport, pid, d, opp, hist, thisSea);
        let vs;
        if (histLoad) vs = skRows(3);
        else if (histBad) vs = histErr(sport, pid);
        else if (!hist) vs = noteCard('No game history for this player yet.');
        else {
          const g = hrows.filter((r) => r.opp === opp);
          if (!g.length) vs = noteCard(`No games vs ${opp} in the last two seasons.`);
          else {
            const tc = TCOLS[sport], cell = (t, cls) => `<span class="rc${cls ? ' ' + cls : ''}">${t}</span>`;
            const arow = `<span class="rl">vs ${esc(opp)} (${g.length} GP)</span>${tc.map((c) => { const v = havg(hist, g, c[2]); return isNum(v) ? cell(v.toFixed(c[3])) : cell('—', 'nil'); }).join('')}`;
            vs = `${sec('Averages')}<div class="card spl"><span class="rtab" style="--n:${tc.length}"><span class="rl"></span>${tc.map((c) => cell(c[1], 'rh')).join('')}${arow}</span></div>
              ${sec('Games vs ' + opp)}${histList(hist, g, lcols)}`;
          }
        }
        body = head + dtab + (goalie ? '' : shotMatchup(sport, pid, d, opp, team, gsg)) + vs;
      }
    } else { // recent
      let log;
      if (histLoad) log = skRows(4);
      else if (histBad) log = histErr(sport, pid);
      else if (!hist) log = noteCard('No game history for this player yet.');
      else if (!hrows.length) log = noteCard('No games played yet.');
      else {
        const all = !!state.pmore[sport + '/' + pid], lim = all ? 0 : 20;
        log = histList(hist, hrows, lcols, lim) + (!all && hrows.length > 20 ? `<button class="pillbtn" data-pmore="${esc(sport + '/' + pid)}">Show all ${hrows.length} games</button>` : '');
      }
      const ng = nextGames(sport, team, 5);
      let next;
      if (sc.st !== 'ok') next = noteCard(sc.st === 'err' ? 'The schedule could not be loaded.' : 'No schedule published yet.');
      else if (!ng.length) next = noteCard('No upcoming games found.');
      else next = `<div class="sched" aria-label="Next games">${ng.map((g) => {
        const o = oppOf(g, team);
        return `<div class="srow"><span class="sd">${dowOf(g.d)} ${mdOf(g.d)}</span><span class="sv"><span class="vs">${g.home === team ? 'vs' : '@'}</span>${tbadge(sport, o, 's', '', true)}<span class="oc">${esc(o)}</span></span><span class="sr">${esc(g.status === 'scheduled' ? ktxt(g) : g.status.toUpperCase())}</span></div>`;
      }).join('')}</div>`;
      body = sec('Game log') + log + sec('Next games') + next;
    }
    return pHead(hero + bar2 + body);
  }

  function teamView(sport, code) {
    ensureMeta(sport);
    const sc = ensureSched(sport);
    const t = tinfo(sport, code);
    const rec = recOf(sport, code, '9999-12-31');
    const sub = rec ? `<span class="trec">${esc(rec)}</span>` : bar('w40');
    const hero = t.name
      ? `${tbadge(sport, code, 'xl', '', true)}<span class="bars"><h2 class="tname-xl">${esc(t.name)}</h2>${sub}</span>`
      : `${badge(code, 'xl')}<span class="bars">${bar('w70')}${rec ? sub : bar('w40')}</span>`;
    ensureDef(sport);
    const ng = nextGames(sport, code, 1)[0];
    const tg = defData(sport) ? teamTags(sport, code, ng ? ng.d : '', ng ? slateGame(sport, ng.d, ng.gid) : null) : null;
    return `<div class="pagehead">${backBtn}</div>
      <div class="phero">${hero}</div>
      ${tg ? sec('Tags') + tagRows(sport, code, tg) : ''}${sec('Splits')}${rowsGeneric(2)}${sec('Roster')}${rowsGeneric(2)}${sec('Schedule')}${teamSchedule(sport, code, sc)}`;
  }

  function teamSchedule(sport, code, sc) {
    if (sc.st === 'loading') return rowsGeneric(3);
    const sd = schedData(sport);
    if (!sd) return `<div class="card empty"><p>${sc.st === 'err' ? 'The schedule could not be loaded.' : 'No schedule published yet.'}</p></div>`;
    const games = sd.byTeam[code] || [];
    if (!games.length) return `<div class="card empty"><p>No games found for ${esc(code)}.</p></div>`;
    const items = games.map((g) => ({ k: g.kickoff, d: g.d, g }));
    const bye = sd.byes[code], bw = bye && sd.weeks.find((w) => w.w === bye);
    if (bw) items.push({ k: bw.start + 'T00:00Z', d: bw.start, bye: bye });
    items.sort((x, y) => (x.k < y.k ? -1 : x.k > y.k ? 1 : 0));
    const next = games.find((g) => g.status !== 'final' && g.status !== 'post');
    let month = '', out = '';
    items.forEach((it) => {
      const m = monthOf(it.d);
      if (m !== month) { month = m; out += `<div class="mh">${m}</div>`; }
      if (it.bye) { out += `<div class="srow bye"><span class="sd">WEEK ${esc(it.bye)}</span><span class="sv"></span><span class="sr">BYE</span></div>`; return; }
      const g = it.g, home = g.home === code, opp = home ? g.away : g.home;
      let r;
      if (g.status === 'final' && g.final) {
        const mine = g.final[home ? 'home' : 'away'], oth = g.final[home ? 'away' : 'home'];
        const res = mine > oth ? 'W' : mine < oth ? (sport === 'nhl' && g.ot ? 'OTL' : 'L') : 'T';
        r = `<b class="wl ${mine > oth ? 'w' : mine < oth ? 'l' : ''}">${res}</b> ${esc(mine)}–${esc(oth)}${g.ot && res !== 'OTL' ? ` <small>${esc(g.ot)}</small>` : ''}`;
      } else if (g.status === 'post') r = 'Postponed';
      else if (g.status === 'live') r = '<span class="amber">LIVE</span>';
      else if (g.status === 'scheduled') r = esc(ktxt(g));
      else r = esc(g.status.toUpperCase());
      const href = g.status === 'final' && g.final ? `#${sport}/game/${encodeURIComponent(g.gid)}` : `#${sport}/day/${g.d}`;
      out += `<a class="srow${g === next ? ' next' : ''}" ${g === next ? 'data-next ' : ''}href="${href}"><span class="sd">${dowOf(g.d)} ${mdOf(g.d)}</span>
        <span class="sv"><span class="vs">${home ? 'vs' : '@'}</span>${tbadge(sport, opp, 's', '', true)}<span class="oc">${esc(opp)}</span></span><span class="sr">${r}</span></a>`;
    });
    return `<div class="sched" aria-label="${esc(code)} schedule">${out}</div>`;
  }

  // ---- Results tab, Model view (maths + HTML in app/results.js) ----
  store.res = {};
  let resWait = false;
  // One month of one sport: ../results/<sp>/<YYYY-MM>.json ({ rows: { betId: row }, games }); cached in store.res
  function ensureResults(sp, month) {
    const k = sp + '/' + month;
    if (store.res[k]) return store.res[k];
    const e = store.res[k] = { st: 'loading', sp, month };
    getJSON('../results/' + sp + '/' + month + '.json' + ver()).then((r) => {
      if (r.nf) { e.st = 'err'; return; }
      const rows = r.data && r.data.rows;
      e.rows = (Array.isArray(rows) ? rows : Object.values(rows || {})).map((x) => Object.assign({ sp }, x));
      e.st = 'ok';
    }, () => { e.st = 'err'; }).then(rerender);
    return e;
  }
  function resultsView() {
    const R = window.RESULTS, s = state.res;
    const defs = (window.GLOSSARY || {}).results || {};
    const info = (k) => ({ btn: infoBtn('res', k, defs), note: infoNote('res', k, defs) });
    const gate = (html, lock) => (window.gate ? window.gate('resultsDeepFilters', html, lock) : html);
    const ctx = { s, sport: state.filter, info, gate };
    if (!R) { ctx.err = true; return `<div class="seg-wrap">${segmented(FILTERS, state.filter, 'data-filter')}</div>`; }
    const head = segmented(FILTERS, state.filter, 'data-filter');
    if (s.view === 'mine') return head + R.view(ctx);
    if (!store.idxDone) {
      if (!resWait) { resWait = true; indexP.then(rerender); }
      ctx.loading = true; return head + R.view(ctx);
    }
    const sps = state.filter === 'All' ? ['nfl', 'nba', 'nhl'] : [state.filter.toLowerCase()];
    const rg = R.range(s.range, ymd(0));
    const ents = [];
    sps.forEach((sp) => {
      const sx = store.idx && store.idx.sports && store.idx.sports[sp];
      R.monthsIn(sx && sx.results, rg).forEach((m) => ents.push(ensureResults(sp, m)));
    });
    if (ents.some((e) => e.st === 'err')) ctx.err = true;
    else if (ents.some((e) => e.st === 'loading')) ctx.loading = true;
    else if (!ents.length) ctx.noData = `${state.filter === 'All' ? 'No sport' : state.filter} has no graded results in this date range yet.`;
    if (!ctx.err && !ctx.loading && !ctx.noData) {
      const rows = [].concat.apply([], ents.map((e) => e.rows));
      ctx.B = R.build(rows, { ph: s.ph, from: rg.from, to: rg.to, mkt: s.mkt, ou: s.ou, fd: s.fd, ha: s.ha });
    }
    return head + R.view(ctx);
  }
  function resultsClick(v) {
    const i = v.indexOf(':'), k = v.slice(0, i), x = v.slice(i + 1), s = state.res;
    if (k === 'fold') s.fold = !s.fold;
    else if (k === 'reset') { s.mkt = s.ou = s.fd = s.ha = ''; s.range = 'season'; }
    else if (k === 'retry') { Object.keys(store.res).forEach((q) => { if (store.res[q].st === 'err') delete store.res[q]; }); }
    else if (k in s && k !== 'fold') s[k] = x;
  }
  // chart readout: tap or hover a day
  function resultsHover(e) {
    const g = e.target.closest && e.target.closest('.rs-x');
    if (!g) return;
    const svg = g.closest('svg');
    svg.querySelectorAll('.rs-x.on').forEach((n) => n.classList.remove('on'));
    g.classList.add('on');
    const rd = svg.parentNode.querySelector('.rs-read');
    if (rd) rd.textContent = g.dataset.read;
  }
  view.addEventListener('click', resultsHover);
  view.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') resultsHover(e); });

  function parse() {
    const h = location.hash.slice(1), qi = h.indexOf('?');
    const q = {};
    if (qi >= 0) h.slice(qi + 1).split('&').forEach((kv) => { const i = kv.indexOf('='); if (i > 0) q[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1)); });
    if (q.p && !/^[A-Za-z0-9_-]{1,40}$/.test(q.p)) delete q.p;
    if (q.d && !/^\d{4}-\d{2}-\d{2}$/.test(q.d)) delete q.d;
    const p = (qi >= 0 ? h.slice(0, qi) : h).split('/').map((x) => decodeURIComponent(x));
    const r = p[0];
    if (PAGES[r]) return { key: r, page: r };
    const sport = SPORTS[r] ? r : 'nba';
    const kind = SUBTITLES[p[1]] ? p[1] : 'root';
    if (p[1] === 'day' && /^\d{4}-\d{2}-\d{2}$/.test(p[2] || '')) return { key: sport + '/day', sport, kind: 'day', id: p[2] };
    let id = kind === 'game' ? (/^[A-Za-z0-9_-]{1,40}$/.test(p[2] || '') ? p[2] : '') : kind === 'player' ? (/^[A-Za-z0-9_-]{1,40}$/.test(p[2] || '') ? p[2] : '') : '';
    if (kind === 'team') id = /^[A-Za-z0-9]{1,4}$/.test(p[2] || '') ? p[2].toUpperCase() : '\u2014';
    if ((kind === 'game' || kind === 'player') && !id) return { key: sport, sport, kind: 'root', id: '' };
    return { key: [sport, kind, id].filter(Boolean).join('/'), sport, kind, id, q };
  }

  function render() {
    const c = cur;
    closeTag();
    const changed = c.key !== lastKey;
    lastKey = c.key;
    const title = c.page ? PAGES[c.page] : c.kind === 'root' ? SPORTS[c.sport] : SUBTITLES[c.kind];
    $('title').textContent = title;
    document.title = `${title} \u00b7 Slate Projector`;
    const navKey = c.page || c.sport;
    document.querySelectorAll('#nav a').forEach((a) => {
      if (a.dataset.route === navKey) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });

    if (c.page === 'bets') {
      view.innerHTML = betsPage();
    } else if (c.page === 'results') {
      view.innerHTML = resultsView();
    } else if (c.kind === 'standings') view.innerHTML = standings(c.sport);
    else if (c.kind === 'game') view.innerHTML = gameView(c.sport, c.id);
    else if (c.kind === 'player') view.innerHTML = playerView(c.sport, c.id);
    else if (c.kind === 'team') view.innerHTML = teamView(c.sport, c.id);
    else view.innerHTML = sportRoot(c.sport);

    const pl = view.querySelector('.pills'), po = pl && pl.querySelector('.on');
    if (po) pl.scrollLeft = Math.max(0, po.offsetLeft - (pl.clientWidth - po.offsetWidth) / 2);
    const sch = view.querySelector('.sched'), nx = sch && sch.querySelector('[data-next]');
    if (nx) sch.scrollTop = Math.max(0, nx.offsetTop - 56);
    const bc = view.querySelector('.bchips');
    if (bc && !changed) bc.scrollLeft = bcScroll;
    const on = view.querySelector('.chips .on');
    if (on) on.parentNode.scrollLeft = Math.max(0, on.offsetLeft - 8);
    if (changed) {
      window.scrollTo(0, 0);
      view.classList.remove('enter'); void view.offsetWidth; view.classList.add('enter');
    }
    const hlRow = view.querySelector('#pg-hl');
    if (hlRow && c.q && c.q.p) {
      const hk = c.key + '?' + c.q.p;
      if (!pgScrolled[hk]) {
        pgScrolled[hk] = true;
        const top = document.querySelector('.topbar').offsetHeight;
        const y = hlRow.getBoundingClientRect().top + window.scrollY - top - Math.round(window.innerHeight * 0.3);
        window.scrollTo(0, Math.max(0, y));
      }
    }
    placeHl(!changed);
  }

  const sportOf = () => cur.sport || 'nba';
  view.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const d = b.dataset;
    const bcEl = view.querySelector('.bchips'); bcScroll = bcEl ? bcEl.scrollLeft : 0;
    if (d.back !== undefined) return goBack();
    if (d.rs !== undefined) { resultsClick(d.rs); render(); return; }
    if (d.retry) { delete store.days[d.retry]; const m = store.meta[sportOf()]; if (m && m.st === 'err') delete store.meta[sportOf()]; render(); return; }
    if (d.retrySlate) { delete store.slates[d.retrySlate]; render(); return; }
    if (d.player) { location.hash = '#' + sportOf() + '/player/' + encodeURIComponent(d.player); return; }
    if (d.retryHist) { delete store.hist[d.retryHist]; render(); return; }
    if (d.ptab) {
      const was = window.scrollY;
      state.playerTab = d.ptab; render();
      const top = document.querySelector('.topbar').offsetHeight;
      const hb = view.querySelector('.phero2');
      if (hb) { const nat = hb.getBoundingClientRect().bottom + window.scrollY - top; if (was > nat) window.scrollTo(0, nat); }
      return;
    }
    if (d.pmore) { state.pmore[d.pmore] = true; render(); return; }
    if (d.retryPlayer) { delete store.players[d.retryPlayer]; render(); return; }
    if (d.bet) { if (state.betOpen[d.bet]) delete state.betOpen[d.bet]; else state.betOpen[d.bet] = true; }
    else if (d.sort) state.betSort = d.sort;
    else if (d.bside) state.betSide = d.bside;
    else if (d.bf) {
      const f = state.betF, k = d.bf;
      if (k === 'all') { f.ga = false; f.mkt = ''; }
      else if (k === 'ga') f.ga = !f.ga;
      else if (k.startsWith('mkt:')) f.mkt = f.mkt === k.slice(4) ? '' : k.slice(4);
    }
    else if (d.sub) state.gameTab = d.sub;
    else if (d.pgsub) state.pgTab = d.pgsub;
    else if (d.pgproj !== undefined) state.pgProj = !state.pgProj;
    else if (d.pgfold) { if (state.pgOpen[d.pgfold]) delete state.pgOpen[d.pgfold]; else state.pgOpen[d.pgfold] = true; }
    else if (d.cmp) state.cmpSplit = d.cmp;
    else if (d.shotv) state.shotView[sportOf() + '/' + cur.id] = d.shotv;
    else if (d.szcm) { szcOpen['m:' + d.szcm] = !szcOpen['m:' + d.szcm]; }
    else if (d.szct) { szcOpen['t:' + d.szct] = !szcOpen['t:' + d.szct]; }
    else if (d.cstat) state.chartStat[sportOf() + '/' + cur.id] = d.cstat;
    else if (d.info) { if (state.infoOpen[d.info]) delete state.infoOpen[d.info]; else state.infoOpen[d.info] = true; }
    else if (d.day) state.sel[sportOf()] = d.day;
    else if (d.filter) state.filter = d.filter;
    else return;
    render();
  });

  // ======== My Bets (Bets tab, add flow). Self-contained section: hooks are addBtn() in betRow / tblCard and betsPage() in render ========
  const MB = window.MyBets;
  let mb = MB.load();
  state.betSeg = 'dash'; // Bets tab segment: dash | mine
  state.mbMore = false; // My Bets 'Show all settled'
  const idDate = (id) => { const m = /^(\d{4}-\d{2}-\d{2})-/.exec(String(id)); return m ? m[1] : ''; };
  const betText = (r) => `${BET_STAT[r.b.stat] || String(r.b.stat).toUpperCase()} ${r.b.side === 'u' ? 'U' : 'O'} ${r.ph.line}`;
  const uTxt = (u) => `${+Number(u).toFixed(2)}u`;
  const uSgn = (v) => `${sgn(v, 2)}u`;
  const plCls = (v) => (v > 0.004 ? 'u-pos' : v < -0.004 ? 'u-neg' : 'u-n');
  const PLUS_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6v12M6 12h12"/></svg>';
  const CHECK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

  // "+" / check button of a bet row (a sibling of the row button, so tapping it never expands the row)
  function addBtn(sport, r) {
    if (!isNum(r.ph.odds)) return '';
    const on = !!mb.bets[r.id], lab = `${r.name} ${betText(r)}`;
    return `<button class="addb${on ? ' on' : ''}" data-addbet="${esc(sport + '|' + r.id)}" aria-pressed="${on}" aria-label="${on ? 'Edit' : 'Add'} ${esc(lab)} ${on ? 'in' : 'to'} My Bets">${on ? CHECK_SVG : PLUS_SVG}</button>`;
  }
  // slate row (betRows shape) of a bet id, or null while the slate is not loaded
  function slateRow(sport, id) {
    const date = idDate(id), e = store.slates[sport + '/' + date];
    if (!e || e.st !== 'ok') return null;
    const b = (e.data.bets || {})[id];
    if (!b || b.type !== 'prop') return null;
    const r = betRows(e.data, b.gid).find((x) => x.id === id);
    return r ? { r, slate: e.data, date } : null;
  }
  function newBet(sport, found) {
    const { r, slate, date } = found, sg = (slate.games || {})[r.b.gid] || {};
    const g = GRADE_ORDER.includes(r.ph.grade) ? r.ph.grade : '';
    return {
      id: r.id, sport, date, gid: String(r.b.gid), type: 'prop', market: r.b.stat, side: r.b.side, line: r.ph.line, odds: r.ph.odds, units: 1,
      label: `${r.name} ${betText(r)}`, team: r.team, opp: sg.away === r.team ? sg.home || '' : sg.home === r.team ? sg.away || '' : '',
      addedAt: new Date().toISOString(), oddsEdited: false, status: 'open', settledAt: '', pl: 0,
      pid: r.pid, start: sg.kickoff || '', away: sg.away || '', home: sg.home || '', grade: g, uncal: !!r.ph.uncal,
    };
  }

  // ---- add / edit sheet ----
  const bsheet = $('bet-sheet'), bdrop = $('backdrop');
  let bs = null; // { sport, id, bet (draft or stored), edit, units }
  function bsRender() {
    const b = bs.bet, locked = bs.edit && b.status !== 'open';
    const sub = (b.away && b.home ? `${b.away} @ ${b.home}` : [b.team, b.opp].filter(Boolean).join(' vs ')) + ` · ${longOf(b.date)}`;
    const res = locked ? `<span class="res-pill ${b.status === 'W' ? 'w' : b.status === 'L' ? 'l' : b.status === 'void' ? 'v' : 'p'}">${b.status === 'void' ? 'Void' : b.status}</span>` : '';
    bsheet.innerHTML = `<div class="grab" aria-hidden="true"></div>
      <h2 id="bs-title">${bs.edit ? (locked ? 'Settled bet' : 'Edit bet') : 'Add to My Bets'}</h2>
      <div class="bs-bet"><b>${esc(b.label)}</b><span>${esc(sub)}</span></div>
      <div class="bs-row"><span class="lbl">Line</span><span class="val">${esc(b.line === null ? '—' : b.line)}${res}</span></div>
      ${locked ? `<div class="bs-row"><span class="lbl">Odds</span><span class="val">${fmtOdds(b.odds)}</span></div><div class="bs-row"><span class="lbl">Stake</span><span class="val">${uTxt(b.units)}</span></div>
        <div class="bs-row"><span class="lbl">Result</span><span class="val ${plCls(b.pl)}">${b.status === 'void' ? 'Void, no stake' : uSgn(b.pl)}</span></div>`
    : `<label class="bs-row" for="bs-odds"><span class="lbl">Odds</span><input id="bs-odds" class="bs-in" value="${esc(fmtOdds(b.odds).replace(MINUS, '-'))}" inputmode="text" autocomplete="off" autocapitalize="off" spellcheck="false" aria-describedby="bs-err" aria-invalid="false"></label>
      <p id="bs-err" class="bs-err" role="alert" hidden>Enter American odds like -110 or +150.</p>
      <div class="bs-row bs-urow"><span class="lbl">Units</span><div class="bs-units" role="group" aria-label="Units">${MB.UNIT_CHOICES.map((u) => `<button class="bchip${u === bs.units ? ' on' : ''}" data-bsu="${u}" aria-pressed="${u === bs.units}">${uTxt(u)}</button>`).join('')}</div></div>`}
      ${locked ? '' : `<button class="bs-go" id="bs-go">${bs.edit ? 'Update' : 'Add bet'}</button>`}
      ${bs.edit ? '<button class="bs-rm" id="bs-rm">Remove bet</button>' : ''}
      <button class="bs-x" id="bs-x">Close</button>`;
    bsheet.setAttribute('aria-labelledby', 'bs-title');
  }
  function bsOpen(sport, id, trigger) {
    const have = mb.bets[id];
    let bet;
    if (have) bet = have;
    else {
      const found = slateRow(sport, id);
      if (!found || !isNum(found.r.ph.odds)) return;
      bet = newBet(sport, found);
    }
    bs = { sport, id, bet, edit: !!have, units: bet.units, trigger };
    bsRender();
    bsheet.hidden = bdrop.hidden = false;
    const f = $('bs-odds') || $('bs-x'); if (f) f.focus();
  }
  function bsClose() {
    if (!bs) return;
    const t = bs; bs = null;
    bsheet.hidden = bdrop.hidden = true;
    const again = document.querySelector(`[data-addbet="${(window.CSS && CSS.escape ? CSS.escape(t.sport + '|' + t.id) : t.sport + '|' + t.id)}"]`);
    if (again) again.focus(); else if (t.trigger && t.trigger.isConnected) t.trigger.focus();
  }
  let toastT = 0;
  function toast(msg) {
    let el = $('toast');
    if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.textContent = msg; el.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), 3200);
  }
  function bsCommit() {
    const inp = $('bs-odds'), odds = MB.parseOdds(inp ? inp.value : '');
    if (odds === null) { $('bs-err').hidden = false; inp.setAttribute('aria-invalid', 'true'); inp.focus(); return; }
    const b = Object.assign({}, bs.bet, { odds, units: bs.units });
    if (bs.edit) b.oddsEdited = bs.bet.oddsEdited || odds !== bs.bet.odds; else b.oddsEdited = odds !== bs.bet.odds;
    if (!bs.edit && odds === bs.bet.odds) b.oddsEdited = false;
    mb.bets[b.id] = MB.cleanBet(b);
    const ok = mbSave(), edit = bs.edit;
    bsClose(); render();
    toast(ok ? (edit ? 'Bet updated' : 'Added to My Bets') : 'Saved for this visit only: this browser blocks storage');
  }
  function bsRemove() {
    delete mb.bets[bs.id];
    const ok = mbSave();
    bsClose(); render();
    toast(ok ? 'Bet removed' : 'Removed for this visit only: this browser blocks storage');
  }
  const mbSave = () => MB.save(mb);
  bsheet.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || !bs) return;
    if (b.dataset.bsu) { bs.units = +b.dataset.bsu; const inp = $('bs-odds'), v = inp ? inp.value : null; bsRender(); if (v !== null) $('bs-odds').value = v; $('bs-odds').focus(); }
    else if (b.id === 'bs-go') bsCommit();
    else if (b.id === 'bs-rm') bsRemove();
    else if (b.id === 'bs-x') bsClose();
  });
  bsheet.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id === 'bs-odds') { e.preventDefault(); bsCommit(); } });
  bsheet.addEventListener('input', (e) => { if (e.target.id === 'bs-odds') { $('bs-err').hidden = true; e.target.setAttribute('aria-invalid', 'false'); } });
  bdrop.addEventListener('click', bsClose);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && bs) bsClose(); });

  // ---- grading from the published results files ----
  const resStore = {}; // '<sp>/<YYYY-MM>' -> { st: loading | ok | none | err, at, rows }
  function ensureMyResults(sp, month) {
    const k = sp + '/' + month, old = resStore[k];
    if (old && (old.st === 'loading' || Date.now() - old.at < 300000)) return old;
    const e = resStore[k] = { st: 'loading', at: Date.now(), rows: {} };
    indexP.then(() => {
      const s = store.idx && store.idx.sports && store.idx.sports[sp];
      if (store.idx && !(s && (s.results || []).includes(month))) return { nf: true };
      return getJSON('../results/' + sp + '/' + month + '.json' + ver());
    }).then((r) => {
      if (r.nf || !r.data) e.st = 'none'; else { e.st = 'ok'; e.rows = r.data.rows && !Array.isArray(r.data.rows) ? r.data.rows : {}; }
    }, () => { e.st = 'err'; }).then(() => { gradeMine(); rerender(); });
    return e;
  }
  // settle open bets whose game day has results; returns the number of bets that changed
  function gradeMine() {
    const today = ymd(0);
    Object.values(mb.bets).forEach((b) => { if (b.status === 'open' && b.date <= today) ensureMyResults(b.sport, b.date.slice(0, 7)); });
    const n = MB.applyGrades(mb, (b) => { const e = resStore[b.sport + '/' + b.date.slice(0, 7)]; return e && e.st === 'ok' ? e.rows[b.id] : undefined; });
    if (n) mbSave();
    return n;
  }

  // ---- Bets tab ----
  const gradeChip = (b) => (GRADE_ORDER.includes(b.grade) ? `<span class="grade-badge" data-g="${b.grade}">${b.grade}</span>` : b.uncal ? UNCAL : '');
  const mbDefs = () => (window.GLOSSARY || {}).mybets || {};
  function betsPage() {
    gradeMine();
    return `<div class="bseg">${segmented([['dash', 'Dashboard'], ['mine', 'My Bets']], state.betSeg, 'data-bseg')}</div>${state.betSeg === 'mine' ? myBetsView() : dashView()}`;
  }
  function mbRow(b) {
    const open = b.status === 'open', where = b.away && b.home ? `${b.away} @ ${b.home}` : [b.team, b.opp].filter(Boolean).join(' vs ');
    const when = open ? where : `${mdOf(b.date)} · ${where}`;
    const res = open ? '' : b.status === 'void' ? '<span class="res-pill v">Void</span>' : `<span class="res-pill ${b.status === 'W' ? 'w' : b.status === 'L' ? 'l' : 'p'}">${b.status}</span>`;
    const lead = open ? `<span class="bet-ev mb-u">${uTxt(b.units)}</span>` : b.status === 'void' ? '<span class="bet-ev mb-u u-n">0u</span>' : `<span class="bet-ev mb-u ${plCls(b.pl)}">${uSgn(b.pl)}</span>`;
    return `<div class="bet-wrap"><button class="bet mbr" data-addbet="${esc(b.sport + '|' + b.id)}" aria-label="${open ? 'Edit' : 'View'} ${esc(b.label)}">
      <span class="bet-l"><span class="bet-mkt">${esc(b.label)}</span>
        <span class="bet-sub">${fmtOdds(b.odds)}${b.oddsEdited ? ' edited' : ''} · ${open ? uTxt(b.units) + ' · ' : ''}${esc(when)}${b.note ? `<em class="mb-note">${esc(b.note)}</em>` : ''}</span></span>
      <span class="bet-m">${res}</span><span class="bet-r">${lead}${gradeChip(b)}</span></button></div>`;
  }
  function myBetsView() {
    const all = Object.values(mb.bets), s = MB.summary(mb), D = mbDefs();
    if (!all.length) return empty('Bets', 'No bets yet', 'Tap the + on any bet row to track it here. Pick 0.5 to 2 units, change the odds if yours differ, and results settle on their own.', 0);
    const settledN = s.w + s.l + s.p;
    const tile = (lab, key, num, sub) => `<div class="tile"><div class="lbl">${lab}${key ? infoBtn('mybets', key, D) : ''}</div><div class="num">${num}</div><small class="tsub">${sub}</small></div>`;
    const tiles = `<div class="tiles mb-tiles">
      ${tile('Open', '', s.open, s.open ? `${uTxt(s.atRisk)} at risk` : 'none')}
      ${tile('Record', 'record', `${s.w}-${s.l}-${s.p}`, s.voided ? `${s.voided} void` : 'W-L-P')}
      ${tile('Units', 'units', settledN ? `<span class="${plCls(s.units)}">${uSgn(s.units)}</span>` : '<span class="u-n">—</span>', settledN ? `${uTxt(s.staked)} staked` : 'no settled bets')}
      ${tile('ROI', 'roi', s.roi === null ? '<span class="u-n">—</span>' : `<span class="${plCls(s.roi)}">${sgn(s.roi, 1)}%</span>`, 'on settled stakes')}</div>
      ${['record', 'units', 'roi'].map((k) => infoNote('mybets', k, D)).join('')}`;
    const open = all.filter((b) => b.status === 'open').sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0) || (x.start || '').localeCompare(y.start || '') || (x.gid < y.gid ? -1 : x.gid > y.gid ? 1 : 0) || x.addedAt.localeCompare(y.addedAt));
    let openH = '';
    if (open.length) {
      let lastD = '', lastG = '', inList = false;
      open.forEach((b) => {
        if (b.date !== lastD) { if (inList) openH += '</div>'; inList = false; openH += sec(longOf(b.date) + (b.date === ymd(0) ? ' · Today' : '')); lastD = b.date; lastG = ''; }
        if (b.gid !== lastG) { if (inList) openH += '</div>'; openH += `<div class="mb-g">${esc(b.away && b.home ? `${b.away} @ ${b.home}` : [b.team, b.opp].filter(Boolean).join(' vs '))}${b.start ? ` · ${esc(fmtTime(b.start))}` : ''}</div><div class="betlist">`; inList = true; lastG = b.gid; }
        openH += mbRow(b);
      });
      if (inList) openH += '</div>';
    } else openH = `${sec('Open')}<div class="card empty"><p>No open bets. Tap + on a bet row to add one.</p></div>`;
    const done = all.filter((b) => b.status !== 'open').sort((x, y) => (y.settledAt || '').localeCompare(x.settledAt || '') || (y.date < x.date ? -1 : 1));
    const shown = state.mbMore ? done : done.slice(0, 10);
    const setH = done.length ? `${sec('Settled')}<div class="betlist">${shown.map(mbRow).join('')}</div>${done.length > 10 && !state.mbMore ? `<button class="pillbtn" data-bmore="1">Show all ${done.length}</button>` : ''}` : '';
    return tiles + openH + setH;
  }
  function dashView() {
    const scoring = gate('scoringPanels', `<div class="card mb-scoring"><div class="lbl">Scoring watch</div><p>Anytime TD · Anytime goal · Triple-double panels arrive next</p></div>`);
    return `${scoring}${sec('Top rated today')}${topRated()}${sec('My open bets')}${openSummary()}`;
  }
  function topRated() {
    if (!store.idxDone) return skRows(3);
    const today = ymd(0), cand = [];
    let loading = false, failed = false;
    ['nfl', 'nba', 'nhl'].forEach((sp) => {
      const s = store.idx && store.idx.sports && store.idx.sports[sp];
      if (!s || !(s.slates || []).includes(today)) return;
      const e = ensureSlate(sp, today);
      if (e.st === 'loading') { loading = true; return; }
      if (e.st === 'err') { failed = true; return; }
      if (e.st !== 'ok') return;
      ensureMeta(sp);
      const gids = new Set(Object.values(e.data.bets || {}).map((b) => b && b.gid));
      gids.forEach((gid) => betRows(e.data, gid).forEach((r) => {
        if (r.ph.pick !== false && (r.ph.grade === 'S+' || r.ph.grade === 'A') && isNum(r.ph.odds)) cand.push({ sp, r, sg: (e.data.games || {})[gid] || {} });
      }));
    });
    if (loading && !cand.length) return skRows(3);
    cand.sort((x, y) => gradeIdx(x.r) - gradeIdx(y.r) || y.r.ph.ev - x.r.ph.ev);
    const top = cand.slice(0, 5);
    if (!top.length) return `<div class="card empty"><p>${failed ? 'Couldn’t load today’s slates. Check your connection and try again.' : 'No S+ or A bets on today’s slates yet.'}</p></div>`;
    const rows = top.map(({ sp, r, sg }) => {
      const c = evCls(r.ph.ev), opp = sg.away === r.team ? `vs ${sg.home}` : `@ ${sg.away}`, where = sg.away === r.team ? `@ ${sg.home}` : `vs ${sg.away}`;
      const html = `<div class="bet-wrap has-add"><a class="bet tr" href="#${sp}/player/${encodeURIComponent(r.pid)}">
        <span class="bet-l"><span class="bet-mkt">${esc(r.name)} ${esc(betText(r))}</span><span class="bet-sub">${fmtOdds(r.ph.odds)} · ${sp.toUpperCase()} ${esc(r.team)} ${esc(where)}${sg.kickoff ? ` · ${esc(fmtTime(sg.kickoff))}` : ''}</span></span>
        <span class="bet-r"><span class="ev bet-ev ${c}">${sgn(r.ph.ev, 1)}%</span><span class="grade-badge" data-g="${r.ph.grade}">${r.ph.grade}</span></span></a>${addBtn(sp, r)}</div>`;
      return r.ph.grade === 'S+' ? gate('sPlus', html) : html;
    }).join('');
    return `<div class="betlist">${rows}</div>`;
  }
  function openSummary() {
    const open = Object.values(mb.bets).filter((b) => b.status === 'open');
    if (!open.length) return `<div class="card empty"><p>No open bets. Tap + on a bet row to track one.</p></div>`;
    const risk = open.reduce((a, b) => a + b.units, 0), now = Date.now();
    const next = open.map((b) => b.start).filter((t) => t && new Date(t) > now).sort()[0];
    const nt = next ? (etDay(next) === ymd(0) ? fmtTime(next) : `${dowOf(etDay(next))} ${fmtTime(next)}`) : '';
    return `<button class="card mb-open" data-bgo="mine" aria-label="Open My Bets"><span class="mb-open-n">${open.length}<small>open</small></span>
      <span class="mb-open-r"><b>${uTxt(risk)} at risk</b>${nt ? `<span>Next start ${esc(nt)}</span>` : ''}</span><span class="pcard-chev" aria-hidden="true">›</span></button>`;
  }
  view.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const d = b.dataset;
    if (d.addbet !== undefined) { e.stopPropagation(); const i = d.addbet.indexOf('|'); bsOpen(d.addbet.slice(0, i), d.addbet.slice(i + 1), b); }
    else if (d.bseg) { state.betSeg = d.bseg; render(); }
    else if (d.bgo) { state.betSeg = d.bgo; render(); }
    else if (d.bmore) { state.mbMore = true; render(); }
  });

  // ---- backup (settings sheet) ----
  $('bk-export').addEventListener('click', () => {
    const blob = new Blob([MB.exportText(mb)], { type: 'application/json' }), a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = MB.exportName(ymd(0)); document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    $('bk-msg').textContent = `Exported ${Object.keys(mb.bets).length} bets.`;
  });
  $('bk-file').addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0], msg = $('bk-msg');
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      const r = MB.mergeImport(mb, String(rd.result));
      if (r.error) { msg.textContent = r.error; return; }
      mb = r.store; const ok = mbSave();
      msg.textContent = `Added ${r.added}, skipped ${r.skipped} already here${r.invalid ? `, ${r.invalid} invalid` : ''}.${ok ? '' : ' Storage is blocked: kept for this visit only.'}`;
      gradeMine(); render();
    };
    rd.onerror = () => { msg.textContent = 'Couldn’t read that file.'; };
    rd.readAsText(f);
    e.target.value = '';
  });
  document.querySelector('label[for="bk-file"]').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('bk-file').click(); } });
  gradeMine();
  // ======== end My Bets ========

  // Track in-app history so the back button can use real browser back when possible.
  const stack = [location.hash];
  function parentHash() {
    if (cur.kind === 'player') {
      const se = store.slates[selDate(cur.sport) && cur.sport + '/' + selDate(cur.sport)], p = se && se.st === 'ok' && se.data.players && se.data.players[cur.id];
      if (p && p.gid) return `#${cur.sport}/game/${encodeURIComponent(p.gid)}`;
    }
    return `#${cur.sport || 'nba'}`;
  }
  function goBack() {
    if (stack.length > 1) history.back(); else location.hash = parentHash();
  }

  function route() {
    cur = parse();
    if (cur.kind === 'day') {
      // link to a day: select it, then show the sport page at its plain URL (history entry replaced, not added)
      state.sel[cur.sport] = cur.id;
      const h = '#' + cur.sport;
      history.replaceState(null, '', h);
      stack[stack.length - 1] = h;
      cur = { key: cur.sport, sport: cur.sport, kind: 'root', id: '' };
    }
    render();
  }
  window.addEventListener('hashchange', (e) => {
    const h = location.hash;
    if (stack.length > 1 && stack[stack.length - 2] === h) stack.pop(); else stack.push(h);
    route();
  });

  // Search overlay
  const searchEl = $('search'), searchInput = $('search-input');
  function setSearch(open) {
    searchEl.hidden = !open;
    if (open) { searchInput.value = ''; searchInput.focus(); } else $('search-btn').focus();
  }
  $('search-btn').addEventListener('click', () => setSearch(true));
  $('search-cancel').addEventListener('click', () => setSearch(false));
  $('search-form').addEventListener('submit', (e) => e.preventDefault());

  const sheet = $('sheet'), backdrop = $('backdrop');
  function setSheet(open) {
    sheet.hidden = backdrop.hidden = !open;
    if (open) $('close').focus(); else $('gear').focus();
  }
  $('gear').addEventListener('click', () => setSheet(true));
  $('close').addEventListener('click', () => setSheet(false));
  backdrop.addEventListener('click', () => setSheet(false));
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!searchEl.hidden) setSearch(false);
    else if (!sheet.hidden) setSheet(false);
  });

  route();
})();
