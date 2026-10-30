(() => {
  const SPORTS = { nfl: 'NFL', nba: 'NBA', nhl: 'NHL' };
  const TITLES = { ...SPORTS, bets: 'Bets', results: 'Results' };
  const SEGMENTS = ['Games', 'Teams', 'Players', 'Standings'];
  const FILTERS = ['All', 'NFL', 'NBA', 'NHL'];

  const state = {
    route: 'nba',
    segment: { nfl: 'Games', nba: 'Games', nhl: 'Games' },
    dayOffset: 0,
    filter: 'All',
  };

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

  function segmented(items, active, attr) {
    return `<div class="seg" role="group"><span class="seg-hl" aria-hidden="true"></span>${items.map((i) =>
      `<button ${attr}="${i}" class="${i === active ? 'on' : ''}" aria-pressed="${i === active}">${i}</button>`).join('')}</div>`;
  }

  const ICONS = {
    Games: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    Teams: '<path d="M12 3l8 3v6c0 4.5-3.2 8-8 9-4.8-1-8-4.5-8-9V6z"/>',
    Players: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>',
    Standings: '<path d="M4 20V4M4 20h16M8 16v-4M12 16V8M16 16v-6"/>',
    Bets: '<rect x="7" y="3" width="13" height="16" rx="2"/><path d="M4 7v12a2 2 0 0 0 2 2h10"/>',
  };
  const skRows = (n) => `<div class="sk" aria-hidden="true">${Array.from({ length: n }, (_, i) =>
    `<div class="sk-row"><span class="dot"></span><span class="bars"><span class="bar ${i % 2 ? 'w55' : 'w85'}"></span><span class="bar ${i % 2 ? 'w40' : 'w70'}"></span></span></div>`).join('')}</div>`;
  function empty(icon, title, desc, rows) {
    return `<div class="card empty"><div class="ico"><svg viewBox="0 0 24 24">${ICONS[icon]}</svg></div>
      <h2>${esc(title)}</h2><p>${esc(desc)}</p>
      <div class="sec">Preview</div>${skRows(rows)}</div>`;
  }

  // Sliding highlight for segmented controls. prev = {x,w} from last render of same kind.
  const lastHl = {};
  let lastRoute = null;
  function placeHl(animate) {
    view.querySelectorAll('.seg').forEach((seg) => {
      const hl = seg.querySelector('.seg-hl');
      const on = seg.querySelector('button.on');
      if (!hl || !on) return;
      const kind = seg.querySelector('button').dataset.seg !== undefined ? 'seg' : 'filter';
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

  function render() {
    const r = state.route;
    const changed = r !== lastRoute;
    lastRoute = r;
    $('title').textContent = TITLES[r];
    document.title = `${TITLES[r]} · Slate Projector`;
    document.querySelectorAll('#nav a').forEach((a) => {
      if (a.dataset.route === r) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });

    if (SPORTS[r]) {
      const seg = state.segment[r];
      const o = state.dayOffset;
      const pill = (n, label) => `<button data-off="${n}" class="${o === n ? 'on' : ''}" aria-pressed="${o === n}"><span class="d">${n === 0 ? 'Today' : label}</span><span class="s">${esc(shortDate(n))}</span></button>`;
      view.innerHTML = segmented(SEGMENTS, seg, 'data-seg') +
        `<div class="dates">
          <button class="arrow" data-shift="-1" aria-label="Previous day">&#8249;</button>
          <div class="pills">${pill(-1, 'Yesterday')}${pill(0, 'Today')}${pill(1, 'Tomorrow')}</div>
          <button class="arrow" data-shift="1" aria-label="Next day">&#8250;</button>
        </div>` +
        empty(seg, `${seg} \u00b7 ${dateLabel(o)}`, 'Slate data lands in the next build step.', 3);
    } else if (r === 'bets') {
      view.innerHTML = empty('Bets', 'Swipe decks', 'Decks open at the close pull.', 2);
    } else {
      const tile = (l) => `<div class="tile"><div class="lbl">${l}</div><div class="num">\u2014</div><span class="bar w55"></span></div>`;
      view.innerHTML = segmented(FILTERS, state.filter, 'data-filter') +
        `<div class="tiles" aria-label="${esc(state.filter)} results, data coming next">${['W-L', 'Win %', 'Units', 'ROI'].map(tile).join('')}</div>`;
    }
    if (changed) {
      view.classList.remove('enter'); void view.offsetWidth; view.classList.add('enter');
    }
    placeHl(!changed);
  }

  view.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const d = b.dataset;
    if (d.seg) state.segment[state.route] = d.seg;
    else if (d.off !== undefined) state.dayOffset = +d.off;
    else if (d.shift) state.dayOffset += +d.shift;
    else if (d.filter) state.filter = d.filter;
    else return;
    render();
  });

  function route() {
    const h = location.hash.slice(1);
    state.route = TITLES[h] ? h : 'nba';
    render();
  }
  window.addEventListener('hashchange', route);

  const sheet = $('sheet'), backdrop = $('backdrop');
  function setSheet(open) {
    sheet.hidden = backdrop.hidden = !open;
    if (open) $('close').focus(); else $('gear').focus();
  }
  $('gear').addEventListener('click', () => setSheet(true));
  $('close').addEventListener('click', () => setSheet(false));
  backdrop.addEventListener('click', () => setSheet(false));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !sheet.hidden) setSheet(false); });

  route();
})();
