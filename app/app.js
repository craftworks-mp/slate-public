(() => {
  const SPORTS = { nfl: 'NFL', nba: 'NBA', nhl: 'NHL' };
  const PAGES = { bets: 'BETS', results: 'RESULTS' };
  const SUBTITLES = { game: 'GAME', player: 'PLAYER', team: 'TEAM', standings: 'STANDINGS' };
  const FILTERS = ['All', 'NFL', 'NBA', 'NHL'];
  const WEEK = 9; // placeholder until real schedule data lands
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
    dayOffset: { nfl: 0, nba: 0, nhl: 0 },
    gameTab: 'bets',
    filter: 'All',
  };
  let cur = { key: '', sport: null, kind: 'root', id: '' };

  const $ = (id) => document.getElementById(id);
  const view = $('view');

  const dateFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric',
  });

  // Noon UTC of today's New York calendar date, shifted by n days (DST-safe).
  function baseDate(n) {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' })
        .formatToParts(new Date()).map((x) => [x.type, x.value]));
    return new Date(Date.UTC(+p.year, +p.month - 1, +p.day + n, 12));
  }
  const shortFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' });
  const shortDate = (n) => shortFmt.format(baseDate(n));
  function dateLabel(n) {
    if (n === -1) return 'Yesterday';
    if (n === 0) return 'Today';
    if (n === 1) return 'Tomorrow';
    return dateFmt.format(baseDate(n)).replace(',', '');
  }

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

  // ---- views ----
  function sportRoot(sport) {
    const o = state.dayOffset[sport];
    const pill = (n, label) => {
      const sub = sport === 'nfl' ? `W${WEEK} \u00b7 ${shortDate(n)}` : shortDate(n);
      return `<button data-off="${n}" class="${o === n ? 'on' : ''}" aria-pressed="${o === n}"><span class="d">${n === 0 ? 'Today' : label}</span><span class="s">${esc(sub)}</span></button>`;
    };
    const cards = PAIRS[sport].map(([aw, hm], i) => `<a class="grow" href="#${sport}/game/${gid(i)}" aria-label="Sample game ${esc(aw)} at ${esc(hm)}">
      <span class="teams">
        <span class="tline">${badge(aw)}${bar('w55')}<span class="rec">\u2014</span></span>
        <span class="tline">${badge(hm)}${bar('w70')}<span class="rec">\u2014</span></span>
      </span>
      <span class="tcol" aria-hidden="true">${bar('w85')}${bar('w55')}</span></a>`).join('');
    return `<div class="dates">
        <button class="arrow" data-shift="-1" aria-label="Previous day">&#8249;</button>
        <div class="pills ${sport}">${pill(-1, 'Yesterday')}${pill(0, 'Today')}${pill(1, 'Tomorrow')}</div>
        <button class="arrow" data-shift="1" aria-label="Next day">&#8250;</button>
      </div>
      <div class="sechead"><h2>Games</h2><a class="textlink" href="#${sport}/standings">Standings &#8250;</a></div>
      <span class="lbl preview-lbl">Preview</span>
      <div class="glist">${cards}</div>`;
  }
  const gid = (i) => (i === 0 ? 'sample' : 'sample' + (i + 1));
  const gidx = (id) => { const m = /^sample(\d)$/.exec(id); return m ? Math.min(3, Math.max(0, +m[1] - 1)) : 0; };

  function standings(sport) {
    return `<div class="pagehead">${backBtn}<h2>${SPORTS[sport]} Standings</h2></div>
      ${empty('Standings', 'Standings', 'Standings land with the data step.', 0)}`;
  }

  function gameView(sport, id) {
    const i = gidx(id), [aw, hm] = PAIRS[sport][i];
    const chips = PAIRS[sport].map(([a, h], j) => `<a class="chip ${j === i ? 'on' : ''}" href="#${sport}/game/${gid(j)}" ${j === i ? 'aria-current="true"' : ''}>${a} @ ${h}<small>\u2014:\u2014</small></a>`).join('');
    const tab = state.gameTab;
    let body;
    if (tab === 'bets') body = empty('Bets', 'Bets', 'Props and lines open with the slate data.', 0);
    else if (tab === 'game') {
      const row = (l, r) => `<div><div class="cmp-top"><span class="v">\u2014</span><span class="lab"><span class="bar"></span></span><span class="v">\u2014</span></div>
        <div class="split"><i style="flex:${l}"></i><i style="flex:${r}"></i></div></div>`;
      body = `<div class="card cmp" aria-hidden="true">${row(55, 45)}${row(40, 60)}${row(50, 50)}</div>`;
    } else {
      const code = tab === 'away' ? aw : hm;
      body = `<div class="plist">${[0, 1, 2, 3].map((n) => `<a class="prow" href="#${sport}/player/sample" aria-label="Sample player ${n + 1}, ${esc(code)}">
        <span class="ini" aria-hidden="true">\u2014</span><span class="bars">${bar(n % 2 ? 'w55' : 'w70')}${bar(n % 2 ? 'w40' : 'w55')}</span><span class="bar st"></span></a>`).join('')}</div>`;
    }
    return `<div class="pagehead">${backBtn}<div class="chips" aria-label="Other sample games">${chips}</div></div>
      <div class="ghead">
        <div class="gteam">${badge(aw, 'l', `#${sport}/team/${aw}`)}<span class="rec">\u2014</span></div>
        <div class="gcenter"><span class="big">\u2014:\u2014</span>${bar('w70')}</div>
        <div class="gteam">${badge(hm, 'l', `#${sport}/team/${hm}`)}<span class="rec">\u2014</span></div>
      </div>
      <div class="subtabs">${segmented(TABS.map(([k, l]) => [k, k === 'away' ? aw : k === 'home' ? hm : l]), tab, 'data-sub')}</div>
      ${body}`;
  }

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

  function teamView(code) {
    return `<div class="pagehead">${backBtn}</div>
      <div class="phero">${badge(code, 'xl')}<span class="bars">${bar('w70')}${bar('w40')}</span></div>
      ${sec('Splits')}${rowsGeneric(2)}${sec('Roster')}${rowsGeneric(2)}${sec('Schedule')}${rowsGeneric(2)}`;
  }

  function parse() {
    const p = location.hash.slice(1).split('/').map((x) => decodeURIComponent(x));
    const r = p[0];
    if (PAGES[r]) return { key: r, page: r };
    const sport = SPORTS[r] ? r : 'nba';
    const kind = SUBTITLES[p[1]] ? p[1] : 'root';
    let id = kind === 'game' ? (/^sample\d?$/.test(p[2]) ? p[2] : 'sample') : kind === 'player' ? 'sample' : '';
    if (kind === 'team') id = /^[A-Za-z0-9]{1,4}$/.test(p[2] || '') ? p[2].toUpperCase() : '\u2014';
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
    else if (c.kind === 'team') view.innerHTML = teamView(c.id);
    else view.innerHTML = sportRoot(c.sport);

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
    if (d.sub) state.gameTab = d.sub;
    else if (d.off !== undefined) state.dayOffset[sportOf()] = +d.off;
    else if (d.shift) state.dayOffset[sportOf()] += +d.shift;
    else if (d.filter) state.filter = d.filter;
    else return;
    render();
  });

  // Track in-app history so the back button can use real browser back when possible.
  const stack = [location.hash];
  function parentHash() {
    if (cur.kind === 'player' || cur.kind === 'team') return `#${cur.sport}/game/sample`;
    return `#${cur.sport || 'nba'}`;
  }
  function goBack() {
    if (stack.length > 1) history.back(); else location.hash = parentHash();
  }

  function route() {
    cur = parse();
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
