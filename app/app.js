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

  const state = {
    sel: { nfl: null, nba: null, nhl: null }, // selected date per sport (null = default), kept in memory
    gameTab: 'bets',
    filter: 'All',
    betSort: 'ev', // game Bets tab sort: ev | grade | player
    betF: { ga: false, side: '', mkt: '', both: false }, // game Bets tab filters, kept across games
    betOpen: {}, // expanded bet rows (bet id -> true), kept in memory
    cmpSplit: 'season', // game Game tab comparison: season | l5 | ha
    infoOpen: {}, // open definition notes ('<sport>/<key>' -> true)
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
      const kind = b0.sub !== undefined ? 'sub' : b0.sort !== undefined ? 'sort' : b0.cmp !== undefined ? 'cmp' : 'filter';
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
  const store = { days: {}, meta: {}, sched: {}, slates: {}, players: {}, teams: {}, idx: null, idxDone: false };
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
  function teamRow(sport, g, side) {
    const code = g[side] || '—', t = tinfo(sport, code);
    const rec = recFor(sport, g, side);
    let score = '';
    if (g.status === 'final' && g.final) {
      const mine = g.final[side], other = g.final[side === 'away' ? 'home' : 'away'];
      score = `<span class="score ${mine > other ? 'w' : 'l'}">${esc(mine)}</span>`;
    }
    return `<span class="tline">${tbadge(sport, code, '', '', true)}<span class="rec">${esc(rec || '—')}</span><span class="tn">${esc(t.short || '')}</span>${score}</span>`;
  }
  function gameCard(sport, g) {
    const b = g.bets || {}, n = b.n || 0, sp = b['S+'] || 0;
    const rated = sp + (b.A || 0) + (b.B || 0);
    const bline = n ? `<span class="bline">${esc(n)} bets${rated ? ` · ${esc(rated)} rated` : ''}</span>` : '';
    const acc = sp > 0 ? `<span class="acc-badge" role="img" aria-label="S+ value in this game">★ S+</span>` : '';
    return `<a class="gcard${acc ? ' has-acc' : ''}" href="#${sport}/game/${encodeURIComponent(g.gid)}" aria-label="${esc(g.away)} at ${esc(g.home)}">${acc}
      <span class="gc-main"><span class="teams">${teamRow(sport, g, 'away')}${teamRow(sport, g, 'home')}</span>
      <span class="gc-side">${sideCol(g)}</span></span>${bline}</a>`;
  }

  function standings(sport) {
    return `<div class="pagehead">${backBtn}<h2>${SPORTS[sport]} Standings</h2></div>
      ${empty('Standings', 'Standings', 'Standings land with the data step.', 0)}`;
  }

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
    const lp = lineParts(g).map((p) => `<span class="kline">${p}</span>`).join('');
    const team = (code, side) => `<div class="gteam">${tbadge(sport, code, 'l', `#${sport}/team/${encodeURIComponent(code)}`, false)}
      <span class="rec">${esc(recFor(sport, g, side) || '—')}</span><span class="tn">${esc(tinfo(sport, code).short || '')}</span></div>`;
    return `<div class="pagehead">${backBtn}<div class="chips" aria-label="Games this day">${chips}</div></div>
      <div class="ghead">${team(aw, 'away')}<div class="gcenter">${center}${lp}</div>${team(hm, 'home')}</div>
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
  const toNum = (v) => { const n = typeof v === 'string' && v.trim() === '' ? NaN : parseFloat(v); return isFinite(n) ? n : null; };
  const projOf = (sg) => {
    for (const k of ['close', 'open']) {
      const p = sg && sg['proj_' + k];
      if (p && !p.err && isNum(p.away) && isNum(p.home) && isNum(p.total)) return { p, tag: k };
    }
    return null;
  };
  function projCard(sport, g, sg) {
    const pr = projOf(sg);
    if (!pr) return '';
    const { p, tag } = pr, dp = sport === 'nhl' ? 2 : 1;
    const ln = (sg['lines_' + tag] && toNum(sg['lines_' + tag].total) !== null) ? [sg['lines_' + tag], tag] : [sg.lines_open, 'open'];
    const lines = (ln[0]) || {}, lineTag = ln[1];
    const bookTot = toNum(lines.total);
    const bookTag = bookTot !== null && lineTag !== tag ? ` <small>${lineTag}</small>` : '';
    const cmpLine = (label, model, book, mTxt, bTxt, diffDp) => `<div class="proj-row"><span class="lbl">${label}</span>
      <span class="proj-v"><b>Model ${mTxt}</b><span class="sep">·</span><span class="book">Book ${book === null ? '—' : bTxt}${bookTag}</span>${book === null ? '' : ` <span class="diff">(${sgn(model - book, diffDp)})</span>`}</span></div>`;
    let rows = cmpLine('Total', p.total, bookTot, p.total.toFixed(dp), String(bookTot), dp);
    if (sport === 'nba' && isNum(p.margin)) {
      const sp = toNum(lines.spread);
      const bm = sp === null ? null : sp === 0 ? 0 : lines.fav === 'A' ? sp : lines.fav === 'B' ? -sp : null;
      const mt = (v) => esc(g.away) + ' ' + sgn(v, 1);
      rows += cmpLine('Margin', p.margin, bm, mt(p.margin), mt(bm === null ? 0 : bm), 1);
    }
    if (sport === 'nhl' && isNum(p.winAway) && isNum(p.winHome)) {
      rows += `<div class="proj-row"><span class="lbl">Win prob</span><span class="proj-v"><b>${esc(g.away)} ${p.winAway.toFixed(1)}%</b><span class="sep">·</span><b>${esc(g.home)} ${p.winHome.toFixed(1)}%</b></span></div>`;
    }
    return `${sec('Model projection')}<div class="card proj"><div class="proj-head"><span class="lbl">${sport === 'nhl' ? 'Expected goals' : 'Projected score'}</span><small class="ptag">${tag}</small></div>
      <div class="proj-score"><span class="pc">${esc(g.away)}</span><b>${p.away.toFixed(dp)}</b><i>–</i><b>${p.home.toFixed(dp)}</b><span class="pc">${esc(g.home)}</span></div>${rows}</div>`;
  }
  const fmtStat = (v, kind) => (isNum(v) ? (kind === 'pct' ? (v * 100).toFixed(1) + '%' : v.toFixed(1)) : '—');
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
      let share = 0.5, ba = false, bh = false;
      if (isNum(a) && isNum(h)) {
        const den = Math.abs(a) + Math.abs(h);
        if (den > 0) share = Math.min(0.9, Math.max(0.1, 0.5 + (low ? -1 : 1) * (a - h) / (2 * den)));
        const ta = fmtStat(a, kind), th = fmtStat(h, kind);
        if (a !== h) { ba = low ? a < h : a > h; bh = !ba; }
        if (ta === th) { ba = bh = false; }
      }
      return `<div><div class="cmp-top"><span class="v${ba ? ' best' : ''}">${fmtStat(a, kind)}</span><span class="lab">${esc(label)}${infoBtn(sport, k, defs)}</span><span class="v${bh ? ' best' : ''}">${fmtStat(h, kind)}</span></div>
        ${infoNote(sport, k, defs)}<div class="split"><i style="flex:${share}"></i><i style="flex:${1 - share}"></i></div></div>`;
    });
    if (!rows.length) return sec('Team comparison') + '<div class="card empty"><h2>No team stats yet</h2><p>This split has no games played.</p></div>';
    const gp = (o) => (isNum(o.gp) ? o.gp : '—');
    return `${sec('Team comparison')}<div class="cmp-head">${segmented(CMP_SPLITS, state.cmpSplit, 'data-cmp', 'cmpseg')}</div>
      <div class="card cmp"><div class="cmp-teams"><span>${esc(g.away)}<small>${gp(A)} GP</small></span><span>${esc(g.home)}<small>${gp(H)} GP</small></span></div>${rows.join('')}</div>`;
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
    let out = sg ? projCard(sport, g, sg) : '';
    out += cmpCard(sport, g);
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
    return `<div class="bet-wrap${open ? ' open' : ''}${showPick && !r.pick ? ' alt' : ''}"><button class="bet" data-bet="${esc(r.id)}" aria-expanded="${open}">
      <span class="bet-l"><span class="bet-mkt">${esc(BET_STAT[b.stat] || String(b.stat).toUpperCase())} ${b.side === 'u' ? 'U' : 'O'} ${esc(ph.line)}</span>
        <span class="bet-sub">${fmtOdds(ph.odds)} · ${r.tag.toUpperCase()}${showPick && !r.pick ? '<em class="side-tag">Other side</em>' : ''}</span></span>
      <span class="bet-m"><span class="bet-proj">Proj ${ph.proj.toFixed(1)}</span>
        <span class="ev gap ${c}">${sgn(gap, 1)}${pct === null ? '' : ` (${sgn(pct, 0)}%)`}</span></span>
      <span class="bet-r"><span class="ev bet-ev ${c}">${sgn(ph.ev, 1)}%</span>
        ${g ? `<span class="grade-badge" data-g="${g}">${g}</span>` : ''}</span>
    </button>${open ? ctx : ''}</div>`;
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
  function betChips(rows) {
    const f = state.betF;
    const chip = (k, label, on) => `<button class="bchip${on ? ' on' : ''}" data-bf="${k}" aria-pressed="${on}">${label}</button>`;
    const present = new Set(rows.map((r) => r.b.stat));
    const mk = Object.keys(BET_STAT).filter((k) => present.has(k));
    const div = '<span class="bchip-div" aria-hidden="true"></span>';
    return `<div class="bchips" role="group" aria-label="Filter props">${chip('all', 'All', !f.ga && !f.side && !f.mkt)}${chip('ga', 'S+/A', f.ga)}${chip('o', 'Over', f.side === 'o')}${chip('u', 'Under', f.side === 'u')}${mk.length ? div + mk.map((k) => chip('mkt:' + k, esc(BET_STAT[k]), f.mkt === k)).join('') : ''}${div}${chip('both', 'Both sides', f.both)}</div>`;
  }
  function betsTab(sport, date) {
    const e = ensureSlate(sport, date);
    if (e.st === 'loading') return skRows(4);
    if (e.st === 'err') return `<div class="card empty"><h2>Couldn’t load props</h2><p>Check your connection and try again.</p><button class="pillbtn retry" data-retry-slate="${esc(sport + '/' + date)}">Retry</button></div>`;
    const rows = e.st === 'ok' ? betRows(e.data || {}, state.betGid) : [];
    if (!rows.length) return empty('Bets', 'No props for this game yet', 'Props show up here once the slate is published.', 0);
    const f = state.betF;
    const shown = rows.filter((r) => (f.both || r.pick) && (!f.ga || r.ph.grade === 'S+' || r.ph.grade === 'A')
      && (!f.side || r.b.side === f.side) && (!f.mkt || r.b.stat === f.mkt));
    const groups = betGroups(shown, state.betSort);
    const body = groups.length
      ? `<div class="pcards">${groups.map((gp) => playerCard(sport, gp, f.both)).join('')}</div>`
      : '<div class="card empty"><h2>No props match these filters</h2><button class="pillbtn" data-bf="all">Clear filters</button></div>';
    return `<div class="bets-head"><span class="bets-n">${groups.length} ${groups.length === 1 ? 'player' : 'players'} · ${shown.length} ${shown.length === 1 ? 'prop' : 'props'}</span>${segmented(SORTS, state.betSort, 'data-sort', 'sortseg')}</div>
      ${betChips(rows)}${body}`;
  }
  const gameView = liveGameView;

  // ---- game AWAY / HOME roster tabs ----
  // log columns (after date, opp, home) are in this order in both packs; keys match the world st/l5 objects
  const COLS = {
    nba: [['min', 'MIN', 1], ['pts', 'PTS', 1], ['reb', 'REB', 1], ['ast', 'AST', 1], ['tpm', '3PM', 1], ['tpa', '3PA', 1]],
    nhl: [['min', 'TOI', 1], ['g', 'G', 2], ['a', 'A', 2], ['sog', 'SOG', 1], ['blk', 'BLK', 2]],
  };
  const ROSTER_LINE = { nba: ['min', 'pts', 'reb', 'ast', 'tpm'], nhl: ['min', 'g', 'a', 'sog'] };
  const TONIGHT = { nba: ['pts', 'reb', 'ast', 'tpm'], nhl: ['sog', 'g', 'a', 'pts'] };
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
  function rosterRow(sport, id, p, w, best) {
    const d = w.st === 'ok' ? (w.data || {}) : null;
    const st = (d && d.st) || {};
    const sub = d ? roleTxt(sport, d) : '';
    const cols = COLS[sport];
    const line = ROSTER_LINE[sport].map((k) => {
      const c = cols.find((x) => x[0] === k);
      return `<span><em>${c[1]}</em>${fx(st[k], c[2])}</span>`;
    }).join('');
    const pr = p.proj || {};
    const chips = TONIGHT[sport].map((k) => {
      const ph = pr.close && pr.close[k] ? pr.close : pr.open;
      const v = ph && ph[k] && ph[k].v;
      if (!isNum(v)) return '';
      const b = best[id + '|' + k], ln = b ? b.ph.line : null;
      const cls = isNum(ln) ? (v > ln ? ' up' : v < ln ? ' dn' : '') : '';
      return `<span class="pj${cls}">${esc(BET_STAT[k] || k.toUpperCase())} ${v.toFixed(projDp(sport, k))}</span>`;
    }).filter(Boolean).join('');
    return `<button class="prow" data-player="${esc(id)}" aria-label="${esc(p.name || id)} player page">
      <span class="ini" aria-hidden="true">${esc(initials(p.name))}</span>
      <span class="pr-main"><span class="pr-name"><b>${esc(p.name || id)}</b>${p.inj ? `<i class="inj">${esc(p.inj)}</i>` : ''}${sub ? `<small>${esc(sub)}</small>` : ''}</span>
        <span class="pr-line" style="--n:${ROSTER_LINE[sport].length}">${line}</span>
        ${chips ? `<span class="pr-tn"><span class="pr-tl">Tonight:</span>${chips}</span>` : ''}</span></button>`;
  }
  function rosterTab(sport, date, g, code) {
    const e = ensureSlate(sport, date);
    if (e.st === 'loading') return skRows(4);
    if (e.st === 'err') return `<div class="card empty"><h2>Couldn’t load players</h2><p>Check your connection and try again.</p><button class="pillbtn retry" data-retry-slate="${esc(sport + '/' + date)}">Retry</button></div>`;
    const sl = e.st === 'ok' ? (e.data || {}) : {};
    const list = Object.entries(sl.players || {}).filter(([, p]) => p && p.team === code && String(p.gid) === String(g.gid))
      .map(([id, p]) => ({ id, p, w: ensurePlayer(sport, id) }));
    if (!list.length) return empty('Bets', 'No players for ' + code + ' yet', 'Players show up here once the slate is published.', 0);
    const dd = (r) => (r.w.st === 'ok' ? r.w.data || {} : {});
    const mins = (r) => ((dd(r).st || {}).min);
    list.sort((x, y) => {
      let c = 0;
      if (sport === 'nba') c = (dd(x).role === 'S' ? 0 : 1) - (dd(y).role === 'S' ? 0 : 1) || (isNum(mins(y)) ? mins(y) : -1) - (isNum(mins(x)) ? mins(x) : -1);
      else c = roleRank(dd(x).role) - roleRank(dd(y).role);
      return c || (x.p.name < y.p.name ? -1 : x.p.name > y.p.name ? 1 : 0);
    });
    const best = bestSides(betRows(sl, g.gid));
    return `<div class="plist">${list.map((r) => rosterRow(sport, r.id, r.p, r.w, best)).join('')}</div>`;
  }

  const pHead = (extra) => `<div class="pagehead">${backBtn}</div>${extra || ''}`;
  function playerView(sport, pid) {
    ensureMeta(sport);
    const pe = ensurePlayer(sport, pid), sc = ensureSched(sport);
    if (!store.idxDone || sc.st === 'loading' || store.meta[sport].st === 'loading' || pe.st === 'loading') {
      return pHead(`<div class="phero"><span class="dot"></span><span class="bars">${bar('w70')}${bar('w55')}</span></div>${rowsGeneric(3)}`);
    }
    if (pe.st === 'err') return pHead(`<div class="card empty"><h2>Couldn’t load player</h2><p>Check your connection and try again.</p><button class="pillbtn retry" data-retry-player="${esc(sport + '/' + pid)}">Retry</button></div>`);
    if (pe.st !== 'ok') return pHead(`<div class="card empty"><h2>No data for this player</h2><p>This player has no published stats yet.</p></div>`);
    const d = pe.data || {}, cols = COLS[sport];
    const date = selDate(sport), se = ensureSlate(sport, date);
    const sl = se.st === 'ok' ? (se.data || {}) : null;
    const sp = sl && sl.players && sl.players[pid];
    const name = d.name || (sp && sp.name) || pid;
    const team = d.team || (sp && sp.team) || '';
    const inj = (sp && sp.inj) || d.inj || '', note = (sp && sp.injNote) || d.injNote || '', src = (sp && sp.injSrc) || d.src || '';
    const injHtml = inj ? `<div class="pinj"><i class="inj">${esc(inj)}</i>${note ? `<span>${esc(note)}</span>` : ''}${src ? `<small>${esc(src)}</small>` : ''}</div>` : '';
    const meta = [roleTxt(sport, d), isNum(d.gp) ? 'GP ' + d.gp : ''].filter(Boolean).join(' · ');
    const hero = `<div class="phero"><span class="ini xl" aria-hidden="true">${esc(initials(name))}</span>
      <span class="pinfo"><h2 class="tname-xl">${esc(name)}</h2>
        <span class="pteam">${team ? tbadge(sport, team, '', `#${sport}/team/${encodeURIComponent(team)}`, true) : ''}<span class="pmeta">${esc(meta)}</span></span>${injHtml}</span></div>`;
    // Tonight: his props, best EV side per stat, sorted by EV
    let tonight = '';
    if (se.st === 'loading') tonight = sec('Tonight') + skRows(2);
    else if (sp) {
      const mine = Object.values(bestSides(betRows(sl, sp.gid).filter((r) => String(r.b.pid) === String(pid)))).sort((x, y) => y.ph.ev - x.ph.ev);
      tonight = sec('Tonight') + (mine.length ? `<div class="betlist">${mine.map(betRow).join('')}</div>` : '<div class="card empty"><p>No props for this player yet.</p></div>');
    }
    const st = d.st || {}, l5 = d.l5 || {};
    const grid = `<div class="svl" style="--n:${cols.length}"><span class="svl-h"></span>${cols.map((c) => `<span class="svl-h">${c[1]}</span>`).join('')}
      <span class="svl-l">Season</span>${cols.map((c) => `<span class="svl-v">${fx(st[c[0]], c[2])}</span>`).join('')}
      <span class="svl-l">Last 5</span>${cols.map((c) => `<span class="svl-v">${fx(l5[c[0]], c[2])}</span>`).join('')}</div>`;
    const logs = Array.isArray(d.logs) ? d.logs.slice().reverse() : [];
    const opt = sport === 'nba' ? 'tpa' : 'blk';
    const cl = (c) => (c[0] === opt ? ' c-opt' : '');
    const lv = (c, v, i) => (isNum(v) ? (sport === 'nhl' && i === 0 ? v.toFixed(1) : String(v)) : '—');
    const glog = logs.length
      ? `<div class="glog" style="--n:${cols.length};--n2:${cols.length - 1}"><div class="gl-row gl-h"><span>Date</span><span>Opp</span>${cols.map((c) => `<span class="${cl(c).trim()}">${c[1]}</span>`).join('')}</div>
        ${logs.map((r) => `<div class="gl-row"><span>${esc(String(r[0] || '—').replace('-', '/'))}</span><span>${r[2] === 1 ? 'vs' : r[2] === 0 ? '@' : ''} ${esc(r[1] || '—')}</span>${cols.map((c, i) => `<span class="${cl(c).trim()}">${lv(c, r[3 + i], i)}</span>`).join('')}</div>`).join('')}</div>`
      : '<div class="card empty"><p>No game log yet.</p></div>';
    return pHead(hero + tonight + sec('Season vs Last 5') + grid + sec('Game log') + glog);
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
    return `<div class="pagehead">${backBtn}</div>
      <div class="phero">${hero}</div>
      ${sec('Splits')}${rowsGeneric(2)}${sec('Roster')}${rowsGeneric(2)}${sec('Schedule')}${teamSchedule(sport, code, sc)}`;
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
      out += `<a class="srow${g === next ? ' next' : ''}" ${g === next ? 'data-next ' : ''}href="#${sport}/day/${g.d}"><span class="sd">${dowOf(g.d)} ${mdOf(g.d)}</span>
        <span class="sv"><span class="vs">${home ? 'vs' : '@'}</span>${tbadge(sport, opp, 's', '', true)}<span class="oc">${esc(opp)}</span></span><span class="sr">${r}</span></a>`;
    });
    return `<div class="sched" aria-label="${esc(code)} schedule">${out}</div>`;
  }

  function parse() {
    const p = location.hash.slice(1).split('/').map((x) => decodeURIComponent(x));
    const r = p[0];
    if (PAGES[r]) return { key: r, page: r };
    const sport = SPORTS[r] ? r : 'nba';
    const kind = SUBTITLES[p[1]] ? p[1] : 'root';
    if (p[1] === 'day' && /^\d{4}-\d{2}-\d{2}$/.test(p[2] || '')) return { key: sport + '/day', sport, kind: 'day', id: p[2] };
    let id = kind === 'game' ? (/^[A-Za-z0-9_-]{1,40}$/.test(p[2] || '') ? p[2] : '') : kind === 'player' ? (/^[A-Za-z0-9_-]{1,40}$/.test(p[2] || '') ? p[2] : '') : '';
    if (kind === 'team') id = /^[A-Za-z0-9]{1,4}$/.test(p[2] || '') ? p[2].toUpperCase() : '\u2014';
    if ((kind === 'game' || kind === 'player') && !id) return { key: sport, sport, kind: 'root', id: '' };
    return { key: [sport, kind, id].filter(Boolean).join('/'), sport, kind, id };
  }

  function render() {
    const c = cur;
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
      view.innerHTML = empty('Bets', 'Swipe decks', 'Decks open at the close pull.', 2);
    } else if (c.page === 'results') {
      const tile = (l) => `<div class="tile"><div class="lbl">${l}</div><div class="num">\u2014</div><span class="bar w55"></span></div>`;
      view.innerHTML = segmented(FILTERS, state.filter, 'data-filter') +
        `<div class="tiles" aria-label="${esc(state.filter)} results, data coming next">${['W-L', 'Win %', 'Units', 'ROI'].map(tile).join('')}</div>`;
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
    placeHl(!changed);
  }

  const sportOf = () => cur.sport || 'nba';
  view.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const d = b.dataset;
    const bcEl = view.querySelector('.bchips'); bcScroll = bcEl ? bcEl.scrollLeft : 0;
    if (d.back !== undefined) return goBack();
    if (d.retry) { delete store.days[d.retry]; const m = store.meta[sportOf()]; if (m && m.st === 'err') delete store.meta[sportOf()]; render(); return; }
    if (d.retrySlate) { delete store.slates[d.retrySlate]; render(); return; }
    if (d.player) { location.hash = '#' + sportOf() + '/player/' + encodeURIComponent(d.player); return; }
    if (d.retryPlayer) { delete store.players[d.retryPlayer]; render(); return; }
    if (d.bet) { if (state.betOpen[d.bet]) delete state.betOpen[d.bet]; else state.betOpen[d.bet] = true; }
    else if (d.sort) state.betSort = d.sort;
    else if (d.bf) {
      const f = state.betF, k = d.bf;
      if (k === 'all') { f.ga = false; f.side = ''; f.mkt = ''; }
      else if (k === 'ga') f.ga = !f.ga;
      else if (k === 'o' || k === 'u') f.side = f.side === k ? '' : k;
      else if (k === 'both') f.both = !f.both;
      else if (k.startsWith('mkt:')) f.mkt = f.mkt === k.slice(4) ? '' : k.slice(4);
    }
    else if (d.sub) state.gameTab = d.sub;
    else if (d.cmp) state.cmpSplit = d.cmp;
    else if (d.info) { if (state.infoOpen[d.info]) delete state.infoOpen[d.info]; else state.infoOpen[d.info] = true; }
    else if (d.day) state.sel[sportOf()] = d.day;
    else if (d.filter) state.filter = d.filter;
    else return;
    render();
  });

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
