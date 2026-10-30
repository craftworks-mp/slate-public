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
  function placeHl(animate) {
    view.querySelectorAll('.seg').forEach((seg) => {
      const hl = seg.querySelector('.seg-hl');
      const on = seg.querySelector('button.on');
      if (!hl || !on) return;
      const kind = seg.querySelector('button').dataset.sub !== undefined ? 'sub' : 'filter';
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
  const store = { days: {}, meta: {}, sched: {}, idx: null, idxDone: false };
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
    if (tab === 'bets') body = empty('Bets', 'Bets', 'Props and lines open with the slate data.', 0);
    else if (tab === 'game') {
      const row = (l, r) => `<div><div class="cmp-top"><span class="v">—</span><span class="lab"><span class="bar"></span></span><span class="v">—</span></div>
        <div class="split"><i style="flex:${l}"></i><i style="flex:${r}"></i></div></div>`;
      body = `<div class="card cmp" aria-hidden="true">${row(55, 45)}${row(40, 60)}${row(50, 50)}</div>`;
    } else {
      const code = tab === 'away' ? aw : hm;
      body = `<div class="plist">${[0, 1, 2, 3].map((n) => `<div class="prow" aria-hidden="true">
        <span class="ini">—</span><span class="bars">${bar(n % 2 ? 'w55' : 'w70')}${bar(n % 2 ? 'w40' : 'w55')}</span><span class="bar st"></span></div>`).join('')}</div>`;
    }
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
  const gameView = liveGameView;

  function playerView(sport) {
    const labs = STAT_LABELS[sport];
    const cells = labs.map((l) => `<div><div class="lbl">${esc(l)}</div><div class="num">\u2014</div></div>`).join('');
    const hs = [40, 72, 55, 90, 62, 80, 48];
    return `<div class="pagehead">${backBtn}</div>
      <div class="phero"><span class="ini xl" aria-hidden="true">\u2014</span><span class="bars">${bar('w70')}${bar('w55')}${bar('w40')}</span></div>
      <div class="statgrid" aria-hidden="true">${cells}</div>
      <button class="pillbtn" disabled>Splits</button>
      ${sec('Recent performances')}
      <div class="bars7" aria-hidden="true">${hs.map((h) => `<i style="height:${h}%"></i>`).join('')}</div>
      ${sec('Game log')}${rowsGeneric(3)}`;
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
    let id = kind === 'game' ? (/^[A-Za-z0-9_-]{1,40}$/.test(p[2] || '') ? p[2] : '') : kind === 'player' ? 'sample' : '';
    if (kind === 'team') id = /^[A-Za-z0-9]{1,4}$/.test(p[2] || '') ? p[2].toUpperCase() : '\u2014';
    if (kind === 'game' && !id) return { key: sport, sport, kind: 'root', id: '' };
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
    else if (c.kind === 'player') view.innerHTML = playerView(c.sport);
    else if (c.kind === 'team') view.innerHTML = teamView(c.sport, c.id);
    else view.innerHTML = sportRoot(c.sport);

    const pl = view.querySelector('.pills'), po = pl && pl.querySelector('.on');
    if (po) pl.scrollLeft = Math.max(0, po.offsetLeft - (pl.clientWidth - po.offsetWidth) / 2);
    const sch = view.querySelector('.sched'), nx = sch && sch.querySelector('[data-next]');
    if (nx) sch.scrollTop = Math.max(0, nx.offsetTop - 56);
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
    if (d.back !== undefined) return goBack();
    if (d.retry) { delete store.days[d.retry]; const m = store.meta[sportOf()]; if (m && m.st === 'err') delete store.meta[sportOf()]; render(); return; }
    if (d.sub) state.gameTab = d.sub;
    else if (d.day) state.sel[sportOf()] = d.day;
    else if (d.filter) state.filter = d.filter;
    else return;
    render();
  });

  // Track in-app history so the back button can use real browser back when possible.
  const stack = [location.hash];
  function parentHash() {
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
